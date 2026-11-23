import { describe, expect, test } from 'bun:test';

import { endQualifierMatchSql } from './launch-journey-sql.ts';

const ENDS_AT = new Date('2026-11-23T10:00:00.000Z');
const NOW = new Date('2026-11-23T10:01:00.000Z');
const ONE_MINUTE_MS = 60_000;

const sqlOf = (handles: readonly string[] = ['alpha', 'beta']): string =>
  endQualifierMatchSql(handles, ENDS_AT, NOW);

describe('endQualifierMatchSql', () => {
  test('終了の日時を指定の時刻にし、開始の日時がそれより前になるよう下げる', () => {
    const sql = sqlOf();

    expect(sql).toContain(`SET ends_at = ${String(ENDS_AT.getTime())}`);
    expect(sql).toContain(
      `starts_at = MIN(starts_at, ${String(ENDS_AT.getTime() - ONE_MINUTE_MS)})`,
    );
    expect(sql).toContain(`updated_at = ${String(NOW.getTime())}`);
  });

  test('未確定の予選のマッチのうち、指定のハンドルのプロダクトの側を持つものだけを対象にし、更新した行を返す', () => {
    const sql = sqlOf();

    expect(sql).toContain(
      "WHERE kind = 'qualifier' AND decided_at IS NULL AND id IN",
    );
    expect(sql).toContain("p.handle IN ('alpha', 'beta')");
    expect(sql).toContain('RETURNING id;');
  });

  test('ハンドルは文字列のリテラルとして引用符を二重にして埋め込む', () => {
    expect(sqlOf(["o'brien"])).toContain("p.handle IN ('o''brien')");
  });

  test('ハンドルが空ならエラーにする', () => {
    expect(() => sqlOf([])).toThrow(RangeError);
  });
});
