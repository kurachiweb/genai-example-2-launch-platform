# Research & Design Decisions

## Summary

- **Feature**: `product-launch`
- **Discovery Scope**: Complex Integration(プロダクトとローンチの実装は無い。上流の15spec(dev-tooling〜user-profile-social)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはidentity-authの`users`・ライフサイクルの登録口・`AccountGuard`、user-profile-socialのハンドル基盤と公開プロフィールのタブの登録口、media-pipelineの画像の部品と隔離理由、content-processingのマークダウンの部品、ultras-subscriptionの特典の判定と導線の表示の可否、admin-foundationの権限・監査ログ・カテゴリの編集部品、inquiry-chatのカテゴリのページの区画の登録口の上に、プロダクト・ローンチ・プロダクトカテゴリ・プロダクトライフサイクルイベントを足す)
- **Key Findings**:
  - 再ローンチ規則(`docs/GUIDES/service/overview/006-relaunch-rules.md`)が、roadmapの論点(Week優勝作の約1年の禁止・トーナメント敗退後の禁止期間)の答えを既に書いている(計算例で、準々決勝敗退の後はFR-PRDCT-002だけに従う)。ただしbriefとroadmapが要件フェーズでの確認を求めているため、仮1として記録した。
  - ローンチの状態(予定・ペアリング済み・マッチ中・終了・取消)は、ローンチ日・予選の結果・取消の日時と現在時刻から導ける。ペアリングの時刻(前日23:45)とマッチの開始(0:00)は日次タイムラインで固定のため、マッチ直前・マッチ中の固定の予選の部分と、次回の予約の禁止(FR-RELCH-006)を、本specがmatch-engineの実装に依存せずに判定できる。予選の結果だけはmatch-engineが本specへ記録する。
  - ユーザーの物理削除(`purge_due`)の波及処理は帯の値の昇順に動くため、本spec(1000番台)がプロダクトの行を消すと、後続(match-engineの1100番台など)が紐付けを解除する前になる。帯の外の値を使わずに解決するため、プロダクトの物理削除をプロダクトライフサイクルイベント`purge_due`として本specの実行器で行い、後続specは自分の紐付けの解除をプロダクトの`purge_due`の処理として登録する。本specのユーザーの`purge_due`(1000)は、その利用者のプロダクトの`purge_due`を作り、全て消えるまで`continue`を返す。
  - api-gatewayの規約で、ルート型以外の型を複数のスキーマモジュールで定義できない(`extend`を使わない)。後続spec(トーナメント)がローンチ履歴の項目へ受賞や結果の要約を足すには、本specのapplication層に供給元の登録口を設ける必要がある。

## 要件フェーズ前の確認事項(2026-10-23)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を「仮」として採用した。**2026-10-24に開発者が仮1〜仮14の全てを確定した(仮10は先に確定)。仮4は推奨と異なるB(今日から90日後まで)、仮5の旧ハンドルの扱いはuser-profile-socialの仮2の決定(B)に合わせ、他は推奨どおりである。** 設計の後にdirectory-discoveryの依頼で加えた仮11は「仮決定(2026-10-24に開発者が確定)」の表と「Decision: 保存の登録口とカテゴリの条件を加える(仮11)」に記録した。 決定は`requirements.md`の「要件フェーズでの仮決定」にも記録する。roadmapの「Requirement Ambiguities」の表の「Week優勝作がYear確定まで最長約1年再ローンチできない意図、トーナメント敗退後の禁止期間」の行(product-launch・tournament-weekの担当)は、仮1で本specの持ち分を決めた。roadmapは編集せず、解決の列の文言をコントローラーへ報告する。

| #    | 論点                                                 | 根拠                                                                                                                                                                                                                            | 選択肢                                                                                                                                                                                                          | 推奨と仮の採用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1  | FR-RELCH-004の意図とトーナメント敗退後の禁止期間     | FR-RELCH-002〜004、再ローンチ規則の「間隔制限の解釈」「Weekトーナメント優勝 → 再ローンチ」と計算例(準々決勝敗退の後はFR-PRDCT-002だけ)、briefのConstraints、roadmapのRequirement Ambiguities                                    | (A)規則の文書のとおり、Week優勝作はYearの結果確定まで禁止し、トーナメントの結果の確定後は禁止期間を掛けない / (B)トーナメント敗退後も7日・2日を掛ける / (C)Week優勝作の禁止をYearの組み合わせ決定までに短くする | 推奨・仮の採用は(A)。サービス仕様の計算例と制限の意図(同一プロダクトが並行して参加資格を持つことを防ぐ)に一致する。敗北後の間隔はFR-RELCH-002・003の「予選に敗北した場合」に限られ、トーナメントの敗退は予選の敗北ではない。(C)は要件定義書の改訂を要する。本specは予選の結果だけで間隔を判定し、トーナメントの条件はtournament-week・tournament-yearが拡張点に供給する **2026-10-24に開発者が推奨どおりに確定した。**                                                                                                           |
| 仮2  | 登録時のローンチ日                                   | FR-PRDCT-001(必須項目にローンチ日が無い)、FR-PRDCT-002(登録・編集時にローンチ日を選ばせる)、要件定義書1.3の「ローンチ: プロダクトを投稿し公開すること」、ページ配置(ヘッダーの「ローンチする」は登録画面へ)                     | (A)登録ではローンチ日を必須にし、登録と同時に最初のローンチを予約する / (B)任意にし、ローンチ日の無いプロダクトを許す                                                                                           | 推奨・仮の採用は(A)。登録はローンチの予約のための操作で、(B)では誰にも見えないプロダクトの状態が増え、自分のプロダクトの画面と次回の予約の判定に「未予約」の分岐が要る **2026-10-24に開発者が推奨どおりに確定した。**                                                                                                                                                                                                                                                                                                            |
| 仮3  | 予約済みのローンチの取りやめ                         | FR-PRDCT-014(ローンチ日の変更と論理削除だけを挙げる)、再ローンチ規則の「予約済みローンチの扱い」(取りやめの記載が無い)                                                                                                          | (A)取りやめを設けず、ローンチ日の変更と削除だけ / (B)マッチ直前より前なら取りやめられる                                                                                                                         | 推奨・仮の採用は(A)。要件定義書に無い操作で、(B)ではローンチの無いプロダクトの状態(仮2の(B)と同じ)と、取りやめたローンチの間隔の扱いが要る **2026-10-24に開発者が推奨どおりに確定した。**                                                                                                                                                                                                                                                                                                                                        |
| 仮4  | 選べるローンチ日の上限                               | FR-PRDCT-002(下限だけを定める)、NFR-SECUR-012(入力の境界検証)、ページ配置(カレンダー)                                                                                                                                           | (A)今日から365日後まで / (B)90日後まで / (C)上限なし                                                                                                                                                            | 推奨・仮の採用は(A)。カレンダーの表示と入力の検証に上限が要る。1年あれば年次のトーナメントをまたぐ計画にも足り、極端な先の予約で次回の予約の禁止(FR-RELCH-006)を長く保つ使い方を抑える **2026-10-24に開発者が確定: 推奨と異なる(B)今日から90日後までを採用した。**                                                                                                                                                                                                                                                               |
| 仮5  | 論理削除したプロダクトのハンドル                     | FR-PRDCT-010(「未退会ユーザーや退会後未削除のユーザーが登録した他プロダクトによって設定済み」)、FR-PRDCT-020・021、FR-USER-019、user-profile-socialの仮2(当時の仮は「他の対象の旧ハンドルを使用中とする」。2026-10-24にBで確定) | (A)物理削除まで現在・旧ハンドルとも使用中とし、旧ハンドルの転送は論理削除で止める / (B)論理削除の時点で解放する                                                                                                 | 推奨・仮の採用は(A)。行は物理削除まで残り、ハンドルの一意索引もそれまで効く。退会後未削除の利用者のプロダクトを使用中とする要件と同じ扱いになり、削除直後のハンドルを他人が取って共有済みのリンクを乗っ取ることを防ぐ。14日で解放される **2026-10-24に開発者が確定: 現在のハンドルは(A)のとおり物理削除まで使用中、旧ハンドルの転送は論理削除で止める。旧ハンドル自体は、user-profile-socialの仮2の決定(B: 他者も設定でき、設定された時点で元の保持者の旧ハンドルを消す)に合わせて、他のプロダクトが設定できる(推奨と異なる)。** |
| 仮6  | スクリーンショットの枚数                             | FR-PRDCT-006(「1度に20枚まで、プロダクトあたり合計10MBまで」)、ページ配置(「3 / 10」の位置表示)                                                                                                                                 | (A)プロダクトあたりも20枚まで / (B)1回の選択は20枚まで、プロダクトあたりの枚数は合計10MBだけで制限する                                                                                                          | 推奨・仮の採用は(A)。編集画面は保存のたびに全件を送るため「1度に」と「プロダクトあたり」を同じ値にすると利用者に分かりやすい。(B)は小さな画像で枚数が際限なく増え、詳細ページの横スクロールが長くなる **2026-10-24に開発者が推奨どおりに確定した。**                                                                                                                                                                                                                                                                             |
| 仮7  | 非公開化中のプロダクトに投稿者ができること           | FR-ADMUG-009(非公開化と復元)、FR-ADMUG-010(未開始の予定の取り消し)、FR-USER-026(停止中の書き込みの拒否はユーザーに限る)、ページ配置(非公開化されたプロダクトは本人にも404)                                                      | (A)内容の編集と削除はでき、次回の予約はできない / (B)削除だけができる / (C)すべてできる                                                                                                                         | 推奨・仮の採用は(A)。投稿者が問題を直して運営へ復元を依頼できる。非公開化中に予約できると、ペアリングで可視でないプロダクトを除く判定が必要になり、復元の前に組まれる予約が生じる **2026-10-24に開発者が推奨どおりに確定した。**                                                                                                                                                                                                                                                                                                 |
| 仮8  | プロダクトカテゴリ名の重複・「その他」の保護・並び順 | FR-ADMCF-008・010、inquiry-chatの仮1(名前の一意)・仮2(「その他」の名前の変更の拒否、追加の順・末尾)、ページ配置(「その他」のハンドルは`other`)                                                                                  | (A)名前を一意、「その他」は削除・名前とハンドルの変更を拒否、追加の順で「その他」を末尾 / (B)名前の重複を許し、「その他」の名前は変えられる                                                                     | 推奨・仮の採用は(A)。管理画面のカテゴリのページで問い合わせカテゴリと同じ振る舞いになる。「その他」のハンドルはページ配置で`other`と決まっているため変えられないようにする **2026-10-24に開発者が推奨どおりに確定した。**                                                                                                                                                                                                                                                                                                        |
| 仮9  | カテゴリの削除の拒否で数えるプロダクト               | FR-ADMCF-011(「1件以上のプロダクトが紐付くカテゴリ」)、FR-PRDCT-024(論理削除から14日以内に物理削除)                                                                                                                             | (A)論理削除後に物理削除されていないプロダクトも数え、削除を拒否する / (B)論理削除済みを数えず、削除時にそれらを「その他」へ付け替える                                                                           | 推奨・仮の採用は(A)。プロダクトの行がカテゴリを参照している間は削除できず、付け替えるとデータエクスポートの`category`(エクスポート時点のカテゴリ名)が変わる。14日待てば削除できる **2026-10-24に開発者が推奨どおりに確定した。**                                                                                                                                                                                                                                                                                                 |
| 仮10 | カレンダーの部品(2026-10-24に開発者が承認して確定)   | CLAUDE.md(新しいパッケージは候補を挙げて質問する)、ページ配置(カレンダーで選び、選択不可の日をグレーアウトして理由をツールチップで示す)、tech-stack.md(UIはshadcn/ui)                                                           | (A)shadcn/uiのカレンダー(`react-day-picker`の9系) / (B)依存の無い月表示の部品を自作する / (C)ブラウザの日付入力欄                                                                                               | 推奨・仮の採用は(A)。shadcn/uiの公式の部品で、キーボード操作と読み上げに対応し、日ごとの無効化と表示の差し替えができる。ブラウザだけで動き、workerdには載らない。directory-discoveryの期間の指定(ページ配置)でも再利用できる。(C)は日ごとの理由を示せない。採用の確認の後にtech-stack.mdと版の管理の文書へ追記する                                                                                                                                                                                                               |

