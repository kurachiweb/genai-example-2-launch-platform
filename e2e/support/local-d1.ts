import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  type LocalD1Row,
  localD1ExecuteArgs,
  parseLocalD1Output,
} from './local-d1-command.ts';

export type { LocalD1Row } from './local-d1-command.ts';

// SQLへ埋め込む値は、招待の発行コマンドと同じ規則で必ずこの関数で文字列のリテラルにする
export { sqlStringLiteral } from '../../apps/api/scripts/admin/invitation-sql.ts';

const API_DIR = join(import.meta.dirname, '..', '..', 'apps', 'api');

const WRANGLER_BIN = join(API_DIR, 'node_modules', '.bin', 'wrangler');

// 結果の行を多く返す照会でも出力が切れないよう、既定(1MiB)より大きくする
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

const runFile = promisify(execFile);

const outputOf = (error: unknown, key: 'stdout' | 'stderr'): string => {
  if (typeof error !== 'object' || error === null || !(key in error)) {
    return '';
  }
  const value: unknown = Reflect.get(error, key);
  return typeof value === 'string' ? value.trim() : '';
};

// 画面から作れない状態(ロールの設定など)をローカルのD1へ直接用意する。リモートのD1を操作する引数は組み立てない
export async function executeLocalD1(
  sql: string,
): Promise<readonly LocalD1Row[]> {
  let stdout: string;
  try {
    ({ stdout } = await runFile(WRANGLER_BIN, [...localD1ExecuteArgs(sql)], {
      cwd: API_DIR,
      maxBuffer: MAX_OUTPUT_BYTES,
    }));
  } catch (error) {
    const details = [outputOf(error, 'stdout'), outputOf(error, 'stderr')]
      .filter((text) => text !== '')
      .join('\n');
    throw new Error(`ローカルのD1でSQLを実行できませんでした。\n${details}`, {
      cause: error,
    });
  }
  return parseLocalD1Output(stdout);
}
