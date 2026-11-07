# Implementation Plan

- [ ] 1. 基盤: 共有の定義・テーブル・文言・開発用sandboxの準備
- [x] 1.1 加入状態・価格・機能フラグの共有定義と、監査ログの操作種別を作る
  - 前提: dev-tooling・backend-platform・api-gateway・email-delivery・frontend-platform・infra-delivery・content-processing・media-pipeline・identity-auth・admin-foundation・legal-pages・inquiry-chat・paymentsの全タスクが完了していること(購入種別の口・定期課金の受け取り口とその確定後の呼び出し・定期課金の状態の変化の解約の予定時刻・購入確認メールの追加事項(paymentsのU1・U2、ultras-subscriptionの仮3・仮5)・`StripeGateway`・`CheckoutStarter`・`PriceCatalog`・`MoneyText`・設定ページのシェル・利用者の連絡先の照会(`UserContactDirectory`)・管理画面のシェルと監査ログ・E2Eの管理者のログインの補助(`e2e/support/admin-bootstrap.ts`))。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、加入状態の4値と表示名、特典を受けられる状態(有効・支払いの再試行中・解約済み)、価格の`lookup_key`(`ultras_monthly`)、機能フラグの鍵と初期値(オフ)、操作種別`ultras-promotion.update`(監査ログの画面の表示名は「Ultras導線の機能フラグの変更」、対象は設定、理由は任意、詳細は`enabled`だけ、対象は1件)の単体テストを書く。加入状態の値はデータエクスポートの`plan.status`と一致させる
  - 4アプリが読み込める共有ディレクトリに定義を置き、操作種別を監査ログの操作種別の集約点へ連結する
  - `apps/common-lib/admin/audit-actions/index.unit.test.ts`が操作種別の名前の一覧を完全一致で確かめるため、期待に`ultras-promotion.update`を加える
  - 完了状態: 単体テストが成功し、監査ログの操作種別のカタログの作成(重複の検査)が新しい種別を含めて成功し、client・admin・api・eventの型検査で配置先から読み込める
  - _Requirements: 2.2, 2.3, 2.4, 2.9, 10.2, 10.5_

- [x] 1.2 Ultrasの4テーブルを定義し、マイグレーションと機能フラグの初期行の`_seed`を作る
  - 先に、加入・知らせ・メールの依頼・設定の4テーブルの列の型・NOT NULL・既定値、定期課金のIDの一意、利用者ごとに「開始済みかつ特典の終了時刻が空」の行を1つに限る部分一意索引、`(user_id, started_at)`の索引、知らせの定期課金のIDの一意とメールの依頼の重複防止の鍵の一意、`users`への外部キー、paymentsの購入IDと管理者IDに外部キーが無いこと、設定の鍵の一意、設定に`state_token`の列が無く`version`で照合することを確かめる単体テストを書く
  - スキーマの集約点へ加え、mainの最新を取り込んでから`<日時>_ultras_subscription`のマイグレーションを生成する。続けて`db/003`の「初期データ」に沿って`<日時>_ultras_subscription_seed`のカスタムマイグレーションを作り、機能フラグの初期行(鍵`ultras_promotion`・オフ・版0、IDは固定のULID、`created_at`・`updated_at`はそのULIDの時刻部と同じエポックミリ秒、最後に変更した管理者は空)を`ON CONFLICT (setting_key) DO NOTHING`で挿入する
  - `apps/db/schema/index.unit.test.ts`(包含の確認)に4つのテーブル名を加える(前例)
  - 完了状態: 単体テストが成功し、2つのマイグレーションをローカルに適用でき、適用後に機能フラグの行がオフで1件あり(NOT NULLの列がすべて埋まり、IDの時刻部と`created_at`が一致する)、`_seed`をもう一度実行しても行が増えず、同じ利用者の開始済みで終了時刻が空の行を2つ作れない
  - _Requirements: 1.9, 2.1, 10.5, 11.1_

