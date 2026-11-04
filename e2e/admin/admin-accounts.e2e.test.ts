import type { Locator, Page } from '@playwright/test';

import {
  ADMIN_ROLE_LABELS,
  type AdminRole,
} from '../../apps/common-lib/admin/admin-roles.ts';
import {
  ADMIN_ACCOUNT_DELETE_ACTION,
  ADMIN_ACCOUNT_INVITE_ACTION,
  ADMIN_ACCOUNT_ROLE_CHANGE_ACTION,
} from '../../apps/common-lib/admin/audit-actions/admin-foundation.ts';
import {
  ADMIN_ACCOUNTS_TITLE,
  ADMIN_DELETED_MESSAGE,
  ADMIN_LIST_HEADING,
  ADMIN_STATUS_LABELS,
  CHANGE_ROLE_SUBMIT_LABEL,
  changeRoleTitle,
  DELETE_ADMIN_CONFIRM_LABEL,
  deleteAdminTitle,
  INVITE_ADMIN_LABEL,
  INVITE_ADMIN_SUBMIT_LABEL,
  invitationSentMessage,
  ROLE_CHANGED_MESSAGE,
  ROW_ACTION_NAMES,
} from '../../apps/admin/src/components/admins/admin-accounts-messages.ts';
import {
  EMAIL_LABEL,
  LOGIN_PAGE_TITLE,
  REQUIRED_SUFFIX,
} from '../../apps/admin/src/components/auth/admin-auth-messages.ts';
import {
  ACTION_FILTER_LABEL,
  AUDIT_LOG_EMPTY_MESSAGE,
  AUDIT_LOG_LIST_CAPTION,
  AUDIT_LOGS_TITLE,
  FROM_FILTER_LABEL,
  OPERATOR_FILTER_LABEL,
  TO_FILTER_LABEL,
} from '../../apps/admin/src/components/audit/audit-logs-messages.ts';
import {
  APPLY_FILTER_LABEL,
  CONFIRM_ACTION_CANCEL_LABEL,
  OPTIONAL_REASON_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  type BootstrappedAdmin,
  completeAdminInvitation,
  createAdminEmail,
  expectAdminRole,
  findAdminIdByEmail,
  openFromAdminNavigation,
  signInAsNewAdmin,
  withSoleActiveSuperAdmin,
} from '../support/admin-bootstrap.ts';
import { assumeDistinctClientIp } from '../support/client-ip.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { waitForEmailLink } from '../support/mailpit.ts';
import { expect, test } from './admin-test.ts';

// 招待・ロール変更・削除・監査ログの絞り込みを1つの流れで行い、2人の管理者の招待の完了と複数の時間窓の認証コードを待つ
test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS * 2 });

// APIサーバーの管理者側のエラーの定義(ADMIN_ERRORSのlast_super_admin)の文言。定義のファイルはWorkersの型を前提とする部品を読み込み、ルートの型検査に含められないため写して持つ
const LAST_SUPER_ADMIN_MESSAGE =
  '最上位管理者が1人だけのため、この操作はできません。';

const ACCOUNTS_PATH = '/accounts';

const AUDIT_LOGS_PATH = '/audit-logs';

const INVITATION_PATH = '/auth/invitation';

// 監査ログに残る理由。個人情報を含めない
const INVITE_REASON = 'E2Eの招待の確認';

const ROLE_CHANGE_REASON = 'E2Eのロール変更の確認';

const DELETE_REASON = 'E2Eの削除の確認';

// 監査ログの期間の条件に、どの監査ログも記録されていない日付として使う
const PAST_DATE = '2001-01-01';

const accountRow = (page: Page, email: string): Locator =>
  page
    .getByRole('table', { name: ADMIN_LIST_HEADING })
    .getByRole('row')
    .filter({ hasText: email });

// 一覧のページを開き直した直後はハイドレーションの前のことがあるため、ダイアログが開くまで押し直す
async function openDialog(
  page: Page,
  opener: Locator,
  dialogName: string,
): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await opener.click();
    }
    await expect(dialog).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  return dialog;
}

