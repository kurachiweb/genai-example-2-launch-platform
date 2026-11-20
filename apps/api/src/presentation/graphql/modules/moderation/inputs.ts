import { z } from 'zod';

import { EMAIL_MAX_LENGTH } from '../../../../../common-lib/identity/account-input-rules.ts';
import {
  MODERATION_REASON_MAX,
  MODERATION_REASON_MESSAGES,
} from '../../../../../common-lib/moderation/moderation-actions.ts';
import { countGraphemes } from '../../../../../common-lib/text/graphemes.ts';
import { trimWhiteSpace } from '../../../../../common-lib/text/white-space.ts';
import type {
  AdminCommentState,
  AdminRatingState,
} from '../../../../../lib/core/engagement/ports.ts';
import type {
  AdminUserSearchFilter,
  AdminUserStatus,
} from '../../../../../lib/core/identity/ports.ts';
import { UPPERCASE_ULID_PATTERN } from '../../../../../lib/core/ids/uppercase-ulid.ts';
import type { QuarantineReason } from '../../../../../lib/core/media/media-file.ts';
import type {
  AdminProductLaunchState,
  AdminProductVisibility,
} from '../../../../../lib/core/product/ports.ts';
import type { AdminCommentListFilter } from '../../../../application/moderation/admin-comment-reader.ts';
import type { AdminProductListFilter } from '../../../../application/moderation/admin-product-reader.ts';
import type { AdminRatingListFilter } from '../../../../application/moderation/admin-rating-reader.ts';
import type {
  AdminCommentState as GraphQLAdminCommentState,
  AdminProductLaunchState as GraphQLAdminProductLaunchState,
  AdminProductVisibility as GraphQLAdminProductVisibility,
  AdminRatingState as GraphQLAdminRatingState,
  AdminUserStatus as GraphQLAdminUserStatus,
  QuarantineReason as GraphQLQuarantineReason,
} from '../../generated/resolvers-types.ts';
import {
  CATEGORY_ID_INVALID_MESSAGE,
  COMMENT_ID_INVALID_MESSAGE,
  IMAGE_ID_INVALID_MESSAGE,
  PRODUCT_ID_INVALID_MESSAGE,
  RATING_ID_INVALID_MESSAGE,
  USER_ID_INVALID_MESSAGE,
} from './errors.ts';

export const ADMIN_MODERATION_PAGE_MAX = 50;

export const MODERATION_SEARCH_TERM_MAX = 100;

const PAGE_SIZE_MESSAGE = `表示する件数は1〜${String(ADMIN_MODERATION_PAGE_MAX)}件の整数で指定してください。`;

const SEARCH_TERM_TOO_LONG_MESSAGE = `検索語は${String(MODERATION_SEARCH_TERM_MAX)}文字以内で入力してください。`;

const EMAIL_TOO_LONG_MESSAGE = `メールアドレスは${String(EMAIL_MAX_LENGTH)}文字以内で入力してください。`;

const POSTED_PERIOD_REVERSED_MESSAGE =
  '終了日には開始日と同じか後の日付を入力してください。';

export const ADMIN_USER_STATUSES = Object.freeze({
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const satisfies Record<GraphQLAdminUserStatus, AdminUserStatus>);

export const ADMIN_PRODUCT_LAUNCH_STATES = Object.freeze({
  SCHEDULED: 'scheduled',
  IN_PROGRESS: 'in_progress',
  WON: 'won',
  LOST: 'lost',
  CANCELED: 'canceled',
} as const satisfies Record<
  GraphQLAdminProductLaunchState,
  AdminProductLaunchState
>);

export const ADMIN_PRODUCT_VISIBILITIES = Object.freeze({
  VISIBLE: 'visible',
  HIDDEN: 'hidden',
  OWNER_SUSPENDED: 'owner_suspended',
} as const satisfies Record<
  GraphQLAdminProductVisibility,
  AdminProductVisibility
>);

export const ADMIN_COMMENT_STATES = Object.freeze({
  HIDDEN: 'hidden',
  DELETED: 'deleted',
  ANONYMIZED: 'anonymized',
  AUTHOR_UNAVAILABLE: 'author_unavailable',
  SHOWN: 'shown',
} as const satisfies Record<GraphQLAdminCommentState, AdminCommentState>);

export const ADMIN_RATING_STATES = Object.freeze({
  VALID: 'valid',
  INVALIDATED: 'invalidated',
} as const satisfies Record<GraphQLAdminRatingState, AdminRatingState>);

export const QUARANTINE_REASONS = Object.freeze({
  AUTO: 'auto',
  PRODUCT_HIDDEN: 'product_hidden',
  USER_SUSPENDED: 'user_suspended',
  ADMIN_ACTION: 'admin_action',
} as const satisfies Record<GraphQLQuarantineReason, QuarantineReason>);

// 値の範囲はGraphQLの列挙型が確かめるため、上流の値への写しだけを行う
const enumOf = <TTable extends Readonly<Record<string, string>>>(
  table: TTable,
) =>
  z
    .enum(Object.keys(table) as [keyof TTable & string])
    .transform((value): TTable[keyof TTable] => table[value]);

const optionalEnumOf = <TTable extends Readonly<Record<string, string>>>(
  table: TTable,
) => enumOf(table).nullish();

// 欄ごとの詳細を1件にするため、ULIDの形式の違反で大文字の検査を止める
const uppercaseUlidOf = (message: string) =>
  z
    .ulid({ error: message, abort: true })
    .regex(UPPERCASE_ULID_PATTERN, message);

const pageSize = z
  .int(PAGE_SIZE_MESSAGE)
  .min(1, PAGE_SIZE_MESSAGE)
  .max(ADMIN_MODERATION_PAGE_MAX, PAGE_SIZE_MESSAGE);

// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる。不正な位置は上流の照会がinvalid_cursorにする
const pageCursor = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

// 前後の空白を除いて空になる条件は未指定とする
const trimmedOptionalText = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = trimWhiteSpace(value ?? '');
    return trimmed === '' ? undefined : trimmed;
  });

