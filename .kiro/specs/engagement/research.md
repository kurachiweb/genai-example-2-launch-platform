# Research & Design Decisions

## Summary

- **Feature**: `engagement`
- **Discovery Scope**: Complex Integration(コメントと評価の実装は無い。上流の20spec(dev-tooling〜notifications)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはdirectory-discoveryの詳細ページの区画とディレクトリの項目の値の登録口、product-launchの`ProductDirectory`・`visibleProducts()`・`wonLaunchExists()`・プロダクトライフサイクルの登録口、identity-authの`AccountGuard`・`visibleUsers()`・`verifiedUsers()`・ユーザーライフサイクルの登録口、content-processingのマークダウンの入力欄・描画・検証、user-profile-socialの`UserSummary`、backend-platformの4:21の直列のジョブの上に、コメントと評価を足す)
- **Key Findings**:
  - FR-COMNT-007の置き換え表示の5つの事情(投稿者による削除・管理者による非公開化・退会・停止・匿名化)と、FR-RATNG-009の有効な評価(無効化・退会・停止を除く)は、行の印とidentity-authの`visibleUsers()`の結合で読み取りの時点に求められる。停止・停止の解除・非公開化・復元のための処理や集計の写しを持たずに済み、停止の解除などで自然に元へ戻る。
  - product-launchには、ローンチからプロダクトを引く照会口が無い(`listLaunches(productIds)`と`ScheduledLaunchDirectory.listForDate`だけ)。後続specは`product_launches`の列を読めないため、コメントは投稿時に`listLaunches`で確かめた`product_id`を`launch_id`とともに持つ。上流の変更は要らない。
  - product-launchの申し送りが「コメント・評価の物理削除をプロダクトの`purge_due`の処理(1400番台)で行う」と定めている。投稿者の退会ではプロダクトの`deleted`のイベントは送られず(product-launchのR143)、`products.deleted_at`が入るだけなので、退会・削除されたプロダクトのコメントは閲覧の可否の判定で隠し、データは`purge_due`で消す。
  - 4:21のジョブには続きの仕組みが無く(`run`は`Promise<void>`)、match-engineの掃除のジョブと同じ「500件ずつ最大10回」の形にする。ユーザーとプロダクトの`purge_due`の処理には`continue`がある。
  - 要件定義書・ページ配置・モックアップで決まらない論点が4つある(仮1〜仮4)。加えて、後続のdata-exportの依頼で評価の出力に管理者による無効化の有無を含める仮5を、cross-spec reviewの指摘で管理画面の一覧の照会の持ち主の仮6を設けた(2026-10-24)。仮1〜仮6は2026-10-24に開発者が確定した(仮6は推奨と異なり本specが照会を所有・実装する)。roadmapのRequirement Ambiguitiesに本specが担当する行は無い。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を推奨とした。**仮1〜仮6は2026-10-24に開発者が確定した。** 仮1〜仮5は推奨どおり、仮6は推奨と異なる案(本specが照会を所有・実装する)である。決定は`requirements.md`の「要件フェーズの決定」にも記録する。roadmapのRequirement Ambiguitiesの表に本specが担当する行は無い。

| #   | 論点                                                                                     | 根拠                                                                                                                                                                                                                                                                       | 選択肢                                                                                                                                                                                                                 | 推奨と確定                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | コメントと同時に評価を受け付ける範囲                                                     | FR-RATNG-002(コメントの投稿時(FR-COMNT-001)と編集時(FR-COMNT-005))、ページ配置のコメント(「トップレベルの投稿時には任意の5段階評価を添えられる」)、モックアップ`comment-composer.tsx`・`page-context.ts`(評価欄と投稿欄で自分の評価を共有)                                 | (A)トップレベルの投稿と編集で受け付け、返信では受け付けない。初期値は現在の評価、選ばずに送れば既存の評価を変えない / (B)返信でも受け付ける / (C)投稿時だけ受け付け、編集では受け付けない                              | 推奨は(A)で、2026-10-24に開発者が(A)で確定した。要件定義書の「投稿時や編集時」とページ配置の「トップレベル」の両方を満たす。評価はプロダクトに1件で(FR-RATNG-007)、投稿欄は評価欄と同じ値を見せるため、選ばずに送って消えると驚かせる。取消は評価欄の「取り消す」に限る。(B)は返信のたびに評価の欄が出て会話の流れを妨げ、ページ配置に反する。(C)は要件定義書のFR-COMNT-005の対応を落とす |
| 仮2 | 停止中の利用者の評価を平均に含めるか                                                     | FR-RATNG-009(管理者の無効化を除く)、FR-USER-019(退会で論理削除)、FR-COMNT-007(停止中の利用者のコメントは置き換え表示)、FR-VOTE-008(停止でマッチ中のUpvoteを論理削除)、LR-003(不正な実績操作の防止)                                                                         | (A)停止中は平均と件数から除き、停止の解除で戻す / (B)停止中も含める                                                                                                                                                    | 推奨は(A)で、2026-10-24に開発者が(A)で確定した。停止は不正の疑いで行われることが多く、コメントとUpvoteの扱いと揃う。読み取りの時点の`visibleUsers()`の結合で表せるため、データを変えずに停止の解除で戻る。(B)は要件定義書の字義に近いが、停止中の利用者の評価が表示に効き続ける                                                                                                           |
| 仮3 | 無効化された評価の上書き・取消と本人への見せ方                                           | FR-RATNG-005〜007(編集・物理削除の取消・上書き)、FR-RATNG-009・FR-ADMUG-014(無効化と取消)、FR-ADMUG-030(通知の対象に評価の無効化が無い)                                                                                                                                    | (A)無効化は行に付き、上書きでは残り、取消では行ごと消える。本人には知らせず自分の評価として表示する / (B)上書きで無効化を外す / (C)無効化された評価は取り消せない                                                      | 推奨は(A)で、2026-10-24に開発者が(A)で確定した。取消の物理削除(FR-RATNG-006)を守りつつ、点数を変えるだけでは無効化を外せない。取消して評価し直すと有効な評価になるが、モデレーターが再び無効化できる(ugc-moderationの運用で扱う)。(B)は点数を変えるだけで無効化を外せてしまう。(C)はFR-RATNG-006の取消の機能に反する                                                                      |
| 仮4 | 単独の評価の操作にbot対策を課すか                                                        | SW-018の対象(FR-COMNT-008は含み、FR-RATNGは含まない)、FR-VOTE-006(Upvoteには課す)、LR-003                                                                                                                                                                                  | (A)課さない。コメントと同時の評価はコメントのbot対策を通る / (B)評価・取消にも課す                                                                                                                                     | 推奨は(A)で、2026-10-24に開発者が(A)で確定した。SW-018が対象を列挙しており、評価はメールアドレスの確認・1人1件・自身のプロダクトの拒否・無効化で守られる。(B)は要件定義書に無い手間とTurnstileの呼び出しを増やす。必要になれば`COMMENT_BOT_ACTIONS`と同じ形で操作名を足すだけで変えられる                                                                                                 |
| 仮5 | 本人のデータエクスポートに評価の無効化を含めるか(data-exportの仮2による依頼、2026-10-24) | data-exportの設計と仮2(データエクスポートの文書の`ratings.json`の`invalidatedByAdmin`、管理者により非公開扱いのデータはフラグ付きで含める全体方針)、本specの仮3(画面で本人に知らせない)、コメントの出力の`hiddenByAdmin`、FR-UDATA-001(本人のアクティビティのエクスポート) | (A)評価の出力の部品`RatingExportRecord`に`invalidatedByAdmin: boolean`を加え、`RatingExport.listByUser`が無効化の印から返す。画面で知らせない仮3は変えない / (B)含めない(仮3に合わせ、data-exportが文書から項目を除く) | 推奨は(A)で、2026-10-24に開発者が(A)で確定した。仮3の主旨は画面での見せ方で、本人の請求によるエクスポートは本人に関して処理しているデータ全体を示すのが一貫し、コメントの`hiddenByAdmin`と同じ扱いになる。変更は出力の記録の項目の追加だけで、表示・集計・操作の規則は変わらない。(B)は無効化された評価が平均から外れている事実を本人が知る手段が無くなり、data-exportの文書と食い違う    |
| 仮6 | 管理画面のコメントと評価の一覧の照会の持ち主(cross-spec reviewの指摘、2026-10-24)        | ugc-moderationの設計(`AdminCommentDirectory`・`AdminRatingDirectory`)、FR-ADMUG-008・FR-ADMUG-012・FR-ADMUG-014、roadmapのデータエクスポートの出力の型(各ドメインが自分の照会を持ち、他specはテーブルを直接読まない)                                                       | (A)ugc-moderationが本specの`workers/engagement`に作成・実装し、自ら使う / (B)本specが所有・実装し、ugc-moderationが使う                                                                                                | 推奨は(A)(画面の項目が決まる利用者側が作る、paymentsの集計の照会と同じ扱い)。**2026-10-24に開発者が推奨と異なる(B)で確定した。** 本specが`AdminCommentDirectory`・`AdminRatingDirectory`を、タスク2.7で実装し(契約の正は本specの設計で、ugc-moderationはそれを使う)、要件12.6とRevalidation Triggersにugc-moderationを利用者として記した                                                  |

