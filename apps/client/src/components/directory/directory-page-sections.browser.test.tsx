import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';

import '../../styles.css';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import {
  articleOf,
  articles,
  chooseSort,
  deferred,
  DESKTOP,
  directoryOf,
  expectInOrder,
  itemsFrom,
  launchCtaHeading,
  okDirectory,
  pageHeading,
  progressBar,
  renderDirectory,
  respond,
  searchBox,
  textOf,
  UNEXPECTED_MESSAGE,
} from './directory-page-testing.tsx';
import type {
  DirectoryListInsert,
  DirectoryPlacement,
  DirectorySection,
  DirectorySectionContext,
} from './directory-section-types.ts';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const labeled = (label: string): DirectorySection['component'] =>
  function LabeledSection({ viewer, query }: DirectorySectionContext) {
    return (
      <p className="rounded-xl border p-3">
        {`${label}(${viewer.signedIn ? 'ログイン中' : '未ログイン'}・${query.sort ?? '既定'})`}
      </p>
    );
  };

const sectionOf = (
  id: string,
  placement: DirectoryPlacement,
  order: number,
  component: DirectorySection['component'] = labeled(id),
): DirectorySection => ({ id, placement, order, component });

const insertOf = (
  id: string,
  every: number,
  component: DirectoryListInsert['component'] = ({ position }) => (
    <p>{`${id}の${String(position)}回目`}</p>
  ),
): DirectoryListInsert => ({ id, order: 10, every, component });

function NothingSection(): null {
  return null;
}

function ThrowingSection(): never {
  throw new Error('区画の描画の失敗');
}

const rectOf = (element: Element | null | undefined): DOMRect => {
  if (element === null || element === undefined) {
    throw new Error('要素がありません。');
  }
  return element.getBoundingClientRect();
};

