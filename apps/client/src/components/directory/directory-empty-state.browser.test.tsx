import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import type { DirectoryQuery } from '../../../common-lib/directory/directory-query-rules.ts';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  DirectoryEmptyState,
  type DirectoryEmptyStateProps,
} from './directory-empty-state.tsx';

// テストのルーターがログイン中の利用者の取得を読み込むため、サーバーの実行の入口を読み込まないよう差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const BUSINESS_TODAY = '2026-11-10';

const ALL_CONDITIONS: DirectoryQuery = {
  q: 'note',
  category: 'developer-tools',
  from: '2026-09-01',
  to: '2026-09-30',
  sort: 'upvotes',
  page: 3,
};

const ALL_CONDITIONS_PATH =
  '/p?q=note&category=developer-tools&from=2026-09-01&to=2026-09-30&sort=upvotes&page=3';

const renderEmptyState = (
  props: DirectoryEmptyStateProps,
  path = ALL_CONDITIONS_PATH,
) =>
  renderInRouter(
    <DisplayPreferencesProvider
      initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
    >
      <main className="bg-background p-4 text-foreground">
        <h2>プロダクト一覧</h2>
        <DirectoryEmptyState {...props} />
      </main>
    </DisplayPreferencesProvider>,
    { path },
  );

const noResultsOf = (
  query: DirectoryQuery,
  overrides: Partial<
    Omit<Extract<DirectoryEmptyStateProps, { kind: 'noResults' }>, 'kind'>
  > = {},
): DirectoryEmptyStateProps => ({
  kind: 'noResults',
  query,
  categoryName: '開発ツール',
  businessToday: BUSINESS_TODAY,
  signedIn: false,
  ...overrides,
});

const linkNamed = (name: string) =>
  page.getByRole('link', { name, exact: true });

afterEach(() => {
  applyColorScheme('light');
});

describe('DirectoryEmptyStateの条件を指定中の0件', () => {
  test('見出し「条件に一致するプロダクトはありません。」と、キーワードを変えるか絞り込みを解除する案内を示す', async () => {
    await renderEmptyState(noResultsOf(ALL_CONDITIONS));

    await expect
      .element(
        page.getByRole('heading', {
          level: 3,
          name: '条件に一致するプロダクトはありません。',
        }),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          'キーワードを変えるか、絞り込みを解除してお試しください。',
          { exact: true },
        ),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByRole('region', {
          name: '条件に一致するプロダクトはありません。',
        }),
      )
      .toBeVisible();
  });

  test('指定中の条件ごとの解除は、その条件だけを外し、他の条件と並び順を保って1ページ目へ戻すリンクにする', async () => {
    await renderEmptyState(noResultsOf(ALL_CONDITIONS));

    await expect
      .element(linkNamed('キーワード「note」を解除'))
      .toHaveAttribute(
        'href',
        '/p?category=developer-tools&from=2026-09-01&to=2026-09-30&sort=upvotes',
      );
    await expect
      .element(linkNamed('カテゴリ「開発ツール」を解除'))
      .toHaveAttribute(
        'href',
        '/p?q=note&from=2026-09-01&to=2026-09-30&sort=upvotes',
      );
    await expect
      .element(linkNamed('期間「9月1日〜9月30日」を解除'))
      .toHaveAttribute(
        'href',
        '/p?q=note&category=developer-tools&sort=upvotes',
      );
  });

  test('条件が2つ以上なら、加えて並び順だけを保つ「条件をすべて解除」を最後に置く', async () => {
    await renderEmptyState(noResultsOf(ALL_CONDITIONS));

    await expect
      .element(linkNamed('条件をすべて解除'))
      .toHaveAttribute('href', '/p?sort=upvotes');
    const names = page
      .getByRole('link')
      .elements()
      .map((link) => link.textContent);
    expect(names).toStrictEqual([
      'キーワード「note」を解除',
      'カテゴリ「開発ツール」を解除',
      '期間「9月1日〜9月30日」を解除',
      '条件をすべて解除',
    ]);
  });

  test('期間の解除は、期間の両端の日付を<time>要素で示す', async () => {
    await renderEmptyState(noResultsOf(ALL_CONDITIONS));

    const times = Array.from(
      linkNamed('期間「9月1日〜9月30日」を解除')
        .element()
        .querySelectorAll('time'),
    ).map((time) => time.getAttribute('datetime'));
    expect(times).toStrictEqual(['2026-09-01', '2026-09-30']);
  });

  test('プリセットと一致する期間は、プリセットの名前で示す', async () => {
    await renderEmptyState(
      noResultsOf({ from: '2026-11-09', to: '2026-11-09' }),
      '/p?from=2026-11-09&to=2026-11-09',
    );

    await expect
      .element(linkNamed('期間「昨日」を解除'))
      .toHaveAttribute('href', '/p');
  });

  test('今年でない日付と、片方だけの期間は、期間の表示の形で示す', async () => {
    await renderEmptyState(
      noResultsOf({ q: 'note', from: '2025-09-14' }),
      '/p?q=note&from=2025-09-14',
    );

    await expect
      .element(linkNamed('期間「2025年9月14日以降」を解除'))
      .toHaveAttribute('href', '/p?q=note');
  });

  test('条件が1つだけなら、その条件の解除だけを置き「条件をすべて解除」を置かない', async () => {
    await renderEmptyState(
      noResultsOf({ category: 'developer-tools', sort: 'oldest' }),
      '/p?category=developer-tools&sort=oldest',
    );

    await expect
      .element(linkNamed('カテゴリ「開発ツール」を解除'))
      .toHaveAttribute('href', '/p?sort=oldest');
    expect(page.getByRole('link').elements()).toHaveLength(1);
    expect(linkNamed('条件をすべて解除').elements()).toHaveLength(0);
  });

  test('キーワードを外すと、キーワードが要る並び順「関連度」は既定の並び順に戻る', async () => {
    await renderEmptyState(
      noResultsOf({ q: 'note', category: 'developer-tools' }),
      '/p?q=note&category=developer-tools',
    );

    await expect
      .element(linkNamed('キーワード「note」を解除'))
      .toHaveAttribute('href', '/p?category=developer-tools');
  });

  test('カテゴリの名前が分からないときは、カテゴリのハンドルで示す', async () => {
    await renderEmptyState(
      noResultsOf({ category: 'developer-tools' }, { categoryName: undefined }),
      '/p?category=developer-tools',
    );

    await expect
      .element(linkNamed('カテゴリ「developer-tools」を解除'))
      .toHaveAttribute('href', '/p');
  });

  test('解除のリンクは表示中の一覧と同じURLを指していても現在のページの印を付けない', async () => {
    await renderEmptyState(
      noResultsOf({ q: 'note', category: 'developer-tools' }),
      '/p?category=developer-tools',
    );

    await expect
      .element(linkNamed('キーワード「note」を解除'))
      .not.toHaveAttribute('aria-current');
  });

  test('解除のリンクを押すと、その条件を外した一覧へページを読み込み直さずに遷移する', async () => {
    const router = await renderEmptyState(noResultsOf(ALL_CONDITIONS));

    await userEvent.click(linkNamed('条件をすべて解除'));

    await vi.waitFor(() => {
      expect(router.state.location.href).toBe('/p?sort=upvotes');
    });
  });
});

