# Implementation Plan

- [ ] 1. 基盤: パッケージ・設定・共有の定義・テーブル・開発用の決済環境
- [x] 1.1 Stripeの3パッケージを導入し、各Workerのシークレットと変数を宣言する
  - 前提: dev-tooling・backend-platform・api-gateway・email-delivery・frontend-platform・infra-delivery・content-processing・media-pipeline・identity-auth・admin-foundation・legal-pagesの全タスクが完了していること(層構成・GraphQL基盤・メール送信・画面の骨格・共有ディレクトリ・ユーザーライフサイクル・利用者の連絡先の照会(`UserContactDirectory`)・設定ページのシェル・`/legal`)。無ければ該当するタスクを保留して開発者へ報告する
  - `stripe` 23.1.0(api・event)・`@stripe/stripe-js` 10.2.1・`@stripe/react-stripe-js` 7.0.1(client)を完全固定で加える(2026-11-05に開発者が決定した版。公開から2週間の待ちを置かない)。より新しい版が出ていても、この版から変える場合は開発者へ確かめる
  - clientの`vitest.browser.config.ts`の事前バンドルの一覧(`PREBUNDLED_DEPENDENCIES`)に`@stripe/stripe-js`・`@stripe/react-stripe-js`を加える(テストの実行中に初めて読み込まれて事前バンドルがやり直されると、ページが再読み込みされReactが2つ読み込まれるため)
  - 先に、Wrangler設定の単体テストを次のように直す。メール・検索・メディアの前例と同じく、`apps/api/test/support/wrangler-config.ts`に`PAYMENTS_CONFIG_KEY_PATTERN`(`/^(?:STRIPE_|PAYMENTS_)/`)を加えて共通の`wrangler-config.unit.test.ts`の比較から除き(除外の無いapiの`secrets.required`・`vars`の比較にも除外を掛ける)、新しい`payments-wrangler-config.unit.test.ts`で、apiの`STRIPE_API_KEY`と`PAYMENTS_SMOKE_ENABLED`、eventの`STRIPE_API_KEY`・`STRIPE_WEBHOOK_SECRET`と`PAYMENTS_SMOKE_ENABLED`の宣言を3環境について確かめる。`STRIPE_API_KEY`・`STRIPE_WEBHOOK_SECRET`はstaging・prodの`secrets.required`にだけ置き、ローカルには置かない(identity-authの`DISIFY_API_KEY`と同じ。2026-11-05の開発者の決定)。eventの`CLIENT_SITE_ORIGIN`は汎用の変数のため、共通のテストの期待に加える。`PAYMENTS_SMOKE_ENABLED`はローカル・stagingで`true`、prodで`false`
  - 先に、clientの設定の単体テスト(`apps/client/test/config/wrangler-config.unit.test.ts`のvarsの完全一致)に`STRIPE_PUBLISHABLE_KEY`を加える。公開キーはclient専用の任意の変数の前例`WEB_ANALYTICS_TOKEN`と同じ形にし、共有の環境のスキーマ(`frontend-env.ts`)に任意(未設定か、`pk_test_`・`pk_live_`で始まる文字列)として加え、`FrontendAppProfile`(`server/entry/app-profile.ts`)に決済の有無の欄`payments`(clientは真、adminは偽)を加え、`toPublicRuntimeConfig`で`PublicRuntimeConfig.stripePublishableKey`(`string | undefined`)へ渡す。adminのWranglerには置かない。`frontend-env.unit.test.ts`の返り値とキーの一覧の完全一致の期待と、`PublicRuntimeConfig`を直に書いた各ファイル(client・adminの`test/page-router.tsx`・`.storybook/preview.tsx`・`test/start-request-fixtures.ts`・ブラウザテストなど)を直す。必須にすると`worker-env-contract.ts`の型の検査と管理者側の起動の検証が失敗するため、任意にする
  - api・eventの環境の検証に、任意の`rk_test_`・`rk_live_`で始まる制限付きキー、任意の`whsec_`で始まる署名の秘密、`true`・`false`の変数、オリジンの形式を加え、形式の誤りが既存の設定の誤りとして検知され、Stripeのキーが無くても起動の検証が成功することをテストで確かめる
  - `apps/api/vitest.worker.config.ts`・`apps/event/vitest.worker.config.ts`の`miniflare.bindings`に、テスト用の`STRIPE_API_KEY`(`rk_test_`で始まる値)とeventの`STRIPE_WEBHOOK_SECRET`を加える(Stripeへの通信は`fetch`の模擬応答で置き換える)
  - 型の生成をやり直し、Infisicalのキーの表と変数の値の表(`docs/onboardings/project-values.md`)に行を加える。`STRIPE_API_KEY`の行はWorkerごとのフォルダ(apiは`/workers/api`、eventは`/workers/event`)で書き、`STRIPE_WEBHOOK_SECRET`の行は`/`で書き、どちらもstaging・prodで必須、devは任意と書く。stagingの値は必須にする変更をmainへマージする前に開発者が登録する必要がある旨(api用とevent用の制限付きキーを別々のWorkerごとのフォルダへ)を、作業の報告に含める(仮7)
  - infra-deliveryの配布のスクリプトのWorkerごとのフォルダからだけ取るシークレットの一覧に`STRIPE_API_KEY`があることを確かめる。無ければ止めて開発者へ報告する(infra-deliveryの改訂1、仮7)
  - `STRIPE_PUBLISHABLE_KEY`は公開の値のためWranglerの`vars`に書く。ローカルとstagingには形式の検証を通る仮の値(`pk_test_`で始まる)を置く。ローカルの値は1.4でdev用のsandboxの公開キーへ置き換え、stagingの値はmainへのマージ前に開発者がstaging用のsandboxの公開キーを用意して置き換える(作業の報告に含める)。prodは、infra-deliveryの`TURNSTILE_SITE_KEY`と同じく形式の検証を通る仮の値(`pk_live_`で始まる)を置き、launch-readinessがライブモードの公開キーへ置き換える
  - 完了状態: 3アプリと管理者側の型検査と設定の単体テストが成功し、staging・prodの設定ではStripeのシークレットが必須として宣言され、ローカルではキーが無くても起動の検証が成功する。infra-deliveryのWorkerごとのフォルダからだけ取るシークレットの一覧に`STRIPE_API_KEY`があること(または無いため止めて報告したこと)が作業の報告に記録されている
  - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] 1.2 購入種別・決済履歴の値・状態の値・同意の文言・金額の共有定義を作る
  - 先に、5つの購入種別と都度決済・定期課金の区分(Ultrasだけ定期課金)と名前、決済履歴の種類と状態の名前、購入の状態・拒否の理由・返金の依頼の状態・メールの依頼の状態の値、同意の文言と版、最小通貨単位の整数の判定(小数・上限超過を拒否)を確かめる単体テストを書く
  - 4アプリが読み込める共有ディレクトリに定義を置き、データエクスポートの`payments.json`の値と一致させる
  - 完了状態: 単体テストが成功し、client・api・eventの型検査で配置先から読み込める
  - _Requirements: 2.1, 4.4, 12.1_

- [x] 1.3 決済の6テーブルを定義し、マイグレーションを作る
  - 先に、6テーブルとも主キーが`id`(`ulidPrimaryKey()`)で`timestamps()`を持つこと(`db/003`。2026-11-05の開発者の決定)、自然キー(`payment_customers.user_id`・`payment_stripe_objects.object_id`・`payment_price_snapshots.lookup_key`)の一意索引、版の検査に使う`payment_records.pseudonymous_id`・`payment_stripe_objects.last_event_at`がNOT NULLであること、各テーブルの列の型・NOT NULL・既定値、状態と種類の値の制約(1.2の共有定義の値と一致すること)、`payment_purchases`の`exclusivity_key`の`status = 'fulfilled'`に限る部分一意索引と検索用の索引、`payment_records`の`(stripe_reference, kind)`(チャージバック以外)と`(stripe_reference, kind, status)`(チャージバック)の一意索引と、収益の照会のための`occurred_at`の索引、`pseudonymous_id`に外部キーが無いこと、`payment_customers`・`payment_purchases`の`users`への外部キーと`payment_refunds`の購入への外部キー、カード番号などの決済情報の列が無いことを確かめる単体テストを書く
  - Stripe Customerの対応・購入・決済履歴・返金の依頼・Stripeのオブジェクトの最終の発生時刻・価格の一時保持の6テーブルを定義し、スキーマの集約点へ加える。版の検査のための専用テーブルは作らない(業務の行の挿入で検査する。4.1)
  - mainの最新を取り込んでからマイグレーションを生成し、衝突したら生成し直す
  - 完了状態: 単体テストが成功し、マイグレーションをローカルに適用でき、同じ`exclusivity_key`の`fulfilled`の行を2つ作れない
  - _Requirements: 1.1, 1.7, 2.4, 6.4, 12.5, 12.6, 12.10, 15.5_

