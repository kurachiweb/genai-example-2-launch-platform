import type { ComponentType } from 'react';

import { GuestAccountLinks } from '../components/layout/guest-account-links.tsx';
import { LaunchLink } from '../components/layout/launch-link.tsx';

export interface SiteLayoutSlots {
  readonly headerAccount: ComponentType;
  readonly headerLaunchAction: ComponentType;
  readonly belowHeader: readonly ComponentType[];
  readonly beforeFooter: readonly ComponentType[];
  readonly footerHelpLinks: readonly ComponentType[];
}

// 後続のspecは共通レイアウトを変えずに、ここの部品の差し替えと配列への追記で区画を加える。配列の区画は並べた順に描画する。
// footerHelpLinksの部品はフッターのヘルプの一覧(ul)の直下に置かれ、記事の件数や読み込みの状態で項目の数が変わるため、包む要素を持たずに0個以上のli要素を描く
// 768px未満ではヘッダーの区画の部品がヘッダーの中とメニューの中に同時にマウントされるため、ヘッダーの区画の部品は固定のidを持たない
export const SITE_LAYOUT_SLOTS: SiteLayoutSlots = Object.freeze({
  headerAccount: GuestAccountLinks,
  headerLaunchAction: LaunchLink,
  belowHeader: Object.freeze([]),
  beforeFooter: Object.freeze([]),
  footerHelpLinks: Object.freeze([]),
});
