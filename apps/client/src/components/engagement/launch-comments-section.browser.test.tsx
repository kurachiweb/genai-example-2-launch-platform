import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import {
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientLaunchCommentCountsDocument,
  ClientLaunchCommentsDocument,
  ClientPostCommentDocument,
  ClientProductRatingDocument,
  ClientViewerDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { historyLaunchOf } from '../product-page/match-history-fixtures.ts';
import type { ProductPageLaunchView } from '../product-page/match-history-model.ts';
import { MatchHistorySection } from '../product-page/match-history-section.tsx';
import { productPageViewOf } from '../product-page/product-page-fixtures.ts';
import type { ProductLaunchSection } from '../product-page/product-page-section-types.ts';
import {
  button,
  callsOf,
  commentOf,
  deferred,
  INTERNAL_ERROR,
  ok,
  pageOf,
  passBotCheck,
  POST_PLACEHOLDER,
  type Responder,
  threadOf,
  typeInto,
} from './comment-thread-testing.tsx';
import { LaunchCommentsSection } from './launch-comments-section.tsx';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const PRODUCT_ID = '01JD0PRODUCT00000000000001';

const NOT_COMMENTABLE = 'キックオフ後にコメントできるようになります。';

const LAUNCH_3 = '01JD0LAUNCH000000000000003';

const LAUNCH_2 = '01JD0LAUNCH000000000000002';

const LAUNCH_1 = '01JD0LAUNCH000000000000001';

const LAUNCHES: readonly ProductPageLaunchView[] = [
  historyLaunchOf({
    id: LAUNCH_3,
    number: 3,
    launchDate: '2026-11-15',
    status: 'SCHEDULED',
    summary: { label: 'キックオフ予定', inMatch: false },
    kickedOff: false,
    latestKickedOff: false,
    matches: [],
  }),
  historyLaunchOf({
    id: LAUNCH_2,
    number: 2,
    launchDate: '2026-10-20',
    kickedOff: true,
    latestKickedOff: true,
  }),
  historyLaunchOf({
    id: LAUNCH_1,
    number: 1,
    launchDate: '2025-09-15',
    kickedOff: true,
    latestKickedOff: false,
  }),
];

const SECTIONS: readonly ProductLaunchSection[] = [
  { id: 'engagement.comments', order: 10, component: LaunchCommentsSection },
];

const COUNTS = Object.freeze({
  launchCommentCounts: [
    { launchId: LAUNCH_3, count: 0 },
    { launchId: LAUNCH_2, count: 1234 },
    { launchId: LAUNCH_1, count: 0 },
  ],
});

const RATING = Object.freeze({
  productRating: {
    productId: PRODUCT_ID,
    average: null,
    count: 0,
    viewerScore: null,
  },
});

interface RenderOptions {
  readonly viewer?: ClientViewerQuery;
  readonly counts?: Responder;
  readonly pages?: Responder;
  readonly mutations?: ReadonlyMap<unknown, Responder>;
}

const respondWith = ({
  viewer,
  counts,
  pages,
  mutations,
}: Required<RenderOptions>) => {
  const responders = new Map<unknown, Responder>([
    [ClientLaunchCommentCountsDocument, counts],
    [ClientLaunchCommentsDocument, pages],
    [ClientProductRatingDocument, () => ok(RATING)],
    [ClientViewerDocument, () => ok(viewer)],
    ...mutations,
  ]);
  vi.mocked(executeGraphQL).mockImplementation(async (document, variables) => {
    const respond = responders.get(document);
    if (respond === undefined) {
      throw new Error('想定していない操作が実行されました。');
    }
    const result = await respond(variables as Record<string, unknown>);
    return (
      result instanceof Error ? { ok: false, error: result } : result
    ) as never;
  });
};

const renderBlocks = async ({
  viewer = signedInViewerQuery(),
  counts = () => ok(COUNTS),
  pages = () => ok(pageOf([])),
  mutations = new Map(),
}: RenderOptions = {}): Promise<void> => {
  respondWith({ viewer, counts, pages, mutations });
  await renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <TooltipProvider>
        <main className="bg-background p-4 text-foreground">
          <MatchHistorySection
            product={{
              id: PRODUCT_ID,
              handle: 'Pitch-Notes',
              name: 'Pitch Notes',
              listed: true,
              ownerHandle: 'scout_ken',
            }}
            viewer={{ signedIn: viewer.viewer !== null, isOwner: false }}
            page={productPageViewOf({ launches: [...LAUNCHES] })}
            autoRefresh
            reportAutoUpdating={() => undefined}
            launchSections={SECTIONS}
          />
        </main>
        <Toaster />
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    {
      path: '/p/Pitch-Notes',
      context: createPageRouterContext('local'),
      cachedViewer: viewer,
    },
  );
};

