import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import {
  stubUploadFetch,
  uploadedReply,
} from '../../../lib/test/fake-upload-fetch.ts';
import {
  createDocumentFile,
  createImageFile,
  createSvgFile,
} from '../../../lib/test/media-files.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import {
  fileInputOf,
  myProfileOf,
  profileForm,
  renderProfileEditForm,
  saveButton,
} from './profile-edit-form-testing.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const CURRENT_AVATAR_ID = '01JC0AVATAR000000000000001';
const UPLOADED_FILE_ID = '01JC0UPL0ADED0000000000001';

const CURRENT_AVATAR = Object.freeze({
  id: CURRENT_AVATAR_ID,
  objectKey: '0123456789abcdef'.repeat(2),
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
} as const);

const OVERSIZE_MESSAGE =
  'プロフィール画像は500kB以内の画像を選択してください。';
const FORMAT_MESSAGE = 'JPEG・PNG・GIF・WebP・SVGの画像を選択してください。';
const MAX_BYTES = 512_000;

const EDITED_OVERSIZE_MESSAGE =
  '編集後の画像が500kBを超えました。切り取る範囲を狭めるか、別の画像を選択してください。';

// PNGは可逆圧縮のため、乱数の画素の画像は切り取り後も上限を超える
async function createNoisePng(name: string): Promise<File> {
  const size = 512;
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('見本の画像を描けません。');
  }
  const pixels = context.createImageData(size, size);
  crypto.getRandomValues(pixels.data.subarray(0, 65_536));
  for (let offset = 65_536; offset < pixels.data.length; offset += 65_536) {
    crypto.getRandomValues(pixels.data.subarray(offset, offset + 65_536));
  }
  for (let index = 3; index < pixels.data.length; index += 4) {
    pixels.data[index] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new File([blob], name, { type: 'image/png' });
}

const selectButton = () =>
  page.getByRole('button', {
    name: 'プロフィール画像 画像を選択',
    exact: true,
  });
const removeButton = () =>
  page.getByRole('button', { name: '画像を削除', exact: true });
const currentAvatar = () =>
  page.getByRole('img', { name: 'ピッチの作り手のプロフィール画像' });
const cropDialog = () => page.getByRole('dialog', { name: '画像の編集' });
const confirmButton = () =>
  cropDialog().getByRole('button', { name: '確定', exact: true });

const avatarProfile = () => myProfileOf({ avatar: CURRENT_AVATAR });

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  vi.unstubAllGlobals();
  applyColorScheme('light');
});

describe('現在の画像', () => {
  test('設定済みなら現在の画像と「画像を削除」を示す', async () => {
    await renderProfileEditForm(avatarProfile());

    await expect.element(currentAvatar()).toBeInTheDocument();
    await expect.element(removeButton()).toBeEnabled();
    await expect.element(selectButton()).toBeEnabled();
  });

  test('未設定なら、ニックネームの頭文字のプレースホルダーを示し「画像を削除」を出さない', async () => {
    await renderProfileEditForm(myProfileOf({ avatar: null }));

    await expect.element(selectButton()).toBeVisible();
    expect(removeButton().query()).toBeNull();
    await expect
      .element(profileForm().getByText('ピ', { exact: true }))
      .toBeVisible();
  });

  test('何も変えずに保存すると、現在の画像のIDをそのまま渡す', async () => {
    const { onSave } = await renderProfileEditForm(avatarProfile());

    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].avatarFileId).toBe(CURRENT_AVATAR_ID);
  });

  test('未設定のまま保存すると、画像をnullで渡す', async () => {
    const { onSave } = await renderProfileEditForm(myProfileOf());

    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].avatarFileId).toBeNull();
  });
});

