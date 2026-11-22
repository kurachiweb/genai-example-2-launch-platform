# Implementation Plan

- [x] 1. 基盤: 通報の規則・テーブル・監査ログの操作種別・対応期間・メール・サービス仕様
- [x] 1.1 通報と案件の規則と表示名の共有定義を作る
  - 前提: dev-tooling〜ugc-moderationの26specの全タスクが完了していること(ugc-moderationの`ProductModerationService`・`CommentModerationService`・`UserModerationService`と`ModerationCommand.participation`・書き込みの参加者の登録口(`ModerationWriteParticipant`・`ModerationWriteContext`・`MODERATION_WRITE_PARTICIPANTS`)・`ModerationOutcome.actionId`・`ADMIN_PRODUCT_DETAIL_SECTIONS`・E2Eの`moderation-fixtures.ts`、admin-foundationの`requireAdmin`・`AuditLogRecorder`・`buildAuditLogStatements`・`AuditLogReader`(仮7の`latestForMany`を含む)とテストの共有の偽物`createFakeAuditLogReader`・`AUDIT_ACTIONS`・`ADMIN_NAV_ITEMS`・`DASHBOARD_CARDS`・`DashboardCardFrame`・`CategoryMasterEditor`・`ConfirmActionDialog`・E2Eの`admin-bootstrap.ts`・`local-d1.ts`、inquiry-chatの`CATEGORY_SECTIONS`、directory-discoveryの`PRODUCT_PAGE_SECTIONS`とE2Eの`directory-fixtures.ts`、user-profile-socialの`PUBLIC_PROFILE_MENU_ITEMS`・`UserProfileDirectory`、engagementの`COMMENT_ACTIONS`・`CommentStore`、product-launchの`ProductDirectory`とプロダクトライフサイクルの非同期の登録口、identity-authの`AccountGuard`・`UserContactDirectory`・ユーザーライフサイクルの同期と非同期の登録口・E2Eの`mailpit.ts`、backend-platformの`RateLimitCounterClient`・`hashRateLimitKey`・bot判定、api-gatewayの`assertHuman`、email-deliveryのメールの基盤)。無ければ該当するタスクを保留して開発者へ報告する。設計は実装済みの上流の規約(メールの冪等のキー・部分一意索引への衝突・`sendWithTurnstile`・監査ログの照会の無効化・一覧の単位の確認のダイアログ・`RecoverableSlot`)に従っており、各タスクもそれに従う。実装済みのコードとの照合の記録はresearch.mdの「実装済みの上流との差分の分析」にある
  - 先に、単体テストで、対象の種類、理由の検証(空白だけ・1,000書記素と1,001書記素・結合文字と絵文字)、連絡先の要否(未ログインと権利侵害の組だけ)、標準カテゴリの固定のIDの判定、カテゴリの並び順(追加の順・権利侵害・その他の順で末尾)、手での状態の変更の可否(4状態の全ての組で、同じ状態への変更だけ不可)と種類(未対応⇄対応中・完了への変更(完了どうしを含む)・完了からの再開)、対象の種類ごとの措置、管理者の理由の要否(措置・措置なしの対応済・却下と手での完了と再開は必須、未対応⇄対応中は任意)と500書記素・501書記素、照会の内容の上限、状態の値と表示名がinquiry-chatの問い合わせの対応ステータスと一致することを確かめる
  - 完了状態: 単体テストが成功し、共有定義が`common-lib`の他のディレクトリと`zod`以外を読み込まない
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.5, 8.1, 8.2, 8.3, 8.4, 9.1, 12.2, 14.4, 14.8, 20.2_

- [x] 1.2 通報カテゴリ・案件・通報のテーブルと標準カテゴリの初期データのマイグレーションを作る
  - 1.1の対象の種類・対応ステータス・措置・標準カテゴリの固定のIDを制約と初期データに使う
  - 先に、テーブルの定義の単体テストで、対象の種類・状態・措置・通知の状態の値の制約、状態と完了の日時の整合の制約、対象のIDが無いことと参照の消去の日時があることの整合の制約(対象のIDはnull可)、措置の記録のIDを措置による対応済の案件だけが持てる制約、通報者と連絡先を同時に持たない制約、対象ごとの未完了の案件の部分一意索引、カテゴリ名の大文字小文字を区別しない一意索引、通報から案件・カテゴリ・利用者への外部キーと、対象・投稿者・対象のプロダクトのIDに外部キーが無いことを確かめる
  - mainの最新を取り込んでからマイグレーションを生成し(部分一意索引はDrizzleの`uniqueIndex().on(...).where(...)`で生成し、索引のカスタムマイグレーションは作らない)、標準カテゴリ「権利侵害」「その他」をカスタムマイグレーション(`ON CONFLICT (name) DO NOTHING`)で挿入してローカルに適用する
  - 完了状態: 単体テストが成功し、マイグレーションをローカルのD1に適用すると標準カテゴリ2件ができる
  - _Requirements: 3.9, 5.2, 8.1, 9.3, 14.4, 17.5_

- [x] 1.3 (P) 通報の監査ログの操作種別を加える
  - 先に、単体テストで、7種の名前・表示名・対象の種類(案件・カテゴリ)・理由の要否(対応済と却下は必須)・詳細の鍵(状態の変更の前後、対応済の措置、対応済と却下の操作か手での変更かの区別と変更前の状態、カテゴリの削除の付け替えた件数)・対象の上限1と、全操作種別の集約の重複の検査を確かめる
  - 本specの操作種別のファイルを作り、監査ログの操作種別の集約へ加える。集約の完全一致を確かめる上流の単体テスト(`apps/common-lib/admin/audit-actions/index.unit.test.ts`)の期待値に本specの7種を加える
  - 完了状態: 単体テストが成功し、集約の検査を通る
  - _Boundary: ReportingAuditActions_
  - _Depends: 1.1_
  - _Requirements: 8.5, 14.7, 16.1, 16.2_

- [x] 1.4 (P) 対応期間と照会の期限の規則を作る
  - 先に、単体テストで、確認開始の目標の超過(未対応だけ・起点から24時間の前後・土日をまたいでも同じ24時間で数えること)、判断の目標の超過(未完了と完了・9日の前後)、完了から戻した案件を未完了として扱い起点を変えないこと、完了の日時が無い完了した案件の不明、照会の期限(7日)と超過を確かめる
  - 完了状態: 単体テストが成功し、規則がD1と基準時刻の変換を読み込まない
  - _Boundary: ResponseTime_
  - _Depends: 1.1_
  - _Requirements: 12.6, 13.1, 13.2, 13.4, 13.6, 20.2_

- [x] 1.5 (P) 当事者への通知と照会の3つのメール種別とテンプレートを作る
  - 先に、単体テストで、入力のスキーマ(日時・URL・抜粋の上限は1.1の定数)、件名、未ログインの申出者で宛名を省くこと、対応済と却下の本文、投稿者向けの2種別の入力に申出者の情報と申出者の理由が無いこと、照会の本文の内容・対象のURL・回答の方法・期限のUTCの表記、理由と内容の改行を保ったプレーンテキストの差し込み(HTMLとして解釈しない)、問い合わせへのボタン、配信停止のリンクが無いことを確かめる
  - メール種別の集約とテンプレートの集約へ加える
  - 完了状態: 単体テストと、種別とテンプレートの1対1の検査が成功する
  - _Boundary: ReportingEmailKinds, ReportingEmailTemplates_
  - _Depends: 1.1_
  - _Requirements: 11.1, 11.2, 11.6, 11.7, 12.2, 12.4_

