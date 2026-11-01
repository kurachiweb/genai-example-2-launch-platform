import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { MediaType } from '../../../common-lib/media/media-types.ts';
import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { createDocumentFile, createSvgFile } from '../../test/media-files.ts';
import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { FormField } from '../form/form-field.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import { FileDropZone, type FileDropZoneProps } from './file-drop-zone.tsx';

const LABEL = '画像を選択';

const IDLE_HINT = 'ここにドラッグ&ドロップしても選択できます。';

const ACTIVE_HINT = 'ここでドロップすると選択できます。';

const ACCEPT: readonly MediaType[] = [
  'image/jpeg',
  'image/png',
  'image/svg+xml',
];

const selectButton = () => page.getByRole('button', { name: LABEL });

async function renderZone(props: Partial<FileDropZoneProps> = {}): Promise<{
  readonly container: HTMLElement;
  readonly onSelect: ReturnType<typeof vi.fn<FileDropZoneProps['onSelect']>>;
}> {
  const onSelect = vi.fn<FileDropZoneProps['onSelect']>();
  const { container } = await render(
    <div className="bg-background p-4 text-foreground">
      <FileDropZone
        label={LABEL}
        accept={ACCEPT}
        onSelect={onSelect}
        {...props}
      />
    </div>,
  );
  return { container, onSelect };
}

function fileInputOf(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('ファイルの入力欄が描画されていません。');
  }
  return input;
}

function dropZoneOf(container: HTMLElement): HTMLElement {
  const zone = container.querySelector<HTMLElement>(
    '[data-slot="file-drop-zone"]',
  );
  if (zone === null) {
    throw new Error('ドロップの領域が描画されていません。');
  }
  return zone;
}

// 選択の画面は入力欄のクリックで開くため、クリックを数えて既定の動作を止め、テスト中に画面を開かない
function countPickerOpenings(input: HTMLInputElement): { count: number } {
  const openings = { count: 0 };
  input.addEventListener('click', (event) => {
    openings.count += 1;
    event.preventDefault();
  });
  return openings;
}

function transferOf(files: readonly File[]): DataTransfer {
  const transfer = new DataTransfer();
  for (const file of files) {
    transfer.items.add(file);
  }
  return transfer;
}

function dispatchDrag(
  target: Element,
  type: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  transfer: DataTransfer,
): DragEvent {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    dataTransfer: transfer,
  });
  target.dispatchEvent(event);
  return event;
}

const namesOf = (files: readonly File[]): readonly string[] =>
  files.map(({ name }) => name);

afterEach(() => {
  applyColorScheme('light');
});

