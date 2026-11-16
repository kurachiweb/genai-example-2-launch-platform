import type { Logger } from '@logtape/logtape';

import { isoWeekKey } from '../../../common-lib/tournament/week-period.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { MatchDirectory } from '../../core/match/ports.ts';
import {
  type NotificationEvent,
  type NotificationEventPublisher,
  NOTIFICATION_PUBLISH_EVENT_LIMIT,
  NotificationPublishError,
  type NotificationPublishErrorReason,
} from '../../core/notifications/notification-event-contract.ts';
import { nextBusinessDate } from '../../core/tournament/round-schedule.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
} from '../../core/time/business-time.ts';
import type {
  WeekAwardedProduct,
  WeekNotificationPublisher,
  WeekTournamentStore,
} from '../../core/week-tournament/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

const PUBLISHER = 'tournament-week';

const START_OF_DAY = Object.freeze({ hour: 0, minute: 0 });

const NOT_PREVIEWABLE_MESSAGE =
  '開始済みのマッチの予告を通知イベントの発行から除きました';

const REJECTED_MESSAGE = '発行を拒否された通知イベントを除きました';

interface RoundInput {
  readonly decidedMatchIds: readonly string[];
  readonly previewMatchIds: readonly string[];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function roundEventsOf({
  decidedMatchIds,
  previewMatchIds,
}: RoundInput): NotificationEvent[] {
  return [
    ...decidedMatchIds.map((matchId): NotificationEvent => ({
      type: 'match_result',
      matchId,
    })),
    ...previewMatchIds.map((matchId): NotificationEvent => ({
      type: 'match_preview',
      matchId,
    })),
  ];
}

function awardEventOf({
  weekStart,
  productId,
}: WeekAwardedProduct): NotificationEvent {
  return {
    type: 'award',
    award: 'product_of_the_week',
    period: isoWeekKey(weekStart),
    productId,
  };
}

function subjectOf(event: NotificationEvent): Readonly<Record<string, string>> {
  return event.type === 'award'
    ? { productId: event.productId }
    : { matchId: event.matchId };
}

interface Violation {
  readonly event: NotificationEvent;
  readonly index: number;
  readonly reason: NotificationPublishErrorReason;
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

export class WeekTournamentNotificationPublisher implements WeekNotificationPublisher {
  private readonly logger: Logger;

  constructor(
    private readonly store: WeekTournamentStore,
    private readonly matches: MatchDirectory,
    private readonly notifications: NotificationEventPublisher,
    appName: LoggingOptions['appName'],
  ) {
    this.logger = getAppLogger([appName, 'week-tournament', 'notification']);
  }

  async publishRound(input: RoundInput & { readonly at: Date }): Promise<void> {
    await this.publishAll(roundEventsOf(input), input.at);
  }

  async publishAward(
    input: WeekAwardedProduct & { readonly at: Date },
  ): Promise<void> {
    await this.publishAll([awardEventOf(input)], input.at);
  }

  async publishNight({
    date,
    at,
  }: {
    readonly date: BusinessDate;
    readonly at: Date;
  }): Promise<void> {
    const [today, tomorrow, awards] = await Promise.all([
      this.matches.listForDate({ date, kinds: ['week'], now: at }),
      this.matches.listForDate({
        date: nextBusinessDate(date),
        kinds: ['week'],
        now: at,
      }),
      this.store.listAwardedBetween(
        fromBusinessDateTime(date, START_OF_DAY),
        at,
      ),
    ]);
    const events = [
      ...roundEventsOf({
        decidedMatchIds: today
          .filter(({ decidedAt }) => decidedAt !== null)
          .map(({ matchId }) => matchId),
        previewMatchIds: tomorrow
          .filter(
            ({ phase, entries }) =>
              phase === 'scheduled' && entries.length === 2,
          )
          .map(({ matchId }) => matchId),
      }),
      ...awards.map(awardEventOf),
    ];
    await this.publishAll(events, at);
  }

  private async publishAll(
    events: readonly NotificationEvent[],
    at: Date,
  ): Promise<void> {
    for (const page of chunk(events, NOTIFICATION_PUBLISH_EVENT_LIMIT)) {
      await this.publishExcludingViolations(page, at);
    }
  }

  // 発行の口は1件の違反で全件を拒否して位置だけを返すため、違反を1件ずつ除いて発行し直す。違反はまれなため、発行の前にマッチを照会しない
  private async publishExcludingViolations(
    events: readonly NotificationEvent[],
    at: Date,
  ): Promise<void> {
    let remaining = events;
    while (remaining.length > 0) {
      try {
        await this.notifications.publish({
          publisher: PUBLISHER,
          events: remaining,
          at,
        });
        return;
      } catch (error) {
        const violation = violationOf(error, remaining);
        if (violation === undefined) {
          throw error;
        }
        this.logExcluded(violation);
        remaining = remaining.toSpliced(violation.index, 1);
      }
    }
  }

  private logExcluded({ event, reason }: Violation): void {
    const attributes = { ...subjectOf(event), reason };
    if (reason === 'match-not-previewable') {
      this.logger.info(NOT_PREVIEWABLE_MESSAGE, attributes);
      return;
    }
    this.logger.error(REJECTED_MESSAGE, attributes);
  }
}
