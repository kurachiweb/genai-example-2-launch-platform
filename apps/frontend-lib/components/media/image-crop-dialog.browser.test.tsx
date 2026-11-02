import { type RefObject, useRef, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
} from '../../test/computed-style.ts';
import {
  createDocumentFile,
  createImageFile,
  createOrientedJpegFile,
  createSplitImageFile,
  type DecodedImage,
  decodeImage,
} from '../../test/media-files.ts';
import { holdImageDecoding } from '../../test/held-image-decoding.ts';
import {
  emulateReducedMotion,
  REDUCED_MOTION_PREFERENCES,
} from '../../test/reduced-motion.ts';
import type { ImageEditOptions } from '../../utilities/media/crop-geometry.ts';
import { ImageCropDialog } from './image-crop-dialog.tsx';

const OPENER = '画像を選択';

const TITLE = '画像の編集';

const SQUARE: ImageEditOptions = { aspect: 1, maxLongSide: 1024 };

const SPLIT_SIZE = { width: 400, height: 200 } as const;

const MOVE_PRESSES = 30;

type ConfirmMock = ReturnType<typeof vi.fn<(file: File) => void>>;

interface HarnessProps {
  readonly file: File;
  readonly edit?: ImageEditOptions;
  readonly onConfirm: (file: File) => void;
  readonly onCancel?: () => void;
  readonly passReturnFocus?: boolean;
}

// 選択のボタンからファイルを選んで編集を始め、確定か取り消しで閉じる入力欄の流れを模す
function Harness({
  file,
  edit = SQUARE,
  onConfirm,
  onCancel = () => undefined,
  passReturnFocus = true,
}: HarnessProps) {
  const [editing, setEditing] = useState<File>();
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef: RefObject<HTMLElement | null> | undefined =
    passReturnFocus ? selectButtonRef : undefined;
  return (
    <div className="bg-background p-4 text-foreground">
      <button type="button">前の操作</button>
      <button
        ref={selectButtonRef}
        type="button"
        onClick={() => {
          setEditing(file);
        }}
      >
        {OPENER}
      </button>
      <ImageCropDialog
        file={editing}
        edit={edit}
        returnFocusRef={returnFocusRef}
        onConfirm={(result) => {
          setEditing(undefined);
          onConfirm(result);
        }}
        onCancel={() => {
          setEditing(undefined);
          onCancel();
        }}
      />
    </div>
  );
}

const opener = () => page.getByRole('button', { name: OPENER });
const dialog = () => page.getByRole('dialog', { name: TITLE });
const cropArea = () => dialog().getByRole('group', { name: '切り取る範囲' });
const buttonInDialog = (name: string) =>
  dialog().getByRole('button', { name, exact: true });
const zoomSlider = () => dialog().getByRole('slider', { name: '拡大率' });
const overlay = () =>
  page.elementLocator(
    document.querySelector('[data-slot="dialog-overlay"]') ?? document.body,
  );

const SECOND_DESCRIPTION =
  'second.jpgの切り取る範囲を、位置と拡大率で調整してください。';

async function splitImage(type: 'image/png' | 'image/jpeg' = 'image/png') {
  return createSplitImageFile(
    type === 'image/png' ? 'split.png' : 'split.jpg',
    type,
    SPLIT_SIZE,
  );
}

async function openWith(
  file: File,
  props: Partial<Omit<HarnessProps, 'file' | 'onConfirm'>> = {},
): Promise<ConfirmMock> {
  const onConfirm = vi.fn<(file: File) => void>();
  await render(<Harness file={file} onConfirm={onConfirm} {...props} />);
  await userEvent.click(opener());
  await expect.element(cropArea()).toBeInTheDocument();
  await expect.element(buttonInDialog('確定')).toBeEnabled();
  return onConfirm;
}

async function confirmAndDecode(onConfirm: ConfirmMock): Promise<{
  readonly file: File;
  readonly image: DecodedImage;
}> {
  await userEvent.click(buttonInDialog('確定'));
  await expect.poll(() => onConfirm.mock.calls.length).toBe(1);
  const file = onConfirm.mock.calls[0]?.[0];
  if (file === undefined) {
    throw new Error('作り直したファイルが渡されていません。');
  }
  return { file, image: await decodeImage(file) };
}

const RED_THRESHOLD = 200;
const OTHER_CHANNEL_THRESHOLD = 60;

const isRed = ([red = 0, green = 0, blue = 0]: readonly number[]): boolean =>
  red > RED_THRESHOLD &&
  green < OTHER_CHANNEL_THRESHOLD &&
  blue < OTHER_CHANNEL_THRESHOLD;

