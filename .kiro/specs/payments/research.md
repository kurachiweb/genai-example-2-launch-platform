# Research & Design Decisions

## Summary

- **Feature**: `payments`
- **Discovery Scope**: Complex Integration(決済の実装は無い。上流の11spec(dev-tooling・backend-platform・api-gateway・email-delivery・frontend-platform・infra-delivery・content-processing・media-pipeline・identity-auth・admin-foundation・legal-pages)の設計・タスクは承認済みで実装は未着手であり、本specはその契約の上にStripeとの連携・決済の状態・決済画面・決済履歴を足す。外部サービス(Stripe)・新しいパッケージ(Stripeの3パッケージ)・新しい資源(シークレット・変数)があるため、完全な調査を行った)
- **Key Findings**:
  - Linkの資金源のグループ1〜3(ステーブルコイン・Pix/UPI・米国の即時銀行決済)はLinkを有効にしている間は個別に無効にできず、Checkout SessionにもLinkの資金源を絞るパラメーターが無い。いずれも「決済確認: 即時」であるため、許可する決済手段の種類(`allowed_payment_method_types: ['card', 'link']`)とダッシュボードの決済手段の設定で絞り、即時に確定しなかった決済は権利を付与しない防御を置く(仮1)。
  - 反映は決済セッション(`cs_`)ごとの購入の状態の前進(未完了→処理中→完了・拒否、未完了→失効)として表し、状態の前進を条件にした版の検査付きの一括の書き込みで、Webhook・`return_url`・突合の同時の到着を1回の反映にまとめられる(DR-015)。請求・返金はStripe側のIDを一意キーにした「発生時刻が新しいときだけ更新する」upsert、チャージバックは段階ごとの挿入で、巻き戻りを防げる(DR-016)。
  - 反映はapi(`return_url`・突合)とevent(Webhook)の両方で動くため、反映の処理・Stripeの呼び出し・ストア・フルフィルメントの登録口を`apps/backend-lib`(`core/payments`・`workers/payments`)に置く(email-deliveryの`EMAIL_PLATFORM_MODULE`と同じ形)。後続specのフルフィルメントの実装も`backend-lib`に置く必要がある。
  - Stripe.jsのCSPは、Stripeの文書の必須の許可先(`script-src`・`frame-src`の`https://js.stripe.com`、`frame-src`の`https://hooks.stripe.com`、`connect-src`の`https://api.stripe.com`)だけで足り、ワイルドカード(`https://*.js.stripe.com`は性能向上のための任意の許可先)は要らない。frontend-platformの許可先の形(`https://<ホスト>`だけ)に収まる。CSPはアプリ全体に掛かるが、スクリプトの読み込みは決済画面と決済後のランディングに限る。
  - API版`2026-03-25.dahlia`以降のCheckout Sessionは、`adaptive_pricing`(現地通貨での支払い)を無効にし、`automatic_tax`と既存のCustomerを併用する場合は`customer_update.address: 'auto'`と請求先住所の入力欄(`BillingAddressElement`)が要る。

## 要件フェーズ前の確認事項(2026-10-23)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                 | 根拠                                                                                                                                                                                            | 回答(2026-10-23)                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | 返金部品の範囲       | FR-PYMNT-006・010・012・014、FR-ADMUG-045、FR-PPLAN-012、法的通知の大枠「返金ポリシー」(停止・非公開化・強制終了に伴う返金を「自動で返金する」と書く)、sponsorshipのbrief(返金はStripe上で手動) | 推奨案(全額・一部の汎用部品)。金額を省略すれば全額、指定すれば一部を返金する部品をQueues経由で提供する。本specが自ら自動で返金するのは、FR-PYMNT-010・014と、確定済みの購入に重ねて届いた決済(二重決済)だけにする。返金ポリシーとの食い違いは後続spec(ugc-moderation・sponsorship・ultras-subscriptionなど)への申し送りとして報告する                              |
| Q2  | 決済手段の範囲       | FR-PYMNT-001、FR-PPLAN-010(Customer Portalも同じ決済手段)、LR-008(法的通知の章5に決済手段を列挙する)、API版`2026-09-30.endive`では`payment_method_types`を使えない                              | 選択肢2(Linkも追加)。カード・Apple Pay・Google Pay・Linkを有効にする。Linkに登録した銀行口座など即時に確定しない支払いは使えないようにする(カード払いに限る設定)。その設定方法をAPI版`2026-09-30.endive`で調べて設計し、検証の手順もタスクに含める。法的通知の章5の決済手段の列挙への影響も記録する(調査の結果は「Research Log」の「Linkの資金源と即時確定」と仮1) |
| Q3  | 同意記録と確認通知   | LR-007、ページ配置「決済前の最終確認画面」、返金ポリシー「EU・英国の14日間の撤回権」(EU消費者権利指令は、同意と了知を記載した確認を後から読み返せる形で渡すよう求める)                          | 推奨案(記録し確認メールを送る)。同意した日時と文言の版を購入の記録に保存し、購入の確定後に、内容・金額・同意の旨を載せた購入確認メールを送る。Stripeの領収書メールは使わない                                                                                                                                                                                       |
| Q4  | 法的通知へのリンク   | LR-008、legal-pagesの申し送り(アンカーは見出しの文字列から作られるため、見出しの改訂でリンクが切れる)、ページ配置「決済前の最終確認画面」(返金ポリシーの要旨は画面に表示済み)                   | 推奨案(アンカー無しの`/legal`)                                                                                                                                                                                                                                                                                                                                     |
| Q5  | Stripe環境の分け方   | `stripe:stripe-best-practices`(既定は個別のsandbox、制限付きキーを推奨)、infra-deliveryのシークレットの表、Stripe Taxの設定はsandboxごとに分かれる                                              | 推奨案(sandbox2つ・制限付きキー)。dev用とstaging用のsandboxを分け、prodはライブモードを使う。キーはapi用とevent用の制限付きキーを別々に作り、Infisicalに登録する。価格・Webhook endpoint・Portal・Taxの設定は、手順書に沿って環境ごとにダッシュボードで行う                                                                                                        |
| Q6  | Stripe SDKの版       | briefのConstraints(SDKのメジャー版と`apiVersion`を固定し、Webhook endpointの版もそろえる)、tech-stack.md、CLAUDE.md(公開から2週間以内の版は避ける)                                              | 推奨案(v23系(endive))。`stripe` 23.0.x、`@stripe/stripe-js` 10.0.x、`@stripe/react-stripe-js` 7.0.0、API版`2026-09-30.endive`。実装時に、公開から2週間を過ぎた最新のパッチ版に固定する                                                                                                                                                                             |
| Q7  | セッション作成の制限 | FR-RLMIT-009(全体のIP単位の制限だけ)、FR-SPONS-015(Turnstileは広告の申込だけ)、FR-USER-006、Stripeのカードテスティング対策の推奨(セッション作成の回数制限)                                      | 推奨案(利用者単位で上限を追加)。上限値は設計で決め、仮として記録する(仮2)。要件定義書のFR-RLMIT節に追記が要る                                                                                                                                                                                                                                                      |

### 提示した選択肢(記録)

- Q1: 全額・一部の汎用部品(推奨・採用。金額を省略すれば全額、指定すれば一部を返金する部品をQueues経由で提供し、本specが自ら自動で返金するのはFR-PYMNT-010・014と二重決済だけ。返金ポリシーとの食い違いは後続specへ申し送る) / 全額返金のみ(FR-PYMNT-010・014と二重決済に限り、停止・強制終了などの返金は管理者がStripeで手動。返金ポリシーの4行を「管理者が返金」へ直す必要がある) / 要件の2件のみ(FR-PYMNT-010・014だけを自動で返金し、二重決済も手動)
- Q2: カードとApple Pay・Google Pay(推奨。3つとも即時に確定し、ウォレットはカードの一種として扱われるためカードだけを許可する設定で絞れる) / 1にLinkを追加(採用。入力の手間が減る。Linkに登録した銀行口座での支払いは即時に確定しないことがあるため、カード払いに限る設定が別に要り、検証の手間も増える) / カードのみ(ウォレットも無効にする。最も単純だがスマートフォンでの購入率が下がる)
- Q3: 記録し確認メールを送る(推奨・採用。同意した日時と文言の版を購入の記録に保存し、購入の確定後に内容・金額・同意の旨を載せた購入確認メールをemail-deliveryで送る。Stripeの領収書メールは使わない) / 記録しStripe領収書(同意はDBに記録し、通知はStripeの自動領収書メール。領収書には同意の旨が載らない) / 記録のみ(メールを送らず、決済履歴の画面で確認してもらう)
- Q4: アンカー無しの`/legal`(推奨・採用。リンクは切れず、返金ポリシーの要旨は最終確認画面に表示する) / 見出しを運用で固定(`#user-content-返金ポリシー`へリンクし、見出しの文言を変えない旨を運用ドキュメントに書く。改訂で切れるおそれは残る) / 固定IDの記法を追加(見出しに固定のIDを付ける記法をcontent-processingに足す。上流specの改修と再検証が要る)
- Q5: sandbox2つ・制限付きキー(推奨・採用。dev用とstaging用のsandboxを分け、prodはライブモード。api用とevent用の制限付きキーをInfisicalに登録し、各種設定は手順書に沿って環境ごとにダッシュボードで行う) / sandbox共用・制限付きキー(devとstagingで1つのsandboxを共有する。設定の手間は半分だが、テストデータとWebhookの配送先が混ざる) / 共有テストモード・秘密キー(最も簡単だが推奨から外れ、キーが漏れたときの被害が大きい)
- Q6: v23系(endive)(推奨・採用。`stripe` 23.0.x・`@stripe/stripe-js` 10.0.x・`@stripe/react-stripe-js` 7.0.0、API版`2026-09-30.endive`。公開から2週間を過ぎた最新のパッチ版に固定する。11月5日以降なら23.0.1(fetchの再試行の不具合修正を含む)) / v22系(dahlia)(`stripe` 22.6.2・`@stripe/stripe-js` 9.17.0・`@stripe/react-stripe-js` 6.12.0、API版`2026-08-26.dahlia`。こなれているが、近いうちにメジャー版の更新が要る)
- Q7: 利用者単位で上限を追加(推奨・採用。例えば1時間に20回までとし、backend-platformの厳密カウンタで数え、超えたら429。要件定義書のFR-RLMIT節に追記が要る) / 追加しない(要件どおりとし、ログイン・メールアドレス確認・Stripe Radar・全体のIP制限で守る) / 上限とTurnstile(上限に加え、全種別の決済開始でTurnstileの検証を求める。操作の手間が増える)

### 確認済みのため質問しない事項

- FR-RLMIT-009のWebhookへの適用: backend-platformのQ1で、Stripe Webhookの経路はIP制限の対象外とし、署名の検証で守ると決まっている。本specはeventの`rate-limit-exclusions.ts`に経路を登録する。
- Stripe Customerの削除の時機: FR-USER-022により、物理削除(`purge_due`、退会の13日後の4:21バッチ)の時点で削除する。briefの「退会時に削除」はこの意味で読む。定期課金の解約(FR-PPLAN-005)はultras-subscriptionが受け持つ。Customerを削除しても、既存の決済の返金や異議申し立てへの対応はできる。
- 決済履歴の保持: 利用者の主キーではなく仮名化ID(FR-USER-004、外部キー無し)で7年保持し、日次バッチで物理削除する(DR-018)。記録の種類・状態・金額の符号・チャージバックの段階は、データエクスポートの`payments.json`の形に従う。
- チャージバックと返金で権利を変えない: FR-PYMNT-008と4.26の前書きで決まっている。返金(手動・自動)とチャージバックは決済履歴に反映するだけで、フルフィルメントは決済の完了でだけ呼ぶ。
- Webhookの冪等性と巻き戻りの防止: DR-015(決済の対象のIDごとに処理済みを記録)とDR-016(発生時刻の古いイベントで状態を戻さない)で決まっている。署名の検証はNFR-SECUR-013で決まっている。
- 価格の設定元と税: 価格はStripeのダッシュボードで設定し、`tax_behavior: inclusive`とStripe Taxで税込のUSDとする(LR-009、I18N-003、料金とプラン)。広告は日数を数量として指定する(FR-PYMNT-003)。Taxを使う国・地域の登録は、ダッシュボードでの運用作業として手順書に書く。
- 決済期限とセッションの有効期限: 有効期限は「作成から24時間」と「決済期限23:35」の早い方とし、作成は23:00で締め切る(料金とプラン)。突合は月曜日とD−6日の23:40に、マッチ確定とペアリングより前に行う(日次タイムライン)。Cronはapiだけに置き、名前は`payments.<名詞句>`、メッセージ種別は`payments.<動詞句>`とする(backend-platform、roadmap)。
- 画面のURLと配置: 決済後のランディングは`/checkout/return`、決済履歴は`/settings/billing`である(ページ配置)。設定ページへはidentity-authの`SETTINGS_NAV_ITEMS`で項目を登録する(`order` 70は予約済み)。最終確認画面の表示事項とUltrasの追加表示もページ配置で決まっている。Customer Portalの設定と`/pricing`はultras-subscriptionが受け持つ。
- Stripe.jsの読み込み: 決済画面に限って読み込む(準拠方針「Cookieとトラッキング」)。読み込み先の許可は、frontend-platformの`SecurityPolicySources`の登録口でCSPとPermissions-Policy(`payment`)に加える。
- 縮退運転: Stripeの障害時は決済ボタンを無効にし、閲覧などの他の操作は続けられるようにする(NFR-AVAIL-002、ページ配置「トーナメント参加費の導線」)。
- 未確認の利用者: メールアドレス確認を済ませていない利用者には、決済も有料プランへの加入もさせない(FR-USER-006)。
- 国外移転の記載: 準拠方針の「データの保存場所」とプライバシーポリシー骨子の「国外移転の記載事項」に、Stripeの項(`### Stripe(決済)`)をinfra-deliveryの型で加える。根拠はDPFを主とし、DPFが無効になった場合はSCCに拠る(roadmapのShared seams)。他の委託先の項は書き換えない。
- 管理画面: 決済専用の管理画面は持たない。管理者の手動返金と証拠の提出(representment)はStripeのダッシュボードで行う(FR-PYMNT-006、4.26の前書き)。広告の強制終了と返金目安額はsponsorshipが受け持つ。
- 新しいパッケージ: Stripe関連の3パッケージはtech-stack.mdで採用が決まっており、Q6では版だけを確認した。Webhookの署名は、SDKの`constructEventAsync`とWeb Cryptoのプロバイダで検証するため、追加のパッケージは要らない。
- 参加費の免除の判定時点と、決済した後にUltrasへ加入した場合の返金: roadmapでultras-subscriptionとtournament-weekの論点とされており、本specでは扱わない(返金が要ると決まれば、Q1の部品を使う)。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する。
- 上流specの仮決定: admin-foundation・legal-pages・inquiry-chatの仮決定はすべて開発者が承認済み(2026-10-23)。admin-foundationの管理者アカウントのURLは`/accounts`。legal-pagesは下書きと公開を分け、同意した版は改訂履歴の「公開日時」で照合する(identity-authの文言も修正済み)。本specは管理画面を持たず、法的通知へはアンカー無しの`/legal`でリンクするため、いずれも影響しない。

## Research Log

### 上流specの契約

