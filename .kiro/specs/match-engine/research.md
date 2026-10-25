# Research & Design Decisions

## Summary

- **Feature**: `match-engine`
- **Discovery Scope**: Complex Integration(マッチとUpvoteの実装は無い。上流の17spec(dev-tooling〜product-launch)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはproduct-launchの予定のローンチ・結果の記録の口・表示用の照会・プロダクトライフサイクルの登録口、identity-authの`users`・`AccountGuard`・ユーザーライフサイクルの登録口・`LoginRequiredDialog`、user-profile-socialの公開プロフィールのタブの登録口と`UserSummary`、backend-platformの定期実行・メッセージ・`BusinessTime`、api-gatewayのスキーマモジュールと`assertHuman`、frontend-platformのレイアウト・状態表示・Turnstileの部品・仮のトップページ、inquiry-chatの定期再取得の共通の値の上に、マッチ・Upvote・予選の日次の処理・マッチイベント・トップページ・Upvote履歴を足す)
- **Key Findings**:
  - 予選ルール(`docs/GUIDES/service/overview/003-qualifier-rules.md`)の図と例が、roadmapの論点(同一カテゴリに3つ以上ある場合)の答えを既に書いている(「各カテゴリ内でランダムに2個ずつペア」、例の余りA4・D1も無作為)。ただしbriefとroadmapが要件フェーズでの確認を求めているため、仮1として記録した(product-launchの仮1と同じ扱い)。
  - 即時の終了(FR-GAME-013)は「退会・停止・非公開化の確定と同時に」受け付けを止める必要がある。identity-auth・product-launchの同期の処理(確定と同じ一括の書き込みに入る集合の更新の文)で、Upvoteの論理削除・集計の求め直し・マッチの終了をまとめて確定できる。ただし同期の処理は行ごとの文を返せないため、確定のマッチイベントの作成と送信と、product-launchへの結果の記録(別の一括の書き込み)は、同じイベントの非同期の処理と日次の掃き出しで行う。
  - 開始時点の決着(FR-GAME-014)は、product-launchが非公開化・停止で「ローンチ日が今日より後」のローンチを取り消し、復元・解除で戻さない規則と同じ形になる。予定の間の該当を側に記録し(同期の処理)、開始の時点でもプロダクトとローンチの状態を確かめれば、ペアリングの読み取りと停止の確定が競合しても取りこぼさない。
  - データエクスポートの文書の`launches.json`の`matches[]`(`kind`・`round`・`date`・`upvoteCount`・`opponentUpvoteCount`・`lastUpvotedAt`・`result`の`won`・`lost`・`bye`・`walkover`)と`upvotes.json`の項目が、汎用のマッチの記録の形をほぼ決めている。
  - user-profile-socialの`PUBLIC_PROFILE_TABS`のコメントに`match-engine upvotes(20)`が既に予約されている。frontend-platformの`routes/index.tsx`は仮のトップページで、本specが置き換える前提である。

## 要件フェーズ前の確認事項(2026-10-23)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を「仮」として採用し、**仮1〜仮7は、2026-10-24に開発者がいずれも推奨どおりに確定した。** 決定は`requirements.md`の「要件フェーズでの決定」にも記録する。roadmapの「Requirement Ambiguities」の表の「同一カテゴリに3つ以上ある場合のペアリング方法」の行(match-engineの担当)は、仮1で決めた。roadmapは編集せず、解決の列の文言をコントローラーへ報告する。

| #   | 論点                                                   | 根拠                                                                                                                                                                     | 選択肢                                                                                                                                                                                                                                                             | 推奨と決定                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | 同一カテゴリに3つ以上ある場合のペアリング方法          | FR-GAME-001〜003(組み方の順序を定めない)、予選ルールの図(「各カテゴリ内でランダムに2個ずつペア」)と例(余りA4・D1)、briefのConstraints、roadmapのRequirement Ambiguities  | (A)カテゴリ内を無作為に並べて2つずつ組み、余りも無作為に決める / (B)ローンチの予約の順に組み、最後に予約したものを余りにする                                                                                                                                       | 推奨は(A)。2026-10-24に開発者が(A)で確定した。予選ルールの図と例に一致する。(B)は予約の時刻で相手と余りを予測・操作できる(LR-003)。余り同士のカテゴリ横断の組み方と最後の不戦勝もFR-GAME-002・003の「ランダム」に合わせて無作為にする                                                                |
| 仮2 | Upvote数が同じで最終Upvote時間もミリ秒まで一致する場合 | FR-GAME-011(最終Upvote時間が早い方)、要件定義書1.3(最終Upvote時間の定義)                                                                                                 | (A)先に記録されたUpvoteの側を早いとみなす / (B)両者敗北にする / (C)両者勝利にする                                                                                                                                                                                  | 推奨は(A)。2026-10-24に開発者が(A)で確定した。記録はD1で直列に確定するため、記録の順はUpvoteが受け付けられた順そのものであり、「先に到達した」勝者判定(予選ルール)の意図に合う。(B)・(C)は1以上の同数を勝敗で区別するFR-GAME-011の趣旨に反する                                                       |
| 仮3 | 停止の解除と、停止で論理削除したUpvote                 | FR-VOTE-008(停止で即時に論理削除)、FR-ADMUG-004(停止解除)、要件定義書1.3(停止されたユーザーのUpvoteを除く)、再ローンチ規則(停止で取り消した予約を解除で戻さない)         | (A)戻さない。マッチ中なら解除後に改めてUpvoteできる / (B)解除で元に戻す / (C)戻さず、同じマッチでは再びUpvoteできない                                                                                                                                              | 推奨は(A)。2026-10-24に開発者が(A)で確定した。確定の後の結果を変えず、解除までの間に相手の勝敗が動く不公平を生まない。取り消し(FR-VOTE-004)の後と同じく、有効なUpvoteが無い利用者として扱える。(C)は「1マッチ1Upvote」の数え方に論理削除済みを含める特別な規則が要る                                 |
| 仮4 | マッチ直前に両方の側が退会・停止・非公開化された場合   | FR-GAME-014(対戦相手をマッチ開始時点で勝者)、予選ルールの「両者敗北」、データエクスポートの`result`(`won`・`lost`・`bye`・`walkover`)                                    | (A)両者敗北として開始時点で終える / (B)マッチを無かったことにし、結果を記録しない                                                                                                                                                                                  | 推奨は(A)。2026-10-24に開発者が(A)で確定した。どちらの側も勝者の条件を満たさず、両者敗北の扱い(ディレクトリ非掲載・再ローンチは敗北扱い)と一致する。(B)ではproduct-launchのローンチがマッチ中のまま固定される(取消でないローンチがある場合)                                                          |
| 仮5 | 同じ投稿者のプロダクト同士のペアリング                 | FR-GAME-001〜003(投稿者の条件が無い)、FR-VOTE-003(自分のプロダクトと対戦相手にUpvoteできない)、LR-003                                                                    | (A)避けない / (B)同じ投稿者のプロダクト同士を可能な限り組まない                                                                                                                                                                                                    | 推奨は(A)。2026-10-24に開発者が(A)で確定した。要件の手順に無い条件を足すと組み合わせが予測しやすくなり、カテゴリの優先(FR-GAME-001)と衝突する場合の規則も要る。同じ投稿者でも投稿者自身はどちらにもUpvoteできず、勝敗は他の利用者のUpvoteで決まる                                                    |
| 仮6 | Upvoteの取り消しのbot対策                              | FR-VOTE-006(「Upvote操作時」)、FR-VOTE-004(「Upvote取り消し機能」)、SW-018、LR-003                                                                                       | (A)取り消し・付け替えでも検証する / (B)Upvoteの追加だけで検証する                                                                                                                                                                                                  | 推奨は(A)。2026-10-24に開発者が(A)で確定した。取り消しもUpvote機能の操作で、自動化した取り消しと再Upvoteの繰り返しで最終Upvote時間を操作できる。トークンは操作ごとに取り直す                                                                                                                         |
| 仮7 | トーナメントの不戦勝の一覧の説明文                     | tournament-weekの設計の「上流への影響」(match-engineへの改訂の依頼)、ページ配置のマッチカード(不戦勝の一覧はトーナメントでも同じ表示)、要件9.5(部品をトーナメントと共有) | (A)`match.kind`で切り替え、トーナメントは「対戦相手不在のため不戦勝。次のラウンドへ進みます。」・「対戦相手が不在になったためマッチ終了。{n}票のUpvoteで確定し、次のラウンドへ進みます。」 / (B)予選の文言をそのまま使う / (C)トーナメントの区画が自分の部品で描く | 推奨は(A)(tournament-weekの依頼による)。2026-10-24に開発者が(A)で確定した。トーナメントの勝者はディレクトリへの掲載ではなく次のラウンドへの進出になるため、(B)は事実と異なる。(C)は部品の共有(要件9.5)に反し、見た目が分かれる。早期の勝利は`MatchBye.reason`の`EARLY`(`match.endedEarly`)で見分ける |

