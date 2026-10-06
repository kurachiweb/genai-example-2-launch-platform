# Brief: payments

## Problem

本サービスの収益源は、有料プランUltras(月額)、トーナメント参加費(Week・Year)、スポンサー広告(日数×単価)の3つで、すべてStripeで決済する。決済結果の反映(Webhookとreturn_url)、冪等性、返金、チャージバックの反映、税込のUSD表示、特定商取引法の表記には、共通の厳密な扱いが要る。これを用途ごとに実装すると、二重反映や状態の巻き戻りが起きる。

## Current State

- 決済の実装は無い。
- 料金体系(Ultras $9/月、Week参加費$5、Year参加費$20、広告Silver/Gold/Legendが$3/$8/$20 per日、USDのみ・Stripe Taxによる税込)とUltrasの状態ごとの特典が、[料金とプラン](../../../docs/GUIDES/service/overview/002-pricing-and-plans.md)に定義済みである。
- tech-stack.mdで、Stripe Node SDK(fetchクライアント)、Checkout Sessions(`ui_mode: 'elements'`)、Refunds、Customer Portal、Webhooks、Payment Elementの採用が決まっている。
- `docs/GUIDES/service/features`に決済実装方針の文書が無い。

## Desired Outcome

- ユーザーごとのStripe Customerがあり、退会時に削除される(ユーザーライフサイクルイベントへのハンドラ登録)。
- Checkout Sessions(`ui_mode: 'elements'`)とPayment Elementによる決済画面と最終確認画面がある。即時に確定する決済手段のみ、金額は日数×単価、Stripe Taxによる税込、USDである(FR-PYMNT-001〜004、I18N-003)。
- 購入種別(トーナメント参加・広告・サブスクリプション)と、購入が確定した時のフルフィルメントのポートがあり、後続specが実装する。
- eventのWebhookが、署名検証・冪等性・状態の巻き戻り防止(DR-010・011)を満たしつつ、決済・返金・チャージバックを決済履歴へ反映する。権利の自動変更はしない。`return_url`でも同じ反映処理を呼ぶ。
- 返金処理(Queues経由の自動返金を含む)と、決済期限から組み合わせ決定までの突合(Cron)の共通部品があり、トーナメントのspecが使える(FR-PYMNT-005〜012)。
- 設定ページに決済履歴があり、決済画面から特定商取引法の表記(法的通知)へ到達できる(LR-007〜009)。
- `docs/GUIDES/tech/external`(Stripe)と`operations`(決済データ操作)に記載があり、`docs/GUIDES/service/features`に決済実装方針を作成済みである。

## Approach

Stripeとの通信と決済状態の管理をこのspecに集約し、「何を買ったか」に応じた権利付与はフルフィルメントのポートで各specへ委ねる。Webhookとreturn_urlの両方から同じ冪等な反映処理を呼び、到着順序に依存しない設計にする。

## Scope

- **In**:
  - 4.26(FR-PYMNT-001〜012)
  - SW-016、LR-007〜009、DR-010・011
  - Stripe Customerの管理と退会時の削除
  - 決済画面・最終確認画面・決済履歴
  - Webhookの受付(event)、返金と突合の共通部品
  - 上記のテストとドキュメント
- **Out**:
  - トーナメント参加資格の判定(tournament-week・tournament-year)
  - 広告の申込(sponsorship)
  - サブスクリプションの状態管理とCustomer Portal(ultras-subscription)
  - チャージバックのrepresentment(手動対応、スコープ外)

## Boundary Candidates

- Stripeクライアントの設定とAPIバージョン管理
- 決済セッションの作成と決済画面
- Webhookの検証と冪等な反映
- 返金・突合の共通処理
- 決済履歴

## Out of Boundary

- 権利の付与と剥奪
- 料金単価の業務判断

## Upstream / Downstream

- **Upstream**: identity-auth、legal-pages
- **Downstream**: ultras-subscription、tournament-week、tournament-year、sponsorship、ugc-moderation(統計の収益)、data-export(決済履歴)

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: ultras-subscription(Stripeのサブスクリプション)

## Constraints

- Stripe Payment Elementを使うには、Checkout Sessions APIで`ui_mode: 'elements'`を指定する(`stripe:stripe-best-practices`スキルの`ui_mode: 'custom'`は古い情報)
- UI上の決済期限を実際の期限より前にする理由は[料金とプラン](../../../docs/GUIDES/service/overview/002-pricing-and-plans.md)にある
- 実現性チェック(2026-10-03)の指摘:
  - stripe-node v23.0.0(2026-10-01)はAPI版`2026-09-30.endive`に固定され、Checkout Sessionsから`payment_method_types`が削除された
  - `ui_mode: 'elements'`はAPI版`2026-03-25.dahlia`以降でのみ使える
  - フロント側でも`CheckoutProvider`が`CheckoutElementsProvider`に、`initCheckout`が`initCheckoutElementsSdk`に改名された
  - 対策として、SDKのメジャー版と`apiVersion`を明示的に固定し、Webhook endpointの`api_version`もそれに合わせる
- FR-RLMIT-008(全WorkerのIP単位制限)がWebhookに及ぶ点は、backend-platformの論点の結論に従う
