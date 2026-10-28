import type { ComponentType } from 'react';

export interface AdminLayoutSlots {
  readonly navigation: ComponentType | null;
  readonly headerAccount: ComponentType | null;
}

// 後続のspecは基本レイアウトを変えずに、ここの部品の差し替えで区画を加える。nullの区画は入れ物ごと描画しない
// navigationの部品はヘッダーと本文の間(768px以上では本文の左の列、768px未満では本文の上)に包む要素無しで置かれるため、自身で名前付きのnav要素を描く
// headerAccountの部品はヘッダーの右端の配色の切替ボタンの後に置かれる
export const ADMIN_LAYOUT_SLOTS: AdminLayoutSlots = Object.freeze({
  navigation: null,
  headerAccount: null,
});
