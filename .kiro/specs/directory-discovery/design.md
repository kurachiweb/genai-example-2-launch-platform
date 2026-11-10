# Design Document

## Overview

**Purpose**: 予選で勝利したプロダクトだけを並べるディレクトリ(`/p`)と、プロダクト詳細ページ(`/p/{handle}`)と、掲載中のプロダクトの検索索引を実装する。ディレクトリは、product-launchの可視と勝利済みの条件・match-engineの予選の勝利の部品・content-processingの全文検索の部品を1回の問い合わせに結合し、プロダクトごとの基準勝利(期間内の最新の勝利、仮1・仮2)の値で並べ、20件ずつのオフセット方式で返す。詳細ページは、公開範囲の判定(掲載中は誰にでも、未掲載は投稿者本人だけ、非公開・停止・退会・削除は常に404)と旧ハンドルの302の後に、ヘッダー・開催中のマッチ・スクリーンショット・説明文・ローンチごとのマッチ履歴とサポーター・投稿者本人向けの操作を描き、評価・コメント・受賞・広告・通報の区画を登録口で受け付ける。索引は、勝利・編集・削除・非公開化・停止・復元・物理削除の各イベントへの処理で、掲載の条件に合わせて作り直す。

**Users**: 閲覧者はディレクトリで検索・絞り込み・並べ替え・ページの移動を行い、詳細ページでプロダクトの説明とマッチの実績とサポーターを見て、開催中のマッチにUpvoteする。投稿者は自分のプロダクトの詳細ページで進行状況を確かめ、編集と次回の予約へ進む。後続spec(engagement・tournament-week・tournament-year・sponsorship・content-reporting・public-api・ugc-moderation)の開発者は、区画と項目の値の登録口・一覧の照会の部品を使う。

**Impact**: D1に2テーブル(検索索引の文書・勝利したプロダクトの記録)と全文検索の索引を足す。`apps/common-lib/directory`にURLのクエリの規則、`apps/backend-lib/core/directory`に一覧の照会と記録の契約とDIの識別子、`apps/backend-lib/workers/directory`にそのD1の実装と束縛、`apps/backend-lib/workers/search/targets/product.ts`に検索対象を新設する。apiにスキーマモジュール`directory`・読み取りのユースケース・2つの同期の処理・保存の登録(仮4)を、eventに4つの非同期の処理と索引の更新待ちの書き込みの実装を、clientにディレクトリ・プロダクト詳細ページと区画の登録口を足す。上流のファイルは、契約で定められた登録箇所への追記(product-launchが仮11として提供する保存の登録口`PRODUCT_SAVE_HOOKS`への1行を含む)と、次の2つ(2026-11-10に開発者が決定)だけを変える。(1)詳細ページの開催中のマッチをトップページと同じ動きにするため、match-engineのトップページ専用の置き場所にある汎用の部品(自動更新の切り替え・フルタイムまでの残り時間・結果を待つ取り直しの上限と回数の数え方)を、clientの`components/top/`から`components/match/`へ移す。(2)投稿者本人向けの操作などの枠に使うshadcn/uiのカード(`Card`)を、frontend-libの`components/ui/card/`に作る。新しいシークレット・パッケージは無い。

### Goals

- FR-DIR-001〜014・FR-ADMUG-011が動作し、勝利→掲載と索引→編集→非公開化→復元、停止→解除、退会、物理削除のどの経路でも、一覧・検索・詳細ページ・索引が要件と仮1〜仮5の決定に一致する。
- 後続specが本specのファイルを変えずに、詳細ページ・ディレクトリの区画と一覧の項目の値を加えられる。
- 本specが追加・変更したコードの単体テスト・Workers統合テスト・ブラウザテストがカバレッジ80%を満たす。

### Non-Goals

- コメント・評価・受賞のトロフィー・参加費の決済・広告・通報の区画の中身(engagement・tournament-week・tournament-year・sponsorship・content-reporting)。
- マッチの進行とUpvoteの受け付け(match-engine)、プロダクトの保存と予約の判定(product-launch)、全文検索の基盤(content-processing)、公開APIの経路(public-api)。
- 掲載の写しのテーブル、ディレクトリの4:21のジョブ、要件定義書の改訂(必要な改訂は[research.md](research.md)の「要件定義書の改訂が必要な箇所」に記録した)。(2026-10-25に要件定義書へ適用済み)

## Boundary Commitments

### This Spec Owns

- ディレクトリのデータ: `product_search_documents`と全文検索の索引`product_search_documents_fts`・トリガー、`directory_entries`(`apps/db/schema/directory/`)と、索引の定義`PRODUCT_SEARCH_INDEX`。
- URLのクエリの規則(`apps/common-lib/directory/`): ページの大きさ・検索語の上限・並び順の値・クエリの正規化・期間のプリセットの展開。
- 共有部品: 一覧の照会`DirectoryListingQuery`と勝利したプロダクトの記録`DirectoryEntryStore`の契約(`apps/backend-lib/core/directory/ports.ts`)とDIの識別子`DIRECTORY_PLATFORM_TYPES`(`core/directory/identifiers.ts`)、そのD1の実装(`apps/backend-lib/workers/directory/d1-*.ts`)、索引の削除の文(`product-index-removal-statements.ts`の`accountIndexRemovalStatement`。DBの型を使うため`workers/directory`に置き、infrastructure層だけが使う)、両アプリ共通の束縛`DIRECTORY_PLATFORM_MODULE`。検索対象`PRODUCT_SEARCH_TARGET`(`backend-lib/workers/search/targets/product.ts`)。
- apiの読み取りのユースケース(ディレクトリ・カテゴリの選択肢・プロダクト詳細・サポーター・ローンチの要約・項目の値)、スキーマモジュール`directory`、項目の値の供給元の登録口`DIRECTORY_ITEM_METRIC_SOURCES`、同期の処理`directory-discovery.account-index-removal`・`directory-discovery.product-index-removal`、保存の登録`directory-discovery.product-index-refresh`(仮4)。
- eventの処理`directory-discovery.qualifier-listing`(マッチイベント)・`directory-discovery.product-index-restore`・`directory-discovery.entry-erasure`(プロダクト)・`directory-discovery.account-index-restore`(ユーザー)と、それらが受け取る索引の更新待ちの書き込みのポート`ProductIndexPendingMarker`(application層)とその実装`D1ProductIndexPendingMarker`(infrastructure層)。
- clientの`/p`・`/p/$handle`のルートと画面、区画の登録口`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`・`DIRECTORY_ITEM_METRICS`・`PRODUCT_PAGE_SECTIONS`・`PRODUCT_LAUNCH_SECTIONS`・`PRODUCT_OWNER_ACTIONS`。
- 技術ドキュメント`db/007-latest-row-per-group-listing.md`・`frontend/014-url-state-listing.md`の新規作成と、サービス仕様(ページ配置・文言規則)とオンボーディングの追記。

### Out of Boundary

- `products`・`product_launches`・`product_categories`などプロダクトのデータ、ハンドルの規則、保存と予約の判定(product-launch・user-profile-social)。本specは照会口・`visibleProducts()`・`wonLaunchExists()`・`productInCategory()`(product-launchの仮11)と、それらで絞った`products.id`・`products.category_id`だけを使い、プロダクトのテーブルへ書き込まない。
- マッチ・側・Upvoteのデータと規則(match-engine)。本specは`MatchDirectory`・`SupporterDirectory`・`qualifierWins()`・`loadMatchView`・対戦カードの部品だけを使い、マッチのテーブルへ書き込まない。clientの汎用の部品の移動(Overview)は置き場所と読み込みの変更だけで、振る舞いを変えない。
- 索引の文書の書き込み・キーワードの抽出・日次の再抽出(content-processing)。本specは検索対象の定義と、更新待ちの印・削除の文・更新の要求を使う。
- 区画と項目の値の中身(engagement・tournament-week・tournament-year・sponsorship・content-reporting)、公開APIの経路(public-api)、非公開化・停止の操作(ugc-moderation)。

### Allowed Dependencies

- backend-platform: `AppModule`・`PLATFORM_TYPES`(`Database`・`Clock`。`Database`はinfrastructure層と`workers`だけが受け取る)・`AppError`・`getAppLogger`・`ulidPrimaryKey`・`timestamps`・`BusinessTime`(`toBusinessDateTime`・`parseBusinessDate`・`BusinessDate`)、E2Eの`e2e/support/scheduled-trigger.ts`(`triggerScheduled`、backend-platformの改訂2)。形を変えない。
- api-gateway: `defineSchemaModule`・`GraphQLContext`(`resolve`・`caller`・`session`・`loaders`)・`withValidatedArgs`・`encodeCursor`・`decodeCursor`・`defineLoader`・`DateTime`・`PageInfo`。
- identity-auth: `AccountGuard.currentUser`(識別子は`IDENTITY_PLATFORM_TYPES.AccountGuard`)・`CurrentUser`・`UserLifecycleEvent`・`UserLifecycleSyncHandler`・`USER_LIFECYCLE_SYNC_HANDLERS`・`UserLifecycleAsyncHandler`・`USER_LIFECYCLE_ASYNC_HANDLERS`・`LifecycleHandlerOutcome`・`LIFECYCLE_CONTINUE_DELAY_SECONDS`・`viewerQueryOptions`・`users`(`visibleProducts()`の結合だけ)・E2Eの`e2e/support/mailpit.ts`。
- product-launch: `PRODUCT_PLATFORM_TYPES`の`ProductDirectory`(`findSummaries`・`resolveHandle`・`findDetail`・`listLaunches`)・`ProductCategoryDirectory`(`list`・`findByHandle`)と`ProductSummaryRecord`・`ProductDetailRecord`・`LaunchRecord`・`ProductHandleResolution`・`ProductCategoryRecord`(契約は`core/product/ports.ts`、識別子は`core/product/identifiers.ts`)、`D1ProductDirectory`(`workers/product`。検索対象の`read`での直接の生成)、`visibleProducts()`・`wonLaunchExists()`・`productInCategory()`(product-launchの仮11。これらで絞った`products.id`・`products.category_id`を並べ替えと集計に使う)、`products`への外部キー、`ProductLifecycleEvent`・`ProductLifecycleSyncHandler`・`PRODUCT_LIFECYCLE_SYNC_HANDLERS`・`ProductLifecycleAsyncHandler`・`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`、`ProductSaveHook`・`ProductSaveHookRegistration`・`PRODUCT_SAVE_HOOKS`(product-launchの仮11。契約はapiの`infrastructure/product/product-save-hooks.ts`にあり、本specのinfrastructure層の実装だけが使う)、`LaunchSummarySource`・`LAUNCH_SUMMARY_SOURCES`・`DecisionSourceRegistration`、`fallbackLaunchSummary`・`groupAwards`(`backend-lib/core/product/launch-summary.ts`)、`PRODUCT_HANDLE_RULE`、GraphQLの`ProductCategory`・`productCategoryLoader`・`LaunchSummary`・`LaunchStatus`・`ProductAward`・`productOwnerStatus`、E2Eの製品登録の画面。
- match-engine: `MATCH_PLATFORM_TYPES`の`MatchDirectory`(`listByLaunches(launchIds, now)`・`findMatches(matchIds, now)`)・`SupporterDirectory`(契約と識別子は`core/match`)、`MatchRecord`・`EntryResult`・`MatchDecision`・`isWinningResult`、`qualifierWins()`(別名付きの副問い合わせ。`const wins = qualifierWins()`で受けて`wins.productId`などで結合する。`lastUpvotedAt`・`decidedAt`はエポックミリ秒の数値、`matchDate`は文字列)、`MatchEvent`・`MatchEventHandler`・`MATCH_EVENT_HANDLERS`、GraphQLの`Match`・`MatchKind`・`MatchStage`・`MatchPhase`・`MatchEntryResult`・`MatchDecision`・`loadMatchView(context, matchId)`(`match-views.ts`。後続specは`matchViewLoader`を直接`load`しない)、clientの`MatchCard`・`useUpvote`・`UpvoteBotProtection`(内側に`match_upvote`の`TurnstileWidget`を1つ描き、`useUpvote`はその内側でだけ呼べる)・`useServerCountdown`・`match-labels.ts`・`stadium.css`・`MatchFragment`、本specが`components/top/`から`components/match/`へ移す`AutoRefreshSwitch`・`FullTimeCountdown`・`full-time-countdown-text.ts`・`FOLLOW_UP_REFETCH_LIMIT`・`updateCountOf`、E2Eの`e2e/client/match-steps.ts`(`moveLaunchesToDate`・`startQualifiers`など)。
- content-processing: `searchDocumentColumns`・`searchTextColumn`・`searchDocumentStatusIndex`・`defineSearchIndex`・`SEARCH_INDEXES`・`ftsRankedSources`・`bm25Rank`・`print-search-index-sql.ts`、`defineSearchTarget`・`SEARCH_TARGETS`・`SearchIndexStatements`(`workers/search`。infrastructure層だけが使う)・`SEARCH_TYPES`・`SearchIndexRefreshRequester`(`core/search`。application層も使う)、`normalizeSearchTerms`・`buildFtsMatchExpression`・`countGraphemes`、`HighlightedText`・`CollapsibleMarkdownContent`・`useMarkdownOptions`。
- user-profile-social: `checkHandleFormat`・`checkExternalUrl`・GraphQLの`UserSummary`・`userSummaryLoader`・`publicProfile`(`viewerRelation`)・`FollowButton`・`UserAvatar`。
- media-pipeline: `mediaFileLoader`・`toMediaImage`・GraphQLの`MediaImage`・`MediaPicture`。
- frontend-platform: `executeGraphQL`・`graphqlQueryOptions`・`graphqlQueryKey`・`GraphQLClientError`・GraphQLの操作の追加手順(`src/graphql/operations/**/*.graphql`と生成物`src/graphql/generated/graphql.ts`)・`buildPageHead`(clientの`buildSitePageHead`)・`NotFoundView`(clientの`components/pages/not-found-page.tsx`)・`ErrorState`・`PartialErrorState`・`EmptyState`・`LoadingSkeleton`・`RecoverableSlot`・`notify`・日時の表示部品・`LIVE_REFRESH_QUERY_OPTIONS`・`LIVE_REFRESH_INTERVAL_MS`(`utilities/query/live-refresh.ts`)・clientの`useBoundaryRefresh`(`components/time/use-boundary-refresh.ts`)・shadcn/uiの部品(ボタン・バッジ・ツールチップ・シート・ポップオーバー・セレクト・入力欄・スイッチ・ラベル)と本specが作るカード(`Card`)・`runAxe`・デザイントークン。identity-authの`LoginRequiredDialog`。
- admin-foundation: E2Eの`e2e/support/local-d1.ts`(`executeLocalD1`・`sqlStringLiteral`)。
- npmパッケージ: 新規なし。
- 後続specは、`common-lib/directory`・`core/directory`の公開の契約と識別子`DIRECTORY_PLATFORM_TYPES`、apiの`DIRECTORY_ITEM_METRIC_SOURCES`と`DirectoryItemMetricSource`、clientの6つの登録口と区画の文脈の型だけに依存し、本specのテーブルへ書き込まない。

### Revalidation Triggers

- `DirectoryListingQuery`の入力と返す列、基準勝利と並べ替えの規則(public-api、仮1・仮2の決定)。
- `DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`・`DIRECTORY_ITEM_METRICS`・`PRODUCT_PAGE_SECTIONS`・`PRODUCT_LAUNCH_SECTIONS`・`PRODUCT_OWNER_ACTIONS`の置き場所・文脈の型(詳細ページの区画の文脈の自動更新の切り替えの状態`autoRefresh`と申告`reportAutoUpdating`を含む)・本specの`order`(engagement・tournament-week・tournament-year・sponsorship・content-reporting)。
- frontend-libの`Card`の部分の構成(engagementの評価・sponsorshipの広告など、後続specの枠)。`components/match/`へ移した`AutoRefreshSwitch`・`FullTimeCountdown`・`FOLLOW_UP_REFETCH_LIMIT`・`updateCountOf`の形(match-engineのトップページ、tournament-week・tournament-yearの対戦の画面)。
- `DirectoryItemMetricSource`の形(engagement)。
- 索引の対象の条件(掲載中)と、処理の名前・`order`(1200)(ugc-moderation・運用)。
- 上流の`qualifierWins()`・`MatchDirectory`・`SupporterDirectory`・`MATCH_EVENT_HANDLERS`の`order`の規則、`ProductDirectory`・`visibleProducts()`・`wonLaunchExists()`・`productInCategory()`・`PRODUCT_SAVE_HOOKS`の`ProductSaveHook`・`fallbackLaunchSummary`・`groupAwards`・`LAUNCH_SUMMARY_SOURCES`・`productOwnerStatus`(product-launchの仮11を含む)、`SearchTargetDefinition`・`ftsRankedSources`・`buildFtsMatchExpression`、`FollowButton`・`publicProfile`、`MatchCard`・`useUpvote`・`UpvoteBotProtection`・`loadMatchView`・`useBoundaryRefresh`の形、[集計値と残り時間を表示し続ける画面](../../../docs/GUIDES/tech/frontend/013-live-scoreboard.md)・[表示中の画面の定期再取得](../../../docs/GUIDES/tech/frontend/010-live-refresh-queries.md)の規則を変えたら、本specを確かめ直す。
- 同期の処理の文の規約(backend/007・012の「集合に対する更新・挿入・削除」、2026-11-10に開発者が削除を加えると決定)。削除を許さない形に戻すなら、`directory-discovery.account-index-removal`・`directory-discovery.product-index-removal`と要件12.4・12.5を見直す。
- `core/directory`の契約(`DirectoryListingQuery`・`DirectoryEntryStore`)と`DIRECTORY_PLATFORM_TYPES`の置き場所。application層が`**/lib/workers/**`を読み込めない規則(backend-platform)が変わっても、置き場所を`workers`へ戻さない(本specとpublic-apiのapplication層が読み込むため)。
- backend-platformの改訂2の`triggerScheduled`の引数(`worker`・`businessDate`・`businessTime`)を変えたら、E2Eの23:40の確定の起動(9.1・9.2)を確かめ直す。

### 上流への影響

