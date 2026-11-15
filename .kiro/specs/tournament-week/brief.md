# Brief: tournament-week

## Problem

予選の勝者は、参加費を払うと(Ultras加入者は免除)、その週のProduct of the Week決定トーナメントに挑める。シード数の算出、ローンチ日順の隣接配置、不戦勝の連鎖、参加が0件や1件の場合の終了処理など、ブラケットの規則は複雑である。決済期限・組み合わせ決定・各ラウンドの時刻が日次タイムラインと噛み合わないと、決済済みなのに参加できないといった事故が起きる。

## Current State

- トーナメントの実装は無い。
- シード数S=2P−Nの算出、組み合わせ手順、不戦勝の伝播が[Weekトーナメントルール](../../../docs/GUIDES/service/overview/004-week-tournament-rules.md)に、月曜の決済突合などの時刻が[日次タイムライン](../../../docs/GUIDES/service/overview/007-daily-timeline.md)に定義済みである。
- match-engineで汎用マッチモデルが、paymentsで決済・返金・突合の共通部品が、notificationsで通知イベントの契約ができている前提である。

## Desired Outcome

- Weekトーナメント(FR-TOURW-001〜027)が動作する。
  - 予選の勝者に参加資格を与え、都度決済($5)または有料プランの免除で参加を確定する
  - 決済期限は翌週月曜23:35(セッション作成は23:00まで)
  - 月曜23:45に組み合わせを決める。シードは「N未満で最大の2の冪」になるよう票数と最終Upvote時間で選び、非シードはローンチ日順に隣接させる
  - 火曜から毎日1ラウンドを行い、不戦勝の連鎖、参加0件・1件の場合の終了処理、賞の授与を行う
  - 参加が129以上なら翌週と並行表示する
  - 組み合わせ決定前に削除されたら資格を失い、自動返金する
  - 期限から組み合わせ決定までの間の決済の突合の結果を、参加の確定に反映する(23:40の突合のジョブ`payments.checkout-reconciliation`はpaymentsが所有し、結果はフルフィルメントで受け取る。本specは突合のジョブを重ねて作らない)
- 汎用のブラケットエンジン(シード・組み合わせ・ラウンド進行・不戦勝)があり、tournament-yearが再利用できる。
- トーナメントの表示(トップページやプロダクト詳細ページの区画、ブラケット表示)がある。
- 再ローンチ可否ポリシーへ「トーナメント結果確定待ち」の条件を供給する。
- Ultras加入が有効になった知らせ(ultras-subscriptionの`ULTRAS_ACTIVATION_HANDLERS`)を受けて、参加資格を付与し、未完了の参加費決済セッションをpaymentsの`OpenCheckoutExpirer`で失効させる(FR-PPLAN-008)。
- 通知イベント(開始予告・結果・受賞)を発行する。
- ライフサイクルイベントのハンドラ(退会・停止・非公開化による棄権扱いなど)がある。

## Approach

ブラケットの構築とラウンド進行を、Week・Yearに共通のエンジンとして純粋なドメインロジックで実装し、単体テストで規則の具体例(N=13など)を網羅する。Week固有の部分は、参加資格・期限・開催曜日の設定値として分離する。

## Scope

- **In**:
  - 4.13(FR-TOURW-001〜027)
  - ブラケットエンジン、参加費決済のフルフィルメント、自動返金と突合の結果の適用
  - トーナメントの表示区画、通知イベントの発行
  - 再ローンチ条件の供給、Ultras加入イベントとライフサイクルイベントへのハンドラ
  - 上記のテスト
- **Out**:
  - Product of the Year(tournament-year)
  - マッチと投票の仕組み(match-engine)
  - Stripeとの通信(payments)

## Boundary Candidates

- 参加資格と参加費
- ブラケットエンジン
- ラウンドの進行と賞
- 返金の依頼と突合の結果の適用
- トーナメントの表示

## Out of Boundary

- 予選のペアリング
- 通知メールの送信判定

## Upstream / Downstream

