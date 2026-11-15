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
  uploadedFileOf,
  uploadedReply,
} from '../../../lib/test/fake-upload-fetch.ts';
import {
  createDocumentFile,
  createImageFile,
  createSvgFile,
} from '../../../lib/test/media-files.ts';
import { serveMediaImages } from '../../../lib/test/served-media-images.ts';
import { unavailableImageLabel } from '../../../lib/utilities/messages/media-display-messages.ts';
import { UNEXPECTED_ERROR_MESSAGE } from '../../../lib/utilities/messages/state-messages.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { ProductScreenshotEntry } from './product-basic-field-values.ts';
import {
  fieldValuesOf,
  fileInputOf,
  renderProductFields,
  submitButton,
  submittedFieldsOf,
  testForm,
} from './product-basic-fields-testing.tsx';
import { ScreenshotsField } from './screenshots-field.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const COUNT_MESSAGE = '画像は20枚以内で選択してください。';
const TOTAL_MESSAGE = 'ファイルは合計10MB以内で選択してください。';
const FILE_SIZE_MESSAGE =
  'スクリーンショットは5MB以内の画像を選択してください。';
const FORMAT_MESSAGE = 'JPEG・PNG・GIF・WebP・SVGの画像を選択してください。';
const TOTAL_MAX_BYTES = 10_485_760;
const FILE_MAX_BYTES = 5_242_880;

const fileIdOf = (index: number): string =>
  `01JC0SCREENSH0T00000000${String(index).padStart(3, '0')}`;

const objectKeyOf = (index: number): string =>
  `${String(index).padStart(2, '0')}${'0123456789abcdef'.repeat(2).slice(2)}`;

// 配信できる画像として保存されたアップロードの応答
const deliveredReply = (file: File, index: number) => ({
  status: 201,
  body: {
    data: {
      ...uploadedFileOf(file, fileIdOf(index), { width: 40, height: 40 }),
      objectKey: objectKeyOf(index),
    },
  },
});

const entryOf = (index: number, byteSize: number): ProductScreenshotEntry => ({
  fileId: fileIdOf(index),
  image: {
    objectKey: objectKeyOf(index),
    fallbackFormat: 'PNG',
    width: 1280,
    height: 720,
  },
  byteSize,
});

// 合計2,201,000バイト(2.1MB)
const THREE_ENTRIES: readonly ProductScreenshotEntry[] = Object.freeze([
  entryOf(1, 1_000_000),
  entryOf(2, 700_000),
  entryOf(3, 501_000),
]);

const renderWith = (initial: readonly ProductScreenshotEntry[]) =>
  renderProductFields(
    <ScreenshotsField initial={initial} disabled={false} />,
    fieldValuesOf({
      screenshotFileIds: initial.map(({ fileId }) => fileId),
    }),
  );

const selectButton = () =>
  page.getByRole('button', {
    name: 'スクリーンショット 画像を選択',
    exact: true,
  });
const removeButton = (position: number) =>
  page.getByRole('button', {
    name: `スクリーンショット${String(position)}を取り除く`,
    exact: true,
  });
// テストの画像のオリジンは配信しないため、読み込みに失敗した画像の代わりの表示の名前も元の代替テキストに戻して比べる
const thumbnailNames = () =>
  Array.from(
    testForm()
      .element()
      .querySelectorAll(
        '[data-slot="screenshot-list"] img, [data-slot="screenshot-list"] [role="img"]',
      ),
    (element) =>
      element instanceof HTMLImageElement
        ? element.alt
        : element
            .getAttribute('aria-label')
            ?.replace(unavailableImageLabel(''), ''),
  );
const cropDialog = () => page.getByRole('dialog', { name: '画像の編集' });
const confirmButton = () =>
  cropDialog().getByRole('button', { name: '確定', exact: true });

afterEach(() => {
  vi.unstubAllGlobals();
  applyColorScheme('light');
});

describe('一覧と枚数・合計の表示', () => {
  test('保存済みの画像を順に並べ、枚数と合計の容量を欄に結び付けて示す', async () => {
    await renderWith(THREE_ENTRIES);

    await expect
      .element(selectButton())
      .toHaveAccessibleDescription('3/20枚・2.1MB/10MB');
    expect(thumbnailNames()).toEqual([
      'スクリーンショット1',
      'スクリーンショット2',
      'スクリーンショット3',
    ]);
    await expect.element(removeButton(3)).toHaveTextContent('取り除く');
  });

  test('一覧の画像はスクリーンショットの縮小版(1倍と2倍)で配信する', async () => {
    const entry = entryOf(1, 1000);
    const served = await serveMediaImages(objectKeyOf(1));
    try {
      await renderProductFields(
        <ScreenshotsField initial={[entry]} disabled={false} />,
        fieldValuesOf({ screenshotFileIds: [entry.fileId] }),
        undefined,
        { imagesOrigin: served.origin },
      );
      const thumbnail = page.getByRole('img', {
        name: 'スクリーンショット1',
        exact: true,
      });

      await expect.element(thumbnail).toBeVisible();
      const srcSet = thumbnail.element().getAttribute('srcset') ?? '';
      expect(srcSet).toContain('/screenshot-thumb.png 1x');
      expect(srcSet).toContain('/screenshot-thumb-2x.png 2x');
    } finally {
      await served.remove();
    }
  });

  test('画像が無ければ一覧を出さず、0枚を示す', async () => {
    await renderWith([]);

    await expect
      .element(selectButton())
      .toHaveAccessibleDescription('0/20枚・0kB/10MB');
    expect(
      testForm().element().querySelector('[data-slot="screenshot-list"]'),
    ).toBeNull();
  });
});

