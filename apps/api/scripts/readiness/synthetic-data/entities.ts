import { PRODUCT_CATEGORY_OTHER_ID } from '../../../common-lib/product/product-category-constants.ts';
import {
  addBusinessDays,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import { deterministicUlid, deterministicUuid } from './random.ts';
import type { ScaleProfile } from './scale-profile.ts';

export interface EntityContext {
  readonly seed: number;
  readonly baseDate: string;
  readonly profile: ScaleProfile;
  readonly logoFileId?: string;
}

export interface SyntheticUser {
  readonly id: string;
  readonly pseudonymousId: string;
  readonly email: string;
  readonly nickname: string;
  readonly handle: string;
  readonly createdAt: Date;
  readonly emailVerifiedAt: Date;
}

export interface SyntheticCategory {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly createdAt: Date;
}

export interface SyntheticProduct {
  readonly id: string;
  readonly ownerId: string;
  readonly categoryId: string;
  readonly handle: string;
  readonly name: string;
  readonly tagline: string;
  readonly websiteUrl: string;
  readonly descriptionMarkdown: string;
  readonly logoFileId: string;
  readonly latestLaunchDate: string;
  readonly createdAt: Date;
}

export interface SyntheticLaunch {
  readonly id: string;
  readonly productId: string;
  readonly launchDate: string;
  readonly createdAt: Date;
}

const DAY_MS = 86_400_000;

const HOUR_MS = 3_600_000;

const USER_SPAN_DAYS = 365;

// 最後の利用者も基準日の前日までに作られた形にする
const USER_SPAN_END_MARGIN_DAYS = 1;

const CATEGORY_AGE_DAYS = 400;

export const CATEGORY_COUNT = 10;

const NUMBER_WIDTH = 6;

const CATEGORY_NUMBER_WIDTH = 2;

// product-launchのローンチ日の上限(LAUNCH_DATE_HORIZON_DAYS)。翌々業務日から数えて収まるようにする
const LAUNCH_HORIZON_DAYS = 90;

const FIRST_SPREAD_OFFSET_DAYS = 2;

const SPREAD_DAYS = LAUNCH_HORIZON_DAYS - FIRST_SPREAD_OFFSET_DAYS + 1;

const DEFAULT_LOGO_FILE_ID = deterministicUlid(
  new Date(0),
  'synthetic-shared-logo',
);

export const LARGEST_CREATOR_INDEX = 0;

export const QUALIFIER_PARTNER_INDEX = 1;

export function baseInstantOf(baseDate: string): Date {
  return fromBusinessDateTime(parseBusinessDate(baseDate), {
    hour: 0,
    minute: 0,
  });
}

const numberOf = (index: number, width = NUMBER_WIDTH): string =>
  String(index + 1).padStart(width, '0');

function assertIndex(kind: string, index: number, count: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(
      `${kind}の番号は0以上${String(count)}未満の整数で指定してください: ${String(index)}`,
    );
  }
}

export function userAt(context: EntityContext, index: number): SyntheticUser {
  const { seed, baseDate, profile } = context;
  assertIndex('利用者', index, profile.users);
  const start = baseInstantOf(baseDate).getTime() - USER_SPAN_DAYS * DAY_MS;
  const span = (USER_SPAN_DAYS - USER_SPAN_END_MARGIN_DAYS) * DAY_MS;
  const createdAt = new Date(
    start + Math.floor((index * span) / profile.users),
  );
  const number = numberOf(index);
  return {
    id: deterministicUlid(createdAt, `${String(seed)}:user:${String(index)}`),
    pseudonymousId: deterministicUuid(
      `${String(seed)}:pseudonymous:${String(index)}`,
    ),
    email: `synthetic-${number}@readiness.example`,
    nickname: `合成ユーザー${number}`,
    handle: `synthetic-u-${number}`,
    createdAt,
    emailVerifiedAt: new Date(createdAt.getTime() + HOUR_MS),
  };
}

export function categoryAt(
  context: EntityContext,
  index: number,
): SyntheticCategory {
  assertIndex('カテゴリ', index, CATEGORY_COUNT);
  const createdAt = new Date(
    baseInstantOf(context.baseDate).getTime() - CATEGORY_AGE_DAYS * DAY_MS,
  );
  const number = numberOf(index, CATEGORY_NUMBER_WIDTH);
  return {
    id: deterministicUlid(
      createdAt,
      `${String(context.seed)}:category:${String(index)}`,
    ),
    name: `合成カテゴリ${number}`,
    handle: `synthetic-c-${number}`,
    createdAt,
  };
}

// 作り手(番号0)とその対戦相手(番号1)のローンチは基準日の翌業務日にし、投入の後の最初の0:00に開始する2つの側の予選のマッチの対象にする。他は先の日付へ散らす
function launchDateOf(baseDate: string, index: number): string {
  if (index === LARGEST_CREATOR_INDEX || index === QUALIFIER_PARTNER_INDEX) {
    return addBusinessDays(parseBusinessDate(baseDate), 1);
  }
  return addBusinessDays(
    parseBusinessDate(baseDate),
    FIRST_SPREAD_OFFSET_DAYS + ((index - 1) % SPREAD_DAYS),
  );
}

// 合成のカテゴリの後にその他を置き、その他へ割り当てるプロダクトも作る
const categoryIdOf = (context: EntityContext, index: number): string => {
  const position = index % (CATEGORY_COUNT + 1);
  return position === CATEGORY_COUNT
    ? PRODUCT_CATEGORY_OTHER_ID
    : categoryAt(context, position).id;
};

export function productAt(
  context: EntityContext,
  index: number,
): SyntheticProduct {
  assertIndex('プロダクト', index, context.profile.products);
  const owner = userAt(context, index);
  const createdAt = new Date(owner.createdAt.getTime() + HOUR_MS);
  const number = numberOf(index);
  const name = `合成プロダクト${number}`;
  return {
    id: deterministicUlid(
      createdAt,
      `${String(context.seed)}:product:${String(index)}`,
    ),
    ownerId: owner.id,
    categoryId: categoryIdOf(context, index),
    handle: `synthetic-p-${number}`,
    name,
    tagline: `${name}は性能の検証のために作った合成のプロダクトです。`,
    websiteUrl: `https://synthetic-${number}.example`,
    descriptionMarkdown: `## ${name}\n\n性能の検証のために自動で作ったプロダクトの説明です。実在のサービスとは関係がありません。\n\n- 番号: ${number}\n- 用途: 一覧・検索・詳細の表示の計測`,
    logoFileId: context.logoFileId ?? DEFAULT_LOGO_FILE_ID,
    latestLaunchDate: launchDateOf(context.baseDate, index),
    createdAt,
  };
}

export function launchOf(
  context: EntityContext,
  index: number,
): SyntheticLaunch {
  const product = productAt(context, index);
  return {
    id: deterministicUlid(
      product.createdAt,
      `${String(context.seed)}:launch:${String(index)}`,
    ),
    productId: product.id,
    launchDate: product.latestLaunchDate,
    createdAt: product.createdAt,
  };
}
