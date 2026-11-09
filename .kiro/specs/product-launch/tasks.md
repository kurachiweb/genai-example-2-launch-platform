# Implementation Plan

- [ ] 1. 基盤: 共有の規則・テーブル・文言・カレンダー
- [x] 1.1 プロダクトの入力規則・定数・監査の操作種別を共有定義として作る
  - 前提: dev-tooling〜user-profile-socialの15specの全タスクが完了していること(2026-11-09のギャップ分析で、help-centerを除く上流の実装の完了と契約の一致を確かめた。`users`の列とライフサイクルの登録口・`AccountGuard`・ハンドル基盤(user-profile-socialの仮2(B)の改訂を含む: 他の対象の旧ハンドルを使用中としない判定と、元の保持者の旧ハンドルを消す文`previousHandleRelease`)・外部URLの規則・公開プロフィールのタブの登録口・画像のアップロードと隔離理由・マークダウンの部品・`UltrasEntitlements`・`UltrasPromotionGate`・監査ログと`CategoryMasterEditor`・`CATEGORY_SECTIONS`・E2Eの`e2e/support/mailpit.ts`・`e2e/support/admin-bootstrap.ts`)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、名称50・タグライン100書記素の境界と空・禁止文字、ハンドル50・51文字と予約語の14語、カテゴリのハンドルに予約語が無いこと、スクリーンショットの20・21枚と10,485,760・10,485,761バイト、ロゴ512,000バイト・スクリーンショット5,242,880バイト、ローンチ日の上限90日(仮4)、標準カテゴリの固定のID・名前・ハンドル`other`、3つの監査の操作種別(対象`category`・理由は任意・詳細なし・必須の`label`)の単体テストを書く。名称・タグラインは、判定の順(禁止文字→必須→上限。空白だけで上限を超える入力は必須の違反)と、違反の種類から文言への対応(`PRODUCT_NAME_MESSAGES`・`PRODUCT_TAGLINE_MESSAGES`、上限の数は定数から組み立てる)の全ての戻り値を確かめる(coding/005)
  - 4アプリが読み込める共有ディレクトリに置き、zodを使わず、書記素・禁止文字・ハンドルの形式・カテゴリ名の判定は上流の部品を使う。監査の操作種別は`PRODUCT_LAUNCH_AUDIT_ACTIONS`として操作種別の連結へ加え、種別の並びを完全一致で確かめる`audit-actions/index.unit.test.ts`の期待値を更新する
  - 完了状態: 単体テストが成功し、client・admin・api・eventの型検査で配置先から読み込め、監査の操作種別の一覧の重複の検査と`audit-actions/index.unit.test.ts`が成功する
  - _Requirements: 1.1, 1.2, 2.1, 3.1, 3.2, 4.3, 11.1, 11.8_

- [x] 1.2 7テーブルと可視性の条件を定義し、マイグレーションを作る
  - 先に、テーブルの定義の単体テストで、ハンドル・カテゴリの名前とハンドル・旧ハンドルの列が大文字小文字を区別しない照合規則で定義されていること、部分一意索引・CHECK・外部キー(`ON DELETE`の指定なし、画像のIDに外部キーが無いこと)の定義を確かめる。ローカルD1のWorkers統合テストで、大文字小文字だけが違うハンドル・カテゴリ名を作れないこと、未確定かつ取消でないローンチを同じプロダクトに2つ作れないこと、`purge_due`を同じプロダクトに2つ作れないこと、スクリーンショットの位置20を拒否すること、可視の条件・勝利のローンチの条件・カテゴリの条件の結果(カテゴリの条件と可視・勝利の条件を組み合わせた絞り込みとカテゴリごとの件数)を確かめる
  - 可視のプロダクトの条件(論理削除・非公開化・投稿者の退会と停止を除く)と勝利のローンチがある条件と、カテゴリの条件(仮11、directory-discoveryの依頼)を、他specが問い合わせに組み込める部品として作る。スキーマの集約点へ加え、mainの最新を取り込んでからマイグレーションを生成する。旧ハンドルのテーブルは`previousHandleColumns({ ownerColumnName: 'product_id', references: () => products.id })`で定義する(`deleted_at`は部品が含む)
  - 標準カテゴリ「その他」の初期データは、作成のマイグレーションに書き足さず、続けて`drizzle-kit generate --custom --name=product_launch_seed`で作る別のカスタムマイグレーションに書く(db/003の「初期データ」)。全列を明示し、`id`は`01JD0000000000000000000000`、`created_at`・`updated_at`はその時刻部の`1731945562112`、`ON CONFLICT (name) DO NOTHING`とする(`20261105014904_inquiry_chat_seed`と同じ形)。Workers統合テストは初期データの行がある前提で書き、同じ名前・ハンドルの行を追加しない
  - 完了状態: 単体テストとWorkers統合テストが成功し、2つのマイグレーション(`<日時>_product_launch`・`<日時>_product_launch_seed`)をローカルに順に適用でき、「その他」が1行ある
  - _Requirements: 2.2, 5.10, 11.1, 14.1, 14.10_