| 上流spec                      | 変更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 影響と再検証                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| product-launch                | 登録箇所への追記: `composition/product-save-hooks.ts`に`directory-discovery.product-index-refresh`、`product-lifecycle-sync-handlers.ts`に`directory-discovery.product-index-removal`、`product-lifecycle-async-handlers.ts`に`directory-discovery.product-index-restore`・`directory-discovery.entry-erasure`(1200)。保存の登録口・`productInCategory()`・`launch-summary.ts`はproduct-launchが仮11として提供する(本specの依頼による)                                                                                    | 契約どおり。`createProductSaveHooks`の名前の検証と、各ライフサイクルの登録口の検証を通る                                                                                                               |
| match-engine                  | `apps/event/src/composition/match-event-handlers.ts`に`directory-discovery.qualifier-listing`(1200)                                                                                                                                                                                                                                                                                                                                                                                                                       | 契約どおり。`createMatchEventRegistry`の検証を通る                                                                                                                                                     |
| identity-auth                 | `apps/api/src/composition/user-lifecycle-sync-handlers.ts`に`directory-discovery.account-index-removal`、`apps/event/src/composition/user-lifecycle-async-handlers.ts`に`directory-discovery.account-index-restore`(1200)                                                                                                                                                                                                                                                                                                 | 契約どおり                                                                                                                                                                                             |
| content-processing            | `apps/db/search/search-indexes.ts`の`SEARCH_INDEXES`に`PRODUCT_SEARCH_INDEX`、`apps/backend-lib/workers/search/targets/index.ts`の`SEARCH_TARGETS`に`PRODUCT_SEARCH_TARGET`                                                                                                                                                                                                                                                                                                                                               | 契約どおり。`targets/index.unit.test.ts`・`search-index-migrations.unit.test.ts`を通る。help-centerが未実装のため、2つの集約点への最初の登録になる                                                     |
| match-engine(画面)            | clientの`components/top/auto-refresh-switch.tsx`・`full-time-countdown.tsx`・`full-time-countdown-text.ts`と、`top-page-messages.ts`の`AUTO_REFRESH_LABEL`・`AUTO_REFRESH_DESCRIPTION`、`qualifier-refresh.ts`の`FOLLOW_UP_REFETCH_LIMIT`・`QueryUpdateCounts`・`updateCountOf`を`components/match/`へ移し、トップページの読み込みを書き換える(2026-11-10に開発者が決定)。予選の一覧だけの判定(`canQualifierBoardChange`・`qualifierRefetchIntervalOf`・`isFollowUpExhausted`・`orderMatchesBy`)は`components/top/`に残す | 振る舞いは変えない。トップページの既存のブラウザテスト・単体テストを移した先の読み込みで通す。frontend/013の部品の表の自動更新の切り替えの置き場所を、複数のページが使う場合の置き場所を含む形に改める |
| frontend-platform             | frontend-libの`components/ui/card/`にshadcn/uiの`Card`を部分ごとのファイル(`card.tsx`・`card-header.tsx`・`card-title.tsx`・`card-description.tsx`・`card-action.tsx`・`card-content.tsx`・`card-footer.tsx`)で作り、カタログとブラウザテストを添える(2026-11-10に開発者が決定)                                                                                                                                                                                                                                           | 既存の部品は変えない。frontend/005の部品の一覧に`Card`を加える                                                                                                                                         |
| identity-auth・product-launch | 同期の処理の契約のコメント(`UserLifecycleSyncHandler`・`ProductLifecycleSyncHandler`)とbackend/007・012の文の規約を「集合に対する更新・挿入・削除」に改める(2026-11-10に開発者が決定、反映済み)                                                                                                                                                                                                                                                                                                                           | 既存の同期の処理の振る舞いは変えない                                                                                                                                                                   |

- roadmapの帯の割り当ての表の本specの「使用中の値」は「波及処理は1200」になる(本specはroadmapを編集しないため、コントローラーへ報告する)。

## Architecture

### Existing Architecture Analysis

- 本specが依存する上流のspecは実装済みである(2026-11-10の照合は[research.md](research.md)の「上流の実装の完了後のギャップ分析」)。roadmapで本specより前のhelp-centerは未実装で、全文検索の集約点(`SEARCH_INDEXES`・`SEARCH_TARGETS`)は空のため、本specの`product`が実際の検索対象の最初の登録になる。登録の形の先例は`workers/search/testing/fixture-search-target.ts`である。
- apiはクリーンアーキテクチャ(`domain`→`application`→`infrastructure`・`presentation`→`composition`)、処理単位のDIコンテナ、D1の`db.batch()`を使う。ライフサイクルの同期の処理は確定と同じ一括の書き込みに入る集合の更新の文、非同期の処理とマッチイベントの処理はeventの実行器で`order`の昇順に少なくとも1回動く。
- 索引の文書はcontent-processingの`search-index.refresh`の処理が、検索対象の`read`で元データを読み直して条件付きで書く。ドメインは更新待ちの印・削除の文を自分の書き込みに入れ、確定の後に更新を要求する。

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph ClientWorker[client worker]
        DirRoute[directory route]
        PageRoute[product page route]
        Registries[section registries]
    end
    subgraph ApiWorker[api worker]
        DirModule[directory graphql module]
        Readers[directory page supporter readers]
        Highlights[launch highlights and item metrics]
        SyncRemoval[index removal sync handlers]
        SaveHook[product index refresh save hook]
    end
    subgraph EventWorker[event worker]
        Listing[qualifier listing handler]
        Restore[index restore and entry erasure]
        Refresh[content processing refresh handler]
    end
    subgraph BackendLib[backend lib]
        ListingQuery[directory listing query]
        EntryStore[directory entry store]
        Target[product search target]
    end
    MatchEngine[match engine]
    ProductLaunch[product launch]
    Identity[identity auth]
    Downstream[downstream specs]
    DirRoute --> DirModule
    PageRoute --> DirModule
    PageRoute --> MatchEngine
    DirModule --> Readers
    Readers --> ListingQuery
    Readers --> Highlights
    Readers --> ProductLaunch
    Readers --> MatchEngine
    ListingQuery --> MatchEngine
    ListingQuery --> ProductLaunch
    Identity --> SyncRemoval
    ProductLaunch --> SyncRemoval
    ProductLaunch --> SaveHook
    SyncRemoval --> EntryStore
    MatchEngine --> Listing
    ProductLaunch --> Restore
    Identity --> Restore
    Listing --> EntryStore
    Restore --> EntryStore
    Refresh --> Target
    Target --> ProductLaunch
    Downstream --> Registries
    Downstream --> Highlights
    Downstream --> ListingQuery
