# Research & Design Decisions

## Summary

- **Feature**: `inquiry-chat`
- **Discovery Scope**: New Feature(問い合わせの実装・モックアップは無い。上流の8spec(backend-platform・api-gateway・email-delivery・frontend-platform・content-processing・media-pipeline・identity-auth・admin-foundation)の設計・タスクは承認済みで実装は未着手であり、本specはその契約の上に問い合わせの受付・チャット・管理者の対応・カテゴリマスタを新設する。個人情報と非公開ファイルの認可を扱うため完全な調査を行った)
- **Key Findings**:
  - media-pipelineはファイル用の用途の閲覧の可否を`FileReadPolicy`の登録で差し替える設計で、既定は保有者だけを許す。管理者が利用者の添付をダウンロードする(FR-INQRY-010)には、本specが`inquiry-attachment`の方針を登録し、管理者の主体なら「問い合わせのメッセージに紐付いたファイルか」を確かめる必要がある。
  - media-pipelineの紐付け(`claim`)は個数・合計サイズを判定しない(各ドメインspecの責任)。`findMany`で保有者・用途・保存完了を確かめて合計を数え、`claim`の後に業務データを書き込む。書き込みに失敗したら`markDeleted`で論理削除し、日次バッチの物理削除に任せる。
  - identity-authは停止で既存のセッションを消さない(16.10)。停止中の利用者を`/contact`で未ログインの扱いにする(Q1)には、API側で「未ログイン、または停止中」を受け付けの条件にし、画面側も`viewer.status`で入力欄を切り替える必要がある。
  - 利用者のプロフィール画像はuser-profile-social(roadmapで本specより後)が所有し、identity-authの`users`には画像の列が無い。FR-INQRY-005の画像は、本specが表示用の照会口(`InquirerProfiles`、既定は画像なし)を設け、user-profile-socialが束縛を差し替える形にする。
  - 管理画面の「カテゴリ」メニュー(`/categories`)は4spec(product-launch・help-center・inquiry-chat・content-reporting)で共有するが、ページの所有者が決まっていない。roadmapの順で最初に使う本specがページと区画の登録口を作る(仮4)。
  - 返信した管理者は物理削除され得る(FR-ADMAC-004・013)。返信の行は管理者への外部キーを持たず、`AdminDirectory`が返さないIDを「削除済み」と表示する。一方、ログインの問い合わせは`users`への外部キーを持ち、identity-authの外部キーによる取り残しの検出の対象になる(物理削除の波及処理が`users`の削除より先に走る)。

## 要件フェーズ前の確認事項(2026-10-23)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                 | 根拠                                                                                                                                                 | 回答(2026-10-23)                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | 停止中の利用者       | FR-USER-026、identity-authの`AccountGuard.requireWritableUser`・横断N-7(停止中はアップロード不可)、文言規則の「停止中アカウント」、FR-INQRY-001・017 | 選択肢3(未ログイン用フォームを表示)。ログイン中でも停止中なら、ニックネームと連絡先を入力させ、未ログインの問い合わせとして保存する。未ログインのTurnstile・IP単位のレート制限・14日後の物理削除などの扱いも未ログインと同じにそろえる。停止中の利用者は既存のログイン問い合わせのチャットにも送信できない扱いになるため、その画面表示も設計する。要件定義書との差分を記録する |
| Q2  | Turnstileの範囲      | FR-INQRY-008、SW-018、brief Desired Outcome、FR-COMNT-008                                                                                            | 推奨案(フォーム送信のみ)                                                                                                                                                                                                                                                                                                                                                       |
| Q3  | ログイン時の制限     | FR-RLMIT-003・009、FR-INQRY-019、media-pipeline(アップロードに回数制限は無い)                                                                        | 選択肢2(追加しない)                                                                                                                                                                                                                                                                                                                                                            |
| Q4  | 自分の問い合わせ一覧 | ページ配置(`/contact`・`/inquiries/{id}`だけを定義)、FR-INQRY-011・021                                                                               | 選択肢2(`/contact`内に併設)。フォームの下に自分の過去の問い合わせを一覧する                                                                                                                                                                                                                                                                                                    |
| Q5  | 対応後のメッセージ   | FR-ADMAG-024、FR-INQRY-017、admin-foundationのQ2                                                                                                     | 推奨案(送信で未対応に戻す)                                                                                                                                                                                                                                                                                                                                                     |
| Q6  | 管理者返信の添付     | FR-ADMAG-023、FR-INQRY-019、データエクスポートのサービス仕様の`inquiries.json`                                                                       | 推奨案(テキストのみ)。エクスポート文書の記述の改訂が必要な点を報告する                                                                                                                                                                                                                                                                                                         |
| Q7  | 退会者の問い合わせ   | FR-USER-019・022、DR-002、FR-ADMAG-023・024、admin-foundationのQ2                                                                                    | 推奨案(退会済みで読み取り専用)                                                                                                                                                                                                                                                                                                                                                 |
| Q8  | チャットの更新方式   | FR-INQRY-013、brief Problem、要件定義書にリアルタイム性の定めは無い                                                                                  | 選択肢2(開いている間は定期更新)。表示時・送信後・復帰時の取得に加え、開いている間は30秒ごとに取り直す。TanStack Queryの再取得間隔などで実現し、新しい基盤は使わない                                                                                                                                                                                                            |

補足(2026-10-23): admin-foundationの仮1〜仮6は開発者が承認済みで、仮6の管理者アカウントのURLは`/admins`から`/accounts`へ変更された。ダッシュボードの未対応件数カードは本specが登録する。

### 提示した選択肢(記録)

