# Implementation Plan

- [x] 1. 基盤: 共有の定義・テーブル・サービス仕様
- [x] 1.1 通知種別・送信者情報の規則・監査ログの操作種別と、7テーブルを定義し、マイグレーションを作る
  - 前提: dev-tooling〜match-engineの18specの全タスクが完了していること(email-deliveryの送信の受付・抑止リスト・テンプレート基盤・送信者情報の取得口、match-engineの`MatchDirectory`と0:00・23:45のジョブ、identity-authの`UserContactDirectory`・`verifiedUsers()`・ライフサイクルの登録口・設定ページのシェル、frontend-libの`useFragmentToken`、user-profile-socialの`FollowerDirectory`、product-launchの`ProductDirectory`、admin-foundationの認可と監査ログとE2Eの補助、ultras-subscriptionの`ADMIN_SETTINGS_SECTIONS`、paymentsが加えたeventの`CLIENT_SITE_ORIGIN`、infra-deliveryの改訂1の「ホスト名から導かれる変数の値」の表のeventの`EVENT_SITE_ORIGIN`の行)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、単体テストで、通知種別の4つの値と順、送信者情報の長さの判定(200書記素と201書記素・空白だけの値)、監査ログの操作種別の検証(操作種別の集約点に例外なく加わること)、テーブルの定義のCHECK(通知種別・送信枠の種類と段・通知の状態と送らない理由・通知イベントの種類と状態・版が0以上で、版0なら送信者情報の3項目がNULL・版1以上ならNOT NULL)・一意索引(受信設定とトークンの種は利用者と種別で1つ・照合用のハッシュ・通知と通知イベントの重複のキー・送信枠のキー・送信枠と前提の機能の組・設定のキー)、送信枠の送り出しの前提の一覧と依頼の時刻の列・外部キー(`users`だけで`ON DELETE`の指定なし、マッチ・プロダクト・通知イベントへは無し)を確かめる
  - 作業量が3時間の上限に近いため、テーブルとマイグレーションを先に終え、共有の定数と監査ログの操作種別を最後に足す
  - 通知種別と送信者情報の規則は4アプリが読み込める共有ディレクトリに置き、スキーマの集約点へ加え、mainの最新を取り込んでからマイグレーションを生成する
  - 生成したマイグレーションとは別に、送信者情報の1行(固定のID・設定のキー`'sender-info'`・3項目NULL・版0)を設定のキーの重複を無視して入れるカスタムのマイグレーション`<日時>_notifications_seed`を作る。IDの時刻部と作成日時を一致させ、単体テストで挿入の文と値を確かめる(前例`20261106115514_ultras_subscription_seed`)
  - 送信者情報の規則は`<機能>-input-rules.ts`の規約(`coding/005`)どおり`sender-info-input-rules.ts`に置き、上限を`SENDER_INFO_MAX_GRAPHEMES`、違反の種類を`'empty' | 'too-long'`にする。準備の完了の表は複数形の`notification_slot_ready_marks`とし、追加だけで更新しないため共通カラムは`created_at`だけにする
  - CHECKと一意索引の単体テストは`apps/db/schema/notifications/notifications-migration.unit.test.ts`、ローカルD1の制約と外部キーのWorkers統合テストは`apps/db/notifications-schema.worker.test.ts`に置く(前例はmatch-engineの同名のテスト)
  - 既存のテストの更新と、DBの値と共有の定数の照合のテストは1.3で行う
  - 完了状態: 本タスクで加えたテストが成功し、2つのマイグレーションをローカルに適用でき、送信者情報の版0の行が1行だけあり、client・admin・api・eventの型検査で通知種別の定数を読み込める。操作種別の一覧を完全一致で確かめる既存の2つのテストは、1.3で更新するまで失敗する
  - _Requirements: 1.1, 1.2, 7.12, 10.1, 10.2, 11.2, 11.4, 11.6_

