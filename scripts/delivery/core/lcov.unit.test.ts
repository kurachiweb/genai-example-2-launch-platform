import { describe, expect, test } from 'bun:test';

import {
  COVERAGE_KINDS,
  type CoverageLayout,
  lcovReportsOf,
  MERGED_LCOV_PATH,
  mergeLcov,
  prefixSourcePaths,
} from './lcov.ts';

const LAYOUT: CoverageLayout = {
  apps: [{ dir: 'apps/api' }, { dir: 'apps/client' }],
};

describe('COVERAGE_KINDS・MERGED_LCOV_PATH', () => {
  test('単体・ブラウザ・Workers統合の3種別を読み、coverage/mergedへ書き出す', () => {
    expect(COVERAGE_KINDS).toEqual(['unit', 'browser', 'worker']);
    expect(MERGED_LCOV_PATH).toBe('coverage/merged/lcov.info');
  });
});

describe('lcovReportsOf', () => {
  test('ルートとアプリごとに、種別ごとのlcov.infoの固定のパスを並べる', () => {
    expect(lcovReportsOf(LAYOUT)).toEqual([
      { dir: '.', kind: 'unit', path: 'coverage/unit/lcov.info' },
      { dir: '.', kind: 'browser', path: 'coverage/browser/lcov.info' },
      { dir: '.', kind: 'worker', path: 'coverage/worker/lcov.info' },
      {
        dir: 'apps/api',
        kind: 'unit',
        path: 'apps/api/coverage/unit/lcov.info',
      },
      {
        dir: 'apps/api',
        kind: 'browser',
        path: 'apps/api/coverage/browser/lcov.info',
      },
      {
        dir: 'apps/api',
        kind: 'worker',
        path: 'apps/api/coverage/worker/lcov.info',
      },
      {
        dir: 'apps/client',
        kind: 'unit',
        path: 'apps/client/coverage/unit/lcov.info',
      },
      {
        dir: 'apps/client',
        kind: 'browser',
        path: 'apps/client/coverage/browser/lcov.info',
      },
      {
        dir: 'apps/client',
        kind: 'worker',
        path: 'apps/client/coverage/worker/lcov.info',
      },
    ]);
  });

  test('既定ではワークスペースのすべてのアプリを対象にする', () => {
    const dirs = [...new Set(lcovReportsOf().map(({ dir }) => dir))];

    expect(dirs).toEqual([
      '.',
      'apps/api',
      'apps/event',
      'apps/frontend-lib',
      'apps/client',
      'apps/admin',
    ]);
  });
});

describe('prefixSourcePaths', () => {
  const LCOV = [
    'TN:',
    'SF:src/index.ts',
    'FNF:1',
    'DA:1,1',
    'end_of_record',
    'TN:',
    'SF:db/client.ts',
    'end_of_record',
    '',
  ].join('\n');

  test('SF:のパスの前にアプリのディレクトリを付け、他の行は変えない', () => {
    expect(prefixSourcePaths(LCOV, 'apps/api')).toBe(
      [
        'TN:',
        'SF:apps/api/src/index.ts',
        'FNF:1',
        'DA:1,1',
        'end_of_record',
        'TN:',
        'SF:apps/api/db/client.ts',
        'end_of_record',
        '',
      ].join('\n'),
    );
  });

  test('ルートの結果のパスは変えない', () => {
    expect(prefixSourcePaths(LCOV, '.')).toBe(LCOV);
  });

  test('親を指すパスは正規化し、絶対パスは変えない', () => {
    const lcov = 'SF:../backend-lib/x.ts\nSF:/tmp/y.ts\nSF:./src/z.ts\n';

    expect(prefixSourcePaths(lcov, 'apps/api')).toBe(
      'SF:apps/backend-lib/x.ts\nSF:/tmp/y.ts\nSF:apps/api/src/z.ts\n',
    );
  });

  test('CRLFの改行の結果もSF:の行を前置し、改行をLFにそろえる', () => {
    expect(
      prefixSourcePaths('SF:src/a.ts\r\nend_of_record\r\n', 'apps/api'),
    ).toBe('SF:apps/api/src/a.ts\nend_of_record\n');
  });
});

describe('mergeLcov', () => {
  test('ルートと各アプリの単体・ブラウザ・Workers統合の結果を、アプリのディレクトリを前置して1つに合算する', () => {
    const merged = mergeLcov([
      { dir: '.', lcov: 'TN:\nSF:scripts/a.ts\nend_of_record\n' },
      { dir: 'apps/api', lcov: 'TN:\nSF:src/b.ts\nend_of_record\n' },
      { dir: 'apps/api', lcov: 'TN:\nSF:src/b.ts\nend_of_record' },
      { dir: 'apps/client', lcov: 'TN:\nSF:src/c.tsx\nend_of_record\n' },
    ]);

    expect(merged).toBe(
      [
        'TN:',
        'SF:scripts/a.ts',
        'end_of_record',
        'TN:',
        'SF:apps/api/src/b.ts',
        'end_of_record',
        'TN:',
        'SF:apps/api/src/b.ts',
        'end_of_record',
        'TN:',
        'SF:apps/client/src/c.tsx',
        'end_of_record',
        '',
      ].join('\n'),
    );
  });

  test('空の結果は合算から除く', () => {
    expect(
      mergeLcov([
        { dir: 'apps/api', lcov: '' },
        { dir: 'apps/client', lcov: '\n' },
        { dir: 'apps/admin', lcov: 'SF:src/d.ts\nend_of_record\n' },
      ]),
    ).toBe('SF:apps/admin/src/d.ts\nend_of_record\n');
  });

  test('結果が無ければ空を返す', () => {
    expect(mergeLcov([])).toBe('');
  });
});
