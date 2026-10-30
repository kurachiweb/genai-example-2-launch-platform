import { describe, expect, test } from 'bun:test';

import { normalizeIndexText } from './index-text.ts';

describe('normalizeIndexText', () => {
  test.each([
    ['全角英数字', 'ＬａｕｎｃｈＳｔａｄｉｕｍ１２３', 'LaunchStadium123'],
    ['半角カナ', 'ﾀｽｸｶﾞﾝﾘ', 'タスクガンリ'],
    ['合字と丸付き数字', 'ﬁle①', 'file1'],
  ])('%sをNFKC正規化する', (_, text, expected) => {
    expect(normalizeIndexText(text)).toBe(expected);
  });

  test.each([
    ['半角スペースの連続', 'タスク   管理', 'タスク 管理'],
    ['全角空白', 'タスク\u3000管理', 'タスク 管理'],
    ['改行とタブ', 'タスク\n\t管理\r\nツール', 'タスク 管理 ツール'],
    ['ノーブレークスペース', 'タスク\u00a0\u00a0管理', 'タスク 管理'],
    ['NEL(U+0085)', 'タスク\u0085\u0085管理', 'タスク 管理'],
  ])('%sを1つの半角スペースに畳み込む', (_, text, expected) => {
    expect(normalizeIndexText(text)).toBe(expected);
  });

  test('前後の空白を除く', () => {
    expect(normalizeIndexText(' \u3000\n\u0085タスク管理\t\u0085 \u3000')).toBe(
      'タスク管理',
    );
  });

  test.each([
    ['語の間', 'タスク\ufeff管理'],
    ['前後', '\ufeffタスク管理\ufeff'],
  ])('%sのU+FEFFを空白として扱わない', (_, text) => {
    expect(normalizeIndexText(text)).toBe(text);
  });

  test.each([
    ['空文字列', ''],
    ['空白だけ', ' \u3000\n\t'],
  ])('%sを空文字列にする', (_, text) => {
    expect(normalizeIndexText(text)).toBe('');
  });

  test('途中に長い空白の並びがある文字列を線形の時間で正規化する', () => {
    const startedAt = performance.now();
    const normalized = normalizeIndexText(`a${' '.repeat(20_000)}b`);
    const elapsed = performance.now() - startedAt;

    expect(normalized).toBe('a b');
    expect(elapsed).toBeLessThan(50);
  });

  test('大文字小文字と発音区別符号を変えない', () => {
    expect(normalizeIndexText('Café Résumé')).toBe('Café Résumé');
  });
});
