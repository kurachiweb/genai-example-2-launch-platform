# Implementation Plan

- [x] 1. 基盤: テーブル・初期データ・共有の定義
- [x] 1.1 法務文書の2テーブルを定義し、マイグレーションと3文書の初期データを作る
  - 前提: backend-platform・api-gateway・frontend-platform・infra-delivery・content-processing・identity-auth・admin-foundationの全タスクが完了していること(層構成・GraphQL基盤・画面の骨格・共有ディレクトリ`apps/common-lib`・マークダウンの部品・管理者の認可と管理画面のシェル)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、各テーブルの列の型・NOT NULL・既定値・種類のCHECK制約と一意索引・版の`(文書, 版番号)`の一意索引・`(文書, 公開日時)`の索引・管理者のIDの列に外部キーが無いことを確かめる単体テストを書く
  - 文書は種類・状態の版・最新の版番号・下書き(本文・保存日時・保存した管理者のID)を持ち、版は文書への外部キー・版番号・本文・変更概要・公開日時(ミリ秒)・公開した管理者のIDを持つ
  - スキーマの集約点に加え、mainの最新を取り込んでからマイグレーションを生成し、続けて空のカスタムマイグレーションに3つの種類の行を固定のULIDで重複を無視して挿入する文を書く。衝突したら生成し直す
  - 初期データのカスタムマイグレーションの生成で、スナップショットが作られるか、作られる場合に直前のマイグレーションのスナップショットと同じ内容か(次の`drizzle-kit generate`が余計な差分を出さないか)を確かめ、7.3で技術ドキュメントに書くために結果を記録する
  - 完了状態: 列の単体テストが成功し、2つのマイグレーションをローカルに適用でき、適用後のデータベースに版と下書きの無い3文書の行があり、同じ種類の行を追加できない。初期データのマイグレーションとスナップショットの関係の確認の結果が記録されている
  - _Requirements: 1.1, 1.3, 1.5, 1.6_

- [x] 1.2 (P) 種類・名前・利用者側のパス・入力規則を、4アプリが共有するディレクトリに作る
  - 先に、3種類の名前とパス、過去版のパスの組み立て、版番号の解析(`1`と9桁は数値、`0`・先頭の0・符号・小数・文字・10桁は不正)、変更概要の前後の空白の除去と200・201書記素(絵文字・結合文字の境界)・改行・禁止文字・空の判定の順と文言、本文の100,000・100,001書記素と空の文言を確かめる単体テストを書く
  - 種類の値と表示順・名前・利用者側のパス・外部リンクの`rel`(`noopener`)と、本文と変更概要の上限・判定・文言・フロントとAPIで共用する検証規則を作る。書記素の数え方・禁止文字の判定・マークダウンの検証規則はcontent-processingの共有の部品を使う
  - 完了状態: 単体テストが成功し、利用者側・管理者側・APIサーバーの型検査で配置先から読み込める
  - _Boundary: LegalDocuments, LegalInputRules_
  - _Requirements: 3.4, 4.2, 7.1, 7.4, 9.1_

- [x] 2. ドメインの規則と永続化
- [x] 2.1 遷移の可否・次の版番号・公開日時の規則を作る
  - 先に、保存の可否(状態の版の不一致)、破棄の可否(不一致・下書きなし)、公開の可否の判定の順(不一致→下書きなし→最新版と本文が完全に一致)、未公開のときの次の版番号1、公開日時が現在時刻と最新版の公開日時+1ミリ秒の大きい方になること(時計が戻った場合を含む)を確かめる単体テストを書く
  - 文書の状態(種類・状態の版・最新版の版番号と本文と公開日時・下書き)の型と、上の判定を純粋な関数として作る
  - 完了状態: 単体テストが成功し、判定がデータベースや時計に依存せずに動く
  - _Requirements: 3.10, 4.3, 4.4, 8.1_

- [x] 2.2 文書の状態の読み取りと条件付きの書き込みを行うストアを作る
  - 先に、Workers統合テストで、初期データの3行の状態、保存・破棄・公開のたびの状態の版の増加、古い状態の版での保存・破棄・公開が競合を返して何も変えないこと、公開で版番号が連番になり本文が下書きから写されて下書きが消えること、同じ状態の版で2回続けて公開すると1回だけ成功すること、改訂履歴が版番号の降順で本文を含まないこと、日時による版の特定の境界(同じミリ秒を含む・最初の版より前は無し)を確かめる
  - ストアのポートと、D1の実装を作る。保存・破棄は状態の版を条件にした1文の更新、公開は条件付きの版の挿入(本文と版番号を文書の行から取る)と文書の行の更新の一括の書き込みとし、版の行を更新・削除する文を持たない
  - 完了状態: Workers統合テストが成功し、古い状態の版の書き込みでデータベースの内容が変わらないことを確かめられる
  - _Depends: 1.1_
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 3.3, 3.6, 3.10, 4.1, 4.4, 8.1, 8.2, 8.3, 10.3_

- [x] 3. ユースケース
- [x] 3.1 (P) 公開の照会と、同意日時からの版の特定を作る
  - 先に、偽のストアを使う単体テストで、最新版と新しい順の改訂履歴、版が無いときの準備中(最新版なし)、指定の版と最新版かどうか、存在しない版、照会の結果に下書きと管理者のIDが含まれないこと、日時以前で最も新しい版の返却と該当なしを確かめる
  - 公開の照会(文書と指定の版)と、種類と日時から版番号と公開日時を返す照会口を作る
  - 完了状態: 単体テストが成功し、公開の照会の型に管理者の情報と下書きの項目が存在しない
  - _Boundary: LegalDocumentReader, LegalVersionLocator_
  - _Requirements: 3.9, 6.1, 6.3, 6.5, 6.6, 7.1, 7.4, 8.1, 8.2_

