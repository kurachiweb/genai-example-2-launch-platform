import { expect, type Locator, type Page } from '@playwright/test';

import {
  IMAGE_DIALOG_COPY,
  imageActionName,
  MODERATION_CHANGED_MESSAGES,
  QUARANTINED_IMAGE_LIST_CAPTION,
  quarantineReasonsText,
  userImageOwnerLabel,
} from '../../apps/admin/src/components/moderation/shared/moderation-messages.ts';
import { mediaPurposeLabel } from '../../apps/common-lib/moderation/moderation-labels.ts';
import { USER_AVATAR_PURPOSE } from '../../apps/common-lib/profile/profile-input-rules.ts';
import type { TestAccount } from '../client/auth/account-steps.ts';
import {
  openProfileEditor,
  readCurrentHandle,
  registerVerifiedAccount,
  saveProfile,
} from '../client/profile-steps.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { uploadCroppedImage } from '../support/image-upload.ts';

const MEDIA_MODERATION_PATH = '/media-moderation';

// ローカル・CIの代替の判定は、判定用画像が99×99の正方形のときに不適切と判定する。正方形の画像は切り抜きのダイアログの既定の範囲で寸法を変えずに送られる
const AUTO_QUARANTINED_IMAGE_SIZE_PX = 99;

const QUARANTINED_AVATAR_FILE_NAME = 'e2e-quarantined-avatar.png';

// アップロードの後の判定はイベントサーバーのキューの処理を待つため、画面の読み込み直しの待ちより長く待つ
const AUTO_MODERATION_TIMEOUT_MS = 60_000;

const PLACEHOLDER_SELECTOR = '[data-slot="media-placeholder"]';

const AVATAR_PURPOSE_LABEL = mediaPurposeLabel(USER_AVATAR_PURPOSE);

export interface QuarantinedAvatarOwner {
  readonly nickname: string;
  readonly handle: string;
}

// メールアドレスの確認まで済ませた利用者が、代替の判定で隔離される寸法のプロフィール画像を登録し、プロフィールを保存する
export async function registerAutoQuarantinedAvatar(
  page: Page,
  account: TestAccount,
): Promise<QuarantinedAvatarOwner> {
  await registerVerifiedAccount(page, account);
  const form = await openProfileEditor(page, account);
  const handle = await readCurrentHandle(form);
  await uploadCroppedImage(page, form, {
    fileName: QUARANTINED_AVATAR_FILE_NAME,
    sizePx: AUTO_QUARANTINED_IMAGE_SIZE_PX,
  });
  await saveProfile(page, form);
  return { nickname: account.nickname, handle };
}

const ownerLabelOf = ({ nickname, handle }: QuarantinedAvatarOwner): string =>
  userImageOwnerLabel(nickname, handle);

const approveButtonOf = (
  scope: Page | Locator,
  owner: QuarantinedAvatarOwner,
): Locator =>
  scope.getByRole('button', {
    name: imageActionName(
      'image.approve',
      ownerLabelOf(owner),
      AVATAR_PURPOSE_LABEL,
    ),
    exact: true,
  });

export const quarantinedAvatarCardOf = (
  page: Page,
  owner: QuarantinedAvatarOwner,
): Locator =>
  page
    .getByRole('main')
    .getByRole('list', { name: QUARANTINED_IMAGE_LIST_CAPTION, exact: true })
    .getByRole('listitem')
    .filter({ hasText: ownerLabelOf(owner) })
    .filter({ has: approveButtonOf(page, owner) });

// 画像モデレーションの既定のタブ(自動判定)に、判定を終えた利用者のプロフィール画像が自動判定の理由で出るまで読み込み直す
export async function openAutoQuarantinedAvatar(
  page: Page,
  owner: QuarantinedAvatarOwner,
): Promise<Locator> {
  await page.goto(MEDIA_MODERATION_PATH);
  const card = quarantinedAvatarCardOf(page, owner);
  await expect(async () => {
    try {
      await expect(card).toHaveCount(1, { timeout: REACTION_TIMEOUT_MS });
    } catch (error) {
      await page.reload();
      throw error;
    }
  }).toPass({ timeout: AUTO_MODERATION_TIMEOUT_MS });
  await expect(card).toContainText(AVATAR_PURPOSE_LABEL);
  await expect(card).toContainText(quarantineReasonsText(['auto']));
  return card;
}

// 隔離画像は管理者側と同じオリジンの中継の経路から配信され、読み込めない時は代わりの表示になるため、実際の画像の要素が画素を持つことで確かめる
export async function expectQuarantinedImageLoaded(
  card: Locator,
): Promise<void> {
  const image = card.locator('img');
  await image.scrollIntoViewIfNeeded();
  await expect(card.locator(PLACEHOLDER_SELECTOR)).toHaveCount(0);
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) => element.complete && element.naturalWidth,
      ),
    )
    .toBe(AUTO_QUARANTINED_IMAGE_SIZE_PX);
}

// 開いた直後はハイドレーションの前に押した操作が効かないため、確認のダイアログが開くまで押し直してから、理由を空のまま公開を承認する
export async function approveQuarantinedAvatar(
  page: Page,
  card: Locator,
  owner: QuarantinedAvatarOwner,
): Promise<void> {
  const copy = IMAGE_DIALOG_COPY['image.approve'];
  const dialog = page.getByRole('dialog', { name: copy.title, exact: true });
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await approveButtonOf(card, owner).click();
    }
    await expect(dialog).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await dialog
    .getByRole('button', { name: copy.confirmLabel, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(MODERATION_CHANGED_MESSAGES['image.approve'], {
      exact: true,
    }),
  ).toBeVisible();
  await expect(quarantinedAvatarCardOf(page, owner)).toHaveCount(0);
}
