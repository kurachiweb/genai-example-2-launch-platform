# Implementation Plan

- [ ] 1. 基盤: 共有の規則・テーブル・文言
- [x] 1.1 URLのクエリの規則と期間のプリセットを、4アプリが読み込める共有の定義として作る
  - 前提: dev-tooling〜match-engineの18specの全タスクが完了していること(product-launchの`core/product`の契約と識別子(`ProductDirectory`・`ProductCategoryDirectory`・`PRODUCT_PLATFORM_TYPES`)・`visibleProducts()`・`wonLaunchExists()`・ライフサイクルの登録口・`LAUNCH_SUMMARY_SOURCES`・`productOwnerStatus`と、仮11の`productInCategory()`・`PRODUCT_SAVE_HOOKS`とinfrastructure層の`ProductSaveHook`の契約・`launch-summary.ts`の`fallbackLaunchSummary`・`groupAwards`、match-engineの`MatchDirectory`・`SupporterDirectory`・`qualifierWins()`・`MATCH_EVENT_HANDLERS`・`loadMatchView`・`MatchCard`・`useUpvote`・`UpvoteBotProtection`・`useServerCountdown`、content-processingの検索の基盤、identity-authとuser-profile-socialの部品、E2Eの`e2e/support/mailpit.ts`・`e2e/support/local-d1.ts`、backend-platformの改訂2の`e2e/support/scheduled-trigger.ts`の`triggerScheduled`)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、単体テストで、不正なクエリの既定化(実在しない日付・開始日が終了日より後・検索語が無いときの関連度・既定と同じ並び順・`page`の0・1・小数・文字列)、50書記素への切り詰め(結合文字を含む絵文字)、並び順の値が4つで少ない順が無いこと、条件の変更で`page`が外れること、既定から変えている項目の数、基準時刻の今日からの各プリセットの範囲(月曜日・日曜日・月末・年末)、プリセットと一致しない範囲の判定、未来と逆順の検証、期間の表示の文言(今年は年を省く)を確かめる
  - 他の層を読み込まない(日付は`YYYY-MM-DD`の文字列で扱う)
  - 完了状態: 単体テストが成功し、apiとclientの型検査で規則を読み込める
  - _Requirements: 3.3, 3.4, 3.5, 3.7, 3.8, 3.10, 4.3, 5.1, 5.3, 5.6, 6.2_

- [x] 1.2 検索索引の文書と勝利したプロダクトの記録のテーブル、索引の定義、マイグレーションを作る
  - 先に、テーブルの定義の単体テストで、索引文書の共通の列と名称・タグラインの列、勝利したプロダクトの記録のプロダクトの一意索引・投稿者の索引・投稿者に外部キーが無いこと・`ON DELETE`の指定が無いことを確かめる
  - 索引の定義(重みは名称10・タグライン5・キーワード1)を索引の集約点に加え、mainの最新を取り込んでから通常のマイグレーションを生成し、索引の定義からSQLを出力するスクリプトの出力を貼ったカスタムマイグレーションを作る
  - 完了状態: 単体テストと、集約点の全定義で全文検索の索引とトリガーの欠けが無いことの検査が成功し、マイグレーションをローカルに適用できる
  - _Requirements: 4.1, 12.1, 12.7_

