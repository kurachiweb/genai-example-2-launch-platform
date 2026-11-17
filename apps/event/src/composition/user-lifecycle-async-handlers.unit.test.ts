import { describe, expect, test } from 'bun:test';

import {
  createAsyncLifecycleRegistry,
  USER_LIFECYCLE_EVENT_TYPES,
  type UserLifecycleEventType,
} from '../../lib/core/identity/user-lifecycle.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../application/week-tournament/event-week-tournament-types.ts';
import { EVENT_YEAR_TOURNAMENT_TYPES } from '../application/year-tournament/event-year-tournament-types.ts';
import { USER_LIFECYCLE_ASYNC_HANDLERS } from './user-lifecycle-async-handlers.ts';

const namesFor = (type: UserLifecycleEventType): readonly string[] =>
  createAsyncLifecycleRegistry(USER_LIFECYCLE_ASYNC_HANDLERS)
    .handlersFor(type)
    .map(({ name }) => name);

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

  test('退会では未完了の決済の失効・解約・即時の終了の後続の処理の後、アカウント機能の処理の前に並び、tournament-yearはtournament-weekの後に並ぶ', () => {
    expect(namesFor('withdrawn')).toStrictEqual([
      'payments.open-checkout-expiry',
      'ultras-subscription.subscription-cancellation',
      'match-engine.account-decision-follow-up',
      'tournament-week.account-entry-loss',
      'tournament-year.account-entry-loss',
      'identity-auth.email-suppression-cleanup',
    ]);
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
