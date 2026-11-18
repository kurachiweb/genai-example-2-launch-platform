import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { EmailSendError } from '../../../lib/core/email/ports.ts';
import {
  capturedLogsOf,
  startLogCapture,
  stopLogCapture,
} from '../email/email-log-capture.fixtures.ts';
import {
  NOTICE_CONTINUE_DELAY_SECONDS,
  NOTICE_DISPATCH_LIMIT,
} from './notice-dispatch-handler.ts';
import {
  CLIENT_SITE_ORIGIN,
  CONTACT,
  createDispatchHarness,
  type DispatchCall,
  keyOf,
  MESSAGE_META,
  noticeOf,
  NOW,
  PRODUCT_ID,
  PRODUCT_NAME,
  recordOf,
  REQUEST_BODY,
} from './testing/notice-dispatch-fakes.ts';

const LOG_CATEGORY = ['event', 'sponsorship'] as const;

const TERMINATION_REASON = '広告の内容が掲載の基準に合わないため';

function opsOf(calls: readonly DispatchCall[]): string[] {
  return calls.map((call) => call.op);
}

function sentKeysOf(calls: readonly DispatchCall[]): string[] {
  return calls.flatMap((call) =>
    call.op === 'send' ? [`${call.kind}:${call.to}`] : [],
  );
}

beforeEach(() => {
  startLogCapture();
});

afterEach(() => {
  stopLogCapture();
});

