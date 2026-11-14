import { vi } from 'vitest';
import { page } from 'vitest/browser';

import type { TurnstileTokenController } from '../../../lib/components/bot-protection/use-turnstile-token.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { MyProfileView } from './my-profile-view.ts';
import { ProfileEditForm } from './profile-edit-form.tsx';
import type { ProfileFormValues } from './profile-form-schema.ts';

export const MY_PROFILE: MyProfileView = Object.freeze({
  nickname: 'ピッチの作り手',
  handle: 'maker_ai',
  previousHandle: null,
  headline: null,
  bio: null,
  avatar: null,
  websites: [],
  suspended: false,
});

export const myProfileOf = (
  overrides: Partial<MyProfileView> = {},
): MyProfileView => ({ ...MY_PROFILE, ...overrides });

export type SaveMock = ReturnType<
  typeof vi.fn<
    (
      values: ProfileFormValues,
      turnstile: TurnstileTokenController,
    ) => Promise<void>
  >
>;

export async function renderProfileEditForm(
  profile: MyProfileView = MY_PROFILE,
  onSave: SaveMock = vi.fn(() => Promise.resolve()),
) {
  await renderInRouter(<ProfileEditForm profile={profile} onSave={onSave} />, {
    path: '/settings/profile',
  });
  return { onSave };
}

export const profileForm = () =>
  page.getByRole('form', { name: 'プロフィールの編集' });
export const nicknameInput = () =>
  page.getByRole('textbox', { name: 'ニックネーム(必須)' });
export const handleInput = () =>
  page.getByRole('textbox', { name: 'ハンドル(必須)' });
export const headlineInput = () =>
  page.getByRole('textbox', { name: 'ヘッドライン' });
export const saveButton = () =>
  page.getByRole('button', { name: '保存', exact: true });

export function fileInputOf(): HTMLInputElement {
  const input = profileForm()
    .element()
    .querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('ファイルの入力欄が描画されていません。');
  }
  return input;
}
