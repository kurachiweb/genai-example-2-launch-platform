import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { SPONSORSHIP_OFFER_REJECTION_MESSAGES } from '../../../lib/core/sponsorship/offer-rejection.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import { DefaultSponsorshipOfferReader } from './sponsorship-offer-reader.ts';
import {
  CURRENT_USER,
  NOW,
  PRODUCT_ID,
  rejectionOf,
  SESSION,
  TODAY,
  USER_ID,
} from './testing/sponsorship-application-fakes.ts';
import {
  createReaderFakes,
  ELIGIBLE_PRODUCT,
  paymentsUnavailableError,
  type ReaderFakeOptions,
  stripePriceOf,
  unauthenticatedError,
} from './testing/sponsorship-reader-fakes.ts';

const NEXT_DAY_STARTS_AT = new Date('2026-11-26T08:00:00.000Z');

const ALL_PRICES = {
  prices: [
    stripePriceOf('sponsorship_legend_daily', 5000),
    stripePriceOf('sponsorship_gold_daily', 2000),
    stripePriceOf('sponsorship_silver_daily', 800),
  ],
  stale: false,
};

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

function setup(options: ReaderFakeOptions = {}) {
  const fakes = createReaderFakes(options);
  const reader = new DefaultSponsorshipOfferReader(
    fakes.guard,
    fakes.prices,
    fakes.eligibleProducts,
    fakes.store,
  );
  const readWindow = (
    startsOn: string | null,
    now: Date = NOW,
  ): ReturnType<DefaultSponsorshipOfferReader['readPeriodWindow']> =>
    reader.readPeriodWindow({
      session: SESSION,
      productId: PRODUCT_ID,
      tier: 'gold',
      startsOn,
      now,
    });
  return { ...fakes, reader, readWindow };
}

describe('料金と申込の対象の照会', () => {
  test('3つのティアの1日あたりの単価を、3つの価格の照会1回からLegend・Gold・Silverの順に返す', async () => {
    const { reader, calls } = setup({ prices: ALL_PRICES });

    const view = await reader.read({ viewer: undefined, now: NOW });

    expect(view.tiers).toEqual([
      { tier: 'legend', unitPrice: { amount: 5000, currency: 'usd' } },
      { tier: 'gold', unitPrice: { amount: 2000, currency: 'usd' } },
      { tier: 'silver', unitPrice: { amount: 800, currency: 'usd' } },
    ]);
    expect(calls.filter(({ kind }) => kind === 'getPrices')).toEqual([
      {
        kind: 'getPrices',
        lookupKeys: [
          'sponsorship_legend_daily',
          'sponsorship_gold_daily',
          'sponsorship_silver_daily',
        ],
      },
    ]);
  });

  test('価格を取得できなければ全てのティアの単価を空にし、申込の対象は返す', async () => {
    const { reader } = setup({ pricesError: paymentsUnavailableError() });

    const view = await reader.read({ viewer: CURRENT_USER, now: NOW });

    expect(view.tiers).toEqual([
      { tier: 'legend', unitPrice: null },
      { tier: 'gold', unitPrice: null },
      { tier: 'silver', unitPrice: null },
    ]);
    expect(view.eligibleProducts).toEqual([ELIGIBLE_PRODUCT]);
  });

  test('照会の結果に無い価格のティアだけ単価を空にし、警告のログに価格の名前だけを残す', async () => {
    const { reader } = setup({
      prices: {
        prices: [stripePriceOf('sponsorship_gold_daily', 2000)],
        stale: true,
      },
    });

    const view = await reader.read({ viewer: undefined, now: NOW });

    expect(view.tiers).toEqual([
      { tier: 'legend', unitPrice: null },
      { tier: 'gold', unitPrice: { amount: 2000, currency: 'usd' } },
      { tier: 'silver', unitPrice: null },
    ]);
    expect(
      records.map(({ level, properties }) => ({ level, properties })),
    ).toEqual([
      {
        level: 'warning',
        properties: {
          priceLookups: [
            'sponsorship_legend_daily',
            'sponsorship_silver_daily',
          ],
          stale: true,
        },
      },
    ]);
  });

  test('決済を利用できない以外の価格の照会の失敗は、そのまま返す', async () => {
    const failure = new Error('想定外の失敗');
    const { reader } = setup({ pricesError: failure });

    expect(
      await rejectionOf(reader.read({ viewer: undefined, now: NOW })),
    ).toBe(failure);
  });

  test('未ログインでは申込の対象を照会せず空(null)にする', async () => {
    const { reader, calls } = setup({ prices: ALL_PRICES });

    const view = await reader.read({ viewer: undefined, now: NOW });

    expect(view.eligibleProducts).toBeNull();
    expect(calls.some(({ kind }) => kind === 'list')).toBe(false);
  });

  test('ログイン中は本人の申込の対象のプロダクトを返す', async () => {
    const { reader, calls } = setup({ prices: ALL_PRICES });

    const view = await reader.read({ viewer: CURRENT_USER, now: NOW });

    expect(view.eligibleProducts).toEqual([ELIGIBLE_PRODUCT]);
    expect(calls).toContainEqual({ kind: 'list', userId: USER_ID, now: NOW });
  });
});

