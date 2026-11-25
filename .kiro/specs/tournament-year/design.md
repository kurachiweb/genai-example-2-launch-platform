# Design Document

## Overview

**Purpose**: Product of the Weekの優勝作によるProduct of the Year決定トーナメント(Yearトーナメント)と、その決勝実施日の設定を実装する。最上位管理者が管理画面の設定ページで年ごとの決勝実施日(日曜日)を設定し、未設定なら5月の最終日曜日とする。決勝日から逆算した期限を年の行に保存し、Week優勝ごとに参加の枠を作り、決済期限までの参加費の決済(paymentsの購入種別`year_tournament_entry`)またはUltrasの特典による免除で参加資格を与える。決勝日の6日前の23:45に年のトーナメントを凍結して枠を分類し(非公開化・停止・参加数の上限による除外を含む)、tournament-weekの汎用のブラケットで組み合わせを決め、決勝日から逆算した日に1回戦を行い、1日1ラウンドで決勝日にProduct of the Year賞を授与する。

**Users**: Week優勝の投稿者は、プロダクト詳細ページと自分のプロダクトの画面で参加費を支払い、状態を確かめる。閲覧者はトップページでYearトーナメントのマッチを見てUpvoteし、ブラケットのページで組み合わせと結果を見て、プロダクト詳細ページでトロフィーを見る。最上位管理者は管理画面の`/settings`で決勝実施日を設定し、他の管理者は参照する。後続spec(ugc-moderation・data-export)の開発者は、除外と返金の扱いと受賞のエクスポートの部品を使う。

**Impact**: D1に2テーブル(年のトーナメント・参加の枠、`apps/db/schema/tournament/`)を足す。`apps/backend-lib/core/year-tournament`(規則と、application層が受け取る契約と識別子)・`workers/year-tournament`(契約の実装と、apiとeventの両方への束縛)を新設する。apiにスキーマモジュール`year-tournament`・2つのジョブ(23:45の夜の処理と夜の送り出しの準備の完了の通知、4:21の再処理)・判定の供給元3つ・トロフィーの供給元1つ・決勝実施日の照会と保存を、eventにマッチイベント・ライフサイクル・Ultrasの知らせの処理と結果通知の追記とメールのテンプレートを、clientにトップページの2区画・ブラケットのページ・投稿者本人向けの操作・自分のプロダクトの区画・削除の注意書きを、adminに設定ページの決勝実施日の区画を足す。上流のファイルは、契約で定められた登録箇所への追記に加え、実装前のギャップ分析の決定(G2〜G6)により、tournament-weekの規則と画面部品のうちYearと共用するもの(並びの規則・返金の依頼の拒否の写像・違反を除いた通知の発行・clientのトップページの区画とブラケットのページと参加費の導線の部品)と、業務日付の日数の計算を、種類によらない共用の部品へ移して既存の参照を書き換える(Weekの振る舞いは変えない)。新しいシークレット・パッケージ・メッセージ種別・Cronの式は無い。

### Goals

- FR-TOURY-001〜030・FR-ADMCF-001〜003・006・007と、Yearトーナメントに関わるFR-PYMNT-010・FR-PPLAN-006・008・FR-RELCH-004・FR-PRDCT-014・FR-NOTIF-001・004・006・007・FR-ADMAG-001が、決勝日の設定→Week優勝の参加の枠→決済または免除→凍結と分類→組み合わせ→決勝日に向けた1日1ラウンドの進行→終了と賞、削除・退会・停止・非公開化・上限超過・Ultrasの加入・決済の反映の遅れ・決勝日の変更のどの経路でも、要件と仮1〜仮8の決定に一致する。
- シード・組み合わせ・進行・不戦勝の規則と記録を実装せず、tournament-weekの部品を使う。
- Weekと同じ規則・画面をYearのために複製せず、種類によらない共用の部品へ移して両方で使う(G2〜G6)。移した後もWeekの振る舞い・文言・テストの期待値は変えない。
- 本specが追加・変更したコードの単体テスト・Workers統合テスト・ブラウザテストがカバレッジ80%を満たす。

### Non-Goals

- ブラケットの汎用の規則・記録・進行、Weekトーナメント、Week優勝の記録、トロフィーの区画そのもの(tournament-week)。
- マッチの記録・Upvote・開始と確定・即時の終了と開始時点の決着(match-engine)。
- Stripeとの通信・決済画面・突合・反映の期限切れと二重決済の返金・返金の実行(payments)。通知の対象者と送信(notifications)。特典の判定と設定ページの枠(ultras-subscription)。管理者の認可・監査ログの記録と閲覧(admin-foundation)。停止・非公開化の操作(ugc-moderation)。
- 要件定義書の改訂(roadmapのOut。必要な改訂は[research.md](research.md)の「要件定義書の改訂が必要な箇所」に記録した)。(2026-10-25に要件定義書へ適用済み)

## Boundary Commitments

### This Spec Owns

- Yearのデータ: `year_tournaments`(年ごとの決勝実施日・期限・凍結と進行の状態・受賞)・`year_tournament_entries`(Week優勝ごとの参加の枠、参加資格の出どころ・返金の依頼と知らせの状態)(`apps/db/schema/tournament/`のYearの2ファイル。tournament-weekと同じトーナメントのドメインのディレクトリ、G8)。
- Yearの規則(`apps/backend-lib/core/year-tournament/`): 既定の決勝日と決勝日からの期限・1回戦の日、選べる決勝日と検証、対象年の判定、参加数の上限、枠の状態と返金の理由・依頼キー。返金の知らせのメール種別`tournament-year.entry-refund`は`core/email/kinds/tournament-year.ts`に置く(email-deliveryの置き場所の規約)。
- Yearの共有部品: 契約(`YearTournamentStore`・`YearEntryStore`・`YearCalendar`・`YearEntryRegistrar`・`YearDrawService`・`YearProgressionService`・`YearEntryFollowUp`・`YearNotificationPublisher`・`YearAwardExport`とその入出力の型)は`apps/backend-lib/core/year-tournament/ports.ts`、DIの識別子`YEAR_TOURNAMENT_TYPES`は`core/year-tournament/identifiers.ts`に置き、それらの実装と、paymentsの購入種別の口の実装`YearEntryOfferPolicy`・`YearEntryFulfillment`と購入種別の登録の定数`YEAR_TOURNAMENT_PURCHASE_KIND_REGISTRATION`と束縛のモジュールを作る関数`createYearTournamentPlatformModule(appName)`は`apps/backend-lib/workers/year-tournament/`に置く。api・eventとdata-exportのapplication層が契約と識別子を読み込むため、契約を`workers`に置かない。
- 共用へ移す部品(G2〜G6。移した後の所有はトーナメント・通知・業務時刻の共用の部品で、本specは移設と既存の参照の書き換えを行う): `core/tournament/launch-ordering.ts`(シード・非シードの並び)・`core/tournament/refund-rejection.ts`(返金の依頼の拒否の写像)・`core/notifications/violation-tolerant-publish.ts`(違反を除いた通知の発行)・`core/time/business-time.ts`の`addBusinessDays`・`businessWeekdayOf`の公開・clientの`components/tournament/`(トップページの区画・決勝の演出・ブラケットのページ・参加費の導線の種類によらない部品)。
- apiのスキーマモジュール`year-tournament`、照会(トップページ・ブラケット・参加費の導線・決勝実施日)、参加の決済の開始、決勝実施日の保存と監査ログ、判定の供給元3つ、トロフィーの供給元`tournament-year.year-trophies`、ジョブ`tournament-year.evening-bracket`(23:45、1700)・`tournament-year.entry-follow-up`(4:21、1700)とその失敗の通知のポート`YearTournamentIncidentReporter`、notificationsの夜の枠の送り出しの前提の登録`tournament-year.evening-bracket`(`EVENING_DISPATCH_PARTICIPANTS`)。
- eventの処理: マッチイベント`tournament-year.week-champion-entry`(`decided`・`week`、1700)・`tournament-year.decided-round-progress`(`decided`・`year`、1710)、プロダクトライフサイクル`tournament-year.product-entry-loss`(`deleted`、1700)・`tournament-year.entry-unlink`(`purge_due`、1700)、ユーザーライフサイクル`tournament-year.account-entry-loss`(`withdrawn`、1700)、Ultrasの知らせ`tournament-year.ultras-entry-exemption`(1700)・`tournament-year.open-entry-checkout-expiry`(1710)、結果通知の追記`tournament-year.entry-deadline`(`week`、1700)、返金の知らせのテンプレート(`templates/tournament-year/`)。
- clientの`/tournaments/year/$year`、トップページの区画`tournament-year.matches`(`main` 10)・`tournament-year.final`(`showcase` 10)、プロダクト詳細の投稿者本人向けの操作`tournament-year.entry`(20)、自分のプロダクトの`tournament-year.entry`(20)、削除の注意書き`tournament-year.entry-loss`(20)。Yearの部品は`components/year-tournament/`の薄い包みで、描画と規則は`components/tournament/`の共用の部品が行う。
- adminの設定ページの区画`tournament-year.final-date`(10、部品は`components/year-tournament/`、G9)と監査ログの操作種別`year-final-date.update`。
- 技術ドキュメント`backend/019-anchor-date-schedules.md`の新規作成と`frontend/012-business-date-calendar.md`への「サーバーが返す候補から選ばせる日付」の節の追記(G7)、サービス仕様(Yearトーナメント規則・日次タイムライン・ページ配置・文言規則)の追記と、返金ポリシー・決済実装方針の一致の確認、オンボーディングの追記。

### Out of Boundary

- `tournament_brackets`・`bracket_participants`・`bracket_matches`とWeekのテーブル、ブラケットの規則・組み合わせの作成・進行・物理削除での参加者の紐付けの解除、Weekの組み合わせ決定・進行・返金・画面の振る舞い(tournament-week)。本specは`BracketDraw`・`BracketProgression`で書き、`BracketStore`は読むだけにする。Week優勝は`WeekChampionDirectory`で読むだけにする。G2〜G6で共用へ移す部品も、Weekの振る舞い・文言・データを変えない。
- `matches`などマッチのデータ・マッチの開始と確定・開始時点の決着・即時の終了(match-engine)。
- `products`・`product_launches`・再ローンチの判定の本体・削除と非公開化の確定(product-launch)。
- 決済のデータ・Stripe・突合・反映・返金の実行と決済履歴(payments)。Ultrasの加入状態と特典の判定・設定ページの枠とメニュー(ultras-subscription)。管理者のデータ・認可の判定・監査ログの保存と閲覧(admin-foundation)。通知の対象者・受信可否・送信の時刻と統合(notifications)。停止・非公開化の操作(ugc-moderation)。データエクスポートのZIP(data-export)。

### Allowed Dependencies

- backend-platform: `AppModule`・`PLATFORM_TYPES`(`Database`・`Clock`・`IdGenerator`)・`AppError`・`getAppLogger`・`captureEvent`による定型の通知の規約(`infra/004`の「同じ文言を繰り返し送る通知」。文言は`logentry`、まとめる単位は`fingerprint`に置く)・`ulidPrimaryKey`・`timestamps`・`BusinessTime`(`toBusinessDateTime`・`fromBusinessDateTime`・`parseBusinessDate`・`BusinessDate`・`BusinessTimeOfDay`・`IsoWeekday`、本specが公開する`addBusinessDays`・`businessWeekdayOf`)・`ScheduledJobDefinition`・`ScheduledJobHandler`・`SCHEDULED_RUN_BUDGETS`(23:45の起動の予算)。`core/time`への関数の公開(G5)の他は形を変えない。E2Eの`e2e/support/scheduled-trigger.ts`の`triggerScheduled`(backend-platformの改訂2。ローカルの定期実行の起動は独自に作らない)。
- api-gateway: `defineSchemaModule`・`GraphQLContext`(`resolve`・`session`・`caller`・`loaders`)・`withValidatedArgs`(違反は`AppError{ kind: 'bad_request', code: 'validation_error' }`)・`DateTime`。
- identity-auth: `AccountGuard`(`requireUser`)・`CurrentUser`・`users`(外部キーだけ)・`UserLifecycleAsyncRegistration`・`USER_LIFECYCLE_ASYNC_HANDLERS`・`LifecycleHandlerOutcome`・`assertLifecycleHandlerName`・`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`。契約と識別子は`core/identity`)。
- admin-foundation: `requireAdmin`・`AuditLogRecorder`・`PreparedAuditEntry`・`buildAuditLogStatements`・`defineAuditAction`・`AUDIT_ACTIONS`・`AdminDirectory`(契約と識別子は`core/admin`)・`AdminRole`・adminの`RoleGate`・`ConfirmActionDialog`、E2Eの`e2e/support/admin-bootstrap.ts`(`signInAsNewAdmin`)・`e2e/support/local-d1.ts`(`executeLocalD1`・`sqlStringLiteral`)。
- tournament-week(実装済み): `core/tournament`の規則(`bracketShape`・`dailyRoundPolicy`・`RoundSchedulePolicy`・`Comparator`・`DrawOrder`・`DrawCandidate`、本specが移す`launchSeedOrder`・`launchNonSeedOrder`・`LaunchOrderingKey`・`refundRejectionOutcome`・`RefundRejectionCode`・`RefundRejectionOutcome`)と契約と識別子(`core/tournament/ports.ts`・`identifiers.ts`の`TOURNAMENT_PLATFORM_TYPES`・`BracketDraw`・`BracketProgression`・`AdvanceResult`・`BracketDrawCandidate`・`BracketParticipantInput`・`BracketRecord`・`BracketStore`の読み取り(`findByTournament`・`findById`・`findByMatchIds`・`findAliveRefs`・`findParticipantStandings`))、`core/week-tournament`の`WEEK_TOURNAMENT_TYPES.WeekChampionDirectory`・`WeekChampion`(`tournamentId`・`weekStart`・`productId`・`launchId`・`ownerUserId`・`awardedAt`。実装は`workers/year-tournament`だけが受け取る)、apiの`TrophySource`・`TrophyRecord`・`TrophySourceRegistration`・`TOURNAMENT_TROPHY_SOURCES`・GraphQLの`BracketRound`・`BracketNode`・`BracketSlot`・`TrophyKind`、`common-lib/tournament`の`tournamentRoundName`・`formatWeekPeriodLabel`・`isoWeekKey`、apiの`buildBracketRoundsView`・`BracketRoundsView`(`apps/api/src/application/tournament/bracket-view-builder.ts`の純粋な関数。DIに束縛しない)、clientの`components/bracket/`(`BracketRoundColumn`・`BracketRoundTabs`・`BracketMatchCard`・`BracketChampion`と引数の`BracketViewProps`)と`src/graphql/fragments/bracket/`のフラグメント`BracketRoundFields`(`BracketRound`)・`BracketMatchProductFields`(`MatchProduct`。型は`src/graphql/generated/graphql.ts`の`BracketRoundFieldsFragment`・`BracketMatchProductFieldsFragment`)、本specがWeekの部品から移すclientの`components/tournament/`。`core/year-tournament`・`workers/year-tournament`は`core/week-tournament`の`WeekChampionDirectory`・識別子の他を読み込まず、`workers/week-tournament`・`workers/tournament`の実装を読み込まない。
- match-engine: `MATCH_PLATFORM_TYPES`の`MatchDirectory`(`findQualifierResults(launchIds)`・`findMatches(matchIds, now)`・`listForDate({ date, kinds, now })`・`listByLaunches(launchIds, now)`。契約と識別子は`core/match`)、`MatchKind`・`MatchStage`・`EntryResult`・`isWinningResult`・`MATCH_SCHEDULE`・`matchWindow`・`MatchEvent`(`id`・`matchId`・`kind`・`type`・`occurredAt`)・`MatchEventHandler`・`MatchEventRegistration`・`MATCH_EVENT_HANDLERS`、apiの`MatchViewReader`・`matchViewLoader`(`loadMatchView`)・GraphQLの`Match`・`MatchProduct`・`MatchBye`、clientの`TOP_PAGE_SECTIONS`・`TopPageSection`・`TopPageSectionContext`・`MatchCard`・`ByeList`・`useUpvote`・`follow-up-refetch.ts`・`LIVE_REFRESH_QUERY_OPTIONS`・フラグメント`Match`・`MatchBye`。
- payments: `PurchaseKindRegistration`・`PurchaseOfferPolicy`・`PurchaseOffer`・`PurchaseOfferDecision`(`unavailable`は`code`と`message`)・`PurchaseFulfillment`・`FulfillablePurchase`・`FulfillmentPlan`・`PURCHASE_KIND_REGISTRATIONS`(登録の定数を読み込む形)・`PaymentRefunds`(`RefundRequestResult`の拒否5種類)・`OpenCheckoutExpirer`・`PriceCatalog`・`PAYMENTS_TYPES`・apiの`CheckoutStarter`・GraphQLの`CheckoutStart`・`Money`・frontend-libの`MoneyText`、common-libの`PURCHASE_KINDS`(`year_tournament_entry`は追加済み)。`PurchaseOfferPolicy`・`PurchaseOffer`・`PaymentRefunds`・`OpenCheckoutExpirer`は`core/payments`の契約、文を返す`PurchaseFulfillment`・`FulfillmentPlan`は`workers/payments`の契約で、後者は`workers/year-tournament`の`YearEntryFulfillment`だけが使う。
- ultras-subscription: `ULTRAS_TYPES.UltrasEntitlements`(`wasEntitledDuring`・`entitledUsersDuring`。契約と識別子は`core/ultras`)・`UltrasActivation`・`UltrasActivationHandlerRegistration`・`ULTRAS_ACTIVATION_HANDLERS`・adminの`AdminSettingsSection`・`ADMIN_SETTINGS_SECTIONS`。
- notifications: `NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate`(apiだけ)・`EveningDispatchGate.markReady`・`EveningDispatchReadiness`・`EveningDispatchError`・apiの`EVENING_DISPATCH_PARTICIPANTS`(`apps/api/src/composition/evening-dispatch-participants.ts`)、`NOTIFICATIONS_PLATFORM_TYPES.NotificationEventPublisher`(契約と識別子は`core/notifications`)・`NotificationEvent`・`NotificationPublishError`(`reason`・`eventIndex`)・`NOTIFICATION_PUBLISH_EVENT_LIMIT`・本specがWeekの処理から移す`publishExcludingViolations`・`ResultNoticeSupplementProvider`・`ResultNoticeSupplementInput`・`ResultNoticeSupplementRegistration`・`RESULT_NOTICE_SUPPLEMENTS`。
- product-launch: `ProductDirectory`(`findSummaries`・`listLaunches`・`resolveHandle`)・`PRODUCT_PLATFORM_TYPES`(契約と識別子は`core/product`)・`products`・`product_launches`への外部キー・`ProductLifecycleAsyncRegistration`・`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`・`RelaunchConditionSource`・`ProductLockSource`・`LaunchSummarySource`・`DecisionSourceRegistration`・3つの登録口、clientの`MY_PRODUCT_SECTIONS`・`MyProductSection`・`PRODUCT_DELETE_NOTICES`・`ProductDeleteNotice`。
- directory-discovery: `PRODUCT_OWNER_ACTIONS`・`ProductOwnerAction`。
- email-delivery: `defineEmailKind`・`AnyEmailKind`・`EMAIL_KINDS`(`core/email/kinds/<ドメイン>.ts`の一覧を`index.ts`が連結する)・`EmailSender`・`EMAIL_TYPES`・`defineEmailTemplate`・`EMAIL_TEMPLATES`(`templates/<ドメイン>/index.ts`の一覧を連結する)・`formatUtcDateTime`。
- frontend-platform: `executeGraphQL`・`graphqlQueryOptions`・`GraphQLClientError`・`errorMessageOf`・`buildPageHead`(clientは`head/page-heads.ts`の組み立てへ追記する)・`NotFoundView`・clientの既存の部品(`components/pages/not-found-page.tsx`の`NotFoundPage`・`components/time/use-boundary-refresh.ts`の`useBoundaryRefresh`・`components/match/use-server-countdown.ts`の`useServerCountdown`)・`ErrorState`・`PartialErrorState`・`UnavailableNotice`・`LoadingSkeleton`・`notify`・`DateTime`・`RelativeTime`・shadcn/uiの部品(ボタン・バッジ・セレクト・テキストエリア)・`runAxe`・デザイントークン、adminの`ADMIN_PROFILE`(`contactAvailable`)、GraphQLの操作の追加手順(`src/graphql/operations/**/*.graphql`・操作名の接頭辞`Client`・`Admin`・`src/graphql/generated/graphql.ts`の生成物)。
- npmパッケージ: 新規なし。
- 後続spec(data-export)は`core/year-tournament`の`YearAwardExport`と識別子`YEAR_TOURNAMENT_TYPES`だけを使う。ugc-moderationは停止・非公開化をidentity-auth・product-launchのライフサイクルで発火すればよく、本specを直接呼ばない。

### Revalidation Triggers

- `year_tournaments`・`year_tournament_entries`の列・状態の値・`classified_year`の意味(data-export・ugc-moderation)。
- `YearAwardExport`の形(data-export)。
- `core/year-tournament`の契約(`YearTournamentStore`・`YearEntryStore`・`YearCalendar`・`YearAwardExport`など)と`YEAR_TOURNAMENT_TYPES`の置き場所。application層が`**/lib/workers/**`を読み込めない規則(backend-platform)が変わっても、置き場所を`workers`へ戻さない(本specとdata-exportのapplication層が読み込むため)。
- ジョブ・処理の名前と`order`(23:45のジョブは1700、処理は1700・1710)、23:45の順序(tournament-weekの`tournament-week.evening-bracket`(1500)の後)、夜の枠の送り出しの前提の名前`tournament-year.evening-bracket`と`markReady`を呼ぶ時点(notifications・tournament-week)。
- 購入種別`year_tournament_entry`の`PurchaseOffer`の期限の値・`exclusivityKey`・返金の依頼キーと理由の値(payments・ugc-moderation)。
- `LaunchSummaryContribution`の`rank`(60〜100)と文言(directory-discovery・product-launch)。
- 監査ログの操作種別`year-final-date.update`の詳細の鍵(admin-foundation)。
- 仮1〜仮8(2026-10-24に開発者が確定)の決定を変えるときは、該当する規則(`resolveTargetYear`・`checkFinalDateChoice`・`selectWithinCapacity`・`YearDrawService`の分類・`YearEntryFollowUp`・`/tournaments/year/$year`・`YearEntryFulfillment`の新しいローンチの検査)を確かめ直す。
- 上流のtournament-weekの`BracketDraw.create`・`BracketProgression.advance`・`AdvanceResult`・`dailyRoundPolicy`・`BracketStore`・`WeekChampionDirectory`・`TrophySource`・`buildBracketRoundsView`・`BracketRoundsView`・`BracketRoundFields`・`BracketMatchProductFields`・`BracketViewProps`(`rounds`・`champion`・`awarded`・`finished`)・`components/bracket/`の4部品の形(tournament-weekの仮7)、`BracketStore.unlinkProduct`が種類によらず解除する規則、match-engineの`MatchDirectory`・`MATCH_EVENT_HANDLERS`の直列の実行・`TOP_PAGE_SECTIONS`・`MatchCard`・`ByeList`、paymentsの購入種別の口・`PaymentRefunds`・`OpenCheckoutExpirer`、`UltrasEntitlements`・`UltrasActivationHandlerRegistration`・`ADMIN_SETTINGS_SECTIONS`、`requireAdmin`・`AuditLogRecorder`・`buildAuditLogStatements`、`NotificationEventPublisher`・`ResultNoticeSupplementRegistration`・`EveningDispatchGate.markReady`の形と`EVENING_DISPATCH_PARTICIPANTS`・23:55の期限(notificationsの仮2)、product-launchの3つの供給元の契約・`ProductDirectory`・ライフサイクルの登録口・`MY_PRODUCT_SECTIONS`・`PRODUCT_DELETE_NOTICES`、directory-discoveryの`PRODUCT_OWNER_ACTIONS`の形を変えたら、本specを確かめ直す。
- 本specが共用へ移す部品(`launchSeedOrder`・`launchNonSeedOrder`・`refundRejectionOutcome`・`publishExcludingViolations`・`addBusinessDays`・`businessWeekdayOf`・clientの`components/tournament/`の部品と引数の型)の形を変えるときは、WeekとYearの両方の利用を確かめ直す。`backend/017`の発行と記録の順序・返金の後処理の規約が変われば、`YearProgressionService.applyResult`・`YearEntryFollowUp`を確かめ直す。
- backend-platformの改訂2の`triggerScheduled`の引数(`worker`・`businessDate`・`businessTime`)と業務時刻の規則が変われば、E2Eの補助と時刻を進める手順を確かめ直す。

### 上流への影響