- [ ] 1.4 開発用sandboxの設定と検証の手順を書き、開発者の準備を確かめる
  - 運用手順書(`operations/004`)のうち、環境ごとのStripeの設定(制限付きキーの権限の表と、api用とevent用の制限付きキーをシークレット管理サービスのWorkerごとのフォルダへ別々に登録し、共通のフォルダには置かない手順(仮7)、`lookup_key`付きの価格と税込の設定、税の登録、Adaptive Pricingの無効化、決済手段の設定をカード・Apple Pay・Google Pay・LinkだけにしてKlarnaなどを切ること、不審請求の申し立ての設定の不服申し立て(異議申し立て)を既定の無効のままにすること(有効化する場合の利用資格・手数料・ダッシュボードでの対応)、Webhook endpointのAPI版と15種の購読、ローカルの`stripe listen`の転送と署名の秘密)と、決済手段の検証の手順の節を、本プロジェクト固有の値を含めずに先に書く
  - 開発者が行う作業(dev用のsandboxの作成、devのsandboxの公開キーの取得、apiの制限付きキーのInfisicalの`dev`の`/workers/api`への登録とeventの制限付きキーの`/workers/event`への登録(仮7)、`stripe listen`の署名の秘密のInfisicalの`dev`の`/`への登録、疎通確認用の価格`payments_smoke`(1ドル)の作成、決済手段と税の設定)を一覧にして報告する
  - 1.1で置いたclientのWrangler設定のローカルの`STRIPE_PUBLISHABLE_KEY`の仮の値を、開発者から受け取ったdevの公開キーで置き換え、`project-values.md`の変数の値の表の行に書き込む
  - オンボーディングのAPIサーバーとイベントサーバーのローカルの起動のコマンドが、Workerごとのフォルダを重ねるinfra-deliveryのシークレットの注入のコマンド(ローカルの範囲、Workerの指定付き)の形であることを確かめ、そうでなければ止めて開発者へ報告する(infra-deliveryの8.5の担当。本タスクは書き換えない。仮7)
  - 上の運用手順書の節とは別に、オンボーディングへ、ローカルではStripeのキーが無くても起動し決済の機能だけが「決済を利用できない」になる旨と、決済を試す開発者向けにapi用とevent用のdevの制限付きキーをInfisicalの`dev`の`/workers/api`・`/workers/event`へ登録する手順を書き加える(仮7)
  - Stripeの現行の文書で、Payment Element・Link・請求先住所の入力欄がCSPに求める許可先を確かめ、設計の許可先(`js.stripe.com`・`hooks.stripe.com`・`api.stripe.com`)との差と、ワイルドカードや別のホストが要るかを`research.md`に記録する。要るなら10.1の前に開発者へ報告する
  - CIのE2E(GitHubのランナー。`stripe listen`の転送が無い)で、`return_url`からの反映だけで決済の完了まで辿れるかを、ローカルで`stripe listen`を止めた状態の疎通確認の決済で確かめ、`research.md`に記録する
  - 完了状態: 手順書の節が整形の検査を通り、ローカルの公開キーと`project-values.md`の行が書き込まれ、開発者の準備の完了(または未完了で保留した旨)とCSPの許可先・転送の無い環境の確認の結果が作業の報告に記録され、オンボーディングにWorkerごとのフォルダへの登録の手順がある。開発者の準備が終わっていれば、Workerの指定付きで起動したapiとeventで疎通確認の決済を始められ、Workerの指定を付けずに起動すると`startSmokeCheckout`が`payments_unavailable`を返す(共通のフォルダの値が使われないことの確認)
  - _Blocked: 開発者のdev用sandboxの準備待ち(devの公開キーでのローカルの`STRIPE_PUBLISHABLE_KEY`の置き換え、`stripe listen`を止めた状態の疎通確認の決済、Workerの指定付きの起動での疎通確認)。加えて、Stripeのキーがローカルのルートの`secrets.required`に無いため、登録してもローカルのWorkerへ渡らない(開発者の判断待ち)。手順書・オンボーディング・CSPの調査はresearch.mdとoperations/004に記録済み_
  - _Boundary: PaymentsTechDocs, オンボーディング(Workerごとのフォルダへの登録の手順だけ), clientのWrangler設定(ローカルの`STRIPE_PUBLISHABLE_KEY`の値だけ)_
  - _Depends: 1.1_
  - _Requirements: 15.1, 15.2, 15.6, 15.7_

- [ ] 2. 共有の契約と純粋な規則
- [x] 2.1 購入種別の口・定期課金の受け取り口・各ポートの契約と、登録の検証を作る
  - 先に、同じ購入種別の重複登録で例外になること、`enabled`が偽の登録と未登録の購入種別が解決されないこと、`enabled`で`PAYMENTS_SMOKE_ENABLED`を見る仮の登録が`false`の環境で解決されないこと(疎通確認用の購入種別の本物は5.7で作るため、テストは仮の登録で書く)、`fulfillment`を持つ登録を渡しても同じ値が解決されること、定期課金の受け取り口の名前の形式と重複の検証を確かめる単体テストを書く
  - 先に、`core/payments/identifiers.unit.test.ts`で、`PAYMENTS_TYPES`の各値が`Symbol.for('payments.<名前>')`であり、オブジェクトが凍結されていることを確かめる
  - `core/payments`(application層と後続specが読み込む。`Database`・`BatchItem`・`workers`・`apps/db`を読み込まない)に、購入の内容(価格の種類・数量・対象・二重決済の鍵・決済期限・受付期限・反映の期限・最終確認画面の表示事項・bot判定の要否)、購入の可否、購入種別の登録のうち可否と内容の側、定期課金の状態の変化(解約の予定時刻を含む)の型と、登録の解決(登録の型を型引数に取る)を作る
  - `workers/payments/fulfillment-contract.ts`(D1の文を返す側)に、権利の付与の計画(付与の文または拒否)・購入種別の口の権利の付与・`fulfillment`を加えた登録・定期課金の受け取り口とその登録の型を作る。購入種別の口と定期課金の受け取り口に、確定の後に1回呼ばれる省略可能な処理を加える(U1)
  - `core/payments`にDIの識別子と、Stripeのゲートウェイと読み取り専用の結果の型と例外の分類・Webhookの署名の検証と検証済みの通知の型・各ストアの文を返さない操作・返金の依頼(`request`・`dispatch`)・失効・反映と反映の結果・購入確認と自動返金の通知・価格の照会・Customerの照会・期間ごとの純収益の照会(設計の`RevenuePeriod`・`PaymentRevenueReport`、仮7)のポートの型を作る(メールの宛先はidentity-authの`UserContactDirectory`を使い、本specはポートを持たない)
  - `workers/payments/statement-contracts.ts`に、版の検査付きの一括の書き込み・各ストアの文を返す操作・返金の依頼の文(`prepare`・`prepareForReflection`)の型を作る
  - 完了状態: 単体テストが成功し、application層が受け取るポートの型をapi・eventのapplication層と後続specが`backend-lib/workers/payments`に依存せずに読み込め、`core/payments`が`Database`・`BatchItem`・`workers`・`apps/db`を読み込まない(静的解析が成功する)
  - _Requirements: 2.1, 2.2, 2.3, 2.7, 2.9, 2.11, 7.8, 7.9, 12.10_

- [x] 2.2 購入の状態の前進・有効期限・受付期限・反映の期限と、返金の金額の規則を作る
  - 先に、有効期限(決済期限の無い購入は作成から1時間、期限のある購入は24時間と決済期限の早い方、30分を下回らない)、受付期限の境界(期限ちょうどは拒否)、反映の期限の境界、前進できる元の状態(完了した購入は戻らない、`superseded`から完了へ進める)、返金の金額(残りの全額・一部・超過・0以下・非整数)、Stripeの返金理由への対応を確かめる単体テストを書く
  - 2.1の購入の内容の型を使う純粋な関数として作り、受付期限の後の拒否を`checkout_closed`のアプリケーションのエラーにする
  - 完了状態: 単体テストが成功し、判定がデータベースや時計に依存しない
  - _Requirements: 3.6, 3.7, 3.8, 7.3, 8.1, 8.3_

- [x] 2.3 (P) Stripeの通知の正規化と、返金のメッセージの契約を作る
  - 先に、受け付ける15種の通知がそれぞれ決済セッション・請求・返金・チャージバックの段階・定期課金の指示になり、他の種類が無視の指示になること、発生時刻が通知の時刻から作られること、返金のメッセージの本文の検証を確かめる単体テストを書く
  - 通知の正規化と`payments.refund-payment`のメッセージの契約を作り、メッセージの集約点へ加える
  - 完了状態: 単体テストが成功し、メッセージの契約の一覧の検査(既存の設定の単体テスト)が新しい契約を含めて成功する
  - _Boundary: StripeEventMapping_
  - _Depends: 1.2_
  - _Requirements: 6.3, 9.1, 9.2, 9.3, 9.4_

- [x] 2.4 (P) 購入確認と自動返金のメールの種別とテンプレートを同時に作る
  - 先に、2種の入力の検証の単体テストと、描画のWorkers統合テストで、2種の件名・本文・プレビュー・宛名、日時のUTCの表記、金額のUSDの表記、同意の旨と返金ポリシーの要旨と決済履歴へのリンク、自動返金の理由ごとの文言、配信停止のリンクが無いこと、購入確認メールに最終確認画面の追加事項が「購入の内容」の下に箇条書きで載り、追加事項が空なら見出しも出ないこと(U2)を確かめる
  - `payments.purchase-confirmation`・`payments.automatic-refund`の種別(`category: 'transactional'`。前例どおりドメインごとに1ファイルの`core/email/kinds/payments.ts`に置き、`kinds/index.unit.test.ts`に名前と`category`の確認を加える)と、1ファイル1コンポーネントの本文・テンプレートを同じ変更で作り、種別とテンプレートの集約点へ同時に加える(email-deliveryの種別とテンプレートの1対1の検査が途中で失敗しないようにする)
  - 完了状態: 単体テストと描画のテストが成功し、種別とテンプレートの1対1の検査が成功し、Mailpitの送信の実装を使うローカルのWorkers統合テスト(またはメールの送信のメッセージを手動で流すローカルの確認)から送った2種のメールがMailpitに届く
  - _Boundary: PaymentEmailKinds, PaymentEmailTemplates_
  - _Depends: 1.2_
  - _Requirements: 8.10, 11.1, 11.2, 11.5, 11.6_