- **Context**: 本specは上流11specの契約の上に作る。差し込む登録箇所と、足りない契約を洗い出した。
- **Sources Consulted**: `.kiro/specs/backend-platform/design.md`(`AppModule`・`PLATFORM_TYPES`・`ScheduledJobDefinition`・`createCronRegistry`・`defineMessageContract`・`MessageHandlerRegistration`・`RetryPolicy`・`RateLimitCounterClient`・`hashRateLimitKey`・`excludePath`・`AppError`・`validateEnv`)、`.kiro/specs/api-gateway/design.md`(`GraphQLSchemaModule`・`GraphQLContext`・`withValidatedArgs`・`CURSOR_PAGE_ARGS`・`toConnection`)、`.kiro/specs/email-delivery/design.md`(`defineEmailKind`・`EmailSender`・`defineEmailTemplate`、トランザクションメールは抑止リストを見ない)、`.kiro/specs/identity-auth/design.md`(`AccountGuard.requireVerifiedUser`・`UserRecord.pseudonymousId`・`UserLifecycleAsyncRegistration`・`SETTINGS_NAV_ITEMS`の`order` 70)、`.kiro/specs/frontend-platform/design.md`(`CLIENT_SECURITY_POLICY`・`SecurityPolicySources`・`PublicRuntimeConfig`・`executeGraphQL`・`DateTime`・`NumberText`・`buildPageHead`)、`.kiro/specs/infra-delivery/design.md`(`secrets.required`・Infisicalのキーの表・プライバシーポリシー骨子の委託先の項の型)、`.kiro/specs/legal-pages/design.md`(`LEGAL_DOCUMENT_PATHS`)、`.kiro/specs/content-processing/design.md`(`apps/common-lib/<ドメイン>`)。
- **Findings**:
  - Cron Triggersはapiだけにあり、ジョブは業務時刻の時・分で毎日動く(曜日は指定できない)。4:21の`order`は100〜120(identity-auth)・200・210(admin-foundation)・300(inquiry-chat)・810〜830(media-pipeline)・900(email-delivery)・950(content-processing)が使用済み。
  - 厳密カウンタ(`RateLimitCounterClient`)はapiだけに束縛される。決済の開始の回数制限はapiで数える。
  - identity-authの非同期の波及処理の`order`は0〜9999が各ドメインの範囲(10000以上はidentity-auth自身。2回目のspec横断レビューで0〜999から広げた)で、同じイベントの種類の中で重複できない。`purge_due`の後に`users`の行が最後に消え、外部キーの残りがあると物理削除が止まる。
  - email-deliveryのトランザクションメールは配信停止の設定と抑止リストを見ない。日時は`formatUtcDateTime`で表記する。
  - frontend-platformのCSPはアプリ単位で全ページに掛かり、経路ごとの仕組みは無い。許可先は`'self'`・`https://<ホスト>`・`http://localhost:<ポート>`だけで、ワイルドカードは例外になる。Checkbox・通貨の表示部品は無く、通貨の表示形式はpaymentsの担当とされている。
  - frontend-platformの`PublicRuntimeConfig`にはStripeの公開キーの欄が無い。content-processingが`CLIENT_SITE_ORIGIN`を加えた手順(Wranglerの`vars`・検証・公開設定の欄)に倣って加える。
  - eventには`CLIENT_SITE_ORIGIN`が無い。購入確認メールの導線のURLを組み立てるため、apiと同じ値でeventに加える。
  - 技術ドキュメントの番号は`external/007`・`backend/009`・`operations/004`が空いている(他specの割り当ては`external`〜006、`backend`〜008、`operations`〜003、`db`〜005、`frontend`〜010、`security`〜008)。
- **Implications**: 反映の部品は`backend-lib`に置き、両アプリで同じ束縛(`createPaymentsPlatformModule(<アプリ名>)`、モジュール名`payments-platform`)を使う。回数制限・突合・日次の確認はapiに、Webhook・返金の実行・波及処理はeventに置く。

### Stripe API版`2026-09-30.endive`とSDK v23

- **Context**: briefの実現性チェック(2026-10-03)の指摘と、Q6の版の確定。
- **Sources Consulted**: npmのregistry(`stripe`・`@stripe/stripe-js`・`@stripe/react-stripe-js`の公開日)、unpkgの`stripe@22.6.2`・`23.0.0`の`cjs/apiVersion.js`、`stripe@23.0.1`のCHANGELOG、`stripe docs api POST /v1/checkout/sessions`、`stripe docs /payments/quickstart-checkout-sessions`、`stripe:stripe-best-practices`スキル。
- **Findings**:
  - `stripe` 23.0.0(2026-10-01公開、MIT、依存なし)の固定のAPI版は`2026-09-30.endive`。22.6.2は`2026-08-26.dahlia`。23.0.1(2026-10-22公開)は、fetchの再試行で捨てた応答の破棄、`EventNotificationHandler`の非同期の署名検証、空白だけのWebhookの秘密の拒否を含む。
  - 23.0.0の破壊的変更: `verifyHeader`の許容時間の既定化、`constructEventWithoutVerification`の除去、不完全な応答の`StripeConnectionError`への分類、Node 18の切り捨て。本specは`webhooks.constructEventAsync`と`createSubtleCryptoProvider()`を使うため影響は無い。
  - `@stripe/stripe-js` 10.0.0(2026-10-01)、10.1.0(2026-10-13、2週間以内)。`@stripe/react-stripe-js` 7.0.0(2026-10-01、`@stripe/stripe-js` >=10 <11とReact <20をpeerに持つ、依存は`prop-types`)。`@stripe/react-stripe-js/checkout`は`CheckoutElementsProvider`・`useCheckout`を、`@stripe/stripe-js`は`initCheckoutElementsSdk`を公開する。
  - Checkout Sessionの作成は`payment_method_types`を推奨せず、`allowed_payment_method_types`(動的に決まる候補への絞り込み)・`excluded_payment_method_types`・`payment_method_configuration`で絞る。`ui_mode: 'elements'`では`branding_settings`・`custom_text`・`after_expiration`・`optional_items`・`origin_context`を使えない。`return_url`は`ui_mode: 'elements'`でリダイレクトを伴う決済手段が有効なときに必須。
  - `integration_identifier`(API版dahlia以降)で決済の導線に名前を付けられる。名前の末尾に8文字の英字を付ける。
- **Implications**: `stripe` 23.0.x・`@stripe/stripe-js` 10.0.x・`@stripe/react-stripe-js` 7.0.0を完全固定し、`apiVersion: '2026-09-30.endive'`を明示する。実装時に公開から2週間を過ぎた最新のパッチ版を選ぶ(2026-11-05以降なら`stripe` 23.0.1・`@stripe/stripe-js` 10.1.0)。版は`coding/002`の主要パッケージの一覧に載せる。

### Linkの資金源と即時確定

- **Context**: Q2(Linkも追加し、即時に確定しない支払いは使えないようにする)。
- **Sources Consulted**: `stripe docs /payments/link/link-payment-methods`、`/payments/link/instant-bank-payments`、`/payments/link/stablecoins`、`/payments/link/checkout-link`、`stripe docs /api/checkout/sessions/create?query=payment_method_options`。
- **Findings**:
  - Linkの資金源は、カード(lfsg_000)、グループ1(ステーブルコイン)、グループ2(Pix・UPI)、グループ3(米国の即時銀行決済)、グループ4(Klarna)。「Linkを有効にすると全グループが有効になり、グループ1〜3はLinkの標準の構成要素として、Linkを有効にしている間は有効なまま」「グループ1〜3を無効にするにはLink全体を切る」。
  - 即時銀行決済は「決済確認: 即時」で、Stripeが売上を保証する(銀行主導のACHの返却でも残高から引かない)。ステーブルコインはUSD建ての1〜10,000ドルの1回限りの決済で、Stripeが成功を確認してから完了する(現在は申し込み制のプレビュー)。Pix・UPIは現地通貨での提示が条件で、USD建てでは提示されない。
  - Checkout Sessionの`payment_method_options.link`は`capture_method`・`setup_future_usage`だけで、資金源を絞る項目は無い。Linkの決済は、Chargeの`payment_method_details.link.funding_source_group`(またはカードのウォレットとしての`card.wallet.link.funding_source_group`)で資金源のグループを確かめられる。
  - Apple Pay・Google Payは決済手段の種類としてはカード(ウォレット)であり、`allowed_payment_method_types: ['card', 'link']`で残る。ダッシュボードの決済手段の設定では別々に切り替えられる。
- **Implications**: 「カード払いに限る設定」はStripeに無い。仮1として、決済手段の種類を`card`・`link`に絞り、ダッシュボードの設定でカード・Apple Pay・Google Pay・Linkだけを有効にし(Klarnaと他の手段を切る)、Linkのグループ1〜3は即時に確定するものとして受け入れる。完了の通知で支払いが未完了(`payment_status`が`unpaid`)の決済は権利を付与せず、`checkout.session.async_payment_succeeded`で確定した時点で反映する。検証の手順(sandboxで作成したセッションの`payment_method_types`、決済画面の表示、資金源のグループの記録)を運用手順書とタスクに含める。決済履歴の内部の列に資金源のグループを残し、想定外の資金源を運用者が調べられるようにする。

### Stripe Tax・現地通貨・請求先住所

- **Context**: LR-009・I18N-003、`automatic_tax`の前提。
- **Sources Consulted**: `stripe:stripe-best-practices`の`references/tax.md`、`stripe docs /payments/quickstart-checkout-sessions`。
- **Findings**:
  - 税の登録(Registrations)が無いと、`automatic_tax`を有効にしても税は計算・徴収されない。sandboxの税の設定と登録はsandboxごとに分かれ、ライブモードには引き継がれない。
  - `ui_mode: 'elements'`で税を計算するには、請求先住所を`BillingAddressElement`で集める(`billing_address_collection: 'auto'`は税の計算に必要な最小の項目)。既存のCustomerに対して`automatic_tax`を使う場合は`customer_update.address: 'auto'`で住所をCustomerへ保存させる。
  - Adaptive Pricing(現地通貨での支払い)はダッシュボードの設定とセッションの`adaptive_pricing`で切り替わる。
- **Implications**: セッションは`automatic_tax.enabled: true`・`billing_address_collection: 'auto'`・`customer_update.address: 'auto'`・`adaptive_pricing.enabled: false`で作り、決済画面に請求先住所の入力欄を置く。税の登録とダッシュボードのAdaptive Pricingの無効化は運用手順書の環境ごとの確認項目にする(`operations/004`)。

### Webhookの検証と反映の冪等性

- **Context**: NFR-SECUR-013・DR-015・DR-016・FR-PYMNT-004・009・013。
- **Sources Consulted**: `stripe:stripe-best-practices`の`references/security.md`・`references/payments.md`、legal-pagesとidentity-authの版の検査付きの一括の書き込み(`db/005`・`UserLifecycleCommitter`)、backend-platformの`db/002`(`db.transaction()`の禁止)。
- **Findings**:
  - workerdでは`stripe.webhooks.constructEventAsync(rawBody, signature, secret, 300, Stripe.createSubtleCryptoProvider())`で検証する。生の本文(文字列)が要る。
  - Stripeは2xx以外の応答に対し最長3日間再送する。通知の順序は保証されない。
  - D1の一括の書き込みは前の文の結果で後の文を変えられないが、版の検査に当たる文を条件付きの副問い合わせにし、条件を満たさなければNOT NULL制約の違反で一括の書き込み全体を取り消す方式で、状態の前進と記録・フルフィルメントを同時に確定できる。
  - SQLiteのupsertは`ON CONFLICT ... DO UPDATE ... WHERE`で、既存の行の発生時刻が新しくないときだけ更新できる。
- **Implications**: 通知のIDの記録表は持たず、対象ごとの状態で冪等性と巻き戻りの防止を表す(簡素化)。購入の状態の前進は版の検査付きの一括の書き込みで、請求・返金はupsertで、チャージバックは段階ごとの挿入(一意制約)で表す。定期課金の状態の受け渡しは、Stripeのオブジェクトごとの最終の発生時刻の表(`payment_stripe_objects`)で古い通知を捨てる。

### 返金とメールの依頼の取りこぼし

- **Context**: FR-PYMNT-012、Q3の購入確認メール、二重決済・期限切れの自動返金。
- **Findings**: 反映の一括の書き込みとQueuesへの送信は1つの単位にできない。送信の前に処理が止まると、返金やメールが依頼されないまま残る。
- **Implications**: 返金の依頼とメールの送信の状態を購入・返金の行に持ち、一括の書き込みで「依頼待ち」を記録してから送信し、送信できたら「依頼済み」にする。4:21の日次の確認で、10分以上「依頼待ち」の行を依頼し直す(送信済みの記録の前に止まった場合だけ2通目が出得るが、email-deliveryの配送も少なくとも1回である)。

### CSP・公開キー・決済画面の部品

- **Context**: NFR-SECUR-009、準拠方針「Cookieとトラッキング」、Q4。
- **Sources Consulted**: `stripe docs /security/guide`(Stripe.jsの必須のCSP)、frontend-platformの`SecurityPolicySources`。
- **Findings**: Stripe.jsの必須の許可先は`connect-src https://api.stripe.com`、`frame-src https://js.stripe.com https://hooks.stripe.com`、`script-src https://js.stripe.com`。`https://*.js.stripe.com`は性能向上のための任意の許可先。`https://maps.googleapis.com`は自社のGoogle Maps APIキーで住所の補完を使う場合だけ要る。Apple Pay・Google Payには`Permissions-Policy`の`payment`の許可(`self`と`https://js.stripe.com`)が要る。
- **Implications**: 必須の許可先だけを`CLIENT_SECURITY_POLICY`に加え、ブラウザテストとE2EでCSPの違反が出ないことを確かめる。違反が出た場合はfrontend-platformにサブドメインのワイルドカードの許可を依頼する(Revalidation Triggers)。

## Architecture Pattern Evaluation

| Option                                        | Description                                                           | Strengths                                                                                | Risks / Limitations                                                                                                          | Notes  |
| --------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| 反映をeventだけで行う                         | `return_url`と突合はeventへメッセージを送り、eventが反映する          | 反映の部品がeventだけに収まる                                                            | `return_url`で結果をすぐ示せない(FR-PYMNT-009は同じ反映の処理を呼ぶことを求める)。突合が組み合わせ決定の前に終わる保証が弱い | 不採用 |
| 反映の部品を`backend-lib`に置き両アプリで使う | Webhook(event)・`return_url`と突合(api)が同じ`PaymentReflector`を呼ぶ | FR-PYMNT-009・013を文言どおり満たす。email-deliveryの`EMAIL_PLATFORM_MODULE`の前例がある | 後続specのフルフィルメントの実装も`backend-lib`に置く必要がある                                                              | 採用   |
| 購入種別ごとに決済の処理を各specが持つ        | 各specがStripeを直接呼ぶ                                              | 局所的                                                                                   | 二重反映・巻き戻りの防止がspecごとにずれる(briefの問題そのもの)                                                              | 不採用 |

## Design Decisions

### Decision: 購入とフルフィルメントの口

- **Context**: roadmapのShared seams(paymentsが購入種別とフルフィルメントのポートを所有)。
- **Alternatives Considered**:
  1. 決済の完了をイベントとして発行し、後続specが非同期に権利を付与する
  2. 購入種別ごとの`PurchaseOfferPolicy`(購入の可否と内容)と`PurchaseFulfillment`(権利の付与の文を返す)を登録し、反映の一括の書き込みに権利の付与の文を含める
- **Selected Approach**: 2。`PurchaseFulfillment.prepare`は副作用を持たず、権利の付与の文(`BatchItem`)か拒否を返す。反映はその文を購入の状態の前進と同じ一括の書き込みで確定する。
- **Rationale**: 「払ったのに権利が無い」「権利があるのに未払い」の中間状態を残さない(要件2.4)。拒否は自動の全額返金につなぐ(要件2.5)。
- **Trade-offs**: 後続specの実装は`backend-lib`に置き、D1の文だけで権利を付与する必要がある(外部の呼び出しは反映の後に別途行う)。
- **Follow-up**: 後続specの設計でこの制約を確かめる(Revalidation Triggers)。

### Decision: 二重決済の検出