### 確認済みのため質問しない事項

- コメントできるローンチ: ページ配置の「キックオフ前のローンチにはコメント欄を置かず、キックオフ後にコメントできるようになる」。product-launchの`LaunchStatus`の`in_progress`・`finished`をキックオフ済みとし、取消のローンチは詳細ページに出ない(directory-discovery)。
- 投稿先と評価先の閲覧の可否: directory-discoveryの公開範囲(掲載中は誰にでも、未掲載は投稿者本人だけ、非公開・停止・退会・削除は誰にも)と同じ。未掲載のプロダクトは本人しか見られず本人は評価できないため、評価は掲載中のプロダクトだけになる。
- 階層: ページ配置の「返信は3階層までインデント」とモックアップの`MAX_DEPTH = 3`(第3階層には「返信」が無い)。
- 並び順: トップレベルは新しい順、返信は古い順(ページ配置)。返信はページ分けしない(FR-COMNT-004はトップレベルの10件だけを定める)。
- 置き換え表示: 5つの事情を同じ文言・同じ形にし、アバター・名前・日時も出さない(ページ配置、FR-COMNT-007)。返信の無い置き換え表示のコメントも、FR-COMNT-007の字義どおり表示する。
- 件数: ページ配置のディレクトリのコメント数は「削除・非公開化されたものを除く」。退会・停止もFR-COMNT-007で削除と同じ表示になるため、ローンチごと・プロダクトごとの件数は表示できるコメントだけを数える(モックアップの`countComments`は全ての節を数えるが、置き換え表示を数えると「3件」に3つの「削除されました」が並ぶ)。
- 匿名化の時期: 日次タイムラインの「論理削除から13日後の日次バッチ」、identity-authの物理削除の閾値(`業務日付(実行日−12日)の0:00`より前)と同じ。管理者の非公開化は復元できるため匿名化しない(FR-COMNT-009の対象は個別削除と利用者の物理削除)。
- 退会の論理削除: FR-USER-019の「コメント・評価」を、退会の同期の処理で論理削除する。プロダクトの投稿者の退会(FR-PRDCT-015)と個別の削除(FR-PRDCT-013)では、プロダクトの`deleted_at`で閲覧できなくなるため、他者のコメントに印を付けない(匿名化の対象にもしない)。物理削除はプロダクトの`purge_due`で行う(product-launchの申し送り)。
- 編集の時期: 要件定義書に制限が無い。
- 本文の上限と規則: 文言規則の「コメント 2,000文字・必須・マークダウン」と、content-processingの`markdownTextSchema`の文言と順(使用できない文字→空→上限)。
- `rel`: ページ配置の外部リンクの表(「`noopener`とFR-COMNT-010での指定値」)。`noreferrer`は`Referrer-Policy: same-origin`があるため不要(content-processing)。
- 「あなた」のバッジ: モックアップ(`isOwn`で投稿者本人でない場合)。ページ配置は「投稿者」のバッジだけを挙げるが、矛盾しない。
- 他者のコメントの「通報」: content-reportingの持ち物で、本specはメニューの置き場所`COMMENT_ACTIONS`だけを持つ(directory-discoveryの通報の区画と同じ考え方)。
- 削除の確認のダイアログ: frontend-platformにalert-dialogの部品が無いため、モックアップと同じく`Dialog`で作る。上流の追加は要らない。
- 通知メール: 要件定義書にコメント・評価の通知は無い。管理者の非公開化の通知はugc-moderationが持つ。
- 波及処理とジョブの`order`: 本specの1400番台(roadmapの帯の割り当て)。上流の値より前に動く必要のある処理は無い(ユーザーの`purge_due`では1000のproduct-launchが利用者のプロダクトの物理削除を待つため、本specの1400はその後に動けばよい)。
- 新しいパッケージ: 無い。入力欄はcontent-processingの`MarkdownEditor`、星の入力はshadcn/uiの部品とlucide-reactのアイコンで作る。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(directory-discoveryと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(ユーザーとプロダクトのライフサイクル・可視性フィルタ・画面シェル・Cron・GraphQLのスキーマモジュール・データエクスポートの出力)。
- **Sources Consulted**: directory-discovery・product-launch・identity-auth・content-processing・user-profile-social・match-engine・backend-platform・api-gateway・frontend-platformの`design.md`、product-launch・identity-auth・content-processing・directory-discovery・user-profile-socialの`research.md`の後続specへの申し送り、ugc-moderation・content-reporting・public-api・data-exportのbrief、`docs/GUIDES/service/overview/007-daily-timeline.md`、`docs/GUIDES/service/legal/001-compliance-policy.md`。
- **Findings**:
  - directory-discovery: `PRODUCT_PAGE_SECTIONS`(`aside`の20を評価に予約)・`PRODUCT_LAUNCH_SECTIONS`(10をコメントに予約、文脈に`launch.kickedOff`・`latestKickedOff`)・`DIRECTORY_ITEM_METRIC_SOURCES`と`DIRECTORY_ITEM_METRICS`(`comments`の10を予約)・`DirectoryItemMetricSource.metrics({ productIds, at })`・見出しのID`launches-heading`・E2Eの`e2e/support/directory-fixtures.ts`。区画は個別のエラー境界で描かれる。
  - product-launch: `ProductDirectory.findSummaries(ids, 'visible')`(`ownerUserId`・`visible`・`listed`)・`listLaunches(productIds, now)`(取消を含み`status`は問い合わせの時点で導出)、`visibleProducts()`・`wonLaunchExists()`は`users`との結合が前提で、後続specが読んでよい`products`の列は`id`・`category_id`だけ。プロダクトライフサイクルの`purge_due`は個別の削除の13日目と利用者の物理削除で作られ、全処理の`done`の後に`product_launches`・`products`を消す。外部キーは`ON DELETE`なし。申し送りに「engagement: コメント・評価の物理削除をプロダクトの`purge_due`の処理(1400番台)で行う」とある。
  - identity-auth: `AccountGuard`(`currentUser`・`requireUser`・`requireWritableUser`・`requireVerifiedUser`)、エラー`unauthenticated`・`email_not_verified`・`account_unavailable`、`visibleUsers()`(`deleted_at IS NULL AND status = 'active'`)・`verifiedUsers()`、`USER_LIFECYCLE_SYNC_HANDLERS`(集合の更新の文だけ)・`USER_LIFECYCLE_ASYNC_HANDLERS`(`order`、`continue`は5秒後)、`purge_due`は4:21の`identity-auth.purge-orchestrator`(100)が退会の13日目に作る。`users`の行は全ての処理の後に消え、外部キーは先に外す。clientの`viewer`の文脈(`ClientViewer.emailVerified`)・`LoginRequiredDialog`・`resendVerificationEmail`。
  - content-processing: `markdownTextSchema(rule)`・`countGraphemes`(`common-lib`)、`MarkdownEditor`(`maxGraphemes`・`preview`・遅延読み込みは部品の中)・`MarkdownContent`(`size: 'sm'`はコメント向け)・`useRenderedMarkdown`・`useMarkdownOptions({ externalLinkRel, idScope })`。`idScope`は`/^[a-z0-9]{1,32}$/`。各入力欄の上限・`rel`・`idScope`・保存の操作はドメインspecの持ち物。入力欄のE2Eはengagementが書く。
  - user-profile-social: `UserSummary { handle, nickname, avatar }`・`userSummaryLoader`(可視でなければnull)・`UserAvatar`。
  - backend-platform・api-gateway: `ScheduledJobDefinition { name, at, order, handler }`(直列、失敗は記録して次へ、再試行なし)、`context.assertHuman(action)`(トークンは`cf-turnstile-response`のヘッダー、操作名は各ドメインの定数)、`withValidatedArgs`・`encodeCursor`・`decodeCursor`・`PageInfo`、GraphQLの深さの上限8。
  - match-engine: `upvote`のリゾルバの順(呼び出し元→`requireVerifiedUser`→`assertHuman`→ユースケース)、4:21の掃除のジョブの「500件ずつ最大10回」。
  - frontend-platform: `useTurnstileToken`・`TurnstileWidget`・`executeGraphQL(..., { turnstileToken })`・`GraphQLClientError.code`・`useAppForm`・`FormField`・`notify`・`PartialErrorState`・`formatElapsed`(30日以上はnull)・shadcn/uiの`Dialog`・ドロップダウンメニュー(alert-dialogは無い)。
  - 下流のbrief: ugc-moderationはコメントの非公開化・復元と評価の無効化・取消の管理画面(`/comments`・`/ratings`)を持ち、理由と監査と通知を記録する。content-reportingはコメントの通報を受ける。data-exportは各ドメインの出力の部品を呼ぶ。public-apiはコメントと評価を読む。
- **Implications**: 上流のファイルの変更は契約で定められた登録箇所への追記だけにする。上流の公開の契約の変更は要らない。

### 表示の状態と有効な評価

- **Context**: 要件5・11、仮2、FR-COMNT-007・FR-RATNG-009。
- **Findings**:
  - 置き換え表示の事情のうち、削除・非公開化・匿名化は本specの行の印、退会・停止は`users`の状態である。`LEFT JOIN users`と`visibleUsers()`を`CASE`で選択の列にすれば、1回の問い合わせで表示の状態が決まる。
  - 停止の解除・非公開化の取消で表示を戻すには、印を変えない読み取りの時点の判定が最も単純である。写しや停止の処理を持つと、停止と解除の順序の食い違いを処理で直す必要が生じる。
  - 評価の平均は`AVG(score)`を`validRating()`の行で求められる。1つのプロダクトの評価は数百件の規模で、`(product_id, user_id)`の一意索引で範囲を絞れる。
- **Implications**: `displayableComment()`・`validRating()`を`apps/db/schema/engagement/engagement-conditions.ts`に置き、本specの照会とpublic-apiが同じ条件を使う。

### コメントの木とページ分け

- **Context**: 要件2・3、FR-COMNT-002・004、GraphQLの深さの上限。
- **Findings**:
  - `depth`(1〜3)と`root_id`(トップレベルのID)を持てば、トップレベルのページは`(launch_id, depth, created_at, id)`、返信のまとめ読みは`(root_id, created_at, id)`の索引で読める。返信の`root_id`・`depth`は親から決まる。
  - GraphQLで`replies`を入れ子にすると、深さ8の上限(返信→返信→作者→画像)に近づく。返信を平たい一覧で返し、クライアントで木を組めば深さは6に収まる。
  - カーソルを`(created_at, id)`にすれば、間に新しい投稿があっても続きが重複・欠落しない。
- **Implications**: `CommentThreadQuery.page`はトップレベル11件と返信を1回の`db.batch()`で読む。

### 物理削除・匿名化の順序

- **Context**: 要件6・13、FR-COMNT-009・FR-USER-022・FR-PRDCT-024、product-launchとidentity-authの物理削除の順。
- **Findings**:
  - 利用者の`purge_due`では、`product-launch.product-erasure`(1000)が利用者のプロダクトの`purge_due`を作り、プロダクトが消えるまで`continue`を返す。本specの`engagement.product-erasure`(プロダクトの1400)がそのプロダクトのコメントと評価を消し、その後に本specの`engagement.account-erasure`(ユーザーの1400)が他者のプロダクトへのコメントを匿名化し評価を消す。`users`の行はその後に消える。
  - 自己参照の外部キー(`parent_id`)を持つ行を件数を区切って消すときは、`depth`の降順で選べば親だけを消して子が残ることが無い。
  - 4:21のジョブは続きを持たないため、1回の実行の上限(500件×10回)を超えた分は翌日に回る。期限(14日)を過ぎた行の件数を`error`で記録して検知する。
- **Implications**: 匿名化と物理削除の文を`EngagementErasureStore`にまとめ、ジョブ(api)と処理(event)で共有する。

### 画面とモックアップの差分

- **Context**: 要件8・10・11、ページ配置、モックアップ(`comment-thread.tsx`・`comment-item.tsx`・`comment-composer.tsx`・`comment-gate.tsx`・`delete-comment-dialog.tsx`・`rating-card.tsx`・`star-rating-input.tsx`・`launch-block.tsx`)。
- **Findings**:
  - モックアップは投稿欄にtextareaと9つのツールを使うが、本番はcontent-processingの`MarkdownEditor`(10のツール・遅延読み込み・プレビュー・カウンター)を使う(content-processingのQ2)。
  - 開閉のボタンの件数はモックアップでは全ての節を数えるが、本specは表示できるコメントだけを数える(「確認済みのため質問しない事項」)。
  - 評価欄と投稿欄は自分の評価を共有する(モックアップの`page-context.ts`)。本番は`productRating`のキャッシュを共有する。
  - 削除の確認は`Dialog`、文言はモックアップのとおり。トーストの文言はモックアップにだけあり文言規則に無いため、文言規則へ加える。
- **Implications**: 文言はモックアップを正とし、文言規則へ写す。

## Architecture Pattern Evaluation

| Option                             | Description                                                        | Strengths                                        | Risks / Limitations                                            | Notes  |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------- | ------ |
| 読み取りの時点で状態を求める(採用) | 行の印と`visibleUsers()`の結合で表示と有効を決める                 | 停止・解除・非公開化・復元の処理が不要、常に最新 | 一覧ごとに`users`を結合する                                    | 採用   |
| 停止・退会で行に印を付ける         | ユーザーライフサイクルの同期の処理で`hidden_by_suspension`を付ける | 読み取りが単純                                   | 停止と解除の処理・順序の食い違い・管理の非公開化との区別が要る | 不採用 |
| 評価の集計の写しを持つ             | プロダクトごとの合計と件数を更新する                               | 多数のプロダクトの平均を安く読める               | 無効化・停止・退会・取消のたびに直す処理が要り、食い違いが残る | 不採用 |
| 返信を入れ子のGraphQLの型で返す    | `replies: [LaunchComment!]!`を再帰で返す                           | クライアントで木を組まない                       | 深さ8の上限に近く、断片を3段に書く必要がある                   | 不採用 |

## Design Decisions

### Decision: 表示の状態と有効な評価を読み取りの時点で求める

- **Context**: 要件5.1・5.4・11.1・11.2、仮2。
- **Alternatives Considered**:
  1. `displayableComment()`・`validRating()`の条件を問い合わせに結合する
  2. 停止・退会のたびに行へ印を付ける
- **Selected Approach**: 1。行の印(`deleted_at`・`hidden_at`・`anonymized_at`・`invalidated_at`)と`visibleUsers()`の結合で決める。
- **Rationale**: 停止の解除・非公開化の取消で処理なしに戻り、管理の非公開化と停止を区別して保てる。
- **Trade-offs**: 一覧・件数・平均の問い合わせが`users`を結合する。主キーでの結合で、件数は小さい。

### Decision: コメントに`product_id`を持つ

- **Context**: 要件1.4・3.6・13.5・14.1、product-launchにローンチからプロダクトを引く照会口が無いこと。
- **Selected Approach**: 投稿の手順で`listLaunches([productId])`によりローンチがそのプロダクトのものかを確かめ、`product_id`と`launch_id`の両方を外部キーで持つ。
- **Rationale**: product-launchの公開の契約を変えずに、プロダクトごとの件数・物理削除・閲覧の可否の判定を自分のテーブルで行える。

### Decision: 条件付きの書き込みでコメントと評価を1回で確定する

- **Context**: 要件1.9・9.10・10.2・10.3、D1の`db.transaction()`の禁止。
- **Selected Approach**: `product_id`・`body`のNOT NULLの列に`CASE WHEN <条件> THEN ? ELSE NULL END`を入れ、コメントと評価の文を1回の`db.batch()`にする。違反は読み直して分類する(product-launch・match-engineと同じ形)。
- **Rationale**: 判定の後の非公開化・停止・親の削除で書き込まれず、片方だけが残らない。

### Decision: 管理の操作口を状態の変更だけに絞る

- **Context**: 要件12、ugc-moderationのbrief(理由・監査・通知はugc-moderation)。
- **Selected Approach**: product-launchの`ProductVisibilityControl`と同じ形の`CommentModerationControl`・`RatingModerationControl`。理由と監査の記録の文を`statements`で受け取り、同じ一括の書き込みで確定できるようにする。
- **Rationale**: 管理の記録と状態の変更の食い違いを防ぎつつ、本specが管理の規則を持たない。管理画面の一覧の照会(`AdminCommentDirectory`・`AdminRatingDirectory`)は、本specのテーブルの列を解釈するため本specが所有・実装し、ugc-moderationが使う(仮6、2026-10-24に開発者が確定)。

### Decision: 匿名化と物理削除を1つのストアにまとめる

- **Context**: 要件6・13.5・13.6。
- **Selected Approach**: `EngagementErasureStore`(`anonymizeDeletedBefore`・`countOverdue`・`eraseAccount`・`eraseProduct`)をbackend-libに置き、4:21のジョブ(api)と`purge_due`の処理(event)が使う。件数は500件ずつ、続きはジョブでは同じ実行の繰り返し(最大10回)、処理では`continue`。
- **Rationale**: 匿名化の文を1か所にし、日次と物理削除の時期で同じ結果にする。

### Decision: 採らなかった案

- 返信のページ分け: FR-COMNT-004はトップレベルの10件だけを定め、モックアップも返信を全て表示する。
- コメントの通知メール・評価の通知: 要件定義書に無い。
- 単独の評価のbot対策: 仮4。
- 退会・削除されたプロダクトのコメントの論理削除の印: プロダクトの`deleted_at`で閲覧できなくなり、物理削除で消えるため要らない。

## Synthesis

- **Generalization**: 置き換え表示の5つの事情と評価の3つの除外を、「行の印と投稿者の可視性の結合」という1つの条件に一般化した。投稿・返信・編集・評価・取消の閲覧の可否を、directory-discoveryの公開範囲と同じ1つの判定(`canViewProduct`)に一般化した。日次の匿名化・利用者の物理削除・プロダクトの物理削除を、「件数を区切った条件付きの更新・削除を、残りが無くなるまで繰り返す」1つの形に一般化した。
- **Build vs Adopt**: マークダウンの入力・描画・検証(content-processing)、利用者の表示(user-profile-social)、閲覧者の状態と再送とログインの案内(identity-auth)、bot対策・フォーム・通知・ダイアログ(frontend-platform)、日次のジョブと再試行(backend-platform・各ライフサイクルの実行器)を使う。新しいパッケージは無い。
- **Simplification**: 集計の写し・停止と非公開化のための処理・返信のページ分け・入れ子のGraphQLの型を持たない。管理画面の照会は、本specの設計の契約(ugc-moderationが使う)のまま、絞り込み・並び順・状態の優先だけを持つ2つの照会にとどめる(仮6)。

## Risks & Mitigations

- 1つのスレッドの返信が非常に多いと、1ページの読み取りが増えてNFR-PERF-007の300msを超える — 返信は`(root_id, created_at, id)`の索引で読み、launch-readinessの性能の検証で1スレッド500件の合成データで確かめる。超える場合は返信のページ分けを足す(要件の追加として開発者に確認する)。
- 匿名化が1日の上限(5,000件)を超えて期限を過ぎる — 期限を過ぎた件数を`error`で記録し、運用で上限を上げる。
- 確定した仮1〜仮6の決定の前提が変わる — 仮6は`AdminCommentDirectory`・`AdminRatingDirectory`の形とugc-moderation、仮5は`RatingExportRecord`の項目とdata-exportの`ratings.json`の組み立て、仮2は`validRating()`の条件、仮3は`upsertStatement`と`RatingService.read`、仮4はリゾルバの`assertHuman`、仮1は`CommentService`と投稿欄の評価の行だけを直せばよい形にしている。
- 本specが所有する管理画面の一覧の照会(`AdminCommentDirectory`・`AdminRatingDirectory`、仮6)とugc-moderationの使い方が食い違う — 契約の正は本specの設計で、ugc-moderationの設計はそれを使う。型は確定の時点の形を保ち(シグネチャは変えない)、タスク2.7の型検査で確かめる。本specが`launch_comments`・`product_ratings`の列や`displayableComment()`の条件を変えるときは照会の実装も本specが直し、照会の形を変えるときはRevalidation Triggersに従ってugc-moderationを確かめ直す。
- 技術ドキュメントの番号の重なり — 並行して作成中のtournament-week・sponsorshipと重なり得る。本specは各ディレクトリで最も小さい空き番号(`backend/015`・`frontend/015`)を使い、コントローラーへ報告する。

## References

- `docs/GUIDES/service/design/002-page-layouts.md` — プロダクト詳細の評価欄・コメント欄・外部リンクの`rel`
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — コメントの上限と本機能の文言
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 日次バッチ(4:21)と論理削除から13日後の処理
- `docs/GUIDES/service/legal/001-compliance-policy.md` — 退会者のコメント・個別に削除されたコメントの保持と匿名化
- `mockups/src/routes/client/p/$handle` — コメント欄・評価欄のモックアップ
- [SQLite Foreign Key Support](https://www.sqlite.org/foreignkeys.html) — 外部キーの検査が文の終わりで行われること(深い順の削除)

## 確定した決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要した論点である。**仮1〜仮6はいずれも2026-10-24に開発者が確定した**(仮1〜仮5は推奨どおり、仮6は推奨と異なる案)。`requirements.md`の「要件フェーズの決定」にも同じ行がある。

| #   | 論点                                  | 採用した案                                                                                                        | 他の選択肢                                       | 影響する箇所                                                                              |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 仮1 | コメントと同時の評価の範囲            | トップレベルの投稿と編集、選ばなければ既存の評価を変えない                                                        | 返信でも受け付ける / 投稿時だけ                  | 要件10、`CommentService`、`CommentComposer`                                               |
| 仮2 | 停止中の利用者の評価                  | 停止中は平均と件数から除き、解除で戻す                                                                            | 停止中も含める                                   | 要件11.1・11.2、`validRating()`                                                           |
| 仮3 | 無効化された評価の上書き・取消        | 上書きで無効化を保ち、取消で行ごと消す。本人の画面では知らせない(エクスポートは仮5で含める)                       | 上書きで外す / 取り消せない                      | 要件11.11、`RatingStore.upsertStatement`・`findScore`、`RatingExport`                     |
| 仮4 | 単独の評価のbot対策                   | 課さない                                                                                                          | 評価・取消にも課す                               | 要件9.9、`RatingResolvers`                                                                |
| 仮5 | 評価の出力の無効化(data-exportの依頼) | 出力に`invalidatedByAdmin`を含める。画面で知らせない仮3は変えない                                                 | 含めない(data-exportが文書から項目を除く)        | 要件14.3、`RatingExportRecord`・`RatingExport.listByUser`、data-exportの`ratings.json`    |
| 仮6 | 管理画面の一覧の照会の持ち主          | 本specが`AdminCommentDirectory`・`AdminRatingDirectory`を所有・実装し、ugc-moderationが使う(推奨と異なる案で確定) | ugc-moderationが本specの置き場所に作成・実装する | 要件12.6、`AdminCommentDirectory`・`AdminRatingDirectory`、タスク2.1・2.7、ugc-moderation |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID                          | 内容                                                                                                 | 根拠 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- | ---- |
| FR-RATNG-002                    | 評価を添えられるのはトップレベルのコメントの投稿と編集で、選ばなければ既存の評価を変えない旨を加える | 仮1  |
| FR-RATNG-009                    | 停止中の利用者の評価も平均から除く旨を加える                                                         | 仮2  |
| FR-RATNG-005〜007・FR-ADMUG-014 | 無効化された評価の上書きで無効化を保ち、取消で無効化ごと消える旨を加える                             | 仮3  |
| SW-018                          | 評価の操作をbot対策の対象に含めない旨を明記する(または含める)                                        | 仮4  |
| FR-UDATA-001                    | 評価のエクスポートに管理者による無効化の有無を含める旨を加える                                       | 仮5  |

## 上流・後続specへの影響

- identity-auth(上流): 登録箇所への追記だけ。`USER_LIFECYCLE_SYNC_HANDLERS`に`engagement.withdrawal`(`withdrawn`)、`USER_LIFECYCLE_ASYNC_HANDLERS`に`engagement.account-erasure`(`purge_due`、1400)。`AccountGuard`・`visibleUsers()`・`verifiedUsers()`・`LoginRequiredDialog`・`resendVerificationEmail`を契約どおりに使う。
- product-launch(上流): `PRODUCT_LIFECYCLE_ASYNC_HANDLERS`に`engagement.product-erasure`(`purge_due`、1400)を足す(契約どおり)。`ProductDirectory.findSummaries`・`listLaunches`・`visibleProducts()`・`wonLaunchExists()`を契約どおりに使い、`products`・`product_launches`へ外部キーを張る。公開の契約の変更は要らない(ローンチからプロダクトを引く照会口は求めず、コメントに`product_id`を持つ)。
- backend-platform(上流): `SCHEDULED_JOBS`に`engagement.comment-anonymization`(4:21、1400)を足す(契約どおり)。
- directory-discovery(上流): 予約された置き場所へ登録する。`PRODUCT_PAGE_SECTIONS`の`engagement.rating`(aside 20)、`PRODUCT_LAUNCH_SECTIONS`の`engagement.comments`(10)、`DIRECTORY_ITEM_METRIC_SOURCES`の`engagement.comment-count`(`comments`、10)、`DIRECTORY_ITEM_METRICS`の`comments`(10)。変更は無い。
- content-processing・user-profile-social・frontend-platform(上流): 変更は無い。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は1400、波及処理は1400」になる(プロダクトライフサイクルの処理も1400)。Requirement Ambiguitiesの表に本specの行は無い。本specはroadmapを編集しないため、コントローラーへ報告する。
- ugc-moderation(後続): コメントの非公開化・復元は`CommentModerationControl.hide`・`unhide`、評価の無効化・取消は`RatingModerationControl.invalidate`・`revalidate`を呼び、理由と監査の記録の文を`statements`で渡す。通知の宛先は`CommentStore.findByIds`の`authorUserId`をidentity-authの`UserContactDirectory`で引く。管理画面のコメントの一覧(投稿者・プロダクト・期間・公開状態の絞り込み、FR-ADMUG-012)とプロダクトの評価の一覧(FR-ADMUG-008・FR-ADMUG-014)の照会は、本specが`apps/backend-lib/workers/engagement`の`AdminCommentDirectory`(`admin-comment-directory.ts`)・`AdminRatingDirectory`(`admin-rating-directory.ts`)として所有・実装し(タスク2.7、`ENGAGEMENT_PLATFORM_TYPES`・`ENGAGEMENT_PLATFORM_MODULE`に束縛)、ugc-moderationが使う(仮6、2026-10-24に開発者が推奨と異なる案で確定)。ugc-moderationは照会の実装のタスクを持たず、形は本specの設計を正とする。
- content-reporting(後続): `COMMENT_ACTIONS`に通報(`order` 10、`CommentActionContext`を受け取りメニューの項目を描く)を登録し、通報の対象の確かめは`CommentStore.findByIds`で行う。
- data-export(後続): `CommentExport.listByUser`・`RatingExport.listByUser`(`ENGAGEMENT_PLATFORM_TYPES`、api・eventに束縛)を呼び、本specのテーブルを直接読まない。評価の出力は`invalidatedByAdmin`(無効化の有無)を含む(data-exportの仮2の依頼による本specの仮5)。
- public-api(後続): 閲覧の可否をproduct-launchの`ProductDirectory`で判定し、`CommentThreadQuery.page`・`RatingStore.summaries`と`displayableComment()`・`validRating()`で読む。bot対策と書き込みは公開APIに含めない。

## 要件のレビュー(2026-10-24)

- 機械的な確認: 15の要件の見出しがすべて数字のIDを持ち、113件の受け入れ基準がすべてEARSの形式(`When`・`If`・`While`・`Where`・`The … shall`)である。技術名は要件定義書の用語(GFM・Raw HTML・カーソル方式・GraphQL)と外部リンクの`rel`の値(ページ配置の規則)だけに限った。
- 1回目の判断のレビューで、(1)1つの受け入れ基準に2つの振る舞い(ログイン・停止の拒否とメールアドレス未確認の拒否)をまとめていた要件4.5・9.7を分けた(未確認でも削除と取消は受け付ける)、(2)開閉のボタンの文言の日本語と英数字の間の空白を直した。2回目で問題は無かった。
- 要件定義書・サービス仕様で決まらない論点は仮1〜仮4として記録し(仮5は後にdata-exportの依頼で加えた)、要件の範囲の推測は加えていない。

## 設計のレビュー(2026-10-24)

- `/kiro-spec-design engagement -y`の手順で要件を承認し(`-y`による自動の承認)、Complex Integrationとして完全な調査を行った。参照したスキルはcc-sddの`kiro-spec-requirements`・`kiro-spec-design`・`kiro-spec-tasks`の規則とテンプレート。新しいパッケージが無いため外部の調査はSQLiteの外部キーの検査の時点の確認に限った。
- 機械的な確認: 要件の113件の受け入れ基準の番号がすべて追跡表にあることを、番号の境界を区切った検索で確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、(1)編集の書き込みが評価の文を取り消す条件付きの形になっていなかった(`body`の`CASE`の条件に直した)、(2)評価の条件に`products.user_id`を使う記述があった(後続specが読めない列のため、所有者の判定をユースケースの先の判定に移した)、(3)退会で論理削除したコメントが日次の匿名化の対象にもなることを明記していなかった、(4)閲覧者の状態の判定の順と評価欄の本人の優先が曖昧だった、を直した。2回目で問題は無かった。
- 境界の確認: 閲覧の可否はproduct-launchの照会と条件の部品だけで判定し、上流のテーブルへ書き込まない。利用者の状態は`visibleUsers()`・`verifiedUsers()`の結合だけで読む。管理の判断・理由・監査・通知、通報の受け付け、エクスポートの生成、公開APIの経路は持たず、操作口・置き場所・部品だけを持つ。

## タスクの計画の検証(2026-10-24)

- `/kiro-spec-tasks engagement -y`の手順で、要件と設計を承認し(`-y`による自動の承認)、タスクの計画の下書きを作った。要件の113件の受け入れ基準の番号がすべてタスクにあることを機械的に確かめた。
- タスクのグラフのサニティレビューを2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
- 1回目の判定はNEEDS_FIXES(必須6件・軽微11件)だった。指摘は、(1)純粋な規則の3.1(P)がスレッドの照会の型への依存を宣言していなかった、(2)キャッシュの更新の7.1(P)がGraphQLの操作の生成への依存を宣言していなかった、(3)投稿欄・項目・削除のダイアログをコメントの操作の呼び出しへつなぐ担当が無かった(操作の呼び出しを7.5、項目を操作を受け取る形の7.6、つなぎ込みと4つの操作の反映のテストを7.7にした)、(4)確認メールの再送の操作の文書がidentity-authの文書と操作名で重なり得た(一意の操作名にした)、(5)apiとclientのコメント数の登録の担当の書き方が曖昧だった、(6)「カーソルの暗号化」が設計の符号化と食い違っていた、の6件である。軽微の指摘(2.1・3.4・4.1の分割、DIの識別子の一覧、5.1の束縛の追記、5.3のeventの識別子、6.3の評価欄のキャッシュのキー、削除のダイアログのbot対策のトークンの待ち、評価者の索引、7.9の不要な依存、6.2の(P))もすべて直した。
- 2回目の判定はPASSだった。軽微の指摘3件(スレッドと件数のキャッシュのキーの担当を7.5に明記、4.1のテストの箇条を先頭へ、直前のタスクへの冗長な依存の宣言の削除)に従って直した。タスクを承認した。

## data-exportの依頼による仮5の反映(2026-10-24、コーディネーターの指示による)

- data-exportの設計(仮2)が、データエクスポートの文書の`ratings.json`の`invalidatedByAdmin`のため、本specの`RatingExportRecord`に`readonly invalidatedByAdmin: boolean;`を加え、`RatingExport.listByUser`が評価の行の無効化の印から値を返すことを求めた。仮5として採用した(2026-10-24に開発者が推奨どおり確定)。
- 反映した内容: requirements.mdの仮決定の表に仮5を加え、要件11.11を「画面では本人に無効化を知らせず」に、要件14.3に「評価の出力には管理者による無効化の有無を含める」を加えた。design.mdの`RatingExportRecord`に項目を加え、「出力の記録は管理者による無効化を含めない」の記述を、出力は`invalidatedByAdmin`で返し画面で知らせない仮3は変えない形に改め、追跡表・Revalidation Triggers・Testing Strategyを直した。tasks.mdの2.6の統合テストに`invalidatedByAdmin`の真と偽を、9.2の報告に仮5を加えた。表示・集計・操作の規則は変わらない。
- 変更した部分について、新しいサブエージェントによる独立したタスクのグラフのサニティレビュー(independent)を1回行い、判定はPASSだった。軽微の指摘2件(要件のレビューの記録と仮決定の表の仮3の行で、画面とエクスポートの扱いを区別する書き方)に従って直した。2.6の依存の明示の提案は、並びの順で満たされるため変えていない。タスクを承認し直した。

## cross-spec reviewの指摘による仮6の反映(2026-10-24)

- **決定**: ugc-moderationが本specの`apps/backend-lib/workers/engagement/`に作成・実装し、自ら使う`AdminCommentDirectory`・`AdminRatingDirectory`(本specの申し送りで招いた照会)を、design.mdのRevalidation Triggersとファイル構成(ツリーの2行と注記)に記録した。`launch_comments`・`product_ratings`の列(状態の印・本文・評価の値・日時・紐付け)と`displayableComment()`の条件の変更は、ugc-moderationの再検証の契機になる。
- **理由**: cross-spec reviewの指摘による。照会は本specのディレクトリに置かれ本specのテーブルの列を解釈するが、本specの再検証の契機に無かったため、列の変更でugc-moderationの照会が黙って壊れ得た。
- **影響**: 利用者・運営者に見える振る舞いは変わらないため、requirements.mdの仮決定の表には加えない。本specのタスクは照会を作らない(作成と束縛はugc-moderationのタスク)。tasks.mdの9.2の報告に仮6を加えた。
- **状態**: 2026-10-24に開発者が推奨と異なる案で確定した。照会は本specが所有・実装し(タスク2.7)、ugc-moderationが使う。上の「決定」「影響」の記述(ugc-moderationが作成し、本specのタスクは照会を作らない)は確定により置き換えられた(「決定の確定の反映」を参照)。

## 変更履歴

- 2026-10-24: cross-spec reviewの指摘により、ローカルでの4:21の起動を、5.2の独自の手動の起動(`--test-scheduled`)からbackend-platformの改訂2の共有の補助`triggerScheduled`(`e2e/support/scheduled-trigger.ts`)へ切り替えた。起動による匿名化の確かめは、検証できる形にするため9.1のE2E(`executeLocalD1`で削除の日時を13日前と12日前に書き換え、13日前の行だけが匿名化されることを読み取りで確かめる)へ移し、5.2の完了状態は単体テストとcronの登録の検証にした。1.1と9.1の前提に改訂2を加え、design.mdのAllowed DependenciesとTesting StrategyのE2Eにも記した。振る舞いの変更は無い。

### 変更後のタスクの計画の検証(2026-10-24)

- 変更した部分(1.1・2.1・5.2・9.1・9.2)について、新しいサブエージェントによる独立したタスクのグラフのサニティレビュー(independent)を2回行った。
- 1回目の判定はNEEDS_FIXES(必須1件・軽微3件)だった。必須の指摘は、5.2の完了状態「`triggerScheduled`によるローカルの起動で匿名化が動く」がデータの用意と確かめ方を欠き検証できない、であった。起動による匿名化の確かめをコミットするE2E(9.1)へ移し、5.2の完了状態を単体テストとcronの登録の検証にして直した。軽微の指摘(design.mdの単体テストの節の補助の記述をE2Eの節へ移す、1.1の保留の範囲の明記、2.1でugc-moderationの照会の識別子を作らない旨)もすべて直した。
- 2回目の判定はPASSだった。軽微の指摘3件(9.1の削除の日時の求め方と2件のコメントの作り方、保留したときの完了状態、design.mdの境界の0:00の明記)に従って直した。タスクの承認を保った。

## 決定の確定の反映(2026-10-24、コーディネーターの指示による)

- 開発者が仮1〜仮6を確定した。仮1〜仮5は推奨どおり(R)で、振る舞いは変えず、requirements.md・design.md・tasks.md・research.mdから確認待ちの記述を除いた。仮6は推奨と異なり、上流の本specが`AdminCommentDirectory`・`AdminRatingDirectory`を所有・実装する案が選ばれた(paymentsの`PaymentRevenueReport`と同じ扱い)。ugc-moderationは並行して照会の実装のタスクを外す改訂中で、型の形は保つ(本specはugc-moderationを編集しないため、同specの改訂の完了はコーディネーターが確かめる)。
- 仮6の反映: requirements.mdに要件12.6(管理画面のコメントと評価の一覧の照会の部品の提供)を加え、仮決定の表を確定の表に改めた。design.mdのThis Spec Owns・Non-Goals・Revalidation Triggers(利用者としてugc-moderation)・ファイル構成・コンポーネントの表・追跡表(12.6)・`ENGAGEMENT_PLATFORM_MODULE`の束縛・Testing Strategyに照会を加え、型をugc-moderationの設計(`AdminCommentState`・`AdminCommentRecord`・`AdminCommentSearchFilter`・`AdminCommentDirectory`・`AdminRatingState`・`AdminRatingRecord`・`AdminRatingDirectory`)からそのまま写した。tasks.mdの2.1の識別子の一覧に照会を加え、2.7(照会の実装と統合テストと束縛の追記)を新設し、1.3と9.2の確認待ちの記述を直した。
- 要件定義書の改訂: 仮6には要らない。仮1〜仮5の改訂の推奨(「要件定義書の改訂が必要な箇所」)は確定した内容のまま残る。
- 他specへの影響: ugc-moderationは照会の実装のタスクを外し、`ENGAGEMENT_PLATFORM_TYPES.AdminCommentDirectory`・`AdminRatingDirectory`を本specの実装として使う(型は変えない)。本specはugc-moderationを編集しない。
- 変更した部分について、新しいサブエージェントによる独立した設計のレビューとタスクのグラフのサニティレビュー(independent)を2回行った。1回目は設計がNEEDS_FIXES(必須2件: research.mdの決定の根拠とSynthesisに、ugc-moderationが照会を加える・本specが照会を持たないという現行の記述が残っていた)、タスクがPASS(軽微のみ)だった。必須と軽微(Summaryへの仮6の追記、ugc-moderationの改訂の状態の記述、backend-libでのカーソルの実装、2.7の完了状態・90件ずつの境界のテスト・依存の明示、9.2の見出し)をすべて直した。2回目は設計・タスクともPASSで、軽微3件(Testing Strategyへの90件ずつの境界、2.7のDIの解決の3経路、管理画面の一覧の索引の扱いの注記)に従って直した。要件・設計・タスクの承認を保った。
- cross-spec reviewの3回目の指摘(2026-10-24)により、`AdminCommentDirectory`・`AdminRatingDirectory`の契約の正を本specの設計とし、ugc-moderationはそれを使う形に記述を改めた(design.mdのファイル構成の注記と2つの型の見出しのコメント、tasks.mdの2.7、本書のSimplificationとRisksと仮6の行)。シグネチャは変えていない。
- この変更でタスク2.7の本文が変わったため、新しいサブエージェントによる独立した確認(independent)を行った。1回目はNEEDS_FIXES(必須1件: ugc-moderationへの申し送りの行に「形は同specの設計のとおり」が残っていた、軽微2件)で、すべて直した。2回目はPASSで、軽微の言い回しの重複を直した。タスクの承認を保った。

## frontend-platformの実装で確定した契約の反映(2026-10-28)

- frontend-platformの実装と最終検証の後、開発者の決定(frontend-platformのタスク10.4)で、設計をfrontend-platformの設計の「実装で確定した契約による発火と影響を受ける下流spec」の表に合わせた。振る舞いを変えない整合の修正のため、改訂の番号は付けない。要件は変えていない。
  - 操作の置き場所と生成物: clientの操作を`src/graphql/operations/engagement/`の1ファイル1操作の`.graphql`(操作名は`Client`で始め、確認メールの再送は`ClientEngagementResendVerificationEmail`)にし、`graphql()`を呼ばず、部品は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読むとした(design.mdのAllowed Dependencies・File Structure Plan・CommentGate、tasks.mdの6.1)。
  - Zodの値の読み込み元とフォーム部品の形: `comment-form-schema.ts`はZodの値を`lib/utilities/validation/zod.ts`の`z`から読み、`CommentComposer`を`useAppForm<TInput, TOutput>(schema, { defaultValues })`と`AppForm`(`serverFieldPrefix="input"`・必須の`onSubmitError`)で作り、欄に対応しない失敗の文言を`errorMessageOf`で選ぶとした(design.mdのCommentComposer、tasks.mdの7.1・7.3)。共有ディレクトリ`apps/common-lib/engagement`の`commentBodySchema`・`ratingScoreSchema`は`ZOD_VALUE_RESTRICTION`の対象外(フロントエンドのアプリと共通部品の規則)のため変えていない。
  - 非表示のウィジェット: `CommentComposer`のbot対策のウィジェットは`TurnstileWidget`が非表示で描くため、判定の枠と場所を設けないとした(design.mdのCommentComposer、tasks.mdの7.3)。

## フォームの描かない値と無効の欄の扱いの反映(2026-10-28、開発者の判断)

- **状態**: frontend-platformの最終検証の後の第2回の判断16・25〜28・30〜36(2026-10-28〜29)を、frontend-platformのタスク11.8として本specの設計とタスクへ反映した。受け入れ基準は変えていない。
- **Context**: frontend-platformの`SubmitButton`は、`root`以外の欄のエラー(サーバーの欄のエラーを含む)が1つでも残る間は無効になる。入力欄を描かない値をフォームのスキーマの入力に含めると、その値へのサーバーの詳細が利用者の直せない欄のエラーになり、送信ボタンが無効のまま残る。`applyServerFieldErrors`は、欄をまとめた値(配列でないオブジェクト)の経路と、`FormField`の`disabled`で無効にした欄の詳細を欄に付けず`onSubmitError`の`unmatched`へ渡し、`useAppForm`は検証の前に無効の欄の値を除く。無効の欄の値は`onSubmit`へ渡す値から外れ、無効になり得る欄はスキーマで任意(`.optional()`)にする。`FormField`は後から無効にした欄のエラーを消し、`useAppForm`は渡されたスキーマが変わると検証し直し、`applyServerFieldErrors`は描かれていない欄の詳細もフォーム全体の失敗にする。全欄が無効のフォームは`SubmitButton`の`disabled`で送信ボタンを無効にする。
- **決定**: 投稿欄の評価は、評価の行を描く投稿欄(投稿者本人以外のトップレベルの投稿欄と編集欄)だけスキーマの入力に含める。本文と評価の`commentWithRatingFormSchema`と本文だけの`commentFormSchema`に分け、返信の投稿欄と編集欄、投稿者本人の投稿欄と編集欄は本文だけのスキーマを使う。投稿先と編集するコメントのIDはスキーマの入力に含めず`onSubmit`で足す。返信の評価の`validation_error`(詳細`rating`)は、返信の投稿欄が評価を送らないため起きず、起きても経路がフォームの値に無く、フォーム全体の失敗として示す。
- **変えた箇所**: design.mdの`CommentThread`・`CommentMenu`・`CommentComposer`とTesting Strategyの単体テストのclientの項目、tasks.mdの7.3(フォームの形とブラウザテスト)。
