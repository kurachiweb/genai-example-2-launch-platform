import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
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
import { type LogoFieldCurrent, LogoField } from './logo-field.tsx';
import {
  fieldValuesOf,
  fileInputOf,
  renderProductFields,
  submitButton,
  submittedFieldsOf,
  testForm,
} from './product-basic-fields-testing.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const CURRENT_LOGO_ID = '01JC0L0G00000000000000001A';
const UPLOADED_FILE_ID = '01JC0UPL0ADED0000000000001';
const MAX_BYTES = 512_000;

const OVERSIZE_MESSAGE = 'ロゴは500kB以内の画像を選択してください。';
const FORMAT_MESSAGE = 'JPEG・PNG・GIF・WebP・SVGの画像を選択してください。';

const CURRENT_IMAGE = Object.freeze({
  objectKey: '0123456789abcdef'.repeat(2),
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
} as const);

const CURRENT: LogoFieldCurrent = Object.freeze({
  fileId: CURRENT_LOGO_ID,
  image: CURRENT_IMAGE,
  productName: 'Pitch Notes',
  productHandle: 'pitch-notes',
});

const selectButton = () =>
  page.getByRole('button', { name: 'ロゴ(必須) 画像を選択', exact: true });
const replaceButton = () =>
  page.getByRole('button', { name: 'ロゴ(必須) ロゴを差し替え', exact: true });
const currentLogo = () => page.getByRole('img', { name: 'Pitch Notesのロゴ' });
const cropDialog = () => page.getByRole('dialog', { name: '画像の編集' });
const confirmButton = () =>
  cropDialog().getByRole('button', { name: '確定', exact: true });

const renderEdit = () =>
  renderProductFields(
    <LogoField current={CURRENT} disabled={false} />,
    fieldValuesOf({ logoFileId: CURRENT_LOGO_ID }),
  );

const renderNew = () =>
  renderProductFields(<LogoField disabled={false} />, fieldValuesOf());

afterEach(() => {
  vi.unstubAllGlobals();
  applyColorScheme('light');
});

describe('現在のロゴ', () => {
  test('編集では現在のロゴと「ロゴを差し替え」を示し、何も変えなければ現在のロゴのIDを送る', async () => {
    const { onSubmit } = await renderEdit();

    await expect.element(currentLogo()).toBeVisible();
    await expect.element(replaceButton()).toBeEnabled();
    await userEvent.click(submitButton());

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.logoFileId).toBe(CURRENT_LOGO_ID);
  });

  test('ロゴを表示できない時は、名称の頭文字のプレースホルダーを示す', async () => {
    await renderProductFields(
      <LogoField
        current={{ ...CURRENT, image: { ...CURRENT_IMAGE, objectKey: null } }}
        disabled={false}
      />,
      fieldValuesOf({ logoFileId: CURRENT_LOGO_ID }),
    );

    await expect
      .element(testForm().getByText('P', { exact: true }))
      .toBeVisible();
  });

  test('登録では選択のボタン「画像を選択」だけを示し、未設定のまま送るとnullを送る', async () => {
    const { onSubmit } = await renderNew();

    await expect.element(selectButton()).toBeEnabled();
    expect(currentLogo().query()).toBeNull();
    await userEvent.click(submitButton());

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.logoFileId).toBeNull();
  });

  test('FormFieldのdisabledで選択のボタンを無効にする', async () => {
    await renderProductFields(
      <LogoField current={CURRENT} disabled />,
      fieldValuesOf({ logoFileId: CURRENT_LOGO_ID }),
    );

    await expect.element(replaceButton()).toBeDisabled();
  });
});

describe('選択の事前の検査', () => {
  test('500kBを超える画像は、送信せずに超過の文言を示す', async () => {
    const uploads = stubUploadFetch();
    await renderEdit();

    await userEvent.upload(fileInputOf(), [
      createDocumentFile('large.svg', 'image/svg+xml', MAX_BYTES + 1),
    ]);

    await expect.element(testForm().getByText(OVERSIZE_MESSAGE)).toBeVisible();
    await expect
      .element(replaceButton())
      .toHaveAccessibleDescription(OVERSIZE_MESSAGE);
    expect(uploads.calls).toHaveLength(0);
  });

  test('許可されない形式は、送信せずに形式の文言を示す', async () => {
    const uploads = stubUploadFetch();
    await renderNew();

    await userEvent.upload(fileInputOf(), [
      createDocumentFile('logo.pdf', 'application/pdf', 1024),
    ]);

    await expect.element(testForm().getByText(FORMAT_MESSAGE)).toBeVisible();
    await expect.element(cropDialog()).not.toBeInTheDocument();
    expect(uploads.calls).toHaveLength(0);
  });
});

