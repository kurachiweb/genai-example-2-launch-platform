import type { Logger } from '@logtape/logtape';

import {
  type NotificationEvent,
  type NotificationEventPublisher,
  NOTIFICATION_PUBLISH_EVENT_LIMIT,
  NotificationPublishError,
  type NotificationPublishErrorReason,
} from './notification-event-contract.ts';

const NOT_PREVIEWABLE_MESSAGE =
  '開始済みのマッチの予告を通知イベントの発行から除きました';

const REJECTED_MESSAGE = '発行を拒否された通知イベントを除きました';

export interface ViolationTolerantPublishInput {
  readonly publisher: NotificationEventPublisher;
  readonly name: string;
  readonly events: readonly NotificationEvent[];
  readonly at: Date;
  readonly logger: Logger;
}

interface Violation {
  readonly event: NotificationEvent;
  readonly index: number;
  readonly reason: NotificationPublishErrorReason;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function subjectOf(event: NotificationEvent): Readonly<Record<string, string>> {
  return event.type === 'award'
    ? { productId: event.productId }
    : { matchId: event.matchId };
}

function violationOf(
  error: unknown,
  events: readonly NotificationEvent[],
): Violation | undefined {
  if (
    !(error instanceof NotificationPublishError) ||
    error.eventIndex === null
  ) {
    return undefined;
  }
  const index = error.eventIndex;
  const event = events[index];
  return event === undefined
    ? undefined
    : { event, index, reason: error.reason };
}

function logExcluded(logger: Logger, { event, reason }: Violation): void {
  const attributes = { ...subjectOf(event), reason };
  if (reason === 'match-not-previewable') {
    logger.info(NOT_PREVIEWABLE_MESSAGE, attributes);
    return;
  }
  logger.error(REJECTED_MESSAGE, attributes);
}

// 発行の口は1件の違反で全件を拒否して位置だけを返すため、違反を1件ずつ除いて発行し直す。違反はまれなため、発行の前に出どころを照会しない
async function publishPage(
  {
    publisher,
    name,
    at,
    logger,
  }: Omit<ViolationTolerantPublishInput, 'events'>,
  events: readonly NotificationEvent[],
): Promise<void> {
  let remaining = events;
  while (remaining.length > 0) {
    try {
      await publisher.publish({ publisher: name, events: remaining, at });
      return;
    } catch (error) {
      const violation = violationOf(error, remaining);
      if (violation === undefined) {
        throw error;
      }
      logExcluded(logger, violation);
      remaining = remaining.toSpliced(violation.index, 1);
    }
  }
}

export async function publishExcludingViolations({
  events,
  ...context
}: ViolationTolerantPublishInput): Promise<void> {
  for (const page of chunk(events, NOTIFICATION_PUBLISH_EVENT_LIMIT)) {
    await publishPage(context, page);
  }
}