- [x] 1.2 (P) 文言規則・ページ配置・準拠方針に、本specの決定と画面と文言を先に書く
  - 文言規則: 設計のSupporting Referencesの「通知メールの文」(敗北・両者敗北・不戦勝・不戦勝の統合の件名と本文の要点)と「画面の文言」、送信者情報の項目の検証の文言を加える。「認証系メールの本文」の構成を、宛名・本文・ボタンの後に送信者情報が続く形に改める(送信者情報は全種別のメールの末尾に載るため)
  - ページ配置: 配信停止のURLを`/unsubscribe#token={token}`へ改め、ヘッダーのURIはイベントサーバーの`/unsubscribe?token={token}`である旨を仮5(2026-10-24に開発者が確定)として注記する。通知設定ページ(4種別のスイッチ・抑止と未確認と停止中の案内)・配信停止ページ(確認・完了・既に停止・無効)・管理画面の設定ページの送信者情報の区画(30)の配置を記載する
  - 準拠方針: 通知メールのオプトアウトの節に、3つの撤回の手段(設定ページ・ワンクリック・リンク)、トークンが利用者と種別ごとに退会まで有効である旨、送信者情報が未設定の間は送らない旨(仮3)を加え、データ保持期間の一覧に受信設定・トークンの種(退会まで)・通知の記録(30日)・送信者情報の行を加える
  - プライバシーポリシーの大枠: 法的根拠の行の通知メールの送信を「正当な利益」から「同意(通知設定で種類ごとに選び、いつでも撤回できる)」へ移し、収集する情報の一覧に受信設定と配信停止のトークンの種・照合用のハッシュを記す
  - 完了状態: 4つの文書が整形の検査を通り、5.2・5.3・6.1〜6.3・7.1のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service/design/003-text-and-copy-rules.md`・`002-page-layouts.md`・`docs/GUIDES/service/legal/001-compliance-policy.md`・`003-privacy-policy-outline.md`_
  - _Requirements: 15.5_

- [x] 1.3 (P) 1.1の追加で壊れる既存のテストを更新し、DBの値と共有の定数の照合のテストを加える
  - 1.1の完了の直後に行う(1.1の後は操作種別の一覧のテストが失敗したままになるため)。1.2と並行できる(1.2の文書のファイルを変えない)
  - 一覧を完全一致で確かめる既存のテストを更新する: 操作種別の名前の一覧と件数(`apps/common-lib/admin/audit-actions/index.unit.test.ts`。テスト名の件数と`test.each`の連結も直す)、管理画面の監査ログの操作種別の選択肢(`apps/admin/src/components/pages/audit-logs-page.browser.test.tsx`)。テーブル名の一覧(`apps/db/schema/index.unit.test.ts`)は`toContain`のため壊れないが、前例どおり7テーブルの名前を加える
  - `config/notification-contract-copies.unit.test.ts`を作り、DBの通知種別のCHECKの値と共有の`NOTIFICATION_TOPICS`が同じ値・同じ順であることを、他のアプリのファイルを読み込まずにソースの構文解析で確かめる(`apps/db`は共有ディレクトリを読み込まないため写しになる。前例`config/product-contract-copies.unit.test.ts`)。先に、照合のテストが写しの値を1つ変えると失敗することを確かめる
  - 完了状態: ルートの単体テスト、common-libの単体テスト、adminのブラウザテストが成功する
  - _Boundary: `apps/common-lib/admin/audit-actions/index.unit.test.ts`・`apps/admin/src/components/pages/audit-logs-page.browser.test.tsx`・`apps/db/schema/index.unit.test.ts`・`config/notification-contract-copies.unit.test.ts`_
  - _Depends: 1.1_
  - _Requirements: 1.1, 11.6, 15.1_

- [ ] 2. 契約と純粋な規則
- [x] 2.1 送信枠と通知の計画の規則を作る
  - 先に、単体テストで、夜の枠の期日(業務日付の23:45=UTCの翌日7:45)と送り出しの期限(23:55)、朝の枠(0:00=UTCの8:00)、開始予告が前日の夜の枠・結果が当日の夜の枠に入ること、枠のキーの往復と形式違反、マッチからの通知の下書き(予告は予定で側が2つのマッチだけ・不戦勝の除外・結果は確定だけ・紐付けの無い側の除外)、重複のキーとまとめのキー、1通の計画(統合・片方だけ受信・受信しない種別の除外・送信の対象者でない場合・31件目以降の残りの件数)を確かめる
  - 業務時刻の計算はbackend-platformの部品を使い、データベースと実時間に依存させない
  - 完了状態: 単体テストが成功し、規則がD1と`lib/workers`を読み込まない
  - _Requirements: 3.3, 3.5, 4.4, 4.5, 4.7, 5.6, 7.2, 13.1, 13.2, 15.2_

- [x] 2.2 通知イベント・結果の追記・配信停止のトークンの契約と、メッセージ種別を作る
  - 2.1の送信枠の型を使うため、2.1の後に行う
  - 先に、単体テストで、通知イベントの検証(IDの形式・賞と期間の組み合わせ・件数の上限・発行元の名前の形式)と重複のキー、結果の追記の形式の検証と登録口の検証(名前の形式違反・重複・同じ種別での順の重複の例外、順の並び、種別の絞り込み)、トークンの形式の判定、本文のリンクとヘッダーのURIの形(フラグメントとクエリ)、ヘッダーがhttps:のオリジンのときだけ付くこと、2つのメッセージ種別の本文の検証と再試行の方針の値、夜の枠の送り出しの入口の契約(前提の名前の形式・重複の検証)を確かめる
  - 共有部品のポートの型(異常の通知・データエクスポートの照会を含む)を`core/notifications/ports.ts`に、DIの識別子を`core/notifications/identifiers.ts`にこのタスクで作り、メッセージの契約を契約の一覧へ加える
  - 先に、`core/notifications/identifiers.unit.test.ts`で、`NOTIFICATIONS_PLATFORM_TYPES`の各値が`Symbol.for('notifications.<名前>')`であり、オブジェクトが凍結されていることを確かめる
  - 完了状態: 単体テストとメッセージ種別の重複の検査が成功し、トーナメントのspecが契約の型だけで発行・追記の登録・送り出しの入口の呼び出しを書ける
  - _Requirements: 8.1, 10.2, 12.1, 12.2, 12.4, 12.5, 12.7, 13.7_

- [x] 2.3 件名と文言の規則を作る
  - 2.2の賞の種類の型を使うため、2.2の後に行う
  - 先に、単体テストで、件名の全ての形(勝利・敗北・両者敗北・不戦勝・統合・不戦勝の統合・予告・開催の1件と複数・受賞)と、件名に日付を基準にした相対表現(「明日」「本日」)が含まれないこと、結果の写像(両方の該当は送らない)、マッチの表記とラウンド名、賞の期間の表記(ISO週の年末年始の境界)、抑止の理由の写像(恒久的なバウンスを`bounce`)を確かめる
  - 完了状態: 単体テストが成功し、文が文言規則の表と一致する
  - _Requirements: 4.3, 5.2, 5.3, 6.2, 14.3, 15.2_

- [ ] 2.4 メールの組み立ての規則と、4つのメール種別を作る
  - 先に、単体テストで、1通の計画と照会の結果から各メール種別の入力を組み立てること、古い予告の除外と統合からの予告の切り離し、自分のプロダクトの非公開化での送らない判断(仮7)、相手の「非公開のプロダクト」、開催通知の表示できない項目の除外と0件の扱い、追記の行動のボタンの優先と既定の行動、通知設定のリンク、主たる種別の配信停止のリンクとヘッダー、統合したメールのヘッダーが勝敗結果のトークンで本文に2つのリンクがあること(仮4)、送信の期限(単独の開始予告はマッチの開始の日時・開催通知は載せた項目のマッチの最も早い終了の日時・勝敗結果と統合したメールと受賞結果は期限なし)、組み立てた入力が各種別の入力の検証を通ることを確かめる
  - 4つの種別(通知メールの分類)と入力の検証を定義する。メール種別の集約点への追加は、テンプレートの集約点と1対1に保つため、テンプレートと同時に5.3で行う
  - 完了状態: 単体テスト(4種別の入力の検証を含む)が成功する
  - _Requirements: 3.4, 3.6, 4.3, 4.4, 4.6, 5.4, 6.2, 7.7, 7.8, 7.9, 7.11, 8.1, 8.6, 9.1_

- [ ] 3. 共有部品
- [ ] 3.1 受信設定のストアと送信者情報の読み取りを作る
  - 先に、ローカルD1のWorkers統合テストで、行の無い種別が受信しない設定として返ること、種別ごとの保存の上書き、送信の対象者の絞り込みと送る直前の確かめ直しが停止中・未確認・退会済みの利用者を除き91件以上を分けて読むこと、利用者の受信設定の削除、送信者情報がシードの版0の行では値をundefined・設定済みでは値と版を返し、どちらもシードの固定のIDを対象のIDとして返すことを確かめる
  - 受信設定は`users`を`verifiedUsers()`の条件でだけ結合し、メールアドレスとニックネームを読まない
  - 完了状態: Workers統合テストが成功する
  - _Depends: 1.1, 2.2_
  - _Requirements: 1.2, 1.4, 7.1, 7.2, 11.8_

- [ ] 3.2 (P) 配信停止のトークンのサービスを作る
  - 先に、ローカルD1のWorkers統合テストで、同じ利用者と種別に同じトークンを返し別の組では異なること、平文がデータベースに残らないこと、照合用のハッシュで引いてタイミングセーフに確かめること、形式違反・不一致・種の削除(退会)で無効になること、同時の作成で種が1つになること、導出と照合の用途の値が一致しないこと、ペッパーを変えた後にトークンを求めると照合用のハッシュが導出し直した値へ更新され、新しいトークンが照合でき変更の前のトークンが無効になることを確かめる
  - 完了状態: Workers統合テストが成功し、api・eventの両方から同じ規則でトークンを扱える
  - _Boundary: D1UnsubscribeTokenService_
  - _Depends: 1.1, 2.2_
  - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [ ] 3.3 送信枠と通知のストアと、送り出しと展開の依頼を作る
  - 先に、ローカルD1のWorkers統合テストで、枠の作成の重複の無視、リースの排他(別の保持者は取れず、同じ保持者と期限の過ぎたリースは取れる)と保持者だけの段の更新、期限を過ぎた枠と完了した枠に残る通知の検索、前提のうち準備の完了が無い名前の照会と期限による依頼の時刻の記録(既にあれば変えない)、前提の一覧を未確定(NULL)のときだけ書き込み2回目は書き込まないこと、一覧が未確定の枠の未完了の名前の照会がnullを返すこと、通知の記録の重複の無視と送り出し中・完了の枠の検出、まとめのキーごとの未送信の通知の読み取り、未送信の通知だけの確定、宛先ごとの削除、送り出しと展開のメッセージの送信を確かめる。通知の挿入の1文の行数は列数から決めた定数にし(16列なら6行)、単体テストで1文のバインド変数(`toSQL().params.length`)が100以下であることを確かめる
  - 完了状態: Workers統合テストが成功し、送り出しの再開と遅れた通知の検出に使える
  - _Depends: 2.1, 2.2_
  - _Requirements: 7.12, 12.8, 13.3_

- [ ] 3.4 通知イベントの発行と、開始予告・結果の展開を作る
  - 先に、ローカルD1のWorkers統合テストで、match-engineのマッチに対する開始予告と結果の発行が受信する設定の投稿者の通知を前日・当日の夜の枠へ記録すること、Yearの1回戦のように前日より前の発行も前日の枠に入ること、未確定の結果・開始済みの予告・存在しないマッチ・51件の拒否と理由、同じ発行の重複を数えて通知を増やさないこと、送り出し済みの枠に入った通知の送り出しを依頼すること、受賞の発行が通知イベントを記録して展開の依頼だけを送ることを確かめる
  - 完了状態: Workers統合テストが成功し、トーナメントが発行の口だけで開始予告と結果を送らせられる
  - _Depends: 3.1, 3.3_
  - _Requirements: 3.2, 3.3, 4.2, 12.1, 12.3, 12.4, 12.5, 12.8_

- [ ] 3.5 受賞の展開を作る
  - 先に、ローカルD1のWorkers統合テストで、受賞の展開がプロダクトの投稿者のフォロワーを500件ずつ読み、1回の処理の上限(2,000件)で区切ってカーソルを通知イベントの行に保存して続きを返すこと、受信する設定の送信の対象者の通知を受賞の枠へ記録して完了し、送り出す枠と遅れた枠を返すこと、表示できないプロダクトの受賞を0件で完了すること、再実行で通知が増えないことを確かめる
  - 3.4の展開の部品に受賞の分岐を加え、別の展開の部品を作らない
  - 完了状態: Workers統合テストが成功し、受賞の通知イベントからフォロワーの通知が作られる
  - _Requirements: 6.1, 12.8_

- [ ] 3.6 (P) データエクスポートの部品を作る
  - 先に、Workers統合テストで、4種別の受信可否と、抑止の理由(2.3の写像を使い、恒久的なバウンスは`bounce`・苦情・受信側の拒否・除外されていなければnull)、退会済みの利用者でundefinedになることを確かめる
  - 完了状態: Workers統合テストが成功し、データエクスポートの文書の`notificationSettings`に対応する
  - _Boundary: D1NotificationSettingsExport_
  - _Depends: 3.1_
  - _Requirements: 14.3_

- [ ] 3.7 異常の通知の部品と通知の共有の束縛を作り、apiとeventに組み込む
  - 先に、Workers統合テストで、異常の通知が種類ごとの重大度・タグ・fingerprint(夜の枠の前提の未完了は`warning`)でエラートラッキングへ送られ、メールアドレス・名称・トークンを含まないことを、差し替えたトランスポートで確かめる
  - タグは規約(`infra/004`)の`<ドメイン>_incident`の形の`notifications_incident`にする
  - 3.1〜3.6の部品と送り出しと展開の依頼・異常の通知を処理単位で束縛するモジュールを作り、apiとeventの束縛の一覧へ同時に加える
  - 完了状態: Workers統合テストと3経路(api・eventの`fetch`・eventの`queue`)のDIの解決の検査が成功し、両アプリで発行の口とデータエクスポートの部品を解決できる
  - _Requirements: 12.1, 13.8, 14.3, 14.4_

- [ ] 4. APIサーバー
- [ ] 4.1 通知設定のユースケースと配信の状態の照会を作り、apiの通知のモジュールを作る
  - 先に、模擬のポートの単体テストで、4種別の受信可否・抑止の理由と期限・照会の失敗の`unknown`・未確認・停止中の変更不可の組み立て、変更が1種別だけを保存して最新の設定を返すことを確かめる。ローカルD1のWorkers統合テストで、配信の状態の照会が連絡先のメールアドレスで抑止を引き、2.3の写像で`bounce`に写し、連絡先が無い場合と照会の例外で`unknown`になることを確かめる
  - apiの通知のDIの識別子の一覧とモジュールをこのタスクで作って束縛の一覧へ加え、以後のapiのタスクは識別子と束縛をここへ加える
  - apiの通知の`application`のポートの定義のファイルをこのタスクで作って配信の状態の照会だけを定義し、送信者情報の保存(4.3)と保守のストア(4.5)のポートはそれぞれのタスクが追記する
  - 完了状態: 単体テスト・Workers統合テスト・DIの解決の検査が成功し、ユースケースが利用者をセッションではなく引数で受け取る
  - _Depends: 3.7_
  - _Requirements: 1.3, 1.4, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 14.5_

- [ ] 4.2 配信停止のユースケースを作る
  - 先に、模擬のポートの単体テストで、無効なトークンの照会でnull、有効なトークンで種別と現在の受信可否を返すこと、確定で受信を停止すること、既に停止済みの確定が成功して既に停止の印を返すこと、無効なトークンの確定の拒否、トークンでは停止以外を行わないことを確かめる
  - 完了状態: 単体テストとDIの解決の検査が成功する
  - _Requirements: 9.3, 9.4, 9.5, 10.6_

- [ ] 4.3 送信者情報のユースケースと保存を作る
  - 先に、模擬のポートの単体テストで、項目ごとの検証(空・201書記素・メールアドレスの形式)、前後の空白の除去、監査ログの準備(操作種別・対象・任意の理由・変更した項目の名前だけで値を含めないこと)、版の不一致の拒否を確かめる。ローカルD1のWorkers統合テストで、シードの版0の行からの初回の保存と更新が版を進め監査ログと同じ一括の書き込みで記録されること、版の不一致(同じ版0からの2回目の保存を含む)で設定も監査ログも書かれないことを確かめる
  - 保存は機能フラグの前例(`d1-promotion-setting-writer.ts`)と同じく、版の一致を条件にした監査ログの文を先に置いて同じ条件の更新を続け、取り消しを`isAuditGuardRejection`で判定して版の競合に変える。挿入は行わない
  - 送信者情報の保存のポートを`application`のポートの定義へ追記し、識別子と束縛をapiの通知のモジュールへ加える
  - 完了状態: 単体テスト・Workers統合テスト・DIの解決の検査が成功する
  - _Requirements: 11.2, 11.4, 11.6, 11.7_

- [ ] 4.4 退会の同期の処理を作る
  - 先に、ローカルD1のWorkers統合テストで、identity-authの退会の確定と同じ一括の書き込みで、その利用者のトークンの種と受信設定が消え、未送信の通知が退会の理由で送らない扱いになること、トークンが直ちに無効になること、退会の確定の競合で本specの文も取り消されること、停止と停止の解除では何も変わらないことを確かめる
  - 同期の処理の識別子と束縛をapiの通知のモジュールへ、登録をidentity-authの同期の処理の登録箇所へ同時に加える
  - 完了状態: Workers統合テストとDIの解決の検査が成功する
  - _Depends: 3.2_
  - _Requirements: 10.4, 10.5, 14.1_

- [ ] 4.5 保守のストアを作る
  - 先に、ローカルD1のWorkers統合テストで、期日から一定の時間を過ぎた未送信の通知を期限切れにすること、展開されずに残る通知イベントの検索と送り直しの回数の更新、確定から30日を過ぎた通知・未送信の通知が無い完了の枠・展開から30日を過ぎた通知イベントを件数の上限ずつ削除することを確かめる
  - 保守のストアのポートを`application`のポートの定義へ追記し、識別子と束縛をapiの通知のモジュールへ加える
  - 完了状態: Workers統合テストとDIの解決の検査が成功する
  - _Requirements: 13.4, 13.5_

- [ ] 4.6 夜の枠の送り出しの入口と、送り出しの前提の登録口を作る
  - 先に、ローカルD1のWorkers統合テストで、前提が2つ登録されているとき1つ目の`markReady`が`waiting`と残りの名前を返し、2つ目が`dispatch-requested`を返して送り出しのメッセージが1通だけ送られること、同じ機能の繰り返しの呼び出しと送り出しの後の呼び出しが`already-requested`を返すこと、2つの呼び出しを同時に行っても依頼が1回であること、登録の無い名前の`unknown-participant`、本specのジョブより先に呼ばれた場合に枠と前提の一覧(登録口の写し)と23:55の期限の送り出しを作ること、通知の記録が数日前に作った夜の枠に対して`open`が前提の一覧を写して期限の送り出しを依頼し直ちには依頼しないこと、`open`が前提の空のときは直ちに依頼すること、期限の送り出しの遅延が`open`と`markReady`のどちらでも「23:55−現在時刻(0未満は0)」になること、前提の一覧がその夜の途中の登録の変更に影響されないことを確かめる。単体テストで、登録口が起動の時点で2.2の検証を通すことを確かめる
  - 送り出しの前提の登録口(初版は空、起動の時点で検証)を作る。2.2で作った`NOTIFICATIONS_PLATFORM_TYPES`の`EveningDispatchGate`・`EveningSlotOpener`・`EveningDispatchParticipants`を、apiの通知のモジュールでだけ束縛する(apiの識別子の一覧には加えない)
  - 完了状態: Workers統合テスト・単体テスト・DIの解決の検査が成功し、トーナメントのspecが登録口に1行足して`NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate`を解決できる
  - _Depends: 3.3, 4.1_
  - _Requirements: 13.1, 13.7, 13.8, 13.9_

- [ ] 4.7 23:45・0:00・4:21のジョブを作り、登録する
  - 先に、模擬のポートの単体テストで、業務時刻23:45:00の予定時刻で当日の夜の枠を4.6の部品で開くこと(23:44:59の予定時刻でも同じ業務日付の夜の枠を開くことで、枠の日付が予定時刻の業務日付で決まることを確かめる)、0:00の予定時刻で当日の朝の枠を遅らせずに依頼すること(23:59:59は前日)、4:21の保守が前日の夜の枠と当日の朝の枠を確かめて未完了なら依頼し、1時間を過ぎた未完了の枠と未送信の通知が残る完了の枠へ依頼して異常の通知へ報告し、10分を過ぎた未展開の通知イベントへ依頼して3回目以降を報告し、3日を過ぎた未送信の通知を期限切れにし、30日を過ぎた記録を500件ずつ最大10回削除することを確かめる
  - 3つのジョブ(`order` 1300)の識別子と束縛をapiの通知のモジュールへ、登録を定期実行の登録箇所へ加える。Cronの式は追加しない
  - ジョブの一覧と実行の結果を完全一致で確かめる既存のテストを更新する: 4:21のジョブの名前(`apps/api/src/composition/search-module.worker.test.ts`)、4:21の実行の結果(`search-module.reextraction.worker.test.ts`。本specの保守のジョブがそのテストの環境で成功することも確かめる)、0:00の実行の結果(`match-module.jobs.worker.test.ts`)。4:21のジョブは時刻ごとの所要時間の予算(300秒)を共有する
  - 完了状態: 単体テストと、定期実行の登録の検査(同じ時刻での`order`の重複なし、0:00・23:45ではmatch-engineの1100の後)が成功する
  - _Requirements: 13.1, 13.2, 13.4, 13.5, 13.6, 13.9, 15.2_

- [ ] 4.8 スキーマモジュール`notifications`の土台と、利用者側の操作を加える
  - 先に、Workers統合テストで、通知設定の照会の未ログインの拒否と各項目、変更の未ログイン・停止中の拒否と1種別の保存、配信停止のリンクの照会が形式違反と無効でnull・有効で種別と受信可否を返すこと、確定の無効なトークンの`invalid_link`と既に停止の成功、`client`以外の呼び出し元の拒否、トークンがログに出ないことを確かめる
  - 型の定義・エラーの定義・入力の検証規則・利用者側のリゾルバを作り、スキーマモジュールの一覧へ加える。認可(`AccountGuard`)はリゾルバで行う。apiで`bun run graphql:generate`を実行して`schema.graphql`・`resolvers-types.ts`を再生成する(一致は`graphql-modules.worker.test.ts`が確かめる)
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Depends: 4.1, 4.2_
  - _Requirements: 1.3, 1.4, 1.6, 2.1, 2.2, 2.3, 2.4, 9.2, 9.3, 9.4, 9.5_

- [ ] 4.9 管理者側の送信者情報の操作を加える
  - 先に、Workers統合テストで、照会が全ての管理者に許され未設定をnullで返し変更者のニックネーム(`AdminDirectory.findProfiles`が有効な管理者だけを返すため、削除済み・停止中・招待中はnull)を返すこと、保存が最上位管理者以外で`forbidden`・項目ごとの`validation_error`・`version_conflict`・成功で最新の状態を返すこと、`admin`以外の呼び出し元の拒否を確かめる
  - 認可(`requireAdmin`)と変更者のニックネームの照会はリゾルバで行う。apiで`bun run graphql:generate`を実行してスキーマの生成物を再生成する
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Depends: 4.3, 4.8_
  - _Requirements: 11.2, 11.3, 11.5, 11.6, 11.7_

- [ ] 5. イベントサーバー
- [ ] 5.1 eventの通知のモジュールと変数を作り、送信者情報の取得口を差し替える
  - eventの通知のDIの識別子とモジュールをこのタスクで作って束縛の一覧へ加え、以後のeventのタスクは識別子と束縛をここへ加える
  - eventのWrangler設定の3環境の変数とテストの設定に`EVENT_SITE_ORIGIN`(3環境の値はinfra-deliveryの改訂1の表のeventの行に合わせる)を加え、環境の検証で必須にする。メールの送信者情報の取得口の登録箇所を本specの実装へ書き換え、使われなくなるemail-deliveryの既定の実装(`UnsetSenderInfoProvider`)とそのテストを削除する
  - 先に、Workers統合テストで、取得口が版0でundefined・設定済みで3項目を返すこと、環境の検証が`EVENT_SITE_ORIGIN`の欠落を名前で報告することを確かめる
  - eventの変数を完全一致で確かめる既存のテスト(`apps/api/test/config/wrangler-config.unit.test.ts`の変数の一覧と`EXPECTED_ENVIRONMENTS`の値)に`EVENT_SITE_ORIGIN`を加える
  - 完了状態: Workers統合テストと3経路のDIの解決の検査が成功し、描画される全種別のメール(通知メールとトランザクションメール)に設定した送信者情報が載る
  - _Depends: 3.7_
  - _Requirements: 7.5, 11.8_

- [ ] 5.2 開始予告と勝敗結果のテンプレートを作る
  - 先に、workerd上のWorkers統合テストで、テンプレートを直接描画し、2つの種別の件名・宛名・本文の文・UTCの日時の表記・主要な行動のボタン・通知設定のリンク・配信停止の区画・送信者情報、勝敗結果の最終Upvote時間の文と追記の段落(強調を含む)、統合したメールの翌日の予告と2つの配信停止のリンク、入力の文字列のエスケープを確かめる
  - 追記の段落と通知設定のリンクの部品もこのタスクで作る。2つの配信停止のリンクはテンプレートの`unsubscribeLinks`で返す。テンプレートの集約点への追加は5.3で行う
  - 完了状態: Workers統合テストが成功する
  - _Depends: 1.2, 2.4, 5.1_
  - _Requirements: 3.4, 4.3, 4.4, 4.6, 7.5, 7.10, 7.11, 9.1_

- [ ] 5.3 開催通知と受賞結果のテンプレートを作り、4つの種別とテンプレートを登録する
  - 先に、workerd上のWorkers統合テストで、2つの種別の件名・宛名・本文・ボタン・配信停止の区画・送信者情報、開催通知の項目と残りの件数、受賞の期間の表記、入力の文字列のエスケープを確かめ、メール種別とテンプレートが1対1で集約点に載ることを確かめる
  - 4つのテンプレートを`templates/notifications/index.ts`(`NOTIFICATION_EMAIL_TEMPLATES`、前例`ULTRAS_EMAIL_TEMPLATES`)にまとめ、2.4の4つのメール種別をメール種別の集約点へ、テンプレートの集まりをテンプレートの集約点へ、同時に加える(テンプレートの検査はeventの起動時に走るため、片方だけを加えるとeventのWorkers統合テストが全て落ちる)
  - 完了状態: Workers統合テストと、メール種別とテンプレートの集約点の検査(名前の形式・重複なし・1対1)が成功する
  - _Requirements: 5.2, 5.3, 5.4, 6.2, 7.10, 7.11, 9.1_

- [ ] 5.4 夜と朝の収集を作る
  - 先に、ローカルD1のWorkers統合テストで、夜の収集がmatch-engineの当日の確定した予選と翌日の予定の予選から受信する設定の送信の対象者の通知だけを作り、不戦勝の予告を作らず、再実行で通知が増えないこと、朝の収集がマッチ中のマッチ(予選・トーナメント)の投稿者の一覧を作ってカーソルに保存し、フォロワーを2,000件で区切って続き、表示できないプロダクトと開始時点で決着したマッチを除き、受信する設定の送信の対象者の通知を作ること、開始の日時を過ぎても未開始の当日のマッチ(0:00の開始の失敗)が残る間は投稿者の一覧を作らずに待ち(300秒・未開始の件数)を返し、マッチが開始された後と、そのマッチの終了の日時を過ぎた後は収集することを確かめる
  - eventの通知の`application`のポートの定義のファイルをこのタスクで作って収集のポート(進行と待ちの2つの結果)だけを定義し、追記の取得(5.5)と送信(5.6)のポートはそれぞれのタスクが追記する
  - マッチの照会(`listForDate`・`findMatches`)には処理の時点の`now`を渡す(`phase`はその`now`から導かれる)
  - 2つの収集の識別子と束縛をeventの通知のモジュールへ加える
  - 完了状態: Workers統合テストとDIの解決の検査が成功する
  - _Depends: 3.1, 3.3_
  - _Requirements: 3.1, 4.1, 5.1, 5.5, 7.8, 12.6, 13.2_

- [ ] 5.5 結果の追記の登録口と、追記の取得を作る
  - 先に、Workers統合テストで、テスト用の登録が勝敗結果の種別ごとに順に呼ばれ3件までになること、形式に合わない追記が捨てられて提供元の名前だけが警告のログに出ること、提供元の例外がそのまま投げられること、登録が無ければ空を返すことを確かめる
  - 追記の取得のポートを`application`のポートの定義へ追記し、結果の追記の登録口(初版は空、登録の検証付き)と追記の取得を作り、識別子と束縛をeventの通知のモジュールへ加える
  - 完了状態: Workers統合テストと登録口の検証とDIの解決の検査が成功し、トーナメントのspecが登録口に1行足すだけで追記を加えられる
  - _Requirements: 4.6, 12.7_

- [ ] 5.6 送信を作る
  - 先に、ローカルD1のWorkers統合テストで、まとめのキーごとに20通までを処理し、送る直前の受信設定と送信の対象者の確かめ直し、連絡先の無い・未確認の宛先・抑止中の宛先・送信者情報の未設定(1時間に1回の報告)・自分のプロダクトの非公開化・古い予告を理由付きで送らない扱いにすること、統合と集約のメールをメール送信の偽物へ正しい種別・入力・ヘッダー・送信の期限で渡し送った通知を送信要求の識別子とともに確定すること、送信の依頼の後の確定が失敗した再試行で同じ通知をもう1通依頼し得ること(許容する重複、要件7.12の注記)、5.5の追記が勝敗結果の入力に載ること、送信要求の拒否を報告して送らない扱いにすること、ログと報告にメールアドレス・ニックネーム・名称・トークンが含まれないことを確かめる
  - 抑止の照会の戻り値は照合キーの集合のため、連絡先のメールアドレスを`toMatchingKey`に通して照合する。マッチの照会には処理の時点の`now`を渡す
  - 送信のポートを`application`のポートの定義へ追記し、送信の識別子と束縛をeventの通知のモジュールへ加える
  - 完了状態: Workers統合テストとDIの解決の検査が成功する
  - _Depends: 2.4, 3.2, 5.3, 5.5_
  - _Requirements: 3.6, 4.6, 7.1, 7.2, 7.3, 7.4, 7.6, 7.7, 7.9, 7.12, 14.4, 14.5_

- [ ] 5.7 送信枠の送り出しの処理を作り、メッセージの処理として登録する
  - 先に、模擬のポートの単体テストで、枠が無い場合の完了、リースを取れない場合の30秒の`defer`、待機の段で送り出しの依頼があれば直ちに収集へ進むこと、依頼が無いとき業務時刻23:54:59の実行は期限までの`defer`・23:55:00の実行で依頼の時刻を記録して収集へ進み、準備の完了が無い前提の名前(一覧が未確定なら「前提が未確定」)を`evening-dispatch-incomplete`として報告すること、収集と送信の続きでの1秒の`defer`と段の進行、収集が待ちを返したら段とカーソルを変えずに待ちの秒数の`defer`をすること、受賞の枠が収集を飛ばすこと、完了の枠に遅れた通知があれば送信の段を行うこと、例外をそのまま投げて再試行で未送信の通知とカーソルから再開することを確かめる
  - Workers統合テストで、送信者情報と受信設定と確定した予選をローカルD1に用意し、`notifications.flush-slot`のメッセージをeventのQueueの処理へ渡して、収集から送信まで進み、通知メールの分類の`email.send`の封筒(宛先・種別・ヘッダー)が送られ、枠が完了になることを確かめる
  - 処理の識別子と束縛をeventの通知のモジュールへ、登録をメッセージの処理の登録箇所へ加える
  - 完了状態: 単体テスト・Workers統合テスト・3経路のDIの解決の検査が成功し、`notifications.flush-slot`を処理できる
  - _Depends: 5.4, 5.6_
  - _Requirements: 12.8, 13.1, 13.2, 13.3, 13.8_

- [ ] 5.8 受賞の展開の処理を作る
  - 先に、模擬のポートの単体テストで、展開の続きでの1秒の`defer`、完了で受賞の枠と遅れた枠の送り出しを依頼すること、例外をそのまま投げることを確かめる
  - 処理の識別子と束縛をeventの通知のモジュールへ、登録をメッセージの処理の登録箇所へ加える(5.7の後に行い、登録箇所の変更が並行しないようにする)
  - 完了状態: 単体テストと3経路のDIの解決の検査が成功し、`notifications.expand-event`を処理できる
  - _Depends: 3.5_
  - _Requirements: 6.1, 6.3_

- [ ] 5.9 ワンクリックの配信停止の経路を作る
  - 先に、模擬のポートの単体テストで、トークンによる停止のユースケース(無効・停止・既に停止の成功・停止以外を行わない)を確かめる。Workers統合テストで、`POST /unsubscribe?token=`がログインを求めずに受信を停止して200を返すこと、形式違反で400・照合できなければ404、同じ要求の繰り返しで200、IP単位の制限の対象外であること、`GET`が受信を変えずに配信停止ページのフラグメント付きのURLへ303で移すこと、応答の`Cache-Control: no-store`と、Worker全体を通した応答の`Referrer-Policy`が全体のセキュリティヘッダーの`same-origin`であること(経路では付けない)、アクセスログにトークンが残らないことを確かめる
  - 200・400・404の`text/plain`の本文は経路から直接返し、`AppError`を投げない(共通エラー形式のJSONになるため)
  - 経路をeventの通知のモジュールへ、`POST /unsubscribe`の除外をIP制限の除外の登録箇所へ加える
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.7, 10.6_

- [ ] 5.10 退会した利用者の物理削除の処理を作る
  - 先に、模擬のポートの単体テストで、通知を1,000件ずつ消して1,000件なら`continue`、未満なら受信設定とトークンの種の残りを消して`done`を返すことを確かめる。ローカルD1のWorkers統合テストで、identity-authの利用者の物理削除が本specの行の外部キーで失敗しないことを確かめる
  - 処理(`order` 1300)の識別子と束縛をeventの通知のモジュールへ、登録をidentity-authの非同期の処理の登録箇所へ加える
  - `purge_due`の処理の一覧を完全一致で確かめる既存のテストに本specの処理を加える(`apps/event/src/composition/profile-module.worker.test.ts`・`user-product-erasure.worker.test.ts`・`match-module.purge.worker.test.ts`)
  - 完了状態: 単体テスト・Workers統合テストと、登録口の検証が成功する
  - _Requirements: 13.6, 14.2_

- [ ] 6. 利用者側の画面
- [ ] 6.1 クライアントの操作と画面の文言を加え、型と許可リストを生成する
  - 通知設定の照会と変更、配信停止のリンクの照会と確定の操作をclientの`src/graphql/operations/notifications/`に1ファイル1操作の`*.graphql`(操作名は`Client`で始める)で加え、clientで`bun run graphql:generate`を実行して型と`<操作名>Document`とpersisted operationsを生成し、apiで`bun run graphql:allowlist`を実行して許可リストを再生成する
  - 先に、単体テストで、画面の文言(抑止の3つの理由・配信停止の確認と完了と既に停止と無効と失敗)が文言規則と一致すること、取得の設定と結果の型の変換(`src/graphql/notification-settings.ts`、`frontend/006`)を確かめる。文言は`components/notifications/notification-messages.ts`に置く(前例`settings-messages.ts`)
  - 操作と文言はこのタスクで確定させ、6.2・6.3は操作・型・許可リスト・文言のファイルを変えない
  - 完了状態: 単体テストと型の生成が成功し、許可リストの再生成の後にスキーマの検査が成功する
  - _Depends: 1.2, 4.8_
  - _Requirements: 1.3, 9.2_

- [ ] 6.2 通知設定ページを作る
  - 先に、ブラウザテスト(axeの違反0件)で、4種別の順と名称と説明・初期値の説明、スイッチの送信中の`aria-disabled`・`aria-busy`と押下の無視とフォーカスの維持(`disabled`にしない、`frontend/004`)・成功でサーバーの値と「通知設定を保存しました。」・失敗で元の値と理由(`errorMessageOf(error, CLIENT_PROFILE.contactAvailable)`)の通知、抑止の3つの理由の文言と受信側の拒否の期限の`<time datetime>`とメールアドレスの変更への導線、状態の照会の失敗の文言、未確認の案内、停止中のスイッチの無効と案内を確かめる
  - `_authenticated`の設定ページの下に置き、設定ページのナビゲーションの登録箇所に「通知」(40)を加え、一覧を完全一致で確かめる`apps/client/src/components/settings/settings-nav-order.unit.test.ts`を更新する。ページの`head`は`buildSitePageHead({ title, noIndex: true })`、`loader`の取得は`queryClient.query({ ...options, staleTime: 'static' })`にする(`ensureQueryData`は使わない)
  - 完了状態: ブラウザテストが成功し、ローカルで未ログインのまま`/settings/notifications`を開くとログインへ誘導され、ログイン後に戻ってスイッチを操作できる
  - _Boundary: NotificationSettingsRoute、NotificationSettingsPanel、NotificationTopicSwitch、DeliveryStatusNotice_
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4_

- [ ] 6.3 (P) 配信停止ページを作る
  - 6.1の完了の後に始め、6.2と並行できる(6.2のファイルと6.1が確定させた操作・文言のファイルを変えない)。TanStack Routerが生成するルートツリーのファイルは6.2・6.3の両方で変わるため、各タスクで生成し直し、取り込みで衝突すれば生成し直して解消する
  - 先に、ブラウザテスト(axeの違反0件)で、フラグメントのトークンを読んでURLから消すこと、トークンが無い・無効のときの「このリンクは無効です。」と通知設定への導線、確認の文と「配信を停止する」、開いただけでは確定の操作を送らないこと、確定の成功の文と「通知設定を開く」、既に停止の文と確認のボタンが無いこと、失敗の文と再試行、メールアドレス・ニックネームを表示しないことを確かめる
  - ログイン不要の経路に置き、`buildSitePageHead({ title, noIndex: true })`で検索エンジンの索引の対象から外す。トークンはfrontend-libの`useFragmentToken`で読み(ハイドレーション中は`reading`)、読めた間だけリンクの照会を有効にする(前例`password-reset-form.tsx`。`LinkConfirmation`は開いた時の照会を持たないため使わない)
  - 完了状態: ブラウザテストが成功し、ローカルで`/unsubscribe`を開くと無効の表示になる
  - _Boundary: UnsubscribeRoute、UnsubscribeConfirmation_
  - _Depends: 6.1_
  - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

- [ ] 7. 管理者側の画面
- [ ] 7.1 送信者情報の区画を作り、管理画面の設定ページへ登録する
  - adminの`src/graphql/operations/notifications/`に送信者情報の照会と保存の操作を1ファイル1操作の`*.graphql`(操作名は`Admin`で始める)で加え、adminで`bun run graphql:generate`を実行して型を生成し、apiで`bun run graphql:allowlist`を実行してadminの許可リストを再生成する
  - 先に、ブラウザテスト(axeの違反0件)で、未設定の警告、現在の値と最後に変更した日時の`<time datetime>`と管理者のニックネーム、最上位管理者だけが編集でき他は参照だけで「最上位管理者だけが変更できます」と出ること、フォーカスアウトの項目ごとの検証(空・201文字・メールアドレスの形式。形式は前後の空白を除いた値を`z.regexes.html5Email`と`EMAIL_MAX_LENGTH`で判定してサーバーの`isValidEmailAddress`と同じ規則にし、文言は既存の「メールアドレスの形式が正しくありません。」)、最後に変更した日時と管理者が無いときの「なし」、理由を任意で入れる確認のダイアログ、読み込んだ版(`expectedVersion`)とダイアログの理由をスキーマの入力に含めず送る時に足すこと、入力欄のフォームの送信がダイアログを開いて確定か取り消しまで送信中のままになり、取り消しで送信中から戻ること、サーバーの項目のエラー(`validation_error`)でダイアログを閉じて入力欄に詳細が付くこと、競合の案内がダイアログの中に出ること、`GraphQLClientError`でない例外で問い合わせを促さない文言(`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`)、取得の失敗の表示に問い合わせのボタンが無いこと、成功の通知を確かめる
  - 最上位管理者の判定は`hasRole(useAdminRole(), 'super_admin')`、取得の失敗は値が無い間だけ`throwOnError`で設定ページの`RecoverableSlot`へ投げて`SectionFallback`に描かせる(前例`promotion-setting-section.tsx`)。文言は`sender-info-messages.ts`、取得の設定と最後の変更の写しは`src/graphql/admin-notification-sender-info.ts`(単体テスト付き、前例`admin-ultras-promotion.ts`)に置く
  - 区画の一覧を完全一致で確かめる`apps/admin/src/components/pages/admin-settings-page.browser.test.tsx`に送信者情報の区画を加え、偽の応答に送信者情報の照会を加える(未登録の操作は例外になり、区画が失敗の表示になるため)
  - 確認のダイアログは自分のフォームを持つため、入力欄のフォームの外に置く(前例`legal-draft-form.tsx`)。入力欄のフォームの送信の処理がダイアログを開いて確定か取り消しまで解決しないPromiseを返し、`validation_error`のときはその例外で拒否して、入力欄のフォームの欄のエラーの処理に任せる
  - 管理画面の設定ページの区画の登録箇所に送信者情報(30、見出しと同じ`title`「通知メールの送信者情報」)を加える
  - 完了状態: ブラウザテストとスキーマの検査が成功し、ローカルで管理画面の`/settings`に決勝実施日・機能フラグの後に送信者情報の区画が出る
  - _Depends: 1.2, 4.9_
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.7_

- [ ] 8. 文書
- [ ] 8.1 (P) 技術ドキュメントを書き、CLAUDE.mdから参照する
  - `backend/016-batched-notification-delivery.md`・`security/010-one-click-unsubscribe.md`を設計のNotificationTechDocsの内容(前段の処理の完了を待つ収集・送信の期限・依頼の後の記録の失敗による重複・ペッパーを変えた後の照合用のハッシュの更新を含む)で、本プロジェクト固有の値を含めずに書き、`backend`・`security`のREADMEの文書一覧に行を加える
  - CLAUDE.mdの「技術規則の参照先」に「通知メールを送る処理を書く前に: `backend/016`」を、作った見出しへのリンクで加える
  - `infra/004`のエラートラッキングへ送る場合の表に、送信枠の送り出しの遅れ・送信の要求の拒否・送信者情報の未設定・通知イベントの展開の停滞・送り出しの前提の未完了の行を、本プロジェクト固有の値を含めずに加える
  - 完了状態: 文書とREADMEが整形の検査を通り、本プロジェクト名とサービス固有の仕様を含まず、CLAUDE.mdのリンクの見出しが実在する
  - _Boundary: `docs/GUIDES/tech/backend/016-batched-notification-delivery.md`・`security/010-one-click-unsubscribe.md`・`backend/README.md`・`security/README.md`・`infra/004-logging-and-error-tracking.md`・`CLAUDE.md`_
  - _Requirements: 15.4_

- [ ] 8.2 日次タイムラインとオンボーディングを更新する
  - 日次タイムラインの23:45の行に`notifications.evening-dispatch`(1300)と、送り出しはトーナメントの23:45のジョブ(1500番台・1700番台)が最後に送り出しの入口へ準備の完了を伝えた後に始まり、遅くとも23:55に始まる旨(仮2)を、0:00の行に`notifications.morning-dispatch`(1300)を、4:21のジョブの表に`notifications.maintenance`(1300)を加え、トーナメントの開始予告はマッチ前日の23:45に送る旨(仮1)を記載する。「同時刻に走る処理の順序」の図の、23:45のペアリングが通知を送る形を、本specの1300のジョブと送り出しの入口の形に改める。`docs/onboardings/project-values.md`に波及処理・ジョブ・メッセージ種別・メール種別の名前と`order`、ハッシュの用途、監査ログの操作種別、`EVENT_SITE_ORIGIN`の3環境の値、送り出しの前提の登録口と入口のDIの識別子を加え、送信者情報の提供元の行を`UnsetSenderInfoProvider`から`D1SenderInfoProvider`へ改める。既存の「現在は」の行(IP制限の除外、eventの変数の一覧、`EMAIL_TEMPLATES`の内訳、退会の同期の処理、管理画面の設定ページの区画の件数、設定のナビゲーション)を書き換え、他specの節と同じ形のメール種別の行を加える
  - 完了状態: 文書が整形の検査を通り、4.6・4.7・5.1・5.10の登録の値と一致する
  - _Depends: 4.7, 5.1, 5.10_
  - _Boundary: `docs/GUIDES/service/overview/007-daily-timeline.md`・`docs/onboardings/project-values.md`_
  - _Requirements: 13.6, 15.5_

- [ ] 9. 検証
- [ ] 9.1 E2Eテストで通知設定・配信停止・送信者情報の流れを確かめる
  - 先に、E2Eの実行のコマンド(Infisicalによるシークレットの注入)で`HASH_PEPPER`が渡されることを確かめる。渡されなければ補助の前提が満たせないため、配信停止のE2Eを保留して開発者へ報告する
  - `e2e/support/notification-fixtures.ts`: admin-foundationの`executeLocalD1`(文字列は`sqlStringLiteral`)で指定した利用者の受信設定とトークンの種の行を作り、注入された`HASH_PEPPER`で`security/010`の方式どおりトークンを導出する補助を作る
  - 画面の操作の手順は`e2e/client/notification-steps.ts`・`e2e/admin/notification-sender-steps.ts`に置き、テストのファイルから使う(`e2e`の規約)
  - `e2e/client/notifications.e2e.test.ts`: `e2e/client/profile-steps.ts`の`registerVerifiedAccount`(identity-authの`e2e/support/mailpit.ts`を使う)で確認済みの利用者を登録し(メールアドレスのドメインは`.example`)、通知設定で4つが受信しない設定であること、2つを切り替えて再読み込みで保たれることを確かめる。補助で勝敗結果のトークンを作り`/unsubscribe#token=<トークン>`の確認で停止されること、受賞結果のトークンでeventの`POST /unsubscribe?token=<トークン>`が200を返し、通知設定にどちらも受信しない設定として反映されることを確かめる
  - `e2e/admin/notification-sender.e2e.test.ts`: admin-foundationの`e2e/support/admin-bootstrap.ts`で最上位管理者としてログインし、`/settings`の送信者情報の区画で3項目を保存し、監査ログの画面に「通知メールの送信者情報の変更」が載ることを確かめる
  - 完了状態: ローカルでE2Eテストが成功する
  - _Depends: 5.9, 6.2, 6.3, 7.1_
  - _Requirements: 15.3_