- [x] 3.2 (P) 管理の照会と、公開者・保存者の解決を作る
  - 先に、偽のストアと偽の管理者の照会口を使う単体テストで、3文書の一覧(最新版の版番号と公開日時・下書きの有無)、編集用の状態(状態の版・最新版の本文・下書き・改訂履歴)、版の表示、削除済みの管理者が名前なしになること、管理者のIDをまとめて1回で引くことを確かめる
  - 管理の照会を作り、admin-foundationの管理者の照会口で公開者と下書きの保存者のニックネームを解決する
  - 完了状態: 単体テストが成功し、削除済みの管理者の版でも照会が失敗しない
  - _Boundary: LegalDocumentAdminReader_
  - _Requirements: 2.1, 3.1, 3.5, 5.1, 5.2, 5.3, 5.4_

- [x] 3.3 (P) 下書きの保存・破棄と公開を作る
  - 先に、偽のストアと固定の時計・ID生成を使う単体テストで、保存・破棄・公開の成功時に操作後の編集用の状態を返すこと、状態の版の不一致とストアの競合が競合のエラーに、下書きなしが下書きなしのエラーに、本文が同じ公開が変更なしのエラーになること、公開日時と版のIDの渡し方を確かめる
  - 下書きの保存・破棄と公開のユースケースを作り、拒否をエラーの表のコードと文言のアプリケーションのエラーにする
  - 完了状態: 単体テストが成功し、各拒否のコード(`legal_document_conflict`・`legal_document_draft_missing`・`legal_document_unchanged`)を確かめられる
  - _Boundary: LegalDraftEditor, LegalDocumentPublisher_
  - _Requirements: 3.3, 3.6, 3.10, 4.1, 4.3, 4.4, 4.8_

- [x] 4. APIの組み込み
- [x] 4.1 法務文書の部品をAPIサーバーの依存性注入に束縛する
  - ストア・3つのユースケース・照会口の束縛をまとめたモジュールを作り、合成ルートのモジュールの一覧へ加える
  - 先に、Workers統合テストで、束縛から公開の照会・管理の照会・保存と公開・同意日時からの版の特定を取り出せることを確かめる
  - 完了状態: Workers統合テストが成功し、後続specが版の特定の照会口を束縛の識別子で受け取れる
  - _Depends: 2.2, 3.1, 3.2, 3.3_
  - _Requirements: 8.1_

- [x] 4.2 GraphQLの法務文書のモジュールに型と公開の照会を作る
  - 先に、Workers統合テストで、未ログインの利用者側の呼び出しで文書と版を取得できること、準備中の文書で最新版がnullになること、存在しない版がnullになること、公開の型に下書きと管理者の項目が無いことを確かめる
  - 列挙型・公開と管理の型・入力型・エラーの対応・ビューからの変換と、公開の照会のリゾルバを作り、スキーマモジュールの一覧へ加えてスキーマファイルを生成し直す
  - 完了状態: Workers統合テストとスキーマの生成物の検査が成功し、生成したスキーマファイルに設計どおりの型がある
  - _Requirements: 3.9, 6.5, 7.4_

- [x] 4.3 GraphQLの管理の照会と変更を作る
  - 先に、Workers統合テストで、利用者側の呼び出し元と未ログインの管理の照会が拒否されること、閲覧のみ・モデレーターが照会できて変更が拒否されること、最上位管理者の保存・破棄・公開、本文と変更概要の検証の違反が欄ごとの詳細になること、競合・変更なし・下書きなしのコード、公開者の名前の解決を確かめる
  - 照会は閲覧のみ以上、変更は最上位管理者をadmin-foundationの認可の補助で先頭に確かめ、引数を共有の規則で検証するリゾルバを作り、スキーマファイルを生成し直す
  - 完了状態: Workers統合テストが成功し、最上位管理者でない管理者の変更でデータベースが変わらないことを確かめられる
  - _Requirements: 2.4, 3.4, 3.7, 4.2, 4.5, 10.3_

- [x] 5. 利用者側の画面
- [x] 5.1 (P) 公開ページの本文と改訂履歴の部品を作る
  - 先に、ブラウザテストで、文書の名前の見出し・最終改訂日・本文・本文の後の改訂履歴(新しい順・各版へのリンク・変更概要・`<time datetime>`)、最終改訂日と改訂履歴の日付が曜日を含まない年月日であること、準備中の表示、管理者の情報が出ないこと、読み込み中とエラーの表示、axeの違反が0件であることを確かめる
  - 公開ページの部品(ページ全体の部品の置き場所`components/pages/`)と改訂履歴の部品(`components/legal/`)を作る。本文は法務文書の`rel`を指定したマークダウンの表示部品で、日時は曜日を含まない年月日の形式(`yearDate`)で表示する。部品はGraphQLの生成物(5.3で作る)の型に依存せず、表示に要る値だけを受け取る
  - 完了状態: ブラウザテストが成功し、準備中の状態で本文と改訂履歴が描かれない
  - _Boundary: ClientLegalPages_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 9.3, 9.4, 10.3_

- [x] 5.2 (P) 過去版のページの部品を作る
  - 先に、ブラウザテストで、「<文書の名前>(第N版)」の見出し・公開日・変更概要・本文、過去の版で本文より前に過去の版である旨と最新版へのリンク、最新版で最新版である旨と公開ページへのリンク、axeの違反が0件であることを確かめる
  - 過去版のページの部品(`components/pages/`)と、過去の版・最新版である旨の案内の部品(`components/legal/`)を作る。公開日は5.1と同じ曜日を含まない年月日の形式で表示する。5.1と同じく生成物の型に依存しない
  - 完了状態: ブラウザテストが成功し、案内が本文より前に支援技術で読める位置にある
  - _Boundary: ClientLegalPages_
  - _Requirements: 7.1, 7.2, 7.3, 9.3_

