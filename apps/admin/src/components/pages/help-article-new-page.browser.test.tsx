import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  callsOf,
  type GraphQLHandler,
  success,
} from '../../../test/admin-accounts-fixtures.ts';
import {
  HELP_ARTICLE_NEW_PATH,
  HELP_ARTICLES_PATH,
  helpArticlePathOf,
  renderHelpArticlesPage,
  respondAdminHelpArticlesGraphQL,
} from '../../../test/admin-help-articles-fixtures.ts';
import { loadAdminHelpArticleNewPage } from '../../graphql/admin-help-articles.ts';
import {
  AdminCreateHelpArticleDocument,
  AdminHelpArticlesDocument,
  type AdminRole,
} from '../../graphql/generated/graphql.ts';
import { Route as HelpArticleNewRoute } from '../../routes/_authenticated/help-articles/new.tsx';
import {
  button,
  categoryTrigger,
  fillAndBlur,
  handleInput,
  option,
  PRICING,
  savedArticleOf,
  statusRadio,
  subtitleInput,
  titleInput,
  USAGE,
  OTHER,
  waitForEditor,
} from '../help/help-article-form-testing.tsx';
import { requireHelpArticleEditor } from '../help/require-help-article-editor.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const main = () => page.getByRole('main');

const heading = () => main().getByRole('heading', { level: 1 });

const createForm = () =>
  main().getByRole('form', { name: 'ヘルプ記事の作成', exact: true });

const CREATED = savedArticleOf({ revision: 1, previousHandle: null });

const renderWith = async ({
  role = 'MODERATOR',
  create,
  article,
}: {
  readonly role?: AdminRole;
  readonly create?: GraphQLHandler;
  readonly article?: GraphQLHandler;
} = {}) => {
  respondAdminHelpArticlesGraphQL(executeGraphQL, {
    role,
    ...(create === undefined ? {} : { create }),
    ...(article === undefined ? {} : { article }),
  });
  await render(<Toaster />);
  return renderHelpArticlesPage(role, HELP_ARTICLE_NEW_PATH);
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

test('経路の設定は画面のテストが写したものと同じ権限の確認と読み込みの関数を使う', () => {
  expect(HelpArticleNewRoute.options.beforeLoad).toBe(requireHelpArticleEditor);
  expect(HelpArticleNewRoute.options.loader).toBe(loadAdminHelpArticleNewPage);
});

describe('ヘルプ記事の作成の画面', () => {
  test('題名の下に空の作成のフォームを置き、カテゴリの選択肢を管理者が指定した並び順で示す', async () => {
    await renderWith();

    await expect.element(heading()).toHaveTextContent('ヘルプ記事の作成');
    await expect.element(createForm()).toBeVisible();
    await expect.element(titleInput()).toHaveValue('');
    await expect.element(statusRadio('下書き')).toBeChecked();
    await userEvent.click(categoryTrigger());
    expect(
      page
        .getByRole('option')
        .elements()
        .map((element) => element.textContent),
    ).toStrictEqual([PRICING.name, USAGE.name, OTHER.name]);
    await userEvent.keyboard('{Escape}');
  });

  test('作成に成功すると、トーストで知らせて作成した記事の編集画面へ移す', async () => {
    const create = vi.fn<GraphQLHandler>(() =>
      success({ createHelpArticle: CREATED }),
    );
    const article = vi.fn<GraphQLHandler>(() =>
      success({ adminHelpArticle: CREATED }),
    );
    const router = await renderWith({ create, article });
    const body = await waitForEditor();

    await userEvent.fill(titleInput(), CREATED.title);
    await userEvent.fill(subtitleInput(), CREATED.subtitle);
    await fillAndBlur(handleInput(), CREATED.handle);
    await userEvent.click(categoryTrigger());
    await userEvent.click(option(USAGE.name));
    await userEvent.click(body);
    await userEvent.keyboard('1人1票です。');
    await userEvent.click(button('作成する'));

    await expect
      .element(page.getByText('ヘルプ記事を作成しました。', { exact: true }))
      .toBeVisible();
    await expect
      .poll(() => router.state.location.pathname)
      .toBe(helpArticlePathOf(CREATED.id));
    await expect.element(heading()).toHaveTextContent('ヘルプ記事の編集');
    await expect.element(titleInput()).toHaveValue(CREATED.title);
    expect(
      callsOf(executeGraphQL, AdminCreateHelpArticleDocument),
    ).toHaveLength(1);
    expect(article).toHaveBeenCalledWith({ id: CREATED.id });
  });

  test('閲覧のみの管理者は作成の画面を開けず、ヘルプ記事の一覧へ戻される', async () => {
    const router = await renderWith({ role: 'VIEWER' });

    await expect
      .poll(() => router.state.location.pathname)
      .toBe(HELP_ARTICLES_PATH);
    await expect.element(heading()).toHaveTextContent('ヘルプ記事');
    expect(createForm().query()).toBeNull();
    expect(callsOf(executeGraphQL, AdminHelpArticlesDocument)).not.toHaveLength(
      0,
    );
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、作成のフォームがWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith();
      await waitForEditor();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
