import { type ReactNode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { DropdownMenuItem } from '../../../lib/components/ui/dropdown-menu/dropdown-menu-item.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import type {
  ClientViewerQuery,
  LaunchCommentFragment,
} from '../../graphql/generated/graphql.ts';
import {
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { productRatingQueryOptions } from '../../graphql/engagement.ts';
import type { CommentAction } from './comment-action-types.ts';
import type { CommentSubmission } from './comment-composer.tsx';
import {
  CommentItem,
  type CommentItemMutations,
  type CommentItemProps,
} from './comment-item.tsx';
import type { CommentTreeNode } from './comment-tree.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const VIEWER_ID = '01JC0VIEWER0000000000000000';

const PRODUCT = Object.freeze({
  id: '01JC0PRODUCT00000000000000',
  handle: 'pitch_notes',
});

const LAUNCH = Object.freeze({ id: '01JC0LAUNCH000000000000000' });

const OUTSIDE = 'コメントの外';

const UNVERIFIED_REASON =
  'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。';

const NOW = Date.now();

// アプリの文書の外枠と同じく、日時の部品に表示設定を、投稿日時と「返信」のツールチップに共通の設定を渡す
const withShell = (children: ReactNode) => (
  <DisplayPreferencesProvider
    initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
  >
    <TooltipProvider>{children}</TooltipProvider>
  </DisplayPreferencesProvider>
);

const commentOf = (
  overrides: Partial<LaunchCommentFragment> = {},
): LaunchCommentFragment => ({
  id: '01JC0COMMENTA000000000000A',
  parentId: null,
  depth: 1,
  state: 'SHOWN',
  body: 'よいプロダクトです',
  createdAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
  edited: false,
  byProductOwner: false,
  viewerIsAuthor: false,
  author: { handle: 'early_fan', nickname: '早起きのファン', avatar: null },
  ...overrides,
});

const removedOf = (comment: LaunchCommentFragment): LaunchCommentFragment => ({
  ...comment,
  state: 'REMOVED',
  author: null,
  body: null,
  createdAt: null,
  edited: false,
  byProductOwner: false,
  viewerIsAuthor: false,
});

const nodeOf = (
  comment: LaunchCommentFragment,
  replies: readonly CommentTreeNode[] = [],
): CommentTreeNode => ({ comment, replies });

const REPLY_DEPTH2 = commentOf({
  id: '01JC0COMMENTB000000000000B',
  parentId: '01JC0COMMENTA000000000000A',
  depth: 2,
  body: '返信の本文',
  author: { handle: 'second_fan', nickname: '二番目のファン', avatar: null },
});

const REPLY_DEPTH3 = commentOf({
  id: '01JC0COMMENTC000000000000C',
  parentId: '01JC0COMMENTB000000000000B',
  depth: 3,
  body: '第3階層の本文',
  author: { handle: 'third_fan', nickname: '三番目のファン', avatar: null },
});

const THREAD = nodeOf(commentOf(), [
  nodeOf(REPLY_DEPTH2, [nodeOf(REPLY_DEPTH3)]),
]);

type MutationMocks = {
  readonly [K in keyof CommentItemMutations]: ReturnType<
    typeof vi.fn<CommentItemMutations[K]>
  >;
};

const createMutations = (): MutationMocks => ({
  reply: vi.fn<CommentItemMutations['reply']>(() => Promise.resolve()),
  update: vi.fn<CommentItemMutations['update']>(() => Promise.resolve()),
  remove: vi.fn<CommentItemMutations['remove']>(() => Promise.resolve()),
});

interface RenderOptions {
  readonly node?: CommentTreeNode;
  readonly viewer?: ClientViewerQuery;
  readonly viewerIsOwner?: boolean;
  readonly mutations?: MutationMocks | null;
  readonly actions?: readonly CommentAction[];
  readonly extra?: ReactNode;
}

const renderItem = async ({
  node = THREAD,
  viewer = signedInViewerQuery(),
  viewerIsOwner = false,
  mutations = createMutations(),
  actions = [],
  extra = null,
}: RenderOptions = {}): Promise<MutationMocks | null> => {
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(
    productRatingQueryOptions(VIEWER_ID, PRODUCT.id).queryKey,
    {
      productRating: {
        productId: PRODUCT.id,
        average: 4,
        count: 3,
        viewerScore: null,
      },
    },
  );
  const props: CommentItemProps = {
    node,
    product: PRODUCT,
    launch: LAUNCH,
    viewerIsOwner,
    mutations,
    actions,
  };
  await renderInRouter(
    withShell(
      <main className="flex flex-col gap-4 bg-background p-4 text-foreground">
        <p>{OUTSIDE}</p>
        <ol className="space-y-6">
          <CommentItem {...props} />
          {extra}
        </ol>
      </main>,
    ),
    { context, cachedViewer: viewer },
  );
  await userEvent.hover(page.getByText(OUTSIDE));
  return mutations;
};

const articleOf = (nickname: string) =>
  page.getByRole('article', { name: `${nickname}さんのコメント` });

const replyButtonOf = (nickname: string) =>
  articleOf(nickname).getByRole('button', { name: '返信', exact: true });

const menuTriggerOf = (nickname: string) =>
  articleOf(nickname).getByRole('button', { name: 'コメントの操作' });

const editorOf = (name: string) => page.getByRole('textbox', { name });

async function typeInto(name: string, text: string): Promise<void> {
  await expect.element(editorOf(name)).toBeInTheDocument();
  await expect
    .element(page.getByRole('button', { name: '太字', exact: true }))
    .not.toHaveAttribute('disabled');
  await userEvent.click(editorOf(name));
  await userEvent.keyboard(text);
}

const passBotCheck = () =>
  userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));

