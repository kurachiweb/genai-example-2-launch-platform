# Research & Design Decisions

## Summary

- **Feature**: `user-profile-social`
- **Discovery Scope**: Complex Integration(プロフィールとフォローの実装は無い。上流の14spec(dev-tooling〜ultras-subscription)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはidentity-authの`users`・ライフサイクルの登録口・初期ハンドルの差し込み口、media-pipelineの画像の部品と保有者単位の操作、content-processingのマークダウンの部品、ultras-subscriptionの特典の判定、inquiry-chatの利用者の表示の照会口の上に、ハンドル基盤・プロフィール・公開プロフィールページ・フォロー・ファイルの波及処理を足す)
- **Key Findings**:
  - `users.handle`は`text collate nocase`で全行一意(identity-authの定義)だが、旧ハンドルは別のテーブルに置くため、現在のハンドルと他人の旧ハンドルの衝突はデータベースの一意制約だけでは防げない。D1の`db.batch()`は1つのトランザクションとして直列に実行されるため、保存の一括の書き込みの先頭の文に使用中の判定を埋め込み、使用中ならNOT NULL制約の違反で全体を取り消す方式(identity-authのライフサイクルのイベントの挿入と同じ)で、同時の保存の競合を防げる。
  - SQLiteの`NOCASE`はASCIIの英字だけを同一視する。ハンドルの文字種をASCIIの英数字・ハイフン・アンダースコアに限るため、JavaScript側の比較もASCIIの英字だけを小文字にすれば、データベースの判定と一致する。
  - media-pipelineの保有者単位の操作(`eraseOwnedBy`・`addReasonForOwner`・`removeReasonForOwner`)は、呼び出しのたびに対象をD1から求め直し、1回に1,000件まで処理して`hasMore`を返す。これをidentity-authの非同期の波及処理の`continue`へそのまま対応付けられる。ドメインのテーブルはファイルのIDを外部キー無しで持つ規約(inquiry-chat・admin-foundation)のため、後続specの行が残っていてもファイルの物理削除は止まらない。
  - 2026-10-24に開発者が仮1〜仮3を確定し、いずれも推奨と異なる案が選ばれた。仮1は保有者の居ないファイルを4:21に日次で消すジョブの常設(開発者の回答C)、仮2は他の利用者の旧ハンドルも設定でき設定の時点でその旧ハンドルを消す(B)、仮3は外部Webサイト10件(B)である。仮2はハンドル基盤の契約を変える(他の対象の旧ハンドルを使用中に数えず、保存の一括の書き込みで`previousHandleRelease`により解放する)。仮1はmedia-pipelineの`MediaFiles`に保有者のIDの一覧(`listOwnerIds`)の追加を求める。
  - TanStack Routerは接頭辞付きのパスパラメーター(`/@{$handle}`)と、`redirect()`の`statusCode`の指定に対応する。旧ハンドルの302は、公開プロフィールのルートの`loader`で`statusCode: 302`を明示して投げる。

## 要件フェーズ前の確認事項(2026-10-23、2026-10-24に開発者が確定)

本specは開発者に質問できない一括の作成で作り、開発者の判断を要する論点を次の表に記録して推奨案を仮に採用していた。2026-10-24に開発者が3件すべてを確定し、いずれも推奨と異なる案が選ばれた(下表の「確定」の列)。要件・設計・タスクは確定した案に合わせて直した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。本specに開発者の確認を待つ論点は残っていない。roadmapの「Requirement Ambiguities」の表には本specが担当する行が無いため、roadmapは変更していない。

| #   | 論点                                        | 根拠                                                                                                                                                                                                                                                                              | 選択肢                                                                                                                                                                                                                                          | 推奨                                                                                                                                                                                                                                                                                                 | 確定(2026-10-24に開発者が確定)                                                                                                                                                                                                                                    |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | stagingで先に物理削除された利用者のファイル | briefのConstraints(「取り残されたファイルを一度だけ消す手順を設けるか、stagingのデータなので受け入れるかは、要件フェーズで決める」)、roadmapのShared seams「ユーザーのファイルの波及処理」、identity-authの設計(外部キーを持たない`media_files`は取り残しの検出に掛からない)      | (A)一度だけ消す手順(保有者の利用者が存在しない`media_files`を探し、media-pipelineの`eraseNow`で消すコマンド)を設ける / (B)保有者が存在しないファイルを日次で消すジョブを4:21に常設する / (C)stagingのデータとして受け入れ、手順を設けない       | 推奨は(C)。prodは全specの完了後に一括でリリースする(roadmap)ため、波及処理の無い期間はstagingにしか生じない。stagingの利用者は検証用で、取り残しは容量だけの問題になる。(A)・(B)は本specの範囲で使い捨てのコードを増やす。開発者が消したい場合は、運用の報告に取り残しを探す問い合わせの例を記載する | 開発者の回答はC(日次のジョブの常設。本表の選択肢の(B)に当たる。推奨と異なる)。4:21のジョブ`user-profile-social.orphaned-file-sweep`(`order` 600)を常設し、media-pipelineの`listOwnerIds`で保有者を列挙して`users`に行が無い保有者のファイルを`eraseOwnedBy`で消す |
| 仮2 | 他の利用者が保持する旧ハンドルの扱い        | FR-UPROF-006(「設定済み」の判定の対象は他の利用者の現在のハンドル)、FR-UPROF-010・012(旧ハンドルの保持と302)、FR-USER-019(退会時に保持中の旧ハンドルを論理削除)、準拠方針の保持期間(旧ハンドルは無期限、置き換えまたは退会から14日で物理削除)、ページ配置の予約語(なりすまし対策) | (A)保持中の旧ハンドルは「使われている」として他の利用者の設定を拒否する(本人は戻せる) / (B)他の利用者も設定でき、設定された時点で元の保持者の旧ハンドルを消す / (C)他の利用者も設定でき、現在のハンドルを優先して解決する(旧ハンドルの行は残る) | 推奨は(A)。(B)・(C)では、共有済みの旧URLが予告なく別人のページへ転送先を変え、変更直後のハンドルを他人が取ってなりすます余地が生じる。保持は1件だけで次の変更で置き換わるため、占有は限られる。退会者の旧ハンドルは論理削除の後も物理削除まで占有し、現在のハンドルの扱い(FR-UPROF-006)とそろえる    | (B)を選択(推奨と異なる)。他の利用者の旧ハンドル(退会後に物理削除されていない利用者の分を含む)も設定でき、保存の一括の書き込みでその旧ハンドルの行を物理削除して転送を止める。ハンドル基盤の規則としてプロダクト・ヘルプ記事にも適用する                           |
| 仮3 | 外部WebサイトURLの件数の上限                | FR-UPROF-001・008(「複数の外部WebサイトURL」)、ページ配置(サイドバーに1件1行で縦に並べる)、データエクスポートの`websites[]`                                                                                                                                                       | (A)5件まで / (B)10件まで / (C)上限なし                                                                                                                                                                                                          | 推奨は(A)。サイドバーの1枚のカードに収まり、主要なSNS・ブログ・ポートフォリオを並べるのに足りる。(C)は保存の文のバインド変数と表示の長さに上限が要る                                                                                                                                                 | (B)を選択(推奨と異なる)。10件まで                                                                                                                                                                                                                                 |