- [x] 5.3 利用者側の6つのルートとGraphQLの操作を組み込む
  - 文書と版の照会の操作を`src/graphql/operations/legal/`の1ファイル1操作の`*.graphql`(操作名は`Client`で始める)で加え、clientで`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行して生成物と許可リストを作り直す。取得の設定・`loader`・生成した型からページの部品の型への変換を`src/graphql/legal-documents.ts`に、公開ページと過去版のheadの組み立てを`src/head/page-heads.ts`(`buildSitePageHead`を通す)に作る。版番号の解析は`loader`で共有の定義の解析を使い、ルートの`params.parse`は使わない。`/terms`・`/privacy`・`/legal`と各`/revisions/{版番号}`のルートは`createFileRoute`に`loader`・head・ページの部品だけを渡す
  - 先に、単体テストで、生成した型からの変換、準備中のときと過去版のページで検索の索引の対象外になること、版番号の形式違反と存在しない版が存在しないページになること、公開ページの正規のURLとタイトルを確かめる
  - 共通フッターと登録画面が持つ法務文書のパスと名前(`site-links.ts`の`TERMS_HREF`・`PRIVACY_HREF`・`FOOTER_POLICY_LINKS`の法務文書の3項目、`account-messages.ts`の`TERMS_LINK_LABEL`・`PRIVACY_LINK_LABEL`)を、1.2で作った共有の定義から作るように改める。値は変えず、既存の単体テストとブラウザテスト(共通レイアウトのリンクの先と名前、登録画面の規約へのリンク)が変更なしで成功し続けることで確かめる
  - 完了状態: 単体テストと生成物の検査が成功し、ローカルで3つの公開ページが共通レイアウトの中に表示され、存在しない版のURLが404の画面になる。clientの`src`に法務文書のパスの文字列リテラルが共有の定義以外に残っていないことを検索で確かめられる
  - _Depends: 1.2, 4.2_
  - _Requirements: 6.6, 6.8, 7.4, 7.5_

- [x] 6. 管理画面
- [x] 6.1 法務文書の一覧とメニューの項目を作る
  - 管理の照会・変更の操作を`src/graphql/operations/legal/`の1ファイル1操作の`*.graphql`(操作名は`Admin`で始める)で加え、adminで`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行して生成物と許可リストを作り直す。取得の設定・`loader`・生成した型からの変換を`src/graphql/admin-legal-documents.ts`に作る(種類と版番号の解析は`loader`で行い、形式違反と存在しない版は404)。メニューへ「法務文書」(`/legal-documents`、`order` 120)を加え、一覧のページの部品(`components/pages/`)と一覧の部品(`components/legal/`)を作り、一覧のルートと、編集・版の表示のルートを用意する。ルートは`createFileRoute`に`loader`・`buildAdminPageHead`によるhead・ページの部品だけを渡す
  - 先に、`src/graphql/admin-legal-documents.ts`の単体テストで、生成した型からの変換と、種類・版番号の形式違反と存在しない版が存在しないページになることを、ブラウザテストで、3文書の名前・最新版の版番号または未公開・年を含む公開日時・下書きの有無、編集の画面へのリンクと利用者側の公開ページへのリンク、読み込み中・エラーの表示(問い合わせのボタンと問い合わせを促す文が出ないこと)、axeの違反が0件であることを確かめる
  - 完了状態: ブラウザテストと生成物の検査が成功し、ローカルでメニューから一覧を開ける
  - _Depends: 4.3_
  - _Requirements: 2.1, 2.2, 2.3, 9.3, 9.4_

- [x] 6.2 (P) 下書きの入力欄と保存・破棄・離脱の確認を作る
  - 先に、ブラウザテストで、初期値(下書き→最新版の本文→空)、ツール・プレビュー・「現在の数 / 100,000」の表示、保存と破棄の確認、最上位管理者でない場合に本文の欄が読み取り専用(`FormField`の`disabled`で無効)で操作が無いこと、保存で`kind`と`expectedStateVersion`を`onSubmit`で足して送ること、保存していない変更があると「公開する」が無効で案内が出ること、離脱の確認(画面内の遷移と再読み込み)、キーボードでの操作を確かめる
  - 下書きの入力欄と操作の部品と、離脱の確認の状態を作る
  - 完了状態: ブラウザテストが成功し、閲覧のみのロールで保存・破棄・公開のボタンが描かれない
  - _Boundary: AdminLegalPages_
  - _Requirements: 3.1, 3.2, 3.6, 3.8, 3.11, 4.6, 9.2, 10.3_

