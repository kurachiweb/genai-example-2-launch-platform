import type { AwardLabel } from '#/components/client/award-badges';
import { at } from '#/lib/clock';
import { CURRENT_USER, USERS, findUserByHandle } from '#/lib/mock-data';
import type { User } from '#/lib/mock-data';

import {
  BIO,
  HEADLINE,
  LINKS,
  LONG_BIO,
  LONG_HEADLINE,
  LONG_LINKS,
  LONG_NICKNAME,
} from './content';
import type { ExternalLink } from './content';
import type { ProfileState } from './options';
import { buildLaunchedProducts } from './products';
import type { LaunchedProduct } from './products';
import { buildUpvotes } from './upvotes';
import type { UpvoteEntry } from './upvotes';

export type ViewerRole = ProfileState['auth'];

export type ProfileModel = {
  user: User;
  viewer: User | null;
  role: ViewerRole;
  suspended: boolean;
  headline: string | null;
  bio: string | null;
  links: ExternalLink[];
  followers: number;
  // 特典の有効期間中(有効・支払い失敗の再試行中・解約済みで課金期間内)はUltrasバッジを表示する
  ultras: boolean;
  awards: AwardLabel[];
  products: LaunchedProduct[];
  upvotes: UpvoteEntry[];
  // 閲覧中のユーザー自身のプロフィール画像とプロダクトのロゴが読み込めない、または隔離中
  ownImagesBroken: boolean;
  // Upvote履歴の他のユーザーのプロダクトのロゴ・プロフィール画像。停止によって隔離されるのは本人の画像のみ
  othersImagesBroken: boolean;
  now: Date;
};

// マッチ中・キックオフ予定の表示の基準にする固定の現在時刻(2026年10月2日(金)14:20)
const NOW = at(2026, 10, 2, 14, 20);

const FOLLOWERS: Record<ProfileState['followers'], number> = {
  many: 12345,
  one: 1,
  zero: 0,
};

const PALETTE_COUNT = 12;

function profileUserOf(base: User, state: ProfileState): User {
  const nickname = state.text === 'long' ? LONG_NICKNAME : base.nickname;
  // 必須項目のみの場合はプロフィール画像も未設定
  const art =
    state.fields === 'required'
      ? null
      : (base.art ?? { palette: Number(base.id.slice(4)) % PALETTE_COUNT });
  return { ...base, nickname, art };
}

function viewerOf(state: ProfileState, user: User): User | null {
  if (state.auth === 'guest') return null;
  if (state.auth === 'owner') return user;
  // 本人以外として閲覧する場合、閲覧中のプロフィールのユーザーと同じ仮ユーザーにはしない
  return CURRENT_USER.id === user.id ? USERS[1] : CURRENT_USER;
}

// 存在しない・退会済み、または本人以外が停止中のユーザーを閲覧する場合はnull(どの理由でも同じ404を表示する)
export function buildModel(
  state: ProfileState,
  handle: string,
): ProfileModel | null {
  const found = findUserByHandle(handle);
  if (!found || state.status === 'gone') return null;
  const isOwner = state.auth === 'owner';
  if (state.status === 'suspended' && !isOwner) return null;

  const user = profileUserOf(found, state);
  const long = state.text === 'long';
  const full = state.fields === 'full';
  const products = buildLaunchedProducts(state, isOwner);
  const imagesBroken = state.images === 'broken';

  return {
    user,
    viewer: viewerOf(state, user),
    role: state.auth,
    suspended: state.status === 'suspended',
    headline: full ? (long ? LONG_HEADLINE : HEADLINE) : null,
    bio: full ? (long ? LONG_BIO : BIO) : null,
    links: full ? (long ? LONG_LINKS : LINKS) : [],
    followers: FOLLOWERS[state.followers],
    ultras: state.ultras === 'on',
    awards: products.flatMap(({ product, awards }) =>
      awards.map((award) => ({
        ...award,
        label: `${product.name}・${award.label}`,
      })),
    ),
    products,
    upvotes: buildUpvotes(state, user),
    ownImagesBroken: imagesBroken,
    othersImagesBroken: imagesBroken && state.status !== 'suspended',
    now: NOW,
  };
}
