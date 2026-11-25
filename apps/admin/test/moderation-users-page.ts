import type { Mock } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type { AdminRole } from '../src/graphql/generated/graphql.ts';
import type { ModerationGraphQLHandler } from './moderation-fixtures.ts';
import {
  renderUsersPage,
  respondUsersGraphQL,
  USERS_PATH,
  type UsersHandler,
  usersVariablesOf,
} from './moderation-users-fixtures.tsx';

export const main = () => page.getByRole('main');
export const table = () =>
  main().getByRole('table', { name: 'ユーザーの一覧' });
export const listHeading = () =>
  main().getByRole('heading', { level: 2, name: 'ユーザーの一覧' });
export const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
export const filterForm = () =>
  main().getByRole('search', { name: '絞り込み' });
export const textField = (name: string) =>
  filterForm().getByRole('textbox', { name, exact: true });
export const statusSelect = () =>
  filterForm().getByRole('combobox', { name: '停止状態' });
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
export const reasonBox = (name = '理由(必須)') =>
  dialog().getByRole('textbox', { name, exact: true });

export const cellTexts = (text: string) =>
  [...rowOf(text).element().querySelectorAll('td')].map(
    (cell) => cell.textContent,
  );

export const actionNames = () =>
  table()
    .getByRole('button')
    .elements()
    .map((button) => button.getAttribute('aria-label'));

export async function chooseStatus(name: string): Promise<void> {
  await userEvent.click(statusSelect());
  await userEvent.click(page.getByRole('option', { name, exact: true }));
}

export interface UsersPageRenderOptions {
  readonly role?: AdminRole;
  readonly users?: UsersHandler;
  readonly handlers?: ReadonlyMap<unknown, ModerationGraphQLHandler>;
  readonly path?: string;
}

// テストのファイルごとに差し替えたGraphQLの実行で、ユーザーのページを描き、送った一覧の条件を読む
export const usersPageHarness = (executeGraphQL: Mock) => ({
  renderWith: async ({
    role = 'VIEWER',
    users,
    handlers,
    path = USERS_PATH,
  }: UsersPageRenderOptions = {}) => {
    respondUsersGraphQL(executeGraphQL, {
      role,
      ...(users === undefined ? {} : { users }),
      ...(handlers === undefined ? {} : { handlers }),
    });
    return renderUsersPage(role, path);
  },
  lastVariables: () => usersVariablesOf(executeGraphQL).at(-1),
});