- [ ] 1.3 (P) ページ配置・文言規則・再ローンチ規則に、本specの画面と文言を先に書く
  - ページ配置: 「自分のプロダクト(`/my/products`)」の節(項目の並び・状態の文言・区画の登録・0件と停止中)、「プロダクト登録・編集」への追記(区画の並び・カレンダーの理由の示し方・非公開化中の編集(仮7)・固定の期間の無効化・削除の確認と注意書きの登録・旧ハンドルの扱い(論理削除したプロダクトの現在のハンドルは物理削除まで使えず旧ハンドルの転送は止まること、旧ハンドルは他のプロダクトが設定でき設定された時点で元の転送が終わること、仮5))、ローンチ履歴で取消のローンチを出さないこと、カテゴリのページの先頭のプロダクトカテゴリの区画を記載する
  - 文言規則: 設計のError Handlingの表の文言、状態・トースト・カレンダーの理由・ローンチ履歴の要約の文言、スクリーンショットの枚数(仮6)を加える。再ローンチ規則: 仮1(トーナメントの結果の確定後は敗北後の間隔を掛けない)・仮4(今日から90日後まで)・仮7(非公開化中は予約できない)の注記を、2026-10-24に開発者が確定した決定として加える
  - 完了状態: 3つの文書が整形の検査を通り、9〜11のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md`・`docs/GUIDES/service/overview/006-relaunch-rules.md`_
  - _Requirements: 15.5_

- [ ] 1.4 (P) カレンダーの部品をfrontend-libに加える
  - `react-day-picker`は仮10として2026-10-24に開発者が承認して確定している。実装時点の9系の最新の安定版(プレリリースを除く)を`bun pm view react-day-picker versions`で調べ、依存パッケージの版管理の文書の「版を明示した追加手順」のコマンドで、`apps/frontend-lib/package.json`・`apps/client/package.json`・`apps/admin/package.json`へ同じ版を`--exact`で実行時の依存として(`--dev`を付けずに)追加する。依存パッケージの版管理の文書の主要パッケージの一覧の対象(版が食い違うと基底設定・プリセットが動かない、または組み合わせられる版の範囲が狭いもの)ではないため一覧には載せず、同文書の「一覧に無いパッケージでも、共有ディレクトリのコードが実行時に使うものは、利用側アプリが共有ディレクトリ側と同じ版で宣言する」と共有ディレクトリの文書の規則に従う。tech-stack.mdの行は追加済みのため変更しない
  - 先に、ブラウザテスト(axeの違反0件)で、月の切り替え、矢印キーでの日の移動、無効の日の扱い(フォーカスでき選べない、ポインターを重ねると理由のツールチップが開く)、選択の通知を確かめる。Storybookに載せる
  - 部品は`apps/frontend-lib/components/ui/calendar/calendar.tsx`に置く(frontend/005の`ui/<部品>/<部分>.tsx`)。日のボタンには`buttonVariants`の`aria-disabled:pointer-events-none`を付けない(付けると選べない日の理由のツールチップが開かない、frontend/004)。`react-day-picker`を3つのアプリの`vitest.browser.config.ts`の`optimizeDeps.include`へ加え、frontend/005の部品の一覧に`Calendar`を足す
  - 完了状態: ブラウザテストとStorybookのビルドが成功し、clientとadminから読み込め、3つの`package.json`の`react-day-picker`が`^`・`~`の無い同じ版で、`git grep`で確かめた各`bun.lock`の`react-day-picker@`の版もそれと同じである
  - _Boundary: Calendar、`apps/frontend-lib/package.json`・`apps/client/package.json`・`apps/admin/package.json`と各`bun.lock`、3つの`vitest.browser.config.ts`、`docs/GUIDES/tech/frontend/005-shared-components.md`の部品の一覧_
  - _Requirements: 4.8_

- [ ] 2. 契約と共有部品
- [ ] 2.1 ローンチの状態とプロダクトライフサイクルの契約を作る
  - 先に、単体テストで、状態の導出(取消→結果→ローンチ日の0:00→前日23:45の順、前日23:44と23:45・0:00の前後)、固定の閾値の日(23:44は今日・23:45は明日)、キックオフの日時、処理の登録の検証(名前の形式・重複・同じ種類での`order`の重複の例外と`order`昇順の並び)、再試行の方針の値、メッセージ種別の本文の検証(ULID)、予選の結果からの要約の規則(予定・ペアリング済みはキックオフ予定、マッチ中は予選マッチ中で`inMatch`、勝利はディレクトリ掲載、敗北は予選敗北、取消)と受賞のまとめ(Yearが先頭・数・ラベルの順)を確かめる
  - 要約と受賞のまとめの規則は、ローンチ履歴とdirectory-discoveryが同じ文言で使える純粋な関数として置く
  - 業務時刻の計算はbackend-platformの部品、結果の型と名前の検証はidentity-authの部品を再利用し、メッセージの契約を契約の一覧へ加える
  - 同じく先に、識別子`PRODUCT_PLATFORM_TYPES`が`Symbol.for('product.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - api・eventのapplication層は`**/lib/workers/**`を型も含めて読み込めないため、application層と後続specが受け取る照会と記録の契約(`ProductDirectory`・`ProductCategoryDirectory`・`ScheduledLaunchDirectory`・`LaunchOutcomeRecorder`・`ProductExport`・`LaunchExport`・`ProductLifecycleStore`・`AdminProductDirectory`とその入出力の型)を`apps/backend-lib/core/product/ports.ts`に、識別子`PRODUCT_PLATFORM_TYPES`を`core/product/identifiers.ts`に作る。2.2〜2.6はD1の実装と束縛だけを`workers/product`に作る
  - 完了状態: 単体テストとメッセージ種別の重複の検査が成功し、`core/product`がD1・`apps/db`・`workers`を読み込まない
  - _Requirements: 5.2, 6.1, 12.1, 12.4, 12.10, 14.11_

- [ ] 2.2 ハンドルの対象と、プロダクト・カテゴリの照会を作る
  - 先に、ローカルD1のWorkers統合テストで、プロダクトのハンドルの大文字小文字を区別しない解決(現在・旧)、論理削除したプロダクトが解決されず現在のハンドルは使用中に数えられること、他のプロダクトの旧ハンドル(論理削除したプロダクトのものを含む)は使用中に数えられないこと(仮5)、表示用の照会の可視・掲載済み・非公開化・停止中の投稿者の範囲と論理削除済みの除外、90件を超えるIDの一括の照会、説明文とスクリーンショットの順、ローンチの一覧の状態と番号(取消を除いて数える)、カテゴリの並び(追加の順・「その他」を末尾)とハンドルからの大文字小文字を区別しない解決を確かめる
  - プロダクトとカテゴリのハンドルの対象の記述(`workers/product/product-handle-namespaces.ts`)と、2.1の`core/product`の契約に対する表示用・カテゴリの照会のD1の実装(`d1-product-directory.ts`・`d1-product-category-directory.ts`)を作る(識別子は2.1で作成済み、束縛は2.5が行う)
  - 完了状態: Workers統合テストが成功し、後続specがプロダクトのテーブルを読まずに表示用の情報とハンドルの解決を得られる
  - _Requirements: 2.3, 2.8, 2.9, 8.7, 11.9, 11.12, 14.4_

- [ ] 2.3 予定のローンチ・予選の結果の記録・エクスポートの照会を作る
  - 先に、Workers統合テストで、指定した日の予定のローンチが取消・結果の確定・非公開化・論理削除・停止中の投稿者を除いてIDの順に上限件数ずつ返り続きを示すこと、結果の記録が`recorded`・`already-recorded`・`conflict`・`not-recordable`(取消・論理削除・不在)を返し確定した結果を書き換えないこと、プロダクトの出力が論理削除済み・非公開化を含めて項目(カテゴリ名・画像のID・削除の日時・非公開化)を返すこと、ローンチの出力の状態を確かめる
  - 2.1の`core/product`の契約に対するD1の実装を`workers/product/d1-launch-schedule.ts`・`d1-product-export.ts`に作る
  - 完了状態: Workers統合テストが成功し、データエクスポートの文書の`products.json`・`launches.json`のローンチの項目に対応する
  - _Requirements: 8.7, 14.2, 14.3, 14.6_

- [ ] 2.4 (P) ライフサイクルの記録のストアを作る
  - 先に、Workers統合テストで、イベントの読み取り・同じプロダクトの最も古い`pending`・完了した処理の記録(重複の無視)・イベントの完了、滞ったイベントの一覧と送り直しの回数、`purge_due`の作成を2回行っても1件であること、物理削除の候補(業務日付の境界)と期限超過の件数、利用者のプロダクトのIDの一覧と`purge_due`の作成の日時を確かめる
  - 2.1の`core/product`の`ProductLifecycleStore`の契約に対するD1の実装`createProductLifecycleStore`を`workers/product/d1-product-lifecycle-store.ts`に作る
  - 完了状態: Workers統合テストが成功する
  - _Boundary: ProductLifecycleStore_
  - _Depends: 2.2_
  - _Requirements: 12.4, 12.5_

- [ ] 2.5 プロダクトの共有の束縛を作り、apiとeventに組み込む
  - 2.2〜2.4の照会と記録のD1の実装を`core/product`の識別子に処理単位で束縛するモジュール(`workers/product/product-platform-module.ts`)を作り、apiとeventの束縛の一覧へ同時に加える
  - 完了状態: 3経路(api・eventの`fetch`・eventの`queue`)のDIの解決の検査が成功し、両アプリで照会を解決できる
  - _Requirements: 14.7_

- [ ] 2.6 管理画面のプロダクトの検索の照会を作り、共有の束縛に加える(仮13)
  - 先に、ローカルD1のWorkers統合テストで、論理削除済みを除いて作成日時とIDの降順に並ぶこと、名称・ハンドルの部分一致と`%`・`_`・`\`が文字として照合されること、投稿者・カテゴリの絞り込み、最新のローンチの状態の5値(取消・勝利・敗北・明日以降の未確定・今日と過去の未確定)と状態による絞り込みが同じ結果になること、同じ日の複数のローンチでIDの降順の先頭を採ること、ローンチの無いプロダクトで最新のローンチが空になること、公開の状態の3値(非公開化を投稿者の停止より優先)とその絞り込み、件数の上限の境界とカーソルによる続き・不正なカーソルの拒否、時点の登録数が時点以後の登録を数えず時点以後の論理削除を数えること、apiとeventのコンテナから`PRODUCT_PLATFORM_TYPES.AdminProductDirectory`を解決できることを確かめる
  - 2.1で`apps/backend-lib/core/product/ports.ts`に作った設計の契約(`AdminProductLaunchState`・`AdminProductVisibility`・`AdminProductRecord`・`AdminProductSearchFilter`・`AdminProductDirectory`)と識別子`PRODUCT_PLATFORM_TYPES.AdminProductDirectory`に対し、D1の実装`D1AdminProductDirectory`を`apps/backend-lib/workers/product/d1-admin-product-directory.ts`に作り、2.5の共有の束縛に実装を加える。後続specに許す結合の範囲の外の読み取りは、この照会の中だけに置く
  - 契約の形はugc-moderationが前提にするため、変える必要が出たら実装を止めて開発者へ報告する
  - 完了状態: Workers統合テストが成功し、両アプリで同じ識別子からプロダクトの検索と登録数の数え上げができる
  - _Depends: 2.1, 2.5_
  - _Boundary: AdminProductDirectory(D1の実装)、ProductPlatformModule_
  - _Requirements: 14.12_

- [ ] 3. APIサーバーの規則と判定
- [ ] 3.1 選べる日・予約の計画・変更の決定の規則を作る
  - 先に、単体テストで、23:39で翌日・23:40で翌々日、今日から90日後と91日後、敗北(2026-09-07)で未加入は09-14・Ultrasは09-09、勝利と基準なしで間隔を掛けないこと(仮1)、日付の検査の理由と最も早い日、直近のローンチの状態ごとの計画(変更・予約の禁止の2つの文言・非公開化・供給元の失敗と該当)、取消の除外、変更の基準が前の終了したローンチであること、固定の判定(予選・供給元・失敗)、ハンドルの変更の種類・ロゴの差し替え・スクリーンショットの追加と削除と順序・同じ日付の変更なし・計画と合わない日付の拒否を確かめる
  - 業務日付の日の足し引きは、上流の`BusinessTime`が公開していないため(形を変えない)、選べる日の規則のファイルに`addBusinessDays`を置き(`fromBusinessDateTime`に日数分のミリ秒を足して`toBusinessDateTime`で戻す)、月末・年末・うるう日をまたぐ値を単体テストで確かめる
  - 完了状態: 単体テストが成功し、規則がデータベースと実時間に依存しない
  - _Requirements: 2.7, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.11, 4.12, 5.1, 5.2, 5.7, 5.8, 5.9, 6.1, 15.2_

- [ ] 3.2 判定の供給元の契約・登録口と、プロダクトの状態の判定を作る
  - 先に、模擬の供給元の単体テストで、3種類の供給元がプロダクトの一覧につき`order`順に1回ずつ呼ばれること、該当した次回の予約の禁止の理由と解除の日時・固定の理由が計画に入ること、供給元の例外がその種類を確認できない状態にしてログに供給元の名前だけを残すこと、敗北が基準のときだけUltrasの判定を1回呼び、判定の失敗を確認できない状態にすること、Ultrasの判定の結果で選べる日が変わることを確かめる
  - 3つの登録口(初版は空)を作り、登録の名前の形式と重複を検証する単体テストを置く。apiのプロダクトのDIの識別子の一覧をこのタスクで作り、以後のapiのタスクは識別子をここへ加える。Ultrasの判定の型と識別子は`core/ultras`から読み込む
  - 完了状態: 単体テストが成功し、後続specが登録口に1行足すだけで条件を加えられ、application層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 3.1_
  - _Requirements: 4.6, 5.3, 5.4, 5.5, 5.6, 6.2, 6.5_

- [ ] 3.3 プロダクトの保存の登録口を作る
  - 先に、偽の処理を使うWorkers統合テストで、登録の名前の形式違反と重複の例外、同時の文が登録の順に連結されること、確定の後の処理が登録の順に呼ばれ、1つの例外が警告のログ(処理の名前とプロダクトのIDだけ)を残して次の処理へ進み呼び出し元へ例外を返さないこと、同時の文を返す処理の例外がそのまま呼び出し元へ伝わることを確かめる
  - 処理の契約(文と接続を扱うためinfrastructure層に置き、application層は読み込まない。`ProductLifecycleSyncHandler`と同じ配置)と登録の型、登録の一覧から処理を組み立てる部品、登録口(初版は空)を作り、組み立てた部品の識別子を3.2のDIの識別子の一覧へ加える(束縛は4.2のモジュールが行い、使うのは4.1のD1の実装だけ)
  - 完了状態: Workers統合テストが成功し、後続specが登録口に1行足すだけで保存に処理を加えられる
  - _Boundary: ProductSaveHooks、`apps/api/src/infrastructure/product/product-save-hooks.ts`・`apps/api/src/composition/product-save-hooks.ts`・`apps/api/src/application/product/product-types.ts`(識別子の追記)_
  - _Requirements: 14.9_

- [ ] 4. APIサーバーのプロダクトの保存
- [ ] 4.1 プロダクトのポートと、読み取り・登録・保存のD1の実装を作る
  - 先に、ローカルD1のWorkers統合テストで、登録がプロダクト・最初のローンチ・スクリーンショットを1つの一括の書き込みで確定し、未確認・停止中の投稿者で取り消されること、同じハンドルの同時の2つの登録の一方だけが成功すること、論理削除したプロダクトの現在のハンドルとの衝突の取り消し、他のプロダクトの旧ハンドル(論理削除したプロダクトのものを含む)を登録・保存で設定すると同じ一括の書き込みで元の保持者の旧ハンドルの行が消え、解決が新しいプロダクトに移ること、他のプロダクトの同じ旧ハンドルを2つのプロダクトが同時に設定すると一方だけが成功し、元の保持者の行が消え、解決は成功した方へ移ること(仮5)、版の競合、時計を23:44から23:45へ進めると前日の予定のローンチのあるプロダクトのカテゴリとローンチ日の変更が取り消されること、非公開化中の次回の予約の取り消し、旧ハンドルの置き換え、スクリーンショットの全件の置き換え、`latest_launch_date`が取消を含む最新の日になること、取り消しの理由を読み直しで分類すること、自分のプロダクトの一覧の並び(最新のローンチ日の新しい順)とカーソル、自分の旧ハンドルの解決、説明文の更新、テスト用に登録した保存の処理の文が登録・保存・説明文の更新の一括の書き込みの末尾に入り、条件の取り消しで一緒に取り消されること、登録した文が実行時に失敗する(制約の違反)と一括の書き込み全体が取り消されどの行も変わらないこと、同時の文を返す処理の例外で何も書き込まず例外が呼び出し元へ伝わること、登録・保存・説明文の更新の確定の後に保存の登録口の確定の後の処理が呼ばれ、その例外が保存の結果を変えず、取り消された保存(条件の取り消し・`hidden`・`not-found`・`account-unavailable`)では呼ばれないこと、説明文の更新が非公開化中のプロダクトで`hidden`を返し説明文・版・登録した処理の文がどれも変わらないこと、非公開化されていない状態を読み取りのメソッドで読んだ後に非公開化の日時を直接書き込んでから説明文を更新しても`hidden`になること(判定と書き込みの間の非公開化、仮12)、非公開化と投稿者の停止が重なると`account-unavailable`になること(分類の優先の順: 不在・論理削除→投稿者の状態→非公開化)を確かめる
  - 保存の条件(版・未削除・投稿者の状態・ハンドル・予選の固定・非公開化)を部品として作り、ポートの全メソッド(読み取り・一覧・旧ハンドルの解決・ハンドルの使用中の判定(ハンドル基盤の部品を呼ぶ)・カテゴリの存在・登録・保存・説明文の更新(未削除・投稿者の状態・非公開化でないことを条件にする))をD1で実装する。登録・保存・説明文の更新は3.3の部品から同時の文を受け取って末尾に加え、確定の後に同じ部品の確定の後の処理を呼ぶ。4.2〜4.4のユースケースはこのポートだけを使い、保存の登録口とデータベースの接続を受け取らない
  - 完了状態: Workers統合テストが成功し、失敗した保存でどの行も変わらず、ポートの型がapplication層にあり`**/lib/workers/**`を読み込まない
  - _Depends: 2.2, 3.1, 3.3_
  - _Requirements: 2.3, 2.4, 2.5, 2.7, 2.11, 3.5, 5.8, 5.10, 6.1, 6.6, 7.3, 7.9, 14.9_

- [ ] 4.2 登録のユースケースを作り、画像の用途とapiのプロダクトのモジュールを登録する
  - 先に、模擬のポートの単体テストで、登録の判定の順序(カテゴリ→予約語→使用中→ローンチ日→画像の紐付けと枚数・合計の上限→保存)、存在しないカテゴリ・選べない日(選べる最も早い日の詳細)・紐付けの失敗・上限の超過で保存しないこと、ストアの結果(`handle-unavailable`・`account-unavailable`)をエラーコードへ変えることを確かめる(保存の登録口の確定の後の処理は4.1のストアが呼ぶため、ユースケースの単体テストでは扱わない)。コードと文言の対応`PRODUCT_ERRORS`・`productError`(`application/product/product-errors.ts`、user-profile-socialの`profile-errors.ts`と同じ形。`AppError`は`message`が必須)の全てのコードの`kind`と文言が文言規則と一致することも確かめ、ユースケースは`AppError`を直接組み立てない
  - media-pipelineの用途の登録箇所に`product-logo`(512,000バイト)・`product-screenshot`(5,242,880バイト)を加え、用途の並びを完全一致で確かめる`apps/api/test/config/media-registrations.unit.test.ts`の期待値を更新する。apiのプロダクトのモジュールを作って3.2の判定・3.3の保存の登録口の部品(`PRODUCT_SAVE_HOOKS`から組み立て、4.1のストアにだけ渡す)・4.1のストア・登録のユースケースを束縛し、束縛の一覧へ加える。画像の部品の型は`core/media`から読み込む
  - 完了状態: 単体テスト・DIの解決の検査が成功し、`product-logo`の用途で512,001バイトの画像が413になり、application層に`**/lib/workers/**`の読み込みが無い(静的解析が成功する)
  - _Depends: 3.2, 4.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.7, 14.9_

- [ ] 4.3 編集と説明文の更新のユースケースを作る
  - 先に、模擬のポートの単体テストで、編集の判定の順序(版→状態の判定→計画→固定(カテゴリかローンチを変えるときだけ)→ローンチ日→ハンドル→画像→保存→以前の画像の削除)、固定の期間でも名称などの保存が通ること、予約の禁止・確認できない状態のコード、自分の旧ハンドルへの戻し、差し替えたロゴの即時の削除と取り除いたスクリーンショットの14日後の削除の依頼(失敗はファイルのIDだけをログ)、説明文の更新が同じ検証の規則を使いbot対策を含まないこと、ストアの結果が`hidden`なら`productError('product_hidden')`(`kind: 'conflict'`、文言「このプロダクトは公開が停止されているため、説明文を更新できません。」)を、`not-found`なら`product_not_found`、`account-unavailable`なら`account_unavailable`を投げること(仮12、public-apiの依頼)を確かめる(保存の登録口の確定の後の処理は4.1のストアが呼び、4.1のWorkers統合テストで確かめる)
  - 2つのユースケースの識別子と束縛をapiのプロダクトのモジュールへ加える
  - 完了状態: 単体テストとDIの解決の検査が成功する
  - _Requirements: 2.3, 3.3, 3.4, 3.6, 3.7, 4.7, 5.1, 6.4, 7.2, 7.8, 7.9, 14.9_

- [ ] 4.4 自分のプロダクトの照会とハンドルの使用可否のユースケースを作る
  - 先に、模擬のポートの単体テストで、一覧が論理削除していない自分のプロダクトを最新のローンチ日の新しい順に20件ずつカーソルで返し1ページにつき状態の判定を1回だけ呼ぶこと、1件の照会の他人・論理削除・不在の`not-found`と自分の旧ハンドルの転送、登録画面の選べる日、所有者の状態が本人以外にnullを返すこと、使用可否が編集中のプロダクトの現在・旧ハンドルと他のプロダクトの旧ハンドルを使えるとし、形式違反・予約語・使用中(他のプロダクトの現在のハンドル)を区別することを確かめる
  - 2つのユースケースの識別子と束縛をapiのプロダクトのモジュールへ加える
  - 完了状態: 単体テストとDIの解決の検査が成功し、ユースケースが利用者をセッションではなく引数の利用者で受け取る
  - _Requirements: 2.6, 2.11, 7.1, 7.4, 7.5, 9.1, 9.2, 14.5_

- [ ] 5. APIサーバーのライフサイクル
- [ ] 5.1 同期の処理の契約とライフサイクルの確定を作る
  - 先に、ローカルD1のWorkers統合テストで、削除の確定が版・未削除・投稿者の状態・予選の固定を条件にイベントを挿入し、旧ハンドルの転送を止め、現在のハンドルを使用中のまま残すこと、非公開化で未開始(明日以降)のローンチだけが取消になり今日のローンチが残ること、復元で取消が戻らないこと、既に同じ状態なら`unchanged`でイベントを作らないこと、テスト用に登録した同期の処理の文が同じ一括の書き込みに入りその失敗で全体が取り消されることを確かめる
  - 同期の処理の契約(文と接続を扱うためinfrastructure層)と登録口(初版は空)を作り、確定のポート`ProductLifecycleCommitter`をapplication層の`ports.ts`に、D1の実装をinfrastructure層に置いて、識別子と束縛をapiのプロダクトのモジュールへ加える
  - 完了状態: Workers統合テストとDIの解決の検査が成功し、後続specが登録口に1行足すだけで同期の処理を加えられる
  - _Depends: 2.1, 4.4_
  - _Requirements: 2.9, 12.2, 12.3, 12.7, 12.9_

- [ ] 5.2 削除と非公開化・復元の操作口のユースケースを作る
  - 先に、模擬のポートの単体テストで、削除の判定の順序(本人のプロダクト→版→固定(予選・供給元)→確定→送信)、固定と確認できない状態での拒否、送信の失敗を成功として扱いログを残すこと、非公開化・復元の`changed`・`unchanged`と論理削除済み・不在の`not_found`、確定の後の送信を確かめる
  - application層は`**/lib/workers/**`を型も含めて読み込めないため、メッセージの送信は自前のポート`ProductMessagePublisher`(application層の`ports.ts`)の形で`PLATFORM_TYPES.MessagePublisher`から受け取る(media-pipelineの`MediaJobMessagePublisher`・identity-authの`IdentityMessagePublisher`と同じ)。単体テストは偽の`ProductMessagePublisher`を使う
  - 2つのユースケースの識別子と束縛をapiのプロダクトのモジュールへ加える
  - 完了状態: 単体テストとDIの解決の検査が成功し、ugc-moderationが操作口を識別子で解決でき、application層に`**/lib/workers/**`の読み込みが無い(静的解析が成功する)
  - _Requirements: 6.1, 6.2, 6.5, 8.1, 12.6, 12.7, 12.9_

- [ ] 5.3 退会・停止の同期の波及処理を作る
  - 先に、Workers統合テストで、identity-authの退会の確定と同じ一括の書き込みで利用者の全プロダクトと旧ハンドルが論理削除され、ローンチが照会と予定の一覧から消えること、停止の確定で未開始のローンチだけが取消になり、停止解除で戻らないこと、退会の確定の競合で波及処理の文も取り消されることを確かめる
  - 2つの波及処理の識別子・束縛をapiのプロダクトのモジュールへ、登録をidentity-authの同期の波及処理の登録箇所へ同時に加える。利用者IDを条件にした集合の更新の文だけを返す
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 13.1, 13.2, 13.3_

- [ ] 5.4 4:21の物理削除の作成と送り直しのジョブを作る
  - 先に、模擬のポートの単体テストで、業務日付で13日以上前に論理削除したプロダクトに`purge_due`を作って送ること(12日前は作らない)、200件の上限、2回の実行で重複しないこと、14日を過ぎて行の残るプロダクトがあれば偽の`ProductIncidentReporter`へ`product-purge-overdue`と件数を報告すること、1時間以上滞ったイベントを100件まで送り直して回数を増やすことを確かめる
  - 2つのジョブ(4:21、`order` 1000・1010)の識別子と束縛をapiのプロダクトのモジュールへ、登録を定期実行の登録箇所へ加え、apiのCronの式の一致の検査を通す。記録は`core/product`の`ProductLifecycleStore`の型、送信は5.2の`ProductMessagePublisher`で受け取る
  - 期限超過の報告のポート`ProductIncidentReporter`をapplication層の`ports.ts`に、Sentryへ送る実装を`infrastructure/product/sentry-product-incident-reporter.ts`に置き(identity-authの`AuthIncidentReporter`と同じ形)、`PRODUCT_TYPES.ProductIncidentReporter`で束縛する
  - 4:21の起動全体の予算(`SCHEDULED_RUN_BUDGETS`の300秒)に対し、上限の件数(200件・100件)での所要時間をローカルで確かめ、12.3の運用の報告に記録する
  - 完了状態: 単体テストと定期実行の登録の検査(同じ時刻での`order`の重複なし)が成功し、application層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 2.4, 5.2_
  - _Requirements: 8.4, 8.6, 12.5, 13.5_

- [ ] 6. APIサーバーのカテゴリとローンチ履歴
- [ ] 6.1 プロダクトカテゴリのマスタのストアとユースケースを作る
  - 先に、Workers統合テストで、追加・名前とハンドルの変更・削除が監査ログと同じ一括の書き込みで確定すること、名前とハンドルの大文字小文字を区別しない重複の拒否、「その他」の変更・削除の拒否、論理削除後に物理削除されていないプロダクトを含む紐付くプロダクトがあるカテゴリの削除の拒否と監査ログが残らないこと、ハンドルの変更で旧ハンドルを保持しないことを確かめる。模擬のポートの単体テストで、名前とハンドルの形式の違反と拒否のコードを確かめる
  - ストアとユースケースの識別子と束縛をapiのプロダクトのモジュールへ加える。理由は任意の引数のまま受け付ける(管理画面の区画は理由を送らない、10)。初期データの「その他」の行を書き換えるテストは、各テストの前に固定のIDと日時の値で入れ直す(db/003)
  - 完了状態: Workers統合テスト・単体テスト・DIの解決の検査が成功する
  - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.8, 11.9, 11.11_

- [ ] 6.2 ローンチ履歴のストアとユースケースを作る
  - 先に、Workers統合テストで、他人には掲載済みのプロダクトだけ、本人には論理削除と非公開化を除く自分のプロダクト(未掲載を含む)を、最新のローンチ日の新しい順に20件ずつ返し件数が正しいことを確かめる。模擬のポートの単体テストで、表示できない利用者と停止中で本人でない場合のnull、停止中の本人の印、取消のローンチを除き番号を振ること、テスト用の供給元の要約の採用(大きい順位)と受賞の種類ごとのまとめ(Yearが先頭)、供給元の例外と供給の無いローンチでの予選の結果からの要約(キックオフ予定・予選マッチ中・ディレクトリ掲載・予選敗北)を確かめる
  - 要約と受賞のまとめは2.1の共有の規則を使う。利用者の解決は`core/profile`の`UserProfileDirectory`の型と`PROFILE_PLATFORM_TYPES`で受け取る。ストアとユースケースの識別子と束縛をapiのプロダクトのモジュールへ加える
  - 完了状態: Workers統合テスト・単体テスト・DIの解決の検査が成功する
  - _Requirements: 10.2, 10.3, 10.6, 14.11_

- [ ] 6.3 公開プロフィールの受賞の集計をローンチ履歴のユースケースに加える(仮14)
  - 先に、模擬のポートの単体テストで、表示できない利用者と停止中で本人でない場合のnull、他人には掲載済みのプロダクトだけ・本人には未掲載を含む自分のプロダクトの受賞を集めること、91件以上の対象のプロダクトを全ページ読んで集計すること、ラベルがプロダクトの名称と受賞のラベルをつないだ値になること、Yearが先頭で種類ごとの回数とラベルの順、取消のローンチを供給元へ渡さないこと、1つの供給元の例外でその供給元の受賞だけを除き警告のログを残すこと、受賞が無いときの空の配列を確かめる
  - 6.2のローンチ履歴のユースケースに受賞の集計の操作を加え、対象の判定と供給元の呼び出しは一覧と同じ部品を使う。受賞のまとめは2.1の共有の規則を使う
  - 完了状態: 単体テストが成功し、6.2のテストが変わらず成功する
  - _Depends: 6.2_
  - _Boundary: LaunchHistoryReader_
  - _Requirements: 10.11_

- [ ] 7. APIサーバーのGraphQL
- [ ] 7.1 スキーマモジュール`product`の土台と、自分のプロダクトの照会を加える
  - 先に、Workers統合テストで、`myProducts`の件数の検証とカーソル、`myProduct`の転送とnull、`newProductLaunchWindow`、`productHandleAvailability`の3値、`productOwnerStatus`が本人以外にnull、ローンチの状態・キックオフの日時・計画・固定の項目、ロゴとスクリーンショットの画像が隔離中で`objectKey`がnullになること、`client`以外の呼び出し元の拒否を確かめる
  - 型の定義・エラーの定義・入力の検証規則・ローンチと計画とカテゴリの項目のリゾルバを作り、スキーマモジュールの一覧へ加える。`modules/product/resolver-support.ts`に`clientOnly`・`adminOnly`と、`AccountGuard`を`IDENTITY_PLATFORM_TYPES.AccountGuard`から取り出す補助(`modules/profile/resolver-support.ts`の形)を置く
  - `myProducts`の引数は`CURSOR_PAGE_ARGS`(`first`は1〜100)を使わず、user-profile-socialの`FOLLOW_LIST_ARGS`と同じ形で`first`を1〜20(定数から組み立てた文言付き)、`after`を上限256文字の任意の文字列にする。21で`validation_error`になることを確かめる
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Depends: 4.4_
  - _Requirements: 2.6, 7.1, 7.4, 7.5, 9.1, 9.2, 14.5_

- [ ] 7.2 登録・編集・削除のミューテーションを加える
  - 先に、Workers統合テストで、`registerProduct`の入力の検証(名称・タグライン・ハンドル・外部URL・説明文20,000文字・スクリーンショット20件・ローンチ日の形式)と欄ごとの詳細、未ログイン・未確認・停止中・bot対策(`product_save`)の順の拒否、`updateProduct`・`deleteProduct`(`product_delete`)の各エラーコード(固定・競合・予約の禁止・非公開化・確認できない状態・不在)、未確認の利用者が編集・削除できることを確かめる
  - bot対策の操作名`PRODUCT_BOT_ACTIONS`(`product_save`・`product_delete`)を`modules/product/resolver-support.ts`に置き、`assertHuman`へ渡す。clientへの写しは9.1で作る
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Depends: 4.3, 5.2_
  - _Requirements: 1.2, 1.3, 1.6, 1.7, 1.8, 4.7, 5.2, 5.8, 6.1, 7.3, 8.1_

- [ ] 7.3 ローンチ履歴とカテゴリの操作を加える
  - 先に、Workers統合テストで、`launchHistory`の他人・本人・停止中の本人とnull・件数・カーソル、`productCategories`の並び、管理者のカテゴリの4操作の権限(閲覧のみの拒否・モデレーター以上の許可)と拒否のコード、`admin`以外の呼び出し元の拒否、`launchHistory`の`first`が21で`validation_error`になることを確かめる
  - 管理者の操作は`adminOnly(withValidatedArgs(...))`で包み、内側で`requireAdmin(context, 'moderator')`(照会は`'viewer'`)を呼ぶ(security/007)。`launchHistory`の引数は7.1と同じ形で`first`を1〜20にする
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Requirements: 10.2, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.9_

- [ ] 7.4 公開プロフィールの受賞の照会を加える(仮14)
  - 先に、Workers統合テストで、`profileAwards`がテスト用に登録した受賞の供給元の結果を種類ごとにまとめて返すこと(他人と本人で対象が異なること)、表示できない利用者と停止中で本人でない場合にnull、ハンドルの形式の違反で`validation_error`、`client`以外の呼び出し元の拒否を確かめる
  - ローンチ履歴のリゾルバのファイルに`profileAwards`を加え、既存の`ProductAward`の型で返す。スキーマファイルとリゾルバの型を生成し直す
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Depends: 6.3, 7.3_
  - _Boundary: LaunchHistoryResolvers_
  - _Requirements: 10.11_

- [ ] 8. イベントサーバーのライフサイクル
- [ ] 8.1 プロダクトライフサイクルの実行器と最後の物理削除を作る
  - 先に、模擬のポートの単体テストで、イベントが無い・完了済みで`done`、同じプロダクトの古い`pending`で60秒の`defer`、未完了の処理だけを順に実行して完了を記録すること、`continue`で5秒の`defer`、`purge_due`で全処理の後に物理削除すること、例外をそのまま投げることを確かめる。ローカルD1のWorkers統合テストで、物理削除のストアの2つの操作(画像のIDの読み取り・最後の物理削除)を確かめ、物理削除がプロダクトとその子の行・イベントの記録を消し、identity-authの利用者の物理削除が外部キーで失敗しないことを確かめる
  - 非同期の処理の登録口(`createProductLifecycleRegistry`で検証、初版は空)と実行器をeventの束縛とメッセージの処理の登録箇所へ加える。実行器はapplication層に置き、記録は`core/product`の`ProductLifecycleStore`の型で受け取り、物理削除の一括の書き込みは物理削除のストアのD1の実装(infrastructure層)だけが行う。eventのapplication層の`ports.ts`に、8.3が使う送信のポート`ProductMessagePublisher`(apiと同じ形、`@inject(PLATFORM_TYPES.MessagePublisher)`で受け取る)も作る
  - 完了状態: 単体テスト・Workers統合テスト・3経路のDIの解決の検査が成功し、`product.run-product-lifecycle`を処理でき、eventのapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 2.5_
  - _Requirements: 8.4, 8.5, 8.8, 12.4, 12.5_

- [ ] 8.2 本specの画像の隔離と削除の処理を作る
  - 先に、模擬のポート(`core/media`の`MediaFiles`・`MediaQuarantine`の偽物)の単体テストで、非公開化でロゴとスクリーンショットに非公開化の隔離理由を加え、復元で取り除き、プロダクトの行が無ければ完了すること、物理削除で画像を即時に消すことを確かめる。ローカルD1のWorkers統合テストで、media-pipelineの実装を使い、隔離理由が付き外れること、ユーザー停止の理由も持つ画像が隔離のまま残ること、既に消えた画像の削除が失敗しないことを確かめる
  - 2つの処理(`order` 1000)をeventの束縛と8.1の非同期の処理の登録口へ加える
  - 完了状態: 単体テスト・Workers統合テスト・登録の検証が成功する
  - _Requirements: 8.4, 12.8, 13.5_

- [ ] 8.3 ユーザーの物理削除の波及処理を作る
  - 先に、模擬のポートの単体テストで、利用者のプロダクトが無ければ完了、あれば`purge_due`の無いものに作って送り続きを返すこと、作成から10分を過ぎて行が残れば例外を投げることを確かめる(送信は偽の`ProductMessagePublisher`で受ける)。ローカルD1のWorkers統合テストで、2つのプロダクトを持つ退会者の`purge_due`で2つのプロダクトの`purge_due`が作られ、実行器の処理の後に呼び直すと完了になることを確かめる
  - `product-launch.product-erasure`(`purge_due`、`order` 1000)をeventの束縛とidentity-authの非同期の波及処理の登録箇所へ同時に加える(8.2の後に行い、eventの束縛の変更が並行しないようにする)
  - ユーザーの`purge_due`の処理名の並びを完全一致で確かめる既存のテスト(`apps/event/src/composition/profile-module.worker.test.ts`・`payments-module.worker.test.ts`・`ultras-module.worker.test.ts`)の期待値に`product-launch.product-erasure`を加える
  - 完了状態: 単体テスト・Workers統合テストと、identity-authの非同期の波及処理の登録の検証と、上の3つの既存のテストが成功する
  - _Requirements: 13.4, 13.5_

- [ ] 9. 利用者側の画面
- [ ] 9.1 クライアントの操作と、画面の区画・削除の注意書きの登録口を作る
  - 自分のプロダクト・登録と編集と削除・カテゴリ・ローンチ履歴・公開プロフィールの受賞(仮14)の操作をclientの`src/graphql/operations/product/`に1ファイル1操作の`*.graphql`(操作名は`Client`で始める)で加え、clientで`bun run graphql:generate`を実行して型と`<操作名>Document`とpersisted operationsを生成する
  - 区画に渡す文脈と2つの登録の型、2つの登録口(初版は空)を作り、`order`順の並べ替えの単体テストを書く
  - 取得の設定と、生成物の型から画面の型への変換・無効化を`src/graphql/my-products.ts`・`src/graphql/launch-history.ts`に置き、単体テストを書く(frontend-platformの操作の追加手順)。続けて読み込む一覧は`infiniteQueryOptions`で、キーに閲覧者のIDを入れる(frontend/006)
  - apiの`PRODUCT_BOT_ACTIONS`を`src/components/product/bot-actions.ts`へ写し、`config/contract-copies.unit.test.ts`の`BOT_ACTION_COPIES`に登録する
  - 完了状態: 型の生成と単体テストと`config/contract-copies.unit.test.ts`が成功し、`graphql:allowlist`でapiの許可リストを再生成して`graphql:check`が成功し、後続specが登録口に1行足すだけで区画と注意書きを加えられる
  - _Depends: 7.2, 7.3, 7.4_
  - _Requirements: 8.3, 9.4, 10.11_

- [ ] 9.2 ローンチの状態と予約の案内の表示部品を作る
  - 先に、ブラウザテスト(axeの違反0件)で、ローンチの状態の文言(キックオフ予定と`<time datetime>`の利用者のタイムゾーンの日時と相対表現・予選マッチ中と「トップページで見る」・ディレクトリ掲載・予選敗北・取消)と、計画ごとの案内(選べる最も早い日・ローンチ日の変更・予約の禁止の理由と解除の日時・確認できない状態・固定の理由)を確かめる
  - 完了状態: ブラウザテストが成功し、一覧と編集画面とローンチ日の欄から読み込める
  - _Requirements: 5.2, 5.4, 9.8_

- [ ] 9.3 自分のプロダクトの一覧の画面を作る
  - 先に、ブラウザテスト(axeの違反0件)で、項目のロゴ(プレースホルダーを含む)・名称・ハンドル・カテゴリ・公開停止中のバッジ・状態と案内・編集と詳細の導線(非公開化中は詳細を出さない)、テスト用の登録で区画が`order`順に出て1つの失敗が他を止めないこと、「さらに読み込む」、0件・初回ローディング、最初の取得の失敗が一覧の位置の`PartialErrorState`になり続きの取得の失敗が「さらに読み込む」の近くの`role="alert"`になること(frontend/006)、表示中に0:00を越えるとカードの状態がマッチ中に変わること(偽の時計)、停止中の案内と導線の無効を確かめる
  - `/my/products`を`_authenticated`の下に作り、`loader`で`queryClient.infiniteQuery(...).catch(() => undefined)`を待ち、`head`は`buildSitePageHead`で作る。カードは`<article>`に見た目のクラスを付けて描く(frontend-libにカードの部品は無い)。表示中の境界の取り直しは設計の「表示中の境界の取り直し」に従う
  - 完了状態: ブラウザテストが成功し、ローカルでユーザーメニューの「自身のプロダクト」から開ける
  - _Requirements: 1.11, 3.8, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [ ] 9.4 プロダクトのフォームの基本の欄の部品を作る
  - 先に、ブラウザテスト(axeの違反0件)で、ハンドルの欄の`/p/`の接頭辞・フォーカスアウトの形式と使用可否・使用中の文言・旧ハンドルの案内(次にハンドルを変更するか他のプロダクトが同じハンドルを設定するまで転送される旨)、カテゴリの選択の並びと、`FormField`の`disabled`による無効(入力要素が`disabled`になること)と理由、ロゴの500kBの超過と形式の違反の事前の表示と正方形の切り取り、スクリーンショットの20枚・合計10MBの事前の表示と取り除き・枚数と合計の表示、ロゴとスクリーンショットの入力欄に`contactAvailable`として`CLIENT_PROFILE.contactAvailable`を渡すことを確かめる。`ImageUploadField`の上限は`constraints`(`purpose`・`allowedTypes`・`maxBytes`・`subjectLabel`・`maxCount`・`maxTotalBytes`・`existingCount`・`existingTotalBytes`)にまとめて渡し、`label`・`onUploaded`・`edit.maxLongSide`も渡す。スクリーンショットの一覧は`MediaPicture`の`display={{ kind: 'screenshot', variant: 'thumb' }}`で描く
  - 完了状態: ブラウザテストが成功する
  - _Requirements: 2.6, 2.10, 3.1, 3.2, 3.3, 6.3_

- [ ] 9.5 ローンチ日の欄を作る
  - 先に、ブラウザテスト(axeの違反0件)で、選べない日の理由(ツールチップと読み上げ)とフォーカスできること、選んだ日のキックオフの日時と相対表現、Ultrasの導線の出し分け(導線の表示の可否を模擬)、23:40を過ぎた時点のタイマーによる取り直し(偽の時計。定期の取り直しの`refetchInterval`は使わない)、ローンチ日が業務日付のまま表示され利用者のタイムゾーンで日がずれないこと、計画ごとの表示(変更・予約・禁止・固定で9.2の案内)を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Depends: 1.4, 9.2_
  - _Requirements: 4.8, 4.9, 4.10_

- [ ] 9.6 登録・編集の共通のフォームと登録画面を作る
  - フォームの値は`RegisterProductInput`・`UpdateProductInput`と同じく編集する値を`fields`の下(欄の名前は`fields.<名前>`)、ローンチ日を`fields`の外の`launchDate`に置く。スキーマはローンチ日の欄を描くかで分け(描かない間は`launchDate`を含めず`onSubmit`で`null`を足す)、編集の`productHandle`・`expectedVersion`はスキーマの入力に含めず`onSubmit`で読み込んだ値から足し、編集のスキーマはカテゴリ(`fields.categoryId`)を任意にする
  - 先に、フォームの検証規則の単体テスト(サーバーと同じ定数と判定から組み立てていること、名称・タグライン・外部URL・説明文・スクリーンショットの件数、ローンチ日を含むスキーマと含まないスキーマ、編集のスキーマがカテゴリの無い値を通すこと)と、ブラウザテスト(axeの違反0件)で、区画の並び、各欄のフォーカスアウトの検証、説明文のマークダウンの入力欄とプレビュー(`MarkdownEditor`へ`value`・`onValueChange`・`onBlur`・`ref`・`labelId`・`describedById`・`invalid`・`placeholder`を明示して渡し、ラベルの押下でフォーカスできること)、未確認の利用者の入力と送信の無効と再送の導線、送信時のbot対策のトークン(ウィジェットは非表示で、判定の枠と場所を設けない)、サーバーのエラーの欄への表示(`input.fields.<名前>`・`input.launchDate`の詳細がその欄に出ること、`input.fields`そのものの詳細はフォーム全体の失敗になり送信ボタンが無効のまま残らないこと)と選べる最も早い日の表示、`GraphQLClientError`でない例外の`errorMessageOf`の文言、未確認の利用者で全欄が`FormField`の`disabled`で無効になり送信ボタンが`SubmitButton`の`disabled`で無効であること、登録の成功のトーストと`/my/products`への移動を確かめる
  - `/my/products/new`を`_authenticated`の下に作る
  - 完了状態: テストが成功し、ローカルでヘッダーの「ローンチする」から登録画面が開き、登録したプロダクトが一覧に出る
  - _Depends: 9.3, 9.4, 9.5_
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.7, 1.9, 1.10, 1.11_

- [ ] 9.7 編集画面と削除の確認を作る
  - 先に、ブラウザテスト(axeの違反0件)で、状態の区画(ローンチの状態・次回の予約・固定・非公開化中の案内)、表示中に23:45を越えるとカテゴリと削除が無効に変わり、フォーカスのある削除のボタンはフォーカスが離れるまで`aria-disabled`のままであること(偽の時計、frontend/010・004)、保存の`product_update_conflict`・`launch_date_unavailable`で`myProduct`と選べる日が取り直されること、固定の期間のカテゴリ・ローンチ日・削除の無効と理由と他の欄の編集(カテゴリは`FormField`の`disabled`で無効になり、保存で読み込んだカテゴリと`launchDate: null`を送ること。カテゴリの詳細はフォーム全体の失敗になり送信ボタンが無効のまま残らないこと)、`blocked`・`unknown`でローンチ日を含まないスキーマのフォームになり`launchDate: null`を送ること、`productHandle`・`expectedVersion`を読み込んだ値から送ること、版の競合の再読み込みの案内、保存の成功とハンドルの変更でのURLの置き換え、削除の確認ダイアログの文言と、テスト用の登録の注意書きの表示とbot対策(`product_delete`)、削除の成功で一覧へ戻ることを確かめる
  - `/my/products/$handle/edit`を作り、null(404)と旧ハンドルの302を`loader`で扱う。削除の確認はfrontend-libの`Dialog`と`destructive`のボタンで組み(アラートダイアログは無い。clientの`withdrawal-section.tsx`と同じ作り)、状態の区画は`<section>`に見た目のクラスを付けて描く
  - 完了状態: ブラウザテストが成功し、ローカルで一覧の「編集」から開いて保存と削除ができる
  - _Requirements: 6.3, 6.4, 7.1, 7.4, 7.5, 7.6, 7.7, 8.2, 8.3_

- [ ] 9.8 公開プロフィールのローンチ履歴のタブを作る
  - 先に、ブラウザテスト(axeの違反0件)で、タブの件数、項目のロゴ・受賞バッジ(Yearが先頭・回数・ツールチップ)・項目全体のリンク・タグラインの省略・カテゴリのリンク・「サイトを開く」の`rel`(掲載済みは`noopener`、未掲載は`noopener ugc`)・本人の「編集」、ローンチの3件と「他◯回を表示」・マッチ中の「トップページで見る」・キックオフ予定の日時、本人の未掲載のバッジと案内文、停止中の本人の薄い表示とリンクの非表示、0件(本人と他人)、最初の取得の失敗が一覧の位置の`PartialErrorState`(本specの文言と再試行)になり、続きの取得の失敗が「さらに読み込む」の近くの`role="alert"`になること(frontend/006)を確かめる
  - ローンチの状態の文言とキックオフの日時の表示には9.2の部品を使う。項目の受賞バッジは、9.9が公開プロフィールの区画でも使う共用の部品`AwardBadgeList`(`components/launch-history/award-badge-list.tsx`)として作る。公開プロフィールのタブの登録箇所に`launches`(10)を加え、タブと受賞バッジが空であることを確かめる既存の`apps/client/src/components/profile/public-profile-section-order.unit.test.ts`のタブの期待値を更新する。タブのパネルは`RecoverableSlot`が包むが、本specの文言を出すためパネルが自分で失敗を扱う
  - 完了状態: ブラウザテストが成功し、ローカルで`/@<ハンドル>`を開くと既定のタブとしてローンチ履歴が出る
  - _Depends: 9.2_
  - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.7, 10.8, 10.9, 10.10_

- [ ] 9.9 公開プロフィールの受賞バッジの区画を作り、登録する(仮14)
  - 先に、ブラウザテスト(axeの違反0件)で、受賞の照会の結果からYearが先頭の種類ごとのゴールドのバッジと2回以上の「×N」、ツールチップと読み上げ用の文言に受賞したプロダクト名と週・年が並ぶこと、キーボードでバッジにフォーカスしてツールチップが開くこと、結果が空・null・取得エラー・読み込み中のときに何も描かれないこと(取得エラーで再試行の操作も出ないこと)を確かめる
  - 9.1の受賞の操作を読み、9.8の`AwardBadgeList`で描く区画を作り、公開プロフィールの受賞バッジの登録箇所(user-profile-socialの`PUBLIC_PROFILE_BADGES`)に`{ id: 'product-launch.award-badges', order: 10, Section: ProfileAwardBadges }`を加え、`public-profile-section-order.unit.test.ts`の受賞バッジの期待値を更新する。受賞バッジの区画はエラー境界とSuspenseなしで描かれるため、suspenseを使わない`useQuery`で読み、失敗を区画の中で捕まえる
  - 完了状態: ブラウザテストが成功し、ローカルで受賞のある利用者の`/@<ハンドル>`を開くとフォロワー数の下に受賞バッジが出て、受賞の無い利用者では区画が出ない
  - _Depends: 9.1, 9.8_
  - _Boundary: ProfileAwardBadges、`apps/client/src/composition/public-profile-sections.ts`_
  - _Requirements: 10.11_

- [ ] 10. (P) 管理画面のプロダクトカテゴリの区画を作る
  - 9.1の後に行い、許可リストの再生成が並行しないようにする。管理画面のカテゴリの操作をadminの`src/graphql/operations/product/`に1ファイル1操作の`*.graphql`(操作名は`Admin`で始める)で加え、adminで`bun run graphql:generate`を実行して型とpersisted operationsを生成し、apiで`bun run graphql:allowlist`を実行して許可リストを再生成する
  - 先に、ブラウザテスト(axeの違反0件)で、一覧(名前・ハンドル・「その他」の印)、モデレーター以上だけの追加・変更・削除、ハンドルの形式の検証、拒否の文言の表示(`GraphQLClientError`でない例外は問い合わせを促さない`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`の文言)、削除の確認の説明(論理削除から14日以内のプロダクトも数える旨、`deleteDescriptionOf`)と監査ログに記録される旨(`deleteAudited`)、理由を送らないこと、区画の失敗が他の区画を止めないことを確かめる
  - `CategoryMasterEditor`の実装の引数に合わせる。「その他」は各項目の`systemDefault`、名前の検証は部品の中で行われる(呼ぶ側から渡さない)、ハンドルの検証は`validateHandle`に`checkHandleFormat(PRODUCT_CATEGORY_HANDLE_RULE)`の結果を文言に直す関数を渡す。部品に理由の入力欄が無いため、理由は送らない(2026-11-09に開発者が確定。問い合わせカテゴリの区画と同じ)
  - 取得の設定・変換・無効化を`src/graphql/admin-product-categories.ts`に置き、単体テストを書く(inquiryの`src/graphql/admin-inquiry-categories.ts`と同じ形)
  - カテゴリのページの区画の登録箇所に`product-launch.product-categories`(10)を加える
  - 完了状態: ブラウザテストと`graphql:check`が成功し、ローカルで管理画面の`/categories`の先頭にプロダクトカテゴリの区画が出る
  - _Boundary: ProductCategorySection、`apps/admin/src/composition/category-sections.ts`_
  - _Depends: 7.3, 9.1_
  - _Requirements: 11.7, 11.10_

- [ ] 11. 文書
- [ ] 11.1 (P) 技術ドキュメントを書き、CLAUDE.mdから参照する
  - `backend/012-aggregate-lifecycle-events.md`・`backend/013-pluggable-decision-sources.md`・`frontend/012-business-date-calendar.md`を設計のProductTechDocsの内容(`backend/013`には、判定の供給元の規約に加えて、保存の登録口の規約: 同時の文は対象のIDを条件にした更新だけ・確定の後の処理は冪等にし失敗で保存を失敗させない・削除や復元はライフサイクルで伝える・処理の契約と実装は文と接続を扱うためinfrastructure層に置き、保存の一括の書き込みを行うストアの実装が文を加えて確定の後の処理を呼ぶ)で、本プロジェクト固有の値を含めずに書き、`backend`・`frontend`のREADMEの文書一覧に行を加える。help-centerが節を加える`backend/011-handle-namespaces.md`は変更しない
  - `backend/012`は、共通の規約(イベントの記録と状態の条件付きの確定・同期と非同期の処理・完了の記録と冪等・`done`・`continue`と再試行・日次の送り直し・`order`の帯)をbackend/007へのリンクで参照し、007との差分(集約ごとのイベントの種類と登録口・同じ集約の発生順・物理削除を最後に行うこと・親の集約の物理削除から子の集約の物理削除のイベントを作って待つこと・子の集約を外部キーで参照する行を子の物理削除の処理で消すこと)だけを書く。backend/007は変更しない(2026-11-09に開発者が確定)
  - `frontend/012`には、表示中の画面が業務時刻の境界を越えたときのタイマーによる取り直しと、業務日付の表示の整形(利用者のタイムゾーンで日をずらさない)を含める
  - CLAUDE.mdの「技術規則の参照先」に「ユーザー以外の集約の状態の変化を他の機能へ伝える処理を作る前に: `backend/012`」を、作った見出しへのリンクで加える
  - 番号: help-centerは未実装のため`frontend/011`が欠番になるが、本specは`frontend/012`のまま使う(2026-11-09に開発者が欠番を許すと確定)
  - 完了状態: 文書とREADMEが整形の検査を通り、本プロジェクト名とサービス固有の仕様を含まず、CLAUDE.mdのリンクの見出しが実在する
  - _Boundary: `docs/GUIDES/tech/backend/012-aggregate-lifecycle-events.md`・`backend/013-pluggable-decision-sources.md`・`frontend/012-business-date-calendar.md`・`backend/README.md`・`frontend/README.md`・`CLAUDE.md`_
  - _Requirements: 15.4_

- [ ] 11.2 (P) 日次タイムライン・準拠方針・オンボーディングを更新する
  - 日次タイムラインの4:21の表に`product-launch.purge-orchestrator`(1000)・`product-launch.lifecycle-redispatch`(1010)を、準拠方針の注5に論理削除したプロダクトのハンドルの扱いと、プロダクトの旧ハンドルは他のプロダクトが設定した時点で消えること(仮5)を、`docs/onboardings/project-values.md`に波及処理・処理・ジョブの名前と`order`・用途・bot対策の`action`・メッセージ種別と、backend/011の値の表へプロダクトのハンドル(上限50、予約語は`IMPERSONATION_RESERVED_HANDLES`)とカテゴリのハンドル(上限50、予約語なし)を加える
  - 完了状態: 文書が整形の検査を通り、2026-10-24に確定した決定(仮4・仮5など)に合っている
  - _Boundary: `docs/GUIDES/service/overview/007-daily-timeline.md`・`docs/GUIDES/service/legal/001-compliance-policy.md`・`docs/onboardings/project-values.md`_
  - _Requirements: 15.5_

- [ ] 12. 検証
- [ ] 12.1 E2Eテストで利用者側のプロダクトの流れを確かめる
  - `e2e/client/product.e2e.test.ts`: identity-authの`e2e/support/mailpit.ts`で確認済みの利用者(メールアドレスのドメインは`.example`)を登録し、ロゴ・スクリーンショット・リンクを含む説明文・カテゴリ・ハンドル・ローンチ日を入力して登録→`/my/products`に「キックオフ予定」で出る→編集でハンドルを変え、旧ハンドルの編集画面のURLが新しいURLへ移る(転送を追わない要求で302と`Location`)→ローンチ日の変更→`/@<ハンドル>`のローンチ履歴に本人だけ未掲載のバッジ付きで出る→削除の確認で一覧から消える。Turnstileはローカルの常に成功するキーを使う。Ultrasの機能フラグで結果が変わる表示は確かめない
  - 完了状態: ローカルでE2Eテストが成功する
  - _Depends: 9.7, 9.8_
  - _Requirements: 15.3_

- [ ] 12.2 E2Eテストで管理画面のカテゴリの流れを確かめる
  - `e2e/admin/product-categories.e2e.test.ts`: admin-foundationの`e2e/support/admin-bootstrap.ts`で管理者としてログインし、カテゴリの追加→名前とハンドルの変更→「その他」の削除の拒否→利用者側でそのカテゴリのプロダクトを登録した後の削除の拒否を確かめる
  - 完了状態: ローカルでE2Eテストが成功する
  - _Depends: 9.6, 10_
  - _Requirements: 11.5, 11.6, 15.3_

- [ ] 12.3 全体の検査とカバレッジを確かめ、運用の事項を報告する
  - 整形の検査・静的解析・型検査と、単体テスト・Workers統合テスト・ブラウザテストを一括で実行し、本specが追加・変更したファイルのカバレッジが80%以上であることを確かめる。ログとSentryへの送信に説明文・外部WebサイトURL・入力されたハンドル・名称が含まれないことを検索で確かめる
  - match-engineの実装までstagingで予選の結果が記録されずローンチがマッチ中のまま固定されることと、結果を記録する手順(`wrangler d1 execute`の例)を作業の報告に記録する。本specの仮1〜仮14は2026-10-24に開発者が確定済みである
  - api・eventの静的解析で、application層とdomain層に`**/lib/workers/**`の読み込み(型だけの読み込みを含む)が無く、`core/product`が`workers`・`apps/db`を読み込まないことを確かめる
  - 完了状態: すべての検査とテストが成功し、カバレッジの結果が閾値を満たし、報告にmatch-engineの実装までの運用の事項が載っている
  - _Requirements: 14.8, 15.1, 15.2_

## Implementation Notes

- 1.1: 名称・タグラインの文言の主語は「名称」「タグライン」(「名称を入力してください。」「名称は50文字以内で入力してください。」「名称に使用できない文字が含まれています。」、タグラインは100文字)。1.3で文言規則003へこの6文言をそのまま加える。`checkScreenshotTotals`は枚数を先に判定し(両方の超過は`too-many`)、1枚の5MBの上限は用途の`maxBytes`に任せる。入力規則は`apps/common-lib/product/product-input-rules.ts`、標準カテゴリは`product-category-constants.ts`、監査の操作種別は`admin/audit-actions/product-launch.ts`
- 1.2: テーブルは`apps/db/schema/product/`、条件の部品は`visibility.ts`の`visibleProducts()`・`wonLaunchExists()`・`productInCategory()`。マイグレーションは`20261109042627_product_launch`・`20261109042637_product_launch_seed`。`apps/db`は`common-lib`を読めないため、標準カテゴリの値とスクリーンショットの位置のCHECK(0〜19)を直書きし、`PRODUCT_SCREENSHOTS_MAX`と手で同期する。`outcome`・`type`の値の一覧はdb内だけの定数のため、2.1で作るbackend-libのイベントの種類と手で一致させる。`products.version`の既定値は0、ライフサイクルイベントは`status`の既定値`pending`・`dispatch_count`の既定値1(`user_lifecycle_events`と同じ)。部分一意索引は`product_launches_product_id_open_unique`・`product_lifecycle_events_product_id_purge_due_unique`
