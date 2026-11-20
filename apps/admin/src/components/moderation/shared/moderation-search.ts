import { EMAIL_MAX_LENGTH } from '../../../../common-lib/identity/account-input-rules.ts';
import {
  ADMIN_COMMENT_STATES,
  ADMIN_LAUNCH_STATES,
  type AdminCommentState,
  type AdminProductLaunchState,
  QUARANTINE_REASONS,
  type QuarantineReason,
} from '../../../../common-lib/moderation/moderation-labels.ts';
import { truncateGraphemes } from '../../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../../common-lib/text/white-space.ts';
import { z } from '../../../../lib/utilities/validation/zod.ts';
import type {
  AdminModerationCommentListArgs,
  AdminModerationRatingListArgs,
  AdminRatingStateValue,
} from '../../../graphql/admin-moderation-engagement.ts';
import type {
  AdminModerationProductListArgs,
  AdminProductVisibilityValue,
} from '../../../graphql/admin-moderation-products.ts';
import type {
  AdminModerationUserListArgs,
  AdminUserStatusValue,
} from '../../../graphql/admin-moderation-users.ts';
import type { AdminQuarantinedImageListArgs } from '../../../graphql/admin-quarantined-images.ts';
import { isCalendarDate, toAuditPeriod } from '../../audit/audit-period.ts';

// APIサーバーの管理画面の一覧の検索語の上限と同じ値
export const MODERATION_SEARCH_TERM_MAX = 100;

const CURSOR_MAX = 256;

const UPPERCASE_ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const DEFAULT_QUARANTINE_REASON: QuarantineReason = 'auto';

export const ADMIN_USER_STATUS_VALUES = Object.freeze([
  'active',
  'suspended',
] as const satisfies readonly AdminUserStatusValue[]);

export const ADMIN_PRODUCT_VISIBILITY_VALUES = Object.freeze([
  'visible',
  'hidden',
  'owner_suspended',
] as const satisfies readonly AdminProductVisibilityValue[]);

export const ADMIN_RATING_STATE_VALUES = Object.freeze([
  'valid',
  'invalidated',
] as const satisfies readonly AdminRatingStateValue[]);

export interface UserModerationSearch {
  readonly handle?: string | undefined;
  readonly nickname?: string | undefined;
  readonly email?: string | undefined;
  readonly status?: AdminUserStatusValue | undefined;
  readonly after?: string | undefined;
}

export interface ProductModerationSearch {
  readonly name?: string | undefined;
  readonly handle?: string | undefined;
  readonly ownerHandle?: string | undefined;
  readonly category?: string | undefined;
  readonly launchState?: AdminProductLaunchState | undefined;
  readonly visibility?: AdminProductVisibilityValue | undefined;
  readonly after?: string | undefined;
}

// 投稿日の開始日と終了日は閲覧者の地域の暦の年月日
export interface CommentModerationSearch {
  readonly authorHandle?: string | undefined;
  readonly productHandle?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly state?: AdminCommentState | undefined;
  readonly after?: string | undefined;
}

export interface RatingModerationSearch {
  readonly productHandle?: string | undefined;
  readonly raterHandle?: string | undefined;
  readonly state?: AdminRatingStateValue | undefined;
  readonly after?: string | undefined;
}

// undefinedは既定の自動判定
export interface QuarantinedImageSearch {
  readonly reason?: QuarantineReason | undefined;
}

const USER_FILTER_KEYS = [
  'handle',
  'nickname',
  'email',
  'status',
] as const satisfies readonly (keyof UserModerationSearch)[];

const PRODUCT_FILTER_KEYS = [
  'name',
  'handle',
  'ownerHandle',
  'category',
  'launchState',
  'visibility',
] as const satisfies readonly (keyof ProductModerationSearch)[];

const COMMENT_FILTER_KEYS = [
  'authorHandle',
  'productHandle',
  'from',
  'to',
  'state',
] as const satisfies readonly (keyof CommentModerationSearch)[];

const RATING_FILTER_KEYS = [
  'productHandle',
  'raterHandle',
  'state',
] as const satisfies readonly (keyof RatingModerationSearch)[];

const normalizeSearchTerm = (value: string): string | undefined => {
  const trimmed = trimWhiteSpace(
    truncateGraphemes(trimWhiteSpace(value), MODERATION_SEARCH_TERM_MAX),
  );
  return trimmed === '' ? undefined : trimmed;
};

