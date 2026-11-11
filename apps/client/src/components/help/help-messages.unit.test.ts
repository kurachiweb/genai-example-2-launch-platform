import { describe, expect, test } from 'bun:test';

import {
  helpSearchNoResults,
  helpSearchResultCount,
  helpSearchResultsHeading,
  relatedHelpArticlesHeading,
} from './help-messages.ts';

describe('ヘルプの検索の文言', () => {
  test('検索結果の見出しと0件の案内は、検索語を「」で囲んで示す', () => {
    expect(helpSearchResultsHeading('ログイン')).toBe('「ログイン」の検索結果');
    expect(helpSearchNoResults('ログイン')).toBe(
      '「ログイン」に一致するヘルプ記事はありません。',
    );
  });

  test('件数は書式を整えた数に「件」を付ける', () => {
    expect(helpSearchResultCount('1,234')).toBe('1,234件');
  });
});

describe('ヘルプ記事詳細の文言', () => {
  test('関連記事の見出しは、カテゴリ名に「の他の記事」を付ける', () => {
    expect(relatedHelpArticlesHeading('使い方')).toBe('使い方の他の記事');
  });
});
