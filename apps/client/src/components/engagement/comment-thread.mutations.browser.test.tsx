import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import {
  ClientDeleteCommentDocument,
  ClientPostCommentDocument,
  ClientUpdateCommentDocument,
} from '../../graphql/generated/graphql.ts';
import {
  articleOf,
  button,
  callsOf,
  commentOf,
  editorOf,
  idOf,
  INTERNAL_ERROR,
  LAUNCH,
  ok,
  pageOf,
  passBotCheck,
  passBotCheckBehindDialog,
  POST_PLACEHOLDER,
  PRODUCT,
  renderThread,
  threadOf,
  topLevelArticles,
  typeInto,
} from './comment-thread-testing.tsx';

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

beforeEach(() => {
  vi.mocked(executeGraphQL).mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  toast.dismiss();
});

describe('CommentThreadのコメントの操作', () => {
  test('トップレベルの投稿で一覧の先頭に加え、投稿欄を空にして「コメントしました。」を通知する', async () => {
    const posted = commentOf(9, {
      body: '新しいコメント',
      viewerIsAuthor: true,
      createdAt: new Date().toISOString(),
    });
    await renderThread({
      viewerIsOwner: true,
      pages: () => ok(pageOf([threadOf(commentOf(1))])),
      mutations: new Map([
        [
          ClientPostCommentDocument,
          () => ok({ postComment: { comment: posted, rating: null } }),
        ],
      ]),
    });
    await expect.element(articleOf('ファン1')).toBeVisible();

    await typeInto(POST_PLACEHOLDER, '新しいコメント');
    await passBotCheck();
    await userEvent.click(button('コメントする'));

    await expect.element(page.getByText('コメントしました。')).toBeVisible();
    await expect
      .element(articleOf('ファン9').getByText('新しいコメント'))
      .toBeVisible();
    expect(topLevelArticles()).toStrictEqual([
      'ファン9さんのコメント',
      'ファン1さんのコメント',
    ]);
    await expect.element(editorOf(POST_PLACEHOLDER)).toHaveTextContent('');
    expect(callsOf(ClientPostCommentDocument)).toStrictEqual([
      {
        input: {
          productId: PRODUCT.id,
          launchId: LAUNCH.id,
          body: '新しいコメント',
        },
      },
    ]);
  });

  test('0件のローンチへの投稿で0件の表示を一覧に替える', async () => {
    const posted = commentOf(9, { body: '最初のコメント' });
    await renderThread({
      mutations: new Map([
        [
          ClientPostCommentDocument,
          () => ok({ postComment: { comment: posted, rating: null } }),
        ],
      ]),
    });
    await expect
      .element(page.getByText('まだコメントはありません。'))
      .toBeVisible();

    await typeInto(POST_PLACEHOLDER, '最初のコメント');
    await passBotCheck();
    await userEvent.click(button('コメントする'));

    await expect.element(articleOf('ファン9')).toBeVisible();
    expect(page.getByText('まだコメントはありません。').query()).toBeNull();
  });

  test('項目の返信の投稿欄の送信で親のスレッドに返信を加え「返信しました。」を通知する', async () => {
    const replied = commentOf(9, {
      parentId: idOf(1),
      depth: 2,
      body: 'ありがとうございます',
    });
    await renderThread({
      pages: () => ok(pageOf([threadOf(commentOf(1))])),
      mutations: new Map([
        [
          ClientPostCommentDocument,
          () => ok({ postComment: { comment: replied, rating: null } }),
        ],
      ]),
    });

    await userEvent.click(
      articleOf('ファン1').getByRole('button', { name: '返信', exact: true }),
    );
    await typeInto('返信を書く', 'ありがとうございます');
    await passBotCheck();
    await userEvent.click(button('返信する'));

    await expect.element(page.getByText('返信しました。')).toBeVisible();
    await expect.element(articleOf('ファン9')).toBeVisible();
    expect(articleOf('ファン9').element().closest('ol')?.closest('li')).toBe(
      articleOf('ファン1').element().closest('li'),
    );
    expect(callsOf(ClientPostCommentDocument)).toStrictEqual([
      {
        input: {
          productId: PRODUCT.id,
          launchId: LAUNCH.id,
          parentId: idOf(1),
          body: 'ありがとうございます',
        },
      },
    ]);
  });

  test('自身のコメントの編集で本文を置き換え「コメントを更新しました。」を通知する', async () => {
    const own = commentOf(1, { viewerIsAuthor: true, body: '前の本文' });
    await renderThread({
      viewerIsOwner: true,
      pages: () => ok(pageOf([threadOf(own)])),
      mutations: new Map([
        [
          ClientUpdateCommentDocument,
          () =>
            ok({
              updateComment: {
                comment: { ...own, body: '前の本文と追記', edited: true },
                rating: null,
              },
            }),
        ],
      ]),
    });

    await userEvent.click(
      articleOf('ファン1').getByRole('button', { name: 'コメントの操作' }),
    );
    await userEvent.click(page.getByRole('menuitem', { name: '編集' }));
    await typeInto('コメントを編集', 'と追記');
    await passBotCheck();
    await userEvent.click(button('保存する'));

    await expect
      .element(page.getByText('コメントを更新しました。'))
      .toBeVisible();
    await expect
      .element(articleOf('ファン1').getByText('前の本文と追記'))
      .toBeVisible();
    await expect
      .element(articleOf('ファン1').getByText('(編集済み)'))
      .toBeVisible();
    const [call] = callsOf(ClientUpdateCommentDocument);
    expect(call?.['input']).toMatchObject({ commentId: idOf(1) });
  });

  test('自身のコメントの削除で置き換え表示にし、返信を残して「コメントを削除しました。」を通知する', async () => {
    const own = commentOf(1, { viewerIsAuthor: true });
    await renderThread({
      pages: () =>
        ok(
          pageOf([
            threadOf(own, [commentOf(2, { parentId: idOf(1), depth: 2 })]),
          ]),
        ),
      mutations: new Map([
        [
          ClientDeleteCommentDocument,
          () =>
            ok({
              deleteComment: {
                ...own,
                state: 'REMOVED',
                author: null,
                body: null,
                createdAt: null,
                viewerIsAuthor: false,
              },
            }),
        ],
      ]),
    });

    await userEvent.click(
      articleOf('ファン1').getByRole('button', { name: 'コメントの操作' }),
    );
    await userEvent.click(page.getByRole('menuitem', { name: '削除' }));
    const dialog = page.getByRole('dialog', {
      name: 'コメントを削除しますか?',
    });
    await expect.element(dialog).toBeVisible();
    passBotCheckBehindDialog();
    await userEvent.click(dialog.getByRole('button', { name: '削除' }));

    await expect
      .element(page.getByText('コメントを削除しました。'))
      .toBeVisible();
    const removed = page.getByRole('article', { name: '削除されたコメント' });
    await expect.element(removed).toBeVisible();
    await expect.element(removed).toHaveFocus();
    await expect.element(articleOf('ファン2')).toBeVisible();
    expect(callsOf(ClientDeleteCommentDocument)).toStrictEqual([
      { commentId: idOf(1) },
    ]);
  });

  test('投稿の失敗では一覧を変えず、入力を保って理由の文言を示す', async () => {
    await renderThread({
      pages: () => ok(pageOf([threadOf(commentOf(1))])),
      mutations: new Map([[ClientPostCommentDocument, () => INTERNAL_ERROR]]),
    });

    await typeInto(POST_PLACEHOLDER, '届かないコメント');
    await passBotCheck();
    await userEvent.click(button('コメントする'));

    await expect.element(page.getByRole('alert').first()).toBeVisible();
    await expect
      .element(editorOf(POST_PLACEHOLDER))
      .toHaveTextContent('届かないコメント');
    expect(topLevelArticles()).toStrictEqual(['ファン1さんのコメント']);
    expect(page.getByText('コメントしました。').query()).toBeNull();
  });
});
