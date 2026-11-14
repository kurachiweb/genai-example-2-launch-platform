# Brief: launch-readiness

## Problem

全機能を実装した後、本番環境へ一括でリリースする前に、次の非機能要件を満たしているかをサービス全体で検証する必要がある。

- 性能: FCP 1.6秒、GraphQLのp95 300ms
- 可用性: 99.9%、外部サービス障害時の縮退運転、RPO 24時間・RTO 4時間
- アクセシビリティ: WCAG 2.2 AA
- セキュリティと監視

また障害対応・ロールバック・決済データ操作の手順が無いままでは、本番運用を始められない。

## Current State

- 監視(Web Analytics・FlareWarden・Sentryのアラート)の設定と、運用手順の文書は無い。
- 各specは個別のE2Eテストを持つが、サービス全体の主要な利用者フローを通しで検証する回帰テストは無い。
- infra-deliveryで、staging・prodへのデプロイの仕組みができている前提である。

## Desired Outcome

- 性能要件(NFR-PERF)の計測結果があり、目標を満たしている。満たさない箇所は改善済みである。
- 可用性要件(NFR-AVAIL)を確認済みである。
  - 外部サービス(Rekognition・GCP NL・Stripe・メール・HIBP・DISIFY)の障害を想定した縮退運転を確認している
  - 無停止デプロイとロールバックの手順を確認している
  - D1 Time Travelによる復旧手順の演習を済ませている
- 監視が設定済みである(NFR-OBLOG-001〜004)。
  - Web Analytics
  - FlareWardenによる死活監視と外部ステータスページ
  - Sentryのアラート
  - ログの保持期間とPIIマスキングの確認
- アクセシビリティ(UI-003)とセキュリティ(NFR-SECUR全般、WAFルール、セキュリティヘッダー)の監査を済ませ、指摘を解消済みである。
- 主要な利用者フローをPlaywrightで通しで検証する回帰テストがある。登録→プロダクト登録→予選→ディレクトリ掲載→トーナメント参加→決済、および管理者による措置を含む。
- 運用ドキュメントがある。
  - `docs/GUIDES/tech/operations`: 障害対応・ロールバック・決済データ操作(決済データ操作の`operations/004`はpaymentsが作成済みで、ultras-subscriptionが定期課金の節を追記済みのため、本specは本番の手順を追記するだけにする)
  - `docs/GUIDES/tech/security`: システム監視と対応方針
- 本番環境の準備チェックリストがある。Infisicalのprodシークレット、Stripeの本番キーとWebhook、メール送信ドメイン、DNS、法務文書の本文投入、最初の最上位管理者の作成を含む。
  - Stripe: Infisicalのprodへ`STRIPE_API_KEY`(api・event)・`STRIPE_WEBHOOK_SECRET`(event)を登録し、clientの`STRIPE_PUBLISHABLE_KEY`の仮の値(`pk_live_`で始まる)をライブモードの公開キーへ置き換える。ライブモードのWebhook endpoint・価格・Customer Portal・税・決済手段の設定はpaymentsの`operations/004`の手順に従う
  - Ultras: prodでStripeの価格・Portal・税の設定を確かめた後に、最上位管理者が管理画面の設定ページ(`/settings`)で有料プランへの導線の機能フラグをオンにする。初期値はオフ(ultras-subscription仮2)で、確かめる前に加入を受け付けないため、この順序をチェックリストに入れる
  - 最初の最上位管理者: admin-foundationの招待の発行コマンドを開発者が`--target prod`で実行する(AIエージェントはリモートのD1へ書き込めない)
  - 疎通確認の購入種別(`PAYMENTS_SMOKE_ENABLED`)がprodで`false`であることを確かめる
- prodブランチへのPR(人間の承認が必要)によって本番リリースできる状態である。

## Approach

各specの完了後に、サービス全体を横断する検証と運用準備だけをこのspecで行う。個別機能の不具合が見つかった場合は、原則として担当specの範囲で修正する。修正の記録は、このspecのタスクから参照する形にする。

## Scope

- **In**:
  - 非機能要件(6章)のサービス全体での検証と改善
  - 監視・アラートの設定
  - 全体のE2E回帰テスト
  - アクセシビリティとセキュリティの監査
  - 運用ドキュメント
  - 本番準備のチェックリスト
- **Out**:
  - 新機能の追加
  - prod環境への実デプロイの実行(人間が承認して行う)
  - 法務文書の本文起草

## Boundary Candidates

- 性能・可用性の検証
- 監視とアラート
- 全体回帰テスト
- 監査(アクセシビリティ・セキュリティ)
- 運用手順と本番準備

## Out of Boundary

- 機能要件の実装
- インフラ資源の新規定義(infra-deliveryの構成へ追記する場合を除く)

## Upstream / Downstream

- **Upstream**: infra-delivery、help-center、data-export(依存関係をたどると全spec)
- **Downstream**: 本番リリース

## Existing Spec Touchpoints

- **Extends**: infra-delivery(監視資源の追記)
- **Adjacent**: 全spec(監査の指摘による修正)

## Constraints

- AIエージェントによるprod環境へのデプロイは禁止されており、prodへのマージには人間の承認が必須
- Cloudflare系MCPサーバー(cloudflare-observabilityなど)を検証に使う場合は、事前に開発者が認証する必要がある
- 監視系のサービス(FlareWarden・Sentry)のアカウント設定は、開発者が行う必要がある
- 4:21のジョブとユーザーライフサイクルの波及処理の`order`は、roadmapの帯の割り当ての表で本specに割り当てた2200番台(2200〜2299)を使う。波及処理の各ドメインの範囲は0〜9999で、10000以上はidentity-auth専用である。帯の値は同じ時刻・同じ種類の中で上流のspecの後に動くため、上流の値より前に動く必要がある処理があれば設計時に開発者へ確認する
