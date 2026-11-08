import { useState } from 'react';
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
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  signedInViewerQuery,
  VIEWER_HANDLE,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientFollowUserDocument,
  ClientUnfollowUserDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { FollowButton, type FollowButtonProps } from './follow-button.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const TARGET = { handle: 'maker_ai' };

const FOLLOWED_MESSAGE = '@maker_aiをフォローしました。';

const UNFOLLOWED_MESSAGE = '@maker_aiのフォローを解除しました。';

const LOGIN_REQUIRED_TITLE = 'フォローにはログインが必要です';

const EMAIL_UNVERIFIED_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

const TARGET_UNAVAILABLE_MESSAGE = 'このユーザーはフォローできません。';

const VERIFIED_VIEWER = signedInViewerQuery();

const UNVERIFIED_VIEWER = signedInViewerQuery({ emailVerified: false });

const renderButton = (
  props: Partial<FollowButtonProps> = {},
  viewerQuery: ClientViewerQuery = VERIFIED_VIEWER,
  path = '/',
) =>
  renderInRouter(
    <TooltipProvider>
      <FollowButton target={TARGET} initialFollowing={false} {...props} />
      <Toaster />
    </TooltipProvider>,
    { cachedViewer: viewerQuery, path },
  );

function InitialFollowingHarness({ start }: { readonly start: boolean }) {
  const [initialFollowing, setInitialFollowing] = useState(start);
  return (
    <TooltipProvider>
      <FollowButton target={TARGET} initialFollowing={initialFollowing} />
      <button
        type="button"
        onClick={() => {
          setInitialFollowing((current) => !current);
        }}
      >
        初期値を反転する
      </button>
      <Toaster />
    </TooltipProvider>
  );
}

const followButton = () => page.getByRole('button', { name: 'フォロー' });
const followingButton = () => page.getByRole('button', { name: 'フォロー中' });

const passBotCheck = () =>
  userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const respondWithState = (following: boolean, followerCount: number) => {
  executeGraphQL.mockResolvedValue({
    ok: true,
    data: {
      followUser: { handle: TARGET.handle, following, followerCount },
      unfollowUser: { handle: TARGET.handle, following, followerCount },
    },
  });
};

