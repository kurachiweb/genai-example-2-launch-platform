import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import { dismissToasts } from '../../../lib/test/toast.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  callsOf,
  failure,
  type GraphQLHandler,
  success,
} from '../../../test/admin-accounts-fixtures.ts';
import {
  ALL_ARTICLES,
  DRAFT_ARTICLE,
  HELP_ARTICLES_PATH,
  helpArticlePathOf,
  helpArticlesQueryOf,
  OTHER_DELETED_AUTHOR_ARTICLE,
  DELETED_AUTHOR_ARTICLE,
  renderHelpArticlesPage,
  respondAdminHelpArticlesGraphQL,
} from '../../../test/admin-help-articles-fixtures.ts';
import { loadAdminHelpArticlePage } from '../../graphql/admin-help-articles.ts';
import {
  AdminHelpArticleDocument,
  type AdminRole,
} from '../../graphql/generated/graphql.ts';
import { Route as HelpArticleEditRoute } from '../../routes/_authenticated/help-articles/$articleId.tsx';
import {
  ARTICLE,
  AUDITED_NOTICE,
  button,
  editable,
  NOT_FOUND_MESSAGE,
  reasonInput,
  savedArticleOf,
  statusRadio,
  titleInput,
  waitForEditor,
} from '../help/help-article-form-testing.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const main = () => page.getByRole('main');

const heading = () => main().getByRole('heading', { level: 1 });

const editForm = () =>
  main().getByRole('form', { name: 'ヘルプ記事の編集', exact: true });

const publicLink = () =>
  main().getByRole('link', { name: /^公開ページを開く/ });

const deleteButton = () =>
  main().getByRole('button', { name: '削除', exact: true });

const DELETE_TITLE = `ヘルプ記事『${ARTICLE.title}』を削除しますか?`;

const deleteDialog = () =>
  page.getByRole('dialog', { name: DELETE_TITLE, exact: true });

const listLink = (scope = main()) =>
  scope.getByRole('link', { name: 'ヘルプ記事の一覧へ', exact: true });

const ARTICLE_PATH = helpArticlePathOf(ARTICLE.id);

const LOADED = savedArticleOf({ revision: ARTICLE.revision });

const NOT_FOUND = Object.freeze({
  code: 'help_article_not_found',
  message: NOT_FOUND_MESSAGE,
  status: 404,
  expected: true,
});

