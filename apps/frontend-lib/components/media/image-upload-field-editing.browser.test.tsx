import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import '../../styles/base.css';
import {
  stubUploadFetch,
  uploadedFileOf,
  uploadedReply,
  type UploadFetchStub,
} from '../../test/fake-upload-fetch.ts';
import { holdImageDecoding } from '../../test/held-image-decoding.ts';
import { holdEscapeKey } from '../../test/keyboard.ts';
import {
  createDocumentFile,
  createImageFile,
  createSvgFile,
} from '../../test/media-files.ts';
import type { ImageEditOptions } from '../../utilities/media/crop-geometry.ts';
import type { UploadConstraints } from '../../utilities/media/upload-constraints.ts';
import {
  ImageUploadField,
  type ImageUploadFieldProps,
} from './image-upload-field.tsx';

const LABEL = '画像を選択';

const SCREENSHOTS: UploadConstraints = {
  purpose: 'product-screenshot',
  allowedTypes: ['image/jpeg', 'image/png', 'image/svg+xml'],
  maxBytes: 5_242_880,
  subjectLabel: 'スクリーンショット',
  maxCount: 3,
};

const SQUARE: ImageEditOptions = { aspect: 1, maxLongSide: 256 };

type UploadedMock = ReturnType<
  typeof vi.fn<(files: readonly UploadedFile[]) => void>
>;

const selectButton = () =>
  page.getByRole('button', { name: LABEL, exact: true });
const dialog = () => page.getByRole('dialog', { name: '画像の編集' });
const confirmButton = () =>
  dialog().getByRole('button', { name: '確定', exact: true });
const cancelButton = () =>
  dialog().getByRole('button', { name: 'キャンセル', exact: true });
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
        constraints={SCREENSHOTS}
        edit={SQUARE}
        multiple
        contactAvailable
        onUploaded={onUploaded}
        {...props}
      />
    </div>,
  );
  return { container, onUploaded };
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

