# Research & Design Decisions

## Summary

- **Feature**: `admin-foundation`
- **Discovery Scope**: New Feature(管理者側の実装・モックアップは無い。上流の7spec(backend-platform・api-gateway・email-delivery・frontend-platform・content-processing・media-pipeline・identity-auth)の設計・タスクは承認済みで実装は未着手であり、本specはその契約の上に管理者のアカウント・認可・監査ログ・管理画面のシェルを新設する。セキュリティに直結するため完全な調査を行った)
- **Key Findings**:
  - identity-authの`auth`モジュールは主体に依存しない形で設計済みで、`LoginThrottleScope`に`'admin'`、Durable Objectの名前に`login-email:admin:<キー>`、HMACの用途に`admin-`の接頭辞、`AUTH_TYPES.AdminSessionVerifier`の差し替え口が用意されている。一方、`RequestMeta`・`IssuedSession`・`TotpSetupView`・`ReAuthenticator`・`MailSendLimits`は`application/identity`(利用者の層)にあるため、本specは同じ形の管理者用の型とユースケースを`application/admin`に持つ(`auth`は`identity`に依存しない規則のため、`admin`も`identity`に依存しない)。
  - frontend-platformの`BASE_SECURITY_POLICY_SOURCES`はTurnstileの許可先を両アプリに入れ、`TURNSTILE_SITE_KEY`は管理者側の変数にもあり、infra-deliveryのTurnstileのウィジェットは利用者側と管理者側の両ホスト名を対象にしている。管理者側でbot判定を使う(Q7)ための上流の変更は不要で、確認を再検証の対象にする。
  - media-pipelineのファイルの保有者はアップロードした主体である。最上位管理者が他の管理者のプロフィール画像を設定する(FR-ADMAC-012)と保有者が対象者と食い違うため、管理者の削除では保有者単位の削除(`eraseOwnedBy`)を使わず、管理者の行が参照する画像のIDで削除する。
  - D1の`db.batch()`は前の文の結果で後の文を変えられない。最後の最上位管理者の保護と監査ログの同時確定は、identity-authの`UserLifecycleCommitter`と同じく、先頭の監査ログの挿入の値を条件付きの`CASE`式にしてNOT NULL制約の違反で全体を取り消す方式で実現できる。
  - Claude設定のdenyが`wrangler d1 * --remote`を拒否するため、staging・prodでの招待の発行コマンドの実行は開発者の手作業になる。AIエージェントとE2Eは`--target local`だけを使う。

## 要件フェーズ前の確認事項(2026-10-23)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                   | 根拠                                                                                                                                      | 回答(2026-10-23)                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 最初の最上位管理者     | FR-ADMAC-004・FR-ADMAC-015、roadmapのRequirement Ambiguities、brief Constraints                                                           | 推奨案(CLIで招待を発行)。開発者が`infisical run`でペッパーを注入して`bun`スクリプトを実行し、最上位管理者ロールの招待をD1(ローカルまたはリモート)へ書き込み、招待URLを端末に表示する。最後の最上位管理者がTOTPを失ったときの復旧にも使える                                                                                                                                                                |
| Q2  | ダッシュボードの内容   | FR-ADMAC-001・FR-ADMUG-001、ページ配置の管理者側ページ一覧(ダッシュボード=週毎の統計グラフ)、brief Constraints                            | 選択肢2(要対応件数も表示)。区画の枠に加え、未対応の通報・問い合わせの件数カードをcontent-reporting・inquiry-chatが区画へ登録する。本specは登録口の契約を定義し、後続spec(inquiry-chat・content-reporting)が登録する作業はそれぞれのspecの担当として明記する。統計グラフはugc-moderationが登録する                                                                                                         |
| Q3  | ロールごとの権限       | FR-ADMAC-004・005・009・FR-ADMAC-012、FR-ADMAG-004・005・007・FR-ADMAG-023〜024、FR-ADMCF-001・008・022・024、FR-ADMUG各項、NFR-SECUR-008 | 選択肢3(招待・削除はモデレーターも)。招待と、最上位管理者以外のアカウントの削除をモデレーターにも許可する。ロール変更と最上位管理者の削除は最上位管理者だけ。その他の未明記の操作は推奨案と同じ方針(閲覧のみは全メニューの参照と自分のアカウントの編集だけ、モデレーターは要件が最上位管理者に限っていない更新操作をすべて行える、機能フラグは最上位管理者だけ)で補う。監査ログの閲覧は全ロールに許可する |
| Q4  | 管理者のTOTP紛失時     | FR-ADMAC-019・NFR-SECUR-033〜034、identity-authのQ8                                                                                       | 選択肢3(復旧手段を設けない)。リカバリコードを唯一の予備手段にする。ただし最後の最上位管理者が両方を失ったときは、Q1のCLIで新しい最上位管理者の招待を発行できる、という扱いでよいかを仮3として記録する                                                                                                                                                                                                     |
| Q5  | 初回プロフィール設定   | FR-ADMAC-010・FR-ADMAC-015、FR-INQRY-014、media-pipeline(アップロードにはログイン中の主体が要る)                                          | 選択肢2(画像は既定アイコン)。招待の完了時にニックネームだけを必須にし、画像は後から登録できる。未登録の間は既定のアイコンを表示する。FR-ADMAC-010(画像必須)と異なるため要件定義書の改訂が必要                                                                                                                                                                                                             |
| Q6  | 監査ログの理由欄       | FR-ADMAG-001〜003、FR-ADMUG-006・009・013〜014・025・044(「理由付き」と明記)、DR-001・DR-017                                              | 推奨案(理由付き操作だけ必須)。記録範囲はFR-ADMAG-001の列挙どおり                                                                                                                                                                                                                                                                                                                                          |
| Q7  | 利用者側決定の水平展開 | identity-authのQ1〜Q3・Q7、FR-USER-029〜031、FR-RLMIT-001、FR-ADMAC-016〜018、SW-018、CLAUDE.mdの水平展開の規則                           | 選択肢2(Turnstileも適用)。推奨案の内容(本人確認・操作端末以外の全セッション削除・変更完了の通知メール・メールの送信回数の制限・ログイン試行の扱い・漏洩照合の縮退)をすべて管理者にも適用し、さらに管理者のログインとパスワードリセット要求にもTurnstileを使う。管理者側CSPへの許可先の追加はfrontend-platformの再検証の対象として明記する。SW-018・FR-RLMIT-001などの改訂が必要                           |
| Q8  | 一覧部品のパッケージ   | brief Desired Outcome、FR-ADMAG-004、tech-stack.md(表・日付選択のパッケージは未採用)、CLAUDE.md(新規パッケージは候補を質問)               | 推奨案(追加しない)。一覧はshadcn/uiのTable(追加の依存なし)で作り、検索とページ送りはサーバー側で行う。期間の入力はネイティブの`<input type="date">`を使う                                                                                                                                                                                                                                                 |

