import { INQUIRY_CURSOR_MAX } from '../../../common-lib/inquiry/inquiry-input-rules.ts';
import { z } from '../../../lib/utilities/validation/zod.ts';
import type {
  AdminInquiriesQueryVariables,
  AdminInquiryFilterInput,
  InquiryKind,
  InquiryStatus,
} from '../../graphql/generated/graphql.ts';
import { isCalendarDate } from '../audit/audit-period.ts';
import { toInquiryPeriod } from './inquiry-period.ts';

// 絞り込みの条件(ステータスと種別はAPIの列挙の値、期間は閲覧者の地域の暦の年月日)と、ページの位置のカーソル
export interface AdminInquirySearch {
  readonly status?: InquiryStatus | undefined;
  readonly kind?: InquiryKind | undefined;
  readonly category?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly after?: string | undefined;
}

export const ADMIN_INQUIRY_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'REJECTED',
] as const satisfies readonly InquiryStatus[];

export const ADMIN_INQUIRY_KINDS = [
  'MEMBER',
  'GUEST',
] as const satisfies readonly InquiryKind[];

// APIのIDの入力の上限と同じ長さ
const CATEGORY_ID_MAX = 64;

const SEARCH_KEYS = [
  'status',
  'kind',
  'category',
  'from',
  'to',
  'after',
] as const satisfies readonly (keyof AdminInquirySearch)[];

const FILTER_KEYS = SEARCH_KEYS.filter((key) => key !== 'after');

const calendarDate = z
  .string()
  .refine(isCalendarDate)
  .optional()
  .catch(undefined);

// 共有されたURLや手で書き換えたURLの不正な値は、APIの拒否でページを失敗させず、その条件を未指定として扱う
const SEARCH_SCHEMA = z.object({
  status: z.enum(ADMIN_INQUIRY_STATUSES).optional().catch(undefined),
  kind: z.enum(ADMIN_INQUIRY_KINDS).optional().catch(undefined),
  category: z.string().min(1).max(CATEGORY_ID_MAX).optional().catch(undefined),
  from: calendarDate,
  to: calendarDate,
  after: z.string().min(1).max(INQUIRY_CURSOR_MAX).optional().catch(undefined),
});

// 値の無い項目を持たない検索パラメータにし、URLに空の項目を残さない
const definedEntriesOf = (
  source: AdminInquirySearch,
  keys: readonly (keyof AdminInquirySearch)[],
): AdminInquirySearch =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = source[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );

// ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に全ての項目を返す
export const toAdminInquirySearch = (
  search: Record<string, unknown>,
): AdminInquirySearch => {
  const { status, kind, category, from, to, after } =
    SEARCH_SCHEMA.parse(search);
  return { status, kind, category, from, to, after };
};

export function adminInquiryVariablesOf(
  { status, kind, category, from, to, after }: AdminInquirySearch,
  timeZone: string,
): AdminInquiriesQueryVariables {
  const filter: AdminInquiryFilterInput = {
    ...(status !== undefined && { status }),
    ...(kind !== undefined && { kind }),
    ...(category !== undefined && { categoryId: category }),
    ...toInquiryPeriod(
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
export const adminInquiryFilterScopeOf = (search: AdminInquirySearch): string =>
  JSON.stringify(FILTER_KEYS.map((key) => search[key] ?? null));

// 条件を保ったまま、ページの位置だけを替える。undefinedは1ページ目
export const adminInquirySearchAt = (
  search: AdminInquirySearch,
  after: string | undefined,
): AdminInquirySearch => ({
  ...definedEntriesOf(search, FILTER_KEYS),
  ...(after !== undefined && { after }),
});
