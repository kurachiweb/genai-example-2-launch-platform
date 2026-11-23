import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DATASETS,
  DEFAULT_OUT_DIR,
  parseGenerateArguments,
  runGenerate,
} from './generate.ts';
import { createMigratedDatabase } from './migrated-database.ts';

const NOW = new Date('2026-11-24T10:00:00.000Z');

describe('parseGenerateArguments', () => {
  test('引数が無ければ想定規模・実行の日の業務日付・既定の出力先を使う', () => {
    expect(parseGenerateArguments([], NOW)).toEqual({
      profileName: 'year-one',
      baseDate: '2026-11-24',
      seed: 1,
      outDir: DEFAULT_OUT_DIR,
      maxStatementsPerFile: 5_000,
    });
  });

  test('UTCの8:00より前の実行は前日の業務日付を基準日にする', () => {
    expect(
      parseGenerateArguments([], new Date('2026-11-24T07:59:00.000Z')).baseDate,
    ).toBe('2026-11-23');
  });

  test('既定の出力先はリポジトリのルートのtmp配下の絶対パスになる', () => {
    expect(DEFAULT_OUT_DIR).toBe(resolve('/workspace/tmp/readiness/synthetic'));
  });

  test('全ての項目を指定でき、bunのスクリプトの区切りの--は無視する', () => {
    expect(
      parseGenerateArguments(
        [
          '--',
          '--profile',
          'smoke',
          '--base-date',
          '2026-12-01',
          '--seed',
          '42',
          '--out',
          '/workspace/tmp/x',
          '--export-user-id',
          '01JCDEFGHJKMNPQRSTVWXYZ012',
          '--logo-file-id',
          'shared-logo',
          '--max-statements-per-file',
          '100',
        ],
        NOW,
      ),
    ).toEqual({
      profileName: 'smoke',
      baseDate: '2026-12-01',
      seed: 42,
      outDir: '/workspace/tmp/x',
      exportUserId: '01JCDEFGHJKMNPQRSTVWXYZ012',
      logoFileId: 'shared-logo',
      maxStatementsPerFile: 100,
    });
  });

  test.each([
    [['--profile', 'huge'], /year-one/u],
    [['--base-date', '2026-13-01'], /業務日付/u],
    [['--base-date', 'tomorrow'], /業務日付/u],
    [['--seed', 'abc'], /seed/u],
    [['--seed', '1.5'], /seed/u],
    [['--out', 'relative/dir'], /絶対パス/u],
    [['--export-user-id', 'not-a-ulid'], /ULID/u],
    [['--logo-file-id', ''], /logo-file-id/u],
    [['--max-statements-per-file', '0'], /max-statements-per-file/u],
    [['--unknown'], /unknown/u],
  ])('不正な指定%pは例外にする', (argv, message) => {
    expect(() => parseGenerateArguments(argv, NOW)).toThrow(message);
  });
});

describe('DATASETS', () => {
  test('依存の順に並び、名前が重ならない', () => {
    const names = DATASETS.map((dataset) => dataset.name);

    expect(names).toEqual([
      'users',
      'products',
      'matches',
      'comments',
      'sponsorships',
    ]);
    DATASETS.forEach((dataset, index) => {
      for (const dependency of dataset.dependsOn) {
        expect(names.indexOf(dependency)).toBeLessThan(index);
      }
    });
  });
});

describe('runGenerate', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'synthetic-generate-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  const run = async (extra: readonly string[] = []) => {
    let stdout = '';
    let stderr = '';
    const code = await runGenerate(
      ['--profile', 'smoke', '--out', outDir, ...extra],
      {
        now: () => NOW,
        stdout: { write: (text) => ((stdout += text), true) },
        stderr: { write: (text) => ((stderr += text), true) },
      },
    );
    return { code, stdout, stderr };
  };

  test('検証用の規模の出力は、マイグレーション済みのSQLiteへ順に誤り無く適用でき、manifestの件数と一致する', async () => {
    const { code, stderr } = await run();
    expect(code).toBe(0);
    expect(stderr).toBe('');

    const manifest = JSON.parse(
      await readFile(join(outDir, 'manifest.json'), 'utf8'),
    ) as {
      files: { name: string; statements: number }[];
      counts: Record<string, number>;
    };
    const db = createMigratedDatabase();
    try {
      for (const file of manifest.files) {
        const content = await readFile(join(outDir, file.name), 'utf8');
        expect(content.split('\n').length - 1).toBe(file.statements);
        db.run(content);
      }
      for (const [table, rows] of Object.entries(manifest.counts)) {
        expect(
          db
            .query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`)
            .get()?.n,
        ).toBe(table === 'product_categories' ? rows + 1 : rows);
      }
      expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  test('全てのファイルが1ファイルの文の上限と1文のバイトの上限を守る', async () => {
    await run(['--max-statements-per-file', '30']);

    const names = (await readdir(outDir)).filter((name) =>
      name.endsWith('.sql'),
    );
    expect(names.length).toBeGreaterThan(4);
    for (const name of names) {
      const lines = (await readFile(join(outDir, name), 'utf8'))
        .split('\n')
        .slice(0, -1);
      expect(lines.length).toBeLessThanOrEqual(30);
      expect(
        lines.every((line) => Buffer.byteLength(line, 'utf8') <= 90_000),
      ).toBe(true);
    }
  });

  test('manifestに見本のハンドルと種・基準日・規模を残し、概要を標準出力へ書く', async () => {
    const { stdout } = await run(['--seed', '9', '--base-date', '2026-12-01']);

    const manifest: unknown = JSON.parse(
      await readFile(join(outDir, 'manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      profile: 'smoke',
      seed: 9,
      baseDate: '2026-12-01',
      samples: { largestCreatorHandle: ['synthetic-u-000001'] },
    });
    const { samples } = manifest as {
      samples: Record<string, string[]>;
    };
    expect(samples.matchIds).toHaveLength(5);
    expect(samples.largestThreadProductHandle).toEqual(['synthetic-p-000001']);
    expect(samples.sponsoredProductHandles).toHaveLength(1);
    expect(stdout).toContain('smoke');
    expect(stdout).toContain('2026-12-01');
    expect(stdout).toContain('users');
  });

  test('同じ引数で2回実行すると出力が同じになる', async () => {
    const read = async (): Promise<string[]> =>
      Promise.all(
        (await readdir(outDir))
          .toSorted()
          .map((name) => readFile(join(outDir, name), 'utf8')),
      );
    await run();
    const first = await read();
    await run();

    expect(await read()).toEqual(first);
  });

  test('不正な引数は標準エラーへメッセージを書いて終了コード1を返し、何も書き出さない', async () => {
    const { code, stderr } = await run(['--profile', 'huge']);

    expect(code).toBe(1);
    expect(stderr).toContain('year-one');
    expect(await readdir(outDir)).toEqual([]);
  });
});
