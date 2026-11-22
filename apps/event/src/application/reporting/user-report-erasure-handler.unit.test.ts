import { describe, expect, test } from 'bun:test';

import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import type { ReportErasureStore } from '../../../lib/core/reporting/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  USER_REPORT_ERASURE_BATCH_SIZE,
  UserReportErasureHandler,
} from './user-report-erasure-handler.ts';

const NOW = new Date('2026-12-20T03:00:05.000Z');

const clock: Clock = { now: () => NOW };

const EVENT: UserLifecycleEvent = Object.freeze({
  id: '01JQ0EVT000000000000000181',
  userId: '01JQ0USR000000000000000004',
  type: 'purge_due',
  occurredAt: new Date('2026-12-20T03:00:00.000Z'),
});

interface Step {
  readonly reporterRemaining: boolean;
  readonly ownerRemaining: boolean;
  readonly emptyErased: number;
}

type Call =
  | {
      readonly op: 'eraseByReporter';
      readonly userId: string;
      readonly limit: number;
    }
  | {
      readonly op: 'detachCasesByOwner';
      readonly userId: string;
      readonly at: Date;
      readonly limit: number;
    }
  | { readonly op: 'eraseEmptyCases'; readonly limit: number };

function unexpected(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

function nextOf<T>(queue: T[]): T {
  const value = queue.shift();
  if (value === undefined) {
    throw new Error('用意した結果を使い切った');
  }
  return value;
}

// 申出者の通報の削除・投稿者の案件の参照の消去・空の案件の削除だけを記録し、他の操作は呼ばれたら失敗させる
function createFakeStore(steps: readonly Step[]): {
  readonly store: ReportErasureStore;
  readonly calls: readonly Call[];
} {
  const calls: Call[] = [];
  const reporter = steps.map(({ reporterRemaining }) => reporterRemaining);
  const owner = steps.map(({ ownerRemaining }) => ownerRemaining);
  const empty = steps.map(({ emptyErased }) => emptyErased);
  return {
    store: {
      eraseByReporter: (userId, limit) => {
        calls.push({ op: 'eraseByReporter', userId, limit });
        return Promise.resolve({ remaining: nextOf(reporter) });
      },
      detachCasesByOwner: (userId, at, limit) => {
        calls.push({ op: 'detachCasesByOwner', userId, at, limit });
        return Promise.resolve({ remaining: nextOf(owner) });
      },
      detachCasesByProduct: unexpected,
      eraseGuestReportsClosedBefore: unexpected,
      eraseDetachedCasesBefore: unexpected,
      eraseEmptyCases: (limit) => {
        calls.push({ op: 'eraseEmptyCases', limit });
        return Promise.resolve(nextOf(empty));
      },
    },
    calls,
  };
}

const NOTHING_LEFT: Step = Object.freeze({
  reporterRemaining: false,
  ownerRemaining: false,
  emptyErased: 0,
});

describe('UserReportErasureHandler', () => {
  test('1回に消す・参照を消す件数の上限は500件である', () => {
    expect(USER_REPORT_ERASURE_BATCH_SIZE).toBe(500);
  });

  test('申出者の通報の削除・投稿者の案件の対象への参照の消去・空の案件の削除を、この順に上限と実行時刻で1回ずつ呼ぶ', async () => {
    const { store, calls } = createFakeStore([NOTHING_LEFT]);

    await new UserReportErasureHandler(store, clock).handle(EVENT);

    expect(calls).toStrictEqual([
      {
        op: 'eraseByReporter',
        userId: EVENT.userId,
        limit: USER_REPORT_ERASURE_BATCH_SIZE,
      },
      {
        op: 'detachCasesByOwner',
        userId: EVENT.userId,
        at: NOW,
        limit: USER_REPORT_ERASURE_BATCH_SIZE,
      },
      { op: 'eraseEmptyCases', limit: USER_REPORT_ERASURE_BATCH_SIZE },
    ]);
  });

  test('どれにも残りが無ければ完了を返す', async () => {
    const { store } = createFakeStore([
      { ...NOTHING_LEFT, emptyErased: USER_REPORT_ERASURE_BATCH_SIZE - 1 },
    ]);

    expect(
      await new UserReportErasureHandler(store, clock).handle(EVENT),
    ).toStrictEqual({ kind: 'done' });
  });

  test.each<[string, Step]>([
    ['申出者の通報', { ...NOTHING_LEFT, reporterRemaining: true }],
    ['投稿者の案件の参照', { ...NOTHING_LEFT, ownerRemaining: true }],
    [
      '空の案件(上限ちょうどの件数を消した)',
      { ...NOTHING_LEFT, emptyErased: USER_REPORT_ERASURE_BATCH_SIZE },
    ],
  ])(
    '%sに残りがあれば、3つの操作を全て呼んだうえで続きを返す',
    async (_, step) => {
      const { store, calls } = createFakeStore([step]);

      expect(
        await new UserReportErasureHandler(store, clock).handle(EVENT),
      ).toStrictEqual({ kind: 'continue' });
      expect(calls.map(({ op }) => op)).toStrictEqual([
        'eraseByReporter',
        'detachCasesByOwner',
        'eraseEmptyCases',
      ]);
    },
  );

  test('続きの呼び出しで残りが尽きた回に完了を返し、同じイベントの呼び直しでも完了を返す', async () => {
    const { store, calls } = createFakeStore([
      {
        reporterRemaining: true,
        ownerRemaining: true,
        emptyErased: USER_REPORT_ERASURE_BATCH_SIZE,
      },
      { ...NOTHING_LEFT, emptyErased: 3 },
      NOTHING_LEFT,
    ]);
    const handler = new UserReportErasureHandler(store, clock);

    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'continue' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(await handler.handle(EVENT)).toStrictEqual({ kind: 'done' });
    expect(calls).toHaveLength(9);
  });

  test('削除の失敗は捕まえずに投げ、後の操作を呼ばずにメッセージの再試行に任せる', async () => {
    const failure = new Error('D1の障害');
    const { store, calls } = createFakeStore([NOTHING_LEFT]);
    const failing: ReportErasureStore = {
      ...store,
      eraseByReporter: () => Promise.reject(failure),
    };

    expect(
      await new UserReportErasureHandler(failing, clock)
        .handle(EVENT)
        .catch((thrown: unknown) => thrown),
    ).toBe(failure);
    expect(calls).toStrictEqual([]);
  });
});