- [x] 1.3 (P) ページ配置と文言規則に、料金ページ・プラン管理画面・管理画面の設定ページの配置と文言を先に書く
  - ページ配置: `/pricing`の「機能フラグがオフなら404」を「未加入者にUltrasの区画を表示しない(ページは他の区画のために表示を続ける)」に直し、区画の並び(Ultras・スポンサー広告・法的通知へのリンク)、`/settings/plan`をCustomer Portalに一本化した配置(状態ごとの表示・「解約・支払い方法の管理」のボタン・Portalから戻った直後の反映待ち)、管理者側の「設定」ページの区画の並び(決勝日・機能フラグ・送信者情報)を記載する
  - 文言規則: 加入状態の表示名、料金ページ・プラン管理画面の状態ごとの文言、最終確認画面の追加事項の4行(自動更新と毎月の請求額・解約の方法と末日までの継続・日割りの返金なし・支払い済みの参加費は返金しない)、エラーの文言(設計の表)、通知メールの件名2種、機能フラグの区画の説明文、Portalから戻った直後の反映待ちの文言と確かめ直しを終えた後の開き直しの案内、料金ページの説明(`<meta name="description">`)の文、Customer Portalを現在利用できない理由(`UnavailableNotice`の`reason`)を加える
  - 完了状態: 2つの文書が整形の検査を通り、2.4・4.2・5・7・8のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md`_
  - _Requirements: 13.4_

- [x] 1.4 (P) 運用手順書に定期課金の節を書き、開発用sandboxの準備を依頼する
  - `operations/004`の、paymentsが書いた「価格」(定期課金の価格の`lookup_key`は`<定期課金の価格のlookup_key>`のプレースホルダーで書く)・「Customer Portal」(設定の表と前提)・「制限付きキーの権限」(Subscriptions・Customer Portalの行)の節を確かめて足りない点だけを追記し、「定期課金」の節を本プロジェクト固有の値を含めずに加える: 環境ごとの価格(`lookup_key`、税込)の作成、Portalの機能(支払い方法の更新・期間末の解約・取り消しを有効、プランの変更・請求書の履歴を無効、決済手段は決済機能と同じ。既存の「Customer Portal」の節を参照する)、再試行の後に定期課金を解約する設定、顧客向けメール(支払いの失敗など)を送らない設定、api・eventの制限付きキーへのSubscriptions・Customer Portalの権限の追加(権限の表の更新)、test clockによる検証の手順(test clock付きのCustomerをsandboxで作り、ローカルDBの利用者とCustomerの対応表に結び付けてから決済する。同じ利用者で2つ目の加入を始めると拒否されるため、シナリオごとに利用者を分け、利用者ごとにtest clock付きのCustomerを作る。支払いの失敗は、成功するテストカードで加入した後、Customer Portalで支払い方法を請求に失敗するテストカード(`4000 0000 0000 0341`)に差し替えてから、test clockを次の更新日の後へ進めて再現する。test clockの時刻はアプリの実時刻より先に進むため、Stripeから届く終了の時刻や課金期間の終了は実時刻より未来になり、画面は実時刻で状態を導くので終了の後も終了前の状態に見える。終了は画面ではなく、DBに保存した特典の終了時刻・外部の状態・確定済みの印で確かめる)、Stripeのダッシュボードと画面の加入状態の突き合わせの手順、退会・停止の波及処理の解約が再試行の上限で失敗した通知を受けたときにダッシュボードで解約する手順。テーブル名・列名・画面の名前・期待値など本サービス固有の値は書かず、それらは10.2と`features/005`(9.2)に置く
  - プレースホルダーの本プロジェクトの値(`ultras_monthly`)は、9.1で`docs/onboardings/project-values.md`に載せる
  - `tech-stack.md`のCustomer Portalの用途を「Ultrasの支払い方法の更新・解約・解約の取り消し」に改める
  - 開発者が行う作業(dev用のsandboxでの価格`ultras_monthly`の作成、Portal・再試行・顧客向けメールの設定、制限付きキーの権限の追加。stagingはmainへのマージ前)を一覧にして報告する
  - 完了状態: 手順書と`tech-stack.md`が整形の検査を通り、開発者の準備の完了(または未完了で保留した旨)が作業の報告に記録されている
  - _Boundary: `docs/GUIDES/tech/operations/004-payment-data-operations.md`の定期課金の節、`docs/onboardings/tech-stack.md`_
  - _Requirements: 6.3, 6.4, 8.10, 12.1, 12.2_

- [ ] 2. 純粋な規則と契約
- [x] 2.1 特典の継続期間と加入状態の導出の規則、ポートの型を作る
  - 先に、業務日付の日の終わり(0:00ちょうど・0:00の1ミリ秒後・23:59:59.999の境界)、課金期間の終了時刻から特典の終了時刻を求める規則(終了が業務日付の0:00ちょうどなら前日の終わり)、加入状態の4状態と未有効の導出、時点の判定が左端を含み右端を含まないこと、期間の重なりの両端を、設計の境界の例でテストする
  - 先に、`core/ultras/identifiers.unit.test.ts`で、`ULTRAS_TYPES`の各値が`Symbol.for('ultras.<名前>')`であり、オブジェクトが凍結されていることを確かめる
  - 規則を純粋な関数として作り、`core/ultras`(application層と後続specが読み込む。`Database`・`BatchItem`・`workers`・`apps/db`を読み込まない)にDIの識別子と、メールの依頼の種類(支払いの失敗・解約の受付)の型、特典の判定・各ストアの文を返さない操作・機能フラグの照会・エクスポートの照会・知らせの送り出し(`ActivationDispatcher`)・メールの依頼(`UltrasNotifier`)のポートの型を作る(メールの宛先と宛名はidentity-authの`UserContactDirectory`を使い、本specはポートを持たない)
  - 業務日付の日の終わりは、`core/time/business-time.ts`の`toBusinessDateTime`・`fromBusinessDateTime`を組み合わせて`core/ultras/entitlement-rules.ts`に作る(他のspecも要るようになったら`core/time`へ移す)
  - 各ストアの文を返す操作(加入の更新と有効化・知らせとメールの依頼の行の挿入・利用者の行の削除)の型は`workers/ultras/statement-contracts.ts`に作る
  - 完了状態: 単体テストが成功し、判定がデータベースや時計に依存せず、`core/ultras`が`Database`・`BatchItem`・`workers`・`apps/db`を読み込まない
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.4_

- [x] 2.2 定期課金の状態の変化から加入の更新とメールの依頼を決める規則を作る
  - 先に、解約の予約(`cancel_at_period_end`だけ・解約の予定時刻だけの両方)→課金期間の末日の終了で末日の終わりまで特典が続くこと、支払いの失敗→再試行の後の終了でその時点で終わること、予約の無い即時の解約、予約の取り消しで特典の終了時刻が空に戻ること、終了の状態で決めた終了時刻が後から届いた変化で変わらないこと、有効化の前の変化の値が保存されること、`past_due`への変化で支払いの失敗の依頼が1回だけ作られること、解約の予約で出どころが停止・退会なら依頼を作らず利用者なら解約の受付の依頼を作ること、終了のメールの依頼を作らないことをテストする
  - 2.1の規則を使い、`unpaid`・`paused`を終了として扱う
  - 完了状態: 単体テストが成功し、すべての遷移の結果(加入の値と依頼の一覧)が設計の規則と一致する
  - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10, 3.4, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 2.3 (P) 加入が有効になった知らせの契約・登録の検証・メッセージの契約を作る
  - 先に、ハンドラの登録の名前の形式・重複・実行順の重複の拒否と昇順の並び、メッセージの本文の検証(ULIDの知らせのID)、再試行の方針を確かめる単体テストを書く
  - 知らせの型とハンドラの登録の型を作り、メッセージの契約を集約点へ加える
  - 完了状態: 単体テストが成功し、メッセージの契約の一覧の重複の検査が新しい契約を含めて成功する
  - _Boundary: ActivationContract, ActivationMessage_
  - _Requirements: 4.1, 4.3, 4.4_

- [x] 2.4 (P) 支払いの失敗と解約の受付のメールの種別とテンプレートを同時に作る
  - 先に、2種の入力の検証の単体テストと、描画のWorkers統合テストで、件名(文言規則の2種)・本文・宛名、日時のUTCの表記、プラン管理画面へのリンク、支払いの失敗で特典が再試行の間は続き再試行がすべて失敗すると終了する旨、解約の受付で受け付けた日時と特典の終了日時と取り消しの方法、配信停止のリンクが無いことを確かめる
  - `ultras.payment-failed`・`ultras.cancellation-accepted`の種別を`core/email/kinds/ultras.ts`の1ファイルに`category: 'transactional'`で作り(前例`kinds/payments.ts`。`kinds/index.unit.test.ts`に2種の名前と`category`の確認を加える)、1ファイル1コンポーネントの本文(`*-email-body.tsx`)・テンプレート(`*-template.ts`)を`templates/ultras/`に同じ変更で作り、種別とテンプレートの集約点へ同時に加える(email-deliveryの1対1の検査が途中で失敗しないようにする)
  - 完了状態: 単体テストと描画のテストが成功し、種別とテンプレートの1対1の検査が成功し、ローカルのWorkers統合テスト(またはメールの送信のメッセージを手動で流す確認)から送った2種のメールがMailpitに届く
  - _Boundary: UltrasEmailKinds, UltrasEmailTemplates_
  - _Depends: 1.3_
  - _Requirements: 8.1, 8.3, 8.6, 8.7_

- [ ] 3. D1の実装と特典の判定
- [x] 3.1 加入のストアを作る
  - 先に、ローカルD1を使うWorkers統合テストで、Stripe側の値の更新が有効化の列を上書きしないこと、有効化が既存の行のStripe側の値を保ったまま開始時刻・利用者・購入IDだけを書くこと(行が無ければ有効の状態で挿入)、別の加入を除いた時点の重なりの検索、90件を超える利用者の期間の重なりの一括の検索、最新の有効化された加入、終了していない加入の一覧、解約の出どころの記録、物理削除の文を確かめる
  - D1の実装は1つのクラスで`core/ultras`のストアの契約(文を返さない操作)と`workers/ultras/statement-contracts.ts`の文の契約の両方を実装する
  - 完了状態: Workers統合テストが成功し、部分一意索引の違反が一括の書き込みの失敗として返る
  - _Requirements: 1.7, 1.9, 2.1, 2.10, 3.3, 11.1_

- [x] 3.2 (P) 知らせとメールの依頼のストアと、機能フラグの読み取りを作る
  - 先に、ローカルD1を使うWorkers統合テストで、知らせの定期課金のIDでの重複の無視、送り出しの記録と完了の記録、送り出し直しの対象(未送り出しで10分以上・送り出しから24時間以上で未完了)、完了から30日以上の削除、メールの依頼の重複防止の鍵での無視・定期課金ごとの依頼待ちの検索・10分以上の依頼待ちの検索(上限件数)・依頼待ちのときだけの依頼済みの記録・対象外の記録・30日以上の削除、機能フラグの初期行の読み取りと行が無いときのオフを確かめる
  - 完了状態: Workers統合テストが成功し、各削除が1回500件で止まり残りの有無を返す
  - _Boundary: D1ActivationStore, D1NoticeStore, UltrasPromotionFlagReader_
  - _Depends: 1.2, 2.1_
  - _Requirements: 4.2, 8.8, 8.9, 10.5, 11.1, 11.3_

- [x] 3.3 特典の判定と現在の加入状態・エクスポートの照会を作る
  - 先に、Workers統合テストで、指定時点・指定期間・複数の利用者の一括の判定、過去の時点の判定が後の解約の取り消しで変わらないこと、機能フラグがオフでも判定が変わらないこと、現在の加入状態が最新の有効化された加入から導かれること、エクスポートの`plan`の項目と加入したことが無い利用者の空を確かめる
  - 完了状態: Workers統合テストが成功し、判定が特典の継続期間の列だけを使う
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 11.2_

- [ ] 4. paymentsの口の実装と送り出し
- [x] 4.1 知らせの送り出しとメールの依頼を作る
  - 先に、模擬のポートの単体テストで、知らせの送り出しの成功で送り出しの記録が残り失敗は`warn`のログだけになること、identity-authの`UserContactDirectory`の模擬で`findContact`が`undefined`を返す利用者(退会済み・物理削除済み)のメールの依頼が対象外になり、停止中の利用者には依頼されること、宛名に`findContact`の`nickname`が使われること、依頼の成功の後にだけ依頼済みになること、既に依頼済みの依頼を再び送らないこと、メールの入力のプラン管理画面のURLが既存の`CLIENT_SITE_ORIGIN`から作られることを確かめる
  - ログに利用者のメールアドレスとニックネームを含めない
  - 実装は`workers/ultras`に置き、2.1で`core/ultras/ports.ts`に定めた`ActivationDispatcher`・`UltrasNotifier`の契約を実装する(`MessagePublisher`を使うのは知らせの送り出しの実装だけ)
  - 宛先と宛名は、identity-authがapi・eventの両方に束縛する`IDENTITY_PLATFORM_TYPES.UserContactDirectory`を注入し、`findContact`の`email`・`nickname`で引く。本specは`users`の列を直接読まない
  - 完了状態: 単体テストが成功し、2.3のメッセージと2.4の種別で送る
  - _Depends: 2.3, 2.4, 3.2_
  - _Requirements: 4.1, 4.5, 8.1, 8.3, 8.8, 8.9, 12.3_

- [x] 4.2 (P) Ultrasの購入の可否と内容を作る
  - 先に、模擬のポートの単体テストで、拒否の順序(機能フラグがオフ→加入中→解約済みで継続期間内)とそれぞれのコード、価格の`lookup_key`・数量1・期限なし・二重決済の鍵なし・bot判定なし、最終確認画面の追加事項の4行(毎月の請求額を価格から作る)を確かめる
  - 最終確認画面は追加事項の各行を文言そのものを鍵にして描くため(paymentsの`checkout-summary.tsx`)、4行の文言を互いに異なるものにする
  - 完了状態: 単体テストが成功し、追加事項の文言が文言規則と一致する
  - _Boundary: UltrasOfferPolicy_
  - _Depends: 3.2, 3.3_
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 10.6_

- [x] 4.3 Ultrasの加入の有効化を作る
  - paymentsの`workers/payments/fulfillment-contract.ts`の`PurchaseFulfillment`を実装し、有効化と知らせの行の文は`workers/ultras/statement-contracts.ts`の文の契約から作る
  - 先に、模擬のストアの単体テストで、定期課金のIDが無い購入の拒否、支払いの確定の時刻に別の加入の継続期間が重なる場合の拒否、それ以外で有効化と知らせの行の文を返すこと、確定後の呼び出しで知らせを送り出すことを確かめる
  - 完了状態: 単体テストが成功し、`prepare`が副作用を持たない(ストアの書き込みを呼ばない)
  - _Depends: 4.1_
  - _Requirements: 1.7, 1.8, 4.1, 4.2_

- [x] 4.4 (P) 定期課金の状態の受け取り口を作る
  - paymentsの`workers/payments/fulfillment-contract.ts`の`SubscriptionEventSink`を実装する
  - 先に、模擬のストアの単体テストで、利用者に結び付かない変化で文を返さないこと、既存の行と無い行の両方で2.2の規則の結果を更新の文にすること、依頼ごとにメールの依頼の行の文を返すこと、確定後の呼び出しでその定期課金の依頼待ちのメールを送ることを確かめる
  - 完了状態: 単体テストが成功し、受け取り口が古い通知の判定を持たない(paymentsに委ねる)
  - _Boundary: PlanStateSink_
  - _Depends: 2.2, 4.1_
  - _Requirements: 2.1, 2.10, 2.11, 2.12, 6.8, 7.8, 8.1, 8.3, 8.4_

- [x] 4.5 Ultrasの共有の束縛を作り、paymentsの登録箇所とapi・eventに組み込む
  - 両アプリ共通の束縛を、アプリ名を引数で受け取る`createUltrasPlatformModule(appName)`(前例`createPaymentsPlatformModule(appName)`。アプリ名をログのカテゴリの先頭に使う)として作り、apiとeventの束縛の一覧へそれぞれのアプリ名で同時に加え、paymentsの購入種別の登録箇所に`ultras`を、定期課金の受け取り口の登録箇所に`ultras-subscription.plan-state`を加える(登録と束縛を同じ変更にして、DIの解決の検査が途中で失敗しないようにする)
  - 先に、模擬の`StripeGateway`と模擬のメッセージの送信を使うWorkers統合テストで、paymentsの反映を通して次を確かめる: `ultras`の決済セッションの完了で加入が有効になり知らせの行が1つでき送り出しが依頼されること、Webhookと`return_url`から同時に反映しても知らせが1つであること、継続期間内の利用者の2つ目の加入が拒否されpaymentsの返金の依頼ができること、同時の2つの確定で1つだけが有効になること、定期課金の更新の通知が有効化の前に届いても有効化の後の加入状態に反映されること、支払いの失敗で依頼待ちのメールが送られること
  - paymentsの`apps/backend-lib/workers/payments/payments-platform-module.worker.test.ts`が2つの登録の一覧を完全一致で確かめ、`resolve('ultras')`が無いことを期待しているため、本specの登録を含む期待に直す
  - apiとeventの`composition/ultras-module.worker.test.ts`(前例`payments-module.worker.test.ts`)で、モジュールの一覧から`ULTRAS_TYPES`の各識別子を解決できることを確かめる(汎用のDIの解決の検査はUltrasのクラスを解決しないため)
  - 知らせのメッセージの受け取りは6.1で登録する。それまでの確認は模擬の送信に限り、ローカルで実際の決済を流さない
  - 完了状態: Workers統合テスト(`ultras-module.worker.test.ts`の識別子の解決を含む)と3経路のDIの解決の検査が成功する
  - _Requirements: 1.7, 1.8, 1.9, 2.1, 2.10, 4.1, 4.2, 8.1_

- [ ] 5. APIサーバー
- [x] 5.1 料金とプランの照会、加入の開始のGraphQLを作る
  - 先に、模擬のポートの単体テストで、料金の照会がフラグ・価格・価格の古さを返しログイン不要であること、価格の照会が`payments_unavailable`を投げたときだけ価格を空(古さは偽)にし、それ以外の例外は投げ直すこと、利用者の照会が未ログインで空・ログイン中は現在の加入状態・特典の有無・Portalを開けるかを返すこと、加入の開始が`SessionView`を受け取り購入種別`ultras`で決済の開始を呼ぶことを確かめる
  - ユースケースは`GraphQLContext`を受け取らず、解決関数が`session`を取り出して渡す(application層からpresentation層を読み込めないため)
  - apiのUltrasのモジュールとスキーマモジュールを作り、`ultrasOffer`・`viewerUltras`・`startUltrasCheckout`を加え、束縛とスキーマモジュールの一覧へ加える
  - apiの識別子は`application/ultras/ultras-types.ts`(`API_ULTRAS_TYPES`、前例`payments-types.ts`)、application層のエラーコードと文言は`application/ultras/ultras-errors.ts`(前例`payments-errors.ts`)に置く。決済の開始の回数制限は`describe`の前に消費されるため、`ultras_already_subscribed`などの拒否でも1回分を数える(paymentsの仕様で変えない)
  - Workers統合テストで、未確認・停止中・フラグがオフ・加入中・解約済みの拒否のコード(`email_not_verified`・`account_unavailable`・`ultras_unavailable`・`ultras_already_subscribed`・`ultras_resume_in_portal`)、`client`以外の呼び出し元の拒否を確かめる
  - apiで`bun run graphql:generate`を実行し、`src/presentation/graphql/generated/`の`schema.graphql`・`resolvers-types.ts`を再生成する(`graphql-modules.worker.test.ts`がコミットした生成物との一致を確かめる)。5.2・5.3で操作を足したときも同じく再生成する
  - 完了状態: 単体テストとWorkers統合テストが成功し、スキーマの検査が成功する
  - _Depends: 4.5_
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 9.2, 9.3, 9.7, 10.7, 10.8_

- [ ] 5.2 Customer Portalのセッションの作成と回数制限を作る
  - 回数制限はapplication層のポート`PortalSessionLimits`(`application/ultras/portal-ports.ts`、前例`checkout-ports.ts`)にし、厳密カウンタを使う実装`CounterPortalSessionLimits`をAPIサーバーのinfrastructure層に置く(`backend/003`の「厳密カウンタを使うクラスはインフラ層に置く」)。ユースケースは`core/ultras`・`core/payments`の型と識別子とこのポートだけを受け取る
  - 先に、模擬のポートの単体テストで、停止中の拒否、加入したことが無い・Customerが無い場合の`ultras_portal_unavailable`、戻り先が`/settings/plan?portal=returned`であること、Stripeの一時的な障害の`payments_unavailable`を確かめる。Workers統合テストで、`CounterPortalSessionLimits`と、スキーマモジュールを通した21回目の`rate_limit_exceeded`と`Retry-After`を確かめる
  - `createUltrasPortalSession`をスキーマモジュールへ加える
  - 完了状態: 単体テストとWorkers統合テストが成功し、セッションが本人のCustomerにだけ作られ、静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Requirements: 6.1, 6.2, 6.5, 6.6, 6.7_

- [ ] 5.3 機能フラグの照会と変更を、監査ログとともに作る
  - 先に、模擬のポートの単体テストで、ユースケースが受け取った管理者のIDで監査ログの記録を準備すること、監査ログの記録の準備の内容(操作種別・対象・詳細の`enabled`)を確かめる。スキーマモジュールのWorkers統合テストで、照会が全ロールに許され変更が最上位管理者だけに許されること、理由が500書記素を超えると拒否されることを確かめる。ローカルD1のWorkers統合テストで、版の照合の失敗で設定と監査ログのどちらも変わらず`version_conflict`になること、成功で両方が確定し版が1つ進むこと、最後に変更した管理者のニックネーム(削除済みは空)を確かめる
  - 認可は解決関数がpresentation層の`requireAdmin`で行い、ユースケースへ管理者のIDを渡す(前例`modules/legal/admin-resolvers.ts`)。ユースケースは`GraphQLContext`・`requireAdmin`を読み込まない
  - 版の照合は、apiのinfrastructure層の`buildAuditLogStatements(db, entry, { kind: 'condition', condition })`で「鍵と読み取った版が一致する設定の行がある」ことを条件にした監査ログの文を先頭に置き、設定の更新を続ける。失敗は`isAuditGuardRejection`で判定して`version_conflict`に変え、他の失敗は投げ直す(前例inquiry-chatの`d1-inquiry-category-store.ts`)
  - `ultrasPromotionSetting`・`updateUltrasPromotionSetting`をスキーマモジュールへ加え、`admin`以外の呼び出し元を拒否する
  - 完了状態: 単体テストとWorkers統合テストが成功し、監査ログの検索で変更の記録が見つかる
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 5.4 4:21の送り出し直しと後始末のジョブを作り、定期実行に登録する
  - 先に、模擬のポートの単体テストで、未送り出しの知らせの送り出し、依頼待ちのメールの依頼、30日以上の行の削除の3つの処理と、各処理の失敗が他の処理を止めないことを確かめる
  - ジョブ`ultras-subscription.pending-dispatch-sweep`(業務時刻4:21、`order` 500)をapiの束縛とジョブの一覧へ同時に加える
  - 4:21の全ジョブは合計300秒の予算(`SCHEDULED_RUN_BUDGETS`)を共有する。4:21のジョブの一覧を確かめる既存のテスト(`apps/api/test/config/payments-scheduled-jobs.unit.test.ts`の`order` 410の次のジョブ、`apps/api/src/composition/search-module.worker.test.ts`・`search-module.reextraction.worker.test.ts`のジョブの名前の一覧と配列への`toMatchObject`)の期待に本specのジョブ(500)を加える
  - ジョブは知らせの送り出し・メールの依頼・各ストアを`core/ultras`の型と識別子で受け取り、`**/lib/workers/**`を読み込まない
  - 完了状態: 単体テストとcron式の一致の検査が成功し、ローカルで4:21のcron式を手動で起動するとジョブが動く
  - _Requirements: 4.5, 8.9, 11.3_

- [ ] 6. イベントサーバー
- [ ] 6.1 加入が有効になった知らせの処理を作り、ハンドラの登録箇所を用意する
  - 先に、模擬のポートの単体テストで、行が無い・完了済みの知らせで何もしないこと、登録の順にハンドラを呼びすべて成功したら完了を記録すること、1つが例外を投げたら完了を記録せず例外を返すことを確かめる
  - eventのUltrasのモジュール、空のハンドラの登録箇所(後続specが追記する)、メッセージの処理を作り、束縛とメッセージの処理の一覧へ同時に加える
  - 完了状態: 単体テストと3経路のDIの解決の検査が成功し、ローカルで知らせのメッセージを流すと完了が記録される
  - _Depends: 2.3, 4.5_
  - _Requirements: 4.1, 4.4_

- [ ] 6.2 退会・停止の解約と物理削除の波及処理を作る
  - 先に、模擬のポートの単体テストで、退会で終了していない加入ごとに出どころ(退会)を記録してから即時に解約すること、停止で予約の無い加入だけ出どころ(停止)を記録して期間末に解約すること、予約済みの停止で何もしないこと、停止中の退会で即時に解約すること、Stripe上で解約済みを成功として扱うこと、Stripeの一時的な障害・恒久的な拒否・対象が無いことのいずれでも例外を捕まえずに返す(波及処理の再試行に任せる)こと、物理削除の時期に削除の書き込みの単位のポートを呼ぶことを確かめる。ローカルD1のWorkers統合テストで、`D1UltrasAccountDataEraser`が物理削除の時期に3テーブルの利用者の行を1回の一括の書き込みで消すことを確かめる
  - 物理削除の書き込みの単位はイベントサーバーのapplication層のポート`UltrasAccountDataEraser`(`application/ultras/ultras-account-data-eraser.ts`、前例`payment-account-data-eraser.ts`)にし、D1の文を組み立てて一括の書き込みを実行する実装`D1UltrasAccountDataEraser`をinfrastructure層に置く。2つの波及処理は`core/ultras`・`core/payments`の型と識別子とこのポートだけを受け取る
  - `ultras-subscription.subscription-cancellation`(退会・停止、`order` 500)と`ultras-subscription.subscription-erasure`(物理削除、`order` 500、どちらも本specの500番台でpaymentsの400番台の後に動く)をeventの束縛と非同期の波及処理の一覧へ同時に加える。停止の解除には登録しない
  - 波及処理の一覧を確かめる既存のテスト(`apps/event/src/composition/payments-module.worker.test.ts`の`withdrawn`・`suspended`・`purge_due`ごとの名前の完全一致、`payments-lifecycle-handlers.worker.test.ts`・`identity-module.worker.test.ts`の完了した波及処理の名前の一覧)の期待に本specの2つの波及処理を加える
  - 完了状態: 単体テスト・Workers統合テスト・3経路のDIの解決の検査が成功し、波及処理の登録の検証(同じ種類での`order`の重複)が成功し、静的解析でイベントサーバーのapplication層に`**/lib/workers/**`の読み込みが無い
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 11.1, 12.3_

- [ ] 7. 利用者側の画面
- [ ] 7.1 クライアントの操作と、導線の表示の可否の部品を作る
  - `ultrasOffer`・`viewerUltras`・`startUltrasCheckout`・`createUltrasPortalSession`の操作を、clientの`src/graphql/operations/ultras/`に1ファイル1操作の`.graphql`で書き(操作名は`ClientUltrasOffer`・`ClientViewerUltras`・`ClientStartUltrasCheckout`・`ClientCreateUltrasPortalSession`、`graphql()`を呼ばない)、clientで`bun run graphql:generate`を実行して型とpersisted operationsを生成する。画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読み、`gql.ts`・`index.ts`を読まない(frontend-platformの「操作の追加手順」)
  - 先に、ブラウザテストで、フラグがオンのときだけ子を描画し、読み込み中とエラーでは描画しないことを確かめる
  - clientの`codegen.unit.test.ts`の前例に合わせ、Ultrasの操作名の一覧(`ULTRAS_OPERATION_NAMES`)の確認を加える
  - 完了状態: 型の生成とブラウザテストが成功し、`graphql:allowlist`でapiの許可リストを再生成して`graphql:check`とclientの`codegen.unit.test.ts`(操作名の接頭辞)が成功し、後続specが部品を読み込める
  - _Depends: 5.1, 5.2_
  - _Requirements: 10.6, 10.8_

- [ ] 7.2 加入ボタンと特典の一覧を作る
  - 先に、ブラウザテスト(axeの違反0件)で、特典・自動更新と解約の条件・支払い済みの参加費を返金しない旨の一覧、加入ボタンの未ログインのログインへの導線(戻り先`/pricing`)、未確認の無効と理由、価格が無いときの無効、押下で決済画面へ移ること、エラーのコードごとの文言を確かめる
  - 完了状態: ブラウザテストが成功し、2つの部品を料金ページとプラン管理画面から読み込める
  - _Requirements: 1.1, 9.2, 9.4, 9.5, 9.7_

- [ ] 7.3 料金ページの枠とUltrasの区画を作る
  - 先に、区画ごとのエラーの境界を共通部品へ移す: inquiry-chatが作った`apps/admin/src/components/layout/recoverable-slot.tsx`の`RecoverableSlot`を、問い合わせの扱い(`contactAvailable`と`contactHref`)をpropsで受け取る形にして`apps/frontend-lib/components/state/recoverable-slot.tsx`へ移し、Storybookのストーリーとブラウザテスト(propsによる文言の出し分け・再試行・見出しの補い)を足す。adminの3つの利用箇所(`dashboard-grid.tsx`・`category-sections-view.tsx`・`inquiry-detail-actions-view.tsx`)は`ADMIN_PROFILE.contactAvailable`を渡す形に改め、`docs/GUIDES/tech/frontend/005-shared-components.md`の部品の一覧と使い方、`009-admin-console-shell.md`の部品の一覧を移した先に合わせる
  - 先に、frontend-libの`page-head.unit.test.ts`に、`PageHeadInput`の省略可能な`description`を渡したときだけ`<meta name="description">`が出ることのテストを足し、`page-head.ts`と、clientの`buildSitePageHead`(`src/head/page-heads.ts`)が`description`を渡せるようにする。frontend-platformの`design.md`のページのheadの契約を新しい形に合わせて直す
  - 先に、ブラウザテスト(axeの違反0件)で、区画の登録箇所の順の表示と末尾の法的通知へのリンク、1つの区画の取得が失敗してもその区画の位置に見出しと再試行が出て他の区画とリンクが表示され続けること、フラグがオフで未加入ならUltrasの区画が出ないこと、フラグがオフでも加入中なら区画と現在の状態とプラン管理画面への導線が出ること、価格(`MoneyText`)と価格が無いときの案内を確かめる
  - 区画の登録箇所(`PricingSection`は`'<spec名>.<名詞句>'`の`id`・`order`・見出しの`title`・`component`。初版は`ultras-subscription.ultras-pricing`(10、「Ultras」)だけ)と`/pricing`(ログイン不要、`buildSitePageHead`でページのタイトルと説明)を作り、各区画を`RecoverableSlot`(`CLIENT_PROFILE.contactAvailable`)で包む
  - 完了状態: ブラウザテストと`page-head.unit.test.ts`が成功し、adminの既存のブラウザテスト(ダッシュボード・カテゴリマスタ・問い合わせの詳細)が移した後も成功し、ローカルで機能フラグをローカルD1への書き込み(絶対パスの`--persist-to`)でオンにしてから未ログインで`/pricing`を開くと、特典と、価格(1.4の開発者の準備が済んでいれば)または価格を表示できない旨の案内が表示され、ページの`<head>`に説明が出る
  - _Requirements: 1.2, 9.1, 9.2, 9.3, 9.6, 9.7, 9.8_

- [ ] 7.4 プラン管理画面を作り、設定ページのナビゲーションに加える
  - 先に、ブラウザテスト(axeの違反0件)で、4状態と未加入の表示(日時は`<time datetime>`で閲覧者のタイムゾーン)、`past_due`の支払い方法の更新の促し、`canceled`の終了日時と取り消しの案内、未加入でフラグがオンなら加入の導線・オフなら受付停止の文言、Portalのボタンの表示条件と押下での移動、Portalの障害と回数制限の文言、Portalから戻った直後の反映待ちの表示(`role="status"`)と確かめ直し(5秒ごと最大12回、偽のタイマーで進める。完了の判定はせず、12回で止まって開き直しの案内に切り替わり、照会以外の取得を取り直さない)を確かめる
  - 確かめ直しは`viewerUltras`の照会の`refetchInterval`を関数にして回数で止め、「自動更新」の`Switch`を置かない。画面から確定の変更を呼ばない(反映はWebhookだけ、6.8)。先に`docs/GUIDES/tech/frontend/010-live-refresh-queries.md`の「使う場面」の表に「外部サービスでの操作から戻った直後に、遅れて反映される閲覧者自身のデータ」の行(回数を限った一時的な再取得、`Switch`を置かない、上限で開き直しの案内)を、プロジェクト名と固有の値を含めずに加える
  - `/settings/plan`を作り(`settings/route.tsx`のレイアウトが既に`SettingsShell`で包むため、ページの中で包み直さない。headは`buildSitePageHead`で`noIndex: true`、前例`/settings/billing`)、設定ページのナビゲーションに「プラン」(order 60、予約済み)を加え、`settings-nav-order.unit.test.ts`の完全一致の期待に加える。加入の導線は7.2のボタンを使う
  - 完了状態: ブラウザテストが成功し、ローカルでログインして`/settings/plan`を開くとナビゲーションの「プラン」が現在の項目になる
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.1, 6.2, 6.7_

- [ ] 8. 管理画面
- [ ] 8.1 管理者の操作と機能フラグの区画を作る
  - `ultrasPromotionSetting`・`updateUltrasPromotionSetting`の操作を、adminの`src/graphql/operations/ultras/`に1ファイル1操作の`.graphql`で書き(操作名は`AdminUltrasPromotionSetting`・`AdminUpdateUltrasPromotionSetting`、`graphql()`を呼ばない)、adminで`bun run graphql:generate`を実行して型とpersisted operationsを生成する。画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読み、`gql.ts`・`index.ts`を読まない
  - 先に、ブラウザテスト(axeの違反0件)で、現在の値・最後に変更した日時と管理者、最上位管理者以外では参照だけで説明が出ること、確認のダイアログ(理由は任意・監査ログに記録される旨)での確定、切り替えの失敗でダイアログが理由の入力を保ったまま`failureMessageOf`の文言(`version_conflict`での読み直しの案内、それ以外は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`)を`role="alert"`で示すこと、取得の失敗の`ErrorState`に問い合わせのボタンが無く、`GraphQLClientError`でない失敗の文言が`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`で問い合わせを促す文を含まないことを確かめる
  - 完了状態: 型の生成とブラウザテストが成功し、`graphql:allowlist`でapiの許可リストを再生成して`graphql:check`とadminの`codegen.unit.test.ts`(操作名の接頭辞)が成功する(7.1の後に行い、許可リストの再生成が並行しないようにする)
  - _Depends: 5.3, 7.1_
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 8.2 管理画面の設定ページの枠と区画の登録箇所を作り、メニューに加える
  - 先に、ブラウザテスト(axeの違反0件)で、区画の登録箇所の`order`順の表示とページの見出し、1つの区画の取得が失敗してもその区画の位置に`title`の見出しと再試行が出て他の区画が表示され続けることを確かめる
  - `/settings`のページ(`components/pages/admin-settings-page.tsx`)と区画の登録箇所(`AdminSettingsSection`は`'<spec名>.<名詞句>'`の`id`・`order`・見出しの`title`・`component`。初版は8.1の機能フラグの区画`ultras-subscription.promotion-flag`(20、「Ultras導線の機能フラグ」))を作り、各区画を7.3で移した`RecoverableSlot`(`ADMIN_PROFILE.contactAvailable`)で包み、管理画面のメニューに「設定」(order 130、予約済み)を加える。headは`buildAdminPageHead`を使う。メニューの一覧を完全一致で確かめる`apps/admin/src/components/layout/admin-nav-order.unit.test.ts`と`apps/admin/test/admin-shell.browser.test.tsx`の`MENU_ITEMS`の期待に加える(`docs/GUIDES/tech/frontend/009-admin-console-shell.md`がこのテストの更新を求める)
  - 完了状態: ブラウザテストが成功し、ローカルで最上位管理者がフラグを切り替えると監査ログの画面に記録が出る
  - _Depends: 7.3, 8.1_
  - _Requirements: 10.1, 10.9_

- [ ] 9. 文書
- [ ] 9.1 (P) 技術ドキュメントを書く
  - `backend/010-subscription-entitlements.md`(外部の定期課金の状態から特典の継続期間を導く規約、業務日付の日の終わりへの切り上げ、時点・期間・一括の判定、到着順への対応、確定の後の副作用と日次の確認、知らせのハンドラの冪等性)と`external/008-stripe-billing-portal.md`(定期課金の状態の対応と柔軟な請求モードの`cancel_at`、Customer Portalの機能とセッション、再試行の後の扱い、顧客向けメールの停止、test clockによる検証)を、本プロジェクト固有の値を含めずに書き、`backend`・`external`のREADMEの文書一覧に行を加える
  - `docs/onboardings/project-values.md`に、技術ドキュメントのプレースホルダーの本プロジェクトの値(定期課金の価格の`lookup_key`は`ultras_monthly`)と、登録の一覧(「定期実行と非同期メッセージ」のジョブ・メッセージ種別・波及処理、「メール送信」の種別、「利用者側のbot判定と回数制限」の規則`ultras-portal:user`、「管理者のアカウント」の操作種別とメニュー)への本specの行を加える
  - 完了状態: 2つの文書とREADMEが整形の検査を通り、本プロジェクト名とサービス固有の仕様を含まない
  - _Boundary: `docs/GUIDES/tech/backend/010-subscription-entitlements.md`・`external/008-stripe-billing-portal.md`・`backend/README.md`・`external/README.md`・`docs/onboardings/project-values.md`_
  - _Requirements: 4.6, 13.3_

- [ ] 9.2 (P) サービス仕様を本specの決定に合わせて更新し、Ultrasの実装方針を書く
  - 料金とプラン(免除の判定時点Q1、決済後に加入した場合の返金なしQ2、特典の終了時刻Q4、機能フラグの範囲と初期値、停止と退会の扱い、支払いの失敗と解約の受付のメール)、法的通知の大枠(返金ポリシーの停止の行はコミットfccb79cbで「返金しない」に直っているため課金期間の末日の解約と一致することを確かめるだけにし、退会と決済後の加入の行を加え、章8に解約の方法と受付の確認を加える。他の行は変えない)、準拠方針(LR-007の行)、日次タイムライン(4:21の表に`order` 500のジョブ)を更新する
  - `features/005-ultras-subscription.md`(加入状態の導出表(Stripe側の`canceled`は本サービスの加入状態の`ended`側に当たり、同じ文字列で意味が異なることを対応表で示す)・特典の継続期間・加入が有効になった知らせ・機能フラグ・メール・後続specの判定の使い方、sandboxのtest clockによる手動の検証の期待値(終了は`ultras_subscriptions`の`benefit_ends_at`・`stripe_status`・`benefit_end_fixed`で確かめ、再試行の後の終了は`benefit_ends_at`が`ended_at`の値、末日の終了は末日の終わり、どちらも`canceled`・1))を作り、`features`のREADMEに行を加える
  - 完了状態: 文書が整形の検査を通り、返金ポリシーの表で停止・非公開化に伴うトーナメント参加資格と広告の行が変わっていない
  - _Boundary: `docs/GUIDES/service/overview/002-pricing-and-plans.md`・`007-daily-timeline.md`・`legal/004-legal-notice-outline.md`・`legal/001-compliance-policy.md`・`features/005-ultras-subscription.md`・`features/README.md`_
  - _Requirements: 13.4, 13.5_

- [ ] 10. 検証
- [ ] 10.1 E2Eテストで料金ページ・プラン管理画面・管理画面のフラグを確かめる
  - `e2e/client/ultras.e2e.test.ts`: 各テストの直前に、admin-foundationが`e2e/support/local-d1.ts`に用意する補助(`executeLocalD1`。文字列の値は`sqlStringLiteral`でリテラルにする)で機能フラグの行を更新して値を設定し(本specはローカルのD1へ書き込む手順を独自に作らない)、未ログインの料金ページの特典(価格は開発者の準備が済んでいれば価格、無ければ表示できない旨の案内)、フラグがオフで未加入者にUltrasの区画が出ないこと、ログイン後のプラン管理画面とナビゲーションの項目を確かめる。加入の経路はpaymentsのE2E(`e2e/client/checkout.e2e.test.ts`)と同じ条件で動かし、`stripe listen`の転送を前提にしない。加入の開始が`payments_unavailable`(Stripeのキーが無い環境)を返したときだけ`test.skip`で対象外の理由を示して飛ばし、それ以外はテストカードでの加入→決済後のランディング(paymentsの`return_url`の反映で加入が有効になる)→プラン管理画面の`active`→「解約・支払い方法の管理」でPortalのURLへ移るまでを確かめる。決済の画面の操作はpaymentsの`e2e/client/checkout-steps.ts`の手順を使う。加入の経路はローカルD1に`active`な加入を残す(2回目の実行で`ultras_already_subscribed`になる)ため、実行ごとに`e2e/client/auth/account-steps.ts`の`createTestAccount`・`registerAccount`・`verifyEmailFromMail`で新しい確認済みの利用者(メールアドレスのドメインは`.example`)を登録して使う。sandbox上にも定期課金が残る(実行のたびに増える。不要になったらダッシュボードで解約する)旨をテストの説明に書き添える
  - `e2e/admin/ultras-promotion.e2e.test.ts`: admin-foundationが`e2e/support/admin-bootstrap.ts`に用意する補助(招待の発行・招待の完了・指定したロールの管理者としてのログインをまとめたもの)で最上位管理者としてログインし(本specは管理者のログインの手順を独自に作らない)、その管理者がフラグを切り替え、監査ログの画面に記録が出ることを確かめ、終了時に元の値へ戻す
  - 2つのファイルは同じフラグの行を書き換えるため、直列の組で実行する。先に`playwright-config.unit.test.ts`へ、組を渡さないときに今のプロジェクトの並びと中身のままであること(既存のテストは変えない)、組の手順のファイルが対象のテストのプロジェクトから外れること(`testIgnore`)、手順ごとの`<組の名前>-<順>-<対象>`のプロジェクトが対象の`testDir`・`baseURL`を持ち、対象の到達確認と1つ前の手順に依存すること、有効でない対象の手順を作らず依存を次の手順へ繋ぐことのテストを足す。続けて、`e2e/support/playwright-config.ts`(dev-toolingの所有)の`createPlaywrightConfig`に省略可能な4つ目の引数`serialGroups: readonly E2ESerialGroup[]`(既定は空。`E2ESerialGroup`は`{ name; steps: readonly { target; testMatch }[] }`)を加え、Ultrasの組(clientの`ultras.e2e.test.ts`の後にadminの`ultras-promotion.e2e.test.ts`)はルートの`playwright.config.ts`から渡す。共有の補助に固有のパスを置かない。ワーカーの数は変えず、他のspecのE2Eの並行実行に影響させない
  - テスト方針の文書(`docs/GUIDES/tech/testing/001-test-strategy.md`のE2Eの節)へ、「共有の行を書き換えるE2Eは直列の組で依存を繋ぐ」旨と、`--project <対象名>`では組のファイルが外れ、組は`--project '<組の名前>-*'`で実行する旨を、プロジェクト名と固有の値を含めずに加える
  - dev-toolingは実装済みのため、dev-toolingの`design.md`のE2EConfigの契約(Service Interfaceの`createPlaywrightConfig`の宣言と組み立ての説明)を`serialGroups`を加えた形に合わせて直す
  - 完了状態: ローカルでE2Eテストが成功し(Stripeのキーが無い環境では加入の経路が対象外の表示で飛ばされてよい)、`playwright-config.unit.test.ts`が既存のテストを変えずに成功し、Playwrightの一覧の表示でUltrasの組のadminのプロジェクトがclientのプロジェクトに依存し、`--project client`の一覧に組のファイルが含まれず、dev-toolingの`design.md`のE2EConfigの契約が実装と一致している
  - _Boundary: `e2e/client/ultras.e2e.test.ts`・`e2e/admin/ultras-promotion.e2e.test.ts`、dev-toolingの`playwright.config.ts`・`e2e/support/playwright-config.ts`・`playwright-config.unit.test.ts`・`docs/GUIDES/tech/testing/001-test-strategy.md`・`.kiro/specs/dev-tooling/design.md`_
  - _Depends: 1.4, 7.4, 8.2_
  - _Requirements: 1.1, 1.7, 5.2, 5.8, 6.2, 9.1, 9.4, 9.6, 10.2_

- [ ] 10.2 sandboxで定期課金の遷移を手動で検証し、結果を記録する
  - 1.4の手順に沿って、2人の検証用の利用者を用意し、それぞれにtest clock付きのCustomerをdev用のsandboxで作り、ローカルの`payment_customers`の行(paymentsの決定で主キーは`id`のULIDになり、`user_id`・`stripe_customer_id`は一意、`created_at`・`updated_at`が要る)で結び付けてから加入する(同じ利用者で2つ目の加入を始めると`ultras_resume_in_portal`や加入の有効化の重なりの検査で拒否されるため)
  - 1人目: 成功するテストカードで加入→Customer Portalで支払い方法を請求に失敗するテストカード(`4000 0000 0000 0341`)に差し替える→test clockを次の更新日の後へ進めて支払いの失敗→再試行の後の終了。2人目: 加入→Portalでの解約の予約(解約の予定時刻が設定されること)→取り消し→再度の予約→課金期間の末日の終了。各時点のプラン管理画面の状態・支払いの失敗と解約の受付のメールのMailpitへの到着を確かめる(本サービス固有の期待値は本タスクと`features/005`が持つ)
  - test clockではStripeから届く`ended_at`・課金期間の終了が実時刻より未来のため、再試行が尽きた後の終了と末日の終了は、どちらもプラン管理画面では`canceled`に見えるのが正しい。終了はローカルD1の値で確かめる: 1人目は`benefit_ends_at`が`ended_at`の値、2人目は`benefit_ends_at`が末日の終わり、どちらも`stripe_status`が`canceled`・`benefit_end_fixed`が1
  - 開発者の準備(1.4)が終わっていなければ保留して報告する
  - 完了状態: 検証の結果(日時・状態・メールの有無)が作業の報告に記録され、食い違いがあれば不具合として報告されている
  - _Depends: 1.4, 10.1_
  - _Requirements: 2.4, 2.5, 2.6, 2.8, 6.3, 8.1, 8.3, 12.2_

- [ ] 10.3 全体の検査とカバレッジを確かめる
  - 整形の検査・静的解析・型検査と、単体テスト・Workers統合テスト・ブラウザテストを一括で実行し、本specが追加・変更したファイルのカバレッジが80%以上であることを確かめる。ログとSentryへの送信に利用者のメールアドレス・ニックネームが含まれないことを検索で確かめる
  - 完了状態: すべての検査とテストが成功し、カバレッジの結果が閾値を満たす
  - _Requirements: 12.3, 13.1, 13.2_

## Implementation Notes

- 1.2: 機能フラグの初期行の固定IDは`01M6Q2FD000000000000000001`(`created_at`・`updated_at`は`1793923200000`)。Workers統合テストで初期行を入れ直すときはこの値を使う。`stripe_status`・`cancellation_source`・`pending_cancellation_source`・`kind`・`status`の列はpaymentsの前例に合わせて`{ enum }`+CHECK制約を持つ(Stripeの8状態の閉じた集合)。
- 1.3: 画面の文言の正は`docs/GUIDES/service/design/003-text-and-copy-rules.md`の「Ultrasの画面の文言」「Ultrasの最終確認画面の表示事項」「定期課金のメールの本文」の節。機能フラグの区画の説明文は「。」付きの文(ブラウザテストの期待値もこの文)。003の「設定のナビゲーション」「管理画面のメニュー」の登録済みの項目は7.4・8.2で「プラン」「設定」を加える。Customer Portalの縮退の理由の文は7.xで`common-lib/ultras`の定数にする。
- 1.4: 開発者が行うStripeの準備(dev用sandboxの価格`ultras_monthly`の作成、Customer Portalの設定、再試行の後の解約、顧客向けメールの停止、制限付きキーの権限。stagingはmainへのマージ前)は未完了で保留。10.1の加入の経路は`payments_unavailable`なら対象外、10.2は保留になり得る。
- 2.1: `core/ultras`の文字列ユニオン(`UltrasNoticeKind`・`UltrasNoticeStatus`・`CancellationSource`)は`apps/db/schema/ultras`の`*_VALUES`と手で同期している(coreはdbを読めない)。3.x のWorkers統合テストで同値の検査を1本足す。ルート`CLAUDE.md`のディレクトリ構成に`ultras`の記述を加える作業はどのタスクの境界にも無いため、9.1で扱う。
- 2.2: `applySubscriptionChange`は設計の`next`・`notices`に加えて`anomalies`(`unexpected_status`(`unpaid`・`paused`)・`scheduled_end_missing`)を返す。4.4のsinkはこれを`warn`ログとSentryの`captureEvent`(設計のMonitoring節)の両方に写す。未有効の空の値は`EMPTY_SUBSCRIPTION_SNAPSHOT`、終了の状態の判定は`isEndedStripeStatus`(3.1の`findCancellable`はSQLで同じ集合を使う)。有効化の前に見た予約・`past_due`は`canceledAt`・`pastDueSince`と依頼を持たないまま有効化される(9.xの文書に明記)。終了の変化で初めて予約を見た場合は解約の操作を記録するが確認メールは送らない。
- 2.3: `ULTRAS_ACTIVATION_RETRY_POLICY`は`core/ultras/activation-message.ts`にある(6.1はここから読み込む)。`project-values.md`のメッセージ種別の表に`ultras.run-activation-handlers`の行を9.1で加える。
- 2.4: メールの種別の入力は設計の`acceptedAtUtc`・`benefitEndsAtUtc`ではなく、paymentsの前例に合わせてISO 8601の瞬時`acceptedAt`・`benefitEndsAt`(`z.iso.datetime()`、`benefitEndsAt`は必須)にし、テンプレートが`formatUtcDateTime`で表記する。4.1の`UltrasNotifier`はこの名前と形で渡し、依頼の`benefitEndsAt`がnull(`scheduled_end_missing`)なら`skipped`にしてwarnを残す。`project-values.md`の「メール種別」の行にUltrasの2種を9.1で加える。
- 3.1: ultrasのWorkers統合テストのフィクスチャは`workers/ultras/testing/ultras-store-fixtures.ts`(`clearUltrasTables`・`subscriptionIdOf`・`stripeSubscriptionIdOf`・`newSubscriptionRow`・`activatedSubscriptionRow`・`insertSubscriptionRow(s)`・`readSubscriptionRow`と、identity/paymentsの`db`・`insertUser(s)`・`userIdOf`・`T0`・`after`・`purchaseIdOf`の再公開)。共有のWorkers統合テストはapiからだけ実行する(eventの設定は`lib/**`を除外)。終了の状態の集合は`core/ultras/subscription-transition.ts`の`ENDED_STRIPE_STATUSES`。
- 3.2: `markCompleted`は`completed_at IS NULL`のときだけ書き(最初の完了時刻を保つ)、`markSkipped`・`markRequested`は`pending`のときだけ進める。上限付きの削除は`DELETE ... WHERE id IN (SELECT id ... LIMIT ?)`の1文で消した件数を返す(件数==limitなら残りがあり得る、5.4のジョブが最大20回繰り返す)。閾値は`<=`。フィクスチャに`ULTRAS_PROMOTION_SEED_ROW`・`restoreUltrasSettingsSeed`・`newActivationRow`・`newNoticeRow`・`insertActivationRow(s)`・`insertNoticeRow(s)`・`readActivationRow/Ids`・`readNoticeRow/Ids`・`activationIdOf`・`noticeIdOf`がある。
- 3.3: 判定の実装は`StoredUltrasEntitlements`・`StoredUltrasPlanExport`(`workers/ultras`、`ULTRAS_TYPES.SubscriptionStore`だけを注入)。`entitledUsersDuring`・`wasEntitledDuring`は`from > to`で`RangeError`。エクスポートの日時は`Date`(paymentsの前例のISO文字列とは異なる。data-exportが直列化する)。
- 4.1: 実装は`QueueActivationDispatcher`・`EmailUltrasNotifier`(`workers/ultras`、paymentsの`EmailPurchaseNotifier`と同じ依存オブジェクト方式のプレーンなクラス。4.5で`toDynamicValue`により束縛し、`MessagePublisher`は`PLATFORM_TYPES.MessagePublisher`、連絡先は`IDENTITY_PLATFORM_TYPES.UserContactDirectory`、`CLIENT_SITE_ORIGIN`は`PLATFORM_TYPES.Env`から解決)。4.4は`payload`を`ultras-notifier.ts`の`noticePayloadOf({ acceptedAt, benefitEndsAt })`(ISO 8601の瞬時)で作る。`UltrasNotifier.send`は送信失敗で例外を投げるため5.4は1件ずつcatchする。`ActivationDispatcher.dispatch`は失敗をwarnに留めて投げないためガード不要。
- 4.2: 最終確認画面の追加事項の4文と毎月の請求額の表記(`$9.99(税込)`、`en-US`固定)は`common-lib/ultras/checkout-notes.ts`(`ultrasCheckoutNotesOf(amount)`など)。7.xの料金ページも同じ関数を使う。拒否の3文言は`workers/ultras/ultras-offer-policy.ts`の`ULTRAS_OFFER_REJECTION_MESSAGES`。`UltrasOfferPolicy`も依存オブジェクト方式(`{ appName, flags, entitlements, prices }`)。ログの属性名に`key`を含めると伏せ字になるため`priceLookup`を使う。
- 4.3: `UltrasFulfillment`も依存オブジェクト方式(`{ appName, subscriptions, subscriptionStatements, activations, activationStatements, dispatcher, ids }`。4.5では同じ`D1SubscriptionStore`/`D1ActivationStore`のインスタンスをストアと文の契約の両方に渡す)。`afterCommit`は完了済みの知らせを送り出さない。Sentryの`captureEvent`(指紋`["ultras", "fulfillment-missing-subscription"]`、タグ`ultras_incident`・`purchase_id`)を`docs/GUIDES/tech/infra/004-logging-and-error-tracking.md`の`captureEvent`の一覧に9.1で加える(4.4の`unexpected_status`の通知も同様)。
- 4.4: `PlanStateSink`(`workers/ultras/plan-state-sink.ts`、依存オブジェクト`{ appName, subscriptions, subscriptionStatements, noticeStatements, notifier, ids }`)。登録名は`ULTRAS_PLAN_STATE_SINK_NAME`。異常はwarnとSentryの`captureEvent`(指紋`["ultras", "unexpected-subscription-status"]`・`["ultras", "scheduled-end-missing"]`、タグ`ultras_incident`・`stripe_subscription_id`・`stripe_status`)。
- 4.5: 共有の束縛は`workers/ultras/ultras-platform-module.ts`の`createUltrasPlatformModule(appName)`(モジュール名`ultras-platform`)。api・eventの`composition/ultras-module.ts`は今は`API_ULTRAS_PLATFORM_MODULE`・`EVENT_ULTRAS_PLATFORM_MODULE`だけを公開し、5.x・6.xが同じファイルにアプリ側のモジュール(`API_ULTRAS_MODULE`・`EVENT_ULTRAS_MODULE`)を足して`modules.ts`へ加える。ultrasとpaymentsの両方の表を使うWorkers統合テストでは、`clearUltrasTables`と`clearPaymentTables`がどちらも利用者を消すため、ultrasの3表を直接消してから`clearPaymentTables`を呼ぶ(前例`ultras-platform-module.worker.test.ts`)。`project-values.md`の「購入種別の登録」の行を9.1で更新する。
- 5.1: apiのUltrasは`application/ultras/`(`API_ULTRAS_TYPES`は`ultras-types.ts`、`ULTRAS_ERRORS`・`ultrasError()`は`ultras-errors.ts`、`DefaultUltrasPlanReader`・`DefaultUltrasCheckout`)、スキーマモジュールは`presentation/graphql/modules/ultras/`、束縛は`composition/ultras-module.ts`の`API_ULTRAS_MODULE`(名前`ultras`)。GraphQLのテストの補助は`test/support/ultras-graphql-operations.ts`(`installUltrasGraphQLTest`)。`UltrasPlanReader.offer()`は価格の照会の結果に`ultras_monthly`が無いときもwarnして`price: null`を返す(9.1の文書に明記)。停止中の利用者が`viewerUltras`で自分の加入状態を見られるWorkers統合テストを5.2で加える。
