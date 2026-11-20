# Implementation Plan

- [x] 1. 基盤: 措置の規則・措置の記録のテーブル・監査ログの操作種別・メール・サービス仕様
- [x] 1.1 措置の規則と表示名の共有定義を作る
  - 前提: dev-tooling〜public-apiの25specの全タスクと、上流の改訂(identity-authの仮7(identity-authのタスク3.7)の`AdminUserDirectory`、product-launchの仮13(product-launchのタスク2.6)の`AdminProductDirectory`、engagementの仮6(engagementのタスク2.7、識別子はタスク2.1)の`AdminCommentDirectory`・`AdminRatingDirectory`、paymentsの仮7(paymentsのタスク5.5・5.7)の`PaymentRevenueReport`、backend-platformの改訂2のE2Eの`e2e/support/scheduled-trigger.ts`の`triggerScheduled`)が完了していること(admin-foundationの`requireAdmin`・`AuditLogRecorder`・`buildAuditLogStatements`・`AUDIT_ACTIONS`・`ADMIN_NAV_ITEMS`・`DASHBOARD_CARDS`・`DashboardCardFrame`・管理画面の共通部品・E2Eの`admin-bootstrap.ts`・`local-d1.ts`、identity-authの`UserSuspension`・`AdministrativeWithdrawal`・ライフサイクルの同期と非同期の登録口・`UserContactDirectory`・E2Eの`mailpit.ts`、product-launchの`ProductVisibilityControl`・ライフサイクルの登録口・`ProductDirectory`・`ProductCategoryDirectory`、engagementの`CommentModerationControl`・`RatingModerationControl`・`CommentStore`・`RatingStore`、media-pipelineの`MediaQuarantine`・`MediaFiles`・`AdminMediaReviewPolicy`の束縛の置き場所・`/_bff/files/*`の中継、user-profile-socialの`UserProfileDirectory`と停止の画像の隔離の処理、match-engineの`MatchDirectory`、directory-discoveryのE2Eの`directory-fixtures.ts`、email-deliveryのメールの基盤)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、単体テストで、13種の措置の対象の種類・理由の要否(画像の4つの操作だけ任意、停止・停止解除・代理の退会・非公開化・復元・コメントの非公開化と復元・無効化・無効化の取り消しは必須)・通知の要否(停止・非公開化・コメントの非公開化だけ依頼待ちで送り、代理の退会を含む他は送らない)・対応するライフサイクルの種類、理由の検証(空白だけ・500書記素と501書記素・画像の操作の理由の省略)、隔離理由と使い捨て判定の表示名が写した値の一覧を網羅することを確かめる
  - 上流の値(隔離理由・使い捨て判定・ローンチ状態・コメントの状態)は共有定義に写しとして持つ。common-libのテストは上流の`backend-lib/core`を読めないため、写しと上流の値の一致はルートの`config/ugc-moderation-contract-copies.unit.test.ts`で、ソースを読んで確かめる(`config/sponsorship-contract-copies.unit.test.ts`と同じ方式。ローンチ状態とコメントの状態の照合は4.2・4.3がこのファイルに加える)
  - 完了状態: 単体テストと写しの照合のテストが成功し、共有定義が他の層を読み込まない
  - _Requirements: 4.9, 5.7, 5.9, 8.9, 9.10, 10.9, 12.9, 16.2_

- [x] 1.2 措置の記録のテーブルとマイグレーションを作る
  - DBのテーブル定義は`drizzle-orm`・`ulid`と自身のファイルだけを読み込むため、1.1の措置の種類・対象の種類・通知の状態の値は写しとして持ち、CHECKは`inArray(...).inlineParams()`で値を埋め込む。写しと1.1の値の一致を`config/ugc-moderation-contract-copies.unit.test.ts`に加える。週ごとの統計のテーブルは統計の群(7.2)が別のマイグレーションで作る
  - 先に、テーブルの定義の単体テストで、措置の種類・対象の種類・通知の状態(送らない・依頼待ち・依頼済み・送らなかった)の値の制約、索引、他のspecのID(利用者・プロダクト・コメント・評価・画像・管理者・イベント)に外部キーが無いことを確かめる
  - 同じく先に、マイグレーションの文とテーブル定義の照合(`schema/moderation/moderation-migration.unit.test.ts`)と、実際のD1での制約の検証(`apps/db/ugc-moderation-schema.worker.test.ts`)を書き、`schema/index.unit.test.ts`のテーブル名の一覧に加える
  - mainの最新を取り込んでからマイグレーションを生成し、ローカルに適用する
  - 完了状態: 単体テスト・Workers統合テスト・写しの照合のテストが成功し、マイグレーションをローカルのD1に適用できる
  - _Requirements: 13.5_

- [x] 1.3 (P) 措置の監査ログの操作種別を加える
  - 先に、単体テストで、13種の名前(1.1の措置の種類と同じ)・表示名・対象の種類・理由の要否・詳細の鍵(すべて空)・対象の上限1と、全操作種別の集約の重複の検査を確かめる
  - 本specの操作種別のファイルを作り、監査ログの操作種別の集約へ加える。集約の単体テスト(`audit-actions/index.unit.test.ts`)が全種別の名前を完全一致で列挙しているため、その期待値に13種を加える
  - 完了状態: 単体テストが成功し、集約の検査を通る
  - _Boundary: ModerationAuditActions_
  - _Depends: 1.1_
  - _Requirements: 11.13, 13.1, 13.2_

