import { describe, expect, test } from 'bun:test';

import type { MyDataExportsData } from '../../graphql/data-export.ts';
import {
  dataExportRefetchInterval,
  hasPendingDataExport,
  toDataExports,
} from './data-export-entries.ts';
import {
  expiredExportOf,
  pendingExportOf,
  readyExportOf,
} from './data-export-fixtures.ts';

const dataOf = (
  ...pages: readonly (readonly ReturnType<typeof readyExportOf>[])[]
): MyDataExportsData => ({
  pages: pages.map((nodes) => ({
    myDataExports: {
      nodes: [...nodes],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  })),
  pageParams: pages.map(() => null),
});

describe('toDataExports', () => {
  test('全てのページの要求を、ページの順のまま1つの配列にする', () => {
    const data = dataOf(
      [readyExportOf(1), pendingExportOf(2)],
      [expiredExportOf(3)],
    );

    expect(toDataExports(data).map(({ id }) => id)).toEqual([
      readyExportOf(1).id,
      pendingExportOf(2).id,
      expiredExportOf(3).id,
    ]);
  });
});

describe('hasPendingDataExport', () => {
  test('読み込んだ後ろのページに作成中の要求があれば、真', () => {
    expect(
      hasPendingDataExport(dataOf([readyExportOf(1)], [pendingExportOf(2)])),
    ).toBe(true);
  });

  test('作成中の要求が無ければ、偽', () => {
    expect(
      hasPendingDataExport(dataOf([readyExportOf(1), expiredExportOf(2)])),
    ).toBe(false);
  });

  test('0件・未取得は、偽', () => {
    expect(hasPendingDataExport(dataOf([]))).toBe(false);
    expect(hasPendingDataExport(undefined)).toBe(false);
  });
});

describe('dataExportRefetchInterval', () => {
  const queryOf = (data: MyDataExportsData | undefined) => ({
    state: { data },
  });

  test('自動更新がオンで作成中の要求があれば、定期再取得の間隔を返す', () => {
    expect(
      dataExportRefetchInterval(true)(queryOf(dataOf([pendingExportOf(1)]))),
    ).toBe(30_000);
  });

  test('自動更新がオフなら、作成中の要求があっても止める', () => {
    expect(
      dataExportRefetchInterval(false)(queryOf(dataOf([pendingExportOf(1)]))),
    ).toBe(false);
  });

  test('作成中の要求が無ければ、自動更新がオンでも止める', () => {
    expect(
      dataExportRefetchInterval(true)(queryOf(dataOf([readyExportOf(1)]))),
    ).toBe(false);
    expect(dataExportRefetchInterval(true)(queryOf(undefined))).toBe(false);
  });
});
