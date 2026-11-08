# Implementation Plan

- [x] 1. 基盤: 共有の規則・テーブル・文言
- [x] 1.1 ハンドル・プロフィールの入力・外部URLの規則を共有定義として作る
  - 前提: dev-tooling・backend-platform・api-gateway・email-delivery・frontend-platform・infra-delivery・content-processing・media-pipeline・identity-auth・admin-foundation・legal-pages・inquiry-chat・payments・ultras-subscriptionの全タスクが完了していること(`users`の列・ライフサイクルの登録口・`HANDLE_AVAILABILITY`・`AccountGuard`・設定ページのシェル・画像のアップロードと保有者単位の操作・マークダウンの部品・`UltrasEntitlements`・`InquirerProfiles`・E2Eの`e2e/support/mailpit.ts`)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、ハンドルの形式(1文字・25文字・26文字・先頭のハイフン・空白・全角・アクセント付きの文字)、ASCIIの英字だけを小文字にする同一視、予約語の14語の大文字小文字を区別しない完全一致(`admin1`は一致しない)、ヘッドライン50・外部Webサイトの名前25書記素の境界、外部URLの`https`・`http`の絶対URL(スキームの大文字小文字は問わない)と2,048・2,049文字・`javascript:`・`data:`・相対URL・スキームの直後に`//`の無い値(`https:a.example`、G5)の拒否、件数の上限10(仮3)、用途`user-avatar`と512,000バイトの単体テストを書く
  - 4アプリが読み込める共有ディレクトリにハンドルの規則・プロフィールの入力規則・外部URLの規則を置く。zodを使わず、書記素の数え方と禁止文字の判定はcontent-processingの部品を使う
  - 完了状態: 単体テストが成功し、client・admin・api・eventの型検査で配置先から読み込める
  - _Requirements: 1.1, 1.2, 1.5, 3.2, 3.5, 3.6, 4.4, 4.6_

- [x] 1.2 旧ハンドルの共通の列と、プロフィール・外部Webサイト・旧ハンドル・フォローの4テーブルを定義し、マイグレーションを作る
  - 先に、旧ハンドルの共通の列(保有者のIDの一意と外部キー、大文字小文字を区別しないハンドルの一意、論理削除の列)、プロフィールの利用者の一意と画像のIDに外部キーが無いこと、外部Webサイトの位置のCHECK(0〜9)と`(user_id, position)`の一意、フォローの組の一意・自分自身を拒むCHECK・2つの索引、すべての外部キーが`ON DELETE`を指定しないことを確かめる単体テストを書く
  - スキーマの集約点へ加え、mainの最新を取り込んでからマイグレーションを生成し、旧ハンドルの列の`COLLATE NOCASE`とCHECKが含まれることを確かめる。テーブル名の一覧を完全一致で確かめる既存の`apps/db/schema/index.unit.test.ts`の期待値に4テーブルを足す
  - 完了状態: 単体テスト(既存の`apps/db/schema/index.unit.test.ts`を含む)が成功し、マイグレーションをローカルに適用でき、大文字小文字だけが違う旧ハンドルを2行作れず、自分自身へのフォローの行を作れない
  - _Requirements: 2.1, 3.1, 9.3, 9.11, 11.1_

