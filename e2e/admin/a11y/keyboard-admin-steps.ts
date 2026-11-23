import { expect, type Locator, type Page } from '@playwright/test';

import {
  EMAIL_LABEL,
  LOGIN_SUBMIT_LABEL,
  PASSWORD_LABEL,
  REQUIRED_SUFFIX,
  TOTP_CODE_LABEL,
} from '../../../apps/admin/src/components/auth/admin-auth-messages.ts';
import {
  ADMIN_LOGGED_OUT_MESSAGE,
  ADMIN_LOGOUT_LABEL,
  ADMIN_NAVIGATION_LABEL,
} from '../../../apps/admin/src/components/layout/admin-shell-messages.ts';
import {
  MODERATION_CHANGED_MESSAGES,
  MODERATION_PAGE_COPY,
  suspendUserDialogCopy,
  USER_FILTER_LABELS,
  userActionName,
} from '../../../apps/admin/src/components/moderation/shared/moderation-messages.ts';
import {
  REPORT_CASE_DETAIL_COPY,
  REPORT_STATUS_CHANGE_COPY,
  reportStatusChangeTitle,
} from '../../../apps/admin/src/components/reporting/case/report-case-messages.ts';
import { ADMIN_NAV_ITEMS } from '../../../apps/admin/src/composition/admin-navigation.ts';
import { REPORT_CASE_STATUS_LABELS } from '../../../apps/common-lib/reporting/report-labels.ts';
import {
  APPLY_FILTER_LABEL,
  OPTIONAL_REASON_LABEL,
  REQUIRED_REASON_LABEL,
} from '../../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  accountMenuButton,
  type BootstrappedAdmin,
  expectDashboard,
  loginForm,
  nextTotpCode,
  secondFactorForm,
} from '../../support/admin-bootstrap.ts';
import { waitForBotToken } from '../../support/bot-verification.ts';
import type { KeyboardOperator } from '../../support/keyboard-operator.ts';
import { userRowOf } from '../user-moderation-steps.ts';

const REPORT_CASE_STATUS_CHANGED_MESSAGE = '対応中にしました。';

// 上流の管理画面の通報の文言(components/reporting/shared/report-messages.ts)の写し。そのファイルは画面の部品まで辿りJSXを扱わないルートの型検査で読めないため写す
const REJECT_DIALOG_TITLE = 'この通報を却下しますか?';

const REJECT_CONFIRM_LABEL = '却下する';

const REJECTED_MESSAGE = '却下しました。';

const commentRejectActionName = (productName: string): string =>
  `${productName}へのコメントの通報を却下する`;

const navLabelOf = (path: string): string => {
  const item = ADMIN_NAV_ITEMS.find(({ to }) => to === path);
  if (item === undefined) {
    throw new Error(`管理メニューに${path}の項目がありません`);
  }
  return item.label;
};

export async function logOutByKeyboard(
  operator: KeyboardOperator,
  admin: Pick<BootstrappedAdmin, 'nickname'>,
): Promise<void> {
  const { page } = operator;
  await operator.chooseMenuItem(
    accountMenuButton(page, admin),
    ADMIN_LOGOUT_LABEL,
    'アカウントのメニュー',
  );
  await expect(page.getByText(ADMIN_LOGGED_OUT_MESSAGE)).toBeVisible();
  await expect(accountMenuButton(page, admin)).toHaveCount(0);
}

// メールアドレスとパスワードの送信は送信のボタンへTabで移ってEnterで、認証コードの送信は入力欄のEnterで行う
export async function logInByKeyboard(
  operator: KeyboardOperator,
  admin: BootstrappedAdmin,
): Promise<void> {
  const { page } = operator;
  await page.goto('/auth/login');
  const form = loginForm(page);
  await waitForBotToken(form);
  await operator.type(
    form.getByLabel(`${EMAIL_LABEL}${REQUIRED_SUFFIX}`, { exact: true }),
    'メールアドレス',
    admin.email,
  );
  await operator.type(
    form.getByLabel(`${PASSWORD_LABEL}${REQUIRED_SUFFIX}`, { exact: true }),
    'パスワード',
    admin.password,
  );
  await operator.activate(
    form.getByRole('button', { name: LOGIN_SUBMIT_LABEL }),
    'ログインの送信',
  );

  const secondFactor = secondFactorForm(page);
  await expect(secondFactor).toBeVisible();
  const code = secondFactor.getByLabel(`${TOTP_CODE_LABEL}${REQUIRED_SUFFIX}`, {
    exact: true,
  });
  await operator.type(code, '認証コード', await nextTotpCode(admin));
  await operator.press('Enter');
  await expectDashboard(page, admin);
}

// 管理メニューのリンクをTabで選び、Enterで移る
export async function openFromNavigationByKeyboard(
  operator: KeyboardOperator,
  path: string,
): Promise<void> {
  const { page } = operator;
  await operator.activate(
    page
      .getByRole('navigation', { name: ADMIN_NAVIGATION_LABEL })
      .getByRole('link', { name: navLabelOf(path), exact: true }),
    `管理メニューの${navLabelOf(path)}`,
  );
  await expect(page).toHaveURL(path);
}

