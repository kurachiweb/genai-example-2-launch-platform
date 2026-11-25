import { describe, expect, test } from 'bun:test';

import {
  DATA_EXPORT_DISPLAY_STATUS_LABELS,
  DATA_EXPORT_DOWNLOAD_PREFIX,
  DATA_EXPORT_FAILURE_KINDS,
  DATA_EXPORT_LIST_PAGE_SIZE,
  DATA_EXPORT_REQUEST_LIMIT,
  DATA_EXPORT_REQUEST_WINDOW_SECONDS,
  DATA_EXPORT_RETENTION_DAYS,
  DATA_EXPORT_STATUSES,
  dataExportDownloadPathOf,
  toDisplayStatus,
  type DataExportDisplayStatus,
  type DataExportStatus,
} from './data-export-rules.ts';

describe('DATA_EXPORT_STATUSES', () => {
  test('期限切れを含む5つの状態を処理の順に持つ', () => {
    expect(DATA_EXPORT_STATUSES).toEqual([
      'queued',
      'generating',
      'ready',
      'expired',
      'failed',
    ]);
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(DATA_EXPORT_STATUSES)).toBe(true);
  });
});

describe('DATA_EXPORT_FAILURE_KINDS', () => {
  test('エラーと上限超過の2種類を持つ', () => {
    expect(DATA_EXPORT_FAILURE_KINDS).toEqual(['error', 'too_large']);
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(DATA_EXPORT_FAILURE_KINDS)).toBe(true);
  });
});

describe('toDisplayStatus', () => {
  test.each<[DataExportStatus, DataExportDisplayStatus]>([
    ['queued', 'pending'],
    ['generating', 'pending'],
    ['ready', 'ready'],
    ['expired', 'expired'],
    ['failed', 'failed'],
  ])('状態%sを表示の状態%sにする', (status, expected) => {
    expect(toDisplayStatus(status)).toBe(expected);
  });

  test('全ての状態が表示の状態の表示名を持つ', () => {
    for (const status of DATA_EXPORT_STATUSES) {
      const label = DATA_EXPORT_DISPLAY_STATUS_LABELS[toDisplayStatus(status)];
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('DATA_EXPORT_DISPLAY_STATUS_LABELS', () => {
  test('表示の状態を作成中・完了・期限切れ・失敗で表す', () => {
    expect(DATA_EXPORT_DISPLAY_STATUS_LABELS).toEqual({
      pending: '作成中',
      ready: '完了',
      expired: '期限切れ',
      failed: '失敗',
    });
  });

  test('凍結されていて書き換えられない', () => {
    expect(Object.isFrozen(DATA_EXPORT_DISPLAY_STATUS_LABELS)).toBe(true);
  });
});

describe('回数・期間・一覧の値', () => {
  test('回数の上限は3回', () => {
    expect(DATA_EXPORT_REQUEST_LIMIT).toBe(3);
  });

  test('回数を数える期間は24時間(86,400秒)', () => {
    expect(DATA_EXPORT_REQUEST_WINDOW_SECONDS).toBe(86_400);
    expect(DATA_EXPORT_REQUEST_WINDOW_SECONDS).toBe(24 * 60 * 60);
  });

  test('有効期限は完了から7日', () => {
    expect(DATA_EXPORT_RETENTION_DAYS).toBe(7);
  });

  test('一覧の1ページは20件', () => {
    expect(DATA_EXPORT_LIST_PAGE_SIZE).toBe(20);
  });
});

describe('dataExportDownloadPathOf', () => {
  test('接頭辞は利用者側の同じオリジンの中継の経路', () => {
    expect(DATA_EXPORT_DOWNLOAD_PREFIX).toBe('/_bff/exports/');
  });

  test('接頭辞に要求のIDを続ける', () => {
    expect(dataExportDownloadPathOf('01JCK6Z0V8D9W9Q4M2N3P5R7T1')).toBe(
      '/_bff/exports/01JCK6Z0V8D9W9Q4M2N3P5R7T1',
    );
  });

  test.each([
    ['パス区切り文字', '../a/b', '/_bff/exports/..%2Fa%2Fb'],
    ['クエリとフラグメント', 'a?b#c', '/_bff/exports/a%3Fb%23c'],
    ['百分率記号', 'a%b', '/_bff/exports/a%25b'],
    ['空白と日本語', 'a b文', '/_bff/exports/a%20b%E6%96%87'],
    ['空文字列', '', '/_bff/exports/'],
  ])('IDの%sを百分率符号化して経路の1階層に収める', (_, id, expected) => {
    expect(dataExportDownloadPathOf(id)).toBe(expected);
  });
});