- [x] 6.3 (P) 下書きの状態・競合の案内・エラーの対応を作る
  - 先に、単体テストでエラーのコード(競合・変更なし・下書きなし・要求が大きすぎる・検証の違反・想定外)と表示の対応(`GraphQLClientError`でない例外は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`の文言)を、ブラウザテストで下書きの状態(年を含む保存日時・保存者・削除済みの管理者・下書きなし)と、競合の案内の文言と「最新の内容を読み込む」の操作を確かめる
  - 下書きの状態の部品・競合の案内の部品・エラーの対応を作る。保存日時は年を含む形式(`longDateTime`)で表示する
  - 完了状態: 単体テストとブラウザテストが成功し、各エラーのコードに表示の分岐がある
  - _Boundary: AdminLegalPages_
  - _Requirements: 3.5, 3.10, 10.3_

- [x] 6.4 (P) 公開の確認と変更概要の入力を作る
  - 先に、ブラウザテストで、確認のタイトルと「直ちに表示され、後から変更・削除できない」旨、変更概要の入力欄のフォーカスを外したときの検証と文言(空・200文字超・改行)、文字数の表示、公開で`kind`と`expectedStateVersion`を`onSubmit`で足して送ること、公開される旨の注記、変更なし・下書きなしのエラーの表示、キーボードでの操作、axeの違反が0件であることを確かめる
  - 公開の確認のダイアログを作る
  - 完了状態: ブラウザテストが成功し、検証に違反する間は公開を送信しない
  - _Boundary: AdminLegalPages_
  - _Requirements: 4.2, 4.7, 9.1, 9.2, 9.3_

- [x] 6.5 (P) 改訂履歴の表と版の表示を作る
  - 先に、ブラウザテストで、版・年を含む公開日時・変更概要・公開した管理者の新しい順の表、削除済みの管理者の表示、空の状態、版の表示(本文と情報)と利用者側の過去版のページへのリンクを確かめる
  - 改訂履歴の表と版の表示の部品(`components/legal/`)と、版の表示のページの部品(`components/pages/`)を作り、版の表示のルートに組み込む。日時は年を含む形式(`longDateTime`)で表示する
  - 完了状態: ブラウザテストが成功し、ローカルで版の表示の画面を開ける
  - _Boundary: AdminLegalPages_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 6.6 編集の画面を組み立て、保存・破棄・公開を照会の結果に反映する
  - 編集の画面のページの部品(`components/pages/`)で、見出し(公開ページへのリンク)・下書きの状態・入力欄・改訂履歴を配置して編集のルートに組み込み、変更の成功時に応答の内容で照会の結果を置き換えてフォームを作り直し、トーストを出し、失敗時にエラーの対応に従って表示する
  - 先に、ブラウザテストで、保存の後に下書きの状態が更新され、公開の後に改訂履歴の先頭に新しい版が出て下書きが無くなり、競合の後に「最新の内容を読み込む」で最新の状態に戻ることを確かめる
  - 完了状態: ブラウザテストが成功し、ローカルで最上位管理者が下書きを保存して公開できる
  - _Depends: 6.2, 6.3, 6.4, 6.5_
  - _Requirements: 3.1, 3.3, 3.10, 4.1, 4.4, 4.8_

- [x] 6.7 (P) 監査ログの対象の種類から法務文書を除く
  - 先に、共用部品の単体テストで、対象の種類に`'legal-document'`を持つ操作種別の定義が登録されていない種類として拒否されることを確かめるテストを書く
  - 共用部品の監査ログの対象の種類の型と集合、管理画面の対象の種類の表示名から法務文書を除き、共有ディレクトリの配置で各アプリの配置先へ写す。文言規則の「監査ログの対象の種類」の行から「法務文書」を除き、admin-foundationの設計の対象の種類の値の一覧からも除く。監査ログの対象の種類の列に制約は無く、この値で記録した監査ログも無いため、マイグレーションは作らない
  - 完了状態: 単体テストと型検査が成功し、`apps`と文言規則に`'legal-document'`と監査ログの対象の種類としての「法務文書」が残っていないことを検索で確かめられる
  - _Requirements: 10.7_

- [x] 7. 検証と文書
- [x] 7.1 下書きの保存から公開・過去版までをE2Eテストで確かめる
  - 最上位管理者は、admin-foundationのタスク12.1が用意したE2Eの補助(指定したロールの管理者を招待・完了・ログインさせる補助)で用意する。本specで同等の補助を作らない
  - 利用規約で、開始時の最新の版番号を読む→本文を入力して下書きを保存→`/terms`に下書きが出ない→乱数を含む変更概要で公開→`/terms`に本文・最終改訂日・改訂履歴の先頭の版→もう一度保存して公開→改訂履歴が新しい順に2版増え、1つ前の版のページに過去の版である旨と最新版へのリンクが出ることを確かめる
  - 完了状態: E2Eテストがローカルで起動したapi・admin・clientに対して成功し、2回続けて実行しても成功する
  - _Requirements: 4.8, 6.3, 7.2, 10.2_

- [x] 7.2 (P) 共通フッターから3つの公開ページへの到達をE2Eテストで確かめる
  - トップページのフッターの利用規約・プライバシーポリシー・法的通知のリンクから各ページへ移動し、見出しが文書の名前であることを確かめる(公開済み・準備中のどちらでもよい)
  - 完了状態: E2Eテストがローカルで起動したapi・clientに対して成功する
  - _Boundary: ClientLegalPages_
  - _Requirements: 6.8, 10.2_

- [x] 7.3 (P) 文書の版管理の技術ドキュメントを書く
  - `db/005-draft-and-published-versions.md`に、下書きと公開した版を分ける形、状態の版による条件付きの書き込みと競合の扱い、一括の書き込みでの条件付きの挿入による連番の採番、公開日時の単調な増加、日時による版の特定、版の不変性と保持を、プロジェクト名と固有の値を含めずに書き、`db/README.md`へ1行を追記する。CLAUDE.mdの技術規則の参照先に、下書きと公開した版を持つデータを設計する前に読む項目として加える
  - `db/003-schema-conventions.md`の「マイグレーション」の節に「初期データ」の項を加え、固定のULIDと作成日時・更新日時の値、一意の列に対する重複を無視する挿入、テーブルの作成とは別のカスタムマイグレーションにすること、Workers統合テストのデータベースにも常に入ること、1.1で確かめたスナップショットとの関係を書く。同じ節と`db/001-drizzle-migrations-on-d1.md`の`--custom`の用途の記述に初期データを足して「初期データ」へリンクし、CLAUDE.mdの技術規則の参照先に、初期データをマイグレーションで入れる前に読む項目として加える
  - 完了状態: 文書と索引の行と参照先の行があり、プロジェクト名・ホスト名・本サービス特有の用語(法務文書・利用規約など)を含まないことを検索で確かめられる
  - _Depends: 1.1_
  - _Boundary: LegalDocs_
  - _Requirements: 10.4_

- [x] 7.4 (P) サービス仕様の文書を更新する
  - ページ配置に過去版の3つのURL、外部リンクの`rel`の表の法務文書(`noopener`)、公開ページと過去版のページの配置、管理画面の法務文書の画面の構成とURLを加える。文言規則の入力欄の上限の表に法務文書の本文(100,000文字)を、本specの文言(エラー・確認・状態・案内・変更概要が公開される旨の注記)を加える
  - 準拠方針のデータ保持期間の一覧に版(無期限・削除の操作なし)と下書き(公開・破棄で削除)の行を加え、「法務文書の改訂」を下書きと公開・過去版の掲示・周知の運用(ピン留めヘルプ記事など)・本番公開前の初版の公開の内容に改める。利用規約の大枠の章18とプライバシーポリシーの大枠の章13に改訂履歴と過去の各版の掲示を加える
  - プライバシーポリシーの大枠のCloudflareの項に、非表示のbot判定のウィジェットを使う条件としてCloudflareのTurnstile Privacy Addendumを参照する旨があるかを確かめ、無ければ「bot判定」の項目として加える。「記載上の注意」に、公開するプライバシーポリシーの本文がこの参照を含むことを記す。Cloudflareの項の他の項目(移転先・移転の根拠・委託先が講じる措置)はinfra-deliveryの記述のまま書き換えない
  - 完了状態: 各文書に追記があり、ページ配置のURLと文言規則の文言が実装の値と一致する。プライバシーポリシーの大枠のCloudflareの項と「記載上の注意」にTurnstile Privacy Addendumの参照がある
  - _Boundary: LegalDocs_
  - _Requirements: 10.5_

- [x] 7.5 全体の検査とカバレッジを確かめ、上流・後続への申し送りを報告する
  - ルートの一括の検査(整形・静的解析・型検査)と、本specが変更したアプリの単体テスト・Workers統合テスト・ブラウザテストを実行し、行と関数のカバレッジ80%以上を確かめる。新しいパッケージを追加していないことを依存の宣言の差分で確かめる
  - paymentsの返金ポリシーへのアンカーの扱い、launch-readinessでのprodの初版の公開の確認(公開の前にプライバシーポリシーの本文がTurnstile Privacy Addendumを参照していることを確かめることを含む)、要件定義書のFR-ADMAG-007・008・010の改訂を、開発者への報告にまとめる
  - 完了状態: 検査とテストがすべて成功し、カバレッジが閾値を満たし、報告に申し送りの事項が載っている
  - _Requirements: 10.1, 10.3, 10.6_

- [x] 7.6 公開ページの取得の流れをE2Eテストで確かめる(frontend-platformの申し送り)
  - frontend-platformの第4回の判断44により、ロードマップの順で最初に`loader`でTanStack Queryの取得を始めるページである本specの公開ページで、frontend-platformの要件6.5・14.4・11.6のうち同specで確かめられなかった取得の流れを確かめる。テストは`e2e/client/legal-pages.e2e.test.ts`に置く
  - (a)`/terms`を開く前から中継の経路(`/_bff/graphql`)への`POST`を記録し、ハイドレーションの後に件数が0で、文書の名前の見出しと本文(準備中ならその表示)がサーバー側の描画のままであること。(b)スクリプトを無効にしたコンテキストで`/terms`を開いても見出しと本文(準備中ならその表示)がHTMLにあること。(c)トップページから共通フッターの利用規約のリンクでブラウザ内の画面遷移をする時に、`page.route`で中継の経路への応答を想定外の失敗(状態コード500・エラーコード`internal_error`の共通のエラー形式)にすると、共通レイアウトの中に想定外のエラーの表示(再試行と問い合わせの導線)が出ること
  - サーバー側の描画での取得の失敗の状態コード500と、部品の描画中の例外がサーバー側の描画で状態コード500にならない可能性は、APIサーバーを起動したまま決定的に起こせる手段があれば確かめる。無ければ、飛ばした理由と確かめた範囲を開発者への報告に書き、launch-readinessへの申し送りに含める
  - 完了状態: E2Eテストがローカルで起動したapi・clientに対して、開発サーバーとビルド後のプレビューの両方(ルートの`test:e2e:dev-and-preview`)で成功し、報告にサーバー側の描画の500の確認の結果がある
  - _Depends: 5.3, 7.2, dev-toolingの10.1_
  - _Boundary: ClientLegalPages_
  - _Requirements: 6.1, 6.8, 10.2_

## Implementation Notes

- 1.1: テーブルは`apps/db/schema/legal/`、マイグレーションは`20261104123845_legal_pages`(テーブル)と`20261104123848_legal_pages_seed`(初期データ)。種類の値はテーブルのファイルの非公開の定数`LEGAL_DOCUMENT_KIND_VALUES`(`['terms','privacy','legal-notice']`)のため、1.2で`LegalDocumentKind`と列の`enumValues`の一致を単体テストで確かめる。初期データの固定ULIDは`01M6HXNZ000000000000000001`(terms)・`…02`(privacy)・`…03`(legal-notice)で、時刻部と`created_at`・`updated_at`は`1793750400000`(2026-11-04T00:00:00Z)
- 1.1(7.3の材料): `drizzle-kit generate --custom`でも`snapshot.json`が作られ、`prevIds`は直前のスナップショットのidを指し、内容は直前のスナップショットと`id`・`prevIds`以外が同一(キーの順は異なるため文字列の比較では差分に見える)。直後の`drizzle-kit generate`は「No schema changes」で何も作らない。既存の`20261103133903_identity_disposable_status_undetermined`も同じ。テンプレートのコメント行は削除した
- 1.2: 共有定義は`apps/common-lib/legal/legal-documents.ts`・`legal-input-rules.ts`。`LEGAL_DOCUMENT_KINDS`と列の`enumValues`の一致テストは`apps/api/src/application/legal/legal-columns.unit.test.ts`(common-libはdbを読み込めない)。変更概要の判定は、禁止文字だけを前後の空白を除く前の入力で調べる(VT・FF・NELは空白かつ禁止文字のため、除いてから調べると黙って消える。005の規則と`markdownTextSchema`に合わせた。design.mdの契約のコメントも直した)。改行はLF・CRだけでU+2028・U+2029は扱わない。`changeSummarySchema()`は成功時に`trimWhiteSpace`で除いた値を返す
- 2.1: 規則は`apps/api/src/domain/legal/legal-document.ts`。本文の「完全一致」は`===`(正規化・空白の除去なし)。未公開で下書きがあれば公開可。`nextPublishedAt`は常に新しい`Date`を返す
- 2.2: `LEGAL_TYPES`(`application/legal/legal-types.ts`)に6つの識別子(Store・Reader・AdminReader・DraftEditor・Publisher・VersionLocator)を先に定義した。ポートの入力の型名は`LegalDraftSaveInput`・`LegalDraftDiscardInput`・`LegalPublishInput`・`LegalPublishedVersionLocation`。`discardDraft`の`updated_at`はストア内の`new Date()`。競合に変える一意の違反は`(document_id, version_number)`だけ。Workers統合テストはテストごとに版を消して文書の行を初期データに戻す
- 3.1: 公開の型(`PublicLegalVersion`・`PublicLegalRevision`・`PublicLegalDocument`)と変換`toPublicLegalVersion`・`toPublicLegalRevision`は`legal-document-reader.ts`からexportする(3.2が継承・再利用する)。`getDocument`は改訂履歴を状態の最新版の版番号以下に絞り、2回の照会の間に公開されても時点を揃える。偽のストアは各テストファイル内に置く
- 3.2: 管理の照会は`StoreLegalDocumentAdminReader`。下書きと改訂の型を`AdminLegalDraftView`・`AdminLegalRevisionView`と名付けた(4.xのGraphQLの変換で使う)。管理者のIDは`Set`で重複を除き、空なら`findProfiles`を呼ばない。3.3は`LEGAL_TYPES.LegalDocumentAdminReader`を注入して`getDocument`で操作後の状態を返す
- 3.3: 拒否の`AppError`は`application/legal/legal-document-errors.ts`(`LEGAL_DOCUMENT_ERRORS`・`legalDocumentDenialError`。admin-errors.tsと同じ形、design.mdのファイル構成にも追記)。破棄の下書きなしも`legal_document_draft_missing`(画面は下書きがある時だけ破棄を出すため通常は起きない)。ログはinfoで属性は`action`・`kind`・版番号・`adminId`・`conflict`(カテゴリは7.3で規約の3要素`['api', 'legal', 'draft']`・`['api', 'legal', 'publish']`に直し、`docs/onboardings/project-values.md`の「法務文書」の節に置いた)。入力の型は`LegalDraftSaveRequest`・`LegalDraftDiscardRequest`・`LegalPublishRequest`
- 4.1: `LEGAL_MODULE`(`composition/legal-module.ts`)は6つの識別子を既定のTransientで束縛し`MODULES`の末尾に加えた。`AdminDirectory`は`ADMIN_PLATFORM_MODULE`のものを使う。Workers統合テストの法務文書のテーブルのリセットは2.2と4.1のテストで重複している(まとめるなら`infrastructure/legal/testing/`へ)
- 4.2: `Query`には公開の`legalDocument`・`legalDocumentVersion`だけを載せ、列挙型・公開と管理の型・入力型は宣言だけ先に置いた(リゾルバの無いルートのフィールドを作らないため。4.3で管理のQuery・Mutationと`admin-resolvers.ts`を`index.ts`へ加える)。`versionNumber`が1未満は`withValidatedArgs`で`validation_error`(「版番号は1以上の整数で指定してください。」、`errors.ts`の`INPUT_MESSAGES`)。列挙型の変換は`mappers.ts`の明示の対応表で、管理のビューの変換も用意済み。Workers統合テストの法務文書のテーブルのリセットは`infrastructure/legal/testing/legal-store-fixtures.ts`に共通化した
- 4.3: 管理のリゾルバは`adminOnly(withValidatedArgs(..., requireAdmin))`で、拒否の順は007の「呼び出し元→引数の検証→ロール」(design.mdのシーケンス図も合わせた)。検証の詳細の欄名は`input.body`・`input.changeSummary`・`input.expectedStateVersion`で、画面は`serverFieldPrefix="input"`で欄へ写す。`expectedStateVersion`の文言は「状態の版は0以上の整数で指定してください。」。テストは800行の制限で`admin-resolvers.worker.test.ts`(呼び出し元・ログイン・ロール・照会)と`admin-resolvers.mutation.worker.test.ts`(保存・破棄・公開)に分け、共通の操作は`apps/api/test/support/legal-graphql-operations.ts`。`test:worker`全体でworkerdの「FixedLengthStream」のuncaught exceptionが1行出る(全件成功。7.5で出所を確かめる)
- 5.1: `LegalDocumentPage({ kind, state })`の`state`は`pending`・`error`(`error`・`onRetry`)・`success`(`document: LegalDocumentView`)の判別共用体(design.mdも改めた)。表示用の型`LegalDocumentView`・`LegalLatestVersion`・`LegalDocumentPageState`は`legal-document-page.tsx`、`LegalRevisionSummary`は`legal-revision-history.tsx`からexport。文言と`legalVersionLabel(n)`(「第N版」)は`components/legal/legal-messages.ts`。改訂履歴のリンクは型付きのルートが無いため`PathLink`(5.3で型付きの`Link`へ置き換え可)。client・admin・frontend-libの`vitest.browser.config.ts`の事前バンドルに`remark-cjk-friendly-gfm-strikethrough/parseOnly`を足した(無いとViteがテストを読み込み直す)。5.3への申し送り: `useSuspenseQuery`と例外を投げる`loader`の組では`pending`・`error`の分岐を通らないため、要件9.4・E2Eの(a)と両立する取得の方式を決める
- 5.2: `LegalVersionPage({ kind, versionNumber, state })`は5.1と同じ判別共用体で、見出しは版番号から状態によらず出す(design.mdも改めた)。成功の値`LegalVersionView`は`publishedAt`・`changeSummary`・`body`・`isLatest`。見出しの文字列は`legal-messages.ts`の`legalVersionTitle(label, n)`(5.3のheadで再利用)。公開ページへのリンクは`PathLink`の`activeOptions={{ exact: true }}`で`aria-current`を付けない。5.3で取得の方式を決めた後、2つのページの状態の型と読み込み中・失敗の外枠(約30行の重複)を`components/legal/`へまとめるとよい
- 5.3: 取得の方式: `loader`は`queryClient.query`(`staleTime: 'static'`)を待って失敗を投げ(サーバー側の描画で500)、過去版は版番号の形式違反と存在しない版を`notFound()`にする。ルートには`pendingComponent`・`errorComponent`を足し、5.1・5.2のページの部品へ`pending`・`error`の`state`を渡す(成功は`useSuspenseQuery`)。再試行は`router.invalidate()`と`useLegalPageRetry`(見出しへフォーカス)。正規のURLは`buildPageHead`が同じオリジンのパスしか受けないためパス(design.mdも改めた)。準備中は`noIndex`で正規のURLなし。7.6への申し送り: (1)`site-footer.tsx`の法務文書のリンクは素の`<a>`で全体を読み込み直すため、(c)のフッターからのブラウザ内の遷移が起きない(フッターはfrontend-platformの所有)。(2)サーバー側の描画で失敗するとエラーの文言がハイドレーションの後で変わる(サーバーはAPIの文言、ブラウザは固定の文言)。(3)開発サーバーの起動直後の最初の要求で依存の最適化による「Invalid hook call」が1回出る(応答は200)。2つのページの外枠の共通化と改訂履歴の型付きの`Link`への置き換えは未実施
- 6.1: 管理の照会3つ・変更3つの操作は`apps/admin/src/graphql/operations/legal/`。`admin-legal-documents.ts`に取得の設定・変換・loaderとビューの型(`toAdminLegalDocument`は変更の結果にも使える。`toGraphQLLegalDocumentKind`は変更の入力用)。一覧のloaderは`.catch(() => undefined)`と`useQuery`(表の中で失敗と再試行)、編集・版の表示のloaderは形式違反と存在しない版を`notFound()`。adminのloaderは`staleTime: 'static'`を使わない。利用者側の公開ページへのリンクは`use-client-site-href.ts`(`clientSiteOrigin`+パス、同じタブ)。編集・版の表示のページの部品(`legal-document-editor-page.tsx`・`legal-document-version-page.tsx`)は見出しだけの仮で、6.5・6.6で中身を差し替える。`renderInRouter`を使う部品のテストは`execute-graphql.ts`のモックと`DisplayPreferencesProvider`が要り、テストのブラウザのロケールは英語。`legalVersionLabel`・`legalVersionTitle`はclientとadminで重複(まとめるなら`apps/common-lib/legal/`)
- 6.2: `LegalDraftForm`のpropsは`document`・`onSave`・`onSaveError`(`AppForm.onSubmitError`へ)・`onDiscard`・`onPublishRequest`・`notice`(6.3の競合の案内とエラーの差し込み口)。破棄の競合は6.6が`onDiscard`で案内を出して投げ直す(ダイアログにも失敗の文言を出すため)。`publishFormSchema`も`legal-form-schemas.ts`に作成済み(6.4が使う)。新しい文言は`legal-draft-form-messages.ts`。designに無い文言「このページを離れますか?」「破棄した下書きは元に戻せません。公開した版は変わりません。」「本文をマークダウンで入力してください」を7.4で文言規則へ足す。離脱の確認は`ConfirmActionDialog`を再利用。`MarkdownEditor`はblurで値を渡すため、公開の案内の行を常に確保してクリックのずれを防いだ
- 6.3: `toLegalEditorErrorState(error, context?)`は`onSubmitError`の`context`を受けると`field`の詳細を`unmatched`に絞る(design.mdの契約も改めた)。詳細の無い`validation_error`は`unexpected`。表示の文言は`legalEditorErrorMessageOf(state)`、文言は`legal-editor-messages.ts`(「削除済みの管理者」を含む。6.4・6.5で再利用)。`LegalConflictNotice`は文言だけ`role="alert"`でボタンは外、押下は`onReload`。6.6への申し送り: (1)想定外の失敗をエラートラッキングへ送るかを決める(既存のadminのフォームは送っていない)。(2)「最新の内容を読み込む」で案内が消えた後のフォーカスの移し先を決める。(3)破棄の競合で`ConfirmActionDialog`と案内の両方に同じ文言が出て二重に読み上げられ得る。(4)案内を出したまま再び競合すると読み上げられないため`key`などで描き直す。7.4への申し送り: designに無い文言「最後に保存した日時」「保存した管理者」を文言規則へ足す
- 6.4: `PublishLegalDocumentDialog`は`components/admins/`の`AdminFormDialog`・`AdminFormDialogFooter`・`useAdminFormDialogControls`を再利用(`audited={false}`)。文字数は`MarkdownLengthCounter`に`trimWhiteSpace`した値を渡す(検証と同じ数え方)。1行の入力欄は改行を値に入れないため、改行の違反はサーバーの返す文言を欄に示す形で確かめた。ダイアログ内の競合で「最新の内容を読み込む」は`onReload()`を呼んで閉じる。6.6への申し送り: 公開の成功時に`returnFocusRef`へ`LegalDraftForm`の保存のボタンを入れる必要がある(「公開する」が消えるため。`LegalDraftForm`はまだボタンを外へ渡していない)。競合の案内はダイアログ内だけでページの`notice`には出していない。7.4への申し送り: 「変更概要(必須)」「公開」を文言規則へ足す
- 6.5: `LegalRevisionTable`は受け取った順(新しい順)で描き、読み込み中・失敗の状態を持たない(編集・版の表示の取得の失敗は`loader`が投げてルートのエラーの画面が示す。design.mdの記述も改めた)。文言は`legal-revision-messages.ts`、読み上げ名「第N版を表示」「第N版を公開ページで見る」は7.4で文言規則へ足す。版の表示のページは`useSuspenseQuery`で版が無ければ`notFound()`。ローカルのD1に確認用の最上位管理者(E2E管理者21bdee)と法的通知の第1版(変更概要「ローカルで版の表示を確かめるための版です。」)が残っている。ローカルでE2Eを実行する時、招待の発行コマンドは`HASH_PEPPER`が要るため`infisical --telemetry=false run --env dev --`を付ける
- 6.6: 結線は`use-legal-document-editor.ts`(`setQueryData`で置き換え、一覧は常に無効化、公開の後は版の照会も無効化)。フォームは`key`で作り直さず`stateVersion`の変化で`reset`する(破棄のダイアログを失わないため)。処理の後のフォーカスは`use-focus-after-change.ts`が表示中の版の変化を待ち、本文が空なら本文の欄(`MarkdownEditor`のハンドル。RHFの`reset`の後は`setFocus`が効かない)、空でなければ押せるようになった保存のボタンへ移す。破棄・公開の要求はダイアログが閉じてから出す。ダイアログ由来の競合ではページの案内を`announce={false}`(Radixの`hideOthers`は`aria-live`の祖先を隠さず二重に読まれるため)。競合の案内は失敗ごとの連番の`key`で作り直す。想定外の例外はエラートラッキングへ送らない(既存のadminのフォームと同じ)。7.4への申し送り: トーストの文言「下書きを保存しました。」「下書きを破棄しました。」「公開しました。」を文言規則へ足す。ローカルのD1には法的通知の第2版と確認用の最上位管理者がもう1人ある
- 6.7: `AuditTargetKind`と集合・管理画面の表示名・admin-foundationのdesign.mdの値の一覧・文言規則の行から`legal-document`を除いた(GraphQLの`targetKind`は`String`のためスキーマに波及しない)。admin-foundationのdesign.mdの27行目は12メニューの操作の記録を各後続specとしており法務文書も記録するように読めるため、7.4で「法務文書は記録しない(legal-pagesのQ1)」と注記する
- 7.1: `e2e/admin/legal-documents.e2e.test.ts`は開始時の最新の版番号からの差と乱数で確かめ、実行のたびに利用規約の版が2つ増える(ローカルのD1の`/terms`は公開済みになっている)。利用者側のURLは管理画面の「公開ページを開く」の`href`から取る。実行は`infisical --telemetry=false run --env dev -- bun run test:e2e e2e/admin/legal-documents --project=admin`で、api・admin・clientの開発サーバーが要る(eventは不要)。要件7.2の「本文より前」はブラウザテストで確かめる
- 7.2: `e2e/client/legal-pages.e2e.test.ts`の補助`footerPolicyNavigation`・`expectFooterLegalLinks`・`expectLoadedDocument`は7.6でも使う。見出しは読み込み中・失敗でも文書の名前で出るため、`expectLoadedDocument`で準備中の文言か「最終改訂日」の表示とalertが無いことを確かめる(「最終改訂日」は`<dt>`に絞るとより確実で、7.6で直してよい)。実行は`infisical --telemetry=false run --env dev -- bun run test:e2e e2e/client/legal-pages --project=client`(api・clientが要る)
- 7.3: `docs/GUIDES/tech/db/005-draft-and-published-versions.md`を新規作成し、003に「初期データ」の項を加えた(例の値は実際の初期データと別)。ログのカテゴリは規約の3要素`['api', 'legal', 'draft']`・`['api', 'legal', 'publish']`に直し、固有の値として`docs/onboardings/project-values.md`の「法務文書」の節に置いた。tech/README.md・README.md・CLAUDE.mdのdb行の範囲も更新した(tech/README.mdの手順「本索引は変更しない」とは食い違うが、content-processingの前例に合わせた)
- 7.4: プライバシーポリシーの大枠の各委託先の項の共通の規則に「委託先が利用の条件として記載を求める事項は3項目の後に加える」を足し、Cloudflareの項に「bot判定」(Turnstile Privacy Addendum)を加えた(既存の3項目は不変)。文言規則には実装の文言81件と組み立てる9件を転記し、`check-legal-copy.ts`(scratchpad)で欠けが0件であることを確かめた。準拠方針に(注9)を新設。admin-foundationのdesign.mdの27・53行目に「法務文書の操作は監査ログに記録しない」を注記
- 7.6: 共通フッターの法務文書の3リンクを型付きの`Link`へ移した(`FOOTER_LEGAL_DOCUMENT_LINKS`。frontend-platformのdesign.mdの「全経路がそろう段階で`Link`へ移す」に従った。料金・問い合わせ・ヘルプは`<a>`のまま)。サーバー側の描画での取得の失敗の500は、APIサーバーのIPアドレス単位の制限を直接の要求で使い切り(`e2e/support/api-rate-limit.ts`)、同じIPを名乗って開くことで決定的に確かめた(起こすのは想定内の429で、想定外の失敗は起こせない)。確かめられなかった項目: 部品の描画中の例外がサーバー側の描画で500にならない可能性(launch-readinessへの申し送り)。サーバー側の描画で失敗するとハイドレーションの後にエラーの文言が変わる(`GraphQLClientError`が復元されないため。全ページに及ぶためfrontend-platform・launch-readinessへ申し送り、テストはalert・再試行・問い合わせの有無で確かめる)。`e2e/support/reachability.unit.test.ts`の1件はポート48044でclientが動いている間に失敗する既存の環境依存。`test:e2e:dev-and-preview`の1回目はプレビュー段階の退会のテストがローカルD1の`SQLITE_BUSY`で1件失敗し、再実行で成功
- 7.5: ルートの`bun run check`は成功。本specのファイルは行・関数とも80%以上(不足していた3ファイルにテストを足した)。依存の宣言の差分は無し。apiの`test:unit`の1件の失敗は、並行のinquiry-chatが残した空の未追跡のディレクトリ`apps/db/migrations/20261104124132_inquiry_chat/`・`20261104124136_inquiry_chat_seed/`によるもの。4.3の`FixedLengthStream`のuncaught exceptionの出所はmedia-pipelineのアップロードのWorkers統合テストで、本specの外。申し送り(payments・launch-readiness・要件定義書・frontend-platform)は最終の報告にまとめた
