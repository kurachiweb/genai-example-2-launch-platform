import { inject, injectable } from 'inversify';

import {
  type DeliveryEvent,
  parseDeliveryEvent,
} from '../../../lib/core/email/delivery-event.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import type { SuppressionRecorder } from '../../../lib/core/email/ports.ts';
import {
  decideSuppressionEffect,
  type SuppressionEffect,
} from '../../../lib/core/email/suppression-policy.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  RawMessageHandler,
  RawMessageMeta,
} from '../../../lib/core/messaging/raw-queue.ts';
import { EVENT_EMAIL_TYPES } from './email-types.ts';
import type { EmailIncidentReporter } from './ports.ts';

const logger = getAppLogger(['event', 'application', 'email-delivery-event']);

const RESULT_MESSAGE = '配信不能イベントを処理しました';

// 外部から届く文字列は長さの上限が無いため、ログの1行を際限なく大きくしない
const MAX_LOGGED_VALUE_LENGTH = 64;

// 宛先・件名・配送サーバーの応答を出さないよう、ログの属性は正規化後のイベントの種類と効果の値だけで組む
type ResultProperties = Readonly<Record<string, string | null>>;

function truncate(value: string): string {
  return value.slice(0, MAX_LOGGED_VALUE_LENGTH);
}

function identityOf(event: DeliveryEvent): ResultProperties {
  return { eventKind: event.kind, eventId: truncate(event.eventId) };
}

@injectable()
export class DeliveryEventHandler implements RawMessageHandler {
  constructor(
    @inject(EMAIL_TYPES.SuppressionRecorder)
    private readonly recorder: SuppressionRecorder,
    @inject(EVENT_EMAIL_TYPES.EmailIncidentReporter)
    private readonly incidents: EmailIncidentReporter,
  ) {}

  // 再配信でも同じ契機の日時になるよう、発生日時の無いイベントはQueuesに入った時刻で補う
  async handle(body: unknown, meta: RawMessageMeta): Promise<void> {
    const parsed = parseDeliveryEvent(body, meta.timestamp);
    if (!parsed.ok) {
      // 再試行しても形式は変わらないため、例外にせず正常に終えてメッセージを消す
      this.incidents.report({
        kind: 'invalid-delivery-event',
        type: parsed.type,
      });
      logger.warn(RESULT_MESSAGE, {
        result: 'invalid',
        reason: parsed.reason,
        ...(parsed.type === undefined
          ? {}
          : { eventType: truncate(parsed.type) }),
      });
      return;
    }
    await this.apply(parsed.event, decideSuppressionEffect(parsed.event));
  }

  // 記録の失敗は例外のまま投げ、上流の再試行に任せる。記録は合成で冪等なため再試行しても結果が変わらない
  private async apply(
    event: DeliveryEvent,
    effect: SuppressionEffect,
  ): Promise<void> {
    switch (effect.kind) {
      case 'suppress':
        await this.recorder.record(event.recipient, effect.state);
        logger.info(RESULT_MESSAGE, {
          result: 'suppressed',
          ...identityOf(event),
          suppressionReason: effect.state.lastReason,
          suppressedUntil: effect.state.expiresAt?.toISOString() ?? null,
        });
        return;
      case 'report':
        this.incidents.report({
          kind: effect.category,
          reason: effect.reason,
        });
        logger.error(RESULT_MESSAGE, {
          result: 'reported',
          ...identityOf(event),
          reportKind: effect.category,
          reason: effect.reason,
        });
        return;
      case 'log-only':
        logger.info(RESULT_MESSAGE, { result: 'logged', ...identityOf(event) });
        return;
      case 'ignore':
        logger.debug(RESULT_MESSAGE, {
          result: 'ignored',
          ...identityOf(event),
          ...(event.kind === 'ignored' ? { ignoredType: event.type } : {}),
        });
        return;
    }
  }
}