- Q1: 停止中も送信可(推奨。ログイン状態でフォームとチャットの送信を受け付け、添付はアップロードの判定で拒否されテキストだけ。FR-USER-026の例外として要件定義書の改訂が要る) / 送信を拒否(停止中である旨とログアウトして未ログインのフォームを使う案内。返信はシステム上では届かない) / 未ログイン用フォームを表示(採用。ログイン中でも停止中ならニックネームと連絡先を入力させ、未ログインの問い合わせとして保存)
- Q2: フォーム送信のみ(推奨・採用。ログイン・未ログインの両方のフォーム送信で検証、チャットの追加メッセージと管理者の返信は対象外) / 未ログインのみ(briefの記載どおり。FR-INQRY-008より狭く改訂が要る) / 全送信に適用(チャットの追加メッセージでも毎回検証)
- Q3: ユーザー単位で制限(推奨。問い合わせの作成1時間5回・チャット1時間30回、要件の追加が要る) / 追加しない(採用。Worker全体のIP単位の制限だけ) / 未完了件数の上限(「未対応」「対応中」を同時に5件まで)
- Q4: `/inquiries`一覧を追加(推奨。`/contact`とユーザーメニューからリンク) / `/contact`内に併設(採用) / 一覧を設けない(送信直後の遷移と返信メールのリンクだけ)
- Q5: 送信で未対応に戻す(推奨・採用。管理者の返信ではステータスを変えない) / 手動のみ(送信は常に可、一覧に最終メッセージの日時) / 対応後は締め切り(「対応済」「却下」では送信を拒否)
- Q6: テキストのみ(推奨・採用。エクスポート文書の改訂が要る) / 管理者も添付可(20件・20MB、用途に管理者を加え退会時の削除も本specが行う)
- Q7: 退会済みで読み取り専用(推奨・採用。返信を拒否し未対応件数から除き、物理削除と同時に消える) / 管理画面から除外(論理削除の時点で一覧・詳細・件数に出さない)
- Q8: 表示時と復帰時に取得(推奨。表示時・送信後・画面復帰時) / 開いている間は定期更新(採用。上に加え30秒ごと) / WebSocketでリアルタイム(Durable ObjectsのWebSocket、基盤と費用が増える)

### 確認済みのため質問しない事項

- 添付の形式: 画像5形式・PDF・プレーンテキストで、編集ダイアログは出さない(media-pipelineのQ6、`ATTACHMENT_MEDIA_TYPES`)。1メッセージあたりの20件・合計の判定は本specが紐付けの前に行う(media-pipelineの設計が「個数・合計の判定は各ドメインspec」と定める)。上限のバイト数の解釈は仮3。
- 添付の保存と配信: 用途`inquiry-attachment`をファイル用(`storage: 'files'`、利用者だけがアップロード)として登録し、`FileReadPolicy`で投稿者本人とログイン中の管理者だけに閲覧を許す。配信は同一オリジンの中継で、`Content-Disposition: attachment`によりインライン表示しない(FR-INQRY-010・016・020、SW-011、FR-FILEU-011・019、ページ配置)。紐付けなかったファイルはmedia-pipelineの日次バッチが削除する。
- 退会時のファイル: 利用者が保有するファイルの物理削除は、user-profile-socialの`purge_due`の波及処理(`eraseOwnedBy`)が行う。本specは自分のテーブルの論理削除(同期の波及処理)と物理削除(`purge_due`の非同期の波及処理)をidentity-authの登録口に登録する(roadmapのShared seams、brief Constraints)。
- 運営者による代理の退会: 管理画面はugc-moderationの担当で、本specは持たない(identity-auth・ugc-moderationのbrief)。ugc-moderationの仮4の確定(2026-10-24)により、起点はユーザー一覧だけで、問い合わせの詳細からの導線は無い。
- 未ログインのレート制限: IP単位で1時間に5回、Durable Objectsの厳密カウンタ、Alarmによるリセット、超過時は429。キーは`hashRateLimitKey`でHMACハッシュ化する(FR-RLMIT-003・015・020、backend-platformの`RateLimitCounterClient`)。Turnstileは`BotVerifier.assertHuman`(`GraphQLContext.assertHuman`)で検証する。
- 未ログインの問い合わせへの返信: システム上では返信せず、受付確認のメールも送らない。送信完了のメッセージだけを表示する(1.2スコープ外、FR-INQRY-012)。「対応済」「却下」から14日以上のものは日次バッチ(業務時刻4:21、`inquiry-chat.<名詞句>`)で物理削除する(DR-021、日次タイムライン)。
- ログインの問い合わせの保持: 退会以外による保持期限は要件に無く、設けない。
- 返信通知メール: email-deliveryの分類ではトランザクションメール(問い合わせ返信)で、抑止リストの対象外。メールアドレスが未確認の利用者にも送る。件名は文言規則の「お問い合わせに返信がありました」(email-deliveryのQ1、FR-USER-006の制限対象外)。
- メールアドレスが未確認の利用者の問い合わせ: FR-USER-006の制限対象に問い合わせは無いため受け付ける。
- 入力の上限: 未ログインのニックネーム25文字、問い合わせのメッセージ5,000文字、チャットと管理者の返信1,000文字、いずれもプレーンテキスト。カテゴリ名30文字。文字数は`countGraphemes`(書記素)で数える(文言規則、admin-foundationの`CATEGORY_NAME_MAX`)。
- ロールと監査ログ: 閲覧のみは参照だけ。返信・ステータス変更・カテゴリの追加・編集・削除はモデレーター以上(admin-foundationのQ3、FR-ADMAG-023・FR-ADMCF-016)。操作種別は`audit-actions/inquiry-chat.ts`で登録し、操作と同じ一括の書き込みで記録する。理由は任意(FR-ADMAG-001、admin-foundationのQ6、`buildAuditLogStatements`)。
- 管理画面: メニュー「問い合わせ」は`/inquiries`(order 80)、カテゴリは`/categories`(order 110)の中で共通部品`CategoryMasterEditor`を使う(admin-foundationの仮6)。ダッシュボードの区画`DASHBOARD_CARDS`へ、未対応の問い合わせ(ログインと未ログインの合計)の件数カード(order 20)を登録する(admin-foundationのQ2)。
- 一覧の絞り込み: 対応ステータス・種別(ログイン・未ログイン)・カテゴリ・受付日時(FR-ADMAG-024が「FR-ADMUG-020と同様の方式」とするため、通報一覧のFR-ADMUG-019に倣う)。
- 管理者の表示: プロフィール画像とニックネームは`AdminDirectory`で引き、削除済みは「削除済み」と表示する。画像が未登録なら既定のアイコン。画像のサイズは`square-xs`(FR-INQRY-014・015、admin-foundationのQ5、画像バリアント文書)。
- カテゴリ: 標準カテゴリ「その他」は削除できず、削除したカテゴリに紐付く問い合わせは「その他」へ付け替える(FR-ADMCF-017・018)。カテゴリは参照で持ち、送信時点の名前は保存しない。エクスポート文書の「問い合わせ時点のカテゴリ名」は「現在のカテゴリ名」へ改める必要がある。
- メッセージの編集・削除、管理者への新着通知メール: 要件に無いため設けない。新着はダッシュボードの件数カードで把握する。
- 新しいパッケージ: 不要(上流の部品と、shadcn/uiの`table`・`select`で足りる)。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する。

