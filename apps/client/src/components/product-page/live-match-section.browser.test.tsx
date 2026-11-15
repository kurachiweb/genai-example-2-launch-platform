import { notifyManager, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { RecoverableSlot } from '../../../lib/components/state/recoverable-slot.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { documentIdOf } from '../../../lib/utilities/graphql/persisted-document.ts';
import { LIVE_REFRESH_INTERVAL_MS } from '../../../lib/utilities/query/live-refresh.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientProductLiveMatchDocument,
  type ClientProductLiveMatchQuery,
  ClientUpvoteDocument,
  type MatchFragment,
} from '../../graphql/generated/graphql.ts';
import {
  productLiveMatchQueryOptions,
  productPageQueryOptions,
} from '../../graphql/product-page.ts';
import { toClientViewer } from '../../graphql/viewer.ts';
import { AutoRefreshSwitch } from '../match/auto-refresh-switch.tsx';
import {
  ENTRY_IDS,
  entryOf,
  MATCH_ID,
  matchOf,
} from '../match/match-fixtures.ts';
import { UpvoteBotProtection } from '../match/upvote-bot-protection.tsx';
import { useBoundaryRefresh } from '../time/use-boundary-refresh.ts';
import {
  LIVE_MATCH_ENDS_AT,
  liveMatchOf,
  productLiveMatchOf,
  type ProductLiveMatchView,
} from './live-match-fixtures.ts';
import { LiveMatchSection } from './live-match-section.tsx';
import { productPageViewOf } from './product-page-fixtures.ts';
import type { ProductPageContext } from './product-page-section-types.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const SECOND_MS = 1000;

const MINUTE_MS = 60 * SECOND_MS;

// 業務日付2026-11-10の12:00と、終了の1分前の23:39(日本時間)
const NOON = new Date('2026-11-10T03:00:00.000Z');
const BEFORE_FULL_TIME = new Date('2026-11-10T14:39:00.000Z');

// ページのURLのハンドル(loaderのキー)と現在のハンドル(区画の文脈)は大文字小文字だけが違う
const URL_HANDLE = 'PITCH-NOTES';
const CURRENT_HANDLE = 'Pitch-Notes';

const FOLLOW_UP_MESSAGE =
  '結果の反映に時間がかかっています。ページを再読み込みすると最新の状態を表示します。';

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

const VIEWER_QUERY = signedInViewerQuery();

const VIEWER = toClientViewer(VIEWER_QUERY);

const TALLYING = productLiveMatchOf({
  awaitingChange: true,
  match: liveMatchOf({ phase: 'TALLYING' }),
});

const SETTLED = productLiveMatchOf({ match: null });

const liveMatchResult = (productLiveMatch: ProductLiveMatchView | null) => ({
  ok: true,
  data: { productLiveMatch } satisfies ClientProductLiveMatchQuery,
});

// 取得のたびに先頭の結果を返し、最後の結果は返し続ける
const respondInTurn = (...results: (ProductLiveMatchView | null)[]) => {
  const queue = [...results];
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document !== ClientProductLiveMatchDocument) {
      return Promise.reject(new Error('想定外の操作です。'));
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve(liveMatchResult(next ?? null));
  });
};

const liveMatchCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientProductLiveMatchDocument,
  ).length;

const contextOf = (isOwner: boolean): ProductPageContext => ({
  product: {
    id: '01JD0PRODUCT00000000000001',
    handle: CURRENT_HANDLE,
    name: 'Pitch Notes',
    listed: true,
    ownerHandle: 'scout_ken',
  },
  viewer: { signedIn: true, isOwner },
  page: productPageViewOf({ viewerIsOwner: isOwner }),
  autoRefresh: true,
  reportAutoUpdating: () => undefined,
});

interface HarnessProps {
  readonly isOwner: boolean;
  readonly boundaries: readonly string[];
  readonly onReport: (active: boolean) => void;
}

// 詳細ページと同じく、切り替えの状態をページが持ち、境界の時刻にページが開催中のマッチの取得を無効にする
function PageHarness({ isOwner, boundaries, onReport }: HarnessProps) {
  const queryClient = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(true);
  useBoundaryRefresh(boundaries, () => {
    void queryClient.invalidateQueries({
      queryKey: [documentIdOf(ClientProductLiveMatchDocument)],
    });
  });
  return (
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <TooltipProvider>
        <main
          data-auto-refresh={autoRefresh ? 'on' : 'off'}
          className="flex flex-col gap-4 bg-background p-4 text-foreground"
        >
          <AutoRefreshSwitch
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
          />
          <UpvoteBotProtection>
            <RecoverableSlot contactAvailable={false} contactHref="/contact">
              <LiveMatchSection
                {...contextOf(isOwner)}
                autoRefresh={autoRefresh}
                reportAutoUpdating={onReport}
              />
            </RecoverableSlot>
          </UpvoteBotProtection>
          <Toaster />
        </main>
      </TooltipProvider>
    </DisplayPreferencesProvider>
  );
}

