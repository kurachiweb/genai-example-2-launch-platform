import { parseArgs } from 'node:util';
import { isAbsolute, resolve } from 'node:path';

import {
  parseBusinessDate,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import { productsDataset } from './datasets/products.ts';
import { usersDataset } from './datasets/users.ts';
import { scaleProfileOf } from './scale-profile.ts';
import {
  writeSqlFiles,
  type SyntheticDataset,
  type SyntheticManifest,
} from './sql-writer.ts';

export interface GenerateArguments {
  readonly profileName: string;
  readonly baseDate: string;
  readonly seed: number;
  readonly outDir: string;
  readonly exportUserId?: string;
  readonly logoFileId?: string;
  readonly maxStatementsPerFile: number;
}

export interface GenerateDependencies {
  readonly now: () => Date;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

// 投入の順。後のデータセットは、dependsOnに挙げた前のデータセットの行を外部キーで参照する
export const DATASETS: readonly SyntheticDataset[] = [
  usersDataset,
  productsDataset,
];

// リポジトリのルートのtmp(Git管理外)。このファイルは<ルート>/apps/api/scripts/readiness/synthetic-data/にある
export const DEFAULT_OUT_DIR = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'tmp',
  'readiness',
  'synthetic',
);

const DEFAULT_PROFILE_NAME = 'year-one';

const DEFAULT_SEED = 1;

const DEFAULT_MAX_STATEMENTS_PER_FILE = 5_000;

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const MAX_LOGO_FILE_ID_LENGTH = 100;

const SEPARATOR = '--';

function integerOf(name: string, value: string, min: number): number {
  const number = Number(value);
  if (value.trim() === '' || !Number.isSafeInteger(number) || number < min) {
    throw new RangeError(
      `--${name}は${String(min)}以上の整数で指定してください: ${value}`,
    );
  }
  return number;
}

export function parseGenerateArguments(
  argv: readonly string[],
  now: Date,
): GenerateArguments {
  const { values } = parseArgs({
    args: argv.filter((argument) => argument !== SEPARATOR),
    options: {
      profile: { type: 'string' },
      'base-date': { type: 'string' },
      seed: { type: 'string' },
      out: { type: 'string' },
      'export-user-id': { type: 'string' },
      'logo-file-id': { type: 'string' },
      'max-statements-per-file': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const profileName = scaleProfileOf(
    values.profile ?? DEFAULT_PROFILE_NAME,
  ).name;
  const outDir = values.out ?? DEFAULT_OUT_DIR;
  if (!isAbsolute(outDir)) {
    throw new RangeError(`--outは絶対パスで指定してください: ${outDir}`);
  }
  const exportUserId = values['export-user-id'];
  if (exportUserId !== undefined && !ULID_PATTERN.test(exportUserId)) {
    throw new RangeError(
      `--export-user-idは大文字のULIDで指定してください: ${exportUserId}`,
    );
  }
  const logoFileId = values['logo-file-id'];
  if (
    logoFileId !== undefined &&
    (logoFileId === '' ||
      logoFileId.length > MAX_LOGO_FILE_ID_LENGTH ||
      /\p{Cc}/u.test(logoFileId))
  ) {
    throw new RangeError(
      `--logo-file-idは${String(MAX_LOGO_FILE_ID_LENGTH)}文字以内の制御文字を含まない文字列で指定してください`,
    );
  }
  return {
    profileName,
    baseDate: parseBusinessDate(
      values['base-date'] ?? toBusinessDateTime(now).date,
    ),
    seed:
      values.seed === undefined
        ? DEFAULT_SEED
        : integerOf('seed', values.seed, 0),
    outDir,
    ...(exportUserId === undefined ? {} : { exportUserId }),
    ...(logoFileId === undefined ? {} : { logoFileId }),
    maxStatementsPerFile:
      values['max-statements-per-file'] === undefined
        ? DEFAULT_MAX_STATEMENTS_PER_FILE
        : integerOf(
            'max-statements-per-file',
            values['max-statements-per-file'],
            1,
          ),
  };
}

function summaryOf(manifest: SyntheticManifest, outDir: string): string {
  const bytes = manifest.files.reduce((total, file) => total + file.bytes, 0);
  const counts = Object.entries(manifest.counts)
    .map(([table, count]) => `  ${table}: ${String(count)}`)
    .join('\n');
  return [
    `規模: ${manifest.profile}(種 ${String(manifest.seed)}、基準日 ${manifest.baseDate})`,
    `出力先: ${outDir}`,
    `ファイル: ${String(manifest.files.length)}件、合計${String(bytes)}バイト`,
    '行数:',
    counts,
    '',
  ].join('\n');
}

export async function runGenerate(
  argv: readonly string[],
  { now, stdout, stderr }: GenerateDependencies,
): Promise<number> {
  try {
    const args = parseGenerateArguments(argv, now());
    const manifest = await writeSqlFiles(
      DATASETS,
      scaleProfileOf(args.profileName),
      {
        outDir: args.outDir,
        seed: args.seed,
        baseDate: args.baseDate,
        maxStatementsPerFile: args.maxStatementsPerFile,
        ...(args.exportUserId === undefined
          ? {}
          : { exportUserId: args.exportUserId }),
        ...(args.logoFileId === undefined
          ? {}
          : { logoFileId: args.logoFileId }),
      },
    );
    stdout.write(summaryOf(manifest, args.outDir));
    return 0;
  } catch (error: unknown) {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runGenerate(process.argv.slice(2), {
    now: () => new Date(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