const block = (number: number) =>
  page.getByRole('article', { name: `第${String(number)}回ローンチ` });

const commentsOf = (number: number) =>
  page.getByRole('region', {
    name: `第${String(number)}回ローンチへのコメント`,
  });

// 「コメント」と、取得できた時だけ添える件数
const TOGGLE_NAME = /^コメント(?: [\d,]+件)?$/u;

const toggleOf = (number: number) =>
  commentsOf(number).getByRole('button', { name: TOGGLE_NAME });

const targetOf = (animation: Animation): Element | null =>
  animation.effect instanceof KeyframeEffect ? animation.effect.target : null;

// 押したボタン自身の色と輪郭の変化は操作に直接応える動きのため、それ以外の動きを数える
const runningAnimationsIn = (
  element: Element,
  except: Element | null = null,
): Animation[] =>
  element
    .getAnimations({ subtree: true })
    .filter(
      (animation) =>
        animation.playState === 'running' &&
        (except === null || targetOf(animation) !== except),
    );

beforeEach(() => {
  vi.mocked(executeGraphQL).mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('LaunchCommentsSection', () => {
  test('キックオフ前のローンチのブロックには開閉のボタンと一覧の代わりに「キックオフ後にコメントできるようになります。」だけを示す', async () => {
    await renderBlocks();

    await expect
      .element(block(3).getByText(NOT_COMMENTABLE, { exact: true }))
      .toBeVisible();
    expect(commentsOf(3).query()).toBeNull();
    expect(block(3).getByRole('button', { name: TOGGLE_NAME }).query()).toBe(
      null,
    );
    expect(block(2).getByText(NOT_COMMENTABLE).query()).toBeNull();
  });

  test('キックオフ済みのローンチごとに名前「第{n}回ローンチへのコメント」の区画と、3桁区切りの件数を添えた「コメント」の開閉のボタンを置く', async () => {
    await renderBlocks();

    await expect.element(toggleOf(2)).toHaveAccessibleName('コメント 1,234件');
    await expect.element(toggleOf(1)).toHaveAccessibleName('コメント 0件');
  });

  test('キックオフ済みで最も新しいローンチだけを既定で開き、開いている欄のコメントだけを取得する', async () => {
    await renderBlocks({
      pages: ({ launchId }) =>
        ok(
          pageOf(
            launchId === LAUNCH_2
              ? [threadOf(commentOf(1, { body: '第2回の感想' }))]
              : [],
          ),
        ),
    });

    await expect.element(commentsOf(2).getByText('第2回の感想')).toBeVisible();
    await expect.element(toggleOf(2)).toHaveAttribute('aria-expanded', 'true');
    await expect.element(toggleOf(1)).toHaveAttribute('aria-expanded', 'false');
    expect(commentsOf(1).getByRole('article').query()).toBeNull();
    expect(
      callsOf(ClientLaunchCommentsDocument).map(({ launchId }) => launchId),
    ).toStrictEqual([LAUNCH_2]);
  });

  test('開閉のボタンが操作する欄をaria-controlsで指し、押すと開閉の状態とともに欄を開閉する', async () => {
    await renderBlocks();
    const toggle = toggleOf(1);
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
    const panelId = toggle.element().getAttribute('aria-controls');
    expect(panelId).not.toBeNull();
    const panel = () => document.getElementById(panelId ?? '');
    expect(panel()?.hidden).toBe(true);

    await userEvent.click(toggle);

    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel()?.hidden).toBe(false);
    await expect
      .element(commentsOf(1).getByText('まだコメントはありません。'))
      .toBeVisible();
    expect(
      callsOf(ClientLaunchCommentsDocument).map(({ launchId }) => launchId),
    ).toStrictEqual([LAUNCH_2, LAUNCH_1]);

    await userEvent.click(toggle);

    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel()?.hidden).toBe(true);
    expect(commentsOf(1).getByText('まだコメントはありません。').query()).toBe(
      null,
    );
  });

  test('キーボードで開閉のボタンを操作できる', async () => {
    await renderBlocks();
    toggleOf(1).element().focus();

    await userEvent.keyboard('{Enter}');
    await expect.element(toggleOf(1)).toHaveAttribute('aria-expanded', 'true');

    await userEvent.keyboard(' ');
    await expect.element(toggleOf(1)).toHaveAttribute('aria-expanded', 'false');
  });

  test('件数は同じプロダクトの全てのブロックで1回の取得を共有する', async () => {
    await renderBlocks();
    await expect.element(toggleOf(2)).toHaveAccessibleName('コメント 1,234件');
    await expect.element(toggleOf(1)).toHaveAccessibleName('コメント 0件');

    expect(callsOf(ClientLaunchCommentCountsDocument)).toStrictEqual([
      { productId: PRODUCT_ID },
    ]);
  });

  test('件数の取得に失敗しても件数を出さずに「コメント」の開閉のボタンを示し、欄を開ける', async () => {
    await renderBlocks({
      counts: () => INTERNAL_ERROR,
      pages: () => ok(pageOf([threadOf(commentOf(1, { body: '感想' }))])),
    });

    await expect.element(commentsOf(2).getByText('感想')).toBeVisible();
    await expect
      .poll(() => callsOf(ClientLaunchCommentCountsDocument).length)
      .toBeGreaterThan(0);
    await expect.element(toggleOf(2)).toHaveAccessibleName('コメント');
    await expect.element(toggleOf(1)).toHaveAccessibleName('コメント');
    expect(page.getByRole('alert').query()).toBeNull();

    await userEvent.click(toggleOf(1));

    await expect.element(toggleOf(1)).toHaveAttribute('aria-expanded', 'true');
  });

  test('件数の取得を待つ間も件数を出さずに開閉のボタンを示す', async () => {
    const { gate, release } = deferred();
    await renderBlocks({
      counts: async () => {
        await gate;
        return ok(COUNTS);
      },
    });

    await expect.element(toggleOf(2)).toHaveAccessibleName('コメント');

    release();

    await expect.element(toggleOf(2)).toHaveAccessibleName('コメント 1,234件');
  });

  test('投稿の成功で件数を取り直し、開閉のボタンの件数を更新する', async () => {
    const posted = commentOf(9, { body: '新しいコメント' });
    let counted = 0;
    await renderBlocks({
      counts: () => {
        counted += 1;
        return ok({
          launchCommentCounts: [
            { launchId: LAUNCH_2, count: counted === 1 ? 0 : 1 },
            { launchId: LAUNCH_1, count: 0 },
          ],
        });
      },
      mutations: new Map([
        [
          ClientPostCommentDocument,
          () => ok({ postComment: { comment: posted, rating: null } }),
        ],
      ]),
    });
    await expect.element(toggleOf(2)).toHaveAccessibleName('コメント 0件');

    await typeInto(POST_PLACEHOLDER, '新しいコメント');
    await passBotCheck();
    await userEvent.click(button('コメントする'));

    await expect.element(page.getByText('コメントしました。')).toBeVisible();
    await expect.element(toggleOf(2)).toHaveAccessibleName('コメント 1件');
    await expect.element(toggleOf(1)).toHaveAccessibleName('コメント 0件');
  });

  test('開閉の矢印の向きのほかに、開閉の前後で動いている要素が無い', async () => {
    await renderBlocks({ viewer: GUEST_VIEWER_QUERY });
    await expect
      .element(commentsOf(2).getByText('まだコメントはありません。'))
      .toBeVisible();
    const region = commentsOf(2).element();
    await expect.poll(() => runningAnimationsIn(region)).toHaveLength(0);

    const toggle = toggleOf(2).element();

    await userEvent.click(toggleOf(2));

    await expect.element(toggleOf(2)).toHaveAttribute('aria-expanded', 'false');
    expect(runningAnimationsIn(region, toggle)).toHaveLength(0);

    await userEvent.click(toggleOf(2));

    await expect
      .element(commentsOf(2).getByText('まだコメントはありません。'))
      .toBeVisible();
    expect(runningAnimationsIn(region, toggle)).toHaveLength(0);
    await expect.poll(() => runningAnimationsIn(region)).toHaveLength(0);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('キックオフ前の文言・開いた欄・閉じた欄のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderBlocks({
      pages: () => ok(pageOf([threadOf(commentOf(1))])),
    });
    await expect.element(commentsOf(2).getByRole('article')).toBeVisible();
    await expect.element(toggleOf(2)).toHaveAccessibleName('コメント 1,234件');

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