const isBlue = ([red = 0, green = 0, blue = 0]: readonly number[]): boolean =>
  blue > RED_THRESHOLD &&
  red < OTHER_CHANNEL_THRESHOLD &&
  green < OTHER_CHANNEL_THRESHOLD;

const leftAndRightOf = (image: DecodedImage) => {
  const middle = Math.floor(image.height / 2);
  return {
    left: image.colorAt(1, middle),
    right: image.colorAt(image.width - 2, middle),
  };
};

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

async function dragHorizontally(target: Element, distance: number) {
  const { left, top, width, height } = target.getBoundingClientRect();
  const start = { clientX: left + width / 2, clientY: top + height / 2 };
  target.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, ...start, button: 0 }),
  );
  document.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      clientX: start.clientX + distance,
      clientY: start.clientY,
    }),
  );
  await nextFrame();
  await nextFrame();
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

// 切り取る範囲はポインターの押下で既定の動作を止めるため、Tabで移る
async function focusCropAreaWithKeyboard() {
  for (let index = 0; index < 20; index += 1) {
    if (document.activeElement === cropArea().element()) {
      break;
    }
    await userEvent.tab();
  }
  await expect.element(cropArea()).toHaveFocus();
}

async function pressRepeatedly(key: string, times: number) {
  for (let index = 0; index < times; index += 1) {
    await userEvent.keyboard(`{${key}}`);
  }
}