describe('FileDropZone', () => {
  test('acceptが許可形式の一覧になり、カメラか端末内のファイルかを利用者が選べるようcaptureを付けない', async () => {
    const { container } = await renderZone();
    const input = fileInputOf(container);

    expect(input.accept).toBe('image/jpeg,image/png,image/svg+xml');
    expect(input.multiple).toBe(false);
    expect(input.hasAttribute('capture')).toBe(false);
  });

  test('複数の選択を指定すると、入力欄で複数のファイルを選べる', async () => {
    const { container } = await renderZone({ multiple: true });

    expect(fileInputOf(container).multiple).toBe(true);
  });

  test('ボタンのクリックで選択の画面を開く', async () => {
    const { container } = await renderZone();
    const openings = countPickerOpenings(fileInputOf(container));

    await selectButton().click();

    expect(openings.count).toBe(1);
  });

  test.each(['{Enter}', ' '])(
    'キーボードだけでボタンへ移り、%sで選択の画面を開く',
    async (key) => {
      const { container } = await renderZone();
      const openings = countPickerOpenings(fileInputOf(container));

      await userEvent.tab();
      await expect.element(selectButton()).toHaveFocus();
      await userEvent.keyboard(key);

      expect(openings.count).toBe(1);
    },
  );

  test('選択の画面で選んだファイルを渡し、同じファイルを選び直せるよう入力欄を空に戻す', async () => {
    const { container, onSelect } = await renderZone({ multiple: true });
    const input = fileInputOf(container);

    await userEvent.upload(input, [
      createSvgFile('logo.svg'),
      createDocumentFile('photo.png', 'image/png', 8),
    ]);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(namesOf(onSelect.mock.calls[0]?.[0] ?? [])).toStrictEqual([
      'logo.svg',
      'photo.png',
    ]);
    expect(input.value).toBe('');
  });

  test('ファイルをドラッグしている間は枠とテキストで示し、領域から出ると戻す', async () => {
    const { container } = await renderZone();
    const zone = dropZoneOf(container);
    const transfer = transferOf([createSvgFile('logo.svg')]);

    await expect.element(page.getByText(IDLE_HINT)).toBeInTheDocument();
    expect(zone.dataset['dragging']).toBeUndefined();

    dispatchDrag(zone, 'dragenter', transfer);
    await expect.element(page.getByText(ACTIVE_HINT)).toBeInTheDocument();
    expect(zone.dataset['dragging']).toBe('true');

    dispatchDrag(selectButton().element(), 'dragenter', transfer);
    dispatchDrag(zone, 'dragleave', transfer);
    await expect.element(page.getByText(ACTIVE_HINT)).toBeInTheDocument();

    dispatchDrag(selectButton().element(), 'dragleave', transfer);
    await expect.element(page.getByText(IDLE_HINT)).toBeInTheDocument();
    expect(zone.dataset['dragging']).toBeUndefined();
  });

  test('ドロップしたファイルを渡し、ドラッグ中の表示を戻す', async () => {
    const { container, onSelect } = await renderZone({ multiple: true });
    const zone = dropZoneOf(container);
    const files = [
      createSvgFile('logo.svg'),
      createDocumentFile('photo.jpg', 'image/jpeg', 8),
    ];
    const transfer = transferOf(files);

    dispatchDrag(zone, 'dragenter', transfer);
    const dragOver = dispatchDrag(zone, 'dragover', transfer);
    const drop = dispatchDrag(zone, 'drop', transfer);

    expect(dragOver.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(namesOf(onSelect.mock.calls[0]?.[0] ?? [])).toStrictEqual([
      'logo.svg',
      'photo.jpg',
    ]);
    await expect.element(page.getByText(IDLE_HINT)).toBeInTheDocument();
    expect(zone.dataset['dragging']).toBeUndefined();
  });

  test('ファイルでない内容のドラッグは示さず、ドロップしても渡さない', async () => {
    const { container, onSelect } = await renderZone();
    const zone = dropZoneOf(container);
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'テキスト');

    dispatchDrag(zone, 'dragenter', transfer);
    const dragOver = dispatchDrag(zone, 'dragover', transfer);
    dispatchDrag(zone, 'drop', transfer);

    expect(dragOver.defaultPrevented).toBe(false);
    expect(zone.dataset['dragging']).toBeUndefined();
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('無効の間はボタンを押せず、ドラッグを示さず、ドロップしても渡さない', async () => {
    const { container, onSelect } = await renderZone({ disabled: true });
    const zone = dropZoneOf(container);
    const transfer = transferOf([createSvgFile('logo.svg')]);

    await expect.element(selectButton()).toBeDisabled();
    expect(fileInputOf(container).disabled).toBe(true);

    dispatchDrag(zone, 'dragenter', transfer);
    const dragOver = dispatchDrag(zone, 'dragover', transfer);
    dispatchDrag(zone, 'drop', transfer);

    expect(dragOver.defaultPrevented).toBe(false);
    expect(zone.dataset['dragging']).toBeUndefined();
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('ボタンに説明とエラーの関連付け・エラーの状態を渡す', async () => {
    await renderZone({
      'aria-describedby': 'logo-description logo-message',
      'aria-invalid': true,
    });

    const button = selectButton().element();
    expect(button.getAttribute('aria-describedby')).toBe(
      'logo-description logo-message',
    );
    expect(button.getAttribute('aria-invalid')).toBe('true');
  });

  test('欄のラベルを指定しないときは、見えているボタンの文言だけを名前にする', async () => {
    await renderZone();

    await expect
      .element(page.getByRole('button', { name: LABEL, exact: true }))
      .toBeInTheDocument();
  });

  test('フォームの欄に置くと、欄のラベルと見えているボタンの文言の両方を名前にする', async () => {
    const schema = z.object({ logo: z.string() });
    function LogoForm() {
      const form = useAppForm(schema, { defaultValues: { logo: '' } });
      return (
        <AppForm
          form={form}
          onSubmit={() => undefined}
          onSubmitError={() => undefined}
          aria-label="プロダクト"
        >
          <FormField control={form.control} name="logo" label="ロゴ">
            {(control) => (
              <FileDropZone
                label={LABEL}
                accept={ACCEPT}
                onSelect={() => undefined}
                aria-labelledby={control.labelId}
                aria-describedby={control['aria-describedby']}
                aria-invalid={control['aria-invalid']}
              />
            )}
          </FormField>
        </AppForm>
      );
    }
    const { container } = await render(<LogoForm />);

    await expect
      .element(page.getByRole('button', { name: `ロゴ ${LABEL}`, exact: true }))
      .toBeInTheDocument();
    expect(await runAxe(container)).toStrictEqual([]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('通常・ドラッグ中・無効のどれでもアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await renderZone();

      expect(await runAxe(container)).toStrictEqual([]);

      dispatchDrag(
        dropZoneOf(container),
        'dragenter',
        transferOf([createSvgFile('logo.svg')]),
      );
      await expect.element(page.getByText(ACTIVE_HINT)).toBeInTheDocument();

      expect(await runAxe(container)).toStrictEqual([]);

      const disabled = await renderZone({ disabled: true });

      expect(await runAxe(disabled.container)).toStrictEqual([]);
    });
  });
});
