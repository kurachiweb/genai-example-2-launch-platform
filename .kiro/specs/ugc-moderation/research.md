# Research & Design Decisions

## Summary

- **Feature**: `ugc-moderation`
- **Discovery Scope**: Complex Integration(管理者側のUGC管理の実装は無い。上流の25spec(dev-tooling〜public-api)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはadmin-foundationの`requireAdmin`・`AuditLogRecorder`・`buildAuditLogStatements`・`defineAuditAction`・`ADMIN_NAV_ITEMS`・`DASHBOARD_CARDS`・`DashboardCardFrame`・管理画面の共通部品・E2Eの補助、identity-authの`UserSuspension`・`AdministrativeWithdrawal`・`USER_LIFECYCLE_SYNC_HANDLERS`・`USER_LIFECYCLE_ASYNC_HANDLERS`・`UserContactDirectory`、product-launchの`ProductVisibilityControl`・`PRODUCT_LIFECYCLE_SYNC_HANDLERS`・`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`・`ProductDirectory`、engagementの`CommentModerationControl`・`RatingModerationControl`・`CommentStore`、media-pipelineの`MediaQuarantine`・`MediaFiles`・`AdminMediaReviewPolicy`・`FILE_DOWNLOAD_RELAY_ROUTE`、user-profile-socialの`UserProfileDirectory`、match-engineの`MatchDirectory`(`summarizeDaily`・`listByLaunches`)、paymentsの決済履歴、email-deliveryの`EmailSender`の上に、管理画面・措置の記録・通知・統計を足す)
- **Key Findings**:
  - 停止・停止解除・代理の退会(identity-auth)と非公開化・復元(product-launch)の操作口は`(id, at)`だけを受け、呼び出し側の文を受け取らない。一方、両specのライフサイクルの確定は、登録された同期の処理の文を状態の変更と同じ`db.batch()`に入れる。product-launchの設計は「ugc-moderationは自分の同期の処理を登録して理由の記録を同じ一括の書き込みに含められる」と明記している。本specは要求単位の「保留中の措置」に措置の記録と監査ログの文を置き、同期の処理がイベントの対象と種類の一致を確かめて返す方式で、上流の操作口の形を変えずに記録を一体で確定する。
  - engagementの`CommentModerationControl`・`RatingModerationControl`は`statements`を受け取るため、記録の文を直接渡せる。media-pipelineの`MediaQuarantine`は文を受け取らないが、操作は冪等で、FR-ADMAG-001の列挙にも画像の操作は無い。画像の操作は操作の後に記録を書き、失敗は再実行で書き直す。
  - 管理画面の一覧(利用者・プロダクト・コメント・評価)と統計の値(利用者数・プロダクト数・収益)は、各specが「テーブルを直接読まない」と定めた表にあり、既存の照会口では足りない。engagementは「管理画面の一覧の照会はugc-moderationが`workers/engagement`へ加える」と、paymentsのbriefは「`core/payments`に集計の照会のポートを追加し、paymentsの再検証として扱う」と申し送っている。これらの照会は、2026-10-24の開発者の確定により、すべて所有するspec(identity-authの仮7・product-launchの仮13・engagementの仮6・paymentsの仮7)が所有・実装・束縛し、本specは使うだけである。
  - 停止・非公開化の波及(マッチ・Upvote・未開始のローンチ・画像の隔離と復元・索引・広告・トーナメント・Ultras)はすべて上流の処理として登録済みで、本specの非同期の処理は要らない。本specが持つ非同期の処理は、利用者・プロダクトの物理削除の時期の措置の記録の削除だけである。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を「仮」として採用した。**仮1〜仮9は2026-10-24に開発者が全て確定した(仮4・仮5・仮9は推奨と異なる選択肢)。** 決定は`requirements.md`の「要件フェーズでの仮決定」にも記録する。roadmapの「Requirement Ambiguities」の表のうち本specが担当に含まれる1行(停止・非公開化・強制終了に伴う返金の行)は、仮8で決めた。roadmapは編集せず、解決の列の文言をコントローラーへ報告する。

| #   | 論点                                       | 根拠                                                                                                                                                                                                                                                                                                                                                                      | 選択肢                                                                                                                                                                                                                                                                                              | 推奨と確定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | 統計の指標の定義と表示の期間               | FR-ADMUG-001(「週毎の合計収益・ユーザー数・プロダクト数・予選実施数・Upvote数の変化をグラフで表示」)、ページ配置(ダッシュボード=週毎の統計グラフ)、briefのApproach(集計用のクエリを日次または週次で計算)、match-engineの`summarizeDaily`(予選実施数とUpvote数の日ごとの定義)、paymentsの決済履歴の値                                                                      | (A)合計収益は週の純額(成功額 − 返金 − チャージバックの損失)、ユーザー数・プロダクト数は週の終わりの総数、予選実施数・Upvote数は週の件数・合計、直近26週と今週 / (B)ユーザー数・プロダクト数をその週の新規の件数にする / (C)合計収益を返金を引かない総額にする / (D)表示の期間を12週または52週にする | **2026-10-24に開発者が確定(推奨どおり)。** 推奨は(A)。「合計収益」は週の値であり、返金を引かない総額は運営の実態と離れる。「ユーザー数・プロダクト数の変化」は総数の推移をグラフにすると増減がそのまま読める(新規の件数は総数の差分として表の増減の列に出る)。予選実施数とUpvote数はmatch-engineの`summarizeDaily`の定義(開始した予選・確定したマッチのUpvote)をそのまま週で合計し、定義を重複させない。26週は半年で、季節の変化を1枚のカードで読める長さである。週は月曜日0:00始まり(ISO週、tournament-weekの週と同じ)                                                                                                                                                                            |
| 仮2 | 統計のグラフの描画                         | briefのConstraints(グラフ用のライブラリが必要で、新規パッケージとして候補を挙げて質問する)、tech-stack.md(質問の当時はグラフのパッケージが未採用、UIはshadcn/ui)、CLAUDE.md(workerdで動作し継続的にメンテナンスされている候補を質問する、2週間以上前の版)                                                                                                                 | (A)Recharts 3.10.1(MIT、2026-07-25公開。shadcn/uiの`chart`の部品が前提にする) / (B)visx 4.0.0(`@visx/xychart`、MIT、2026-06-11公開。`@react-spring/web`が要る) / (C)Chart.js 4.5.1(MIT、2025-10-13公開。最新の4.6.1は公開から2週間未満)とreact-chartjs-2 5.3.1 / (D)パッケージを使わずSVGで自作する | **2026-10-24に開発者が確定(推奨どおり)。** 推奨は(A)。shadcn/uiの`chart`の部品(色のトークン・凡例・ツールチップ)を使え、デザインシステムと揃う。SVGで描画し、SSRでは描画せずクライアントでだけマウントすれば、workerdのSSRの束に重い処理が入らない。(B)は依存が多く、(C)はcanvasで読み上げに弱い。(D)は軸・目盛り・ツールチップの自作の量が多い。**2026-10-24に開発者が(A)を承認して確定した。** カードは表の上にグラフを置き、同じ値の表(要件1.4)を常に表示する。tech-stack.mdへの記載(「グラフ描画」)は承認の際に追加済み                                                                                                                                                                        |
| 仮3 | ユーザー検索の照合方法                     | FR-ADMUG-004(ハンドル・ニックネーム・メールアドレス・停止状態による検索・絞り込み)、FR-ADMAG-003(メールアドレス検索の記録は結果の仮名化ID)、admin-foundationの`user.email-search`(`maxTargets` 100)、identity-authの`users.email`(未退会の中で一意、`COLLATE NOCASE`)                                                                                                     | (A)ハンドル・ニックネームは部分一致、メールアドレスは完全一致(大文字小文字を区別しない) / (B)メールアドレスも部分一致                                                                                                                                                                               | **2026-10-24に開発者が確定(推奨どおり)。** 推奨は(A)。メールアドレスの部分一致は、断片から多数の利用者のアドレスの存在を探れるため、個人情報の閲覧を必要最小限にする準拠方針の考え方に反する。完全一致なら結果は高々1件で、監査ログの対象も明確になる。ハンドル・ニックネームは公開の情報で、表記の揺れを部分一致で吸収する                                                                                                                                                                                                                                                                                                                                                                        |
| 仮4 | 運営者による代理の退会の起点・本人の確かめ | briefのDesired Outcome(セッションが切れた停止中の利用者などから問い合わせで依頼を受けて行う、問い合わせからの導線もこのspecが持つ)、identity-authの仮5・N-6(本人の確かめ・権限・監査は呼び出し側)、inquiry-chatのQ1(停止中の利用者の依頼は未ログインの問い合わせとして届く)・問い合わせの詳細の操作の登録口の文脈(未ログインの連絡先メールアドレス)、admin-foundationのQ3 | (A)問い合わせの詳細からだけ行い、未ログインは連絡先メールアドレスで照合し、システム外のメールで意思を確かめたことの確認を必須にする。モデレーター以上 / (B)ユーザー一覧からも行える / (C)最上位管理者だけが行える                                                                                   | **2026-10-24に開発者が確定(推奨と異なる選択肢: 代理の退会は最上位管理者だけが行え、起点はユーザー一覧だけ。問い合わせの詳細からの導線と本人の意思の確認の確認欄は設けず、理由は必須のまま)。** 当初の推奨は(A)。退会は取り消せず本人確認も無いため、依頼の記録(問い合わせ)に結び付けて行うのが取り違えと濫用を防ぐ。未ログインの問い合わせは誰でも任意のアドレスで送れるため、アドレスの一致だけでは本人と言えず、運営者がその連絡先へシステム外のメールで返信して意思を確かめる(未ログインの問い合わせへの返信はシステム外のメール、inquiry-chat)。ログインの問い合わせはセッションで本人が送ったものである。admin-foundationのQ3は、要件が最上位管理者に限っていない更新操作をモデレーターに許す |
| 仮5 | 代理の退会の完了の知らせ                   | identity-authのOut of Boundary(利用者への連絡はugc-moderation)、`UserContactDirectory.findContact`(退会済みは`undefined`)、identity-authのメール種別(退会の完了の種別は無い)                                                                                                                                                                                              | (A)退会の直前に宛先を引き、完了をメールで知らせる(送信の失敗は再送しない) / (B)メールを送らず、運営者がシステム外のメールで知らせる                                                                                                                                                                 | **2026-10-24に開発者が確定(推奨と異なる選択肢(B): メールを送らず、運営者がシステムの外のメールで知らせる)。** 当初の推奨は(A)。ログインの問い合わせの利用者は退会後にチャットを読めず、システム外の返信の宛先も無い。退会の後は宛先を引けないため送り直しはできないが、送信の依頼はQueue越しで失敗は稀であり、失敗はエラートラッキングで検知して運営者が個別に知らせる                                                                                                                                                                                                                                                                                                                             |
| 仮6 | プロダクト一覧の絞り込みの値               | FR-ADMUG-007(ローンチ状態・公開状態による絞り込み)、product-launchの`LaunchStatus`(`scheduled`・`paired`・`in_progress`・`finished`・`canceled`)と`outcome`、`products.latest_launch_date`、可視性の条件(`hidden_at`・`visibleUsers()`)                                                                                                                                   | (A)ローンチ状態は最新のローンチの状態(予約中・予選マッチ中・勝利・敗北・取消)、公開状態は公開中・非公開化中・投稿者が停止中 / (B)ローンチ状態をディレクトリ掲載中かどうかの2値                                                                                                                      | **2026-10-24に開発者が確定(推奨どおり)。** 推奨は(A)。product-launchが導く状態の値と1対1で対応し、利用者側の「自分のプロダクト」の状態表示と同じ語で探せる。掲載中かどうかは、勝利したローンチの有無として公開状態と組み合わせて読める                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 仮7 | 画像のモデレーションの監査ログ             | FR-ADMAG-001(画像の操作FR-ADMUG-017・049は列挙に無い)、admin-foundationのQ6(記録範囲は列挙どおり)、FR-ADMUG-017(公開拒否は削除で取り消せない)                                                                                                                                                                                                                             | (A)公開承認・公開拒否(削除)・個別の隔離・隔離の解除を任意の理由とともに記録する / (B)記録しない                                                                                                                                                                                                     | **2026-10-24に開発者が確定(推奨どおり)。** 推奨は(A)。削除は取り消せず、公開承認は不適切な画像を公開に戻す判断であり、誰が判断したかを残す価値が高い。列挙の外の記録を足しても要件に反しない(admin-foundationのQ6は理由の必須の範囲を定めたもので、記録の追加を禁じない)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 仮8 | 停止・非公開化に伴う返金                   | 法的通知の大枠の返金ポリシー(停止・非公開化に伴うトーナメント参加資格停止・広告の表示停止は返金する)、FR-ADMUG-045(返金目安額の表示まで)、FR-PPLAN-012、paymentsのQ1、sponsorshipの仮3、tournament-weekの仮2・仮3、tournament-yearの仮3・仮4、ultras-subscriptionのQ3、roadmapのRequirement Ambiguities                                                                   | (A)本機能は返金を依頼せず、各specの決定(トーナメント参加費は組み合わせ決定の時点で自動返金、広告とUltrasは返金しない)に従い、通知メールで伝える / (B)措置の時点で本機能が`PaymentRefunds`で返金を依頼する                                                                                           | **2026-10-24に開発者が確定(推奨どおり)。ただしsponsorshipの仮3は推奨と異なる選択肢で確定し、停止・非公開化による表示停止は停止した日数分、強制終了は未掲載日数分の広告料金を自動で日割り返金する。本機能は返金を依頼せず、通知の文面をこれに合わせた。** 当初の推奨は(A)。返金の要否は権利を持つspecが判断済みで、本機能が重ねて依頼すると二重の返金や、組み合わせ決定の前に復元された場合の誤った返金になる。返金ポリシーの各行は各specが改める(トーナメントはtournament-week・tournament-year、広告はsponsorship、Ultrasはultras-subscription)。本機能は通知の文面で扱いを伝えるだけにする                                                                                                       |
| 仮9 | 措置の取り消しの理由                       | FR-ADMUG-006(「理由付きで停止/停止解除」)、FR-ADMUG-009・013(「理由付きで非公開化し、また非公開化を取り消して復元」)、FR-ADMUG-014(「理由付きで無効化し、また無効化を取り消せる」)、admin-foundationのQ6(理由付き操作だけ必須)                                                                                                                                            | (A)停止解除は必須、復元と無効化の取り消しは任意 / (B)すべての取り消しで必須                                                                                                                                                                                                                         | **2026-10-24に開発者が確定(推奨と異なる選択肢(B): 停止解除・復元・無効化の取り消しはすべて理由を必須とする)。** 当初の推奨は(A)。FR-ADMUG-006は停止解除にも「理由付き」が掛かると読めるが、FR-ADMUG-009・013・014は「理由付き」が非公開化・無効化にだけ掛かる文の形である。admin-foundationのQ6の「理由付き操作だけ必須」に合わせる                                                                                                                                                                                                                                                                                                                                                                |

### 確認済みのため質問しない事項