### 仮決定(2026-10-23に承認)

設計中に生じた、開発者の判断を要する論点である。回答と上流specに最も整合する案を仮に採用して設計・タスクを作り、2026-10-23に開発者がいずれも採用した案のまま承認した。その後、同日のspec横断レビューでの開発者の決定により、仮3を20,000,000バイトから20,971,520バイトへ変更した(「spec横断レビューの指摘の反映」のX1)。

| #   | 論点                                     | 採用した案                                                                                                                                                                                                                                                                                  | 他の選択肢                                                                | 影響する箇所                                                                             |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 仮1 | カテゴリ名の重複                         | 前後の空白を除き大文字小文字を区別せずに比べて重複を拒否する(`inquiry_category_name_taken`)。一意索引で保証する(2026-10-23に承認)                                                                                                                                                           | 重複を許す(選択肢に同じ名前が並ぶ)                                        | 要件1.3、`inquiry_categories.name`の一意索引、エラーの表                                 |
| 仮2 | 標準カテゴリ「その他」の扱いと並び順     | 「その他」は削除に加えて名前の変更も拒否する。並びは追加の順で「その他」を末尾にする(2026-10-23に承認)                                                                                                                                                                                      | 名前の変更は許す / 名前の50音順                                           | 要件1.4・1.7、`checkCategoryEditable`、`CategoryOrder`                                   |
| 仮3 | 添付の上限「20MB」の解釈                 | 20,971,520バイト(20MiB)。1ファイルの上限も同じ値(media-pipelineの`MAX_UPLOAD_BYTES`=20,971,520バイト)。容量の単位は1kB=1,024バイト・1MB=1,048,576バイトとするプロジェクト全体の規則(文言規則)に従う(2026-10-23に承認。同日のspec横断レビューでの開発者の決定により20,000,000バイトから変更) | 20,000,000バイト(1,000を基数とする解釈。承認時に採用していた案)           | 要件6.1、`INQUIRY_ATTACHMENT_LIMITS`、用途の`maxBytes`、文言                             |
| 仮4 | 管理画面のカテゴリのページ               | 本specが`/categories`ページと登録口`CATEGORY_SECTIONS`を作り、問い合わせカテゴリの区画(order 30)を登録する。後続3specは区画を足すだけにする(2026-10-23に承認)                                                                                                                               | 各specが別のURLにページを作る / admin-foundationへ差し戻す                | 要件1.8、`CATEGORY_SECTIONS`、ページ配置、product-launch・help-center・content-reporting |
| 仮5 | 返信の通知メールの送信要求に失敗した場合 | 返信は保存したまま成功を返し、`notificationQueued: false`で管理画面に知らせ、エラーをSentryへ記録する。再送の操作は設けない(2026-10-23に承認)                                                                                                                                               | 返信の保存ごと失敗させる(再送で二重の返信になり得る) / 再送の操作を設ける | 要件11.4、`InquiryReplyService`、文言                                                    |

### 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂が必要である。

| 要件ID                    | 内容                                                                                                                                                           | 根拠     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-INQRY-001・003・005    | 停止中のログインユーザーには未ログインユーザーと同じ入力項目(ニックネーム・連絡先メールアドレス)を表示し、未ログインの問い合わせのテーブルへ保存する旨を加える | Q1       |
| FR-INQRY-007              | 添付ファイルの入力欄を表示する対象を「停止中でないログインユーザー」に改める                                                                                   | Q1       |
| FR-INQRY-017              | 停止中のユーザーは自身の問い合わせチャットを閲覧できるが送信できない旨を明記する(FR-USER-026との整合の明確化)                                                  | Q1       |
| FR-RLMIT-003・015・DR-021 | 「未ログインでの問い合わせ」に、停止中のユーザーが未ログイン用のフォームで送った問い合わせを含める                                                             | Q1       |
| FR-INQRY-008              | 対象が問い合わせフォームの送信(ログイン・未ログイン)であり、チャットの追加メッセージを含まない旨を明記する(明確化)                                             | Q2       |
| FR-ADMAG-024              | 「対応済」「却下」の問い合わせにユーザーが追加メッセージを送った場合、自動で「未対応」へ戻す旨を加える                                                         | Q5       |
| FR-USER-019               | 論理削除された問い合わせは、物理削除までの間、管理者側で読み取り専用(返信・ステータス変更不可)として表示する旨を加える(明確化)                                 | Q7       |
| FR-ADMCF-016・017         | カテゴリ名の重複を拒否する旨と、標準カテゴリ「その他」の名前の変更を禁じる旨を加える                                                                           | 仮1・仮2 |
| FR-INQRY-007・019         | 「20MB」が20,971,520バイト(20MiB)であることを明記する(容量の単位は1kB=1,024バイトとするプロジェクト全体の規則に従う)                                           | 仮3      |

### 上流・後続specへの影響

