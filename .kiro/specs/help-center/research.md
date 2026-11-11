# Research & Design Decisions

## Summary

- **Feature**: `help-center`
- **Discovery Scope**: Complex Integration(ヘルプ機能の実装とモックアップは無い。上流の15spec(dev-tooling〜user-profile-social)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはuser-profile-socialのハンドル基盤、content-processingのマークダウンの部品と全文検索の基盤、admin-foundationの権限・監査ログ・管理者の照会・共通部品、inquiry-chatのカテゴリのページ、frontend-platformのフッターの登録口の上に、ヘルプ記事とカテゴリのデータ・管理画面・利用者側の画面を足す)
- **Key Findings**:
  - ハンドル基盤の`HandleNamespace`は、現在のハンドルの解決の条件(`activeCondition`)と使用中の判定(全行)を分けている。ヘルプ記事では`activeCondition`を「公開」にすれば、下書きの記事のハンドルは解決されず(FR-HELP-005)、使用中の判定は下書きを含む全記事の現在のハンドルを対象にできる(FR-ADMAG-017)。旧ハンドルの解決は保持者の状態を見ないため、保持者が下書きなら読み取り側で404にする。他の記事の旧ハンドルは使用中とせず、設定と同じ一括の書き込みでハンドル基盤の解放の文により消す(仮4の確定、user-profile-socialの仮2の確定と同じ規則)。
  - content-processingの検索対象の登録(`SearchTargetDefinition`)は、`read`と`isIndexable`の中身をドメインが決める。下書きを`read`の対象外にすれば、索引の更新の処理が索引を削除する。下書きへの変更と削除では`deleteSources`を同じ一括の書き込みに入れ、索引から直ちに消せる(FR-FTS-009)。検索のクエリは記事のテーブルと結合して「公開」で絞るため、索引の更新が遅れても下書きは出ない。
  - D1の`db.batch()`は1つのトランザクションで直列に確定する。記事の更新・削除・並べ替えの取り消しの条件(記事が存在し版が一致する、並べ替えの対象の集合が一致する)は、テーブル自身への「値を副問い合わせや`CASE`式で決める挿入」(条件を満たさなければNOT NULL制約の違反、満たせば一意の衝突で何もしない)を一括の書き込みの先頭に置けば、監査ログの記録を含む全体を取り消せる。admin-foundationの`buildAuditLogStatements`の`guard`は管理者の操作の種類に限られるため使えない。
  - 管理者が指定する並び順(仮3の確定)は、カテゴリと記事の`sort_order`の列で表す。並べ替えは順序をJSONの配列でバインド変数1つに渡し、`json_each`で1文で更新すれば、D1のバインド変数の上限(100)に件数が縛られない。
  - 作成者の表示は`AdminDirectory.findProfiles`(削除済み・招待中は返さない)で引き、返らないIDを「削除済みの管理者」にする。`help_articles.created_by_admin_id`は`admins`への外部キーを持たない(管理者の物理削除を妨げないため、inquiry-chatの`inquiry_messages.admin_id`と同じ)。

## 要件フェーズ前の確認事項(2026-10-23)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書と上流specに最も整合する案を推奨として示した。**仮1〜仮5は2026-10-24に開発者が確定した**(仮1〜仮4は推奨と異なる案、仮5は推奨どおり)。確定した案は`requirements.md`の「要件フェーズでの決定」にも記録し、要件・設計・タスクを確定した案に合わせた。roadmapの「Requirement Ambiguities」の表には本specが担当する行が無いため、roadmapは変更していない。

| #   | 論点                                                 | 根拠                                                                                                                                                                                                                                                                          | 選択肢                                                                                                                                      | 推奨と確定した案                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | ヘルプ記事の本文の文字数上限と必須の別               | FR-ADMAG-005(上限の記載なし)、文言規則の入力欄の表(本文の行が無い)、content-processing(上限は各ドメインspecが決める、20,000文字の描画を300ms以内で計測)、legal-pagesのQ5(法務文書は100,000書記素)                                                                             | (A)必須・20,000文字 / (B)必須・100,000文字(法務文書と同じ) / (C)上限なし                                                                    | 推奨は(A)(描画性能を計測済みの最大の長さとそろう)。**2026-10-24に開発者が確定: (B)必須・100,000文字(推奨と異なる)。** 描画の時間は本specの計測(100,000文字・1,500ms以内)で劣化を検出する                                                                                                                                           |
| 仮2 | ヘルプ記事のハンドルの予約語一覧                     | FR-ADMAG-029(「別途定める予約語一覧」)、ページ配置の「旧ハンドルの保持とリダイレクト」(一覧は「ユーザー及びプロダクトのハンドル」に適用と記載)、briefのConstraints(「予約語一覧はハンドル基盤が持つ共通の一覧を使う」)、user-profile-socialの`IMPERSONATION_RESERVED_HANDLES` | (A)共通のなりすまし対策の14語 / (B)ヘルプ記事専用の一覧を定める / (C)予約語を設けない(管理者だけが設定するため)                             | 推奨は(A)(briefの方針と一致)。**2026-10-24に開発者が確定: (C)予約語を設けない(推奨と異なる)。** ハンドルは運営者だけが設定するため、`support`・`security`のような説明の記事に自然な語も使える。ページ配置の予約語の対象はユーザー・プロダクトだけのまま、ヘルプ記事を含めない旨を明記する                                          |
| 仮3 | ヘルプトップ・フッターでの並び順                     | FR-HELP-001・002(カテゴリ別、カテゴリ内はピン留めを先頭)、FR-HELP-006(フッター)、inquiry-chatの仮2(カテゴリは追加の順で「その他」を末尾、2026-10-23に承認)。カテゴリと記事には並び順の項目が要件に無い                                                                        | (A)カテゴリは追加の順・「その他」末尾、記事は作成の古い順 / (B)記事は更新の新しい順 / (C)カテゴリと記事に並び順の項目を設け管理者が指定する | 推奨は(A)(入力項目と画面が増えない)。**2026-10-24に開発者が確定: (C)カテゴリと記事に並び順を設け管理者が指定する(推奨と異なる)。** 管理画面に並べ替えの画面を設け、ヘルプトップ・フッター・同カテゴリの記事・カテゴリの選択肢はその順に従う。ピン留めとの関係は「Decision: 管理者が指定する並び順とピン留めの群」                  |
| 仮4 | 他のヘルプ記事が保持している旧ハンドルの扱い         | FR-ADMAG-017・019(判定の対象は全記事の「登録済み」のハンドル)、FR-ADMAG-026(旧ハンドルの保持)、FR-HELP-011(旧ハンドルの302)、user-profile-socialの仮2(ハンドル基盤の使用中の判定)                                                                                             | (A)他の記事の旧ハンドルも使用中として拒否する(記事自身は戻せる) / (B)他の記事が設定でき、設定された時点で元の記事の旧ハンドルを消す         | 推奨は(A)(共有済みの旧URLの転送先が変わらない)。**2026-10-24に開発者が確定: (B)他の記事も設定でき、設定された時点で元の記事のその旧ハンドルを物理削除する(推奨と異なる)。** user-profile-socialの仮2の確定と同じ規則で、ハンドル基盤の共通の振る舞い(使用中の判定は現在のハンドルだけ、設定と同じ一括の書き込みでの解放)に合わせる |
| 仮5 | ヘルプ記事カテゴリ名の重複と標準カテゴリの名前の変更 | FR-ADMCF-012・013(重複・名前の変更の記載なし)、inquiry-chatの仮1・仮2(問い合わせカテゴリは重複を拒否し、「その他」の名前の変更も拒否。2026-10-23に承認)、admin-foundationの`CategoryMasterEditor`(全カテゴリのマスタで共通の部品)                                             | (A)重複を拒否し、「その他」の名前の変更も拒否する / (B)重複を許す / (C)「その他」の名前の変更を許す                                         | 推奨は(A)。**2026-10-24に開発者が確定: (A)(推奨どおり)。** 同じ部品で編集する問い合わせカテゴリと振る舞いがそろい、利用者のヘルプトップに同じ名前の見出しが並ばない                                                                                                                                                                |

### 確認済みのため質問しない事項

- 記事の削除の方式: 物理削除とする。準拠方針のデータ保持期間の表にヘルプ記事の論理削除の行が無く、FR-ADMAG-028が旧ハンドルを「削除時に」物理削除すると定めるため、記事も同時に物理削除する。
- タイトル・サブタイトル: 各100文字以内で必須(文言規則の入力欄の表で「◯」)。ハンドル: 50文字以内、プロダクトのハンドルと同じ規則(FR-ADMAG-016、文言規則)。カテゴリ名: 30文字以内で必須(admin-foundationの`checkCategoryName`)。検索語: 50文字以内(FR-HELP-004、文言規則)。
- 大文字小文字だけのハンドルの変更: URLは大文字小文字を区別せずに解決されるため旧ハンドルとして保持しない(user-profile-socialの要件2.2と同じ解釈。要件7.9)。
- 権限: 作成・編集・削除・並べ替えとカテゴリの操作はモデレーター以上(FR-ADMAG-005、FR-ADMCF-012)。閲覧のみの管理者も全メニューを参照できる(admin-foundationのQ3)。
- 監査ログ: 対象はFR-ADMAG-001が挙げるFR-ADMAG-005(記事の作成・編集・削除。並べ替えは記事の編集に当たる)とFR-ADMCF-012(カテゴリの追加・編集・削除。並べ替えはカテゴリの編集に当たる)。要件が「理由付き」としない操作のため理由は任意(admin-foundationのQ6)。対象の種類は`help-article`・`category`(admin-foundationの`AuditTargetKind`に定義済み)。
- 作成者の表示: `AdminDirectory.findProfiles`で引き、返らないIDは「削除済みの管理者」(briefのConstraints、legal-pagesと同じ表記)。プロフィール画像は`square-xs`(画像の派生の文書「ヘルプ記事の作成者」)。
- 管理画面のURLとメニュー: `/help-articles`(`order` 100、admin-foundationの仮6)。カテゴリの区画: `CATEGORY_SECTIONS`の`{ id: 'help-center.help-categories', order: 20 }`(inquiry-chatの仮4、brief)。区画の中身は`CategoryMasterEditor`(`withHandle: false`、`canEdit`はモデレーター以上)と、本specのカテゴリの並べ替えの部品。
- フッター: frontend-platformの`SITE_LAYOUT_SLOTS.footerHelpLinks`(例にピン留めヘルプ記事が挙がっている)へ部品を加える。フッターの枠と固定のリンク(ヘルプトップ)はfrontend-platformが持つ。
- 本文のリンクの`rel`: 運営が作成する内容で投票や未審査の要素が無いため、別オリジンのリンクは`noopener`だけを付ける(ページ配置の「外部Webサイトへのリンク」の表に行を加える)。内部リンクは絶対URLで書く(content-processingのresearchの「相対URL」)。
- 目次: 見出しの一覧は`renderMarkdown`の`headings`を使う(content-processingの決定。本文の描画と同じ結果の見出しを使う)。PCでは右側に固定、モバイルでは本文の冒頭に折りたたみ(ページ配置)。
- 4:21のジョブとユーザーライフサイクルの波及処理: 持たない。ヘルプ記事は利用者のデータを持たず、物理削除は管理操作の時点で行い、作成者の削除は表示で扱う。roadmapの帯の割り当ての表の本specの「使用中の値」は「—」のままである。
- 新しいパッケージ: 要らない。並べ替えはドラッグ&ドロップのパッケージを使わず、上下の移動のボタンで行う。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(user-profile-socialと同じ)。