### 提示した選択肢(記録)

- Q1: CLIで招待を発行(推奨・採用) / 初回セットアップ画面(管理者が0件の間だけ`ADMIN_BOOTSTRAP_TOKEN`を入力した人が作れる。公開ドメインに一時的な入口ができる) / 指定アドレスへ自動招待(最上位管理者が0件のとき`ADMIN_BOOTSTRAP_EMAIL`へ招待メールを自動送信) / シードデータのみ(ローカル・E2E専用)
- Q2: 区画の枠だけ用意(推奨) / 要対応件数も表示(採用。未対応の通報・問い合わせの件数カードをcontent-reporting・inquiry-chatが登録) / 自分の情報と案内(ロールとメニューへのリンク)
- Q3: 閲覧のみは参照だけ(推奨。招待・削除と機能フラグは最上位管理者だけ) / 監査ログは最上位だけ / 招待・削除はモデレーターも(採用。ロール変更と最上位管理者の削除は最上位管理者だけ。監査ログの閲覧は全ロール)
- Q4: 削除して再招待(推奨) / 最上位がTOTPを解除(全セッション削除・監査ログに記録、要件に無い管理操作が増える) / 復旧手段を設けない(採用。最後の最上位管理者は仮3)
- Q5: 初回ログイン時に必須(推奨) / 画像は既定アイコン(採用。要件定義書の改訂が要る) / 招待者が事前入力
- Q6: 理由付き操作だけ必須(推奨・採用) / 検索以外は全て必須 / 1に認証の記録を追加(ログイン・パスワード変更・TOTP再設定も記録)
- Q7: Turnstile以外を展開(推奨) / Turnstileも適用(採用) / 要件の文言どおり
- Q8: 追加しない(推奨・採用) / TanStack Tableを追加(`@tanstack/react-table` 9.2.8、MIT、2026-10-08公開。9.3.1は公開から2週間未満のため避ける) / 表と日付選択を追加(2に加えて`react-day-picker` 10.0.2、MIT、2026-09-30公開、`date-fns`に依存)

### 確認済みのため質問しない事項

- 認証部品: identity-authの`auth`モジュール(パスワード・秘密の発行とハッシュ化・セッションの有効期限・ログイン試行の制限・TOTP・リカバリコード)を再利用し、管理者用のテーブルとセッションは利用者と分ける(brief・identity-authの要件19)。HMACの用途は`admin-`で始め、ログイン試行のDurable Objectは`login-email:admin:<キー>`。IPアドレス単位の記録は利用者と共有する(identity-authのSupporting References)。
- セッションの検証: `composition/session.ts`の`AUTH_TYPES.AdminSessionVerifier`の束縛(既定は`InvalidSubjectSessionVerifier`)を管理者の実装へ1行で差し替える(identity-auth 19.5)。
- セッションの有効期限とCookie: アイドル1時間・絶対12時間(NFR-SECUR-029)、ログアウト時の即時物理削除(NFR-SECUR-030)、Cookie名`__Host-ls_admin_session`(frontend-platformの`ADMIN_PROFILE`)。期限切れのセッションは日次バッチで削除する(DR-019)。
- 認証系トークン: 招待とメールアドレス確認は24時間、パスワードリセットは30分で、1回の使用で失効させる。保存はHMACでハッシュ化し、再発行時と完了時に失効させる(NFR-SECUR-035〜037)。期限切れのトークンは日次で削除する(DR-020)。
- パスワードの規則: 8〜128文字、文字種は不問、漏洩照合、ニックネーム・メールアドレスのローカル部との一致を拒否する(NFR-SECUR-024〜026・028)。PBKDF2の方式はNFR-SECUR-004・005で決定済み。
- TOTPとQRコード: OTPAuthとuqr(tech-stack.md)。画面部品の`TotpQrCode`・`RecoveryCodeList`・`PasswordInput`は、identity-authが`frontend-lib/components/auth`に管理者側と共用する形で作る。管理者のTOTPは必須(NFR-SECUR-033)のため無効化の機能は設けず、再設定とリカバリコードの再発行だけを作る(FR-ADMAC-019)。
- メールアドレス変更・パスワードリセット要求の応答: 対象の有無によらず同一の応答にする(NFR-SECUR-043)。パスワード変更は要件どおり現在のパスワードを求め、メールでの確認は求めない(FR-ADMAC-017。利用者側のFR-USER-016とは異なる)。
- 管理者のプロフィール画像: media-pipelineの用途の登録で上限・画像形式を指定し、自動判定の対象にする。管理者のアップロードは`UploaderEligibility`の判定の対象外(media-pipeline 1.8)。
- メール: テンプレートは`@react-email/*`、送信元は「Launch Stadium」の`noreply@`、トランザクションメールとして抑止リストの対象外(email-deliveryのQ1・Q5・Q6)。
- 管理画面のシェル: frontend-platformの`AdminLayoutSlots`(`navigation`・`headerAccount`)へ差し込み、管理者側トップの仮ページを置き換える。16メニューの並びと内容はページ配置の管理者側ページ一覧を正とし、後続specが項目と画面を登録できる形にする(roadmapのShared seams)。
- 監査ログ: 本specが記録APIと閲覧画面を所有し、各specが記録を呼び出す(roadmapのShared seams)。対象がユーザーなら仮名化ID(FR-USER-004、identity-authが保存)だけを記録し、メールアドレス検索は検索文字列を記録せず、結果の仮名化IDを記録する(FR-ADMAG-002〜003)。3年を過ぎた項目は日次バッチ(4:21)で物理削除し、ジョブ名は`admin-foundation.<名詞句>`(DR-017・日次タイムライン)。対応完了日時や照会日時を後続specが照会できるよう、対象と操作種別で検索できる照会口を設計で用意する(FR-ADMUG-040、権利侵害対応フロー)。
- 理由欄に個人情報を含めない点: 機械的に判定できないため、入力欄の注意書きで扱う(FR-ADMAG-001、権利侵害対応フロー)。
- 管理者の削除: 全端末のセッションを物理削除する(FR-ADMAC-013)。最後の最上位管理者はロール変更・削除できない(FR-ADMAC-014)。削除された管理者の情報は、後続specが「削除済み」として表示する(FR-HELP-009・FR-INQRY-015)。
- プロフィールの編集範囲: 最上位管理者は全員、他のロールは自分だけを編集できる(FR-ADMAC-012)。メールアドレス・パスワード・TOTPは本人だけが変更できる(FR-ADMAC-016〜019)。
- 管理者のセッション一覧: 要件に無いため設けない(FR-USER-017は利用者だけが対象)。
- カテゴリマスタ: 各マスタは利用するspecが個別に所有し、本specは共通の編集UI部品だけを提供する(roadmapのBoundary Strategy・brief)。
- 統計グラフ(FR-ADMUG-001)・各管理機能の画面と操作・運営者による退会の管理画面は、ugc-moderationなどの後続specの担当(brief Out・identity-authのN-6)。
- CSRF・CSP・中継・クライアントIPの引き継ぎ: frontend-platformとapi-gatewayの契約で実装済み。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する。

