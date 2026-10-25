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
  - engagement: `COMMENT_ACTIONS`(`{ id, order, component }`、`CommentActionContext`の`comment.id`・`authorNickname`・`product`・`launch`)は他者の表示中のコメントのメニューにだけ描かれる。`CommentStore.findByIds`の`CommentRecord`(`authorUserId`・`deletedAt`・`hiddenAt`・`anonymizedAt`)。
  - directory-discovery: `PRODUCT_PAGE_SECTIONS`の`bottom` 10は通報の予約。`ProductPageContext`の`product.id`・`viewer.isOwner`。sponsorshipの広告は`bottom` 20で通報の後に並ぶ。
  - user-profile-social: `PUBLIC_PROFILE_MENU_ITEMS`(`{ id, order, Item }`、`PublicProfileSectionContext`の`handle`・`isOwner`)、`ProfileActionsMenu`は本人以外に描かれる。`UserProfileDirectory.findSummaries(ids, 'visible' | 'not-withdrawn')`・`resolveHandle`。
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
- **Trade-offs**: `actionId`は上流の確定の中で採番されるため、連結は確定の後の単独の書き込みになり、失敗すると案件に措置の記録のIDが残らない。その場合も措置と完了は確定済みで、`captureMessage`(`resolution-action-link-failed`)で知らせ、案件の`resolution`と監査ログ(`report.resolve`の詳細`resolution`)で通報由来を追える。
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
- **Rationale**: 回答の期限の起算点(監査ログの日時)が、実際に依頼した時刻より前にならない。記録の失敗は`captureMessage`で検知し、管理者が再送する。

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

- 措置の記録のIDの連結(確定の後の単独の書き込み)が失敗する — 措置と完了は確定済みのまま、`captureMessage`(`resolution-action-link-failed`)で知らせる。案件の`resolution`と本specの監査ログ(`report.resolve`の詳細`resolution`)で通報由来を追える。
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
  - **Decision**: `changed: true`の措置の後に、`ReportCaseStatements.linkResolutionAction(caseId, actionId)`(措置による対応済で未設定の案件だけの条件付きの更新)を単独で実行する。失敗は措置と完了を取り消さず、`captureMessage`(`resolution-action-link-failed`)で知らせ、結果は成功とする。列は外部キーを持たず、措置による対応済の案件だけが値を持てるCHECKを置く。
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