- **Context**: Q1(二重決済の自動返金)。
- **Selected Approach**: 購入の内容に任意の`exclusivityKey`(例: `launch:<ID>`・`sponsorship:<ID>`)を持たせ、`status = 'fulfilled'`の行に限る部分一意索引を張る。権利の付与の一括の書き込みが一意制約の違反で取り消されたら、二重決済として拒否し全額返金する。定期課金(Ultras)は`exclusivityKey`を持たず、加入済みかの判断はultras-subscriptionの`prepare`が行う。
- **Rationale**: 同時に2つの反映が走っても、D1の一意制約で1つだけが確定する。

### Decision: 疎通確認用の購入種別(仮6)

- **Context**: 後続specが無い間も、決済画面・反映・返金・決済手段の設定を端から端まで検証したい(Q2の検証の手順)。
- **Selected Approach**: `payments_smoke`(1ドル、権利の付与は何もしない)を`PAYMENTS_SMOKE_ENABLED`が真の環境(dev・staging)だけで登録する。prodは偽にし、登録しない。
- **Trade-offs**: stagingの決済履歴に`payments_smoke`の記録が残る。prodには出ない。

### Decision: 価格の照会

- **Selected Approach**: 価格はStripeの`lookup_key`(購入種別ごとの固定の名前)で照会し、D1の`payment_price_snapshots`に10分保持する。Stripeに到達できないときは古い価格を表示用に返す。決済の開始では常に`lookup_key`からStripeの価格を解決し直す。
- **Rationale**: Workers Cache APIはService Binding経由のapiでは使えない可能性がある。D1なら環境を問わず動く。価格IDを変数に持つ方式は、ダッシュボードで価格を変えるたびに設定の変更が要る。

### Decision: Stripe Customerの作成の時機

- **Selected Approach**: 最初の決済の開始時に作る(登録時には作らない)。メールアドレスと仮名化IDだけを渡し、決済の開始のたびにメールアドレスが違えば更新する。物理削除(`purge_due`)の波及処理で削除する。
- **Rationale**: 決済しない利用者のデータをStripeへ渡さない(データ最小化)。

### Decision: 採らなかった案

- Webhookの送信元IPの許可リスト(Stripeの推奨の多層防御): 署名の検証と時刻の許容で足り、StripeのIPの一覧の更新を追う運用が増えるため採らない。
- Stripeの領収書メール: Q3により採らない。
- 通知のIDの記録表: 対象ごとの状態で冪等性を表せるため持たない。

## Synthesis

- **Generalization**: Webhook・`return_url`・突合・日次の確認の4つの入口を、1つの`PaymentReflector`(決済セッションの状態を入力とする)に一般化した。購入種別は口(`PurchaseKindRegistration`)の登録だけで増やせる。返金の依頼は、FR-PYMNT-010・014・二重決済と、後続specの任意の返金を同じ部品で受ける(Q1)。
- **Build vs Adopt**: 署名の検証・冪等キー・再試行はStripe SDKの機能を使う。Webhookの冪等性は既存の版の検査付きの一括の書き込み(legal-pages・identity-auth)を再利用する。メール・回数制限・定期実行・非同期処理は上流の部品を使う。新しいパッケージはStripeの3つだけ。
- **Simplification**: 通知のIDの記録表、管理画面、Stripeの領収書メール、送信元IPの許可リストを持たない。購入確認メールの再送と返金の依頼の取りこぼしは、新しい仕組みを足さずに4:21の日次の確認1つで拾う。

## Risks & Mitigations

- Linkのグループ1〜3で即時に確定しない決済が混ざる — 支払いが未完了の完了通知では権利を付与しない。資金源のグループを記録し、運用手順書の検証で確かめる。期限を過ぎて確定した決済は自動で全額返金する。
- StripeのCSPの許可先の不足で決済画面が動かない — ブラウザテストとE2EでCSPの違反を検査する。不足が見つかればfrontend-platformへ許可先の形の拡張を依頼する。
- 23:40の突合がマッチの確定より後に走る — `order` 10で登録し、match-engineの23:40のジョブはそれより大きい`order`にする(後続specへの申し送り)。
- 税の登録の漏れで税が徴収されない — 運用手順書の環境ごとの確認項目にする。launch-readinessの本番の準備で確かめる。
- 後続specのフルフィルメントが`backend-lib`に置けない処理(外部の呼び出し)を要する — 権利の付与はD1の文に限り、外部の呼び出しは反映の後に後続spec自身が非同期で行う(Revalidation Triggers)。
- 返金ポリシーの「自動で返金する」の行が、後続specで手動の運用になる — 申し送りとして報告し、法的通知の本文の修正は該当specと開発者が行う。広告の2行は、2026-10-24に開発者が決めたsponsorshipの仮3(B、本specの`PaymentRefunds`で金額を指定した自動の日割り返金)で解消した。

## References

