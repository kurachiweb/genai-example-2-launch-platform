import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { SPONSORSHIP_OFFER_REJECTION_MESSAGES } from '../../../lib/core/sponsorship/offer-rejection.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  type ApplySponsorshipInput,
  DefaultSponsorshipApplication,
} from './sponsorship-application.ts';
import {
  accountUnavailableError,
  type ApplicationFakeOptions,
  botVerificationFailedError,
  createApplicationFakes,
  emailNotVerifiedError,
  NOW,
  OTHER_USER_ID,
  PRODUCT_ID,
  PURCHASE_ID,
  rejectionOf,
  SESSION,
  SPONSORSHIP_ID,
  sponsorshipRecordOf,
  USER_ID,
} from './testing/sponsorship-application-fakes.ts';

const FIELDS: ApplySponsorshipInput = {
  productId: PRODUCT_ID,
  tier: 'gold',
  startsOn: '2026-12-01',
  endsOn: '2026-12-07',
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

function setup(options: ApplicationFakeOptions = {}) {
  const fakes = createApplicationFakes(options);
  const application = new DefaultSponsorshipApplication(
    fakes.guard,
    fakes.store,
    fakes.eligibleProducts,
    fakes.starter,
  );
  const apply = (fields: ApplySponsorshipInput = FIELDS) =>
    application.apply({
      session: SESSION,
      fields,
      humanCheck: fakes.humanCheck,
      now: NOW,
    });
  const resume = (sponsorshipId: string = SPONSORSHIP_ID) =>
    application.resume({
      session: SESSION,
      sponsorshipId,
      humanCheck: fakes.humanCheck,
      now: NOW,
    });
  return { ...fakes, apply, resume };
}

const callKindsOf = (calls: readonly { readonly kind: string }[]) =>
  calls.map(({ kind }) => kind);

describe('DefaultSponsorshipApplication.apply', () => {
  test('利用者の確認・bot判定・対象・重なりの判定の後に未決済の申込を記録し、その申込で決済を開始して購入IDを返す', async () => {
    const { apply, calls } = setup();

    const result = await apply();

    expect(result).toStrictEqual({ purchaseId: PURCHASE_ID });
    expect(calls).toStrictEqual([
      { kind: 'guard' },
      { kind: 'humanCheck' },
      {
        kind: 'isEligible',
        userId: USER_ID,
        productId: PRODUCT_ID,
        now: NOW,
      },
      {
        kind: 'hasPaidOverlap',
        input: {
          productId: PRODUCT_ID,
          tier: 'gold',
          startsOn: parseBusinessDate('2026-12-01'),
          endsOn: parseBusinessDate('2026-12-07'),
        },
      },
      {
        kind: 'create',
        input: {
          userId: USER_ID,
          productId: PRODUCT_ID,
          tier: 'gold',
          startsOn: parseBusinessDate('2026-12-01'),
          endsOn: parseBusinessDate('2026-12-07'),
          days: 7,
        },
        at: NOW,
      },
      {
        kind: 'start',
        input: {
          session: SESSION,
          kind: 'sponsorship',
          targetId: SPONSORSHIP_ID,
        },
      },
    ]);
  });

  test('日数を開始日と終了日を含めて数え、今日開始の366日の掲載期間を受け付ける', async () => {
    const { apply, calls } = setup();

    await apply({ ...FIELDS, startsOn: '2026-11-25', endsOn: '2027-11-25' });

    expect(calls.find((call) => call.kind === 'create')).toMatchObject({
      input: { days: 366 },
    });
  });

  test.each([
    ['停止中', accountUnavailableError()],
    ['メールアドレスの未確認', emailNotVerifiedError()],
  ])(
    '%sの利用者の拒否をそのまま返し、bot判定と申込の記録を行わない',
    async (_, guardError) => {
      const { apply, calls } = setup({ guardError });

      expect(await rejectionOf(apply())).toBe(guardError);
      expect(callKindsOf(calls)).toStrictEqual(['guard']);
    },
  );

  test('bot判定の検証に失敗したら、その例外を返し申込の判定と記録を行わない', async () => {
    const humanCheckError = botVerificationFailedError();
    const { apply, calls } = setup({ humanCheckError });

    expect(await rejectionOf(apply())).toBe(humanCheckError);
    expect(callKindsOf(calls)).toStrictEqual(['guard', 'humanCheck']);
  });

  test('bot判定の検証は掲載期間の検証より前に行う', async () => {
    const humanCheckError = botVerificationFailedError();
    const { apply } = setup({ humanCheckError });

    expect(await rejectionOf(apply({ ...FIELDS, startsOn: 'invalid' }))).toBe(
      humanCheckError,
    );
  });

  test('開始日と終了日の違反を項目ごとの詳細を持つvalidation_errorで返し、対象の判定と記録を行わない', async () => {
    const { apply, calls } = setup();

    const error = await rejectionOf(
      apply({ ...FIELDS, startsOn: '2026-11-24', endsOn: '2027-11-25' }),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      kind: 'bad_request',
      code: 'validation_error',
      details: [
        {
          field: 'startsOn',
          code: 'past',
          message: '開始日は今日から1年以内の日付を選んでください。',
        },
        {
          field: 'endsOn',
          code: 'too_long',
          message:
            '終了日は開始日から366日以内の、開始日以降の日付を選んでください。',
        },
      ],
    });
    expect(callKindsOf(calls)).toStrictEqual(['guard', 'humanCheck']);
  });

  test.each([
    [
      '365日後より後の開始日',
      { startsOn: '2027-11-26', endsOn: '2027-11-26' },
      [{ field: 'startsOn', code: 'too_far' }],
    ],
    [
      '開始日より前の終了日',
      { startsOn: '2026-12-02', endsOn: '2026-12-01' },
      [{ field: 'endsOn', code: 'before_start' }],
    ],
    [
      '形式の違う日付',
      { startsOn: '2026-02-30', endsOn: '20261201' },
      [
        { field: 'startsOn', code: 'invalid' },
        { field: 'endsOn', code: 'invalid' },
      ],
    ],
  ])('%sは違反の項目の詳細だけを返す', async (_, period, details) => {
    const { apply } = setup();

    const error = await rejectionOf(apply({ ...FIELDS, ...period }));

    expect(error).toMatchObject({ code: 'validation_error', details });
    expect((error as AppError).details).toHaveLength(details.length);
  });

  test('申込の対象でないプロダクトはsponsorship_product_ineligibleで拒否し、重なりの判定と記録を行わない', async () => {
    const { apply, calls } = setup({ eligible: false });

    const error = await rejectionOf(apply());

    expect(error).toMatchObject({
      kind: 'unprocessable',
      code: 'sponsorship_product_ineligible',
      message:
        SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_product_ineligible,
    });
    expect(callKindsOf(calls)).toStrictEqual([
      'guard',
      'humanCheck',
      'isEligible',
    ]);
  });

  test('同じプロダクト・同じティアの決済済みの広告と重なればsponsorship_overlapで拒否し、記録しない', async () => {
    const { apply, calls } = setup({ overlaps: true });

    const error = await rejectionOf(apply());

    expect(error).toMatchObject({
      kind: 'conflict',
      code: 'sponsorship_overlap',
      message: SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_overlap,
    });
    expect(callKindsOf(calls)).not.toContain('create');
  });

  test('決済の開始に失敗したら、記録した未決済の申込を消してから決済の開始の例外を返す', async () => {
    const startError = new AppError({
      kind: 'unavailable',
      code: 'payments_unavailable',
      message: '現在、決済を利用できません。',
      retryAfterSeconds: 60,
    });
    const { apply, calls } = setup({ startError });

    expect(await rejectionOf(apply())).toBe(startError);
    expect(calls.at(-1)).toStrictEqual({
      kind: 'deleteUnpaid',
      id: SPONSORSHIP_ID,
    });
    expect(records).toStrictEqual([]);
  });

  test('申込の削除にも失敗したら、申込のIDだけを警告に残して決済の開始の例外を返す', async () => {
    const startError = new Error('決済の開始の失敗');
    const deleteError = new Error('D1の障害');
    const { apply } = setup({ startError, deleteError });

    expect(await rejectionOf(apply())).toBe(startError);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'warning',
      category: ['api', 'application', 'sponsorship'],
      properties: { sponsorshipId: SPONSORSHIP_ID, error: deleteError },
    });
  });
});