describe('DirectoryEmptyStateの条件なしの0件', () => {
  test('見出し「ディレクトリに掲載されたプロダクトはまだありません。」と、ローンチの予約を促す説明を示す', async () => {
    await renderEmptyState(noResultsOf({}), '/p');

    await expect
      .element(
        page.getByRole('heading', {
          level: 3,
          name: 'ディレクトリに掲載されたプロダクトはまだありません。',
        }),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          '予選マッチに勝利したプロダクトがここに並びます。最初の勝者を目指して、ローンチを予約しましょう。',
          { exact: true },
        ),
      )
      .toBeVisible();
    expect(page.getByText(/を解除/u).elements()).toHaveLength(0);
  });

  test('並び順だけを変えている場合も、条件なしの0件として示す', async () => {
    await renderEmptyState(noResultsOf({ sort: 'oldest' }), '/p?sort=oldest');

    await expect
      .element(
        page.getByRole('heading', {
          name: 'ディレクトリに掲載されたプロダクトはまだありません。',
        }),
      )
      .toBeVisible();
    expect(linkNamed('条件をすべて解除').elements()).toHaveLength(0);
  });

  test('未ログインの導線「ログインしてローンチを予約🚀」は、プロダクト登録を戻り先にしたログインへ遷移する', async () => {
    await renderEmptyState(noResultsOf({}, { signedIn: false }), '/p');

    await expect
      .element(linkNamed('ログインしてローンチを予約🚀'))
      .toHaveAttribute('href', '/auth/login?redirect=%2Fmy%2Fproducts%2Fnew');
  });

  test('ログイン中の導線「ローンチを予約🚀」は、プロダクト登録へ遷移する', async () => {
    await renderEmptyState(noResultsOf({}, { signedIn: true }), '/p');

    await expect
      .element(linkNamed('ローンチを予約🚀'))
      .toHaveAttribute('href', '/my/products/new');
  });
});

describe('DirectoryEmptyStateの範囲外のページ', () => {
  test('見出し「このページにはプロダクトがありません。」と全ページ数を3桁区切りで示す', async () => {
    await renderEmptyState(
      { kind: 'outOfRange', query: ALL_CONDITIONS, pageCount: 1234 },
      ALL_CONDITIONS_PATH,
    );

    await expect
      .element(
        page.getByRole('heading', {
          level: 3,
          name: 'このページにはプロダクトがありません。',
        }),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          '一覧は全1,234ページです。1ページ目から探してみましょう。',
          { exact: true },
        ),
      )
      .toBeVisible();
  });

  test('「1ページ目へ」は、ページの番号だけを外して条件と並び順を保つ', async () => {
    await renderEmptyState(
      { kind: 'outOfRange', query: ALL_CONDITIONS, pageCount: 62 },
      ALL_CONDITIONS_PATH,
    );

    await expect
      .element(linkNamed('1ページ目へ'))
      .toHaveAttribute(
        'href',
        '/p?q=note&category=developer-tools&from=2026-09-01&to=2026-09-30&sort=upvotes',
      );
    expect(page.getByRole('link').elements()).toHaveLength(1);
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test.each([
    ['条件を指定中の0件', noResultsOf(ALL_CONDITIONS), ALL_CONDITIONS_PATH],
    ['条件なしの0件', noResultsOf({}), '/p'],
    [
      '範囲外のページ',
      { kind: 'outOfRange', query: ALL_CONDITIONS, pageCount: 62 } as const,
      ALL_CONDITIONS_PATH,
    ],
  ] as const)(
    '%sのアクセシビリティの検査の違反が0件',
    async (_name, props, path) => {
      applyColorScheme(scheme);
      await renderEmptyState(props, path);

      await expect
        .element(page.getByRole('heading', { level: 3 }))
        .toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
