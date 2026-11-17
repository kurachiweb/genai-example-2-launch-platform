import type { Logger } from '@logtape/logtape';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { MatchDirectory } from '../../core/match/ports.ts';
import type {
  NotificationEvent,
  NotificationEventPublisher,
} from '../../core/notifications/notification-event-contract.ts';
import { publishExcludingViolations } from '../../core/notifications/violation-tolerant-publish.ts';
import {
  addBusinessDays,
  type BusinessDate,
  fromBusinessDateTime,
} from '../../core/time/business-time.ts';
import type {
  YearNotificationPublisher,
  YearTournamentStore,
} from '../../core/year-tournament/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

const PUBLISHER = 'tournament-year';

const START_OF_DAY = Object.freeze({ hour: 0, minute: 0 });

interface RoundInput {
  readonly decidedMatchIds: readonly string[];
  readonly previewMatchIds: readonly string[];
}

interface AwardInput {
  readonly year: number;
  readonly productId: string;
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

function awardEventOf({ year, productId }: AwardInput): NotificationEvent {
  return {
    type: 'award',
    award: 'product_of_the_year',
    period: String(year),
    productId,
  };
}

export class YearTournamentNotificationPublisher implements YearNotificationPublisher {
  private readonly logger: Logger;

  constructor(
    private readonly store: YearTournamentStore,
    private readonly matches: MatchDirectory,
    private readonly notifications: NotificationEventPublisher,
    appName: LoggingOptions['appName'],
  ) {
    this.logger = getAppLogger([appName, 'year-tournament', 'notification']);
  }

  async publishRound(input: RoundInput & { readonly at: Date }): Promise<void> {
    await this.publishAll(roundEventsOf(input), input.at);
  }

  async publishAward(input: AwardInput & { readonly at: Date }): Promise<void> {
    await this.publishAll([awardEventOf(input)], input.at);
  }

  async publishEvening({
    date,
    at,
  }: {
    readonly date: BusinessDate;
    readonly at: Date;
  }): Promise<void> {
    const [today, tomorrow, awards] = await Promise.all([
      this.matches.listForDate({ date, kinds: ['year'], now: at }),
      this.matches.listForDate({
        date: addBusinessDays(date, 1),
        kinds: ['year'],
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
    await publishExcludingViolations({
      publisher: this.notifications,
      name: PUBLISHER,
      events,
      at,
      logger: this.logger,
    });
  }
}