- [Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions/create) — `ui_mode: 'elements'`・`allowed_payment_method_types`・`adaptive_pricing`・`customer_update`
- [Link payment methods](https://docs.stripe.com/payments/link/link-payment-methods) — Linkの資金源のグループと無効化の範囲
- [Instant Bank Payments](https://docs.stripe.com/payments/link/instant-bank-payments) — 即時の確認と売上の保証
- [Stripe integration security guide](https://docs.stripe.com/security/guide) — Stripe.jsのCSP
- [Webhooks](https://docs.stripe.com/webhooks) — 署名の検証・再送・順序
- [Refunds API](https://docs.stripe.com/api/refunds/create) — 一部返金・冪等キー
- [Sandboxes](https://docs.stripe.com/sandboxes) — 環境の分離
- `stripe:stripe-best-practices`スキル — 制限付きキー・`payment_method_types`の不使用・税の登録の確認

## 仮決定(2026-10-23に開発者が承認)

要件と設計の作成中に生じた、開発者の判断を要する論点である。回答と上流specに最も整合する案を仮に採用して設計・タスクを作り、2026-10-23に開発者がすべて採用した案のまま承認した(仮1はLinkを残す案)。`requirements.md`の「要件フェーズでの決定事項」にも同じ行がある。

| #   | 論点                 | 確定した案                                                                                                                                                                                                                                                                                                              | 他の選択肢                      | 影響する箇所                                                                                       |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| 仮1 | Linkの資金源         | Linkのグループ1〜3は無効にできないため、即時に確定するものとして受け入れる。決済手段の種類を`card`・`link`に絞り、ダッシュボードでKlarnaと他の手段を切る。支払いが未完了の完了通知では権利を付与しない。資金源のグループを記録し、検証の手順で確かめる。法的通知の章5にLinkの即時銀行決済などに触れる(2026-10-23に承認) | Linkを無効にする(Q2の選択肢1)   | 要件4.7・7.2・15.7、`StripeGateway`・`CheckoutSessionReflection`・`operations/004`・法的通知の大枠 |
| 仮2 | 決済の開始の上限     | 利用者ごとに1時間あたり20回(2026-10-23に承認)                                                                                                                                                                                                                                                                           | 1時間あたり10回 / 1日あたり50回 | 要件3.10、`CHECKOUT_START_RULE`                                                                    |
| 仮3 | 決済画面のURL        | `/checkout/{購入ID}`(ログイン必須、本人だけ)。申込の画面のボタンが購入を作成してから遷移する(2026-10-23に承認)                                                                                                                                                                                                          | 申込の画面に入力欄を埋め込む    | 要件3.12、ルート、ページ配置                                                                       |
| 仮4 | 決済の受付の有効期限 | 決済期限の無い購入は作成から1時間。期限のある購入は24時間と決済期限の早い方(2026-10-23に承認)                                                                                                                                                                                                                           | すべて24時間                    | 要件3.8、`computeSessionExpiry`、料金とプラン                                                      |
| 仮5 | 購入確認メールの対象 | 権利の付与ごとに1通。Ultrasは加入時だけ。自動返金には返金の通知を送る(2026-10-23に承認)                                                                                                                                                                                                                                 | Ultrasの更新ごとにも送る        | 要件8.10・11.1・11.4、`PurchaseNotifier`                                                           |
| 仮6 | 疎通確認用の購入種別 | dev・stagingだけで1ドルの`payments_smoke`を受け付ける(2026-10-23に承認)                                                                                                                                                                                                                                                 | 設けない                        | 要件2.8・2.9、`SmokePurchase`・E2E                                                                 |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂が必要である。

| 要件ID                           | 内容                                                                                                                                                                                                                             | 根拠                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| FR-PYMNT-012                     | 非同期の返金の対象を「FR-PYMNT-010・FR-PYMNT-014の返金」から、「FR-PYMNT-010・FR-PYMNT-014の返金、二重決済の返金、及び各機能が依頼する全額・一部の返金(スポンサー広告の強制終了・表示停止に伴う自動の日割り返金を含む)」に広げる | Q1・sponsorshipの仮3 |
| FR-PYMNT-006                     | 決済履歴へ反映する返金に、FR-PYMNT-010・FR-PYMNT-014の自動返金に加え、二重決済の返金と、各機能が返金の共通部品で依頼した全額・一部の返金(スポンサー広告の自動の日割り返金を含む)を加える                                         | Q1・sponsorshipの仮3 |
| FR-PYMNT-014                     | 反映の期限を過ぎた決済に加え、既に権利を付与した対象への二重決済と、権利を付与できない購入の決済も、権利を与えず自動で全額返金する旨を加える                                                                                     | Q1                   |
| FR-PYMNT-001                     | 受け付ける決済手段をカード・Apple Pay・Google Pay・Linkと明記し、Linkの資金源のうち即時に確認される支払い(即時銀行決済など)を含む旨と、支払いが確定するまで権利を付与しない旨を加える                                            | Q2・仮1              |
| LR-007(またはFR-PYMNT節に新設)   | 最終確認画面での役務の即時提供への同意と撤回権を失う旨の了知について、同意した日時と文言の版を記録し、購入の確定後に内容と同意の旨を記載した確認メールを送る旨を加える                                                           | Q3                   |
| FR-RLMIT節に新設                 | 決済セッションの作成について、ユーザー単位で1時間に20回を上限としたレート制限をDurable Objectsにより提供し、上限超過時は429を返す旨を加える                                                                                      | Q7・仮2              |
| FR-TOURW-002・FR-TOURY-004(注記) | 決済期限の無い都度決済(スポンサー広告)と定期課金の決済セッションの有効期限を作成から1時間とする旨は、FR-PYMNT節に加える                                                                                                          | 仮4                  |

## 上流・後続specへの影響

- frontend-platform(上流): `CLIENT_SECURITY_POLICY`へStripeの許可先を加え、clientの環境の検証と`PublicRuntimeConfig`に`STRIPE_PUBLISHABLE_KEY`(`stripePublishableKey`)を加える(content-processingの`CLIENT_SITE_ORIGIN`と同じ手順、本specの変更として行う)。許可先の形の規則は変えない。E2EでCSPの違反が見つかった場合だけ、サブドメインのワイルドカードの許可を依頼する。チェックボックスの部品は本specでは加えない(identity-authのタスク10.4が新設する)。
- infra-delivery(上流): Infisicalのキーの表(`docs/onboardings/project-values.md`)に`STRIPE_API_KEY`(api・event)・`STRIPE_WEBHOOK_SECRET`(event)の行を、変数の値の表に`STRIPE_PUBLISHABLE_KEY`(client)・`PAYMENTS_SMOKE_ENABLED`(api・event)・eventの`CLIENT_SITE_ORIGIN`の行を本specが加える。stagingの値は、必須にする変更をmainへマージする前に開発者が登録する。prodの値はlaunch-readinessが登録する。`STRIPE_API_KEY`は、infra-deliveryの改訂1のWorkerごとのフォルダ(`/workers/api`・`/workers/event`)へapi用とevent用の制限付きキーを別々に登録する(仮7)。
- identity-auth(上流): ファイルの変更は無い。決済画面の同意のチェックボックスには、identity-authのタスク10.4が新設するfrontend-libの`Checkbox`を使う。メールの宛先は共有の部品`UserContactDirectory.findContact`(`apps/backend-lib/workers/identity`)で引き、`users`の列を直接読まない。非同期の波及処理の`order` 400・410(`purge_due`・`withdrawn`・`suspended`、本specの400番台)を使う。
- match-engine(後続): 23:40のマッチの確定のジョブは、本specの`payments.checkout-reconciliation`(`order` 10)より大きい`order`にする。
- tournament-week・tournament-year(後続): `PurchaseOfferPolicy`(決済期限・受付期限・反映の期限=組み合わせ決定、`exclusivityKey`はローンチとトーナメントの組)と`PurchaseFulfillment`を`backend-lib/workers/<ドメイン>`に実装し、`PURCHASE_KIND_REGISTRATIONS`へ登録する。FR-PYMNT-010の返金は`PaymentRefunds`(依頼キーは購入IDと理由の組)で依頼する。FR-PPLAN-008(Ultrasの加入の確定)とFR-TOURW-027・FR-TOURY-030(参加資格の喪失)の未完了の決済セッションの失効は、本specの`OpenCheckoutExpirer.expireOpen`をeventの非同期の処理から呼ぶ(要件2.10)。
- sponsorship(後続): 申込の行を作った後に`CheckoutStarter.start`を呼び、`PurchaseOfferPolicy`(数量=掲載日数、`requiresBotVerification`はFR-SPONS-015に従う)と`PurchaseFulfillment`を実装する。強制終了・表示停止の返金を自動にするかは、返金ポリシーとの食い違い(Q1)を踏まえて判断し、自動なら`PaymentRefunds`(金額指定)を使う。
- ultras-subscription(後続): `SubscriptionEventSink`を実装して加入状態を管理する。加入の`PurchaseFulfillment`は、既に加入中なら拒否する(本specが定期課金を解約して初回の請求を返金する)。解約(FR-PPLAN-005・012)とCustomer Portal(FR-PPLAN-010)は`StripeGateway.cancelSubscription`・`createPortalSession`と`CustomerDirectory`を使い、apiの制限付きキーの権限(Subscriptions・Customer Portal)の追加を`operations/004`に記す。返金ポリシーの「停止に伴うUltrasの日数分の自動返金」とFR-PPLAN-012の食い違いを判断する。
- ugc-moderation(後続): 統計の収益は`payment_records`を直接読まず、本specに集計の照会口の追加を依頼する。照会`PaymentRevenueReport`(`core/payments/ports.ts`・`workers/payments/d1-payment-revenue-report.ts`・`PAYMENTS_TYPES.PaymentRevenueReport`)は、2026-10-24の開発者の決定により本specが所有・実装し、ugc-moderationは呼ぶだけである(仮7、要件12.10)。停止・非公開化に伴うトーナメント参加資格・広告の返金の自動化の要否(返金ポリシー)を判断する。
- data-export(後続): 本specが所有するエクスポート部品`PaymentHistoryExport.listAll`を呼んで`payments.json`を作り、決済履歴のテーブルを直接読まない。
- 返金ポリシー(法的通知の大枠)の「自動で返金する」の4行(ユーザー停止に伴うUltrasの日数分、ユーザー停止・非公開化に伴うトーナメント参加資格の停止、広告の強制終了の未掲載日数分、ユーザー停止・非公開化に伴う広告の表示停止の日数分)は、要件定義書(FR-ADMUG-045は返金目安額の表示まで)・sponsorshipのbrief(手動)と食い違う。本specは部品だけを提供し、各specと開発者の判断に委ねる(Q1)。このうち広告の2行(強制終了の未掲載日数分・表示停止の日数分)とsponsorshipのbriefの手動の返金との食い違いは、2026-10-24に開発者が決めたsponsorshipの仮3(B、自動の日割り返金)で解消した。

## タスクの計画の検証(2026-10-23)

- タスクのグラフの独立した確認(independent)を2回行った。1回目(NEEDS_FIXES、15件)は、前方への依存・並行のタスクの同じファイルの編集・開発用sandboxの前提・疎通確認の決済の開始の導線・大きすぎるタスクなどで、すべて直した(設計に`purchase-states.ts`・`SmokeCheckoutButton`・決済画面の処理中と返金中の表示・返金の依頼の利用者の行の削除を追記)。
- 2回目もNEEDS_FIXES(2件: イベントサーバーの決済のモジュールを作るタスクの明記とローカルの転送の確認の移動、依頼待ちのメールの再依頼のストアの操作と担当のタスク)だった。この2件も`tasks.md`に反映したが、kiro-spec-tasksの規則(2回目が`PASS`でなければ承認しない)により3回目の確認と承認は行っていない。`tasks.md`は未承認の草案である。
- 3回目(開発者の指示による独立の確認、NEEDS_FIXES)の指摘を反映した: 公開キーの値の用意(1.1・1.4・設計の移行方針)、購入のストアの操作(購入ID・PaymentIntentのIDでの検索、決済セッションIDの保存)の追記(4.1・設計)、決済後のランディングと決済履歴の画面のローカルの確認の12.1への移動、直前の兄弟に依存する7.2・7.3・9.2・9.3の`(P)`の除去、Webhookの署名の検証の束縛の9.4への明記、2.1のテスト項目の文言。承認は開発者が改めて判断する。
- 4回目(開発者の指示による独立の確認、NEEDS_FIXES)の指摘を反映した。
  - 反映から呼ぶ自動返金の経路: 設計に`PaymentRefunds.prepareForReflection`(購入を`rejected`へ進める同じ一括の書き込みで確定する前提で、状態とPaymentIntentのIDの検査を省き、引数のPaymentIntentのIDと支払額で全額の依頼の行を作る)を加えた。前進の文が購入へPaymentIntent・請求・定期課金のID・支払額・`paid_at`・`reflected_at`を保存する旨を設計とタスク5.3に加え、5.1のテストに反映からの経路を加えた。水平展開として、決済セッションIDの保存の前に届いた通知を購入ID(`client_reference_id`)で引く扱いを設計に加えた。持ち主の特定・返金の実行・購入確認メール・決済画面の表示は前進後の保存値に頼るため、同じ前提で成り立つことを確かめた。
  - 公開キー: 1.1でローカルとstagingに`pk_test_`で始まる仮の値を置き、1.4で仮の値をdevの公開キーで置き換える形にし、1.4の`_Boundary:_`にclientのWrangler設定を加えた。設計の移行方針も合わせた。
  - メールの種別とテンプレート: email-deliveryの1対1の検査が途中で失敗しないよう、種別の追加を旧タスク6からテンプレートと同じ新しいタスク2.4へまとめ、旧タスク6を削除した。これにより旧7〜13を6〜12へ繰り上げた(上の履歴のタスク番号は繰り上げ前の番号である)。
  - 8.4(旧9.4)の完了状態の返金の確認手段を、Workers統合テストで`PaymentRefunds.request`から送ったメッセージの受信に絞った。
  - 軽微: 2.1のテストを仮の登録で書く旨、10.4(旧11.4)の`_Depends:_`への共通部品(9)の追加、10.3〜10.5のルートの生成ファイルの衝突は生成し直して解消する旨、1.1の前提へのdev-toolingの追加。
- 5回目(開発者の指示による独立の確認、NEEDS_FIXES、2件と軽微3件)の指摘を反映した。
  - `prepareForReflection`から`paymentIntentId`の引数を外した(`payment_refunds`はPaymentIntentの列を持たない)。返金の実行は、どの依頼の経路でも、同じ一括の書き込みの前進の文が保存した`payment_purchases.stripe_payment_intent_id`を読んで`createRefund`に渡す旨を設計に明記し、無い場合は`missing_payment_intent`で失敗とする。5.1のテストは引数の支払額から全額の返金の行を作る形に、8.2のテストは購入から読む形に直した。
  - 決済セッションIDの保存の前に届いた通知の代わりの検索を、`StripeCheckoutSessionSnapshot.metadata.purchase_id`で購入を探す形に改めた(5.3)。3.1のテストに`metadata.purchase_id`の取得を加えた。
  - 自動返金の判定を、理由の値ではなく依頼キーの`reflection:`の接頭辞で行う形に改め(設計の`PaymentRefunds`・`PurchaseNotifier`・反映、5.1・5.2・5.4)、後続specの`request`・`prepare`は`reflection:`で始まる依頼キーを`invalid_request_key`で拒否する。
  - 2.4の完了状態にMailpitへの送信の手段を明記し、設計のコンポーネント表に`PaymentEmailKinds`を加えた。
- 5回目の指摘の反映後、修正箇所の確認を経て、2026-10-23に開発者がdesignとtasksを承認した。

## 上流の変更(ultras-subscriptionの仮3・仮5、2026-10-23に開発者が承認)

ultras-subscriptionの要件と設計の作成中に、本specの口に足りない点が2つ見つかった。開発者がultras-subscriptionの仮3・仮5を承認したため(2026-10-23)、本specの要件・設計・タスクに反映した。決定事項の表のU1・U2の行と同じ内容である。

| #   | 変更                                                                                                                                                                                                                | 理由                                                                                                                                                                                                                                                                                                                                                                                                                   | 反映した箇所                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | `PurchaseFulfillment`・`SubscriptionEventSink`に、一括の書き込みの確定の後に1回呼ばれる省略可能な`afterCommit`を加える。`SubscriptionChange`と`StripeSubscriptionSnapshot`にStripeの`cancel_at`(`cancelAt`)を加える | 口の`prepare`・`statementsFor`は副作用を持てず、後続specが加入の知らせやメールを確定の直後に送り出せない(FR-PPLAN-008の「加入が確定した時点」)。API版`2025-09-30.clover`以降の新しい定期課金は柔軟な請求モードで、Customer Portalでの期間末の解約は`cancel_at`だけで表され`cancel_at_period_end`は偽のまま(Stripeの「Integrate the customer portal」)。`cancelAt`が無いとultras-subscriptionがPortalでの解約を見落とす | 要件2.11・7.8・7.9、設計の`PurchaseKindContract`・`StripeGateway`・`CheckoutSessionReflection`(手順5)・`PaymentReflector`(定期課金)・Testing Strategy、タスク2.1・3.2・5.3・5.4 |
| U2  | 購入確認メールに、購入の`summary_json`の最終確認画面の追加事項(Ultrasの自動更新・毎月の請求額・解約の方法など)を載せる                                                                                              | カリフォルニア州の自動更新法(Business and Professions Code 17602条(a)(3))が、購入後に自動更新の条件・解約の方針・解約の方法を保存できる形で知らせるよう求める                                                                                                                                                                                                                                                          | 要件11.6、設計の`PurchaseNotifier`・Testing Strategy、タスク2.4・5.2                                                                                                            |

- `afterCommit`の失敗は反映の結果を変えず、`warn`のログだけを残す。後続specは依頼待ちの行を自分の一括の書き込みに含め、自分の日次の確認で拾う(ultras-subscriptionの`ultras-subscription.pending-dispatch-sweep`)。
- `cancelSubscription(atPeriodEnd: true)`は`cancel_at_period_end`のまま送る(非推奨だが同じ動作をする)。
- 当初はultras-subscriptionのタスクが本specのコードを直接変える案だったが、本specが先に実装されるため、本specのタスクで実装する形に整理した。ultras-subscriptionは実装済みの口を使うだけにする。

## spec横断レビューの指摘の反映(2026-10-23に開発者が決定)

全specを横断したレビューの指摘に対する開発者の決定(2026-10-23)を、本specの要件の決定事項の表(C1〜C3)・設計・タスクに反映した。

| #   | 指摘                                                                                                                                                                                                                                  | 決定と反映                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | (重大)非同期の波及処理`payments.customer-erasure`(`purge_due`、`order` 300)がinquiry-chatの`inquiry-chat.member-inquiry-purge`(`purge_due`、`order` 300)と重なり、identity-authの`createAsyncLifecycleRegistry`が起動時に例外を投げる | 波及処理の`order`は、各specが4:21のジョブの`order`と同じ百の位の帯を使う。inquiry-chatは300のまま、本specは`payments.customer-erasure`を400、`payments.open-checkout-expiry`を410にした(ultras-subscriptionは500番台)。identity-auth(100番台と10000以上)・admin-foundation(200番台)・media-pipeline(800番台)・email-delivery(900)・content-processing(950)とも重ならないことを確かめた。設計の「This Spec Owns」・Revalidation Triggers・波及処理の表、タスク8.4を直した                                                                                                                                                                                                                                               |
| C2  | (重要)サービス仕様の`features/003`はfrontend-platform(国際化方針)が使う番号で、本specの`features/003-payments.md`と重なる                                                                                                             | 本specの決済実装方針を`features/004-payments.md`に改めた(ultras-subscriptionは`features/005`)。設計のModified Files・新規の文書、タスク12.2を直した                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| C3  | (判断)メールの宛先の読み取りが、本specの`UserContactReader`とultras-subscriptionの`UltrasContactReader`に重複している                                                                                                                 | identity-authが`apps/backend-lib/workers/identity`に共有の部品`UserContactDirectory`(`findContact(userId)`が`userId`・`email`・`nickname`・`emailVerified`を返し、退会済み・物理削除済みは`undefined`、停止中は返す。DIの識別子`IDENTITY_PLATFORM_TYPES.UserContactDirectory`、api・eventの両方にidentity-authが束縛する)を用意する。本specの`UserContactReader`のポート・D1の実装・テストを削除し、`PurchaseNotifier`が`findContact`を使う形にした。従来の`UserContactReader`も退会済み・存在しない利用者だけを除き、停止中の利用者を除いていなかったため、呼び出し側の判定は変わらない(`undefined`なら`skipped`)。設計の依存先・ファイル構成・コンポーネント表・`PurchaseNotifier`、タスク1.1・2.1・4.2・5.2を直した |

- (軽微)設計のAllowed Dependenciesが、apiのアプリケーション層(`apps/api/src/application/payments/`)にある`CheckoutStarter`を`core/payments`・`workers/payments`の公開の契約に含めていた。backend-libの契約とは別の、apiのアプリケーション層の部品として書き分けた。
- (判断)データエクスポートは各ドメインが自分のエクスポート部品を所有する。本specの`PaymentHistoryExport`はその部品で、data-exportはこれを呼び、決済履歴のテーブルを直接読まない旨を設計と上流・後続specへの影響に明記した(`PaymentHistoryExport`を後続specが依存できる公開の契約の一覧に加えた)。
- (横断)identity-authのタスク10.4が`apps/frontend-lib/components/ui/checkbox.tsx`(shadcn/uiのCheckbox、stories・browser test併置)を新設することになった(identity-authが先に実装される)。本specはチェックボックスの部品を新設せず、その部品を決済画面の同意に使う形に、設計(This Spec Owns・Allowed Dependencies・Revalidation Triggers・Technology Stack・ファイル構成・コンポーネント表・`MoneyText`の節)とタスク(9を通貨の表示部品だけに、10.3に`Checkbox`の利用と前提)を改めた。identity-authを上流の依存として明記した。
- (横断の確認)共有の連絡先の照会のDIトークンは`IDENTITY_PLATFORM_TYPES.UserContactDirectory`(`apps/backend-lib/workers/identity`、`IDENTITY_PLATFORM_MODULE`でapi・eventに束縛)で、本specの設計・タスク・研究の表記はこれにそろっており、`UserContactReader`・`users`の列の直接の読み取りの残りが無いことを確かめた。
- `spec.json`の承認の状態は変えていない。

### 2回目のspec横断レビューの反映(2026-10-23)

- identity-authの波及処理の`order`の範囲が、各ドメインは0〜9999、identity-auth自身は10000以上に広がった(identity-authの`identity-auth.email-suppression-cleanup`は10000)。roadmapに全specの百の位の帯の割り当ての表ができた。本specの400番台(4:21の400・410、波及処理の400・410)は変わらず、他の帯と重ならないことを確かめた。設計の帯の記述と本書の旧い範囲の記述を直した。
- データエクスポートでは、data-exportがidentity-authの`AccountExport.find(userId)`で仮名化IDを得て、本specの`PaymentHistoryExport.listAll(pseudonymousId)`へ渡す。`PaymentHistoryExport`の形は変えず、設計の`PaymentHistoryExport`の節に仮名化IDの入手元を書き加えた。

## spec横断レビュー(3回目)の指摘の反映(2026-10-23)

3回目のspec横断レビューの指摘を、設計に反映した。`spec.json`の承認の状態は変えていない。

- (軽微)設計の非同期の波及処理の節が「`withdrawn`・`suspended`のultras-subscriptionの500の前に動く」と、上流の本specが後続specの値を引いていた。「どのイベントでも後続specの帯(500番台以降。roadmapの帯の割り当ての表)の前に動く」に改めた。同じ理由で、Revalidation Triggersの波及処理の`order`の行の重ねない帯の列挙からultras-subscription(500番台)を外し、後続specに割り当てた帯の列挙に500番台を加えた。本specの`order`(4:21の400・410、波及処理の400・410)は変えない。

## spec横断レビューによる承認後の変更(仮7、2026-10-24)

- **状態**: 要件・設計・タスクの承認の後の変更で、cross-spec reviewの指摘による。2026-10-24に開発者が確定した。Workerごとのキーは推奨どおり、収益の照会は推奨と異なり本specが所有・実装する案である(下の「確定(2026-10-24)」)。`requirements.md`の決定事項の表に仮7として記録した。
- **指摘1(シークレット)**: infra-deliveryの設計では`STRIPE_API_KEY`がInfisicalの`/`に1つだけあり、全Workerへ同じ値が渡るため、本specのQ5(api用とevent用の制限付きキーを別々に作る)と15.2を満たせなかった。infra-deliveryが改訂1で、Workerごとのフォルダ`/workers/api`・`/workers/event`(同じキーの`/`の値より優先)と、`/`の値を使わないキーの一覧`WORKER_SCOPED_SECRETS`(`STRIPE_API_KEY`を含む)を設けた。
- **決定1**: 本specはその仕組みを採る。dev・stagingでapiの制限付きキーを`/workers/api`へ、eventの制限付きキーを`/workers/event`へ登録し、`/`には置かない(prodはlaunch-readinessが同じ形で登録する。launch-readinessの仮13)。`STRIPE_WEBHOOK_SECRET`はeventだけが使うため`/`のままとする。キーの名前・Wrangler設定の宣言・環境の検証は変えない。apiとeventのローカルの起動はinfra-deliveryの`run-with-secrets --scope local --worker <api|event>`の形で行う。タスク1.1(キーの一覧の節の行をWorkerごとのフォルダで書く、`WORKER_SCOPED_SECRETS`の確認)と1.4(`operations/004`の制限付きキーの登録の手順、開発者の作業の一覧、オンボーディングの起動のコマンドの確認)と、設計のAllowed Dependencies・Revalidation Triggers・Technology Stack・Modified Files・Security Considerations・Migration Strategyを改めた。
- **指摘2(収益の照会)**: ugc-moderationの設計が、本specの共有ディレクトリへ収益の照会`PaymentRevenueReport`・`RevenuePeriod`(`core/payments/ports.ts`)、実装`workers/payments/d1-payment-revenue-report.ts`、DIの識別子`PAYMENTS_TYPES.PaymentRevenueReport`と`createPaymentsPlatformModule(<アプリ名>)`での束縛を加える(作成も利用もugc-moderation)が、本specの再検証の対象とファイルの計画に記録が無かった。純収益は`payment_records`の`kind`・`status`・`purpose`の値と`amount`の符号(返金とチャージバックの損失は負の値)に依存する。
- **決定2**: 設計のRevalidation Triggersに、`payment_records`の`kind`・`status`・`purpose`の値の意味、`amount`の符号の規則、`occurred_at`の意味、`payments_smoke`の扱いを変えるときはugc-moderationを再検証する旨を加えた。Directory Structureの注記とファイルの計画の注記に、ugc-moderationが作成する4か所(`ports.ts`・`identifiers.ts`・`d1-payment-revenue-report.ts`・`payments-platform-module.ts`)を記録した。(この扱いは2026-10-24の確定で、本specが所有・実装する形に改めた。下の「確定(2026-10-24)」を正とする。)DIの識別子は本specの`PAYMENTS_TYPES`である。
- **変更部分のタスクの検証**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定はNEEDS_FIXESだった。1.4がオンボーディングの起動のコマンドを書き換える記述をinfra-deliveryの担当として「止めて報告する」に改め、`_Boundary:_`から外したこと、Workerごとのフォルダへの登録の手順をオンボーディングへ書く作業を1.4に加えたこと、1.4の完了状態を値を出さずに確かめられる形(Workerの指定の有無による起動時の検証の結果)に改めたこと、1.1の完了状態に`WORKER_SCOPED_SECRETS`の確認の記録を加えたことを直した。`PaymentRevenueReport`を本specのタスクにしないことは規則に合うとの判定だった。2回目の判定はPASSだった。軽微な指摘のうち、1.4の`_Boundary:_`にオンボーディング(登録の手順だけ)を加え、1.4の自己参照の文言を改めた。`spec.json`の`updated_at`を更新し、タスクの承認を保った。

### 確定(2026-10-24)

- **Workerごとの制限付きキー**: 推奨どおり確定した(infra-deliveryの改訂1も同日に確定)。
- **収益の照会**: 開発者は「上流specが所有・実装する」案を選んだ(推奨の「ugc-moderationが本specの共有ディレクトリへ作成する」案と異なる)。本specが`RevenuePeriod`・`PaymentRevenueReport.netRevenue(periods)`(`core/payments/ports.ts`)、実装`workers/payments/d1-payment-revenue-report.ts`、`PAYMENTS_TYPES.PaymentRevenueReport`、`createPaymentsPlatformModule(<アプリ名>)`での束縛を、自分のタスク(2.1の契約、1.3の索引、5.5の実装とWorkers統合テスト、5.7の束縛)で作る。シグネチャはugc-moderationの設計のものをそのまま写した。要件に12.10を加えた。Revalidation Triggersには、利用者としてugc-moderationを残した。
- **純収益の数え方**: ugc-moderationの説明(成功した決済から返金と敗北したチャージバックを差し引く)に従う。ただし、ugc-moderationの設計の式は`kind = 'dispute' AND status = 'dispute_lost'`の行の`amount`を合計するが、本specのチャージバックの記録の規則では、引き落としは`disputed`の行(負の額)、`dispute_lost`の行は0で記録される。そのまま合計すると敗北したチャージバックが差し引かれない。そこで、`dispute_lost`の行の発生時刻の期間に、同じ`stripe_reference`の`disputed`の行の額を差し引く形にした。勝ったチャージバック(`dispute_won`)と、まだ決着していない引き落としは数えない。ugc-moderationは、設計の純収益の説明を本specの`PaymentRevenueReport`の定義(要件12.10)への参照に改める必要がある。
- **問い合わせの形**: D1の1つの問い合わせのバインド変数の上限(100)に収まるよう、期間を最大40個ずつの組に分けて1回の`db.batch`で実行する。期間の合計は1件ごとの金額の範囲では検証しない。設計のレビューで、5.5を価格・エクスポート・純収益の3部品に分ける案も挙がったが、いずれも決済履歴と価格の読み取りだけの小さな部品で、5.7の依存の順を保つため分けなかった。
- **確定の反映の検証**: kiro-spec-tasksのタスクのレビューとkiro-spec-designの設計のレビューを、変更部分に絞って新しいサブエージェントによる独立した確認(independent)で行った。1回目はNEEDS_FIXES(60期間でD1のバインド変数の上限100を超える、対応の無い敗北の記録のログの取り方、期間の合計の範囲の検証)で、上の問い合わせの形に直した。2回目はPASSだった。
- **spec横断レビュー3回目の反映(2026-10-24)**: `PaymentRefunds.prepare`の同じ依頼キーの2回目の振る舞い(既存の依頼を`duplicate: true`・空の文で返し、新しい行を作らない。依頼キーの形式の検査、依頼キーの照会、金額と購入の状態の検証の順)を契約に定め、5.1のテストに加えた。返金ポリシーの広告の行の食い違いがsponsorshipの仮3(B)で解消したことを、要件のQ1と本書に記した。変更部分のタスクのレビュー(independent)は、1回目に`reflection:`の依頼キーの検査の順の指摘があり、直した後の2回目でPASSだった。
- **索引**: 全利用者の期間の検索のため、`payment_records`に`(occurred_at)`の索引を加えた(1.3)。

### sponsorshipの仮3(B、自動の日割り返金)の影響の確認(2026-10-24)

開発者は、スポンサー広告の強制終了は未掲載日数分、表示停止(停止・非公開化)は停止した日数分を、`PaymentRefunds`(金額指定)で自動で日割り返金すると決めた。本specの`PaymentRefunds`が対応しているかを確かめた。

- **対応済み**: `request`・`prepare`は金額の指定(最小通貨単位の正の整数、`null`は残りの全額)を受け付ける(8.1)。依頼キーで1回だけ実行され(8.2)、残りの額(支払額 − 失敗・取り消し以外の依頼の合計)を超える依頼は`amount_exceeds_refundable`で拒否する(8.3)。同じ購入に対する複数回の一部の返金(表示停止の後の強制終了など)も、依頼キーを分ければ扱える。理由は`[a-z0-9_]{1,64}`の自由な値で、Stripeの返金理由は`requested_by_customer`になる。返金の反映(決済履歴の負の記録)は手動・自動を問わず行う(8.8)。本specの変更は要らない。
- **注意(sponsorshipの側で扱う)**: (1)本specの自動返金の通知メール(8.10)は、反映の期限切れ・付与できない・二重決済の依頼(依頼キーが`reflection:`で始まる)だけに送る。日割り返金を購入者へ知らせるメールはsponsorshipが送る(または管理者の措置の通知に含める)。(2)`purge_due`で購入の行が消えた後の依頼は`purchase_not_found`で拒否される。(3)前提は購入が`fulfilled`(または`rejected`)で支払いが確定していることで、スポンサー広告の都度決済はこれを満たす。(4)日割りの額の計算・端数の扱い・依頼キーの形(例: `sponsorship:<広告ID>:suspension:<停止の記録ID>`)はsponsorshipが決める。
- **要件定義書**: FR-PYMNT-006・FR-PYMNT-012の改訂の行に、スポンサー広告の自動の日割り返金を明記した(下の「要件定義書の改訂が必要な箇所」)。法的通知の大枠の返金ポリシーとの食い違い(Q1)は、スポンサー広告については自動返金が実装されることで解消する。

## frontend-platformの実装で確定した契約の反映(2026-10-28)

- frontend-platformの実装と最終検証の後、開発者の決定(frontend-platformのタスク10.4)で、設計をfrontend-platformの設計の「実装で確定した契約による発火と影響を受ける下流spec」の表に合わせた。振る舞いを変えない整合の修正のため、改訂の番号は付けない。要件は変えていない。
  - 操作の置き場所と生成物: clientの操作を`src/graphql/operations/payments/`の1ファイル1操作の`.graphql`(操作名は`Client`で始める)にし、`graphql()`を呼ばず、部品は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読むとした。1ファイルにまとめていた3つの操作を分けたため、操作のファイルは5つになった(design.mdのAllowed Dependencies・File Structure Plan、tasks.mdの10.2)。
  - `CLIENT_SECURITY_POLICY`への追記は、確定した`SecurityPolicySources`の形と許可先の形の規則に合うため変えていない。

## 実装済みの上流との食い違いの水平展開(2026-10-30、開発者の指示)

- **Sentryの定型の通知**: content-processingの差分の分析(G-4)で、backend-platformの改訂7と技術ドキュメント`infra/004`の「同じ文言を繰り返し送る通知」が、定型の文言で繰り返し起こり得る出来事を`captureMessage`ではなく`captureEvent`で送り、文言を`logentry`、まとめる単位を`fingerprint`に置くと定めていることを確かめた。`captureMessage`は既定の`dedupeIntegration`により、同じ文言の2件目以降が捨てられる。本specの`captureMessage`をすべて`captureEvent`に改め、規約の参照と通知のタグの記述に`logentry`と`fingerprint`の置き方を加えた。通知の種類・タグ・レベルは変えていない。
- **ブラウザテストの事前バンドル**: frontend-platformの`vitest.browser.config.ts`は、テストの実行中に依存の事前バンドルをやり直すとページが再読み込みされReactが2つ読み込まれるため、画面部品の依存を`PREBUNDLED_DEPENDENCIES`に列挙している(content-processingの差分の分析のG-3)。本specが加える`@stripe/stripe-js`・`@stripe/react-stripe-js`を、clientの一覧へ加える手順をdesign.mdのModified Filesとtasks.mdの導入のタスクに加えた。
- 要件と受け入れ基準は変えていない。

## 層の規則に合わせた契約の置き場所の改訂(2026-11-02、開発者の指示)

- **規則**: [層構成の依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析)により、api・eventの`src/application/**`・`src/domain/**`は`**/lib/workers/**`を型も含めて読み込めない。application層が受け取る契約と識別子は`apps/backend-lib/core/<ドメイン>`に置き、`workers`には実装と束縛だけを置く。`core`はDBディレクトリを読み込まず、D1の文(`BatchItem<'sqlite'>`)を返す契約と接続(`Database`)を引数に取る契約は`workers`に置き、`workers`と`infrastructure`だけが使う。application層はDBの接続・SQLの文・一括の書き込みを扱わず、書き込みの単位をポートにしてinfrastructure層で実装する。厳密カウンタを使うクラスはinfrastructure層に置く。
- **coreへ移した・加えた契約**: application層が受け取るのに`workers`の節にあった`StripeWebhookVerifier`・`VerifiedStripeEvent`・`PaymentReflector`・`ReflectionOutcome`・`OpenCheckoutExpirer`・`PurchaseNotifier`(契約を新たに定めた)を`core/payments/ports.ts`に置き、Stripeの例外の分類(`StripeUnavailableError`・`StripeNotFoundError`・`StripeRejectedError`・`StripeSignatureError`)もapplication層が判定に使うため`core`に置いた。`PAYMENTS_TYPES`はこれらと`PurchaseKindRegistry`・文の契約の識別子を含め、`identifiers.unit.test.ts`で値と凍結を確かめる。
- **購入種別の口の分割**: `core/payments/purchase-kind-contract.ts`が`Database`・`BatchItem`を読み込んでいたため分けた。購入の可否と内容の側(`PaymentsEnv`・`PurchaseOfferRequest`・`PurchaseOffer`・`PurchaseOfferPolicy`・`CheckoutSummaryText`・`FulfillablePurchase`・`PurchaseOfferRegistration`・`SubscriptionChange`・`StripeSubscriptionStatus`・`PurchaseKindRegistry<T>`・`createPurchaseKindRegistry<T>`・`assertSubscriptionEventSinkNames`)は`core`に残し、D1の文を返す側(`FulfillmentPlan`・`PurchaseFulfillment`・`PurchaseKindRegistration`(`PurchaseOfferRegistration`に`fulfillment`を加える)・`SubscriptionEventSink`・`SubscriptionEventSinkRegistration`)を`workers/payments/fulfillment-contract.ts`へ移した。`PURCHASE_KIND_REGISTRATIONS`・`SUBSCRIPTION_EVENT_SINKS`は`workers`のまま。`PAYMENTS_TYPES.PurchaseKindRegistry`は1つの値に束縛し、apiの`CheckoutStarter`は既定の型引数(可否と内容の側)で、`workers/payments`の反映は`PurchaseKindRegistry<PurchaseKindRegistration>`で受け取る。`offer`の識別子は、apiの決済モジュールが渡す`PurchaseOfferPolicyResolver`で解決する(media-pipelineの`FileReadPolicy`の解決の関数と同じ形)。
- **ストアと返金の依頼の分割**: `core/payments/ports.ts`の各ストアと`PaymentRefunds`が文を返す操作を含んでいたため、文を返さない操作(`PurchaseStore`・`PaymentRecordStore`・`StripeObjectStore`・`CustomerStore`・`RefundStore`・`PriceSnapshotStore`・`PaymentRefunds`の`request`・`dispatch`)を`core`に残し、文を返す操作(`PurchaseStatements`・`PaymentRecordStatements`・`StripeObjectStatements`・`RefundStatements`・`CustomerStatements`・`GuardedBatch`・`PaymentRefundStatements`の`prepare`・`prepareForReflection`)を`workers/payments/statement-contracts.ts`へ移した。D1の実装は1つのクラスで両方を実装し、2つの識別子へ束縛する。
- **新しいポートとinfrastructure層の実装**: apiのapplication層に`CheckoutStartLimits`(実装`CounterCheckoutStartLimits`、`CHECKOUT_START_RULE`もinfrastructure層)・`CheckoutPurchaseWriter`(実装`D1CheckoutPurchaseWriter`。未完了の購入の置き換えと新しい購入の作成を1回の一括の書き込みで確定し、Stripeの失敗で購入を失効させる)・`PurchaseOfferPolicyResolver`、eventのapplication層に`PaymentAccountDataEraser`(実装`D1PaymentAccountDataEraser`。返金の依頼→購入→Customerの対応の削除を1回の一括の書き込みで確定)を置いた。`MessagePublisher`は`workers/payments`の`PaymentRefunds`の実装だけが使う。bot判定は`humanCheck`(presentation層の`GraphQLContext.assertHuman`)のまま。
- **変えた箇所**: design.mdのOverviewのImpact、This Spec Owns、Allowed Dependencies(backend-platform・identity-auth・後続spec)、Revalidation Triggers(置き場所の行を追加)、Existing Architecture Analysis、Dependency direction、File Structure Planの木、Requirements Traceability(1.5〜1.7・3.10)、Componentsの表、`backend-lib/core`の節(識別子・購入種別の口の分割・登録と解決)、`backend-lib/core・workers`の節(Stripe・ストア・反映・失効・返金・通知・収益・価格とエクスポート)、apiの`CheckoutStarter`の節とジョブの依存、eventのWebhook・返金・波及処理の節、Testing Strategy。tasks.mdの2.1・4.1・4.2・5.1・5.7・6.1・6.2・6.3・7.1・8.1・8.3・8.4。
- **後続specへの影響(各specが参照を直す必要がある)**: `PurchaseFulfillment`・`SubscriptionEventSink`・`FulfillmentPlan`・`PurchaseKindRegistration`を実装・登録するtournament-week・tournament-year・sponsorship・ultras-subscriptionは、これらを`workers/payments/fulfillment-contract.ts`から読み込み、`PurchaseOfferPolicy`・`PurchaseOfferRequest`・`PurchaseOffer`・`SubscriptionChange`は`core/payments/purchase-kind-contract.ts`から読み込む。`PaymentRefunds.prepare`を自分の一括の書き込みに含める後続spec(tournament-week・tournament-year・sponsorship・ugc-moderationなど)は、`PaymentRefundStatements`(`PAYMENTS_TYPES.PaymentRefundStatements`)をinfrastructure層または`workers/<ドメイン>`から呼び、application層には書き込みの単位のポートを置く。`OpenCheckoutExpirer`・`PaymentRefunds.request`・`StripeGateway`・`CustomerDirectory`・`PriceCatalog`・`PaymentHistoryExport`・`PaymentRevenueReport`を受け取るapplication層(ultras-subscription・tournament-week・tournament-year・ugc-moderation・data-export・sponsorship)は`core/payments`から読み込む。ultras-subscriptionは本改訂と同時に直した。他のspecは並行して直す。
- 要件と受け入れ基準は変えていない。タスクの番号は変えていない。

---

## 実装前のギャップ分析(2026-11-05、`/cc-sdd:kiro-validate-gap`)

### 分析の前提と方法

- **状態**: 要件・設計・タスクは承認済みで、タスクは52件すべて未着手である。タスク1.1の前提の上流(dev-tooling・backend-platform・api-gateway・email-delivery・frontend-platform・infra-delivery・content-processing・media-pipeline・identity-auth・admin-foundation・legal-pages)はすべて実装を終えている。本specの設計は、上流の大半の実装より前に書かれた。
- **方法**: 設計が「既にある」と前提にする上流の型・関数・ファイル・設定値・文書を、backend-platformとapi-gateway、identity-authとemail-deliveryとlegal-pages、frontend-platformとclient、DBとWranglerとシークレットと文書の4つの領域に分けて、実際のコードと突き合わせた。npmの版は、公開日をレジストリから取得して確かめた。本specが新しく作るものが無いことは前提どおりのため、ギャップとして数えない。
- **結論の要約**: 上流の契約の名前・置き場所・形は、大半が設計どおりに存在する。Stripeに関する実装はリポジトリにまだ無い。食い違いは次の3種に分かれる。(1)プロジェクトの規則・前例と衝突する設計が6点。(2)既存の「値の一覧を完全一致で確かめるテスト」とテスト用の束縛が本specの追加で壊れるのに、Modified Filesに無いものが多数。(3)上流が先に済ませたため確かめるだけになった作業。

### 要件と資産の対応

| 要件                                        | 使う上流の資産(実在を確認)                                                                                                                                                                                                                                                                                                                                          | ギャップ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Customerの管理・14 ライフサイクルへの追随 | `UserContactDirectory.findContact`(api・eventの両方に束縛、退会済み・物理削除済みで`undefined`)、`UserLifecycleAsyncRegistration`(`{ name, events, order, handler }`)、`USER_LIFECYCLE_ASYNC_HANDLERS`(event)。イベント名`withdrawn`・`suspended`・`purge_due`、`order` 400・410は空き。`users`の行は全波及処理の後に消えるため、外部キー(`onDelete`無し)と整合する | 小: Allowed Dependenciesの`UserRecord.pseudonymousId`の`UserRecord`はapi専用の型で、共有の契約は`CurrentUser.user.pseudonymousId`(`UserAccountView`、`core/identity/account-guard.ts:9`)。`AccountGuard`の束縛はapiだけ(設計もapiでだけ使う)                                                                                                                                                                                                                                                                                 |
| 2 購入種別の口・6〜7 Webhookと反映          | `defineMessageContract`・`MessageHandlerRegistration`・`RetryPolicy`(上限6回)・`excludePath`(既存テストが`/webhooks/stripe`を例に使う)、`AppModule.routes`による経路の登録(`registerEmailSmokeRoute`の前例)                                                                                                                                                         | Constraint: 版の検査の専用テーブル`payment_batch_guards`は前例の無い型である(下の「規則・前例と衝突する設計」の5)。小: eventのHTTPの経路は`presentation/<ドメイン>/`に置く前例で、`presentation/http/`は前例が無い                                                                                                                                                                                                                                                                                                           |
| 3 決済の開始(回数制限・bot判定)             | `RateLimitCounterClient`・`hashRateLimitKey`、前例`CounterMailSendLimits`(infrastructure層)と`MailSendLimits`(application層のポート)、`GraphQLContext.assertHuman`。規則名`payments-checkout:user`は`backend/003`の命名に合う                                                                                                                                       | Missing: application層のエラーコードの置き場所。前例は`application/<ドメイン>/<ドメイン>-errors.ts`(例: `inquiry-errors.ts`)で、presentationの`errors.ts`は入力の検証の文言だけを持つ。設計は`presentation/.../payments/errors.ts`だけを置く                                                                                                                                                                                                                                                                                 |
| 4 決済画面・13 価格の表示                   | `CLIENT_SECURITY_POLICY`と`SecurityPolicySources`(`frameSrc`・`permissions.payment`を持ち、設計の値の表記`['self', '"https://js.stripe.com"']`は型のコメントの例と一致)、`Checkbox`(作成済み)、`NumberText`(`Intl.NumberFormatOptions`を受けるため`MoneyText`は薄い包みで作れる)、`LEGAL_DOCUMENT_PATHS['legal-notice'] = '/legal'`                                 | Constraint: `STRIPE_PUBLISHABLE_KEY`の追加手順の前例の指定が誤り(下の2)。Constraint: CSPの許可先は`https://<ホスト>`だけで、ワイルドカードは全要求の500になる。Unknown: Stripeの現行の案内が求める許可先。Missing: 4.12の「決済の画面だけで読み込む」の検証の手段(clientにチャンクの検査は無い)、Stripe.jsの読み込みの失敗と`confirm()`の想定外の失敗をエラートラッキングへ送るか                                                                                                                                            |
| 5 決済後のランディング                      | `graphqlMutationOptions`、`PathLink`(未作成の経路へのリンク)                                                                                                                                                                                                                                                                                                        | Constraint: ページを開いた時に変更`confirmCheckoutReturn`を自動で呼び、3秒ごとに最大20回繰り返す設計は、`006-data-fetching.md:220`の「変更は利用者の操作を受けた部品から行う」と食い違う(下の1)。Missing: 導線の`/my/products`・`/settings/plan`・`/settings/sponsorships`は未作成の経路で、型付きの`Link`では型エラーになる。Allowed Dependenciesに`PathLink`が無い                                                                                                                                                         |
| 8 返金・9 チャージバック・10 突合           | `ScheduledJobDefinition`(`{ name, at, order, handler }`)、`toUtcCronExpression`(23:40は`40 7 * * *`で正しい)、`SCHEDULED_RUN_BUDGETS`(4:21に合計300秒)                                                                                                                                                                                                              | Missing: 4:21の2ジョブが合計300秒の予算を共有することが設計に無い。Constraint: `apps/api/src/composition/inquiry-module.worker.test.ts:467`が、`order` 300の次のジョブを`media-pipeline.expired-file-erasure`と確かめており、400・410を足すと壊れる。23:40に予算を足すなら`cron-sync.unit.test.ts:163-167`(予算は4:21の1件だけ)も壊れる                                                                                                                                                                                      |
| 11 購入確認メール                           | `defineEmailKind`・`EMAIL_KINDS`・`defineEmailTemplate`・`EMAIL_TEMPLATES`・`EmailSender`・`formatUtcDateTime`・`linkUrlSchema`。テンプレートの無い種別があるとeventの読み込みで例外になるため、種別とテンプレートは同じタスクで足す(タスク2.4は正しい)                                                                                                             | 小: `defineEmailKind`は`category`(`'transactional' \| 'notification'`)が必須で、設計に記載が無い(タスク2.4にだけ「トランザクションメール」とある)。前例は種別を`kinds/<ドメイン>.ts`の1ファイルにまとめる。`kinds/index.unit.test.ts`へ2種の確認を加える                                                                                                                                                                                                                                                                     |
| 12 決済履歴                                 | `SETTINGS_NAV_ITEMS`(`order` 70はコメントで予約済み)、`settings/route.tsx`が`SettingsShell`で包むレイアウト、`CURSOR_PAGE_ARGS`・`toConnection`、`PageNavigation`とカーソルの記録(`006`・inquiry-chatの`/contact`の前例)                                                                                                                                            | Constraint: `settings-nav-order.unit.test.ts:38-43`が一覧を完全一致で確かめる。小: 設計1645行の「`SettingsShell`の中に置く」はレイアウトで満たされ、ページで包むと二重になる。小: 「さらに表示」の続きの読み込みは、前後のページ送り(`PageNavigation`)の前例と異なる新しい型である(要件12.2はどちらでも満たす)                                                                                                                                                                                                               |
| 12.7 保持・12.10 純収益                     | `AppError`                                                                                                                                                                                                                                                                                                                                                          | 小: 設計1316行の`AppError(invalid_argument)`は存在しない種類で、`bad_request`になる                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 15 決済環境の設定と運用                     | `WORKER_SCOPED_SECRETS = ['STRIPE_API_KEY']`(`scripts/delivery/core/secret-scope.ts:30`)、`/workers/api`・`/workers/event`のフォルダ、`run-with-secrets --scope local --worker`、Stripe CLI 1.55.1(Dockerfile)と`stripe login`の手順、eventのポート48043                                                                                                            | Constraint: Wrangler設定の完全一致のテスト(下の3)。Constraint: 必須のシークレット(下の4)。小: 疎通確認の前例(メール・メディア)は秘密のトークンの経路で、`PAYMENTS_SMOKE_ENABLED`の変数による切り替えは新しい型である。認証付きのGraphQLの変更操作のため理由はあるが、設計に理由が無い                                                                                                                                                                                                                                        |
| 16 ドキュメントとテスト                     | 文書の番号`external/007`・`backend/009`・`operations/004`・`features/004`は空き。drizzle-kitは部分一意索引の`.where()`と`check()`を生成する(identity-authの前例)                                                                                                                                                                                                    | Constraint: `apps/api/src/composition/graphql-modules.worker.test.ts:19`がコミットした`generated/schema.graphql`と一致を確かめる。タスクにapiの`bun run graphql:generate`が無い。Constraint: E2Eの「対象0件の表示」は実行するテストファイルが0件の時の規約で、環境によって個々のテストを飛ばす仕組みではない。`e2e/`に`test.skip`の前例も無い。小: `db/002:75-77`により、部分一意索引への`onConflictDoNothing({ where })`はrc.5で不正なSQLになるため、`payment_records`のupsertは`onConflictDoUpdate({ targetWhere })`で書く |

### 規則・前例と衝突する設計

1. **決済後のランディングの変更操作**: `006-data-fetching.md:220`は変更を利用者の操作を受けた部品から行い、`loader`で行わないと定める。設計の`/checkout/return`は、ページを開いた時に`confirmCheckoutReturn`を呼び、`PROCESSING`の間は繰り返す。呼ぶ場所(`loader`か部品か)と、変更の`retry: false`(`006:263`)の下での繰り返しの方法も定めていない。
2. **公開キーの追加手順**: 設計(Modified Files)は「content-processingの`CLIENT_SITE_ORIGIN`の追加と同じ手順」とするが、`CLIENT_SITE_ORIGIN`は両アプリで必須の変数である。client専用の前例は`WEB_ANALYTICS_TOKEN`で、共有のスキーマで任意(`optionalText`)にし、`FrontendAppProfile`の欄で管理者側に`undefined`を渡す(`frontend-env.ts:104・146`)。`apps/{client,admin}/test/config/worker-env-contract.ts`が、スキーマの必須のキーがすべてEnvにあることを型で確かめるため、必須にすると管理者側の型検査と起動の検証が失敗する。`FrontendAppProfile`に決済の有無の欄は無い。`PublicRuntimeConfig`に欄を足すと、オブジェクトを直に書いた約19ファイル(`test/page-router.tsx`・`.storybook/preview.tsx`・各ブラウザテストなど)の修正が要る。
3. **Wrangler設定の完全一致のテスト**: `apps/api/test/config/wrangler-config.unit.test.ts`は、apiのsecrets(:354-361)とvars(:371-381)を除外なしで、eventのsecretsとvars(:363-369・:383-392)を`DELEGATED_KEY_PATTERNS`で除いて完全一致で比べる。`STRIPE_*`・`PAYMENTS_*`はどの除外にも当たらない。メール・検索・メディアは`apps/api/test/support/wrangler-config.ts`の`*_CONFIG_KEY_PATTERN`と専用のテスト(`<ドメイン>-wrangler-config.unit.test.ts`)へ切り出している。identity-authは共通のテストの期待を直した(2026-11-02の開発者の決定)。clientは`apps/client/test/config/wrangler-config.unit.test.ts:268・285`が完全一致で比べる。
4. **必須のシークレットとテスト用の束縛**: `STRIPE_API_KEY`・`STRIPE_WEBHOOK_SECRET`をローカルでも必須にすると、Infisicalの`dev`に登録するまで、各開発者のローカルとCIのE2E(`checks.yml`→`e2e-stack-plan.ts`、`--worker`で注入)で、api・eventの`/health`以外の全経路が500になる。疎通確認のトークンは未登録でも起動する作りで、identity-authの`DISIFY_API_KEY`はstaging・prodだけで必須にした。また`apps/api/vitest.worker.config.ts:21`・`apps/event/vitest.worker.config.ts:55`の`bindings`へテスト用の値を足さないと、Workers統合テスト全体の環境の検証が失敗する。`STRIPE_WEBHOOK_SECRET`は各開発者の`stripe listen`のログインに結び付くため、`dev`の`/`に1つの値を共有する方式には限界がある。
5. **版の検査の専用テーブル**: 設計1734行は`payment_batch_guards`(一括の書き込みの中で挿入して消す行)を「legal-pages・identity-authと同じ方式、`db/005`」とするが、どちらとも異なる。identity-auth・admin-foundation・inquiry-chatは、業務のテーブルへ`CASE WHEN … THEN id ELSE NULL END`で挿入し、NOT NULLの違反で取り消す(`d1-user-lifecycle-committer.ts:47-49`など)。legal-pagesは`meta.changes`で判定する。手順の本体は`db/002-d1-constraints.md:139-160`にあり、`db/005`は`meta.changes`の方式だけを扱う。共有の補助関数は無い。専用のテーブルは`db/002:160`の条件(他の文がNULLを入れ得ない列)を満たすが、新しい型である。
6. **主キーと共通カラム**: 設計1672行は「IDはULID、`timestamps()`を持つ」とするが、`payment_customers`(`user_id`)・`payment_stripe_objects`(`object_id`)・`payment_price_snapshots`(`lookup_key`)・`payment_batch_guards`(`token`)は自然キーを主キーにする。`db/003-schema-conventions.md:104・109・176`は全テーブルに`ulidPrimaryKey()`と`timestamps()`を求める。例外の前例(`inquiry-message-attachments.ts:22`の複合主キー)はあるが、設計に例外の理由が無い。

### Modified Filesに無い既存の完全一致のテストと設定

| ファイル                                                                                                                                                                   | 壊れる理由                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `apps/api/test/config/wrangler-config.unit.test.ts:354-392`・`apps/api/test/support/wrangler-config.ts`                                                                    | api・eventのsecretsとvarsの完全一致(上の3)                                            |
| `apps/api/vitest.worker.config.ts:21`・`apps/event/vitest.worker.config.ts:55`                                                                                             | 必須のシークレットのテスト用の値(上の4)                                               |
| `apps/api/src/composition/inquiry-module.worker.test.ts:467`                                                                                                               | 4:21の`order` 300の次のジョブの名前                                                   |
| `apps/api/src/presentation/graphql/generated/schema.graphql`(`graphql-modules.worker.test.ts:19`)                                                                          | apiの`bun run graphql:generate`による再生成                                           |
| `apps/client/test/config/composition.unit.test.ts:47-52`                                                                                                                   | `CLIENT_SECURITY_POLICY`の完全一致                                                    |
| `apps/client/src/components/settings/settings-nav-order.unit.test.ts:38-43`                                                                                                | `SETTINGS_NAV_ITEMS`の完全一致                                                        |
| `apps/frontend-lib/server/env/frontend-env.unit.test.ts:411-449`・`apps/client/test/config/wrangler-config.unit.test.ts:268・285`・`worker-env-contract.ts`(client・admin) | 公開設定とclientのvarsの完全一致(上の2)                                               |
| `apps/backend-lib/core/email/kinds/index.unit.test.ts`                                                                                                                     | 壊れないが、種別ごとの名前と`category`の確認を加える前例                              |
| `docs/GUIDES/tech/frontend/005-shared-components.md:35-51`                                                                                                                 | 部品の一覧に`components/payments/`の分類が無い(`MoneyText`を共通部品に置く根拠も要る) |

壊れないことを確かめたもの: `apps/db/schema/index.unit.test.ts`(包含の確認)、`core/messaging/contracts/index.unit.test.ts`(重複と包含)、`templates/index.worker.test.tsx`(整合)、`apps/api/src/index.worker.test.ts`(本specはエクスポートを足さない)、`cron-sync.unit.test.ts`(3環境に`40 7 * * *`を足せば通る)、`apps/client/test/config/static-headers.unit.test.ts`(`_headers`は`CLIENT_SECURITY_POLICY`を参照しない)、`e2e/support/security-assertions.ts`(完全一致の検査が無い)。

### 上流が済ませたため確かめるだけになった作業

- frontend-libの`Checkbox`(`components/ui/checkbox/checkbox.tsx`)は作成済みである。props はRadixの`Checkbox.Root`のpropsで、前例`register-form.tsx:148-153`は`checked === true`で真偽値にしている。
- `WORKER_SCOPED_SECRETS`には`STRIPE_API_KEY`が既に入っており、`/workers/api`・`/workers/event`のフォルダと`run-with-secrets --scope local --worker`も実装済みである。`project-values.md:456`は、paymentsが`/workers/*`の行を加えると予告している。
- Stripe CLI(1.55.1)は開発コンテナに入っており、`docs/onboardings/README.md:44-49`に`stripe login`の手順がある。
- `tech-stack.md:153-161`には「決済サービス」の節が既にあり、本specは追記だけを行う。
- `003-privacy-policy-outline.md`は、委託先の一覧にStripeの行(:51。渡す情報は「メールアドレス、決済内容」だけ)と、国外移転の共通の記載(:66・:69)を持つ。足すのは`### Stripe(決済)`の項(委託先の一覧の順でCloudflareとAWSの間)と、渡す情報の仮名化IDと請求先住所である。`001-compliance-policy.md`はStripeのCookie(:89-97)とStripe側の保持(:64)を持ち、足すのは「データの保存場所」の箇条(:78〜)だけである。「国外移転の記載事項」の節は003にしか無い。
- `002-page-layouts.md`には`/checkout/return`(:20)・`/settings/billing`(:362)・「決済前の最終確認画面」の節(:413-422)が既にある。足すのは`/checkout/{購入ID}`・アンカー無しの`/legal`・請求先住所・ランディングの状態表示である。
- `003-text-and-copy-rules.md:263`に決済サービスの縮退の文言がある。件名の表と、受付終了・カードの拒否・処理中・自動返金の文言は無い。
- `excludePath`、CSPの`permissions.payment`の型と表記、4:21の`order` 400・410、23:40のcron式、文書の番号は、いずれも設計どおりに使える。OpenTofuはホスト名単位の経路で、経路ごとの規則が無いため、インフラの変更は要らない。

### 設計の記述と実装の小さな食い違い

| 箇所                           | 設計の記述                                                                                      | 実装                                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed Dependenciesの仮名化ID | `UserRecord.pseudonymousId`                                                                     | `UserRecord`はapi専用。共有の契約は`CurrentUser.user.pseudonymousId`(`UserAccountView`)                                                                                                                     |
| メールの種別                   | `kinds/payments-purchase-confirmation.ts`・`payments-automatic-refund.ts`、`category`の記載なし | 前例は`kinds/<ドメイン>.ts`の1ファイル。`category`は必須                                                                                                                                                    |
| `/settings/billing`            | `SettingsShell`の中に置く                                                                       | `settings/route.tsx`のレイアウトが既に包む                                                                                                                                                                  |
| 法務文書の追記先               | 001と003に「国外移転の記載事項」の項                                                            | 項は003だけ。001は保存場所の箇条だけ                                                                                                                                                                        |
| 版の検査の根拠                 | `db/005`、legal-pages・identity-authと同じ方式                                                  | `db/002:139-160`。専用テーブルは前例が無い                                                                                                                                                                  |
| apiの識別子のファイル          | `application/payments/api-payments-types.ts`                                                    | 前例は接頭辞無しの`<ドメイン>-types.ts`(`identity-types.ts`・`inquiry-types.ts`)。eventの`event-payments-types.ts`は前例どおり                                                                              |
| Webhookの経路の置き場所        | `presentation/http/stripe-webhook-route.ts`                                                     | 前例は`presentation/<ドメイン>/`(`email/`・`media/`・`smoke/`)                                                                                                                                              |
| `@stripe/stripe-js`の版        | design.mdは10.0.x、research.md:85は2026-11-05以降なら10.1.0                                     | 公開から2週間を過ぎた最新は10.1.0(10-13)で、10.0.xと矛盾する。tasks.md:6は「10系」。`stripe`は23.0.1(10-22)、`@stripe/react-stripe-js`は7.0.0(10-01)で設計どおり。7.0.0のpeerは`@stripe/stripe-js >=10 <11` |
| ページのhead                   | `buildPageHead`                                                                                 | clientは包みの`buildSitePageHead`(`client/src/head/page-heads.ts`)を使う                                                                                                                                    |
| Existing Architecture Analysis | 上流の実装の完了を前提にする                                                                    | 実装済み。`Checkbox`は「identity-authのタスク10.4が新設する」ではなく作成済み                                                                                                                               |
| 純収益の入力の検証             | `AppError(invalid_argument)`                                                                    | `AppErrorKind`に無く、`bad_request`                                                                                                                                                                         |
| `stripe-loader.ts`の置き場所   | `components/payments/`、単体テストだけ                                                          | clientのブラウザテストのカバレッジは`src/components/**`が対象で、分母に入る                                                                                                                                 |
| 日次タイムライン               | (本specの外)                                                                                    | inquiry-chatの4:21のジョブ(`order` 300)が`007-daily-timeline.md`の表から漏れている                                                                                                                          |

### 対応の選択肢

#### Option A: 設計を変えず、各タスクの中で食い違いを吸収する

- 規則と衝突する6点と、完全一致のテストの更新を、実装者がタスクの実行中に判断して直す。
- ✅ 文書の改訂の手間が無く、すぐ着手できる。
- ❌ ランディングの変更操作・公開キー・必須のシークレットは、選び方で他のアプリ(admin)とCIに影響し、実装者の判断に任せられない。承認済みの設計と実装が食い違ったまま進み、`/cc-sdd:kiro-review`のたびに同じ指摘が出る。版の検査の型は後続spec(tournament-week・sponsorshipなど)が`PaymentRefundStatements`を通して同じ一括の書き込みに乗るため、後から変えると波及する。

#### Option B: 実装の前に設計とタスクをすべて改訂する

- 本分析の全項目(小さな食い違いを含む)をdesign.md・tasks.mdへ反映し、必要なら`/cc-sdd:kiro-validate-design`で確かめ直してから実装する。
- ✅ 設計が実装の正となり、後続specへの影響も先に洗い出せる。
- ❌ 設計は1,800行あり、小さな項目まで直すと改訂の量が大きい。

#### Option C: 規則と衝突する項目と下流へ波及する項目だけを先に改訂し、他はタスクの注記にする(混成)

- 先に改訂する項目:
  1. 決済後のランディングの変更操作(部品のマウント後の効果から`useMutation`で呼び`006`に例外を加えるか、反映を別の形にするか)と、繰り返しの方法
  2. `STRIPE_PUBLISHABLE_KEY`の扱い(`WEB_ANALYTICS_TOKEN`と同じく共有のスキーマで任意にし、`FrontendAppProfile`の欄で管理者側に渡さない形)と、未設定の時の決済画面の表示
  3. Wrangler設定の完全一致のテスト(専用の`payments-wrangler-config.unit.test.ts`と`PAYMENTS_CONFIG_KEY_PATTERN`への切り出しか、共通のテストの期待の修正か)
  4. Stripeのシークレットを必須にする環境(ローカルでも必須にしてInfisicalの`dev`への登録をタスク1.1の前提にするか、staging・prodだけで必須にしてローカルは未設定でも起動するか)と、`STRIPE_WEBHOOK_SECRET`の開発者ごとの値の扱い
  5. 版の検査の型(専用テーブル`payment_batch_guards`を残して`db/002`に新しい型として加えるか、既存と同じく業務のテーブルへの`CASE`の挿入にするか)と、自然キーの主キー・共通カラムの例外の明記
  6. application層のエラーコードの置き場所(`application/payments/payments-errors.ts`)
- タスクの注記にする項目: 上の「Modified Filesに無い既存の完全一致のテストと設定」の表の各行、4:21の予算の共有、`PathLink`、E2Eを飛ばす条件と表示、`graphql:generate`、Stripe.jsの失敗のエラートラッキング、4.12の検証の手段、`005`の部品の一覧への追記、「さらに表示」と`PageNavigation`、小さな食い違いの表の各行。
- ✅ 規則の違反・adminとCIへの影響・後続specへの波及を実装の前に防ぎ、改訂の量を抑えられる。
- ❌ 注記と設計の本文の両方を見る必要がある。

### 規模とリスク

- **規模: XL(2週間以上)** — タスク52件で、DB(7テーブル)・backend-lib・api・event・client・E2E・文書のすべての層にまたがり、外部サービスとの通信を新しく作る。上流の契約は揃っているため、規模を押し上げているのは本spec自身の範囲である。
- **リスク: High** — 金銭を扱い、Stripeとの通信が4つの入口(Webhook・`return_url`・突合・日次の確認)と非同期の返金にまたがる。SDK v23とAPI版`2026-09-30.endive`、workerdでのWebhookの署名の検証、Payment Elementの`ui_mode: 'elements'`はリポジトリで初めて使う。上流の契約は実在し、規則と衝突する6点は実装の前に直せば手戻りにならないが、CSPの許可先とE2Eの実行環境は確かめるまで分からない。

### 設計フェーズへの申し送り

- **推奨**: Option C。規則と衝突する6点は、開発者の判断を得てから設計を改訂する。
- **Research Needed**:
  - Stripeの現行のCSPの案内(Payment Element・Link・住所の入力欄)が求める許可先。ワイルドカード(`https://*.js.stripe.com`など)や`https://maps.googleapis.com`などの別のホストが要る場合、`SecurityPolicySources`の許可先の形の規則と衝突する(タスク10.1の「保留して報告」に当たる)。
  - CIのE2E(GitHubのランナー。`stripe listen`は無い)で、`return_url`からの反映だけで決済の完了まで辿れるか。辿れなければE2Eを飛ばす条件と表示を設計で定める。
  - `@stripe/stripe-js` 10.1.0と`@stripe/react-stripe-js` 7.0.0の組み合わせで`CheckoutElementsProvider`・`useCheckout`が設計どおりに使えるか。
  - 開発者ごとに異なる`stripe listen`の署名の秘密を、Infisicalの`dev`でどう扱うか(個人の上書きか、ローカルの検証の手順での一時的な注入か)。

## Stripeのパッケージを最新版へ改訂(2026-11-05、開発者の指示)

- **決定**: 開発者の指示で、公開から2週間の待ちを置かず、Stripeの3パッケージを2026-11-05時点の最新版に完全固定する。上の「実装前のギャップ分析」の「設計の記述と実装の小さな食い違い」の表の`@stripe/stripe-js`の版の行は、これで解消した。

| パッケージ                | 改訂前 | 改訂後(公開日)     |
| ------------------------- | ------ | ------------------ |
| `stripe`                  | 23.0.x | 23.1.0(2026-10-29) |
| `@stripe/stripe-js`       | 10.0.x | 10.2.1(2026-11-02) |
| `@stripe/react-stripe-js` | 7.0.0  | 7.0.1(2026-10-26)  |

- **API版の連動**: `stripe` 23.1.0は固定のAPI版を`2026-10-28.endive`に変えた(CHANGELOG)。`stripe`の型は`StripeConfig.apiVersion`を`LatestApiVersion`(固定のAPI版のリテラル)に限るため、`2026-09-30.endive`を渡すと型検査が失敗する。そのため、API版も`2026-10-28.endive`に改めた。同じ`endive`の月次の版で、CHANGELOGの範囲では、本specが使う決済セッション・Linkの資金源・定期課金の`cancel_at`・返金・Webhookの署名の検証の挙動を変える記載は無い。
- **`useCheckout`の非推奨**: `@stripe/react-stripe-js`は7.0.0・7.0.1とも`useCheckout()`に`@deprecated`を付け、`CheckoutElementsProvider`の中では`useCheckoutElements()`を使うよう案内する。基底の静的解析の設定は`@typescript-eslint/no-deprecated`を`error`にするため、設計の`useCheckout`を`useCheckoutElements`に改めた。戻り値の形(`loading`・`success`・`error`)は同じである。7.0.1のpeerは`@stripe/stripe-js >=10.0.0 <11.0.0`で、10.2.1と組み合わせられる。
- **変えた箇所**: payments(requirements.mdのQ6・API版の記述、design.mdのBoundary・Allowed Dependencies・Technology Stack・Migration Strategy、tasks.mdの1.1・3.1)、ultras-subscription(requirements.mdの仮5、design.md、research.mdのAPI版の記述)、launch-readiness(design.mdのC-06、research.mdのAPI版の記述)。paymentsのbrief.mdと、research.mdの過去の調査の記録(Q6の選択肢・「Stripe API版`2026-09-30.endive`とSDK v23」の節)は、当時の記録として残す。
- **Research Needed**: `stripe` 23.1.0のCHANGELOGは、`Dispute.status`に`appeal_needs_response`・`appeal_under_review`(チャージバックの敗北の後の不服申し立て)を加えた。設計の反映は`charge.dispute.funds_withdrawn`・`funds_reinstated`・`closed`の段階ごとに記録し、`closed`かつ`lost`で`dispute_lost`を挿入する。不服申し立てで敗北の後に勝った場合、`dispute_lost`の行と`funds_reinstated`の`dispute_won`の行が両方残り、`PaymentRevenueReport`の純収益が敗北の額を差し引いたままになる。`closed`の通知が2回届くかどうかも含め、Stripeの文書で不服申し立ての通知の順序を確かめ、要件9・12.10の記録と集計の規則を見直す必要がある。

## 実装前のギャップ分析への開発者の回答の反映(2026-11-05)

- **状態**: 上の「実装前のギャップ分析」の「規則・前例と衝突する設計」6点について、開発者へ1件ずつ選択肢を示して決定を得た。決定に従ってdesign.md・tasks.mdを改訂した。要件と受け入れ基準は変えていない。

### 決定

| 項目                                 | 決定                                                                                                                                                                                                                                                                                                                                                             | 推奨との違い                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 決済後のランディングの変更操作       | `confirmCheckoutReturn`を`loader`では呼ばず、`CheckoutReturnStatus`のマウント後の効果から`useMutation`で1回呼ぶ。`PROCESSING`の間は部品の中のタイマーで3秒ごとに最大20回呼び直す(変更の`retry: false`は変えない)。`006-data-fetching.md`の「変更」の節に、冪等で画面への到達そのものが利用者の操作に当たる確定は、マウント後に呼んでよいという例外を加える       | 推奨どおり                                                 |
| 公開キー`STRIPE_PUBLISHABLE_KEY`     | `WEB_ANALYTICS_TOKEN`と同じく、共有の環境のスキーマで任意(`optionalText`)にし、`FrontendAppProfile`に決済の有無の欄(`payments`)を加えて、管理者側には`undefined`を渡す。clientのWranglerには3環境とも置く。`PublicRuntimeConfig.stripePublishableKey`は`string \| undefined`で、無ければ決済画面は「決済を利用できない」の表示にする                             | 推奨どおり                                                 |
| Wrangler設定の完全一致のテスト       | メール・検索・メディアの前例と同じく、`apps/api/test/support/wrangler-config.ts`に`PAYMENTS_CONFIG_KEY_PATTERN`(`/^(?:STRIPE_\|PAYMENTS_)/`)を加えて共通のテストから除き、`payments-wrangler-config.unit.test.ts`で確かめる。eventの`CLIENT_SITE_ORIGIN`は汎用の変数のため、共通のテストの期待に加える                                                           | 推奨どおり                                                 |
| Stripeのシークレットを必須にする環境 | identity-authの`DISIFY_API_KEY`と同じく、`STRIPE_API_KEY`・`STRIPE_WEBHOOK_SECRET`はstaging・prodだけで`secrets.required`に置き、環境の検証も任意にする。未設定のローカルとCIでは、`StripeGateway`・`StripeWebhookVerifier`が`StripeUnavailableError`を投げ、決済の機能だけが縮退(`payments_unavailable`、Webhookは503)になる。決済のE2Eは、キーが無ければ飛ばす | 推奨どおり                                                 |
| 版の検査付きの一括の書き込み         | 専用テーブル`payment_batch_guards`をやめ、identity-auth・admin-foundation・inquiry-chatと同じく、一括の書き込みの先頭の業務の行の挿入で、NOT NULLの列に「版が一致すれば値、一致しなければNULL」を入れる(`db/002`の「版の検査で一括の書き込み全体を取り消す」)                                                                                                    | 推奨(専用テーブルを残し、`db/002`に型として加える)と異なる |
| 主キーと共通カラム                   | `db/003`どおり、全テーブルを`id`(`ulidPrimaryKey()`)の主キーと`timestamps()`にし、自然キー(`payment_customers.user_id`・`payment_stripe_objects.object_id`・`payment_price_snapshots.lookup_key`)は一意索引にする                                                                                                                                                | 推奨(自然キーを残し、例外の理由を明記する)と異なる         |

### 版の検査の当てはめ

- **購入の確定と拒否**(決済セッションの反映): どちらの一括の書き込みも決済履歴の行を必ず挿入するため、先頭を`payment_records`の挿入にし、`pseudonymous_id`を`CASE WHEN (SELECT state_token FROM payment_purchases WHERE id = ?) = <読み取った版> THEN <仮名化ID> ELSE NULL END`にする。続けて購入を前進させ(新しい`state_token`)、残りの文(権利の付与・返金の依頼・購入確認メールの依頼待ち)を置く。初回の請求の行が先に記録されていて一意キーと衝突しても、SQLiteはNOT NULLの制約を一意性より先に確かめるため、版の検査は働く(衝突は`DO NOTHING`)。これをWorkers統合テストで確かめる。
- **定期課金の状態**: 先頭を`payment_stripe_objects`への挿入(`object_id`の一意索引で`DO UPDATE`)にし、`last_event_at`を`CASE WHEN EXISTS (SELECT 1 FROM payment_stripe_objects WHERE object_id = ? AND last_event_at > ?) THEN NULL ELSE ? END`にする。同じか新しい発生時刻だけが通り、古い通知は後続specの`SubscriptionEventSink`の文を含めて全体が取り消される。`payment_stripe_objects`の`state_token`は要らなくなる。
- **1文だけの前進**(失効・処理中への前進): 他の文を伴わないため、`UPDATE … WHERE status IN (…)`の`meta.changes`で判定し、版の検査を使わない。
- **失敗の判別**: `GuardedBatch.run`は、`NOT NULL constraint failed: payment_records.pseudonymous_id`・`payment_stripe_objects.last_event_at`の違反を`cause`をたどって`guard_failed`に変え、他の制約の違反(`exclusivity_key`の部分一意索引・後続specの文)を`constraint_failed`にする。検査に使う2つの列は、他の文がNULLを入れない列である。
- 版の検査に使う列と文の組み立ては`statement-contracts.ts`の契約(`PaymentRecordStatements.insertCheckoutRecordGuarded`・`StripeObjectStatements.advanceGuarded`)に閉じ込め、後続specの契約(`PurchaseFulfillment`・`SubscriptionEventSink`)の形は変えない。

### 決定に合わせて加えた漏れ

上の「実装前のギャップ分析」でタスクの注記にするとした項目のうち、漏れに当たるものを決定と合わせて反映した。

- 完全一致のテストと設定の更新先: `apps/api/vitest.worker.config.ts`・`apps/event/vitest.worker.config.ts`のテスト用の束縛(任意にしたため必須ではないが、Workers統合テストで決済を通すために置く)、`inquiry-module.worker.test.ts:467`の4:21の順序、apiの`bun run graphql:generate`による`schema.graphql`の再生成、`composition.unit.test.ts`の`CLIENT_SECURITY_POLICY`、`settings-nav-order.unit.test.ts`の`SETTINGS_NAV_ITEMS`、`frontend-env.unit.test.ts`とclientの`wrangler-config.unit.test.ts`の公開設定とvars、`PublicRuntimeConfig`を直に書いた各ファイル。
- application層のエラーコードと文言を、前例どおり`application/payments/payments-errors.ts`に置く。presentationの`errors.ts`は入力の検証の文言だけを持つ。純収益の照会の入力の誤りは`AppError(bad_request)`にする。
- 4:21の2ジョブが合計300秒の予算(`SCHEDULED_RUN_BUDGETS`)を共有すること。
- 決済後のランディングの導線のうち未作成の経路(`/my/products`・`/settings/plan`・`/settings/sponsorships`)は`PathLink`で描く。
- `005-shared-components.md`の部品の一覧に`components/payments/`の分類(`MoneyText`。後続specの申込の画面も使う)を加える。
- Stripe.jsの読み込みの失敗と`confirm()`の想定外の失敗は`reportUnexpectedErrorInBrowser`で送る。
- 小さな食い違いの表のうち、仮名化IDの型(`CurrentUser.user.pseudonymousId`)、メールの種別の`category: 'transactional'`と`kinds/payments.ts`の1ファイル、`/settings/billing`を`SettingsShell`で包まないこと、法務文書の追記先(003に`### Stripe(決済)`の項、001に保存場所の箇条)、apiの識別子のファイル名(`payments-types.ts`)、Webhookの経路の置き場所(`presentation/payments/`)、`buildSitePageHead`、上流の実装の状況、`Checkbox`が作成済みであること。

### 反映しなかった項目

- 決済履歴の「さらに表示」の続きの読み込み: 要件12.2を満たし、今回の質問の対象外のため変えない。前後のページ送り(`PageNavigation`)の前例と異なる型であることは、タスク10.5の注記に残す。
- CSPの許可先とCIのE2Eの到達性: Research Neededのまま、タスク1.4で確かめて記録し、10.1・11.1が結果に従う。4.12の「決済の画面だけで読み込む」の検証の手段は、今回の質問の対象外のため変えない。
- 不服申し立てのチャージバックの記録(上の「Stripeのパッケージを最新版へ改訂」のResearch Needed): Stripeの文書の確認を待つ。

## 不服申し立てのチャージバックとAPI版の確定(2026-11-05、開発者の決定)

- **API版**: 開発者が、StripeのAPI版を`2026-10-28.endive`とすることを確定した(上の「Stripeのパッケージを最新版へ改訂」で反映済み)。
- **調べたこと**: 上の「Stripeのパッケージを最新版へ改訂」のResearch Needed(不服申し立てで`dispute_lost`と`dispute_won`の行が両方残るおそれ)を、`stripe docs`でStripeの文書(「事前仲裁および仲裁を通じて不審請求の申し立てを管理する」・changelog「不審請求の申し立ての判定に対する異議申し立て用の反証資料提出に対応」)を読んで確かめた。
  - 不服申し立ての状態は`2026-09-30.preview`で加わり、SDKでは`2026-10-28.endive`以降を対象とする版から使える。
  - 不服申し立ての対象になると、状態は審査中(`under_review`)から`appeal_needs_response`へ、反証資料を提出すると`appeal_under_review`へ移る。敗北(`lost`)の後に始まるのではない。
  - 状態の変化は`charge.dispute.updated`で届き、最終の`won`・`lost`に達すると`charge.dispute.closed`が届く。
  - 不服申し立ては、利用資格のある事業者がダッシュボードの不審請求の申し立ての設定で有効化した場合だけ使える。返金不可の申し立て手数料と、仲裁のネットワーク手数料(1件600USDを超え得る)がかかる。
  - したがって、不服申し立てを経ても記録は`disputed`の後に`dispute_won`か`dispute_lost`の一方だけになり、懸念は起きない。
- **決定**: 記録の規則を変えず、不服申し立ての段階を照会・審査中と同じく記録しない段階として扱う(推奨どおり)。購読の15種は変えず、`charge.dispute.updated`は購読しない。`StripeDisputeSnapshot`の状態は文字列で受け、未知の値でも取得と反映が失敗しないようにする。不服申し立ては既定の無効のままにし、有効化する場合の利用資格・手数料・ダッシュボードでの対応を`operations/004`に書く。要件9.4(資金の移動を伴わない段階は記録しない)の範囲のため、要件は変えない。
- **変えた箇所**: design.mdの「StripeClient・StripeGateway・StripeWebhookVerifier」(取得の結果の型)、「PaymentReflector・CheckoutSessionReflection」(チャージバック)、Modified Filesの`operations/004`。tasks.mdの1.4・3.2・5.4。

## タスク1.4の調査: CSPの許可先と転送の無い環境での完了(2026-11-05)

### Stripe.js・Payment Element・Link・請求先住所の入力欄がCSPに求める許可先

- **Sources Consulted**: `stripe docs /security/guide`(Integration security guideの「Content Security Policy」の節、<https://docs.stripe.com/security/guide>)、`stripe docs /elements/address-element`(「Autocomplete」の節、<https://docs.stripe.com/elements/address-element>)、`stripe docs /payments/payment-methods/pmd-registration`(<https://docs.stripe.com/payments/payment-methods/pmd-registration>)。いずれも2026-11-05に参照した。
- **Findings**:

| 対象                                      | 指令                        | 許可先                                                                               | 設計の許可先との差                   |
| ----------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| Stripe.js(Payment Elementを含む)          | `script-src`                | `https://js.stripe.com`(任意で`https://*.js.stripe.com`)                             | 一致(任意のワイルドカードは加えない) |
| Stripe.js                                 | `frame-src`                 | `https://js.stripe.com`・`https://hooks.stripe.com`(任意で`https://*.js.stripe.com`) | 一致                                 |
| Stripe.js                                 | `connect-src`               | `https://api.stripe.com`                                                             | 一致                                 |
| Link                                      | `frame-src`                 | `https://link.com`・`https://*.link.com`                                             | 不足(別のホストとワイルドカード)     |
| Link                                      | `connect-src`               | `https://link.com`・`https://*.link.com`                                             | 不足(別のホストとワイルドカード)     |
| Link                                      | `img-src`                   | `https://*.link.com`                                                                 | 不足(ワイルドカード)                 |
| 請求先住所の入力欄(自社のGoogle Mapsの鍵) | `connect-src`・`script-src` | `https://maps.googleapis.com`                                                        | 不要(自社の鍵を使わない)             |

- Linkの節は「Stripe.jsの許可先に加えて」許可するよう求め、「Linkの認証の画面と静的な資源はStripeが所有する`link.com`のサブドメイン(例: `checkout.link.com`・`statics.link.com`)から配信し、`*.link.com`のワイルドカードで現在と将来のサブドメインを網羅する」と説明する。2026-10-23の調査(「CSP・公開キー・決済画面の部品」)の時点の記録には無かった許可先である。
- `https://*.js.stripe.com`は性能向上のための任意の許可先で、無くても動く(従来どおり)。
- 請求先住所の入力欄は、Payment Elementと併用するとStripeが用意したGoogle Mapsの鍵で住所の補完を行い、`https://maps.googleapis.com`は自社の鍵を使う場合だけ許可が要る。補完はStripeの埋め込み枠の中で動くため、親のページの許可先は増えない見込み(10.1のブラウザテスト・E2EのCSPの違反の検査で確かめる)。
- 3Dセキュアなどリダイレクトを伴う決済手段には`frame-src https://hooks.stripe.com`が要る(設計に含まれる)。
- Apple Pay・Google Pay・Linkは、決済画面を表示するドメインをStripeの「Payment method domains」へsandboxごとに登録する必要がある(Apple Payは必須)。`localhost`は登録できない。CSPとは別の前提として`operations/004`に記載した。
- 現行の文書のCSPの節には`Permissions-Policy`の記載は無い。設計の`payment`の許可(`self`と`https://js.stripe.com`)は変えない。
- **Implications**: frontend-platformの許可先の形(`ORIGIN_PATTERN`は`'self'`・`https://<ホスト>`・`http://localhost:<ポート>`だけを許し、ワイルドカードを例外にする)では、`https://link.com`は加えられるが`https://*.link.com`(`frame-src`・`connect-src`・`img-src`)は加えられない。具体的なサブドメインを列挙する代替はStripeが将来のサブドメインを保証しないため壊れやすい。10.1(CSPの許可先の追加)の前に、ワイルドカードの許可(frontend-platformの許可先の規則の変更)か、Linkを決済手段から外すかを開発者が決める必要がある(Revalidation Triggersの「違反が出た場合はfrontend-platformにサブドメインのワイルドカードの許可を依頼する」に当たる)。
- **10.1での扱い(2026-11-06)**: 許可先の規則は変えず、設計の必須の許可先と規則に合う`https://link.com`(`frame-src`・`connect-src`)だけを`CLIENT_SECURITY_POLICY`に加え、`https://*.link.com`は未登録のまま開発者へ報告した(ワイルドカードを許すか、個別のサブドメインを登録するかの判断待ち)。

### `stripe listen`の転送が無い環境で、`return_url`からの反映だけで完了まで辿れるか

- **状態**: 未確認(開発者のsandboxの準備待ち)。dev用のsandbox・制限付きキー・公開キーが無く、またルートの`secrets.required`にStripeのキーが無いためローカルのWorkerへキーが渡らず、疎通確認の決済をローカルで作れない。
- **Sources Consulted**: design.mdの「PaymentReflector・CheckoutSessionReflection」・`CheckoutReturnConfirmer.confirm`・Decisionsの決済後のランディング(マウント後の`confirmCheckoutReturn`と3秒ごとに最大20回の確かめ直し)、`stripe docs /checkout/fulfillment?ui=checkout-form`(「Trigger fulfillment on your landing page」、<https://docs.stripe.com/checkout/fulfillment?ui=checkout-form>、2026-11-05に参照)。
- **設計上の見込み**: 辿れる見込みである。
  - `CheckoutReturnConfirmer.confirm`は、Webhookの通知を待たず、`retrieveCheckoutSession`でStripeから決済セッションの最新の状態を取得して`reflectCheckoutSnapshot`で反映する。完了(`complete`かつ`paid`)なら購入を確定し、決済履歴を記録し、購入確認メールを依頼するまでを同じ反映で行うため、転送が無くても完了まで進む。
  - Stripeの文書も、Webhookに加えて決済後のランディングから決済セッションを取得して反映することを推奨しており(Webhookの遅れを補うため)、カードのような即時の決済手段では、ランディングへの到達の時点で決済セッションが完了している前提で書かれている。
  - 決済セッションがまだ`complete`でない場合も、画面が3秒ごとに最大20回確かめ直すため、その間に完了すれば反映される。
  - 転送が無い環境では、定期課金の状態(`customer.subscription.*`)・請求(`invoice.*`)・返金(`refund.*`)・チャージバックは反映されない。疎通確認の決済(1回限りの1USD)の完了の確認には影響しない。
- **残る確認**: 開発者の準備の後、ローカルで`stripe listen`を止めた状態で疎通確認の決済を行い、決済後のランディングが完了を表示し、決済履歴に記録され、購入確認メールがMailpitに届くことを確かめ、この節を更新する。11.1の疎通確認の決済のE2E(CIのランナーに転送が無い)は、その結果に従う。
