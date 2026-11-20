import type { Mock } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { AdminRole } from '../src/graphql/generated/graphql.ts';
import {
  COMMENTS_PATH,
  type CommentsHandler,
  commentsVariablesOf,
  renderCommentsPage,
  respondCommentsGraphQL,
} from './moderation-comments-fixtures.tsx';
import type { ModerationGraphQLHandler } from './moderation-fixtures.ts';

export const main = () => page.getByRole('main');
export const table = () =>
  main().getByRole('table', { name: 'コメントの一覧' });
export const listHeading = () =>
  main().getByRole('heading', { level: 2, name: 'コメントの一覧' });
export const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
export const filterForm = () =>
  main().getByRole('search', { name: '絞り込み' });
export const textField = (name: string) =>
  filterForm().getByRole('textbox', { name, exact: true });
export const dateField = (name: string) =>
  filterForm().getByLabelText(name, { exact: true });
export const stateSelect = () =>
  filterForm().getByRole('combobox', { name: '状態' });
export const applyButton = () =>
  filterForm().getByRole('button', { name: '適用', exact: true });
export const resetButton = () =>
  filterForm().getByRole('button', { name: '解除', exact: true });
export const pagination = () =>
  main().getByRole('navigation', { name: 'ページ送り' });
export const nextButton = () =>
  pagination().getByRole('button', { name: '次へ' });
export const previousButton = () =>
  pagination().getByRole('button', { name: '前へ' });
export const actionButton = (name: string) =>
  table().getByRole('button', { name, exact: true });
export const dialog = () => page.getByRole('dialog');
export const reasonBox = () =>
  dialog().getByRole('textbox', { name: '理由(必須)', exact: true });

export const cellsOf = (text: string) => [
  ...rowOf(text).element().querySelectorAll('td'),
];

export const cellTexts = (text: string) =>
  cellsOf(text).map((cell) => cell.textContent);

export const actionNames = () =>
  table()
    .getByRole('button')
    .elements()
    .map((button) => button.getAttribute('aria-label'));

export async function chooseState(name: string): Promise<void> {
  await userEvent.click(stateSelect());
  await userEvent.click(page.getByRole('option', { name, exact: true }));
}

// 一覧の先頭へのスクロールの回数。他の部品が呼ぶスクロールを数えない
export const listScrollsOf = (
  scrollIntoView: { readonly mock: { readonly calls: unknown[][] } },
  behavior: ScrollBehavior,
): number =>
  scrollIntoView.mock.calls.filter(
    ([options]) =>
      JSON.stringify(options) === JSON.stringify({ block: 'start', behavior }),
  ).length;

export interface CommentsPageRenderOptions {
  readonly role?: AdminRole;
  readonly comments?: CommentsHandler;
  readonly handlers?: ReadonlyMap<unknown, ModerationGraphQLHandler>;
  readonly path?: string;
}

// テストのファイルごとに差し替えたGraphQLの実行で、コメントのページを描き、送った一覧の条件を読む
export const commentsPageHarness = (executeGraphQL: Mock) => ({
  renderWith: async ({
    role = 'VIEWER',
    comments,
    handlers,
    path = COMMENTS_PATH,
  }: CommentsPageRenderOptions = {}) => {
    respondCommentsGraphQL(executeGraphQL, {
      role,
      ...(comments === undefined ? {} : { comments }),
      ...(handlers === undefined ? {} : { handlers }),
    });
    return renderCommentsPage(role, path);
  },
  lastVariables: () => commentsVariablesOf(executeGraphQL).at(-1),
});
