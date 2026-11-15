import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import { GUEST_VIEWER_QUERY } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  ClientLaunchCommentsDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import {
  articleOf,
  button,
  callsOf,
  commentOf,
  deferred,
  editorOf,
  idOf,
  INTERNAL_ERROR,
  LAUNCH,
  LOAD_ERROR,
  ok,
  OUTSIDE,
  pageOf,
  POST_PLACEHOLDER,
  PRODUCT,
  renderThread,
  threadOf,
  threadRoot,
  threadsFrom,
  topLevelArticles,
  UNVERIFIED,
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

const EMAIL_UNVERIFIED_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

const loadingStatus = (label: string) =>
  page.getByRole('status').filter({ hasText: label });

beforeEach(() => {
  vi.mocked(executeGraphQL).mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('CommentThread', () => {
  describe('閲覧者の状態ごとの投稿欄と案内', () => {
    test('未ログインの閲覧者には投稿欄の代わりにログインの案内と導線を示す', async () => {
      await renderThread({
        viewer: GUEST_VIEWER_QUERY,
        pages: () => ok(pageOf([threadOf(commentOf(1))])),
      });

      await expect
        .element(
          page.getByText('ログインすると、コメントや返信を投稿できます。'),
        )
        .toBeVisible();
      await expect
        .element(page.getByRole('link', { name: 'ログインしてコメント' }))
        .toBeVisible();
      await expect.element(articleOf('ファン1')).toBeVisible();
      expect(editorOf(POST_PLACEHOLDER).query()).toBeNull();
    });

    test('メールアドレス未確認の閲覧者には投稿欄の代わりに確認の案内と「確認メールを再送」を示し、「返信」を無効にする', async () => {
      await renderThread({
        viewer: UNVERIFIED,
        pages: () => ok(pageOf([threadOf(commentOf(1))])),
      });

      await expect
        .element(
          page.getByText(EMAIL_UNVERIFIED_REASON, { exact: true }).first(),
        )
        .toBeVisible();
      await expect.element(button('確認メールを再送')).toBeVisible();
      await expect
        .element(
          articleOf('ファン1').getByRole('button', {
            name: '返信',
            exact: true,
          }),
        )
        .toHaveAttribute('aria-disabled', 'true');
      expect(editorOf(POST_PLACEHOLDER).query()).toBeNull();
    });

    test('ログイン中で確認済みの他者には評価の行を持つ投稿欄を示す', async () => {
      await renderThread();

      await expect.element(editorOf(POST_PLACEHOLDER)).toBeInTheDocument();
      await expect.element(button('コメントする')).toBeVisible();
      await expect
        .element(
          page.getByRole('radiogroup', { name: 'このプロダクトの評価(任意)' }),
        )
        .toBeVisible();
    });

    test('投稿者本人には評価の行の無い投稿欄を示す', async () => {
      await renderThread({ viewerIsOwner: true });

      await expect.element(editorOf(POST_PLACEHOLDER)).toBeInTheDocument();
      await expect.element(button('コメントする')).toBeVisible();
      expect(page.getByRole('radiogroup').query()).toBeNull();
    });
  });

  describe('0件の表示', () => {
    test.each<[string, ClientViewerQuery, boolean, string]>([
      [
        '未ログインの閲覧者',
        GUEST_VIEWER_QUERY,
        false,
        'ログインすると、最初のコメントを書けます。',
      ],
      [
        'メールアドレス未確認の投稿者本人',
        UNVERIFIED,
        true,
        'メールアドレスを確認すると、最初のコメントを書けます。',
      ],
      [
        '投稿者本人',
        signedInViewerQuery(),
        true,
        'ローンチの背景や近況を書いて、サポーターに伝えましょう。',
      ],
      [
        'ログイン中で確認済みの他者',
        signedInViewerQuery(),
        false,
        '感想や質問を最初に書いてみましょう。',
      ],
    ])(
      '%sには「まだコメントはありません。」と状態に応じた一言を示す',
      async (_, viewer, viewerIsOwner, hint) => {
        await renderThread({ viewer, viewerIsOwner });

        await expect
          .element(page.getByText('まだコメントはありません。'))
          .toBeVisible();
        await expect.element(page.getByText(hint)).toBeVisible();
        expect(page.getByRole('article').query()).toBeNull();
      },
    );
  });

  describe('一覧と続きの読み込み', () => {
    test('最初の取得の間はスケルトンを示し、トップレベルを受け取った順に、返信を親の下に入れ子で並べる', async () => {
      const { gate, release } = deferred();
      await renderThread({
        pages: async () => {
          await gate;
          return ok(
            pageOf([
              threadOf(commentOf(1), [
                commentOf(3, { parentId: idOf(1), depth: 2 }),
                commentOf(4, { parentId: idOf(3), depth: 3 }),
              ]),
              threadOf(commentOf(2)),
            ]),
          );
        },
      });

      await expect.element(loadingStatus('コメントを読み込み中')).toBeVisible();
      release();

      await expect.element(articleOf('ファン1')).toBeVisible();
      expect(topLevelArticles()).toStrictEqual([
        'ファン1さんのコメント',
        'ファン2さんのコメント',
      ]);
      const replyList = articleOf('ファン3').element().closest('ol');
      expect(replyList?.getAttribute('aria-label')).toBe('返信');
      expect(replyList?.closest('li')).toBe(
        articleOf('ファン1').element().closest('li'),
      );
      expect(articleOf('ファン4').element().closest('ol')?.closest('li')).toBe(
        articleOf('ファン3').element().closest('li'),
      );
      expect(loadingStatus('コメントを読み込み中').query()).toBeNull();
    });

    test('続きが無ければ「さらに読み込む」を置かない', async () => {
      await renderThread({ pages: () => ok(pageOf(threadsFrom(1, 3))) });

      await expect.element(articleOf('ファン3')).toBeVisible();
      expect(button('さらに読み込む').query()).toBeNull();
    });

    test('続きがあるときだけ「さらに読み込む」を置き、押すと前のページのカーソルで次の10件を読み足して加えた最初の項目へフォーカスを移す', async () => {
      await renderThread({
        pages: (variables) =>
          ok(
            variables['after'] === undefined
              ? pageOf(threadsFrom(1, 10), 'cursor-1')
              : pageOf(threadsFrom(11, 10)),
          ),
      });
      await expect.element(articleOf('ファン10')).toBeVisible();

      await userEvent.click(button('さらに読み込む'));

      await expect.element(articleOf('ファン20')).toBeVisible();
      expect(topLevelArticles()).toHaveLength(20);
      expect(topLevelArticles()[10]).toBe('ファン11さんのコメント');
      await expect.element(articleOf('ファン11')).toHaveFocus();
      expect(button('さらに読み込む').query()).toBeNull();
      expect(callsOf(ClientLaunchCommentsDocument)).toStrictEqual([
        { productId: PRODUCT.id, launchId: LAUNCH.id },
        { productId: PRODUCT.id, launchId: LAUNCH.id, after: 'cursor-1' },
      ]);
    });

    test('続きの読み込み中は「さらに読み込む」を待たせて重ねて読まず、続きのスケルトンを示す', async () => {
      const { gate, release } = deferred();
      await renderThread({
        pages: async (variables) => {
          if (variables['after'] === undefined) {
            return ok(pageOf(threadsFrom(1, 2), 'cursor-1'));
          }
          await gate;
          return ok(pageOf(threadsFrom(3, 1)));
        },
      });
      await userEvent.click(button('さらに読み込む'));

      const pending = button('読み込み中');
      await expect.element(pending).toHaveAttribute('aria-busy', 'true');
      await expect.element(pending).toHaveAttribute('aria-disabled', 'true');
      await expect.element(loadingStatus('続きを読み込み中')).toBeVisible();
      await userEvent.click(pending, { force: true });
      expect(callsOf(ClientLaunchCommentsDocument)).toHaveLength(2);

      release();
      await expect.element(articleOf('ファン3')).toBeVisible();
      await expect.element(articleOf('ファン3')).toHaveFocus();
    });

    test('続きの読み込みに失敗すると取得済みのコメントを保ったまま文言と再試行を示し、再試行で読み足す', async () => {
      let failNext = true;
      await renderThread({
        pages: (variables) => {
          if (variables['after'] === undefined) {
            return ok(pageOf(threadsFrom(1, 2), 'cursor-1'));
          }
          if (failNext) {
            failNext = false;
            return INTERNAL_ERROR;
          }
          return ok(pageOf(threadsFrom(3, 1)));
        },
      });
      await userEvent.click(button('さらに読み込む'));

      await expect.element(page.getByText(LOAD_ERROR)).toBeVisible();
      await expect.element(articleOf('ファン1')).toBeVisible();
      await expect.element(articleOf('ファン2')).toBeVisible();
      await expect.element(button('再試行')).toHaveFocus();
      expect(button('さらに読み込む').query()).toBeNull();

      await userEvent.click(button('再試行'));

      await expect.element(articleOf('ファン3')).toBeVisible();
      await expect.element(articleOf('ファン3')).toHaveFocus();
      expect(page.getByText(LOAD_ERROR).query()).toBeNull();
      expect(callsOf(ClientLaunchCommentsDocument).at(-1)).toStrictEqual({
        productId: PRODUCT.id,
        launchId: LAUNCH.id,
        after: 'cursor-1',
      });
    });

    test('最初の取得に失敗すると欄の中だけに文言と再試行を示し、欄の外と投稿欄の表示を続け、再試行で読み直す', async () => {
      let fail = true;
      await renderThread({
        pages: () => {
          if (fail) {
            fail = false;
            return INTERNAL_ERROR;
          }
          return ok(pageOf([threadOf(commentOf(1))]));
        },
      });

      await expect.element(page.getByText(LOAD_ERROR)).toBeVisible();
      expect(
        threadRoot().element().contains(page.getByText(LOAD_ERROR).element()),
      ).toBe(true);
      await expect.element(page.getByText(OUTSIDE)).toBeVisible();
      await expect.element(editorOf(POST_PLACEHOLDER)).toBeInTheDocument();

      await userEvent.click(button('再試行'));

      await expect.element(articleOf('ファン1')).toBeVisible();
      expect(page.getByText(LOAD_ERROR).query()).toBeNull();
      await expect.element(threadRoot()).toHaveFocus();
    });

    test('最初の取得の再試行が再び失敗すると新しい再試行のボタンへフォーカスを移す', async () => {
      await renderThread({ pages: () => INTERNAL_ERROR });
      await expect.element(page.getByText(LOAD_ERROR)).toBeVisible();

      await userEvent.click(button('再試行'));

      await expect
        .poll(() => callsOf(ClientLaunchCommentsDocument).length)
        .toBe(2);
      await expect.element(button('再試行')).toHaveFocus();
    });
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('投稿欄・スレッド・「さらに読み込む」のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderThread({
      pages: () =>
        ok(
          pageOf(
            [
              threadOf(commentOf(1, { byProductOwner: true }), [
                commentOf(2, { parentId: idOf(1), depth: 2 }),
              ]),
            ],
            'cursor-1',
          ),
        ),
    });
    await expect.element(button('さらに読み込む')).toBeVisible();
    await expect.element(editorOf(POST_PLACEHOLDER)).toBeInTheDocument();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('未ログインの0件のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderThread({ viewer: GUEST_VIEWER_QUERY });
    await expect
      .element(page.getByText('まだコメントはありません。'))
      .toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('続きの取得の失敗のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderThread({
      viewer: UNVERIFIED,
      pages: (variables) =>
        variables['after'] === undefined
          ? ok(pageOf(threadsFrom(1, 1), 'cursor-1'))
          : INTERNAL_ERROR,
    });
    await userEvent.click(button('さらに読み込む'));
    await expect.element(page.getByText(LOAD_ERROR)).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('最初の取得の失敗のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderThread({ pages: () => INTERNAL_ERROR });
    await expect.element(page.getByText(LOAD_ERROR)).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
