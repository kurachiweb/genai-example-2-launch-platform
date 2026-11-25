import { inject, injectable } from 'inversify';

import type { DataExportMessageBody } from '../../../lib/core/data-export/data-export-messages.ts';
import { DATA_EXPORT_PLATFORM_TYPES } from '../../../lib/core/data-export/identifiers.ts';
import type {
  DataExportIncidentReporter,
  DataExportStore,
  DataExportTerminator,
} from '../../../lib/core/data-export/ports.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

// 要求の2時間後に届き、まだ作成中の要求だけを失敗にする。失敗の確定は未完了の記録にだけ効くため、再配信や日次の受け皿との重なりでも二重に失敗にならない
@injectable()
export class GenerationWatchdogHandler implements MessageHandler<DataExportMessageBody> {
  constructor(
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
    private readonly store: Pick<DataExportStore, 'find'>,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportTerminator)
    private readonly terminator: DataExportTerminator,
    @inject(DATA_EXPORT_PLATFORM_TYPES.DataExportIncidentReporter)
    private readonly incidents: DataExportIncidentReporter,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async handle(body: DataExportMessageBody): Promise<MessageHandlingResult> {
    const record = await this.store.find(body.exportId);
    if (
      record === undefined ||
      (record.status !== 'queued' && record.status !== 'generating')
    ) {
      return DONE;
    }
    const result = await this.terminator.fail({
      exportId: body.exportId,
      kind: 'error',
      now: this.clock.now(),
      notify: true,
    });
    if (result === 'failed') {
      this.incidents.report({
        kind: 'generation-abandoned',
        exportId: body.exportId,
        by: 'watchdog',
      });
    }
    return DONE;
  }
}