- 統計の置き場所: 独立したページを作らず、ダッシュボードのカード`{ id: 'ugc-moderation.weekly-statistics', order: 10, width: 'full' }`とする(admin-foundationのQ2、brief)。
- メニューのURLと`order`: ユーザー`/users`(20)・プロダクト`/products`(30)・コメント`/comments`(40)・評価`/ratings`(50)・画像モデレーション`/media-moderation`(60)(admin-foundationの仮6、承認済み)。
- ロール: 全ロールが全メニューを参照でき、モデレーターは要件が最上位管理者に限っていない更新操作をすべて行える(admin-foundationのQ3)。本specの措置は全てモデレーター以上、照会は閲覧のみ以上。
- 監査ログの形: 操作種別は`<対象の領域>.<動詞句>`、要件が「理由付き」とする操作は`reason: 'required'`、対象が利用者なら仮名化ID、メールアドレス検索は`user.email-search`(admin-foundationの所有、検索文字列を持たない、`maxTargets` 100)(admin-foundationのQ6・FR-ADMAG-002・003)。
- 停止中の利用者の退会: 受け付ける(identity-authの仮5)。代理の退会は`AdministrativeWithdrawal`で、利用者本人の退会と同じ確定の処理を通る。
- 停止・非公開化の波及: マッチの即時の終了と開始時点の決着・Upvoteの論理削除(match-engine)、未開始のローンチの取り消し(product-launchの`launch-cancellation`と非公開化の確定)、画像の隔離と復元(user-profile-socialの`owned-image-quarantine` 600、product-launchの`image-quarantine` 1000)、索引(directory-discovery 1200)、広告(sponsorshipの表示の条件)、トーナメント(tournament-week・tournament-yearの組み合わせ決定の分類)、Ultras(ultras-subscriptionの期間末の解約)。各specの申し送りは「ugc-moderationはライフサイクルを発火すればよく、本specを直接呼ばない」で一致する。
- 隔離画像の表示: SW-012の画像配信を使わず、SW-011と同じ方式(media-pipelineの`/_bff/files/<fileId>`の中継と`/internal/media/files/:fileId`)で、media-pipelineの`AdminMediaReviewPolicy`(既定は全拒否)を本specが管理者の判定で差し替える(FR-ADMUG-018、media-pipelineの申し送り)。
- 評価の無効化の通知: 通知しない(engagementの仮3、FR-ADMUG-030の対象に評価が無い)。
- 通知の宛先: identity-authの`UserContactDirectory`で引き、停止中の利用者にも届く(brief)。
- 4:21のジョブと波及処理の`order`: 本specの1900番台。上流の値より前に動く必要のある処理は無い(統計は当日の4:21の時点の値で足り、他のジョブの結果に依存しない)。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する。

## 要件のレビュー(2026-10-24)

- 機械的な確認: 16の要件の見出しがすべて数字のIDを持ち、受け入れ基準がすべてEARSの形式(`When`・`If`・`While`・`Where`・`The … shall`)である。技術名は要件定義書の用語(仮名化ID・バケット)、外部リンクの`rel`の値と日時の`<time datetime>`(サービス仕様の規則)、URL(admin-foundationの仮6)、仮2のパッケージ名だけに限った。
- 判断のレビューで、境界になりやすい振る舞い(既に同じ状態のときに記録を残さないこと(4.7・8.7・9.9・10.8)、記録の一体の確定(13.4)、画像の操作で非公開化・停止の隔離理由を解除しないこと(11.12)、通知の送り直しの重複の防止(12.8)、代理の退会の本人の確かめ(5.6・5.7))が受け入れ基準にあることを確かめ、問題は無かった。要件定義書・サービス仕様で決まらない論点は仮1〜仮9として記録し、要件の範囲の推測は加えていない。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(ユーザーライフサイクルイベント・プロダクトライフサイクルイベント・可視性フィルタ・画面シェル・利用者の連絡先の照会・隔離バケットと隔離理由・監査ログ・E2Eの管理者ログイン・ユーザーのファイルの波及処理)。
- **Sources Consulted**: admin-foundation・identity-auth・product-launch・engagement・media-pipeline・user-profile-social・match-engine・inquiry-chat・payments・sponsorship・tournament-week・tournament-year・ultras-subscription・directory-discovery・email-deliveryの`design.md`と、各specの`research.md`の後続specへの申し送り(「ugc-moderation」を含む全ての行)、要件定義書の4.21・4.22、サービス仕様(ページ配置・文言規則・準拠方針・法的通知の大枠)。
- **Findings**:
  - admin-foundation: `requireAdmin(context, minimum)`(`viewer`・`moderator`・`super_admin`)、`AuditLogRecorder.prepare`・`record`、`buildAuditLogStatements(db, entry)`(apiの`infrastructure/admin`)、`defineAuditAction`(`targetKind`に`user`・`product`・`comment`・`rating`・`image`がある)、`user.email-search`(`maxTargets` 100、理由なし)、`ADMIN_NAV_ITEMS`(仮6のURLと`order`)、`DASHBOARD_CARDS`(本specは10)、`DashboardCardFrame`、`ConfirmActionDialog`(`reason`・`audited`)、`AdminDataTable`・`AdminFilterBar`・`ReasonField`・`AdminAvatar`、`RoleGate`・`useAdminRole`、`AdminDirectory.findProfiles`(有効な管理者だけ)、E2Eの`signInAsNewAdmin`・`executeLocalD1`。Q3により全ロールが全メニューを参照し、モデレーターは要件が最上位管理者に限っていない更新操作を行える。
  - identity-auth: `UserSuspension.suspend(userId, at)`・`unsuspend`(`changed`・`unchanged`、退会済み・不在は`not_found`)、`AdministrativeWithdrawal.withdraw({ userId, caller, operator, at })`(管理者側の呼び出し元と管理者の主体だけ、本人の退会と同じ`commitWithdrawal`)、`UserLifecycleCommitter`の一括の書き込みの並び(イベント→状態→自分の文→同期の処理の文)、`USER_LIFECYCLE_SYNC_HANDLERS`・`USER_LIFECYCLE_ASYNC_HANDLERS`、`UserContactDirectory.findContact`(停止中は返し、退会済みは`undefined`)、`users`の列(`pseudonymous_id`・`disposable_email_status`・`status`・`suspended_at`・`deleted_at`)。「本人の確かめ・権限・監査ログ・利用者への連絡は呼び出し側(ugc-moderation)」(N-6)。
  - product-launch: `ProductVisibilityControl.hide(productId, at)`・`unhide`(`changed`・`unchanged`)、非公開化の確定が未開始のローンチの取り消しを含み、復元で戻さないこと、`PRODUCT_LIFECYCLE_SYNC_HANDLERS`(「ugc-moderationは自分の同期の処理を登録して理由の記録を同じ一括の書き込みに含められる」)、`product-launch.image-quarantine`(1000)、`ProductDirectory`(`findSummaries`の`not-deleted`・`findDetail`・`listLaunches`・`resolveHandle`)。後続specは`products`を結合しない規則。
  - engagement: `CommentModerationControl.hide({ commentId, at, statements })`・`RatingModerationControl.invalidate(...)`、`CommentStore.findByIds`、`RatingStore.summaries`、仮3(無効化は本人に知らせない)、「管理画面のコメントの一覧と評価の一覧の照会はugc-moderationが`workers/engagement`へ加える」。
  - media-pipeline: `MediaQuarantine.addReason`・`removeReason`(理由を確定してから移動を依頼、失敗は`unavailable`)・`listByReason`(1〜100件、検出内容付き)、`MediaFiles.findMany`・`eraseNow`、`QuarantineReason`(`auto`・`product_hidden`・`user_suspended`・`admin_action`)、`desiredLocation`(全理由が解消したら画像用バケット)、`AdminMediaReviewPolicy`(既定は全拒否で、ugc-moderationが差し替える)、`/_bff/files/<id>`の中継(admin・clientに登録済み)、代替の判定(99×99は不適切)。
  - user-profile-social: `owned-image-quarantine`(`suspended`・`unsuspended`、600)が保有者の全画像に`user_suspended`を付け外しする。`UserProfileDirectory.findSummaries`(`avatarFileId`)・`resolveHandle`。
  - match-engine: `MatchDirectory.summarizeDaily({ from, to })`(日ごとの予選実施数とUpvote数、366日まで)・`listByLaunches`。停止・非公開化はライフサイクルで発火すれば即時の終了と開始時点の決着が行われる。
  - inquiry-chat: 問い合わせの詳細の操作の登録口と、停止中の利用者の依頼は未ログインの問い合わせとして届くこと(Q1)を確かめた。仮4の確定(2026-10-24)により、本specは問い合わせの詳細に操作を加えず、問い合わせの照会も使わない。
  - payments: 決済履歴は`payment_records`(`kind`・`purpose`・`status`・負の`amount`)で、テーブルを直接読まない規則。briefの申し送りは「`core/payments`に集計の照会のポートを追加」。
  - sponsorship・tournament-week・tournament-year・ultras-subscription・directory-discovery: いずれも「ugc-moderationはライフサイクルを発火すればよく、本specを直接呼ばない」。返金はsponsorshipの仮3・tournament-weekの仮2と仮3・tournament-yearの仮3と仮4・ultras-subscriptionのQ3で決定済み。通知の文面で返金の扱いを伝えるよう申し送りがある(tournament-week・ultras-subscription)。
- **Implications**: 波及処理を作らず、上流の操作口と登録口だけで連鎖させる。記録の一体の確定と、管理画面の一覧と統計の照会の2点だけ、上流の形に合わせた仕組みか上流の公開の照会が要る(問い合わせの対象の確かめは、仮4の確定で不要になった)。

### 記録の一体の確定

- **Context**: FR-ADMAG-001、admin-foundationの規約(管理操作の文と`buildAuditLogStatements`を同じ一括の書き込みにする)、上流の操作口の形。
- **Findings**: `UserSuspension`・`AdministrativeWithdrawal`・`ProductVisibilityControl`は呼び出し側の文を受け取らない。両ライフサイクルの確定は、処理単位のコンテナから解決した同期の処理の文を状態の変更と同じ`db.batch()`に入れ、条件の違反で全体を取り消す。backend-platformのコンテナは処理単位(HTTPの要求ごと)である。
- **Implications**: 処理単位で1つの`PendingModerationRecord`に措置の記録と準備済みの監査ログを置き、同期の処理がイベントの種類と対象の一致で取り出して文を返す。措置でないイベント(本人の退会など)では何も返さない。上流の形は変えない。取り出し漏れ(束縛の誤り)は`captureEvent`で検知する。

### 管理画面の一覧と統計の照会

- **Context**: FR-ADMUG-004・007・008・012・014、FR-ADMUG-001、各specの「テーブルを直接読まない」規則。
- **Findings**: 既存の照会は、IDの一括の照会(`findSummaries`・`findByIds`)や公開の表示用で、管理画面の検索・絞り込み・ページ分けと、時点の総数・期間の収益を返すものが無い。engagementとpaymentsは本specによる追加を申し送っている。identity-auth・product-launch・inquiry-chatには申し送りが無いが、同じ扱い(所有するspecのディレクトリへの読み取りだけの追加と再検証)が規則に最も沿う。
- **Implications**: `AdminUserDirectory`・`AdminProductDirectory`・`AdminCommentDirectory`・`AdminRatingDirectory`・`PaymentRevenueReport`は、所有するspec(identity-authの仮7・product-launchの仮13・engagementの仮6・paymentsの仮7)が実装・束縛し、上流のテーブルの列の解釈は上流の部品の中に閉じる(2026-10-24に開発者が確定)。本specは使うだけで、形(シグネチャ)の写しをdesign.mdに残す。問い合わせの依頼者の照会(inquiry-chatの仮7)は、仮4の確定で代理の退会の起点がユーザー一覧だけになったため取り下げられた。

### 通知と送り直し

- **Context**: FR-ADMUG-030、paymentsとsponsorshipの依頼待ちの記録、`UserContactDirectory`の退会済みの扱い。
- **Findings**: 停止・非公開化の通知は、措置の確定の後に送れば良く、確定と同じ書き込みに入れる必要は無い。送信の依頼の失敗に備えて記録に`pending`を残し、日次で送り直す形が上流と同じである。代理の退会は退会の後に宛先を引けない。
- **Implications**: 措置の記録の`notice_status`を`pending`→`requested`・`skipped`へ条件付きで進める。代理の退会はメールを送らない(仮5、2026-10-24に確定)。

### 統計

- **Context**: FR-ADMUG-001、briefのApproach、仮1・仮2、match-engineの`summarizeDaily`。
- **Findings**: 予選実施数とUpvote数はmatch-engineが日ごとに集計でき、利用者数とプロダクト数は`created_at`・`deleted_at`から時点の総数を求められる(物理削除の前の4:21なら週の終わりの値と一致する)。収益は決済履歴の純額。表示のたびの集計は避け、週の行に保存する。
- **Implications**: 4:21のジョブ(1900)が今週と前週を集計し、前週を確定する。表示は行を読むだけ。グラフはRecharts(仮2、確定)で描き、同じ値の表を読み上げの正とする。

## Architecture Pattern Evaluation

| Option                                       | Description                                                              | Strengths                                                      | Risks / Limitations                                                | Notes                                   |
| -------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| 要求単位の保留中の措置+同期の処理(採用)      | 上流の確定の一括の書き込みに、同期の処理として記録と監査ログの文を載せる | 上流の形を変えずに一体の確定。product-launchの設計の想定どおり | 同期の処理が処理単位のコンテナから解決されることに依存する         | 取り出し漏れを`captureEvent`で検知      |
| 上流の操作口に`statements`を足す             | `UserSuspension`などの引数を変える                                       | 明示的                                                         | 上流3specの契約の変更と再検証、identity-authの承認済みの形を変える | 不採用                                  |
| 操作の後に別の書き込みで記録                 | 状態の変更の後に監査ログを単独で書く                                     | 単純                                                           | 記録の欠落・状態だけの変更が残る(admin-foundationの規約に反する)   | 画像の操作だけ採用(冪等で列挙の外)      |
| 措置ごとのライフサイクルの非同期の処理で通知 | eventで`suspended`・`hidden`を受けて送る                                 | 実行器の再試行を使える                                         | コメントの通知は別の仕組みが要り、2系統になる                      | 不採用(1系統の依頼待ちと日次の送り直し) |

## Design Decisions

### Decision: 措置の記録は上流のライフサイクルの同期の処理として確定する

- **Context**: FR-ADMAG-001、admin-foundationの`backend/008`の規約。
- **Alternatives Considered**:
  1. 上流の操作口に呼び出し側の文の引数を足す
  2. 要求単位の保留中の措置と同期の処理
  3. 状態の変更の後に記録を別に書く
- **Selected Approach**: 2。`PendingModerationRecord`(処理単位で1つ)に置き、`ugc-moderation.user-moderation-record`・`ugc-moderation.product-moderation-record`がイベントの種類と対象の一致で取り出す。コメント・評価は上流の`statements`、画像は操作の後の単独の書き込み。
- **Rationale**: 上流の承認済みの契約を変えず、product-launchが想定した使い方に沿う。
- **Trade-offs**: 同期の処理の解決の規則に依存する。Revalidation Triggersに挙げ、Workers統合テストで本物の確定を通して確かめる。
- **Follow-up**: 本人の退会で記録が作られないこと、版の競合で記録が残らないことをWorkers統合テストで確かめる。

### Decision: 管理画面の一覧と統計の照会は所有するspecが提供する

- **Context**: 各specのテーブルの直接の読み取りの禁止、engagement・paymentsの申し送り。
- **Selected Approach**: 5つの照会(`AdminUserDirectory`・`AdminProductDirectory`・`AdminCommentDirectory`・`AdminRatingDirectory`・`PaymentRevenueReport`)は、所有するspec(identity-authの仮7・product-launchの仮13・engagementの仮6・paymentsの仮7)が上流のディレクトリに実装し、上流のプラットフォームモジュールで束縛する(2026-10-24に開発者が確定)。本specは使うだけで、各specのタスクの完了を本specのタスクの前提にする。
- **Rationale**: テーブルの列の解釈を所有者の部品の中に閉じ、所有者の再検証で整合を保てる。
- **Trade-offs**: 上流4specの公開の契約が増える。形(シグネチャ)は本specのdesign.mdの写しと同じにそろえ、上流が変えるときはRevalidation Triggersに従って確かめ直す。

### Decision: 統計は日次のジョブで週の行に保存し、確定した週を変えない

- **Context**: FR-ADMUG-001、briefのApproach、仮1。
- **Selected Approach**: `moderation_weekly_statistics`に週ごとの5値と確定の印を持ち、4:21に今週と前週を集計する。
- **Rationale**: 表示は数行の読み取りで済み、物理削除で消える利用者・プロダクトがあっても過去の週の値が変わらない。
- **Trade-offs**: ジョブが1週間以上止まると間の週が欠ける。過去の週を遡って作る処理は、物理削除の後は正確に求められないため設けない。

