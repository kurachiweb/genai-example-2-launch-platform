import { describe, expect, test } from 'bun:test';

import {
  compareMigrations,
  listMigrationNames,
  parseMigrationsListOutput,
} from './compare-migrations.ts';

const BANNER = [
  '',
  ' ⛅️ wrangler 4.124.0',
  '───────────────────────────────────────────────',
  'Resource location: local ',
  '',
  'Use --remote if you want to access the remote instance.',
  '',
];

const NO_MIGRATIONS_OUTPUT = [...BANNER, '✅ No migrations to apply!', ''].join(
  '\n',
);

const TWO_MIGRATIONS_OUTPUT = [
  ...BANNER,
  'Migrations to be applied:',
  '┌───────────────────────────────────────────────────────┐',
  '│ Name                                                  │',
  '├───────────────────────────────────────────────────────┤',
  '│ 20261025000000_create_users/migration.sql             │',
  '├───────────────────────────────────────────────────────┤',
  '│ 20261026000000_add_users_fts_triggers/migration.sql   │',
  '└───────────────────────────────────────────────────────┘',
  '',
].join('\n');

describe('listMigrationNames', () => {
  test('保存先の<日時>_<名前>/migration.sqlのディレクトリ名を名前順に返す', () => {
    const names = listMigrationNames([
      '20261026000000_add_users_fts_triggers/migration.sql',
      '20261025000000_create_users/migration.sql',
      '20261025000000_create_users/snapshot.json',
    ]);

    expect(names).toEqual([
      '20261025000000_create_users',
      '20261026000000_add_users_fts_triggers',
    ]);
  });

  test('保存先の直下のファイル・migration.sqlの無いディレクトリ・深い階層のファイルを数えない', () => {
    const names = listMigrationNames([
      '.gitkeep',
      '0001_root_level.sql',
      '20261025000000_only_snapshot',
      '20261025000000_only_snapshot/snapshot.json',
      '20261025000000_nested/inner/migration.sql',
    ]);

    expect(names).toEqual([]);
  });

  test('保存先が空なら空配列を返す', () => {
    expect(listMigrationNames([])).toEqual([]);
  });
});

describe('parseMigrationsListOutput', () => {
  test('未適用の一覧の表から、保存先のディレクトリ名を表示順に取り出す', () => {
    expect(parseMigrationsListOutput(TWO_MIGRATIONS_OUTPUT)).toEqual([
      '20261025000000_create_users',
      '20261026000000_add_users_fts_triggers',
    ]);
  });

  test('0件の表示は空配列になる', () => {
    expect(parseMigrationsListOutput(NO_MIGRATIONS_OUTPUT)).toEqual([]);
  });

  test('色付けの制御文字を含む出力も解析する', () => {
    const colored = TWO_MIGRATIONS_OUTPUT.replaceAll(
      '│',
      '\u001B[90m│\u001B[39m',
    );

    expect(parseMigrationsListOutput(colored)).toEqual([
      '20261025000000_create_users',
      '20261026000000_add_users_fts_triggers',
    ]);
  });

  test('入れ子の形でない名前はそのまま返し、保存先に無い名前として扱えるようにする', () => {
    const output = [
      ...BANNER,
      'Migrations to be applied:',
      '┌──────────────────┐',
      '│ Name             │',
      '├──────────────────┤',
      '│ 0001_initial.sql │',
      '└──────────────────┘',
    ].join('\n');

    expect(parseMigrationsListOutput(output)).toEqual(['0001_initial.sql']);
  });

  test('一覧の表も0件の表示も無い出力は解析できない例外にする', () => {
    expect(() =>
      parseMigrationsListOutput(
        [
          ...BANNER,
          '✘ [ERROR] Couldn\'t find a D1 DB with the name or binding "DB"',
        ].join('\n'),
      ),
    ).toThrow('Wranglerのマイグレーションの一覧を解析できませんでした');
  });

  test('一覧の見出しがあっても行が無ければ解析できない例外にする', () => {
    const output = [...BANNER, 'Migrations to be applied:', ''].join('\n');

    expect(() => parseMigrationsListOutput(output)).toThrow(
      'Wranglerのマイグレーションの一覧を解析できませんでした',
    );
  });
});

describe('compareMigrations', () => {
  test('保存先とWranglerの一覧が一致すれば成功する', () => {
    const comparison = compareMigrations(
      ['20261025000000_create_users', '20261026000000_add_users_fts_triggers'],
      ['20261025000000_create_users', '20261026000000_add_users_fts_triggers'],
    );

    expect(comparison).toEqual({ ok: true, undetected: [], unexpected: [] });
  });

  test('どちらも0件なら成功する', () => {
    expect(compareMigrations([], [])).toEqual({
      ok: true,
      undetected: [],
      unexpected: [],
    });
  });

  test('保存先にあるがWranglerが検出しなかった名前を検出漏れとして失敗する', () => {
    const comparison = compareMigrations(
      ['20261025000000_create_users', '20261026000000_add_users_fts_triggers'],
      ['20261025000000_create_users'],
    );

    expect(comparison).toEqual({
      ok: false,
      undetected: ['20261026000000_add_users_fts_triggers'],
      unexpected: [],
    });
  });

  test('保存先が1件以上でWranglerが0件と表示すれば、すべてを検出漏れとして失敗する', () => {
    expect(compareMigrations(['20261025000000_create_users'], [])).toEqual({
      ok: false,
      undetected: ['20261025000000_create_users'],
      unexpected: [],
    });
  });

  test('Wranglerが検出したが保存先に無い名前を想定外として失敗する', () => {
    const comparison = compareMigrations(
      ['20261025000000_create_users'],
      ['0001_initial.sql', '20261025000000_create_users'],
    );

    expect(comparison).toEqual({
      ok: false,
      undetected: [],
      unexpected: ['0001_initial.sql'],
    });
  });

  test('検出漏れと想定外を同時に返す', () => {
    const comparison = compareMigrations(
      ['20261025000000_create_users'],
      ['0001_initial.sql'],
    );

    expect(comparison).toEqual({
      ok: false,
      undetected: ['20261025000000_create_users'],
      unexpected: ['0001_initial.sql'],
    });
  });
});
