import { describe, expect, test } from 'bun:test';

import {
  ALIVE_ENTRY,
  CHAMPION_ENTRY,
  CLOSED_AWAITING_ENTRY,
  closedEntryOf,
  EXEMPT_AWAITING_ENTRY,
  PAID_ENTITLED_ENTRY,
  ULTRAS_ENTITLED_ENTRY,
  weekEntryOf,
} from './week-entry-fixtures.ts';
import { hasWeekEntryDeleteNotice } from './week-entry-model.ts';

describe('hasWeekEntryDeleteNotice', () => {
  test.each([
    ['受付期限より前の支払い待ち', weekEntryOf()],
    ['受付期限の後で組み合わせ決定の前の支払い待ち', CLOSED_AWAITING_ENTRY],
    ['Ultrasの特典で免除される支払い待ち', EXEMPT_AWAITING_ENTRY],
    ['決済で参加資格を得た枠', PAID_ENTITLED_ENTRY],
    ['Ultrasの特典で参加資格を得た枠', ULTRAS_ENTITLED_ENTRY],
  ])('%sは削除の注意書きを出す', (_name, entry) => {
    expect(hasWeekEntryDeleteNotice(entry)).toBe(true);
  });

  test.each([
    ['枠が無い', null],
    ['組み合わせに入った枠', ALIVE_ENTRY],
    ['優勝した枠', CHAMPION_ENTRY],
    ['期限切れの枠', closedEntryOf('EXPIRED', 'DEADLINE')],
    ['喪失した枠', closedEntryOf('FORFEITED', 'DELETED')],
    ['除外された枠', closedEntryOf('EXCLUDED', 'HIDDEN_OR_SUSPENDED')],
  ])('%sは削除の注意書きを出さない', (_name, entry) => {
    expect(hasWeekEntryDeleteNotice(entry)).toBe(false);
  });
});