### Decision: 代理の退会は最上位管理者がユーザー一覧からだけ行い、サーバーで対象を確かめる(仮4、2026-10-24に確定)

- **Selected Approach**: ユーザー一覧の項目の操作から、最上位管理者だけが理由を入力して行う。サーバーは利用者のIDで対象を読み直す。問い合わせの詳細からの導線・依頼者の照会・本人の意思の確認の確認欄は設けず、依頼の受け付け・本人の意思の確かめ・完了の知らせは運営者がシステムの外のメールで行う(仮5)。
- **Rationale**: 開発者の決定。取り消せない操作を最も強いロールに限り、依頼の受け付けと本人の確かめはシステムの外の運用に任せる。

### Decision: 隔離画像の表示はmedia-pipelineの中継と閲覧の判定を使う

- **Selected Approach**: `AdminRoleMediaReviewPolicy`で有効な管理者だけに画像用の用途のファイルを許し、管理画面は`/_bff/files/<id>`を`<img>`で表示する。公開中の画像も同じ経路で表示し、表示の仕組みを1つにする。
- **Rationale**: FR-ADMUG-018・SW-011の方式どおりで、新しい経路を作らない。

### Decision: 採らなかった案

- 停止・非公開化の時点で本機能が返金を依頼する: 権利を持つspecの決定と二重になる(仮8)。
- 統計の独立したページ: admin-foundationのQ2で不採用。
- 画像の操作を投稿者へ通知する: FR-ADMUG-030の対象外。
- 問い合わせの詳細からの代理の退会と本人の意思の確認の確認欄、代理の退会の完了のメール: 開発者が採らなかった(仮4・仮5)。

## Synthesis

- **Generalization**: 停止・非公開化・コメント・評価・画像の措置は「検証→対象の確認→上流の操作→記録と監査ログの一体の確定→通知」の同じ形で、違いは上流の操作口と記録の載せ方(同期の処理・`statements`・単独)だけである。共通の`ModerationCommand`・`ModerationOutcome`と`ModerationStatements`で表し、後続のcontent-reportingも同じ口から使える。一般の問題として「他の集約の状態遷移と一体で管理操作を記録する方式」を`backend/021`、「週ごとの集計のスナップショット」を`db/008`、「管理画面の検索条件の保持と措置の確認」を`frontend/020`に記す。
- **Build vs. Adopt**: 認可・監査ログ・メニュー・カード・表・確認のダイアログ・画像の中継と隔離・メール・ライフサイクルは上流の部品を使う。グラフは自作せずRechartsを使う(仮2、確定)。検索は新しい索引や全文検索を作らず、部分一致の問い合わせで足りる(管理者だけが使う)。
- **Simplification**: 波及処理・新しいメッセージ種別・Cronの式・措置の取り消しの通知を作らない。措置の記録は1テーブルで、最新の理由の表示・通知の送り直し・削除を兼ねる。統計の過去の週の遡りの集計を作らない。

## Risks & Mitigations

- 同期の処理が処理単位のコンテナから解決されない(上流の実装の差) — Workers統合テストで本物の`UserSuspension`・`ProductVisibilityControl`を通して確かめ、取り出し漏れを`captureEvent`で検知する。外れた場合は上流の操作口への`statements`の追加を上流specへ依頼する(代替案)。
- 部分一致の検索が利用者・プロダクトの増加で遅くなる — 1ページ50件とカーソルで抑え、launch-readinessの性能の検証で全文検索や前方一致への切り替えを判断する。
- 統計のジョブの停止で週が欠ける — `ModerationIncidentReporter`(infrastructure層が`captureEvent`で送る)で検知し、欠けた週は表に出さない(値を推測しない)。
- 代理の退会の取り違え — 最上位管理者だけに限り、理由を必須にし、監査ログで追跡する。本人の意思の確かめはシステムの外の運用で行う(仮4)。
- 管理者側のCSPが同一オリジンの画像を許さない — タスクで確かめ、必要ならfrontend-platformへ`img-src 'self'`を依頼する。
- 通知メールの二重の依頼 — `EmailSendRequest`に冪等のキーが無いため、送信の成功の後に`markNotice(pending→requested)`が失敗した場合に限り、日次の送り直しで同じ措置の通知を2回依頼し得る(要件12.8の例外)。状態の更新は送信の直後の1文の条件付きの更新にして失敗の窓を狭め、発生は`notice-redispatch-failed`とは別に警告のログで追えるようにする(2026-11-20の実装前のギャップ分析の局所的な修正の18)。

## References

- `docs/requirements/README.md` — 4.21(FR-ADMUG-001・004〜014・017・018・030・047〜050)、4.22(FR-ADMAG-001〜003)、FR-USER-014、FR-VOTE-008、FR-COMNT-007、FR-RATNG-009、FR-SPONS-020、FR-PPLAN-012、SW-011・012・023
- `docs/GUIDES/service/design/002-page-layouts.md` — 管理者側ページ一覧、メールアドレス検索の注記
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — 理由の上限、通知メールの件名と本文の構成
- `docs/GUIDES/service/legal/001-compliance-policy.md` — データ保持期間、モデレーションと透明性
- `docs/GUIDES/service/legal/004-legal-notice-outline.md` — 返金ポリシー
- 上流specの`design.md`・`research.md`(Research Logの一覧)
- Recharts(npm、3.10.1、2026-07-25公開、MIT)・visx(4.0.0、2026-06-11公開)・Chart.js(4.5.1、2025-10-13公開。4.6.1は2026-10-22公開で2週間未満)・react-chartjs-2(5.3.1) — npmレジストリで版と公開日を確かめた(2026-10-24)

## 仮決定(2026-10-24に開発者が全て確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。**仮1〜仮9は2026-10-24に開発者が全て確定した。仮4・仮5・仮9は推奨と異なる選択肢が選ばれ、要件・設計・タスクをその決定に合わせた。** `requirements.md`の「要件フェーズでの仮決定」にも同じ行がある。

| #   | 論点                         | 確定した案                                                                                                                                   | 他の選択肢                                                                           | 影響する箇所                                                                                                                 |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | 統計の定義と期間             | 純収益・週の終わりの総数・週の件数、26週と今週(確定、推奨どおり)                                                                             | 新規の件数 / 総額 / 12週・52週                                                       | 要件1.2・2.2〜2.4、`WeeklyStatisticsJob`・`PaymentRevenueReport`・`countRegisteredAt`                                        |
| 仮2 | グラフのパッケージ           | Recharts 3.10.1または3系の最新の安定版(2026-10-24に確定)                                                                                     | visx / Chart.js / 自作                                                               | 要件1.2、`WeeklyStatisticsChart`・tech-stack.md                                                                              |
| 仮3 | ユーザー検索の照合           | ハンドル・ニックネームは部分一致、メールアドレスは完全一致(確定、推奨どおり)                                                                 | メールアドレスも部分一致                                                             | 要件3.4、`AdminUserDirectory.search`                                                                                         |
| 仮4 | 代理の退会の起点と本人の確認 | 最上位管理者だけ、ユーザー一覧からだけ、本人の意思の確認の確認欄なし、理由は必須(確定、推奨と異なる)                                         | 問い合わせの詳細からだけ・未ログインは本人の確認を必須・モデレーター以上(当初の推奨) | 要件5.1〜5.13・14.2、`AdministrativeWithdrawalService`・`AdministrativeWithdrawalAction`                                     |
| 仮5 | 代理の退会の知らせ           | メールを送らず、運営者がシステムの外のメールで知らせる(確定、推奨と異なる)                                                                   | 退会の前に宛先を引いて1回だけ送る(当初の推奨)                                        | 要件5.3・5.9、メール種別を3つにした                                                                                          |
| 仮6 | プロダクトの絞り込みの値     | 最新のローンチの状態5値、公開状態3値(確定、推奨どおり)                                                                                       | 掲載中かどうかの2値                                                                  | 要件6.3、`AdminProductDirectory`                                                                                             |
| 仮7 | 画像の操作の監査ログ         | 公開承認・公開拒否(削除)・個別の隔離・隔離の解除を記録(確定、推奨どおり)                                                                     | 記録しない                                                                           | 要件11.13、`ModerationAuditActions`・`ImageModerationService`                                                                |
| 仮8 | 停止・非公開化に伴う返金     | 本機能は返金を依頼せず各specの決定に従い、通知で伝える(確定、推奨どおり。広告はsponsorshipの仮3の確定により停止した日数分を自動で日割り返金) | 本機能が返金を依頼する                                                               | 要件12.4・12.5、通知のテンプレート                                                                                           |
| 仮9 | 取り消しの理由               | 停止解除・復元・無効化の取り消しはすべて理由を必須(確定、推奨と異なる)                                                                       | 停止解除だけ必須(当初の推奨)                                                         | 要件4.3・8.3・8.9・9.7・10.5、`MODERATION_ACTION_DEFINITIONS`・GraphQLの`unhideProduct`・`unhideComment`・`revalidateRating` |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID                      | 内容                                                                                                                                                                                                         | 根拠     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| FR-ADMUG-001                | 合計収益を週の純額(返金とチャージバックの損失を差し引く)、ユーザー数・プロダクト数を週の終わりの総数、予選実施数とUpvote数を週の件数と定義する                                                               | 仮1      |
| FR-ADMUG-004                | メールアドレスの検索を完全一致とする旨を加える                                                                                                                                                               | 仮3      |
| FR-ADMUG-006(または4.1)     | 運営者による代理の退会(最上位管理者だけがユーザー一覧から理由を付けて行い、本人の意思の確かめと退会の完了の知らせはシステムの外のメールで行う)と、その監査ログの記録を加える                                 | 仮4・仮5 |
| FR-ADMUG-007                | ローンチ状態を最新のローンチの状態、公開状態を公開中・非公開化中・投稿者が停止中とする旨を加える                                                                                                             | 仮6      |
| FR-ADMAG-001                | 画像の公開承認・公開拒否・個別の隔離・隔離の解除(FR-ADMUG-017・049)と、運営者による代理の退会を列挙に加える                                                                                                  | 仮4・仮7 |
| FR-ADMUG-006・009・013・014 | 措置の取り消し(停止解除・プロダクトとコメントの復元・評価の無効化の取り消し)にも理由を必須とする旨を明記する                                                                                                 | 仮9      |
| FR-ADMUG-030                | 停止・非公開化の通知に、広告の表示を停止した日数分の自動の日割り返金とトーナメント参加費の扱いを伝える旨を加える(返金そのものの改訂はsponsorshipのFR-ADMUG-045・FR-PYMNT-006・012・FR-SPONS-020の報告による) | 仮8      |

## 上流・後続specへの影響

- identity-auth(上流): `AdminUserDirectory`(`search(filter, page)`・`findByIds(userIds)`・`findByEmail(email)`・`countRegisteredAt(at)`)・`D1AdminUserDirectory`・`IDENTITY_PLATFORM_TYPES.AdminUserDirectory`はidentity-authの仮7が`apps/backend-lib/workers/identity/admin-user-directory.ts`に実装し、`IDENTITY_PLATFORM_MODULE`で束縛する(本specは使うだけ。形は本specのdesign.mdの写しと同じ)。登録: apiの`USER_LIFECYCLE_SYNC_HANDLERS`に`ugc-moderation.user-moderation-record`(`suspended`・`unsuspended`・`withdrawn`)、eventの`USER_LIFECYCLE_ASYNC_HANDLERS`に`ugc-moderation.account-record-erasure`(`purge_due`、1900)。`UserSuspension`・`AdministrativeWithdrawal`・`UserContactDirectory`を使う。
- product-launch(上流): `AdminProductDirectory`(`search(filter, page, now)`・`countRegisteredAt(at)`)・`D1AdminProductDirectory`・`PRODUCT_PLATFORM_TYPES.AdminProductDirectory`はproduct-launchの仮13が`apps/backend-lib/workers/product/admin-product-directory.ts`に実装し、`PRODUCT_PLATFORM_MODULE`で束縛する(本specは使うだけ)。登録: apiの`PRODUCT_LIFECYCLE_SYNC_HANDLERS`に`ugc-moderation.product-moderation-record`(`hidden`・`unhidden`、`handler`は`MODERATION_TYPES.ProductModerationRecordSyncHandler`)、eventの`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`に`ugc-moderation.product-record-erasure`(`purge_due`、1900)。`PRODUCT_SAVE_HOOKS`は使わない(非公開化・復元はライフサイクルで伝わるため)。
- engagement(上流): `AdminCommentDirectory`(`search(filter: AdminCommentSearchFilter, page: { after?: string; limit: number }): Promise<{ comments: readonly AdminCommentRecord[]; nextCursor: string | null }>`)・`AdminRatingDirectory`(`search(filter: { productId?: string; userId?: string; state?: AdminRatingState }, page): Promise<{ ratings: readonly AdminRatingRecord[]; nextCursor: string | null }>`・`findByIds(ratingIds: readonly string[]): Promise<ReadonlyMap<string, AdminRatingRecord>>`)は、engagementの仮6が`apps/backend-lib/workers/engagement/admin-comment-directory.ts`・`admin-rating-directory.ts`に実装し、`ENGAGEMENT_PLATFORM_TYPES`・`ENGAGEMENT_PLATFORM_MODULE`で束縛する(2026-10-24に開発者が確定。本specは使うだけ。形は本specのdesign.mdの写しと同じ)。
- payments(上流): `RevenuePeriod`(`{ from: Date; to: Date }`)・`PaymentRevenueReport`(`netRevenue(periods: readonly RevenuePeriod[]): Promise<readonly MinorUnitAmount[]>`)は、paymentsの仮7が`apps/backend-lib/core/payments/ports.ts`・`identifiers.ts`の`PAYMENTS_TYPES.PaymentRevenueReport`・`workers/payments/d1-payment-revenue-report.ts`に実装し、`createPaymentsPlatformModule(<アプリ名>)`(モジュール名`payments-platform`)で束縛する(2026-10-24に開発者が確定、paymentsのタスク5.5・5.7。本specは使うだけ。純収益の定義はpaymentsの要件12.10を正とし、敗北が確定したチャージバックは負の額の`disputed`の行を`dispute_lost`の期間で差し引く。統計の群)。返金は依頼しない(仮8)。
- inquiry-chat(上流): 変更を求めない。仮7(問い合わせの依頼者の照会)は、本specの仮4の確定(代理の退会の起点はユーザー一覧だけ)で取り下げられ、問い合わせの詳細の操作の登録口への本specの登録(`order` 10)も無くなった。inquiry-chatの設計とタスクは、代理の退会をユーザー一覧から行う記述に直っている(2026-10-24に反映済みを確かめた)。
- media-pipeline(上流): apiの`composition/media-review-policy.ts`の`AdminMediaReviewPolicy`の束縛を`AdminRoleMediaReviewPolicy`へ差し替える(契約どおり)。`MediaQuarantine`・`MediaFiles`を使う。
- admin-foundation(上流): `audit-actions/ugc-moderation.ts`と連結(13種、詳細の鍵はすべて空)、`ADMIN_NAV_ITEMS`に5件、`DASHBOARD_CARDS`に1件。`user.email-search`を使う。代理の退会(`withdrawUserByAdministrator`)は最上位管理者だけ(仮4)で、Q3の「モデレーターは要件が最上位管理者に限っていない更新操作を行える」の例外になる。ページ配置のメニューごとの必要なロールの一覧への行は本specのタスクが書く。
- user-profile-social・match-engine・directory-discovery・sponsorship・tournament-week・tournament-year・ultras-subscription(上流): 変更なし。各specの波及処理が本specの発火で動く。
- backend-platform・api-gateway・email-delivery・frontend-platform(上流): 登録箇所への追記だけ。`recharts`は管理者側に版を完全に固定して加える(仮2、確定)。4:21のジョブのローカルの起動はbackend-platformの改訂2の`triggerScheduled`(`e2e/support/scheduled-trigger.ts`)を使う。
- content-reporting(後続): 通報からの措置は`MODERATION_TYPES`の`ProductModerationService`・`CommentModerationService`・`UserModerationService`を`statements`付きで呼び、通報の状態の更新を同じ一括の書き込みで確定する。結果の`actionId`で自分の記録と結べる。プロダクト詳細の「受け付けた通報件数」は`ADMIN_PRODUCT_DETAIL_SECTIONS`に区画を登録する。申出者への通知(FR-ADMUG-030の後半)はcontent-reportingが持つ。
- data-export(後続): 措置の記録はエクスポートの対象に無い(データエクスポートの文書の項目に無い)。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は1900・1910、波及処理は1900」。Requirement Ambiguitiesの返金の行の解決の列への追記は仮8。本specはroadmapを編集しないため、コントローラーへ報告する。

