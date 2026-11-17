import { describe, expect, test } from 'bun:test';

import { createUltrasActivationRegistry } from '../../lib/core/ultras/activation-contract.ts';
import { EVENT_WEEK_TOURNAMENT_TYPES } from '../application/week-tournament/event-week-tournament-types.ts';
import { ULTRAS_ACTIVATION_HANDLERS } from './ultras-activation-handlers.ts';

describe('加入が有効になった知らせの処理の登録口', () => {
  test('登録は<spec名>.<名詞句>の名前とorderが重複せず、検証を通る凍結済みの配列である', () => {
    expect(Object.isFrozen(ULTRAS_ACTIVATION_HANDLERS)).toBe(true);
    expect(() =>
      createUltrasActivationRegistry(ULTRAS_ACTIVATION_HANDLERS),
    ).not.toThrow();
  });

  // 失効より先に付与することで、失効の前に完了していた決済の反映を参加資格の付与済みとして拒否させる
  test('tournament-weekは1500で参加費の免除を、1510で未完了の参加費の決済の失効を登録し、免除が先に呼ばれる', () => {
    expect(
      createUltrasActivationRegistry(ULTRAS_ACTIVATION_HANDLERS).filter(
        ({ name }) => name.startsWith('tournament-week.'),
      ),
    ).toStrictEqual([
      {
        name: 'tournament-week.ultras-entry-exemption',
        order: 1500,
        handler: EVENT_WEEK_TOURNAMENT_TYPES.WeekUltrasEntryExemptionHandler,
      },
      {
        name: 'tournament-week.open-entry-checkout-expiry',
        order: 1510,
        handler: EVENT_WEEK_TOURNAMENT_TYPES.WeekOpenEntryCheckoutExpiryHandler,
      },
    ]);
  });
});
