import { describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { MarkdownRenderOptions } from '../../../common-lib/markdown/markdown-options.ts';
import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
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

const LABEL = '本文';

const LOADING_STATUS = 'エディタを読み込んでいます';

const PREVIEW: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
  idScope: 'preview',
};

// 読み込みの前後で入力欄が動いたと感じない差として、端数の丸めの分だけを許す
const MAX_HEIGHT_DIFFERENCE_PX = 2;

// 折り返しの位置を前後でそろえるため、入力欄の幅を固定する
const EDITOR_WIDTH_PX = 480;

const lines = (...values: readonly string[]): string => values.join('\n');

// 最小の高さに隠れずに差が現れるよう、短い記法の前に段落を置く
const withLead = (...values: readonly string[]): string =>
  lines('最初の段落です。', '', '二番目の段落です。', '', ...values);

const TABLE_ROWS = [
  '| 項目 | 説明 |',
  '| --- | --- |',
  '| 投票 | 1日1回まで |',
  '| 評価 | 任意 |',
] as const;

const LAYOUT_CASES: readonly (readonly [string, string])[] = [
  ['空', ''],
  ['段落1つ', 'ひとつの段落だけの本文です。'],
  [
    '複数の段落',
    lines(
      '最初の段落です。',
      '',
      '二番目の段落は長めの文にして、入力欄の幅で折り返すようにします。大会の要項と投票の方法を説明する文章が続きます。',
      '',
      '最後の段落です。',
    ),
  ],
  [
    '見出し',
    lines(
      '## 見出しレベル2',
      '',
      '見出しの後の段落です。',
      '',
      '### 見出しレベル3',
      '',
      '段落です。',
      '',
      '#### 見出しレベル4',
      '',
      '段落です。',
    ),
  ],
  [
    'リスト',
    lines(
      '前の段落です。',
      '',
      '- 箇条書きの項目1',
      '- 箇条書きの項目2',
      '',
      '1. 番号付きの項目1',
      '2. 番号付きの項目2',
      '',
      '後の段落です。',
    ),
  ],
  ['入れ子のリスト', withLead('- 項目1', '  - 子の項目', '- 項目2')],
  [
    '空行で区切ったリスト',
    withLead('- 項目1', '', '- 項目2', '', '1. 番号1', '', '2. 番号2'),
  ],
  ['段落を含む項目', withLead('- 項目1', '', '  続きの段落', '- 項目2')],
  ['タスクリスト', withLead('- [ ] 未完了', '- [x] 完了')],
  ['引用', withLead('> 引用の段落', '', '後の段落です。')],
  [
    'コードブロック',
    withLead(
      '```',
      'const a = 1;',
      'const b = 2;',
      '```',
      '',
      '後の段落です。',
    ),
  ],
  ['インラインコード', withLead('本文の`code`です。')],
  ['区切り線', withLead('---', '', '後の段落です。')],
  ['表', withLead(...TABLE_ROWS, '', '後の段落です。')],
  ['表で始まる値', lines(...TABLE_ROWS, '| 期間 | 1週間 |')],
];

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function SizedEditor({ value }: { readonly value: string }) {
  return (
    <div className="grid gap-2 p-4" style={{ width: EDITOR_WIDTH_PX }}>
      <span id={LABEL_ID} className="text-sm font-medium">
        {LABEL}
      </span>
      <MarkdownEditor
        value={value}
        onValueChange={() => undefined}
        onBlur={() => undefined}
        labelId={LABEL_ID}
        maxGraphemes={2000}
        placeholder="コメントを入力してください"
        preview={PREVIEW}
      />
    </div>
  );
}

const editorHeight = (container: Element): number =>
  container
    .querySelector('[data-slot="markdown-editor"]')
    ?.getBoundingClientRect().height ?? Number.NaN;

describe('MarkdownEditor', () => {
  describe('読み込みの前後の大きさ', () => {
    test.each(LAYOUT_CASES)(
      '値が%sのとき、読み込みの前の仮の表示と読み込み後の編集領域で入力欄全体の高さがそろう',
      async (_label, value) => {
        const gate = deferred();
        vi.mocked(loadCrepeEditor).mockImplementationOnce(() =>
          actualLoadCrepeEditor(() =>
            gate.promise.then(importCrepeEditorSurface),
          ),
        );
        const { container } = await render(<SizedEditor value={value} />);
        await expect
          .element(page.getByRole('status'))
          .toHaveTextContent(LOADING_STATUS);
        const before = editorHeight(container);

        gate.resolve();

        await expect
          .element(page.getByRole('textbox', { name: LABEL }))
          .toBeInTheDocument();
        const after = editorHeight(container);
        expect(
          Math.abs(after - before),
          `読み込みの前${String(before)}px・後${String(after)}px`,
        ).toBeLessThanOrEqual(MAX_HEIGHT_DIFFERENCE_PX);
        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});