- [ ] 3. Stripeとの通信
- [x] 3.1 Stripeの生成・例外の分類と、Customer・価格・決済セッションの操作を作る
  - 先に、fetchの模擬応答を使うWorkers統合テストで、API版`2026-10-28.endive`の固定、決済セッションの作成の項目(`ui_mode: 'elements'`・`allowed_payment_method_types: ['card', 'link']`・`automatic_tax`・`billing_address_collection: 'auto'`・`customer_update.address: 'auto'`・`adaptive_pricing`の無効・`return_url`・`expires_at`・3つのメタデータ・`integration_identifier`・冪等キー、`payment_method_types`を送らないこと)、決済セッションの取得と失効(完了済みは`not_open`)、取得の結果のPaymentIntent・請求・定期課金・Linkの資金源のグループ・メタデータ(`metadata.purchase_id`を含む)、Customerの作成と更新に渡すのがメールアドレスと仮名化IDだけであること、Customerの削除の`already_deleted`、価格の`lookup_key`での解決、例外の分類(接続・429・5xxは一時的、`resource_missing`は存在しない、他の4xxは恒久的)、`STRIPE_API_KEY`が未設定の環境ではStripeを呼ばずに一時的な失敗(`StripeUnavailableError`)になることを確かめる
  - fetchのHTTPクライアントと時間切れ・再試行の回数をアプリごとに設定し、Stripeの型を外へ出さない読み取り専用の結果の型で返す。個人データをログに出さない
  - 完了状態: Workers統合テストが成功し、模擬応答に対する送信の内容が設計の項目と一致する
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 3.1, 3.2, 3.3, 3.4, 3.11, 4.7, 15.3, 15.6, 15.8_

- [x] 3.2 請求・返金・チャージバック・定期課金の取得と、返金・解約・Customer Portalの操作を作る
  - 先に、fetchの模擬応答を使うWorkers統合テストで、請求・返金・チャージバック・定期課金の読み取り専用の結果、PaymentIntentのメタデータと請求の定期課金のメタデータからの持ち主の手がかり、返金の作成の冪等キーと理由と金額の省略、定期課金の読み取り専用の結果に`cancel_at`(秒)から作った解約の予定時刻が入ること(無ければ空、U1)、定期課金の即時・期間末の解約と解約済みの扱い、Customer Portalのセッション、チャージバックの状態が不服申し立ての値(`appeal_needs_response`・`appeal_under_review`)や未知の値でも読み取り専用の結果が作れることを確かめる
  - 完了状態: Workers統合テストが成功し、返金の作成の失敗が一時的・恒久的に分類される
  - _Depends: 3.1_
  - _Requirements: 7.8, 8.6, 8.7_

- [x] 3.3 (P) Webhookの署名の検証を作る
  - 先に、Stripe SDKのテスト用の署名の生成を使うWorkers統合テストで、正しい署名の受け入れ、本文の改ざん・署名の欠落・別の秘密・5分を超えた時刻の拒否、`STRIPE_WEBHOOK_SECRET`が未設定の環境で検証せずに一時的な失敗(`StripeUnavailableError`)になることを確かめる
  - Web Cryptoのプロバイダで生の本文を検証する部品を作る
  - 完了状態: Workers統合テストが成功し、拒否が署名の不正のエラーとして区別できる
  - _Boundary: StripeWebhookVerifier_
  - _Depends: 1.1_
  - _Requirements: 6.1, 6.2_

- [ ] 4. 永続化
- [x] 4.1 版の検査付きの一括の書き込みと、購入・Stripeのオブジェクトのストアを作る
  - 版の検査は、identity-auth・admin-foundation・inquiry-chatと同じく、一括の書き込みの先頭の業務の行の挿入で、NOT NULLの列に「版が一致すれば値、一致しなければNULL」を入れる型にする(`db/002`の「版の検査で一括の書き込み全体を取り消す」。2026-11-05の開発者の決定)。購入の確定・拒否は`payment_records`の挿入の`pseudonymous_id`を購入の`state_token`で、定期課金は`payment_stripe_objects`への挿入(`object_id`で`DO UPDATE`)の`last_event_at`を「より新しい発生時刻が記録済みか」で検査する。`GuardedBatch`は違反のメッセージの`<テーブル>.<列>`を`cause`をたどって照合し、検査の列の違反だけを`guard_failed`にする
  - 先に、Workers統合テストで、版が一致すれば一括の書き込みが確定すること、他の書き込みが先に購入を前進させていれば(`state_token`が変わっていれば)全体が取り消されて`guard_failed`になること、先頭の決済履歴の挿入が一意キーと衝突しても(初回の請求の行が先にある場合)版の検査が働くこと(SQLiteはNOT NULLを一意性より先に確かめる)、より新しい発生時刻が記録済みの定期課金の通知で後続の文を含めて全体が取り消されること、同じ発生時刻の通知は通ること、`exclusivity_key`の部分一意索引の違反と他の文の制約の違反が`constraint_failed`として検査の失敗と区別されること、他の文の失敗の`<テーブル>.<列>`が検査の列と重ならないこと、購入の作成・購入IDでの検索(5.1・6.2で使用)・決済セッションIDの保存(6.1で使用)・セッションIDでの検索・PaymentIntentのIDでの検索(4.3で使用)・本人の未完了の購入・同じ対象の未完了の購入・突合と日次の確認の対象の検索・同意の記録(未完了の購入だけ)・購入確認メールの依頼の状態の更新と10分以上依頼待ちの購入の検索・利用者の行の削除を確かめる
  - 状態の前進は前進の元の状態を条件にし、新しい`state_token`を書く1文で表す。他の文を伴わない1文の前進(失効・処理中への前進)は版の検査を使わず、`meta.changes`で前進したかを判定する
  - D1の実装は1つのクラスで`core/payments`のストアの契約(文を返さない操作)と`workers/payments/statement-contracts.ts`の文の契約の両方を実装する
  - 完了状態: Workers統合テストが成功し、同時に2つの前進を一括の書き込みにしても1つだけが確定する
  - _Depends: 1.3, 2.1_
  - _Requirements: 2.4, 4.5, 6.4, 6.5, 6.6_

- [x] 4.2 (P) 決済履歴・返金の依頼・Customer・価格のストアを作る
  - 先に、Workers統合テストで、決済セッションの記録の重複の無視、請求・返金の発生時刻が新しいときだけの更新(古い通知で状態が戻らない)、チャージバックの段階ごとの挿入と重複の無視、仮名化IDでの降順のカーソルの一覧と全件の昇順の読み出し、7年より前の記録の上限付きの削除、返金の依頼キーの一意と依頼済みの合計と送信待ちの検索と自動返金の通知の状態の更新と10分以上通知待ちの検索と利用者の行の削除、Customerの保存と削除と後続spec用の照会、価格の保存と取得時刻を確かめる
  - `IN`句とまとめての挿入をバインド変数100個以内に分ける
  - 返金の依頼の行の追加と利用者の行の削除、Customerの対応の削除は文を返す操作(`workers/payments/statement-contracts.ts`)にし、それ以外は`core/payments`のストアの契約で実装する
  - 完了状態: Workers統合テストが成功し、決済履歴の行に利用者の主キーが入らない
  - _Boundary: D1PaymentRecordStore, D1RefundStore, D1CustomerStore, D1PriceSnapshotStore_
  - _Depends: 1.3, 2.1_
  - _Requirements: 1.5, 1.7, 6.5, 7.7, 8.2, 9.4, 12.5, 12.6, 12.7_

- [x] 4.3 返金・チャージバック・請求の持ち主の特定を作る
  - 先に、偽のゲートウェイと購入のストアを使うWorkers統合テストで、PaymentIntentのIDが購入に結び付く場合、購入の行が無くPaymentIntentのメタデータから特定する場合(物理削除の後)、請求の定期課金のメタデータから特定する場合、どれでも特定できない場合を確かめる
  - 完了状態: Workers統合テストが成功し、特定できない場合は対象のIDだけを記録して「結び付かない」を返す
  - _Depends: 3.2, 4.1_
  - _Requirements: 6.9, 8.8, 9.1_

