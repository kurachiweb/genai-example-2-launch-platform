# Research & Design Decisions

## Summary

- **Feature**: `content-reporting`
- **Discovery Scope**: Complex Integration(通報の実装は無い。上流の26spec(dev-tooling〜ugc-moderation)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはugc-moderationの`ProductModerationService`・`CommentModerationService`・`UserModerationService`と`ModerationCommand.statements`・`ADMIN_PRODUCT_DETAIL_SECTIONS`、admin-foundationの`requireAdmin`・`AuditLogRecorder`・`buildAuditLogStatements`・`AuditLogReader.latestFor`・`ADMIN_NAV_ITEMS`・`DASHBOARD_CARDS`・`DashboardCardFrame`・`CategoryMasterEditor`・E2Eの補助、inquiry-chatの`CATEGORY_SECTIONS`と未ログインの送信とカテゴリの規則の前例、directory-discoveryの`PRODUCT_PAGE_SECTIONS`、user-profile-socialの`PUBLIC_PROFILE_MENU_ITEMS`・`UserProfileDirectory`、engagementの`COMMENT_ACTIONS`・`CommentStore`、product-launchの`ProductDirectory`・プロダクトライフサイクル、identity-authの`AccountGuard`・`UserContactDirectory`・ユーザーライフサイクル、backend-platformの`RateLimitCounterClient`・`hashRateLimitKey`・bot判定、api-gatewayの`assertHuman`・`caller`、email-deliveryの`EmailSender`の上に、通報の受け付け・案件・通知・管理画面を足す)
- **Key Findings**:
  - ugc-moderationの措置のユースケースは`ModerationCommand.statements`を状態の変更と同じ一括の書き込みに入れ(プロダクト・ユーザーは要求単位の保留中の措置と同期の処理、コメントはengagementの操作口へ直接)、呼び出し側の文がNOT NULL制約に違反すれば全体が取り消される。本specは案件の完了(`CASE`式の条件付きの更新)と監査ログをその文として渡し、措置・措置の記録・2つの監査ログ・案件の完了を1回で確定する。措置と案件の結び付きは、措置の結果の`ModerationOutcome.actionId`を本specの`report_cases.resolution_action_id`に残して表し、ugc-moderationの形は変えない(cross-spec reviewの修正1)。
  - admin-foundationの`AuditLogReader.latestFor`は1つの対象の最新の日時を返す形で、一覧の50件の対応期間を求めると項目の数だけ問い合わせる(NFR-PERF-008に反する)。同じ照会の複数の対象版`latestForMany`は、admin-foundationが仮7として所有・実装し(テストの共有の偽物を含む)、本specはそれを使う(cross-spec reviewの修正2)。
  - inquiry-chatが未ログインの送信(`assertHuman`→検証→ハッシュ化したキーの`RateLimitCounterClient.hit`→書き込み)、停止中の利用者の扱い(Q1)、カテゴリの規則(仮1・仮2)、カテゴリの削除の付け替えの一括の書き込みを決めており、本specはそのまま当てはめる。ログイン中の利用者ごとの制限を足す点だけが新しい。
  - 4:21のジョブと波及処理は本specのデータだけを扱い、上流の値より前に動く必要が無い。新しいパッケージ・シークレット・Durable Objectのクラス・メッセージ種別は要らない。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を推奨とした。**仮1〜仮8はすべて2026-10-24に開発者が確定した。** 仮1・仮2・仮4・仮6・仮8は推奨どおり、仮3・仮5・仮7は推奨と異なる案(B)である。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。roadmapの「Requirement Ambiguities」の表に本specが担当に含まれる行は無い。新しいnpmパッケージは要らない。4:21のジョブとライフサイクルの波及処理はすべて本specの2000番台に収まり、上流の値より前に動く必要のある処理は無い。

| #   | 論点                                 | 根拠                                                                                                                                                                                                                                                                                                                                                  | 選択肢                                                                                                                                                                                                                                                             | 推奨と確定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | 集約の単位と案件のライフサイクル     | FR-ADMUG-020(対応ステータスは4種)・FR-ADMUG-027(同一コンテンツへの複数の通報を1件に集約し、件数と通報理由の内訳と共に表示)、削除請求フロー(同一コンテンツへの複数の申出は1件に集約)、DR-022(未ログインの通報はステータスが対応済・却下になってから14日で削除)、FR-ADMUG-040(対応期間は権利侵害カテゴリの通報について)                                 | (A)対象ごとに未完了の案件を1つ持ち、完了後の通報は新しい案件にする。カテゴリが混ざっても1つの案件にし、権利侵害を含む案件を権利侵害の案件とする / (B)対象とカテゴリの組で集約する / (C)完了した案件にも集約し、通報が届いたら再開する                              | 推奨は(A)。集約の要件の主語は「同一コンテンツ」で、カテゴリでは分けていない。措置は対象に1回だけ行うため、カテゴリで分けると同じ対象への措置と通知が案件の数だけ重なる。完了した案件へ集約し直すと、既に送った対応結果の通知・14日の保持期間の起点・対応期間が後から動き、記録の意味が変わる。(A)なら対応ステータスと保持期間の起点が案件ごとに1つに定まる。対応期間は、権利侵害の申出が案件に入った時点(最初の権利侵害の通報の受付日時)から測る 2026-10-24に開発者が(A)に確定(推奨どおり)。                                                                                                                                                                                          |
| 仮2 | 通報からの措置の範囲                 | FR-ADMUG-025(通報一覧の各項目から、理由付きで対象コンテンツを非公開化(FR-ADMUG-009・013)、また通報却下)、FR-ADMUG-030(ユーザーの停止も通報由来の措置になり得る)、briefのDesired Outcome(ugc-moderationの非公開化・停止のユースケースを使う)、削除請求フロー(画像だけの申出は画像を隔離して差し替えを求める)、ugc-moderationの`ImageModerationService` | (A)案件から直接行うのはプロダクト・コメントの非公開化とユーザーの停止だけ。画像の隔離・評価の無効化は案件から各管理画面へ移って行い、案件は「措置なしで対応済」にする / (B)画像の隔離も案件から直接行う                                                            | 推奨は(A)。要件が通報の画面から求める措置は非公開化(と停止)で、ugc-moderationのその3つの操作は呼び出し側の文を状態の変更と同じ一括の書き込みに入れられる。画像の操作は媒体の移動の後に記録を書く形で、案件の完了と一体にできず、投稿者への通知も無い(FR-ADMUG-030の対象外)。画像だけの申出は、案件の詳細からプロダクト・ユーザーの管理画面へ移り、画像を隔離した後に「措置なしで対応済」で申出者へ結果を伝える。評価は通報の対象でない(FR-REPOT-001) 2026-10-24に開発者が(A)に確定(推奨どおり)。                                                                                                                                                                                      |
| 仮3 | 対応ステータスの遷移と理由の要否     | FR-ADMUG-020、FR-ADMAG-024(問い合わせは「FR-ADMUG-020と同様の方式」で4状態)、inquiry-chatの対応ステータス(管理者は任意の値へ変更できる)、FR-ADMUG-025・030・039(措置と却下で当事者へ通知)、FR-ADMAG-001(FR-ADMUG-020・025の操作は理由とともに監査ログ)、DR-022(完了から14日で削除)                                                                    | (A)手で変えられるのは未対応⇄対応中だけ(理由は任意)。対応済は措置か措置なしの対応済、却下は却下の操作でだけ到達し、理由は必須。完了した案件は戻さない / (B)問い合わせと同じく4状態の間を自由に変えられる / (C)却下の理由を任意にする                                | 推奨は(A)。却下と措置は当事者への通知を伴い(FR-ADMUG-030・039)、通知を伴わない手での「却下」「対応済」を許すと通知の漏れになる。完了した案件を戻すと、送った通知・保持期間の起点・対応期間の終点が変わり、同じ対象に未完了の案件が2つできる(仮1と矛盾する)。却下の理由は投稿者と申出者へ通知され、削除請求フローの「結果の通知」の内容になるため必須とする(ugc-moderationの仮9は取り消しの操作の理由を任意としたが、却下は取り消しでなく判断の結果である) 2026-10-24に開発者が(B)に確定(推奨と異なる)。通知は措置・措置なしの対応済・却下の操作でだけ送り、手での状態の変更では送らない。理由の要否・再開の扱い・未完了の案件の一意との整合は末尾の「開発者の確定による改訂」に記す。 |
| 仮4 | 権利侵害の照会の内容と回数           | FR-ADMUG-035(「対応中」の申出に対し投稿者へ事情を照会するメール)、削除請求フロー(照会のメールに対象コンテンツと回答方法を記載し、送信日時を7日間の起算点として監査ログに記録する)、通報ダイアログのモックアップ(「通報者の情報が投稿者に伝わることはありません」)、文言規則の件名                                                                     | (A)管理者が1〜1,000文字の照会の内容(侵害されたとする権利と理由の要旨)を書き、対象と回答の方法と期限を添える。申出者の情報と理由そのものは載せない。再送でき、期限は最後の照会から / (B)申出者の理由をそのまま転記する / (C)照会は1案件に1回だけにする              | 推奨は(A)。照会では、投稿者が反論できるよう侵害されたとする権利と理由を伝える必要があるが、申出者の理由の原文は申出者を特定できる情報を含み得て、ダイアログの約束に反する。管理者が要旨を書けば、伝える内容を運営が制御できる。送信の失敗・宛先の変更・追加の質問に備えて再送を許し、法の7日は最後に送った照会から数える(監査ログの最新の照会の日時)。照会の内容は案件に残し、監査ログには内容を入れない(個人情報を含み得るため) 2026-10-24に開発者が(A)に確定(推奨どおり)。                                                                                                                                                                                                          |
| 仮5 | 対応期間の起点と目標の超過の判定     | FR-ADMUG-040(受付日時から対応完了日時(監査ログに記録)までの経過時間)、削除請求フローの目標期間(受付から確認開始まで1営業日以内、受付から判断・通知まで9日以内、超過した申出は対応期間表示で強調)、要件定義書・サービス仕様に営業日の暦の定めが無いこと                                                                                                | (A)起点は最初の権利侵害の通報の受付日時、終点は監査ログの完了の日時。確認開始の超過は「未対応のまま土日(基準時刻)を除いて24時間」、判断の超過は「起点から9日(216時間)」。祝日は考慮しない / (B)1営業日を単純な24時間とする / (C)祝日の暦を持ち、管理画面で編集する | 推奨は(A)。営業日の暦(祝日)はどの国のものかも定まっておらず、暦を管理する機能は要件に無い。土日を除く判定は基準時刻の日付だけで決まり、金曜日の夜の申出が月曜日の朝に超過と出る誤りを避けられる。9日は暦の日数として扱う(照会の7日と同じ数え方)。確認開始の目標は「未対応」から抜けたかで判定し、対応中・完了の案件には出さない 2026-10-24に開発者が(B)に確定(推奨と異なる)。1営業日は土日を含む単純な24時間で、祝日を考慮しない。                                                                                                                                                                                                                                                    |
| 仮6 | 停止中の利用者の通報                 | FR-REPOT-001(ログイン状態を問わず通報できる)、FR-USER-026(停止中の利用者の書き込み操作を拒否)、inquiry-chatのQ1(停止中の利用者は未ログインと同じフォームで送り、未ログインの問い合わせとして保存する。承認済み)、identity-authの停止中のセッション(有効なまま)、LR-004(権利者は誰でも削除を申し出られる)                                              | (A)停止中の利用者の通報を未ログインの通報として受け付ける(利用者に結び付けず、権利侵害なら連絡先メールアドレスを必須にし、回数制限は送信元IPアドレスだけ、保持期間も未ログインと同じ) / (B)停止中の利用者の通報を拒否する                                          | 推奨は(A)。停止中の利用者も、ログアウトすれば未ログインとして通報できるため、拒否しても防げない。inquiry-chatのQ1と同じ扱いにすると、利用者に結び付いた書き込みを拒否する(FR-USER-026)ことと、誰でも申し出られること(LR-004)が両立し、利用者側の画面も問い合わせと同じ判定(`Viewer.status`)で出し分けられる 2026-10-24に開発者が(A)に確定(推奨どおり)。                                                                                                                                                                                                                                                                                                                               |
| 仮7 | 通報の対象の物理削除に伴う案件の扱い | FR-USER-019・022(退会した利用者の通報の投稿を論理削除し、期間の経過で物理削除)、DR-002(退会から14日以内に個人データを物理削除)、ugc-moderationの要件13.6(利用者・プロダクトの物理削除の時期に措置の記録を削除)、要件定義書に対象の側の定めが無いこと                                                                                                  | (A)利用者の物理削除の時期に、その利用者が投稿者である案件(プロフィール・プロダクト・コメント)を、プロダクトの物理削除の時期にそのプロダクトの案件を、通報ごと物理削除する / (B)案件と通報を残し、対象への参照だけを消す                                            | 推奨は(A)。対象が消えた後の案件は措置も通知もできず、申出者の理由には投稿者を指す内容が残り得る。監査ログ(3年)に操作の記録は残るため、説明責任は保てる。ugc-moderationが措置の記録で採った扱いとそろう。他の申出者の通報も消えるが、対象が存在しない以上、対応の余地は無い 2026-10-24に開発者が(B)に確定(推奨と異なる)。保持期間と申出者の理由の扱いは末尾の「開発者の確定による改訂」に記す。                                                                                                                                                                                                                                                                                        |
| 仮8 | 標準カテゴリの名前の変更と並び順     | FR-ADMCF-020(標準カテゴリ「権利侵害」「その他」を削除できない)、FR-ADMCF-021(削除時は「その他」へ付け替え)、inquiry-chatの仮2(「その他」は名前の変更も拒否し、追加の順で末尾に置く。承認済み)、LR-004(「権利侵害」は削除請求の窓口)、モックアップ(権利侵害は選択肢の中ほど、その他は末尾)                                                             | (A)両方の標準カテゴリの名前の変更も拒否し、追加の順で「権利侵害」「その他」をこの順で末尾に置く / (B)名前の変更は許す / (C)「権利侵害」を先頭に置く                                                                                                                | 推奨は(A)。「権利侵害」は連絡先の要否・照会・対応期間の判定の鍵で、名前を変えると利用者に削除請求の窓口が分からなくなる。inquiry-chatの承認済みの規則(標準は名前も固定・末尾)を両方の標準カテゴリに当てはめると、カテゴリの規則がマスタ間でそろう。先頭に置くと、通常の通報で権利侵害を選ぶ誤りが増える 2026-10-24に開発者が(A)に確定(推奨どおり)。                                                                                                                                                                                                                                                                                                                                   |

### 確認済みのため質問しない事項

