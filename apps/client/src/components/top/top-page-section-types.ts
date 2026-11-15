import type { ComponentType } from 'react';

// bannerは上部の行、showcaseは全幅の注目、mainは本文の列、asideは横の列(1024px未満は本文の下)、bottomはフッター直上
export type TopPagePlacement =
  'banner' | 'showcase' | 'main' | 'aside' | 'bottom';

export interface TopPageSectionContext {
  // 区画が自分の取得の基準に使う当日の予選の日付・時間帯・サーバーの時刻
  readonly board: {
    readonly date: string;
    readonly phase: 'LIVE' | 'RESULT';
    readonly serverTime: string;
  };
  readonly viewer: { readonly signedIn: boolean };
  // ページ全体の「自動更新」の状態。偽の間、区画は定期の取り直し・数値の毎秒の更新・演出を止める。境界の時刻の取り直しと操作の後の更新は止めない
  readonly autoRefresh: boolean;
  // 定期の取り直し・数値の毎秒の更新・演出を持つ間はtrue、持たなくなればfalseを申告する。ページは切り替えを描くかの判定に使い、区画の失敗とアンマウントで申告を消す
  readonly reportAutoUpdating: (active: boolean) => void;
}

export interface TopPageSection {
  // '<spec名>.<名詞句>'
  readonly id: string;
  readonly placement: TopPagePlacement;
  // 本文はYearトーナメント10・Weekトーナメント20・予選30。予選より前に置く区画は30より小さい値を使う
  readonly order: number;
  // 自分でデータを取得し、該当しなければnullを描く
  readonly component: ComponentType<TopPageSectionContext>;
}

export interface QualifierListInsert {
  // '<spec名>.<名詞句>'
  readonly id: string;
  // 同じ位置に入る差し込みの順
  readonly order: number;
  // 対戦カードの何件ごとに差し込むか。1以上の整数。ページ配置のモバイルのGoldが「一覧の2件毎に1枚挿入」のため、件数が割り切れるときは最後の対戦カードの後にも差し込む。
  // 回数はqualifierInsertCountで求まり、差し込めなかった余りを一覧の下に並べるかは登録した機能が決める
  readonly every: number;
  // positionはその差し込みの1から数えた回数。表示する画面幅の判定は部品が持つ
  readonly component: ComponentType<{ readonly position: number }>;
}