- [ ] 5. 反映・返金・通知の共有部品
- [x] 5.1 返金の依頼の部品を作る
  - 先に、Workers統合テストで、全額と一部の依頼の受け付けと記録と送信、同じ依頼キーの2回目の重複の返却(`request`と`prepare`の両方。依頼キーの形式の検査が照会より先で、既に存在する`reflection:`の依頼キーでも`invalid_request_key`で拒否する。`prepare`の2回目は既存の依頼の識別と重複の印と空の文を返し、新しい行を作らない。金額や理由が異なっても、残りの額を超える金額でも拒否しない。確定前の2つの依頼の文が同じ依頼キーで重なると、後から確定する一括の書き込みが一意制約で失敗する)、支払額を超える依頼・未確定・存在しない購入の拒否、依頼元の一括の書き込みに含める文の返却と確定後の送信、反映からの経路(購入の状態とPaymentIntentのIDを検査せず、引数の支払額から全額の返金の依頼の行を`reflection:<購入ID>`の依頼キーで作り、前進の文と同じ一括の書き込みでだけ確定する)、後続specの経路(`request`・`prepare`)が`reflection:`で始まる依頼キーを拒否すること、送信の失敗で送信待ちが残ることを確かめる
  - 1つの実装で、`core/payments`の返金の依頼(`request`・`dispatch`)と`workers/payments/statement-contracts.ts`の返金の依頼の文(`prepare`・`prepareForReflection`)の両方を実装する
  - 完了状態: Workers統合テストが成功し、依頼の受け付けがStripeの呼び出しを待たずに返る
  - _Depends: 2.2, 4.2_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 5.2 (P) 購入確認メールと自動返金の通知の依頼を作る
  - 先に、偽のメール送信とidentity-authの`UserContactDirectory`の偽の実装を使うWorkers統合テストで、購入確認メールの入力(購入種別・分量・金額・購入日時(UTC)・役務の提供時期・購入の保存済みの最終確認画面の表示事項から読んだ追加事項(U2)・同意の日時と記録した版の文言・決済履歴のURL。返金ポリシーの要旨はテンプレートが共用部品の定数を使うため入力に含めない)、依頼済みの購入で再び依頼しないこと、送信の失敗で依頼待ちが残ること、`findContact`が`undefined`を返す利用者(退会済み・物理削除済み)で送らずに対象外になること、停止中の利用者には送ること、自動返金の通知を依頼キーが`reflection:`で始まる依頼だけに送り、後続specの依頼(理由が`late`・`duplicate`でも)には送らないこと、10分以上依頼待ちの購入確認メールと自動返金の通知を最大100件ずつ依頼し直すことを確かめる
  - 依頼の状態の更新と依頼待ちの検索は、4.1・4.2のストアの操作を使う
  - 宛先は、identity-authがapi・eventの両方に束縛する`IDENTITY_PLATFORM_TYPES.UserContactDirectory`を注入し、`findContact`の`email`で引く。本specは`users`の列を直接読まない
  - 完了状態: Workers統合テストが成功し、同じ購入の依頼は記録の後に2回目が行われない
  - _Boundary: PurchaseNotifier_
  - _Depends: 2.4, 4.1, 4.2_
  - _Requirements: 8.10, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 5.3 決済セッションの反映を作る
  - 先に、偽のゲートウェイと偽の購入種別の口を使うWorkers統合テストで、支払いが確定した決済の権利の付与・決済履歴の記録(同意の日時と版、Linkの資金源のグループを含む)・購入確認メールの依頼待ちが同時に確定し確定後に依頼されること、未払いの完了は処理中にして権利を付与しないこと、反映の期限の後の支払い・口の拒否・二重決済(部分一意索引の違反)が拒否と全額返金の依頼に理由付きでなり確定後に送信されること、期限切れで失効になり決済履歴に記録しないこと、`return_url`とWebhookから同時に反映しても記録・付与・依頼が1回だけであること、権利の付与の文の失敗で口を1回だけ呼び直すこと、処理中・完了・拒否への前進の文が購入へPaymentIntent・請求・定期課金のID・支払額・`paid_at`・`reflected_at`を保存すること(4.3・5.1・返金の実行が使う)、決済セッションIDの保存より前に届いた通知を`metadata.purchase_id`で購入を探せること、権利の付与を確定させた側だけが購入種別の口の確定後の処理を1回呼び、拒否・反映済み・版の検査の失敗では呼ばず、確定後の処理の例外で反映の結果が変わらず`warn`のログだけが残ること(U1)を確かめる
  - 返金・チャージバック・期限切れでは権利の付与・剥奪の口を呼ばない
  - 完了状態: Workers統合テストが成功し、同じ決済セッションの反映の2回目が「反映済み」と現在の状態を返す
  - _Depends: 3.1, 4.1, 5.1, 5.2_
  - _Requirements: 2.4, 2.5, 2.6, 2.11, 5.7, 6.4, 6.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 12.6_

- [x] 5.4 請求・返金・チャージバック・定期課金の反映をまとめる反映の処理を作る
  - 先に、Workers統合テストで、請求の成功と失敗の記録(初回の請求は決済セッションの記録と同じ行)、返金の負の金額の記録と状態の変化と本specの依頼の状態の更新、成功した自動返金(依頼キーが`reflection:`で始まる依頼だけ)の通知の依頼待ちと依頼、チャージバックの引き落とし・勝訴・敗訴の記録と照会・審査中・不服申し立ての段階の無視、不服申し立てを経て敗訴した(`under_review`→`appeal_needs_response`→`appeal_under_review`→`lost`)チャージバックの記録が`disputed`と`dispute_lost`の2行だけになり、不服申し立てで勝訴した場合は`disputed`と`dispute_won`の2行だけになること、定期課金の変化(解約の予定時刻を含む)が登録した受け取り口の文と同時に確定し古い通知が捨てられること、確定したときだけ受け取り口の確定後の処理が1回呼ばれその例外で結果が変わらないこと(U1)、結び付かない通知が反映されないこと、一時的な失敗が例外として返り部分的な書き込みが残らないことを確かめる
  - 返金とチャージバックで権利の剥奪を依頼しない
  - 完了状態: Workers統合テストが成功し、通知の指示の種類ごとに反映の結果(反映・反映済み・古い・結び付かない・無視)が返る
  - _Depends: 4.3, 5.3_
  - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.9, 7.7, 7.8, 7.9, 8.8, 8.9, 8.10, 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 5.5 (P) 価格の照会・データエクスポート用の読み出し・期間ごとの純収益の照会を作る
  - 先に、Workers統合テストで、期間ごとの純収益(成功した都度決済と請求の合計から、成功した返金と、敗北が確定したチャージバックの引き落とし額を差し引く。敗北の額は同じStripeのIDの引き落としの行から取り、敗北が確定した時刻の期間に数える。勝ったチャージバック・失敗と処理中の行・疎通確認用の購入種別を含めない。期間の境界・入力の順・該当の無い期間の0・最大の60個の期間が1回の一括の実行で成功すること(D1のバインド変数の上限を超えないよう期間を組に分ける)・引き落としの行が無い敗北の記録の扱い・期間の数と前後の誤りの拒否)と、10分以内の価格の再利用、古い価格の取り直し、Stripeに到達できないときの古い価格の返却と値が無いときの利用できない旨、決済履歴の全件を`payments.json`の項目だけで返すこと(同意の日時・資金源のグループ・購入IDを含めない)を確かめる
  - 完了状態: Workers統合テストが成功し、エクスポートの項目がデータエクスポートの文書の表と一致し、純収益の照会が1回の一括の実行で、入力の順に期間ごとの値を返す(仮7)
  - _Boundary: PriceCatalog, PaymentHistoryExport, PaymentRevenueReport_
  - _Depends: 3.1, 4.2_
  - _Requirements: 12.8, 12.10, 13.1, 13.2, 13.3, 13.4_

- [x] 5.6 未完了の決済セッションの失効を作る
  - 先に、Workers統合テストで、利用者と購入種別(と対象)を指定した失効、Stripe上で既に完了していた購入の反映、件数の上限と残りの有無、Stripeの一時的な失敗の例外を確かめる
  - 完了状態: Workers統合テストが成功し、失効した購入が`expired`になり、完了済みだった購入は反映される
  - _Boundary: OpenCheckoutExpirer_
  - _Depends: 5.3_
  - _Requirements: 2.10, 14.1, 14.2, 14.3_

- [x] 5.7 疎通確認用の購入種別・登録箇所・両アプリ共通の束縛を組み込む
  - 後続specが追記する購入種別と定期課金の受け取り口の登録箇所を作り、初版は疎通確認用(1ドル・数量1・期限無し・何もしない権利の付与)だけを登録する
  - 反映・返金・失効・価格・エクスポート・純収益の照会・Customerの照会・通知・購入種別の登録の解決(登録箇所の値から作った1つの値)の束縛を、両アプリ共通のモジュールにまとめる。文を返さない操作と文を返す操作の識別子(ストア・返金の依頼)には同じ実装を束縛する
  - 先に、Workers統合テストで、共通の束縛から各部品(純収益の照会・購入種別の登録の解決を含む)を取り出せること、疎通確認用の購入の内容、`PAYMENTS_SMOKE_ENABLED`が`false`の環境で疎通確認用が解決されないことを確かめる
  - 完了状態: Workers統合テストが成功し、api・eventのモジュールの一覧に加えられる状態になる
  - _Depends: 5.4, 5.5, 5.6_
  - _Requirements: 2.8, 2.9, 12.10_

- [ ] 6. APIサーバーのユースケース
- [x] 6.1 APIサーバーの決済の識別子と、決済の開始・利用者単位の回数制限を作る
  - APIサーバーの決済の全ユースケースとジョブのDIの識別子を1つのファイル(前例の`identity-types.ts`・`inquiry-types.ts`と同じく`application/payments/payments-types.ts`)に先に定義する(6.2・6.3はこれを使う)
  - 決済のエラーコードと文言と`AppError`の生成を、前例の`inquiry-errors.ts`と同じくapplication層の`application/payments/payments-errors.ts`に単体テスト付きで置く(presentationの`errors.ts`は入力の検証の文言だけを持つ)。6.2・6.3・7.1はこれを使う
  - application層に、回数制限(`CheckoutStartLimits`)・購入の置き換えと作成の書き込みの単位(`CheckoutPurchaseWriter`)・購入の可否の口の解決(`PurchaseOfferPolicyResolver`)のポートを置く。決済の開始は購入種別の登録を`PAYMENTS_TYPES.PurchaseKindRegistry`で、その他の共有部品を`core/payments`の型と識別子で受け取り、`**/lib/workers/**`を型も含めて読み込まない
  - 厳密カウンタを使う回数制限の実装`CounterCheckoutStartLimits`と規則、D1の文を組み立てて1回の一括の書き込みで確定する`D1CheckoutPurchaseWriter`を、APIサーバーのinfrastructure層に置く(`backend/003`の「厳密カウンタを使うクラスはインフラ層に置く」、`backend/002`の「依存方向と静的解析」)
  - 先に、Workers統合テストで、`CounterCheckoutStartLimits`が偽の厳密カウンタに利用者のIDのハッシュのキーで数え21回目で待つ秒数付きの拒否になること、`D1CheckoutPurchaseWriter`が同じ対象の未完了の購入の置き換えと新しい購入の作成を1回の一括の書き込みで確定し、失効の操作で`open`の購入を`expired`にすることを確かめる
  - 先に、偽のポートを使う単体テストで、手順の順序(利用者の確認→回数制限→購入種別の解決→購入の可否→必要ならbot判定→受付期限→価格の解決→Customerの用意→同じ対象の未完了の購入の置き換えと新しい購入の作成→決済セッションの作成→旧セッションの失効)、未確認・停止中・退会済みの拒否、未登録の購入種別の拒否、購入できない旨の拒否、受付期限の後の拒否、21回目の回数制限の拒否と待つ秒数、Stripeの失敗で購入が失効になり利用できない旨を返すこと、旧セッションの失効の失敗を待たないこと、購入IDの返却を確かめる
  - 回数は利用者のIDのハッシュをキーに1時間20回で数える
  - 完了状態: 単体テストとWorkers統合テストが成功し、後続specが決済を始める変更操作から呼べ、静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 5.7_
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.5, 3.6, 3.9, 3.10, 3.11, 3.12_

