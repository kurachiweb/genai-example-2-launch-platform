import { sqlStringLiteral } from '../../../apps/api/scripts/admin/sql-string-literal.ts';

const MINUTE_MS = 60_000;

// 予選のマッチの確定は終了の日時を過ぎたマッチを実際の時刻で選ぶため、23:40の起動の前に、指定したプロダクトのマッチの終了の日時を過去へ移す。開始の日時は終了の日時より前でなければならない制約があるため、必要なら下げる
export function endQualifierMatchSql(
  productHandles: readonly string[],
  endsAt: Date,
  now: Date,
): string {
  if (productHandles.length === 0) {
    throw new RangeError('終了させるマッチのプロダクトのハンドルがありません');
  }
  const handles = productHandles.map((handle) => sqlStringLiteral(handle));
  const endsAtMs = endsAt.getTime();
  return `UPDATE matches SET ends_at = ${String(endsAtMs)}, starts_at = MIN(starts_at, ${String(endsAtMs - MINUTE_MS)}), updated_at = ${String(now.getTime())} WHERE kind = 'qualifier' AND decided_at IS NULL AND id IN (SELECT me.match_id FROM match_entries me JOIN products p ON p.id = me.product_id WHERE p.handle IN (${handles.join(', ')})) RETURNING id;`;
}
