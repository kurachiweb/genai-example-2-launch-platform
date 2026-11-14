export const FAILING_D1_MESSAGE = 'D1_ERROR: 差し込んだ接続の失敗';

export function createFailingD1(): D1Database {
  const fail = (): never => {
    throw new Error(FAILING_D1_MESSAGE);
  };
  return {
    prepare: fail,
    batch: fail,
    exec: fail,
    withSession: fail,
    // D1Databaseの型が非推奨のdumpも必須にするため、偽物でも実装する
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    dump: fail,
  };
}
