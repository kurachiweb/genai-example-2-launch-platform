import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../../../styles/base.css';
import {
  elementIn,
  NEXT_BUTTON,
  placeCursorAtEnd,
  PREVIOUS_BUTTON,
  renderSurface,
} from './surface-test-harness.ts';

const transferOf = (
  data: Readonly<Record<string, string>>,
  files: readonly File[] = [],
): DataTransfer => {
  const transfer = new DataTransfer();
  for (const [type, value] of Object.entries(data)) {
    transfer.setData(type, value);
  }
  for (const file of files) {
    transfer.items.add(file);
  }
  return transfer;
};

const pasteInto = (editable: HTMLElement, transfer: DataTransfer): Event => {
  const event = new ClipboardEvent('paste', {
    clipboardData: transfer,
    bubbles: true,
    cancelable: true,
  });
  editable.dispatchEvent(event);
  return event;
};

const dropOnto = (editable: HTMLElement, transfer: DataTransfer): Event => {
  const { left, top, width, height } = editable.getBoundingClientRect();
  const event = new DragEvent('drop', {
    dataTransfer: transfer,
    clientX: left + width / 2,
    clientY: top + height / 2,
    bubbles: true,
    cancelable: true,
  });
  editable.dispatchEvent(event);
  return event;
};

const imageFile = (): File =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'screenshot.png', {
    type: 'image/png',
  });

// ファイルからの画像の挿入は非同期に行われるため、挿入されないことを確かめる前に描画を2回待つ
async function settle(): Promise<void> {
  for (let frame = 0; frame < 2; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

const DROP_INDICATOR_HIDE_DELAY_MS = 30;

// ドロップの位置の表示はドロップの30ms後に消え、その前に編集領域を破棄すると消す処理が破棄後の文脈を読んで失敗するため、消えるまで待つ
async function waitForDropIndicatorHidden(): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, DROP_INDICATOR_HIDE_DELAY_MS * 2),
  );
}

const buttonNamed = (name: string): HTMLElement => {
  const button = [...document.querySelectorAll<HTMLElement>('button')].find(
    (candidate) => candidate.textContent === name,
  );
  if (button === undefined) {
    throw new Error(`${name}のボタンが描画されていません。`);
  }
  return button;
};

const FORBIDDEN_MARKDOWN = [
  '# 大会の**概要**',
  '',
  '本文の![代替テキスト](https://client.example/a.png "題")と[![リンクの画像](https://client.example/b.png)](https://client.example/)。',
  '',
  '## 見出しレベル2',
].join('\n');

const LITERALIZED_MARKDOWN = [
  '\\# 大会の**概要**',
  '',
  '本文の!\\[代替テキスト]\\(https\\://client.example/a.png)と[!\\[リンクの画像\\](https://client.example/b.png)](https://client.example/)。',
  '',
  '## 見出しレベル2',
  '',
].join('\n');

afterEach(() => {
  document.body.replaceChildren();
});

