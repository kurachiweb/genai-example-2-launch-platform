import { useState } from 'react';
import { afterEach, describe, expect, type Mock, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import type { EditorController, EditorLink } from './editor-controller.ts';
import { MarkdownLinkDialog } from './markdown-link-dialog.tsx';

const EDITABLE_ID = 'markdown-editor-body';

const OPENER = 'リンクを編集';

const DIALOG_TITLE = 'リンクの設定';

const FORMAT_ERROR =
  '"https://"・"http://"・"mailto:"で始まるURLか、"#"で始まるページ内のリンクを入力してください。';

type FakeController = {
  readonly [Key in keyof EditorController]: Mock<EditorController[Key]>;
};

const createController = (link: EditorLink | undefined): FakeController => ({
  run: vi.fn<EditorController['run']>(),
  currentLink: vi.fn<EditorController['currentLink']>(() => link),
  applyLink: vi.fn<EditorController['applyLink']>(),
  replaceMarkdown: vi.fn<EditorController['replaceMarkdown']>(),
  readMarkdown: vi.fn<EditorController['readMarkdown']>(() => ''),
  focus: vi.fn<EditorController['focus']>(() => {
    document.getElementById(EDITABLE_ID)?.focus();
  }),
});

interface LinkDialogHarnessProps {
  readonly controller: EditorController;
}

// 開く操作は外枠のツールバーの項目を模し、閉じた後のフォーカスが開いた元ではなく編集領域へ戻ることを確かめる
function LinkDialogHarness({ controller }: LinkDialogHarnessProps) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {OPENER}
      </button>
      <div
        id={EDITABLE_ID}
        role="textbox"
        aria-label="本文"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
      >
        本文
      </div>
      <MarkdownLinkDialog
        open={open}
        controller={controller}
        onOpenChange={setOpen}
      />
    </div>
  );
}

const dialog = () => page.getByRole('dialog', { name: DIALOG_TITLE });

const urlInput = () => dialog().getByRole('textbox', { name: 'URL' });

const buttonInDialog = (name: string) =>
  dialog().getByRole('button', { name, exact: true });

const editable = () => page.getByRole('textbox', { name: '本文' });

async function openDialog(link?: EditorLink) {
  const controller = createController(link);
  const screen = await render(<LinkDialogHarness controller={controller} />);
  await userEvent.click(page.getByRole('button', { name: OPENER }));
  await expect.element(dialog()).toBeInTheDocument();
  return { controller, container: screen.container };
}

async function expectClosedWithEditableFocused(
  controller: FakeController,
): Promise<void> {
  await expect.element(dialog()).not.toBeInTheDocument();
  await expect.element(editable()).toHaveFocus();
  expect(controller.focus).toHaveBeenCalledOnce();
}

afterEach(() => {
  applyColorScheme('light');
});

