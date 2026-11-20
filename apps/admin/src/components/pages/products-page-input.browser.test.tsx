import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import {
  emulateReducedMotion,
  REDUCED_MOTION_PREFERENCES,
} from '../../../lib/test/reduced-motion.ts';
import type { GraphQLResult } from '../../../lib/utilities/graphql/graphql-result.ts';
import { success } from '../../../test/admin-accounts-fixtures.ts';
import {
  LAUNCHED_PRODUCT_NODE,
  PRODUCTS_PATH,
  type ProductsHandler,
  productsQueryOf,
  productsVariablesOf,
  renderModerationProductsPage,
  respondModerationProductsGraphQL,
  SUSPENDED_OWNER_PRODUCT_NODE,
  UNLAUNCHED_PRODUCT_NODE,
} from '../../../test/moderation-products-fixtures.ts';
import { nextRendered, scrollPageDown } from '../../../test/window-scroll.ts';
import type { AdminProductsQuery } from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOO_LONG_MESSAGE = '検索語は100文字以内で入力してください。';

const TOO_LONG_TERM = 'あ'.repeat(101);

const FIRST_PAGE = productsQueryOf(
  [LAUNCHED_PRODUCT_NODE, UNLAUNCHED_PRODUCT_NODE],
  'cursor-2',
);

const SECOND_PAGE = productsQueryOf([SUSPENDED_OWNER_PRODUCT_NODE], null);

const main = () => page.getByRole('main');
const table = () => main().getByRole('table', { name: 'プロダクトの一覧' });
const listHeading = () =>
  main().getByRole('heading', { level: 2, name: 'プロダクトの一覧' });
const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
const filterForm = () => main().getByRole('search', { name: '絞り込み' });
const textField = (name: string) =>
  filterForm().getByRole('textbox', { name, exact: true });
const applyButton = () =>
  filterForm().getByRole('button', { name: '適用', exact: true });
const resetButton = () =>
  filterForm().getByRole('button', { name: '解除', exact: true });
const pagination = () => main().getByRole('navigation', { name: 'ページ送り' });
const nextButton = () => pagination().getByRole('button', { name: '次へ' });
const previousButton = () => pagination().getByRole('button', { name: '前へ' });

const lastVariables = () => productsVariablesOf(executeGraphQL).at(-1);

const renderWith = async (products?: ProductsHandler, path?: string) => {
  respondModerationProductsGraphQL(executeGraphQL, {
    role: 'VIEWER',
    ...(products === undefined ? {} : { products }),
  });
  const router = await renderModerationProductsPage('VIEWER', path);
  await expect.element(table()).toBeVisible();
  return router;
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const pressWithKeyboard = async (
  button: ReturnType<typeof nextButton>,
): Promise<void> => {
  (button.element() as HTMLElement).focus();
  await userEvent.keyboard('{Enter}');
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
});

afterEach(async () => {
  vi.restoreAllMocks();
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
  await emulateBrowserDisplay(null);
});

describe('ページの移動のフォーカスとスクロール', () => {
  test.each(REDUCED_MOTION_PREFERENCES)(
    '視差効果の設定が%sのとき、キーボードで押した「次へ」「前へ」は、取り直す間も結果が届いた後もフォーカスを一覧の見出しに置き、一覧の先頭へスクロールする',
    async (preference) => {
      await emulateReducedMotion(preference);
      const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
      let held: Deferred<GraphQLResult<AdminProductsQuery>> | undefined;
      await renderWith(
        ({ after }) =>
          held?.promise ??
          success(after === 'cursor-2' ? SECOND_PAGE : FIRST_PAGE),
      );
      const heading = listHeading().element();
      const behavior = preference === 'reduce' ? 'auto' : 'smooth';

      held = deferred();
      const nextHeld = held;
      await pressWithKeyboard(nextButton());

      expect(document.activeElement).toBe(heading);
      await expect
        .poll(() => table().element().closest('[inert]'))
        .not.toBeNull();
      expect(document.activeElement).toBe(heading);
      await expect
        .poll(() => scrolled.mock.calls)
        .toContainEqual([{ block: 'start', behavior }]);
      held = undefined;
      nextHeld.resolve({ ok: true, data: SECOND_PAGE });
      await expect
        .element(rowOf(SUSPENDED_OWNER_PRODUCT_NODE.name))
        .toBeVisible();
      expect(document.activeElement).toBe(heading);

      scrolled.mockClear();
      held = deferred();
      const previousHeld = held;
      await pressWithKeyboard(previousButton());

      expect(document.activeElement).toBe(heading);
      held = undefined;
      previousHeld.resolve({ ok: true, data: FIRST_PAGE });
      await expect.element(rowOf(LAUNCHED_PRODUCT_NODE.name)).toBeVisible();
      expect(document.activeElement).toBe(heading);
      await expect
        .poll(() => scrolled.mock.calls)
        .toContainEqual([{ block: 'start', behavior }]);
    },
  );

  test('絞り込みの適用ではフォーカスもスクロールも動かさない', async () => {
    const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await renderWith();

    await userEvent.fill(textField('名称'), 'Pitch');
    await userEvent.click(applyButton());

    await expect
      .poll(() => lastVariables()?.filter)
      .toStrictEqual({ name: 'Pitch' });
    await expect.element(rowOf(LAUNCHED_PRODUCT_NODE.name)).toBeVisible();
    await expect.element(applyButton()).toHaveFocus();
    expect(scrolled).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: '適用',
      path: PRODUCTS_PATH,
      button: applyButton,
      search: { name: 'Pitch' },
    },
    {
      name: '解除',
      path: `${PRODUCTS_PATH}?name=Pitch`,
      button: resetButton,
      search: {},
    },
  ])(
    '「$name」で条件を変えても、ページのスクロールを先頭へ戻さず操作した位置に留める',
    async ({ path, button, search }) => {
      const router = await renderWith(undefined, path);
      await userEvent.fill(textField('名称'), 'Pitch');
      const position = scrollPageDown();
      expect(position).toBeGreaterThan(0);
      const rendered = nextRendered(router);

      (button().element() as HTMLElement).click();

      await rendered;
      expect(router.state.location.search).toEqual(search);
      expect(window.scrollY).toBe(position);
    },
  );
});