- [x] 6.2 決済画面・同意・決済後のランディング・決済履歴の照会と変更を作る
  - 先に、偽のポートを使う単体テストで、本人の未完了の購入の表示事項と`clientSecret`、他人・存在しない購入の見つからない旨、完了・処理中・失効・返金中・利用できない状態、やり直しの可否(受付期限の前)、同意の記録(未完了だけ、最新の日時で上書き)、`return_url`の`session_id`の形式の検証と本人の確認と反映の呼び出しとStripeに到達できないときの処理中、決済履歴の件数の範囲(1〜50、既定20)とカーソルを確かめる
  - 完了状態: 単体テストが成功し、他人の購入では状態を明かさないエラーだけが返り、ユースケースが`core/payments`の契約だけを受け取る(`**/lib/workers/**`の読み込みが無い)
  - _Boundary: CheckoutReader, CheckoutConsentRecorder, CheckoutReturnConfirmer, PaymentHistoryReader_
  - _Depends: 6.1_
  - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.9, 4.10, 4.11, 5.1, 5.6, 5.7, 12.1, 12.2, 12.9_

- [x] 6.3 23:40の突合・4:21の日次の確認・7年の削除のジョブを作る
  - 先に、偽のポートを使う単体テストで、突合の対象(決済期限が過ぎて24時間以内の未完了・処理中・置き換え済み)と1件の失敗で残りを続けて通知すること、日次の確認の3つの処理(有効期限を1時間過ぎた購入の突合、10分以上送信されていない返金の送信、依頼待ちのメールの依頼)と上限、7年の削除の上限付きの繰り返し、2回実行しても結果が変わらないことを確かめる
  - 突合は23:40の`order` 10、日次の確認と削除は4:21の`order` 400・410で定義する
  - 完了状態: 単体テストが成功し、ジョブの定義の検証(時刻と順序の重複の拒否)を通り、ジョブが`core/payments`の契約だけを受け取る(`**/lib/workers/**`の読み込みとD1の文が無い)
  - _Boundary: CheckoutReconciliationJob, PendingCheckoutSweepJob, PaymentHistoryRetentionJob_
  - _Depends: 6.1_
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 12.7_

- [ ] 7. APIサーバーの組み込み
- [x] 7.1 決済のGraphQLのスキーマモジュールとAPIサーバーの決済の束縛を作る
  - APIサーバーの決済の束縛(ユースケース・ジョブ・回数制限の実装・購入の書き込みの単位の実装・処理単位のコンテナから購入の可否の口を解決する関数)をモジュールとして作る
  - 先に、そのモジュールと共通の束縛を使うWorkers統合テストで、`checkout`・`paymentHistory`・`recordCheckoutConsent`・`confirmCheckoutReturn`・`startSmokeCheckout`の成功、エラーのコードと文言の表(`checkout_closed`・`purchase_kind_unavailable`・`payments_unavailable`・`rate_limit_exceeded`・`checkout_not_found`・`checkout_not_open`・`validation_error`)、ログインしていない要求の拒否、疎通確認が無効な環境での`purchase_kind_unavailable`、後続specが返す`CheckoutStart`の型を確かめる
  - apiで`bun run graphql:generate`を実行してコミット済みの`src/presentation/graphql/generated/schema.graphql`を生成し直し、`graphql-modules.worker.test.ts`(合成したスキーマとコミットしたスキーマの一致)を通す
  - 完了状態: Workers統合テストが成功し、生成したスキーマに決済の型と操作が含まれる
  - _Depends: 6.2, 6.3_
  - _Requirements: 2.8, 3.10, 3.12, 4.9, 5.6, 12.9_

- [x] 7.2 APIサーバーのモジュール・スキーマ・ジョブ・Cron Triggersに決済を登録する
  - 共通の束縛とAPIサーバーの決済のモジュールをモジュールの一覧へ、スキーマモジュールを集約点へ、3つのジョブを定期実行の一覧へ加え、Cron Triggersの3環境に23:40の式を加える
  - 先に、Workers統合テストで、DIから決済の開始・照会・ジョブを取り出せること、定期実行の式とWrangler設定の一致の検査が成功することを確かめる。4:21の2つのジョブは、4:21の起動の合計の予算(`SCHEDULED_RUN_BUDGETS`の300秒)を他のドメインのジョブと共有し、23:40には予算を置かない(`cron-sync.unit.test.ts`の「予算は4:21の1件だけ」を保つ)
  - `apps/api/src/composition/inquiry-module.worker.test.ts`の、4:21の`order` 300の次のジョブの名前の期待を`payments.pending-checkout-sweep`に改める
  - 完了状態: DIの統合テストとcronの一致の検査が成功し、ローカルで23:40と4:21のジョブを手動で起動できる
  - _Requirements: 10.1, 10.2, 10.5_

- [x] 8. イベントサーバー
- [x] 8.1 イベントサーバーの決済の識別子と、Webhookの経路・受け付け・IP制限の除外を作る
  - イベントサーバーの決済の受け付け・返金の処理・波及処理のDIの識別子を1つのファイルに先に定義する(8.2・8.3はこれを使う)
  - Webhookの経路(前例の`presentation/email/`・`presentation/media/`と同じく`presentation/payments/stripe-webhook-route.ts`)と、IP制限の除外の登録をこのタスクで行う
  - 先に、Workers統合テストで、正しい署名の通知の反映と200、署名の不正・欠落の400、1MiBを超える本文の413、反映の一時的な失敗の500(部分的な書き込みが無い)、`STRIPE_WEBHOOK_SECRET`が未設定の環境の503、無視・結び付かない・古い通知の200、101回目の要求でもIP制限で429にならないことを確かめる
  - 本文を文字列のまま読み、検証・正規化・反映の順に呼ぶ。受け付け(application層)は署名の検証と反映を`core/payments`の型と識別子で受け取る
  - 完了状態: Workers統合テストが成功し、テストの中で組み立てた経路で署名付きの通知が反映され、受け付けが`**/lib/workers/**`を読み込まない
  - _Depends: 3.3, 5.7_
  - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.7, 6.8, 6.9_

- [x] 8.2 返金の実行の処理を作る
  - 先に、Workers統合テストで、依頼の行の購入から`stripe_payment_intent_id`を読んで渡す返金の作成と返金IDの保存(反映からの依頼と後続specの依頼の両方)、購入やPaymentIntentのIDが無い依頼の失敗の記録と通知、提出済み・成功済みの依頼の無処理、拒否された定期課金の購入で先に定期課金を解約すること、一時的な失敗の例外と再試行の上限でのデッドレター、恒久的な拒否の失敗の記録と通知を確かめる
  - 完了状態: Workers統合テストが成功し、同じメッセージを2回処理しても返金の作成の呼び出しが同じ冪等キーで行われる
  - _Boundary: RefundPaymentHandler_
  - _Depends: 8.1_
  - _Requirements: 8.5, 8.6, 8.7_

- [x] 8.3 物理削除と退会・停止の波及処理を作る
  - 削除の書き込みの単位はイベントサーバーのapplication層のポート(`PaymentAccountDataEraser`)にし、D1の文を組み立てて1回の一括の書き込みで確定する実装`D1PaymentAccountDataEraser`をinfrastructure層に置く。2つの波及処理は`core/payments`の型と識別子とこのポートだけを受け取る
  - 先に、偽のポートを使う単体テストで波及処理の呼び出しの順を、Workers統合テストで、`purge_due`でCustomerの削除(既に無ければ成功扱い)と、返金の依頼→購入→Customerの対応の順の利用者の行の削除が行われ決済履歴が残ること、Stripeの一時的な失敗で例外になり再試行されること、`withdrawn`・`suspended`で未完了の決済セッションが失効し残りがあれば続きを返すことを確かめる
  - 完了状態: 単体テストとWorkers統合テストが成功し、物理削除の後に利用者の外部キーの残りが無く、静的解析でイベントサーバーのapplication層に`**/lib/workers/**`の読み込みが無い
  - _Boundary: CustomerErasureHandler, OpenCheckoutExpiryHandler_
  - _Depends: 8.1_
  - _Requirements: 1.5, 1.6, 1.7, 14.1, 14.2, 14.3_

- [x] 8.4 イベントサーバーの決済のモジュールを作り、モジュール・メッセージ・ライフサイクルに登録する
  - Webhookの署名の検証(3.3の部品)・受け付け・返金の処理・2つの波及処理・削除の書き込みの単位の実装の束縛とWebhookの経路をまとめたイベントサーバーの決済のモジュールを作る
  - 共通の束縛とそのモジュールをモジュールの一覧へ、返金の処理をメッセージの処理の一覧へ(再試行は最大5回)、2つの波及処理をユーザーライフサイクルの登録箇所へ(`order` 400・410、本specの400番台)加える
  - 先に、Workers統合テストで、DIから署名の検証・受け付け・返金の処理・波及処理を取り出せること、メッセージの処理と波及処理の登録の検証(名前・順序の重複)が成功することを確かめる
  - 完了状態: DIの統合テストと登録の検証が成功し、Workers統合テストで`PaymentRefunds.request`から送った`payments.refund-payment`が返金の処理で受信されること(Stripeは模擬)と、ローカル(1.4の準備の後)で`stripe listen`の転送からの通知が反映されることを確かめる
  - 未実施: ローカルで`stripe listen`の転送からの通知が反映されることの確認は、1.4(開発者のsandboxの準備と、ローカルのルートの`secrets.required`へのStripeのキーの追加の判断)の保留のため行っていない。Workers統合テストで、本物のWorkerのエントリへの署名付きの通知の反映と、返金のメッセージの受信は確かめた
  - _Depends: 1.4, 8.2, 8.3_
  - _Requirements: 8.5, 14.1_

