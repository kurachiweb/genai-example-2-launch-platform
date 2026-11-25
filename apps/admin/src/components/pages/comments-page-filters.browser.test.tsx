import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { emulateReducedMotion } from '../../../lib/test/reduced-motion.ts';
import { success } from '../../../test/admin-accounts-fixtures.ts';
import {
  COMMENT_NODES,
  COMMENTS_PATH,
  type CommentsHandler,
  commentsQueryOf,
  commentsVariablesOf,
  DELETED_COMMENT_NODE,
  HIDDEN_COMMENT_NODE,
  SHOWN_COMMENT_NODE,
} from '../../../test/moderation-comments-fixtures.tsx';
import {
  applyButton,
  chooseState,
  commentsPageHarness,
  dateField,
  filterForm,
  listHeading,
  listScrollsOf,
  nextButton,
  previousButton,
  resetButton,
  rowOf,
  stateSelect,
  table,
  textField,
} from '../../../test/moderation-comments-page.ts';
import { MODERATION_DISPLAY } from '../../../test/moderation-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const { renderWith, lastVariables } = commentsPageHarness(executeGraphQL);

const TOO_LONG_MESSAGE = '検索語は100文字以内で入力してください。';

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  vi.restoreAllMocks();
  toast.dismiss();
  await emulateReducedMotion('no-preference');
  await emulateBrowserDisplay(null);
});

