import { afterEach, describe, expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  computedColorOf,
  outlineOf,
  ringOutline,
  tokenColorOf,
} from '../../../test/computed-style.ts';
import type { EditorAction } from '../editor-controller.ts';
import {
  DESCRIPTION_ID,
  elementIn,
  ERROR_ID,
  LABEL_ID,
  PLACEHOLDER,
  renderSurface,
  selectAll,
  selectRange,
  selectTextOf,
} from './surface-test-harness.ts';

afterEach(() => {
  applyColorScheme('light');
  document.body.replaceChildren();
});

describe('CrepeEditorSurface', () => {
  describe('初期値と書式の見た目', () => {
    test('初期値のマークダウンを書式を適用した見た目で表示する', async () => {
      const { editable } = await renderSurface({
        initialValue: '## 大会の見出し\n\n本文の**太字**と*斜体*。',
      });

      expect(elementIn(editable, 'h2').textContent).toBe('大会の見出し');
      expect(elementIn(editable, 'strong').textContent).toBe('太字');
      expect(elementIn(editable, 'em').textContent).toBe('斜体');
    });

    test('空の値ではプレースホルダーの文を表示する', async () => {
      const { editable } = await renderSurface();

      expect(
        elementIn(editable, '[data-placeholder]').dataset.placeholder,
      ).toBe(PLACEHOLDER);
    });

    test('タスクの項目の完了・未完了を文言で伝え、書き戻しに文言を含めない', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '- [x] 済み\n- [ ] 未着手',
      });

      const items = [
        ...editable.querySelectorAll<HTMLElement>('li[data-item-type="task"]'),
      ];
      expect(
        items.map((item) => {
          const state = elementIn(item, '.sr-only');
          return [
            state.textContent,
            state.getAttribute('contenteditable'),
            item.textContent,
          ];
        }),
      ).toStrictEqual([
        ['完了', 'false', '完了済み'],
        ['未完了', 'false', '未完了未着手'],
      ]);
      expect(controller.readMarkdown()).toBe('* [x] 済み\n* [ ] 未着手\n');
    });

    test('タスクの項目の状態が変わると文言を更新する', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '- [ ] 未着手',
      });

      controller.replaceMarkdown('- [x] 済み');

      await expect
        .poll(
          () =>
            editable.querySelector('li[data-item-type="task"] .sr-only')
              ?.textContent,
        )
        .toBe('完了');
    });
  });

  describe('制御器', () => {
    test('マークダウンの原文を読み取り、置き換える', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '最初の本文',
      });

      expect(controller.readMarkdown()).toBe('最初の本文\n');

      controller.replaceMarkdown('## 置き換えた見出し\n\n置き換えた本文');

      await expect
        .poll(() => editable.querySelector('h2')?.textContent)
        .toBe('置き換えた見出し');
      expect(controller.readMarkdown()).toBe(
        '## 置き換えた見出し\n\n置き換えた本文\n',
      );
    });

    test.each<[Exclude<EditorAction, 'link'>, string]>([
      ['heading', '## 本文\n'],
      ['bold', '**本文**\n'],
      ['italic', '*本文*\n'],
      ['inlineCode', '`本文`\n'],
      ['bulletList', '* 本文\n'],
      ['orderedList', '1. 本文\n'],
      ['blockquote', '> 本文\n'],
      ['codeBlock', '```\n本文\n```\n'],
    ])('%sの操作で書式を適用する', async (action, expected) => {
      const { editable, controller } = await renderSurface({
        initialValue: '本文',
      });
      await selectAll(editable);

      controller.run(action);

      expect(controller.readMarkdown()).toBe(expected);
    });

    test('見出しの操作は見出しレベル2と段落を切り替える', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '## 本文',
      });
      await selectAll(editable);

      controller.run('heading');

      expect(controller.readMarkdown()).toBe('本文\n');
    });

    test('表の操作で既定の大きさの表を挿入する', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '本文',
      });
      editable.focus();

      controller.run('table');

      await expect.poll(() => editable.querySelectorAll('tr').length).toBe(3);
      expect(editable.querySelectorAll('tr')[0]?.children).toHaveLength(3);
      expect(controller.readMarkdown()).toMatch(/^\|(?: *:?-+:? *\|){3}$/m);
    });

    test.each<[string, string | undefined, string]>([
      ['設定', '#entry', '[大会の要項](#entry)\n'],
      ['解除', undefined, '大会の要項\n'],
    ])(
      'リンクの一部を選んで%sすると、リンク全体に掛ける',
      async (_, href, expected) => {
        const { editable, controller } = await renderSurface({
          initialValue: '[大会の要項](https://client.example/rules)',
        });
        const link = elementIn(editable, 'a');
        await selectRange(editable, link.firstChild ?? link, 1, 3);

        controller.applyLink(href);

        expect(controller.readMarkdown()).toBe(expected);
      },
    );

    test('選択した文字列にリンクを設定し、現在のリンクを返し、解除する', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '大会の要項',
      });
      await selectAll(editable);

      controller.applyLink('https://client.example/rules');

      expect(controller.readMarkdown()).toBe(
        '[大会の要項](https://client.example/rules)\n',
      );
      expect(controller.currentLink()).toStrictEqual({
        href: 'https://client.example/rules',
      });

      controller.applyLink('#entry');

      expect(controller.readMarkdown()).toBe('[大会の要項](#entry)\n');

      controller.applyLink(undefined);

      expect(controller.readMarkdown()).toBe('大会の要項\n');
      expect(controller.currentLink()).toBeUndefined();
    });

    test('リンクの中にカーソルがあれば、リンク全体を現在のリンクとし解除する', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '前の文[大会の要項](https://client.example/rules)後の文',
      });
      const link = elementIn(editable, 'a');
      await selectRange(editable, link.firstChild ?? link, 2, 2);

      expect(controller.currentLink()).toStrictEqual({
        href: 'https://client.example/rules',
      });

      controller.applyLink(undefined);

      expect(controller.readMarkdown()).toBe('前の文大会の要項後の文\n');
    });

    test('選択範囲が空でリンクが無ければ、URLをリンクの文字列として挿入する', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '',
      });
      editable.focus();

      controller.applyLink('https://client.example/rules');

      expect(controller.readMarkdown()).toBe(
        '<https://client.example/rules>\n',
      );
    });

    test('focusで編集領域へフォーカスを移す', async () => {
      const { editable, controller } = await renderSurface();

      controller.focus();

      expect(document.activeElement).toBe(editable);
    });
  });

  describe('変更とフォーカスの通知', () => {
    test('入力で変更後のマークダウンを通知する', async () => {
      const { editable, handlers } = await renderSurface();
      editable.focus();

      await userEvent.keyboard('こんにちは');

      await expect
        .poll(() => handlers.onMarkdownChange.mock.lastCall?.[0])
        .toBe('こんにちは\n');
    });

    test('フォーカスが外れた時に通知する', async () => {
      const { editable, handlers } = await renderSurface();
      editable.focus();

      editable.blur();

      await expect.poll(() => handlers.onBlur.mock.calls.length).toBe(1);
    });

    test('カーソルの位置の書式を通知する', async () => {
      const { editable, handlers } = await renderSurface({
        initialValue: '> 引用の**太字**',
      });

      await selectTextOf(editable, elementIn(editable, 'strong'));

      await expect
        .poll(() =>
          [...(handlers.onActiveActionsChange.mock.lastCall?.[0] ?? [])].sort(),
        )
        .toStrictEqual(['blockquote', 'bold']);
    });
  });

  describe('日本語の句読点に隣接する強調', () => {
    test('「**太字。**の」を強調として表示し、往復しても原文を保つ', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '**太字。**の後の文',
      });

      expect(elementIn(editable, 'strong').textContent).toBe('太字。');
      expect(controller.readMarkdown()).toBe('**太字。**の後の文\n');
    });

    test('句読点で終わる文字列を太字にして書き戻した原文を読み直しても、強調のまま保つ', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '太字。の後の文',
      });
      const text = elementIn(editable, 'p').firstChild;
      if (text === null) {
        throw new Error('段落の文字列が描画されていません。');
      }
      await selectRange(editable, text, 0, '太字。'.length);
      controller.run('bold');

      controller.replaceMarkdown(controller.readMarkdown());

      await expect
        .poll(() => editable.querySelector('strong')?.textContent)
        .toBe('太字。');
      expect(controller.readMarkdown()).toBe('**太字。**の後の文\n');
    });

    test('句読点に隣接する取り消し線を、書き戻した原文を読み直しても保つ', async () => {
      const { editable, controller } = await renderSurface({
        initialValue: '~~取り消し。~~の後の文',
      });

      expect(elementIn(editable, 'del').textContent).toBe('取り消し。');

      controller.replaceMarkdown(controller.readMarkdown());

      await expect
        .poll(() => editable.querySelector('del')?.textContent)
        .toBe('取り消し。');
      expect(controller.readMarkdown()).toBe('~~取り消し。~~の後の文\n');
    });
  });

  describe('選択時のツールバー', () => {
    test('項目に日本語の名前を付ける', async () => {
      const { container, editable } = await renderSurface({
        initialValue: '選択する文字列',
      });

      await selectTextOf(editable, elementIn(editable, 'p'));

      const toolbar = elementIn(container, '.milkdown-toolbar');
      await expect.poll(() => toolbar.dataset.show).toBe('true');
      expect(
        [...toolbar.querySelectorAll('button')].map((button) =>
          button.getAttribute('aria-label'),
        ),
      ).toStrictEqual(['太字', '斜体', '取り消し線', 'コード', 'リンク']);
    });

    test('リンクの項目はリンクのダイアログを要求する', async () => {
      const { container, editable, handlers, controller } = await renderSurface(
        { initialValue: '選択する文字列' },
      );
      await selectTextOf(editable, elementIn(editable, 'p'));
      const toolbar = elementIn(container, '.milkdown-toolbar');
      await expect.poll(() => toolbar.dataset.show).toBe('true');

      await userEvent.click(elementIn(toolbar, '[aria-label="リンク"]'));

      expect(handlers.onRequestLink).toHaveBeenCalledOnce();
      expect(controller.readMarkdown()).toBe('選択する文字列\n');
    });

    test('リンクのショートカットはリンクのダイアログを要求する', async () => {
      const { editable, handlers } = await renderSurface({
        initialValue: '選択する文字列',
      });
      await selectAll(editable);

      await userEvent.keyboard('{ControlOrMeta>}k{/ControlOrMeta}');

      expect(handlers.onRequestLink).toHaveBeenCalledOnce();
    });
  });

  describe('読み取り専用', () => {
    test('無効のとき編集を受け付けず、指定が変わると切り替える', async () => {
      const { editable, controller, rerender } = await renderSurface({
        initialValue: '本文',
        disabled: true,
      });

      expect(editable.getAttribute('contenteditable')).toBe('false');
      expect(editable.getAttribute('aria-disabled')).toBe('true');

      await rerender({ disabled: false });

      await expect
        .poll(() => editable.getAttribute('contenteditable'))
        .toBe('true');
      expect(editable.hasAttribute('aria-disabled')).toBe(false);
      editable.focus();
      await userEvent.keyboard('{End}を書き足す');
      expect(controller.readMarkdown()).toBe('本文を書き足す\n');
    });
  });

  describe('支援技術への属性', () => {
    test('ラベル・説明と関連付けた複数行の入力欄として伝える', async () => {
      const { editable } = await renderSurface();

      expect(editable.getAttribute('role')).toBe('textbox');
      expect(editable.getAttribute('aria-multiline')).toBe('true');
      expect(editable.getAttribute('aria-labelledby')).toBe(LABEL_ID);
      expect(editable.getAttribute('aria-describedby')).toBe(DESCRIPTION_ID);
      expect(editable.hasAttribute('aria-invalid')).toBe(false);
    });

    test('説明・不正な状態の指定が変わると属性を更新する', async () => {
      const { editable, rerender } = await renderSurface();

      await rerender({
        describedBy: `${DESCRIPTION_ID} ${ERROR_ID}`,
        invalid: true,
      });

      await expect
        .poll(() => editable.getAttribute('aria-invalid'))
        .toBe('true');
      expect(editable.getAttribute('aria-describedby')).toBe(
        `${DESCRIPTION_ID} ${ERROR_ID}`,
      );

      await rerender({ describedBy: undefined, invalid: false });

      await expect
        .poll(() => editable.hasAttribute('aria-invalid'))
        .toBe(false);
      expect(editable.hasAttribute('aria-describedby')).toBe(false);
      expect(editable.getAttribute('role')).toBe('textbox');
    });
  });

  describe('テーマ', () => {
    test('Webフォントを読み込まず、本文と同じOSのフォントの並びを使う', async () => {
      const { container } = await renderSurface({ initialValue: '本文' });

      expect(
        getComputedStyle(elementIn(container, '.milkdown')).fontFamily,
      ).toBe(getComputedStyle(document.body).fontFamily);
    });

    test('フォーカスした編集領域に共通部品と同じ輪郭を付ける', async () => {
      const { editable, controller } = await renderSurface();

      controller.focus();

      expect(outlineOf(editable)).toStrictEqual(ringOutline());
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('文字色と背景色をデザイントークンに対応付ける', async () => {
      applyColorScheme(scheme);
      const { container } = await renderSurface({ initialValue: '本文' });
      const root = elementIn(container, '.milkdown');

      expect(getComputedStyle(root).color).toBe(tokenColorOf('foreground'));
      expect(getComputedStyle(root).backgroundColor).toBe(
        computedColorOf('transparent'),
      );
    });

    test('プレースホルダーの文字色を控えめな文字色のトークンにする', async () => {
      applyColorScheme(scheme);
      const { editable } = await renderSurface();

      expect(
        getComputedStyle(elementIn(editable, '[data-placeholder]'), '::before')
          .color,
      ).toBe(tokenColorOf('muted-foreground'));
    });

    test('選択時のツールバーの影を共通の重ねて表示する部品と同じにする', async () => {
      applyColorScheme(scheme);
      const { container } = await renderSurface({ initialValue: '本文' });
      const probe = document.createElement('div');
      probe.style.boxShadow = 'var(--shadow-md)';
      document.body.append(probe);

      expect(
        getComputedStyle(elementIn(container, '.milkdown-toolbar')).boxShadow,
      ).toBe(getComputedStyle(probe).boxShadow);
      expect(getComputedStyle(probe).boxShadow).not.toBe('none');
    });

    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await renderSurface({
        initialValue: [
          '## 見出し',
          '',
          '本文の**太字**と[リンク](https://client.example/)と`コード`。',
          '',
          '- 項目',
          '',
          '1. 番号付きの項目',
          '',
          '> 引用',
          '',
          '```',
          'const answer = 42;',
          '```',
          '',
          '| 項目 | 説明 |',
          '| --- | --- |',
          '| 投票 | 1日1回まで |',
          '',
          '- [x] 済み',
          '- [ ] 未着手',
        ].join('\n'),
      });

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