async function inviteFromAccountsPage(
  page: Page,
  email: string,
): Promise<void> {
  const dialog = await openDialog(
    page,
    page.getByRole('button', { name: INVITE_ADMIN_LABEL, exact: true }),
    INVITE_ADMIN_LABEL,
  );
  await dialog
    .getByLabel(`${EMAIL_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(email);
  await dialog
    .getByLabel(OPTIONAL_REASON_LABEL, { exact: true })
    .fill(INVITE_REASON);
  await dialog.getByRole('button', { name: INVITE_ADMIN_SUBMIT_LABEL }).click();
  await expect(page.getByText(invitationSentMessage(email))).toBeVisible();
  await expect(dialog).toHaveCount(0);
}

async function openChangeRoleDialog(
  page: Page,
  target: Pick<BootstrappedAdmin, 'nickname'>,
  role: AdminRole,
): Promise<Locator> {
  const dialog = await openDialog(
    page,
    page.getByRole('button', {
      name: ROW_ACTION_NAMES.changeRole(target.nickname),
    }),
    changeRoleTitle(target.nickname),
  );
  await dialog
    .getByRole('radio', { name: ADMIN_ROLE_LABELS[role], exact: true })
    .check();
  return dialog;
}

const localDateOf = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const now = new Date();
    return [
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
  });

async function chooseFilterOption(
  page: Page,
  filterLabel: string,
  optionLabel: string,
): Promise<void> {
  const option = page.getByRole('option', { name: optionLabel, exact: true });
  await expect(async () => {
    if (!(await option.isVisible())) {
      await page.getByRole('combobox', { name: filterLabel }).click();
    }
    await expect(option).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await option.click();
}

async function applyPeriod(
  page: Page,
  from: string,
  to: string,
): Promise<void> {
  await page.getByLabel(FROM_FILTER_LABEL, { exact: true }).fill(from);
  await page.getByLabel(TO_FILTER_LABEL, { exact: true }).fill(to);
  await page.getByRole('button', { name: APPLY_FILTER_LABEL }).click();
}

test.describe('管理者アカウントの管理と監査ログ', () => {
  test('最上位管理者がモデレーターを招待して完了させ、ロールを変え、自分が最後の最上位管理者なら自分を降格できず、削除でき、監査ログで操作者・操作種別・期間で絞り込める', async ({
    browser,
    baseURL,
    page,
  }) => {
    const superAdmin = await signInAsNewAdmin(page, { role: 'super_admin' });
    await openFromAdminNavigation(page, superAdmin, ACCOUNTS_PATH);
    await expect(
      page.getByRole('heading', { level: 1, name: ADMIN_ACCOUNTS_TITLE }),
    ).toBeVisible();

    const moderatorEmail = createAdminEmail();
    await inviteFromAccountsPage(page, moderatorEmail);
    await expect(accountRow(page, moderatorEmail)).toContainText(
      ADMIN_STATUS_LABELS.invited,
    );

    const moderatorContext = await browser.newContext({ baseURL });
    try {
      await assumeDistinctClientIp(moderatorContext, baseURL);
      const moderatorPage = await moderatorContext.newPage();
      const link = await waitForEmailLink({
        to: moderatorEmail,
        linkPath: INVITATION_PATH,
      });
      const completed = await completeAdminInvitation(moderatorPage, link);
      const moderator: BootstrappedAdmin = {
        ...completed,
        adminId: await findAdminIdByEmail(moderatorEmail),
        email: moderatorEmail,
        role: 'viewer',
      };
      await expectAdminRole(moderatorPage, moderator);

      await page.reload();
      const row = accountRow(page, moderatorEmail);
      await expect(row).toContainText(ADMIN_STATUS_LABELS.active);
      await expect(row).toContainText(ADMIN_ROLE_LABELS.viewer);

      const roleDialog = await openChangeRoleDialog(
        page,
        moderator,
        'moderator',
      );
      await roleDialog
        .getByLabel(OPTIONAL_REASON_LABEL, { exact: true })
        .fill(ROLE_CHANGE_REASON);
      await roleDialog
        .getByRole('button', { name: CHANGE_ROLE_SUBMIT_LABEL })
        .click();
      await expect(page.getByText(ROLE_CHANGED_MESSAGE)).toBeVisible();
      await expect(roleDialog).toHaveCount(0);
      await expect(row).toContainText(ADMIN_ROLE_LABELS.moderator);

      await moderatorPage.reload();
      await expectAdminRole(moderatorPage, { ...moderator, role: 'moderator' });

      await withSoleActiveSuperAdmin(superAdmin, async () => {
        const selfDialog = await openChangeRoleDialog(
          page,
          superAdmin,
          'moderator',
        );
        await selfDialog
          .getByRole('button', { name: CHANGE_ROLE_SUBMIT_LABEL })
          .click();
        await expect(
          selfDialog
            .getByRole('alert')
            .filter({ hasText: LAST_SUPER_ADMIN_MESSAGE }),
        ).toBeVisible();
        await selfDialog
          .getByRole('button', { name: CONFIRM_ACTION_CANCEL_LABEL })
          .click();
        await expect(selfDialog).toHaveCount(0);
      });
      await expect(accountRow(page, superAdmin.email)).toContainText(
        ADMIN_ROLE_LABELS.super_admin,
      );
      await expectAdminRole(page, superAdmin);

      const deleteDialog = await openDialog(
        page,
        page.getByRole('button', {
          name: ROW_ACTION_NAMES.delete(moderator.nickname),
        }),
        deleteAdminTitle(moderator.nickname),
      );
      await deleteDialog
        .getByLabel(OPTIONAL_REASON_LABEL, { exact: true })
        .fill(DELETE_REASON);
      await deleteDialog
        .getByRole('button', { name: DELETE_ADMIN_CONFIRM_LABEL })
        .click();
      await expect(page.getByText(ADMIN_DELETED_MESSAGE)).toBeVisible();
      await expect(accountRow(page, moderatorEmail)).toHaveCount(0);

      await moderatorPage.reload();
      await expect(
        moderatorPage.getByRole('form', { name: LOGIN_PAGE_TITLE }),
      ).toBeVisible();

      await openFromAdminNavigation(page, superAdmin, AUDIT_LOGS_PATH);
      await expect(
        page.getByRole('heading', { level: 1, name: AUDIT_LOGS_TITLE }),
      ).toBeVisible();
      const logRows = page
        .getByRole('table', { name: AUDIT_LOG_LIST_CAPTION })
        .getByRole('row')
        .filter({ hasText: moderator.adminId });

      await chooseFilterOption(
        page,
        OPERATOR_FILTER_LABEL,
        superAdmin.nickname,
      );
      await page.getByRole('button', { name: APPLY_FILTER_LABEL }).click();
      await expect(page).toHaveURL(
        (url) => url.searchParams.get('operator') === superAdmin.adminId,
      );
      await expect(logRows).toHaveCount(3);
      await expect(
        logRows.filter({ hasText: ADMIN_ACCOUNT_INVITE_ACTION.label }),
      ).toContainText(INVITE_REASON);
      await expect(
        logRows.filter({ hasText: ADMIN_ACCOUNT_DELETE_ACTION.label }),
      ).toContainText(DELETE_REASON);

      await chooseFilterOption(
        page,
        ACTION_FILTER_LABEL,
        ADMIN_ACCOUNT_ROLE_CHANGE_ACTION.label,
      );
      await page.getByRole('button', { name: APPLY_FILTER_LABEL }).click();
      await expect(logRows).toHaveCount(1);
      await expect(logRows).toContainText(ROLE_CHANGE_REASON);
      await expect(logRows).toContainText('fromRole: viewer');
      await expect(logRows).toContainText('toRole: moderator');

      const today = await localDateOf(page);
      await applyPeriod(page, today, today);
      await expect(logRows).toHaveCount(1);

      await applyPeriod(page, PAST_DATE, PAST_DATE);
      await expect(page.getByText(AUDIT_LOG_EMPTY_MESSAGE)).toBeVisible();
      await expect(logRows).toHaveCount(0);
    } finally {
      await moderatorContext.close();
    }
  });
});