| 上流spec            | 変更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 影響と再検証                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tournament-week     | (1)apiの`composition/tournament-trophy-sources.ts`に`tournament-year.year-trophies`(10)。(2)G2: `core/week-tournament/week-ordering.ts`を`core/tournament/launch-ordering.ts`へ移し(`weekSeedOrder`→`launchSeedOrder`・`weekNonSeedOrder`→`launchNonSeedOrder`・`WeekOrderingKey`→`LaunchOrderingKey`)、`workers/week-tournament/week-draw-service.ts`の参照と単体テストを移す。(3)G4: `core/week-tournament/week-entry-rules.ts`の`refundRejectionOutcome`・`WeekRefundRejectionCode`・`WeekRefundRejectionOutcome`を`core/tournament/refund-rejection.ts`の`refundRejectionOutcome`・`RefundRejectionCode`・`RefundRejectionOutcome`へ移し、`workers/week-tournament/week-entry-follow-up.ts`の参照と単体テストを移す。(4)G3: `workers/week-tournament/week-notification-publisher.ts`の非公開の`publishAll`・`publishExcludingViolations`・`violationOf`・`logExcluded`を、`core/notifications`の`publishExcludingViolations`の呼び出しに置き換える。(5)G5: `core/week-tournament/week-schedule.ts`の非公開の`addBusinessDays`と、`core/tournament/round-schedule.ts`の`nextBusinessDate`(公開。`workers/tournament/d1-bracket-progression.ts`・`workers/week-tournament/week-draw-service.ts`・`week-notification-publisher.ts`が使う)を`core/time`の`addBusinessDays`に置き換え、`nextBusinessDate`を削る。(6)G6: clientの`components/week-tournament/`のうち種類によらない部品とモデルを`components/tournament/`へ移し(対応は「clientの共用の部品」の表)、Weekの部品はWeekの照会・文言・経路を渡す包みにする。登録の名前・`order`・文言・GraphQLの操作は変えない | Weekの振る舞い・文言・テストの期待値を変えない。移したモデルと部品の単体テスト・ブラウザテストは移した先へ移し、Weekの包みのブラウザテスト(`week-tournament-section`・`week-final-showcase`・`week-bracket-page`・`week-entry-panel`など)は書き換えずに通ることを確かめる。`docs/onboardings/project-values.md`の`weekSeedOrder`などの名前、技術ドキュメント`backend/017`・`frontend/013`・`frontend/016`の部品の名前と置き場所の記述を合わせる |
| match-engine        | eventの`composition/match-event-handlers.ts`に2件、clientの`composition/top-page-sections.ts`に2件。G5: `apps/api/src/application/match/match-jobs.ts`の非公開の`nextBusinessDate`を`addBusinessDays`に置き換える                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `createMatchEventRegistry`の検証を通る。登録の一覧を確かめる上流のテスト(B-5)を書き換える                                                                                                                                                                                                                                                                                                                                                       |
| payments            | `apps/backend-lib/workers/payments/purchase-kind-registrations.ts`が`workers/year-tournament/year-tournament-registrations.ts`の`YEAR_TOURNAMENT_PURCHASE_KIND_REGISTRATION`を読み込む                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `createPurchaseKindRegistry`の検証を通る。`payments-platform-module.worker.test.ts`の登録の解決の検査にYearを加える                                                                                                                                                                                                                                                                                                                             |
| ultras-subscription | eventの`composition/ultras-activation-handlers.ts`に2件(1700・1710)、adminの`composition/admin-settings-sections.ts`に1件(10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `order`は100以上、区画の10は予約済み。`ultras-module.worker.test.ts`など知らせの処理の一覧を確かめるテストを書き換える                                                                                                                                                                                                                                                                                                                          |
| admin-foundation    | `apps/common-lib/admin/audit-actions/tournament-year.ts`と`index.ts`の連結                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `createAuditActionCatalog`の検査を通る。`index.unit.test.ts`の一覧を書き換える                                                                                                                                                                                                                                                                                                                                                                  |
| notifications       | eventの`composition/result-notice-supplements.ts`に1件(`week`、1700)、apiの`composition/evening-dispatch-participants.ts`に`tournament-year.evening-bracket`の1行。G3: `core/notifications/violation-tolerant-publish.ts`に`publishExcludingViolations`を新設する。G5: `apps/event/src/infrastructure/notifications/evening-collector.ts`の非公開の`nextBusinessDate`を`addBusinessDays`に置き換える                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `evening-dispatch-participants.unit.test.ts`の完全一致の一覧と、夜の送り出しの前提の数で振る舞いが変わる`notifications-module.jobs.worker.test.ts`などを書き換える。技術ドキュメント`backend/016`に共用の発行の関数を記載する                                                                                                                                                                                                                   |
| product-launch      | apiの`composition/product-decision-sources.ts`に3件(1700)、eventの`composition/product-lifecycle-async-handlers.ts`に2件、clientの`composition/my-product-sections.ts`・`product-delete-notices.ts`に各1件(20)。G5: `apps/api/src/domain/product/launch-date-rules.ts`の`addBusinessDays`を削り、`product-purge-orchestrator-job.ts`と単体テストの参照を`core/time`へ移す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 登録の一覧を確かめる上流のテスト(B-5)を書き換える。tournament-weekは10、sponsorshipは30                                                                                                                                                                                                                                                                                                                                                         |
| directory-discovery | clientの`composition/product-page-sections.ts`の`PRODUCT_OWNER_ACTIONS`(20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 予約どおり。`product-section-registries.browser.test.ts`などを書き換える                                                                                                                                                                                                                                                                                                                                                                        |
| identity-auth       | eventの`composition/user-lifecycle-async-handlers.ts`に1件(`withdrawn`、1700)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `user-lifecycle-async-handlers.unit.test.ts`などの一覧を書き換える                                                                                                                                                                                                                                                                                                                                                                              |
| backend-platform    | apiの`composition/scheduled-jobs.ts`に2件(23:45の1700・4:21の1700。式は上流で追加済み)。G5: `core/time/business-time.ts`に`addBusinessDays`・`businessWeekdayOf`を公開する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Cronの式の一致と同じ時刻の`order`の重複の検査を通る。ジョブの一覧を確かめる`apps/api/test/config/*-scheduled-jobs.unit.test.ts`を書き換える。E2Eは共用の補助`triggerScheduled`を変更しない                                                                                                                                                                                                                                                      |
| email-delivery      | `core/email/kinds/index.ts`に`TOURNAMENT_YEAR_EMAIL_KINDS`、eventの`infrastructure/email/templates/index.ts`に`tournament-year/`の一覧                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 1対1の検査を通る。`core/email/kinds/index.unit.test.ts`の一覧を書き換える                                                                                                                                                                                                                                                                                                                                                                       |

- 空の登録口・登録の一覧の完全一致・登録の数で振る舞いが変わることを前提にした上流のテスト(B-5): tournament-weekの登録を名前で参照する上流のテストは約60ファイルある(research.mdの「実装前のギャップ分析」)。各登録のタスクは登録の前に`git grep`で`tournament-week\.`・`WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION`・`EVENING_BRACKET_PARTICIPANT`を参照するテストを洗い出して本specの登録を加え、名前を参照せずに振る舞いで影響を受けるテストを拾うため、完了状態にapiとeventのWorkers統合テストの全件の実行を含める。
- clientの`apps/client/src/components/top/top-page-section-order.unit.test.ts`は`showcase`の`tournament-year.final`を先に用意しており、`main`の並びに`tournament-year.matches`を加える。

- roadmapの帯の割り当ての表の本specの「使用中の値」は「4:21は1700、波及処理は1700」になる(23:45のジョブ1700、プロダクトライフサイクル1700、マッチイベント1700・1710、Ultrasの知らせ1700・1710、結果通知の追記1700)。本specはroadmapを編集しないため、コントローラーへ報告する。

## Architecture

### Existing Architecture Analysis

- 本specが使う上流(dev-tooling・backend-platform・api-gateway・frontend-platform・identity-auth・email-delivery・admin-foundation・payments・ultras-subscription・notifications・product-launch・directory-discovery・match-engine・tournament-week)は実装済みで(tournament-weekは2026-11-17に最終検証GO)、本設計は実装された契約に合わせている(research.mdの「実装前のギャップ分析」)。roadmapが宣言する直接の依存はtournament-weekだが、本specは`PRODUCT_OWNER_ACTIONS`(20)へ登録するため、directory-discoveryも上流として扱う。sponsorshipなど未実装のspecの部品は使わない。
- tournament-weekは、本設計の規約の基になる技術ドキュメント[単一敗退のブラケット](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md)(凍結と分類、発行を記録より先にする、違反を除いた発行、夜の発行と送り出しの準備、返金の後処理)と[トーナメントのブラケットの表示](../../../docs/GUIDES/tech/frontend/016-tournament-bracket-view.md)を作った。Yearはこれらに従う。
- apiはクリーンアーキテクチャ(`domain`→`application`→`infrastructure`・`presentation`→`composition`)、D1の`db.batch()`による1トランザクションの書き込み、`CASE`式のNOT NULL制約の違反による取り消し、Cron Triggers(apiだけ、同じ時刻は`order`の昇順、失敗は次を止めない)を使う。
- tournament-weekのブラケットは種類と識別子で区別され、`BracketDraw.create`(参加者の番号の記録と1回戦の予定)と`BracketProgression.advance`(結果の写し・次ラウンドの予定・終了の確定を冪等に行う)をYearから呼べる。Week優勝は`decided`の処理(1510)・23:45のジョブ`tournament-week.evening-bracket`(1500)で記録され、`WeekChampionDirectory`で読める。
- match-engineのマッチイベントの実行器は、同じイベントに登録された処理を`order`の昇順に直列に動かし、例外の処理より後を止めて再試行する。

### Architecture Pattern & Boundary Map

```mermaid
graph TB
    subgraph AdminWorker[admin worker]
        FinalDateSection[final date settings section]
    end
    subgraph ClientWorker[client worker]
        TopSections[top page year sections]
        BracketPage[year bracket page]
        EntryParts[year entry panel and delete notice]
    end
    subgraph ApiWorker[api worker]
        YearModule[year tournament graphql module]
        Readers[board bracket entry final date readers]
        DecisionSources[relaunch lock summary trophy sources]
        Jobs[evening bracket and follow up jobs]
    end
    subgraph EventWorker[event worker]
        MatchHandlers[champion entry and round progress]
        LifecycleHandlers[entry loss and unlink]
        UltrasHandlers[exemption and checkout expiry]
        Supplement[week final result supplement]
    end
    subgraph BackendLib[backend lib]
        YearRules[year rules]
        YearParts[year tournament parts]
    end
    TournamentWeek[tournament week bracket parts]
    MatchEngine[match engine]
    Payments[payments]
    Ultras[ultras subscription]
    AdminFoundation[admin foundation]
    Notifications[notifications]
    ProductLaunch[product launch]
    FinalDateSection --> YearModule
    TopSections --> YearModule
    BracketPage --> YearModule
    EntryParts --> YearModule
    YearModule --> Readers
    YearModule --> Payments
    YearModule --> AdminFoundation
    Readers --> YearParts
    Readers --> MatchEngine
    Readers --> TournamentWeek
    Jobs --> YearParts
    DecisionSources --> YearParts
    ProductLaunch --> DecisionSources
    MatchEngine --> MatchHandlers
    ProductLaunch --> LifecycleHandlers
    Ultras --> UltrasHandlers
    Notifications --> Supplement
    MatchHandlers --> YearParts
    LifecycleHandlers --> YearParts
    UltrasHandlers --> YearParts
    Supplement --> YearParts
    Payments --> YearParts
    YearParts --> YearRules
    YearParts --> TournamentWeek
    YearParts --> MatchEngine
    YearParts --> Payments
    YearParts --> Ultras
    YearParts --> Notifications
```

**Architecture Integration**:

- Selected pattern: クリーンアーキテクチャ。Yearの規則は`core`の純粋な関数、記録・組み合わせ決定・進行は`core`の契約を`workers`で実装した部品(apiとeventの両方に束縛)、照会と画面の組み立てと決勝実施日の保存はapiのアプリケーション層、ブラケット・マッチ・決済・特典・通知・監査ログは上流の部品越しに使う。
- Domain/feature boundaries: Year固有のデータ(年と枠)だけを本specのテーブルに持ち、ブラケットはtournament-weekの部品越しに書く。マッチの状態はmatch-engine、決済の状態はpayments、Week優勝はtournament-weekが持ち、本specは識別子と確定値の写しだけを持つ。
- Existing patterns preserved: `backend-lib/core/<ドメイン>`の契約と識別子・`backend-lib/workers/<ドメイン>`の実装と共有の束縛、`<spec名>.<名詞句>`の名前、帯の`order`、登録箇所への追記、条件付きの書き込みと`onConflictDoNothing()`による冪等性、`CASE`式による取り消し、期限を行の列に保存して正とする規則(tournament-week)、設定の版の条件付きの保存と監査ログの一体の確定(notifications・ultras-subscription)。
- New components rationale: `YearCalendar`は行の無い年の既定の日と行の列を1つの照会にまとめ、対象年の判定を全ての部品で同じにするため。枠に対象年を保存しないのは、決勝日の変更・初年度・遅れを付け替え無しに扱うため(research.mdの「対象期間の表し方」)。WeekとYearで同じ規則・画面は、種類によらない共用の部品へ移して1か所に保つ(G2〜G6)。
- Steering compliance: D1のストアは`@inject`の明示、`workers/year-tournament`のサービスはtournament-weekと同じく`createYearTournamentPlatformModule(appName)`の`toDynamicValue`で依存とアプリの名前(ロガー)を渡す。D1の制約(`db.batch()`・バインド変数100個以内・`transaction()`を使わない)、800行以内のファイル、1ファイル1コンポーネント、日時の`<time datetime>`、新しいパッケージなし。

**Dependency direction**: `apps/db/schema/tournament`(Yearの2ファイル) → `backend-lib/core/year-tournament` → `backend-lib/workers/year-tournament` → 各アプリの`src`(`application` → `infrastructure`・`presentation` → `composition`)。`core/year-tournament`は`core/tournament`(並び・返金の拒否の写像・ブラケットの形を含む)・`core/time`・`core/payments`の型だけを読み込み、`core/week-tournament`・`workers`・`apps/db`を読み込まない。`workers/year-tournament`は`core/tournament`の契約と識別子・`core/week-tournament`の`WeekChampionDirectory`と識別子・`core/notifications`の`publishExcludingViolations`で上流の部品を受け取り、`workers/tournament`・`workers/week-tournament`の実装とtournament-weekのテーブル定義(`week-tournaments.ts`・`week-tournament-entries.ts`)を読み込まない(`tournament-brackets.ts`への外部キーだけを持つ)。共用へ移した部品(`core/tournament/launch-ordering.ts`・`refund-rejection.ts`、`core/notifications/violation-tolerant-publish.ts`、`core/time`、clientの`components/tournament/`)は種類(`week`・`year`)のどちらにも依存しない。api・eventのapplication層は`**/lib/workers/**`を型も含めて読み込めないため、application層とdata-exportが使う契約と識別子`YEAR_TOURNAMENT_TYPES`は`core/year-tournament`に置き、`workers/year-tournament`には実装と束縛だけを置く(identity-authの`core/identity`と同じ配置)。application層は`core`だけを読み込む。apiのpresentation層の`errors.ts`・`mappers.ts`は、決済の開始の拒否の文言`YEAR_ENTRY_OFFER_REJECTION_MESSAGES`を`workers/year-tournament/year-entry-offer-policy.ts`から読み込む(文言の唯一の出どころを購入の可否の口に置く。tournament-weekと同じ)。client・adminはGraphQLの操作と上流の部品・`components/tournament/`だけを読み込み、clientの`components/tournament/`は`components/week-tournament/`・`components/year-tournament/`を読み込まない。違反はレビューで誤りとして扱う。

### Technology Stack

| Layer     | Choice / Version                                             | Role in Feature                                                           | Notes                                       |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------- |
| Frontend  | TanStack Start・Router・Query・shadcn/ui・lucide-react(上流) | トップページの区画・ブラケットのページ・参加費の導線・管理画面の区画      | 新規パッケージなし                          |
| Backend   | Hono・Inversify・GraphQL Yoga(上流)                          | スキーマモジュール・ユースケース・ジョブ・イベントの処理                  | 既存                                        |
| Data      | Cloudflare D1(Drizzle)                                       | 2テーブル                                                                 | 新規のマイグレーション                      |
| Messaging | Cloudflare Queues・Cron Triggers(上流)                       | 既存のマッチイベント・ライフサイクル・Ultrasの知らせ、23:45と4:21のジョブ | 新しいメッセージ種別・Cronの式なし          |
| External  | Stripe(paymentsの部品越し)                                   | 参加費の決済・返金・未完了の決済の失効                                    | 価格の`lookup_key`は`year_tournament_entry` |

## File Structure Plan

### Directory Structure

```
apps/
├── db/schema/tournament/                                     # tournament-weekと同じトーナメントのドメインのディレクトリ(G8。各ファイルに同名の*.unit.test.ts)
│   ├── year-tournaments.ts                                   # 新規
│   ├── year-tournament-entries.ts                            # 新規
│   └── tournament-year-migration.unit.test.ts                # 新規。生成したマイグレーションのCHECK・一意索引・外部キーの検査(Weekの前例)
├── common-lib/admin/audit-actions/tournament-year.ts         # year-final-date.update(*.unit.test.ts)
├── common-lib/tournament/year-period.ts                      # parseTournamentYear(1年以後の4桁の年の解析。clientの経路・apiのブラケットの照会・notificationsの期間の表記と通知イベントの検査が使う、*.unit.test.ts。実装の後の改修で追加)
├── common-lib/time/business-date-label.ts                    # 変更。formatBusinessDateWithWeekdayLabel(曜日つきの業務日付「2027年5月30日(日)」。backend-lib・client・adminで共用、実装の後の改修で追加)
├── backend-lib/
│   ├── core/time/business-time.ts                            # 変更。addBusinessDays・businessWeekdayOfを公開(G5、*.unit.test.tsに追記)
│   ├── core/d1/statement-chunks.ts                           # chunk・IDS_PER_STATEMENT(90件ずつの分割。WeekとYearとブラケットの部品で共用、実装の後の改修で追加)
│   ├── core/tournament/                                      # 種類によらないトーナメントの規則(Bunの単体テスト)
│   │   ├── launch-ordering.ts                                # 新規(移設、G2)。LaunchOrderingKey・launchSeedOrder・launchNonSeedOrder
│   │   └── refund-rejection.ts                               # 新規(移設、G4)。RefundRejectionCode・RefundRejectionOutcome・refundRejectionOutcome
│   ├── core/notifications/violation-tolerant-publish.ts      # 新規(移設、G3)。publishExcludingViolations(*.unit.test.ts)
│   ├── core/email/kinds/tournament-year.ts                   # 新規。TOURNAMENT_YEAR_ENTRY_REFUND_KIND・TOURNAMENT_YEAR_EMAIL_KINDS(*.unit.test.ts)
│   ├── core/year-tournament/                                 # Yearの純粋な規則(Bunの単体テスト)
│   │   ├── year-schedule.ts                                  # YEAR_*の定数・defaultFinalDate・yearScheduleFor・yearFirstRoundDate
│   │   ├── final-date-choice.ts                              # editableYears・checkFinalDateChoice・finalDateChoices・nextYearGapWarning
│   │   ├── year-target-rules.ts                              # resolveTargetYear・isPreviousYearSet・TARGET_YEAR_LOOKUP_YEARS(対象年を調べる年の数4。カレンダー・供給元・導線で共用)
│   │   ├── year-capacity.ts                                  # selectWithinCapacity(並びはcore/tournament/launch-ordering.ts)
│   │   ├── year-entry-rules.ts                               # YearEntryStatus・YearEntryCloseReason・YearRefundStatus・YEAR_REFUND_REASONS・refundReasonFor・yearRefundRequestKey
│   │   ├── ports.ts                                          # YearTournamentRecord・YearTournamentStore・YearEntryRecord・NewYearEntry・YearEntryStore・YearCalendar・YearEntryRegistrar・YearDrawService・YearProgressionService・YearNotificationPublisher・YearEntryFollowUp・YearAwardExport(型だけ)
│   │   └── identifiers.ts                                    # YEAR_TOURNAMENT_TYPES(api・event共通の識別子、identifiers.unit.test.ts)
│   └── workers/year-tournament/                              # core/year-tournamentの契約の実装と束縛(Workers統合テスト)
│       ├── d1-year-tournament-store.ts                       # YearTournamentStoreのD1実装
│       ├── d1-year-entry-store.ts                            # YearEntryStoreのD1実装
│       ├── year-calendar.ts                                  # YearCalendarの実装(行と既定の日をまとめた年の照会・対象年の判定・行の用意)
│       ├── year-entry-registrar.ts                           # YearEntryRegistrarの実装(Week優勝からの枠の作成と免除)
│       ├── year-entry-offer-policy.ts                        # paymentsのPurchaseOfferPolicy(core/payments)の実装とYEAR_ENTRY_OFFER_REJECTION_MESSAGES
│       ├── year-entry-fulfillment.ts                         # paymentsのPurchaseFulfillment(workers/payments)の実装
│       ├── year-tournament-registrations.ts                  # YEAR_TOURNAMENT_PURCHASE_KIND_REGISTRATION(paymentsの登録口が読み込む)
│       ├── year-draw-service.ts                              # YearDrawServiceの実装(凍結・分類・上限・組み合わせ)
│       ├── year-progression-service.ts                       # YearProgressionServiceの実装(進行・発行・終了の記録)
│       ├── year-entry-follow-up.ts                           # YearEntryFollowUpの実装(返金の依頼と知らせ)
│       ├── year-notification-publisher.ts                    # YearNotificationPublisherの実装(通知イベントの組み立て、発行はpublishExcludingViolations)
│       ├── d1-year-award-export.ts                           # YearAwardExportのD1実装(data-export)
│       ├── incident-tags.ts                                  # safeTagOf(エラートラッキングのタグを識別子の形の値だけにする)
│       ├── testing/                                          # テストの補助(year-tournament-fixtures.ts・year-entry-registrar-fixtures.ts・year-progression-fixtures.ts・year-draw-fixtures.ts・year-entry-follow-up-fixtures.ts・year-tournament-platform-implementations.ts)
│       ├── year-entry-columns.unit.test.ts                   # 値の一覧とDBの列の値の一致
│       └── year-tournament-platform-module.ts                # createYearTournamentPlatformModule(appName)
├── api/src/
│   ├── application/year-tournament/                          # Bunの単体テスト
│   │   ├── year-tournament-api-types.ts                      # YEAR_TOURNAMENT_API_TYPES
│   │   ├── ports.ts                                          # YearTournamentIncidentReporter・YearTournamentIncident・YearFinalDateWriter
│   │   ├── year-board-reader.ts                              # トップページの区画
│   │   ├── year-bracket-reader.ts                            # ブラケットのページ
│   │   ├── year-bracket-path.ts                              # yearBracketPathOf(year)(トップページ・トロフィー・導線のブラケットのパス)
│   │   ├── year-entry-panel-reader.ts                        # 参加費の導線
│   │   ├── year-entry-checkout.ts                            # 決済の開始(CheckoutStarterの呼び出し)
│   │   ├── year-final-date-service.ts                        # 決勝実施日の照会と保存
│   │   ├── year-final-date-errors.ts                         # 決勝実施日の保存のエラー(validation_error・final_date_locked・version_conflict)
│   │   ├── year-launch-standings.ts                          # 供給元と導線が共用する枠・勝ち残り・対象年の読み取り(readYearLaunchStandings・resolveTargetIn等)
│   │   ├── year-relaunch-condition-source.ts                 # tournament-year.result-pending
│   │   ├── year-product-lock-source.ts                       # tournament-year.bracket-lock
│   │   ├── year-launch-summary-source.ts                     # tournament-year.launch-summary
│   │   ├── year-trophy-source.ts                             # tournament-year.year-trophies
│   │   ├── year-tournament-jobs.ts                           # 2つのジョブ(23:45の夜の処理、4:21の再処理)
│   │   └── testing/                                          # テストの偽物(year-decision-fakes.ts・year-summary-fakes.ts・year-final-date-fakes.ts・year-entry-panel-fakes.ts・year-tournament-job-fakes.ts)
│   ├── infrastructure/year-tournament/
│   │   ├── d1-year-final-date-writer.ts                      # 版の条件付きの保存と監査ログ(*.worker.test.ts)
│   │   └── sentry-year-tournament-incident-reporter.ts       # ジョブの失敗のログとエラートラッキング(*.worker.test.ts、Weekの前例)
│   ├── presentation/graphql/modules/tournament/              # WeekとYearのスキーマモジュールが共用する処理(inputs.ts・resolver-support.ts・round-board-resolvers.ts、実装の後の改修でWeekから移した)
│   ├── presentation/graphql/modules/year-tournament/         # スキーマモジュール(Workers統合テスト)
│   │   ├── type-defs.ts
│   │   ├── inputs.ts
│   │   ├── errors.ts
│   │   ├── mappers.ts
│   │   ├── board-resolvers.ts                                # yearTournamentBoard
│   │   ├── bracket-resolvers.ts                              # yearBracket
│   │   ├── entry-resolvers.ts                                # myYearEntry・startYearTournamentCheckout
│   │   ├── final-date-resolvers.ts                           # yearFinalDateSettings・updateYearFinalDate
│   │   └── index.ts                                          # yearTournamentSchemaModule
│   └── composition/year-tournament-module.ts                 # YEAR_TOURNAMENT_API_MODULE(ローカルD1のブラケットの照会のテストyear-bracket-reader.worker.test.tsと23:45の連鎖のテストを併置)
├── api/test/support/                                         # GraphQLと時刻の連鎖のテストの補助(year-tournament-graphql-operations.ts・year-entry-graphql-operations.ts・year-final-date-graphql-operations.ts・year-tournament-timeline.ts)
├── event/src/
│   ├── application/year-tournament/                          # Bunの単体テスト
│   │   ├── event-year-tournament-types.ts                    # EVENT_YEAR_TOURNAMENT_TYPES
│   │   ├── week-champion-entry-handler.ts                    # decided week 1700
│   │   ├── round-progress-handler.ts                         # decided year 1710
│   │   ├── product-entry-loss-handler.ts                     # プロダクトのdeleted 1700
│   │   ├── account-entry-loss-handler.ts                     # ユーザーのwithdrawn 1700
│   │   ├── entry-unlink-handler.ts                           # プロダクトのpurge_due 1700
│   │   ├── year-ultras-entry-exemption-handler.ts            # Ultrasの知らせ(1700)
│   │   ├── year-open-entry-checkout-expiry-handler.ts        # Ultrasの知らせ(1710)
│   │   └── year-entry-supplement-provider.ts                 # Week決勝の勝利の結果通知への追記
│   ├── infrastructure/email/templates/tournament-year/       # email-deliveryのテンプレートの置き場所の規約(*.worker.test.tsx)
│   │   ├── index.ts                                          # TOURNAMENT_YEAR_EMAIL_TEMPLATES
│   │   ├── year-entry-refund-template.ts
│   │   ├── year-entry-refund-lead.ts
│   │   └── year-entry-refund-email-body.tsx
│   └── composition/year-tournament-module.ts                 # EVENT_YEAR_TOURNAMENT_MODULE
├── client/src/
│   ├── routes/tournaments/year/$year.tsx                     # ブラケットのページ(仮5)
│   ├── components/tournament/                                # 種類によらない共用の部品(G6。Weekの部品から移す、1ファイル1コンポーネント、browser・unitのテストを併置)
│   │   └── (「clientの共用の部品」の表のファイル)
│   ├── components/year-tournament/                           # Yearの照会・文言・経路を共用の部品へ渡す包み(browser testを併置)
│   │   ├── year-tournament-section.tsx                       # main 10
│   │   ├── year-final-showcase.tsx                           # showcase 10
│   │   ├── use-year-board.ts                                 # useTournamentBoardへYearの照会を渡す
│   │   ├── year-bracket-page.tsx                             # TournamentBracketPageへYearの見出しを渡す
│   │   ├── year-bracket-model.ts                             # 型YearBracketView・yearBracketFinalDateOf(見出しの決勝日)
│   │   ├── year-entry-panel.tsx                              # myYearEntryの取得とTournamentEntryPanelBodyへの受け渡し
│   │   ├── year-entry-view.ts                                # myYearEntryの値からTournamentEntryInputへの写し(*.unit.test.ts)
│   │   ├── year-entry-owner-action.tsx                       # PRODUCT_OWNER_ACTIONSの包み
│   │   ├── year-entry-my-product-section.tsx                 # MY_PRODUCT_SECTIONSの包み
│   │   ├── year-entry-delete-notice.tsx
│   │   ├── year-tournament-messages.ts                       # TournamentBoardCopy・TournamentBracketCopyのYearの文言
│   │   ├── year-entry-messages.ts                            # TournamentEntryCopyのYearの文言
│   │   ├── year-tournament-fixtures.ts                       # ブラウザテストの値(トップページ・決勝・ブラケット)
│   │   └── year-entry-fixtures.ts                            # ブラウザテストの値(参加費の導線。Weekのweek-entry-fixtures.tsの前例)
│   ├── graphql/year-tournament.ts                            # 取得の補助(yearTournamentBoardQueryOptions・yearBracketQueryOptions・myYearEntryQueryOptions・startYearTournamentCheckoutMutationOptions、*.unit.test.ts)
│   ├── graphql/fragments/year-tournament/year-board-round-fields.graphql # YearBoardRoundFields(型だけを生成する。共用の部品が依存するfinal・matches・byesはWeekと同じ選択)
│   └── graphql/operations/year-tournament/                   # 1ファイル1操作の.graphql(操作名はClientで始める)
│       ├── year-tournament-board.graphql                     # ClientYearTournamentBoard
│       ├── year-bracket.graphql                              # ClientYearBracket(項目を直接書き、名前で展開はchampionのBracketMatchProductFieldsだけ)
│       ├── my-year-entry.graphql                             # ClientMyYearEntry
│       └── start-year-tournament-checkout.graphql            # ClientStartYearTournamentCheckout
├── client/test/year-tournament-board-stub.ts                   # トップページの経路のテストのYearの照会の空の偽物
├── admin/src/
│   ├── components/year-tournament/                           # 1ファイル1コンポーネント(browser testを併置、G9)
│   │   ├── final-date-section.tsx                            # ADMIN_SETTINGS_SECTIONSの区画
│   │   ├── final-date-year-card.tsx                          # 年ごとの表示
│   │   ├── final-date-form.tsx                               # 候補の選択・理由・確認
│   │   ├── final-date-labels.ts                              # 拒否の理由と区画の文言・FINAL_DATE_SECTION_TITLE(*.unit.test.ts)
│   │   ├── final-date-schedule.ts                            # scheduleOfChoice(確認のダイアログの変更後の受付期限・組み合わせ決定)
│   │   └── final-date-fixtures.ts                            # ブラウザテストの値
│   ├── graphql/admin-year-final-date.ts                      # 照会の補助adminYearFinalDateSettingsQueryOptions()と型
│   └── graphql/operations/year-tournament/                   # 1ファイル1操作の.graphql(操作名はAdminで始める、G9)
│       ├── year-final-date-settings.graphql                  # AdminYearFinalDateSettings
│       └── update-year-final-date.graphql                    # AdminUpdateYearFinalDate
e2e/
├── client/year-tournament.e2e.test.ts                        # 参加費の決済・組み合わせ・トップページ・受賞(ジョブは共用のtriggerScheduledで起動)
├── client/year-tournament-steps.ts                           # 画面の操作の手順
├── admin/year-final-date.e2e.test.ts                         # 決勝実施日の保存と監査ログ
├── admin/year-final-date-steps.ts                            # 画面の操作の手順
├── support/year-tournament-fixtures.ts                       # ローカルD1にWeek優勝の枠と年の行を作る補助
├── support/year-tournament-fixture-sql.ts                    # 補助が流すSQLの組み立て(*.unit.test.ts、Weekの前例)
└── support/year-final-date-choice.ts                         # pickFinalDateChoice(管理画面のE2Eが選ぶ候補、*.unit.test.ts)
docs/GUIDES/tech/
├── backend/019-anchor-date-schedules.md                      # 新規
└── frontend/012-business-date-calendar.md                    # 変更。「サーバーが返す候補から選ばせる日付」の節(G7)
```

テストは各ファイルの隣に置く(`*.unit.test.ts`・`*.worker.test.ts`・`*.worker.test.tsx`・`*.browser.test.tsx`)。技術ドキュメントの番号は、各ディレクトリの最小の空き番号の`backend/019`を本specが取る(sponsorshipの`backend/018`・public-apiの`backend/020`の計画と重ならない)。フロントエンドの文書はG7により新設しない(`frontend/018`はsponsorship・public-apiの計画の番号に影響しない空き番号のまま残す)。

#### clientの共用の部品(G6)

tournament-weekの`components/week-tournament/`から次のとおり移す。共用の部品は種類の固有の値(照会の関数・文言・経路・Ultrasの案内と秒読みの有無)を引数で受け、生成された型はWeekとYearのフラグメントの共通の形(構造の型)で受ける。Weekの部品は同じ名前・同じ引数のまま、Weekの値を渡す包みになる。

| 移す先(`components/tournament/`)                              | 移す元(`components/week-tournament/`)                                       | 種類の固有の値の受け方                                                                                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tournament-board-model.ts`                                   | `week-board-model.ts`                                                       | 行の型`TournamentBoardRound`(`final`・`matches`・`byes`を持つ構造の型)。`splitBoardRound`・`sectionRoundsOf`・取り直しの判定・`withUpdatedBoardMatch`(盤面の取り出しと差し替えの関数を受ける) |
| `use-tournament-board.ts`                                     | `use-week-board.ts`                                                         | 照会の`queryOptions`・照会の結果から盤面を取り出す関数・差し替えの関数を受ける                                                                                                                |
| `tournament-board-round.tsx`                                  | `week-board-round.tsx`                                                      | 見出しの部品を`children`で受ける                                                                                                                                                              |
| `tournament-section-heading.tsx`                              | `week-section-heading.tsx`                                                  | 区画の名前・期間の表記(週・年)・ラウンド名・決勝日・ブラケットの経路                                                                                                                          |
| `tournament-match-card.tsx`                                   | `week-match-card.tsx`                                                       | なし(種類によらない)                                                                                                                                                                          |
| `tournament-final-model.ts`                                   | `week-final-model.ts`                                                       | 行の型は`TournamentBoardRound`                                                                                                                                                                |
| `tournament-final-round.tsx`・`tournament-final-showcase.css` | `week-final-round.tsx`・`week-final-showcase.css`                           | 印・題名・副題・受賞と受賞なしの文を`TournamentFinalCopy`で受ける                                                                                                                             |
| `tournament-bracket-model.ts`                                 | `week-bracket-model.ts`                                                     | 照会の値を`{ rounds, champion, tournament: { awarded, status } }`の構造の型で受ける                                                                                                           |
| `tournament-bracket-page.tsx`                                 | `week-bracket-page.tsx`の本体                                               | 題名・参加数とシード数の表記を受ける。共用の`components/bracket/`の4部品へ`BracketViewProps`を渡す                                                                                            |
| `tournament-bracket-error.tsx`・`tournament-bracket-link.tsx` | `week-bracket-error.tsx`・`week-bracket-link.tsx`                           | 失敗の文言を受ける                                                                                                                                                                            |
| `tournament-entry-model.ts`                                   | `week-entry-model.ts`                                                       | 入力`TournamentEntryInput`(状態・理由の種類・免除・期限・参加費・`ultrasGuide`・`blockedReason`・進行・経路・`refundable`)。表示の種類`TournamentEntryDisplay`(除外の理由を含む)              |
| `tournament-entry-panel-body.tsx`                             | `week-entry-panel.tsx`の描画                                                | `TournamentEntryInput`・`TournamentEntryCopy`・`countdown`(受付期限の48時間前からの秒読みを添えるか)・決済の開始の`mutationOptions`                                                           |
| `tournament-entry-checkout.tsx`・`entry-deadline.tsx`         | `week-entry-checkout.tsx`・`entry-deadline.tsx`                             | 決済の開始の`mutationOptions`・文言・`ultrasGuide`・`blockedReason`・秒読みの有無                                                                                                             |
| `tournament-copy.ts`                                          | `week-tournament-messages.ts`・`week-entry-messages.ts`の種類によらない文言 | `TournamentBoardCopy`・`TournamentFinalCopy`・`TournamentBracketCopy`・`TournamentEntryCopy`の型と、種類によらない文言(「決勝日」「ブラケットを見る」「決済期限」「締め切りまであと」など)    |

- Weekに残すもの: `week-tournament-section.tsx`・`week-final-showcase.tsx`・`use-week-board.ts`・`week-bracket-page.tsx`・`week-entry-panel.tsx`・`week-entry-owner-action.tsx`・`week-entry-my-product-section.tsx`・`week-entry-delete-notice.tsx`(Weekの照会と文言を共用の部品へ渡す包み)、`week-tournament-messages.ts`・`week-entry-messages.ts`(Weekの文言を共用の型で書き出す)、`week-entry-view.ts`(新規。`myWeekEntry`の値から`TournamentEntryInput`への写し。`refundable`は従来どおり`!exempt`)。
- 移したモデルの単体テストと部品のブラウザテストは移す先へ移し、種類ごとの値はWeekとYearの両方の例で確かめる。Weekの包みのブラウザテストと`week-*-fixtures.ts`は、Weekの表示が変わらないことの確認として残す。

### Modified Files

- `apps/db/schema/index.ts`・`apps/db/schema/tournament/index.ts`・`apps/db/migrations/<日時>_tournament_year/migration.sql` — 2テーブルの再エクスポートと、生成したマイグレーション(CHECK・一意索引)。mainの最新を取り込んでから生成する。
- `apps/common-lib/admin/audit-actions/index.ts`(と`index.unit.test.ts`) — 本specの操作種別の連結。
- `apps/backend-lib/core/email/kinds/index.ts`(と`index.unit.test.ts`) — `TOURNAMENT_YEAR_EMAIL_KINDS`の連結。
- `apps/backend-lib/workers/payments/purchase-kind-registrations.ts`(と`payments-platform-module.worker.test.ts`) — `YEAR_TOURNAMENT_PURCHASE_KIND_REGISTRATION`の読み込み(C-2)。
- G2・G4・G3・G5(tournament-weekのコード): `apps/backend-lib/core/week-tournament/week-ordering.ts`(削除し`core/tournament/launch-ordering.ts`へ)・`week-ordering.unit.test.ts`(移す)・`week-entry-rules.ts`(拒否の写像を削り`core/tournament/refund-rejection.ts`を使う)・`week-entry-rules.unit.test.ts`・`week-schedule.ts`、`apps/backend-lib/workers/week-tournament/week-draw-service.ts`・`week-entry-follow-up.ts`・`week-notification-publisher.ts`(とそれぞれのテスト)、`apps/backend-lib/core/tournament/round-schedule.ts`(`nextBusinessDate`を削る)・`round-schedule.unit.test.ts`、`apps/backend-lib/workers/tournament/d1-bracket-progression.ts`。
- G5(他specのコード): `apps/backend-lib/core/time/business-time.ts`・`business-time.unit.test.ts`、`apps/api/src/domain/product/launch-date-rules.ts`(`addBusinessDays`を削る)・`launch-date-rules.unit.test.ts`・`apps/api/src/application/product/jobs/product-purge-orchestrator-job.ts`、`apps/api/src/application/match/match-jobs.ts`、`apps/event/src/infrastructure/notifications/evening-collector.ts`。
- G6(tournament-weekのclient): `apps/client/src/components/week-tournament/`の「clientの共用の部品」の表の移す元のファイルとそのテスト。
- `apps/api/src/composition/modules.ts`・`graphql-modules.ts`・`scheduled-jobs.ts`・`product-decision-sources.ts`・`tournament-trophy-sources.ts`・`evening-dispatch-participants.ts` — 共有モジュールとapiの束縛、`yearTournamentSchemaModule`、2つのジョブ、3つの供給元、トロフィーの供給元、夜の枠の送り出しの前提の名前`tournament-year.evening-bracket`。
- `apps/event/src/composition/modules.ts`・`match-event-handlers.ts`・`product-lifecycle-async-handlers.ts`・`user-lifecycle-async-handlers.ts`・`ultras-activation-handlers.ts`・`result-notice-supplements.ts`・`apps/event/src/infrastructure/email/templates/index.ts` — 共有モジュールとeventの束縛、8件の登録、テンプレートの一覧の連結。
- `apps/client/src/composition/top-page-sections.ts`・`product-page-sections.ts`・`my-product-sections.ts`・`product-delete-notices.ts`・`apps/client/src/head/page-heads.ts`(`buildYearBracketHead`) — 区画の登録とページのhead。
- `apps/admin/src/composition/admin-settings-sections.ts` — `{ id: 'tournament-year.final-date', order: 10, title: FINAL_DATE_SECTION_TITLE, component: FinalDateSection }`。
- B-5: 登録の一覧・空の登録口・登録の数で振る舞いが変わることを前提にした上流のテスト(「上流への影響」の各行と注記)。
- `docs/GUIDES/tech/backend/README.md` — 文書一覧の`019`の行。`frontend/README.md`の`012`の行の説明に候補の選択を加える。
- `docs/GUIDES/tech/backend/016-batched-notification-delivery.md`・`017-single-elimination-brackets.md`・`frontend/013-live-scoreboard.md`・`frontend/016-tournament-bracket-view.md` — 共用へ移した部品(`publishExcludingViolations`・`core/tournament`の並びと拒否の写像・clientの`components/tournament/`)の名前と置き場所の記述。プレースホルダーの値は変えない。
- `docs/onboardings/project-values.md` — ジョブ・処理・登録の名前と`order`、価格の`lookup_key`、メール種別、返金の依頼キーの形、監査ログの操作種別、移した並びの名前(`weekSeedOrder`の記述)。
- `docs/GUIDES/service/overview/005-year-tournament-rules.md` — 確定した決定の仮1(前年の決勝日と初年度)・仮2(64を超える参加)・仮3・仮4(除外と返金)・仮6(期限の後の反映)の規則を加え、凍結の時点、ラウンドの遅れの回復、ブラケットのページ(仮5)、「参加数上限64(決勝日設定の制約により保証)」の記述の訂正を加える。
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 23:45の`tournament-year.evening-bracket`(1700。Week優勝の取り込み→組み合わせ決定→進行→通知の発行→夜の送り出しの準備の完了の通知)、4:21の表に1700(`content-processing.keyword-reextraction`(2300)より前)、年次タイムラインの組み合わせ決定の順序。23:50の送り出しの前提を書かない。
- `docs/GUIDES/service/design/002-page-layouts.md` — Yearのブラケットのページ(仮5)、トップページのYearの区画の見出しと導線、Yearの参加費の導線の状態の表と置き場所、削除の注意書き、管理画面の設定の決勝実施日の区画。
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — 本specのエラー・状態・メール・管理画面の文言(Supporting References)。
- `docs/GUIDES/service/legal/004-legal-notice-outline.md`・`docs/GUIDES/service/features/004-payments.md` — 返金ポリシーのWeek・Yearに共通の行とYearの上限による停止の行、購入種別の表のYearの行は更新済みのため、本specの決定(仮4・G4)との一致を確かめる(差があれば直す)。
- `CLAUDE.md` — 「技術規則の参照先」に「管理者が設定する日付から期限を逆算する前に: `backend/019`」。既存の`frontend/012`の行の見出しに候補の選択を含める(拒否されたら開発者へ報告する)。

## System Flows

### 参加の枠の状態

```mermaid
stateDiagram-v2
    [*] --> AwaitingPayment: Week優勝
    [*] --> Entitled: 優勝時点でUltras
    [*] --> Expired: 凍結後に届いた優勝
    AwaitingPayment --> Entitled: 決済の反映またはUltrasの加入
    AwaitingPayment --> Forfeited: 凍結前の削除と退会
    Entitled --> Forfeited: 凍結前の削除と退会
    AwaitingPayment --> Expired: 凍結時に資格なし
    AwaitingPayment --> Entitled: 凍結時にUltrasの期間内
    Entitled --> Excluded: 凍結時に非公開化と停止
    Entitled --> Forfeited: 凍結時に論理削除済み
    Entitled --> Drawn: 凍結時に可視
    Drawn --> Excluded: 上限を超えた古い優勝
    Drawn --> [*]
    Expired --> [*]
    Forfeited --> [*]
    Excluded --> [*]
```

- 枠は対象年を持たない。終わっていない枠(`awaiting_payment`・`entitled`)の対象年は「組み合わせ決定を始めていない年のうち、決済期限日がWeek優勝の日より後の最も早い年」である(`resolveTargetYear`)。組み合わせ決定の分類が枠を終えるときに`classified_year`を記録する。
- 凍結(`year_tournaments.draw_started_at`)の後は、その年の決済期限日より前のWeek優勝の枠について、資格を変える全ての書き込み(反映・免除・喪失・取り込み)が条件の不一致で何もしないか、期限切れ(`late_entry`)になる。`Forfeited`・`Excluded`で`purchase_id`があれば`refund_status = 'pending'`を同じ文で記録する(6.1・6.2・6.4〜6.6)。

### 決勝実施日の保存

```mermaid
sequenceDiagram
    participant UI as final date form
    participant R as updateYearFinalDate
    participant S as YearFinalDateService
    participant C as YearCalendar
    participant W as D1YearFinalDateWriter
    UI->>R: 対象年 日付 版 理由
    R->>R: requireAdmin super_admin
    R->>S: update
    S->>C: ensureUpcoming と前年 翌年 対象年の照会
    S->>S: checkFinalDateChoice
    S->>W: 行の用意 版と期限の条件付きの更新 監査ログ
    W-->>S: saved または version_conflict または locked
    S-->>UI: 新しい表示 または理由
```

- 保存の条件(その年の`final_date_version = 読んだ版`・`draw_started_at IS NULL`・`change_lock_at > now`(変更前の期限)と、64週の間隔の検証に使った前年と翌年の版の一致)を監査ログのガードとUPDATEのWHEREで共有し、満たさなければ監査ログのガードの拒否で行の用意・監査ログ・更新をまとめて取り消す。取り消しは読み直して`locked`(変更期限・凍結)か`version_conflict`に分ける(2.7・2.10・2.11)。
- 枠の対象年は保存しないため、保存で枠を書き換えない。以後の照会と判定が新しい列から対象期間と期限を求める(1.3・3.8・13.6)。

### 組み合わせ決定の日の23:45

```mermaid
sequenceDiagram
    participant PY as payments 23時40分 order 10
    participant ME as match engine 23時40分と23時45分 order 1100
    participant NT as notifications 23時45分 order 1300
    participant WK as tournament week evening bracket 23時45分 order 1500
    participant YE as year evening bracket 23時45分 order 1700
    participant G as EveningDispatchGate
    participant KO as match kickoff 0時 order 1100
    PY->>PY: 決済の突合と反映
    ME->>ME: 当日のマッチを確定し decided を送る
    NT->>NT: 夜の枠を開く 送り出しは前提の準備の完了の後 遅くとも23時55分
    WK->>WK: Weekの組み合わせと進行 Week優勝の記録
    WK->>G: markReady tournament-week.evening-bracket
    YE->>YE: 次に開催する年の行の用意とWeek優勝の取り込み
    YE->>YE: 到来した年を凍結 分類 上限 組み合わせ 返金の依頼
    YE->>YE: 進行中の年を進め 未処理の確定に追いつく
    YE->>YE: その夜の結果 翌日の予告 受賞を発行
    YE->>G: markReady tournament-year.evening-bracket
    G->>NT: 前提がそろえば送り出しを依頼
    KO->>KO: 予定のマッチを開始 不戦勝を決着
```

- 決済セッションの有効期限は決済期限(23:35)以前で、受付期限(23:00)の後は開始できない(paymentsの`assertAcceptable`)。反映の期限(23:45)の後の完了はpaymentsが自動で返金する(4.2・4.7・4.9)。
- 1回戦は組み合わせ決定の翌日以降(決勝日の5日前〜決勝日)で、1回戦の予告は組み合わせ決定の時点で発行し、notificationsが前日の夜の枠まで保持する(14.1)。
- `tournament-year.evening-bracket`は毎晩、組み合わせや進行の無い夜も、全ての処理と発行を終えた最後に`EveningDispatchGate.markReady`を呼ぶ。処理のどれかが失敗した夜は呼ばずに例外を投げ、notificationsが23:55の期限で送り出し、呼ばなかった前提を`evening-dispatch-incomplete`として検知する(14.7)。
- `decided`の処理と23:45のジョブは同じ`YearProgressionService.advance`を呼ぶ。どちらが先でも、次ラウンドの位置とマッチIDはtournament-weekの部品が先に挿入した側にそろえる(8.2・8.8)。

### Week優勝の取り込み(`YearEntryRegistrar.syncChampions`)

1. `WeekChampionDirectory.listChampions({ awardedFrom, awardedBefore: now })`でWeek優勝を読む(`decided`・`week`の処理は直近8日、23:45のジョブは`YearCalendar.openPeriodStart`(凍結済みの最新の年の決済期限日の0:00、無ければ起点なし)から)。
2. `YearEntryStore.findByWeekTournaments`(`WeekChampion.tournamentId`)で既存の枠を除き、残りのローンチについて`MatchDirectory.findQualifierResults(launchIds)`で予選のマッチを引き、`findMatches(matchIds, now)`の勝った側の`upvoteCount`・`lastUpvoteElapsedMs`と`matchDate`(ローンチ日)を写す(3.2)。週の識別子`week_period`は`isoWeekKey(WeekChampion.weekStart)`で求める。予選が見つからない枠は作らず`captureEvent`(次の実行で再試行)。
3. 残りのWeek優勝の日の年〜3年後の和集合を`YearCalendar.describe`で1回だけ読み、Week優勝ごとに純粋な`resolveTargetYear`を当てて対象年を求める(`resolveAward`をWeek優勝ごとに呼ぶのと同じ結果になる)。`open`なら`UltrasEntitlements.wasEntitledDuring(投稿者, Week優勝の日時, その年の決済期限)`が真なら`entitled`(`ultras`)、偽なら`awaiting_payment`で挿入する(5.1)。`late`なら期限切れで挿入する(3.7)。
4. 挿入は1文で、凍結済みの年のうち決済期限日がWeek優勝の日より後の年があれば`expired`(`late_entry`、`classified_year`はその年)にし、`week_tournament_id`の一意索引で`onConflictDoNothing()`する。手順3の判定と挿入の間に凍結されても、文の条件で期限切れになる(3.3・3.7)。

### 組み合わせ決定(`YearDrawService.drawDue`)

1. 補完: 到来した年(`draw_at ≤ now`かつ`open`・`drawing`の行)ごとに`syncChampions`を起点なしで呼ぶ。
2. 凍結: `UPDATE year_tournaments SET draw_started_at = ?, status = 'drawing' WHERE id = ? AND draw_started_at IS NULL`。既に凍結済みなら続きから行う(7.2)。
3. 分類(90件ずつ): `listCandidates`で`status IN ('awaiting_payment', 'entitled')`かつWeek優勝の日が`[前年の行の決済期限日, その年の決済期限日)`の枠を読む(下限は前年の行があるときだけ付け、前年の行が無ければ下限なし)。Yearトーナメント規則と状態遷移図のとおり、受付中の枠をまず参加資格か期限切れに分ける。`awaiting_payment`は`entitledUsersDuring`で候補を絞ったうえで`wasEntitledDuring(投稿者, awarded_at, deadline_at)`が真なら参加資格(出どころ`ultras`)、偽なら`expired`(`deadline`)。参加資格の枠(`entitled`と、ここでUltrasにより参加資格を得た枠)だけを、`ProductDirectory.findSummaries(ids, 'not-deleted')`に無ければ`forfeited`(`deleted`)、`visible`が偽なら`excluded`(`hidden_or_suspended`)、それ以外は`drawn`にする。50件ずつの一括の書き込みで、状態・理由・`closed_at`・`classified_year`と、`forfeited`・`excluded`の`refund_status`(購入があれば`pending`、無ければ`not_needed`。`drawn`・`expired`は`none`のまま)を`status IN ('awaiting_payment', 'entitled')`の条件付きで記録する(5.5・6.4・7.11)。
4. 上限: その年の`drawn`が64を超えれば、`selectWithinCapacity`でWeek優勝の日時の古い順の超過分を`excluded`(`over_capacity`)にする(6.5)。同時刻の決め手`tieBreaker`は枠のWeekトーナメントのID(一意で、紐付けの解除でもnullにならない)とし、再実行しても同じ枠を選ぶ。
5. 組み合わせ: その年の`drawn`の枠を候補に`BracketDraw.create({ kind: 'year', tournamentId: <年の行のID>, candidates, order: { seed: launchSeedOrder, nonSeed: launchNonSeedOrder }, policy: dailyRoundPolicy(yearFirstRoundDate(final_date, N) ?? final_date, now), now })`(7.3〜7.10)。並びはWeekと共用の`core/tournament/launch-ordering.ts`(G2)。
6. 記録: 年の行に`bracket_id`・`first_round_date`・`participant_count`・`drawn_at`・`status`(`in_progress`、または参加0・1なら`finished`と`outcome`・`awarded_at`)を条件付きで書く。
7. 後処理: `YearProgressionService.applyResult`で予告と受賞(参加1)の発行(参加0・1で終えた場合も、記録の後に同じ後処理を呼ぶ。`backend/017`の「発行を記録より先にする」の参加1の扱い)、`YearEntryFollowUp.processYear`で返金の依頼と知らせ(6.6・6.9・14.1)。

### 参加資格の喪失と返金

```mermaid
sequenceDiagram
    participant PL as product lifecycle deleted
    participant UL as user lifecycle withdrawn
    participant H as entry loss handler 1700
    participant S as YearEntryStore
    participant OX as OpenCheckoutExpirer
    participant F as YearEntryFollowUp
    participant R as PaymentRefunds
    participant E as EmailSender
    PL->>H: deleted
    UL->>H: withdrawn
    H->>S: 凍結前の枠を forfeited と refund pending
    H->>OX: 削除のときローンチの未完了の決済を失効
    H->>F: 返金待ちの枠を処理
    F->>R: request 依頼キー tournament-year 購入ID 理由
    F->>E: 返金の知らせ 退会済みは送らない
```

- 返金の依頼が一時的に失敗した枠は`pending`のまま残り、4:21の`tournament-year.entry-follow-up`が依頼し直す(6.8)。依頼の拒否は`refundRejectionOutcome`で`not_needed`・`already_refunded`・`rejected`のいずれかにして終え、知らせのメールを送らない(G4)。退会では、未完了の決済の失効はpaymentsの`payments.open-checkout-expiry`(410)が先に行う。

## Requirements Traceability

| Requirement                                    | Summary                    | Components                                                                                                                                  | Interfaces                                                                                | Flows                     |
| ---------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------- |
| 1.1, 1.2, 1.3, 1.6                             | 決勝日と期限               | YearSchedule、YearCalendar、YearTournamentStore                                                                                             | `defaultFinalDate`・`yearScheduleFor`・`YearCalendar.describe`                            | 決勝実施日の保存          |
| 1.4, 1.5                                       | 1回戦の日とマッチの時刻    | YearSchedule、YearDrawService                                                                                                               | `yearFirstRoundDate`・`dailyRoundPolicy`・`matchWindow`                                   | 組み合わせ決定            |
| 2.1, 2.2, 2.3, 2.12, 2.13                      | 区画の表示と操作           | FinalDateSection、FinalDateYearCard、FinalDateForm、FinalDateLabels、YearFinalDateService                                                   | `yearFinalDateSettings`・`ADMIN_SETTINGS_SECTIONS`                                        | 決勝実施日の保存          |
| 2.4, 2.5, 2.6, 2.8                             | 選べる日付と検証           | FinalDateChoice、YearFinalDateService                                                                                                       | `checkFinalDateChoice`・`finalDateChoices`・`editableYears`                               | 決勝実施日の保存          |
| 2.7, 2.9, 2.10, 2.11                           | 期限・認可・監査・競合     | YearFinalDateService、D1YearFinalDateWriter、FinalDateResolvers、YearAuditActions                                                           | `updateYearFinalDate`・`year-final-date.update`                                           | 決勝実施日の保存          |
| 3.1, 3.2, 3.3                                  | 枠の作成                   | YearEntryRegistrar、WeekChampionEntryHandler、YearTournamentJobs、YearEntryStore                                                            | `syncChampions`・`MATCH_EVENT_HANDLERS`                                                   | Week優勝の取り込み        |
| 3.4, 3.5, 3.6, 3.8, 3.9                        | 対象年                     | YearTargetRules、YearCalendar、YearDrawService                                                                                              | `resolveTargetYear`・`resolveAward`・`openPeriodStart`                                    | 組み合わせ決定            |
| 3.7                                            | 遅れた枠                   | YearEntryStore、YearEntryRegistrar                                                                                                          | `insertFromChampion`                                                                      | Week優勝の取り込み        |
| 4.1, 4.2, 4.3, 4.4                             | 決済の開始と表示           | YearEntryOfferPolicy、YearEntryCheckout、EntryResolvers                                                                                     | `PurchaseOfferPolicy.describe`・`startYearTournamentCheckout`                             | 組み合わせ決定の日の23:45 |
| 4.5, 4.6, 4.7, 4.8, 4.9                        | 反映と参加資格             | YearEntryFulfillment、YearEntryStore                                                                                                        | `PurchaseFulfillment.prepare`                                                             | 参加の枠の状態            |
| 4.10                                           | 決済の縮退                 | YearEntryPanelReader、YearEntryPanel                                                                                                        | `myYearEntry.fee`                                                                         | —                         |
| 5.1                                            | 優勝時点の免除             | YearEntryRegistrar                                                                                                                          | `wasEntitledDuring`                                                                       | Week優勝の取り込み        |
| 5.2, 5.4                                       | 加入時点の免除             | YearUltrasEntryExemptionHandler、YearEntryStore                                                                                             | `ULTRAS_ACTIVATION_HANDLERS`・`grantByUltras`                                             | —                         |
| 5.3                                            | 未完了の決済の失効         | YearOpenEntryCheckoutExpiryHandler                                                                                                          | `OpenCheckoutExpirer.expireOpen`                                                          | —                         |
| 5.5                                            | 組み合わせ決定時点の免除   | YearDrawService                                                                                                                             | `entitledUsersDuring`・`wasEntitledDuring`                                                | 組み合わせ決定            |
| 5.6, 5.7, 5.8                                  | 免除の不変条件             | YearEntryRules、YearEntryFulfillment、YearUltrasEntryExemptionHandler                                                                       | —                                                                                         | 参加の枠の状態            |
| 6.1, 6.3                                       | 削除・退会による喪失       | ProductEntryLossHandler、AccountEntryLossHandler、YearEntryStore                                                                            | `PRODUCT_LIFECYCLE_ASYNC_HANDLERS`・`USER_LIFECYCLE_ASYNC_HANDLERS`                       | 参加資格の喪失と返金      |
| 6.2, 6.6, 6.8, 6.9                             | 返金の依頼と知らせ         | YearEntryFollowUp、RefundRejection、YearTournamentJobs、YearEntryRefundTemplate、YearEmailKinds                                             | `PaymentRefunds.request`・`refundRejectionOutcome`・`EmailSender.send`                    | 参加資格の喪失と返金      |
| 6.4, 6.5                                       | 停止・非公開化・上限の除外 | YearDrawService、YearCapacity、YearEntryStore                                                                                               | `ProductDirectory.findSummaries`・`selectWithinCapacity`                                  | 組み合わせ決定            |
| 6.7, 6.10                                      | 返金しない場合と境界       | YearEntryRules、YearEntryFollowUp                                                                                                           | —                                                                                         | —                         |
| 7.1, 7.2                                       | 時刻と凍結                 | YearDrawService、YearTournamentJobs                                                                                                         | `tournament-year.evening-bracket`                                                         | 組み合わせ決定の日の23:45 |
| 7.3, 7.4, 7.5, 7.6, 7.10                       | シードと組み合わせ         | LaunchOrdering、YearDrawService(tournament-weekの`BracketDraw`)                                                                             | `launchSeedOrder`・`launchNonSeedOrder`・`BracketDraw.create`                             | 組み合わせ決定            |
| 7.7, 7.8, 7.9                                  | 参加0・1・2                | YearDrawService、YearProgressionService、YearSchedule                                                                                       | `AdvanceResult`・`yearFirstRoundDate`                                                     | 組み合わせ決定            |
| 7.11                                           | 枠の結果の記録             | YearEntryStore                                                                                                                              | `classify`・`classified_year`                                                             | 組み合わせ決定            |
| 8.1, 8.2, 8.8, 8.9, 8.10                       | 日ごとの進行と回復         | YearProgressionService、RoundProgressHandler、YearTournamentJobs                                                                            | `BracketProgression.advance`・`dailyRoundPolicy`                                          | 組み合わせ決定の日の23:45 |
| 8.3, 8.4, 8.5, 8.6, 8.7                        | マッチの規則と不戦勝       | YearProgressionService(tournament-weekの`BracketProgression`・match-engine)                                                                 | `AdvanceResult`                                                                           | —                         |
| 9.1, 9.2, 9.3, 9.4                             | 終了と賞                   | YearProgressionService、YearTournamentStore                                                                                                 | `applyResult`・`recordFinish`                                                             | —                         |
| 9.5                                            | 掲載と賞を変えない         | YearEntryRules                                                                                                                              | —                                                                                         | —                         |
| 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8 | トップページの区画         | YearBoardReader、BoardResolvers、YearTournamentSection、YearFinalShowcase、TournamentClientParts                                            | `yearTournamentBoard`・`TOP_PAGE_SECTIONS`・`useTournamentBoard`                          | —                         |
| 11.1, 11.2, 11.3, 11.4, 11.5, 11.6             | ブラケットのページ         | YearBracketReader、BracketResolvers、YearBracketPage、TournamentClientParts                                                                 | `yearBracket`・`buildBracketRoundsView`・`TournamentBracketPage`                          | —                         |
| 12.1, 12.2, 12.3, 12.4, 12.5                   | 参加費の導線               | YearEntryPanelReader、EntryResolvers、YearEntryPanel、YearEntryView、YearEntryOwnerAction、YearEntryMyProductSection、TournamentClientParts | `myYearEntry`・`PRODUCT_OWNER_ACTIONS`・`MY_PRODUCT_SECTIONS`・`tournamentEntryDisplayOf` | —                         |
| 12.6                                           | 削除の注意書き             | YearEntryDeleteNotice                                                                                                                       | `PRODUCT_DELETE_NOTICES`                                                                  | —                         |
| 12.7                                           | トロフィー                 | YearTrophySource                                                                                                                            | `TOURNAMENT_TROPHY_SOURCES`                                                               | —                         |
| 12.8                                           | 要約と受賞の供給           | YearLaunchSummarySource                                                                                                                     | `LAUNCH_SUMMARY_SOURCES`                                                                  | —                         |
| 13.1, 13.2, 13.3, 13.4, 13.6                   | 再ローンチの禁止           | YearRelaunchConditionSource、YearCalendar                                                                                                   | `RELAUNCH_CONDITION_SOURCES`                                                              | —                         |
| 13.5                                           | 編集の固定                 | YearProductLockSource                                                                                                                       | `PRODUCT_LOCK_SOURCES`                                                                    | —                         |
| 14.1, 14.2, 14.3, 14.4, 14.5                   | 通知イベント               | YearNotificationPublisher、ViolationTolerantPublish、YearProgressionService、YearDrawService                                                | `publishExcludingViolations`・`NotificationEventPublisher.publish`                        | 組み合わせ決定の日の23:45 |
| 14.6                                           | 結果通知の追記             | YearEntrySupplementProvider                                                                                                                 | `RESULT_NOTICE_SUPPLEMENTS`                                                               | —                         |
| 14.7                                           | 夜の送り出しの準備の完了   | YearTournamentJobs                                                                                                                          | `EveningDispatchGate.markReady`・`EVENING_DISPATCH_PARTICIPANTS`                          | 組み合わせ決定の日の23:45 |
| 15.1                                           | ブラケットの再利用         | YearDrawService、YearProgressionService、YearBracketReader、LaunchOrdering、TournamentClientParts                                           | `BracketDraw`・`BracketProgression`・`BracketStore`・共用の部品(G2〜G6)                   | 組み合わせ決定            |
| 15.2, 15.3                                     | 帯の値と処理の順序         | YearTournamentJobs、各処理の登録                                                                                                            | `order` 1700・1710                                                                        | 組み合わせ決定の日の23:45 |
| 15.4                                           | 物理削除                   | EntryUnlinkHandler、YearEntryStore                                                                                                          | `PRODUCT_LIFECYCLE_ASYNC_HANDLERS`                                                        | —                         |
| 15.5                                           | エクスポート               | YearAwardExport                                                                                                                             | `listForLaunches`                                                                         | —                         |
| 15.6, 15.7                                     | ログと検知                 | 全コンポーネント(ログの規約)、YearTournamentJobs、YearTournamentIncidentReporter                                                            | `getAppLogger`・`captureEvent`・`YearTournamentIncidentReporter.report`                   | —                         |
| 15.8                                           | 問い合わせの集約           | YearBoardReader、YearBracketReader                                                                                                          | `matchViewLoader`・`MatchViewReader.findViews`                                            | —                         |
| 16.1, 16.2, 16.3, 16.4                         | テスト                     | Testing Strategy、YearTournamentE2E、YearTournamentFixtures、`tournament-year-migration.unit.test.ts`                                       | `triggerScheduled`                                                                        | —                         |
| 16.5                                           | 技術ドキュメント           | YearTechDocs(`backend/019`の新設と`frontend/012`への追記、G7)                                                                               | —                                                                                         | —                         |
| 16.6                                           | サービス仕様               | YearServiceSpecs                                                                                                                            | —                                                                                         | —                         |

## Components and Interfaces

| Component                                                                                             | Domain/Layer                                                            | Intent                                                                 | Req Coverage                                                              | Key Dependencies (P0/P1)                                                         | Contracts      |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------- |
| YearTournamentSchema                                                                                  | db                                                                      | 2テーブル                                                              | 7.11, 9.4, 15.4                                                           | product-launch・identity-authのテーブル(P0)                                      | State          |
| YearAuditActions                                                                                      | common-lib                                                              | 監査ログの操作種別                                                     | 2.10                                                                      | defineAuditAction(P0)                                                            | Service        |
| YearSchedule・FinalDateChoice・YearTargetRules                                                        | core/year-tournament                                                    | 決勝日・期限・選べる日付・対象年                                       | 1.1〜1.6, 2.4〜2.6, 2.8, 2.12, 3.4〜3.6, 3.9                              | `BusinessTime`(P0)、`bracketShape`(P0)                                           | Service        |
| YearCapacity・YearEntryRules                                                                          | core/year-tournament                                                    | 上限・枠の状態・返金の理由と依頼キー                                   | 5.6〜5.8, 6.5, 6.7, 9.5                                                   | `RefundRejectionOutcome`(P0)                                                     | Service        |
| YearEmailKinds                                                                                        | core/email/kinds(`tournament-year.ts`)                                  | 返金の知らせのメール種別                                               | 6.9                                                                       | `defineEmailKind`(P0)                                                            | Service        |
| LaunchOrdering・RefundRejection(共用、G2・G4)                                                         | core/tournament                                                         | シード・非シードの並び、返金の拒否の写像                               | 6.8, 7.4, 7.5, 15.1                                                       | `Comparator`(P0)、`RefundRequestResult`(P0)                                      | Service        |
| ViolationTolerantPublish(共用、G3)                                                                    | core/notifications                                                      | 違反を除いた通知の発行                                                 | 14.5                                                                      | NotificationEventPublisher(P0)                                                   | Service        |
| BusinessDateArithmetic(共用、G5)                                                                      | core/time                                                               | 業務日付の日数の加算と曜日                                             | 1.1, 1.2, 1.4, 2.4〜2.6                                                   | `BusinessTime`(P0)                                                               | Service        |
| YearTournamentStore・YearEntryStore・YearCalendar                                                     | core/year-tournament(契約・識別子)・workers/year-tournament(実装・束縛) | 年と枠の読み書き、年の照会と対象年                                     | 1.1〜1.3, 3.3〜3.9, 4.5, 5.2, 6.1, 7.11, 9.4, 15.4                        | Database(P0)                                                                     | Service, State |
| YearEntryRegistrar                                                                                    | core/year-tournament(契約・識別子)・workers/year-tournament(実装・束縛) | Week優勝からの枠の作成                                                 | 3.1, 3.2, 3.3, 3.7, 5.1                                                   | WeekChampionDirectory(P0)、MatchDirectory(P0)、UltrasEntitlements(P0)            | Service, Batch |
| YearEntryOfferPolicy・YearEntryFulfillment・YearTournamentRegistrations                               | workers/year-tournament(paymentsの契約の実装と登録の定数)               | 購入種別`year_tournament_entry`                                        | 4.1〜4.9, 5.6, 5.7                                                        | payments(P0)                                                                     | Service        |
| YearDrawService・YearProgressionService・YearNotificationPublisher                                    | core/year-tournament(契約・識別子)・workers/year-tournament(実装・束縛) | 組み合わせ決定・進行と賞・通知                                         | 1.4, 1.5, 5.5, 6.4, 6.5, 7.1〜7.10, 8.1〜8.10, 9.1〜9.4, 14.1〜14.5, 15.1 | BracketDraw(P0)、BracketProgression(P0)、NotificationEventPublisher(P0)          | Service, Batch |
| YearEntryFollowUp・YearAwardExport                                                                    | core/year-tournament(契約・識別子)・workers/year-tournament(実装・束縛) | 返金と知らせ・エクスポート                                             | 6.2, 6.6, 6.8, 6.9, 6.10, 15.5                                            | PaymentRefunds(P0)、UserContactDirectory(P0)                                     | Service        |
| YearBoardReader・YearBracketReader・YearEntryPanelReader・YearEntryCheckout                           | api/application                                                         | 照会と決済の開始                                                       | 4.1〜4.4, 4.10, 10.1〜10.8, 11.1〜11.6, 12.1〜12.5, 15.8                  | MatchViewReader(P0)、CheckoutStarter(P0)、buildBracketRoundsView(P0)             | Service        |
| YearFinalDateService・D1YearFinalDateWriter                                                           | api                                                                     | 決勝日の照会と保存                                                     | 2.1〜2.13                                                                 | AuditLogRecorder(P0)、YearCalendar(P0)                                           | Service, State |
| YearRelaunchConditionSource・YearProductLockSource・YearLaunchSummarySource・YearTrophySource         | api/application                                                         | product-launch・トロフィーへの供給                                     | 12.7, 12.8, 13.1〜13.6                                                    | YearEntryStore(P0)、BracketStore(P0)、WeekChampionDirectory(P1)                  | Service        |
| YearTournamentJobs・YearTournamentIncidentReporter                                                    | api/application(ジョブとポート)・api/infrastructure(Sentryの実装)       | 2つのジョブと夜の送り出しの準備の完了・失敗の通知                      | 3.1, 6.8, 7.1, 8.2, 14.7, 15.2, 15.3, 15.6, 15.7                          | YearDrawService(P0)、EveningDispatchGate(P0)                                     | Batch          |
| YearTournamentSchemaModule(BoardResolvers・BracketResolvers・EntryResolvers・FinalDateResolvers)      | api/presentation                                                        | GraphQL                                                                | 2.1〜2.13, 4.1〜4.4, 10.1〜10.8, 11.1〜11.6, 12.1〜12.8                   | 上記の照会(P0)                                                                   | API            |
| WeekChampionEntryHandler・RoundProgressHandler                                                        | event                                                                   | 確定のマッチイベントの処理                                             | 3.1, 8.2                                                                  | MATCH_EVENT_HANDLERS(P0)                                                         | Event          |
| ProductEntryLossHandler・AccountEntryLossHandler・EntryUnlinkHandler                                  | event                                                                   | ライフサイクルの処理                                                   | 6.1〜6.3, 15.4                                                            | ライフサイクルの登録口(P0)                                                       | Event          |
| YearUltrasEntryExemptionHandler・YearOpenEntryCheckoutExpiryHandler                                   | event                                                                   | Ultrasの知らせの処理                                                   | 5.2〜5.4, 5.7                                                             | ULTRAS_ACTIVATION_HANDLERS(P0)、OpenCheckoutExpirer(P0)                          | Event          |
| YearEntrySupplementProvider・YearEntryRefundTemplate                                                  | event                                                                   | 結果通知の追記・返金の知らせ                                           | 6.9, 14.6                                                                 | RESULT_NOTICE_SUPPLEMENTS(P0)、EMAIL_TEMPLATES(P0)                               | Service        |
| TournamentClientParts(共用、G6)                                                                       | client(`components/tournament/`)                                        | 盤面・決勝の演出・ブラケットのページ・参加費の導線の種類によらない部品 | 10.1〜10.8, 11.1〜11.5, 12.1〜12.5                                        | MatchCard(P0)、ByeList(P0)、`components/bracket/`(P0)、useUpvote(P0)             | State          |
| YearTournamentSection・YearFinalShowcase・UseYearBoard                                                | client(`components/year-tournament/`)                                   | トップページの区画                                                     | 10.1〜10.8                                                                | TournamentClientParts(P0)                                                        | State          |
| YearBracketPage                                                                                       | client                                                                  | ブラケットのページ                                                     | 11.1〜11.6                                                                | TournamentClientParts(P0)、`BracketRoundFields`・`BracketMatchProductFields`(P0) | State          |
| YearEntryPanel・YearEntryView・YearEntryOwnerAction・YearEntryMyProductSection・YearEntryDeleteNotice | client(`components/year-tournament/`)                                   | プロダクトの画面の区画                                                 | 12.1〜12.6                                                                | myYearEntry(P0)、TournamentClientParts(P0)                                       | State          |
| FinalDateSection・FinalDateYearCard・FinalDateForm・FinalDateLabels                                   | admin(`components/year-tournament/`)                                    | 設定ページの区画                                                       | 2.1〜2.3, 2.11〜2.13                                                      | ADMIN_SETTINGS_SECTIONS(P0)、RoleGate(P0)、ConfirmActionDialog(P0)               | State          |
| YearTechDocs・YearServiceSpecs・YearTournamentE2E・YearTournamentFixtures                             | docs・e2e                                                               | 文書とE2E                                                              | 16.1〜16.6                                                                | admin-bootstrap(P0)、local-d1(P0)                                                | —              |

### db

#### YearTournamentSchema

- 列と索引は「Physical Data Model」に示す。外部キーは`ON DELETE`を指定しない(物理削除の前に紐付けを解除する)。`week_tournament_id`・`purchase_id`・`final_date_updated_by_admin_id`は他のspecの識別子で外部キーを張らない(他のspecのテーブルを直接読まない)。

### common-lib

#### YearAuditActions

```typescript
// common-lib/admin/audit-actions/tournament-year.ts
export declare const TOURNAMENT_YEAR_AUDIT_ACTIONS: readonly [
  AuditActionDefinition, // name 'year-final-date.update'・label 'Yearトーナメント決勝実施日の変更'・targetKind 'setting'・reason 'optional'・detailKeys ['year', 'fromDate', 'toDate', 'fromSource']・maxTargets 1
];
```

- 対象の識別子は`year-final-date:<対象年>`(1〜64文字の`[A-Za-z0-9._:-]`の規則を満たす)。詳細の値は日付と`explicit`・`default`だけで、個人情報を含まない(2.10)。

### backend-lib/core/year-tournament

#### YearSchedule・FinalDateChoice・YearTargetRules

| Field        | Detail                                                            |
| ------------ | ----------------------------------------------------------------- |
| Intent       | 決勝日を起点とする期限・1回戦の日・選べる日付・対象年の純粋な規則 |
| Requirements | 1.1, 1.2, 1.4, 1.6, 2.4, 2.5, 2.6, 2.8, 2.12, 3.4, 3.5, 3.6, 3.9  |

**Contracts**: Service [x]

```typescript
// year-schedule.ts(BusinessDateは'YYYY-MM-DD'の業務日付)
export declare const YEAR_ENTRY_PRICE_LOOKUP_KEY: 'year_tournament_entry';
export declare const YEAR_MAX_PARTICIPANTS: 64;
export declare const FINAL_DATE_MIN_LEAD_DAYS: 8; // FR-ADMCF-002
export declare const FINAL_DATE_MAX_GAP_DAYS: 448; // 64週(FR-ADMCF-003)
export interface YearSchedule {
  readonly year: number;
  readonly finalDate: BusinessDate;
  readonly deadlineDate: BusinessDate; // 決勝日の6日前
  readonly acceptUntil: Date; // 同23:00
  readonly deadlineAt: Date; // 同23:35
  readonly drawAt: Date; // 同23:45
  readonly changeLockAt: Date; // 決勝日の7日前の0:00
}
export declare function defaultFinalDate(year: number): BusinessDate; // 5月の最終日曜日
export declare function yearScheduleFor(
  year: number,
  finalDate: BusinessDate,
): YearSchedule;
export declare function yearFirstRoundDate(
  finalDate: BusinessDate,
  participantCount: number,
): BusinessDate | null;
// N≤1はnull、それ以外は決勝日 −(bracketShape(N).roundCount − 1)日。N>64は例外(上限は呼び出し元が先に適用する)

// final-date-choice.ts
export type FinalDateViolation =
  | 'year_not_editable' // 現在の年と翌年以外
  | 'not_sunday'
  | 'out_of_year'
  | 'too_soon' // その日の0:00が現在から8日後より前
  | 'too_far_from_previous' // 前年の決勝日の448日後以降
  | 'too_far_from_next' // 翌年の設定済みの決勝日が448日後以降
  | 'locked'; // 変更前の変更期限以降、または凍結済み
export interface FinalDateContext {
  readonly year: number;
  readonly now: Date;
  readonly current: YearSchedule; // 変更前の実効の日程
  readonly drawStarted: boolean;
  readonly previousFinalDate: BusinessDate | null; // 仮1の「設定されている」とき
  readonly nextExplicitFinalDate: BusinessDate | null; // 翌年が設定済みのとき(仮8)
}
export declare function editableYears(now: Date): readonly [number, number]; // 現在の業務日付の年と翌年
export declare function isFinalDateChangeable(
  context: FinalDateContext,
): boolean; // now < current.changeLockAtかつ未凍結
export declare function checkFinalDateChoice(
  date: BusinessDate,
  context: FinalDateContext,
): FinalDateViolation | null;
export declare function finalDateChoices(
  context: FinalDateContext,
): readonly BusinessDate[]; // 対象年の日曜日のうちcheckがnull、昇順(変更できなければ空)
export declare function nextYearGapWarning(input: {
  readonly finalDate: BusinessDate;
  readonly nextYearDefault: BusinessDate | null; // 翌年が未設定のときの既定の日
}): BusinessDate | null; // 既定の日が448日後以降ならその日(2.12)

// year-target-rules.ts
export type YearState =
  | 'planned' // 行が無く、組み合わせ決定の時刻が未来(開催する予定)
  | 'open' // 行があり、凍結していない
  | 'frozen' // 凍結済み
  | 'not_held'; // 行が無く、組み合わせ決定の時刻を過ぎた(開催しなかった)
export interface YearCalendarYear {
  readonly year: number;
  readonly schedule: YearSchedule;
  readonly source: 'explicit' | 'default';
  readonly state: YearState;
}
export type TargetYearResolution =
  | { readonly kind: 'open'; readonly year: YearCalendarYear }
  | { readonly kind: 'late'; readonly year: number };
export declare function resolveTargetYear(
  awardedDate: BusinessDate,
  lookup: (year: number) => YearCalendarYear,
): TargetYearResolution;
// Week優勝の日の年から順に、not_heldを飛ばし、awardedDate < deadlineDateの最初の年を選ぶ。frozenならlate、planned・openならopen
export declare function isPreviousYearSet(previous: YearCalendarYear): boolean; // planned・open・frozenなら真(仮1)
```

- 曜日・月末・日数の計算は`BusinessTime`の業務日付で、`core/time`の`addBusinessDays`・`businessWeekdayOf`(G5)を使い、UTCの日付と取り違えない。`yearScheduleFor`は決勝日が対象年の日曜日でなければ例外にする(検証は`checkFinalDateChoice`が先に行う)。
- `checkFinalDateChoice`の順: `year_not_editable`→`locked`→`not_sunday`→`out_of_year`→`too_soon`(`fromBusinessDateTime(date, 0:00) < now + 8日`)→`too_far_from_previous`(`date ≥ previous + 448日`)→`too_far_from_next`(`next ≥ date + 448日`)(2.4〜2.8)。
- `resolveTargetYear`は高々4年(Week優勝の日の年〜3年後)を調べる。1月初旬の決勝日で決済期限日が前年の12月になる場合も、決済期限日の比較で正しく選ぶ(3.4・3.5・3.9)。

#### YearCapacity・YearEntryRules・YearEmailKinds

**Contracts**: Service [x]

```typescript
// core/year-tournament/year-capacity.ts
export declare function selectWithinCapacity<
  T extends {
    readonly ref: string;
    readonly awardedAt: Date;
    readonly tieBreaker: string;
  },
>(
  entries: readonly T[],
  max: number,
): { readonly kept: readonly T[]; readonly overflow: readonly T[] }; // Week優勝の日時の新しい順(同時刻はtieBreakerの昇順)にmax件を残す

// core/year-tournament/year-entry-rules.ts
export type YearEntryStatus =
  | 'awaiting_payment'
  | 'entitled'
  | 'drawn'
  | 'expired'
  | 'forfeited'
  | 'excluded';
export type YearEntryCloseReason =
  | 'deadline'
  | 'deleted'
  | 'withdrawn'
  | 'hidden_or_suspended'
  | 'over_capacity'
  | 'late_entry';
export type YearEntitlementSource = 'payment' | 'ultras';
export declare const YEAR_REFUND_REASONS: readonly [
  'entitlement_lost',
  'entitlement_suspended',
  'capacity_exceeded',
];
export type YearRefundReason = (typeof YEAR_REFUND_REASONS)[number];
// none: 返金の対象外か未判定、pending: 依頼待ち、requested: 依頼済み、not_needed: 購入が無い・未払い、
// already_refunded: 返金できる残額が無い(管理者の返金・異議など)、rejected: 依頼の形式の誤り(G4)
export type YearRefundStatus =
  | 'none'
  | 'pending'
  | 'requested'
  | 'not_needed'
  | 'already_refunded'
  | 'rejected';
export declare const OPEN_ENTRY_STATUSES: readonly [
  'awaiting_payment',
  'entitled',
];
export declare function refundReasonFor(
  status: 'forfeited' | 'excluded',
  closeReason: YearEntryCloseReason,
): YearRefundReason; // forfeited→entitlement_lost、excluded+over_capacity→capacity_exceeded、excluded→entitlement_suspended
export declare function yearRefundRequestKey(
  purchaseId: string,
  reason: YearRefundReason,
): string; // 'tournament-year:<購入ID>:<理由>'

// core/email/kinds/tournament-year.ts(email-deliveryの置き場所の規約。Weekのtournament-week.tsと同じ形)
// 入力のスキーマ: nickname・yearLabel('2027年')・weekLabel(formatWeekPeriodLabel)・reason(z.enum(YEAR_REFUND_REASONS))・billingUrl(linkUrl、<client>/settings/billing)
export type YearEntryRefundEmailInput = {
  readonly nickname: string;
  readonly yearLabel: string;
  readonly weekLabel: string;
  readonly reason: YearRefundReason;
  readonly billingUrl: string;
};
export declare const TOURNAMENT_YEAR_ENTRY_REFUND_KIND: EmailKind<
  'tournament-year.entry-refund',
  YearEntryRefundEmailInput
>; // defineEmailKind({ name, category: 'transactional', inputSchema })
export declare const TOURNAMENT_YEAR_EMAIL_KINDS: readonly AnyEmailKind[];
```

- シード・非シードの並びは、Weekと共用の`core/tournament/launch-ordering.ts`の`launchSeedOrder`・`launchNonSeedOrder`(比較の型`LaunchOrderingKey`)を使う(G2。Yearトーナメント規則はWeekと同じ並びを定める)。
- 免除・決済で得た参加資格(`entitled`・`drawn`)は、Ultrasの解約や特典の終了で戻さない(5.8)。決済済みの参加費をUltrasの加入で返金しない(5.6)。参加資格の状態はWeekの賞と掲載に影響しない(9.5)。組み合わせ決定の後の不戦敗では返金しない(6.7)。

#### LaunchOrdering・RefundRejection・ViolationTolerantPublish・BusinessDateArithmetic(共用、G2〜G5)

| Field        | Detail                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Intent       | WeekとYearで同じ規則を種類によらない名前で1か所に置く。tournament-weekの非公開・Week名の実装から移す |
| Requirements | 1.1, 1.2, 1.4, 2.4, 2.5, 2.6, 6.8, 7.4, 7.5, 14.5, 15.1                                              |

**Contracts**: Service [x]

```typescript
// core/tournament/launch-ordering.ts(core/week-tournament/week-ordering.tsから移す。規則は変えない)
export interface LaunchOrderingKey {
  readonly launchDate: BusinessDate;
  readonly upvoteCount: number;
  readonly lastUpvoteElapsedMs: number | null; // 勝利した予選の開始からの経過。null(Upvote数0)は末尾
}
export declare const launchSeedOrder: Comparator<LaunchOrderingKey>; // Upvote数の降順→最終Upvote時間の昇順
export declare const launchNonSeedOrder: Comparator<LaunchOrderingKey>; // ローンチ日の昇順→Upvote数の降順→最終Upvote時間の昇順

// core/tournament/refund-rejection.ts(core/week-tournament/week-entry-rules.tsから移す。写像は変えない)
export type RefundRejectionCode = Extract<
  RefundRequestResult,
  { readonly kind: 'rejected' }
>['code'];
export type RefundRejectionOutcome =
  | { readonly refundStatus: 'not_needed'; readonly report: false } // not_paid・purchase_not_found
  | { readonly refundStatus: 'already_refunded'; readonly report: true } // amount_exceeds_refundable
  | { readonly refundStatus: 'rejected'; readonly report: true }; // invalid_amount・invalid_request_key
export declare function refundRejectionOutcome(
  code: RefundRejectionCode,
): RefundRejectionOutcome;

// core/notifications/violation-tolerant-publish.ts(workers/week-tournament/week-notification-publisher.tsの非公開の処理から移す)
export declare function publishExcludingViolations(input: {
  readonly publisher: NotificationEventPublisher;
  readonly name: string; // NotificationPublishRequest.publisher('tournament-week'・'tournament-year')
  readonly events: readonly NotificationEvent[];
  readonly at: Date;
  readonly logger: Logger;
}): Promise<void>;
// NOTIFICATION_PUBLISH_EVENT_LIMIT(50)件ずつ発行し、NotificationPublishErrorのeventIndexの1件を除いて同じ組を発行し直す。
// match-not-previewableの除外はinfo、それ以外の位置のある違反はerrorのログ(マッチ・プロダクトのIDと理由だけ)。位置の無い拒否・範囲外の位置・一時的な失敗は例外のまま投げる

// core/time/business-time.ts(追加の公開。既存の非公開のisoWeekdayOf・addDaysを使う)
export declare function addBusinessDays(
  date: BusinessDate,
  days: number, // 負の数で前の日
): BusinessDate;
export declare function businessWeekdayOf(date: BusinessDate): IsoWeekday; // 1(月)〜7(日)
```

- 移設の手順: 移す先へ実装と単体テストを移し、tournament-weekの参照(「上流への影響」のtournament-weekの行)を書き換え、移す元から削る。Weekの組み合わせ・返金・通知の振る舞いと、Weekの単体テスト・Workers統合テストの期待値は変えない。
- `addBusinessDays`は既存の5か所(`week-schedule.ts`・`round-schedule.ts`の`nextBusinessDate`・`launch-date-rules.ts`・`match-jobs.ts`・`evening-collector.ts`)の計算と同じ結果になる(業務時刻は固定のオフセットで夏時間が無いため、0:00に日数分のミリ秒を足した時点の業務日付)。単体テストで年・月・うるう年の境界と負の日数を確かめ、各呼び出し元の既存のテストがそのまま通ることを確かめる。`common-lib/tournament/week-period.ts`の`addDays`はclientも使うcommon-libの中の計算のため対象外とする(common-libはbackend-libを読み込めない)。
- `core/notifications/violation-tolerant-publish.ts`はロガーを`@logtape/logtape`の`Logger`型で受け取り(`core/logging/app-logger.ts`と同じ依存)、ロガーの名前は呼び出し元が決める。

### backend-lib/core/year-tournament・workers/year-tournament(共有部品)

契約と識別子は`core/year-tournament`(`ports.ts`・`identifiers.ts`)に、実装と束縛は`workers/year-tournament`に置く。api・eventのapplication層とdata-exportは`core/year-tournament`だけを読み込む。

#### YearTournamentStore・YearEntryStore・YearCalendar

| Field        | Detail                                                                           |
| ------------ | -------------------------------------------------------------------------------- |
| Intent       | 年と枠の読み書き、行と既定の日をまとめた年の照会と対象年の判定                   |
| Requirements | 1.1, 1.2, 1.3, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.5, 5.2, 6.1, 7.11, 9.4, 15.4 |

**Contracts**: Service [x] / State [x]

```typescript
// core/year-tournament/ports.ts(YearSchedule・YearCalendarYear・TargetYearResolution・YearEntryStatusなどはcore/year-tournamentの規則、AdvanceResultはcore/tournamentから読み込む)
export interface YearTournamentRecord {
  readonly yearTournamentId: string;
  readonly year: number;
  readonly schedule: YearSchedule; // 行の列(final_date・deadline_date・accept_until・deadline_at・draw_at・change_lock_at)
  readonly source: 'explicit' | 'default';
  readonly version: number; // 決勝日の版(0は未設定)
  readonly updatedAt: Date | null;
  readonly updatedByAdminId: string | null;
  readonly status: 'open' | 'drawing' | 'in_progress' | 'finished';
  readonly drawStartedAt: Date | null;
  readonly bracketId: string | null;
  readonly firstRoundDate: BusinessDate | null;
  readonly participantCount: number | null;
  readonly outcome: 'awarded' | 'no_award' | null;
  readonly championEntryId: string | null;
  readonly awardedAt: Date | null;
}
export interface YearTournamentStore {
  ensureYear(
    year: number,
    schedule: YearSchedule,
    at: Date,
  ): Promise<YearTournamentRecord>; // yearの一意索引でonConflictDoNothing、既定の日の列で作る
  findByYears(
    years: readonly number[],
  ): Promise<ReadonlyMap<number, YearTournamentRecord>>;
  findById(yearTournamentId: string): Promise<YearTournamentRecord | undefined>;
  listDue(now: Date, limit: number): Promise<readonly YearTournamentRecord[]>; // draw_at ≤ nowかつopen・drawing、年の昇順
  listInProgress(limit: number): Promise<readonly YearTournamentRecord[]>;
  latestFrozenDeadlineDate(): Promise<BusinessDate | null>;
  freeze(yearTournamentId: string, at: Date): Promise<'frozen' | 'already'>;
  markDrawn(
    yearTournamentId: string,
    input: {
      readonly bracketId: string;
      readonly firstRoundDate: BusinessDate | null;
      readonly participantCount: number;
      readonly finished: {
        readonly outcome: 'awarded' | 'no_award';
        readonly championEntryId: string | null;
      } | null;
    },
    at: Date,
  ): Promise<void>;
  recordFinish(
    yearTournamentId: string,
    outcome: 'awarded' | 'no_award',
    championEntryId: string | null,
    at: Date,
  ): Promise<boolean>; // status ≠ finishedの条件付き。確定させたらtrue
  listAwardedBetween(
    from: Date,
    to: Date,
  ): Promise<readonly YearAwardedProduct[]>; // awarded_at ∈ [from, to)でoutcome = 'awarded'の年。紐付けを解除した優勝の枠は除く(G1の夜の発行)
  listAwardsByProducts(productIds: readonly string[]): Promise<
    readonly {
      readonly productId: string;
      readonly launchId: string;
      readonly year: number;
      readonly awardedAt: Date;
    }[]
  >; // 90件ずつ、紐付けを解除した受賞は除く
}
export interface YearAwardedProduct {
  readonly yearTournamentId: string;
  readonly year: number;
  readonly productId: string;
}
export interface YearEntryRecord {
  readonly entryId: string;
  readonly weekTournamentId: string;
  readonly weekPeriod: string; // '2026-W37'
  readonly launchId: string | null;
  readonly productId: string | null;
  readonly ownerUserId: string | null;
  readonly launchDate: BusinessDate;
  readonly qualifierUpvoteCount: number;
  readonly qualifierLastUpvoteElapsedMs: number | null;
  readonly awardedAt: Date;
  readonly awardedDate: BusinessDate;
  readonly status: YearEntryStatus;
  readonly entitlementSource: YearEntitlementSource | null;
  readonly purchaseId: string | null;
  readonly closeReason: YearEntryCloseReason | null;
  readonly classifiedYear: number | null;
  readonly refundStatus: YearRefundStatus;
  readonly refundNoticeStatus: 'none' | 'pending' | 'sent' | 'skipped';
}
export interface NewYearEntry {
  readonly entryId: string;
  readonly weekTournamentId: string;
  readonly weekPeriod: string;
  readonly launchId: string;
  readonly productId: string;
  readonly ownerUserId: string;
  readonly launchDate: BusinessDate;
  readonly qualifierMatchId: string;
  readonly qualifierUpvoteCount: number;
  readonly qualifierLastUpvoteElapsedMs: number | null;
  readonly awardedAt: Date;
  readonly awardedDate: BusinessDate;
  readonly initialStatus: 'awaiting_payment' | 'entitled'; // entitledは出どころultras
}
export interface YearCandidateRange {
  readonly awardedFrom: BusinessDate | null;
  readonly awardedBefore: BusinessDate;
}
export interface YearEntryStore {
  insertFromChampion(
    entry: NewYearEntry,
    at: Date,
  ): Promise<'inserted' | 'late' | 'exists'>; // 凍結済みの年の決済期限日が後ならexpired(late_entry)
  findByWeekTournaments(ids: readonly string[]): Promise<ReadonlySet<string>>; // 90件ずつ
  findByLaunches(
    launchIds: readonly string[],
  ): Promise<ReadonlyMap<string, YearEntryRecord>>; // 90件ずつ
  findEntry(entryId: string): Promise<YearEntryRecord | undefined>;
  listOpenByOwner(userId: string): Promise<readonly YearEntryRecord[]>;
  listLaunchIdsByProduct(productId: string): Promise<readonly string[]>; // 枠の状態によらず重複を除いたローンチのIDの昇順。紐付けを解除した枠は含めない
  listCandidates(
    range: YearCandidateRange,
    afterEntryId: string | undefined,
    limit: number,
  ): Promise<readonly YearEntryRecord[]>; // awaiting_payment・entitledでawarded_dateが[awardedFrom, awardedBefore)、awardedFromがnullなら下限なし
  listDrawn(year: number): Promise<readonly YearEntryRecord[]>;
  grantByUltras(
    entryIds: readonly string[],
    at: Date,
  ): Promise<readonly string[]>; // awaiting_paymentかつ凍結の対象外の条件付き
  forfeitByProduct(productId: string, at: Date): Promise<readonly string[]>; // 凍結の対象外のawaiting_payment・entitled
  forfeitByOwner(userId: string, at: Date): Promise<readonly string[]>;
  classify(
    year: number,
    updates: readonly {
      readonly entryId: string;
      readonly status: 'drawn' | 'expired' | 'forfeited' | 'excluded';
      readonly closeReason: YearEntryCloseReason | null;
      readonly entitlementSource?: 'ultras';
    }[],
    at: Date,
  ): Promise<void>; // 50件ずつ、status IN (awaiting_payment, entitled)の条件付き
  excludeOverCapacity(
    year: number,
    entryIds: readonly string[],
    at: Date,
  ): Promise<void>; // status = 'drawn'の条件付き
  listPendingFollowUps(
    olderThan: Date,
    limit: number,
  ): Promise<readonly YearEntryRecord[]>;
  markRefundRequested(entryId: string, at: Date): Promise<void>;
  markRefundClosed(
    entryId: string,
    status: 'not_needed' | 'already_refunded' | 'rejected',
    at: Date,
  ): Promise<void>; // refund_status = 'pending'の条件付き。知らせは待ちにしない(G4)
  markNotice(
    entryId: string,
    status: 'sent' | 'skipped',
    at: Date,
  ): Promise<void>;
  unlinkOrDeleteByProduct(
    productId: string,
  ): Promise<{ readonly unlinked: number; readonly deleted: number }>;
}
export interface YearCalendar {
  describe(
    years: readonly number[],
    now: Date,
  ): Promise<
    ReadonlyMap<
      number,
      YearCalendarYear & { readonly record: YearTournamentRecord | null }
    >
  >;
  resolveAward(
    awardedDate: BusinessDate,
    now: Date,
  ): Promise<TargetYearResolution>;
  upcoming(now: Date): Promise<YearCalendarYear>; // 現在の年から順に、planned・openの最初の年
  ensureUpcoming(now: Date): Promise<YearTournamentRecord>; // upcomingの行が無ければ既定の日で作る
  openPeriodStart(now: Date): Promise<Date | null>; // 凍結済みの最新の年の決済期限日の0:00(無ければnull)
}
// workers/year-tournament/d1-year-tournament-store.ts・d1-year-entry-store.ts
export declare class D1YearTournamentStore implements YearTournamentStore {
  constructor(db: Database); // @inject(PLATFORM_TYPES.Database)
}
export declare class D1YearEntryStore implements YearEntryStore {
  constructor(db: Database); // @inject(PLATFORM_TYPES.Database)
}
```

- 「凍結の対象外」の条件は、各文に`AND NOT EXISTS (SELECT 1 FROM year_tournaments y WHERE y.draw_started_at IS NOT NULL AND y.deadline_date > year_tournament_entries.awarded_date)`を付けて表す(4.7・5.2・6.1)。
- `insertFromChampion`は1文の`INSERT ... SELECT`で、上の条件の否定(凍結済みの年が後)なら`status = 'expired'`・`close_reason = 'late_entry'`・`classified_year`(その年の最小)・`refund_status = 'not_needed'`、それ以外は`initialStatus`(`entitled`なら`entitlement_source = 'ultras'`)で挿入し、衝突先を指定しない`ON CONFLICT DO NOTHING`(`week_tournament_id`の一意索引)で重複を無視する。同じ文の`RETURNING status`で`inserted`・`late`を返し、行が返らなければ`exists`とする(3.3・3.7)。
- `describe`は対象の年の行を1回で読み、行の無い年は`defaultFinalDate`から日程を求め、`drawAt > now`なら`planned`、それ以外は`not_held`とする。行は`draw_started_at`の有無で`open`・`frozen`。`describe`・`resolveAward`は行を作らない。`resolveAward`は`describe`(Week優勝の日の年〜3年後)と`resolveTargetYear`を使う(3.4〜3.6・3.9)。組み合わせ決定の分類が終わる前の終わっていない枠は、`resolveAward`が凍結済みのその年を`late`として返す。参加費の導線・再ローンチの供給元は、終わっていない枠の`late`を「組み合わせ決定の途中の年」として扱い、期限切れとはみなさない。
- `openPeriodStart`は凍結済みの行の`deadline_date`の最大の日の0:00を返す。
- `listCandidates`の範囲は、組み合わせ決定がその年の決済期限日を上限にし、前年の行があるときだけ前年の行の決済期限日を下限にする。遅れの回復で2年が同時に到来し前の年が分類の途中で失敗しても、後の年が前の年の受付中の枠を分類しないためで、前年の行が無ければ(初年度の繰り越し)下限を設けない。
- `listLaunchIdsByProduct`は、プロダクトの削除の処理が未完了の決済を失効させるローンチを求める。`forfeitByProduct`は書き換えた枠しか返さないため、再試行で失効の対象を失わないよう枠の状態によらずに読む。
- 契約のうち名前の無いインラインの型は、実装で`YearDrawRecord`(`markDrawn`の入力。受賞なら優勝が必須の`YearTournamentFinish`)・`YearProductAward`・`YearCalendarEntry`(`YearCalendarYear & { record }`)・`YearEntryClassification`・`YearRefundClosedStatus`・`YearAward`と名付けた。
- 期限の列は行の作成時と決勝日の保存時に`yearScheduleFor`で求めて保存し、以後の判定はすべて列を読む(`yearScheduleFor`を呼び直さない)。E2Eの補助は列を書き換えて時刻を進められる(1.3)。
- 年の行は`ensureUpcoming`・決勝日の保存でだけ作り、組み合わせ決定の時刻を過ぎた年には作らない(作るとその年の組み合わせ決定が遅れの回復として動くため)。
- `unlinkOrDeleteByProduct`: `drawn`・`classified_year`があり組み合わせに入った枠は`product_id`・`launch_id`・`owner_user_id`をnullにし、それ以外の枠は削除する(15.4)。年の行の`champion_entry_id`は残り、紐付けを解除した受賞は照会とエクスポートから除く。ブラケットの参加者の紐付けはtournament-weekの`tournament-week.entry-unlink`が種類によらず解除する。

#### YearEntryRegistrar

| Field        | Detail                                       |
| ------------ | -------------------------------------------- |
| Intent       | Week優勝からの参加の枠の作成と優勝時点の免除 |
| Requirements | 3.1, 3.2, 3.3, 3.7, 5.1                      |

**Contracts**: Service [x] / Batch [x]

```typescript
// core/year-tournament/ports.ts
export interface YearEntryRegistrar {
  syncChampions(input: {
    readonly awardedFrom: Date | null;
    readonly now: Date;
  }): Promise<{
    readonly created: readonly string[];
    readonly late: readonly string[];
    readonly skipped: number;
  }>;
}
```

- 手順はSystem Flows「Week優勝の取り込み」。1回の呼び出しの読み取りは、`listChampions` 1回・`findByWeekTournaments`・`findQualifierResults`・`findMatches`(各90件ずつ)・`YearCalendar.describe` 1回・`entitledUsersDuring`(候補を絞る)と、絞った投稿者ごとの`wasEntitledDuring`に限る。遅れと予選が見つからない枠は`captureEvent`(`warning`、fingerprint`['tournament-year', 'late-entry' | 'qualifier-missing']`、タグ`tournament_year_incident`・`week_tournament_id`)。呼び出し元が分からないため`job`のタグは付けない。

#### YearEntryOfferPolicy・YearEntryFulfillment

| Field        | Detail                                                      |
| ------------ | ----------------------------------------------------------- |
| Intent       | 購入種別`year_tournament_entry`の可否・内容・参加資格の付与 |
| Requirements | 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.6, 5.7       |

**Contracts**: Service [x]

- `describe({ userId, targetId, now })`(`targetId`はWeek優勝したローンチのID): 枠が無い・投稿者でない→`unavailable`(`year_entry_not_found`)。`entitled`・`drawn`→`year_entry_already_entitled`。`expired`・`forfeited`・`excluded`、または`resolveAward`が`late`→`year_entry_closed`。`ProductDirectory.findSummaries([productId], 'not-deleted')`が`visible`でない→`year_entry_product_unavailable`。`wasEntitledDuring(userId, awardedAt, min(now, deadlineAt))`が真→`year_entry_exempt`(知らせの処理と組み合わせ決定で付与される)。それ以外は`available`で`PurchaseOffer`を返す(4.1・4.4)。`unavailable`は`code`と`message`を持ち、`message`は同じファイルの`YEAR_ENTRY_OFFER_REJECTION_MESSAGES`(コードごとの文言規則の文言。apiのpresentation層の`errors.ts`も読み込む唯一の出どころ。Yearの導線は決済の制限`checkoutBlock`を持たないため`mappers.ts`は読み込まない)から引く。受付期限の後はpaymentsの`assertAcceptable`が`checkout_closed`で拒否する(4.2)。
- `PurchaseOffer`: `priceLookupKey: 'year_tournament_entry'`、`quantity: 1`、`relatedId: <ローンチのID>`、`exclusivityKey: 'launch:<ローンチのID>:year'`、対象年の日程(`YearCalendar`の行の列、行が無ければ既定の日から求めた日程。`describe`は行を作らない)の`deadlineAt`(23:35)・`acceptUntil`(23:00)・`fulfillableUntil`(=`drawAt`、23:45)、`requiresBotVerification: false`、`summary`: `itemName`「Yearトーナメント参加費」、`quantityLabel`「1件(<年>年のYearトーナメント)」、`serviceTiming`「決済の反映後ただちに参加資格を付与し、<決済期限日>23:45(UTC-08:00)に組み合わせを決定します。決勝は<決勝日>です」、`additionalNotes`は「組み合わせ決定前にプロダクトを削除・退会すると参加資格を失い、参加費は自動で全額返金されます」「トーナメントの不戦勝・不戦敗・両者敗北による返金はありません」「決勝実施日は変更期限(決勝の7日前)まで変わることがあり、変更後の日程で行います」(4.3)。
- `prepare(purchase, db)`: 枠(`targetId`)・投稿者の一致・`awaiting_payment`・凍結の対象外・`ProductDirectory`で論理削除されていないこと、さらに反映の時刻が対象年の`deadlineAt`より後なら`listLaunches`で枠のローンチより新しい取消でないローンチが無いこと(仮6)を確かめ、満たさなければ`{ kind: 'reject', reason: 'ineligible' }`(4.7・4.8)。満たせば`fulfill`で1文を返す: `UPDATE year_tournament_entries SET status = CASE WHEN status = 'awaiting_payment' AND NOT EXISTS (<凍結の条件>) THEN 'entitled' ELSE NULL END, entitlement_source = 'payment', purchase_id = ?, entitled_at = ?, updated_at = ? WHERE id = ?`。同時の変更で条件を満たさなければNOT NULL制約の違反でpaymentsの一括の書き込みが取り消され、paymentsが`prepare`を呼び直して拒否(自動返金)にする(4.5〜4.7・4.9)。`afterCommit`は持たない。
- 同じ購入の反映の重複はpaymentsの状態の前進で1回になる(4.6)。決済期限の後のUltrasの加入は`YearUltrasEntryExemptionHandler`の`activatedAt ≤ deadlineAt`の判定で参加資格を与えない(5.7)。
- 置き場所: `YearEntryOfferPolicy`はpaymentsの`PurchaseOfferPolicy`(`core/payments`)、`YearEntryFulfillment`は`PurchaseFulfillment`(`workers/payments`)の実装で、どちらも`workers/year-tournament`に置き、`YEAR_TOURNAMENT_TYPES`の識別子で束縛する。購入種別の登録は`workers/year-tournament/year-tournament-registrations.ts`の`YEAR_TOURNAMENT_PURCHASE_KIND_REGISTRATION`(`{ kind: 'year_tournament_entry', offer: YEAR_TOURNAMENT_TYPES.YearEntryOfferPolicy, fulfillment: YEAR_TOURNAMENT_TYPES.YearEntryFulfillment }`。受付の可否は購入の可否の口が判定するため有効の条件を持たない)とし、paymentsの`purchase-kind-registrations.ts`がそれを読み込む(ultras-subscription・tournament-weekと同じ形、C-2)。`YearEntryFulfillment`は接続を受け取って文を返すため、paymentsの`workers`の部品だけが呼び、api・eventのapplication層は使わない。

#### YearDrawService・YearProgressionService・YearNotificationPublisher

| Field        | Detail                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intent       | 組み合わせ決定、ラウンドの進行と賞、通知イベントの発行                                                                                                                                          |
| Requirements | 1.4, 1.5, 3.4, 3.5, 5.5, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 9.1, 9.2, 9.3, 9.4, 14.1, 14.2, 14.3, 14.4, 14.5, 15.1 |

**Contracts**: Service [x] / Batch [x]

```typescript
// core/year-tournament/ports.ts
export interface YearDrawService {
  drawDue(now: Date): Promise<{
    readonly drawn: readonly number[];
    readonly failed: readonly number[];
  }>; // 1回に最大2年
}
export interface YearProgressionService {
  advance(
    yearTournamentId: string,
    now: Date,
  ): Promise<AdvanceResult | undefined>; // 進行中でなければundefined
  advanceAll(
    now: Date,
  ): Promise<{ readonly advanced: number; readonly failed: readonly number[] }>;
  applyResult(
    tournament: YearTournamentRecord,
    result: AdvanceResult,
    now: Date,
  ): Promise<void>; // 結果と予告の発行→受賞の発行→終了の記録(記録を最後に置く、G1)
}
export interface YearNotificationPublisher {
  publishRound(input: {
    readonly decidedMatchIds: readonly string[];
    readonly previewMatchIds: readonly string[];
    readonly at: Date;
  }): Promise<void>;
  publishAward(input: {
    readonly year: number;
    readonly productId: string;
    readonly at: Date;
  }): Promise<void>;
  publishEvening(input: {
    readonly date: BusinessDate; // 23:45のジョブの予定時刻の業務日付
    readonly at: Date;
  }): Promise<void>; // その夜の結果・翌日の予告・その日の受賞をまとめて発行(冪等)
}
```

- `drawDue`: System Flows「組み合わせ決定」の手順。年ごとに独立して行い、失敗した年は`captureException`(タグ`tournament_year_incident: 'draw-failed'`・`year`・`year_tournament_id`)で通知して次の年へ進む(15.7)。比較の型は共用の`LaunchOrderingKey`(枠の`launch_date`・`qualifier_upvote_count`・`qualifier_last_upvote_elapsed_ms`)、`BracketDrawCandidate`の`ref`は枠のID、`tieBreaker`はローンチのID(紐付けを解除した枠は枠のID)、`participant`はローンチ・プロダクト・投稿者(7.3〜7.6)。1回戦の日は`yearFirstRoundDate`、マッチの時刻はmatch-engineの`matchWindow`・`MATCH_SCHEDULE`(tournament-weekの部品が使う)で0:00と23:40(1.4・1.5・7.9)。組み合わせ決定から1回戦までの日にはマッチの予定が無い(8.10)。
- `advance`: `BracketProgression.advance(bracketId, dailyRoundPolicy(yearFirstRoundDate(final_date, participant_count) ?? final_date, now), now)`を呼び、結果を返すだけで`applyResult`は呼び出し元(eventの確定のマッチイベントの処理)が呼ぶ(Weekと同じ)。`advanceAll`は進行中の年ごとに両方を行い、失敗した年は`captureException`(タグ`year`・`year_tournament_id`)で通知して次の年へ進む。日程は保存した`first_round_date`ではなく予定の日から求める(Weekも予定の日を使う。1回戦は組み合わせ決定が予定し、2回戦以後は前のラウンドの実際の日から決まるため、遅れがあっても同じ日になる)。勝敗・即時の終了・開始時点の決着・不戦勝の連鎖・段階の記録・遅れの回復はtournament-weekの部品とmatch-engineが行う(8.1〜8.9)。
- `applyResult`(G1、[発行を記録より先にする](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md#発行を記録より先にする)・tournament-weekの`WeekProgressionService.applyResult`と同じ順): (1)`publishRound`で`decidedMatchIds`を`match_result`、終えていなければ`previewMatchIds`を`match_preview`として発行する(終えたときは予告を発行しない)(14.1〜14.3)。(2)`finished`で`championRef`(枠のID)があれば、その枠を`YearEntryStore.findEntry`で読み直し、プロダクトの紐付けがあれば`publishAward`(14.4)。(3)`finished`なら`recordFinish`(`status <> 'finished'`の条件付き、`outcome`・`champion_entry_id`・`awarded_at`)を最後に行う(9.1〜9.4)。発行の失敗では記録まで進まず、トーナメントは進行中のまま残り、イベントの再試行と23:45のジョブが発行と記録をやり直す。受賞の通知の1回性は通知の重複のキー(`award:product_of_the_year:<年>:<プロダクトID>`)で保つ。参加0・1で組み合わせ決定の時点で終えた年も、`markDrawn`で結果を記録した後に同じ後処理を呼ぶ。
- `publishRound`・`publishAward`・`publishEvening`は、組み立てた通知イベントを共用の`publishExcludingViolations({ publisher, name: 'tournament-year', events, at, logger })`(G3)で発行する。50件ずつ発行し、違反の1件を除いて発行し直す(`match-not-previewable`は`info`、それ以外の位置のある違反は`error`のログ)。位置の無い拒否と一時的な失敗は呼び出し元へ返す。発行は重複のキーで冪等である(14.5)。`publishAward`は`{ type: 'award', award: 'product_of_the_year', period: '<対象年>', productId }`。
- `publishEvening`([夜の発行と送り出しの準備](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md#夜の発行と送り出しの準備)、G1): `MatchDirectory.listForDate({ date, kinds: ['year'], now: at })`の結果が確定したマッチを`match_result`、`listForDate({ date: addBusinessDays(date, 1), kinds: ['year'], now: at })`の側が2つで開始前のマッチを`match_preview`、`YearTournamentStore.listAwardedBetween(dateの0:00, at)`の年(当日の0:00から発行の時刻までに受賞を記録した年。紐付けを解除した優勝の枠は除く)を`award`として発行する。`at`は呼び出し元のジョブが組み合わせ決定と進行の後に時計を読み直した時刻とする。受賞を記録の時刻で読むため、ラウンドの遅れで翌年に受賞する年と、1月初旬の決勝日で参加1の受賞が前年12月の組み合わせ決定の夜になる年も、年の範囲を数えずに含まれる。`decided`の処理と進行の中で既に発行したものは重複のキーで重ならない(14.1〜14.5)。
- 発行の時刻: `decided`の処理(23:40の直後)と23:45の`tournament-year.evening-bracket`の中で行い、そのジョブの`markReady`より前になる。数日前の組み合わせ決定で発行した1回戦の予告は、notificationsが前日の夜の枠まで保持する(14.1〜14.3・14.7)。

#### YearEntryFollowUp・YearAwardExport

**Contracts**: Service [x]

```typescript
// core/year-tournament/ports.ts
export interface YearEntryFollowUp {
  process(entryIds: readonly string[], now: Date): Promise<void>; // 返金待ち・知らせ待ちの枠
  processYear(year: number, now: Date): Promise<void>;
}
export interface YearAwardExport {
  listForLaunches(launchIds: readonly string[]): Promise<
    ReadonlyMap<
      string,
      readonly {
        readonly kind: 'product_of_the_year';
        readonly period: string;
      }[]
    >
  >; // periodは'2026'
}
// core/year-tournament/identifiers.ts
export declare const YEAR_TOURNAMENT_TYPES: {
  readonly YearTournamentStore: symbol;
  readonly YearEntryStore: symbol;
  readonly YearCalendar: symbol;
  readonly YearEntryRegistrar: symbol;
  readonly YearEntryOfferPolicy: symbol;
  readonly YearEntryFulfillment: symbol;
  readonly YearDrawService: symbol;
  readonly YearProgressionService: symbol;
  readonly YearEntryFollowUp: symbol;
  readonly YearNotificationPublisher: symbol;
  readonly YearAwardExport: symbol;
}; // Symbol.for('year-tournament.<名前>')の凍結されたオブジェクト(core/media/identifiers.tsと同じ形)
```

- `process`([返金の後処理](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md#返金の後処理)、G4): `refund_status = 'pending'`の枠は`PaymentRefunds.request({ purchaseId, amount: null, reason: refundReasonFor(status, closeReason), requestKey: yearRefundRequestKey(...) })`。`accepted`(重複を含む)なら`requested`と`refund_notice_status = 'pending'`。`rejected`は共用の`refundRejectionOutcome(code)`で`not_needed`(`not_paid`・`purchase_not_found`)・`already_refunded`(`amount_exceeds_refundable`)・`rejected`(`invalid_amount`・`invalid_request_key`)にして`markRefundClosed`で終え、知らせのメールを送らない。`report`が真の拒否と理由の形式違反の`RangeError`は`captureEvent`(理由`refund-rejected`・`refund-already-refunded`、タグは購入と枠のIDだけ)で運用者へ知らせ、`RangeError`の枠も`rejected`で終えて4:21の再処理の対象から外す(6.8)。`refund_notice_status = 'pending'`の枠は`UserContactDirectory.findContact(ownerUserId)`が`undefined`か紐付けを解除した枠なら`skipped`、あれば`EmailSender.send(TOURNAMENT_YEAR_ENTRY_REFUND_KIND, ...)`して`sent`(6.2・6.6・6.9)。1件の失敗で止めず全件を試し、最後に失敗を投げる(1件なら元の例外、複数なら`AggregateError`)。一時的な失敗は呼び出し元の再試行と4:21の再処理に任せる。4:21の`listPendingFollowUps`は最後の更新から10分以上経った枠だけを読み、1回の実行で試した枠のIDを覚えて同じ枠を繰り返さない。
- `processYear(year, now)`: 年で絞るストアのメソッドを持たず、`listPendingFollowUps(now + 1ms, 50)`を読んで`classified_year`がその年の枠だけを`process`と同じ処理にかけ、読んだ枠を除いて読み直すことを新しい枠が無くなるまで繰り返す。他の年の待ちが50件以上先にあると、その年の一部は4:21の再処理に回る。`now`は分類と上限の除外に渡した時刻以上にする。
- 実装の`YearEntryRefundFollowUp`は`{ appName, store, calendar, refunds, contacts, emails, clientSiteOrigin, readLimit? }`を受ける。凍結の前の喪失の枠は`classified_year`を持たないため、知らせの`yearLabel`の年を`YearCalendar.resolveAward(awarded_date, now)`で求める(そのため`YearCalendar`に依存する)。依頼の拒否の`not_needed`のログは`info`(Weekは`error`)、`captureEvent`はfingerprint`['tournament-year', 'refund-already-refunded' | 'refund-rejected']`・タグ`tournament_year_incident`・`entry_id`・`purchase_id`。
- 返金の実行・決済履歴・反映の期限切れと二重決済の返金はpaymentsが行う(6.10)。
- `createYearTournamentPlatformModule(appName)`(`workers/year-tournament/year-tournament-platform-module.ts`、モジュール名`year-tournament-platform`)は本節の全部品を処理単位で束縛し、apiとeventの両方の`MODULES`でWeekの共有モジュールの直後へ入れる。部品がログのカテゴリにアプリの名前を要するため、定数ではなくアプリの名前を受ける関数にする(Weekの先例と同じ)。ストア3つは`.to()`、他の8つは`toDynamicValue`で、全て`inSingletonScope`。DIの識別子は`core/year-tournament/identifiers.ts`の`YEAR_TOURNAMENT_TYPES`(`Symbol.for('year-tournament.<名前>')`)。識別子は`workers`の実装にしか無い`YearEntryOfferPolicy`・`YearEntryFulfillment`の分も含め、`year-tournament-registrations.ts`の登録の定数がここから読み込む。上流の`BracketDraw`・`BracketProgression`・`WeekChampionDirectory`は`core/tournament`・`core/week-tournament`の識別子で受け取る。`BracketStore`は本節の部品のどれも使わないため束縛に現れず、apiのapplication層の部品(ブラケットのページ・判定の供給元・トップページ)が`TOURNAMENT_PLATFORM_TYPES.BracketStore`で直接受け取る。

### api/application

#### YearBoardReader・YearBracketReader・YearEntryPanelReader・YearEntryCheckout

| Field        | Detail                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Intent       | トップページ・ブラケット・参加費の導線の照会と決済の開始                                                                 |
| Requirements | 4.1, 4.2, 4.3, 4.4, 4.10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 11.1, 11.2, 11.3, 11.4, 11.6, 12.1, 12.2, 12.3, 12.5, 15.8 |

**Contracts**: Service [x]

```typescript
export interface YearBoardRound {
  readonly tournament: YearTournamentRecord;
  readonly round: number;
  readonly roundName: string;
  readonly finalDate: BusinessDate; // 1回戦の日 + ラウンド数 − 1(遅れがあれば実際の予定)
  readonly isFinal: boolean;
  readonly matchIds: readonly string[];
  readonly bracketPath: string; // yearBracketPathOf(year)。GraphQLのYearTournamentRoundBoard.bracketPathに使う(Weekと同じ)
}
export interface YearBoardReader {
  read(date: BusinessDate, now: Date): Promise<readonly YearBoardRound[]>;
}
export interface YearBracketView {
  readonly tournament: YearTournamentRecord;
  readonly rounds: BracketRoundsView; // tournament-weekのbuildBracketRoundsViewの結果(tournament-weekの仮7)
  readonly champion: MatchProductView | null; // championNoの参加者のプロダクト。表示できなければnull
}
export interface YearBracketReader {
  read(input: {
    readonly year: string;
    readonly viewer: CurrentUser | undefined; // マッチの表示に閲覧者が要る(Weekと同じ形)
    readonly now: Date;
  }): Promise<YearBracketView | undefined>; // 4桁の年でない・行が無い・未決定はundefined
}
export interface YearEntryPanel {
  readonly launchId: string;
  readonly entry: YearEntryRecord;
  readonly year: YearCalendarEntry; // 分類した年、分類の前ならWeek優勝の日から求めた対象年
  readonly exempt: boolean;
  readonly fee: CheckoutMoney | null; // 決済を始められる枠だけに読む。始められない枠と取得できない縮退ではnull
  readonly refundable: boolean;
  readonly progress: {
    readonly alive: boolean;
    readonly eliminatedRound: number | null;
    readonly eliminatedRoundName: string | null;
    readonly champion: boolean;
  } | null; // 組み合わせに入った枠だけ
}
export interface YearEntryPanelReader {
  readForOwner(
    viewer: CurrentUser,
    productHandle: string,
    now: Date,
  ): Promise<YearEntryPanel | null>; // 本人でない・枠が無いはnull
}
export interface YearEntryCheckout {
  start(
    session: SessionView,
    launchId: string,
  ): Promise<{ readonly purchaseId: string }>; // CheckoutStarter.start({ kind: 'year_tournament_entry', targetId })
}
```

- `YearBoardReader.read`: `MatchDirectory.listForDate({ date, kinds: ['year'], now })`のIDを`BracketStore.findByMatchIds`でブラケットへ分け、`kind = 'year'`の`tournamentId`(年の行のID)ごとに1行(10.1)。年の行が無いブラケットは除く。読み取りはIDと行の値だけを返し、マッチの表示はリゾルバが`matchViewLoader`(`loadMatchView`)でまとめて引き、対戦カードと不戦勝の分け方はmatch-engineの`placementOf`(`apps/api/src/domain/match/board-order.ts`)を使う(tournament-weekの`board-resolvers.ts`と同じ。15.8)。
- `YearBracketReader`(実装`DirectoryYearBracketReader`)の`read`: common-libの`parseTournamentYear`(`common-lib/tournament/year-period.ts`。clientの経路と同じ年の解析)→`findByYears`→`BracketStore.findById`→記録済みのマッチの`MatchViewReader.findViews`(90件ずつ)→`buildBracketRoundsView`。優勝のプロダクトは`championNo`の参加者の`ProductDirectory.findSummaries([productId], 'visible')`から`MatchProductView`を作る(表示できなければnull、tournament-weekの`WeekBracketReader`と同じ)。シードの最初のマッチの予定が作られるまでは、その枠を「シード<n>」とし、プロダクトを出さない(組み立ての規則)。表示できないプロダクトは`MatchProductView`が`null`になり、画面は「非公開のプロダクト」とする(11.2〜11.4・11.6)。
- `YearEntryPanelReader`: `ProductDirectory.resolveHandle`で本人のプロダクトか確かめ、`listLaunches`の直近の取消でないローンチの枠を返す。対象年は`classified_year`があればその年、無ければWeek優勝の日の年〜3年後を`describe`で1回読み、`resolveTargetYear`と同じ規則(apiの`year-launch-standings.ts`の`resolveTargetIn`)で求める。WeekのUltrasの案内(`ultrasGuide`)と決済の制限(`checkoutBlock`)は持たない。GraphQLの`bracketPath`(`yearBracketPathOf(panel.year.year)`)と`serverTime`はリゾルバが足す。`exempt`は`entitlementSource = 'ultras'`、または`awaiting_payment`で`wasEntitledDuring(投稿者, awardedAt, min(now, deadlineAt))`が真。`fee`は`PriceCatalog.getPrices(['year_tournament_entry'])`(到達できず値も無ければnull)。`progress`は`drawn`の枠だけで、優勝は年の行の`champion_entry_id`、それ以外は`BracketStore.findParticipantStandings('year', [entryId])`の敗退のラウンド(`roundStage`と`tournamentRoundName`でラウンド名にする)と状態から求め(組み合わせを書き終える前の`drawing`の年は勝ち残り)、勝ち残りの記録でも`MatchDirectory.listByLaunches([launchId], now)`の直近のYearのマッチが終了し負けていればそのラウンドで敗退とする(tournament-weekの`WeekEntryPanelReader`と同じ規則、4.10・12.1〜12.3・12.5)。`refundable`は`purchase_id`があり`refund_status`が`pending`・`requested`のとき真とする。

#### YearFinalDateService・D1YearFinalDateWriter

| Field        | Detail                                                              |
| ------------ | ------------------------------------------------------------------- |
| Intent       | 決勝実施日の照会と、検証・版・監査ログを伴う保存                    |
| Requirements | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13 |

**Contracts**: Service [x] / State [x]

```typescript
export interface YearFinalDateView {
  readonly year: number;
  readonly schedule: YearSchedule;
  readonly source: 'explicit' | 'default';
  readonly changeable: boolean;
  readonly lockReason: 'locked' | null; // 変更期限以降・凍結済み
  readonly choices: readonly BusinessDate[];
  readonly previousFinalDate: BusinessDate | null;
  readonly nextFinalDate: {
    readonly date: BusinessDate;
    readonly source: 'explicit' | 'default';
  } | null;
  readonly nextYearGapWarning: BusinessDate | null;
  readonly version: number;
  readonly updatedAt: Date | null;
  readonly updatedByAdminId: string | null;
}
export interface YearFinalDateService {
  read(now: Date): Promise<readonly [YearFinalDateView, YearFinalDateView]>; // 現在の年と翌年
  update(input: {
    readonly adminId: string;
    readonly year: number;
    readonly finalDate: BusinessDate;
    readonly expectedVersion: number;
    readonly reason?: string;
    readonly now: Date;
  }): Promise<YearFinalDateView>; // エラーはyear-final-date-errors.ts。違反はvalidation_error(400、details[0]が{ field: 'year' | 'finalDate', code: <理由>, message: <文言規則> })、競合はversion_conflict(409)、変更期限と凍結はfinal_date_locked(422)
}
export interface YearFinalDateWriter {
  save(input: {
    readonly yearTournamentId: string; // 新しい行のときに使うID
    readonly schedule: YearSchedule; // 新しい日程
    readonly defaultSchedule: YearSchedule; // 行が無いときの用意に使う既定の日程
    readonly expectedVersion: number; // 行が無い年は0
    readonly previousYearVersion: number; // 64週の間隔の検証に使った前年の版(行が無い年は0)
    readonly nextYearVersion: number; // 同じく翌年の版
    readonly adminId: string;
    readonly audit: PreparedAuditEntry;
    readonly now: Date;
  }): Promise<'saved' | 'version_conflict' | 'locked'>; // 入力の型はYearFinalDateSave
}
```

- `read`: `YearCalendar.ensureUpcoming`→`describe([Y−1, Y, Y+1, Y+2])`(Yは現在の年)→年ごとに`FinalDateContext`(前年は`isPreviousYearSet`のときだけ、翌年は`source = 'explicit'`のときだけ)を作り、`isFinalDateChangeable`・`finalDateChoices`・`nextYearGapWarning`を求める(2.1・2.4〜2.6・2.12)。変更者のニックネームはリゾルバが`AdminDirectory`で引く(削除済みはnull)。
- `update`: (リゾルバの`requireAdmin(context, 'super_admin')`、不足は`forbidden`、2.9)→`read`と同じ文脈で`checkFinalDateChoice`(違反は`validation_error`と理由、2.4〜2.8)→`AuditLogRecorder.prepare({ operatorAdminId, action: 'year-final-date.update', targetIds: ['year-final-date:<年>'], reason, detail: { year, fromDate, toDate, fromSource }, occurredAt: now })`(2.10)→`YearFinalDateWriter.save`(検証の文脈と同じ`describe`の結果から前年と翌年の版を渡す)。`locked`は`final_date_locked`、`version_conflict`は`version_conflict`(2.7・2.11)。編集できる年の外は`describe`の前に`year_not_editable`で拒否し、`update`も`read`と同じく先に`ensureUpcoming`を呼ぶ。ロールの判定はリゾルバが行う(保存は`super_admin`、照会は`viewer`)。拒否の文言の中の決勝日の表記は共用の`formatBusinessDateWithWeekdayLabel`(common-libの`time/business-date-label.ts`)を使う。
- `D1YearFinalDateWriter.save`: `NOT NULL`制約の違反で取り消すのではなく、監査ログのガイドと先例(`D1SenderInfoWriter`・`D1PromotionSettingWriter`)に倣い、保存の条件を監査ログのガード`{ kind: 'condition' }`とUPDATEのWHEREで共有する。条件は、その年の行の`final_date_version = 読んだ版`・`draw_started_at IS NULL`・`change_lock_at > now`(変更前の期限)と、隣の年の`COALESCE((SELECT final_date_version FROM year_tournaments WHERE year = 年 − 1), 0) = 読んだ前年の版`・同じく翌年の版の一致である(隣の年が同時に保存されると64週の間隔の検証に使った日が古くなるため。版0の行が作られただけなら保存できる)。1つの一括の書き込みは、(1)`INSERT ... ON CONFLICT(year) DO NOTHING`(既定の日程の行の用意)、(2)`buildAuditLogStatements(audit)`(ガードのEXISTSが行を読むため、行の用意の後に置く。ガイドの「監査の文を先頭に」の例外)、(3)`UPDATE year_tournaments SET final_date = ?, final_date_source = 'explicit', deadline_date = ?, accept_until = ?, deadline_at = ?, draw_at = ?, change_lock_at = ?, final_date_version = final_date_version + 1, final_date_updated_at = ?, final_date_updated_by_admin_id = ?, updated_at = ? WHERE year = ? AND <保存の条件>`の順とする。ガードの拒否は`isAuditGuardRejection`で判定し、行を読み直して凍結済みまたは`change_lock_at ≤ now`なら`locked`を`version_conflict`より優先し、それ以外は`version_conflict`に変換する(2.7・2.10・2.11)。

#### YearRelaunchConditionSource・YearProductLockSource・YearLaunchSummarySource・YearTrophySource

| Field        | Detail                                                     |
| ------------ | ---------------------------------------------------------- |
| Intent       | product-launchへの再ローンチ・固定・要約、トロフィーの供給 |
| Requirements | 12.7, 12.8, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6             |

**Contracts**: Service [x]

- `findBlocks({ subjects, at })`: `latestLaunch.outcome === 'won'`の対象について`findByLaunches`・`BracketStore.findAliveRefs('year', 枠のID)`・`YearCalendar.describe`を1回ずつ呼ぶ。枠の無いローンチについては`WeekChampionDirectory.listChampions({ awardedFrom: openPeriodStart, awardedBefore: at })`を1回引き、Week優勝したローンチを受付中の枠と同じに扱う(13.4)。受付中(`awaiting_payment`、または枠の作成前のWeek優勝)で対象年の`deadlineAt`より前なら`{ code: 'tournament-year.entry-pending', releaseAt: deadlineAt }`(13.1・13.6)。`entitled`、`drawn`で勝ち残り、または対象年が凍結済みで分類前の`entitled`(`resolveAward`が`late`を返す終わっていない枠)なら`{ code: 'tournament-year.result-pending', releaseAt: null }`(13.2)。期限切れ・喪失・除外・敗退・優勝は返さない(13.3)。`message`は文言規則の「再ローンチ不可(Year・参加前)」「同(Year・参加中)」の定型の部分で、解除の日付は呼び出し元が`releaseAt`から表示する。
- `findLocks`: 勝ち残りの`drawn`の枠と、凍結済みで組み合わせを書き終える前の年の`entitled`・`drawn`の枠のプロダクトに`{ code: 'tournament-year.bracket-lock', message: 'Yearトーナメントに勝ち残っているため、ローンチ日・カテゴリの変更と削除はできません。' }`(13.5)。
- `summarize`: 枠ごとに、優勝→「Product of the Year」(rank 100)、勝ち残りでその日のマッチが`live`→「Year<ラウンド名>マッチ中」(`inMatch`、90)、勝ち残りで1試合以上を終えた→「Year<次のラウンド名>進出」(80)、敗退→「Year<ラウンド名>敗退」(80)、`entitled`・まだ試合の無い`drawn`→「Yearトーナメント参加決定」(70)、受付期限(23:00)より前の`awaiting_payment`→「Yearトーナメント参加受付中」(60。23:00〜23:35は要約を出さないが再ローンチの禁止は続く)。勝ち残り・敗退のラウンドは`BracketStore.findParticipantStandings('year', 枠のID)`と`MatchDirectory.listByLaunches`の直近のYearのマッチから求める(`YearEntryPanelReader`と同じ規則)。受賞は`{ productId, kind: 'year', label: '<対象年>年' }`(`ProductAwardContribution`。`label`は期間の表記だけで、プロフィールでは`launch-history-reader.ts`が名前を前に付ける、12.8)。
- `YearTrophySource.listTrophies(productId)`: `listAwardsByProducts([productId])`を`{ kind: 'year', period: '<年>', periodLabel: '<年>年', awardedAt, bracketPath: '/tournaments/year/<年>' }`にする。並び(Yearを先頭)はtournament-weekの`ProductTrophyReader`が行う(12.7)。

#### YearTournamentJobs

**Contracts**: Batch [x]

| ジョブの名前                      | 業務時刻 | `order` | 処理                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tournament-year.evening-bracket` | 23:45    | 1700    | 毎晩、次の順に行う。(1)`YearCalendar.ensureUpcoming(now)`(段`calendar`)と、`YearEntryRegistrar.syncChampions({ awardedFrom: openPeriodStart, now })`(段`entry-sync`。年の行の用意の失敗で取り込みを止めないよう段を分け、`openPeriodStart`が失敗したら`syncChampions`を呼ばない)(3.1)。(2)`YearDrawService.drawDue(now)`。到来した年が無ければ何もしない(遅れた年の回復は曜日によらず行う)(5.5・6.4・6.5・7.1・7.2)。(3)`YearProgressionService.advanceAll(now)`。確定のマッチイベントの処理が終わっていなくても、マッチの結果から同期で追いつく(8.2)。(4)`YearNotificationPublisher.publishEvening({ date: context.business.date, at: clock.now() })`(時計は(2)(3)の後に読み直す。14.1〜14.4)。(5)(1)〜(4)が全て成功したときだけ、`EveningDispatchGate.markReady({ participant: 'tournament-year.evening-bracket', date: context.business.date, at: clock.now() })`を最後に1回呼ぶ(14.7) |
| `tournament-year.entry-follow-up` | 4:21     | 1700    | `listPendingFollowUps(10分前, 100)`を`YearEntryFollowUp.process`(6.8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

- Trigger: apiのCron Triggers(`45 7 * * *`・`21 12 * * *`、上流で追加済み)。23:45はmatch-engine(1100)・notifications(1300)・tournament-week(`tournament-week.evening-bracket`、1500)の後、4:21は上流の1600以下の後、content-processingの`content-processing.keyword-reextraction`(2300)の前に動く(15.2・15.3)。
- 23:45のジョブの失敗: (1)〜(4)は年ごと・段ごとに失敗を集めて残りを続け、失敗は通知のポート`YearTournamentIncidentReporter.report`(`apps/api/src/application/year-tournament/ports.ts`。`evening-bracket-failed`(業務日付・失敗した段・失敗した年)・`entry-follow-up-failed`(年と件数)。識別と件数だけで個人情報を含めない)で知らせ、Sentryの`captureEvent`はinfrastructureの実装`SentryYearTournamentIncidentReporter`だけが呼ぶ(tournament-weekの`WeekTournamentIncidentReporter`と同じ形、C-3)。1つでも失敗した夜は`markReady`を呼ばずに例外を投げ、notificationsの23:55の期限の送り出しに任せる(14.7・15.7)。`markReady`の戻り値(`waiting`・`dispatch-requested`・`already-requested`)はログにだけ使い、処理を分けない。`EveningDispatchError`(`unknown-participant`・`invalid-date`)はそのまま例外にする。
- Idempotency: すべて条件付きの書き込みと`onConflictDoNothing()`で、2回実行しても結果が変わらない(15.7)。`markReady`も冪等である(notificationsの契約)。
- 所要時間: 23:45の起動のジョブの合計は`SCHEDULED_RUN_BUDGETS`の300秒の予算をmatch-engine(1100)・notifications(1300)・tournament-week(1500)と共有する(超過は警告だけで止まらない)。Yearの組み合わせ決定は、分類の対象が初年度でも数百件・参加が高々64で、D1の読み書きは分類の一括の書き込み数回・ブラケットの記録(tournament-weekの部品が50件ずつ)・通知の発行(50件ずつ)に限られ、1年あたり数秒の見込みである。Weekの組み合わせ決定と同じ夜(Yearの組み合わせ決定の日が月曜日の年)も、Weekの組み合わせ決定(参加は高々200)と合わせて予算に収まる見込みである。超過しても警告だけで処理は止まらず、送り出しは`markReady`の後か23:55に始まる。

### api/presentation

#### YearTournamentSchemaModule

**Contracts**: API [x]

```graphql
enum YearEntryStatus {
  AWAITING_PAYMENT
  ENTITLED
  DRAWN
  EXPIRED
  FORFEITED
  EXCLUDED
}
enum YearEntryCloseReason {
  DEADLINE
  DELETED
  WITHDRAWN
  HIDDEN_OR_SUSPENDED
  OVER_CAPACITY
  LATE_ENTRY
}
enum YearTournamentStatus {
  OPEN
  DRAWING
  IN_PROGRESS
  FINISHED
}
enum YearFinalDateSource {
  EXPLICIT
  DEFAULT
}
type YearTournamentSummary {
  year: Int!
  label: String!
  finalDate: String!
  firstRoundDate: String
  status: YearTournamentStatus!
  awarded: Boolean
}
type YearTournamentRoundBoard {
  tournament: YearTournamentSummary!
  round: Int!
  roundName: String!
  final: Boolean!
  finalDate: String!
  matches: [Match!]!
  byes: [MatchBye!]!
  bracketPath: String!
}
type YearTournamentBoard {
  date: String!
  serverTime: DateTime!
  rounds: [YearTournamentRoundBoard!]!
}
type YearBracket {
  tournament: YearTournamentSummary!
  participantCount: Int!
  seedCount: Int!
  rounds: [BracketRound!]!
  champion: MatchProduct
}
type YearEntryProgress {
  alive: Boolean!
  eliminatedRoundName: String
  champion: Boolean!
}
type YearEntryPanel {
  launchId: ID!
  year: Int!
  yearLabel: String!
  weekLabel: String!
  finalDate: String!
  status: YearEntryStatus!
  closeReason: YearEntryCloseReason
  refundable: Boolean!
  exempt: Boolean!
  acceptUntil: DateTime!
  deadlineAt: DateTime!
  drawAt: DateTime!
  fee: Money
  serverTime: DateTime!
  progress: YearEntryProgress
  bracketPath: String
}
type YearFinalDateUpdater {
  nickname: String
}
type YearFinalDateSetting {
  year: Int!
  finalDate: String!
  source: YearFinalDateSource!
  acceptUntil: DateTime!
  deadlineAt: DateTime!
  drawAt: DateTime!
  changeLockAt: DateTime!
  changeable: Boolean!
  choices: [String!]!
  previousYearFinalDate: String
  nextYearFinalDate: String
  nextYearSource: YearFinalDateSource
  nextYearGapWarningDate: String
  version: Int!
  updatedAt: DateTime
  updatedBy: YearFinalDateUpdater
}
type YearFinalDateSettings {
  serverTime: DateTime!
  settings: [YearFinalDateSetting!]!
}
input UpdateYearFinalDateInput {
  year: Int!
  finalDate: String!
  expectedVersion: Int!
  reason: String
}
type Query {
  yearTournamentBoard(date: String!): YearTournamentBoard!
  yearBracket(year: String!): YearBracket
  myYearEntry(productHandle: String!): YearEntryPanel
  yearFinalDateSettings: YearFinalDateSettings!
}
type Mutation {
  startYearTournamentCheckout(launchId: ID!): CheckoutStart!
  updateYearFinalDate(input: UpdateYearFinalDateInput!): YearFinalDateSetting!
}
```

| 操作                          | 呼び出し元 | 認可                                     | 入力の検証                                                                                   | エラー                                                                                                                                                                                                                                 |
| ----------------------------- | ---------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yearTournamentBoard`         | client     | 不要                                     | `date`は業務日付の形式                                                                       | 形式違反は`validation_error`(`bad_request`、`withValidatedArgs`)                                                                                                                                                                       |
| `yearBracket`                 | client     | 不要                                     | `year`は文字列(4桁でなければ`null`)                                                          | 不正・未決定は`null`(画面は404、11.6)                                                                                                                                                                                                  |
| `myYearEntry`                 | client     | `requireUser`                            | ハンドルの形式                                                                               | 本人でない・枠が無いは`null`                                                                                                                                                                                                           |
| `startYearTournamentCheckout` | client     | `CheckoutStarter`が`requireVerifiedUser` | ULIDの形式                                                                                   | `year_entry_not_found`・`year_entry_already_entitled`・`year_entry_closed`・`year_entry_product_unavailable`・`year_entry_exempt`(いずれも`unprocessable`)、paymentsの`checkout_closed`・`payments_unavailable`・`rate_limit_exceeded` |
| `yearFinalDateSettings`       | admin      | `requireAdmin(context, 'viewer')`        | なし                                                                                         | `unauthenticated`・`forbidden`                                                                                                                                                                                                         |
| `updateYearFinalDate`         | admin      | `requireAdmin(context, 'super_admin')`   | `year`は整数、`finalDate`は業務日付、`reason`は500書記素以内、`expectedVersion`は0以上の整数 | `unauthenticated`・`forbidden`・`validation_error`(理由`year_not_editable`・`not_sunday`・`out_of_year`・`too_soon`・`too_far_from_previous`・`too_far_from_next`、理由の入力の超過)・`final_date_locked`・`version_conflict`          |

- `matches`と`byes`の分け方は、tournament-weekの`board-resolvers.ts`と同じくmatch-engineの`placementOf`による(開始時点の相手の不戦敗も不戦勝の一覧に含め、両者の不戦敗は描かない)。順はブラケットの位置の順(10.4)。不戦勝の一覧の文言はmatch-engineの`ByeCard`が`match.kind`で切り替える(`year`のトーナメントの文言は実装済み)。`bracketPath`は`/tournaments/year/<年>`(10.2)。
- `YearBracket.rounds`はtournament-weekの`BracketRound`型を参照し、型を再定義しない。`rounds`には`buildBracketRoundsView`の結果の`rounds`(`BracketRoundView`の配列)を、`participantCount`・`seedCount`には同じ結果の値をそのまま返し、`BracketNode.match`などの解決はtournament-weekのリゾルバに任せる(tournament-weekの仮7)。`champion`は`YearBracketView.champion`。
- `YearTournamentSummary.awarded`はtournament-weekの`WeekTournamentSummary.awarded`と同じ規則で、年の行の`outcome`が`awarded`なら真、`no_award`なら偽、終了の前(null)はnullを返す。優勝のプロダクトが表示できなくなっても(非公開化・論理削除・投稿者の停止)真のままで、`YearBracket.champion`だけがnullになる(11.3・11.4)。
- `refundable`は`purchase_id`があり`refund_status`が`pending`・`requested`のとき真(12.5)。
- ルート型への項目の追加は`Query`・`Mutation`だけで、上流の型は変えない。api-gatewayのスキーマモジュールの規約に従い、`extend`を使わず`type Query { ... }`・`type Mutation { ... }`をそのまま書き、同名のルート型の結合はYogaに任せる。persisted operationsの許可リストはclient・adminの操作の追加後に再生成する。

### event

#### WeekChampionEntryHandler・RoundProgressHandler

| 名前                                     | 登録口                 | イベント・種別    | `order` | 処理                                                                                                                                       |
| ---------------------------------------- | ---------------------- | ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tournament-year.week-champion-entry`    | `MATCH_EVENT_HANDLERS` | `decided`・`week` | 1700    | `YearEntryRegistrar.syncChampions({ awardedFrom: event.occurredAt − 8日, now })`(同じイベントのtournament-weekの1510の処理の後に動く)(3.1) |
| `tournament-year.decided-round-progress` | `MATCH_EVENT_HANDLERS` | `decided`・`year` | 1710    | `BracketStore.findByMatchIds`→`kind = 'year'`なら`YearProgressionService.advance`→`applyResult`(8.2・9.1〜9.3・14.1〜14.4)                 |

- 両方とも冪等で、例外は`MATCH_EVENT_RETRY_POLICY`で再試行される。

#### ProductEntryLossHandler・AccountEntryLossHandler・EntryUnlinkHandler

| 名前                                 | 登録口                             | イベント    | `order` | 処理                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------- | ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tournament-year.product-entry-loss` | `PRODUCT_LIFECYCLE_ASYNC_HANDLERS` | `deleted`   | 1700    | `forfeitByProduct`→`listLaunchIdsByProduct`のローンチごとに`OpenCheckoutExpirer.expireOpen({ userId: ownerUserId, kinds: ['year_tournament_entry'], targetId: launchId, limit: 50 })`→`findByLaunches`の返金待ち・知らせ待ちの枠を`YearEntryFollowUp.process`(6.1〜6.3) |
| `tournament-year.account-entry-loss` | `USER_LIFECYCLE_ASYNC_HANDLERS`    | `withdrawn` | 1700    | `forfeitByOwner`→喪失の結果を先に`YearEntryFollowUp.process`し、`listPendingFollowUps(now + 1ms, 50)`を繰り返して本人の枠だけを処理(他の利用者の待ちが50件以上先にあると一部は4:21に回る。知らせは`findContact`が`undefined`のため送られない)(6.1・6.2・6.9)            |
| `tournament-year.entry-unlink`       | `PRODUCT_LIFECYCLE_ASYNC_HANDLERS` | `purge_due` | 1700    | `unlinkOrDeleteByProduct`(15.4)                                                                                                                                                                                                                                         |

- 4つの処理のクラス名(`RoundProgressHandler`・`ProductEntryLossHandler`・`AccountEntryLossHandler`・`EntryUnlinkHandler`)はWeekと同名のため、eventの束縛のモジュールでは`Year`を前に付けた別名で読み込む。
- 凍結の後に届いた`deleted`・`withdrawn`は`forfeit*`が0件になり、組み合わせ決定の分類で`forfeited`になった枠の返金待ちだけを処理する(同じ依頼キー)。`expireOpen`の`remaining`が真なら`continue`を返す。

#### YearUltrasEntryExemptionHandler・YearOpenEntryCheckoutExpiryHandler

| 名前                                         | `order` | 処理                                                                                                                                                                         |
| -------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tournament-year.ultras-entry-exemption`     | 1700    | `listOpenByOwner(activation.userId)`の`awaiting_payment`の枠ごとに`resolveAward`で対象年を求め、`awardedAt ≤ activatedAt ≤ deadlineAt`のものを`grantByUltras`(5.2・5.4・5.7) |
| `tournament-year.open-entry-checkout-expiry` | 1710    | `OpenCheckoutExpirer.expireOpen({ userId, kinds: ['year_tournament_entry'], limit: 50 })`を`remaining`が偽になるまで最大5回。残れば例外で知らせ全体を再試行(5.3・5.4)        |

- 失効の前に決済が完了していた場合はpaymentsの反映で`prepare`が呼ばれ、既に`entitled`なら拒否(自動返金)になる。

#### YearEntrySupplementProvider・YearEntryRefundTemplate

- 登録: `RESULT_NOTICE_SUPPLEMENTS`に`{ name: 'tournament-year.entry-deadline', kinds: ['week'], order: 1700, provider: EVENT_YEAR_TOURNAMENT_TYPES.YearEntrySupplementProvider }`。
- `supplementFor(input)`(14.6): 結果が勝利(`isWinningResult`)で`launchId`があり、そのローンチの枠があるとき(Week優勝の側だけ)に返す。枠が`entitled`(`ultras`)なら`{ title: 'Yearトーナメントの参加資格を得ました', lines: ['Ultrasの特典により参加費は免除されます。参加のための操作は不要です。', '組み合わせは<組み合わせ決定の日時(formatUtcDateTime)>に決定します。'], emphasized: false }`。`awaiting_payment`で受付期限より前なら`{ title: 'Yearトーナメントに参加できます', lines: ['参加費の決済期限: <受付期限の日時(formatUtcDateTime)>', '期限までに決済すると、<年>年のProduct of the Yearを決めるトーナメントに参加できます。決勝は<決勝日>です。'], action: { label: '参加費を支払う', url: '<CLIENT_SITE_ORIGIN>/p/<ハンドル>' }, emphasized: false }`。それ以外は`undefined`。ハンドルは`ProductDirectory.findSummaries([productId], 'visible')`で引き、見えなければ`action`を省く。結果通知の送り出しは、23:45の`tournament-year.evening-bracket`(1700)がWeek優勝の取り込みを終えて`markReady`を呼んだ後に始まるため、通常は枠が作成済みである。Yearのジョブが失敗して23:55の期限で送り出された夜に枠が無ければ、追記を返さない(`undefined`)。
- `templates/tournament-year/year-entry-refund-template.ts`(一覧は同じディレクトリの`index.ts`の`TOURNAMENT_YEAR_EMAIL_TEMPLATES`、eventの`templates/index.ts`が連結する): 件名「Yearトーナメントの参加費を返金します」、本文は宛名・対象年・Week優勝の週の表記・理由(`entitlement_lost`は「組み合わせ決定前にプロダクトが削除されたため」、`entitlement_suspended`は「組み合わせ決定の時点でプロダクトが公開されていなかったため」、`capacity_exceeded`は「参加数が上限の64を超え、Week優勝の日時が古い順に参加の対象外となったため」)・全額を返金する旨と反映まで数日かかる場合がある旨・決済履歴への導線(6.9)。

### client

- 操作はclientの`src/graphql/operations/year-tournament/`、adminの`src/graphql/operations/year-tournament/`(G9)に1ファイル1操作の`.graphql`で書き、`graphql()`を呼ばない。操作名はclientが`Client`、adminが`Admin`で始め(File Structure Plan)。`BracketRoundFields`・`YearBoardRoundFields`を照会の中で名前で展開するとapiの照会の深さの上限(8)を超えるため、Weekと同じく照会に同じ項目を直接書き、名前で展開するのは`ClientYearBracket`の`champion`の`...BracketMatchProductFields`だけにする。tournament-weekのフラグメント`BracketRoundFields`と本specのフラグメント`YearBoardRoundFields`(`src/graphql/fragments/year-tournament/`。`WeekBoardRoundFields`と同じく`round`・`roundName`・`final`・`matches`(`Match`)・`byes`(`MatchBye`)・`bracketPath`を選び、`tournament`は`year`・`label`・`finalDate`・`firstRoundDate`・`status`・`awarded`、行の`finalDate`を加える。共用の部品は`final`・`matches`・`byes`の構造だけに依存する)は型だけを生成し、照会の結果の型との一致を`expectTypeOf`で固定する([GraphQL通信](../../../docs/GUIDES/tech/coding/004-graphql-communication.md)と[トーナメントのブラケットの表示](../../../docs/GUIDES/tech/frontend/016-tournament-bracket-view.md)の規則どおり)。画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`と生成された型を読み、`gql.ts`・`index.ts`を読まない。取得と変更の補助(`queryOptions`・`mutationOptions`)は`src/graphql/year-tournament.ts`に置く(tournament-weekの`src/graphql/week-tournament.ts`と同じ形)。

#### TournamentClientParts(`components/tournament/`、G6)

| Field        | Detail                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Intent       | トップページの区画・決勝の演出・ブラケットのページ・参加費の導線を、種類(Week・Year)の固有の値を引数で受ける1組の部品にする |
| Requirements | 10.1〜10.8, 11.1〜11.5, 12.1〜12.5, 15.1                                                                                    |

**Contracts**: State [x]

```typescript
// tournament-board-model.ts(Week・YearのBoardRoundFieldsフラグメントが満たす構造の型)
export interface TournamentBoardRound {
  readonly final: boolean;
  readonly matches: readonly MatchFragment[];
  readonly byes: readonly MatchByeFragment[];
}
export declare function sectionRoundsOf<R extends TournamentBoardRound>(
  rounds: readonly R[],
): readonly (BoardRoundSplit & { readonly round: R })[]; // 決勝と描くもの無しの行を除く
export declare function boardRefetchIntervalOf(input: {
  readonly rounds: readonly TournamentBoardRound[] | undefined;
  readonly autoRefresh: boolean;
  readonly updatesSinceBaseline: number;
}): number | false;

// use-tournament-board.ts
export declare function useTournamentBoard<
  TData,
  R extends TournamentBoardRound,
>(input: {
  readonly clientViewer: ClientViewer | null;
  readonly autoRefresh: boolean;
  readonly queryOptions: UseSuspenseQueryOptions<TData>; // 種類の取得の補助が作る。同じ閲覧者と日付の間は同じ値(メモ化)を渡す
  readonly roundsOf: (data: TData) => readonly R[];
  readonly withUpdatedMatch: (
    data: TData | undefined,
    match: MatchFragment,
  ) => TData | undefined;
  readonly refetchIntervalOf: (
    input: TournamentBoardRefreshInput,
  ) => number | false;
  readonly canChange: (rounds: readonly R[] | undefined) => boolean;
}): {
  readonly data: TData;
  readonly updatesSinceBaseline: number;
  readonly onUpdated: (match: MatchFragment) => void;
};

// tournament-entry-model.ts(myWeekEntry・myYearEntryの値から包みが写す入力)
export interface TournamentEntryInput {
  readonly launchId: string;
  readonly status:
    | 'AWAITING_PAYMENT'
    | 'ENTITLED'
    | 'DRAWN'
    | 'EXPIRED'
    | 'FORFEITED'
    | 'EXCLUDED';
  readonly late: boolean; // 期限切れの理由が組み合わせ決定の後の確定
  readonly excludedReason: 'hidden_or_suspended' | 'over_capacity' | null;
  readonly exempt: boolean;
  readonly refundable: boolean; // Weekは!exempt、Yearはサーバーのrefundable
  readonly acceptUntil: string;
  readonly drawAt: string;
  readonly serverTime: string;
  readonly feeAmount: number | null;
  readonly ultrasGuide: boolean; // Yearは常に偽(要件とページ配置にYearのUltrasの案内は無い)
  readonly blockedReason: string | null; // Yearは常にnull(決済の開始の拒否は押下の後に示す)
  readonly progress: {
    readonly alive: boolean;
    readonly eliminatedRoundName: string | null;
    readonly champion: boolean;
  } | null;
  readonly bracketPath: string | null;
}
export type TournamentEntryDisplay =
  | {
      readonly kind: 'payable';
      readonly feeAmount: number | null;
      readonly ultrasGuide: boolean;
      readonly blockedReason: string | null;
    }
  | { readonly kind: 'exempt' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'entitled'; readonly drawAt: string }
  | {
      readonly kind: 'drawn';
      readonly outcome: TournamentEntryDrawnOutcome;
      readonly bracketPath: string | null;
    }
  | { readonly kind: 'expired'; readonly late: boolean }
  | { readonly kind: 'forfeited'; readonly refund: boolean }
  | {
      readonly kind: 'excluded';
      readonly reason: 'hidden_or_suspended' | 'over_capacity';
      readonly refund: boolean;
    };
export declare function tournamentEntryDisplayOf(
  input: TournamentEntryInput,
): TournamentEntryDisplay;

// tournament-copy.ts(種類ごとの文言の型。Weekはweek-*-messages.ts、Yearはyear-*-messages.tsが書き出す)
export interface TournamentBoardCopy {
  readonly sectionTitle: string;
} // 「Product of the Weekトーナメント」など
export interface TournamentFinalCopy {
  readonly badge: string;
  readonly title: string;
  readonly subtitle: string;
  readonly awarded: (productName: string) => string;
  readonly noAward: string;
}
export interface TournamentBracketCopy {
  readonly title: string; // ページと失敗の表示の見出し(ページの題名はheadを経路で組み立てるため文言に持たない)
  readonly awardName: string; // 優勝の表示の賞の名前
  readonly counts: (participantCount: number, seedCount: number) => string;
  readonly error: string;
}
export interface TournamentEntryCopy {
  readonly title: string; // 導線の見出し
  readonly entryButton: string; // 「Weekトーナメントに参加」「Yearトーナメントに参加」
  readonly exemptMessage: string;
  readonly closedMessage: string; // 受付の終了と、受付期限の後の決済の開始の拒否(checkout_closed)の文言
  readonly entitledMessage: {
    readonly lead: string;
    readonly before: string;
    readonly after: string;
  }; // 組み合わせ決定の日時の前後に分けた文言
  readonly drawnMessage: string;
  readonly championMessage: string;
  readonly eliminatedMessage: (roundName: string) => string;
  readonly expiredMessage: (late: boolean) => string;
  readonly forfeitedMessage: string;
  readonly forfeitedRefundSuffix: string; // 返金の対象のとき資格の喪失の文に続ける文
  readonly excludedMessage: (
    reason: 'hidden_or_suspended' | 'over_capacity',
  ) => string;
  readonly excludedRefundSuffix: string; // 返金の対象のとき除外の文に続ける文
} // 決済の開始の拒否はcheckout_closedならclosedMessage、他はerrorMessageOf(Yearのyear_entry_*はサーバーの文言)で、文言の型に関数を持たない
```

- 移す元と移す先はFile Structure Planの「clientの共用の部品」の表のとおりで、モデルの規則(取り直しの間隔・追いかけの上限・決勝の受賞の判定・表示の種類の判定・秒読みの境界)は変えない。Weekの`week-*`の包みは、Weekの照会の補助・`WeekBoardRoundFields`・Weekの文言・`refundable = !exempt`・`countdown: true`を渡す。
- `TournamentEntryPanelBody`は`countdown`(受付期限まで48時間未満の秒読みを添えるか)を受ける。Weekは真(ページ配置のWeekの導線)、Yearは偽で、受付期限の日時と相対表現だけを示す(要件12.1・12.2とページ配置のYearの導線に秒読みは無い)。
- 共用の部品は`components/week-tournament/`・`components/year-tournament/`を読み込まず、種類の値はすべて引数で受ける。1ファイル1コンポーネントの規則に従う。
- 実装で共用の部品に足した任意の受け口(省けばWeekの表示は変わらない): `TournamentBracketPage`の`finalDate?: string`(見出しのh1と参加数の間に決勝日を`<time datetime>`で示す)、`TournamentEntryPanelBody`の`payableIntro?: ReactNode`(決済の導線の間だけ決済期限の前に描く種類の案内)。見出しは`TournamentBoardRound`へrender prop`(headingId) => ReactNode`で渡す。決済期限のラベルは種類によらない「決済期限」(`ENTRY_DEADLINE_LABEL`)。テストの値は`tournament-board-fixtures.ts`・`tournament-bracket-fixtures.ts`・`tournament-entry-fixtures.ts`(File Structure Planに無い)。

#### Yearの部品(`components/year-tournament/`)

- `YearTournamentSection`(`main` 10): `useYearBoard`(`useTournamentBoard`へ`yearTournamentBoardQueryOptions`・`YearBoardRoundFields`の行・差し替えの関数・本文の取り直しの判定を渡す)の`final`でない行ごとに、`TournamentBoardRound`(見出しは`TournamentSectionHeading`に、トロフィーのアイコン・「Product of the Yearトーナメント」・ラウンド名・対象年の表記・決勝日の`<time datetime>`・「ブラケットを見る」の通常のリンク`bracketPath`を渡す)、`TournamentMatchCard`(`useUpvote`、段階の印は`MatchCard`が保存した`stage`から描く、2列は1280px以上)、`ByeList`を描く。行が無ければ`null`(10.1・10.2・10.4・10.6・10.7)。取得の失敗は`PartialErrorState`で区画だけ縮退する(10.8)。`main`の10はWeek(20)・予選(30)より上になる(10.3)。定期の取り直しはページの自動更新の切り替えに従う([集計値と残り時間を表示し続ける画面](../../../docs/GUIDES/tech/frontend/013-live-scoreboard.md))。
- `YearFinalShowcase`(`showcase` 10): 本文の区画と同じ盤面を購読し、`final`の行を`TournamentFinalRound`で全幅に描き(紙吹雪は`prefers-reduced-motion: reduce`で止める)、確定の後は`TournamentFinalCopy`のYearの文言「フルタイム！<名称>がProduct of the Yearを受賞🎉」または「フルタイム。0対0で両者敗北。今回の受賞プロダクトはありません」を`role="status"`で表示する(10.5)。
- `YearBracketPage`(`routes/tournaments/year/$year.tsx`): tournament-weekの`/tournaments/week/$week`と同じ形で、`loader`はcommon-libの`parseTournamentYear`(Weekの`parseIsoWeek`と同じ置き場所の共用の解析。apiの`DirectoryYearBracketReader`も使う)が1年以後の4桁の年と認めなければ`notFound()`を投げ、`queryClient.query({ ...yearBracketQueryOptions(viewer, year), staleTime: 0 })`の結果が`null`なら`notFound()`(11.6)。`head`は`head/page-heads.ts`の`buildYearBracketHead`(題名「<年>年のProduct of the Yearトーナメント」)、`errorComponent`は`TournamentBracketError`にYearの文言を渡す部品、`notFoundComponent`は`NotFoundPage`。経路の年ごとに部品を作り直す。本体(`components/year-tournament/year-bracket-page.tsx`)は`TournamentBracketPage({ copy, periodLabel, finalDate, bracket, autoRefresh, onAutoRefreshChange })`に照会の`yearBracket`をそのまま渡し、`BracketViewProps`(`rounds`・`champion`・`awarded`は`tournament.awarded === true`・`finished`は状態が`FINISHED`)は共用のページが`bracketViewPropsOf`で自分で作る。見出しの決勝日は`year-bracket-model.ts`の`yearBracketFinalDateOf`(開催中は最後のラウンドの日、終了した年は最後のラウンドが決勝のときだけその日、それ以外は設定した決勝日)で、受賞したプロダクトが表示できなくなった年は「非公開のプロダクト」の受賞を表示する。開催中は自動更新がオンの間だけ取り直す(11.1〜11.5、[トーナメントのブラケットの表示](../../../docs/GUIDES/tech/frontend/016-tournament-bracket-view.md#開催中だけの定期再取得))。
- `YearEntryPanel`(`myYearEntry`): `myYearEntryQueryOptions`で取得し、`yearEntryInputOf`(`year-entry-view.ts`。`ultrasGuide`は偽・`blockedReason`はnull・`refundable`はサーバーの値・`excludedReason`は`closeReason`から)の入力と、Yearの`TournamentEntryCopy`・`countdown: false`・`autoRefresh: false`・`startYearTournamentCheckoutMutationOptions`を`TournamentEntryPanelBody`へ渡す。`AWAITING_PAYMENT`で受付期限より前は、`payableIntro`で対象年・決勝日(共用の`formatBusinessDateWithWeekdayLabel`)・Week優勝の週の表記、種類によらない「決済期限」(`<time datetime>`・`RelativeTime`、受付期限の23:00)と「Yearトーナメントに参加」ボタン(`MoneyText`の参加費、押下で`startYearTournamentCheckout`→`/checkout/<購入ID>`)。`fee`が`null`、または`payments_unavailable`のときはボタンを無効にし`UnavailableNotice`(12.1・12.2・12.4)。`exempt`は「参加費免除。Ultrasの特典によりYearトーナメントの参加資格を得ています。参加のための操作は不要です。」(12.3)。その他の状態と押下の後のエラーはYearの`TournamentEntryCopy`の文言(12.5、Supporting References)。区画の取得の失敗は区画の位置だけに失敗の文言と再試行を示す。
- `YearEntryOwnerAction`(`PRODUCT_OWNER_ACTIONS`の20)・`YearEntryMyProductSection`(`MY_PRODUCT_SECTIONS`の20): `YearEntryPanel`を描く薄い包み。
- `YearEntryDeleteNotice`(`PRODUCT_DELETE_NOTICES`の20): `myYearEntry`が`AWAITING_PAYMENT`・`ENTITLED`のとき「このプロダクトを削除するとYearトーナメントの参加資格を失います。支払った参加費は自動で全額返金されます。」(12.6)。
- トロフィーはtournament-weekの`TrophyShelf`が、本specの供給元の受賞をYearの先頭に大きく描く(12.7)。

### admin

- 部品は`apps/admin/src/components/year-tournament/`、操作は`src/graphql/operations/year-tournament/`に置く(G9)。登録: `ADMIN_SETTINGS_SECTIONS`に`{ id: 'tournament-year.final-date', order: 10, title: FINAL_DATE_SECTION_TITLE, component: FinalDateSection }`(`FINAL_DATE_SECTION_TITLE`は`final-date-labels.ts`の「Yearトーナメントの決勝実施日」。送信者情報の区画の`SENDER_INFO_TITLE`と同じ形)。設定ページが区画ごとに`RecoverableSlot`で包み、読み込み中と失敗の間は`title`の見出しを補うため、`title`は部品が描く見出しと同じ文言にする。
- `FinalDateSection`: 見出し「Yearトーナメントの決勝実施日」と説明(「欧州サッカーのリーグ最終節に合わせて、各年の決勝実施日(日曜日)を設定します。未設定の年は5月の最終日曜日に行います。」)、`yearFinalDateSettings`(`admin-year-final-date.ts`の`adminYearFinalDateSettingsQueryOptions()`)の2年分を`<FinalDateYearCard setting={s}><FinalDateForm setting={s} /></FinalDateYearCard>`で並べる(2.1)。最初の取得の失敗は`throwOnError`で設定ページの`RecoverableSlot`へ投げ、区画の位置に失敗の文言と再試行を示す(先例と`frontend/009`のガイドどおり。見た目は区画の中の`ErrorState`と同じで、`contactHref`は渡さない)。
- `FinalDateYearCard`: 対象年、決勝実施日(業務日付の`<time datetime="YYYY-MM-DD">`と「2027年5月30日(日)」の表記)と「設定済み」「既定(5月の最終日曜日)」のバッジ、受付期限・組み合わせ決定・変更期限の`DateTime`、最後に変更した日時と管理者のニックネーム、翌年の注意(2.12)。カードは`FinalDateForm`を直接描かず、編集の欄を`children`の受け口として受け、`RoleGate({ minimum: 'super_admin' })`かつ`changeable`のときだけ描く。それ以外は参照だけで「最上位管理者だけが変更できます」または「変更期限(決勝の7日前)を過ぎたため変更できません」(2.2・2.3)。
- `FinalDateForm`: 候補(`choices`)を選ぶ共用のRadixの`Select`(`role="combobox"`、ラベル付き、既定の選択は現在の日、候補が無ければ選べる日が無い旨)と任意の理由(500書記素以内、個人情報を含めない旨の注記)、保存は`ConfirmActionDialog`(`reason: 'optional'`・`audited: true`・`failureMessageOf`)で、確認の文に変更後の受付期限・組み合わせ決定と対象期間が変わる旨を出す(2.13)。確認のダイアログの題名の決勝日は業務日付の`<time>`、説明の受付期限と組み合わせ決定は`DateTime`で示す(`ConfirmActionDialog`の`title`・`description`は`ReactNode`を受ける。文言は`finalDateConfirmTitleOf(year)`の`{ before, after }`と`FINAL_DATE_CONFIRM_DESCRIPTION`で`<time>`の前後に分ける)。変更後の受付期限・組み合わせ決定は`final-date-schedule.ts`の`scheduleOfChoice`(サーバーの現在の`acceptUntil`・`drawAt`を選んだ日との暦日の差だけずらす。業務時刻が夏時間の無い固定のオフセットであることに依る)で求める。拒否の理由の文言はサーバーの`details[0].message`を優先し、空のときだけ`finalDateViolationMessageOf`を使う。`validation_error`・`final_date_locked`・`version_conflict`の照会の読み直しはダイアログを閉じたときに行う(開いたまま読み直すとフォームとダイアログが消えるため)。成功で「決勝実施日を保存しました。」。保存の失敗は、部品が理由の入力を保ったままダイアログの中に`failureMessageOf(error)`の文言を`role="alert"`で示す。`failureMessageOf`は、`validation_error`なら理由の文言、`final_date_locked`なら期限の文言、`version_conflict`なら最新を読み直す案内(2.11、`FinalDateLabels`)を返し、それ以外は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`を返して問い合わせを促す文を出さない。
- 監査ログの照会の無効化: 決勝実施日の保存の成功の後は、監査ログの検索の照会を`invalidateAuditLogQueries`で無効にする。失敗の後は無効にしない(`docs/GUIDES/tech/frontend/009-admin-console-shell.md`の「監査ログを残す操作の後の照会の無効化」)。
- `FinalDateLabels`(純粋な関数): 拒否の理由ごとの文言(Supporting References)と区画の文言。業務日付の曜日つきの表記は、backend-lib・client・adminで共用のcommon-libの`formatBusinessDateWithWeekdayLabel`(`time/business-date-label.ts`)を使う。翌年の注意は照会の項目`nextYearGapWarningDate`(サービスの値は`nextYearGapWarning`)から`nextYearGapWarningOf`で文にする。

### docs

#### YearTechDocs・YearServiceSpecs

- `backend/019-anchor-date-schedules.md`(16.5): 起点の日付(設定値と既定値)から期限・締め切り・日程を純粋な関数で導く規約、導いた期限を行の列に保存して正とし変更時に同じ書き込みで書き直す、変更の締め切りと版と凍結を1つの条件付きの更新で検査する、期間の所属を保存せず日付と凍結の状態で判定する(付け替えを持たない)、凍結した期間に遅れて届いた記録の扱い、業務時刻での曜日と月末の計算、本プロジェクト固有の値を含めない。
- `frontend/012-business-date-calendar.md`への追記(16.5、G7): 「サーバーが返す候補から選ばせる日付」の節を加える。曜日などで選べる日が少なく限られる日付の入力は、サーバーが返す候補の業務日付の一覧を共通部品の`Select`(`Label`を結ぶ。既定の選択は現在の値)で選ばせ、候補と検証の規則をサーバーの1か所に保つ(保存の時もサーバーが同じ規則で検証し直す)。候補が無いときと変更できないとき(締め切り・権限)の表示、業務日付を`<time datetime>`の日付と曜日つきの表記で示すこと、確認のダイアログで変更によって変わる期限と対象を明示すること、版の競合の案内を扱う。カレンダーで選ばせる場合(既存の節)との使い分けを冒頭の前提に書く。`frontend/README.md`の`012`の行と、`CLAUDE.md`の「業務日付をカレンダーで選ばせる画面…」の参照先の文言に、候補から選ばせる日付を含める。
- サービス仕様(16.6): Modified Filesのとおり。

## Data Models

### Domain Model

```mermaid
erDiagram
    YEAR_TOURNAMENTS ||--o| TOURNAMENT_BRACKETS : drawn_as
    YEAR_TOURNAMENTS ||--o| YEAR_TOURNAMENT_ENTRIES : champion
    YEAR_TOURNAMENT_ENTRIES ||--o| BRACKET_PARTICIPANTS : entry_ref
    YEAR_TOURNAMENT_ENTRIES }o--|| PRODUCT_LAUNCHES : launch
```

- 集約: 年のトーナメント(決勝日・期限・凍結と進行・受賞)と、参加の枠(Week優勝1件)。枠は終わるまで年を持たず、`classified_year`で終えた年を記録する。ブラケット(tournament-week)とは年の行の`bracket_id`と参加者の`entry_ref`(枠のID)で結ぶ。
- 不変条件: 1つのWeek優勝(`week_tournament_id`)とローンチに枠は1つ。年は1つの対象年に1行。凍結の後に、その年の決済期限日より前のWeek優勝の枠の資格は変わらない。1つの年の受賞は1回。年の行は組み合わせ決定の時刻が未来のときだけ作られる。

### Physical Data Model

テーブル定義は`apps/db/schema/tournament/year-tournaments.ts`・`year-tournament-entries.ts`(G8)。

**`year_tournaments`**: `id`(ULID、主キー)・`year`(integer、一意、1000〜9999のCHECK)・`final_date`(text)・`final_date_source`(`explicit`・`default`のCHECK)・`final_date_version`(integer、既定0、0以上)・`final_date_updated_at`(null可)・`final_date_updated_by_admin_id`(text、null可、外部キーなし)・`deadline_date`(text)・`accept_until`・`deadline_at`・`draw_at`・`change_lock_at`(エポックミリ秒)・`status`(`open`・`drawing`・`in_progress`・`finished`)・`draw_started_at`・`drawn_at`(null可)・`bracket_id`(`tournament_brackets`への外部キー、null可)・`first_round_date`(text、null可)・`participant_count`(null可)・`outcome`(`awarded`・`no_award`、null可)・`champion_entry_id`(null可)・`awarded_at`・`finished_at`(null可)・`timestamps`。索引`(status, draw_at)`・`(draw_started_at, deadline_date)`。CHECK: `final_date_source = 'explicit'`なら`final_date_version ≥ 1`、`status = 'finished'`なら`outcome`が非null、`outcome = 'awarded'`なら`champion_entry_id`が非null。

**`year_tournament_entries`**: `id`(ULID)・`week_tournament_id`(text、一意、外部キーなし)・`week_period`(text)・`launch_id`(`product_launches`、null可、一意)・`product_id`(`products`、null可)・`owner_user_id`(`users`、null可)・`launch_date`(text)・`qualifier_match_id`(text)・`qualifier_upvote_count`(integer)・`qualifier_last_upvote_elapsed_ms`(null可)・`awarded_at`(エポックミリ秒)・`awarded_date`(text)・`status`(6値のCHECK、NOT NULL)・`entitlement_source`(`payment`・`ultras`、null可)・`purchase_id`(text、null可)・`entitled_at`・`closed_at`(null可)・`close_reason`(6値のCHECK、null可)・`classified_year`(integer、null可)・`refund_status`(`none`・`pending`・`requested`・`not_needed`・`already_refunded`・`rejected`、既定`none`。G4)・`refund_requested_at`(null可)・`refund_notice_status`(`none`・`pending`・`sent`・`skipped`、既定`none`)・`timestamps`。索引`(status, awarded_date)`・`(owner_user_id, status)`・`(product_id)`・`(classified_year, status)`・`(refund_status, updated_at)`・`(refund_notice_status, updated_at)`。CHECK: `status IN ('entitled', 'drawn')`なら`entitlement_source`が非null、`entitlement_source = 'payment'`なら`purchase_id`が非null、`status IN ('drawn', 'excluded')`または`close_reason = 'late_entry'`なら`classified_year`が非null。

- `purchase_id`はpaymentsの購入のIDで外部キーを張らない(paymentsの表を直接読まない)。
- 物理削除: プロダクトの`purge_due`で、組み合わせに入った枠は紐付けの列をnullにし、それ以外の枠は削除する(15.4)。

### Data Contracts & Integration

- 購入種別: 上記の`PurchaseOffer`と`prepare`の文。返金の依頼キー`tournament-year:<購入ID>:entitlement_lost`・`entitlement_suspended`・`capacity_exceeded`。
- 通知イベント: `{ type: 'match_preview' | 'match_result', matchId }`・`{ type: 'award', award: 'product_of_the_year', period: '<対象年>', productId }`。
- 監査ログ: `year-final-date.update`(対象`year-final-date:<年>`、詳細`year`・`fromDate`・`toDate`・`fromSource`)。
- データエクスポート: `launches.json`の`awards[]`へ`{ kind: 'product_of_the_year', period }`(`YearAwardExport`)。

## Error Handling

### Error Strategy

- 判定の供給元(再ローンチ・固定)の例外はproduct-launchが`unavailable`として予約と保存を拒否し、要約の例外は表示の縮退になる(product-launchの規約)。本specの供給元は1回の問い合わせで読み、例外を握りつぶさない。
- 組み合わせ決定・進行は年ごとに独立させ、1つの失敗が他を止めない。凍結と位置の挿入の後で中断しても、次の実行が続きから行う。
- 決済の開始の拒否は`AppError(unprocessable, <code>)`、決勝実施日の保存の拒否は`validation_error`・`final_date_locked`・`version_conflict`で、画面は文言規則の文言を出す。

### Error Categories and Responses

| 種類                 | 例                                                           | 応答                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 利用者の誤り         | 他人の枠・期限後・資格を得た枠の決済の開始                   | `year_entry_*`の`unprocessable`、paymentsの`checkout_closed`                                                                                                           |
| 管理者の誤り         | 日曜日でない日・8日後より前・64週以上空く日                  | `validation_error`と理由                                                                                                                                               |
| 権限・期限           | 最上位管理者以外の保存、変更期限以降の保存                   | `forbidden`、`final_date_locked`                                                                                                                                       |
| 業務の競合           | 凍結と反映の同時の発生、管理者の同時の保存                   | 反映の文のNOT NULL制約の違反→paymentsが拒否して自動返金、保存の`version_conflict`                                                                                      |
| 外部の一時的な失敗   | Stripe・Queue・D1                                            | イベントの処理は再試行、ジョブは`YearTournamentIncidentReporter`で通知し次の実行で補う                                                                                 |
| 進行の遅れ           | 0:00を過ぎてから次ラウンドを作る                             | tournament-weekの部品が実施日を1日遅らせ`round-late`を`captureEvent`                                                                                                   |
| 返金の依頼の拒否     | `not_paid`・`purchase_not_found`                             | `not_needed`で終える(知らせなし、`info`のログ)                                                                                                                         |
| 返金済みの購入       | `amount_exceeds_refundable`(管理者の返金・異議の後)          | `already_refunded`で終え、`captureEvent`(`refund-already-refunded`)。知らせのメールは送らない                                                                          |
| 依頼の形式の誤り     | `invalid_amount`・`invalid_request_key`・理由の`RangeError`  | `rejected`で終えて再処理から外し、`captureEvent`(`refund-rejected`)。知らせのメールは送らない                                                                          |
| 通知イベントの違反   | 開始済みのマッチの予告(`match-not-previewable`)など          | `publishExcludingViolations`が1件を除いて発行し直し、`info`または`error`のログ                                                                                         |
| 遅れて届いたWeek優勝 | 凍結の後の取り込み                                           | `expired`(`late_entry`)で記録し`captureEvent`                                                                                                                          |
| 年の行の用意の失敗   | 23:45の`tournament-year.evening-bracket`の(1)の失敗          | `YearTournamentIncidentReporter`(`evening-bracket-failed`)。その夜は`markReady`を呼ばずに例外(次の行と同じ)。翌晩と管理画面の照会で用意し直す                          |
| 夜の処理の失敗       | 23:45の`tournament-year.evening-bracket`のいずれかの段の失敗 | `YearTournamentIncidentReporter`(`evening-bracket-failed`)で知らせ、`markReady`を呼ばずに例外。notificationsが23:55に送り出し、`evening-dispatch-incomplete`で検知する |

### Monitoring

- ログは`getAppLogger`で、対象年・枠・ブラケット・マッチ・購入・管理者の識別と件数だけを記録し、名称・メールアドレス・ハンドルを含めない(15.6)。`captureEvent`(文言は`logentry`、`fingerprint`は`['tournament-year', 理由]`)・`captureException`(タグだけ)は`workers/year-tournament`とapiのinfrastructureの`SentryYearTournamentIncidentReporter`だけが呼び、api・eventの`application`は呼ばない。タグは除去処理の対象外のため識別子の形の値だけを送り(`workers/year-tournament/incident-tags.ts`の`safeTagOf`)、`bracketId`は付けない。実際のタグは次のとおり。
  - Week優勝の取り込み(`warning`): `tournament_year_incident`(`late-entry`・`qualifier-missing`)・`week_tournament_id`。
  - 返金の後処理: `tournament_year_incident`(`refund-already-refunded`は`warning`・`refund-rejected`は`error`)・`entry_id`・`purchase_id`。
  - 組み合わせ決定の失敗(`captureException`): `tournament_year_incident: 'draw-failed'`・`year`・`year_tournament_id`。
  - 進行の失敗(`captureException`): `year`・`year_tournament_id`。
  - ジョブの失敗(`SentryYearTournamentIncidentReporter`、`error`): `tournament_year_incident`(`evening-bracket-failed`・`entry-follow-up-failed`)・`job`・`year`(失敗した年が1つのときだけ。安全な整数でなければ`unknown`)。
  - ラウンドの遅れ(`round-late`)はtournament-weekの`D1BracketProgression`が種類によらず`tournament_incident`のタグで知らせ、本specは送らない。

## Testing Strategy

- 単体テスト(`*.unit.test.ts`):
  - `year-schedule`: 既定の決勝日(2026-05-31・2027-05-30・2028-05-28・2029-05-27など5月31日が日曜日の年と月曜日の年)、決勝日からの決済期限日・受付期限23:00・決済期限23:35・組み合わせ決定23:45・変更期限(7日前0:00)、1回戦の日(N = 2は決勝日、3・4は1日前、5・8は2日前、9・16は3日前、17・32は4日前、33・64は5日前、N ≤ 1はnull、65は例外)(16.2)。
  - `final-date-choice`: 現在の年と翌年、日曜日と対象年、8日後の境界(0:00がちょうど8日後は可、1ミリ秒足りなければ不可)、前年から447日と448日、翌年が設定済みの447日と448日、変更期限の前後と凍結、候補の一覧、翌年の既定の日の注意(16.2)。
  - `year-target-rules`: 決済期限日の前日と当日のWeek優勝、開催しなかった前年の枠が今年へ移ること(初年度)、凍結済みの年への遅れ、1月初旬の決勝日(決済期限日が前年の12月)、`isPreviousYearSet`(16.2)。
  - `year-capacity`・`launch-ordering`: Yearトーナメント規則のN = 13の例(シードP2・P7・P11、1回戦P1×P3・P4×P5・P6×P8・P9×P10・P12×P13)を共用の並びで確かめる(移したWeekの例はそのまま残す)、同日のローンチの同順、Upvote数0の末尾、`selectWithinCapacity`の64件と65件・同時刻の`tieBreaker`(16.2)。
  - `year-entry-rules`・`refund-rejection`・メール種別・監査の操作種別: 返金の理由の写像と依頼キー、拒否の5つのコードの写像(移したWeekのテスト)、`TOURNAMENT_YEAR_ENTRY_REFUND_KIND`の入力のスキーマ、操作種別の定義の検証。
  - 共用へ移した部品: `addBusinessDays`(月末・年末・うるう年・負の日数、既存の5か所の結果との一致)・`businessWeekdayOf`、`publishExcludingViolations`(50件の分割、違反の除外と再発行、`info`と`error`の分け方、位置の無い拒否・範囲外の位置・一時的な失敗の伝わり方。Weekの`week-notification-publisher`の既存のテストの例を移す)。移す元の呼び出し元(tournament-week・match-engine・notifications・product-launch)の既存の単体テスト・Workers統合テストが期待値を変えずに通ること。
  - `identifiers`(`core/year-tournament`): `YEAR_TOURNAMENT_TYPES`の各値が`Symbol.for('year-tournament.<名前>')`で、オブジェクトが凍結されていること。
  - アプリケーション層: `YearRelaunchConditionSource`(期限の前後、各状態、枠の作成前のWeek優勝、決勝日の変更後の解除の日時)、`YearProductLockSource`、`YearLaunchSummarySource`の文言とrank、`YearTrophySource`、`YearFinalDateService`(ロールの拒否はリゾルバ、検証の理由、監査ログの準備、競合と期限の変換)、`YearEntryPanelReader`、`YearTournamentJobs`(23:45の5段の順序、組み合わせも進行も無い夜も`markReady`を最後に1回呼ぶこと、どの段の失敗でも残りを続けたうえで`YearTournamentIncidentReporter`へ知らせて`markReady`を呼ばずに例外になること、`publishEvening`の`at`が進行の後に読み直した時刻であること、`markReady`の3つの戻り値で処理が変わらないこと、`EveningDispatchError`の伝わり方、`date`がジョブの業務日付であること)、`YearEntrySupplementProvider`の3つの場合、eventの各処理。
- Workers統合テスト(`*.worker.test.ts`):
  - 時刻の境界: 受付期限22:59と23:00の決済の開始、決済期限23:34と23:35(反映と仮6の新しいローンチ)、組み合わせ決定の23:44と23:45、変更期限の決勝日の8日前の23:59と7日前の0:00の保存(16.3)。
  - 枠: 取り込みの重複、優勝時点の免除、凍結と同時の取り込みの期限切れ、予選の欠落の飛ばし(3.1〜3.3・3.7・5.1)。
  - 反映: 同じ購入の重複の反映が1回の付与、凍結の後の反映がNOT NULL制約の違反で拒否、資格を得た枠への2件目の決済の二重決済としての拒否、削除済みのプロダクトの拒否(4.5〜4.8)。
  - 組み合わせ決定: 凍結→分類(可視・非公開化・停止・論理削除・Ultrasの期間内・期限切れ)→上限(65件で最も古い1件の除外と返金待ち)→ブラケット→マッチの予定(match-engineのテーブルで確認)、再実行で重複しない、凍結と削除・Ultrasの加入・Week優勝の同時の発生、初年度の起点なし(3.4〜3.6・5.5・6.4・6.5・7.1〜7.11)。
  - 夜の発行: `publishEvening`がその日の確定したYearのマッチの結果・翌日の側が2つのマッチの予告・当日の0:00から発行の時刻までに記録した受賞(前年12月の参加1の受賞と翌年への遅れを含む)を発行し、2回呼んでも重ならないこと、開始済みのマッチの予告が1件混ざっても残りが発行されること(14.1〜14.5)。
  - 進行: `decided`の処理と23:45のジョブの同時の実行で次ラウンドのマッチが1組、確定のマッチイベントの処理より前に23:45のジョブが進めて追いつくこと、組み合わせ決定から1回戦までの空白の日、決勝の確定で受賞の発行の後に終了が記録されること、受賞の発行が失敗したら年が進行中のまま残り、再実行で発行と記録が1回ずつになること(G1)(8.1〜8.10・9.1〜9.5・14.1〜14.4)。
  - 喪失と返金: `deleted`・`withdrawn`の処理、凍結の前後、同じ依頼キーの重複の防止、4:21の再処理、退会済みの知らせの`skipped`、拒否の`not_needed`・`already_refunded`・`rejected`と知らせを送らないこと、1件の失敗で残りの枠を止めないこと(6.1〜6.9)。
  - Ultrasの知らせ: 期限の前後の加入、重複の知らせ、未完了の決済の失効(5.2〜5.4・5.7)。
  - 決勝実施日: 保存と期限の列の書き直しと監査ログの一体の確定、版の競合、変更期限・凍結の`locked`、行の無い年の保存、保存の後に対象期間が移ること(1.3・2.7・2.10・2.11・3.8)。
  - GraphQL: `yearTournamentBoard`の分類、`yearBracket`の非公開のプロダクト・優勝のプロダクト・受賞したプロダクトが表示できない年の`champion`がnullで`tournament.awarded`が真・受賞なしの年の`awarded`が偽・終了前のnull・最初のマッチの前のシードの「シード<n>」と404、`myYearEntry`の本人の判定、`startYearTournamentCheckout`のエラーコード、`yearFinalDateSettings`・`updateYearFinalDate`のロールとエラー(2.1〜2.13・10.1〜10.8・11.1〜11.6・12.1〜12.8)。
- ブラウザテスト(`*.browser.test.tsx`、`runAxe`の違反0件): 共用の`components/tournament/`の部品(移したWeekのテストに、Yearの文言と`countdown: false`・`ultrasGuide`偽・除外の理由`over_capacity`の例を加える)、`YearTournamentSection`(区画の有無・不戦勝の一覧・縮退)、`YearFinalShowcase`(受賞・受賞なし・視差効果の軽減)、`YearBracketPage`(見出しと、照会の値から共用の`TournamentBracketPage`が作る`BracketViewProps`(`rounds`・`champion`・`awarded`・`finished`)、受賞したプロダクトが表示できない年の`champion`がnullで`awarded`が真、404)、`YearEntryPanel`の全状態・縮退・免除・秒読みを添えないこと、`YearEntryDeleteNotice`、`FinalDateSection`・`FinalDateYearCard`・`FinalDateForm`(ロールと期限による参照だけ・候補の選択・確認の文・理由の上限・競合の案内・翌年の注意)。Weekの包み(`week-tournament-section`・`week-final-showcase`・`week-bracket-page`・`week-entry-panel`など)の既存のブラウザテストは、期待値を変えずに通ること(G6でWeekの表示が変わらないことの確認)。
- 単体テスト(client・admin): `tournament-entry-model`(移したWeekの例に、`refundable`がサーバーの値の例と`over_capacity`の除外を加える)、`year-entry-view`、`src/graphql/year-tournament.ts`、`final-date-labels`。
- マイグレーション: `tournament-year-migration.unit.test.ts`が生成したマイグレーションのCHECK(状態・理由・返金の状態の値と組み合わせの制約)・一意索引・`tournament_brackets`への外部キーを確かめる(tournament-weekの`tournament-week-migration.unit.test.ts`の前例)。
- E2E:
  - `e2e/client/year-tournament.e2e.test.ts`(画面の操作は`year-tournament-steps.ts`): `year-tournament-fixtures.ts`(流すSQLは単体テスト付きの`year-tournament-fixture-sql.ts`が組み立てる)がローカルD1に、他のE2Eと重ならない過去の対象年(既存の`year < 2026`の最大+1、1001から)の年の行と、その年の決済期限日より前のWeek優勝の枠2件(1件は受付中、1件はUltrasで参加資格)を作る。(1)投稿者がプロダクト詳細ページの「Yearトーナメントに参加」から決済画面へ進みテストカードで支払い、参加資格を得た表示になる(paymentsのE2Eと同じく`stripe listen`の転送が要る)、(2)年の行の期限の列を過去へ移し、backend-platformの改訂2の共用の補助`triggerScheduled`(`e2e/support/scheduled-trigger.ts`、`worker: 'api'`、当日の業務日付と業務時刻`23:40`・`23:45`)で23:40と23:45のジョブを動かし、参加2の決勝が予定されブラケットのページで組み合わせが見える、(3)決勝を今日の開始済みにしてトップページのYearの決勝の区画を確かめ、終了を過去へ移して同じ補助で動かす23:40と23:45のジョブで確定と進行を行い、プロダクト詳細ページのトロフィーにProduct of the Yearが表示される(16.4)。
  - `e2e/admin/year-final-date.e2e.test.ts`(画面の操作は`year-final-date-steps.ts`): `signInAsNewAdmin`で最上位管理者としてログインし、設定ページの翌年のカードで現在と違う候補を選んで保存し、監査ログの画面に「Yearトーナメント決勝実施日の変更」が出ることを確かめる。`viewer`のロールでは参照だけであることを確かめる(16.4)。

## Security Considerations

- 決済の開始は本人の枠だけ(`describe`で投稿者の一致)で、認証・確認済みの判定と回数制限はpaymentsの`CheckoutStarter`が行う。参加資格の付与は`prepare`の文だけで行い、クライアントの入力で状態を変える操作は無い。
- `myYearEntry`は`requireUser`と本人の判定で他人の決済状態を返さない。ブラケット・トロフィーは表示できないプロダクトの名前とリンクを出さない(公開範囲)。
- 決勝実施日の保存はサーバー側の`requireAdmin(context, 'super_admin')`で認可し、画面の`RoleGate`は補助である。入力はサーバー側で`checkFinalDateChoice`により再検証し、候補の一覧に頼らない。監査ログの理由に個人情報を含めない旨を入力欄に注記する(FR-ADMAG-001)。
- メールの宛先は`UserContactDirectory`で引き、`users`の列を直接読まない。返金の知らせに決済の詳細(カード番号など)を含めない。

## Performance & Scalability

- 1つの年の参加は高々64(上限)で、分類の対象は初年度でも数百件に収まる。組み合わせ決定は分類の一括の書き込み数回・参加者とマッチの書き込み(tournament-weekの部品が50件ずつ)で、CPU時間とバインド変数の上限に収まる。
- トップページの区画は30秒ごとの取り直しで、`listForDate`1回・`findByMatchIds`1回・年の行の読み取り(年ごとに`findById`。遅れの回復で2つの年が同じ日にマッチを持つと2回になる)・`matchViewLoader`のまとめた読み取りに限る(15.8)。ブラケットのページはマッチの数(最大63)の読み取りを90件ずつまとめる。
- 再ローンチの判定の供給元は、枠・勝ち残り・年・Week優勝(枠の無いローンチがあるとき)の読み取りを各1回に限る。

## Migration Strategy

- 新しいテーブルだけを足すマイグレーション1つ。既存のデータの移行は無い。staging・prodとも、最初の23:45の`tournament-year.evening-bracket`で次に開催する年の行が既定の日で作られ、本specの導入より前に確定したWeek優勝は、前年に開催していないため初年度の対象として取り込まれる(仮1)。リリース前のデータは無いため、prodはそのまま有効になる。

## Supporting References

### 本specが定める固有の値

| 項目                 | 値                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ジョブ               | `tournament-year.evening-bracket`(23:45、1700)・`tournament-year.entry-follow-up`(4:21、1700)。夜の枠の送り出しの前提の名前は`tournament-year.evening-bracket`                                                                                                                                          |
| マッチイベントの処理 | `tournament-year.week-champion-entry`(`decided`・`week`、1700)・`tournament-year.decided-round-progress`(`decided`・`year`、1710)                                                                                                                                                                       |
| ライフサイクルの処理 | `tournament-year.product-entry-loss`(プロダクトの`deleted`、1700)・`tournament-year.entry-unlink`(プロダクトの`purge_due`、1700)・`tournament-year.account-entry-loss`(ユーザーの`withdrawn`、1700)                                                                                                     |
| Ultrasの知らせの処理 | `tournament-year.ultras-entry-exemption`(1700)・`tournament-year.open-entry-checkout-expiry`(1710)                                                                                                                                                                                                      |
| 結果通知の追記       | `tournament-year.entry-deadline`(`week`、1700)                                                                                                                                                                                                                                                          |
| 判定の供給元         | `tournament-year.result-pending`(再ローンチ、1700)・`tournament-year.bracket-lock`(固定、1700)・`tournament-year.launch-summary`(要約、1700)。ブロックのコードは`tournament-year.entry-pending`・`tournament-year.result-pending`                                                                       |
| トロフィーの供給元   | `tournament-year.year-trophies`(10)                                                                                                                                                                                                                                                                     |
| 画面の登録           | `TOP_PAGE_SECTIONS`の`tournament-year.matches`(`main` 10)・`tournament-year.final`(`showcase` 10)、`PRODUCT_OWNER_ACTIONS`・`MY_PRODUCT_SECTIONS`の`tournament-year.entry`(20)、`PRODUCT_DELETE_NOTICES`の`tournament-year.entry-loss`(20)、`ADMIN_SETTINGS_SECTIONS`の`tournament-year.final-date`(10) |
| 購入種別・価格       | `year_tournament_entry`、価格の`lookup_key`は`year_tournament_entry`(参考価格$20)                                                                                                                                                                                                                       |
| 返金                 | 依頼キー`tournament-year:<購入ID>:<理由>`、理由`entitlement_lost`・`entitlement_suspended`・`capacity_exceeded`                                                                                                                                                                                         |
| メール種別           | `tournament-year.entry-refund`(トランザクション)                                                                                                                                                                                                                                                        |
| 監査ログ             | `year-final-date.update`(対象`setting`、理由は任意)                                                                                                                                                                                                                                                     |
| URL                  | `/tournaments/year/<年>`(例`/tournaments/year/2027`)                                                                                                                                                                                                                                                    |
| 要約のrank           | Product of the Year 100・マッチ中90・進出と敗退80・参加決定70・参加受付中60                                                                                                                                                                                                                             |

文言規則に追加する文言:

- エラー: 「このYearトーナメントの参加枠は見つかりません。」(`year_entry_not_found`)、「このプロダクトはYearトーナメントの参加資格を得ています。」(`year_entry_already_entitled`)、「Yearトーナメントの参加受付は終了しました。」(`year_entry_closed`・`checkout_closed`)、「このプロダクトは現在Yearトーナメントに参加できません。」(`year_entry_product_unavailable`)、「Ultrasの特典により参加費は免除されます。」(`year_entry_exempt`)。
- 固定: 「Yearトーナメントに勝ち残っているため、ローンチ日・カテゴリの変更と削除はできません。」。削除の注意書き(12.6)。
- 状態: 「<週の表記>のProduct of the Week受賞により、<年>年のYearトーナメントに参加できます。決勝は<決勝日>です。」「参加資格を得ました。組み合わせは<日時>に決定します。」「組み合わせに参加しています。」「<ラウンド名>で敗退しました。」「Product of the Yearを受賞しました。」「決済期限までに参加費の決済が無かったため参加できませんでした。」「組み合わせ決定の時点でプロダクトが公開されていなかったため参加できませんでした。」「参加数の上限(64)を超えたため参加できませんでした。」「プロダクトの削除により参加資格を失いました。」「組み合わせ決定の後にWeek優勝が反映されたため参加できませんでした。」、返金の対象のとき末尾に「参加費は自動で全額返金されます。」。
- ブラケット・トップページ: 「Product of the Yearトーナメント」「ブラケットを見る」、決勝の結果の2文(上記)。
- 管理画面: 見出しと説明(上記)、「設定済み」「既定(5月の最終日曜日)」「最上位管理者だけが変更できます」「変更期限(決勝の7日前)を過ぎたため変更できません」「選べる日付がありません」、確認「<年>年の決勝実施日を<日付>に変更しますか?受付期限は<日時>、組み合わせ決定は<日時>になり、対象となるWeek優勝の期間も変わります。」、成功「決勝実施日を保存しました。」、注意「翌年の決勝実施日が未設定のため、既定の<日付>では64週以上空きます。参加数を64以下に保つため、翌年の決勝実施日を設定してください。」、拒否の理由「現在の年か翌年を選んでください。」(`year_not_editable`)・「日曜日を選んでください。」(`not_sunday`)・「対象年の日付を選んでください。」(`out_of_year`)・「現在から8日後以降の日付を選んでください。」(`too_soon`)・「前年の決勝実施日(<日付>)から64週以上空く日付は選べません。」(`too_far_from_previous`)・「翌年の決勝実施日(<日付>)まで64週以上空く日付は選べません。」(`too_far_from_next`)・「決勝実施日の7日前を過ぎたため変更できません。」(`final_date_locked`)。
- 返金の知らせ: 件名(上記)と3つの理由の文。