### 仮決定(2026-10-23に開発者が承認)

設計中に生じた、開発者の判断を要する論点である。回答と上流specに最も整合する案を仮に採用して設計・タスクを作り、2026-10-23に開発者の確認を得て確定した。仮1〜仮5は採用した案のまま承認され、仮6は回答により管理者アカウントのメニューのURLを`/admins`から`/accounts`へ変更して承認された(URLとルートのパスを水平展開で直し、GraphQLの型名などURL以外の識別子は変えない)。仮3はQ4の回答で記録を求められた論点である。承認後のcross-spec reviewで加えた仮7(`AuditLogReader.latestForMany`と照会の共有の偽物)は2026-10-24に開発者が確定した(推奨どおり)。経緯は末尾の「cross-spec reviewの指摘による承認後の改訂(仮7)」に記録する。本specの仮の論点はすべて確定済みである。

| #   | 論点                                 | 確定した案                                                                                                                                                                                                                                                                                                   | 他の選択肢                                                 | 影響する箇所                                                  | 開発者の回答     |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------- | ---------------- |
| 仮1 | 自分自身のアカウントの削除           | 拒否する(`self_deletion_forbidden`)。削除が必要なら削除の権限を持つ他の管理者に依頼する。誤操作による締め出しを避ける                                                                                                                                                                                        | 最後の最上位管理者でなければ自分も削除できる               | 要件15.5、`checkDeletable`、エラーの表                        | 承認(2026-10-23) |
| 仮2 | プロフィール画像の「500kB」の解釈    | 512,000バイト(500KiB)。product-launchのロゴの上限(文言規則の「500kB」)も同じ解釈にそろえる。spec横断レビューで決まったプロジェクト全体の規則(1kB=1,024バイト)と一致する                                                                                                                                      | 500,000バイト                                              | 要件16.2、`admin-avatar`の用途、product-launchの再検証        | 承認(2026-10-23) |
| 仮3 | 最後の最上位管理者が両方を失った場合 | Q1の招待の発行コマンドで新しい最上位管理者の招待を発行する。締め出されたアカウントは新しい最上位管理者が削除する。復旧の機能は設けない(Q4と矛盾しない)                                                                                                                                                       | 何もしない(データベースを直接編集する以外に手段が無くなる) | 要件2.6、`operations/003`                                     | 承認(2026-10-23) |
| 仮4 | 招待の完了後の状態                   | 完了の時点でその端末をログイン状態にする(メールのリンクとTOTPの両方を確かめた直後のため)                                                                                                                                                                                                                     | 完了後にログイン画面へ案内し、改めてログインさせる         | 要件4.3、`AdminInvitation.complete`・`activate`               | 承認(2026-10-23) |
| 仮5 | 招待中のアカウントの扱い             | 一覧に「招待中」「招待期限切れ」として表示し、再送(リンクの再発行)と削除による取り消しを行える。再送は`admin-account.invite`として監査ログに記録する                                                                                                                                                         | 招待を別の一覧にする / 再送を設けず、取り消して招待し直す  | 要件3.3・3.4・15.1、`AdminInvitation.resend`、`displayStatus` | 承認(2026-10-23) |
| 仮6 | 管理画面のURL                        | 16メニューのURLを本specが定めてページ配置に記載する(`/`・`/users`・`/products`・`/comments`・`/ratings`・`/media-moderation`・`/reports`・`/inquiries`・`/sponsorships`・`/help-articles`・`/categories`・`/legal-documents`・`/settings`・`/accounts`・`/audit-logs`・`/account`)。認証の画面は`/auth/`の下 | 各後続specがURLを決める                                    | `ADMIN_NAV_ITEMS`、ページ配置、全後続spec                     | 変更(2026-10-23) |
| 仮7 | 後続specの監査ログの複数の対象の照会 | 本specが`AuditLogReader.latestForMany`と保存の照会(90件ずつ)と、照会の共有の偽物`createFakeAuditLogReader`を所有・実装する。cross-spec reviewの指摘による承認後の改訂で、2026-10-24に開発者が確定(推奨どおり)                                                                                                |

