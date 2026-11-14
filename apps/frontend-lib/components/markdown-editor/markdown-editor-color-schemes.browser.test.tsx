import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { MarkdownRenderOptions } from '../../../common-lib/markdown/markdown-options.ts';
import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
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

const LABEL_ID = 'markdown-editor-label';

const DESCRIPTION_ID = 'markdown-editor-description';

const LABEL = '本文';

const LOADING_STATUS = 'エディタを読み込んでいます';

const PREVIEW: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
  idScope: 'preview',
};

// 編集領域の文字組みが背景や線を付ける要素(インラインコード・コードブロック・引用)を含め、配色ごとのコントラストを確かめる
const SAMPLE = [
  '## 大会の見出し',
  '',
  '**投票**で競います。[要項](https://client.example/rules)と[外部](https://other.example/docs)。',
  '',
  '- 箇条書きの項目',
  '',
  '| 項目 | 説明 |',
  '| --- | --- |',
  '| 投票 | 1日1回まで |',
  '',
  '`bun run build`で組み立てます。',
  '',
  '```ts',
  "const vote = 'ok';",
  '```',
  '',
  '> 引用の文章',
].join('\n');

const STYLED_ELEMENTS = ['code', 'pre', 'blockquote'] as const;

interface SampleEditorProps {
  readonly invalid?: boolean;
}

function SampleEditor({ invalid = false }: SampleEditorProps) {
  const [value, setValue] = useState(SAMPLE);
  return (
    <div className="grid gap-2 p-4">
      <span id={LABEL_ID} className="text-sm font-medium">
        {LABEL}
      </span>
      <p id={DESCRIPTION_ID} className="text-sm text-muted-foreground">
        マークダウンで書けます。
      </p>
      <MarkdownEditor
        value={value}
        onValueChange={setValue}
        onBlur={() => undefined}
        labelId={LABEL_ID}
        describedById={DESCRIPTION_ID}
        invalid={invalid}
        maxGraphemes={2000}
        placeholder="コメントを入力してください"
        preview={PREVIEW}
      />
    </div>
  );
}

const editable = () => page.getByRole('textbox', { name: LABEL });

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

const missingStyledElements = (root: Element): readonly string[] =>
  STYLED_ELEMENTS.filter((selector) => root.querySelector(selector) === null);

beforeEach(() => {
  vi.mocked(loadCrepeEditor).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('MarkdownEditor', () => {
  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('「書く」と「プレビュー」の両方で、コード・コードブロック・引用を含めてアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(<SampleEditor invalid />);
      const body = await waitForEditor();
      expect(missingStyledElements(body)).toStrictEqual([]);

      expect(await runAxe(container)).toStrictEqual([]);

      await userEvent.click(page.getByRole('tab', { name: 'プレビュー' }));

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('読み込み中の表示で、コード・コードブロック・引用を含めてアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(loadCrepeEditor).mockImplementationOnce(() =>
        actualLoadCrepeEditor(() => gate.then(importCrepeEditorSurface)),
      );
      const { container } = await render(<SampleEditor />);
      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent(LOADING_STATUS);
      expect(missingStyledElements(container)).toStrictEqual([]);

      expect(await runAxe(container)).toStrictEqual([]);

      release();
      await waitForEditor();
    });
  });
});