## Research Log

### 上流specの契約

- **Context**: briefのApproach・Constraints・Existing Spec Touchpoints、roadmapのShared seams(ハンドル基盤・画面シェル・監査ログ・E2Eの管理者ログイン・techドキュメントの番号)。
- **Sources Consulted**: user-profile-social・content-processing・admin-foundation・inquiry-chat・frontend-platform・legal-pagesの`design.md`、user-profile-social・inquiry-chat・admin-foundation・content-processingの`research.md`の後続specへの申し送り。
- **Findings**:
  - user-profile-social: `apps/common-lib/handles`の`HANDLE_PATTERN`・`HandleRule`・`checkHandleFormat`・`toHandleKey`・`isSameHandle`・`isReservedHandle`・`IMPERSONATION_RESERVED_HANDLES`、`apps/db/schema/handles/previous-handle-columns.ts`の`previousHandleColumns`、`apps/backend-lib/workers/handles`の`defineHandleNamespace`・`resolveHandle`・`isHandleOccupied`・`handleOccupiedCondition`・`previousHandleUpsert`・`previousHandleSoftDelete`・`previousHandleDelete`。呼び出し元が形式(と予約語)を先に確かめ、部品はデータベースの状態だけを判定する。現在のハンドルの対象の取り消しの条件(状態や版)は各ドメインのストアが`CASE`式に組み立てる。仮2の確定(2026-10-24)で、ハンドル基盤は他の対象の旧ハンドルを使用中とせず、設定と同じ保存の中で元の保持者の旧ハンドルを削除する部品を提供する(user-profile-socialの要件3.4・3.8)。部品の名前と形はuser-profile-socialの設計で決まる。
  - content-processing: `searchDocumentColumns`・`searchTextColumn`・`searchDocumentStatusIndex`・`defineSearchIndex`・`SEARCH_INDEXES`(`apps/db/search/search-indexes.ts`)・`print-search-index-sql.ts`(カスタムマイグレーションに貼るSQL)・`ftsRankedSources`・`bm25Rank`、`defineSearchTarget`・`SEARCH_TARGETS`(`apps/backend-lib/workers/search/targets/index.ts`)・`SearchIndexStatements`(`markPending`・`deleteSources`)・`SearchIndexRefreshRequester`(送信の失敗は例外にしない)、日次の再抽出(1時間以上`pending`の索引文書を再処理)。`normalizeSearchTerms`・`buildFtsMatchExpression`・`findHighlightRanges`・`HighlightedText`、`renderMarkdown`の`headings`(20,000文字を300ms以内で計測)、`MarkdownEditor`・`MarkdownContent`・`useRenderedMarkdown`・`useMarkdownOptions`・`markdownTextSchema`・`countGraphemes`。キーワード抽出へ送る内容は「ヘルプ記事の本文」と記載済み(プライバシーポリシーの大枠の委託先の項)。抽出の入力の上限は900,000バイト。
  - admin-foundation: `requireAdmin(context, minimum)`・`AdminRole`・`hasRole`・`RoleGate`・`useAdminRole`、`AuditLogRecorder.prepare`・`buildAuditLogStatements`(操作と同じ一括の書き込み)・`defineAuditAction`(対象なしの操作を許す)・`AUDIT_ACTIONS`(`audit-actions/<spec名>.ts`を足して連結)、`AdminDirectory.findProfiles`(`ADMIN_PLATFORM_TYPES.AdminDirectory`)、`ADMIN_NAV_ITEMS`、共通部品`AdminDataTable`(`pagination`は省略可)・`AdminFilterBar`・`AdminPageHeader`・`ConfirmActionDialog`・`ReasonField`・`AdminAvatar`・`CategoryMasterEditor`(渡された順で表示し、並べ替えを持たない)、E2Eの`signInAsNewAdmin`・`executeLocalD1`。
  - inquiry-chat: `CATEGORY_SECTIONS`(`apps/admin/src/composition/category-sections.ts`)の`CategorySection { id, order, title, component }`。区画ごとにエラー境界で包む。問い合わせカテゴリの実装(標準カテゴリの固定ULIDと初期データのカスタムマイグレーション、`name`の`collate nocase`の一意索引、削除と付け替えと監査ログを1つの`db.batch`)。
  - frontend-platform: `SiteLayoutSlots.footerHelpLinks: readonly ComponentType[]`(フッターのヘルプの区画、ヘルプトップのリンクの後)、`NotFoundView`・`ErrorState`・`EmptyState`・`LoadingSkeleton`・`buildPageHead`・`graphqlQueryOptions`・`executeGraphQL`・`useAppForm`・`FormField`・`applyServerFieldErrors`・`notify`・`DateTime`。
  - legal-pages: 削除済みの管理者の表記「削除済みの管理者」、`db/005`の番号、本文の上限100,000書記素(GraphQLの要求の上限1MiBの範囲に収まることを確認済み)。
- **Implications**: 本specは上流の登録箇所への追記(`SEARCH_INDEXES`・`SEARCH_TARGETS`・`AUDIT_ACTIONS`・`ADMIN_NAV_ITEMS`・`CATEGORY_SECTIONS`・`SITE_LAYOUT_SLOTS.footerHelpLinks`)だけで上流のファイルを変え、上流の部品の形を変えない。

### ハンドル基盤の適用

- **Context**: FR-ADMAG-016・017・019・026・028・029・FR-HELP-005・007・011、brief(textNoCase)、仮2・仮4の確定。
- **Findings**:
  - `HELP_ARTICLE_HANDLE_NAMESPACE`は、現在のハンドルを`help_articles`(`activeCondition`は`status = 'published'`)、旧ハンドルを`help_article_previous_handles`(`deletedAt`の列を持つが本specは論理削除しない)で記述する。`isHandleOccupied`・`handleOccupiedCondition`は`activeCondition`を使わないため、下書きの記事の現在のハンドルも使用中になる(FR-ADMAG-017)。仮4の確定により、他の記事の旧ハンドルは使用中としない。
  - ハンドルを新しい文字列で保存する作成・変更では、ハンドル基盤の`previousHandleRelease(db, ns, { handle, exceptOwnerId })`(他の対象が保持する同じ文字列の旧ハンドルの行を物理削除する文)を、現在のハンドルの書き込みの後に同じ一括の書き込みへ入れる(ハンドル基盤の解放の規約)。作成では新しい記事のIDを`exceptOwnerId`に渡す。下書きの記事が取った場合、解放された旧URLは公開されるまで404になる。保存が取り消されれば解放も取り消され、元の記事の旧ハンドルは残る。
  - `resolveHandle`の`previous`は保持者の状態を見ない。保持者が下書きなら、公開の照会の側で`not-found`にする(要件4.5)。
  - 記事の削除では`previousHandleDelete`で旧ハンドルを物理削除する(FR-ADMAG-028)。`previousHandleColumns`の外部キーは`ON DELETE`を指定しないため、記事の行より先に消す。
  - 旧ハンドルのテーブルも作成時に`textNoCase`を指定する(後から照合規則を変えるとテーブルの作り直しになる、`db/001`)。
- **Implications**: 予約語は無く(`HELP_ARTICLE_HANDLE_RULE.reservedWords`は空、仮2)、ユースケースは形式だけを先に確かめる。使用中の判定・同時の保存の競合・旧ハンドルの解放はD1のストアがハンドル基盤の部品で行う。編集画面の使用可否は、他の記事の旧ハンドルと一致する場合に解放の案内を出すため4値にする。

### 検索対象の登録と公開状態

- **Context**: FR-HELP-004・005、FR-ADMAG-022、FR-FTS-001〜009。
- **Findings**:
  - 項目は`title`・`subtitle`(`plain`・`textColumn: true`・`extract: false`)と`body`(`markdown`・`textColumn: false`・`extract: true`)にする。タイトルとサブタイトルは元のテキストで一致し、本文は抽出したキーワード(抽出が無効・未対応の言語では正規化した本文の全体)で一致する。外部へ送るのは本文だけになり、プライバシーポリシーの大枠の記載(ヘルプ記事の本文)と一致する。100,000文字の本文はUTF-8で約300,000バイトで、抽出の入力の上限に収まる。
  - `read`・`isIndexable`を「公開」の記事に限る。版(`SearchSource.version`)は保存ごとに1増える`revision`を使い、同じミリ秒の2回の保存でも単調に増える。並べ替えとカテゴリの付け替えは版を変えず、索引の対象の項目も変えない。
  - 公開の記事の保存では`markPending`を一括の書き込みに入れ、確定の後に`requestRefresh`を送る。下書きの保存と削除では`deleteSources`を一括の書き込みに入れ、索引の更新の処理を待たずに索引から消す。
  - 検索は`ftsRankedSources`を副問い合わせとして`help_articles`(`status = 'published'`)・`help_categories`と結合し、`rank`の昇順で読む。現在のタイトル・ハンドルは記事のテーブルから読むため、索引の更新前でも表示は最新になる(要件10.5)。
- **Implications**: 検索対象の定義は`apps/backend-lib/workers/search/targets/help-articles.ts`に置き、api・eventの両方が`SEARCH_TARGETS`経由で使う。eventの束縛の追加は要らない。

### 保存・削除・並べ替えの競合と一括の書き込み