### 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂が必要である。

| 要件ID                 | 内容                                                                                                                                                                                                                       | 根拠    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| FR-ADMAC-010           | プロフィール画像を任意入力に改め、未登録の間は既定のアイコンを表示する旨を加える。上限「500kB」が512,000バイトであることを明記する                                                                                         | Q5・仮2 |
| FR-ADMAC-005           | ロールごとの権限の一覧(閲覧のみは参照と自分のアカウントの編集、モデレーターは最上位管理者に限られない更新操作と招待・最上位管理者以外の削除、最上位管理者はすべて、監査ログの閲覧は全ロール)を加える                       | Q3      |
| FR-ADMAC-001           | ダッシュボードに統計グラフと未対応の問い合わせ・通報の件数を表示する旨を明記する(明確化)                                                                                                                                   | Q2      |
| FR-ADMAC-016・017・019 | メールアドレス変更の要求・パスワード変更・TOTPの再設定・リカバリコードの再発行で、現在のパスワードと認証コード(またはリカバリコード)を求め、全セッションの削除の後に操作した端末にだけ新しいセッションを発行する旨を加える | Q7      |
| FR-ADMAC-016〜018      | メールアドレス変更完了(変更前のアドレス宛)・パスワードリセット完了・パスワード変更完了の通知メールを送る旨を加える(FR-USER-029〜031相当)                                                                                   | Q7      |
| FR-RLMIT-001           | 対象に管理者のメールアドレス変更の確認とパスワードリセット要求のメール(FR-ADMAC-016・018)を加える                                                                                                                          | Q7      |
| SW-018                 | 対象に管理者のログインとパスワードリセット要求(FR-ADMAC-002・018)を加える                                                                                                                                                  | Q7      |

identity-authが報告済みのFR-RLMIT-012・FR-RLMIT-020・NFR-SECUR-026の改訂は、管理者のログインにも同じく当てはまる(本specは同じ部品を使う)。

### 上流・後続specへの影響

- frontend-platform(再検証): 管理者側でbot判定を使うため、`BASE_SECURITY_POLICY_SOURCES`のTurnstileの許可先(`script-src`・`frame-src`の`https://challenges.cloudflare.com`)が管理者側のCSPにも入ること、`TURNSTILE_SITE_KEY`が管理者側の変数にあることを確かめる(Q7)。設計の上では既に満たされており、無ければ`ADMIN_SECURITY_POLICY`へ加える。`components/ui`に`table`・`select`を加える。
- identity-auth(再検証): `return-path.ts`・`fragment-token.ts`を`apps/frontend-lib/utilities/auth/`へ移して共用する。`AUTH_TYPES.AdminSessionVerifier`の束縛を差し替える(契約どおり)。
- infra-delivery(再検証): Supporting Referencesの「ホスト名から導かれる変数の値」の表にある、APIサーバーの`ADMIN_SITE_ORIGIN`(本specの所有、管理者側のホスト名から導かれる)の行と、名前と値の一致を確かめる(行はspec横断レビューでinfra-deliveryに追加済み)。
- media-pipeline: `UPLOAD_PURPOSES`へ`admin-avatar`を加える(契約どおり)。
- product-launch(後続): ロゴの上限「500kB」を512,000バイトと解釈する(仮2)。
- content-reporting(後続): `AuditLogReader.latestForMany`と保存の照会(90件ずつ)と照会の共有の偽物`createFakeAuditLogReader`を本specが所有・実装し(仮7)、content-reportingは使うだけである。
- inquiry-chat・content-reporting(後続): Q2により、ダッシュボードの区画`DASHBOARD_CARDS`へ未対応の件数のカード(order 20・30)を登録する作業を各specの担当として加える。両specのbriefへの追記を推奨する。ugc-moderationは統計グラフのカード(order 10)を登録する。
- 全後続の管理機能のspec: `ADMIN_NAV_ITEMS`へ定めたURLと`order`で項目を登録し(仮6)、`requireAdmin`でページ配置のロールの一覧に従ってロールを宣言し、`audit-actions/<spec名>.ts`で操作種別を登録して管理操作を記録する。roadmapのShared seams「画面シェル」「監査ログ」へ、ダッシュボードのカードとURLの分担の追記を推奨する。

## spec横断レビューの指摘の反映(2026-10-23に開発者が決定)

全specを横断したレビューの指摘と開発者の決定(2026-10-23)を、本specの要件の決定事項の表・設計・タスクに反映した。`spec.json`の承認の状態は変えていない。

