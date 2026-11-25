import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { SponsorshipRecord } from '../../../lib/core/sponsorship/ports.ts';

import {
  capturedLogsOf,
  startLogCapture,
  stopLogCapture,
} from '../email/email-log-capture.fixtures.ts';
import {
  PERIOD_END_CONTINUE_DELAY_SECONDS,
  PERIOD_END_FAILURE_LIMIT,
  PERIOD_END_SETTLEMENT_LIMIT,
} from './period-end-settlement-handler.ts';
import {
  createSettlementHarness,
  MESSAGE_META,
  NOW,
  recordsOf,
  REQUEST_BODY,
  type SettlementCall,
  TODAY,
} from './testing/period-end-settlement-fakes.ts';

const LOG_CATEGORY = ['event', 'sponsorship'] as const;

const CONTINUE = Object.freeze({
  kind: 'defer',
  delaySeconds: PERIOD_END_CONTINUE_DELAY_SECONDS,
});

function failuresOf(
  records: readonly SponsorshipRecord[],
): Record<string, Error> {
  return Object.fromEntries(
    records.map(({ id }) => [id, new Error('精算に失敗した')] as const),
  );
}

function opsOf(calls: readonly SettlementCall[]): string[] {
  return calls.map((call) => call.op);
}

function settledIdsOf(calls: readonly SettlementCall[]): string[] {
  return calls.flatMap((call) =>
    call.op === 'settle' ? [call.sponsorshipId] : [],
  );
}

function listLimitsOf(calls: readonly SettlementCall[]): number[] {
  return calls.flatMap((call) =>
    call.op === 'listUnsettledEnded' ? [call.limit] : [],
  );
}

function reportedIdsOf(calls: readonly SettlementCall[]): string[] {
  return calls.flatMap((call) =>
    call.op === 'report' ? [call.sponsorshipId] : [],
  );
}

beforeEach(() => {
  startLogCapture();
});

afterEach(() => {
  stopLogCapture();
});