const searchTerm = trimmedOptionalText.refine(
  (value) =>
    value === undefined || countGraphemes(value) <= MODERATION_SEARCH_TERM_MAX,
  SEARCH_TERM_TOO_LONG_MESSAGE,
);

const emailTerm = trimmedOptionalText.refine(
  (value) => value === undefined || value.length <= EMAIL_MAX_LENGTH,
  EMAIL_TOO_LONG_MESSAGE,
);

const postedAt = z
  .number()
  .nullish()
  .transform((value) => (value == null ? undefined : new Date(value)));

const withinReasonMax = (value: string | undefined): boolean =>
  value === undefined ||
  countGraphemes(trimWhiteSpace(value)) <= MODERATION_REASON_MAX;

// 理由の要否と前後の空白を除いた保存の値はユースケースが決めるため、上限だけを確かめて入力のまま渡す
const reason = z
  .string()
  .refine(withinReasonMax, MODERATION_REASON_MESSAGES['too-long']);

const optionalReason = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined)
  .refine(withinReasonMax, MODERATION_REASON_MESSAGES['too-long']);

// 省略可能な項目を、値のある条件だけを持つオブジェクトにする
const definedEntriesOf = <T extends object>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };

export const ADMIN_USERS_ARGS = z.object({
  filter: z
    .object({
      handle: searchTerm,
      nickname: searchTerm,
      email: emailTerm,
      status: optionalEnumOf(ADMIN_USER_STATUSES).transform(
        (value) => value ?? undefined,
      ),
    })
    .nullish()
    .transform((filter): AdminUserSearchFilter =>
      definedEntriesOf(filter ?? {}),
    ),
  first: pageSize,
  after: pageCursor,
});

export const ADMIN_PRODUCTS_ARGS = z.object({
  filter: z
    .object({
      name: searchTerm,
      handle: searchTerm,
      ownerHandle: searchTerm,
      categoryId: uppercaseUlidOf(CATEGORY_ID_INVALID_MESSAGE)
        .nullish()
        .transform((value) => value ?? undefined),
      launchState: optionalEnumOf(ADMIN_PRODUCT_LAUNCH_STATES).transform(
        (value) => value ?? undefined,
      ),
      visibility: optionalEnumOf(ADMIN_PRODUCT_VISIBILITIES).transform(
        (value) => value ?? undefined,
      ),
    })
    .nullish()
    .transform((filter): AdminProductListFilter =>
      definedEntriesOf(filter ?? {}),
    ),
  first: pageSize,
  after: pageCursor,
});

export const ADMIN_PRODUCT_ARGS = z.object({
  id: uppercaseUlidOf(PRODUCT_ID_INVALID_MESSAGE),
});

export const ADMIN_PRODUCT_RATINGS_ARGS = z.object({
  productId: uppercaseUlidOf(PRODUCT_ID_INVALID_MESSAGE),
  first: pageSize,
  after: pageCursor,
});

export const ADMIN_COMMENTS_ARGS = z.object({
  filter: z
    .object({
      authorHandle: searchTerm,
      productHandle: searchTerm,
      postedFrom: postedAt,
      postedBefore: postedAt,
      state: optionalEnumOf(ADMIN_COMMENT_STATES).transform(
        (value) => value ?? undefined,
      ),
    })
    .refine(
      ({ postedFrom, postedBefore }) =>
        postedFrom === undefined ||
        postedBefore === undefined ||
        postedFrom < postedBefore,
      { message: POSTED_PERIOD_REVERSED_MESSAGE, path: ['postedBefore'] },
    )
    .nullish()
    .transform((filter): AdminCommentListFilter =>
      definedEntriesOf(filter ?? {}),
    ),
  first: pageSize,
  after: pageCursor,
});

export const ADMIN_RATINGS_ARGS = z.object({
  filter: z
    .object({
      productHandle: searchTerm,
      raterHandle: searchTerm,
      state: optionalEnumOf(ADMIN_RATING_STATES).transform(
        (value) => value ?? undefined,
      ),
    })
    .nullish()
    .transform((filter): AdminRatingListFilter =>
      definedEntriesOf(filter ?? {}),
    ),
  first: pageSize,
  after: pageCursor,
});

export const ADMIN_QUARANTINED_IMAGES_ARGS = z.object({
  reason: enumOf(QUARANTINE_REASONS),
  after: pageCursor,
});

const requiredReasonArgsOf = (idInvalidMessage: string) =>
  z.object({
    id: uppercaseUlidOf(idInvalidMessage),
    reason,
  });

export const USER_MODERATION_ARGS = requiredReasonArgsOf(
  USER_ID_INVALID_MESSAGE,
);

export const PRODUCT_MODERATION_ARGS = requiredReasonArgsOf(
  PRODUCT_ID_INVALID_MESSAGE,
);

export const COMMENT_MODERATION_ARGS = requiredReasonArgsOf(
  COMMENT_ID_INVALID_MESSAGE,
);

export const RATING_MODERATION_ARGS = requiredReasonArgsOf(
  RATING_ID_INVALID_MESSAGE,
);

export const ADMINISTRATIVE_WITHDRAWAL_ARGS = z.object({
  input: z.object({
    userId: uppercaseUlidOf(USER_ID_INVALID_MESSAGE),
    reason,
  }),
});

export const IMAGE_MODERATION_ARGS = z.object({
  fileId: uppercaseUlidOf(IMAGE_ID_INVALID_MESSAGE),
  reason: optionalReason,
});