const renderSection = async (
  initial: ProductLiveMatchView | null,
  {
    isOwner = false,
    boundaries = [],
  }: { readonly isOwner?: boolean; readonly boundaries?: string[] } = {},
) => {
  const context = createPageRouterContext('local');
  // ページのloaderがURLのハンドルで読んだ取得を、ハイドレーションで受け取った状態にする
  context.queryClient.setQueryData(
    productLiveMatchQueryOptions(VIEWER, URL_HANDLE).queryKey,
    { productLiveMatch: initial },
  );
  const productPageKey = productPageQueryOptions(VIEWER, URL_HANDLE).queryKey;
  context.queryClient.setQueryData(productPageKey, {
    productPage: productPageViewOf(),
  });
  const onReport = vi.fn<(active: boolean) => void>();
  await renderInRouter(
    <PageHarness
      isOwner={isOwner}
      boundaries={boundaries}
      onReport={onReport}
    />,
    { context, cachedViewer: VIEWER_QUERY, path: `/p/${URL_HANDLE}` },
  );
  return {
    onReport,
    liveMatchData: () =>
      context.queryClient.getQueryData(
        productLiveMatchQueryOptions(VIEWER, CURRENT_HANDLE).queryKey,
      ),
    productPageInvalidated: () =>
      context.queryClient.getQueryState(productPageKey)?.isInvalidated,
  };
};

const section = () => page.getByRole('region', { name: /を戦っています$/u });
const sectionStatus = () => page.getByRole('status');
const countdown = () =>
  page.getByRole('region', { name: 'フルタイムまでの残り時間' });
const matchCard = () =>
  section().getByRole('article', { name: /Pitch Notes.*Tactics Board/u });
const autoRefreshSwitch = () => page.getByRole('switch', { name: '自動更新' });

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

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO_JA);
  executeGraphQL.mockReset();
  resetFakeTurnstile();
});

afterEach(async () => {
  vi.useRealTimers();
  await emulateBrowserDisplay(null);
  notifyManager.setScheduler(SYSTEM_NOTIFY_SCHEDULER);
  applyColorScheme('light');
  toast.dismiss();
});

