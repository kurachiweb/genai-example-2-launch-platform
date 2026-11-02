import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import '../../styles/base.css';
import { reportUnexpectedErrorInBrowser } from '../../start/observability/browser-error-reporting.ts';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import {
  errorReply,
  stubUploadFetch,
  uploadedFileOf,
  uploadedReply,
  type UploadFetchStub,
} from '../../test/fake-upload-fetch.ts';
import {
  createImageFile,
  createSvgFile,
  decodeImage,
} from '../../test/media-files.ts';
import type { ImageEditOptions } from '../../utilities/media/crop-geometry.ts';
import type { UploadConstraints } from '../../utilities/media/upload-constraints.ts';
import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { FormField } from '../form/form-field.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import {
  ImageUploadField,
  type ImageUploadFieldProps,
} from './image-upload-field.tsx';

vi.mock('../../start/observability/browser-error-reporting.ts', { spy: true });

const LABEL = '画像を選択';

const LOGO: UploadConstraints = {
  purpose: 'product-logo',
  allowedTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ],
  maxBytes: 512_000,
  subjectLabel: 'ロゴ',
};

const SCREENSHOTS: UploadConstraints = {
  purpose: 'product-screenshot',
  allowedTypes: ['image/jpeg', 'image/png', 'image/svg+xml'],
  maxBytes: 5_242_880,
  subjectLabel: 'スクリーンショット',
  maxCount: 3,
};

const SQUARE: ImageEditOptions = { aspect: 1, maxLongSide: 256 };

const UNEXPECTED_WITH_CONTACT =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const UNEXPECTED_WITHOUT_CONTACT =
  'ページを表示できませんでした。時間をおいて再度お試しください。';

const CONTACT_PROMPT = '解決しない場合はお問い合わせください。';

type UploadedMock = ReturnType<
  typeof vi.fn<(files: readonly UploadedFile[]) => void>
>;

const selectButton = () =>
  page.getByRole('button', { name: LABEL, exact: true });
const dialog = () => page.getByRole('dialog', { name: '画像の編集' });
const confirmButton = () =>
  dialog().getByRole('button', { name: '確定', exact: true });
const retryButton = () =>
  page.getByRole('button', { name: '再試行', exact: true });
const listItems = () =>
  page.getByRole('list', { name: '選択したファイル' }).getByRole('listitem');

async function renderField(
  props: Partial<ImageUploadFieldProps> = {},
): Promise<{
  readonly container: HTMLElement;
  readonly onUploaded: UploadedMock;
}> {
  const onUploaded: UploadedMock = vi.fn();
  const { container } = await render(
    <div className="bg-background p-4 text-foreground">
      <ImageUploadField
        label={LABEL}
        constraints={LOGO}
        edit={SQUARE}
        contactAvailable
        onUploaded={onUploaded}
        {...props}
      />
    </div>,
  );
  return { container, onUploaded };
}

// 選択の画面を経たファイルはブラウザが作り直した別のオブジェクトになるため、名前・形式・内容で同じファイルかを確かめる
async function expectSameFile(actual: Blob | undefined, expected: File) {
  expect(actual).toBeInstanceOf(File);
  expect(actual instanceof File ? actual.name : undefined).toBe(expected.name);
  expect(actual?.type).toBe(expected.type);
  expect(await actual?.text()).toBe(await expected.text());
}

function fileInputOf(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('ファイルの入力欄が描画されていません。');
  }
  return input;
}

function liveRegionOf(container: HTMLElement): HTMLElement {
  const region = container.querySelector<HTMLElement>(
    '[data-slot="upload-field-status"]',
  );
  if (region === null) {
    throw new Error('送信の状態の読み上げの領域が描画されていません。');
  }
  return region;
}

function dropOn(container: HTMLElement, files: readonly File[]) {
  const zone = container.querySelector('[data-slot="file-drop-zone"]');
  if (zone === null) {
    throw new Error('ドロップの領域が描画されていません。');
  }
  const transfer = new DataTransfer();
  for (const file of files) {
    transfer.items.add(file);
  }
  for (const type of ['dragenter', 'dragover', 'drop'] as const) {
    zone.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }
}

