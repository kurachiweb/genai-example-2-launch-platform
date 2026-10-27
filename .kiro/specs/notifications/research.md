# Research & Design Decisions

## Summary

- **Feature**: `notifications`
- **Discovery Scope**: Complex Integration(通知の実装は無い。上流の18spec(dev-tooling〜match-engine)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはemail-deliveryの送信の受付・抑止リスト・テンプレート基盤・送信者情報の取得口、match-engineのマッチの照会、identity-authの連絡先の照会・`verifiedUsers()`・設定ページのシェル・ライフサイクルの登録口、user-profile-socialのフォロワーの照会、product-launchのプロダクトの照会、admin-foundationの認可と監査ログ、ultras-subscriptionの管理画面の設定ページの区画の登録口、backend-platformの定期実行・メッセージ・`KeyedHasher`・IP制限の除外の上に、受信設定・送信枠ごとの集約と送り出し・配信停止・送信者情報・通知イベントの契約を足す)
- **Key Findings**:
  - 勝敗結果と翌日予告の統合(FR-NOTIF-004)と、フォロワーへの開催通知の同日分の集約(FR-NOTIF-009)は、どちらも「同じ送信枠の中で宛先ごとにまとめる」問題である。送る時刻の区切り(送信枠)を持つ通知の記録に一般化すれば、統合・集約・Yearの1回戦の前日まで保持(仮1)・遅れた発行を同じ仕組みで扱える。
  - 23:45の送り出しは、日次タイムラインの「ペアリング→Week・Yearの組み合わせ→通知のenqueue」の順の最後に来る必要がある。本specの帯(1300番台)はtournament-week(1500番台)・tournament-year(1700番台)より前に動くため、帯の中の値のままでは組み合わせより先に送ってしまう。briefの帯の注意(帯の外の値を使う前に開発者へ確認する)に当たるため、仮2として記録し、2026-10-24に開発者がC(トーナメントのジョブの最後に本specの送り出しを呼ばせる)に確定した。
  - FR-NOTIF-017は配信停止のトークンを「利用者及び通知種別ごとに発行」し「ハッシュ化して保存」し「平文はメールのURLでのみ提示」すると定める。同じ組のトークンを以後のメールでも使うには、保存した値から平文を作り直せる必要があり、乱数の種とペッパー(`HASH_PEPPER`)からHMACで導出する方式にした(メールごとにトークンを発行する方式は、組ごとに1つという要件に反し、記録も送信数に比例して増える)。
  - email-deliveryは、通知メールの分類の抑止中の宛先への送信を送信時に取りやめ、送信者情報の取得口(`SenderInfoProvider`、eventの登録箇所`EMAIL_SENDER_INFO_PROVIDER`)と配信停止のリンクの区画を共通レイアウトに持ち、`List-Unsubscribe`・`List-Unsubscribe-Post`の追加ヘッダーを許可リストで受け付ける(`List-Unsubscribe`は`<https://...>`を含むことを要する)。送信者情報の表示はメールの全種別に及ぶ(email-deliveryの確認済み事項)。
  - backend-platformのアクセスログはパスを記録しクエリ文字列を除く。ページ配置の`/unsubscribe/{token}`のままではトークンがclientのアクセスログ・アクセス解析に残るため、identity-authのメールのリンクと同じくフラグメントで渡す形を仮5とした。

## 要件フェーズ前の確認事項(2026-10-24)

開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を推奨した。**仮1〜仮7は2026-10-24に開発者が確定した。仮2は推奨と異なる(C)に、それ以外は推奨どおりに決まり、本specの論点はすべて確定している。** 決定は`requirements.md`の「要件フェーズでの決定」にも記録する。roadmapの「Requirement Ambiguities」の表の「トーナメントの開始予告メールを組み合わせ決定時とマッチ前日のどちらで送るか」の行(notificationsの担当)は、仮1で決めた。roadmapは編集せず、解決の列の文言をコントローラーへ報告する。

| #   | 論点                                                                                            | 根拠                                                                                                                                                                                                             | 選択肢                                                                                                                                                                                   | 推奨と確定                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | トーナメントの開始予告メールを組み合わせ決定時とマッチ前日のどちらで送るか                      | FR-NOTIF-001(「マッチ前日の23時45分、ペアリング(FR-GAME-005・FR-TOURW-007・FR-TOURY-009)後」)、FR-TOURY-009・014(組み合わせは決勝の6日前、1回戦は0〜5日前)、briefのConstraints、roadmapのRequirement Ambiguities | (A)マッチ前日の23:45に送る(組み合わせ決定が前でも前日まで保持) / (B)組み合わせ決定時に送る / (C)両方で送る                                                                               | 2026-10-24に開発者が確定(推奨どおり)。推奨は(A)。FR-NOTIF-001の「マッチ前日の23時45分」の文言に一致し、予選・Week・Yearの2回戦以降(すべて前日の23:45)と同じ規則になる。(B)はYearの1回戦だけ最大5日前の通知になり、勝敗結果との統合(前日の同じ枠)とも揃わない。(C)は同じマッチの予告が2通になる                                                                                                                                                                                |
| 仮2 | 23:45の送り出しを、本specの帯より後のトーナメントの組み合わせ(1500番台・1700番台)の後にする方法 | 日次タイムラインの「同時刻に走る処理の順序」(ペアリング→月曜日・D−6日の組み合わせ→通知のenqueue)、roadmapの帯の割り当て(notificationsは1300番台)、briefのConstraints                                             | (A)本specのジョブは帯の中(1300)のまま、送り出しの開始を5分遅らせる / (B)送り出しのジョブだけ帯の外の値(1700番台より後)を使う / (C)トーナメントのジョブの最後に本specの送り出しを呼ばせる | 2026-10-24に開発者が(C)に確定(推奨と異なる)。推奨は(A)だった。(A)は帯の規則を変えず、トーナメントの組み合わせ(同じCronの起動の中で数秒〜数十秒で終わる)と、確定のマッチイベントの非同期の処理(23:40の確定から数十秒)の両方の後に送り出せる。(B)は帯の規則の例外を作り、非同期の処理の遅れには効かない。(C)は下流のspecに本specの入口を呼ぶ手順を負わせるが、遅延に頼らずに組み合わせの直後に送り出せる。(C)の入口の設計はDesign Decisionsの「夜の枠の送り出しの入口(仮2・C)」 |
| 仮3 | 送信者情報が未設定のときの通知メール                                                            | FR-NOTIF-010(通知メールに送信者情報を表示しなければならない)、LR-005、email-deliveryのresearch.md(「未設定の通知メールを送るかはnotificationsが判断する」)                                                       | (A)送らず、運営者が検知できるようにする / (B)送信者情報を省いて送る                                                                                                                      | 2026-10-24に開発者が確定(推奨どおり)。推奨は(A)。(B)は特定電子メール法・CAN-SPAM法の表示義務に反するメールを送ることになる。リリースの準備(launch-readiness)で設定を確かめる                                                                                                                                                                                                                                                                                                  |
| 仮4 | 勝敗結果と開始予告を統合したメールの、ワンクリックの配信停止の対象                              | FR-NOTIF-004(統合)、FR-NOTIF-012(当該通知種別の配信停止)、RFC 8058(1つのメールに1つのHTTPSのURI)                                                                                                                 | (A)勝敗結果の通知種別だけを止め、本文に両方のリンクを出す / (B)ワンクリックで両方を止める                                                                                                | 2026-10-24に開発者が確定(推奨どおり)。推奨は(A)。トークンが利用者と通知種別の組ごと(FR-NOTIF-017)のため、1つのURIで止められるのは1つの通知種別である。統合したメールは勝敗結果の通知に予告を添えたもの(文言規則の件名「フルタイム: …」)と読める                                                                                                                                                                                                                               |
| 仮5 | 配信停止のリンクのURLの形                                                                       | ページ配置の`/unsubscribe/{token}`、FR-NOTIF-017(平文はメール内のURLでのみ提示)、backend-platform・frontend-platformのアクセスログ(パスを記録しクエリを除く)、identity-authのメールのリンク(フラグメントで渡す)  | (A)本文のリンクは`/unsubscribe#token=…`、ヘッダーのURIは`/unsubscribe?token=…` / (B)ページ配置どおり両方ともパスに含める                                                                 | 2026-10-24に開発者が確定(推奨どおり)。推奨は(A)。フラグメントはサーバーへ送られず、クエリはアクセスログから除かれる。(B)ではトークンがアクセスログ・Web Analytics・Sentryの遷移の記録に残る。ページ配置の表を改める(本specのタスクで行う)                                                                                                                                                                                                                                     |
| 仮6 | 対戦相手のいないマッチ(不戦勝)の開始予告                                                        | FR-NOTIF-001(「両プロダクトを登録したユーザー」へ「マッチ開始予告」)、文言規則の件名(対戦相手を含める)、FR-GAME-004                                                                                              | (A)送らない(当日の勝敗結果で不戦勝を伝える) / (B)不戦勝になる旨の予告を送る                                                                                                              | 2026-10-24に開発者が確定(推奨どおり)。推奨は(A)。開始するマッチが無く、件名の規則(プロダクト名と対戦相手)を満たせない。トーナメントの不戦勝の連鎖(FR-TOURW-023)の翌日の予告も同じ扱いになる                                                                                                                                                                                                                                                                                   |
| 仮7 | 自分のプロダクトが非公開化・論理削除されている場合の開始予告と勝敗結果                          | FR-ADMUG-009(非公開化の通知はトランザクションメール)、FR-GAME-015・016(相手の退会等による勝利)、FR-PRDCT-013                                                                                                     | (A)送らない / (B)勝敗結果は送る                                                                                                                                                          | 2026-10-24に開発者が確定(推奨どおり)。推奨は(A)。非公開化・削除の連絡は各機能のトランザクションメールが担い、敗北の通知を重ねない。停止・退会した投稿者は送信の対象者でないため、残る場面は非公開化と個別の削除だけである                                                                                                                                                                                                                                                     |