- media-pipeline: `UPLOAD_PURPOSES`へ`inquiry-attachment`(20,971,520バイト)を、`file-read-policies.ts`へその方針を登録する(契約どおり)。用途の上限は`MAX_UPLOAD_BYTES`(20,971,520バイト)と等しく、どちらかを変えたら他方を確かめ直す。
- identity-auth: `USER_LIFECYCLE_SYNC_HANDLERS`(api)と`USER_LIFECYCLE_ASYNC_HANDLERS`(event)へ本specの波及処理を1行ずつ登録する(契約どおり)。返信の通知先は、identity-authが`apps/backend-lib/workers/identity`に設ける共有の部品`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`)で引く(spec横断レビューの決定)。
- admin-foundation: `ADMIN_NAV_ITEMS`へ問い合わせ(`/inquiries`・80)とカテゴリ(`/categories`・110)を、`DASHBOARD_CARDS`へ`inquiry-chat.unhandled-inquiries`(order 20)を、`AUDIT_ACTIONS`へ`audit-actions/inquiry-chat.ts`を加える(契約どおり)。`/categories`のページと区画の登録口`CATEGORY_SECTIONS`は本specが新設する(仮4)。admin-foundationの共通部品(`components/admin`)の形は変えない。`AdminDirectory`は`backend-lib/workers/admin`から読み込み、eventでは`ADMIN_PLATFORM_MODULE`の束縛を使う。E2Eの管理者の用意と停止の状態の用意は、admin-foundationの`e2e/support/admin-bootstrap.ts`・`e2e/support/local-d1.ts`を使う(spec横断レビューの決定)。
- product-launch・help-center・content-reporting(後続、再検証): カテゴリマスタの画面は`/categories`に新しいページを作らず、`CATEGORY_SECTIONS`へ区画(product 10・help 20・report 40)を足す(仮4)。
- user-profile-social(後続、再検証): 利用者のプロフィール画像を、本specの`INQUIRY_TYPES.InquirerProfiles`の束縛の差し替え(既定は画像なし)で問い合わせフォームと管理画面へ渡す。
- ugc-moderation(後続): 停止中の利用者からの退会の依頼は、未ログインの問い合わせ(利用者のアカウントに紐付かない)として届く(Q1)。本人の確かめ(連絡先メールアドレスと登録メールアドレスの照合など)は、運営者がシステムの外で行う(ugc-moderationの仮4・仮5)。代理の退会はugc-moderationの管理画面のユーザー一覧から行い、本specの詳細のページの操作の登録口`INQUIRY_DETAIL_ACTIONS`へは登録しない(ugc-moderationの仮4、2026-10-24に開発者が確定)。登録口は初版は空のまま後続specのために残す。
- data-export(後続、再検証): 本specのテーブルを直接読まず、本specのエクスポート用の照会口`InquiryExport.listPage`(`apps/backend-lib/workers/inquiry/`、eventで束縛)を呼ぶ。管理者の返信に添付が無いこと(Q6)、カテゴリ名は現在の名前であること、添付の`path`はdata-exportが`fileId`と元のファイル名から組み立てることを前提にする。データエクスポートのサービス仕様(`docs/GUIDES/service/features/001-user-data-export.md`)の`inquiries.json`は本specのタスクで改める。
- legal-pages(同時期、確認済み): legal-pagesのdesign.mdは`db/005`を割り当てており、本specの`security/008`・`frontend/010`と重ならない。

## spec横断レビューの指摘の反映(2026-10-23に開発者が決定)

全specを横断したレビューの指摘と開発者の決定(2026-10-23)を、本specの要件の決定事項の表(仮3)・要件・設計・タスクに反映した。`spec.json`の承認の状態は変えていない。

| #   | 指摘                                                                                                                                                                             | 決定と反映                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | (判断)「20MB」を20,000,000バイト(1,000倍)とした仮3が、admin-foundationの「500kB」=512,000バイト(1,024倍)と食い違う                                                               | プロジェクト全体で1kB=1,024バイト・1MB=1,048,576バイトとする(文言規則に記載)。仮3を20,971,520バイトに改め、1メッセージの合計と1ファイルの上限を同じ値にし、media-pipelineの`MAX_UPLOAD_BYTES`(同じく20,971,520バイトへ変更)と等しく保つ。要件の決定事項の表・要件6.1、設計の`INQUIRY_ATTACHMENT_LIMITS`・用途の`maxBytes`・不変条件・Data Contracts・Testing Strategy・固有の値・Revalidation Triggers、タスク1.2・7.1、本書の仮決定の表と要件定義書の改訂の表を直した。文言の「合計20MB以内」は単位の規則により20,971,520バイトを指すため変えない。本specに他のkB・MBの値は無い         |
| X2  | (軽微)回数制限の規則名`guest-inquiry-by-ip`が、他specの`<名前>:<単位>`の形(`auth-mail:<kind>:ip`・`payments-checkout:user`・`ultras-portal:user`)に合わない                      | `inquiry-guest:ip`に改めた。キーの部品の用途も`inquiry-guest`にそろえた(Durable Objectの名前は`<規則名>:<キー>`のため数え方は変わらない)。IPアドレスが不明な場合のログの名前`guest-inquiry-ip-missing`は規則名ではないため変えない                                                                                                                                                                                                                                                                                                                                                       |
| X3  | (判断)利用者のメールの宛先の読み取りがspecごとに重複している                                                                                                                     | identity-authが`apps/backend-lib/workers/identity`に共有の部品`UserContactDirectory`(`findContact(userId)`。退会済み・物理削除済みは`undefined`、停止中は返す。`IDENTITY_PLATFORM_TYPES.UserContactDirectory`でapi・eventに束縛)を設ける。本specの`InquiryRecipientLookup`と`D1InquiryRecipientLookup`(とそのテスト)を削り、`InquiryReplyService`は`findContact`で宛先を引く。`emailVerified`は見ず、未確認・停止中の利用者にも返信の通知を送る(要件11.2のまま)。`undefined`は退会の確定との競合だけで起き、送らずに`notificationQueued: false`を返す。identity-authを上流の依存に加えた |
| X4  | (軽微)E2Eの補助(`local-d1.ts`と管理者の用意)が、admin-foundation・legal-pagesと重複して作られる                                                                                  | admin-foundationが`e2e/support/admin-bootstrap.ts`(`signInAsNewAdmin`・`signInAdmin`)と`e2e/support/local-d1.ts`(`executeLocalD1`・`sqlStringLiteral`)を所有する(admin-foundationのタスク12.1)。本specは`local-d1.ts`を作らず、管理者はモデレーターとして`signInAsNewAdmin`で、停止の状態は`executeLocalD1`で用意する。設計のFile Structure Plan・InquiryE2Eとタスク11.1・11.2を直した                                                                                                                                                                                                   |
| X5  | (判断)データエクスポートは各ドメインが自分のエクスポート部品を所有し、data-exportは他ドメインのテーブルを直接読まない。本specは「data-exportが本specのテーブルを読む」としていた | 本specが`apps/backend-lib/workers/inquiry/inquiry-export.ts`に`InquiryExport`(`listPage(userId, after)`、20件ずつ)を設け、データエクスポートの文書の`inquiries.json`の形(本specの改訂を含む)で返す。添付は`fileId`・元のファイル名・形式・バイト数を返し、ZIP内の`path`の組み立てと実体の同梱はdata-exportが行う。管理者のニックネームはadmin-foundationの`AdminDirectory`で引くため、admin-foundationが`AdminDirectory`を`backend-lib/workers/admin`へ置きeventでも束縛する。要件13.7、設計のBoundary・Components・InquiryExport・Traceability・Testing Strategy、タスク8.2を加えた     |

