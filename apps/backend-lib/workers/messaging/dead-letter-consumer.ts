import { withContext } from '@logtape/logtape';
import { captureEvent } from '@sentry/cloudflare';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  type DeadLetterReason,
  isDeadLetterNotice,
  parseEnvelope,
} from '../../core/messaging/envelope.ts';

interface DeadLetterReport {
  readonly messageId: string | undefined;
  readonly messageType: string | undefined;
  readonly attempts: number;
  readonly reason: DeadLetterReason;
  readonly errorName: string | undefined;
  readonly failedAt: string | undefined;
}

const logger = getAppLogger(['event', 'queue', 'dead-letter']);

const REPORT_MESSAGE = 'デッドレターへ移ったメッセージを受け取りました';

// 本文を記録しないため、通知の項目か封筒のIDと種別だけを取り出す
function toReport(message: Message): DeadLetterReport {
  const { body } = message;
  if (isDeadLetterNotice(body)) {
    return {
      messageId: body.messageId,
      messageType: body.type,
      attempts: body.attempts,
      reason: body.reason,
      errorName: body.errorName,
      failedAt: body.failedAt,
    };
  }
  const parsed = parseEnvelope(body);
  return {
    messageId: parsed.ok ? parsed.envelope.id : undefined,
    messageType: parsed.ok ? parsed.envelope.type : undefined,
    attempts: message.attempts,
    reason: 'auto-moved',
    errorName: undefined,
    failedAt: undefined,
  };
}

function reportTags(report: DeadLetterReport): Record<string, string> {
  return {
    ...(report.messageType === undefined
      ? {}
      : { message_type: report.messageType }),
    dead_letter_reason: report.reason,
  };
}

function notifyDeadLetter(
  report: DeadLetterReport,
  queueMessageId: string,
): void {
  const record = { ...report, queueMessageId };
  logger.error(REPORT_MESSAGE, record);
  // captureMessageの文言だけのイベントは、直前と同じ文言なら重複として捨てられ、続けて移った別のメッセージを通知できない。文言をlogentryに置くと重複の判定から外れ、まとめ方は理由と種別の指紋で決める
  captureEvent({
    level: 'error',
    logentry: { message: REPORT_MESSAGE },
    fingerprint: [
      'dead-letter',
      report.reason,
      report.messageType ?? 'unknown',
    ],
    tags: reportTags(report),
    contexts: { dead_letter: record },
  });
}

export function handleDeadLetterBatch(batch: MessageBatch): void {
  for (const message of batch.messages) {
    const report = toReport(message);
    const notify = (): void => {
      notifyDeadLetter(report, message.id);
    };
    if (report.messageId === undefined) {
      notify();
    } else {
      withContext({ correlationId: report.messageId }, notify);
    }
    message.ack();
  }
}
