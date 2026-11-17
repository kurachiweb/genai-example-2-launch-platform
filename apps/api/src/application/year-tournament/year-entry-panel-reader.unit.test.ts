import { describe, expect, test } from 'bun:test';

import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import {
  defaultFinalDate,
  YEAR_ENTRY_PRICE_LOOKUP_KEY,
  yearScheduleFor,
} from '../../../lib/core/year-tournament/year-schedule.ts';
import { launchRecordOf } from '../match/testing/kickoff-fakes.ts';
import {
  AWARDED_AT,
  DRAWING_YEAR_ROW,
  entryOf,
  launchIdOf,
  productIdOf,
  STORED_SCHEDULE,
  YEAR,
  yearRowOf,
} from './testing/year-decision-fakes.ts';
import {
  AFTER_ACCEPT_UNTIL,
  AFTER_DEADLINE,
  createPanelFakes,
  ENTRY_PRICE,
  HANDLE,
  NOW,
  OPEN_YEAR_ROW,
  OTHER_USER_ID,
  OWNER_USER_ID,
  PAYMENTS_UNAVAILABLE,
  PRODUCT,
  rejectionOf,
  VIEWER,
  WON_LAUNCH,
} from './testing/year-entry-panel-fakes.ts';

describe('DirectoryYearEntryPanelReader 対象の枠', () => {
  test('形式に合わないハンドルは照会をせずにnullを返す', async () => {
    const { reader, reads } = createPanelFakes();

    expect(await reader.readForOwner(VIEWER, 'Not A Handle!', NOW)).toBeNull();
    expect(reads.handleReads).toEqual([]);
  });

  test('存在しないプロダクトはnullを返す', async () => {
    const { reader, reads } = createPanelFakes({
      resolution: { kind: 'none' },
    });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
    expect(reads.launchReads).toEqual([]);
  });

  test('本人でないプロダクトはローンチも枠も読まずにnullを返す', async () => {
    const { reader, reads } = createPanelFakes({
      resolution: {
        kind: 'current',
        product: { ...PRODUCT, ownerUserId: OTHER_USER_ID },
      },
      entries: [entryOf(1, 'awaiting_payment')],
    });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
    expect(reads.launchReads).toEqual([]);
    expect(reads.entryReads).toEqual([]);
  });

  test('旧ハンドルは本人のプロダクトでもnullを返す', async () => {
    const { reader } = createPanelFakes({
      resolution: { kind: 'previous', product: PRODUCT },
      entries: [entryOf(1, 'awaiting_payment')],
    });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
  });

  test('枠の無いプロダクトは年の日程を読まずにnullを返す', async () => {
    const { reader, reads } = createPanelFakes({ entries: [] });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
    expect(reads.entryReads).toEqual([[launchIdOf(1)]]);
    expect(reads.calendarReads).toEqual([]);
  });

  test('ローンチの無いプロダクトは枠を読まずにnullを返す', async () => {
    const { reader, reads } = createPanelFakes({ launches: [] });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
    expect(reads.entryReads).toEqual([]);
  });

  test('取消を除いた直近のローンチの枠を読み、古いローンチの枠は返さない', async () => {
    const canceled = launchRecordOf(launchIdOf(3), productIdOf(1), {
      number: 0,
      launchDate: parseBusinessDate('2027-03-20'),
      status: 'canceled',
    });
    const latest = launchRecordOf(launchIdOf(2), productIdOf(1), {
      launchDate: parseBusinessDate('2027-03-17'),
      status: 'scheduled',
    });
    const { reader, reads } = createPanelFakes({
      launches: [canceled, latest, WON_LAUNCH],
      entries: [entryOf(1, 'awaiting_payment')],
    });

    expect(await reader.readForOwner(VIEWER, HANDLE, NOW)).toBeNull();
    expect(reads.launchReads).toEqual([
      { productIds: [productIdOf(1)], now: NOW },
    ]);
    expect(reads.entryReads).toEqual([[launchIdOf(2)]]);
  });

  test('直近のローンチの枠とローンチのIDを返す', async () => {
    const entry = entryOf(1, 'awaiting_payment');
    const { reader, reads } = createPanelFakes({
      launches: [
        launchRecordOf(launchIdOf(9), productIdOf(1), { status: 'canceled' }),
        WON_LAUNCH,
      ],
      entries: [entry],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.launchId).toBe(launchIdOf(1));
    expect(panel?.entry).toEqual(entry);
    expect(reads.handleReads).toEqual([HANDLE]);
  });
});

describe('DirectoryYearEntryPanelReader 対象年', () => {
  test('組み合わせ決定で終えていない枠はWeek優勝の日から求めた対象年を、日程を1回読んで返す', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.year).toMatchObject({
      year: YEAR,
      schedule: STORED_SCHEDULE,
      state: 'open',
      record: OPEN_YEAR_ROW,
    });
    expect(reads.calendarReads).toEqual([
      { years: [2026, 2027, 2028, 2029], now: NOW },
    ]);
  });

  test('対象年が凍結済みの終えていない枠は、その凍結済みの年を返す', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      years: [DRAWING_YEAR_ROW],
    });

    const panel = await reader.readForOwner(
      VIEWER,
      HANDLE,
      STORED_SCHEDULE.drawAt,
    );

    expect(panel?.year).toMatchObject({
      year: YEAR,
      state: 'frozen',
      record: DRAWING_YEAR_ROW,
    });
  });

  test('組み合わせ決定で終えた枠は分類した年の行を返す', async () => {
    const nextYearRow = yearRowOf({
      yearTournamentId: '01JF0YTRNM0000000000000002',
      year: YEAR + 1,
      schedule: yearScheduleFor(YEAR + 1, defaultFinalDate(YEAR + 1)),
    });
    const { reader, reads } = createPanelFakes({
      entries: [
        entryOf(1, 'expired', {
          closeReason: 'late_entry',
          classifiedYear: YEAR + 1,
        }),
      ],
      years: [OPEN_YEAR_ROW, nextYearRow],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.year).toMatchObject({ year: YEAR + 1, record: nextYearRow });
    expect(reads.calendarReads).toEqual([{ years: [YEAR + 1], now: NOW }]);
  });

  test('分類の前に資格を失い年を持たない枠は、Week優勝の日から対象年を求める', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [
        entryOf(1, 'forfeited', {
          closeReason: 'deleted',
          classifiedYear: null,
        }),
      ],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel?.year.year).toBe(YEAR);
    expect(reads.calendarReads).toEqual([
      { years: [2026, 2027, 2028, 2029], now: NOW },
    ]);
  });
});

