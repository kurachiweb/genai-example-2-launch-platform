import { useState } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import {
  ClientCancelUpvoteDocument,
  ClientUpvoteDocument,
  type MatchFragment,
} from '../../graphql/generated/graphql.ts';
import { MatchCard } from './match-card.tsx';
import { ENTRY_IDS, entryOf, MATCH_ID, matchOf } from './match-fixtures.ts';
import { renderInMatchFrame } from './match-testing.tsx';
import { UpvoteBotProtection } from './upvote-bot-protection.tsx';
import { useUpvote } from './use-upvote.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const UPVOTED_MESSAGE = 'Upvoteしました。';

const CANCELLED_MESSAGE = 'Upvoteを取り消しました。';

const LOGIN_REQUIRED_TITLE = 'Upvoteにはログインが必要です';

const LOGIN_REQUIRED_DESCRIPTION =
  'ログインすると、1マッチにつき1回Upvoteできます。Upvoteはマッチ中いつでも取り消せます。';

const NOT_ACCEPTING_MESSAGE = 'このマッチはUpvoteを受け付けていません。';

function UpvoteHarness({
  initial,
  onUpdated,
}: {
  readonly initial: MatchFragment;
  readonly onUpdated: (match: MatchFragment) => void;
}) {
  const [match, setMatch] = useState(initial);
  const { pendingEntryId, toggle, loginDialog } = useUpvote({
    match,
    onUpdated: (next) => {
      onUpdated(next);
      setMatch(next);
    },
  });
  return (
    <>
      <MatchCard
        match={match}
        pendingEntryId={pendingEntryId}
        onToggleUpvote={toggle}
      />
      {loginDialog}
    </>
  );
}

const renderHarness = async (
  initial: MatchFragment = matchOf(),
  { path = '/' }: { readonly path?: string } = {},
) => {
  const onUpdated = vi.fn<(match: MatchFragment) => void>();
  await renderInMatchFrame(
    <UpvoteBotProtection>
      <UpvoteHarness initial={initial} onUpdated={onUpdated} />
      <Toaster />
    </UpvoteBotProtection>,
    { path },
  );
  return { onUpdated };
};

const leftUpvote = () =>
  page.getByRole('button', { name: /^Pitch NotesにUpvote/ });
const leftCancel = () =>
  page.getByRole('button', { name: /^Pitch NotesへのUpvoteを取り消す/ });
const rightUpvote = () =>
  page.getByRole('button', { name: /^Tactics BoardにUpvote/ });

const passBotCheck = () =>
  userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

// サーバーが返す、指定した側をUpvote済みにして各側のUpvote数を置き換えたマッチ
const serverMatch = (
  upvotedEntryId: string | null,
  counts: { readonly left: number; readonly right: number },
): MatchFragment =>
  matchOf({
    viewerUpvotedEntryId: upvotedEntryId,
    entries: [
      entryOf('left', { upvoteCount: counts.left }),
      entryOf('right', { upvoteCount: counts.right }),
    ],
  });