const operationsSectionOf = (page: Page): Locator =>
  page.getByRole('main').getByRole('region', {
    name: REPORT_CASE_DETAIL_COPY.sections.operations,
    exact: true,
  });

// 対応ステータスの変更を、選択の部品を矢印キーで選び、確認のダイアログで理由を任意に入力して確定する
export async function startReportCaseProgressByKeyboard(
  operator: KeyboardOperator,
  reason: string,
): Promise<void> {
  const { page } = operator;
  const operations = operationsSectionOf(page);
  await operator.chooseOption(
    operations.getByRole('combobox', {
      name: REPORT_STATUS_CHANGE_COPY.nextStatus,
      exact: true,
    }),
    REPORT_CASE_STATUS_LABELS.in_progress,
    '変更後の対応ステータス',
  );
  const dialog = page.getByRole('dialog', {
    name: reportStatusChangeTitle(REPORT_CASE_STATUS_LABELS.in_progress),
    exact: true,
  });
  await operator.activate(
    operations.getByRole('button', {
      name: REPORT_STATUS_CHANGE_COPY.submit,
      exact: true,
    }),
    '対応ステータスの変更',
  );
  await expect(dialog).toBeVisible();
  await operator.expectFocusInside(dialog, '対応ステータスの確認のダイアログ');
  await operator.type(
    dialog.getByLabel(OPTIONAL_REASON_LABEL, { exact: true }),
    '理由',
    reason,
  );
  await operator.activate(
    dialog.getByRole('button', {
      name: REPORT_STATUS_CHANGE_COPY.confirm,
      exact: true,
    }),
    '対応ステータスの変更の確定',
  );
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(REPORT_CASE_STATUS_CHANGED_MESSAGE, { exact: true }),
  ).toBeVisible();
}

// 却下の確認のダイアログをEscapeで閉じて元の操作へフォーカスが戻ることを確かめ、開き直して理由を入力して却下する
export async function rejectCommentReportByKeyboard(
  operator: KeyboardOperator,
  productName: string,
  reason: string,
): Promise<void> {
  const { page } = operator;
  const rejectButton = operationsSectionOf(page).getByRole('button', {
    name: commentRejectActionName(productName),
    exact: true,
  });
  const dialog = page.getByRole('dialog', {
    name: REJECT_DIALOG_TITLE,
    exact: true,
  });

  await operator.activate(rejectButton, '通報の却下の操作');
  await expect(dialog).toBeVisible();
  await operator.expectDialogEscapeCloses(
    dialog,
    '通報の却下の確認のダイアログ',
    rejectButton,
  );

  await operator.activate(rejectButton, '通報の却下の操作');
  await expect(dialog).toBeVisible();
  await operator.type(
    dialog.getByLabel(REQUIRED_REASON_LABEL, { exact: true }),
    '却下の理由',
    reason,
  );
  await operator.activate(
    dialog.getByRole('button', { name: REJECT_CONFIRM_LABEL, exact: true }),
    '却下の確定',
  );
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(REJECTED_MESSAGE, { exact: true })).toBeVisible();
}

// ハンドルで絞り込み、行の「停止」の操作から確認のダイアログで理由を入力して停止する
export async function suspendUserByKeyboard(
  operator: KeyboardOperator,
  user: { readonly handle: string; readonly nickname: string },
  reason: string,
): Promise<Locator> {
  const { page } = operator;
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: MODERATION_PAGE_COPY.users.title,
    }),
  ).toBeVisible();
  await operator.type(
    page.getByLabel(USER_FILTER_LABELS.handle, { exact: true }),
    'ハンドルの絞り込み',
    user.handle,
  );
  await operator.activate(
    page.getByRole('button', { name: APPLY_FILTER_LABEL }),
    '絞り込みの適用',
  );
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('handle') === user.handle,
  );
  const row = userRowOf(page, user.handle);
  await expect(row).toHaveCount(1);

  const copy = suspendUserDialogCopy(user.nickname);
  const suspendButton = row.getByRole('button', {
    name: userActionName('suspend', user.nickname),
    exact: true,
  });
  const dialog = page.getByRole('dialog', { name: copy.title, exact: true });
  await operator.activate(suspendButton, '利用者の停止の操作');
  await expect(dialog).toBeVisible();
  await operator.expectDialogEscapeCloses(
    dialog,
    '利用者の停止の確認のダイアログ',
    suspendButton,
  );

  await operator.activate(suspendButton, '利用者の停止の操作');
  await expect(dialog).toBeVisible();
  await operator.type(
    dialog.getByLabel(REQUIRED_REASON_LABEL, { exact: true }),
    '停止の理由',
    reason,
  );
  await operator.activate(
    dialog.getByRole('button', { name: copy.confirmLabel, exact: true }),
    '停止の確定',
  );
  await expect(
    page.getByText(MODERATION_CHANGED_MESSAGES['user.suspend'], {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  return row;
}
