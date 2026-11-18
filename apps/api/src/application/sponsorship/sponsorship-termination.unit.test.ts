import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import { AUDIT_REASON_MAX } from '../../../common-lib/admin/admin-input-rules.ts';
import { SPONSORSHIP_TERMINATE_ACTION } from '../../../common-lib/admin/audit-actions/sponsorship.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import { DefaultSponsorshipTermination } from './sponsorship-termination.ts';
import {
  NOW,
  PURCHASE_ID,
  SPONSORSHIP_ID,
  TODAY,
} from './testing/sponsorship-application-fakes.ts';
import { forbiddenError } from './testing/sponsorship-reader-fakes.ts';
import {
  AUDIT_ENTRY_ID,
  COMMITTED,
  createTerminationFakes,
  ESTIMATE,
  MODERATOR,
  paidRecordOf,
  refundOutcomeOf,
  type TerminationCall,
  type TerminationFakeOptions,
} from './testing/sponsorship-termination-fakes.ts';

const REASON = '規約に違反する表示のため';

const NOT_TERMINABLE_MESSAGE =
  'この広告は強制終了できません。一覧を再読み込みしてください。';

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

function setup(options: TerminationFakeOptions = {}) {
  const fakes = createTerminationFakes(options);
  const termination = new DefaultSponsorshipTermination(
    fakes.store,
    fakes.estimator,
    fakes.auditLog,
    fakes.writer,
    fakes.notices,
  );
  const preview = () =>
    termination.preview({
      requireRole: fakes.requireRole,
      sponsorshipId: SPONSORSHIP_ID,
      now: NOW,
    });
  const terminate = (reason: string = REASON) =>
    termination.terminate({
      requireRole: fakes.requireRole,
      sponsorshipId: SPONSORSHIP_ID,
      reason,
      now: NOW,
    });
  return { ...fakes, preview, terminate };
}

const kindsOf = (calls: readonly TerminationCall[]) =>
  calls.map(({ kind }) => kind);

const commitOf = (calls: readonly TerminationCall[]) => {
  const call = calls.find(({ kind }) => kind === 'commit');
  if (call?.kind !== 'commit') {
    throw new Error('確定の書き込みが呼ばれていません');
  }
  return call.input;
};

const NOT_TERMINABLE_RECORDS = [
  ['申込が無い', undefined],
  ['未決済', paidRecordOf({ state: 'pending_payment' })],
  ['強制終了済み', paidRecordOf({ state: 'terminated', terminatedAt: NOW })],
  [
    '終了日が昨日の終了',
    paidRecordOf({
      startsOn: parseBusinessDate('2026-11-10'),
      endsOn: parseBusinessDate('2026-11-24'),
      days: 15,
    }),
  ],
  [
    'プロダクトの論理削除で終了',
    paidRecordOf({ productDeletedAt: new Date('2026-11-20T00:00:00.000Z') }),
  ],
] as const;

describe('DefaultSponsorshipTermination.preview', () => {
  test('モデレーター以上を求め、未掲載日数・返金目安額・表示停止日数・表示停止の返金額を見積もりだけで返す', async () => {
    const estimate = {
      unexposedDays: 5,
      refundEstimate: 5000,
      stoppedDays: 2,
      stopRefundAmount: 2000,
    };
    const record = paidRecordOf({
      startsOn: parseBusinessDate('2026-11-20'),
      endsOn: parseBusinessDate('2026-11-29'),
      days: 10,
      amountTotal: 10000,
    });
    const { calls, preview } = setup({ record, estimate });

    const result = await preview();

    expect(result).toStrictEqual({
      sponsorshipId: SPONSORSHIP_ID,
      days: 10,
      amountTotal: 10000,
      ...estimate,
    });
    expect(calls).toStrictEqual([
      { kind: 'requireRole', minimum: 'moderator' },
      { kind: 'findById', id: SPONSORSHIP_ID },
      { kind: 'estimateTermination', record, today: TODAY },
    ]);
  });

  test('モデレーター未満は申込を読まずに拒否する', async () => {
    const { calls, preview } = setup({ roleError: forbiddenError() });

    expect(await preview().catch((cause: unknown) => cause)).toMatchObject({
      code: 'forbidden',
    });
    expect(kindsOf(calls)).toStrictEqual(['requireRole']);
  });

  test.each(NOT_TERMINABLE_RECORDS)(
    '%sの申込はsponsorship_not_terminableで拒否し、見積もらない',
    async (_, record) => {
      const { calls, preview } = setup({ record });

      const error = await preview().catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'conflict',
        code: 'sponsorship_not_terminable',
        message: NOT_TERMINABLE_MESSAGE,
      });
      expect(kindsOf(calls)).toStrictEqual(['requireRole', 'findById']);
    },
  );

  test('終了日が今日の掲載中の広告は強制終了の対象にする', async () => {
    const record = paidRecordOf({
      startsOn: parseBusinessDate('2026-11-20'),
      endsOn: TODAY,
      days: 6,
    });
    const { preview } = setup({ record });

    expect(await preview()).toMatchObject({
      sponsorshipId: SPONSORSHIP_ID,
    });
  });
});