describe('MarkdownLinkDialog', () => {
  test('リンクの無い選択で開くと、空のURLの欄へフォーカスを移し、解除の操作を出さない', async () => {
    await openDialog();

    await expect.element(urlInput()).toHaveFocus();
    await expect.element(urlInput()).toHaveValue('');
    await expect
      .element(buttonInDialog('リンクを解除'))
      .not.toBeInTheDocument();
    await expect.element(buttonInDialog('設定')).toBeInTheDocument();
    await expect.element(buttonInDialog('キャンセル')).toBeInTheDocument();
  });

  test('リンクのある選択で開くと、現在のURLを欄に入れて解除の操作を出す', async () => {
    await openDialog({ href: 'https://launch.example/rules' });

    await expect
      .element(urlInput())
      .toHaveValue('https://launch.example/rules');
    await expect.element(buttonInDialog('リンクを解除')).toBeInTheDocument();
  });

  test('URLを入力してEnterキーで設定すると、前後の空白を除いたURLでリンクを設定して閉じ、編集領域へフォーカスを戻す', async () => {
    const { controller } = await openDialog();

    await userEvent.keyboard('  https://launch.example/docs  {Enter}');

    expect(controller.applyLink).toHaveBeenCalledExactlyOnceWith(
      'https://launch.example/docs',
    );
    await expectClosedWithEditableFocused(controller);
  });

  test.each([
    'http://launch.example/',
    'HTTPS://launch.example/',
    'mailto:support@launch.example',
    '#launch-rules',
  ])(
    '「%s」は受け付けて、キーボードだけで設定のボタンを押して設定する',
    async (href) => {
      const { controller } = await openDialog();

      await userEvent.keyboard(href);
      await userEvent.tab();
      await expect.element(buttonInDialog('キャンセル')).toHaveFocus();
      await userEvent.tab();
      await expect.element(buttonInDialog('設定')).toHaveFocus();
      await userEvent.keyboard('{Enter}');

      expect(controller.applyLink).toHaveBeenCalledExactlyOnceWith(href);
      await expectClosedWithEditableFocused(controller);
    },
  );

  test('キーボードだけで「リンクを解除」を押すと、リンクを解除して閉じ、編集領域へフォーカスを戻す', async () => {
    const { controller } = await openDialog({
      href: 'https://launch.example/rules',
    });

    await userEvent.tab();
    await userEvent.tab();
    await expect.element(buttonInDialog('リンクを解除')).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(controller.applyLink).toHaveBeenCalledExactlyOnceWith(undefined);
    await expectClosedWithEditableFocused(controller);
  });

  test('「キャンセル」で閉じると、リンクを変えずに編集領域へフォーカスを戻す', async () => {
    const { controller } = await openDialog({
      href: 'https://launch.example/rules',
    });

    await userEvent.tab();
    await expect.element(buttonInDialog('キャンセル')).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    expect(controller.applyLink).not.toHaveBeenCalled();
    await expectClosedWithEditableFocused(controller);
  });

  test('Escapeキーで閉じると、入力中のURLを捨てて編集領域へフォーカスを戻す', async () => {
    const { controller } = await openDialog();

    await userEvent.keyboard('https://launch.example/{Escape}');

    expect(controller.applyLink).not.toHaveBeenCalled();
    await expectClosedWithEditableFocused(controller);
  });

  test.each([
    '',
    'launch.example',
    'javascript:alert(1)',
    '//launch.example',
    'https://',
    'http://',
    'https:// ',
    'https://:443/',
  ])(
    '「%s」で設定すると、欄の近くに形式違反を表示して欄を不正の状態にし、閉じずに欄へフォーカスを戻す',
    async (value) => {
      const { controller } = await openDialog();

      if (value !== '') {
        await userEvent.keyboard(value);
      }
      await userEvent.click(buttonInDialog('設定'));

      await expect
        .element(dialog().getByText(FORMAT_ERROR))
        .toBeInTheDocument();
      await expect.element(urlInput()).toHaveAttribute('aria-invalid', 'true');
      await expect
        .element(urlInput())
        .toHaveAccessibleDescription(FORMAT_ERROR);
      await expect.element(urlInput()).toHaveFocus();
      expect(controller.applyLink).not.toHaveBeenCalled();
    },
  );

  test('形式違反を表示した後は、受け付ける形式に直すと表示を消し、そのまま設定できる', async () => {
    const { controller } = await openDialog();
    await userEvent.keyboard('launch.example{Enter}');
    await expect.element(dialog().getByText(FORMAT_ERROR)).toBeInTheDocument();

    await userEvent.keyboard('{Control>}a{/Control}https://launch.example');

    await expect
      .element(dialog().getByText(FORMAT_ERROR))
      .not.toBeInTheDocument();
    await expect.element(urlInput()).not.toHaveAttribute('aria-invalid');
    await userEvent.keyboard('{Enter}');
    expect(controller.applyLink).toHaveBeenCalledExactlyOnceWith(
      'https://launch.example',
    );
  });

  test('開き直すと、前回の入力と形式違反の表示を残さず現在のリンクから始める', async () => {
    const { controller } = await openDialog();
    await userEvent.keyboard('launch.example{Enter}');
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog()).not.toBeInTheDocument();

    await userEvent.click(page.getByRole('button', { name: OPENER }));

    await expect.element(urlInput()).toHaveValue('');
    await expect
      .element(dialog().getByText(FORMAT_ERROR))
      .not.toBeInTheDocument();
    expect(controller.currentLink).toHaveBeenCalledTimes(2);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('既存のリンクを開いたダイアログで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await openDialog({ href: 'https://launch.example/rules' });

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('形式違反を表示したダイアログで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await openDialog();
      await userEvent.keyboard('launch.example{Enter}');
      await expect
        .element(dialog().getByText(FORMAT_ERROR))
        .toBeInTheDocument();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
