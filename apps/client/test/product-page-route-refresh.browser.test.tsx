import { notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { emulateBrowserDisplay } from '../lib/test/display-emulation.ts';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import { LIVE_REFRESH_INTERVAL_MS } from '../lib/utilities/query/live-refresh.ts';
import {
  liveMatchOf,
  productLiveMatchOf,
} from '../src/components/product-page/live-match-fixtures.ts';
import { historyLaunchOf } from '../src/components/product-page/match-history-fixtures.ts';
import { productPageViewOf } from '../src/components/product-page/product-page-fixtures.ts';
import {
  BEFORE_FULL_TIME,
  NOON,
  startClockAt,
  SYSTEM_NOTIFY_SCHEDULER,
  TOKYO_JA,
  turnstileWidgets,
} from '../src/components/product-page/product-page-testing.tsx';
import {
  ClientProductLiveMatchDocument,
  ClientProductOwnerStatusDocument,
  ClientProductPageDocument,
} from '../src/graphql/generated/graphql.ts';
import {
  callsOf,
  renderProductRoute,
  respondProductRoute,
} from './product-page-route-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

const SECOND_MS = 1000;

const MINUTE_MS = 60 * SECOND_MS;

// 業務日付2026-11-11のキックオフ(日本時間の0:00)
const NEXT_KICKOFF_AT = '2026-11-10T15:00:00.000Z';

// 業務日付2026-11-10の23:59(日本時間)
const BEFORE_KICKOFF = new Date('2026-11-10T14:59:00.000Z');

const OWNER_VIEW = productPageViewOf({ viewerIsOwner: true });

const main = () => page.getByRole('main');
const liveMatchRegion = () =>
  main().getByRole('region', { name: /を戦っています$/u });
const autoRefreshSwitch = () =>
  main().getByRole('switch', { name: '自動更新' });

const countOf = (document: unknown) => () =>
  callsOf(executeGraphQL, document).length;
const pageCalls = countOf(ClientProductPageDocument);
const liveMatchCalls = countOf(ClientProductLiveMatchDocument);
const ownerStatusCalls = countOf(ClientProductOwnerStatusDocument);

const turnOffAutoRefresh = async (): Promise<void> => {
  await userEvent.click(autoRefreshSwitch());
  await expect.element(autoRefreshSwitch()).not.toBeChecked();
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  await emulateBrowserDisplay(TOKYO_JA);
  notifyManager.setScheduler(queueMicrotask);
});

afterEach(async () => {
  vi.useRealTimers();
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  await emulateBrowserDisplay(null);
});

describe('プロダクト詳細の境界の取り直し', () => {
  test('開催中のマッチの終了の時刻の1秒後に、自動更新がオフでも開催中のマッチ・詳細ページ・投稿者本人向けの照会を取り直す', async () => {
    startClockAt(BEFORE_FULL_TIME);
    respondProductRoute(executeGraphQL, {
      pages: { 'Pitch-Notes': OWNER_VIEW },
      liveMatches: [productLiveMatchOf()],
    });
    await renderProductRoute('/p/Pitch-Notes', { signedIn: true });
    await expect.element(liveMatchRegion()).toBeVisible();
    await expect.poll(ownerStatusCalls).toBe(1);
    await turnOffAutoRefresh();
    const before = { page: pageCalls(), live: liveMatchCalls() };

    await vi.advanceTimersByTimeAsync(MINUTE_MS + SECOND_MS - 1);
    expect(pageCalls()).toBe(before.page);
    expect(liveMatchCalls()).toBe(before.live);
    expect(ownerStatusCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(pageCalls).toBe(before.page + 1);
    await expect.poll(liveMatchCalls).toBe(before.live + 1);
    await expect.poll(ownerStatusCalls).toBe(2);
  });

  test('予約済みのローンチの最も近いキックオフの時刻の1秒後に、開催中のマッチと詳細ページを取り直す', async () => {
    startClockAt(BEFORE_KICKOFF);
    respondProductRoute(executeGraphQL, {
      pages: {
        'Pitch-Notes': productPageViewOf({
          launches: [
            historyLaunchOf({
              id: '01JD0LAUNCH000000000000002',
              number: 2,
              launchDate: '2026-11-11',
              kickoffAt: NEXT_KICKOFF_AT,
              status: 'PAIRED',
              summary: { label: 'キックオフ予定', inMatch: false },
              kickedOff: false,
              latestKickedOff: false,
              matches: [],
            }),
          ],
        }),
      },
      liveMatches: [productLiveMatchOf({ match: null })],
    });
    await renderProductRoute('/p/Pitch-Notes');
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('Pitch Notes');

    await vi.advanceTimersByTimeAsync(MINUTE_MS + SECOND_MS - 1);
    expect(pageCalls()).toBe(1);
    expect(liveMatchCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(pageCalls).toBe(2);
    await expect.poll(liveMatchCalls).toBe(2);
  });
});

describe('プロダクト詳細の開催中のマッチの入れ替わり', () => {
  test('開催中のマッチの結果が確定すると、詳細ページを取り直してマッチ履歴に反映し、bot判定のウィジェットを外す', async () => {
    startClockAt(NOON);
    respondProductRoute(executeGraphQL, {
      pages: { 'Pitch-Notes': productPageViewOf() },
      liveMatches: [
        productLiveMatchOf(),
        productLiveMatchOf({ match: liveMatchOf({ phase: 'FINISHED' }) }),
      ],
    });
    await renderProductRoute('/p/Pitch-Notes');
    await expect.element(liveMatchRegion()).toBeVisible();
    expect(turnstileWidgets()).toHaveLength(1);
    expect(pageCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);

    await expect.element(liveMatchRegion()).not.toBeInTheDocument();
    await expect.poll(pageCalls).toBe(2);
    expect(turnstileWidgets()).toHaveLength(0);
  });

  test('開始を待っていたマッチが始まると、詳細ページを取り直し、開催中のマッチの区画をbot判定で包む', async () => {
    startClockAt(NOON);
    respondProductRoute(executeGraphQL, {
      pages: { 'Pitch-Notes': productPageViewOf() },
      liveMatches: [
        productLiveMatchOf({ awaitingChange: true, match: null }),
        productLiveMatchOf(),
      ],
    });
    await renderProductRoute('/p/Pitch-Notes');
    await expect.element(autoRefreshSwitch()).toBeVisible();
    expect(turnstileWidgets()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);

    await expect.element(liveMatchRegion()).toBeVisible();
    await expect.poll(pageCalls).toBe(2);
    expect(turnstileWidgets()).toHaveLength(1);
  });
});