- **Context**: 要件6.5・6.8・6.9・7.6・8.4・9.10・11.11・12.4。
- **Sources Consulted**: `docs/GUIDES/tech/db/002`(D1の`db.batch()`は1つのトランザクション)、user-profile-socialの保存の`CASE`式、identity-authの`UserLifecycleCommitter`、SQLiteの制約の検査の順(NOT NULLとCHECKは一意性より先に検査され、UPSERTの`ON CONFLICT`は一意性の衝突だけに働く)、SQLiteのJSON関数(`json_each`)と`group_concat`。
- **Findings**:
  - 更新・削除の取り消しの条件(記事が存在し、更新では版が一致する)は、`UPDATE`・`DELETE`の対象が0行でもエラーにならないため、そのままでは監査ログの記録を止められない。一括の書き込みの先頭に「記事のテーブルへの、ハンドルの値を`(SELECT handle FROM help_articles WHERE id = ? AND revision = ?)`で読む`INSERT … ON CONFLICT DO NOTHING`」を置くと、存在しない・版が違う場合はNOT NULL制約の違反で全体が取り消され、存在する場合は一意の衝突で何も書かない。
  - 並べ替えの対象の集合の確認は、渡されたIDのJSON配列の件数が対象の件数と同じで対象のIDが全て`json_each`に含まれるという集合の比較(`group_concat`は集約の順序が保証されず区切りの文字を含むIDで誤って一致し、対象が0件でNULLになるため採らない)を、標準カテゴリの行への`INSERT … ON CONFLICT DO NOTHING`の`name`の`CASE`式に入れれば、同じ方式で全体を取り消せる。件数によらずバインド変数は一定である。
  - 並び順の更新は`UPDATE … SET sort_order = (SELECT CAST(key AS INTEGER) + 1 FROM json_each(?) WHERE value = id)`の1文で、件数によらずバインド変数は2つである。
  - カテゴリの存在とハンドルの使用中の判定は、作成の`INSERT`・更新の`UPDATE`の`category_id`(NOT NULL)を`CASE WHEN <カテゴリが存在> AND NOT <handleOccupiedCondition> THEN ? ELSE NULL END`にして同じトランザクションで判定する。`handle`の一意索引と旧ハンドルの一意索引の違反も全体を取り消す。
  - 失敗の分類は取り消しの後の読み直しで行う(記事が無い→`help_article_not_found`、版が違う→`help_article_conflict`、カテゴリが無い→`validation_error`の`categoryId`、それ以外→`help_article_handle_unavailable`。並べ替えは`help_order_outdated`)。
- **Implications**: `help-guards.ts`に記事の存在と版の確認の文と、並べ替えの対象の集合の確認の文を置き、ストアの更新・削除・並べ替えの先頭で使う。Workers統合テストで、条件を満たさない場合に監査ログを含む全体が取り消されることを確かめる。

### 並び順の表し方

- **Context**: 仮3の確定(カテゴリと記事に並び順を設け管理者が指定する)、FR-HELP-002(カテゴリ内はピン留めを先頭)、FR-ADMCF-014(削除時の付け替え)。
- **Findings**:
  - カテゴリと記事に`sort_order`(1以上の整数)を持たせる。記事の並び順はカテゴリ内の1つの系列とし、ピン留めの群とそれ以外の群は表示の時に`pinned`で分ける。ピン留めの切り替えで値を変えなければ、切り替えた記事は新しい群の中で元の値の位置に入り、並べ替えの画面を開かずに済む。
  - 追加・作成・カテゴリの変更は`(SELECT COALESCE(MAX(sort_order), 0) + 1 …)`で末尾に置く。値の重複は一意制約で禁じず、同値は作成の古い順とIDで決める(並べ替えの最中に追加された行も順が決まる)。
  - カテゴリの削除の付け替えでは、「その他」の現在の最大値を、削除するカテゴリの記事の値に足してから`category_id`を変える(足す値の副問い合わせは更新しない「その他」の行だけを読むため、全行に同じ値が足され相対的な順が保たれる)。
  - `CategoryMasterEditor`は並べ替えを持たないため、admin-foundationの部品の形を変えずに、本specの並べ替えの部品を区画に並べて置く。ドラッグ&ドロップは新しいパッケージが要るため採らず、上下の移動のボタンと位置の読み上げで行う(キーボードと支援技術で操作できる)。
- **Implications**: 並び順の規則(`sortHelpCategories`・`sortHelpArticles`・`splitPinnedGroups`・`moveItem`)は、apiの読み取りと管理画面の並べ替えの画面の両方が使うため`common-lib/help`に置く。

### 作成者の表示と管理者の削除

- **Context**: FR-HELP-008・009、FR-ADMAG-020、brief(`admins`を直接読まない)。
- **Findings**: `AdminDirectory.findProfiles(ids)`は`status = 'active'`の管理者だけを100件ずつ返す。公開の詳細ページでは作成者1人、管理者側の一覧では全記事の作成者の重複を除いた集合を1回で引く。プロフィール画像は`mediaFileLoader`と`toMediaImage`で`MediaImage`にする(隔離中は`objectKey`が`null`で既定の画像)。公開のGraphQLには管理者のIDを出さない。
- **Implications**: 管理者側の一覧は作成者のID(管理画面の中だけで使う)と表示用の情報(削除済みは`null`)を返し、作成者の絞り込みの選択肢は画面がこの値から作る(削除済みは1つの選択肢)。

### 一覧の絞り込みの置き場所

- **Context**: FR-ADMAG-020・021(下書きを含む全件をページ分けせずに表示し、作成者・カテゴリ・公開状態で絞り込む)。
- **Findings**: 全件を常に表示する要件のため、画面は全件を1回で読み込む。絞り込みを画面の純粋な関数で行えば、APIは1つの全件の照会で済み、絞り込みの組み合わせを単体テストで確かめられる。記事の件数は運営が書く分に限られ、全件の読み込みは小さい。記事の並べ替えの画面も同じ全件の照会(並び順・ピン留め・作成日時を含む)を使う。
- **Implications**: `adminHelpArticles`は引数を持たず全件を返し、`help-article-filter.ts`が条件の解析・作成者の選択肢・絞り込みを行う。条件はURLのクエリ(`creator`・`category`・`status`)に保持する。

### フッターのピン留め記事

- **Context**: FR-HELP-006、frontend-platformの`footerHelpLinks`。
- **Findings**: フッターは全ページに出るため、取得の失敗や遅れがページの表示を妨げてはならない。部品が自分で`useQuery`で取得し、読み込み中と失敗では何も描画しない(ヘルプトップへのリンクはフッターの固定のリンクとして残る)。
- **Implications**: `PinnedHelpLinks`は`pinnedHelpArticles`(公開のピン留め記事のハンドルとタイトルを、カテゴリの並び順と記事の並び順で返す)を読み、`<li>`の並びを描く。

### 目次の部品

- **Context**: FR-HELP-010、ページ配置(PCは右側に固定、モバイルは本文の冒頭に折りたたみ)。
- **Findings**: `renderMarkdown`は`h2`〜`h6`の`{ depth, id, text }`を返す。IDは接頭辞(`user-content-<idScope>-`)を含む最終の値のため、`#<id>`のリンクで見出しへ移動できる。固定の共通ヘッダーの下に見出しが隠れないよう、本文の見出しに`scroll-margin-top`を付ける。モバイルの折りたたみはネイティブの`<details>`・`<summary>`で、キーボードと支援技術の操作を追加の実装なしで満たせる。
- **Implications**: `HelpTableOfContents`は見出しの一覧を受け取り、PC用の`<nav aria-label="目次">`(固定)とモバイル用の`<details>`を出し分ける。見出しが無ければ何も描画しない。

### 100,000文字の本文の描画

- **Context**: 仮1の確定(本文は100,000文字以内)。content-processingは20,000文字の描画を300ms以内で計測している。
- **Findings**: 描画は記事詳細ページのサーバー側の描画とブラウザの初期化の両方で行う(content-processingの決定)。100,000文字では長さに比例して約1.5秒の描画の時間が見込まれる。GraphQLの要求(1MiB)・D1の行(2,000,000バイト)・抽出の入力(900,000バイト)の上限には収まる。
- **Implications**: 本specで100,000文字の代表的な本文の描画の時間を計測するテスト(1,500ms以内)を持ち、劣化を検出する。launch-readinessの性能の検証のデータ規模に100,000文字のヘルプ記事を含めるよう申し送る。

## Architecture Pattern Evaluation

| Option                                                   | Description                                                                 | Strengths                                                      | Risks / Limitations                                                      | Notes           |
| -------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------- |
| ドメインのテーブルとハンドル基盤・検索の基盤の部品(採用) | `help_*`の4テーブルを本specが所有し、上流の部品に対象の記述と検索対象を渡す | 規則が利用者・プロダクトとそろい、上流の部品の形を変えずに済む | 記事の更新・削除・並べ替えの取り消しに、確認の文が要る                   | briefのApproach |
| 記事の版を別テーブル(下書きと公開版)に分ける             | legal-pagesのように下書きと公開した版を分ける                               | 公開中の内容を保ったまま下書きを編集できる                     | 要件は記事単位のステータス(下書き・公開)だけを求め、版の履歴は要件に無い | 不採用          |
| 一覧の絞り込みをAPIの引数で行う                          | `adminHelpArticles(creator, category, status)`                              | 件数が増えても転送量が増えない                                 | 全件表示の要件では利点が無く、APIと画面の両方に条件の扱いが要る          | 不採用          |
| ピン留めの群ごとに別の並び順の系列を持つ                 | `pinned_sort_order`と`sort_order`を分ける                                   | 群ごとの並びを独立に保てる                                     | ピン留めの切り替えのたびに移動先の群の位置を決める処理が要る             | 不採用          |

## Design Decisions

### Decision: 公開状態はハンドル基盤の解決の条件と検索対象の読み取りで表す

- **Context**: FR-HELP-005(下書きは一覧・検索・詳細の直接のURLのいずれからも参照できない)。
- **Alternatives Considered**:
  1. 公開の照会の各クエリに「公開」の条件を書く
  2. 1に加えて、ハンドル基盤の`activeCondition`と検索対象の`read`・`isIndexable`にも同じ条件を入れる
- **Selected Approach**: 2。公開の照会(`D1PublicHelpStore`)・ハンドルの解決・索引のいずれも「公開」だけを対象にする。旧ハンドルの解決の結果は保持者が公開かを読み取り側で確かめる。
- **Rationale**: 1か所の漏れで下書きが出る経路(索引の残り・旧ハンドル)を、それぞれの部品の段階で閉じる。
- **Trade-offs**: 「公開」の条件が複数の場所に現れる。`publishedHelpArticle`(`status = 'published'`のSQLの断片)を1つにして共有する。

### Decision: 記事の保存と削除を1つの一括の書き込みにする

