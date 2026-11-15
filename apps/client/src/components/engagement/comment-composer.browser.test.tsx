import type { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { BOT_CHECK_FAILED_MESSAGE } from '../../../lib/utilities/messages/bot-protection-messages.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { productRatingQueryOptions } from '../../graphql/engagement.ts';
import type { ClientProductRatingQuery } from '../../graphql/generated/graphql.ts';
import {
  CommentComposer,
  type CommentComposerTarget,
  type CommentSubmission,
} from './comment-composer.tsx';

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

const PRODUCT_ID = '01JC0PRODUCT00000000000000';

const OUTSIDE = '投稿欄の外';

const POST_PLACEHOLDER = 'このローンチへのコメントを書く(マークダウン対応)';

const REPLY_PLACEHOLDER = '返信を書く';

const EDIT_PLACEHOLDER = 'コメントを編集';

const RATING_INPUT_LABEL = 'このプロダクトの評価(任意)';

const POST: CommentComposerTarget = Object.freeze({ mode: 'post' });

const replyTarget = (
  onCancel: () => void = vi.fn(),
): CommentComposerTarget => ({
  mode: 'reply',
  onCancel,
});

const editTarget = (
  overrides: Partial<{ body: string; topLevel: boolean }> = {},
  onCancel: () => void = vi.fn(),
): CommentComposerTarget => ({
  mode: 'edit',
  body: '前の本文',
  topLevel: true,
  onCancel,
  ...overrides,
});

type SubmitMock = ReturnType<
  typeof vi.fn<(submission: CommentSubmission) => Promise<void>>
>;

interface RenderOptions {
  readonly target?: CommentComposerTarget;
  readonly viewerIsOwner?: boolean;
  readonly viewerScore?: number | null;
  readonly onSubmit?: SubmitMock;
}

const ratingQueryOf = (
  viewerScore: number | null,
): ClientProductRatingQuery => ({
  productRating: {
    productId: PRODUCT_ID,
    average: 4,
    count: 3,
    viewerScore,
  },
});

const ratingKey = () =>
  productRatingQueryOptions(VIEWER_ID, PRODUCT_ID).queryKey;

const renderComposer = async ({
  target = POST,
  viewerIsOwner = false,
  viewerScore = null,
  onSubmit = vi.fn(() => Promise.resolve()),
}: RenderOptions = {}): Promise<{
  readonly onSubmit: SubmitMock;
  readonly queryClient: QueryClient;
}> => {
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(ratingKey(), ratingQueryOf(viewerScore));
  await renderInRouter(
    <main className="flex flex-col gap-4 bg-background p-4 text-foreground">
      <p>{OUTSIDE}</p>
      <CommentComposer
        target={target}
        productId={PRODUCT_ID}
        viewerIsOwner={viewerIsOwner}
        onSubmit={onSubmit}
      />
    </main>,
    { context, cachedViewer: signedInViewerQuery() },
  );
  await userEvent.hover(page.getByText(OUTSIDE));
  return { onSubmit, queryClient: context.queryClient };
};

const editor = (name: string = POST_PLACEHOLDER) =>
  page.getByRole('textbox', { name });

const toolbar = () => page.getByRole('toolbar', { name: '書式' });

const submitButton = (name = 'コメントする') =>
  page.getByRole('button', { name, exact: true });

const ratingRow = () =>
  page.getByRole('radiogroup', { name: RATING_INPUT_LABEL });

const star = (score: number) =>
  page.getByRole('radio', { name: `5段階中${String(score)}`, exact: true });

async function waitForEditor(name?: string): Promise<void> {
  await expect.element(editor(name)).toBeInTheDocument();
  await expect
    .element(toolbar().getByRole('button', { name: '太字', exact: true }))
    .not.toHaveAttribute('disabled');
}

async function typeBody(text: string, name?: string): Promise<void> {
  await waitForEditor(name);
  await userEvent.click(editor(name));
  await userEvent.keyboard(text);
}

const passBotCheck = () =>
  userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));

const validationError = (field: string, message: string) =>
  new GraphQLClientError({
    code: 'validation_error',
    message,
    status: 400,
    details: [{ field, message, code: 'invalid' }],
  });