| #   | 指摘                                                                                                                                 | 決定と反映                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| X1  | (判断)「kB」「MB」の解釈がspecごとに異なる(本specの仮2は1,024倍、inquiry-chatの仮3は1,000倍)                                         | プロジェクト全体で1kB=1,024バイト・1MB=1,048,576バイトとする(文言規則`docs/GUIDES/service/design/003-text-and-copy-rules.md`に記載)。仮2の512,000バイトはこの規則と一致するため値は変えず、要件の決定事項の表・仮決定の表・設計の再検証の条件に、規則に従う旨を加えた。本specの他のバイト数(トークン32バイト・ソルト16バイト)は単位の解釈を含まない                                                                                                                                                                                                                                                                                                                |
| X2  | (軽微)Revalidation Triggersの`AdminDirectory`の利用者がhelp-center・inquiry-chatだけで、legal-pages・ultras-subscriptionが漏れている | 各specのdesign.mdを読んで確かめ、help-center・inquiry-chat(返信した管理者の表示、データエクスポートの`adminNickname`)・legal-pages(版の公開者・下書きの保存者)・ultras-subscription(機能フラグの変更者)を列挙した                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| X3  | (軽微)E2Eで管理者を用意する補助が、legal-pages(`admin-sign-in.ts`)とinquiry-chat(`local-d1.ts`と招待の補助)で重複して作られる        | 本specが`e2e/support/admin-bootstrap.ts`(指定したロールの管理者を招待の発行コマンドで招待し、画面で完了させ、ローカルのD1でロールを設定してログインしたページを返す`signInAsNewAdmin`、再ログインの`signInAdmin`、`currentTotpCode`)と`e2e/support/local-d1.ts`(`executeLocalD1`・`sqlStringLiteral`)を所有する。設計のFile Structure Plan・AdminE2E・Testing Strategy・Revalidation Triggersとタスク12.1に反映し、legal-pages・inquiry-chatはこれを使う                                                                                                                                                                                                           |
| X4  | (判断)データエクスポートは各ドメインが自分のエクスポート部品を所有し、data-exportは他ドメインのテーブルを直接読まない                | 本specは利用者のデータを持たない(管理者・監査ログだけ)ため、エクスポート部品は持たない。ただしinquiry-chatのエクスポート部品`InquiryExport`(eventで動く)が返信した管理者のニックネームを要るため、`AdminDirectory`の契約とD1の実装を`apps/backend-lib/workers/admin/`へ置き、apiとeventの両方で束縛する`ADMIN_PLATFORM_MODULE`(`ADMIN_PLATFORM_TYPES.AdminDirectory`)を加えた。設計のBoundary・Dependency Direction・File Structure Plan・Components・Modified Files・Testing Strategyとタスク5.1・8.1に反映した。apiの後続specは`AdminDirectory`を`backend-lib/workers/admin`から読み込む。この置き場所の変更とapi・eventの両方での束縛は2026-10-23に開発者が承認 |
| X5  | (判断)利用者の連絡先の読み取りを、identity-authの共有の部品`UserContactDirectory`に一本化する                                        | 本specに利用者の連絡先(メールアドレス・ニックネーム)を読む部品は無い(管理者のメールは本specの`admins`、利用者のメールアドレス検索はugc-moderationの担当)ため、変更は無い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

- X4の置き場所の変更(2026-10-23に開発者が承認)は、管理者のストア(`AdminAccountStore`)の束縛をeventに持ち込まずに照会だけを共有するためである。後続のhelp-center・ultras-subscriptionは`AdminDirectory`の形(`findProfiles`)を使うだけで、置き場所の変更による振る舞いの差は無い。

## spec横断レビュー(2回目)の指摘の反映(2026-10-23)

2回目のspec横断レビューの指摘を、設計・タスクに反映した。`spec.json`の承認の状態は変えていない。

| #   | 指摘                                                                                                                                                        | 反映                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Y1  | (軽微)設計の上流への影響(infra-deliveryの行)とタスク12.4が、infra-deliveryの表へ`ADMIN_SITE_ORIGIN`の行を加える・開発者へ報告するとしていたが、行は既にある | 行の追加ではなく「名前と値の一致を確かめる」に改めた。設計の上流への影響、タスク12.4、本文書の「上流・後続specへの影響」を直した                 |
| Y2  | (軽微)E2Eの補助の利用者がlegal-pages・inquiry-chatだけで、ultras-subscription(機能フラグの設定に`executeLocalD1`を使う)が漏れていた                         | 設計のRevalidation Triggersとタスク12.1の完了状態を「管理画面のE2Eを持つ全後続spec(legal-pages・inquiry-chat・ultras-subscriptionなど)」に改めた |

- identity-authのユーザーライフサイクルの波及処理の`order`の契約が、各ドメインは0〜9999、identity-auth自身は10000以上に広がった。本specはユーザーライフサイクルの波及処理を登録せず、本文書・設計・タスクに旧い範囲への言及が無いことを確かめた。4:21のジョブの`order`(200・210)は変えない。

## Research Log

### 上流specの契約と不足

- **Context**: 本specは7つの上流spec(実装は未着手)の契約の上に作る。差し替える登録箇所と、足りない契約を洗い出した。
- **Sources Consulted**: `.kiro/specs/identity-auth/design.md`(`AUTH_TYPES`・`SessionPolicy`・`LoginThrottle`・`SubjectSessionVerifier`・`Login`・`ReAuthenticator`・`MailSendLimits`・`TotpManagement`・`AdministrativeWithdrawal`・Supporting References)、`.kiro/specs/api-gateway/design.md`(`Principal`・`SessionVerification`・`SessionAccess`・`GraphQLContext`・`CallerKind`)、`.kiro/specs/frontend-platform/design.md`(`AdminLayoutSlots`・`SecurityPolicySources`・`BASE_SECURITY_POLICY_SOURCES`・`ValidatedFrontendEnv`・`TurnstileWidget`)、`.kiro/specs/media-pipeline/design.md`(`UploadPurpose`・`MediaOwner`・`MediaFiles`・`MediaPicture`)、`.kiro/specs/email-delivery/design.md`(`EmailKind`)、`.kiro/specs/backend-platform/design.md`(`KeyedHasher`・`AppErrorKind`・`ScheduledJobDefinition`・`RateLimitCounterClient`・`BotVerifier`)、`.kiro/specs/infra-delivery/design.md`(Turnstileのウィジェット・ホスト名から導かれる変数)。
- **Findings**:
  - `SessionAccess`は呼び出し元が`admin`なら`subjectKind: 'admin'`で検証し、identity-authの`SubjectSessionVerifier`が`AUTH_TYPES.AdminSessionVerifier`へ振り分ける。差し替えはidentity-authが定めた1行で済む。
  - 利用者のユースケースが使う`RequestMeta`・`IssuedSession`・`TotpSetupView`は`application/identity`にある。`admin`が読み込むと「`auth`は`identity`に依存しない」の考え方に反し、管理者と利用者の層が結合する。
  - 管理者側のCSP・Turnstileのサイトキー・ウィジェットのホスト名は既に管理者側を含む。
  - `MediaFiles.claim`は保有者の一致を確かめ、保有者はアップロードした主体である。
  - `CLIENT_SITE_ORIGIN`に相当する管理者側のオリジンの変数はどのspecにも無い。
