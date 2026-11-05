# Implementation Plan

- [x] 1. 基盤: テーブル・共有の定義・メール・表示部品
- [x] 1.1 問い合わせの5テーブルと標準カテゴリの初期データを定義し、マイグレーションを生成する
  - 前提: backend-platform・api-gateway・email-delivery・frontend-platform・content-processing・media-pipeline・identity-auth・admin-foundationの全タスクが完了していること(層構成・登録箇所・GraphQL基盤・メール送信基盤・両アプリの骨格・共有ディレクトリ・アップロード基盤・利用者の判定と連絡先の共有の照会口とライフサイクルの登録口・管理者の認可と監査ログと区画とapi・event共通の管理者の照会口とE2Eの補助がある状態)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、各テーブルの列の型・NOT NULL・既定値・一意制約・CHECK制約・索引(カテゴリ名の大文字小文字を区別しない一意、ステータスと送信者の種類のCHECK、送信者が管理者のときだけ管理者のIDを持つCHECK、受付日時・ステータス・ステータスの変更日時・利用者・問い合わせごとのメッセージの索引、添付の複合主キーとファイルの索引)を確かめる単体テストを書く
  - ログインの問い合わせは利用者とカテゴリを外部キーで参照し、論理削除の列を持つ。未ログインの問い合わせは利用者を参照しない。メッセージは問い合わせを参照し、管理者のIDとファイルのIDは外部キーを持たない。削除時の動作は指定しない
  - スキーマの集約点に加え、mainの最新を取り込んでからマイグレーションを生成し、固定IDの「その他」を重複しない形で挿入するカスタムマイグレーションを加える。初期データの書き方は`db/003`の「初期データ」の項(legal-pagesのタスク7.3が書く。固定のULIDと作成日時・`INSERT ... ON CONFLICT DO NOTHING`・別のカスタムマイグレーション・スナップショットとの関係)に従い、項が無ければ同じ内容を本specで`db/003`に書く
  - 完了状態: 列の単体テストが成功し、マイグレーションをローカルに適用でき、初期データのSQLを2回実行しても「その他」が1件だけで、大文字小文字だけが異なるカテゴリ名を追加できない
  - _Requirements: 1.1, 1.3, 3.1, 5.1, 6.1, 12.1, 13.1_

- [x] 1.2 (P) 入力の上限・添付の上限・ステータス・標準カテゴリの定数を、4アプリが共有するディレクトリに作る
  - 先に、ニックネームの25・26書記素、本文の5,000・5,001書記素、チャットの1,000・1,001書記素、前後の空白だけの入力、添付の20・21件と合計20,971,520・20,971,521バイト(1ファイルの上限も20,971,520バイト)、4種のステータスの表示名を確かめる単体テストを書く
  - 書記素の数え方は共有の部品を使う。添付の用途名と上限は仮3の値(合計・1ファイルとも20,971,520バイト。media-pipelineのアップロードの上限の最大値と同じ)にする
  - 完了状態: 単体テストが成功し、利用者側・管理者側・APIサーバーの型検査で配置先から読み込める
  - _Boundary: InquiryInputRules, InquiryAttachmentLimits, InquiryStatus, InquiryCategoryConstants_
  - _Requirements: 3.1, 5.1, 6.1, 8.1, 11.1, 12.1_

- [x] 1.3 (P) 監査ログに本specの5つの操作種別を登録する
  - 先に、返信・ステータスの変更(詳細は種別と変更前後のステータス)・カテゴリの追加・名前の変更・削除(詳細は付け替えの件数)の定義が、表示名を持ち、理由を任意とし、対象の上限が1件で、名前・本文・メールアドレスを入れる詳細の鍵を持たないことを確かめる単体テストを書く
  - 操作種別は`defineAuditAction`の形(`name`・`label`・`targetKind`・`reason`・`detailKeys`・`maxTargets`)で書く。admin-foundationの操作種別の集約点に本specのファイルを加え、集約点の単体テストの登録名の期待値に5種別を足す。対象の種類`inquiry`・`category`と管理画面の表示名は登録済みのため足さない
  - 完了状態: 単体テストが成功し、集約点のカタログに5種別が載り、名前の重複の検査と集約点の単体テストに通る
  - _Boundary: InquiryAuditActions_
  - _Requirements: 15.1, 15.2, 15.3_

- [x] 1.4 (P) 返信の通知メールの種別とテンプレートを作る
  - 先に、入力の検証(ニックネーム・チャットページのURL・返信の日時)と、本文にチャットページへの行動ボタン「問い合わせを確認する」があり返信の本文を含まないことを確かめる単体テストを書く
  - トランザクションメールの種別として登録し、件名は文言規則の「お問い合わせに返信がありました」にする。種別とテンプレートの集約点に1行ずつ加える
  - 完了状態: 単体テストが成功し、テンプレートの登録表の検証に通り、Mailpitで描画を確認できる
  - _Boundary: InquiryReplyTemplate_
  - _Requirements: 11.2, 11.3_

- [x] 1.5 (P) 定期再取得の共通の値と、両アプリが使う問い合わせの表示部品を作る
  - 先に、定期再取得の値(30秒・非表示のタブで止める・画面へ戻った時に取得)の単体テストと、ステータスの表示・メッセージの1件(本文の改行を保ちHTMLとして解釈しない、日時を`<time datetime>`で表示)・添付の一覧(元のファイル名・形式・サイズとダウンロードのリンク、インライン表示しない)・既定のアイコンを含むアバターのブラウザテストを書く
  - 部品はGraphQLとアプリの型に依存させず、media-pipelineのリンクと画像の部品を使う。Storybookに載せる
  - 添付の一覧は`PrivateFileLink`(`fileId`・`fileName`・`byteSize`)を使い形式をその隣に示す。日時の書式は`longDateTime`(G5)
  - 完了状態: 単体テストとブラウザテストが成功し、`runAxe`の違反が0件で、Storybookで4部品を確認できる
  - _Boundary: LiveRefresh, InquiryDisplayParts_
  - _Requirements: 2.5, 6.5, 7.4, 7.5, 7.6, 7.7_

- [x] 1.6 セッションと利用者・管理者の契約をバックエンド共通の`core`へ移す(上流の改訂、G3)
  - 先に、移した識別子(`IDENTITY_PLATFORM_TYPES.AccountGuard`・`ADMIN_PLATFORM_TYPES.AuditLogRecorder`)が`Symbol.for`の値を持ち凍結されていることと、apiの既存の層の規則の単体テストが通ることを確かめる単体テストを書く
  - `SessionView`・`Principal`・`AuthenticatedPrincipal`・`SessionSubjectKind`を`apps/backend-lib/core/session/session-view.ts`へ、`AccountGuard`・`CurrentUser`と新設の`UserAccountView`(`UserAccountSnapshot`にニックネーム・ハンドル・メールアドレス・仮名化IDを加えた読み取りの形。`UserRecord`はこれを継承する)を`core/identity/account-guard.ts`へ、`AuditLogRecorder`・`PreparedAuditEntry`(準備済みの印の宣言を含む)・`AuditEntryInput`を`core/admin/audit-log.ts`へ、`CurrentAdmin`を`core/admin/current-admin.ts`へ移し、識別子を`IDENTITY_PLATFORM_TYPES`・`ADMIN_PLATFORM_TYPES`に足して`IDENTITY_TYPES`・`ADMIN_TYPES`から除く。実装(`StoreAccountGuard`・`StoreAuditLogRecorder`・`validateAuditEntry`・`StoreAdminAuthorizer`)はapiに残し、束縛先の識別子を改める。api内の読み込み先をすべて改める
  - identity-authの各ユースケースが`CurrentUser.user`から`UserAccountView`に無い項目(`passwordHash`など)を読んでいれば、`UserAccountStore.findById`で読み直す形に改める
  - `docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md`の「依存方向と静的解析」に、別の機能のapplication層が受け取る契約を`core`へ置いた例としてこれらを加える(プロジェクト名を含めない)
  - 完了状態: 単体テストが成功し、api・event・ルートの型検査・静的解析・既存の単体テストとWorkers統合テストがすべて通り、identity-auth・admin-foundationの振る舞いが変わらない
  - _Requirements: 3.4, 5.4, 7.1, 8.4, 11.1, 12.2, 15.1_

