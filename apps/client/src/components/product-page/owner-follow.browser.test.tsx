import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientFollowUserDocument,
  ClientOwnerFollowStatusDocument,
  type ClientOwnerFollowStatusQuery,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { ownerFollowStatusQueryOptions } from '../../graphql/product-page.ts';
import { publicProfileQueryOptions } from '../../graphql/public-profile.ts';
import { toClientViewer } from '../../graphql/viewer.ts';
import { OwnerFollow } from './owner-follow.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const OWNER_HANDLE = 'scout_ken';

const VIEWER_QUERY = signedInViewerQuery();

const VIEWER = toClientViewer(VIEWER_QUERY);

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const statusOf = (
  viewerRelation: 'OWNER' | 'FOLLOWING' | 'NOT_FOLLOWING',
): ClientOwnerFollowStatusQuery => ({
  publicProfile: { __typename: 'PublicProfile', viewerRelation },
});

// フォロー中の照会には指定の結果を、フォローには成功の結果を返す
const respondWith = (status: ClientOwnerFollowStatusQuery | Error) => {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientOwnerFollowStatusDocument) {
      return Promise.resolve(
        status instanceof Error
          ? { ok: false, error: status }
          : { ok: true, data: status },
      );
    }
    if (document === ClientFollowUserDocument) {
      return Promise.resolve({
        ok: true,
        data: {
          followUser: {
            handle: OWNER_HANDLE,
            following: true,
            followerCount: 8,
          },
        },
      });
    }
    return Promise.reject(new Error('想定外の操作です。'));
  });
};

const statusCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientOwnerFollowStatusDocument,
  );

interface RenderOptions {
  readonly viewerIsOwner?: boolean;
  readonly viewerQuery?: ClientViewerQuery;
}

const renderFollow = async ({
  viewerIsOwner = false,
  viewerQuery = VIEWER_QUERY,
}: RenderOptions = {}): Promise<QueryClient> => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <TooltipProvider>
      <main className="bg-background p-4 text-foreground">
        <OwnerFollow ownerHandle={OWNER_HANDLE} viewerIsOwner={viewerIsOwner} />
      </main>
      <Toaster />
    </TooltipProvider>,
    { context, cachedViewer: viewerQuery, path: '/p/Pitch-Notes' },
  );
  return context.queryClient;
};

const followButton = () => page.getByRole('button', { name: 'フォロー' });
const followingButton = () => page.getByRole('button', { name: 'フォロー中' });

const passBotCheck = () =>
  userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('OwnerFollow', () => {
  test('フォロー中なら、照会の結果を初期状態にして「フォロー中」を押されている状態で示す', async () => {
    respondWith(statusOf('FOLLOWING'));
    await renderFollow();

    await expect
      .element(followingButton())
      .toHaveAttribute('aria-pressed', 'true');
    expect(statusCalls()).toStrictEqual([
      [
        ClientOwnerFollowStatusDocument,
        { handle: OWNER_HANDLE },
        expect.anything(),
      ],
    ]);
  });

  test('フォローしていなければ「フォロー」を押されていない状態で示す', async () => {
    respondWith(statusOf('NOT_FOLLOWING'));
    await renderFollow();

    await expect
      .element(followButton())
      .toHaveAttribute('aria-pressed', 'false');
  });

  test('照会に失敗したらボタンを描かない', async () => {
    respondWith(INTERNAL_ERROR);
    await renderFollow();

    await expect.poll(() => statusCalls().length).toBe(1);
    await expect.element(page.getByRole('main')).toBeEmptyDOMElement();
    expect(page.getByRole('button').elements()).toStrictEqual([]);
  });

  test('照会の結果が届くまではボタンを描かない', async () => {
    executeGraphQL.mockReturnValue(new Promise(() => undefined));
    await renderFollow();

    await expect.poll(() => statusCalls().length).toBe(1);
    expect(page.getByRole('button').elements()).toStrictEqual([]);
  });

  test.each([
    ['投稿者が見つからない', { publicProfile: null }],
    [
      '投稿者のハンドルが変わった',
      { publicProfile: { __typename: 'PublicProfileRedirect' } },
    ],
    ['照会では本人だった', statusOf('OWNER')],
  ] as const)('%s時はボタンを描かない', async (_case, status) => {
    respondWith(status);
    await renderFollow();

    await expect.poll(() => statusCalls().length).toBe(1);
    await expect.element(page.getByRole('main')).toBeEmptyDOMElement();
  });

  test('投稿者本人には照会せず、ボタンを描かない', async () => {
    respondWith(statusOf('NOT_FOLLOWING'));
    await renderFollow({ viewerIsOwner: true });

    await expect.element(page.getByRole('main')).toBeEmptyDOMElement();
    expect(statusCalls()).toStrictEqual([]);
  });

  test('未ログインの閲覧者には照会せず、ログインの案内のボタンを示す', async () => {
    respondWith(statusOf('NOT_FOLLOWING'));
    await renderFollow({ viewerQuery: GUEST_VIEWER_QUERY });

    await userEvent.click(followButton());

    await expect
      .element(
        page.getByRole('dialog', { name: 'フォローにはログインが必要です' }),
      )
      .toBeVisible();
    expect(statusCalls()).toStrictEqual([]);
  });

  test('フォローした後は照会の結果を合わせ、相手の公開プロフィールの取得を捨てる', async () => {
    respondWith(statusOf('NOT_FOLLOWING'));
    const queryClient = await renderFollow();
    const profileKey = publicProfileQueryOptions(VIEWER, OWNER_HANDLE).queryKey;
    queryClient.setQueryData(profileKey, { publicProfile: null });
    await passBotCheck();
    expect(lastTurnstileProps().options?.action).toBe('follow');

    await userEvent.click(followButton());

    await expect
      .element(followingButton())
      .toHaveAttribute('aria-pressed', 'true');
    expect(
      queryClient.getQueryData(
        ownerFollowStatusQueryOptions(VIEWER, OWNER_HANDLE).queryKey,
      ),
    ).toStrictEqual(statusOf('FOLLOWING'));
    expect(queryClient.getQueryData(profileKey)).toBeUndefined();
    expect(statusCalls()).toHaveLength(1);
  });

  test.each(
    (['FOLLOWING', 'NOT_FOLLOWING'] as const).flatMap((relation) =>
      COLOR_SCHEMES.map((scheme) => [relation, scheme] as const),
    ),
  )('%s・%sの配色でaxeの違反が0件である', async (relation, scheme) => {
    applyColorScheme(scheme);
    respondWith(statusOf(relation));
    await renderFollow();

    await expect
      .element(relation === 'FOLLOWING' ? followingButton() : followButton())
      .toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