beforeEach(() => {
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation(() =>
    Promise.resolve({ ok: true, data: ratingQueryOf(null) }),
  );
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('CommentComposer', () => {
  test('書式のツールバー・「書く」「プレビュー」の切り替え・文字数のカウンターを備える', async () => {
    await renderComposer();
    await waitForEditor();

    await expect
      .element(toolbar().getByRole('button', { name: 'リンク', exact: true }))
      .toBeVisible();
    await expect.element(page.getByRole('tab', { name: '書く' })).toBeVisible();
    await expect
      .element(page.getByRole('tab', { name: 'プレビュー' }))
      .toBeVisible();
    await expect.element(page.getByText('0 / 2,000')).toBeVisible();
  });

  test('文字数のカウンターは入力した文字数と上限を3桁区切りで示す', async () => {
    await renderComposer({
      target: editTarget({ body: 'あ'.repeat(1234) }),
    });
    await waitForEditor(EDIT_PLACEHOLDER);

    await expect.element(page.getByText('1,234 / 2,000')).toBeVisible();
  });

  test('上限を超えた本文はフォーカスアウトで文言が出て、送れない', async () => {
    const { onSubmit } = await renderComposer({
      target: editTarget({ body: 'あ'.repeat(2001) }),
    });
    await waitForEditor(EDIT_PLACEHOLDER);
    await passBotCheck();

    await userEvent.click(editor(EDIT_PLACEHOLDER));
    await userEvent.tab();

    await expect
      .element(page.getByText('コメントは2,000文字以内で入力してください。'))
      .toBeVisible();
    await expect
      .element(editor(EDIT_PLACEHOLDER))
      .toHaveAttribute('aria-invalid', 'true');
    await expect.element(submitButton('保存する')).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('空の本文はフォーカスアウトで文言が出て、送れない', async () => {
    const { onSubmit } = await renderComposer();
    await waitForEditor();
    await passBotCheck();

    await userEvent.click(editor());
    await userEvent.tab();

    await expect
      .element(page.getByText('コメントを入力してください。'))
      .toBeVisible();
    await expect.element(submitButton()).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test.each<[string, () => CommentComposerTarget, boolean, boolean]>([
    ['投稿者本人以外のトップレベルの投稿欄', () => POST, false, true],
    ['投稿者本人のトップレベルの投稿欄', () => POST, true, false],
    ['投稿者本人以外の返信の投稿欄', () => replyTarget(), false, false],
    ['投稿者本人以外のトップレベルの編集欄', () => editTarget(), false, true],
    [
      '投稿者本人以外の返信の編集欄',
      () => editTarget({ topLevel: false }),
      false,
      false,
    ],
    ['投稿者本人のトップレベルの編集欄', () => editTarget(), true, false],
  ])('%sの評価の行の有無', async (_, targetOf, viewerIsOwner, shown) => {
    await renderComposer({ target: targetOf(), viewerIsOwner });

    await expect.element(page.getByRole('textbox')).toBeInTheDocument();
    if (shown) {
      await expect.element(ratingRow()).toBeVisible();
      await expect
        .element(page.getByText('評価(任意)', { exact: true }))
        .toBeVisible();
    } else {
      expect(ratingRow().query()).toBeNull();
      expect(page.getByText('評価(任意)', { exact: true }).query()).toBeNull();
    }
  });

  test('評価の行は閲覧者の現在の評価を初期値にする', async () => {
    await renderComposer({ viewerScore: 4 });

    await expect.element(star(4)).toHaveAttribute('aria-checked', 'true');
  });

  test('触れていない評価の行は、評価欄の値が変わると同じ値になる', async () => {
    const { queryClient } = await renderComposer({ viewerScore: 2 });
    await expect.element(star(2)).toHaveAttribute('aria-checked', 'true');

    queryClient.setQueryData(ratingKey(), ratingQueryOf(5));

    await expect.element(star(5)).toHaveAttribute('aria-checked', 'true');
  });

  test('bot対策のトークンが用意できるまで送れない', async () => {
    const { onSubmit } = await renderComposer({ viewerIsOwner: true });
    await typeBody('よいプロダクトです');
    await userEvent.click(page.getByText(OUTSIDE));

    await expect.element(submitButton()).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();

    await passBotCheck();

    await expect.element(submitButton()).toBeEnabled();
  });

  test('投稿欄は操作名comment_postのbot対策を使う', async () => {
    await renderComposer();
    await waitForEditor();
    expect(lastTurnstileProps().options?.action).toBe('comment_post');
  });

  test('編集欄は操作名comment_editのbot対策を使い、現在の本文を入れて開く', async () => {
    await renderComposer({ target: editTarget({ body: '前の本文' }) });
    await waitForEditor(EDIT_PLACEHOLDER);

    expect(lastTurnstileProps().options?.action).toBe('comment_edit');
    await expect
      .element(editor(EDIT_PLACEHOLDER))
      .toHaveTextContent('前の本文');
  });

  test('評価の行を描かない投稿欄は、本文とトークンだけを呼び出し元へ渡し評価を送らない', async () => {
    const { onSubmit } = await renderComposer({ viewerIsOwner: true });
    await typeBody('よいプロダクトです');
    await passBotCheck();

    await userEvent.click(submitButton());

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual({
      body: 'よいプロダクトです',
      turnstileToken: 'turnstile-token-1',
    });
  });

  test('評価の行で選んだ評価を本文と一緒に呼び出し元へ渡す', async () => {
    const { onSubmit } = await renderComposer({ viewerScore: 4 });
    await typeBody('よいプロダクトです');
    await userEvent.click(star(5));
    await passBotCheck();

    await userEvent.click(submitButton());

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual({
      body: 'よいプロダクトです',
      rating: 5,
      turnstileToken: 'turnstile-token-1',
    });
  });

  test('評価を選ばずに送ると、現在の評価を初期値にしていても評価を送らない', async () => {
    const { onSubmit } = await renderComposer({ viewerScore: 4 });
    await typeBody('よいプロダクトです');
    await passBotCheck();

    await userEvent.click(submitButton());

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual({
      body: 'よいプロダクトです',
      turnstileToken: 'turnstile-token-1',
    });
  });

  test('成功すると入力が空になる', async () => {
    const { onSubmit } = await renderComposer();
    await typeBody('よいプロダクトです');
    await passBotCheck();

    await userEvent.click(submitButton());

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    await expect.element(page.getByText('0 / 2,000')).toBeVisible();
    await expect.element(editor()).not.toHaveTextContent('よいプロダクトです');
  });

  test('トップレベルの投稿欄は成功の後に本文へフォーカスを移し、評価の行を送った評価にする', async () => {
    const { onSubmit } = await renderComposer({ viewerScore: 2 });
    await typeBody('よいプロダクトです');
    await userEvent.click(star(5));
    await passBotCheck();

    await userEvent.click(submitButton());

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    await expect.element(editor()).toHaveFocus();
    await expect.element(star(5)).toHaveAttribute('aria-checked', 'true');
  });

  test('評価の行を持つ編集欄は、選んだ評価を本文と一緒に呼び出し元へ渡す', async () => {
    const { onSubmit } = await renderComposer({
      target: editTarget({ body: '前の本文' }),
      viewerScore: 3,
    });
    await waitForEditor(EDIT_PLACEHOLDER);
    await userEvent.click(star(1));
    await passBotCheck();

    await userEvent.click(submitButton('保存する'));

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual({
      body: '前の本文',
      rating: 1,
      turnstileToken: 'turnstile-token-1',
    });
  });

  test('返信の評価のvalidation_errorは、フォーム全体の失敗として示し送信ボタンを無効のまま残さない', async () => {
    const message = '評価は1〜5で選んでください。';
    const onSubmit: SubmitMock = vi.fn(() =>
      Promise.reject(validationError('input.rating', message)),
    );
    await renderComposer({ target: replyTarget(), onSubmit });
    await typeBody('返信です', REPLY_PLACEHOLDER);
    await passBotCheck();

    await userEvent.click(submitButton('返信する'));

    await expect.element(page.getByRole('alert')).toHaveTextContent(message);
    await expect
      .element(editor(REPLY_PLACEHOLDER))
      .toHaveTextContent('返信です');
    await userEvent.click(page.getByText(OUTSIDE));
    await passBotCheck();
    await expect.element(submitButton('返信する')).toBeEnabled();
  });

  test('欄に対応する失敗は、入力を保ったまま欄の下に文言を出す', async () => {
    const message = 'コメントに使用できない文字が含まれています。';
    const onSubmit: SubmitMock = vi.fn(() =>
      Promise.reject(validationError('input.body', message)),
    );
    await renderComposer({ onSubmit });
    await typeBody('よいプロダクトです');
    await passBotCheck();

    await userEvent.click(submitButton());

    await expect.element(page.getByText(message)).toBeVisible();
    await expect.element(editor()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(editor()).toHaveTextContent('よいプロダクトです');
  });

  test('想定外の失敗は、入力を保ったままフォーム全体の失敗の文言を出す', async () => {
    const onSubmit: SubmitMock = vi.fn(() =>
      Promise.reject(new Error('通信に失敗しました')),
    );
    await renderComposer({ onSubmit });
    await typeBody('よいプロダクトです');
    await passBotCheck();

    await userEvent.click(submitButton());

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE);
    await expect.element(editor()).toHaveTextContent('よいプロダクトです');
  });

  test('失敗の後にフォーカスのある送信ボタンは、次のトークンを待ってから送る', async () => {
    const onSubmit: SubmitMock = vi
      .fn<(submission: CommentSubmission) => Promise<void>>()
      .mockRejectedValueOnce(new Error('通信に失敗しました'))
      .mockResolvedValue(undefined);
    await renderComposer({ onSubmit, viewerIsOwner: true });
    await typeBody('よいプロダクトです');
    await passBotCheck();
    await userEvent.click(submitButton());
    await expect.element(page.getByRole('alert')).toBeVisible();

    await expect.element(submitButton()).toHaveFocus();
    await expect
      .element(submitButton())
      .toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await passBotCheck();

    await expect.poll(() => onSubmit.mock.calls.length).toBe(2);
    expect(onSubmit.mock.calls[1]?.[0]).toStrictEqual({
      body: 'よいプロダクトです',
      turnstileToken: 'turnstile-token-2',
    });
  });

  test('トークンを待つ間に期限が切れると送らずに認証の失敗を示す', async () => {
    const onSubmit: SubmitMock = vi
      .fn<(submission: CommentSubmission) => Promise<void>>()
      .mockRejectedValueOnce(new Error('通信に失敗しました'));
    await renderComposer({ onSubmit, viewerIsOwner: true });
    await typeBody('よいプロダクトです');
    await passBotCheck();
    await userEvent.click(submitButton());
    await expect.element(page.getByRole('alert')).toBeVisible();
    await userEvent.keyboard('{Enter}');

    await userEvent.click(
      page.getByRole('button', { name: '判定の期限を切らす' }),
    );

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(BOT_CHECK_FAILED_MESSAGE);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await expect.element(editor()).toHaveTextContent('よいプロダクトです');
  });

  test('返信と編集の「キャンセル」は呼び出し元へ伝え、トップレベルの投稿欄には置かない', async () => {
    const onCancel = vi.fn();
    await renderComposer({ target: replyTarget(onCancel) });

    await userEvent.click(page.getByRole('button', { name: 'キャンセル' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('トップレベルの投稿欄には「キャンセル」を置かない', async () => {
    await renderComposer();
    await waitForEditor();

    expect(page.getByRole('button', { name: 'キャンセル' }).query()).toBeNull();
  });

  test('本文の欄にフォーカスがある空の返信の投稿欄でも、「キャンセル」は1回の押下で呼び出し元へ伝える', async () => {
    const onCancel = vi.fn();
    await renderComposer({ target: replyTarget(onCancel) });
    await waitForEditor(REPLY_PLACEHOLDER);
    await userEvent.click(editor(REPLY_PLACEHOLDER));

    await userEvent.click(page.getByRole('button', { name: 'キャンセル' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test.each<[string, () => CommentComposerTarget, string]>([
    ['返信の投稿欄', () => replyTarget(), REPLY_PLACEHOLDER],
    ['編集欄', () => editTarget(), EDIT_PLACEHOLDER],
  ])('%sは開いた時に本文の欄へフォーカスを移す', async (_, targetOf, name) => {
    await renderComposer({ target: targetOf() });

    await expect.element(editor(name)).toHaveFocus();
  });

  test('トップレベルの投稿欄は開いた時にフォーカスを移さない', async () => {
    await renderComposer();
    await waitForEditor();

    await expect.element(editor()).not.toHaveFocus();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('評価の行を持つ投稿欄のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderComposer({ viewerScore: 3 });
    await waitForEditor();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('失敗を示す返信の投稿欄のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const onSubmit: SubmitMock = vi.fn(() =>
      Promise.reject(new Error('通信に失敗しました')),
    );
    await renderComposer({ target: replyTarget(), onSubmit });
    await typeBody('返信です', REPLY_PLACEHOLDER);
    await passBotCheck();
    await userEvent.click(submitButton('返信する'));
    await expect.element(page.getByRole('alert')).toBeVisible();

    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