- [ ] 9. (P) 通貨の表示部品を共通部品に加える
  - 先に、ブラウザテストで、最小通貨単位の整数をロケールに応じたUSDで表示すること(負の金額・符号の表示を含む)と、アクセシビリティの違反が0件であることを確かめる
  - Storybookのストーリーを置く。チェックボックスの部品はidentity-authが作成済みのため、本タスクでは作らない
  - `NumberText`に`Intl.NumberFormatOptions`(`style: 'currency'`・`currency: 'USD'`)を渡し、最小通貨単位からドルへの変換だけを`MoneyText`が受け持つ
  - `docs/GUIDES/tech/frontend/005-shared-components.md`の部品の一覧に`components/payments/`の分類(`MoneyText`。決済画面・決済履歴と、後続specの申込の画面が使う)を加える
  - 完了状態: ブラウザテストが成功し、Storybookで通貨の表示部品を確認できる
  - _Boundary: MoneyText_
  - _Depends: 1.2_
  - _Requirements: 4.8, 13.5_

- [ ] 10. 利用者側の画面
- [ ] 10.1 利用者側に公開キー・CSPの許可先・設定のナビゲーションを組み込む
  - 先に、構成の単体テストで、公開キーの検証(未設定か、`pk_test_`・`pk_live_`で始まる文字列)と公開設定への受け渡し(`FrontendAppProfile`の`payments`が偽の管理者側には渡らない。1.1で加えた形)、CSPの`script-src`・`frame-src`・`connect-src`へのStripeの必須の許可先と`payment`の許可、設定のナビゲーションの「決済履歴」(`order` 70)を確かめる。`apps/client/test/config/composition.unit.test.ts`(`CLIENT_SECURITY_POLICY`の完全一致)と`apps/client/src/components/settings/settings-nav-order.unit.test.ts`(`SETTINGS_NAV_ITEMS`の完全一致)の期待を直す
  - frontend-platformの許可先の形の規則のまま加え、1.4で確かめたStripeの許可先がワイルドカードや規則に合わない形を要する場合は保留して報告する
  - 完了状態: 構成の単体テストが成功し、ページの応答のCSPにStripeの許可先が含まれる
  - _Depends: 1.1_
  - _Requirements: 4.12, 12.4_

- [ ] 10.2 決済のGraphQLの操作と、Stripe.jsを1回だけ読み込む部品を作る
  - 5つの操作を、clientの`src/graphql/operations/payments/`に1ファイル1操作の`.graphql`(操作名は`ClientCheckout`・`ClientRecordCheckoutConsent`・`ClientStartSmokeCheckout`・`ClientConfirmCheckoutReturn`・`ClientPaymentHistory`)で書き、`graphql()`を呼ばない。clientで`bun run graphql:generate`を実行して`src/graphql/generated/`を更新し、apiで`bun run graphql:allowlist`を実行して許可リストを再生成する。部品は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む
  - 先に、単体テストで、Stripe.jsの読み込みが公開キーごとに1回だけ行われ、公開キーが無いときは読み込まないことを確かめる
  - 完了状態: 生成物の検査(`graphql:check`)とclientの`codegen.unit.test.ts`(操作名の接頭辞)が成功し、許可リストに決済の操作が載る
  - _Depends: 7.2, 10.1_
  - _Requirements: 4.12_

- [ ] 10.3 決済画面(最終確認画面の事項・同意・入力欄・支払いの確定)を作る
  - 先に、Stripe.jsの部品を模擬したブラウザテストで、表示事項(分量・税込の価格・支払方法の4つ・支払時期・役務の提供時期)の順、受付期限の日時と残り時間、Ultrasの追加事項、返金ポリシーの要旨とアンカー無しの`/legal`へのリンク、同意のチェックボックスが外れている間の支払うボタンの無効、同意の記録が失敗したときに確定を呼ばないこと、確定の失敗の理由の表示、完了・処理中・返金中・失効(やり直しの導線の有無)・利用できない・見つからない状態の出し分け、アクセシビリティの違反が0件であることを確かめる
  - 10.3〜10.5を並行に進めてTanStack Routerのルートの生成ファイルが衝突した場合は、取り込んだ後に生成し直して解消する
  - 同意のチェックボックスには、identity-authが作成済みのfrontend-libの`Checkbox`を使う(`onCheckedChange`の値は前例の`register-form.tsx`と同じく`checked === true`で真偽値にする)
  - ルートを作り、ページを検索エンジンの索引の対象外にする(clientの`buildSitePageHead`)。Payment Elementと請求先住所の入力欄を置き、現地通貨の表示を許可しない。`CheckoutElementsProvider`の中の状態は`useCheckoutElements()`で読む(`useCheckout()`は`@stripe/react-stripe-js` 7.0.1で非推奨で、静的解析の`no-deprecated`に反する)
  - 先のブラウザテストに、公開キーが無い環境(`PublicRuntimeConfig.stripePublishableKey`が`undefined`)でStripe.jsを読み込まず「決済を利用できない」を表示すること、Stripe.jsの読み込みの失敗と確定の想定外の失敗が`reportUnexpectedErrorInBrowser`へ送られ縮退の案内が出ることを加える
  - 完了状態: ブラウザテストが成功し、ローカル(1.4の準備の後)で、`startSmokeCheckout`(7.2で組み込み済み)を直接呼んで作った購入の決済画面が表示される
  - _Boundary: CheckoutPage, CheckoutSummary, CheckoutConsent, CheckoutPaymentForm, CheckoutDeadline_
  - _Depends: 1.4, 9, 10.2_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.13, 15.6_

- [ ] 10.4 (P) 決済後のランディングを作る
  - 先に、ブラウザテストで、完了の内容と購入種別ごとの導線と決済履歴への導線、処理中の確かめ直し(3秒ごと最大20回)とその後の案内、返金中の理由と全額返金の旨、未完了とやり直しの導線、見つからない旨、`session_id`の欠落・不正、アンマウントでタイマーが止まること、アクセシビリティの違反が0件であることを確かめる
  - `confirmCheckoutReturn`は`loader`では呼ばず、`CheckoutReturnStatus`のマウント後の効果から`useMutation(graphqlMutationOptions(ClientConfirmCheckoutReturnDocument))`で1回呼び、処理中の間は部品の中のタイマー(`setTimeout`)で呼び直す(変更の`retry: false`は変えない)。`docs/GUIDES/tech/frontend/006-data-fetching.md`の「変更」の節に、冪等で、画面への到達そのものが利用者の操作に当たる確定はマウント後に呼んでよいという例外と、呼び直しの方法を、本プロジェクト固有の値を含めずに加える(2026-11-05の開発者の決定)
  - 購入種別ごとの導線(`/my/products`・`/settings/sponsorships`・`/settings/plan`)は本specの時点で未作成の経路のため、型付きの`Link`ではなく`PathLink`で描く
  - 完了状態: ブラウザテストが成功する(ローカルで支払いの後に完了の表示へ進むことは、決済画面(10.3)と合わせて11.1で確かめる)
  - 10.3〜10.5を並行に進めてTanStack Routerのルートの生成ファイルが衝突した場合は、取り込んだ後に生成し直して解消する
  - _Boundary: CheckoutReturnStatus_
  - _Depends: 9, 10.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [ ] 10.5 (P) 決済履歴の画面と疎通確認の決済の開始ボタンを作る
  - 先に、ブラウザテストで、日時・購入種別・種類・数量・符号付きの金額・状態の表示、20件ずつの続きの読み込み、0件の表示、読み込みの失敗の表示、疎通確認の開始のボタンがprod以外でだけ表示され押下で決済画面へ移動すること、アクセシビリティの違反が0件であることを確かめる
  - ルートは決済履歴の一覧だけを返す(`settings/route.tsx`のレイアウトが既に設定ページのシェルで包むため、ページで包み直さない)
  - 続きの読み込み(「さらに表示」)は、前後のページ送り(`PageNavigation`とカーソルの記録。`006-data-fetching.md`・inquiry-chatの`/contact`)の前例と異なる型である。設計どおり「さらに表示」で作るが、実装の前に`006`に続きの読み込みの手順が無いことを確かめ、手順を足す必要があれば開発者へ報告する
  - 10.3〜10.5を並行に進めてTanStack Routerのルートの生成ファイルが衝突した場合は、取り込んだ後に生成し直して解消する
  - 完了状態: ブラウザテストが成功する(ローカルで決済履歴から疎通確認の決済を始めて決済画面へ進むことは、10.3と合わせて11.1で確かめる)
  - _Boundary: PaymentHistoryList, PaymentHistoryItem, SmokeCheckoutButton_
  - _Depends: 9, 10.2_
  - _Requirements: 2.8, 12.1, 12.2, 12.3, 12.4_

- [ ] 11. 端から端までの検証
- [ ] 11.1 決済履歴と疎通確認の決済のE2Eテストを作る
  - 決済履歴のE2Eで、ログイン後の設定のナビゲーションの「決済履歴」から画面を開き、記録が無い表示を確かめる
  - 疎通確認の決済のE2Eで、決済履歴の画面の開始ボタン→決済画面の表示事項→同意→テストカードでの支払い→決済後のランディングの完了→決済履歴の記録→購入確認メール(Mailpit)を確かめ、ブラウザのCSPの違反が無いことを確かめる。Stripeのsandboxのキーが無い環境(`startSmokeCheckout`が`payments_unavailable`を返す)では、`test.skip`で理由(「Stripeのsandboxのキーが無い環境のため、決済のE2Eを飛ばします」)を示して終える。「対象0件の表示」の規約は実行するテストファイルが0件の時のもので、この用途には使わない。転送が無い環境(CI)で完了まで辿れるかは1.4の確認の結果に従う
  - 完了状態: ローカル(1.4の準備と`stripe listen`の転送あり)で2つのE2Eが成功する
  - _Depends: 1.4, 8.4, 10.3, 10.4, 10.5_
  - _Requirements: 2.8, 4.1, 4.4, 4.5, 4.12, 5.2, 11.1, 12.1, 12.4, 16.1_

