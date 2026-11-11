# Implementation Plan

- [x] 1. 基盤: 共有の規則・テーブル・文書の先行の更新
- [x] 1.1 ヘルプの入力規則・ステータス・標準カテゴリと、監査ログの操作種別を共有定義として作る
  - 前提: dev-tooling・backend-platform・api-gateway・email-delivery・frontend-platform・infra-delivery・content-processing・media-pipeline・identity-auth・admin-foundation・legal-pages・inquiry-chat・payments・ultras-subscription・user-profile-socialの全タスクが完了していること(ハンドル基盤と旧ハンドルの解放の文`previousHandleRelease`・全文検索の基盤とマークダウンの部品・権限と監査ログと管理者の照会と共通部品・カテゴリのページの登録口・フッターの登録口・E2Eの管理者ログインの補助)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、タイトル・サブタイトルの100・101書記素と絵文字・空白だけ・禁止文字、検索欄の検索語の50・51書記素、URLのクエリの検索語の正規化(空白だけ・未指定の既定の値、51書記素の50書記素への切り詰め、数として届いた値の文字列への戻し)、本文の上限100,000、ハンドルの規則の50・51文字と予約語が空であること(`admin`・`Support`・`launchstadium`が形式の検査を通る)、並べ替えの件数の上限、ステータスの表示名、標準カテゴリの固定のID、8つの監査ログの操作種別(名前・対象の種類・理由は任意・詳細の鍵)の単体テストを書く
  - 4アプリが読み込める共有ディレクトリに置き、zodを使わず書記素の数え方と禁止文字の判定はcontent-processingの部品を使う。監査ログの操作種別を集約点へ連結する
  - 続けて、見出し・リスト・表・コードブロック・リンクを含む代表的な100,000文字の本文の描画が開発コンテナのBunで1,500ms以内であることを計測する単体テストを同じディレクトリに置く
  - 完了状態: 単体テストが成功し、client・admin・api・eventの型検査で配置先から読み込め、監査ログの操作種別の一覧の作成で名前の重複の例外が出ない
  - _Requirements: 2.3, 2.9, 3.6, 6.1, 6.2, 7.1, 7.2, 7.5, 11.3, 12.5, 12.6_

- [x] 1.2 カテゴリ・記事・記事の旧ハンドル・索引文書の4テーブルと索引の定義を作り、マイグレーションを用意する
  - 先に、記事のハンドルとカテゴリ名の照合規則、ピン留め・ステータス・並び順・版のCHECK、カテゴリと記事の並び順の列と索引、作成者の列に外部キーが無いこと、旧ハンドルが記事1件に1行で外部キーの`ON DELETE`を指定しないこと、索引文書の共通の列とタイトル・サブタイトルの列、索引の定義が検証を通ることを確かめる単体テストを書く
  - スキーマの集約点と索引の定義の集約点へ加え、mainの最新を取り込んでからマイグレーションを生成し、標準カテゴリ「その他」(並び順1)の初期データと、全文検索の索引とトリガー(出力スクリプトの結果)を2つのカスタムマイグレーションで加える
  - 続けて、マイグレーションを適用したローカルD1のWorkers統合テストで、大文字小文字だけが違うカテゴリ名・記事のハンドルの2行目の拒否、ピン留め・ステータス・並び順・版のCHECKの違反の拒否、初期データの「その他」と並び順の存在を確かめる
  - 完了状態: 単体テスト・索引のマイグレーションの突き合わせの検査・Workers統合テストが成功し、マイグレーションをローカルに適用できる
  - _Requirements: 6.6, 6.7, 6.12, 7.2, 7.8, 10.1, 11.2, 11.3_