- [x] 1.6 (P) ページ配置・文言規則・準拠方針・日次タイムライン・削除請求フロー・データエクスポートの文書に、本specの決定を先に書く
  - ページ配置: 通報のダイアログ、管理者側の通報の一覧と案件の詳細、ダッシュボードのカード、プロダクトの詳細の通報の区画、カテゴリのページの通報カテゴリの区画
  - 文言規則: 設計のSupporting Referencesに挙げた利用者側と管理者側の文言と、3つのメールの本文の要点
  - 準拠方針: データ保持期間にログイン中の利用者の通報と案件の行と、対象の物理削除で対象への参照を消した案件と通報の行(参照の消去から3年、申出者の理由は書き換えない、仮7)を加え、未ログインの通報の行に停止中の利用者の通報を含む旨(仮6)と、完了から戻した案件は再び完了してから14日を数える旨(仮3)を加える
  - プライバシーポリシーの骨子: 通報の対象のユーザー・プロダクトが削除された後も、通報と案件を対象への参照を消して3年保持する旨(仮7)
  - 日次タイムライン: 4:21の表に`content-reporting.notice-redispatch`(2000)・`content-reporting.report-retention`(2010)
  - 削除請求フロー: 案件への集約(仮1)、措置の範囲と措置なしの対応済(仮2)、手での状態の変更と通知の分担・完了から戻す扱い(仮3)、照会の内容と再送(仮4)、1営業日を土日を含む24時間とする目標の超過の判定(仮5)、対象の物理削除後の案件の扱い(仮7)
  - データエクスポート: `reports.json`の`targetRef`が解決できない対象と対象への参照を消した通報で`null`になる旨と、`category`が付け替えで変わらない旨
  - `features/007-content-reporting.md`: 受け付けと回数制限、集約と状態(手での状態の変更と再開を含む)、措置と通知の分担、照会、対応期間、カテゴリ、保持期間(対象への参照の消去を含む)。仮1〜仮8が2026-10-24に開発者の確定を得た旨を添える
  - 完了状態: 8つの文書が整形の検査を通り、7・8のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service`の該当する8文書_
  - _Requirements: 20.6_

- [x] 2. 共有部品
- [x] 2.1 通報の削除のストアを作り、両アプリに束縛する
  - 先に、識別子`REPORTING_PLATFORM_TYPES`が`Symbol.for('reporting.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - apiのジョブとeventの処理のapplication層が読み込めるよう、削除の操作の契約`ReportErasureStore`(文を返さないメソッド)を`apps/backend-lib/core/reporting/ports.ts`に、共有部品の識別子`REPORTING_PLATFORM_TYPES`を`core/reporting/identifiers.ts`に作る。退会の論理削除の文を返す`ReportErasureStatements`は`workers/reporting/report-erasure-statements.ts`に作り、apiのinfrastructure層の同期の処理(3.6)だけが使う。application層は`**/lib/workers/**`を型も含めて読み込めず、文も扱わないため、文の契約を`core`に置かず、削除の操作の契約と識別子を`workers`に置かない
  - D1の実装`D1ReportErasureStore`(`workers/reporting/d1-report-erasure-store.ts`、2つの契約を満たす)とプラットフォームモジュール`REPORTING_PLATFORM_MODULE`を作り、api・eventの登録箇所へ加える。apiの`REPORTING_TYPES`・eventの`EVENT_REPORTING_TYPES`とメンバーの名前を重ねない
  - 先に、Workers統合テストで、退会の論理削除の文、申出者の通報の物理削除と残りの有無、投稿者の案件とプロダクト(とそのコメント)の案件の対象への参照だけを消して案件・通報・理由・状態を残すこと(上限ずつ、2回目は同じ案件を選ばない)、最後の完了から14日を過ぎた案件の未ログインの通報だけの削除(13日と14日の境界・未完了の案件(完了から戻した案件を含む)の通報を消さない・再び完了した案件は再び完了した日時から数えること・ログイン中の通報を残す)、参照の消去から3年を過ぎた案件の通報ごとの削除(境界の前後・参照を消していない案件を消さない)、通報が無くなった案件の削除、2回実行しても結果が変わらないことを確かめる
  - 完了状態: 単体テストとWorkers統合テストが成功し、api・eventの両方でストアと文の契約を解決できる
  - _Depends: 1.2_
  - _Requirements: 17.1, 17.2, 17.4, 17.5, 17.6, 17.9, 17.10_

- [x] 2.2 データエクスポートの通報の照会を作る
  - data-exportのeventのapplication層が読み込めるよう、契約(`ReportExportRecord`・`ReportExport`)を`apps/backend-lib/core/reporting/ports.ts`に、識別子を2.1の`REPORTING_PLATFORM_TYPES`に加え、D1の実装`D1ReportExport`を`workers/reporting/d1-report-export.ts`に作って2.1のプラットフォームモジュールに束縛する。上流の`UserProfileDirectory`・`ProductDirectory`の契約と識別子は`core/profile`・`core/product`から読み込む
  - 先に、Workers統合テストで、項目(ID・対象の種類・対象の参照・受付時点のカテゴリ名・理由・受付日時)とIDの昇順と続きの位置、ユーザーとプロダクトの現在のハンドルとコメントのID、退会・物理削除の対象と対象への参照を消した通報の参照のnull、カテゴリの付け替えの後も受付時点の名前であること、論理削除の除外、対応ステータスと連絡先を返さないことを確かめる
  - 完了状態: Workers統合テストが成功し、eventで照会を解決できる
  - _Depends: 2.1_
  - _Requirements: 17.7, 17.8_

- [x] 3. apiの土台: 識別子・ストア・同期の処理
- [x] 3.1 apiの識別子・ポート・入力と結果の型を作る
  - 設計の全てのユースケース・ストア・書き込みの単位のポート`ReportCaseWriter`・回数制限のポート`ReportSubmissionRateLimit`・ジョブ・同期の処理と、infrastructure層の文の組み立て`D1ReportCaseStatements`・措置の書き込みの参加者`ReportCaseClosingParticipant`のDIの識別子と、入力と結果の型を先に作る。application層のポートは文を返さず接続を受け取らない
  - 措置と一体の完了の参加の値(`application/reporting/report-case-closing-participation.ts`の種類`content-reporting.report-case-closing`・組み立て・読み取り)を作る。値は案件のID・措置・理由・日時・準備した監査ログだけで、文を含めない
  - 先に、単体テストで、組み立てた参加の種類と値、読み取りが種類の違い・形の誤り(措置なしの完了・却下を含む)で値を返さないことを確かめる
  - 以後の3・4・5のタスクは本specのapiの識別子のファイルを変えず、本タスクより後のapiの登録箇所の変更は3.6と5.2だけが行う
  - 他specと本specの共有部品の契約と識別子は`backend-lib/core`(`core/reporting`・`core/identity`・`core/profile`・`core/product`・`core/media`など)から読み込み、`**/lib/workers/**`を型も含めて読み込まない
  - 完了状態: 単体テストが成功し、型検査が通り、ポートが`infrastructure`を読み込まない。APIサーバーの静的解析でapplication層に`**/lib/workers/**`の読み込みが無く、検索でapplication層に`BatchItem`の読み込みが無い
  - _Requirements: 9.2, 19.3_

- [x] 3.2 通報と集約の書き込みのストアを作る
  - 案件の作成と未完了の案件の更新(最後の受付日時は`MAX`で古い時刻へ戻さず、権利侵害の起点は未設定のときだけ)は、`onConflictDoUpdate({ target, targetWhere, set })`の1文にし(`targetWhere`は値を埋め込んだ`sql`)、`onConflictDoNothing({ target, where })`を使わない(`db/002`の部分一意索引への衝突の規則)。一括の書き込みはこの文と通報の挿入の2文にする
  - 先に、Workers統合テストで、通報と新しい案件の一体の確定、未完了の案件への集約、完了した案件の対象への新しい案件、同じ対象への同時の2件で案件が1つになること、対象への参照を消した案件と同じ対象の種類の新しい案件が衝突しないこと、受付時点のカテゴリ名、権利侵害の起点が最初の権利侵害の通報の日時で後の通報で変わらないこと、最後の受付日時の更新(先に読んだ古い時刻で上書きしないこと)、カテゴリの同時の削除で何も残らずカテゴリの不在を返すこと、送信元IPアドレスの列が無いことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 1.2, 3.1_
  - _Requirements: 3.8, 3.9, 5.1, 5.2, 5.3, 5.5, 20.3_

- [x] 3.3 (P) 通報カテゴリのストアを作る
  - 先に、Workers統合テストで、一覧と紐付く件数、前後の空白を除いた大文字小文字を区別しない名前の重複の拒否(追加と名前の変更)、標準カテゴリの名前の変更と削除の拒否、削除で紐付く通報を「その他」へ付け替えて監査ログとともに一体で確定すること、付け替えた通報の受付時点の名前が変わらないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Boundary: D1ReportCategoryStore_
  - _Depends: 1.2, 1.3, 3.1_
  - _Requirements: 14.3, 14.4, 14.5, 14.7, 14.9_

- [x] 3.4 (P) 案件の照会のストアを作る
  - 先に、Workers統合テストで、最後の受付日時の新しい順とカーソル、状態・対象の種類・カテゴリ・受付期間の絞り込みと組み合わせ、件数・最初の受付日時・カテゴリごとの件数(現在のカテゴリ名)をページの案件についてまとめて読むこと、論理削除を除く通報が無い案件を一覧・詳細・未対応の件数・プロダクトの件数に出さないこと、対象への参照を消した案件の対象のIDがnullで参照の消去の日時を返すこと、通報の古い順と連絡先の有無だけを返すこと、未対応の件数と権利侵害の件数、プロダクトの累計と未完了の案件を確かめる
  - 完了状態: Workers統合テストが成功する
  - _Boundary: D1ReportCaseStore_
  - _Depends: 1.2, 3.1_
  - _Requirements: 5.4, 5.6, 6.1, 6.3, 7.2, 7.3, 15.1, 15.3_

- [x] 3.5 (P) 案件の状態の変更・完了・照会の文と書き込みの単位・措置の書き込みの参加者・通知の状態のストアを作る
  - 状態の変更・完了・照会の文の組み立て(`D1ReportCaseStatements`、infrastructure層の内部の部品)と、それを単独の一括の書き込みで確定する書き込みの単位の実装(`D1ReportCaseWriter`)、同じ完了の文に措置の記録のIDを入れて返す措置の書き込みの参加者(`ReportCaseClosingParticipant`、ugc-moderationのinfrastructure層の参加者の契約を実装する)をinfrastructure層に作る
  - 状態の変更・完了・照会の文は、(1)案件の存在の検査の文(読んだ後に案件が物理削除されていれば`report_cases.target_kind`のNOT NULLの違反で全体を取り消す`INSERT … SELECT … WHERE NOT EXISTS`。`id`は案件のIDで、`target_kind`以外のNOT NULLの列には有効な値を入れる。`db/002`の「版の検査で一括の書き込み全体を取り消す」)、(2)`status`の`CASE`式の前進の文、(3)他の更新、(4)監査ログ(`guard`を渡さない)の順に並べる(`backend/008`の前進の文の例外・`backend/021`の検査の文)。書き込みの単位の実装は、違反の原因の連鎖をたどって違反の列で見分け(`report_cases.status`は競合、`report_cases.target_kind`は不在、未完了の案件の部分一意索引は`open-case-exists`)、他の失敗はそのまま投げる
  - 先に、Workers統合テストで、手での状態の変更の3種類(未対応⇄対応中、完了への変更と完了どうしの変更で完了の日時・措置(対応済は措置なし、却下はnull)・理由が入り措置の記録のIDが消え依頼待ちの通知だけが`none`になること、再開で完了の日時・措置・措置の記録のID・理由が消え依頼待ちの通知だけが`none`になり依頼済みの記録が残ること)と監査ログの一体の確定、変更前の状態が違うときの競合、同じ対象に未完了の案件があるときの再開が何も残さず`open-case-exists`になること、参照を消した案件の再開がこの違反にならないこと、完了の文(状態・日時・措置・理由・申出者への通知の状態(連絡先の無い未ログインは`none`)・却下の投稿者への通知の状態(対象への参照を消した案件は`skipped`)・監査ログ)と完了済みの案件での競合で何も残らないこと、再開の後の操作による完了で依頼済み・取りやめた通知が依頼待ちに戻ること(1回の完了につき1回)、照会の文が対応中だけで確定すること、措置なしの対応済・却下の確定で措置の記録のIDがnullであること、参加者が種類・形の誤りで内部エラーになり、参加の値と`context.actionId`から措置の記録のIDを入れた完了の文を返し(読み取りをしない)、完了済みの案件ではその文の確定が何も残さないこと、通知の状態が依頼待ちからだけ1回進むこと、1時間以上前に完了した依頼待ちの案件の一覧(依頼待ちの通報はIDの昇順)、申出者への通知の状態の更新が宛先のまとまりの通報を1文で全部進めること、読んだ後に物理削除された案件への状態の変更・完了・照会が監査ログを含めて何も残さず不在を返すこと、違反の列による競合・不在・`open-case-exists`の見分けと他の失敗をそのまま投げることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Boundary: D1ReportCaseStatements, D1ReportCaseWriter, ReportCaseClosingParticipant, D1ReportNoticeStore_
  - _Depends: 1.2, 1.3, 3.1_
  - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.8, 9.2, 9.3, 10.2, 11.5, 11.8, 12.3, 16.4, 16.5_

- [x] 3.6 退会の同期の処理とapiのモジュールの骨格を作り、ストアと同期の処理を束縛して登録する
  - 退会の同期の処理(退会のイベントで2.1の`ReportErasureStatements`の論理削除の文を返す。文を扱うためinfrastructure層に置く)を作る
  - apiの本specのモジュールを作り、3.2〜3.5のストア・書き込みの単位・措置の書き込みの参加者と退会の同期の処理を束縛してapiの登録箇所へ加え、ユーザーライフサイクルの同期の処理の登録口へ追記し、ugc-moderationの書き込みの参加者の登録の一覧(`composition/moderation-write-participants.ts`)へ`content-reporting.report-case-closing`を追記する。上流の単体テスト(`moderation-write-participants.unit.test.ts`の「初版は参加者を登録しない」)と、`USER_LIFECYCLE_SYNC_HANDLERS`の一覧を固定する上流のテストの期待値を本specの登録に合わせて改める(上流の振る舞いは変えない)
  - 退会の同期の処理は`UserLifecycleSyncHandler`の`statementsFor(event, db)`の形で作る
  - 先に、Workers統合テストで、本物の退会の確定でその利用者の通報が同じ一括の書き込みで論理削除され、他の利用者の通報が変わらないことを確かめる
  - 完了状態: Workers統合テストが成功し、登録口の検査(参加者の登録の一覧の種類の形式と重複を含む)を通る
  - _Depends: 2.1, 3.2, 3.3, 3.4, 3.5_
  - _Requirements: 17.3, 19.1_

- [x] 4. ユースケース(本specの識別子のファイルと登録箇所を変えない)
- [x] 4.1 (P) 通報の対象の判定と表示名を作る
  - ハンドルの形式は`checkHandleFormat(targetRef, USER_HANDLE_RULE)`で検査する
  - 先に、単体テストで、ユーザーの現在と旧のハンドルの解決とハンドルの形式の誤り、停止中・退会済みの拒否、掲載中のプロダクトだけを受け付けること(未掲載・非公開化・投稿者が停止中・論理削除を拒否)、コメントの削除・非公開化・匿名化・投稿者が不可視・プロダクトが未掲載の拒否、投稿者と対象のプロダクトの返却、表示名の照会が種類ごとに1回であること、引けない対象と対象への参照を消した案件を照会せずに表示できない対象とすること、管理者向けに非公開化のコメントの抜粋も返すことを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: ReportTargetResolver_
  - _Depends: 3.1_
  - _Requirements: 3.3, 6.2, 6.7, 7.1, 19.6_

- [x] 4.2 通報の受け付けと回数制限を作る
  - 入力の形式と連絡先の要否・形式はbot判定の前にリゾルバが検証する(5.3、`security/008`)。ユースケースは通報者の種類を確かめ直し、カテゴリの存在・対象・本人・回数制限・保存を行う。現在時刻はリゾルバが1回読んだ`meta.now`を回数制限と保存で共有する
  - 先に、単体テストで、ログイン中・未ログイン・停止中の通報者の種類の判定(確かめ直し)、リゾルバの判定の後に通報者の種類が変わって連絡先が要るようになったときの`contactEmail`の誤りと、要らないときに値を捨てること、カテゴリの不在の誤りの欄、対象が見つからないときの拒否、自分のコンテンツの拒否(停止中の本人を含む)、対象の確認の後に回数制限のポート(偽物)を通報者の種類と送信元IPアドレスと`meta.now`で呼ぶこと、上限の超過で書き込まないこと、ログに識別子と件数だけを出しメールアドレス・理由・IPアドレスを出さないことを確かめる
  - 先に、Workers統合テストで、回数制限の実装`CounterReportSubmissionRateLimit`(ポート`consume(submitter, clientIp, now)`、超過の判定は`RateLimitCounterClient.assertWithinLimit(decision, now.getTime())`)について、利用者の規則を先にIPアドレスの規則を後に数え利用者の規則で拒否されたらIPアドレスの規則を数えないこと、不明なIPアドレスで数えずに警告を残すこと、ハッシュ化したキーの用途の文字列、本物の厳密カウンタでIPアドレスと利用者のそれぞれ11回目が拒否され1時間後に0に戻ること、未ログインと停止中は利用者の規則を使わないことを確かめる(ユースケースと実装はテストの中で組み立てる)
  - 回数制限のポートはapplication層(3.1)、実装と2つの規則は厳密カウンタのクライアントの型と`assertWithinLimit`が共通ライブラリの`workers`にあるためinfrastructure層(`infrastructure/reporting/counter-report-submission-rate-limit.ts`)に作る(`backend/003`、identity-authの`CounterMailSendLimits`と同じ形)。束縛は5.2で加える
  - 完了状態: 単体テストとWorkers統合テストが成功し、APIサーバーの静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 3.2, 4.1_
  - _Requirements: 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 19.4_

- [x] 4.3 (P) 通報カテゴリの一覧と操作を作る
  - 先に、単体テストで、フォーム用の一覧の並び順と権利侵害の印、管理画面用の件数付きの一覧、名前の検証(空・30書記素超)、重複・標準の保護・不在のエラーコード、削除の付け替えた件数の監査ログの詳細、操作ごとの監査ログの準備を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: ReportCategoryService_
  - _Depends: 3.3_
  - _Requirements: 2.1, 14.2, 14.3, 14.4, 14.8, 14.10_

- [x] 4.4 当事者への通知を作る
  - 先に、単体テストで、ログイン中の申出者を利用者ごと、未ログインの申出者を連絡先の照合キーごとにまとめて1通ずつ送ること、ログイン中の申出者と投稿者の宛先を連絡先の照会で引くこと(停止中にも送る・退会済みは送らない記録)、却下だけ投稿者へ送ること、投稿者への入力に申出者の情報が入らないこと、表示名の照会が1回であること、コメントの抜粋の100書記素、対象が引けないときの表示、送信の成功の後だけ依頼済みにすること、送信の失敗で残りを依頼待ちのまま例外を投げること、完了していない案件で何もしないこと、送信の依頼の冪等のキー(申出者への結果は宛先のまとまりの通報のIDの最小と案件の完了の日時のミリ秒、却下の投稿者への通知は案件のIDと完了の日時のミリ秒、送り直しでも同じキー、完了から戻して再び完了するとキーが変わること、キーが`[A-Za-z0-9_.:-]`の40文字以内で宛先・連絡先・入力の値を含まないこと)を確かめる
  - 完了状態: 単体テストが成功する
  - _Depends: 3.5, 4.1_
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.10_

- [x] 4.5 対応ステータスの変更・措置なしの対応済・却下を作る
  - 先に、単体テストで、操作(措置なしの対応済・却下)の理由の要否と上限・案件の不在と完了済みの拒否、手での状態の変更の4状態の全ての組の可否と種類ごとの理由の要否(未対応⇄対応中は任意、完了への変更と再開は必須)、完了した案件も手で変更できること、変更前の状態の不一致の競合、`open-case-exists`の`report_case_open_exists`への変換、監査ログの準備(未対応⇄対応中と再開は状態の変更の前後、手での完了は対応済・却下の操作種別と手での変更の印と変更前の状態、操作は措置なし・却下と操作の印)、却下で投稿者がいれば投稿者への通知を依頼待ちに、対象への参照を消した案件の却下では送らなかった記録(`skipped`)にし、措置なしの対応済では投稿者への通知を`none`にすること、書き込みの単位のポート(偽物)への入力と結果(競合・`open-case-exists`・不在の`report_case_not_found`)の変換、確定の後の通知の依頼(例外を握る)、手での状態の変更では通知も措置も呼ばないこと、ログに識別子だけを出すことを確かめる
  - 完了状態: 単体テストが成功する
  - _Depends: 3.4, 3.5, 4.4_
  - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 9.6, 10.2, 10.3, 11.5, 11.9_

- [x] 4.6 措置による対応済を作る
  - 4.5のユースケースに措置の操作を加え、ugc-moderationの措置のユースケースを3.1の措置と一体の完了の参加の値(種類と値だけ)とともに呼ぶ。案件の完了と措置の記録のIDは3.5の参加者が上流の確定と同じ一括の書き込みに入れるため、ユースケースは文を組み立てず、措置の後に追加の書き込みをしない(ugc-moderationの入力と記録の型は変えない)
  - 先に、単体テストで、対象への参照を消した案件では上流を呼ばずに対象の不在を返すこと、対象の種類ごとの措置のユースケースの選択、参加の値(種類・案件・措置・理由・日時・監査ログ)の受け渡しと文を渡さないこと、措置済み(変化なし)の返却、上流の対象の不在の変換、上流の確定の失敗で案件を読み直して無ければ`report_case_not_found`・完了済みなら競合・そうでなければ上流のエラーを返すこと、成功の後に追加の書き込みをせず通知を依頼することを確かめる
  - 先に、Workers統合テストで、本物のプロダクトの非公開化・コメントの非公開化・ユーザーの停止と3.6で登録した参加者を通して、上流の状態の変更・措置の記録・ugc-moderationと本specの2つの監査ログ・案件の完了(措置の記録のIDを含む)・申出者への通知の状態が1回の一括の書き込みで確定し、案件の措置の記録のIDが結果の措置の記録のIDと上流の措置の記録のIDに一致すること、既に措置済み・完了済み・同時の完了(参加者の文の違反)・読んだ後の案件の物理削除(存在の検査の文の違反)で上流の状態を含めて何も残らないことを確かめる(ユースケースはテストの中で組み立て、3.6の束縛を使う)
  - 上流の確定が参加者の文の違反で全体を取り消さない場合、または参加者が受け取る措置の記録のIDが結果の措置の記録のIDと異なる場合は、作業を止めて開発者へ報告する
  - 完了状態: 単体テストとWorkers統合テストが成功し、APIサーバーの静的解析でapplication層に`**/lib/workers/**`の読み込みが無く、検索でapplication層に`BatchItem`の読み込みが無い
  - _Depends: 3.6, 4.5_
  - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.7, 9.8, 16.5, 19.1, 20.3_

- [x] 4.7 (P) 権利侵害の照会を作る
  - 先に、単体テストで、内容の検証(空・1,000書記素超)と任意の理由の上限、権利侵害でない・対応中でない・投稿者がいない・宛先が無いときの拒否、照会のメールの入力(内容・表示名・対象のURL・期限)、送信の後に書き込みの単位のポート(偽物)で記録すること、送信の失敗で記録せずに失敗を返すこと、記録の失敗のエラートラッキングへの通知と競合の返却、記録の不在でもエラートラッキングへ通知して`report_case_not_found`を返すこと、照会のメールの依頼に冪等のキーを付けないこと(送り直しのジョブが無いため)、再送の期限が最後の照会から求まることを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: InfringementInquiryService_
  - _Depends: 1.3, 1.4, 1.5, 3.1, 4.1_
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8_

- [x] 4.8 案件の一覧・詳細・件数の照会を作る
  - 監査ログの照会の偽物はadmin-foundationのテストの共有の偽物で作り、本specで`AuditLogReader`の偽物を新たに書かない
  - 先に、単体テストで、一覧の案件・表示名・完了の日時の照会がそれぞれ1回で、完了の日時をadmin-foundationの複数の対象の照会で対応済と却下の操作種別ごとに各1回まとめて引き、新しい方を最後の完了とすること(手での完了を含む)、完了から戻した案件を対応中の期間として示すこと、権利侵害の案件だけの対応期間と目標の超過、完了の日時が得られないときの不明、詳細の通報の一覧と申出者の表示名(ログイン中のニックネームとハンドル、未ログインは連絡先の有無だけ)、完了の種類と理由と日時、最後の照会と期限と超過、照会できるかの判定(投稿者の宛先の有無を含む)、不在の案件、未対応の件数とプロダクトの件数を確かめる
  - 完了状態: 単体テストが成功する
  - _Depends: 1.4, 3.4, 4.1_
  - _Requirements: 6.1, 6.2, 7.1, 7.2, 7.3, 7.5, 7.6, 13.1, 13.2, 13.3, 13.5, 13.6, 15.1, 15.3, 19.6_

- [x] 5. ジョブ・束縛・GraphQL
- [x] 5.1 通知の送り直しと保持期間の削除のジョブを作る
  - 閾値は実際に動いた時刻ではなく起動の予定時刻(`ScheduledJobContext.scheduledTime`)から引く(`security/008`)。2つのジョブの定義は各ジョブのファイルで凍結した`REPORT_NOTICE_REDISPATCH_JOB_DEFINITION`・`REPORT_RETENTION_JOB_DEFINITION`としてexportする(既存のジョブと同じ形)
  - 先に、単体テストで、予定時刻の1時間以上前に完了した依頼待ちの案件の送り直しと失敗の件数のエラートラッキングへの通知、予定時刻から引いた閾値による未ログインの通報の保持期間の削除・参照を消した案件の3年の削除・空の案件の削除の順序と繰り返しの上限と件数の記録、起動が遅れても同じ予定時刻なら対象が変わらないことを確かめる
  - 先に、Workers統合テストで、送り直しが宛先ごとに依頼済みへ1回だけ進み2回実行しても重ならないこと、依頼の後の依頼済みへの更新だけが失敗した案件の送り直しが同じ冪等のキーで依頼され2通目を送らないこと、手での完了と再開で取りやめた通知を送らないこと、保持期間の削除を2回実行しても結果が変わらないことを確かめる(ジョブと通知はテストの中で組み立てる)
  - 保持期間の削除のジョブは、`core/reporting`の`ReportErasureStore`を`REPORTING_PLATFORM_TYPES.ReportErasureStore`で受け取る
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - _Depends: 2.1, 4.4_
  - _Requirements: 8.4, 11.8, 17.1, 17.2, 17.6, 17.9, 17.10, 19.5, 20.3_

- [x] 5.2 apiの束縛を完成させ、ジョブとスキーマモジュールの型を登録する
  - 3.6のモジュールに全てのユースケース・照会・通知・ジョブと回数制限の実装(`ReportSubmissionRateLimit`→`CounterReportSubmissionRateLimit`)を束縛し、2つのジョブを定期実行の登録箇所へ加える
  - スキーマモジュールの型・入力の検証・エラーコードと、呼び出し元の種類を入力の検証より前に拒否する`clientOnly`・`adminOnly`と`accountGuardOf`(`resolver-support.ts`、既存のモジュールと同じ形)を作り(リゾルバは5.3〜5.5)、スキーマモジュールの登録箇所へ加える
  - 4:21の並びを固定する上流の単体テスト(`apps/api/test/config/ugc-moderation-scheduled-jobs.unit.test.ts`の1910の直後を2300とする並びと、他の`test/config/*-scheduled-jobs.unit.test.ts`)の期待値を、本specの2000・2010を含む並びに改める(上流の振る舞いは変えない)
  - 先に、Workers統合テストで、apiの要求と定期実行の経路で全識別子が解決でき、4:21の`order`(2000・2010)が他と重ならず、4:21の合計の予算(300秒)の表に影響しないことを確かめる
  - 先に、単体テストで、入力の検証(件数・対象の参照・理由の空と1,000書記素・管理者の理由と照会の内容とカテゴリ名の上限・連絡先の長さ・期間の順)とエラーコードの形を確かめる
  - 完了状態: Workers統合テスト・単体テストと登録の検査が成功する
  - _Depends: 4.2, 4.3, 4.6, 4.7, 4.8, 5.1_
  - _Requirements: 19.2_

- [x] 5.3 利用者側の通報のリゾルバを作る
  - `submitReport`は`clientOnly`→`withValidatedArgs`(入力の形式)→通報者の判定(`accountGuardOf(context).currentUser`)→連絡先の要否と形式(要らなければ値を捨てる)→`assertHuman('report')`→ユースケースの順にし、現在時刻を1回読んで渡す(`security/008`の「確認の順序」)。欄の詳細は`withInputPath`で`input.`を前に付ける
  - 先に、Workers統合テストで、`reportCategories`の並びと権利侵害の印、`submitReport`のbot判定の検証と失敗、利用者側以外からの拒否が入力の検証より前であること、入力の誤り(理由の空・1,001書記素)と未ログイン・停止中の権利侵害での連絡先の入れ忘れ・形式の誤りがbot判定の前に欄ごとの`validation_error`になりbot判定の検証が呼ばれないこと、ログイン中で権利侵害以外では連絡先を捨てること、受け付けの結果、`report_target_not_found`・`report_own_content`・`rate_limited`(429と再試行の秒数)を確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 2.4, 2.6, 3.1, 3.2, 3.5, 3.6, 4.3_

- [x] 5.4 案件の照会と操作のリゾルバを作る
  - 先に、Workers統合テストで、照会は閲覧のみ以上・操作はモデレーター以上の認可、管理者側以外の拒否が入力の検証より前であること(`adminOnly`)、未ログインの拒否、読んだ後に物理削除された案件の操作の`report_case_not_found`、`adminReportCases`の接続の形と絞り込み、`adminReportCase`の形と不在、状態の変更(完了した案件からの再開と`report_case_open_exists`を含む)・措置・措置なしの対応済・却下・照会の結果と各エラーコード、参照を消した案件の対象の`id`がnullで`detached`が真であることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 6.3, 8.7, 8.8, 9.8, 10.3, 12.7, 18.2, 18.3, 18.4_

- [x] 5.5 カテゴリと件数のリゾルバを作る
  - 先に、Workers統合テストで、`adminReportCategories`・`adminUnhandledReportSummary`・`adminProductReportSummary`の形と閲覧のみ以上の認可、カテゴリの3つの操作のモデレーター以上の認可・結果・各エラーコードを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 14.10, 15.1, 15.3, 15.5, 18.2_

- [x] 6. (P) 物理削除の時期の通報の削除と対象への参照の消去を作り、eventの登録口に加える
  - 先に、単体テストで、ユーザーの物理削除の時期に申出者の通報の削除・投稿者の案件の対象への参照の消去・空の案件の削除を上限ずつ行って残りがあれば続きを返すこと、プロダクトの物理削除の時期にそのプロダクトとコメントの案件の対象への参照を消すこと(案件と通報を削除しないこと)を確かめる
  - 2つの処理は`core/reporting`の`ReportErasureStore`を`REPORTING_PLATFORM_TYPES.ReportErasureStore`で受け取り、`**/lib/workers/**`を読み込まない
  - eventの本specのモジュールと、ユーザー・プロダクトのライフサイクルの非同期の登録口(`purge_due`、1800)へ加える。1800は、ugc-moderationの措置の記録の削除(1900)を全ドメインの物理削除の処理の後(末尾)に保つための値で、roadmapの帯の割り当て(2000)と異なる
  - `purge_due`の一覧と並びを固定する上流のテスト(`user-lifecycle-async-handlers.unit.test.ts`・`product-lifecycle-async-handlers.unit.test.ts`と、各モジュールのWorkers統合テストの`purge_due`の一覧。候補は`engagement-module.worker.test.ts`・`notifications-module.account-purge.worker.test.ts`・`match-module.purge.worker.test.ts`・`user-product-erasure.worker.test.ts`・`profile-module.worker.test.ts`・`directory-module.worker.test.ts`・`product-module.worker.test.ts`など)のうち失敗するものの期待値を、本specの1800を含む一覧に改める(上流の振る舞いと「ugc-moderationが末尾」の期待は変えない)
  - 完了状態: 単体テストと登録口の検査(同じ種類の`order`の重複なし)が成功し、eventの全テストが成功し、イベントサーバーの静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Boundary: ReportErasureHandlers, EventReportingModule_
  - _Depends: 2.1_
  - _Requirements: 17.4, 17.5, 17.6, 19.2_

- [x] 7. 利用者側の画面
- [x] 7.1 利用者側のGraphQLの操作を書き、型と許可リストを生成する
  - `reportCategories`・`submitReport`を利用者側の操作として`src/graphql/operations/reporting/`の1ファイル1操作の`*.graphql`(操作名は`Client`で始める)に書き、利用者側で`bun run graphql:generate`を実行して型と`<操作名>Document`を生成し、apiで`bun run graphql:allowlist`を実行して利用者側の許可リストを再生成する
  - カテゴリの照会の選択肢(`graphqlQueryOptions`)と通報の送信の選択肢(`graphqlMutationOptions`)を`src/graphql/reporting.ts`に作り、単体テストで選択肢と照会のキーを確かめる。部品は生成物の型に直接依存しない
  - 完了状態: 型の生成と型検査と単体テストが成功し、本specの利用者側の操作が利用者側の許可リストにだけ載る
  - _Depends: 5.3_
  - _Requirements: 3.2_

- [x] 7.2 通報のダイアログとフォームを作る
  - 先に、単体テストで、フォームの検証(カテゴリ必須・理由1〜1,000書記素、連絡先を含むスキーマだけが連絡先の形式と254文字を検証し、連絡先を含まないスキーマは連絡先を出力に含めないこと)を確かめる
  - 先に、ブラウザテストで、題と説明、カテゴリの並び、理由の文字数と上限、未ログイン・停止中で権利侵害を選んだときだけの連絡先の欄と案内、連絡先を描かない間は送信の値に連絡先が無いこと、権利侵害で連絡先に誤りを入れてから他のカテゴリへ変えると連絡先を含まないスキーマの結果で送信ボタンが有効になり連絡先のエラーで無効のまま残らないこと、描かれていない連絡先の欄へのサーバーの詳細がフォーム全体の失敗として示され送信ボタンが無効のまま残らないこと、権利侵害の理由の案内、`sendWithTurnstile`によるbot判定のトークンを付けた送信(ウィジェットは非表示で、判定の枠と場所を設けない)と`bot_verification_failed`のときだけ新しいトークンで1回送り直すことと判定の失敗の文言、ログイン状態を`useViewer()`で読むこと、欄の誤りで送らず入力を保つこと、受け付けの通知と閉じること、サーバーのエラーコードごとの文言で入力を保つこと、`GraphQLClientError`でない例外で`errorMessageOf`の文言を出すこと、カテゴリの取得の失敗のダイアログの中だけの再試行、閉じたときの入力の破棄とフォーカスの戻り、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: 単体テストとブラウザテストが成功する
  - _Depends: 7.1_
  - _Requirements: 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

- [x] 7.3 公開プロフィール・プロダクト詳細・コメントへ通報の操作を登録する
  - プロダクト詳細のページ末尾(`bottom` 10)・他者のコメントの「…」メニュー(10)・公開プロフィールの「…」メニュー(10)の登録口へ加える。メニューの項目とダイアログは`frontend/015`の「メニューの登録口の項目とダイアログ」の規約に従う。登録口の一覧を固定する上流のブラウザテスト(`product-page-sections.browser.test.ts`・`product-page-sponsored-placements.browser.test.tsx`・`comment-actions.browser.test.ts`・`public-profile-sections.browser.test.ts`・`test/public-profile-route.browser.test.tsx`)のうち失敗するものの期待値を改める
  - 先に、ブラウザテストで、ログイン状態を問わず操作が表示されること、本人には表示しないこと、メニューから開いたダイアログを閉じるとメニューのボタンへフォーカスが戻ること、各操作が正しい対象の種類と参照でダイアログを開くこと、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストと利用者側の全テストが成功し、ローカルで3つのページから通報のダイアログを開ける
  - _Depends: 7.2_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 8. 管理画面
- [x] 8.1 管理者側のGraphQLの操作を書き、型と許可リストを生成する
  - 照会と案件の5つの操作・カテゴリの3つの操作を管理者側の操作として`src/graphql/operations/reporting/`の1ファイル1操作の`*.graphql`(操作名は`Admin`で始める)に書き、管理者側で`bun run graphql:generate`を実行して型と`<操作名>Document`を生成し、apiで`bun run graphql:allowlist`を実行して管理者側の許可リストを再生成する
  - 照会の変換・`loader`(失敗を握りつぶしてキャッシュに残し、`cause === 'stay'`では待たない)・無効化の関数を`src/graphql/admin-reporting-cases.ts`・`admin-reporting-categories.ts`・`admin-reporting-summaries.ts`に作り(`frontend/020`・`frontend/006`)、単体テストで変換と照会のキーと無効化の範囲を確かめる。部品は生成物の型に直接依存しない
  - 完了状態: 型の生成と型検査と単体テストが成功し、本specの管理者側の操作が管理者側の許可リストにだけ載る
  - _Depends: 5.4, 5.5_
  - _Requirements: 18.3_

- [x] 8.2 管理画面の共通部品を作る
  - 一覧(`/reports`)と詳細(`/reports/$caseId`)のルートの最小の枠を先に作る(中身は8.3・8.4が作る)。ルートは`validateSearch`・`loaderDeps`・`loader`・`head`・`component`だけを持ち、ページの部品は`components/pages/`に置く
  - 一覧のページ用の検索条件(`components/reporting/shared/report-search.ts`。`frontend/020`・`frontend/014`の規約で、項目ごとの`.catch(undefined)`・空文字は未指定・逆の期間の両端の未指定・条件の変更でページの位置を外す・`ReportCaseSearchAt`・`reportCaseFilterScopeOf`)と、一覧と詳細の両方のページが使う操作の実行・一覧と詳細の単位に1つ置く確認のダイアログの置き場所(`ReportCaseDialogHost`とダイアログを開く関数を渡す文脈`report-case-dialog-context.ts`、ugc-moderationの`ModerationDialogHost`・`moderation-dialog-context.ts`と同じ形。失敗の後は起点のボタンが残っていればそこへ、消えていれば一覧の見出しへフォーカスを移す)・操作の確認のダイアログ・状態のバッジ・対応期間の表示・対象の表示・カテゴリごとの件数・措置・措置なしの対応済・却下を開く操作(ダイアログを持たない)を作る
  - ugc-moderationの`components/moderation/shared/use-moderation-mutation.ts`の措置の影響する照会の対応表`AFFECTED_QUERIES`を`invalidateModerationAffectedQueries(queryClient, targetKind)`として切り出してexportし、`useModerationMutation`もそれを呼ぶようにする(振る舞いは変えず、ugc-moderationの既存のブラウザテストが変わらず成功することで確かめる)
  - 操作の実行は、成功の後に本specの照会と`invalidateAuditLogQueries`(失敗と措置済みの後は呼ばない、`frontend/009`)を、措置による対応済ではさらに`invalidateModerationAffectedQueries`を無効にする。`report_target_unavailable`・`report_case_closed`・`report_case_state_conflict`・`report_case_not_found`の失敗では案件の照会(対象の不在ではugc-moderationの影響する照会も)を無効にしてから投げ直し、詳細のページの指定(`deferRefresh`)では無効化をダイアログを閉じる時まで遅らせる(`frontend/020`の形。対象の不在以外でも取り直すのは規約との意図した違いで、`frontend/021`に書く)
  - 確認のダイアログの「入力した理由が通知に載る」旨は、`ConfirmActionDialog`が理由の欄の注記の引数を持たないため`description`の文で示す
  - 先に、単体テストで、検索条件の解析(項目ごとの不正な値の除去・空は未指定・逆の期間・ページの位置)とGraphQLの絞り込みへの変換を確かめる
  - 先に、ブラウザテストで、確認のダイアログ(理由の必須と上限・個人情報と通知に載る旨の説明・監査ログに記録される旨・措置の影響と通知の説明・却下で送った通知は取り消せない旨・措置済みで措置なしの対応済への切り替えの案内・失敗で入力を保ち、失敗の文言を`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`で選ぶ)、操作の成功の通知と照会の無効化(成功の後だけ監査ログの照会を無効にし失敗と措置済みの後は無効にしないことを`watchAuditLogQueries`で、措置の後にugc-moderationの影響する照会を無効にすること)、4つの失敗(対象の不在・完了済み・競合・案件の不在)の後の案件の照会の取り直しと遅らせる指定、失敗の後のフォーカスの戻り先(起点のボタンが消えたときは一覧の見出し)、対応期間の経過と対応中と超過の強調(文言付き)と不明、状態のバッジ、対象の表示(種類・表示名・抜粋を文字列として・表示できない対象・対象への参照を消した案件の削除された対象)、カテゴリごとの件数、措置の操作が対象の種類に応じた名前でモデレーター以上かつ未対応・対応中のときだけ出て閲覧のみと完了済みでは出ないこと、日時の`<time datetime>`、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: 単体テストとブラウザテストと、ugc-moderationの管理画面の既存のブラウザテストが成功する
  - _Depends: 8.1_
  - _Requirements: 6.4, 6.9, 9.1, 9.5, 9.6, 9.9, 10.1, 10.4, 13.4, 16.3, 18.5, 18.6, 18.7, 18.8_

- [x] 8.3 (P) 通報の一覧のページを作る
  - 絞り込みと表のページの部品(`components/pages/reports-page.tsx`)を作り、8.2の対象の表示・カテゴリごとの件数・措置の操作を表の各項目に、確認のダイアログの置き場所を表の外に1つ使う。部品は`keepPreviousData`で読み、再読み込みの間は表を`inert`・`aria-busy`にする(`frontend/014`)
  - 先に、ブラウザテストで、絞り込み(状態・対象の種類・カテゴリ・受付の開始日と終了日)の組み合わせとURLの保持、再読み込みの間の`inert`・`aria-busy`、表の項目(対象の種類と表示・件数・カテゴリごとの件数・状態・最初と最後の受付日時・権利侵害の案件だけの対応期間)、表示できない対象の項目があっても他の項目を操作できること、該当なし、各項目から措置・措置なしの対応済・却下を開けること、未対応で絞った一覧で確定して行が消えても確認のダイアログが残り確定の後に一覧の見出しへフォーカスが移ること、項目から詳細への移動、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: ReportsPage_
  - _Depends: 8.2_
  - _Requirements: 6.2, 6.3, 6.5, 6.6, 6.7, 6.8, 9.1, 9.6, 10.1, 13.5, 18.8_

- [x] 8.4 (P) 案件の詳細のページを作る
  - 詳細・通報の一覧・状態の変更・照会の部品とページの部品(`components/pages/report-case-page.tsx`)を作り、8.2の対象の表示・カテゴリごとの件数・措置の操作・確認のダイアログの置き場所(取り直しをダイアログを閉じるまで遅らせる)を使う。照会のダイアログは独自の入力のダイアログのため`ConfirmActionDialog`と同じ扱いにし、処理中は確定のボタンを`aria-disabled`・`aria-busy`にする(`frontend/009`)
  - 先に、ブラウザテストで、詳細のページで操作が対象の不在・完了済み・競合・案件の不在で失敗したときにダイアログを閉じるまで取り直さず閉じた後に取り直すこと、照会のダイアログの処理中の`aria-disabled`・`aria-busy`、対象と状態と変更日時と件数と内訳と対応期間、通報の古い順の一覧(理由は文字列・ログイン中はニックネームとハンドル・未ログインは連絡先の有無だけ)、利用者側のページとugc-moderationの各管理画面への導線、完了の種類と理由と日時、手での状態の変更(完了した案件を含む現在と異なる3つの選択肢、未対応⇄対応中は任意の理由・完了への変更と再開は必須の理由、通知しない旨と再開の注記、未完了の別の案件があるときの表示)、詳細から措置・措置なしの対応済・却下を開けること、権利侵害で対応中のときだけの照会の操作と照会のダイアログ(内容の上限と数・個人情報の注記・期限の案内・失敗で入力を保つ)、最後の照会と期限と超過の表示、不在の表示、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: ReportCasePage_
  - _Depends: 8.2_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.2, 8.3, 8.4, 8.8, 9.1, 9.6, 10.1, 12.1, 12.6, 12.9, 18.8_

- [x] 8.5 (P) ダッシュボードのカードとプロダクト詳細の区画を作り、登録口に加える
  - ダッシュボードのカードの登録口(30、半幅)とプロダクト詳細の区画の登録口(10)へ加える。登録口の一覧を固定する上流のブラウザテスト(`unhandled-inquiries-card.browser.test.tsx`・`components/pages/product-detail-page.browser.test.tsx`など)のうち失敗するものの期待値を改める
  - 区画はugc-moderationのプロダクト詳細で`RecoverableSlot`に包まれるため、最初の取得の失敗は`throwOnError: (_error, query) => query.state.data === undefined`で区画の境界へ渡し、取り直しの失敗では表示中のデータを残す(`frontend/006`)。カードも取り直しの失敗で表示中の件数を残し(inquiry-chatの`UnhandledInquiriesCard`と同じ形)、定期の再取得はしない(`frontend/010`)
  - 先に、ブラウザテストで、カードの件数と権利侵害の件数と0件の案内と一覧(未対応の絞り込み)への導線、最初の取得の失敗がカードの中だけのエラーと再試行になり問い合わせのボタンと問い合わせを促す文が出ないこと、取り直しの失敗で件数が残ること、区画の累計と未完了の案件の状態と導線、区画の最初の失敗が区画の中のエラーと再試行になり詳細の他の表示を止めないこと、区画の取り直しの失敗で表示中のデータが残ること、投稿者が無い(`ownerUserId`がnull)プロダクトでも件数を示すこと、全ロールに表示されること、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功し、ローカルでダッシュボードとプロダクトの詳細に表示される
  - _Boundary: UnhandledReportsCard, ProductReportsSection_
  - _Depends: 8.2_
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 18.8_

- [x] 8.6 (P) 通報カテゴリの区画を作り、カテゴリのページに登録する
  - カテゴリのページの区画の登録口(40)へ加える。`CategoryMasterEditor`に`deleteDescriptionOf`(付け替える件数)と`deleteAudited`を渡し(inquiry-chatの区画と同じ形)、操作の成功の後にカテゴリ・一覧の絞り込みの選択肢・案件・監査ログの照会を無効にする(前例は`admin-inquiry-categories.ts`)。区画の一覧を固定する上流のブラウザテスト(`components/pages/categories-page.browser.test.tsx`)のうち失敗するものの期待値を改める
  - 先に、ブラウザテストで、一覧の並び、モデレーター以上だけの追加・名前の変更・削除と閲覧のみで操作が出ないこと、標準カテゴリに名前の変更と削除の操作が無いこと、削除の確認の付け替える件数、操作の成功の後だけの照会の無効化(監査ログの照会を含む)、拒否の文言の表示、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功し、ローカルでカテゴリのページに通報カテゴリの区画が表示される
  - _Boundary: ReportCategorySection_
  - _Depends: 8.1_
  - _Requirements: 14.1, 14.2, 14.6, 14.8, 18.8_

- [x] 8.7 管理画面のメニューへ通報のページを登録する
  - メニューの登録箇所へ通報(70)を加え、メニューの並びを固定する上流のテスト(`components/layout/admin-nav-order.unit.test.ts`・`admin-navigation.browser.test.tsx`・`test/admin-shell.browser.test.tsx`、`frontend/009`)の期待値を改める
  - 先に、ブラウザテストで、メニューの並びと現在のページの表示を確かめる
  - 完了状態: ブラウザテストと管理者側の全テストが成功し、ローカルでメニューから通報の一覧へ移動できる
  - _Depends: 8.3, 8.4_
  - _Requirements: 18.1_

- [x] 9. 統合・ドキュメント・E2E
- [x] 9.1 技術ドキュメントとオンボーディングを書く
  - `backend/022-submission-aggregation-and-case-resolution.md`・`security/011-mixed-identity-submission-limits.md`・`frontend/021-registered-action-dialogs.md`を本プロジェクト固有の値を含めずに書き、各READMEの文書一覧に加える。既存の文書と重なる部分は参照に置き換えて差分に絞る: `backend/022`は投稿の集約・完了と再開・対応期間の規則(措置と完了の一体の確定は`backend/021`を参照)、`frontend/021`は複数の登録口で同じダイアログを共有する形と一覧の単位のダイアログの置き場所と、`frontend/020`と異なり完了済み・競合・案件の不在の失敗でも一覧を取り直す場合の扱い(メニューの登録口の項目とダイアログは`frontend/015`、確認のダイアログと対象の不在の取り直しは`frontend/020`を参照)、`security/011`は会員と未ログインが同じ操作を使う投稿の回数制限と連絡先の要否(未ログインの投稿の保護は`security/008`を参照)
  - `docs/onboardings/project-values.md`にジョブ・処理・同期の処理・措置の書き込みの参加者(`content-reporting.report-case-closing`)・登録の名前と`order`(`purge_due`の1800)、メールの冪等のキーの組み立て、回数制限の規則、メール種別、監査ログの操作種別、標準カテゴリの固定のIDを、`CLAUDE.md`の「技術規則の参照先」に`backend/022`の行を加える
  - 完了状態: 文書が整形の検査を通り、技術ドキュメントに本プロジェクト名と固有の値が無いことを検索で確かめる
  - _Requirements: 19.4, 20.5_

- [x] 9.2 E2Eの補助を作る
  - admin-foundationの`executeLocalD1`(文字列は`sqlStringLiteral`)で、指定した対象・カテゴリ・通報者(ログイン中の利用者または連絡先付きの未ログイン)の案件と通報を作る補助を作る。未ログインの送信元IPアドレスは`e2e/support/client-ip.ts`の`assumeDistinctClientIp`、bot判定のトークンの待機は`e2e/support/bot-verification.ts`の`waitForBotToken`を使い、同じ働きの補助を作らない
  - 完了状態: 補助の関数を呼ぶ空のE2Eが成功し、ローカルD1に案件と通報ができる
  - _Depends: 5.2_
  - _Requirements: 20.4_

- [x] 9.3 利用者側の通報のE2Eシナリオを作る
  - directory-discoveryの`directory-fixtures.ts`で掲載中のプロダクトを作り、未ログイン(文書用の範囲の`CF-Connecting-IP`)で「権利侵害」を選ぶと連絡先が必須になり通報が受け付けられることを確かめる
  - `mailpit.ts`で登録した利用者で、公開プロフィールと他者のコメント(ugc-moderationの`moderation-fixtures.ts`)を通報でき、自分のプロフィール・プロダクト・コメントに通報の操作が無いことを確かめる。`moderation-fixtures.ts`の投稿者はログインできないため、自分のコメントはその利用者が画面から投稿して用意する
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 5.2, 7.3_
  - _Requirements: 20.4_

- [x] 9.4 通報への対応と照会のE2Eシナリオを作る
  - テストの中で、directory-discoveryの`directory-fixtures.ts`で掲載中のプロダクトを作り、利用者側の画面から未ログイン(文書用の範囲の`CF-Connecting-IP`)で連絡先付きの「権利侵害」の通報を送って案件を作る(他のE2Eに依存せず単独で走る)
  - `signInAsNewAdmin`のモデレーターで、その案件を権利侵害の絞り込みで見つけて対応中にし、照会を送ると投稿者に照会のメールが届き詳細に期限が出ることを確かめる
  - 非公開化で対応済にすると利用者側のプロダクト詳細が他者に404になり、申出者の連絡先に対応結果・投稿者に非公開化の通知が届き、監査ログの画面に「通報への対応(対応済)」と「プロダクトの非公開化」が出て、ダッシュボードのカードとプロダクトの詳細の区画の件数が変わることを確かめる
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 7.3, 8.4, 8.5, 8.7_
  - _Requirements: 20.4_

- [x] 9.5 却下とカテゴリのE2Eシナリオを作る
  - 却下の場面は`e2e/admin/report-rejection.e2e.test.ts`、カテゴリの場面は`e2e/admin/report-categories.e2e.test.ts`に置く
  - 9.2の補助でログイン中の利用者のコメントへの通報の案件を作り、却下すると申出者と投稿者に却下の通知が届き案件が却下になること、その案件を理由付きで手で対応中へ戻すと完了の表示が消えメールが増えないことを確かめる
  - カテゴリを追加すると通報のダイアログに出て、そのカテゴリの通報を作ってから削除すると案件の内訳が「その他」になり、標準カテゴリに削除の操作が無いことを確かめる
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 7.3, 8.3, 8.4, 8.6, 9.2_
  - _Requirements: 20.4_

- [x] 9.6 全体の検査とカバレッジを確かめ、作業を報告する
  - 整形・静的解析・型検査・4種のテストを全アプリで実行し、本specが変更したファイルのカバレッジが80%以上であることを確かめる
  - admin-foundationの仮7(`latestForMany`と共有の偽物)の実装を前提にした旨、上流の公開の契約を変えていない旨(ugc-moderationの書き込みの参加者の登録の一覧へ1件を追記し、管理画面の措置の影響する照会の対応表を振る舞いを変えずに`invalidateModerationAffectedQueries`として公開しただけである旨)、本specの登録に合わせて期待値を改めた上流のテストの一覧、application層に`**/lib/workers/**`・`BatchItem`の読み込みが無い旨、仮1〜仮8が2026-10-24に確定した旨(仮3・仮5・仮7は案B)、2026-11-22の差分の分析の決定(メールの冪等のキー・`onConflictDoUpdate`・`purge_due`の1800・検証の順・照会の無効化・一覧の単位のダイアログ・技術ドキュメントの範囲)、roadmapの帯の「使用中の値」(4:21は2000・2010、波及処理は1800で帯の割り当ての2000と異なる)を作業の報告に記録する
  - 完了状態: 一括の検査と全テストが成功し、カバレッジの閾値を満たす
  - _Requirements: 20.1, 20.3_

## Implementation Notes

- 1.1: 規則は`apps/common-lib/reporting/report-rules.ts`(対象の種類・理由の検証・連絡先の要否・標準カテゴリの固定のID・カテゴリの並び)、`report-case-rules.ts`(状態・手での状態の変更の可否と種類・対象の種類ごとの措置・管理者の理由の要否・照会の上限と期限)、`report-labels.ts`。設計に無い追加として`REPORT_RESOLUTIONS`(1.2の制約の照合用)・`checkInquiryMessage`(`'ok' | 'empty' | 'too-long'`)・`REPORT_ADMIN_REASON_MAX`(`AUDIT_REASON_MAX`と同値)と補助の型をexportした。措置の表示名はugc-moderationの`MODERATION_ACTION_LABELS`を再利用し、状態の表示名はinquiry-chatの`INQUIRY_STATUS_LABELS`と単体テストで照合する。読み込み先は設計の記載(`common-lib/admin`と`zod`)より広く`common-lib/text`・`common-lib/moderation`も含む(境界の検査は通る)。写しの照合(`check:contract-copies`)は写しを持つ側(1.2のDBのスキーマ)で扱う
- 1.3: 7種は`apps/common-lib/admin/audit-actions/content-reporting.ts`の`REPORTING_AUDIT_ACTIONS`(定数名は`REPORT_STATUS_CHANGE_ACTION`など)で、集約の末尾(ugc-moderationの後)に連結した。`report.resolve`・`report.reject`の詳細`mode`の値(`operation`・`manual`)の定数は作っていないため、4.5で組み立てる。手での再開の理由の必須は操作種別でなくapplication層の`checkReportAdminReason`で検査する
- 1.4: 規則は`apps/backend-lib/core/reporting/response-time.ts`(`computeResponseTime`・`inquiryDeadline`・`isInquiryOverdue`)。`ResponseTimeAlert`の型は1.1の`report-labels.ts`から読み込んで再エクスポートし(設計は`response-time.ts`で宣言)、目標の定数は`number`型(設計はリテラル型)。境界は「超える」(`>`)で、ちょうどは超過でない。完了の日時が無い完了した案件は`elapsedMs: null`・`alerts: []`(設計に記載が無く、不明と超過の強調が矛盾しないよう決めた)。未完了の案件に渡された完了の日時は無視する
- 1.2: スキーマは`apps/db/schema/reporting/`、マイグレーションは`20261122054825_content_reporting`と初期データの`20261122054830_content_reporting_seed`。設計に無い既定値として`status`は`'open'`、2つの通知の状態は`'none'`。`reports.deleted_at`は前例の`softDelete()`で末尾の列。制約の名前は`report_cases_closed_at_check`・`report_cases_target_detached_at_check`・`report_cases_resolution_action_id_check`・`reports_contact_email_check`、部分一意索引は`report_cases_target_kind_target_id_open_unique`。値の写しは`config/content-reporting-contract-copies.unit.test.ts`で照合し(`check:contract-copies`に追加)、通知の状態はugc-moderationの`MODERATION_NOTICE_STATUSES`と照合する。`onConflictDoUpdate({ targetWhere: sql\`${closedAt} is null\` })`で部分一意索引を指せることは`apps/db/content-reporting-schema.worker.test.ts`で確かめた。`status`が`resolved`のときの`resolution`の非nullはスキーマで検査しない(application層で守る)
- 1.6: 機能仕様は`docs/GUIDES/service/features/007-content-reporting.md`。設計に無い文言(一覧の説明・列と絞り込みの名前・詳細の題と見出し・経過時間の表記「3日4時間」「4時間」「1時間未満」(切り捨て)・照会の未送信・通報なし・照会の内容のエラー・同じ状態のエラー・3つのメールの本文)は文言規則(`design/003-text-and-copy-rules.md`)で決めたため、7・8のタスクは文言規則に従う。一覧のURLのクエリ名は`status`・`target`・`category`・`from`・`to`・`after`。カテゴリの削除の確認は共通の削除の題と説明「このカテゴリの通報<n>件は「その他」へ付け替えます。」に分ける。要件14.7(カテゴリの操作に任意の理由)に対し、上流の`CategoryMasterEditor`が`reason="none"`で理由の欄を持たないため、管理画面の操作では理由を記録しない(文書もコードに従う)。管理画面のメニューは16項目として文書に書いた(項目の追加は8.7)。specのrequirements.mdは申出者への通知をFR-ADMUG-030で引くが、要件定義書では031(通知)・032(宛先)に分かれているため、サービス文書は031・032・039で引く
- 3.1: `REPORTING_TYPES`(`apps/api/src/application/reporting/reporting-types.ts`)は19個の`Symbol.for('reporting.api.<名前>')`(共有部品の`reporting.<名前>`と分ける)。全ユースケースのインターフェースと入力・結果の型は`ports.ts`にまとめ、設計のインラインの型を名前付きに切り出した(4.xは`Default…`などのクラスで実装する)。設計に無いポート`ReportIncidentReporter`(`report(incident: 'notice-redispatch-failed' | 'inquiry-record-failed', context)`)を加えた。application層がエラートラッキングを読めないためで、ugc-moderationの`ModerationIncidentReporter`と同じ形。**実装`SentryReportIncidentReporter`(`infrastructure/reporting`、`captureEvent`)の作成と束縛は5.2で行う**。参加の値の読み取り(`readReportCaseClosingPayload`)はzodの厳密なオブジェクトで、監査ログの操作種別・対象の種類・対象の案件も検査する(監査ログの`detail.resolution`との一致は検査しない)。research.mdは参加者が種類・形の誤りで`AppError(internal)`を投げるとするが、design.mdと上流の参加者の契約は通常の`Error`で、3.5は上流に従う
- 1.5: 種別は`apps/backend-lib/core/email/kinds/content-reporting.ts`(`REPORT_OUTCOME_EMAIL`・`REPORT_REJECTION_TO_POSTER_EMAIL`・`REPORT_INFRINGEMENT_INQUIRY_EMAIL`)、テンプレートは`apps/event/src/infrastructure/email/templates/content-reporting/`で、文言は文言規則の「通報のメールの本文」に一字一句揃えた(`report-notice-copy.ts`)。テンプレートのテストは前例に合わせて`*.worker.test.tsx`。**入力の`targetLabel`は、コメントのときは対象のプロダクトの名称で、表示できない対象はnull(4.4の`ReportNotifier`と4.7の照会はこの前提で入力を組み立てる)**。抜粋は`targetLabel`がnullなら描かず、コメント以外で渡されても描くため、4.4はコメントのときだけ抜粋を渡す。照会のプレビューは冒頭の2文。改行を保つ部品とUTCの日時の部品はugc-moderationと同じ処理を本specのディレクトリに複製した(テンプレートのディレクトリ間で読み込まない慣例のため)
- 2.1: `REPORTING_PLATFORM_TYPES`(`reporting.<名前>`)は今は`ReportErasureStore`・`ReportErasureStatements`の2種で、2.2が`ReportExport`を加えるときに`core/reporting/identifiers.unit.test.ts`の期待値と束縛のテストの件数を改める。`REPORTING_PLATFORM_MODULE`はapi・eventの`composition/modules.ts`で`MODERATION_PLATFORM_MODULE`の直後。残りの有無(`remaining`)は件数でなく、前例の`D1ModerationRecordStore.eraseMatching`と同じく同じ一括の書き込みで条件の行を1件読み直して判定する(設計は「件数が上限に達したら」)。`eraseByReporter`は論理削除済みの通報も物理削除し、`eraseEmptyCases`は論理削除済みの通報が残る案件を残す(外部キー)。未ログインの通報の14日は`closed_at <= threshold`で、完了から戻した案件は`closed_at`がnull(制約)のため対象外。テストの補助は`workers/reporting/testing/report-erasure-fixtures.ts`
- 3.2: `D1ReportSubmissionStore`(`apps/api/src/infrastructure/reporting/d1-report-submission-store.ts`)は案件の`onConflictDoUpdate`(`last_reported_at`は`MAX`、`infringement_reported_at`は`COALESCE`、`updated_at`は`excluded`)と、`case_id`・`category_name`を副問い合わせで埋める通報の挿入の2文。カテゴリの同時の削除は`NOT NULL constraint failed: reports.category_name`を原因の連鎖で見分けて`'category-missing'`を返す(SQLiteはNOT NULLを外部キーより先に検査する)。古い時刻の通報が後で確定すると`updated_at`だけは戻り得る
- 3.3: `D1ReportCategoryStore`は名前の前後の空白もストアで除き(4.3のサービスも除くが二重でも害は無い。サービスは返す名前も除いた値にする)、標準カテゴリの保護と不在は監査ログの`guard`(`{ kind: 'condition' }`の`system_default = 0`)と`isAuditGuardRejection`で`not-found`にする(inquiry-chatの前例)。`list`は作成日時→IDの順で、フォームの並び(14.8)は4.3が`sortReportCategories`で行う。削除の付け替えは論理削除済みの通報も含め`updated_at`も更新する。付け替えた件数はポートが返さないため、4.3は先に`countReports`で数えて監査ログの詳細に入れる
- 3.4: `D1ReportCaseStore`の`search`は`(last_reported_at, id)`の降順でカーソルは`base64url('<ミリ秒>:<ID>')`(処理はファイル内の非公開の関数)。カテゴリと受付期間は同じ論理削除していない通報で満たす`EXISTS`で絞り、期間は開始を含み終了を含まない。カテゴリごとの件数は件数の降順→カテゴリのIDの昇順(設計に記載なし)。`lastReportedAt`は列の値で、最後の通報だけが論理削除された案件では表示する通報より新しい日時が出る。未対応は`status = 'open'`だけ、権利侵害は`infringement_reported_at IS NOT NULL`。`productSummary`は`target_kind = 'product' AND product_id = ?`で、プロダクトの対象では`productId`が対象のIDと同じ(4.1が入れる)。**内訳の`inArray`はページの件数だけバインド変数を使うため、4.8・5.4は1ページを50件以下に抑える**(`db/002`の上限100)
- 4.3: `DefaultReportCategoryService`。**設計のFile Structure Planに無い`apps/api/src/application/reporting/reporting-errors.ts`(`REPORTING_ERRORS`)を、既存のinquiry-chat・help-center・ugc-moderationの`application/<機能>/<機能>-errors.ts`の形に合わせて作った。4.2・4.5・4.6・4.7のユースケースが投げるコードと文言はここへ追記し、5.2のpresentationの`errors.ts`はここを読む(並行のタスクが同時に追記しないよう、親が順に割り当てる)**。`report_category_protected`は設計どおり`unprocessable`(422)で、inquiry・helpの`conflict`と違う。重複のエラーには`name`の欄の詳細を付ける。`rename`は成功の後に`countReports`をもう1回呼んで件数を返す
- 4.1: `DirectoryReportTargetResolver`(`apps/api/src/application/reporting/report-target-resolver.ts`)。**`describe`の結果の鍵は同じファイルからexportする`reportTargetKeyOf(key)`(`'<kind>:<targetId>'`、`targetId`がnullなら`'<kind>:'`)で作る(4.4・4.7・4.8はこの関数を使う)**。コメントの対象のプロダクトは鍵の`productId`から引く。抜粋は`truncateGraphemes(body, REPORT_LIST_EXCERPT_MAX)`(200書記素、省略記号なし、engagementの前例)。`describe`は停止中の利用者・非公開化のプロダクト・論理削除や非公開化や匿名化のコメントも`available: true`で返し(管理者の判断のため)、退会の利用者と削除のプロダクトは上流が返さないため`available: false`
- 2.2: `REPORTING_PLATFORM_TYPES.ReportExport`(`D1ReportExport`、`listPage({ userId, after?, limit })`)はdata-exportの設計の`ExportReport`と同じ項目と型。呼び出し側(data-exportの`CorrespondenceSourceReader`)はdata-exportのspecのタスクで配線する(data-exportは未着手)。不正なカーソルは`AppError(bad_request, 'invalid_cursor')`(`D1InquiryExport`の前例)、`limit`は呼び出し側が1〜20で渡す前提で検査しない。`createdAt`は`reports.reported_at`。停止中の利用者・非公開化のプロダクトもハンドルを返す。プラットフォームモジュールの束縛のテストは上流の`PROFILE_PLATFORM_MODULE`・`PRODUCT_PLATFORM_MODULE`を含むコンテナで組む
- 6: eventの識別子は`EVENT_REPORTING_TYPES`(`reporting.event.<名前>`、`UserReportErasureHandler`・`ProductReportErasureHandler`)、モジュールは`EVENT_REPORTING_MODULE`(`apps/event/src/composition/reporting-module.ts`)。利用者は`eraseByReporter`→`detachCasesByOwner`→`eraseEmptyCases`を毎回すべて行い、どれかに残りがあれば(空の案件は件数が上限の500以上で)`continue`(`backend/007`の件数で切る削除)。時刻は`PLATFORM_TYPES.Clock`。上流のテストの期待値の変更: 利用者の登録口の「sponsorshipは…措置の記録の削除を除く全てのドメインの物理削除の処理の後に並ぶ」を`slice(-3)` = [sponsorship, content-reporting, ugc-moderation]にしテスト名に「通報の削除と」を加えた、directoryの`.slice(-6)`を`-7`に、他の7つのモジュールの`purge_due`の一覧に1800を挿入
- 3.5: `D1ReportCaseStatements`・`D1ReportCaseWriter`・`ReportCaseClosingParticipant`・`D1ReportNoticeStore`(`apps/api/src/infrastructure/reporting/`)。違反の見分けは`VIOLATION_PATTERNS`(原因の連鎖の文言、`status`と`status_changed_at`を取り違えない)。参加者は種類・形の誤りで通常の`Error`(上流の契約。research.mdの`AppError(internal)`とは違う)。**依頼待ちの通知の一覧(`listPendingOutcome`・`listCasesWithPendingNotices`)は論理削除済みの通報も返す**(退会の論理削除は`outcome_notice_status`を変えないため、除くと永久に依頼待ちに残る。4.4の通知は連絡先が引けなければ`skipped`にする)。完了の文は論理削除済みの通報を対象にしない。`markOutcome`は`json_each`で1つのバインド変数に渡す。`*_requested_at`は`requested`のときだけ入れ`skipped`でnull。テストは800行の制限で3ファイルに分け、本タスク専用の補助`testing/report-case-write-fixtures.ts`を置いた
- 4.7: `DefaultInfringementInquiryService`。完了した案件への照会は、design.mdのError Handlingの表(1615行付近)と文言規則に合わせて`report_case_closed`(design.mdの`InfringementInquiryService`の手順(1014行付近)は「`in_progress`でなければ`report_inquiry_not_applicable`」で、設計の中で食い違う)、未対応は`report_inquiry_not_applicable`。**利用者側のURLを示せない対象(表示できない・ハンドルが無い・コメントのプロダクトを表示できない)も`report_inquiry_not_applicable`(設計・文言規則に無い条件。4.8の`inquiryAvailable`も同じ条件にする)**。URLはugc-moderationの通知に倣いファイル内の`/contact`・`/@`・`/p/`と`PLATFORM_TYPES.Env`の`CLIENT_SITE_ORIGIN`で組み立てる。`EmailSendError`はそのまま投げ(`external/001`)、他の送信の失敗だけ`report_inquiry_send_failed`。`reporting-errors.ts`に`report_case_not_found`・`report_case_state_conflict`・`report_case_closed`と検証の誤りの補助`reportAdminReasonRejectedError`(`reason`)・`inquiryMessageRejectedError`(`message`)を足した(4.5・4.6はこれを使う)。同じコミットに4.2の`reporting-errors.ts`の追記(`report_target_not_found`・`report_own_content`・`reportFieldError`など)も含む
- 4.2: `DefaultReportSubmissionService`と`CounterReportSubmissionRateLimit`(`infrastructure/reporting/counter-report-submission-rate-limit.ts`、キーの用途`'report-user'`→`'report'`の順、IPが不明なら数えず`report-ip-missing`を警告)。**5.3のリゾルバの連絡先の要否の検証は`reporting-errors.ts`の`reportContactEmailRequiredError()`(詳細の`code`は`required`)を使い、詳細の形をユースケースと揃える**。カテゴリの不在は`categoryId`の`not-found`(inquiry-chatの前例)。`rate_limited`は共通の`assertWithinLimit`のもの。ログの区分は`api.reporting.submission`で、`targetRef`(ユーザーではハンドル)を出さない。回数制限で拒否した通報はユースケースのログに結果を残さない(設計の「結果をログに出す」に対し任意の改善の余地)。IPの規則で拒否されたとき既に数えた利用者の数は戻さない(設計が許容)
- 4.8: `DefaultReportCaseReader`。監査ログ(`latestForMany`・`latestFor`)は完了した権利侵害の案件だけ引く(完了の日時は対応期間にしか使わない)。詳細の`closedAt`は案件の`closed_at`、対応期間の完了の時刻は監査ログ。不在の案件は`undefined`を返し、5.4の`adminReportCase`はnullを返す(SDLのnull可の型どおり。操作は不在で`report_case_not_found`)。**照会できるかは新しい共通の関数`inquiryTargetPathOf(kind, view)`(`application/reporting/inquiry-target.ts`、利用者側のパスを返し示せなければ`undefined`)で4.7の送信側と同じ条件にし、4.7の`targetInputOf`もこれを使うよう書き換えた**(design.mdの920行付近の`inquiryAvailable`の注記はURLを示せる条件を書いていない)。4.1の`UNAVAILABLE_VIEW`を`UNAVAILABLE_TARGET_VIEW`としてexportした。1ページは`Math.min(first, REPORT_LIST_PAGE_SIZE)`で抑える(`first`の検証は5.4)。申出者が引けなければ`member`でニックネームとハンドルがnull
- 4.4: `EmailReportNotifier`(`dispatch(caseId)`、環境の型`ReportNotifierEnv { CLIENT_SITE_ORIGIN }`)。コメントの抜粋は文言規則に従い99書記素に「…」を付けて合計100書記素(ugc-moderationの`moderation-notifier.ts`と同じ形)。**匿名化のコメントは、`ReportTargetView`に匿名化の印が無いため、4.1の`describe`が匿名化のコメントの抜粋を`''`で返すこと(上流は匿名化で本文を空にし、匿名化していないコメントの本文は空にならない)で判定して投稿者を`skipped`にする**。将来は`ReportTargetView`に`anonymized`を足すのが堅い。返す件数は宛先のまとまりごと(連絡先の無い未ログインの通報だけ通報ごと)。**全ての通報が論理削除された案件は`ReportCaseStore.find`が返さず`dispatch`が何もしないため、申出者の通知が`pending`のまま残り、`listCasesWithPendingNotices`(完了の日時の昇順)の先頭の枠を物理削除まで取り続ける。5.1で扱う**
- 3.6: `REPORTING_MODULE`(`apps/api/src/composition/reporting-module.ts`、Transient、`MODULES`で`MODERATION_MODULE`の直後)に7つのストア類と`ReporterWithdrawalSyncHandler`を束縛した。**5.2は同じ`ContainerModule`にユースケース・照会・通知・ジョブ・回数制限・`SentryReportIncidentReporter`を追記し、`REPORTING_TYPES`の全識別子が束縛されていることの検査を足す**。同期の処理は`USER_LIFECYCLE_SYNC_HANDLERS`の末尾(`content-reporting.reporter-withdrawal`、`withdrawn`)で、前例どおり自分でも`event.type`を確かめる(代理の退会は措置の参加を持たないため、一覧の中の順に意味は無い)。`MODERATION_WRITE_PARTICIPANTS`に`content-reporting.report-case-closing`を追記し、上流の「初版は参加者を登録しない」のテストを「通報の案件の完了の参加者だけを登録する」に改めた(`USER_LIFECYCLE_SYNC_HANDLERS`の一覧全体を固定する上流のテストは無かった)。`project-values.md`の同期の処理の件数(975行付近の「12件」)と参加者の登録(1438行付近の「現在は登録0件」)は9.1で直す
- 4.5: `DefaultReportCaseWorkflow`(`report-case-workflow.ts`)は今は`implements Pick<ReportCaseWorkflow, 'changeStatus' | 'resolveWithoutMeasure' | 'reject'>`。**4.6は`implements ReportCaseWorkflow`に戻し、コンストラクタに措置のユースケースを加え、テストの偽物のハーネス`testing/report-case-workflow-harness.ts`の`setupWorkflow`も直す。`#findOpen`・`#prepare`・`closingAuditOf(closing, mode, fromStatus)`・`#notify`を使い回す**。操作(措置なしの対応済・却下)の監査ログにも`fromStatus`を入れる(設計の`ReportCaseWorkflow`の節は`mode`だけ書くが、操作種別の`detailKeys`と要件8.5に合わせた。4.6の措置も揃える)。同じ状態への変更は`status`の`unchanged`(`reportStatusUnchangedError()`、inquiry-chatの前例)。却下の投稿者への通知は`targetOwnerUserId === null`(参照の消去だけがnullにする)で`skipped`
- 4.6: `DefaultReportCaseWorkflow.resolveWithMeasure`(`implements ReportCaseWorkflow`、コンストラクタにugc-moderationの3つの措置のユースケース)。変化なし(措置済み)は`report_measure_already_applied`、状態が変わったのに措置の記録のIDが無い(`{ changed: true, actionId: null }`)は通常の`Error`で通知しない(design.mdの994行付近に従う。416行付近は掛かり方が曖昧)、上流の`product_not_found`・`comment_not_found`・`user_not_found`は`report_target_unavailable`、他の失敗は案件を読み直して`report_case_not_found`・`report_case_state_conflict`・上流のエラーに分ける(読み直しの失敗は警告のログで上流のエラー)。research.mdの105行付近の`linkResolutionAction`の決定は「開発者の決定: 参加者の登録口」(308行付近)で置き換わっている。Workers統合テスト`apps/api/src/composition/reporting-module.measure.worker.test.ts`は本物の3つの措置と登録した参加者を通し、通知だけ偽物。**このテストのコメントの「束縛は5.2で行うため」は5.2の束縛の後に古くなるので5.2で直す**
- 5.1: ジョブは`apps/api/src/application/reporting/jobs/`(`REPORT_NOTICE_REDISPATCH_JOB_DEFINITION`・`REPORT_RETENTION_JOB_DEFINITION`、閾値は`scheduledTime`から)。送り直しは各案件を`dispatch`するだけで、失敗の件数を`notice-redispatch-failed`で1回通知する。**4.4の申し送りの行き詰まった案件は、通知用の読み取り`ReportNoticeCaseReader.findForNotice`(新しいポートと識別子`REPORTING_TYPES.ReportNoticeCaseReader`、`D1ReportCaseStore`が実装し`reporting-module.ts`で束縛。表示する通報の有無で絞らない)で`EmailReportNotifier`が案件を読むことで解消した(退会した申出者は`skipped`、却下の投稿者には送る)。`REPORTING_TYPES`は20個になった**(3.1の「識別子のファイルを変えない」の前提の例外。design.mdの`ReportCaseStore`と`ReportNotifier`の節にも追記した)。3年の暦の計算はジョブのファイル内(他の3つのジョブにも同じ処理の写し)。保持期間の段が失敗すると後の段は動かない(前例どおり)
- 9.1: `backend/022`・`security/011`・`frontend/021`を作り、CLAUDE.mdの「技術規則の参照先」に3行とも加えた(各READMEの範囲・`tech/README.md`とルートの`README.md`の表・CLAUDE.mdのディレクトリ構成にも)。`frontend/020`と`security/008`に参照の1文を足した。`project-values.md`は「## 通報」の節を新設し、同期の処理(13件)・参加者(1件)・利用者とプロダクトの非同期の処理(1800)の行を直した。**`frontend/021`はプロダクトのページの通報の操作を`button`要素とした(design.mdは「控えめなリンク」。見た目の意味で、`frontend/004`の「押して処理を行うものは`<button>`」に従う)。7.3はこれに従う**。上流のずれ: ugc-moderationの`ModerationDialogHost`は対象の不在の失敗で起点のボタンが残っていても一覧の見出しへフォーカスを移す(`frontend/020`と違う)。8.2の`ReportCaseDialogHost`は`frontend/020`・設計どおり起点が残ればそこへ戻す。管理画面と利用者側の登録の一覧の行(`ADMIN_PRODUCT_DETAIL_SECTIONS`の「現在は登録0件」など)は7.3・8.5〜8.7で直す
- 5.2: `REPORTING_MODULE`に20個全部を束縛し(`IMPLEMENTATIONS`と`REPORTING_TYPES`のキーの一致を検査)、`SentryReportIncidentReporter`(指紋`['reporting', <理由>]`、タグ`report_incident`・`job`、件数と案件のIDは文脈)を作った。ジョブは`SCHEDULED_JOBS`の`MODERATION_MAINTENANCE_JOB_DEFINITION`の直後、スキーマモジュール`reporting`は`GRAPHQL_SCHEMA_MODULES`の末尾。SDLは全量を登録済みで、**リゾルバは`presentation/graphql/modules/reporting/`の4ファイルに分けた: 5.3は`submission-resolvers.ts`、5.4は`case-resolvers.ts`、5.5は`category-resolvers.ts`と`summary-resolvers.ts`。`index.ts`が`Query`・`Mutation`を展開するので共有のファイルへの追記は要らないが、型の項目のリゾルバ(例: `AdminReportCase`)は同じキーを2ファイルで定義すると黙って上書きされるため1ファイルだけが持つ**。設計に無い追加: `enums.ts`(GraphQLの列挙型とユースケースの値の写し)、`errors.ts`の`reportContactEmailFormatError()`(`contactEmail`の`invalid-format`、5.3が`withInputPath`で使う)、`resolver-support.ts`の`clockOf`、`AdminReportCaseConnection`の型(`nodes`・`pageInfo`)、`REPORT_TARGET_REF_MAX_LENGTH`(100)。連絡先の254文字は要らない通報でも検査する。IDの形式の誤りは「見つからない」と同じ文言。期間の逆順はUGC管理と同じ文言を`filter.reportedBefore`に。上流のテストの期待値: `ugc-moderation-scheduled-jobs.unit.test.ts`の1910の次を2000に、`search-module*.worker.test.ts`の4:21の一覧に2つを追加
- 5.3: `submitReport`は`clientOnly`→`withValidatedArgs`→`clockOf(context).now()`を1回→`accountGuardOf(context).currentUser`(`active`はmember、他はguest)→`withInputPath('input', …)`の中で連絡先の要否と形式(`z.regexes.html5Email`、`auth-inputs.ts`と同じ判定)→`assertHuman('report')`→ユースケース。bot判定の操作名は`REPORT_BOT_ACTION = 'report'`(`submission-resolvers.ts`からexport)。`reportCategories`は呼び出し元を確かめない(利用者側への限定は許可リスト)。テストのセッションは`test/support/profile-graphql-operations.ts`の`issueUserSession`
- 5.5: 型の項目のリゾルバは書かず(codegenの写像の指定が無く、ユースケースの値がGraphQLの型にそのまま合う)、`AdminProductReportSummary.openCase`(`AdminOpenReportCaseRef`、5.4の`AdminReportCase`とは別の型)はルートのリゾルバで組む。`summary-resolvers.ts`は`index.ts`が展開するため空の`Mutation: {}`を持つ。カテゴリの操作はGraphQLの`reason`をそのまま渡す(画面の`CategoryMasterEditor`は送らない)。テストの補助`codesOf`・`detailsOf`は`test/support/payments-graphql-operations.ts`から
- 9.2: 補助は`e2e/support/report-fixture-sql.ts`(純粋な関数、本物のマイグレーションのSQLiteで単体テスト)と`report-fixtures.ts`(`createReport`・`readReportCaseState`、`executeLocalD1`)。挿入は本物の`D1ReportSubmissionStore`と同じ2文。対象はプロダクトとユーザーはハンドル、コメントはID、カテゴリは名前(大文字小文字を区別しない)、ログイン中の通報者は登録メールアドレス(有効な利用者だけ)。本番の受け付けが拒否・破棄する入力(未ログインの権利侵害で連絡先なし、権利侵害以外の未ログインの連絡先、本人のコンテンツ、理由の誤り)は投げる。対象の可視性は検査しない。D1へ直接書くため`assumeDistinctClientIp`・`waitForBotToken`は使わない(9.3・9.4の画面からの送信で直接使う)。**補助を呼ぶ空のE2Eは確認のために一時的に作って`--no-deps`(サーバーもシークレットも不要)で成功させ、リポジトリには残していない(9.5が実際のシナリオで`createReport`を呼ぶ)**
- 7.1: 操作は`ClientReportCategories`・`ClientSubmitReport`(`apps/client/src/graphql/operations/reporting/`)。`apps/client/src/graphql/reporting.ts`に`reportCategoriesQueryOptions`(キーは`[documentId, {}]`で閲覧者を含めない。応答が閲覧者によらないため)・`submitReportMutationOptions`と、部品が生成物の型を直接使わないための`ReportCategoryOption`・`toReportCategoryOptions`・`ReportSubmission`・`toSubmitReportVariables`(小文字の対象の種類をGraphQLの大文字の列挙へ写し、`contactEmail`が無ければ入力に含めない)。**7.2は`useMutation(submitReportMutationOptions())`と`sendWithTurnstile(turnstile, (turnstileToken) => mutation.mutateAsync({ variables: toSubmitReportVariables(...), turnstileToken }))`の形で送る**
- 5.4: `case-resolvers.ts`は型の項目のリゾルバを書かず、ルートのリゾルバで値を写す(`toAdminReportCase`・`toAdminReportCaseDetail`、ugc-moderationの`content-views.ts`と同じ)。**`adminReportCase`は不在でnull(8.4は`ReportCaseNotFoundPage`を出す)**。`AdminReporter.hasContact`はログイン中では常にfalse、`elapsedSeconds`は`Math.floor(elapsedMs / 1000)`。テストは2ファイルと本タスク専用の補助`apps/api/test/support/reporting-case-graphql-operations.ts`(読んだ後の物理削除は`ReportCaseStore`を包み直して最初の`find`の直後に消す)
- 8.1: 照会5件・変更8件(`apps/admin/src/graphql/operations/reporting/`、一覧と詳細の共通の項目はフラグメント`AdminReportCaseSummary`)。**8.2の`UseReportCaseMutation`は`admin-reporting-cases.ts`の`changeReportCaseStatusMutationOptions()`・`reportCaseClosingMutationOptions('resolve-with-measure' | 'resolve-without-measure' | 'reject')`・`sendInfringementInquiryMutationOptions()`(入力は`caseId`と小文字の値)を使う。カテゴリの操作は部品から`graphqlMutationOptions(Document)`で呼ぶ(`reason`の変数は持たない)**。無効化は`invalidateReportCaseQueries`(一覧と詳細)・`invalidateReportSummaryQueries`(未対応の件数と全てのプロダクトの件数)・`invalidateReportCategoryQueries`(カテゴリ・一覧の絞り込みの選択肢・案件・監査ログ)。一覧の`loadReportCasesPage`は失敗をキャッシュに残し`stay`では待たず、絞り込みのカテゴリの選択肢も取得する。詳細の`loadReportCasePage`は不在とIDの形式の誤りで`notFound()`、他は投げ直す(`frontend/020`の70行付近と前例。設計の「ルートとページ」とタスクの本文はloaderの規定を一覧と詳細で分けていない)。ページの型はugc-moderationの`admin-moderation-shared.ts`を再利用
- 7.2: 部品は`apps/client/src/components/reporting/`(`ReportDialog`・`ReportForm`・`useSubmitReport`・`report-form-schema.ts`の2つのスキーマ`REPORT_FORM_SCHEMA`・`REPORT_FORM_WITH_CONTACT_SCHEMA`・`report-messages.ts`・テストの補助`report-dialog-testing.tsx`)。**7.3の登録口は`ReportDialog`に対象の種類と参照と`returnFocusRef`(`RefObject<HTMLElement | null>`)を渡す**。停止中は`useViewer()`の`status !== 'ACTIVE'`でguest。設計との相違: カテゴリの取得の失敗は文言規則の固定の文言(設計は`errorMessageOf`)、カテゴリの欄は前例の`FormField`のラベルと`RadioGroup`(設計は`fieldset`・`legend`)、読み込み中は`LoadingSkeleton`(既定の「読み込み中」)。描かれていない欄へのサーバーの詳細はフォームの上部に`errorMessageOf`の文言。理由の文字数の表示は共通部品の`MarkdownLengthCounter`(編集領域の遅延読み込みに影響しないことを`check:editor-chunks`で確かめた)。bot判定の操作名の写し`REPORT_BOT_ACTION`(`bot-actions.ts`)は`config/content-reporting-contract-copies.unit.test.ts`で照合する
- 8.6: `ReportCategorySection`(`apps/admin/src/components/reporting/categories/`、`CATEGORY_SECTIONS`のid `content-reporting.report-categories`・order 40)。閲覧のみには`readOnlyDisplay="hidden"`で一覧だけ(`002-page-layouts.md`の規則。help-centerと同じ。inquiryは無効のボタンを残す)。**標準カテゴリにも「編集」の操作が出る(共通の`CategoryMasterEditor`はシステム標準の行にも「編集」を描きAPIの拒否に任せる(`frontend/005`)。タスクの本文と`002-page-layouts.md`の「名前の変更と削除の操作が無い」と食い違う。削除は描かれず、名前の変更はAPIの文言をダイアログに出す)**。付け替える件数が0のときは共通の既定の説明
- 7.3: 登録は`COMMENT_ACTIONS`の`content-reporting.comment-report`(10)・`PRODUCT_PAGE_SECTIONS`の`content-reporting.product-report`(`bottom`・10)・`PUBLIC_PROFILE_MENU_ITEMS`の`content-reporting.user-report`(10)。参照はプロダクトとコメントはID、ユーザーはハンドル。本人に出さない判定はプロダクトとプロフィールは部品自身(`isOwner`)、コメントは上流の`CommentMenu`(本人のコメントに登録の操作を描かない)。プロダクトの操作は`button`要素(design.mdと`002-page-layouts.md`は「控えめなリンク」)。上流のテストの期待値: `comment-menu.browser.test.tsx`(既定の登録口に「通報」)・`profile-card.browser.test.tsx`(既定の項目と`menuItems: []`の2つに分けた)・`comment-actions`・`public-profile-sections`・`product-page-sections`の各`.browser.test.ts`。clientの`test:browser`の全件は負荷で無関係のファイルが落ちることがあり、単独では成功する
- 8.2: 共通部品は`apps/admin/src/components/reporting/shared/`(`frontend/021`とugc-moderationの前例。design.mdのFile Structure Planは`components/reporting/`の直下)。検索条件は`report-search.ts`(URLの`status`・`target`は大文字の列挙の値、`category`は大文字のULID、カーソルの上限256)、読み込みは`load-reports-page.ts`。ページの部品`components/pages/reports-page.tsx`・`report-case-page.tsx`は最小の枠で、8.3・8.4が中身を作る(詳細の`notFoundComponent`も8.4)。ugc-moderationの`use-moderation-mutation.ts`から`invalidateModerationAffectedQueries`を切り出した(振る舞いは同じ)。失敗と取り消しの後のフォーカスは起点が`isConnected`ならそこ、無ければ見出し、確定の後は常に見出し(ugc-moderationの`ModerationDialogHost`とは意図的に違う)。**表示できない対象・参照を消した案件には措置の操作を出さず、措置なしの対応済と却下だけを出す(設計に記載なし。要件9.7と矛盾しない)**。措置済みの後はダイアログ内の「措置なしで対応済にする」で切り替え、理由は入れ直す。**コメントの措置の確認の題は、APIがコメントの投稿者のニックネームを返さないため、文言規則の「<ニックネーム>さんのコメントを非公開にしますか?」でなくugc-moderationの「コメントを非公開にしますか?」(文言規則とAPIの食い違い)**。経過時間で端数の時間が0のときは「1日0時間」(文言規則に定めなし)。`routeTree.gen.ts`は素の生成器が落とすTanStack Startの末尾のブロックを手で戻した(Startのプラグインの出力と一致することを確かめた)。`test/reporting-fixtures.ts`を読むブラウザテストは`vi.mock`でexecute-graphqlを置き換える。**8.4への申し送り: `deferRefresh`の詳細のページでは閉じた時点で起点のボタンが残りそこへフォーカスが戻るが、その後の取り直しで案件が完了になると`ReportCaseActions`がボタンを消してフォーカスが`<body>`へ落ちる。8.4のブラウザテストで確かめ、遅らせた取り直す失敗の後は見出し(`fallbackFocusRef`)へ戻すなどで対処する**
- 9.3: `e2e/client/report-submission.e2e.test.ts`・`report-steps.ts`(`openProductReportForm`・`openProfileReportForm`・`openCommentReportForm`・`submitReportForm`・`expectContactEmailRequired`・`expectNo*ReportAction`・`findOpenReportCaseId`)。必須の連絡先は、送信ボタンが無効で欄が`aria-required="true"`であることで確かめる(誤りの文言はexportされていない)。通報の受け付けの通知の待ちだけ`RETRY_TIMEOUT_MS`(20秒、bot判定・回数制限・集約を順に行うため)。**9.4は利用者側の画面から未ログインで通報を送るのに`report-steps.ts`の`openProductReportForm`・`submitReportForm`を使える。案件を対象から引く`findOpenReportCaseId`は単体テストの無いSQLを持つため、9.4・9.5でも使うなら`e2e/support/report-fixtures.ts`へ移して`report-fixture-sql.ts`の`targetSql`を使い回し、単体テストを付ける**
- 8.3: 一覧の部品は`apps/admin/src/components/reporting/list/`(`report-case-table.tsx`・`report-case-filters.tsx`・`report-list-messages.ts`)、テストの補助`test/reporting-reports-page.tsx`。共通の`ReportTargetCell`に省略できる`detailCaseId`(渡すと詳細へのリンク)を足した。**期間の入力の誤りは、ugc-moderationのコメントの絞り込みに合わせ「適用」で`checkAuditPeriodInput`により欄の誤りとして示して反映しない(URLの逆の期間は8.2どおり両方を未指定)。`design/002-page-layouts.md`の1608行目と文言規則(範囲外の日付・逆順の2行)を実装に合わせた**。件数の欄の`aria-live`は置かない(総件数が無く前例も無い)。URLのカテゴリが選択肢に無い有効なIDなら選択欄は空の表示(テストなし)
- 8.5: カードは`components/reporting/dashboard/`の`UnhandledReportsCard`(`DASHBOARD_CARDS`の`content-reporting.unhandled-reports`、30、半幅)、区画は`components/reporting/product-detail/`の`ProductReportsSection`(`ADMIN_PRODUCT_DETAIL_SECTIONS`の`content-reporting.product-reports`、10、題「受け付けた通報」)。**範囲外の重複の解消として、inquiry-chatのカードとugc-moderationの週の統計のカードの同じ`cardStateOf`を`components/dashboard/dashboard-card-state.ts`の`dashboardCardStateOf`へ移し、3つのカードで使う(振る舞いは同じ。`frontend/009`の表とコードの例も更新)**。件数は通報の画面の共通の`reportCountLabel`(`ja-JP`固定、管理画面の前例どおり。inquiryのカードの`NumberText`は閲覧者のロケール)。テストの補助は`test/reporting-summary-fixtures.ts`の`respondReportSummaries`(上流のダッシュボードのテストもこれで応答する)
- 8.4: 詳細の部品は`apps/admin/src/components/reporting/case/`、テストの補助`test/report-case-page-fixtures.ts`。**8.2の申し送りは、共通部品`ReportCaseActionDialog`に`onRefreshDeferred`、`ReportCaseDialogHost`に`refreshDeferredRef`を足し、遅らせた取り直しの失敗の後は起点が残っていても`fallbackFocusRef`(詳細では操作の区画の見出し)へ移して対処した(一覧は`deferRefresh`を使わず不変)**。状態の変更と照会のダイアログも`shared/use-deferred-report-case-refresh.ts`で取り直しを閉じるまで遅らせる(設計で明示なし、`frontend/021`に合わせた。後片付けで`ReportCaseActionDialog`もこのフックを使うよう寄せた)。不在の表示は設計の`NotFoundView`でなく`ReportCaseNotFoundPage`(文言規則の「通報の案件が見つかりません。」と「通報の一覧へ」を出すため。ugc-moderationの`ProductNotFoundPage`と同じ形)。状態の選択欄の既定値は現在と異なる3つの最初。却下は完了の種類を「却下」、対応済で措置がnullなら「措置なし」。通報0件の詳細は一覧の0件の文言を流用。導線は`target.available`が真で必要なハンドル・IDがある時だけ。照会の操作は`inquiryAvailable`に加えて画面でも対応中を確かめる
- 8.7: `ADMIN_NAV_ITEMS`に`{ to: '/reports', label: '通報', order: 70 }`(「画像モデレーション」と「問い合わせ」の間、16項目)。上流の`admin-nav-order.unit.test.ts`・`admin-navigation.browser.test.tsx`・`test/admin-shell.browser.test.tsx`の期待値を改め、`/reports`・クエリ付きの一覧・`/reports/$caseId`で通報が現在のページになることを確かめた。管理者側の全テスト(単体744件・ブラウザ1,360件)が成功
- 9.5: `e2e/admin/report-rejection.e2e.test.ts`・`report-categories.e2e.test.ts`と共通の手順`e2e/admin/report-case-steps.ts`(`openReportCaseDetail`・`expectReportCaseStatus`・`expectReportCaseBreakdown`・`rejectCommentReportCase`・`changeReportCaseStatus`・`expectNoClosingRecord`・`expectRejectionNotice`)。申出者は`moderation-fixtures`の評価者(ログイン中)を`createReport`で使う。「メールが増えない」は却下のメールが届いてから`administrative-withdrawal-steps.ts`の`expectNoEmailSince`で20秒待つ。**管理画面の文言の一部をE2Eに写した(`report-messages.ts`が`.tsx`の部品へつながる型の読み込みを持ち、ルートの型検査がTS6142で失敗するため。前例どおり)**。9.3の申し送りどおり`findOpenReportCaseId`を`e2e/support/report-fixtures.ts`へ移し(`report-fixture-sql.ts`の`openReportCaseIdSql`が`targetSql`を使う)、単体テストを付けた。開発コンテナに`ss`が無いため、ポートの確認は`curl`で行う
- 9.4: `e2e/admin/report-handling.e2e.test.ts`。9.5の`report-case-steps.ts`に手順を足し(`changeReportCaseStatus`は内部の`submitStatusChange`へ一般化、未対応→対応中は理由が任意の欄なので`startReportCaseProgress`)、範囲外の最小の変更として`e2e/support/directory-fixtures.ts`の`ListedProducts`に`ownerEmail`を、`e2e/admin/user-moderation-steps.ts`の`moderationAuditLogRows`の中身を`auditLogRowsOf`として切り出した(振る舞いは同じ)。件数の確かめ方: ダッシュボードのカードは未対応だけを数えるので、通報の後に増え対応中で減ることを確かめる。プロダクトの詳細の区画は累計なので対応済の後も1件で、未完了の案件の行が消えることを確かめる。**カードの件数の比較は利用者側の`report-submission.e2e.test.ts`(未対応の権利侵害の案件を作る)と同時に流れると時間切れになり得るため、`playwright.config.ts`の`SERIAL_GROUPS`に`report-counts`の組を加えて順に流す**
- 9.6: 全体の検査は開発コンテナのメモリの上限でapiの静的解析・clientのブラウザテスト・apiのWorkers統合テストの一括の実行が落ちることがあり、単独の再実行か`--shard`と`--reporter=blob`の分割の後の`--mergeReports --coverage`で通した(失敗はいずれも本spec外のファイル)。apiの`inputs`・`errors`・`resolver-support`の単体テストは、`auth-inputs.ts`の単体テストのカバレッジの不足を避けるためugc-moderationの前例に従いWorkers統合テストへ移した。ルートの単体テストが読み込む共用部品の関数は全て呼ぶ(testing/001)。作業の報告はresearch.mdの「実装の記録(2026-11-22)」
