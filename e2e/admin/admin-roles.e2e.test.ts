import {
  ADMIN_ACCOUNTS_TITLE,
  INVITE_ADMIN_LABEL,
  ROW_ACTION_NAMES,
} from '../../apps/admin/src/components/admins/admin-accounts-messages.ts';
import {
  ADMIN_ROLE_LABELS,
  type AdminRole,
} from '../../apps/common-lib/admin/admin-roles.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  expectAdminRole,
  openFromAdminNavigation,
  signInAdmin,
  signInAsNewAdmin,
  signOutAdmin,
} from '../support/admin-bootstrap.ts';
import { expect, test } from './admin-test.ts';

test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS });

const ACCOUNTS_PATH = '/accounts';

interface RoleExpectation {
  readonly role: AdminRole;
  readonly canInvite: boolean;
  readonly canChangeRole: boolean;
}

const ROLE_EXPECTATIONS: readonly RoleExpectation[] = [
  { role: 'viewer', canInvite: false, canChangeRole: false },
  { role: 'moderator', canInvite: true, canChangeRole: false },
  { role: 'super_admin', canInvite: true, canChangeRole: true },
];

test.describe('ロールによる表示と操作の出し分け', () => {
  for (const { role, canInvite, canChangeRole } of ROLE_EXPECTATIONS) {
    test(`ロールが${ADMIN_ROLE_LABELS[role]}の管理者はヘッダーにロールが表示され、管理者アカウントのページの操作がロールに応じて出し分けられ、ログアウトの後に再ログインできる`, async ({
      page,
    }) => {
      const admin = await signInAsNewAdmin(page, { role });

      await openFromAdminNavigation(page, admin, ACCOUNTS_PATH);
      await expect(
        page.getByRole('heading', { level: 1, name: ADMIN_ACCOUNTS_TITLE }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: INVITE_ADMIN_LABEL, exact: true }),
      ).toHaveCount(canInvite ? 1 : 0);
      await expect(
        page.getByRole('button', {
          name: ROW_ACTION_NAMES.changeRole(admin.nickname),
        }),
      ).toHaveCount(canChangeRole ? 1 : 0);
      await expect(
        page.getByRole('button', {
          name: ROW_ACTION_NAMES.delete(admin.nickname),
        }),
      ).toHaveCount(0);

      await signOutAdmin(page, admin);
      await signInAdmin(page, admin);
      await expectAdminRole(page, admin);
    });
  }
});