describe('検索語の上限', () => {
  test('前後の空白を除いて100書記素を超える名称・ハンドル・投稿者のハンドルは適用せず、欄の下の文言を結び付けて最初の超過の欄へフォーカスを戻し、正しく適用すると文言を消す', async () => {
    const router = await renderWith();
    const sentBefore = productsVariablesOf(executeGraphQL).length;

    await userEvent.fill(textField('名称'), ` ${'あ'.repeat(100)} `);
    await userEvent.fill(textField('ハンドル'), TOO_LONG_TERM);
    await userEvent.fill(textField('投稿者のハンドル'), TOO_LONG_TERM);
    await userEvent.click(applyButton());

    const handleField = textField('ハンドル');
    await expect.element(handleField).toHaveFocus();
    await expect.element(handleField).toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(handleField)
      .toHaveAccessibleDescription(TOO_LONG_MESSAGE);
    await expect
      .element(textField('投稿者のハンドル'))
      .toHaveAccessibleDescription(TOO_LONG_MESSAGE);
    await expect.element(textField('名称')).not.toHaveAttribute('aria-invalid');
    expect(router.state.location.search).toEqual({});
    expect(productsVariablesOf(executeGraphQL)).toHaveLength(sentBefore);

    await userEvent.fill(textField('ハンドル'), 'notes');
    await userEvent.fill(textField('投稿者のハンドル'), 'maker_ai');
    await userEvent.click(applyButton());

    await expect.poll(lastVariables).toStrictEqual({
      filter: {
        name: 'あ'.repeat(100),
        handle: 'notes',
        ownerHandle: 'maker_ai',
      },
      first: 50,
    });
    await expect
      .element(textField('ハンドル'))
      .not.toHaveAttribute('aria-invalid');
    expect(filterForm().getByText(TOO_LONG_MESSAGE).query()).toBeNull();
  });

  test('「解除」で上限を超えた旨の文言を消す', async () => {
    await renderWith();
    await userEvent.fill(textField('名称'), TOO_LONG_TERM);
    await userEvent.click(applyButton());
    await expect
      .element(textField('名称'))
      .toHaveAttribute('aria-invalid', 'true');

    await userEvent.click(resetButton());

    await expect.element(textField('名称')).toHaveValue('');
    await expect.element(textField('名称')).not.toHaveAttribute('aria-invalid');
    expect(filterForm().getByText(TOO_LONG_MESSAGE).query()).toBeNull();
  });

  test('ブラウザの戻る操作でURLの条件が変わると、上限を超えた旨の文言を消して入力欄をURLの値に戻す', async () => {
    const router = await renderWith();
    await userEvent.fill(textField('名称'), 'Pitch');
    await userEvent.click(applyButton());
    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({ name: 'Pitch' });
    await userEvent.fill(textField('名称'), TOO_LONG_TERM);
    await userEvent.click(applyButton());
    await expect
      .element(textField('名称'))
      .toHaveAttribute('aria-invalid', 'true');

    router.history.back();

    await expect.poll((): unknown => router.state.location.search).toEqual({});
    await expect.element(textField('名称')).toHaveValue('');
    await expect.element(textField('名称')).not.toHaveAttribute('aria-invalid');
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、上限を超えた旨の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith();
      await userEvent.fill(textField('名称'), TOO_LONG_TERM);
      await userEvent.click(applyButton());
      await expect
        .element(textField('名称'))
        .toHaveAttribute('aria-invalid', 'true');

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