- **Implications**: 管理者用の`AdminRequestMeta`・`IssuedAdminSession`・`AdminTotpSetupView`を`application/admin`に定義し、`admin`から`identity`への読み込みを静的解析で禁止する。管理者側のオリジンは`ADMIN_SITE_ORIGIN`として本specが所有する。

### 監査ログの記録と層の規則

- **Context**: 監査ログを管理操作と同じ一括の書き込みで確定させたい(要件18.2)が、application層はdrizzleの型(`BatchItem`)を扱わない。
- **Sources Consulted**: identity-authの`UserLifecycleSyncHandler`(infrastructure層に置かれた文の契約)、backend-platformの層の規則、`db/002`のD1の制約。
- **Findings**: identity-authは同期の波及処理の文の契約をinfrastructure層に置き、application層のポートは状態の遷移だけを受け取る。
- **Implications**: application層の`AuditLogRecorder.prepare`で検証と正規化を済ませた値(`PreparedAuditEntry`)を作り、infrastructure層の`buildAuditLogStatements`で文にする。後続specも、ユースケースで`prepare`し、自分のストアの一括の書き込みに文を含める。

### 最後の最上位管理者の保護

- **Context**: FR-ADMAC-014の「1件しか無い場合」を、同時の操作でも破らないようにしたい。
- **Sources Consulted**: identity-authの`D1UserLifecycleCommitter`(先頭の挿入の`CASE`式で全体を取り消す方式)、D1の書き込みの直列化。
- **Findings**: D1は1つのデータベースへの書き込みを1つずつ処理する。一括の書き込みは1つのトランザクションで、途中の制約違反で全体が取り消される。
- **Implications**: 先頭の監査ログの挿入の`operator_admin_id`を、対象の存在・権限・有効な最上位管理者の残数の条件を満たすときだけ値にする`CASE`式にする。満たさなければNOT NULL制約の違反で取り消され、監査ログも残らない。

### 招待の発行コマンドとWrangler

- **Context**: 最初の最上位管理者を公開された入口なしに作る(Q1)。
- **Sources Consulted**: `.claude/settings.json`のdeny(`wrangler d1 * --remote`)、backend-platformのWrangler設定(`env.staging`・`env.prod`、D1のバインディング`DB`)、`docs/onboardings/README.md`(ローカルのポート、`--persist-to /workspace/.wrangler/state`)。
- **Findings**: `wrangler d1 execute`は束縛変数を受け付けないため、SQLのリテラルを安全に組み立てる必要がある。メールアドレスの形式(`html5Email`)はローカル部に`'`を許す。リモートへの実行はAIエージェントに拒否される。
- **Implications**: `sqlStringLiteral`で`'`を二重化し、制御文字を拒否する(単体テストで確かめる)。照会→判定→`--file`での書き込みの順にし、一時ファイルは実行後に消す。staging・prodの実行は開発者の手作業とし、`operations/003`と`docs/onboardings/README.md`に手順を書く。

### 一覧部品のパッケージ(Q8の調査)

- **Context**: Q8の選択肢を示すため、npmのレジストリで候補の版と公開日を確かめた(2026-10-23)。
- **Findings**: `@tanstack/react-table`の最新は9.3.1(2026-10-12公開、2週間未満)、その前は9.2.8(2026-10-08)。依存は`@tanstack/table-core`・`@tanstack/react-store`だけの純粋なJavaScript。`react-day-picker`は10.0.2(2026-09-30、`date-fns`・`@date-fns/tz`に依存)。
- **Implications**: 回答により採用しない。一覧はサーバー側の検索とページ送りのため、表の状態管理の部品は要らない。

## Architecture Pattern Evaluation

| Option                            | Description                                                        | Strengths                                      | Risks / Limitations                                        | Notes        |
| --------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------- | ------------ |
| `admin`モジュール(`auth`を再利用) | apiに管理者の4層のモジュールを置き、認証の規則は`auth`の部品を使う | 方式の食い違いが無い。利用者と管理者が独立する | 本人確認・送信回数の制限などのユースケースは管理者用に持つ | 採用         |
| `identity`のユースケースを汎用化  | 利用者のユースケースを主体の種類で分岐させて共用する               | コードの重複が減る                             | 承認済みのidentity-authの設計を大きく変える。分岐が増える  | 不採用       |
| 監査ログをイベントで非同期に記録  | 管理操作の後にQueueへ送り、eventで書く                             | 操作の応答が速い                               | 操作と記録の確定がずれ、記録の欠落を防げない               | 不採用(18.2) |

## Design Decisions

### Decision: 管理者の認証の部品の配置(Generalization・Build vs Adopt)

- **Context**: 管理者の認証を、利用者と同じ方式で作る(brief・identity-auth 19)。
- **Alternatives Considered**:
  1. identity-authの`auth`の部品を使い、管理者のユースケースを`application/admin`に持つ
  2. identity-authの利用者のユースケースを汎用化して共用する
