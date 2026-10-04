# Brief: ultras-subscription

## Problem

熱心な投稿者は、月額の有料プランUltrasに加入すると特典を得られる。特典は再ローンチの禁止期間の短縮(7日→2日)、トーナメント参加費の免除、プロフィール上の加入表示である。特典の有無は複数のspecが判定するため、加入状態の判定を一箇所に集約しないと、解約後の期間末日までの特典継続や支払い失敗時の扱いが、specごとにずれる。

## Current State

- 有料プランの実装は無い。
- Ultrasの状態(active・past_due・canceled・ended)ごとの特典表が[料金とプラン](../../../docs/GUIDES/service/overview/002-pricing-and-plans.md)に定義済みである。
- paymentsでStripe Customer・Webhook反映・フルフィルメントのポートができている前提である。

## Desired Outcome

- 4.18(FR-PPLAN-001〜010)の全機能が動作する。
  - 月額サブスクリプションへの加入と状態表示
  - 解約後も期間末日まで特典を継続
  - 退会時の解約、停止時の期間末日での解約(ユーザーライフサイクルイベントへのハンドラ登録)
  - Webhookによる支払い失敗・解約の反映
  - Customer Portalへの導線
- 「指定時点でUltrasの特典を受けられるか」を返すプラン判定サービスがあり、user-profile-social・product-launch・tournament-week・tournament-yearが利用できる。
- 加入時に未完了のトーナメント決済セッションを失効させるため(FR-PPLAN-007)、「加入が有効になった」イベントを発行する。失効処理そのものはtournament-weekがハンドラとして持つ。
- 有料プラン未加入者への導線表示を切り替える機能フラグ(FR-ADMCF-018)があり、管理画面から変更できる(監査ログの対象)。
- 料金ページ(`/pricing`)と、設定ページ内のプラン管理画面がある。

## Approach

Stripeのサブスクリプション状態をWebhookで取り込み、特典判定はStripeの状態を直接見ずに、このspecが持つ加入状態から導出する。特典を消費する側は判定サービスだけに依存する。

## Scope

- **In**:
  - 4.18(FR-PPLAN-001〜010)
  - FR-ADMCF-018
  - プラン判定サービス、加入イベント
  - 料金ページとプラン管理画面
  - 上記のテスト
- **Out**:
  - 参加費免除の適用と未完了セッションの失効(tournament-week・tournament-year)
  - 再ローンチ間隔の適用(product-launch)
  - プロフィール上の加入表示の描画(user-profile-social)

## Boundary Candidates

- サブスクリプションのライフサイクル
- 特典の判定
- 有料プラン導線の機能フラグ
- 料金ページ

## Out of Boundary

- 都度決済の処理
- 特典を受ける各機能の業務ルール

## Upstream / Downstream

- **Upstream**: payments、admin-foundation
- **Downstream**: user-profile-social、product-launch、tournament-week、tournament-year、ugc-moderation(停止時の解約)

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: payments(Stripeとの通信)

## Constraints

- 要件の論点(要件フェーズで開発者に確認する): 参加費免除の判定時点(予選勝利時・決済期限・組み合わせ決定時のいずれか)と、参加費を決済した後にUltrasへ加入した場合の返金の有無(FR-PPLAN-007は未完了のセッションの失効だけを定める)
- 状態と特典の対応は[料金とプラン](../../../docs/GUIDES/service/overview/002-pricing-and-plans.md)を正とする