// 選択の画面を経たファイルはブラウザが作り直した別のオブジェクトになるため、名前・形式・内容で同じファイルかを確かめる
async function expectSameFile(actual: Blob | undefined, expected: File) {
  expect(actual).toBeInstanceOf(File);
  expect(actual instanceof File ? actual.name : undefined).toBe(expected.name);
  expect(actual?.type).toBe(expected.type);
  expect(await actual?.text()).toBe(await expected.text());
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

async function expectShowing(fileName: string) {
  await expect
    .element(dialog())
    .toHaveAccessibleDescription(
      `${fileName}の切り取る範囲を、位置と拡大率で調整してください。`,
    );
}

async function expectEditing(fileName: string) {
  await expectShowing(fileName);
  await expect.element(confirmButton()).toBeEnabled();
}

async function cancelCrop() {
  await userEvent.click(cancelButton());
}

async function confirmCrop() {
  await expect.element(confirmButton()).toBeEnabled();
  await userEvent.click(confirmButton());
}

const pngOf = async (name: string): Promise<File> =>
  createImageFile(name, 'image/png', { width: 64, height: 64 });

const threePngs = async (): Promise<File[]> =>
  Promise.all(['a.png', 'b.png', 'c.png'].map(pngOf));

// a.pngを外した後の残りの2枚を確定し、選んだ順に送ったことを確かめる
async function expectSentAfterConfirmingBAndC(fetch: UploadFetchStub) {
  await expectEditing('b.png');
  await confirmCrop();
  await expectEditing('c.png');
  await confirmCrop();

  const sentSecond = await sentBodyAt(fetch, 0);
  expect(sentSecond.name).toBe('b.png');
  expect(listItems().all()).toHaveLength(2);
  await expect.element(listItems().nth(0)).toHaveTextContent('b.png');
  await expect.element(listItems().nth(1)).toHaveTextContent('c.png');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ImageUploadFieldの複数の画像の編集の取り消し', () => {
  test('途中で取り消すとその1枚だけを選択から外し、残りの画像の編集を続けて選んだ順に送る', async () => {
    const fetch = stubUploadFetch();
    const svg = createSvgFile('b.svg');
    const third = await createImageFile('c.jpg', 'image/jpeg', {
      width: 200,
      height: 300,
    });
    const { container, onUploaded } = await renderField();

    await userEvent.upload(fileInputOf(container), [
      await pngOf('a.png'),
      svg,
      third,
    ]);
    await expectEditing('a.png');
    await cancelCrop();

    await expectEditing('c.jpg');
    // 押した取り消しのボタンは次の画像の編集の領域と入れ替わるため、フォーカスがダイアログの外へ落ちないことを確かめる
    await expect
      .poll(() => dialog().element().contains(document.activeElement))
      .toBe(true);
    expect(fetch.calls).toHaveLength(0);
    await confirmCrop();

    await expectSameFile(await sentBodyAt(fetch, 0), svg);
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(selectButton()).toHaveFocus();
    expect(listItems().all()).toHaveLength(2);
    await expect.element(listItems().nth(0)).toHaveTextContent('b.svg');
    await expect.element(listItems().nth(1)).toHaveTextContent('c.jpg');
    await fetch.reply(uploadedReply(svg, 'file-1'));
    const sentThird = await sentBodyAt(fetch, 1);
    expect(sentThird.type).toBe('image/jpeg');
    await fetch.reply(uploadedReply(sentThird, 'file-2'));

    await expect
      .poll(() => onUploaded.mock.calls)
      .toEqual([
        [[uploadedFileOf(svg, 'file-1'), uploadedFileOf(sentThird, 'file-2')]],
      ]);
    await expect
      .element(liveRegionOf(container))
      .toHaveTextContent('b.svg、c.jpgの2件をアップロードしました。');
  });

  test('最後の画像の編集を取り消すと、それまでに編集した画像だけを送り、選択のボタンへフォーカスを戻す', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField();

    await userEvent.upload(fileInputOf(container), [
      await pngOf('a.png'),
      await pngOf('b.png'),
    ]);
    await expectEditing('a.png');
    await confirmCrop();
    await expectEditing('b.png');
    await userEvent.keyboard('{Escape}');

    const sent = await sentBodyAt(fetch, 0);
    expect(sent.name).toBe('a.png');
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(selectButton()).toHaveFocus();
    expect(listItems().all()).toHaveLength(1);
    await fetch.reply(uploadedReply(sent, 'file-1'));
    await expect
      .element(liveRegionOf(container))
      .toHaveTextContent('a.pngをアップロードしました。');
    expect(fetch.calls).toHaveLength(1);
  });

  test('すべての画像の編集を取り消すと何も加えず、前の結果を残して選択のボタンへフォーカスを戻す', async () => {
    const fetch = stubUploadFetch();
    const earlier = createSvgFile('earlier.svg');
    const { container, onUploaded } = await renderField();
    await userEvent.upload(fileInputOf(container), [earlier]);
    await fetch.reply(uploadedReply(earlier, 'file-1'));
    await expect
      .element(listItems().nth(0))
      .toHaveTextContent('アップロード済み');

    await userEvent.upload(fileInputOf(container), [
      await pngOf('a.png'),
      await pngOf('b.png'),
    ]);
    await expectEditing('a.png');
    await cancelCrop();
    await expectEditing('b.png');
    await cancelCrop();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(selectButton()).toHaveFocus();
    expect(fetch.calls).toHaveLength(1);
    expect(listItems().all()).toHaveLength(1);
    await expect.element(listItems().nth(0)).toHaveTextContent('earlier.svg');
    await expect
      .element(liveRegionOf(container))
      .toHaveTextContent('earlier.svgをアップロードしました。');
    expect(onUploaded).toHaveBeenCalledOnce();
  });

  test('次の画像を読み込む間は取り消しを受け付けず、その間に届いたダブルクリックの2回目とEscapeでは次の画像を外さない', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField();
    await userEvent.upload(fileInputOf(container), await threePngs());
    await expectEditing('a.png');
    const release = holdImageDecoding();

    await userEvent.dblClick(cancelButton());

    await expectShowing('b.png');
    await expect.element(cancelButton()).toBeDisabled();
    await expect.element(confirmButton()).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await expectShowing('b.png');
    expect(dialog().element().contains(document.activeElement)).toBe(true);
    release();
    await expectSentAfterConfirmingBAndC(fetch);
  });

  test('Escapeを押し続けると、最初の押下で表示中の画像だけを外し、読み込んだ後に届くキーの繰り返しでは次の画像を外さない', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField();
    await userEvent.upload(fileInputOf(container), await threePngs());
    await expectEditing('a.png');
    const repeats: boolean[] = [];
    const recordRepeat = (event: KeyboardEvent) => {
      repeats.push(event.repeat);
    };
    document.addEventListener('keydown', recordRepeat, { capture: true });
    try {
      await holdEscapeKey({
        afterFirstPress: () => expectEditing('b.png'),
        repeats: 2,
      });
    } finally {
      document.removeEventListener('keydown', recordRepeat, { capture: true });
    }

    expect(repeats).toStrictEqual([false, true, true]);
    await expectSentAfterConfirmingBAndC(fetch);
  });

  test('次の画像を読み込めない時は、取り消してその画像を外し、残りの画像を送る', async () => {
    const fetch = stubUploadFetch();
    const { container } = await renderField();

    await userEvent.upload(fileInputOf(container), [
      await pngOf('a.png'),
      createDocumentFile('broken.png', 'image/png', 16),
    ]);
    await expectEditing('a.png');
    await confirmCrop();

    await expectShowing('broken.png');
    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('画像を読み込めませんでした。');
    await expect.element(cancelButton()).toBeEnabled();
    await cancelCrop();

    const sent = await sentBodyAt(fetch, 0);
    expect(sent.name).toBe('a.png');
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(selectButton()).toHaveFocus();
    expect(listItems().all()).toHaveLength(1);
  });

  test('取り消して外した後の選択で、既存の合計を含めて上限を判定する', async () => {
    const fetch = stubUploadFetch();
    const first = createSvgFile('b.svg');
    const second = createSvgFile('c.svg');
    const existingTotalBytes = 1000;
    const { container } = await renderField({
      constraints: {
        ...SCREENSHOTS,
        existingTotalBytes,
        maxTotalBytes: existingTotalBytes + first.size + second.size,
      },
    });

    await userEvent.upload(fileInputOf(container), [
      await pngOf('a.png'),
      first,
      second,
    ]);
    await expectEditing('a.png');
    await cancelCrop();

    await expectSameFile(await sentBodyAt(fetch, 0), first);
    expect(listItems().all()).toHaveLength(2);
  });

  test('取り消して外した後の選択でも合計の上限を超える時は、残りの画像の一覧とエラーを示して送らない', async () => {
    const fetch = stubUploadFetch();
    const existingTotalBytes = 1000;
    const { container } = await renderField({
      constraints: {
        ...SCREENSHOTS,
        existingCount: 1,
        existingTotalBytes,
        maxTotalBytes: existingTotalBytes + 1,
      },
    });

    await userEvent.upload(fileInputOf(container), [
      await pngOf('a.png'),
      await pngOf('b.png'),
    ]);
    await expectEditing('a.png');
    await cancelCrop();
    await expectEditing('b.png');
    await confirmCrop();

    await expect
      .element(page.getByText('ファイルは合計1kB以内で選択してください。'))
      .toBeInTheDocument();
    expect(listItems().all()).toHaveLength(1);
    await expect.element(listItems().nth(0)).toHaveTextContent('b.png');
    expect(fetch.calls).toHaveLength(0);
  });
});
