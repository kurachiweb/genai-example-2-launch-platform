import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  tokenColorOf,
} from '../../test/computed-style.ts';
import { HighlightedText } from './highlighted-text.tsx';

const marksOf = (container: HTMLElement): readonly string[] =>
  Array.from(container.querySelectorAll('mark'), (mark) => mark.textContent);

const markOf = (container: HTMLElement): HTMLElement => {
  const mark = container.querySelector('mark');
  if (mark === null) {
    throw new Error('強調の要素が描画されていません。');
  }
  return mark;
};

describe('HighlightedText', () => {
  test('一致した範囲だけを<mark>で囲み、それ以外をそのまま表示する', async () => {
    const { container } = await render(
      <HighlightedText
        text="Launch Stadiumでローンチを競う"
        terms={['stadium']}
      />,
    );

    expect(marksOf(container)).toStrictEqual(['Stadium']);
    expect(container.textContent).toBe('Launch Stadiumでローンチを競う');
    expect(markOf(container).previousSibling?.textContent).toBe('Launch ');
    expect(markOf(container).nextSibling?.textContent).toBe('でローンチを競う');
  });

  test('語の先頭から一致した部分だけを囲み、語の途中は囲まない', async () => {
    const { container } = await render(
      <HighlightedText text="Relaunch Launcher" terms={['launch']} />,
    );

    expect(marksOf(container)).toStrictEqual(['Launch']);
    expect(container.textContent).toBe('Relaunch Launcher');
  });

  test('複数の検索語の一致をそれぞれ囲む', async () => {
    const { container } = await render(
      <HighlightedText
        text="Launch Stadium Tools for makers"
        terms={['launch', 'maker']}
      />,
    );

    expect(marksOf(container)).toStrictEqual(['Launch', 'maker']);
    expect(container.textContent).toBe('Launch Stadium Tools for makers');
  });

  test('全角・半角と大文字小文字の違いを無視して元の文字列を囲む', async () => {
    const { container } = await render(
      <HighlightedText text="ＬＡＵＮＣＨ　ｋｉｔ" terms={['launch']} />,
    );

    expect(marksOf(container)).toStrictEqual(['ＬＡＵＮＣＨ']);
    expect(container.textContent).toBe('ＬＡＵＮＣＨ　ｋｉｔ');
  });

  test('発音区別符号の違いを無視して元の文字列を囲む', async () => {
    const { container } = await render(
      <HighlightedText text="Café Résumé" terms={['resume']} />,
    );

    expect(marksOf(container)).toStrictEqual(['Résumé']);
  });

  test('一致が無い時と検索語が無い時は強調せずにそのまま表示する', async () => {
    const { container: unmatched } = await render(
      <HighlightedText text="Launch Stadium" terms={['vote']} />,
    );
    const { container: empty } = await render(
      <HighlightedText text="Launch Stadium" terms={[]} />,
    );

    expect(marksOf(unmatched)).toStrictEqual([]);
    expect(unmatched.textContent).toBe('Launch Stadium');
    expect(marksOf(empty)).toStrictEqual([]);
    expect(empty.textContent).toBe('Launch Stadium');
  });

  test('文字列を要素で包まず、置いた親の要素の中に直接表示する', async () => {
    const { container } = await render(
      <p>
        <HighlightedText text="Launch Stadium" terms={['launch']} />
      </p>,
    );

    const paragraph = container.querySelector('p');
    expect(
      Array.from(paragraph?.childNodes ?? [], (node) => node.nodeName),
    ).toStrictEqual(['MARK', '#text']);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="bg-background text-muted-foreground">
          <HighlightedText
            text="ＬＡＵＮＣＨ Café Résumé"
            terms={['launch', 'resume']}
          />
        </div>,
      );

      expect(marksOf(container)).toStrictEqual(['ＬＡＵＮＣＨ', 'Résumé']);
      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('強調の文字は親の文字色によらず本文の色で表示する', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <p className="text-muted-foreground">
          <HighlightedText text="Launch Stadium" terms={['launch']} />
        </p>,
      );

      expect(getComputedStyle(markOf(container)).color).toBe(
        tokenColorOf('foreground'),
      );
    });
  });
});
