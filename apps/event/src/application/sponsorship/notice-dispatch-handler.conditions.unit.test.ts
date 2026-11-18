import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type {
  SponsorshipRecord,
  SponsorshipRefundRecord,
} from '../../../lib/core/sponsorship/ports.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import {
  startLogCapture,
  stopLogCapture,
} from '../email/email-log-capture.fixtures.ts';
import type { PendingSponsorshipNotice } from './ports.ts';
import {
  CLIENT_SITE_ORIGIN,
  CONTACT,
  createDispatchHarness,
  type DispatchCall,
  type DispatchScenario,
  keyOf,
  MESSAGE_META,
  NO_REFUND,
  noticeOf,
  NOW,
  PRODUCT_ID,
  PRODUCT_NAME,
  recordOf,
  REQUEST_BODY,
  sponsorshipIdOf,
} from './testing/notice-dispatch-fakes.ts';

const LIST_URL = `${CLIENT_SITE_ORIGIN}/settings/sponsorships`;

const LEGAL_URL = `${CLIENT_SITE_ORIGIN}/legal`;

const TERMINATION_REASON = '広告の内容が掲載の基準に合わないため';

// 掲載終了日を過ぎた広告(11月18日〜11月24日)
const ENDED_PERIOD = {
  startsOn: parseBusinessDate('2026-11-18'),
  endsOn: parseBusinessDate('2026-11-24'),
  days: 7,
} as const;

// 基準時刻(UTC-08:00)の2026-11-26 23:59
const TERMINATED_AT = new Date('2026-11-27T07:59:00.000Z');

function requested(
  days: number,
  amount: number | null,
): SponsorshipRefundRecord {
  return {
    status: 'requested',
    days,
    amount,
    refundRequestId: `refund-${String(days)}`,
  };
}

function terminatedRecord(
  overrides: Partial<SponsorshipRecord> = {},
): SponsorshipRecord {
  return recordOf(1, {
    state: 'terminated',
    terminatedAt: TERMINATED_AT,
    terminationReason: TERMINATION_REASON,
    ...overrides,
  });
}

interface DispatchOutcome {
  readonly calls: readonly DispatchCall[];
  readonly sent: readonly Extract<DispatchCall, { op: 'send' }>[];
  readonly skipped: readonly string[];
}

async function dispatchOne(
  notice: PendingSponsorshipNotice,
  scenario: Omit<DispatchScenario, 'pending'>,
): Promise<DispatchOutcome> {
  const { handler, calls } = createDispatchHarness({
    pending: [notice],
    ...scenario,
  });
  const result = await handler.handle(REQUEST_BODY, MESSAGE_META);
  expect(result).toStrictEqual({ kind: 'done' });
  return {
    calls,
    sent: calls.flatMap((call) => (call.op === 'send' ? [call] : [])),
    skipped: calls.flatMap((call) =>
      call.op === 'markSkipped' ? [call.key] : [],
    ),
  };
}

async function expectSkipped(
  notice: PendingSponsorshipNotice,
  scenario: Omit<DispatchScenario, 'pending'>,
): Promise<void> {
  const { sent, skipped, calls } = await dispatchOne(notice, scenario);
  expect(sent).toStrictEqual([]);
  expect(skipped).toStrictEqual([keyOf(notice)]);
  expect(calls.findIndex((call) => call.op === 'claim')).toBeLessThan(
    calls.findIndex((call) => call.op === 'markSkipped'),
  );
}

beforeEach(() => {
  startLogCapture();
});

afterEach(() => {
  stopLogCapture();
});