## 設計のレビュー(2026-10-24)

- `/kiro-spec-design ugc-moderation -y`の手順で、要件を承認し(`-y`による自動の承認)、設計の下書きを作った。参照したスキルはcc-sddの`kiro-spec-design`の規則(design-principles・design-discovery-full・design-synthesis・design-review-gate)とテンプレート。外部の調査は、新しいパッケージの候補の版と公開日(npmレジストリ)に限った。
- 機械的な確認: 要件の152件の受け入れ基準の番号がすべて追跡表にあることを、スクリプトで確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、(1)プロダクト一覧のカテゴリの選択肢の照会が曖昧だったため`adminModerationCategoryOptions`を加えた、(2)ユーザー一覧のプロフィール画像の隔離に要る隔離理由の照会(`MediaFiles.findMany`)を照会の処理に加えた、(3)管理者側のCSPが同一オリジンの画像を許す前提をSecurity Considerationsに明記した、(4)部品の表の要件の範囲の書き方(`4.x`)を明示の番号に直し、文書の半角スペースの規則の違反(表のセル・コードの注記)を直した。2回目で問題は無かった。
- 境界の確認: 上流のテーブルへ書き込まず、上流の操作口と登録口と、上流のディレクトリに加える読み取りだけの照会を使う。上流の契約の変更は、照会の追加(5spec)と、契約で定められた束縛の差し替え(media-pipeline)だけである。
- 技術ドキュメントの番号: 完了済みspecのdesign.mdの計画は`backend`001〜020、`frontend`001〜019、`db`001〜007、`security`001〜010、`infra`001〜008、`external`001〜008、`operations`001〜004、`coding`001〜004、`testing`001〜002である。本specは`backend/021`・`frontend/020`・`db/008`を取る。

## タスクの計画の検証(2026-10-24)

- `/kiro-spec-tasks ugc-moderation -y`の手順で、要件と設計を承認し(`-y`による自動の承認)、タスクの計画の下書きを作った。要件の152件の受け入れ基準の番号がすべてタスクにあること、タスクが要件に無い番号を参照しないことを、スクリプトで確かめた。設計の全コンポーネント(共有定義・監査ログの操作種別・テーブル・週の規則・メール・上流への6つの照会・記録のストア・識別子と保留中の措置・文と同期の処理・通知・6つのユースケース・閲覧の判定・7つの照会・統計のストアとジョブ・保守のジョブ・束縛・GraphQL・eventの処理・管理画面の各部品・文書・E2E)がタスクにある。
- タスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で行った。
- 1回目の判定はNEEDS_FIXES(必須8件・軽微8件)だった。必須の指摘は、(1)共有定義のタスクをテーブルのタスクの前に置く、(2)監査ログの操作種別とメール種別のタスクに共有定義への`_Depends:`を付ける、(3)ローンチ状態とコメントの状態の表示名の一致の確認を上流の照会のタスク(2.2・2.3)へ移す、(4)apiのDIの識別子とポートを先に作るタスク(3.2)を設け、並行のタスクが同じファイルを変えないようにする、(5)保留中の措置と同期の処理の束縛を3.3で、全ての束縛・ジョブの登録・スキーマモジュールの型をリゾルバの前(5.8)で行う、(6)管理者側の許可リストの再生成を操作の文書を書くタスク(7.1)へ移す、(7)個別の隔離のボタンと評価の操作の部品の持ち主を共通部品のタスク(7.2)にする、(8)プロダクトのページのタスクを一覧(7.6)と詳細(7.7)に分ける、であった。軽微の指摘(`_Depends:`の追記、管理者側のCSPの確認を7.2に加える、プロダクトの非公開化のタスクで呼び出し側の文の受け渡しを確かめる、統計のストアとジョブの分割など)にも従って直した。
- 2回目の判定(新しいサブエージェントによる独立した確認)はPASSだった。軽微の指摘7件(保留のタスク7.4に`_Blocked:`を付け後続が待たないことを明記する、2.2・2.3の表示名のテストを各照会のテストのファイルに置く、識別子と登録箇所を変えないタスクの範囲を明確にする、5.7のテストの組み立て方、5.8で通知を束縛し入力の検証を単体テストにする、子が1つのタスク6を親へ繰り上げる、7.2の大きさ)のうち、7.2の分割を除く6件に従って直した(7.2は部品が小さく1つのテストのタスクにまとまるため、分けない)。タスクを承認した(8つの大タスク・50のサブタスク、タスク6は子を持たない)。

## cross-spec reviewの指摘による変更(2026-10-24)

### 利用者・プロダクトの照会を所有するspecの改訂へ移す

- **決定**: `AdminUserDirectory`・`AdminProductDirectory`は、所有するspecの改訂(identity-authの仮7・product-launchの仮13)が所有・実装・束縛し、本specは使うだけにする。形(シグネチャ)は変えず、design.mdには本specが使う契約の写しを残す(正本は各上流specのdesign.md)。上流の改訂の完了を1.1の前提に加えた。
- **理由**: cross-spec reviewの指摘による(分解)。申し送りの無い上流の部品を本specのタスクが作ると、上流のテーブルの列の解釈の持ち主と再検証の契機があいまいになる。
- **影響**: 利用者・運営者に見える振る舞いは変わらないため、requirements.mdの仮決定の表には加えない(Boundary Contextの隣接の期待の文言だけを直した)。
- **状態**: 2026-10-24に開発者が確定した。あわせてengagement・paymentsの照会も上流の所有・実装と確定し、当初この決定に含めた問い合わせの依頼者の照会(inquiry-chatの仮7)は仮4の確定により取り下げられた(「開発者の確定の反映」)。

### 週ごとの統計を独立した継ぎ目として分ける

- **決定**: 週ごとの統計(`moderation_weekly_statistics`・`StatisticsWeek`・`PaymentRevenueReport`・上流の`countRegisteredAt`を使う集計のジョブ・照会・カード・グラフ)を、措置の群と別のタスク群(タスク8)とRevalidation Triggersの統計の群にする。統計のテーブルは措置の記録と別のマイグレーションで作り、統計の群の識別子・ポート・束縛・ジョブの登録・GraphQLの型と操作・文書・E2Eも統計の群のタスクが加える。specは分けない。
- **理由**: cross-spec reviewの指摘による(分解)。統計は措置と独立に変わる上流(paymentsの決済履歴の値の解釈、identity-auth・product-launchの時点の総数、match-engineの日ごとの集計、グラフのパッケージの承認)に依存し、措置と同じ再検証の契機にまとめると、統計だけの変更で措置の部品まで確かめ直すことになる。
- **影響**: 振る舞いは変わらない。タスクの番号を付け直した(旧1.4→8.3、旧1.5→1.4、旧1.6→1.5と8.1、旧2.3→2、旧2.4→8.4、旧5.5→8.5、旧5.6→8.6、旧5.7→5.5、旧5.8→5.6と8.7、旧5.9→5.7と8.7、旧5.10→5.8、旧7.1→7.1と8.8、旧7.3→8.9、旧7.4→8.10、旧7.5〜7.11→7.3〜7.9、旧8.1〜8.5→9.1〜9.5、旧8.2の`db/008`→8.12、旧8.6→9.6と8.11、旧8.7→9.7)。
- **状態**: 2026-10-24に確定した。タスクの番号は確定の反映で再び付け直した(「開発者の確定の反映」)。

### 変更履歴

- 2026-10-24: cross-spec reviewの指摘により、利用者とプロダクトの同期の処理の登録に必須の`handler`(`MODERATION_TYPES.UserModerationRecordSyncHandler`・`MODERATION_TYPES.ProductModerationRecordSyncHandler`)を加えた(product-launchの`ProductLifecycleSyncRegistration`、identity-authの`UserLifecycleSyncRegistration`の必須の項目)。
- 2026-10-24: cross-spec reviewの指摘により、paymentsのDIの識別子の名前を`PAYMENTS_TYPES`に直した。
- 2026-10-24: cross-spec reviewの指摘により、`moderation_actions`のRevalidation Triggerの利用者の一覧からdata-exportを除いた(data-exportは措置の記録を読まない)。
- 2026-10-24: cross-spec reviewの指摘により、4:21のジョブのローカルの起動をbackend-platformの改訂2の共有の補助`triggerScheduled`(`e2e/support/scheduled-trigger.ts`)へ切り替え、E2Eの補助(9.3)から独自の起動の補助を除いた。あわせて旧8.3の存在しない依存`6.1`を`6`に直し、ローンチ状態の表示名の一致の確認を上流へ移った照会のテストから5.2へ移した。
- 2026-10-24: cross-spec reviewの指摘(上流の改訂の確定を受けたコーディネーターの連絡)により、上流の改訂の前提をタスクの番号(identity-authの3.7・product-launchの2.6)で示した。`AdminUserDirectory`の写しの部分一致の大文字小文字の扱いの理由を、`COLLATE NOCASE`からSQLiteの`LIKE`がASCIIの大文字小文字を区別しないことに直した(`nickname`は`COLLATE NOCASE`を持たない。identity-authの仮7の設計と同じ)。シグネチャは変えない(当時あわせて記した問い合わせの依頼者の照会の束縛の場所は、仮4の確定で取り下げられた)。
- 2026-10-24: 開発者が仮2を承認した(コーディネーターの連絡)。統計のグラフはRecharts(3.10.1、または実装時点で公開から2週間以上たつ3系の最新の安定版)で確定し、tech-stack.mdの「グラフ描画」の項はコントローラーが追加済みである。requirements.mdの仮2の行を確定とし、design.mdとresearch.mdの承認待ちの記述を除き、tasks.mdの8.10の保留(題名の注記と`_Blocked:`)を外して、管理者側への版を完全に固定した追加とカードへの組み込みを加えた。`coding/002-dependency-versions.md`の主要パッケージの一覧はアプリ間で版をそろえるパッケージだけを載せる規則のため、Rechartsは載せない。9.7の依存に8.10を加え、報告の文言を直した。他の仮決定は確認待ちのまま。

### 変更後のタスクの計画の検証(2026-10-24)

- 変更した部分について、新しいサブエージェントによる独立したタスクのグラフのサニティレビュー(independent)を2回行った。
- 1回目の判定はNEEDS_FIXES(必須2件・軽微5件)だった。必須の指摘は、(1)Technology Stackのマイグレーションの数が1つのままだった、(2)問い合わせの依頼者の照会(当時。仮4の確定で取り下げ)の束縛の場所がinquiry-chatの設計(apiの`INQUIRY_MODULE`)と食い違っていた、の2件で、直した。軽微の指摘(8.2に1.2への依存を付ける、統計のE2Eと文書を8.11・8.12に分ける、統計のGraphQLの操作を8.8・カードと表を8.9に分ける、`project-values.md`の担当を8.12と9.2で分ける、requirements.mdのpaymentsの隣接の期待の文言)もすべて直した。
- 2回目の判定はPASSだった。軽微の指摘2件(`STATISTICS_WEEKS_SHOWN`を統計の群と措置の群の共有に挙げる、9.2に8.12への依存を付ける)に従って直した。タスクの承認を保った(9つの大タスク、タスク2と6は子を持たない)。

### 仮2の確定の反映の検証(2026-10-24)

- 変更した部分(requirements.mdの仮2・design.mdのグラフの記述・research.mdの判断・tasks.mdの8.1・8.10・9.7)について、新しいサブエージェントによる独立したタスクのグラフのサニティレビュー(independent)を2回行った。
- 1回目の判定はNEEDS_FIXES(必須1件・軽微4件)だった。必須の指摘は、shadcn/uiの`chart`の部品の置き場所が決まっておらず、フロントエンド共通ファイルに置くと共有ディレクトリがRechartsを読み込み「管理者側だけが使う」と食い違う点で、部品を`components/moderation/statistics/chart/`に部分ごとのファイルで置く旨をdesign.mdのファイル構成と部品の表、tasks.mdの8.10に加えた。軽微の指摘(Technology Stackの版の方針、`react-is`の完全な固定、8.10の`_Boundary:`、仮決定の表の見出し)にも従って直した。
- 2回目の判定もNEEDS_FIXES(必須1件・軽微3件)だった。必須の指摘は、tasks.mdの1.5とresearch.mdの確認事項の前書きに「仮1〜仮9が確認待ち」の記述が残っていた点で、仮2の確定の文言に直した。軽微の指摘(requirements.mdの仮決定の節の見出し、8.10の`_Boundary:`の対象の明示、research.mdの仮2の根拠の「当時」の注記)にも従って直した。
- レビューは2回までの取り決めのため、2回目の指摘の修正の後の再レビューは行っていない。タスクの承認は外し(`approvals.tasks.approved`は偽)、修正を確かめるレビューをコーディネーターの判断に委ねる。

### タスクのフェーズの再実行(2026-10-24、コーディネーターの指示)

- `/kiro-spec-tasks ugc-moderation -y`の手順で、現在のtasks.mdを既存の下書きとしてタスクのフェーズを再実行した。要件の152件の受け入れ基準の番号がすべてタスクにあり、要件に無い番号を参照しないことを、スクリプトで確かめ直した。
- 新しいサブエージェントによる独立したタスクのグラフのサニティレビュー(independent)を2回行い、前回の2回目の指摘の修正(8.10・8.1・1.5・9.7と関連するdesign.mdの変更)を先に確かめさせた。
- 1回目の判定はNEEDS_FIXES(必須1件・軽微3件)だった。必須の指摘は、本書の「仮決定」の節の見出しと前書きが仮2を確認待ちとしていた点で、仮2の確定の文言に直した。軽微の指摘(グラフをTanStack Routerの`ClientOnly`で包む旨をdesign.mdの部品の表に明記し、8.10とTesting Strategyで確かめる、8.10で直近26週と今週の値を確かめる、仮決定の全体の状態の注記を1.5だけが書き8.1は統計の節だけを加える)にも従って直した。
- 2回目の判定はPASSだった。軽微の指摘2件(`ClientOnly`の確かめ方を、サーバー側の描画の結果にfallbackの枠の目印だけが出て`svg`を含まないことの単体テストと、クライアントの描画でグラフが出ることのブラウザテストに分ける、本書へこの再実行の記録を加える)に従って直した。タスクを承認した(`approvals.tasks.approved`を真に戻した)。

## 開発者の確定の反映(2026-10-24)

開発者が仮1〜仮9を全て確定した(コーディネーターの連絡)。仮1・仮2・仮3・仮6・仮7・仮8は推奨どおり、仮4・仮5・仮9は推奨と異なる選択肢である。あわせて、管理画面の照会の持ち主と上流の改訂が確定した。