- [x] 1.7 (P) 監査ログの取り消しの条件に、SQLで渡す種類を足す(上流の改訂、G1)
  - 先に、admin-foundationの`audit-log-statements`のWorkers統合テストに、`{ kind: 'condition', condition }`の条件が偽のとき`isAuditGuardRejection`が真になり同じ一括の書き込みの操作の文も残らないこと、真のとき`guard`無しと同じ結果になることを足す
  - `AuditGuard`に`{ readonly kind: 'condition'; readonly condition: SQL }`を足し、`guardCondition`で条件をそのまま使う。既存の`delete`・`role-change`は変えない
  - `docs/GUIDES/tech/backend/008-audit-logging.md`の`AuditGuard`の説明(「管理者の削除とロール変更の条件だけを持つ」)を、対象の状態を条件にする操作が`condition`を渡す形に改める
  - 完了状態: Workers統合テストが成功し、admin-foundationの既存のテストが通る
  - _Requirements: 11.7, 12.2, 12.3, 15.1_

- [x] 1.8 (P) カテゴリマスタの編集部品に、削除の確認の文と監査ログの旨の任意のpropsを足す(上流の改訂、G2)
  - 先に、admin-foundationの`CategoryMasterEditor`のブラウザテストに、`deleteDescriptionOf`で項目から作った文が削除の確認に出ること、`deleteAudited: true`で監査ログに記録される旨が出ること、未指定なら今の文と旨なしのままであることを足す
  - `deleteDescriptionOf?: (category: CategoryMasterItem) => string`と`deleteAudited?: boolean`を足し、削除の`ConfirmActionDialog`の`description`と`audited`に渡す。`CategoryMasterItem`は変えない
  - `docs/GUIDES/tech/frontend/005-shared-components.md`の部品の説明に2つのpropsを加える
  - 完了状態: ブラウザテストが成功し、`runAxe`の違反が0件で、Storybookに削除の確認の文を指定した例が載る
  - _Requirements: 1.5, 15.1_

- [x] 1.9 (P) 前後のページの補助をフロントエンド共通へ移し、bot判定の操作名の写しの一致の検査を足す(上流の改訂、G4・G7)
  - 先に、`config/contract-copies.unit.test.ts`に、APIの`BOT_ACTIONS`(identity)・`ADMIN_BOT_ACTIONS`(admin)と各アプリの`components/auth/bot-actions.ts`の値が一致することを確かめる検査を足す(本specの`INQUIRY_BOT_ACTIONS`と`components/inquiry/bot-actions.ts`はタスク7.2・9.1で同じ検査に足す)
  - `apps/admin/src/components/audit/cursor-trail.ts`と単体テストを`apps/frontend-lib/utilities/pagination/cursor-trail.ts`へ移し、監査ログのページの読み込み先を改める。`docs/GUIDES/tech/frontend/006-data-fetching.md`の一覧の節に、前後のページの補助の場所を加える
  - 完了状態: 単体テストが成功し、管理画面の監査ログのブラウザテストとE2Eが通る
  - _Requirements: 4.1, 9.2, 10.3_

- [x] 2. ドメインの規則
- [x] 2.1 (P) 対応ステータスの遷移と管理操作の可否の規則を作る
  - 先に、利用者の送信で「対応済」「却下」だけが「未対応」へ戻り「未対応」「対応中」は変わらないこと、退会済みと未ログインの問い合わせへの返信の拒否、退会済みのステータスの変更の拒否、同じ値への変更の拒否を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、拒否の理由が退会済み・返信できない種別・変更なしで区別される
  - _Boundary: InquiryStatusRules_
  - _Requirements: 8.2, 10.7, 11.5, 11.7, 12.3_

- [x] 2.2 (P) カテゴリの保護・並び順と、添付の選択の判定の規則を作る
  - 先に、標準カテゴリの名前の変更と削除の拒否、追加の順に並び標準カテゴリが末尾になること、添付の件数・合計の超過、存在しない・他人の・用途違いの・保存未完了の・削除済みのファイル、重複したIDを1件として扱うことを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、添付の違反が件数超過・合計超過・無効なIDの一覧で区別される
  - _Boundary: InquiryCategoryRules, AttachmentSelection_
  - _Requirements: 1.4, 1.7, 6.1, 6.3_

- [x] 3. カテゴリのマスタ
- [x] 3.1 問い合わせのポートと識別子を定義し、カテゴリの一覧・追加・名前の変更・削除のユースケースを作る
  - 先に、ポートを偽物にして、一覧の並び、管理者向けの一覧に紐付く件数が付くこと、名前の規則の違反と重複の拒否、標準カテゴリの保護、削除で付け替えの件数が監査ログの詳細に入り、監査ログの準備が保存の前に行われることを確かめる単体テストを書く
  - 全ユースケースが使うストア・照会・メール・設定値・報告のポートと識別子をここで定義する。上流の契約は`backend-lib/core`(`session`・`identity`・`admin`・`media`)だけから読み込み、`application/identity`・`application/admin`は読み込まない
  - 完了状態: 単体テストが成功し、違反ごとに要件のエラーコード(名前の重複・標準カテゴリの保護・検証のエラー)が返る
  - _Depends: 1.6_
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.7, 15.1_

- [x] 3.2 カテゴリのD1のストアを作る
  - 先に、大文字小文字だけが異なる名前の追加・変更が重複として返ること、削除でログイン・未ログインの両テーブルの問い合わせが「その他」へ付け替わりカテゴリが消え監査ログが同じ一括の書き込みに入ること、標準カテゴリは条件により削除されないこと、カテゴリごとの紐付く件数が両テーブルの和になることを確かめるWorkers統合テストを書く
  - 完了状態: Workers統合テストが成功し、削除の途中の失敗で付け替え・削除・監査ログのいずれも残らない
  - _Depends: 1.7_
  - _Requirements: 1.3, 1.5, 15.1_

- [x] 4. 送信のユースケース
- [x] 4.1 添付の検証と紐付けのユースケースを作る
  - 先に、ポートを偽物にして、0件では何も呼ばないこと、件数・合計・無効なIDの違反で紐付けを呼ばずに添付のエラーを返すこと、紐付けの失敗も添付のエラーになること、解放で論理削除を呼び失敗は報告だけにすることを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、検証→紐付けの順に呼ばれ、書き込みの失敗時の解放の手段がある
  - _Requirements: 6.1, 6.3_

- [x] 4.2 (P) 未ログイン(停止中を含む)の問い合わせの送信のユースケースを作る
  - 先に、ポートを偽物にして、停止していないログイン中の利用者の拒否、未ログインと停止中の受け付け、存在しないカテゴリの拒否、回数制限のポートの超過で保存しないこと、保存に利用者のIDが入らないこと、メールの送信を呼ばないことを確かめる単体テストを書く
  - 同じく先に、回数制限の実装`CounterGuestInquiryRateLimit`が偽の厳密カウンタに`inquiry-guest:ip`(5回/3600秒)の規則で数え、超過で429と待ち時間を返し、送信元IPアドレスが不明なら数えずに警告を残し、キーを送信元IPアドレスのHMACにすることを確かめるWorkers統合テストを書く
  - 回数制限のポート`GuestInquiryRateLimit`はapplication層(3.1のポートの定義の`application/inquiry/ports.ts`に加える)、実装と規則は厳密カウンタのクライアントの型と`assertWithinLimit`が共通ライブラリの`workers`にあるためinfrastructure層(`infrastructure/inquiry/counter-guest-inquiry-rate-limit.ts`)に作る(`backend/003`、identity-authの`CounterMailSendLimits`と同じ形)。application層は`**/lib/workers/**`を型も含めて読み込めない
  - 完了状態: 単体テストとWorkers統合テストが成功し、受け付けた問い合わせが「未対応」で保存される。APIサーバーの静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Boundary: GuestInquirySubmission, CounterGuestInquiryRateLimit_
  - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 4.3 (P) ログインの問い合わせの送信のユースケースを作る
  - 先に、ポートを偽物にして、停止中の利用者の拒否、メールアドレスが未確認の利用者の受け付け、存在しないカテゴリの拒否、添付の紐付けの後に問い合わせと最初のメッセージを保存すること、保存の失敗で添付を解放することを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、保存した問い合わせのIDが返る
  - _Boundary: MemberInquirySubmission_
  - _Depends: 4.1_
  - _Requirements: 5.1, 5.3, 5.4, 5.5_

