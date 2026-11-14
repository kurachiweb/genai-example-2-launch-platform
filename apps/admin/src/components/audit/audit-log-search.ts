import {
  AUDIT_FILTER_TEXT_MAX,
  AUDIT_LOG_CURSOR_MAX,
} from '../../../common-lib/admin/admin-input-rules.ts';
import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import type {
  AdminAuditLogsQueryVariables,
  AuditLogFilterInput,
} from '../../graphql/generated/graphql.ts';
import { isCalendarDate, toAuditPeriod } from './audit-period.ts';

// 絞り込みの条件(期間は閲覧者の地域の暦の年月日)と、ページの位置のカーソル
export interface AuditLogSearch {
  readonly operator?: string | undefined;
  readonly action?: string | undefined;
  readonly target?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly after?: string | undefined;
}

const SEARCH_KEYS = [
  'operator',
  'action',
  'target',
  'from',
  'to',
  'after',
] as const satisfies readonly (keyof AuditLogSearch)[];

const FILTER_KEYS = SEARCH_KEYS.filter((key) => key !== 'after');

const textUpTo = (max: number) =>
  z.string().min(1).max(max).optional().catch(undefined);

const calendarDate = z
  .string()
  .refine(isCalendarDate)
  .optional()
  .catch(undefined);

// 共有されたURLや手で書き換えたURLの不正な値は、APIの拒否でページを失敗させず、その条件を未指定として扱う
const SEARCH_SCHEMA = z.object({
  operator: textUpTo(AUDIT_FILTER_TEXT_MAX),
  action: textUpTo(AUDIT_FILTER_TEXT_MAX),
  target: textUpTo(AUDIT_FILTER_TEXT_MAX),
  from: calendarDate,
  to: calendarDate,
  after: textUpTo(AUDIT_LOG_CURSOR_MAX),
});

// 値の無い項目を持たない検索パラメータにし、URLに空の項目を残さない
const definedEntriesOf = (
  source: Readonly<Partial<Record<keyof AuditLogSearch, string | undefined>>>,
  keys: readonly (keyof AuditLogSearch)[],
): AuditLogSearch =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = source[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );

// ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に全ての項目を返す
export const toAuditLogSearch = (
  search: Record<string, unknown>,
): AuditLogSearch => {
  const { operator, action, target, from, to, after } =
    SEARCH_SCHEMA.parse(search);
  return { operator, action, target, from, to, after };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const ULID_PATTERN = /^[0-9a-hjkmnp-tv-z]{26}$/iu;

// 対象の識別子は完全一致で照合されるため、保存される形(仮名化IDのUUIDは小文字、ULIDは大文字)に揃える
export const normalizeTargetId = (value: string): string => {
  const trimmed = trimWhiteSpace(value);
  if (UUID_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return ULID_PATTERN.test(trimmed) ? trimmed.toUpperCase() : trimmed;
};

export function auditLogVariablesOf(
  { operator, action, target, from, to, after }: AuditLogSearch,
  timeZone: string,
): AdminAuditLogsQueryVariables {
  const targetId = target === undefined ? '' : normalizeTargetId(target);
  const filter: AuditLogFilterInput = {
    ...(operator !== undefined && { operatorId: operator }),
    ...(action !== undefined && { action }),
    ...(targetId !== '' && { targetId }),
    ...toAuditPeriod(
      {
        ...(from !== undefined && { from }),
        ...(to !== undefined && { to }),
      },
      timeZone,
    ),
  };
  return { filter, ...(after !== undefined && { after }) };
}

// ページの位置を除いた条件を、項目の順に依らない1つの値にする
export const auditLogFilterScopeOf = (search: AuditLogSearch): string =>
  JSON.stringify(FILTER_KEYS.map((key) => search[key] ?? null));

// 条件を保ったまま、ページの位置だけを替える。undefinedは1ページ目
export const auditLogSearchAt = (
  search: AuditLogSearch,
  after: string | undefined,
): AuditLogSearch => ({
  ...definedEntriesOf(search, FILTER_KEYS),
  ...(after !== undefined && { after }),
});
