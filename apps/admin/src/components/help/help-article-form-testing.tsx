import { expect, type Mock, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { callsOf, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  HELP_CATEGORIES,
  SUPPORT_AUTHOR,
} from '../../../test/admin-help-articles-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { AdminHelpArticleView } from '../../graphql/admin-help-articles.ts';
import {
  type HelpCategoryView,
  toHelpCategories,
} from '../../graphql/admin-help-categories.ts';
import {
  AdminCreateHelpArticleDocument,
  type AdminCreateHelpArticleMutation,
  AdminHelpArticleHandleAvailabilityDocument,
  AdminUpdateHelpArticleDocument,
  type HelpArticleHandleAvailability,
} from '../../graphql/generated/graphql.ts';
import { HelpArticleForm } from './help-article-form.tsx';

// 使う側のテストファイルがexecute-graphql.tsをvi.mockで差し替えるため、読み込んだ関数はモックになる
export const graphql = vi.mocked(executeGraphQL) as unknown as Mock;

export const CATEGORIES = toHelpCategories(HELP_CATEGORIES);

const categoryAt = (index: number): HelpCategoryView => {
  const category = CATEGORIES[index];
  if (category === undefined) {
    throw new Error('カテゴリの固定値が足りません。');
  }
  return category;
};

// 管理者が指定した並び順で「料金」「使い方」「その他」
export const PRICING = categoryAt(0);

export const USAGE = categoryAt(1);

export const OTHER = categoryAt(2);

export const ARTICLE: AdminHelpArticleView = Object.freeze({
  id: '01JD0HART00000000000000001',
  handle: 'how-upvote-works',
  previousHandle: 'upvote',
  title: 'Upvoteの仕組み',
  subtitle: '投票の数え方',
  body: '## 数え方\n\n1人1票です。',
  categoryId: USAGE.id,
  categoryName: USAGE.name,
  status: 'published',
  pinned: true,
  creator: {
    nickname: SUPPORT_AUTHOR.nickname,
    title: SUPPORT_AUTHOR.title,
    avatar: null,
  },
  revision: 7,
  createdAt: '2026-11-01T01:00:00.000Z',
  updatedAt: '2026-11-10T05:30:00.000Z',
});

type SavedArticle = AdminCreateHelpArticleMutation['createHelpArticle'];

export const savedArticleOf = (
  overrides: Partial<SavedArticle> = {},
): SavedArticle => ({
  id: ARTICLE.id,
  handle: ARTICLE.handle,
  previousHandle: ARTICLE.previousHandle,
  title: ARTICLE.title,
  subtitle: ARTICLE.subtitle,
  body: ARTICLE.body,
  categoryId: ARTICLE.categoryId,
  categoryName: ARTICLE.categoryName,
  status: 'PUBLISHED',
  pinned: true,
  creator: SUPPORT_AUTHOR,
  revision: ARTICLE.revision + 1,
  createdAt: ARTICLE.createdAt,
  updatedAt: '2026-11-11T00:00:00.000Z',
  ...overrides,
});

export type Handler = (variables: unknown) => Promise<unknown>;

const unexpected: Handler = () =>
  Promise.reject(new Error('想定していない操作が実行されました。'));

export const availabilityOf =
  (availability: HelpArticleHandleAvailability): Handler =>
  () =>
    success({ helpArticleHandleAvailability: availability });

// 使用可否・作成・編集の操作に応答し、既定ではハンドルを使えるとする
export function respond({
  availability = availabilityOf('AVAILABLE'),
  create = unexpected,
  update = unexpected,
}: {
  readonly availability?: Handler;
  readonly create?: Handler;
  readonly update?: Handler;
} = {}): void {
  const handlers = new Map<unknown, Handler>([
    [AdminHelpArticleHandleAvailabilityDocument, availability],
    [AdminCreateHelpArticleDocument, create],
    [AdminUpdateHelpArticleDocument, update],
  ]);
  graphql.mockImplementation((document: unknown, variables: unknown) =>
    (handlers.get(document) ?? unexpected)(variables),
  );
}

interface RenderOptions {
  readonly article?: AdminHelpArticleView;
  readonly readOnly?: boolean;
}

async function renderWith(
  target:
    | { readonly mode: 'create' }
    | { readonly mode: 'edit'; readonly article: AdminHelpArticleView },
  readOnly: boolean,
): Promise<{ readonly onSaved: Mock }> {
  const onSaved = vi.fn();
  await renderInRouter(
    <main className="p-4">
      <HelpArticleForm
        {...target}
        categories={CATEGORIES}
        readOnly={readOnly}
        onSaved={onSaved}
      />
    </main>,
  );
  return { onSaved };
}

export const renderEditForm = ({
  article = ARTICLE,
  readOnly = false,
}: RenderOptions = {}) => renderWith({ mode: 'edit', article }, readOnly);

export const renderCreateForm = () => renderWith({ mode: 'create' }, false);

export const form = () => page.getByRole('form');

export const textbox = (name: string) =>
  page.getByRole('textbox', { name, exact: true });

export const titleInput = () => textbox('タイトル(必須)');

export const subtitleInput = () => textbox('サブタイトル(必須)');

export const handleInput = () => textbox('ハンドル(必須)');

export const reasonInput = () => textbox('理由(任意)');

export const categoryTrigger = () =>
  page.getByRole('combobox', { name: 'カテゴリ(必須)' });

export const option = (name: string) =>
  page.getByRole('option', { name, exact: true });

export const pinnedCheckbox = () =>
  page.getByRole('checkbox', { name: 'ピン留め ピン留めする', exact: true });

export const statusRadio = (name: '下書き' | '公開') =>
  page.getByRole('radio', { name, exact: true });

export const editable = () =>
  page.getByRole('textbox', { name: '本文(必須)', exact: true });

export const button = (name: string) =>
  page.getByRole('button', { name, exact: true });

export const alert = () => form().getByRole('alert');

export async function waitForEditor(): Promise<HTMLElement> {
  await expect.element(editable()).toBeInTheDocument();
  await expect
    .element(
      page
        .getByRole('toolbar', { name: '書式' })
        .getByRole('button', { name: '太字', exact: true }),
    )
    .not.toHaveAttribute('disabled');
  return editable().element() as HTMLElement;
}

export async function fillAndBlur(
  input: ReturnType<typeof textbox>,
  value: string,
): Promise<void> {
  await userEvent.fill(input, value);
  await userEvent.tab();
}

export const availabilityCalls = () =>
  callsOf(graphql, AdminHelpArticleHandleAvailabilityDocument);

export const PREVIOUS_HANDLE_GUIDANCE =
  '以前のハンドルupvoteのURLは、次にハンドルを変更するか、記事を削除するか、他の記事が同じハンドルを設定するまで新しいURLへ転送されます。';

export const RELEASES_PREVIOUS_MESSAGE =
  'このハンドルは別の記事の以前のハンドルです。保存すると、その記事の以前のURLは転送されなくなります。';

export const HANDLE_UNAVAILABLE_MESSAGE =
  'このハンドルは既に使われています。別の文字列を入力してください。';

export const CATEGORY_MOVE_NOTICE =
  'カテゴリを変えて保存すると、変更先のカテゴリの末尾に並びます。';

export const CONFLICT_MESSAGE =
  'このヘルプ記事は別の画面で変更されました。最新の内容を読み込んでから保存してください。';

export const NOT_FOUND_MESSAGE = 'このヘルプ記事は削除されています。';

export const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';
