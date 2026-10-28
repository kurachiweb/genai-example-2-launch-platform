# Research & Design Decisions

## Summary

- **Feature**: `directory-discovery`
- **Discovery Scope**: Complex Integration(ディレクトリとプロダクト詳細ページの実装は無い。上流の18spec(dev-tooling〜match-engine)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはmatch-engineのマッチの照会口・サポーターの照会・`qualifierWins()`・確定のマッチイベント・対戦カードの部品、product-launchの`ProductDirectory`・`ProductCategoryDirectory`・`visibleProducts()`・`wonLaunchExists()`・プロダクトライフサイクルの登録口・ローンチの要約と受賞の供給元・`productOwnerStatus`、content-processingの検索対象の登録口・索引のひな形・`ftsRankedSources`・検索語の正規化と強調表示、identity-authのユーザーライフサイクルの登録口、user-profile-socialの`UserSummary`・`FollowButton`・`publicProfile`の上に、ディレクトリ・プロダクト詳細ページ・プロダクトの検索索引を足す)
- **Key Findings**:
  - ページ配置(`docs/GUIDES/service/design/002-page-layouts.md`)の「一覧項目」が、roadmapの論点(複数回勝利したプロダクトの単位・基準ローンチ)の答えを既に書いている(「基準勝利マッチ1件」「期間内の最新の勝利、それ以外は直近の勝利」「ソートキーも基準勝利の値」)。モックアップの`-model/listing.ts`も同じ規則で作られている。ただしbriefとroadmapが要件フェーズでの確認を求めているため、仮1・仮2として記録した(match-engineの仮1と同じ扱い)。
  - match-engineの`qualifierWins()`は「ディレクトリの並べ替えと期間の絞り込みのため」に用意された部品で、product-launchの`visibleProducts()`・`wonLaunchExists()`と結合して使う前提になっている(match-engineのdesign.mdの利用例)。1つのプロダクトに1つの予選は1日1回しか無いため、基準勝利は「期間内で実施日が最大の勝利」の1行に一意に決まり、窓関数`ROW_NUMBER()`で1回の問い合わせに収まる。
  - product-launchには、プロダクトの内容の編集(登録・編集・公開APIの説明文の更新)を他の機能へ伝える口が無い。プロダクトライフサイクルイベントは`deleted`・`hidden`・`unhidden`・`purge_due`だけである。FR-ADMUG-011の「編集時の索引の更新」を満たすには上流への追加が要る(仮4)。
  - ユーザーの退会・停止の同期の処理は利用者IDしか受け取らず、その利用者のプロダクトの一覧をproduct-launchの公開の照会口から得られない(`products.user_id`を直接読むのは境界の違反)。本specが「勝利したことのあるプロダクトと投稿者」の小さな記録を持てば、自分のテーブルだけで集合の削除・作り直しができる。
  - 要件定義書FR-SPONS-009は「ディレクトリページの広告スペース」を挙げるが、ページ配置は「ディレクトリ: スポンサー広告は表示しない」としている(仮3)。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を「仮」として採用した。**仮1〜仮5は2026-10-24に開発者がいずれも推奨どおりに確定した。** 決定は`requirements.md`の「要件フェーズでの仮決定」にも記録する。roadmapの「Requirement Ambiguities」の表の「複数回勝利したプロダクトのディレクトリ上の単位、ソートと期間絞り込みの基準ローンチ」の行(directory-discoveryの担当)は、仮1・仮2で決めた。roadmapは編集せず、解決の列の文言をコントローラーへ報告する。

| #   | 論点                                                       | 根拠                                                                                                                                                                                          | 選択肢                                                                                                                                                                                                 | 推奨と採用(2026-10-24に開発者が確定)                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | 複数回の予選で勝利したプロダクトの一覧上の単位             | FR-DIR-001・002(単位を定めない)、ページ配置の一覧項目(「基準勝利マッチ1件の情報を表示」)、モックアップ`listing.ts`、briefのConstraints、roadmapのRequirement Ambiguities                      | (A)1プロダクト1項目で基準勝利1件を表示 / (B)勝利ごとに1項目                                                                                                                                            | 推奨・採用は(A)。ページ配置とモックアップに一致する。(B)は同じプロダクトが一覧に何度も並び、カテゴリの掲載数・件数・詳細ページへの導線が重複する。プロダクト詳細ページがプロダクト単位であることとも合う                                                                                                                                                             |
| 仮2 | 並べ替えの「ローンチ日」「Upvote数」と期間の絞り込みの基準 | FR-DIR-007・010、ページ配置の一覧項目(「期間内の最新の勝利、それ以外は直近の勝利」「ソートキーも基準勝利の値」)、モックアップ`listing.ts`、日次タイムライン(期間は基準時刻の日付)             | (A)期間内の最新の勝利(期間なしは直近の勝利)を基準にし、期間内に勝利の無いプロダクトは除く / (B)初めての勝利を基準 / (C)直近のローンチ(勝敗を問わない)を基準                                            | 推奨・採用は(A)。ページ配置に一致し、「今週」で絞り込むと今週勝ったプロダクトだけが今週のローンチ日で並ぶ。(B)は再ローンチで勝ったプロダクトが古い日付に埋もれる。(C)は敗北したローンチの日付で掲載中のプロダクトが並び、表示する「勝利した予選マッチ」と食い違う                                                                                                    |
| 仮3 | ディレクトリページの広告スペース                           | FR-SPONS-009(トップ・ディレクトリ・詳細の広告スペース)、ページ配置のディレクトリ(「スポンサー広告は表示しない」)、sponsorshipのbrief(「トップ・ディレクトリ・詳細の各ページに表示」)          | (A)要件定義書を正とし、ディレクトリにも区画の登録口を設ける。表示の有無と中身はsponsorshipが決める / (B)ページ配置を正とし、登録口を設けない                                                           | 推奨・採用は(A)。要件定義書がSSoTで、sponsorshipのbriefも同じ前提である。登録口は空なら何も描かないため、ページ配置のとおり広告を出さない判断もsponsorshipの登録の有無で選べる。ページ配置の記述とFR-SPONS-009の食い違いは要件定義書またはサービス仕様の改訂で解消する(sponsorshipの設計で確定する)                                                                  |
| 仮4 | プロダクトの内容の編集を検索索引へ伝える方法               | FR-ADMUG-011(「編集時」)、FR-FTS-003(作成・編集をトリガー)、product-launchの設計(編集を伝えるイベントや登録口が無い)、briefのApproach(「プロダクトとマッチのイベントへのハンドラとして実装」) | (A)product-launchの保存に、同じ一括の書き込みへ文を加え確定の後に処理を行う登録口`PRODUCT_SAVE_HOOKS`を足す / (B)プロダクトライフサイクルイベントに`updated`を足す / (C)本specの定期の処理で変更を拾う | 推奨・採用は(A)。更新待ちの印を保存と同じ書き込みで確定できるため取りこぼさず、イベントの記録を増やさない。(B)は編集のたびにイベントの記録と実行器の処理が増え、同期の処理の型(`SyncProductLifecycleEventType`)も変わる。(C)は`products`を直接読む境界の違反で、反映が遅れる。上流spec(product-launch)の改訂を要したが、product-launchが仮11として加えた(2026-10-24) |
| 仮5 | マッチ履歴の「サポーター◯人」の数                          | FR-DIR-005・014(一覧から退会・停止を除く)、FR-GAME-010(確定値)、モックアップ`match-row.tsx`(`supporterCount`)、match-engineの`SupporterDirectory`(数の照会が無い)                             | (A)その側の確定のUpvote数を表示し、除いた利用者がいる旨を一覧に添える / (B)表示できるサポーターだけを数える                                                                                            | 推奨・採用は(A)。スコア(「12対9」)と同じ数になり、確定値を変えないFR-GAME-010と合う。一覧の注記(「退会・停止したユーザーは表示されません。」)はページ配置の文言そのものである。(B)は数を照会する口がmatch-engineに無く、上流の追加が要る                                                                                                                             |