describe('画像の選択の事前の検査', () => {
  test('500kBを超える画像は、送信せずに超過の文言を示す', async () => {
    const uploads = stubUploadFetch();
    await renderProfileEditForm(avatarProfile());

    await userEvent.upload(fileInputOf(), [
      createDocumentFile('large.svg', 'image/svg+xml', MAX_BYTES + 1),
    ]);

    await expect
      .element(profileForm().getByText(OVERSIZE_MESSAGE))
      .toBeVisible();
    await expect.element(cropDialog()).not.toBeInTheDocument();
    expect(uploads.calls).toHaveLength(0);
    await expect
      .element(selectButton())
      .toHaveAccessibleDescription(OVERSIZE_MESSAGE);
  });

  test('切り取りの後に500kBを超えた画像は、送信せずに編集後の超過の文言を示す', async () => {
    const uploads = stubUploadFetch();
    await renderProfileEditForm(avatarProfile());

    await userEvent.upload(fileInputOf(), [await createNoisePng('noise.png')]);
    await expect.element(confirmButton()).toBeEnabled();
    await userEvent.click(confirmButton());

    await expect
      .element(profileForm().getByText(EDITED_OVERSIZE_MESSAGE))
      .toBeVisible();
    expect(uploads.calls).toHaveLength(0);
  });

  test('許可されない形式の画像は、送信せずに形式の文言を示す', async () => {
    const uploads = stubUploadFetch();
    await renderProfileEditForm(avatarProfile());

    await userEvent.upload(fileInputOf(), [
      createDocumentFile('guide.pdf', 'application/pdf', 1024),
    ]);

    await expect.element(profileForm().getByText(FORMAT_MESSAGE)).toBeVisible();
    expect(uploads.calls).toHaveLength(0);
  });

  test('拒否された選択では、保存の値の画像を変えない', async () => {
    stubUploadFetch();
    const { onSave } = await renderProfileEditForm(avatarProfile());
    await userEvent.upload(fileInputOf(), [
      createDocumentFile('large.svg', 'image/svg+xml', MAX_BYTES + 1),
    ]);
    await expect
      .element(profileForm().getByText(OVERSIZE_MESSAGE))
      .toBeVisible();

    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].avatarFileId).toBe(CURRENT_AVATAR_ID);
  });
});

