import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { MarkdownRenderOptions } from '../../../common-lib/markdown/markdown-options.ts';
import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { z } from '../../utilities/validation/zod.ts';
import { AppForm } from '../form/app-form.tsx';
import { FormField } from '../form/form-field.tsx';
import { useAppForm } from '../form/use-app-form.ts';
import {
  importCrepeEditorSurface,
  loadCrepeEditor,
} from './load-crepe-editor.ts';
import { MarkdownEditor } from './markdown-editor.tsx';

vi.mock('./load-crepe-editor.ts', async (importOriginal) => {
  const actual = await importOriginal<{
    readonly loadCrepeEditor: typeof loadCrepeEditor;
  }>();
  return { ...actual, loadCrepeEditor: vi.fn(actual.loadCrepeEditor) };
});

const { loadCrepeEditor: actualLoadCrepeEditor } = await vi.importActual<{
  readonly loadCrepeEditor: typeof loadCrepeEditor;
}>('./load-crepe-editor.ts');

const LABEL = '本文';

const LOADING_STATUS = 'エディタを読み込んでいます';

const DESCRIPTION = '投稿の説明の文章';

const PREVIEW: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
  idScope: 'preview',
};

const bodySchema = z.object({ body: z.string() });

function BodyForm() {
  const form = useAppForm(bodySchema, { defaultValues: { body: '本文の値' } });
  return (
    <AppForm
      form={form}
      onSubmit={() => undefined}
      onSubmitError={() => undefined}
      aria-label="投稿"
      className="grid gap-4 p-4"
    >
      <button type="button">前の要素</button>
      <p>{DESCRIPTION}</p>
      <FormField control={form.control} name="body" label={LABEL}>
        {(control) => (
          <MarkdownEditor
            value={control.value}
            onValueChange={control.onChange}
            onBlur={control.onBlur}
            ref={control.ref}
            labelId={control.labelId}
            describedById={control['aria-describedby']}
            invalid={control['aria-invalid'] === true}
            disabled={control.disabled === true}
            maxGraphemes={2000}
            placeholder="コメントを入力してください"
            preview={PREVIEW}
          />
        )}
      </FormField>
    </AppForm>
  );
}

const SPAN_LABEL_ID = 'markdown-editor-label';

// 共通部品のラベルは文字を選択させないため、文字を選択できる要素をラベルにした入力欄で選択の扱いを確かめる
function SpanLabelledEditor({
  disabled = false,
}: {
  readonly disabled?: boolean;
}) {
  const [value, setValue] = useState('本文の値');
  return (
    <div className="grid gap-2 p-4">
      <span id={SPAN_LABEL_ID} className="text-sm font-medium">
        {LABEL}
      </span>
      <MarkdownEditor
        value={value}
        onValueChange={setValue}
        onBlur={() => undefined}
        labelId={SPAN_LABEL_ID}
        disabled={disabled}
        maxGraphemes={2000}
        placeholder="コメントを入力してください"
        preview={PREVIEW}
      />
    </div>
  );
}

const editable = () => page.getByRole('textbox', { name: LABEL });

const label = () => page.getByText(LABEL, { exact: true });

async function waitForEditor(): Promise<HTMLElement> {
  await expect.element(editable()).toBeInTheDocument();
  await expect
    .element(
      page
        .getByRole('toolbar', { name: '書式' })
        .getByRole('button', { name: '太字', exact: true }),
    )
    .not.toHaveAttribute('disabled');
  return editable().element() as HTMLElement;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function selectContents(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

beforeEach(() => {
  vi.mocked(loadCrepeEditor).mockClear();
  window.getSelection()?.removeAllRanges();
});

describe('MarkdownEditor', () => {
  describe('ラベルの押下', () => {
    test('欄のラベルを押すと編集領域へフォーカスを移す', async () => {
      const { container } = await render(<BodyForm />);
      const body = await waitForEditor();
      await userEvent.click(page.getByRole('button', { name: '前の要素' }));

      await userEvent.click(label());

      await expect.poll(() => document.activeElement).toBe(body);
      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('読み込みの前にラベルを押すと、要求を保留して読み込みの後に編集領域へ移す', async () => {
      const gate = deferred();
      vi.mocked(loadCrepeEditor).mockImplementationOnce(() =>
        actualLoadCrepeEditor(() =>
          gate.promise.then(importCrepeEditorSurface),
        ),
      );
      await render(<BodyForm />);
      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent(LOADING_STATUS);

      await userEvent.click(label());
      gate.resolve();

      const body = await waitForEditor();
      await expect.poll(() => document.activeElement).toBe(body);
    });

    test('プレビュー中にラベルを押すと、書く側へ戻して編集領域へ移す', async () => {
      await render(<BodyForm />);
      const body = await waitForEditor();
      await userEvent.click(page.getByRole('tab', { name: 'プレビュー' }));

      await userEvent.click(label());

      await expect
        .element(page.getByRole('tab', { name: '書く' }))
        .toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => document.activeElement).toBe(body);
    });

    test('ラベルの外の文字を選択した後に欄のラベルを押すと、編集領域へフォーカスを移す', async () => {
      await render(<BodyForm />);
      const body = await waitForEditor();
      selectContents(page.getByText(DESCRIPTION, { exact: true }).element());

      await userEvent.click(label());

      await expect.poll(() => document.activeElement).toBe(body);
    });

    test('編集領域の中を選択した後に欄のラベルを押すと、編集領域にフォーカスを戻す', async () => {
      await render(<BodyForm />);
      const body = await waitForEditor();
      body.focus();
      selectContents(body);
      expect(window.getSelection()?.isCollapsed).toBe(false);

      await userEvent.click(label());

      await expect.poll(() => document.activeElement).toBe(body);
    });

    test('ラベルの文字を選択した後の押下では、フォーカスを移さず選択を保つ', async () => {
      await render(<SpanLabelledEditor />);
      const body = await waitForEditor();
      const element = label().element();
      selectContents(element);

      // 文字をドラッグで選択して離すと、選択を残したままラベルの要素へ押下が届く
      element.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
      );
      await sleep(100);

      expect(window.getSelection()?.toString()).toBe(LABEL);
      expect(document.activeElement).not.toBe(body);
    });

    test('文字を選択できる要素をラベルにした時も、押すと編集領域へフォーカスを移す', async () => {
      await render(<SpanLabelledEditor />);
      const body = await waitForEditor();

      await userEvent.click(label());

      await expect.poll(() => document.activeElement).toBe(body);
    });

    test('無効の欄では、プレビュー中にラベルを押しても書く側へ戻さずフォーカスを移さない', async () => {
      await render(<SpanLabelledEditor disabled />);
      await expect.element(editable()).toBeInTheDocument();
      const body = editable().element();
      await userEvent.click(page.getByRole('tab', { name: 'プレビュー' }));

      await userEvent.click(label());
      await sleep(100);

      await expect
        .element(page.getByRole('tab', { name: 'プレビュー' }))
        .toHaveAttribute('aria-selected', 'true');
      expect(document.activeElement).not.toBe(body);
    });
  });
});