- [x] 5. チャットと管理者の操作のユースケース
- [x] 5.1 本人の閲覧・追加メッセージ・自分の一覧のユースケースを作る
  - 先に、ポートを偽物にして、本人以外・不在・論理削除の問い合わせが見つからない扱いになること、停止中の本人は閲覧でき送信の可否が偽になること、停止中の送信の拒否、本文の規則の違反の拒否、「対応済」への送信で「未対応」へ戻る値が渡り監査ログの準備を呼ばないこと、自分の一覧が20件ずつであることを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、追加メッセージの保存に失敗したとき添付が解放される
  - _Depends: 4.1_
  - _Requirements: 7.1, 7.3, 7.8, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 13.3, 15.4_

- [x] 5.2 (P) 管理者の一覧・詳細・未対応の件数と返信のユースケースを作る
  - 先に、ポートとidentity-authの利用者の連絡先の共有の照会口を偽物にして、詳細でログインの問い合わせのメッセージと送信者の表示が返ること、返信が未ログイン・退会済み・不在で拒否されること、返信でステータスを変えないこと、通知先をその照会口で引きメールアドレスが未確認・停止中の利用者にも送ること、照会口が利用者を返さないときは送らずに通知の可否が偽で返ること、通知メールの送信要求の失敗で返信が保存されたまま通知の可否が偽で返り報告されることを確かめる単体テストを書く
  - 返信の通知先は本specで読み取りの部品を作らず、identity-authの共有の照会口(`UserContactDirectory`)を使う
  - 完了状態: 単体テストが成功し、返信の監査ログの準備が保存の前に行われる
  - _Boundary: InquiryAdminService, InquiryReplyService_
  - _Requirements: 10.1, 10.4, 10.5, 11.1, 11.2, 11.4, 11.5, 11.6, 11.7, 11.8, 14.1, 14.2, 15.1_

- [x] 5.3 (P) 対応ステータスの変更のユースケースを作る
  - 先に、ポートを偽物にして、退会済みと同じ値への変更の拒否、監査ログの詳細に種別と変更前後のステータスが入ること、競合が状態の競合のエラーになることを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、ログイン・未ログインのどちらの問い合わせも変更できる
  - _Boundary: InquiryStatusService_
  - _Requirements: 12.2, 12.3, 15.1, 15.3_

- [x] 5.4 (P) 未ログインの問い合わせの保持期間のジョブを作る
  - 先に、ポートを偽物にして、閾値が実行時刻の14日前になること、500件ずつ最大20回で止まり残りを翌日に回すことを確かめる単体テストを書く
  - 業務時刻4:21・`order` 300で登録する定義を用意する
  - 完了状態: 単体テストが成功し、削除件数がログに残る
  - _Boundary: GuestInquiryRetentionJob_
  - _Requirements: 13.4, 13.5, 13.6_

- [ ] 6. D1とメールの実装
- [x] 6.1 ログイン・未ログインの問い合わせのD1のストアを作る
  - 先に、作成で問い合わせ・最初のメッセージ・添付の紐付けが1つの一括の書き込みで入ること、追加メッセージで最後のメッセージの日時とステータス(戻すときだけ変更日時も)が更新されること、退会済みへの返信が監査ログごと取り消されること、自分の一覧が論理削除を除き20件ずつのカーソルで読めること、保持期間の削除が「対応済」「却下」の14日の境界だけを消し「対応中」へ戻したものを残すことを確かめるWorkers統合テストを書く
  - 返信の取り消しは`buildAuditLogStatements`の`AuditGuard`の`condition`(退会済みでないこと)で行い、`isAuditGuardRejection`で見分ける(G1)
  - 完了状態: Workers統合テストが成功し、21件の添付でもバインド変数の上限に収まる
  - _Depends: 1.7_
  - _Requirements: 3.1, 5.1, 8.1, 8.2, 9.1, 11.1, 11.7, 12.4, 13.3, 13.4, 13.5_

- [x] 6.2 ステータスの変更と管理画面の横断の一覧のD1の実装を作る
  - 先に、現在の値と退会の状態を条件にした変更と監査ログが同じ一括の書き込みで確定し、同時の変更の一方が競合になること、横断の一覧が受付日時の新しい順に並びカーソルと各絞り込み(ステータス・種別・カテゴリ・期間)が効くこと、未対応の件数が退会済みを除くこと、不正なカーソルが検証のエラーになることを確かめるWorkers統合テストを書く
  - ステータスの変更の取り消しは`AuditGuard`の`condition`(現在のステータスが一致し退会済みでないこと)で行い、`isAuditGuardRejection`が真なら競合にする(G1)
  - 完了状態: Workers統合テストが成功し、51件目の有無で次のページのカーソルが決まる
  - _Depends: 1.7_
  - _Requirements: 10.1, 10.2, 10.3, 12.2, 12.3, 14.2_

- [x] 6.3 (P) 送信者の表示の照会・返信の通知メール・報告の実装を作る
  - 先に、照会が100件ずつ読みプロフィール画像を常に空で返すこと、通知メールのリンクが利用者側のオリジンとチャットページのパスになることを確かめるWorkers統合テストを書く
  - 報告はSentryへ通知メールの失敗を`error`、添付の解放の失敗を`warning`で送る
  - 完了状態: Workers統合テストが成功し、user-profile-socialが照会の束縛を差し替えられる形で登録できる
  - _Boundary: D1InquirerProfiles, EmailInquiryMailer, SentryInquiryIncidentReporter_
  - _Requirements: 2.3, 2.5, 11.2, 11.3, 11.4_

- [x] 6.4 (P) 添付の閲覧の方針を作る
  - 先に、本人の紐付け済みと送信前のファイル、他人のファイル、論理削除された問い合わせのファイル、管理者の紐付け済みと紐付けの無いファイルの判定を確かめるWorkers統合テストを書く
  - 完了状態: Workers統合テストが成功し、権限の無い要求で偽が返る
  - _Boundary: InquiryAttachmentReadPolicy_
  - _Requirements: 6.6, 6.7_

- [ ] 6.5 (P) 退会の同期の波及処理を作る
  - 先に、退会のイベントで利用者の未削除の問い合わせだけに論理削除の日時を入れる1文を返し、他のイベントでは文を返さないことを確かめるWorkers統合テストを書く
  - 完了状態: Workers統合テストが成功し、identity-authの退会の確定の一括の書き込みに含められる
  - _Boundary: MemberInquiryWithdrawalHandler_
  - _Requirements: 13.1_

- [ ] 7. GraphQLとAPIサーバーの組み立て
- [ ] 7.1 APIサーバーの束縛と各登録箇所への追記を行う(上流との統合)
  - 問い合わせのモジュール(ストア・照会・回数制限・ユースケース・報告・ジョブの束縛)、保持期間のジョブ、添付の用途(ファイル用・利用者・添付の形式・20,971,520バイト)、閲覧の方針、退会の同期の波及処理を各登録箇所へ加える
  - 静的解析に`INQUIRY_LAYER_RULES`(`ADMIN_LAYER_RULES`と同じ形。`inquiry`の各層から`identity`・`admin`の各層を禁止し、`lib`・`common-lib`・`db`と`infrastructure/admin/audit-log-statements.ts`・`infrastructure/identity/user-lifecycle-sync-handler.ts`・`presentation/graphql/admin-guard.ts`だけを`!`で許す)を加え、許可と違反の例の単体テストを`test/config/inquiry-layer-rules.unit.test.ts`に書く(G3)
  - 完了状態: 組み立てのWorkers統合テストで、20,971,521バイトの添付のアップロードが413になり20,971,520バイトが受け付けられ、本人のファイルが200・他人のファイルが404でダウンロードされ、退会の確定で利用者の問い合わせが論理削除され、4:21のジョブの一覧に本specのジョブが順序300で載る
  - _Requirements: 6.1, 6.4, 6.6, 6.7, 13.1, 13.4_

- [ ] 7.2 スキーマモジュールの型・入力・エラー・変換と利用者側のリゾルバを作り、スキーマモジュールを登録する
  - 先に、未ログインとログインの送信がbot判定(それぞれのaction)を求めチャットの送信は求めないこと、6回目の未ログインの送信が429と再送までの秒数を返すこと、管理者側の呼び出し元からの利用者側の操作の拒否、送信者の表示が停止中と未ログインで空になること、他人の問い合わせが空で返ること、削除済みの管理者の返信が削除済みとして返ることを確かめるWorkers統合テスト(テスト用の操作の一覧を使う)を書く
  - 入力は共有の規則で検証し、添付は一括の読み込みで返す。呼び出し元の確認とbot判定の操作名(`INQUIRY_BOT_ACTIONS`)は本specのモジュールの`resolver-support.ts`に置く。スキーマモジュールの集約点へ加え、スキーマファイルとリゾルバの型を生成し直す
  - 完了状態: Workers統合テストが成功し、生成物の食い違いの検査に通る
  - _Requirements: 2.1, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.5, 5.1, 5.2, 5.3, 6.3, 7.1, 7.3, 7.4, 7.5, 8.1, 8.3, 8.5, 9.1_

