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
- **Implications**: 反映の部品は`backend-lib`に置き、両アプリで同じ束縛(`PAYMENTS_PLATFORM_MODULE`)を使う。回数制限・突合・日次の確認はapiに、Webhook・返金の実行・波及処理はeventに置く。

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
- **指摘2(収益の照会)**: ugc-moderationの設計が、本specの共有ディレクトリへ収益の照会`PaymentRevenueReport`・`RevenuePeriod`(`core/payments/ports.ts`)、実装`workers/payments/d1-payment-revenue-report.ts`、DIの識別子`PAYMENTS_TYPES.PaymentRevenueReport`と`PAYMENTS_PLATFORM_MODULE`での束縛を加える(作成も利用もugc-moderation)が、本specの再検証の対象とファイルの計画に記録が無かった。純収益は`payment_records`の`kind`・`status`・`purpose`の値と`amount`の符号(返金とチャージバックの損失は負の値)に依存する。
- **決定2**: 設計のRevalidation Triggersに、`payment_records`の`kind`・`status`・`purpose`の値の意味、`amount`の符号の規則、`occurred_at`の意味、`payments_smoke`の扱いを変えるときはugc-moderationを再検証する旨を加えた。Directory Structureの注記とファイルの計画の注記に、ugc-moderationが作成する4か所(`ports.ts`・`identifiers.ts`・`d1-payment-revenue-report.ts`・`payments-platform-module.ts`)を記録した。(この扱いは2026-10-24の確定で、本specが所有・実装する形に改めた。下の「確定(2026-10-24)」を正とする。)DIの識別子は本specの`PAYMENTS_TYPES`である。
- **変更部分のタスクの検証**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定はNEEDS_FIXESだった。1.4がオンボーディングの起動のコマンドを書き換える記述をinfra-deliveryの担当として「止めて報告する」に改め、`_Boundary:_`から外したこと、Workerごとのフォルダへの登録の手順をオンボーディングへ書く作業を1.4に加えたこと、1.4の完了状態を値を出さずに確かめられる形(Workerの指定の有無による起動時の検証の結果)に改めたこと、1.1の完了状態に`WORKER_SCOPED_SECRETS`の確認の記録を加えたことを直した。`PaymentRevenueReport`を本specのタスクにしないことは規則に合うとの判定だった。2回目の判定はPASSだった。軽微な指摘のうち、1.4の`_Boundary:_`にオンボーディング(登録の手順だけ)を加え、1.4の自己参照の文言を改めた。`spec.json`の`updated_at`を更新し、タスクの承認を保った。

### 確定(2026-10-24)

- **Workerごとの制限付きキー**: 推奨どおり確定した(infra-deliveryの改訂1も同日に確定)。
- **収益の照会**: 開発者は「上流specが所有・実装する」案を選んだ(推奨の「ugc-moderationが本specの共有ディレクトリへ作成する」案と異なる)。本specが`RevenuePeriod`・`PaymentRevenueReport.netRevenue(periods)`(`core/payments/ports.ts`)、実装`workers/payments/d1-payment-revenue-report.ts`、`PAYMENTS_TYPES.PaymentRevenueReport`、`PAYMENTS_PLATFORM_MODULE`での束縛を、自分のタスク(2.1の契約、1.3の索引、5.5の実装とWorkers統合テスト、5.7の束縛)で作る。シグネチャはugc-moderationの設計のものをそのまま写した。要件に12.10を加えた。Revalidation Triggersには、利用者としてugc-moderationを残した。
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