- [ ] 9.2 全体の検査とカバレッジを確かめ、運用の事項を報告する
  - 整形の検査・静的解析・型検査と、単体テスト・Workers統合テスト・ブラウザテストを一括で実行し、本specが追加・変更したファイルのカバレッジが80%以上であることを確かめる。ログ・Sentryへの送信・メッセージの本文にメールアドレス・ニックネーム・プロダクト名・トークン・送信者情報の値が含まれないことを検索で確かめる
  - eventの`EVENT_SITE_ORIGIN`とIP制限の除外が`wrangler deploy`で反映される旨、staging・prodで送信者情報を設定するまで通知メールが送られない旨(仮3)、stagingで受信した通知メールの`List-Unsubscribe`・`List-Unsubscribe-Post`がDKIMの署名の対象かを開発者が確かめる旨、roadmapの帯の割り当ての表の本specの「使用中の値」(4:21は1300、波及処理は1300)が記載済みであること、tournament-week・tournament-yearが送り出しの前提の登録口に名前を登録して毎日の23:45のジョブの最後に送り出しの入口を呼ぶまでは、前提が空のため本specのジョブの時点で送り出す旨を作業の報告に記録する
  - 完了状態: すべての検査とテストが成功し、カバレッジの結果が閾値を満たし、報告に運用の事項が載っている
  - _Requirements: 14.4, 15.1, 15.2_

