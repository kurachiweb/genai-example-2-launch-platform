import type {
  PublicProfileBadgeSection,
  PublicProfileMenuItem,
  PublicProfileTab,
} from '../components/profile/public-profile-section-types.ts';

// 公開プロフィールの右カラムに並べるタブの登録箇所。各specが自分のタブを追記する
export const PUBLIC_PROFILE_TABS: readonly PublicProfileTab[] = Object.freeze(
  [],
);

// 公開プロフィールのフォロワー数の下に並べる受賞バッジの区画の登録箇所。各specが自分の区画を追記する
export const PUBLIC_PROFILE_BADGES: readonly PublicProfileBadgeSection[] =
  Object.freeze([]);

// 公開プロフィールのフォローボタンの横の「…」メニューの項目の登録箇所。各specが自分の項目を追記する
export const PUBLIC_PROFILE_MENU_ITEMS: readonly PublicProfileMenuItem[] =
  Object.freeze([]);
