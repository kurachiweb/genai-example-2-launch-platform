import { inject, injectable } from 'inversify';

import {
  BUSY_DEFER_SECONDS,
  GENERATION_MAX_ATTEMPTS,
  type DataExportMessageBody,
} from '../../../lib/core/data-export/data-export-messages.ts';
import { DATA_EXPORT_PLATFORM_TYPES } from '../../../lib/core/data-export/identifiers.ts';
import type {
  DataExportIncidentReporter,
  DataExportTerminator,
} from '../../../lib/core/data-export/ports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { ArchiveGenerationService } from './archive-generation-service.ts';
import { EVENT_DATA_EXPORT_TYPES } from './event-data-export-types.ts';

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const BUSY: MessageHandlingResult = Object.freeze({
  kind: 'defer',
  delaySeconds: BUSY_DEFER_SECONDS,
});

// 使用中のdeferは試行の回数を1へ戻すが、2時間の見張りが生成の全体の上限を担保する
@injectable()
export class GenerateArchiveHandler implements MessageHandler<DataExportMessageBody> {
  constructor(
    @inject(EVENT_DATA_EXPORT_TYPES.ArchiveGenerationService)
    private readonly generation: Pick<ArchiveGenerationService, 'generate'>,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportTerminator)
    private readonly terminator: DataExportTerminator,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportIncidentReporter)
    private readonly incidents: DataExportIncidentReporter,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async handle(
    body: DataExportMessageBody,
    meta: MessageMeta,
  ): Promise<MessageHandlingResult> {
    try {
      const outcome = await this.generation.generate({
        exportId: body.exportId,
        now: this.clock.now(),
      });
      return outcome === 'busy' ? BUSY : DONE;
    } catch (error) {
      if (meta.attempts < GENERATION_MAX_ATTEMPTS) {
        throw error;
      }
      await this.giveUp(body.exportId, meta.attempts, error);
      return DONE;
    }
  }

  // 失敗の確定が例外になればデッドレターへ移り、確定できた後にだけ運用者へ知らせる
  private async giveUp(
    exportId: string,
    attempts: number,
    error: unknown,
  ): Promise<void> {
    await this.terminator.fail({
      exportId,
      kind: 'error',
      now: this.clock.now(),
      notify: true,
    });
    this.incidents.report({
      kind: 'generation-failed',
      exportId,
      attempts,
      error,
    });
  }
}
