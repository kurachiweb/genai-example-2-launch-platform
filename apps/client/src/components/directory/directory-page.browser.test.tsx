import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import { directoryItemOf } from './directory-item-fixtures.ts';
import {
  articleOf,
  articles,
  categoryTrigger,
  chooseSort,
  deferred,
  DESCRIPTION,
  DESKTOP,
  directoryOf,
  expectInOrder,
  FAILURE,
  itemsFrom,
  lastDirectoryInput,
  launchCtaHeading,
  listRegion,
  LIST_ERROR_MESSAGE,
  listHeading,
  mainContent,
  okDirectory,
  pageHeading,
  pagination,
  progressBar,
  renderDirectory,
  respond,
  searchBox,
  searchButton,
  sortTrigger,
  textOf,
} from './directory-page-testing.tsx';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

beforeEach(async () => {
  vi.mocked(executeGraphQL).mockReset();
  await page.viewport(DESKTOP.width, DESKTOP.height);
  window.scrollTo(0, 0);
});

afterEach(async () => {
  vi.restoreAllMocks();
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('画面の構成', () => {
  test('見出し・説明・検索欄・絞り込み欄・件数・一覧・ページ送り・ローンチ予約への導線を上から順に置く', async () => {
    respond(() =>
      okDirectory(
        directoryOf({ items: itemsFrom(1, 20), totalCount: 45, pageCount: 3 }),
      ),
    );

    await renderDirectory();

    await expect.element(articleOf('プロダクト1')).toBeVisible();
    expect(
      expectInOrder([
        pageHeading().element(),
        textOf(DESCRIPTION).element(),
        searchBox().element(),
        categoryTrigger().element(),
        listHeading().element(),
        textOf('45件中1〜20件').element(),
        articleOf('プロダクト1').element(),
        articleOf('プロダクト20').element(),
        pagination().element(),
        launchCtaHeading().element(),
      ]),
    ).toBe(true);
    expect(articles().all()).toHaveLength(20);
    expect(
      articleOf('プロダクト1').element().closest('li')?.parentElement?.tagName,
    ).toBe('UL');
    expect(lastDirectoryInput()).toStrictEqual({});
  });

  test('一覧の項目に検索語の強調と登録された項目の値を渡す', async () => {
    respond(() =>
      okDirectory(
        directoryOf({
          searchTerms: ['ノート'],
          items: [
            directoryItemOf({
              name: 'Pitch ノート',
              metrics: [{ key: 'comments', value: 5 }],
            }),
          ],
        }),
      ),
    );

    await renderDirectory({
      path: `/p?q=${encodeURIComponent('ノート')}`,
      metrics: [
        {
          key: 'comments',
          order: 10,
          component: ({ value }) => <span>{`コメント${String(value)}`}</span>,
        },
      ],
    });

    await expect.element(articleOf('Pitch ノート')).toBeVisible();
    expect(
      articleOf('Pitch ノート').element().querySelector('mark')?.textContent,
    ).toBe('ノート');
    await expect
      .element(articleOf('Pitch ノート').getByText('コメント5'))
      .toBeVisible();
    expect(lastDirectoryInput()).toEqual({ q: 'ノート' });
  });
});

describe('条件の変更', () => {
  test('並び順を変えると、ページの番号を外して1ページ目を取得する', async () => {
    respond(() =>
      okDirectory(
        directoryOf({
          items: itemsFrom(41, 5),
          totalCount: 45,
          page: 3,
          pageCount: 3,
        }),
      ),
    );
    const router = await renderDirectory({ path: '/p?page=3&sort=upvotes' });
    await expect.element(articleOf('プロダクト41')).toBeVisible();
    expect(lastDirectoryInput()).toStrictEqual({ sort: 'upvotes', page: '3' });

    await chooseSort('ローンチ日が古い順');

    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({ sort: 'oldest' });
    await expect.poll(() => lastDirectoryInput()).toEqual({ sort: 'oldest' });
  });

  test('検索を実行すると、ページの番号を外して検索語の条件で取得する', async () => {
    respond(() =>
      okDirectory(directoryOf({ totalCount: 45, page: 2, pageCount: 3 })),
    );
    const router = await renderDirectory({ path: '/p?page=2' });
    await expect.element(articleOf('プロダクト1')).toBeVisible();

    await userEvent.fill(searchBox(), 'ノート');
    await userEvent.click(searchButton());

    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({ q: 'ノート' });
    await expect.poll(() => lastDirectoryInput()).toEqual({ q: 'ノート' });
  });

  test('条件の変更ではスクロールもフォーカスの移動もしない', async () => {
    await emulateReducedMotion('reduce');
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    respond(() => okDirectory(directoryOf()));
    const router = await renderDirectory();
    await expect.element(articleOf('プロダクト1')).toBeVisible();

    await chooseSort('ローンチ日が古い順');

    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({ sort: 'oldest' });
    expect(scrollIntoView).not.toHaveBeenCalledWith(
      expect.objectContaining({ block: 'start' }),
    );
    await expect.element(listHeading()).not.toHaveFocus();
  });
});

describe('ページの移動', () => {
  const renderPaged = async () => {
    respond(({ input }) => {
      const pageNumber = Number(input.page ?? '1');
      return okDirectory(
        directoryOf({
          items: itemsFrom((pageNumber - 1) * 20 + 1, 20),
          totalCount: 45,
          page: pageNumber,
          pageCount: 3,
        }),
      );
    });
    const router = await renderDirectory();
    await expect.element(articleOf('プロダクト20')).toBeVisible();
    window.scrollTo(0, document.documentElement.scrollHeight);
    await expect.poll(() => window.scrollY).toBeGreaterThan(0);
    return router;
  };

  const listTop = (): number =>
    listHeading().element().closest('section')?.getBoundingClientRect().top ??
    Number.NaN;

  test('一覧の先頭へスクロールし、一覧の見出しへフォーカスを移す(視差効果を減らす設定では演出なし)', async () => {
    await emulateReducedMotion('reduce');
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    const router = await renderPaged();

    await userEvent.click(pagination().getByRole('link', { name: '次へ' }));

    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({ page: 2 });
    await expect.element(articleOf('プロダクト21')).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
    await expect.poll(listTop).toBeGreaterThanOrEqual(0);
    expect(listTop()).toBeLessThan(DESKTOP.height / 4);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: 'start',
      behavior: 'auto',
    });
  });

  test('視差効果を減らす設定が無ければ、滑らかにスクロールする', async () => {
    await emulateReducedMotion('no-preference');
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    await renderPaged();

    await userEvent.click(
      pagination().getByRole('link', { name: '3ページ目' }),
    );

    await expect.element(articleOf('プロダクト41')).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: 'start',
      behavior: 'smooth',
    });
  });
});

