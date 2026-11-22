import { describe, expect, test } from 'bun:test';

import {
  createAsyncLifecycleRegistry,
  USER_LIFECYCLE_EVENT_TYPES,
  type UserLifecycleEventType,
} from '../../lib/core/identity/user-lifecycle.ts';
import { EVENT_DATA_EXPORT_TYPES } from '../application/data-export/event-data-export-types.ts';
import { EVENT_MODERATION_TYPES } from '../application/moderation/event-moderation-types.ts';
import { EVENT_REPORTING_TYPES } from '../application/reporting/event-reporting-types.ts';
import { EVENT_SPONSORSHIP_TYPES } from '../application/sponsorship/event-sponsorship-types.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../application/week-tournament/event-week-tournament-types.ts';
import { EVENT_YEAR_TOURNAMENT_TYPES } from '../application/year-tournament/event-year-tournament-types.ts';
import { USER_LIFECYCLE_ASYNC_HANDLERS } from './user-lifecycle-async-handlers.ts';

const namesFor = (type: UserLifecycleEventType): readonly string[] =>
  createAsyncLifecycleRegistry(USER_LIFECYCLE_ASYNC_HANDLERS)
    .handlersFor(type)
    .map(({ name }) => name);

const relativeOrderOf = (
  type: UserLifecycleEventType,
  names: readonly string[],
): readonly string[] => namesFor(type).filter((name) => names.includes(name));

