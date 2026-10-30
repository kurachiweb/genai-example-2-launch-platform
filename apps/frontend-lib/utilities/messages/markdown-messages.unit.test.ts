import { describe, expect, test } from 'bun:test';

import {
  BLOCKQUOTE_ACTION_LABEL,
  BOLD_ACTION_LABEL,
  BULLET_LIST_ACTION_LABEL,
  CODE_BLOCK_ACTION_LABEL,
  COLLAPSE_LABEL,
  EDITOR_KEYBOARD_HINT,
  FORMAT_TOOLBAR_LABEL,
  HEADING_ACTION_LABEL,
  INLINE_CODE_ACTION_LABEL,
  ITALIC_ACTION_LABEL,
  LINK_ACTION_LABEL,
  LINK_APPLY_LABEL,
  LINK_CANCEL_LABEL,
  LINK_DIALOG_TITLE,
  LINK_REMOVE_LABEL,
  LINK_URL_FORMAT_ERROR,
  LINK_URL_LABEL,
  ORDERED_LIST_ACTION_LABEL,
  READ_MORE_LABEL,
  TABLE_ACTION_LABEL,
  TASK_ITEM_CHECKED_LABEL,
  TASK_ITEM_UNCHECKED_LABEL,
} from './markdown-messages.ts';

const TOOLBAR_ACTION_LABELS = [
  HEADING_ACTION_LABEL,
  BOLD_ACTION_LABEL,
  ITALIC_ACTION_LABEL,
  LINK_ACTION_LABEL,
  BULLET_LIST_ACTION_LABEL,
  ORDERED_LIST_ACTION_LABEL,
  BLOCKQUOTE_ACTION_LABEL,
  INLINE_CODE_ACTION_LABEL,
  CODE_BLOCK_ACTION_LABEL,
  TABLE_ACTION_LABEL,
];

const LINK_DIALOG_LABELS = [
  LINK_DIALOG_TITLE,
  LINK_URL_LABEL,
  LINK_APPLY_LABEL,
  LINK_REMOVE_LABEL,
  LINK_CANCEL_LABEL,
];

describe('マークダウンの表示の文言', () => {
  test('折りたたみの切替ボタンの文言は設計の文言と同じ', () => {
    expect([READ_MORE_LABEL, COLLAPSE_LABEL]).toStrictEqual([
      '続きを読む',
      '折りたたむ',
    ]);
  });

  test('タスクの項目の状態の文言は文言規則と同じ', () => {
    expect([TASK_ITEM_CHECKED_LABEL, TASK_ITEM_UNCHECKED_LABEL]).toStrictEqual([
      '完了',
      '未完了',
    ]);
  });

  test('書式のツールバーの名前と10個の操作の名前は設計の文言と同じ', () => {
    expect(FORMAT_TOOLBAR_LABEL).toBe('書式');
    expect(TOOLBAR_ACTION_LABELS).toStrictEqual([
      '見出し',
      '太字',
      '斜体',
      'リンク',
      '箇条書き',
      '番号付きリスト',
      '引用',
      'コード',
      'コードブロック',
      '表',
    ]);
  });

  test('リンクのダイアログの題名・欄・操作の名前と形式違反の文言は設計の文言と同じ', () => {
    expect(LINK_DIALOG_LABELS).toStrictEqual([
      'リンクの設定',
      'URL',
      '設定',
      'リンクを解除',
      'キャンセル',
    ]);
    expect(LINK_URL_FORMAT_ERROR).toBe(
      '"https://"・"http://"・"mailto:"で始まるURLか、"#"で始まるページ内のリンクを入力してください。',
    );
  });

  test('リストの階層の変更と表のセルの移動のキー操作の説明は、両方のキーとmacOSの修飾キーを示す', () => {
    expect(EDITOR_KEYBOARD_HINT).toBe(
      'リストの項目の階層を下げる操作と表の次のセルへの移動はCtrl+]、階層を上げる操作と表の前のセルへの移動はCtrl+[で行います(macOSではCtrlの代わりにCommand)。',
    );
  });

  test('操作の名前と状態の文言は句点を付けない', () => {
    for (const label of [
      READ_MORE_LABEL,
      COLLAPSE_LABEL,
      TASK_ITEM_CHECKED_LABEL,
      TASK_ITEM_UNCHECKED_LABEL,
      FORMAT_TOOLBAR_LABEL,
      ...TOOLBAR_ACTION_LABELS,
      ...LINK_DIALOG_LABELS,
    ]) {
      expect(label).not.toMatch(/(?:。|です|ます)$/u);
    }
  });

  test('案内とエラーの文言は句点で終わる', () => {
    for (const sentence of [EDITOR_KEYBOARD_HINT, LINK_URL_FORMAT_ERROR]) {
      expect(sentence).toMatch(/。$/u);
    }
  });
});