### Decision: データエクスポートの照会口(X5)

- **Context**: data-exportはeventのQueueの処理でZIPを作り、各ドメインの部品を順に呼ぶ(data-exportのbrief)。本specのテーブルを他specに読ませない。
- **Alternatives Considered**:
  1. 全件を1回で返す(paymentsの`PaymentHistoryExport.listAll`の形) — 問い合わせとメッセージの数に上限が無く、Workersのメモリ(128MB)に収まる保証が無い
  2. 20件ずつ返し、data-exportが逐次ZIPへ書く(採用)
- **Selected Approach**: `InquiryExport.listPage(userId, after)`がIDの昇順に20件と次の位置を返す。位置は最後の問い合わせのIDだけで、カーソルの符号化はしない(内部の呼び出しで、ULIDの順が作成の順に一致する)。
- **Rationale**: data-exportのストリーミングの書き出しに合い、1回の読み取りのバインド変数とメモリを抑えられる。
- **Trade-offs**: data-exportは`nextCursor`が`null`になるまで繰り返す必要がある。退会済み(論理削除済み)の問い合わせは返さない(退会した利用者はエクスポートを要求できない)。

## spec横断レビュー(2回目)の指摘の反映(2026-10-23)

2回目のspec横断レビューの指摘を、設計・タスクに反映した。`spec.json`の承認の状態は変えていない。

| #   | 指摘                                                                                                                                     | 反映                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Y1  | (重要)ugc-moderationが問い合わせの詳細から運営者による代理の退会へ進む導線を置くのに、詳細のページに後続specが操作を足す差し込み口が無い | 本specが詳細のページの操作の登録口`INQUIRY_DETAIL_ACTIONS`(初版は空)と表示`InquiryDetailActionsView`を設ける(`DASHBOARD_CARDS`・`CATEGORY_SECTIONS`と同じ形。後述のDecision)。設計のThis Spec Owns・Revalidation Triggers(ugc-moderation)・Boundary・File Structure Plan・Components(表と契約)・AdminInquiryPages・Testing Strategy、タスク10.1(登録した操作の表示と空の既定で何も描画しないことのブラウザテスト)、本文書の後続specへの影響とResearch Logの継ぎ目を直した |
| Y2  | (軽微)タスク12.1が「`security`に」「`frontend`に」とだけ書き、設計で割り当て済みの文書の番号を示していない                               | タスク12.1に`security/008-anonymous-submission-protection.md`・`frontend/010-live-refresh-queries.md`を明記した                                                                                                                                                                                                                                                                                                                                                           |

- identity-authのユーザーライフサイクルの波及処理の`order`の契約が、各ドメインは0〜9999、identity-auth自身は10000以上に広がった。本specの波及処理の`order`(300)と4:21のジョブの`order`(300)は変えず、本文書・設計・タスクに旧い範囲(0〜999・1000以上)への言及が無いことを確かめた。

## spec横断レビュー(3回目)の指摘の反映(2026-10-23)

3回目のspec横断レビューの指摘を、要件に反映した。`spec.json`の承認の状態は変えていない。

- (重要)ugc-moderationのbriefが、本specの設計に問い合わせの詳細の差し込み口が無いままの記述だった。ugc-moderationのbriefは、本specの`INQUIRY_DETAIL_ACTIONS`(`apps/admin/src/composition/inquiry-detail-actions.ts`)へ運営者による代理の退会への導線を登録し、部品が`InquiryDetailActionContext`を受け取る形に改められ、roadmapのShared seams「画面シェル」に本specが`INQUIRY_DETAIL_ACTIONS`を所有する旨が加わった。本文書では、要件のIntroductionの隣接specの説明のugc-moderationに、詳細の操作の登録箇所へ導線を足す旨を加えた。設計とタスクは2回目のY1で反映済みのため変えていない。
- (軽微)roadmapのShared seams「利用者の連絡先の照会」が、user-profile-socialが`D1InquirerProfiles`と`D1InquiryAdminReader`の両方を置き換えるとしていた。本設計の`D1InquiryAdminReader.list`は`users`を直接結合し、`InquirerProfiles`に依存しないことを確かめた。roadmapとuser-profile-socialのbriefで、置き換えの対象を`InquirerProfiles`の束縛に限り、`D1InquiryAdminReader`の一覧のニックネームの結合は表示の読み取りの例外として残すと決めた。本specの設計は変えない。

## 全specの横断レビューと開発者の確定の反映(2026-10-24)