- 通報の置き場所: 公開プロフィールの「…」メニュー(user-profile-socialの`PUBLIC_PROFILE_MENU_ITEMS`、`order` 10)、プロダクト詳細のページ末尾(directory-discoveryの`PRODUCT_PAGE_SECTIONS`の`bottom`、`order` 10)、他者のコメントの「…」メニュー(engagementの`COMMENT_ACTIONS`、`order` 10)。本人には表示しない(ページ配置、FR-REPOT-005)。スポンサー広告には通報の操作を置かない(ページ配置に記載が無く、FR-REPOT-001の対象はユーザー・プロダクト・コメントだけである)。
- 連絡先メールアドレス: 未ログインで「権利侵害」を選んだときだけ表示し必須にする(FR-REPOT-003)。ログイン中の申出者には登録メールアドレスで知らせる(FR-ADMUG-030)。
- 回数制限: 送信元IPアドレスごとに1時間10回、ログイン中は利用者ごとにも同じ基準。Durable Objectsの厳密カウンタとAlarmで1時間後に0に戻し、キーはハッシュ化する(FR-RLMIT-004・016・020、brief)。数えるのは入力の検証とbot判定と対象の確認を通った送信だけで、送信元IPアドレスが不明なら警告を残して数えない(inquiry-chatの`security/008`の規約と同じ)。
- 管理画面のURLと`order`: 通報`/reports`(70)(admin-foundationの仮6、承認済み)。カテゴリは`/categories`の区画(`order` 40、inquiry-chatの仮4、承認済み)。ダッシュボードのカードは`order` 30(admin-foundationのQ2)。
- ロール: 全ロールが全メニューを参照でき、モデレーターは要件が最上位管理者に限っていない更新操作をすべて行える(admin-foundationのQ3)。本機能の操作は全てモデレーター以上、照会は閲覧のみ以上。
- カテゴリ名の規則: 1〜30文字、前後の空白を除き大文字小文字を区別しない一意(inquiry-chatの仮1、承認済み)。
- 措置の通知: 投稿者への措置の通知はugc-moderationの措置の操作が送る(FR-ADMUG-030の前半)。本機能は申出者への通知(後半)と却下の通知(FR-ADMUG-039)と照会を持つ。
- 投稿者の宛先: identity-authの`UserContactDirectory`で引き、`users`を直接読まない。退会済みで`undefined`なら送らない(brief)。
- 対応期間の終点: 監査ログに記録した案件の完了の日時を、admin-foundationの`AuditLogReader`で引き、監査ログのテーブルを直接読まない(brief、FR-ADMUG-040)。
- 未ログインの通報の保持期間: 対応済・却下になってから14日で、連絡先メールアドレスを含めて日次バッチで物理削除する。未対応・対応中のままの通報は削除しない(DR-022、準拠方針の注4)。
- データエクスポート: `reports.json`の項目(ID・対象の種類・対象の参照・受付時点のカテゴリ名・理由・送信日時)と、対応ステータスや管理者の判断を含めないこと(データエクスポートの文書)。
- 4:21のジョブと波及処理の`order`: 本specの2000番台(roadmapの帯の割り当て)。上流の値より前に動く必要のある処理は無い(通知の送り直しと保持期間の削除は本specのデータだけを扱い、物理削除の処理は上流の処理の後で良い)。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する。

## 要件のレビュー(2026-10-24)

- 機械的な確認: 20の要件の見出しがすべて数字のIDを持ち、受け入れ基準がすべてEARSの形式(`When`・`If`・`While`・`Where`・`The … shall`)である。技術名は要件定義書の用語(429 Too Many Requests・ハッシュ化)、日時の`<time datetime>`(サービス仕様の規則)、URLと`order`(admin-foundationの仮6)に限った。
- 判断のレビューで、境界になりやすい振る舞い(未完了の案件が対象ごとに1つだけであること(5.2)、措置・却下と監査ログの一体の確定(9.2・10.2・16.4・16.5)、競合や既に措置済みのときに何も残らないこと(9.5・9.8)、通知の送り直しの重複の防止(11.8)、投稿者への通知と照会に申出者の情報を含めないこと(11.6・12.4)、未ログインの通報の保持期間(17.1・17.2))が受け入れ基準にあることを確かめ、問題は無かった。要件定義書・サービス仕様で決まらない論点は仮1〜仮8として記録し、要件の範囲の推測は加えていない。

## Research Log

### 上流specの契約と申し送り

- **Context**: roadmapのShared seams(画面シェル・`DASHBOARD_CARDS`・`CATEGORY_SECTIONS`・監査ログ・利用者の連絡先の照会・ユーザーとプロダクトのライフサイクル・データエクスポートの出力・E2Eの管理者ログイン)と、全specの`design.md`・`research.md`の「content-reporting」を含む行。
- **Sources Consulted**: admin-foundation・ugc-moderation・inquiry-chat・engagement・directory-discovery・user-profile-social・product-launch・identity-auth・backend-platform・api-gateway・email-delivery・frontend-platform・sponsorshipの`design.md`と`research.md`の後続specへの申し送り、data-exportのbrief、要件定義書の4.12・4.21〜4.23・4.29・7章、サービス仕様(ページ配置・文言規則・準拠方針・プライバシーポリシーの骨子・侵害コンテンツ削除請求フロー・データエクスポート・日次タイムライン)、通報ダイアログのモックアップ(`mockups/src/components/client/report-dialog.tsx`)。
- **Findings**:
  - admin-foundation: `DashboardCard`(`{ id, order, width, component }`、本specは30、カードが自分で取得し`DashboardCardFrame`で状態を出す)、`ADMIN_NAV_ITEMS`の`/reports`(70、仮6)、`AuditTargetKind`の`report`・`category`、`AuditActionDefinition`(`reason`・`detailKeys`・`maxTargets`)、`AuditLogReader.latestFor({ action, targetKind, targetId })`(「`latestFor`はcontent-reportingの対応期間の表示」と明記)、`CategoryMasterEditor`(`withHandle`・`canEdit`・`systemDefault`)、`ConfirmActionDialog`(`reason`・`audited`)、Q2(未対応の通報の件数のカードはcontent-reportingの担当)、Q3(全ロールが全メニューを参照、モデレーターは更新操作)。
  - ugc-moderation: `MODERATION_TYPES`の`ProductModerationService.hide`・`CommentModerationService.hide`・`UserModerationService.suspend`、`ModerationCommand`(`targetId`・`reason`・`operator`・`at`・`statements`)と`ModerationOutcome`(`changed`・`actionId`)。全ユースケースは`requireAdmin`を行わず、content-reportingのリゾルバが認可する(15.7)。既に同じ状態なら上流を呼ばず`changed: false`。投稿者への措置の通知はugc-moderationが送る。`ADMIN_PRODUCT_DETAIL_SECTIONS`(`AdminProductDetailContext`の`productId`・`ownerUserId`)。申し送り「通報からの措置は3つのユースケースを`statements`付きで呼び、通報の状態の更新を同じ一括の書き込みで確定する。申出者への通知(FR-ADMUG-030の後半)はcontent-reportingが持つ」。
  - inquiry-chat: `CategorySection`(`{ id, order, title, component }`、本specは40)、`CategoryMasterEditor`を`withHandle: false`で使う、カテゴリ名の大文字小文字を区別しない一意(仮1)と標準カテゴリの名前の変更の拒否・末尾の並び(仮2)、`InquiryStatus`の値と表示名、未ログインの送信の順序と`GUEST_INQUIRY_RATE_RULE`の形、停止中の利用者は未ログインと同じ扱い(Q1)、`security/008`(未ログインの投稿の保護)。
  - engagement: `COMMENT_ACTIONS`(`{ id, order, Item, Dialog }`、`CommentActionContext`の`comment.id`・`authorNickname`・`product`・`launch`)は他者の表示中のコメントのメニューにだけ描かれる。`CommentStore.findByIds`の`CommentRecord`(`authorUserId`・`deletedAt`・`hiddenAt`・`anonymizedAt`)。
  - directory-discovery: `PRODUCT_PAGE_SECTIONS`の`bottom` 10は通報の予約。`ProductPageContext`の`product.id`・`viewer.isOwner`。sponsorshipの広告は`bottom` 20で通報の後に並ぶ。
  - user-profile-social: `PUBLIC_PROFILE_MENU_ITEMS`(`{ id, order, Item, Dialog }`、`PublicProfileSectionContext`の`handle`・`isOwner`)、`ProfileActionsMenu`は本人以外に描かれる。`UserProfileDirectory.findSummaries(ids, 'visible' | 'not-withdrawn')`・`resolveHandle`。
  - product-launch: `ProductDirectory.findSummaries(ids, 'visible' | 'not-deleted')`の`ProductSummaryRecord`(`ownerUserId`・`hidden`・`visible`・`listed`)。他者に詳細が表示されるのは掲載中(`listed`)だけ(ページ配置のプロダクト詳細の公開範囲)。プロダクトライフサイクルの`purge_due`の非同期の登録口。
  - identity-auth: `AccountGuard.currentUser(session)`、停止中のセッションは有効なまま、`UserContactDirectory.findContact`(停止中は返し、退会済みは`undefined`)、ユーザーライフサイクルの同期(`statementsFor`は集合に対する更新を返す)と非同期(`purge_due`、`order`は帯)、`users`の最後の削除は全処理の後(10000)。`ClientViewer.status`(`ACTIVE`・`SUSPENDED`)。
  - backend-platform・api-gateway・frontend-platform: `CounterRule`・`RateLimitCounterClient.hit`・`assertWithinLimit`・`hashRateLimitKey`(`HashedRateLimitKey`だけを受け取る)、`assertHuman(expectedAction)`、`CallerKind`(`client`・`admin`)、`clientIp`、`useTurnstileToken`(`consume`)・`TurnstileWidget`(`action`)、`executeGraphQL`の`turnstileToken`。
  - email-delivery: `defineEmailKind`(`transactional`)・`EmailSender.send`・`toMatchingKey`・`formatUtcDateTime`。文言規則の件名「投稿内容の権利侵害についてご確認をお願いします」「通報の対応結果についてのお知らせ」と、未ログインの申出者は宛名を省く本文の構成。
  - data-export(後続)のbrief: content-reportingは出力用の部品を持つ前提。データエクスポートの文書の`reports.json`(ID・対象の種類・対象の参照・通報時点のカテゴリ名・理由・送信日時、対応ステータスと管理者の判断は含めない)。
  - sponsorship: 通報の操作の言及は`PRODUCT_PAGE_SECTIONS`の並びだけで、広告の通報は無い。
- **Implications**: 措置・認可・監査ログ・カード・区画・カテゴリの画面部品・回数制限・bot判定・メールは上流の部品を使う。上流の形は変えない(`latestForMany`はadmin-foundationの仮7が加え、措置と案件の結び付きは上流の`actionId`を本specの列に残す)。

### 措置と案件の完了の一体の確定

- **Context**: FR-ADMUG-025・FR-ADMAG-001、admin-foundationの`backend/008`(管理操作の文と`buildAuditLogStatements`を同じ一括の書き込みにする)、ugc-moderationの`backend/021`(他の集約の状態遷移と一体で管理操作を記録する方式)。
- **Findings**: ugc-moderationの3つのユースケースは呼び出し側の文を上流の確定に入れ、確定はNOT NULL制約の違反で全体を取り消す。案件の同時の完了は、案件の`status`を「未完了なら新しい値、そうでなければNULL」とする`CASE`式で検出でき、違反は上流の確定ごと取り消される。上流が`changed: false`のときは上流が書き込まないため、本specの文も書かれない。
- **Implications**: `ReportCaseStatements.forClosing`を措置の`statements`に渡し、措置なしの対応済と却下では同じ文を単独の一括の書き込みで確定する。結果の振り分け(措置済み・対象なし・競合)は案件を読み直して決める。

### 対応期間と監査ログ

- **Context**: FR-ADMUG-040(対応完了日時は監査ログに記録)、briefのConstraints(`AuditLogReader.latestFor`で引き、監査ログのテーブルを直接読まない)、NFR-PERF-008、DR-022(完了から14日の削除に完了の日時が要る)。
- **Findings**: 一覧の1ページの完了した権利侵害の案件は最大50件で、`latestFor`だけでは項目の数だけ問い合わせる。監査ログの保持期間は3年で、案件はログイン中の通報が残る限り残るため、古い案件の完了の日時は監査ログから得られなくなる。
- **Implications**: 対応期間の終点は監査ログ(`report.resolve`・`report.reject`の最新)から`latestForMany`でまとめて引き、得られなければ「不明」と表示する(13.6)。保持期間の削除の判定には本specの`closed_at`(完了と同じ一括の書き込みで入る)を使う。表示と削除で同じ時刻を別の場所から読むが、同じ一括の書き込みで書かれるため食い違わない。

### 通報の受け付けと回数制限

- **Context**: FR-REPOT-001〜006・FR-RLMIT-004・016・020、inquiry-chatの`security/008`。
- **Findings**: 未ログインの送信の規約(検証とbot判定の後に数える、キーのハッシュ化、不明なIPの警告)が決まっている。ログイン中の利用者ごとの制限は同じ`RateLimitCounter`の別の規則名で数えられる。2つの規則を同時に数える原子的な操作は無い。
- **Implications**: 利用者の規則を先に、IPアドレスの規則を後に数え、後者で拒否されたら前者を戻さない(1回分を余分に数える)。どちらの規則名も帯の外の資源を要らない。

### 通知の宛先と送り直し

- **Context**: FR-ADMUG-030・039、ugc-moderationの依頼待ちの記録と日次の送り直し、`UserContactDirectory`。
- **Findings**: 1つの案件に同じ申出者の通報が複数あり得る(回数制限の範囲で)。未ログインの通報は連絡先が無いこともある。
- **Implications**: 通報ごとの`outcome_notice_status`と案件の`poster_notice_status`を`pending`→`requested`・`skipped`で進め、送るときに宛先(利用者のID・連絡先の照合キー)でまとめる。

## Architecture Pattern Evaluation

| Option                                       | Description                                            | Strengths                                         | Risks / Limitations                                                              | Notes                    |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------ |
| 措置の`statements`に案件の完了を載せる(採用) | ugc-moderationのユースケースに完了と監査ログの文を渡す | 措置と完了が1回で確定。上流の想定どおり(申し送り) | 上流の確定がNOT NULL制約の違反で全体を取り消す規則に依存する                     | Workers統合テストで確認  |
| 措置の後に別の書き込みで案件を閉じる         | 措置の成功の後に案件を更新する                         | 単純                                              | 措置だけが残り案件が未完了のまま(通知の漏れ)になり得る                           | 不採用                   |
| 本specが上流の操作口を直接呼ぶ               | `ProductVisibilityControl`などを本specから呼ぶ         | ugc-moderationの変更が要らない                    | 措置の記録・投稿者への通知を重複して実装する(brief・申し送りに反する)            | 不採用                   |
| 対応期間の終点を本specの列だけから求める     | `closed_at`で表示する                                  | 照会が1回                                         | briefのConstraints(監査ログから引く)とFR-ADMUG-040の「監査ログに記録」に沿わない | 保持期間の削除だけに使う |

## Design Decisions

### Decision: 措置による対応済はugc-moderationの確定に案件の完了を載せる