describe('画像のアップロード', () => {
  test('SVG以外は正方形の切り取りの編集を経て、プロフィール画像の用途でアップロードし、保存の値に渡す', async () => {
    const uploads = stubUploadFetch();
    const { onSave } = await renderProfileEditForm(avatarProfile());
    const png = await createImageFile('face.png', 'image/png', {
      width: 400,
      height: 300,
    });

    await userEvent.upload(fileInputOf(), [png]);
    await expect.element(cropDialog()).toBeVisible();
    await expect
      .element(cropDialog())
      .toHaveAccessibleDescription(
        'face.pngの切り取る範囲を、位置と拡大率で調整してください。',
      );
    await expect.element(confirmButton()).toBeEnabled();
    await userEvent.click(confirmButton());
    await expect.poll(() => uploads.pendingCount()).toBe(1);
    const sent = uploads.calls[0];
    expect(sent?.path).toContain('/_bff/uploads/user-avatar');
    await uploads.reply(uploadedReply(png, UPLOADED_FILE_ID));
    await expect
      .element(profileForm().getByText('アップロード済み').first())
      .toBeVisible();
    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].avatarFileId).toBe(UPLOADED_FILE_ID);
    const edited = await createImageBitmap(sent?.body ?? new Blob());
    expect([edited.width, edited.height]).toEqual([300, 300]);
  });

  test('SVGは編集せずにアップロードする', async () => {
    const uploads = stubUploadFetch();
    const { onSave } = await renderProfileEditForm(myProfileOf());
    const svg = createSvgFile('logo.svg');

    await userEvent.upload(fileInputOf(), [svg]);
    await uploads.reply(uploadedReply(svg, UPLOADED_FILE_ID));
    await expect.element(cropDialog()).not.toBeInTheDocument();
    await expect
      .element(profileForm().getByText('アップロード済み').first())
      .toBeVisible();
    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].avatarFileId).toBe(UPLOADED_FILE_ID);
  });

  test('切り取りを取り消すと、何も送らず保存の値も変えない', async () => {
    const uploads = stubUploadFetch();
    const { onSave } = await renderProfileEditForm(avatarProfile());
    await userEvent.upload(fileInputOf(), [
      await createImageFile('face.png', 'image/png', { width: 64, height: 64 }),
    ]);
    await expect.element(confirmButton()).toBeEnabled();

    await userEvent.click(
      cropDialog().getByRole('button', { name: 'キャンセル', exact: true }),
    );
    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(uploads.calls).toHaveLength(0);
    expect(onSave.mock.calls[0]?.[0].avatarFileId).toBe(CURRENT_AVATAR_ID);
  });

  test('想定外の応答には、問い合わせの導線を持つ利用者側の文言を示す', async () => {
    expect(CLIENT_PROFILE.contactAvailable).toBe(true);
    const uploads = stubUploadFetch();
    await renderProfileEditForm(myProfileOf());
    const svg = createSvgFile('logo.svg');

    await userEvent.upload(fileInputOf(), [svg]);
    await uploads.reply({ status: 500, text: '<html>障害</html>' });

    await expect
      .element(profileForm().getByText(UNEXPECTED_ERROR_MESSAGE))
      .toBeVisible();
  });

  test('アップロード中の保存は送らず、画像の欄に待つ旨を示す', async () => {
    const uploads = stubUploadFetch();
    const { onSave } = await renderProfileEditForm(avatarProfile());
    const svg = createSvgFile('logo.svg');
    await userEvent.upload(fileInputOf(), [svg]);
    await expect.poll(() => uploads.pendingCount()).toBe(1);

    await userEvent.click(saveButton());

    await expect
      .element(selectButton())
      .toHaveAccessibleDescription(
        /プロフィール画像のアップロードが終わってから、もう一度お試しください。/,
      );
    expect(onSave).not.toHaveBeenCalled();
    await uploads.reply(uploadedReply(svg, UPLOADED_FILE_ID));
  });
});

describe('画像の削除', () => {
  test('「画像を削除」を押すと画像を未設定に戻し、保存の値の画像をnullにする', async () => {
    const { onSave } = await renderProfileEditForm(avatarProfile());

    await userEvent.click(removeButton());

    expect(removeButton().query()).toBeNull();
    await expect.element(selectButton()).toHaveFocus();
    await userEvent.click(saveButton());
    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].avatarFileId).toBeNull();
  });

  test('アップロードした画像を取り消して未設定に戻せる', async () => {
    const uploads = stubUploadFetch();
    const { onSave } = await renderProfileEditForm(avatarProfile());
    const svg = createSvgFile('logo.svg');
    await userEvent.upload(fileInputOf(), [svg]);
    await uploads.reply(uploadedReply(svg, UPLOADED_FILE_ID));
    await expect.element(removeButton()).toBeEnabled();

    await userEvent.click(removeButton());
    await userEvent.click(saveButton());

    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0].avatarFileId).toBeNull();
    expect(profileForm().getByText('アップロード済み').query()).toBeNull();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sで、現在の画像を示した状態の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderProfileEditForm(avatarProfile());
      await expect.element(removeButton()).toBeVisible();

      expect(await runAxe(profileForm().element())).toEqual([]);
    },
  );

  test('選択の拒否の文言を出した状態の違反が0件である', async () => {
    await renderProfileEditForm(avatarProfile());
    await userEvent.upload(fileInputOf(), [
      createDocumentFile('large.svg', 'image/svg+xml', MAX_BYTES + 1),
    ]);
    await expect
      .element(profileForm().getByText(OVERSIZE_MESSAGE))
      .toBeVisible();

    expect(await runAxe(profileForm().element())).toEqual([]);
  });
});