- **仮7の取り下げ**: spec横断レビュー(2026-10-24)の指摘により、運営者による代理の退会の対象を確かめる照会`InquiryRequesterDirectory`(`D1InquiryRequesterDirectory`・`INQUIRY_REQUESTER_TYPES`、`apps/backend-lib/workers/inquiry/inquiry-requester-directory.ts`、apiの`INQUIRY_MODULE`で束縛)を本specが所有して実装する改訂(仮7。要件13.8・タスク7.4・Revalidation Triggersの行を含む)をいったん加えた。開発者がugc-moderationの仮4で、代理の退会は最上位管理者だけが行い起点は管理画面のユーザー一覧だけとすることを確定した(2026-10-24)ため、この照会を使う機能が無くなり、仮7を取り下げた。照会・束縛・要件13.8・タスク7.4・Revalidation Triggersの行・本書の記録を取り除き、要件・設計・タスクを改訂の前の内容に戻した。
- **`INQUIRY_DETAIL_ACTIONS`への登録の取りやめ**: 同じ確定により、ugc-moderationは問い合わせの詳細のページの操作の登録口`INQUIRY_DETAIL_ACTIONS`へ代理の退会への導線(order 10)を登録しない。登録口・表示`InquiryDetailActionsView`・文脈`InquiryDetailActionContext`は後続specのために残し、初版は空のままとする(タスク10.1の作業は変わらない)。requirements.mdの範囲と隣接specの説明、design.mdのNon-Goals・Out of Boundary・Revalidation Triggers・InquiryDetailActionsRegistry、tasks.mdの10.1の文言、本書の確認済みの事項・後続specへの影響から、ugc-moderationが登録するという記述を除いた。後述の「Decision: 問い合わせの詳細のページの操作の登録口」の経緯(当初はugc-moderationの導線を想定した)は記録として残す。
- 本specの仮決定(仮1〜仮5)は2026-10-23に確定済みで、確認待ちの事項は無い。
- 変更部分のタスクのサニティレビュー(2026-10-24): 新しいサブエージェントによる独立した確認(independent)を1回行い、PASSだった。軽微の指摘に従い、design.mdの`INQUIRY_DETAIL_ACTIONS`の節から経緯を除いた(経緯は本節に残す)。
- 変更履歴(2026-10-24、spec横断レビューの3回目、振る舞いの変更なし): 後続specへの影響のugc-moderationの行で、依頼者の本人の確かめを運営者がシステムの外で行う旨に改めた(ugc-moderationの仮4・仮5)。

## Research Log

### 上流specの契約と不足

- **Context**: 問い合わせは、利用者の判定(identity-auth)・ファイル(media-pipeline)・管理者(admin-foundation)・メール(email-delivery)・回数制限とbot判定(backend-platform)をまたぐ。
- **Sources Consulted**: 各specの`design.md`のBoundary Commitments・Allowed Dependencies・Components、`docs/GUIDES/service`の各文書。
- **Findings**:
  - `AccountGuard.currentUser`は停止中の利用者も返し、`requireWritableUser`は停止中を`account_unavailable`で拒否する。ログインの問い合わせとチャットの送信は`requireWritableUser`、閲覧は`requireUser`で判定できる。
  - `UserLifecycleSyncHandler.statementsFor`は利用者IDを条件にした集合の更新を返す規約で、退会の確定と同じ`db.batch`に入る。`UserLifecycleAsyncHandler.handle`は`done`・`continue`を返し、冪等にする。
  - `AuditLogRecorder.prepare`の値をinfrastructure層のストアへ渡し、`buildAuditLogStatements`で操作の文と同じ`db.batch`に含める。
  - `DASHBOARD_CARDS`のカードは自分でデータを取得し、`DashboardCardFrame`で状態を表示する。`ADMIN_NAV_ITEMS`はURLと`order`を登録する。
  - `GraphQLContext`は`clientIp`と`assertHuman`を持ち、frontend-platformの`ExecuteOptions.turnstileToken`でトークンが中継される。
  - frontend-platformの`createAppQueryClient`の既定は`refetchOnWindowFocus: false`・`staleTime: 30_000`で、チャットのクエリだけに`refetchInterval`と`refetchOnWindowFocus`を上書きできる。
- **Implications**: 新しい基盤は不要。継ぎ目は登録箇所への追記と、本specが新設する`InquirerProfiles`・`CATEGORY_SECTIONS`・`INQUIRY_DETAIL_ACTIONS`・`InquiryExport`だけである。

### 停止中の利用者の扱い(Q1)

- **Context**: 停止中の利用者はセッションを持ったまま`/contact`を開ける。回答により未ログインと同じフォームを使う。
- **Findings**: 未ログインの送信のAPIは「未ログイン、または停止中のログイン」を受け付けの条件にすれば足りる。停止していないログイン中の利用者からの未ログインの送信は拒否し、画面と送信先の食い違いを防ぐ。保存では利用者のIDを記録しない(回答の「未ログインの問い合わせとして保存」)。回数制限のキーは送信元IPアドレスだけで、停止中かどうかで分けない。
- **Implications**: 画面は`viewer.status`(identity-authの`Viewer.status`)で入力欄を切り替える。チャットページは`requireUser`で閲覧を許し、送信欄の代わりに停止中の案内を表示する。

### 添付の検証と紐付け

- **Context**: 1メッセージあたり20件・合計の上限(FR-INQRY-007・019)をサーバーで保証する。
- **Findings**: `MediaFiles.findMany`で`purpose`・`owner`・`stored`・`deletedAt`を確かめ、`byteSize`の合計を数えられる。`claim`は全件の条件を満たさなければ何も変えない。`claim`の後の業務データの書き込みに失敗すると、紐付け済みのファイルが参照されずに残るため、`markDeleted`で論理削除する(13日後に日次バッチが物理削除)。
- **Implications**: `InquiryAttachmentBinder`がこの順序を持ち、作成と追加メッセージの両方で使う。

### 一覧の横断と未対応の件数

- **Context**: ログインと未ログインは別テーブル(FR-INQRY-003)だが、管理画面では1つの一覧にする。
- **Findings**: D1(SQLite)の`UNION ALL`で2つのテーブルの共通の列を選び、`(created_at DESC, id DESC)`のカーソルで50件ずつ読める。絞り込みは各副問い合わせの`WHERE`に同じ条件を入れる。未対応の件数は2つの`COUNT`の和で、ログインの側は`deleted_at IS NULL`を条件にする(Q7)。各テーブルに`(status, created_at)`の索引を置く。
- **Implications**: 一覧の読み取りは`InquiryAdminReader`のD1実装に閉じ、バインド変数は100個以内に収まる。

### 定期再取得(Q8)

- **Context**: チャットページを開いている間、30秒ごとに取り直す。
- **Findings**: TanStack Queryの`refetchInterval: 30_000`は、既定の`refetchIntervalInBackground: false`によりタブが非表示の間は止まる。`refetchOnWindowFocus: true`をこのクエリだけに指定すれば、画面へ戻った時にも取り直す。送信の成功時は`invalidateQueries`で取り直す。
- **Implications**: 共通の値`LIVE_REFRESH_QUERY_OPTIONS`を`frontend-lib/utilities/query`に置き、利用者側と管理者側のチャットで使う。規約を`frontend/010`に書く。

