# Design Document

## Overview

**Purpose**: 有料プランUltrasの加入・加入状態の管理・特典の判定を1か所に集める。paymentsの購入種別の口(`ultras`)で加入を有効にし、定期課金の状態の受け取り口(`SubscriptionEventSink`)でStripe側の変化を加入状態に取り込み、加入ごとの「特典の継続期間」(開始時刻から特典の終了時刻までの区間)を保存する。特典を消費する機能は、Stripeの状態を見ずに、この区間に対する「指定時点・指定期間で特典を受けられるか」の判定(`UltrasEntitlements`)だけに依存する。

**Users**: 投稿者は料金ページ(`/pricing`)で価格と特典を確かめて加入し、プラン管理画面(`/settings/plan`)で状態を確認し、Customer Portalで支払い方法の更新・解約・解約の取り消しを行う。最上位管理者は管理画面の設定ページ(`/settings`)で有料プランへの導線の機能フラグを切り替える。後続spec(user-profile-social・product-launch・tournament-week・tournament-year)の開発者は特典の判定と加入が有効になった知らせのハンドラを使い、sponsorship・tournament-year・notificationsは料金ページと管理画面の設定ページに区画を登録する。

**Impact**: `apps/backend-lib`にUltrasの共有部品(`core/ultras`はapplication層と後続specが受け取る契約・識別子と純粋な規則、`workers/ultras`はD1の実装とpaymentsの口の実装)を新設し、apiとeventの両方に同じ束縛(`createUltrasPlatformModule(appName)`)を入れる。paymentsの購入種別の登録箇所に`ultras`を加え、paymentsが仮5により提供する「確定の後の呼び出し」と「解約の予定時刻」を使う(paymentsのU1)。apiにスキーマモジュール・Portalの回数制限・日次の確認のジョブを、eventに加入が有効になった知らせの処理・退会と停止の解約・物理削除の波及処理・メールのテンプレートを、clientに料金ページとプラン管理画面を、adminに設定ページとフラグの区画を足す。D1に4テーブルを足す。新しいシークレットは無い。

### Goals

- FR-PPLAN-001〜013・FR-ADMCF-022が動作し、加入→支払いの失敗→回復、解約の予約→取り消し、解約の予約→末日の終了、停止→期間末の解約、退会→即時の解約のどの経路でも、加入状態と特典の判定が料金とプランの表(と要件フェーズの決定Q1〜Q8)に一致する。
- 特典の判定が、通知の到着順・再送・過去の時点の指定にかかわらず同じ結果を返す。
- 加入が有効になった知らせが、加入1件につき確実に1回、登録された処理へ届く。
- 本specが追加・変更したコードの単体テスト・Workers統合テスト・ブラウザテストがカバレッジ80%を満たす。

### Non-Goals

- Stripeとの通信・決済画面・最終確認画面・決済後のランディング・決済履歴・購入確認メールの実装(payments)。
- 参加費の免除の適用・参加資格の付与・未完了の参加費の決済セッションの失効(tournament-week・tournament-year)、再ローンチの間隔の適用(product-launch)、加入表示の描画(user-profile-social)。
- 料金ページのスポンサー広告の区画(sponsorship)、管理画面の設定ページの決勝日(tournament-year)・送信者情報(notifications)の区画。
- 解約の受付以外の自動のメール(特典の終了・更新の予告)、Stripeの顧客向けメール(Q8)。
- 要件定義書の改訂(roadmapのOut。必要な改訂は[research.md](research.md)の「要件定義書の改訂が必要な箇所」に記録した)。(2026-10-25に要件定義書へ適用済み)

## Boundary Commitments

### This Spec Owns

- Ultrasのデータ: `ultras_subscriptions`(加入と特典の継続期間)・`ultras_activations`(加入が有効になった知らせ)・`ultras_notices`(メールの依頼)・`ultras_settings`(機能フラグ)の4テーブル(`apps/db/schema/ultras/`)。
- 加入状態の導出規則と特典の継続期間の規則(`backend-lib/core/ultras`)、特典の判定`UltrasEntitlements`・データエクスポートの照会`UltrasPlanExport`・機能フラグの照会`UltrasPromotionFlagReader`・知らせの送り出し`ActivationDispatcher`・メールの依頼`UltrasNotifier`・各ストアの文を返さない操作(契約は`backend-lib/core/ultras/ports.ts`、識別子`ULTRAS_TYPES`は`core/ultras/identifiers.ts`、実装は`backend-lib/workers/ultras`)。各ストアの文を返す操作(`SubscriptionStatements`・`ActivationStatements`・`NoticeStatements`)は`workers/ultras/statement-contracts.ts`に置き、`workers`と各アプリの`infrastructure`だけが使う。
- paymentsの口の実装(`workers/ultras`): 購入種別`ultras`の`PurchaseOfferPolicy`(`core/payments`の契約)・`PurchaseFulfillment`と、`SubscriptionEventSink`(`ultras-subscription.plan-state`。いずれも`workers/payments/fulfillment-contract.ts`の契約)。
- application層のポートとinfrastructure層の実装: apiの回数制限`PortalSessionLimits`(実装`CounterPortalSessionLimits`)、eventの物理削除の書き込みの単位`UltrasAccountDataEraser`(実装`D1UltrasAccountDataEraser`)。
- 加入が有効になった知らせの契約と登録箇所(`UltrasActivationHandlerRegistration`・`ULTRAS_ACTIVATION_HANDLERS`)と、その実行(メッセージ種別`ultras.run-activation-handlers`)。
- GraphQLのスキーマモジュール`ultras`(利用者側の`ultrasOffer`・`viewerUltras`・`startUltrasCheckout`・`createUltrasPortalSession`、管理者側の`ultrasPromotionSetting`・`updateUltrasPromotionSetting`)。
- 利用者側の`/pricing`(ページの枠・区画の登録箇所`PRICING_SECTIONS`・Ultrasの区画)と`/settings/plan`、導線の表示の可否の部品`UltrasPromotionGate`。管理者側の`/settings`(ページの枠・区画の登録箇所`ADMIN_SETTINGS_SECTIONS`・フラグの区画)とメニュー項目。
- メールの種別`ultras.payment-failed`・`ultras.cancellation-accepted`(仮1)とテンプレート、監査ログの操作種別`ultras-promotion.update`。
- 定期実行のジョブ`ultras-subscription.pending-dispatch-sweep`(4:21、`order` 500)、ユーザーライフサイクルの波及処理`ultras-subscription.subscription-cancellation`(`withdrawn`・`suspended`、`order` 500)・`ultras-subscription.subscription-erasure`(`purge_due`、`order` 500)。
- 技術ドキュメント`backend/010`・`external/008`の新規作成、`operations/004`への定期課金の節の追記、サービス仕様の`features/005`の新規作成と関連するサービス仕様の追記。

### Out of Boundary

- Stripeとの通信と決済の状態(payments)。本specは`StripeGateway`の定期課金の操作(`cancelSubscription`・`createPortalSession`)と`CustomerDirectory`・`CheckoutStarter`・`PriceCatalog`を呼ぶだけで、Stripeの型やpaymentsのテーブルを直接扱わない。
- 古い通知の破棄(DR-016)と冪等性(DR-015)、権利を付与できない購入の定期課金の解約と全額返金(payments)。
- 加入が有効になった知らせを受けた後の処理(未完了の参加費の決済セッションの失効・参加資格の付与)の中身(tournament-week・tournament-year)。
- 特典の判定の結果の使い方(加入表示・再ローンチの間隔・参加費の免除)と、トーナメント参加費の画面などに出す導線の描画(各後続spec。表示の可否は`UltrasPromotionGate`・`UltrasPromotionFlagReader`で決める)。
- 停止・停止の解除・退会の操作そのもの(ugc-moderation・identity-auth)。
- 法的通知の本文の更新(開発者が管理画面で行う)と、Stripeのダッシュボードの設定作業そのもの(開発者が`operations/004`に沿って行う)。

### Allowed Dependencies

- backend-platform: `AppModule`・`PLATFORM_TYPES`(`Database`・`Clock`・`IdGenerator`・`KeyedHasher`・`MessagePublisher`・`RateLimitCounterClient`)・`ScheduledJobDefinition`・`defineMessageContract`・`MessageHandlerRegistration`・`RetryPolicy`・`hashRateLimitKey`・`AppError`・`getAppLogger`・業務時刻の関数(`toBusinessDateTime`・`fromBusinessDateTime`)・`ulidPrimaryKey`・`timestamps`。形を変えない。api・eventのapplication層は`**/lib/workers/**`を型も含めて読み込めず、DBの接続・SQLの文・一括の書き込みを扱わない(`config/eslint/backend-layers.ts`、`docs/GUIDES/tech/backend/002`)。そのため`MessagePublisher`は`workers/ultras`の`ActivationDispatcher`の実装だけが使い、`RateLimitCounterClient`はinfrastructure層の`CounterPortalSessionLimits`だけが使う(`backend/003`の「厳密カウンタを使うクラスはインフラ層に置く」)。
- api-gateway: `defineSchemaModule`・`GraphQLContext`・`withValidatedArgs`・`DateTime`のスカラー。形を変えない。
- identity-auth: `AccountGuard`(`currentUser`・`requireWritableUser`・`requireVerifiedUser`)・`UserLifecycleAsyncRegistration`・`USER_LIFECYCLE_ASYNC_HANDLERS`・`SETTINGS_NAV_ITEMS`・`SettingsShell`・`_authenticated`のレイアウト・`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`、契約と識別子は`apps/backend-lib/core/identity`、D1の実装は`apps/backend-lib/workers/identity`、api・eventの両方にidentity-authが束縛する。メールの宛先と宛名の照会に使う)。`users`テーブルは`id`(外部キーの参照先)だけに使い、列を直接読まず、書き込まない。
- admin-foundation: `requireAdmin`(presentation層。解決関数だけが呼ぶ)・`AdminDirectory`・`AuditLogRecorder`・`buildAuditLogStatements`と`isAuditGuardRejection`(apiのinfrastructure層の`infrastructure/admin/audit-log-statements.ts`。`guard: { kind: 'condition' }`で版の照合に使う)・`defineAuditAction`・`AUDIT_ACTIONS`・`ADMIN_NAV_ITEMS`・`RoleGate`・`useAdminRole`・`AdminPageHeader`・`ConfirmActionDialog`・E2Eの補助`e2e/support/admin-bootstrap.ts`(指定したロールの管理者としてのログイン)と`e2e/support/local-d1.ts`(`executeLocalD1`・`sqlStringLiteral`。E2Eでの機能フラグの設定)。
- dev-tooling: ルートの`playwright.config.ts`と`e2e/support/playwright-config.ts`の`createPlaywrightConfig`(プロジェクトの組み立て)、テスト方針の文書`docs/GUIDES/tech/testing/001-test-strategy.md`。タスク10.1で、`createPlaywrightConfig`に直列の組を受け取る汎用の引数と記述を加え、Ultrasの2ファイルの組はルートの`playwright.config.ts`から渡す(上流への影響)。E2Eの確認済みの利用者の作成は`e2e/client/auth/account-steps.ts`(`createTestAccount`・`registerAccount`・`verifyEmailFromMail`)、決済の画面の操作はpaymentsの`e2e/client/checkout-steps.ts`の手順を使う。
- payments: `core/payments`の`PurchaseOfferPolicy`・`PurchaseOffer`・`PurchaseOfferRequest`・`FulfillablePurchase`・`SubscriptionChange`・`StripeGateway`の`cancelSubscription`・`createPortalSession`・`CustomerDirectory`・`PriceCatalog`・`StripeUnavailableError`・`PAYMENTS_TYPES`、`workers/payments/fulfillment-contract.ts`の`PurchaseKindRegistration`・`PurchaseFulfillment`・`FulfillmentPlan`・`SubscriptionEventSink`・`SubscriptionEventSinkRegistration`(`workers/ultras`だけが読み込む)、`workers/payments`の`PURCHASE_KIND_REGISTRATIONS`・`SUBSCRIPTION_EVENT_SINKS`、apiのアプリケーション層の`CheckoutStarter`(`API_PAYMENTS_TYPES.CheckoutStarter`、入力`CheckoutStartInput`。回数制限の消費は`describe`の前のため、`ultras_already_subscribed`などの拒否でも1回分を数える)、GraphQLの`Money`・`CheckoutStart`、frontend-libの`MoneyText`(`components/payments/money-text.tsx`。最小通貨単位の`amount`だけを受け、通貨はUSD固定)、E2Eの決済の手順`e2e/client/checkout-steps.ts`。仮5の追加(`afterCommit`・`cancelAt`)と仮3の追加(購入確認メールの追加事項)は、paymentsの要件・設計・タスクに反映済み(paymentsのU1・U2、2026-10-23に開発者が承認)で、paymentsが実装を終えている。本specはpaymentsのコードを変更しない。
- email-delivery: `defineEmailKind`・`EMAIL_KINDS`・`EmailSender`・`EMAIL_TYPES`・`defineEmailTemplate`・`EMAIL_TEMPLATES`・`formatUtcDateTime`。
- frontend-platform: `executeGraphQL`・`graphqlQueryOptions`・`GraphQLClientError`・`errorMessageOf`・`buildPageHead`(clientは包みの`buildSitePageHead`、adminは`buildAdminPageHead`を使う)・`DateTime`・`EmptyState`・`ErrorState`・`UnavailableNotice`・`LoadingSkeleton`・`notify`・shadcn/uiの部品・`runAxe`、adminの`ADMIN_PROFILE`(`contactAvailable`)・clientの`CLIENT_PROFILE`、GraphQLの操作の追加手順(`src/graphql/operations/**/*.graphql`・操作名の接頭辞`Client`・`Admin`・`src/graphql/generated/graphql.ts`の生成物)。本specは`PageHeadInput`に`description`を加え、inquiry-chatの`RecoverableSlot`をfrontend-libへ移す(上流への影響)。
- npmパッケージ: 新規は無い。
- 後続specは本specの`core/ultras`の公開の契約と識別子(`UltrasEntitlements`・`UltrasPromotionFlagReader`・`UltrasPlanExport`・`UltrasActivationHandlerRegistration`・`ULTRAS_TYPES`。D1の実装は`workers/ultras`)と、clientの`UltrasPromotionGate`・管理画面の`ADMIN_SETTINGS_SECTIONS`・料金ページの`PRICING_SECTIONS`だけに依存し、テーブルを直接読み書きしない。data-exportも本specのテーブルを直接読まず、本specが所有するエクスポート部品`UltrasPlanExport`を呼ぶ。

### Revalidation Triggers

- `UltrasEntitlements`の形と判定の規則(特典の継続期間の両端の含め方、特典の終了時刻の日の境界)(user-profile-social・product-launch・tournament-week・tournament-year)。
- `UltrasActivation`・`UltrasActivationHandlerRegistration`の形・配送保証(少なくとも1回)・`order`の範囲(tournament-week・tournament-year)。
- `UltrasPromotionFlagReader`・`UltrasPromotionGate`の形と、フラグの意味(未加入者への導線と新規加入)(tournament-week・tournament-year・product-launchなど導線を出す全spec)。
- `PRICING_SECTIONS`・`ADMIN_SETTINGS_SECTIONS`の形(`id`の形・`title`・`component`)と`order`、区画ごとの`RecoverableSlot`による失敗の閉じ込め(sponsorship・tournament-year・notifications)。
- `UltrasPlanExport`の形と`plan.status`の値(data-export。データエクスポートの文書と一致させる)。
- paymentsの`SubscriptionChange`・`SubscriptionEventSink`・`PurchaseFulfillment`の形と置き場所(`core/payments`・`workers/payments/fulfillment-contract.ts`)、または古い通知を捨てる規則を変えたら、本specを確かめ直す(仮5で本specが足す`afterCommit`・`cancelAt`を含む)。
- `core/ultras`の契約(`UltrasEntitlements`・`UltrasPromotionFlagReader`・`UltrasPlanExport`・`ActivationDispatcher`・`UltrasNotifier`・各ストアの文を返さない操作)と`ULTRAS_TYPES`の置き場所。application層が`**/lib/workers/**`を読み込めない規則(backend-platform)が変わっても、置き場所を`workers`へ戻さない(後続specとapi・eventのapplication層が読み込むため)。
- identity-authのユーザーライフサイクルの`order`の範囲・`purge_due`の順序・`UserContactDirectory`の形(`findContact`が退会済み・物理削除済みの利用者で`undefined`を返す規則)、admin-foundationの`requireAdmin`・`AuditLogRecorder`の形を変えたら、本specを確かめ直す。
- 4:21の`order` 500、波及処理の`order` 500(同じ時刻・種類に登録する全spec)。波及処理の`order`は、各specが4:21のジョブの`order`と同じ百の位の帯を使う(spec横断レビュー、2026-10-23)。本specは500番台を使い、identity-auth(100番台と10000以上)・admin-foundation(200番台)・inquiry-chat(300番台)・payments(400番台)・media-pipeline(800番台)・email-delivery(900)・content-processing(2300)の帯と重ねない。帯の割り当てが変わったら、本specを確かめ直す。
- dev-toolingの`createPlaywrightConfig`の形(本specが加える直列の組の引数を含む)・プロジェクトの名前の規則(`<対象>`・`<対象>-reachability`・`<組の名前>-<順>-<対象>`)、paymentsのE2Eの決済の手順(`checkout-steps.ts`)と縮退の検出(`payments_unavailable`)、admin-foundationの`executeLocalD1`・`sqlStringLiteral`の形を変えたら、本specのE2Eとその設定を確かめ直す。

