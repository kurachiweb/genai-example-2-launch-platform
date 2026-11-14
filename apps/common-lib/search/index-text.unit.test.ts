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

  test.each([
    ['Unicode 6.1より後の絵文字', '🦄Unicorn', 'Unicorn'],
    ['語の間の絵文字', 'foo🤣bar', 'foo bar'],
    ['肌色の修飾', 'a👍🏽b', 'a b'],
    ['単独の肌色の修飾', 'a🏽b', 'a b'],
    ['ゼロ幅接合子でつないだ絵文字', '家族👨‍👩‍👧‍👦写真', '家族 写真'],
    ['地域指示記号の国旗', '🇯🇵Japan', 'Japan'],
    ['タグ文字の旗', '🏴󠁧󠁢󠁳󠁣󠁴󠁿Scotland', 'Scotland'],
    ['異体字セレクタ', '❤️love❤︎', 'love'],
    ['絵文字だけ', '🦄 🤣', ''],
  ])('%sを区切りの空白にする', (_, text, expected) => {
    expect(normalizeIndexText(text)).toBe(expected);
  });

  test.each([
    ['キーキャップの数字', '1️⃣2️⃣', '1 2'],
    ['キーキャップの#と*', '#️⃣*️⃣', '# *'],
    ['互換分解で文字になる絵文字', '™ℹⓂ㊗🈂️', 'TMiM祝サ'],
    ['日本語の記号', '〇〒〆々', '〇〒〆々'],
  ])('%sの文字を残す', (_, text, expected) => {
    expect(normalizeIndexText(text)).toBe(expected);
  });

  test('絵文字の多い長い文字列を線形の時間で正規化する', () => {
    const startedAt = performance.now();
    const normalized = normalizeIndexText(`${'👨‍👩‍👧‍👦🏽'.repeat(20_000)}a`);
    const elapsed = performance.now() - startedAt;

    expect(normalized).toBe('a');
    expect(elapsed).toBeLessThan(50);
  });

  test('大文字小文字と発音区別符号を変えない', () => {
    expect(normalizeIndexText('Café Résumé')).toBe('Café Résumé');
  });
});