### 確認済みのため質問しない事項

- 掲載の対象の勝利: FR-DIR-001が挙げるFR-GAME-004・011・012・015・016(Upvote数・最終Upvote時間による勝利、不戦勝、相手の退会等による勝利)。match-engineの`qualifierWins()`(結果が`won`・`bye`・`walkover`の予選の側)と、product-launchの`wonLaunchExists()`(ローンチの予選の結果が勝利)が同じ集合を表す。トーナメントの結果は掲載に関わらない。
- 除外の条件: FR-DIR-013(退会済み・停止中の投稿者、非公開化)と論理削除。product-launchの`visibleProducts()`がまとめて表す。
- 詳細ページの公開範囲と404・旧ハンドルの302: ページ配置の「プロダクト詳細の公開範囲」、FR-PRDCT-021・FR-UPROF-012、user-profile-socialの公開プロフィールの解決(旧ハンドルは保持者を閲覧者に表示できる場合だけ転送)と同じ形にする。
- 期間の区切り: 基準時刻の暦日、週は月曜日始まり(ページ配置・日次タイムライン)。「未来の日付は選べません。」は画面の検証で、APIは未来の日付をそのまま条件として扱う(0件になる)。
- 期間の入力欄: ページ配置は「日付入力」とし、モックアップはブラウザの日付入力欄(`type="date"`)を使う。product-launchの仮10のカレンダー(`react-day-picker`、確定済み)には依存しない。
- 検索の照合規則: content-processingの`buildFtsMatchExpression`(各語の前方一致の論理積)と`findHighlightRanges`。50文字の上限と40文字からのカウンターはページ配置。
- 検索の対象の項目: 名称・タグラインを索引の列、説明文はマークダウンの構文を除いたキーワードの抽出だけに使う(FR-FTS-004〜006、help-centerの本文と同じ扱い)。ページ配置の「説明文やキーワード抽出結果のみで一致」に合う。
- 停止中の投稿者のプロダクトの索引: briefのApproach(「掲載条件(勝利済み・可視)をこのspecが所有し、検索索引もそれに合わせて管理する」)により、索引の対象を掲載中のプロダクトとし、停止で外して解除で戻す。検索の結果は索引によらず`visibleProducts()`でも絞る。
- 詳細ページのフォローボタンの初期状態: user-profile-socialの`publicProfile`の`viewerRelation`(GraphQLの公開の操作)を、ログイン中で投稿者本人でない閲覧者のときだけ読む。上流の変更は要らない。
- 投稿者本人向けの操作の予約の可否: product-launchの`productOwnerStatus`(本specの詳細ページのために用意された照会)を使う。
- ローンチの結果の要約と受賞: product-launchの`LAUNCH_SUMMARY_SOURCES`(公開の契約)を呼び、供給が無い・失敗したローンチは予選の結果から要約する(product-launchの`LaunchHistoryReader`と同じ規則、`backend/013`)。
- 一覧の項目のコメント数: engagementの持ち物である。本specは項目の値の供給元の登録口を設け、engagementが登録する。
- 波及処理とイベントの処理の`order`: 本specの1200番台(roadmapの帯の割り当て)。確定のマッチイベントの処理はmatch-engineの`match-engine.qualifier-outcome`(1100)の後に動くため、予選の結果がローンチへ記録された後に掲載を判定できる。上流の値より前に動く必要のある処理は無い。4:21のジョブは持たない(索引の再処理はcontent-processingの日次の再抽出が行う)。
- 新しいパッケージ: 無い。日付入力はブラウザの入力欄、下部のシート・ポップオーバー・リストボックスはfrontend-platformが移植したshadcn/uiの部品(`radix-ui`)、強調表示はcontent-processingの`HighlightedText`、通知は`notify`を使う。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(match-engineと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(プロダクトライフサイクルイベント・可視性フィルタ・ハンドル基盤・マッチとブラケット・画面シェル・GraphQLのスキーマモジュール)。
- **Sources Consulted**: match-engine・product-launch・content-processing・help-center・user-profile-social・identity-auth・frontend-platformの`design.md`、match-engine・product-launch・content-processingの`research.md`の後続specへの申し送り、engagement・sponsorship・tournament-week・public-api・ugc-moderation・content-reportingのbrief。
- **Findings**:
  - match-engine: `MatchDirectory.listByLaunches(launchIds, now)`(ローンチごとのマッチ、実施日の新しい順、`decision`・`endedEarly`・側の`result`・`upvoteCount`)・`findMatches`・`SupporterDirectory.listSupporters({ entryId, after, limit 1〜20 })`(確定したマッチの側の有効なUpvote、`visibleUsers()`、Upvoteの日時の早い順)・`qualifierWins()`(`launchId`・`productId`・`upvoteCount`・`lastUpvotedAt`・`matchDate`・`decidedAt`)・`MATCH_EVENT_HANDLERS`(`decided`、`kinds`、`order`はroadmapの帯)・GraphQLの`Match`・`matchViewLoader`・clientの`MatchCard`・`useUpvote`・`TurnstileWidget`(`match_upvote`)。申し送りに「directory-discoveryは`MatchDirectory.listByLaunches`・`SupporterDirectory.listSupporters`・`qualifierWins()`・確定のマッチイベント(1200番台)を使い、開催中のマッチは`MatchCard`・`useUpvote`・`matchViewLoader`を使う」とある。
  - product-launch: `ProductDirectory.findSummaries(ids, 'visible'|'not-deleted')`(`visible`・`listed`・`hidden`・カテゴリ・ロゴ)・`resolveHandle`(`current`・`previous`・`none`、論理削除済みは解決しない)・`findDetail`(説明文・スクリーンショット)・`listLaunches`(取消を含む、`number`・`status`)、`ProductCategoryDirectory.list`・`findByHandle`、`visibleProducts()`・`wonLaunchExists()`(`users`との結合が前提)、`PRODUCT_LIFECYCLE_SYNC_HANDLERS`・`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`、`LAUNCH_SUMMARY_SOURCES`、GraphQLの`ProductCategory`・`productCategoryLoader`・`LaunchSummary`・`ProductAward`・`LaunchStatus`・`productOwnerStatus`、`PRODUCT_HANDLE_RULE`。後続specは`products`などを直接読まず、問い合わせで結合してよいのは`visibleProducts()`・`wonLaunchExists()`の絞り込みだけである。申し送りに「掲載の条件のうちプロダクト側は本specの部品で判定し、索引の更新は`deleted`・`hidden`・`unhidden`・`purge_due`の処理として登録する」とある。
  - content-processing: `searchDocumentColumns`・`searchTextColumn`・`searchDocumentStatusIndex`・`defineSearchIndex`・`SEARCH_INDEXES`・`print-search-index-sql.ts`・`ftsRankedSources`・`bm25Rank`(`apps/db`)、`defineSearchTarget`(`read(db, sourceId)`・`isIndexable(sourceId)`)・`SEARCH_TARGETS`・`SearchIndexStatements`(`markPending`・`deleteSources`)・`SearchIndexRefreshRequester`(送信の失敗を例外にしない)、`normalizeSearchTerms`・`buildFtsMatchExpression`・`findHighlightRanges`・`HighlightedText`、日次の再抽出(`fallback`と1時間以上`pending`の索引文書)。
  - help-center: 同じ基盤の利用の先例。重みはタイトル10・サブタイトル5・キーワード1、本文は`markdown`で`extract: true`・`textColumn: false`。
  - identity-auth: `USER_LIFECYCLE_SYNC_HANDLERS`(`withdrawn`・`suspended`・`unsuspended`、集合の更新の文だけ)・`USER_LIFECYCLE_ASYNC_HANDLERS`(`order`)・`AccountGuard.currentUser`・`LoginRequiredDialog`。
  - user-profile-social: `UserSummary`・`userSummaryLoader`(可視でなければnull)・`FollowButton`(`initialFollowing`)・`UserAvatar`・`publicProfile`の`viewerRelation`・`checkHandleFormat`・`checkExternalUrl`。公開プロフィールのルートの302の作り(`redirect({ statusCode: 302 })`と検索パラメーターの維持)。
  - frontend-platform: `buildPageHead`(`noIndex`)・`NotFoundView`・`ErrorState`・`PartialErrorState`・`EmptyState`・`LoadingSkeleton`・`notify`・日時の表示部品・shadcn/uiの部品(モックアップの`components/ui`の移植。シート・ポップオーバー・ドロップダウンを含む)。
  - 下流のbrief: engagementは詳細ページの評価の区画とローンチごとのコメントの区画を、sponsorshipはトップ・ディレクトリ・詳細の広告を、tournament-week・tournament-yearは詳細ページのトーナメントの区画(トロフィー)と参加費の導線を、content-reportingは通報の操作を加える。public-apiは公開のプロダクトを読む。
- **Implications**: 上流のファイルの変更は、契約で定められた登録箇所への追記だけにする。仮4の`PRODUCT_SAVE_HOOKS`・カテゴリの条件`productInCategory()`・要約と受賞のまとめの規則(`launch-summary.ts`)は、本specの依頼でproduct-launchが仮11として加えた(2026-10-24)。

### 一覧の問い合わせと基準勝利

- **Context**: 要件1・3・5・6、仮1・仮2、NFR-PERF-007(GraphQLの95パーセンタイル300ms)・NFR-PERF-008(N+1の禁止)、D1の制約。
- **Sources Consulted**: [SQLite Window Functions](https://www.sqlite.org/windowfunctions.html)、`docs/GUIDES/tech/db/002-d1-constraints.md`、content-processingの`ftsRankedSources`の利用の規約、モックアップ`listing.ts`。
- **Findings**:
  - 基準勝利は「`qualifierWins()`を期間で絞り、プロダクトごとに実施日の降順で1行目」で、`ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY match_date DESC)`で求められる。1つのプロダクトの予選は1日に1回だけ(product-launchの部分一意索引と`launch_date`)のため、同順位は起きない。
  - 一覧の1ページ(`LIMIT 20 OFFSET ?`)と総件数を同じ条件の2文にし、1回の`db.batch()`で読めば、件数とページの食い違いを小さくできる。
  - 検索は`ftsRankedSources`の副問い合わせを`products.id = source_id`で結合し、`rank`の昇順で並べる。可視性と勝利の条件は検索の時点の状態で判定され、索引の更新が遅れても掲載中でないものは出ない(要件4.8)。
  - 表示の項目(名称・ロゴ・カテゴリ)は、ページのIDで`ProductDirectory.findSummaries`をまとめて1回呼んで得る。基準勝利の不戦勝の種類(相手なし・マッチ直前・マッチ中)は`qualifierWins()`に無いため、ページの基準勝利のローンチのIDで`MatchDirectory.listByLaunches`を1回呼んで得る。
- **Implications**: `DirectoryListingQuery`(backend-libの共有部品、apiとpublic-apiが使う)に、問い合わせの組み立てを集める。

### 検索索引の対象と更新の契機

- **Context**: 要件12、FR-ADMUG-011・FR-FTS-003〜006・009、仮4。
- **Findings**:
  - 索引の対象を掲載中のプロダクトにすると、`isIndexable`は`visibleProducts() AND wonLaunchExists()`の存在の条件で書け、content-processingの条件付きの書き込みが対象外の作成を防ぐ。
  - 更新の契機は、(1)予選の勝利(確定のマッチイベント)、(2)編集(仮4)、(3)論理削除・非公開化(プロダクトの同期の処理で同じ一括の書き込みに削除)、(4)退会・停止(ユーザーの同期の処理)、(5)復元・停止の解除(非同期の処理で作り直し)、(6)物理削除(プロダクトの`purge_due`)。
  - ユーザーの同期の処理は利用者IDしか受け取らない。本specが勝利したプロダクトとその投稿者の記録(`directory_entries`)を持てば、`product_search_documents`の削除を自分のテーブルの副問い合わせで書ける。投稿者は変わらないため、記録は勝利のマッチイベントの処理で作るだけでよい。
  - 索引の`source_version`は元データの版を要するが、`ProductDirectory`の記録に更新日時が無い。`read`は常に処理の時点の元データを読むため、読み取りの時刻(ミリ秒)を版にしても、古い読み取りの書き込みは新しい読み取りの書き込みに負けて捨てられる(content-processingの`excluded.source_version >= source_version`の条件)。
- **Implications**: 同期の処理2つ(ユーザー・プロダクト)、非同期の処理3つ(復元・停止の解除・物理削除)、マッチイベントの処理1つ、保存の登録口への登録1つ(仮4)を持つ。

### プロダクト詳細ページの構成

- **Context**: 要件8〜11、ページ配置の「プロダクト詳細」、モックアップ(`$handle/index.tsx`・`product-content.tsx`・`launch-block.tsx`・`match-row.tsx`・`supporters-panel.tsx`・`owner-card.tsx`・`live-match-section.tsx`)、下流のbrief。
- **Findings**:
  - モックアップは、本文(ヘッダー・開催中のマッチ・トロフィー・スクリーンショット・説明文・ローンチ単位のブロック・通報)とサイドバー(投稿者本人向けの操作・評価)の構成で、評価・コメント・トロフィー・通報・参加費の決済は後続specの持ち物である。
  - 後続specが区画を加える置き場所は、ページ上部(広告のLegend)・本文(トロフィー)・サイドバー(評価・広告のGold)・ページ末尾(通報・広告のSilver)・ローンチのブロックの中(コメント)・投稿者本人向けの操作の中(参加費の決済)の6つである。match-engineの`TOP_PAGE_SECTIONS`と同じ形(置き場所と`order`)にする。
  - 開催中のマッチは、match-engineの`matchViewLoader`で`Match`を返し、`MatchCard`・`useUpvote`をそのまま使えば、トップページと同じ演出と操作になる。
- **Implications**: `PRODUCT_PAGE_SECTIONS`・`PRODUCT_LAUNCH_SECTIONS`・`PRODUCT_OWNER_ACTIONS`、ディレクトリの`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`(仮3)と、一覧の項目の値の`DIRECTORY_ITEM_METRIC_SOURCES`(api)・`DIRECTORY_ITEM_METRICS`(client)を設ける。

## Architecture Pattern Evaluation

| Option                                           | Description                                                                           | Strengths                                                      | Risks / Limitations                                                              | Notes            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------- |
| 上流の部品を結合する1回の問い合わせ(採用)        | `qualifierWins()`・`visibleProducts()`・`wonLaunchExists()`・`ftsRankedSources`を結合 | 掲載の条件が常に最新、写しを持たない、上流の想定どおりの使い方 | 勝利の数が増えると窓関数の範囲が広がる                                           | match-engineの例 |
| 掲載の写しのテーブルを持つ                       | 勝利・カテゴリ・可視性の写しをイベントで更新                                          | 並べ替えの索引を自由に張れる                                   | 退会・停止・非公開化・カテゴリの変更のたびに写しを直す処理が要り、食い違いが残る | 不採用           |
| 勝利ごとに1項目                                  | 予選の勝利の行をそのまま並べる                                                        | 問い合わせが単純                                               | 仮1の(B)の欠点                                                                   | 不採用           |
| 編集の索引の更新をプロダクトライフサイクルで行う | `updated`のイベントを足す                                                             | 既存の実行器で動く                                             | 仮4の(B)の欠点                                                                   | 不採用           |

## Design Decisions

### Decision: 基準勝利を窓関数で1回の問い合わせの中で選ぶ

- **Context**: 要件1.6・2.7・3.6・5.4、仮1・仮2。
- **Alternatives Considered**:
  1. 窓関数`ROW_NUMBER()`でプロダクトごとの最新の勝利を選び、同じ問い合わせで並べ替えとページ分けを行う
  2. 掲載の写しのテーブルにプロダクトごとの最新の勝利を持つ
- **Selected Approach**: 1。期間の条件を窓関数の前に掛けるため、期間内の最新が自然に基準勝利になる。並べ替えは基準勝利の実施日・Upvote数・関連度と、同順位の決まった順(実施日の降順・プロダクトのIDの降順)で、`LIMIT`・`OFFSET`でページを切る。
- **Rationale**: 写しを持たないため、退会・停止・非公開化・カテゴリの変更が即座に反映される。
- **Trade-offs**: 勝利の数(1日に数百件規模)に比例して読み取りが増える。launch-readinessの性能の検証で確かめ、超えるなら写しの導入を検討する(Risks)。

### Decision: 勝利したプロダクトと投稿者の記録を持つ

- **Context**: 要件12.4〜12.7、ユーザーの同期の処理の規約(集合の更新の文だけ)。
- **Selected Approach**: `directory_entries`(プロダクトID・投稿者ID・最初の勝利の日時)を勝利のマッチイベントの処理で作る。退会・停止の同期の処理は`DELETE FROM product_search_documents WHERE source_id IN (SELECT product_id FROM directory_entries WHERE owner_user_id = ?)`を返し、停止の解除の非同期の処理は同じ記録から作り直す。プロダクトの`purge_due`で行を消す。
- **Rationale**: product-launchの`products`を直接読まずに、利用者単位の操作を自分のテーブルで行える。

### Decision: 区画の登録口を置き場所と順で持つ

- **Context**: 要件2.12・7.10・9.10・9.11・10.14・11.5、roadmapの画面シェル(プロダクト詳細ページはdirectory-discoveryが所有し他specが区画を追加)。
- **Selected Approach**: match-engineの`TOP_PAGE_SECTIONS`と同じ形の`PRODUCT_PAGE_SECTIONS`(`banner`・`main`・`aside`・`bottom`)・`PRODUCT_LAUNCH_SECTIONS`・`PRODUCT_OWNER_ACTIONS`・`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`と、項目の値の`DIRECTORY_ITEM_METRIC_SOURCES`(api)・`DIRECTORY_ITEM_METRICS`(client)。本specの区画(スクリーンショット・説明文・マッチ履歴・投稿者本人向けの操作)も同じ登録口に置き、後続specの順を空けておく。
- **Rationale**: 後続specは本specのファイルを書き換えず、登録の1行で区画を加えられる。GraphQLの型の拡張を禁じるapi-gatewayの規約のもとで、項目の値は供給元の登録口で受け取る(product-launchの`LAUNCH_SUMMARY_SOURCES`と同じ形)。

### Decision: 編集の索引の更新を保存の登録口で行う(仮4)

- **Context**: 要件12.3、FR-ADMUG-011。
- **Selected Approach**: product-launchが仮11として提供する`PRODUCT_SAVE_HOOKS`(`ProductSaveHook`の`statementsFor({ productId, at }, db)`と`afterCommit({ productId })`)に、本specの`directory-discovery.product-index-refresh`を登録する。同期の部分は`directory_entries`があるプロダクトだけ`markPending`を返し、確定の後に`requestRefresh`を送る。
- **Rationale**: 更新待ちの印が保存と同じ書き込みで確定し、要求の送信が失敗してもcontent-processingの日次の再抽出が拾う。
- **Follow-up**: product-launchが仮11として登録口を加えた。仮11と本specの仮4は2026-10-24に開発者が推奨どおりに確定した。

### Decision: 採らなかった案

- ディレクトリの無限スクロール: FR-DIR-011・012がオフセット方式とURLのページ番号を求める。
- 一覧の件数の概数化: ページ配置が「1,234件中21〜40件」の正確な件数を示す。
- 詳細ページのサポーターの数の照会: 仮5で確定のUpvote数を使うため持たない。
- ディレクトリの4:21のジョブ: 索引の取りこぼしはcontent-processingの日次の再抽出と、各イベントの実行器の再試行で回復する。

## Synthesis

- **Generalization**: 一覧・絞り込み・検索・並べ替えを、「掲載の条件に期間・カテゴリ・検索語の条件を足し、基準勝利の値で並べる」1つの問い合わせに一般化した。勝利・編集・削除・非公開化・停止・復元・物理削除を、「掲載中かどうかが変わり得たプロダクトの索引を、処理の時点の状態から作り直す」1つの考え方(消すのは同じ書き込み、作るのは非同期)に一般化した。詳細ページとディレクトリの区画を、置き場所と順の登録に一般化した。
- **Build vs Adopt**: 全文検索・索引の更新・強調表示(content-processing)、マッチの照会・サポーター・対戦カード・Upvote(match-engine)、プロダクトの照会・ハンドルの解決・可視性の条件・ローンチの要約と受賞・予約の可否(product-launch)、利用者の表示・フォロー(user-profile-social)、日付入力(ブラウザの入力欄)を使う。基準勝利の選択はSQLiteの窓関数を使う。新しいパッケージは無い。
- **Simplification**: 掲載の写し・4:21のジョブ・サポーターの数の照会・期間のカレンダーの部品を持たない。一覧の項目の対戦相手の情報を読まない(ページ配置)。

## Risks & Mitigations

- 予選の勝利の数が増えると、一覧の問い合わせの読み取りが増えてNFR-PERF-007の300msを超える — 期間の条件を窓関数の前に掛け、`match_entries`の`(match_kind, match_date)`の索引を使う。launch-readinessの性能の検証で、10万件の勝利の合成データで確かめる。超える場合は掲載の写しのテーブル(Architecture Pattern Evaluationの2つ目)を導入する。
- 区画の登録口の形が後続specの必要と合わない — 形を`Revalidation Triggers`に挙げ、後続specの設計で確かめる。
- 技術ドキュメントの番号の重なり — 並行して作成中のnotificationsと同じ番号になり得る。本specは各ディレクトリで最も小さい空き番号(`db/007`・`frontend/014`)を使い、コントローラーへ報告する。

## References

- `docs/GUIDES/service/design/002-page-layouts.md` — ディレクトリ・プロダクト詳細の配置・公開範囲・状態表示・外部リンクの`rel`
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — 本機能の文言と表記規則(スコア・不戦勝・両者敗北)
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 期間の絞り込みの基準時刻
- `mockups/src/routes/client/p`・`mockups/src/routes/client/p/$handle` — ディレクトリとプロダクト詳細のモックアップ
- [SQLite Window Functions](https://www.sqlite.org/windowfunctions.html) — `ROW_NUMBER()`による各群の1行の選択
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html) — `bm25()`と前方一致

## 仮決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。要件定義書と上流specに最も整合する案を採用して要件・設計・タスクを作った。**2026-10-24に開発者がいずれも推奨どおりに確定した。** `requirements.md`の「要件フェーズでの仮決定」にも同じ行がある。

| #   | 論点                           | 採用した案(確定)                                                 | 他の選択肢                             | 影響する箇所                                                               |
| --- | ------------------------------ | ---------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| 仮1 | 複数回勝利したプロダクトの単位 | 1プロダクト1項目、基準勝利1件を表示                              | 勝利ごとに1項目                        | 要件1.6・2.7、`DirectoryListingQuery`                                      |
| 仮2 | 並べ替えと期間の基準           | 期間内の最新の勝利(期間なしは直近)、期間内に勝利の無いものは除く | 初めての勝利 / 直近のローンチ          | 要件3.6・5.4、`DirectoryListingQuery`、ページ配置                          |
| 仮3 | ディレクトリの広告スペース     | 区画の登録口を設け、表示の有無はsponsorshipが決める              | 登録口を設けない                       | 要件7.10、`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`、sponsorship |
| 仮4 | 編集を索引へ伝える方法         | product-launchの仮11の`PRODUCT_SAVE_HOOKS`に登録する             | ライフサイクルに`updated` / 定期の走査 | 要件12.3、`ProductIndexRefreshSaveHook`、product-launch                    |
| 仮5 | 「サポーター◯人」の数          | 確定のUpvote数                                                   | 表示できるサポーターだけを数える       | 要件10.8、`MatchHistoryRow`                                                |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID                 | 内容                                                                           | 根拠 |
| ---------------------- | ------------------------------------------------------------------------------ | ---- |
| FR-DIR-002             | 複数回勝利したプロダクトは1項目とし、基準勝利の1件を表示する旨を加える         | 仮1  |
| FR-DIR-007・FR-DIR-010 | 期間の絞り込みと「ローンチ日」「Upvote数」の並べ替えに基準勝利を使う旨を加える | 仮2  |
| FR-SPONS-009           | ディレクトリページに広告を表示するかどうかを、ページ配置と一致させる           | 仮3  |
| FR-DIR-005             | 「サポーター◯人」の数を確定のUpvote数とする旨を加える                          | 仮5  |

## 上流・後続specへの影響

- product-launch(上流): 本specの依頼で、保存の登録口`PRODUCT_SAVE_HOOKS`(`apps/api/src/composition/product-save-hooks.ts`、契約は`application/product/product-save-hooks.ts`)・カテゴリの条件`productInCategory(categoryId)`・要約と受賞のまとめの規則`backend-lib/core/product/launch-summary.ts`を仮11として加え、タスクも承認し直された(2026-10-24)。本specはそれらを使い、ファイルを変えない。登録箇所への追記(契約どおり): `PRODUCT_SAVE_HOOKS`に`directory-discovery.product-index-refresh`、`PRODUCT_LIFECYCLE_SYNC_HANDLERS`に`directory-discovery.product-index-removal`(`deleted`・`hidden`)、`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`に`directory-discovery.product-index-restore`(`unhidden`、1200)・`directory-discovery.entry-erasure`(`purge_due`、1200)。
- match-engine(上流): `MATCH_EVENT_HANDLERS`に`directory-discovery.qualifier-listing`(`decided`・予選、1200)を足す(契約どおり)。`MatchDirectory`・`SupporterDirectory`・`qualifierWins()`・`matchViewLoader`・`MatchCard`・`useUpvote`を契約どおりに使う。
- identity-auth(上流): `USER_LIFECYCLE_SYNC_HANDLERS`に`directory-discovery.account-index-removal`(`withdrawn`・`suspended`)、`USER_LIFECYCLE_ASYNC_HANDLERS`に`directory-discovery.account-index-restore`(`unsuspended`、1200)を足す(契約どおり)。
- content-processing(上流): `SEARCH_INDEXES`に`PRODUCT_SEARCH_INDEX`、`SEARCH_TARGETS`に検索対象`product`を足す(契約どおり)。
- user-profile-social(上流): `FollowButton`・`UserAvatar`・`UserSummary`・`publicProfile`の`viewerRelation`を使う。変更は無い。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「波及処理は1200」になる(プロダクトライフサイクル・マッチイベントの処理も1200。4:21のジョブは無い)。Requirement Ambiguitiesの「複数回勝利したプロダクトのディレクトリ上の単位、ソートと期間絞り込みの基準ローンチ」の行の解決の列は「directory-discovery 仮1・仮2(…、2026-10-24に開発者が確定)」。本specはroadmapを編集しないため、コントローラーへ報告する。
- engagement(後続): `PRODUCT_PAGE_SECTIONS`の`aside`(評価、20)・`PRODUCT_LAUNCH_SECTIONS`(コメント、10)・`DIRECTORY_ITEM_METRIC_SOURCES`と`DIRECTORY_ITEM_METRICS`(コメント数、`comments`)に登録する。
- tournament-week・tournament-year(後続): `PRODUCT_PAGE_SECTIONS`の`main`(トロフィー、10)・`PRODUCT_OWNER_ACTIONS`(参加費の決済、Week 10・Year 20)に登録し、受賞とローンチの要約はproduct-launchの`LAUNCH_SUMMARY_SOURCES`へ供給する(本specが詳細ページとディレクトリで読む)。
- sponsorship(後続): `PRODUCT_PAGE_SECTIONS`の`banner`(Legend)・`aside`(Gold、30)・`bottom`(Silver、20)、`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`(仮3、表示するかどうかを含めて決める)に登録する。
- content-reporting(後続): `PRODUCT_PAGE_SECTIONS`の`bottom`(通報、10。本人には描画しない)に登録する。
- public-api(後続): `DirectoryListingQuery`と`ProductDirectory`で公開のプロダクトを読む。
- ugc-moderation(後続): 非公開化・復元をproduct-launchの`ProductVisibilityControl`で、停止をidentity-authで発火すれば、本specの処理で索引が直る。

## 要件のレビュー(2026-10-24)

- 機械的な確認: 14の要件の見出しがすべて数字のIDを持ち、124件の受け入れ基準がすべてEARSの形式(`When`・`If`・`While`・`Where`・`The … shall`)である。技術名は要件定義書の用語(BM25・NFKC)と外部リンクの`rel`の値(ページ配置の規則)だけに限った。
- 1回目の判断のレビューで、(1)ページの番号の技術的な上限という実装の詳細を含む受け入れ基準(要件6)を削り、(2)詳細ページの区画の置き場所の「ヘッダーの下」を「ページ上部」(共通ヘッダーの下の広告の置き場所)に直した。2回目で問題は無かった。
- 要件定義書・サービス仕様で決まらない論点は仮1〜仮5として記録し、要件の範囲の推測は加えていない。

## 設計のレビュー(2026-10-24)

- 機械的な確認: 要件の124件の受け入れ基準の番号がすべて追跡表にあることを、番号の境界を区切った検索で確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、(1)停止の解除の作り直しの処理の説明が`continue`と`done`で食い違っていた(1回の実行で全件を処理して`done`にする形にそろえた)、(2)移行の手順にファイル構成に無いスクリプトを挙げていた(一覧は問い合わせで結合するため移行の処理を作らず、stagingの索引の欠けを運用の報告に載せる形にした)、を直した。2回目で問題は無かった。
- 境界の確認: 掲載の判定は上流の条件の部品(`visibleProducts()`・`wonLaunchExists()`・`qualifierWins()`)を結合するだけで、上流のテーブルへ書き込まない。上流の列を直接読む箇所(カテゴリの絞り込みと掲載数)は`productInCategory()`の追加としてproduct-launchへの改訂の依頼に含めた。索引の書き込みはcontent-processingの処理に任せ、本specは更新待ちの印・削除の文・要求だけを出す。区画の中身は持たず、登録口だけを持つ。
- 参照したスキル: cc-sddの`kiro-spec-requirements`・`kiro-spec-design`・`kiro-spec-tasks`の規則とテンプレート。新しいパッケージが無いため外部の調査はSQLiteの窓関数とFTS5の公式文書の確認に限った。

## タスクの計画の検証(2026-10-24)

- `/kiro-spec-tasks directory-discovery -y`の手順で、要件と設計を承認し(`-y`による自動の承認)、タスクの計画の下書きを作った。要件の124件の受け入れ基準の番号がすべてタスクにあることを機械的に確かめた。
- タスクのグラフのサニティレビューを2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
- 1回目の判定はNEEDS_FIXES(必須7件・軽微8件)だった。指摘は、(1)保留の2.2に一覧の照会の本体が依存して全体が止まる、(2)一覧の照会のタスクが大きすぎる(本体・全文検索・カテゴリに分けた)、(3)eventの束縛のモジュールの担当が無く5.2と5.3が(P)でファイルを共有していた(5.2が作り5.3が追記、5.3の(P)を外した)、(4)E2Eの補助がD1へ直接書くため確定のイベントが送られず掲載と索引が動かない(apiの`--test-scheduled`で23:40の確定のジョブを動かす形にした)、(5)6.2が大きすぎる(4つに分けた)、(6)7.4が大きすぎる(サポーターの一覧を分けた)、(7)停止の解除の作り直しの処理の記述が設計の中で食い違っていた(design.mdを「1回の実行で全件、`done`」にそろえた)。軽微の指摘(apiのDIの識別子の担当、条件の変更とページの移動のフックの担当、6.1・7.1への依存、予約の可否の照会の操作のファイル(design.mdに`product-owner-status.ts`を加えた)、基準時刻の日付の切り替わりのテスト、3.1の分割、5.2の完了状態の表現、8.2の仮4の注記)もすべて直した。
- 2回目の判定はNEEDS_FIXES(必須2件・軽微5件)だった。指摘は、(1)保留のタスク(2.2・5.4と、それに依存するタスク)が`_Blocked:_`を持たず、`kiro-impl`の自動実行で着手されてしまう、(2)カテゴリの条件が保留の間の一覧とカテゴリの選択肢の暫定の動作と、保留したテストの担当が決まっていない、の2件と、軽微5件(E2Eが保留に巻き込まれる、索引の作成の待ち条件、2.3の完了状態の表現、6.7・6.8・7.7の大きさ、5.1・5.5の4.1への依存)である。いずれもタスクの計画の中で直した(2.2・4.3・5.4・5.5に`_Blocked:_`、カテゴリを4.3に移して3.4に暫定の動作を記載、E2Eのカテゴリの確認を条件付きに、待ち条件を検索の結果に、2.3の完了状態を型検査に、6.7・6.8・7.7を分割、5.1・5.5の依存に4.1)。
- kiro-spec-tasksの規則(2回目の判定がPASSでなければ、それ以上レビューを繰り返さずに止める)に従い、3回目のレビューを行っていない。`tasks.md`は2回目の指摘を直した下書きで、タスクの承認(`approvals.tasks`)は行っていない。`/kiro-spec-tasks directory-discovery -y`を既存の`tasks.md`を引き継ぐ形で再実行し、サニティレビューがPASSになれば承認される(match-engineと同じ扱い)。

## product-launchの仮11の反映(2026-10-24、コーディネーターの指示による)

- product-launchが本specの依頼を仮11として加え、タスクも承認し直された。提供されたのは、(1)保存の登録口`PRODUCT_SAVE_HOOKS`(`apps/api/src/composition/product-save-hooks.ts`、初版は空。契約は`apps/api/src/application/product/product-save-hooks.ts`の`ProductSaveHook`と`ProductSaveHookRegistration`。登録・編集(次回の予約とローンチ日の変更を含む)・公開APIの説明文の更新で呼ばれ、復元・停止の解除では呼ばれない。`statementsFor`の文の失敗は保存ごと取り消し、`afterCommit`の例外は`warn`のログで保存を失敗させない)、(2)カテゴリの条件`productInCategory(categoryId)`(`apps/db/schema/product/visibility.ts`。これと可視・勝利済みの条件で絞った`products.id`・`products.category_id`を後続specが使ってよい)、(3)要約と受賞のまとめの規則`fallbackLaunchSummary`・`groupAwards`(`apps/backend-lib/core/product/launch-summary.ts`)である。
- 反映した内容: design.mdのModified Filesからproduct-launchのファイル(`visibility.ts`・`application/product/product-save-hooks.ts`・`d1-product-store.ts`・`product-description-editor.ts`)を外し、本specの変更を`composition/product-save-hooks.ts`への1行の追記だけにした。「上流への影響」・Allowed Dependencies・Revalidation Triggers・仮4の記述を、product-launchの仮11が提供する形に改めた。本specの`launch-summary-fallback.ts`を削り、product-launchの`launch-summary.ts`を直接読み込む形にした(ローンチ履歴と文言がずれない)。tasks.mdから上流の実装のタスク(旧2.2のカテゴリの条件・旧5.4の保存の登録口)を外し、`_Blocked:_`を全て外した。

## タスクの計画の再検証(2026-10-24、コーディネーターの指示による再実行)

- product-launchの仮11を反映したうえで、`/kiro-spec-tasks directory-discovery -y`を既存の`tasks.md`を引き継ぐ形で再実行した。上流の実装のタスク(旧2.2・旧5.4)を外し、カテゴリの絞り込みを一覧の照会の2.4へ戻して暫定の動作を無くし、保存の登録を5.4にした。新しいサブエージェントによる独立した確認(independent)を、通常の2回の上限で行った。
- 1回目の判定はPASSだった。軽微の指摘9件のうち、(1)マッチ履歴の区画の見出しの担当(7.5に加えた)、(2)開催中のマッチがあるときのbot対策のウィジェットの配置(7.8に加えた)、(3)7.5のリンクのコピーの部品への依存(`_Depends: 7.2, 7.4_`)、(4)5.2の`_Boundary:_`への登録箇所のファイルの追記、(5)新しい登録では保存の登録が文を返さないこと(5.4のテストを直した)、(6)design.mdのE2Eの補助の記述をタスクの「確定のジョブを実際の経路で動かす」方式にそろえること、(7)E2Eの補助とシナリオの分割(9.1・9.2に分け、全体の検査を9.3にした)に従って直した。残りの2件(6.6の分割、7.1の並行化)は、作業量が上限の内に収まり並行化で許可リストの再生成が競合し得るため変えていない。タスクを承認した。

## cross-spec reviewの指摘による修正(2026-10-24)

- 振る舞いを変えない整合の修正のため、改訂の番号は付けない(cross-spec reviewの指摘による)。
  - design.mdの同期の処理の登録(`USER_LIFECYCLE_SYNC_HANDLERS`・`PRODUCT_LIFECYCLE_SYNC_HANDLERS`)に、product-launch・identity-authの契約で必須の`handler`(`DIRECTORY_TYPES.AccountIndexRemovalSyncHandler`・`DIRECTORY_TYPES.ProductIndexRemovalSyncHandler`)を加えた。
  - requirements.mdの仮3の行に、sponsorshipの仮4と一体で決め、どちらかを却下すれば両方を元に戻す旨を加えた。
  - E2Eの23:40の確定のジョブの起動を、独自の起動(`--test-scheduled`の手動起動)からbackend-platformの改訂2の共有の補助`e2e/support/scheduled-trigger.ts`の`triggerScheduled`へ改めた。design.mdのAllowed Dependencies・Revalidation Triggers・Testing Strategy、tasks.mdの1.1の前提・9.1・9.2を直した。
- 変更したタスクの部分を、新しいサブエージェントによる独立した確認(kiro-spec-tasksの基準)で検証し、1回目の判定はPASSだった。タスクの承認を保つ。

## 開発者による確定(2026-10-24)

- 仮1〜仮5は、2026-10-24に開発者がいずれも推奨どおり(R)に確定した(仮1・仮2・仮5は第9回、仮3はsponsorshipの仮4と一体で第4回、仮4はproduct-launchの仮11と一体で第21回)。振る舞いの変更は無く、requirements.md・design.md・tasks.md・research.mdから確認待ちの記述を外した。本specに確認を待つ論点は残っていない。
- 他specの回答のうち本specに関わるもの: product-launchの仮5の旧ハンドルの部分は(B)(他者も旧ハンドルを設定でき、設定された時点で元の保持者の旧ハンドルを消す)に決まった。旧ハンドルの解決と302の転送はproduct-launchの`ProductDirectory.resolveHandle`の結果に従うため、他者が設定した後の旧URLは新しい保持者のプロダクトとして解決され、本specの判定(`decideProductPageAccess`)と設計・タスクの変更は要らない。product-launchの仮4(選べるローンチ日を90日後まで)・sponsorshipの仮3(広告の自動の日割り返金)などは本specの振る舞いに影響しない。
- 要件定義書の改訂の推奨(「要件定義書の改訂が必要な箇所」の表)は変わらない。
- 確定の反映の後に、新しいサブエージェントによる独立した軽いタスクのレビュー(文言の変更のみのため1回)を行い、判定はPASSだった。軽微の指摘2件(design.mdのRevalidation Triggersに残る「確認の結果」の表現)に従って直した。承認は維持した。

## frontend-platformの実装で確定した契約の反映(2026-10-28)

- frontend-platformの実装と最終検証の後、開発者の決定(frontend-platformのタスク10.4)で、設計をfrontend-platformの設計の「実装で確定した契約による発火と影響を受ける下流spec」の表に合わせた。振る舞いを変えない整合の修正のため、改訂の番号は付けない。要件は変えていない。
  - 操作の置き場所と生成物: clientの操作を`src/graphql/operations/directory/`の1ファイル1操作の`.graphql`(操作名は`Client`で始める)にし、`graphql()`を呼ばず、部品は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読むとした(design.mdのAllowed Dependencies・File Structure Plan・OwnerFollow・OwnerCard、tasks.mdの6.1・7.1)。
  - 非表示のウィジェット: `TurnstileWidget`は非表示で描くため、詳細ページに置くbot対策のウィジェットに判定の枠と場所を設けないとした(design.mdのProductPage、tasks.mdの7.8)。
