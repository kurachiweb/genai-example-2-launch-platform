import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import { success } from '../../../test/admin-accounts-fixtures.ts';
import {
  ACTIVE_USER_NODE,
  MODERATION_DISPLAY,
} from '../../../test/moderation-fixtures.ts';
import {
  PUBLIC_AVATAR_USER_NODE,
  SUSPENDED_USER_NODE,
  USER_NODES,
  USERS_PATH,
  type UsersHandler,
  usersQueryOf,
  usersVariablesOf,
} from '../../../test/moderation-users-fixtures.tsx';
import {
  applyButton,
  chooseStatus,
  filterForm,
  listHeading,
  nextButton,
  previousButton,
  resetButton,
  rowOf,
  statusSelect,
  table,
  textField,
  usersPageHarness,
} from '../../../test/moderation-users-page.ts';
import { nextRendered, scrollPageDown } from '../../../test/window-scroll.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const { renderWith, lastVariables } = usersPageHarness(executeGraphQL);

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  vi.restoreAllMocks();
  toast.dismiss();
  await emulateReducedMotion('no-preference');
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

const EMAIL_NOTICE = 'メールアドレスの検索は監査ログに記録されます。';

const TERM_TOO_LONG_MESSAGE = '検索語は100文字以内で入力してください。';