- 仮4(推奨と異なる): 代理の退会は最上位管理者だけが行え、起点はユーザー一覧だけとした。問い合わせの詳細からの導線(inquiry-chatの問い合わせの詳細の操作の登録口への登録)、問い合わせの依頼者の照会(inquiry-chatの仮7は取り下げ)、未ログインの本人の意思の確認の確認欄、対象の候補の照会(`adminWithdrawalCandidate`・`WithdrawalCandidateReader`)、エラーコード`identity_confirmation_required`・`withdrawal_target_mismatch`・`inquiry_not_found`、監査ログの詳細の鍵`inquiryId`、措置の記録の列`inquiry_id`を除いた。理由の必須は保った。リゾルバの認可は`requireAdmin(context, 'super_admin')`とし、admin-foundationのQ3の例外としてページ配置のロールの一覧に載せる。要件5を書き直した(受け入れ基準の数は13のまま)。
- 仮5(推奨と異なる): 代理の退会の完了のメールを送らない。メール種別`ugc-moderation.account-withdrawn`とテンプレート、通知の方針`immediate`、通知の状態`failed`、`setImmediateNotice`、`withdrawal-notice-failed`を除いた。運営者がシステムの外のメールで知らせる。
- 仮9(推奨と異なる): 停止解除・プロダクトとコメントの復元・評価の無効化の取り消しはすべて理由を必須とした(要件8.3・8.9・9.7・10.5、GraphQLの`unhideProduct`・`unhideComment`・`revalidateRating`の`reason: String!`)。画像の操作の理由は任意のまま(仮7は推奨どおり)。
- 仮8(推奨どおり)とsponsorshipの仮3(推奨と異なる): 本機能は返金を依頼しない。sponsorshipの仮3の確定で、停止・非公開化による広告の表示停止は停止した日数分、強制終了は未掲載日数分の広告料金を自動で日割り返金するため、停止と非公開化の通知の広告の段落を「表示を停止した日数分の広告料金が自動で日割り返金される」に直した(要件12.4・12.5)。文はsponsorshipが文言規則へ載せる文と一致させる。
- 管理画面の照会: `AdminCommentDirectory`・`AdminRatingDirectory`はengagementの仮6(engagementの要件12.6・タスク2.7、識別子はタスク2.1)、`PaymentRevenueReport`はpaymentsの仮7(paymentsの要件12.10・タスク1.3・2.1・5.5・5.7)が所有・実装・束縛する。本specの実装のタスク(旧2・旧8.4)とファイル構成の項目を除き、上流のタスクを前提に加えた。形(シグネチャ)は変えない。純収益の式はpaymentsの定義を正とし、本specの式(`dispute_lost`の行を足す誤った式)を除いた。コメントの状態の表示名の一致の確認は、除いたタスクから4.3へ移した。`AdminUserDirectory`はidentity-authのタスク3.7、`AdminProductDirectory`はproduct-launchのタスク2.6が実装する。
- タスクの番号: 旧2を除いて大タスクを付け直した(旧3→2、旧4→3、旧5→4、旧6→5、旧7→6、旧8→7、旧9→8)。旧8.4を除いて旧8.5〜8.12を7.4〜7.11に、旧7.8(問い合わせの詳細の操作)をユーザー一覧の代理の退会の操作(6.8)に、旧7.9をメニューの登録(6.9)にした。旧5.4は隔離画像の照会だけ(4.4)にした。

### 変更したID

- 要件: 5.1〜5.13(書き直し)、8.3・8.9・9.7・10.5(仮9)、12.4・12.5(広告の日割り返金)、14.2(代理の退会の権限)、15.3(照会は各機能が提供)、16.4(代理の退会のE2E)。Introduction・用語・Boundary Contextの代理の退会と照会の記述。
- タスク: 全体の番号の付け直しに加え、1.1(前提・理由の要否・通知)・1.2・1.3(詳細の鍵)・1.4(3種・広告の日割り返金)・1.5・2.1・2.4・3.1〜3.4(理由の必須)・3.6(代理の退会)・4.3(コメントの状態の表示名)・4.4・4.7(最上位管理者の認可)・4.8・6.2・6.5〜6.8(代理の退会の操作)・7.5(純収益はpaymentsの定義)・8.2・8.4・8.6・8.7。

### 確定の反映の検証(2026-10-24)

- 変更した要件と設計について設計のレビューゲート(変更した部分)を、タスクの計画全体についてタスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で2回行った。要件の152件の受け入れ基準の番号がすべて設計の追跡表とタスクにあることを、スクリプトで確かめた。
- 1回目: 設計はNEEDS_FIXES(必須2件: ファイル構成に確認欄の注記と取り除いた照会の操作のファイルが残っていた。軽微6件)、タスクはPASS(軽微3件)。すべて直した。
- 2回目: 設計・タスクともPASS。軽微の指摘(inquiry-chatの反映済みの記述、代理の退会のダイアログを`ModerationActionDialog`の上に作り監査ログの旨と個人情報の注記を示すこと(6.8に13.3・14.5を加えた)、briefの古い記述)に従って直した。要件・設計・タスクの承認を保った。

## sponsorshipの広告の返金の文の反映(2026-10-24)

- sponsorshipが停止と非公開化の通知の広告の段落の文を確定した(コーディネーターの連絡)。仮の文言(表示を停止した日数分の広告料金が自動で日割り返金される旨)を、確定した文に置き換えた。
- 要件12.4・12.5: 掲載期間は延長されないこと、一部でも停止した日を数えること、掲載期間の終了時に返金すること、停止中の退会やプロダクトの削除では返金されないこと(停止だけ)を加えた(横断レビュー3回目の訂正で、退会の条件は「掲載期間が終わる前に退会した場合」に改め、非公開化にも加えた)。
- 設計(ModerationEmailKinds)とタスク1.4: 確定した文を一字一句そのまま載せ、単体テストで本文に完全に一致する文字列として含まれることを確かめるようにした。
- 新しいサブエージェントによる独立した変更部分のタスクのレビュー(independent)を1回行い、判定はPASSだった。軽微の指摘(要件12.5を「そのプロダクトの広告」とする、文言規則では広告の段落の文をsponsorshipの項目の参照にとどめる、briefの手動の返金の記述に確定後の扱いを添える)に従って直した。要件・設計・タスクの承認を保った。

## 横断レビュー3回目の反映(2026-10-24)

- 非公開化の広告の段落の文に、sponsorshipの要件14.9に合わせて退会と削除で返金されない旨の文を加えた(設計のModerationEmailKinds、タスク1.4、要件12.5の要約)。sponsorshipが文言規則のタスク1.4へ両方の文を載せるため、本specの文言規則の参照はそのまま保つ。
- 要件の仮1の表と要件2.2の純収益の要約に「定義はpaymentsの要件12.10を正とする」を加えた。
- 新しいサブエージェントによる独立した変更部分のタスクのレビュー(independent)を1回行い、判定はPASSだった。軽微の指摘(要件2.2の末尾の「(仮1)」の位置)は、受け入れ基準の出典を末尾に置く本書の書式に合わせて保った。要件・設計・タスクの承認を保った。
- 訂正: コーディネーターがsponsorshipの要件14.9に合わせて両方の文の退会の条件を確定し直した。停止と非公開化の文の末尾を、どちらも「掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。」とした(設計のModerationEmailKinds、タスク1.4、要件12.4・12.5の要約)。
- 訂正後の文について、新しいサブエージェントによる独立した変更部分のタスクのレビュー(independent)を1回行い、判定はPASSだった。軽微の指摘(本書の記録の順序、設計の確かめ直しの条件にsponsorshipの要件14.9を挙げる)に従って直した。要件・設計・タスクの承認を保った。

## frontend-platformの確定した契約の反映(2026-10-28)