describe('掲載開始通知の送信の時点の条件', () => {
  const START = noticeOf(1, 'start');

  test('強制終了された広告には送らない', async () => {
    await expectSkipped(START, { records: [terminatedRecord()] });
  });

  test('プロダクトの非公開化・投稿者の停止で表示を止めている広告には送らない', async () => {
    await expectSkipped(START, {
      records: [recordOf(1)],
      products: { [PRODUCT_ID]: 'hidden' },
    });
  });

  test('論理削除された申込には送らない', async () => {
    await expectSkipped(START, {
      records: [recordOf(1)],
      deleted: [sponsorshipIdOf(1)],
    });
  });

  test('プロダクトが論理削除された広告には送らない', async () => {
    await expectSkipped(START, {
      records: [recordOf(1, { productDeletedAt: NOW })],
      products: {},
    });
  });

  test('掲載期間が過ぎた広告には送らない', async () => {
    await expectSkipped(START, {
      records: [recordOf(1, ENDED_PERIOD)],
    });
  });

  test('掲載終了日の当日までは送る', async () => {
    const { sent } = await dispatchOne(START, {
      records: [
        recordOf(1, {
          startsOn: parseBusinessDate('2026-11-25'),
          endsOn: parseBusinessDate('2026-11-25'),
          days: 1,
        }),
      ],
    });

    expect(sent.map(({ kind }) => kind)).toStrictEqual([
      'sponsorship.start-notice',
    ]);
  });

  test('宛先が無い(退会済みの)申込者には送らない', async () => {
    await expectSkipped(START, { records: [recordOf(1)], contacts: [] });
  });
});

describe('掲載終了通知の送信の時点の条件', () => {
  const END = noticeOf(1, 'end');

  test('退会済みの申込者(宛先が無い)には送らない', async () => {
    await expectSkipped(END, {
      records: [recordOf(1, ENDED_PERIOD)],
      contacts: [],
    });
  });

  test('論理削除された申込には送らない', async () => {
    await expectSkipped(END, {
      records: [recordOf(1, ENDED_PERIOD)],
      deleted: [sponsorshipIdOf(1)],
    });
  });

  test('申込にプロダクトの論理削除が記録されていれば、プロダクトを引かずに送らない', async () => {
    const { calls } = await dispatchOne(END, {
      records: [recordOf(1, { ...ENDED_PERIOD, productDeletedAt: NOW })],
    });

    expect(calls.some((call) => call.op === 'findSummaries')).toBe(false);
    expect(calls.some((call) => call.op === 'send')).toBe(false);
  });

  test('プロダクトが論理削除されていれば送らない', async () => {
    await expectSkipped(END, {
      records: [recordOf(1, ENDED_PERIOD)],
      products: {},
    });
  });

  test('強制終了された広告には送らない', async () => {
    await expectSkipped(END, {
      records: [terminatedRecord(ENDED_PERIOD)],
    });
  });

  test('非公開化したプロダクトの広告にも、論理削除していなければ送る', async () => {
    const { sent, calls } = await dispatchOne(END, {
      records: [recordOf(1, ENDED_PERIOD)],
      products: { [PRODUCT_ID]: 'hidden' },
    });

    expect(calls).toContainEqual({
      op: 'findSummaries',
      productIds: [PRODUCT_ID],
      scope: 'not-deleted',
    });
    expect(sent.map(({ kind }) => kind)).toStrictEqual([
      'sponsorship.end-notice',
    ]);
  });
});

describe('強制終了の通知の送信の時点の条件', () => {
  const TERMINATION = noticeOf(1, 'termination');

  test('論理削除された申込には送らない', async () => {
    await expectSkipped(TERMINATION, {
      records: [terminatedRecord()],
      deleted: [sponsorshipIdOf(1)],
    });
  });

  test('強制終了されていない申込には送らない', async () => {
    await expectSkipped(TERMINATION, { records: [recordOf(1)] });
  });

  test('プロダクトが論理削除されていれば名称を示せないため送らない', async () => {
    await expectSkipped(TERMINATION, {
      records: [terminatedRecord()],
      products: {},
    });
  });

  test('宛先が無い申込者には送らない', async () => {
    await expectSkipped(TERMINATION, {
      records: [terminatedRecord()],
      contacts: [],
    });
  });
});

