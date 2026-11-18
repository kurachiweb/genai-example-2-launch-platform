import { z } from 'zod';

import type { SponsorshipTier } from '../../../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { UPPERCASE_ULID_PATTERN } from '../../../../../lib/core/ids/uppercase-ulid.ts';
import {
  PRODUCT_ID_INVALID_MESSAGE,
  SPONSORSHIP_ID_INVALID_MESSAGE,
} from './errors.ts';

export const MY_SPONSORSHIPS_PAGE_MAX = 20;

const PAGE_SIZE_MESSAGE = `表示する件数は1〜${String(MY_SPONSORSHIPS_PAGE_MAX)}件の整数で指定してください。`;

const TIERS = Object.freeze({
  LEGEND: 'legend',
  GOLD: 'gold',
  SILVER: 'silver',
} as const satisfies Record<string, SponsorshipTier>);

// 欄ごとの詳細を1件にするため、ULIDの形式の違反で大文字の検査を止める
const uppercaseUlidOf = (message: string) =>
  z
    .ulid({ error: message, abort: true })
    .regex(UPPERCASE_ULID_PATTERN, message);

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

// GraphQLの省略可能な引数は明示したnullでも届くため、未指定と同じ扱いにそろえる。不正な位置はストアがinvalid_cursorにする
export const MY_SPONSORSHIPS_ARGS = z.object({
  first: z
    .int(PAGE_SIZE_MESSAGE)
    .min(1, PAGE_SIZE_MESSAGE)
    .max(MY_SPONSORSHIPS_PAGE_MAX, PAGE_SIZE_MESSAGE),
  after: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
});