- [ ] 7.3 管理者側のリゾルバを作る
  - 先に、閲覧のみの一覧・詳細・件数・紐付く件数付きのカテゴリの許可と、返信・ステータスの変更・カテゴリの3操作の403、利用者側の呼び出し元からの拒否、返信の結果に通知の可否が入ること、未ログインの詳細に連絡先が入ることを確かめるWorkers統合テスト(テスト用の操作の一覧を使う)を書く
  - 完了状態: Workers統合テストが成功し、生成物の食い違いの検査に通る
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 10.1, 10.2, 10.4, 10.5, 11.1, 11.4, 11.7, 12.2, 12.3, 14.1_

- [ ] 8. イベントサーバーの物理削除とデータエクスポート
- [ ] 8.1 退会者の問い合わせの物理削除の非同期の波及処理を作り、登録する
  - 先に、101件の問い合わせで1回目が続きあり・2回目が完了になること、添付の紐付け・メッセージ・問い合わせの順に消えること、同じイベントで再実行しても結果が変わらないことを確かめるWorkers統合テストを書く
  - 物理削除のイベントに`order` 300で登録し、イベントサーバーのモジュールに束縛を加える
  - 完了状態: Workers統合テストが成功し、すべての波及処理の完了後にidentity-authの利用者の削除が外部キーの違反なく通る
  - _Requirements: 13.2, 13.6_