describe('NoticeDispatchHandlerの手順', () => {
  test('依頼待ちを上限より1件多く読み、通知を依頼済みに取ってから宛先とプロダクトを引いて送る', async () => {
    const notice = noticeOf(1, 'start');
    const { handler, calls } = createDispatchHarness({
      pending: [notice],
      records: [recordOf(1)],
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(calls).toStrictEqual([
      { op: 'listPending', limit: NOTICE_DISPATCH_LIMIT + 1 },
      { op: 'claim', key: keyOf(notice), at: NOW },
      { op: 'findSummaries', productIds: [PRODUCT_ID], scope: 'visible' },
      { op: 'findContact', userId: CONTACT.userId },
      {
        op: 'send',
        kind: 'sponsorship.start-notice',
        to: CONTACT.email,
        input: {
          nickname: CONTACT.nickname,
          productName: PRODUCT_NAME,
          tierLabel: 'Gold',
          startsOn: '2026-11-25',
          endsOn: '2026-12-01',
          days: 7,
          listUrl: `${CLIENT_SITE_ORIGIN}/settings/sponsorships`,
        },
      },
    ]);
  });

  test('他の処理が先に取った通知は、送らずに状態も変えない', async () => {
    const { handler, calls } = createDispatchHarness({
      pending: [noticeOf(1, 'start')],
      records: [],
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(opsOf(calls)).toStrictEqual(['listPending', 'claim']);
  });

  test('依頼待ちが20件を超えると、20件を送って続きを5秒遅らせて処理する', async () => {
    const indexes = Array.from(
      { length: NOTICE_DISPATCH_LIMIT + 1 },
      (_, index) => index + 1,
    );
    const { handler, calls } = createDispatchHarness({
      pending: indexes.map((index) => noticeOf(index, 'start')),
      records: indexes.map((index) => recordOf(index)),
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(NOTICE_DISPATCH_LIMIT).toBe(20);
    expect(NOTICE_CONTINUE_DELAY_SECONDS).toBe(5);
    expect(result).toStrictEqual({
      kind: 'defer',
      delaySeconds: NOTICE_CONTINUE_DELAY_SECONDS,
    });
    expect(
      calls.flatMap((call) => (call.op === 'claim' ? [call.key] : [])),
    ).toStrictEqual(
      indexes
        .slice(0, NOTICE_DISPATCH_LIMIT)
        .map((index) => keyOf(noticeOf(index, 'start'))),
    );
    expect(sentKeysOf(calls)).toHaveLength(NOTICE_DISPATCH_LIMIT);
  });

  test('依頼待ちがちょうど20件なら、全てを送って続けない', async () => {
    const indexes = Array.from(
      { length: NOTICE_DISPATCH_LIMIT },
      (_, index) => index + 1,
    );
    const { handler, calls } = createDispatchHarness({
      pending: indexes.map((index) => noticeOf(index, 'start')),
      records: indexes.map((index) => recordOf(index)),
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(sentKeysOf(calls)).toHaveLength(NOTICE_DISPATCH_LIMIT);
  });

  test('依頼待ちが無ければ何もせずに終える', async () => {
    const { handler, calls } = createDispatchHarness({ pending: [] });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(opsOf(calls)).toStrictEqual(['listPending']);
  });
});

describe('NoticeDispatchHandlerの送信の失敗', () => {
  test('恒久的な送信の拒否は送らないと記録して警告し、次の通知へ進む', async () => {
    const first = noticeOf(1, 'start');
    const second = noticeOf(2, 'start');
    const { handler, calls } = createDispatchHarness({
      pending: [first, second],
      records: [recordOf(1), recordOf(2)],
      sendFailure: new EmailSendError('invalid-input'),
    });

    const result = await handler.handle(REQUEST_BODY, MESSAGE_META);

    expect(result).toStrictEqual({ kind: 'done' });
    expect(calls.filter((call) => call.op === 'markSkipped')).toStrictEqual([
      { op: 'markSkipped', key: keyOf(first), at: NOW },
      { op: 'markSkipped', key: keyOf(second), at: NOW },
    ]);
    expect(calls.some((call) => call.op === 'release')).toBe(false);
    const warnings = capturedLogsOf(LOG_CATEGORY).filter(
      (record) => record.level === 'warning',
    );
    expect(warnings.map((record) => record.properties)).toStrictEqual([
      {
        sponsorshipId: first.sponsorshipId,
        notice: 'start',
        reason: 'invalid-input',
      },
      {
        sponsorshipId: second.sponsorshipId,
        notice: 'start',
        reason: 'invalid-input',
      },
    ]);
  });

  test('一時的な送信の失敗は依頼待ちに戻して例外を返し、後の通知を処理しない', async () => {
    const failure = new Error('Queueへの送信に失敗しました');
    const first = noticeOf(1, 'start');
    const { handler, calls } = createDispatchHarness({
      pending: [first, noticeOf(2, 'start')],
      records: [recordOf(1), recordOf(2)],
      sendFailure: failure,
    });

    const caught = await handler
      .handle(REQUEST_BODY, MESSAGE_META)
      .catch((cause: unknown) => cause);

    expect(caught).toBe(failure);
    expect(opsOf(calls)).toStrictEqual([
      'listPending',
      'claim',
      'findSummaries',
      'findContact',
      'send',
      'release',
    ]);
    expect(calls.at(-1)).toStrictEqual({
      op: 'release',
      key: keyOf(first),
      at: NOW,
    });
  });

  test('取った後の照会の失敗も依頼待ちに戻して例外を返す', async () => {
    const failure = new Error('D1の障害');
    const notice = noticeOf(1, 'end');
    const { handler, calls } = createDispatchHarness({
      pending: [notice],
      records: [recordOf(1)],
      productFailure: failure,
    });

    expect(
      await handler
        .handle(REQUEST_BODY, MESSAGE_META)
        .catch((cause: unknown) => cause),
    ).toBe(failure);
    expect(calls.at(-1)).toStrictEqual({
      op: 'release',
      key: keyOf(notice),
      at: NOW,
    });
  });

  test('取る時の失敗は戻さずに例外を返す', async () => {
    const failure = new Error('D1の障害');
    const { handler, calls } = createDispatchHarness({
      pending: [noticeOf(1, 'start')],
      records: [recordOf(1)],
      claimFailure: failure,
    });

    expect(
      await handler
        .handle(REQUEST_BODY, MESSAGE_META)
        .catch((cause: unknown) => cause),
    ).toBe(failure);
    expect(opsOf(calls)).toStrictEqual(['listPending', 'claim']);
  });
});

describe('NoticeDispatchHandlerのログ', () => {
  test('ログには申込のIDと通知の種類と件数だけを記録し、名称・メールアドレス・理由を含めない', async () => {
    const { handler } = createDispatchHarness({
      pending: [
        noticeOf(1, 'start'),
        noticeOf(2, 'termination'),
        noticeOf(3, 'start'),
      ],
      records: [
        recordOf(1),
        recordOf(2, {
          state: 'terminated',
          terminatedAt: NOW,
          terminationReason: TERMINATION_REASON,
        }),
        recordOf(3, { state: 'terminated' }),
      ],
    });

    await handler.handle(REQUEST_BODY, MESSAGE_META);

    const logs = capturedLogsOf(LOG_CATEGORY);
    const serialized = JSON.stringify(
      logs.map((record) => [record.message, record.properties]),
    );
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [
      PRODUCT_NAME,
      CONTACT.email,
      CONTACT.nickname,
      TERMINATION_REASON,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(logs.at(-1)?.properties).toStrictEqual({
      sent: 2,
      skipped: 1,
      taken: 0,
      more: false,
    });
  });
});
