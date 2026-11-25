import { describe, expect, test } from 'bun:test';

import { dataExportDownloadLabel } from './data-export-messages.ts';

describe('dataExportDownloadLabel', () => {
  test('大きさがあれば括弧の中に大きさを添える', () => {
    expect(dataExportDownloadLabel('1.5MB')).toBe('ダウンロード(1.5MB)');
  });

  test('大きさが無ければ「ダウンロード」だけを返す', () => {
    expect(dataExportDownloadLabel(null)).toBe('ダウンロード');
  });
});
