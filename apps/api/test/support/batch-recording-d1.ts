export interface BatchRecordingD1 {
  readonly d1: D1Database;
  // 一括の書き込みごとの、各文のSQL
  readonly batches: readonly (readonly string[])[];
  // 一括の書き込みに含まれなかった文のSQL
  statementsOutsideBatches(): readonly string[];
}

// 複数の書き込みが同じ一括の書き込みで確定するかを確かめるため、文のSQLを記録してテスト用のD1へそのまま渡す
export function createBatchRecordingD1(base: D1Database): BatchRecordingD1 {
  const queryOf = new WeakMap<D1PreparedStatement, string>();
  const prepared: string[] = [];
  const batches: string[][] = [];
  const prepare = (query: string): D1PreparedStatement => {
    prepared.push(query);
    const statement = base.prepare(query);
    queryOf.set(statement, query);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => {
      const bound = bind(...values);
      queryOf.set(bound, query);
      return bound;
    };
    return statement;
  };
  const d1: D1Database = {
    prepare,
    batch: (statements) => {
      batches.push(statements.map((statement) => queryOf.get(statement) ?? ''));
      return base.batch(statements);
    },
    exec: base.exec.bind(base),
    withSession: base.withSession.bind(base),
    // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも渡す
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: base.dump.bind(base),
  };
  return {
    d1,
    batches,
    statementsOutsideBatches: () => {
      const batched = new Set(batches.flat());
      return prepared.filter((query) => !batched.has(query));
    },
  };
}