- **Selected Approach**: 1。パスワード・秘密・セッションの有効期限・試行の制限・TOTP・リカバリコードは`auth`をそのまま使い、ログイン・本人確認・送信回数の制限・各手続きは管理者用に持つ。
- **Rationale**: identity-authの設計が「`auth`は主体に依存しない、`identity`は利用者」の分け方で承認済みで、admin-foundationが`identity`無しで再利用できるよう作られている。
- **Trade-offs**: 手続きの流れの一部が利用者と似た形になるが、管理者の要件(TOTP必須・招待・メール確認なしのパスワード変更)が異なるため、汎用化の分岐の方が複雑になる。
- **Follow-up**: 両者の規則(期限・文言・試行の制限)の一致を、同じ定数と同じエラーコードで保つ。

### Decision: 監査ログの操作種別の登録(Generalization)

- **Context**: 10以上の後続specが、それぞれの管理操作を同じ形で記録する(FR-ADMAG-001)。理由の要否(Q6)と、利用者の対象の仮名化ID(FR-ADMAG-002)を全specで守らせたい。
- **Selected Approach**: `common-lib/admin/audit-actions/`に、名前・表示名・対象の種類・理由の要否・詳細の鍵・対象の上限を持つ操作種別を、specごとのファイルで登録する。記録の検証は登録に従い、未登録・規則の違反は記録も操作も拒否する。common-libに置くため、管理画面も同じ表示名を使える。
- **Trade-offs**: 操作種別を加えるたびに共有ディレクトリのファイルが増えるが、specごとのファイルに分けて衝突を避ける。

### Decision: ダッシュボードとメニューの登録口(Generalization・Simplification)

- **Context**: 16メニューのうち12は後続specが作る。ダッシュボードには3つのspecがカードを置く(Q2)。
- **Selected Approach**: identity-authの`SETTINGS_NAV_ITEMS`と同じ形の、`ADMIN_NAV_ITEMS`(URL・表示名・`order`)と`DASHBOARD_CARDS`(識別子・`order`・幅・部品)の登録箇所を置く。カードは自分でデータを取得し、枠と状態の表示は`DashboardCardFrame`を使う。全ロールが全メニューを参照できる(Q3)ため、項目にロールの条件を持たせない。
- **Trade-offs**: ダッシュボードのデータを1回の問い合わせにまとめないため、カードの数だけ問い合わせが増える(3つまでで、管理画面の利用者は少数のため許容する)。

### Decision: 共通部品の置き場所

- **Context**: 一覧・確認・理由・カテゴリマスタの部品を後続specが使い、カタログ(Storybook)に載せる(要件21)。
- **Selected Approach**: GraphQLとアプリの型に依存しない部品は`apps/frontend-lib/components/admin/`に置き、Storybookに載せる。ログイン中の管理者のロールを読む`RoleGate`と`AdminViewerContext`は管理者側のアプリに置く。
- **Trade-offs**: 管理者側だけが使う部品が共有ディレクトリに入るが、Storybookのカタログがfrontend-libにあるため、そちらを優先した。

### Decision: 招待の2段階と状態

- **Context**: 招待の完了でパスワードとTOTPを設定するまでログインを制限する(FR-ADMAC-015)。TOTPの設定には秘密鍵の表示と認証コードの確認の2往復が要る。
- **Selected Approach**: 招待中の管理者の行を招待の時点で作り(一覧に表示できる、仮5)、1段目でトークンを消費せずにニックネームとパスワードのハッシュとTOTPの保留を保存し、2段目でトークンを1文で消費してから有効化・TOTP・リカバリコード・セッションを1つの一括の書き込みで確定する。
- **Trade-offs**: 消費の後に一括の書き込みが失敗するとトークンが失われるが、招待の再送で回復できる。

### Decision: 新しいパッケージを導入しない(Build vs Adopt、Q8)

- **Selected Approach**: 表はshadcn/uiの`table`(依存なし)、選択は`select`(既存の`radix-ui`)、期間は`<input type="date">`。TOTP・QRコード・画像のアップロードは上流のパッケージと部品を使う。

## Risks & Mitigations

- 最後の最上位管理者の締め出し — ロールの変更と削除の条件付きの一括の書き込み、自分自身の削除の拒否(仮1)、招待の発行コマンドによる新しい最上位管理者の用意(仮3)。
- 招待の発行コマンドのSQLの組み立て — リテラルのエスケープを単体テストで確かめ、メールアドレスの形式を先に検証する。一時ファイルは実行後に削除する。
- 監査ログの欠落 — 管理操作と同じ一括の書き込みで確定させる規約を`backend/008`に書き、後続specのレビューで確かめる。
- 後続specがロールの宣言を忘れる — ページ配置のロールの一覧を基準にし、`requireAdmin`を通らない管理者側の操作を各specのテストで確かめる(`backend/008`・`security/007`に規約を書く)。
- 上流の未実装 — 本specのタスクは上流の実装の完了を前提にし、無い場合は該当タスクを保留して報告する。

## References

- `.kiro/specs/identity-auth/design.md`・`research.md` — 認証部品・利用者の決定(Q1〜Q8・仮1〜仮6)
- `.kiro/specs/api-gateway/design.md` — セッションの受け渡し・GraphQLの文脈
- `.kiro/specs/frontend-platform/design.md` — 管理者側のレイアウトの区画・CSP・bot判定のウィジェット
- `.kiro/specs/media-pipeline/design.md` — 用途・保有者・画像の部品
- `.kiro/specs/infra-delivery/design.md` — Turnstileのウィジェット・ホスト名から導かれる変数
- `docs/GUIDES/service/design/002-page-layouts.md` — 管理者側の16メニュー
- `docs/requirements/README.md` — 4.20・4.22・6.2・7.1
- 参照したスキルの規則: cc-sddの`kiro-spec-requirements`(EARS・レビューの関門)、`kiro-spec-design`(設計の原則・完全な調査・統合・レビューの関門)、`kiro-spec-tasks`

## cross-spec reviewの指摘による承認後の改訂(仮7、2026-10-24)