- [x] 1.3 (P) ページ配置・文言規則に、本specの決定と画面と文言を先に書く
  - ページ配置: ディレクトリの区画の置き場所(仮3の注記)、詳細ページの区画の置き場所と順(本specの4件と後続specの予約)、仮1・仮2(基準勝利)・仮5(サポーターの数)の注記を、2026-10-24に開発者が確定した決定として加える
  - 文言規則: 設計のError Handlingに挙げた追加の文言(検索語の上限・関連度の併記・読み込み中・ディレクトリの説明・リンクのコピー・サポーターの一覧・マッチが無いブロック・接戦・不戦勝の説明・予約の状態の照会の失敗)を加える
  - 完了状態: 2つの文書が整形の検査を通り、6・7のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md`_
  - _Requirements: 14.5_

- [x] 1.4 (P) トップページの汎用の部品を、詳細ページと共有する置き場所へ移す
  - clientの`components/top/`の`auto-refresh-switch.tsx`・`full-time-countdown.tsx`・`full-time-countdown-text.ts`と、`top-page-messages.ts`の`AUTO_REFRESH_LABEL`・`AUTO_REFRESH_DESCRIPTION`(`auto-refresh-messages.ts`へ)、`qualifier-refresh.ts`の`FOLLOW_UP_REFETCH_LIMIT`・`QueryUpdateCounts`・`updateCountOf`(`follow-up-refetch.ts`へ)を`components/match/`へ移し、既存のテストも移す。予選の一覧だけの判定と`FullTimeCountdownSection`は`components/top/`に残す。中身と振る舞いは変えず、コメントの「トップページの」をページ全体の切り替えの説明に改める
  - トップページの読み込みを書き換え、frontend/013の部品の表の「自動更新の切り替え」の置き場所に、複数のページが使う場合は`components/<ドメイン>/`に置く旨を加える(技術ドキュメントのため本プロジェクト名を書かない)
  - 完了状態: 移したテストとトップページの既存の単体テスト・ブラウザテストが成功し、clientの型検査・静的解析が成功し、`components/top/`に移した部品の読み込みが残っていない
  - _Boundary: clientの`components/top/`・`components/match/`、`docs/GUIDES/tech/frontend/013-live-scoreboard.md`_
  - _Requirements: 9.6, 9.9_

- [x] 1.5 (P) frontend-libにカードの部品を作る
  - shadcn/uiの`Card`を、frontend/005の「1ファイル1コンポーネントとshadcn/uiの分割」に従って`components/ui/card/`の部分ごとのファイル(`card.tsx`・`card-header.tsx`・`card-title.tsx`・`card-description.tsx`・`card-action.tsx`・`card-content.tsx`・`card-footer.tsx`)で作る。モックアップに無い部品のため、shadcn/uiの既定の`Card`を基にデザイントークン(`bg-card`・`text-card-foreground`・`border-border`)で書く
  - 先に、ブラウザテスト(`runAxe`の違反0件、ライト・ダーク)で、各部分の要素・`data-slot`・`className`の合成と属性の受け渡しを確かめる。カタログ(`card.stories.tsx`)を添え、frontend/005の部品の一覧に`Card`の部分を加える
  - 完了状態: ブラウザテストとカタログのビルドが成功し、frontend-libと画面を持つアプリの型検査が成功する
  - _Boundary: `apps/frontend-lib/components/ui/card/`、`docs/GUIDES/tech/frontend/005-shared-components.md`_
  - _Requirements: 11.1_

- [ ] 2. 共有部品
- [x] 2.1 プロダクトの検索対象を作り、検索対象の集約点に加える
  - 先に、ローカルD1のWorkers統合テストで、掲載中のプロダクトだけを読み(名称・タグライン・説明文、版は読み取りの時刻)、未掲載・非公開化・投稿者の停止・論理削除で読み取りが空になり索引の対象の条件が偽になること、content-processingの索引の更新の処理(キーワードの抽出は固定の結果の偽物)で索引文書が作られ、名称の前方一致と説明文のキーワードで検索できること、索引に名称・タグライン・キーワード以外を含めないことを確かめる
  - 索引の対象の条件(`isIndexable`)は`EXISTS`の中身(`SELECT 1 …`)だけを返す(包むのはcontent-processingの書き込みの側)。help-centerが未実装のため、検索対象と索引の定義の集約点への最初の登録になる。登録の形はテスト用の検索対象`workers/search/testing/fixture-search-target.ts`を先例にする
  - 完了状態: Workers統合テストと、検索対象の集約点の全定義の検証の単体テストが成功する
  - _Requirements: 4.1, 12.1, 12.9, 12.10_

- [x] 2.2 ディレクトリの一覧の照会の本体(掲載の条件・基準勝利・期間・並び順・ページ分け)を作る
  - 先に、ローカルD1のWorkers統合テストで、掲載の条件(退会・停止・非公開化・論理削除・敗北と両者敗北だけ・トーナメントの勝利だけのプロダクトが出ないこと、停止の解除と復元で戻ること)、2回勝利したプロダクトが1項目で直近の勝利が基準勝利になること、期間の開始日・終了日と同じ日の勝利が含まれ期間外の勝利だけのプロダクトが除かれ期間内の古い勝利が基準勝利になること、基準時刻の0時の前後に実施した勝利の実施日と期間の判定、ローンチ日とUpvote数の3つの並び順と同順位の決まった順、20件目と21件目のページの境界と総件数を確かめる
  - 同じく先に、識別子`DIRECTORY_PLATFORM_TYPES`が`Symbol.for('directory.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - application層は`**/lib/workers/**`を型も含めて読み込めないため、一覧の照会と記録のストアの契約と入出力の型は`apps/backend-lib/core/directory/ports.ts`、識別子は`core/directory/identifiers.ts`に置き、D1の実装だけを`workers/directory/d1-directory-listing.ts`に置く。`core/directory`は`workers`と`apps/db`を読み込まない
  - match-engineの`qualifierWins()`は別名付きの副問い合わせのため、`const wins = qualifierWins()`と受けて`wins.productId`などで結合する(`lastUpvotedAt`・`decidedAt`はエポックミリ秒の数値、`matchDate`は文字列)
  - 一覧と件数は1回の一括の読み取りにする。照会と記録の全部品の契約とDIの識別子をここで一括で作る(2.3〜2.5は識別子を作らない)
  - 完了状態: Workers統合テストと識別子の単体テストが成功し、`core/directory`の`DIRECTORY_PLATFORM_TYPES`の識別子で一覧の照会を取得する型検査が通る
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8, 3.6, 5.4, 5.5, 6.1, 13.5, 14.2_

- [x] 2.3 一覧の照会に全文検索の結合と関連度の並び順を加える
  - 先に、Workers統合テストで、検索の前方一致・大文字小文字・全角半角・発音区別符号の無視・構文の文字列化(引用符・演算子)、関連度の順と同順位の決まった順、索引文書が残っていても掲載中でないプロダクトが出ないことを確かめる(索引文書は2.1の検索対象で作る)
  - 完了状態: Workers統合テストが成功する
  - _Depends: 2.1_
  - _Requirements: 4.1, 4.2, 4.8, 5.2_

- [x] 2.4 一覧の照会にカテゴリの絞り込みとカテゴリごとの掲載数を加える
  - product-launchの仮11の`productInCategory(categoryId)`を、`visibleProducts()`・`wonLaunchExists()`と組み合わせて使い、`products`は`id`・`category_id`だけを読む
  - 先に、Workers統合テストで、カテゴリの絞り込みが期間・検索・並び順と組み合わさること、カテゴリごとの掲載数が掲載中のプロダクトだけを数えることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 3.1, 3.2_

- [x] 2.5 勝利したプロダクトの記録のストアと索引の削除の文を作り、共有の束縛をapiとeventに組み込む
  - 先に、Workers統合テストで、記録の作成の重複の無視、存在の確認、投稿者ごとの一覧の昇順と続き、物理削除で索引文書と記録が1つの一括の書き込みで消えること、投稿者の全ての索引文書を消す文を確かめる
  - 記録のストアのD1の実装は`workers/directory/d1-directory-entry-store.ts`に置き、契約は2.2の`core/directory/ports.ts`を使う。投稿者の全ての索引文書を消す文はDBの型を使うため`workers/directory/product-index-removal-statements.ts`に置き、infrastructure層だけが使う
  - 一覧の照会と記録のストアのD1の実装を処理単位で束縛するモジュールを作り、apiとeventの束縛の一覧へ同時に加える
  - 完了状態: Workers統合テストと、3経路(api・eventの`fetch`・eventの`queue`)のDIの解決の検査が成功する
  - _Requirements: 12.4, 12.5, 12.7, 13.5_

- [ ] 3. APIサーバーの読み取り
- [x] 3.1 (P) 詳細ページの公開範囲と基準勝利の種類の純粋な規則を作る
  - 先に、単体テストで、公開範囲(不在・可視でない(非公開・停止・退会)・未掲載の他者と本人・旧ハンドルの転送と転送しない場合・現在のハンドル)、基準勝利の種類(勝利・対戦相手なし・開始時点の相手の該当・早期の相手の該当)を確かめる
  - 完了状態: 単体テストが成功し、規則がD1を読み込まない
  - _Boundary: ProductPageAccess、BaseWin_
  - _Requirements: 2.7, 2.8, 2.9, 2.10, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 3.2 (P) マッチ履歴と通算成績の純粋な規則を作る
  - 先に、単体テストで、マッチ履歴の行(確定前の除外・実施日の新しい順・対戦相手の4つの見え方と紐付けの解除・接戦・不戦勝と早期の不戦勝の相手の数の欠落・両者敗北)、通算成績と初ローンチ日とローンチ回数(取消とキックオフ前の除外)を確かめる
  - 完了状態: 単体テストが成功し、規則がD1を読み込まない
  - _Boundary: MatchHistory_
  - _Requirements: 9.5, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [x] 3.3 ローンチの要約と受賞の読み取り、一覧の項目の値の登録口と読み取りを作る
  - apiのDIの識別子の一覧をここで作る(3.4・3.5・4.1・5.1・5.4は追記する)
  - 予選の結果からの要約と受賞のまとめは、product-launchの`launch-summary.ts`の`fallbackLaunchSummary`・`groupAwards`を直接読み込んで使い、同じ規則を本specに作らない
  - 先に、単体テスト(模擬の供給元)で、要約の供給元を`order`順に呼び`rank`の大きい要約を採ること、供給の無いローンチと供給元の失敗で`fallbackLaunchSummary`の要約に縮退し`warn`のログを残すこと、受賞を`groupAwards`でプロダクトごとにまとめること、項目の値の供給元の失敗がその値だけの欠落になることを確かめる
  - 項目の値の供給元の契約と登録の型と、初版は空の登録の一覧を作る
  - 完了状態: 単体テストが成功し、後続specが登録の1行で項目の値を加えられる
  - _Requirements: 2.11, 2.12, 10.1_

- [x] 3.4 ディレクトリの一覧とカテゴリの選択肢のユースケースを作る
  - 先に、単体テスト(模擬のポート)で、クエリの正規化とカテゴリのハンドルの解決(存在しないものは外す)、空白だけの検索語を検索なしとすること、範囲外のページで空の一覧と総件数を返すこと、ページのIDでプロダクト・マッチ・ローンチの照会を1回ずつ行うこと、問い合わせの後に可視でなくなった行を除くこと、本人の項目の印、基準勝利の種類、解決したカテゴリで絞り込み`applied`に載せること、カテゴリの選択肢の並び(掲載数の多い順・同数は名称順・「その他」を末尾、掲載の無いカテゴリも含む)を確かめる
  - 一覧の照会は`core/directory`、プロダクトとカテゴリの照会は`core/product`、マッチの照会は`core/match`の契約と識別子で受け取る(application層は`**/lib/workers/**`を型も含めて読み込めない)
  - 完了状態: 単体テストが成功し、APIサーバーの静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 2.2, 2.4, 3.1, 3.3_
  - _Requirements: 1.3, 2.1, 2.5, 3.1, 3.2, 4.7, 4.8, 6.1, 6.6, 13.4_

- [x] 3.5 プロダクト詳細ページ・開催中のマッチ・サポーターの一覧のユースケースを作る
  - 先に、単体テスト(模擬のポート)で、ハンドルの形式の違反の404、公開範囲の判定の結果ごとの返り値、詳細・ローンチ・マッチ・対戦相手の照会を各1回で行うこと、取消のローンチの除外、相手の側も返るマッチから自分の側を選ぶこと、キックオフ済みと最も新しいキックオフ済みのローンチの印、サポーターの一覧の表示できないプロダクト・他のプロダクトの側・確定前のマッチでの`null`とカーソル(Upvoteの日時はエポックミリ秒)を確かめる
  - 同じく先に、開催中のマッチのユースケース(`LiveMatchReader`)で、開催中(マッチ中・集計中)の最も新しいマッチ、変化を待つ状態(集計中のマッチがある・キックオフ済みのローンチの予選マッチが未作成・開始の時刻を過ぎて未開始)、照会の時点の時刻、表示できないプロダクトと旧ハンドルの`null`を確かめる
  - `listLaunches(productIds, now)`・`listByLaunches(launchIds, now)`・`findMatches(matchIds, now)`に処理の時刻を渡し、ローンチの無いプロダクトは`get(id) ?? []`で受ける
  - 完了状態: 単体テストが成功し、APIサーバーの静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 3.1, 3.2, 3.3_
  - _Requirements: 8.2, 8.3, 8.5, 8.6, 8.7, 9.4, 9.5, 9.6, 10.1, 10.8, 10.9, 10.10, 13.4_

- [ ] 4. APIサーバーのGraphQL
- [x] 4.1 ディレクトリの一覧とカテゴリの選択肢の操作をスキーマモジュールに作る
  - 先に、Workers統合テストで、入力の全項目を文字列で受けて不正な値をエラーにせず正規化した条件(`applied`)を返すこと、項目のロゴ・カテゴリ・投稿者(表示できなければnull)・受賞・勝利・項目の値、検証の済まない外部WebサイトURLを空にすること、`category`による絞り込みと`applied`、カテゴリの選択肢の掲載数の多い順(同数は名称順・「その他」を末尾)、`client`以外の呼び出しの拒否を確かめる
  - apiの束縛のモジュール(ユースケース・供給元の読み取り)を作り、スキーマモジュールとともにapiの一覧へ加える(5.1・5.4は追記する)。利用者側の許可リストの再生成は6.1で行う
  - 完了状態: Workers統合テストが成功し、`directory`・`directoryCategories`をclientの呼び出し元で実行できる
  - _Depends: 2.3, 3.4_
  - _Requirements: 2.1, 2.6, 3.1, 3.2, 3.7, 4.1, 4.2, 5.1, 6.1, 6.2_

- [x] 4.2 プロダクト詳細ページ・開催中のマッチ・サポーターの一覧の操作を作る
  - 先に、Workers統合テストで、`productPage`の不在・未掲載の他者での`null`、本人の未掲載の表示、旧ハンドルの`ProductPageRedirect`、マッチ履歴の項目、`productLiveMatch`が開催中のマッチをmatch-engineの`loadMatchView`で`Match`として返し(閲覧者のUpvoteを含む)、`serverTime`と変化を待つ状態を返し、表示できないプロダクトで`null`を返すこと、`matchSupporters`が退会・停止を除きUpvoteの日時の順に20件ずつ返し21件目でカーソルが続くこと、`first`の範囲とIDの形式の`validation_error`・不正なカーソルを確かめる
  - 完了状態: Workers統合テストが成功し、3つの操作をclientの呼び出し元で実行できる
  - _Depends: 3.5, 4.1_
  - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 9.6, 10.2, 10.9, 10.10_

- [ ] 5. 索引の更新の処理
- [x] 5.1 退会・停止と論理削除・非公開化の確定と同じ書き込みで索引を消す同期の処理を作り、登録する
  - 先に、Workers統合テストで、product-launchの非公開化・削除の確定で索引文書が同じ一括の書き込みで消え、確定が失敗すれば削除も取り消されること、identity-authの退会・停止の確定で投稿者の全ての索引文書が消えることを確かめる
  - ユーザーとプロダクトの同期の処理の登録箇所へ追記する(読み取りをせず、集合の削除の文だけを返す。削除の文はbackend/007・012の「集合に対する更新・挿入・削除」の規約に従う)。利用者の削除の文は`event.userId`で作り、契約の戻り値に合わせて配列で返す
  - 登録口の中身を完全一致で比べる既存のテスト`apps/api/src/composition/product-lifecycle-sync-handlers.worker.test.ts`の期待値に本specの登録を加える
  - 完了状態: Workers統合テストと既存の登録口のテストが成功し、登録の検証を通る
  - _Depends: 2.5, 4.1_
  - _Requirements: 12.4, 12.5, 13.1_

- [x] 5.2 (P) eventの束縛を作り、予選の勝利の確定で掲載中のプロダクトを記録し索引を作るマッチイベントの処理を作る
  - eventのDIの識別子と束縛のモジュールを作り、eventの束縛の一覧へ加える(5.3は追記する)
  - application層はデータベースの接続・SQLの文・一括の書き込みを扱わず、`**/lib/workers/**`を型も含めて読み込めないため、更新待ちの書き込みの単位をポート`ProductIndexPendingMarker`(`application/directory/ports.ts`)として定義し、`SearchIndexStatements.markPending`の文を組み立てて1回の一括の書き込みで実行する実装`D1ProductIndexPendingMarker`をinfrastructure層に置く。記録のストアは`core/directory`、マッチの照会は`core/match`、更新の要求は`core/search`の型で受け取る
  - 先に、単体テスト(偽のポート)で勝った側だけを扱い紐付けの無い側を除くこと、`D1ProductIndexPendingMarker`のWorkers統合テストで索引文書の無いプロダクトに空の更新待ちの行を作り既存の行を更新待ちにし、複数のプロダクトを1回の一括の書き込みで書き、空の配列では書き込まないこと、処理のWorkers統合テストでmatch-engineの予選の結果の記録の処理(1100)の後に動いて記録と更新待ちができ、索引の更新の要求が送られることを確かめる
  - マッチイベントの登録箇所へ`order` 1200・予選の種別で追記する
  - 完了状態: Workers統合テストで、確定のイベントの処理の後に記録ができ、索引文書が更新待ちになり、更新の要求が送られる。イベントサーバーの型検査と静的解析が成功し、application層に`**/lib/workers/**`の読み込みが無い
  - _Boundary: QualifierListingHandler、ProductIndexPendingMarker、D1ProductIndexPendingMarker、eventの`composition/directory-module.ts`・`composition/modules.ts`・`composition/match-event-handlers.ts`_
  - _Depends: 2.5_
  - _Requirements: 1.5, 12.2, 13.1, 13.2_

- [x] 5.3 復元・停止の解除で索引を作り直し、物理削除で記録を消す非同期の処理を作る
  - 5.2のeventの束縛のモジュールへ追記するため、5.2の後に行う
  - 先に、単体テスト(偽のポート)で、復元で記録のあるプロダクトだけを更新待ちにすること、停止の解除で投稿者の記録を1回の実行で100件ずつ全件処理して完了すること、物理削除で記録と索引文書を消すことを確かめ、Workers統合テストでプロダクトの物理削除がproduct-launchの最後の削除で外部キーにより失敗しないことを確かめる
  - 更新待ちの書き込みは5.2の`ProductIndexPendingMarker`、記録の読み取りと物理削除は`core/directory`の`DirectoryEntryStore`の型で受け取り、application層で文と一括の書き込みを扱わない
  - プロダクトとユーザーの非同期の処理の登録箇所へ`order` 1200で追記する
  - 完了状態: テストと、各登録口の検証(同じ種類での`order`の重複の拒否)が成功し、application層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 5.2_
  - _Requirements: 12.6, 12.7, 12.8, 13.1_

- [x] 5.4 編集の確定と同じ書き込みで索引を更新待ちにする保存の登録を作る(仮4)
  - product-launchの仮11の`ProductSaveHook`(契約はapiの`infrastructure/product/product-save-hooks.ts`)を、apiの`infrastructure/directory/product-index-refresh-save-hook.ts`に実装する。`statementsFor({ productId, at }, db)`は勝利したプロダクトの記録があるときだけ`markPending('product', productId, at)`の文を返し、`afterCommit({ productId })`は同じ条件で更新を要求する。product-launchの`D1ProductStore`が文を一括の書き込みに加え、確定の後に`afterCommit`を呼ぶ。`PRODUCT_SAVE_HOOKS`(`apps/api/src/composition/product-save-hooks.ts`)へ`{ name: 'directory-discovery.product-index-refresh', hook }`を追記し、登録口の中身を完全一致で比べる既存のテスト`product-save-hooks.worker.test.ts`の期待値に加える
  - 先に、Workers統合テストで、掲載中のプロダクトの編集(次回の予約とローンチ日の変更を含む)と公開APIの説明文の更新で同じ書き込みに更新待ちが入り確定の後に更新の要求が送られること、新しい登録と未掲載のプロダクトでは文を返さず要求も送らないこと、保存の条件で取り消されると更新待ちも書かれないこと、要求の送信の失敗で保存が成功のまま索引文書が更新待ちに残ることを確かめる(復元と停止の解除は5.3の処理が扱う)
  - 完了状態: Workers統合テストが成功し、編集した名称で検索にかかる
  - _Depends: 2.5, 4.1_
  - _Requirements: 12.3, 12.8_

- [ ] 6. 利用者側の画面: ディレクトリ
- [x] 6.1 ディレクトリの操作の定義と区画の登録口を作り、許可リストを再生成する
  - GraphQLの操作(一覧・カテゴリの選択肢)の定義と型の生成、区画・一覧の差し込み・項目の値の登録の型と、初版は空の3つの登録の一覧を作る
  - 操作はclientの`src/graphql/operations/directory/`に1ファイル1操作の`.graphql`(操作名は`ClientDirectory`・`ClientDirectoryCategories`)で書き、`graphql()`を呼ばない。clientで`bun run graphql:generate`を実行して`src/graphql/generated/`を更新し、apiで`bun run graphql:allowlist`を実行して許可リストを再生成する。部品は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む
  - 完了状態: 型の生成と許可リストの再生成が成功し、`graphql:check`とclientの`codegen.unit.test.ts`(操作名の接頭辞)が成功し、clientの型検査で操作と登録口を読み込める
  - _Depends: 4.1_
  - _Requirements: 2.12, 7.10_

- [x] 6.2 (P) 検索欄と並び順の選択を作る
  - 先に、ブラウザテスト(`runAxe`の違反0件)で、検索欄のカウンター(41文字から)・50文字超のフォーカスアウトと送信でのエラーと送信の停止・Enterと検索のボタンでだけの実行・消去のボタン、並び順の4つの選択肢(少ない順が無いこと)と検索語が無いときの関連度の無効と併記を確かめる。部品は変更を呼び出し元のコールバックで知らせる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: SearchForm、SortSelect_
  - _Depends: 6.1_
  - _Requirements: 4.3, 4.4, 4.5, 5.1, 5.3, 5.6_

- [x] 6.3 (P) カテゴリの選択を作る
  - 先に、ブラウザテストで、「全て」を先頭にした選択肢の並び、文字入力の絞り込み、上下キーとEnterの操作、読み込み中の無効を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: CategoryPicker_
  - _Depends: 6.1_
  - _Requirements: 3.1, 7.3_

- [x] 6.4 (P) 期間のプリセットと期間の指定を作る
  - 先に、ブラウザテストで、5つのプリセットの範囲(基準時刻の今日から)、期間の指定の片方だけの適用・未来と逆順の文言と適用のボタンの無効化、プリセットに一致しない期間の表示を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: PeriodFilter、PeriodRangeForm_
  - _Depends: 6.1_
  - _Requirements: 3.3, 3.4, 3.5_

- [x] 6.5 横並びの絞り込み欄とモバイルの下部のシートを作る
  - 6.2〜6.4の部品を組み合わせるため、その後に行う
  - 先に、ブラウザテストで、768px以上では選んだ時点で反映し、768px未満ではシートで選んだ条件を「適用」でまとめて反映し、ボタンに変更中の項目の数が出ることを確かめる
  - 完了状態: ブラウザテストが成功する
  - _Depends: 6.2, 6.3, 6.4_
  - _Requirements: 3.9, 3.10_

- [x] 6.6 (P) 一覧の項目・勝利した予選マッチ・受賞バッジを作る
  - 先に、ブラウザテストで、項目全体のリンクと内側の操作の個別の操作、カテゴリの絞り込みのリンクが他の条件を保つこと、投稿者のリンク、本人の「あなたのプロダクト」と「編集」、「サイトを開く」の別タブと`rel="noopener"`、名称・タグラインの強調表示、勝利の3つの表示(票数・対戦相手がいないため・確定時点の票数)と今年のローンチ日の年の省略、受賞バッジ(Year先頭・回数・ツールチップ)、登録された項目の値だけの描画、3・2・1列の配置を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: DirectoryItem、WinSummary、AwardBadges_
  - _Depends: 6.1_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 4.6_

- [x] 6.7 (P) 件数・空の状態・スケルトン・ローンチ予約への導線を作る
  - 先に、ブラウザテストで、件数の2つの形と読み込み中、0件の2つの状態と条件ごとの解除と「条件をすべて解除」、範囲外の文言と全ページ数と「1ページ目へ」、スケルトンの形、導線の文言と未ログイン・ログイン中の行き先を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: ResultCount、DirectoryEmptyState、DirectoryListSkeleton、LaunchCta_
  - _Depends: 6.1_
  - _Requirements: 6.3, 6.6, 7.3, 7.6, 7.7, 7.8_

- [x] 6.8 (P) ページ分けの部品を作る
  - 先に、ブラウザテストで、768px以上の番号の並びと省略の規則(先頭・末尾・現在の前後1つ、1ページ分だけ空くときは省かない)、768px未満の「前へ」「5 / 62」「次へ」、現在のページの印、先頭と末尾のページでの前後のボタンの無効化を確かめる。部品はページの移動を呼び出し元のコールバックで知らせる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: DirectoryPagination_
  - _Depends: 6.1_
  - _Requirements: 6.4_

- [ ] 6.9 ディレクトリの画面の枠と、条件の変更・ページの移動のフックを作る
  - 画面の枠に見出し・6.5〜6.8の部品・区画の登録口(置き場所ごと・一覧の差し込み)を置き、条件の変更・ページの移動・フォーカスの移動のフックを作る。区画と差し込みは`RecoverableSlot`で包み、何も描かない区画の枠と間隔を残さず(frontend/013の目印と`display: contents`)、差し込みは`every`件ごと(割り切れるときは最後の項目の後にも)に何番目かの位置を渡す
  - 先に、ブラウザテストで、条件の変更で1ページ目に戻ること、ページの移動で一覧の先頭へスクロールし見出しへフォーカスが移ること(視差効果を減らす設定ではスクロールの演出なし)、再読み込み中に直前の一覧が操作を止めて残り進捗のバーが出ること、取得エラーで検索欄と絞り込み欄が残り再試行と問い合わせへの導線が出ること、演出が無いこと、区画の1つの失敗が一覧を止めないことを確かめる
  - 完了状態: ブラウザテストが成功する
  - _Depends: 6.5, 6.6, 6.7, 6.8_
  - _Requirements: 3.8, 6.5, 7.1, 7.4, 7.5, 7.9, 7.10_

- [ ] 6.10 `/p`のルートを作り、画面の枠とつなぐ
  - URLのクエリの正規化・サーバーでの初回の描画(一覧とカテゴリの選択肢)・ページのタイトルと正規のURL・サーバーが解決した条件(存在しないカテゴリなど)へのURLの置き換えを行う
  - 先に、ブラウザテストで、不正なクエリが既定の値へ置き換わること、サーバーの`applied`との食い違いでURLが置き換わることを確かめる
  - 完了状態: ブラウザテストが成功し、ローカルの`/p`がサーバーで描画される
  - _Requirements: 3.7, 7.2_

- [ ] 7. 利用者側の画面: プロダクト詳細ページ
- [ ] 7.1 詳細ページの操作の定義と区画の登録口を作り、許可リストを再生成する
  - GraphQLの操作(詳細ページ・開催中のマッチ・サポーターの一覧・フォロー中の照会・予約の可否の照会)の定義と型の生成、区画・ローンチの区画・投稿者本人向けの操作の登録の型と文脈(詳細ページの区画の文脈に自動更新の切り替えの状態`autoRefresh`と申告`reportAutoUpdating`を含む)、置き場所ごとの並べ替え、登録の一覧(本specの4件は7.8で加え、ローンチの区画と投稿者本人向けの操作は空)を作る
  - 操作はclientの`src/graphql/operations/directory/`に1ファイル1操作の`.graphql`(操作名は`ClientProductPage`・`ClientProductLiveMatch`・`ClientMatchSupporters`・`ClientOwnerFollowStatus`・`ClientProductOwnerStatus`)で書き、6.1と同じ手順で生成物と許可リストを更新する。`ClientProductLiveMatch`はmatch-engineのフラグメント`Match`を使い、`ClientOwnerFollowStatus`は`publicProfile`のunionを`... on PublicProfile { viewerRelation }`で読む
  - 取得の設定・loaderの補助・開催中のマッチの差し替えを`src/graphql/product-page.ts`に作り、単体テストで確かめる
  - 完了状態: 型の生成と許可リストの再生成が成功し、`graphql:check`とclientの`codegen.unit.test.ts`(操作名の接頭辞)と`product-page.ts`・並べ替えの単体テストが成功し、clientの型検査で操作と登録口を読み込める
  - _Depends: 4.2, 6.1_
  - _Requirements: 9.10, 10.14, 11.5_

- [ ] 7.2 (P) ヘッダー・パンくずリスト・未掲載の案内・フォロー・リンクのコピーを作る
  - 先に、ブラウザテストで、ヘッダーの各項目(カテゴリのリンク・受賞回数・投稿者のリンク・「サイトを開く」の`rel`・初ローンチ日・ローンチ回数・成績)、本人にフォローボタンが無いこと、フォロー中の照会の結果をボタンの初期状態に渡し照会の失敗でボタンを描かないこと、リンクのコピーの成功と失敗の通知、パンくずリスト、未掲載の案内の文言を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: ProductHeader、OwnerFollow、CopyLinkButton、ProductBreadcrumbs、UnlistedBanner_
  - _Depends: 7.1_
  - _Requirements: 9.3, 9.4, 9.5, 9.12_

- [ ] 7.3 (P) スクリーンショットのギャラリーとライトボックス、説明文を作る
  - 先に、ブラウザテストで、0枚で描かないこと、横スクロールの並び、ライトボックスの前後のボタン・左右キー・スワイプ・「3 / 10」・フォーカスの戻り、説明文の480pxの折りたたみと「続きを読む」と外部リンクの`rel="noopener"`を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: ScreenshotGallery、ScreenshotLightbox、ProductDescription_
  - _Depends: 7.1_
  - _Requirements: 9.7, 9.8_

- [ ] 7.4 (P) サポーターの一覧を作る
  - 先に、ブラウザテストで、高さを制限した枠の中の続きの読み込み(20件ずつ)、注記、行のアバター・ニックネームと公開プロフィールへのリンク、取得済みを保った失敗の表示と再試行を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: SupportersPanel_
  - _Depends: 7.1_
  - _Requirements: 10.9, 10.10, 10.11_

- [ ] 7.5 マッチ履歴の区画・ローンチのブロック・行・マッチが無いブロックを作る
  - 7.4のサポーターの一覧を行の中で開き、マッチが無いブロックの本人向けの導線で7.2のリンクのコピーの部品を再利用するため、7.2・7.4の後に行う
  - 先に、ブラウザテストで、区画の見出し「マッチ履歴とコメント」(一覧の項目のコメント数のリンク先の位置)とローンチのブロックの新しい順の並び、ブロックの見出しと要約、行の種別とラウンド・日付・対戦相手の4つの見え方・比率のバーと代替テキスト・スコア・勝敗、接戦の強調と注記、不戦勝と早期の不戦勝と両者敗北の表示、「サポーター◯人」の開閉(確定のUpvote数が0なら出さない)、マッチが無いブロックの開催中・キックオフ前の本人と他者の表示、登録されたローンチの区画への文脈の受け渡しと失敗の閉じ込めを確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: MatchHistorySection、LaunchBlock、MatchHistoryRow、EmptyMatches_
  - _Depends: 7.2, 7.4_
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.12, 10.13, 10.14_

- [ ] 7.6 (P) 投稿者本人向けの操作を作る
  - 枠は1.5のfrontend-libの`Card`で描き、枠線を`className`で破線にする
  - 先に、ブラウザテストで、本人だけに破線の枠で描くこと、進行状況の見出し・「編集」・「再ローンチを予約」、予約の禁止の理由と解除の日付、間隔の制限中の併記、固定の注記、照会の失敗の無効と文言、登録された操作の描画を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: OwnerCard_
  - _Depends: 1.5, 7.1_
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

- [ ] 7.7 (P) 開催中のマッチの区画と取り直しの判定を作る
  - frontend/013・010の規則に従う。区画は`ClientProductLiveMatch`を購読し、マッチがあるとき見出し・1.4で移した`FullTimeCountdown`・match-engineの対戦カード・`useUpvote`を描く。`refetchInterval`と`refetchOnWindowFocus`は`live-match-refresh.ts`の判定(オンでマッチ中か変化を待つ状態なら定期再取得の間隔、オフでは変化を待つ状態の間だけ`FOLLOW_UP_REFETCH_LIMIT`回まで)の関数にし、回数は`updateCountOf`と基準の差で数える。Upvoteの結果は開催中のマッチの取得の`match`だけを差し替え、マッチの確定(またはマッチが無くなったこと)で詳細ページの取得を無効にする。定期の取り直し・残り時間・演出を持つ間は文脈の`reportAutoUpdating`で申告する
  - 先に、取り直しの判定の単体テスト(オン・オフ、マッチ中・集計中・開始待ち、上限の回数、案内への切り替え)と、ブラウザテスト(013の「テスト」に従い`Date`・`setTimeout`・`clearTimeout`・`setInterval`・`clearInterval`を偽にし、`notifyManager.setScheduler(queueMicrotask)`で通知する)で、開催中のマッチがあるときだけ見出しと対戦カードと残り時間を描くこと、オフの後に間隔の数倍進めても定期の取得が無いこと、結果を待つ取り直しが上限まで続きオフの時だけ`role="status"`の文が案内に替わること、確定で詳細ページの取得が無効になること、Upvoteの結果の差し替え、申告の切り替えを確かめる
  - 完了状態: 単体テストとブラウザテストが成功する
  - _Boundary: LiveMatchSection、LiveMatchRefresh_
  - _Depends: 1.4, 7.1_
  - _Requirements: 9.6, 9.9_

- [ ] 7.8 詳細ページの枠とルートを組み立て、本specの区画を登録する
  - `/p/$handle`のルートで、ハンドルの形式の違反と`null`の404(トップページとディレクトリへの導線)、旧ハンドルの302(クエリを保つ)、タイトルと説明と正規のURL、未掲載の本人の表示での検索エンジンの登録の拒否、取得エラーの表示、スケルトンを作る。loaderは詳細ページの取得を待ち、開催中のマッチの取得は`prefetchQuery`で読んでその失敗でページを失敗にしない。ページの枠に7.2〜7.7の部品と区画の登録口を置き、区画と開催中のマッチの区画を`RecoverableSlot`で包み、何も描かない区画の枠と間隔を残さない(frontend/013の目印と`display: contents`)。本specの4つの区画を登録する
  - 自動更新(frontend/013の「自動更新の切り替え」): ページが切り替えの状態を`useState(true)`で持って区画の文脈へ渡し、根の要素に`data-auto-refresh`を付け、1.4で移した`AutoRefreshSwitch`を区画のエラーの境界の外に置く。描く条件はページ自身の値(開催中のマッチ・変化を待つ状態)か区画の申告で、区画が失敗・外れた時はその申告を消す。境界の取り直しはページが`useBoundaryRefresh`で、開催中のマッチの終了の時刻と予約済みのローンチの最も近いキックオフの時刻の直後に、開催中のマッチと詳細ページの取得を無効にする
  - bot判定: 開催中のマッチがあるときだけ開催中のマッチの区画をmatch-engineの`UpvoteBotProtection`で包む(内側に`match_upvote`の非表示のウィジェットが1つ描かれ、判定の失敗では文言を描く)
  - 先に、ブラウザテストで、2カラムと1カラムの配置とサイドバーの位置、開催中のマッチの有無による`UpvoteBotProtection`の有無、区画の順と1つの区画の失敗の閉じ込め、自動更新の切り替えの描く条件(ページ自身の値・区画の申告だけ・申告した区画の失敗・どれも無い)、境界の時刻の1秒後の取り直し、演出が開催中のマッチに限られ切り替えのオフと視差効果を減らす設定で止まることを確かめる
  - 完了状態: ブラウザテストが成功し、ローカルの`/p/<ハンドル>`がサーバーで描画される
  - _Depends: 7.2, 7.3, 7.5, 7.6, 7.7_
  - _Requirements: 8.1, 8.4, 8.7, 8.8, 8.9, 8.10, 9.1, 9.2, 9.9, 9.10, 9.11_

- [ ] 8. 文書
- [ ] 8.1 (P) 技術ドキュメントを書き、CLAUDE.mdから参照する
  - `db/007-latest-row-per-group-listing.md`・`frontend/014-url-state-listing.md`を設計のDirectoryTechDocsの内容で、本プロジェクト固有の値を含めずに書き、`db`・`frontend`のREADMEの文書一覧に行を加える
  - CLAUDE.mdの「技術規則の参照先」に「グループごとの最新の行で並べる一覧を作る前に: `db/007`」を、作った見出しへのリンクで加える
  - 完了状態: 文書とREADMEが整形の検査を通り、本プロジェクト名とサービス固有の仕様を含まず、CLAUDE.mdのリンクの見出しが実在する
  - _Boundary: `docs/GUIDES/tech/db/007-latest-row-per-group-listing.md`・`frontend/014-url-state-listing.md`・`db/README.md`・`frontend/README.md`・`CLAUDE.md`_
  - _Requirements: 14.4_

- [ ] 8.2 (P) オンボーディングに本specの固有の値を記録する
  - `docs/onboardings/project-values.md`に、処理の名前と`order`、検索対象の名前と重み、詳細ページの区画の`order`、保存の登録(仮4)の名前を加える
  - 完了状態: 文書が整形の検査を通り、5・7のタスクの登録の値と一致する
  - _Depends: 5.4, 7.8_
  - _Boundary: `docs/onboardings/project-values.md`_
  - _Requirements: 13.1, 14.5_

- [ ] 9. 検証
- [ ] 9.1 E2Eテストの補助を作る
  - `e2e/support/directory-fixtures.ts`: admin-foundationの`executeLocalD1`(文字列は`sqlStringLiteral`)と、足りる部分はmatch-engineの`e2e/client/match-steps.ts`の手順(`moveLaunchesToDate`・`startQualifiers`など。`e2e/support/match-fixtures.ts`は無い)で、指定した2つのローンチのマッチ中の予選(開始を記録済み、終了の日時を過去、一方の側にサポーターのUpvote)をローカルD1に作る補助を作る。確定のジョブは、backend-platformの改訂2の共有の補助`e2e/support/scheduled-trigger.ts`の`triggerScheduled({ worker: 'api', businessDate: <当日の業務日付>, businessTime: '23:40' })`で動かし、独自の定期実行の起動の補助を作らない。これにより確定のイベント・予選の結果の記録・本specの掲載と索引の処理が実際の経路で動く
  - 一覧とページの移動のための掲載中のプロダクト21件は、可視の投稿者の利用者の行・プロダクト・確定したマッチとローンチの結果を直接作る補助で作る(索引は持たず、検索の確認には使わない)
  - 索引の作成はローカルのeventのQueueの受け手(content-processingの更新の処理、キーワードの抽出はローカルの設定で無効)が行う。待ち条件は、ディレクトリの検索の結果に勝ったプロダクトが現れることとし、一定の間隔で再読み込みして上限の時間で失敗にする補助を作る
  - 完了状態: 補助を実行すると、勝ったプロダクトがローカルのディレクトリの一覧と検索に現れ、21件の掲載中のプロダクトで2ページ目ができる
  - _Depends: 5.2, 6.10_
  - _Requirements: 14.3_

- [ ] 9.2 E2Eテストでディレクトリと詳細ページの流れを確かめる
  - `e2e/client/directory.e2e.test.ts`: identity-authの`e2e/support/mailpit.ts`で確認済みの利用者を3人登録し(メールアドレスのドメインは`.example`)、2人がproduct-launchの登録画面でプロダクトを登録し、9.1の補助で作った予選を`triggerScheduled`で動かした23:40のジョブで確定させる。ディレクトリで勝ったプロダクトが表示されること、名称の検索・カテゴリの絞り込み・「Upvote数が多い順」・2ページ目への移動と`page`のクエリ、詳細ページのマッチ履歴とサポーターの一覧、敗けたプロダクトが他者には404で投稿者本人には未掲載の案内付きで見えること、プロダクトのハンドルを変えた後に旧ハンドルのURLが現在のURLへ転送されることを確かめる。Ultrasの機能フラグで結果が変わる表示は確かめない
  - 完了状態: ローカルでE2Eテストが成功する
  - _Depends: 7.8_
  - _Requirements: 14.3_

- [ ] 9.3 全体の検査とカバレッジを確かめ、運用の事項を報告する
  - 整形の検査・静的解析・型検査と、単体テスト・Workers統合テスト・ブラウザテストを一括で実行し、本specが追加・変更したファイルのカバレッジが80%以上であることを確かめる。ログとSentryへの送信に検索語・プロダクトの名称と説明文・利用者のハンドルが含まれないことを検索で確かめる
  - stagingでデプロイの前に勝利したプロダクトが編集・復元・停止の解除まで検索にかからない旨、roadmapの帯の割り当ての表の本specの「使用中の値」(波及処理は1200)を作業の報告に記録する
  - 完了状態: すべての検査とテストが成功し、カバレッジの結果が閾値を満たし、報告に運用の事項が載っている
  - _Requirements: 13.3, 14.1, 14.2_

## Implementation Notes

- 1.1: 規則は`apps/common-lib/directory/`(`directory-query-rules.ts`・`directory-period.ts`)、書記素の単位の切り詰め`truncateGraphemes`を`text/graphemes.ts`に加えた。`page`は数(URL)と10進の整数の形の文字列(GraphQLの`DirectoryInput.page: String`)の両方を受け、2以上の安全な整数だけを残す。`normalizeDirectoryQuery`は既定の項目も`undefined`で全6項目を返す。TanStack Routerの既定の解析で数になった`q`・`category`は文字列へ戻すが`1.50`→`1.5`のように形が変わり得るため、6.10で`parseSearch`の扱いを確かめる。`formatPeriodLabel`は同じ日なら1日だけ、両方無ければ「全期間」(設計に例が無く決めた)。「今年なら年を省く」書式はclientの`launch-date-format.ts`・apiの`product-errors.ts`と3箇所に重複(common-libからclientを読めないため)。`BusinessDateString`は`string`の別名で、型ガード`isBusinessDateString`と型`PeriodRange`・`CustomRangeErrors`を設計に加えて公開した
- 1.2: テーブルは`apps/db/schema/directory/`(`product_search_documents`・`directory_entries`)、索引の定義`PRODUCT_SEARCH_INDEX`は`schema/directory/product-search-index.ts`で`schema/index.ts`から再エクスポートせず`search/search-indexes.ts`が直接読む(2.1の検索対象も直接読む)。マイグレーションは`20261110153547_directory_discovery`(生成)と`20261110153549_directory_discovery_fts`(`apps/db`の`bun run --silent db:search-index-sql product_search_documents`の出力)。`directory_entries`は追加と削除だけだが設計と既存の先例(`match_events`など)に合わせて`timestamps()`を持ち、db/003の「共通カラムを持たないテーブル(`created_at`だけ)」と食い違う。`product_id`の一意は列の`.unique()`(自動の一意索引)
- 1.3: 6・7の画面の文言は`docs/GUIDES/service/design/003-text-and-copy-rules.md`、区画の置き場所・順は`002-page-layouts.md`を正とし、一字一句写す。設計・モックアップと違えて決めたもの: ページ送りの名前は「プロダクト一覧のページ送り」(設計は`aria-label="ページ"`、既存の文言規則の「一覧ごとに名前を決める」に従う)、日付は全て曜日なしの「9月15日」(今年でなければ年。モックアップは曜日付き、既存の`formatLaunchDate`に従う)、開催中のマッチの見出しは「Week 準決勝を戦っています」(match-engineの種別の印に合わせる)、スクリーンショットの代替テキストは「<名称>のスクリーンショット1枚目」、「受賞3回」はリンクにしない、`matchSupporters`のIDの形式違反は「マッチが見つからない」・`first`の範囲外はフォロー一覧の文言を流用、並び順だけ変えた0件は「条件なし」の0件の表示。置き場所の位置: ディレクトリはbanner=見出しの上・aside=一覧の横(1024px未満は下)・bottom=導線の下、詳細ページはbanner(全幅)→自動更新の切り替え→パンくずの順、投稿者本人向けの操作の登録口は進行状況の下・「編集」「再ローンチを予約」の上。ヘッダーの「ローンチ」の回数(キックオフ済みで取り消されていない)とマッチ履歴の件数のローンチの数(キックオフ前を含む取り消されていない全て)は数える対象が違う
- 1.4: 移した先は`apps/client/src/components/match/`(`auto-refresh-switch.tsx`・`auto-refresh-messages.ts`・`full-time-countdown.tsx`・`full-time-countdown-text.ts`・`follow-up-refetch.ts`)。7.7・7.8はここから読む。範囲外だが移動に伴い`e2e/client/match-steps.ts`の`AUTO_REFRESH_LABEL`の読み込みと`docs/onboardings/project-values.md`の取り直しの上限のパスを直した。match-engineのImplementation Notes(8.7・8.9・8.10)の旧パスは履歴として残した。`components/ultras/portal-return-rules.ts`に`QueryUpdateCounts`・`updateCountOf`と同じ定義の重複が以前からある(範囲外のため残した)
- 1.5: `Card`は`apps/frontend-lib/components/ui/card/`の7ファイル(shadcn/ui new-york v4の既定に`border-border`を加えた)。`CardTitle`は`<div>`で見出しの意味を持たないため、7.6の`OwnerCard`は中に見出しの要素を置き、区画にするときは`Card`に`role="region"`・`aria-labelledby`を渡す(005の使い方の表に記載)
- 2.1: 検索対象は`apps/backend-lib/workers/search/targets/product.ts`の`PRODUCT_SEARCH_TARGET`(名前`product`)。`read`は`D1ProductDirectory.findSummaries([id],'visible')`の`listed`(`visibleProducts() and wonLaunchExists()`)で判定し`findDetail`で説明文を読む(2回の読み取り。条件付きの書き込みが`isIndexable`を見直すため間の競合は無害)。キーワード抽出に送るのは説明文だけ。検索対象のテストはbackend-lib(apiで実行、eventのWorkers統合テストは`lib/**`を除くため)、Queueの経路の結合のテストはeventの`src/composition/search-module.product.worker.test.ts`(集約点を差し替えない)。apiの`search-module.worker.test.ts`の空の集約点の期待を`['product']`へ改めた。`docs/GUIDES/service/legal/003-privacy-policy-outline.md`は外部APIへ送るものを「プロダクト名・タグライン・説明文」と書くが実装と設計は説明文だけ(記載が広いだけで漏えいではない。external/002は一致を求めるため開発者の判断事項)
- 2.2: 契約は`apps/backend-lib/core/directory/ports.ts`(`DirectoryListingQuery`・`DirectoryEntryStore`(型のみ、D1の実装は2.5)、設計に加えて名前付きの型`DirectoryBaseWin`・`DirectoryListingPage`・`DirectoryEntry`)、識別子は`identifiers.ts`の`DIRECTORY_PLATFORM_TYPES`(`DirectoryListingQuery`・`DirectoryEntryStore`の2つ)、D1の実装は`workers/directory/d1-directory-listing.ts`。設計の`countByCategory`は中身の無い仮の実装を避けるため2.4で契約と実装に一緒に加える。期間の条件は設計の`?1 IS NULL OR …`ではなく指定があるときだけ足す(意味は同じ)。CTEの名前は`base_wins`、窓関数の列は`base_win_rank`。`relevance`は関連度が無い間は`newest`と同じ並びで、2.3は`orderOf`の`relevance`の先頭に`rank ASC`を足す。`categoryId`・`matchExpression`は2.2では受け取るだけ。テストの補助は`workers/directory/testing/directory-listing-fixtures.ts`(`clearDirectoryTables`は`directory_entries`を消してから`clearMatchTables`)。「復元」は非公開の解除として確かめた(product-launchに論理削除の取り消しが無い)。2.3か2.4で、予選の勝利の後にトーナメントで勝っても基準勝利が予選の勝利のままであることのテストを足す(要件1.8を直接確かめる)
- 2.3: 検索の結合は`ftsRankedSources(PRODUCT_SEARCH_INDEX, matchExpression)`の副問い合わせ(別名`product_search_matches`)を一覧と件数の両方に`$dynamic()`で内部結合する。D1の実装は検索式だけを受け、検索式は呼び出し側(3.4の`DirectoryReader`)がcommon-libの`normalizeSearchTerms`→`buildFtsMatchExpression`で作る。テストの補助`indexProduct`(`workers/directory/testing/directory-listing-fixtures.ts`)は2.1の検索対象の読み取りから実物の部品で索引文書を書く。検索のテストは`d1-directory-listing.search.worker.test.ts`
- 2.4: `countByCategory(): Promise<ReadonlyMap<string, number>>`を契約とD1の実装に加えた。掲載の無いカテゴリはMapに入らないため、3.4の`DirectoryCategoryReader`は`get(id) ?? 0`で受ける。掲載数は`qualifierWins()`を結合せず`visibleProducts() AND wonLaunchExists()`で数えるため、`outcome='won'`のローンチが必ず予選の勝利を持つ前提で一覧の総件数と一致する(テストで確認)。カテゴリの絞り込みは`listed`の条件に`productInCategory`を足し、一覧と件数の両方に掛かる
- 2.5: 記録のストアは`workers/directory/d1-directory-entry-store.ts`、投稿者の全ての索引文書を消す文は`workers/directory/product-index-removal-statements.ts`の`accountIndexRemovalStatement(userId)`(読み取りをせず`source_id IN (SELECT product_id FROM directory_entries WHERE owner_user_id = ?)`の1文、5.1が使う)、束縛は`workers/directory/directory-platform-module.ts`の`DIRECTORY_PLATFORM_MODULE`。設計との相違: (1) 主キーの`id`を作るため`PLATFORM_TYPES.IdGenerator`を注入する(設計のコンストラクタはDatabaseだけ。既存の`D1MatchScheduler`と同じ)。(2) `erase`は索引文書を`SearchIndexStatements.deleteSources`ではなくDrizzleで直接消す(検索の束縛への依存を避けるため。全文検索の索引は1.2の`AFTER DELETE`トリガーで消える。db/004の「削除」の節の書き方からは外れる)。`record`は15行ずつの挿入を1回の`db.batch`にまとめる(1行6変数)。eventの`MODULES`では既存の`match-module.worker.test.ts`の制約(`EVENT_MATCH_MODULE`は`EVENT_MATCH_PLATFORM_MODULE`の直後)のため`EVENT_MATCH_MODULE`の後、apiでは`API_MATCH_PLATFORM_MODULE`の直後に置いた。テストの補助は`testing/directory-entry-fixtures.ts`(`createStatementRecordingDatabase`)・`testing/directory-platform-fixtures.ts`
- 3.1: 規則は`apps/api/src/domain/directory/product-page-access.ts`の`decideProductPageAccess({ resolution, viewerUserId })`(`not-found`・`redirect`・`render`(`productId`・`ownerView`・`unlisted`))と`base-win.ts`の`classifyBaseWin(match, launchId)`。設計が決めていない振る舞い: マッチが`undefined`か自分の側が無いときは`victory`(物理削除との競合だけで起き、3.4の可視でない行の除外で落ちる。3.4で`warn`を残すかを検討する)、自分の側の`result`が`lost`・`null`なら`RangeError`(上流の不変条件の破れ。Error Handlingの「部分的な一覧を出さない」に合う)。ハンドルの形式の検査(8.7)は3.5の`ProductPageReader.read`で行う
- 3.2: 規則は`apps/api/src/domain/directory/match-history.ts`の`toHistoryRows`・`summarizeRecord`(戻り値の型`MatchRecordSummary`)と、設計に加えた`isKickedOff`(status `in_progress`・`finished`。3.5の`kickedOff`はこれを使う)。自分の側はプロダクトIDで選ぶ(設計の本文は`entryId`だが契約の入力は`productId`で意味は同じ)。同じ日のマッチは`decidedAt`の新しい順。自分の側が無いマッチは飛ばし、確定のマッチの`result`・`decision`が無ければ`RangeError`。勝ち数は上流の`isWinningResult`で、予選とトーナメントを区別しない。3.5への申し送り: `HistoryRow`は`launchId`を持たないため、取消のローンチのマッチの除外は3.5が取消を除いたローンチのIDだけで`listByLaunches`を呼ぶことに頼る(テストで確かめる)。ローンチごとのブロックは3.5でマッチをローンチごとに分けてから`toHistoryRows`を呼ぶ
- 3.3: apiのDIの識別子は`apps/api/src/application/directory/directory-types.ts`の`DIRECTORY_TYPES`(3.3は`LaunchHighlightsReader`・`ItemMetricSources`・`ItemMetricsReader`)。読み取りは`SourcedLaunchHighlightsReader`(product-launchが束縛済みの`PRODUCT_TYPES.LaunchSummarySources`を注入)と`SourcedItemMetricsReader`(20件超は`RangeError`)、項目の値の登録口は`apps/api/src/composition/directory-item-metric-sources.ts`の`DIRECTORY_ITEM_METRIC_SOURCES`(空、`key`はkebab-caseで一意)。DIの束縛は4.1で行い、`ItemMetricSources`は`resolveItemMetricSources(DIRECTORY_ITEM_METRIC_SOURCES, …)`の`toDynamicValue`で束縛する。product-launchの`application/product/decision-sources.ts`に、`launch-history-reader.ts`の私的な`pickSummaries`を`pickLaunchSummaries`として移し、`assertDecisionSourceRegistrations`に任意の`sourceLabel`を加えた(振る舞いは不変)。設計との相違: 型に名前を付けた(`LaunchHighlights`・`ItemMetric`・`RegisteredItemMetricSource`)、供給元の失敗のログは共有の`callDecisionSources`を使うためカテゴリが`['api','application','product']`で供給元の名前だけ(設計のMonitoringは`['api','application','directory']`と名前・プロダクトの数。013の「名前だけを残す」に従う)。3.4・3.5への申し送り: `LaunchHighlightsReader`は件数の上限を持たないため、呼び出し側が取消のローンチを除きページの範囲の件数で呼び、テストで確かめる
- 3.4: ユースケースは`application/directory/directory-reader.ts`の`ListingDirectoryReader`と`directory-category-reader.ts`の`CountedDirectoryCategoryReader`、識別子は`DIRECTORY_TYPES.DirectoryReader`・`DirectoryCategoryReader`(束縛は4.1)。`applied.category`は解決したカテゴリの保存済みのハンドル(小文字)で、6.10のURLの置き換えはこれに合わせる。`pageCount`は`ceil(totalCount/20)`で0件なら0。`baseWin.launchDate`は一覧の行の`matchDate`(予選は`launchDate`の日に組まれるため同じ)。基準勝利のローンチのマッチのうち`kind==='qualifier'`を使う。予選のマッチが見つからない行は`classifyBaseWin`が`victory`に縮退し、`['api','application','directory']`の`warn`(`count`・`productIds`だけ)を残す。カテゴリの名称順は`Intl.Collator('ja')`(同名はID)、「その他」は`PRODUCT_CATEGORY_OTHER_ID`で末尾。検索語がNFKCの後で空になれば`q`を外して正規化し直す
- 3.5: ユースケースは`application/directory/`の`DirectoryProductPageReader`(`product-page-reader.ts`)・`DirectoryLiveMatchReader`(`live-match-reader.ts`)・`DirectorySupporterListReader`(`supporter-list-reader.ts`)、識別子は`DIRECTORY_TYPES.ProductPageReader`・`LiveMatchReader`・`SupporterListReader`(束縛は4.1・4.2)。3つは設計に加えた共有の判定`product-page-resolution.ts`(ハンドルの形式→`resolveHandle`→`decideProductPageAccess`)を使う。設計との相違: (1) サポーターの一覧のカーソルは文字列ではなく構造の値`SupporterListPosition { upvotedAt(エポックミリ秒), upvoteId }`(application層からpresentationの`encodeCursor`を読めないため。フォロー一覧の`FollowListPosition`と同じ形)で、4.2のresolverが`encodeCursor`・`decodeCursor`と`invalid_cursor`を扱う。(2) サポーターの一覧の入力に`now`を加えた(`findMatches`に要る)。(3) `listSupporters`の上限が20のため、満杯なら`limit: 1`の照会を1回足して続きを判定する。変化を待つ状態の「開始の時刻を過ぎて未開始」は`phase==='scheduled' && startsAt<=now`(match-engineの非公開の`hasPendingKickoff`と同じ集合、全種別)、「予選マッチが未作成」は`in_progress`のローンチに予選が無いこと。開催中のマッチの「最も新しい」は`startsAt`の降順・同値は`matchId`
- 4.1: スキーマモジュールは`apps/api/src/presentation/graphql/modules/directory/`(設計に加えて`mappers.ts`・`resolver-support.ts`、`inputs.ts`は検証する引数が無いため作らず4.2の`matchSupporters`で作る)、束縛は`apps/api/src/composition/directory-module.ts`の`DIRECTORY_MODULE`(`MODULES`の`API_MATCH_MODULE`の後、4.2・5.1・5.4が追記)、`directorySchemaModule`は`GRAPHQL_SCHEMA_MODULES`の`matchSchemaModule`の後。`DirectoryInput`は検証せず`read({ raw: input })`へそのまま渡す。外部WebサイトURLはmapperの`verifiedWebsiteUrl`で`checkExternalUrl`に通し、不合格なら空文字。`client`以外は`clientOnly`で`forbidden`。既存の型`ProductCategory`・`MediaImage`・`UserSummary`・`ProductAward`と`productCategoryOf`・`productImageOf`・`userSummaryLoader`を再利用。テストの補助は`apps/api/test/support/directory-graphql-operations.ts`。`docs/onboardings/project-values.md`のmatchの行の「`GRAPHQL_SCHEMA_MODULES`の末尾」を「`product`の後」に改めた(directoryの行は8.2で加える)
- 4.2: resolverは`modules/directory/`の`product-page-resolvers.ts`・`live-match-resolvers.ts`・`supporter-resolvers.ts`、変換は`product-page-mappers.ts`、検証は`inputs.ts`(`first` 1〜20・ULID・カーソル256文字以下。`ULID_PATTERN`等は`profile/follow-inputs.ts`と同じ形で重複)。`productLiveMatch.match`は`loadMatchView(context, matchId)`。サポーターのカーソルは`encodeCursor({ upvotedAt, upvoteId })`(フォロー一覧は`{ t, id }`)。`ProductPage.owner`は`UserSummary!`のため、照会と応答の間に投稿者が退会・停止すると`productPage`がエラー付きの`null`になる(部分的なページを出さない)。対戦相手の`handle`はLISTEDだけ返す。深さの上限8の注意(6.x・7.1): `productLiveMatch { match { ...Match } }`は既存の`ClientQualifierBoard`と同じ深さで動くが、`productPage`の対戦相手のロゴはインラインフラグメントを含めて7段のため、`ClientProductPage`でこの下に名前付きのフラグメントを入れ子にすると上限を超える。テストの補助は`apps/api/test/support/directory-product-page-documents.ts`、`match-graphql-operations.ts`の`MATCH_SELECTION`をexportした
- 5.1: 同期の処理は`apps/api/src/infrastructure/directory/`の`ProductIndexRemovalSyncHandler`(`hidden`・`deleted`、`SearchIndexStatements.deleteSources(PRODUCT_SEARCH_TARGET.name, [productId])`)と`AccountIndexRemovalSyncHandler`(`withdrawn`・`suspended`、`[accountIndexRemovalStatement(db, event.userId)]`)、登録名は`directory-discovery.product-index-removal`・`directory-discovery.account-index-removal`、識別子と束縛は`DIRECTORY_TYPES`・`DIRECTORY_MODULE`。プロダクト側は契約の引数の`db`ではなく注入した`SEARCH_TYPES.IndexStatements`(処理単位の同じ`PLATFORM_TYPES.Database`を包む)の文を返すため、確定の部品が別の接続を使う作りに変わると前提が崩れる。ユーザー側の登録口`USER_LIFECYCLE_SYNC_HANDLERS`には中身を完全一致で比べるテストが無い。`accountIndexRemovalStatement`の引数は2.5のとおり`(db, ownerUserId)`
- 5.2: 処理は`apps/event/src/application/directory/qualifier-listing-handler.ts`の`QualifierListingHandler`(登録`directory-discovery.qualifier-listing`、decided・qualifier・1200)、ポートは`application/directory/ports.ts`の`ProductIndexPendingMarker`(と`PRODUCT_SEARCH_TARGET_NAME='product'`の複製。application層は検索対象の定義を読めないため、一致をWorkers統合テストで確認)、実装は`infrastructure/directory/d1-product-index-pending-marker.ts`(100件超は`RangeError`、空なら書かない。5.3は100件ずつ渡す)、識別子は`application/directory/event-directory-types.ts`(`directory.event.<名前>`)、束縛は`composition/directory-module.ts`の`EVENT_DIRECTORY_MODULE`(`MODULES`の`DIRECTORY_PLATFORM_MODULE`の直後、5.3が追記)。処理は掲載中かを判定せず勝った側(`isWinningResult`・`productId`と`ownerUserId`あり)を全て記録し、掲載の判定は索引の更新の`PRODUCT_SEARCH_TARGET.read`に任せる(設計どおり。確定の時点で非公開の勝者も記録しておくので5.3の復元で作り直せる)。記録の日時は`match.decidedAt`、更新待ちの日時は処理の時刻。ログのカテゴリは`['event','application','directory']`(設計のevent節は`['event','directory']`、Monitoringは前者で表記が揺れている)。範囲外の変更: match-engineの`match-module.worker.test.ts`の登録の完全一致に1200を加え、`match-module.qualifier-outcome.worker.test.ts`の完了の検査を1100の処理だけに絞り、同ファイルと`match-module.decision-follow-up.worker.test.ts`の`beforeEach`で`clearDirectoryTables()`を呼ぶ(`directory_entries`の外部キーでプロダクトを消せないため)
- 5.3: 処理は`apps/event/src/application/directory/`の`ProductIndexRestoreHandler`(`directory-discovery.product-index-restore`、`unhidden`)・`EntryErasureHandler`(`directory-discovery.entry-erasure`、`purge_due`)・`AccountIndexRestoreHandler`(`directory-discovery.account-index-restore`、`unsuspended`)、全て1200。停止の解除は`listProductIdsByOwner`を100件(5.2の`MAX_PRODUCTS_PER_PENDING_MARK`)ずつ最後のIDをカーソルに1回の実行で全件処理して`done`を返す(設計どおり。プロダクト1件ごとに`requestRefresh`を送る)。物理削除は実行器が全ての処理の`done`の後でプロダクトの行を消すため、記録が先に消える(外部キーの失敗をWorkers統合テストで再現・確認)。利用者の物理削除はproduct-launchの`product-erasure`(1000)がプロダクトごとの`purge_due`を作るため別の登録は要らない。3つの処理はログを出さない。範囲外の変更: 他specの登録口の完全一致のテスト3件(match-engine `match-module.purge.worker.test.ts`・user-profile-social `profile-module.worker.test.ts`・product-launch `product-module.worker.test.ts`)に登録名を加えた
- 5.4: 保存の登録は`apps/api/src/infrastructure/directory/product-index-refresh-save-hook.ts`の`ProductIndexRefreshSaveHook`(登録`directory-discovery.product-index-refresh`、識別子`DIRECTORY_TYPES.ProductIndexRefreshSaveHook`)。記録の有無は`statementsFor`と`afterCommit`の両方で`DirectoryEntryStore.exists`を読んで判定する(契約が読み取りを許し、設計も`exists`を使う。保存1回ごとに読み取りが2回増える)。文は5.1と同じく注入した`SEARCH_TYPES.IndexStatements`で作る。公開APIの説明文の更新の経路(presentation)はまだ無いため、`ProductDescriptionEditor`が呼ぶ`D1ProductStore.updateDescription`で確かめた(public-apiの実装時に経路のテストを足す)。記録のある非公開のプロダクトの編集でも更新待ちが入る(索引の更新の処理が消す)
- 6.1: 操作は`apps/client/src/graphql/operations/directory/directory.graphql`(`ClientDirectory`、4.1のスキーマの全フィールド)・`directory-categories.graphql`(`ClientDirectoryCategories`、`id`・`name`・`handle`だけ)。画像は`MediaImage`のフラグメントが無いためインライン(`ClientLaunchHistory`と同じ)。登録の型は`components/directory/directory-section-types.ts`、空の登録は`composition/directory-sections.ts`(`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`・`DIRECTORY_ITEM_METRICS`)、登録口の検証は単体テスト`components/directory/directory-sections.unit.test.ts`(部品を登録して要ブラウザになればブラウザテストへ移す)。6.9で置き場所の並びの定数が要るなら`TOP_PAGE_PLACEMENTS`の先例に倣ってexportし、テストの`PLACEMENTS`をそれに置き換える
- 6.2: 部品は`components/directory/`の`SearchForm`(`search-form.tsx`、`useState`の`<form role="search">`。React Hook Formの`SubmitButton`はエラー時に押せなくなるため使わず、管理画面の`audit-log-filters.tsx`を先例にした)・`SortSelect`(`sort-select.tsx`、`DropdownMenu`のラジオの項目)と、選択欄の見た目の共通の部品`FilterTrigger`(`filter-trigger.tsx`、`label`・`value`と`Button`のprops。6.3・6.4・6.5はこれを`DropdownMenuTrigger`・`PopoverTrigger`の`asChild`の子として再利用する)。文言は部品ごとの`search-form-messages.ts`・`sort-select-messages.ts`(`SORT_LABELS`・`SORT_SELECT_LABEL`・`RELEVANCE_UNAVAILABLE_REASON`は6.5の`FilterSheet`から読める)。消去のボタンは適用中の語があれば`onSearch(undefined)`(モックアップどおり)。開発者の判断事項: 検索欄のカウンターは設計どおり`aria-live="polite"`で41文字目から入力のたびに読み上げるが、既存の`MarkdownLengthCounter`は上限の超過と戻りだけを読み上げ、表示も「45 / 50」と「45/50」で違う。設計の`SearchForm`は「`withConditions`で遷移する」と書くが、部品はコールバックで知らせ、遷移は6.9のフックが行う
- 6.3: 部品は`components/directory/`の`CategoryPicker`(`category-picker.tsx`、`Popover modal`・`FilterTrigger`、`loading`のpropsで「読み込み中…」と無効)と`CategoryListbox`(`category-listbox.tsx`、入力欄と`role="combobox"`・`aria-activedescendant`の選択肢の一覧。6.5の`FilterSheet`は`value`・`onSelect`で下書きを渡して再利用する。型`DirectoryCategoryOption`もここ)。frontend-libに`Command`(cmdk)等の絞り込みのできるコンボボックスが無く、パッケージの追加を避けてモックアップに倣って自作した。モックアップとの相違: 0件の文言をlistboxの中に置くとaxeの`aria-required-children`(critical)になるためlistboxを描かず`<p>`で示す、絞り込みの正規化はNFKC・小文字・trimで発音区別符号は外さない(日本語の濁点まで外れるため)。カテゴリの取得の失敗時の振る舞いは6.9で決める。モックアップの`FilterTrigger`の既定値から変えたときの強調(`active`)は6.2の`FilterTrigger`に無く、6.5で揃えるかを判断する
- 6.4: 部品は`components/directory/`の`PeriodFilter`(`period-filter.tsx`、`DropdownMenu`のラジオと「期間を指定…」の`PopoverAnchor`のモーダルの`Popover`)・`PeriodRangeForm`(`period-range-form.tsx`、制御された`value`/`onChange`、`onApply`/`onCancel`は任意で6.5の`FilterSheet`は下書きで使う)・`PeriodLabel`(`period-label.tsx`、プリセットに一致しない期間の両端を`<time dateTime="YYYY-MM-DD">`で描く。001「日時の表示」のため。6.5・6.7の空の状態の「期間「…」を解除」でも使う)、下書きの補助は`period-range-draft.ts`、文言は`period-filter-messages.ts`(`periodDisplayLabel`は現在どこからも使われず、6.5・6.7・6.9で文字列の名前が要れば使い、要らなければ消す)。6.2の`FilterTrigger.value`を`ReactNode`へ広げた(ボタンの`value`属性と衝突するため`Omit`に`'value'`を加えた)。日付の入力は設計の`type="date"`と管理画面の`audit-log-filters.tsx`の先例(012の`Calendar`はサーバーが返す範囲を選ばせる画面向けで対象外)。`onChange`は常に`from`・`to`の両端を持つ(空は`undefined`、`withConditions`のスプレッドで既存の期間を消すため)。004との相違: 一度離れた欄を入力し直す間は文言と`aria-invalid`を欄を離れるまで消す(日付の欄は区画ごとの途中の値が未来・逆順になり得るため、要件3.5のフォーカスアウト時の表示を優先。004の`onTouched`は以降は入力のたびに検証する)
- 6.5: 部品は`components/directory/`の`FilterToolbar`(`filter-toolbar.tsx`、768px以上は`hidden md:flex`で3つの選択欄、768px未満は`md:hidden`で`FilterSheet`を持つ。検索欄は含めず6.9の`DirectoryPage`が置く)と`FilterSheet`(`filter-sheet.tsx`、`Sheet side="bottom"`)、下書きと変更の型は`filter-sheet-draft.ts`(`DirectoryFilterPatch`は`category`・`from`・`to`・`sort`の部分集合で、6.9は`withConditions(query, patch)`で使う)。出し分けはCSSのブレークポイント(`site-mobile-menu.tsx`の先例、SSRの不一致を避ける)。`FilterTrigger`に任意の`active`(モックアップの`border-primary/60 bg-primary/5`)を足し3つの選択欄で使う。モックアップとの相違: 並び順も既定から変えたら強調する(ボタンの数`changedConditionCount`と揃える。モックアップは常に`active={false}`)、何も変えずに「適用」を押すと知らせずに閉じる(モックアップは毎回知らせ、1ページ目へ戻る)。開発者の判断事項: シートを開くと004の規則どおり最初の操作(カテゴリの絞り込みの入力欄)へフォーカスが移り、モバイルではソフトウェアキーボードがシートの下半分を覆い得る(`onOpenAutoFocus`で見出しへ移すなら004との相違になる)。シートを開いたまま768px以上へ広げると閉じた時のフォーカスの戻り先が`display:none`になる
- 6.6: 部品は`components/directory/`の`DirectoryItem`(`directory-item.tsx`、`<article aria-labelledby>`。名称のリンクを`after:absolute after:inset-0`で項目全体に広げ、内側の操作を`relative z-10`で上に置く。1.5の`Card`は`<div>`のため使わない)・`WinSummary`(`win-summary.tsx`)・`AwardBadges`(`award-badges.tsx`、product-launchの`toProductAwardView`→`AwardBadgeList`)、カテゴリのリンクのURLは`directory-href.ts`の`directoryHref`(`withConditions`でカテゴリだけ変え、ルーターの`defaultStringifySearch`。`/p`のルートは6.10のため型付きの`Link`ではなくパスで指す)。カテゴリのリンクは`unmarked-path-link.tsx`の`UnmarkedPathLink`(`createLink`で`aria-current`・`data-status`を外す。TanStack Routerの`activeOptions`では`exact`でも1ページ目に`aria-current="page"`が付くため。`createLink`の初めての使用で、frontend-libの`PathLink`に一般化するかは別の判断)。「予選勝利」は`<h4>`(名称は`<h3>`、6.9の一覧の見出しは`<h2>`)。「Upvote数」は確定時点の票数の前にも`sr-only`で付ける(モックアップには無い)。2列は`md`(768px、要件2.13。モックアップは`sm`)。項目の値の部品は`RecoverableSlot`で包まない(設計は区画にだけ求め、値は数を受けるだけ)。6.9への申し送り: `DirectoryItem`は`<article>`だけを描くので一覧が`<li>`で包み、`metricRegistrations={DIRECTORY_ITEM_METRICS}`・`searchTerms={directory.searchTerms}`を渡す。`renderInRouter`を使うブラウザテストは`lib/start/graphql/execute-graphql.ts`の`vi.mock`が要る(無いと`@tanstack/start-server-core`の解決で読み込みに失敗する)
- 6.7: 部品は`components/directory/`の`ResultCount`(`result-count.tsx`、`aria-live="polite"`。範囲外のページでは`first > last`になるため6.9は範囲外で描かない)・`DirectoryEmptyState`(`directory-empty-state.tsx`、`noResults`と`outOfRange`の2種。条件の解除は`directoryHref(withConditions(...))`の`UnmarkedPathLink`のリンク。frontend-libの`EmptyState`の`headingLevel={3}`でモックアップの飾りのアイコンは無い)・`DirectoryListSkeleton`(`directory-list-skeleton.tsx`、`Skeleton`が`data-slot="skeleton"`を自分で付けるため形の目印は`data-skeleton`属性)・`LaunchCta`(`launch-cta.tsx`、`<h2>`)。`signedIn`はpropsで受ける(6.9が`viewer !== null`を渡す)。範囲外の変更: トップページの私的な`ReserveLaunchLink`を`components/product/reserve-launch-link.tsx`へ共通化し(`signedIn`・`size`・`className`)、文言を`launch-messages.ts`の`RESERVE_LAUNCH_LABEL`・`RESERVE_LAUNCH_GUEST_LABEL`へ移し、`top/qualifier-section-messages.ts`の`EMPTY_LINEUP_ACTION`・`EMPTY_LINEUP_GUEST_ACTION`を消した(トップページの振る舞いは不変)。6.9への申し送り: 空の状態は一覧の見えない`<h2>プロダクト一覧`の下の`<h3>`の前提、`LaunchCta`はモックアップでは一覧の`<section>`の中にあり置き場所を決める。`periodDisplayLabel`はまだ使われていない
- 6.8: 部品は`components/directory/directory-pagination.tsx`の`DirectoryPagination`(現在のクエリ`DirectoryQuery`を受け、番号・「前へ」「次へ」を`<a href>`のリンクにする)、省略の規則は`directory-pagination-items.ts`の純粋な関数、URLは`directory-href.ts`に加えた`directoryPageHref(query, page)`(1ページ目は`page`を外す)。親の判断: タスクの本文の「前後のボタン」「コールバックで知らせる」と先例の`PageNavigation`(ボタン)より、004「移動するものは`<a href>`」・モックアップの`Link`・サーバーで描画する公開の一覧(ハイドレーション前・新しいタブ・クローラー)を優先してリンクにした。`onNavigate(page)`は任意で、修飾キーの無い左クリックで別のページへ移るときだけ呼ぶ(6.9がスクロール・フォーカスに使える)。先頭・末尾の無効の「前へ」「次へ」はリンクにせず`disabled`のボタン(`aria-disabled`のリンクはEnterで移動するため。6.9がページの移動の後に見出しへフォーカスを移すのでフォーカスを保つ必要は無い)。6.6の`UnmarkedPathLink`に任意の`current`を足した(ルーターの`aria-current`は常に外し、`current`のときだけ`aria-current="page"`)。文言規則の変更: 003の「ディレクトリのページ送り」の「前へ」「次へ」の名前を「前のページ」「次のページ」から見えている文言と同じ「前へ」「次へ」に改めた(WCAG 2.5.3、axeの`label-content-name-mismatch`。frontend-libの`PageNavigation`とも同じ)。ナビゲーションの名前は1.3の決定の「プロダクト一覧のページ送り」(設計は`aria-label="ページ"`)。6.9への申し送り: 範囲外のページでは本部品を描かず空の状態にする、再読み込み中の操作の停止は一覧の側で行う(`settled`のpropsは無い)、`DisplayPreferencesProvider`の内側に置く