describe('読み込みの状態', () => {
  test('初回の読み込み中は検索欄を残し、カテゴリ欄を無効にして一覧をスケルトンにする', async () => {
    const pending = deferred<unknown>();
    const categories = deferred<unknown>();
    respond(
      () => pending.promise,
      () => categories.promise,
    );

    await renderDirectory({ path: '/p?q=abc' });

    await expect
      .element(page.getByRole('status', { name: 'プロダクト一覧を読み込み中' }))
      .toBeVisible();
    await expect.element(searchBox()).toHaveValue('abc');
    await expect.element(categoryTrigger()).toBeDisabled();
    await expect.element(pagination()).not.toBeInTheDocument();

    pending.resolve(okDirectory(directoryOf()));
    categories.resolve({
      ok: true,
      data: { directoryCategories: [] },
    });
    await expect.element(articleOf('プロダクト1')).toBeVisible();
    await expect.element(categoryTrigger()).toBeEnabled();
  });

  test('条件の変更の後の再読み込み中は、直前の一覧を操作を止めて残し、進捗のバーと「読み込み中…」を出す', async () => {
    const next = deferred<unknown>();
    respond(({ input }) =>
      input.sort === 'oldest' ? next.promise : okDirectory(directoryOf()),
    );
    await renderDirectory();
    await expect.element(textOf('3件')).toBeVisible();
    expect(progressBar()).toBeNull();

    await chooseSort('ローンチ日が古い順');

    await expect.element(textOf('読み込み中…')).toBeVisible();
    await expect.element(articleOf('プロダクト1')).toBeVisible();
    const article = articleOf('プロダクト1').element();
    expect(article.closest('[aria-busy]')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(article.closest('[inert]')).not.toBeNull();
    expect(progressBar()).not.toBeNull();
    expect(searchBox().element().closest('[inert]')).toBeNull();
    await expect.element(searchBox()).toBeEnabled();
    expect(categoryTrigger().element().closest('[inert]')).toBeNull();

    next.resolve(
      okDirectory(directoryOf({ items: itemsFrom(7, 2), totalCount: 2 })),
    );

    await expect.element(articleOf('プロダクト7')).toBeVisible();
    await expect.element(articleOf('プロダクト1')).not.toBeInTheDocument();
    await expect.element(textOf('2件')).toBeVisible();
    expect(articleOf('プロダクト7').element().closest('[inert]')).toBeNull();
    expect(progressBar()).toBeNull();
  });

  test('一覧の取得に失敗すると、検索欄と絞り込み欄を残して再試行と問い合わせへの導線を出し、再試行の後は一覧の見出しへフォーカスを移す', async () => {
    respond(() => FAILURE);
    await renderDirectory();

    await expect.element(textOf(LIST_ERROR_MESSAGE)).toBeVisible();
    await expect
      .element(
        listRegion().getByRole('link', { name: 'お問い合わせ', exact: true }),
      )
      .toHaveAttribute('href', '/contact');
    await expect.element(searchBox()).toBeVisible();
    await expect.element(categoryTrigger()).toBeEnabled();
    await expect.element(sortTrigger()).toBeVisible();
    await expect.element(pagination()).not.toBeInTheDocument();
    await expect.element(launchCtaHeading()).not.toBeInTheDocument();

    respond(() => okDirectory(directoryOf()));
    await userEvent.click(page.getByRole('button', { name: '再試行' }));

    await expect.element(articleOf('プロダクト1')).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
  });

  test('カテゴリの選択肢の取得に失敗しても一覧を表示し、カテゴリ欄は「全て」で操作できる', async () => {
    respond(
      () => okDirectory(directoryOf()),
      () => FAILURE,
    );
    await renderDirectory();

    await expect.element(articleOf('プロダクト1')).toBeVisible();
    await expect.element(categoryTrigger()).toBeEnabled();
    await expect.element(categoryTrigger()).toHaveAccessibleName(/全て/);
  });

  test('条件を指定して0件なら条件の解除を示し、件数・ページ送り・導線を出さない', async () => {
    respond(() =>
      okDirectory(directoryOf({ items: [], totalCount: 0, pageCount: 0 })),
    );
    await renderDirectory({ path: '/p?q=nothing' });

    await expect
      .element(
        page.getByRole('heading', {
          level: 3,
          name: '条件に一致するプロダクトはありません。',
        }),
      )
      .toBeVisible();
    await expect.element(pagination()).not.toBeInTheDocument();
    await expect.element(launchCtaHeading()).not.toBeInTheDocument();
    await expect.element(page.getByText(/^\d+件$/)).not.toBeInTheDocument();
  });

  test('ページの番号が全ページ数を超えると範囲外の案内を示し、件数とページ送りを出さない', async () => {
    respond(() =>
      okDirectory(
        directoryOf({ items: [], totalCount: 45, page: 9, pageCount: 3 }),
      ),
    );
    await renderDirectory({ path: '/p?page=9' });

    await expect
      .element(
        page.getByRole('heading', {
          level: 3,
          name: 'このページにはプロダクトがありません。',
        }),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole('link', { name: '1ページ目へ' }))
      .toHaveAttribute('href', '/p');
    await expect.element(pagination()).not.toBeInTheDocument();
    await expect.element(page.getByText(/件中/)).not.toBeInTheDocument();
    await expect.element(launchCtaHeading()).not.toBeInTheDocument();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('表示した一覧のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    respond(() =>
      okDirectory(
        directoryOf({ items: itemsFrom(1, 20), totalCount: 45, pageCount: 3 }),
      ),
    );
    await renderDirectory();
    await expect.element(articleOf('プロダクト20')).toBeVisible();

    expect(await runAxe(mainContent())).toStrictEqual([]);
  });

  test('再読み込み中と取得の失敗のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const next = deferred<unknown>();
    respond(({ input }) =>
      input.sort === 'oldest' ? next.promise : okDirectory(directoryOf()),
    );
    await renderDirectory();
    await expect.element(articleOf('プロダクト1')).toBeVisible();
    await chooseSort('ローンチ日が古い順');
    await expect.element(textOf('読み込み中…')).toBeVisible();

    expect(await runAxe(mainContent())).toStrictEqual([]);

    next.resolve(FAILURE);
    await expect.element(textOf(LIST_ERROR_MESSAGE)).toBeVisible();

    expect(await runAxe(mainContent())).toStrictEqual([]);
  });
});