- **状態**: 要件・設計・タスクの承認の後の改訂で、cross-spec reviewの指摘による。2026-10-24に開発者が確定した(推奨どおり)。管理者・利用者に見える振る舞いは変わらない(後続specへの照会口の追加)が、確定の記録として`requirements.md`の決定事項の表にも仮7の行を加えた。要件19.5(後続specが対象と操作種別から最新の監査ログの日時を照会できる照会口)の範囲に収まり、要件の変更は無い。
- **Context**: content-reportingが一覧の対応期間を求めるために`AuditLogReader.latestForMany`とその保存の照会を本specの実装に加え、他specのテストの照会の偽物も直すタスクを持っていた。他specの実装とテストを後続specが編集する分担になっていた。
- **Decision**: 本specが`AuditLogReader.latestForMany(input: { readonly action: string; readonly targetKind: AuditTargetKind; readonly targetIds: readonly string[] }): Promise<ReadonlyMap<string, Date>>`を所有・実装する。保存の照会は対象のIDの重複を除いて90件ずつ(操作種別と対象の種類を含めてバインド変数100個以内)に分け、対象ごとの`MAX(occurred_at)`を1回ずつ問い合わせ、記録の無い対象を含めない。あわせて、後続specの単体テストが共有する照会の偽物`createFakeAuditLogReader(overrides?)`(`application/admin/test-support/fake-audit-log-reader.ts`)を作る。
- **Reason**: 照会口と保存の実装とテストを所有するspecに置くと、契約の変更が1つのspecで閉じる。後続specが自分で偽物を書くと、`AuditLogReader`にメソッドを足すたびに全ての後続specの偽物が型検査で壊れるが、共有の偽物なら本specが既定の振る舞いを足すだけで済む。
- **変えた箇所**: 設計のRevalidation Triggers・ファイル構成・追跡表・`AuditLogRecorder・AuditLogReader`の契約と説明・`backend/008`の内容・Testing Strategy・Performance & Scalability、本書の後続specへの影響、タスク3.1・3.2・12.2。番号の変更は無い。
- **変更部分のタスクの検証**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定はPASSだった。軽微の指摘のうち、3.2の確かめる項目に空の入力を加え、本書の仮決定の表の前文に仮7の記録先を加えた。`spec.json`の`updated_at`を更新し、タスクの承認を保った。

## frontend-platformの実装で確定した契約の反映(2026-10-28、開発者の判断)

- frontend-platformが実装で確定した契約(同specのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に、開発者の判断(下流specの設計を今回改訂する)で本specの設計を合わせた。
- GraphQLの操作: 操作を各アプリの`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名を利用者側は`Client`、管理者側は`Admin`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む。`graphql()`を呼んで`.ts`のファイルに操作を書くと、操作の本文がブラウザのバンドルに残るため(frontend-platformの要件6.3)。
- フォーム: `useAppForm<TInput, TOutput>(schema, { defaultValues })`(`defaultValues`は全欄)と、必須の`onSubmitError`・任意の`serverFieldPrefix`を受ける`AppForm`の形にした。画面側のスキーマの`zod`の値は`utilities/validation/zod.ts`から読む(CSPの下で`new Function`の試行を止める`jitless`の設定を済ませた`z`)。
- 失敗の文言: `GraphQLClientError`でない例外に代えて画面に出す文言を`errorMessageOf(error, <プロファイル>.contactAvailable)`で選ぶ。管理者側には問い合わせの画面が無いため、`ErrorState`・`UnexpectedErrorView`に`contactHref`を渡さず、問い合わせの導線と問い合わせを促す文を出さない(frontend-platformの要件8.6・8.13)。
- bot判定: `TurnstileWidget`は非表示のウィジェットで場所を取らないため、画面に判定の枠の表示と場所を設けないことを明記した。
- 管理者側の画面シェル: `AdminLayout`はヘッダー・`navigation`の区画・本文だけを持ちフッターを持たないため、管理者側のナビゲーションのランドマークは`AdminNavigation`が描く名前付きの`nav`で満たす(frontend-platformの要件10.8)。768px未満の開閉ボタンはヘッダーと本文の間に出る。
- `CategoryMasterEditor`: 共通部品はアプリのプロファイルを読まないため、拒否・失敗の文言を選ぶ関数`failureMessageOf`をpropsに加えた。管理者側の画面は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`を渡す(help-center・inquiry-chat・product-launch・content-reportingのカテゴリの区画が使う)。
- `ConfirmActionDialog`: 同じ理由で、必須の`failureMessageOf: (error: unknown) => string`をpropsに加えた。`onConfirm`が例外を投げたら、ダイアログを開いたまま理由の入力を保ち、`failureMessageOf(error)`の文言をダイアログの中に`role="alert"`で示す。管理者側の画面は`(error) => errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`を渡す(後続specの確認のダイアログも同じ)。
- プロフィール画像の入力: `/account`の`ProfileSection`と`/accounts`の`AdminProfileDialog`に置くmedia-pipelineの`ImageUploadField`に、`contactAvailable`として`ADMIN_PROFILE.contactAvailable`を渡す(media-pipelineがアップロードの失敗の文言を選ぶために必須で受ける)。
- 変えた箇所: design.mdのAllowed Dependencies、上流specの変更の表のfrontend-platformの行、Technology Stackの画面の行、File Structure Planの`graphql/operations/admin/`、`AdminCommonParts`(`ConfirmActionDialog`・`CategoryMasterEditor`の`failureMessageOf`と失敗の文言)、`DashboardGrid`、`AdminNavigation`、管理者アカウントの削除・ロールの変更・招待の確認、Data Contracts & Integrationのアップロード、`frontend/009`の内容、Testing Strategyのブラウザテスト。tasks.mdの10.1・10.2・10.3・11.1・11.2・11.7。要件は変えていない。