### 参照したスキルと規約

- cc-sddの`kiro-spec-requirements`(EARSの規則と要件のレビューゲート)・`kiro-spec-design`(設計の原則・統合の3つの観点・設計のレビューゲート)・`kiro-spec-tasks`(タスクの生成規則・並列の判定)。タスクの依存の点検は同じ文脈で行った(inline)。
- TanStack系の規約(`docs/ai-extensions/tanstack-agent-guidelines.md`の方針): クエリの既定値を個別のクエリで上書きし、送信後は`invalidateQueries`で取り直す。
- CLAUDE.mdの技術規則の参照先: D1の制約(`db.batch`・バインド変数100個)、命名規則とマイグレーション、テストの種別と命名、カバレッジ、日時の表示(`<time datetime>`)。

### 技術ドキュメントの番号

- **Context**: roadmapの規則で番号をdesign.mdに先に割り当てる。
- **Findings**: 既存specの割り当ては`security/007`・`frontend/009`まで。同時期のlegal-pagesは`db/005`を割り当てており、本specの`security`・`frontend`とは重ならない。
- **Implications**: 本specは`security/008-anonymous-submission-protection.md`・`frontend/010-live-refresh-queries.md`を使う。

## Architecture Pattern Evaluation

| Option                                    | Description                                                                     | Strengths                                                    | Risks / Limitations                                                   | Notes             |
| ----------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------- |
| 4層のドメインモジュール(採用)             | apiに`inquiry`の`domain`・`application`・`infrastructure`・`presentation`を置く | backend-platformの規約どおり。上流の部品を差し込み口で使える | ファイル数が多い                                                      | 上流8specと同じ形 |
| 2テーブルを1つのビューで扱う              | D1のビューで横断する                                                            | 読み取りが単純                                               | ビューのマイグレーションがdrizzle-kitの生成対象外になり、管理が増える | 不採用            |
| ログインと未ログインを1テーブルにまとめる | 種別の列で分ける                                                                | 一覧が単純                                                   | FR-INQRY-003に反する                                                  | 不採用            |

## Design Decisions

### Decision: 停止中の利用者の未ログインの送信(Q1)

- **Context**: 停止中の利用者は既存のセッションを持つが、未ログインの問い合わせとして保存する。
- **Alternatives Considered**:
  1. 画面だけで切り替え、APIはセッションを見ない — 停止していない利用者がAPIを直接呼ぶと未ログインの問い合わせを作れてしまう
  2. APIで「未ログイン、または停止中」を確かめる(採用)
- **Selected Approach**: `GuestInquirySubmission`が`AccountGuard.currentUser`を読み、停止していないログイン中の利用者なら`member_inquiry_required`で拒否する。
- **Rationale**: 画面とAPIの判定を一致させ、ログインの問い合わせが未ログインのテーブルへ紛れるのを防ぐ。
- **Trade-offs**: APIで利用者を1回読む(処理単位で共有されるため追加の負荷は小さい)。

### Decision: 添付の紐付けの順序(Build vs Adopt)

- **Context**: media-pipelineの`claim`と本specの書き込みは別のD1の操作で、1つの`db.batch`にできない。
- **Selected Approach**: 検証(`findMany`)→`claim`→本specの一括の書き込み→失敗時は`markDeleted`。
- **Rationale**: 書き込みの失敗で紐付け済みのファイルが残っても、論理削除により物理削除される。逆順(書き込み→`claim`)では、`claim`の失敗で参照先の無い添付の行が残る。
- **Follow-up**: Workers統合テストで、書き込みの失敗時に`markDeleted`が呼ばれることを確かめる。

### Decision: 利用者の表示の差し込み口(Generalization)

- **Context**: FR-INQRY-005の画像はuser-profile-social(後続)が所有する。
- **Selected Approach**: application層の`InquirerProfiles`(ニックネーム・ハンドル・画像のファイルID)を本specが定義し、既定のD1実装は`users`から読んで画像を`null`にする。user-profile-socialが束縛を差し替える。
- **Rationale**: 後続specが本specのコードを書き換えずに画像を足せる。admin-foundationの`AdminDirectory`と同じ形である。

### Decision: カテゴリのページの登録口(仮4、Generalization)

- **Context**: 4つのカテゴリマスタが`/categories`を共有する。
- **Selected Approach**: `apps/admin/src/composition/category-sections.ts`の`CATEGORY_SECTIONS`(`id`・`order`・`component`)と、`_authenticated/categories/index.tsx`のページ(区画を`order`順に並べ、区画ごとにエラー境界で包む)を本specが作る。
- **Rationale**: admin-foundationの`DASHBOARD_CARDS`と同じ形で、後続specは1行の登録と区画の部品だけを足せばよい。

### Decision: 問い合わせの詳細のページの操作の登録口(spec横断レビュー(2回目)、Generalization)

- **Context**: ugc-moderationは、問い合わせで依頼を受けた運営者による代理の退会へ、管理画面の問い合わせの詳細(`/inquiries/$inquiryId`)から進む導線を持つ(ugc-moderationのbrief)。本specの設計には詳細のページに後続specが操作を足す差し込み口が無かった。
- **Alternatives Considered**:
  1. ugc-moderationが本specの詳細のページの部品を直接書き換える — ページの所有が曖昧になり、後続の操作が増えるたびに本specの部品が変わる
  2. 本specが登録口`INQUIRY_DETAIL_ACTIONS`(初版は空)と表示`InquiryDetailActionsView`を設け、後続specは1行の登録と操作の部品だけを足す(採用)