describe('掲載期間の選べる範囲の照会', () => {
  test('ログインしていなければ、申込の対象を確かめずに拒否する', async () => {
    const guardError = unauthenticatedError();
    const { readWindow, calls } = setup({ guardError });

    expect(await rejectionOf(readWindow(null))).toBe(guardError);
    expect(calls).toEqual([{ kind: 'requireUser' }]);
  });

  test('申込の対象でないプロダクトは、掲載期間を照会せずに対象外の拒否にする', async () => {
    const { readWindow, calls } = setup({ eligible: false });

    const error = await rejectionOf(readWindow('2026-12-01'));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'unprocessable',
      code: 'sponsorship_product_ineligible',
      message:
        SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_product_ineligible,
    });
    expect(calls).toEqual([
      { kind: 'requireUser' },
      { kind: 'isEligible', userId: USER_ID, productId: PRODUCT_ID, now: NOW },
    ]);
  });

  test.each(['2026-12-1', '2026-13-01', '2026-02-30', ''])(
    '開始日の%pは形式違反のエラーにし、掲載期間を照会しない',
    async (startsOn) => {
      const { readWindow, calls } = setup();

      const error = await rejectionOf(readWindow(startsOn));

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'bad_request',
        code: 'validation_error',
        details: [
          {
            field: 'startsOn',
            code: 'invalid',
            message: '開始日は今日から1年以内の日付を選んでください。',
          },
        ],
      });
      expect(calls.some(({ kind }) => kind === 'listPaidPeriods')).toBe(false);
    },
  );

  test('開始日を渡さなければ、今日以降に掛かる決済済みの期間から開始日の範囲だけを返し、次の0:00の時点を添える', async () => {
    const { readWindow, calls } = setup({
      paidPeriods: [
        {
          startsOn: parseBusinessDate('2026-12-10'),
          endsOn: parseBusinessDate('2026-12-12'),
        },
      ],
    });

    const view = await readWindow(null);

    expect(view).toEqual({
      businessToday: TODAY,
      nextDayStartsAt: NEXT_DAY_STARTS_AT,
      start: {
        earliest: '2026-11-25',
        latest: '2027-11-25',
        unavailable: [
          { from: '2026-12-10', to: '2026-12-12', reason: 'overlap' },
        ],
      },
      end: null,
    });
    expect(calls).toContainEqual({
      kind: 'listPaidPeriods',
      input: { productId: PRODUCT_ID, tier: 'gold', endsOnOrAfter: TODAY },
    });
  });

  test('選べる開始日を渡すと、後に続く決済済みの期間の前日までの終了日の範囲を返す', async () => {
    const { readWindow } = setup({
      paidPeriods: [
        {
          startsOn: parseBusinessDate('2026-12-10'),
          endsOn: parseBusinessDate('2026-12-12'),
        },
      ],
    });

    const view = await readWindow('2026-12-01');

    expect(view.end).toEqual({
      earliest: '2026-12-01',
      latest: '2026-12-09',
      unavailable: [
        { from: '2026-12-10', to: '2027-12-01', reason: 'overlap' },
      ],
    });
  });

  test.each([
    ['決済済みの期間の中', '2026-12-11'],
    ['今日より前', '2026-11-24'],
    ['今日から365日より後', '2027-11-26'],
  ])(
    '選べない開始日(%s)はエラーにせず終了日の範囲を返さない',
    async (_label, startsOn) => {
      const { readWindow } = setup({
        paidPeriods: [
          {
            startsOn: parseBusinessDate('2026-12-10'),
            endsOn: parseBusinessDate('2026-12-12'),
          },
        ],
      });

      const view = await readWindow(startsOn);

      expect(view.end).toBeNull();
      expect(view.start.earliest).toBe('2026-11-25');
    },
  );

  test('0:00ちょうどの照会では、その日を今日とし翌日の0:00を次の0:00の時点にする', async () => {
    const { readWindow, calls } = setup();
    const midnight = fromBusinessDateTime(TODAY, { hour: 0, minute: 0 });

    const view = await readWindow(null, midnight);

    expect(view.businessToday).toBe(TODAY);
    expect(view.nextDayStartsAt).toEqual(NEXT_DAY_STARTS_AT);
    expect(calls).toContainEqual({
      kind: 'listPaidPeriods',
      input: { productId: PRODUCT_ID, tier: 'gold', endsOnOrAfter: TODAY },
    });
  });

  test('停止中・未確認の利用者にもログインだけを確かめて答える', async () => {
    const { readWindow, calls } = setup();

    await readWindow(null);

    expect(calls[0]).toEqual({ kind: 'requireUser' });
  });
});
