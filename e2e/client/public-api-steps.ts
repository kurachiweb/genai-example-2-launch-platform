import { randomBytes } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';

import {
  API_KEY_FEATURE_LABELS,
  API_KEY_FEATURES,
  API_KEY_LEVEL_LABELS,
  type ApiKeyScopes,
} from '../../apps/common-lib/public-api/api-key-rules.ts';
import { API_KEY_SETTINGS_HREF } from '../../apps/client/src/components/public-api/api-docs-messages.ts';
import {
  API_KEY_CONFIRM_MESSAGES,
  deleteApiKeyTitleOf,
  ISSUED_API_KEY_MESSAGES,
  reissueApiKeyTitleOf,
} from '../../apps/client/src/components/public-api/api-key-dialog-messages.ts';
import { API_KEY_FORM_MESSAGES } from '../../apps/client/src/components/public-api/api-key-form-messages.ts';
import {
  API_KEY_LIST_MESSAGES,
  deleteApiKeyLabelOf,
  reissueApiKeyLabelOf,
} from '../../apps/client/src/components/public-api/api-key-list-messages.ts';
import {
  API_KEY_SETTINGS_MESSAGES,
  API_KEY_SETTINGS_PAGE_TITLE,
} from '../../apps/client/src/components/public-api/api-key-settings-messages.ts';
import { DESCRIPTION_HEADING } from '../../apps/client/src/components/product-page/product-description-messages.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { productPagePath } from './directory-steps.ts';

export interface IssuedApiKey {
  readonly name: string;
  readonly plainKey: string;
  // 同じ名前のキーは一覧で発行日時(ISO 8601)で見分ける
  readonly createdAt: string;
}

// 前の実行のキーと名前で混ざらないよう、乱数から作る
export function createApiKeyName(): string {
  return `E2Eのキー${randomBytes(4).toString('hex')}`;
}

const apiKeyList = (page: Page): Locator =>
  page.getByRole('list', { name: API_KEY_LIST_MESSAGES.listLabel });

const apiKeyItems = (page: Page, name: string): Locator =>
  apiKeyList(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

const apiKeyItemOf = (page: Page, key: IssuedApiKey): Locator =>
  apiKeyItems(page, key.name).filter({
    has: page.locator(`time[datetime="${key.createdAt}"]`),
  });

const issuedKeyDialog = (page: Page): Locator =>
  page.getByRole('dialog', { name: ISSUED_API_KEY_MESSAGES.title });

export async function openApiKeySettings(page: Page): Promise<void> {
  await page.goto(API_KEY_SETTINGS_HREF);
  await expect(
    page.getByRole('heading', { level: 1, name: API_KEY_SETTINGS_PAGE_TITLE }),
  ).toBeVisible();
}

// ハイドレーションの前に押したボタンは何もしないため、ダイアログが開くまで押し直す。開いた後は押さない
async function pressUntilDialogOpens(
  trigger: Locator,
  dialog: Locator,
): Promise<void> {
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await trigger.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(dialog).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
}

async function chooseScopes(
  form: Locator,
  scopes: ApiKeyScopes,
): Promise<void> {
  for (const feature of API_KEY_FEATURES) {
    const radio = form
      .getByRole('radiogroup', {
        name: API_KEY_FEATURE_LABELS[feature],
        exact: true,
      })
      .getByRole('radio', {
        name: API_KEY_LEVEL_LABELS[scopes[feature]],
        exact: true,
      });
    await radio.check();
    await expect(radio).toBeChecked();
  }
}

// 平文を控えてから閉じ、一覧に加わった項目の発行日時を読む。同じ名前のキーがある時は、控えた発行日時のどれとも違う項目を新しいキーとする
async function takePlainKey(
  page: Page,
  name: string,
  knownCreatedAt: readonly string[],
): Promise<IssuedApiKey> {
  const dialog = issuedKeyDialog(page);
  const field = dialog.getByLabel(ISSUED_API_KEY_MESSAGES.keyLabel, {
    exact: true,
  });
  await expect(field).not.toHaveValue('');
  const plainKey = await field.inputValue();
  await dialog
    .getByRole('button', { name: ISSUED_API_KEY_MESSAGES.close, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const items = apiKeyItems(page, name);
  await expect(items).toHaveCount(knownCreatedAt.length + 1);
  const createdAt = (
    await items
      .locator('time')
      .evaluateAll((times) =>
        times.map((time) => time.getAttribute('datetime')),
      )
  ).find(
    (value): value is string =>
      value !== null && !knownCreatedAt.includes(value),
  );
  if (createdAt === undefined) {
    throw new Error(`APIキー『${name}』の新しい項目の発行日時を読めません`);
  }
  return { name, plainKey, createdAt };
}

export async function issueApiKey(
  page: Page,
  name: string,
  scopes: ApiKeyScopes,
): Promise<IssuedApiKey> {
  const dialog = page.getByRole('dialog', {
    name: API_KEY_FORM_MESSAGES.issueTitle,
  });
  await pressUntilDialogOpens(
    page.getByRole('button', {
      name: API_KEY_SETTINGS_MESSAGES.issue,
      exact: true,
    }),
    dialog,
  );
  const form = dialog.getByRole('form', {
    name: API_KEY_FORM_MESSAGES.issueTitle,
  });
  await form
    .getByLabel(API_KEY_FORM_MESSAGES.nameLabel, { exact: true })
    .fill(name);
  await chooseScopes(form, scopes);
  await form
    .getByRole('button', {
      name: API_KEY_FORM_MESSAGES.issueSubmit,
      exact: true,
    })
    .click();
  return takePlainKey(page, name, []);
}

// 再発行は同じ名前と権限のキーを加え、元のキーはそのまま残る
export async function reissueApiKey(
  page: Page,
  source: IssuedApiKey,
): Promise<IssuedApiKey> {
  const title = reissueApiKeyTitleOf(source.name);
  const dialog = page.getByRole('dialog', { name: title });
  await pressUntilDialogOpens(
    apiKeyItemOf(page, source).getByRole('button', {
      name: reissueApiKeyLabelOf(source.name),
      exact: true,
    }),
    dialog,
  );
  await dialog
    .getByRole('form', { name: title })
    .getByRole('button', {
      name: API_KEY_CONFIRM_MESSAGES.reissueConfirm,
      exact: true,
    })
    .click();
  return takePlainKey(page, source.name, [source.createdAt]);
}

export async function deleteApiKey(
  page: Page,
  target: IssuedApiKey,
): Promise<void> {
  const title = deleteApiKeyTitleOf(target.name);
  const dialog = page.getByRole('dialog', { name: title });
  await pressUntilDialogOpens(
    apiKeyItemOf(page, target).getByRole('button', {
      name: deleteApiKeyLabelOf(target.name),
      exact: true,
    }),
    dialog,
  );
  await dialog
    .getByRole('form', { name: title })
    .getByRole('button', {
      name: API_KEY_CONFIRM_MESSAGES.deleteConfirm,
      exact: true,
    })
    .click();
  await expect(page.getByText(API_KEY_SETTINGS_MESSAGES.deleted)).toBeVisible();
  await expect(apiKeyItemOf(page, target)).toHaveCount(0);
}

// 詳細ページの説明の区画に、マークダウンを描いた本文が出る
export async function expectProductDescription(
  page: Page,
  handle: string,
  text: string,
): Promise<void> {
  await page.goto(productPagePath(handle));
  await expect(
    page
      .getByRole('region', { name: DESCRIPTION_HEADING, exact: true })
      .getByText(text, { exact: true }),
  ).toBeVisible();
}