afterEach(async () => {
  vi.unstubAllGlobals();
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('ImageCropDialog', () => {
  test('開くと題名と説明を伝え、切り取る範囲にキー操作の案内を結び付ける', async () => {
    await openWith(await splitImage());

    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        'split.pngの切り取る範囲を、位置と拡大率で調整してください。',
      );
    await expect
      .element(cropArea())
      .toHaveAccessibleDescription(
        '矢印キーで画像を動かします。Shiftキーを押しながら操作すると細かく動かします。',
      );
  });

  test('開いている間は、TabとShift+Tabのフォーカスがダイアログの中で循環する', async () => {
    await openWith(await splitImage());
    const dialogElement = dialog().element();
    const visited = new Set<Element | null>();

    for (let index = 0; index < 20; index += 1) {
      await userEvent.tab();
      expect(dialogElement.contains(document.activeElement)).toBe(true);
      visited.add(document.activeElement);
    }
    for (let index = 0; index < 5; index += 1) {
      await userEvent.tab({ shift: true });
      expect(dialogElement.contains(document.activeElement)).toBe(true);
    }

    expect(visited.has(cropArea().element())).toBe(true);
    expect(visited.has(zoomSlider().element())).toBe(true);
    expect(visited.has(buttonInDialog('確定').element())).toBe(true);
  });

  test.each(REDUCED_MOTION_PREFERENCES)(
    '視差効果の設定が%sのとき、Escapeで閉じると選択のボタンへフォーカスが戻り、確定しない',
    async (preference) => {
      await emulateReducedMotion(preference);
      const onCancel = vi.fn();
      const onConfirm = await openWith(await splitImage(), { onCancel });

      await userEvent.keyboard('{Escape}');

      await expect.element(dialog()).not.toBeInTheDocument();
      await expect.element(opener()).toHaveFocus();
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  test('「キャンセル」と右上の「閉じる」でも、選択のボタンへフォーカスが戻る', async () => {
    const onCancel = vi.fn();
    await openWith(await splitImage(), { onCancel });

    await userEvent.click(buttonInDialog('キャンセル'));
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();

    await userEvent.click(opener());
    await expect.element(cropArea()).toBeInTheDocument();
    await userEvent.click(buttonInDialog('閉じる'));
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  test('確定すると閉じて、選択のボタンへフォーカスが戻る', async () => {
    const onConfirm = await openWith(await splitImage());

    await confirmAndDecode(onConfirm);

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
  });

  test('戻り先を渡さないときは、開いた時にフォーカスのあった要素へ戻す', async () => {
    await openWith(await splitImage(), { passReturnFocus: false });

    await userEvent.keyboard('{Escape}');

    await expect.element(opener()).toHaveFocus();
  });

  test('はじめは画像の中央を切り取る', async () => {
    const onConfirm = await openWith(await splitImage());

    const { image } = await confirmAndDecode(onConfirm);
    const { left, right } = leftAndRightOf(image);

    expect(image.width).toBe(image.height);
    expect(isRed(left)).toBe(true);
    expect(isBlue(right)).toBe(true);
  });

  test('切り取る範囲で矢印キーを押すと画像が動き、右へ動かすと左側を切り取る', async () => {
    const onConfirm = await openWith(await splitImage());

    await focusCropAreaWithKeyboard();
    await pressRepeatedly('ArrowRight', MOVE_PRESSES);

    const { left, right } = leftAndRightOf(
      (await confirmAndDecode(onConfirm)).image,
    );
    expect(isRed(left)).toBe(true);
    expect(isRed(right)).toBe(true);
  });

  test('キーボードで移ったフォーカスを、切り取る範囲の内側にリングの色の輪郭で示し、枠の端で切れないようにする', async () => {
    await openWith(await splitImage());

    await focusCropAreaWithKeyboard();

    expect(outlineOf(cropArea().element())).toStrictEqual(ringOutline());
    expect(
      Number.parseFloat(getComputedStyle(cropArea().element()).outlineOffset),
    ).toBeLessThan(0);
  });

  test('ポインターで画像をドラッグして動かせる', async () => {
    const onConfirm = await openWith(await splitImage());

    await dragHorizontally(cropArea().element(), -400);

    const { left, right } = leftAndRightOf(
      (await confirmAndDecode(onConfirm)).image,
    );
    expect(isBlue(left)).toBe(true);
    expect(isBlue(right)).toBe(true);
  });

  test('ドラッグしなくても、移動のボタンで画像を動かせ、画像の端より先へは動かさない', async () => {
    const onConfirm = await openWith(await splitImage());

    for (let index = 0; index < MOVE_PRESSES; index += 1) {
      await userEvent.click(buttonInDialog('左へ移動'));
    }
    await userEvent.click(buttonInDialog('上へ移動'));
    await userEvent.click(buttonInDialog('下へ移動'));

    const { image } = await confirmAndDecode(onConfirm);
    const { left, right } = leftAndRightOf(image);
    expect(image.width).toBe(image.height);
    expect(image.height).toBe(SPLIT_SIZE.height);
    expect(isBlue(left)).toBe(true);
    expect(isBlue(right)).toBe(true);
  });

  test('右へ移動のボタンで画像を右へ動かすと、左側を切り取る', async () => {
    const onConfirm = await openWith(await splitImage());

    for (let index = 0; index < MOVE_PRESSES; index += 1) {
      await userEvent.click(buttonInDialog('右へ移動'));
    }

    const { left, right } = leftAndRightOf(
      (await confirmAndDecode(onConfirm)).image,
    );
    expect(isRed(left)).toBe(true);
    expect(isRed(right)).toBe(true);
  });

  test('拡大率のスライダーを矢印キーで操作して拡大でき、切り取る範囲が狭まる', async () => {
    const onConfirm = await openWith(await splitImage());
    await expect
      .element(zoomSlider())
      .toHaveAttribute('aria-valuetext', '100%');

    await userEvent.click(zoomSlider());
    await userEvent.keyboard('{Home}');
    await pressRepeatedly('ArrowRight', 10);

    await expect
      .element(zoomSlider())
      .toHaveAttribute('aria-valuetext', '200%');
    const { image } = await confirmAndDecode(onConfirm);
    expect(image.width).toBeLessThanOrEqual(SPLIT_SIZE.height / 2 + 1);
    expect(image.width).toBeGreaterThanOrEqual(SPLIT_SIZE.height / 2 - 1);
  });

  test('拡大と縮小のボタンで拡大率を変え、最小と最大の先へは変えない', async () => {
    await openWith(await splitImage());

    await userEvent.click(buttonInDialog('縮小'));
    await expect
      .element(zoomSlider())
      .toHaveAttribute('aria-valuetext', '100%');
    for (let index = 0; index < 6; index += 1) {
      await userEvent.click(buttonInDialog('拡大'));
    }
    await expect
      .element(zoomSlider())
      .toHaveAttribute('aria-valuetext', '300%');
    await userEvent.click(buttonInDialog('縮小'));
    await expect
      .element(zoomSlider())
      .toHaveAttribute('aria-valuetext', '250%');
  });

  test('ポインターのホイールで拡大できる', async () => {
    await openWith(await splitImage());

    cropArea()
      .element()
      .dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: -100,
        }),
      );

    await expect
      .element(zoomSlider())
      .not.toHaveAttribute('aria-valuetext', '100%');
  });

  test.each([
    { aspect: 16 / 9, ratio: 16 / 9 },
    { aspect: 'free' as const, ratio: 2 },
  ])(
    '縦横比の指定が$aspectのとき、その縦横比で切り取る',
    async ({ aspect, ratio }) => {
      const onConfirm = await openWith(await splitImage(), {
        edit: { aspect, maxLongSide: 1024 },
      });

      const { image } = await confirmAndDecode(onConfirm);

      expect(image.width / image.height).toBeCloseTo(ratio, 1);
    },
  );

  test('丸く切り取る指定では、切り取る範囲を円で示す', async () => {
    await openWith(await splitImage(), {
      edit: { aspect: 1, maxLongSide: 512, cropShape: 'round' },
    });

    expect(cropArea().element().classList).toContain(
      'reactEasyCrop_CropAreaRound',
    );
  });

  test('JPEGの原本は、最大寸法以下のJPEGに作り直す', async () => {
    const jpegConfirm = await openWith(
      await createImageFile('photo.jpg', 'image/jpeg', {
        width: 1600,
        height: 1200,
      }),
      { edit: { aspect: 'free', maxLongSide: 400 } },
    );
    const jpeg = await confirmAndDecode(jpegConfirm);

    expect(jpeg.file.type).toBe('image/jpeg');
    expect({
      width: jpeg.image.width,
      height: jpeg.image.height,
    }).toStrictEqual({
      width: 400,
      height: 300,
    });
  });

  test('PNGの原本は、最大寸法以下のPNGに作り直す', async () => {
    const pngConfirm = await openWith(await splitImage(), {
      edit: { aspect: 1, maxLongSide: 64 },
    });
    const png = await confirmAndDecode(pngConfirm);

    expect(png.file.type).toBe('image/png');
    expect({ width: png.image.width, height: png.image.height }).toStrictEqual({
      width: 64,
      height: 64,
    });
  });

  test('Exifの向きが付いたJPEGは、表示の向きのまま切り取って作り直す', async () => {
    const onConfirm = await openWith(
      await createOrientedJpegFile(
        'portrait.jpg',
        { width: 80, height: 40 },
        6,
      ),
      { edit: { aspect: 'free', maxLongSide: 1024 } },
    );

    const { image } = await confirmAndDecode(onConfirm);

    expect({ width: image.width, height: image.height }).toStrictEqual({
      width: 40,
      height: 80,
    });
    expect(isRed(image.colorAt(20, 5))).toBe(true);
    expect(isBlue(image.colorAt(20, 74))).toBe(true);
  });

  test('作り直している間は確定を処理中として示し、その間に取り消すと結果を渡さない', async () => {
    const pending: BlobCallback[] = [];
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => {
        pending.push(callback);
      });
    try {
      const onConfirm = await openWith(await splitImage());

      await userEvent.click(buttonInDialog('確定'));

      const busy = buttonInDialog('処理中');
      await expect.element(busy).toHaveAttribute('aria-busy', 'true');
      await expect.element(busy).toHaveAttribute('aria-disabled', 'true');
      await expect.poll(() => pending.length).toBe(1);
      await userEvent.keyboard('{Escape}');
      await expect.element(dialog()).not.toBeInTheDocument();
      pending[0]?.(new Blob(['x'], { type: 'image/png' }));
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });

      expect(onConfirm).not.toHaveBeenCalled();
    } finally {
      toBlob.mockRestore();
    }
  });

  test('作り直しに失敗したときは、エラーを伝えて確定をやり直せるようにする', async () => {
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementationOnce((callback) => {
        callback(null);
      });
    try {
      const onConfirm = await openWith(await splitImage());

      await userEvent.click(buttonInDialog('確定'));

      await expect
        .element(dialog().getByRole('alert'))
        .toHaveTextContent(
          '編集した画像を作成できませんでした。もう一度お試しください。',
        );
      expect(onConfirm).not.toHaveBeenCalled();

      await confirmAndDecode(onConfirm);
      expect(onConfirm).toHaveBeenCalledOnce();
    } finally {
      toBlob.mockRestore();
    }
  });

  test('開いたまま別の画像へ替えると、その画像の編集を始め直す', async () => {
    const files = [
      await splitImage(),
      await createImageFile('second.jpg', 'image/jpeg', {
        width: 300,
        height: 300,
      }),
    ];
    const onConfirm = vi.fn<(file: File) => void>();
    function QueueHarness() {
      const [index, setIndex] = useState(0);
      return (
        <ImageCropDialog
          file={files[index]}
          edit={SQUARE}
          onConfirm={(result) => {
            onConfirm(result);
            setIndex((current) => current + 1);
          }}
          onCancel={() => undefined}
        />
      );
    }
    await render(<QueueHarness />);
    await expect.element(buttonInDialog('確定')).toBeEnabled();
    await userEvent.click(buttonInDialog('拡大'));
    await expect
      .element(zoomSlider())
      .toHaveAttribute('aria-valuetext', '150%');

    await userEvent.click(buttonInDialog('確定'));

    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        'second.jpgの切り取る範囲を、位置と拡大率で調整してください。',
      );
    await expect
      .element(zoomSlider())
      .toHaveAttribute('aria-valuetext', '100%');
    await expect.element(buttonInDialog('確定')).toBeEnabled();
    await userEvent.click(buttonInDialog('確定'));
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onConfirm.mock.calls.map(([file]) => file.name)).toStrictEqual([
      'split.png',
      'second.jpg',
    ]);
  });

  test('画像を読み込むまでは「キャンセル」と右上の「閉じる」を無効にし、Escapeとダイアログの外の操作でも閉じない', async () => {
    const file = await splitImage();
    const release = holdImageDecoding();
    const onCancel = vi.fn();
    await render(
      <Harness file={file} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    await userEvent.click(opener());
    await expect.element(dialog()).toBeInTheDocument();

    await expect.element(buttonInDialog('キャンセル')).toBeDisabled();
    await expect.element(buttonInDialog('閉じる')).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(overlay(), { position: { x: 4, y: 4 } });

    await expect.element(dialog()).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog().element().contains(document.activeElement)).toBe(true);

    release();
    await expect.element(buttonInDialog('確定')).toBeEnabled();
    await expect.element(buttonInDialog('キャンセル')).toBeEnabled();
    await expect.element(buttonInDialog('閉じる')).toBeEnabled();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test('右上の「閉じる」で取り消して次の画像へ替わると、読み込むまで取り消しを受け付けず、フォーカスをダイアログの中に留める', async () => {
    const files = [
      await splitImage(),
      await createImageFile('second.jpg', 'image/jpeg', {
        width: 300,
        height: 300,
      }),
    ];
    const onCancel = vi.fn();
    function QueueHarness() {
      const [index, setIndex] = useState(0);
      return (
        <ImageCropDialog
          file={files[index]}
          edit={SQUARE}
          onConfirm={() => undefined}
          onCancel={() => {
            onCancel();
            setIndex((current) => current + 1);
          }}
        />
      );
    }
    await render(<QueueHarness />);
    await expect.element(buttonInDialog('確定')).toBeEnabled();
    const release = holdImageDecoding();

    await userEvent.click(buttonInDialog('閉じる'));

    await expect
      .element(dialog())
      .toHaveAccessibleDescription(SECOND_DESCRIPTION);
    await expect.element(buttonInDialog('閉じる')).toBeDisabled();
    await expect.element(buttonInDialog('キャンセル')).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    await nextFrame();
    await nextFrame();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(document.body);
    expect(dialog().element().contains(document.activeElement)).toBe(true);

    release();
    await expect.element(buttonInDialog('確定')).toBeEnabled();
    await userEvent.click(buttonInDialog('閉じる'));
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  test('押し続けたEscapeのキーの繰り返しでは閉じず、押し直すと閉じる', async () => {
    const onCancel = vi.fn();
    await openWith(await splitImage(), { onCancel });

    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        repeat: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextFrame();

    await expect.element(dialog()).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test('読み込めない画像は、「キャンセル」と右上の「閉じる」を押せ、Escapeで取り消して閉じられる', async () => {
    const onCancel = vi.fn();
    await render(
      <Harness
        file={createDocumentFile('broken.png', 'image/png', 16)}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(opener());
    await expect.element(dialog().getByRole('alert')).toBeInTheDocument();

    await expect.element(buttonInDialog('キャンセル')).toBeEnabled();
    await expect.element(buttonInDialog('閉じる')).toBeEnabled();
    await userEvent.keyboard('{Escape}');

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test('読み込めない画像は、エラーを伝えて確定できないようにする', async () => {
    const onConfirm = vi.fn<(file: File) => void>();
    await render(
      <Harness
        file={createDocumentFile('broken.png', 'image/png', 16)}
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(opener());

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(
        '画像を読み込めませんでした。画像が壊れていないか確認して、別の画像を選択してください。',
      );
    await expect.element(buttonInDialog('確定')).toBeDisabled();
    await expect.element(zoomSlider()).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('画像を読み込んだダイアログで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await openWith(await splitImage());

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