describe('LiveMatchSection', () => {
  describe('描画', () => {
    test('マッチ中は、LIVEの印と種別の見出し・閲覧者への説明・残り時間・対戦カードを描き、loaderの取得を取り直さない', async () => {
      startClockAt(NOON);
      respondInTurn(productLiveMatchOf());
      await renderSection(productLiveMatchOf());

      await expect
        .element(section())
        .toHaveAccessibleName('LIVE 予選を戦っています');
      await expect
        .element(section().getByRole('heading', { level: 2 }))
        .toHaveAttribute('id', 'live-match-heading');
      await expect
        .element(section().getByText('LIVE', { exact: true }))
        .toHaveAttribute('translate', 'no');
      await expect
        .element(section().getByText('Upvoteで応援しましょう！'))
        .toBeVisible();
      await expect.element(countdown()).toHaveTextContent(/\(23:40終了\)/u);
      await expect.element(matchCard()).toBeVisible();
      await expect.element(sectionStatus()).toHaveTextContent('');
      expect(liveMatchCalls()).toBe(0);
    });

    test('投稿者本人には応援が集まっている旨を説明する', async () => {
      await renderSection(productLiveMatchOf(), { isOwner: true });

      await expect
        .element(section().getByText('サポーターの応援が集まっています。'))
        .toBeVisible();
      await expect
        .element(section().getByText('Upvoteで応援しましょう！'))
        .not.toBeInTheDocument();
    });

    test('トーナメントのマッチは、対戦カードと同じ種別の印で見出しを描く', async () => {
      await renderSection(
        productLiveMatchOf({
          match: liveMatchOf({ kind: 'WEEK', stage: 'SEMIFINAL', round: 2 }),
        }),
      );

      await expect
        .element(section())
        .toHaveAccessibleName('LIVE Week 準決勝を戦っています');
    });

    test('集計中は、見出しと対戦カードを描き、説明と残り時間を描かない', async () => {
      await renderSection(TALLYING);

      await expect.element(matchCard()).toBeVisible();
      await expect
        .element(section().getByText('Upvoteで応援しましょう！'))
        .not.toBeInTheDocument();
      await expect.element(countdown()).not.toBeInTheDocument();
    });

    test.each([
      ['開催中のマッチが無い', SETTLED],
      ['表示できないプロダクト', null],
    ])('%s時は何も描かない', async (_label, initial) => {
      await renderSection(initial);

      await expect.element(autoRefreshSwitch()).toBeVisible();
      await expect.element(section()).not.toBeInTheDocument();
      await expect.element(sectionStatus()).not.toBeInTheDocument();
    });

    test('マッチの開始を待つ間は、見出しと対戦カードを描かずに状態の文の領域だけを置く', async () => {
      await renderSection(
        productLiveMatchOf({ awaitingChange: true, match: null }),
      );

      await expect.element(sectionStatus()).toBeInTheDocument();
      await expect.element(sectionStatus()).toHaveTextContent('');
      await expect.element(section()).not.toBeInTheDocument();
    });

    test.each(COLOR_SCHEMES)(
      '%sの配色でaxeの違反が0件である',
      async (scheme) => {
        applyColorScheme(scheme);
        await renderSection(productLiveMatchOf());
        await expect.element(matchCard()).toBeVisible();

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });

  describe('定期の取り直し', () => {
    test('自動更新がオンのマッチ中は30秒ごとに取り直し、オフにした後は間隔の数倍進めても取り直さない', async () => {
      startClockAt(NOON);
      respondInTurn(productLiveMatchOf());
      await renderSection(productLiveMatchOf());
      await expect.element(matchCard()).toBeVisible();

      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
      expect(liveMatchCalls()).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      await expect.poll(liveMatchCalls).toBe(1);

      await turnOffAutoRefresh();
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);

      expect(liveMatchCalls()).toBe(1);
      await expect.element(countdown()).not.toHaveTextContent(/フルタイム/u);
    });

    test('オフで変化を待つ間は表示した時点から10回まで取り直し、上限で状態の文を開き直しの案内に切り替える', async () => {
      startClockAt(NOON);
      respondInTurn(TALLYING);
      await renderSection(TALLYING);
      await expect.element(matchCard()).toBeVisible();
      await turnOffAutoRefresh();

      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 9);
      await expect.poll(liveMatchCalls).toBe(9);
      await expect.element(sectionStatus()).toHaveTextContent('');
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
      await expect.poll(liveMatchCalls).toBe(10);

      await expect
        .element(sectionStatus())
        .toHaveTextContent(FOLLOW_UP_MESSAGE);
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);
      expect(liveMatchCalls()).toBe(10);
    });

    test('オンで変化を待つ間は上限を超えても取り直し続け、状態の文を案内に替えない', async () => {
      startClockAt(NOON);
      respondInTurn(TALLYING);
      await renderSection(TALLYING);
      await expect.element(matchCard()).toBeVisible();

      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 12);

      await expect.poll(liveMatchCalls).toBe(12);
      await expect.element(sectionStatus()).toHaveTextContent('');
    });

    test('マッチの開始を待つ間もオフで上限に達すると、状態の文を開き直しの案内に切り替える', async () => {
      startClockAt(NOON);
      const awaiting = productLiveMatchOf({
        awaitingChange: true,
        match: null,
      });
      respondInTurn(awaiting);
      await renderSection(awaiting);
      await expect.element(sectionStatus()).toBeInTheDocument();
      await turnOffAutoRefresh();

      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 15);

      expect(liveMatchCalls()).toBe(10);
      await expect
        .element(sectionStatus())
        .toHaveTextContent(FOLLOW_UP_MESSAGE);
    });

    test('ページが終了の時刻の1秒後に取り直すと、その取り直しを1回目に数えて10回で止める', async () => {
      startClockAt(BEFORE_FULL_TIME);
      respondInTurn(TALLYING);
      await renderSection(productLiveMatchOf(), {
        boundaries: [LIVE_MATCH_ENDS_AT],
      });
      await expect.element(matchCard()).toBeVisible();
      await turnOffAutoRefresh();

      await vi.advanceTimersByTimeAsync(MINUTE_MS + SECOND_MS - 1);
      expect(liveMatchCalls()).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      await expect.poll(liveMatchCalls).toBe(1);
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 9);
      await expect.poll(liveMatchCalls).toBe(10);

      await expect
        .element(sectionStatus())
        .toHaveTextContent(FOLLOW_UP_MESSAGE);
      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS * 5);
      expect(liveMatchCalls()).toBe(10);
    });
  });

  describe('確定の反映と申告', () => {
    test('取り直しでマッチが無くなると区画を外し、詳細ページの取得を無効にして申告を取り消す', async () => {
      startClockAt(NOON);
      respondInTurn(SETTLED);
      const { onReport, productPageInvalidated } =
        await renderSection(productLiveMatchOf());
      await expect.element(matchCard()).toBeVisible();
      expect(onReport).toHaveBeenLastCalledWith(true);
      expect(productPageInvalidated()).toBe(false);

      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);

      await expect.element(section()).not.toBeInTheDocument();
      await expect.poll(productPageInvalidated).toBe(true);
      expect(onReport).toHaveBeenLastCalledWith(false);
    });

    test('取り直しでマッチの結果が確定すると、詳細ページの取得を無効にする', async () => {
      startClockAt(NOON);
      respondInTurn(
        productLiveMatchOf({
          match: liveMatchOf({ phase: 'FINISHED', decision: 'VOTES' }),
        }),
      );
      const { productPageInvalidated } = await renderSection(TALLYING);
      await expect.element(matchCard()).toBeVisible();

      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);

      await expect.poll(productPageInvalidated).toBe(true);
      await expect.element(section()).not.toBeInTheDocument();
    });

    test('変化を待たないマッチ中の取り直しでは、詳細ページの取得を無効にしない', async () => {
      startClockAt(NOON);
      respondInTurn(productLiveMatchOf());
      const { productPageInvalidated } =
        await renderSection(productLiveMatchOf());
      await expect.element(matchCard()).toBeVisible();

      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);
      await expect.poll(liveMatchCalls).toBe(1);

      expect(productPageInvalidated()).toBe(false);
    });

    test('マッチの開始を待つ間の取り直しでマッチが始まると、キックオフの後の表示へ替えるため詳細ページの取得を無効にする', async () => {
      startClockAt(NOON);
      respondInTurn(productLiveMatchOf());
      const { productPageInvalidated } = await renderSection(
        productLiveMatchOf({ awaitingChange: true, match: null }),
      );
      await expect.element(sectionStatus()).toBeInTheDocument();
      expect(productPageInvalidated()).toBe(false);

      await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS);

      await expect.element(matchCard()).toBeVisible();
      await expect.poll(productPageInvalidated).toBe(true);
    });

    test('マッチの開始を待つ間は申告する', async () => {
      const awaiting = await renderSection(
        productLiveMatchOf({ awaitingChange: true, match: null }),
      );
      await expect.element(sectionStatus()).toBeInTheDocument();
      expect(awaiting.onReport).toHaveBeenLastCalledWith(true);
    });

    test('開催中のマッチも変化を待つ状態も無ければ申告しない', async () => {
      const { onReport } = await renderSection(SETTLED);
      await expect.element(autoRefreshSwitch()).toBeVisible();

      expect(onReport).toHaveBeenLastCalledWith(false);
    });
  });

  describe('Upvoteの結果の反映', () => {
    test('Upvoteの結果で開催中のマッチの取得のマッチだけを差し替え、取り直さない', async () => {
      // 操作の結果のマッチは終了の時刻を持たない
      const fragment: MatchFragment = matchOf({
        viewerUpvotedEntryId: ENTRY_IDS.left,
        entries: [
          entryOf('left', { upvoteCount: 13 }),
          entryOf('right', { upvoteCount: 9 }),
        ],
      });
      executeGraphQL.mockImplementation((document: unknown) =>
        document === ClientUpvoteDocument
          ? Promise.resolve({ ok: true, data: { upvote: fragment } })
          : Promise.reject(new Error('想定外の操作です。')),
      );
      const { liveMatchData } = await renderSection(productLiveMatchOf());
      await userEvent.click(
        page.getByRole('button', { name: '判定を成功させる' }),
      );

      await userEvent.click(
        section().getByRole('button', { name: /^Pitch NotesにUpvote/u }),
      );

      await expect
        .element(
          section().getByRole('button', {
            name: /^Pitch NotesへのUpvoteを取り消す/u,
          }),
        )
        .toHaveAccessibleName(/13\s*票$/u);
      expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
        ClientUpvoteDocument,
        { input: { matchId: MATCH_ID, entryId: ENTRY_IDS.left } },
        { turnstileToken: 'turnstile-token-1' },
      );
      expect(liveMatchData()?.productLiveMatch?.match).toStrictEqual({
        ...fragment,
        endsAt: LIVE_MATCH_ENDS_AT,
      });
    });
  });
});