describe('絞り込み', () => {
  test('メールアドレスの欄に、検索が監査ログに記録される旨を説明として関連付けて示す', async () => {
    await renderWith();

    await expect
      .element(textField('メールアドレス'))
      .toHaveAccessibleDescription(EMAIL_NOTICE);
    await expect.element(filterForm().getByText(EMAIL_NOTICE)).toBeVisible();
  });

  test('ハンドル・ニックネーム・メールアドレス・停止状態の条件を組み合わせて求め直し、条件をURLに残し、ページの位置を捨てて1ページ目にする', async () => {
    const router = await renderWith({ path: `${USERS_PATH}?after=cursor-2` });
    await expect.element(table()).toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: {},
      first: 50,
      after: 'cursor-2',
    });

    await textField('ハンドル').fill(' maker ');
    await textField('ニックネーム').fill('サンプル');
    await textField('メールアドレス').fill('Taro@Mail.Example');
    await chooseStatus('停止中');
    await userEvent.click(applyButton());

    await expect.poll(lastVariables).toStrictEqual({
      filter: {
        handle: 'maker',
        nickname: 'サンプル',
        email: 'Taro@Mail.Example',
        status: 'SUSPENDED',
      },
      first: 50,
    });
    expect(router.state.location.search).toEqual({
      handle: 'maker',
      nickname: 'サンプル',
      email: 'Taro@Mail.Example',
      status: 'suspended',
    });
    await expect.element(applyButton()).toHaveFocus();
  });

  test('URLの条件を入力欄と選択欄に示して求め、「解除」で条件を全て外して1ページ目を求め直す', async () => {
    const router = await renderWith({
      path: `${USERS_PATH}?handle=maker&nickname=%E5%A4%AA%E9%83%8E&email=taro%40mail.example&status=active&after=cursor-2`,
    });
    await expect.element(textField('ハンドル')).toHaveValue('maker');
    await expect.element(textField('ニックネーム')).toHaveValue('太郎');
    await expect
      .element(textField('メールアドレス'))
      .toHaveValue('taro@mail.example');
    await expect.element(statusSelect()).toHaveTextContent('利用中');
    expect(lastVariables()).toStrictEqual({
      filter: {
        handle: 'maker',
        nickname: '太郎',
        email: 'taro@mail.example',
        status: 'ACTIVE',
      },
      first: 50,
      after: 'cursor-2',
    });

    await userEvent.click(resetButton());

    await expect.poll(lastVariables).toStrictEqual({ filter: {}, first: 50 });
    expect(router.state.location.search).toEqual({});
    await expect.element(textField('ハンドル')).toHaveValue('');
    await expect.element(textField('メールアドレス')).toHaveValue('');
    await expect.element(statusSelect()).toHaveTextContent('すべて');
  });

  test.each([
    {
      name: '適用',
      path: USERS_PATH,
      button: applyButton,
      search: { handle: 'maker' },
    },
    {
      name: '解除',
      path: `${USERS_PATH}?handle=maker`,
      button: resetButton,
      search: {},
    },
  ])(
    '「$name」で条件を変えても、ページのスクロールを先頭へ戻さず操作した位置に留める',
    async ({ path, button, search }) => {
      const router = await renderWith({ path });
      await expect.element(table()).toBeVisible();
      await textField('ハンドル').fill('maker');
      const scrolled = scrollPageDown();
      expect(scrolled).toBeGreaterThan(0);
      const rendered = nextRendered(router);

      (button().element() as HTMLElement).click();

      await rendered;
      expect(router.state.location.search).toEqual(search);
      expect(window.scrollY).toBe(scrolled);
    },
  );

  test('ハンドル・ニックネームが前後の空白を除いて100文字を超えると、適用を止めて欄の下に理由を示し、最初の超過の欄へフォーカスを戻す', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();
    const requests = usersVariablesOf(executeGraphQL).length;

    await textField('ハンドル').fill(` ${'a'.repeat(100)} `);
    await textField('ニックネーム').fill('あ'.repeat(101));
    await applyButton().click();

    await expect.element(textField('ニックネーム')).toHaveFocus();
    await expect
      .element(textField('ニックネーム'))
      .toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(textField('ニックネーム'))
      .toHaveAccessibleDescription(TERM_TOO_LONG_MESSAGE);
    expect(textField('ハンドル').element().hasAttribute('aria-invalid')).toBe(
      false,
    );
    expect(usersVariablesOf(executeGraphQL)).toHaveLength(requests);
    expect(router.state.location.search).toEqual({});

    await textField('ハンドル').fill('h'.repeat(101));
    await applyButton().click();

    await expect.element(textField('ハンドル')).toHaveFocus();
    await expect
      .element(textField('ハンドル'))
      .toHaveAccessibleDescription(TERM_TOO_LONG_MESSAGE);
    await expect
      .element(textField('ニックネーム'))
      .toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(textField('メールアドレス'))
      .toHaveAttribute('maxlength', '254');
  });

  test('検索語の上限の誤りは、次に成功した適用・解除・URLの条件の変化で消える', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();
    const showError = async () => {
      await textField('ハンドル').fill('h'.repeat(101));
      await applyButton().click();
      await expect
        .element(filterForm().getByText(TERM_TOO_LONG_MESSAGE))
        .toBeVisible();
    };

    await showError();
    await textField('ハンドル').fill('h'.repeat(100));
    await applyButton().click();
    await expect
      .poll(() => lastVariables()?.filter)
      .toStrictEqual({
        handle: 'h'.repeat(100),
      });
    expect(filterForm().getByText(TERM_TOO_LONG_MESSAGE).query()).toBeNull();
    expect(textField('ハンドル').element().hasAttribute('aria-invalid')).toBe(
      false,
    );

    await showError();
    await resetButton().click();
    await expect.poll((): unknown => router.state.location.search).toEqual({});
    expect(filterForm().getByText(TERM_TOO_LONG_MESSAGE).query()).toBeNull();

    await showError();
    await router.navigate({ to: USERS_PATH, search: { nickname: '太郎' } });
    await expect.element(textField('ニックネーム')).toHaveValue('太郎');
    expect(filterForm().getByText(TERM_TOO_LONG_MESSAGE).query()).toBeNull();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、検索語の上限の誤りを示した絞り込みがWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith();
      await expect.element(table()).toBeVisible();
      await textField('ハンドル').fill('h'.repeat(101));
      await applyButton().click();
      await expect
        .element(filterForm().getByText(TERM_TOO_LONG_MESSAGE))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('URLの不正な停止状態とページの位置は、未指定として1ページ目を求める', async () => {
    await renderWith({
      path: `${USERS_PATH}?status=withdrawn&after=${'c'.repeat(257)}`,
    });

    await expect.element(table()).toBeVisible();
    await expect.element(statusSelect()).toHaveTextContent('すべて');
    expect(usersVariablesOf(executeGraphQL)).toStrictEqual([
      { filter: {}, first: 50 },
    ]);
  });

  test('条件を変えて取り直す間は、前の一覧を操作できないまま表示し続け、絞り込みは操作できる', async () => {
    let release: (() => void) | undefined;
    await renderWith({
      users: ({ filter }) =>
        filter?.handle === undefined
          ? success(usersQueryOf(USER_NODES))
          : new Promise((resolve) => {
              release = () => {
                resolve({ ok: true, data: usersQueryOf([ACTIVE_USER_NODE]) });
              };
            }),
    });
    await expect.element(table()).toBeVisible();

    await textField('ハンドル').fill('maker');
    await userEvent.click(applyButton());

    await expect.poll(() => release).toBeDefined();
    await expect
      .element(rowOf(SUSPENDED_USER_NODE.nickname))
      .toBeInTheDocument();
    const busy = table().element().closest('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(table().element().closest('[inert]')).not.toBeNull();
    expect(filterForm().element().closest('[inert]')).toBeNull();

    release?.();

    await expect
      .element(rowOf(SUSPENDED_USER_NODE.nickname))
      .not.toBeInTheDocument();
    expect(table().element().closest('[aria-busy="true"]')).toBeNull();
    expect(table().element().closest('[inert]')).toBeNull();
  });
});