- [x] 1.4 (P) 措置の通知の3つのメール種別とテンプレートを作る
  - 先に、単体テストで、入力のスキーマ(日時・URL・抜粋の上限は1.1の定数)、件名、停止の本文の固定の段落(表示されなくなること・マッチ予定の取り消し・Ultrasは期間末に解約し返金しないこと・広告の段落・トーナメントの組み合わせ決定の時点の自動返金・問い合わせで退会を依頼できること)、非公開化の段落(未開始のマッチ予定の取り消し・広告の段落・トーナメントの組み合わせ決定の時点で非公開化中なら参加費が自動で全額返金されること)、理由の改行を保ったプレーンテキストの差し込み(HTMLとして解釈しない)、日時のUTCの表記、問い合わせへのボタン、配信停止のリンクが無いこと、代理の退会のメール種別が無いことを確かめる
  - 広告の段落は、sponsorshipが文言規則へ載せる次の文と一字一句同じにし、単体テストで本文に完全に一致する文字列として含まれることを確かめる
    - 停止(`ugc-moderation.user-suspended`): 「停止中は、あなたのスポンサー広告は表示されません。掲載期間は延長されませんが、表示を停止した日数分(1日のうち一部でも停止した日を含みます)の広告料金を、各広告の掲載期間が終わった時点で日割りにより自動で返金します。掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。」
    - プロダクトの非公開化(`ugc-moderation.product-hidden`): 「このプロダクトのスポンサー広告は、公開を停止している間は表示されません。掲載期間は延長されませんが、表示を停止した日数分(1日のうち一部でも停止した日を含みます)の広告料金を、広告の掲載期間が終わった時点で日割りにより自動で返金します。掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。」
  - メール種別の集約とテンプレートの集約へ同じタスクで対に加える(片方だけだとテンプレートの集約のWorkers統合テストが落ちる)
  - 完了状態: 単体テストと、種別とテンプレートの1対1の検査が成功する
  - _Boundary: ModerationEmailKinds, ModerationEmailTemplates_
  - _Depends: 1.1_
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [x] 1.5 (P) ページ配置・文言規則・準拠方針・日次タイムラインとモデレーションの運用の文書に、措置の群の決定を先に書く
  - ページ配置: 管理者側のユーザー・プロダクト(一覧と詳細)・コメント・評価・画像モデレーションのページの構成、ユーザー一覧の代理の退会の操作(最上位管理者だけ)と、メニューごとの必要なロールの一覧の代理の退会の行(仮4)
  - 文言規則: 設計のSupporting Referencesに挙げたエラー・確認・成功・状態の文言(統計のカードの文言を除く)と、代理の退会の確認の注記(仮4・仮5)
  - 準拠方針: データ保持期間に措置の記録、モデレーションと透明性に代理の退会(最上位管理者がユーザー一覧から行い、本人の意思の確かめと完了の知らせは運営者がシステムの外のメールで行う)
  - 日次タイムライン: 4:21の表に`ugc-moderation.maintenance`(1910)
  - ページ配置の5つのメニュー・代理の退会の行・カードの順序10は記載済みのため、状態の記述を改め、「…10項目は実装済み」の件数を本specの5件を足した数に直す
  - `features/006-content-moderation.md`: 措置の種類と波及の分担、通知の内容と返金の扱い(仮8、広告の日割り返金はsponsorshipの仮3)、代理の退会の手順(仮4・仮5)、画像の操作と隔離理由、措置の取り消しの理由の必須(仮9)。仮1〜仮9が2026-10-24に開発者により全て確定した旨を添える
  - 統計の群の決定(統計のカード・統計の定義・`ugc-moderation.weekly-statistics`・週ごとの統計の保持期間)は7.1が書く
  - 完了状態: 5つの文書が整形の検査を通り、6のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service`の該当する5文書_
  - _Requirements: 16.6_

- [x] 2. 措置の記録の一体の確定と通知
- [x] 2.1 措置の記録のストアを作り、両アプリに束縛する
  - 先に、Workers統合テストで、記録の挿入の文、対象ごとの指定した種類の最新の1件、1時間以上前の依頼待ちの古い順、依頼待ちからの条件付きの状態の更新(2回目は変わらない)、利用者・プロダクト単位の削除と残りの有無、保持期間の削除を確かめる
  - 同じく先に、識別子`MODERATION_PLATFORM_TYPES`が`Symbol.for('moderation.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - 文を返さない契約(`NewModerationRecord`・`ModerationRecord`・`LatestModeration`・`ModerationRecordStore`)を純粋な部品(`apps/backend-lib/core/moderation/ports.ts`)に、識別子`MODERATION_PLATFORM_TYPES`を`core/moderation/identifiers.ts`に作る。記録の挿入の文を返す`ModerationRecordStatements`(apiのinfrastructure層だけが使う)とD1の実装`D1ModerationRecordStore`・束縛のモジュールは共有のWorkers向けの部品(`apps/backend-lib/workers/moderation`)に作る。api・eventのapplication層が契約と識別子を読み込むため、契約と識別子を`workers`に置かない
  - 本specのプラットフォームモジュールをapi・eventの登録箇所へ加える
  - 完了状態: 単体テストとWorkers統合テストが成功し、api・eventの両方でストアを解決できる。`core/moderation`が`workers`・`apps/db`を読み込まない
  - _Requirements: 12.7, 12.8, 13.5, 13.6, 13.7_

- [x] 2.2 apiの識別子・ポート・保留中の措置・理由の検証を作る
  - 設計の措置の群の全てのユースケース・照会・保守のジョブ・書き込みの単位のポート(`ImageModerationWriter`・`EngagementModerationWriter`)・定型の通知のポート(`ModerationIncidentReporter`。application層は`@sentry/*`を読めないため)とinfrastructure層の記録と監査ログの文の組み立て(`D1ModerationStatements`)・保留中の措置・2つの同期の処理のDIの識別子と、措置の入力と結果の型(値だけの参加`ModerationWriteParticipation`を含む)・書き込みの単位のポートと、2.3の参加者の解決の部品のDIの識別子を先に作る。application層のポートは文を返さず接続を受け取らない(呼び出し側の参加`participation`は種類と値だけで、中身を読まずに渡すだけ)。以後の3・4のタスクは本specのapiの識別子のファイルと登録箇所を変えない(登録は2.3と4.6だけが行う。統計の群の識別子とポートは7.4、その束縛と登録は7.6が加える)
  - apiの識別子は`Symbol.for('moderation.api.<名前>')`にして凍結する(`Symbol.for`は全体で共有されるため、`core/moderation`の`moderation.<名前>`・eventの`moderation.event.<名前>`と分ける)。ユースケースが投げるエラーのコード・種類・文言は`application/moderation/moderation-errors.ts`に置く(表現層はこれを参照する)
  - 先に、単体テストで、識別子の値と凍結、エラーのコード・種類・文言、保留中の措置を1つの要求に1件だけ置けること、種類と対象が一致したときだけ取り出して空になること、取り出しの有無、破棄、理由の正規化(前後の空白)と要否・上限の検証の結果を確かめる
  - 完了状態: 単体テストが成功し、型検査が通り、静的解析でapplication層に`**/lib/workers/**`の読み込みが無く、検索でapplication層に`BatchItem`の読み込みが無い(措置の記録の契約と識別子は`core/moderation`から読み込む)
  - _Requirements: 4.9, 13.4, 15.7_

- [x] 2.3 記録と監査ログの文、利用者とプロダクトの同期の処理を作り、apiのモジュールの骨格に束縛して登録する
  - apiの本specのモジュールを作り、保留中の措置(処理単位のコンテナの既定は`Transient`のため`inSingletonScope()`で束縛し、処理単位で1つにする)・定型の通知の実装(`SentryModerationIncidentReporter`。`captureEvent`の`logentry`・`fingerprint`・タグを単体テストで確かめる)・記録と監査ログの文の組み立て(`D1ModerationStatements`。2.1の`ModerationRecordStatements`と`buildAuditLogStatements`を使う)・書き込みの単位の実装(`ControlEngagementModerationWriter`。画像の`ControlImageModerationWriter`は2.5)・2つの同期の処理をinfrastructure層に作って束縛し、apiの登録箇所へ加え、利用者とプロダクトの同期の処理の登録口へ`handler`(2.2の同期の処理の識別子)付きで追記する
  - 書き込みの参加者の登録口を作る: 文を返す参加者の契約・登録の型・解決の部品`createModerationWriteParticipants`をinfrastructure層(`infrastructure/moderation/moderation-write-participant.ts`)に、登録の一覧`MODERATION_WRITE_PARTICIPANTS`(初版は空)をapiの`composition/moderation-write-participants.ts`に作り、解決の部品を処理単位で束縛する。同期の処理と`ControlEngagementModerationWriter`は、`participation`の種類で参加者を解決し、記録のIDを`context.actionId`として渡して、その文を記録と監査ログの文の後に並べる
  - 先に、単体テストで、解決の部品が種類の形式違反と重複で例外を投げること、`participation`が無いときに参加者を解決せず空を返すこと、登録の無い種類の内部エラー、登録した参加者へ値と`context`をそのまま渡すこと、登録の一覧の種類の形式と重複の検査を確かめる
  - 先に、Workers統合テストで、`ControlEngagementModerationWriter`がengagementの本物のコメントの非公開化・復元と評価の無効化・取り消しの操作口へ記録・監査ログ・参加者の文を渡し、状態の変更と同じ一括の書き込みで確定すること、上流の`unchanged`で記録・監査ログ・参加者の文が残らないことを確かめる
  - 先に、Workers統合テストで、テストの中で登録した試験用の参加者を使い、同期の処理の経路(停止・プロダクトの非公開化)と`ControlEngagementModerationWriter`の経路(コメントの非公開化・評価の無効化)のそれぞれで、参加者の文が同じ一括の書き込みで確定し`context.actionId`が記録のIDと一致すること、参加者の文の違反(NOT NULL制約)で上流の状態・イベント・記録・監査ログを含む全体が取り消されること、登録の無い種類で内部エラーになり何も書かれないことを確かめる
  - 先に、Workers統合テストで、本物の停止・停止解除・代理の退会とプロダクトの非公開化・復元の確定を通して、保留中の措置がある要求では措置の記録(イベントのIDと日時)・監査ログ・参加者の文が状態の変更と同じ一括の書き込みで確定すること、版の競合・既に同じ状態では何も残らないこと、利用者本人の退会では記録が作られないこと、記録と監査ログにメールアドレス・検索文字列・パスワードなどの秘密情報が入らないことを確かめる
  - 同期の処理が処理単位のコンテナから解決されることを確かめ、解決されない場合は作業を止めて開発者へ報告する(代替案は上流の操作口への文の引数の追加)
  - 完了状態: Workers統合テストが成功し、登録口の検査を通る(参加者の登録の一覧の検査を含む)。application層に`**/lib/workers/**`・`BatchItem`の読み込みが無い
  - _Requirements: 4.4, 5.8, 8.4, 9.8, 10.6, 13.4, 13.8, 15.7_

- [x] 2.4 措置の通知を作る
  - 先に、単体テストで、停止・非公開化・コメントの非公開化のそれぞれの入力(名称・抜粋の100書記素・理由・日時)、宛先が無いときの送らない記録、送信の成功の後だけ依頼済みにすること、依頼待ちでない記録(代理の退会などの送らない記録を含む)を送らないこと、送信の失敗で依頼待ちのまま例外を投げること、停止中の利用者にも送ること、問い合わせの導線が`<CLIENT_SITE_ORIGIN>/contact`であることを確かめる
  - 問い合わせの経路の共通の定数は無いため、identity-authの`email-identity-mailer.ts`と同じく通知の部品の中の定数で組み立てる。送信の依頼に冪等のキーが無いため、依頼済みへの更新は送信の直後の1文の条件付きの更新にする(更新だけが失敗したときに送り直しで2回目の依頼になり得ることはresearch.mdのRisksに記録した)
  - 完了状態: 単体テストが成功する
  - _Requirements: 12.1, 12.2, 12.3, 12.6, 12.7, 12.8, 12.10_

- [x] 2.5 画像の隔離理由の変更と呼び出し側の文を一体で確定する媒体の操作口と、画像の書き込みの単位を作る
  - media-pipelineの共有のWorkers向けの部品(`apps/backend-lib/workers/media/media-moderation-control.ts`)に、呼び出し側の文を受け取る`MediaModerationControl`(契約とD1の実装)を加え、識別子`MEDIA_TYPES.MediaModerationControl`を`core/media/identifiers.ts`に、束縛を`workers/media/media-platform-module.ts`に加える。既存の`MediaQuarantine`・`MediaFiles`の形と振る舞いは変えない(2026-11-20に開発者が決定したG1)
  - 先に、Workers統合テストで、理由の追加・削除と削除待ちの印が呼び出し側の文と同じ一括の書き込みで確定すること、既に目的の状態では文を書かず`unchanged`を返すこと、同時の操作で状態の変更が効かなければ呼び出し側の文ごと取り消されること、対象が無い・削除待ちの`not-found`(削除待ちへの`requestErase`は`unchanged`)、画像用でない用途の`quarantine_not_applicable`、確定の後(`unchanged`を含む)に保存先が食い違えば移動を依頼すること、移動の依頼と即時の削除の失敗で`storage_unavailable`を投げつつ状態と文が残ることを確かめる
  - 同じく先に、識別子の単体テスト(`core/media/identifiers.unit.test.ts`)と、media-platformのモジュールのWorkers統合テストに新しい識別子の解決を加える
  - apiのinfrastructure層に`ControlImageModerationWriter`(記録と監査ログの文を`MediaModerationControl`へ渡す)を作り、2.3のapiの本specのモジュールへ束縛する。Workers統合テストで、本物の操作口を通して記録と監査ログが理由の変更・削除待ちの印と一体で確定し、`unchanged`で残らないことを確かめる
  - 完了状態: 単体テストとWorkers統合テストが成功し、`MediaQuarantine`・`MediaFiles`の既存のテストが変更なしで通る。application層に`**/lib/workers/**`・`BatchItem`の読み込みが無い
  - _Boundary: MediaModerationControl, ControlImageModerationWriter_
  - _Depends: 2.3_
  - _Requirements: 11.6, 11.7, 11.9, 11.11, 11.13, 13.4_

- [ ] 3. 措置のユースケース(本specの識別子のファイルと登録箇所を変えない。3.7はmedia-pipelineの束縛の置き場所だけを変える)
- [x] 3.1 利用者の停止と停止解除を作る
  - 対象の確かめにはidentity-authの仮7の利用者の管理の照会を使う
  - 先に、単体テストで、停止と停止解除の理由の必須と上限、退会済み・不在の拒否、既に同じ状態での変化なし(記録なし)、監査ログの対象が仮名化IDであること、保留中の措置を置いてから停止の操作口を呼ぶこと、変化なしでの保留の破棄、取り出し漏れのエラートラッキングへの通知、ログに識別子と件数だけを出しメールアドレス・ハンドル・ニックネーム・理由を出さないこと、競合の返却、一覧の読み取りの後に退会が重なったときの上流の`not_found`を`user_not_found`へ変えること、取り出し漏れを定型の通知のポート(`ModerationIncidentReporter`)へ送ること、停止の通知の依頼(例外を握る)と停止解除で通知しないこと、呼び出し側の参加の値(`participation`)を中身を読まずに保留中の措置へ渡すこと、結果の措置の記録のIDが保留中の措置の記録のIDであることを確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 4.2, 4.3, 4.5, 4.6, 4.7, 4.8, 4.11, 15.1, 15.4, 15.7_

- [x] 3.2 (P) プロダクトの非公開化と復元を作る
  - 先に、単体テストで、非公開化と復元の理由の必須と上限、論理削除済み・不在の拒否、既に同じ状態の変化なし、記録の投稿者とプロダクト、保留中の措置と非公開化の操作口、呼び出し側の参加の値(`participation`)の受け渡し、非公開化だけの通知の依頼を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: ProductModerationService_
  - _Depends: 2.2, 2.4_
  - _Requirements: 8.2, 8.3, 8.5, 8.6, 8.7, 8.8, 8.9, 15.7_

- [x] 3.3 (P) コメントの非公開化と復元を作る
  - 先に、単体テストで、非公開化と復元の理由の必須と上限、不在の拒否、既に同じ状態と上流の変化なしでの変化なし、書き込みの単位のポート(`EngagementModerationWriter`)への記録と監査ログと呼び出し側の参加の値(`participation`)の受け渡し、非公開化だけの通知の依頼を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: CommentModerationService_
  - _Depends: 2.2, 2.4_
  - _Requirements: 9.6, 9.7, 9.8, 9.9, 9.10_

- [x] 3.4 (P) 評価の無効化と取り消しを作る
  - 対象の確かめにはengagementの仮6の評価の管理の照会(engagementのタスク2.7)を使う
  - 先に、単体テストで、無効化と取り消しの理由の必須と上限、不在(取消済みを含む)の拒否、既に同じ状態と上流の変化なしでの変化なし、書き込みの単位のポート(`EngagementModerationWriter`)への記録と監査ログと呼び出し側の参加の値(`participation`)の受け渡し、通知しないことを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: RatingModerationService_
  - _Depends: 2.2_
  - _Requirements: 10.4, 10.5, 10.6, 10.7, 10.8, 10.9_

- [x] 3.5 (P) 画像の公開承認・個別の隔離・隔離の解除・削除を作る
  - 先に、単体テストで、画像用の用途でない・記録が無いときの`image_not_found`、削除待ちのファイルへの削除が変化なしで他の操作が`image_not_found`になること、公開承認は自動判定の理由、隔離の解除は管理者操作の理由、削除は隔離画像を求めること(満たさなければ`image_action_not_applicable`)、個別の隔離は既に持つときも書き込みの単位を呼び変化なしを返すこと、非公開化・ユーザー停止の理由を外さないこと、任意の理由の上限、書き込みの単位のポート(`ImageModerationWriter`)へ記録と監査ログを渡すこと、その結果の`unchanged`・`not-found`の変換、`storage_unavailable`をそのまま返すこと、参加の値が付いた呼び出しを上流を呼ばずに内部エラーにすること、通知しないことを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: ImageModerationService_
  - _Depends: 2.2_
  - _Requirements: 11.6, 11.7, 11.9, 11.11, 11.12, 11.13, 11.14, 11.15_

- [x] 3.6 運営者による代理の退会を作る
  - 対象の確かめにはidentity-authの仮7の利用者の管理の照会を使う。問い合わせは読まない
  - 先に、単体テストで、理由の必須と上限、退会済み・不在の`user_not_found`、停止中の利用者の受け付け、監査ログの対象が仮名化IDで詳細を持たないこと、記録の通知の状態が送らないであること、メールを送らないこと、競合の返却を確かめる
  - 先に、Workers統合テストで、本物の退会の確定と記録・監査ログの一体の確定、メールの送信の依頼が無いことを確かめる(ユースケースはテストの中で組み立て、2.3の束縛を使う)
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - _Depends: 2.3_
  - _Requirements: 5.5, 5.6, 5.7, 5.8, 5.9, 5.11, 5.13_

- [ ] 3.7 隔離画像を閲覧できる管理者の判定を作り、束縛を差し替える
  - 先に、単体テストで、管理者の主体で有効な管理者のときだけ画像用の用途を許し、利用者の主体・削除済みの管理者・ファイル用の用途を拒否することを確かめる
  - 先に、Workers統合テストで、管理者側の内部の配信経路から隔離画像を読め、利用者側・権限の無い主体では不存在と同じ応答になることを確かめる
  - 媒体の閲覧の判定の束縛を差し替え、使われなくなる既定の全拒否(`apps/api/src/infrastructure/media/deny-all-admin-media-review-policy.ts`)と同名の単体テストを削除する(2026-11-20に開発者が決定)。全拒否を使っていた`default-file-access-policies.unit.test.ts`・`apps/api/src/presentation/media/file-content-route.worker.test.ts`は試験用の判定に置き換え、束縛の単体テスト`apps/api/test/config/media-registrations.unit.test.ts`の期待値を本specの判定に直す。`.kiro/specs/media-pipeline/design.md`の既定の全拒否の記述に、本specが差し替えて削除した旨と`MediaModerationControl`を加えた旨の注記を加える
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - _Requirements: 11.3, 11.4_

- [ ] 4. 措置の群の照会・保守のジョブ・束縛・GraphQL
- [ ] 4.1 (P) ユーザー一覧の照会を作る
  - 一覧はidentity-authの仮7の利用者の管理の照会を使う
  - 先に、単体テストで、プロフィール画像と隔離理由と停止の最新の理由のまとめた照会、メールアドレスの絞り込みで結果の仮名化ID(0件は対象なし)を検索文字列なしで記録してから返すこと、記録の失敗で結果を返さないこと、メールアドレスを返さないことを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: AdminUserReader_
  - _Depends: 2.1, 2.2_
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.9, 13.8, 15.6_

- [ ] 4.2 (P) プロダクトの一覧と詳細とカテゴリの照会を作る
  - 一覧はproduct-launchの仮13のプロダクトの管理の照会を使う
  - 先に、単体テストで、投稿者のハンドルの解決(無ければ空)、一覧の投稿者の表示名、詳細の情報・スクリーンショット・ローンチ履歴とマッチ結果と対戦相手・画像の隔離理由・評価の平均と件数・非公開化の最新の理由を各照会1回で組み立てること、論理削除済みの不在、カテゴリの選択肢を確かめる
  - 先に、1.1のローンチ状態の表示名の写しが上流の最新のローンチの状態の5値と一致することを、`config/ugc-moderation-contract-copies.unit.test.ts`に加えて確かめる
  - 上流の`listLaunches`・`listByLaunches`は`now`が必須のため、照会の時刻を渡す
  - 完了状態: 単体テストが成功する
  - _Boundary: AdminProductReader_
  - _Depends: 2.1, 2.2_
  - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 7.8, 15.6_

- [ ] 4.3 (P) コメントと評価の一覧の照会を作る
  - 一覧はengagementの仮6のコメントと評価の管理の照会(engagementのタスク2.7)を使う
  - 先に、単体テストで、投稿者・プロダクト・評価者のハンドルの解決、表示名のまとめた照会、最新の措置の理由を確かめる
  - 先に、1.1のコメントの状態の表示名の写しが上流のコメントの状態の5値(非公開化・削除・匿名化・投稿者が不可視・表示中)と一致することを、`config/ugc-moderation-contract-copies.unit.test.ts`に加えて確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: AdminCommentReader, AdminRatingReader_
  - _Depends: 2.1, 2.2_
  - _Requirements: 9.1, 9.2, 9.3, 10.1, 10.2_

- [ ] 4.4 (P) 隔離画像の照会を作る
  - 先に、単体テストで、隔離理由ごとの一覧と保有者(利用者・管理者)の表示名、保有者が`system`(IDなし)の画像で保有者が無いこと、用途と検出内容(`labels`・`svg`・`unprocessable`の3種の文字列化)、続きのカーソルを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: QuarantinedImageReader_
  - _Depends: 2.2_
  - _Requirements: 11.1, 11.2_

- [ ] 4.5 (P) 保守のジョブを作る
  - 先に、単体テストで、1時間以上前の依頼待ちの通知の送り直しと失敗の件数の定型の通知のポート(`ModerationIncidentReporter`)への送信、3年を過ぎた記録の削除の繰り返しの上限を確かめる
  - ジョブの定義(`MODERATION_MAINTENANCE_JOB_DEFINITION`)はジョブのファイルに置く
  - 先に、Workers統合テストで、送り直しが依頼済みへ1回だけ進み、2回実行しても重ならないことを確かめる(ジョブと通知はテストの中で組み立てる)
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - _Boundary: ModerationMaintenanceJob_
  - _Depends: 2.1, 2.4_
  - _Requirements: 12.8, 13.7, 15.5_

- [ ] 4.6 apiの措置の群の束縛を完成させ、保守のジョブとスキーマモジュールの型を登録する
  - 2.3のモジュールに措置の群の全てのユースケース・照会・通知・保守のジョブを束縛し、保守のジョブを定期実行の登録箇所へ加える。4:21のジョブの名前を完全一致で列挙する`apps/api/src/composition/search-module.worker.test.ts`・`search-module.reextraction.worker.test.ts`の一覧に保守のジョブを加える
  - スキーマモジュールの措置の群の型・入力の検証・エラーコードの写像・`resolver-support.ts`(`adminOnly`と、上流の`nextCursor`から`{ nodes, pageInfo }`を組み立てる部品)を作り(リゾルバは4.7・4.8、統計の型は7.6)、スキーマモジュールの登録箇所へ加える。件数は`CURSOR_PAGE_ARGS`(1〜100)を使わず1〜50の規則を`inputs.ts`に置き、`toConnection`は使わない。エラーの写像は2.2の`moderation-errors.ts`を参照する
  - スキーマを変えた後に、apiで`bun run graphql:generate`を実行して`generated/schema.graphql`・`resolvers-types.ts`を作り直し、リゾルバの表を`satisfies Resolvers`で生成した型に合わせる
  - 先に、単体テストで、`apps/api/test/config/ugc-moderation-scheduled-jobs.unit.test.ts`に保守のジョブの帯(1900番台)・前後の順・4:21の予算を確かめる(`sponsorship-scheduled-jobs.unit.test.ts`と同じ形。統計のジョブは7.6が加える)
  - 先に、Workers統合テストで、apiの要求と定期実行の経路で措置の群の全識別子が解決でき、4:21の`order`(1910)が他と重ならないことを確かめる
  - 先に、単体テストで、入力の検証(件数・検索語・メールアドレス・理由の上限・期間の順・IDの引数の大文字のULIDの形式と存在しない対象と同じ文言)とエラーコードの形、`adminOnly`が入力の検証より前に管理者側以外の呼び出しを拒否すること、接続の組み立てを確かめる
  - 本specのapiのコードが上流のテーブル定義を読み込まず、上流の操作口と照会の識別子と型だけを使うことを、静的解析の読み込みの規則または検索で確かめる
  - 完了状態: Workers統合テスト・単体テストと登録の検査が成功し、apiの`graphql:check`が通り、本specのapiのコードに上流のテーブル定義の読み込みが無く、application層に`**/lib/workers/**`・`**/infrastructure/**`・`BatchItem`・`@sentry/*`の読み込みが無い
  - _Depends: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Requirements: 15.2, 15.3_

- [ ] 4.7 利用者の照会と措置のリゾルバを作る
  - 各リゾルバを`adminOnly`で包み、`session.principal()`(`Promise`)を待ってからユースケースへ渡す
  - 先に、Workers統合テストで、照会は閲覧のみ以上・停止と停止解除はモデレーター以上・代理の退会は最上位管理者だけの認可(モデレーターの代理の退会は拒否)、管理者側以外と未ログインの拒否、`adminUsers`の接続の形、不正な`after`で上流の`invalid_cursor`と文言を変換せずに返すこと(2026-11-20に開発者が決定)、`suspendUser`・`unsuspendUser`・`withdrawUserByAdministrator`の結果と各エラーコードを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 3.4, 3.10, 4.10, 5.5, 5.10, 14.2, 14.3, 14.4_

- [ ] 4.8 プロダクト・コメント・評価・画像のリゾルバを作る
  - 各リゾルバを`adminOnly`で包む。画像以外への個別の隔離で上流が投げる`quarantine_not_applicable`は`image_not_found`へ変える
  - 先に、Workers統合テストで、`adminProducts`・`adminProduct`・`adminModerationCategoryOptions`・`adminProductRatings`・`adminComments`・`adminRatings`・`adminQuarantinedImages`の形と不在、一覧の不正な`after`の`invalid_cursor`、非公開化・復元・コメント・評価・4つの画像の操作の認可・結果・エラーコード(復元・コメントの復元・評価の取り消しの理由が無いときの拒否を含む)、画像の`path`が同一オリジンの配信経路であること、画像の操作の確定の後の失敗の`storage_unavailable`を確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 8.9, 8.10, 9.10, 10.9, 11.14, 14.2, 14.3_

- [ ] 5. (P) 物理削除の時期の措置の記録の削除を作り、eventの登録口に加える
  - 先に、単体テストで、利用者とプロダクトの物理削除の時期に関わる記録を500件ずつ削除し、残りがあれば続きを返すことを確かめる
  - 記録のストアは`core/moderation`の`ModerationRecordStore`を`MODERATION_PLATFORM_TYPES.ModerationRecordStore`で受け取る。eventの識別子は`Symbol.for('moderation.event.<名前>')`にして凍結し、単体テストを置く
  - eventの本specのモジュールとユーザー・プロダクトのライフサイクルの非同期の登録口(`purge_due`、1900)へ加える
  - 完了状態: 単体テストと登録口の検査(同じ種類の`order`の重複なし)が成功し、静的解析でeventのapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 2.1_
  - _Requirements: 13.6, 15.2_

- [ ] 6. 措置の群の管理画面
- [ ] 6.1 措置の群のGraphQLの操作を書き、型と管理者側の許可リストを生成する
  - 措置の群の照会と13の措置の操作を、adminの`src/graphql/operations/moderation/`に1ファイル1操作の`.graphql`で書く(統計の操作は7.7)。操作名は`Admin`で始め、`graphql()`を呼ばない
  - frontend-platformの「操作の追加手順」どおり、adminで`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行する。`src/graphql/generated/graphql.ts`の`<操作名>Document`と生成された型は、`src/graphql/admin-moderation-users.ts`・`admin-moderation-products.ts`・`admin-moderation-engagement.ts`・`admin-quarantined-images.ts`だけが読み、画面の型への変換と一覧のloaderの関数を持つ(`frontend/006`。部品は生成物の型に直接依存しない)。`gql.ts`・`index.ts`を読まない
  - 先に、単体テストで、各変換の写像(null・空の配列・続きのカーソル)と一覧のloaderの関数(取得の失敗を`undefined`で握ること)を確かめる
  - 完了状態: 型の生成と型検査と変換の単体テストが成功し、adminとapiの`graphql:check`とadminの`codegen.unit.test.ts`(操作名の接頭辞)が通り、本specの操作が管理者側の許可リストにだけ載る
  - _Depends: 4.7, 4.8_
  - _Requirements: 14.3_

- [ ] 6.2 画面の共通部品を作る
  - 検索パラメータ、措置の実行、措置の確認のダイアログ、同一オリジンの画像、最新の理由の表示、個別の隔離のボタン、評価の無効化と取り消しの操作、文言のファイル(`moderation-messages.ts`)を作る
  - 同一オリジンの画像の代わりの表示は`MediaPlaceholder`(`{ kind, placeholder, alt, size }`)を使う。隔離中の画像は`AdminAvatar`(画像の変換配信)では代わりの表示になるため、隔離画像と隔離の操作の対象は同一オリジンの画像の部品で表示する
  - ブラウザテストは`apps/admin/test/page-router.tsx`の`renderInRouter`と`execute-graphql.ts`の`vi.mock`を使い、照会の結果のfixtureは`apps/admin/test/moderation-fixtures.ts`に置く(6.3〜6.8・7.8・7.9も同じ)
  - 検索パラメータのスキーマのZodの値は共通部品の`lib/utilities/validation/zod.ts`の`z`から読み、`zod`を直接読まない(静的解析の`frontend/zod-entry`)
  - 先に、単体テストで、各ページの検索パラメータの解析(空は未指定・ページの位置)とGraphQLの絞り込みへの変換、文言のファイルの文言が文言規則と一致することを確かめる
  - 先に、ブラウザテストで、措置の確認のダイアログ(理由の要否と上限・個人情報の注記・監査ログに記録される旨・説明の文の中に措置の影響を示すこと(一覧の要素を置かない)・失敗で理由の入力を保ち`ConfirmActionDialog`に渡した`failureMessageOf`の文言を`role="alert"`で示す・`GraphQLClientError`でない失敗で`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`の文言が出て問い合わせを促す文が出ない)、措置の実行の成功と変化なしの通知と照会の無効化、同一オリジンの画像の代わりの表示、最新の理由と日時の`<time datetime>`、個別の隔離のボタンと評価の操作がモデレーター以上だけに出ること、評価の取り消しで理由が必須であること、アクセシビリティの検査の違反が0件を確かめる
  - 6.3〜6.7のページは、ルート(`routes/_authenticated/<メニュー>/index.tsx`、詳細は`products/$productId.tsx`)に`validateSearch`・`loaderDeps`・`loader`(6.1の一覧のloaderの関数)・`head`(`buildAdminPageHead`)・`component`だけを置き、ページの部品は`components/pages/<名前>-page.tsx`に置く。一覧は`frontend/014`の形(`cause !== 'stay'`のときだけ待つ・`useQuery`の`placeholderData: keepPreviousData`・ページ送りは`cursor-trail.ts`)にする(前例は`routes/_authenticated/sponsorships/index.tsx`)
  - 管理者側のCSPの`img-src`が自身のオリジンを許すことを確かめ、許さなければ作業を止めてfrontend-platformの再検証として報告する
  - 完了状態: 単体テストとブラウザテストが成功し、ローカルで隔離画像が管理画面に表示される
  - _Requirements: 11.16, 13.3, 14.5, 14.6, 14.7, 14.8_

- [ ] 6.3 (P) ユーザーのページを作る
  - 先に、ブラウザテストで、絞り込み(ハンドル・ニックネーム・メールアドレス・停止状態)とURLの保持、メールアドレスの欄の近くの監査ログの注記、表の項目(プロフィール画像・ニックネーム・ハンドル・登録日時・使い捨て判定・停止日時と理由)、該当なし、モデレーター以上だけの停止・停止解除・プロフィール画像の隔離の操作と停止の確認の説明の文に示す影響を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: UsersPage_
  - _Depends: 6.2_
  - _Requirements: 3.2, 3.3, 3.7, 3.8, 3.10, 4.1, 4.12, 11.10_

- [ ] 6.4 (P) プロダクトの一覧のページを作る
  - 先に、ブラウザテストで、絞り込み(名称・ハンドル・投稿者・カテゴリ・ローンチ状態・公開状態)とURLの保持、再読み込みの間に前の結果を表示し続けること、取得の失敗を一覧の中に示すこと、表の項目、該当なし、項目から詳細への移動を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: ProductsPage_
  - _Depends: 6.2_
  - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 6.5 (P) プロダクトの詳細のページと区画の登録口を作る
  - 区画の登録口の項目は`{ id, order, title, component }`とし、型(`AdminProductDetailContext`を含む)は登録の一覧と同じ`composition/admin-product-detail-sections.ts`に置く(前例は`composition/inquiry-detail-actions.ts`)。区画は自分で取得するため、区画ごとに`RecoverableSlot`で包み、失敗の表示に`title`を見出しとして出す
  - 先に、ブラウザテストで、情報と説明文の描画と外部URLの`rel`、画像(隔離画像を含む)と個別の隔離の操作、評価の一覧と無効化の操作、ローンチ履歴とマッチ結果、非公開化の日時と理由、モデレーター以上だけの非公開化・復元(どちらも理由が必須)と確認の説明の文に示す影響、区画の登録口の空と失敗の分離、不在の表示を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: ProductDetailView, AdminProductDetailSections_
  - _Depends: 6.2_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.11, 10.3, 11.10_

- [ ] 6.6 (P) コメントと評価のページを作る
  - 先に、ブラウザテストで、コメントの絞り込み(投稿者・プロダクト・期間・状態)とURLの保持、状態の表示、抜粋を文字列として表示すること、評価の絞り込みと表示、モデレーター以上だけの非公開化・復元・無効化・取り消しの操作(すべて理由が必須)を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: CommentsPage, RatingsPage_
  - _Depends: 6.2_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.11, 10.1, 10.2, 10.3_

- [ ] 6.7 (P) 画像モデレーションのページを作る
  - 先に、ブラウザテストで、隔離理由のタブとURL、続きの読み込み、各項目の画像・用途・保有者・日時・全理由・検出内容、理由に応じた公開承認・公開拒否・隔離の解除・削除の操作(モデレーター以上だけ、理由は任意)、画像を表示できないときの代わりの表示を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: MediaModerationPage_
  - _Depends: 6.2_
  - _Requirements: 11.1, 11.2, 11.5, 11.8, 11.16_

- [ ] 6.8 ユーザー一覧の項目に代理の退会の操作を作る
  - ユーザーのページの表の各項目の操作に置く(6.3の表に加えるため、6.3の後に行う)
  - 先に、ブラウザテストで、最上位管理者にだけ操作が出てモデレーター・閲覧のみには出ないこと、確認のダイアログの対象の利用者(ニックネーム・ハンドル・停止状態)・取り消せない旨・本人の意思の確かめと完了の知らせはシステムの外のメールで行う旨の注記・理由の必須と上限、問い合わせの詳細の導線と本人の意思の確認欄が無いこと、監査ログに記録される旨と理由の欄の個人情報の注記を示すこと、失敗で理由の入力を保ったまま`failureMessageOf`(`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`)の文言を示し問い合わせを促す文が出ないこと、成功で一覧から利用者が消えること、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功し、ローカルで最上位管理者のユーザー一覧に操作が表示される
  - _Boundary: AdministrativeWithdrawalAction_
  - _Depends: 6.3_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.10, 5.12, 13.3, 14.5_

- [ ] 6.9 管理画面のメニューへ5ページを登録する
  - メニューの登録箇所へユーザー(20)・プロダクト(30)・コメント(40)・評価(50)・画像モデレーション(60)を加える
  - 先に、ブラウザテストで、メニューの並びと現在のページの表示を確かめる。`ADMIN_NAV_ITEMS`を全件一致で確かめる上流のテスト(`components/layout/admin-nav-order.unit.test.ts`・`admin-navigation.browser.test.tsx`)の期待値に5件を加える
  - 完了状態: 単体テストとブラウザテストが成功し、ローカルで5ページへメニューから移動できる
  - _Depends: 6.3, 6.4, 6.5, 6.6, 6.7_
  - _Requirements: 14.1_

- [ ] 7. 週ごとの統計(統計の群。措置の群の部品を読み込まない独立した継ぎ目)
- [ ] 7.1 統計の群の決定をページ配置・文言規則・準拠方針・日次タイムライン・モデレーションの運用の文書に先に書く
  - ページ配置: ダッシュボードの統計のカード(仮1・仮2)
  - 文言規則: 統計のカードの見出し・説明・「集計中」・集計が無い旨・取得の失敗の文言
  - 準拠方針: データ保持期間に週ごとの統計(無期限、個人を含まない集計値)
  - 日次タイムライン: 4:21の表に`ugc-moderation.weekly-statistics`(1900)
  - `features/006-content-moderation.md`: 統計の定義(仮1)と統計のグラフ(Recharts)の節を加える(仮決定の全体の状態の注記は1.5が書く)
  - 完了状態: 5つの文書が整形の検査を通り、7.8が参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service`の該当する5文書の統計の箇所_
  - _Depends: 1.5_
  - _Requirements: 16.6_

- [ ] 7.2 週ごとの統計のテーブルとマイグレーションを作る
  - 措置の記録のマイグレーションとは別のマイグレーションとして生成する
  - 主キーは他のテーブルと同じULIDにし、週の開始日に一意索引を張る(2026-11-20に開発者が決定したG4)
  - 先に、テーブルの定義の単体テストで、週の行の確定の値と件数の0以上の制約、ULIDの主キーと週の開始日の一意索引、他のspecのIDに外部キーが無いことを確かめる
  - 同じく先に、1.2のマイグレーションの照合のテストと実際のD1での制約の検証のテストに本テーブル(一意索引の重複の拒否を含む)を加え、`schema/index.unit.test.ts`のテーブル名の一覧に加える
  - mainの最新を取り込んでからマイグレーションを生成し、ローカルに適用する
  - 完了状態: 単体テストとWorkers統合テストが成功し、マイグレーションをローカルのD1に適用できる
  - _Depends: 1.2_
  - _Requirements: 2.5, 2.6_

- [ ] 7.3 (P) 統計の週の規則を作る
  - 週の計算はbackend-platformの`businessWeekOf`・`addBusinessDays`を使い、自前の暦の計算を持たない
  - 先に、単体テストで、月曜日0:00の前後と日曜日23:59の週、年をまたぐ週、前週、週の終わりの判定の境界、週の最後の日を確かめる
  - 完了状態: 単体テストが成功し、規則がD1を読み込まない
  - _Boundary: StatisticsWeek_
  - _Requirements: 1.5, 2.1, 2.5, 16.2_

- [ ] 7.4 統計の群の識別子とポートを加え、週ごとの統計のストアを作る
  - 本specのapiの識別子とポートのファイルへ、統計の群の識別子(週ごとの統計のストア・集計のジョブ・照会)と週ごとの統計のストアのポートを加える(措置の群の識別子を変えない)
  - 先に、Workers統合テストで、週の行のupsertが確定した週を書き換えないこと・2回実行して行が1つであること、確定の有無の照会、最近の行の古い順を確かめる
  - 完了状態: Workers統合テストが成功し、型検査が通る
  - _Boundary: WeeklyStatisticsStore_
  - _Depends: 2.2, 7.2_
  - _Requirements: 2.5, 2.6_

- [ ] 7.5 週ごとの統計の集計のジョブと照会を作る
  - 利用者数とプロダクト数はidentity-authの仮7・product-launchの仮13の時点の総数の照会、収益はpaymentsの仮7の期間ごとの純収益の照会(paymentsのタスク5.5・5.7、純収益の定義はpaymentsの要件12.10)、予選実施数とUpvote数はmatch-engineの日ごとの集計を使う
  - 先に、単体テストで、前週が未確定なら週の終わりの時点で集計して確定し今週を実行時刻の時点で集計すること、5つの値の照会の入力(時点・期間・日付の範囲)と週の合計、照会の失敗の定型の通知のポート(`ModerationIncidentReporter`の`statistics-failed`)への送信と次の実行での集計し直し、照会が直近26週と今週を返すことを確かめる
  - ジョブの定義(`WEEKLY_STATISTICS_JOB_DEFINITION`)はジョブのファイルに置く
  - 完了状態: 単体テストが成功する
  - _Boundary: WeeklyStatisticsJob, WeeklyStatisticsReader_
  - _Depends: 7.3, 7.4_
  - _Requirements: 1.9, 2.1, 2.2, 2.3, 2.4, 2.7, 2.8, 15.5_

- [ ] 7.6 統計の群を束縛し、集計のジョブと統計の照会のリゾルバを登録する
  - 2.3のモジュールに週ごとの統計のストア・集計のジョブ・照会を束縛し、集計のジョブを定期実行の登録箇所へ加える。4:21のジョブの名前を完全一致で列挙する`search-module.worker.test.ts`・`search-module.reextraction.worker.test.ts`の一覧と、`apps/api/test/config/ugc-moderation-scheduled-jobs.unit.test.ts`に集計のジョブを加える
  - スキーマモジュールに統計の型と`adminWeeklyStatistics`のリゾルバ(`adminOnly`で包む)を加え、apiで`bun run graphql:generate`を実行して生成物を作り直す
  - 先に、Workers統合テストで、apiの要求と定期実行の経路で統計の群の識別子が解決でき、4:21の`order`(1900)が他と重ならないこと、`adminWeeklyStatistics`の閲覧のみ以上の認可と管理者側以外・未ログインの拒否と返す形を確かめる
  - 完了状態: Workers統合テスト・単体テストと登録の検査が成功し、apiの`graphql:check`が通る
  - _Depends: 4.6, 7.5_
  - _Requirements: 1.9, 14.2, 14.3, 15.2_

- [ ] 7.7 統計のGraphQLの操作を書き、型と管理者側の許可リストを生成する
  - 統計の照会`AdminWeeklyStatistics`を、adminの`src/graphql/operations/moderation/weekly-statistics.graphql`に書き(`graphql()`を呼ばない)、adminで`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行する(frontend-platformの「操作の追加手順」)
  - 生成物の型は`src/graphql/admin-weekly-statistics.ts`だけが読み、画面の型へ変える(`frontend/006`)。先に、単体テストで変換の写像を確かめる
  - 完了状態: 型の生成と型検査と変換の単体テストが成功し、adminとapiの`graphql:check`とadminの`codegen.unit.test.ts`(操作名の接頭辞)が通り、統計の操作が管理者側の許可リストにだけ載る
  - _Depends: 6.1, 7.6_
  - _Requirements: 14.3_

- [ ] 7.8 統計のカードと表を作り、ダッシュボードに登録する
  - 先に、単体テストで、系列と前週からの増減、行の欠け、今週の扱いを確かめる
  - 先に、ブラウザテストで、各指標の直近の確定した週の値と増減、表の見出しと週の開始日(業務日付のため`formatBusinessDateWithWeekdayLabel`の表示と`<time dateTime={日付}>`)と金額、今週の「集計中」、行が無いときの案内、取得の失敗がカードの中だけのエラーと再試行になり問い合わせの導線と問い合わせを促す文が出ないこと、ダッシュボードの先頭に全幅で並ぶことを確かめる
  - ダッシュボードのカードの登録箇所へ`ugc-moderation.weekly-statistics`(10、全幅)を加える。`DASHBOARD_CARDS`を全件一致で確かめる上流のテスト(`components/inquiry/unhandled-inquiries-card.browser.test.tsx`)の期待値に本カードを加える
  - 完了状態: 単体テストとブラウザテストが成功し、ローカルでダッシュボードに統計のカードが表示される
  - _Boundary: WeeklyStatisticsCard, WeeklyStatisticsTable, StatisticsSeries_
  - _Depends: 7.1, 7.7_
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [ ] 7.9 統計のグラフを描画し、統計のカードに組み込む
  - 管理者側に`recharts`を版を明示して完全に固定して加える(`bun add --exact recharts@<版>`。版は3.10.1、または実装時点で公開から2週間以上たつ3系の最新の安定版)。peerの`react-is`が無ければ、管理者側のReactと同じメジャーの版を同じく完全に固定して加える。`package.json`に`^`・`~`が無く`bun.lock`が更新されたことを確かめる
  - 管理者側の`vitest.browser.config.ts`の事前バンドルの一覧(`PREBUNDLED_DEPENDENCIES`)に`recharts`を加える(テストの実行中に初めて読み込まれて事前バンドルがやり直されると、ページが再読み込みされReactが2つ読み込まれるため)
  - tech-stack.mdの「グラフ描画」の項は追加済みのため変えない。`coding/002-dependency-versions.md`の主要パッケージの一覧はアプリ間で版をそろえるパッケージだけを載せる規則のため、管理者側だけが使うRechartsは載せない
  - shadcn/uiの`chart`の部品は写さず、Rechartsの部品を直接使う。線と軸の色は配色のトークンのCSSの変数を属性で渡し、`<style>`の注入(`dangerouslySetInnerHTML`)を使わない(管理者側の生のHTMLの例外の検査が0件を求めるため。2026-11-20に開発者が決定したG3)。Rechartsはフロントエンド共通ファイルに置かない(共有ディレクトリがRechartsを読み込まないため)
  - Rechartsを読み込む部品(`weekly-statistics-line-charts.tsx`)は動的な`import()`で別のチャンクにし、`ClientOnly`の中で`React.lazy`と`Suspense`で読み込む。読み込み中と`ClientOnly`の`fallback`は同じ高さの空の枠にする(2026-11-20に開発者が決定)
  - グラフの部品を7.8の統計のカードの表の上に組み込み、表は同じ値のまま残す
  - 先に、ブラウザテストで、5つの指標の週ごとのグラフと各グラフが直近26週と今週の値を持つこと、`ClientOnly`で包み、サーバー側の描画(`renderToString`)の結果がfallbackの同じ高さの枠の目印だけで`svg`を含まないこと、遅延読み込みの後のクライアントの描画でグラフが出ること、読み込み中も同じ高さの枠を保つこと、図が読み上げで表と重ならないこと、表がグラフと同じ値を示し続けること、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストと型検査が成功し、管理者側の`package.json`に範囲指定の無いRechartsの版があり、管理者側のビルドの出力でRechartsがダッシュボードのルートのチャンクに含まれず別のチャンクにあり、ローカルでダッシュボードの統計のカードにグラフが表示され、生のHTMLの例外の検査が通る
  - _Boundary: WeeklyStatisticsChart, WeeklyStatisticsLineCharts(`components/moderation/statistics/weekly-statistics-line-charts.tsx`), WeeklyStatisticsCardのグラフの配置, 管理者側の`package.json`・`bun.lock`のrecharts_
  - _Depends: 7.8_
  - _Requirements: 1.2_

- [ ] 7.10 統計のE2Eシナリオを作る
  - `weekly-statistics.e2e.test.ts`: `e2e/admin/admin-test.ts`の`test`を使い、`signInAsNewAdmin`の管理者で、backend-platformの改訂2の`triggerScheduled({ worker: 'api', businessDate, businessTime: '04:21' })`(`e2e/support/scheduled-trigger.ts`)で4:21のジョブを動かし、ダッシュボードの統計のカードの表に今週の行が出ることを確かめる。独自の起動の補助を作らない
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 7.8_
  - _Requirements: 16.4_

- [ ] 7.11 (P) 統計の群の技術ドキュメントとオンボーディングを書く
  - `db/008-weekly-aggregate-snapshots.md`を本プロジェクト固有の値を含めずに書き、READMEの文書一覧に加える
  - `docs/onboardings/project-values.md`に`ugc-moderation.weekly-statistics`の集計のジョブ(4:21、1900)とダッシュボードのカード(10、全幅)、統計の表示の週数を加える
  - 完了状態: 文書が整形の検査を通り、技術ドキュメントに本プロジェクト名と固有の値が無いことを検索で確かめる
  - _Boundary: `docs/GUIDES/tech/db/008-weekly-aggregate-snapshots.md`、`docs/onboardings/project-values.md`の統計の行_
  - _Depends: 7.6_
  - _Requirements: 16.5_

- [ ] 8. 措置の群の統合・ドキュメント・E2Eと全体の検査
- [ ] 8.1 措置の連鎖の統合テストを作る
  - apiのWorkers統合テストの環境で行い、eventの非同期の処理の代わりに、上流が登録した処理の部品を直接呼ぶ(`apps/event`を読み込まない)
  - 先に、Workers統合テストで、停止で未開始のローンチが取り消され停止解除で戻らないこと、非公開化で未開始のローンチが取り消され画像の隔離理由が付き復元で外れること、隔離理由が2つある画像は片方の解除で戻らないこと、措置の記録と監査ログが残ることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 4.6_
  - _Requirements: 4.5, 4.6, 8.5, 8.6, 11.6, 11.12, 15.1, 16.3_

- [ ] 8.2 措置の群の技術ドキュメントとオンボーディングを書く
  - `backend/021-cross-aggregate-admin-action-records.md`・`frontend/020-admin-search-and-moderation-actions.md`を本プロジェクト固有の値を含めずに書き、各READMEの文書一覧に加える。`backend/021`には、後続の機能の記録を措置と同じ一括の書き込みに入れる形(application層は種類と値だけの参加を渡し、登録した参加者がinfrastructure層で文を返す)と、呼び出し側の文を受け取れない操作口(状態を確定してから外部へ依頼する操作)に、状態の変更と呼び出し側の文を同じ一括の書き込みで確定する口を足して、後続の依頼の失敗の後の再実行で記録が欠けないようにする形(G1の画像の操作)を含める
  - `docs/onboardings/project-values.md`に措置の群の値(保守のジョブ・処理・同期の処理・メニューの登録の名前と`order`、メール種別、監査ログの操作種別、代理の退会の必要なロール。統計の群の値は7.11)を、`CLAUDE.md`の「技術規則の参照先」に`backend/021`の行を加える
  - `docs/GUIDES/tech/infra/004-logging-and-error-tracking.md`の定型の通知の送信の表に、本specの`moderation_incident`の3つの理由(`moderation-record-missing`・`statistics-failed`・`notice-redispatch-failed`、指紋`['moderation', <理由>]`)の行を加える
  - 完了状態: 文書が整形の検査を通り、技術ドキュメントに本プロジェクト名と固有の値が無いことを検索で確かめる
  - _Depends: 7.11_
  - _Requirements: 15.4, 16.5_

- [ ] 8.3 E2Eの補助を作る
  - admin-foundationの`executeLocalD1`(文字列は`sqlStringLiteral`)とdirectory-discoveryの`directory-fixtures.ts`で、掲載中のプロダクトを持つ確認済みの利用者、そのプロダクトのローンチへのコメントと評価を作る補助を作る(定期実行の起動の補助は作らない)
  - SQLを組み立てる純粋な関数は`e2e/support/moderation-fixture-sql.ts`に分けて単体テストを置き、`moderation-fixtures.ts`がそれを実行する(前例は`e2e/support/sponsorship-fixtures.ts`)
  - 8.4〜8.6と7.10のE2Eは`e2e/admin/admin-test.ts`の`test`(送信元IPを分ける拡張)を使い、画面の操作の手順は`e2e/admin/<名前>-steps.ts`(`user-moderation-steps.ts`・`product-moderation-steps.ts`・`engagement-moderation-steps.ts`・`media-moderation-steps.ts`)に置く
  - 完了状態: SQLの組み立ての単体テストと、補助の関数を順に呼ぶ空のE2Eが成功し、ローカルD1に対象ができる
  - _Depends: 4.6, 5_
  - _Requirements: 16.4_

- [ ] 8.4 利用者とプロダクトの措置のE2Eシナリオを作る
  - `signInAsNewAdmin`のモデレーターで、`/users`でハンドルを検索して停止→ディレクトリからその利用者のプロダクトが消える→Mailpitに停止の通知→監査ログの画面に「ユーザーの停止」→理由を入力した停止解除で戻る、を確かめる
  - プロダクトの詳細で非公開化→利用者側の詳細ページが他者に404→通知メール→理由を入力した復元で戻る、を確かめる
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 6.3, 6.4, 6.5, 6.9, 8.3_
  - _Requirements: 16.4_

- [ ] 8.5 コメント・評価と画像の措置のE2Eシナリオを作る
  - 補助で作ったコメントを非公開化して利用者側で削除の置き換えの表示、評価の無効化で平均が変わることを確かめる
  - 利用者が99×99のプロフィール画像を登録し(代替の判定で隔離)、画像モデレーションの自動判定のタブで画像が読み込まれて表示され、公開承認で一覧から消えることを確かめる
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 6.6, 6.7, 8.3_
  - _Requirements: 16.4_

- [ ] 8.6 代理の退会のE2Eシナリオを作る
  - `signInAsNewAdmin`の最上位管理者で、登録した利用者を`/users`で検索し、理由を入力して代理の退会を行い、その利用者でログインできないこと、監査ログの画面に代理の退会の記録が出ること、退会の完了のメールが送られないことを確かめる。モデレーターのユーザー一覧には操作が出ないことを確かめる
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 6.8, 8.3_
  - _Requirements: 16.4_

- [ ] 8.7 全体の検査とカバレッジを確かめ、作業を報告する
  - 整形・静的解析・型検査・4種のテストを全アプリで実行し、本specが変更したファイルのカバレッジが80%以上であることを確かめる
  - 前提にした上流の改訂(identity-authの仮7・product-launchの仮13・engagementの仮6・paymentsの仮7・backend-platformの改訂2)、仮1〜仮9が2026-10-24に開発者により全て確定した旨(仮4・仮5・仮9は推奨と異なる選択肢)、roadmapの帯の「使用中の値」(4:21は1900・1910、波及処理は1900)を作業の報告に記録する
  - 完了状態: 一括の検査と全テストが成功し、カバレッジの閾値を満たす
  - _Depends: 7.9, 7.10, 7.11, 8.1, 8.2, 8.4, 8.5, 8.6_
  - _Requirements: 16.1_

## Implementation Notes

- 1.1: 規則は`apps/common-lib/moderation/moderation-actions.ts`(`MODERATION_ACTION_DEFINITIONS`・`checkModerationReason`・`MODERATION_REASON_MESSAGES`・`MODERATION_TARGET_KINDS`・`MODERATION_NOTICE_STATUSES`・ライフサイクルの種類の写し)、表示名は`moderation-labels.ts`(上流の値の写し`QUARANTINE_REASONS`・`DISPOSABLE_EMAIL_JUDGEMENTS`・`ADMIN_LAUNCH_STATES`・`ADMIN_COMMENT_STATES`と`mediaPurposeLabel`)。`MODERATION_REASON_MAX`は`AUDIT_REASON_MAX`を参照する。使い捨て判定の写しは上流の型`DisposableEmailStatus`に本specの`unverified`(確認前)を加えた一覧として照合する。`check:contract-copies`への追加に伴い`scripts/tooling/run-all.unit.test.ts`の期待値も直した。13種の措置の表示名(「ユーザーの停止」など)は実装者が決めたため、1.5で文言規則に同じ語を載せる。利用者の状態・公開状態・評価の状態の表示名は未作成で、画面のタスクで必要なら加える
- 1.2: `moderation_actions`(`apps/db/schema/moderation/moderation-actions.ts`、マイグレーション`20261120025459_ugc_moderation`)。`notice_status`は既定値を持たず、書き込む側が措置ごとに決める。索引・CHECKの名前は`api_keys`の前例(`<テーブル>_<列>_idx`・`_check`)。マイグレーションの照合のテストは`_ugc_moderation`で終わるディレクトリを探すため、7.2の統計のマイグレーションは`_ugc_moderation_statistics`のように別の接尾辞にする。D1の統合テストはapiのvitestで走る(`apps/api/db/ugc-moderation-schema.worker.test.ts`のバインド先)
- 1.3: 操作種別は`apps/common-lib/admin/audit-actions/ugc-moderation.ts`の`MODERATION_AUDIT_ACTION_DEFINITIONS`(措置の種類をキーにしたRecord。ユースケースが措置の種類から監査ログの定義を引くため)と`MODERATION_AUDIT_ACTIONS`(一覧)。1.1の定義と表示名から組み立てて写しを持たない。上流の`apps/admin/src/components/pages/audit-logs-page.browser.test.tsx`が表示名を全件一致で比べるため13件を加えた(以後の操作種別の追加でも同様)。`project-values.md`の監査ログの操作種別の一覧への追加は8.2
- 1.4: メール種別は`apps/backend-lib/core/email/kinds/ugc-moderation.ts`、テンプレートは`apps/event/src/infrastructure/email/templates/ugc-moderation/`(テストは他のテンプレートと同じWorkers統合テスト)。件名と広告の段落以外の本文(プレビュー・停止日時の行・固定の段落・問い合わせのボタン)は実装者が決めたため、1.5で文言規則に同じ文を載せる(本文は`moderation-notice-copy.ts`と各`*-email-body.tsx`)。日時は`formatUtcDateTime(…, { withYear: true })`。理由と抜粋は`ModerationMultilineText`で行に分け`<br />`でつなぐ。入力のスキーマは理由を前後の空白を除かずに500書記素で数えるため、2.4の通知は理由を正規化した値(2.2の正規化)で渡し、抜粋は`…`を含めて100書記素に切ってから渡す。決済中のセッションの失効を停止の通知に書くかはResearch Neededのまま書いていない
- 1.5: 文言規則(`003-text-and-copy-rules.md`の「UGC管理の画面の文言」「措置の通知メールの本文」)・ページ配置(`002-page-layouts.md`の「UGC管理の共通の規則」と5ページ)・準拠方針・日次タイムライン・新規の`features/006-content-moderation.md`(と`features/README.md`の索引)を書いた。設計に文面の無い画面の文言(見出し・列見出し・絞り込みのラベル・空の一覧・トースト)と、URLのクエリのキー(users`handle・nickname・email・status`、products`name・handle・ownerHandle・category・launchState・visibility`、comments`authorHandle・productHandle・from・to・state`、ratings`productHandle・raterHandle・state`、media`reason`(既定は自動判定)、全一覧の位置は`after`)は実装者が決め、6のタスクはこれに従う。`account_state_conflict`の文言はdesign.mdのSupporting Referencesの「他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。」を載せた。design.md(1116行付近)は上流の`IDENTITY_ERRORS`をそのまま返すと書くが、上流の文言は「処理が重なりました。時間をおいて再度お試しください。」のため、3.1・3.6(または4.6のエラーの写像)で文言だけを本specの文に差し替える
- 2.1: 契約`apps/backend-lib/core/moderation/ports.ts`・識別子`identifiers.ts`、文の契約とD1の実装と束縛は`workers/moderation/`(`D1ModerationRecordStore`は2つの識別子にそれぞれ`inSingletonScope()`で束縛、両アプリの`MODULES`の`ENGAGEMENT_PLATFORM_MODULE`の直後)。テストの補助`workers/moderation/testing/moderation-record-fixtures.ts`を後続のWorkers統合テストで使える。`listPendingNotices`は`occurredBefore`以下(`lte`、1時間以上前)、`eraseOccurredBefore`は未満(`lt`)。`latestFor`は1文の対象を「90件かつバインド変数100個以内」に分けて1回の`db.batch`で読み、同じ日時はIDの大きい方を最新とする。設計との相違: `eraseBySubjectUser`・`eraseByProduct`の残りの有無は「件数が上限に達したら」ではなく、同じ`db.batch`で削除の後に`LIMIT 1`で読む(engagementの前例。呼び出し側は`continue`/`done`だけで分岐するため影響なし)。`insertStatement`は対象の種類を`common-lib`の`MODERATION_ACTION_DEFINITIONS`から決め、`notice_requested_at`はnull、`markNotice`の`skipped`も`notice_requested_at`をnullのままにする
- 2.2: `apps/api/src/application/moderation/`に`MODERATION_TYPES`(21個、`moderation-types.ts`)・`ports.ts`(型だけ。`ModerationIncidentContext`・`EngagementModerationChange`を名前付きで加えた)・`moderation-errors.ts`(`MODERATION_ERRORS`・`moderationError`。`account_state_conflict`は上流と同じコードで本specの文言、`product_not_found`・`comment_not_found`・`rating_not_found`は上流のエラーを参照、`storage_unavailable`・`invalid_cursor`は上流のものをそのまま返すため持たない)・`pending-moderation-record.ts`(`InMemoryPendingModerationRecord`。`set()`・`clear()`は取り出しの有無も戻し、二重の`set()`は通常の`Error`)・`moderation-reason.ts`(`normalizeModerationReason`、戻り値`string | null`、違反の詳細コードは`required`・`too_long`)。`AdminRoleMediaReviewPolicy`の識別子は作らず、3.7は`composition/media-review-policy.ts`の`FILE_ACCESS_TYPES.AdminMediaReviewPolicy`の束縛を差し替える。ユースケースのインターフェース(`UserModerationService`など)と入力の型は3.1〜3.6が各サービスのファイルで定義する。上流の`UserSuspension`・`AdministrativeWithdrawal`の競合は上流の文言のまま出るため、3.1・3.6は`moderationError('account_state_conflict')`へ変えるか、4.6の`errors.ts`がコードから`MODERATION_ERRORS`の文言を引く(どちらかで管理画面に本specの文言を出す)
- 2.3: apiの`MODERATION_MODULE`(`composition/moderation-module.ts`、名前`moderation`、`MODULES`の`ENGAGEMENT_MODULE`の直後)。同期の処理は処理単位のコンテナから解決され、`inSingletonScope()`の保留中の措置は同じ要求の中だけで共有されることを確かめた(代替案は不要)。2つの同期の処理の共通の手順は設計に無い`infrastructure/moderation/pending-moderation-statements.ts`、参加者の文脈は`moderation-write-participant.ts`の`moderationWriteContextOf`。参加者は参加の都度処理単位のコンテナから解決し、登録の無い種類は通常の`Error`(「措置の書き込みの参加者に登録の無い種類です: "<kind>"」)。テストの補助`infrastructure/moderation/testing/moderation-write-fixtures.ts`(試験用の参加者は`admin_audit_logs`へ操作者`test-spec`の行を入れ、違反は`action`をNULLにする)。`SentryModerationIncidentReporter`のテストは前例に合わせWorkers統合テスト(タスクの文は単体テスト)。定型の通知の文言は実装者が決めた(`moderation-record-missing`「状態を変えた措置の記録と監査ログが、同期の処理で確定されませんでした」、`statistics-failed`「週ごとの統計の集計に失敗しました」、`notice-redispatch-failed`「措置の通知の送り直しに失敗したものがあります」)。8.2で`infra/004`の表に載せる。上流の`product-lifecycle-sync-handlers.worker.test.ts`の期待値に本specの行を加えた
- 2.4: 通知は`apps/api/src/application/moderation/moderation-notifier.ts`の`EmailModerationNotifier`(インターフェース`ModerationNotifier`と`ModerationNoticeDispatch`も同じファイル。4.6で`MODERATION_TYPES.ModerationNotifier`へ束縛)。オリジンは`PLATFORM_TYPES.Env`を狭い型`{ CLIENT_SITE_ORIGIN }`で注入する(paymentsの前例)。停止の宛先は`findContact(record.targetId)`(設計の`subjectUserId`と同じ値)、非公開化はプロダクトの要約の`ownerUserId`、コメントは`CommentStore.findByIds`の投稿者。設計との相違: 宛先が無いときに加え、プロダクトの論理削除・コメントの不在・匿名化でも「送らなかった」にする(入力を作れず送り直しが成功しないため)。抜粋は`bodyMarkdown`の生の文字列を99書記素+`…`に切る(管理画面の200字の抜粋と同じく生の文字列)。送信の成功の後の依頼済みへの更新だけが失敗したときは、新しいログのカテゴリ`['api','application','moderation']`へ警告(`actionId`だけ)を出して投げ直す。8.2で`project-values.md`にこのカテゴリを加える
- 2.5: `D1MediaModerationControl`(`apps/backend-lib/workers/media/media-moderation-control.ts`、`MEDIA_TYPES.MediaModerationControl`を`media-platform-module.ts`で処理単位に束縛)。取り消しの判定は一括の書き込みの先頭の検査の行(`INSERT INTO media_file_quarantine_reasons … SELECT <id>, NULL, … WHERE NOT (<条件>)`の`file_id`のNOT NULLの違反)で、違反の後は読み直して`unchanged`か`not-found`を返す。上流の`MediaQuarantineService`の内部の`reasonsAfter`・`needsRelocation`を`quarantine-relocation.ts`へ、`notApplicable`を`media-operation-errors.ts`の`quarantineNotApplicable`へ移して共有した(公開の形と振る舞いは不変)。`requestErase`の即時の削除は`changed`のときだけ試みる。ログのカテゴリ`['api','media','moderation-control']`を`project-values.md`に加えた。apiの`ControlImageModerationWriter`(`infrastructure/moderation/control-image-moderation-writer.ts`)は参加者の文を扱わない(参加の値の拒否は3.5)。テストの補助`workers/media/testing/media-moderation-control-fixtures.ts`
- 3.1: `DefaultUserModerationService`(`application/moderation/user-moderation-service.ts`、インターフェース`UserModerationService`も同じファイル)。上流の競合は`moderationError('account_state_conflict')`(本specの文言)へ変える(design.mdの「そのまま返す」との相違)。上流の`not_found`は`user_not_found`へ、他の例外はそのまま投げ、全ての失敗の経路で保留中の措置を破棄する。設計との相違: 状態が変わったのに記録が取り出されなかったときは定型の通知へ送り、`{ changed: true, actionId: null }`を返し通知を依頼しない(存在しない記録のIDを返さないため)。この`changed: true`かつ`actionId: null`の組は`ModerationOutcome`の注記に無く、4.7以降のリゾルバと後続の呼び出し側が扱う必要がある。ログは`['api','application','moderation']`に`action`・`userId`・`operatorAdminId`・`actionId`・`result`だけを出す(メッセージ「利用者の措置を終えました」)。3.2〜3.6も同じ形にそろえる
- 3.2: `DefaultProductModerationService`(`application/moderation/product-moderation-service.ts`、3.1と同じ形)。対象は`ProductDirectory.findSummaries([id], 'not-deleted')`の`hidden`で判定する(`AdminProductDirectory`にはIDの照会が無い)。監査ログの対象はプロダクトのID(設計に記載なし、実装者の決定)。保留中の措置の`subjectUserId`は所有者、`productId`と`targetId`はプロダクト。照会の後の論理削除で上流が投げる`product_not_found`は本specのエラー(同じコードと文言)へ変える
- 3.3: `DefaultCommentModerationService`(`application/moderation/comment-moderation-service.ts`)。対象は設計どおり`CommentStore.findByIds`で、`hiddenAt`で同じ状態を判定する。投稿者が削除・匿名化したコメントも非公開化・復元できる(上流の`CommentModerationControl`に合わせた。匿名化済みは記録の`subjectUserId`をnullにし、通知は「送らなかった」になる)。書き込みの単位が記録と状態を一体で確定するため、保留中の措置と`ModerationIncidentReporter`は注入しない。上流の`comment_not_found`はそのまま返す(同じエラー)
- 3.4: `DefaultRatingModerationService`(`application/moderation/rating-moderation-service.ts`)。対象は`AdminRatingDirectory.findByIds`(論理削除されていない行だけを返すため、取消済みは`rating_not_found`)、`invalidatedAt`で同じ状態を判定。注入は`AdminRatingDirectory`・`EngagementModerationWriter`・`AuditLogRecorder`・`IdGenerator`の4つだけ(保留中の措置・通知・定型の通知は持たない)。記録の`noticeStatus`は`'none'`固定、監査ログの対象は評価のID
- 3.5: `DefaultImageModerationService`(`application/moderation/image-moderation-service.ts`)。対象は`MediaFiles.findMany`、画像用でない用途は`file.storage !== 'images'`で`image_not_found`(そのため書き込みの単位の`quarantine_not_applicable`はこの経路では通常起きない)。論理削除済み(`deletedAt`あり)のファイルは拒否しない(media-pipelineでは物理削除まで配信され、隔離画像の一覧にも出るため。要件11.14の「削除済み」は記録が無い・削除待ちと解釈)。記録の`subjectUserId`は保有者が`user`のときだけ、`productId`はnull、監査ログの対象は`[fileId]`。参加の値の検査を理由の検証より前に行う。`storage_unavailable`はログを足さずにそのまま投げる(上流の操作口が警告を出す)
- 3.6: `DefaultAdministrativeWithdrawalService`(`application/moderation/administrative-withdrawal-service.ts`、3.1の形)。通知のポートを持たない(メールを送らない)。設計に無い`ModerationIncidentReporter`を注入し、記録が取り出されないときは3.1と同じく`{ changed: true, actionId: null }`。退会済みは照会で除かれるため変化なしの結果は無い。上流の`forbidden`(管理者でない呼び出し)はそのまま投げる。Workers統合テストは`apps/api/src/composition/moderation-module.administrative-withdrawal.worker.test.ts`(`PLATFORM_TYPES.MessagePublisher`を記録する実装に差し替え`email.send`が無いことを確かめる)。競合は単体テストだけで確かめる