describe('PeriodEndSettlementHandlerの手順', () => {
  test('今日の未精算の終了した広告を20件まで読んで1件ずつ精算し、その後に終了の通知を依頼待ちにして送信を依頼する', async () => {
    const [first, second] = recordsOf(1, 2);
    if (first === undefined || second === undefined) {
      throw new Error('広告が足りない');
    }
    const { handler, calls } = createSettlementHarness({
      unsettled: [first, second],
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(calls).toStrictEqual([
      {
        op: 'listUnsettledEnded',
        today: TODAY,
        limit: PERIOD_END_SETTLEMENT_LIMIT,
      },
      { op: 'settle', sponsorshipId: first.id, at: NOW },
      { op: 'settle', sponsorshipId: second.id, at: NOW },
      { op: 'markDue', today: TODAY },
      { op: 'request' },
    ]);
  });

  test('未精算の広告が無くても、終了の通知を依頼待ちにして送信を依頼する', async () => {
    const { handler, calls } = createSettlementHarness({ unsettled: [] });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(opsOf(calls)).toStrictEqual([
      'listUnsettledEnded',
      'markDue',
      'request',
    ]);
  });

  test('未精算の広告の読み取りの失敗は、依頼待ちの記録をせずに例外を返してメッセージの再試行に任せる', async () => {
    const failure = new Error('D1の読み取りに失敗した');
    const { handler, calls } = createSettlementHarness({
      unsettled: recordsOf(1, 1),
      listFailure: failure,
    });

    const thrown = await handler
      .handle(REQUEST_BODY, MESSAGE_META)
      .catch((error: unknown) => error);

    expect(thrown).toBe(failure);
    expect(opsOf(calls)).toStrictEqual(['listUnsettledEnded']);
  });
});

describe('PeriodEndSettlementHandlerの広告ごとの例外と取り消し', () => {
  test('精算の例外は広告ごとにエラートラッキングへ知らせ、他の広告の精算と依頼待ちの記録を止めない', async () => {
    const records = recordsOf(1, 3);
    const [, failing] = records;
    if (failing === undefined) {
      throw new Error('広告が足りない');
    }
    const failure = new Error('D1の一括の書き込みに失敗した');
    const { handler, calls } = createSettlementHarness({
      unsettled: records,
      behaviors: { [failing.id]: failure },
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(settledIdsOf(calls)).toStrictEqual(records.map(({ id }) => id));
    expect(calls.filter((call) => call.op === 'report')).toStrictEqual([
      { op: 'report', sponsorshipId: failing.id, error: failure },
    ]);
    expect(opsOf(calls).slice(-2)).toStrictEqual(['markDue', 'request']);
  });

  test('上限まで読んで例外になった広告があれば、同じ回の読み直しで上限を除いた件数だけ増やして読み、メモリ上で除く', async () => {
    const records = recordsOf(1, PERIOD_END_SETTLEMENT_LIMIT);
    const [failing] = records;
    if (failing === undefined) {
      throw new Error('広告が足りない');
    }
    const { handler, calls } = createSettlementHarness({
      unsettled: records,
      behaviors: { [failing.id]: new Error('精算に失敗した') },
    });

    await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(listLimitsOf(calls)).toStrictEqual([
      PERIOD_END_SETTLEMENT_LIMIT,
      PERIOD_END_SETTLEMENT_LIMIT + 1,
    ]);
    expect(settledIdsOf(calls)).toStrictEqual(records.map(({ id }) => id));
  });

  test('常に例外になる広告が先頭に上限未満溜まっても、同じ回で後ろの広告を精算する', async () => {
    const failing = recordsOf(1, PERIOD_END_FAILURE_LIMIT - 1);
    const following = recordsOf(PERIOD_END_FAILURE_LIMIT, 2);
    const { handler, calls } = createSettlementHarness({
      unsettled: [...failing, ...following],
      behaviors: failuresOf(failing),
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(settledIdsOf(calls)).toStrictEqual(
      [...failing, ...following].map(({ id }) => id),
    );
    expect(reportedIdsOf(calls)).toStrictEqual(failing.map(({ id }) => id));
    expect(listLimitsOf(calls)).toStrictEqual([
      PERIOD_END_SETTLEMENT_LIMIT,
      PERIOD_END_SETTLEMENT_LIMIT + PERIOD_END_FAILURE_LIMIT - 1,
    ]);
  });

  test('例外が上限に達したら読み足しをやめ、続けずに依頼待ちの記録と送信の依頼を行う', async () => {
    const failing = recordsOf(1, PERIOD_END_FAILURE_LIMIT);
    const following = recordsOf(PERIOD_END_FAILURE_LIMIT + 1, 2);
    const { handler, calls } = createSettlementHarness({
      unsettled: [...failing, ...following],
      behaviors: failuresOf(failing),
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(settledIdsOf(calls)).toStrictEqual(failing.map(({ id }) => id));
    expect(listLimitsOf(calls)).toStrictEqual([PERIOD_END_SETTLEMENT_LIMIT]);
    expect(opsOf(calls).slice(-2)).toStrictEqual(['markDue', 'request']);
  });

  test('読み足した広告の途中で例外が上限に達したら、残りを試さずに打ち切る', async () => {
    const leading = recordsOf(1, 15);
    const settled = recordsOf(16, 5);
    const trailing = recordsOf(21, 30);
    const { handler, calls } = createSettlementHarness({
      unsettled: [...leading, ...settled, ...trailing],
      behaviors: failuresOf([...leading, ...trailing]),
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(reportedIdsOf(calls)).toHaveLength(PERIOD_END_FAILURE_LIMIT);
    expect(settledIdsOf(calls)).toStrictEqual(
      [...leading, ...settled, ...trailing.slice(0, 5)].map(({ id }) => id),
    );
    expect(listLimitsOf(calls)).toStrictEqual([
      PERIOD_END_SETTLEMENT_LIMIT,
      PERIOD_END_SETTLEMENT_LIMIT + 15,
    ]);
  });

  test('条件の崩れで取り消された広告はエラートラッキングへ知らせずに飛ばし、次の広告を精算する', async () => {
    const records = recordsOf(1, 2);
    const [skipped] = records;
    if (skipped === undefined) {
      throw new Error('広告が足りない');
    }
    const { handler, calls } = createSettlementHarness({
      unsettled: records,
      behaviors: { [skipped.id]: 'skipped' },
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(settledIdsOf(calls)).toStrictEqual(records.map(({ id }) => id));
    expect(reportedIdsOf(calls)).toStrictEqual([]);
    expect(opsOf(calls).slice(-2)).toStrictEqual(['markDue', 'request']);
  });
});

describe('PeriodEndSettlementHandlerの続けるかどうかの判定', () => {
  test('20件を処理して1件以上精算できれば、続きを遅らせて処理する', async () => {
    const records = recordsOf(1, PERIOD_END_SETTLEMENT_LIMIT + 1);
    const { handler, calls } = createSettlementHarness({
      unsettled: records,
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual(CONTINUE);
    expect(settledIdsOf(calls)).toStrictEqual(
      records.slice(0, PERIOD_END_SETTLEMENT_LIMIT).map(({ id }) => id),
    );
    expect(opsOf(calls).slice(-2)).toStrictEqual(['markDue', 'request']);
  });

  test('例外を除いて20件を処理し1件以上精算できれば、続きを遅らせて処理する', async () => {
    const records = recordsOf(1, PERIOD_END_SETTLEMENT_LIMIT + 2);
    const [failing] = records;
    if (failing === undefined) {
      throw new Error('広告が足りない');
    }
    const { handler, calls } = createSettlementHarness({
      unsettled: records,
      behaviors: { [failing.id]: new Error('精算に失敗した') },
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual(CONTINUE);
    expect(settledIdsOf(calls)).toStrictEqual(
      records.slice(0, PERIOD_END_SETTLEMENT_LIMIT + 1).map(({ id }) => id),
    );
  });

  test('ちょうど20件で残りが無くても、20件を処理して精算できた回は続ける', async () => {
    const { handler } = createSettlementHarness({
      unsettled: recordsOf(1, PERIOD_END_SETTLEMENT_LIMIT),
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual(CONTINUE);
  });

  test('全件が例外の回は続けず、依頼待ちの記録と送信の依頼は行う', async () => {
    const records = recordsOf(1, PERIOD_END_SETTLEMENT_LIMIT + 1);
    const { handler, calls } = createSettlementHarness({
      unsettled: records,
      behaviors: Object.fromEntries(
        records.map(({ id }) => [id, new Error('精算に失敗した')] as const),
      ),
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(reportedIdsOf(calls)).toStrictEqual(
      records.slice(0, PERIOD_END_FAILURE_LIMIT).map(({ id }) => id),
    );
    expect(opsOf(calls).slice(-2)).toStrictEqual(['markDue', 'request']);
  });

  test('20件を処理しても全件が取り消しで精算できなかった回は続けない', async () => {
    const records = recordsOf(1, PERIOD_END_SETTLEMENT_LIMIT + 1);
    const { handler } = createSettlementHarness({
      unsettled: records,
      behaviors: Object.fromEntries(
        records.map(({ id }) => [id, 'skipped'] as const),
      ),
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
  });
});

describe('PeriodEndSettlementHandlerのログ', () => {
  test('件数と続けるかどうかだけを記録し、取り消した広告は申込のIDだけを記録する', async () => {
    const records = recordsOf(1, 3);
    const [skipped, failing] = records;
    if (skipped === undefined || failing === undefined) {
      throw new Error('広告が足りない');
    }
    const { handler } = createSettlementHarness({
      unsettled: records,
      behaviors: {
        [skipped.id]: 'skipped',
        [failing.id]: new Error('精算に失敗した'),
      },
    });

    await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(
      capturedLogsOf(LOG_CATEGORY).map(({ level, message, properties }) => ({
        level,
        message: message.join(''),
        properties,
      })),
    ).toStrictEqual([
      {
        level: 'info',
        message:
          '条件が変わったスポンサー広告の掲載の終わりの精算を取り消しました',
        properties: { sponsorshipId: skipped.id },
      },
      {
        level: 'info',
        message: 'スポンサー広告の掲載の終わりの精算を処理しました',
        properties: { settled: 1, skipped: 1, failed: 1, more: false },
      },
    ]);
  });
});