const respondWith = (match: MatchFragment) => {
  executeGraphQL.mockResolvedValue({
    ok: true,
    data: { upvote: match, cancelUpvote: match },
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
});

describe('useUpvote', () => {
  describe('未ログインの閲覧者', () => {
    test('押すと送らずにログインが必要な旨のダイアログを開き、axeの違反が0件である', async () => {
      await renderHarness(matchOf({ viewerRestriction: 'GUEST' }));

      await userEvent.click(leftUpvote());

      const dialog = page.getByRole('dialog', { name: LOGIN_REQUIRED_TITLE });
      await expect.element(dialog).toBeVisible();
      await expect
        .element(dialog.getByText(LOGIN_REQUIRED_DESCRIPTION))
        .toBeVisible();
      expect(executeGraphQL).not.toHaveBeenCalled();
      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('ダイアログのログインのリンクは、現在のURLを戻り先にする', async () => {
      await renderHarness(matchOf({ viewerRestriction: 'GUEST' }), {
        path: '/?tab=qualifiers',
      });

      await userEvent.click(rightUpvote());

      await expect
        .element(page.getByRole('link', { name: 'ログイン' }))
        .toHaveAttribute(
          'href',
          `/auth/login?redirect=${encodeURIComponent('/?tab=qualifiers')}`,
        );
    });
  });

  describe('Upvote・付け替え・取り消し', () => {
    test('bot対策の判定を`match_upvote`の操作として非表示で置く', async () => {
      await renderHarness();

      expect(lastTurnstileProps().options?.action).toBe('match_upvote');
      expect(lastTurnstileProps().options?.size).toBe('invisible');
    });

    test('Upvoteしていない側を押すと、判定のトークンを付けてUpvoteを送り、サーバーの結果で表示を更新して通知する', async () => {
      const updated = serverMatch(ENTRY_IDS.left, { left: 13, right: 9 });
      respondWith(updated);
      const { onUpdated } = await renderHarness();
      await passBotCheck();

      await userEvent.click(leftUpvote());

      await expect.element(page.getByText(UPVOTED_MESSAGE)).toBeVisible();
      await expect
        .element(leftCancel())
        .toHaveAttribute('aria-pressed', 'true');
      await expect.element(leftCancel()).toHaveAccessibleName(/13\s*票$/);
      expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
        ClientUpvoteDocument,
        { input: { matchId: MATCH_ID, entryId: ENTRY_IDS.left } },
        { turnstileToken: 'turnstile-token-1' },
      );
      expect(onUpdated).toHaveBeenCalledExactlyOnceWith(updated);
    });

    test('現在のUpvoteの側を押すと、取り消しを送り、取り消した旨を通知する', async () => {
      const updated = serverMatch(null, { left: 11, right: 9 });
      respondWith(updated);
      const { onUpdated } = await renderHarness(
        serverMatch(ENTRY_IDS.left, { left: 12, right: 9 }),
      );
      await passBotCheck();

      await userEvent.click(leftCancel());

      await expect.element(page.getByText(CANCELLED_MESSAGE)).toBeVisible();
      await expect
        .element(leftUpvote())
        .toHaveAttribute('aria-pressed', 'false');
      expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
        ClientCancelUpvoteDocument,
        { matchId: MATCH_ID },
        { turnstileToken: 'turnstile-token-1' },
      );
      expect(onUpdated).toHaveBeenCalledExactlyOnceWith(updated);
      await expect
        .element(page.getByText(UPVOTED_MESSAGE))
        .not.toBeInTheDocument();
    });

    test('他の側にUpvote済みで押すと、押した側へのUpvote(付け替え)を送り「Upvoteしました。」を通知する', async () => {
      respondWith(serverMatch(ENTRY_IDS.right, { left: 11, right: 10 }));
      await renderHarness(serverMatch(ENTRY_IDS.left, { left: 12, right: 9 }));
      await passBotCheck();

      await userEvent.click(rightUpvote());

      await expect.element(page.getByText(UPVOTED_MESSAGE)).toBeVisible();
      expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
        ClientUpvoteDocument,
        { input: { matchId: MATCH_ID, entryId: ENTRY_IDS.right } },
        { turnstileToken: 'turnstile-token-1' },
      );
      await expect
        .element(leftUpvote())
        .toHaveAttribute('aria-pressed', 'false');
    });

    test('bot対策のトークンを操作ごとに取り直し、同じトークンを2回使わない', async () => {
      executeGraphQL
        .mockResolvedValueOnce({
          ok: true,
          data: { upvote: serverMatch(ENTRY_IDS.left, { left: 13, right: 9 }) },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: { cancelUpvote: serverMatch(null, { left: 12, right: 9 }) },
        });
      await renderHarness();
      await passBotCheck();
      await userEvent.click(leftUpvote());
      await expect
        .element(leftCancel())
        .toHaveAttribute('aria-pressed', 'true');
      await passBotCheck();

      await userEvent.click(leftCancel());

      await expect
        .element(leftUpvote())
        .toHaveAttribute('aria-pressed', 'false');
      expect(
        executeGraphQL.mock.calls.map((call): unknown => call[2]),
      ).toStrictEqual([
        { turnstileToken: 'turnstile-token-1' },
        { turnstileToken: 'turnstile-token-2' },
      ]);
    });

    test('判定のトークンが届く前の押下は、送信中のまま次のトークンを待って1回だけ送り直す', async () => {
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
          data: { upvote: serverMatch(ENTRY_IDS.left, { left: 13, right: 9 }) },
        });
      await renderHarness();

      await userEvent.click(leftUpvote());
      await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
      await expect.element(leftUpvote()).toHaveAttribute('aria-busy', 'true');
      await passBotCheck();

      await expect.element(page.getByText(UPVOTED_MESSAGE)).toBeVisible();
      expect(executeGraphQL).toHaveBeenCalledTimes(2);
      expect(executeGraphQL.mock.calls[1]?.[2]).toStrictEqual({
        turnstileToken: 'turnstile-token-1',
      });
    });
  });

  describe('送信中', () => {
    test('押した側を送信中にし、送信中は同じ側も他の側の押下も送らない', async () => {
      const pending = deferred<unknown>();
      executeGraphQL.mockReturnValue(pending.promise);
      await renderHarness();
      await passBotCheck();

      await userEvent.click(leftUpvote());

      await expect.element(leftUpvote()).toHaveAttribute('aria-busy', 'true');
      await expect
        .element(leftUpvote())
        .toHaveAttribute('aria-disabled', 'true');
      await expect.element(rightUpvote()).not.toHaveAttribute('aria-busy');
      await passBotCheck();
      await userEvent.click(rightUpvote());
      (leftUpvote().element() as HTMLElement).focus();
      await userEvent.keyboard('{Enter}');
      expect(executeGraphQL).toHaveBeenCalledTimes(1);

      pending.resolve({
        ok: true,
        data: { upvote: serverMatch(ENTRY_IDS.left, { left: 13, right: 9 }) },
      });
      await expect.element(leftCancel()).not.toHaveAttribute('aria-busy');
      expect(executeGraphQL).toHaveBeenCalledTimes(1);
    });
  });

  describe('失敗', () => {
    test('拒否されると表示を操作の前のまま変えず、理由の文言を通知する', async () => {
      respondWithFailure('upvote_not_accepting', 409, NOT_ACCEPTING_MESSAGE);
      const { onUpdated } = await renderHarness();
      await passBotCheck();

      await userEvent.click(leftUpvote());

      await expect.element(page.getByText(NOT_ACCEPTING_MESSAGE)).toBeVisible();
      await expect
        .element(leftUpvote())
        .toHaveAttribute('aria-pressed', 'false');
      await expect.element(leftUpvote()).not.toHaveAttribute('aria-busy');
      await expect.element(leftUpvote()).toHaveAccessibleName(/12\s*票$/);
      await expect
        .element(page.getByText(UPVOTED_MESSAGE))
        .not.toBeInTheDocument();
      expect(onUpdated).not.toHaveBeenCalled();
    });

    test('GraphQLの失敗でない例外では、固定の文言を通知し、例外の内容を出さない', async () => {
      executeGraphQL.mockRejectedValue(new Error('network down'));
      const { onUpdated } = await renderHarness(
        serverMatch(ENTRY_IDS.left, { left: 12, right: 9 }),
      );
      await passBotCheck();

      await userEvent.click(leftCancel());

      await expect
        .element(page.getByText(UNEXPECTED_ERROR_MESSAGE))
        .toBeVisible();
      await expect
        .element(page.getByText('network down'))
        .not.toBeInTheDocument();
      await expect
        .element(leftCancel())
        .toHaveAttribute('aria-pressed', 'true');
      expect(onUpdated).not.toHaveBeenCalled();
    });
  });
});