## Implementation Notes

- 1.1: テーブルは`apps/db/schema/notifications/`(`notification_preferences`・`notification_unsubscribe_tokens`・`notification_sender_settings`・`notification_events`・`notification_slots`・`notification_slot_ready_marks`・`notification_notices`(16列))。マイグレーションは`20261114141428_notifications`(生成)・`20261114141436_notifications_seed`。送信者情報のシードは固定のID`01M7BNN5000000000000000001`・設定のキー`'sender-info'`・作成日時1794614400000(2026-11-14T00:00Z)・版0・3項目NULL(G-3の(A))。版0から1へ進める更新は3項目を同じ文で埋めないとCHECKに阻まれる。DBの通知種別の写しは`notification-preferences.ts`の非公開の`NOTIFICATION_TOPICS`の1箇所で、他のテーブルは`notificationPreferences.topic.enumValues`を使い回す。既定値は`notification_events`の`status='pending'`・`dispatch_count=1`、`notification_slots`の`phase='waiting'`、`notification_notices`の`status='pending'`。設計のCHECKの一覧に無い`enabled in (0, 1)`を前例に倣って加えた。共有は`apps/common-lib/notifications/notification-topics.ts`(`NOTIFICATION_TOPICS`・`NotificationTopic`・`NOTIFICATION_TOPIC_COPY`)・`sender-info-input-rules.ts`(`SENDER_INFO_MAX_GRAPHEMES`・`SenderInfoInput`・`SenderInfoViolation`・`checkSenderInfoLengths`。前後の空白を除いて判定し、メールアドレスの形式は判定しない)・`admin/audit-actions/notifications.ts`(`notification-sender.update`)。design.mdのDomain Modelのmermaidが旧名`NOTIFICATION_SLOT_READINESS`のまま(実装は物理データモデルどおり`notification_slot_ready_marks`)。Workers統合テストは制約の確かめとして実装の後に書いた。レビューの任意の指摘: 利用者の物理削除を外部キーが止めることは受信設定でしか統合テストしていない(種と通知は単体テストのSQL照合で担保)
- 1.3: 照合のテスト`config/notification-contract-copies.unit.test.ts`をルートの`check:contract-copies`へ加え、その文字列を完全一致で確かめる`scripts/tooling/run-all.unit.test.ts`も前例(help-center)どおり直した。照合はDB側の定数`NOTIFICATION_TOPICS`の初期化子を読む(CHECKの条件そのものではない。CHECKは同じ定数を参照し、SQLは`notifications-migration.unit.test.ts`が確かめる)。2.2で`AWARD_KINDS`・`NOTIFICATION_EVENT_TYPES`の共有の定数を作るときは、`apps/db/schema/notifications/notification-events.ts`の写しの照合を同じテストへ足すかを判断する
- 1.2: 後続の文言は設計のSupporting Referencesではなく文言規則(`docs/GUIDES/service/design/003-text-and-copy-rules.md`の「通知の画面の文言」「件名」「本文の構成」「通知メールの本文」)に従う。設計の空白を埋めた決定: 敗北・両者敗北・不戦勝の結果の文も勝利と同じく末尾に「(<マッチの表記>)」を付ける(設計の表には無い)、統合の翌日の予告の文は「明日は<ラウンド名>です。<相手のプロダクト>と対戦します。」で`next.matchLabel`は本文に使わない、フォロー中の利用者のマッチの開催通知の冒頭「フォローしているユーザーのプロダクトのマッチが始まりました。」、`defineEmailTemplate`が`preview`を必須とするため4種別のプレビュー文を定義、「通知設定を変更する」のリンクは本文の末尾。送信者情報の欄名は「事業者名(必須)」「連絡先メールアドレス(必須)」「物理的郵送先住所(必須)」、検証は前後の空白を除いた値で未入力「<項目>を入力してください。」→超過「<項目>は200文字以内で入力してください。」→形式「メールアドレスの形式が正しくありません。」の順で最初の1つ、参照だけの案内は既存の前例に合わせて句点ありの「最上位管理者だけが変更できます。」(要件11.3・設計は句点無し)、確認のダイアログは題「通知メールの送信者情報を保存しますか?」・確定「保存する」、競合はUltrasと同じ文言、変更者の「なし」は削除済み・停止中・招待中の管理者すべて(G-14)。配信停止ページは照会で結果が無い場合も確定の`invalid_link`も同じ無効の文言、失敗のボタン「再試行」、抑止の導線「メールアドレスを変更する」(`/settings/account`)。G-26の水平展開で、5つのトランザクションメールの本文の構成も「宛名・本文・ボタン・送信者情報の順」に改めた。設定のナビゲーションの「登録済みの項目」に「通知」を6.2より先に書いた(6.2で実装と一致させる)。プライバシーポリシーの法的根拠は「同意」へ移し法務レビューの要を注記(G-28)。範囲外の食い違い: `.kiro/specs/notifications/brief.md:29`が旧URL`/unsubscribe/{token}`のまま、design.mdのSupporting Referencesの敗北・両者敗北・不戦勝の本文に「(<マッチの表記>)」が無い、`002-page-layouts.md`の管理メニューの注記が「設定」を欠く(先行specの由来)
- 2.1: 規則は`apps/backend-lib/core/notifications/notification-slots.ts`(`eveningSlot`・`morningSlot`・`awardSlot`・`previewSlotFor`・`resultSlotFor`・`parseSlotKey`・`EVENING_DISPATCH_DEADLINE_SECONDS`(600)・`MORNING_KICKOFF_WAIT_SECONDS`(300)など)と`notice-plan.ts`(`matchNoticeDrafts`・`noticeDedupeKey`・`groupKeyFor`・`planGroupEmail`・`DIGEST_ITEM_LIMIT`(30)など)。backend-libの単体テストはapiの`test:unit`が`lib/`で実行する。設計との食い違い: `parseSlotKey`は設計の`NotificationSlot | undefined`ではなく`ParsedSlotKey`(夜・朝は`{key, kind, date}`、受賞は`{key, kind: 'award', eventId}`)を返す(受賞の枠の期日はキーから求められないため。design.mdのContractsの宣言は未修正)。同じまとめのキーに計画に載らない受信する種別の通知が重なった場合(2件目以降)を`stale`で送らない扱いにした(設計は未定義。DBのCHECKで理由を増やせないため既存の値を使い、要件3.6の「開始済み・決着済み」と意味が混ざる。同じ業務日付に1つのプロダクトが2つのマッチへ出ない限り起きない)。**5.4〜5.7への申し送り**: 開催通知の31件目以降は`plan.items`にも`skipped`にも入らないため、送信の確定は「同じまとめのキーの未送信の通知から、`planGroupEmail`の`skipped`とメールの組み立てが除いた通知を引いた残りを`sent`にする」形にする(載った通知だけを`sent`にすると31件目以降が遅れた通知として再送される)。**3.3への申し送り**: `items`は入力の順の先頭30件を取るため、まとめのキーごとの未送信の通知は作成の順(IDのULID順)で返す。**2.2への申し送り**: `awardSlot`・`parseSlotKey`のULIDの判定は大文字だけ(`/^[0-9A-HJKMNP-TV-Z]{26}$/u`)で、`z.ulid()`は小文字も受け付ける。`matchNoticeDrafts`の`eventId`は常にnull(重複のキーはマッチのIDから作るため収集と展開で同じキーになる)。前日の業務日付はapiの`addBusinessDays`がcoreから読めないためファイル内の非公開の関数で求めた
- 2.2: 契約は`apps/backend-lib/core/notifications/`の`notification-event-contract.ts`(`NotificationEventPublisher`・`parseNotificationPublishRequest`・`notificationEventDedupeKey`・`NOTIFICATION_PUBLISH_EVENT_LIMIT`(50)など)・`evening-dispatch.ts`(`EveningDispatchGate`・`EveningSlotOpener`・`assertEveningDispatchParticipants`・`parseEveningDispatchReadyInput`。判定は`unknown-participant`→`invalid-date`の順で、4.6はこの順を使う)・`result-notice-supplements.ts`(`createResultNoticeSupplementRegistry`・`resultNoticeSupplementSchema`。`createLifecycleRegistry`の包み)・`unsubscribe-token.ts`(`UNSUBSCRIBE_TOKEN_PURPOSE`・`UNSUBSCRIBE_LOOKUP_PURPOSE`(`HashPurpose`型)・`UNSUBSCRIBE_SEED_BYTES`(32)・`unsubscribeTokenSource`・`isWellFormedUnsubscribeToken`・`unsubscribePageUrl`・`oneClickUnsubscribeUrl`・`listUnsubscribeHeaders`。URLの関数は形式違反のトークンで`RangeError`)・`ports.ts`(設計のポートの節と同じ形、インラインの型に`SlotProgress`・`NoticeRecordResult`・`NoticeSettlement`・`NotificationEventExpansion`の名前)・`identifiers.ts`(`NOTIFICATIONS_PLATFORM_TYPES`の13種)。メッセージは`core/messaging/contracts/notifications.ts`(`FLUSH_NOTIFICATION_SLOT_MESSAGE`・`EXPAND_NOTIFICATION_EVENT_MESSAGE`・`NOTIFICATION_RETRY_POLICY`(5・60・1800)・`NOTIFICATION_CONTINUE_DELAY_SECONDS`(1))を`MESSAGE_CONTRACTS`へ加えた。ULIDの判定は大文字だけ(`/^[0-9A-HJKMNP-TV-Z]{26}$/u`)に揃えた(同じ正規表現が4ファイルに別々にある。共通化は任意)。DBの`NOTIFICATION_EVENT_TYPES`・`AWARD_KINDS`の写しの照合を`config/notification-contract-copies.unit.test.ts`へ加えた。設計との食い違い(design.mdは未修正): `EVENING_DISPATCH_PARTICIPANT_PATTERN`はエクスポートせず前提と追記の名前を`assertLifecycleHandlerName`(013の規約)で判定、発行元の名前は設計の`/^[a-z0-9-]+$/`より厳しい`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u`(トーナメントのspecの名前と値はすべて通ることを確認済み)。3.2への申し送り: 種はパディング無しのbase64url(`toBase64({ alphabet: 'base64url', omitPadding: true })`)で符号化しないと`unsubscribeTokenSource`が例外を投げる
- 2.3: 規則は`apps/backend-lib/core/notifications/notice-copy.ts`(`resultOutcomeOf`・`roundName`・`matchLabel`・`matchPreviewSubject`・`matchResultSubject`・`followedMatchesSubject(載せる項目の名前, 全件数)`・`awardSubject`・`awardPeriodLabel`・`UNAVAILABLE_PRODUCT_NAME`・`COMBINED_UNSUBSCRIBE_LABELS`(`NOTIFICATION_TOPIC_COPY`の名称から作る)・`suppressionReasonOf`・`NoticeSuppressionReason`)。単体テストは文言規則のファイルを実行時に読んで件名・表記・期間の例と完全一致を確かめる(backend-libは元と写し先で深さが違うため`import.meta.dir`から上へ探す。backend-libで初めての方式)。統合の件名はスコアを含めない(要件4.4と文言規則の例)、両者敗北の件名は固定の「(0対0)」、件数と票数は`Intl.NumberFormat('ja-JP')`で区切る、賞の期間はISO週の年で「2026年第53週(12/28〜1/3)」の形。**2.4への申し送り**: (a)`matchLabel`・`roundName`はトーナメントでラウンドが無いと`RangeError`を投げる(clientの前例は「Week」だけを返す。トーナメントのspecは必ずラウンドを渡す)ため、壊れた1項目が開催通知や統合のメールの全体を失敗させる、(b)`roundName`は次のマッチが予選(ラウンドも段も無い)でも投げるため、`nextRoundName`は次のマッチがトーナメントのときだけ作る、(c)敗北・両者敗北の結果に`nextRoundName`を渡すと投げるため、統合できるのは勝利と不戦勝だけ。本文の文は本タスクに入れていない(2.4・5.2・5.3)。設計との小さな食い違い(design.md未修正): `COMBINED_UNSUBSCRIBE_LABELS`の型が`Record`、戻り値と入力の型に名前を付けた。`UNAVAILABLE_PRODUCT_NAME`・トーナメントと段の名前はclientの`match-labels.ts`と重複する(値の型が違うため共通化は任意)