- **状態**: frontend-platformのタスク10.4として、frontend-platformが実装で確定した契約(frontend-platformのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に本specの設計とタスクを合わせた。2026-10-28に開発者が下流specの設計の改訂を決めた(frontend-platformの判断11)。受け入れ基準は変えていない。
- **GraphQLの操作の置き場所**: 操作は`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名は`Admin`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`だけを読む契約になった。`graphql/operations/moderation/`の7つの`.ts`を、9つの照会と13の措置の操作の`.graphql`に分けた。
- **Zodの値の読み込み元**: アプリのファイルは`zod`の値を共通部品の`utilities/validation/zod.ts`(`z.config({ jitless: true })`の後の`z`)からだけ読む契約になった(CSPの`script-src`の違反を避けるため)。`ModerationSearch`の検索パラメータのスキーマをこの契約で書いた。
- **管理者側のエラーの案内文**: `ErrorState`に`contactHref`を渡さず、`GraphQLClientError`でない例外に代えて出す文言(`ErrorState`・`PartialErrorState`・措置の確認のダイアログの失敗・トースト)は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`で選ぶ契約になった。画面の部品の表の後に規約を加えた。
- **変えた箇所**: design.mdのAllowed Dependencies・File Structure Plan・Modified Files(生成物と許可リスト)・画面の部品の表(`ModerationSearch`・`ModerationActionDialog`)と表の後の規約、tasks.mdの6.1・7.7(`.graphql`・操作名・生成と許可リストの再生成)・6.2(Zodの読み込み元、失敗の文言)・7.8(カードの失敗に問い合わせの導線が無いこと)。管理者側のCSPの`img-src 'self'`の前提は確定した契約と合う。
- **確認のダイアログの失敗の文言**: admin-foundationの`ConfirmActionDialogProps`が必須の`failureMessageOf: (error: unknown) => string`を受け、`onConfirm`の失敗時にダイアログを開いたまま理由の入力を保ち、`failureMessageOf(error)`の文言を`role="alert"`でダイアログの中に示す契約になった(同日のadmin-foundationの改訂)。共通部品はアプリのプロファイルを読まないため、呼び出す側が文言を決める。 `ModerationActionDialog`(`AdministrativeWithdrawalDialog`を含む)は`failureMessageOf`に`(error) => errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`を渡す。あわせて、`AdminDataTable`の`error.message`も呼び出す側が同じ関数で選ぶことを管理者側の失敗の表示の規約に加えた(design.mdの画面の部品の表と規約、tasks.mdの6.2・6.8)。
- **操作のファイル名**: 他のspecにそろえ、照会の`.graphql`のファイル名から`admin-`の接頭辞を除いた(`weekly-statistics.graphql`など。操作名の`Admin`の接頭辞は変えない)。design.mdのFile Structure Planとtasks.mdの7.7を直した。

## 管理者側のカテゴリの照会の分離(2026-10-28、開発者の判断)

- **状態**: frontend-platformの最終検証の後の第2回の判断21(2026-10-28)を、frontend-platformのタスク11.6として本specの設計とタスクへ反映した。受け入れ基準は変えていない。
- **Context**: 本specのプロダクト一覧の絞り込みの選択肢の照会`adminProductCategories: [AdminCategoryRef!]!`は、product-launchがプロダクトカテゴリの管理画面のために定義する`adminProductCategories: [ProductCategory!]!`と、名前が同じで型が異なっていた。管理者側の操作は1つのスキーマと1つの生成物(adminの`src/graphql/generated/graphql.ts`)に入るため、両方を定義するとスキーマの合成と操作名・生成物の型の名前が衝突する。
- **決定**: product-launchの`adminProductCategories: [ProductCategory!]!`はそのままとし、本specの照会を別名の`adminModerationCategoryOptions: [AdminCategoryRef!]!`にした。操作名は`AdminModerationCategoryOptions`、操作のファイルは`moderation-category-options.graphql`(照会の名前から`admin`を除いた形)、生成物は`AdminModerationCategoryOptionsDocument`・`AdminModerationCategoryOptionsQuery`である。処理は`AdminProductReader.categories`(`ProductCategoryDirectory.list()`)のままで、選択肢に要る`id`・`name`だけを返す。
- **変えた箇所**: design.mdのFile Structure Planの操作のファイル、照会の表の`AdminProductReader.categories`の行、GraphQLの`Query`の定義と照会の名前の規約、画面の部品の表の`ProductFilters`と操作名の例。tasks.mdの4.8(Workers統合テストの照会の一覧)。本ファイルの「設計のレビュー」の照会の名前。

## 実装済みの上流との食い違いの水平展開(2026-10-30、開発者の指示)

- **Sentryの定型の通知**: content-processingの差分の分析(G-4)で、backend-platformの改訂7と技術ドキュメント`infra/004`の「同じ文言を繰り返し送る通知」が、定型の文言で繰り返し起こり得る出来事を`captureMessage`ではなく`captureEvent`で送り、文言を`logentry`、まとめる単位を`fingerprint`に置くと定めていることを確かめた。`captureMessage`は既定の`dedupeIntegration`により、同じ文言の2件目以降が捨てられる。本specの`captureMessage`をすべて`captureEvent`に改め、規約の参照と通知のタグの記述に`logentry`と`fingerprint`の置き方を加えた。通知の種類・タグ・レベルは変えていない。
- **ブラウザテストの事前バンドル**: frontend-platformの`vitest.browser.config.ts`は、テストの実行中に依存の事前バンドルをやり直すとページが再読み込みされReactが2つ読み込まれるため、画面部品の依存を`PREBUNDLED_DEPENDENCIES`に列挙している(content-processingの差分の分析のG-3)。本specが加える`recharts`を、管理者側の一覧へ加える手順をdesign.mdのModified Filesとtasks.mdの導入のタスクに加えた。
- 要件と受け入れ基準は変えていない。

## 層の規則に合わせた契約の置き場所の改訂(2026-11-02、開発者の指示)

- 規則: api・eventの`src/application/**`・`src/domain/**`は`**/lib/workers/**`を型も含めて読み込めない。別の機能や後続specのapplication層が受け取る契約とDIの識別子は`apps/backend-lib/core/<ドメイン>`に置き、`workers/<ドメイン>`には実装と束縛だけを置く。application層はデータベースの接続・SQLの文・一括の書き込みを扱わず、文を返す契約は`workers`に置いてinfrastructure層だけが使う。複数の書き込みを1回で確定させたい場合は、書き込みの単位のポートをapplication層に定義し、実装をinfrastructure層に置く([依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析))。identity-authの`core/identity`の配置にそろえた。
- 契約の分割: `ModerationRecordStore`から文を返す`insertStatement`を分け、文を返さない部分(`NewModerationRecord`・`ModerationRecord`・`LatestModeration`・`ModerationRecordStore`)を`core/moderation/ports.ts`へ、`MODERATION_PLATFORM_TYPES`を`core/moderation/identifiers.ts`(単体テストを加えた)へ移した。`insertStatement`は`workers/moderation/moderation-record-statements.ts`の`ModerationRecordStatements`とし、apiのinfrastructure層の`D1ModerationStatements`だけが使う。D1の実装は`workers/moderation/d1-moderation-record-store.ts`の`D1ModerationRecordStore`(両方の契約を実装する)。
- 新しいポート: application層の`ports.ts`にあった文を返すポート`ModerationStatements`(`forRecord`・`commit`)をやめ、書き込みの単位のポート`ModerationRecordWriter`(`commit`、画像の操作の記録と監査ログの単独の一括の書き込み)と`EngagementModerationWriter`(`hideComment`・`unhideComment`・`invalidateRating`・`revalidateRating`、コメント・評価の状態の変更と記録と監査ログの一体の確定)にした。engagementの`CommentModerationControl`・`RatingModerationControl`が呼び出し側の文を受け取るためapiのinfrastructure層に置かれた(engagementの改訂)ことにも合わせ、application層のユースケースはそれらを直接呼ばない。
- 新しいinfrastructure層のクラス: `D1ModerationRecordWriter`・`ControlEngagementModerationWriter`(`d1-moderation-record-writer.ts`・`control-engagement-moderation-writer.ts`)。`D1ModerationStatements`は記録と監査ログの文の組み立てだけを持つinfrastructure層の内部の部品にし、同期の処理と2つの実装が使う。
- 残した点: `ModerationCommand.statements`・`PendingModeration.extraStatements`は呼び出し側(content-reporting)が組み立てた文で、content-reportingとの契約の形を保つため残した。application層は中身を読まず組み立てず、infrastructure層の書き込みの単位へそのまま渡す。
- 他specの契約の参照: `AdminProductDirectory`を`core/product`(D1の実装は`workers/product/d1-admin-product-directory.ts`)、`AdminCommentDirectory`・`AdminRatingDirectory`を`core/engagement`(D1の実装は`workers/engagement/d1-admin-comment-directory.ts`・`d1-admin-rating-directory.ts`)、`UserProfileDirectory`を`core/profile`、`MatchDirectory`を`core/match`、`AdminDirectory`を`core/admin`、identity-authの契約を`core/identity`として書いた。
- 変えた箇所: design.mdのOverviewのImpact、This Spec Owns、Out of Boundary(engagementの操作口の呼び方)、Allowed Dependencies(admin-foundation・identity-auth・product-launch・engagement・user-profile-social・match-engine)、上流への影響の表(engagement)、Revalidation Triggers、Architecture IntegrationのSelected patternとExisting patterns preserved、Dependency direction、File Structure Plan(`core/moderation`の`ports.ts`・`identifiers.ts`、`workers/moderation`の`moderation-record-statements.ts`・`d1-moderation-record-store.ts`、apiの`ports.ts`の注記、infrastructure層の2つの書き込みの単位)、コンポーネントの表(Layer・Key Dependencies)、「backend-lib/core/moderation・workers/moderation」の節、上流の照会の節の見出し(`AdminProductDirectory`・`AdminCommentDirectory`・`AdminRatingDirectory`の置き場所)、「PendingModerationRecord・ModerationRecordWriter・EngagementModerationWriter」の節、措置のユースケース(コメント・評価・画像)、RecordErasureHandlers、Testing Strategy。tasks.mdの2.1(契約・識別子とその単体テスト、文の契約と実装の置き場所)・2.2(書き込みの単位のポート、完了状態の静的解析)・2.3(infrastructure層の書き込みの単位とそのWorkers統合テスト)・3.3・3.4・3.5(書き込みの単位のポートの受け渡し)・4.6・5(完了状態の静的解析)。

### 開発者の決定: 参加者の登録口(2026-11-02)

- **状態**: 上の「残した点」の`ModerationCommand.statements`・`PendingModeration.extraStatements`は、application層が呼び出し側の文(`BatchItem<'sqlite'>`)を受け取って運ぶ形で、規則に合わない。content-reportingの`ReportCaseWorkflow`(application層)が文を組み立てる原因でもあった。開発者が「参加者の登録口」の方式に決めた。
- **Decision**: application層の措置の入力は値だけの参加`participation?: ModerationWriteParticipation`(`{ kind; payload }`、`kind`は`<spec名>.<名詞句>`)にし、`ModerationCommand.statements`・`EngagementModerationWrite.statements`・`PendingModeration.extraStatements`を除いた(`EngagementModerationWrite.participation`・`PendingModeration.participation`が値をそのまま運ぶ)。文を返す参加者の契約`ModerationWriteParticipant`(`statementsFor(participation, context)`)・`ModerationWriteContext`(`actionId`・`action`・`targetId`・`occurredAt`)・`ModerationWriteParticipantRegistration`(`kind`・`participant`の識別子)と解決の部品`createModerationWriteParticipants`(`ModerationWriteParticipants`)をapiの`infrastructure/moderation/moderation-write-participant.ts`に、登録の一覧`MODERATION_WRITE_PARTICIPANTS`(初版は空、content-reportingが追記)をapiの`composition/moderation-write-participants.ts`に置く。identity-authの`USER_LIFECYCLE_SYNC_HANDLERS`・`UserLifecycleSyncHandler`と同じ形で、参加者は処理単位のコンテナから解決する。
- **振る舞い**: 同期の処理(停止・停止解除・代理の退会・非公開化・復元)と`ControlEngagementModerationWriter`(コメント・評価)が、種類で参加者を解決し、その文を記録と監査ログの文の後に並べて同じ一括の書き込みに入れる。`context.actionId`はユースケースが上流の操作の前に採番する記録のID(結果の`ModerationOutcome.actionId`と同じ値)で、参加者は自分の記録に措置の記録のIDを同じ一括の書き込みで残せる。種類の形式違反と重複は解決の部品の作成時に例外、登録の無い種類は`AppError(internal)`で何も書かない。参加者の文の違反で全体が取り消される規則は変わらない。画像の操作は`participation`を受け付けない(付いていれば`AppError(internal)`)。
- **置き場所の理由**: 参加者の契約は文を返すため、文を扱うinfrastructure層だけが読み込む。実装する後続spec(content-reporting)もapiのinfrastructure層に参加者を置くため、`workers/moderation`ではなくapiの`infrastructure/moderation`に置く。
- **変えた箇所**: design.mdのOverview(Users・Impact)、This Spec Owns(参加者の登録口の項目)、Out of Boundary(後続specの依存)、上流への影響の表(engagement)、Revalidation Triggers(措置の入力と参加者の登録口、置き場所の規則)、Architecture Integration(Domain/feature boundaries・Existing patterns preserved・New components rationale)、Dependency direction、File Structure Plan(`ports.ts`の注記・`moderation-write-participant.ts`・`composition/moderation-write-participants.ts`)、停止・非公開化の記録の一体の確定の流れ(図と注記)、追跡表の15の行、コンポーネントの表(保留中の措置と書き込みの単位の依存、登録口の行)、「PendingModerationRecord・ModerationRecordWriter・EngagementModerationWriter」の節(型・参加者の契約・解決の部品・登録の一覧・同期の処理と書き込みの単位の文の並び)、措置のユースケース(採番・保留中の措置・コメント・評価・画像)、Data Contracts & Integration、Error Categories and Responses、Testing Strategy(解決の部品の単体テスト、両経路の参加者の文の一体の確定・取り消し・未登録の種類のWorkers統合テスト)。tasks.mdの2.2(値だけの参加の型、完了状態)・2.3(登録口と解決の部品、単体テストとWorkers統合テスト、完了状態)・3.1〜3.5(参加の値の受け渡し、画像の拒否)・4.6(完了状態)・8.2(`backend/021`の記述)。要件と受け入れ基準は変えていない。engagementの`CommentModerationControl`・`RatingModerationControl`の`statements`は本specのinfrastructure層が使うため、engagementの設計は変えない。

## 実装前のギャップ分析(2026-11-20、`/kiro-validate-gap`)

### 分析の要約

- 本specの設計(2026-11-02承認)は上流の実装前に作られた。その後、上流の全spec(identity-auth・product-launch・engagement・media-pipeline・admin-foundation・payments・match-engine・user-profile-social・email-delivery・sponsorship・tournament-week・tournament-year・ultras-subscription・public-apiなど)が実装された。本specの成果物(`common-lib/moderation`・`core/moderation`・`workers/moderation`・apiの`application/moderation`・2つのテーブル・adminの5ページなど)はまだ1つも無い。後続のcontent-reportingも未実装である。
- 上流への依頼(identity-authの仮7の`AdminUserDirectory`、product-launchの仮13の`AdminProductDirectory`、engagementの仮6の`AdminCommentDirectory`・`AdminRatingDirectory`と`statements`を受け取る操作口、paymentsの仮7の`PaymentRevenueReport`、media-pipelineの`AdminMediaReviewPolicy`の差し替え口)は、いずれも設計の写しと同じ形で実装・束縛済みである。ライフサイクルのコミッターが同期の処理を処理単位のコンテナから解決して同じ`db.batch`に入れる前提(保留中の措置の方式の根拠)も成り立つ。帯の`order`(4:21の1900・1910、`purge_due`の1900)と文書の番号(`backend/021`・`frontend/020`・`db/008`・`features/006`)は空いている。sponsorshipの広告の日割り返金の2文は文言規則と一字一句同じである。
- 一方で、設計の前提が現在のコード・規約と食い違う箇所が約40件ある(下の「設計とコードの相違点」)。大半は設計の記述の局所的な修正で済むが、画像の操作の再実行で記録と監査ログが欠ける問題・確認のダイアログに影響の一覧を置く場所が無い問題・shadcn/uiのchartの部品と生のHTMLの検査の衝突・統計のテーブルの主キーの4件は、管理者に見える振る舞いか上流のファイルの変更を伴うため、実装前に方針を決める必要がある。
- application層からの`captureEvent`の直接の呼び出しと、存在しない`AppError`の種類`internal`は、そのまま実装すると静的解析と型検査で必ず失敗する(局所的な修正の1・2)。
- 実装の残りの規模はXL(2週間以上)、リスクはMediumと見積もる。

### 調べた範囲

- 4つの観点(identity-auth・product-launch・match-engine・payments・user-profile-socialの操作口と照会/engagement・media-pipeline・admin-foundationのバックエンド・email-delivery/backend-platform・層の規則・api-gateway・DB・監視/管理者側フロントエンド・E2E・文書)で、design.mdのAllowed Dependencies・File Structure Plan・Modified Files・System Flows・Components and Interfaces・Data Models・Error Strategy・Testing Strategyの前提を、現在のコードと照合した。
- 照合した時点のブランチの最新のコミットは`81e2caee`である。

### 要件と既存の資産の対応

| 要件                       | 使う既存の資産                                                                                                                                                                                                                                                                     | ギャップ                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1(統計のカード)            | `DASHBOARD_CARDS`(10は空き)・`DashboardCardFrame`・`MoneyText`・`NumberText`・`formatBusinessDateWithWeekdayLabel`・`PREBUNDLED_DEPENDENCIES`                                                                                                                                      | Missing: カード・表・グラフ・`recharts`の導入・shadcn/uiの`chart`の部品(リポジトリに無い)。Constraint: 生のHTMLの例外の検査(0件)、`DASHBOARD_CARDS`の全件一致のテスト         |
| 2(統計の集計)              | `PaymentRevenueReport.netRevenue`(1〜60期間)・`AdminUserDirectory.countRegisteredAt`・`AdminProductDirectory.countRegisteredAt`・`MatchDirectory.summarizeDaily`(366日まで)・`businessWeekOf`・`addBusinessDays`・4:21のCronの式                                                   | Missing: テーブル・週の規則・ストア・ジョブ・照会。Constraint: 主キーの規約(ULID)、4:21の300秒の予算、application層は`captureEvent`を読めない                                 |
| 3(ユーザー一覧)            | `AdminUserDirectory`(`pseudonymousId`を含む)・`user.email-search`(`maxTargets` 100)・`AuditLogRecorder`                                                                                                                                                                            | Missing: 照会・リゾルバ・画面。Constraint: 不正なカーソルは`invalid_cursor`、`first`は本spec独自の1〜50の規則が要る                                                           |
| 4(停止と停止解除)          | `UserSuspension`(`changed`・`unchanged`、競合は`account_state_conflict`)・`USER_LIFECYCLE_SYNC_HANDLERS`・`D1UserLifecycleCommitter`                                                                                                                                               | Missing: ユースケース・保留中の措置・同期の処理。Constraint: 退会との競合で上流は`not_found`(文言「対象が見つかりません。」)を投げる                                          |
| 5(代理の退会)              | `AdministrativeWithdrawal.withdraw({ userId, caller, operator, at })`(`caller`が`admin`なら管理者の主体を求める)                                                                                                                                                                   | Missing: ユースケース・ダイアログ。設計の呼び方と一致                                                                                                                         |
| 6・7(プロダクト一覧と詳細) | `AdminProductDirectory`・`ProductDirectory`(`listLaunches(ids, now)`)・`ProductCategoryDirectory`・`MatchDirectory.listByLaunches(ids, now)`・`MarkdownContent`+`useRenderedMarkdown`・`RatingStore.summaries`                                                                     | Missing: 照会・画面・区画の登録口。Constraint: 区画の登録口の前例は型を登録箇所に置き`title`を持つ、部品が自分で取得する区画は`RecoverableSlot`で包む                         |
| 8(非公開化と復元)          | `ProductVisibilityControl`(不在は`product_not_found`)・`PRODUCT_LIFECYCLE_SYNC_HANDLERS`・`D1ProductLifecycleCommitter`(`unchanged`では同期の処理を呼ばない)                                                                                                                       | Missing: ユースケース・同期の処理                                                                                                                                             |
| 9・10(コメントと評価)      | `CommentModerationControl`・`RatingModerationControl`(`statements?`を受け取る)・`AdminCommentDirectory`・`AdminRatingDirectory`(`AdminDirectoryPage`、limitは1〜100)・`ENGAGEMENT_ERRORS`                                                                                          | Missing: ユースケース・書き込みの単位・画面                                                                                                                                   |
| 11(画像)                   | `MediaQuarantine`(理由をD1に確定してから移動を依頼し、依頼の失敗は`storage_unavailable`)・`MediaFiles.eraseNow`(削除待ちの印を先に付ける)・`listByReason`・`DenyAllAdminMediaReviewPolicy`の束縛・`FILE_DOWNLOAD_RELAY_ROUTE`・4:21の`media-pipeline.location-reconciliation`(830) | Missing: ユースケース・閲覧の判定・画面。Constraint: 媒体の操作の後に記録を書く設計では、再実行で記録と監査ログが欠ける(G1)。`ModerationFinding`は3種、保有者に`system`がある |
| 12(通知)                   | `defineEmailKind`・`EMAIL_KINDS`・`defineEmailTemplate`・`EMAIL_TEMPLATES`・`EmailSender.send`・`formatUtcDateTime`・`UserContactDirectory.findContact`(停止中も返す)                                                                                                              | Missing: 3種別と3テンプレート。Constraint: 種別とテンプレートは対で加える(テンプレートの一覧の検査)、`/contact`の共通の定数は無い                                             |
| 13(監査ログと記録)         | `defineAuditAction`・`buildAuditLogStatements(db, entry, guard?)`・`PreparedAuditEntry`(`core/admin/audit-log.ts`)・`audit-actions/index.ts`                                                                                                                                       | Missing: 13種・テーブル・記録の削除。Constraint: `user`の対象は仮名化ID、操作種別の全件一致のテスト                                                                           |
| 14(権限と共通の振る舞い)   | `requireAdmin`・各スキーマモジュールの`adminOnly`・`ADMIN_NAV_ITEMS`(20〜60は空き)・`RoleGate`・`ConfirmActionDialog`・`AdminDataTable`・`errorMessageOf`                                                                                                                          | Constraint: `ConfirmActionDialog`の説明は段落の中に描く(G2)、`ADMIN_NAV_ITEMS`の全件一致のテスト、一覧のloaderの規約(`frontend/014`)                                          |
| 15(連携と運用)             | `core/<ドメイン>`+`workers/<ドメイン>`の配置の前例・`Omit<AppModule, 'routes'>`・処理単位のコンテナ(既定は`Transient`)                                                                                                                                                             | Missing: 参加者の登録口。Constraint: `PendingModerationRecord`は`inSingletonScope()`で束縛しないと共有されない、識別子の文字列はapiとeventで分ける                            |
| 16(文書とテスト)           | `backend/021`・`frontend/020`・`db/008`・`features/006`は空き・`e2e/support`の4つの補助・`triggerScheduled`                                                                                                                                                                        | Constraint: DBのテストの3点(マイグレーションの照合・D1の制約・テーブル名の一覧)、写した値の照合は`config/*-contract-copies.unit.test.ts`、E2Eの手順のファイル                 |

### 設計とコードの相違点

#### 振る舞いか上流の変更を伴うもの(実装前に方針を決める)

1. **G1. 画像の操作の再実行で記録と監査ログが欠ける**: 設計(design.mdの421行・1041行)は「媒体の操作の後に`ModerationRecordWriter.commit`し、再実行は媒体の操作が冪等なため結果が重ならない」とした。実際の`MediaQuarantineService.change`(`apps/backend-lib/workers/media/media-quarantine-service.ts:164-198`)は、理由をD1に確定してから移動の依頼を送り、依頼の失敗で`storage_unavailable`を投げる。このとき理由は既に変わっているため、再実行は隔離なら`changed: false`(記録なし)、隔離の解除・公開承認なら前提を満たさず`image_action_not_applicable`になり、措置の記録と監査ログは永久に残らない。保存先は4:21の`media-pipeline.location-reconciliation`(830)が翌日にそろえる。削除も、`eraseNow`が削除待ちの印を先に付けるため(`media-files-service.ts:128-139`)、途中の失敗の後の再実行は`image_not_found`になる。さらに設計は削除済みの再実行を421行で「記録だけを書く」、1041行で「`image_not_found`」と矛盾して書いている。
   - 案A: 記録と監査ログを媒体の操作の前に1つの一括の書き込みで書く(操作の意図の記録)。媒体の操作が失敗したらエラーを返し、再実行は既に同じ状態なら記録を重ねない。反映されなかった操作の記録が残り得る。
   - 案B: 媒体の操作の後に書く設計を保ち、再実行で「状態は既に目的どおりだが、同じ措置の最新の記録が理由の付いた日時(`quarantinedAt`)より古いか無い」ときは記録だけを書いて成功にする。隔離には使えるが、隔離の解除・公開承認・削除では比べる日時が残らない。
   - 案C: media-pipelineの`MediaQuarantine`・`MediaFiles.eraseNow`に呼び出し側の文を受け取る引数を足し、理由の変更と記録と監査ログを同じ一括の書き込みにする(engagementの操作口と同じ形)。上流のファイルの変更を伴う。
   - あわせて、削除済みの再実行の扱い(421行と1041行の矛盾)をどちらかに決める。
2. **G2. 確認のダイアログに影響の一覧を置く場所が無い**: 設計(1400行、要件4.12・5.12・8.11、タスク6.2)は`ConfirmActionDialog`に影響の一覧を添えるとした。実際の`ConfirmActionDialogProps`(`apps/frontend-lib/components/admin/confirm-action-dialog.tsx:32-34`)は「説明は段落(`<p>`)の中に描くため、文字列か文中に置ける要素だけを渡す」で、他の差し込み口が無い。`<ul>`を渡すと不正な入れ子になり、axeとハイドレーションで失敗する。sponsorshipの`terminate-sponsorship-dialog.tsx`は影響を文中の文で組み立てている。
   - 案A: frontend-libの`ConfirmActionDialog`に説明の後の区画のprop(例: `details?: ReactNode`)を足す。共有ディレクトリ・Storybookのストーリー・ブラウザテストの変更を伴う。
   - 案B: 影響を文中の文にする(sponsorshipと同じ)。文言規則の確認の文(design.mdの「文言規則に追加する文言」)は既に文の形なので、要件の「一覧」の読み方を文に改める。
3. **G3. shadcn/uiの`chart`の部品と生のHTMLの例外の検査**: 設計(1396行、タスク7.9)はshadcn/uiの`chart`の部品を`components/moderation/statistics/chart/`に置くとした。部品はリポジトリのどこにも無く、shadcn/uiの`ChartStyle`は配色の変数を`<style dangerouslySetInnerHTML>`で注入する(公開元の実装の知識による。導入時に確かめる)。一方、`apps/admin/test/config/raw-html-exception.unit.test.ts:9-15`は管理者側の`src`で`dom-no-dangerously-set-innerhtml`の無効化が0件であることを求める。ブラウザテストのカバレッジはファイルごとに行・関数とも80%のため、使わない部分(凡例・ツールチップの中身など)を写すと閾値を割る恐れもある。
   - 案A: shadcn/uiの`chart`を使う部分だけ写し、`ChartStyle`の代わりに`ChartContainer`の`style`でCSSの変数を渡すよう改変する。
   - 案B: shadcn/uiの`chart`を使わず、Rechartsの部品を直接使い、色は配色のトークンのCSSの変数で渡す。
   - あわせて、Rechartsをダッシュボードの最初の読み込みに含めるか、動的な`import()`で遅延読み込みにするかを決める(マークダウンの入力欄の`check:editor-chunks`のような検査はグラフには無い)。
4. **G4. 統計のテーブルの主キー**: 設計(1426行)は`moderation_weekly_statistics`の主キーを`week_start`(text)とした。規約(`docs/GUIDES/tech/db/003-schema-conventions.md:100-106`)は、ULIDでない主キーを全文検索用と中間テーブルの複合主キーに限る。規約外の前例は理由をコメントに書いた`apps/db/schema/tournament/bracket-matches.ts:20`の1件だけである。
   - 案A: `ulidPrimaryKey()`と`week_start`の一意索引にし、upsertの`ON CONFLICT(week_start)`を一意索引で行う。
   - 案B: `week_start`の主キーを保ち、規約外とする理由を設計とテーブル定義のコメントに残す。

#### 上流のファイルの変更を伴うが方針が明らかなもの(設計のModified Filesに加える)

| #   | 上流のファイル                                                                                                                                                               | 変更                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1  | `apps/admin/src/components/layout/admin-nav-order.unit.test.ts:28-38`・`admin-navigation.browser.test.tsx:118-129`以降                                                       | `ADMIN_NAV_ITEMS`の全件一致の期待値に5件を加える                                                                                                                               |
| U2  | `apps/admin/src/components/inquiry/unhandled-inquiries-card.browser.test.tsx:115-122`                                                                                        | `DASHBOARD_CARDS`の全件一致の期待値に統計のカードを加える(`frontend/009`の134行「カードを足す機能は空の状態を確かめるテストを更新する」)                                       |
| U3  | `apps/common-lib/admin/audit-actions/index.unit.test.ts:19-61`                                                                                                               | 操作種別の全件一致の期待値に13種を加える                                                                                                                                       |
| U4  | `apps/api/test/config/media-registrations.unit.test.ts:179-195`                                                                                                              | `toBeInstanceOf(DenyAllAdminMediaReviewPolicy)`を`AdminRoleMediaReviewPolicy`に改める。`DenyAllAdminMediaReviewPolicy`は合成ルートから使われなくなるため、残すか消すかを決める |
| U5  | 4:21のジョブの名前を完全一致で列挙するテスト(media-pipelineのtasks.mdの申し送りでは検索の2つのWorkers統合テスト)と`apps/api/test/config/*-scheduled-jobs.unit.test.ts`の慣例 | 2つのジョブを加え、本specの帯・前後の順・予算の検査を`apps/api/test/config/ugc-moderation-scheduled-jobs.unit.test.ts`に置く                                                   |
| U6  | `apps/api/src/presentation/graphql/generated/schema.graphql`・`resolvers-types.ts`                                                                                           | スキーマの変更後にapiの`bun run graphql:generate`で作り直す(設計の323行とタスク6.1・7.7はadminの生成とapiの許可リストしか書いていない)                                         |
| U7  | `docs/GUIDES/tech/infra/004-logging-and-error-tracking.md`の送信の表                                                                                                         | 本specの`captureEvent`の行(指紋`['moderation', <理由>]`、タグ`moderation_incident`の形)                                                                                        |
| U8  | `docs/GUIDES/service/design/002-page-layouts.md:1367`                                                                                                                        | 「…10項目は実装済み」の件数を改める                                                                                                                                            |

#### 設計の記述の局所的な修正で済むもの

| #   | 設計の前提                                                                                                                                | 現在のコード                                                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `AppError({ kind: 'internal' })`(367・917・962・972・990・1041・1456・1470・1477行)                                                       | `AppErrorKind`に`internal`は無い(`apps/backend-lib/core/errors/app-error.ts:1-12`)。運用者に知らせる失敗は`AppError`で投げない(`backend/004`の203行)。束縛の誤り・呼び出し側の誤りは通常の`Error`にする                                                                                                                  |
| 2   | application層(措置のユースケース・`application/moderation/jobs`)から`captureEvent`を呼ぶ(365・1080・1081・1454・1455・1461行)             | application層は`@sentry/*`を型も含めて読めない(`config/eslint/backend-layers.ts:21-25`)。前例どおりポート(例: `ModerationIncidentReporter`、`application/product/ports.ts:246`の`ProductIncidentReporter`)をapplication層に、Sentryの実装をinfrastructure層に置く                                                        |
| 3   | 依存方向`apps/common-lib/moderation` → `apps/db/schema/moderation`(181行)                                                                 | DBのディレクトリは`drizzle-orm`・`ulid`と自身だけを読む(`backend/002`の88行)。CHECKの値は写しを持ち、`config/<ドメイン>-contract-copies.unit.test.ts`で照合する(`config/sponsorship-contract-copies.unit.test.ts`)。CHECKは`inArray(...).inlineParams()`で値を埋め込む                                                   |
| 4   | `moderation-labels.ts`の単体テストで上流の値(`QuarantineReason`・`AdminProductLaunchState`・`AdminCommentState`)との一致を確かめる(541行) | common-libのテストは上流の`backend-lib/core`を読めない(管理者側のアプリには配置されない)。ルートの`config/ugc-moderation-contract-copies.unit.test.ts`でソースを読んで照合する                                                                                                                                           |
| 5   | `CURSOR_PAGE_ARGS`・`toConnection`を使う(55行、ページの`first`は1〜50)                                                                    | `CURSOR_PAGE_ARGS`は1〜100(`presentation/graphql/pagination.ts:8,13`)、`toConnection`は1件多く読んだ行を前提にする。上流の照会は`{ users, nextCursor }`などを返すため、sponsorshipと同じく件数の規則をモジュールに置き`{ nodes, pageInfo }`を組み立てる(`modules/sponsorship/inputs.ts:17,100`・`admin-resolvers.ts:44`) |
| 6   | エラーコードと文言は`presentation/.../moderation/errors.ts`(251行)                                                                        | ユースケースが投げるコードは`application/<ドメイン>/<ドメイン>-errors.ts`に`kind`と文言を置き、presentation層が参照する(`application/sponsorship/sponsorship-errors.ts`)。`application/moderation/moderation-errors.ts`を加える                                                                                          |
| 7   | リゾルバは`requireAdmin`で認可する(1105行以降)                                                                                            | 入力の検証より前に`adminOnly`(各モジュールの`resolver-support.ts`、`modules/sponsorship/resolver-support.ts:39`)で管理者側以外の呼び出しを拒否し、リゾルバの表は`satisfies Resolvers`で生成した型に合わせる(`security/007`の「操作の認可」)                                                                              |
| 8   | IDの引数の形式の規則が無い                                                                                                                | `z.ulid(...).regex(UPPERCASE_ULID_PATTERN, message)`で検証し、文言は存在しない対象と同じにする(`coding/005`の85-91行)                                                                                                                                                                                                    |
| 9   | `MODERATION_TYPES`・`EVENT_MODERATION_TYPES`の識別子の文字列を定めていない                                                                | `Symbol.for`は全体で共有されるため、前例はapiを`<ドメイン>.api.`、eventを`<ドメイン>.event.`で分ける(`application/sponsorship/sponsorship-types.ts:1`)                                                                                                                                                                   |
| 10  | `PendingModerationRecord`は「処理単位で1つ」(983行)                                                                                       | コンテナの既定のスコープは`Transient`(`backend-lib/workers/di/invocation-container.ts:87`)。処理単位のコンテナで`inSingletonScope()`を明記する                                                                                                                                                                           |
| 11  | `UserModerationService`は`account_state_conflict`をそのまま返す(1036行)                                                                   | 一覧の読み取りの後に退会が重なると、`StoreUserSuspension`が`identityError('not_found')`(文言「対象が見つかりません。」)を投げる(`application/identity/user-suspension.ts:59-62`)。代理の退会と同じく`user_not_found`へ変える                                                                                             |
| 12  | エラーコードの一覧(1367行)に`invalid_cursor`が無い                                                                                        | 上流の4つの照会は不正なカーソルで`AppError(bad_request, 'invalid_cursor')`を投げる(`d1-admin-user-directory.ts:131`など)。一覧と文言に加えるか、表現層で変えるかを書く(public-apiの決定の前例がある)                                                                                                                     |
| 13  | 同期の処理の型を`PRODUCT_TYPES`の群に含める書き方(57・58行)                                                                               | `UserLifecycleSyncHandler`/`Registration`・`ProductLifecycleSyncHandler`/`Registration`はapiの`infrastructure/{identity,product}/*-sync-handler.ts`、`ProductLifecycleEvent`・非同期の型は`core/product/product-lifecycle.ts`。識別子の群は`ProductVisibilityControl`だけ                                                |
| 14  | `PreparedAuditEntry`はadmin-foundationのapplication層から読み込む(862行)                                                                  | `apps/backend-lib/core/admin/audit-log.ts:15`                                                                                                                                                                                                                                                                            |
| 15  | `listLaunches`・`listByLaunches`の引数(1064行)                                                                                            | どちらも`now`が必須。`session.principal()`は`Promise<Principal>`                                                                                                                                                                                                                                                         |
| 16  | 監査ログの`user`の対象                                                                                                                    | `user`の対象は仮名化ID(UUID)だけを受け付ける(`api/src/domain/admin/audit-entry.ts:28-31`)。`AdminUserRecord.pseudonymousId`を使う。`AuditLogRecorder`の束縛はapiだけ                                                                                                                                                     |
| 17  | 隔離画像の`findings`・`owner`                                                                                                             | `ModerationFinding`は`labels`・`svg`・`unprocessable`の3種で、文字列化を3種とも用意する。保有者に`system`(IDなし)があり、`owner`はnullにする。画像以外への`addReason`は`quarantine_not_applicable`                                                                                                                       |
| 18  | メールの`contactUrl`                                                                                                                      | `/contact`の共通の定数は無く、identityの非公開の定数だけ(`identity/email-identity-mailer.ts:30`)。共通の定数を置くか本specで持つかを書く。`EmailSendRequest`に冪等のキーは無い                                                                                                                                           |
| 19  | 統計の表の週の開始日は`DateTime`(`<time datetime>`)                                                                                       | 業務日付は`formatBusinessDateWithWeekdayLabel`(`common-lib/time/business-date-label.ts:42`)と`<time dateTime={日付}>`で示すのが前例(`components/sponsorship/admin-sponsorship-table.tsx:62-73`)                                                                                                                          |
| 20  | `downloadPathOf`はfrontend-lib(60行)                                                                                                      | `apps/common-lib/media/upload-protocol.ts`。`MediaPlaceholder`は`{ kind, placeholder, alt, size }`が必須、`AdminAvatar`は`MediaImageView \| null`を受け取る                                                                                                                                                              |
| 21  | 画面は生成物の型を直接読む(1408行)                                                                                                        | `frontend/006`の38行は変換を操作ごとに`src/graphql/<内容>.ts`(単体テスト付き)に置き、部品は生成物の型に直接依存しないと定める。前例は`src/graphql/admin-sponsorships.ts`など                                                                                                                                             |
| 22  | 一覧のページは`validateSearch`だけ(1398行)                                                                                                | `frontend/014`の103-130行は`loaderDeps`・`loader`(`cause !== 'stay'`の時だけ待つ)・`useQuery`の`placeholderData: keepPreviousData`、ページ送りは`utilities/pagination/cursor-trail.ts`。前例は`routes/_authenticated/sponsorships/index.tsx`                                                                             |
| 23  | ルートは`routes/_authenticated/users.tsx`などの平置き(271-273行)                                                                          | 既存は`<メニュー>/index.tsx`、ページの部品は`components/pages/<x>-page.tsx`、題名は`buildAdminPageHead`、文言は`<機能>-messages.ts`(単体テスト付き)                                                                                                                                                                      |
| 24  | `ADMIN_PRODUCT_DETAIL_SECTIONS`の型は`admin-product-detail-section-types.ts`、項目は`{ id, order, component }`                            | 前例は文脈の型を登録箇所と同じファイルに置き(`composition/inquiry-detail-actions.ts`)、見出しを持つ区画は`title`を持つ(`admin-settings-sections.ts`)。部品が取得する区画は`RecoverableSlot`で包む(`frontend/006`の129-150行)                                                                                             |
| 25  | グラフのSSRの検査を、タスク7.9は単体テストの`renderToString`、design.mdの1485行はブラウザテストとする                                     | 単体テストのパターンは`**/*.unit.test.ts`だけで`.tsx`は拾われない(`config/test-patterns.ts:6`)。ブラウザテストに統一する                                                                                                                                                                                                 |
| 26  | 「テストなし」のファイル(`moderation-types.ts`・`admin-product-detail-section-types.ts`)                                                  | カバレッジはファイルごとに80%。型だけのファイル以外は分母に入る                                                                                                                                                                                                                                                          |
| 27  | DBのテスト                                                                                                                                | `schema/<ドメイン>/<ドメイン>-migration.unit.test.ts`(マイグレーションの文の照合)・`apps/db/<spec>-schema.worker.test.ts`(D1の制約)・`schema/index.unit.test.ts`のテーブル名の一覧の3点が前例                                                                                                                            |
| 28  | E2Eは`e2e/admin/*.e2e.test.ts`と`e2e/support/moderation-fixtures.ts`だけ                                                                  | 既存のテストは画面の手順の`<名前>-steps.ts`と`e2e/admin/admin-test.ts`の`test`(送信元IPを分ける拡張)を使う。補助はSQLを組み立てる純粋な関数を`<x>-fixture-sql.ts`(単体テスト付き)に分ける慣例(`e2e/support/sponsorship-fixtures.ts`)                                                                                     |
| 29  | ブラウザテストの部品                                                                                                                      | テスト用のルーター`apps/admin/test/page-router.tsx`の`renderInRouter`と`execute-graphql.ts`の`vi.mock`、fixtureは`apps/admin/test/<機能>-fixtures.ts`                                                                                                                                                                    |

#### 上流の新しい機能による変化

- 停止・非公開化・退会の一括の書き込みには、他specの同期の処理(product-launchのローンチの取り消し、match-engineのマッチの終了、directory-discoveryの索引の除去、sponsorshipの表示停止、退会では`public-api.api-key-erasure`)が入り、それらの文の失敗で本specの記録ごと取り消される(設計の「一体の確定」のとおり)。
- 停止では非同期の`payments.open-checkout-expiry`(410)と`ultras-subscription.subscription-cancellation`(500)も動く。決済中のセッションの失効は、設計の範囲外の一覧(47行)に無い。通知メールの文に影響するかを確かめる。
- tournament-week・tournament-yearの処理は退会と論理削除だけに登録され、停止・非公開化は組み合わせ決定の時点の分類で除外と全額返金になる(要件の仮8のとおり)。
- 公開APIにより、停止中の利用者のAPIキーの書き込みは`requireWritableUser`で拒否される。
- `buildAuditLogStatements`に第3引数`AuditGuard`(条件を満たさなければ一括の書き込み全体を取り消す、`isAuditGuardRejection`で判定)が加わった。G1の案Aや記録の条件付きの書き込みに使える可能性がある。
- 4:21の1回の起動の合計に300秒の予算があり、超えると警告が出る(`composition/scheduled-jobs.ts:135-136`)。本specの1910(送り直し100件+記録の削除500件×最大10回)の所要時間を見積もる。
- `summarizeDaily`の予選実施数は不戦勝と開始時点の決着を除き、Upvote数は確定したマッチをマッチの日付で数える。マッチは当日23:40に終わるため、要件2.4の「その週に確定したマッチ」と実際上は一致する(終了が遅れて翌週に確定したマッチは、確定済みの週に入らない)。
- api・eventの型検査は4つのプログラムに分かれた。ファイルの命名どおりに置けば自動で振り分けられる見込みである。

### 実装の方式の選択肢

#### 案A: 設計の構成を保ち、局所的な修正だけを反映する

- 措置の記録の一体の確定(保留中の措置と同期の処理、engagementの`statements`)、画像の操作の後の記録、上流の照会の利用はそのままにし、上の「局所的な修正」とU1〜U8を反映する。G1は「再実行で記録が欠け得る」をRisksに残す。
- ✅ 設計の変更が最小で、上流は全て設計どおりに使える。
- ❌ 画像の4つの操作で、監査ログの欠けが仕組みとして残る。

#### 案B: 画像の操作もengagementと同じ「操作口が呼び出し側の文を受け取る」形にそろえる

- media-pipelineの`MediaQuarantine.addReason`・`removeReason`・`MediaFiles.eraseNow`に`statements?`を足し、理由の変更(または削除待ちの印)と記録と監査ログを同じ一括の書き込みにする(G1の案C)。
- ✅ 全ての措置が「状態の変更と記録が一体」という同じ規則になり、`backend/021`の説明も1つで済む。
- ❌ media-pipelineの共有ディレクトリ(`workers/media`)の契約とテストの変更を伴い、上流のRevalidation Triggersに当たる。

#### 案C: 記録の書き込みの順序だけを本spec内で改める(混合)

- 画像の操作は記録と監査ログを先に書き(G1の案A)、他の措置は設計どおりにする。媒体の操作が失敗したら、記録の`notice_status`と同じ要領で「媒体の操作の結果」を持たせるか、監査ログの詳細に結果を残すかを決める。
- ✅ 上流を変えずに監査ログの欠けを無くせる。
- ❌ 「記録があるのに反映されていない」状態が生まれ、記録の意味が他の措置と異なる。

### 規模とリスク

- **規模: XL(2週間以上)**。上流の部品は揃っているが、2テーブル・措置のユースケース6つと照会6つ・同期の処理2つとジョブ2つ・eventの処理2つ・メールの3種別とテンプレート・GraphQLの照会9つと措置13・管理画面の5ページとカードとグラフ(新しいパッケージ)・E2Eの6シナリオ・技術ドキュメント3本とサービス仕様の追記を新しく作り、上流のテストと文書8箇所を更新するため。public-api(L)の約1.5倍のサブタスクがある。
- **リスク: Medium**。既存のパターン(ライフサイクルの同期の処理、engagementの`statements`、`core`/`workers`の配置、管理画面の一覧と確認のダイアログ)に沿って作れる一方、画像の操作の記録の一体性(G1)・Rechartsとshadcn/uiの`chart`とCSP・生のHTMLの検査の相性(G3)・確認のダイアログの表現(G2)は、決めるまで不確定である。

### 設計フェーズ(設計の改訂)への申し送り

- 上の「振る舞いか上流の変更を伴うもの」のG1〜G4と、U4の`DenyAllAdminMediaReviewPolicy`の扱い、局所的な修正の12(`invalid_cursor`の扱い)を開発者に1件ずつ確かめ、design.mdとtasks.mdへ反映する。
- 局所的な修正の1〜29とU1〜U8を、design.mdの各コンポーネントの手順・File Structure Plan・Modified Files・Testing Strategyとtasks.mdの完了条件へ反映する。特に1(`AppError`の`internal`)・2(application層の`captureEvent`)・3(DBからcommon-libの読み込み)・7(`adminOnly`)・10(保留中の措置のスコープ)・U1〜U3・U6は、実装でそのまま型検査・静的解析・既存のテストの失敗になる。
- spec.jsonは`ready_for_implementation: false`のままである。上の反映の後に実装へ進む。

### Research Needed

- shadcn/uiの`chart`の`ChartStyle`の実際の実装(`dangerouslySetInnerHTML`の使用)と、導入するRecharts 3系の版とpeerの`react-is`の要否。Rechartsの読み込みの大きさと、遅延読み込みの要否。
- 4:21の本specの2つのジョブ(統計の集計の6つの照会、送り直し100件、記録の削除最大5,000件)の所要時間と、300秒の予算への影響。
- 停止で動く`payments.open-checkout-expiry`による決済中のセッションの失効を、停止の通知メールで伝える必要があるか(要件12.4の固定の段落との関係)。

## 実装前のギャップ分析の決定の反映(2026-11-20、開発者の決定)

ギャップ分析の「振る舞いか上流の変更を伴うもの」のG1〜G4と、申し送りの`DenyAllAdminMediaReviewPolicy`の扱い・`invalid_cursor`の扱い、Research Neededから判断に移したRechartsの読み込み方を、開発者に1件ずつ確かめた。7件とも推奨の案に確定した。

| 論点                                          | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 推奨との関係 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| G1 画像の操作の再実行で記録と監査ログが欠ける | media-pipelineの`workers/media`に、呼び出し側の文を受け取る`MediaModerationControl`(`addReason`・`removeReason`・`requestErase`)を本specが加える。本specのinfrastructure層の`ControlImageModerationWriter`が記録と監査ログの文を渡し、理由の変更(または削除待ちの印)と同じ一括の書き込みで確定する。application層のポートは`ModerationRecordWriter`を`ImageModerationWriter`に置き換える。確定の後の移動の依頼・即時の削除の失敗は`storage_unavailable`で、状態と記録は残り、日次の照合(830)と削除(810)がそろえる。再実行は、隔離は移動を依頼し直して変化なし、隔離の解除・公開承認は`image_action_not_applicable`、削除は変化なしで、記録を重ねない。削除済みの再実行の矛盾(421行と1041行)は、削除待ちなら変化なし・記録が無ければ`image_not_found`に統一した | 推奨どおり   |
| G2 確認のダイアログの影響の一覧               | `ConfirmActionDialog`は変えず、措置の影響を`description`の文の中に含める(sponsorshipの強制終了のダイアログと同じ)。要件4.12・5.12・8.11は影響を「示す」と定めるだけのため、受け入れ基準は変えない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 推奨どおり   |
| G3 shadcn/uiの`chart`と生のHTMLの検査         | shadcn/uiの`chart`を写さず、Rechartsの部品を直接使う。色は配色のトークンのCSSの変数を属性で渡し、`<style>`を注入しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 推奨どおり   |
| Rechartsの読み込み方                          | Rechartsを読み込む部品を動的な`import()`で別のチャンクにし、`ClientOnly`の中で`React.lazy`と`Suspense`で読み込む。読み込み中は同じ高さの空の枠を出す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 推奨どおり   |
| G4 統計のテーブルの主キー                     | `ulidPrimaryKey()`を主キーにし、`week_start`に一意索引を張る。upsertは一意索引を対象にした`ON CONFLICT(week_start)`で行う                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 推奨どおり   |
| `DenyAllAdminMediaReviewPolicy`の扱い         | 束縛の差し替えの後に使われなくなるため、本体と同名の単体テストを削除し、全拒否を使っていたテストは試験用の判定に置き換える。media-pipelineのdesign.mdには差し替えて削除した旨の注記を加える(タスク3.7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 推奨どおり   |
| `invalid_cursor`の扱い                        | 上流の4つの管理画面の照会が投げる`invalid_cursor`(400)と文言を変換せずに返し、エラーコードの一覧と文言に載せる(public-apiの2026-11-19の決定と同じ)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 推奨どおり   |

- **要件**: 決定はいずれも受け入れ基準の範囲内のため、requirements.mdは変えていない。G1により、画像の操作も要件13.4(状態を変える措置の監査ログと措置の記録を状態の変更と同じ一括の書き込みで確定する)を満たすようになった。
- **変えた箇所**: design.mdのThis Spec Owns(書き込みの単位)・Out of Boundary(media-pipeline)・Allowed Dependencies(media-pipeline)・Revalidation Triggers・上流への影響の表(media-pipeline・frontend-platform)・Existing Architecture Analysis・Architecture Integration・Dependency direction・Technology Stack・File Structure Plan(`control-image-moderation-writer.ts`・`workers/media/media-moderation-control.ts`・グラフの2つのファイル・ダイアログの注記)・Modified Files(media-pipelineの識別子と束縛、全拒否の削除)・画像の操作の流れ・コンポーネントの表・`ImageModerationWriter`と`MediaModerationControl`の契約と手順・`ImageModerationService`・エラーコードとError Categories・文言・Physical Data Model・統計のupsertの記述・画面の部品の表(`WeeklyStatisticsChart`・`ModerationActionDialog`)・Testing Strategy。tasks.mdの2.2・2.3、新しい2.5(媒体の操作口と画像の書き込みの単位)、3.5・3.7・4.7・4.8・6.2・7.2・7.9・8.2。
- **残り**: ギャップ分析の「局所的な修正で済むもの」の1〜29と「上流のファイルの変更を伴うが方針が明らかなもの」のU1〜U3・U5〜U8は、まだdesign.mdとtasks.mdへ反映していない(U4はタスク3.7に反映した)。spec.jsonは、反映の後に開発者の指示で`ready_for_implementation`を`true`にした(2026-11-20)。

## 実装前のギャップ分析の局所的な修正の反映(2026-11-20、開発者の指示)

- **状態**: ギャップ分析の「設計の記述の局所的な修正で済むもの」の1〜29と「上流のファイルの変更を伴うが方針が明らかなもの」のU1〜U3・U5〜U8を、開発者の指示で推奨どおりdesign.mdとtasks.mdへ反映した(U4と12は決定の反映で済んでいた)。要件と受け入れ基準は変えていない。
- **反映で決めた細部**(ギャップ分析が「書く」とだけ申し送った点):
  - 定型の通知のポートは`ModerationIncidentReporter`(application層)、実装は`SentryModerationIncidentReporter`(infrastructure層)とし、理由は`moderation-record-missing`・`statistics-failed`・`notice-redispatch-failed`の3つ、指紋は`['moderation', <理由>]`、タグは`moderation_incident`と`job`にした(`ProductIncidentReporter`の前例)。
  - 束縛の誤り・呼び出し側の誤り(登録の無い参加の種類、保留中の措置の二重の設定、画像の操作への参加)は、存在しない`AppError`の種類`internal`の代わりに通常の`Error`にした(運用者に知らせる失敗を`AppError`で投げない規則)。
  - 通知メールの`contactUrl`は、問い合わせの経路の共通の定数が無いため、identity-authと同じく通知の部品の中の定数で組み立てる。共通の定数は新設しない。
  - 送信の依頼に冪等のキーが無いことによる二重の依頼の可能性を「Risks & Mitigations」に加えた。要件12.8(同じ措置の通知を2回以上依頼しない)は、依頼済みへの更新だけが失敗したときに限って満たせない。
  - 上流の値の写しの照合(隔離理由・使い捨て判定・ローンチ状態・コメントの状態)とDBのCHECKの値の写しの照合は、ルートの`config/ugc-moderation-contract-copies.unit.test.ts`の1ファイルにまとめた。
  - 管理者側の画面の変換とloaderのファイルは`src/graphql/admin-moderation-users.ts`・`admin-moderation-products.ts`・`admin-moderation-engagement.ts`・`admin-quarantined-images.ts`・`admin-weekly-statistics.ts`に分けた。文言は`components/moderation/shared/moderation-messages.ts`の1ファイルにした。
  - 区画の登録口の項目に、失敗の表示の見出しに使う`title`を加えた(後続のcontent-reportingが使う登録口のため、Revalidation Triggersの`AdminProductDetailContext`の形の変化に当たる。content-reportingのdesign.mdの登録の行に`title`を加えた)。
- **変えた箇所**: design.mdのAllowed Dependencies(backend-platform・api-gateway・identity-auth・product-launch・media-pipeline・match-engine)・Dependency direction・File Structure Plan(ディレクトリ構成の全体と後の注記)・Modified Files(U1〜U3・U5〜U8、DBのテーブル名の一覧、メールの対の追加)・コンポーネントの表(定型の通知の行)・ModerationActions・ModerationLabels(写しの照合)・ModerationEmailKinds(`contactUrl`と冪等のキー)・識別子の文字列・`ModerationIncidentReporter`と`PendingModerationRecord`のスコープ・`PreparedAuditEntry`の置き場所・`UserModerationService`の不在の変換・ジョブの表・ModerationSchemaModule(接続の組み立て・`adminOnly`・`satisfies Resolvers`・IDの検証・エラーの置き場所・隔離画像の写像・生成のコマンド)・画面の部品の表(週の開始日・loader・`AdminMediaImage`・区画の登録口)と後の規約(変換のファイル・ページの配置)・Error Categories・Monitoring・Testing Strategy。tasks.mdの1.1〜1.5・2.2〜2.4・3.1・4.2〜4.8・5・6.1〜6.5・6.9・7.2・7.3・7.5〜7.8・7.10・8.2・8.3。research.mdのRisks & Mitigations。content-reportingのdesign.mdの`ADMIN_PRODUCT_DETAIL_SECTIONS`の登録の行。
- **残り**: Research Neededの3件(Rechartsの版と`react-is`の要否、4:21の300秒の予算への影響、停止で動く決済中のセッションの失効を停止の通知で伝えるか)は実装のタスクの中で確かめる。spec.jsonは、反映の後に開発者の指示で`ready_for_implementation`を`true`にした(2026-11-20)。