describe('通知の入力の返金', () => {
  const BASE_INPUT = {
    nickname: CONTACT.nickname,
    productName: PRODUCT_NAME,
    tierLabel: 'Gold',
    listUrl: LIST_URL,
  } as const;

  test('掲載終了通知には依頼済みの表示停止の返金の日数と、ドルの表記の金額を渡す', async () => {
    const { sent } = await dispatchOne(noticeOf(1, 'end'), {
      records: [
        recordOf(1, { ...ENDED_PERIOD, stopRefund: requested(2, 2_000) }),
      ],
    });

    expect(sent).toStrictEqual([
      {
        op: 'send',
        kind: 'sponsorship.end-notice',
        to: CONTACT.email,
        input: {
          ...BASE_INPUT,
          startsOn: '2026-11-18',
          endsOn: '2026-11-24',
          days: 7,
          stopRefund: { days: 2, amount: '$20.00' },
        },
      },
    ]);
  });

  test('残りの全額で依頼した返金は金額を「残りの全額」として渡す', async () => {
    const { sent } = await dispatchOne(noticeOf(1, 'end'), {
      records: [
        recordOf(1, { ...ENDED_PERIOD, stopRefund: requested(3, null) }),
      ],
    });

    expect(sent[0]?.input).toMatchObject({
      stopRefund: { days: 3, amount: '残りの全額' },
    });
  });

  test.each([
    ['未精算', NO_REFUND],
    [
      '返金不要',
      { status: 'not_needed', days: 0, amount: 0, refundRequestId: null },
    ],
    [
      '返金済み',
      {
        status: 'already_refunded',
        days: 2,
        amount: 2_000,
        refundRequestId: null,
      },
    ],
    [
      '拒否',
      { status: 'rejected', days: 2, amount: 2_000, refundRequestId: 'refund' },
    ],
  ] as const)(
    '%sの表示停止の返金は掲載終了通知に渡さない',
    async (_label, stopRefund) => {
      const { sent } = await dispatchOne(noticeOf(1, 'end'), {
        records: [recordOf(1, { ...ENDED_PERIOD, stopRefund })],
      });

      expect(sent[0]?.input).toMatchObject({ stopRefund: null });
    },
  );

  test('強制終了の通知には強制終了日・理由・法的通知のURLと、依頼済みの2つの返金だけを渡す', async () => {
    const { sent } = await dispatchOne(noticeOf(1, 'termination'), {
      records: [
        terminatedRecord({
          terminationRefund: requested(5, 5_000),
          stopRefund: requested(1, 1_005),
        }),
      ],
      products: { [PRODUCT_ID]: 'hidden' },
    });

    expect(sent).toStrictEqual([
      {
        op: 'send',
        kind: 'sponsorship.termination-notice',
        to: CONTACT.email,
        input: {
          ...BASE_INPUT,
          startsOn: '2026-11-25',
          endsOn: '2026-12-01',
          days: 7,
          terminatedOn: '2026-11-26',
          reason: TERMINATION_REASON,
          legalUrl: LEGAL_URL,
          terminationRefund: { days: 5, amount: '$50.00' },
          stopRefund: { days: 1, amount: '$10.05' },
        },
      },
    ]);
  });

  test('強制終了の返金を残りの全額で依頼し、表示停止の返金が返金済みなら、強制終了の返金だけを渡す', async () => {
    const { sent } = await dispatchOne(noticeOf(1, 'termination'), {
      records: [
        terminatedRecord({
          terminationRefund: requested(5, null),
          stopRefund: {
            status: 'already_refunded',
            days: 1,
            amount: 1_000,
            refundRequestId: null,
          },
        }),
      ],
    });

    expect(sent[0]?.input).toMatchObject({
      terminationRefund: { days: 5, amount: '残りの全額' },
      stopRefund: null,
    });
  });

  test('ティアの表示名を渡す', async () => {
    const { sent } = await dispatchOne(noticeOf(1, 'start'), {
      records: [recordOf(1, { tier: 'legend' })],
    });

    expect(sent[0]?.input).toMatchObject({ tierLabel: 'Legend' });
  });
});
