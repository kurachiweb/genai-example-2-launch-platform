import { createRoute } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  renderInRouter,
  renderPageRouter,
} from '../../../test/page-router.tsx';
import {
  ClientPinnedHelpArticlesDocument,
  type ClientPinnedHelpArticlesQuery,
} from '../../graphql/generated/graphql.ts';
import { SiteFooter } from '../layout/site-footer.tsx';
import { PinnedHelpLinks } from './pinned-help-links.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

// 並び順の規則の結果とは異なる、APIが返した順をそのまま描くことを確かめるための順
const PINNED: ClientPinnedHelpArticlesQuery = {
  pinnedHelpArticles: [
    { handle: 'week-tournament', title: 'Weekトーナメントの参加方法' },
    { handle: 'how-it-works', title: 'Launch Stadiumの仕組み' },
    { handle: 'upvote-rules', title: 'Upvoteのルール' },
  ],
};

const INTERNAL_ERROR = new GraphQLClientError({
  code: 'internal_error',
  message: 'サーバーでエラーが発生しました。',
  status: 500,
});

const respondWith = (
  result: ClientPinnedHelpArticlesQuery | Error | 'pending',
) => {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document !== ClientPinnedHelpArticlesDocument) {
      return Promise.reject(new Error('想定外の操作です。'));
    }
    if (result === 'pending') {
      return new Promise(() => undefined);
    }
    return Promise.resolve(
      result instanceof Error
        ? { ok: false, error: result }
        : { ok: true, data: result },
    );
  });
};

const pinnedCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientPinnedHelpArticlesDocument,
  );

const renderFooter = () =>
  renderInRouter(<SiteFooter helpLinks={[PinnedHelpLinks]} />, {
    cachedPinnedHelpArticles: null,
  });

const helpNavigation = () =>
  page.getByRole('navigation', { name: 'ヘルプ', exact: true });
const policyNavigation = () =>
  page.getByRole('navigation', { name: '規約・問い合わせ', exact: true });

const helpList = (): Element => {
  const list = document.querySelector('footer nav[aria-label="ヘルプ"] ul');
  if (list === null) {
    throw new Error('フッターのヘルプの一覧がありません。');
  }
  return list;
};

const helpLinkEntries = () =>
  Array.from(helpList().querySelectorAll('a'), (link) => [
    link.textContent,
    link.getAttribute('href'),
  ]);

const expectOnlyHelpTopAndOtherParts = async () => {
  await expect
    .element(
      helpNavigation().getByRole('link', { name: 'ヘルプ', exact: true }),
    )
    .toHaveAttribute('href', '/help');
  await expect
    .element(
      policyNavigation().getByRole('link', { name: '利用規約', exact: true }),
    )
    .toBeVisible();
  expect(helpLinkEntries()).toStrictEqual([['ヘルプ', '/help']]);
  expect(
    Array.from(helpList().children, (element) => element.tagName),
  ).toStrictEqual(['LI']);
};

afterEach(() => {
  executeGraphQL.mockReset();
});

describe('PinnedHelpLinks', () => {
  test('ヘルプトップへのリンクに続けて、ピン留め記事をAPIが返した順のままタイトルのリンクとして並べる', async () => {
    respondWith(PINNED);

    await renderFooter();

    await expect
      .element(
        helpNavigation().getByRole('link', {
          name: 'Upvoteのルール',
          exact: true,
        }),
      )
      .toHaveAttribute('href', '/help/upvote-rules');
    expect(helpLinkEntries()).toStrictEqual([
      ['ヘルプ', '/help'],
      ['Weekトーナメントの参加方法', '/help/week-tournament'],
      ['Launch Stadiumの仕組み', '/help/how-it-works'],
      ['Upvoteのルール', '/help/upvote-rules'],
    ]);
    expect(
      Array.from(helpList().children, (element) => element.tagName),
    ).toStrictEqual(['LI', 'LI', 'LI', 'LI']);
    expect(helpList().querySelectorAll('li li')).toHaveLength(0);
    expect(pinnedCalls()).toHaveLength(1);
    expect(await runAxe(page.getByRole('contentinfo').element())).toStrictEqual(
      [],
    );
  });

  test('任意のページの共通レイアウトのフッターに、登録箇所からピン留め記事を表示する', async () => {
    respondWith(PINNED);

    await renderPageRouter({
      path: '/p',
      cachedPinnedHelpArticles: null,
      createRoutes: (rootRoute) => [
        createRoute({
          getParentRoute: () => rootRoute,
          path: '/p',
          component: () => <h1>ディレクトリ</h1>,
        }),
      ],
    });

    await expect
      .element(
        helpNavigation().getByRole('link', {
          name: 'Weekトーナメントの参加方法',
          exact: true,
        }),
      )
      .toHaveAttribute('href', '/help/week-tournament');
    expect(helpLinkEntries()).toStrictEqual([
      ['ヘルプ', '/help'],
      ['Weekトーナメントの参加方法', '/help/week-tournament'],
      ['Launch Stadiumの仕組み', '/help/how-it-works'],
      ['Upvoteのルール', '/help/upvote-rules'],
    ]);
  });

  test('ピン留め記事が無ければ、ヘルプトップへのリンクだけを表示する', async () => {
    respondWith({ pinnedHelpArticles: [] });

    await renderFooter();

    await expect.poll(() => pinnedCalls().length).toBe(1);
    await expectOnlyHelpTopAndOtherParts();
  });

  test('読み込み中は何も描かず、ヘルプトップへのリンクとフッターの他の部分を表示する', async () => {
    respondWith('pending');

    await renderFooter();

    await expect.poll(() => pinnedCalls().length).toBe(1);
    await expectOnlyHelpTopAndOtherParts();
    expect(await runAxe(page.getByRole('contentinfo').element())).toStrictEqual(
      [],
    );
  });

  test('取得に失敗すると何も描かず、ヘルプトップへのリンクとフッターの他の部分を表示する', async () => {
    respondWith(INTERNAL_ERROR);

    await renderFooter();

    await expect.poll(() => pinnedCalls().length).toBe(1);
    await expectOnlyHelpTopAndOtherParts();
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    expect(await runAxe(page.getByRole('contentinfo').element())).toStrictEqual(
      [],
    );
  });
});