// ルーターの既定のクエリの解析は数の形の値を数として渡すため、文字列へ戻して受ける
const searchTerm = z
  .union([z.string(), z.number().transform(String)])
  .transform(normalizeSearchTerm)
  .optional()
  .catch(undefined);

const emailTerm = z
  .string()
  .transform((value) => {
    const trimmed = trimWhiteSpace(value);
    return trimmed === '' || trimmed.length > EMAIL_MAX_LENGTH
      ? undefined
      : trimmed;
  })
  .optional()
  .catch(undefined);

const oneOf = <TValue extends string>(values: readonly TValue[]) =>
  z
    .custom<TValue>(
      (value) =>
        typeof value === 'string' &&
        (values as readonly string[]).includes(value),
    )
    .optional()
    .catch(undefined);

const categoryId = z
  .string()
  .regex(UPPERCASE_ULID_PATTERN)
  .optional()
  .catch(undefined);

const calendarDate = z
  .string()
  .refine(isCalendarDate)
  .optional()
  .catch(undefined);

const cursor = z.string().min(1).max(CURSOR_MAX).optional().catch(undefined);

// 共有されたURLや手で書き換えたURLの不正な値は、APIの拒否でページを失敗させず、その条件を未指定として扱う
const USER_SEARCH_SCHEMA = z.object({
  handle: searchTerm,
  nickname: searchTerm,
  email: emailTerm,
  status: oneOf(ADMIN_USER_STATUS_VALUES),
  after: cursor,
});

const PRODUCT_SEARCH_SCHEMA = z.object({
  name: searchTerm,
  handle: searchTerm,
  ownerHandle: searchTerm,
  category: categoryId,
  launchState: oneOf(ADMIN_LAUNCH_STATES),
  visibility: oneOf(ADMIN_PRODUCT_VISIBILITY_VALUES),
  after: cursor,
});

const COMMENT_SEARCH_SCHEMA = z.object({
  authorHandle: searchTerm,
  productHandle: searchTerm,
  from: calendarDate,
  to: calendarDate,
  state: oneOf(ADMIN_COMMENT_STATES),
  after: cursor,
});

const RATING_SEARCH_SCHEMA = z.object({
  productHandle: searchTerm,
  raterHandle: searchTerm,
  state: oneOf(ADMIN_RATING_STATE_VALUES),
  after: cursor,
});

const QUARANTINED_IMAGE_SEARCH_SCHEMA = z.object({
  reason: oneOf(QUARANTINE_REASONS),
});

// 値の無い項目を持たない検索パラメータにし、URLに空の項目を残さない
const definedEntriesOf = <
  TSearch extends object,
  TKey extends keyof TSearch & string,
>(
  source: TSearch,
  keys: readonly TKey[],
): Partial<Pick<TSearch, TKey>> =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = source[key];
      return value === undefined ? [] : [[key, value]];
    }),
  ) as Partial<Pick<TSearch, TKey>>;

const searchAt = <TSearch extends { readonly after?: string | undefined }>(
  search: TSearch,
  filterKeys: readonly (keyof TSearch & string)[],
  after: string | undefined,
): TSearch =>
  ({
    ...definedEntriesOf(search, filterKeys),
    ...(after !== undefined && { after }),
  }) as TSearch;

const filterScopeOf = <TSearch extends object>(
  search: TSearch,
  filterKeys: readonly (keyof TSearch)[],
): string => JSON.stringify(filterKeys.map((key) => search[key] ?? null));

// ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に全ての項目を返す
export const toUserModerationSearch = (
  search: Record<string, unknown>,
): UserModerationSearch => {
  const { handle, nickname, email, status, after } =
    USER_SEARCH_SCHEMA.parse(search);
  return { handle, nickname, email, status, after };
};

export const userModerationListArgsOf = (
  search: UserModerationSearch,
): AdminModerationUserListArgs =>
  definedEntriesOf(search, [...USER_FILTER_KEYS, 'after']);

// 条件を保ったまま、ページの位置だけを替える。undefinedは1ページ目
export const userModerationSearchAt = (
  search: UserModerationSearch,
  after: string | undefined,
): UserModerationSearch => searchAt(search, USER_FILTER_KEYS, after);

// ページの位置を除いた条件を、項目の順に依らない1つの値にする
export const userModerationFilterScopeOf = (
  search: UserModerationSearch,
): string => filterScopeOf(search, USER_FILTER_KEYS);