### 確認済みのため質問しない事項

- ペアリングの対象: 翌日をローンチ日とし、取消でなく結果が未確定で、プロダクトが可視のローンチ(product-launchの`ScheduledLaunchDirectory.listForDate`の定義どおり)。23:40以降は翌日を選べない(FR-PRDCT-002)ため、23:45の時点で翌日のローンチは増えない。
- マッチの時刻: 予選はローンチ日の0:00開始・23:40終了(FR-GAME-008)。トーナメントも0:00・23:40(FR-TOURW-007・FR-TOURY-008)だが、本specのマッチの記録は開始と終了の日時を行ごとに持ち、作る側が値を渡す。
- 最終Upvote時間: マッチ開始からの経過時間(要件定義書1.3)。同じマッチの両側の開始は同じため、Upvoteの日時で比べても結果は同じになる。データエクスポートの`lastUpvotedAt`は日時である。
- 付け替え: モックアップ(`match-stage.tsx`の「1ユーザー1マッチ1Upvoteのため、反対側へのUpvoteは付け替えになる」)のとおり、反対側を押すと以前のUpvoteを取り消して新しい側に記録する。FR-VOTE-002・004の範囲内の操作である。
- Upvoteのボタン: FR-GAME-006は「ログインユーザー以外によるプロダクトであればUpvoteボタン」を表示するとし、モックアップは自分のプロダクトの側にも無効のボタンを出している。要件を正とし、自分のプロダクトの側はUpvote数だけを表示し、対戦相手の側は無効のボタンと理由を出す(ページ配置「無効化時は理由を示す」)。
- 予選の区画の0件: ページ配置は「該当マッチが無いセクションは非表示」、モックアップは予選の区画に「本日のマッチはありません。ローンチを予約しましょう。」を出す。roadmapの規則(既存のモックアップがある画面はそれを正とする)により、予選の区画だけはモックアップの空の状態を出し、他の区画(トーナメント)は非表示にする。ページ配置に注記する。
- 23:40から24:00の表示: モックアップの「勝敗結果表示(23時過ぎ)」と演出文言のとおり、当日の結果と翌日のキックオフの時刻を出す。
- 停止で論理削除するUpvote: マッチ中のマッチへのものだけ(FR-VOTE-008)。退会では全てのUpvoteを論理削除する(FR-USER-018)。確定したマッチの値は変えない(FR-GAME-009)。
- 即時の終了の値: 「Upvote受付を停止してマッチを終了」(FR-GAME-013)・「マッチが終了した時点でUpvote数の確定値及び最終Upvote時間を保持」(FR-GAME-009)。早期勝利のプロダクトは「不戦勝」の一覧に確定時のUpvote数を添える(ページ配置)。
- マッチ記録の物理削除: 行は残し、プロダクト側の識別情報の紐付けだけを解除する(FR-PRDCT-015・DR-002)。product-launchの申し送りどおり、プロダクトの`purge_due`の処理(1100番台)で行う。
- 波及処理とジョブの`order`: 本specの1100番台(roadmapの帯の割り当て)。23:40の確定はpaymentsの突合(`order` 10)の後に動く(paymentsのRevalidation Triggers)。上流の値より前に動く必要のある処理は無い。
- 新しいパッケージ: 無い。演出はCSSのアニメーション、通知はfrontend-platformの`notify`(sonner)、アイコンは`lucide-react`、Turnstileは`TurnstileWidget`を使う。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(product-launchと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(プロダクトライフサイクルイベント・ユーザーライフサイクルイベント・可視性フィルタ・マッチとブラケット・通知イベント契約・Cron・Queuesのディスパッチ・画面シェル・データエクスポートの出力)。
- **Sources Consulted**: product-launch・identity-auth・user-profile-social・backend-platform・api-gateway・frontend-platform・inquiry-chat・payments・media-pipelineの`design.md`、product-launchの`research.md`の後続specへの申し送り、notifications・tournament-week・tournament-year・directory-discovery・ugc-moderation・sponsorship・data-export・public-apiのbrief。
- **Findings**:
  - product-launch: `ScheduledLaunchDirectory.listForDate({ launchDate, after, limit 1〜500 })`(`launchId`・`productId`・`ownerUserId`・`categoryId`、ローンチのIDの昇順)、`LaunchOutcomeRecorder.record(entries 1〜200)`(`recorded`・`already-recorded`・`conflict`・`not-recordable`。不戦勝・相手の退会等による勝利は`won`、両者敗北は`lost`として記録するのはmatch-engineの責任)、`ProductDirectory.findSummaries(ids, 'visible'|'not-deleted')`(`visible`・`listed`・`ownerUserId`・カテゴリ・ロゴのID)・`listLaunches(ids, now)`(状態`canceled`を含む)、`visibleProducts()`(`users`との結合が前提)、`PRODUCT_LIFECYCLE_SYNC_HANDLERS`(`deleted`・`hidden`・`unhidden`、プロダクトIDを条件にした集合の更新の文)・`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`(`purge_due`を含む、`order`はroadmapの帯)、`ProductLifecycleEvent`(`productId`・`ownerUserId`)、ProductCategoryのGraphQLの型。非公開化・停止は`launch_date > 今日`のローンチを取り消し、今日(マッチ中)のローンチは取り消さない(match-engineがマッチを終了して結果を記録する)。後続specは`products`などを直接読まず、問い合わせで結合してよいのは`visibleProducts()`・`wonLaunchExists()`の絞り込みだけである。
  - identity-auth: `UserLifecycleSyncHandler.statementsFor(event, db)`(読み取りはしてよいが書き込みは返す文だけ、利用者IDを条件にした集合の更新で行ごとの文を返さない)、`USER_LIFECYCLE_SYNC_HANDLERS`(`withdrawn`・`suspended`・`unsuspended`)、`UserLifecycleAsyncRegistration`(`order`、0〜9999は各ドメイン)、`LifecycleHandlerOutcome`(`done`・`continue`)、`assertLifecycleHandlerName`、`USER_LIFECYCLE_RETRY_POLICY`、`LIFECYCLE_CONTINUE_DELAY_SECONDS`、`visibleUsers()`・`verifiedUsers()`、`AccountGuard`(`currentUser`・`requireVerifiedUser`)、`LoginRequiredDialog`(`returnTo`)、`/auth/login?redirect=`。`purge_due`の全波及処理の後に`users`が消えるため、`users`へ外部キーを張る行はそれより前に消す。
  - user-profile-social: `PUBLIC_PROFILE_TABS`(`{ id, label, order, Count?, Panel }`、`PublicProfileSectionContext`は`handle`・`nickname`・`isOwner`・`suspended`、コメントに`match-engine upvotes(20)`)、`UserProfileDirectory.findSummaries(ids, 'visible')`、GraphQLの`UserSummary`と`userSummaryLoader`(可視でなければnull)。
  - backend-platform: `ScheduledJobDefinition`(`at`・`order`、同じ時刻での`order`の重複を拒否)、`toUtcCronExpression`(0:00→`0 8 * * *`、23:40→`40 7 * * *`、23:45→`45 7 * * *`)、apiの`triggers.crons`と`SCHEDULED_JOBS`の一致の検査、`MessagePublisher.publish`(1件ずつ)、`MessageHandlingResult`の`defer`、`BusinessTime`、共通カラム、`Clock`・`IdGenerator`。
  - api-gateway: `defineSchemaModule`・`GraphQLContext`(`assertHuman(action)`・`caller`・`session`・`loaders`)・`withValidatedArgs`・`CURSOR_PAGE_ARGS`・`defineLoader`(既定50件)。ルート型以外の型を複数のモジュールで定義できないため、トーナメントが`Match`を返すには本specの型と組み立ての部品を参照させる。
  - frontend-platform・inquiry-chat: `routes/index.tsx`は仮のトップページ(本specが置き換える)、`useTurnstileToken`(`consume()`で使用済みにして再実行)、`notify`、`ErrorState`・`EmptyState`・`LoadingSkeleton`・`PartialErrorState`、`buildPageHead`、日時の表示部品、`LIVE_REFRESH_QUERY_OPTIONS`(30秒・非表示のタブで止める)。デザイントークン(`tokens.css`)はモックアップの`styles.css`から移植される。
  - payments: 23:40の`payments.checkout-reconciliation`(`order` 10)。本specの23:40のジョブは`order`を10より大きくする。
  - 下流のbrief: notificationsは通知イベントの契約を自分で持ち、match-engineのイベントを購読する。tournament-weekはブラケットを持ち、マッチと投票の仕組みをmatch-engineに頼る。directory-discoveryは索引の更新をマッチのイベントの処理として作り、ソートの「Upvote数」と期間の絞り込みにマッチの値を使う。ugc-moderationは統計(予選実施数・Upvote数)とプロダクトのマッチ結果を表示する。data-exportは各ドメインの出力用の部品を呼ぶ。sponsorshipはトップページに広告の区画を置く。
- **Implications**: 上流のファイルの変更は、契約で定められた登録箇所への追記(ライフサイクルの同期・非同期の登録口・公開プロフィールのタブ・定期実行・メッセージ・apiのCronの式)と、仮のトップページの置き換えだけである。上流specの文書の変更は要らない。

### マッチの時刻と状態

- **Context**: FR-GAME-004・008・009・013・014、FR-VOTE-005、日次タイムライン(23:40の確定・23:45のペアリング・0:00の開始、確定の後にペアリング)。
- **Sources Consulted**: 日次タイムライン、予選ルール、トップページのモックアップ(`phase`の`live`・`result`)、backend-platformの`createScheduledDispatcher`(ジョブごとに失敗を閉じ込めて次へ進む)。
- **Findings**:
  - マッチの状態は「開始の記録→結果の確定の記録→終了の日時」の順で導ける(予定・マッチ中・集計中・終了)。Upvoteを受け付けるのは開始が記録され、結果が未確定で、終了の日時より前のときだけで、記録の一括の書き込みの`CASE`式に同じ条件を入れれば、23:40をまたぐ要求でも受け付けない。
  - 開始を記録の時刻(0:00のジョブ)で始めると、不戦勝と開始時点の決着を同じ処理で確定できる。ジョブが遅れると受け付けの開始も遅れるが、受け付けの終了より前に確定することは無い(安全側)。
  - ジョブの失敗は次のジョブで回復させる。23:45のペアリングは先に未確定のマッチを確定し(確定の後にペアリングする順序の要件も満たす)、0:00の開始は先に当日のペアリングの完了を確かめる。
- **Implications**: 純粋な規則(`deriveMatchPhase`・`decideAtKickoff`・`decideAtFullTime`・`pairQualifiers`)を`backend-lib/core/match`に置き、時刻は`BusinessTime`で求める。

### 集計値の維持と同時の操作

- **Context**: FR-VOTE-002・004・007・008、FR-GAME-009〜012、NFR-PERF-003(GraphQLの95パーセンタイル300ms)、D1の制約(`db.batch()`・バインド変数100個)。
- **Sources Consulted**: `docs/GUIDES/tech/db/002-d1-constraints.md`、product-launch・user-profile-socialの`CASE`式によるNOT NULL制約の違反で一括の書き込みを取り消す方式、identity-authの同期の波及処理の規約。
- **Findings**:
  - トップページは全マッチの両側のUpvote数を毎回(30秒ごとの取り直しを含む)読む。Upvoteの行を毎回数えると読み取りがUpvoteの数に比例するため、側の行にUpvote数・最終Upvote時間(と記録の順)を持ち、Upvoteの追加・取り消し・論理削除と同じ一括の書き込みで、その側の有効なUpvoteから求め直す文を入れる。
  - 「1人1マッチ1票」は、Upvoteの行の部分一意索引(`match_id`・`user_id`、論理削除されていないもの)で同時の2つの要求でも守れる。付け替えは「以前のUpvoteの削除→新しいUpvoteの挿入(`CASE`式の条件)→両側の求め直し」を1つの一括の書き込みにする。
  - 求め直しの文を「結果が未確定のマッチ」に限れば、確定の後の退会でUpvoteを論理削除しても確定値は変わらない(FR-GAME-009)。
  - 最終Upvote時間が一致したときの決着(仮2)は、Upvoteの行に記録の順(マッチ内で`MAX(seq) + 1`、D1が直列に確定するため重ならない)を持てば判定できる。
- **Implications**: 集計の文の部品(`tallyRecomputeStatement`)を、Upvote・同期の処理の両方から使う。

### 即時の終了と開始時点の決着

- **Context**: FR-GAME-013・014、FR-VOTE-008、FR-ADMUG-008、identity-auth・product-launchの同期の処理の規約(集合の更新の文だけ、行ごとの文を返さない)。
- **Findings**:
  - 退会・停止の確定と同じ一括の書き込みに、(1)Upvoteの論理削除、(2)該当する側の求め直し、(3)マッチ中のマッチの側の結果(該当した投稿者の側は敗北、他は相手の退会等による勝利、両方が同じ投稿者なら両方敗北)、(4)マッチの結果の確定、(5)予定のマッチの側への該当の記録、を利用者IDを条件にした集合の更新として入れられる。プロダクトの非公開化・削除も同じ形をプロダクトIDで行う。
  - 確定のマッチイベントの挿入はマッチごとのIDが要り、集合の更新で作れない。同じライフサイクルのイベントの非同期の処理(本specの1100)と、日次の各ジョブの掃き出し(確定済みで確定のイベントが無いマッチ)で作って送る。結果の記録は確定のイベントの処理で行うため、即時の終了から数分以内に記録される。
- **Implications**: 同期の処理2つ(ユーザー・プロダクト)と非同期の後続の処理2つを登録し、文の組み立てを`match-closure-statements.ts`に共通化する。

### 予選のペアリングと無作為

- **Context**: FR-GAME-001〜004、仮1・仮5、LR-003、briefのConstraints(D1のバインド変数とCPU時間)。
- **Findings**:
  - 1日のローンチ数は多くても数千で、無作為の並べ替えと組み合わせはCPU時間をほとんど使わない。重いのは書き込みで、マッチ・側・イベントの挿入を50マッチずつの一括の書き込みに分ければ、1文あたりのバインド変数を100個以内に保てる。
  - 無作為は`crypto.getRandomValues`による偏りの無い整数(棄却法)とFisher–Yatesのシャッフルで作る。`Math.random`は予測可能で使わない。テストでは決まった値を返す`RandomSource`を差し込む。
  - 再実行の重複は、予選の側の`launch_id`の部分一意索引と、日ごとのペアリングの記録(`qualifier_pairings`)で防ぐ。再実行では既に組まれたローンチを除いて残りを組む。
- **Implications**: `pairQualifiers(launches, random)`を純粋な関数にし、予選ルールの例をそのまま単体テストにする。

### トップページの構成

- **Context**: FR-GAME-005〜007、ページ配置(トップページ・マッチカード・不戦勝・早期勝利・外部リンクの`rel`)、モックアップ(`index.tsx`・`qualifier-section.tsx`・`full-time-countdown.tsx`・`hero.tsx`・`bye-card.tsx`・`empty-lineup.tsx`・`match/*`・`stadium-pitch/*`)、FR-TOURW-008・009、FR-SPONS-006。
- **Findings**:
  - モックアップは、上部のグリッド(カウントダウンとLegend)・未ログインの案内・決勝の全幅の展示・本文(トーナメントの区画と予選の区画)とGoldの横の列・Silverの列・フッターの順で、予選の一覧の途中にモバイルのGoldを2件ごとに差し込む。
  - トーナメントの区画・決勝の展示・広告は後続specが持つため、置き場所(`banner`・`showcase`・`main`・`aside`・`bottom`)と`order`で区画を登録する口と、予選の一覧の差し込みの口を本specが持つ。対戦カード・不戦勝の一覧・Upvoteの操作の部品はトーナメントが同じものを使う。
  - チームの色(ピッチと比率のバー)はモックアップではプロダクトの架空の配色から作っている。実装ではプロダクトのIDから決まった配色の一覧の1つを選ぶ(画像の解析をしない)。
- **Implications**: `TOP_PAGE_SECTIONS`・`QUALIFIER_LIST_INSERTS`の登録口と、client の`components/match`の部品群を作る。

## Architecture Pattern Evaluation

| Option                                   | Description                                                                         | Strengths                                                          | Risks / Limitations                                                                                          | Notes           |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------- |
| 汎用のマッチと側の2テーブル+Upvote(採用) | `matches`・`match_entries`・`match_upvotes`。種別・ラウンドを列に持ち、予選も同じ行 | 予選・トーナメントで集計と確定を共有、データエクスポートの形に一致 | 種別ごとの違い(開始時点の判定のローンチの取消)を分岐で持つ                                                   | briefのApproach |
| 予選とトーナメントで別のテーブル         | 予選のマッチと、トーナメントのマッチを別に持つ                                      | 種別の分岐が無い                                                   | 集計・確定・即時の終了・Upvote履歴の照会が2重になる                                                          | 不採用          |
| Upvoteの行を毎回数える                   | 側の集計値を持たず、表示のたびに数える                                              | 書き込みが単純                                                     | トップページの読み取りがUpvoteの総数に比例する。確定値の凍結に別の列が要る                                   | 不採用          |
| 即時の終了を非同期の処理だけで行う       | 同期の処理を使わず、イベントの実行器で終了する                                      | 行ごとの文を作れる                                                 | 確定から実行までの間(数秒〜再試行の間隔)もUpvoteを受け付け、「同時に」(FR-GAME-013・FR-VOTE-008)を満たさない | 不採用          |
| マッチイベントを日単位の知らせにする     | 「当日の予選を開始した」などの日単位の1件                                           | 件数が少ない                                                       | 即時の終了・トーナメントのマッチが日単位にならず、2種類の形が要る                                            | 不採用          |

## Design Decisions

### Decision: 側の行に集計値を持ち、同じ一括の書き込みで求め直す

- **Context**: 要件1.2・4.1・6.1〜6.4・6.8・7.1〜7.3、NFR-PERF-003。
- **Alternatives Considered**:
  1. 表示のたびにUpvoteの行を数える
  2. 側の行に`upvote_count`・`last_upvoted_at`・`last_upvote_seq`を持ち、変更と同じ一括の書き込みで有効なUpvoteから求め直す
- **Selected Approach**: 2。求め直しの文は「結果が未確定のマッチの側」に限り、確定の後は確定値として変えない。加算・減算ではなく求め直しにして、論理削除・同時の操作でも記録と食い違わない。
- **Rationale**: トップページの読み取りがマッチの数だけに比例し、確定の処理は側の行を読むだけで済む。
- **Trade-offs**: Upvote1件ごとに側の有効なUpvoteを数える(索引の範囲の読み取り)。1つの側で数千件までを想定する。

### Decision: Upvoteの条件を一括の書き込みの`CASE`式で確かめる

- **Context**: 要件6.5〜6.9、product-launchの保存と同じ方式。
- **Selected Approach**: Upvoteの挿入の`entry_id`を`CASE WHEN <条件> THEN ? ELSE NULL END`にし、条件(マッチの開始が記録され結果が未確定で終了の日時より前・側がそのマッチのもの・利用者がどの側の投稿者でもない・利用者が`verifiedUsers()`)を満たさなければNOT NULL制約の違反で全体を取り消す。失敗の分類は読み直しで行う。部分一意索引の違反は「既に同じ側にUpvote済み」として現在の状態を返す。
- **Rationale**: 読み取りから書き込みまでの間に23:40・即時の終了・停止が起きても、条件を破る記録が確定しない。

### Decision: 即時の終了は同期の処理、イベントと結果の記録は非同期の処理と掃き出し

- **Context**: 要件5、identity-auth・product-launchの同期の処理の規約。
- **Selected Approach**: ユーザーの`withdrawn`・`suspended`に`match-engine.account-match-closure`、プロダクトの`hidden`・`deleted`に`match-engine.product-match-closure`を同期の処理として登録し、集合の更新の文だけを返す。同じイベントの非同期の処理`match-engine.account-decision-follow-up`・`match-engine.product-decision-follow-up`(1100)と、23:40・23:45・0:00・4:21のジョブが、確定済みで確定のイベントが無いマッチにイベントを作って送る。
- **Rationale**: 受け付けの停止は確定と同時、イベントの作成は行ごとのIDで行える。非同期の処理は再試行され、掃き出しは送信の失敗も拾う。
- **Trade-offs**: 確定のイベントの作成が数秒遅れる。結果の記録も同じだけ遅れる(要件5.5の数分以内に収まる)。

### Decision: マッチイベントをプロダクトライフサイクルと同じ形にする

- **Context**: 要件11、product-launchの`backend/012-aggregate-lifecycle-events.md`(集約のライフサイクルイベントの規約)、notificationsのbrief(通知イベントの契約はnotificationsが持ち、match-engineのイベントを購読する)。
- **Selected Approach**: `match_events`(`scheduled`・`started`・`decided`、マッチと種類で一意)・`match_event_handler_runs`、eventの`MatchEventRunner`(メッセージ`match.run-match-event`)、登録口`MATCH_EVENT_HANDLERS`(`createMatchEventRegistry`で名前と`order`を検証、`order`はroadmapの帯)、4:21の送り直しと30日を過ぎた完了済みの記録の削除。本specの処理は`match-engine.qualifier-outcome`(`decided`、1100)だけ。
- **Rationale**: 後続specが同じ考え方で3つのライフサイクルとマッチイベントを扱える。通知・トーナメント・ディレクトリはマッチごとの処理として登録する。
- **Trade-offs**: 処理の登録が無い`scheduled`・`started`も記録と送信が要る(1日にマッチ数×3件)。30日で削除して量を抑える。

### Decision: 開始時点の決着は予定の間の記録と開始の時点の状態の両方で判定する

- **Context**: 要件3.3〜3.6、FR-ADMUG-008、product-launchの取消の規則。
- **Selected Approach**: 予定の間の退会・停止・非公開化・削除は、同期の処理で側の`forfeited_at`を記録する。0:00の開始のジョブは`forfeited_at`に加えて`ProductDirectory.findSummaries`(可視でない)と、予選なら`listLaunches`(取消)で該当を判定する。
- **Rationale**: 23:45のペアリングの読み取りの直後に停止が確定しても、開始の時点で取りこぼさない。復元・解除で戻さない規則(要件3.5)は`forfeited_at`と取消が戻らないことで満たす。

### Decision: トップページの区画を置き場所と順で登録する

- **Context**: 要件9、roadmapの画面シェル(トップページはmatch-engineが所有し他specが区画を追加)。
- **Selected Approach**: `TOP_PAGE_SECTIONS`(`placement`: `banner`・`showcase`・`main`・`aside`・`bottom`、`order`、`component`)と`QUALIFIER_LIST_INSERTS`(`every`件ごと、`component`は表示幅の判定を自分で持つ)。本specは`main`に予選の区画(`order` 30)を、`banner`にカウントダウン(`order` 10)を登録し、Year 10・Week 20を`main`に空けておく。
- **Rationale**: 後続specは本specのファイルを書き換えずに1行の登録で区画を加えられる(inquiry-chatの`CATEGORY_SECTIONS`と同じ形)。

### Decision: 採らなかった案

- 予選の結果をmatch-engineだけが持つ: product-launchの設計で、結果の写しをローンチに記録する方式に決まっている。
- Upvoteの時刻の表示: ページ配置により公開しない(生活時間帯の推測を避ける)。
- 開催中のマッチのリアルタイムの配信(WebSocket・Durable Objects): 30秒ごとの取り直しで要件を満たし、新しい資源が要らない。
- Upvoteの利用者単位のレート制限: 要件に無く、Turnstileと1マッチ1票で抑えられる。FR-RLMIT-008のIP単位の制限は全Workerに掛かる。

## Synthesis

- **Generalization**: 予選とトーナメントのマッチを、種別・ラウンド・開始と終了の日時を持つ1つの記録と、種別によらない開始・集計・確定・即時の終了の規則に一般化した。退会・停止・非公開化・削除を「側が該当した」という1つの事実(マッチ中なら即時の終了、予定なら開始時点の決着)に一般化した。マッチの通知を、プロダクトライフサイクルと同じ集約のイベントの形に一般化した。
- **Build vs Adopt**: 業務時刻・定期実行・メッセージ(backend-platform)、スキーマモジュールと`assertHuman`(api-gateway)、ライフサイクルの登録口と型(identity-auth・product-launch)、予定のローンチ・結果の記録・表示用の照会(product-launch)、利用者の表示(user-profile-social)、Turnstile・状態表示・`notify`・`LoginRequiredDialog`・定期再取得の値(frontend-platform・identity-auth・inquiry-chat)を使う。マッチ・Upvote・ペアリング・マッチイベント・トップページは既存の部品が無いため作る。無作為は標準の`crypto.getRandomValues`を使う。新しいパッケージは無い。
- **Simplification**: マッチの状態の列・Upvoteの時刻の公開・リアルタイムの配信・利用者単位のレート制限・トップページの日付の切り替えの操作を持たない。予選の日次の処理は3つのジョブに収め、失敗の回復は次のジョブの先頭で行う。

## Risks & Mitigations

- 23:40の確定・23:45のペアリング・0:00の開始のジョブが失敗すると、ローンチがマッチ中のまま固定され、当日のマッチが始まらない — 次のジョブの先頭で回復し(要件2.8・3.7・4.9)、Sentryへ`match-settlement-late`・`qualifier-pairing-late`を報告する。4:21の`match-engine.event-redispatch`が、終了の日時から1時間を過ぎて未確定のマッチを`match-settlement-overdue`として報告する。
- マッチイベントの処理(結果の記録)が失敗し続けると、ローンチがマッチ中のまま固定される — `MATCH_EVENT_RETRY_POLICY`(5回・300秒から倍・上限3600秒)の上限でデッドレターとSentryに通知され、4:21に滞ったイベントを送り直す。
- 人気のマッチに同時のUpvoteが集中すると、D1の書き込みが直列になり応答が遅れる — 1回のUpvoteは3〜4文の一括の書き込みで、側の有効なUpvoteの数え直しは索引の範囲の読み取りに限る。NFR-PERF-002(同時接続100人)の範囲を想定し、launch-readinessの性能の検証で確かめる。
- 1日のローンチ数が多いと、ペアリングのジョブの書き込みが長くなる — 50マッチずつの一括の書き込みで、途中の失敗は再実行で残りだけを組む(要件2.7)。
- 同期の処理の文が増えると退会・停止・非公開化の確定が重くなる — 文は集合の更新の5つまでで、対象は利用者・プロダクトの索引で絞る。
- 技術ドキュメントの番号の重なり — roadmapの順で前のproduct-launchが`backend/012`・`backend/013`・`frontend/012`を使うため、本specは`backend/014`・`frontend/013`にした(全完了specのdesign.mdで確かめた)。

## References

- `docs/GUIDES/service/overview/003-qualifier-rules.md` — ペアリングの図と例、判定の例
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 23:40・23:45・0:00・4:21と処理の順
- `docs/GUIDES/service/design/002-page-layouts.md` — トップページ・マッチカード・不戦勝・早期勝利・外部リンクの`rel`・Upvote履歴
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — Upvote不可の文言・演出文言・Upvote履歴の文言・表記規則(不戦勝・両者敗北・スコア)
- `docs/GUIDES/service/features/001-user-data-export.md` — `launches.json`の`matches[]`・`upvotes.json`
- `mockups/src/routes/client/top`・`mockups/src/components/client/match`・`mockups/src/components/client/stadium-pitch` — トップページと対戦カードのモックアップ
- [MDN: Crypto.getRandomValues()](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues) — 予測できない乱数(Workersで利用可能)

## 確定した決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。要件定義書と上流specに最も整合する案で要件・設計・タスクを作り、**2026-10-24に開発者がいずれも推奨どおりに確定した。** `requirements.md`の「要件フェーズでの決定」にも同じ行がある。

| #   | 論点                                  | 確定した案                                                                                | 他の選択肢                                  | 影響する箇所                                   |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| 仮1 | 同一カテゴリに3つ以上ある場合の組み方 | カテゴリ内を無作為に並べて2つずつ。余り・横断の組み・最後の不戦勝も無作為                 | 予約の順                                    | 要件2.2・2.3、`pairQualifiers`、予選ルール     |
| 仮2 | 最終Upvote時間の一致                  | 先に記録されたUpvoteの側を勝利                                                            | 両者敗北 / 両者勝利                         | 要件4.4、`decideAtFullTime`・`seq`、予選ルール |
| 仮3 | 停止の解除とUpvote                    | 戻さない。マッチ中なら改めてUpvoteできる                                                  | 戻す / 同じマッチでは再びUpvoteできない     | 要件7.4、部分一意索引                          |
| 仮4 | マッチ直前の両方の該当                | 両者敗北                                                                                  | 結果を記録しない                            | 要件3.4・5.3、`decideAtKickoff`、予選ルール    |
| 仮5 | 同じ投稿者のプロダクト同士            | 避けない                                                                                  | 可能な限り組まない                          | 要件2.5、`pairQualifiers`、予選ルール          |
| 仮6 | 取り消しのbot対策                     | 取り消し・付け替えでも検証する                                                            | 追加だけ                                    | 要件6.4、`UpvoteService`・`useUpvote`          |
| 仮7 | トーナメントの不戦勝の説明文          | `match.kind`で切り替え、トーナメントは「次のラウンドへ進みます。」(tournament-weekの依頼) | 予選の文言のまま / トーナメントの区画が描く | 要件9.7、`ByeCard`、文言規則、タスク1.2・8.6   |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID      | 内容                                                                           | 根拠 |
| ----------- | ------------------------------------------------------------------------------ | ---- |
| FR-GAME-001 | 同カテゴリ内の組み合わせを無作為に行う旨を加える                               | 仮1  |
| FR-GAME-011 | 最終Upvote時間も一致した場合は、先に記録されたUpvoteの側を勝者とする旨を加える | 仮2  |
| FR-VOTE-008 | 停止を解除しても論理削除したUpvoteを戻さない旨を加える                         | 仮3  |
| FR-GAME-014 | 両方のプロダクトが該当した場合は両者敗北とする旨を加える                       | 仮4  |
| FR-VOTE-006 | 取り消し(付け替えを含む)も検証の対象とする旨を明記する                         | 仮6  |

## 上流・後続specへの影響

- identity-auth(上流): 登録箇所への追記だけ。`USER_LIFECYCLE_SYNC_HANDLERS`に`match-engine.account-match-closure`(`withdrawn`・`suspended`)、`USER_LIFECYCLE_ASYNC_HANDLERS`に`match-engine.account-decision-follow-up`(`withdrawn`・`suspended`、1100)・`match-engine.upvote-erasure`(`purge_due`、1100)。`LoginRequiredDialog`を使う。
- product-launch(上流): 登録箇所への追記だけ。`PRODUCT_LIFECYCLE_SYNC_HANDLERS`に`match-engine.product-match-closure`(`hidden`・`deleted`)、`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`に`match-engine.product-decision-follow-up`(`hidden`・`deleted`、1100)・`match-engine.entry-unlink`(`purge_due`、1100)。`ScheduledLaunchDirectory`・`LaunchOutcomeRecorder`・`ProductDirectory`・`visibleProducts()`を契約どおりに使う。
- user-profile-social(上流): `PUBLIC_PROFILE_TABS`に`upvotes`(20)を足す(予約どおり)。
- frontend-platform(上流): 仮のトップページ`apps/client/src/routes/index.tsx`を置き換える(契約どおり)。
- backend-platform(上流): `SCHEDULED_JOBS`に5つのジョブ、apiの`triggers.crons`に0:00・23:45(23:40・4:21は上流で追加済み)、`MESSAGE_CONTRACTS`・`MESSAGE_HANDLERS`に`match.run-match-event`(契約どおり)。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は1100・1110、波及処理は1100」になる(23:40・23:45・0:00のジョブとプロダクトライフサイクル・マッチイベントの処理も1100)。Requirement Ambiguitiesの「同一カテゴリに3つ以上ある場合のペアリング方法」の行の解決の列は「match-engine 仮1(…、2026-10-24に開発者が確定)」。本specはroadmapを編集しないため、コントローラーへ報告する。
- directory-discovery(後続): `MatchDirectory.listByLaunches`(マッチ履歴・接戦の判定は`decision`の`last_upvote`)・`SupporterDirectory.listSupporters`(FR-DIR-004・011)・`qualifierWins()`(並べ替えと期間の絞り込み)・確定のマッチイベント(掲載に伴う索引の更新、`order` 1200番台)を使う。プロダクト詳細の開催中のマッチは、本specの`MatchCard`・`useUpvote`と`matchViewLoader`を使う。
- notifications(後続): 確定・開始・予定のマッチイベントの処理(1300番台)と`MatchDirectory.findMatches`で、開始予告・結果・開催通知を作る。23:45に予選の開始予告を送る場合も、`scheduled`のイベントの処理として登録すれば、トーナメントの組み合わせ(23:45、1500番台)の後でも同じ経路で届く。
- tournament-week・tournament-year(後続): `MatchScheduler.schedule`(種別`week`・`year`、ラウンドの番号と段階、開始と終了の日時、1つまたは2つの側)でマッチを作り、`decided`のイベントの処理(1500・1700番台)でラウンドを進める。シードの並びは`MatchDirectory.findQualifierResults`を使う。トップページの区画は`TOP_PAGE_SECTIONS`の`main`(Year 10・Week 20)と`showcase`(決勝)に登録し、`MatchCard`・`ByeList`・`matchViewLoader`を使う。即時の終了・開始時点の決着(FR-TOURW-014・015)は本specが種別によらず行う。`ByeCard`は`match.kind`と`match.endedEarly`でトーナメントの文言(「次のラウンドへ進みます。」)を選ぶため、トーナメントの`byes`の`reason`の割り当てに依存しない(仮7、tournament-weekの依頼)。
- sponsorship(後続): `TOP_PAGE_SECTIONS`の`banner`(Legend)・`aside`(Gold)・`bottom`(Silver)と`QUALIFIER_LIST_INSERTS`(モバイルのGold、2件ごと)に登録する。
- ugc-moderation(後続): 停止・非公開化の操作でidentity-auth・product-launchのライフサイクルを発火すれば、本specの処理でマッチの即時の終了と開始時点の決着(FR-ADMUG-008)が行われる。統計は`MatchDirectory.summarizeDaily`、プロダクトのマッチ結果は`listByLaunches`を使う。
- data-export(後続): `MatchExport.listForLaunches`(`launches.json`の`matches[]`)・`UpvoteExport.listByUser`(`upvotes.json`)を呼び、本specのテーブルを直接読まない。
- public-api(後続): `MatchDirectory`・`SupporterDirectory`・`UpvoteExport`の形で公開のマッチとUpvoteを読む。

## 設計のレビュー(2026-10-23)

- 機械的な確認: 要件の107件の受け入れ基準の番号がすべて追跡表にあることを、範囲(`2.2〜2.6`)を展開した検索で確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、(1)`MatchViewReader`と`UpvoteHistoryReader`が使うポート(`MatchBoardStore.viewerUpvotes`・`UpvoteHistoryStore`)の形が無かった(ポートの型を加えた)、(2)閲覧者の状態の出どころが曖昧だった(`CurrentUser.user`から読むと明記した)、(3)Upvote履歴のハンドルの検証と外部URLの表示の検証に使うuser-profile-socialの部品が許可された依存に無かった(`checkHandleFormat`・`USER_HANDLE_RULE`・`checkExternalUrl`を加えた)、(4)区画の文脈の型が未定義の名前を参照していた(項目を直接書いた)、を直した。2回目で問題は無かった。
- 境界の確認: 予選の結果はproduct-launchの記録の口で渡すだけで、ローンチのテーブルへ書き込まない。即時の終了の文は本specのテーブルだけを更新する。トーナメントのブラケットと通知の判定は持たず、予定の作成の口とマッチイベントの登録口だけを提供する。トップページの区画の中身(トーナメント・広告)は持たず、登録口だけを持つ。

## タスクの計画の検証(2026-10-23)

- タスクのグラフのサニティレビューを2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
- 1回目の判定はNEEDS_FIXES(必須3件・軽微8件)だった。指摘は、(1)2.2が2.1の種別の型に依存するのに(P)だった(外した)、(2)要件13.2の時刻の境界のうち23:59と0:00・23:44と23:45を確かめるタスクが無かった(5.3・5.4に加えた)、(3)対戦カードの縦積みの画面幅が要件(640px)と設計(768px)で食い違っていた(設計を「640px未満は縦積み、それ以上でもカードの幅が768px未満なら縦積み」に直した)。軽微の指摘(7.3のeventのテストがapiの文を使う前提、4.1の逆向きの競合の検証、`D1MatchBoardStore`の所有、8.2・8.3のGraphQLの生成物への依存、`useUpvote`とキャッシュの更新の配線、8.8の依存、4.1・8.1・8.5の大きさと境界、10.2の運用の報告事項)もすべて直した。
- 2回目の判定はNEEDS_FIXES(必須1件・軽微4件)だった。指摘は、8.8(予選の区画とトップページの組み立て)の作業量が1〜3時間を超えること(8.8 予選の区画・8.9 トップページの枠・8.10 統合に分けた)と、軽微4件(8.4のカードの幅の縦積みのテスト、8.7の区画の文脈への適合の担当、2.3のDIの識別子の範囲、5.4の境界のテストの表現)で、すべてタスクの計画の中で直した。
- kiro-spec-tasksの規則(2回目の判定がPASSでなければ、それ以上レビューを繰り返さずに止める)に従い、3回目のレビューを行っていない。`tasks.md`は2回目の指摘を直した下書きで、タスクの承認(`approvals.tasks`)は行っていない。`/kiro-spec-tasks match-engine -y`を既存の`tasks.md`を引き継ぐ形で再実行し、サニティレビューがPASSになれば承認される。

## タスクの計画の再検証(2026-10-23、コーディネーターの指示による再実行)

- `/kiro-spec-tasks match-engine -y`を、修正済みの`tasks.md`を既存の下書きとして引き継ぐ形で再実行した。新しいサブエージェントによる独立した確認(independent)を、通常の2回の上限で行った。
- 1回目の判定はNEEDS_FIXES(必須1件・軽微8件)だった。必須の指摘は、トップページの区画の登録を8.2が「8.8で加える」、8.10が「登録する」と書いており、(P)の8.8と8.10が登録箇所を両方編集し得たこと(8.2を「8.10で加える」に直し、8.8に「登録しない」と明記した)。軽微の指摘(5.4の分割(4:21のジョブを5.5に分けた)、1.1の作業量の注記、8.4の境界、3.2の`ports.ts`の範囲と各タスクの追記、6.4・7.2・7.3の別グループへの依存、1.2の完了状態の参照先、2.5の境界、サポーターの照会を確定したマッチに限ること(設計の`listSupporters`も直した))もすべて直した。
- 2回目の判定はPASSだった。軽微の指摘3件(9.2の`_Depends: 5.4, 5.5_`、8.8の開始を8.6の完了の後にする注記、8.1の後で操作を変えたタスクでの許可リストの再生成)に従って直し、残り1件(1.1の作業量)は注記済みのため変えていない。タスクを承認した。

## tournament-weekの依頼による改訂(2026-10-24)

- tournament-weekの設計の「上流への影響」にある改訂の依頼(`ByeCard`の文言を`match.kind`で切り替える)を、コーディネーターの指示で仮7として取り込んだ。早期の勝利は、tournament-weekの`WeekTournamentRoundBoard.byes`の定義(即時の終了で`walkover`になったマッチ、`endedEarly`)に合わせ、`match.endedEarly`で見分ける(トーナメントの区画が`reason`をどう割り当てても同じ判定になる。独立のレビューの軽微の指摘による)。
- 変えた箇所: 要件9.7の追加(受け入れ基準は108件)と仮7の行、設計の`ByeList`・`ByeCard`の説明文の表・追跡表・Revalidation Triggers・状態の文言、タスク1.2(文言規則に4文)・8.6(4つの組み合わせのブラウザテストと完了状態)。変更の部分のタスクの検証は新しいサブエージェントによる独立の確認で1回目がPASSで、軽微の指摘(8.6の完了状態を本specの中で観察できる形に、`FORFEIT`と`{n}`の明記、早期の勝利の判定を`match.endedEarly`に)に従って直した・10.2(仮1〜仮7の報告)。

## cross-spec reviewの指摘による修正(2026-10-24)

- 振る舞いを変えない整合の修正のため、改訂の番号は付けない(cross-spec reviewの指摘による)。
  - design.mdの23:40の順序の説明から、23:40のジョブを持たないtournament-week(1500番台)の前に動く旨を除いた。
  - requirements.mdの決定の表の行を仮6・仮7の順に並べ直した。
  - E2E・統合テストで定期実行をローカルで起動する手順が無いことを確かめた(共有の補助`triggerScheduled`への置き換えの対象は無い)。

## 決定の確定(2026-10-24)

- 開発者が仮1〜仮7をすべて推奨(R)どおりに確定した。振る舞いの変更は無い。requirements.md・design.md・tasks.md・research.mdから確認待ちの文言を除き、確定の日付を記した。本specに確認を待つ決定は無い。
- 他のspecの決定のうち本specに影響するものは無い(product-launchの仮4・仮5、notificationsの仮2などは、本specが使う照会口・登録口の形を変えない)。
- 表の行を仮1〜仮7の順に並べた。tasks.mdは文言だけを変えた(1.2の予選ルールの注記と完了状態、10.2の報告の項目と完了状態)。
- 軽いタスクの検証を新しいサブエージェントによる独立の確認で1回行い、PASSだった。軽微の指摘(1.2の完了状態で予選ルールへの決定の記載を確かめる)に従って直した。要件の108件はすべてタスクに割り当てられている。
