import { notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import { LIVE_REFRESH_INTERVAL_MS } from '../lib/utilities/query/live-refresh.ts';
import { entryOf } from '../src/components/match/match-fixtures.ts';
import {
  type QualifierBoardView,
  qualifierBoardOf,
  qualifierMatchOf,
} from '../src/components/top/qualifier-board-fixtures.ts';
import type { MatchFragment } from '../src/graphql/generated/graphql.ts';
import {
  boardCallsOf,
  boardResult,
  renderTopPage,
} from './top-page-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

const SECOND_MS = 1000;

const MINUTE_MS = 60 * SECOND_MS;

// 業務日付2026-11-10の12:00・23:39・23:40:30・23:59(閲覧者のタイムゾーンAsia/Tokyo)
const NOON = new Date('2026-11-10T03:00:00.000Z');
const BEFORE_FULL_TIME = new Date('2026-11-10T14:39:00.000Z');
const AFTER_FULL_TIME = new Date('2026-11-10T14:40:30.000Z');
const BEFORE_KICKOFF = new Date('2026-11-10T14:59:00.000Z');

const FOLLOW_UP_MESSAGE =
  '結果の反映に時間がかかっています。ページを再読み込みすると最新の状態を表示します。';

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

const main = () => page.getByRole('main');
const qualifierSection = () => main().getByRole('region', { name: /^予選/u });
const qualifierStatus = () => qualifierSection().getByRole('status');
const cardNames = () =>
  qualifierSection()
    .getByRole('article')
    .elements()
    .map((card) => card.getAttribute('aria-label') ?? card.textContent);
const autoRefreshSwitch = () =>
  main().getByRole('switch', { name: '自動更新' });
const boardCalls = () => boardCallsOf(executeGraphQL).length;

const withCounts = (
  n: number,
  left: number,
  right: number,
  overrides: Partial<MatchFragment> = {},
): MatchFragment => {
  const base = qualifierMatchOf(n);
  const [leftEntry, rightEntry] = base.entries;
  return {
    ...base,
    entries: [
      entryOf('left', { ...leftEntry, upvoteCount: left }),
      entryOf('right', { ...rightEntry, upvoteCount: right }),
    ],
    ...overrides,
  };
};

const finishedMatchOf = (n: number): MatchFragment => {
  const base = qualifierMatchOf(n, { phase: 'FINISHED', decision: 'VOTES' });
  const [left, right] = base.entries;
  return {
    ...base,
    entries: [
      entryOf('left', { ...left, result: 'WON' }),
      entryOf('right', { ...right, result: 'LOST' }),
    ],
  };
};

const liveBoard = (serverTime: Date): QualifierBoardView =>
  qualifierBoardOf({
    serverTime: serverTime.toISOString(),
    matches: [1, 2].map((n) => qualifierMatchOf(n)),
  });

const tallyingBoard = (): QualifierBoardView =>
  qualifierBoardOf({
    phase: 'RESULT',
    serverTime: AFTER_FULL_TIME.toISOString(),
    matches: [1, 2].map((n) => qualifierMatchOf(n, { phase: 'TALLYING' })),
  });

const settledBoard = (): QualifierBoardView =>
  qualifierBoardOf({
    phase: 'RESULT',
    serverTime: AFTER_FULL_TIME.toISOString(),
    matches: [1, 2].map(finishedMatchOf),
  });

const nextDayBoard = (): QualifierBoardView =>
  qualifierBoardOf({
    date: '2026-11-11',
    serverTime: '2026-11-10T15:00:01.000Z',
    fullTimeAt: '2026-11-11T14:40:00.000Z',
    nextKickoffAt: '2026-11-11T15:00:00.000Z',
    matches: [3, 4].map((n) => qualifierMatchOf(n)),
  });

// 取得のたびに先頭の盤面を返し、最後の盤面は返し続ける
const respondInTurn = (...boards: QualifierBoardView[]) => {
  const queue = [...boards];
  executeGraphQL.mockImplementation(() => {
    const board = queue.length > 1 ? queue.shift() : queue[0];
    if (board === undefined) {
      throw new Error('盤面の準備に失敗しました');
    }
    return Promise.resolve(boardResult(board));
  });
};

const startClockAt = (now: Date): void => {
  notifyManager.setScheduler(queueMicrotask);
  vi.useFakeTimers({
    now,
    toFake: [
      'Date',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  });
};

const turnOffAutoRefresh = async (): Promise<void> => {
  await userEvent.click(autoRefreshSwitch());
  await expect.element(autoRefreshSwitch()).not.toBeChecked();
};

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
});

afterEach(() => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
});