export const toProductModerationSearch = (
  search: Record<string, unknown>,
): ProductModerationSearch => {
  const {
    name,
    handle,
    ownerHandle,
    category,
    launchState,
    visibility,
    after,
  } = PRODUCT_SEARCH_SCHEMA.parse(search);
  return {
    name,
    handle,
    ownerHandle,
    category,
    launchState,
    visibility,
    after,
  };
};

export const productModerationListArgsOf = ({
  category,
  ...search
}: ProductModerationSearch): AdminModerationProductListArgs => ({
  ...definedEntriesOf(search, [
    'name',
    'handle',
    'ownerHandle',
    'launchState',
    'visibility',
    'after',
  ]),
  ...(category !== undefined && { categoryId: category }),
});

export const productModerationSearchAt = (
  search: ProductModerationSearch,
  after: string | undefined,
): ProductModerationSearch => searchAt(search, PRODUCT_FILTER_KEYS, after);

export const productModerationFilterScopeOf = (
  search: ProductModerationSearch,
): string => filterScopeOf(search, PRODUCT_FILTER_KEYS);

// 開始日が終了日より後の期間はAPIが拒否するため、両端とも未指定にする。年月日の文字列は辞書順が日付の順と一致する
export const toCommentModerationSearch = (
  search: Record<string, unknown>,
): CommentModerationSearch => {
  const { authorHandle, productHandle, from, to, state, after } =
    COMMENT_SEARCH_SCHEMA.parse(search);
  const reversed = from !== undefined && to !== undefined && to < from;
  return {
    authorHandle,
    productHandle,
    from: reversed ? undefined : from,
    to: reversed ? undefined : to,
    state,
    after,
  };
};

// 投稿日の期間は、日時の表示と同じ閲覧者の地域の暦で、開始日の0時を含み終了日の翌日0時を含まない範囲にする
export const commentModerationListArgsOf = (
  { from, to, ...search }: CommentModerationSearch,
  timeZone: string,
): AdminModerationCommentListArgs => {
  const { occurredFrom, occurredBefore } = toAuditPeriod(
    {
      ...(from !== undefined && { from }),
      ...(to !== undefined && { to }),
    },
    timeZone,
  );
  return {
    ...definedEntriesOf(search, ['authorHandle', 'productHandle']),
    ...(occurredFrom !== undefined && { postedFrom: occurredFrom }),
    ...(occurredBefore !== undefined && { postedBefore: occurredBefore }),
    ...definedEntriesOf(search, ['state', 'after']),
  };
};

export const commentModerationSearchAt = (
  search: CommentModerationSearch,
  after: string | undefined,
): CommentModerationSearch => searchAt(search, COMMENT_FILTER_KEYS, after);

export const commentModerationFilterScopeOf = (
  search: CommentModerationSearch,
): string => filterScopeOf(search, COMMENT_FILTER_KEYS);

export const toRatingModerationSearch = (
  search: Record<string, unknown>,
): RatingModerationSearch => {
  const { productHandle, raterHandle, state, after } =
    RATING_SEARCH_SCHEMA.parse(search);
  return { productHandle, raterHandle, state, after };
};

export const ratingModerationListArgsOf = (
  search: RatingModerationSearch,
): AdminModerationRatingListArgs =>
  definedEntriesOf(search, [...RATING_FILTER_KEYS, 'after']);

export const ratingModerationSearchAt = (
  search: RatingModerationSearch,
  after: string | undefined,
): RatingModerationSearch => searchAt(search, RATING_FILTER_KEYS, after);

export const ratingModerationFilterScopeOf = (
  search: RatingModerationSearch,
): string => filterScopeOf(search, RATING_FILTER_KEYS);

// 既定の値はURLに書かないため、自動判定は未指定にする
export const toQuarantinedImageSearch = (
  search: Record<string, unknown>,
): QuarantinedImageSearch => {
  const { reason } = QUARANTINED_IMAGE_SEARCH_SCHEMA.parse(search);
  return { reason: reason === DEFAULT_QUARANTINE_REASON ? undefined : reason };
};

export const quarantinedImageListArgsOf = ({
  reason,
}: QuarantinedImageSearch): AdminQuarantinedImageListArgs => ({
  reason: reason ?? DEFAULT_QUARANTINE_REASON,
});