// モーダルのダイアログの間は外側の要素が支援技術とポインターから隠れるため、ダイアログの外に描く判定の偽物のボタンは要素を直接押す
const passBotCheckBehindDialog = () => {
  const button = page.getByText('判定を成功させる').element();
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('判定の偽物のボタンがありません。');
  }
  button.click();
};

const reportActionOf = (label: string): CommentAction => ({
  id: 'content-reporting.comment-report',
  order: 10,
  Item: ({ onSelect }) => (
    <DropdownMenuItem onSelect={onSelect}>{label}</DropdownMenuItem>
  ),
  Dialog: () => null,
});

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('CommentItem', () => {
  test('プロフィール画像・公開プロフィールへのリンクのニックネーム・投稿日時・本文を表示する', async () => {
    await renderItem({ node: nodeOf(commentOf()) });

    const article = articleOf('早起きのファン');
    await expect.element(article).toBeVisible();
    await expect
      .element(article.getByRole('link', { name: '早起きのファン' }))
      .toHaveAttribute('href', '/@early_fan');
    await expect
      .element(article.getByText('早', { exact: true }))
      .toBeInTheDocument();
    await expect.element(article.getByText('3時間前')).toBeVisible();
    await expect.element(article.getByText('よいプロダクトです')).toBeVisible();
    expect(article.getByText('(編集済み)').query()).toBeNull();
    expect(article.getByText('投稿者', { exact: true }).query()).toBeNull();
    expect(article.getByText('あなた', { exact: true }).query()).toBeNull();
  });

  test.each<[string, LaunchCommentFragment, string, string]>([
    [
      '表示中のコメントのプロフィール画像',
      commentOf(),
      '早起きのファンさんのコメント',
      ':scope > [aria-hidden="true"] > *',
    ],
    [
      '置き換え表示のコメントの印',
      removedOf(commentOf()),
      '削除されたコメント',
      ':scope > [aria-hidden="true"]',
    ],
  ])('%sを32pxの正方形で描く', async (_, comment, articleName, selector) => {
    await renderItem({ node: nodeOf(comment) });

    const article = page.getByRole('article', { name: articleName });
    await expect.element(article).toBeVisible();
    const box = article
      .element()
      .querySelector(selector)
      ?.getBoundingClientRect();
    expect([box?.width, box?.height]).toStrictEqual([32, 32]);
  });

  test('編集済みのコメントに「(編集済み)」を表示する', async () => {
    await renderItem({ node: nodeOf(commentOf({ edited: true })) });

    await expect
      .element(articleOf('早起きのファン').getByText('(編集済み)'))
      .toBeVisible();
  });

  test('プロダクトの投稿者本人のコメントに「投稿者」のバッジを付ける', async () => {
    await renderItem({ node: nodeOf(commentOf({ byProductOwner: true })) });

    await expect
      .element(articleOf('早起きのファン').getByText('投稿者', { exact: true }))
      .toBeVisible();
  });

  test('閲覧者自身のコメントに「あなた」のバッジを付ける', async () => {
    await renderItem({ node: nodeOf(commentOf({ viewerIsAuthor: true })) });

    await expect
      .element(articleOf('早起きのファン').getByText('あなた', { exact: true }))
      .toBeVisible();
  });

  test('投稿者本人が自分で見るコメントは「投稿者」だけを付け「あなた」を付けない', async () => {
    await renderItem({
      node: nodeOf(commentOf({ byProductOwner: true, viewerIsAuthor: true })),
      viewerIsOwner: true,
    });

    const article = articleOf('早起きのファン');
    await expect
      .element(article.getByText('投稿者', { exact: true }))
      .toBeVisible();
    expect(article.getByText('あなた', { exact: true }).query()).toBeNull();
  });

  test('本文をマークダウンとして描き、別オリジンのリンクはrelにnoopenerとugcを付けて別タブで開く', async () => {
    await renderItem({
      node: nodeOf(
        commentOf({
          body: '**太字**と[外部](https://other.example/page)と[内部](https://client.example/p/pitch_notes)',
        }),
      ),
    });

    const article = articleOf('早起きのファン');
    await expect
      .element(article.getByText('太字', { exact: true }))
      .toHaveProperty('tagName', 'STRONG');
    const external = article.getByRole('link', { name: '外部' });
    await expect.element(external).toHaveAttribute('rel', 'noopener ugc');
    await expect.element(external).toHaveAttribute('target', '_blank');
    const internal = article.getByRole('link', { name: '内部' });
    await expect.element(internal).not.toHaveAttribute('target');
    await expect.element(internal).not.toHaveAttribute('rel');
  });

  test('同じ見出しを持つ別々のコメントの見出しのアンカーが衝突しない', async () => {
    const other = commentOf({
      id: '01JC0COMMENTD000000000000D',
      body: '## 同じ見出し',
      author: { handle: 'other_fan', nickname: '別のファン', avatar: null },
    });
    await renderItem({
      node: nodeOf(commentOf({ body: '## 同じ見出し' })),
      extra: (
        <CommentItem
          node={nodeOf(other)}
          product={PRODUCT}
          launch={LAUNCH}
          viewerIsOwner={false}
          mutations={null}
          actions={[]}
        />
      ),
    });

    const first = articleOf('早起きのファン')
      .getByRole('heading', { name: '同じ見出し' })
      .element().id;
    const second = articleOf('別のファン')
      .getByRole('heading', { name: '同じ見出し' })
      .element().id;
    expect(first).toContain('c01jc0commenta000000000000a');
    expect(second).toContain('c01jc0commentd000000000000d');
    expect(document.querySelectorAll(`[id="${first}"]`)).toHaveLength(1);
  });

  test.each<[string, LaunchCommentFragment]>([
    ['置き換え表示のコメント', removedOf(commentOf())],
    [
      '作者が取れない表示中のコメント',
      commentOf({ author: null, byProductOwner: true, edited: true }),
    ],
  ])(
    '%sは本文・作者・日時・印・操作を出さず、置き換えの文言と返信を表示する',
    async (_, comment) => {
      await renderItem({
        node: nodeOf(comment, [nodeOf(REPLY_DEPTH2)]),
        actions: [reportActionOf('通報')],
      });

      const removed = page.getByRole('article', { name: '削除されたコメント' });
      await expect.element(removed).toBeVisible();
      await expect
        .element(removed.getByText('このコメントは削除されました。'))
        .toBeVisible();
      expect(removed.getByRole('link').query()).toBeNull();
      expect(removed.getByRole('button').query()).toBeNull();
      expect(removed.getByRole('time').query()).toBeNull();
      expect(removed.getByText('よいプロダクトです').query()).toBeNull();
      expect(removed.getByText('早起きのファン').query()).toBeNull();
      expect(removed.getByText('(編集済み)').query()).toBeNull();
      expect(removed.getByText('投稿者', { exact: true }).query()).toBeNull();
      await expect.element(articleOf('二番目のファン')).toBeVisible();
      await expect
        .element(articleOf('二番目のファン').getByText('返信の本文'))
        .toBeVisible();
    },
  );

  test('返信は親の項目の中の「返信」という名前の一覧に入れ子で並ぶ', async () => {
    await renderItem();

    const topReplies = page.getByRole('list', { name: '返信' }).first();
    await expect.element(topReplies).toBeVisible();
    const topItem = articleOf('早起きのファン').element().closest('li');
    const replyList = articleOf('二番目のファン').element().closest('ol');
    expect(replyList?.getAttribute('aria-label')).toBe('返信');
    expect(replyList?.parentElement).toBe(topItem);
    const deepList = articleOf('三番目のファン').element().closest('ol');
    expect(deepList?.getAttribute('aria-label')).toBe('返信');
    expect(deepList?.closest('li')).toBe(
      articleOf('二番目のファン').element().closest('li'),
    );
    expect(getComputedStyle(replyList as HTMLElement).borderLeftWidth).not.toBe(
      '0px',
    );
  });

  test('第3階層のコメントに「返信」を置かず、それより浅いコメントに置く', async () => {
    await renderItem();

    await expect.element(replyButtonOf('早起きのファン')).toBeVisible();
    await expect.element(replyButtonOf('二番目のファン')).toBeVisible();
    await expect.element(articleOf('三番目のファン')).toBeVisible();
    expect(
      articleOf('三番目のファン')
        .getByRole('button', { name: '返信', exact: true })
        .query(),
    ).toBeNull();
  });

  test('未ログインの閲覧者が「返信」を押すとログインの案内のダイアログを開き、閉じると「返信」へ戻る', async () => {
    await renderItem({
      node: nodeOf(commentOf()),
      viewer: GUEST_VIEWER_QUERY,
      mutations: null,
    });

    await userEvent.click(replyButtonOf('早起きのファン'));

    const dialog = page.getByRole('dialog', {
      name: 'コメントにはログインが必要です',
    });
    await expect.element(dialog).toBeVisible();
    await expect
      .element(
        dialog.getByText(
          'ログインすると、ローンチごとにコメントや返信を投稿できます。',
        ),
      )
      .toBeVisible();
    await expect
      .element(dialog.getByRole('link', { name: 'ログイン' }))
      .toHaveAttribute('href', '/auth/login?redirect=%2F');
    expect(page.getByRole('textbox').query()).toBeNull();

    await userEvent.keyboard('{Escape}');

    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(replyButtonOf('早起きのファン')).toHaveFocus();
  });

  test('メールアドレス未確認の閲覧者の「返信」は無効で、理由を説明とツールチップで示す', async () => {
    await renderItem({
      node: nodeOf(commentOf()),
      viewer: signedInViewerQuery({ emailVerified: false }),
    });

    const reply = replyButtonOf('早起きのファン');
    await expect.element(reply).toHaveAttribute('aria-disabled', 'true');
    await expect.element(reply).toHaveAccessibleDescription(UNVERIFIED_REASON);

    await userEvent.hover(
      page.elementLocator(reply.element().parentElement as HTMLElement),
    );
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent(UNVERIFIED_REASON);

    await userEvent.click(reply, { force: true });
    expect(page.getByRole('textbox').query()).toBeNull();
  });

  test('メールアドレス未確認の閲覧者の「返信」はキーボードでフォーカスすると理由のツールチップを開き、EnterとSpaceでも投稿欄を開かない', async () => {
    await renderItem({
      node: nodeOf(commentOf()),
      viewer: signedInViewerQuery({ emailVerified: false }),
    });
    const reply = replyButtonOf('早起きのファン');
    await expect.element(reply).toHaveAttribute('aria-disabled', 'true');

    (reply.element() as HTMLElement).focus();

    await expect.element(reply).toHaveFocus();
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent(UNVERIFIED_REASON);

    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    await expect.element(reply).toHaveFocus();
    expect(page.getByRole('textbox').query()).toBeNull();
    expect(page.getByRole('button', { name: '返信する' }).query()).toBeNull();
  });

  test('「返信」はその場に返信の投稿欄を開いてフォーカスを移し、「キャンセル」で閉じて「返信」へ戻る', async () => {
    await renderItem({ node: nodeOf(commentOf()) });

    await userEvent.click(replyButtonOf('早起きのファン'));

    await expect.element(editorOf('返信を書く')).toHaveFocus();
    await expect
      .element(page.getByRole('button', { name: '返信する', exact: true }))
      .toBeVisible();

    await userEvent.click(page.getByRole('button', { name: 'キャンセル' }));

    await expect.element(editorOf('返信を書く')).not.toBeInTheDocument();
    await expect.element(replyButtonOf('早起きのファン')).toHaveFocus();
  });

  test('返信の投稿欄の送信で受け取った返信の操作を親のIDで呼び、成功で閉じて「返信」へ戻る', async () => {
    const mutations = await renderItem({ node: nodeOf(commentOf()) });

    await userEvent.click(replyButtonOf('早起きのファン'));
    await typeInto('返信を書く', 'ありがとうございます');
    await passBotCheck();
    await userEvent.click(
      page.getByRole('button', { name: '返信する', exact: true }),
    );

    await expect.poll(() => mutations?.reply.mock.calls.length).toBe(1);
    expect(mutations?.reply.mock.calls[0]).toStrictEqual([
      '01JC0COMMENTA000000000000A',
      {
        body: 'ありがとうございます',
        turnstileToken: 'turnstile-token-1',
      } satisfies CommentSubmission,
    ]);
    await expect.element(editorOf('返信を書く')).not.toBeInTheDocument();
    await expect.element(replyButtonOf('早起きのファン')).toHaveFocus();
  });

  test('返信の失敗では投稿欄を開いたまま入力を保つ', async () => {
    const mutations = createMutations();
    mutations.reply.mockRejectedValue(new Error('失敗'));
    await renderItem({ node: nodeOf(commentOf()), mutations });

    await userEvent.click(replyButtonOf('早起きのファン'));
    await typeInto('返信を書く', '届かない返信');
    await passBotCheck();
    await userEvent.click(
      page.getByRole('button', { name: '返信する', exact: true }),
    );

    await expect.element(page.getByRole('alert')).toBeVisible();
    await expect
      .element(editorOf('返信を書く'))
      .toHaveTextContent('届かない返信');
  });

  test('自身のコメントの「編集」は本文を入れた編集欄を開き、送信で編集の操作を呼んで閉じる', async () => {
    const mutations = await renderItem({
      node: nodeOf(commentOf({ viewerIsAuthor: true, body: '前の本文' })),
    });

    await userEvent.click(menuTriggerOf('早起きのファン'));
    await userEvent.click(page.getByRole('menuitem', { name: '編集' }));

    await expect.element(editorOf('コメントを編集')).toHaveFocus();
    await expect
      .element(editorOf('コメントを編集'))
      .toHaveTextContent('前の本文');
    expect(
      articleOf('早起きのファン').getByText('前の本文').elements(),
    ).toHaveLength(1);

    await typeInto('コメントを編集', 'と追記');
    await passBotCheck();
    await userEvent.click(
      page.getByRole('button', { name: '保存する', exact: true }),
    );

    await expect.poll(() => mutations?.update.mock.calls.length).toBe(1);
    expect(mutations?.update.mock.calls[0]?.[0]).toBe(
      '01JC0COMMENTA000000000000A',
    );
    expect(mutations?.update.mock.calls[0]?.[1].body).toContain('と追記');
    await expect.element(editorOf('コメントを編集')).not.toBeInTheDocument();
    await expect.element(articleOf('早起きのファン')).toHaveFocus();
  });

  test('編集欄の「キャンセル」で閉じて本文の表示に戻る', async () => {
    await renderItem({
      node: nodeOf(commentOf({ viewerIsAuthor: true, body: '前の本文' })),
    });

    await userEvent.click(menuTriggerOf('早起きのファン'));
    await userEvent.click(page.getByRole('menuitem', { name: '編集' }));
    await expect.element(editorOf('コメントを編集')).toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'キャンセル' }));

    await expect.element(editorOf('コメントを編集')).not.toBeInTheDocument();
    await expect
      .element(articleOf('早起きのファン').getByText('前の本文'))
      .toBeVisible();
    await expect.element(articleOf('早起きのファン')).toHaveFocus();
  });

  test('削除の確認で「削除」を確定すると削除の操作を呼び、置き換え表示の項目へフォーカスを移す', async () => {
    const own = commentOf({ viewerIsAuthor: true });
    const remove = vi.fn<CommentItemMutations['remove']>();
    function Harness() {
      const [comment, setComment] = useState(own);
      return (
        <CommentItem
          node={nodeOf(comment)}
          product={PRODUCT}
          launch={LAUNCH}
          viewerIsOwner={false}
          mutations={{
            reply: () => Promise.resolve(),
            update: () => Promise.resolve(),
            remove: async (commentId, turnstileToken) => {
              await remove(commentId, turnstileToken);
              setComment(removedOf(comment));
            },
          }}
          actions={[]}
        />
      );
    }
    const context = createPageRouterContext('local');
    await renderInRouter(
      withShell(
        <main className="bg-background p-4 text-foreground">
          <p>{OUTSIDE}</p>
          <ol>
            <Harness />
          </ol>
        </main>,
      ),
      { context, cachedViewer: signedInViewerQuery() },
    );

    await userEvent.click(menuTriggerOf('早起きのファン'));
    await userEvent.click(page.getByRole('menuitem', { name: '削除' }));
    const dialog = page.getByRole('dialog', {
      name: 'コメントを削除しますか?',
    });
    await expect.element(dialog).toBeVisible();
    expect(remove).not.toHaveBeenCalled();
    passBotCheckBehindDialog();
    await userEvent.click(dialog.getByRole('button', { name: '削除' }));

    await expect.poll(() => remove.mock.calls.length).toBe(1);
    expect(remove.mock.calls[0]).toStrictEqual([
      '01JC0COMMENTA000000000000A',
      'turnstile-token-1',
    ]);
    const removed = page.getByRole('article', { name: '削除されたコメント' });
    await expect.element(removed).toBeVisible();
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(removed).toHaveFocus();
  });

  test('他者の表示中のコメントには登録された操作の「…」メニューを置き、登録が無ければ置かない', async () => {
    await renderItem({
      node: nodeOf(commentOf()),
      actions: [reportActionOf('通報')],
    });

    await userEvent.click(menuTriggerOf('早起きのファン'));

    await expect
      .element(page.getByRole('menuitem', { name: '通報' }))
      .toBeVisible();
  });

  test('他者のコメントに登録された操作が無ければ「…」メニューを置かない', async () => {
    await renderItem({ node: nodeOf(commentOf()) });

    await expect.element(replyButtonOf('早起きのファン')).toBeVisible();
    expect(
      articleOf('早起きのファン')
        .getByRole('button', { name: 'コメントの操作' })
        .query(),
    ).toBeNull();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('バッジ・置き換え表示・入れ子の返信を含むスレッドのアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderItem({
      node: nodeOf(commentOf({ byProductOwner: true, edited: true }), [
        nodeOf(removedOf(REPLY_DEPTH2), [
          nodeOf({ ...REPLY_DEPTH3, viewerIsAuthor: true }),
        ]),
      ]),
    });
    await expect.element(articleOf('早起きのファン')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('メールアドレス未確認の閲覧者の無効の「返信」のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderItem({
      node: nodeOf(commentOf()),
      viewer: signedInViewerQuery({ emailVerified: false }),
    });
    await expect.element(replyButtonOf('早起きのファン')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('返信の投稿欄を開いた項目のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderItem({ node: nodeOf(commentOf()) });
    await userEvent.click(replyButtonOf('早起きのファン'));
    await expect.element(editorOf('返信を書く')).toBeInTheDocument();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