- **Context**: 要件6.1・6.5・6.8・6.9・6.12・7.4・7.6・7.8・8.2・10.1・10.3・12.3・12.4。
- **Selected Approach**: 作成は(1)記事の挿入(`category_id`の`CASE`式でカテゴリの存在と使用中の判定、`sort_order`はカテゴリの末尾)→(2)`previousHandleRelease`(他の記事の同じ旧ハンドルの解放)→(3)公開なら`markPending`→(4)監査ログ。更新は(1)存在と版の確認の文→(2)記事の更新(同じ`CASE`式、`revision`を1増やす、カテゴリの変更なら末尾へ)→(3)別の文字列への変更なら`previousHandleRelease`→(4)別の文字列への変更なら`previousHandleUpsert`→(5)公開なら`markPending`、下書きなら`deleteSources`→(6)監査ログ。削除は(1)存在の確認の文→(2)`deleteSources`→(3)`previousHandleDelete`→(4)記事の削除→(5)監査ログ。確定の後、公開の保存だけ`requestRefresh`を送る。
- **Rationale**: 項目ごとの部分的な保存・監査ログの無い操作・操作の無い監査ログ・解放だけが行われた状態が起きない。索引の削除は即時(FR-FTS-009)で、作成・編集の反映は非同期(FR-FTS-003)になる。
- **Trade-offs**: 確認の文はテーブル自身への挿入の形をとるため、意図をコメントで説明し、Workers統合テストで振る舞いを固定する。

### Decision: 管理者が指定する並び順とピン留めの群

- **Context**: 仮3の確定、FR-HELP-002(カテゴリ内はピン留めを先頭)。
- **Alternatives Considered**:
  1. 記事の並び順の系列を1つにし、ピン留めの群とそれ以外の群は表示の時に分ける(各群は系列の順)
  2. ピン留めの群とそれ以外の群で別々の並び順の系列を持つ
  3. 管理者の並び順をそのまま表示し、ピン留めはフッターにだけ効かせる
- **Selected Approach**: 1。ピン留めはカテゴリ内で常に先頭の群に表示し(FR-HELP-002)、各群の中を記事の並び順で並べる。並べ替えの画面は2つの群を別々の一覧で並べ替え、保存ではピン留めの群に続けてそれ以外の群の順で1つの系列として保存する。ピン留めの切り替えでは並び順の値を変えない。フッターはカテゴリの並び順→各カテゴリ内のピン留めの記事の並び順で並べる。カテゴリは「その他」を含めて全て並べ替えの対象とし、追加は末尾に置く。
- **Rationale**: 3はFR-HELP-002に反する。2はピン留めの切り替えのたびに移動先の系列での位置を決める必要がある。1は値が1つで、切り替えても相対的な位置が保たれる。
- **Trade-offs**: 並べ替えの画面で群をまたぐ移動はできない(群はピン留めの切り替えで変える)。「その他」の位置は固定されず、管理者が決める(追加されたカテゴリは「その他」より後になるため、必要なら並べ替える)。

### Decision: カテゴリのマスタは問い合わせカテゴリと同じ形にする

- **Context**: FR-ADMCF-012〜014、仮5、inquiry-chatの実装。
- **Selected Approach**: `help_categories`(`name`は`collate nocase`の一意、`system_default`、`sort_order`)と標準カテゴリ「その他」の固定ULID(`HELP_CATEGORY_OTHER_ID`)・初期データのカスタムマイグレーション。削除は(1)監査ログ(詳細`reassignedCount`)→(2)付け替える記事の並び順を「その他」の末尾へずらす→(3)記事の付け替え(`updated_at`・`revision`を変えない)→(4)カテゴリの削除(`system_default = 0`)の1つの`db.batch`。
- **Rationale**: 同じ`CategoryMasterEditor`で編集する4種類のカテゴリのうち、付け替えを持つ2種類(問い合わせ・ヘルプ記事)の振る舞いがそろう。
- **Trade-offs**: 付け替えで`revision`を変えないため、開いている編集画面は削除されたカテゴリのまま保存しようとし、`validation_error`(カテゴリを選び直す)になる(要件6.5)。

### Decision: 作成者の表示は照会の時点で引く

- **Selected Approach**: 記事は`created_by_admin_id`だけを持ち、表示の都度`AdminDirectory.findProfiles`で引く。返らなければ「削除済みの管理者」。
- **Rationale**: 管理者のニックネーム・画像の変更が自動で反映され、管理者の物理削除を外部キーで妨げない。admin-foundationの照会口だけを使い`admins`を読まない(brief)。

### Decision: 採らなかった案

- 管理者側の一覧の絞り込みのAPIの引数: 全件表示の要件では利点が無い。
- 記事の論理削除と日次の物理削除のジョブ: 保持期間の要件が無く、旧ハンドルも削除時に物理削除する(FR-ADMAG-028)。
- 下書きのプレビュー用の利用者側のURL: 要件に無い。管理画面の入力欄のプレビューが利用者側と同じ描画の指定を使う。
- 目次の現在位置の強調: 要件・ページ配置に無い。
- ドラッグ&ドロップによる並べ替え: 新しいパッケージが要る。上下の移動のボタンで要件を満たす。
- `CategoryMasterEditor`への並べ替えの追加: admin-foundationの部品の形を変える。本specの部品を区画に並べて置く。

## Synthesis

- **Generalization**: 公開状態を持つ対象のハンドルの解決(`activeCondition`と保持者の状態の確認)と、対象の削除での旧ハンドルの物理削除を、ハンドル基盤の技術ドキュメント(`backend/011`)の節として一般化する。見出しから作る目次は、他の長い本文(法務文書など)でも使える規約として`frontend/008`の「目次の作り方」に追記する(2026-11-11のG2の確定)。上下の移動の並べ替えの部品は、カテゴリと記事の両方で同じ部品を使う。
- **Build vs Adopt**: ハンドルの規則と旧ハンドルの解放はuser-profile-social、マークダウン・検索・強調表示はcontent-processing、権限・監査ログ・管理者の照会・共通部品はadmin-foundation、カテゴリのページはinquiry-chat、フッターと状態表示はfrontend-platformの部品を使う。目次と並べ替えの部品は既存の部品が無く作る。モバイルの折りたたみはネイティブの`<details>`を、並び順の一括の更新はSQLiteの`json_each`を採用する。新しいパッケージは無い。
- **Simplification**: 版の履歴・論理削除・下書きのプレビューのURL・目次の現在位置の強調・一覧の絞り込みのAPI・群ごとの並び順の系列・ドラッグ&ドロップを持たない。eventの束縛・4:21のジョブ・ライフサイクルの波及処理を持たない。

## Risks & Mitigations

- 確認の文(記事の存在と版、並べ替えの対象の集合)がSQLiteの制約の検査の順に依存する — Workers統合テストで、条件を満たさない場合の全体の取り消しと、満たす場合に何も書かないことを固定する。D1の版の更新でテストが失敗すれば検知できる。
- 100,000文字の本文の描画が遅い(仮1) — 本specの計測のテスト(1,500ms以内)で劣化を検出し、launch-readinessの性能の検証のデータ規模に含める。管理画面の入力欄(Crepe)への読み込みもブラウザテストで100,000文字の値を扱えることを確かめる。
- 旧ハンドルの解放(仮4)で、共有済みの旧URLが予告なく別の記事を表示する — 編集画面の使用可否の確認で、保存すると他の記事の旧URLの転送が無くなる旨を示す。
- 並べ替えの最中に別の管理者が記事を追加・削除・移動する — 対象の集合の確認の文で保存を拒否し、最新の並びの読み込みを案内する。
- 同じ旧ハンドルを2つの保存が同時に取りにいく — 現在のハンドルの一意索引で一方だけが確定し、解放は確定した保存のトランザクションでだけ行われる。Workers統合テストで確かめる。
- 全ページのフッターがピン留め記事を取得する — 取得は1回の索引付きの読み取りで、失敗や遅れは描画しないことで吸収する。TanStack Queryのキャッシュで同じページの再描画では取得しない。
- 技術ドキュメントの番号の重なり — 2026-11-11のG2の確定で、本specは新しい番号の文書を作らず`frontend/008`に追記するため、重なりは無い。`frontend/011`は欠番のまま残る(product-launchの要確認4で開発者が許している)。
- 管理者のニックネームが利用者側に公開される — FR-HELP-008の要件どおり。管理者のIDは公開のGraphQLに出さない。

## References

