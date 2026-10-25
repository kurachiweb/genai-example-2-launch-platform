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
- **Implications**: 処理単位で1つの`PendingModerationRecord`に措置の記録と準備済みの監査ログを置き、同期の処理がイベントの種類と対象の一致で取り出して文を返す。措置でないイベント(本人の退会など)では何も返さない。上流の形は変えない。取り出し漏れ(束縛の誤り)は`captureMessage`で検知する。

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
| 要求単位の保留中の措置+同期の処理(採用)      | 上流の確定の一括の書き込みに、同期の処理として記録と監査ログの文を載せる | 上流の形を変えずに一体の確定。product-launchの設計の想定どおり | 同期の処理が処理単位のコンテナから解決されることに依存する         | 取り出し漏れを`captureMessage`で検知    |
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

- 同期の処理が処理単位のコンテナから解決されない(上流の実装の差) — Workers統合テストで本物の`UserSuspension`・`ProductVisibilityControl`を通して確かめ、取り出し漏れを`captureMessage`で検知する。外れた場合は上流の操作口への`statements`の追加を上流specへ依頼する(代替案)。
- 部分一致の検索が利用者・プロダクトの増加で遅くなる — 1ページ50件とカーソルで抑え、launch-readinessの性能の検証で全文検索や前方一致への切り替えを判断する。
- 統計のジョブの停止で週が欠ける — `captureMessage`で検知し、欠けた週は表に出さない(値を推測しない)。
- 代理の退会の取り違え — 最上位管理者だけに限り、理由を必須にし、監査ログで追跡する。本人の意思の確かめはシステムの外の運用で行う(仮4)。
- 管理者側のCSPが同一オリジンの画像を許さない — タスクで確かめ、必要ならfrontend-platformへ`img-src 'self'`を依頼する。

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
- payments(上流): `RevenuePeriod`(`{ from: Date; to: Date }`)・`PaymentRevenueReport`(`netRevenue(periods: readonly RevenuePeriod[]): Promise<readonly MinorUnitAmount[]>`)は、paymentsの仮7が`apps/backend-lib/core/payments/ports.ts`・`identifiers.ts`の`PAYMENTS_TYPES.PaymentRevenueReport`・`workers/payments/d1-payment-revenue-report.ts`に実装し、`PAYMENTS_PLATFORM_MODULE`で束縛する(2026-10-24に開発者が確定、paymentsのタスク5.5・5.7。本specは使うだけ。純収益の定義はpaymentsの要件12.10を正とし、敗北が確定したチャージバックは負の額の`disputed`の行を`dispute_lost`の期間で差し引く。統計の群)。返金は依頼しない(仮8)。
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
- 1回目の判断のレビューで、(1)プロダクト一覧のカテゴリの選択肢の照会が曖昧だったため`adminProductCategories`を加えた、(2)ユーザー一覧のプロフィール画像の隔離に要る隔離理由の照会(`MediaFiles.findMany`)を照会の処理に加えた、(3)管理者側のCSPが同一オリジンの画像を許す前提をSecurity Considerationsに明記した、(4)部品の表の要件の範囲の書き方(`4.x`)を明示の番号に直し、文書の半角スペースの規則の違反(表のセル・コードの注記)を直した。2回目で問題は無かった。
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
