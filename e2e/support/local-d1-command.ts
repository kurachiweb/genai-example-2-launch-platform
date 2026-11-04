import { invitationTarget } from '../../apps/api/scripts/admin/invitation-targets.ts';

export type LocalD1Row = Readonly<Record<string, unknown>>;

const D1_BINDING = 'DB';

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