describe('DirectoryYearEntryPanelReader 免除と参加費', () => {
  test('受付中で特典の期間外なら免除せず、参加費を返す', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel).toMatchObject({
      exempt: false,
      fee: { amount: 2000, currency: 'usd' },
      refundable: false,
      progress: null,
    });
    expect(reads.entitlementReads).toEqual([
      { userId: OWNER_USER_ID, from: AWARDED_AT, to: NOW },
    ]);
    expect(reads.priceReads).toEqual([[YEAR_ENTRY_PRICE_LOOKUP_KEY]]);
  });

  test('受付中でWeek優勝から現在までに特典を受けていれば免除し、参加費を読まない', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      entitledDuring: true,
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel).toMatchObject({ exempt: true, fee: null });
    expect(reads.priceReads).toEqual([]);
  });

  test('決済期限の後は特典の期間を保存した決済期限までで判定する', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, AFTER_DEADLINE);

    expect(reads.entitlementReads).toEqual([
      {
        userId: OWNER_USER_ID,
        from: AWARDED_AT,
        to: STORED_SCHEDULE.deadlineAt,
      },
    ]);
    expect(panel).toMatchObject({ exempt: false, fee: null });
    expect(reads.priceReads).toEqual([]);
  });

  test('受付期限の後は決済を始められないため参加費を読まない', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, AFTER_ACCEPT_UNTIL);

    expect(panel).toMatchObject({ exempt: false, fee: null });
    expect(reads.priceReads).toEqual([]);
  });

  test('特典の期間が空(Week優勝の日時が現在と決済期限の早い方より後)なら特典を問い合わせずに免除しない', async () => {
    const awardedDate = parseBusinessDate('2027-06-06');
    const awardedAt = fromBusinessDateTime(awardedDate, {
      hour: 12,
      minute: 0,
    });
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment', { awardedAt, awardedDate })],
    });

    const panel = await reader.readForOwner(
      VIEWER,
      HANDLE,
      new Date(awardedAt.getTime() - 60_000),
    );

    expect(panel?.exempt).toBe(false);
    expect(reads.entitlementReads).toEqual([]);
  });

  test('Ultrasの出どころで資格を得た枠は特典を問い合わせずに免除とする', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'entitled', { entitlementSource: 'ultras' })],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel).toMatchObject({ exempt: true, fee: null });
    expect(reads.entitlementReads).toEqual([]);
    expect(reads.priceReads).toEqual([]);
  });

  test('組み合わせに入ったUltrasの出どころの枠も免除とする', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'drawn', { entitlementSource: 'ultras' })],
      years: [DRAWING_YEAR_ROW],
    });

    expect((await reader.readForOwner(VIEWER, HANDLE, NOW))?.exempt).toBe(true);
  });

  test('決済で資格を得た枠は免除とせず、特典も参加費も読まない', async () => {
    const { reader, reads } = createPanelFakes({
      entries: [entryOf(1, 'entitled', { entitlementSource: 'payment' })],
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel).toMatchObject({ exempt: false, fee: null, progress: null });
    expect(reads.entitlementReads).toEqual([]);
    expect(reads.priceReads).toEqual([]);
  });

  test.each(['expired', 'forfeited', 'excluded'] as const)(
    '%sの枠は免除とせず、参加費も進行も返さない',
    async (status) => {
      const { reader, reads } = createPanelFakes({
        entries: [entryOf(1, status)],
      });

      const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

      expect(panel).toMatchObject({ exempt: false, fee: null, progress: null });
      expect(reads.entitlementReads).toEqual([]);
      expect(reads.priceReads).toEqual([]);
    },
  );

  test('決済サービスに到達できず保持した価格も無ければ、参加費をnullにして縮退する', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      prices: PAYMENTS_UNAVAILABLE,
    });

    const panel = await reader.readForOwner(VIEWER, HANDLE, NOW);

    expect(panel).toMatchObject({ exempt: false, fee: null });
    expect(panel?.year.year).toBe(YEAR);
  });

  test('照会の結果に参加費の価格が無ければ参加費をnullにする', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      prices: {
        prices: [{ ...ENTRY_PRICE, lookupKey: 'ultras_monthly' }],
        stale: false,
      },
    });

    expect((await reader.readForOwner(VIEWER, HANDLE, NOW))?.fee).toBeNull();
  });

  test('以前に照会した価格でも参加費として返す', async () => {
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      prices: { prices: [ENTRY_PRICE], stale: true },
    });

    expect((await reader.readForOwner(VIEWER, HANDLE, NOW))?.fee).toEqual({
      amount: 2000,
      currency: 'usd',
    });
  });

  test('決済サービスの到達の失敗以外の価格の照会の失敗はそのまま投げる', async () => {
    const failure = new Error('想定外の失敗');
    const { reader } = createPanelFakes({
      entries: [entryOf(1, 'awaiting_payment')],
      prices: failure,
    });

    expect(await rejectionOf(reader.readForOwner(VIEWER, HANDLE, NOW))).toBe(
      failure,
    );
  });
});