- [x] 1.3 (P) ページ配置・文言規則・準拠方針・本プロジェクト固有の値に、ヘルプの配置と文言を先に書く
  - ページ配置: 「ヘルプ」節(ヘルプトップのカテゴリ別の一覧と検索、記事詳細の配置と目次、同カテゴリの記事、フッターのピン留め記事、管理者が指定するカテゴリと記事の並び順とピン留めの群)、「旧ハンドルの保持とリダイレクト」の予約語の対象がユーザー・プロダクトだけでヘルプ記事を含まない旨、外部Webサイトへのリンクの表へのヘルプ記事の本文(`noopener`)、管理者側のヘルプ記事の画面(一覧・絞り込み・作成・編集・削除・記事の並べ替え`/help-articles/order`)とカテゴリのページのヘルプ記事カテゴリの区画(並べ替えを含む)
  - 文言規則: 入力欄の表にヘルプ記事の本文(100,000文字・必須・マークダウン)、設計のError Handlingのエラー・状態・トーストの文言(並べ替えのボタンの名前と移動の読み上げ、旧ハンドルの解放の案内を含む)
  - 準拠方針: 「ヘルプ記事の旧ハンドル文字列」の行の削除方法に、他の記事が同じ文字列をハンドルに設定した時点での物理削除を加える
  - 本プロジェクト固有の値: 検索対象の名前、監査ログの操作種別、管理画面のメニューと区画のID、標準カテゴリのID
  - 完了状態: 4つの文書が整形の検査を通り、6・7のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md`・`docs/GUIDES/service/legal/001-compliance-policy.md`・`docs/onboardings/project-values.md`_
  - _Requirements: 13.5_

- [x] 2. 検索対象と純粋な規則
- [x] 2.1 ヘルプ記事の検索対象を登録する
  - 先に、ローカルD1のWorkers統合テストで、公開の記事だけを読み取り下書き・不在では空になること、版が記事の版であること、対象の条件が下書きで偽になること、content-processingの索引の更新の処理で索引文書が作られ、タイトルの前方一致と(キーワード抽出を無効にした環境で)本文の語で検索式に一致することを確かめる
  - 検索対象(タイトル・サブタイトルは元のテキスト、本文はキーワード抽出の対象)を検索対象の集約点へ加え、外部へ送る項目が本文だけであることを確かめる
  - 完了状態: Workers統合テストと検索対象の集約点の単体テストが成功し、api・eventの3経路のDIの解決の検査が新しい検索対象を含めて成功する
  - _Depends: 1.2_
  - _Requirements: 2.1, 2.2, 4.1, 10.1, 10.2, 10.5, 10.6_

- [x] 2.2 (P) 並び順・ハンドルの変更の種類・標準カテゴリの保護の規則を作る
  - 先に、カテゴリの並び順の昇順と同値の作成の古い順・IDの順、ピン留めの群を先頭にし各群を記事の並び順で並べること、2つの群への分割、公開の記事の無いカテゴリの除外、フッター用のピン留めの順、上下の移動(端では変わらない・元の配列を変えない)、ハンドルの変更の種類(変更なし・大文字小文字だけ・別の文字列)、標準カテゴリの名前の変更と削除の拒否(並べ替えは許す)の単体テストを書く
  - 並び順の規則は管理画面も使うため共有ディレクトリに、ハンドルの変更の種類と標準カテゴリの保護はapiの純粋な規則に置く
  - 完了状態: 単体テストが成功し、規則がデータベースと時計に依存しない
  - _Boundary: HelpOrdering, HelpHandleChange, HelpCategoryRules_
  - _Depends: 1.1_
  - _Requirements: 1.2, 1.3, 3.9, 5.2, 7.8, 7.9, 7.10, 9.8, 9.11, 11.3, 11.7_

- [x] 3. APIサーバーのカテゴリと記事の管理
- [x] 3.1 ポートと識別子、ハンドルの対象の記述、確認の文を作る
  - 先に、ローカルD1のWorkers統合テストで、ハンドルの対象の記述により公開の記事の現在のハンドルが大文字小文字を区別せずに解決され下書きの記事の現在のハンドルは解決されないこと、旧ハンドルは保持者の状態によらず解決されること、使用中の判定が下書きを含む他の記事の現在のハンドルだけを対象にし他の記事の旧ハンドルを数えないこと、旧ハンドルの解放の文が他の記事の同じ旧ハンドルの行だけを消すこと、記事の存在と版の確認の文が記事の不在・版の違いで同じ一括の書き込みの他の文(監査ログを含む)ごと取り消し記事が存在し版が一致すれば何も書かないこと、並べ替えの対象の集合の確認の文が集合の違い(追加・削除・移動)で全体を取り消し一致すれば何も書かないことを確かめる
  - ハンドルの対象の記述をハンドル基盤の規約どおりバックエンド共通ファイルの`workers/help/`に置き(G3)、記事・カテゴリ・公開の照会の3つのポートと作成者の照会のポート、DIの識別子を作る
  - ユースケースが投げる想定内の失敗のコード・種類・文言(設計のError Handlingの表)を、application層の`help-errors.ts`に作る(presentation層は入力の検証の文言だけを持つ)
  - 完了状態: Workers統合テストが成功し、確認の文の意図がコードのコメントで説明されている
  - _Depends: 1.2_
  - _Requirements: 4.2, 4.4, 6.8, 6.9, 7.3, 7.4, 9.10, 11.11_

- [x] 3.2 カテゴリのD1の実装とユースケースを作る
  - 先に、ローカルD1のWorkers統合テストで、名前の大文字小文字を区別しない重複の拒否、「その他」の名前の変更の拒否、追加で並び順の末尾に置かれること、削除で下書き・公開の記事が「その他」の末尾へ元の相対的な順で付け替わり記事の更新日時と版が変わらないこと、監査ログ(付け替えた件数・並べ替えた件数)が同じ一括の書き込みに入ること、並べ替えで「その他」を含む全カテゴリが指定の順になり集合の違いで取り消されること、一覧の件数が下書きを含み並び順の順で返ることを確かめる。模擬のポートの単体テストで、ユースケースの判定の順(名前の検証→存在→保護→監査ログの準備→保存)と各エラーコード、並べ替えの古い並びのコードを確かめる
  - 監査ログの準備には`AuditEntryInput`の`operatorAdminId`・`targetIds`・`occurredAt`を渡し、詳細の値(付け替えた件数・並べ替えた件数)を文字列にする
  - 束縛は3.6で行う
  - 完了状態: Workers統合テストと単体テストが成功し、失敗した操作で監査ログが残らない
  - _Depends: 2.2, 3.1_
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6, 11.7, 11.9, 11.10, 11.11, 12.3, 12.4_

- [x] 3.3 (P) 記事のD1の実装のうち、作成・更新・削除の一括の書き込みを作る
  - 先に、ローカルD1のWorkers統合テストで、作成・更新・削除が監査ログと同じ一括の書き込みで確定すること、同じハンドルの同時の2つの作成の一方だけが成功すること、他の記事の旧ハンドルと同じハンドルの作成・変更でその旧ハンドルの行が現在のハンドルの書き込みの後の解放の文で消え保存が取り消されれば残ること、同じ旧ハンドルを2つの保存が同時に取りにいくと一方だけが確定し旧ハンドルの行が残らないこと、下書きの記事が他の記事の旧ハンドルを取った後はその文字列の解決で転送されず下書きの記事にも解決されないこと(詳細ページは404)、カテゴリの不在の取り消し、更新で版が1増え作成者が変わらず更新日時が保存時刻になること、作成とカテゴリの変更で移動先のカテゴリの末尾に置かれピン留めの切り替えでは並び順が変わらないこと、別の文字列への変更で旧ハンドルが1行のまま置き換わり大文字小文字だけの変更では変わらないこと、公開の保存で索引文書が更新待ちになり下書きへの変更と削除で索引文書が消えること、削除で旧ハンドルが消え同じハンドルを他の記事が使えること、取り消しの理由を読み直しで分類することを確かめる
  - 束縛は3.6で行う
  - 完了状態: Workers統合テストが成功し、失敗した保存・削除でどの行も変わらない
  - _Boundary: D1HelpArticleStore_
  - _Depends: 3.1_
  - _Requirements: 4.6, 6.5, 6.6, 6.7, 6.8, 6.9, 6.12, 7.3, 7.4, 7.6, 7.8, 7.9, 8.2, 8.3, 9.11, 10.1, 10.3, 12.3, 12.4_

- [x] 3.4 記事のD1の実装のうち、並べ替えと読み取りを作る
  - 3.3と同じファイルを変えるため、3.3の後に行う
  - 先に、ローカルD1のWorkers統合テストで、並べ替えが監査ログと同じ一括の書き込みで確定し、指定の順になり更新日時と版が変わらず、対象の集合の違い(並べ替えの最中の追加・削除・カテゴリの移動)で全体が取り消されること、全件の読み取り(並び順・ピン留め・作成日時を含む)と1件の読み取り(カテゴリ名と旧ハンドルを含む)、他の記事の旧ハンドルの保持者の照会(記事自身を除く、大文字小文字を区別しない)を確かめる
  - 束縛は3.6で行う
  - 完了状態: Workers統合テストが成功し、失敗した並べ替えでどの行も変わらない
  - _Boundary: D1HelpArticleStore_
  - _Requirements: 7.7, 9.1, 9.9, 9.10, 12.3, 12.4_

- [x] 3.5 (P) 記事の作成・編集・削除・並べ替えのユースケースを作る
  - 先に、模擬のポートの単体テストで、作成・編集の判定の順(存在→版→使用中→監査ログの準備→保存→公開だけ索引の更新の依頼)、予約語を判定しないこと、大文字小文字だけの変更と現在の値の維持で使用中を判定しないこと、記事自身の旧ハンドルへの戻しを受け付けること、カテゴリの変更の検出、保存の結果の種類ごとのエラーコード、作成者を作成時だけ記録すること、監査ログの詳細(作成はステータス、編集はステータスが変わったときだけ変更前後のステータス、並べ替えは件数、タイトル・本文を含まない)、索引の更新の依頼の失敗で保存が成功のまま返ること、並べ替えと下書きの保存で索引の更新を依頼しないこと、並べ替えの古い並びのコード、削除の不在のコードを確かめる
  - 監査ログの準備には`AuditEntryInput`の`operatorAdminId`・`targetIds`・`occurredAt`を渡し、詳細の値(ステータス・件数)を文字列にする。失敗は3.1の`help-errors.ts`で投げる
  - 完了状態: 単体テストが成功し、ユースケースがD1と`apps/backend-lib`のハンドル基盤・検索の基盤の関数を直接読み込まない(`apps/common-lib`の純粋な判定は使ってよい)
  - _Boundary: HelpArticleEditor_
  - _Depends: 2.2, 3.1_
  - _Requirements: 6.1, 6.5, 6.6, 6.8, 6.9, 6.12, 7.3, 7.4, 7.5, 7.6, 7.10, 8.4, 9.9, 9.10, 10.1, 10.4, 12.3, 12.5_

- [x] 3.6 管理者側の照会と作成者の照会を作り、apiのヘルプのモジュールで束縛する
  - 先に、模擬のポートの単体テストで、全件の照会が作成者を1回でまとめて引き削除済みを空にし更新日時の新しい順に並べること、使用可否の4値(記事自身の現在・旧は使える、他の記事の現在のハンドルは使えない、他の記事の旧ハンドルは解放を伴って使える、形式違反)、作成者の照会が管理者の照会口の結果を表示用の情報へ写し、照会の例外では全員を削除済みとして結果を返し`warn`のログを残すことを確かめる
  - apiのヘルプのモジュールを作り、記事とカテゴリの2つのD1の実装、作成者の照会、記事の作成・編集・削除・並べ替え、管理者側の照会、カテゴリのユースケースを束縛して束縛の一覧へ加える(統合タスク)
  - 完了状態: 単体テストと3経路のDIの解決の検査が成功し、apiの処理単位のコンテナから3.2・3.5・本タスクのユースケースを解決できる
  - _Depends: 3.2, 3.3, 3.4, 3.5_
  - _Requirements: 3.4, 7.7, 9.1, 9.2, 9.4_

- [x] 4. 公開の照会のD1の実装とユースケースを作る
  - 先に、ローカルD1のWorkers統合テストで、全カテゴリと公開の記事を並び順の列を含めて1回の読み取りで得て下書きを含まないこと、詳細と同カテゴリの公開の記事を1回の読み取りで得ること、旧ハンドルの転送先が下書きで空になること、他の記事に解放された旧ハンドルの文字列が新しい保持者の現在のハンドルとして解決されること、検索が下書きを除き関連度の順に上限件数までを現在のタイトル・ハンドル・カテゴリ名で返し、記号や検索式の構文を含む語でも失敗しないことを確かめる。模擬のポートの単体テストで、ヘルプトップの並び(カテゴリの並び順・ピン留めの群・記事の並び順)、形式違反・不在・下書きの404、旧ハンドルの転送と保持者が下書きの404、作成者の削除済み、同カテゴリの並び、ピン留めの順、検索語が空白だけの空の結果を確かめる
  - 実装とユースケースの束縛を3.6のapiのヘルプのモジュールへ加える
  - 完了状態: 単体テスト・Workers統合テスト・3経路のDIの解決の検査が成功し、ユースケースがD1と`apps/backend-lib`の関数を直接読み込まない
  - _Depends: 2.1, 3.6_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 3.1, 3.3, 3.4, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 10.5_

- [x] 5. APIサーバーのGraphQL
- [x] 5.1 スキーマモジュール`help`の土台とカテゴリの操作を作る
  - 先に、Workers統合テストで、カテゴリの照会(並び順の順)を閲覧のみの管理者ができ、追加・名前の変更・削除・並べ替えはモデレーター以上だけができること、名前の検証と重複・保護・不在のコード、削除の結果の付け替えた件数、並べ替えのIDの配列の検証(空・重複・上限超過)と古い並びのコード、利用者側の呼び出し元の拒否(入力が不正でも入力の検証より前に`forbidden`)を確かめる
  - 型の定義・入力の検証の文言・入力の検証の土台と、呼び出し元の確認の包み(`resolver-support.ts`の`clientOnly`・`adminOnly`)を作り、スキーマモジュールの一覧へ加える。管理者側のリゾルバは`adminOnly`の内側を`withValidatedArgs`で包み、その内側で`requireAdmin`を呼ぶ
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Depends: 3.6_
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.9, 11.11, 12.1_

- [x] 5.2 管理者側の記事の操作をスキーマモジュールに加える
  - 先に、Workers統合テストで、全件(並び順・ピン留め・作成日時を含む)・1件(不在はnull)・ハンドルの使用可否(4値)の照会を閲覧のみの管理者ができること、作成・編集・削除・並べ替えがモデレーター以上だけで閲覧のみは`forbidden`になること、入力の検証(タイトル・サブタイトル・ハンドル・本文100,000文字・理由500文字・並べ替えのIDの配列)と欄ごとの詳細、100,000文字の本文を保存できること、使用中・競合・不在・カテゴリの不在・古い並びのコード、予約語の文字列を受け付けること、作成者の画像の項目が隔離中でnullの`objectKey`になること、削除済みの作成者がnullになることを確かめる
  - 作成者の項目(画像)のリゾルバを作り、管理者側と利用者側の作成者の型で使う
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Requirements: 3.4, 6.1, 6.2, 6.5, 6.8, 6.9, 7.1, 7.3, 7.5, 7.7, 8.2, 8.4, 9.1, 9.9, 9.10, 12.1, 12.3_

- [x] 5.3 利用者側の照会の操作をスキーマモジュールに加える
  - 先に、Workers統合テストで、ヘルプトップ・記事(転送とnull)・ピン留め・検索の4つの照会がログイン無しで動くこと、管理者側の呼び出し元の拒否(`clientOnly`による、入力の検証より前の`forbidden`)、51文字の検索語を拒否せず50文字に切り詰めて検索すること、下書きと形式違反のハンドルのnull、作成者の削除済みのnullを確かめる
  - 完了状態: Workers統合テストとスキーマの検査が成功し、利用者側の操作が公開の型に管理者のIDを含まない
  - _Depends: 4_
  - _Requirements: 1.1, 2.1, 2.9, 3.1, 3.3, 3.4, 4.2, 4.4, 4.7, 5.1_

- [x] 6. 利用者側の画面
- [x] 6.1 クライアントの操作と、フッターのピン留め記事を作る
  - ヘルプの4つの照会の操作をclientの`src/graphql/operations/help/`に1ファイル1操作の`*.graphql`(操作名は`Client`で始める)で加え、clientで`bun run graphql:generate`を実行して型と`<操作名>Document`とpersisted operationsを生成する
  - 先に、ブラウザテスト(axeの違反0件)で、ピン留め記事をAPIが返した順のままタイトルのリンクとして並べること、読み込み中と取得の失敗で何も描かずフッターの他の部分が表示されることを確かめる
  - 4つの照会の取得の設定を`src/graphql/help-center.ts`に置き(単体テストを併置)、フッターのヘルプの区画の登録箇所に部品を加える
  - 完了状態: 型の生成とブラウザテストと、frontend-platformのフッターのテストが成功し、`graphql:allowlist`でapiの許可リストを再生成して`graphql:check`が成功し、ローカルで任意のページのフッターにピン留め記事が出る
  - _Depends: 5.3_
  - _Requirements: 4.1, 5.1, 5.2, 5.3, 5.4_

- [x] 6.2 ヘルプトップの部品とルートを作る
  - 先に、ブラウザテスト(axeの違反0件)で、検索欄の51文字の表示と移動しないこと・41文字からの文字数の表示と上限の超過と回復の読み上げ・消去のボタン・戻る操作でのURLの検索語への入力欄の更新、カテゴリ別の見出しと項目(タイトル・サブタイトル・ピン留めの印・詳細へのリンク)をAPIが返した順のまま描くこと、0件の案内と問い合わせへの導線、検索結果のカテゴリ名と一致した部分の強調、検索の0件と一覧へ戻る導線を確かめる。ルートのテストで、クエリ`q`の有無と空白だけの分岐、51文字の`q`を50文字に切り詰めて検索すること、再読み込みと戻る・進むでの検索結果の復元、スケルトンと取得エラーの再試行・問い合わせへの導線、ページのタイトルと正規のURLを確かめる
  - `loader`の関数を`src/graphql/help-center.ts`(`queryClient.query`の`staleTime: 'static'`、単体テストを併置)、`head`の組み立てを`src/head/page-heads.ts`、文言を`components/help/help-messages.ts`に置き、`/help`のルート(ログイン不要)を作る。項目のリンク先の`/help/$handle`のルートは、型検査を通すため本タスクで仮の部品のファイルとして先に作り、6.5で置き換える
  - 完了状態: テストが成功し、ローカルで`/help`を開くとカテゴリ別の一覧が出て、検索で`/help?q=`に移る
  - _Depends: 6.1_
  - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.7, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9_

- [x] 6.3 (P) 記事詳細の目次の部品を作る
  - 先に、ブラウザテスト(axeの違反0件)で、見出しの一覧からPC用の名前付きのナビゲーション(固定)とモバイル用の折りたたみを描くこと、各項目が見出しのIDへのリンクで深さに応じて字下げされること、見出しが無いときに何も描かないことを確かめる
  - 完了状態: ブラウザテストが成功し、部品が見出しの一覧だけを受け取りGraphQLに依存しない
  - _Boundary: HelpTableOfContents_
  - _Depends: 1.1_
  - _Requirements: 3.7, 3.8_

- [x] 6.4 記事詳細のその他の部品を作る
  - 先に、ブラウザテスト(axeの違反0件)で、カテゴリ名・タイトルの見出し・サブタイトル・作成者(画像・ニックネーム・肩書き、削除済みの表示と既定の画像)・更新日時の`<time datetime>`、本文の描画と別オリジンのリンクの別タブと`rel`、PCの2カラムとモバイルの1カラムでの目次の位置、目次のリンクで本文の見出しが固定ヘッダーの下に隠れない位置へ移ること、同カテゴリの記事のリンク(APIが返した順)と0件の非表示、検索欄からヘルプトップの検索への移動、スケルトンを確かめる
  - 完了状態: ブラウザテストが成功し、部品がページ配置の2カラムと1カラムで描画される
  - _Depends: 6.2, 6.3_
  - _Requirements: 2.8, 3.3, 3.4, 3.5, 3.6, 3.9, 3.11_

- [x] 6.5 記事詳細のルートを作る
  - 先に、ルートの`loader`のテストで、形式違反の照会なしの404、nullの404(存在しない・下書きで同一)、転送の302(`statusCode`の明示とクエリの引き継ぎ)、ページのタイトルと正規のURL(現在のハンドルの表記)、取得エラーの表示を確かめる
  - `loader`の関数を`src/graphql/help-center.ts`(productの`loadProductPage`と同じ形)、`head`の組み立てを`src/head/page-heads.ts`に置き、`/help/{handle}`のルート(ログイン不要、404は`NotFoundPage`)を作る
  - 完了状態: テストが成功し、ローカルで公開の記事のURLを大文字の表記で開いても表示され、存在しないハンドルで他のページと同じ404になる
  - _Requirements: 3.1, 3.2, 3.10, 3.11, 4.2, 4.3, 4.4, 4.5, 4.7_

- [x] 7. 管理者側の画面
- [x] 7.1 管理画面の操作と、上下の移動による並べ替えの部品を作る
  - ヘルプの管理者側の操作をadminの`src/graphql/operations/help/`に1ファイル1操作の`*.graphql`(操作名は`Admin`で始める)で加え、adminで`bun run graphql:generate`を実行して型と`<操作名>Document`とpersisted operationsを生成する。取得の設定・取り直し・表示用への変換を`src/graphql/admin-help-articles.ts`・`admin-help-categories.ts`に置き、単体テストを併置する
  - 先に、ブラウザテスト(axeの違反0件)で、並べ替えの部品が項目ごとに名前付きの「上へ移動」「下へ移動」のボタンを持ち端のボタンが無効であること、押下で順が入れ替わり変更が通知されること、移動の後にフォーカスが移動した項目の同じボタンに残ること、移動の位置が読み上げられること、キーボードだけで操作できること、無効の状態でボタンを描かないことを確かめる
  - 完了状態: 型の生成とブラウザテストが成功し、`graphql:allowlist`と`graphql:check`が成功する
  - _Depends: 2.2, 5.2_
  - _Requirements: 9.8, 11.9, 12.2_

- [x] 7.2 カテゴリのページのヘルプ記事カテゴリの区画を作る
  - 先に、ブラウザテスト(axeの違反0件)で、カテゴリをAPIが返した順のまま並べること、削除の確認で付け替わる記事の件数と「その他」の末尾に並ぶ旨が示されること、拒否の文言の表示、カテゴリの並べ替えの編集・保存・キャンセルと古い並びの案内、閲覧のみの管理者で並びは見えて操作の導線が出ないことを確かめる
  - カテゴリの並べ替えの部品を作り、カテゴリマスタの編集部品と並べて区画に置き、カテゴリのページの区画の登録箇所に区画(order 20)を加える
  - 完了状態: ブラウザテストと、inquiry-chatのカテゴリのページのテストが成功し、ローカルで`/categories`に問い合わせカテゴリと並んでヘルプ記事カテゴリの区画が出て、並べ替えの結果がヘルプトップの順に反映される
  - _Requirements: 11.5, 11.7, 11.8, 11.9, 11.11, 12.2_

- [x] 7.3 管理者側の一覧と絞り込みを作り、メニューに加える
  - 先に、単体テストで絞り込みの条件の解析(不正な値の無視)・作成者の選択肢(削除済みは1つ)・3条件の組み合わせを、ブラウザテスト(axeの違反0件)で表の列(タイトルのリンク・ハンドル・カテゴリ・ステータス・ピン留め・作成者と削除済み・更新日時)、記事0件と絞り込み0件の区別、取得エラーの再試行(問い合わせのボタンと問い合わせを促す文が出ないこと)、モデレーター以上だけの「新規作成」と「並び順を変更」(閲覧のみは「並び順を見る」)、条件のURLへの保持を確かめる
  - 画面の本体を`components/pages/help-articles-page.tsx`、文言を`components/help/help-messages.ts`に置き、`/help-articles`のルート(`head`は`buildAdminPageHead`、`loader`は`admin-help-articles.ts`)を作り、管理画面のメニューに「ヘルプ記事」(order 100)を加える。リンク先の`/help-articles/new`・`/help-articles/order`・`/help-articles/$articleId`のルートは、型検査を通すため本タスクで仮の部品のファイルとして先に作り、7.4・7.6で置き換える
  - 完了状態: テストが成功し、ローカルでメニューから一覧を開くと下書きを含む全件がページ分けされずに出る
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 12.2_

- [x] 7.4 記事の並べ替えの画面を作る
  - 先に、ブラウザテスト(axeの違反0件)で、カテゴリの選択(クエリ`category`、無ければ並び順の先頭のカテゴリ)、選んだカテゴリの全記事(下書きを含む、ステータスのバッジ付き)が「ピン留めの記事」と「その他の記事」の2つの一覧に現在の並び順で分かれること、各群の中の並べ替え、保存でピン留めの群に続けてそれ以外の群の順のIDが送られること、成功のトースト、古い並びの案内と再読み込みの導線、「元に戻す」、閲覧のみの管理者で並びの表示だけになることを確かめる
  - 記事の並べ替えの部品(2つの群の一覧・保存・元に戻す)を作り、画面の本体を`components/pages/help-article-order-page.tsx`に置き、`/help-articles/order`のルートを作る
  - 完了状態: テストが成功し、ローカルで記事を並べ替えると利用者側のヘルプトップとフッターの順に反映される
  - _Depends: 7.1, 7.3_
  - _Requirements: 9.8, 9.9, 9.10, 9.11, 12.2_

- [x] 7.5 記事の作成・編集フォームの部品を作る
  - 先に、単体テストでフォームの検証規則がサーバーと同じ定数と判定から組み立てられることを、ブラウザテスト(axeの違反0件)でフォーカスアウトでの各欄の検証、ハンドルの使用可否の確認と使用中の文言・他の記事の旧ハンドルの解放の案内、旧ハンドルの案内(他の記事が設定すると転送が止まる旨を含む)、カテゴリの選択肢(APIの並び順)とカテゴリを変えると末尾に置かれる旨、ピン留めとステータスの既定値、本文のマークダウンの入力欄とプレビューと100,000文字のカウンター、フォームの値が`CreateHelpArticleInput`・`UpdateHelpArticleInput`と同じく`fields`の下(欄の名前は`fields.<名前>`)と`fields`の外の`reason`にあること、サーバーのエラー(使用中・欄ごとの詳細(`input.fields.<名前>`の詳細がその欄に出て、`input.fields`そのものの詳細はフォーム全体の失敗になり送信ボタンが無効のまま残らないこと)・カテゴリの不在・競合・削除済み)の表示、`GraphQLClientError`でない例外で問い合わせを促さない文言(`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`)を出すこと、閲覧のみの全欄の`FormField`の`disabled`による無効と保存の非表示を確かめる
  - 完了状態: ブラウザテストと単体テストが成功する
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.8, 6.9, 6.12, 7.7, 7.11, 11.7, 12.2_

- [x] 7.6 記事の作成・編集・削除の画面を作る
  - 先に、ブラウザテスト(axeの違反0件)で、作成の成功のトーストと編集画面への移動、編集の記事のIDと版(`expectedRevision`)をスキーマの入力に含めず`onSubmit`で読み込んだ値から送ることと成功のトースト、公開の記事だけの「公開ページを開く」(別タブ)、削除の確認(タイトルと元に戻せない旨・任意の理由)と成功のトーストと一覧への移動、削除済みの記事の案内と一覧への導線、閲覧のみの管理者で作成画面から一覧へ戻されることを確かめる
  - 削除のボタンの部品(確認のダイアログと実行)を作り、画面の本体を`components/pages/help-article-new-page.tsx`・`help-article-edit-page.tsx`に置き、`/help-articles/new`と`/help-articles/{id}`のルートを作る
  - 完了状態: テストが成功し、ローカルで記事を作成・編集・削除でき、保存した内容が利用者側の`/help`に出る
  - _Depends: 6.5, 7.5_
  - _Requirements: 6.10, 6.11, 8.1, 8.4, 8.5, 12.2_

- [x] 8. (P) 技術ドキュメントを書く
  - 先に、`frontend/008-markdown-editor-and-content.md`の「目次の作り方」の現在の規則(描画と同じ結果の見出しを使う、`id`をキーにする、折りたたみ付きの本文との併用)を読み、追記が既存の規則と重ならないことを確かめる
  - `frontend/008-markdown-editor-and-content.md`の「目次の作り方」に、PCの固定とモバイルの折りたたみ、固定ヘッダーの下に見出しが隠れない位置合わせ、見出しが無い場合に描かないこと、ランドマークの名前を本プロジェクト固有の値を含めずに追記し、`frontend`のREADMEの`008`の行の説明を合わせる(G2。`frontend/011`は作らない)。`backend/011-handle-namespaces.md`に「公開状態を持つ対象と、対象の削除での旧ハンドル」の節(解決の対象の条件と全行の現在のハンドルによる使用中の判定、保持者の状態の読み取り側の確認、公開されていない対象の保存でも現在のハンドルの書き込みの後に他の対象の旧ハンドルを解放すること、対象の物理削除の前の旧ハンドルの物理削除)を加える
  - 完了状態: 文書とREADMEが整形の検査を通り、本プロジェクト名とサービス固有の仕様を含まない
  - _Boundary: `docs/GUIDES/tech/frontend/008-markdown-editor-and-content.md`・`frontend/README.md`・`backend/011-handle-namespaces.md`_
  - _Requirements: 13.4_

- [x] 9. 検証
- [x] 9.1 E2Eテストで管理画面から利用者側までの流れを確かめる
  - 前提: api・event・client・adminの開発サーバーが動き、eventがQueueのメッセージ(索引の更新)を処理し、キーワード抽出が無効(`KEYWORD_EXTRACTOR=disabled`)のローカル環境で実行する
  - `e2e/admin/help-center.e2e.test.ts`と手順の`e2e/admin/help-center-steps.ts`: `admin-test.ts`と`client-page-test.ts`でモデレーターと利用者側のページを用意し、利用者側のURLはE2Eの対象の解決から得る。カテゴリの区画の操作は既存の`category-steps.ts`、本文の入力は`e2e/client/markdown-steps.ts`を使い、記事の作成・並べ替え・検索の結果の待ちは`help-center-steps.ts`の手順にする。カテゴリ「使い方」と「料金」を追加して「料金」を「使い方」より前へ並べ替え→「使い方」に公開・ピン留めの記事Aと公開の記事C・Dと下書きの記事Bを作成し、記事の並べ替えでDをCより前に→`/help`で「料金」の後に「使い方」が並び、A・D・Cの順でBが出ないこと、フッターにAのタイトル、Bのハンドルの詳細ページが404→Aのハンドルの大文字の表記で200と正規のURL、目次のリンクで見出しへ移動→検索でAが出てBが出ないこと(索引の更新を、検索のページの読み込み直しと`toPass`で待ち、時間切れの文言に確かめるべきログを書く)→Aのハンドルを変更して旧URLが302で新しいURLへ移ること(転送を追わない要求で状態と`Location`)→CのハンドルをAの旧ハンドルに変更して、そのURLがCを表示し302にならないこと→「使い方」を削除してA・C・Dが「その他」に出ること→Aを削除して新しいURLが404になること→監査ログの画面に各操作(並べ替えを含む)の表示名が出ること→閲覧のみの管理者で一覧と並び順は見えるが「新規作成」と並べ替えのボタンが無いことを確かめる。サンプルのドメインは`.example`だけを使う
  - 完了状態: ローカルでE2Eテストが成功する
  - _Depends: 6.5, 7.2, 7.4, 7.6_
  - _Requirements: 1.2, 1.3, 3.2, 3.7, 4.2, 4.4, 5.1, 7.4, 7.8, 8.2, 8.3, 9.8, 9.9, 11.4, 11.9, 12.2, 12.6, 13.3_

- [x] 9.2 全体の検査とカバレッジを確かめ、要件定義書の改訂の推奨を報告する
  - 整形の検査・静的解析・型検査と、単体テスト・Workers統合テスト・ブラウザテストを一括で実行し、本specが追加・変更したファイルのカバレッジが80%以上であることを確かめる。ログとSentryへの送信に記事の本文と検索語が含まれないことを検索で確かめる
  - research.mdの「要件定義書の改訂が必要な箇所」(確定した仮1〜仮5に伴う改訂)を作業の報告に記録する
  - 完了状態: すべての検査とテストが成功し、カバレッジの結果が閾値を満たし、報告に要件定義書の改訂の推奨が載っている
  - _Requirements: 12.7, 13.1, 13.2_

## Implementation Notes

- 1.1: 規則は`apps/common-lib/help/`(`help-input-rules.ts`・`help-query-rules.ts`・`help-article-status.ts`・`help-category-constants.ts`)、操作種別は`admin/audit-actions/help-center.ts`。設計に無い`HELP_BODY_RULE`(`MarkdownTextRule`、本文・100,000・必須)を`PRODUCT_DESCRIPTION_RULE`・`LEGAL_BODY_RULE`の先例に倣って加えたので、3.x・5.x・7.xは本文の規則にこれを使う。入力の検証の文言は設計どおりcommon-libに置かずapiの`errors.ts`・adminの`help-messages.ts`に置く。`normalizeHelpSearchText`はdirectory-discoveryの非公開の`normalizeSearchText`と同じ規則の再実装(約20行の重複、共通化は任意としてレビューで残した)。`checkHelpSearchQuery`は前後の空白を除いてから数える。`help-category.reorder`は対象無しだが`defineAuditAction`の制約で`maxTargets: 1`。1.2の初期データは`HELP_CATEGORY_OTHER_ID`(`01JC0000000000000000000001`)・「その他」・並び順1。100,000文字の本文の描画は約132ms
- 1.2: テーブルは`apps/db/schema/help/`、索引の定義`HELP_ARTICLE_SEARCH_INDEX`は設計の`help-article-search-documents.ts`ではなく先例(directory-discovery)に倣い`help-article-search-index.ts`に分け、`schema/index.ts`から再エクスポートせず`search/search-indexes.ts`が直接読む(2.1の検索対象もここから読む)。公開の条件`publishedHelpArticle`は設計どおり`SQL`の定数(`visibleProducts()`のような関数ではない)。マイグレーションは`20261111061811_help_center`(生成)・`…061812_help_center_seed`・`…061813_help_center_fts`で、drizzle-kitが3件を同じ秒で作り名前の順が崩れたためディレクトリ名の日時を1秒ずつずらした(`db/003`の初期データの節に手順を追記)。既定値は`revision`=1、`pinned`・`system_default`=false、`status`・`sort_order`は既定なし(書き込み側が必ず渡す)。dbはcommon-libを読めないためステータスの値と初期データのID・名前を写し、`config/help-contract-copies.unit.test.ts`(`check:contract-copies`に追加)で照合する。旧ハンドルを残したまま記事を消すと外部キーで拒否されるため、3.3の削除は旧ハンドルを先に消す
- 1.3: 文言は003の文言規則を正とする(design.mdの検索欄の超過・文字数の表示・取得エラーの文言を003に合わせて直した)。検索欄の超過は既存の「検索キーワードは50文字以内で入力してください。」をディレクトリと共用し、文字数は「<n>/50」。取得エラーは利用者側の既存の型「…時間をおいて再度お試しください。解決しない場合はお問い合わせください。」で、記事詳細の取得エラーを足した。設計に無い管理画面の文言(タイトル・サブタイトルの検証の6文言、一覧の列と「あり」「なし」、絞り込みの既定、作成・編集の題名と送信のボタン、並べ替えの題名と競合の導線「最新の並びを読み込む」、「理由(任意)」と「この操作は監査ログに記録されます。」)は003に足したので、6.x・7.xは003から文言を取る。`help_category_not_found`は「このカテゴリは削除されています。」、`help_category_protected`は409(設計どおり)。project-valuesの`SEARCH_TARGETS`・`ADMIN_NAV_ITEMS`・`CATEGORY_SECTIONS`などは後続の実装の最終の形で先に書いたので、2.1・7.2・7.3で実態と合わせる。ハンドルの名前空間の名前・GraphQLの操作・ログのカテゴリはproject-valuesに未記載で、9.2で追記する
- 2.1: 検索対象は`apps/backend-lib/workers/search/targets/help-articles.ts`の`HELP_ARTICLE_SEARCH_TARGET`(名前`help-article`)。`read`と`isIndexable`は同じ条件`and(eq(id), publishedHelpArticle)`を使い、版は記事の`revision`なので、3.xの公開の保存は保存ごとに`revision`を必ず1増やし、並べ替えとカテゴリの付け替えでは`revision`を変えない。キーワード抽出へ送るのは本文の正規化テキストだけ。テストの補助`apps/backend-lib/workers/help/testing/help-fixtures.ts`(`helpArticleIdOf`・`insertHelpArticle`・`clearHelpTables`(初期データの「その他」は残す)・`HELP_AUTHOR_ADMIN_ID`・`db`・`T0`、IDの接頭辞`01JD0HART`)は3.x・4のWorkers統合テストでも使う。Queueの経路の結合はeventの`src/composition/search-module.help-article.worker.test.ts`。設計の`targets/index.unit.test.ts`は実在の`index.worker.test.ts`に直した
- 2.2: 並び順は`apps/common-lib/help/help-ordering.ts`(戻り値の型に`PinnedHelpGroups<T>`・`HelpCategoryGroup<C, A>`・`HelpMoveDirection`の名前を付けた)。`groupPublishedArticles`は公開の状態を判定しないので、呼び出し側(4の公開の照会)は公開の記事だけを渡す。どのカテゴリにも属さない記事は結果から除かれる。フッター用のピン留めの順は専用の関数を作らず`groupPublishedArticles`の結果を`flatMap`でたどってピン留めだけを取り出す(4の`PublicHelpReader.pinned`は同じ書き方にする)。`moveItem`は端に加え範囲外の位置でも写しを返す。`planHelpHandleChange`(api domain)は共有の`isSameHandle`を使い、productの非公開の`planHandleChange`と同じ規則(約10行の重複)。`checkHelpCategoryEditable`は`systemDefault`だけで`'protected'`を返し、名前の変更と削除にだけ使う(並べ替えでは呼ばない)。標準カテゴリも並び順の値どおりに並ぶことの回帰テストを親が足した
- 3.1: 名前空間は`apps/backend-lib/workers/help/help-article-handle-namespace.ts`(解決の対象は`publishedHelpArticle`、使用中は下書きを含む全行の現在のハンドル)。確認の文は`apps/api/src/infrastructure/help/help-guards.ts`の`helpArticleExistsGuard`・`helpOrderGuard`で、取り消しの判定は`isHelpArticleGuardRejection`・`isHelpOrderGuardRejection`(NOT NULLの違反を`cause`までたどる、設計に無い)。並べ替えの確認は設計の`group_concat`ではなく、渡したIDのJSON配列の件数の一致と`NOT EXISTS(対象のID NOT IN json_each)`の2条件の集合の比較にした(順序の保証・区切り・0件のNULLの問題を避ける。design.md・research.mdを実装に合わせて直した)。記事の無いカテゴリは空の配列と一致する。`help-errors.ts`に設計に無い`helpCategoryMissingError()`(`validation_error`・欄`categoryId`、3.5がストアの`category-missing`で投げる)と`helpCategoryNameRejectedError(issue)`(3.2が使う)を足し、欄の詳細は`handle`の`unavailable`(product)・`name`の`name-taken`(inquiry)。`ports.ts`の入力に`HelpArticleCreateInput`・`HelpArticleUpdateInput`・`HelpOrderTarget`・`PublicHelpSearchHitRecord`の名前を付けた。`PreparedAuditEntry`は設計の`application/admin`ではなく既存どおり`lib/core/admin/audit-log.ts`から読む。`help-authors.ts`はインターフェースだけで3.6が実装を足す。テストの補助に`helpCategoryIdOf`・`insertHelpCategory`(接頭辞`01JD0HCAT`)・`helpPreviousHandleIdOf`・`insertHelpArticlePreviousHandle`(接頭辞`01JD0HPRV`)を足した。`clearHelpTables`は監査ログと標準カテゴリの並び順を戻さないので、監査ログを読むテストは各テストの前に`adminAuditLogTargets`・`adminAuditLogs`を消し、`help_categories`の更新を比べるテストは`updatedAt`を明示する
- 3.2: `StoreHelpCategoryService`(`HelpCategoryService`)と`D1HelpCategoryStore`。3.6で`HELP_TYPES.HelpCategoryService`・`HelpCategoryStore`へ束縛する。`timestamps()`の`updatedAt`は`$onUpdateFn`で更新の文ごとに現在時刻になるため、付け替えと並べ替えは`updatedAt: sql\`"updated_at"\``(`keepUpdatedAt`、今は`d1-help-category-store.ts`の中の定数)で元の値を保つ。3.3のピン留め以外の更新の扱いと3.4の記事の並べ替え(9.9)でも同じ対処が要るので、3.4で`infrastructure/help/`の共通の場所へ移す。一括の書き込みはbackend/008の規約どおり監査ログを先頭に置く(設計の並べ替えの流れの「確認→更新→監査ログ」とは順が違うが結果は同じ。3.4も同じ順にそろえる)。名前の変更・削除の監査ログは`condition`(編集できるカテゴリの存在)を付け、取り消しで`not-found`を判別する。理由(reason)は受け取らない。`create`は保存後に`findById`で読み直す。`delete`は`{ id, reassignedCount }`を返し、件数は削除前の`articleCount`(ポートの戻り値が`'deleted' | 'not-found'`のため実数ではない、同時の記事の増減でずれ得る)。並べ替えは`targetIds: []`で準備し`checkHelpCategoryEditable`を呼ばない。名前の一意は`NOCASE`(ASCIIの大文字小文字だけ)
- 3.3: `D1HelpArticleStore`は今は`implements Pick<HelpArticleStore, 'isHandleOccupied' | 'create' | 'update' | 'delete'>`で、3.4が`reorder`・`listAll`・`findById`・`findPreviousHandleHolder`を足して`implements HelpArticleStore`に戻す。`findById`は確定の後の読み直しに使う非公開の`#readRecord`(記事・カテゴリ名・旧ハンドルを1回の`db.batch()`)に委ねられる。一括の書き込みは監査ログを先頭に置く(設計は最後、backend/008に従った)。作成: 挿入→`previousHandleRelease`→公開なら`markPending`。更新: `helpArticleExistsGuard`→更新(`revision`+1、`updatedAt`は保存時刻を明示)→別の文字列なら`previousHandleRelease`→`previousHandleUpsert`→公開なら`markPending`・下書きなら`deleteSources`。削除: guard→`deleteSources`→`previousHandleDelete`→記事。取り消しは読み直しで`not-found`→`conflict`→`category-missing`→`handle-unavailable`に分類し、`SAVE_ABORT_VIOLATION_PATTERN`に当たらない失敗(監査ログの記録の失敗を含む)は投げ直す。保存の結果は確定とは別に読み直すので、確定の直後に消されれば`not-found`を返す(3.5はこれを「削除された」として扱う)。旧ハンドルの行のIDはストアで`ulid()`。`requestRefresh`は3.5の責務。テストは作成・削除と更新の2ファイルに分け、補助は`apps/api/src/infrastructure/help/testing/help-article-store-fixtures.ts`(3.4でも使う)
- 3.4: `D1HelpArticleStore`は`implements HelpArticleStore`に戻った。`keepUpdatedAt`は`apps/api/src/infrastructure/help/keep-updated-at.ts`へ移し、カテゴリのストアも使う。並べ替えは監査ログ(設計に無い`condition: categoryExists(categoryId)`付き。記事の無いカテゴリが並べ替えの最中に消されても空の配列が確認の文を通らないように)→`helpOrderGuard`→`json_each`の1文の更新(条件は`category_id = ?`と`id IN json_each(?)`、バインド変数は3つ)で、カテゴリの不在も`outdated`を返す。`listAll`は`ORDER BY id`で返すので、管理者側の一覧の更新日時の新しい順(9.2)は3.6の`HelpArticleAdminReader`、並べ替えの画面の並び(`help-ordering.ts`)は画面側で並べ直す。`findById`は`#readRecord`に委ねる。`findPreviousHandleHolder`はNOCASEの列で記事自身を除く。テストの補助に`reorderInputOf(categoryId, orderedIds)`を足した
- 3.5: `StoreHelpArticleEditor`(`HelpArticleEditor`)。3.6で`HELP_TYPES.HelpArticleEditor`へ束縛し、注入は`HELP_TYPES.HelpArticleStore`・`ADMIN_PLATFORM_TYPES.AuditLogRecorder`・`SEARCH_TYPES.RefreshRequester`・`PLATFORM_TYPES.IdGenerator`・`PLATFORM_TYPES.Clock`。検索対象の名前は`ports.ts`の`HELP_ARTICLE_SEARCH_TARGET_NAME`(設計に無い、eventの`PRODUCT_SEARCH_TARGET_NAME`の先例。定義との一致はD1のWorkers統合テスト)。索引の更新の依頼は捕まえずに直接呼ぶ(送信の失敗は要求の部品が記録して例外にせず要件10.4を満たす。届く例外は未登録の検索対象など呼び出しの誤りだけで、確定の後でもエラートラッキングへ伝える。全部を捕まえる案はレビューで差し戻した)。作成でも`not-found`・`conflict`を分類する。並べ替えの戻り値は`listAll`をカテゴリで絞って`sortHelpArticles`で並べる。並べ替え・カテゴリの操作は設計どおり理由を受け取らない(要件12.3の理由は任意)。入力の形式・文字数の検証は5.xのリゾルバの担当。テストの偽物は`application/help/testing/help-article-editor-fixtures.ts`。ログのカテゴリは`infra/004`の`[<アプリ名>, <層>, <モジュール>]`の形(`['api','application','help']`など)とし、design.mdを直した
- 3.6: `DirectoryHelpAuthorLookup`(`help-authors.ts`、照会の例外で空の結果と`warn`、属性は`error`と`count`だけ)と`StoreHelpArticleAdminReader`(全件は作成者を1回で引き更新日時の新しい順・同値はIDの新しい順、使用可否は形式違反→記事自身の現在・旧(大文字小文字を区別しない)→他の記事の現在→他の記事の旧(`available-releases-previous`)→使える、編集中の記事が無ければ新しい記事として判定)。`HELP_MODULE`(`apps/api/src/composition/help-module.ts`)は6つを処理単位で束縛し`MODULES`の`INQUIRY_MODULE`の直後に置いた。4は`PublicHelpStore`・`PublicHelpReader`を同じモジュールへ足し、`help-module.worker.test.ts`の`test.each`に2件を加え、公開の照会の作成者は`HELP_TYPES.HelpAuthorLookup`を注入して使う。eventには加えない。5.xのリゾルバは`listAll`の`creator`(`null`は削除済み)と`createdByAdminId`(管理者側だけ)を使う。project-valuesのヘルプの表に「ログのカテゴリ」の行を先に足したので、9.2は同じ行へ公開の照会などの分を追記する(行を重ねない)
- 4: `StorePublicHelpReader`(`helpCenter`・`findArticle`・`pinned`・`search`)と`D1PublicHelpStore`を`HELP_MODULE`へ束縛した。ストアはID順(検索はbm25の昇順・同順位はID順)で返し、表示の並びはユースケースの`groupPublishedArticles`・`sortHelpArticles`で決める。公開の条件・タイトル・ハンドル・カテゴリ名は索引文書ではなく記事の側の現在の値。`findArticle`はハンドルの形式違反・不在・解決の後の非公開・下書きの保持者の旧ハンドルを同じ`not-found`にし、`redirect`は現在のハンドルの表記を返す(302とクエリの引き継ぎは画面側)。`author: null`は「削除済みの管理者」。利用者側の結果は記事のIDと管理者のIDを含まない。`pinned()`の要素型は`PinnedHelpArticleView`(`{ handle, title }`)。検索は強調表示用の検索語を返さないので、5.3のリゾルバ(か画面)が`normalizeHelpSearchText`で切り詰めた語を`search`へ渡し、強調はその語から組み立てる
- 5.1: スキーマモジュールは`apps/api/src/presentation/graphql/modules/help/`で、`GRAPHQL_SCHEMA_MODULES`の`inquirySchemaModule`の直後に登録した。`HELP_TYPE_DEFS`は1つのSDL(`extend`を使わない)で、5.2・5.3は同じテンプレート文字列に型と`type Query`・`type Mutation`の項目を足し、`index.ts`の展開にリゾルバの表を1行加える。`resolver-support.ts`の`clientOnly`・`adminOnly`はproductの`callerOnly`と同じ形(拒否は`errors.ts`の`callerForbiddenError`)。カテゴリ名の検証はユースケースが行うのでリゾルバは`name: z.string()`だけ(inquiryの先例)。並べ替えの配列(1〜`HELP_REORDER_MAX`・重複なし・要素64文字まで)の違反は003に文言が無いため「並び順の競合」の文言(`INPUT_MESSAGES.orderInvalid`)を流用する(ユースケースのエラーの文言を入力の検証に流用する一般的な形)。カテゴリIDの64文字超過は「このカテゴリは削除されています。」。テストの補助は`apps/api/test/support/help-graphql-operations.ts`(`helpAdminGateway`・`HELP_ADMINS`・`installHelpAdminGraphQLTest`など)で、5.2で作成者の画像を使うときは`schemaModules`に`mediaSchemaModule`を加える。5.2で、IDの64文字超過・配列の要素の64文字超過・変更の操作の`unauthenticated`のテストを足す。許可リストの再生成はフロントエンドの操作を加える6.1・7.1で行う
- 5.2: 記事の操作は`admin-article-resolvers.ts`、作成者の画像は`author-fields.ts`の`helpAuthorFieldResolvers`(`codegen.config.ts`の`mappers`に`HelpArticleAuthor: author-fields.ts#HelpArticleAuthorSource`、中身は`HelpAuthorView`。5.3は作成者を`HelpAuthorView | null`で返せばそのまま使える)。編集・並べ替えの結果の作成者はリゾルバの`withCreators`が`HelpAuthorLookup`を1回呼んで補う(設計に記述なし)。欄の詳細の経路は`input.fields.<名前>`・`input.reason`(設計の`HelpInputs`の記述を直した)で、`input.fields`そのものの詳細は作られない。ステータスの変換表は`inputs.ts`(入力)と`admin-article-resolvers.ts`(出力)。ハンドルの文言はproductの非公開の`handleMessagesOf`の写し(約6行の重複)。`help-errors.ts`に`HELP_CATEGORY_MISSING_MESSAGE`を切り出した。記事のIDの64文字超過は「このヘルプ記事は削除されています。」、`reorderHelpArticles`の`categoryId`だけ並び順の競合の文言。テストはquery・save・reorderの3ファイル、補助は`apps/api/test/support/help-article-graphql-documents.ts`・`help-article-graphql-operations.ts`(ゲートウェイに`mediaSchemaModule`を加えた)。編集の理由の詳細と監査ログ・照会の`unauthenticated`・編集での100,000文字のテストは無い(任意)
- 5.3: 利用者側の4つの照会は`public-resolvers.ts`で、全て`clientOnly`で包む。検索語は`HELP_ARTICLE_SEARCH_ARGS`(`z.string().transform(normalizeHelpSearchText)`)で拒否せず切り詰め、空・空白だけはユースケースを呼ばずに`[]`。強調表示用の検索語は応答に含めない(SDLどおり)ので、6.2の画面は自分のURLの`q`を`normalizeHelpSearchText`で切り詰めた語から強調を組み立てる。`helpArticle`の`handle`は検証せずユースケースが形式違反を照会の前にnullにする(productの`productPage`と同じ)。共用体`HelpArticleResult`は`'body' in result`で`HelpArticle`/`HelpArticleRedirect`を分ける。レート制限・キャッシュは加えない(legal・directoryの先例)。利用者側の操作の書き方(操作名は`Client`で始める)は`apps/api/test/support/help-public-graphql-operations.ts`が6.1の参考になる。`indexPublishedHelpArticle`を`help-article-store-fixtures.ts`へ移して共用にした。公開の型に記事のIDと管理者のIDが無いことは合成したスキーマの項目の一覧で固定している
- 6.1: 操作は`apps/client/src/graphql/operations/help/`の4つ(`ClientHelpCenter`・`ClientHelpArticle`・`ClientHelpArticleSearch`・`ClientPinnedHelpArticles`)、取得の設定は`src/graphql/help-center.ts`の`helpCenterQueryOptions`・`helpArticleQueryOptions(handle)`・`helpArticleSearchQueryOptions(query)`・`pinnedHelpArticlesQueryOptions`(検索語の切り詰めは呼び出し側の6.2の`validateSearch`)。作成者の画像は`id objectKey fallbackFormat width height`(`MediaImageView`)。`PinnedHelpLinks`は`useQuery`で`data`が無ければ何も描かず、`<a href="/help/<encodeURIComponent(handle)>">`で並べる(ルートが無かったため。ページ全体の読み込みで取り直すので要件5.4に合う。6.5の後に`Link`へ替えるなら5.4との関係を考える)。サーバー側の描画にピン留めは含まれない(設計どおり)。全ページのレイアウトで取得するため`apps/client/test/page-router.tsx`に`cachedPinnedHelpArticles`(既定は空の一覧`NO_PINNED_HELP_ARTICLES_QUERY`をキャッシュ、`null`で取得させる)を足したので、6.2・6.5のルートのテストは`renderPageRouter`のままでよい。設計の`graphqlQueryOptions(pinnedHelpArticlesDocument)`の記述は実際の`pinnedHelpArticlesQueryOptions()`(`ClientPinnedHelpArticlesDocument`)と名前が違う
- 6.2: `/help`は`routes/help/index.tsx`(`validateSearch: normalizeHelpTopQuery`・`loaderDeps: ({ q })`・`loader: loadHelpTopPage`・`head: buildHelpTopHead`)。最初の表示(`'enter'`・`'preload'`・SSR)は待って`pendingComponent`・`errorComponent`(どちらも見出しと検索欄の`HelpTopFrame`で包む)、同じページ内の遷移(`cause === 'stay'`)は待たず、本文の`HelpTopContent`(`help-top-content.tsx`)が`useQuery`(検索結果は`keepPreviousData`)で読み、再読み込みの間は直前の結果を`inert`・`aria-busy`で残し件数の欄を「読み込み中…」にする(`frontend/014`、検索欄のフォーカスを保つ。最初の実装は差し戻した。design.mdに1文追記)。directoryの`SearchForm`とヘルプの`HelpSearchForm`はclient内の共用の`components/search/keyword-search-form.tsx`(`KeywordSearchForm`、文言は`keyword-search-form-messages.ts`)を包む。設計に無い`help-top-frame.tsx`・`help-top-error.tsx`(再試行は押した直後と取得の後に`main h1`へフォーカス)・`help-top-content.tsx`・`site-links.ts`の`HELP_TOP_HREF`を足した。`HelpArticleLinkItem`に`categoryName`の引数。強調は`q`に`normalizeSearchTerms`をかけ`findHighlightRanges`(語の先頭からの一致だけ)。取得エラーは003の固定の文言(429の`message`は示さない)。仮の`/help/$handle`は`notFound()`で6.5が置き換える。`renderInRouter`を使う部品のテストは`execute-graphql.ts`を`vi.mock`する必要がある。`routeTree.gen.ts`は開発サーバーを一時的に動かして生成する。6.4の記事詳細の検索欄は`HelpSearchForm value={undefined}`。0件の結果のまま再読み込みに入った間は読み上げが無い(任意の改善)
- 6.3: `HelpTableOfContents({ headings })`(`MarkdownHeading[]`だけを受ける)は、PCの`<nav aria-label="目次">`(見える`<p>目次</p>`付き、`lg:sticky lg:top-20`、長い目次は`lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto`)と、1024px未満の`<details>`(`<nav>`で包まない、既定は閉じる)を常に両方描き、CSS(`lg:hidden`・`hidden lg:block`)で出し分ける(片方は`display:none`なので2重には読まれない)。0件なら何も描かない。文言は`help-messages.ts`の`HELP_TABLE_OF_CONTENTS_LABEL`。6.4への申し送り: 部品はフラグメントを1か所に返すので、PCの右のカラムとモバイルの本文の前の両方に出るよう配置する。`sticky`が効くには、目次をグリッドの項目として直接置く(その項目自体が`sticky`になる)か、包む列を本文と同じ高さまで伸ばす(既定の`stretch`)必要があり、テストで`position: sticky`が効く(スクロールしても見える)ことを確かめる
- 6.4: 記事詳細の部品は`HelpArticlePage({ article })`・`HelpArticleAuthor`(既存の`AdminAvatar`32px、削除済みは「削除済みの管理者」の`HELP_DELETED_AUTHOR_LABEL`とプレースホルダー)・`RelatedHelpArticles`(`<section aria-labelledby>`、0件は描かない)・`HelpArticleSkeleton`(「ヘルプ記事を読み込み中」)と、設計に無い`HelpArticleToolbar`(`help-article-toolbar.tsx`、検索欄と「ヘルプトップへ戻る」、ページとスケルトンで共用)。表示用の型`HelpArticleView`・`HelpArticleAuthorView`は`src/graphql/help-center.ts`。目次はグリッドの右の列(`lg:col-start-2 lg:row-start-1`、既定のstretch)に包み、DOMでは本文の前(モバイルで本文の前に出すため。PCではTabの順が見た目の順と厳密には合わないが受け入れた。タスク8の`frontend/008`への追記でこの配置の規約を書く)。見出し0件はグリッドを使わず全幅。本文のIDを持つ全要素に`[&_[id]]:scroll-mt-20`(80px、脚注を含む)。目次の列の幅は15rem。3.11の取得エラーは6.5のルートの`errorComponent`が担当し、スケルトンと同じく`HelpArticleToolbar`の下に置いて検索と戻る導線を残し、再試行の後のフォーカスの移り先(記事の`h1`が無い)を決める
- 6.5: `/help/$handle`は`loadHelpArticlePage`(形式違反とnullは`notFound()`、転送は`redirect({ to: '/help/$handle', params, search: location.search, statusCode: 302 })`、productの`loadProductPage`と同じ形)・`buildHelpArticleHead`(正規のURLは現在のハンドルの表記)・`component`は`HelpArticlePage`(`useSuspenseQuery`+`select: toHelpArticleView`、`key={article.handle}`)・`pendingComponent`は`HelpArticleSkeleton`・`errorComponent`は新規の`HelpArticleError`(`HelpArticleToolbar`の下に見えない`h1`「ヘルプ記事詳細」と失敗の表示。design.mdの`ErrorState`の記述を直し、003に見出しの文言を追記)・`notFoundComponent`は`NotFoundPage`。6.2の`help-top-error.tsx`(`HelpTopError`)は削除し、`help-load-error.tsx`の`HelpLoadError({ message, onRetry })`へ置き換えてヘルプトップと記事詳細で共用する(押した直後と取得の後に`main h1`へフォーカス、`tabindex`が無ければ付ける。`frontend/004`の81行目の「描き直しの確定の時点で移し、外へ移したら奪い返さない」とは異なるが`ProductPageError`と同じ)。`site-links.ts`の`helpArticleHref(handle)`をフッターの`PinnedHelpLinks`でも使う(`<a href>`のまま、要件5.4)。SSRが渡すキャッシュの中身は形式違反(照会なし)と下書き・不在(`helpArticle: null`)で違うが、画面とステータスは同じ(productと同じ)
- 7.1: 操作はadminの`src/graphql/operations/help/articles/`(7)・`categories/`(5)、設計に無いフラグメント`src/graphql/fragments/help/`(`AdminHelpArticleRow`・`AdminHelpArticle`・`HelpCategory`、`coding/004`どおり)。表示用の型は設計の`AdminHelpArticle`・`HelpCategory`を`AdminHelpArticleRowView`・`AdminHelpArticleView`・`AdminHelpArticleAuthorView`・`HelpCategoryView`・`HelpCategoryEntries`に読み替える。ステータスは`'draft' | 'published'`、使用可否は`'available' | 'available-releases-previous' | 'unavailable' | 'invalid'`(`toHelpArticleHandleAvailability`)、送信は`toGraphQLHelpArticleStatus`。`loader`の関数は7.3・7.4・7.6が`admin-help-articles.ts`へ足す。`helpArticleHandleAvailabilityQueryOptions(handle, articleId?)`は作成で`articleId: null`。7.4は`toHelpArticleOrderGroups(rows, categoryId)`で2つの群を得て`[...pinned, ...others]`を送る。7.2は`toHelpCategoryEntries`・`toHelpCategories`。取り直しは記事の変更で`invalidateHelpArticleQueries`(記事の一覧・1件・使用可否とカテゴリの一覧)、カテゴリの変更で`invalidateHelpCategoryQueries`(カテゴリの一覧と記事の一覧・1件)。7.6は削除の後に`adminHelpArticle`を無効にすると一覧へ移る前に「削除されています」が一瞬見え得るので、移動と無効化の順を考える。`ReorderableList`(adminの`components/help/`、制御された部品)は端のボタンをフォーカスがある間`aria-disabled`・離れたら`disabled`(`frontend/010`)、フォーカスを移さない押下でも`useLayoutEffect`で移動した項目の同じボタンへフォーカスを置く(差し戻しでテストを足した)。文言は`components/help/help-messages.ts`(7.2〜7.6も追記する)
- 7.2: `HelpCategorySection`(`CATEGORY_SECTIONS`の`help-center.help-categories`・order 20)は共用の`CategoryMasterEditor`に、設計に無い2つの省略できるpropを足して使う: `children`(表の後ろ・区画の中に`HelpCategoryOrderEditor`を置く)と`readOnlyDisplay?: 'disabled' | 'hidden'`(既定`'disabled'`、ヘルプは`'hidden'`で閲覧のみに追加・編集・削除・操作の列・権限が無い旨を描かない。要件12.2・002の「導線を表示しない」に合わせた。プロダクト・問い合わせの区画は無効の表示のまま。005に追記)。並べ替えは開始時のIDの順を手元に持ち表示名は最新の一覧から引く、成功で応答をキャッシュへ置きトーストと`invalidateHelpCategoryQueries`、「最新の並びを読み込む」は`staleTime: 0`で取り直す、フォーカスは開始と読み込みの後は最初の押せる移動ボタン・保存とキャンセルの後は「並び順を変更」、編集中は「この操作は監査ログに記録されます。」(003に並べ替えの記載は無い)。7.4は`HELP_ORDER_SAVE_LABEL`・`HELP_ORDER_SAVED_MESSAGE`・`HELP_ORDER_OUTDATED_MESSAGE`・`HELP_ORDER_RELOAD_LABEL`を使い`help-category-order-editor.tsx`と同じ形にそろえる。範囲外で`audit-logs-page.browser.test.tsx`の操作種別の期待に1.1の8件を足した(1.1から失敗していた)。開発サーバーでの確認はしておらず9.1のE2Eで確かめる
- 7.3: `/help-articles`は`validateSearch: parseHelpArticleFilter`・`loader: loadAdminHelpArticlesPage`(記事とカテゴリを`Promise.all`、失敗は`.catch`でキャッシュに残し部品は`useQuery`)で`loaderDeps`を持たず、全件を1回で読んで絞り込みは画面の中で行う(取得し直さない)。条件の適用は設計の「置き換える」ではなく`frontend/014`どおり`navigate({ search, resetScroll: false })`で履歴に加える(戻る・進むで復元、要件9.5)。クエリは`creator`(管理者ID、削除済みは`deleted`=`DELETED_CREATOR_VALUE`)・`category`・`status`(`draft`・`published`)で、IDは1〜64文字だけ受ける(数として届いたIDは捨てる。014の「文字列へ戻す」とは違うがULIDで実害なし)。作成者の選択肢は`Intl.Collator('ja')`、URLの条件が選択肢に無ければIDのまま加える。設計に無い`help-article-status-badge.tsx`(`HelpArticleStatusBadge`)は7.4でも使う。一覧の見出しは見えない`h2`(再試行でフォーカス)。取得エラーは問い合わせを促さない。メニューに「ヘルプ記事」(order 100)を加え、メニューの順の既存の3テストの期待を更新した。仮の`new.tsx`・`order.tsx`・`$articleId.tsx`は`notFound()`(7.4・7.6が置き換える)。テストの補助は`apps/admin/test/admin-help-articles-fixtures.ts`(`respondAdminHelpArticlesGraphQL`・`renderHelpArticlesPage(role, path)`)で7.4・7.6も足して使う。セルの文言を読むときは既定の画像の頭文字(`aria-hidden`)を除く。開発サーバー+ログインでの確認はしておらず9.1のE2Eで確かめる
- 7.4: `/help-articles/order`は7.3の`loadAdminHelpArticlesPage`を共用し、クエリ`category`は`parseHelpArticleOrderSearch`(形式の不正は`HELP_ID_SEARCH_FIELD`で未指定)・`selectHelpOrderCategory`(未指定・存在しないカテゴリは並び順の先頭、URLは書き換えない)で、2つは設計のFile Structure Planに無い`apps/admin/src/components/help/help-article-order-search.ts`に置いた(`*.unit.test.ts`を併置)。カテゴリの選択は履歴に加える遷移で、部品を`key={category.id}`で作り直すため未保存の並びは確認なしに破棄する(設計・002に記述なし、失うのは移動の操作だけ)。`HelpArticleOrderEditor`は「並び順を変更」の状態を持たず、モデレーター以上には常に移動・保存・元に戻すを出す(002どおり)、閲覧のみはボタンと監査ログの案内を描かない。保存は`[...pinned, ...others]`、成功の後は応答から、「最新の並びを読み込む」の後は取得の結果から`toHelpArticleOrderGroups`で手元の並びを作る(キャッシュの更新が`setTimeout(0)`で届く前に古い並びが1フレーム見えないように。保存の後に他の管理者が足した記事は「元に戻す」か再読み込みまで並びに出ない)。キャッシュへは設計に無い`mergeReorderedHelpArticles`で重ねてから`invalidateHelpArticleQueries`。読み込みの間は「元に戻す」を`aria-disabled`にし、完了時にフォーカスが読み込みのボタンにある時だけ最初の移動ボタンへ移す(`frontend/004`の奪い返さない)。同じ修正を7.2の`help-category-order-editor.tsx`(「キャンセル」)にも水平展開した。7.2の保存の成功で表の並びが1フレーム古く見える可能性は残っている(`CategoryMasterEditor`へ渡す一覧を応答から作れば解消する、任意)。古い並びのテストの2回目の保存の応答の偽物は`reorderHelpArticles: []`のまま(任意で実際の形に直す)
- 7.5: フォームは`HELP_ARTICLE_FORM_SCHEMA`(`help-article-form-schema.ts`、サーバーと同じ`checkHelpTitle`・`checkHelpSubtitle`・`checkHandleFormat`+`HELP_ARTICLE_HANDLE_RULE`・`markdownTextSchema(HELP_BODY_RULE)`・`REASON_SCHEMAS.optional`)・`HelpArticleForm`(Propsは判別共用体`{mode:'create'} | {mode:'edit'; article}`、保存を自分で実行し`onSaved(article)`を呼ぶ。値は`fields.<名前>`と`reason`、`serverFieldPrefix="input"`)・`HelpArticleHandleField`(読み込んだハンドルと同じなら問い合わせない、`invalid`の応答は無視、他の記事の旧ハンドルの解放の案内は欄の説明に出す)。7.6への申し送り: トースト・移動・`invalidateHelpArticleQueries`は`onSaved`で行う。初期値は最初に1回だけ読み`id`・`expectedRevision`は保存の時点のpropから読むので、記事を差し替える時はフォームを`key`で作り直すか編集中に差し替えない。閲覧のみは全欄を`FormField`の`disabled`で無効にし、保存・理由の欄・監査ログの案内を描かない。カテゴリの末尾に並ぶ旨は編集のときだけ。競合はAPIの文言だけ、削除済みは「ヘルプ記事の一覧へ」を添える。検証の文言はapiの`INPUT_MESSAGES`の写しで、`config/help-contract-copies.unit.test.ts`で一致を照合する。差し戻しで、`FormField`の子の値を展開して受けると`labelId`(列挙されない)が落ちてラジオの組に名前が無くなる欠陥を直し、既存の`change-role-dialog.tsx`にも水平展開した。テストの補助は`help-article-form-testing.tsx`(7.6も`respond`・`ARTICLE`・`savedArticleOf`を使える)
- 7.6: 作成画面`/help-articles/new`(`beforeLoad`の`requireHelpArticleEditor`で閲覧のみを一覧へ戻す)・編集画面`/help-articles/$articleId`(IDの形式違反は`notFound()`、nullは案内と一覧への導線)・`HelpArticleDeleteButton`。編集画面の記事の1件は開いた時点の版を競合の基準にするため`staleTime: 0`(カテゴリは`'static'`、design.mdに例外を追記)、部品は`refetchOnMount: false`。保存の後は応答の記事を状態に置きフォームを`key={article.revision}`で作り直し、他の画面の変更による取り直しでは差し替えない。保存のボタンが消えてフォーカスが`<body>`へ落ちた時だけ題名`h1`へ移す。削除は`refreshHelpArticleQueriesAfterDelete`(一覧とカテゴリを取り直し、1件と使用可否は古い印だけ)を待ってからトーストと一覧への移動(削除済みの案内や削除した行が一瞬も出ない)。既に削除済み(`help_article_not_found`)と分かった時も同じ関数で一覧を取り直す(親がレビューの提案で足した、削除のボタンとフォームの両方)。共用部品`ConfirmActionDialog`に省略できる`failureActionOf`を足し(005)、ダイアログの中に一覧への導線を出す。`use-client-site-href.ts`を`components/legal/`から`components/layout/`へ移した。「公開ページを開く」(別タブ、`rel="noopener"`、「(新しいタブで開きます)」はclientの`NEW_TAB_NOTICE`と重複)は題名の横。開発サーバーでの確認はしておらず9.1のE2Eで確かめる
- 8: `frontend/008`の「目次の作り方」の既存の規則の後ろに、本文の横に置く目次(両方を描いてCSSで出し分け)・DOMの順(`004`の手動確認のTab順の項目の例外として明記し、`004`の表の後にも`008`への参照を足した)・固定が効く配置・`scroll-margin-top`・見出しが無い本文・ランドマークの名前を追記した。具体の値はプレースホルダー(`<目次の列の幅>`など)にし、本プロジェクトの値はproject-valuesの表に置いた。`backend/011`に「公開状態を持つ対象と、対象の削除での旧ハンドル」の節(mermaid)を加え、`frontend/README.md`・`backend/README.md`の行を合わせた。既存の「目次の作り方」冒頭のコード例の`aria-label="目次"`は定数にしていない(既存の部分のため)
- 9.1: `e2e/admin/help-center.e2e.test.ts`・`help-center-steps.ts`はローカルの開発サーバー4つ(api・eventは`run-with-secrets --scope local`、client・adminは`infisical run --env dev`。eventのローカルの`wrangler.jsonc`はキーワード抽出が既定で`disabled`)で`infisical --telemetry=false run --env dev -- bun run test:e2e e2e/admin/help-center.e2e.test.ts --project admin`が3回成功し、既存のカテゴリのE2Eも成功した(7.2・7.3・7.4・7.6が回した開発サーバーでの確認を兼ねる)。アプリのコードの不具合は無かった。設計に無い記事Eを「料金」に足した(公開の記事が無いカテゴリは`/help`に出ないため)。管理画面の並べ替えの一覧の項目はリンクではない。見出しのIDは`slugifyHeading`でパーセントエンコードされる。実行のたびに記事B(下書き)・C・D・E・「料金」・管理者がローカルの状態に残る(`docs/onboardings/README.md`に記載)。要件8.3の「削除した記事の旧ハンドルも404」はこの流れでは確かめられない(Aの旧ハンドルはCが取る)。レビューの後に親が、カテゴリの表の順の読み取りを`expect.poll`にした(7.4の1フレームの遅れに備える。E2Eは再実行しておらず型検査・lintだけ確かめた)。任意: 削除後の検索で0件の文言を確かめる形にする
- 9.2: `bun run check`・`test:all:unit`・`test:all:worker`・`test:all:browser`(いずれも`--coverage`)は全て成功(3種を同時に動かすとapiのWorkers統合テストのタイムアウトやadminのlintのメモリ不足(137)が起きるため、順に実行すると安定する)。本specのファイルはファイルごとの行と関数が全て80%以上(最低はclientの`help-top-content.tsx`の81.0/80.0でちょうど閾値)。client・adminの`help-messages.ts`の関数が未達だったので単体テストを足した。ログ・Sentryへ送るのは`help-authors.ts`の`warn`(`error`と`count`)とadminの`reportUnexpectedErrorInBrowser`だけで本文と検索語は含まない(範囲外の残る危険: Drizzleの`DrizzleQueryError`の文言にバインドした値(検索語・本文)が入り、GraphQLの共通の`reportUnexpected`からログとSentryへ送られ得る。全体の伏せ字で`params`を除くかは開発者の判断事項)。project-valuesに名前空間の名前・GraphQLの操作の行・ログのカテゴリを追記し、CLAUDE.mdのディレクトリ構成に`help/`を3か所足した。要件定義書の改訂の推奨: 仮1〜仮5は2026-10-25に適用済み(FR-ADMAG-006・018・026〜031、FR-HELP-001・002・006・011、FR-ADMCF-009(カテゴリ名の重複)・013・015・025)。追加の推奨は(a)FR-ADMAG-001に並べ替えとヘルプ記事カテゴリの操作では理由を入力しない旨、(b)FR-ADMCF-009の大文字小文字の同一視がASCIIだけである旨、(c)カテゴリの削除の件数が目安である旨の注記(任意)、(d)記事の並べ替えの画面でカテゴリを切り替えると未保存の並びを確認なしに捨てる旨(任意)、(e)要件8.3の旧ハンドルの404はWorkers統合テストで確かめE2Eの範囲外である旨の注記(任意)、(f)閲覧のみのカテゴリの区画の表示がヘルプ(非表示)とプロダクト・問い合わせ(無効)で違うこと、(g)APIが51文字以上の検索語を切り詰める旨(任意)。また、spec側の`requirements.md`の追跡の番号は改訂前の番号(FR-ADMCF-014・FR-ADMAG-017など)のままなので、改訂後の番号へ直すことを推奨する
- 最終検証(2026-11-11): `kiro-validate-impl`はGO。本specに関係するテストの範囲・型検査・lint・`graphql:check`・`check:contract-copies`・`db:migrations:check`を新しく実行して全て成功し、開発サーバー4つを起動してE2E(`e2e/admin/help-center.e2e.test.ts`)も2件成功した(9.1の後の`expect.poll`の変更を含む)。要件の受け入れ基準106件のうち103件を満たし、部分的な3件は12.7(上流のbackend-platformの伏せ字が`DrizzleQueryError`のバインドした値を除かない)・11.2(`NOCASE`はASCIIだけ)・12.3(並べ替えとカテゴリの操作は理由を入力しない)で、いずれも開発者の判断事項。検証の指摘でdesign.mdの上流への影響の表・Revalidation Triggers・Modified Files・System Flowsの監査ログの位置・並べ替えのバインド変数の数・エラーの詳細の経路を実装に合わせて直した。残る任意の改善: `help-top-content.tsx`の関数のカバレッジがちょうど80%、`presentation/.../help/errors.ts`が隣の`inquiry/errors.ts`を読む、フラグメント名`HelpCategory`に`Admin`が付かない、clientの文言の003との照合のテストが無い
- 最終検証の後(2026-11-11): 開発者の判断で、要件12.7の上流の残りを共通の部品(backend-lib)で塞いだ。Drizzleの`DrizzleQueryError`の文言`Failed query: <SQL>\nparams: <値>`のうち、SQLは残し値だけを`[REDACTED]`にする(`redaction.ts`の`QUERY_PARAMS_PATTERN`を`REDACTION_PATTERNS`の先頭に置き、`log-record.ts`の`serializeError`と`scrub-event.ts`の`scrubException`は`redactQueryParams`を通す。frontend-libの写しと`config/contract-copies.unit.test.ts`の照合も合わせた。backend-platformのImplementation Notesにも記録)。導入済みのdrizzle-orm `1.0.0-rc.5`は接続の設定`paramsInErrors`が有効なときだけ値を文言に含め、`createDatabase`は設定していないため、変更前も実際には漏れていなかった(防御の層。`infra/004`に「`paramsInErrors`を有効にしない」規則を書いた)。あわせて、spec側の`requirements.md`・`brief.md`・`design.md`・`research.md`と`002-page-layouts.md`の要件番号を改訂後の要件定義書に合わせた(既存の番号は2026-10-25の振り直しで付け替え済みで、主な修正は仮1〜仮5で加わった番号(FR-ADMAG-006・018・027・030・031、FR-ADMCF-009・015・025、FR-HELP-001・006など)を受け入れ基準の根拠に足すこと。9.2の「FR-ADMAG-017などが古いまま」は誤りで、017は正しい番号だった)。`brief.md`の「予約語一覧はハンドル基盤の共通の一覧を使う」は仮2の前の内容のまま(要件の文言のため変えていない)