- **Context**: FR-ADMUG-025・FR-ADMAG-001・FR-ADMUG-030、ugc-moderationの申し送り。
- **Alternatives Considered**:
  1. `statements`に完了と監査ログの文を渡す
  2. 措置の後に案件を閉じる
  3. 上流の操作口を本specが直接呼ぶ
- **Selected Approach**: 1。`ReportCaseStatements.forClosing`の文を渡し、上流の結果の`actionId`を確定の後に`linkResolutionAction`で案件の`resolution_action_id`に残す(cross-spec reviewの修正1)。
- **Rationale**: 措置・措置の記録・投稿者への通知の仕組みを重複させず、記録の一体の確定を上流と同じ規約で守れる。ugc-moderationの入力・記録・テーブルを変えずに、案件から措置の記録をたどれる。
- **Trade-offs**: `actionId`は上流の確定の中で採番されるため、連結は確定の後の単独の書き込みになり、失敗すると案件に措置の記録のIDが残らない。その場合も措置と完了は確定済みで、`captureEvent`(`resolution-action-link-failed`)で知らせ、案件の`resolution`と監査ログ(`report.resolve`の詳細`resolution`)で通報由来を追える。
- **Follow-up**: 本物の3つのユースケースを通したWorkers統合テストで、競合・措置済みで何も残らないことを確かめる。

### Decision: 1つの対象に未完了の案件は1つで、新しい通報は完了した案件へ集約しない(仮1・仮3)

- **Selected Approach**: `report_cases`の`(target_kind, target_id) WHERE closed_at IS NULL`の部分一意索引と、`INSERT ... ON CONFLICT ... DO NOTHING`と副問い合わせで通報を未完了の案件へ結ぶ。完了した案件は管理者が手で戻せるが(仮3の案B)、同じ対象に未完了の案件があれば同じ索引の違反で戻さない。
- **Rationale**: 同時の通報でも案件が1つに定まる。手での再開も同じ索引で守るため、未完了の案件の一意を1か所の制約で保てる。

### Decision: 一覧の対応期間は`latestForMany`でまとめて引く

- **Selected Approach**: admin-foundationが仮7で加える`AuditLogReader`の複数の対象版を使い、一覧では`report.resolve`・`report.reject`の2回だけ問い合わせる。詳細は`latestFor`を使う。本specの単体テストはadmin-foundationのテストの共有の偽物を使う(cross-spec reviewの修正2)。
- **Rationale**: briefのConstraintsとNFR-PERF-008を両立する。照会と保存の実装とテストを所有するspecに置き、本specは他specの実装やテストの偽物を編集しない。
- **Trade-offs**: 本specのタスクはadmin-foundationの仮7の実装の完了を前提にする。

### Decision: 照会は送信の依頼の後に記録する(仮4)

- **Selected Approach**: `EmailSender.send`の成功の後に、照会の日時・内容と監査ログを1つの一括の書き込みで確定する。
- **Rationale**: 回答の期限の起算点(監査ログの日時)が、実際に依頼した時刻より前にならない。記録の失敗は`captureEvent`で検知し、管理者が再送する。

### Decision: 採らなかった案

- 案件から画像の隔離を直接行う: ugc-moderationの画像の操作は媒体の移動の後に記録する形で、案件の完了と一体にできない(仮2)。
- 手での「対応済」「却下」で通知を送る: 開発者の確定(仮3の案B)により、通知は措置・措置なしの対応済・却下の操作だけが送る。手での完了は記録の訂正に使う。
- 申出者の理由を照会に転記する: 申出者を特定できる情報が投稿者に渡り得る(仮4)。
- 停止中の利用者の通報の拒否: ログアウトで回避でき、inquiry-chatのQ1とそろわない(仮6)。

## Synthesis

- **Generalization**: 状態の変更・措置・措置なしの対応済・却下・照会は「検証→案件の確認→監査ログの準備→案件の条件付きの更新と監査ログの文→確定(単独、または上流の確定に載せる)→通知」の同じ形で、違いは確定の載せ方と通知の有無だけである。`ReportCaseStatements`の3種の文と`commit`、上流の`statements`で表す。一般の問題として「申告の未完了の案件への集約と、他の集約の操作と同じ一括の書き込みでの完了」を`backend/022`、「ログイン状態を問わない投稿の送信元と利用者の二重の回数制限」を`security/011`、「他の機能の画面へ登録するダイアログの操作」を`frontend/021`に記す。
- **Build vs. Adopt**: 措置・措置の記録・投稿者への措置の通知(ugc-moderation)、認可・監査ログ・カード・確認のダイアログ・カテゴリのマスタの画面部品(admin-foundation)、カテゴリのページ(inquiry-chat)、厳密カウンタ・bot判定(backend-platform)、メール(email-delivery)は上流の部品を使う。新しいパッケージは要らない(フォーム・ダイアログ・ラジオグループは上流の`useAppForm`とshadcn/uiの部品で足りる)。
- **Simplification**: 通報ごとの状態を持たず、状態は案件だけに置く。通知の記録用のテーブルを作らず、通報と案件の列で通知の状態を持つ。照会の履歴のテーブルを作らず、最後の照会を案件に、全ての照会の日時を監査ログに残す。完了した案件の再開は手での状態の変更の一種として扱い、専用の操作を作らない(仮3)。営業日の暦を作らない(仮5)。

## Risks & Mitigations

- 措置の記録のIDの連結(確定の後の単独の書き込み)が失敗する — 措置と完了は確定済みのまま、`captureEvent`(`resolution-action-link-failed`)で知らせる。案件の`resolution`と本specの監査ログ(`report.resolve`の詳細`resolution`)で通報由来を追える。
- 上流の確定が呼び出し側の文の違反で全体を取り消さない(上流の実装の差) — Workers統合テストで本物の確定を通して確かめ、外れた場合は作業を止めて上流specへ報告する。
- 回数制限の2つの規則の数え方で1回分を余分に数える — 上限に近い利用者だけに影響し、制限の目的(連投の抑止)に反しない。`security/011`に記す。
- 未ログインの送信のE2EでIPアドレスの回数が衝突する — 実行ごとに文書用の範囲の`CF-Connecting-IP`を付ける(inquiry-chatと同じ)。上書きできない場合はWorkers統合テストで回数制限を確かめ、E2Eのタスクで報告する。
- 案件の一覧の`EXISTS`の絞り込みが件数の増加で遅くなる — 1ページ50件とカーソル、`(case_id, reported_at)`の索引で抑え、launch-readinessの性能の検証で判断する。

## References

- `docs/requirements/README.md` — 4.12(FR-REPOT-001〜006)、4.21(FR-ADMUG-008・019・020・025・027・030・035・039・040)、4.22(FR-ADMAG-001〜003)、4.23(FR-ADMCF-019〜021)、4.29(FR-RLMIT-004・016・020)、FR-USER-019・022・026、SW-018、NFR-PERF-008、DR-002・DR-017・DR-022、LR-004
- `docs/GUIDES/service/legal/005-rights-infringement-takedown-flow.md` — 受付・判断・照会・目標期間・記録
- `docs/GUIDES/service/legal/001-compliance-policy.md` — データ保持期間(未ログインの通報、注4)、モデレーションと透明性
- `docs/GUIDES/service/legal/003-privacy-policy-outline.md` — 未ログインの通報の連絡先
- `docs/GUIDES/service/design/002-page-layouts.md` — 通報の置き場所、管理者側ページ一覧
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — 通報理由の上限、メールの件名と本文の構成
- `docs/GUIDES/service/features/001-user-data-export.md` — `reports.json`
- `mockups/src/components/client/report-dialog.tsx` — 通報ダイアログの構成と文言
- 上流specの`design.md`・`research.md`(Research Logの一覧)

## 仮決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。**すべて2026-10-24に開発者が確定した。** 仮3・仮5・仮7は推奨と異なる案である。`requirements.md`の「要件フェーズでの決定事項」にも同じ行がある。

| #   | 論点                       | 採用した案                                                                                                                                                                                                           | 他の選択肢                                       | 影響する箇所                                                                                                                                       |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | 集約の単位と案件           | 対象ごとに未完了の案件は1つ、完了後は新しい案件、権利侵害を含めば権利侵害の案件                                                                                                                                      | 対象とカテゴリの組 / 完了した案件の再開          | 要件3.8・5.1〜5.5、部分一意索引、`D1ReportSubmissionStore`                                                                                         |
| 仮2 | 通報からの措置の範囲       | 非公開化・停止だけを案件から行い、画像・評価は各管理画面で行って措置なしの対応済                                                                                                                                     | 画像の隔離も案件から                             | 要件7.4・9.1・9.6、`measureFor`・`ReportCaseWorkflow`・`ReportCaseActions`                                                                         |
| 仮3 | 遷移と理由                 | (確定、推奨と異なる)4状態の間を手で自由に変えられ、手での変更は通知しない。理由は未対応⇄対応中で任意、手での完了と再開で必須。再開は完了の記録を消し依頼待ちの通知を取りやめ、同じ対象に未完了の案件があれば戻さない | 手では未対応⇄対応中だけ(推奨) / 却下の理由は任意 | 要件8.2〜8.8・10.4・11.9・13.2・13.3・17.1・17.2、`canChangeStatusManually`・`manualStatusChangeKind`・`checkReportAdminReason`・`forStatusChange` |
| 仮4 | 照会の内容と回数           | 管理者が要旨を書き申出者の情報は載せない、再送でき期限は最後の照会から                                                                                                                                               | 理由の転記 / 1回だけ                             | 要件12.2・12.4・12.5、`InfringementInquiryService`・`content-reporting.infringement-inquiry`                                                       |
| 仮5 | 対応期間と目標の超過       | (確定、推奨と異なる)起点は最初の権利侵害の通報、未対応で起点から24時間(土日を含む)と起点から9日を超過、祝日は考慮しない                                                                                              | 土日を除く24時間(推奨) / 祝日の暦                | 要件5.5・13.1〜13.4、`ResponseTime`                                                                                                                |
| 仮6 | 停止中の利用者の通報       | 未ログインの通報として受け付ける(inquiry-chatのQ1とそろえる)                                                                                                                                                         | 拒否する                                         | 要件2.3・2.4・3.6・3.7・4.2、`ReportSubmissionService`・`ReportForm`、準拠方針                                                                     |
| 仮7 | 対象の物理削除に伴う案件   | (確定、推奨と異なる)案件と通報を残し、対象への参照だけを消す。参照の消去から3年で通報ごと削除し、申出者の理由は書き換えない                                                                                          | 案件を通報ごと削除(推奨)                         | 要件17.5・17.8・17.10、`ReportErasureStore`・`ReportErasureHandlers`・`ReportRetentionJob`・`ReportExport`、準拠方針・プライバシーポリシーの骨子   |
| 仮8 | 標準カテゴリの扱いと並び順 | 両方とも名前の変更も拒否、追加の順で権利侵害・その他の順に末尾                                                                                                                                                       | 名前の変更を許す / 権利侵害を先頭                | 要件2.1・14.4・14.8、`sortReportCategories`・`ReportCategoryService`                                                                               |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID                                    | 内容                                                                                                                                                                                                                                                                                                                                                    | 根拠 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| FR-ADMUG-027                              | 集約の単位を「対象ごとの未完了の案件」とし、完了後の通報は新しい案件にする旨を加える                                                                                                                                                                                                                                                                    | 仮1  |
| FR-ADMUG-025                              | 通報からの措置にユーザーの停止(FR-ADMUG-006)と「措置なしでの対応済」を加え、画像の隔離・評価の無効化は各管理画面で行う旨を加える                                                                                                                                                                                                                        | 仮2  |
| FR-ADMUG-020                              | 「管理者は4つの状態の間を手で変更できる。手での変更では当事者へ通知しない。対応済・却下への変更と、対応済・却下からの変更には理由を必須とする。対応済・却下から戻すと完了の日時・措置の種類・完了の理由を消し、未送信の通知を取りやめる。同じ対象に未完了の案件がある場合は戻せない。当事者への通知はFR-ADMUG-025の措置・却下の操作でだけ行う」を加える | 仮3  |
| FR-ADMUG-030・039                         | 通知の契機を「措置(措置なしの対応済を含む)・却下の操作」に限り、手での対応ステータスの変更では通知しない旨を加える                                                                                                                                                                                                                                      | 仮3  |
| DR-022                                    | 未ログインの通報の保持期間の起点を「最後に対応済・却下になった日時」とし、対応済・却下から戻した案件は再び完了するまで数えない旨を加える                                                                                                                                                                                                                | 仮3  |
| FR-ADMUG-035                              | 照会の内容(侵害されたとする権利と理由の要旨、申出者の情報を含めない)・回答の方法・期限(送信から7日)と、再送の可否を加える                                                                                                                                                                                                                               | 仮4  |
| FR-ADMUG-040                              | 対応期間の起点(最初の権利侵害の通報)と終点(監査ログに記録した最後の完了)、目標の超過の判定「1営業日は土日を含む単純な24時間とし、祝日を考慮しない。9日は起点からの暦の9日」を加える。削除請求フロー(`legal/005`)の「1営業日」も同じ定義に改める(タスク1.6)                                                                                              | 仮5  |
| FR-REPOT-001・FR-USER-026                 | 停止中の利用者の通報を未ログインの通報として受け付ける旨を加える(FR-INQRY-001と同じ扱い)                                                                                                                                                                                                                                                                | 仮6  |
| FR-USER-022・DR-002(またはDRの新しい項目) | 「投稿者・プロダクトの物理削除の時期に、それを対象とする通報の案件と通報は削除せず、対象への参照(対象・投稿者・対象のプロダクトの識別子)だけを消す。参照を消した案件と通報は参照の消去から3年で物理削除する。申出者の理由は書き換えない」を加える                                                                                                       | 仮7  |
| FR-ADMCF-020                              | 標準カテゴリの名前の変更も拒否する旨を加える                                                                                                                                                                                                                                                                                                            | 仮8  |

## 上流・後続specへの影響