describe('CrepeEditorSurfaceの入力の制限', () => {
  describe('見出しレベル1と画像', () => {
    test('行頭の「# 」の入力は見出しにせず、「# 」付きの段落のまま保つ', async () => {
      const { editable, controller } = await renderSurface();
      editable.focus();

      await userEvent.keyboard('# 見出しのつもり');

      expect(editable.querySelector('h1')).toBeNull();
      expect(elementIn(editable, 'p').textContent).toBe('# 見出しのつもり');
      expect(controller.readMarkdown()).toBe('\\# 見出しのつもり\n');
    });

    test.each([2, 3, 4, 5, 6])(
      '行頭の「#」%i個と空白の入力は同じレベルの見出しにする',
      async (level) => {
        const { editable, controller } = await renderSurface();
        editable.focus();

        await userEvent.keyboard(`${'#'.repeat(level)} 見出し`);

        expect(elementIn(editable, `h${String(level)}`).textContent).toBe(
          '見出し',
        );
        expect(controller.readMarkdown()).toBe(`${'#'.repeat(level)} 見出し\n`);
      },
    );

    test('見出しレベル1のショートカットは効かず、レベル2のショートカットは効く', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '本文',
      });
      await placeCursorAtEnd(editable, elementIn(editable, 'p'));

      await userEvent.keyboard('{ControlOrMeta>}{Alt>}1{/Alt}{/ControlOrMeta}');

      expect(editable.querySelector('h1')).toBeNull();
      expect(controller.readMarkdown()).toBe('本文\n');

      await userEvent.keyboard('{ControlOrMeta>}{Alt>}2{/Alt}{/ControlOrMeta}');

      expect(controller.readMarkdown()).toBe('## 本文\n');
    });

    test('画像の記法の入力は画像にせず、文字列のまま保つ', async () => {
      const { editable, controller } = await renderSurface();
      editable.focus();

      await userEvent.keyboard(
        '![[代替テキスト](https://client.example/a.png)',
      );

      expect(editable.querySelector('img')).toBeNull();
      expect(elementIn(editable, 'p').textContent).toBe(
        '![代替テキスト](https://client.example/a.png)',
      );
      expect(controller.readMarkdown()).toBe(
        '!\\[代替テキスト]\\(https\\://client.example/a.png)\n',
      );
    });

    test.each<['initialValue' | 'replaceMarkdown', string]>([
      ['initialValue', '既存の値の読み込み'],
      ['replaceMarkdown', '外部からの値の置き換え'],
    ])(
      '%s(%s)で見出しレベル1と画像を文字列にし、読み直しても文字列のまま保つ',
      async (route) => {
        const { editable, controller } = await renderSurface(
          route === 'initialValue' ? { initialValue: FORBIDDEN_MARKDOWN } : {},
        );
        if (route === 'replaceMarkdown') {
          controller.replaceMarkdown(FORBIDDEN_MARKDOWN);
        }

        await expect
          .poll(() => editable.querySelector('h2')?.textContent)
          .toBe('見出しレベル2');
        expect(editable.querySelector('h1')).toBeNull();
        expect(editable.querySelector('img')).toBeNull();
        expect(elementIn(editable, 'p').textContent).toBe('# 大会の概要');
        expect(elementIn(editable, 'p strong').textContent).toBe('概要');
        expect(controller.readMarkdown()).toBe(LITERALIZED_MARKDOWN);

        // GFMのURLの自動リンクは解析後の文字列に掛かるため、読み直すと文字列にした画像のURLはリンクになる。文字列のまま保たれることだけを確かめる
        controller.replaceMarkdown(controller.readMarkdown());

        expect(editable.querySelector('h1')).toBeNull();
        expect(editable.querySelector('img')).toBeNull();
        expect(
          [...editable.querySelectorAll('p')].map((p) => p.textContent),
        ).toStrictEqual([
          '# 大会の概要',
          '本文の![代替テキスト](https://client.example/a.png)と![リンクの画像](https://client.example/b.png)。',
        ]);
      },
    );

    test('見出しレベル1と画像を含むマークダウンの貼り付けを文字列にする', async () => {
      const { editable, controller } = await renderSurface();
      editable.focus();

      pasteInto(
        editable,
        transferOf({
          'text/plain':
            '# 貼り付けた見出し\n\n![代替テキスト](https://client.example/a.png)',
        }),
      );

      await expect
        .poll(() => controller.readMarkdown())
        .toBe(
          '\\# 貼り付けた見出し\n\n!\\[代替テキスト]\\(https\\://client.example/a.png)\n',
        );
      expect(editable.querySelector('h1')).toBeNull();
      expect(editable.querySelector('img')).toBeNull();
    });

    test('見出しレベル1と画像を含むHTMLの貼り付けを文字列にする', async () => {
      const { editable, controller } = await renderSurface();
      editable.focus();

      pasteInto(
        editable,
        transferOf({
          'text/html':
            '<h1>貼り付けた見出し</h1><p>前<img src="https://client.example/a.png" alt="代替テキスト">後</p>',
          'text/plain': '貼り付けた見出し\n\n前後',
        }),
      );

      await expect
        .poll(() => controller.readMarkdown())
        .toBe(
          '\\# 貼り付けた見出し\n\n前!\\[代替テキスト]\\(https\\://client.example/a.png)後\n',
        );
      expect(editable.querySelector('h1')).toBeNull();
      expect(editable.querySelector('img')).toBeNull();
    });

    test('取り消すと、文字列にする前の見出しレベル1には戻らず入力の前に戻る', async () => {
      const { editable, controller } = await renderSurface();
      editable.focus();
      pasteInto(
        editable,
        transferOf({ 'text/html': '<h1>見出し</h1><p>本文</p>' }),
      );
      await expect
        .poll(() => controller.readMarkdown())
        .toBe('\\# 見出し\n\n本文\n');

      await userEvent.keyboard('{ControlOrMeta>}z{/ControlOrMeta}');

      expect(editable.querySelector('h1')).toBeNull();
      expect(controller.readMarkdown()).toBe('');
    });
  });

  describe('ファイルの貼り付けとドロップ', () => {
    test('ファイルの貼り付けでは何も挿入せず、ブラウザの既定の動作も止める', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '本文',
      });
      await placeCursorAtEnd(editable, elementIn(editable, 'p'));

      const event = pasteInto(editable, transferOf({}, [imageFile()]));
      await settle();

      expect(event.defaultPrevented).toBe(true);
      expect(editable.querySelector('img')).toBeNull();
      expect(controller.readMarkdown()).toBe('本文\n');
    });

    test('文字列とファイルを含む貼り付けでは、ファイルを挿入せず文字列だけを挿入する', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '本文',
      });
      await placeCursorAtEnd(editable, elementIn(editable, 'p'));

      const event = pasteInto(
        editable,
        transferOf({ 'text/plain': 'の追記' }, [imageFile()]),
      );
      await settle();

      expect(event.defaultPrevented).toBe(true);
      expect(editable.querySelector('img')).toBeNull();
      expect(controller.readMarkdown()).toBe('本文の追記\n');
    });

    test('ファイルのドロップでは何も挿入せず、ブラウザの既定の動作も止める', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '本文',
      });

      const event = dropOnto(
        editable,
        transferOf({ 'text/uri-list': 'file:///tmp/screenshot.png' }, [
          imageFile(),
        ]),
      );
      await waitForDropIndicatorHidden();

      expect(event.defaultPrevented).toBe(true);
      expect(editable.querySelector('img')).toBeNull();
      expect(controller.readMarkdown()).toBe('本文\n');
    });
  });

  describe('Tabキーとリスト・表の操作', () => {
    test.each<[string, string, string]>([
      ['段落', '本文', 'p'],
      ['リストの項目', '- 項目1\n- 項目2', 'li:last-of-type p'],
      [
        '表のセル',
        '| 項目 | 説明 |\n| --- | --- |\n| 投票 | 1日1回まで |',
        'td',
      ],
    ])(
      '%sの中でTabキーは次の要素へ、Shift+Tabキーは前の要素へフォーカスを移し、内容を変えない',
      async (_, initialValue, selector) => {
        const { editable, controller } = await renderSurface({ initialValue });
        const before = controller.readMarkdown();
        await placeCursorAtEnd(editable, elementIn(editable, selector));

        await userEvent.tab();

        expect(document.activeElement).toBe(buttonNamed(NEXT_BUTTON));

        await placeCursorAtEnd(editable, elementIn(editable, selector));
        await userEvent.tab({ shift: true });

        expect(document.activeElement).toBe(buttonNamed(PREVIOUS_BUTTON));
        expect(controller.readMarkdown()).toBe(before);
      },
    );

    test('リストの階層をMod-]で下げ、Mod-[で上げる', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '- 項目1\n- 項目2',
      });
      await placeCursorAtEnd(
        editable,
        elementIn(editable, 'li:last-of-type p'),
      );

      await userEvent.keyboard('{ControlOrMeta>}]{/ControlOrMeta}');

      expect(editable.querySelectorAll('ul ul li')).toHaveLength(1);
      expect(controller.readMarkdown()).toBe('* 項目1\n  * 項目2\n');

      await userEvent.keyboard('{ControlOrMeta>}[[{/ControlOrMeta}');

      expect(editable.querySelectorAll('ul ul li')).toHaveLength(0);
      expect(controller.readMarkdown()).toBe('* 項目1\n* 項目2\n');
      expect(document.activeElement).toBe(editable);
    });

    test.each<[string, KeyboardEventInit]>([
      ['Command+[', { key: '[', code: 'BracketLeft', metaKey: true }],
      ['Command+]', { key: ']', code: 'BracketRight', metaKey: true }],
      ['Ctrl+[', { key: '[', code: 'BracketLeft', ctrlKey: true }],
      ['Ctrl+]', { key: ']', code: 'BracketRight', ctrlKey: true }],
    ])(
      'リストと表の外の%sでも、ブラウザの戻る・進むの既定の動作を止め、内容を変えない',
      async (_, init) => {
        const { editable, controller } = await renderSurface({
          initialValue: '本文',
        });
        await placeCursorAtEnd(editable, elementIn(editable, 'p'));
        const before = controller.readMarkdown();

        const event = new KeyboardEvent('keydown', {
          ...init,
          bubbles: true,
          cancelable: true,
        });
        editable.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(controller.readMarkdown()).toBe(before);
      },
    );

    test('角括弧以外のキーとの組み合わせの既定の動作は止めない', async () => {
      const { editable } = await renderSurface({ initialValue: '本文' });
      await placeCursorAtEnd(editable, elementIn(editable, 'p'));

      const event = new KeyboardEvent('keydown', {
        key: 'l',
        code: 'KeyL',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      editable.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    });

    test('表のセルをMod-]で次へ移る', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '| 項目 | 説明 |\n| --- | --- |\n| 投票 | 回数 |',
      });
      await placeCursorAtEnd(editable, elementIn(editable, 'td'));

      await userEvent.keyboard('{ControlOrMeta>}]{/ControlOrMeta}追記');

      expect(controller.readMarkdown()).toMatch(/^\| 投票 \| 追記回数 \|$/m);
    });
  });
});