- `docs/requirements/README.md` — 4.16、4.22(FR-ADMAG-001・005・012〜017・019〜022・026・028・029)、4.23(FR-ADMCF-012〜014)、4.27、4.28
- `docs/GUIDES/service/design/002-page-layouts.md` — `/help`・`/help/{handle}`、旧ハンドルと予約語、フッター、ヘルプの目次、管理者側のメニュー
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — タイトル・サブタイトル・ハンドル・検索語・カテゴリ名の上限
- `docs/GUIDES/service/legal/001-compliance-policy.md` — ヘルプ記事の旧ハンドルの保持期間
- `docs/GUIDES/service/features/002-image-variants.md` — ヘルプ記事の作成者の画像(`square-xs`)
- [SQLite UPSERT](https://www.sqlite.org/lang_upsert.html) — `ON CONFLICT`は一意性の制約だけに働く
- [SQLite JSON Functions](https://www.sqlite.org/json1.html) — `json_each`による配列の展開
- [HTML Standard: the details element](https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element) — モバイルの目次の折りたたみ

## 確定した決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。**仮1〜仮5は2026-10-24に開発者が確定した。** `requirements.md`の「要件フェーズでの決定」にも同じ行がある。本specに確認待ちの論点は無い。

| #   | 論点                                                 | 確定した案                                                                                                                            | 推奨(採らなかった案)             | 影響する箇所                                                                                                                        |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | ヘルプ記事の本文の文字数上限と必須の別               | 必須・100,000文字(推奨と異なる案B)                                                                                                    | 必須・20,000文字                 | 要件6.1、`HELP_BODY_MAX`、`HelpBodyRenderBenchmark`、文言規則の入力欄の表、launch-readinessのデータ規模                             |
| 仮2 | ヘルプ記事のハンドルの予約語一覧                     | 予約語を設けない(推奨と異なる案C)                                                                                                     | ユーザー・プロダクトと共通の14語 | 要件7.5、`HELP_ARTICLE_HANDLE_RULE.reservedWords`(空)、ページ配置の予約語の対象                                                     |
| 仮3 | ヘルプトップ・フッターでの並び順                     | カテゴリと記事に並び順を設け管理者が指定する。カテゴリ内はピン留めの群を先頭(推奨と異なる案C)                                         | 追加の順・作成の古い順           | 要件1.2・1.3・5.2・6.12・9.8〜9.11・11.4・11.7・11.9〜11.11、`sort_order`、`HelpOrdering`、並べ替えの操作と画面、監査ログの操作種別 |
| 仮4 | 他のヘルプ記事が保持している旧ハンドルの扱い         | 他の記事も設定でき、設定された時点で元の記事のその旧ハンドルを物理削除する(推奨と異なる案B、user-profile-socialの仮2の確定と同じ規則) | 使用中として拒否する             | 要件7.4・7.7・7.11、ハンドル基盤の解放の文・`isHandleOccupied`・`handleOccupiedCondition`、使用可否の4値、準拠方針                  |
| 仮5 | ヘルプ記事カテゴリ名の重複と標準カテゴリの名前の変更 | 重複を拒否し、「その他」の名前の変更も拒否する(推奨どおり)                                                                            | —                                | 要件11.2・11.3、`help_categories.name`の一意索引、`checkHelpCategoryEditable`                                                       |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID                     | 内容                                                                                                                                                                                                               | 根拠    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| FR-ADMAG-005               | 「本文は必須とし、100,000文字以内とする」旨を加える                                                                                                                                                                | 仮1     |
| FR-ADMAG-029               | 「ヘルプ記事のハンドルには予約語を設けない」に改める(または削除する)。ページ配置の予約語一覧はユーザー・プロダクトだけに適用する                                                                                   | 仮2     |
| FR-HELP-001・002・006      | 「カテゴリは管理者が指定した並び順で表示し、各カテゴリ内ではピン留めされた記事を先頭に、ピン留めの記事とそれ以外の記事をそれぞれ管理者が指定した並び順で表示する。フッターのピン留め記事も同じ順とする」旨を加える | 仮3     |
| FR-ADMAG-005・FR-ADMCF-012 | 「モデレーター以上の管理者が、ヘルプ記事のカテゴリ内の並び順と、ヘルプ記事カテゴリの並び順を変更できる」旨を加える(新しく作成・カテゴリの変更・付け替えをした記事と追加したカテゴリは末尾に置く)                   | 仮3     |
| FR-ADMCF-014               | 付け替えた記事を「その他」の並び順の末尾に、元の相対的な順を保って置く旨を加える                                                                                                                                   | 仮3     |
| FR-ADMAG-017・019・026     | 「他のヘルプ記事が保持中の旧ハンドル文字列は登録済みとして扱わず、他の記事がその文字列を設定した時点で元の記事の旧ハンドルを物理削除する」旨を加える                                                               | 仮4     |
| FR-ADMCF-012・013          | カテゴリ名の重複を拒否する旨と、標準カテゴリ「その他」の名前の変更を禁じる旨を加える                                                                                                                               | 仮5     |
| FR-ADMAG-026               | 大文字小文字の表記だけの変更では旧ハンドルを保持しない旨を加える(明確化)                                                                                                                                           | 要件7.9 |

- サービス仕様(本specのタスク1.3で更新する): ページ配置(予約語の対象にヘルプ記事を含めない旨、並び順とピン留めの群、記事とカテゴリの並べ替えの画面)、文言規則(本文100,000文字)、準拠方針の「ヘルプ記事の旧ハンドル文字列」の削除方法(他の記事が同じ文字列を設定した時点で物理削除)。

## 上流・後続specへの影響

- user-profile-social(上流): ファイルの変更は無い。`common-lib/handles`・`previousHandleColumns`・`workers/handles`の公開の関数を使う。仮2の確定でハンドル基盤に加わった`previousHandleRelease(db: Database, ns: HandleNamespace, input: { readonly handle: string; readonly exceptOwnerId: string }): BatchItem<'sqlite'>`(他の対象が保持する同じ文字列の旧ハンドルの行を論理削除済みを含めて物理削除する文。現在のハンドルの書き込みの後に置く)と、他の対象の現在のハンドルだけを使用中とする`isHandleOccupied`・`handleOccupiedCondition`(`includePrevious`は使わない)を、user-profile-socialの設計の契約どおりに使う。user-profile-socialへの追加の依頼は無い。技術ドキュメント`backend/011-handle-namespaces.md`に「公開状態を持つ対象と、対象の削除での旧ハンドル」の節を追記する(本specのタスク)。
- content-processing(上流): `SEARCH_INDEXES`(`apps/db/search/search-indexes.ts`)・`SEARCH_TARGETS`(`apps/backend-lib/workers/search/targets/index.ts`)にヘルプ記事の定義を加える(契約どおり)。検索対象の名前は`help-article`。本文の最大長が100,000文字になるため、`renderMarkdown`の性能の劣化はcontent-processingの20,000文字の計測に加え、本specの100,000文字の計測でも検出する(content-processingの変更は不要)。
- admin-foundation(上流): `AUDIT_ACTIONS`に`audit-actions/help-center.ts`(8つの操作種別)、`ADMIN_NAV_ITEMS`にヘルプ記事(`/help-articles`・100)を加える(契約どおり)。`CategoryMasterEditor`の形は変えない。`AdminDirectory`はapiで使う。
- inquiry-chat(上流): `CATEGORY_SECTIONS`に`help-center.help-categories`(`order` 20)を加える(契約どおり)。
- frontend-platform(上流): `SITE_LAYOUT_SLOTS.footerHelpLinks`に`PinnedHelpLinks`を加える(契約どおり)。
- roadmap: 本specは4:21のジョブとユーザーライフサイクルの波及処理を持たないため、帯の割り当ての表の本specの「使用中の値」は「—」のままである。本specはroadmapを編集しない指示のため、コントローラーへ報告する。
- product-launch(並行・後続): ハンドル基盤を同じく使う。技術ドキュメントの番号は、本specが`frontend/011`を作らないため重ならない(G2)。
- launch-readiness(後続): 本番のヘルプ記事の本文の投入(運用)と、全体のE2E回帰にヘルプの流れ(並べ替えを含む)を含める。性能の検証のデータ規模に、100,000文字の本文のヘルプ記事の詳細ページの表示を含める(仮1)。

## 設計のレビュー(2026-10-23)

- 機械的な確認: 要件の97件の受け入れ基準の番号がすべて追跡表にあることを確かめた。境界の4節は空でない。ファイル構成に全コンポーネントの置き場所がある(上流の登録箇所への追記は「Modified Files」)。
- 1回目の判断のレビューで、(1)更新と削除で対象の記事が先に消えていた場合に監査ログだけが書かれる経路(`UPDATE`・`DELETE`の0行はエラーにならない)を、存在と版の確認の文で閉じた、(2)下書きへの変更で索引の更新の処理を待たずに`deleteSources`で索引から消すようにした、(3)旧ハンドルの解決で保持者が下書きの場合の404を読み取り側に置いた、(4)存在と版の確認の文の固定値が外部キーを満たすよう、カテゴリに標準カテゴリのIDを使うことを明記した。2回目で問題は無かった。

## タスクの計画の検証(2026-10-23)

- タスクのグラフのサニティレビューを2回行った。どちらも同じサブエージェントによる独立した確認(independent)である。
- 1回目の判定はNEEDS_FIXES(必須1件・軽微11件)だった。指摘は、(1)3.4が大きく束縛の範囲が曖昧(3.4のユースケースと3.5の照会・作成者の照会・束縛の統合タスクに分け、束縛する対象を列挙)、(2)スキーマのWorkers統合テストが無い(1.2に追加)、(3)小タスクが1つだけの大項目4(畳んで大項目へ)、(4)監査ログの詳細のテスト(3.4に追加し12.5を割り当て)、(5)作成者の照会の失敗の縮退のテスト(3.5に追加)、(6)完了状態の読み込みの制限の表記(D1と`apps/backend-lib`の関数に限定)、(7)上流の回帰テスト(6.1・7.1の完了状態に追加)、(8)部品のテストで並び順の規則を確かめる書き方(「APIが返した順のまま」へ)、(9)6.3が大きい(目次を6.3に分け、6.4・6.5に再編)、(10)技術ドキュメントの番号`frontend/011`がproduct-launchの設計と衝突(8で空きを確かめる手順を追加し、コントローラーへ報告)、(11)E2Eの前提の環境(9.1に明記)、(12)カテゴリの操作の理由の扱い(設計のHelpCategoryServiceに理由を受け取らない旨を追記)である。すべて直した。
- 2回目の判定はPASSだった。軽微の指摘2件に従い、目次のリンクで見出しが固定ヘッダーに隠れないことの確認を6.3から6.4へ移し、3.4に`(P)`と`_Boundary: HelpArticleEditor_`を付けた。

## 開発者の回答の反映(2026-10-24)

- 仮1〜仮5の確定を要件・設計・タスクに反映した。推奨と異なる案が選ばれた仮1〜仮4は振る舞いを改めた。
  - 仮1: 本文の上限を100,000文字にし(要件6.1、`HELP_BODY_MAX`)、100,000文字の描画の計測(`HelpBodyRenderBenchmark`)を加えた。
  - 仮2: 予約語の判定を外し(要件7.5、`HELP_ARTICLE_HANDLE_RULE.reservedWords`を空)、ページ配置の予約語の対象にヘルプ記事を含めない旨をタスク1.3に入れた。
  - 仮3: カテゴリと記事に`sort_order`を加え、並べ替えの操作(`reorderHelpArticles`・`reorderHelpCategories`)・並べ替えの画面(`/help-articles/order`、カテゴリの区画の並べ替えの部品)・確認の文(`helpOrderGuard`)・監査ログの操作種別(`help-article.reorder`・`help-category.reorder`)・エラーコード(`help_order_outdated`)を加えた。要件1.2・1.3・5.2・11.4・11.7を改め、6.12・9.8〜9.11・11.9〜11.11を加えた。ピン留めとの関係は「Decision: 管理者が指定する並び順とピン留めの群」に記録した。
  - 仮4: 他の記事の旧ハンドルを使用中とせず、ハンドル基盤の解放の文で設定と同じ一括の書き込みに物理削除するようにした(要件7.4・7.7・7.11、使用可否の4値、準拠方針の更新)。
  - 仮5: 推奨どおりで、振る舞いの変更は無い。
- 要件の受け入れ基準は97件から105件になった。

## 設計のレビュー(2026-10-24、決定の反映後)

- 変更した部分(並び順・旧ハンドルの解放・予約語・本文の上限)について設計のレビューの関門を作成した文脈で再び行った(inline)。機械的な確認: 要件の105件の受け入れ基準の番号がすべて追跡表にある。境界の4節は空でない。新しい部品(`HelpOrdering`・`HelpGuards`・`ReorderableList`・`HelpArticleOrderEditor`・`HelpCategoryOrderEditor`・`HelpBodyRenderBenchmark`)はファイル構成に置き場所がある。
- 判断のレビューで、user-profile-socialの確定した契約に合わせ、`previousHandleRelease`を現在のハンドルの書き込みの前から後へ移し、作成では新しい記事のIDを`exceptOwnerId`に渡すことを明記した。下書きの記事が他の記事の旧ハンドルを取った場合の404を要件7.4に加えた。

## タスクの計画の検証(2026-10-24、決定の反映後)

- 新しいサブエージェントによる独立した確認(independent)を1回行い、判定はPASSだった(必須0件・軽微6件)。
- 軽微の指摘に従い、(1)型の検査されるリンク先のルートを6.2・7.3で仮の部品のファイルとして先に作る手順を加えた、(2)下書きの記事が他の記事の旧ハンドルを取った後の404の確認を3.3に加えた、(3)作成者の項目のリゾルバ(5.2)・記事の並べ替えの部品(7.4)・削除のボタンの部品(7.6)を作るタスクを明記した、(4)記事のD1の実装を3.3(作成・更新・削除)と3.4(並べ替えと読み取り、同じファイルのため3.3の後)に分け、以降を3.5・3.6へ繰り下げた、(5)上流への影響の表の保留の時点をタスク1.1の前提の確認にそろえた、(6)Revalidation Triggersの「仮6」をadmin-foundationの仮6と明記した。

## 技術ドキュメントの番号の記述の修正(2026-10-24、spec横断レビュー3回目)

- product-launchが`frontend/012-business-date-calendar.md`を使うことに合わせ、タスク8・設計のRevalidation Triggers・本書のRisksと後続specへの影響の記述を「本specがroadmapの順で`frontend/011`、product-launchが`frontend/012`」に改めた(文言だけの変更)。新しいサブエージェントによる独立した軽い確認(1回)の判定はPASSだった。

## frontend-platformの実装で確定した契約の反映(2026-10-28、開発者の判断)

- frontend-platformが実装で確定した契約(同specのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に、開発者の判断(下流specの設計を今回改訂する)で本specの設計を合わせた。
- GraphQLの操作: 操作を各アプリの`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名を利用者側は`Client`、管理者側は`Admin`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む。`graphql()`を呼んで`.ts`のファイルに操作を書くと、操作の本文がブラウザのバンドルに残るため(frontend-platformの要件6.3)。tasks.mdの操作のタスクに、各アプリの`graphql:generate`とapiの`graphql:allowlist`の手順を書いた。
- フォーム: `useAppForm<TInput, TOutput>(schema, { defaultValues })`(`defaultValues`は全欄)と、必須の`onSubmitError`・任意の`serverFieldPrefix`(`input`を取るmutationは`"input"`)を受ける`AppForm`の形にした。画面側のスキーマの`zod`の値は`utilities/validation/zod.ts`から読む(CSPの下で`new Function`の試行を止める`jitless`の設定を済ませた`z`)。
- 失敗の文言: `GraphQLClientError`でない例外に代えて画面に出す文言を`errorMessageOf(error, <プロファイル>.contactAvailable)`で選ぶ。管理者側には問い合わせの画面が無いため、`ErrorState`・`UnexpectedErrorView`に`contactHref`を渡さず、問い合わせの導線と問い合わせを促す文を出さない(frontend-platformの要件8.6・8.13)。カテゴリの区画は、admin-foundationの`CategoryMasterEditor`の`failureMessageOf`(本改訂でadmin-foundationが加えた)に`errorMessageOf`を渡す。
- 変えた箇所: design.mdのAllowed Dependencies、File Structure Planの両アプリの`graphql/operations/help/`と`help-article-form-schema.ts`、`HelpArticleTable`・`HelpArticleForm`・`HelpArticleDeleteButton`(`ConfirmActionDialog`の`failureMessageOf`)・`HelpCategorySection`、Error Strategy。tasks.mdの6.1・7.1・7.3・7.5。要件は変えていない。

## フォームの描かない値と無効の欄の扱いの反映(2026-10-28、開発者の判断)

- **状態**: frontend-platformの最終検証の後の第2回の判断16・25〜28・30〜36(2026-10-28〜29)を、frontend-platformのタスク11.8として本specの設計とタスクへ反映した。受け入れ基準は変えていない。
- **Context**: frontend-platformの`SubmitButton`は、`root`以外の欄のエラー(サーバーの欄のエラーを含む)が1つでも残る間は無効になる。入力欄を描かない値をフォームのスキーマの入力に含めると、その値へのサーバーの詳細が利用者の直せない欄のエラーになり、送信ボタンが無効のまま残る。`applyServerFieldErrors`は、欄をまとめた値(配列でないオブジェクト)の経路と、`FormField`の`disabled`で無効にした欄の詳細を欄に付けず`onSubmitError`の`unmatched`へ渡し、`useAppForm`は検証の前に無効の欄の値を除く。無効の欄の値は`onSubmit`へ渡す値から外れ、無効になり得る欄はスキーマで任意(`.optional()`)にする。`FormField`は後から無効にした欄のエラーを消し、`useAppForm`は渡されたスキーマが変わると検証し直し、`applyServerFieldErrors`は描かれていない欄の詳細もフォーム全体の失敗にする。全欄が無効のフォームは`SubmitButton`の`disabled`で送信ボタンを無効にする。
- **決定**: `HelpArticleForm`のフォームの値を`CreateHelpArticleInput`・`UpdateHelpArticleInput`の形に合わせ、編集する値を`fields`の下(欄の名前は`fields.<名前>`)、変更の理由を`fields`の外の`reason`に置き、`serverFieldPrefix="input"`で`input.`を除いたサーバーの詳細の経路(`fields.categoryId`など)とそろえた(判断27)。編集する記事の`id`と版の値の`expectedRevision`はスキーマの入力に含めず`onSubmit`で足す(判断26の確認)。閲覧のみの管理者の`readOnly`は送信しないため、全欄を`FormField`の`disabled`で無効にすることだけを確かめて書いた。
- **変えた箇所**: design.mdの`HelpArticleFormValues`・`HelpArticleForm`、tasks.mdの7.5(フォームの値の形・サーバーの詳細の経路・閲覧のみの無効の方法)・7.6(記事のIDと版の送信)。

## 層の規則に合わせた契約の置き場所の改訂(2026-11-02、開発者の指示)

- **規則**: [依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析)のとおり、api・eventの`src/application/**`・`src/domain/**`は`**/lib/workers/**`を型だけのimportでも読み込めない。別の機能のapplication層が受け取る契約とDIの識別子は`backend-lib/core/<ドメイン>`に置き、`workers`には実装と束縛だけを置く。
- **移したもの**: 本specが所有する契約の移動は無い。`HelpAuthorLookup`(application層)が受け取るadmin-foundationの`AdminDirectory`と識別子`ADMIN_PLATFORM_TYPES`は、admin-foundationの改訂で`backend-lib/core/admin`へ移ったため、読み込み先を明記した。検索対象`HELP_ARTICLE_SEARCH_TARGET`は`workers/search/targets`に置いたまま、集約点を通して束縛の部品だけが使う。
- **新しいポートと実装**: 無い。
- **変えた箇所**: design.mdのAllowed Dependencies(admin-foundationの行)・Dependency Direction・HelpModule、brief.mdの作成者の表示の行。tasks.mdは置き場所を書いていないため変えていない。要件と受け入れ基準は変えていない。

---

## 実装前のギャップ分析(2026-11-11、上流specの実装の完了後)

### 分析の前提

- **状態**: 要件・設計・タスクは承認済み(`ready_for_implementation`は`false`)。設計は2026-10-23〜11-02に、上流specが未実装の段階で設計文書の契約を前提に作った。2026-11-11の時点で上流の6spec(user-profile-social・content-processing・admin-foundation・inquiry-chat・frontend-platform・legal-pages)と、同じ部品を先に使ったproduct-launch・directory-discoveryの実装が完了している。ヘルプのコード・テーブル・マイグレーション・GraphQLの操作・E2Eはまだ無い。
- **方法**: design.mdのAllowed Dependencies・Modified Files・File Structure Planの識別子と置き場所を実際のコードで照合し、設計の後に作成・改訂された技術文書(`security/007`・`frontend/008`・`frontend/014`・`db/003`・`db/004`・`backend/004`・`backend/011`)の規則と突き合わせた。steeringは`roadmap.md`だけで、product.md・tech.md・structure.mdは無い(CLAUDE.md・tech-stack.md・技術文書で代替)。
- **本節の扱い**: 設計を変えず、設計フェーズ(設計の改訂)へ持ち込む情報と選択肢を記録する。

### 契約の照合の結果(差異なし)

次の契約は、設計が前提にした形と意味のまま実装されている。

- ハンドル基盤: `defineHandleNamespace`(`activeCondition`は解決だけに使う)・`resolveHandle`(旧ハンドルの解決は保持者の状態を見ない)・`isHandleOccupied`(既定で他の対象の現在のハンドルだけ)・`handleOccupiedCondition`・`previousHandleUpsert(db, ns, { id, ownerId, handle, now })`・`previousHandleRelease(db, ns, { handle, exceptOwnerId })`(物理削除)・`previousHandleDelete`・`previousHandleColumns({ ownerColumnName, references })`(`handle`は`textNoCase().notNull().unique()`、`ownerId`は一意)。`backend/011`の「保存の一括の書き込み」は「解放を置き換えより前に置く」と定め、設計の更新の順((3)解放→(4)置き換え)と一致する。
- 検索の基盤: `defineSearchTarget`(`fields`の`format`・`textColumn`・`extract`、`read`・`isIndexable`)、登録時の検証(元テキストの列と項目の一致、抽出の対象が1つ以上)、`SearchIndexStatements.markPending(target, sourceId, now)`・`deleteSources(target, sourceIds)`、`SearchIndexRefreshRequester.requestRefresh`(送信の失敗は例外にしない)。`SEARCH_TARGETS`・`SEARCH_INDEXES`はproductの1件だけで、追記の形も設計どおり。
- 管理者の基盤: `AuditTargetKind`に`help-article`・`category`がある。`AUDIT_ACTIONS`は`audit-actions/<spec名>.ts`の連結。`AdminDirectory.findProfiles`と`ADMIN_PLATFORM_TYPES`は`backend-lib/core/admin`にあり、`AdminProfileView`は`{ id, nickname, title, avatarFileId }`。`buildAuditLogStatements(db, entry, guard?)`は`api/src/infrastructure/admin/audit-log-statements.ts`。
- 登録箇所: `ADMIN_NAV_ITEMS`の説明に「ヘルプ記事100」、`CategorySection`の説明に「help-centerのヘルプ記事カテゴリ20」が予約済み。`SITE_LAYOUT_SLOTS.footerHelpLinks`は空の配列で、部品は包む要素を持たずに0個以上の`li`を描く契約(設計の`PinnedHelpLinks`と一致)。
- `CategoryMasterEditor`のprops: `title`・`categories`・`withHandle`・`canEdit`・`onCreate`・`onUpdate`・`onDelete`・`failureMessageOf`・`deleteDescriptionOf`・`deleteAudited`・`serverFieldPrefix`。並べ替えは持たない。`InquiryCategorySection`(`apps/admin/src/components/inquiry/inquiry-category-section.tsx`)が同じ使い方の実例である。
- マークダウン: `renderMarkdown`の`headings`(`depth`・`id`・`text`)、`useMarkdownOptions({ externalLinkRel, sameOriginLinkRel?, idScope? })`、`markdownTextSchema({ label, maxGraphemes, required })`、`MarkdownEditor`の`maxGraphemes`。
- データ: `textNoCase`、標準カテゴリの初期データのカスタムマイグレーション(inquiry-chatの`01JC0000000000000000000000`。設計の`HELP_CATEGORY_OTHER_ID`は`…0001`で、`db/003`の「ULIDの時刻部と`created_at`を一致させる」規則に従えばよい)。
- 文書: `frontend/011`は空き番号のまま(010・012〜014は使用済み)。要件定義書の改訂(FR-ADMAG-029など)は適用済み。

### 要件と資産の対応

| 要件                     | 使う既存の資産(実在を確認)                                                                                                                                          | ギャップ                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1(カテゴリ別の一覧)      | `EmptyState`・`ErrorState`・`LoadingSkeleton`、`site-links.ts`のヘルプトップのリンク                                                                                | **Missing**: ヘルプのテーブル・照会・画面の全て                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2(検索)                  | `normalizeSearchTerms`・`buildFtsMatchExpression`・`ftsRankedSources`・`HighlightedText`、directory-discoveryの検索欄の実例                                         | **Constraint**: `frontend/014`の「クエリの正規化」は上限を超えたURLの検索語を黙って切り詰める(directory-discoveryの`normalizeDirectoryQuery`も同じ)。要件2.3と設計はURLの`q`が上限を超えると検索せずに上限の超過を示す。**Constraint**: `frontend/014`の「送信でだけ検索する入力欄」(上限の手前から文字数を示す、消去のボタン、URLの外からの変更で入力欄を戻す)が設計の`HelpSearchForm`に無い                                                                                  |
| 3(詳細・目次)            | `MarkdownContent`・`useRenderedMarkdown`・`useMarkdownOptions`、共通ヘッダーの`sticky top-0`(directoryの`scroll-mt-20`の実例)                                       | **Constraint**: `frontend/008`に「目次の作り方」の節(`headings`から作る`nav`、`id`をキーにする規則)が既にある。設計の`frontend/011-table-of-contents.md`の新規作成と内容が重なる。**Missing**: 目次の部品(既存の部品は無い)                                                                                                                                                                                                                                                    |
| 4・7(公開範囲・ハンドル) | ハンドル基盤の全部品、`/p/$handle`・`/@{$handle}`の302の実例(`graphql/product-page.ts`の`statusCode: 302`)                                                          | **Constraint**: `backend/011`の「新しい対象を足す手順」5は名前空間を`workers/<対象>/`に置くと定め、実装もproduct・profileが`backend-lib/workers/<対象>/`に置く。設計は`api/src/infrastructure/help/help-handle-namespace.ts`に置く                                                                                                                                                                                                                                             |
| 5(フッター)              | `footerHelpLinks`                                                                                                                                                   | 差異なし                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6・8(作成・編集・削除)   | `MarkdownEditor`(legal-pagesの`legal-draft-form.tsx`が100,000文字で使う実例)、`AuditLogRecorder.prepare`、`ConfirmActionDialog`                                     | **Constraint**: `AuditEntryInput`は`{ operatorAdminId, action, targetIds, reason?, detail?, occurredAt }`で、`detail`の値は文字列に限る。設計のユースケースの記述は`targets`と書き、`count`・`reassignedCount`の型を書いていない。**Constraint**: ユースケースが投げるエラーの定義は、inquiry・productと同じくapplication層(`application/<機能>/<機能>-errors.ts`)に置く必要がある(application層はpresentation層を読めない)。設計は`presentation/.../help/errors.ts`だけを置く |
| 9(管理の一覧・並べ替え)  | `AdminDataTable`・`AdminFilterBar`・`AdminPageHeader`、問い合わせの一覧のURLの条件の実例(`admin-inquiry-search.ts`の`toAdminInquirySearch`を`validateSearch`に渡す) | **Missing**: 上下の移動の並べ替えの部品(既存の部品もドラッグ&ドロップのパッケージも無い)。設計どおり新規に作る                                                                                                                                                                                                                                                                                                                                                                 |
| 10(索引)                 | `markPending`・`deleteSources`・`requestRefresh`、日次の再抽出                                                                                                      | 差異なし。抽出の対象を本文だけにする設計は、プライバシーポリシーの大枠の記載と一致する(productはタグラインも送るが、ヘルプは影響を受けない)                                                                                                                                                                                                                                                                                                                                    |
| 11(カテゴリ)             | `CategoryMasterEditor`、inquiry-chatの付け替えと初期データの実装、`category-sections.ts`                                                                            | 差異なし                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 12(権限・監査ログ)       | `requireAdmin`・`hasRole`・`RoleGate`・`useAdminRole`                                                                                                               | **Constraint**: `security/007`(2026-11-05改訂)の「宣言の入口」は管理者側のリゾルバを`adminOnly`で包むと定め、`backend/004`は呼び出し元の確認の包みを「各機能が持つ」とする。実装ではinquiry・product・adminのモジュールが`resolver-support.ts`に`adminOnly`(productは`clientOnly`も)を持ち、directoryの公開の照会は`clientOnly`で包む。設計には`adminOnly`・`clientOnly`と`resolver-support.ts`が無い                                                                          |
| 13(文書とテスト)         | `e2e/admin/admin-test.ts`・`client-page-test.ts`・`category-steps.ts`、`e2e/client/markdown-steps.ts`、索引を待つ`waitForDirectorySearchResult`(`toPass`)           | **Constraint**: E2Eは機能の操作の手順を`<手順の名前>-steps.ts`に分ける規約になっている(CLAUDE.mdのディレクトリ構成)。設計は`help-center.e2e.test.ts`の1ファイルだけを挙げ、既存の補助(カテゴリの区画の操作・マークダウンの入力・管理画面から利用者側のページを開く文脈)に触れていない                                                                                                                                                                                          |

### 設計の後に定着した画面の構成の規約

設計の File Structure Plan は、ルートのファイルに`loader`・`head`を書く前提である。実装済みのclient・adminは次の構成にそろっている。規則の文書に明記された項目と、実装の慣習だけの項目を分けて記す。

- 文書の規則: `frontend/006`の「取得の補助とloader」は、`ensureQueryData`を非推奨とし`queryClient.query({ ...graphqlQueryOptions(...), staleTime: 'static' })`を使うと定める。設計の`/help`・`/help/$handle`の`loader`は`ensureQueryData`と書いている。
- 実装の慣習: 取得の設定・`loader`の関数・表示用への変換を`src/graphql/<機能>.ts`(単体テストを併置)に置き、`head`は`src/head/page-heads.ts`(adminは`buildAdminPageHead`)で作り、ルートのファイルは部品と関数をつなぐだけにする。adminでは画面の本体を`components/pages/<画面>-page.tsx`、文言を`components/<機能>/<機能>-messages.ts`に置く。
- 実装の慣習: 管理者側のGraphQLの操作は、productが`operations/product/`の直下に平らに置く。設計の`operations/help/articles/`・`categories/`の入れ子も`src/graphql/operations/**/*.graphql`の規則の範囲内である。

### 実装の方針の選択肢

#### 案A: 設計のまま実装し、規約の差は実装中に合わせる

- 設計とタスクを改訂せずに着手し、上記の差(`adminOnly`・`clientOnly`、エラーの置き場所、`ensureQueryData`、取得の補助と`head`の置き場所、`AuditEntryInput`の項目名)を各タスクの実装で既存の規約に合わせ、tasks.mdのImplementation Notesに記録する。
- ✅ 着手が早い。上流の契約は全て実在し、形も変わっていない。
- ❌ 開発者の判断が要る3件(URLの検索語の超過・目次の文書の番号・名前空間の置き場所)を実装者が決めることになる。設計とコードの相違が実装の後に残る。

#### 案B: 着手の前に設計を改訂する

- 判断が要る3件を開発者に確かめ、機械的な差も含めて design.md の File Structure Plan・Components・Allowed Dependencies と tasks.md を改訂してから実装する。
- ✅ 設計・タスク・コードが一致したまま進む。タスクの境界(`_Boundary:_`)とファイルの一覧が実際の構成に合う。
- ❌ 改訂とレビューの手間がかかる。差の大半は既存の規約への機械的な合わせ込みで、振る舞いは変わらない。

#### 案C: 判断が要る件だけを設計で確定し、機械的な差は実装で合わせる(折衷)

- 判断が要る3件だけを開発者に確かめて requirements.md・design.md に反映し、機械的な差は案Aと同じく実装中に合わせて Implementation Notes に記録する。
- ✅ 振る舞いと文書の構成に関わる決定だけを先に固め、改訂の量を抑える。
- ❌ File Structure Plan のファイルの一覧が実際の構成(取得の補助・`head`・`resolver-support.ts`・application層のエラー)と一部ずれたまま残る。

### 開発者の判断が要る論点

| #   | 論点                                                        | 根拠                                                                                                                   | 選択肢                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | URLの検索語`q`が50文字を超える場合の扱い                    | 要件2.3(検索を実行せずに上限を示す)、`frontend/014`の「クエリの正規化」(黙って切り詰める)、directory-discoveryの実装   | (A)要件2.3のまま上限の超過の状態を示す(`frontend/014`の例外として設計に理由を書く) / (B)`frontend/014`に合わせて切り詰めて検索し、要件2.3を検索欄の送信だけに限る                                                 |
| G2  | 目次の技術文書                                              | 設計の`frontend/011-table-of-contents.md`の新規作成、`frontend/008`の既存の「目次の作り方」                            | (A)設計どおり`frontend/011`を作り、`frontend/008`の節から参照させる / (B)`frontend/008`の「目次の作り方」に固定の配置・折りたたみ・`scroll-margin-top`の規約を追記し、`frontend/011`を作らない                    |
| G3  | ハンドルの名前空間`HELP_ARTICLE_HANDLE_NAMESPACE`の置き場所 | `backend/011`の手順5(`workers/<対象>/`)、product・profileの実装、設計(apiだけが使うため`api/src/infrastructure/help/`) | (A)文書の規約どおり`backend-lib/workers/help/`に置く / (B)設計どおり`api/src/infrastructure/help/`に置き、`backend/011`の手順5に「1つのアプリだけが使う対象はそのアプリのinfrastructure層に置いてよい」旨を加える |

- `adminOnly`・`clientOnly`は`backend/004`が「各機能が持つ」と定めるため判断の対象にせず、`presentation/graphql/modules/help/resolver-support.ts`に置く案を設計へ加える。同じ包みは既にinquiry・product・adminの3か所にあり、本specで4か所目になる。共通化はリファクタリングとして別に扱う。

### 規模とリスク

- **規模: L(1〜2週間)**。4テーブルと2つのカスタムマイグレーション、検索対象、16のGraphQLの操作、利用者側と管理者側の画面(並べ替えの部品を含む)、E2Eと文書の更新がある。上流の部品は全て実在し、新しいパッケージは無い。
- **リスク: Medium**。上流の契約との結合は低いリスクだが、(1)記事の存在と版・並べ替えの対象の集合の確認の文はSQLiteの制約の検査の順に依存する(product・profileの保存の確認の文が先例)、(2)100,000文字の本文の描画の時間は未計測(content-processingの代表の計測は20,000文字)、(3)上記のG1〜G3と規約の差を実装中に取り違えると、設計とコードの相違が残る。

### 設計フェーズへの申し送り

- **推奨の進め方**: 案C。G1〜G3を開発者に1件ずつ確かめ、確定した案を requirements.md・design.md に反映する。あわせて、振る舞いを変えない次の差を design.md に書き足すと、タスクの境界と実際のファイルが一致する。
  - `presentation/graphql/modules/help/resolver-support.ts`(`adminOnly`・`clientOnly`)と、公開の4操作を`clientOnly`、管理者側の12操作を`adminOnly`で包むこと。
  - `application/help/help-errors.ts`(ユースケースが投げるエラーの定義)と、presentation層の`errors.ts`は入力の文言だけを持つこと。
  - client・adminの`src/graphql/help-*.ts`(取得の設定と`loader`)・`src/head/page-heads.ts`への追記・adminの`components/pages/`と文言のファイル、`ensureQueryData`から`queryClient.query({ staleTime: 'static' })`への置き換え。
  - `AuditLogRecorder.prepare`の入力の項目名(`operatorAdminId`・`targetIds`・`occurredAt`)と、詳細の値(`count`・`reassignedCount`・`fromStatus`・`toStatus`)を文字列にすること。
  - `HelpSearchForm`に`frontend/014`の「送信でだけ検索する入力欄」の残りの規則(上限の手前からの文字数の表示・消去のボタン・URLの外からの変更での入力欄の更新)を加えること。
  - E2Eの手順を`e2e/admin/help-center-steps.ts`などに分け、`admin-test.ts`・`client-page-test.ts`・`category-steps.ts`・`markdown-steps.ts`と、索引を待つ`toPass`の形を再利用すること。
  - Existing Architecture Analysisの「実装済みはdev-toolingだけ」を現状に改めること。
- **Research Needed**:
  - 100,000文字の代表的な本文の`renderMarkdown`の実測の時間(設計の1,500ms以内の目安が妥当か)。legal-pagesは同じ上限の本文を描くが、100,000文字の計測は持たない。
  - 記事の公開から検索の結果に出るまでの時間(Queueを1回経る。directory-discoveryは2回で90秒を待つ)と、E2Eの待ちの上限。
  - 確認の文の先例(`apps/api/src/infrastructure/product/product-save-guards.ts`)の形を、`helpArticleExistsGuard`・`helpOrderGuard`に流用できるか。

## ギャップ分析の論点の確定(2026-11-11に開発者が確定)

- **状態**: 「実装前のギャップ分析」の「開発者の判断が要る論点」のG1〜G3を開発者に1件ずつ確かめ、3件とも推奨の案に確定した。`requirements.md`の「実装前のギャップ分析での決定」にも同じ行がある。

| #   | 確定した案                                                                                                                                                                             | 変えた箇所                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | (B)`frontend/014`とdirectory-discoveryに合わせ、URLとAPIの入力の検索語を前後の空白を除いて50書記素に切り詰めて検索する。上限の超過で検索せずに上限を示すのは検索欄からの送信だけにする | 要件2.3を検索欄からの送信に限り、要件2.9(URLの`q`の切り詰め)を加えた(受け入れ基準は105件から106件)。design.mdに`common-lib/help/help-query-rules.ts`の`normalizeHelpSearchText`・`normalizeHelpTopQuery`を加え、`/help`の`validateSearch`・`loader`、`PublicHelpReader.search`、`HelpInputs`、Error Handlingの`validation_error`の行、追跡表、テストの観点を改めた。tasks.mdの1.1・5.3・6.2の確かめる内容と要件の番号を改めた |
| G2  | (B)目次の配置の規約を`frontend/008`の「目次の作り方」に追記し、`frontend/011`を作らない                                                                                                | design.mdのThis Spec Owns・Revalidation Triggers・上流への影響の表(content-processingの行)・File Structure Plan・Modified Files・HelpTechDocs・本プロジェクト固有の値の表、tasks.mdのタスク8、本書のSynthesis・Risks・後続specへの影響。要件13.4は文書の番号を指定しないため変えていない                                                                                                                                      |
| G3  | (A)`HELP_ARTICLE_HANDLE_NAMESPACE`を`backend/011`の手順5とproduct・profileの実装に合わせ`apps/backend-lib/workers/help/help-article-handle-namespace.ts`に置く                         | design.mdのThis Spec Owns・Selected pattern・New components rationale・Dependency Direction・File Structure Plan・コンポーネントの一覧の表・`HelpHandleNamespace`の契約のファイル名、tasks.mdの3.1。`backend/011`の変更は要らない                                                                                                                                                                                             |

- **残る事項**: 「設計フェーズへの申し送り」のうち、振る舞いを変えない規約の差(`adminOnly`・`clientOnly`と`resolver-support.ts`、application層のエラーの定義、`ensureQueryData`の置き換え、取得の補助と`head`の置き場所、`AuditEntryInput`の項目名、`HelpSearchForm`の`frontend/014`の残りの規則、E2Eの手順のファイル)は、今回の確定の対象に含めていない(次の節で反映した)。

## 申し送りの規約の差の反映(2026-11-11、開発者の指示)

- **状態**: 「実装前のギャップ分析」の「設計フェーズへの申し送り」のうち、振る舞いを変えない規約の差を、開発者の指示で推奨どおりdesign.mdとtasks.mdへ反映した。要件と受け入れ基準は変えていない。

| 項目                         | 反映した内容                                                                                                                                                                                                                                                                                       | 変えた箇所                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 呼び出し元の確認の包み       | `presentation/graphql/modules/help/resolver-support.ts`に`clientOnly`・`adminOnly`を置き、利用者側の4操作と管理者側の12操作を包む。`adminOnly`の内側を`withValidatedArgs`、その内側で`requireAdmin`を呼ぶ(`backend/004`、`security/007`の「宣言の入口」)                                           | design.mdのExisting Architecture Analysis・File Structure Plan・HelpSchemaModule・Testing Strategy・Security Considerations、tasks.mdの5.1・5.3              |
| エラーの定義の置き場所       | ユースケースが投げるエラーのコード・種類・文言をapplication層の`help-errors.ts`に置き、presentation層の`errors.ts`は入力の検証の文言だけを持つ                                                                                                                                                     | design.mdのExisting Architecture Analysis・File Structure Plan・HelpArticleEditor・HelpSchemaModule・Error Strategy、tasks.mdの3.1・3.5・5.1                 |
| 取得の方法                   | `ensureQueryData`を`queryClient.query({ ...graphqlQueryOptions(...), staleTime: 'static' })`に置き換える(`frontend/006`)                                                                                                                                                                           | design.mdのAllowed Dependencies(frontend-platform)・client・admin、tasks.mdの6.2                                                                             |
| 取得の補助と`head`の置き場所 | clientは`src/graphql/help-center.ts`・`src/head/page-heads.ts`(`buildSitePageHead`)・`NotFoundPage`、adminは`src/graphql/admin-help-articles.ts`・`admin-help-categories.ts`・`buildAdminPageHead`・`components/pages/`の画面の本体、両アプリの`components/help/help-messages.ts`                  | design.mdのExisting Architecture Analysis・File Structure Plan・Modified Files・client・admin・Testing Strategy、tasks.mdの6.1・6.2・6.5・7.1・7.3・7.4・7.6 |
| 監査ログの入力               | `AuditEntryInput`の`operatorAdminId`・`targetIds`・`occurredAt`を渡し、詳細の値(ステータス・件数)を文字列にする                                                                                                                                                                                    | design.mdのHelpArticleEditor・HelpCategoryService、tasks.mdの3.2・3.5                                                                                        |
| 検索欄の規則                 | `HelpSearchForm`に、`HELP_SEARCH_COUNTER_FROM`(40)書記素を超えたときの文字数の表示、上限の超過と回復の読み上げ、消去のボタン、URLの外からの変更での入力欄の更新、`resetScroll: false`の遷移を加える(`frontend/014`の「送信でだけ検索する入力欄」、directory-discoveryの`SearchForm`と同じ振る舞い) | design.mdのHelpInputRules・HelpSearchForm・Testing Strategy・本specが定める固有の値、tasks.mdの6.2                                                           |
| E2Eの手順                    | 画面の操作の手順を`e2e/admin/help-center-steps.ts`に分け、`admin-test.ts`・`client-page-test.ts`・`category-steps.ts`・`e2e/client/markdown-steps.ts`を再利用し、索引の更新を`toPass`で待つ                                                                                                        | design.mdのThis Spec Owns・Allowed Dependencies(e2e)・File Structure Plan・HelpCenterE2E・Testing Strategy、tasks.mdの9.1                                    |
| 既存の構成の記述             | Existing Architecture Analysisの「実装済みはdev-toolingだけ」を、上流specとproduct-launch・directory-discoveryが実装済みの現状に改める                                                                                                                                                             | design.mdのExisting Architecture Analysis                                                                                                                    |

- **判断**: `HelpSearchForm`はdirectory-discoveryの`SearchForm`と同じ振る舞いを本specの部品として作る。両方ともclientの部品のため、`frontend/005`の「2つ目のアプリで同じ部品が必要になった時点で共通部品へ移す」の条件には当たらない。