### 確認済みのため質問しない事項

- 通知種別の名前: データエクスポートの文書(`account.json`の`notificationSettings`)の`matchPreview`・`matchResult`・`followedUserMatch`・`followedUserAward`に合わせ、内部の値を`match_preview`・`match_result`・`followed_user_match`・`followed_user_award`とする。抑止の理由は`bounce`(email-deliveryの`hard_bounce`)・`complaint`・`rejected`に写す。
- 送信の対象者: identity-authが通知メールの対象者の条件として`verifiedUsers()`(退会済みでも停止中でもなく、確認済み)を提供し(要件4.2、設計の「通知メールの対象者は`verifiedUsers()`で絞る」)、宛先と宛名は`UserContactDirectory`で引く(roadmapのShared seams)。絞り込みの条件として`users`を結合するのはidentity-authの部品の使い方どおりで、メールアドレス・ニックネームは`users`から読まない。
- 停止中の利用者の受信設定の変更: FR-USER-026(停止中の利用者の書き込み操作を拒否)に従い拒否する。停止中は送信の対象者でないため通知メールは届かず、ログイン不要の配信停止(トークン)は停止中でも使える。
- 未確認の利用者の受信設定の変更: FR-USER-006の制限に通知設定の変更は無く、受け付ける。送信は確認まで行わない。
- 抑止の判定と表示: email-deliveryの`SuppressionList`(`getStatus`・`findSuppressed`)を使う。送信時の取りやめもemail-deliveryが行うが、本specも送る前に照会して記録の理由を残す。
- 送信者情報の表示範囲: email-deliveryが全メールに表示すると決めている。本specは`SenderInfoProvider`の実装を差し替え、値を保存する。
- 配信停止のトークン: 組ごとに1つ・平文を残さない・退会まで有効の3つを同時に満たすには、平文を作り直せる導出が要る(Design Decisions)。要件の解釈ではなく設計の帰結として扱う。
- 決済期限の明記(文言規則): 予選の勝利の結果通知のWeekの決済期限はtournament-week、Week決勝の勝利の結果通知のYearの決済期限はtournament-yearが計算と所有をする。本specは結果の追記の登録口を提供し、登録が無ければ追記なしで送る。
- 受賞の通知の受信者: FR-NOTIF-007はフォロワーだけを対象にする。投稿者本人には決勝の勝利の勝敗結果(FR-NOTIF-004)が届く。
- 送る時刻: 開始予告と勝敗結果は23:45の後、マッチ開催は0:00の後、受賞は発行の直後。即時の終了や開始時点の決着で結果が出たマッチも、勝敗結果はその日の23:45の後に送る(FR-NOTIF-004の「マッチ当日の23時45分」)。
- Cronの式: 0:00(`0 8 * * *`)・23:45(`45 7 * * *`)はmatch-engine、4:21(`21 12 * * *`)はemail-deliveryが追加済みで、本specは式を足さない。
- 新しいパッケージ: 無い。テンプレートはemail-deliveryのReact Email、画面はfrontend-platformのshadcn/uiの`switch`、検証はzodを使う。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(match-engineと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(通知イベント契約・利用者の連絡先の照会・データエクスポートの出力・画面シェル・監査ログ・Cron・Queuesのディスパッチ・ユーザーライフサイクルイベント)とbriefのConstraints。
- **Sources Consulted**: email-delivery・match-engine・identity-auth・user-profile-social・product-launch・admin-foundation・ultras-subscription・backend-platform・api-gateway・frontend-platform・infra-delivery・paymentsの`design.md`と、email-delivery・match-engine・user-profile-socialの`research.md`の後続specへの申し送り、tournament-week・tournament-year・data-exportのbrief。
- **Findings**:
  - email-delivery: `EmailKind`(`category: 'notification'`)・`defineEmailKind`・`EMAIL_KINDS`の集約点(`core/email/kinds/index.ts`)、`EmailSender.send({ kind, to, input, deadline?, headers? })`(受付で検証し`email.send`へ。本文は64KiB以内)、`ALLOWED_EXTRA_HEADERS`(`List-Unsubscribe`は`<https://...>`を含む・`List-Unsubscribe-Post`は`List-Unsubscribe=One-Click`だけ)、`SuppressionList.getStatus`・`findSuppressed`(90件ずつ)と`SuppressionState`(`lastReason`・`lastEventAt`・`expiresAt`)、`SenderInfoProvider.get()`と`SenderInfo`(`businessName`・`contactEmail`・`postalAddress`)、eventの登録箇所`EMAIL_SENDER_INFO_PROVIDER`(`Newable<SenderInfoProvider>`で`.to()`で束縛するクラス。既定は`UnsetSenderInfoProvider`)、`EmailTemplate`(`subject`・`preview`・`greeting`・`action`・`unsubscribeLinks`・`Body`)と`EMAIL_TEMPLATES`の集約点、配信停止の区画のリンク`unsubscribeLinks?(input)`(`{ url, label? }`の並び。1つならラベルを省くと既定の文言「この通知を配信停止」、2つ以上ならラベルが必須。区画は通知メールの種別にだけ置く)、共通レイアウトの順(宛名→本文→行動ボタン→配信停止→送信者情報)、`formatUtcDateTime`・`formatUtcDate`、`AlertThrottle`(`EMAIL_PLATFORM_MODULE`でapi・eventの両方に束縛)。送信時に通知メールの分類で抑止中なら送らない(8.4)。
  - match-engine: `MatchDirectory.listForDate({ date, kinds, now })`(実施日のマッチ、IDの昇順)・`findMatches(ids, now)`(90件ずつ)と`MatchRecord`(`kind`・`round`・`stage`・`matchDate`・`startsAt`・`endsAt`・`decision`・`phase`・`entries[]`の`entryId`・`slot`・`launchId`・`productId`・`ownerUserId`・`upvoteCount`・`result`)、`MATCH_PLATFORM_MODULE`(api・event)。0:00の開始(1100)・23:40の確定(1100)・23:45のペアリング(1100)はいずれも同期のジョブで、開始時点の決着は`started`のイベントを出さない。research.mdは本specがマッチイベントの処理(1300番台)と`findMatches`で通知を作ることを想定するが、契約ではない。
  - identity-auth: `UserContactDirectory.findContact(userId)`(`email`・`nickname`・`emailVerified`、退会済み・物理削除済みは`undefined`、停止中は返す)、`verifiedUsers()`、`AccountGuard`(`currentUser`・`requireWritableUser`)、`USER_LIFECYCLE_SYNC_HANDLERS`(集合の更新の文)・`USER_LIFECYCLE_ASYNC_HANDLERS`(`order`、`purge_due`)、`LIFECYCLE_CONTINUE_DELAY_SECONDS`、`assertLifecycleHandlerName`、`SETTINGS_NAV_ITEMS`(`notifications` 40と予約済み)、`_authenticated`のレイアウト、`readFragmentToken`(`#token=`を読み`history.replaceState`で消す)、`invalid_link`のエラーコード。
  - user-profile-social: `FollowerDirectory.listVisibleFollowerIds({ followeeId, after, limit 1〜500 })`(フォローのIDの昇順、可視のフォロワー。受信設定と確認の判定は通知の側)、`UserProfileDirectory.findSummaries(ids, 'visible')`(ニックネーム・ハンドル)、`PROFILE_PLATFORM_MODULE`(api・event)。
  - product-launch: `ProductDirectory.findSummaries(ids, 'visible')`(`name`・`handle`・`ownerUserId`・`visible`・`listed`、90件ずつ)、`PRODUCT_PLATFORM_MODULE`(api・event)。
  - admin-foundation: `requireAdmin(context, role)`、`AuditLogRecorder.prepare`・`buildAuditLogStatements`(操作と同じ一括の書き込みに入れる)、`defineAuditAction`と`audit-actions/<spec名>.ts`の追加、`AuditTargetKind`の`setting`、`AdminDirectory`、`RoleGate`・`ConfirmActionDialog`・`AdminPageHeader`、E2Eの`e2e/support/admin-bootstrap.ts`・`e2e/support/local-d1.ts`。
  - ultras-subscription: `AdminSettingsSection`(`{ id, order, component }`)と`ADMIN_SETTINGS_SECTIONS`(`notifications.sender-info` 30と予約済み)、機能フラグの区画(`PromotionSettingSection`)の版による競合の検出・`super_admin`での変更・監査ログの準備の形。
  - backend-platform: `ScheduledJobDefinition`(`at`・`order`)・`ScheduledJobContext.business`、`MessagePublisher.publish(contract, body, { delaySeconds 0〜43200 })`、`MessageHandlingResult`の`defer`(試行回数を数えない)、`RetryPolicy`、`KeyedHasher`(`hash(purpose, value)`はbase64urlの86文字、`verify`はタイミングセーフ)、`AppModule.routes`、`excludePath(pathPrefix, method)`と各アプリの`rate-limit-exclusions.ts`(初版は空で、notificationsがRFC 8058の経路を追記する予定と明記)、アクセスログはパスを記録しクエリを除く。
  - infra-delivery・payments: eventのホスト名(`genai-example-2-event[-staging].lab.kurachiweb.com`、ローカルは`http://localhost:48043`)、eventの`CLIENT_SITE_ORIGIN`はpaymentsが追加済み。eventが自分のオリジンを知る変数は無い。
  - 下流のbrief: tournament-week・tournament-yearは「通知イベント(開始予告・結果・受賞)を発行する」。data-exportは本specの部品で`notificationSettings`を出す。
- **Implications**: 上流のファイルの変更は、契約で定められた登録箇所への追記(メール種別・テンプレート・送信者情報の取得口・ライフサイクル・定期実行・メッセージ・IP制限の除外・設定ページのナビゲーション・管理画面の設定ページの区画・監査ログの操作種別・スキーマモジュール)と、eventの変数`EVENT_SITE_ORIGIN`の追加だけである。上流specの文書の変更は要らないが、infra-deliveryの「ホスト名から導かれる変数の値」の表に`EVENT_SITE_ORIGIN`の行を足す必要がある(コントローラーへ報告する)。

### 送る時刻と処理の順序

- **Context**: FR-NOTIF-001・004・006、日次タイムライン(23:40の確定→23:45のペアリング→Week・Yearの組み合わせ→通知のenqueue、0:00の開始と開催通知)、roadmapの帯(match-engine 1100・notifications 1300・tournament-week 1500・tournament-year 1700)。
- **Findings**:
  - 同じ時刻のジョブは1回のCronの起動の中で`order`の昇順に直列に動き、失敗は次のジョブを止めない。23:45ではmatch-engineのペアリング(1100)の後に本specの1300が動くが、tournament-weekの組み合わせ(月曜日、1500)とtournament-yearの組み合わせ(D−6日、1700)はその後になる。
  - トーナメントのラウンドの進行は23:40の確定の`decided`のイベントの処理(非同期、eventのQueueの処理)か23:40のジョブで行われ、翌日のマッチの予定と結果の通知イベントの発行は23:40〜23:45の数十秒の間に済む見込みである。
  - 当初の推奨は、本specの23:45のジョブが送り出しのメッセージを5分遅らせる案だった。開発者の確定(仮2・C)により、トーナメントの23:45のジョブが処理の最後に本specの入口へ準備の完了を伝え、全てそろった時点で送り出す。遅れて届いた発行は送り出しの後でも個別に送れる(統合だけを諦める)。
  - 0:00は、match-engineの開始のジョブ(1100)が種別によらず当日のマッチを同期で開始するため、本specの0:00のジョブ(1300)の時点でマッチの状態は確定している。開催通知はマッチイベント(`started`、非同期)を待たずに、マッチの照会から集められる。
- **Implications**: 送信枠(夜・朝・受賞)と、送信枠の状態(待機・収集・送信・完了)を持つ記録を作り、23:45・0:00のジョブは枠を開くだけにする。夜の枠は送り出しの前提の機能の準備の完了で送り出す。

### 統合と集約

- **Context**: FR-NOTIF-004(準決勝以前の勝利は翌日の予告と1通に統合)、FR-NOTIF-009(同日の開催通知を1通に集約)、仮1(Yearの1回戦の予告を前日まで保持)。
- **Findings**:
  - 勝敗結果(当日の夜の枠)と翌日のマッチの開始予告(前日の夜の枠=当日の夜の枠)は、同じ利用者の同じプロダクトについて同じ枠に入る。枠と宛先とプロダクトでまとめれば、トーナメントの側が統合を意識せずに結果と予告を別々に発行してもよい。
  - 開催通知は朝の枠と宛先でまとめれば、何人の作り手のマッチでも1通になる。対象の上限を30件とし、本文(email-deliveryの64KiB)と読みやすさに収める。
  - 統合は受信設定に従う。勝敗結果だけ、開始予告だけを受信する利用者には、その種別だけのメールにする。
- **Implications**: 通知の記録に送信枠のキーとまとめのキー(`group_key`)を持ち、送り出しはまとめのキーごとに1通の計画(`planGroupEmail`)を立てる。

### 予選の開始予告と結果の作り方

- **Context**: brief(match-engineがマッチイベントを発行できている前提)、roadmap(match-engine・tournament-week・tournament-yearが通知イベントを発行する)、match-engineは承認済みで本specの契約へ発行しない。
- **Findings**:
  - match-engineの`scheduled`・`decided`のイベントの処理として登録する方式は、1マッチごとの非同期の処理になり、夜の枠の送り出しまでに全て処理されたかを確かめる手段が無い。
  - 夜の送り出しの収集の段で`MatchDirectory.listForDate`から当日の確定した予選と翌日の予選を読めば、ペアリング(同期のジョブ)の結果を取りこぼさずに作れる。記録の重複は通知のキー(`dedupe_key`)で防ぐ。
  - トーナメントのマッチもマッチの照会から作れるが、どのマッチを予告するか(不戦勝の連鎖・ブラケットの段階)はトーナメントのspecが決める。契約で発行させ、予選と同じ記録に入れる。
- **Implications**: 予選は本specが照会から作り(要件12.6)、トーナメントは契約で発行する。マッチイベントの処理は登録しない。

### 配信停止とRFC 8058

- **Context**: FR-NOTIF-012・016〜018、LR-005、backend-platformのQ1(RFC 8058の配信停止をIP単位の制限の対象外にする)。
- **Sources Consulted**: RFC 8058(Signaling One-Click Functionality for List Email Headers)、RFC 2369(`List-Unsubscribe`)、Gmail・Yahooの一括送信者のガイドライン(ワンクリックの配信停止とDKIMの署名の対象)、CAN-SPAM法(配信停止の手段は送信から30日以上機能し、10営業日以内に反映する)、特定電子メール法(送信者の名称・住所・受信拒否の連絡先の表示、オプトイン)。
- **Findings**:
  - RFC 8058は、`List-Unsubscribe`にHTTPSのURIを、`List-Unsubscribe-Post: List-Unsubscribe=One-Click`を持ち、受信者のメールソフトがそのURIへ本文`List-Unsubscribe=One-Click`のPOSTを送ると、Cookieや認証を求めずに停止することを求める。GETでは停止してはならない(リンクの事前取得で止まらないため)。URIには受信者と配信の種類を識別する値を含める。
  - 両ヘッダーはDKIMの署名の対象に含めることが一括送信者のガイドラインで求められる。Email Sendingが追加ヘッダーを署名の対象に含めるかは公開の文書で確かめられないため、stagingで受信したメールのヘッダーで確かめる(Risks)。
  - URIへのGETはブラウザで開かれた場合に当たり、配信停止ページへ移動させれば利用者が確認の操作で止められる。
  - クエリ文字列はbackend-platformのアクセスログから除かれ、フラグメントはサーバーへ送られない。
- **Implications**: eventに`POST /unsubscribe?token=`(停止)と`GET /unsubscribe?token=`(clientの`/unsubscribe#token=`への303)を置き、`excludePath('/unsubscribe', 'POST')`を登録する。本文のリンクはclientの`/unsubscribe#token=`(仮5)。

### 配信停止のトークンの保存

- **Context**: FR-NOTIF-017(組ごとに発行・NFR-SECUR-006でハッシュ化・平文はメール内のURLだけ)、FR-NOTIF-018(退会まで有効)、NFR-SECUR-006(固定ペッパーを鍵にしたHMAC-SHA512、タイミングセーフな比較)。
- **Findings**:
  - 平文を保存せずに同じトークンを毎回のメールへ入れるには、保存した値と秘密の鍵から平文を作り直す必要がある。組ごとに32バイトの乱数の種を保存し、トークンを`KeyedHasher.hash('notification-unsubscribe-token', '<利用者ID>:<種別>:<種>')`(86文字)とする。照合用には`KeyedHasher.hash('notification-unsubscribe-lookup', <トークン>)`を一意索引で持ち、見つけた行を`KeyedHasher.verify`で確かめる。
  - データベースだけが漏れてもペッパー無しにはトークンを作れない。ペッパーも漏れた場合はトークンを作れるが、その時点でパスワードのハッシュなど全ての秘密が危うく、トークンでできることは1つの種別の受信の停止だけである。
  - 新しいシークレットは要らない(`HASH_PEPPER`はapi・eventの必須のシークレット)。
- **Implications**: `UnsubscribeTokenService`(`tokensFor`・`resolve`)を`workers/notifications`に置き、api(配信停止ページの照会と確定)とevent(送り出しとワンクリック)の両方で使う。退会の同期の処理で種の行を消せば、全てのトークンが即時に無効になる。

### 送信者情報

- **Context**: FR-ADMCF-024(各200文字以内)、FR-ADMAG-001(監査ログ)、ultras-subscriptionの機能フラグの区画の形、文言規則の入力欄の上限。
- **Findings**: 1行の設定(版の番号付き)で足り、保存は版の条件付きの更新と監査ログの記録を1つの一括の書き込みにする(ultras-subscriptionの`D1PromotionSettingWriter`と同じ形)。監査ログの詳細の鍵は個人情報を含めない値だけと定められており(admin-foundation)、連絡先メールアドレス・住所は個人の情報になり得るため、詳細には変更した項目の名前だけを入れる。
- **Implications**: `notification_sender_settings`と`SenderInfoStore`、eventの`D1SenderInfoProvider`(email-deliveryの取得口の実装)、apiの`SenderInfoService`と管理画面の区画。

### フォロワーへの展開

- **Context**: FR-NOTIF-006・007・009、`FollowerDirectory`の500件ずつの照会、Workersの制限(CPU時間・バインド変数100個)。
- **Findings**: 受信設定の初期値は受信しないため、フォロワーのうち受信する設定の利用者は少ない見込みである。フォロワーを500件ずつ読み、受信設定と`verifiedUsers()`で90件ずつ絞り、該当する利用者の記録だけを作る。投稿者が多い日や人気の作り手でも、1回の処理を2,000件のフォロワーで区切り、続きを`defer`で再開すればCPU時間に収まる。
- **Implications**: 朝の枠の収集の段は、当日のマッチ中のマッチの投稿者の一覧を先に作って進み具合(カーソル)を枠の行に持つ。受賞の展開は通知イベントの行にカーソルを持つ。

### 参照したスキル

- `ecc:api-design`(エラーの形式と状態コード、本プロジェクトの規則で採用)、`ecc:security-review`(配信停止のトークン・ログの個人情報)、`consent-management-skills:consent-withdrawal`(撤回を同意と同じ容易さにする: 設定ページのスイッチ・ワンクリック・リンクの3つの手段)、`data-subject-rights-skills:marketing-objection`(異議の即時の反映と全経路での抑止: 送る直前の確かめ直し)。

## Architecture Pattern Evaluation

| Option                                    | Description                                                           | Strengths                                                     | Risks / Limitations                                                                                        | Notes          |
| ----------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------- |
| 送信枠ごとの通知の記録と送り出し(採用)    | 通知を宛先ごとに記録し、送信枠の送り出しでまとめのキーごとに1通にする | 統合・集約・保持・遅れた発行・重複の防止を1つの仕組みで扱える | 記録と送り出しの状態の管理が要る。送り出しの途中の障害で、ごくまれに同じメールを2回送り得る(少なくとも1回) | 採用           |
| 通知イベントの受信の時点で即時に送る      | 発行やマッチイベントを受け取るたびにメールを送る                      | 単純                                                          | 統合(FR-NOTIF-004)と集約(FR-NOTIF-009)と23:45の時刻を満たせない                                            | 不採用         |
| 予選をマッチイベントの処理で作る          | match-engineの`scheduled`・`decided`の処理として登録する              | 発行の形がトーナメントと同じ                                  | 送り出しの時点で全ての処理が済んだか確かめられず、統合と集約の完全性が崩れる                               | 不採用         |
| 23:45の送り出しのジョブを帯の外の値にする | トーナメントの組み合わせ(1700番台)より後の値で同期に送り出す          | 処理の順が決定的                                              | 帯の規則の例外。非同期の確定の処理(ラウンドの進行)の遅れには効かない                                       | 仮2(C)で不採用 |
| メールごとに新しいトークンを発行する      | 送るたびに乱数のトークンを作り、ハッシュだけを保存する                | 平文を作り直す仕組みが要らない                                | 組ごとに1つ(FR-NOTIF-017)に反する。記録が送信数に比例して増え、退会まで消せない                            | 不採用         |
| トークンを暗号化して保存する              | 平文のトークンを鍵で暗号化して保存し、照合用のハッシュも持つ          | 作り直せる                                                    | 新しい鍵のシークレットが要り、導出の方式と安全性は同じ                                                     | 不採用         |

## Design Decisions

### Decision: 送信枠とまとめのキーを持つ通知の記録

- **Context**: 要件3〜6・12.8・13。
- **Alternatives Considered**:
  1. 受信のたびに即時に送る
  2. 送信枠(`evening:<日付>`・`morning:<日付>`・`award:<イベントID>`)と、まとめのキー(夜は宛先とプロダクト、朝は宛先、受賞は宛先)を持つ通知の行を作り、枠ごとの送り出しで1通ずつにする
- **Selected Approach**: 2。枠の行は状態(`waiting`→`collecting`→`sending`→`done`)・送り出しの期限(`settle_until`)・送り出しの前提の一覧と依頼の時刻・収集の進み具合・リース(同時の送り出しの排除)を持つ。通知の行は`dedupe_key`(`<種別>:<マッチまたはイベント>:<側またはプロダクト>:<宛先>`)で一意にし、再発行・再実行で増えない。`done`の枠へ遅れて入った通知は、その場で送り出しを依頼する。
- **Rationale**: 統合・集約・保持・遅れ・重複の全てを同じ仕組みで扱え、トーナメントのspecは統合の規則を知らずに発行できる。
- **Trade-offs**: 送り出しの途中で、メールの送信の依頼の後・記録の更新の前に処理が落ちると、再試行でそのメールをもう一度送る(少なくとも1回)。1回の処理の単位を20通に抑えて影響を小さくする。

### Decision: 夜の枠の送り出しの入口(仮2・C、2026-10-24に開発者が確定)

- **Context**: 要件13.1・13.7〜13.9、日次タイムライン、roadmapの帯。開発者は「トーナメントのジョブの最後に本specの送り出しを呼ばせる」(C)を選んだ。
- **Alternatives Considered**:
  1. トーナメントのジョブが本specの送り出しを直接始める(呼んだ時点で送る)
  2. 送り出しの前提として機能の名前を登録し、各機能が準備の完了を伝え、全てそろった時点で1回だけ送り出す。そろわなければ期限で送り出す
- **Selected Approach**: 2。
  - 公開の入口: `EveningDispatchGate.markReady({ participant, date, at })`(`core/notifications/evening-dispatch.ts`、DIの識別子`NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate`、apiだけで束縛)。前提の登録口はapiの`EVENING_DISPATCH_PARTICIPANTS`(初版は空)。
  - 本specの`notifications.evening-dispatch`(23:45、1300)は`EveningSlotOpener.open(date)`で夜の枠を開き、前提の一覧(登録口の写し)と期限(23:55)を記録する。一覧は未確定(NULL)のときだけ書き込むため、通知の記録が数日前に作った夜の枠(Yearの1回戦の予告など)も、その夜の`open`か最初の`markReady`で確定する。前提が空なら直ちに送り出し、空でなければ期限の送り出しだけを依頼する(遅延のメッセージ)。
  - 冪等: 準備の完了は`(slot_key, participant)`の一意索引、依頼は`dispatch_requested_at IS NULL`かつ全ての前提がそろった条件付きの更新で、それぞれ1回だけ記録する。依頼を記録した呼び出しだけが送り出しのメッセージを送る。重複したメッセージは送信枠のリースで無害になる。
- **ケースごとの扱い**:
  - トーナメントのジョブが動かない日(予選だけの日): トーナメントの23:45のジョブはCronで毎日動き、組み合わせ・進行の処理が無い日も最後に`markReady`を呼ぶ契約にする(曜日や決勝日による判定は各specのジョブの中で行い、呼び出しは省かない)。そのため予選だけの日も、両方の呼び出しの直後(23:45の数秒後)に送り出す。トーナメントのspecが実装される前(前提が未登録)は、本specのジョブが枠を開いた時点で送り出す。
  - 一方のトーナメントだけが処理を行う日: 他方も処理なしで呼ぶため、2つそろった時点で送り出す。一方のジョブが失敗して呼ばなければ、23:55の期限で送り出し、呼ばなかった機能の名前を`evening-dispatch-incomplete`として報告する。
  - 両方が同じ夜に呼ぶ: 先の呼び出しは`waiting`(残りの名前)、後の呼び出しが`dispatch-requested`になり、送り出しのメッセージは1通だけになる。同時に呼んでも条件付きの更新のため依頼は1回である。同じ機能の再実行・2回目の呼び出しは`already-requested`を返す。
  - 本specのジョブが失敗・遅延した夜: `markReady`が枠を作った場合は、前提の一覧と期限の送り出しも作るため、期限の送り出しが失われない。4:21の保守も未完了の枠を送り直す。
  - 遅れた非同期の処理(以前は5分の遅延が吸収していたもの): トーナメントは`markReady`の前に、その日に確定したマッチのラウンドの進行と通知イベントの発行を同期で済ませる契約にする(確定のマッチイベントの処理が未完了なら、ジョブの中で同じ処理を冪等に行って追いつく)。予選の結果と予告は本specが同期の状態から集めるため、非同期の処理を待たない。それでも送り出しの後に届いた発行は、統合せずに遅らせずに送る(12.8)。受賞は受賞の枠で即時に送るため、夜の枠を待たない。
  - 期限の後に呼ばれた場合: 送り出しは始まっているため`already-requested`を返す。その後の発行は遅れた通知として送る。
- **Rationale**: 遅延の長さに頼らずに、組み合わせの直後に送り出せる。下流のspecの呼び出しの失敗や未実装が、通知の欠落ではなく最大10分の遅れになる。前提の登録口により、トーナメントのspecが本specのファイルを変えずに加われる。
- **Trade-offs**: トーナメントのspecは毎日呼ぶ契約を守る必要がある(呼ばなければ毎晩23:55まで遅れ、警告になる)。テーブルが1つ増える。
- **Follow-up**: tournament-week・tournament-yearの設計とタスクに、前提の登録と`markReady`の呼び出しを加える(報告)。

### Decision: 予選は照会から収集し、トーナメントは契約で発行する

- **Context**: 要件3.1・4.1・12.1〜12.6。
- **Selected Approach**: 夜の枠の収集の段で、当日の確定した予選(勝敗結果)と翌日の2つの側の予選(開始予告)を`MatchDirectory.listForDate`で読み、受信する設定の送信の対象者の通知を記録する。トーナメントは`NotificationEventPublisher.publish`で`match_preview`・`match_result`・`award`を発行し、本specが同じ記録に展開する。開始予告と結果の展開は宛先が2人以下のため発行の中で行い、受賞はフォロワーへの展開のため非同期(`notifications.expand-event`)で行う。
- **Rationale**: 予選の完全性を同期のジョブの結果で保ち、トーナメントの判断(何を予告するか)をトーナメントに残す。

### Decision: 配信停止のトークンを種とペッパーから導出する

- **Context**: 要件10。
- **Selected Approach**: Research Logの「配信停止のトークンの保存」のとおり。種の行は通知種別ごとに最初のメールを送るときに作る(受信する設定の利用者だけ)。照合は照合用のハッシュの一意索引で1行を引き、`KeyedHasher.verify`で確かめる。
- **Trade-offs**: ペッパーとデータベースが両方漏れるとトークンを作れる(Research Log)。

### Decision: 配信停止のURLはフラグメントとクエリで渡す(仮5)

- **Context**: 要件8・9.7、FR-NOTIF-017。
- **Selected Approach**: 本文のリンクは`<CLIENT_SITE_ORIGIN>/unsubscribe#token=<トークン>`、`List-Unsubscribe`は`<<EVENT_SITE_ORIGIN>/unsubscribe?token=<トークン>>`。clientの配信停止ページはidentity-authの`readFragmentToken`で読み、GraphQLの変数で送る(要求の本文に入り、パスに出ない)。eventのGETは`<CLIENT_SITE_ORIGIN>/unsubscribe#token=<トークン>`へ303で移す。
- **Follow-up**: ページ配置の`/unsubscribe/{token}`を`/unsubscribe#token={token}`に改め、2026-10-24に開発者が確定した決定である旨を添える。

### Decision: eventのオリジンの変数`EVENT_SITE_ORIGIN`を足す

- **Context**: 要件8.1(ヘッダーのURIはイベントサーバー)、Queueの処理は要求を持たず自分のホスト名を知らない。
- **Selected Approach**: eventの`vars`に`EVENT_SITE_ORIGIN`(ローカル`http://localhost:48043`、staging`https://genai-example-2-event-staging.lab.kurachiweb.com`、prod`https://genai-example-2-event.lab.kurachiweb.com`)を足し、環境の検証で必須にする。email-deliveryのヘッダーの検証はHTTPSを求めるため、オリジンが`https:`でない環境(ローカル)ではヘッダーを付けずに`info`のログを出す。本文のリンクと配信停止ページはローカルでも使える。
- **Follow-up**: infra-deliveryの「ホスト名から導かれる変数の値」の表の`EVENT_SITE_ORIGIN`の行は、infra-deliveryの改訂1が提供する(cross-spec reviewの指摘による)。

### Decision: 結果の追記の登録口

- **Context**: 要件4.6・12.7、文言規則(予選の勝利にWeekの決済期限、Week決勝の勝利にYearの決済期限)。
- **Selected Approach**: eventの`RESULT_NOTICE_SUPPLEMENTS`(`{ name, kinds, order, provider }`、名前と順を検証)。送り出しで勝敗結果の計画ごとに、マッチの種別に登録された提供元を順に呼び、`ResultNoticeSupplement`(見出し・1〜5行・任意の行動のボタン・強調)を受け取る。初版は空。提供元の例外は送り出しの段の再試行にする(期限の欠けたメールを送らない)。形式に合わない追記は捨てて`warn`のログを出す。
- **Rationale**: 決済期限と免除(Ultras)の判断をトーナメントのspecに残し、本specは表示の枠だけを持つ。

### Decision: 採らなかった案

- マッチイベントの処理の登録(予選・開催通知): 送り出しの時点の完全性を確かめられない(Architecture Pattern Evaluation)。
- 受信設定の変更のbot対策・レート制限: 要件に無く、ログイン中の本人の設定である。
- 配信停止ページのbot対策: ログイン不要の確認の操作だけ(FR-NOTIF-016)を求められ、トークンが推測できない。
- 送信履歴の画面・再送の操作: 要件に無い。
- 通知の言語の切り替え: UIの多言語化は要件定義書のスコープ外。

## Synthesis

- **Generalization**: 統合(FR-NOTIF-004)・集約(FR-NOTIF-009)・前日までの保持(仮1)・遅れた発行を、「送信枠とまとめのキーを持つ通知の記録」の1つに一般化した。予選とトーナメントの開始予告・結果を同じ記録に入れ、出どころ(照会からの収集・契約の発行)だけを分けた。決済期限などの種別ごとの案内を「結果の追記」の登録口に一般化した。
- **Build vs Adopt**: RFC 8058の仕組み、email-deliveryの送信・抑止・テンプレート・送信者情報の取得口、`KeyedHasher`(NFR-SECUR-006)、match-engine・user-profile-social・product-launch・identity-authの照会、admin-foundationの認可と監査ログ、ultras-subscriptionの区画の登録口、identity-authの`readFragmentToken`・設定ページのシェルを使う。送信枠の送り出し・受信設定・トークンの導出は既存の部品が無いため作る。新しいパッケージは無い。
- **Simplification**: 送信履歴の画面・メールごとのトークン・マッチイベントの処理の登録・新しいCronの式・新しいシークレット・リアルタイムの送信を持たない。朝の枠は0:00の開始の後の照会だけで集め、マッチイベントの到着を待たない。

## Risks & Mitigations

- トーナメントのジョブが`markReady`を呼ばない・発行を終えずに呼ぶ(障害・不具合) — 呼ばなければ23:55の期限で送り出して`evening-dispatch-incomplete`を報告し、発行が送り出しの後になれば統合せずに個別に送り(要件12.8)、ログに`late`の件数を出す。
- Email Sendingが`List-Unsubscribe`・`List-Unsubscribe-Post`をDKIMの署名の対象に含めないと、一括送信者のガイドラインのワンクリックとして扱われない — stagingで受信したメールの`DKIM-Signature`の`h=`を確かめ、含まれなければemail-delivery・開発者へ報告する(タスクの検証に含める)。
- 人気の作り手のフォロワーが多いと、朝の枠の収集が長くなり開催通知が遅れる — 1回の処理を2,000件で区切って`defer`で続け、収集の時間をログに出す。launch-readinessの性能の検証で確かめる。
- 送り出しの途中の障害で同じメールを2回送り得る — 1回の処理を20通に抑え、リースで同時の送り出しを防ぐ。
- 送信者情報が未設定のままリリースすると通知メールが届かない(仮3) — 管理画面の区画に未設定を表示し、エラートラッキングへ1時間に1回知らせ、launch-readinessの準備の確認項目に載せる(報告)。
- 特定電子メール法の同意を証する記録の保存(最後の送信から一定期間)が要件定義書に無い — 受信設定の行は最後に変更した日時を持つ。退会で消すため、法的な要否は開発者の確認が要る(要件定義書の改訂の候補として報告する)。
- 技術ドキュメントの番号の重なり — `backend/014`・`security/008`までは先行のspecが使い、`backend/015`はengagementが、`security/009`はlaunch-readinessが取るため、本specは`backend/016`・`security/010`にした。

## References

- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — 通知メールの件名・本文の構成・UTC表記・送信者情報の入力欄の上限
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 0:00・23:45の通知と同時刻の処理の順序
- `docs/GUIDES/service/design/002-page-layouts.md` — `/settings/notifications`・`/unsubscribe/{token}`・管理画面の設定
- `docs/GUIDES/service/legal/001-compliance-policy.md` — 通知メールのオプトアウト(LR-005)の対象と対象外
- `docs/GUIDES/service/features/001-user-data-export.md` — `account.json`の`notificationSettings`
- [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058) — ワンクリックの配信停止
- [RFC 2369](https://www.rfc-editor.org/rfc/rfc2369) — `List-Unsubscribe`ヘッダー
- [Gmail: Email sender guidelines](https://support.google.com/a/answer/81126) — ワンクリックの配信停止とDKIM
- [FTC: CAN-SPAM Act Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) — 配信停止の期限と住所の表示

## 確定した決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要した論点である。**いずれも2026-10-24に開発者が確定した。仮2は推奨と異なる(C)に、それ以外は推奨どおりに決まった。** `requirements.md`の「要件フェーズでの決定」にも同じ行がある。

| #   | 論点                             | 確定した案                                                                                                                                 | 他の選択肢                         | 影響する箇所                                                                                                                                                            |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | トーナメントの開始予告の時刻     | マッチ前日の23:45(組み合わせ決定が前でも保持)                                                                                              | 組み合わせ決定時 / 両方            | 要件3.2・3.3、`previewSlotFor`、文言規則・日次タイムライン                                                                                                              |
| 仮2 | 23:45の送り出しの順              | (C、推奨と異なる)トーナメントの23:45のジョブが最後に`EveningDispatchGate.markReady`を呼び、全ての前提がそろった時点で送り出す。期限は23:55 | 5分の遅延(推奨だった) / 帯の外の値 | 要件13.1・13.7〜13.9・15.2、`EveningDispatchGate`・`EVENING_DISPATCH_PARTICIPANTS`・`notification_slot_readiness`・`notifications.evening-dispatch`・`FlushSlotHandler` |
| 仮3 | 送信者情報の未設定               | 通知メールを送らず検知させる                                                                                                               | 省いて送る                         | 要件7.6・11.2、`NoticeDispatcher`・送信者情報の区画                                                                                                                     |
| 仮4 | 統合したメールのワンクリック     | 勝敗結果の種別だけを止める                                                                                                                 | 両方を止める                       | 要件8.6・9.1、`NoticeEmailBuilder`                                                                                                                                      |
| 仮5 | 配信停止のURLの形                | 本文は`/unsubscribe#token=`、ヘッダーは`/unsubscribe?token=`                                                                               | パスに含める                       | 要件9.7、配信停止ページ・ワンクリックの経路・ページ配置                                                                                                                 |
| 仮6 | 不戦勝の開始予告                 | 送らない                                                                                                                                   | 不戦勝になる旨を送る               | 要件3.5、`matchNoticeDrafts`・`planGroupEmail`                                                                                                                          |
| 仮7 | 自分のプロダクトが非公開化・削除 | 開始予告と勝敗結果を送らない                                                                                                               | 勝敗結果は送る                     | 要件7.7、`NoticeDispatcher`                                                                                                                                             |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID       | 内容                                                                                              | 根拠          |
| ------------ | ------------------------------------------------------------------------------------------------- | ------------- |
| FR-NOTIF-001 | 組み合わせ決定がマッチ前日より前の場合も前日の23:45に送る旨、対戦相手のいないマッチには送らない旨 | 仮1・仮6      |
| FR-NOTIF-010 | 送信者情報が未設定の間は通知メールを送らない旨                                                    | 仮3           |
| FR-NOTIF-012 | 統合したメールのワンクリックの配信停止は勝敗結果の通知種別を対象とする旨                          | 仮4           |
| FR-NOTIF-004 | 自分のプロダクトが非公開化・論理削除されている場合は送らない旨                                    | 仮7           |
| FR-NOTIF-008 | 受信設定の同意の記録(最後の変更の日時)の保存期間(特定電子メール法の同意を証する記録)              | Risks(要確認) |

## 上流・後続specへの影響

- email-delivery(上流): 登録箇所への追記と契約どおりの差し替えだけ。`core/email/kinds/index.ts`に4種別、eventの`templates/index.ts`に4テンプレート、eventの`composition/email-registrations.ts`の`EMAIL_SENDER_INFO_PROVIDER`を`D1SenderInfoProvider`へ書き換える。
- identity-auth(上流): `USER_LIFECYCLE_SYNC_HANDLERS`に`notifications.account-withdrawal`(`withdrawn`)、`USER_LIFECYCLE_ASYNC_HANDLERS`に`notifications.account-purge`(`purge_due`、1300)、clientの`SETTINGS_NAV_ITEMS`に`{ to: '/settings/notifications', label: '通知', order: 40 }`。`readFragmentToken`・`AccountGuard`・`UserContactDirectory`・`verifiedUsers()`を契約どおりに使う。
- ultras-subscription(上流): adminの`ADMIN_SETTINGS_SECTIONS`に`{ id: 'notifications.sender-info', order: 30, component: SenderInfoSection }`(予約どおり)。
- admin-foundation(上流): `apps/common-lib/admin/audit-actions/notifications.ts`(`notification-sender.update`、対象`setting`・理由`optional`・詳細`fields`)と`index.ts`の連結。
- backend-platform(上流): apiの`scheduled-jobs.ts`に3つのジョブ、`core/messaging/contracts/index.ts`に2つのメッセージ種別、eventの`message-handlers.ts`に2つの処理、eventの`rate-limit-exclusions.ts`に`excludePath('/unsubscribe', 'POST')`、eventの`wrangler.jsonc`の3環境の`vars`と環境の検証に`EVENT_SITE_ORIGIN`。
- api-gateway(上流): `graphql-modules.ts`に`notificationsSchemaModule`、client・adminの許可リストの再生成。
- infra-delivery(上流、改訂1として提供): 「ホスト名から導かれる変数の値」の表に`EVENT_SITE_ORIGIN`(event、notifications)の3環境の値の行が入る。本specはその値をeventのWrangler設定に書き、infra-deliveryの文書を編集しない。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は1300、波及処理は1300」になる(23:45・0:00のジョブも1300)。Requirement Ambiguitiesの「トーナメントの開始予告メールを組み合わせ決定時とマッチ前日のどちらで送るか」の行の解決の列は「notifications 仮1(マッチ前日の23:45に送り、組み合わせ決定がそれより前でも前日の23:45まで送らずに保持する、2026-10-24に開発者が確定)」。本specはroadmapを編集しないため、コントローラーへ報告する。
- tournament-week(後続): `NotificationEventPublisher.publish({ publisher: 'tournament-week', events, at })`で、1回戦と次のラウンドの`match_preview`、各マッチの`match_result`、優勝の`award`(`product_of_the_week`、期間`2026-W37`の形)を発行する。統合を望む結果と翌日の予告は、その夜の`EveningDispatchGate.markReady`の呼び出しより前に発行する。apiの`EVENING_DISPATCH_PARTICIPANTS`に`tournament-week.evening-bracket`を登録し、毎日の23:45のジョブ(1500番台)の最後に、組み合わせ・ラウンドの進行(未処理の確定があれば追いつく)・通知イベントの発行を終えた後で、`markReady({ participant: 'tournament-week.evening-bracket', date: context.business.date, at })`を呼ぶ(処理が無い日も呼ぶ。失敗時は呼ばずに例外を投げる)。予選の勝利の結果通知のWeekの決済期限と参加の導線(Ultras加入者は免除の表示)は、`RESULT_NOTICE_SUPPLEMENTS`に種別`qualifier`で登録する(`order`は1500番台)。発行は冪等で、再試行される処理から呼んでよい。
- tournament-year(後続): tournament-weekと同じ形で発行する(受賞は`product_of_the_year`、期間`2026`)。`EVENING_DISPATCH_PARTICIPANTS`に`tournament-year.evening-bracket`を登録し、毎日の23:45のジョブ(1700番台)の最後に同じ規則で`markReady`を呼ぶ。1回戦の予告は組み合わせ決定の時点で発行してよく、本specが前日まで保持する(仮1)。Week決勝の勝利の結果通知のYearの決済期限は、`RESULT_NOTICE_SUPPLEMENTS`に種別`week`で登録し、提供元が決勝の勝利のときだけ追記を返す(`order`は1700番台)。
- data-export(後続): `NotificationSettingsExport.find(userId)`(`NOTIFICATIONS_PLATFORM_TYPES.NotificationSettingsExport`)で`account.json`の`notificationSettings`を作り、本specのテーブルを直接読まない。
- launch-readiness(後続): prodの送信者情報の設定(仮3)、prodの`EVENT_SITE_ORIGIN`、受信したメールのDKIMの署名の対象の確認を、リリースの準備の確認項目に載せる。

## 設計のレビュー(2026-10-24)

- 機械的な確認: 要件の100件の受け入れ基準の番号がすべて追跡表にあり、追跡表に要件に無い番号が無いことを、追跡表の1列目を展開した集合と要件の番号の集合の比較で確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、(1)送信者情報のユースケースが`GraphQLContext`を受け取り`requireAdmin`(presentation)と`AdminDirectory`(`lib/workers`)を使っていた(認可とニックネームの照会をリゾルバへ移し、ユースケースは管理者IDを引数で受け取る形に直した)、(2)ジョブと受賞の展開の処理が`MessagePublisher`(`lib/workers`)を直接使う前提だった(`core/notifications`のポート`NotificationWorkRequester`と`workers`の実装を加えた)、(3)送信の段が使う`SupplementSource`と保守の`NotificationMaintenanceStore`の型が無かった(ポートの型を加えた)、(4)送信枠のリースが`defer`の後の同じ封筒で取り直せなかった(保持者が同じなら取れる条件にした)、(5)物理削除の処理が受信設定と種の残りを消す口が無かった(`deleteAllOf`を加えた)、(6)前日・翌日の業務日付の求め方が上流に無い関数名だった(`fromBusinessDateTime`・`toBusinessDateTime`と24時間の加減と明記した)、を直した。2回目で問題は無かった。
- 境界の確認: 送信・抑止・描画はemail-deliveryの口を使うだけで、`email_suppressions`へ書き込まない。上流のテーブル(`users`・`user_follows`・`matches`・`products`)へ書き込まず、`users`は`verifiedUsers()`の条件と外部キーにだけ使う。通知イベントを発行する判断と決済期限はトーナメントのspecに残し、本specは契約と登録口だけを持つ。

## タスクの計画の検証(2026-10-24)

> この節のタスクの番号は、この時点の番号である。その後の2回の番号の振り直し(コーディネーターの指示による再実行と、仮2の確定の反映)により、現在の`tasks.md`では次の番号に当たる: 3.6(異常の通知と共有の束縛)→3.7、5.4(結果の追記の登録口)→5.5、5.5(送信)→5.6、5.2(テンプレート)→5.2(開始予告と勝敗結果)と5.3(開催通知と受賞結果・登録)、4.8(管理者側の送信者情報の操作、`_Depends: 4.3, 4.7_`)→4.9(`_Depends: 4.3, 4.8_`)。2.1・2.2・2.3・4.5・6.1〜6.3は変わらない。

- タスクの計画のレビュー(要件の100件の番号の網羅・設計のコンポーネントの網羅・実行可能性)を行い、通った。
- タスクのグラフのサニティレビューを2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
- 1回目の判定はNEEDS_FIXES(必須3件・軽微6件)だった。指摘と対応は次のとおり。
  - 必須(1): apiの4:21の保守が報告に使う異常の通知のポートと実装がeventにしか無かった。ポートを`core/notifications/ports.ts`へ、Sentryの実装を`workers/notifications`へ移し、3.6で両アプリに束縛するよう、設計とタスクを直した。
  - 必須(2): 6.2と6.3が文言のファイルと操作・許可リストを並行して変え得た。操作・型・許可リスト・文言を6.1で確定させ、6.2の(P)を外した。
  - 必須(3): 送信のタスクが3時間を超えていた。結果の追記の登録口(5.4)と送信(5.5)に分け、異常の通知は3.6へ移した。
  - 軽微: 保守のストアの切り出し(4.5)、送信枠と文言の分割(2.1・2.3)、抑止の理由の写像の共有(`suppressionReasonOf`)、3.6の要件の追加、E2Eの`HASH_PEPPER`の注入の確認、5.2の1.2への依存の6件も、すべて直した。
- 2回目の判定はNEEDS_FIXES(必須1件・軽微2件)だった。指摘と対応は次のとおり。
  - 必須: 文言の規則(当時の2.2 (P))が、後の契約のタスクで作る賞の種類の型に依存していた。契約(2.2)の後へ文言(2.3)を移し、(P)を外した。
  - 軽微: ルートツリーの生成のファイルが6.2・6.3の両方で変わる旨の注記と、4.8の`_Depends: 4.3, 4.7_`を加えた。
- kiro-spec-tasksの規則に従い、3回目のレビューは行っていない。この規則では、2回目の判定がPASSでなければ、それ以上レビューを繰り返さずに止める。
  - `tasks.md`は、2回目の指摘を直した下書きである。
  - タスクの承認(`approvals.tasks`)は行っていない。要件と設計の承認は、`-y`の手順1で記録した。
  - `/kiro-spec-tasks notifications -y`を、既存の`tasks.md`を引き継ぐ形で再実行すれば、サニティレビューがPASSになったときに承認される(match-engineと同じ扱い)。

## タスクの計画の再検証(2026-10-24、コーディネーターの指示による再実行)

- `/kiro-spec-tasks notifications -y`を、修正済みの`tasks.md`を既存の下書きとして引き継ぐ形で再実行した。新しいサブエージェントによる独立した確認(independent)を、通常の2回の上限で行った。
- 1回目の判定はNEEDS_FIXES(必須2件・軽微4件)だった。
  - 必須: (1)2.4でメール種別だけを集約点へ加えると、テンプレートの登録(当時の5.2)までの間、テンプレートの集約点の1対1の検査が失敗する。2.4は種別の定義だけにし、種別とテンプレートの登録を同じタスク(5.3)で行うよう直した。(2)4.6のテストが23:44:59の予定時刻で前日の枠を開くとしており、設計(予定時刻の業務日付の枠)と食い違っていた。同じ業務日付の枠で遅延が301秒になる形へ直した。
  - 軽微: `application`のポートの定義のファイルを作るタスク(api 4.1・event 5.4)の明記、テンプレートの分割(5.2・5.3)、発行と受賞の展開の分割(3.4・3.5)、収集の`_Depends`の修正の4件も直した。番号の振り直し(共有部品3.1〜3.7、event 5.1〜5.10)に合わせて`_Depends`を更新した。
- 2回目の判定はPASSだった。軽微2件のうち、3.5に「3.4の展開の部品に受賞の分岐を加える」旨の注記を加え、5.2の`_Depends: 5.1_`は無害のため残した。タスクを承認した。

## cross-spec reviewの指摘による修正(2026-10-24)

- 振る舞いを変えない整合の修正のため、改訂の番号は付けない(cross-spec reviewの指摘による)。
  - 技術ドキュメントの番号の説明を、`backend/015`はengagement、`security/009`はlaunch-readinessが取る旨に直した(本specの`backend/016`・`security/010`は変えない)。
  - eventの`EVENT_SITE_ORIGIN`の3環境の値の行は、infra-deliveryの改訂1が「ホスト名から導かれる変数の値」の表に加える旨にdesign.md・research.mdを改め、tasks.mdの1.1の前提と5.1に値の出典を加え、9.2の作業の報告から表への行の追加の依頼を除いた。
  - E2E・統合テストで定期実行をローカルで起動する手順が無いことを確かめた(共有の補助`triggerScheduled`への置き換えの対象は無い)。
- 変更したタスクの部分を、新しいサブエージェントによる独立した確認(kiro-spec-tasksの基準)で検証し、1回目の判定はPASSだった。タスクの承認を保つ。

## 決定の確定の反映(2026-10-24)

- 開発者の回答により、仮1・仮3〜仮7を推奨どおりに、仮2をC(推奨と異なる)に確定した。仮2の反映として、要件13.1を書き換えて13.7〜13.9を加え、15.2の境界を23:54と23:55にした。設計に夜の枠の送り出しの入口(`EveningDispatchGate`・`EveningSlotOpener`)・前提の登録口(`EVENING_DISPATCH_PARTICIPANTS`)・テーブル`notification_slot_readiness`・期限(23:55)を加え、5分の遅延を取り除いた。タスクに4.6(入口と登録口)を加え、旧4.6〜4.8を4.7〜4.9にした。
- 設計のレビューの関門(変更した部分)を本文の中で行い、追跡表の103件の網羅、境界の節、ファイル構成の網羅を確かめて通った。
- タスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で2回行った。1回目はNEEDS_FIXES(必須1件・軽微4件)だった。必須は、通知の記録が先に作った夜の枠に前提の一覧が写されず、その夜の`open`が前提を空とみなして直ちに送り出すおそれだった。一覧を未確定(NULL)のときだけ書き込む`fixParticipants`を加えて直した。軽微(期限の遅延の求め方の統一・検証の担当の重複・識別子の置き場所・3.7の要件13.8)もすべて直した。2回目はPASSで、軽微2件(状態の図の文言、未確定の一覧の未完了の名前の照会がnullを返すこと)も直した。

## email-deliveryの実装の反映(2026-10-27、開発者の決定)

- email-deliveryの実装(タスク5.6の開発者の決定)で、テンプレートの配信停止の口が`unsubscribeUrl`から`unsubscribeLinks?(input)`(`{ url: string; label?: string }`の並び)に変わった。リンクが1つならラベルを省くと既定の文言「この通知を配信停止」で表示し、2つ以上ならすべてのリンクにラベルが要る(型と描画時の両方で検出)。区画は通知メールの種別にだけ、宛名・本文・行動ボタン・配信停止・送信者情報の順で置かれる(`apps/event/src/infrastructure/email/rendering/email-template.ts`・`email-unsubscribe-links.tsx`)。開発者の決定で、本specの設計をこの口に合わせた。
- 理由: 統合したメール(FR-NOTIF-013・FR-NOTIF-016、要件9.1・仮4)の2つの配信停止のリンクを、本文の部品で描かずにemail-deliveryの配信停止の区画へ渡すため。本文に描くと、区画と本文に配信停止のリンクが分かれ、文言規則の本文構成(配信停止のリンクは行動ボタンと送信者情報の間)と食い違う。
- 文言: 1つのときはemail-deliveryの既定の文言「この通知を配信停止」を使い、統合したメールは既定の文言の「この」を通知設定ページの種別の名称に置き換えた「勝敗結果の通知を配信停止」「マッチ開始予告の通知を配信停止」とした(`NoticeCopy`の`COMBINED_UNSUBSCRIBE_LABELS`)。design.mdの「Supporting References」の「通知メールの文(文言規則に追加)」の「全種別の末尾」の行の「この種類の通知メールの配信を停止する」「開始予告の配信を停止する」も同じ文言に改めた。
- `EMAIL_SENDER_INFO_PROVIDER`: 実装は`Newable<SenderInfoProvider>`で`.to()`で束縛する。設計の`D1SenderInfoProvider`はもともとクラスで食い違わないが、ファクトリにしないこととコンストラクタ引数の注入(`@injectable()`と`@inject(NOTIFICATIONS_PLATFORM_TYPES.SenderInfoStore)`)を明記した(email-deliveryの6.3の`USER_ADDRESS_DIRECTORY`と同じ扱い)。
- 変えた箇所: design.mdの`NoticeCopy`(`COMBINED_UNSUBSCRIBE_LABELS`)、`NoticeEmail`の全種別の入力の説明、`NotificationEmailKinds`の`NoticeLinks.unsubscribeUrl`と`MatchResultEmailInput.next.unsubscribeUrl`の注記、「NotificationTemplates・ResultNoticeSupplements」(`unsubscribeUrl`を`unsubscribeLinks`へ、本文の部品`NoticeFooterLinks`を通知設定のリンクだけを描く`NoticeSettingsLink`へ)、「D1SenderInfoProvider」の束縛、File Structure Planの`notice-settings-link.tsx`、追跡表の7.10・7.11と9.1、コンポーネントの表、Testing Strategyの`notice-copy`とeventのテンプレート、「Supporting References」の「全種別の末尾」の行。本書の上流specの契約のemail-deliveryの行。メール種別の入力の項目(`unsubscribeUrl`)は配信停止のURLのデータとして残した。要件は変えていない。tasks.mdの5.2の「通知設定・追加の配信停止のリンクの部品」は、本改訂では変えていない(通知設定のリンクの部品だけを作り、2つ目の配信停止のリンクは`unsubscribeLinks`で返す)。