describe('DefaultSponsorshipApplication.resume', () => {
  test('利用者の確認とbot判定の後に本人の未決済の申込を読み、その申込で決済を開始して購入IDを返す', async () => {
    const { resume, calls } = setup();

    const result = await resume();

    expect(result).toStrictEqual({ purchaseId: PURCHASE_ID });
    expect(calls).toStrictEqual([
      { kind: 'guard' },
      { kind: 'humanCheck' },
      { kind: 'findById', id: SPONSORSHIP_ID },
      {
        kind: 'start',
        input: {
          session: SESSION,
          kind: 'sponsorship',
          targetId: SPONSORSHIP_ID,
        },
      },
    ]);
  });

  test('開始日が今日の未決済の申込は決済を再開できる', async () => {
    const { resume } = setup({
      found: sponsorshipRecordOf({
        startsOn: parseBusinessDate('2026-11-25'),
      }),
    });

    expect(await resume()).toStrictEqual({ purchaseId: PURCHASE_ID });
  });

  test('停止中の利用者の拒否をそのまま返し、bot判定と申込の読み取りを行わない', async () => {
    const guardError = accountUnavailableError();
    const { resume, calls } = setup({ guardError });

    expect(await rejectionOf(resume())).toBe(guardError);
    expect(callKindsOf(calls)).toStrictEqual(['guard']);
  });

  test('bot判定の検証に失敗したら、申込を読まずにその例外を返す', async () => {
    const humanCheckError = botVerificationFailedError();
    const { resume, calls } = setup({ humanCheckError });

    expect(await rejectionOf(resume())).toBe(humanCheckError);
    expect(callKindsOf(calls)).toStrictEqual(['guard', 'humanCheck']);
  });

  test.each([
    ['存在しない・論理削除済みの申込', undefined],
    ['他人の申込', sponsorshipRecordOf({ userId: OTHER_USER_ID })],
  ])(
    '%sはsponsorship_not_foundで拒否し、決済を開始しない',
    async (_, found) => {
      const { resume, calls } = setup({ found });

      const error = await rejectionOf(resume());

      expect(error).toMatchObject({
        kind: 'not_found',
        code: 'sponsorship_not_found',
        message: 'この申込は見つかりませんでした。',
      });
      expect(callKindsOf(calls)).not.toContain('start');
    },
  );

  test.each([
    [
      '決済済みの申込',
      sponsorshipRecordOf({
        state: 'paid',
        purchaseId: PURCHASE_ID,
        amountTotal: 5600,
        paidAt: NOW,
      }),
    ],
    [
      '強制終了した申込',
      sponsorshipRecordOf({ state: 'terminated', terminatedAt: NOW }),
    ],
    [
      '開始日を過ぎた未決済の申込',
      sponsorshipRecordOf({ startsOn: parseBusinessDate('2026-11-24') }),
    ],
  ])(
    '%sはsponsorship_not_payableで拒否し、決済を開始しない',
    async (_, found) => {
      const { resume, calls } = setup({ found });

      const error = await rejectionOf(resume());

      expect(error).toMatchObject({
        kind: 'conflict',
        code: 'sponsorship_not_payable',
        message: SPONSORSHIP_OFFER_REJECTION_MESSAGES.sponsorship_not_payable,
      });
      expect(callKindsOf(calls)).not.toContain('start');
    },
  );

  test('決済の開始に失敗しても、再開した申込を消さずに例外を返す', async () => {
    const startError = new Error('決済の開始の失敗');
    const { resume, calls } = setup({ startError });

    expect(await rejectionOf(resume())).toBe(startError);
    expect(callKindsOf(calls)).not.toContain('deleteUnpaid');
  });
});