beforeEach(async () => {
  vi.mocked(executeGraphQL).mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
  await page.viewport(DESKTOP.width, DESKTOP.height);
  window.scrollTo(0, 0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('区画の登録口', () => {
  test('置き場所ごとにorderの順で並べ、閲覧者と現在の条件を渡す', async () => {
    respond(() => okDirectory(directoryOf()));
    await renderDirectory({
      path: '/p?sort=upvotes',
      sections: [
        sectionOf('ads.bottom', 'bottom', 10),
        sectionOf('ads.aside-late', 'aside', 20),
        sectionOf('ads.banner', 'banner', 10),
        sectionOf('ads.aside-early', 'aside', 10),
      ],
    });

    const label = (id: string) => textOf(`${id}(未ログイン・upvotes)`);
    await expect.element(label('ads.banner')).toBeVisible();
    expect(
      expectInOrder([
        label('ads.banner').element(),
        pageHeading().element(),
        searchBox().element(),
        articleOf('プロダクト1').element(),
        label('ads.aside-early').element(),
        label('ads.aside-late').element(),
        launchCtaHeading().element(),
        label('ads.bottom').element(),
      ]),
    ).toBe(true);
    expect(rectOf(label('ads.aside-early').element()).left).toBeGreaterThan(
      rectOf(articleOf('プロダクト1').element()).right,
    );
  });

  test('区画の1つが失敗しても、その位置に失敗を示して一覧と他の区画を表示する', async () => {
    respond(() => okDirectory(directoryOf()));
    await renderDirectory({
      sections: [
        sectionOf('ads.broken', 'aside', 10, ThrowingSection),
        sectionOf('ads.banner', 'banner', 10),
      ],
    });

    await expect.element(textOf(UNEXPECTED_MESSAGE)).toBeVisible();
    await expect.element(articleOf('プロダクト1')).toBeVisible();
    await expect.element(textOf('ads.banner(未ログイン・既定)')).toBeVisible();
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalled();
  });

  test('何も描かない区画は枠と間隔を残さない', async () => {
    respond(() => okDirectory(directoryOf()));
    await renderDirectory();
    await expect.element(articleOf('プロダクト1')).toBeVisible();
    const measure = () => ({
      headingTop: rectOf(pageHeading().element()).top,
      searchBottom: rectOf(searchBox().element()).bottom,
      itemWidth: rectOf(articleOf('プロダクト1').element()).width,
      ctaBottom: rectOf(launchCtaHeading().element().closest('section')).bottom,
      pageBottom: document.documentElement.scrollHeight,
    });
    const withoutSections = measure();
    await cleanup();

    await renderDirectory({
      sections: [
        sectionOf('ads.banner', 'banner', 10, NothingSection),
        sectionOf('ads.aside', 'aside', 10, NothingSection),
        sectionOf('ads.bottom', 'bottom', 10, NothingSection),
      ],
    });
    await expect.element(articleOf('プロダクト1')).toBeVisible();

    expect(measure()).toStrictEqual(withoutSections);
  });

  describe('一覧の差し込み', () => {
    test('指定の件数ごとに(割り切れるときは最後の項目の後にも)差し込み、何回目かを渡す', async () => {
      respond(() =>
        okDirectory(directoryOf({ items: itemsFrom(1, 4), totalCount: 4 })),
      );
      await renderDirectory({ inserts: [insertOf('ads.inline', 2)] });

      await expect.element(textOf('ads.inlineの2回目')).toBeVisible();
      expect(
        expectInOrder([
          articleOf('プロダクト2').element(),
          textOf('ads.inlineの1回目').element(),
          articleOf('プロダクト3').element(),
          articleOf('プロダクト4').element(),
          textOf('ads.inlineの2回目').element(),
        ]),
      ).toBe(true);
      expect(
        textOf('ads.inlineの1回目').element().closest('li')?.parentElement,
      ).toBe(articleOf('プロダクト1').element().closest('ul'));
    });

    test('差し込みの失敗は一覧を止めず、何も描かない差し込みは一覧の項目と間隔を残さない', async () => {
      respond(() =>
        okDirectory(directoryOf({ items: itemsFrom(1, 3), totalCount: 3 })),
      );
      await renderDirectory({
        inserts: [
          insertOf('ads.broken', 3, ThrowingSection),
          insertOf('ads.nothing', 1, NothingSection),
        ],
      });

      await expect.element(textOf(UNEXPECTED_MESSAGE)).toBeVisible();
      expect(articles().all()).toHaveLength(3);
      const list = articleOf('プロダクト1').element().closest('ul');
      expect(
        page
          .elementLocator(list as HTMLElement)
          .getByRole('listitem')
          .all(),
      ).toHaveLength(4);
      const first = rectOf(articleOf('プロダクト1').element());
      const second = rectOf(articleOf('プロダクト2').element());
      const third = rectOf(articleOf('プロダクト3').element());
      expect(second.top - first.bottom).toBe(third.top - second.bottom);
    });
  });
});

describe('演出', () => {
  test('表示の後に動いている要素が無く、再読み込み中に動くのは進捗のバーだけ', async () => {
    const next = deferred<unknown>();
    respond(({ input }) =>
      input.sort === 'oldest' ? next.promise : okDirectory(directoryOf()),
    );
    await renderDirectory();
    await expect.element(articleOf('プロダクト1')).toBeVisible();
    await expect.poll(() => document.getAnimations()).toHaveLength(0);

    await chooseSort('ローンチ日が古い順');
    await expect.element(textOf('読み込み中…')).toBeVisible();
    const bar = progressBar();
    expect(bar).not.toBeNull();
    await expect
      .poll(() =>
        document
          .getAnimations()
          .filter((animation) => animation.playState === 'running'),
      )
      .not.toHaveLength(0);
    expect(
      document
        .getAnimations()
        .filter((animation) => animation.playState === 'running')
        .every((animation) => {
          const target =
            animation.effect instanceof KeyframeEffect
              ? animation.effect.target
              : null;
          return target !== null && bar?.contains(target) === true;
        }),
    ).toBe(true);

    next.resolve(okDirectory(directoryOf()));
    await expect.element(textOf('3件')).toBeVisible();
    await expect.poll(() => document.getAnimations()).toHaveLength(0);
  });
});