const renderWith = async ({
  role = 'MODERATOR',
  article = () => success({ adminHelpArticle: LOADED }),
  articles,
  update,
  remove,
  path = ARTICLE_PATH,
}: {
  readonly role?: AdminRole;
  readonly article?: GraphQLHandler;
  readonly articles?: GraphQLHandler;
  readonly update?: GraphQLHandler;
  readonly remove?: GraphQLHandler;
  readonly path?: string;
} = {}) => {
  respondAdminHelpArticlesGraphQL(executeGraphQL, {
    role,
    article,
    ...(articles === undefined ? {} : { articles }),
    ...(update === undefined ? {} : { update }),
    ...(remove === undefined ? {} : { remove }),
  });
  await render(<Toaster />);
  return renderHelpArticlesPage(role, path);
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

test('経路の設定は画面のテストが写したものと同じ読み込みの関数を使う', () => {
  expect(HelpArticleEditRoute.options.loader).toBe(loadAdminHelpArticlePage);
});

describe('ヘルプ記事の編集の画面', () => {
  test('題名の下に読み込んだ記事の編集のフォームを置き、公開の記事は利用者側の記事詳細を別タブで開く導線を示す', async () => {
    await renderWith();

    await expect.element(heading()).toHaveTextContent('ヘルプ記事の編集');
    await expect.element(editForm()).toBeVisible();
    await expect.element(titleInput()).toHaveValue(ARTICLE.title);
    await expect
      .element(publicLink())
      .toHaveAccessibleName(/^公開ページを開く ?\(新しいタブで開きます\)$/);
    await expect
      .element(publicLink())
      .toHaveAttribute('href', `https://client.example/help/${ARTICLE.handle}`);
    await expect.element(publicLink()).toHaveAttribute('target', '_blank');
    await expect.element(publicLink()).toHaveAttribute('rel', 'noopener');
    await expect.element(deleteButton()).toBeVisible();
  });

  test('下書きの記事には公開ページを開く導線を示さず、公開して保存すると示す', async () => {
    const draft = savedArticleOf({
      revision: ARTICLE.revision,
      status: 'DRAFT',
    });
    const update = vi.fn<GraphQLHandler>(() =>
      success({ updateHelpArticle: savedArticleOf({ status: 'PUBLISHED' }) }),
    );
    await renderWith({
      article: () => success({ adminHelpArticle: draft }),
      update,
    });
    await expect.element(editForm()).toBeVisible();
    expect(publicLink().query()).toBeNull();

    await userEvent.click(statusRadio('公開'));
    await userEvent.click(button('保存する'));

    await expect.element(publicLink()).toBeVisible();
  });

  test('保存は記事のIDと読み込んだ版をフォームの値に足して送り、トーストで知らせて画面の内容を保存の結果に置き換えて題名へフォーカスを移し、次の保存は保存した版を送る', async () => {
    const update = vi
      .fn<GraphQLHandler>()
      .mockImplementationOnce(() =>
        success({
          updateHelpArticle: savedArticleOf({
            title: '投票の仕組み',
            revision: ARTICLE.revision + 1,
          }),
        }),
      )
      .mockImplementationOnce(() =>
        success({
          updateHelpArticle: savedArticleOf({
            title: '投票の仕組み',
            revision: ARTICLE.revision + 2,
          }),
        }),
      );
    await renderWith({ update });
    await waitForEditor();

    await userEvent.fill(titleInput(), ' 投票の仕組み ');
    await userEvent.fill(reasonInput(), '名前の変更');
    await userEvent.click(button('保存する'));

    await expect
      .element(page.getByText('ヘルプ記事を保存しました。', { exact: true }))
      .toBeVisible();
    expect(update.mock.calls[0]?.[0]).toEqual({
      input: {
        id: ARTICLE.id,
        expectedRevision: ARTICLE.revision,
        fields: {
          title: '投票の仕組み',
          subtitle: ARTICLE.subtitle,
          handle: ARTICLE.handle,
          categoryId: ARTICLE.categoryId,
          pinned: ARTICLE.pinned,
          status: 'PUBLISHED',
          body: ARTICLE.body,
        },
        reason: '名前の変更',
      },
    });
    await expect.element(titleInput()).toHaveValue('投票の仕組み');
    await expect.element(reasonInput()).toHaveValue('');
    await expect.element(heading()).toHaveFocus();

    await dismissToasts();
    await userEvent.click(button('保存する'));

    await expect.poll(() => update.mock.calls.length).toBe(2);
    expect(update.mock.calls[1]?.[0]).toMatchObject({
      input: { id: ARTICLE.id, expectedRevision: ARTICLE.revision + 1 },
    });
  });

  test('保存の後に記事の取得が他の画面の変更を返しても、編集中のフォームと送る版を差し替えない', async () => {
    const article = vi
      .fn<GraphQLHandler>()
      .mockImplementationOnce(() => success({ adminHelpArticle: LOADED }))
      .mockImplementation(() =>
        success({
          adminHelpArticle: savedArticleOf({
            title: '他の画面の変更',
            revision: ARTICLE.revision + 5,
          }),
        }),
      );
    const update = vi.fn<GraphQLHandler>(() =>
      success({ updateHelpArticle: savedArticleOf() }),
    );
    await renderWith({ article, update });
    await waitForEditor();

    await userEvent.click(button('保存する'));
    await expect
      .element(page.getByText('ヘルプ記事を保存しました。', { exact: true }))
      .toBeVisible();
    await dismissToasts();
    await userEvent.fill(titleInput(), '編集の途中');
    await expect
      .poll(() => callsOf(executeGraphQL, AdminHelpArticleDocument).length)
      .toBeGreaterThanOrEqual(1);
    await userEvent.click(button('保存する'));

    await expect.poll(() => update.mock.calls.length).toBe(2);
    expect(update.mock.calls[1]?.[0]).toMatchObject({
      input: {
        expectedRevision: ARTICLE.revision + 1,
        fields: { title: '編集の途中' },
      },
    });
  });

  test('閲覧のみの管理者には全ての欄を操作できない状態で示し、保存と削除のボタンを示さない', async () => {
    await renderWith({ role: 'VIEWER' });

    await expect.element(titleInput()).toBeDisabled();
    await expect.element(titleInput()).toHaveValue(ARTICLE.title);
    await expect.element(editable()).toBeInTheDocument();
    expect(button('保存する').query()).toBeNull();
    expect(deleteButton().query()).toBeNull();
    await expect.element(publicLink()).toBeVisible();
  });

  test('記事が削除されていれば、削除された旨と一覧への導線を示し、フォームを描かない', async () => {
    const router = await renderWith({
      article: () => success({ adminHelpArticle: null }),
    });

    await expect.element(main()).toHaveTextContent(NOT_FOUND_MESSAGE);
    expect(editForm().query()).toBeNull();
    expect(deleteButton().query()).toBeNull();
    await userEvent.click(listLink());

    await expect
      .poll(() => router.state.location.pathname)
      .toBe(HELP_ARTICLES_PATH);
  });
});

describe('削除', () => {
  test('確認のダイアログで記事のタイトルと元に戻せない旨と任意の理由を示し、確定すると削除してトーストで知らせ、一覧へ移す', async () => {
    const remove = vi.fn<GraphQLHandler>(() =>
      success({ deleteHelpArticle: { id: ARTICLE.id } }),
    );
    const remaining = helpArticlesQueryOf([
      DRAFT_ARTICLE,
      DELETED_AUTHOR_ARTICLE,
      OTHER_DELETED_AUTHOR_ARTICLE,
    ]);
    const articles = vi.fn<GraphQLHandler>(() =>
      success(remove.mock.calls.length === 0 ? ALL_ARTICLES : remaining),
    );
    const router = await renderWith({
      remove,
      articles,
      path: HELP_ARTICLES_PATH,
    });
    await userEvent.click(
      main().getByRole('link', { name: ARTICLE.title, exact: true }),
    );
    await expect.element(deleteButton()).toBeVisible();

    await userEvent.click(deleteButton());
    await expect.element(deleteDialog()).toBeVisible();
    await expect
      .element(deleteDialog())
      .toHaveTextContent('記事と以前のURLの転送は削除され、元に戻せません。');
    await expect.element(deleteDialog()).toHaveTextContent(AUDITED_NOTICE);
    // 削除済みの案内と、一覧に移った後の削除した記事を、描き直しのたびに記録して一瞬の表示も見落とさない
    const shown: string[] = [];
    const observer = new MutationObserver(() => {
      const text = main().element().textContent;
      if (text.includes(NOT_FOUND_MESSAGE)) {
        shown.push('deleted-notice');
      }
      if (
        router.state.location.pathname === HELP_ARTICLES_PATH &&
        main()
          .getByRole('link', { name: ARTICLE.title, exact: true })
          .query() !== null
      ) {
        shown.push('deleted-row');
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    await userEvent.fill(
      deleteDialog().getByRole('textbox', { name: '理由(任意)', exact: true }),
      '古い説明のため',
    );
    await userEvent.click(
      deleteDialog().getByRole('button', { name: '削除', exact: true }),
    );

    await expect
      .element(page.getByText('ヘルプ記事を削除しました。', { exact: true }))
      .toBeVisible();
    await expect
      .poll(() => router.state.location.pathname)
      .toBe(HELP_ARTICLES_PATH);
    await expect
      .element(main().getByRole('link', { name: DRAFT_ARTICLE.title }))
      .toBeVisible();
    observer.disconnect();
    expect(remove).toHaveBeenCalledExactlyOnceWith({
      id: ARTICLE.id,
      reason: '古い説明のため',
    });
    expect(shown).toStrictEqual([]);
  });

  test('既に削除されていれば、ダイアログの中に削除された旨と一覧への導線を示す', async () => {
    const remove = vi.fn<GraphQLHandler>(() => failure(NOT_FOUND));
    const router = await renderWith({ remove });

    await userEvent.click(deleteButton());
    await userEvent.click(
      deleteDialog().getByRole('button', { name: '削除', exact: true }),
    );

    await expect
      .element(deleteDialog().getByRole('alert'))
      .toHaveTextContent(NOT_FOUND_MESSAGE);
    await userEvent.click(listLink(deleteDialog()));
    await expect
      .poll(() => router.state.location.pathname)
      .toBe(HELP_ARTICLES_PATH);
  });

  test('それ以外の失敗は、ダイアログの中に文言だけを示す', async () => {
    const remove = vi.fn<GraphQLHandler>(() =>
      failure({
        code: 'internal_error',
        message: '処理中に問題が発生しました。',
        status: 500,
      }),
    );
    await renderWith({ remove });

    await userEvent.click(deleteButton());
    await userEvent.click(
      deleteDialog().getByRole('button', { name: '削除', exact: true }),
    );

    await expect.element(deleteDialog().getByRole('alert')).toBeVisible();
    expect(listLink(deleteDialog()).query()).toBeNull();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、編集のフォームと公開ページの導線と削除の確認がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith();
      await waitForEditor();
      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(deleteButton());
      await expect.element(deleteDialog()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、閲覧のみの表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({ role: 'VIEWER' });
      await expect.element(titleInput()).toBeDisabled();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、削除済みの案内がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({ article: () => success({ adminHelpArticle: null }) });
      await expect.element(listLink()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