- admin-foundation(上流): apiの`AuditLogReader.latestForMany(input: { readonly action: string; readonly targetKind: AuditTargetKind; readonly targetIds: readonly string[] }): Promise<ReadonlyMap<string, Date>>`と監査ログの保存の照会(90件ずつ)と、テストの共有の偽物`createFakeAuditLogReader`は、admin-foundationが仮7で所有・実装する。本specは使うだけで、admin-foundationの実装とテストを編集しない。登録: `audit-actions/content-reporting.ts`と連結、`ADMIN_NAV_ITEMS`に`/reports`(70)、`DASHBOARD_CARDS`に`content-reporting.unhandled-reports`(30)。`requireAdmin`・`AuditLogRecorder`・`buildAuditLogStatements`・`CategoryMasterEditor`・`ConfirmActionDialog`・E2Eの補助を使う。
- ugc-moderation(上流): 形を変えない。措置のユースケースの結果の`ModerationOutcome.actionId`を本specの`report_cases.resolution_action_id`に残す(ugc-moderationのData Contractsの「結果の`actionId`で自分の記録と結べる」のとおり)。登録: adminの`ADMIN_PRODUCT_DETAIL_SECTIONS`に`content-reporting.product-reports`(10)。`ProductModerationService.hide`・`CommentModerationService.hide`・`UserModerationService.suspend`を`statements`付きで呼ぶ。
- inquiry-chat(上流): adminの`CATEGORY_SECTIONS`に`content-reporting.report-categories`(40)(契約どおり)。
- directory-discovery(上流): clientの`PRODUCT_PAGE_SECTIONS`に`content-reporting.product-report`(`bottom` 10)(予約どおり)。
- user-profile-social(上流): clientの`PUBLIC_PROFILE_MENU_ITEMS`に`content-reporting.user-report`(10)(契約どおり)。`UserProfileDirectory`を使う。
- engagement(上流): clientの`COMMENT_ACTIONS`に`content-reporting.comment-report`(10)(契約どおり)。`CommentStore.findByIds`を使う。
- identity-auth(上流): apiの`USER_LIFECYCLE_SYNC_HANDLERS`に`content-reporting.reporter-withdrawal`(`withdrawn`)、eventの`USER_LIFECYCLE_ASYNC_HANDLERS`に`content-reporting.user-report-erasure`(`purge_due`、2000)。`AccountGuard`・`UserContactDirectory`を使う。
- product-launch(上流): eventの`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`に`content-reporting.product-report-erasure`(`purge_due`、2000)。`ProductDirectory`を使う。
- backend-platform・api-gateway・email-delivery・frontend-platform(上流): 登録箇所への追記だけ。
- data-export(後続): `REPORTING_PLATFORM_TYPES.ReportExport`の`listPage({ userId, after, limit })`(1回20件まで、IDの昇順)で`reports.json`の各項目を得る。`targetRef`は解決できない対象と、対象の物理削除で対象への参照を消した通報(コメントのIDも返さない)でnull(データエクスポートの文書を本specが改める)。仮7の案Bにより、対象が物理削除された通報もエクスポートに残る(以前の推奨案では通報ごと削除されて出なかった)。`listPage`の形は変わらない。eventで束縛済み。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は2000・2010、波及処理は2000」。Requirement Ambiguitiesの表に本specが担当に含まれる行は無い。本specはroadmapを編集しないため、コントローラーへ報告する。

## 設計のレビュー(2026-10-24)

- `/kiro-spec-design content-reporting -y`の手順で、要件を承認し(`-y`による自動の承認)、設計の下書きを作った。参照したスキルはcc-sddの`kiro-spec-design`の規則(design-principles・design-discovery-full・design-synthesis・design-review-gate)とテンプレート。新しいパッケージ・外部APIが無いため、外部の調査は行わず、上流specの契約の確認に絞った。
- 機械的な確認: 要件の147件の受け入れ基準の番号がすべて追跡表にあることを、スクリプトで確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある(上流への追加と登録は「Modified Files」)。
- 1回目の判断のレビューで、(1)未対応の件数とプロダクトの件数が論理削除だけの案件を数えないことが曖昧だったため`countUnhandled`・`productSummary`の条件を明記した、(2)使っていない`opened_at`の列を物理モデルから除いた、(3)Allowed Dependenciesの不要な記述と文書の半角スペースの規則の違反を直した。2回目で問題は無かった。
- 境界の確認: 上流のテーブルへ書き込まず、上流のユースケースと登録口と照会を使う。上流の契約の変更は、`latestForMany`(admin-foundation)の追加だけである。ugc-moderationの契約は変えず、既存の`ModerationOutcome.actionId`をそのまま使う。
- 技術ドキュメントの番号: 完了済みspecのdesign.mdの計画は`backend`001〜021、`frontend`001〜020、`db`001〜008、`security`001〜010、`infra`001〜008、`external`001〜008、`operations`001〜004、`coding`001〜004、`testing`001〜002である。本specは`backend/022`・`frontend/021`・`security/011`を取る。サービス仕様の`features`は`007`を取る。

## タスクの計画の検証(2026-10-24)

- `/kiro-spec-tasks content-reporting -y`の手順で、要件と設計を承認し(`-y`による自動の承認)、タスクの計画の下書きを作った。要件の147件の受け入れ基準の番号がすべてタスクにあること、タスクが要件に無い番号を参照しないことを、スクリプトで確かめた。設計の全コンポーネント(共有定義・監査ログの操作種別・テーブルと初期データ・対応期間の規則・メール・上流への2つの追加・削除のストアとエクスポート・識別子とポート・5つのストア・退会の同期の処理・7つのユースケース・2つのジョブ・束縛・GraphQL・eventの処理・利用者側の3つの登録とダイアログ・管理画面の2ページとカードと2区画・文書・E2E)がタスクにある。
- タスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で行った。
- 1回目の判定はNEEDS_FIXES(必須1件・軽微7件)だった。必須の指摘は、案件の詳細のページから措置・措置なしの対応済・却下を開けることがタスクに無く(要件9.1・10.1)、その部品を一覧のページのタスクが事実上作るため並行のタスクの間に隠れた依存がある、であった。措置の操作・対象の表示・カテゴリごとの件数を管理画面の共通部品のタスク(8.2)へ移し、詳細のページのタスク(8.4)に詳細からの操作の確認と要件の番号を加えた。軽微の指摘(各ページのアクセシビリティの検査と18.8の写像、1.4・4.7・8.5の`_Depends:`、3.6で同期の処理を作ることの明記、2.1・2.2の全アプリの型検査と他の操作がnullを渡すこと、9.4の案件の作り方と単独の実行)にも従って直した。
- 2回目の判定(新しいサブエージェントによる独立した確認)はPASSだった。軽微の指摘5件(一覧と詳細のルートの最小の枠を8.2で先に作る、9.5に7.3への依存を加える、8.2の検索パラメータの記述を直す、2.1と2.2が同じテストのファイルを触り得るため2.2の`(P)`を外す、3.1の不要な例外の記述を消す)に従って直した。8.2の分割は、部品がいずれも小さく1つのブラウザテストのタスクにまとまるため行わない。タスクを承認した(9つの大タスク・45のサブタスク、タスク6は子を持たない)。

## cross-spec reviewの指摘による承認後の修正(2026-10-24)

- **状態**: 要件・設計・タスクの承認の後の修正で、cross-spec reviewの指摘による。admin-foundationの仮7(推奨どおり)とともに2026-10-24に開発者が確定した。利用者・運営者に見える振る舞いは変わらないため、`requirements.md`の仮の表には行を加えない(要件9.3は案件の側に結び付きを残す表現へ改めた)。
- **修正1(分担の整理)**: 本specがugc-moderationのスキーマと措置の入力の契約を編集していた(`moderation_actions.report_case_id`・`ModerationCommand.reportCaseId`・`NewModerationRecord.reportCaseId`の追加と3つのユースケースの変更)のをやめ、ugc-moderationが既に返す`ModerationOutcome.actionId`を本specの`report_cases.resolution_action_id`に残す。
  - **Decision**: `changed: true`の措置の後に、`ReportCaseStatements.linkResolutionAction(caseId, actionId)`(措置による対応済で未設定の案件だけの条件付きの更新)を単独で実行する。失敗は措置と完了を取り消さず、`captureEvent`(`resolution-action-link-failed`)で知らせ、結果は成功とする。列は外部キーを持たず、措置による対応済の案件だけが値を持てるCHECKを置く。
  - **Reason**: 各specのスキーマと契約はそのspecが所有する。ugc-moderationのData Contractsは「結果の`actionId`で自分の記録と結べる」と定めており、Risksに記していた代替の形でも要件9.3の目的(案件と措置の記録の結び付き)を満たせる。`actionId`は上流の確定の中で採番されるため、確定と同じ一括の書き込みには入れられない。
  - **変えた箇所**: 要件9.3とAdjacent expectations、設計のImpact・境界の4節・上流への影響の表・措置による対応済の流れ・追跡表・コンポーネントの表・`ReportCaseWorkflow`・`ReportCaseStatements`・物理モデル・Testing Strategy・Monitoring・Migration Strategy・ファイル構成のModified Files、本書のKey Findings・Implications・Design Decisions・Risks・上流への影響、タスク1.1・1.2・3.5・4.6・9.6。ugc-moderationを編集するタスク(旧2.2)を削除した。
- **修正2(admin-foundationの仮7の利用)**: `AuditLogReader.latestForMany`とその保存の照会(90件ずつ)とテストの共有の偽物`createFakeAuditLogReader`は、admin-foundationが仮7で所有・実装する。本specは使うだけで、admin-foundationの実装や他specのテストの偽物を編集しない。
  - **Decision**: `latestForMany`を実装するタスク(旧2.1)を削除し、タスク1.1の前提にadmin-foundationの仮7を加え、タスク4.8は共有の偽物を使う。
  - **Reason**: 照会と保存の実装とテストを所有するspecに置くと、メソッドが増えても利用するspecの偽物が壊れない。
  - **変えた箇所**: 設計のImpact・境界の4節・上流への影響の表・上流の契約の利用の節・ファイル構成の説明・Testing Strategy、本書のKey Findings・Design Decisions・Risks・上流への影響、タスク1.1・4.8・9.6。旧2.1・旧2.2を削除し、旧2.3・旧2.4を2.1・2.2へ繰り上げた(3.6・5.1・6の`_Depends:`を直した)。
- **修正3(文言の訂正、振る舞いの変更なし)**: 設計の技術ドキュメントの番号の理由を、「完了済みspecが`security`001〜010を使う」から「上流のspecが`security`001〜008を使い、launch-readinessが`security/009`、notificationsが`security/010`を取った」へ訂正した。番号`security/011`は変えない。
- **変更部分のタスクの検証**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定はPASSだった(147件の受け入れ基準の番号がすべてタスクにあり、`_Depends:`に削除した番号や旧番号が残っていないことをスクリプトで確かめた)。軽微の指摘のうち、`resolution_action_id`のCHECKに`status = 'resolved'`を加え、連結の例外と`false`(更新なし)をともにエラートラッキングへ知らせることを設計とタスク4.6に明記した。`spec.json`の`updated_at`を更新し、タスクの承認を保った。

## 開発者の確定による改訂(2026-10-24)

仮1〜仮8はすべて2026-10-24に開発者が確定した。仮1・仮2・仮4・仮6・仮8は推奨どおりで、要件・設計・タスクの振る舞いは変わらない(確認待ちの記述だけを除いた)。仮3・仮5・仮7は推奨と異なる案(B)で、次のとおり振る舞いを改めた。

### Decision: 手での対応ステータスの変更は4状態の間で自由にし、通知は操作だけが送る(仮3の案B)

- **開発者の回答**: 問い合わせと同じく4状態の間を手で自由に変えられる。当事者への通知は措置・却下の操作のときだけで、手での状態の変更では通知しない。
- **解釈**: 「措置の操作」には、推奨どおりに確定した仮2の「措置なしで対応済」の操作(理由必須、申出者へ通知)を含める。手での「対応済」は通知を伴わない記録の訂正で、仮2の操作とは別の手段として残す。手での完了(完了どうしの変更を含む)と再開は、前の操作による完了の通知が依頼待ちのまま残っていれば`none`へ戻して取りやめ、手での変更の後に通知が送られないようにする。対象への参照を消した案件の却下は、投稿者への通知を`skipped`(送らなかった記録)にする(要件11.5)。
- **理由の要否**: 未対応⇄対応中は任意(問い合わせと同じ)。対応済・却下への変更(完了どうしを含む)と、対応済・却下からの変更(再開)は必須(500書記素)。完了と再開は保持期間の起点・対応期間の終点・措置の記録との結び付きを動かし、ugc-moderationの仮9(措置の取り消しは理由必須)とも説明の記録の扱いをそろえるためである。
- **監査ログ**: 未対応⇄対応中と再開は`report.status-change`(詳細`fromStatus`・`toStatus`)。手での完了は`report.resolve`(`resolution`は`none`)・`report.reject`に詳細`mode: manual`と`fromStatus`を付けて記録し、操作による完了(`mode: operation`)と区別する。操作種別は7種のまま。
- **完了から戻したときの保持期間と対応期間**: 再開で`closed_at`・`resolution`・`resolution_action_id`・`closing_reason`を消す。未ログインの通報の14日の保持期間(DR-022)は再び完了するまで止まり、最後に完了した日時から数え直す(既に削除した通報は戻らない)。対応期間は起点(最初の権利侵害の通報)を変えずに現在までの対応中として示し、再び完了すれば監査ログの最後の完了(`report.resolve`・`report.reject`の新しい方)までを示す。依頼待ち(`pending`)の申出者・投稿者への通知は`none`へ戻して取りやめ、依頼済みの通知と行った措置は取り消さない。
- **未完了の案件の一意(仮1)との整合**: 再開は`closed_at`をNULLにするため、同じ対象に未完了の案件(再開までの間の通報でできた案件)があれば`(target_kind, target_id) WHERE closed_at IS NULL`の部分一意索引の違反で一括の書き込みごと取り消し、`report_case_open_exists`を返して未完了の案件で対応するよう示す(要件8.8)。2つの案件を自動で統合しない(通報の付け替えは監査と通知の記録を複雑にするため)。対象への参照を消した案件(仮7)は対象のIDを持たないため、この違反にならない。
- **措置と却下の操作**: 未対応・対応中の案件でだけ行え、通知を伴う(要件9・10・11は変わらない)。完了した案件に通知を伴う判断をするときは、先に手で戻してから操作する(`report_case_closed`の文言で案内する)。再開の後に操作で再び完了すると、各申出者(と却下の投稿者)への通知を改めて依頼する(1回の完了につき1回)。措置で対応済にした案件を手で却下・再開しても措置は残り、取り消しはugc-moderationの各管理画面で行う。
- **変えた箇所**: 要件8.2〜8.8(8.8を追加)・10.4・11.9・13.2・13.3・17.1・17.2・20.2・20.3、設計の対応ステータスの流れ・`ReportCaseRules`・`ReportingAuditActions`・`ReportCaseWorkflow`・`ReportCaseStatements`・Domain Model・Error Handling・Testing Strategy・admin画面の部品・文言、タスク1.1・1.3・1.6・3.5・4.5・4.8・5.1・5.4・8.2・8.4・9.5。

### Decision: 1営業日は土日を含む単純な24時間とする(仮5の案B)

- `ResponseTime`は日時の差だけで判定し、`BusinessTime`への依存と土日の除外を外した(`START_TARGET_MS`は24時間)。祝日は考慮しない。
- **変えた箇所**: 要件13.4・20.2、設計の`ResponseTime`・依存の方向・Allowed Dependencies・文言、タスク1.4・1.6。

### Decision: 対象の物理削除では案件と通報を残し、対象への参照だけを消す(仮7の案B)