- [x] 1.3 (P) ページ配置と文言規則に、公開プロフィール・編集画面・フォロー一覧の配置と文言を先に書く
  - ページ配置: 公開プロフィールの区画の登録(タブ・受賞バッジ・「…」メニュー)と登録が無いときの表示、旧ハンドルの扱い(他の利用者が保持する旧ハンドルも設定でき、その時点で元の保持者の旧ハンドルを削除して転送を止める(仮2)、大文字小文字だけの変更では保持しない、停止中の保持者の旧ハンドルは404)、`/settings/profile`の欄の並びと停止中の表示、`/settings/follows`のタブと一覧の項目を記載する
  - 文言規則: 外部Webサイトの件数(10件、仮3)の行、エラーの文言(設計のError Handlingの表)、保存・フォロー解除のトースト、フォロー一覧の0件、停止中の編集画面、旧ハンドルの案内の文言を加える
  - 完了状態: 2つの文書が整形の検査を通り、5・7・8のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md`_
  - _Requirements: 13.5_

- [x] 2. ハンドル基盤とプロフィールの共有部品
- [x] 2.1 ハンドル基盤のD1の部品を作る
  - 先に、ローカルD1を使うWorkers統合テストで、大文字小文字の違いでの解決、現在のハンドルの優先、論理削除済みの旧ハンドルが解決に出ないこと、既定の使用中の判定が他の対象の現在のハンドルだけを数え、`includePrevious`のときだけ他の対象の旧ハンドル(論理削除済みを含む)も数えること(仮2)、本人の除外、他の対象の旧ハンドルの解放の文がその行(論理削除済みを含む)だけを物理削除し本人の行を消さないこと、旧ハンドルを持たない対象での判定、使用中の条件を埋め込んだ文が使用中のときに一括の書き込みを取り消すこと、旧ハンドルの置き換えで1行のまま値が変わり論理削除が解けることを確かめる
  - 対象の記述(現在・旧のテーブルと列、規則、解決の条件)の型と検証、解決・使用中の判定・`CASE`式に埋め込む条件・旧ハンドルの置き換え・他の対象の旧ハンドルの解放・論理削除・削除の文を、利用者に閉じない部品として作る
  - 完了状態: Workers統合テストが成功し、部品が利用者のテーブルを直接参照しない(対象の記述だけを受け取る)
  - _Requirements: 1.3, 1.4, 1.6, 2.1, 3.1, 3.3, 3.4, 3.8_

- [x] 2.2 利用者のハンドルの対象と、利用者の表示の照会・ハンドルの解決を作る
  - 先に、Workers統合テストで、表示の照会が3つの範囲(可視だけ・停止中を含む・停止中と退会済み(物理削除前)を含む)を守ること(退会済みは3つ目の範囲だけで返す、G1)、90件を超えるIDの一括の照会、プロフィールの行が無い利用者の画像が空になること、現在のハンドル・旧ハンドルの解決と、退会済みの利用者のハンドルを解決しないことを確かめる
  - 同じく先に、識別子`PROFILE_PLATFORM_TYPES`が`Symbol.for('profile.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - 共有部品の4つの照会口(表示の照会・プロフィールの出力・フォロー中の出力・フォロワーの照会)の契約と型を、api・eventと後続specのapplication層が読み込める共有の契約(`apps/backend-lib/core/profile/ports.ts`)に、DIの識別子を`core/profile/identifiers.ts`に一括で作る(2.3は契約と識別子を作らず、束縛は2.4が行う)。application層は`**/lib/workers/**`を型も含めて読み込めないため、`workers/profile`には利用者のハンドルの対象の記述(`users`と旧ハンドルのテーブル、infrastructure層だけが使う)と表示の照会・ハンドルの解決のD1の実装(`d1-user-profile-directory.ts`)だけを置く
  - 完了状態: 単体テストとWorkers統合テストが成功し、後続specが`users`・プロフィールのテーブルを読まずに表示用の情報とハンドルの解決を得られる。`core/profile`が`workers`・`apps/db`を読み込まない
  - _Requirements: 12.1, 12.2, 12.3_

- [x] 2.3 (P) データエクスポートと通知の照会を作る
  - 先に、Workers統合テストで、プロフィールの出力の項目(ハンドル・ニックネーム・ヘッドライン・自己紹介・画像のID・外部Webサイト(名前が未入力なら空文字列)・更新日時(行が無ければ登録日時))と退会済みで空・停止中で返すこと、フォロー中の出力が可視の相手だけを新しい順で返しフォロワーを返さないこと、フォロワーの照会が可視のフォロワーだけをIDの順に上限件数ずつ返し続きを示すことを確かめる
  - 2.2で`core/profile/ports.ts`に作った契約のD1の実装(`workers/profile/d1-profile-export.ts`・`d1-follow-directory.ts`)を作る
  - 完了状態: Workers統合テストが成功し、データエクスポートの文書の`profile.json`・`follows.json`の項目に対応する
  - _Boundary: ProfileExport, FollowExport, FollowerDirectory(`workers/profile`のD1の実装)_
  - _Depends: 1.2_
  - _Requirements: 12.4, 12.5, 12.6_

- [x] 2.4 プロフィールの共有の束縛を作り、apiとeventに組み込む
  - 2.2・2.3の照会のD1の実装を`core/profile`の識別子に処理単位で束縛するモジュール(`workers/profile`)を作り、apiとeventの束縛の一覧へ同時に加える
  - 完了状態: 3経路(api・eventの`fetch`・eventの`queue`)のDIの解決の検査が成功し、両アプリで照会を解決できる
  - _Requirements: 12.8_

- [x] 3. APIサーバーのプロフィール
- [x] 3.1 保存の決定と外部Webサイトの正規化の規則を作る
  - 先に、ハンドルの変更の種類(変更なし・大文字小文字だけ・別の文字列で変更前を旧ハンドルにする)、自分の旧ハンドルへの戻し、画像の維持・新規の設定・差し替え・削除の決定、外部Webサイトの名前とURLの前後の空白の除去と空の名前を未入力にすることの単体テストを書く
  - 完了状態: 単体テストが成功し、規則がデータベースと時計に依存しない
  - _Requirements: 2.1, 2.2, 2.3, 4.6, 4.7, 5.3, 5.4_

- [x] 3.2 プロフィールのポートと、編集の読み取り・保存のD1の実装を作る
  - 先に、ローカルD1のWorkers統合テストで、保存が1つの一括の書き込みでプロフィール・ニックネームとハンドル・旧ハンドル・外部Webサイトを確定すること、同じハンドルの同時の2つの保存の一方だけが成功すること、他人の旧ハンドルと同じ文字列を保存すると同じ一括の書き込みでその旧ハンドルの行が消え以後その文字列が保存した利用者に解決されること(仮2)、停止中の利用者の保存が取り消され`account-unavailable`になること、読み込んだ時点のハンドル(大文字小文字の違いを含む)から変わっていれば`conflict`になること、外部Webサイトの全件の置き換え、取り消しの理由を読み直しで分類すること、使用中の判定(既定は他人の現在のハンドル、`includePrevious`で他人の旧ハンドルも、本人を除く)と、`users`に行がある利用者のIDの照会(退会済みで物理削除前を含む、90件を超えるID)を確かめる
  - プロフィールのポートに、編集の読み取り・保存と、ハンドルの使用中の判定(D1の実装はハンドル基盤の判定の部品を呼ぶ)と、存在する利用者のIDの照会(6.3のジョブが使う)を含める。3.3・3.4のユースケースはこのポートだけを使い、D1の関数を直接呼ばない
  - 完了状態: Workers統合テストが成功し、失敗した保存でどの行も変わらない
  - _Requirements: 1.4, 1.6, 2.1, 2.3, 2.4, 4.10, 4.14, 11.9_

- [x] 3.3 プロフィールの保存と照会、編集画面の使用可否のユースケースを作る
  - 先に、模擬のポートの単体テストで、判定の順序(読み込んだ時点のハンドルの照合→予約語→使用中→画像の紐付け→保存→以前の画像の削除)、大文字小文字だけの変更と現在の値の維持で予約語・使用中を判定しないこと、自分の旧ハンドルへの戻しを受け付けること、他人の旧ハンドルを拒否せず保存へ進むこと(仮2)、画像の紐付けの失敗で保存しないこと、差し替えで以前の画像を直ちに物理削除させ削除で14日後の削除を依頼すること(削除の失敗は結果を変えずログにファイルのIDだけを残す)、未確認の利用者の保存を拒否しないこと、使用可否が本人の現在・旧と他人の旧ハンドルを使えるとし形式違反・予約語・他人の現在のハンドルを区別することを確かめる
  - 公開APIの経路からも呼べるよう、bot対策の検証をユースケースに含めない
  - ハンドルの使用中の判定は3.2のプロフィールのポート越しに使い、ハンドル基盤(`workers/handles`)の関数を読み込まない
  - 完了状態: 単体テストが成功し、ユースケースが利用者をセッションではなく引数の利用者で受け取る。APIサーバーの静的解析が成功し、application層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 2.1, 3.1, 3.2_
  - _Requirements: 1.3, 1.4, 1.5, 1.7, 2.1, 2.2, 2.3, 4.3, 4.12, 4.14, 5.3, 5.4, 5.5, 12.7_

- [x] 3.4 登録時の初期ハンドルの判定を差し替え、プロフィール画像の用途を登録する
  - 先に、単体テストでidentity-authの初期ハンドルの長さと文字の一覧から作ったハンドルが利用者のハンドルの規則を満たすことを、Workers統合テストで登録時の判定が他人の現在のハンドル・他人の旧ハンドル(登録では解放しない)・予約語を使えないとすることを確かめる
  - identity-authの`HANDLE_AVAILABILITY`の登録箇所を本specの実装へ差し替え、media-pipelineの用途の登録箇所に`user-avatar`(画像5形式・利用者・512,000バイト)を加える。apiのプロフィールのモジュールを作り、束縛の一覧へ加える。差し替えを完全一致で確かめる既存のテスト(`apps/api/src/composition/identity-module.worker.test.ts`の`HANDLE_AVAILABILITY`が`D1HandleAvailability`であることの確認、`apps/api/test/config/media-registrations.unit.test.ts`の`UPLOAD_PURPOSES`の2件)の期待値を本specの実装と`user-avatar`に直す
  - 完了状態: 単体テスト・Workers統合テスト・DIの解決の検査が成功し、`user-avatar`の用途で512,001バイトの画像が413になり、identity-authの登録のテストと、期待値を直した2つの既存のテストが成功する
  - _Depends: 2.4, 3.3_
  - _Requirements: 1.8, 1.9, 5.1, 5.2_

- [x] 3.5 公開プロフィールの読み取りと、公開範囲・転送のユースケースを作る
  - 先に、ローカルD1のWorkers統合テストで、1回の読み取りで人物情報・外部Webサイト・可視のフォロワー数(停止中のフォロワーを除き、停止の解除で戻る)・閲覧者のフォローの有無を得ることを確かめる。模擬のポートの単体テストで、形式違反・存在しない・退会済みの404、停止中で本人以外の404と本人の表示、旧ハンドルの転送と停止中の保持者の旧ハンドルの404、本人の閲覧者の関係、Ultrasの判定の結果の反映と判定の失敗で表示を止めないことを確かめる
  - 照会のストアとユースケースの束縛を3.4のapiのプロフィールのモジュールへ加える
  - ユースケースは利用者の表示の照会とハンドルの解決を`core/profile`の契約の型と`PROFILE_PLATFORM_TYPES`の識別子で受け取る
  - 完了状態: 単体テストとWorkers統合テストが成功し、Ultrasの判定がUltrasのテーブルを読まず判定サービスだけを使う。application層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 2.2, 3.4_
  - _Requirements: 2.5, 2.6, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 4. APIサーバーのフォロー
- [x] 4.1 フォローのポートとD1の実装を作る
  - 先に、ローカルD1のWorkers統合テストで、相手が可視のときだけの記録と重複の無視、記録・既存・相手の不在の区別、物理削除、可視のフォロワーの数、フォロー中・フォロワーの一覧が新しい順に可視の相手だけを返し、件数+1件までの行を返すこと、位置(作成日時のミリ秒とフォローのID)の後から続きを読むこと、同じ作成日時の行がIDで並ぶことを確かめる
  - フォローのポート(3.2のポートの定義に加える)と、一覧の項目に2.2の利用者の表示の型を使うD1の実装を作る
  - 完了状態: Workers統合テストが成功し、停止中の相手の行が残ったまま一覧と数から除かれる
  - _Depends: 2.2, 3.2_
  - _Requirements: 6.6, 9.7, 9.11, 10.2, 10.4_

- [x] 4.2 フォロー・フォロー解除と自分の一覧のユースケースを作る
  - 先に、模擬のポートの単体テストで、現在・旧ハンドルでの相手の解決、自分自身・停止中・存在しない相手の拒否のコード、既にフォロー中・フォローしていない場合の成功、同時の停止で記録できなかった場合の拒否、解除の相手の解決が停止中を含むこと、結果に相手の現在のハンドルと可視のフォロワー数を返すこと、一覧が位置`FollowListPosition`を受け取り件数+1件までの行を返すこと(カーソルの文字列を扱わない、G3)を確かめる
  - フォローのストアとユースケースの束縛をapiのプロフィールのモジュールへ加える
  - 完了状態: 単体テストが成功し、一覧の対象の利用者を引数で受け取らない。apiのapplication層にapi-gatewayのカーソルの部品(`**/presentation/**`)の読み込みが無い
  - _Depends: 2.2, 3.4, 4.1_
  - _Requirements: 9.3, 9.4, 9.6, 9.7, 10.2, 10.4, 10.7_

- [x] 5. APIサーバーのGraphQLと上流への組み込み
- [x] 5.1 利用者の表示の共通の型と一括の読み込みを作る
  - 先に、Workers統合テストで、利用者の表示の型(ハンドル・ニックネーム・画像)を、可視の利用者だけを一括で引く読み込みで返し、可視でない利用者でnull、画像が隔離中・未設定で`objectKey`がnullになることを、テスト用の項目から確かめる
  - スキーマモジュール`profile`の土台(型の定義・エラーの定義・空のリゾルバの表)を作ってスキーマモジュールの一覧へ加え、利用者の表示の型・一括の読み込み・画像の項目のリゾルバを、後続specが自分の型の項目から返せる形で公開する
  - 完了状態: Workers統合テストとスキーマの検査が成功し、後続specが`UserSummary`を返す項目を足せる(読み込みの定義と型が公開されている)
  - _Depends: 2.4, 3.4_
  - _Requirements: 5.6, 12.2_

- [x] 5.2 プロフィールの操作をスキーマモジュールに加える
  - 先に、Workers統合テストで、`updateMyProfile`の入力の検証(ニックネーム・ハンドル・ヘッドライン・自己紹介5,000文字・外部Webサイト10件・URL)と欄ごとの詳細、停止中・未ログイン・bot対策(`profile_update`)の失敗・使用中・画像の不正・競合のコード、未確認の利用者が保存できること、`publicProfile`の転送とnull、`myProfile`の旧ハンドル、`handleAvailability`の3値、`client`以外の呼び出し元の拒否を確かめる
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Depends: 3.5, 5.1_
  - _Requirements: 1.1, 1.7, 2.7, 4.3, 4.4, 4.6, 4.9, 4.10, 4.12, 4.14, 6.2, 6.6, 6.7, 7.1, 7.2_

- [x] 5.3 フォローの操作をスキーマモジュールに加える
  - 先に、Workers統合テストで、`followUser`・`unfollowUser`のログイン・確認・停止・bot対策(`follow`)の順の拒否、自分自身・不在のコード、冪等の成功と結果のフォロワー数、`myFollowing`・`myFollowers`の件数の検証(1〜20。21は`validation_error`)・カーソル(21件目で`endCursor`が付き、それを`after`に渡すと続きが読める)・不正なカーソルの拒否(`invalid_cursor`)を確かめる
  - リゾルバは、`first`を1〜20に絞った独自のスキーマで引数を検証し、`after`をapi-gatewayの`decodeCursor`で位置に戻し、ユースケースの結果を`toConnection`と`encodeCursor`でConnectionにする(G3)
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Depends: 4.2, 5.2_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 10.1, 10.2, 10.4, 10.7_

- [x] 5.4 問い合わせの利用者の表示を画像付きの実装へ差し替える
  - 先に、Workers統合テストで、問い合わせ機能の照会口の形のまま、ニックネーム・ハンドル・プロフィール画像のIDを返し、退会済み(物理削除前)の利用者と停止中の利用者も返すこと(inquiry-chatの契約、G1)を確かめる
  - 実装の識別子をapiのプロフィールの識別子の一覧へ、束縛をapiのプロフィールのモジュールへ加え、inquiry-chatの束縛の登録箇所で照会口の束縛だけを本specの実装へ差し替える。既定の実装とそのテストは残し、管理画面の一覧の読み取りは変えない。束縛を既定の実装と確かめる既存の`apps/api/src/composition/inquiry-module.worker.test.ts`の期待値を本specの実装に直す
  - 完了状態: Workers統合テスト(期待値を直した既存のテストを含む)と、inquiry-chatの問い合わせフォームの照会・管理画面の詳細のテストが成功し、画像のある利用者で画像が返り、管理画面の退会済みの問い合わせの詳細に送った利用者が表示される
  - _Boundary: ProfileInquirerProfiles、apiのプロフィールの識別子とモジュール、`apps/api/src/composition/inquiry-module.ts`の照会口の束縛_
  - _Depends: 3.4_
  - _Requirements: 12.1_

- [x] 5.5 退会の同期の波及処理を作る
  - 先に、Workers統合テストで、identity-authの退会の確定と同じ一括の書き込みで、利用者の旧ハンドルとその利用者に関するフォロー(両方向)が論理削除され、旧ハンドルでの転送が止まり、その旧ハンドルを他の利用者が設定すると行が物理削除されることを確かめる(仮2)
  - 波及処理の識別子と束縛をapiのプロフィールの識別子の一覧とモジュールへ加え、`user-profile-social.withdrawal`を同期の波及処理の登録箇所へ加える。利用者IDを条件にした集合の更新の文だけを返す
  - 完了状態: Workers統合テストが成功し、退会の確定の競合で波及処理の文も取り消される
  - _Boundary: ProfileWithdrawalSyncHandler、apiのプロフィールの識別子とモジュール、`apps/api/src/composition/user-lifecycle-sync-handlers.ts`_
  - _Depends: 2.1, 3.4, 5.4_
  - _Requirements: 11.1_

- [x] 6. 波及処理と日次のジョブ
- [x] 6.1 物理削除の波及処理を作る
  - 先に、模擬のポートの単体テストで、フォローの削除が上限件数ちょうどなら続きを、未満ならプロフィール・外部Webサイト・旧ハンドルを消して完了を返すこと、ファイルの物理削除の残りの有無を続きに対応付けること、例外をそのまま投げることを確かめる。ローカルD1のWorkers統合テストで、1,001件のフォロー(フォロワー・相手の両方向)が2回の呼び出しで消え、プロフィールの行が消えた後にidentity-authの利用者の物理削除が外部キーで失敗しないことを確かめる
  - `user-profile-social.profile-erasure`(物理削除、`order` 600)と`user-profile-social.owned-file-erasure`(物理削除、`order` 610)をeventの束縛と非同期の波及処理の一覧へ同時に加える
  - 物理削除の文と一括の書き込みはeventのinfrastructure層の削除のストアに置き、波及処理(application層)はそのポートだけを使う
  - 非同期の波及処理の名前の並びを完全一致で確かめる既存のテスト(`apps/event/src/composition/payments-module.worker.test.ts`・`apps/event/src/composition/ultras-module.worker.test.ts`の`purge_due`)の期待値に600・610を足す
  - 完了状態: 単体テスト・Workers統合テスト(期待値を直した既存のテストを含む)・3経路のDIの解決の検査が成功し、波及処理の登録の検証(同じ種類での`order`の重複)が成功する。eventの静的解析が成功し、application層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 1.2, 2.4_
  - _Requirements: 2.4, 11.2, 11.3, 11.6, 11.7, 11.8_

- [x] 6.2 停止・停止解除の隔離理由の波及処理を作る
  - 先に、模擬のポートの単体テストで、停止でユーザー停止の隔離理由の追加、停止解除で取り除きを呼び、残りがあれば続きを返すこと、例外をそのまま投げることを確かめる。ローカルD1のWorkers統合テストで、media-pipelineの実装を使い、`suspended`のイベントで利用者の画像に隔離理由が付き、`unsuspended`で外れ、他の理由を持つ画像は隔離の理由が残ることを確かめる
  - `user-profile-social.owned-image-quarantine`(停止・停止解除、`order` 600)を束縛と非同期の波及処理の一覧へ同時に加える。6.1と同じ2つの既存のテストの`suspended`の並びの期待値に600を足す
  - 完了状態: 単体テスト・Workers統合テスト(期待値を直した既存のテストを含む)・登録の検証が成功する
  - _Depends: 6.1_
  - _Requirements: 11.4, 11.5, 11.6, 11.8_

- [x] 6.3 保有者の居ないファイルを物理削除する4:21のジョブを作る
  - 使う上流の契約: media-pipelineの`MediaFiles.listOwnerIds`(保有者の種類ごとに保有者のIDを重複を除いて昇順に上限件数ずつ返し、続きを示す。media-pipelineの改訂1で実装済み)
  - 先に、模擬のポートの単体テストで、保有者のIDを90件ずつ読み`users`に行の無い保有者だけの物理削除を残りが無くなるまで繰り返すこと、退会済みで物理削除前の利用者を対象にしないこと、消した件数が合計1,000件に達したら次の`eraseOwnedBy`を呼ばずに打ち切ること(達する前の呼び出しで1,000件を超えた分も消えること、G7)、保有者ごとの失敗をログ(保有者のIDだけ)に残して次の保有者へ進むこと、件数の結果を確かめる。ローカルD1と模擬の`MediaFiles`のWorkers統合テストで、存在しない利用者のファイルだけが削除されることを確かめる
  - ジョブ`user-profile-social.orphaned-file-sweep`(業務時刻4:21、`order` 600)の定義をジョブのファイルから公開し、apiの束縛とジョブの一覧へ同時に加える。4:21のジョブの並びを確かめる既存のテスト(`apps/api/test/config/payments-scheduled-jobs.unit.test.ts`の500の直後のジョブ、`apps/api/src/composition/search-module.worker.test.ts`の全ジョブ名)の期待値に600を足す
  - 完了状態: 単体テスト・Workers統合テスト(期待値を直した既存のテストを含む)・cron式の一致の検査が成功し、ローカルで4:21のcron式を手動で起動するとジョブが動いて件数がログに出る
  - _Boundary: OrphanedFileSweepJob、apiのプロフィールのモジュール、`apps/api/src/composition/scheduled-jobs.ts`_
  - _Depends: 3.2, 3.4_
  - _Requirements: 11.6, 11.9_

- [x] 7. 利用者側の公開プロフィール
- [x] 7.1 クライアントの操作と、利用者のアバター・フォローボタンを作る
  - プロフィールとフォローの操作を、clientの`src/graphql/operations/profile/`に1ファイル1操作の`.graphql`(操作名は`ClientPublicProfile`・`ClientMyProfile`・`ClientHandleAvailability`・`ClientUpdateMyProfile`・`ClientMyFollowing`・`ClientMyFollowers`・`ClientFollowUser`・`ClientUnfollowUser`)で書き、`graphql()`を呼ばない。clientで`bun run graphql:generate`を実行して型とpersisted operations(`src/graphql/generated/`)を生成し、apiで`bun run graphql:allowlist`を実行して許可リストを再生成する。部品は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む
  - フォローボタンのbot対策のウィジェットは`TurnstileWidget`(非表示)で置き、判定の枠と場所を設けない
  - 先に、ブラウザテスト(axeの違反0件)で、アバターの画像と頭文字のプレースホルダー(画像なし・隔離中・読み込みの失敗)、フォローボタンの未ログインのログインの案内・未確認の無効と理由・本人で描画しないこと・押下でトークンを使ってフォロー・解除しラベルと`aria-pressed`・トーストが変わること・失敗で状態を戻して文言を出すことを確かめる
  - 完了状態: 型の生成とブラウザテストが成功し、`graphql:allowlist`でapiの許可リストを再生成して`graphql:check`が成功し、他specが2つの部品を読み込める
  - _Depends: 5.3_
  - _Requirements: 5.6, 9.1, 9.2, 9.5, 9.8, 9.9, 9.10_

- [x] 7.2 公開プロフィールの区画の型と登録箇所を作る
  - 区画に渡す文脈(ハンドル・ニックネーム・本人か・停止中か)と、タブ・受賞バッジ・「…」メニューの項目の登録の型、3つの登録箇所(初版は空)を作る
  - 先に、登録の`order`順の並べ替えと、タブのクエリの値の解決(最小の`order`は省略、未登録の値は既定)の単体テストを書く
  - 完了状態: 単体テストと型検査が成功し、後続specが登録箇所に1行足すだけで項目を加えられる
  - _Requirements: 8.1, 8.2, 8.5, 8.8_

- [x] 7.3 公開プロフィールの人物情報のカードを作る
  - 先に、ブラウザテスト(axeの違反0件)で、ニックネームの見出し・ハンドル・ヘッドライン・未入力の区画の非表示、自己紹介の描画と240pxの折りたたみとリンクの`rel="ugc"`、外部Webサイトの名前とホスト名(名前が無ければホスト名)・`rel="noopener ugc"`・不正なURLをリンクにしないこと、フォロワー数の3桁区切りと0人・本人のリンク、Ultrasの輪とツールチップ・読み上げ、本人の「プロフィールを編集」と未入力の案内、停止中の本人の編集の導線の非表示、テスト用の登録で受賞バッジの区画と「…」メニュー(本人と項目が無いときは出ない)を確かめる
  - 完了状態: ブラウザテストが成功し、カード単体がモックアップの配置で描画される
  - _Depends: 7.2_
  - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9, 6.10, 7.3, 8.5, 8.6_

- [x] 7.4 公開プロフィールの枠とタブを作る
  - 先に、ブラウザテスト(axeの違反0件)で、テスト用の登録でPCの2カラムとモバイルの1カラム、タブが登録の順に件数を添えて並ぶこと、`tab`のクエリの保持と戻る・進むの復元、追従の状態での切り替えのスクロール、切り替え中のパネルだけの読み込み表示、タブが無いときに人物情報だけになること、停止中の本人の帯、区画への文脈の受け渡しを確かめる
  - 完了状態: ブラウザテストが成功する
  - _Depends: 7.3_
  - _Requirements: 7.3, 8.1, 8.2, 8.3, 8.4, 8.7, 8.8_

- [x] 7.5 公開プロフィールのルートを作る
  - 先に、ルートの`loader`の単体テストまたはブラウザテストで、形式違反の照会なしの404、nullの404、転送の302(`statusCode`の明示とクエリの引き継ぎ)、ページのタイトルとcanonical(現在のハンドルの表記)、初回ローディングのスケルトン、取得エラーの再試行と問い合わせへの導線を確かめる
  - `/@{$handle}`のルート(ログイン不要)を作り、フォロー・解除の結果でフォロワー数と関係を更新する。`loader`は`ensureQueryData`(非推奨で静的解析が失敗する)ではなく`queryClient.query`に`staleTime: 'static'`を付けて読む(G6)。`head`はclientの`buildSitePageHead`に`canonicalUrl`をオリジンの無いパス`/@<現在のハンドル>`で渡す(`buildPageHead`は絶対URLをcanonicalにしない、G4)
  - 完了状態: テストが成功し、静的解析が成功し、ページのHTMLに`<link rel="canonical">`が現在のハンドルの表記で出て、ローカルで`/@<初期ハンドル>`を開くと公開プロフィールが表示され、存在しないハンドルでプロダクト詳細と同じ404になり、ヘッダーのユーザーメニューの「プロフィール」から開ける
  - _Depends: 5.2, 7.4_
  - _Requirements: 2.5, 2.6, 6.1, 6.11, 6.12, 7.1, 7.2, 7.4, 7.5_

- [x] 8. 利用者側の設定ページ
- [x] 8.1 プロフィール編集フォームの部品を作る
  - フォームのスキーマはZodの値を`lib/utilities/validation/zod.ts`の`z`から読んで作り、フォームは`useAppForm<TInput, TOutput>(schema, { defaultValues })`(全欄の既定値)と`AppForm`(`serverFieldPrefix="input"`・`onSubmitError`)で作る。bot対策のウィジェットは`TurnstileWidget`(非表示)で置き、判定の枠と場所を設けない。プロフィール画像の`ImageUploadField`には必須の`contactAvailable`として`CLIENT_PROFILE.contactAvailable`を渡す
  - 先に、ブラウザテスト(axeの違反0件)で、フォーカスアウトでの各欄の検証(ニックネーム・ハンドルの文字種と文字数・ヘッドライン・外部WebサイトのURLと名前)、ハンドルの使用可否の確認と使用中の文言、旧ハンドルの案内、画像の選択(500kBの超過・形式の違反の事前の表示、正方形の切り取りの編集、`ImageUploadField`に`contactAvailable`として`CLIENT_PROFILE.contactAvailable`が渡ること)と削除、自己紹介のマークダウンの入力欄とプレビュー、外部Webサイトの追加・削除と10件での追加の無効、停止中の全欄の`FormField`の`disabled`による無効と保存の送信ボタンの`SubmitButton`の`disabled`による無効と案内を確かめる
  - 完了状態: ブラウザテストが成功し、フォームの検証規則がサーバーと同じ定数と判定から組み立てられている
  - _Depends: 7.1_
  - _Requirements: 1.7, 2.7, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.11, 5.1, 5.2_

- [x] 8.2 プロフィール編集画面を作り、設定ページのナビゲーションに加える
  - 先に、ブラウザテストで、保存のbot対策のトークンと読み込んだ時点のハンドル(`expectedHandle`をスキーマの入力に含めず`onSubmit`で足すこと)の送信、サーバーのエラー(使用中・欄ごとの詳細・競合・画像の不正)の表示、成功のトーストと公開プロフィールへの導線、ヘッダーのユーザーメニューのリンクの更新(ログイン中の利用者の取得の無効化)を確かめる
  - `/settings/profile`を設定ページのシェルの中に作り、設定ページのナビゲーションに「プロフィール」(order 10)を加える。`/settings`の移動先が`/settings/profile`に変わるため、次の既存のテストの期待値を直す: `SETTINGS_NAV_ITEMS`の4行を完全一致で確かめる`apps/client/src/components/settings/settings-nav-order.unit.test.ts`(`profile`の行を足す)、ユーザーメニューの「設定」の後に`/settings/account`へ移ることを確かめるE2Eの`openAccountSettings`(`e2e/client/auth/account-steps.ts`。これを呼ぶ約15か所と、`e2e/client/ultras-steps.ts`の設定のナビゲーションの手順に影響する)
  - 完了状態: ブラウザテストと、期待値を直した既存の単体テスト・E2Eが成功し、ローカルでログインして`/settings`を開くと`/settings/profile`へ移動し、保存した内容が公開プロフィールに出る
  - _Depends: 7.5, 8.1_
  - _Requirements: 4.1, 4.2, 4.9, 4.13, 4.15, 5.3, 5.4_

- [x] 8.3 フォロー一覧の画面を作り、設定ページのナビゲーションに加える
  - 先に、ブラウザテスト(axeの違反0件)で、「フォロー中」「フォロワー」のタブとクエリの保持、20件ずつの「さらに読み込む」、各行のアバター・ニックネーム・ハンドル・日時(`<time datetime>`)と公開プロフィールへのリンク、0件・取得エラー・続きの取得エラーの表示を確かめる
  - `/settings/follows`を作り、設定ページのナビゲーションに「フォロー」(order 50)を加える(8.2の後に行い、ナビゲーションの登録箇所の変更が並行しないようにする)。`apps/client/src/components/settings/settings-nav-order.unit.test.ts`の期待値に`follows`の行を足す
  - 完了状態: ブラウザテストと既存の`settings-nav-order.unit.test.ts`が成功し、ローカルでログインして`/settings/follows`を開くとナビゲーションの「フォロー」が現在の項目になる
  - _Depends: 8.2_
  - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6, 10.8_

- [ ] 9. 文書
- [x] 9.1 (P) 技術ドキュメントを書き、CLAUDE.mdから参照する
  - `backend/011-handle-namespaces.md`(ハンドルの対象の記述、文字種と大文字小文字の同一視、予約語、旧ハンドルの保持と置き換え、他の対象の旧ハンドルは使用中に数えず、それを現在のハンドルとして保存する一括の書き込みで解放する規約(解放できない保存だけは旧ハンドルも避ける)、同時の保存の`CASE`式による取り消し、解決と302の転送、新しい対象を足す手順(照合規則は作成時に指定))と`db/006-user-relationship-lists.md`(利用者間の関係の組の一意とCHECK、解除の物理削除と退会の論理削除、可視性で絞った数とカーソルの一覧、物理削除の上限件数ずつの削除)を本プロジェクト固有の値を含めずに書き、`backend/007`に「保有者単位で上限件数ずつ処理する操作の対応付け」(残りの有無を続きへ、外部キーを持たないファイルのIDの規約)の節を加え、`backend`・`db`のREADMEの文書一覧に行を加える
  - CLAUDE.mdの「技術規則の参照先」に「ハンドル(URLの識別子)を持つテーブルを定義する前に: `backend/011`」を、作った見出しへのリンクで加える
  - 完了状態: 文書とREADMEが整形の検査を通り、本プロジェクト名とサービス固有の仕様を含まず、CLAUDE.mdのリンクの見出しが実在する
  - _Boundary: `docs/GUIDES/tech/backend/011-handle-namespaces.md`・`db/006-user-relationship-lists.md`・`backend/007-user-lifecycle-events.md`・`backend/README.md`・`db/README.md`・`CLAUDE.md`_
  - _Requirements: 3.7, 13.4_

- [ ] 9.2 (P) サービス仕様とオンボーディングの残りを更新する
  - 準拠方針の旧ハンドルの行と注5に、他の利用者(対象)が同じ文字列を設定した時点で旧ハンドルを削除すること(仮2)を、データエクスポートの文書に`websites[].name`が未入力なら空文字列であることを、日次タイムラインの4:21の表に`user-profile-social.orphaned-file-sweep`(600、仮1)を、`docs/onboardings/project-values.md`に波及処理とジョブの名前と`order`・用途`user-avatar`・bot対策の`action`を加える
  - 完了状態: 文書が整形の検査を通り、日次タイムラインの4:21の表の順序が登録したジョブの`order`と一致する
  - _Boundary: `docs/GUIDES/service/legal/001-compliance-policy.md`・`features/001-user-data-export.md`・`overview/007-daily-timeline.md`・`docs/onboardings/project-values.md`_
  - _Requirements: 13.5_

- [ ] 10. 検証
- [ ] 10.1 E2Eテストでプロフィールの編集・公開・転送を確かめる
  - `e2e/client/profile.e2e.test.ts`: identity-authの`e2e/support/mailpit.ts`で確認済みの利用者(メールアドレスのドメインは`.example`)を登録し、プロフィールの編集(画像のアップロード・ハンドル・ヘッドライン・リンクを含む自己紹介・外部Webサイト)→`/@<新しいハンドル>`の表示と`rel="ugc"`→大文字の表記で200とcanonical→初期ハンドルのURLが302で新しいURLへ移ること(転送を追わない要求で状態と`Location`を確かめる)→予約語`admin`の拒否→別の利用者が最初の利用者の旧ハンドル(初期ハンドル)を設定でき、その後は初期ハンドルのURLが302で転送されず別の利用者の公開プロフィールを表示すること(仮2)を確かめる。Turnstileはローカルの常に成功するキーを使う
  - 完了状態: ローカルでE2Eテストが成功する
  - _Depends: 7.5, 8.2_
  - _Requirements: 1.4, 1.5, 2.5, 6.1, 6.5, 13.3_

- [ ] 10.2 E2Eテストでフォローの流れを確かめる
  - `e2e/client/follow.e2e.test.ts`: 2人の確認済みの利用者で、AがBの公開プロフィールでフォロー→フォロワー数が1→Aの`/settings/follows`にB、Bのフォロワーの一覧にA→解除でフォロワー数が0、Aの自分の公開プロフィールにフォローボタンが無く「プロフィールを編集」があることを確かめる
  - 完了状態: ローカルでE2Eテストが成功する
  - _Depends: 7.5, 8.3_
  - _Requirements: 9.1, 9.2, 9.3, 10.1, 10.3, 13.3_

- [ ] 10.3 全体の検査とカバレッジを確かめる
  - 整形の検査・静的解析・型検査と、単体テスト・Workers統合テスト・ブラウザテストを一括で実行し、本specが追加・変更したファイルのカバレッジが80%以上であることを確かめる。ログとSentryへの送信にメールアドレス・自己紹介・外部WebサイトのURLが含まれないことを検索で確かめる
  - 完了状態: すべての検査とテストが成功し、カバレッジの結果が閾値を満たす
  - _Requirements: 12.9, 13.1, 13.2_

## Implementation Notes

- 1.1: 規則は`apps/common-lib/handles/handle-rules.ts`(`checkHandleFormat`・`toHandleKey`(A〜Zだけ小文字化しNOCASEと同じ)・`isReservedHandle`・`IMPERSONATION_RESERVED_HANDLES`)・`profile/profile-input-rules.ts`(`USER_HANDLE_RULE`・`checkHeadline`・`checkWebsiteName`・`PROFILE_WEBSITES_MAX`・`BIO_MAX_GRAPHEMES`・`USER_AVATAR_PURPOSE`・`USER_AVATAR_MAX_BYTES`)・`url/external-url.ts`(`checkExternalUrl`・`externalUrlHost`)。`checkExternalUrl`は前後の空白を除いて判定するので、保存する値も呼び出し側で`trimWhiteSpace`する。`//`付きの値の途中の空白・制御文字は`not-absolute`。`checkHeadline`等の違反は`forbidden-characters`と`too-long`の2種で、画面の文言は出し分ける。`externalUrlHost`はIDNをpunycodeのまま返す。
- 1.2: テーブルは`apps/db/schema/profile/`(`user_profiles`・`user_profile_websites`・`user_previous_handles`)と`apps/db/schema/follow/user_follows`、旧ハンドルの共通の列は`apps/db/schema/handles/previous-handle-columns.ts`(キーは`ownerId`、列名は`ownerColumnName`で`user_id`)。`deleted_at`は旧ハンドルとフォローだけが持つ。`apps/db`は`common-lib`を読めないため位置のCHECKは`between 0 and 9`のリテラル(`PROFILE_WEBSITES_MAX`と手で同期)。マイグレーションは`20261108165600_user_profile_social`で、`user-profile-social-migration.unit.test.ts`がNOCASE・CHECK・`ON DELETE`無しを確かめる。
- 1.3: 画面の文言の正は`docs/GUIDES/service/design/003-text-and-copy-rules.md`の「プロフィールとフォローの文言」の段落・エラーメッセージの表・「操作とナビゲーションの名前」の表(「その他の操作」「プロフィールの内容」「フォロー一覧」「Ultras加入中」など読み上げの名前を含む)、配置の正は`002-page-layouts.md`の「区画の登録と登録が無いときの表示」「プロフィール編集(`/settings/profile`)」「フォロー一覧(`/settings/follows`)」。外部WebサイトのURLが空の行は「外部WebサイトのURLを入力してください。」で拒否する前提。ハンドルが使える時の肯定の表示は作らない。`invalid_cursor`は管理画面の「一覧のページの位置の指定の誤り」、`first`の範囲外は「フォロー一覧の表示件数の指定の誤り」の文言。
- 2.1: ハンドル基盤は`apps/backend-lib/workers/handles/`(`defineHandleNamespace`・`resolveHandle`・`isHandleOccupied`・`handleOccupiedCondition`・`previousHandleUpsert`・`previousHandleRelease`・`previousHandleSoftDelete`・`previousHandleDelete`)。`previous`には`deletedAt`が必須。使用中の`CASE`条件は`EXISTS`で、取り消しは`SET handle = CASE WHEN <cond> THEN NULL ELSE ? END`のNOT NULL違反で一括を巻き戻す。新しい文字列を保存する一括では、現在のハンドルの更新の後に`previousHandleRelease`を、`previousHandleUpsert`より前に置く。`previous`の無い対象では解放・論理削除・削除が無操作の文になりupsertは例外。テストの補助は`workers/handles/testing/handle-fixtures.ts`(`USER_NAMESPACE`など)。実物の`USER_HANDLE_NAMESPACE`は`activeCondition: isNull(users.deletedAt)`を渡す。
- 2.2: 4つの照会口の契約は`apps/backend-lib/core/profile/ports.ts`、識別子は`core/profile/identifiers.ts`の`PROFILE_PLATFORM_TYPES`。`UserSummaryRecord`は画像を`avatarFileId`だけで返す(`objectKey`は5.1)。`resolveHandle`は旧ハンドルの一致で保有者の現在のハンドルを`user.handle`に返し(302の行き先)、停止中は`suspended: true`で返す(404の判断は呼び出し側)、退会済みは`none`。`USER_HANDLE_NAMESPACE`は`workers/profile/user-handle-namespace.ts`。apiのWorkers統合テストは`cd /workspace/apps/api && bun run test:worker -- lib/workers/profile`の相対指定で走らせる(絶対パスでは見つからない)。テストで`user_profiles`の行は`clearIdentityTables`の前に消す。
- 2.3: `D1ProfileExport`(`workers/profile/d1-profile-export.ts`)と`D1FollowDirectory`(`d1-follow-directory.ts`、`FollowExport`と`FollowerDirectory`の両方を実装)。2.4では`D1FollowDirectory`を両方の識別子に束縛する。`listVisibleFollowerIds`の`after`・`next`はフォローのID、戻りの`followerIds`は利用者のIDで、上限件数が1〜500の整数でなければ`invalid_limit`の`bad_request`。テストで`user_follows`・`user_profile_websites`の行は`clearIdentityTables`の前に消す。
- 2.4: `PROFILE_PLATFORM_MODULE`(名前`profile-platform`、`workers/profile/profile-platform-module.ts`)をapi・eventの`src/composition/modules.ts`の`ADMIN_PLATFORM_MODULE`の直後に置いた。束縛は`inSingletonScope()`(呼び出しのコンテナ単位)。テストの種データは`workers/profile/testing/profile-platform-fixtures.ts`。9.1・9.2で共有の束縛の一覧の文書に`profile-platform`を加える。
- 3.1: 規則は`apps/api/src/domain/profile/profile-edit-plan.ts`(`planProfileEdit`。完全一致は`none`、`isSameHandle`は`case-only`、それ以外は`changed`で`previous`は現在のハンドル。自分の旧ハンドルへの戻しも`changed`)と`website-list.ts`(`normalizeWebsites`。URLが空の行は落とさず`''`で返すので、空のURLの拒否は5.2のスキーマで行う)。`AvatarChange`の`replaced`(差し替え前)は`eraseNow`、`removed`は`markDeleted`へ渡す。
- 3.2: ポートは`apps/api/src/application/profile/ports.ts`の`ProfileStore`(`findSnapshot`・`isHandleOccupied`(`exceptUserId`)・`findExistingUserIds`・`save`)と`MyProfileView`・`ProfileSnapshot`。`save`の結果は`'saved' | 'handle-unavailable' | 'conflict' | 'account-unavailable'`で、`websites`には`normalizeWebsites`の結果を渡す。D1実装は`infrastructure/profile/d1-profile-store.ts`(先頭の`user_profiles`のupsertの`user_id`を`CASE WHEN EXISTS(...)`にしたNOT NULL違反のガード、`expectedHandle`は`COLLATE BINARY`で比べる。制約の違反の文言で分類し、他の障害は再送出)。`D1ProfileStore`は`PLATFORM_TYPES.Database`だけを受け取る。識別子と束縛は3.4で作る(`PROFILE_PLATFORM_TYPES`と名前を重ねない)。
- 3.3: ユースケースは`apps/api/src/application/profile/`の`StoreProfileEditor`(`MEDIA_TYPES.MediaFiles`・`PLATFORM_TYPES.Clock`を注入)・`StoreMyProfileReader`・`StoreHandleAvailabilityChecker`。識別子は`profile-types.ts`の`PROFILE_TYPES`(`Symbol.for('profile.<名前>')`、`PROFILE_PLATFORM_TYPES`と重ならないことをテストで確認)、エラーは`profile-errors.ts`の`profileError(code)`(`handle_unavailable`・`profile_update_conflict`・`invalid_upload`)。利用者の行が無ければ`account_unavailable`。入力の形式の検証はしない(5.2・公開APIの境界の責務)。画像の削除の失敗は`warning`に例外と`fileId`だけを添える(9.xで`004-logging-and-error-tracking.md`に「例外とファイルのIDだけ」と書く)。模擬のポートは`application/profile/testing/profile-fakes.ts`。
- 3.4: `PROFILE_MODULE`(名前`profile`、`apps/api/src/composition/profile-module.ts`、`modules.ts`の末尾)に`PROFILE_TYPES`の5識別子(`ProfileStore`・`ProfileEditor`・`MyProfileReader`・`HandleAvailabilityChecker`・`UserHandleAvailability`)を既定のスコープで束縛した。後続のストア・ユースケースの束縛もここへ足す。`HANDLE_AVAILABILITY`は`PROFILE_TYPES.UserHandleAvailability`に差し替え(`isHandleOccupied(includePrevious: true)`と予約語。identity-authの`D1HandleAvailability`は既定の実装として残る)。`user-avatar`の用途は`upload-purposes.ts`。`media-module.worker.test.ts`の未登録の用途の例は`product-image`に変えた。
- 3.5: `DefaultPublicProfileReader`(`application/profile/public-profile-reader.ts`、`find(session, handle)`が`profile`・`redirect`・`not-found`)と`D1PublicProfileStore`(1つの`db.batch`、`load`は退会・不在で`undefined`)を`PROFILE_TYPES.PublicProfileReader`・`PublicProfileStore`に束縛した。ストアの型はポート側の`PublicProfileRecord`。`PublicProfileView.avatarFileId`はIDのままで、画像のURL変換は5.1のプレゼンテーション層。Ultrasの判定の失敗は`false`にして`warning`(`userId`・`error`)。Ultrasの加入行を使うテストは`clearUltrasTables`の前に`user_follows`を消す。
- 4.1: ポートは`application/profile/ports.ts`の`FollowStore`(`insertIfAbsent`・`delete`・`isFollowing`・`countVisibleFollowers`・`list`)と`FollowEntryView`・`FollowListPosition`・`FollowListQuery`。`list`は`{ userId, direction, first, after }`で`first`+1件まで返す(design.mdのD1FollowStoreの節の`limit`・`before`の記述は古い)。実装は`infrastructure/profile/d1-follow-store.ts`の`D1FollowStore`(`PLATFORM_TYPES.Database`だけ)。記録は`INSERT ... SELECT ... WHERE EXISTS(可視) ON CONFLICT DO NOTHING`の1文で、論理削除済みの行がある組は復活させず`target-unavailable`(退会に取り消しが無いため)。自分自身の拒否は4.2のユースケースで行い、ストアに届けばCHECK制約で例外になる。識別子と束縛は4.2。
- 4.2: `StoreFollowService`(`follow`・`unfollow`、`(user: CurrentUser, handle)`、結果は`FollowState`(`handle`・`following`・`followerCount`))と`StoreFollowListReader`(`list(user, { direction, first, after })`、対象は`user.user.id`だけ)を`PROFILE_TYPES.FollowService`・`FollowListReader`に、`D1FollowStore`を`PROFILE_TYPES.FollowStore`に束縛した。未確認・停止中の利用者の拒否はリゾルバ(5.3)が持つ(`followUser`は`requireVerifiedUser`、`unfollowUser`は`requireWritableUser`の後に`assertHuman('follow')`)。エラーは`cannot_follow_self`・`follow_target_unavailable`(どちらも422)。リゾルバは`first`を1〜20で検証し、`after`を`decodeCursor`で位置に戻し、`toConnection`に`first`を渡す。模擬は`testing/profile-fakes.ts`の`createFakeFollowStore`・`summaryOf`。
- 5.1: スキーマモジュール`profile`(`apps/api/src/presentation/graphql/modules/profile/`)は`UserSummary`・`userSummaryLoader`(`findSummaries(ids, 'visible')`、リクエスト単位)・`UserSummarySource`(`codegen.config.ts`の`mappers`に登録)・`avatarOf(parent: { avatarFileId }, context)`を公開する。`PublicProfile.avatar`・`MyProfile.avatar`は`avatarOf`を再利用する(adminとinquiryにも同形の`avatarOf`があり、`modules/media/`への共通化は任意)。隔離中・削除待ち・保存未完了は`MediaImage`の枠を返し`objectKey`だけnull。Workers統合テストで`UserSummary`を使うときはコンテナに`createMediaPlatformModule('api')`と`PROFILE_PLATFORM_MODULE`を加え、後始末は`clearMediaState()`の後に`clearProfilePlatformTables()`。
- 5.2: `publicProfile`・`myProfile`・`handleAvailability`・`updateMyProfile`は`modules/profile/profile-resolvers.ts`、入力は`inputs.ts`(zod、共有の定数と`check*`から組み立て)、違反の文言は`errors.ts`の`INPUT_MESSAGES`(ニックネームは`modules/identity/errors.ts`の文言を再利用)、`clientOnly`・`assertHuman`・`PROFILE_BOT_ACTIONS`(`profile_update`)は`resolver-support.ts`。順序は呼び出し元→引数→`requireWritableUser`→`assertHuman`→ユースケース。`PublicProfile`・`PublicProfileRedirect`・`MyProfile`は`codegen.config.ts`の`mappers`に登録。テストの補助は`test/support/profile-graphql-operations.ts`の`installProfileGraphQLTest`。8.1のフォームは`INPUT_MESSAGES`と同じ文言を共有の上限から組み立て、apiの文言と一致することを確かめる単体テストを置く(文言は005の第3の方式で各アプリが持つ)。5.3は`follow`の`assertHuman`を`resolver-support.ts`に足し、`follow-resolvers.ts`を`index.ts`でマージする。
- 5.3: `followUser`・`unfollowUser`・`myFollowing`・`myFollowers`は`modules/profile/follow-resolvers.ts`、引数は`follow-inputs.ts`(`FOLLOW_LIST_MAX_PAGE_SIZE`(20)、`followListPositionOf`、`after`は256文字を超えると`after`の欄の`validation_error`、256文字以内の不正は`invalid_cursor`)。`first`の範囲外の文言は「表示する件数は1〜20件の整数で指定してください。」。`FollowEntry.followedAt`は`DateTime`(ISO 8601)。テストで25件以上のフォローを入れるときはD1の束縛の上限のため10件ずつ`insert`する。
- 5.4: `ProfileInquirerProfiles`(`apps/api/src/infrastructure/profile/profile-inquirer-profiles.ts`、`findSummaries(ids, 'including-withdrawn')`の詰め替え)を`PROFILE_TYPES.ProfileInquirerProfiles`に束縛し、`inquiry-module.ts`の`INQUIRY_TYPES.InquirerProfiles`は`toService`で転送する。`inquiry-module.ts`は`PROFILE_MODULE`と`PROFILE_PLATFORM_MODULE`が`MODULES`に載る前提で、inquiryだけの小さなコンテナのテストには両方を足す。inquiryのGraphQLの統合テストのハーネスは後片付けで`user_profiles`を先に消す。
- 5.5: `ProfileWithdrawalSyncHandler`(`apps/api/src/infrastructure/profile/profile-withdrawal-sync-handler.ts`、`withdrawn`だけで`previousHandleSoftDelete`と`user_follows`の両方向の論理削除の2文)を`PROFILE_TYPES.ProfileWithdrawalSyncHandler`に束縛し、`user-lifecycle-sync-handlers.ts`の`user-profile-social.withdrawal`に登録した(inquiryの後)。退会の統合テストは`profile-module.worker.test.ts`。`user_profiles`の行を作るテストでは後始末で`user_profiles`を先に消す。
- 6.1: eventの物理削除の波及処理は`apps/event/src/application/profile/`の`ProfileErasureHandler`(`FOLLOW_ERASURE_BATCH_SIZE` 1000、件数が上限以上なら`continue`)と`OwnedFileErasureHandler`(`MEDIA_TYPES.MediaFiles`の`hasMore`)、ポート`ports.ts`の`ProfilePurgeStore`、`infrastructure/profile/d1-profile-purge-store.ts`。識別子は`EVENT_PROFILE_TYPES`(`profile.event.*`)、モジュールは`composition/profile-module.ts`の`EVENT_PROFILE_MODULE`(名前`event-profile`、`PROFILE_PLATFORM_MODULE`の直後)。6.2は同じモジュールに`OwnedImageQuarantineHandler`を束縛し、`profile-module.worker.test.ts`の3経路の解決の検査に識別子を足し、ultras・paymentsの`suspended`(・`unsuspended`)の完全一致の期待に`user-profile-social.owned-image-quarantine`を足す。`clearProfilePlatformTables`は`user_previous_handles`を消さない。
- 6.2: `OwnedImageQuarantineHandler`(`apps/event/src/application/profile/owned-image-quarantine-handler.ts`、`MEDIA_TYPES.MediaQuarantine`の`addReasonForOwner`・`removeReasonForOwner`を`user_suspended`で呼び`hasMore`なら`continue`)を`EVENT_PROFILE_MODULE`に束縛し、`user-profile-social.owned-image-quarantine`(`suspended`・`unsuspended`、600)を登録した。eventの統合テストの`dispatch`補助は、画像の移動の依頼も同じキューへ送られるため`RUN_USER_LIFECYCLE_MESSAGE`の封筒だけを再送として数える。9.2で`project-values.md`の非同期の波及処理の登録に`profile-erasure`・`owned-file-erasure`・`owned-image-quarantine`を加える。
- 6.3: ジョブは`apps/api/src/application/profile/jobs/orphaned-file-sweep-job.ts`の`OrphanedFileSweepJob`(`sweep()`が結果(`failedOwners`を含む)を返し、`run()`がinfoの`保有者の居ないファイルを物理削除しました`を出す。`ORPHANED_FILE_SWEEP_LIMIT` 1000・`ORPHANED_FILE_SWEEP_PAGE` 90、1回で最大1,999件消え得る)。`ORPHANED_FILE_SWEEP_JOB_DEFINITION`を`scheduled-jobs.ts`の500の直後に並べ、`PROFILE_TYPES.OrphanedFileSweepJob`に束縛した。ローカルの手動起動は`curl "http://127.0.0.1:48042/cdn-cgi/local/scheduled?cron=21+12+*+*+*"`(`/__scheduled`は古い)。種データの`media_files`は`object_key`を32桁の16進にし、`attached_at`を入れる(無いとメディアの期限切れジョブが先に消す)。9.2で日次タイムラインの4:21の表の500と810の間に加える。
- 7.1: 部品は`apps/client/src/components/profile/`の`UserAvatar`(`user`・`size`(32|64|128)・`className`)と`FollowButton`(`target`・`initialFollowing`・`onChange`・`size`・`className`。`viewer`は`useViewer()`から読むので、ブラウザテストにはルーターの`cachedViewer`と`TooltipProvider`・`Toaster`が要る)。`FollowButton`はキャッシュを更新しないので、7.5のルートは`onChange`で`ClientPublicProfile`のフォロワー数と関係を更新する(`onChange`を渡さない他specの呼び出し側の扱いも7.5で確かめる)。bot判定のactionの写しは`components/profile/bot-actions.ts`の`PROFILE_BOT_ACTIONS`(`config/contract-copies.unit.test.ts`の`BOT_ACTION_COPIES`で照合)、文言は`profile-messages.ts`。未確認の無効ボタンは外枠の`span`のツールチップと`aria-describedby`の`sr-only`の理由(キーボードではツールチップは開かず、共通ヘッダーの帯が受け持つ)。`page-router.tsx`を読むブラウザテストは`execute-graphql.ts`のモックが必須。clientの`test/config/wrangler-config.unit.test.ts`の2件は`314d881d`由来の既存の失敗(`STRIPE_PUBLISHABLE_KEY`の期待値が古い)。
- 7.2: 区画の型は`apps/client/src/components/profile/public-profile-section-types.ts`(`PublicProfileSectionContext`・`PublicProfileTab`・`PublicProfileBadgeSection`・`PublicProfileMenuItem`)、登録箇所は`apps/client/src/composition/public-profile-sections.ts`(`PUBLIC_PROFILE_TABS`・`BADGES`・`MENU_ITEMS`、初版は空)、純関数は`public-profile-section-order.ts`(`orderPublicProfileSections`・`resolveProfileTab`・`profileTabQueryValue`)。7.3・7.4の部品は`tabs`・`badges`・`items`をpropsで受け取れるようにし、ブラウザテストでテスト用の登録を注入する。「…」メニューの表示条件(本人でなく項目が1つ以上)は部品側。9.2で`project-values.md`の画面の登録箇所の一覧に3つを加える。
- 7.3: カードは`apps/client/src/components/profile/profile-card.tsx`(`profile`(`public-profile-view.ts`の`PublicProfileView`)・`onFollowChange`・`badges`・`menuItems`を受け取り、状態を持たない)。本人は`viewerRelation === 'OWNER'`。Ultrasの輪はlintのため押しても何もしない`button type="button"`(代替は`follow-unverified-button.tsx`のフォーカスしない`span`と`sr-only`)。`profile-paths.ts`の`/settings/profile`・`/settings/follows?tab=followers`は`PathLink`の文字列で、8.2・8.3で経路ができたら確かめ、編集のリンクは型付きの`Link`への置き換えを検討する。自己紹介は003に従い`sr-only`の`h2`(002の「見出しは付けない」は9.xで003に揃える)。メニューを開いた状態のaxeは開いた`menu`要素に対して実行する。テストの種データは`public-profile-fixtures.ts`。
- 7.4: 枠は`apps/client/src/components/profile/public-profile-page.tsx`の`PublicProfilePage`(`profile`・`tab`・`onTabChange(tab | undefined)`・`onFollowChange`・`tabs`・`badges`・`menuItems`)、タブは`profile-tabs.tsx`(パネルは`profile-tab-panel.tsx`が`RecoverableSlot`の`fallback`で区画の形のスケルトンを渡す。件数は`profile-tab-count.tsx`が包み、失敗は描かず送信)。共通部品`RecoverableSlot`に省略可能な`fallback`を加えた(内側に`Suspense`を置くと再試行後のフォーカスが壊れる)。`TabsList`に`overflow`を付けない(フォーカスの輪郭が切れる)。7.5のルートは`onTabChange`で`navigate({ to: '.', search, resetScroll: false })`を呼ぶ。停止中の帯は`role="note"`。テストの補助は`public-profile-page-testing.tsx`の`renderPublicProfilePage`・`tabOf`・`deferred`。ページ全体のスケルトンと`ErrorState`は7.5。
- 7.5: ルートは`apps/client/src/routes/@{$handle}.tsx`、取得とloaderは`src/graphql/public-profile.ts`(`publicProfileQueryOptions(viewer, handle)`のキーは`[docId, { handle }, viewerId | 'guest']`、`loadPublicProfile`・`withFollowState`・`toPublicProfileView`)、headは`head/page-heads.ts`の`buildPublicProfileHead`。`onFollowChange`は`setQueryData`で更新する。他specの呼び出し側が公開プロフィールを無効にするときは`[docId]`の接頭辞で`invalidateQueries`する。8.2の保存の成功では公開プロフィールのキャッシュを接頭辞で無効にする(キャッシュ済みの旧ハンドルのページへ戻ったときの誤った404を避けるため)。`routeTree.gen.ts`を手で再生成する時は末尾の`declare module '@tanstack/react-start'`を残す。取得エラーの`sr-only`の`h1`と`ProfileCard`のニックネームの`h1`は同じid(`PROFILE_HEADING_ID`)で再試行後のフォーカスの移り先。
- 8.1: `ProfileEditForm`(`apps/client/src/components/profile/profile-edit-form.tsx`、`profile`は`MyProfileView`(`ClientMyProfileQuery['myProfile']`)、`onSave(values, turnstile)`)。8.2は`sendWithTurnstile(turnstile, ...)`で`updateMyProfile`に`expectedHandle`を足して送り、成功の`notify`・「公開プロフィールを見る」・取得の無効化を行い、取得し直した値はフォームを`key`で作り直して反映する。欄に対応しない失敗はフォーム内の`role="alert"`、`handle_unavailable`の詳細は`AppForm`がハンドルの欄へ移す。ハンドルの確認は`graphql/handle-availability.ts`。文言は`profile-form-messages.ts`で、apiの`INPUT_MESSAGES`との一致は`config/contract-copies.unit.test.ts`(子プロセスのbunで評価するため共有ディレクトリの配置が前提)。`ImageUploadField`は編集対象の画像の500kBの超過を切り取り後に判定する。テストの補助は`profile-edit-form-testing.tsx`(`renderProfileEditForm`・`myProfileOf`)。
- 8.2: ルートは`apps/client/src/routes/_authenticated/settings/profile.tsx`、画面は`ProfileEditPage`・`ProfileEditContent`(`key={savedCount}`でフォームを作り直す)、取得は`graphql/my-profile.ts`(`myProfileQueryOptions(viewerId)`・`loadMyProfile`、`staleTime: 0`)、保存は`use-profile-save.ts`の`useProfileSave`。保存の成功では公開プロフィールのキャッシュを`PUBLIC_PROFILE_QUERY_PREFIX`で`removeQueries`する(`staleTime: 'static'`の取得は`invalidateQueries`では取り直されない)。編集のリンクは型付きの`Link to="/settings/profile"`、`FOLLOWERS_LIST_HREF`は8.3で経路ができるまで`PathLink`。E2Eの`openAccountSettings`は「設定」→`/settings/profile`→ナビの「アカウント」で`/settings/account`。`settings-routes.browser.test.tsx`の経路の組み立てには各設定ページのloaderを足す。ローカルの`checkout.e2e.test.ts`とUltrasの加入の経路のE2Eは、dev用sandboxに`payments_smoke`の価格が無いこと等(payments 1.4の開発者の準備)で失敗し、本specとは無関係。
- 8.3: ルートは`apps/client/src/routes/_authenticated/settings/follows.tsx`(`loaderDeps`は`tab`、開いているタブだけを`staleTime: 0`で読む)、部品は`components/profile/`の`FollowListPage`・`FollowList`(`useInfiniteQuery`、`key={direction}`)・`FollowListItem`・`use-follow-list-focus.ts`、データは`graphql/follow-list.ts`(`followListQueryOptions(viewerId, direction)`・`loadFollowList`・`toFollowListEntries`、2つの操作を`FollowListPageData`に正規化)。初回の失敗は`ErrorState`、続きの失敗は`PartialErrorState`(設計・002・003に従い、006の記述とは異なる)。`profile-paths.ts`は削除し、`follower-count.tsx`は型付きの`Link to="/settings/follows" search={{ tab: 'followers' }}`。9.2で`project-values.md`の設定のナビゲーションに`/settings/follows`(order 50)を加える。
- 9.1: 技術文書は`docs/GUIDES/tech/backend/011-handle-namespaces.md`(CLAUDE.mdの参照先は`#新しい対象を足す手順`)・`db/006-user-relationship-lists.md`・`backend/007`の「保有者単位で上限件数ずつ処理する操作の対応付け」。011・006は`<予約語の一覧>`・旧ハンドルの保持の期限・関係のテーブル名と呼び名の値の置き場所を`project-values.md`としているので、9.2でそれらの値も加える。`docs/GUIDES/tech/README.md`・`/workspace/README.md`の範囲の写し、`004-logging-and-error-tracking.md`のprofileのロガーの行、002の自己紹介の見出しの記述は9.1・9.2の境界外で、親が別に揃える。