const respondWithFailure = (code: string, status: number, message: string) => {
  executeGraphQL.mockResolvedValue({
    ok: false,
    error: new GraphQLClientError({ code, message, status }),
  });
};

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('FollowButton', () => {
  describe('未ログインの閲覧者', () => {
    test('「フォロー」は押せる状態で、押すとフォローせずにログインが必要な旨のダイアログを開く', async () => {
      await renderButton({}, GUEST_VIEWER_QUERY);

      await expect.element(followButton()).toBeEnabled();
      await userEvent.click(followButton());

      const dialog = page.getByRole('dialog', { name: LOGIN_REQUIRED_TITLE });
      await expect.element(dialog).toBeVisible();
      await expect
        .element(
          dialog.getByText(
            'ログインすると、フォローしたユーザーのプロダクトがキックオフする日にメールでお知らせします。',
          ),
        )
        .toBeVisible();
      expect(executeGraphQL).not.toHaveBeenCalled();
    });

    test('ダイアログのログインのリンクは、現在のパスを戻り先にする', async () => {
      await renderButton({}, GUEST_VIEWER_QUERY, '/products?tab=new');

      await userEvent.click(followButton());

      await expect
        .element(page.getByRole('link', { name: 'ログイン' }))
        .toHaveAttribute(
          'href',
          `/auth/login?redirect=${encodeURIComponent('/products?tab=new')}`,
        );
    });

    test('bot判定のウィジェットは置かない', async () => {
      await renderButton({}, GUEST_VIEWER_QUERY);

      expect(
        document.querySelector('[data-testid="fake-turnstile"]'),
      ).toBeNull();
    });
  });

  describe('メールアドレス未確認の利用者', () => {
    test('ボタンを無効にし、理由をボタンの説明に結び付ける', async () => {
      await renderButton({}, UNVERIFIED_VIEWER);

      await expect.element(followButton()).toBeDisabled();
      await expect
        .element(followButton())
        .toHaveAccessibleDescription(EMAIL_UNVERIFIED_REASON);
      await userEvent.click(followButton(), { force: true });
      expect(executeGraphQL).not.toHaveBeenCalled();
    });

    test('ポインターを重ねると、理由をツールチップで示す', async () => {
      await renderButton({}, UNVERIFIED_VIEWER);

      const trigger = document.querySelector(
        '[data-slot="follow-button-unverified"]',
      );
      expect(trigger).not.toBeNull();
      await userEvent.hover(page.elementLocator(trigger as Element));

      await expect
        .element(page.getByRole('tooltip'))
        .toHaveTextContent(EMAIL_UNVERIFIED_REASON);
    });
  });

  describe('本人', () => {
    test('何も描かない(ハンドルの大文字小文字は区別しない)', async () => {
      await renderButton({ target: { handle: VIEWER_HANDLE.toUpperCase() } });

      await expect.element(followButton()).not.toBeInTheDocument();
      expect(
        document.querySelector('[data-testid="fake-turnstile"]'),
      ).toBeNull();
    });
  });

  describe('フォロー', () => {
    test('bot対策の判定を`follow`の操作として非表示で置く', async () => {
      await renderButton();

      expect(lastTurnstileProps().options?.action).toBe('follow');
      expect(lastTurnstileProps().options?.size).toBe('invisible');
    });

    test('押すと判定のトークンを付けてフォローし、ラベル・押下の状態・トースト・onChangeを更新する', async () => {
      respondWithState(true, 13);
      const onChange = vi.fn();
      await renderButton({ onChange });
      await passBotCheck();

      await userEvent.click(followButton());

      await expect
        .element(followingButton())
        .toHaveAttribute('aria-pressed', 'true');
      await expect.element(page.getByText(FOLLOWED_MESSAGE)).toBeVisible();
      expect(executeGraphQL).toHaveBeenCalledTimes(1);
      expect(executeGraphQL).toHaveBeenCalledWith(
        ClientFollowUserDocument,
        { handle: TARGET.handle },
        { turnstileToken: 'turnstile-token-1' },
      );
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        following: true,
        followerCount: 13,
      });
    });

    test('送信中は処理中を示し、重ねての押下では送らない', async () => {
      const pending = deferred<unknown>();
      executeGraphQL.mockReturnValue(pending.promise);
      await renderButton();
      await passBotCheck();

      await userEvent.click(followButton());
      const busy = followingButton();
      await expect.element(busy).toHaveAttribute('aria-busy', 'true');
      await expect.element(busy).toHaveAttribute('aria-disabled', 'true');
      (busy.element() as HTMLElement).focus();
      await userEvent.keyboard('{Enter}');
      expect(executeGraphQL).toHaveBeenCalledTimes(1);

      pending.resolve({
        ok: true,
        data: {
          followUser: {
            handle: TARGET.handle,
            following: true,
            followerCount: 1,
          },
        },
      });
      await expect.element(followingButton()).not.toHaveAttribute('aria-busy');
    });

    test('判定のトークンが届く前の押下は、次のトークンを待って1回だけ送り直す', async () => {
      executeGraphQL
        .mockResolvedValueOnce({
          ok: false,
          error: new GraphQLClientError({
            code: 'bot_verification_failed',
            message: '確認に失敗しました。',
            status: 403,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            followUser: {
              handle: TARGET.handle,
              following: true,
              followerCount: 2,
            },
          },
        });
      await renderButton();

      await userEvent.click(followButton());
      await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
      expect(executeGraphQL.mock.calls[0]?.[2]).toStrictEqual({
        turnstileToken: undefined,
      });
      await passBotCheck();

      await expect
        .element(followingButton())
        .toHaveAttribute('aria-pressed', 'true');
      expect(executeGraphQL).toHaveBeenCalledTimes(2);
      expect(executeGraphQL.mock.calls[1]?.[2]).toStrictEqual({
        turnstileToken: 'turnstile-token-1',
      });
    });

    test('失敗するとフォローの状態を元に戻し、文言規則の文言をトーストで示す', async () => {
      respondWithFailure(
        'follow_target_unavailable',
        422,
        TARGET_UNAVAILABLE_MESSAGE,
      );
      const onChange = vi.fn();
      await renderButton({ onChange });
      await passBotCheck();

      await userEvent.click(followButton());

      await expect
        .element(page.getByText(TARGET_UNAVAILABLE_MESSAGE))
        .toBeVisible();
      await expect
        .element(followButton())
        .toHaveAttribute('aria-pressed', 'false');
      await expect.element(followButton()).not.toHaveAttribute('aria-busy');
      await expect
        .element(page.getByText(FOLLOWED_MESSAGE))
        .not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    test('GraphQLの失敗でない例外では、固定の文言をトーストで示す', async () => {
      executeGraphQL.mockRejectedValue(new Error('network down'));
      await renderButton();
      await passBotCheck();

      await userEvent.click(followButton());

      await expect
        .element(page.getByText(UNEXPECTED_ERROR_MESSAGE))
        .toBeVisible();
      await expect
        .element(page.getByText('network down'))
        .not.toBeInTheDocument();
      await expect
        .element(followButton())
        .toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('親の処理と初期値の変化', () => {
    test('onChangeが例外を投げても、確定した状態を保ち失敗のトーストは出さない', async () => {
      respondWithState(true, 5);
      const onChange = vi.fn(() => {
        throw new Error('親の処理の失敗');
      });
      const swallowed: unknown[] = [];
      const swallow = (event: PromiseRejectionEvent) => {
        swallowed.push(event.reason);
        event.stopImmediatePropagation();
        event.preventDefault();
      };
      window.addEventListener('unhandledrejection', swallow, true);
      try {
        await renderButton({ onChange });
        await passBotCheck();

        await userEvent.click(followButton());

        await expect
          .element(followingButton())
          .toHaveAttribute('aria-pressed', 'true');
        await expect.element(page.getByText(FOLLOWED_MESSAGE)).toBeVisible();
        await expect.poll(() => swallowed.length).toBe(1);
      } finally {
        window.removeEventListener('unhandledrejection', swallow, true);
      }

      await expect
        .element(page.getByText(UNEXPECTED_ERROR_MESSAGE))
        .not.toBeInTheDocument();
      expect(onChange).toHaveBeenCalledOnce();
    });

    test.each([
      ['解除してから初期値がfalse→trueと戻る', true, 'フォロー中'],
      ['フォローしてから初期値がtrue→falseと戻る', false, 'フォロー'],
    ] as const)(
      '%sと、操作の結果ではなく初期値に従う',
      async (_name, startsFollowing, finalLabel) => {
        respondWithState(!startsFollowing, 3);
        await renderInRouter(
          <InitialFollowingHarness start={startsFollowing} />,
          {
            cachedViewer: VERIFIED_VIEWER,
          },
        );
        await passBotCheck();
        await userEvent.click(
          page.getByRole('button', {
            name: startsFollowing ? 'フォロー中' : 'フォロー',
            exact: true,
          }),
        );
        await expect
          .element(
            page.getByRole('button', {
              name: startsFollowing ? 'フォロー' : 'フォロー中',
              exact: true,
            }),
          )
          .toHaveAttribute('aria-pressed', String(!startsFollowing));

        await userEvent.click(
          page.getByRole('button', { name: '初期値を反転する' }),
        );
        await expect
          .element(
            page.getByRole('button', {
              name: startsFollowing ? 'フォロー' : 'フォロー中',
              exact: true,
            }),
          )
          .toHaveAttribute('aria-pressed', String(!startsFollowing));
        await userEvent.click(
          page.getByRole('button', { name: '初期値を反転する' }),
        );

        await expect
          .element(page.getByRole('button', { name: finalLabel, exact: true }))
          .toHaveAttribute('aria-pressed', String(startsFollowing));
      },
    );
  });

  describe('フォロー解除', () => {
    test('フォロー中のボタンを押すと解除し、ラベル・押下の状態・トースト・onChangeを更新する', async () => {
      respondWithState(false, 12);
      const onChange = vi.fn();
      await renderButton({ initialFollowing: true, onChange });
      await passBotCheck();

      await expect
        .element(followingButton())
        .toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(followingButton());

      await expect
        .element(followButton())
        .toHaveAttribute('aria-pressed', 'false');
      await expect.element(page.getByText(UNFOLLOWED_MESSAGE)).toBeVisible();
      expect(executeGraphQL).toHaveBeenCalledWith(
        ClientUnfollowUserDocument,
        { handle: TARGET.handle },
        { turnstileToken: 'turnstile-token-1' },
      );
      expect(onChange).toHaveBeenCalledExactlyOnceWith({
        following: false,
        followerCount: 12,
      });
    });

    test('失敗するとフォロー中のまま戻し、文言をトーストで示す', async () => {
      respondWithFailure(
        'rate_limit_exceeded',
        429,
        '操作が集中しています。しばらく待ってから再度お試しください。',
      );
      await renderButton({ initialFollowing: true });
      await passBotCheck();

      await userEvent.click(followingButton());

      await expect
        .element(
          page.getByText(
            '操作が集中しています。しばらく待ってから再度お試しください。',
          ),
        )
        .toBeVisible();
      await expect
        .element(followingButton())
        .toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('アクセシビリティ', () => {
    const STATES: readonly (readonly [string, ClientViewerQuery, boolean])[] = [
      ['未ログイン', GUEST_VIEWER_QUERY, false],
      ['未確認', UNVERIFIED_VIEWER, false],
      ['フォローしていない', VERIFIED_VIEWER, false],
      ['フォロー中', VERIFIED_VIEWER, true],
    ];

    test.each(
      STATES.flatMap(([state, viewer, following]) =>
        COLOR_SCHEMES.map(
          (scheme) => [state, scheme, viewer, following] as const,
        ),
      ),
    )(
      '%s・%sの配色でaxeの違反が0件である',
      async (_state, scheme, viewer, following) => {
        applyColorScheme(scheme);
        await renderButton({ initialFollowing: following }, viewer);

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