- **参照の消去**: ユーザーの`purge_due`ではその利用者が投稿者である案件(プロフィール・プロダクト・コメント)、プロダクトの`purge_due`ではそのプロダクトとコメントの案件の`target_id`・`target_owner_user_id`・`product_id`をnullにし、`target_detached_at`を記録する。案件・通報・状態・完了の記録・申出者の理由は変えない。処理の名前と`order`(2000)は変えない。
- **保持期間と起点**: 通常の規則(未ログインの通報は最後の完了から14日、ログイン中の通報は申出者の退会と物理削除まで、通報が無くなった案件の削除)に加え、参照の消去(`target_detached_at`)から3年で案件を通報ごと削除する(日次の`content-reporting.report-retention`、旧名`guest-report-retention`から保持期間の削除全体を表す名前に改めた)。3年は監査ログの保持期間(DR-017)と同じで、参照を消した案件に対応した操作の記録と案件・通報を突き合わせられる期間に合わせた。起点は案件の状態によらない。
- **投稿者を指す理由の扱い**: 申出者の理由は書き換えない。理由は申出者自身の申告でデータエクスポートで本人へ返す記録でもあり、削除された投稿者を指す記述を機械的に判別して消せないためである。参照を消した案件は削除された利用者・プロダクト・コメントの識別子を持たないため、理由をその利用者の記録と結び付けられない。理由は管理画面と申出者本人のデータエクスポートにだけ示し、3年で削除する。この扱いを準拠方針とプライバシーポリシーの骨子に記す(タスク1.6)。
- **参照を消した案件の操作**: 管理画面は対象を「削除された対象」と示す。措置は上流を呼ばずに`report_target_unavailable`、照会は投稿者がいないため`report_inquiry_not_applicable`、措置なしの対応済・却下・手での状態の変更は行える(却下の投稿者への通知は送らない)。
- **data-exportへの影響**: `ReportExport.listPage`の形は変わらない。対象が物理削除された通報は削除されずにエクスポートに残り、`targetRef`は`null`(コメントのIDも返さない)になる。data-exportのコードの変更は不要で、`reports.json`の説明(データエクスポートの文書)の改訂は本specのタスク1.6が行う。
- **変えた箇所**: 要件17.5・17.8・17.10(17.10を追加)・20.3、設計の`ReportingSchema`・`ReportErasureStore`・`ReportExport`・`ReportTargetResolver`・`ReportCaseRecord`・`ReportCaseWorkflow`・GraphQLの`AdminReportTarget`(`id`をnull可、`detached`を追加)・`ReportErasureHandlers`・`ReportRetentionJob`・Physical Data Model・Security Considerations・Modified Files(プライバシーポリシーの骨子を追加)・文言、タスク1.2・1.6・2.1・2.2・3.4・4.1・4.6・5.1・5.4・6・8.2。

### 確定の反映のレビュー(2026-10-24)

- 設計のレビューの関門(kiro-spec-designのdesign-review-gate)を、変更部分に絞って新しいサブエージェントによる独立した確認(independent)で行った。1回目はNEEDS_FIXES(必須3件: 手での完了で依頼待ちの通知が残り手での変更の後に送られ得ること、エラーの分類の「手で対応済にする」、ファイル構成の状態の変更の部品の説明)で、手での完了でも依頼待ちの通知を`none`へ戻すこと(要件8.3)、参照を消した案件の却下で投稿者への通知を`skipped`にすること(要件11.5)、表の要件の番号と件数の上限と文言を直した。2回目はPASSで、軽微の指摘(Domain Modelと仮3の行の補足)に従って直した。
- タスクのグラフのサニティレビュー(kiro-spec-tasks)を、新しいサブエージェントによる独立した確認(independent)で行った。1回目はPASS(軽微3件を反映)。設計の修正の後の2回目はNEEDS_FIXES(必須1件: 投稿者への通知を`skipped`・`none`にする判断のテストがタスク4.5に無い)で、タスク4.5にそのテストと要件11.5を加えた。レビューは2回までのため、`spec.json`のタスクの承認を`false`にし、修正後のタスクの再レビューを開発者に求める。要件と設計の承認は保った。
- タスクの再レビュー: `/kiro-spec-tasks content-reporting -y`の手順で、現在のtasks.mdを下書きとして新しいサブエージェントによる独立した確認(independent)を行った。1回目の判定はPASSだった(タスク4.5の投稿者への通知の`pending`・`skipped`・`none`のテストと要件11.5を確認し、149件の受け入れ基準の番号がすべてタスクにある)。軽微の指摘のうち、3.5の手での完了の措置の値の書き方と、9.5のE2Eのファイルの置き場所を直した。タスクの承認を`true`に戻した。

## frontend-platformの実装で確定した契約の反映(2026-10-28、開発者の判断)