### 確認済みのため質問しない事項

- ローンチ日の下限: 23:40より前は翌日以降、23:40以降は翌々日以降(FR-PRDCT-002、日次タイムライン)。
- 敗北後の間隔: 直近のローンチ日の0:00から7日(Ultrasは2日)を経過するまでの日は選べない。ローンチ日の前日までが禁止で、`ローンチ日 + 7日`(`+ 2日`)以降を選べる(再ローンチ規則の計算例: 09-07の敗北で09-14・09-09)。両者敗北も敗北(予選ルール)。取消のローンチは直近の判定から除く。
- Ultrasの判定時点: ローンチ日を登録・編集する時点。`past_due`も加入中(再ローンチ規則・ultras-subscriptionの`isEntitledAt`の規則)。予約の後の解約・特典の終了は予約を変えない。
- FR-RELCH-006の「未開始または進行中の予選」は、ローンチ予定・ペアリング済み・マッチ中を指し、取消は含めない(再ローンチ規則)。
- FR-PRDCT-014の固定の期間: 予選はペアリング後(前日23:45)から終了まで、トーナメントは組み合わせ決定後または前ラウンド勝利後からマッチ終了まで(ページ配置)。予選勝利〜組み合わせ決定前は削除できる(ページ配置)。
- 非公開化・停止で取り消したローンチは、復元・停止解除で戻さない(再ローンチ規則の「予約済みローンチの扱い」)。
- 退会ではプロダクト・ローンチ・プロダクトの旧ハンドルを論理削除し(FR-PRDCT-015・FR-USER-019)、user-profile-socialは「プロダクトの退会時の旧ハンドルの論理削除は product-launchが自分の同期の波及処理で行う」と申し送っている。
- ファイルの保有者: プロダクトの画像はアップロードした利用者が保有する(media-pipelineの`MediaOwner`は利用者・管理者だけ)。停止に伴う隔離`user_suspended`と退会者の全ファイルの物理削除は、user-profile-socialの波及処理が保有者単位で行うため、本specは行わない。非公開化に伴う隔離`product_hidden`は本specがファイルのIDで行う(FR-ADMUG-047)。
- 容量: ロゴ512,000バイト、スクリーンショット1枚5,242,880バイト・合計10,485,760バイト(文言規則の容量の単位、brief)。画像用の用途の上限`IMAGE_STORAGE_MAX_BYTES`(20,000,000)以下。
- 予約語: ユーザーとプロダクトは同じ14語(ページ配置、user-profile-socialの`IMPERSONATION_RESERVED_HANDLES`)。プロダクトカテゴリのハンドルはFR-ADMCF-008が「FR-PRDCT-008と同様の方式」(形式と大文字小文字を区別しない一意)とするだけで予約語の要件が無く、ディレクトリのクエリ`category`にだけ使うため予約語を持たない。旧ハンドルも持たない(ページ配置)。
- 監査ログ: FR-ADMAG-001がFR-ADMCF-008の操作を対象に挙げる。理由は任意(要件の「理由付き」でないため、admin-foundationのQ6)。
- bot対策: 登録・編集・削除(FR-PRDCT-016)。メールアドレス未確認の制限(FR-USER-006)は「プロダクトの投稿」なので登録に掛け、既存のプロダクトの編集・削除には掛けない。
- 自分のプロダクトの画面・登録・編集の画面のモックアップは無く、本specがページ配置・デザイン原則・文言規則に従って設計する(brief)。
- 波及処理とジョブの`order`: 本specの1000番台(roadmapの帯の割り当て)。上流の値より前に動く必要のある処理は無い(物理削除の順序の課題は、プロダクトのライフサイクルイベントの中で解決した)。
- 新しいパッケージ: 仮10のカレンダー(`react-day-picker`)だけ。2026-10-24に開発者が承認して確定した。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(user-profile-socialと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(プロダクトライフサイクルイベント・可視性フィルタ・ハンドル基盤・プラン判定・再ローンチ可否ポリシー・Cron・Queuesのディスパッチ・画面シェル・データエクスポートの出力・監査ログ・容量の単位)。
- **Sources Consulted**: identity-auth・user-profile-social・media-pipeline・content-processing・ultras-subscription・admin-foundation・inquiry-chat・api-gateway・backend-platform・frontend-platformの`design.md`、user-profile-social・ultras-subscriptionの`research.md`の後続specへの申し送り、match-engine・directory-discovery・tournament-week・tournament-year・ugc-moderation・sponsorship・data-export・public-apiのbrief。
- **Findings**:
  - identity-auth: 同期の波及処理`UserLifecycleSyncRegistration`(apiの`USER_LIFECYCLE_SYNC_HANDLERS`、`withdrawn`・`suspended`・`unsuspended`、利用者IDを条件にした集合の更新の文だけを返す)、非同期の波及処理`UserLifecycleAsyncRegistration`(eventの`USER_LIFECYCLE_ASYNC_HANDLERS`、`done`・`continue`、`order`の重複は同じ種類の中で拒否)。`purge_due`の全波及処理の後に`users`を消すため、本specの`users`への外部キーを持つ行(プロダクト)はそれより前に消す。`commitWithdrawal`・`UserLifecycleCommitter`の`CASE`式のNOT NULL制約の違反による一括の書き込みの取り消し、`LifecycleHandlerOutcome`・`assertLifecycleHandlerName`・`USER_LIFECYCLE_RETRY_POLICY`(5回・300秒から倍・上限3600秒)・`LIFECYCLE_CONTINUE_DELAY_SECONDS`(5)。`AccountGuard`(`requireUser`・`requireWritableUser`・`requireVerifiedUser`)、`visibleUsers()`、`_authenticated`のレイアウト、`AccountMenu`(`/my/products`)・`LaunchAction`(`/my/products/new`)。
  - user-profile-social: `common-lib/handles`(`HANDLE_PATTERN`・`checkHandleFormat`・`toHandleKey`・`isSameHandle`・`isReservedHandle`・`IMPERSONATION_RESERVED_HANDLES`)、`apps/db`の`previousHandleColumns`、`backend-lib/workers/handles`(`defineHandleNamespace`・`resolveHandle`・`isHandleOccupied`・`handleOccupiedCondition`・`previousHandleUpsert`・`previousHandleSoftDelete`・`previousHandleDelete`・`previousHandleRelease`)。使用中の判定は、user-profile-socialの仮2の決定(B、2026-10-24に確定)により他の対象の現在のハンドル(全行)だけで、本人を`exceptOwnerId`で除く。他の対象の旧ハンドルは使用中とせず、それを設定したときは`previousHandleRelease`が元の保持者の旧ハンドルの行を消す。`common-lib/url/external-url.ts`(`checkExternalUrl`・`externalUrlHost`、product-launchも使うと明記)。公開プロフィールの`PUBLIC_PROFILE_TABS`(launches 10)と`PublicProfileSectionContext`(ハンドル・ニックネーム・本人か・停止中か)。`UserProfileDirectory.resolveHandle`・`findSummaries`、GraphQLの`UserSummary`・`userSummaryLoader`。退会者の全ファイルの物理削除(`purge_due` 610)と停止の隔離(600)はuser-profile-socialが行う。後続specのテーブルが`media_files`へ外部キーを張ると610の削除が失敗する。
  - media-pipeline: 用途の命名例に`product-logo`・`product-screenshot`がある。`MediaFiles.claim`(保有者・用途・保存完了・未削除の確認)・`eraseNow`・`markDeleted`(13日後の日次バッチで削除)・`findMany`(バイト数・隔離の状態)、`MediaQuarantine.addReason`・`removeReason`(ファイルのIDで隔離理由`product_hidden`を付け外し、送信に失敗すれば`AppError(unavailable)`で再実行できる)。`ImageUploadField`は`maxCount`・`maxTotalBytes`・`existingCount`・`existingTotalBytes`・`edit.aspect`(`'free'`)を受け取る。スクリーンショットの表示は`MediaPicture`の`screenshot`(thumb 480px・full 1920px)。
  - ultras-subscription: `UltrasEntitlements.isEntitledAt(userId, at)`(機能フラグを読まない)、`UltrasPromotionGate`(導線の表示の可否、読み込み中・エラーでは描画しない)。再ローンチの間隔はproduct-launchが`isEntitledAt`で判定すると申し送られている。
  - admin-foundation: `requireAdmin(session, caller, 'moderator')`、`AuditLogRecorder.prepare`・`buildAuditLogStatements`(操作と同じ一括の書き込み)、`defineAuditAction`・`AUDIT_ACTIONS`(`audit-actions/<spec名>.ts`)、`AuditTargetKind`の`category`、`checkCategoryName`・`CATEGORY_NAME_MAX`(30)、`CategoryMasterEditor`(`withHandle`・`canEdit`・`systemDefault`、拒否は`GraphQLClientError`の文言)、`useAdminRole`・`RoleGate`、E2Eの`e2e/support/admin-bootstrap.ts`。
  - inquiry-chat: `CATEGORY_SECTIONS`の`CategorySection { id, order, title, component }`(product-launch 10)。区画ごとにエラー境界で包まれる。問い合わせカテゴリの規則(名前の一意・「その他」の保護・追加の順)。
  - backend-platform: `ScheduledJobDefinition`(業務時刻・`order`)とapiの`SCHEDULED_JOBS`(Cron Triggersはapiだけ)、`defineMessageContract`・`MESSAGE_CONTRACTS`・eventの`MESSAGE_HANDLERS`・`MessageHandlingResult`の`defer`、`BusinessTime`(`toBusinessDateTime`・`fromBusinessDateTime`・`BusinessDate`)、共通カラム(`ulidPrimaryKey`・`timestamps`・`softDelete`・`textNoCase`)。
  - api-gateway: `defineSchemaModule`・`GraphQLContext`(`resolve`・`assertHuman`・`caller`・`session`・`loaders`)・`withValidatedArgs`・`CURSOR_PAGE_ARGS`・`encodeCursor`・`decodeCursor`・`toConnection`・`defineLoader`(既定50件)。ルート型以外の型を複数のモジュールで定義できない。
  - content-processing: `markdownTextSchema`・`countGraphemes`・`hasForbiddenCharacters`・`MarkdownEditor`・`useMarkdownOptions`・`CollapsibleMarkdownContent`。
- **Implications**: 上流のファイルの変更は、契約で定められた登録箇所への追記(ライフサイクルの登録口・用途・カテゴリの区画・監査の操作種別・公開プロフィールのタブ・定期実行・メッセージ)と、frontend-libへのカレンダーの部品の追加(仮10)だけである。上流specの文書の変更は要らない。

### ローンチの状態と時刻の境界

- **Context**: FR-PRDCT-002・014、FR-RELCH-002〜004・006、日次タイムライン(23:40の終了と選べる日の切り替え、23:45のペアリング、0:00の開始)。
- **Sources Consulted**: 日次タイムライン、再ローンチ規則、予選ルール、データエクスポートの`launches.json`の`status`(scheduled・paired・in_progress・finished・canceled)、backend-platformの`BusinessTime`。
- **Findings**:
  - 状態は、取消の日時→予選の結果→現在時刻とローンチ日の0:00→前日23:45、の順で決められる。データエクスポートの5つの値と一致する。
  - マッチ直前・マッチ中の固定(予選)は「状態がペアリング済み・マッチ中」、次回の予約の禁止(FR-RELCH-006)は「直近のローンチが予定・ペアリング済み・マッチ中」と同じ判定で表せる。
  - 23:45ちょうどのペアリングのジョブが遅れても、時刻で固定を始めるため、ペアリングの最中に変更が通ることは無い。結果の記録が遅れても、記録までは固定が続く(安全側)。
  - 固定の判定を一括の書き込みの`CASE`式に埋め込む(「結果が未確定で取消でなく、ローンチ日が`閾値の日`以前のローンチが無い」。閾値の日は23:45以降なら明日、それより前なら今日)と、読み取りと書き込みの間に23:45をまたいでも固定が破られない。
- **Implications**: 純粋な規則`launch-status`・`launch-date-rules`をapiの`domain/product`に置き、業務時刻の計算はbackend-platformの`BusinessTime`を使う。カレンダーの選べる範囲はサーバーが計算して返し、クライアントに日付の規則を持たせない(重複を避け、23:40の切り替えはサーバーの値の取り直しで追う)。

### 物理削除の順序とライフサイクルイベント

- **Context**: FR-PRDCT-017・024、FR-USER-022、roadmapの帯の割り当て(帯は同じ時刻・種類の中で上流の後に動く)、briefのConstraints(上流の値より前に動く必要があれば開発者へ確認)。
- **Sources Consulted**: identity-authの`UserLifecycleRunner`・`PurgeOrchestratorJob`・`IdentityPurgeStore`、user-profile-socialの物理削除の順序の分析。
- **Findings**:
  - 後続spec(match-engineのマッチ記録・engagementのコメント・sponsorshipの広告・トーナメントの参加)はプロダクトかローンチを外部キーで参照する見込みで、プロダクトの行を消す前に自分の行を消すか紐付けを解除する必要がある。ユーザーの`purge_due`の波及処理で本spec(1000)がプロダクトを消すと、後続(1100以上)より先になり外部キーで失敗する。
  - プロダクトの物理削除をプロダクトライフサイクルイベントの`purge_due`にし、本specの実行器が登録された全処理の後に行を消せば、ユーザーの物理削除とプロダクトの個別の物理削除(FR-PRDCT-024)の両方で同じ順序を保てる。後続specはプロダクトの`purge_due`に1つ処理を登録するだけでよい。
  - 本specのユーザーの`purge_due`の波及処理は、利用者のプロダクトの`purge_due`のイベントを作って送り、プロダクトの行が無くなるまで`continue`を返す。`continue`は5秒後に呼び直されるため、待ちの間に他の利用者の処理を止めない。
- **Implications**: プロダクトライフサイクルイベントを、identity-authのユーザーライフサイクルと同じ形(イベントの記録・同期の文・非同期の処理・同じ対象の発生順・完了の記録・日次の送り直し・最後の物理削除)で作る。帯の外の値は使わない。

### ハンドルの対象

- **Context**: FR-PRDCT-008〜010・012・020・021・023、FR-ADMCF-008、仮5。
- **Sources Consulted**: user-profile-socialの`HandleNamespace`の契約、ページ配置(予約語・カテゴリのハンドルは旧ハンドルを持たず`other`は固定)。
- **Findings**: プロダクトは`{ name: 'product', rule: { maxLength: 50, reservedWords: IMPERSONATION_RESERVED_HANDLES }, current: products(activeCondition: deleted_at IS NULL), previous: product_previous_handles }`、カテゴリは`{ name: 'product-category', rule: { maxLength: 50, reservedWords: [] }, current: product_categories }`で表せる。使用中の判定は現在のハンドルの全行を見るため、論理削除したプロダクトの現在のハンドルは物理削除まで使用中になり(仮5)、解決は`activeCondition`で論理削除を除く。旧ハンドルは論理削除で`previousHandleSoftDelete`すれば転送が止まる。user-profile-socialの仮2の決定(B)に合わせ、他の対象の旧ハンドルは使用中とせず、他のプロダクトが設定した時点で元の保持者の旧ハンドルの行を`previousHandleRelease`で消す(2026-10-24に確定)。
- **Implications**: 2つの対象の記述を`backend-lib/workers/product`に置き、保存の`CASE`式に`handleOccupiedCondition`を埋め込む。カテゴリの一意は`textNoCase`の一意索引だけで足りる(旧ハンドルが無いため)。

### 画像の上限と保存

- **Context**: FR-PRDCT-005・006、FR-FILEU-023・024、仮6。
- **Sources Consulted**: media-pipelineの`UploadConstraints`・`MediaFiles`、画像のバリアントの文書(スクリーンショットは原本の縦横比、full 1920px)。
- **Findings**: アップロードは1枚ずつ送られ、枚数と合計は選択時に`checkSelection`が事前に判定する。保存の時点では`MediaFiles.findMany`でバイト数と用途・保有者を読み、合計10,485,760バイト・20枚を超えれば拒否できる。差し替えたロゴは`eraseNow`(即時)、取り除いたスクリーンショットは`markDeleted`(13日後の日次バッチ)で消える。
- **Implications**: ロゴは編集で`aspect: 1`・`maxLongSide: 512`、スクリーンショットは`aspect: 'free'`・`maxLongSide: 1920`(`screenshot-full`の上限)にする。プロダクトの物理削除では残った画像を`eraseNow`する。

## Architecture Pattern Evaluation

| Option                                                       | Description                                                                                    | Strengths                                                                                        | Risks / Limitations                                                                            | Notes           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------- |
| ローンチを別のテーブルにし、予選の結果を本specへ記録(採用)   | `product_launches`がローンチ日・取消・予選の結果を持ち、match-engineが結果を記録の口で書き込む | 状態・次回の予約の禁止・敗北後の間隔・ローンチ履歴・掲載済みの判定を本specのテーブルだけで行える | 結果のデータがmatch-engineのマッチ記録と重なる(結果だけの写し)                                 | briefのApproach |
| 結果をmatch-engineだけが持ち、本specは照会の差し込み口で読む | 本specは既定で「未確定」を返す口を持ち、match-engineが束縛を差し替える                         | データの重複が無い                                                                               | 掲載済みの絞り込み・ローンチ履歴の並べ替えをSQLで行えず、ページ分けの件数が崩れる              | 不採用          |
| 固定と次回の予約の禁止をすべて後続specの供給にする           | 予選の固定もmatch-engineが条件として供給する                                                   | 時刻の規則が本specに入らない                                                                     | match-engineの実装までの間に固定が効かず、FR-PRDCT-014・FR-RELCH-006の判定が他specに散る       | 不採用          |
| プロダクトの物理削除をユーザーの波及処理の中で直接行う       | 1000番台の波及処理でプロダクトの行を消す                                                       | 仕組みが小さい                                                                                   | 後続(1100以上)の紐付けの解除より先に消すため外部キーで失敗する。帯の外の値は開発者の確認が要る | 不採用          |

## Design Decisions

### Decision: ローンチの状態を時刻と記録から導く

- **Context**: 要件4〜6、データエクスポートの`launches.json`。
- **Alternatives Considered**:
  1. 状態の列を持ち、match-engineがペアリング・開始・終了のたびに更新する
  2. ローンチ日・取消の日時・予選の結果と現在時刻から導く
- **Selected Approach**: 2。`product_launches`は`launch_date`・`cancelled_at`・`outcome`・`decided_at`だけを持ち、`deriveLaunchStatus(launch, now)`が5つの状態を返す。
- **Rationale**: 時刻の境界は日次タイムラインで固定され、match-engineが書き込むのは結果だけで済む。match-engineの実装の前でも固定と禁止が働く。
- **Trade-offs**: match-engineが結果を記録しない限り、ローンチはマッチ中のままで、次回の予約ができない(安全側)。結果の記録の失敗はmatch-engineの監視で検知する。

### Decision: 判定の拡張点を3つの供給元の登録口にする

- **Context**: brief(再ローンチ可否ポリシーに拡張点があり、トーナメントが「結果確定待ち」を供給する)、FR-PRDCT-014(トーナメントマッチ直前)、ページ配置(ローンチ履歴の結果の要約・受賞バッジ)、api-gatewayの型の規約。
- **Selected Approach**: apiのapplication層に`RelaunchConditionSource`(次回の予約の禁止)・`ProductLockSource`(固定)・`LaunchSummarySource`(ローンチ履歴の要約と受賞)の契約と、`composition`の登録口`RELAUNCH_CONDITION_SOURCES`・`PRODUCT_LOCK_SOURCES`・`LAUNCH_SUMMARY_SOURCES`(初版は空)を置く。各供給元はプロダクトのIDの一覧を受け取り、1回の呼び出しで該当するものだけを返す。
- **Rationale**: 後続specは本specのファイルを書き換えずに1行の登録で条件を加えられる。一覧単位の呼び出しで自分のプロダクトの画面(20件)でも供給元ごとに1回の照会で済む。
- **Trade-offs**: 供給元の失敗は判定を「確認できない」にし、予約・固定に関わる操作を拒否する(安全側)。表示だけの要約・受賞の失敗は、予選の結果からの要約で縮退する。

### Decision: プロダクトライフサイクルをユーザーライフサイクルと同じ形にする

- **Context**: 要件8・12・13、roadmapのShared seams(product-launchが契約を定義し、match-engine・directory-discovery・sponsorshipなどがハンドラを登録、ugc-moderationが非公開化を発火)、sponsorshipのbrief(順の規則はproduct-launchの契約に従う)。
- **Alternatives Considered**:
  1. identity-authの実行器を汎用にして共用する(identity-authの変更が要る)
  2. 本specに同じ形の記録・同期の文・非同期の実行器を作る
- **Selected Approach**: 2。`product_lifecycle_events`・`product_lifecycle_handler_runs`、apiの`ProductLifecycleCommitter`(版や状態の条件を`CASE`式に埋め込んだイベントの挿入→状態の更新→本specの文→登録された同期の文)、eventの`ProductLifecycleRunner`(メッセージ`product.run-product-lifecycle`)、4:21の送り直し。名前の検証は`assertLifecycleHandlerName`、結果の型は`LifecycleHandlerOutcome`を再利用し、`order`の帯はroadmapの割り当てをそのまま使う。
- **Rationale**: 後続specの開発者が同じ考え方で両方のライフサイクルを扱える。上流specを変えない。
- **Trade-offs**: 実行器と記録の仕組みが2つになる。技術ドキュメント`backend/012`で共通の規約として書き、将来の共通化の余地を記録する。

### Decision: ユーザーの退会・停止はユーザーライフサイクルで扱い、プロダクトのイベントを作らない

- **Context**: 要件13、FR-GAME-015(退会・停止によるマッチの終了はユーザーの事象)。
- **Selected Approach**: 退会の同期の波及処理`product-launch.withdrawal`が利用者の全プロダクト・旧ハンドルを集合の更新で論理削除し、停止の同期の波及処理`product-launch.launch-cancellation`が未開始のローンチを取り消す。プロダクトの`deleted`イベントは投稿者の個別の削除だけで作る。後続specは、退会・停止に伴う自分の処理をユーザーライフサイクルに、プロダクト単位の処理をプロダクトライフサイクルに登録する。物理削除だけは両方の経路をプロダクトの`purge_due`に寄せる。
- **Rationale**: identity-authの規約(同期の波及処理は集合の更新だけ)に合い、退会でプロダクトの数だけイベントを作らない。後続specの退会・停止の処理(マッチの終了など)は元々利用者の単位である。
- **Trade-offs**: 後続specは、論理削除の理由によって2つのライフサイクルに登録する必要がある。契約の文書と技術ドキュメントに明記する。

### Decision: 保存の一括の書き込みの先頭で条件を検査する

- **Context**: 要件2.5・5.10・6.1・6.6・7.3、user-profile-socialの`CASE`式の方式。
- **Selected Approach**: 登録は`products`の挿入の`user_id`、編集・予約・削除は`products`の更新の`user_id`を`CASE WHEN <条件> THEN user_id ELSE NULL END`にし、条件(版の一致・未削除・投稿者が書き込める状態・ハンドルが使用中でない・固定の期間でない・非公開化中でない)を満たさなければNOT NULL制約の違反で全体を取り消す。失敗の分類は読み直しで行う。同時の予約は「結果が未確定で取消でないローンチはプロダクトに1つ」の部分一意索引でも防ぐ。
- **Rationale**: D1の`db.batch()`は1つのトランザクションで直列に確定するため、読み取りと書き込みの間の変化を取りこぼさない。
- **Trade-offs**: 失敗の理由の判定に読み直しが1回要る。

### Decision: 自分のプロダクトの画面とローンチ履歴の並べ替えの列を持つ

- **Selected Approach**: `products.latest_launch_date`(取消を含む最新のローンチ日)を、ローンチの挿入・日付の変更と同じ一括の書き込みで更新し、`(user_id, latest_launch_date, id)`の索引でカーソルの一覧を読む。
- **Rationale**: 最新のローンチ日の新しい順(ページ配置)を、ローンチの集約を毎回計算せずに索引で並べられる。

### Decision: 保存の登録口とカテゴリの条件を加える(仮11)

- **Context**: directory-discoveryの依頼(2026-10-24、コーディネーター経由。requested by directory-discovery)。directory-discoveryの要件12.3・FR-ADMUG-011(編集時の索引の更新)とカテゴリの絞り込み・カテゴリごとの掲載数(要件3.1)は、本specの既存の口(ライフサイクルは削除・非公開化・復元・物理削除だけ、結合してよい条件は可視と勝利だけ)では満たせなかった。directory-discoveryの設計(`ProductIndexRefreshSaveHook`・`DirectoryListingQuery`)とresearch.md(仮4)の求める名前と形に合わせた。
- **Alternatives Considered**:
  1. 保存の登録口`PRODUCT_SAVE_HOOKS`(同時の文と確定の後の処理)
  2. プロダクトライフサイクルに`updated`の種類を足す(非同期だけになり、保存と同時に更新待ちの印を付けられない。イベントの記録が保存ごとに増える)
  3. 後続が定期の処理で変更を拾う(反映が遅れ、本specのテーブルを走査させることになる)
- **Selected Approach**: 1。`ProductSaveHook { statementsFor({ productId, at }, db), afterCommit({ productId }) }`と登録`{ name, hook }`、登録口`PRODUCT_SAVE_HOOKS`(`apps/api/src/composition/product-save-hooks.ts`、型は`application/product/product-save-hooks.ts`)。登録・編集・説明文の更新のストアの一括の書き込みの末尾に文を加え、確定の後に登録の順で`afterCommit`を呼ぶ(例外は`warn`のログで続ける)。復元・停止の解除はライフサイクルの既存の登録口で伝わるため、保存の登録口では呼ばない。カテゴリは`visibility.ts`に`productInCategory(categoryId)`を足し、これらの条件で絞った`products.id`・`products.category_id`を後続が並べ替え・集計に使ってよいとした。
- **Rationale**: 更新待ちの印が保存と同じ書き込みで確定し、確定の後の処理の失敗は後続の日次の処理で回復できる。登録口の形は`PRODUCT_LIFECYCLE_SYNC_HANDLERS`と同じ考え方で、engagement・sponsorship・ugc-moderationも使える。型のファイルはdirectory-discoveryの指定どおりapplication層に置き、drizzleの型だけを読み込む(実行時の依存は無い)。
- **Trade-offs**: 保存の一括の書き込みの文が後続の登録の数だけ増える。登録された`statementsFor`の例外は保存を失敗させる(書き込みと同時に確定させる処理のため)。
- **Follow-up**: 2026-10-24に開発者が推奨どおりに確定した(directory-discoveryの仮4も同じ)。

### Decision: 予選の結果からの要約と受賞のまとめを共有する

- **Context**: directory-discoveryが`launch-summary-fallback.ts`に本specの`LaunchHistoryReader`と同じ文言の規則を複製していた。
- **Selected Approach**: `core/product/launch-summary.ts`に`fallbackLaunchSummary(launch)`・`groupAwards(awards)`を純粋な関数として置き、本specのローンチ履歴が使う。引数は構造的部分型で`LaunchRecord`・`ProductAwardContribution`をそのまま渡せる。directory-discoveryは自分の関数をこれの再エクスポートにできる(任意で、directory-discoveryの変更は求めない)。
- **Rationale**: 2つの関数だけの小さな追加で、ローンチ履歴とプロダクト詳細・ディレクトリの文言のずれを防ぐ。

### Decision: 公開APIの説明文の更新で非公開化を書き込みの時点に拒否する(仮12)

- **Context**: public-apiの依頼(2026-10-24、コーディネーター経由。requested by public-api)。public-apiは`MyProductsReader.find`の`hidden`で事前に判定して`product_hidden`を返す(public-apiの要件12.5、FR-PAPI-009)が、判定と書き込みの間に非公開化されると説明文が書き込まれる。public-apiのdesign.md・research.mdの推奨(`updateDescription`に`ProductSaveGuards.notHidden`、結果に`'hidden'`、`ProductDescriptionEditor.update`が`AppError({ kind: 'conflict', code: 'product_hidden' })`)に合わせた。
- **Selected Approach**: `updateDescription`の一括の書き込みの先頭の`CASE`式に`notDeleted AND ownerWritable AND notHidden`を置き、取り消しを読み直しで、優先の順に`not-found`(不在・論理削除)・`account-unavailable`(投稿者の同時の停止・退会、`save`と同じ分類)・`hidden`に分ける。`ProductDescriptionEditor`は`hidden`で`AppError({ kind: 'conflict', code: 'product_hidden', message: 「このプロダクトは公開が停止されているため、説明文を更新できません。」 })`、`not-found`で`product_not_found`、`account-unavailable`で`account_unavailable`を投げ、確定の後の処理を呼ばない。
- **Rationale**: `ProductDescriptionEditor`の利用者は公開APIの経路だけで、FR-PAPI-009は管理者が停止したデータへの書き込みを拒否する。画面の編集(仮7: 非公開化中も内容を直せる)とは経路が違うため矛盾しない。
- **Trade-offs**: 画面からは直せる説明文を公開APIからは直せない。仮7と仮12の組み合わせは2026-10-24に開発者が推奨どおりに確定した。

### Decision: 採らなかった案

- カレンダーの選べる日の計算をクライアントにも持つ: 規則の重複になる。サーバーの`launchDateWindow`を描画し、23:40の切り替えは取り直しで追う。
- スクリーンショットの並べ替えの操作: 要件定義書に無い。選択の順で保存し、並べ直しは取り除いて選び直す。
- 削除したスクリーンショットの即時の物理削除: FR-FILEU-024の「ユーザーにより削除」に当たるため、14日後にする。
- プロダクトの論理削除の時点での画像の`markDeleted`: 物理削除の処理で`eraseNow`するため不要。論理削除の間は画像が表示されない(プロダクトが照会の対象から外れる)。
- 予約の取りやめ(仮3)・登録時のローンチ日の任意化(仮2)。

## Synthesis

- **Generalization**: トーナメントに関わる3種類の判定・表示(次回の予約の禁止・固定・ローンチ履歴の要約と受賞)を、同じ形の「プロダクトのIDの一覧を受け取る供給元の登録口」に一般化した。ユーザーの物理削除とプロダクトの個別の物理削除を、プロダクトの`purge_due`の1つの経路に一般化した。プロダクトとプロダクトカテゴリのハンドルをハンドル基盤の対象の記述で扱った。
- **Build vs Adopt**: ハンドル(user-profile-social)、画像(media-pipeline)、マークダウン(content-processing)、特典の判定(ultras-subscription)、権限・監査・カテゴリの編集部品(admin-foundation)、カテゴリのページ(inquiry-chat)、ライフサイクルの規約と型(identity-auth)、業務時刻(backend-platform)を使う。カレンダーはshadcn/uiの部品を採用する(仮10)。ローンチ・プロダクトのライフサイクル・判定の拡張点は既存の部品が無いため作る。
- **Simplification**: ローンチの状態の列・ペアリング済みの記録・予約の取りやめ・スクリーンショットの並べ替え・カテゴリの旧ハンドルを持たない。クライアントに日付の規則を持たない。

## Risks & Mitigations

- match-engineが予選の結果を記録しないと、ローンチがマッチ中のまま固定され次回の予約ができない — 記録の口の契約と`backend/012`に書き、match-engineの再検証の対象にする。staging(match-engineの実装前)では手作業の記録の手順を運用の報告に載せる。
- 後続specのプロダクトの`purge_due`の処理が失敗し続けると、プロダクトとユーザーの物理削除が14日を過ぎる — 4:21の`product-launch.purge-orchestrator`が期限超過を数えてSentryへ通知する。identity-authの`purge-overdue`でもユーザーの側で検知される。
- 供給元(トーナメント)の照会が遅いと、自分のプロダクトの画面と編集の保存が遅れる — 供給元は一覧単位で1回だけ呼び、プロダクトのIDの一覧は20件以内にする。
- 23:40・23:45の境界で画面の表示とサーバーの判定がずれる — サーバーが保存の時点で判定し直し、`launch_date_unavailable`で選べる最も早い日を返す。画面は表示中に境界を越えたら取り直す。
- カレンダーの部品の版の更新で表示や操作が変わる — `react-day-picker`(仮10、2026-10-24に確定)は完全固定し、部品は`frontend-lib/components/ui/calendar.tsx`の1ファイルに閉じ、`LaunchDateField`はその形だけに依存する。
- 技術ドキュメントの番号の重なり — roadmapの順で前のhelp-centerが`frontend/011-table-of-contents.md`を使うため、本specは`frontend/012`・`backend/012`・`backend/013`にした(help-centerの設計で確かめた)。`backend/011-handle-namespaces.md`は本specでは変更しない。

## References

- `docs/GUIDES/service/overview/006-relaunch-rules.md` — 間隔制限の解釈・計算例・予約済みローンチの扱い
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 23:40・23:45・0:00・4:21
- `docs/GUIDES/service/design/002-page-layouts.md` — `/my/products`・登録・編集、プロダクト詳細の投稿者本人向けの操作、ローンチ履歴、カテゴリの`other`
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — 再ローンチ制限・再ローンチ不可の文言、容量の単位
- `docs/GUIDES/service/features/001-user-data-export.md` — `products.json`・`launches.json`
- [shadcn/ui Calendar](https://ui.shadcn.com/docs/components/calendar) — `react-day-picker`を使うカレンダーの部品(仮10)
- [React DayPicker](https://daypicker.dev/) — 日ごとの無効化(`disabled`)と表示の差し替え(`components`)

## 仮決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。要件定義書と上流specに最も整合する案を仮に採用して要件・設計・タスクを作り、**2026-10-24に開発者が全てを確定した(仮4は推奨と異なるB、仮5の旧ハンドルはuser-profile-socialの仮2のBに合わせた。仮10は先に確定)。** `requirements.md`の「要件フェーズでの仮決定」にも同じ行がある。

| #    | 論点                                                                                 | 採用した案                                                                                                                                                                                                                                                                                                                                               | 他の選択肢                                                                                                  | 影響する箇所                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1  | FR-RELCH-004の意図と敗退後の禁止期間(2026-10-24に開発者が確定)                       | Week優勝作はYear確定まで禁止(意図どおり)。トーナメントの結果の確定後は禁止期間を掛けない                                                                                                                                                                                                                                                                 | 敗退後も7日・2日 / Week優勝作の禁止を短くする                                                               | 要件4.12・5.3、`computeLaunchDateWindow`、再ローンチ規則、tournament-week・tournament-year                                                                |
| 仮2  | 登録時のローンチ日(2026-10-24に開発者が確定)                                         | 必須                                                                                                                                                                                                                                                                                                                                                     | 任意                                                                                                        | 要件1.1、`ProductRegistration`、登録画面                                                                                                                  |
| 仮3  | 予約の取りやめ(2026-10-24に開発者が確定)                                             | 設けない                                                                                                                                                                                                                                                                                                                                                 | マッチ直前より前なら取りやめられる                                                                          | 要件5.9                                                                                                                                                   |
| 仮4  | 選べるローンチ日の上限(2026-10-24に開発者が確定。推奨と異なるB)                      | 今日から90日後(開発者の選択。推奨の365日後と異なる)                                                                                                                                                                                                                                                                                                      | 365日後(推奨) / 上限なし                                                                                    | 要件4.3、`LAUNCH_DATE_HORIZON_DAYS`                                                                                                                       |
| 仮5  | 論理削除したプロダクトのハンドル(2026-10-24に開発者が確定。旧ハンドルは推奨と異なる) | 現在のハンドルは物理削除まで使用中、旧ハンドルの転送は論理削除で止める。旧ハンドルは他のプロダクトが設定でき、設定された時点で元の保持者の行を消す(user-profile-socialの仮2のB、推奨と異なる)                                                                                                                                                            | 論理削除で現在のハンドルも解放する / 旧ハンドルを物理削除まで使用中とする                                   | 要件2.3・2.9〜2.11、`PRODUCT_HANDLE_NAMESPACE`・`previousHandleRelease`、準拠方針                                                                         |
| 仮6  | スクリーンショットの枚数(2026-10-24に開発者が確定)                                   | プロダクトあたり20枚                                                                                                                                                                                                                                                                                                                                     | 枚数は上限なし(合計10MBだけ)                                                                                | 要件3.2、`PRODUCT_SCREENSHOTS_MAX`                                                                                                                        |
| 仮7  | 非公開化中のプロダクトに投稿者ができること(2026-10-24に開発者が確定)                 | 編集と削除はできる。次回の予約はできない                                                                                                                                                                                                                                                                                                                 | 削除だけ / すべて                                                                                           | 要件5.8・7.7、保存の条件                                                                                                                                  |
| 仮8  | カテゴリ名の重複・「その他」の保護・並び順(2026-10-24に開発者が確定)                 | 名前の一意、「その他」の削除・名前・ハンドルの変更の拒否、追加の順で「その他」を末尾                                                                                                                                                                                                                                                                     | 名前の重複を許す・「その他」の名前は変えられる                                                              | 要件11.3・11.5・11.9                                                                                                                                      |
| 仮9  | カテゴリの削除で数えるプロダクト(2026-10-24に開発者が確定)                           | 論理削除後未削除も数える                                                                                                                                                                                                                                                                                                                                 | 数えずに付け替える                                                                                          | 要件11.6                                                                                                                                                  |
| 仮10 | カレンダーの部品(2026-10-24に開発者が承認して確定)                                   | `react-day-picker`(shadcn/uiのカレンダー)を採用                                                                                                                                                                                                                                                                                                          | 自作 / ブラウザの日付入力欄                                                                                 | 要件4.8、`Calendar`・`LaunchDateField`、tech-stack.md                                                                                                     |
| 仮11 | 保存の登録口とカテゴリの条件(2026-10-24に開発者が確定)                               | `PRODUCT_SAVE_HOOKS`(登録・編集・説明文の更新の一括の書き込みの末尾に文を加え、確定の後に処理を呼ぶ)と`productInCategory()`を足す。requested by directory-discovery                                                                                                                                                                                      | プロダクトライフサイクルに`updated`を足す / 定期の処理で変更を拾う / 後続が`products.category_id`を直接読む | 要件14.9・14.10、`ProductSaveHooks`・`PRODUCT_SAVE_HOOKS`・`visibility.ts`、ストアの3つの書き込み、directory-discoveryの仮4                               |
| 仮12 | 公開APIの説明文の更新と非公開化(2026-10-24に開発者が確定)                            | `ProductStore.updateDescription`の条件に`notHidden`を加えて`'hidden'`(投稿者の状態は`'account-unavailable'`)を返し、`ProductDescriptionEditor.update`が`AppError({ kind: 'conflict', code: 'product_hidden' })`を文言「このプロダクトは公開が停止されているため、説明文を更新できません。」で投げる。requested by public-api                             | public-apiの事前の判定だけにする(判定と書き込みの間の非公開化が漏れる)                                      | 要件7.9、`ProductStore.updateDescription`・`ProductDescriptionEditor`、タスク4.1・4.3、public-apiの要件12.5                                               |
| 仮13 | 管理画面のプロダクトの検索の照会(2026-10-24に開発者が確定)                           | `AdminProductDirectory`・`D1AdminProductDirectory`(`PRODUCT_PLATFORM_TYPES.AdminProductDirectory`)を本specが所有して実装し、ugc-moderationが呼ぶ。後続specに許す結合の範囲(仮11)を超える読み取りの、本specのディレクトリの中だけの明示の例外とする。cross-spec reviewの指摘による。利用者に見える振る舞いを変えないため`requirements.md`の表には載せない | ugc-moderationが本specのディレクトリへ照会を加えて実装する / ugc-moderationが本specのテーブルを直接結合する | 要件14.12、`AdminProductDirectory`・`PRODUCT_PLATFORM_MODULE`、タスク2.6、ugc-moderationの`/products`・週ごとの統計                                       |
| 仮14 | 公開プロフィールの受賞バッジの区画(2026-10-24に開発者が確定)                         | `PUBLIC_PROFILE_BADGES`に`product-launch.award-badges`(10)を登録し、ローンチ履歴の対象と同じプロダクトの受賞を`groupAwards`でまとめて表示する(ラベルは`'<名称> <受賞のラベル>'`)。cross-spec reviewの指摘による                                                                                                                                          | tournament-week・tournament-yearがそれぞれ登録する / directory-discoveryが登録する                          | 要件10.11、`LaunchHistoryReader.awards`・`profileAwards`・`ProfileAwardBadges`・`AwardBadgeList`、タスク6.3・7.4・9.1・9.8・9.9、user-profile-socialの8.5 |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID       | 内容                                                                                                                                           | 根拠 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| FR-PRDCT-001 | 必須項目にローンチ日を加える                                                                                                                   | 仮2  |
| FR-PRDCT-002 | 選べるローンチ日の上限(今日から90日後)を加える                                                                                                 | 仮4  |
| FR-PRDCT-006 | プロダクトあたりのスクリーンショットの枚数の上限(20枚)を明記する                                                                               | 仮6  |
| FR-PRDCT-010 | 論理削除後に物理削除されていないプロダクトの現在のハンドルも設定済みとして扱い、他のプロダクトが保持中の旧ハンドルは設定済みとしない旨を加える | 仮5  |
| FR-PRDCT-020 | 保持中の旧ハンドルは、他のプロダクトが同じ文字列を設定した時点で元の保持者から取り除く旨を加える(FR-UPROF-010の同じ改訂に合わせる)             | 仮5  |
| FR-PRDCT-021 | 旧ハンドルによるアクセスの転送は、元の保持者の論理削除または他のプロダクトによる設定の時点で終わる旨を加える                                   | 仮5  |
| FR-RELCH-002 | 「予選に敗北した場合」にトーナメントの敗退を含まない旨を加える                                                                                 | 仮1  |
| FR-ADMCF-010 | 「その他」の名前とハンドル(`other`)の変更も拒否する旨を加える                                                                                  | 仮8  |
| FR-ADMCF-011 | 論理削除後に物理削除されていないプロダクトも数える旨を加える                                                                                   | 仮9  |

## 上流・後続specへの影響

- identity-auth(上流): 登録箇所への追記だけ。`USER_LIFECYCLE_SYNC_HANDLERS`に`product-launch.withdrawal`(`withdrawn`)・`product-launch.launch-cancellation`(`suspended`)、`USER_LIFECYCLE_ASYNC_HANDLERS`に`product-launch.product-erasure`(`purge_due`、1000)。`LifecycleHandlerOutcome`・`assertLifecycleHandlerName`を再利用する(形を変えない)。
- user-profile-social(上流): `PUBLIC_PROFILE_TABS`に`launches`(10)を、`PUBLIC_PROFILE_BADGES`に`product-launch.award-badges`(10、仮14)を足し、ハンドル基盤と`checkExternalUrl`を使う(契約どおり)。ファイルの変更は登録箇所だけ。
- media-pipeline(上流): `UPLOAD_PURPOSES`に`product-logo`・`product-screenshot`を足す(契約どおり)。
- admin-foundation(上流): `audit-actions/product-launch.ts`を足して`AUDIT_ACTIONS`へ連結する(契約どおり)。
- inquiry-chat(上流): `CATEGORY_SECTIONS`に`product-launch.product-categories`(10)を足す(契約どおり)。
- frontend-platform(上流): `apps/frontend-lib/components/ui/calendar.tsx`(shadcn/uiのカレンダー)と`react-day-picker`を足す(仮10、2026-10-24に確定)。frontend-libの規約(1ファイル1コンポーネント・stories・`runAxe`)に従う。tech-stack.mdの行はコントローラーが追加済み。版は`apps/frontend-lib/package.json`・`apps/client/package.json`・`apps/admin/package.json`へ同じ版を完全固定で宣言し、依存パッケージの版管理の文書の主要パッケージの一覧の対象(版が食い違うと基底設定・プリセットが動かない、または組み合わせられる版の範囲が狭いもの)ではないため一覧には載せず、同文書の「一覧に無いパッケージでも、共有ディレクトリのコードが実行時に使うものは、利用側アプリが共有ディレクトリ側と同じ版で宣言する」と共有ディレクトリの文書の規則に従う。
- backend-platform(上流): `SCHEDULED_JOBS`に4:21の2つのジョブ、`MESSAGE_CONTRACTS`・`MESSAGE_HANDLERS`に`product.run-product-lifecycle`を足す(契約どおり)。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は1000・1010、波及処理は1000」になる。プロダクトライフサイクルの処理の`order`も同じ帯を使う(本specは1000)。Requirement Ambiguitiesの行の解決の列は「product-launch 仮1(Week優勝作はYear確定まで次回予約を禁止し、トーナメントの結果確定後は敗退でも敗北後の禁止期間を掛けない、2026-10-24に開発者が確定)」。本specはroadmapを編集しないため、コントローラーへ報告する。
- match-engine(後続): `ScheduledLaunchDirectory.listForDate`で翌日の予定のローンチを読み、`LaunchOutcomeRecorder.record`で予選の結果(勝利・敗北、不戦勝と相手の退会等による勝利は勝利)を記録する。マッチ記録はローンチ(またはプロダクト)のIDを持ち、プロダクトの`purge_due`の処理(1100番台)で紐付けを解除する。プロダクトの`hidden`の同期・非同期の処理でマッチの終了を行う。退会・停止によるマッチの終了はユーザーライフサイクルに登録する。結果を記録しないとローンチがマッチ中のまま固定される。
- directory-discovery(後続): `ProductDirectory`(表示用の情報・ハンドルの解決・説明文・スクリーンショット・ローンチ)・`visibleProducts()`・`wonLaunchExists()`・`ProductCategoryDirectory`・GraphQLの`productOwnerStatus`を使う。掲載の条件のうちプロダクト側(可視・勝利のローンチ)は本specの部品で判定する。検索の索引の更新はプロダクトの`deleted`・`hidden`・`unhidden`・`purge_due`の処理として登録する。 仮11(requested by directory-discovery)により、`PRODUCT_SAVE_HOOKS`に`directory-discovery.product-index-refresh`を登録して編集の索引の更新を行い、`productInCategory()`でカテゴリの絞り込みとカテゴリごとの掲載数を求める(`products.id`・`products.category_id`の集計は許可した範囲)。予選の結果からの要約は`fallbackLaunchSummary`・`groupAwards`を使える。
- engagement・sponsorship・ugc-moderation(後続): プロダクトの保存と同時に確定させたい文や、確定の後の処理があれば`PRODUCT_SAVE_HOOKS`に登録できる(仮11)。
- tournament-week・tournament-year(後続): `RelaunchConditionSource`(結果確定待ち。参加資格を得る前は決済期限を解除の日時として返す)・`ProductLockSource`(組み合わせ決定後・前ラウンド勝利後〜マッチ終了)・`LaunchSummarySource`(ローンチの結果の要約と受賞)を登録する。削除による参加資格の喪失(FR-TOURW-027)はプロダクトの`deleted`、退会によるものはユーザーの`withdrawn`の処理として登録する。削除の確認ダイアログの注意書きを`PRODUCT_DELETE_NOTICES`へ、自分のプロダクトの画面の参加費の導線を`MY_PRODUCT_SECTIONS`へ登録する。
- sponsorship(後続): 削除の確認ダイアログの注意書き(FR-SPONS-020)を`PRODUCT_DELETE_NOTICES`へ登録する。広告の停止は`visibleProducts()`で判定し、物理削除はプロダクトの`purge_due`の処理(1600番台)で行う。
- engagement(後続): コメント・評価の物理削除をプロダクトの`purge_due`の処理(1400番台)で行う。
- ugc-moderation(後続): `ProductVisibilityControl.hide`・`unhide`と、管理画面の検索の照会`AdminProductDirectory`(仮13、本specが所有して実装)を呼ぶ。理由・監査・通知はugc-moderationが持つ。未開始のローンチの取り消し(FR-ADMUG-010)と画像の隔離(FR-ADMUG-047)は本specが行う。
- data-export(後続): `ProductExport.listByUser`・`LaunchExport.listByUser`を呼び、本specのテーブルを直接読まない。画像の実体はmedia-pipelineの`openContent`で読む。
- public-api(後続): 説明文の更新は`ProductDescriptionEditor`を、読み取りは`ProductDirectory`を呼ぶ。bot対策はユースケースに含めない。 仮12(requested by public-api)により、`ProductDescriptionEditor.update`は書き込みの時点で非公開化中なら`AppError({ kind: 'conflict', code: 'product_hidden' })`を文言「このプロダクトは公開が停止されているため、説明文を更新できません。」で投げる(事前の判定との間の非公開化も拒否する)。public-apiは`OwnProductDescriptionService.update`でこの`AppError`(`product_hidden`・`product_not_found`・`account_unavailable`)をそのまま返し、事前の判定の`product_hidden`にも同じ文言を使う(public-apiの設計への申し送り)。

## 設計のレビュー(2026-10-23)

- 機械的な確認: 要件の131件の受け入れ基準の番号がすべて追跡表にあることを、番号の境界を区切った検索で確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、(1)`ProductStore.findForOwner`が旧ハンドルの印と解決の関数を重ねて持っていた(旧ハンドルは`resolveOwnPreviousHandle`だけに寄せた)、(2)`latest_launch_date`の更新が取消のローンチの日付を考えていなかった(取消を含む全ローンチの最大を最後の文で入れ直す形に直した)、(3)eventのポートの一覧に使わない名前が残っていた、を直した。2回目で問題は無かった。
- 境界の確認: 予選の結果は本specの写しとして持つが、書き込むのはmatch-engineが記録の口から行う1か所だけで、マッチ記録そのものは持たない。非公開化の操作口の権限・理由・監査はugc-moderationに残し、データ側の処理(取消・画像の隔離)だけを本specが持つ。物理削除の順序は帯の外の値を使わずに、プロダクトの`purge_due`の処理の順で保つ。

## タスクの計画の検証(2026-10-23)

- タスクのグラフのサニティレビューを2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
- 1回目の判定はNEEDS_FIXES(必須5件・軽微9件)だった。指摘は、(1)ローンチの状態と予約の案内の部品を作るタスクが無いままローンチ日の欄が使っていた(9.2に独立させた)、(2)登録画面の完了状態が後のタスクの一覧の画面を前提にしていた(一覧を9.3、フォームを9.6に並べ替えた)、(3)カテゴリとローンチ履歴のタスクが(P)でapiのDIの識別子・束縛のファイルを並行して編集し、束縛の担当が無かった((P)を外し、各タスクに識別子と束縛を持たせた)、(4)管理画面の区画の許可リストの再生成がクライアントの操作のタスクと並行し得た(`_Depends: 7.3, 9.1`と注記)、(5)`ProductStore`の一覧・旧ハンドル・説明文のD1の実装とテストの担当が無かった(4.1に全メソッドとテストを置いた)。軽微の指摘(DIの識別子の一覧の作成の担当、操作口の束縛、2.3の(P)、テーブルの制約のテストの種別、登録と編集のタスクの分割、ローンチ日の欄の分割、フォームの検証規則のテスト、物理削除のストアの担当、不要な依存)もすべて直した。
- 2回目の判定はPASSだった。軽微の指摘(2.3の冗長な境界と依存、9.8の依存の理由)に従って直した。
- 並行して作成中だったhelp-centerが`frontend/011-table-of-contents.md`を使うと分かったため(コーディネーターからの連絡とhelp-centerの設計で確認)、本specのフロントエンドの技術ドキュメントを`frontend/012-business-date-calendar.md`にした。

## 仮11の追加(2026-10-24)

- コーディネーター経由で、directory-discoveryから2つの拡張点の依頼を受けた(requested by directory-discovery)。directory-discoveryのdesign.md・research.mdの`PRODUCT_SAVE_HOOKS`(`ProductSaveHook`の`statementsFor(input: { productId, at }, db)`・`afterCommit(input: { productId })`、登録`{ name, hook }`、置き場所`application/product/product-save-hooks.ts`・`composition/product-save-hooks.ts`)と`productInCategory(categoryId)`の名前と形に合わせた。
- 要件14.9・14.10・14.11を加え(受け入れ基準は134件)、設計の境界・ファイル構成・System Flows・コンポーネント・追跡表・テストを直した。予選の結果からの要約の規則の共有(14.11)は、小さく閉じた追加として同時に入れた。
- タスクは3.3(保存の登録口)を新設し、1.2・2.1・4.1・4.2・4.3・6.2を変えた。変更部分のタスクのグラフのサニティレビューの結果は下に記録する。
- 変更部分のサニティレビューを2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。1回目はNEEDS_FIXES(必須2件・軽微6件)で、(1)14.9の「同時の処理の失敗で保存を取り消す」を確かめるテストが無い(4.1とTesting Strategyに、登録した文の実行時の失敗と`statementsFor`の例外のテストを加えた)、(2)仮決定の範囲が「仮1〜仮10」のままの箇所があった(12.3・Goals・Revalidation Triggersを仮1〜仮11に直した)。軽微のうち、仮11の保留の扱いの統一(保留せず確認待ちのまま進める)、3.3の境界のファイル、4.2の取り消し時に確定の後の処理を呼ばないテスト、コンポーネント表の14.9、11.1の`backend/013`の記載を直した。2回目はPASSだった。
- directory-discovery側に残る事項(本specでは編集しないため、コーディネーターへ報告): Modified Filesが`application/product/product-save-hooks.ts`・`d1-product-store.ts`・`product-description-editor.ts`・`visibility.ts`をdirectory-discoveryの変更としている(本specの1.2・3.3・4.1〜4.3が作るため、`composition/product-save-hooks.ts`への登録の追記だけにできる)。「上流への影響」の「設計の改訂が必要(開発者の承認待ち)」は、本specの仮11として取り込み済みの表現に改められる。`launch-summary-fallback.ts`は本specの`core/product/launch-summary.ts`の再エクスポートにすると文言のずれを防げる。

## 仮12の追加(2026-10-24)

- コーディネーター経由で、public-apiから`ProductStore.updateDescription`への`notHidden`の条件と`'hidden'`の結果、`ProductDescriptionEditor.update`の`AppError({ kind: 'conflict', code: 'product_hidden' })`の依頼を受けた(requested by public-api)。public-apiのdesign.md(`OwnProductDescriptionService.update`の手順とエラーの表)とresearch.md(上流への推奨の改訂)のとおりに合わせた。
- 要件7.9を加え(受け入れ基準は135件)、設計のストアの契約と一括の書き込み・ユースケース・エラーの表・追跡表・Revalidation Triggers・テストを直した。タスクは4.1(判定と書き込みの間の非公開化のテストを含む)・4.3・12.3を変えた。
- 変更部分のサニティレビューの1回目(independent)はNEEDS_FIXES(必須1件・軽微3件)だった。(1)`product_hidden`の`AppError`の文言が未定義だった(public-apiは上流の`AppError`をそのまま返すため、本specが「このプロダクトは公開が停止されているため、説明文を更新できません。」を定め、public-apiの事前の判定にも同じ文言を使うよう申し送る)。軽微の、判定と書き込みの間の非公開化のテストの手順の明示、投稿者の状態の取り消しを`save`と同じ`account-unavailable`にそろえること、分類の優先の順(不在・論理削除→投稿者の状態→非公開化)と重なりのテストも直した。
- 2回目(independent)はPASSだった。軽微の指摘に従い、本書の仮12の記録(決定・仮決定の表・public-apiへの申し送り)に`account-unavailable`・分類の優先の順・文言を加えた。public-api側の申し送り(`OwnProductDescriptionService.update`が上流の`AppError`をそのまま返す旨の明記と、`product_hidden`の文言をそろえること)はコーディネーターへ報告する。

## 仮13・仮14の追加と軽微な修正(2026-10-24、承認の後の改訂)

cross-spec reviewの指摘による、承認の後の改訂である。仮13・仮14は2026-10-24に開発者が推奨どおりに確定した(仮13は本specが所有して実装する案)。

- **仮13(管理画面のプロダクトの検索の照会)**
  - 決定: ugc-moderationが本specの`workers/product`へ加えるとしていた`AdminProductDirectory`(`search`・`countRegisteredAt`)と`D1AdminProductDirectory`を、本specが所有して実装する。置き場所は`apps/backend-lib/workers/product/admin-product-directory.ts`、識別子は`PRODUCT_PLATFORM_TYPES.AdminProductDirectory`、束縛は`PRODUCT_PLATFORM_MODULE`(api・event)。契約の形はugc-moderationの設計の`AdminProductDirectory`をそのまま写し、コンストラクタ`D1AdminProductDirectory(db: Database)`を加えた。名称・ハンドルの部分一致と最新のローンチの状態・公開の状態による絞り込みは、後続specに許す結合の範囲(仮11)を超えるため、本specのディレクトリの中だけの明示の例外として記録した(design.mdのAllowed Dependenciesの末尾とAdminProductDirectory)。
  - 理由: 本specの`products`・`product_launches`の読み取りを本spec以外が実装すると、列や状態(`deriveLaunchStatus`の境界・非公開化)を変えたときに本specの中で照会とテストを直せない。所有者が照会も持てば、Revalidation Triggersで利用者(ugc-moderation)へ伝えられる。
  - 反映: requirements.mdの14.12と前書き、design.mdのThis Spec Owns・Allowed Dependencies・Revalidation Triggers・Directory Structure・追跡表・コンポーネントの表・ProductPlatformModule・AdminProductDirectory・Testing Strategy、tasks.mdの2.6・12.3。
- **仮14(公開プロフィールの受賞バッジの区画)**
  - 決定: user-profile-socialの`PUBLIC_PROFILE_BADGES`(初版は空)へ本specが`{ id: 'product-launch.award-badges', order: 10, Section: ProfileAwardBadges }`を登録する。受賞はローンチ履歴の対象(10.2)と同じプロダクトについて`LAUNCH_SUMMARY_SOURCES`の`awards`を集め、ラベルを`'<名称> <受賞のラベル>'`にして`groupAwards`でまとめる(`LaunchHistoryReader.awards`・GraphQLの`profileAwards`)。受賞が無い・`null`・取得エラーでは区画を描かない。受賞バッジの描画は`AwardBadgeList`として`LaunchHistoryItem`と共用する。
  - 理由: user-profile-socialの要件8.5とページ配置(フォロワー数の下の受賞バッジ)を満たす登録が、どのspecにも無かった。本specは既に`groupAwards`・`LAUNCH_SUMMARY_SOURCES`(受賞の供給)とローンチ履歴のタブを持つため、トーナメントのspecごとに登録するより集計の範囲と表示がローンチ履歴とそろう。
  - 反映: requirements.mdの仮14の行・10.11・前書き、design.mdのThis Spec Owns・Allowed Dependencies・Revalidation Triggers・上流への影響・Directory Structure・Modified Files・追跡表・コンポーネントの表・LaunchHistoryReader・ProductSchemaModule・ProfileAwardBadges・Testing Strategy・Performance・本specが定める固有の値、tasks.mdの6.3・7.4・9.1・9.8・9.9・12.3。
- **変更履歴(軽微、振る舞いの変更なし)**: design.mdのRevalidation Triggersで`PRODUCT_SAVE_HOOKS`の利用者に挙げていたengagement・sponsorship・ugc-moderationは登録していないため、登録するdirectory-discoveryだけにし、登録口が他の後続specにも開いている旨を添えた。
- 受け入れ基準: 要件10.11・14.12を加え、137件になった。
- 変更部分のタスクのサニティレビュー(2026-10-24): 新しいサブエージェントによる独立した確認(independent)を1回行い、PASSだった。軽微の指摘に従い、2.2の識別子の一括作成から2.6の`AdminProductDirectory`を除く旨、9.9の登録に`Section`を、2.6の`_Boundary:_`に識別子の追記を、requirements.mdの前書きの範囲に受賞バッジの区画を、本書の仮14の行にタスク9.8を加えた。同じグループの前のタスクへの`_Depends:_`は既存のタスク(2.4など)の書き方に合わせて残した。

## 仮10の確定(2026-10-24)

- 開発者が2026-10-24に仮10(`react-day-picker`、shadcn/uiのカレンダー、9系)を承認し、確定した(コーディネーター経由の連絡)。tech-stack.mdのUI・スタイリングへの行はコントローラーが追加済みで、本specは変更しない。アプリの`package.json`はまだ無いため、導入は実装のタスク1.4で行う。
- 反映: requirements.mdの仮10の行と前書き、本書の仮10の行・確認済み事項・リスク、design.mdの保留の表現(Calendarの自作の代替・Migration Strategy・Revalidation Triggers・版の固定の記述)、tasks.mdの1.4(保留の条件を外し、9系の最新の安定版を3つの`package.json`へ完全固定で追加する)と12.3(仮10を確認待ちの一覧から外す)。他の仮は確認待ちのまま。
- `coding/002`の一覧への掲載: `coding/002`の主要パッケージの一覧の対象(版が食い違うと基底設定・プリセットが動かない、または組み合わせられる版の範囲が狭いもの)ではないため一覧には載せず、同文書の「一覧に無いパッケージでも、共有ディレクトリのコードが実行時に使うものは、利用側アプリが共有ディレクトリ側と同じ版で宣言する」と共有ディレクトリの文書の規則に従う。変更部分のレビューの指摘(一覧の基準に合わない)を受けて、一覧に載せる案を採らなかった。
- 変更部分のサニティレビューの1回目(新しいサブエージェントによる独立した確認)はNEEDS_FIXES(必須3件・軽微3件)だった。本書の前書きと「仮決定」の節の本文、design.mdのSteering complianceに残っていた確認待ちの表現を直した。1.4の追加先を3つの`package.json`と各`bun.lock`に明記し、実行時の依存として追加すること、各`bun.lock`の版の一致を完了状態に加えた。`coding/002`の主要パッケージの一覧への掲載は一覧の基準に合わないため取りやめ、同文書の共有ディレクトリの規則(利用側アプリが同じ版で宣言する)に従う形にした。
- 2回目(同じ独立したレビュー)はPASSだった。軽微の指摘に従い、上の反映の記録の1.4の説明を一覧に載せない方針に合わせた。

## 開発者による仮決定の確定(2026-10-24)

- 開発者が仮1〜仮14の全てを確定した(コーディネーター経由の回答)。仮10は先に確定していた。
- 推奨どおり: 仮1〜仮3・仮6〜仮9・仮11〜仮14(仮13は「上流(本spec)が所有・実装」で既存の仮13と同じ)。
- 推奨と異なる: 仮4は(B)今日から90日後まで。`LAUNCH_DATE_HORIZON_DAYS`を90にし、要件4.3・15.2、設計の`computeLaunchDateWindow`・エラーの文言の例・テスト・固有の値、タスク1.1・1.3・3.1を直した。
- 仮5: 論理削除したプロダクトの現在のハンドルは物理削除まで使用中(推奨どおり)、旧ハンドルの転送は論理削除で止める(推奨どおり)。旧ハンドルは、user-profile-socialの仮2の回答(B: 他者も設定でき、設定された時点で元の保持者の旧ハンドルを消す)に合わせて他のプロダクトが設定できるようにした(推奨と異なる)。要件2.3・2.9・2.10を直し、2.11を加えた(受け入れ基準は138件)。設計は`isHandleOccupied`・`handleOccupiedCondition`の意味、登録・保存の一括の書き込みへの`previousHandleRelease`の追加、使用可否、編集画面の案内の文言、不変条件、テスト、Revalidation Triggers、上流への影響を直した。タスクは1.1(前提)・1.3・2.2・4.1・4.4・5.1・9.4・11.2を直した。
- user-profile-socialへの依存: ハンドル基盤の仮2(B)の改訂(他の対象の旧ハンドルを使用中としない`isHandleOccupied`・`handleOccupiedCondition`と、元の保持者の行を消す文`previousHandleRelease(db, ns, { handle, exceptOwnerId }): BatchItem<'sqlite'>`)を前提にする。名前と形はuser-profile-socialの改訂に合わせる。
- 確認待ちの表現を全ての文書から取り除き、タスク3.3の保留の注記と12.3の確認待ちの報告を外した。
- 確定の反映の後に、新しいサブエージェントによる独立した確認(independent)で、変更部分の設計のレビューとタスクのグラフのサニティレビューを1回行い、どちらもPASSだった。軽微5件(同じ旧ハンドルを2つのプロダクトが同時に設定するテスト、4.4の要件2.11、要件2.11の起点に登録を含めること、確認事項の表の仮5の根拠の注記、上流specの文書を変更しない旨の表現)も直した。