```

**Architecture Integration**:

- Selected pattern: クリーンアーキテクチャ。URLのクエリの正規化・公開範囲・マッチ履歴の写像は純粋な関数、ユースケースはポート越しにproduct-launch・match-engine・本specの部品を使う。一覧は上流の条件の部品を結合した1回の問い合わせで、写しのテーブルを持たない(research.mdの比較)。
- Domain/feature boundaries: 掲載の条件・一覧・索引の対象は本spec、プロダクトのデータと可視性の条件はproduct-launch、マッチと勝敗はmatch-engine、索引の書き込みはcontent-processing、区画の中身は後続spec。
- Existing patterns preserved: `backend-lib/core/<ドメイン>`の契約と識別子・`backend-lib/workers/<ドメイン>`の実装と共有の束縛、`<spec名>.<名詞句>`の処理の名前、帯の`order`、登録箇所への追記による拡張(`TOP_PAGE_SECTIONS`・`LAUNCH_SUMMARY_SOURCES`と同じ形)、user-profile-socialの公開プロフィールの解決と302、help-centerの検索対象の登録。
- New components rationale: `directory_entries`は利用者単位の索引の削除と作り直しを、product-launchのテーブルを読まずに行うため。区画の登録口は詳細ページの所有の規則(roadmapの画面シェル)のもとで後続specが区画を加えるため。
- Steering compliance: Inversifyの`@inject`の明示、D1の制約(`db.batch()`・バインド変数100個以内・FTS5はカスタムマイグレーション)、800行以内のファイル、1ファイル1コンポーネント、日時の`<time datetime>`、新しいパッケージなし。

**Dependency direction**: `apps/common-lib/directory` → `apps/db/schema/directory` → `backend-lib/core/directory`(`core`の他の部品だけ) → `backend-lib/workers/directory`・`backend-lib/workers/search/targets/product.ts`(D1) → 各アプリの`src`(`domain` → `application` → `infrastructure`・`presentation` → `composition`)。api・eventのapplication層は`**/lib/workers/**`を型も含めて読み込めないため、application層とpublic-apiが使う契約(`DirectoryListingQuery`・`DirectoryEntryStore`)と識別子`DIRECTORY_PLATFORM_TYPES`は`core/directory`に置き、`workers/directory`にはD1の実装・DBの型を使う削除の文・束縛だけを置く(identity-authの`core/identity`と同じ配置)。application層は上流の契約も`core/product`・`core/match`・`core/search`から読み込む。文を返す`SearchIndexStatements`(`workers/search`)・`accountIndexRemovalStatement`・`ProductSaveHook`はinfrastructure層だけが使い、application層はデータベースの接続・SQLの文・一括の書き込みを扱わない(eventの更新待ちの書き込みは`ProductIndexPendingMarker`のポート越しに行う)。`common-lib`は他の層を読み込まない。clientは`common-lib`とGraphQLの操作と上流の画面部品だけを読み込む。

### Technology Stack

| Layer     | Choice / Version                                                     | Role in Feature                                  | Notes                                            |
| --------- | -------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| Frontend  | TanStack Start・Router・Query・shadcn/ui・lucide-react・sonner(上流) | ディレクトリ・詳細ページ・区画の登録口           | 日付入力はブラウザの入力欄、新規パッケージなし   |
| Backend   | Hono・Inversify・GraphQL Yoga(上流)                                  | スキーマモジュール・読み取りのユースケース・処理 | 既存                                             |
| Data      | Cloudflare D1(Drizzle・SQLite FTS5・窓関数)                          | 2テーブル・全文検索の索引・一覧の問い合わせ      | 新規のマイグレーションとカスタムマイグレーション |
| Messaging | Cloudflare Queues(上流)                                              | `search-index.refresh`(content-processing)の要求 | 新しいメッセージ種別なし                         |
| External  | Google Cloud Natural Language(content-processing経由)                | 説明文のキーワード抽出                           | 本specは直接呼ばない                             |

## File Structure Plan

### Directory Structure

```
apps/
├── common-lib/directory/                                      # 4アプリ共通(各ファイルに同名の*.unit.test.ts)
│   ├── directory-query-rules.ts                               # 定数・並び順・normalizeDirectoryQuery・withConditions
│   └── directory-period.ts                                    # 期間のプリセットの展開と判定・期間の表示の文言
├── db/
│   ├── schema/directory/                                      # テーブル定義(各ファイルに同名の*.unit.test.ts)
│   │   ├── product-search-documents.ts                        # 索引文書(name・tagline)
│   │   ├── product-search-index.ts                            # PRODUCT_SEARCH_INDEX(重み10・5・1)
│   │   ├── directory-entries.ts                               # 勝利したプロダクトと投稿者
│   │   └── index.ts
│   └── search/search-indexes.ts                               # (変更)PRODUCT_SEARCH_INDEXを追記
├── backend-lib/core/directory/                                # api・eventとpublic-apiのapplication層が読み込める契約(Bunの単体テスト)
│   ├── ports.ts                                               # DirectoryListingInput・DirectoryListingRow・DirectoryListingQuery・DirectoryEntryStore
│   ├── identifiers.ts                                         # DIRECTORY_PLATFORM_TYPES(api・event共通の識別子)
│   └── identifiers.unit.test.ts                               # Symbol.for('directory.<名前>')と凍結
├── backend-lib/workers/
│   ├── search/targets/product.ts                              # PRODUCT_SEARCH_TARGET(*.worker.test.ts)
│   ├── search/targets/index.ts                                # (変更)SEARCH_TARGETSに追記
│   └── directory/                                             # D1の実装と束縛(Workers統合テスト、各ファイルに同名の*.worker.test.ts)
│       ├── d1-directory-listing.ts                            # DirectoryListingQueryのD1実装(一覧・件数・カテゴリごとの掲載数の問い合わせ)
│       ├── d1-directory-entry-store.ts                        # DirectoryEntryStoreのD1実装
│       ├── product-index-removal-statements.ts                # 利用者・プロダクト単位の索引の削除の文(DBの型を使うため、infrastructure層だけが使う)
│       └── directory-platform-module.ts                       # DIRECTORY_PLATFORM_MODULE
├── api/src/
│   ├── domain/directory/                                      # 純粋な規則(Bunの単体テスト)
│   │   ├── product-page-access.ts                             # 公開範囲・302・404の判定
│   │   ├── base-win.ts                                        # 基準勝利の種類(勝利・不戦勝・早期の不戦勝)
│   │   └── match-history.ts                                   # マッチ履歴の行・対戦相手の公開範囲・通算成績
│   ├── application/directory/                                 # ユースケース(Bunの単体テスト)
│   │   ├── directory-types.ts                                 # DIRECTORY_TYPES
│   │   ├── item-metric-sources.ts                             # DirectoryItemMetricSource・登録の型
│   │   ├── directory-reader.ts                                # 一覧の1ページの組み立て
│   │   ├── directory-category-reader.ts                       # カテゴリの選択肢の並び
│   │   ├── product-page-reader.ts                             # 詳細ページの組み立て
│   │   ├── live-match-reader.ts                               # 開催中のマッチ・変化を待つ状態・サーバーの時刻(定期の取り直しの対象)
│   │   ├── supporter-list-reader.ts                           # サポーターの一覧
│   │   ├── launch-highlights-reader.ts                        # LAUNCH_SUMMARY_SOURCESの呼び出しと縮退
│   │   └── item-metrics-reader.ts                             # DIRECTORY_ITEM_METRIC_SOURCESの呼び出しと縮退
│   ├── infrastructure/directory/                              # Workers統合テスト
│   │   ├── account-index-removal-sync-handler.ts              # directory-discovery.account-index-removal
│   │   ├── product-index-removal-sync-handler.ts              # directory-discovery.product-index-removal
│   │   └── product-index-refresh-save-hook.ts                 # directory-discovery.product-index-refresh(仮4)
│   ├── presentation/graphql/modules/directory/                # スキーマモジュール(Workers統合テスト)
│   │   ├── type-defs.ts
│   │   ├── inputs.ts
│   │   ├── directory-views.ts                                 # 項目のリゾルバ(logo・category・owner・ProductLiveMatch.match)
│   │   ├── directory-resolvers.ts                             # directory・directoryCategories
│   │   ├── product-page-resolvers.ts                          # productPage
│   │   ├── live-match-resolvers.ts                            # productLiveMatch
│   │   ├── supporter-resolvers.ts                             # matchSupporters
│   │   └── index.ts                                           # directorySchemaModule
│   └── composition/
│       ├── directory-module.ts                                # DIRECTORY_MODULE(apiの束縛)
│       └── directory-item-metric-sources.ts                   # DIRECTORY_ITEM_METRIC_SOURCES(初版は空)
├── event/src/
│   ├── application/directory/                                 # Bunの単体テスト
│   │   ├── event-directory-types.ts                           # EVENT_DIRECTORY_TYPES
│   │   ├── ports.ts                                           # ProductIndexPendingMarker(更新待ちの書き込みの単位)
│   │   ├── qualifier-listing-handler.ts                       # マッチのdecided 1200
│   │   ├── product-index-restore-handler.ts                   # プロダクトのunhidden 1200
│   │   ├── entry-erasure-handler.ts                           # プロダクトのpurge_due 1200
│   │   └── account-index-restore-handler.ts                   # ユーザーのunsuspended 1200
│   ├── infrastructure/directory/                              # Workers統合テスト
│   │   └── d1-product-index-pending-marker.ts                 # ProductIndexPendingMarkerの実装(markPendingの文の一括の書き込み)
│   └── composition/directory-module.ts
├── client/src/
│   ├── routes/p/index.tsx                                     # /p
│   ├── routes/p/$handle.tsx                                   # /p/{handle}(302・404の分岐)
│   ├── composition/directory-sections.ts                      # DIRECTORY_PAGE_SECTIONS・DIRECTORY_LIST_INSERTS・DIRECTORY_ITEM_METRICS(初版は空)
│   ├── composition/product-page-sections.ts                   # PRODUCT_PAGE_SECTIONS(初版は本specの4件)・PRODUCT_LAUNCH_SECTIONS・PRODUCT_OWNER_ACTIONS(初版は空)
│   ├── components/directory/                                  # 1ファイル1コンポーネント(browser testを併置)
│   │   ├── directory-section-types.ts                         # 登録の型(テストなし)
│   │   ├── directory-page.tsx                                 # 見出し・条件・件数・一覧・区画の枠
│   │   ├── search-form.tsx
│   │   ├── filter-toolbar.tsx                                 # 768px以上の横並び
│   │   ├── filter-sheet.tsx                                   # 768px未満の下部のシート
│   │   ├── category-picker.tsx
│   │   ├── period-filter.tsx
│   │   ├── period-range-form.tsx
│   │   ├── sort-select.tsx
│   │   ├── result-count.tsx
│   │   ├── directory-item.tsx
│   │   ├── win-summary.tsx
│   │   ├── award-badges.tsx
│   │   ├── directory-pagination.tsx
│   │   ├── directory-empty-state.tsx                          # 条件あり・なし・範囲外
│   │   ├── directory-list-skeleton.tsx
│   │   ├── launch-cta.tsx
│   │   └── use-directory-navigation.ts                        # 条件の変更・ページの移動・フォーカス
│   ├── components/match/                                      # (移動)match-engineのcomponents/top/から移す汎用の部品(振る舞いは変えない。テストも移す)
│   │   ├── auto-refresh-switch.tsx                            # AutoRefreshSwitch(ページ全体の自動更新の切り替え)
│   │   ├── auto-refresh-messages.ts                           # AUTO_REFRESH_LABEL・AUTO_REFRESH_DESCRIPTION(top-page-messages.tsから移す)
│   │   ├── full-time-countdown.tsx                            # FullTimeCountdown(終了までの残り時間)
│   │   ├── full-time-countdown-text.ts                        # 残り時間の数字と読み上げの文言
│   │   └── follow-up-refetch.ts                               # FOLLOW_UP_REFETCH_LIMIT・QueryUpdateCounts・updateCountOf(qualifier-refresh.tsから移す)
│   ├── components/product-page/
│   │   ├── product-page-section-types.ts                      # 登録の型と文脈(テストなし)
│   │   ├── product-page-section-order.ts                      # 置き場所ごとの並べ替え(*.unit.test.ts)
│   │   ├── product-page.tsx                                   # 2カラムの枠と区画の描画・自動更新の切り替えの状態とdata-auto-refresh・境界の取り直し
│   │   ├── live-match-refresh.ts                              # 開催中のマッチの定期の取り直しと結果を待つ取り直しの判定(*.unit.test.ts)
│   │   ├── product-breadcrumbs.tsx
│   │   ├── unlisted-banner.tsx
│   │   ├── product-header.tsx
│   │   ├── owner-follow.tsx                                   # フォロー中かの照会とFollowButton
│   │   ├── copy-link-button.tsx
│   │   ├── live-match-section.tsx
│   │   ├── screenshot-gallery.tsx
│   │   ├── screenshot-lightbox.tsx
│   │   ├── product-description.tsx
│   │   ├── match-history-section.tsx
│   │   ├── launch-block.tsx
│   │   ├── match-history-row.tsx
│   │   ├── supporters-panel.tsx
│   │   ├── empty-matches.tsx
│   │   ├── owner-card.tsx                                     # frontend-libのCardで描く
│   │   └── product-page-skeleton.tsx
│   ├── graphql/product-page.ts                                # productPage・productLiveMatchの取得の設定・loaderの補助・開催中のマッチの差し替え(*.unit.test.ts)
│   └── graphql/operations/directory/                          # 1ファイル1操作(操作名はClientで始める。生成物はsrc/graphql/generated/)
│       ├── directory.graphql                                  # query ClientDirectory(directory)
│       ├── directory-categories.graphql                       # query ClientDirectoryCategories(directoryCategories)
│       ├── product-page.graphql                               # query ClientProductPage(productPage)
│       ├── product-live-match.graphql                         # query ClientProductLiveMatch(productLiveMatch、定期の取り直しの対象)
│       ├── match-supporters.graphql                           # query ClientMatchSupporters(matchSupporters)
│       ├── owner-follow-status.graphql                        # query ClientOwnerFollowStatus(publicProfileのviewerRelation)
│       └── product-owner-status.graphql                       # query ClientProductOwnerStatus(productOwnerStatus、投稿者本人向けの操作)
├── frontend-lib/components/ui/card/                           # shadcn/uiのCard(1ファイル1コンポーネント、005の分割の規則)
│   ├── card.tsx・card-header.tsx・card-title.tsx・card-description.tsx・card-action.tsx・card-content.tsx・card-footer.tsx
│   ├── card.stories.tsx                                       # カタログ(部分の組み合わせ・ライト・ダーク)
│   └── card.browser.test.tsx                                  # 要素と属性の受け渡し・runAxe
e2e/
├── client/directory.e2e.test.ts                               # 一覧・検索・絞り込み・並べ替え・ページ・詳細・302
└── support/directory-fixtures.ts                              # ローカルD1に確定した予選と掲載中のプロダクトを作る補助
docs/GUIDES/tech/
├── db/007-latest-row-per-group-listing.md
└── frontend/014-url-state-listing.md
```

テストは各ファイルの隣に置く(`*.unit.test.ts`・`*.worker.test.ts`・`*.browser.test.tsx`)。技術ドキュメントの番号は、全ての完了済みspecのdesign.mdが使う番号の後の、各ディレクトリで最も小さい空き番号`db/007`・`frontend/014`に固定する(並行して作成中のnotificationsと重なれば、コントローラーの調整に従う)。

### Modified Files

- `apps/db/schema/index.ts`・`apps/db/migrations/<日時>_directory_discovery/migration.sql`・`apps/db/migrations/<日時>_directory_discovery_fts/migration.sql` — 2テーブルの再エクスポート、生成したマイグレーション、`print-search-index-sql.ts product_search_documents`の出力を貼ったカスタムマイグレーション。mainの最新を取り込んでから生成する。
- `apps/db/search/search-indexes.ts`・`apps/backend-lib/workers/search/targets/index.ts` — 索引の定義と検索対象。
- `apps/api/src/composition/modules.ts`・`graphql-modules.ts`・`user-lifecycle-sync-handlers.ts`・`product-lifecycle-sync-handlers.ts`・`product-save-hooks.ts` — `DIRECTORY_PLATFORM_MODULE`・`DIRECTORY_MODULE`・`directorySchemaModule`・2つの同期の処理・保存の登録。登録口の中身を完全一致で比べる既存のテスト`product-lifecycle-sync-handlers.worker.test.ts`・`product-save-hooks.worker.test.ts`の期待値に本specの登録を加える。
- `apps/client/src/components/top/top-page.tsx`・`top-page-messages.ts`・`full-time-countdown-section.tsx`・`qualifier-refresh.ts`・`qualifier-board-section.tsx`と各テスト — `components/match/`へ移した部品の読み込みの書き換え(振る舞いは変えない)。
- `docs/GUIDES/tech/frontend/013-live-scoreboard.md` — 部品の表の「自動更新の切り替え」の置き場所に、複数のページが使う場合は`components/<ドメイン>/`に置く旨を加える。
- `docs/GUIDES/tech/frontend/005-shared-components.md` — 部品の一覧の`components/ui/`に`Card`(`CardHeader`・`CardTitle`・`CardDescription`・`CardAction`・`CardContent`・`CardFooter`)を加える。
- `apps/event/src/composition/modules.ts`・`match-event-handlers.ts`・`product-lifecycle-async-handlers.ts`・`user-lifecycle-async-handlers.ts` — `DIRECTORY_PLATFORM_MODULE`・eventの束縛・4つの処理。
- `docs/GUIDES/tech/db/README.md`・`frontend/README.md` — 文書一覧の行。
- `docs/onboardings/project-values.md` — 処理の名前と`order`、検索対象の名前と重み、区画の登録口の`order`。
- `docs/GUIDES/service/design/002-page-layouts.md` — ディレクトリの区画(仮3)・詳細ページの区画の構成・サポーターの数(仮5)・仮1・仮2の注記。
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — 本specのエラー・状態・トーストの文言。
- `CLAUDE.md` — 「技術規則の参照先」に「グループごとの最新の行で並べる一覧を作る前に: `db/007`」。

## System Flows

### 一覧の問い合わせ

```mermaid
sequenceDiagram
    participant C as client directory route
    participant R as DirectoryReader
    participant L as DirectoryListingQuery
    participant P as ProductDirectory
    participant M as MatchDirectory
    participant S as launch highlights and item metrics
    C->>R: directory input
    R->>R: normalizeDirectoryQuery and category handle
    R->>L: page and count in one batch
    L-->>R: product ids with base win
    R->>P: findSummaries visible
    R->>M: listByLaunches base win launches
    R->>P: listLaunches for awards
    R->>S: awards and metrics
    R-->>C: DirectoryPage
```

- 問い合わせの形(`d1-directory-listing.ts`):

```sql
WITH wins AS (
  SELECT w.product_id, w.launch_id, w.match_date, w.upvote_count,
         ROW_NUMBER() OVER (PARTITION BY w.product_id ORDER BY w.match_date DESC) AS rn
  FROM (<qualifierWins()>) AS w
  WHERE (?1 IS NULL OR w.match_date >= ?1) AND (?2 IS NULL OR w.match_date <= ?2)
)
SELECT products.id, wins.launch_id, wins.match_date, wins.upvote_count [, f.rank]
FROM products
JOIN users ON users.id = products.user_id
JOIN wins ON wins.product_id = products.id AND wins.rn = 1
[JOIN (<ftsRankedSources(PRODUCT_SEARCH_INDEX, ?)>) AS f ON f.source_id = products.id]
WHERE <visibleProducts()> AND <wonLaunchExists()> [AND <productInCategory(?)>]
ORDER BY <並び順> LIMIT 20 OFFSET ?
```

- `<qualifierWins()>`は別名付きの副問い合わせで、`const wins = qualifierWins()`と受けて`wins.productId`・`wins.launchId`・`wins.matchDate`・`wins.upvoteCount`で参照する(`qualifierWins.productId`のような書き方は動かない)。
- 件数は同じ`WITH`と条件の`COUNT(*)`の文で、ページの文と1つの`db.batch()`で読む(6.1)。並び順は`newest`が`match_date DESC, products.id DESC`、`oldest`が`match_date ASC, products.id ASC`、`upvotes`が`upvote_count DESC, match_date DESC, products.id DESC`、`relevance`が`rank ASC, match_date DESC, products.id DESC`(5.2・5.4・5.5)。
- 期間の条件を窓関数の前に掛けるため、期間内に勝利の無いプロダクトは`rn = 1`の行を持たず除かれ、期間内の最新が基準勝利になる(3.6、仮2)。
- 基準勝利の種類は`MatchDirectory.listByLaunches`の予選のマッチの側の`result`と`endedEarly`から`classifyBaseWin`で決める(2.7〜2.9)。

### プロダクト詳細ページの解決

```mermaid
flowchart TB
    Start[path handle] --> Format{形式に合う}
    Format -- no --> NotFound[404]
    Format -- yes --> Resolve[ProductDirectory resolveHandle]
    Resolve -- none --> NotFound
    Resolve -- current or previous --> Visible{visible}
    Visible -- no --> NotFound
    Visible -- yes --> Listed{掲載中または投稿者本人}
    Listed -- no --> NotFound
    Listed -- yes --> Kind{previous}
    Kind -- yes --> Redirect[302 to current handle with query]
    Kind -- no --> Render[render product page]
```

- `decideProductPageAccess({ resolution, viewerUserId })`が`render`(`ownerView`・`unlisted`)・`redirect`(現在のハンドル)・`not-found`を返す(8.2〜8.7)。`visible`はproduct-launchの`visibleProducts()`(非公開化・論理削除・投稿者の退会や停止を除く)と同じ判定である。

### 開催中のマッチの取り直し

詳細ページの開催中のマッチは、トップページと同じ対戦カード・演出・残り時間を、[集計値と残り時間を表示し続ける画面](../../../docs/GUIDES/tech/frontend/013-live-scoreboard.md)と[表示中の画面の定期再取得](../../../docs/GUIDES/tech/frontend/010-live-refresh-queries.md)の規則で表示し続ける(9.6・9.9、2026-11-10に開発者が決定)。定期の取り直しは詳細ページの取得(`productPage`)へ広げず、開催中のマッチだけを返す小さな取得(`productLiveMatch`)に重ねる(010の「使う場面」)。

```mermaid
sequenceDiagram
    participant R as product page route
    participant P as ProductPage
    participant L as LiveMatchSection
    participant A as api productLiveMatch
    R->>A: productPage and productLiveMatch in parallel
    P->>P: autoRefresh state and data-auto-refresh
    P->>P: useBoundaryRefresh at endsAt and next kickoff
    L->>A: refetchInterval while live or awaiting
    A-->>L: serverTime match awaitingChange
    L->>L: useUpvote then setQueryData of match
    L->>P: invalidate productPage when match becomes finished
```

- 定期の取り直し: 自動更新の切り替えがオンで、マッチが`LIVE`か変化を待つ状態(`awaitingChange`)の間は`LIVE_REFRESH_QUERY_OPTIONS.refetchInterval`ごと。オフの間は、変化を待つ状態のときだけ`FOLLOW_UP_REFETCH_LIMIT`回まで(013の「結果を待つ取り直し」)。上限に達してもオフで変化を待つ状態なら、区画の見出しの下の`role="status"`の文をページを開き直す案内に切り替える。
- 境界の取り直し: ページ(区画のエラーの境界の外)が`useBoundaryRefresh`で、開催中のマッチの`endsAt`と、予約済みのローンチの最も近い`kickoffAt`の直後に、`productLiveMatch`と`productPage`の取得を無効にする。境界の取り直しは自動更新の切り替えで止めない。
- 変化を待つ状態(`awaitingChange`、サーバーが判定): 集計中(`TALLYING`)のマッチがある、またはキックオフの時刻を過ぎたローンチの予選マッチがまだ作られていない・開始の時刻を過ぎて開始していない。
- 確定の反映: `productLiveMatch`の結果でマッチが`FINISHED`になった、または開催中のマッチが無くなったら、`productPage`の取得を無効にしてマッチ履歴を取り直す。
- Upvoteの結果は`useUpvote`の`onUpdated`で`productLiveMatch`の取得の`match`だけを`setQueryData`で差し替える(013の「操作の結果の反映」)。

### 索引の更新

```mermaid
sequenceDiagram
    participant E as event source
    participant H as directory handler
    participant W as pending marker or save batch
    participant D as D1
    participant Q as Queue
    participant X as SearchIndexRefreshHandler
    participant T as PRODUCT_SEARCH_TARGET
    E->>H: decided or unhidden or unsuspended or save
    H->>D: upsert directory entry
    H->>W: mark pending
    W->>D: markPending statements in one batch
    H->>Q: requestRefresh product
    Q->>X: search index refresh
    X->>T: read current product
    alt listed
        X->>D: guarded upsert of index document
    else not listed
        X->>D: delete index document
    end
    E->>H: deleted or hidden or withdrawn or suspended
    H-->>E: removal statements in the same batch
```

| 契機                           | 処理                                        | 種類                                   | 内容                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 予選の勝利の確定               | `directory-discovery.qualifier-listing`     | マッチイベント`decided`・予選、1200    | `findMatches([matchId], now)`で勝った側(`isWinningResult`、紐付けあり)の`directory_entries`を作り(`onConflictDoNothing`)、`markPending`の後に`requestRefresh`(1.5・12.2) |
| 編集(登録・編集・説明文の更新) | `directory-discovery.product-index-refresh` | `PRODUCT_SAVE_HOOKS`(仮4)              | `directory_entries`があれば`markPending`を保存の一括の書き込みに入れ、確定の後に`requestRefresh`(12.3)                                                                   |
| 論理削除・非公開化             | `directory-discovery.product-index-removal` | プロダクトの同期`deleted`・`hidden`    | `deleteSources('product', [productId])`(12.4・12.5)                                                                                                                      |
| 退会・停止                     | `directory-discovery.account-index-removal` | ユーザーの同期`withdrawn`・`suspended` | `DELETE FROM product_search_documents WHERE source_id IN (SELECT product_id FROM directory_entries WHERE owner_user_id = ?)`(12.4・12.5)                                 |
| 復元                           | `directory-discovery.product-index-restore` | プロダクトの非同期`unhidden`、1200     | `directory_entries`があれば`markPending`と`requestRefresh`。`done`(12.6)                                                                                                 |
| 停止の解除                     | `directory-discovery.account-index-restore` | ユーザーの非同期`unsuspended`、1200    | 投稿者の`directory_entries`を1回の実行で全件、100件ずつ`markPending`と`requestRefresh`。`done`(12.6)                                                                     |
| 物理削除                       | `directory-discovery.entry-erasure`         | プロダクトの非同期`purge_due`、1200    | 索引文書と`directory_entries`の行を1つの一括の書き込みで削除。`done`(12.7)                                                                                               |

- 索引の作成と更新は常にcontent-processingの処理が、`PRODUCT_SEARCH_TARGET.read`で処理の時点のプロダクトを読み、掲載中でなければ索引を消す(12.1・12.9)。削除は確定と同じ一括の書き込みで行う(12.4・12.5)。`requestRefresh`の送信の失敗は例外にならず、`pending`の索引文書は1時間後以降の日次の再抽出が再処理する(12.8)。
- 更新待ちの印の書き込みは、eventの処理(application層)では`ProductIndexPendingMarker.mark`(実装`D1ProductIndexPendingMarker`がinfrastructure層で`SearchIndexStatements.markPending`の文を組み立てて1回の`db.batch()`で実行する)を通し、保存の登録(api、infrastructure層)ではproduct-launchの`D1ProductStore`の一括の書き込みに文を加える。application層は文と一括の書き込みを扱わない(backend-platformの層の規則)。
- `directory-discovery.entry-erasure`はproduct-launchの最後の物理削除より前に動くため、`directory_entries.product_id`の外部キーで物理削除を止めない(12.7)。

## Requirements Traceability

| Requirement                                 | Summary                    | Components                                                                                                                 | Interfaces                                                                                                 | Flows                      |
| ------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8           | 掲載の条件                 | DirectoryListingQuery、ProductPageAccess                                                                                   | `qualifierWins()`・`visibleProducts()`・`wonLaunchExists()`                                                | 一覧の問い合わせ           |
| 1.5                                         | 確定から数分以内の掲載     | DirectoryListingQuery、QualifierListingHandler                                                                             | `MATCH_EVENT_HANDLERS`                                                                                     | 索引の更新                 |
| 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.13          | 項目の表示と操作           | DirectoryItem、DirectoryViews、DirectoryReader                                                                             | `DirectoryItem`                                                                                            | —                          |
| 2.7, 2.8, 2.9, 2.10                         | 勝利した予選マッチ         | BaseWin、WinSummary、DirectoryReader                                                                                       | `classifyBaseWin`                                                                                          | 一覧の問い合わせ           |
| 2.11                                        | 受賞バッジ                 | LaunchHighlightsReader、AwardBadges                                                                                        | `LAUNCH_SUMMARY_SOURCES`                                                                                   | —                          |
| 2.12                                        | 項目の値の登録口           | ItemMetricSources、ItemMetricsReader、DirectorySections                                                                    | `DIRECTORY_ITEM_METRIC_SOURCES`・`DIRECTORY_ITEM_METRICS`                                                  | —                          |
| 3.1, 3.2                                    | カテゴリ                   | CategoryPicker、DirectoryCategoryReader、DirectoryListingQuery                                                             | `directoryCategories`・`productInCategory()`                                                               | —                          |
| 3.3, 3.4, 3.5                               | 期間                       | DirectoryPeriod、PeriodFilter、PeriodRangeForm                                                                             | `presetRange`・`periodKeyOf`                                                                               | —                          |
| 3.6                                         | 期間の基準                 | DirectoryListingQuery                                                                                                      | 窓関数                                                                                                     | 一覧の問い合わせ           |
| 3.7, 3.8                                    | 正規化と1ページ目          | DirectoryQueryRules、UseDirectoryNavigation                                                                                | `normalizeDirectoryQuery`・`withConditions`                                                                | —                          |
| 3.9, 3.10                                   | 横並びとシート             | FilterToolbar、FilterSheet                                                                                                 | —                                                                                                          | —                          |
| 4.1, 4.2, 4.7, 4.8                          | 検索の対象と照合           | DirectoryReader、DirectoryListingQuery、ProductSearchSchema、ProductSearchTarget                                           | `buildFtsMatchExpression`・`ftsRankedSources`                                                              | 一覧の問い合わせ           |
| 4.3, 4.4, 4.5                               | 検索欄                     | SearchForm                                                                                                                 | `countGraphemes`                                                                                           | —                          |
| 4.6                                         | 強調表示                   | DirectoryItem                                                                                                              | `HighlightedText`                                                                                          | —                          |
| 5.1, 5.2, 5.3, 5.4, 5.5, 5.6                | 並べ替え                   | SortSelect、DirectoryQueryRules、DirectoryListingQuery                                                                     | `DIRECTORY_SORTS`                                                                                          | 一覧の問い合わせ           |
| 6.1, 6.2, 6.3, 6.4, 6.5, 6.6                | ページ分け                 | DirectoryListingQuery、ResultCount、DirectoryPagination、UseDirectoryNavigation、DirectoryEmptyState                       | `DIRECTORY_PAGE_SIZE`                                                                                      | —                          |
| 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9 | 画面の構成と状態           | DirectoryRoute、DirectoryPage、DirectoryListSkeleton、DirectoryEmptyState、LaunchCta                                       | `queryClient.query`・`keepPreviousData`                                                                    | —                          |
| 7.10                                        | ディレクトリの区画         | DirectorySections、DirectoryPage                                                                                           | `DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`                                                        | —                          |
| 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7           | 公開範囲・302・404         | ProductPageAccess、ProductPageReader、ProductPageRoute                                                                     | `productPage`・`ProductPageRedirect`                                                                       | プロダクト詳細ページの解決 |
| 8.8, 8.9, 8.10                              | 描画とエラーと検索エンジン | ProductPageRoute                                                                                                           | `buildSitePageHead`                                                                                        | —                          |
| 9.1, 9.2, 9.3, 9.10, 9.11                   | 構成と区画                 | ProductPage、ProductPageSections、UnlistedBanner、ProductBreadcrumbs                                                       | `PRODUCT_PAGE_SECTIONS`・`RecoverableSlot`                                                                 | —                          |
| 9.9                                         | 演出を開催中に限る         | ProductPage、LiveMatchSection、AutoRefreshSwitch                                                                           | `data-auto-refresh`・`stadium.css`                                                                         | 開催中のマッチの取り直し   |
| 9.4, 9.5, 9.12                              | ヘッダーと成績             | ProductHeader、OwnerFollow、CopyLinkButton、MatchHistory                                                                   | `ProductPageRecord`                                                                                        | —                          |
| 9.6                                         | 開催中のマッチ             | LiveMatchSection、LiveMatchReader、LiveMatchResolvers、ProductPage、LiveMatchRefresh、AutoRefreshSwitch、FullTimeCountdown | `productLiveMatch`・`loadMatchView`・`MatchCard`・`useUpvote`・`UpvoteBotProtection`・`useBoundaryRefresh` | 開催中のマッチの取り直し   |
| 9.7                                         | スクリーンショット         | ScreenshotGallery、ScreenshotLightbox                                                                                      | —                                                                                                          | —                          |
| 9.8                                         | 説明文                     | ProductDescription                                                                                                         | `CollapsibleMarkdownContent`                                                                               | —                          |
| 10.1                                        | ローンチのブロックと要約   | LaunchBlock、LaunchHighlightsReader                                                                                        | `LAUNCH_SUMMARY_SOURCES`                                                                                   | —                          |
| 10.2, 10.3, 10.4, 10.5, 10.6, 10.7          | マッチ履歴                 | MatchHistory、MatchHistoryRow、ProductPageReader                                                                           | `toHistoryRows`                                                                                            | —                          |
| 10.8, 10.9, 10.10, 10.11                    | サポーター                 | MatchHistoryRow、SupportersPanel、SupporterListReader                                                                      | `matchSupporters`・`SupporterDirectory`                                                                    | —                          |
| 10.12, 10.13                                | マッチが無いブロック       | EmptyMatches                                                                                                               | —                                                                                                          | —                          |
| 10.14                                       | ローンチの区画             | LaunchBlock、ProductPageSections                                                                                           | `PRODUCT_LAUNCH_SECTIONS`                                                                                  | —                          |
| 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7    | 投稿者本人向けの操作       | OwnerCard、ProductPageSections、Card                                                                                       | `productOwnerStatus`・`PRODUCT_OWNER_ACTIONS`                                                              | —                          |
| 12.1, 12.9                                  | 索引の対象と冪等           | ProductSearchTarget、ProductSearchSchema                                                                                   | `PRODUCT_SEARCH_TARGET`                                                                                    | 索引の更新                 |
| 12.2                                        | 勝利で索引                 | QualifierListingHandler、DirectoryEntryStore、ProductIndexPendingMarker                                                    | `MATCH_EVENT_HANDLERS`                                                                                     | 索引の更新                 |
| 12.3                                        | 編集で索引                 | ProductIndexRefreshSaveHook                                                                                                | `PRODUCT_SAVE_HOOKS`                                                                                       | 索引の更新                 |
| 12.4, 12.5                                  | 削除・非公開化・退会・停止 | ProductIndexRemovalSyncHandler、AccountIndexRemovalSyncHandler、ProductIndexRemovalStatements                              | `PRODUCT_LIFECYCLE_SYNC_HANDLERS`・`USER_LIFECYCLE_SYNC_HANDLERS`                                          | 索引の更新                 |
| 12.6                                        | 復元・停止の解除           | ProductIndexRestoreHandler、AccountIndexRestoreHandler、ProductIndexPendingMarker                                          | 非同期の登録口                                                                                             | 索引の更新                 |
| 12.7                                        | 物理削除                   | EntryErasureHandler                                                                                                        | `PRODUCT_LIFECYCLE_ASYNC_HANDLERS`                                                                         | 索引の更新                 |
| 12.8, 12.10                                 | 非同期・回復・個人情報     | 各処理、ProductSearchTarget                                                                                                | `requestRefresh`                                                                                           | 索引の更新                 |
| 13.1, 13.2                                  | 帯の値と順                 | QualifierListingHandler、各処理                                                                                            | `order` 1200                                                                                               | 索引の更新                 |
| 13.3                                        | ログ                       | 全コンポーネント                                                                                                           | `getAppLogger`                                                                                             | —                          |
| 13.4                                        | まとめた照会               | DirectoryReader、ProductPageReader                                                                                         | `findSummaries`・`listByLaunches`・`userSummaryLoader`                                                     | 一覧の問い合わせ           |
| 13.5                                        | 公開APIの部品              | DirectoryListingQuery、DirectoryPlatformModule                                                                             | `DirectoryListingQuery.page`                                                                               | —                          |
| 14.1, 14.2, 14.3                            | テスト                     | Testing Strategy                                                                                                           | —                                                                                                          | —                          |
| 14.4                                        | 技術ドキュメント           | DirectoryTechDocs                                                                                                          | —                                                                                                          | —                          |
| 14.5                                        | サービス仕様               | DirectoryServiceSpecs                                                                                                      | —                                                                                                          | —                          |

## Components and Interfaces

| Component                                                                                                                                                                                                                                                                                                                                           | Domain/Layer                  | Intent                                         | Req Coverage                                           | Key Dependencies                                                                                     | Contracts |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | --------- |
| DirectoryQueryRules・DirectoryPeriod                                                                                                                                                                                                                                                                                                                | common-lib                    | クエリの規則と期間                             | 3.3〜3.5, 3.7, 3.8, 4.3, 5.1, 5.3, 6.2                 | —                                                                                                    | Service   |
| ProductSearchSchema(ProductSearchDocuments・ProductSearchIndex)・DirectoryEntriesSchema                                                                                                                                                                                                                                                             | db                            | 索引文書・索引・勝利したプロダクト             | 4.1, 12.1, 12.7                                        | content-processing (P0)、product-launch (P0)                                                         | State     |
| ProductSearchTarget                                                                                                                                                                                                                                                                                                                                 | backend-lib/search            | 検索対象                                       | 4.1, 12.1, 12.9, 12.10                                 | ProductDirectory (P0)                                                                                | Service   |
| DirectoryListingQuery・DirectoryEntryStore(契約)・DirectoryPlatformTypes                                                                                                                                                                                                                                                                            | backend-lib/core/directory    | 一覧の照会・記録の契約と識別子                 | 1.1〜1.4, 1.6〜1.8, 3.6, 5.2〜5.5, 6.1, 13.5           | —                                                                                                    | Service   |
| D1DirectoryListingQuery・D1DirectoryEntryStore・ProductIndexRemovalStatements・DirectoryPlatformModule                                                                                                                                                                                                                                              | backend-lib/workers/directory | 一覧の照会・記録のD1の実装・削除の文           | 1.1〜1.4, 1.6〜1.8, 3.6, 4.1, 4.2, 5.2〜5.5, 6.1, 13.5 | match-engine (P0)、product-launch (P0)、D1 (P0)                                                      | Service   |
| ProductPageAccess・BaseWin・MatchHistory                                                                                                                                                                                                                                                                                                            | api/domain                    | 公開範囲・基準勝利・マッチ履歴                 | 2.7〜2.10, 8.2〜8.7, 9.5, 10.2〜10.7                   | —                                                                                                    | Service   |
| DirectoryReader・DirectoryCategoryReader・ProductPageReader・LiveMatchReader・SupporterListReader・LaunchHighlightsReader・ItemMetricsReader・ItemMetricSources                                                                                                                                                                                     | api/application               | 読み取りのユースケースと供給元の呼び出し       | 2.\*, 3.1, 3.2, 4.7, 8.\*, 9.4〜9.6, 10.\*, 13.4       | ProductDirectory (P0)、MatchDirectory (P0)                                                           | Service   |
| AccountIndexRemovalSyncHandler・ProductIndexRemovalSyncHandler・ProductIndexRefreshSaveHook                                                                                                                                                                                                                                                         | api/infrastructure            | 同期の削除と編集の更新待ち                     | 12.3, 12.4, 12.5                                       | identity-auth (P0)、product-launch (P0)                                                              | Event     |
| DirectorySchemaModule(DirectoryViews・DirectoryResolvers・ProductPageResolvers・LiveMatchResolvers・SupporterResolvers)                                                                                                                                                                                                                             | api/presentation              | GraphQLの型と操作                              | 2.\*, 3.\*, 4.\*, 5.\*, 6.\*, 8.\*, 9.6, 10.\*         | api-gateway (P0)                                                                                     | API       |
| QualifierListingHandler・ProductIndexRestoreHandler・EntryErasureHandler・AccountIndexRestoreHandler                                                                                                                                                                                                                                                | event/application             | 掲載・作り直し・物理削除                       | 1.5, 12.2, 12.6, 12.7, 13.1, 13.2                      | DirectoryEntryStore (P0)、ProductIndexPendingMarker (P0)、SearchIndexRefreshRequester (P0)           | Event     |
| D1ProductIndexPendingMarker                                                                                                                                                                                                                                                                                                                         | event/infrastructure          | 更新待ちの印の一括の書き込み                   | 12.2, 12.6                                             | SearchIndexStatements (P0)、D1 (P0)                                                                  | Service   |
| DirectoryRoute・DirectoryPage・SearchForm・FilterToolbar・FilterSheet・CategoryPicker・PeriodFilter・PeriodRangeForm・SortSelect・ResultCount・DirectoryItem・WinSummary・AwardBadges・DirectoryPagination・DirectoryEmptyState・DirectoryListSkeleton・LaunchCta・UseDirectoryNavigation・DirectorySections                                        | client                        | ディレクトリの画面と区画                       | 2.\*, 3.\*, 4.3〜4.6, 5.1, 5.3, 6.3〜6.6, 7.\*         | directory (P0)                                                                                       | State     |
| ProductPageRoute・ProductPage・ProductBreadcrumbs・UnlistedBanner・ProductHeader・OwnerFollow・CopyLinkButton・LiveMatchSection・LiveMatchRefresh・ScreenshotGallery・ScreenshotLightbox・ProductDescription・MatchHistorySection・LaunchBlock・MatchHistoryRow・SupportersPanel・EmptyMatches・OwnerCard・ProductPageSkeleton・ProductPageSections | client                        | 詳細ページと区画                               | 8.\*, 9.\*, 10.\*, 11.\*                               | productPage (P0)、productLiveMatch (P0)、MatchCard (P0)、UpvoteBotProtection (P0)、FollowButton (P1) | State     |
| AutoRefreshSwitch・FullTimeCountdown・FollowUpRefetch(移動)                                                                                                                                                                                                                                                                                         | client/components/match       | ページ全体の自動更新・残り時間・取り直しの上限 | 9.6, 9.9                                               | match-engineのトップページ (P0)                                                                      | State     |
| Card(CardHeader・CardTitle・CardDescription・CardAction・CardContent・CardFooter)                                                                                                                                                                                                                                                                   | frontend-lib/components/ui    | 枠の基本部品                                   | 11.1                                                   | デザイントークン (P0)                                                                                | State     |
| DirectoryTechDocs・DirectoryServiceSpecs                                                                                                                                                                                                                                                                                                            | docs                          | 技術ドキュメントとサービス仕様                 | 14.4, 14.5                                             | —                                                                                                    | —         |

### common-lib

#### DirectoryQueryRules・DirectoryPeriod

**Contracts**: Service [x]

```typescript
// directory-query-rules.ts
export declare const DIRECTORY_PAGE_SIZE: 20;
export declare const DIRECTORY_SEARCH_MAX_GRAPHEMES: 50;
export declare const DIRECTORY_SEARCH_COUNTER_FROM: 40;
export declare const DIRECTORY_SORTS: readonly [
  'relevance',
  'newest',
  'oldest',
  'upvotes',
];
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];
export interface DirectoryQuery {
  readonly q?: string; // 前後の空白を除き、空なら無し。50書記素へ切り詰め
  readonly category?: string; // カテゴリのハンドル(存在の確認はapi)
  readonly from?: BusinessDateString; // YYYY-MM-DD
  readonly to?: BusinessDateString;
  readonly sort?: DirectorySort; // 既定(qがあればrelevance、なければnewest)は省く
  readonly page?: number; // 2以上の整数だけ。1は省く
}
export declare function normalizeDirectoryQuery(
  raw: Readonly<Record<string, unknown>>,
): DirectoryQuery; // 3.7
export declare function effectiveSort(query: DirectoryQuery): DirectorySort;
export declare function withConditions(
  query: DirectoryQuery,
  patch: Partial<Omit<DirectoryQuery, 'page'>>,
): DirectoryQuery; // pageを外す(3.8)
export declare function changedConditionCount(query: DirectoryQuery): number; // カテゴリ・期間・並び順(3.10)

// directory-period.ts
export declare const PERIOD_PRESETS: readonly [
  'yesterday',
  'week',
  'month',
  'year',
  'all',
];
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export declare function presetRange(
  preset: PeriodPreset,
  today: BusinessDateString,
): { readonly from?: BusinessDateString; readonly to?: BusinessDateString }; // 週は月曜日始まり(3.3)
export declare function periodKeyOf(
  range: { readonly from?: string; readonly to?: string },
  today: BusinessDateString,
): PeriodPreset | 'custom'; // 3.4
export declare function validateCustomRange(input: {
  readonly from?: string;
  readonly to?: string;
  readonly today: BusinessDateString;
}): {
  readonly from?: 'future';
  readonly to?: 'future';
  readonly order?: 'reversed';
}; // 3.5
```

- `normalizeDirectoryQuery`は不正な値をエラーにせず落とす(実在しない日付、`from > to`は両方、検索語が無いときの`relevance`、既定と同じ並び順、2未満・整数でない`page`)。`BusinessDateString`は`YYYY-MM-DD`の文字列の型で、`BusinessTime`を読み込まずに判定する(common-libは他の層を読み込まない)。
- 期間の表示の文言(「9月14日〜9月20日」「9月1日以降」「9月20日以前」)は`formatPeriodLabel`として同じファイルに置き、今年は年を省く。

### db

#### ProductSearchSchema・DirectoryEntriesSchema

**Contracts**: State [x]

```typescript
// product-search-documents.ts
export const productSearchDocuments = snakeCase.table(
  'product_search_documents',
  {
    ...searchDocumentColumns(),
    name: searchTextColumn('name'),
    tagline: searchTextColumn('tagline'),
  },
  (table) => [searchDocumentStatusIndex('product_search_documents', table)],
);
// product-search-index.ts
export declare const PRODUCT_SEARCH_INDEX: SearchIndexDefinition; // defineSearchIndex({ documents, textColumns: [name 10, tagline 5], keywordsWeight: 1 })
// directory-entries.ts: directory_entries(idはULID・product_idはproducts.idへの外部キーで一意・owner_user_idは外部キーなしのtext・first_won_atはinteger・timestamps)、owner_user_idの索引
```

- 全文検索の索引とトリガーは`print-search-index-sql.ts product_search_documents`の出力をカスタムマイグレーションに貼り、`search-index-migrations.unit.test.ts`が欠けを検出する(`db/004`)。
- `owner_user_id`は外部キーを持たない(identity-authの物理削除を妨げないため。行はプロダクトの`purge_due`で消える)。

### backend-lib/core・workers

#### ProductSearchTarget

**Contracts**: Service [x]

```typescript
export declare const PRODUCT_SEARCH_TARGET: SearchTargetDefinition<
  'name' | 'tagline' | 'description'
>;
// name 'product'
// fields: name・tagline { format: 'plain', textColumn: true, extract: false }、description { format: 'markdown', textColumn: false, extract: true }
// read(db, id): new D1ProductDirectory(db)のfindSummaries([id], 'visible')がlistedのときだけ、findDetailの説明文と合わせて返す。versionは読み取りの時刻(ミリ秒)
// isIndexable(id): SELECT 1 FROM products JOIN users ON users.id = products.user_id WHERE products.id = ? AND visibleProducts() AND wonLaunchExists()
```

- `isIndexable`は`EXISTS`の中身(`SELECT 1 …`)だけを返す。`EXISTS(…)`で包むのはcontent-processingの`search-index-repository.ts`で、自分で包むと`EXISTS(EXISTS …)`になる。形の先例は`workers/search/testing/fixture-search-target.ts`である。

- 版を読み取りの時刻にするのは、`ProductDirectory`の記録に更新日時が無く、`read`が常に処理の時点の値を返すためである。古い読み取りの書き込みは新しい読み取りの版に負けて捨てられる(content-processingの条件付きの書き込み、12.9)。
- 索引には名称・タグライン・説明文から抽出したキーワードだけを入れる(12.10)。

#### DirectoryListingQuery・DirectoryEntryStore・ProductIndexRemovalStatements

**Contracts**: Service [x]

```typescript
// core/directory/ports.ts(`core`の他の部品とcommon-libの`DirectorySort`だけを読み込む)
export interface DirectoryListingInput {
  readonly matchExpression: string | undefined; // buildFtsMatchExpressionの結果
  readonly categoryId: string | undefined;
  readonly from: BusinessDate | undefined;
  readonly to: BusinessDate | undefined;
  readonly sort: DirectorySort; // matchExpressionが無いときrelevanceは渡さない
  readonly page: number; // 1以上
}
export interface DirectoryListingRow {
  readonly productId: string;
  readonly baseWin: {
    readonly launchId: string;
    readonly matchDate: BusinessDate;
    readonly upvoteCount: number;
  };
}
export interface DirectoryListingQuery {
  page(input: DirectoryListingInput): Promise<{
    readonly totalCount: number;
    readonly rows: readonly DirectoryListingRow[];
  }>; // 1回のdb.batch
  countByCategory(): Promise<ReadonlyMap<string, number>>; // カテゴリID → 掲載中の数
}
export interface DirectoryEntryStore {
  record(
    entries: readonly {
      readonly productId: string;
      readonly ownerUserId: string;
    }[],
    at: Date,
  ): Promise<void>; // onConflictDoNothing
  exists(productId: string): Promise<boolean>;
  listProductIdsByOwner(
    ownerUserId: string,
    after: string | undefined,
    limit: number,
  ): Promise<readonly string[]>; // product_idの昇順
  erase(productId: string): Promise<void>; // 索引文書と記録を1つのdb.batchで削除(D1の実装の中で行う)
}

// core/directory/identifiers.ts
export declare const DIRECTORY_PLATFORM_TYPES: {
  readonly DirectoryListingQuery: unique symbol;
  readonly DirectoryEntryStore: unique symbol;
}; // Symbol.for('directory.<名前>')、Object.freeze

// workers/directory/product-index-removal-statements.ts(DBの型を使うためworkersに置き、infrastructure層だけが使う)
export declare function accountIndexRemovalStatement(
  db: Database,
  ownerUserId: string,
): BatchItem<'sqlite'>;
```

- 置き場所: api・eventのapplication層とpublic-apiのapplication層から読み込めるよう、契約(`DirectoryListingInput`・`DirectoryListingRow`・`DirectoryListingQuery`・`DirectoryEntryStore`)は`apps/backend-lib/core/directory/ports.ts`、識別子は`core/directory/identifiers.ts`に置き、D1の実装(`workers/directory/d1-directory-listing.ts`・`d1-directory-entry-store.ts`)と束縛だけを`apps/backend-lib/workers/directory`に置く(application層は`**/lib/workers/**`を型も含めて読み込めない)。`core/directory`は`workers`と`apps/db`を読み込まない。
- `DIRECTORY_PLATFORM_MODULE`(`workers/directory/directory-platform-module.ts`)は`DirectoryListingQuery`・`DirectoryEntryStore`のD1の実装を処理単位で束縛し、apiとeventの`composition/modules.ts`の両方へ入れる。DIの識別子は`DIRECTORY_PLATFORM_TYPES`(`Symbol.for('directory.<名前>')`の値を持つ凍結したオブジェクト。`core/media/identifiers.ts`と同じ形で、`identifiers.unit.test.ts`で確かめる)。public-apiは`DirectoryListingQuery`を使う(13.5)。
- 問い合わせの形は「System Flows」の一覧の問い合わせに示す。`countByCategory`は`visibleProducts() AND wonLaunchExists()`のプロダクトを`products.category_id`で数える(3.1。product-launchの仮11で、これらの条件で絞った`products.id`・`products.category_id`の集計が許されている)。

### api/domain

#### ProductPageAccess・BaseWin・MatchHistory

**Contracts**: Service [x]

```typescript
// product-page-access.ts
export type ProductPageAccess =
  | {
      readonly kind: 'render';
      readonly productId: string;
      readonly ownerView: boolean;
      readonly unlisted: boolean;
    }
  | { readonly kind: 'redirect'; readonly handle: string }
  | { readonly kind: 'not-found' };
export declare function decideProductPageAccess(input: {
  readonly resolution: ProductHandleResolution;
  readonly viewerUserId: string | undefined;
}): ProductPageAccess;

// base-win.ts
export type BaseWinKind = 'victory' | 'bye' | 'early';
export declare function classifyBaseWin(
  match: MatchRecord | undefined,
  launchId: string,
): BaseWinKind; // won→victory、bye・開始時点のwalkover→bye、endedEarlyのwalkover→early

// match-history.ts
export type OpponentView =
  | { readonly kind: 'none' } // 対戦相手なし
  | { readonly kind: 'private' }
  | { readonly kind: 'unlisted' | 'listed'; readonly productId: string };
export interface HistoryRow {
  readonly matchId: string;
  readonly entryId: string;
  readonly kind: MatchKind;
  readonly round: number | null;
  readonly stage: MatchStage | null;
  readonly matchDate: BusinessDate;
  readonly result: EntryResult;
  readonly decision: MatchDecision;
  readonly endedEarly: boolean;
  readonly ownUpvoteCount: number;
  readonly opponentUpvoteCount: number | null; // 不戦勝・早期の不戦勝はnull
  readonly opponent: OpponentView;
}
export declare function toHistoryRows(input: {
  readonly productId: string;
  readonly matches: readonly MatchRecord[];
  readonly opponents: ReadonlyMap<string, ProductSummaryRecord>; // not-deletedで引いたもの
}): readonly HistoryRow[]; // finishedだけ、実施日の新しい順
export declare function summarizeRecord(input: {
  readonly rows: readonly HistoryRow[];
  readonly launches: readonly LaunchRecord[];
}): {
  readonly firstLaunchDate: BusinessDate | null;
  readonly launchCount: number;
  readonly wins: number;
  readonly losses: number;
};
```

- `decideProductPageAccess`は「System Flows」の判定の順に従う(8.2〜8.7)。
- `toHistoryRows`の対戦相手: 側が1つ→`none`。開始時点の`walkover`(`endedEarly`でない)で相手の側がある→`private`。相手の`productId`がnull・`opponents`に無い・`visible`が偽→`private`。`listed`→`listed`、それ以外→`unlisted`(10.3・10.5)。早期の`walkover`は相手を`private`、相手の数をnullにする(10.6)。勝ちと負けの数え方は`isWinningResult`(9.5)。
- 予選の結果からの要約と受賞のまとめは、product-launchの`backend-lib/core/product/launch-summary.ts`の`fallbackLaunchSummary`・`groupAwards`を直接読み込んで使い、本specは同じ規則を持たない(ローンチ履歴と文言がずれないため、product-launchの仮11)。

### api/application

#### DirectoryReader・DirectoryCategoryReader・LaunchHighlightsReader・ItemMetricsReader

**Contracts**: Service [x]

```typescript
// item-metric-sources.ts
export interface DirectoryItemMetricSource {
  metrics(input: {
    readonly productIds: readonly string[];
    readonly at: Date;
  }): Promise<ReadonlyMap<string, number>>; // productId → 値
}
export interface DirectoryItemMetricRegistration {
  readonly key: string; // '<名詞>'(例: 'comments')。clientのDIRECTORY_ITEM_METRICSのkeyと一致させる
  readonly name: string; // '<spec名>.<名詞句>'
  readonly order: number;
  readonly source: ServiceIdentifier<DirectoryItemMetricSource>;
}
// composition/directory-item-metric-sources.ts(後続specが追記、初版は空)
export declare const DIRECTORY_ITEM_METRIC_SOURCES: readonly DirectoryItemMetricRegistration[];

// directory-reader.ts
export interface DirectoryItemView {
  readonly product: ProductSummaryRecord;
  readonly isViewerOwn: boolean;
  readonly baseWin: {
    readonly launchDate: BusinessDate;
    readonly kind: BaseWinKind;
    readonly upvoteCount: number | null;
  }; // byeはnull
  readonly awards: ReturnType<typeof groupAwards>;
  readonly metrics: readonly { readonly key: string; readonly value: number }[];
}
export interface DirectoryPageView {
  readonly applied: DirectoryQuery; // サーバーが解決したカテゴリと正規化の後の条件
  readonly searchTerms: readonly string[];
  readonly businessToday: BusinessDate;
  readonly totalCount: number;
  readonly page: number;
  readonly pageCount: number;
  readonly items: readonly DirectoryItemView[];
}
export interface DirectoryReader {
  read(input: {
    readonly raw: Readonly<Record<string, unknown>>;
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<DirectoryPageView>;
}
export interface DirectoryCategoryReader {
  list(): Promise<readonly ProductCategoryRecord[]>; // 掲載数の多い順・同数は名称順・その他を末尾(3.1)
}
export interface LaunchHighlightsReader {
  read(input: {
    readonly launches: readonly LaunchRecord[];
    readonly at: Date;
  }): Promise<{
    readonly summaries: ReadonlyMap<
      string,
      { readonly label: string; readonly inMatch: boolean }
    >;
    readonly awards: ReadonlyMap<string, ReturnType<typeof groupAwards>>; // productId → 受賞
  }>;
}
export interface ItemMetricsReader {
  read(
    productIds: readonly string[],
    at: Date,
  ): Promise<
    ReadonlyMap<
      string,
      readonly { readonly key: string; readonly value: number }[]
    >
  >;
}
```

- `DirectoryReader.read`の手順: (1)`normalizeDirectoryQuery`。(2)カテゴリのハンドルを`ProductCategoryDirectory.findByHandle`で解決し、無ければ外す(3.2)。(3)`normalizeSearchTerms`→`buildFtsMatchExpression`。語が無ければ検索なし(4.7)。(4)`DirectoryListingQuery.page`。`page`が総ページ数を超えれば空の`items`と総件数を返す(6.6)。(5)ページのIDで`ProductDirectory.findSummaries(ids, 'visible')`・`MatchDirectory.listByLaunches(基準勝利のローンチ)`・`ProductDirectory.listLaunches(ids, now)`(ローンチの無いプロダクトはMapに入らないため`get(id) ?? []`で受ける)を並行に1回ずつ呼び(13.4)、`LaunchHighlightsReader`(受賞)・`ItemMetricsReader`を呼ぶ。(6)問い合わせとの間に可視でなくなった行は除く(件数は問い合わせの値のまま)。
- `LaunchHighlightsReader`は`LAUNCH_SUMMARY_SOURCES`を`order`順に1回ずつ呼び、`rank`の大きい要約を採り、供給の無いローンチと供給元の失敗(`warn`のログ)は`fallbackLaunchSummary`で縮退する(product-launchの`backend/013`の表示の縮退、10.1・2.11)。`ItemMetricsReader`も同じく供給元の失敗をその値だけの欠落にする(2.12)。

#### ProductPageReader・SupporterListReader

**Contracts**: Service [x]

```typescript
export interface ProductPageLaunchView extends LaunchRecord {
  readonly summary: { readonly label: string; readonly inMatch: boolean };
  readonly kickedOff: boolean; // statusがin_progress・finished
  readonly latestKickedOff: boolean;
  readonly rows: readonly HistoryRow[];
}
export interface ProductPageView {
  readonly product: ProductSummaryRecord;
  readonly detail: ProductDetailRecord;
  readonly ownerView: boolean;
  readonly unlisted: boolean;
  readonly record: ReturnType<typeof summarizeRecord>;
  readonly awards: ReturnType<typeof groupAwards>;
  readonly launches: readonly ProductPageLaunchView[]; // 取消を除く新しい順
  readonly opponents: ReadonlyMap<string, ProductSummaryRecord>;
}
export type ProductPageResult =
  | { readonly kind: 'page'; readonly view: ProductPageView }
  | { readonly kind: 'redirect'; readonly handle: string }
  | { readonly kind: 'not-found' };
export interface ProductPageReader {
  read(input: {
    readonly handle: string;
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<ProductPageResult>;
}
export interface LiveMatchView {
  readonly serverTime: Date; // 照会の時点の時刻(残り時間の補正に使う)
  readonly matchId: string | null; // 開催中(LIVE・TALLYING)の最も新しいマッチ
  readonly awaitingChange: boolean; // 集計中のマッチがある、またはキックオフ済みのローンチの予選マッチが未作成・開始の時刻を過ぎて未開始
}
export interface LiveMatchReader {
  read(input: {
    readonly productHandle: string;
    readonly viewer: CurrentUser | undefined;
    readonly now: Date;
  }): Promise<LiveMatchView | null>; // 表示できない・旧ハンドルはnull
}
export interface SupporterListReader {
  list(input: {
    readonly productHandle: string;
    readonly matchId: string;
    readonly entryId: string;
    readonly viewer: CurrentUser | undefined;
    readonly first: number; // 1〜20
    readonly after: string | undefined;
  }): Promise<{
    readonly userIds: readonly string[];
    readonly endCursor: string | null;
    readonly hasNextPage: boolean;
  } | null>;
}
```

- `ProductPageReader.read`の手順: (1)`checkHandleFormat(handle, PRODUCT_HANDLE_RULE)`の結果が`ok`でなければ`not-found`(8.7)。(2)`ProductDirectory.resolveHandle`→`decideProductPageAccess`(8.2〜8.6)。(3)`findDetail`・`listLaunches([productId], now)`を並行に読み(ローンチが無ければ`get(id) ?? []`)、取消を除いたローンチのIDで`MatchDirectory.listByLaunches(launchIds, now)`を1回読む。相手の側も返るため、側は自分のプロダクトの`entryId`で選ぶ。(4)対戦相手のプロダクトのIDで`findSummaries(ids, 'not-deleted')`を1回読む。(5)`toHistoryRows`・`summarizeRecord`・`LaunchHighlightsReader`(要約と受賞)。開催中のマッチは返さない(`LiveMatchReader`)。
- `LiveMatchReader.read`: (1)`ProductPageReader`と同じ判定でプロダクトを解決し、`render`でなければ`null`(旧ハンドルの転送は詳細ページの取得が行う)。(2)`listLaunches([productId], now)`と、取消を除いたローンチの`listByLaunches(launchIds, now)`を読む。(3)`phase`が`live`・`tallying`の最も新しいマッチを`matchId`に、`awaitingChange`を上の条件で決め、`serverTime`に`now`を返す。ページの取得と別の操作にするのは、定期の取り直しを開催中のマッチだけに重ねるため(010の「使う場面」)。
- `SupporterListReader.list`: (1)プロダクトを`ProductPageReader`と同じ判定で解決し、表示できなければ`null`。(2)`MatchDirectory.findMatches([matchId], now)`で、側がそのプロダクトのもので、マッチが`finished`であることを確かめ、違えば`null`(10.10)。(3)`SupporterDirectory.listSupporters({ entryId, after, limit: first })`(退会・停止を除く、10.9・10.10。`limit`が1〜20の整数でなければ`RangeError`のため、検証済みの`first`だけを渡す)。カーソルは`encodeCursor({ upvotedAt: <エポックミリ秒>, upvoteId })`(`encodeCursor`は文字列と数値の値だけを受け取る)。
- 利用者はセッションではなく引数で受け取る。閲覧者は`AccountGuard.currentUser`をリゾルバが渡す。

### api/infrastructure

#### AccountIndexRemovalSyncHandler・ProductIndexRemovalSyncHandler・ProductIndexRefreshSaveHook

**Contracts**: Event [x]

- 登録: `USER_LIFECYCLE_SYNC_HANDLERS`に`{ name: 'directory-discovery.account-index-removal', events: ['withdrawn', 'suspended'], handler: DIRECTORY_TYPES.AccountIndexRemovalSyncHandler }`(`accountIndexRemovalStatement`)。`PRODUCT_LIFECYCLE_SYNC_HANDLERS`に`{ name: 'directory-discovery.product-index-removal', events: ['deleted', 'hidden'], handler: DIRECTORY_TYPES.ProductIndexRemovalSyncHandler }`(`SearchIndexStatements.deleteSources('product', [productId])`)。いずれも読み取りをせず、集合の削除の文だけを返す(12.4・12.5)。同期の処理が削除の文を返すことは、backend/007の「[文の規約](../../../docs/GUIDES/tech/backend/007-user-lifecycle-events.md#文の規約)」とbackend/012の「集合に対する更新・挿入・削除」に従う(2026-11-10に開発者が削除を規約に加えると決定)。`accountIndexRemovalStatement(db, event.userId)`の文は契約の戻り値に合わせて`[stmt]`の配列で返す。
- 仮4: product-launchが仮11として提供する`PRODUCT_SAVE_HOOKS`(`apps/api/src/composition/product-save-hooks.ts`)に`{ name: 'directory-discovery.product-index-refresh', hook: DIRECTORY_TYPES.ProductIndexRefreshSaveHook }`を追記する。契約は`apps/api/src/infrastructure/product/product-save-hooks.ts`の`ProductSaveHook`(`statementsFor({ productId, at }, db)`・`afterCommit({ productId })`)と`ProductSaveHookRegistration`(`name`・`hook`)。接続を引数に取り文を返す契約のためinfrastructure層に置かれ、application層からは見えない。product-launchの`D1ProductStore`(infrastructure層)は登録(`registerProduct`)・編集(`updateProduct`、次回の予約とローンチ日の変更を含む)・公開APIの説明文の更新(`ProductDescriptionEditor`)の一括の書き込みの末尾に`statementsFor`の文を加え、確定の後に`ProductSaveHooks.runAfterCommit`で`afterCommit`を呼ぶ。`statementsFor`の文の失敗は保存ごと取り消され、`afterCommit`の例外は`warn`のログで保存を失敗させない。復元・停止の解除では呼ばれない(本specはライフサイクルの登録口で扱う)。

- 本specの実装: `statementsFor`は`DirectoryEntryStore.exists`が真なら`SearchIndexStatements.markPending('product', productId, at)`(`workers/search`)を返す。`afterCommit`は同じ条件で`SearchIndexRefreshRequester.requestRefresh('product', productId)`(12.3)。
- 3つの処理はいずれも、DBの型を使う文の契約(`UserLifecycleSyncHandler`・`ProductLifecycleSyncHandler`・`ProductSaveHook`)と`workers`の部品(`accountIndexRemovalStatement`・`SearchIndexStatements`)を使うため、apiの`infrastructure/directory/`に置き、Workers統合テストで確かめる。

### api/presentation

#### DirectorySchemaModule

**Contracts**: API [x]

```graphql
enum DirectorySort {
  RELEVANCE
  NEWEST
  OLDEST
  UPVOTES
}
enum DirectoryWinKind {
  VICTORY
  BYE
  EARLY
}
type DirectoryWin {
  launchDate: String!
  kind: DirectoryWinKind!
  "byeはnull"
  upvoteCount: Int
}
type DirectoryItemMetric {
  key: String!
  value: Int!
}
type DirectoryItem {
  handle: String!
  name: String!
  tagline: String!
  category: ProductCategory!
  websiteUrl: String!
  logo: MediaImage
  "表示できなければnull"
  owner: UserSummary
  isViewerOwn: Boolean!
  awards: [ProductAward!]!
  win: DirectoryWin!
  metrics: [DirectoryItemMetric!]!
}
type DirectoryAppliedQuery {
  q: String
  category: String
  from: String
  to: String
  sort: DirectorySort
  page: Int
}
type DirectoryPage {
  applied: DirectoryAppliedQuery!
  searchTerms: [String!]!
  businessToday: String!
  totalCount: Int!
  page: Int!
  pageCount: Int!
  items: [DirectoryItem!]!
}
input DirectoryInput {
  q: String
  category: String
  from: String
  to: String
  sort: String
  page: String
}
enum ProductPageOpponentKind {
  NONE
  PRIVATE
  UNLISTED
  LISTED
}
type ProductPageOpponent {
  kind: ProductPageOpponentKind!
  handle: String
  name: String
  logo: MediaImage
}
type ProductPageMatch {
  id: ID!
  entryId: ID!
  kind: MatchKind!
  round: Int
  stage: MatchStage
  date: String!
  result: MatchEntryResult!
  decision: MatchDecision!
  endedEarly: Boolean!
  ownUpvoteCount: Int!
  opponentUpvoteCount: Int
  opponent: ProductPageOpponent!
}
type ProductPageLaunch {
  id: ID!
  number: Int!
  launchDate: String!
  kickoffAt: DateTime!
  status: LaunchStatus!
  summary: LaunchSummary!
  kickedOff: Boolean!
  latestKickedOff: Boolean!
  matches: [ProductPageMatch!]!
}
type ProductPageRecord {
  firstLaunchDate: String
  launchCount: Int!
  wins: Int!
  losses: Int!
}
type ProductPageScreenshot {
  fileId: ID!
  image: MediaImage
}
type ProductPage {
  id: ID!
  handle: String!
  name: String!
  tagline: String!
  category: ProductCategory!
  websiteUrl: String!
  logo: MediaImage
  description: String!
  screenshots: [ProductPageScreenshot!]!
  owner: UserSummary!
  viewerIsOwner: Boolean!
  listed: Boolean!
  awards: [ProductAward!]!
  record: ProductPageRecord!
  launches: [ProductPageLaunch!]!
}
type ProductLiveMatch {
  "照会の時点のサーバーの時刻。残り時間を合わせるのに使う"
  serverTime: DateTime!
  "マッチ中・集計中の最も新しいマッチ。無ければnull"
  match: Match
  "集計中のマッチがある、またはキックオフ済みのローンチの予選マッチが未作成・開始の時刻を過ぎて未開始"
  awaitingChange: Boolean!
}
type ProductPageRedirect {
  handle: String!
}
union ProductPageResult = ProductPage | ProductPageRedirect
type SupporterConnection {
  nodes: [UserSummary!]!
  pageInfo: PageInfo!
}
type Query {
  directory(input: DirectoryInput!): DirectoryPage!
  directoryCategories: [ProductCategory!]!
  "表示できなければnull(404)"
  productPage(handle: String!): ProductPageResult
  "詳細ページの開催中のマッチ(定期の取り直しの対象)。表示できない・旧ハンドルはnull"
  productLiveMatch(productHandle: String!): ProductLiveMatch
  "表示できないプロダクト・確定していないマッチはnull"
  matchSupporters(
    productHandle: String!
    matchId: ID!
    entryId: ID!
    first: Int!
    after: String
  ): SupporterConnection
}
```

| 操作                               | 呼び出し元 | ログイン・権限 | bot対策 | エラー                                                         |
| ---------------------------------- | ---------- | -------------- | ------- | -------------------------------------------------------------- |
| `directory`・`directoryCategories` | client     | 不要           | なし    | —(不正な入力は正規化して返す、3.7)                             |
| `productPage`                      | client     | 不要           | なし    | —(null・リダイレクトで表す)                                    |
| `productLiveMatch`                 | client     | 不要           | なし    | —(nullで表す)                                                  |
| `matchSupporters`                  | client     | 不要           | なし    | `validation_error`(`first`は1〜20、IDはULID)・`invalid_cursor` |

- 呼び出し元が`client`でなければ`forbidden`。`DirectoryInput`は全ての項目を文字列で受け、検証の違反をエラーにせず`normalizeDirectoryQuery`へ渡す(3.7)。
- `DirectoryViews`(`directory-views.ts`): `logo`・`ProductPageScreenshot.image`・`ProductPageOpponent.logo`は`mediaFileLoader`→`toMediaImage`、`category`は`productCategoryLoader`、`owner`・`SupporterConnection.nodes`は`userSummaryLoader`(`nodes`は`[UserSummary!]!`のため、`null`になった利用者(退会・停止の競合)は一覧から除く。`UserSummary.avatar`は上流の`UserSummary`のリゾルバが解決するため、本specは画像を読まない)、`ProductLiveMatch.match`はmatch-engineの`loadMatchView(context, matchId)`(`matchViewLoader`を直接`load`しない。閲覧者の`viewerUpvotedEntryId`・`viewerRestriction`はmatch-engineが処理単位のセッションで解決する、9.6)、`websiteUrl`は`checkExternalUrl`が`ok`でなければ空文字(2.6)。`ProductAward`・`LaunchSummary`はproduct-launchの型を、値の形(`kind`・`count`・`labels`、`label`・`inMatch`)をそろえて返す。

### event

#### QualifierListingHandler・ProductIndexRestoreHandler・EntryErasureHandler・AccountIndexRestoreHandler

**Contracts**: Event [x] / Batch [x]

| 名前                                        | 登録口                                   | 種類          | `order` | 処理                                                                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------- | ------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directory-discovery.qualifier-listing`     | `MATCH_EVENT_HANDLERS`(kinds: qualifier) | `decided`     | 1200    | `findMatches([matchId], now)`→勝った側(`isWinningResult`・`productId`と`ownerUserId`あり)を`record`→`ProductIndexPendingMarker.mark`(更新待ちの一括の書き込み)→`requestRefresh`。`done`(1.5・12.2) |
| `directory-discovery.product-index-restore` | `PRODUCT_LIFECYCLE_ASYNC_HANDLERS`       | `unhidden`    | 1200    | `exists`なら`ProductIndexPendingMarker.mark`と`requestRefresh`。`done`(12.6)                                                                                                                       |
| `directory-discovery.entry-erasure`         | `PRODUCT_LIFECYCLE_ASYNC_HANDLERS`       | `purge_due`   | 1200    | `erase(productId)`。`done`(12.7)                                                                                                                                                                   |
| `directory-discovery.account-index-restore` | `USER_LIFECYCLE_ASYNC_HANDLERS`          | `unsuspended` | 1200    | `listProductIdsByOwner(userId, after, 100)`を最後まで読み、100件ずつ`ProductIndexPendingMarker.mark`と`requestRefresh`を行う。`done`(12.6)                                                         |

```typescript
// event/src/application/directory/ports.ts
export interface ProductIndexPendingMarker {
  mark(productIds: readonly string[], at: Date): Promise<void>; // 各プロダクトの索引文書を更新待ちにする。1回の一括の書き込み(100件以内)
}
// event/src/infrastructure/directory/d1-product-index-pending-marker.ts
export declare class D1ProductIndexPendingMarker implements ProductIndexPendingMarker {
  constructor(db: Database, statements: SearchIndexStatements); // @inject(PLATFORM_TYPES.Database)・@inject(SEARCH_TYPES.IndexStatements)
}
```

- 置き場所: application層はデータベースの接続・SQLの文・一括の書き込みを扱わず、`**/lib/workers/**`の`SearchIndexStatements`を読み込めないため、更新待ちの書き込みの単位をポート`ProductIndexPendingMarker`(`EVENT_DIRECTORY_TYPES.ProductIndexPendingMarker`)としてapplication層に定義し、`SearchIndexStatements.markPending('product', id, at)`の文を組み立てて1回の`db.batch()`で実行する実装`D1ProductIndexPendingMarker`をinfrastructure層に置く(identity-authの`UserLifecycleCommitter`と同じ分け方)。eventだけが使うため、契約を`core`に置かない。空の配列では何もしない。
- 4つの処理の契約(`MatchEventHandler`・`ProductLifecycleAsyncHandler`・`UserLifecycleAsyncHandler`)、`MatchDirectory`(`core/match`)、`DirectoryEntryStore`(`core/directory`)、`SearchIndexRefreshRequester`(`core/search`、`SEARCH_TYPES.RefreshRequester`)は`core`から読み込み、application層の各ファイルは`**/lib/workers/**`を読み込まない。単体テストは偽のポートで確かめる。
- `account-index-restore`は1回の実行で投稿者の全ての記録を処理する(1人の投稿者のプロダクトは多くても数百件)。途中で失敗して再試行されても、`markPending`と更新の要求は冪等である(content-processingの処理が処理の時点の状態から書く、12.9)。
- `qualifier-listing`はmatch-engineの`match-engine.qualifier-outcome`(1100)の後に動くため、`wonLaunchExists()`が真になった後に索引が作られる(13.2)。結果を記録できなかったローンチは`read`が掲載中でないと判断し、索引を作らない。
- 例外はそれぞれの登録口の再試行の方針で再試行され、上限でSentryに通知される。ログはカテゴリ`['event', 'directory']`、属性はプロダクト・マッチ・利用者のIDと件数だけ(13.3)。

### client

```typescript
// components/directory/directory-section-types.ts
export type DirectoryPlacement = 'banner' | 'aside' | 'bottom';
export interface DirectorySectionContext {
  readonly viewer: { readonly signedIn: boolean };
  readonly query: DirectoryQuery;
}
export interface DirectorySection {
  readonly id: string;
  readonly placement: DirectoryPlacement;
  readonly order: number;
  readonly component: ComponentType<DirectorySectionContext>;
}
export interface DirectoryListInsert {
  readonly id: string;
  readonly order: number;
  readonly every: number;
  readonly component: ComponentType<{ readonly position: number }>;
}
export interface DirectoryItemMetric {
  readonly key: string;
  readonly order: number;
  readonly component: ComponentType<{
    readonly value: number;
    readonly productHandle: string;
    readonly productName: string;
  }>;
}
// composition/directory-sections.ts(初版はいずれも空、仮3)
export declare const DIRECTORY_PAGE_SECTIONS: readonly DirectorySection[];
export declare const DIRECTORY_LIST_INSERTS: readonly DirectoryListInsert[];
export declare const DIRECTORY_ITEM_METRICS: readonly DirectoryItemMetric[]; // engagementがcomments(10)を追記

// components/product-page/product-page-section-types.ts
export type ProductPagePlacement = 'banner' | 'main' | 'aside' | 'bottom';
export interface ProductPageContext {
  readonly product: {
    readonly id: string;
    readonly handle: string;
    readonly name: string;
    readonly listed: boolean;
    readonly ownerHandle: string;
  };
  readonly viewer: { readonly signedIn: boolean; readonly isOwner: boolean };
  readonly page: ProductPageFragment; // 本specの区画が使う取得の結果
  // ページ全体の自動更新の切り替えの状態(013の「自動更新の切り替え」)
  readonly autoRefresh: boolean;
  // 定期の取り直し・毎秒の数値の更新・演出を持つ間はtrueを申告し、無くなればfalseにする
  readonly reportAutoUpdating: (active: boolean) => void;
}
export interface ProductPageSection {
  readonly id: string;
  readonly placement: ProductPagePlacement;
  readonly order: number;
  readonly component: ComponentType<ProductPageContext>;
}
export interface ProductLaunchSectionContext extends Omit<
  ProductPageContext,
  'page' | 'autoRefresh' | 'reportAutoUpdating'
> {
  readonly launch: {
    readonly id: string;
    readonly number: number;
    readonly kickedOff: boolean;
    readonly latestKickedOff: boolean;
  };
}
export interface ProductLaunchSection {
  readonly id: string;
  readonly order: number;
  readonly component: ComponentType<ProductLaunchSectionContext>;
}
export interface ProductOwnerAction {
  readonly id: string;
  readonly order: number;
  readonly component: ComponentType<
    Omit<ProductPageContext, 'page' | 'autoRefresh' | 'reportAutoUpdating'>
  >;
}
// composition/product-page-sections.ts
export declare const PRODUCT_PAGE_SECTIONS: readonly ProductPageSection[];
// 初版: directory-discovery.screenshots(main 20)・directory-discovery.description(main 30)・directory-discovery.match-history(main 40)・directory-discovery.owner(aside 10)
// 予約: トロフィーはmainの10(tournament)、評価はasideの20(engagement)、通報はbottomの10(content-reporting)、広告はbanner・asideの30・bottomの20(sponsorship)
export declare const PRODUCT_LAUNCH_SECTIONS: readonly ProductLaunchSection[]; // 初版は空。engagementのコメント(10)
export declare const PRODUCT_OWNER_ACTIONS: readonly ProductOwnerAction[]; // 初版は空。Week 10・Year 20
```

#### user-profile-socialの部品の使い方

- `UserAvatar`(`apps/client/src/components/profile/user-avatar.tsx`): `user`(`handle`・`nickname`・`avatar`。未設定は`null`)・`size`・`className`。`size`は`SquareDisplaySize`の`32 | 64 | 128`だけで、本specは`32`を使う(画像の変換の大きさが`size`で決まるため、28などの値は使わない)。見た目をさらに小さくする場合は`className`で調整する。
- `FollowButton`(`apps/client/src/components/profile/follow-button.tsx`): `target`(`{ handle }`、相手の現在のハンドル)・`initialFollowing`(取得済みの関係)・`onChange?`(`FollowState`の`following`・`followerCount`。成功した後だけ呼ばれる)・`size?`(`'sm' | 'default'`、既定は`sm`)・`className?`。閲覧者は部品が`useViewer()`から読み、未ログインは案内のボタン、本人は何も描かない。未確認の閲覧者は、未フォローの間は押せず理由を示す。
- `FollowButton`はキャッシュを更新しない。呼び出し側は`onChange`で、自分の画面の取得を`setQueryData`で合わせる。`FollowToggleButton`は`initialFollowing`が変わると以前の操作の結果を捨てて新しい初期値に従うため、取得し直した値をそのまま渡せばよい。
- 公開プロフィールのキャッシュは、`apps/client/src/graphql/public-profile.ts`の`PUBLIC_PROFILE_QUERY_PREFIX`で`queryClient.removeQueries`する。公開プロフィールのloaderは`staleTime: 'static'`のため、`invalidateQueries`では取り直されない。表示中の取得を`removeQueries`すると`initialFollowing`の元が消えるため、表示中の取得は`setQueryData`で更新する。

#### 移す部品とカード(2026-11-10に開発者が決定)

- match-engineのトップページ専用の置き場所にある汎用の部品を、トップページと詳細ページの両方が使うため、clientの`components/top/`から`components/match/`へ移す。中身と振る舞いは変えず、既存のテストも移し、トップページの読み込みを書き換える。
  - `AutoRefreshSwitch`(`auto-refresh-switch.tsx`)と、その文言`AUTO_REFRESH_LABEL`・`AUTO_REFRESH_DESCRIPTION`(`top-page-messages.ts`から`auto-refresh-messages.ts`へ)。説明の文言は`LIVE_REFRESH_INTERVAL_MS`から作る秒数とUpvote数・残り時間・演出の対象で、詳細ページでもそのまま当てはまる。コメントの「トップページの」を、ページ全体の切り替えの説明に改める。
  - `FullTimeCountdown`(`full-time-countdown.tsx`)と`full-time-countdown-text.ts`。トップページの`FullTimeCountdownSection`(取得を読む区画)は`components/top/`に残す。
  - `FOLLOW_UP_REFETCH_LIMIT`・`QueryUpdateCounts`・`updateCountOf`(`qualifier-refresh.ts`から`follow-up-refetch.ts`へ)。予選の一覧だけの判定は`components/top/`に残す。
  - frontend/013の部品の表は自動更新の切り替えを`components/<ページ>/`に置くとしているため、複数のページが使う場合は`components/<ドメイン>/`に置く旨を加える。
- frontend-libの`components/ui/card/`に、shadcn/uiの`Card`を005の「1ファイル1コンポーネントとshadcn/uiの分割」に従って部分ごとのファイルで作る。モックアップ(`mockups/src/components/ui`)には無い部品のため、shadcn/uiの既定の`Card`を基に、デザイントークン(`bg-card`・`text-card-foreground`・`border-border`)で書く。カタログ(`card.stories.tsx`、ライト・ダーク)とブラウザテスト(`runAxe`)を添え、005の部品の一覧に加える。本specは`OwnerCard`で使い、後続specの評価・広告などの枠でも使える。

#### DirectoryRoute・DirectoryPageと部品

- `routes/p/index.tsx`: `validateSearch`は`normalizeDirectoryQuery`(3.7)、`loaderDeps`は正規化した条件、`loader`で`directory`と`directoryCategories`を`queryClient.query({ ...graphqlQueryOptions(...), staleTime: 'static' })`で待つ(サーバーで描画、7.2。`ensureQueryData`は非推奨のため使わない、006の「取得の補助とloader」)。`head`は`buildSitePageHead({ title: 'ディレクトリ', description, canonicalUrl: '/p' })`(オリジンの無いパス、8.8)。サーバーが返した`applied`が正規化の結果と違えば(存在しないカテゴリなど)、`navigate({ replace: true })`でURLを合わせる。
- `DirectoryPage`: 見出し・`SearchForm`・`FilterToolbar`(768px以上)または「絞り込み・並び順」と`FilterSheet`(768px未満、3.9・3.10)・`ResultCount`・一覧と`DirectoryPagination`・`LaunchCta`(7.1・7.8)。`DIRECTORY_PAGE_SECTIONS`を置き場所ごとに`RecoverableSlot`で包んで描き(7.10)、何も描かない区画の枠と間隔を残さない(013の「区画の登録とページの構成」の目印と`display: contents`)。`DIRECTORY_LIST_INSERTS`を`every`件ごとに(割り切れるときは最後の項目の後にも)`RecoverableSlot`で包んで差し込み、部品へ何番目かの位置(1から)を渡す。`useQuery`の`placeholderData: keepPreviousData`で、条件の変更の読み込み中は直前の一覧を`aria-busy`と薄い表示で残し、上端に進捗のバーを出し、件数欄を「読み込み中…」にする(7.4)。初回はスケルトン(7.3)、失敗は`ErrorState`(7.5)、0件は`DirectoryEmptyState`(7.6・7.7)、範囲外は「このページにはプロダクトがありません。」と全ページ数と「1ページ目へ」(6.6)。演出は使わない(7.9)。
- `SearchForm`: `role="search"`、ラベル付きの入力欄、消去のボタン、40書記素を超えたら`aria-live="polite"`の「45/50」、50を超えたらフォーカスアウトと送信でエラー(`aria-invalid`・`aria-describedby`)にして送らない。Enterと検索のボタンでだけ`withConditions`で遷移する(4.3〜4.5)。
- `CategoryPicker`: ポップオーバーの中の入力欄で絞り込むリストボックス(`role="combobox"`・`aria-activedescendant`、上下キーとEnter)。選択肢は`directoryCategories`の順に「全て」を先頭に足す(3.1)。読み込み中は無効(7.3)。
- `PeriodFilter`・`PeriodRangeForm`: プリセットの選択と「期間を指定…」のポップオーバー(768px未満はシート内)の2つの日付入力(`type="date"`、`max`は`businessToday`)。`validateCustomRange`の結果で文言と適用のボタンの無効化(3.3〜3.5)。プリセットの範囲は`presetRange(preset, businessToday)`、表示は`periodKeyOf`と`formatPeriodLabel`(3.4)。
- `SortSelect`: 4つの選択肢。検索語が無ければ「関連度」を`aria-disabled`にし「検索キーワードを入力すると選べます」を併記する(5.1・5.3)。
- `ResultCount`: 「1,234件中21〜40件」・「3件」・読み込み中は「読み込み中…」(6.3)。
- `DirectoryItem`: `<article aria-labelledby>`、名称のリンクを項目全体に広げ(`after:absolute`)、内側の操作は前面に出す(2.2)。名称・タグラインは`HighlightedText`(`searchTerms`、4.6)。カテゴリは`withConditions(query, { category })`のリンク(2.3)、投稿者は`UserAvatar`(32)とニックネームで`/@<ハンドル>`(2.4)、本人は「あなたのプロダクト」と「編集」(`/my/products/<ハンドル>/edit`、2.5)、「サイトを開く」は`target="_blank" rel="noopener"`(2.6)、`DIRECTORY_ITEM_METRICS`を`order`順に値のあるものだけ描く(2.12)。3・2・1列の配置は2.13。
- `WinSummary`: 「予選勝利」・`<time datetime>`のローンチ日(今年は年を省く)・`kind`ごとの表示(`VICTORY`は「1,234票」、`BYE`は「不戦勝」と「対戦相手がいないため」、`EARLY`は「不戦勝」と「確定時点で{n}票」、2.7〜2.10)。
- `AwardBadges`: 賞の種類ごとに1つのゴールドのバッジ、Year先頭、「×3」、ツールチップに`labels`(2.11)。product-launchのローンチ履歴と同じ見た目にする。
- `DirectoryPagination`: 768px以上は番号付き(先頭・末尾・前後1つ・「…」)、未満は「前へ」「5 / 62」「次へ」。`<nav aria-label="ページ">`、現在のページに`aria-current="page"`(6.4)。`useDirectoryNavigation`がページの移動の後に一覧の先頭へスクロールし見出しへフォーカスを移す(視差効果を減らす設定では`behavior: 'auto'`、6.5)。

#### ProductPageRoute・ProductPageと部品

- `routes/p/$handle.tsx`: `loader`は`checkHandleFormat(handle, PRODUCT_HANDLE_RULE)`の結果が`ok`でなければ`notFound()`、`productPage`を`queryClient.query({ ...graphqlQueryOptions(...), staleTime: 'static' })`で待ち、同時に`productLiveMatch`を`prefetchQuery`で読む(開催中のマッチの取得の失敗でページを失敗にしない。区画が`RecoverableSlot`の中で取り直す)。`productPage`が`null`なら`notFound()`、`ProductPageRedirect`なら`redirect({ to: '/p/$handle', params: { handle }, search: 現在の検索パラメーター, statusCode: 302 })`(8.3〜8.7)。`head`は`buildSitePageHead({ title: <名称>, description: <タグライン>, canonicalUrl: '/p/' + <現在のハンドル>, noIndex: !listed })`(オリジンの無いパスで渡す。`buildPageHead`は絶対URLをcanonicalにしない)(8.1・8.8・8.10)。404はfrontend-platformの`NotFoundView`(トップページとディレクトリへの導線、8.4)、`errorComponent`は`ErrorState`(8.9)、`pendingComponent`は`ProductPageSkeleton`。
- `ProductPage`: 1024px以上は本文とサイドバー(幅320〜352px、`sticky`)の2カラム、それ未満は1カラムでサイドバーをヘッダーの直後に置く(9.1)。`banner`の区画→`ProductBreadcrumbs`→`UnlistedBanner`(本人の未掲載、9.3)→`ProductHeader`→`LiveMatchSection`→`main`の区画(`order`順)→`bottom`の区画、サイドバーに`aside`の区画(9.2)。区画と`LiveMatchSection`をそれぞれ`RecoverableSlot`で包み(9.11)、何も描かない区画の枠と間隔を残さない(013の目印と`display: contents`、目印は`data-product-page-section-rendered`)。並べ替えは`product-page-section-order.ts`。
  - 自動更新(013の「自動更新の切り替え」、9.6・9.9): ページが`useState(true)`で切り替えの状態を持ち、ページの根の要素に`data-auto-refresh="on"`・`"off"`を付ける(`stadium.css`の演出は属性が`on`の子孫にだけ掛かり、開催中のマッチ以外は静止する)。`components/match/`へ移した`AutoRefreshSwitch`を、区画のエラーの境界の外の、本文の先頭(パンくずリストの前)に置く。描く条件は、ページ自身の値(開催中のマッチがある・変化を待つ状態)か区画の申告(`reportAutoUpdating`)のいずれかがあること。区画が失敗した時と外れた時はその区画の申告を消す。
  - 境界の取り直し: ページが`useBoundaryRefresh`で、`productLiveMatch`の`match.endsAt`と、予約済みのローンチの最も近い`kickoffAt`の直後に、`ClientProductLiveMatch`と`ClientProductPage`の取得を無効にする(「開催中のマッチの取り直し」)。
  - bot判定: 開催中のマッチがあるときだけ、`LiveMatchSection`をmatch-engineの`UpvoteBotProtection`で包む(内側に`match_upvote`の`TurnstileWidget`が1つ描かれ、`useUpvote`はその内側でだけ呼べる)。ウィジェットは非表示だが、判定の失敗では`role="alert"`の文言を描くため、区画の末尾(対戦カードの下)に置かれる形のままにする。
- `ProductHeader`: ロゴ(`square-md`)・カテゴリのリンク(`/p?category=<ハンドル>`)・受賞回数(受賞の合計、1以上)・`h1`の名称・タグライン・投稿者(`UserAvatar`・ニックネーム・`@ハンドル`、`/@<ハンドル>`)・`OwnerFollow`(本人以外)・`CopyLinkButton`・「サイトを開く」(`rel="noopener"`)・初ローンチ日(`<time datetime>`)・ローンチ回数・「◯勝◯敗」(9.4・9.5)。
- `OwnerFollow`: ログイン中で本人でない閲覧者のとき、`ClientOwnerFollowStatus`(`publicProfile(handle)`の`viewerRelation`)をクライアントで読み、`viewerRelation`が`FOLLOWING`のときだけ`FollowButton`の`initialFollowing`に`true`を渡す(未ログイン・本人の閲覧では読まず、`false`を渡す)。キーは`graphqlQueryKey`に閲覧者のIDを加える(公開プロフィールと同じく、ログイン・ログアウトの後に前の閲覧者の関係を使わないため)。`onChange`では、そのキーを`setQueryData`で`viewerRelation`を`FOLLOWING`か`NOT_FOLLOWING`に合わせ、`PUBLIC_PROFILE_QUERY_PREFIX`を`removeQueries`して相手の公開プロフィールを次に開くとき取り直させる。未ログインは`FollowButton`の未ログインの表示をそのまま使う。照会の失敗はボタンを描かない(縮退)。
- `CopyLinkButton`: 正規のURLを`navigator.clipboard.writeText`で写し、成功と失敗を`notify`で知らせる(9.12)。
- `LiveMatchSection`: `ClientProductLiveMatch`(`productLiveMatch(productHandle)`)を購読し、`match`があるとき見出し(`id="live-match-heading"`)・`FullTimeCountdown`(`phase`は`match.phase`が`LIVE`なら`LIVE`、`fullTimeAt`は`match.endsAt`、`serverTime`は取得の値、`autoRefresh`は文脈の値)・`MatchCard`・`useUpvote`(`onUpdated`で`ClientProductLiveMatch`のキャッシュの`match`だけを`setQueryData`で差し替える)を描く(9.6)。
  - `refetchInterval`と`refetchOnWindowFocus`は`live-match-refresh.ts`の判定(`liveMatchRefetchIntervalOf`: オンで`LIVE`か`awaitingChange`なら`LIVE_REFRESH_QUERY_OPTIONS.refetchInterval`、オフでは`awaitingChange`の間だけ`FOLLOW_UP_REFETCH_LIMIT`回まで)の関数にする。回数は`updateCountOf`と基準の差で数え、取得に`notifyOnChangeProps: ['data', 'dataUpdatedAt', 'errorUpdateCount']`を渡す。上限に達してもオフで変化を待つ状態なら、見出しの下に常に置いた`role="status"`の文をページを開き直す案内に切り替える。
  - マッチが`FINISHED`になった、または`match`が無くなったら`ClientProductPage`の取得を無効にする。定期の取り直し・残り時間・演出を持つ間は`reportAutoUpdating(true)`を申告する。
  - ページの区画として描かれる部品は、ページの`UpvoteBotProtection`をそのまま使う(013の「bot判定のトークンの共有」)。
- `ScreenshotGallery`・`ScreenshotLightbox`(`main` 20): `screenshot-thumb`を高さをそろえて横スクロール、押すとダイアログで`screenshot-full`、前後のボタン・左右キー・スワイプ(ポインターの移動量)、「3 / 10」、0枚は描かない(9.7)。
- `ProductDescription`(`main` 30): `CollapsibleMarkdownContent`(480px)と`useMarkdownOptions({ externalLinkRel: ['noopener'], idScope: 'product' })`(9.8)。
- `MatchHistorySection`(`main` 40)・`LaunchBlock`: 見出し「マッチ履歴とコメント」(`id="launches-heading"`)、ローンチごとに「第◯回ローンチ」・`<time datetime>`の日付・要約のチップ(10.1)、行の一覧または`EmptyMatches`(10.12・10.13)、`PRODUCT_LAUNCH_SECTIONS`を`RecoverableSlot`で包んで`order`順に描く(10.14)。
- `MatchHistoryRow`: 種別とラウンドの印(match-engineの`match-labels.ts`)・日付・対戦相手(`kind`ごと、10.3)・比率のバー(`role="img"`と「Upvote数の比率: 12対9」、相手の数があるときだけ)・スコア「12対9」・勝敗のチップ(勝利・不戦勝・敗北・両者敗北、10.2・10.5〜10.7)。`decision`が`LAST_UPVOTE`なら枠を強調し「接戦」と注記(10.4)。`ownUpvoteCount`が1以上なら「サポーター{n}人」の`aria-expanded`のボタン(10.8、仮5)。
- `SupportersPanel`: `useInfiniteQuery`で`matchSupporters`を`first: 20`、`max-h-72`の枠の中の末尾の番兵を`IntersectionObserver`で見て続きを読む(10.9)。注記(10.10)、各行は`UserAvatar`(32)・ニックネーム・`/@<ハンドル>`、失敗は取得済みを保って「サポーター一覧を読み込めませんでした。」と再試行(10.11)。
- `EmptyMatches`: `kickedOff`で開催中なら「予選マッチが行われています。勝敗はフルタイム後にここへ表示されます。」と`#live-match-heading`への「マッチを見る」(10.12)。キックオフ前は日付と文言、本人は「リンクをコピーして応援を呼びかける」、他者は「トップページで本日のマッチを見る」(10.13)。
- `OwnerCard`(`aside` 10、本人だけ描く): frontend-libの`Card`(`CardHeader`・`CardTitle`・`CardContent`・`CardFooter`、枠線を`className`で破線にする)で描く「あなたのプロダクト」、直近のローンチの`summary`の見出し、「編集」(`/my/products/<ハンドル>/edit`)、「再ローンチを予約」(同じ編集の画面)。`ClientProductOwnerStatus`(`productOwnerStatus(productHandle)`)をクライアントで読み、`plan.mode`が`BLOCKED`なら無効と`blocks`の`message`・`releaseAt`(11.2)、`window.relaunchIntervalDays`があれば「このプロダクトは◯日以降のローンチ日を選べます。」(11.3)、`locked`なら固定の注記(11.4)、照会の失敗は無効と「再ローンチの予約の状態を確かめられませんでした。時間をおいて再度お試しください。」(11.6)。`PRODUCT_OWNER_ACTIONS`を描く(11.5)。予約と保存の可否はproduct-launchの保存が判定する(11.7)。

### docs

#### DirectoryTechDocs・DirectoryServiceSpecs

- `db/007-latest-row-per-group-listing.md`(14.4): グループごとの最新の行で並べる一覧の問い合わせの規約(条件を窓関数の前に掛ける、`ROW_NUMBER()`の並びを一意にする、同順位の決まった順、件数とページを同じ一括の読み取りにする、オフセット方式の読み取りの費用と上限、全文検索の副問い合わせとの結合、写しのテーブルへ移る判断の目安)。
- `frontend/014-url-state-listing.md`(14.4): URLのクエリで状態を表す検索・絞り込み・ページ分けの画面の規約(クエリの正規化を共有の関数にする、不正な値の黙った既定化、既定の値の省略、条件の変更で1ページ目、サーバーの解決の結果へのURLの合わせ込み、直前の結果を残す再読み込みの状態、ページの移動のスクロールとフォーカス、送信でだけ検索する入力欄と文字数の表示)。
- サービス仕様(14.5): ページ配置(ディレクトリの区画の置き場所と仮3の注記・詳細ページの区画の置き場所と順・仮1・仮2・仮5の注記)、文言規則(Error Handlingの文言)、`docs/onboardings/project-values.md`(処理の名前と`order`、検索対象`product`と重み、区画の`order`)。

## Data Models

### Domain Model

- **掲載中のプロダクト**: product-launchのプロダクトのうち`visibleProducts() AND wonLaunchExists()`のもの。本specは写しを持たない。
- **基準勝利**: 掲載中のプロダクトの予選の勝利のうち、期間の条件を満たす実施日が最大のもの(仮2)。問い合わせの中で導く。
- **勝利したプロダクトの記録(DirectoryEntry)**: 勝利したことのあるプロダクトと投稿者。利用者単位の索引の操作の手がかり。プロダクトの物理削除で消える。
- **索引文書(ProductSearchDocument)**: content-processingの索引文書の形。掲載中のプロダクトに1つまで。
- **不変条件**: (1)索引文書は掲載中のプロダクトにだけ作られる(`isIndexable`)。(2)削除・非公開化・退会・停止の確定の後に、そのプロダクトの索引文書は残らない。(3)`directory_entries`はプロダクトに1つ。

```mermaid
erDiagram
    PRODUCTS ||--o| DIRECTORY_ENTRIES : listed_once
    PRODUCTS ||--o| PRODUCT_SEARCH_DOCUMENTS : indexed_while_listed
    PRODUCT_SEARCH_DOCUMENTS ||--|| PRODUCT_SEARCH_DOCUMENTS_FTS : mirrors
    MATCH_ENTRIES }o--|| PRODUCTS : wins
```

### Physical Data Model

すべて`snake_case`、日時はエポックミリ秒の整数、IDはULID(`ulidPrimaryKey()`)。索引文書の主キーはcontent-processingの規約どおり連番。外部キーは`ON DELETE`を指定しない。

| テーブル                       | 列(共通カラム以外)                                                                                                                                                | 制約・索引                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `product_search_documents`     | `searchDocumentColumns()`(`id`連番・`source_id`・`source_version`・`keywords`・`keyword_status`・`extraction_input_hash`・`status_changed_at`)・`name`・`tagline` | `source_id`一意、`product_search_documents_status_idx` |
| `product_search_documents_fts` | FTS5(`name`・`tagline`・`keywords`、external content、`unicode61 remove_diacritics 2`、`prefix='2 3'`)                                                            | トリガー3つ(カスタムマイグレーション)                  |
| `directory_entries`            | `product_id`(→`products.id`)・`owner_user_id` text・`first_won_at` integer                                                                                        | `product_id`一意、`owner_user_id`の索引                |

- 一覧の問い合わせはmatch-engineの`match_entries`の`(match_kind, match_date)`・`product_id`の索引と、product-launchの`products`の主キーを使い、本specは上流のテーブルに索引を足さない。

### Data Contracts & Integration

- GraphQL: 「DirectorySchemaModule」のSDLが契約。利用者側の許可リストに本specの操作(`ClientProductLiveMatch`を含む)と、`publicProfile`の`viewerRelation`・`productOwnerStatus`を読む操作が載る。
- 検索対象`product`: 本文に名称・タグライン・説明文の抽出のキーワードだけを含む。`search-index.refresh`の本文はIDだけ(content-processing)。

## Error Handling

### Error Strategy

- ディレクトリの入力の誤りはエラーにせず正規化する(3.7)。詳細ページの不在・閲覧不可はnull(404)、旧ハンドルはリダイレクトの型で返す。
- 供給元(要約・受賞・項目の値)の失敗は、その値だけを欠いて縮退する(2.12・10.1)。プロダクト・マッチの照会の失敗はページの取得エラーにする(部分的な一覧や履歴を出さない、7.5・8.9)。
- 詳細ページの区画・ディレクトリの区画・開催中のマッチの区画の失敗は`RecoverableSlot`に閉じ込める(7.10・9.11)。開催中のマッチの取得の失敗はページを失敗にせず、区画の中で再試行させる。自動更新の切り替えは区画の失敗で消えない。投稿者本人向けの操作の照会とフォロー中の照会の失敗はその部品だけを縮退させる(11.6)。
- 索引の処理の失敗は、イベントの実行器の再試行と、content-processingの日次の再抽出で回復する(12.8)。

### Error Categories and Responses

| コード                        | 種類(状態コード) | 場面                           | 文言(文言規則に追加・既存) |
| ----------------------------- | ---------------- | ------------------------------ | -------------------------- |
| `validation_error`            | bad_request(400) | `matchSupporters`の`first`・ID | 既存                       |
| `invalid_cursor`・`forbidden` | 既存             | 既存                           | 既存                       |

- 状態・トーストの文言(文言規則に追加): 「プロダクト一覧を読み込めませんでした。…」(既存)、「条件に一致するプロダクトはありません。…」(既存)、「ディレクトリに掲載されたプロダクトはまだありません。」(既存)、「このページにはプロダクトがありません。」(既存)、「開始日は終了日以前の日付を選んでください。」(既存)、「未来の日付は選べません。」(既存)、「検索キーワードは50文字以内で入力してください。」、「検索キーワードを入力すると選べます」、「読み込み中…」、「予選マッチに勝利したプロダクトだけが並ぶカタログです。」、「このページはあなたにだけ表示されています。…」(既存)、「プロダクト情報を読み込めませんでした。…」(既存)、「リンクをコピーしました。」・「リンクをコピーできませんでした。」、「サポーター一覧を読み込めませんでした。」、「Upvoteした日時が早い順。退会・停止したユーザーは表示されません。」、「予選マッチが行われています。勝敗はフルタイム後にここへ表示されます。」、「にキックオフします。」と本人・他者の案内、「同点・最終Upvote時間が早く勝利」・「同点・最終Upvote時間の差で敗北」、「対戦相手なし」・「対戦相手がいないため」・「確定時点で{n}票」、「再ローンチの予約の状態を確かめられませんでした。時間をおいて再度お試しください。」。

### Monitoring

- `getAppLogger(['api'|'event', 'application', 'directory'])`で、プロダクト・マッチ・利用者のIDと件数・結果の種類だけを記録する(13.3)。検索語・名称・説明文・ハンドルは記録しない。
- 供給元の失敗は`warn`(登録の名前とプロダクトの件数)。索引の処理の再試行の上限は各登録口の方針でSentryへ通知される。

## Testing Strategy

- Unit Tests(Bun、`*.unit.test.ts`):
  - `directory-query-rules`: 不正なクエリの既定化(実在しない日付・逆順・検索語なしの関連度・既定の並び順・`page`の0・1・小数・文字列)、50書記素の切り詰め(絵文字の結合文字)、`withConditions`の1ページ目、`changedConditionCount`(3.7・3.8・3.10・4.3)。
  - `directory-period`: 基準時刻の今日からの各プリセット(月曜日・日曜日・月末・年末)、`periodKeyOf`の一致と`custom`、`validateCustomRange`の未来と逆順、期間の表示の文言(3.3〜3.5)。
  - `product-page-access`: `none`・可視でない(非公開・停止・退会)・未掲載の他者と本人・`previous`の転送・`current`(8.2〜8.6)。
  - `base-win`・`match-history`: 勝利・不戦勝・開始時点の`walkover`・早期の`walkover`の分類、対戦相手の4つの見え方(紐付けの解除を含む)、接戦、両者敗北、確定前のマッチの除外、通算成績と初ローンチ日(2.7〜2.10・9.5・10.2〜10.7)。
  - ユースケース(模擬のポート): product-launchの`fallbackLaunchSummary`への縮退と`rank`の選択、受賞のまとめ(Year先頭)、`DirectoryReader`の手順(存在しないカテゴリ・空白だけの検索語・範囲外のページ・問い合わせ後に可視でなくなった行)、`ProductPageReader`の取消の除外と自分の側の選択、`LiveMatchReader`の開催中(マッチ中・集計中)の最も新しいマッチ・`awaitingChange`(集計中・キックオフ後の未作成と未開始)・表示できないプロダクトと旧ハンドルのnull、`SupporterListReader`の他のプロダクトの側・確定前のnull、供給元の失敗の縮退(2.11・2.12・4.7・6.6・10.1・10.10)。
  - event(偽の`ProductIndexPendingMarker`・`DirectoryEntryStore`・`SearchIndexRefreshRequester`): `QualifierListingHandler`の勝った側だけ・紐付けの無い側の除外、`ProductIndexRestoreHandler`の記録のあるプロダクトだけの更新待ち、`AccountIndexRestoreHandler`の100件ずつ(12.2・12.6)。
  - client(`live-match-refresh.ts`・`product-page-section-order.ts`・`graphql/product-page.ts`): オン・オフと`LIVE`・`awaitingChange`・上限の回数ごとの取り直しの間隔と案内への切り替え、置き場所ごとの並べ替え、開催中のマッチの差し替え。
  - 識別子(`core/directory/identifiers.unit.test.ts`): `DIRECTORY_PLATFORM_TYPES`が`Symbol.for('directory.<名前>')`の値を持ち凍結されていること(`core/media/identifiers.unit.test.ts`と同じ形)。
  - 層の規則: api・eventの静的解析で、application層に`**/lib/workers/**`の読み込みが無いこと(型だけの読み込みを含む)。
- Integration Tests(Vitestのworkerd、`*.worker.test.ts`、ローカルD1):
  - `DirectoryListingQuery`: 掲載の条件(退会・停止・非公開化・論理削除・敗北と両者敗北だけ・トーナメントの勝利だけ)、2回勝利したプロダクトが1項目で直近が基準勝利、期間の開始日・終了日と同じ日の勝利・期間外の勝利だけのプロダクトの除外、期間内の古い勝利が基準勝利になること、4つの並び順と同順位、20件目と21件目のページの境界と件数、カテゴリの絞り込み、検索の前方一致・大文字小文字・全角半角・発音区別符号・構文の文字列化・関連度の順、`countByCategory`(1.1〜1.4・1.6〜1.8・3.6・4.1・4.2・5.2〜5.5・6.1・14.2)。
  - 検索対象: 掲載中だけを`read`し、未掲載・非公開・停止で`undefined`と`isIndexable`が偽、content-processingの処理で索引が作られ名称の前方一致で検索でき、説明文のキーワードでも一致すること(抽出は固定の結果の偽物)(4.1・12.1)。
  - 同期の処理(既存の登録口のテスト`product-lifecycle-sync-handlers.worker.test.ts`・`product-save-hooks.worker.test.ts`の期待値に本specの登録を加える): product-launchの非公開化・削除の確定で索引文書が同じ書き込みで消え、確定の失敗で文も取り消されること、identity-authの退会・停止の確定で投稿者の全ての索引文書が消えること(12.4・12.5)。
  - 更新待ちの書き込み: `D1ProductIndexPendingMarker`が索引文書の無いプロダクトに空の更新待ちの行を作り、既存の行を更新待ちにし、100件を1回の一括の書き込みで書き、空の配列では書き込まないこと(12.2・12.6)。
  - 非同期の処理とマッチイベント: match-engineの`decided`の処理の後に`directory_entries`ができ索引が作られること、復元・停止の解除で作り直されること、プロダクトの`purge_due`で記録と索引文書が消えproduct-launchの物理削除が外部キーで失敗しないこと(1.5・12.2・12.6・12.7・13.2)。
  - 保存の登録(仮4、apiの`infrastructure/directory/product-index-refresh-save-hook.ts`): product-launchの`D1ProductStore`を通した掲載中のプロダクトの編集で同じ書き込みに更新待ちが入り、確定の後に要求が送られ、未掲載のプロダクトでは入らないこと(12.3)。
  - スキーマモジュール: `directory`の正規化と`applied`、`productPage`の404・302・本人の未掲載、`productLiveMatch`の開催中のマッチをmatch-engineの`Match`で返すこと(閲覧者のUpvote)・`serverTime`・`awaitingChange`・表示できないプロダクトのnull、`matchSupporters`の退会・停止の除外とUpvoteの日時の順と21件目のカーソル、`client`以外の拒否(6.\*・8.\*・10.9・10.10)。
- E2E/UI Tests:
  - ブラウザテスト(`*.browser.test.tsx`、`runAxe`の違反0件): `SearchForm`(カウンター・50超の拒否・Enter)、`CategoryPicker`(キーボード・絞り込み)、`PeriodRangeForm`(未来・逆順・片方だけ)、`SortSelect`(関連度の無効と併記)、`DirectoryItem`・`WinSummary`(本人・強調・3種の勝利・項目の値の登録)、`DirectoryPagination`(省略の規則・768px未満)、`DirectoryPage`(初回・再読み込み・エラー・0件2種・範囲外・区画の失敗の閉じ込め)、`ProductPage`(区画の順と失敗の閉じ込め・1カラム・自動更新の切り替えの描く条件(ページ自身の値・区画の申告・申告した区画の失敗)・`data-auto-refresh`)、`LiveMatchSection`と`ProductPage`の取り直し(013の「テスト」に従い`Date`・`setTimeout`・`clearTimeout`・`setInterval`・`clearInterval`を偽にし、`notifyManager.setScheduler(queueMicrotask)`で、オフの後に定期の取得が無いこと、`endsAt`の1秒後の取り直し、結果を待つ取り直しが上限まで続き、オフの時だけ`role="status"`が案内に替わること、確定で詳細ページの取得が無効になること、Upvoteの結果の差し替え)、演出(`emulateReducedMotion`・オフ・開催中のマッチが無い時に目印の要素にアニメーションが掛からない)、`Card`(frontend-lib、部分の要素と属性・ライト・ダーク)、移した`AutoRefreshSwitch`・`FullTimeCountdown`(既存のテストを移して成功)、`ProductHeader`(成績・本人にフォローなし)、`ScreenshotLightbox`(左右キー・位置表示)、`MatchHistoryRow`(接戦・不戦勝・早期・非公開のプロダクト)、`SupportersPanel`(続きの読み込み・失敗)、`EmptyMatches`、`OwnerCard`(禁止・間隔・固定・照会の失敗)。
  - E2E(`e2e/client/directory.e2e.test.ts`): identity-authの`e2e/support/mailpit.ts`で確認済みの利用者を3人登録し(メールアドレスのドメインは`.example`)、2人がproduct-launchの画面でプロダクトを登録する。`e2e/support/directory-fixtures.ts`(admin-foundationの`executeLocalD1`。match-engineの`e2e/client/match-steps.ts`の手順(`moveLaunchesToDate`・`startQualifiers`など)で足りる部分はそれを使う)で2つのローンチのマッチ中の予選(終了の日時を過去)を作り、backend-platformの改訂2の`triggerScheduled({ worker: 'api', businessDate: <当日の業務日付>, businessTime: '23:40' })`で23:40の確定のジョブを動かして(独自の定期実行の起動の補助は作らない)、確定のイベント・予選の結果の記録・本specの掲載と索引の処理を実際の経路で動かす。一覧のページのために、可視の投稿者・プロダクト・確定したマッチとローンチの結果を直接作る補助で21件の掲載中のプロダクトを追加する。ディレクトリで勝ったプロダクトが表示されること、名称の検索(索引の作成を待つ)・カテゴリの絞り込み・「Upvote数が多い順」・2ページ目への移動と`page`のクエリ、詳細ページのマッチ履歴とサポーター(3人目のUpvote)、敗けたプロダクトが他者には404で投稿者本人には未掲載の案内付きで見えること、プロダクトのハンドルを変えた後に旧ハンドルのURLが現在のURLへ転送されることを確かめる(14.3)。

## Security Considerations

- 公開範囲: 詳細ページ・サポーターの一覧は同じ判定(`decideProductPageAccess`)で返し、未掲載のプロダクトの情報は投稿者本人にだけ返す。404は理由を区別しない(8.4)。旧ハンドルは表示できるときだけ転送し、非公開のプロダクトの現在のハンドルを漏らさない(8.6)。
- 検索の構文注入: 検索式は`buildFtsMatchExpression`で語ごとに引用符で囲み、バインド変数で渡す(4.2、FR-FTS-002)。並び順・カテゴリは列挙とIDの解決を経てから問い合わせに入れる。
- XSS: 説明文はcontent-processingの描画とサニタイズを経る。外部WebサイトURLは`checkExternalUrl`が`ok`のものだけをリンクにする(2.6)。名称・タグラインはReactのテキストとして描く。
- 情報の推測の防止: マッチ履歴の対戦相手の非公開・削除は「非公開のプロダクト」として理由を出さない(10.3)。サポーターの一覧に退会・停止の利用者を出さない(10.10)。
- データ最小化: 索引文書は掲載中のプロダクトだけで、公開を止めると同じ書き込みで消える(12.4・12.5)。ログに検索語・名称・ハンドルを含めない(13.3)。

## Performance & Scalability

- ディレクトリの1回の取得は、一覧と件数の一括の読み取り1回・カテゴリの解決1回・プロダクトの照会1回・マッチの照会1回・ローンチの照会1回・供給元の呼び出し・利用者と画像とカテゴリのローダー1回ずつで、項目の数に比例した問い合わせをしない(13.4)。
- 一覧の問い合わせは予選の勝利の数に比例して読み取りが増える。期間の条件を窓関数の前に掛け、launch-readinessの性能の検証で10万件の勝利の合成データでNFR-PERF-007(95パーセンタイル300ms)を確かめる(research.mdのRisks)。
- 詳細ページは、プロダクト・詳細・ローンチ・マッチ・対戦相手の照会を各1回で読む。定期の取り直しは`productLiveMatch`(プロダクト・ローンチ・マッチの照会を各1回)だけに重ね、開催中のマッチか変化を待つ状態がある間だけ動く。1つのタブが`LIVE_REFRESH_INTERVAL_MS`ごとに1回取得し、中継の経路のIP制限の回数に数えられる(010)。サポーターの一覧は20件ずつで、側の索引の範囲だけを読む(match-engine)。
- 初回の表示はサーバーで描画し(NFR-PERF-001)、ディレクトリの条件の変更は直前の結果を残したまま取り直す。

## Migration Strategy

- 新しいテーブルと全文検索の索引を足すだけのExpandの変更で、既存のデータの移行は無い。
- 一覧は上流のデータを問い合わせで結合するため、本specのデプロイの前に勝利したプロダクトもそのまま一覧に載る。ただしstagingでデプロイの前に勝利したプロダクトは`directory_entries`と索引文書を持たず、編集・復元・停止の解除まで検索にかからない。stagingのデータは検証用のため移行の処理を作らず、運用の報告に載せる。本番は全spec完了後の初回のリリースでデータが無いため影響しない。
- 新しいシークレット・変数・パッケージは無い。

## Supporting References

### 本specが定める固有の値

| 項目                   | 値                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ユーザーの波及処理     | `directory-discovery.account-index-removal`(同期、`withdrawn`・`suspended`)、`directory-discovery.account-index-restore`(`unsuspended`、1200)                                                        |
| プロダクトの処理       | `directory-discovery.product-index-removal`(同期、`deleted`・`hidden`)、`directory-discovery.product-index-restore`(`unhidden`、1200)、`directory-discovery.entry-erasure`(`purge_due`、1200)        |
| マッチイベントの処理   | `directory-discovery.qualifier-listing`(`decided`・予選、1200)                                                                                                                                       |
| 保存の登録(仮4)        | `directory-discovery.product-index-refresh`                                                                                                                                                          |
| 検索対象               | `product`(索引文書`product_search_documents`、重みは名称10・タグライン5・キーワード1)                                                                                                                |
| 登録口と`order`        | `PRODUCT_PAGE_SECTIONS`の`directory-discovery.screenshots`(main 20)・`directory-discovery.description`(main 30)・`directory-discovery.match-history`(main 40)・`directory-discovery.owner`(aside 10) |
| 上限                   | 1ページ20件、検索語50書記素(40からカウンター)、サポーター20件ずつ、停止の解除の作り直し100件ずつ(1回の実行で全件)                                                                                    |
| 技術ドキュメントの番号 | `db/007-latest-row-per-group-listing.md`・`frontend/014-url-state-listing.md`                                                                                                                        |