async function confirmCrop() {
  await expect.element(confirmButton()).toBeEnabled();
  await userEvent.click(confirmButton());
}

async function sentBodyAt(
  fetch: UploadFetchStub,
  index: number,
): Promise<File> {
  await expect.poll(() => fetch.calls.length).toBeGreaterThan(index);
  const body = fetch.calls[index]?.body;
  if (!(body instanceof File)) {
    throw new TypeError('送ったファイルがありません。');
  }
  return body;
}

beforeEach(() => {
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  applyColorScheme('light');
});

describe('ImageUploadField', () => {
  test('acceptが用途の許可形式になる', async () => {
    const { container } = await renderField();

    expect(fileInputOf(container).accept).toBe(
      'image/jpeg,image/png,image/gif,image/webp,image/svg+xml',
    );
  });

  test.each([
    ['image/png', 'photo.png'],
    ['image/jpeg', 'photo.jpg'],
  ] as const)(
    '%sの画像は編集ダイアログを経て、最大寸法以下の同じ系統の形式に作り直したファイルを送る',
    async (type, name) => {
      const fetch = stubUploadFetch();
      const original = await createImageFile(name, type, {
        width: 800,
        height: 600,
      });
      const { container, onUploaded } = await renderField();

      await userEvent.upload(fileInputOf(container), [original]);
      await expect
        .element(dialog())
        .toHaveAccessibleDescription(
          `${name}の切り取る範囲を、位置と拡大率で調整してください。`,
        );
      await confirmCrop();

      const sent = await sentBodyAt(fetch, 0);
      expect(sent).not.toBe(original);
      expect(sent.type).toBe(type);
      expect(fetch.calls[0]?.contentType).toBe(type);
      const image = await decodeImage(sent);
      expect(image.width).toBe(256);
      expect(image.height).toBe(256);

      await fetch.reply(
        uploadedReply(sent, 'file-1', { width: 256, height: 256 }),
      );
      await expect
        .poll(() => onUploaded.mock.calls)
        .toEqual([
          [[uploadedFileOf(sent, 'file-1', { width: 256, height: 256 })]],
        ]);
    },
  );

  test('作り直した画像が上限を超えると送らず、切り取る範囲を狭めるか別の画像を選ぶよう案内する', async () => {
    const fetch = stubUploadFetch();
    const original = await createImageFile('photo.png', 'image/png', {
      width: 800,
      height: 800,
    });
    const { container } = await renderField({
      constraints: { ...LOGO, maxBytes: 1024 },
    });

    await userEvent.upload(fileInputOf(container), [original]);
    await confirmCrop();

    const message =
      '編集後の画像が1kBを超えました。切り取る範囲を狭めるか、別の画像を選択してください。';
    await expect.element(page.getByText(message)).toBeInTheDocument();
    await expect
      .element(selectButton())
      .toHaveAttribute('aria-invalid', 'true');
    await expect.element(selectButton()).toHaveAccessibleDescription(message);
    expect(fetch.calls).toHaveLength(0);
  });

  test('SVGは編集ダイアログを経ずに選んだファイルをそのまま送り、成功でプレビューを出す', async () => {
    const fetch = stubUploadFetch();
    const svg = createSvgFile('logo.svg');
    const { container, onUploaded } = await renderField();

    await userEvent.upload(fileInputOf(container), [svg]);

    await expectSameFile(await sentBodyAt(fetch, 0), svg);
    expect(dialog().query()).toBeNull();
    await fetch.reply(uploadedReply(svg, 'file-1'));

    await expect.element(listItems().nth(0)).toHaveTextContent('logo.svg');
    await expect
      .element(listItems().nth(0))
      .toHaveTextContent('アップロード済み');
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    expect(onUploaded).toHaveBeenCalledExactlyOnceWith([
      uploadedFileOf(svg, 'file-1'),
    ]);
    await expect
      .element(liveRegionOf(container))
      .toHaveTextContent('logo.svgをアップロードしました。');
  });

  test('SVGは選んだファイルのサイズで上限を判定し、超えると送らない', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField({
      constraints: { ...LOGO, maxBytes: 10 },
    });

    await userEvent.upload(fileInputOf(container), [createSvgFile('logo.svg')]);

    await expect
      .element(page.getByText('ロゴは0.1kB以内の画像を選択してください。'))
      .toBeInTheDocument();
    expect(dialog().query()).toBeNull();
    expect(fetch.calls).toHaveLength(0);
  });

  test('許可外の形式はダイアログを開かずにエラーを示す', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField({
      constraints: { ...LOGO, allowedTypes: ['image/png', 'image/svg+xml'] },
    });

    dropOn(container, [
      await createImageFile('photo.jpg', 'image/jpeg', { width: 8, height: 8 }),
    ]);

    await expect
      .element(page.getByText('PNG・SVGの画像を選択してください。'))
      .toBeInTheDocument();
    expect(dialog().query()).toBeNull();
    expect(fetch.calls).toHaveLength(0);
  });

  test('1件だけの欄に複数のファイルをドロップすると、個数の違反を示して送らない', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField();

    dropOn(container, [createSvgFile('a.svg'), createSvgFile('b.svg')]);

    await expect
      .element(page.getByText('画像は1枚以内で選択してください。'))
      .toBeInTheDocument();
    expect(fetch.calls).toHaveLength(0);
  });

  test('複数の画像は1枚ずつ編集し、選んだ順に1件ずつ送る', async () => {
    const fetch = stubUploadFetch();
    const first = await createImageFile('a.png', 'image/png', {
      width: 300,
      height: 200,
    });
    const svg = createSvgFile('b.svg');
    const third = await createImageFile('c.jpg', 'image/jpeg', {
      width: 200,
      height: 300,
    });
    const { container, onUploaded } = await renderField({
      constraints: SCREENSHOTS,
      multiple: true,
    });

    await userEvent.upload(fileInputOf(container), [first, svg, third]);
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        'a.pngの切り取る範囲を、位置と拡大率で調整してください。',
      );
    await confirmCrop();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        'c.jpgの切り取る範囲を、位置と拡大率で調整してください。',
      );
    expect(fetch.calls).toHaveLength(0);
    await confirmCrop();

    const sentFirst = await sentBodyAt(fetch, 0);
    expect(sentFirst.type).toBe('image/png');
    expect(fetch.calls).toHaveLength(1);
    await expect.element(listItems().nth(0)).toHaveTextContent('送信中');
    await expect.element(listItems().nth(1)).toHaveTextContent('送信待ち');
    await fetch.reply(uploadedReply(sentFirst, 'file-1'));
    await expectSameFile(await sentBodyAt(fetch, 1), svg);
    await fetch.reply(uploadedReply(svg, 'file-2'));
    const sentThird = await sentBodyAt(fetch, 2);
    expect(sentThird.type).toBe('image/jpeg');
    await fetch.reply(uploadedReply(sentThird, 'file-3'));

    await expect
      .poll(() => onUploaded.mock.calls)
      .toEqual([
        [
          [
            uploadedFileOf(sentFirst, 'file-1'),
            uploadedFileOf(svg, 'file-2'),
            uploadedFileOf(sentThird, 'file-3'),
          ],
        ],
      ]);
    await expect
      .element(liveRegionOf(container))
      .toHaveTextContent('a.png、b.svg、c.jpgの3件をアップロードしました。');
  });

  test('ドラッグ&ドロップで選んで編集を取り消すと、送らずに選択のボタンへフォーカスを戻す', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField();

    dropOn(container, [
      await createImageFile('photo.png', 'image/png', {
        width: 64,
        height: 64,
      }),
    ]);
    await expect.element(confirmButton()).toBeEnabled();
    await userEvent.keyboard('{Escape}');

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(selectButton()).toHaveFocus();
    expect(fetch.calls).toHaveLength(0);
  });

  test('送信中は通知の領域で伝え、選択のボタンを処理中にする', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField();

    await userEvent.upload(fileInputOf(container), [createSvgFile('logo.svg')]);

    await expect
      .element(liveRegionOf(container))
      .toHaveTextContent('logo.svgを送信しています。');
    expect(liveRegionOf(container).getAttribute('aria-live')).toBe('polite');
    await expect.element(selectButton()).toHaveAttribute('aria-busy', 'true');
    await expect
      .element(selectButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(listItems().nth(0)).toHaveTextContent('送信中');
    expect(fetch.calls).toHaveLength(1);
  });

  test('サーバーが拒否すると文言を示して選び直せる状態に戻し、選び直したファイルを送る', async () => {
    const fetch = stubUploadFetch();
    const { container, onUploaded } = await renderField();
    const message = 'JPEG・PNG・GIF・WebP・SVGの画像を選択してください。';

    await userEvent.upload(fileInputOf(container), [createSvgFile('logo.svg')]);
    await fetch.reply(errorReply(415, 'unsupported_media_type'));

    await expect.element(page.getByText(message)).toBeInTheDocument();
    await expect.element(liveRegionOf(container)).toHaveTextContent(message);
    await expect.element(selectButton()).toHaveAccessibleDescription(message);
    await expect.element(selectButton()).not.toHaveAttribute('aria-disabled');
    expect(retryButton().query()).toBeNull();

    const again = createSvgFile('logo-2.svg');
    await userEvent.upload(fileInputOf(container), [again]);
    await expectSameFile(await sentBodyAt(fetch, 1), again);
    await fetch.reply(uploadedReply(again, 'file-2'));

    await expect.element(page.getByText(message)).not.toBeInTheDocument();
    await expect.element(selectButton()).not.toHaveAttribute('aria-invalid');
    await expect
      .poll(() => onUploaded.mock.calls)
      .toEqual([[[uploadedFileOf(again, 'file-2')]]]);
  });

  test('一時的に利用できない時は同じファイルで再試行でき、再試行の後は選択のボタンへフォーカスを移す', async () => {
    const fetch = stubUploadFetch();
    const svg = createSvgFile('logo.svg');
    const { container, onUploaded } = await renderField();

    await userEvent.upload(fileInputOf(container), [svg]);
    await fetch.reply(
      errorReply(
        503,
        'upstream_unavailable',
        '現在ご利用いただけません。時間をおいて再度お試しください。',
      ),
    );

    await expect
      .element(
        page.getByText(
          '現在ご利用いただけません。時間をおいて再度お試しください。',
        ),
      )
      .toBeInTheDocument();
    await userEvent.click(retryButton());

    await expectSameFile(await sentBodyAt(fetch, 1), svg);
    await expect.element(selectButton()).toHaveFocus();
    await fetch.reply(uploadedReply(svg, 'file-1'));
    await expect
      .poll(() => onUploaded.mock.calls)
      .toEqual([[[uploadedFileOf(svg, 'file-1')]]]);
    expect(retryButton().query()).toBeNull();
  });

  test.each([
    [true, UNEXPECTED_WITH_CONTACT],
    [false, UNEXPECTED_WITHOUT_CONTACT],
  ])(
    '問い合わせの導線が%sの画面では、想定外の応答をその文言で示す',
    async (contactAvailable, message) => {
      const fetch = stubUploadFetch();
      const { container } = await renderField({ contactAvailable });

      await userEvent.upload(fileInputOf(container), [
        createSvgFile('logo.svg'),
      ]);
      await fetch.reply(errorReply(404, 'upload_purpose_not_found'));

      await expect
        .element(page.getByText(message, { exact: true }))
        .toBeInTheDocument();
      expect(container.textContent.includes(CONTACT_PROMPT)).toBe(
        contactAvailable,
      );
      expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledOnce();
    },
  );

  test.each([
    [
      403,
      'csrf_rejected',
      'この操作を受け付けられませんでした。ページを再読み込みして再度お試しください。',
    ],
    [
      500,
      'internal_error',
      '問題が発生しました。時間をおいて再度お試しください。',
    ],
  ])(
    '設計の表に無い%dの%sは、共通のエラー形式の文言をそのまま欄に示す',
    async (status, code, message) => {
      const fetch = stubUploadFetch();
      const { container } = await renderField({ contactAvailable: false });

      await userEvent.upload(fileInputOf(container), [
        createSvgFile('logo.svg'),
      ]);
      await fetch.reply(errorReply(status, code, message));

      await expect
        .element(page.getByText(message, { exact: true }))
        .toBeInTheDocument();
      await expect.element(liveRegionOf(container)).toHaveTextContent(message);
      await expect.element(selectButton()).toHaveAccessibleDescription(message);
      expect(retryButton().query()).toBeNull();
    },
  );

  test.each([
    ['JSONでない本文', { status: 502, text: '<html>Bad Gateway</html>' }],
    ['文言が空の本文', errorReply(403, 'csrf_rejected', '')],
  ] as const)('%sは、想定外の文言を欄に示す', async (_, reply) => {
    const fetch = stubUploadFetch();
    const { container } = await renderField();

    await userEvent.upload(fileInputOf(container), [createSvgFile('logo.svg')]);
    await fetch.reply(reply);

    await expect
      .element(page.getByText(UNEXPECTED_WITH_CONTACT, { exact: true }))
      .toBeInTheDocument();
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledOnce();
  });

  test('無効の間は選択できない', async () => {
    await renderField({ disabled: true });

    await expect.element(selectButton()).toBeDisabled();
  });

  test('フォームの欄に置くと、欄のラベルとボタンの文言を名前にし、欄の説明と送信のエラーを結び付ける', async () => {
    const fetch = stubUploadFetch();
    const schema = z.object({ logo: z.string() });
    function LogoForm() {
      const form = useAppForm(schema, { defaultValues: { logo: '' } });
      const [fileId, setFileId] = useState('');
      return (
        <AppForm
          form={form}
          onSubmit={() => undefined}
          onSubmitError={() => undefined}
          aria-label="プロダクト"
        >
          <FormField
            control={form.control}
            name="logo"
            label="ロゴ"
            description="正方形で表示します。"
          >
            {(control) => (
              <ImageUploadField
                ref={control.ref}
                label={LABEL}
                constraints={LOGO}
                edit={SQUARE}
                contactAvailable
                onUploaded={([uploaded]) => {
                  control.onChange(uploaded?.fileId ?? '');
                  setFileId(uploaded?.fileId ?? '');
                }}
                aria-labelledby={control.labelId}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
              />
            )}
          </FormField>
          <output>{fileId}</output>
        </AppForm>
      );
    }
    const { container } = await render(<LogoForm />);
    const named = page.getByRole('button', {
      name: `ロゴ ${LABEL}`,
      exact: true,
    });

    await expect.element(named).toBeInTheDocument();
    await expect
      .element(named)
      .toHaveAccessibleDescription('正方形で表示します。');

    await userEvent.upload(fileInputOf(container), [createSvgFile('logo.svg')]);
    await fetch.reply(errorReply(422, 'invalid_svg'));
    await expect
      .element(named)
      .toHaveAccessibleDescription(
        '正方形で表示します。 ファイルを読み込めませんでした。ファイルが壊れていないか確認して、もう一度選択してください。',
      );
    expect(await runAxe(container)).toStrictEqual([]);

    const svg = createSvgFile('logo-2.svg');
    await userEvent.upload(fileInputOf(container), [svg]);
    await fetch.reply(uploadedReply(svg, 'file-9'));
    await expect.element(page.getByRole('status')).toHaveTextContent('file-9');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('待ち・エラー・送信済み・編集中のどれでもアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const fetch = stubUploadFetch();
      const { container } = await renderField({
        constraints: SCREENSHOTS,
        multiple: true,
      });

      expect(await runAxe(container)).toStrictEqual([]);

      await userEvent.upload(fileInputOf(container), [createSvgFile('a.svg')]);
      await fetch.reply(errorReply(503, 'storage_unavailable'));
      await expect.element(retryButton()).toBeInTheDocument();

      expect(await runAxe(container)).toStrictEqual([]);

      await userEvent.click(retryButton());
      await fetch.reply(uploadedReply(createSvgFile('a.svg'), 'file-1'));
      await expect
        .element(listItems().nth(0))
        .toHaveTextContent('アップロード済み');

      expect(await runAxe(container)).toStrictEqual([]);

      await userEvent.upload(fileInputOf(container), [
        await createImageFile('b.png', 'image/png', { width: 64, height: 64 }),
      ]);
      await expect.element(confirmButton()).toBeEnabled();

      expect(await runAxe(dialog().element())).toStrictEqual([]);
    });
  });
});