describe('取り除く', () => {
  test('取り除いた画像を送る値と表示から外し、同じ位置の次の画像の「取り除く」へフォーカスを移す', async () => {
    const { onSubmit } = await renderWith(THREE_ENTRIES);

    await userEvent.click(removeButton(2));

    await expect
      .element(selectButton())
      .toHaveAccessibleDescription('2/20枚・1.5MB/10MB');
    await expect.element(removeButton(2)).toHaveFocus();
    expect(removeButton(3).query()).toBeNull();
    await userEvent.click(submitButton());
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.screenshotFileIds).toEqual([
      fileIdOf(1),
      fileIdOf(3),
    ]);
  });

  test('末尾を取り除くと1つ前の「取り除く」へ、最後の1枚を取り除くと選択のボタンへフォーカスを移す', async () => {
    await renderWith(THREE_ENTRIES.slice(0, 2));

    await userEvent.click(removeButton(2));
    await expect.element(removeButton(1)).toHaveFocus();
    await userEvent.click(removeButton(1));

    await expect.element(selectButton()).toHaveFocus();
    await expect
      .element(selectButton())
      .toHaveAccessibleDescription('0/20枚・0kB/10MB');
  });

  test('アップロードした画像を取り除いても、入力欄の一覧には直前の選択の送信の記録として残す', async () => {
    const uploads = stubUploadFetch();
    const { onSubmit } = await renderWith([]);
    const shot = createSvgFile('shot.svg');
    await userEvent.upload(fileInputOf(), [shot]);
    await uploads.reply(deliveredReply(shot, 11));
    await expect.element(removeButton(1)).toBeEnabled();

    await userEvent.click(removeButton(1));

    await expect.element(selectButton()).toHaveFocus();
    await expect
      .element(selectButton())
      .toHaveAccessibleDescription('0/20枚・0kB/10MB');
    await expect
      .element(testForm().getByText('shot.svg', { exact: true }))
      .toBeVisible();
    await expect
      .element(testForm().getByText('アップロード済み').first())
      .toBeVisible();
    await userEvent.click(submitButton());
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.screenshotFileIds).toEqual([]);
  });

  test('2回目の選択の送信中に1回目の画像を取り除いても、2回目の画像を中断せずに加える', async () => {
    const uploads = stubUploadFetch();
    const { onSubmit } = await renderWith([]);
    const first = createSvgFile('first.svg');
    await userEvent.upload(fileInputOf(), [first]);
    await uploads.reply(deliveredReply(first, 11));
    await expect.element(removeButton(1)).toBeEnabled();
    const second = createSvgFile('second.svg');
    const third = createSvgFile('third.svg');
    await userEvent.upload(fileInputOf(), [second, third]);
    await expect.poll(() => uploads.pendingCount()).toBe(1);

    await userEvent.click(removeButton(1));
    await uploads.reply(deliveredReply(second, 12));
    await uploads.reply(deliveredReply(third, 13));

    await expect.element(removeButton(2)).toBeInTheDocument();
    expect(uploads.calls.map(({ signal }) => signal?.aborted)).toEqual([
      false,
      false,
      false,
    ]);
    expect(thumbnailNames()).toEqual([
      'スクリーンショット1',
      'スクリーンショット2',
    ]);
    await userEvent.click(submitButton());
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.screenshotFileIds).toEqual([
      fileIdOf(12),
      fileIdOf(13),
    ]);
  });

  test('FormFieldのdisabledで、選択のボタンと「取り除く」を無効にする', async () => {
    await renderProductFields(
      <ScreenshotsField initial={THREE_ENTRIES} disabled />,
      fieldValuesOf({
        screenshotFileIds: THREE_ENTRIES.map(({ fileId }) => fileId),
      }),
    );

    await expect.element(selectButton()).toBeDisabled();
    await expect.element(removeButton(1)).toBeDisabled();
  });
});