describe('絞り込み', () => {
  test('投稿者・プロダクトのハンドル、投稿日の期間、状態を組み合わせて求め直し、期間を閲覧者の地域の暦の日の境界にし、条件をURLに残してページの位置を捨てる', async () => {
    const router = await renderWith({
      path: `${COMMENTS_PATH}?after=cursor-2`,
    });
    await expect.element(table()).toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: {},
      first: 50,
      after: 'cursor-2',
    });

    await textField('投稿者のハンドル').fill(' maker ');
    await textField('プロダクトのハンドル').fill('pitch');
    await dateField('投稿日の開始日').fill('2026-11-01');
    await dateField('投稿日の終了日').fill('2026-11-03');
    await chooseState('管理者が非公開化');
    await userEvent.click(applyButton());

    await expect.poll(lastVariables).toStrictEqual({
      filter: {
        authorHandle: 'maker',
        productHandle: 'pitch',
        postedFrom: '2026-10-31T15:00:00.000Z',
        postedBefore: '2026-11-03T15:00:00.000Z',
        state: 'HIDDEN',
      },
      first: 50,
    });
    expect(router.state.location.search).toEqual({
      authorHandle: 'maker',
      productHandle: 'pitch',
      from: '2026-11-01',
      to: '2026-11-03',
      state: 'hidden',
    });
    await expect.element(applyButton()).toHaveFocus();
  });

  test('状態の選択肢は、すべての状態と5つの状態を示す', async () => {
    await renderWith();
    await userEvent.click(stateSelect());

    expect(
      page
        .getByRole('option')
        .elements()
        .map((option) => option.textContent),
    ).toStrictEqual([
      'すべての状態',
      '表示中',
      '管理者が非公開化',
      '投稿者が削除',
      '匿名化済み',
      '投稿者が退会・停止中',
    ]);
  });

  test('URLの条件を入力欄と選択欄に示して求め、「解除」で条件を全て外して1ページ目を求め直す', async () => {
    const router = await renderWith({
      path: `${COMMENTS_PATH}?authorHandle=maker&productHandle=pitch&from=2026-11-01&to=2026-11-03&state=deleted&after=cursor-2`,
    });
    await expect.element(textField('投稿者のハンドル')).toHaveValue('maker');
    await expect
      .element(textField('プロダクトのハンドル'))
      .toHaveValue('pitch');
    await expect.element(dateField('投稿日の開始日')).toHaveValue('2026-11-01');
    await expect.element(dateField('投稿日の終了日')).toHaveValue('2026-11-03');
    await expect.element(stateSelect()).toHaveTextContent('投稿者が削除');
    expect(lastVariables()).toStrictEqual({
      filter: {
        authorHandle: 'maker',
        productHandle: 'pitch',
        postedFrom: '2026-10-31T15:00:00.000Z',
        postedBefore: '2026-11-03T15:00:00.000Z',
        state: 'DELETED',
      },
      first: 50,
      after: 'cursor-2',
    });

    await userEvent.click(resetButton());

    await expect.poll(lastVariables).toStrictEqual({ filter: {}, first: 50 });
    expect(router.state.location.search).toEqual({});
    await expect.element(textField('投稿者のハンドル')).toHaveValue('');
    await expect.element(dateField('投稿日の開始日')).toHaveValue('');
    await expect.element(stateSelect()).toHaveTextContent('すべての状態');
  });

  test('URLの不正な状態・日付・ページの位置と、開始日が終了日より後の期間は、未指定として1ページ目を求める', async () => {
    await renderWith({
      path: `${COMMENTS_PATH}?state=removed&from=2026-11-05&to=2026-11-01&after=${'c'.repeat(257)}`,
    });

    await expect.element(table()).toBeVisible();
    await expect.element(stateSelect()).toHaveTextContent('すべての状態');
    await expect.element(dateField('投稿日の開始日')).toHaveValue('');
    expect(commentsVariablesOf(executeGraphQL)).toStrictEqual([
      { filter: {}, first: 50 },
    ]);
  });

  test('終了日が開始日より前なら適用せず、終了日の欄に誤りを関連付けて示し、その欄へフォーカスを移す', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();

    await dateField('投稿日の開始日').fill('2026-11-05');
    await dateField('投稿日の終了日').fill('2026-11-01');
    await userEvent.click(applyButton());

    await expect.element(dateField('投稿日の終了日')).toHaveFocus();
    await expect
      .element(dateField('投稿日の終了日'))
      .toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(dateField('投稿日の終了日'))
      .toHaveAccessibleDescription(
        '終了日には開始日と同じか後の日付を入力してください。',
      );
    expect(router.state.location.search).toEqual({});
    expect(commentsVariablesOf(executeGraphQL)).toHaveLength(1);
  });

  test('100文字を超える検索語は適用せず、最初の超過の欄に誤りを関連付けて示してフォーカスを移し、直すと適用できる', async () => {
    const router = await renderWith();
    await expect.element(table()).toBeVisible();

    await textField('投稿者のハンドル').fill('a'.repeat(100));
    await textField('プロダクトのハンドル').fill('b'.repeat(101));
    await userEvent.click(applyButton());

    await expect.element(textField('プロダクトのハンドル')).toHaveFocus();
    await expect
      .element(textField('プロダクトのハンドル'))
      .toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(textField('プロダクトのハンドル'))
      .toHaveAccessibleDescription(TOO_LONG_MESSAGE);
    await expect
      .element(textField('投稿者のハンドル'))
      .not.toHaveAttribute('aria-invalid');
    expect(router.state.location.search).toEqual({});
    expect(commentsVariablesOf(executeGraphQL)).toHaveLength(1);

    await textField('プロダクトのハンドル').fill(` ${'b'.repeat(100)} `);
    await userEvent.click(applyButton());

    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({
        authorHandle: 'a'.repeat(100),
        productHandle: 'b'.repeat(100),
      });
    await expect
      .element(textField('プロダクトのハンドル'))
      .not.toHaveAttribute('aria-invalid');
  });

  test('条件を変えて取り直す間は、前の一覧を操作できないまま表示し続け、絞り込みは操作でき、一覧の先頭へスクロールせずフォーカスを「適用」に残す', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    let release: (() => void) | undefined;
    await renderWith({
      comments: ({ filter }) =>
        filter?.authorHandle === undefined
          ? success(commentsQueryOf(COMMENT_NODES))
          : new Promise((resolve) => {
              release = () => {
                resolve({
                  ok: true,
                  data: commentsQueryOf([SHOWN_COMMENT_NODE]),
                });
              };
            }),
    });
    await expect.element(table()).toBeVisible();

    await textField('投稿者のハンドル').fill('maker');
    await userEvent.click(applyButton());

    await expect.poll(() => release).toBeDefined();
    await expect.element(rowOf('サンプル花子')).toBeInTheDocument();
    expect(table().element().closest('[aria-busy="true"]')).not.toBeNull();
    expect(table().element().closest('[inert]')).not.toBeNull();
    expect(filterForm().element().closest('[inert]')).toBeNull();

    release?.();

    await expect.element(rowOf('サンプル花子')).not.toBeInTheDocument();
    expect(table().element().closest('[aria-busy="true"]')).toBeNull();
    expect(table().element().closest('[inert]')).toBeNull();
    await expect.element(applyButton()).toHaveFocus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  test('「解除」で条件を外した時も、一覧の先頭へスクロールせずフォーカスを「解除」に残す', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const router = await renderWith({
      path: `${COMMENTS_PATH}?state=hidden&after=cursor-2`,
    });
    await expect.element(table()).toBeVisible();

    await userEvent.click(resetButton());

    await expect.poll(lastVariables).toStrictEqual({ filter: {}, first: 50 });
    expect(router.state.location.search).toEqual({});
    await expect.element(resetButton()).toHaveFocus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('ページ送り', () => {
  const pages: CommentsHandler = ({ after }) =>
    success(
      after === 'cursor-2'
        ? commentsQueryOf([DELETED_COMMENT_NODE])
        : commentsQueryOf(
            [SHOWN_COMMENT_NODE, HIDDEN_COMMENT_NODE],
            'cursor-2',
          ),
    );

  // 最初の表示の後の取得だけを止め、移動の間に押したボタンが操作できない状態になる時間を作る
  const heldPages = () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const comments: CommentsHandler = (variables) => {
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
    return { comments, release: () => release?.(), held: () => release };
  };

  test('「次へ」で条件を保って続きのページを求めてURLにカーソルを残し、「前へ」で辿った前のページへ戻る', async () => {
    const router = await renderWith({
      comments: pages,
      path: `${COMMENTS_PATH}?state=shown`,
    });
    await expect.element(table()).toBeVisible();
    await expect
      .element(previousButton())
      .toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(nextButton());

    await expect.element(rowOf(DELETED_COMMENT_NODE.excerpt)).toBeVisible();
    expect(lastVariables()).toStrictEqual({
      filter: { state: 'SHOWN' },
      first: 50,
      after: 'cursor-2',
    });
    expect(router.state.location.search).toEqual({
      state: 'shown',
      after: 'cursor-2',
    });

    await userEvent.click(previousButton());

    await expect.element(rowOf('サンプル太郎')).toBeVisible();
    expect(router.state.location.search).toEqual({ state: 'shown' });
  });

  test.each([
    {
      name: '次へ',
      path: COMMENTS_PATH,
      button: nextButton,
      arrived: DELETED_COMMENT_NODE.excerpt,
    },
    {
      name: '前へ',
      path: `${COMMENTS_PATH}?after=cursor-2`,
      button: previousButton,
      arrived: 'サンプル太郎',
    },
  ])(
    'キーボードで「$name」を押すと、取り直す間も結果が届いた後も一覧の見出しにフォーカスを置き、一覧の先頭へ滑らかにスクロールする',
    async ({ path, button, arrived }) => {
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
      const pending = heldPages();
      await renderWith({ comments: pending.comments, path });
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

      await expect.element(rowOf(arrived)).toBeVisible();
      expect(document.activeElement).toBe(listHeading().element());
      expect(listScrollsOf(scrollIntoView, 'smooth')).toBeGreaterThan(0);
    },
  );

  test('視差効果を減らす設定では、一覧の先頭へ即座にスクロールする', async () => {
    await emulateReducedMotion('reduce');
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await renderWith({ comments: pages });
    await expect.element(table()).toBeVisible();

    nextButton().element().focus();
    await userEvent.keyboard('{Enter}');

    await expect.element(rowOf(DELETED_COMMENT_NODE.excerpt)).toBeVisible();
    expect(listScrollsOf(scrollIntoView, 'auto')).toBeGreaterThan(0);
    expect(listScrollsOf(scrollIntoView, 'smooth')).toBe(0);
    expect(document.activeElement).toBe(listHeading().element());
  });

  test('移る先の無い「前へ」は押してもフォーカスとスクロールを動かさない', async () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await renderWith({ comments: pages });
    await expect.element(table()).toBeVisible();

    previousButton().element().focus();
    await userEvent.keyboard('{Enter}');

    expect(document.activeElement).toBe(previousButton().element());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