- **Upstream**: match-engine、payments、notifications、ultras-subscription、product-launch
- **Downstream**: tournament-year、ugc-moderation、data-export

## Existing Spec Touchpoints

- **Extends**: ultras-subscription(`ULTRAS_ACTIVATION_HANDLERS`へ加入が有効になった知らせのハンドラを登録する)、payments(購入種別`week_tournament_entry`の`PurchaseKindRegistration`・`PurchaseOfferPolicy`・`PurchaseFulfillment`を実装する)
- **Adjacent**: product-launch(再ローンチ可否ポリシー)、ultras-subscription(参加費免除)

## Constraints

- 時刻と処理順は[日次タイムライン](../../../docs/GUIDES/service/overview/007-daily-timeline.md)を正とする
- 有料プランによる参加費免除の判定時点と決済済み後の加入の返金は、ultras-subscriptionのQ1・Q2で決定済み(勝利時点と加入時点、決済済みの参加費は返金しない)。`ULTRAS_ACTIVATION_HANDLERS`へ登録して資格の付与と`OpenCheckoutExpirer`での失効を行う
  - 免除の判定は、勝利の確定時刻`w`と決済期限`d`に対するultras-subscriptionの`UltrasEntitlements.wasEntitledDuring(userId, w, d)`で行い、Ultrasのテーブルを直接読まない(組み合わせ決定の時点で判定しても同じ答えになる)
  - 知らせのハンドラは`UltrasActivationHandlerRegistration`の`{ name: 'tournament-week.<名詞句>', order, handler }`で、`order`は100以上(ultras-subscriptionの規則)をtournament-yearと重ならないように割り当てる。配送は少なくとも1回のため、ハンドラは冪等にする
  - `OpenCheckoutExpirer.expireOpen({ userId, kinds: ['week_tournament_entry'], targetId?, limit })`はStripeを呼ぶため、eventの非同期の処理から呼ぶ
- 未加入者へのUltrasの導線など、機能フラグの値で表示が変わる画面をE2Eで確かめる場合は、フラグの行を書き換えるultras-subscriptionのE2Eのプロジェクトの依存に加えるか、フラグの値で結果が変わる部分を確かめない(roadmapのShared seams「プラン判定」)
- 23:40の決済の突合のジョブ(`payments.checkout-reconciliation`、`order` 10)はpaymentsが所有する。本specは突合の結果をフルフィルメント(`PurchaseFulfillment`)で受け取り、同じ時刻に突合のジョブを重ねて作らない。23:45の組み合わせ決定は突合の後に動く
- 参加資格を失った場合の自動返金(FR-TOURW-027)は、paymentsの`PaymentRefunds`(全額、依頼キーは本specが一意に決める)で依頼し、Stripeを直接呼ばない
- 要件の論点(要件フェーズで開発者に確認する):
  - トーナメントで敗退した後に再ローンチの禁止期間が掛かるか(FR-RELCH-004周辺)
  - 停止・非公開化に伴う参加資格の停止で返金を自動で行うか(法的通知の大枠の返金ポリシーとFR-ADMUG-045・sponsorshipのbriefの食い違い。roadmapのRequirement Ambiguities)。行う場合は`PaymentRefunds`を呼ぶ
- 参加者へのメールの宛先は、identity-authの`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`)で引く
- `PurchaseKindRegistration`に登録するServiceIdentifierは、本specが`backend-lib/workers/<ドメイン>`の共有モジュールでapi・eventの両方に束縛する(paymentsのRevalidation Triggers)
- 4:21のジョブとユーザーライフサイクルの波及処理の`order`は、roadmapの帯の割り当ての表で本specに割り当てた1500番台(1500〜1599)を使う。波及処理の各ドメインの範囲は0〜9999で、10000以上はidentity-auth専用である。帯の値は同じ時刻・同じ種類の中で上流のspecの後に動くため、上流の値より前に動く必要がある処理があれば設計時に開発者へ確認する
- 参加数が多い場合の組み合わせ計算は、CPU時間とD1のバインド変数上限に収まるよう分割する