### 上流への影響

| 上流spec                       | 変更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 影響と再検証                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dev-tooling                    | `e2e/support/playwright-config.ts`の`createPlaywrightConfig`に、省略可能な4つ目の引数`serialGroups: readonly E2ESerialGroup[]`(既定は空)を加える。`E2ESerialGroup`は`{ name: string; steps: readonly { target: E2ETargetName; testMatch: string }[] }`で、手順ごとに、そのファイルを対象のテストのプロジェクトから外し(`testIgnore`)、`<組の名前>-<順>-<対象>`のプロジェクト(対象の`testDir`・`baseURL`、`dependencies`は対象の到達確認と1つ前の手順のプロジェクト。並列数の上限のある対象(`PROJECT_WORKER_LIMITS`、現在は`admin`)では、同じ対象のテストを並行させない上限の意味を守るため、その対象のテストのプロジェクトにも依存させ、組だけを指定して実行してもその対象のテストが先に動く)を作る。有効でない対象の手順は作らず、依存を次の手順へ繋ぐ。共有の補助に固有のパスを置かず、Ultrasの組(client側の`ultras.e2e.test.ts`の後にadmin側の`ultras-promotion.e2e.test.ts`)はルートの`playwright.config.ts`から渡す。`playwright-config.unit.test.ts`に組の有無・外し方・依存・対象が無効な手順のテストを足す。`docs/GUIDES/tech/testing/001-test-strategy.md`のE2Eの節に「共有の行を書き換えるE2Eは直列の組で依存を繋ぐ」旨と、`--project <対象名>`では組のファイルが外れ、組は`--project '<組の名前>-*'`で実行する旨を加える | 引数を省くと今のプロジェクトの並びと中身のままになり、`playwright-config.unit.test.ts`の既存のテスト(プロジェクトの並びの完全一致を含む)は変えずに通る。ワーカーの数・既存の対象ごとのプロジェクトと到達確認のプロジェクトの名前と依存は変えず、他のspecのE2Eの並行実行に影響させない。Playwrightの一覧の表示で確かめる。文書はプロジェクト名と固有の値を含めずに書く。dev-toolingの`design.md`のE2EConfigの契約を新しい形に合わせて直す |
| frontend-platform              | `apps/frontend-lib/start/page-head.ts`の`PageHeadInput`に省略可能な`description`を加え、指定したときだけ`<meta name="description">`を出す(と`page-head.unit.test.ts`)。clientの包み`buildSitePageHead`(`apps/client/src/head/page-heads.ts`)が`description`を渡す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 既存のページは`description`を渡さないため出力が変わらない。`page-head.unit.test.ts`の既存のテストが通ることと、`description`を渡したときと渡さないときのテストで確かめる。frontend-platformの`design.md`のページのheadの契約を新しい形に合わせて直す(タスク7.3)                                                                                                                                                                          |
| inquiry-chat・admin-foundation | inquiry-chatが`apps/admin/src/components/layout/recoverable-slot.tsx`に作った区画ごとのエラーの境界`RecoverableSlot`を、`apps/frontend-lib/components/state/recoverable-slot.tsx`へ移す。adminの`ADMIN_PROFILE`を読まず、問い合わせを促す文を出すかを`contactAvailable`(と`contactHref`)のpropsで受け取る形にし、adminの3つの利用箇所(`dashboard-grid.tsx`・`category-sections-view.tsx`・`inquiry-detail-actions-view.tsx`)は`ADMIN_PROFILE.contactAvailable`を渡す。`docs/GUIDES/tech/frontend/009-admin-console-shell.md`(管理画面の枠の部品の一覧)と`005-shared-components.md`(部品の一覧と使い方)の記載を移した先に合わせる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | adminのダッシュボード・カテゴリマスタ・問い合わせの詳細の表示と振る舞いは変えない。既存のブラウザテスト(`dashboard`・`categories`・`inquiry`)が通ることで確かめる。frontend-libの部品の規約どおり、Storybookのストーリーとブラウザテストを足す(タスク7.3)                                                                                                                                                                                |

- 後続specへの申し送り: UltrasのE2Eは機能フラグの行を書き換えるため、フラグの値で表示が変わる画面を確かめる後続specのE2Eは、ルートの`playwright.config.ts`が渡すUltrasの直列の組に手順として加えるか、フラグの値で結果が変わる部分を確かめない(roadmapのShared seams「プラン判定」、product-launch・tournament-week・tournament-yearのbrief)。

## Architecture

### Existing Architecture Analysis

- 上流の13specは実装を終えている(2026-11-06時点。paymentsはsandboxでの手動の検証の2件、infra-deliveryはstagingの識別子の反映の1件が残る)。本specが前提にする上流の契約が実在することは、research.mdの「実装前のギャップ分析」で確かめた。
- paymentsの反映は、api(`return_url`・突合・日次の確認)とevent(Webhook)の両方で動き、購入種別の口と定期課金の受け取り口の実装を、反映と同じ一括の書き込みに含める。口の実装は`backend-lib/workers/<ドメイン>`に置き、D1の文だけを返す(副作用を持たない)。D1の文を返す口の契約はpaymentsの`workers/payments/fulfillment-contract.ts`、購入の可否と内容の契約は`core/payments`にある。
- api・eventのapplication層は`**/lib/workers/**`を型も含めて読み込めないため、application層と後続specが受け取る契約と識別子は`backend-lib/core/<ドメイン>`に置き、`workers/<ドメイン>`には実装と束縛と、D1の文を返す契約だけを置く(`docs/GUIDES/tech/backend/002`の「依存方向と静的解析」)。
- paymentsの口には確定の後に呼ばれる場所が無く、口の実装はメールやメッセージを送れない。本specは加入が有効になった知らせとメールを依頼待ちの行として一括の書き込みに含め、paymentsの確定の後の呼び出し(仮5、paymentsのU1)と4:21の日次の確認で送り出す。
- Cron Triggersはapiだけにあり、ジョブは業務時刻の時・分で毎日動く。厳密カウンタはapiだけに束縛される。Queuesのconsumerはeventにある。
- API版`2026-10-28.endive`の新しい定期課金は柔軟な請求モードで作られ、課金期間の末日の解約は`cancel_at`の時刻で表される(`cancel_at_period_end`は偽のまま)。paymentsの`SubscriptionChange`に`cancelAt`を足すことを、仮5としてpaymentsへ反映した(paymentsのU1、research.md)。

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph ClientWorker[client worker]
        PricingRoute[pricing page]
        PlanRoute[settings plan page]
        Gate[ultras promotion gate]
    end
    subgraph AdminWorker[admin worker]
        SettingsRoute[admin settings page]
        FlagSection[promotion flag section]
    end
    subgraph ApiWorker[api worker]
        UltrasModule[ultras graphql module]
        PortalStarter[portal session starter]
        SettingService[promotion setting service]
        SweepJob[pending dispatch sweep job]
    end
    subgraph EventWorker[event worker]
        ActivationRunner[activation handlers runner]
        CancelHandler[subscription cancellation handler]
        EraseHandler[subscription erasure handler]
        Templates[ultras email templates]
    end
    subgraph BackendLib[backend lib ultras]
        Offer[ultras offer policy]
        Fulfillment[ultras fulfillment]
        Sink[plan state sink]
        Entitlements[ultras entitlements]
        Dispatcher[activation dispatcher]
        Notifier[ultras notifier]
        Stores[ultras stores]
    end
    Payments[payments reflector and gateway]
    Downstream[downstream activation handlers]
    PricingRoute --> UltrasModule
    PlanRoute --> UltrasModule
    Gate --> UltrasModule
    FlagSection --> UltrasModule
    UltrasModule --> PortalStarter
    UltrasModule --> SettingService
    UltrasModule --> Entitlements
    PortalStarter --> Payments
    Payments --> Offer
    Payments --> Fulfillment
    Payments --> Sink
    Fulfillment --> Stores
    Sink --> Stores
    Fulfillment --> Dispatcher
    Sink --> Notifier
    Dispatcher --> ActivationRunner
    ActivationRunner --> Downstream
    SweepJob --> Dispatcher
    SweepJob --> Notifier
    CancelHandler --> Payments
    Entitlements --> Stores
