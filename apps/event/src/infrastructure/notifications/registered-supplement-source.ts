import type { ServiceIdentifier } from 'inversify';

import { MATCH_RESULT_SUPPLEMENT_LIMIT } from '../../../lib/core/email/kinds/notifications.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import {
  type ResultNoticeSupplement,
  type ResultNoticeSupplementInput,
  type ResultNoticeSupplementProvider,
  type ResultNoticeSupplementRegistry,
  resultNoticeSupplementSchema,
} from '../../../lib/core/notifications/result-notice-supplements.ts';
import type { SupplementSource } from '../../application/notifications/ports.ts';

export type ResultNoticeSupplementProviderResolver = (
  identifier: ServiceIdentifier<ResultNoticeSupplementProvider>,
) => ResultNoticeSupplementProvider;

const logger = getAppLogger(['event', 'notifications', 'supplements']);

// 提供元は登録した機能のモジュールが束縛するため、呼び出しの時点の処理単位のコンテナから引く
export class RegisteredSupplementSource implements SupplementSource {
  constructor(
    private readonly registry: ResultNoticeSupplementRegistry,
    private readonly resolve: ResultNoticeSupplementProviderResolver,
  ) {}

  async supplementsFor(
    requests: readonly {
      readonly noticeId: string;
      readonly input: ResultNoticeSupplementInput;
    }[],
  ): Promise<ReadonlyMap<string, readonly ResultNoticeSupplement[]>> {
    const supplements = new Map<string, readonly ResultNoticeSupplement[]>();
    for (const { noticeId, input } of requests) {
      const collected = await this.collect(input);
      if (collected.length > 0) {
        supplements.set(noticeId, collected);
      }
    }
    return supplements;
  }

  // 期限の欠けたメールを送らないため、提供元の例外は捕まえずに送り出しの段の再試行に任せる
  private async collect(
    input: ResultNoticeSupplementInput,
  ): Promise<readonly ResultNoticeSupplement[]> {
    const collected: ResultNoticeSupplement[] = [];
    for (const registration of this.registry.providersFor(input.kind)) {
      if (collected.length >= MATCH_RESULT_SUPPLEMENT_LIMIT) {
        break;
      }
      const provided = await this.resolve(registration.provider).supplementFor(
        input,
      );
      if (provided === undefined) {
        continue;
      }
      const parsed = resultNoticeSupplementSchema.safeParse(provided);
      if (!parsed.success) {
        // 追記の内容は提供元の内部の値を含み得るため、提供元の名前だけを残す
        logger.warn('形式に合わない結果の追記を捨てました', {
          provider: registration.name,
        });
        continue;
      }
      collected.push(parsed.data);
    }
    return Object.freeze(collected);
  }
}