- [ ] 11.2 決済手段の設定と即時の確定を、sandboxで検証して記録する
  - 1.4で書いた手順に沿って、dev用のsandboxで、作成した決済セッションの決済手段の種類がカードとLinkだけであること、決済画面にカード・Apple Pay・Google Pay・Linkだけが出ること(Klarnaなどが出ないこと)、Linkのカードと即時銀行決済のテストで完了の通知の支払いの状態が「支払い済み」になること、決済履歴に資金源のグループが記録されることを確かめる
  - Stripeの模擬応答のテストに、検証で得た実際の応答の形との差があれば直す
  - 完了状態: 検証の結果(日付・確かめた項目・資金源のグループ)が`research.md`に記録され、想定と異なれば開発者へ報告されている
  - _Depends: 11.1_
  - _Requirements: 4.7, 7.2, 15.7, 16.2_

- [ ] 11.3 重複・順序・署名・期限切れ・二重決済・返金の失敗の網羅を確かめ、カバレッジを満たす
  - 反映・返金・Webhookのテストに、Webhookの重複と順序の入れ替わり、署名の不正、反映の期限切れ、二重決済、返金の再試行と恒久的な失敗が含まれていることを確かめ、不足を足す
  - 4種のテストを実行し、本specが追加・変更したファイルのカバレッジが80%以上であることを確かめる
  - 完了状態: 全テストが成功し、カバレッジの閾値の検査を通る
  - _Depends: 11.1_
  - _Requirements: 16.1, 16.2_

- [ ] 12. ドキュメント
- [ ] 12.1 (P) 技術ドキュメントを仕上げる
  - `external/007`(Stripeとの連携の規約)・`backend/009`(外部の通知の冪等な反映の規約)を作り、`operations/004`の残り(手動の返金、チャージバック、突合と返金の失敗の対処、鍵の更新、Webhook endpointのAPI版の更新、11.2の検証で分かった差)を書き足す。本プロジェクト固有の値を含めず、各ディレクトリの文書一覧へ行を加える
  - 主要パッケージの一覧にStripeの3パッケージを、tech-stack.mdの決済サービスの節に用途を、オンボーディングにローカルのWebhookの転送の手順を加える
  - 完了状態: 文書の整形の検査が成功し、文書にプロジェクト名・ドメイン・キーの名前が含まれない
  - _Boundary: PaymentsTechDocs_
  - _Depends: 11.2_
  - _Requirements: 15.7, 16.3_

- [ ] 12.2 (P) サービス仕様を作成・更新する
  - 決済実装方針(`features/004-payments.md`)を新しく作り、`features`のREADMEに行を加え、購入種別とフルフィルメント・反映の流れ・返金の分担(返金ポリシーとの食い違いの申し送りを含む)・決済履歴の記録の規則・Linkの資金源の扱いを記載する
  - 法的通知の大枠の章5(4つの決済手段とLinkの注記)、ページ配置(`/checkout/{購入ID}`・アンカー無しの`/legal`・請求先住所・ランディングの状態)、文言規則(決済のエラーと状態、メールの件名2種)、料金とプラン(決済手段・有効期限・二重決済の返金)、日次タイムライン(23:40と4:21のジョブ)を更新する。プライバシーポリシー骨子(`003`)には「国外移転の記載事項」の`### Stripe(決済)`の項(infra-deliveryの型、委託先の一覧の順でCloudflareとAWSの間)と、委託先の一覧のStripeの「渡す情報」への仮名化IDと請求先住所を、準拠方針(`001`)には「データの保存場所」のStripeの箇条だけを加える(「国外移転の記載事項」の節は003にだけある)
  - 完了状態: 文書の整形の検査が成功し、各文書の決済手段・URL・ジョブの名前が設計と一致する
  - _Boundary: PaymentsServiceSpecs_
  - _Depends: 11.2_
  - _Requirements: 16.4, 16.5_

## Implementation Notes

