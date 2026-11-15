import type { Locator, Page } from '@playwright/test';

import {
  AUDIT_LOG_LIST_CAPTION,
  AUDIT_LOGS_TITLE,
} from '../../apps/admin/src/components/audit/audit-logs-messages.ts';
import { SETTINGS_TITLE } from '../../apps/admin/src/components/settings/settings-messages.ts';
import {
  PROMOTION_SETTING_TITLE,
  PROMOTION_SWITCH_LABEL,
  promotionChangedMessageOf,
  promotionConfirmDescriptionOf,
  promotionConfirmLabelOf,
  promotionConfirmTitleOf,
  promotionStateLabelOf,
} from '../../apps/admin/src/components/ultras/promotion-setting-messages.ts';
import { ULTRAS_PROMOTION_UPDATE_ACTION } from '../../apps/common-lib/admin/audit-actions/ultras-subscription.ts';
import {
  AUDITED_ACTION_NOTICE,
  OPTIONAL_REASON_LABEL,
} from '../../apps/frontend-lib/utilities/messages/admin-console-messages.ts';
import {
  ADMIN_FLOW_TIMEOUT_MS,
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import {
  readUltrasPromotionFlag,
  setUltrasPromotionFlag,
} from '../client/ultras-steps.ts';
import { expect, test } from './admin-test.ts';

test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS });

const SETTINGS_PATH = '/settings';

const AUDIT_LOGS_PATH = '/audit-logs';

// 監査ログに残る理由。個人情報を含めない
const CHANGE_REASON = 'E2Eの機能フラグの切り替えの確認';

const promotionSection = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('region', { name: PROMOTION_SETTING_TITLE, exact: true });

const promotionSwitch = (page: Page): Locator =>
  promotionSection(page).getByRole('switch', {
    name: PROMOTION_SWITCH_LABEL,
    exact: true,
  });

// スイッチは確定の前に切り替わらず、押下は確認のダイアログを開くだけのため、ダイアログで理由を入れて確定し、トーストで反映を確かめる
async function togglePromotionFlag(page: Page, next: boolean): Promise<void> {
  await promotionSwitch(page).click();
  const dialog = page.getByRole('dialog', {
    name: promotionConfirmTitleOf(next),
  });
  await expect(dialog).toContainText(promotionConfirmDescriptionOf(next));
  await expect(dialog).toContainText(AUDITED_ACTION_NOTICE);
  await dialog
    .getByLabel(OPTIONAL_REASON_LABEL, { exact: true })
    .fill(CHANGE_REASON);
  await dialog
    .getByRole('button', { name: promotionConfirmLabelOf(next), exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(promotionChangedMessageOf(next))).toBeVisible();
}

// 機能フラグの行は利用者側のE2E(e2e/client/ultras.e2e.test.ts)も書き換えるため、2つのファイルはルートのplaywright.config.tsの直列の組で1つずつ実行する
test.describe('Ultras導線の機能フラグ(管理者側)', () => {
  test('最上位管理者が設定のページで機能フラグを切り替えて確定すると、トーストと区画が新しい値と変更した管理者を示し、監査ログの一覧に理由と新しい値の記録が出る', async ({
    page,
  }) => {
    const original = await readUltrasPromotionFlag();
    const next = !original;
    try {
      const admin = await signInAsNewAdmin(page, { role: 'super_admin' });
      await openFromAdminNavigation(page, admin, SETTINGS_PATH);
      await expect(
        page.getByRole('heading', { level: 1, name: SETTINGS_TITLE }),
      ).toBeVisible();
      await expect(promotionSwitch(page)).toBeEnabled();
      await expect(promotionSwitch(page)).toBeChecked({ checked: original });

      await togglePromotionFlag(page, next);

      await expect(promotionSwitch(page)).toBeChecked({ checked: next });
      await expect(promotionSection(page)).toContainText(
        promotionStateLabelOf(next),
      );
      await expect(promotionSection(page)).toContainText(admin.nickname);
      expect(await readUltrasPromotionFlag()).toBe(next);

      await openFromAdminNavigation(page, admin, AUDIT_LOGS_PATH);
      await expect(
        page.getByRole('heading', { level: 1, name: AUDIT_LOGS_TITLE }),
      ).toBeVisible();
      const logRows = page
        .getByRole('table', { name: AUDIT_LOG_LIST_CAPTION })
        .getByRole('row')
        .filter({ hasText: ULTRAS_PROMOTION_UPDATE_ACTION.label })
        .filter({ hasText: admin.nickname });
      await expect(logRows).toHaveCount(1);
      await expect(logRows).toContainText(CHANGE_REASON);
      await expect(logRows).toContainText(`enabled: ${String(next)}`);
    } finally {
      await setUltrasPromotionFlag(original);
    }
  });
});