describe('トップページの予選の定期の取り直し', () => {
  test('自動更新がオンでマッチ中の対戦カードがあれば30秒ごとに取り直し、値を差し替えて並び順を変えない', async () => {
    startClockAt(NOON);
    respondInTurn(
      qualifierBoardOf({
        matches: [
          withCounts(1, 12, 9),
          withCounts(2, 1, 0),
          withCounts(3, 2, 2),
        ],
      }),
      qualifierBoardOf({
        matches: [
          withCounts(2, 10, 10),
          withCounts(1, 12, 10),
          withCounts(3, 2, 3),
        ],
      }),
    );
    await renderTopPage();
    await expect.element(qualifierSection()).toBeVisible();
    const before = cardNames();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
    expect(boardCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect
      .element(
        qualifierSection().getByRole('button', { name: /^Left 2にUpvote/u }),
      )
      .toHaveTextContent('Left 2にUpvote 10票');
    expect(cardNames()).toStrictEqual(before);
    expect(boardCalls()).toBe(2);
  });

  test('結果がすべて確定した値を受け取ると、自動更新がオンでも定期の取り直しを止める', async () => {
    startClockAt(NOON);
    respondInTurn(
      liveBoard(NOON),
      qualifierBoardOf({ matches: [1, 2].map(finishedMatchOf) }),
    );
    await renderTopPage();
    await expect.element(qualifierSection()).toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);

    expect(boardCalls()).toBe(2);
  });

  test('自動更新をオフにすると定期の取り直しを止め、オフのままでも終了の時刻と翌日の開始の時刻の1秒後に取り直す', async () => {
    startClockAt(BEFORE_FULL_TIME);
    respondInTurn(liveBoard(BEFORE_FULL_TIME), settledBoard());
    await renderTopPage();
    await expect.element(qualifierSection()).toBeVisible();
    await turnOffAutoRefresh();

    await vi.advanceTimersByTimeAsync(MINUTE_MS + SECOND_MS - 1);
    expect(boardCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect.poll(boardCalls).toBe(2);

    respondInTurn(nextDayBoard());
    await vi.advanceTimersByTimeAsync(20 * MINUTE_MS - 1);
    expect(boardCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect.poll(boardCalls).toBe(3);
    await expect
      .element(qualifierSection().getByRole('article', { name: /Left 3/u }))
      .toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);
    expect(boardCalls()).toBe(3);
    await expect.element(autoRefreshSwitch()).not.toBeChecked();
  });

  test('境界の直後の取得が集計中を返したら、オフでもその後に取り直し、結果が確定すると止める', async () => {
    startClockAt(BEFORE_FULL_TIME);
    respondInTurn(
      liveBoard(BEFORE_FULL_TIME),
      tallyingBoard(),
      tallyingBoard(),
      settledBoard(),
    );
    await renderTopPage();
    await expect.element(qualifierSection()).toBeVisible();
    await turnOffAutoRefresh();

    await vi.advanceTimersByTimeAsync(MINUTE_MS + SECOND_MS);
    await expect.poll(boardCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    await expect.poll(boardCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    await expect.poll(boardCalls).toBe(4);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);

    expect(boardCalls()).toBe(4);
    await expect.element(qualifierStatus()).toHaveTextContent('');
  });

  test('境界の直後の取得がマッチの開始の前を返し続けたら、境界の取り直しから10回で止め、予選の区画の状態の文を開き直しの案内に切り替える', async () => {
    startClockAt(BEFORE_KICKOFF);
    respondInTurn(settledBoard(), {
      ...nextDayBoard(),
      awaitingKickoff: true,
      heldCount: 0,
      matches: [],
      byes: [],
    });
    await renderTopPage();
    await expect.element(qualifierSection()).toBeVisible();
    await turnOffAutoRefresh();

    await vi.advanceTimersByTimeAsync(MINUTE_MS + SECOND_MS);
    await expect.poll(boardCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 8);
    await expect.poll(boardCalls).toBe(10);
    await expect.element(qualifierStatus()).toHaveTextContent('');
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    await expect.poll(boardCalls).toBe(11);

    await expect
      .element(qualifierStatus())
      .toHaveTextContent(FOLLOW_UP_MESSAGE);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);
    expect(boardCalls()).toBe(11);
  });

  test('境界の後にページを開いてからオフにした場合も、表示した時点から10回で止める', async () => {
    startClockAt(AFTER_FULL_TIME);
    respondInTurn(tallyingBoard());
    await renderTopPage();
    await expect.element(qualifierSection()).toBeVisible();

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 3);
    await expect.poll(boardCalls).toBe(4);
    await turnOffAutoRefresh();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 20);

    expect(boardCalls()).toBe(11);
    await expect
      .element(qualifierStatus())
      .toHaveTextContent(FOLLOW_UP_MESSAGE);
  });

  test('自動更新をオンに戻すと、開き直しの案内を消して取り直しを続ける', async () => {
    startClockAt(AFTER_FULL_TIME);
    respondInTurn(tallyingBoard());
    await renderTopPage();
    await expect.element(qualifierSection()).toBeVisible();
    await turnOffAutoRefresh();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 12);
    await expect
      .element(qualifierStatus())
      .toHaveTextContent(FOLLOW_UP_MESSAGE);

    await userEvent.click(autoRefreshSwitch());

    await expect.element(qualifierStatus()).toHaveTextContent('');
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
    await expect.poll(boardCalls).toBe(12);
  });
});