### 確認済みのため質問しない事項

- ハンドルの規則: 英数字で始まり英数字・ハイフン・アンダースコアだけの25文字以内(FR-UPROF-003)。大文字小文字を区別しない一意性(FR-UPROF-005・006)、予約語の14語と大文字小文字を区別しない完全一致(ページ配置の「旧ハンドルの保持とリダイレクト」、FR-UPROF-013)。「設定済み」の判定の対象は未退会と退会後未削除の利用者(FR-UPROF-006)。表記はそのまま保存し、URLは大文字小文字を区別せずに解決して正規化のリダイレクトをせず、`<link rel="canonical">`で現在の表記を出す(ページ配置)。
- 大文字小文字だけの変更: URLは大文字小文字を区別せずに解決されるため、旧ハンドルとして保持する意味が無く、保持すると自分の現在のハンドルと衝突する。表記の更新だけとし、保持中の旧ハンドルを変えない(要件2.2)。要件定義書の「変更」の解釈であり、仮にしない。
- 予約語の一覧は利用者とプロダクトで共通(ページ配置)。ヘルプ記事・プロダクトカテゴリの予約語(FR-ADMAG-029など)はhelp-center・各specが決める。
- 文字数: ニックネーム25・ヘッドライン50・自己紹介5,000・外部Webサイトの名前25・URL2,048(文言規則の入力欄の文字数上限)。名前は任意(ページ配置「名前は任意入力のため、空ならホスト名を名前の位置に出す」)。URLは`https`・`http`の2,048文字以内の絶対URL(NFR-SECUR-046)。
- プロフィール画像: 500kB(512,000バイト、文言規則の容量の単位、admin-foundationの`admin-avatar`と同じ解釈)、画像5形式、差し替えは即時の物理削除(FR-FILEU-023)、削除は14日後の物理削除(FR-FILEU-024)。
- bot対策: プロフィールの編集(FR-USER-012)とフォロー・フォロー解除(FR-FOLOW-009)でTurnstileを検証する。
- メールアドレスが未確認の利用者の制限(FR-USER-006)にフォローは含まれ、プロフィールの編集とアップロードは含まれない(identity-authの`AccountUploaderEligibility`も未確認を拒否しない)。
- 公開範囲: 退会済み・存在しないハンドルは404、停止中は本人以外に404、停止中の本人には帯を出して編集の導線を出さない(ページ配置「ユーザー公開プロフィールの公開範囲」)。
- フォロー一覧は本人の設定ページ(`/settings/follows`)でだけ閲覧できる(ページ配置)。設定ページの`order`は`profile` 10・`follows` 50(identity-authの`SETTINGS_NAV_ITEMS`の規約)。
- Ultrasの加入表示: `UltrasEntitlements.isEntitledAt(userId, 現在時刻)`で判定し、Ultrasのテーブルを読まない(brief、ultras-subscriptionの後続specへの影響)。文言は「UltrasプランでLaunch Stadiumを応援しています。」(文言規則)。
- ファイルの波及処理の担当と`order`: 本specの600番台(roadmapの帯の割り当て)。1回1,000件と`hasMore`の`continue`への対応付け(media-pipeline・identity-auth)。
- `InquirerProfiles`の差し替え: 束縛だけを差し替え、形を変えない。管理画面の一覧の`D1InquiryAdminReader`は置き換えない(roadmap、brief)。
- データエクスポート: `profile.json`の`nickname`・`handle`、`manifest.json`の`user.handle`、ZIPのファイル名のハンドルは本specの出力用の部品が返す(roadmap「データエクスポートの出力」、identity-authの`AccountExport`は返さない)。`follows.json`はフォロー中の利用者だけで、退会・停止中の利用者を除く(データエクスポートの文書)。
- 新しいパッケージ: 要らない。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(ultras-subscriptionと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(ハンドル基盤・ユーザーライフサイクルイベント・可視性フィルタ・プラン判定・画面シェル・利用者の連絡先の照会・データエクスポートの出力・ユーザーのファイルの波及処理)。
- **Sources Consulted**: identity-auth・media-pipeline・content-processing・ultras-subscription・inquiry-chat・admin-foundation・api-gateway・frontend-platform・backend-platformの`design.md`、identity-auth・media-pipeline・inquiry-chat・ultras-subscriptionの`research.md`の後続specへの申し送り。
- **Findings**:
  - identity-auth: `users`の全列(`nickname`・`handle`は`text collate nocase`で全行一意)の定義はidentity-authが持ち、`nickname`・`handle`の変更は本specに委ねられている。初期ハンドルは`GENERATED_HANDLE_LENGTH`(12)・`GENERATED_HANDLE_ALPHABET`(英小文字と数字)で生成され、`HANDLE_AVAILABILITY`(`apps/api/src/composition/identity-registrations.ts`、既定は`D1HandleAvailability`で`users`の全行を大文字小文字を区別せずに照合)を本specが差し替える。`HandleAvailability.isAvailable(handle): Promise<boolean>`の形を変えない。
  - identity-auth: 同期の波及処理(`UserLifecycleSyncRegistration`、apiの`USER_LIFECYCLE_SYNC_HANDLERS`。利用者IDを条件にした集合の更新の文だけを返す)と非同期の波及処理(`UserLifecycleAsyncRegistration`、eventの`USER_LIFECYCLE_ASYNC_HANDLERS`。`done`・`continue`、冪等、`order`は同じ種類の中で重複不可)。`purge_due`では全ドメインの波及処理の完了後に`users`の行を消すため、本specの`users`への外部キーを持つ行は`purge_due`の波及処理で先に消す必要がある。
  - identity-auth: `AccountGuard`(`currentUser`・`requireUser`・`requireWritableUser`・`requireVerifiedUser`)、`visibleUsers()`(`deleted_at IS NULL AND status = 'active'`)、`UserAccountRules.canViewOwnProfile`、`SETTINGS_NAV_ITEMS`(`profile` 10・`follows` 50)、`SettingsShell`・`_authenticated`のレイアウト・`LoginRequiredDialog`・`viewerQueryOptions`・`AccountMenu`(公開プロフィール`/@<ハンドル>`へのリンク)。
  - media-pipeline: 用途は`apps/api/src/composition/upload-purposes.ts`の`UPLOAD_PURPOSES`へ`defineUploadPurpose`で登録する(命名例に`user-avatar`)。`MediaFiles.claim`(保有者と用途の一致・保存完了・未削除を確かめて紐付け)・`eraseNow`(差し替えの即時の削除)・`markDeleted`(13日後の日次バッチで削除)・`findMany`、`toMediaImage`(隔離中・削除待ちは`objectKey`が`null`)、`mediaFileLoader`、`ImageUploadField`・`MediaPicture`・`MediaPlaceholder`。保有者単位の操作は`OwnerRef { kind: 'user', id }`で、`OWNER_OPERATION_BATCH_LIMIT`は1,000。
  - content-processing: `markdownTextSchema({ label, maxGraphemes, required })`・`countGraphemes`・`hasForbiddenCharacters`(`apps/common-lib`)、`MarkdownEditor`(`preview`に表示と同じ`MarkdownRenderOptions`)、`useMarkdownOptions({ externalLinkRel, sameOriginLinkRel, idScope })`・`useRenderedMarkdown`・`CollapsibleMarkdownContent`。描画はフロントエンドで行い、APIはマークダウンの原文を文字列で返す。
  - ultras-subscription: `ULTRAS_TYPES.UltrasEntitlements`(`backend-lib/core/ultras/identifiers.ts`)の`isEntitledAt(userId, at)`。api・eventの両方に束縛済み。
  - inquiry-chat: `InquirerProfiles.findMany(userIds): Promise<ReadonlyMap<string, InquirerProfile>>`(`userId`・`nickname`・`handle`・`avatarFileId`)は`apps/api/src/application/inquiry/ports.ts`に定義され、`apps/api/src/composition/inquiry-module.ts`で`INQUIRY_TYPES.InquirerProfiles`を既定の`D1InquirerProfiles`(画像は常に`null`)へ束縛する。退会済みの利用者を返さない。
  - api-gateway: スキーマモジュールはルート型以外の型を複数のモジュールで定義できない。`GraphQLContext.assertHuman(action)`・`withValidatedArgs`・`CURSOR_PAGE_ARGS`・`encodeCursor`・`decodeCursor`・`toConnection`・`defineLoader`(既定の一括の件数50)。
  - frontend-platform: `executeGraphQL(document, variables, { turnstileToken })`は`cf-turnstile-response`へトークンを入れる。`useTurnstileToken`(`consume()`で使用済みにして再実行)・`TurnstileWidget`、`buildPageHead({ title, siteName, canonicalUrl })`、`NotFoundView`・`ErrorState`・`PartialErrorState`・`LoadingSkeleton`・`EmptyState`・`notify`・`useAppForm`・`FormField`・`applyServerFieldErrors`。
- **Implications**: 本specはidentity-auth・media-pipeline・inquiry-chatの差し替え・登録の契約の範囲だけで上流のファイルを変える(登録箇所への追記と、`HANDLE_AVAILABILITY`・`INQUIRY_TYPES.InquirerProfiles`の束縛の差し替え)。上流specの文書の変更は要らない。

### ハンドルの大文字小文字と照合規則

- **Context**: FR-UPROF-005・006、briefのConstraints(`textNoCase`はテーブルの新規作成時に指定する。`nocase`が同一視するのはASCIIの大文字小文字だけ)。
- **Sources Consulted**: SQLiteの照合規則(`NOCASE`はASCIIの26文字だけを同一視する)、backend-platformの`textNoCase`、`docs/GUIDES/tech/db/001`の「大文字小文字を区別しない列」。
- **Findings**: ハンドルの文字種をASCIIに限るため、`NOCASE`の一意索引で大文字小文字の違いの重複を防げる。JavaScriptの比較は`toLowerCase()`ではなくASCIIの`A`〜`Z`だけを小文字にする関数にしておけば、将来文字種が広がっても判定がデータベースとずれない。後から照合規則を変えるとテーブルの作り直しのマイグレーションになるため、旧ハンドルのテーブルも作成時に`textNoCase`を指定する。
- **Implications**: `common-lib/handles`に`toHandleKey`(ASCIIの英大文字だけを小文字へ)を置き、予約語・自分の旧ハンドルとの比較に使う。

### 同時の保存の競合

- **Context**: 要件1.6・3.4・4.14。現在のハンドルは`users`、旧ハンドルは`user_previous_handles`にあり、テーブルをまたぐ一意性は制約で表せない。
- **Sources Consulted**: `docs/GUIDES/tech/db/002`(D1の`db.batch()`は1つのトランザクション)、identity-authの`UserLifecycleCommitter`(イベントの挿入の`CASE`式でNOT NULL制約の違反を起こして全体を取り消す方式)、ultras-subscriptionの`D1PromotionSettingWriter`。
- **Findings**: D1は1つのデータベースへの書き込みを直列に実行し、`db.batch()`の文は1つのトランザクションで確定する。一括の書き込みの先頭の文の`NOT NULL`の列に「条件を満たせば値、満たさなければNULL」の`CASE`式を置けば、条件(他人の現在のハンドルと一致しない(他人の旧ハンドルは同じ一括の書き込みの`previousHandleRelease`で解放する、仮2)、利用者が可視、読み込んだ時点のハンドルから変わっていない)の判定と書き込みが同じトランザクションになる。`users.handle`の一意索引と`user_previous_handles.handle`の一意索引の違反も同じ一括の書き込みを取り消す。
- **Implications**: ハンドル基盤は「使用中なら真になるSQLの条件」(`handleOccupiedCondition`)を部品として提供し、各ドメインの保存の文の`CASE`式に埋め込ませる。違反の種類は書き込みの後に読み直して判定する(使用中なら`handle_unavailable`、ハンドルが変わっていれば`profile_update_conflict`、利用者が可視でなければ`account_unavailable`)。

### 旧ハンドルの転送とURL

- **Context**: FR-UPROF-007・012、ページ配置(大文字小文字を区別せずに解決し、正規化のリダイレクトはしない。canonicalを出す)。
- **Sources Consulted**: [TanStack Router Path Params](https://tanstack.com/router/latest/docs/framework/react/guide/path-params)(`{$param}`の接頭辞・接尾辞)、[RedirectType](https://tanstack.com/router/latest/docs/framework/react/api/router/RedirectType)(`statusCode`・`headers`)、モックアップ(`client/@{$handle}/index.tsx`)。
- **Findings**: ファイルルート`routes/@{$handle}.tsx`(パス`/@{$handle}`)でハンドルを受け取れる。`redirect()`は`statusCode`を指定でき、既定値は文書に明記されていないため、302を明示する。転送は一時的な扱い(FR-UPROF-012)で、次の変更で転送先が変わり得るため301にしない。
- **Implications**: ルートの`loader`がGraphQLの`publicProfile`の結果(プロフィール・転送・無し)で、描画・`redirect({ to: '/@{$handle}', params, search, statusCode: 302 })`・`notFound()`を分ける。形式に合わないハンドルは照会せずに`notFound()`にする。

### フォローの保存と一覧

- **Context**: FR-FOLOW-001〜010、FR-USER-019・022、NFR-PERF-007・008。
- **Sources Consulted**: identity-authの`visibleUsers()`、api-gatewayのカーソルの部品、モックアップの`FollowButton`・`FollowerCount`。
- **Findings**:
  - 組`(follower_id, followee_id)`の一意索引と`follower_id <> followee_id`のCHECKで、重複と自分自身へのフォローをデータベースでも防げる。フォローの冪等性は`INSERT ... ON CONFLICT DO NOTHING`、解除は`DELETE`(物理削除、FR-FOLOW-002)で表せる。
  - 退会時の論理削除(FR-USER-019)は`deleted_at`で表し、可視の判定(FR-FOLOW-010)は`users`との結合と`visibleUsers()`で行う。停止の解除で一覧と数に戻るため、停止中の除外は記録を変えずに読み取りで行う。
  - 一覧は`(created_at DESC, id DESC)`のカーソル(`encodeCursor({ t, id })`)で21件を読み、先頭20件と続きの有無を返す。可視でない利用者は結合の条件で除くため、1ページの件数は保たれる。索引は`(follower_id, created_at, id)`・`(followee_id, created_at, id)`。
  - フォロワー数は`COUNT(*)`を同じ結合で数える。規模(同時接続100人、NFR-PERF-004)では集計の列を持たずに済む。
- **Implications**: `user_follows`を本specが所有し、フォロー・一覧・数・エクスポート・通知の照会をすべてこのテーブルへの問い合わせで行う。

### 保有者単位のファイルの操作と波及処理の順序

- **Context**: briefのScope・Constraints(`eraseOwnedBy`・`addReasonForOwner`・`removeReasonForOwner`、600番台、`purge_due`での上流のドメインの行の削除の後、後続specの行がファイルを参照していても止まらないか)。
- **Sources Consulted**: media-pipelineの`MediaFilesService`・`MediaQuarantineService`の規則、identity-authの`UserLifecycleRunner`、roadmapの帯の割り当ての表、inquiry-chat(`inquiry_message_attachments.file_id`は外部キーなし、`purge_due` 300)、admin-foundation(`admins.avatar_file_id`は外部キーなし)、payments(`purge_due` 400)、ultras-subscription(`purge_due` 500)。
- **Findings**:
  - `purge_due`の実行順は300(inquiry-chatの問い合わせ・添付の紐付け)→400(paymentsのCustomer)→500(Ultras)→600番台(本spec)→1000番台以降(product-launchなど後続)→10000(identity-auth)→`users`の物理削除。本specの600(プロフィール・フォロー)・610(ファイル)は上流のドメインの行の削除の後に動く。
  - ドメインのテーブルは`media_files`へ外部キーを持たない規約のため、後続specの行(プロダクトのロゴのIDなど)が残っていても`eraseOwnedBy`は失敗しない。後続specが`media_files`へ外部キーを張ると、この順序でファイルの削除が失敗する(Revalidation Triggersに記載する)。
  - 停止中の利用者のアップロードはidentity-authの`AccountUploaderEligibility`で拒否されるため、`addReasonForOwner`の後に理由の無い画像が新たに保存されることは無い(media-pipelineの設計)。
  - 本specの`users`への外部キーを持つ行(プロフィール・外部Webサイト・旧ハンドル・フォロー)は、identity-authの最後の`users`の削除より前に消す必要がある。被フォロー側の行(他の利用者が退会者をフォローした行)も`followee_id`の外部キーのため消す。
- **Implications**: `purge_due`に`user-profile-social.profile-erasure`(600。フォローを1,000件ずつ消し、無くなったらプロフィール・外部Webサイト・旧ハンドルを消す)と`user-profile-social.owned-file-erasure`(610。`eraseOwnedBy`)、`suspended`・`unsuspended`に`user-profile-social.owned-image-quarantine`(600)を登録する。`withdrawn`の論理削除は同期の波及処理`user-profile-social.withdrawal`で、退会の確定と同じ一括の書き込みにする。

### フォローボタンのbot対策

- **Context**: FR-FOLOW-009、frontend-platformの`useTurnstileToken`。
- **Findings**: トークンは1回だけ使え、`consume()`で使用済みにしてウィジェットを再実行する。フォローと解除を同じ`action`(`follow`)にすると、ボタン1つにウィジェット1つで済み、切り替えの後も次のトークンが用意される。未ログイン・未確認・本人にはウィジェットを置かない。
- **Implications**: `FollowButton`がウィジェットとトークンを持ち、`followUser`・`unfollowUser`のリゾルバが`assertHuman('follow')`を呼ぶ。トークンの準備前に押されたら、準備が終わるまでボタンを読み込み中にする。

## Architecture Pattern Evaluation

| Option                                           | Description                                                                                                | Strengths                                                                         | Risks / Limitations                                                                  | Notes                   |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| 対象ごとの旧ハンドルのテーブルと共通の部品(採用) | 対象(利用者・プロダクト・ヘルプ記事)ごとに旧ハンドルのテーブルを持ち、共通の部品がテーブルの記述を受け取る | 外部キーで対象の行に結び付き、対象の物理削除と一緒に消せる。briefのApproachどおり | テーブル定義の形をそろえる部品が要る                                                 | `previousHandleColumns` |
| 全対象で1つの旧ハンドルのテーブル                | `(namespace, owner_id, handle)`の1テーブル                                                                 | テーブルが1つで済む                                                               | 対象の行への外部キーを張れず、削除の漏れを検出できない。名前空間の値の管理が要る     | 不採用                  |
| 現在のハンドルと旧ハンドルを1テーブルにまとめる  | 対象ごとに「現在・旧」の行を持つハンドルのテーブル                                                         | 一意索引1つで全ての衝突を防げる                                                   | `users.handle`(identity-authの定義)と二重になり、identity-authのテーブルの変更が要る | 不採用                  |

## Design Decisions

### Decision: ハンドル基盤を「対象の記述」と純粋な規則に分ける

- **Context**: brief(対象テーブル・旧ハンドル保持テーブル・予約語一覧を引数で受け取る)、要件3。
- **Alternatives Considered**:
  1. 利用者専用に作り、後続specが写して使う
  2. 純粋な規則(`common-lib/handles`)と、テーブルの記述を受け取るD1の部品(`backend-lib/workers/handles`)に分ける
- **Selected Approach**: 2。`HandleNamespace`(名前・規則・現在のハンドルの列・旧ハンドルのテーブルと列)を定義し、解決(`resolveHandle`)・使用中の判定(`isHandleOccupied`)・保存の`CASE`式に埋め込む条件(`handleOccupiedCondition`)・旧ハンドルの置き換えの文(`previousHandleUpsert`)を関数として提供する。旧ハンドルのテーブルの列は`apps/db`の`previousHandleColumns`でそろえる。
- **Rationale**: product-launch・help-centerは自分のテーブルを定義して記述を渡すだけで同じ規則になる。プロダクトカテゴリは旧ハンドルを持たない(ページ配置)ため、旧ハンドルの記述を省ける。
- **Trade-offs**: 保存の`CASE`式の組み立ては各ドメインに残る(状態の条件が対象ごとに違うため)。

### Decision: 他人の旧ハンドルは設定でき、設定の時点で解放する(仮2、2026-10-24に選択肢Bで確定)

- **Context**: 当初は推奨の「使用中として拒否する」(A)を仮に採用していたが、開発者が(B)を選んだ。
- **Selected Approach**: `isHandleOccupied`・`handleOccupiedCondition`の既定は、他の対象の現在のハンドル(全行)だけを使用中とする。他の対象の旧ハンドルと同じ文字列を現在のハンドルとして保存する一括の書き込みは、現在のハンドルの更新の後に`previousHandleRelease(db, ns, { handle, exceptOwnerId })`を含め、その旧ハンドルの行(論理削除済みを含む)を物理削除する。保存と解放が同じトランザクションのため、ある対象の現在のハンドルと同じ文字列が他の対象の旧ハンドルとして残らない。解決(`resolveHandle`)は現在のハンドルを優先し、旧ハンドルは論理削除されていないものだけを返す。旧ハンドルを解放できない保存(identity-authの登録の一括の書き込み)だけは`includePrevious: true`で旧ハンドルも避ける。
- **Rationale**: 開発者の決定。ハンドルの占有を減らし、使われなくなった旧ハンドルを他の利用者が使える。
- **Trade-offs**: 共有済みの旧URLは、他の利用者が設定した時点で別人のページを表示する。編集画面の旧ハンドルの案内で、転送が止まりうることを示す。
- **後続specへの契約の変更**: help-center・product-launchは、ハンドルの作成・変更の一括の書き込みに`previousHandleRelease`を加え、使用中の判定から他の対象の旧ハンドルを外す(下の「上流・後続specへの影響」)。

### Decision: 保有者の居ないファイルの日次の削除(仮1、2026-10-24に開発者が確定。回答C=日次のジョブの常設)

- **Selected Approach**: apiの4:21のジョブ`user-profile-social.orphaned-file-sweep`(`order` 600)が、media-pipelineの`MediaFiles.listOwnerIds({ kind: 'user', after, limit: 90 })`で保有者のIDを順に読み、`users`に行の無い保有者ごとに`eraseOwnedBy`を`hasMore`が偽になるまで呼ぶ。1回の実行で合計1,000件までとし、残りは翌日に続ける。
- **Rationale**: 保有者の判定に本specが`media_files`を直接読まないよう、media-pipelineに保有者のIDの一覧を依頼する。存在の判定は`users`の行の有無で、物理削除前の退会者のファイルを消さない。
- **Trade-offs**: media-pipelineの契約への追加が実装されるまで、ジョブを登録できない(タスク6.3は保留して報告する)。保有者の全件を毎日読むため、利用者が増えると4:21の処理時間が延びる(roadmapの4:21の予算の論点、backend-platform・launch-readiness)。

### Decision: プロフィールの保存を1つの一括の書き込みにする

- **Context**: 要件1.6・2.1〜2.3・4.3・4.14・5.3〜5.5。
- **Selected Approach**: (1)`user_profiles`の挿入または更新(`user_id`を`CASE`式で守る: 利用者が可視、読み込んだ時点のハンドルから変わっていない、新しいハンドルが使用中でない)→(2)`users`の`nickname`・`handle`の更新→(3)ハンドルを別の文字列に変えた場合だけ旧ハンドルの置き換え→(4)外部Webサイトの全削除と挿入。画像は保存の前に`claim`し、保存の確定の後に以前の画像を`eraseNow`(差し替え)または`markDeleted`(削除)する。
- **Rationale**: 項目ごとの部分的な保存が起きず、競合はすべて一括の書き込みの取り消しになる。`claim`は既に紐付け済みなら変えないため、保存の失敗後の再送でも成功する。
- **Trade-offs**: 保存に失敗して利用者が離れると、紐付けた画像が参照されないまま残る(物理削除の時期まで)。admin-foundationの`AdminProfile`と同じ割り切りとする。

### Decision: 公開プロフィールの区画の登録箇所

- **Context**: brief(後続specが区画を追加できる)、ページ配置(タブ「ローンチ履歴」「Upvote履歴」、受賞バッジ、「…」メニューの通報)。
- **Selected Approach**: clientの`composition/public-profile-sections.ts`に`PUBLIC_PROFILE_TABS`・`PUBLIC_PROFILE_BADGES`・`PUBLIC_PROFILE_MENU_ITEMS`(初版はすべて空)を置き、ページの枠が`order`順に描画する。区画にはハンドル・ニックネーム・本人か・停止中かだけを渡す。
- **Rationale**: `SETTINGS_NAV_ITEMS`・`PRICING_SECTIONS`と同じ形で、後続specが本specのファイルを書き換えずに済む。利用者のIDをブラウザへ出さず、各区画はハンドルで自分のデータを引く(`UserHandleResolver`)。

### Decision: 利用者の表示用の照会を本specが持つ

- **Context**: 要件12.1・12.2、FR-INQRY-005・FR-COMNT-003・FR-DIR-005(他の機能もプロフィール画像とニックネームを並べる)、NFR-PERF-008。
- **Selected Approach**: `UserProfileDirectory.findSummaries(userIds, scope)`(`backend-lib/workers/profile`、api・event)と、GraphQLの共通の型`UserSummary`と`userSummaryLoader`を本specが提供し、`InquirerProfiles`の画像付きの実装もこれを使う。
- **Rationale**: プロフィール画像のIDを持つのは本specだけで、他の機能が`user_profiles`を読むと境界が崩れる。

### Decision: 採らなかった案

- フォロワー数の集計の列: 規模に対して不要。停止・停止解除で数え直す処理が要る。
- フォロー一覧の各行のフォロー解除のボタン: 要件定義書に無く、行ごとにbot対策のウィジェットが要る。解除は公開プロフィールで行う。
- 旧ハンドルを複数保持する: FR-UPROF-010で1つと決まっている。
- 公開プロフィールのGraphQLで利用者のIDを返す: ULIDから登録の時刻が推測できるため、ハンドルだけを公開の識別子にする(DR-001)。

## Synthesis

- **Generalization**: 利用者・プロダクト・ヘルプ記事・プロダクトカテゴリのハンドルを「対象の記述」1つで扱う基盤にした。公開プロフィールの区画(タブ・バッジ・メニュー)を登録箇所への追記に一般化した。プロフィール画像とニックネームの表示を、問い合わせ・コメント・サポーター一覧などで共通の照会と型にした。
- **Build vs Adopt**: 画像の受け付け・判定・配信・削除はmedia-pipeline、マークダウンはcontent-processing、bot対策はbackend-platformとfrontend-platform、特典の判定はultras-subscription、ライフサイクルはidentity-authの部品を使う。ハンドルの規則とフォローは既存の部品が無いため作る。新しいパッケージは無い。
- **Simplification**: フォロワー数の集計の列・旧ハンドルの複数保持・一覧のフォロー解除を持たない。4:21のジョブは仮1の確定により1つだけ持つ。

## Risks & Mitigations

- 保存に失敗した後に利用者が離れると、紐付けたプロフィール画像が参照されないまま残る — 物理削除の時期の`eraseOwnedBy`で消える。admin-foundationと同じ割り切りとし、`backend/011`には書かず設計に記録する。
- 後続specが`media_files`へ外部キーを張ると、`purge_due`の610でファイルの削除が失敗する — Revalidation Triggersと`backend/007`への追記で、ファイルのIDを外部キー無しで持つ規約を明記する。
- 人気の利用者の退会で、被フォローの行が多い — 1,000件ずつ消して`continue`を返す。
- フォローボタンが置かれる画面ごとにTurnstileのウィジェットが読み込まれる — ウィジェットはログイン中・確認済み・本人以外のときだけ描画する。
- 他の利用者が旧ハンドルを設定すると、共有済みの旧URLが別人のページを表示する(仮2の確定) — 編集画面の旧ハンドルの案内で、他の利用者の設定で転送が止まることを示す。
- 4:21のジョブが保有者の全件を毎日読む(仮1の確定) — 1回の削除を1,000件に限り、件数をログに残す。処理時間の予算はroadmapの4:21の論点で扱う。
- identity-authの`/settings`は最小の`order`の項目へ移動するため、本specの`profile`(10)を足すと`/settings`の移動先が`/settings/account`から`/settings/profile`に変わる — identity-authのE2Eが`/settings`の移動先を確かめていれば期待値が変わる(上流・後続specへの影響に記載)。

## References

- [TanStack Router Path Params](https://tanstack.com/router/latest/docs/framework/react/guide/path-params) — `/@{$handle}`の接頭辞付きのパラメーター
- [TanStack Router RedirectType](https://tanstack.com/router/latest/docs/framework/react/api/router/RedirectType) — `statusCode`の指定
- [GitHub TanStack/router #707](https://github.com/TanStack/router/issues/707) — `/@ChannelName`の形のURLへの対応の経緯
- [SQLite Datatypes(Collating Sequences)](https://www.sqlite.org/datatype3.html#collation) — `NOCASE`はASCIIの英字だけを同一視する
- `docs/GUIDES/service/design/002-page-layouts.md` — 公開プロフィール・設定・予約語
- `docs/GUIDES/service/features/001-user-data-export.md` — `profile.json`・`follows.json`

## 決定事項(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。当初は推奨案を仮に採用して要件・設計・タスクを作り、2026-10-24に開発者が確定した。3件とも推奨と異なる案が選ばれたため、要件・設計・タスクを確定した案に合わせて直した。本specに開発者の確認を待つ論点は残っていない。`requirements.md`の「要件フェーズでの決定事項」にも同じ行がある。

| #   | 論点                                        | 確定した案(2026-10-24)                                                                                                                                                      | 当初の推奨                                           | 影響する箇所                                                                                                                                                                              |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | stagingで先に物理削除された利用者のファイル | 開発者の回答C(日次のジョブの常設。推奨と異なる)。保有者の利用者が存在しないファイルを4:21のジョブ`user-profile-social.orphaned-file-sweep`(600)で日次に物理削除する         | stagingのデータとして受け入れ、手順を設けない        | 要件11.9、`OrphanedFileSweepJob`・`ProfileStore.findExistingUserIds`、media-pipelineの`listOwnerIds`(依頼)、タスク3.2・6.3・9.2、日次タイムライン、roadmapの帯の表                        |
| 仮2 | 他の利用者が保持する旧ハンドルの扱い        | 選択肢B(推奨と異なる)。他の利用者も設定でき、設定を確定した時点で元の保持者の旧ハンドルを物理削除し転送を止める。ハンドル基盤の規則としてプロダクト・ヘルプ記事にも適用する | 使用中として他の利用者の設定を拒否する(本人は戻せる) | 要件1.4・1.7・1.8・2.4・2.7・3.4・3.8、`isHandleOccupied`・`handleOccupiedCondition`・`previousHandleRelease`、タスク1.3・2.1・3.2〜3.4・5.5・9.1・9.2・10.1、help-center・product-launch |
| 仮3 | 外部WebサイトURLの件数の上限                | 選択肢B(推奨と異なる)。10件まで                                                                                                                                             | 5件まで                                              | 要件4.6、`PROFILE_WEBSITES_MAX`(10)・位置のCHECK(0〜9)、文言規則、タスク1.1〜1.3・5.2・8.1、data-export・public-apiの確認                                                                 |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID                              | 内容                                                                                                                                                                                                                                                                                                                                            | 根拠    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| FR-UPROF-010・012                   | 保持中の旧ハンドルは、他の利用者が同じ文字列をハンドルとして設定した時点で削除し、その旧ハンドルによるリダイレクトを止める旨を加える(「変更前の文字列を1つだけ保持しなければならない(既存の保持分は置き換え、他の利用者が同じ文字列を設定した場合は削除する)」)。同じ方式を参照するFR-PRDCT-020・021・FR-ADMAG-026・FR-HELP-011も同じ規則になる | 仮2     |
| FR-UPROF-008                        | 外部WebサイトURLの件数の上限(10件)と、名前が任意である旨を加える(「…複数(10件まで)の外部WebサイトURLを、任意の25文字以内の名前と共に…」)                                                                                                                                                                                                        | 仮3     |
| FR-USER-022の注記またはDR-002の注記 | 保有者の利用者が存在しないファイルを日次バッチで物理削除する旨(取り残しの防止)を加える(必須ではない。追記を推奨)                                                                                                                                                                                                                                | 仮1     |
| FR-UPROF-010                        | 大文字小文字の表記だけの変更では旧ハンドルを保持しない旨を加える                                                                                                                                                                                                                                                                                | 要件2.2 |

## 上流・後続specへの影響

- identity-auth(上流): ファイルの変更は契約の範囲だけである。`apps/api/src/composition/identity-registrations.ts`の`HANDLE_AVAILABILITY`を本specの`PROFILE_TYPES.UserHandleAvailability`へ差し替え、`USER_LIFECYCLE_SYNC_HANDLERS`(api)・`USER_LIFECYCLE_ASYNC_HANDLERS`(event)・`SETTINGS_NAV_ITEMS`(client)へ行を足す。`/settings`の移動先が最小の`order`の`/settings/profile`に変わるため、identity-authのE2E・ブラウザテストが`/settings`の移動先を`/settings/account`と確かめていれば期待値が変わる(本specのタスク8.2で確かめ、該当すれば同じタスクで直す)。
- media-pipeline(上流): `UPLOAD_PURPOSES`に`user-avatar`を足す(契約どおり)。加えて仮1の確定により、`MediaFiles`へ次の操作の追加を依頼する(本specはmedia-pipelineのspecを編集しない)。`listOwnerIds(input: { readonly kind: UploaderKind; readonly after: string | undefined; readonly limit: number }): Promise<{ readonly ownerIds: readonly string[]; readonly next: string | undefined }>`。`media_files`の`owner_kind = kind`の`owner_id`を重複を除いて昇順(`owner_id > after`)に最大`limit`(1〜500)件返し、続きがあれば最後のIDを`next`に入れる。索引`(owner_kind, owner_id)`を使い、ファイルの状態(削除待ち・隔離中など)を問わない。media-pipelineの要件・設計(`MediaFiles`・`D1MediaFileStore`)・タスク(Workers統合テスト)への追加が要る。
- inquiry-chat(上流): `apps/api/src/composition/inquiry-module.ts`の`INQUIRY_TYPES.InquirerProfiles`の束縛を本specの`ProfileInquirerProfiles`へ差し替える(契約どおり、形は変えない)。既定の`D1InquirerProfiles`とそのテストは残す。
- ultras-subscription(上流): 変更は無い。`UltrasEntitlements.isEntitledAt`を使う。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は600、波及処理は600・610」になる(仮1の確定)。本specはroadmapを編集しない指示のため、コントローラーへ報告する。
- product-launch・help-center・プロダクトカテゴリを扱うspec(後続): `common-lib/handles`の`HANDLE_PATTERN`・`checkHandleFormat`・`isReservedHandle`・`IMPERSONATION_RESERVED_HANDLES`、`apps/db`の`previousHandleColumns`、`backend-lib/workers/handles`の`defineHandleNamespace`・`resolveHandle`・`isHandleOccupied`・`handleOccupiedCondition`・`previousHandleUpsert`・`previousHandleRelease`を使う。仮2の確定(2026-10-24、選択肢B)による契約の変更: (1)`isHandleOccupied(db, ns, handle, { exceptOwnerId?, includePrevious? })`・`handleOccupiedCondition(ns, handle, { exceptOwnerId? })`は既定で他の対象の現在のハンドルだけを使用中とし、他の対象の旧ハンドルを数えない(`includePrevious: true`は旧ハンドルを解放できない保存だけが使う)。(2)ハンドルを新しい文字列で保存する作成・変更の一括の書き込みは、現在のハンドルの更新(または挿入)の後に`previousHandleRelease(db, ns, { handle, exceptOwnerId }): BatchItem<'sqlite'>`を含める(作成では`exceptOwnerId`に新しい対象のID)。他の対象の旧ハンドルの行は論理削除済みを含めて物理削除され、転送が止まる。(3)使用中の判定の文言・エラーの場面から「他の対象の旧ハンドル」を外し、編集画面の旧ハンドルの案内を「他の対象が同じハンドルを設定すると転送が止まる」に改める。help-centerは仮4(他の記事の旧ハンドルを使用中とする)と要件7.4・設計の`HelpArticleEditor`・`D1HelpArticleStore`・不変条件・テスト・`backend/011`への節を、product-launchは仮5の旧ハンドルの部分と同じ箇所を、この規則に直す(開発者の回答の第1回で両specの旧ハンドルの決定も(B)になっている)。プロダクトのハンドルの予約語は利用者と同じ一覧(ページ配置)。プロダクトの退会時の旧ハンドルの論理削除(FR-USER-019)はproduct-launchが自分の同期の波及処理で行う。
- product-launch・match-engine(後続): 公開プロフィールの`PUBLIC_PROFILE_TABS`にタブ(`launches` 10・`upvotes` 20)を登録し、ハンドルから利用者を`UserHandleResolver`で解決する。ファイルのIDは`media_files`へ外部キーを張らない(`purge_due`の610の物理削除を止めないため)。
- content-reporting(後続): `PUBLIC_PROFILE_MENU_ITEMS`に「このユーザーを通報」(order 10)を登録する。
- product-launch(後続、受賞バッジ): `PUBLIC_PROFILE_BADGES`に受賞バッジの区画`product-launch.award-badges`(order 10)を登録する。受賞のまとめの規則`groupAwards`と受賞の供給元(`LAUNCH_SUMMARY_SOURCES`)を持つproduct-launchが登録する(product-launchの仮14、spec横断レビュー、2026-10-24)。
- directory-discovery(後続): プロダクト詳細の投稿者の横に`FollowButton`を置き、投稿者の表示に`UserSummary`を使う。
- engagement・match-engine(後続): コメントの投稿者・サポーターの一覧の表示に`UserSummary`と`userSummaryLoader`を使う。
- notifications(後続): フォロワーへの通知の宛先の候補を`FollowerDirectory.listVisibleFollowerIds`で引く(受信設定・確認済みの判定は通知の側で行う)。
- data-export(後続): `ProfileExport.find`・`FollowExport.listFollowing`を呼び、本specのテーブルを直接読まない。プロフィール画像の実体はmedia-pipelineの`openContent`で読む。仮3の確定で`websites`は最大10件になる。data-exportの設計の`profile.websites`の型には件数の前提が無いため変更は不要だが、件数を前提にした検査・テストの値(5件)があれば10件に改める。
- public-api(後続): プロフィールの照会と更新は`ProfileEditor`・`MyProfileReader`(apiのapplication層)を呼ぶ。仮3の確定で`PATCH /v1/me/profile`の`websites`は最大10件(`PROFILE_WEBSITES_MAX`)になる。public-apiは件数を`common-lib/profile`の定数で検査し、OpenAPIの`maxItems`・文書・テストに5件を直書きしていれば10件に改める。仮2の確定で、`PATCH /v1/me/profile`のハンドルの変更でも他の利用者の旧ハンドルを設定でき(エラーにならない)、その旧ハンドルが消える旨を公開APIの文書に反映する。bot対策の検証はGraphQLのリゾルバで行い、ユースケースには含めないため、APIキーの経路から同じユースケースを呼べる。
- ugc-moderation(後続): 停止・停止解除の操作で本specの`user-profile-social.owned-image-quarantine`が動く。
- launch-readiness(後続): 4:21のジョブに`user-profile-social.orphaned-file-sweep`(600)が加わる(仮1)。4:21の処理時間の予算の検証に含める。

## 設計のレビュー(2026-10-23)

- 機械的な確認: 要件の111件の受け入れ基準の番号がすべて追跡表にあることを確かめた。境界の4節は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、(1)旧ハンドルの論理削除済みの行が解決に出ないこと(退会者への転送の防止)、(2)本人の停止中の公開プロフィールで旧ハンドルの転送を許すこと、(3)`purge_due`でフォローの被フォロー側の行も消すこと、(4)`HANDLE_AVAILABILITY`の判定に予約語を含めることを直した。2回目で問題は無かった。

## タスクの計画の検証(2026-10-23)

- タスクのグラフのサニティレビューを2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
- 1回目の判定はNEEDS_FIXES(必須2件・軽微6件)だった。指摘は、(1)ユースケースがハンドルの使用中の判定をD1の関数から直接呼ぶ形になっていた(`ProfileStore.isHandleOccupied`をポートに加え、設計と3.2〜3.4に明記)、(2)公開プロフィールの部品の順序が逆で、7.2の完了状態(2カラム)が観測できなかった(7.2を区画の型と登録箇所、7.3をカード、7.4を枠とタブ、7.5をルートに再編し、テスト用の登録で確かめる)、(3)DIの識別子の担当の重なり(2.2が4つを一括で作る)、(4)4.1の依存の注記(ポートを含め`2.2, 3.2`に依存)、(5)5.4・5.5のBoundaryに共有のモジュールが無い(追記し、5.5は5.4の後)、(6)6.2の完了状態を確かめる手順が無い(media-pipelineの実装を使うWorkers統合テストに変更)、(7)9.2が9.1の見出しに依存(CLAUDE.mdの追記を9.1へ移動)、(8)GraphQLのタスクが大きい(5.1〜5.3に分割)である。すべて直した。
- 2回目の判定はPASSだった。軽微の指摘(7.2の`_Depends: 7.1`は実際の依存ではない)に従い、依存の注記を削除した。

## 変更履歴(2026-10-24、spec横断レビュー)

- 文言の修正(振る舞いの変更なし、cross-spec reviewの指摘による): 受賞バッジの区画`PUBLIC_PROFILE_BADGES`を登録するspecを「受賞を扱うspec」から、product-launch(`product-launch.award-badges`、order 10、product-launchの仮14)に改めた。requirements.mdの関連specの一覧、design.mdのNon-Goals・Revalidation Triggers・`PUBLIC_PROFILE_BADGES`のコメント、本書の後続specへの影響を直した。登録箇所の形と初版が空であることは変えていない。

## 変更履歴(2026-10-24、開発者の確定の反映)

- 仮1〜仮3を2026-10-24の開発者の確定に合わせて直した。3件とも推奨と異なる案である。
  - 仮1(回答C、日次のジョブの常設): 保有者の居ないファイルを4:21に日次で消すジョブ`user-profile-social.orphaned-file-sweep`(600)を加えた。要件11.9を書き換え、設計に`OrphanedFileSweepJob`・`ProfileStore.findExistingUserIds`・フロー・media-pipelineへの`listOwnerIds`の依頼を、タスクに6.3を加え、3.2・9.2・10.3を直した。
  - 仮2(B): ハンドル基盤の使用中の判定から他の対象の旧ハンドルを外し、保存の一括の書き込みで`previousHandleRelease`により解放する形にした。要件1.4・1.7・1.8・2.4・2.7・3.4を書き換え、3.8を加えた。設計のハンドル基盤・`ProfileEditor`・`HandleAvailabilityChecker`・`UserHandleAvailability`・`D1ProfileStore`・不変条件・エラーの場面・テストと、タスク1.3・2.1・3.2〜3.4・5.5・9.1・9.2・10.1を直した。
  - 仮3(B): 外部Webサイトの上限を10件にした。要件4.6、設計の`PROFILE_WEBSITES_MAX`・位置のCHECK(0〜9)・入力の検証・文言、タスク1.1〜1.3・5.2・8.1を直した。
- 受け入れ基準は112件になった(3.8の追加)。
- 確定の反映の後、設計の変更箇所(ハンドル基盤・保存・4:21のジョブ・上限)を機械的な確認(112件の受け入れ基準の番号が追跡表にあること)と判断で見直し、問題は無かった。タスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認で2回行った。1回目はNEEDS_FIXES(必須1件・軽微3件)で、整形で受け入れ基準の番号が繰り上がり要件3.5〜3.8の対応がずれていたこと(新しい基準を3.8へ移した)、研究の記録に旧い決定の文言が残っていたこと、9.2が保留中のジョブを文書に載せうること、3.2の要件に11.9が無いことを直した。2回目はPASSだった。

## 変更履歴(2026-10-28、frontend-platformの実装で確定した契約の反映)

- frontend-platformの実装と最終検証の後、開発者の決定(frontend-platformのタスク10.4)で、設計をfrontend-platformの設計の「実装で確定した契約による発火と影響を受ける下流spec」の表に合わせた。振る舞いを変えない整合の修正で、要件は変えていない。
  - 操作の置き場所と生成物: clientの操作を`src/graphql/operations/profile/`の1ファイル1操作の`.graphql`(操作名は`Client`で始める)にし、`graphql()`を呼ばず、部品は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読むとした(design.mdのFile Structure Plan、tasks.mdの7.1)。
  - Zodの値の読み込み元とフォーム部品の形: `profile-form-schema.ts`はZodの値を`lib/utilities/validation/zod.ts`の`z`から読み、`ProfileEditForm`を`useAppForm<TInput, TOutput>(schema, { defaultValues })`と`AppForm`(`serverFieldPrefix="input"`・必須の`onSubmitError`)で作り、`GraphQLClientError`でない例外の文言を`errorMessageOf`で選ぶとした(design.mdのAllowed Dependencies・ProfileEditForm・FollowButton、tasks.mdの8.1)。
  - 非表示のウィジェット: `TurnstileWidget`は非表示で描くため、`ProfileEditForm`の欄の順からウィジェットを外し、編集フォームとフォローボタンに判定の枠と場所を設けないとした(design.mdのProfileEditForm・FollowButton、tasks.mdの7.1・8.1)。
  - アップロード部品の問い合わせ先の有無: media-pipelineの`ImageUploadField`に必須の`contactAvailable: boolean`が加わり、想定外の応答などの文言を問い合わせ先の有無で選ぶ。利用者側のプロフィール画像の`AvatarField`は`CLIENT_PROFILE.contactAvailable`を渡すとした(design.mdのAllowed Dependencies・AvatarField、tasks.mdの8.1の説明と確認項目)。本specに`ConfirmActionDialog`を使う箇所は無い。

## フォームの描かない値と無効の欄の扱いの反映(2026-10-28、開発者の判断)

- **状態**: frontend-platformの最終検証の後の第2回の判断16・25〜28・30〜36(2026-10-28〜29)を、frontend-platformのタスク11.8として本specの設計とタスクへ反映した。受け入れ基準は変えていない。
- **Context**: frontend-platformの`SubmitButton`は、`root`以外の欄のエラー(サーバーの欄のエラーを含む)が1つでも残る間は無効になる。入力欄を描かない値をフォームのスキーマの入力に含めると、その値へのサーバーの詳細が利用者の直せない欄のエラーになり、送信ボタンが無効のまま残る。`applyServerFieldErrors`は、欄をまとめた値(配列でないオブジェクト)の経路と、`FormField`の`disabled`で無効にした欄の詳細を欄に付けず`onSubmitError`の`unmatched`へ渡し、`useAppForm`は検証の前に無効の欄の値を除く。無効の欄の値は`onSubmit`へ渡す値から外れ、無効になり得る欄はスキーマで任意(`.optional()`)にする。`FormField`は後から無効にした欄のエラーを消し、`useAppForm`は渡されたスキーマが変わると検証し直し、`applyServerFieldErrors`は描かれていない欄の詳細もフォーム全体の失敗にする。全欄が無効のフォームは`SubmitButton`の`disabled`で送信ボタンを無効にする。
- **決定**: `ProfileEditForm`のフォームの値は`UpdateMyProfileInput`の形に合わせ、版の値の`expectedHandle`はスキーマの入力に含めず`onSubmit`で足すことを確かめ、設計に明記した(判断26の確認)。停止中は送信しないため、全欄を`FormField`の`disabled`で無効にし、保存の送信ボタンを`SubmitButton`の`disabled`で無効にすることを書いた(判断35)。
- **変えた箇所**: design.mdの`ProfileEditForm`、tasks.mdの8.1(停止中の無効の方法)・8.2(`expectedHandle`の送信)。