```

**Architecture Integration**:

- Selected pattern: paymentsの口(購入種別・定期課金の受け取り)を実装し、加入状態を「特典の継続期間」という区間で保存する。判定は区間に対する問い合わせだけで行う。外部への副作用(知らせ・メール)は依頼待ちの行を一括の書き込みに含め、確定の後と日次の確認で送り出す(paymentsの返金とメールの依頼と同じ方式)。
- Domain/feature boundaries: Stripeとの通信と決済の状態はpayments、加入状態と特典の判定は本spec、特典の使い道は後続spec。
- Existing patterns preserved: 契約と識別子を`backend-lib/core/<ドメイン>`、実装と共有の束縛を`backend-lib/workers/<ドメイン>`に置く配置(paymentsの`core/payments`・identity-authの`core/identity`と同じ)、`<spec名>.<名詞句>`のジョブ・波及処理の名前と`<ドメイン>.<動詞句>`のメッセージ種別・`<ドメイン>.<名詞句>`のメール種別、版の検査付きの一括の書き込み(`db/005`)、登録箇所への追記による区画の追加(`SETTINGS_NAV_ITEMS`・`ADMIN_NAV_ITEMS`・`DASHBOARD_CARDS`と同じ形)。
- New components rationale: 判定と口の実装が2つのWorkerにまたがるため`backend-lib`に置く。料金ページと管理画面の設定ページは複数のspecが区画を載せるため、枠と登録箇所を先に作る(仮6)。
- Steering compliance: Inversifyの`@inject`の明示、D1の制約(`db.batch()`・バインド変数100個以内)、業務時刻(UTC-08:00)、Infisicalでのシークレット管理(新規は無し)、800行以内のファイル、1ファイル1コンポーネント。

**Dependency direction**: `apps/db/schema/ultras` → `apps/common-lib/ultras` → `backend-lib/core/ultras`(純粋な規則・application層と後続specが受け取る契約・識別子。`Database`・`BatchItem`・`workers`・`apps/db`を読み込まない) → `backend-lib/workers/ultras`(D1の実装とpaymentsの口の実装、D1の文を返す契約) → 各アプリの`src`(`application` → `infrastructure`・`presentation` → `composition`)。api・eventの`application/ultras`は`core/ultras`・`core/payments`・`core/identity`の契約と識別子だけを読み込み、`**/lib/workers/**`を型も含めて読み込まない。`backend-lib/workers/ultras`は`core/payments`の契約と`workers/payments/fulfillment-contract.ts`の契約を読み込み、`backend-lib/workers/payments`の登録箇所(`purchase-kind-registrations.ts`)からだけ参照される。D1の文を返す`workers/ultras/statement-contracts.ts`を使うのは`workers/ultras`とeventの`infrastructure/ultras/d1-ultras-account-data-eraser.ts`だけである。clientとadminは`common-lib/ultras`とGraphQLの操作だけを読み込む。

### Technology Stack

| Layer     | Choice / Version                                                                    | Role in Feature                                  | Notes                                               |
| --------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| Frontend  | TanStack Start・TanStack Query・shadcn/ui(frontend-platform)、`MoneyText`(payments) | 料金ページ・プラン管理画面・管理画面の設定ページ | 既存                                                |
| Backend   | Hono・Inversify・GraphQL Yoga(上流)、paymentsの口と`StripeGateway`                  | スキーマモジュール・口の実装・波及処理           | 既存                                                |
| Data      | Cloudflare D1(Drizzle)                                                              | 4テーブル                                        | 新規のマイグレーションと機能フラグの初期行の`_seed` |
| Messaging | Cloudflare Queues(`JOBS_QUEUE`)・Cron Triggers(api)                                 | 知らせの実行・日次の確認                         | 既存のQueue                                         |
| External  | Stripe Billing・Customer Portal(payments経由)                                       | 定期課金・Portal                                 | 環境ごとにダッシュボードで設定(`operations/004`)    |

## File Structure Plan

### Directory Structure

```
apps/
├── db/schema/ultras/                                   # テーブル定義(各ファイルに同名の*.unit.test.ts)
│   ├── ultras-subscriptions.ts                         # 加入・Stripe側の値・特典の継続期間
│   ├── ultras-activations.ts                           # 加入が有効になった知らせの依頼待ち
│   ├── ultras-notices.ts                               # メールの依頼待ち
│   ├── ultras-settings.ts                              # 機能フラグ
│   └── index.ts
├── common-lib/ultras/                                  # 4アプリ共通の定義(各ファイルに同名の*.unit.test.ts)
│   ├── plan-status.ts                                  # ULTRAS_PLAN_STATUSES・表示名・ULTRAS_PRICE_LOOKUP_KEY
│   ├── promotion-flag.ts                               # ULTRAS_PROMOTION_FLAG_KEY・初期値(仮2)
│   ├── checkout-notes.ts                               # 最終確認画面の追加事項の4文・毎月の請求額の表記(en-US固定)・価格が無いときの自動更新の文(ultrasCheckoutNotesOf・ultrasBenefitNotesOf)
│   └── portal-texts.ts                                 # Customer Portalの縮退の理由の文(ULTRAS_PORTAL_UNAVAILABLE_REASON)
├── common-lib/admin/audit-actions/ultras-subscription.ts # ultras-promotion.update
├── backend-lib/
│   ├── core/ultras/                                    # api・eventのapplication層と後続specが読み込む契約と純粋な規則(Bunの単体テスト。Database・BatchItemを読み込まない)
│   │   ├── identifiers.ts                              # ULTRAS_TYPES(Symbol.for('ultras.<名前>')の凍結したオブジェクト、identifiers.unit.test.ts)
│   │   ├── entitlement-rules.ts                        # 特典の終了時刻・加入状態の導出・区間の判定
│   │   ├── subscription-transition.ts                  # 定期課金の変化から加入の更新とメールの依頼を決める
│   │   ├── activation-contract.ts                      # UltrasActivation・登録の型と検証
│   │   ├── activation-message.ts                       # ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE
│   │   └── ports.ts                                    # UltrasEntitlements・各ストアの文を返さない操作・フラグの照会・エクスポート・ActivationDispatcher・UltrasNotifier(型だけ)
│   ├── core/email/kinds/
│   │   └── ultras.ts                                   # 支払いの失敗と解約の受付の確認(仮1)の2種(前例kinds/payments.ts)
│   └── workers/ultras/                                 # 実行環境の部品とD1の文を返す契約(Workers統合テスト)
│       ├── statement-contracts.ts                      # SubscriptionStatements・ActivationStatements・NoticeStatements(型だけ)
│       ├── d1-subscription-store.ts                    # SubscriptionStore・SubscriptionStatementsの実装(加入の読み書き・区間の問い合わせ・物理削除の文)
│       ├── d1-activation-store.ts                      # ActivationStore・ActivationStatementsの実装(知らせの行)
│       ├── d1-notice-store.ts                          # NoticeStore・NoticeStatementsの実装(メールの依頼の行)
│       ├── d1-promotion-flag-reader.ts                 # UltrasPromotionFlagReader
│       ├── ultras-entitlements.ts                      # UltrasEntitlementsの実装
│       ├── ultras-offer-policy.ts                      # PurchaseOfferPolicy(ultras、core/paymentsの契約)
│       ├── ultras-fulfillment.ts                       # PurchaseFulfillment(ultras、workers/payments/fulfillment-contract.tsの契約)
│       ├── plan-state-sink.ts                          # SubscriptionEventSink(workers/payments/fulfillment-contract.tsの契約)
│       ├── activation-dispatcher.ts                    # ActivationDispatcherの実装(知らせの送り出しとdispatched_atの記録)
│       ├── ultras-notifier.ts                          # UltrasNotifierの実装(メールの依頼とrequestedの記録)
│       ├── ultras-plan-export.ts                       # データエクスポート用のplan
│       ├── ultras-registrations.ts                     # paymentsの登録箇所(purchase-kind-registrations.ts)が読む購入種別ultrasと受け取り口ultras-subscription.plan-stateの登録の定義
│       ├── ultras-platform-module.ts                   # createUltrasPlatformModule(appName)(両アプリ共通の束縛)
│       └── testing/ultras-store-fixtures.ts            # Workers統合テストのフィクスチャ(表の初期化・行の組み立て・IDの生成。identity/paymentsの補助の再公開)
├── api/src/
│   ├── application/ultras/                             # Bunの単体テスト(core/ultras・core/paymentsの契約の偽物と偽のポートで)
│   │   ├── ultras-types.ts                             # API_ULTRAS_TYPES(前例payments-types.ts)
│   │   ├── ultras-errors.ts                            # application層のエラーコードと文言(前例payments-errors.ts)
│   │   ├── ultras-plan-reader.ts                       # ultrasOffer・viewerUltras
│   │   ├── ultras-checkout.ts                          # startUltrasCheckout(CheckoutStarterを呼ぶ)
│   │   ├── portal-ports.ts                             # PortalSessionLimits(回数制限のポート、仮4。前例checkout-ports.ts)
│   │   ├── portal-session-starter.ts                   # Portalのセッションの作成
│   │   ├── promotion-setting-ports.ts                  # PromotionSettingReader・PromotionSettingWriter(フラグの読み書きのポート)
│   │   ├── promotion-setting-service.ts                # フラグの照会・変更(監査ログ)
│   │   └── jobs/pending-dispatch-sweep-job.ts          # 4:21の送り出し直しと後始末(order 500)
│   ├── infrastructure/ultras/d1-promotion-setting-writer.ts # 版の検査付きの変更と監査ログの文
│   ├── infrastructure/ultras/counter-portal-session-limits.ts # CounterPortalSessionLimits(利用者単位の回数制限、仮4。Workers統合テスト)
│   ├── presentation/graphql/modules/ultras/            # スキーマモジュール(Workers統合テスト)
│   │   ├── type-defs.ts
│   │   ├── inputs.ts
│   │   ├── errors.ts
│   │   ├── mappers.ts                                  # application層のビューからGraphQLの型への写像(加入状態の小文字→enumの大文字など)
│   │   ├── resolvers.ts
│   │   └── index.ts                                    # ultrasSchemaModule
│   ├── composition/ultras-module.ts                    # apiの束縛
│   └── test/support/ultras-graphql-operations.ts       # GraphQLのWorkers統合テストの補助(利用者・管理者の用意と操作の送信)
├── event/src/
│   ├── application/ultras/                             # Bunの単体テスト
│   │   ├── event-ultras-types.ts                       # EVENT_ULTRAS_TYPES
│   │   ├── run-activation-handlers-handler.ts          # ultras.run-activation-handlersの処理
│   │   ├── subscription-cancellation-handler.ts        # withdrawn・suspendedの波及処理
│   │   ├── ultras-account-data-eraser.ts               # UltrasAccountDataEraser(削除の書き込みの単位のポート。前例payment-account-data-eraser.ts)
│   │   └── subscription-erasure-handler.ts             # purge_dueの波及処理
│   ├── infrastructure/ultras/d1-ultras-account-data-eraser.ts # D1UltrasAccountDataEraser(3テーブルの利用者の行の削除を1回の一括の書き込みで確定、Workers統合テスト)
│   ├── infrastructure/email/templates/ultras/          # index.ts・本文の*-email-body.tsxと定義の*-template.ts(2種)
│   ├── composition/ultras-activation-handlers.ts       # ULTRAS_ACTIVATION_HANDLERS(後続specが追記、初版は空)
│   └── composition/ultras-module.ts                    # eventの束縛
├── client/src/
│   ├── routes/pricing.tsx                              # /pricing(ログイン不要)
│   ├── routes/_authenticated/settings/plan.tsx         # /settings/plan
│   ├── composition/pricing-sections.ts                 # PRICING_SECTIONS(sponsorshipが追記)
│   ├── graphql/ultras.ts                               # 取得の補助(ultrasOfferQueryOptions・viewerUltrasQueryOptions・loadPlanPage)と加入状態のenumの小文字への写像(toUltrasPlanStatus)
│   ├── components/ultras/                              # 1ファイル1コンポーネント(browser testを併置)
│   │   ├── ultras-messages.ts                          # Ultrasの区画・加入ボタンの文言(前例payments/checkout-messages.ts)
│   │   ├── pricing-messages.ts                         # 料金ページの題名・説明・法的通知の文
│   │   ├── plan-messages.ts                            # プラン管理画面・Portalのボタン・反映待ちの文言
│   │   ├── plan-search.ts                              # /settings/planの検索パラメータportal=returnedの検証
│   │   ├── portal-return-rules.ts                      # 反映待ちの確かめ直しの間隔・上限・回数の判定
│   │   ├── pricing-page.tsx                            # 区画の並び(区画ごとにRecoverableSlotで包む)と法的通知へのリンク
│   │   ├── ultras-pricing-section.tsx                  # 料金ページのUltrasの区画
│   │   ├── ultras-price-line.tsx                       # 月額の価格の行(照会できなければ「現在表示できません」。料金ページとプラン管理画面で共用)
│   │   ├── ultras-benefit-list.tsx                     # 特典と条件の一覧
│   │   ├── ultras-subscribe-button.tsx                 # 加入ボタン(未ログイン・未確認・不可の出し分け)
│   │   ├── plan-status-panel.tsx                       # 加入状態ごとの表示
│   │   ├── portal-button.tsx                           # Portalを開く
│   │   ├── portal-return-notice.tsx                    # Portalから戻った直後の反映待ち
│   │   ├── plan-page.tsx                               # プラン管理画面の全体
│   │   └── ultras-promotion-gate.tsx                   # 導線の表示の可否(後続specも使う)
│   ├── graphql/operations/ultras/                      # 1ファイル1操作の.graphql(操作名はClientで始める)
│   │   ├── ultras-offer.graphql                        # ClientUltrasOffer(ultrasOffer)
│   │   ├── viewer-ultras.graphql                       # ClientViewerUltras(viewerUltras)
│   │   ├── start-ultras-checkout.graphql               # ClientStartUltrasCheckout(startUltrasCheckout)
│   │   └── create-ultras-portal-session.graphql        # ClientCreateUltrasPortalSession(createUltrasPortalSession)
│   └── test/plan-route.browser.test.tsx                # /settings/planの経路の配線(検索パラメータ・head・ナビゲーション・未ログインの誘導)のブラウザテスト(前例billing-route.browser.test.tsx)
└── admin/src/
    ├── routes/_authenticated/settings/index.tsx        # /settings
    ├── composition/admin-settings-sections.ts          # ADMIN_SETTINGS_SECTIONS(tournament-year・notificationsが追記)
    ├── graphql/admin-ultras-promotion.ts               # 取得の補助(adminUltrasPromotionSettingQueryOptions)と最後の変更の表示の写像(toPromotionLastChange)
    ├── components/pages/admin-settings-page.tsx        # 区画の並び(区画ごとにRecoverableSlotで包む)
    ├── components/settings/settings-messages.ts        # 設定のページの題名と説明
    ├── components/settings/admin-settings-sections-view.tsx # 区画をorder順に並べ、RecoverableSlotとSectionFallbackで包む
    ├── components/layout/section-fallback.tsx          # 読み込み中と失敗の間に区画の見出しを補う枠(カテゴリの区画と共用)
    ├── components/ultras/promotion-setting-messages.ts # フラグの区画の文言
    ├── components/ultras/promotion-setting-section.tsx # フラグの区画
    └── graphql/operations/ultras/                      # 1ファイル1操作の.graphql(操作名はAdminで始める)
        ├── ultras-promotion-setting.graphql            # AdminUltrasPromotionSetting(ultrasPromotionSetting)
        └── update-ultras-promotion-setting.graphql     # AdminUpdateUltrasPromotionSetting(updateUltrasPromotionSetting)
```

テストは各ファイルの隣に置く(`*.unit.test.ts`・`*.worker.test.ts`・`*.browser.test.tsx`)。E2Eは`e2e/client/ultras.e2e.test.ts`・`e2e/admin/ultras-promotion.e2e.test.ts`で、利用者側の手順は`e2e/client/ultras-steps.ts`に置く(管理者側のE2Eも機能フラグの書き換えにこの手順を使う)。

### Modified Files

- `apps/db/schema/index.ts`・`apps/db/migrations/<日時>_ultras_subscription/`(`migration.sql`・`snapshot.json`)・`apps/db/migrations/<日時>_ultras_subscription_seed/migration.sql` — 4テーブルの再エクスポートと生成したマイグレーション、機能フラグの初期行のカスタムマイグレーション(`db/003`の「初期データ」、前例`legal_pages_seed`・`inquiry_chat_seed`)。初期行は`setting_key = 'ultras_promotion'`・`enabled = 0`・`version = 0`・`updated_by_admin_id`はNULLで、IDは固定のULID、`created_at`・`updated_at`はそのULIDの時刻部と同じエポックミリ秒にし、`ON CONFLICT (setting_key) DO NOTHING`を付ける(仮2)。mainの最新を取り込んでから生成する。
- `apps/common-lib/admin/audit-actions/index.ts` — `ultras-subscription.ts`の配列を連結する。
- `apps/backend-lib/core/messaging/contracts/index.ts`・`core/email/kinds/index.ts` — メッセージ種別と2つのメールの種別を加える(種別とテンプレートは同じタスクで足す)。
- `apps/backend-lib/workers/payments/purchase-kind-registrations.ts` — `PURCHASE_KIND_REGISTRATIONS`に`ultras`、`SUBSCRIPTION_EVENT_SINKS`に`ultras-subscription.plan-state`を加える。
- `apps/api/src/composition/modules.ts`・`graphql-modules.ts`・`scheduled-jobs.ts` — `createUltrasPlatformModule('api')`・apiのUltrasモジュール・スキーマモジュール・ジョブ。
- `apps/event/src/composition/modules.ts`・`message-handlers.ts`・`user-lifecycle-async-handlers.ts`・`infrastructure/email/templates/index.ts` — 束縛(`createUltrasPlatformModule('event')`とeventのUltrasモジュール)、`ultras.run-activation-handlers`の処理、2つの波及処理、2つのテンプレート。
- `apps/client/src/composition/settings-navigation.ts` — `{ to: '/settings/plan', label: 'プラン', order: 60 }`。
- `apps/frontend-lib/start/page-head.ts`・`page-head.unit.test.ts`(frontend-platformの所有)・`apps/client/src/head/page-heads.ts` — `PageHeadInput`に省略可能な`description`を加え、`buildSitePageHead`から渡せるようにする(上流への影響)。
- `apps/admin/src/components/layout/recoverable-slot.tsx`→`apps/frontend-lib/components/state/recoverable-slot.tsx`(inquiry-chatが作成)と、adminの`dashboard-grid.tsx`・`category-sections-view.tsx`・`inquiry-detail-actions-view.tsx` — 区画ごとのエラーの境界を、問い合わせの扱いをpropsで受け取る形にしてfrontend-libへ移し、adminの利用箇所は`ADMIN_PROFILE.contactAvailable`を渡す。Storybookのストーリーとブラウザテストを足す(上流への影響)。
- `docs/GUIDES/tech/frontend/005-shared-components.md`・`009-admin-console-shell.md` — `RecoverableSlot`をfrontend-libの部品の一覧と使い方へ移し、管理画面の枠の部品の一覧から参照する。
- `docs/GUIDES/tech/frontend/010-live-refresh-queries.md` — 「使う場面」の表に「外部サービスでの操作から戻った直後に、遅れて反映される閲覧者自身のデータ」の行(回数を限った一時的な再取得、「自動更新」の`Switch`を置かない、上限で開き直しの案内)を、プロジェクト名と固有の値を含めずに加える。
- `apps/admin/src/composition/admin-navigation.ts` — `{ to: '/settings', label: '設定', order: 130 }`。
- `docs/onboardings/tech-stack.md` — Stripe Customer Portalの用途を「Ultrasの支払い方法の更新・解約・解約の取り消し」に改める(Q6)。
- `docs/GUIDES/tech/backend/README.md`・`external/README.md` — 文書一覧の表に行を加える。
- `docs/GUIDES/tech/operations/004-payment-data-operations.md` — paymentsが書いた「価格」(定期課金の価格の`lookup_key`のプレースホルダー)・「Customer Portal」(設定の表と前提)・「制限付きキーの権限」(Subscriptions・Customer Portalの行)の節は確かめて足りない点だけを追記し、「定期課金」の節(再試行の後の解約、顧客向けメールの停止、test clockによる検証、退会・停止の波及処理の解約が再試行の上限で失敗したときのダッシュボードでの解約)を加える。
- `docs/onboardings/project-values.md` — 本specのプレースホルダーの値(定期課金の価格の`lookup_key`は`ultras_monthly`)と、登録の一覧(「定期実行と非同期メッセージ」のジョブ・メッセージ種別・波及処理、「メール送信」の種別、「利用者側のbot判定と回数制限」の規則`ultras-portal:user`、「管理者のアカウント」の操作種別とメニュー、「決済」の購入種別)に本specの行を加える。
- `docs/GUIDES/service/legal/004-legal-notice-outline.md` — 返金ポリシーの「ユーザー停止に伴う定期課金(Ultras)」の行は「返金しない」に直っている(コミットfccb79cb)ため、FR-PPLAN-012の課金期間の末日の解約と一致することを確かめるだけにし(Q3)、「退会に伴う定期課金の解約: 即時に解約し、返金しない」(Q7)・「トーナメント参加費の決済後のUltras加入: 返金しない」(Q2)の行を加える。章8に解約はCustomer Portalで行う旨と解約の受付の確認メール(仮1)を加える。他の行は変えない。
- `docs/GUIDES/service/legal/001-compliance-policy.md` — LR-007の行に、退会時の即時の解約・解約の受付の確認(仮1)・購入確認メールの自動更新の条件(仮3)を加える。
- `docs/GUIDES/service/overview/002-pricing-and-plans.md` — 免除の判定時点の確定(Q1)、決済後に加入した場合の返金なし(Q2)、特典の終了時刻(Q4)、機能フラグの範囲と初期値(Q5・仮2)、停止・退会の扱い(Q3・Q7)、支払いの失敗と解約の受付のメール(Q8・仮1)。
- `docs/GUIDES/service/design/002-page-layouts.md` — `/pricing`の「フラグがオフなら404」を「Ultrasの区画を未加入者に表示しない」に直し(Q5)、`/settings/plan`をPortalに一本化した配置(Q6)・状態ごとの表示・Portalから戻った直後の表示、管理者側の「設定」ページの区画の並び(仮6)を記載する。
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — 加入状態の表示名、プラン管理画面・料金ページの文言、エラーの文言、通知メールの件名2種を加える。
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 4:21の表に`ultras-subscription.pending-dispatch-sweep`(500)を加える。
- `docs/GUIDES/service/features/README.md` — `005-ultras-subscription.md`の行を加える。
- `e2e/support/playwright-config.ts`・`playwright-config.unit.test.ts`(dev-toolingの所有) — `createPlaywrightConfig`に直列の組の汎用の引数`serialGroups`(既定は空)を加える(上流への影響)。ワーカーの数は変えない。
- ルートの`playwright.config.ts`(dev-toolingの所有) — Ultrasの組(`e2e/client/ultras.e2e.test.ts`の後に`e2e/admin/ultras-promotion.e2e.test.ts`)を`serialGroups`で渡す。
- `docs/GUIDES/tech/testing/001-test-strategy.md`(dev-toolingの所有) — E2Eの節に「共有の行を書き換えるE2Eは直列の組で依存を繋ぐ」旨と、`--project <対象名>`では組のファイルが外れ組は`--project '<組の名前>-*'`で実行する旨を、プロジェクト名と固有の値を含めずに加える。
- `.kiro/specs/dev-tooling/design.md` — E2EConfigの契約(`createPlaywrightConfig`の宣言と組み立ての説明)を、`serialGroups`を加えた形に合わせる。

新規の文書:

- `docs/GUIDES/tech/backend/010-subscription-entitlements.md` — 外部の定期課金の状態から特典の継続期間(区間)を導く規約、業務日付の日の終わりへの切り上げ、区間に対する時点・期間の判定と一括の判定、通知の到着順への対応、確定の後の副作用と日次の確認、知らせのハンドラの冪等性の規約。
- `docs/GUIDES/tech/external/008-stripe-billing-portal.md` — 定期課金の状態の対応(柔軟な請求モードの`cancel_at`を含む)、Customer Portalの機能の設定とセッションの作成、再試行の後の扱いの設定、顧客向けメールの停止、test clockによる検証。
- `docs/GUIDES/service/features/005-ultras-subscription.md` — Ultrasの実装方針(加入状態の導出表、特典の継続期間、加入が有効になった知らせ、機能フラグ、メール)。

## System Flows

### 加入から有効化まで

```mermaid
sequenceDiagram
    participant U as 投稿者
    participant C as client
    participant A as api
    participant P as payments
    participant S as Stripe
    participant E as event
    U->>C: 料金ページでUltrasに加入
    C->>A: startUltrasCheckout
    A->>P: CheckoutStarter start ultras
    P->>A: UltrasOfferPolicy describe
    P-->>C: 購入ID
    U->>S: 決済画面で支払い
    S->>E: Webhook
    E->>P: PaymentReflector
    P->>P: UltrasFulfillment prepare
    P->>P: 一括の書き込み 加入の有効化と知らせの行
    P->>E: afterCommit
    E->>E: ActivationDispatcher send ultras.run-activation-handlers
    E->>E: RunActivationHandlersHandler 登録順に実行
```

- `return_url`(api)とWebhook(event)のどちらが先でも、paymentsの購入の前進で一括の書き込みは1回だけ確定する。`afterCommit`は確定させた側だけが呼ぶ。送り出しに失敗しても行は`dispatched_at`が空のまま残り、4:21に送り直す。
- `prepare`は加入の開始時刻(支払いの確定の時刻)に同じ利用者の別の加入の特典の継続期間が重なれば拒否し、paymentsが定期課金を解約して全額返金する(1.8)。同時の確定は、特典の継続期間が開いている加入を利用者ごとに1つに限る部分一意索引の違反で片方が取り消され、paymentsが`prepare`を呼び直して拒否になる(1.9)。

### 加入状態の遷移

```mermaid
stateDiagram-v2
    [*] --> active: 初回の支払いの確定
    active --> past_due: 支払いの失敗
    past_due --> active: 再試行の成功
    active --> canceled: 解約の予約
    past_due --> canceled: 解約の予約
    canceled --> active: 解約の取り消し
    canceled --> ended: 特典の終了時刻を過ぎる
    past_due --> ended: 再試行の後の終了
    active --> ended: 即時の解約
    canceled --> ended: 即時の解約
    ended --> [*]
```

- 加入状態は保存せず、Stripe側の値と特典の終了時刻から、問い合わせの時刻ごとに導く(`derivePlanStatus`)。`ended`へは時刻の経過だけで移るため、終了のための定期実行は要らない。
- 特典の終了時刻は、解約の予約で「課金期間の最後の瞬間(予定時刻`cancelAt`、無ければ課金期間の終了時刻の直前)を含む業務日付の翌日0:00」、予約の取り消しで空、終了の状態(`canceled`・`unpaid`・`incomplete_expired`・`paused`)で「予約があり終了の時刻が予定時刻以後なら同じ翌日0:00、それ以外は終了の時刻」に決まる。一度終了の状態で決めた値は変えない(3.4)。

### 退会・停止による解約

```mermaid
sequenceDiagram
    participant L as identity-auth runner
    participant H as cancellation handler
    participant D as D1
    participant G as StripeGateway
    participant S as Stripe
    L->>H: withdrawn または suspended
    H->>D: 終了していない加入を取得
    alt suspended
        H->>D: pending_cancellation_sourceにsuspensionを記録
        H->>G: cancelSubscription atPeriodEnd true
    else withdrawn
        H->>D: pending_cancellation_sourceにwithdrawalを記録
        H->>G: cancelSubscription atPeriodEnd false
    end
    G->>S: 解約
    S-->>L: Webhook経由で状態の変化をsinkへ
```

- 解約の結果は、Webhookで届く定期課金の状態の変化としてだけ加入状態に反映する(7.8)。`pending_cancellation_source`は、sinkが解約の予約を受け取ったときに解約の受付の確認メールを送らない判断に使う(8.4)。
- 停止の解除(`unsuspended`)には波及処理を登録しない(7.4)。

## Requirements Traceability

| Requirement             | Summary                                | Components                                                                                                           | Interfaces                                                             | Flows                |
| ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------- |
| 1.1, 1.2                | 加入の開始と価格                       | UltrasCheckout、UltrasPlanReader、UltrasSubscribeButton、UltrasPricingSection                                        | `startUltrasCheckout`・`ultrasOffer`                                   | 加入から有効化まで   |
| 1.3                     | 最終確認画面の追加事項                 | UltrasOfferPolicy                                                                                                    | `CheckoutSummaryText.additionalNotes`                                  | 加入から有効化まで   |
| 1.4, 1.5, 1.6           | 加入の拒否                             | UltrasOfferPolicy、UltrasCheckout                                                                                    | `PurchaseOfferDecision`                                                | —                    |
| 1.7, 1.8, 1.9           | 有効化と二重の加入の防止               | UltrasFulfillment、D1SubscriptionStore                                                                               | `PurchaseFulfillment.prepare`                                          | 加入から有効化まで   |
| 2.1〜2.11               | 加入状態の管理                         | PlanStateSink、SubscriptionTransition、EntitlementRules、D1SubscriptionStore                                         | `SubscriptionEventSink`・`applySubscriptionChange`・`derivePlanStatus` | 加入状態の遷移       |
| 2.12                    | 返金・チャージバックで変えない         | PlanStateSink(定期課金の変化だけを扱う)                                                                              | —                                                                      | —                    |
| 3.1〜3.5, 3.7           | 特典の判定                             | UltrasEntitlements、EntitlementRules                                                                                 | `UltrasEntitlements`                                                   | —                    |
| 3.6                     | 現在の加入状態の照会                   | UltrasEntitlements                                                                                                   | `currentPlan`                                                          | —                    |
| 4.1〜4.5                | 加入が有効になった知らせ               | UltrasFulfillment、ActivationDispatcher、RunActivationHandlersHandler、PendingDispatchSweepJob、ActivationContract   | `ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE`                               | 加入から有効化まで   |
| 4.6                     | 冪等性の規約                           | UltrasTechDocs(`backend/010`)                                                                                        | —                                                                      | —                    |
| 5.1〜5.9                | プラン管理画面                         | PlanPage、PlanStatusPanel、PortalButton、PortalReturnNotice、UltrasPlanReader、SETTINGS_NAV_ITEMS                    | `viewerUltras`                                                         | —                    |
| 6.1, 6.2, 6.5, 6.6, 6.7 | Portalのセッション                     | PortalSessionStarter、PortalSessionLimits、CounterPortalSessionLimits、PortalButton                                  | `createUltrasPortalSession`                                            | —                    |
| 6.3, 6.4                | Portalの機能と決済手段                 | UltrasTechDocs(`operations/004`・`external/008`)                                                                     | —                                                                      | —                    |
| 6.8                     | Portalの結果の反映                     | PlanStateSink                                                                                                        | `SubscriptionEventSink`                                                | 加入状態の遷移       |
| 7.1〜7.7                | 退会・停止の解約                       | SubscriptionCancellationHandler                                                                                      | `UserLifecycleAsyncHandler`・`StripeGateway.cancelSubscription`        | 退会・停止による解約 |
| 7.8                     | 解約の結果の反映                       | PlanStateSink                                                                                                        | —                                                                      | 退会・停止による解約 |
| 8.1, 8.2, 8.3, 8.4      | 支払いの失敗と解約の受付のメール       | SubscriptionTransition、PlanStateSink、UltrasNotifier、UltrasEmailKinds、UltrasEmailTemplates                        | `ultras.payment-failed`・`ultras.cancellation-accepted`                | —                    |
| 8.5, 8.10               | 終了のメールとStripeのメールを使わない | SubscriptionTransition、UltrasTechDocs                                                                               | —                                                                      | —                    |
| 8.6, 8.7, 8.8, 8.9      | メールの分類・日時・宛先・送り直し     | UltrasEmailKinds、UltrasNotifier、PendingDispatchSweepJob                                                            | `EmailSender`・`UserContactDirectory.findContact`                      | —                    |
| 9.1〜9.8                | 料金ページ                             | PricingPage、PricingSections、UltrasPricingSection、UltrasBenefitList、UltrasSubscribeButton、UltrasPlanReader       | `ultrasOffer`・`viewerUltras`                                          | —                    |
| 10.1〜10.4, 10.9        | 管理画面のフラグ                       | AdminSettingsPage、AdminSettingsSections、PromotionSettingSection、PromotionSettingService、D1PromotionSettingWriter | `ultrasPromotionSetting`・`updateUltrasPromotionSetting`               | —                    |
| 10.5, 10.6, 10.7, 10.8  | フラグの意味と照会                     | UltrasPromotionFlagReader、UltrasOfferPolicy、UltrasPromotionGate、UltrasPlanReader                                  | `UltrasPromotionFlagReader`                                            | —                    |
| 11.1                    | 物理削除                               | SubscriptionErasureHandler、UltrasAccountDataEraser、D1UltrasAccountDataEraser                                       | `UserLifecycleAsyncHandler`                                            | —                    |
| 11.2                    | エクスポートの照会口                   | UltrasPlanExport                                                                                                     | `UltrasPlanExport.find`                                                | —                    |
| 11.3                    | 古い行の後始末                         | PendingDispatchSweepJob                                                                                              | `ScheduledJobDefinition`                                               | —                    |
| 12.1, 12.2              | 運用手順書                             | UltrasTechDocs(`operations/004`)                                                                                     | —                                                                      | —                    |
| 12.3                    | 個人データを含めない記録               | 全コンポーネント(ログの規約)                                                                                         | `getAppLogger`                                                         | —                    |
| 13.1, 13.2              | テスト                                 | Testing Strategy                                                                                                     | —                                                                      | —                    |
| 13.3                    | 技術ドキュメント                       | UltrasTechDocs                                                                                                       | —                                                                      | —                    |
| 13.4, 13.5              | サービス仕様                           | UltrasServiceSpecs                                                                                                   | —                                                                      | —                    |

## Components and Interfaces

| Component                                                                                    | Domain/Layer                                      | Intent                                               | Req Coverage                            | Key Dependencies                                                                       | Contracts |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- | --------- |
| PlanStatusValues・PromotionFlagValues                                                        | common-lib                                        | 加入状態の値と表示名・価格の`lookup_key`・フラグの鍵 | 2.2〜2.9, 10.5                          | —                                                                                      | State     |
| UltrasAuditActions                                                                           | common-lib                                        | 監査ログの操作種別                                   | 10.2                                    | admin-foundation (P0)                                                                  | State     |
| EntitlementRules・SubscriptionTransition                                                     | backend-lib/core                                  | 特典の終了時刻・加入状態の導出・変化の解釈           | 2.1〜2.11, 3.1〜3.4, 8.1〜8.5           | 業務時刻 (P0)                                                                          | Service   |
| ActivationContract・ActivationMessage                                                        | backend-lib/core                                  | 知らせの契約・登録の検証・メッセージ種別             | 4.1, 4.3, 4.4                           | backend-platform (P0)                                                                  | Event     |
| UltrasEmailKinds                                                                             | backend-lib/core                                  | 2種のメールの種別                                    | 8.1, 8.3, 8.6, 8.7                      | email-delivery (P0)                                                                    | —         |
| D1各ストア・UltrasPromotionFlagReader                                                        | backend-lib/core(契約)・workers(実装)             | 4テーブルの読み書き・フラグ                          | 1.7〜1.9, 2.\*, 10.5, 11.1              | D1 (P0)                                                                                | State     |
| UltrasEntitlements                                                                           | backend-lib/core(契約)・workers(実装)             | 特典の判定と現在の加入状態                           | 3.1〜3.7                                | D1SubscriptionStore (P0)                                                               | Service   |
| UltrasOfferPolicy                                                                            | backend-lib/workers(core/paymentsの契約の実装)    | 購入の可否と内容                                     | 1.2〜1.6, 10.6                          | PriceCatalog (P0)、UltrasEntitlements (P0)                                             | Service   |
| UltrasFulfillment                                                                            | backend-lib/workers(workers/paymentsの契約の実装) | 加入の有効化と知らせの行                             | 1.7〜1.9, 4.1, 4.2                      | D1SubscriptionStore (P0)                                                               | Service   |
| PlanStateSink                                                                                | backend-lib/workers(workers/paymentsの契約の実装) | 定期課金の変化の取り込み                             | 2.1〜2.12, 6.8, 7.8, 8.1〜8.4           | SubscriptionTransition (P0)                                                            | Service   |
| ActivationDispatcher・UltrasNotifier                                                         | backend-lib/core(契約)・workers(実装)             | 知らせとメールの送り出し                             | 4.1, 4.5, 8.1, 8.3, 8.8, 8.9            | MessagePublisher (P0)、EmailSender (P0)、UserContactDirectory (P0)                     | Service   |
| UltrasPlanExport                                                                             | backend-lib/core(契約)・workers(実装)             | データエクスポートの`plan`                           | 11.2                                    | D1SubscriptionStore (P0)                                                               | Service   |
| UltrasPlatformModule                                                                         | backend-lib/workers                               | 両アプリ共通の束縛                                   | —                                       | Inversify (P0)                                                                         | —         |
| UltrasPlanReader・UltrasCheckout                                                             | api/application                                   | 画面の照会と加入の開始                               | 1.1, 1.2, 3.6, 5.1〜5.5, 9.2〜9.7, 10.7 | CheckoutStarter (P0)                                                                   | Service   |
| PortalSessionStarter・PortalSessionLimits                                                    | api/application                                   | Portalのセッションと回数制限                         | 6.1, 6.2, 6.5〜6.7                      | StripeGateway (P0)、PortalSessionLimits (P0)、`core/ultras`のSubscriptionStore (P0)    | Service   |
| CounterPortalSessionLimits                                                                   | api/infrastructure                                | Portalのセッションの回数制限の実装                   | 6.6                                     | RateLimitCounterClient (P0)                                                            | Service   |
| PromotionSettingService・D1PromotionSettingWriter                                            | api                                               | フラグの照会・変更と監査ログ                         | 10.1〜10.4                              | AuditLogRecorder (P0)                                                                  | Service   |
| PendingDispatchSweepJob                                                                      | api/application/jobs                              | 送り出し直しと後始末                                 | 4.5, 8.9, 11.3                          | `core/ultras`のActivationDispatcher・UltrasNotifier・ActivationStore・NoticeStore (P0) | Batch     |
| UltrasSchemaModule                                                                           | api/presentation                                  | GraphQLの型と操作                                    | 1.\*, 5.\*, 6.\*, 9.\*, 10.\*           | api-gateway (P0)                                                                       | API       |
| RunActivationHandlersHandler                                                                 | event/application                                 | 知らせの実行                                         | 4.1, 4.4                                | ULTRAS_ACTIVATION_HANDLERS (P0)                                                        | Event     |
| SubscriptionCancellationHandler・SubscriptionErasureHandler                                  | event/application                                 | 退会・停止の解約と物理削除                           | 7.1〜7.7, 11.1                          | identity-auth (P0)、StripeGateway (P0)、UltrasAccountDataEraser (P0)                   | Event     |
| D1UltrasAccountDataEraser                                                                    | event/infrastructure                              | 物理削除の書き込みの単位                             | 11.1                                    | SubscriptionStatements・ActivationStatements・NoticeStatements (P0)                    | State     |
| UltrasEmailTemplates                                                                         | event/infrastructure                              | 2種のメール                                          | 8.1, 8.3, 8.7                           | email-delivery (P0)                                                                    | —         |
| PricingPage・PricingSections・UltrasPricingSection・UltrasBenefitList・UltrasSubscribeButton | client                                            | 料金ページ                                           | 1.1, 1.2, 9.1〜9.8                      | MoneyText (P1)                                                                         | State     |
| PlanPage・PlanStatusPanel・PortalButton・PortalReturnNotice                                  | client                                            | プラン管理画面                                       | 5.1〜5.9, 6.1, 6.2, 6.7                 | SettingsShell (P0)                                                                     | State     |
| UltrasPromotionGate                                                                          | client                                            | 導線の表示の可否                                     | 10.6, 10.8                              | —                                                                                      | State     |
| AdminSettingsPage・AdminSettingsSections・PromotionSettingSection                            | admin                                             | 設定ページとフラグの区画                             | 10.1〜10.4, 10.9                        | RoleGate (P0)、ConfirmActionDialog (P0)                                                | State     |
| UltrasTechDocs                                                                               | docs/GUIDES/tech                                  | `backend/010`・`external/008`・`operations/004`の節  | 4.6, 6.3, 6.4, 8.10, 12.1, 12.2, 13.3   | —                                                                                      | —         |
| UltrasServiceSpecs                                                                           | docs/GUIDES/service                               | Ultrasの実装方針と関連するサービス仕様               | 13.4, 13.5                              | —                                                                                      | —         |

### common-lib

#### PlanStatusValues・PromotionFlagValues・UltrasAuditActions

```typescript
// plan-status.ts
export declare const ULTRAS_PLAN_STATUSES: readonly [
  'active',
  'past_due',
  'canceled',
  'ended',
];
export type UltrasPlanStatus = (typeof ULTRAS_PLAN_STATUSES)[number];
export declare const ULTRAS_PLAN_STATUS_LABELS: Readonly<
  Record<UltrasPlanStatus, string>
>; // 有効・支払いの再試行中・解約済み・終了
export declare const ULTRAS_ENTITLED_STATUSES: readonly UltrasPlanStatus[]; // active・past_due・canceled
export declare const ULTRAS_PRICE_LOOKUP_KEY: 'ultras_monthly';
// promotion-flag.ts
export declare const ULTRAS_PROMOTION_FLAG_KEY: 'ultras_promotion';
export declare const ULTRAS_PROMOTION_FLAG_DEFAULT: false; // 仮2
// audit-actions/ultras-subscription.ts
export declare const ULTRAS_AUDIT_ACTIONS: readonly AuditActionDefinition[];
// ultras-promotion.update: label「Ultras導線の機能フラグの変更」、targetKind 'setting'、reason 'optional'、detailKeys ['enabled']、maxTargets 1
```

### backend-lib/core

#### EntitlementRules・SubscriptionTransition

| Field        | Detail                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------- |
| Intent       | 特典の終了時刻・加入状態・区間の判定と、定期課金の変化の解釈を純粋な関数で表す            |
| Requirements | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 3.1, 3.2, 3.4, 8.1, 8.2, 8.3, 8.4, 8.5 |

**Contracts**: Service [x]

```typescript
// StripeSubscriptionStatus('incomplete' | 'incomplete_expired' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused')はpaymentsのcore/payments/purchase-kind-contract.tsの型を読み込んで使い、自前には定義しない
import type { StripeSubscriptionStatus } from '../payments/purchase-kind-contract.ts';
export type CancellationSource = 'user' | 'suspension' | 'withdrawal';

export interface SubscriptionSnapshot {
  readonly stripeStatus: StripeSubscriptionStatus;
  readonly cancelScheduled: boolean; // cancelAtPeriodEnd または cancelAt がある
  readonly cancelAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly endedAt: Date | null;
  readonly startedAt: Date | null; // 加入が有効になった時刻(未有効はnull)
  readonly benefitEndsAt: Date | null; // 特典の終了時刻(開いているならnull)
  readonly benefitEndFixed: boolean; // 終了の状態で決めた値か
  readonly canceledAt: Date | null; // 解約の操作の時刻
  readonly cancellationSource: CancellationSource | null;
  readonly pendingCancellationSource: Exclude<
    CancellationSource,
    'user'
  > | null;
  readonly pastDueSince: Date | null;
}

export declare function endOfBusinessDayContaining(instant: Date): Date; // その業務日付の翌日0:00(UTC-08:00)。区間の右端は含まない
export declare function benefitEndForScheduledEnd(scheduledEnd: Date): Date; // 期間の最後の瞬間(scheduledEnd − 1ms)を含む業務日付の翌日0:00。課金期間は終了時刻を含まないため
export declare function derivePlanStatus(
  snapshot: SubscriptionSnapshot,
  now: Date,
): UltrasPlanStatus | null; // 未有効はnull
export declare function isEntitledAt(
  snapshot: Pick<SubscriptionSnapshot, 'startedAt' | 'benefitEndsAt'>,
  at: Date,
): boolean; // startedAt ≤ at < benefitEndsAt(空は無限)
export declare function overlapsPeriod(
  snapshot: Pick<SubscriptionSnapshot, 'startedAt' | 'benefitEndsAt'>,
  from: Date,
  to: Date,
): boolean; // startedAt ≤ to かつ (benefitEndsAt 空 または benefitEndsAt > from)

export interface SubscriptionChangeInput {
  readonly status: StripeSubscriptionStatus;
  readonly cancelAtPeriodEnd: boolean;
  readonly cancelAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly endedAt: Date | null;
  readonly occurredAt: Date;
}
// UltrasNoticeKind('payment_failed' | 'cancellation_accepted')はports.tsで定義し(2.1)、ここでは読み込んで使う
// 本サービスの設定では届かないはずの値。純粋な規則はログを出さないため、受け取り口(PlanStateSink)がwarnログとSentryのcaptureEventに写す
export type SubscriptionTransitionAnomaly =
  | {
      readonly kind: 'unexpected_status';
      readonly status: StripeSubscriptionStatus;
    } // unpaid・paused
  | { readonly kind: 'scheduled_end_missing' }; // 解約の予約があるのに予定の終了時刻が無い
export interface SubscriptionTransitionResult {
  readonly next: SubscriptionSnapshot;
  readonly notices: readonly {
    readonly kind: UltrasNoticeKind;
    readonly dedupeKey: string;
    readonly benefitEndsAt: Date | null;
    readonly acceptedAt: Date;
  }[];
  readonly anomalies: readonly SubscriptionTransitionAnomaly[];
}
export declare function applySubscriptionChange(
  previous: SubscriptionSnapshot,
  change: SubscriptionChangeInput,
  stripeSubscriptionId: string,
): SubscriptionTransitionResult;
```

- `derivePlanStatus`: 未有効はnull。`benefitEndsAt`があり`now ≥ benefitEndsAt`なら`ended`。Stripe側が`past_due`なら`past_due`。`benefitEndsAt`があれば`canceled`。それ以外は`active`(2.2〜2.9)。
- `applySubscriptionChange`の規則:
  - Stripe側の値(状態・予約・予定時刻・課金期間の終了・終了の時刻)は常に最新に置き換える(2.1・2.10)。
  - `benefitEndFixed`が真なら`benefitEndsAt`を変えない(3.4)。
  - 終了の状態(`canceled`・`unpaid`・`incomplete_expired`・`paused`): 予定時刻`T = cancelAt ?? currentPeriodEnd`について、(以前または今回の)予約があり`endedAt ≥ T`なら`benefitEndForScheduledEnd(T)`、それ以外は`endedAt ?? occurredAt`を`benefitEndsAt`とし、`benefitEndFixed = true`(2.5〜2.7)。`unpaid`・`paused`は本サービスの設定では起きない状態として`warn`のログを残す。
  - 終了していない状態で予約がある: `benefitEndsAt = benefitEndForScheduledEnd(T)`。予約が無い: `benefitEndsAt = null`(2.4・2.8)。
  - 予約が偽→真に変わり、加入が有効なら`canceledAt = occurredAt`、`cancellationSource = pendingCancellationSource ?? 'user'`、`pendingCancellationSource`は残す。`user`なら`cancellation_accepted`(`dedupeKey = 'cancellation_accepted:<定期課金のID>:<occurredAtのミリ秒>'`)を返す(8.3・8.4)。真→偽(取り消し)なら`canceledAt`・`cancellationSource`を空にする。
  - Stripe側が`past_due`以外から`past_due`になり、加入が有効なら`pastDueSince = occurredAt`とし、`payment_failed`(`dedupeKey = 'payment_failed:<定期課金のID>:<pastDueSinceのミリ秒>'`)を返す。`past_due`のままなら返さない(8.1・8.2)。`past_due`から抜けたら`pastDueSince`を空にする。
  - 終了(`ended`への変化)のメールは返さない(8.5)。
- 境界の例(テストで確かめる): 課金期間の終了が`2026-11-05T18:00:00Z`(業務日付11-05の10:00)なら特典の終了時刻は`2026-11-06T08:00:00Z`(11-05の23:59:59.999まで特典)。終了が`2026-11-06T08:00:00Z`ちょうど(業務日付11-06の0:00)なら、課金期間の最後の瞬間は11-05に属するため`2026-11-06T08:00:00Z`。終了が`2026-11-06T08:00:00.001Z`なら`2026-11-07T08:00:00Z`。

#### ActivationContract・ActivationMessage

**Contracts**: Event [x]

```typescript
export interface UltrasActivation {
  readonly activationId: string; // ULID
  readonly userId: string;
  readonly stripeSubscriptionId: string;
  readonly activatedAt: Date; // 加入の開始時刻(支払いの確定の時刻)
}
export interface UltrasActivationHandler {
  handle(activation: UltrasActivation): Promise<void>; // 例外は再試行。冪等にする
}
export interface UltrasActivationHandlerRegistration {
  readonly name: string; // '<spec名>.<名詞句>' 例 'tournament-week.open-entry-checkout-expiry'
  readonly order: number; // 昇順に実行
  readonly handler: ServiceIdentifier<UltrasActivationHandler>;
}
export declare function createUltrasActivationRegistry(
  registrations: readonly UltrasActivationHandlerRegistration[],
): readonly UltrasActivationHandlerRegistration[]; // 名前の形式違反・重複・orderの重複で例外、order昇順で返す
export declare const ULTRAS_RUN_ACTIVATION_HANDLERS_MESSAGE: MessageContract<
  'ultras.run-activation-handlers',
  { readonly activationId: string }
>;
export declare const ULTRAS_ACTIVATION_RETRY_POLICY: RetryPolicy; // maxAttempts 5・baseDelaySeconds 60・maxDelaySeconds 3600
```

- 配送保証: 少なくとも1回。ハンドラはStripeを呼んでよい(eventの非同期の処理として動く)。ハンドラの1つが例外を投げたら全体を再試行するため、すべてのハンドラを冪等にする(4.4・4.6)。
- 解約の取り消し・支払いの失敗からの回復では知らせを作らない(4.3、`ultras_activations`は加入の有効化でだけ挿入する)。

#### UltrasEmailKinds

- 置き場所: 2種を`core/email/kinds/ultras.ts`の1ファイルに`defineEmailKind`で定め(前例`kinds/payments.ts`)、`category`はどちらも`'transactional'`(必須)。テンプレートは`apps/event/src/infrastructure/email/templates/ultras/`に`index.ts`・`*-template.ts`・`*-email-body.tsx`の形で置く。`kinds/index.unit.test.ts`に2種の名前と`category`の確認を加える(前例)。
- `ultras.payment-failed`(トランザクション、入力`{ nickname: string; planUrl: string }`)、`ultras.cancellation-accepted`(トランザクション、入力`{ nickname: string; acceptedAt: string; benefitEndsAt: string; planUrl: string }`)。日時の入力はpaymentsの前例に合わせてISO 8601の瞬時(`z.iso.datetime()`)で受け取り、テンプレートが`formatUtcDateTime`でUTCの表記にする(8.6・8.7)。種別とテンプレートは同じタスクで`EMAIL_KINDS`・`EMAIL_TEMPLATES`に加える(email-deliveryの1対1の検査)。

### backend-lib/core(契約と識別子)・workers(実装とD1の文を返す契約)

- 置き場所: api・eventのapplication層と後続specが受け取る契約(`UltrasEntitlements`・`UltrasPlanExport`・`UltrasPromotionFlagReader`・`ActivationDispatcher`・`UltrasNotifier`・各ストアの文を返さない操作)は`apps/backend-lib/core/ultras/ports.ts`、識別子`ULTRAS_TYPES`は`core/ultras/identifiers.ts`に置き、D1の実装と束縛、D1の文を返す契約(`workers/ultras/statement-contracts.ts`)は`apps/backend-lib/workers/ultras`に置く(application層は`**/lib/workers/**`を型も含めて読み込めず、DBの一括の書き込みを扱わない)。識別子は`Symbol.for('ultras.<名前>')`の凍結したオブジェクトで、`core/ultras/identifiers.unit.test.ts`で値と凍結を確かめる(`core/media/identifiers.ts`と同じ形)。`workers`だけが使う文の契約と口の実装(`UltrasOfferPolicy`・`UltrasFulfillment`・`PlanStateSink`)の識別子も同じオブジェクトに置く。apiの`API_ULTRAS_TYPES`・eventの`EVENT_ULTRAS_TYPES`とは別の識別子にし、同じ`ultras.`の接頭辞を使うため、メンバーの名前を重ねない。D1の実装は1つのクラスで文を返さない操作と文の契約の両方を実装し(`D1SubscriptionStore implements SubscriptionStore, SubscriptionStatements`など)、2つの識別子へ同じ実装を束縛する。

#### D1各ストア・UltrasPromotionFlagReader

**Contracts**: State [x]

```typescript
// core/ultras/ports.ts(2.1)
export type UltrasNoticeKind = 'payment_failed' | 'cancellation_accepted';
export interface SubscriptionRow extends SubscriptionSnapshot {
  readonly id: string;
  readonly stripeSubscriptionId: string;
  readonly userId: string;
  readonly purchaseId: string | null;
}
export interface SubscriptionStore {
  findByStripeId(
    stripeSubscriptionId: string,
  ): Promise<SubscriptionRow | undefined>;
  findEntitledOverlapping(input: {
    readonly userId: string;
    readonly at: Date;
    readonly excludeStripeId?: string;
  }): Promise<SubscriptionRow | undefined>;
  findOverlapping(input: {
    readonly userIds: readonly string[];
    readonly from: Date;
    readonly to: Date;
  }): Promise<
    readonly Pick<SubscriptionRow, 'userId' | 'startedAt' | 'benefitEndsAt'>[]
  >; // 90件ずつに分ける
  findLatestActivated(userId: string): Promise<SubscriptionRow | undefined>; // started_atの降順の先頭
  findCancellable(userId: string): Promise<readonly SubscriptionRow[]>; // 終了していないStripe側の状態の行
  markPendingCancellation(input: {
    readonly id: string;
    readonly source: 'suspension' | 'withdrawal';
  }): Promise<void>;
}
export interface ActivationStore {
  findById(id: string): Promise<UltrasActivationRow | undefined>;
  findByStripeId(
    stripeSubscriptionId: string,
  ): Promise<UltrasActivationRow | undefined>;
  markDispatched(id: string, at: Date): Promise<void>;
  markCompleted(id: string, at: Date): Promise<void>;
  findUndispatched(input: {
    readonly createdBefore: Date;
    readonly redispatchBefore: Date;
    readonly limit: number;
  }): Promise<readonly UltrasActivationRow[]>;
  deleteCompletedBefore(threshold: Date, limit: number): Promise<number>;
}
export interface NoticeStore {
  findPendingBySubscription(
    stripeSubscriptionId: string,
  ): Promise<readonly UltrasNoticeRow[]>;
  findPendingBefore(
    threshold: Date,
    limit: number,
  ): Promise<readonly UltrasNoticeRow[]>;
  markRequested(id: string, at: Date): Promise<'updated' | 'not_pending'>; // pendingのときだけ
  markSkipped(id: string, at: Date): Promise<void>;
  deleteFinishedBefore(threshold: Date, limit: number): Promise<number>;
}
export interface UltrasPromotionFlagReader {
  isEnabled(): Promise<boolean>; // 行が無ければULTRAS_PROMOTION_FLAG_DEFAULT
}

// workers/ultras/statement-contracts.ts(workers/ultrasの口の実装とeventのinfrastructure層だけが受け取る)
import type { BatchItem } from 'drizzle-orm/batch';
export interface SubscriptionStatements {
  upsertStripeState(input: {
    readonly row: SubscriptionRow;
  }): BatchItem<'sqlite'>; // sinkの列だけを更新(onConflictDoUpdate)
  activate(input: {
    readonly stripeSubscriptionId: string;
    readonly userId: string;
    readonly purchaseId: string;
    readonly startedAt: Date;
    readonly id: string;
  }): BatchItem<'sqlite'>; // 無ければ挿入(状態active)、あればstarted_at・user_id・purchase_idだけ更新
  deleteByUser(userId: string): BatchItem<'sqlite'>;
}
export interface ActivationStatements {
  insertIfAbsent(input: {
    readonly id: string;
    readonly userId: string;
    readonly stripeSubscriptionId: string;
    readonly activatedAt: Date;
  }): BatchItem<'sqlite'>; // 定期課金のIDで一意
  deleteByUser(userId: string): BatchItem<'sqlite'>;
}
export interface NoticeStatements {
  insertIfAbsent(input: {
    readonly id: string;
    readonly userId: string;
    readonly stripeSubscriptionId: string;
    readonly kind: UltrasNoticeKind;
    readonly dedupeKey: string;
    readonly payload: Readonly<Record<string, string>>;
  }): BatchItem<'sqlite'>;
  deleteByUser(userId: string): BatchItem<'sqlite'>;
}
```

- 物理削除では`ultras_notices`→`ultras_activations`→`ultras_subscriptions`の順に1つの一括の書き込みで消す(11.1)。文の組み立てと`db.batch()`の実行は、eventのinfrastructure層の`D1UltrasAccountDataEraser`が3つの`deleteByUser`の文で行う(「SubscriptionCancellationHandler・SubscriptionErasureHandler」)。
- `IN`句はバインド変数100個以内(利用者90件ずつ)に分ける。日次の削除は1回500件までを最大20回繰り返す。
- メールの宛先と宛名は本specでは読み取らず、identity-authの共有の部品`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`、api・eventの両方にidentity-authが束縛する)を`UltrasNotifier`が使う。

#### UltrasEntitlements・UltrasPlanExport

| Field        | Detail                                         |
| ------------ | ---------------------------------------------- |
| Intent       | 特典の判定と現在の加入状態・エクスポートの照会 |
| Requirements | 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 11.2        |

**Contracts**: Service [x]

```typescript
// core/ultras/ports.ts(実装はworkers/ultras/ultras-entitlements.ts・ultras-plan-export.ts)
export interface UltrasPlanView {
  readonly status: UltrasPlanStatus;
  readonly startedAt: Date;
  readonly currentPeriodEndsAt: Date | null;
  readonly benefitEndsAt: Date | null;
  readonly canceledAt: Date | null;
}
export interface UltrasEntitlements {
  isEntitledAt(userId: string, at: Date): Promise<boolean>;
  wasEntitledDuring(userId: string, from: Date, to: Date): Promise<boolean>; // 両端を含む期間との重なり
  entitledUsersAt(
    userIds: readonly string[],
    at: Date,
  ): Promise<ReadonlySet<string>>;
  entitledUsersDuring(
    userIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<ReadonlySet<string>>;
  currentPlan(userId: string, now: Date): Promise<UltrasPlanView | null>; // 最新の有効化された加入。無ければnull
}
export interface UltrasPlanExport {
  find(
    userId: string,
    now: Date,
  ): Promise<{
    readonly name: 'ultras';
    readonly status: UltrasPlanStatus;
    readonly startedAt: Date;
    readonly currentPeriodEndsAt: Date | null;
    readonly canceledAt: Date | null;
  } | null>;
}
```

- 判定は`started_at`と`benefit_ends_at`だけを使い、機能フラグを読まない(3.5)。
- `UltrasPlanExport`は本specが所有するエクスポート部品で、data-exportはこれを呼んで`plan`を作り、本specのテーブルを直接読まない(11.2)。data-export・後続specのapplication層は`core/ultras`の型と`ULTRAS_TYPES`の識別子で受け取る。
- 後続specの使い方(`backend/010`と`features/005`に記載): 加入表示と再ローンチの間隔は`isEntitledAt(userId, now)`、参加費の免除は勝利の確定時刻`w`と決済期限`d`に対し`wasEntitledDuring(userId, w, d)`(Q1。組み合わせ決定の時点でも同じ答えになる)。

#### UltrasOfferPolicy

| Field        | Detail                             |
| ------------ | ---------------------------------- |
| Intent       | 購入種別`ultras`の購入の可否と内容 |
| Requirements | 1.2, 1.3, 1.4, 1.5, 1.6, 10.6      |

- `describe({ userId, now })`: (1)`UltrasPromotionFlagReader.isEnabled()`が偽なら`unavailable`(`ultras_unavailable`、1.6)。(2)`UltrasEntitlements.currentPlan`が`canceled`なら`unavailable`(`ultras_resume_in_portal`)、`active`・`past_due`なら`unavailable`(`ultras_already_subscribed`)(1.5)。(3)`PriceCatalog.getPrices([ULTRAS_PRICE_LOOKUP_KEY])`で月額の価格を取り、`available`で`PurchaseOffer`を返す。照会の結果に`ultras_monthly`の価格が無いときは`warn`ログを残して`payments_unavailable`の`AppError`を投げる(価格の照会がStripeに届かず保持した値も無いときの失敗と同じ扱い。料金の照会`UltrasPlanReader.offer()`が`price: null`を返すのとは異なり、加入の開始は受け付けない)。利用者の状態(未確認・停止中)は`CheckoutStarter`の`requireVerifiedUser`が先に拒否する(1.4)。
- `PurchaseOffer`: `priceLookupKey: 'ultras_monthly'`、`quantity: 1`、`relatedId: null`、`exclusivityKey: null`、`deadlineAt`・`acceptUntil`・`fulfillableUntil: null`、`requiresBotVerification: false`、`summary`: `itemName`「Ultrasプラン」、`quantityLabel`「1か月(毎月自動更新)」、`serviceTiming`「決済完了後ただちに」、`additionalNotes`は文言規則の4行(毎月の更新日に自動で請求する旨と毎月の請求額、プラン管理画面からいつでも解約でき課金期間の末日まで特典が続く旨、日割りの返金が無い旨、支払い済みのトーナメント参加費は返金されない旨)(1.3・Q2)。

#### UltrasFulfillment

| Field        | Detail                                               |
| ------------ | ---------------------------------------------------- |
| Intent       | 支払いの確定での加入の有効化と、知らせの依頼待ちの行 |
| Requirements | 1.7, 1.8, 1.9, 4.1, 4.2                              |

- `prepare(purchase, db)`(`workers/payments/fulfillment-contract.ts`の`PurchaseFulfillment`。`db`の型`Database`は`workers`の中だけで読み込む): `stripeSubscriptionId`が無ければ`reject`(`ineligible`、`error`のログ)。`findEntitledOverlapping({ userId, at: purchase.paidAt, excludeStripeId })`があれば`reject`(1.8)。無ければ`fulfill`で[`SubscriptionStatements.activate`(開始時刻は`paidAt`)、`ActivationStatements.insertIfAbsent`]を返す(1.7・4.2)。
- 同時の確定(1.9): `ultras_subscriptions`の部分一意索引(`user_id`、`started_at IS NOT NULL AND benefit_ends_at IS NULL`)の違反でpaymentsの一括の書き込みが取り消され、paymentsが`prepare`を呼び直すと先に確定した加入が見つかり`reject`になる。
- `afterCommit(purchase)`(仮5): `ActivationStore.findByStripeId` → `ActivationDispatcher.dispatch`。

#### PlanStateSink

| Field        | Detail                                                           |
| ------------ | ---------------------------------------------------------------- |
| Intent       | 定期課金の状態の変化を加入へ取り込み、メールの依頼待ちを記録する |
| Requirements | 2.1〜2.12, 6.8, 7.8, 8.1〜8.4                                    |

- 登録: `SUBSCRIPTION_EVENT_SINKS`に`{ name: 'ultras-subscription.plan-state', sink: ULTRAS_TYPES.PlanStateSink }`。
- `statementsFor(change, db)`(`workers/payments/fulfillment-contract.ts`の`SubscriptionEventSink`): `change.userId`がnullなら空(2.11)。`findByStripeId`(無ければ未有効の空の値)に`applySubscriptionChange`を適用し、[`SubscriptionStatements.upsertStripeState`、通知ごとの`NoticeStatements.insertIfAbsent`]を返す。未有効の行のStripe側の値も保存し、有効化の時に使う(2.10)。古い通知はpaymentsが捨てるため、本specは届いた変化を最新として扱う。
- `afterCommit(change)`(仮5): `UltrasNotifier.sendPendingFor(change.subscriptionId)`。
- 返金・チャージバックは定期課金の変化ではないため、この口には届かない(2.12)。

#### ActivationDispatcher・UltrasNotifier

```typescript
// core/ultras/ports.ts(apiのPendingDispatchSweepJobと、workers/ultrasの口の実装が受け取る)
export interface ActivationDispatcher {
  dispatch(activationId: string): Promise<void>; // 失敗はwarnのログだけ
}
export interface UltrasNotifier {
  sendPendingFor(stripeSubscriptionId: string): Promise<void>;
  send(
    notice: UltrasNoticeRow,
  ): Promise<'requested' | 'skipped' | 'not_pending'>;
}
```

- 置き場所: 契約は`core/ultras/ports.ts`、実装は`workers/ultras/activation-dispatcher.ts`・`ultras-notifier.ts`に置き、`ULTRAS_TYPES.ActivationDispatcher`・`ULTRAS_TYPES.UltrasNotifier`へ束縛する。`MessagePublisher`(`workers`の型)を使うのは`ActivationDispatcher`の実装だけで、apiの`PendingDispatchSweepJob`(application層)は`core/ultras`の型だけを受け取る。
- `ActivationDispatcher.dispatch(activationId)`: `MessagePublisher`で`ultras.run-activation-handlers`を送り、成功したら`markDispatched`。失敗は`warn`のログだけで、4:21に送り直す(4.5)。
- `UltrasNotifier.sendPendingFor(stripeSubscriptionId)`・`send(notice)`: identity-authの`UserContactDirectory.findContact(userId)`で宛先(`email`)と宛名(`nickname`)を引き、`undefined`(退会済み・物理削除済み・存在しない)なら`markSkipped`(8.8)。あれば`EmailSender.send`(種別ごとの入力、`planUrl`は`PLATFORM_TYPES.Env`の`CLIENT_SITE_ORIGIN`に`/settings/plan`を足したURL)の成功後に`markRequested`。停止中の利用者には宛先が返り、支払いの失敗のメールを送る(8.1)。停止・退会による解約では解約の受付の確認メールの依頼を作らないため(8.4)、宛先の側で停止中を除く判定は要らない。`emailVerified`は判定に使わない(加入は確認済みの利用者に限られる、1.4)。`not_pending`なら何もしない(同じメールを2回依頼しない、8.9)。

#### UltrasPlatformModule

- `createUltrasPlatformModule(appName: 'api' | 'event'): AppModule`: 各ストア・リーダー・`UltrasEntitlements`・`UltrasPlanExport`・`UltrasOfferPolicy`・`UltrasFulfillment`・`PlanStateSink`・`ActivationDispatcher`・`UltrasNotifier`を処理単位で束縛する。apiとeventの`composition/modules.ts`の両方へ、それぞれのアプリ名で入れる(paymentsの反映が両アプリで動くため)。両アプリが使う部品はログのカテゴリのアプリ名を引数で受け取る規約(`infra/004`)に従い、`appName`をログのカテゴリの先頭に使う(前例`createPaymentsPlatformModule(appName)`)。

#### paymentsへの追加の前提(仮5・仮3、paymentsのU1・U2)

paymentsが実装を終えた契約で(2026-11-06に確認。購入の`afterCommit`は`checkout-session-reflection.ts`、定期課金のsinkの`afterCommit`は`payment-reflector.ts`、`cancelAt`は`stripe-snapshots.ts`、購入確認メールの追加事項は`purchase-notifier.ts`)、本specは使うだけである。本specのファイルには現れない。

```typescript
// paymentsのbackend-lib/workers/payments/fulfillment-contract.ts(paymentsのU1。Database・BatchItemを読み込むためworkersにあり、本specのworkers/ultrasだけが読み込む)
export interface PurchaseFulfillment {
  prepare(
    purchase: FulfillablePurchase,
    db: Database,
  ): Promise<FulfillmentPlan>;
  afterCommit?(purchase: FulfillablePurchase): Promise<void>; // fulfillの一括の書き込みが確定した後に1回。例外は呼び出し側がwarnのログにして続ける
}
export interface SubscriptionEventSink {
  statementsFor(
    change: SubscriptionChange,
    db: Database,
  ): Promise<readonly BatchItem<'sqlite'>[]>;
  afterCommit?(change: SubscriptionChange): Promise<void>;
}
// paymentsのbackend-lib/core/payments/purchase-kind-contract.ts
export interface SubscriptionChange {
  /* 既存の項目 */ readonly cancelAt: Date | null;
} // Stripeのcancel_at(柔軟な請求モードの期間末の解約)
```

- `CheckoutSessionReflection`は手順5(確定の後)で、`fulfill`を確定させた場合だけ登録の`afterCommit`を呼ぶ。`PaymentReflector`の定期課金の反映は`GuardedBatch`が`committed`のときだけ各sinkの`afterCommit`を呼ぶ。どちらも例外を`warn`のログにして反映の結果を変えない(依頼待ちの行は日次の確認で拾う)。
- `StripeSubscriptionSnapshot`に`cancelAt`(`cancel_at`の秒をDateへ)を足し、`SubscriptionChange`へ写す。`cancelSubscription(atPeriodEnd: true)`は既存のまま(`cancel_at_period_end`は非推奨だが同じ動作をする、research.md)。
- 購入確認メール(仮3): `PurchaseNotifier`の入力に購入の`summary.additionalNotes`を加え、本文の「購入の内容」の下に箇条書きで載せる(Ultras以外の購入は空で、見出しを出さない)。

### api

#### UltrasPlanReader・UltrasCheckout

- `UltrasPlanReader.offer()`: `{ promotionEnabled: UltrasPromotionFlagReader.isEnabled(), price, priceStale }`(1.2・9.2・9.7)。ログイン不要。`price`・`priceStale`は`PriceCatalog.getPrices(['ultras_monthly'])`の結果から作る。`getPrices`は保存した値が無くStripeにも届かないと`AppError(unavailable, payments_unavailable)`を投げるため、その例外だけを捕まえて`price: null`・`priceStale: false`を返し、他の例外は投げ直す(料金ページは特典と「価格を表示できない」案内を出し、フラグの値も同じ照会で返せる)。
- `UltrasPlanReader.viewer(session)`: `AccountGuard.currentUser`が無ければnull。あれば`{ plan: UltrasEntitlements.currentPlan(userId, now), entitled: isEntitledAt(userId, now), canOpenPortal: plan !== null }`(3.6・5.1〜5.5・9.3)。
- `UltrasCheckout.start(session: SessionView)`: `CheckoutStarter.start({ session, kind: 'ultras', targetId: null })`(1.1)。解決関数が`GraphQLContext`から`session`を取り出して渡し、application層は`GraphQLContext`を受け取らない(Ultrasはbot判定を求めないため`humanCheck`を渡さない)。`describe`の`unavailable`は`AppError(unprocessable, <code>)`として返る。

#### PortalSessionStarter・PortalSessionLimits

- `start(session)`: `AccountGuard.requireWritableUser`(停止中は`account_unavailable`、6.5) → `PortalSessionLimits.consume`(規則`ultras-portal:user`、20回/3600秒、`hashRateLimitKey`、超過は`rate_limit_exceeded`、6.6) → `SubscriptionStore.findLatestActivated`と`CustomerDirectory.findCustomerId`のどちらかが無ければ`AppError(unprocessable, ultras_portal_unavailable)`(6.5) → `StripeGateway.createPortalSession({ customerId, returnUrl: CLIENT_SITE_ORIGIN + '/settings/plan?portal=returned' })` → `{ url }`(6.2)。`StripeUnavailableError`(`core/payments`)は`AppError(unavailable, payments_unavailable)`(6.7)。

```typescript
// api/src/application/ultras/portal-ports.ts
export interface PortalSessionLimits {
  consume(userId: string, now: Date): Promise<void>; // 超過はAppError(rate_limited, rate_limit_exceeded, retryAfterSeconds)
}
// api/src/infrastructure/ultras/counter-portal-session-limits.ts
export declare class CounterPortalSessionLimits implements PortalSessionLimits {
  constructor(
    counter: RateLimitCounterClient, // @inject(PLATFORM_TYPES.RateLimitCounterClient)
    hasher: KeyedHasher, // @inject(PLATFORM_TYPES.KeyedHasher)
  ); // 規則ultras-portal:user(20回/3600秒)
}
```

- 置き場所: ポート`PortalSessionLimits`はapplication層、実装`CounterPortalSessionLimits`はinfrastructure層に置く。厳密カウンタのクライアント`RateLimitCounterClient`の型と`assertWithinLimit`が共通ライブラリの`workers`にあり、application層は読み込めないため(`backend/003`の「厳密カウンタを使うクラスはインフラ層に置く」)。`API_ULTRAS_TYPES.PortalSessionLimits`を`CounterPortalSessionLimits`へ束縛する。`PortalSessionStarter`は`SubscriptionStore`を`core/ultras`、`StripeGateway`・`CustomerDirectory`を`core/payments`の型と識別子で受け取り、`**/lib/workers/**`を読み込まない。

#### PromotionSettingService・D1PromotionSettingWriter

- 認可: 解決関数がpresentation層の`requireAdmin(context, 'viewer')`(照会)・`requireAdmin(context, 'super_admin')`(変更。不足は`forbidden`、10.3)を呼び、変更では管理者のIDをユースケースへ渡す(前例`modules/legal/admin-resolvers.ts`)。application層は`requireAdmin`と`GraphQLContext`を読み込まない(`config/eslint/backend-layers.ts`)。
- `read()`: `{ enabled, version, updatedAt, updatedByNickname }`(`AdminDirectory.findProfiles`、削除済みはnull)(10.1)。
- `update({ adminId, enabled, expectedVersion, reason })`: `AuditLogRecorder.prepare({ operatorAdminId: adminId, action: 'ultras-promotion.update', targetIds: [settingId], reason, detail: { enabled: String(enabled) }, occurredAt: clock.now() })`(admin-foundationの`AuditEntryInput`。対象の種類は操作種別の定義の`targetKind: 'setting'`で決まる。`reason`は空なら省く) → `D1PromotionSettingWriter.write`(10.2)。
- `write`: 1つの一括の書き込みで、(1)`buildAuditLogStatements(db, audit, { kind: 'condition', condition: EXISTS (SELECT 1 FROM ultras_settings WHERE setting_key = ? AND version = ?) })`の文を先頭に置き、(2)`UPDATE ultras_settings SET enabled = ?, version = version + 1, updated_by_admin_id = ?, updated_at = ? WHERE setting_key = ? AND version = ?`を続ける。版が一致しなければ監査ログの行の挿入が取り消しの条件に当たり、一括の書き込み全体が取り消される(inquiry-chatの`d1-inquiry-category-store.ts`と同じ方式、`db/002`の「版の検査で一括の書き込み全体を取り消す」)。失敗は`isAuditGuardRejection`で判定して`AppError(conflict, version_conflict)`に変え、他の失敗は投げ直す(10.4)。主キーへNULLを入れる照合の文は使わない(`ulidPrimaryKey()`はNOT NULLを付けず、SQLiteは整数でない主キーにNULLを許すため、違反にならない)。

#### PendingDispatchSweepJob

| ジョブの名前                                 | 業務時刻 | `order` | 処理                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ultras-subscription.pending-dispatch-sweep` | 4:21     | 500     | (1)`completed_at`が空で、`dispatched_at`が空かつ作成から10分以上、または`dispatched_at`から24時間以上の知らせを最大100件`dispatch`(4.5)。(2)`pending`のまま10分以上のメールの依頼を最大100件`send`(8.9)。(3)完了から30日以上の知らせと、`requested`・`skipped`から30日以上のメールの依頼を1回500件・最大20回削除(11.3) |

- Trigger: apiのCron Triggers(`21 12 * * *`、既存)。`order` 500は上流の100〜120・200・210・300・400・410・810〜830・900・2300と重ならない。日次タイムラインの表に載せる。
- 再送された知らせは、ハンドラの冪等性で結果が変わらない。
- 依存: ジョブはapplication層に置き、`ActivationDispatcher`・`UltrasNotifier`・`ActivationStore`・`NoticeStore`を`core/ultras`の型と`ULTRAS_TYPES`の識別子で受け取る。`**/lib/workers/**`を読み込まず、D1の文を扱わない(削除は`deleteCompletedBefore`・`deleteFinishedBefore`)。

#### UltrasSchemaModule

**Contracts**: API [x]

```graphql
enum UltrasPlanStatus {
  ACTIVE
  PAST_DUE
  CANCELED
  ENDED
}
type UltrasOffer {
  promotionEnabled: Boolean!
  price: Money
  priceStale: Boolean!
}
type UltrasPlan {
  status: UltrasPlanStatus!
  startedAt: DateTime!
  currentPeriodEndsAt: DateTime
  benefitEndsAt: DateTime
  canceledAt: DateTime
}
type ViewerUltras {
  plan: UltrasPlan
  entitled: Boolean!
  canOpenPortal: Boolean!
}
type UltrasPortalSession {
  url: String!
}
type UltrasPromotionSetting {
  enabled: Boolean!
  version: Int!
  updatedAt: DateTime
  updatedByNickname: String
}
input UpdateUltrasPromotionSettingInput {
  enabled: Boolean!
  expectedVersion: Int!
  reason: String
}
type Query {
  ultrasOffer: UltrasOffer!
  viewerUltras: ViewerUltras
  ultrasPromotionSetting: UltrasPromotionSetting!
}
type Mutation {
  startUltrasCheckout: CheckoutStart!
  createUltrasPortalSession: UltrasPortalSession!
  updateUltrasPromotionSetting(
    input: UpdateUltrasPromotionSettingInput!
  ): UltrasPromotionSetting!
}
```

| 操作                           | 呼び出し元           | エラー                                                                                                                                                                                      |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ultrasOffer`                  | client(ログイン不要) | —                                                                                                                                                                                           |
| `viewerUltras`                 | client               | — (未ログインはnull)                                                                                                                                                                        |
| `startUltrasCheckout`          | client               | `unauthenticated`・`email_not_verified`・`account_unavailable`・`ultras_unavailable`・`ultras_already_subscribed`・`ultras_resume_in_portal`・`rate_limit_exceeded`・`payments_unavailable` |
| `createUltrasPortalSession`    | client               | `unauthenticated`・`account_unavailable`・`ultras_portal_unavailable`・`rate_limit_exceeded`・`payments_unavailable`                                                                        |
| `ultrasPromotionSetting`       | admin                | `unauthenticated`・`forbidden`                                                                                                                                                              |
| `updateUltrasPromotionSetting` | admin                | `unauthenticated`・`forbidden`・`validation_error`(理由は500書記素以内)・`version_conflict`                                                                                                 |

- 管理者側の操作は解決関数の`requireAdmin`で`caller`が`admin`でなければ拒否し、利用者側の操作は`caller`が`client`のときだけ受け付ける(paymentsの`clientOnly`と同じ形)。認可と`session`の取り出しは解決関数で行い、ユースケースへは管理者のID・`SessionView`だけを渡す。

### event

#### RunActivationHandlersHandler

- Subscribed: `ultras.run-activation-handlers`(`{ activationId }`)。`retry`: `ULTRAS_ACTIVATION_RETRY_POLICY`。
- 処理: 行が無い・`completed_at`があれば何もしない。`createUltrasActivationRegistry(ULTRAS_ACTIVATION_HANDLERS)`の順に各ハンドラの`handle`を呼び、すべて成功したら`markCompleted`。例外は再試行し、上限でデッドレターからSentryへ通知される(4.1・4.4)。初版の`ULTRAS_ACTIVATION_HANDLERS`は空で、tournament-week・tournament-yearが追記する(`order`は100以上を各spec、本specは使わない)。

#### SubscriptionCancellationHandler・SubscriptionErasureHandler

| 名前                                            | イベント                 | `order` | 処理                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ultras-subscription.subscription-cancellation` | `withdrawn`・`suspended` | 500     | `findCancellable`の行ごとに、`withdrawn`なら`markPendingCancellation('withdrawal')` → `cancelSubscription(atPeriodEnd: false)`、`suspended`なら予約が無い行だけ`markPendingCancellation('suspension')` → `cancelSubscription(atPeriodEnd: true)`。`already_canceled`は成功扱い(7.1〜7.3・7.5・7.7) |
| `ultras-subscription.subscription-erasure`      | `purge_due`              | 500     | `UltrasAccountDataEraser.erase`で`ultras_notices`・`ultras_activations`・`ultras_subscriptions`の利用者の行を1つの一括の書き込みで削除(11.1)                                                                                                                                                       |

```typescript
// event/src/application/ultras/ultras-account-data-eraser.ts
export interface UltrasAccountDataEraser {
  erase(userId: string): Promise<void>; // ultras_notices→ultras_activations→ultras_subscriptionsの順に並べた削除を1回の一括の書き込みで確定する。3表は互いを参照せずusersだけを参照するため順序は正しさに効かず、利用者の行の物理削除が外部キー違反で失敗しないことが目的
}
// event/src/infrastructure/ultras/d1-ultras-account-data-eraser.ts
export declare class D1UltrasAccountDataEraser implements UltrasAccountDataEraser {
  constructor(
    db: Database, // @inject(PLATFORM_TYPES.Database)
    notices: NoticeStatements, // @inject(ULTRAS_TYPES.NoticeStatements)
    activations: ActivationStatements, // @inject(ULTRAS_TYPES.ActivationStatements)
    subscriptions: SubscriptionStatements, // @inject(ULTRAS_TYPES.SubscriptionStatements)
  );
}
```

- 置き場所: 2つの波及処理はapplication層に置き、`SubscriptionStore`(`findCancellable`・`markPendingCancellation`)を`core/ultras`、`StripeGateway`を`core/payments`の型と識別子で、削除の書き込みの単位をポート`UltrasAccountDataEraser`(`EVENT_ULTRAS_TYPES.UltrasAccountDataEraser`)で受け取る。D1の文の組み立てと`db.batch()`の実行はinfrastructure層の`D1UltrasAccountDataEraser`が行う(application層はDBの一括の書き込みを扱わない)。
- `cancelSubscription`の例外は、一時的な障害の`StripeUnavailableError`・恒久的な拒否の`StripeRejectedError`・対象が無い`StripeNotFoundError`のいずれも捕まえずに投げ、identity-authの`USER_LIFECYCLE_RETRY_POLICY`の再試行に任せる(上限でSentry、7.6)。恒久的な失敗は上限まで繰り返した後に波及処理の失敗として扱われ、運用者はその通知を受けてStripeのダッシュボードで解約する(`operations/004`の定期課金の節)。`markPendingCancellation`と`already_canceled`の扱いにより、再試行で同じ結果になる。停止の解除には登録しない(7.4)。
- `order` 500は本specの500番台(4:21のジョブと同じ帯)。`withdrawn`・`suspended`ではpaymentsの`payments.open-checkout-expiry`(410)の後に動き、未完了のUltrasの決済セッションの失効を先に済ませる。`purge_due`ではinquiry-chat(300)・paymentsの`payments.customer-erasure`(400)の後に動く。

#### UltrasEmailTemplates

- `payment-failed-template.ts`: 件名「Ultrasの支払いに失敗しました」、本文は支払いに失敗した旨・再試行の間は特典が続く旨・再試行がすべて失敗すると特典が終了する旨・プラン管理画面で支払い方法を更新するよう促す導線(8.1)。
- `cancellation-accepted-template.ts`: 件名「Ultrasの解約を受け付けました」、本文は受け付けた日時(UTC)・特典の終了日時(UTC)・それまで特典が続く旨・プラン管理画面から解約を取り消せる旨(8.3・8.7)。

### client

- 操作はclient・adminの`src/graphql/operations/ultras/`に1ファイル1操作の`.graphql`で書き、`graphql()`を呼ばない。操作名はclientが`Client`、adminが`Admin`で始め(File Structure Plan)、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`と生成された型を読み、`gql.ts`・`index.ts`を読まない(frontend-platformの「操作の追加手順」)。

#### PricingPage・PricingSections・UltrasPricingSection・UltrasBenefitList・UltrasSubscribeButton

```typescript
export interface PricingSection {
  readonly id: string; // '<spec名>.<名詞句>'
  readonly order: number;
  readonly title: string; // 区画の見出し。部品が描く見出しと同じ文言にする
  readonly component: ComponentType; // 自分でデータを取得し、自分の見出しを描く
}
export declare const PRICING_SECTIONS: readonly PricingSection[]; // 初版は ultras-subscription.ultras-pricing(10、「Ultras」)。sponsorshipが sponsorship.sponsorship-pricing(20、「スポンサー広告」)を追記
```

- 登録口の形は、adminの前例に合わせる(`id`の形は`CATEGORY_SECTIONS`・`DASHBOARD_CARDS`、`title`と読み込み中・失敗の間の見出しの補いは`CATEGORY_SECTIONS`)。
- `/pricing`(ログイン不要、`buildSitePageHead`でタイトル「料金」と説明`description`、9.8。説明を出すため、frontend-libの`PageHeadInput`に省略可能な`description`を加える、上流への影響): `PricingPage`が`PRICING_SECTIONS`を`order`順に並べ、各区画をfrontend-libの`RecoverableSlot`(`contactAvailable`は`CLIENT_PROFILE.contactAvailable`)で包み、1つの区画の描画や取得の失敗をその区画の位置に留めて他の区画の表示を続ける。読み込み中と失敗の間は、区画の`title`の見出しを`frame`で補う(前例`CategorySectionsView`)。末尾に法的通知(`/legal`)へのリンクを置く(9.1)。区画が1つも表示されないときもリンクは出す。
- `UltrasPricingSection`: `ultrasOffer`と`viewerUltras`を`useSuspenseQueries`で並列に取得し(TanStack Query v5の`useSuspenseQueries`は`data`が無いときだけ境界へ投げるため、最初の取得の失敗は`RecoverableSlot`の境界へ届き、取り直しの失敗では表示中の値が残る)、`promotionEnabled`が偽かつ`entitled`が偽なら何も描画しない(9.6)。描画するときは価格の行`UltrasPriceLine`(`MoneyText`、取得できなければ「現在表示できません」をidを付けて描く、9.7)・`UltrasBenefitList`(「特典」と「自動更新と解約」の4文の両方を常に描く。価格が無いときの1文目は`common-lib/ultras/checkout-notes.ts`の金額を差し込まない文)・`entitled`なら現在の加入状態と`/settings/plan`への`Link`、そうでなければ`UltrasSubscribeButton`(9.2・9.3)。
- `UltrasSubscribeButton`(props `{ viewer, priceAvailable, returnTo = '/pricing', priceUnavailableReasonId? }`): 未ログインはログインへの導線(`LoginRequiredDialog`、戻り先`/pricing`、9.4)、未確認は`disabled`にして理由を`aria-describedby`で結び付ける(9.5)、価格が無いときは`disabled`にして呼び出し側が描く「現在表示できません」のidを`priceUnavailableReasonId`で結び付ける(9.7。未ログインかつ価格なしはダイアログを開かずに無効)、送信中だけ`aria-disabled`と`aria-busy`(`004-accessibility-rules.md`の「操作できない状態」)。押下で`startUltrasCheckout` → `/checkout/{購入ID}`へ遷移(1.1)。エラーはAPIサーバーが返した`GraphQLClientError`の文言をそのまま`role="alert"`で出す。停止中・退会済みは画面で無効にせず、サーバーの拒否の文言を出す(1.4)。

#### PlanPage・PlanStatusPanel・PortalButton・PortalReturnNotice

- `/_authenticated/settings/plan`(ログイン必須、未ログインは`_authenticated`のレイアウトがログインへ誘導、5.9): `validateSearch`(`plan-search.ts`の`toPlanSearch`。`portal=returned`だけを受け、他は`undefined`にする)、`loader`(`graphql/ultras.ts`の`loadPlanPage`。`ultrasOffer`と`viewerUltras`を`Promise.all`で先に取得し、失敗は例外にせずキャッシュに残す。前例`/settings/billing`)で、`SettingsShell`の中に`PlanPage`(`portalReturned`をpropsで受ける)。`PlanPage`は`RecoverableSlot`で包み、題名「プラン」を枠として読み込み中と失敗の間も残す(002の「題名を残したまま再試行」)。`SETTINGS_NAV_ITEMS`に「プラン」(order 60、5.8)。経路の配線(検索パラメータ・head・ナビゲーション・未ログインの誘導)は`test/plan-route.browser.test.tsx`で確かめる。
- `PlanStatusPanel`: 状態ごとの表示(5.2〜5.5)。日時は`DateTime`(`<time datetime>`、閲覧者のタイムゾーン、5.6)。特典の一覧(`UltrasBenefitList`)は`active`だけに描く(002のプラン管理画面の表)。未加入・`ended`で`promotionEnabled`が真なら価格の行`UltrasPriceLine`と加入の導線(`UltrasSubscribeButton`、戻り先`/settings/plan`。価格が無いときの無効の理由を価格の行に結び付ける)、偽なら「現在、新規の加入を受け付けていません」。
- `PortalButton`(`canOpenPortal`のときだけ、6.1): ラベル「解約・支払い方法の管理」、送信中は「送信中」。押下で`createUltrasPortalSession` → 得たURLへブラウザの遷移で移る(省略可能なprops`navigateTo`、既定は`window.location.assign`。テストの継ぎ目)(6.2)。Customer Portalから「戻る」でbfcacheから復元されると移動の成功の状態が残るため、`pageshow`の`persisted`で変更の状態を`reset()`して押せる状態に戻す。`payments_unavailable`は`UnavailableNotice`(6.7。必須の`reason`には文言規則の「Customer Portalを現在利用できない」理由を渡す。前例paymentsの`PAYMENTS_UNAVAILABLE_REASON`)、`rate_limit_exceeded`は文言規則の文言。
- `/settings/plan`のheadは`buildSitePageHead`で`noIndex: true`にする(前例`/settings/billing`)。
- `PortalReturnNotice`: 検索パラメーター`portal=returned`のとき、`role="status"`で「変更を反映しています」を表示し、`viewerUltras`の照会を5秒ごとに最大12回取得し直す(TanStack Queryの`refetchInterval`を関数にし、取り直した回数が12回に達したら`false`を返す。回数は`queryClient.getQueryState`の`dataUpdateCount + errorUpdateCount`のマウント時からの差で数え(`UseQueryResult`は`dataUpdateCount`を持たない)、失敗した取り直しも数えて上限で止める。間隔と上限は`portal-return-rules.ts`)(5.7)。反映が済んだかどうかは判定しない(Portalで何も変えずに戻った場合と区別できないため)。12回を終えたら、同じ`role="status"`の表示を「反映に時間がかかっています。しばらくしてからこのページを開き直してください。」に切り替える。取り直しは`viewerUltras`の照会だけに重ね、ページの他の取得に広げない。「自動更新」の`Switch`は置かない(戻った直後の一時的な取り直しで、利用者が見続ける画面ではないため)。この使い方は`010-live-refresh-queries.md`の「使う場面」に「外部サービスでの操作から戻った直後に、遅れて反映される閲覧者自身のデータ」の行として加える。反映は6.8どおりWebhookだけで行い、画面から確定の変更を呼ばない。

#### UltrasPromotionGate

```typescript
export interface UltrasPromotionGateProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}
```

- `ultrasOffer.promotionEnabled`が真のときだけ`children`を描画する。後続specの画面(トーナメント参加費の画面のUltrasの案内など)は、未加入者への導線をこの部品で包む(10.6・10.8)。読み込み中とエラーのときは描画しない(導線を出し過ぎない側に倒す)。

### admin

#### AdminSettingsPage・AdminSettingsSections・PromotionSettingSection

```typescript
export interface AdminSettingsSection {
  readonly id: string; // '<spec名>.<名詞句>'
  readonly order: number;
  readonly title: string; // 区画の見出し。部品が描く見出しと同じ文言にする
  readonly component: ComponentType; // 自分でデータを取得し、自分の見出しを描く
}
export declare const ADMIN_SETTINGS_SECTIONS: readonly AdminSettingsSection[]; // 初版は ultras-subscription.promotion-flag(20、「Ultras導線の機能フラグ」)。tournament-yearが tournament-year.final-date(10、「Yearトーナメントの決勝実施日」)、notificationsが notifications.sender-info(30、「通知メールの送信者情報」)を追記
```

- 登録口の形は、adminの前例に合わせる(`id`の形は`CATEGORY_SECTIONS`・`DASHBOARD_CARDS`、`title`と読み込み中・失敗の間の見出しの補いは`CATEGORY_SECTIONS`)。
- `/_authenticated/settings/index.tsx`: `components/pages/admin-settings-page.tsx`(前例`components/pages/*-page.tsx`)が`AdminPageHeader`「設定」と説明「機能ごとの設定を確認・変更します。」(`components/settings/settings-messages.ts`)を描き、`components/settings/admin-settings-sections-view.tsx`の`AdminSettingsSectionsView`が`ADMIN_SETTINGS_SECTIONS`を`order`順に並べる(10.9)。各区画をfrontend-libの`RecoverableSlot`(`contactAvailable`は`ADMIN_PROFILE.contactAvailable`)で包み、読み込み中と失敗の間は区画の`title`の見出しを`frame`で補う(枠は`components/layout/section-fallback.tsx`の`SectionFallback`で、`CategorySectionsView`と共用)。`ADMIN_NAV_ITEMS`に`{ to: '/settings', label: '設定', order: 130 }`(メニューの完全一致のテストは`admin-nav-order.unit.test.ts`・`test/admin-shell.browser.test.tsx`・`components/layout/admin-navigation.browser.test.tsx`の3本)。
- `PromotionSettingSection`: `useQuery`と`throwOnError`(`data`が無いときだけ)で取得し(前例`InquiryCategorySection`。最初の読み込み中は区画自身が見出しと`LoadingSkeleton`を描く)、現在の値・最後に変更した日時(`DateTime`。初期行の`version === 0`では「なし」)と管理者のニックネーム(nullなら「なし」。削除済みの管理者の変更は日時を残して管理者だけ「なし」)を表示する(10.1)。`hasRole(useAdminRole(), 'super_admin')`(`common-lib/admin/admin-roles.ts`)のときだけスイッチを有効にし(`RoleGate`は表示するかしないかの出し分けの部品のため、有効・無効には使わない)、それ以外は`disabled`のスイッチに「最上位管理者だけが変更できます」を`aria-describedby`で結び付けて参照だけにする(10.3。`009-admin-console-shell.md`の「権限の無い操作」)。切り替えは`ConfirmActionDialog`(`reason: 'optional'`・`audited: true`・`failureMessageOf`)で確定し、スイッチは確定前に切り替わらない(10.2)。確定は`{ enabled, expectedVersion, reason }`を送り、成功で表示を新しい値に置き換えてトーストを出す。切り替えの失敗は、部品が理由の入力を保ったままダイアログの中に`failureMessageOf(error)`の文言を`role="alert"`で示す。`failureMessageOf`は`version_conflict`なら最新を読み直す案内(10.4。照会を無効化して最新を読み直す)を、それ以外は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`を返す。説明文に「オフにすると未加入者への導線と新規加入を止めます。加入中の利用者には影響しません」(10.7)。
- 失敗の表示(管理者側は問い合わせの画面を持たない): `PromotionSettingSection`の取得の失敗は、区画を包む`RecoverableSlot`が区画の位置に見出しと`ErrorState`(再試行)で示して縮退し、`contactHref`を渡さない。`GraphQLClientError`でない例外に代えて出す文言(`ErrorState`・`ConfirmActionDialog`の`failureMessageOf`・トースト)は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`で選び、問い合わせを促す文を出さない。

## Data Models

### Domain Model

- **加入(UltrasSubscription)**: Stripeの定期課金1件に対応する集約。Stripe側の値(状態・予約・予定時刻・課金期間の終了・終了の時刻)と、本サービスの値(開始時刻・特典の終了時刻・解約の操作の時刻と出どころ)を持つ。加入状態は保存せず導く。
- **特典の継続期間**: `[started_at, benefit_ends_at)`。`benefit_ends_at`が空なら右に開く。終了の状態で決めた値は変わらない。
- **加入が有効になった知らせ(UltrasActivation)**: 加入1件に1つ。`dispatched_at`→`completed_at`。
- **メールの依頼(UltrasNotice)**: `dedupe_key`で一意。`pending`→`requested`・`skipped`。
- **機能フラグ(UltrasSetting)**: 鍵ごとに1行。版で競合を検出する。
- **不変条件**: 利用者ごとに、特典の継続期間が右に開いた有効な加入は高々1つ。

### Physical Data Model

すべて`snake_case`、日時はエポックミリ秒の整数、IDはULID(`ulidPrimaryKey()`)、`timestamps()`を持つ。

**`ultras_subscriptions`**

| 列                                                   | 型      | 制約・説明                             |
| ---------------------------------------------------- | ------- | -------------------------------------- |
| `id`                                                 | text    | 主キー                                 |
| `stripe_subscription_id`                             | text    | NOT NULL、一意                         |
| `user_id`                                            | text    | NOT NULL、`users.id`への外部キー       |
| `purchase_id`                                        | text    | NULL可(paymentsの購入ID、外部キー無し) |
| `stripe_status`                                      | text    | NOT NULL                               |
| `cancel_scheduled`                                   | integer | NOT NULL、0・1                         |
| `cancel_at`・`current_period_end`・`ended_at`        | integer | NULL可                                 |
| `started_at`                                         | integer | NULL可(有効化の時刻)                   |
| `benefit_ends_at`                                    | integer | NULL可                                 |
| `benefit_end_fixed`                                  | integer | NOT NULL、0・1                         |
| `canceled_at`                                        | integer | NULL可                                 |
| `cancellation_source`・`pending_cancellation_source` | text    | NULL可                                 |
| `past_due_since`                                     | integer | NULL可                                 |

索引: `(user_id, started_at)`、部分一意`(user_id) WHERE started_at IS NOT NULL AND benefit_ends_at IS NULL`、`(stripe_status)`。

**`ultras_activations`**: `id`(主キー)・`user_id`(外部キー)・`stripe_subscription_id`(一意)・`activated_at`・`dispatched_at`(NULL可)・`completed_at`(NULL可)。索引`(completed_at, dispatched_at, created_at)`(`findUndispatched`が作成からの経過も条件にするため)。

**`ultras_notices`**: `id`(主キー)・`user_id`(外部キー)・`stripe_subscription_id`(索引)・`kind`(`payment_failed`・`cancellation_accepted`)・`dedupe_key`(一意)・`payload_json`・`status`(`pending`・`requested`・`skipped`)・`finished_at`(NULL可)。索引`(status, created_at)`。

**`ultras_settings`**: `id`(主キー)・`setting_key`(一意)・`enabled`(0・1)・`version`(整数、変更のたびに1つ進め、版の照合に使う)・`updated_by_admin_id`(NULL可、外部キー無し。管理者の物理削除で消えないため)。`_seed`のカスタムマイグレーションで`ultras_promotion`の行(`enabled = 0`・`version = 0`、IDは固定のULIDで`created_at`・`updated_at`はその時刻部)を`ON CONFLICT (setting_key) DO NOTHING`で挿入する(仮2)。

### Data Contracts & Integration

- データエクスポートの`plan`: `name`(`ultras`)・`status`・`startedAt`・`currentPeriodEndsAt`・`canceledAt`を、最新の有効化された加入から作る(11.2)。データエクスポートの文書の形を変えない。
- メッセージ`ultras.run-activation-handlers`: `{ activationId: string }`(ULID)、封筒はbackend-platformの`QueueEnvelope`。
- Stripeのメタデータは本specでは付けない(paymentsが購入ID・購入種別・仮名化IDを定期課金に付ける)。

## Error Handling

### Error Strategy

- 利用者の操作の失敗は`AppError`で返し、画面が`extensions.code`で出し分ける。Stripeの一時的な障害は`payments_unavailable`として縮退の案内を出す。
- 口の実装(`prepare`・`statementsFor`)の例外はpaymentsの反映の一時的な失敗として扱われ、Webhookの再送などで再試行される。
- 外部への副作用(知らせ・メール)は依頼待ちの行を先に確定し、送り出しの失敗は4:21の日次の確認で拾う。

### Error Categories and Responses

| コード                                                                                                  | 種類                    | 場面                            | 文言(文言規則に追加)                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ultras_unavailable`                                                                                    | 422                     | フラグがオフの加入(1.6)         | 「現在、Ultrasの新規の加入を受け付けていません。」                                                                     |
| `ultras_already_subscribed`                                                                             | 422                     | 加入中の加入(1.5)               | 「既にUltrasに加入しています。」                                                                                       |
| `ultras_resume_in_portal`                                                                               | 422                     | 解約済みで継続期間内の加入(1.5) | 「解約済みのUltrasは課金期間の末日まで有効です。継続するには「解約・支払い方法の管理」から解約を取り消してください。」 |
| `ultras_portal_unavailable`                                                                             | 422                     | 加入したことが無い(6.5)         | 「Ultrasに加入したことが無いため、管理画面を開けません。」                                                             |
| `version_conflict`                                                                                      | 409                     | フラグの競合(10.4)              | 「他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。」                                       |
| `payments_unavailable`・`rate_limit_exceeded`・`email_not_verified`・`account_unavailable`・`forbidden` | 503・429・403・403・403 | 既存                            | 既存の文言                                                                                                             |

### Monitoring

- `getAppLogger(['api'|'event', 'application', 'ultras'])`で、加入のID・定期課金のID・知らせのID・ジョブの件数だけを記録する(12.3)。メールアドレスとニックネームは記録しない。
- Sentry: 知らせの処理のデッドレター(backend-platformの既定)、解約の再試行の上限(identity-authの既定)、`unpaid`・`paused`の受信と`stripeSubscriptionId`の無い購入(`captureEvent`。定型の文言を`logentry`、種類を`fingerprint`に置く。`infra/004`の「同じ文言を繰り返し送る通知」)。

## Testing Strategy

- Unit Tests(Bun、`*.unit.test.ts`):
  - `entitlement-rules`: `endOfBusinessDayContaining`・`benefitEndForScheduledEnd`の境界(業務日付の0:00ちょうど・0:00の1ミリ秒後・23:59:59.999)、`derivePlanStatus`の4状態と未有効、`isEntitledAt`の左端を含み右端を含まないこと、`overlapsPeriod`の両端(2.2〜2.9、3.1・3.2)。
  - `subscription-transition`: 予約→終了の猶予(Q4)、支払いの失敗→終了の即時、即時の解約、予約の取り消し、`cancelAt`だけの予約(柔軟な請求モード)、`benefitEndFixed`の後に届いた変化で値が変わらないこと、有効化の前の変化の保存、`past_due`の通知の1回だけ、解約の受付の通知が`user`のときだけ(2.1〜2.10、3.4、8.1〜8.5)。
  - `activation-contract`: 名前の形式・重複・`order`の重複の拒否と昇順(4.1)。
  - `core/ultras/identifiers`: `ULTRAS_TYPES`の各値が`Symbol.for('ultras.<名前>')`であり、オブジェクトが凍結されていること。
  - api・eventのユースケース(`core/ultras`・`core/payments`の契約の偽物と、偽の`PortalSessionLimits`・`UltrasAccountDataEraser`): `UltrasOfferPolicy`の拒否の順序(フラグ→加入中→解約済み)と追加事項の4行、`PortalSessionStarter`の拒否と戻り先、`PromotionSettingService`のロールと監査ログの準備、`SubscriptionCancellationHandler`の退会と停止の出し分け・予約済みの停止の無処理・`already_canceled`・`StripeUnavailableError`・`StripeRejectedError`・`StripeNotFoundError`をいずれも投げること、`UltrasPlanReader.offer`が`payments_unavailable`だけを`price: null`にし他の例外を投げ直すこと、`UltrasCheckout`・`PromotionSettingService`が`GraphQLContext`を受け取らないこと、`RunActivationHandlersHandler`の順序と完了済みの無処理、ジョブの3つの処理(1.3〜1.6、6.2・6.5・6.6、7.1〜7.7、10.2・10.3、4.1・4.5、11.3)。
- Integration Tests(Vitestのworkerd、`*.worker.test.ts`、Stripeは模擬の`StripeGateway`):
  - paymentsの反映を通した加入: `ultras`の決済セッションの完了で加入が有効になり、知らせの行が1つでき、`afterCommit`でメッセージが送られる。Webhookと`return_url`の同時の反映でも知らせは1つ(1.7・4.1・4.2)。
  - 二重の加入: 継続期間内の利用者の2つ目の加入が拒否され、paymentsの返金の依頼ができる。同時の2つの確定で1つだけが有効になる(1.8・1.9)。
  - sinkの順序: `customer.subscription.updated`が有効化の前に届いても、有効化の後の加入状態に反映される。古い通知はpaymentsが捨てる(2.10)。
  - 特典の判定: 過去の時点・期間・90件を超える一括の判定(3.1〜3.4)。
  - フラグの変更: 版の照合の失敗で設定と監査ログのどちらも変わらない。成功で両方が確定する(10.2・10.4)。
  - ライフサイクル: `purge_due`で`D1UltrasAccountDataEraser`が3テーブルの行を1回の一括の書き込みで消す。`withdrawn`・`suspended`で解約が呼ばれる(7.1・7.2・11.1)。
  - メール: `past_due`への変化で`ultras.payment-failed`が1回だけ依頼され、テンプレートが日本語の件名と本文・UTCの日時を描画する。退会済みの利用者は`skipped`(8.1・8.2・8.6〜8.8)。
  - 回数制限: `CounterPortalSessionLimits`でPortalの21回目が`rate_limit_exceeded`(6.6)。
- E2E/UI Tests:
  - ブラウザテスト(`*.browser.test.tsx`、`runAxe`の違反0件): `UltrasPricingSection`のフラグと加入状態による出し分け・価格が無いとき、`UltrasSubscribeButton`の未ログイン・未確認・押下、`PlanStatusPanel`の4状態と未加入、`PortalReturnNotice`の確かめ直し(5秒ごとに12回で止まり、開き直しの案内に切り替わる。偽のタイマーで進める)、`PricingPage`・`AdminSettingsPage`で1つの区画の取得が失敗しても、その区画の位置に見出しと再試行が出て他の区画と法的通知へのリンクが表示され続けること、`RecoverableSlot`の`contactAvailable`による文言の出し分け、`UltrasPromotionGate`、`PromotionSettingSection`のロールによる参照だけと確認のダイアログ・競合(1.1、5.2〜5.7、9.2〜9.7、10.1〜10.4)。
  - E2E(`e2e/client/ultras.e2e.test.ts`): 各テストの直前に、admin-foundationの`e2e/support/local-d1.ts`の`executeLocalD1`で`UPDATE ultras_settings SET enabled = <0か1>, version = version + 1, updated_at = <ミリ秒> WHERE setting_key = 'ultras_promotion'`を実行して機能フラグを設定する(文字列の値は`sqlStringLiteral`でリテラルにする。本specはローカルのD1へ書き込む手順を独自に作らない)。未ログインの料金ページで価格と特典が見えること、フラグがオフで未加入者にUltrasの区画が出ないこと、プラン管理画面のナビゲーションの項目(5.8、9.1・9.4・9.6)。加入の経路は、paymentsのE2E(`e2e/client/checkout.e2e.test.ts`)と同じ条件で動かす。`stripe listen`の転送を前提にせず、加入の開始が`payments_unavailable`(Stripeのキーが無い環境)を返したとき、または価格を照会できず加入のボタンが無効のとき(`price_unavailable`。Stripeのキーはあるが`ultras_monthly`の価格が無い環境。要件9.7によりボタンが押せず、加入の開始の応答を得られない)に`test.skip`で対象外の理由を示して飛ばす。それ以外は、テストカードでの加入→決済後のランディング(paymentsの`return_url`の反映で加入が有効になる)→プラン管理画面の`active`の表示→「解約・支払い方法の管理」でPortalのURLへ移ることまでを確かめる(1.1・1.7・5.2・6.2)。実行のたびに確認済みの新しい利用者を作り、sandboxに定期課金が実行の数だけ残る旨をテストの説明に書き添える。
  - E2E(`e2e/admin/ultras-promotion.e2e.test.ts`): 最上位管理者がフラグを切り替え、監査ログに記録が出ること(10.2)。管理者のログインは、admin-foundationが`e2e/support/admin-bootstrap.ts`に用意する補助(招待の発行・完了・指定したロールでのログイン)を使い、本specは独自に作らない。
- 手動の検証(手順の一般的な形は`operations/004`、本サービス固有のテーブル名・列名・期待値はタスク10.2と`features/005`が持つ): test clock付きのCustomerをsandboxで作り、ローカルの利用者とCustomerの対応に結び付けてから決済する。同じ利用者で2つ目の加入は拒否されるため、シナリオ(支払いの失敗→再試行の後の終了、Portalでの解約の予約→取り消し→再度の予約→末日の終了)ごとに利用者を分ける。支払いの失敗は、成功するカードで加入した後にPortalで支払い方法を`4000 0000 0000 0341`に差し替え、test clockを次の更新日の後へ進めて再現する。test clockの時刻はアプリの実時刻より先に進むため、終了の後も画面は`canceled`に見えるのが正しく、終了はD1に保存した特典の終了時刻・Stripe側の状態・確定済みの印で確かめる(12.2)。

## Security Considerations

- 認可: 利用者側の照会・変更は本人の加入だけを扱う(利用者IDはセッションから取り、引数で受け取らない)。Portalのセッションは本人のStripe Customerにだけ作る。フラグの変更は最上位管理者だけ(サーバー側で`requireAdmin`、画面の`RoleGate`は補助)。
- 回数制限: Portalのセッションの作成を利用者ごとに1時間20回に制限する(仮4)。
- CSRF: 変更操作はfrontend-platformのBFFのCSRFの検査の下にある。Portalへの移動は、APIが返したStripeのURLへのトップレベルの遷移だけで、CSPの変更は要らない。
- データ最小化: Stripeへ新しい個人データを渡さない。ログ・Sentryに個人データを含めない。

## Performance & Scalability

- 特典の判定は索引`(user_id, started_at)`の範囲の問い合わせで、一括の判定は90件ずつに分ける(バインド変数100個以内)。
- 料金ページの表示はD1の読み取り2回(フラグ・加入)と価格の一時保持(payments)で、Stripeを呼ばない。
- 加入状態は時刻から導くため、終了のための定期実行は要らない。

## Migration Strategy

- 新しいテーブルだけを足すExpandの変更で、既存のデータの移行は無い。機能フラグの初期行は`_seed`のカスタムマイグレーションで挿入する(オフ、仮2、`db/003`の「初期データ」)。
- paymentsの口への追加(`afterCommit`・`cancelAt`)は省略可能な項目の追加で、既存の購入種別の実装に影響しない。
- 新しいシークレットは無い。Stripeの価格(`ultras_monthly`)・Customer Portal・再試行の設定・顧客向けメールの停止・制限付きキーの権限は、stagingのsandboxでmainへのマージ前に開発者が`operations/004`に沿って設定する。prodはlaunch-readinessがリリース時に設定し、フラグをオンにする。
