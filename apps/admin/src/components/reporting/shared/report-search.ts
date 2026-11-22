import type { ReportCaseStatus } from '../../../../common-lib/reporting/report-case-rules.ts';
import type { ReportTargetKind } from '../../../../common-lib/reporting/report-rules.ts';
import { z } from '../../../../lib/utilities/validation/zod.ts';
import type { ReportCaseListArgs } from '../../../graphql/admin-reporting-cases.ts';
import { isCalendarDate, toAuditPeriod } from '../../audit/audit-period.ts';

// URLの対応ステータスと対象の種類は、他の管理画面の一覧のURL(`/inquiries?status=OPEN`など)とそろえてAPIの列挙の値で持つ
export const REPORT_SEARCH_STATUS_OF = Object.freeze({
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
  REJECTED: 'rejected',
} as const satisfies Record<string, ReportCaseStatus>);

export type ReportSearchStatus = keyof typeof REPORT_SEARCH_STATUS_OF;

export const REPORT_SEARCH_TARGET_OF = Object.freeze({
  USER: 'user',
  PRODUCT: 'product',
  COMMENT: 'comment',
} as const satisfies Record<string, ReportTargetKind>);

export type ReportSearchTarget = keyof typeof REPORT_SEARCH_TARGET_OF;

export const REPORT_SEARCH_STATUSES = Object.freeze(
  Object.keys(REPORT_SEARCH_STATUS_OF) as ReportSearchStatus[],
);

export const REPORT_SEARCH_TARGETS = Object.freeze(
  Object.keys(REPORT_SEARCH_TARGET_OF) as ReportSearchTarget[],
);

// 受付日の開始日と終了日は閲覧者の地域の暦の年月日
export interface ReportSearch {
  readonly status?: ReportSearchStatus | undefined;
  readonly target?: ReportSearchTarget | undefined;
  readonly category?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly after?: string | undefined;
}

export type ReportSearchFilters = Omit<ReportSearch, 'after'>;

const CURSOR_MAX = 256;

const UPPERCASE_ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const FILTER_KEYS = [
  'status',
  'target',
  'category',
  'from',
  'to',
] as const satisfies readonly (keyof ReportSearchFilters)[];

const oneOf = <TValue extends string>(values: readonly TValue[]) =>
  z
    .custom<TValue>(
      (value) =>
        typeof value === 'string' &&
        (values as readonly string[]).includes(value),
    )
    .optional()
    .catch(undefined);

const calendarDate = z
  .string()
  .refine(isCalendarDate)
  .optional()
  .catch(undefined);

// 共有されたURLや手で書き換えたURLの不正な値は、APIの拒否でページを失敗させず、その条件を未指定として扱う
const SEARCH_SCHEMA = z.object({
  status: oneOf(REPORT_SEARCH_STATUSES),
  target: oneOf(REPORT_SEARCH_TARGETS),
  category: z
    .string()
    .regex(UPPERCASE_ULID_PATTERN)
    .optional()
    .catch(undefined),
  from: calendarDate,
  to: calendarDate,
  after: z.string().min(1).max(CURSOR_MAX).optional().catch(undefined),
});

// 値の無い項目を持たない検索パラメータにし、URLに空の項目を残さない
const definedEntriesOf = (
  source: ReportSearch,
  keys: readonly (keyof ReportSearch)[],
): ReportSearch =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = source[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );

// ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に全ての項目を返す。開始日が終了日より後の期間はAPIが拒否するため両端とも未指定にする(年月日の文字列は辞書順が日付の順と一致する)
export const toReportSearch = (
  search: Record<string, unknown>,
): ReportSearch => {
  const { status, target, category, from, to, after } =
    SEARCH_SCHEMA.parse(search);
  const reversed = from !== undefined && to !== undefined && to < from;
  return {
    status,
    target,
    category,
    from: reversed ? undefined : from,
    to: reversed ? undefined : to,
    after,
  };
};

// 受付日の期間は、日時の表示と同じ閲覧者の地域の暦で、開始日の0時を含み終了日の翌日0時を含まない範囲にする
export const reportCaseListArgsOf = (
  { status, target, category, from, to, after }: ReportSearch,
  timeZone: string,
): ReportCaseListArgs => {
  const { occurredFrom, occurredBefore } = toAuditPeriod(
    {
      ...(from !== undefined && { from }),
      ...(to !== undefined && { to }),
    },
    timeZone,
  );
  return {
    ...(status !== undefined && { status: REPORT_SEARCH_STATUS_OF[status] }),
    ...(target !== undefined && {
      targetKind: REPORT_SEARCH_TARGET_OF[target],
    }),
    ...(category !== undefined && { categoryId: category }),
    ...(occurredFrom !== undefined && { reportedFrom: occurredFrom }),
    ...(occurredBefore !== undefined && { reportedBefore: occurredBefore }),
    ...(after !== undefined && { after }),
  };
};

// 条件を保ったまま、ページの位置だけを替える。undefinedは1ページ目
export const reportCaseSearchAt = (
  search: ReportSearch,
  after: string | undefined,
): ReportSearch => ({
  ...definedEntriesOf(search, FILTER_KEYS),
  ...(after !== undefined && { after }),
});

// ページの位置を除いた条件を、項目の順に依らない1つの値にする
export const reportCaseFilterScopeOf = (search: ReportSearch): string =>
  JSON.stringify(FILTER_KEYS.map((key) => search[key] ?? null));

// 条件を変えた後の一覧は件数も変わるため、ページの位置を外して1ページ目から示す
export const withReportSearchFilters = (
  search: ReportSearch,
  patch: Partial<ReportSearchFilters>,
): ReportSearch =>
  definedEntriesOf(
    toReportSearch({ ...search, ...patch, after: undefined }),
    FILTER_KEYS,
  );
