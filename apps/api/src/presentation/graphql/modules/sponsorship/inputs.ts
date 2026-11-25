import { z } from 'zod';

import type { SponsorshipTier } from '../../../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { UPPERCASE_ULID_PATTERN } from '../../../../../lib/core/ids/uppercase-ulid.ts';
import type {
  AdminSponsorshipFilter,
  AdminSponsorshipStatusFilter,
} from '../../../../../lib/core/sponsorship/ports.ts';
import {
  PRODUCT_ID_INVALID_MESSAGE,
  SPONSORSHIP_ID_INVALID_MESSAGE,
  TERMINATION_TARGET_INVALID_MESSAGE,
} from './errors.ts';

export const MY_SPONSORSHIPS_PAGE_MAX = 20;

export const ADMIN_SPONSORSHIPS_PAGE_MAX = 50;

const TIERS = Object.freeze({
  LEGEND: 'legend',
  GOLD: 'gold',
  SILVER: 'silver',
} as const satisfies Record<string, SponsorshipTier>);

const ADMIN_STATUS_FILTERS = Object.freeze({
  PENDING_PAYMENT: 'pending_payment',
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  ENDED: 'ended',
  TERMINATED: 'terminated',
} as const satisfies Record<string, AdminSponsorshipStatusFilter>);

// 欄ごとの詳細を1件にするため、ULIDの形式の違反で大文字の検査を止める
const uppercaseUlidOf = (message: string) =>
  z
    .ulid({ error: message, abort: true })
    .regex(UPPERCASE_ULID_PATTERN, message);

const pageSizeOf = (max: number) => {
  const message = `表示する件数は1〜${String(max)}件の整数で指定してください。`;
  return z.int(message).min(1, message).max(max, message);
};

// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる。不正な位置はストアがinvalid_cursorにする
const pageCursor = z
  .string()
  .nullish()
  .transform((value) => value ?? undefined);

const productId = uppercaseUlidOf(PRODUCT_ID_INVALID_MESSAGE);

// 値の範囲はGraphQLの列挙型が確かめる
const tier = z
  .enum(['LEGEND', 'GOLD', 'SILVER'])
  .transform((value) => TIERS[value]);

export const SPONSORSHIP_PERIOD_WINDOW_ARGS = z.object({
  productId,
  tier,
  startsOn: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
});

// 掲載期間の規則はユースケースが確かめ、欄ごとの理由のコードを返す
export const APPLY_SPONSORSHIP_ARGS = z.object({
  input: z.object({
    productId,
    tier,
    startsOn: z.string(),
    endsOn: z.string(),
  }),
});

export const RESUME_SPONSORSHIP_CHECKOUT_ARGS = z.object({
  id: uppercaseUlidOf(SPONSORSHIP_ID_INVALID_MESSAGE),
});

export const MY_SPONSORSHIPS_ARGS = z.object({
  first: pageSizeOf(MY_SPONSORSHIPS_PAGE_MAX),
  after: pageCursor,
});

const adminStatusFilter = z
  .enum(['PENDING_PAYMENT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'TERMINATED'])
  .transform((value) => ADMIN_STATUS_FILTERS[value]);

export const ADMIN_SPONSORSHIPS_ARGS = z.object({
  filter: z
    .object({
      status: adminStatusFilter.nullish(),
      tier: tier.nullish(),
    })
    .nullish()
    .transform((filter): AdminSponsorshipFilter => ({
      ...(filter?.status && { status: filter.status }),
      ...(filter?.tier && { tier: filter.tier }),
    })),
  first: pageSizeOf(ADMIN_SPONSORSHIPS_PAGE_MAX),
  after: pageCursor,
});

// 画面の操作では形式の違うIDを送らないため、強制終了できない申込と同じ文言を示す
const terminationTargetId = uppercaseUlidOf(TERMINATION_TARGET_INVALID_MESSAGE);

export const SPONSORSHIP_TERMINATION_PREVIEW_ARGS = z.object({
  id: terminationTargetId,
});

// 理由の空・文字数の上限は監査ログの記録の準備が確かめ、前後の空白を除いた理由を保存する
export const TERMINATE_SPONSORSHIP_ARGS = z.object({
  id: terminationTargetId,
  reason: z.string(),
});