- [ ] 8.2 データエクスポート用の照会口を作り、イベントサーバーに束縛する
  - 先に、Workers統合テストで、本人のログインの問い合わせだけを返し他人の・論理削除済みの問い合わせを含めないこと、21件で次の位置が返り2回目で残りが返ること、各問い合わせが現在のカテゴリ名(削除後は「その他」)・ステータス・作成日時と送信日時の古い順のメッセージを持つこと、管理者の返信のニックネームが管理者の照会口から入り削除済みの管理者は空になること、管理者の返信の添付が空であること、利用者のメッセージの添付が位置の順に元のファイル名・形式・バイト数とファイルのIDを持ち物理削除済みのファイルを除くこと、日時がミリ秒までのUTCのISO 8601であること、不正な位置の指定が検証のエラーになることを確かめる
  - 同じく先に、識別子`INQUIRY_EXPORT_TYPES`が`Symbol.for('inquiry.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - data-exportのeventのapplication層が読み込めるよう、設計の契約(`InquiryExportAttachment`・`InquiryExportMessage`・`InquiryExportItem`・`InquiryExportPage`・`InquiryExport`・`INQUIRY_EXPORT_PAGE_SIZE`)を`apps/backend-lib/core/inquiry/ports.ts`に、識別子`INQUIRY_EXPORT_TYPES`を`core/inquiry/identifiers.ts`に作る。application層は`**/lib/workers/**`を型も含めて読み込めないため、契約と識別子を`workers`に置かない
  - 本specのテーブルを読む実装`D1InquiryExport`をバックエンド共通の`workers/inquiry/d1-inquiry-export.ts`に置き、管理者のニックネームはadmin-foundationの照会口(`core/admin`の`AdminDirectory`)、添付のメタデータはmedia-pipelineの`findMany`(`core/media`の`MediaFiles`)で引く。返す値にメールアドレス・利用者のID・管理者のIDを含めない。ZIP内のパスの組み立てと実体の同梱はdata-exportに委ねる
  - 8.1が束縛を加えたイベントサーバーのモジュールに照会口の束縛を加えるため、8.1の後に行う
  - 完了状態: 単体テストとWorkers統合テストが成功し、イベントサーバーのコンテナから照会口を解決でき、返す項目がデータエクスポートの文書の`inquiries.json`の表の項目(data-exportが組み立てる添付のパスを除く)と対応する
  - _Depends: 8.1_
  - _Boundary: InquiryExport, D1InquiryExport_
  - _Requirements: 13.7_

- [ ] 9. 利用者側の画面
- [ ] 9.1 `/contact`の状態ごとのフォームと送信完了を作る
  - 先に、未ログイン・停止中・停止していないログイン中で入力欄(ニックネーム・連絡先・添付・プロフィールの表示)と停止中の案内が切り替わること、フォーカスを外した時点の検証と欄ごとのサーバーのエラー、ファイルの件数・合計の超過の表示、添付の入力欄に`contactAvailable`として`CLIENT_PROFILE.contactAvailable`を渡すこと、429の再送の案内、未ログインの送信完了の置き換え、ログインの送信後のチャットへの遷移を確かめるブラウザテストを書く
  - フォームと自分の一覧が使う利用者側の操作を`src/graphql/operations/inquiry/`の1ファイル1操作の`*.graphql`(操作名は`Client`で始める)で作り、clientで`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行して型と許可リストを生成し直す
  - ページ全体の部品は`components/pages/contact-page.tsx`、フォームなどの部品は`components/inquiry/`、取得の設定・`loader`・変換は`graphql/inquiry-contact.ts`、headは`head/page-heads.ts`の`buildContactHead`に置く(G3の層の規則と同じく既存の規約に合わせる)。`loader`は`queryClient.query`に`staleTime: 'static'`を指定して取得する
  - bot判定のウィジェットをそれぞれのaction(`components/inquiry/bot-actions.ts`の写し。APIの値との一致を`config/contract-copies.unit.test.ts`に足す、G7)で非表示で置き(判定の枠と場所を設けない)、送信は`sendWithTurnstile`で包む。添付は編集ダイアログを出さない部品を使い、`onUploaded`で受けたファイルのIDをフォームの値に足す
  - 完了状態: ブラウザテストが成功し、`runAxe`の違反が0件で、ローカルで3つの状態のフォームを確認でき、フォームの操作が利用者側の許可リストにだけ載り、操作名の一致の検査に通る
  - _Depends: 1.9_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.2, 3.3, 4.5, 5.2, 5.3, 6.2, 6.8_

- [ ] 9.2 `/contact`の自分の問い合わせの一覧を作る
  - 先に、ログイン中(停止中を含む)だけに表示されること、検索パラメータによる20件ずつの前後のページ(記録の無い途中のページから1ページ目へ戻ること)、空状態、取得の失敗の表示と再試行、各行のステータス・カテゴリ・日時(`longDateTime`)とチャットへのリンクを確かめるブラウザテストを書く
  - 前後のページは`frontend-lib/utilities/pagination/cursor-trail.ts`の補助と`validateSearch`・`loaderDeps`・`useQuery`で作る(管理画面の監査ログの一覧と同じ形、G4)
  - 完了状態: ブラウザテストが成功し、ローカルで前後のページの移動を確認できる
  - _Depends: 1.9_
  - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 9.3 チャットページと追加メッセージの入力を作る
  - 先に、メッセージが古い順に並ぶこと、管理者の返信のアバターとニックネームと削除済みの表示、偽の時計で30秒後に取り直すこと、送信中の無効化と成功後の取り直し、本文の規則の違反の表示、添付の入力欄に`contactAvailable`として`CLIENT_PROFILE.contactAvailable`を渡すこと、停止中に送信欄の代わりの案内と問い合わせフォームへのリンクが出ること、見つからない場合の表示を確かめるブラウザテストを書く
  - ログイン必須の経路に置き、未ログインはログインへ案内して戻り先を保つ。ページ全体の部品は`components/pages/inquiry-chat-page.tsx`、取得の設定・`loader`は`graphql/inquiry-chat.ts`、headは`buildInquiryChatHead`に置き、日時は`longDateTime`で表示する。チャットの操作を1ファイル1操作の`*.graphql`(操作名は`Client`で始める)で作り、型と許可リストを生成し直す
  - 完了状態: ブラウザテストが成功し、`runAxe`の違反が0件で、ローカルで添付付きの追加メッセージを送れる
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 8.1, 8.3, 8.6_

- [ ] 10. 管理画面
- [ ] 10.1 (P) 問い合わせの一覧と詳細のページを作る
  - 一覧・詳細・返信・ステータス・未対応の件数の管理者側の操作を`src/graphql/operations/admin/inquiry/`の1ファイル1操作の`*.graphql`(操作名は`Admin`で始める)で作り、adminで`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行して型と許可リストを生成し直す
  - ページ全体の部品は`components/pages/inquiries-page.tsx`・`inquiry-detail-page.tsx`、検索パラメータは`components/inquiry/admin-inquiry-search.ts`、取得の設定・`loader`は`graphql/admin-inquiries.ts`、前後のページは`frontend-lib/utilities/pagination/cursor-trail.ts`、headは`buildAdminPageHead`、ロールは文脈の`viewer`(`useCurrentAdmin`)から読み、日時は`longDateTime`で表示する(監査ログの一覧と同じ形)
  - 先に、絞り込み(ステータス・種別・カテゴリ・受付日の期間)がURLに保たれ閲覧者の地域の日付がUTCの期間へ変換されること、50件の前後のページ、退会済みの表示、ログインの詳細のメッセージと偽の時計での30秒後の取り直し、未ログインの詳細の連絡先とシステム外で返信する旨を確かめるブラウザテストを書く
  - 詳細のページに、後続specが操作を1行で足せる登録口(初版は空。2026-10-24の時点で登録するspecは無い)と、それを順序どおりに並べ操作ごとにエラー境界で包む表示を置く。先に、偽の操作を登録するとログイン・未ログインの両方の詳細に順序どおり文脈の値(問い合わせのID・種別・利用者のID・退会済みか・未ログインの連絡先メールアドレス)を受け取って表示され、1つの操作の失敗が詳細を止めず問い合わせのボタンと問い合わせを促す文を出さないこと、空の既定では何も描画しないことを確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、`runAxe`の違反が0件で、ローカルで一覧から詳細を開け、管理者側の操作が管理者側の許可リストにだけ載り、詳細の操作の登録口が空の状態で何も表示されない
  - _Depends: 1.9_
  - _Boundary: AdminInquiryPages, InquiryDetailActionsRegistry, InquiryDetailActionsView_
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [ ] 10.2 返信のフォームとステータスの操作を作る
  - 先に、モデレーター以上だけに表示され退会済みと未ログインでは返信が出ないこと、1,000書記素の検証、通知メールを送れなかった場合のトースト、送信の失敗で問い合わせを促さない文言(`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`)を出すこと、ステータスの変更の確認と任意の理由と監査ログに記録される旨の表示を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、ローカルで返信とステータスの変更ができる
  - _Depends: 10.1_
  - _Requirements: 11.1, 11.4, 11.7, 11.8, 12.5_

- [ ] 10.3 (P) カテゴリのページと区画の登録口を作り、問い合わせカテゴリの区画を登録する
  - 先に、区画が順序どおりに見出し付きで並び1つの区画の失敗が他を止めず問い合わせのボタンと問い合わせを促す文を出さないこと、問い合わせカテゴリの区画で追加・名前の変更・削除(紐付く件数を入れた付け替えの確認の文と監査ログに記録される旨)ができ「その他」は変更・削除できず、閲覧のみでは操作が無効になることを確かめるブラウザテストを書く
  - 区画の登録口は後続のproduct-launch・help-center・content-reportingが1行で足せる形にし、メニューの`/categories`(110)を登録する。ページ全体の部品は`components/pages/categories-page.tsx`に置く。区画は紐付く件数付きのカテゴリの操作(`adminInquiryCategories`)を読み、1.8で足した`deleteDescriptionOf`・`deleteAudited`を使う(G2)。カテゴリの管理者側の操作を`src/graphql/operations/admin/inquiry/`に1ファイル1操作の`*.graphql`(操作名は`Admin`で始める)で作り、型と許可リストを生成し直す
  - 完了状態: ブラウザテストが成功し、`runAxe`の違反が0件で、ローカルの`/categories`に問い合わせカテゴリの区画が表示される
  - _Depends: 1.8_
  - _Boundary: CategorySectionsRegistry, CategorySectionsView, InquiryCategorySection_
  - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.8_

- [ ] 10.4 ダッシュボードの未対応の件数のカードとメニューの項目を登録する
  - 先に、件数の表示と「未対応」で絞り込んだ一覧へのリンク、取得の失敗でカードだけにエラーと再試行が出ることを確かめるブラウザテストを書く
  - ダッシュボードのカードを順序20で、メニューの`/inquiries`(80)を登録する
  - 完了状態: ブラウザテストが成功し、ローカルのダッシュボードにカードが表示される
  - 10.1の操作の一覧と、10.3が追記するメニューの登録箇所を使うため、10.3の後に行う
  - _Depends: 10.1, 10.3_
  - _Requirements: 14.1, 14.3, 14.4_

- [ ] 11. 検証
- [ ] 11.1 利用者側の流れのE2Eテストを作る
  - 停止の状態は、admin-foundationのタスク12.1が用意したローカルのD1へSQLを実行する補助で用意する。本specで同等の補助を作らない
  - 未ログインの送信→送信完了、利用者の添付付きの送信→チャットへの遷移、停止中の利用者のフォーム(ニックネーム・連絡先の入力)の送信と既存のチャットの送信欄の代わりの案内を確かめる。未ログインの送信の回数制限の衝突は、利用者側のfixtureが組み込む既存の補助(ブラウザの文脈ごとに文書用の範囲から乱数の送信元IPを名乗る)で避け、本specで送信元IPの指定や補助を設けない(G6)
  - 完了状態: ローカルで起動したアプリに対するE2Eテストが成功する
  - _Requirements: 2.4, 3.1, 3.2, 5.1, 5.2, 7.8, 16.2_

- [ ] 11.2 管理画面とメールをまたぐ流れのE2Eテストを作る
  - 管理者の返信→Mailpitの通知メールのリンクでチャットを開き返信と管理者のニックネームを確認→添付のダウンロード、対応済にした問い合わせへの追加メッセージで未対応へ戻りダッシュボードの件数が増えること、未ログインの問い合わせの詳細に連絡先が出ること、カテゴリの追加→選択→削除で「その他」へ付け替わり「その他」に削除の操作が無いことを確かめる
  - 管理者は、admin-foundationのタスク12.1が用意したE2Eの補助(指定したロールの管理者を招待・完了・ログインさせる補助)でモデレーターとして用意する。本specで同等の補助を作らない
  - 完了状態: ローカルで起動したアプリに対するE2Eテストが成功する
  - _Depends: 11.1_
  - _Requirements: 1.2, 1.4, 1.5, 6.5, 7.4, 8.2, 10.5, 11.2, 14.1, 16.2_

- [ ] 11.3 カバレッジと品質ゲートを確かめる
  - 本specが追加・変更したアプリのコードについて、単体テスト・Workers統合テスト・ブラウザテストの行と関数のカバレッジが80%以上であること、bot判定が外部へ通信せずに検証されていること、新しいパッケージが加わっていないこと(各`package.json`の差分)を確かめ、足りなければテストを補う
  - 完了状態: 全アプリの一括検査とテストの一括実行が成功し、カバレッジの閾値を満たす
  - _Requirements: 16.1, 16.3, 16.6_

- [ ] 12. 文書
- [ ] 12.1 (P) 技術ドキュメント2本を書く
  - `security/008-anonymous-submission-protection.md`に未ログインの投稿の保護(bot判定と厳密な回数制限の順序、キーのハッシュ化、不明なIPの扱い、ログイン中の利用者を未ログインの経路から除く判定、状態の変更日時による保持期間の削除)を、`frontend/010-live-refresh-queries.md`に表示中の画面の定期再取得(間隔・非表示のタブ・画面へ戻った時・送信後の無効化・既定値との関係・テストでの時間の進め方)を、プロジェクト名やサービス固有の値を含めずに書き、各README.mdへ1行ずつ追記する
  - 完了状態: 2文書と索引が追加され、文書の整形と静的解析の検査に通る
  - _Boundary: InquiryDocs_
  - _Requirements: 16.4_

- [ ] 12.2 サービス仕様・オンボーディング・CLAUDE.mdを更新する
  - ページ配置(`/contact`の状態ごとのフォームと自分の一覧(前後のページ)・停止中の表示・チャットの定期再取得・管理画面の問い合わせとカテゴリのページの区画の分担)、文言規則(本specの文言と通知メールの要点)、データ保持期間の一覧(ログインの問い合わせ・回数制限のカウント・停止中の利用者の送信)、日次タイムライン(ジョブの表に本specの1行)、データエクスポートの`inquiries.json`(管理者の添付が無いこと・現在のカテゴリ名・問い合わせとメッセージの並び)を更新する
  - `docs/onboardings/project-values.md`の既存の節にジョブ・波及処理・メール種別・用途・閲覧の方針・監査ログの操作種別の値を足し、利用者側のbot判定のactionと回数制限の規則の節を新設して値を記載する。CLAUDE.mdの技術規則の参照先に未ログインの投稿の保護の文書へのリンクを加える
  - 完了状態: 各文書が更新され、文書の整形と静的解析の検査に通り、CLAUDE.mdのリンク先(12.1の文書)が存在する
  - _Requirements: 16.5_

## Implementation Notes

- 1.1: テーブルは`apps/db/schema/inquiry/`、マイグレーションは`20261105014859_inquiry_chat`(テーブル)と`20261105014904_inquiry_chat_seed`(初期データ、名前の衝突で何もしない)。「その他」の固定ID`01JC0000000000000000000000`のULIDの時刻部に合わせ`created_at`・`updated_at`は`1730871820288`。ステータスの値はスキーマの`INQUIRY_STATUS_VALUES`(`member-inquiries.ts`がexportし`guest-inquiries.ts`が再利用。スキーマはcommon-libを読み込めない)のため、1.2でcommon-libの`INQUIRY_STATUSES`との一致を単体テストで確かめる(legal-pagesの`legal-columns.unit.test.ts`と同じ形)。`status`の既定値は`open`、`system_default`の既定値は偽。添付の表は複合主キーで共通カラムなし、メッセージは`created_at`のみ(design.mdに従う。db/003の原則と異なる点は最終の報告に挙げる)。ローカルD1に以前の試行の残骸(`20261104124132_inquiry_chat`・`20261104124136_inquiry_chat_seed`の記録と5テーブル)があったため、ローカルの状態だけで消して適用し直した
- 1.2: 共有の定義は`apps/common-lib/inquiry/`の4ファイル(`inquiry-input-rules.ts`・`inquiry-attachment-limits.ts`・`inquiry-status.ts`・`inquiry-category-constants.ts`)。3つの入力の検証(`checkGuestNickname`・`checkInquiryBody`・`checkChatMessage`)はcoding/005に従い`'forbidden-character'`も返す(禁止文字→空→長すぎるの順、禁止文字は前後の空白を除く前に調べる。design.mdの契約も改めた)。この違反の文言は設計と文言規則に無いため、GraphQLの入力の検証(7.2)と画面(9.x・10.2)で決め、12.2で文言規則へ足す。ニックネームの改行は許可(identityの`checkNickname`と同じ)。メールアドレスの長さはidentityの`EMAIL_MAX_LENGTH`を使う。添付の上限はリテラルで書き`MAX_UPLOAD_BYTES`との一致を単体テストで確かめる。`checkAttachmentTotals`は件数→合計の順で、1ファイルの上限は`maxFileBytes`として出し用途側で守る。スキーマのステータスとの一致は`apps/api/src/application/inquiry/inquiry-columns.unit.test.ts`。`INQUIRY_CATEGORY_OTHER_ID`と初期データのIDの一致は3.2のWorkers統合テストで確かめるとよい
- 1.3: 5種別は`apps/common-lib/admin/audit-actions/inquiry-chat.ts`の`INQUIRY_AUDIT_ACTIONS`(`inquiry.reply`・`inquiry.status-change`(詳細`kind`・`fromStatus`・`toStatus`)・`inquiry-category.create`・`inquiry-category.rename`・`inquiry-category.delete`(詳細`reassignedCount`))で、集約点の末尾に連結した。集約点の全件を完全一致で確かめるテストは`index.unit.test.ts`と`apps/admin/src/components/pages/audit-logs-page.browser.test.tsx`(操作種別の選択肢)の2つで、後続のspecが種別を足す時は両方を直す
- 1.4: 種別は`apps/backend-lib/core/email/kinds/inquiry.ts`の`INQUIRY_REPLY_NOTIFICATION_KIND`(`inquiry.reply-notification`、既存の種別に合わせ`_KIND`で終わる名前にし、design.mdも改めた)。入力は`nickname`・`inquiryUrl`(既存の`linkUrlSchema`)・`repliedAt`(UTCのISO 8601)だけで他の項目は除く。テンプレートは`apps/event/src/infrastructure/email/templates/inquiry/`(テストは既存に合わせWorkers統合テスト)。本文「<日時>に、お問い合わせへの返信がありました。」「下のボタンからチャットページを開き、返信の内容を確認してください。」とプレビュー「お問い合わせへの返信がありました。チャットページで内容を確認してください。」は設計に無く実装で決めたため、12.2で文言規則へ写す
- 1.5: 定期再取得の値は`apps/frontend-lib/utilities/query/live-refresh.ts`の`LIVE_REFRESH_QUERY_OPTIONS`(30秒・非表示のタブで止める・画面へ戻った時に取得・`staleTime: 0`)。単体テストは静的解析で`utilities`から`start`を読めないため、アプリの既定値(`QUERY_STALE_TIME_MS`の30秒など)を写したQueryClientで確かめる(既定値を変えたら写しも直す)。部品は`apps/frontend-lib/components/inquiry/`の`InquiryStatusBadge`・`InquiryMessageCard`(本文はテキストで`whitespace-pre-wrap`、`className`も受ける)・`InquiryAttachmentList`(`PrivateFileLink`の隣に形式、不明は「不明な形式」)・`InquirerAvatar`(`xs`=32px・`sm`=64px、`alt`空の飾り)。「削除済みの管理者」は部品に持たせず呼び出す側が送信者名として渡す(9.3)。文言は`utilities/messages/inquiry-display-messages.ts`(「添付ファイル」)。12.1で`frontend/010-live-refresh-queries.md`を書いたら、005の定期再取得の行からリンクする
- 1.6: 契約は`apps/backend-lib/core/session/session-view.ts`・`core/identity/account-guard.ts`(`AccountGuard`・`CurrentUser`・`UserAccountView`)・`core/admin/audit-log.ts`・`core/admin/current-admin.ts`、識別子は`IDENTITY_PLATFORM_TYPES.AccountGuard`(apiのidentityのモジュールだけが束縛し、eventでは解決できない)・`ADMIN_PLATFORM_TYPES.AuditLogRecorder`。`CurrentUser.user`は実行時も`UserAccountView`の8項目だけ(`StoreAccountGuard`の`toUserAccountView`)で、`passwordHash`・`lifecycleVersion`が要るidentityのユースケースは`application/identity/current-user-record.ts`の`loadCurrentUserRecord`で読み直す。`UserAccountView.status`は`'active' | 'suspended'`のリテラル。`PreparedAuditEntry`の準備済みの印は型だけ(`declare const PREPARED: unique symbol`)で、`StoreAuditLogRecorder.prepare`だけが付ける。backend/002・006・007・008とsecurity/006・007を更新済み
- 1.7: `AuditGuard`はapiの`infrastructure/admin/audit-log-statements.ts`にあり、`{ kind: 'condition', condition: SQL }`を足した(`guardCondition`は`default`なしの網羅の`switch`)。`condition`は操作者の状態の確認を自動では付けない。テストの条件は`admins`表で作ったため、問い合わせの表の条件での取り消しは6.1・6.2のWorkers統合テストで確かめる
- 1.8: `CategoryMasterEditor`の`deleteDescriptionOf`・`deleteAudited`(既定は偽)を足した。説明は閉じる途中も残る削除の対象から作る。部品の削除の確認は理由の入力欄を持たない(`reason="none"`)ため、`inquiry-category.delete`の理由は`optional`でも画面では入力できない(008の「確認のダイアログは理由の要否を操作種別に合わせる」とのずれは最終の報告に挙げる)
- 1.9: 前後のページの補助は`apps/frontend-lib/utilities/pagination/cursor-trail.ts`(`EMPTY_CURSOR_TRAIL`・`previousPageOf`・`trailAfterNext`)。bot判定の操作名の写しの検査は`config/contract-copies.unit.test.ts`の`BOT_ACTION_COPIES`の配列で、7.2・9.1は本specの`INQUIRY_BOT_ACTIONS`と`components/inquiry/bot-actions.ts`の組をこの配列に足す(写しの先頭のコメントは「…の写し。一致はルートのconfig/contract-copies.unit.test.tsが確かめる」の形)。Bunの`test.each`は`$label`の直後の日本語を変数名に含めるため位置の`%s`を使う。監査ログのE2Eは`e2e/admin/admin-accounts.e2e.test.ts`にある(前後のページは確かめていない)
- 2.1: 規則は`apps/api/src/domain/inquiry/inquiry-status-rules.ts`(`statusAfterUserMessage`・`checkReplyable`・`checkStatusChangeable`と`AdminOperationDenial`)。戻り値は`Extract`で絞り、`checkReplyable`は未ログインを先に、`checkStatusChangeable`は退会済みを先に判定する。`domain/admin/admin-account.ts`にも同名の`AdminOperationDenial`があるため、検索で混同しないこと
- 2.2: 規則は`apps/api/src/domain/inquiry/inquiry-category-rules.ts`(`checkCategoryEditable`は標準カテゴリを`'protected'`、`sortCategories`は作成日時→IDの昇順で標準カテゴリを末尾)と`attachment-selection.ts`(`checkAttachmentSelection`は重複IDを1件にし、件数超過→無効なID→合計超過の順。無効なIDは重複を除き要求の順)。候補の`ownerKind`は`lib/core`の`MediaOwner['kind']`。4.1への申し送り: (1)候補の`deleted`は`deletedAt !== null || eraseRequested`にする(`MediaFilesService.claimFailureOf`と同じ)。(2)候補も`claim`も紐付け済み(`attached`)を調べず、`D1MediaFileStore.attach`も紐付け済みのファイルを通すため、自分の添付を別のメッセージへ使い回せる。4.1で紐付け済みのファイルを無効として扱うかを決める
- 3.1: ポートは`apps/api/src/application/inquiry/ports.ts`(設計のInquiryPortsと同じ構造で、インラインの型に`NewInquiryCategory`・`InquiryCategoryDeletion`・`MemberInquiryPage`・`NewAdminReply`・`AdminInquiryPage`・`AdminInquiryDetail`・`InquiryReplyNotification`・`InquiryIncidentKind`の名前を付けた)。識別子は`inquiry-types.ts`の`INQUIRY_TYPES`で、ユースケース・ポート・ジョブの19個(`GuestInquiryRateLimit`を含む)を先に定義した。`InquiryAttachmentReadPolicy`・`MemberInquiryWithdrawalHandler`は無いため、6.4・6.5で足す時は識別子の一覧を完全一致で確かめる`inquiry-types.unit.test.ts`も直す。エラーは`inquiry-errors.ts`の`INQUIRY_ERRORS`(`inquiry_attachments_invalid`は4.1で足す)。設計に無い`inquiry_category_not_found`(404、「カテゴリが見つかりません。」)を足し、design.mdの表にも加えた。名前の重複のエラーは詳細`{ field: 'name', code: 'name-taken' }`を持つ。カテゴリ名の規則はcommon-libの`checkInquiryCategoryName`(禁止文字→空→長すぎる。共有の`checkCategoryName`は変えていないため、管理画面の共有のフォームは禁止文字を調べない)で、文言「カテゴリ名に使用できない文字が含まれています。」は12.2で文言規則へ。ユースケースの単体テストは`application/admin`を読めないため偽の`AuditLogRecorder`を使い、操作種別の詳細の鍵は検証しない。削除は`countLinked`の件数を監査ログに残し、実際に付け替えた件数を返す。3.2への申し送り: `countLinked`・`countLinkedByCategory`と付け替えの`UPDATE`は同じ範囲(論理削除したログインの問い合わせを含めるか)で数える。送信(4.2・4.3)のカテゴリの確認と削除が重なった場合の扱いを確かめる
- 3.2: ストアは`apps/api/src/infrastructure/inquiry/d1-inquiry-category-store.ts`(`D1InquiryCategoryStore`)。標準カテゴリの保護と不在は`AuditGuard`の`condition`(`EXISTS(... id = ? AND system_default = 0)`)で、偽なら一括の書き込み全体が取り消され`not-found`(名前の変更にも付けた)。件数と付け替えは論理削除した(退会者の)ログインの問い合わせも含める(外部キーで残すと削除できないため。db/003の`notDeleted`の原則の例外で、理由をコメントに書いた)。付け替えで`updated_at`も更新する。消したカテゴリを参照する保存は外部キーの違反で失敗し、Drizzleが包むため4.2・4.3・6.1は`cause`をたどってカテゴリの不在に変える。テストの補助は`infrastructure/inquiry/testing/inquiry-store-fixtures.ts`(「その他」を残して5テーブルと監査ログを消すリセット、行の挿入、型の表明で作る`PreparedAuditEntry`。利用者はidentityの`lib/workers/identity/testing/identity-store-fixtures.ts`で入れる)。途中の失敗は一時的なSQLiteのトリガーで起こす
- 4.1: `MediaInquiryAttachmentBinder`(`application/inquiry/inquiry-attachment-binder.ts`)。紐付け済み(`attached`)のファイルも無効なIDにする(使い回すと保存の失敗の`release`が先のメッセージの添付まで論理削除するため。2.2の規則とdesign.mdも改めた)。ただし検証と紐付けは原子的でなく、同じ利用者の同時の送信で同じファイルが2つのメッセージへ紐付き得る(添付の表の`file_id`は一意でない。影響は本人のデータだけ)。エラーは`inquiryAttachmentsInvalidError(violation, requestedIds)`(`INQUIRY_ERRORS`の表には入れない)で、詳細は件数・合計なら`{ field: 'fileIds', code: 'too-many' | 'too-large' }`、無効なIDならファイルごとに`{ field: 'fileIds.<位置>', code: 'invalid' }`(`withInputPath`で`input.`が付く)。要求に無いIDを渡すと位置が`-1`になるため、7.2で使う時は要求のIDだけを渡す。`release`は所有を確かめないため、`bind`が返したIDだけを渡す。`claim`の一時的な障害はそのまま伝わる
- 4.2: `StoreGuestInquirySubmission`(`application/inquiry/guest-inquiry-submission.ts`)は利用者の判定→カテゴリの存在→回数制限→保存の順で、文字の検証とbot判定はリゾルバ(7.2)が先に行う。要求の情報は`application/inquiry/inquiry-request-meta.ts`の`InquiryRequestMeta`、カテゴリの不在は`inquiry-errors.ts`の`inquiryCategoryUnavailableError()`(詳細`{ field: 'categoryId', code: 'not-found' }`)で、4.3・5.1も再利用する。回数制限のポートは`consume(clientIp, now)`(design.mdも改めた)、実装は`infrastructure/inquiry/counter-guest-inquiry-rate-limit.ts`(`GUEST_INQUIRY_RATE_RULE`、キーは`hashRateLimitKey(hasher, 'inquiry-guest', clientIp)`、ログのカテゴリは`['api', 'inquiry', 'guest-rate-limit']`)。429は共通の`rate_limit_exceeded`と共通の文言(design.mdのエラーの表も揃えた)。「未対応」での保存は列の既定値に任せるため、6.1のWorkers統合テストで確かめる
- 4.3: `StoreMemberInquirySubmission`(`application/inquiry/member-inquiry-submission.ts`)は`requireWritableUser`→カテゴリの存在→`bind`→`insert`で、保存の失敗では`bind`が返したIDだけを`release`して同じ例外を投げ直す。6.1への申し送り: (1)`NewInquiryMessage`は送信者の種類を持たないため、`D1MemberInquiryStore.insert`・`appendUserMessage`が`sender_kind = 'user'`を書く。(2)カテゴリの削除と送信が重なった外部キーの違反は、ポートの`insert`が`void`を返すためユースケースでは見分けられない。ストア(ログイン・未ログインの両方の`insert`)が`cause`をたどって`inquiryCategoryUnavailableError()`に変える(ユースケースは添付を解放してそのまま伝える)
- 5.1: `StoreInquiryChatService`(`application/inquiry/inquiry-chat-service.ts`)。本文は`checkChatMessage`で検証し値を変えずに保存する(coding/005。4.3の最初のメッセージと同じ。管理者の返信も同じにする)。違反は`inquiryChatMessageRejectedError`(欄`body`、「メッセージに使用できない文字が含まれています。」「メッセージを入力してください。」「メッセージは1,000文字以内で入力してください。」。設計に無く、5.2の返信が再利用し、12.2で文言規則へ写す)。保存が`not-found`(確認の後に論理削除)なら解放して`inquiry_not_found`。6.1への申し送り(ステータスの競合): ユースケースは読んだ時点のステータスから`nextStatus`を渡すため、ストアが条件なしで書くと先に確定した管理者の変更を上書きする。6.1で(a)SQLの`CASE`でDBの現在の値から原子的に戻す(4つのステータスで`statusAfterUserMessage`との一致をWorkers統合テストで確かめる。`nextStatus`の引数が不要になれば5.1の呼び出しとdesign.mdのポートも直す)か、(b)読んだ時点のステータスを条件にして`conflict`を返すかを決める。`status_changed_at`の「変わるときだけ」もDBの現在の値で判定し、メッセージの`INSERT`にも`deleted_at IS NULL`の条件を付ける
- 5.2: `StoreInquiryAdminService`(`inquiry-admin-service.ts`、結果の型`AdminInquiryView`はログイン・未ログインの判別共用体)と`StoreInquiryReplyService`(`inquiry-reply-service.ts`、`InquiryReplyInput`・`InquiryReplyResult`)。返信は`checkChatMessage`→`InquiryAdminReader.findDetail`(設計の`findById`から変え、design.mdも改めた)→`checkReplyable`→`prepare`→`appendAdminReply`(`not-found`・`withdrawn`はエラー)→`UserContactDirectory.findContact`→`sendReplyNotification`。保存の後の連絡先の照会と送信の失敗は`reply-notification-failed`(属性は`inquiryId`だけ)で報告して`notificationQueued: false`(管理者の再送による二重の返信を防ぐ)。退会済みは`deletedAt !== null`で判定する。6.xへの申し送り: (1)`D1InquiryAdminReader.findDetail`と`listMessages`は論理削除した(退会済みの)ログインの問い合わせも返す(絞ると退会済みが`inquiry_not_found`になり要件10.7の表示も壊れる)。(2)`appendAdminReply`は同じ一括の書き込みで退会を確かめ直し`withdrawn`を返す。(3)要件14.2(未対応の件数に退会済みを数えない)は`countUnhandled`が担うため6.2のWorkers統合テストで確かめる。7.3への申し送り: 管理者の返信の送信者は`adminId`だけを返し、ニックネームと削除済みはリゾルバで`AdminDirectory.findProfiles`が解決する。`member`が無ければGraphQLで`null`、未ログインの`messages`はリゾルバが組み立てる
- 5.3: `StoreInquiryStatusService`(`inquiry-status-service.ts`)は`findDetail`→`checkStatusChangeable`→`prepare`→`change`。5.2に合わせて`InquiryAdminReader.findDetail`で読むため、ポートの`InquiryStatusStore.find`を消した(design.mdも改めた。6.2の`D1InquiryStatusStore`は`change`だけ)。ストアへ渡す`InquiryStatusTarget`は`kind`・`id`・読んだ時点の`status`・`withdrawn`で、6.2は「`id`と`status`が一致し、ログインなら`deleted_at IS NULL`」を条件にし、退会の確定との競合も`conflict`になる。同じ値への変更は`inquiryStatusUnchangedError()`(欄`status`・コード`unchanged`・「現在と異なるステータスを選択してください。」。設計に無く12.2で文言規則へ)。変更後の`AdminInquiryDetail`(ステータスと`statusChangedAt`だけ差し替え)を返すため、メッセージや利用者の表示が要る時は7.3のリゾルバが読み直す
- 5.4: ジョブは`application/inquiry/jobs/guest-inquiry-retention-job.ts`(閾値は予定時刻−14×24時間、500件ずつ最大20回、ログは`info`で`deleted`・`batches`・`limitReached`、例外は捕まえない)。定義`GUEST_INQUIRY_RETENTION_JOB_DEFINITION`(`inquiry-chat.guest-inquiry-retention`・4:21・`order` 300)をexportしたため、7.1は`composition/scheduled-jobs.ts`の`SCHEDULED_JOBS`の`order` 210と810の間にこの定数をそのまま入れ、同じ値をインラインで書き直さない(既存のジョブはインラインで書く)。対象を「対応済」「却下」と14日の境界に絞る正しさは6.1のWorkers統合テストで確かめる。12.xへの申し送り: ログのカテゴリ`['api', 'inquiry', 'guest-rate-limit']`(4.2)・`['api', 'inquiry', 'guest-inquiry-retention']`を`docs/GUIDES/tech/infra/004-logging-and-error-tracking.md`のカテゴリの表(admin-foundationが自分のカテゴリを加えた表)か`project-values.md`へ足すかを決める
- 6.1: `D1MemberInquiryStore`・`D1GuestInquiryStore`(`infrastructure/inquiry/`)。追加メッセージのステータスは案(a)で、`appendUserMessage`の`nextStatus`を外し、`statusAfterUserMessage`を4つの値に当てはめて組み立てたSQLの`CASE`で書き込みの時点の値から戻す(ports.ts・5.1のサービス・design.mdも直した)。論理削除済み・不在への追加は、メッセージの`inquiry_id`を`CASE WHEN EXISTS(...) THEN id ELSE NULL END`にしてNOT NULLの違反で全体を取り消し`not-found`。返信は`AuditGuard`の`condition`で取り消し、読み直して`not-found`/`withdrawn`。外部キーの違反は`category-reference-failure.ts`で`inquiryCategoryUnavailableError()`(利用者の外部キーの違反も区別できずカテゴリとして扱う)。添付の1文は`floor(100 / 列の数)`行(現在33行)。`findById`・`listMessages`は`notDeleted`を付けない(呼び出し側が`deletedAt`で判定)。カーソルは`inquiry-cursor.ts`(`encodeInquiryCursor`・`decodeInquiryCursor`、位置は`{ at, id }`、不正なら既存どおり`invalid_cursor`。design.mdも直した)で6.2も使う。8.2への申し送り: design.mdの`D1InquiryExport`の節とTesting Strategyに「不正な`after`は`validation_error`」が残っており、backend/004の`invalid_cursor`と食い違うので揃える。テストの補助に`messageIdOf`・`fileIdOf`・`insertInquiryMessage`・`insertAttachments`・`read*Rows`を足した
- 6.2: `D1InquiryStatusStore`(条件`EXISTS(... id = ? AND status = ? [AND deleted_at IS NULL])`を監査ログの`AuditGuard`と`UPDATE`に共有し、取り消しは`conflict`)と`D1InquiryAdminReader`(両テーブルを各々並べて51件に切り`UNION ALL`→並べ直して51件。期間は`receivedFrom`を含み`receivedBefore`を含まない。退会済みのログインの問い合わせは一覧に`withdrawn: true`で含め、`countUnhandled`だけが除く。未ログインの最後のメッセージの日時は受付日時)。カーソルの条件とページの組み立ては`infrastructure/inquiry/inquiry-page.ts`(`afterInquiryCursor`・`inquiryPageOf`)へまとめ、`MEMBER_INQUIRY_RECORD_COLUMNS`をexportした。カテゴリの絞り込みは`category_id`の索引だけを使い並べ替えに一時のB木が要る(件数が増えたら`(category_id, created_at)`の複合索引を検討)
- 6.3: `D1InquirerProfiles`(100件ずつ、画像は常に`null`、退会済み・停止中の利用者も返す。差し替える実装も守る契約としてdesign.mdに注記した)・`EmailInquiryMailer`(リンクは`new URL('/inquiries/' + encodeURIComponent(id), clientOrigin)`、期限なし)・`SentryInquiryIncidentReporter`(`captureException`で通知メールの失敗は`error`・添付の解放の失敗は`warning`、ログのカテゴリ`['api', 'inquiry', 'incident']`、`inquiryId`はULIDの形でなければ`unknown`)。7.2への申し送り: 要件2.3(停止中・未ログインの送信者の表示を空にする)は照会口ではなくリゾルバ(`inquiryComposer`)が担う。7.1への申し送り: `InquirySettings`はidentityと同じく`env.CLIENT_SITE_ORIGIN`から束縛する。テストのIDはULIDの形にし(既存の補助の`01JC0MINQ…`は`I`を含みULIDでない)、0が16個続くIDはログでカード番号として伏せられるため避ける
- 6.4: `InquiryAttachmentReadPolicy`(`infrastructure/inquiry/inquiry-attachment-read-policy.ts`)。管理者は添付の行があれば真(ロール・論理削除を問わない)、利用者は保有者が本人で、紐付けが無いか、紐付く問い合わせがすべて本人のもので論理削除されていない時だけ真。用途ごとの振り分けは`PolicyFileAccessAuthorizer`が担う。識別子`INQUIRY_TYPES.InquiryAttachmentReadPolicy`を足した(単体テストの完全一致の一覧も)。7.1は`file-read-policies.ts`へ`inquiry-attachment`の用途の方針として登録し束縛する