describe('選択の事前の検査', () => {
  test('保存済みの画像と合わせて20枚を超える選択は、送信せずに枚数の文言を示す', async () => {
    const uploads = stubUploadFetch();
    await renderWith(
      Array.from({ length: 19 }, (_, index) => entryOf(index + 1, 1000)),
    );

    await userEvent.upload(fileInputOf(), [
      createSvgFile('a.svg'),
      createSvgFile('b.svg'),
    ]);

    await expect.element(testForm().getByText(COUNT_MESSAGE)).toBeVisible();
    expect(uploads.calls).toHaveLength(0);
  });

  test('1回の選択でも20枚を超えれば、枚数の文言を示す', async () => {
    const uploads = stubUploadFetch();
    await renderWith([]);

    await userEvent.upload(
      fileInputOf(),
      Array.from({ length: 21 }, (_, index) =>
        createSvgFile(`${String(index)}.svg`),
      ),
    );

    await expect.element(testForm().getByText(COUNT_MESSAGE)).toBeVisible();
    expect(uploads.calls).toHaveLength(0);
  });

  test('保存済みの画像と合わせて合計10MBを超える選択は、送信せずに合計の文言を示す', async () => {
    const uploads = stubUploadFetch();
    await renderWith([entryOf(1, TOTAL_MAX_BYTES - 500)]);

    await userEvent.upload(fileInputOf(), [
      createDocumentFile('large.svg', 'image/svg+xml', 1000),
    ]);

    await expect.element(testForm().getByText(TOTAL_MESSAGE)).toBeVisible();
    expect(uploads.calls).toHaveLength(0);
  });

  test('1枚5MBを超える画像は、送信せずに容量の文言を示す', async () => {
    const uploads = stubUploadFetch();
    await renderWith([]);

    await userEvent.upload(fileInputOf(), [
      createDocumentFile('large.svg', 'image/svg+xml', FILE_MAX_BYTES + 1),
    ]);

    await expect.element(testForm().getByText(FILE_SIZE_MESSAGE)).toBeVisible();
    expect(uploads.calls).toHaveLength(0);
  });

  test('許可されない形式は、送信せずに形式の文言を示す', async () => {
    const uploads = stubUploadFetch();
    await renderWith([]);

    await userEvent.upload(fileInputOf(), [
      createDocumentFile('shot.pdf', 'application/pdf', 1024),
    ]);

    await expect.element(testForm().getByText(FORMAT_MESSAGE)).toBeVisible();
    expect(uploads.calls).toHaveLength(0);
  });
});

describe('アップロード', () => {
  test('選んだ順にスクリーンショットの用途で送り、送る値の末尾に加えて枚数と合計を更新する', async () => {
    const uploads = stubUploadFetch();
    const { onSubmit } = await renderWith(THREE_ENTRIES.slice(0, 1));
    const first = createDocumentFile('first.svg', 'image/svg+xml', 1024);
    const second = createDocumentFile('second.svg', 'image/svg+xml', 2048);

    await userEvent.upload(fileInputOf(), [first, second]);
    await uploads.reply(deliveredReply(first, 11));
    await uploads.reply(deliveredReply(second, 12));

    await expect
      .element(selectButton())
      .toHaveAccessibleDescription('3/20枚・979.6kB/10MB');
    expect(uploads.calls.map(({ path }) => path)).toEqual([
      expect.stringContaining('/_bff/uploads/product-screenshot'),
      expect.stringContaining('/_bff/uploads/product-screenshot'),
    ]);
    expect(thumbnailNames()).toEqual([
      'スクリーンショット1',
      'スクリーンショット2',
      'スクリーンショット3',
    ]);
    await userEvent.click(submitButton());
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.screenshotFileIds).toEqual([
      fileIdOf(1),
      fileIdOf(11),
      fileIdOf(12),
    ]);
  });

  test('SVG以外は自由な比率で切り取り、長辺1920ピクセル以下に作り直して送る', async () => {
    const uploads = stubUploadFetch();
    await renderWith([]);
    const jpeg = await createImageFile('wide.jpg', 'image/jpeg', {
      width: 2400,
      height: 1200,
    });

    await userEvent.upload(fileInputOf(), [jpeg]);
    await expect.element(cropDialog()).toBeVisible();
    await expect.element(confirmButton()).toBeEnabled();
    await userEvent.click(confirmButton());
    await expect.poll(() => uploads.pendingCount()).toBe(1);

    const edited = await createImageBitmap(
      uploads.calls[0]?.body ?? new Blob(),
    );
    expect([edited.width, edited.height]).toEqual([1920, 960]);
    await uploads.reply(uploadedReply(jpeg, fileIdOf(21)));
  });

  test('想定外の応答には、問い合わせの導線を持つ利用者側の文言を示す', async () => {
    expect(CLIENT_PROFILE.contactAvailable).toBe(true);
    const uploads = stubUploadFetch();
    await renderWith([]);

    await userEvent.upload(fileInputOf(), [createSvgFile('shot.svg')]);
    await uploads.reply({ status: 500, text: '<html>障害</html>' });

    await expect
      .element(testForm().getByText(UNEXPECTED_ERROR_MESSAGE))
      .toBeVisible();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sで、保存済みの画像の一覧を示した状態の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith(THREE_ENTRIES);
      await expect.element(removeButton(3)).toBeVisible();

      expect(await runAxe(testForm().element())).toEqual([]);
    },
  );

  test('選択の拒否の文言を出した状態の違反が0件である', async () => {
    await renderWith(THREE_ENTRIES);
    await userEvent.upload(fileInputOf(), [
      createDocumentFile('shot.pdf', 'application/pdf', 1024),
    ]);
    await expect.element(testForm().getByText(FORMAT_MESSAGE)).toBeVisible();

    expect(await runAxe(testForm().element())).toEqual([]);
  });
});
