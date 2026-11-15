import { describe, expect, test } from 'bun:test';

import { extractHeadings } from './extract-headings.ts';
import { DEFAULT_ID_PREFIX, idPrefixFor } from './markdown-options.ts';
import { processMarkdown } from './markdown-processor.ts';

const headingsOf = (markdown: string, idPrefix = DEFAULT_ID_PREFIX) =>
  extractHeadings(processMarkdown(markdown, idPrefix));

describe('extractHeadings', () => {
  test('見出しレベル2〜6の階層・最終的なID・文字列を本文の順に返す', () => {
    expect(
      headingsOf(
        '## 概要 Hello World!\n\n本文\n\n### 詳細\n\n#### 四\n\n##### 五\n\n###### 六\n\n## 次',
      ),
    ).toEqual([
      {
        depth: 2,
        id: 'user-content-%E6%A6%82%E8%A6%81-hello-world%21',
        text: '概要 Hello World!',
      },
      { depth: 3, id: 'user-content-%E8%A9%B3%E7%B4%B0', text: '詳細' },
      { depth: 4, id: 'user-content-%E5%9B%9B', text: '四' },
      { depth: 5, id: 'user-content-%E4%BA%94', text: '五' },
      { depth: 6, id: 'user-content-%E5%85%AD', text: '六' },
      { depth: 2, id: 'user-content-%E6%AC%A1', text: '次' },
    ]);
  });

  test('連番を付けたIDと本文の識別子を含む接頭辞を返す', () => {
    expect(headingsOf('## A\n\n### a', idPrefixFor('post1'))).toEqual([
      { depth: 2, id: 'user-content-post1-a', text: 'A' },
      { depth: 3, id: 'user-content-post1-a-1', text: 'a' },
    ]);
  });

  test('書式を除いた見出しの文字列を返す', () => {
    expect(headingsOf('## **太字**と`code`と[リンク](#a)')).toEqual([
      {
        depth: 2,
        id: 'user-content-%E5%A4%AA%E5%AD%97%E3%81%A8code%E3%81%A8%E3%83%AA%E3%83%B3%E3%82%AF',
        text: '太字とcodeとリンク',
      },
    ]);
  });

  test('引用やリストの中の見出しも本文の順に含める', () => {
    expect(
      headingsOf('> ## 引用の見出し\n\n- ### 項目の見出し').map(
        ({ text }) => text,
      ),
    ).toEqual(['引用の見出し', '項目の見出し']);
  });

  test('脚注の見出しを含めない', () => {
    expect(headingsOf('## 本文の見出し\n\n本文[^1]\n\n[^1]: 注釈')).toEqual([
      {
        depth: 2,
        id: 'user-content-%E6%9C%AC%E6%96%87%E3%81%AE%E8%A6%8B%E5%87%BA%E3%81%97',
        text: '本文の見出し',
      },
    ]);
  });

  test('見出しレベル1の段落と見出しの無い本文から空の一覧を返す', () => {
    expect(headingsOf('# 題\n\n本文')).toEqual([]);
  });
});