- frontend-platformが実装で確定した契約(同specのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に、開発者の判断(下流specの設計を今回改訂する)で本specの設計を合わせた。
- GraphQLの操作: 操作を各アプリの`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名を利用者側は`Client`、管理者側は`Admin`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む。`graphql()`を呼んで`.ts`のファイルに操作を書くと、操作の本文がブラウザのバンドルに残るため(frontend-platformの要件6.3)。tasks.mdの操作のタスクに、各アプリの`graphql:generate`とapiの`graphql:allowlist`の手順を書いた。
- フォーム: `useAppForm<TInput, TOutput>(schema, { defaultValues })`(`defaultValues`は全欄)と、必須の`onSubmitError`・任意の`serverFieldPrefix`(`input`を取るmutationは`"input"`)を受ける`AppForm`の形にした。画面側のスキーマの`zod`の値は`utilities/validation/zod.ts`から読む(CSPの下で`new Function`の試行を止める`jitless`の設定を済ませた`z`)。
- 失敗の文言: `GraphQLClientError`でない例外に代えて画面に出す文言を`errorMessageOf(error, <プロファイル>.contactAvailable)`で選ぶ。管理者側には問い合わせの画面が無いため、`ErrorState`・`UnexpectedErrorView`に`contactHref`を渡さず、問い合わせの導線と問い合わせを促す文を出さない(frontend-platformの要件8.6・8.13)。カテゴリの区画は、admin-foundationの`CategoryMasterEditor`の`failureMessageOf`(本改訂でadmin-foundationが加えた)に`errorMessageOf`を渡す。
- bot判定: `TurnstileWidget`は非表示のウィジェットで場所を取らないため、判定の枠の表示と場所の記述を除いた。
- 要件2.6を「bot判定のウィジェットを非表示で置き(判定の枠を画面に出さない)、判定の結果とともに送信する」に改めた(番号は変えていない)。
- 変えた箇所: design.mdのAllowed Dependencies、File Structure Planの両アプリの`graphql/operations/reporting/`、Modified Filesの生成物と許可リストの行、`ReportDialog`・`ReportForm`・`ReportFormSchema`・`UseSubmitReport`・`ReportSearch`・`ReportCaseActionDialog`(`ConfirmActionDialog`の`failureMessageOf`)・`UseReportCaseMutation`・`UnhandledReportsCard`・`ProductReportsSection`・`ReportCategorySection`(`CategoryMasterEditor`の`failureMessageOf`)、Error Strategy。requirements.mdの2.6。tasks.mdの7.1・7.2・8.1・8.2・8.5。

## フォームの描かない値と無効の欄の扱いの反映(2026-10-28、開発者の判断)

- **状態**: frontend-platformの最終検証の後の第2回の判断16・25〜28・30〜36(2026-10-28〜29)を、frontend-platformのタスク11.8として本specの設計とタスクへ反映した。受け入れ基準は変えていない。
- **Context**: frontend-platformの`SubmitButton`は、`root`以外の欄のエラー(サーバーの欄のエラーを含む)が1つでも残る間は無効になる。入力欄を描かない値をフォームのスキーマの入力に含めると、その値へのサーバーの詳細が利用者の直せない欄のエラーになり、送信ボタンが無効のまま残る。`applyServerFieldErrors`は、欄をまとめた値(配列でないオブジェクト)の経路と、`FormField`の`disabled`で無効にした欄の詳細を欄に付けず`onSubmitError`の`unmatched`へ渡し、`useAppForm`は検証の前に無効の欄の値を除く。無効の欄の値は`onSubmit`へ渡す値から外れ、無効になり得る欄はスキーマで任意(`.optional()`)にする。`FormField`は後から無効にした欄のエラーを消し、`useAppForm`は渡されたスキーマが変わると検証し直し、`applyServerFieldErrors`は描かれていない欄の詳細もフォーム全体の失敗にする。全欄が無効のフォームは`SubmitButton`の`disabled`で送信ボタンを無効にする。
- **決定**: 通報フォームの連絡先は、欄を描く間(未ログインか停止中で、権利侵害が選ばれた時)だけスキーマの入力に含める。連絡先を含まない`ReportFormSchema`と含む`ReportFormWithContactSchema`に分け、`ReportForm`が`requiresContactEmail`で2つの定数のスキーマから選んで`useAppForm`へ渡すだけにする(判断33により切り替えの後の検証のし直しは`useAppForm`が、判断34により描かれていない連絡先の欄の詳細は`applyServerFieldErrors`が扱うため、設計に再検証やエラーを消す手順を書かない)。連絡先を含まないスキーマは残った値を出力に含めないため、描かない間は連絡先を送らない。対象の種類と参照はスキーマの入力に含めず`onSubmit`で足す。
- **変えた箇所**: design.mdの`ReportForm`・`ReportFormSchema`とTesting Strategyのブラウザテストの`ReportForm`、tasks.mdの7.2(スキーマの単体テストと、他のカテゴリへ変えると送信ボタンが有効になることと描かれていない連絡先の欄の詳細がフォーム全体の失敗になることのブラウザテスト)。

## 実装済みの上流との食い違いの水平展開(2026-10-30、開発者の指示)

- **Sentryの定型の通知**: content-processingの差分の分析(G-4)で、backend-platformの改訂7と技術ドキュメント`infra/004`の「同じ文言を繰り返し送る通知」が、定型の文言で繰り返し起こり得る出来事を`captureMessage`ではなく`captureEvent`で送り、文言を`logentry`、まとめる単位を`fingerprint`に置くと定めていることを確かめた。`captureMessage`は既定の`dedupeIntegration`により、同じ文言の2件目以降が捨てられる。本specの`captureMessage`をすべて`captureEvent`に改め、規約の参照と通知のタグの記述に`logentry`と`fingerprint`の置き方を加えた。通知の種類・タグ・レベルは変えていない。
- 要件と受け入れ基準は変えていない。

## 層の規則に合わせた契約の置き場所の改訂(2026-11-02、開発者の指示)

- **規則**: [依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析)のとおり、api・eventの`src/application/**`・`src/domain/**`は`**/lib/workers/**`を型だけのimportでも読み込めない。複数のアプリや別の機能のapplication層が受け取る契約とDIの識別子は`backend-lib/core/<ドメイン>`に置き、`workers`には実装と束縛だけを置く。application層は文と一括の書き込みを扱わず、文を返す契約は`workers`に置いてinfrastructure層だけが使う。厳密なレート制限のカウンタを使うクラスはinfrastructure層に置く。
- **移したもの**: `ReportErasureStore`の文を返さない6つのメソッドと`ReportExportRecord`・`ReportExport`を`core/reporting/ports.ts`へ、`REPORTING_PLATFORM_TYPES`を`core/reporting/identifiers.ts`(`Symbol.for('reporting.<名前>')`の凍結したオブジェクト、単体テスト`identifiers.unit.test.ts`)へ移した。文を返す`logicalDeleteByReporterStatement`は、workers専用の契約`ReportErasureStatements`(`workers/reporting/report-erasure-statements.ts`)に分け、apiのinfrastructure層の`ReporterWithdrawalSyncHandler`だけが受け取る。`workers/reporting`には`D1ReportErasureStore`(2つの契約を満たす、`d1-report-erasure-store.ts`)・`D1ReportExport`(`d1-report-export.ts`)・`REPORTING_PLATFORM_MODULE`だけを置く。上流の`UserContactDirectory`・`UserProfileDirectory`・`ProductDirectory`は`core/identity`・`core/profile`・`core/product`から読み込む。
- **新しいポートと実装**: 受け付けの回数制限は、ポート`ReportSubmissionRateLimit`(`ReportSubmitter`とともに`application/reporting/ports.ts`)と、`RateLimitCounterClient`・`assertWithinLimit`を使う実装`CounterReportSubmissionRateLimit`(2つの規則とともに`infrastructure/reporting/counter-report-submission-rate-limit.ts`、Workers統合テスト)に分けた(identity-authの`CounterMailSendLimits`と同じ形)。bot判定はリゾルバの`assertHuman`で行い、application層は`BotVerifier`を受け取らない。
- **変えた箇所**: design.mdのOverviewのImpact・This Spec Owns・Allowed Dependencies(backend-platform・identity-auth・user-profile-social・product-launchの行)(後続specの依存を含む)・Revalidation Triggers・Existing Architecture Analysis(inquiry-chatの送信の順)・Architecture Integration・Dependency direction・File Structure Plan(`core/reporting/`・`workers/reporting/`・`application/reporting/`・`infrastructure/reporting/`)・通報の受け付けの流れの図・追跡表の回数制限の行・コンポーネントの表(削除のストアとエクスポートの層、受け付けの依存、`CounterReportSubmissionRateLimit`の行、同期の処理の依存)・ReportErasureStore・ReportErasureStatements・D1ReportErasureStoreの節(見出しを`backend-lib/core/reporting・backend-lib/workers/reporting`に変えた)・ReportExport・D1ReportExportの節・ReportSubmissionServiceの節・ReportNoticeRedispatchJob・ReportRetentionJobの節・ReporterWithdrawalSyncHandler・ReportErasureHandlers・Data Contracts & Integration・Testing Strategy(識別子の単体テスト、回数制限の実装のWorkers統合テスト、`D1ReportExport`)、tasks.mdの2.1・2.2・3.1・3.6・4.2・5.1・5.2・6。要件と受け入れ基準は変えていない。
- **残る課題(開発者の判断待ち)**: `ReportCaseWorkflow`(application層)は、`ReportCaseStatements`の`forStatusChange`・`forClosing`・`forInquiry`が返す`BatchItem<'sqlite'>[]`を受け取り、`commit`へ渡すか、ugc-moderationの`ModerationCommand.statements`へ載せる。application層が文と一括の書き込みを扱う形で、規則に合わない。措置の経路はugc-moderationの`ModerationCommand.statements`(engagementの`CommentModerationControl`などの`statements`も同じ形)の契約に依存するため、本specだけでは直せない。上流の措置のユースケースの入力を「書き込みの単位のポート」に変える方針を決めてから、本specの`ReportCaseStatements`を書き込みの単位のポート(状態の変更・措置なしの完了・照会の記録と、措置と一体の完了)に分ける。

### 開発者の決定: 参加者の登録口(2026-11-02)

- **状態**: 上の「残る課題」(`ReportCaseWorkflow`が`ReportCaseStatements`の文を受け取り`commit`へ渡す、またはugc-moderationの`ModerationCommand.statements`へ載せる)を、開発者が「参加者の登録口」の方式に決めた。ugc-moderationの改訂(同specのresearch.mdの同名の節)と組で行う。
- **Decision**: application層は値だけを渡し、文を扱わない。
  - 措置による対応済: `ReportCaseWorkflow.resolveWithMeasure`は、種類`content-reporting.report-case-closing`と完了の値(`MeasureCaseClosing`: 案件のID・措置・理由・日時・準備した監査ログ)だけの参加`ModerationWriteParticipation<MeasureCaseClosing>`を`toReportCaseClosingParticipation`(`application/reporting/report-case-closing-participation.ts`)で組み立て、ugc-moderationの措置のユースケースの`participation`に渡す。apiのinfrastructure層の参加者`ReportCaseClosingParticipant`(`infrastructure/reporting/report-case-closing-participant.ts`、ugc-moderationの`infrastructure/moderation`の`ModerationWriteParticipant`を実装)を、ugc-moderationの登録の一覧`MODERATION_WRITE_PARTICIPANTS`(apiの`composition/moderation-write-participants.ts`)に`{ kind, participant: REPORTING_TYPES.ReportCaseClosingParticipant }`で追記する。参加者は`readReportCaseClosingPayload`で値を読み(種類・形の誤りは`AppError(internal)`)、`D1ReportCaseStatements.forClosing(payload, context.actionId)`の文を返す。ugc-moderationが状態の変更・措置の記録・監査ログの文の後に並べて1つの一括の書き込みで確定する。
  - 措置を伴わない確定(手での状態の変更・措置なしの対応済・却下・照会の記録): application層の書き込みの単位のポート`ReportCaseWriter`(`changeStatus`・`close`・`recordInquiry`)にし、infrastructure層の`D1ReportCaseWriter`が`D1ReportCaseStatements`(infrastructure層の内部の部品、`forStatusChange`・`forClosing`・`forInquiry`)の文を単独の一括の書き込みで確定する。application層の契約に`BatchItem`を受け取る・返すものは無い。
- **措置の記録のIDの残し方**: 参加者が受け取る`context.actionId`は、ugc-moderationのユースケースが上流の操作の前に採番する措置の記録のID(結果の`ModerationOutcome.actionId`と同じ値)である。そのため案件の`resolution_action_id`は完了の更新の文で措置と同じ一括の書き込みに入れ、確定の後の単独の連結(`linkResolutionAction`)と、その失敗の通知`resolution-action-link-failed`をやめた。要件9.2(措置・案件の完了・監査ログを1つの一括の書き込みで確定)と9.3を同じ確定で満たす。上の「cross-spec reviewの指摘による承認後の修正」の修正1の「`actionId`は上流の確定の中で採番されるため、確定と同じ一括の書き込みには入れられない」は、この決定で前提が変わった。
- **変わらない振る舞い**: 同時の完了では完了の文の`CASE`式がNOT NULL制約に違反し、上流の状態・措置の記録・監査ログを含む全体が取り消される。上流の`changed: false`では何も書かれない。上流の確定の失敗の後は案件を読み直して`report_case_state_conflict`か上流のエラーを返す。エラーコードと通知の流れは変えていない。
- **変えた箇所**: design.mdのOverviewのImpact、This Spec Owns(参加者)、Out of Boundary(措置と案件の結び付き)、Allowed Dependencies(ugc-moderation)、Revalidation Triggers(措置の入力と参加者の登録口)、上流への影響の表(ugc-moderation)、Existing Architecture Analysis、Architecture Integration(Domain/feature boundaries・Existing patterns preserved・New components rationale)、Dependency direction、File Structure Plan(`ports.ts`の注記・`report-case-closing-participation.ts`・`d1-report-case-statements.ts`の注記・`d1-report-case-writer.ts`・`report-case-closing-participant.ts`)とModified Files(`moderation-write-participants.ts`)、措置による対応済の流れ(図と注記)、追跡表(8・9・10・12・16・19の行)、コンポーネントの表(`ReportCaseWorkflow`の依存、ストアの行、参加者の行)、上流の契約の利用の節、`ReportCaseWorkflow`・`InfringementInquiryService`の手順、「D1ReportSubmissionStore・D1ReportCaseStore・D1ReportCaseStatements・D1ReportCaseWriter・ReportCaseClosingParticipant・D1ReportCategoryStore・D1ReportNoticeStore」の節(`ReportCaseWriter`・参加の値・infrastructure層の宣言、`forClosing`の`resolution_action_id`)、Monitoring、Testing Strategy、本specが定める固有の値。tasks.mdの1.1(前提)・3.1(書き込みの単位のポートと参加の値、単体テスト、完了状態)・3.5(書き込みの単位と参加者、Workers統合テスト)・3.6(参加者の束縛と登録の一覧への追記)・4.5・4.6(参加の値の受け渡し、Workers統合テスト、完了状態)・4.7・9.1・9.6。要件と受け入れ基準は変えていない。

### ugc-moderationの実装による改訂の反映(2026-11-20)

- **状態**: ugc-moderationの実装と機能全体の検証で確かめた上流の振る舞いに、本specの設計を合わせた。要件と受け入れ基準は変えていない。
- **`changed: true`かつ`actionId: null`**: 上流の措置のユースケースは、状態は変わったが保留中の措置を取り出せなかった(束縛の誤り)とき、この組を返す。このとき措置の記録・監査ログに加えて参加者の文(案件の完了)も一括の書き込みに入っていない。`ReportCaseWorkflow.resolveWithMeasure`はこの組を案件の完了済みと扱わず、通知を送らずに想定外の失敗として投げる。
- **登録の無い種類と参加者の値の誤り**: ugc-moderationの実装(`apps/api/src/infrastructure/moderation/moderation-write-participant.ts`)は、登録の無い種類を`AppError`でなく通常の`Error`にする(束縛か呼び出し側の誤りで、運用者に知らせるため)。参加者の契約も「payloadの形が違えば`Error`を投げる」ため、`ReportCaseClosingParticipant`の種類・形の誤りも通常の`Error`にした。上の「開発者の決定: 参加者の登録口」の「種類・形の誤りは`AppError(internal)`」は、この反映で置き換わる。
- **変えた箇所**: design.mdのExisting Architecture Analysisの参加者の説明、措置による対応済の流れの注記、上流の契約の利用の節(`ModerationOutcome`・書き込みの参加者の登録口)、`ReportCaseWorkflow`の`resolveWithMeasure`、`D1ReportSubmissionStore`〜`D1ReportNoticeStore`の節の`ReportCaseClosingParticipant`、Testing Strategy(`ReportCaseWorkflow`・`ReportCaseClosingParticipant`)。

---

## 実装済みの上流との差分の分析(2026-11-22、kiro-validate-gap)

### 分析の範囲と方法

- **前提**: 要件・設計・タスクは承認済み(設計の最後の改訂は2026-11-20のugc-moderationの反映)。上流の28specは、data-export・launch-readinessを除いて実装済み(最後は27aefcbd)。本specのコードは無い。要件定義書の改訂(仮1〜仮8)は2026-10-25に適用済みで、要件の側の差分は無い。
- **方法**: 設計のAllowed Dependencies・上流への影響・各コンポーネントが前提にする契約を、実装済みのコード(正本の`apps/backend-lib`・`apps/common-lib`・`apps/frontend-lib`・`apps/db`と各アプリの`src`)と照合した。照合は(1)ugc-moderation・admin-foundation、(2)バックエンドの基盤と各機能の照会・登録口、(3)フロントエンドの登録口・部品・E2Eの補助の3つに分け、新しいサブエージェントで並行して行った。影響の大きい主張(メールの冪等のキー、部分一意索引への衝突、`sendWithTurnstile`、上流のテストの固定、`AccountGuard`の識別子、`purge_due`の`order`)は、コードを直接読んで確かめた。
- **設計の後に加わった技術ドキュメント**: `backend/021-cross-aggregate-admin-action-records.md`(2026-11-20、c7844a85)、`frontend/020-admin-search-and-moderation-actions.md`、`frontend/009`の「監査ログを残す操作の後の照会の無効化」(2733810d)、`external/001`・`infra/003`のメールの冪等のキー(2f745844)、`db/002`の部分一意索引への衝突の規則、`frontend/005`・`006`の`sendWithTurnstile`(50a97bc4、2026-11-03)。

### 要約

- 設計が名前で挙げる上流の契約は、ほぼすべて実装と一致する。登録口の空き(`PUBLIC_PROFILE_MENU_ITEMS` 10・`PRODUCT_PAGE_SECTIONS`の`bottom` 10・`COMMENT_ACTIONS` 10・`ADMIN_NAV_ITEMS` 70・`DASHBOARD_CARDS` 30・`CATEGORY_SECTIONS` 40・`ADMIN_PRODUCT_DETAIL_SECTIONS` 10・`MODERATION_WRITE_PARTICIPANTS`・4:21の2000と2010・`purge_due`の2000)も設計どおりである。`AuditTargetKind`には`report`・`category`が既にあり、追加は要らない。
- 相違は、設計の後に上流で確定した規約に設計が追いついていないことによる。影響の大きいものは、メールの冪等のキー(G-1)、部分一意索引への衝突の書き方(G-2)、上流のテストの固定による「上流の再検証は要らない」の不成立(G-3)、管理画面の照会の無効化と対象の不在の扱い(G-10・G-11)、bot判定の送信の形(G-9)である。
- いずれも新しいパッケージや外部APIを要さず、既存の前例を写せる。要件と受け入れ基準を変える必要は無い(G-3の並び順だけは開発者の確認が望ましい)。

### 要件と資産の対応

凡例: **一致**は既存の資産で足り設計どおり、**Missing**は本specが作るもの(設計に計画済み)、**Constraint**は設計の改訂を要する上流の制約、**Unknown**は設計の段階で決めるもの。

| 要件                                   | 使う既存の資産                                                                                                                              | 判定                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1(通報の導線)                          | `PUBLIC_PROFILE_MENU_ITEMS`・`PRODUCT_PAGE_SECTIONS`・`COMMENT_ACTIONS`、`frontend/015`のItem+Dialog、`useViewer()`                         | 一致。ダイアログ・項目はMissing。登録口のcontextにログイン状態が無く`useViewer()`で読む(G-16) |
| 2(通報フォーム)                        | `useAppForm`・`AppForm`・`FormField`・`SubmitButton`・`TurnstileWidget`・`useTurnstileToken`・`sendWithTurnstile`・`graphqlMutationOptions` | Constraint(G-9)                                                                               |
| 3(受け付け)・4(回数制限)               | `assertHuman`・`withValidatedArgs`・`RateLimitCounterClient`・`hashRateLimitKey`・`AccountGuard`、inquiry-chatの未ログインの送信            | Constraint(G-4・G-5・G-8)                                                                     |
| 5(集約と案件)                          | 部分一意索引の前例(`product-launches.ts:33`)、`db/002`の衝突の規則                                                                          | Constraint(G-2)                                                                               |
| 6・7(一覧・詳細)                       | `AdminDataTable`・`AdminFilterBar`・`AdminPageHeader`、`frontend/014`・`020`の検索条件と`loader`の規約                                      | Constraint(G-13)                                                                              |
| 8(対応ステータス)                      | `buildAuditLogStatements`・`AuditLogRecorder.prepare`、`backend/008`の前進の文の例外                                                        | Constraint(G-7)                                                                               |
| 9(措置)                                | `ProductModerationService.hide`・`CommentModerationService.hide`・`UserModerationService.suspend`、`MODERATION_WRITE_PARTICIPANTS`          | 一致(`backend/021`の規約とも合う)。画面はConstraint(G-10・G-11)                               |
| 10・11(却下・通知)・12(照会)           | `EmailSender`・`defineEmailKind`・`defineEmailTemplate`・`toMatchingKey`                                                                    | Constraint(G-1)                                                                               |
| 13(対応期間)                           | `AuditLogReader.latestFor`・`latestForMany`(90件ずつ)・`createFakeAuditLogReader`                                                           | 一致                                                                                          |
| 14(カテゴリのマスタ)                   | `CATEGORY_SECTIONS`・`CategoryMasterEditor`(`deleteAudited`)・`checkCategoryName`・`categoryReferenceFailureOf`                             | 一致。無効化の範囲はConstraint(G-10)                                                          |
| 15・16(ダッシュボード・プロダクト詳細) | `DASHBOARD_CARDS`・`DashboardCardFrame`・`ADMIN_PRODUCT_DETAIL_SECTIONS`・`RecoverableSlot`                                                 | Constraint(G-12)                                                                              |
| 17(保持と削除)                         | `USER_LIFECYCLE_ASYNC_HANDLERS`・`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`・`USER_LIFECYCLE_SYNC_HANDLERS`・`ScheduledJobDefinition`               | Constraint(G-3・G-5・G-6・G-15)                                                               |
| 18(データエクスポート)                 | data-exportは未実装。data-exportの設計は本specの`ReportExport.listPage`と一致                                                               | 一致(受け皿は後続specで作る)                                                                  |
| 監査ログの操作種別                     | `defineAuditAction`・`AUDIT_ACTIONS`(`audit-actions/index.ts`で連結)                                                                        | 一致。`index.unit.test.ts`の更新が要る(G-3)                                                   |

### 相違と新しい規約(設計の改訂の候補)

#### G-1: メールの冪等のキー(重要)

- **上流**: `EmailSendRequest.idempotencyKey?`(`apps/backend-lib/core/email/ports.ts:12`)。同じ種別で同じキーの依頼は、送信済みの記録の保持期間(14日)の間、2回目以降が送られない。送り直しのジョブを持つ通知はキーを必ず渡す規則である(`docs/GUIDES/tech/external/001-email-sending.md`の197・222行付近、`infra/003`の576行付近、`backend/021`の271行付近)。前例はugc-moderationの`moderation-notifier.ts:120`(`idempotencyKey: record.id`)。
- **設計**: `ReportNotifier`・`content-reporting.notice-redispatch`・`InfringementInquiryService`に、キーの記述が無い。
- **影響**: 仮3(完了から戻して再び完了すると通知を改めて依頼する)と仮4(照会の再送)があるため、通報IDや案件IDだけをキーにすると、正当な2回目の通知が14日の間は止められる。キーは「1回の完了・1回の照会」ごとに変わる値にする。メールアドレスと入力の値はキーに含められない(`[A-Za-z0-9_.:-]`の1〜128文字)。
- **Research Needed**: キーの組み立て(例: 申出者への結果は`<通報ID>:<完了の日時のミリ秒>`、却下の投稿者への通知は`<案件ID>:<完了の日時のミリ秒>`、照会は`<案件ID>:<照会の日時のミリ秒>`)。未ログインの宛先を`toMatchingKey`でまとめる場合に、まとめた単位のキーを何にするか。

#### G-2: 部分一意索引への衝突の書き方(重要)

- **上流**: `docs/GUIDES/tech/db/002-d1-constraints.md`の78〜80行は、部分一意索引への衝突にDrizzleの`onConflictDoNothing({ target, where })`を使わないと定める(drizzle-orm 1.0.0-rc.5が構文の誤りのSQLを出すため)。代わりに、対象を指定しない`onConflictDoNothing()`か、`onConflictDoUpdate({ target, targetWhere, set })`(`targetWhere`は`sql`で値を埋め込む)を使う。前例は`apps/backend-lib/workers/payments/d1-payment-record-store.ts:135`。
- **設計**: 360行の`ON CONFLICT (target_kind, target_id) WHERE closed_at IS NULL DO NOTHING`と、1548行の「Drizzleで生成できない場合は索引をカスタムマイグレーションで作る」。
- **影響**: 索引はDrizzleで生成できる(`apps/db/schema/product/product-launches.ts:33`に前例がある)ため、カスタムマイグレーションは要らない。`report_cases`は主キーのULID以外に一意制約を持たない計画のため、`onConflictDoNothing()`で書ける。参照を消した案件(`target_id`がNULL)は、SQLiteがNULLどうしを区別するため衝突しない。

#### G-3: 上流のテストの固定と「上流の再検証は要らない」の不成立(重要)

- 次の上流のテストは登録の一覧や末尾を固定で確かめており、本specの登録で失敗する。設計のModified Filesとタスクに、これらの期待値の更新が無い。
  - `apps/event/src/composition/user-lifecycle-async-handlers.unit.test.ts:81-101`: 「ugc-moderationは1900で、全てのドメインの物理削除の処理の後に並ぶ」(`namesFor('purge_due').at(-1)`がugc-moderation)。本specの2000は、この期待と衝突する。
  - `apps/event/src/composition/product-lifecycle-async-handlers.unit.test.ts:105-114`(プロダクトの`purge_due`の一覧)。`apps/event/src/composition/engagement-module.worker.test.ts:385-400`など、一覧を固定で確かめるファイルが他にもある(合わせて約10ファイル、要洗い出し)。
  - `apps/api/src/composition/moderation-write-participants.unit.test.ts:7`(「初版は参加者を登録しない」)。
  - `apps/common-lib/admin/audit-actions/index.unit.test.ts`(操作種別の完全一致)。
  - `ADMIN_NAV_ITEMS`の3つのテスト(`admin-nav-order.unit.test.ts`・`admin-navigation.browser.test.tsx`・`test/admin-shell.browser.test.tsx`、`frontend/009`の96行付近)。
- **並び順の論点(Unknown)**: roadmapの帯の割り当ては本specに`purge_due`の2000を割り当てている。ugc-moderationの設計の`1900`は帯の値で、「全ドメインの後」は割り当て時点の並びをテストに固定したものと推測する。本specの処理は、措置の記録のIDを外部キー無しで持つだけで、ugc-moderationの記録の削除と順序の依存は無い。そのため、2000のままにして上流のテストの「末尾」の期待を改めるのが自然だと考える。1800(空き)へ移す案もあるが、roadmapの帯と食い違う。開発者の確認が望ましい。

#### G-4: `AccountGuard`の識別子の名前

- 設計55行の`IDENTITY_TYPES.AccountGuard`は誤りで、正しくは`IDENTITY_PLATFORM_TYPES.AccountGuard`(`apps/backend-lib/core/identity/identifiers.ts:11,17`)。`currentUser`の判定は設計どおりで、未ログイン・退会は`undefined`、停止中は`user.status: 'suspended'`を返すため、仮6はこのまま成り立つ。

#### G-5: 未ログインの投稿の保護の規約(`security/008`)

- 現在時刻はリゾルバが1回読み、ポートへ`now`を渡す(`security/008`の154行付近)。inquiry-chatのポートは`consume(clientIp, now)`で、`RateLimitCounterClient.assertWithinLimit(decision, now)`はメソッドである。設計の`ReportSubmissionRateLimit.consume(submitter, clientIp)`に`now`を加える。
- 費用の小さい検証はbot判定の前に行う(同61行付近)。理由の書記素数・連絡先の形式は`withValidatedArgs`へ移し、`assertHuman`の前に誤りを返すのがよい(連絡先の要否はカテゴリに依存するため、ユースケースに残る)。
- 保持期間の閾値は`ScheduledJobContext.scheduledTime`から引く(同218行付近)。設計の「実行時刻−14日」「実行時刻−1時間」を改める。
- 会員と未ログインが同じ変更を使う構成は`security/008`の範囲外であり、設計が計画する`security/011-mixed-identity-submission-limits.md`で扱う前提と矛盾しない。

#### G-6: `UserLifecycleSyncHandler`の形

- 実装は`statementsFor(event, db)`で第2引数を持つ(`apps/api/src/infrastructure/identity/user-lifecycle-sync-handler.ts:11`)。設計1280行の書き方を合わせる。設計1481行の「`users`の削除(10000)」は、`users`の行を登録された処理ではなく実行器が全処理の後に消す実装(`apps/event/src/application/identity/user-lifecycle-runner.ts:98-99`)であり、10000は`withdrawn`の`identity-auth.email-suppression-cleanup`の値である。結論(本specの処理が`users`の削除の前に終わる)は変わらない。

#### G-7: 書き込みの文の並びと違反の判定

- `backend/008`は、監査ログを操作の文の先頭に置き、`CASE`式の前進の文を使う操作だけは前進の文を先頭・監査ログを最後にすると定める。設計の`forClosing`はこの例外に合うが、`forStatusChange`・`forInquiry`は並び順を明記していない。
- 既存の実装は、取り消しの原因の違反を列に限って見分ける(`guarded-batch.ts:10`、`apps/backend-lib/workers/engagement/engagement-guard.ts:6`、各committer)。`D1ReportCaseWriter`の「NOT NULL制約の違反を`conflict`に」は、`report_cases.status`の違反に限る。上流の措置の確定は`report_cases.status`の違反を自分の競合と見なさず、生のD1エラーのまま届けるため、設計の「読み直して`report_case_state_conflict`」は成り立つ(コードで確認)。
- `backend/021`の302行付近の統合テストの観点(参加者の文の違反で全体が取り消される)のうち、`report_cases.status`による取り消しの実地のテストは、本specのWorkers統合テストに置く。
- 任意: `buildAuditLogStatements`の第3引数`guard`(`{ kind: 'condition' }`)と`isAuditGuardRejection`(`audit-log-statements.ts:19,54`)を、カテゴリの削除の不在の判定に使える。

#### G-8: リゾルバの補助

- 各モジュールの`resolver-support.ts`の`adminOnly`・`clientOnly`は、入力の検証より前に呼び出し元の種類を拒否する(`modules/moderation/resolver-support.ts:20-29`)。設計1464行付近は`requireAdmin`と`withValidatedArgs`の順を書いていない。
- `withInputPath`(`field-paths.ts:27`)、inquiry-chatの`accountGuardOf`、ハンドルの検査には`HANDLE_PATTERN`より`checkHandleFormat(v, USER_HANDLE_RULE)`を使う前例がある。
- `CURSOR_PAGE_ARGS`の`first`の上限は100で、設計の1〜50は独自のスキーマで書く(相違ではなく記述の補足)。

#### G-9: bot判定の送信の形(フロントエンド)

- 設計の`executeGraphQL({ turnstileToken: consume() })`は、現在の規約(`frontend/005`の265〜281行、`frontend/006`の315〜345行)と違う。`useMutation(graphqlMutationOptions(...))`を`sendWithTurnstile`(`apps/frontend-lib/utilities/bot-protection/send-with-turnstile.ts`)で送り、`bot_verification_failed`のときは1回だけ送り直す。

#### G-10: 管理操作の後の照会の無効化(フロントエンド)

- `frontend/009`の191〜199行(2733810d): 監査ログを残す操作は、成功の後に`invalidateAuditLogQueries`(`apps/admin/src/graphql/admin-audit-logs.ts:20`)を呼び、失敗と変化無しの後は呼ばない。テストは`watchAuditLogQueries`(`apps/admin/test/audit-log-queries.ts`)で確かめる。
- 設計の`UseReportCaseMutation`は、本specの照会4つだけを無効にする。状態の変更・完了・却下・照会・カテゴリの操作に監査ログの照会の無効化を加え、措置による対応済ではugc-moderationの`invalidateAdminModeration*Queries`も加える。`ReportCategorySection`の無効化の範囲(カテゴリ・絞り込みの選択肢・案件・監査ログ)も設計に無い(前例は`admin-inquiry-categories.ts:39-56`)。
- 27aefcbdは各specの設計書に無効化を書き足したが、本specは対象に入っていない。

#### G-11: 対象の不在と確認のダイアログの置き場所(フロントエンド)

- `frontend/020`の117〜164行(405ee4dc): 確認のダイアログは一覧の単位に1つ置き(`moderation/shared/moderation-dialog-host.tsx`)、行が消えても残す。対象の不在の失敗だけは影響する照会を無効にしてから投げ直し、詳細のページではダイアログを閉じるまで遅らせる(`deferTargetMissingRefresh`、`use-moderation-mutation.ts:71-177`)。
- 設計は`/reports`の各行に`ReportCaseActions`とダイアログを持たせる。`status=OPEN`で絞った一覧では、確定すると行が消えてダイアログも消える。`report_target_unavailable`・`report_case_closed`・`report_case_state_conflict`の後に取り直す振る舞いも書かれていない。`isTargetMissing`は措置のコードだけを数えるため、本specは自分のコードの判定を持つ。
- `InfringementInquiryDialog`のような独自の入力ダイアログは`ConfirmActionDialog`と同じ扱い(処理中は`aria-disabled`・`aria-busy`)にする(`frontend/009`の235行付近)。`ConfirmActionDialog`には理由の欄へ注記を足すpropが無く、`description`は`<p>`の中に描かれるため、「理由は通知に載る」は`description`の文で示す。

#### G-12: 区画・カードの失敗の表示(フロントエンド)

- `ADMIN_PRODUCT_DETAIL_SECTIONS`の区画は`RecoverableSlot`で包まれる(`admin-product-detail-sections-view.tsx:46`)。最初の失敗は`throwOnError: (_e, q) => q.state.data === undefined`で境界へ渡し、取り直しの失敗では表示中のデータを残す(`frontend/006`の144〜146行)。設計の`ProductReportsSection`の`PartialErrorState`を改める。区画は`ownerUserId`がnullの場合も扱う。
- ダッシュボードのカードは定期再取得の対象ではなく、取り直しの失敗で件数を残す(前例`unhandled-inquiries-card.tsx:27-45`、`frontend/010`の177〜190行)。

#### G-13: 管理画面の一覧のファイルの置き場所と検索条件(フロントエンド)

- `frontend/020`の11〜64行・`frontend/014`・`frontend/006`の34〜38行: ルートには`validateSearch`・`loaderDeps`・`loader`・`head`・`component`だけを置き、ページは`components/pages/`、変換・`loader`・無効化の関数は`graphql/admin-<ドメイン>-<対象>.ts`(単体テスト付き)に置く。検索条件は項目ごとに`.catch(undefined)`で捨て、期間が逆なら両端を未指定にし、`<対象>SearchAt`・`<対象>FilterScopeOf`を置く。`loader`は`cause === 'stay'`で待たず、部品は`keepPreviousData`と`inert`・`aria-busy`を使う。
- 設計のFile Structure Planに`graphql/admin-reporting-*.ts`・`client/src/graphql/reporting*.ts`・`components/pages/`が無く、`report-search.ts`の置き場所も020(`components/<ドメイン>/shared/`)と違う。状態の変更の応答を表示中の値へ写す前例に`withChangedInquiryStatus`(`admin-inquiries.ts:152`)がある。

#### G-14: 計画している技術ドキュメントとの重複

- 計画の`frontend/021-registered-action-dialogs.md`は、`frontend/015`の「メニューの登録口の項目とダイアログ」(224〜247行)と重なる。計画の`backend/022-submission-aggregation-and-case-resolution.md`のうち、措置と案件の完了の一体の確定は`backend/021`と重なる。新しい文書は差分(登録口をまたいで同じダイアログを使う形、集約と完了の規則)に絞り、重なる部分は既存の文書を参照する。番号`backend/022`・`frontend/021`・`security/011`・`features/007`は空いている(`frontend`の011・018は欠番)。

#### G-15: 定期実行の制約

- 4:21の合計の時間の予算は300秒(`SCHEDULED_RUN_BUDGETS`、`apps/api/src/composition/scheduled-jobs.ts:140`)。本specの2つのジョブ(2000・2010)はこの予算を分け合う。
- ジョブの定義は、ジョブのファイルで凍結した`*_JOB_DEFINITION`をexportし、`scheduled-jobs.ts`から読む(前例`guest-inquiry-retention-job.ts:19`)。

#### G-16: その他(軽微)

- 登録口のcontext: `PublicProfileSectionContext`・`CommentActionContext`はログイン状態を持たないため`useViewer()`(`apps/client/src/components/auth/use-viewer.ts:10`)で読む。`PublicProfileSectionContext`は`suspended`を持つ。停止中の利用者のプロフィールに通報の項目を出すかは要件1に明記が無い(Unknown。要件1.1は「公開プロフィール」とだけ言う)。
- E2E: 文書用のIPアドレスの`e2e/support/client-ip.ts`(`assumeDistinctClientIp`)と`e2e/support/bot-verification.ts`(`waitForBotToken`)を使う。`moderation-fixtures.ts`の投稿者はログインできないため、「自分のコメントには通報が無い」のE2Eは別の用意が要る。
- モックアップ(`mockups/src/components/client/report-dialog.tsx`)は連絡先の欄を理由の前に置き、未ログインだけを条件にする。設計は要件2(停止中も含む、仮6)に従っており、変える必要は無い。管理者側の通報管理のモックアップは無い。
- データエクスポートの文書(`docs/GUIDES/service/features/001-user-data-export.md`の446〜470行)に、`targetRef`がnullになる規則がまだ無い。設計のModified Filesの計画どおりタスク1.6で改める。

### 実装の進め方の選択肢

#### 案A: 設計を改訂してから実装する

- G-1〜G-16を`/kiro-spec-design content-reporting`の部分改訂としてdesign.mdへ反映し、タスクの追加・変更(上流のテストの更新、無効化、ダイアログの置き場所、冪等のキー)をtasks.mdへ反映してから`ready_for_implementation`にする。
- ✅ 実装の前に契約と期待値が確定し、kiro-implの自律実行で迷う点が減る。過去のspec(frontend-platform・ugc-moderationの反映)と同じ進め方。
- ❌ 設計の改訂とタスクの再レビューの手間がかかる。

#### 案B: 設計はそのままにし、実装の中で吸収する

- 相違をtasks.mdのImplementation Notesに列挙し、各タスクの実装で上流の規約に合わせ、最後に設計書へ反映する。
- ✅ すぐに実装へ進める。
- ❌ G-1(キーの組み立て)とG-3(並び順)は実装の途中で判断が要り、自律実行で質問できない。設計書と実装の相違が実装の間ずっと残る。

#### 案C: 重要な相違だけ設計を改訂し、残りは実装の中で吸収する(折衷)

- 設計の判断を要するG-1・G-2・G-3・G-5・G-10・G-11だけをdesign.mdとtasks.mdへ反映する。名前の訂正や前例を写すだけのG-4・G-6・G-8・G-9・G-12・G-13・G-15・G-16はImplementation Notesに置く。
- ✅ 判断が要る点を実装前に確定しつつ、改訂の量を抑える。
- ❌ 設計書と実装の軽微な相違が一時的に残る。

### 工数とリスク

- **工数: L(1〜2週間)**。3テーブル・7ユースケース・2ジョブ・2つの波及処理・3つのメール種別・利用者側のダイアログ・管理画面の2ページと4つの登録を作る。前例(inquiry-chat・ugc-moderation)を写せるが、範囲が広い。設計の改訂(案AかC)は別に1〜2日。
- **リスク: Medium**。上流の契約は実装と一致し、新しい技術は無い。ただし、措置の参加者による一括の書き込み、仮3の再開と部分一意索引の衝突、メールの冪等のキー、多数の上流のテストの期待値の更新のように、正しさの確認が難しい箇所が複数ある。

### 設計フェーズへの推奨

- **推奨**: 案C(または案A)。少なくともG-1・G-2・G-3は、実装の前に設計とタスクへ反映する。G-3の並び順は開発者の確認を経る。
- **主な決定事項**: (1)メールの冪等のキーの組み立て(完了ごと・照会ごと)。(2)`purge_due`の2000のままで上流のテストの「末尾」を改めるか、1800へ移すか。(3)一覧のダイアログを一覧の単位に置き、確定・不在の後にどの照会を無効にするか。(4)新しい技術ドキュメント3本の範囲を既存の`backend/021`・`frontend/015`との差分に絞るか。
- **Research Needed(設計で調べる)**:
  - `idempotencyKey`の14日の保持期間と、notice-redispatchの再送の期間・仮3の再完了の間隔の関係。
  - `purge_due`の一覧を固定するテストのファイルの網羅的な洗い出し(約10ファイル)。
  - 停止中の利用者のプロフィールに通報の項目を出すか(要件1.1の解釈)。
  - `report_target_unavailable`・`report_case_closed`・`report_case_state_conflict`のそれぞれで無効にする照会の範囲。

## 差分の分析の判断の確定と反映(2026-11-22、開発者の回答)

- **状態**: 上の「実装済みの上流との差分の分析」のG-1〜G-16を、開発者の回答に基づいてdesign.mdとtasks.mdへ反映した。要件と受け入れ基準は変えていない。判断を要する点は1件ずつ選択肢と推奨を示して質問した。

### 開発者の回答

| 論点                        | 採用した案                                                                                                                                               | 他の選択肢                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 進め方                      | (推奨と異なる)G-1〜G-16の全16件をdesign.mdとtasks.mdへ反映する(案A)                                                                                      | 判断の要る6件だけを反映し残りはImplementation Notes(案C、推奨) / メモだけ(案B) |
| G-1 メールの冪等のキー      | (推奨どおり)結果と却下の通知は完了ごとのキー(`<宛先のまとまりの通報のIDの最小>:<完了の日時のミリ秒>`・`<案件のID>:<完了の日時のミリ秒>`)、照会はキー無し | 照会も前回の照会の日時からのキー / 通報ID・案件IDだけのキー                    |
| G-2 部分一意索引への衝突    | (推奨どおり)`onConflictDoUpdate`の`targetWhere`で案件の作成と更新を1文にする                                                                             | 対象を指定しない`onConflictDoNothing()`で3文の構成を保つ                       |
| G-3 物理削除の処理の順      | (推奨と異なる)利用者・プロダクトの`purge_due`を1800にし、ugc-moderationの1900を末尾に保つ                                                                | roadmapの割り当てどおり2000にして上流のテストの「末尾」の期待を改める(推奨)    |
| G-5 受け付けの検証の順      | (推奨どおり)入力の形式と連絡先の要否・形式を、リゾルバでbot判定の前に行う                                                                                | 形式だけbot判定の前 / 設計のまま                                               |
| G-10 措置の後の照会の無効化 | (推奨どおり)ugc-moderationが措置の影響する照会の対応表を`invalidateModerationAffectedQueries`として公開し、本specが呼ぶ                                  | 本spec側で列挙する / 本specの照会と監査ログだけ                                |
| G-11 確認のダイアログ       | (推奨どおり)一覧と詳細の単位に1つ置き、対象の不在・完了済み・競合の3つの失敗で案件の照会を取り直す(詳細では閉じるまで遅らせる)                           | 同じ形で対象の不在だけ取り直す                                                 |
| G-14 技術ドキュメントの範囲 | (推奨どおり)3本とも作り、既存の`backend/021`・`frontend/015`・`frontend/020`・`security/008`と重なる部分は参照にして差分に絞る                           | `frontend/021`を作らず015へ追記 / 計画どおり自己完結                           |

### 質問せずに決めた事項

- **G-16: 停止中の利用者のプロフィールの通報の項目**: 停止中の利用者の公開プロフィールは本人にしか表示されない(`apps/api/src/application/profile/public-profile-reader.ts`の`isViewable`)。本人には通報の操作を出さない(要件1.2)ため、他の閲覧者に停止中の利用者の項目が描かれる場面は無く、判断は要らない。設計の`UserReportMenuItem`に注記した。
- **G-7: 読んだ後の案件の物理削除**: 未完了の案件も、申出者の物理削除で通報が無くなると`eraseEmptyCases`で消え得る。`CASE`式の更新は行が無いと0件の更新で成功して監査ログだけが残るため、状態の変更・完了・照会の文の先頭に存在の検査の文(`report_cases.target_kind`にNULLを入れる`INSERT … SELECT … WHERE NOT EXISTS`)を置き、違反の列で`not-found`を見分けることにした。`backend/021`の173行付近の検査の文と`db/002`の「版の検査で一括の書き込み全体を取り消す」の形をそのまま使うため、選択肢を立てず規約に従った。監査ログには`guard`を渡さない(`backend/008`の前進の文の例外)。
- **`invalidateModerationAffectedQueries`の切り出しの担当**: ugc-moderationは実装済みのため、本specのタスク8.2が`use-moderation-mutation.ts`から対応表を切り出してexportする。内容の持ち主はugc-moderationのままで、振る舞いは変えず、ugc-moderationの既存のブラウザテストで確かめる。
- **登録の一覧を固定する上流のテスト**: 本specの登録で失敗する上流のテストの期待値は、各登録のタスク(1.3・3.6・5.2・6・7.3・8.5・8.6・8.7)が改める。対象は全アプリのテストの実行で失敗したものに限り、上流のテストの意図(並びの前後関係・重複の禁止・ugc-moderationが末尾)は保つ。

### 変えた箇所

- **design.md**: OverviewのImpact、This Spec Owns(`purge_due`の1800・技術ドキュメントの範囲)、Allowed Dependencies(backend-platformのジョブの定義・`scheduledTime`・予算・`assertWithinLimit(decision, now)`、api-gatewayの`withInputPath`と`clientOnly`・`adminOnly`、admin-foundationの`invalidateAuditLogQueries`・`watchAuditLogQueries`、ugc-moderationの`invalidateModerationAffectedQueries`・一覧の単位のダイアログ・`RecoverableSlot`、identity-authの`IDENTITY_PLATFORM_TYPES.AccountGuard`・`accountGuardOf`・`statementsFor(event, db)`・`useViewer()`、user-profile-socialの`checkHandleFormat`・`USER_HANDLE_RULE`、email-deliveryの`idempotencyKey`、frontend-platformの`graphqlMutationOptions`・`sendWithTurnstile`と管理画面の一覧と詳細の規約)、Revalidation Triggers、上流への影響(admin-foundation・ugc-moderation・identity-auth・product-launchの行、roadmapの報告、上流のテストの期待値の更新)、Existing Architecture Analysis、File Structure Plan(ジョブの定義・`resolver-support.ts`・eventの1800・clientの`graphql/reporting.ts`・adminのルートとページと`shared/report-search.ts`と`report-case-dialog-host.tsx`と`graphql/admin-reporting-*.ts`・E2Eの補助・技術ドキュメントの範囲)、Modified Files(マイグレーション・ugc-moderationの`use-moderation-mutation.ts`・上流のテスト・eventの1800・固有の値)、通報の受け付けの流れ(図・検証の順・通報者の確かめ直し・2文の一括の書き込み)、措置による対応済の流れ(存在の検査の文・`report_case_not_found`)、通知と照会の流れ(冪等のキー)、上流の契約の利用(`invalidateModerationAffectedQueries`・`invalidateAuditLogQueries`・`idempotencyKey`)、`ReportTargetResolver`、`ReportSubmissionService`(入力の注記・`consume`の`now`・前提と手順)、`ReportNotifier`、2つのジョブ(予定時刻・ジョブの定義・予算)、`ReportCaseWriter`(`not-found`)、`D1ReportCaseStatements`(文の並び・存在の検査の文)、`D1ReportCaseWriter`(違反の列の見分け)、`ReportCaseClosingParticipant`、`ReporterWithdrawalSyncHandler`、`ReportingSchemaModule`(認可と`submitReport`のリゾルバの順と入力の検証)、`ReportErasureHandlers`(1800と順序の説明)、clientの`UserReportMenuItem`・`ReportForm`・`UseSubmitReport`、adminの`ReportSearch`・ルートとページ・`ReportCaseActions`・`ReportCaseDialogHost`・`ReportCaseActionDialog`・`ReportCaseDetailView`の行・`InfringementInquiryDialog`・`UseReportCaseMutation`・`UnhandledReportsCard`・`ProductReportsSection`・`ReportCategorySection`、Physical Data Model、Error Handling、Testing Strategy(単体・Workers統合・ブラウザ・E2Eの追加の観点と上流のテストの期待値の更新)、Performance、Supporting References(`purge_due`の1800・冪等のキー)。
- **tasks.md**: 1.1(前提)、1.2(部分一意索引の生成)、1.3(集約のテスト)、3.2(`onConflictDoUpdate`の1文)、3.5(存在の検査の文・文の並び・違反の列)、3.6(参加者の登録のテスト・`statementsFor(event, db)`)、4.1(`checkHandleFormat`)、4.2(検証の分担・確かめ直し・`now`)、4.4(冪等のキー)、4.5・4.6・4.7(`report_case_not_found`・照会のキー無し)、5.1(予定時刻・ジョブの定義・同じキーの送り直し)、5.2(`resolver-support.ts`・4:21の並びのテスト)、5.3(リゾルバの順)、5.4(`adminOnly`・物理削除された案件)、6(1800と上流のテスト)、7.1(`graphql/reporting.ts`)、7.2(`sendWithTurnstile`・`useViewer()`)、7.3(`frontend/015`と上流のテスト)、8.1(`graphql/admin-reporting-*.ts`)、8.2(検索条件の規約・ダイアログの置き場所・`invalidateModerationAffectedQueries`の切り出し・無効化と取り直し・`description`の文)、8.3(`components/pages/`・`inert`・ダイアログが残ること)、8.4(取り直しの遅延・照会のダイアログの`aria-busy`)、8.5(`RecoverableSlot`・カードの件数の保持・上流のテスト)、8.6(`deleteDescriptionOf`・`deleteAudited`・無効化・上流のテスト)、8.7(メニューのテスト)、9.1(技術ドキュメントの範囲・固有の値)、9.2(E2Eの補助)、9.3(自分のコメントの用意)、9.6(作業の報告)。
- **roadmapへの報告**: 本specの帯の「使用中の値」は「4:21は2000・2010、波及処理は1800」になり、roadmapの帯の割り当て(波及処理の2000)と異なる。本specはroadmapを編集しないため、コントローラーへ報告する。

### 反映のレビュー(2026-11-22)

- design.mdとtasks.mdの変更部分を、新しいサブエージェントによる独立した確認(independent)でレビューした(cc-sddのdesign-review-gateとタスクのグラフのサニティレビューに相当)。1回目は安全機能による停止で結果が得られず、依頼を言い換えて再実行した。
- 判定はNEEDS_FIXES(必須2件・軽微9件)で、全件を反映した。挙げた実在のファイル・関数・文書の節は、指摘の箇所を除いて書かれたとおりだった。存在の検査の文・部分一意索引への`ON CONFLICT … DO UPDATE`・違反の文言による列の見分けは、レビューで`bun:sqlite`により確かめられた。
  - 必須1: 読んだ後の案件の物理削除の`report_case_not_found`が、管理画面の取り直しの対象に無かった。開発者の回答(推奨どおり)で4つ目の失敗として加え、詳細のページでは4つとも取り直しをダイアログを閉じるまで遅らせる(案件の不在は詳細を`NotFoundView`に替えてダイアログごと消し、他の失敗も確認の説明の前提を変えるため)。`frontend/020`は対象の不在だけを取り直すため、完了済み・競合・案件の不在でも取り直すことを規約との意図した違いとして設計に書き、`frontend/021`の範囲に入れた。
  - 必須2: `ReportCaseWorkflow`の`changeStatus`・`resolveWithoutMeasure`・`reject`と`InfringementInquiryService`の手順に`not-found`の扱いを書き足した。照会でメールを送った後に案件が無いと分かった場合は、記録の失敗と同じく`captureEvent`(`inquiry-record-failed`)で知らせて`report_case_not_found`を返す。
  - 軽微: 存在の検査の文の`id`を案件のIDにし、`target_kind`以外のNOT NULLの列に有効な値を入れる(SQLiteはNOT NULLの検査を列の定義順に行うため)。最後の受付日時を`MAX`で古い時刻へ戻さない。`markOutcome`が宛先のまとまりの通報を1文で全部進める前提を明記した。`security/008`の引用を節の名前(「確認の順序」「保持期間による削除」)に直した。`assertWithinLimit`の`now`をミリ秒(`now.getTime()`)にした。Components and InterfacesとRequirements Traceabilityの表、tasks.mdの5.3の`_Requirements`(2.4・3.5・3.6)を追従させた。`ReportCaseDialogHost`の失敗の後のフォーカスの戻り先(起点のボタンが消えたら一覧の見出し)とダイアログの文脈のファイル`report-case-dialog-context.ts`を加えた。設計書とタスクの本文から日付と経緯の書き方を除いた。上流のテストの一覧をタスクとそろえた。
- 反映の後、要件の149件の受け入れ基準の番号がすべてタスクにあること、整形の検査が通ることを確かめた。
- 2回目の確認(新しいサブエージェントによる独立した確認)の判定はNEEDS_FIXES(必須1件・軽微5件)で、前回の11件はすべて直っていた。全件を反映した。
  - 必須: 「通知と照会」の流れの照会の段落が、送信の後の記録の失敗をすべて`report_case_state_conflict`としていた。案件の不在(`not-found`)では`captureEvent`で知らせて`report_case_not_found`を返す旨を加え、`InfringementInquiryService`の手順とそろえた。
  - 軽微: tasks.mdの4.7に不在でもエラートラッキングへ通知することを加えた。This Spec Ownsの技術ドキュメントの参照先に`frontend/020`・`security/008`を加えた。Requirements Traceabilityの通報フォームの行に`ReportingSchemaModule`を加えた。Non-Goalsの要件定義書の改訂とRevalidation Triggersの仮1〜仮8から日付を除いた(日付はresearch.mdに残る)。tasks.mdの3.1のつながっていた2つの項目を分けた。
