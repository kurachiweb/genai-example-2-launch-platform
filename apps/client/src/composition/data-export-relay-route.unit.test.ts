import { describe, expect, test } from 'bun:test';

import {
  DATA_EXPORT_DOWNLOAD_PREFIX,
  dataExportDownloadPathOf,
} from '../../common-lib/data-export/data-export-rules.ts';
import { DATA_EXPORT_DOWNLOAD_RELAY_ROUTE } from './data-export-relay-route.ts';

const APP_ORIGIN = 'https://app.example';

const EXPORT_ID = '01JBQ7ZK3M8N4P5R6S7T8V9W0X';

const RELAY_TIMEOUT_MS = 900_000;

const urlOf = (path: string): URL => new URL(path, APP_ORIGIN);

describe('DATA_EXPORT_DOWNLOAD_RELAY_ROUTE', () => {
  test('エクスポートの接頭辞の下のGETだけを、本文の形式と追加の項目なしで15分で中継する', () => {
    expect(DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.path).toBe(
      `${DATA_EXPORT_DOWNLOAD_PREFIX}*`,
    );
    expect(DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.path).toBe('/_bff/exports/*');
    expect(DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.methods).toEqual(['GET']);
    expect(DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.acceptContentTypes).toEqual([]);
    expect(DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.extraForwardedHeaders).toEqual([]);
    expect(DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.timeoutMs).toBe(RELAY_TIMEOUT_MS);
  });

  test('ダウンロードの経路から、上流のアーカイブの経路へ識別子を渡す', () => {
    expect(
      DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.upstreamPath(
        urlOf(`${dataExportDownloadPathOf(EXPORT_ID)}?x=1`),
      ),
    ).toBe(`/internal/data-exports/${EXPORT_ID}/archive`);
  });

  test.each([[EXPORT_ID], ['a b'], ['a/b'], ['添付'], ['%']])(
    'dataExportDownloadPathOf(%j)の経路を、識別子を百分率符号化して上流の1つの区画に収める',
    (exportId) => {
      expect(
        DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.upstreamPath(
          urlOf(dataExportDownloadPathOf(exportId)),
        ),
      ).toBe(`/internal/data-exports/${encodeURIComponent(exportId)}/archive`);
    },
  );

  test.each([
    ['区切りの/', '/_bff/exports/a/b', '%2F'],
    ['符号化した..', '/_bff/exports/x%2F..%2F..%2Fgraphql', '%2F..%2F..%2F'],
    ['不正な百分率符号化', '/_bff/exports/%E0%A4%A', '%25E0%25A4%25A'],
  ])('識別子の%sは上流のパスの区画を増やさない', (_label, path, fragment) => {
    const upstream = DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.upstreamPath(urlOf(path));

    expect(upstream).toContain(fragment);
    expect(upstream.split('/')).toHaveLength(5);
  });

  test('凍結されている', () => {
    expect(Object.isFrozen(DATA_EXPORT_DOWNLOAD_RELAY_ROUTE)).toBe(true);
    expect(Object.isFrozen(DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.methods)).toBe(
      true,
    );
    expect(
      Object.isFrozen(DATA_EXPORT_DOWNLOAD_RELAY_ROUTE.acceptContentTypes),
    ).toBe(true);
  });
});