describe('アップロード', () => {
  test('SVG以外は正方形に切り取ってロゴの用途で送り、送る値を差し替える', async () => {
    const uploads = stubUploadFetch();
    const { onSubmit } = await renderEdit();
    const png = await createImageFile('logo.png', 'image/png', {
      width: 800,
      height: 600,
    });

    await userEvent.upload(fileInputOf(), [png]);
    await expect.element(cropDialog()).toBeVisible();
    await expect.element(confirmButton()).toBeEnabled();
    await userEvent.click(confirmButton());
    await expect.poll(() => uploads.pendingCount()).toBe(1);
    const sent = uploads.calls[0];
    expect(sent?.path).toContain('/_bff/uploads/product-logo');
    await uploads.reply(uploadedReply(png, UPLOADED_FILE_ID));
    await expect
      .element(testForm().getByText('アップロード済み').first())
      .toBeVisible();
    expect(currentLogo().query()).toBeNull();
    await userEvent.click(submitButton());

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.logoFileId).toBe(UPLOADED_FILE_ID);
    const edited = await createImageBitmap(sent?.body ?? new Blob());
    expect([edited.width, edited.height]).toEqual([512, 512]);
  });

  test('登録でアップロードすると、選択のボタンを「ロゴを差し替え」にする', async () => {
    const uploads = stubUploadFetch();
    const { onSubmit } = await renderNew();
    const svg = createSvgFile('logo.svg');

    await userEvent.upload(fileInputOf(), [svg]);
    await uploads.reply(uploadedReply(svg, UPLOADED_FILE_ID));

    await expect.element(replaceButton()).toBeEnabled();
    await expect.element(cropDialog()).not.toBeInTheDocument();
    await userEvent.click(submitButton());
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.logoFileId).toBe(UPLOADED_FILE_ID);
  });

  test('想定外の応答には、問い合わせの導線を持つ利用者側の文言を示す', async () => {
    expect(CLIENT_PROFILE.contactAvailable).toBe(true);
    const uploads = stubUploadFetch();
    await renderNew();

    await userEvent.upload(fileInputOf(), [createSvgFile('logo.svg')]);
    await uploads.reply({ status: 500, text: '<html>障害</html>' });

    await expect
      .element(testForm().getByText(UNEXPECTED_ERROR_MESSAGE))
      .toBeVisible();
  });

  test('アップロード中の送信は止め、ロゴを主語にした待つ旨を示す', async () => {
    const uploads = stubUploadFetch();
    const { onSubmit } = await renderNew();
    const svg = createSvgFile('logo.svg');
    await userEvent.upload(fileInputOf(), [svg]);
    await expect.poll(() => uploads.pendingCount()).toBe(1);

    await userEvent.click(submitButton());

    await expect
      .element(selectButton())
      .toHaveAccessibleDescription(
        /ロゴのアップロードが終わってから、もう一度お試しください。/,
      );
    expect(onSubmit).not.toHaveBeenCalled();
    await uploads.reply(uploadedReply(svg, UPLOADED_FILE_ID));
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sで、現在のロゴを示した状態の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderEdit();
      await expect.element(currentLogo()).toBeVisible();

      expect(await runAxe(testForm().element())).toEqual([]);
    },
  );

  test('選択の拒否の文言を出した状態の違反が0件である', async () => {
    await renderNew();
    await userEvent.upload(fileInputOf(), [
      createDocumentFile('large.svg', 'image/svg+xml', MAX_BYTES + 1),
    ]);
    await expect.element(testForm().getByText(OVERSIZE_MESSAGE)).toBeVisible();

    expect(await runAxe(testForm().element())).toEqual([]);
  });
});
