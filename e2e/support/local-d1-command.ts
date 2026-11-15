import { invitationTarget } from '../../apps/api/scripts/admin/invitation-targets.ts';

export type LocalD1Row = Readonly<Record<string, unknown>>;

const D1_BINDING = 'DB';

export const LOCAL_D1_LOCK_CONFLICT_MAX_ATTEMPTS = 5;

export const LOCAL_D1_LOCK_CONFLICT_RETRY_DELAY_MS = 300;

// 別のプロセスが同じローカルのD1を開いていてロックの競合で書き込みが取り消された時に、Wranglerの標準出力かworkerdの標準エラーに出る文言。後に拡張のコード(`SQLITE_BUSY_RECOVERY`など)が続くことがある
const LOCAL_D1_LOCK_CONFLICT_OUTPUTS = Object.freeze([
  'database is locked: SQLITE_BUSY',
  'attempt to write a readonly database: SQLITE_READONLY',
]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// 招待の発行コマンドと同じ引数でローカルの状態の保存先を指し、APIサーバー・イベントサーバーの開発サーバーと同じD1を操作する
export function localD1ExecuteArgs(sql: string): readonly string[] {
  return [
    'd1',
    'execute',
    D1_BINDING,
    ...invitationTarget('local').wranglerArgs,
    '--json',
    '--command',
    sql,
  ];
}

const rowsOf = (statement: unknown): readonly LocalD1Row[] | undefined => {
  if (!isRecord(statement) || !Array.isArray(statement.results)) {
    return undefined;
  }
  const rows: readonly unknown[] = statement.results;
  return rows.every(isRecord) ? rows : undefined;
};

// 複数の文を渡すと文ごとの結果が並ぶため、行を文の順につなげて返す
export function parseLocalD1Output(stdout: string): readonly LocalD1Row[] {
  const invalid = (cause?: unknown): Error =>
    new Error(`ローカルのD1の実行結果の形式が正しくありません: ${stdout}`, {
      cause,
    });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw invalid(error);
  }
  if (!Array.isArray(parsed)) {
    throw invalid();
  }
  const statements: readonly unknown[] = parsed;
  return statements.flatMap((statement) => {
    const rows = rowsOf(statement);
    if (rows === undefined) {
      throw invalid();
    }
    return rows;
  });
}

export const isLocalD1LockConflict = (error: unknown): boolean =>
  error instanceof Error &&
  LOCAL_D1_LOCK_CONFLICT_OUTPUTS.some((output) =>
    error.message.includes(output),
  );

// ロックの競合で失敗した実行は文を1つも反映しないため、同じSQLを実行し直しても二重に書き込まない
export async function retryOnLocalD1LockConflict<T>(
  attempt: () => Promise<T>,
  wait: (milliseconds: number) => Promise<void>,
): Promise<T> {
  for (let attempted = 1; ; attempted += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (
        attempted >= LOCAL_D1_LOCK_CONFLICT_MAX_ATTEMPTS ||
        !isLocalD1LockConflict(error)
      ) {
        throw error;
      }
      await wait(LOCAL_D1_LOCK_CONFLICT_RETRY_DELAY_MS);
    }
  }
}
