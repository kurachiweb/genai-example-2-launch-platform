import { describe, expect, test } from 'bun:test';

import { DEFAULT_ID_PREFIX } from './markdown-options.ts';
import { processMarkdown } from './markdown-processor.ts';
import { plainTextOf } from './plain-text.ts';

const plainTextFor = (markdown: string): string =>
  plainTextOf(processMarkdown(markdown, DEFAULT_ID_PREFIX));

describe('plainTextOf', () => {
  test('マークダウンの構文を除いた文字列を返す', () => {
    expect(
      plainTextFor(
        '## 見出し\n\n**太字**と*斜体*と~~消す~~と`code`と[リンク](https://site.example)',
      ),
    ).toBe('見出し\n\n太字と斜体と消すとcodeとリンク');
  });

  test('見出しレベル1・画像・Raw HTMLを表示と同じ文字列にする', () => {
    expect(
      plainTextFor(
        '# 題\n\n![図](https://img.example/a.png)\n\n<b>太字ではない</b>',
      ),
    ).toBe('# 題\n\n![図](https://img.example/a.png)\n\n<b>太字ではない</b>');
  });

  test('脚注の見出しと本文へ戻るリンクの記号を含めず、参照の番号と注釈を含める', () => {
    const text = plainTextFor('本文[^1]\n\n[^1]: 注釈');

    expect(text).toBe('本文1\n\n注釈');
    expect(text).not.toContain('脚注');
    expect(text).not.toContain('↩');
  });

  test('本文中の「脚注」という見出しは含める', () => {
    expect(plainTextFor('## 脚注\n\n本文')).toBe('脚注\n\n本文');
  });
});
