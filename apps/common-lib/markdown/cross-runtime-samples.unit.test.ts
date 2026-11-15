import { describe, expect, test } from 'bun:test';

import { CROSS_RUNTIME_CASES } from './fixtures/cross-runtime-cases.ts';
import {
  CROSS_RUNTIME_MARKDOWN_SAMPLES,
  CROSS_RUNTIME_TEXT_SAMPLES,
} from './fixtures/cross-runtime-samples.ts';
import { REPRESENTATIVE_MARKDOWN } from './fixtures/representative-markdown.ts';
import { XSS_PAYLOADS } from './fixtures/xss-payloads.ts';

const casesOf = (prefix: string): readonly string[] =>
  CROSS_RUNTIME_CASES.map(({ name }) => name).filter((name) =>
    name.startsWith(prefix),
  );

describe('実行環境の間の照合の標本(Bun)', () => {
  test.each(
    CROSS_RUNTIME_CASES.map((sample) => [sample.name, sample] as const),
  )('%sの結果が標本の期待値と一致する', async (_, { actual, expected }) => {
    expect(await actual()).toEqual(expected);
  });

  test('標本の名前が重複しない', () => {
    const names = CROSS_RUNTIME_CASES.map(({ name }) => name);

    expect(new Set(names).size).toBe(names.length);
  });

  test('代表的な文書と攻撃パターン集の全件を要約値で照合する', () => {
    expect(casesOf('要約値: ')).toEqual([
      '要約値: 代表的な文書',
      '要約値: 攻撃パターン集の全件',
    ]);
    expect(REPRESENTATIVE_MARKDOWN.length).toBeGreaterThan(0);
    expect(XSS_PAYLOADS.length).toBeGreaterThan(0);
  });

  test('マークダウンの標本が攻撃パターン集の一部を含む', () => {
    const payloads = new Set(XSS_PAYLOADS.map(({ markdown }) => markdown));

    expect(
      CROSS_RUNTIME_MARKDOWN_SAMPLES.filter(({ markdown }) =>
        payloads.has(markdown),
      ).length,
    ).toBeGreaterThanOrEqual(5);
  });

  test.each([
    ['絵文字', /\p{Extended_Pictographic}/u],
    ['結合文字', /\p{M}/u],
    ['CRLF', /\r\n/u],
    ['半角カナ', /[ｦ-ﾟ]/u],
    ['合字', /[ﬀ-ﬆ]/u],
  ])('文字列とマークダウンの標本が%sを含む', (_, pattern) => {
    expect(
      CROSS_RUNTIME_TEXT_SAMPLES.some(({ text }) => pattern.test(text)),
    ).toBe(true);
    expect(
      CROSS_RUNTIME_MARKDOWN_SAMPLES.some(({ markdown }) =>
        pattern.test(markdown),
      ),
    ).toBe(true);
  });
});