- **Selected Approach**: `apps/admin/src/composition/inquiry-detail-actions.ts`の`INQUIRY_DETAIL_ACTIONS`(`id`・`order`・`component`)。部品は文脈`InquiryDetailActionContext`(問い合わせのID・種別・利用者のID・退会済みか・未ログインの連絡先メールアドレス)を受け取る。`InquiryDetailActionsView`は`order`順に並べ、操作ごとにエラー境界で包み、空なら何も描画しない。
- **Rationale**: admin-foundationの`DASHBOARD_CARDS`と本specの`CATEGORY_SECTIONS`と同じ形で、後続specの追加が登録箇所への1行で済む。停止中の利用者の依頼は未ログインの問い合わせとして届くため、未ログインの連絡先メールアドレスを文脈に含め、ugc-moderationが登録メールアドレスとの照合に使えるようにする。
- **Trade-offs**: 登録箇所にロールの条件を持たせない(admin-foundationのQ3に合わせる)ため、操作の表示の可否は各部品が`RoleGate`で判定する。

### Decision: 未ログインの問い合わせの保持期間の判定の列

- **Context**: DR-021は「対応済」「却下」に変更されてからの経過で削除する。
- **Selected Approach**: `status_changed_at`(ステータスを最後に変えた日時)を持ち、`status IN ('resolved','rejected') AND status_changed_at <= 実行時刻 − 14日`で選ぶ。「未対応」「対応中」へ戻したら対象から外れる。
- **Rationale**: 監査ログを読まずに判定でき、索引`(status, status_changed_at)`で選べる。

### Decision: 新しいパッケージを導入しない

- **Context**: CLAUDE.mdは新規パッケージの候補の質問を求める。
- **Selected Approach**: 上流の版(drizzle-orm・graphql-yoga・TanStack Query・react-hook-form・zod・shadcn/ui)とadmin-foundationの共通部品だけを使う。
- **Rationale**: 必要な機能(定期再取得・表・フォーム・アップロード)は既存の部品で足りる。

## Risks & Mitigations

- 返信の通知メールの送信要求の失敗で利用者が返信に気付かない — 仮5のとおり管理画面に知らせ、Sentryで検知する。利用者は`/contact`の一覧とチャットの定期再取得でも確認できる。
- 30秒ごとの再取得による負荷 — 非表示のタブでは止まり、1回の取得は1つの問い合わせのメッセージだけを読む。メッセージ数の上限は設けないが、索引`(inquiry_id, created_at)`で読む。
- 2テーブルの横断の一覧の性能 — 各テーブルの索引と`LIMIT 51`で読み、全件の数え上げはしない。
- legal-pagesとの技術ドキュメントの番号の重複 — 上流・後続specへの影響に記載したとおり、実装時に確かめてずらす。
- user-profile-socialの実装前は利用者のプロフィール画像が既定のアイコンになる — 要件2.5のとおり既定のアイコンを表示する。

## References

- [Cloudflare D1のSQL文](https://developers.cloudflare.com/d1/sql-api/sql-statements/) — `UNION ALL`と`db.batch`の利用
- [TanStack Query v5 useQuery](https://tanstack.com/query/v5/docs/framework/react/reference/useQuery) — `refetchInterval`・`refetchIntervalInBackground`・`refetchOnWindowFocus`
- 上流spec: `.kiro/specs/{backend-platform,api-gateway,email-delivery,frontend-platform,content-processing,media-pipeline,identity-auth,admin-foundation}/design.md`
- サービス仕様: `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md`、`docs/GUIDES/service/legal/001-compliance-policy.md`、`docs/GUIDES/service/features/001-user-data-export.md`

## frontend-platformの実装で確定した契約の反映(2026-10-28、開発者の判断)

- frontend-platformが実装で確定した契約(同specのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に、開発者の判断(下流specの設計を今回改訂する)で本specの設計を合わせた。
- GraphQLの操作: 操作を各アプリの`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名を利用者側は`Client`、管理者側は`Admin`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む。`graphql()`を呼んで`.ts`のファイルに操作を書くと、操作の本文がブラウザのバンドルに残るため(frontend-platformの要件6.3)。tasks.mdの操作のタスクに、各アプリの`graphql:generate`とapiの`graphql:allowlist`の手順を書いた。
- フォーム: `useAppForm<TInput, TOutput>(schema, { defaultValues })`(`defaultValues`は全欄)と、必須の`onSubmitError`・任意の`serverFieldPrefix`(`input`を取るmutationは`"input"`)を受ける`AppForm`の形にした。画面側のスキーマの`zod`の値は`utilities/validation/zod.ts`から読む(CSPの下で`new Function`の試行を止める`jitless`の設定を済ませた`z`)。
- 失敗の文言: `GraphQLClientError`でない例外に代えて画面に出す文言を`errorMessageOf(error, <プロファイル>.contactAvailable)`で選ぶ。管理者側には問い合わせの画面が無いため、`ErrorState`・`UnexpectedErrorView`に`contactHref`を渡さず、問い合わせの導線と問い合わせを促す文を出さない(frontend-platformの要件8.6・8.13)。カテゴリの区画は、admin-foundationの`CategoryMasterEditor`の`failureMessageOf`(本改訂でadmin-foundationが加えた)に`errorMessageOf`を渡す。
- bot判定: `TurnstileWidget`は非表示のウィジェットで場所を取らないため、判定の枠の表示と場所の記述を除いた。
- 要件2.2・2.3を「入力欄を表示し、bot判定を非表示で置き(判定の枠を画面に出さない)」の形に改めた(番号は変えていない)。
- 変えた箇所: design.mdのAllowed Dependencies、Technology Stackの画面の行、File Structure Planの`inquiry-form-schemas.ts`と両アプリの`graphql/operations/inquiry/`、`GuestInquiryForm`・`MemberInquiryForm`とフォームの検証、`InquiryReplyForm`・`InquiryStatusControl`(`ConfirmActionDialog`の`failureMessageOf`)・`UnhandledInquiriesCard`・`InquiryDetailActionsView`・`CategorySectionsView`・`InquiryCategorySection`、Error Strategy。requirements.mdの2.2・2.3。tasks.mdの9.1・9.3・10.1・10.2・10.3。
- アップロードの入力欄: media-pipelineの`AttachmentUploadField`が必須で受ける`contactAvailable`(アップロードの失敗の文言を選ぶ)に、`MemberInquiryForm`と`InquiryMessageComposer`は`CLIENT_PROFILE.contactAvailable`を渡す(design.mdの両部品、tasks.mdの9.1・9.3)。