describe('ユーザーライフサイクルの処理の登録口', () => {
  test('登録は<spec名>.<名詞句>の名前と同じイベントでのorderが重複せず、検証を通る凍結済みの配列である', () => {
    expect(Object.isFrozen(USER_LIFECYCLE_ASYNC_HANDLERS)).toBe(true);
    expect(() =>
      createAsyncLifecycleRegistry(USER_LIFECYCLE_ASYNC_HANDLERS),
    ).not.toThrow();
  });

  test('tournament-weekは退会に1500で参加資格の喪失だけを登録する', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('tournament-week.'),
      ),
    ).toStrictEqual([
      {
        name: 'tournament-week.account-entry-loss',
        events: ['withdrawn'],
        order: 1500,
        handler: EVENT_WEEK_TOURNAMENT_TYPES.AccountEntryLossHandler,
      },
    ]);
  });

  test('tournament-yearは退会に1700で参加資格の喪失だけを登録する', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('tournament-year.'),
      ),
    ).toStrictEqual([
      {
        name: 'tournament-year.account-entry-loss',
        events: ['withdrawn'],
        order: 1700,
        handler: EVENT_YEAR_TOURNAMENT_TYPES.AccountEntryLossHandler,
      },
    ]);
  });

  test('sponsorshipは物理削除の開始に1600で申込の削除だけを登録し、content-reportingの通報の削除とugc-moderationの措置の記録の削除の前に並ぶ', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('sponsorship.'),
      ),
    ).toStrictEqual([
      {
        name: 'sponsorship.account-purge',
        events: ['purge_due'],
        order: 1600,
        handler: EVENT_SPONSORSHIP_TYPES.AccountPurgeHandler,
      },
    ]);
    expect(
      relativeOrderOf('purge_due', [
        'ugc-moderation.account-record-erasure',
        'content-reporting.user-report-erasure',
        'sponsorship.account-purge',
      ]),
    ).toStrictEqual([
      'sponsorship.account-purge',
      'content-reporting.user-report-erasure',
      'ugc-moderation.account-record-erasure',
    ]);
    expect(
      USER_LIFECYCLE_EVENT_TYPES.filter((type) => type !== 'purge_due')
        .flatMap((type) => namesFor(type))
        .filter((name) => name.startsWith('sponsorship.')),
    ).toEqual([]);
  });

  test('content-reportingは物理削除の開始に1800で通報の削除と案件の参照の消去だけを登録し、措置の記録の削除より前に並ぶ', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('content-reporting.'),
      ),
    ).toStrictEqual([
      {
        name: 'content-reporting.user-report-erasure',
        events: ['purge_due'],
        order: 1800,
        handler: EVENT_REPORTING_TYPES.UserReportErasureHandler,
      },
    ]);
    expect(
      relativeOrderOf('purge_due', [
        'ugc-moderation.account-record-erasure',
        'content-reporting.user-report-erasure',
      ]),
    ).toStrictEqual([
      'content-reporting.user-report-erasure',
      'ugc-moderation.account-record-erasure',
    ]);
    expect(
      USER_LIFECYCLE_EVENT_TYPES.filter((type) => type !== 'purge_due')
        .flatMap((type) => namesFor(type))
        .filter((name) => name.startsWith('content-reporting.')),
    ).toEqual([]);
  });

  test('ugc-moderationは物理削除の開始に1900で措置の記録の削除だけを登録し、identity-auth専用の10000番台より前に並ぶ', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('ugc-moderation.'),
      ),
    ).toStrictEqual([
      {
        name: 'ugc-moderation.account-record-erasure',
        events: ['purge_due'],
        order: 1900,
        handler: EVENT_MODERATION_TYPES.AccountRecordErasureHandler,
      },
    ]);
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ events }) =>
        events.includes('purge_due'),
      ).every(({ order }) => order < 10000),
    ).toBe(true);
    expect(namesFor('purge_due')).toContain(
      'ugc-moderation.account-record-erasure',
    );
    expect(
      USER_LIFECYCLE_EVENT_TYPES.filter((type) => type !== 'purge_due')
        .flatMap((type) => namesFor(type))
        .filter((name) => name.startsWith('ugc-moderation.')),
    ).toEqual([]);
  });

  test('退会では未完了の決済の失効・解約・即時の終了の後続の処理の後、data-exportのエクスポートの削除とアカウント機能の処理の前に並び、tournament-yearはtournament-weekの後に並ぶ', () => {
    expect(namesFor('withdrawn')).toStrictEqual([
      'payments.open-checkout-expiry',
      'ultras-subscription.subscription-cancellation',
      'match-engine.account-decision-follow-up',
      'tournament-week.account-entry-loss',
      'tournament-year.account-entry-loss',
      'data-export.archive-erasure',
      'identity-auth.email-suppression-cleanup',
    ]);
  });

  test('data-exportは退会と物理削除の開始に2100でエクスポートの記録とZIPの削除だけを登録し、ugc-moderationの措置の記録の削除の後・アカウント機能の処理の前に並ぶ', () => {
    expect(
      USER_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('data-export.'),
      ),
    ).toStrictEqual([
      {
        name: 'data-export.archive-erasure',
        events: ['withdrawn', 'purge_due'],
        order: 2100,
        handler: EVENT_DATA_EXPORT_TYPES.ArchiveErasureHandler,
      },
    ]);
    expect(namesFor('purge_due').slice(-2)).toStrictEqual([
      'ugc-moderation.account-record-erasure',
      'data-export.archive-erasure',
    ]);
    expect(namesFor('withdrawn').slice(-2)).toStrictEqual([
      'data-export.archive-erasure',
      'identity-auth.email-suppression-cleanup',
    ]);
    expect(
      (['suspended', 'unsuspended'] as const)
        .flatMap((type) => namesFor(type))
        .filter((name) => name.startsWith('data-export.')),
    ).toEqual([]);
  });

  test.each(['tournament-week.', 'tournament-year.'])(
    '%sの処理は、停止・停止の解除・物理削除の開始では呼ばれない',
    (prefix) => {
      const others = USER_LIFECYCLE_EVENT_TYPES.filter(
        (type) => type !== 'withdrawn',
      ).flatMap((type) => namesFor(type));

      expect(others.filter((name) => name.startsWith(prefix))).toEqual([]);
    },
  );
});