describe('ページ送り', () => {
  const pages: UsersHandler = ({ after }) =>
    success(
      after === 'cursor-2'
        ? usersQueryOf([SUSPENDED_USER_NODE])
        : usersQueryOf([ACTIVE_USER_NODE, PUBLIC_AVATAR_USER_NODE], 'cursor-2'),
    );

  test('「次へ」で続きのページを求めてURLにカーソルを残し、「前へ」で辿った前のページへ戻る', async () => {
    const router = await renderWith({ users: pages });
    await expect.element(table()).toBeVisible();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(nextButton());

    await expect.element(rowOf(SUSPENDED_USER_NODE.nickname)).toBeVisible();
    await expect
      .element(rowOf(ACTIVE_USER_NODE.nickname))
      .not.toBeInTheDocument();
    expect(lastVariables()).toStrictEqual({
      filter: {},
      first: 50,
      after: 'cursor-2',
    });
    expect(router.state.location.search).toEqual({ after: 'cursor-2' });

    await userEvent.click(previousButton());

    await expect.element(rowOf(ACTIVE_USER_NODE.nickname)).toBeVisible();
    expect(router.state.location.search).toEqual({});
  });

  // 一覧の先頭へのスクロールの回数。他の部品が呼ぶスクロールを数えない
  const listScrollsOf = (
    scrollIntoView: { readonly mock: { readonly calls: unknown[][] } },
    behavior: ScrollBehavior,
  ) =>
    scrollIntoView.mock.calls.filter(
      ([options]) =>
        JSON.stringify(options) ===
        JSON.stringify({ block: 'start', behavior }),
    ).length;

  // 最初の表示の後の取得だけを止め、移動の間に押したボタンが操作できない状態になる時間を作る
  const heldPages = () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const users: UsersHandler = (variables) => {
      calls += 1;
      const response = pages(variables);
      return calls === 1
        ? response
        : new Promise((resolve) => {
            release = () => {
              resolve(response);
            };
          });
    };
    return { users, release: () => release?.(), held: () => release };
  };

  test.each([
    {
      name: '次へ',
      path: USERS_PATH,
      button: nextButton,
      arrived: SUSPENDED_USER_NODE,
    },
    {
      name: '前へ',
      path: `${USERS_PATH}?after=cursor-2`,
      button: previousButton,
      arrived: ACTIVE_USER_NODE,
    },
  ])(
    'キーボードで「$name」を押すと、取り直す間も結果が届いた後も一覧の見出しにフォーカスを置き、押した時と描画の後に一覧の先頭へスクロールする',
    async ({ path, button, arrived }) => {
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
      const pending = heldPages();
      await renderWith({ users: pending.users, path });
      await expect.element(table()).toBeVisible();

      button().element().focus();
      await userEvent.keyboard('{Enter}');

      await expect.poll(pending.held).toBeDefined();
      expect(document.activeElement).toBe(listHeading().element());
      expect(table().element().closest('[inert]')).not.toBeNull();
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'start',
        behavior: 'smooth',
      });

      pending.release();

      await expect.element(rowOf(arrived.nickname)).toBeVisible();
      expect(document.activeElement).toBe(listHeading().element());
      // 押した時の1回に加え、ルーターが描画の後にスクロールを先頭へ戻すため、描画の後にもう一度一覧の先頭へ移る
      await expect.poll(() => listScrollsOf(scrollIntoView, 'smooth')).toBe(2);
    },
  );

  test('視差効果を減らす設定では、一覧の先頭へ即座にスクロールする', async () => {
    await emulateReducedMotion('reduce');
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await renderWith({ users: pages });
    await expect.element(table()).toBeVisible();

    await userEvent.click(nextButton());

    await expect.element(rowOf(SUSPENDED_USER_NODE.nickname)).toBeVisible();
    await expect.poll(() => listScrollsOf(scrollIntoView, 'auto')).toBe(2);
    expect(listScrollsOf(scrollIntoView, 'smooth')).toBe(0);
    await emulateReducedMotion('no-preference');
  });

  test('移る先の無い「前へ」は押してもフォーカスとスクロールを動かさない', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await renderWith({ users: pages });
    await expect.element(table()).toBeVisible();

    previousButton().element().focus();
    await userEvent.keyboard('{Enter}');

    expect(document.activeElement).toBe(previousButton().element());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