describe('DefaultSponsorshipTermination.terminate', () => {
  test('モデレーター以上を求め、見積もり・監査の準備・確定・通知の送信の依頼の順に行う', async () => {
    const { calls, terminate } = setup();

    await terminate();

    expect(kindsOf(calls)).toStrictEqual([
      'requireRole',
      'findById',
      'estimateTermination',
      'prepare',
      'commit',
      'request',
    ]);
    expect(calls[0]).toStrictEqual({
      kind: 'requireRole',
      minimum: 'moderator',
    });
  });

  test('監査ログに操作した管理者・対象の申込・理由・日時と4つの詳細の値を文字列で記録する', async () => {
    const estimate = {
      unexposedDays: 5,
      refundEstimate: 5000,
      stoppedDays: 2,
      stopRefundAmount: 2000,
    };
    const { calls, terminate } = setup({ estimate });

    await terminate();

    const { audit } = commitOf(calls);
    expect(audit.id).toBe(AUDIT_ENTRY_ID);
    expect(audit.operatorAdminId).toBe(MODERATOR.id);
    expect(audit.action).toBe(SPONSORSHIP_TERMINATE_ACTION.name);
    expect(audit.targetKind).toBe('sponsorship');
    expect(audit.targetIds).toStrictEqual([SPONSORSHIP_ID]);
    expect(audit.reason).toBe(REASON);
    expect(audit.detail).toStrictEqual({
      unexposedDays: '5',
      refundEstimate: '5000',
      stoppedDays: '2',
      stopRefundAmount: '2000',
    });
    expect(audit.occurredAt).toBe(NOW);
  });

  test('申込・今日・理由・時刻と準備済みの監査の記録を書き込みのポートへ渡す', async () => {
    const record = paidRecordOf();
    const { calls, terminate } = setup({ record });

    await terminate();

    const input = commitOf(calls);
    expect(input.record).toBe(record);
    expect(input.today).toBe(TODAY);
    expect(input.reason).toBe(REASON);
    expect(input.at).toBe(NOW);
  });

  test('理由は監査の記録と同じく前後の空白を除いて保存する', async () => {
    const { calls, terminate } = setup();

    await terminate(`  ${REASON}\n`);

    const input = commitOf(calls);
    expect(input.reason).toBe(REASON);
    expect(input.audit.reason).toBe(REASON);
  });

  test.each([
    ['空', '', 'reason_required'],
    ['空白だけ', ' \n\t', 'reason_required'],
    [
      `${String(AUDIT_REASON_MAX)}文字超`,
      'あ'.repeat(AUDIT_REASON_MAX + 1),
      'reason_too_long',
    ],
  ])(
    '理由が%sならvalidation_errorで拒否し、確定も通知の依頼も行わない',
    async (_, reason, code) => {
      const { calls, terminate } = setup();

      const error = await terminate(reason).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        kind: 'bad_request',
        code: 'validation_error',
        details: [{ field: 'reason', code }],
      });
      expect(kindsOf(calls)).not.toContain('commit');
      expect(kindsOf(calls)).not.toContain('request');
    },
  );

  test(`理由が${String(AUDIT_REASON_MAX)}文字なら受け付ける`, async () => {
    const reason = 'あ'.repeat(AUDIT_REASON_MAX);
    const { calls, terminate } = setup();

    await terminate(reason);

    expect(commitOf(calls).reason).toBe(reason);
  });

  test('モデレーター未満は申込を読まずに拒否する', async () => {
    const { calls, terminate } = setup({ roleError: forbiddenError() });

    expect(await terminate().catch((cause: unknown) => cause)).toMatchObject({
      code: 'forbidden',
    });
    expect(kindsOf(calls)).toStrictEqual(['requireRole']);
  });

  test.each(NOT_TERMINABLE_RECORDS)(
    '%sの申込はsponsorship_not_terminableで拒否し、監査の準備も確定も行わない',
    async (_, record) => {
      const { calls, terminate } = setup({ record });

      expect(await terminate().catch((cause: unknown) => cause)).toMatchObject({
        code: 'sponsorship_not_terminable',
        message: NOT_TERMINABLE_MESSAGE,
      });
      expect(kindsOf(calls)).toStrictEqual(['requireRole', 'findById']);
    },
  );

  test('書き込みのポートが確定できなかったときはsponsorship_not_terminableで拒否し、通知の送信を依頼しない', async () => {
    const { calls, terminate } = setup({
      commitResult: { kind: 'not_terminable' },
    });

    expect(await terminate().catch((cause: unknown) => cause)).toMatchObject({
      kind: 'conflict',
      code: 'sponsorship_not_terminable',
    });
    expect(kindsOf(calls)).not.toContain('request');
  });

  test('確定した日数・金額・返金の結果・購入IDを返す', async () => {
    const estimate = {
      unexposedDays: 5,
      refundEstimate: 5000,
      stoppedDays: 2,
      stopRefundAmount: 2000,
    };
    const record = paidRecordOf({
      startsOn: parseBusinessDate('2026-11-20'),
      endsOn: parseBusinessDate('2026-11-29'),
      days: 10,
      amountTotal: 10000,
    });
    const { terminate } = setup({
      record,
      estimate,
      commitResult: {
        kind: 'committed',
        termination: refundOutcomeOf({ days: 5, amount: 5000 }),
        displayStop: refundOutcomeOf({
          kind: 'display_stop',
          days: 2,
          amount: 2000,
          refundRequestId: '01JF0SPRFND000000000000002',
        }),
      },
    });

    expect(await terminate()).toStrictEqual({
      sponsorshipId: SPONSORSHIP_ID,
      days: 10,
      amountTotal: 10000,
      ...estimate,
      terminatedOn: TODAY,
      purchaseId: PURCHASE_ID,
      terminationRefundStatus: 'requested',
      stopRefundStatus: 'requested',
      terminationRefundRequested: 5000,
      stopRefundRequested: 2000,
    });
  });

  test('残りの全額で依頼し直した返金は依頼した額をnullで返す', async () => {
    const { terminate } = setup({
      commitResult: {
        ...COMMITTED,
        termination: refundOutcomeOf({ amount: null }),
      },
    });

    expect(await terminate()).toMatchObject({
      terminationRefundStatus: 'requested',
      terminationRefundRequested: null,
    });
  });

  test.each(['already_refunded', 'rejected', 'not_needed'] as const)(
    '書き込みのポートが返金の結果%sを返しても強制終了は確定し、依頼した額をnullで返して通知の送信を依頼する',
    async (status) => {
      const { calls, terminate } = setup({
        estimate: { ...ESTIMATE, stoppedDays: 1, stopRefundAmount: 1000 },
        commitResult: {
          kind: 'committed',
          termination: refundOutcomeOf({ status, refundRequestId: null }),
          displayStop: refundOutcomeOf({
            kind: 'display_stop',
            days: 1,
            amount: 1000,
            status,
            refundRequestId: null,
          }),
        },
      });

      expect(await terminate()).toMatchObject({
        terminatedOn: TODAY,
        purchaseId: PURCHASE_ID,
        terminationRefundStatus: status,
        stopRefundStatus: status,
        terminationRefundRequested: null,
        stopRefundRequested: null,
      });
      expect(kindsOf(calls).at(-1)).toBe('request');
    },
  );

  test('通知の送信の依頼に失敗しても警告のログだけを残して結果を返す', async () => {
    const failure = new Error('キューへ送れませんでした');
    const { terminate } = setup({ noticeError: failure });

    expect(await terminate()).toMatchObject({
      sponsorshipId: SPONSORSHIP_ID,
      terminatedOn: TODAY,
    });
    const warnings = records.filter(({ level }) => level === 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.category).toStrictEqual([
      'api',
      'application',
      'sponsorship',
    ]);
    expect(warnings[0]?.properties).toStrictEqual({
      sponsorshipId: SPONSORSHIP_ID,
      error: failure,
    });
    expect(JSON.stringify(warnings[0]?.message)).not.toContain(REASON);
  });
});