- 1.1: StripeのキーはローカルのルートのWranglerの`secrets.required`に無いため、Infisicalの`dev`に登録してもローカルのapi・eventへ渡らない(`wrangler dev`は`secrets.required`のキーだけを`env`へ渡す)。ローカルで決済を試す1.4・8.4・11.1の完了状態には、ルートの`secrets.required`への追加が要る(開発者の判断待ち)
- 1.1: 決済の設定の検証の規則は`backend-lib/core/payments/payments-env.ts`、オリジンの形式の判定は`backend-lib/core/env/http-origin.ts`の`isHttpOrigin`にある。Workers統合テストのStripeのテスト用のキーは、シークレットの検出の誤検知を避けるため文字列を連結して作る
- 1.4: LinkはCSPに`https://link.com`と`https://*.link.com`(frame-src・connect-src・img-src)を要するが、frontend-libの`ORIGIN_PATTERN`はワイルドカードを拒否する(research.mdの「タスク1.4の調査」)。10.1で扱いを決める
- 1.4: 制限付きキーの権限は`docs/GUIDES/tech/operations/004-payment-data-operations.md`の表が正(Stripeに単独の返金の権限は無く「Charges and Refunds」)。Stripeの呼び出しを加えるタスクは表と突き合わせる
- 2.1: 反映の指示`ReflectionInstruction`と結果`ReflectionOutcome`は`core/payments/ports.ts`にある(2.3の正規化はここから型を読み込み、二重に定義しない)。`lib/core/**`は`drizzle-orm*`を読み込めない(apiのESLintが共有ディレクトリを検査する)
- 2.3: 8.2・8.4で返金の処理を作るとき、project-values.mdのメッセージの表の`payments.refund-payment`の行に再試行の方針(5回)を書き足す
- 2.4: メールの入力の金額は最小通貨単位の整数、日時はISO 8601の文字列。返金ポリシーの要旨は`common-lib/payments/refund-policy-summary.ts`の`REFUND_POLICY_SUMMARY`(最終確認画面(10.3)も同じ定数を使う)。購入確認メールの決済履歴のURLは`CLIENT_SITE_ORIGIN`+`/settings/billing`
- 3.1: `StripeApiGateway`は`@injectable`を付けず`{ appName, client, clientSiteOrigin }`を受け取る(5.7で`toDynamicValue`で束縛)。ポートは設計どおり`StripeGateway`1つ(3.2で統合)。テストの偽のStripeは`workers/payments/testing/fake-stripe.ts`。ログの属性名に`key`を含めない(伏せ字になる。`priceLookup`)
- 3.2: Stripeの結果への変換は`workers/payments/stripe-snapshots.ts`。持ち主の手がかりはPaymentIntentの取得と`invoicePayments.list`(API版`2026-10-28.endive`のPaymentIntentは`invoice`を持たない)。定期課金の`currentPeriodEnd`は項目の`current_period_end`の最大値。請求・返金・定期課金の想定外の状態は例外(チャージバックだけは値をそのまま返す)
- 3.3: 署名の検証は`workers/payments/stripe-webhook-verifier.ts`の`StripeWebhookSignatureVerifier`(`@injectable`無し、`{ appName, webhookSecret }`)。秘密が未設定なら`StripeUnavailableError`(ログ無し、経路が503)、拒否は`StripeSignatureError`(cause無し)。backend-libのWorkers統合テストはapiの`test:worker`で走る(eventは`lib/**`を除外)
- 4.1: 版の検査付きの一括の書き込みは`workers/payments/guarded-batch.ts`の`D1GuardedBatch`。決済セッションの記録の版の検査付きの挿入は`checkout-record-guard.ts`の`checkoutRecordGuardedInsert(db, record, guard)`で、4.2の`D1PaymentRecordStore.insertCheckoutRecordGuarded`はこれに委ねる。1文の前進は`PurchaseStore.advanceAlone`(行き先は`processing`・`expired`だけ)、前進の元は呼び出し側が`ADVANCEABLE_FROM`から渡す。`findOpenByUser`はopen・processing、`findOpenByTarget`はopenだけ、突合と日次の確認の対象はopen・processing・superseded(決済セッションIDの無い購入を除く)。テストの補助は`testing/payment-store-fixtures.ts`
- 4.2: `upsertByReference`は`記録済みのlast_event_at <= 受け取ったlast_event_at`のときだけ更新し、同意の日時と版・購入ID・関連ID・Linkの資金源のグループはcoalesceで既存の値を残す。5.4(必須): 初回の請求の`invoice.paid`が決済セッションの反映より先に届くと、決済セッションの記録の挿入が一意キーの衝突で無視され、同意の日時と版(12.6)とLinkの資金源のグループが記録されない。請求の反映で持ち主の購入を特定できたら、購入の同意の日時・版・購入IDを`NewPaymentRecord`に写し、「請求が決済セッションより先に届いても同意が残る」をテストで確かめる。反映は通知の本文ではなくStripeから取り直した状態を書く
- 4.3: 持ち主の特定は`workers/payments/payment-owner-resolver.ts`(契約も同じファイル、`@injectable`無しで`{ appName, gateway, purchases }`)。偽のゲートウェイは`testing/fake-stripe-gateway.ts`の`createFakeStripeGateway`。5.4(必須): 結果の`purchase`は定期課金の2回目以降の請求でも元の購入になるため、同意を写すのは初回の請求(`purchase.stripeInvoiceId`が未保存か同じ請求のID)だけにし、「2回目の請求の記録に同意が入らない」をテストで確かめる
- 5.1: 返金の依頼は`workers/payments/payment-refunds.ts`の`D1PaymentRefunds`(`@injectable`無し、依存の束を受け取る。5.7で`PAYMENTS_TYPES.PaymentRefunds`と`PaymentRefundStatements`の両方へ同じインスタンスを`toDynamicValue`で束縛)。`reflection:`の依頼キーの規則は`core/payments/refund-rules.ts`の`reflectionRequestKeyOf`・`isReflectionRequestKey`(5.2〜5.4で使う)。支払い済みは`fulfilled`・`rejected`かつPaymentIntentのIDあり。送信の失敗は`warn`のログだけで日次の確認が送り直す。テストの補助`refundIdOf`は有効なULID
- 5.2: 通知は`workers/payments/purchase-notifier.ts`の`EmailPurchaseNotifier`(`@injectable`無し、`{ appName, purchases, refunds, contacts, emails, clientSiteOrigin }`)。送信の失敗と入力を組み立てられない行は`failed`を返す(例外にしない)。呼び出し側は`failed`を例外として扱わない。5.4(必須): 自動返金の通知の返金日時は返金の依頼の行の`updated_at`のため、`succeeded`の後に同じ状態の通知が届いても`updated_at`が変わらないようにし(状態が変わるときだけ更新)、テストで確かめる。Ultrasの2回目以降の請求の反映で通知の部品が呼ばれないこと(要件11.4)もテストに加える。6.3: 入力を組み立てられない依頼待ちの行は毎日`failed`になり、古い順の100件の枠を塞ぎ得るため、知らせ方か読み飛ばしを検討する
- 5.3: 決済セッションの反映は`workers/payments/checkout-session-reflection.ts`の`StripeCheckoutSessionReflection`(`reflectSession`・`reflectSnapshot`。5.4の`PaymentReflector`は`checkout_session`の指示をここへ渡す)。PaymentIntentの状態`requires_payment_method`・`canceled`の未払いの完了は失効。テストの補助は`testing/checkout-reflection-harness.ts`。5.4(必須): 定期課金で請求の通知が先に届くと決済セッションの記録の挿入が無視され、`FulfillablePurchase.paymentRecordId`が実在しない行を指す。同意を写す修正と合わせて、既存の行のIDを解決して渡すか、契約のコメントに明記する
- 5.4: 反映の処理は`workers/payments/payment-reflector.ts`の`StripePaymentReflector`(`@injectable`無しで依存の束、受け取り口の名前の検証はコンストラクタ)。テストの補助は`testing/payment-reflector-harness.ts`。定期課金の受け取り口の文と`afterCommit`は冪等であること(同じ発生時刻の通知は再び確定し得る)。請求・返金の同じ通知の再適用は「反映」を返す(「反映済み」はチャージバックの同じ段階だけ)
- 5.5: 純収益の照会は`workers/payments/d1-payment-revenue-report.ts`の`D1PaymentRevenueReport`(`{ appName, db }`)、価格の照会は`price-catalog.ts`の`StripePriceCatalog`(`{ appName, gateway, snapshots, clock }`)、エクスポートは`payment-history-export.ts`の`StoredPaymentHistoryExport`(`{ records }`)。いずれも`@injectable`無し(5.7で束縛)。期間の誤りは`AppError(bad_request, validation_error)`。価格は`StripeUnavailableError`のときだけ保持の値(`stale: true`)を返す
- 5.6: 失効は`workers/payments/open-checkout-expirer.ts`の`StripeOpenCheckoutExpirer`(`{ appName, gateway, purchases, reflection, ids, clock }`、`@injectable`無し)。`remaining`は上限の外に`open`の購入が残っているか(`processing`は数えない)。上限は1〜50の整数(範囲外は`RangeError`)
- 5.7: 両アプリ共通の束縛は`workers/payments/payments-platform-module.ts`の`createPaymentsPlatformModule(appName)`(関数。識別子はすべて`PAYMENTS_TYPES`)。api・eventのモジュール一覧に加えるときは`EMAIL_PLATFORM_MODULE`と`IDENTITY_PLATFORM_MODULE`も同じ一覧に要る(通知の部品が使う)。Webhookの署名の検証は共通の束縛に含めず、8.4でイベントサーバーが束縛する。疎通確認の最終確認画面の文言(分量「1件」・役務の提供時期「提供する役務はありません」)は仮で、画面のタスクで文言規則に載せるかを確かめる
- 6.1: APIサーバーの識別子は`apps/api/src/application/payments/payments-types.ts`の`API_PAYMENTS_TYPES`、エラーは`payments-errors.ts`の`PAYMENTS_ERRORS`(`payments_unavailable`の文言は価格の照会と同じ全文)。決済の開始は`checkout-starter.ts`の`StripeCheckoutStarter`、回数制限と購入の書き込みは`apps/api/src/infrastructure/payments/`。application層は`**/lib/workers/**`を型も含めて読み込めない(ESLint)。12.x: `docs/GUIDES/service/design/003-text-and-copy-rules.md`の縮退運転の文言を設計のError Handlingの表に揃える
- 6.2: 決済画面・同意・決済後のランディング・決済履歴のユースケースは`apps/api/src/application/payments/`(`checkout-reader.ts`・`checkout-consent-recorder.ts`・`checkout-return-confirmer.ts`・`payment-history-reader.ts`)。照会は`requireUser`、同意の記録は`requireWritableUser`(停止中は`account_unavailable`)。入力の規則(`session_id`の形式・件数の範囲・カーソルの上限)は`common-lib/payments/payment-input-rules.ts`。7.1(必須): GraphQLの`after`に`PAYMENT_HISTORY_CURSOR_MAX`(256)を適用し、カーソルの誤り`invalid_cursor`をエラーの表で扱う。新しい文言2つは12.2で文言規則に加える。単体テストの偽のポートは`apps/api/test/support/payments-checkout-fakes.ts`
- 6.3: ジョブは`apps/api/src/application/payments/jobs/`(定義は`*_JOB_DEFINITION`)。7.1(必須): `API_PAYMENTS_TYPES.PaymentsJobIncidentReporter`を`SentryPaymentsJobIncidentReporter`(`infrastructure/payments/`)へ束縛する(無いと突合と日次の確認のジョブが解決できない)。7.2: 3つの定義を`SCHEDULED_JOBS`へ、23:40の式`40 7 * * *`をCron Triggersへ加える。12.2: 日次タイムラインに2つのジョブを載せる
- 7.1: APIサーバーの決済の束縛は`apps/api/src/composition/payments-module.ts`の`API_PAYMENTS_MODULE`、スキーマモジュールは`presentation/graphql/modules/payments/`。決済履歴は`PaymentRecordConnection { nodes, pageInfo }`。スキーマの集約点(`graphql-modules.ts`)への登録は7.1で済んだ。7.2(必須): `createPaymentsPlatformModule('api')`と`API_PAYMENTS_MODULE`を`MODULES`に加えたら、`test/support/payments-graphql-operations.ts`のオーバーライドと`payments-module.worker.test.ts`のモジュールの一覧から外す(二重の束縛を避ける)。bot判定の操作名は`payments_smoke_checkout`
- 7.2: APIサーバーの`MODULES`に`API_PAYMENTS_PLATFORM_MODULE`(`createPaymentsPlatformModule('api')`、`payments-module.ts`)と`API_PAYMENTS_MODULE`を登録した。23:40の式はルートの`triggers.crons`だけ(staging・prodは継承)。23:40に後続specのジョブ(match-engine)が加わるときは、project-values.mdの記述と23:40の予算の扱いを見直す
- 8.1: イベントサーバーの識別子は`apps/event/src/application/payments/event-payments-types.ts`の`EVENT_PAYMENTS_TYPES`(5つ)。受け付けは`stripe-webhook-receiver.ts`の`SignedStripeWebhookReceiver`、経路は`presentation/payments/stripe-webhook-route.ts`の`registerStripeWebhookRoute`(`POST /webhooks/stripe`)。署名の不正は`stripe_signature_invalid`(400)、秘密の未設定は`payments_unavailable`(503)、反映の失敗は経路がSentryへ送り500。テストの補助は`presentation/payments/testing/stripe-webhook-harness.ts`。8.4: 経路のアプリへの組み込みと署名の検証の束縛
- 8.2: 返金の実行は`apps/event/src/application/payments/refund-payment-handler.ts`の`RefundPaymentHandler`(再試行は`REFUND_PAYMENT_RETRY_POLICY`)。冪等キーは`refund:<依頼キー>`。処理するのは`requested`の依頼だけで、状態の更新は`updateStatus`の`from`で`requested`のときだけ。恒久的な失敗はポート`RefundIncidentReporter`でSentryへ知らせる。8.4(必須): `EVENT_PAYMENTS_TYPES.RefundIncidentReporter`を`SentryRefundIncidentReporter`(`infrastructure/payments/`)へ束縛し、`MESSAGE_HANDLERS`に`{ contract: PAYMENTS_REFUND_MESSAGE, handler: EVENT_PAYMENTS_TYPES.RefundPaymentHandler, retry: REFUND_PAYMENT_RETRY_POLICY }`を加える
- 8.3: 波及処理は`apps/event/src/application/payments/customer-erasure-handler.ts`・`open-checkout-expiry-handler.ts`、削除の書き込みはポート`payment-account-data-eraser.ts`と`infrastructure/payments/d1-payment-account-data-eraser.ts`。8.4(必須): `EVENT_PAYMENTS_TYPES.PaymentAccountDataEraser`→`D1PaymentAccountDataEraser`、2つの波及処理を`.to(...)`で束縛し、`payments.customer-erasure`(`purge_due`、400)と`payments.open-checkout-expiry`(`withdrawn`・`suspended`、410)をライフサイクルの登録箇所へ加え、`payments-lifecycle-handlers.worker.test.ts`の`REGISTRATIONS`を`USER_LIFECYCLE_ASYNC_HANDLERS`に置き換え、project-values.mdの「非同期の波及処理の登録」の行に2件を追記する
- 8.4: イベントサーバーの決済のモジュールは`apps/event/src/composition/payments-module.ts`(`EVENT_PAYMENTS_PLATFORM_MODULE`・`EVENT_PAYMENTS_MODULE`、Webhookの経路の登録を含む)。返金のメッセージ・2つの波及処理は本物の一覧に登録済みで、8.2・8.3のWorkers統合テストも本物の一覧を使う
