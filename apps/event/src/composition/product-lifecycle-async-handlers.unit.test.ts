import { describe, expect, test } from 'bun:test';

import {
  createProductLifecycleRegistry,
  PRODUCT_LIFECYCLE_EVENT_TYPES,
  type ProductLifecycleEventType,
} from '../../lib/core/product/product-lifecycle.ts';
import { EVENT_MODERATION_TYPES } from '../application/moderation/event-moderation-types.ts';
import { EVENT_SPONSORSHIP_TYPES } from '../application/sponsorship/event-sponsorship-types.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../application/week-tournament/event-week-tournament-types.ts';
import { EVENT_YEAR_TOURNAMENT_TYPES } from '../application/year-tournament/event-year-tournament-types.ts';
import { PRODUCT_LIFECYCLE_ASYNC_HANDLERS } from './product-lifecycle-async-handlers.ts';

const namesFor = (type: ProductLifecycleEventType): readonly string[] =>
  createProductLifecycleRegistry(PRODUCT_LIFECYCLE_ASYNC_HANDLERS)
    .handlersFor(type)
    .map(({ name }) => name);

describe('プロダクトライフサイクルの処理の登録口', () => {
  test('登録は<spec名>.<名詞句>の名前と同じイベントでのorderが重複せず、検証を通る凍結済みの配列である', () => {
    expect(Object.isFrozen(PRODUCT_LIFECYCLE_ASYNC_HANDLERS)).toBe(true);
    expect(() =>
      createProductLifecycleRegistry(PRODUCT_LIFECYCLE_ASYNC_HANDLERS),
    ).not.toThrow();
  });

  test('tournament-weekは論理削除に1500で参加資格の喪失を、物理削除の時期の到来に1500で紐付けの解除を登録する', () => {
    expect(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('tournament-week.'),
      ),
    ).toStrictEqual([
      {
        name: 'tournament-week.product-entry-loss',
        events: ['deleted'],
        order: 1500,
        handler: EVENT_WEEK_TOURNAMENT_TYPES.ProductEntryLossHandler,
      },
      {
        name: 'tournament-week.entry-unlink',
        events: ['purge_due'],
        order: 1500,
        handler: EVENT_WEEK_TOURNAMENT_TYPES.EntryUnlinkHandler,
      },
    ]);
  });

  test('tournament-yearは論理削除に1700で参加資格の喪失を、物理削除の時期の到来に1700で紐付けの解除を登録する', () => {
    expect(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('tournament-year.'),
      ),
    ).toStrictEqual([
      {
        name: 'tournament-year.product-entry-loss',
        events: ['deleted'],
        order: 1700,
        handler: EVENT_YEAR_TOURNAMENT_TYPES.ProductEntryLossHandler,
      },
      {
        name: 'tournament-year.entry-unlink',
        events: ['purge_due'],
        order: 1700,
        handler: EVENT_YEAR_TOURNAMENT_TYPES.EntryUnlinkHandler,
      },
    ]);
  });

  test('sponsorshipは物理削除の時期の到来に1600で申込の削除だけを登録する', () => {
    expect(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('sponsorship.'),
      ),
    ).toStrictEqual([
      {
        name: 'sponsorship.product-purge',
        events: ['purge_due'],
        order: 1600,
        handler: EVENT_SPONSORSHIP_TYPES.ProductPurgeHandler,
      },
    ]);
  });

  test('ugc-moderationは物理削除の時期の到来に1900で措置の記録の削除だけを登録する', () => {
    expect(
      PRODUCT_LIFECYCLE_ASYNC_HANDLERS.filter(({ name }) =>
        name.startsWith('ugc-moderation.'),
      ),
    ).toStrictEqual([
      {
        name: 'ugc-moderation.product-record-erasure',
        events: ['purge_due'],
        order: 1900,
        handler: EVENT_MODERATION_TYPES.ProductRecordErasureHandler,
      },
    ]);
  });

  test('論理削除では即時の終了の後続の処理の後に、物理削除の時期の到来ではengagementの削除の後に並び、sponsorshipはtournament-weekとtournament-yearの間に、ugc-moderationは最後に並ぶ', () => {
    expect(namesFor('deleted')).toStrictEqual([
      'match-engine.product-decision-follow-up',
      'tournament-week.product-entry-loss',
      'tournament-year.product-entry-loss',
    ]);
    expect(namesFor('purge_due')).toStrictEqual([
      'product-launch.image-erasure',
      'match-engine.entry-unlink',
      'directory-discovery.entry-erasure',
      'engagement.product-erasure',
      'tournament-week.entry-unlink',
      'sponsorship.product-purge',
      'tournament-year.entry-unlink',
      'ugc-moderation.product-record-erasure',
    ]);
  });

  test.each([
    'tournament-week.',
    'tournament-year.',
    'sponsorship.',
    'ugc-moderation.',
  ])('%sの処理は、非公開化と非公開化の解除では呼ばれない', (prefix) => {
    const others = PRODUCT_LIFECYCLE_EVENT_TYPES.filter(
      (type) => type === 'hidden' || type === 'unhidden',
    ).flatMap((type) => namesFor(type));

    expect(others.filter((name) => name.startsWith(prefix))).toEqual([]);
  });
});
