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

## frontend-platformの実装で確定した契約の反映(2026-10-28、開発者の判断)

- frontend-platformが実装で確定した契約(同specのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に、開発者の判断(下流specの設計を今回改訂する)で本specの設計を合わせた。
- GraphQLの操作: 操作を各アプリの`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名を利用者側は`Client`、管理者側は`Admin`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む。`graphql()`を呼んで`.ts`のファイルに操作を書くと、操作の本文がブラウザのバンドルに残るため(frontend-platformの要件6.3)。tasks.mdの操作のタスクに、各アプリの`graphql:generate`とapiの`graphql:allowlist`の手順を書いた。
- フォーム: `useAppForm<TInput, TOutput>(schema, { defaultValues })`(`defaultValues`は全欄)と、必須の`onSubmitError`・任意の`serverFieldPrefix`(`input`を取るmutationは`"input"`)を受ける`AppForm`の形にした。画面側のスキーマの`zod`の値は`utilities/validation/zod.ts`から読む(CSPの下で`new Function`の試行を止める`jitless`の設定を済ませた`z`)。
- 失敗の文言: `GraphQLClientError`でない例外に代えて画面に出す文言を`errorMessageOf(error, <プロファイル>.contactAvailable)`で選ぶ。管理者側には問い合わせの画面が無いため、`ErrorState`・`UnexpectedErrorView`に`contactHref`を渡さず、問い合わせの導線と問い合わせを促す文を出さない(frontend-platformの要件8.6・8.13)。
- 通知メールの件名(開発者の判断10): 件名から日付を基準にした相対表現(「明日は準決勝」「本日キックオフ」)を除いた。統合は「フルタイム: Pitch NotesがTactics Boardに勝利、次は準決勝」、不戦勝の統合は「フルタイム: Pitch Notesは不戦勝、次は準決勝」、開催通知は「Pitch Notesがキックオフします⚽️応援しましょう！」と「フォローしているユーザーの3プロダクトがキックオフします⚽️応援しましょう！」。判断10は件名に限るため、統合の本文の「明日は<ラウンド名>です。」と開始予告の本文の「明日、…」は変えていない。件名(`matchResultSubject`の`nextRoundName`)と本文が共有するのは`roundName`の結果(ラウンド名)だけで、「明日は」の部分は共有しない。
- requirements.mdの4.4・5.2・5.3の件名を改めた(番号は変えていない)。文言規則(`docs/GUIDES/service/design/003-text-and-copy-rules.md`)の件名の例はfrontend-platformのタスク10.3が直す。
- 変えた箇所: design.mdのAllowed Dependencies、File Structure Planの両アプリの`graphql/operations/notifications/`、`SenderInfoViolation`の注記、`NoticeCopy`(`nextRoundName`の注記と件名の規則)、`NotificationTopicSwitch`・`SenderInfoForm`(`ConfirmActionDialog`の`failureMessageOf`と確定の失敗の表示)・`SenderInfoSection`、Error Strategy、Supporting Referencesの「通知メールの文」の統合と開催通知の行。tasks.mdの2.3・6.1・6.2・7.1。

## フォームの描かない値と無効の欄の扱いの反映(2026-10-28、開発者の判断)

- **状態**: frontend-platformの最終検証の後の第2回の判断16・25〜28・30〜36(2026-10-28〜29)を、frontend-platformのタスク11.8として本specの設計とタスクへ反映した。受け入れ基準は変えていない。
- **Context**: frontend-platformの`SubmitButton`は、`root`以外の欄のエラー(サーバーの欄のエラーを含む)が1つでも残る間は無効になる。入力欄を描かない値をフォームのスキーマの入力に含めると、その値へのサーバーの詳細が利用者の直せない欄のエラーになり、送信ボタンが無効のまま残る。`applyServerFieldErrors`は、欄をまとめた値(配列でないオブジェクト)の経路と、`FormField`の`disabled`で無効にした欄の詳細を欄に付けず`onSubmitError`の`unmatched`へ渡し、`useAppForm`は検証の前に無効の欄の値を除く。無効の欄の値は`onSubmit`へ渡す値から外れ、無効になり得る欄はスキーマで任意(`.optional()`)にする。`FormField`は後から無効にした欄のエラーを消し、`useAppForm`は渡されたスキーマが変わると検証し直し、`applyServerFieldErrors`は描かれていない欄の詳細もフォーム全体の失敗にする。全欄が無効のフォームは`SubmitButton`の`disabled`で送信ボタンを無効にする。
- **決定**: `SenderInfoForm`のスキーマの入力は描く3項目だけで、版の値の`expectedVersion`と確認のダイアログで受ける`reason`はスキーマの入力に含めず、`onSubmit`(確認のダイアログの確定)で足すことを確かめ、設計に明記した(判断26の確認)。
- **変えた箇所**: design.mdの`SenderInfoForm`、tasks.mdの7.1のブラウザテスト。

## 実装済みの上流との食い違いの水平展開(2026-10-30、開発者の指示)

- **Sentryの定型の通知**: content-processingの差分の分析(G-4)で、backend-platformの改訂7と技術ドキュメント`infra/004`の「同じ文言を繰り返し送る通知」が、定型の文言で繰り返し起こり得る出来事を`captureMessage`ではなく`captureEvent`で送り、文言を`logentry`、まとめる単位を`fingerprint`に置くと定めていることを確かめた。`captureMessage`は既定の`dedupeIntegration`により、同じ文言の2件目以降が捨てられる。本specの`captureMessage`をすべて`captureEvent`に改め、規約の参照と通知のタグの記述に`logentry`と`fingerprint`の置き方を加えた。通知の種類・タグ・レベルは変えていない。
- 要件と受け入れ基準は変えていない。

## 層の規則に合わせた契約の置き場所の改訂(2026-11-02、開発者の指示)

- **規則**: [層構成の依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析)により、api・eventの`src/application/**`・`src/domain/**`は`**/lib/workers/**`を型も含めて読み込めない。application層が受け取る契約と識別子は`apps/backend-lib/core/<ドメイン>`に置き、`workers`には実装と束縛だけを置く。識別子は`Symbol.for('<ドメイン>.<名前>')`の凍結したオブジェクトにし、単体テストで値と凍結を確かめる。
- **確かめた結果**: 本specの共有部品の契約と`NOTIFICATIONS_PLATFORM_TYPES`は既に`core/notifications`にあり、置き場所は規則に合っていた。
- **変えた箇所**: design.mdのFile Structure Planの`identifiers.ts`(「テストなし」を改め`identifiers.unit.test.ts`を置く)、`backend-lib/workers`の節の冒頭(契約は`core/notifications`、ここは実装と束縛だけである旨)、`NotificationSettingsExport`のコードの置き場所のコメント(`core/notifications/ports.ts`)、`NOTIFICATIONS_PLATFORM_MODULE`の識別子の説明、Testing Strategy(識別子の単体テスト)。tasks.mdの2.2(契約と識別子の置き場所と識別子の単体テスト)。
- 要件と受け入れ基準は変えていない。タスクの番号は変えていない。

## 上流のultras-subscriptionの区画の登録口の改訂の反映(2026-11-06)

- ultras-subscriptionの実装前のギャップ分析への開発者の決定で、管理画面の設定ページの区画の登録口`ADMIN_SETTINGS_SECTIONS`の形が、adminの前例に合わせて`id`(`'<spec名>.<名詞句>'`。`CATEGORY_SECTIONS`・`DASHBOARD_CARDS`の前例)・`order`・`title`(区画の見出し。`CATEGORY_SECTIONS`の前例)・`component`になった。ページは区画ごとにfrontend-libへ移した`RecoverableSlot`で包み、1つの区画の描画や取得の失敗をその区画の位置に留め、読み込み中と失敗の間は`title`の見出しを補う。
- 本specの登録に、部品が描く見出しと同じ文言の`title`を加えた(design.mdの登録の行、tasks.mdの登録のタスク)。要件と受け入れ基準は変えていない。タスクの番号は変えていない。

---

## 実装前のギャップ分析(2026-11-14、`/cc-sdd:kiro-validate-gap`)

### 分析の前提と方法

- **状態**: 要件・設計・タスクは承認済みで、タスクは49件すべて未着手である(`ready_for_implementation`は`false`)。上流のspecは、infra-deliveryの2件とpaymentsの4件(どちらも手動の作業)を除いて実装を終えている。本specの設計は、上流の大半の実装より前に書かれた。
- **方法**: 設計が「既にある」と前提にする上流の型・関数・ファイル・登録箇所・文書を、4つの領域に分けて実際のコードと突き合わせた。領域は、eventの上流の契約(email-delivery・match-engine・user-profile-social・product-launch)、api・eventのバックエンド基盤(backend-platform・api-gateway・identity-auth・admin-foundation)、clientとadminとE2E、DBとcommon-libと文書である。影響の大きい指摘はコードを直接読んで確かめ直した。対象は送信者情報の描画、`buildPageHead`の入力、`Referrer-Policy`の上書き、確認のダイアログのフォーム、送信者情報の保存の前例、壊れるテストの行である。本specが新しく作るものが無いことは前提どおりのため、ギャップとして数えない。
- **結論の要約**: 上流の契約の名前・置き場所・形は、ほぼ設計どおりに存在する。登録口の`order`(設定のナビゲーションの40、管理画面の設定ページの区画の30)、roadmapの帯の割り当て(4:21と波及処理の1300)、`EVENT_SITE_ORIGIN`の3環境の値(infra-delivery)、技術ドキュメントの番号`backend/016`・`security/010`は、どれも予約されているか空いている。食い違いは次の4種に分かれる。
  - (1)書いたとおりには型検査や実装が通らない設計が5点(G-1〜G-5)。
  - (2)上流の口や規約・前例との細かな不一致が17点(G-6〜G-22)。
  - (3)設計が挙動を定めていない箇所が6点(G-23〜G-28)。
  - (4)既存の「一覧を完全一致で確かめるテスト」と、一覧を記した文書が本specの追加で壊れるのに、Modified Filesに無いものが多数ある。

### 要件と資産の対応

| 要件                        | 使う上流の資産(実在を確認)                                                                                                                                                                                                                                                                                   | ギャップ                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 1(受信設定・通知設定ページ) | `SETTINGS_NAV_ITEMS`(`apps/client/src/composition/settings-navigation.ts`、40は予約済み)・`_authenticated`の`requireViewer`・`viewerQueryOptions`・`SuspendedAccountNotice`・`AccountGuard`(`currentUser`・`requireWritableUser`)・`verifiedUsers()`・shadcn/uiの`switch`(前例`auto-refresh-switch.tsx`)     | Missing: 本specの全部品。Constraint: G-1・G-7・G-8・G-9                                                    |
| 2(抑止による除外の表示)     | `UserContactDirectory.findContact`・`SuppressionList.getStatus`・`SuppressionReason`(`hard_bounce`・`complaint`・`rejected`)                                                                                                                                                                                 | Constraint: G-10(照合キー)                                                                                 |
| 3〜5(予告・結果・開催)      | `MatchDirectory`(`findMatches(ids, now)`・`listForDate({ date, kinds, now })`)・`MatchRecord`の全項目・`FollowerDirectory.listVisibleFollowerIds`(`limit`は1〜500)・`ProductDirectory.findSummaries`・`UserProfileDirectory.findSummaries`、match-engineのジョブの1100                                       | Constraint: G-6(`now`)・G-11(挿入の行数)。Unknown: G-23〜G-25                                              |
| 6(受賞)                     | 同上・`businessWeekOf`                                                                                                                                                                                                                                                                                       | Missing: 発行の実装(tournament-week・tournament-year)                                                      |
| 7(送信の共通規則)           | `EmailSender.send`(`deadline?`あり)・`EMAIL_KINDS`・`EMAIL_TEMPLATES`・`defineEmailTemplate`(`unsubscribeLinks`)・`ALLOWED_EXTRA_HEADERS`・`EMAIL_SENDER_INFO_PROVIDER`(既定は`UnsetSenderInfoProvider`)・`linkUrlSchema`                                                                                    | Constraint: G-26(送信者情報は全種別に載る)。Unknown: G-23(二重送信)・G-24(`deadline`)                      |
| 8〜10(配信停止・トークン)   | `KeyedHasher`・`hashPurpose`(HMAC-SHA512のbase64urlは86文字)・`excludePath`・`readFragmentToken`と`useFragmentToken`・アクセスログ(`c.req.path`でクエリを含まない)・Sentryの`urlQueryParams: false`                                                                                                          | Constraint: G-4(`Referrer-Policy`)・G-7(`useFragmentToken`)・G-20(応答の形)。Unknown: G-27(ペッパーの変更) |
| 11(送信者情報の設定)        | `ADMIN_SETTINGS_SECTIONS`(30は予約済み、`title`は必須)・`RecoverableSlot`・`hasRole(useAdminRole(), 'super_admin')`・`ConfirmActionDialog`・`requireAdmin`・`AuditLogRecorder`・`buildAuditLogStatements(db, audit, guard)`・`isAuditGuardRejection`・`AdminDirectory.findProfiles`・`targetKind: 'setting'` | Constraint: G-2・G-3・G-5・G-13・G-14・G-21                                                                |
| 12・13(通知イベント・時刻)  | `ScheduledJobDefinition`・Cronの`0 8`・`45 7`・`21 12`(登録済み)・同じ時刻の`order`順の直列の実行(前のジョブが失敗しても続く)・`defineMessageContract`・`RetryPolicy`(上限6回)・`defer`(同じ封筒IDで試行回数を数えない、遅延の上限43200秒)・時刻ごとの所要時間の予算300秒                                    | Unknown: G-25(上流のジョブの失敗)                                                                          |
| 14(ライフサイクル・出力)    | `UserLifecycleSyncHandler`(`statementsFor(event, db)`)・`createAsyncLifecycleRegistry`・`LIFECYCLE_CONTINUE_DELAY_SECONDS`(5)・`purge_due`の1300は空き・data-exportの`notificationSettings`の5項目(設計と一致)                                                                                               | Constraint: 壊れるテスト(`purge_due`の一覧の3件)                                                           |
| 15(文書とテスト)            | 技術ドキュメントの番号(`backend/016`・`security/010`は空き、他specの予約と衝突しない)・`e2e/support/mailpit.ts`・`admin-bootstrap.ts`・`local-d1.ts`・`e2e/client/profile-steps.ts`の`registerVerifiedAccount`                                                                                               | Constraint: G-22(E2Eの手順のファイル)・Modified Filesに無い文書                                            |

### 書いたとおりには通らない設計(G-1〜G-5)

- **G-1 ページの`head`**(design.md 1686・1693行、タスク6.2・6.3)
  - 設計: `buildPageHead({ title, noIndex: true })`。
  - 実際: `PageHeadInput`は`siteName`が必須である(`apps/frontend-lib/start/page-head.ts:8-14`)。clientのページは`buildSitePageHead`(`apps/client/src/head/page-heads.ts`)を使う。前例は`settings/follows.tsx`・`auth/verify-email.tsx`。
  - 直し方: `buildSitePageHead({ title, noIndex: true })`に改める。選択肢は無い。
- **G-2 送信者情報のフォームと確認のダイアログ**(design.md 1702行、タスク7.1、要件11.4・11.7)
  - 設計: `SenderInfoForm`の`AppForm`(`serverFieldPrefix="input"`)の`onSubmit`を確認のダイアログの確定とする。そこで`expectedVersion`と`reason`を足して送り、`validation_error`を`applyServerFieldErrors`で欄に示す。
  - 実際: `ConfirmActionDialog`は自分の`AppForm`を持つ(`apps/frontend-lib/components/admin/confirm-action-dialog.tsx:96-147`)。送信のイベントが入力欄のフォームへ伝わらないよう、ダイアログはフォームの外に置く決まりである(`apps/admin/src/components/legal/legal-draft-form.tsx:232`のコメント)。ダイアログの`onConfirm`で保存すると、入力欄の`AppForm`が欄にエラーを付ける処理を通らない。`applyServerFieldErrors`を外から呼ぶと、`AppForm`の内部の欄の状態に頼ることになる。
  - 選択肢:
    - (a)入力欄の`AppForm`の`onSubmit`がダイアログを開き、確定か取り消しまでPromiseで待つ。`AppForm`の欄のエラーの処理をそのまま使える。
    - (b)欄の詳細はダイアログの`failureMessageOf`の文言だけで示し、欄には付けない。画面とサーバーの規則が同じなら、サーバーの欄のエラーは改ざんされた要求の場合に限られる。
    - (c)frontend-libに公開の補助を足す(上流の変更になる)。
  - 機能フラグの区画(`apps/admin/src/components/ultras/promotion-setting-section.tsx`)は欄の入力を持たないため、この問題の前例にならない。
- **G-3 送信者情報の保存の文と初回の挿入**(design.md 1508行、タスク4系、要件11.6・11.7)
  - 設計: (1)設定の行の挿入か、版を条件にした更新(`CASE`式で取り消す)。(2)`buildAuditLogStatements(audit)`。「ultras-subscriptionの機能フラグと同じ形」としている。
  - 実際の前例(`apps/api/src/infrastructure/ultras/d1-promotion-setting-writer.ts:52-77`):
    - `buildAuditLogStatements(db, audit, { kind: 'condition', condition: rowExists(matches) })`を**先に**置き、続けて`UPDATE`を行う。`CASE`式による取り消しは、`buildAuditLogStatements`の中で監査ログの操作者のIDに掛かる。
    - 拒否は`isAuditGuardRejection`で見分ける。
    - 行はシードのマイグレーションで作られており(`apps/db/migrations/20261106115514_ultras_subscription_seed`)、更新しか行わない。
  - 本specは行の無い状態から挿入し、`version >= 1`のCHECKを持つ。次の3点が定まっていない。
    - 初回の挿入の条件。
    - 2人が同時に初回の保存をしたときに、一意の違反ではなく`version_conflict`になる文の順序。
    - 未設定のときに監査ログの`targetIds`へ入れる`settingId`の採番元(design.md 1484行)。
  - 選択肢:
    - (A)前例と同じくシードで行を作り、更新だけにする。3項目をNULL可にし、版0を未設定とする。
    - (B)行を作らず、監査ログの条件を「版0なら行が無い、版1以上なら版が一致する」とする。`settingId`は固定の値(`setting_key`の`'sender-info'`)にする。
- **G-4 `Referrer-Policy: no-referrer`が上書きされる**(design.md 1666・1812行、タスク5系、要件9.7)
  - 設計: ワンクリックの経路の応答に`Referrer-Policy: no-referrer`を付ける。
  - 実際: 全体の処理の`setSecurityHeaders`が、`headers.set('Referrer-Policy', 'same-origin')`で常に上書きする(`apps/backend-lib/workers/http/security-headers.ts:5,36-39`)。Workerを丸ごと通すテストは失敗し、Honoのアプリ単体のテストでは本番との違いを見逃す。
  - clientのページも全て`same-origin`で、ルートごとに変える仕組みは無い。Refererにフラグメントは含まれず、eventのGETは303の移動だけである。そのため、`same-origin`でもトークンは外部のオリジンへ送られない。
  - 選択肢:
    - (a)`same-origin`で要件9.7を満たすとして、設計の`no-referrer`の記述を消す。
    - (b)上流の`setSecurityHeaders`を、経路が付けた値を残す形に変える(backend-platformの変更になる)。
- **G-5 通知の挿入の行数がバインド変数の上限を超える**(design.md 1275・1822行、要件7.12)
  - 設計: 「通知の挿入は1文12行まで」。
  - 実際: `notification_notices`は共通カラムを含めて16列ある。値を必ず送る列(ID・重複のキー・枠・まとめのキー・種別・宛先・状態・作成と更新の日時)だけでも9列あり、任意の列を加えると1行あたり12前後になる。12行では100を超える。D1の規約は「行数×カラム数」で数える(`docs/GUIDES/tech/db/002-d1-constraints.md:164-170`)。
  - 直し方: 前例(`EVENT_ROWS_PER_STATEMENT = 8`・`ROWS_PER_INSERT = 10`など)と同じく、列数から定数を決める。単体テストで`toSQL().params.length`が100以下であることを確かめる。上限は6行(16列)である。

### 上流の口・規約・前例との不一致(G-6〜G-22)

- **G-6 `listForDate`・`findMatches`は`now`を取る**(design.md 384・415行、タスク5.4・5.6): 実際は`listForDate({ date, kinds, now })`・`findMatches(ids, now)`で、`phase`はその`now`から導かれる(`apps/backend-lib/core/match/ports.ts:66-70`)。収集は処理の時点の時刻を渡せばよい。ただし朝の枠の段が23:40より後まで遅れると、マッチは`live`ではなくなる。4:21の保守による再開の範囲では起きないが、設計に記す。
- **G-7 フラグメントのトークンは`useFragmentToken`で読む**(design.md 472・1693行、タスク6.3)
  - 実際: 共通のフック`useFragmentToken`(`apps/frontend-lib/components/auth/use-fragment-token.ts`)がある。ハイドレーション中は`reading`を返し、`history.replace`でフラグメントを消す。前例は`password-reset-form.tsx:44`。
  - 設計どおり描画の後に自前で`readFragmentToken`を呼ぶと、この処理と重複する。`status === 'found'`の間だけ照会を有効にする形にする。
  - `LinkConfirmation`は開いた時の照会(要件9.5の既に停止の表示)を持たないため、そのままは使えない。
- **G-8 `loader`の取得**(design.md 1686行、タスク6.2): `docs/GUIDES/tech/frontend/006-data-fetching.md:121`は`ensureQueryData`を使わず、`queryClient.query({ ...options, staleTime: 'static' })`とすると定める。
- **G-9 画面の補助と文言のファイル**(File Structure Plan、タスク6.1・7.1)
  - 結果の変換は`src/graphql/<内容>.ts`に置き、単体テストを書く(`006-data-fetching.md:38`)。前例は`client/src/graphql/follow-list.ts`・`admin/src/graphql/admin-ultras-promotion.ts`。設計にこのファイルが無い。
  - 文言のファイル名は、前例では`*-messages.ts`である(`settings-messages.ts`・`promotion-setting-messages.ts`)。設計の`notification-copy.ts`は前例と違う名前で、adminの文言のファイルは設計に無い。
- **G-10 抑止の照合キー**(design.md 1653行、タスク5.6、要件7.4): `SuppressionList.findSuppressed`の戻り値は照合キー(`toMatchingKey`: 前後の空白を除いて小文字にする)の集合である(`apps/backend-lib/core/email/ports.ts:54-55`、`email-address.ts:15`)。連絡先のアドレスをそのまま照合すると、大文字を含むアドレスで抑止を見逃す。送信時にもemail-deliveryが抑止を確かめるため、メールは送られない。ただし、`skipped`の理由と件数が誤る。`toMatchingKey`をAllowed Dependenciesに加える。
- **G-11 スイッチの送信中の扱い**(design.md 1688行、タスク6.2): 処理中は`disabled`にせず、`aria-disabled`と`aria-busy`にして押下を無視する(`docs/GUIDES/tech/frontend/004-accessibility-rules.md:47,50`)。`disabled`にするとフォーカスを失うためである。停止中(要件1.6)の`disabled`はそのままでよい。
- **G-12 メールアドレスの形式**(design.md 587・1702・1777行、要件11.4)
  - 設計: 画面は`z.email()`、サーバーは`isValidEmailAddress`。
  - 実際: `isValidEmailAddress`は`z.regexes.html5Email`と254文字以内で判定する。注記に「zodの既定の`email()`は定義が違う」とある(`apps/backend-lib/core/email/email-address.ts:5-6`)。画面の前例も`html5Email`である(`apps/client/src/components/auth/account-form-schemas.ts:51-62`)。このままでは画面とサーバーで受け付ける値が食い違う。
  - 文言も、設計の「メールアドレスの形式で入力してください。」に対し、既存は「メールアドレスの形式が正しくありません。」である(`docs/GUIDES/service/design/003-text-and-copy-rules.md:163`)。
- **G-13 区画の取得の失敗**(design.md 1703行、タスク7.1): 機能フラグの区画は`throwOnError: (_e, q) => q.state.data === undefined`で`RecoverableSlot`へ投げ、`SectionFallback`が見出しと失敗を描く(`promotion-setting-section.tsx`、`admin-settings-page.browser.test.tsx:157`)。前例に合わせれば、区画が自分で`ErrorState`を描く必要は無い。ロールの出し分けも、前例は`RoleGate`ではなく`hasRole(useAdminRole(), 'super_admin')`による`disabled`と案内である(どちらでも成立する)。
- **G-14 変更者のニックネームがnullになる条件**(design.md 1484行、要件11.2): `AdminDirectory.findProfiles`は`status='active'`だけを返す(`d1-admin-directory.ts:41`)。そのため、削除済みに加えて停止中・招待中の管理者もnullになる。表示の文言(「削除済み」など)を決めているなら合わせる。
- **G-15 入力規則の命名**(design.md 577-587行、タスク2.1): 規約(`docs/GUIDES/tech/coding/005-input-validation.md`の「規則の置き場所」)と前例(`common-lib/help/help-input-rules.ts`・`identity/account-input-rules.ts`)は次の形である。
  - ファイル: `<機能>/<機能>-input-rules.ts`(設計は`sender-info-rules.ts`)
  - 上限の定数: `*_MAX_GRAPHEMES`(設計は`SENDER_INFO_MAX_LENGTH`)
  - 違反の値: `'empty' | 'too-long'`(設計は`'required' | 'too_long'`)
- **G-16 DBのCHECKの値の写し**(タスク1.1): `apps/db`は共用部品を読み込まない(`apps/db/schema/profile/user-profile-websites.ts:30`)。そのため`topic`のCHECKの値は`NOTIFICATION_TOPICS`の写しになる。前例の`config/product-contract-copies.unit.test.ts:139`と同じ照合のテストが設計に無い。
- **G-17 共通カラムとテーブル名**(design.md 1739行)
  - 規約は、追加だけで更新しない表に`created_at`だけを持たせる(`docs/GUIDES/tech/db/003-schema-conventions.md:217-228`)。`notification_slot_readiness`と、行を更新しない`notification_unsubscribe_tokens`がこれに当たる。更新しないのに`timestamps()`を持つ前例(`match/match-event-handler-runs.ts`)もあるため、どちらかに決める。
  - `notification_slot_readiness`は複数形ではない(`db/001`の命名規則)。
- **G-18 スキーマのテストの置き場所**(design.md 1752・1799行): CHECKと一意索引のテストを求めているが、File Structure Planにファイルが無い。前例は次の2つである。
  - `apps/db/schema/match/match-engine-migration.unit.test.ts`(マイグレーションの名前の末尾で検索する)
  - `apps/db/match-engine-schema.worker.test.ts`(apiのVitestが`db/**`を実行する)
- **G-19 Sentryのタグ名**(design.md 1374行): 規約は`<ドメイン>_incident`(`docs/GUIDES/tech/infra/004-logging-and-error-tracking.md`の270〜277行、例`match_incident`)。設計の`notification_incident`は単数形で、`notifications_incident`にそろえる。
- **G-20 ワンクリックの経路の応答**(design.md 1663行): `text/plain`の400・404は共通エラー形式(JSON)ではない。`AppError`を投げるとJSONになるため、経路から直接返すことを明記する。
- **G-21 登録の行の`title`**(design.md 325行): Modified Filesの`ADMIN_SETTINGS_SECTIONS`の行に、必須の`title`が無い(1700行とtasks.mdには反映済み)。
- **G-22 E2Eの手順のファイル**(タスク9系)
  - 規約は、テストと同じ階層に画面の操作の手順(`<手順の名前>-steps.ts`)を置く。設計に`e2e/client/notification-steps.ts`・`e2e/admin/notification-sender-steps.ts`が無い。
  - 確認済みの利用者を登録する補助は`mailpit.ts`には無く、`e2e/client/profile-steps.ts:60`の`registerVerifiedAccount`にある。
  - `HASH_PEPPER`を読むE2Eはまだ無い。CIのE2Eは`run-with-secrets --scope checks`で包まれる(`.github/workflows/checks.yml:140`)ため、タスク9.1の事前の確認で、共有のフォルダが渡ることを確かめる。

### 設計が挙動を定めていない箇所(G-23〜G-28)

- **G-23 送信と確定の間の失敗による二重送信**(design.md 1653行、要件7.12): `EmailSender.send`の重複の判定は封筒のIDごとである(`send-email-handler.ts:141`)。`send`の後の`settle`が失敗して段が再試行されると、新しい封筒で同じ通知を再び送る。選択肢は次の2つで、設計はどちらとも定めていない。
  - (a)起こり得る重複として許容する。
  - (b)送る前に通知へ送信の予定を書き、再試行でその記録を確かめる。
- **G-24 送信の期限**(要件3.6): `EmailSendRequest.deadline?`があり、期限を過ぎた送信は`expired`で送られない(`ports.ts:9`)。設計は期限を渡していない。日次の上限などで送信が遅れると、開始予告がキックオフの後に届き得る。予告の期限を`startsAt`にするかを決める。
- **G-25 上流のジョブが失敗したときの漏れ**(要件3.1・5.1・13.4): 同じ時刻のジョブは、前のジョブが失敗しても次へ進む(`scheduled-dispatcher.ts:137-141,175-180`)。次の2つの場合の扱いが設計に無い。
  - 0:00の開始(1100)が失敗すると、朝の収集はマッチを`scheduled`と見て開催通知を作らない。
  - 23:45のペアリングが失敗して0:00に遅れて組まれたマッチ(`MatchKickoffJob`の遅れたペアリング)には、開始予告が出ない。
  - 4:21の保守が送り出しを始め直すのは本specの枠だけで、上流の遅れは拾わない。
- **G-26 送信者情報は全種別のメールに載る**
  - これは既知の決定である(email-deliveryの確認済み事項で、本書の冒頭の「Key Findings」にある)。`SendEmailHandler`は種別を問わず毎通`senderInfo.get()`を呼び(`send-email-handler.ts:190`)、レイアウトは値があれば区画を描く(`email-layout.tsx:49-51`)。
  - 次の点が決定と合っていない、または定まっていない。
    - 管理画面の区画の説明の「通知メールの末尾に表示します。」(design.md 1879行)。
    - 文言規則の「認証系メールの本文は宛名・本文・ボタンの順」(`003-text-and-copy-rules.md`の「認証系メールの本文」)。
    - 全てのメールで毎通D1を1回読むこと(必要ならisolateの中で短時間だけ値を持つ)。
    - 差し替えの後に`UnsetSenderInfoProvider`とそのテスト(`apps/event/src/infrastructure/email/sender-info/unset-sender-info-provider.worker.test.ts`)を残すかどうか。
    - テンプレートの集約点`templates/notifications/index.ts`(前例は`ULTRAS_EMAIL_TEMPLATES`)の有無。
- **G-27 ペッパーの変更とトークン**: 保存した種からペッパーでトークンを導出する使い方は、`docs/GUIDES/tech/security/002-keyed-hashing.md`の「ハッシュ化の対象」に無い新しい使い方である。ペッパーを変えると、配信済みの全てのメールのリンクが無効になる。この点を`security/010`と運用の文書に書くかを決める。
- **G-28 プライバシーポリシーの法的根拠**: `docs/GUIDES/service/legal/003-privacy-policy-outline.md:12`は、通知メールの送信を「正当な利益」に分類している。本specの受信設定はオプトイン(初期値は受信しない、LR-005)で、同意に当たる。同ファイル36行の「配信停止トークン(ハッシュ)」には、保存する種の記載が無い。法的根拠の書き換えはサービス仕様の判断のため、開発者の確認が要る。

### 本specの追加で壊れる既存テストと、Modified Filesに無い文書・生成物

| 対象                                                                                                                                                                                                                     | 壊れ方                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/common-lib/admin/audit-actions/index.unit.test.ts:16-40`                                                                                                                                                           | 操作種別の名前を`toEqual`で完全一致させ、テスト名にも件数がある                                                                      |
| `apps/admin/src/components/pages/audit-logs-page.browser.test.tsx:243-276`                                                                                                                                               | 操作種別の選択肢を完全一致で確かめる                                                                                                 |
| `apps/client/src/components/settings/settings-nav-order.unit.test.ts:38-47`                                                                                                                                              | `SETTINGS_NAV_ITEMS`の6件を`toStrictEqual`で確かめる                                                                                 |
| `apps/admin/src/components/pages/admin-settings-page.browser.test.tsx:66-75・122-133・175`                                                                                                                               | 区画の1件を`toStrictEqual`で確かめる。偽の応答が機能フラグの照会だけで、送信者情報の区画が失敗の表示になり、`alert`0件の期待が崩れる |
| `apps/api/src/composition/search-module.worker.test.ts:142-157`                                                                                                                                                          | 4:21のジョブの名前を完全一致で確かめる(`MATCH_JOB_NAMES`と再抽出の間に`notifications.maintenance`が入る)                             |
| `apps/api/src/composition/search-module.reextraction.worker.test.ts:201-252`                                                                                                                                             | 4:21の実行結果の`jobs`を配列で確かめる。新しいジョブがこのテストの環境で成功することも要る                                           |
| `apps/api/src/composition/match-module.jobs.worker.test.ts:225`                                                                                                                                                          | 0:00の結果が`match-engine.match-kickoff`だけであることを確かめる                                                                     |
| `apps/event/src/composition/profile-module.worker.test.ts:253-263`・`user-product-erasure.worker.test.ts:209-219`・`match-module.purge.worker.test.ts:304-315`                                                           | `purge_due`の処理の一覧を`toStrictEqual`で確かめる                                                                                   |
| `apps/api/test/config/wrangler-config.unit.test.ts:385-395`                                                                                                                                                              | eventの変数を`toStrictEqual`で確かめる。`EXPECTED_ENVIRONMENTS`の値にも`EVENT_SITE_ORIGIN`が要る                                     |
| `apps/api/src/presentation/graphql/generated/schema.graphql`・`resolvers-types.ts`・`allowlist.json`                                                                                                                     | 生成物。スキーマの一致を`graphql-modules.worker.test.ts:14`が確かめる                                                                |
| `apps/db/schema/index.unit.test.ts`                                                                                                                                                                                      | `toContain`のため壊れないが、7テーブルの名前を加えるのが前例                                                                         |
| `docs/GUIDES/service/overview/007-daily-timeline.md:84-108`                                                                                                                                                              | 順序の図が「23:45のペアリングが通知を送る」のままである。設計は表(330行)しか挙げていない                                             |
| `docs/GUIDES/service/legal/003-privacy-policy-outline.md:12・36`                                                                                                                                                         | G-28                                                                                                                                 |
| `docs/onboardings/project-values.md`の既存の行(332行のIP制限の除外、357・410行付近の変数の一覧、782行の`EMAIL_TEMPLATES`の内訳、783行の送信者情報の提供元、867行の同期の処理、919行の区画の件数、1048行のナビゲーション) | Modified Filesは値の種類だけを挙げ、「現在は」の書き換えの範囲を挙げていない。他specの節と同じ形の「メール種別」の行も要る           |
| `docs/GUIDES/tech/infra/004-logging-and-error-tracking.md:262-277`(推測)                                                                                                                                                 | `captureEvent`の一覧に、本specの4つの通知の行が要る可能性がある                                                                      |

- 壊れないことを確かめたもの: `MESSAGE_CONTRACTS`・IP制限の除外・`EMAIL_KINDS`と`EMAIL_TEMPLATES`のテスト(含むかどうかの検査、または一覧から期待値を導く形)、退会の同期の処理の一覧、eventの環境の検証のテスト、マイグレーションの数、README・CLAUDE.mdのリンク。
- 条件: テンプレートの検査はeventのisolateの起動時に走る(`email-module.ts:32-35`)。種別だけを先に`EMAIL_KINDS`へ足すと、eventのWorkers統合テストが全て落ちる。tasks.mdの2.4と5.3は同時に足す計画で、これを満たしている。

### 上流が先に済ませていて、確かめるだけになったもの

- 登録口の`order`の予約: 設定のナビゲーションの40(`settings-navigation.ts:4`のコメント)と、管理画面の設定ページの区画の30(`admin-settings-sections.ts:9`・`project-values.md:919`・`002-page-layouts.md:1261`)。
- roadmapの帯の割り当ての表には「notifications | 1300番台 | 4:21は1300、波及処理は1300」が既にある(`.kiro/steering/roadmap.md:100`)。design.md 84行の「コントローラーへ報告する」は不要になった。1300は0:00・23:45・4:21・`purge_due`のどこでも空いている。
- `EVENT_SITE_ORIGIN`の3環境の値は、infra-deliveryの設計(`.kiro/specs/infra-delivery/design.md:1829-1847`)と`apps/infra/environments/*.json:32`に記載済みで、design.mdの値と一致する。
- 文言規則の件名の例は、frontend-platformのタスク10.3が日付を基準にした相対表現を除いた形に直し済みである(`003-text-and-copy-rules.md:943-948`)。
- ページ配置の`/settings/notifications`の行(`002-page-layouts.md:544`)はある。`/unsubscribe/{token}`の行(25行)は残っており、設計どおりの書き換えが要る。
- 準拠方針のオプトアウトの対象の表(`001-compliance-policy.md:43-51`)はある。データ保持期間の表に通知の行は無く、設計どおりの追加が要る。
- 要件定義書のFR-NOTIF-001・003・004・006〜010・012〜014・016〜018・023、FR-ADMCF-024、LR-005、DR-002は、requirements.mdと食い違わない(2026-10-25の改訂は適用済み)。
- email-deliveryは次を実装済みである。
  - 配信停止のリンクを複数並べること(ラベル必須)と、通知メールにだけ区画を置くこと。
  - 抑止中の宛先への通知メールの取りやめ。
  - 追加ヘッダーの許可リストと値の検証(httpsのURIを含まない`List-Unsubscribe`の拒否)。
  - 送信要求の本文の上限(64KiB)。
- 上流の照会は全て90件ずつ分割されていて、バインド変数の上限に収まる。照会は`findMatches`・プロダクトと利用者の`findSummaries`・`findSuppressed`である。
- 23:45のペアリングは未確定のマッチを確定してから組むため、1300の時点で当日の予選は確定済みである。
- 3つのCronの式は登録済みで、時刻ごとの所要時間の予算(各300秒)もある(`apps/api/src/composition/scheduled-jobs.ts:116-121`)。
- 設計の前提の誤り(design.md 91行): 上流の照会口(`MatchDirectory`・`ProductDirectory`・`FollowerDirectory`・`EmailSender`・`SuppressionList`)は`lib/workers`ではなく`core/*/ports.ts`にある。application層が禁じられているのは`**/db/client*`と`**/lib/workers/**`である(`config/eslint/backend-layers.ts:49-66`)。設計の置き方のほうが厳しいため違反にはならない。ただし「遠回りが要る」という前提は不要で、収集と送信の一部をapplication層に置ける。

### 実装の方針の選択肢

- **Option A(設計を前例に合わせて改訂し、上流は変えない)**
  - 内容: G-1〜G-22を本specの設計とタスクの改訂で吸収する。G-4は(a)、G-2は(a)か(b)、G-3は(A)か(B)を選ぶ。
  - ✅ 上流のspecと既存のテストに触れない。本specの範囲で閉じる。
  - ❌ 共通部品の不足(ダイアログと欄のエラーの組み合わせ)を、本specの中の工夫で埋めることになる。
- **Option B(上流の共通部品を拡張する)**
  - 内容: `setSecurityHeaders`が経路の`Referrer-Policy`を残す形、frontend-libの欄のエラーの公開の補助、email-deliveryのレイアウトが送信者情報を通知メールにだけ描く形などを、上流の変更として行う。
  - ✅ 後続のspec(sponsorship・ugc-moderationなど)も同じ部品を使える。
  - ❌ 上流のspecの文書・テストの改訂が要り、既存の決定(送信者情報を全種別に載せる)を覆すものがある。
- **Option C(混成)**
  - 内容: 型検査や実装が通らない点と規約のずれ(G-1・G-5〜G-22)はAのとおり本specで直す。判断の要る点(G-2・G-3・G-4・G-23〜G-28)だけを、上流の変更を含めて個別に決める。
  - ✅ 判断の要る点を個別に決められ、上流を変えるのは必要な箇所に限られる。
  - ❌ 決める点が多く、設計の改訂の前に開発者への確認が要る。

### 工数とリスク

- **工数: XL(2週間超)**。タスク49件、7テーブル、4アプリと共有部品に及ぶ。送信枠の状態の遷移・リース・送り出しの入口の並行の制御と、テンプレート4つ、画面3つ、E2E2本を含む。上流の口は揃っているため、未知の技術によるものではない。
- **リスク: Medium**。上流の契約は実在し形も合う。一方で、送り出しの入口の並行の呼び出し、送信と確定の間の失敗(G-23)、上流のジョブの失敗による漏れ(G-25)は、前例の無い時刻の制御である。壊れる既存テストも多く、設計の改訂なしに着手すると手戻りが出る。

### 設計の改訂への申し送り

- **開発者の判断が要る事項(個別に確認する)**: G-2(フォームとダイアログ)、G-3(初回の挿入)、G-4(`Referrer-Policy`)、G-23(二重送信)、G-24(予告の期限)、G-25(上流のジョブの失敗)、G-26(送信者情報の説明の文言・D1の読み取り・既定の実装の扱い)、G-27(ペッパーの変更)、G-28(法的根拠)。
- **判断なしに設計とタスクへ反映できる事項**: G-1、G-5〜G-22、壊れるテストと文書の表。Modified Filesとタスクの完了状態に、壊れるテストの更新を加える。
- **設計の段階で確かめる事項(Research Needed)**:
  - `notification_notices`の挿入で実際に送るバインド変数の数(Drizzleが値の無い任意の列を変数にしないか)。
  - `useFragmentToken`と開いた時の照会を組み合わせたときのハイドレーションの挙動。
  - 0:00の開始が失敗した日の、朝の枠の再開の条件。

## 実装前のギャップ分析への開発者の回答の反映(2026-11-14)

- **状態**: 上の「実装前のギャップ分析」で開発者の判断が要るとした9点(G-2・G-3・G-4・G-23〜G-28)について、開発者へ1件ずつ選択肢と推奨を示して決定を得た。決定に従ってdesign.md・tasks.mdを改訂し、requirements.mdの受け入れ基準7.12に注記を加えた。タスクの番号は変えていない。`spec.json`の承認の状態と`ready_for_implementation`は変えていない。

### 決定

| 項目                           | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 推奨との違い                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| G-2 フォームと確認のダイアログ | 入力欄の`AppForm`の`onSubmit`が`ConfirmActionDialog`を開き、確定か取り消しまで解決しないPromiseを返す。ダイアログの`onConfirm`が保存を送り、成功で解決する。`validation_error`ならダイアログを閉じてそのPromiseを例外で拒否し、`AppForm`の欄のエラーの処理(`serverFieldPrefix="input"`)に任せる。それ以外の失敗はダイアログの中に示す。ダイアログは入力欄のフォームの外に置く(前例`legal-draft-form.tsx`)。上流は変えない                                                                                                                                                                                                                                                | 推奨どおり                                     |
| G-3 送信者情報の初回の保存     | 機能フラグの前例と同じく、カスタムのマイグレーション`<日時>_notifications_seed`で固定のID・3項目NULL・版0の1行を入れ、保存は更新だけにする。3項目はNULL可にし、CHECKを「版0以上、版0なら3項目がNULL・版1以上ならNOT NULL」にする。監査ログの文(版の一致を条件)を先に置き、同じ条件の更新を続け、`isAuditGuardRejection`を`version_conflict`に変える。監査ログの対象のIDはシードの固定のID。同時の初回の保存の2人目は版の不一致になる                                                                                                                                                                                                                                     | 推奨どおり                                     |
| G-4 `Referrer-Policy`          | 経路では付けず、全体のセキュリティヘッダーの`same-origin`で要件9.7を満たすとする。Refererはフラグメントを含まず、GETは303の移動だけのため、トークンは外部のオリジンへ送られない。上流は変えない                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 推奨どおり                                     |
| G-23 二重送信                  | 送信の依頼の後に送ったことの記録が失敗した再試行に限り、同じ通知が2通届くことを許容する(paymentsの`purchase-notifier.ts`の前例と同じ)。要件7.12に注記を加えた                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 推奨どおり                                     |
| G-24 送信の期限                | `EmailSendRequest.deadline`を、単独の開始予告はマッチの開始の日時、開催通知は載せた項目のマッチの最も早い終了の日時にする。勝敗結果(統合したメールを含む)と受賞結果は期限なし。期限を過ぎた送信はemail-deliveryが`expired`で送らず、本specの通知は依頼の時点の`sent`のまま残す                                                                                                                                                                                                                                                                                                                                                                                           | 推奨どおり                                     |
| G-25 上流のジョブの失敗        | 朝の枠の1回目の収集は、開始の日時を過ぎても未開始(`scheduled`かつ`startsAt <= now < endsAt`)の当日のマッチが残る間、投稿者の一覧を作らずに`wait`を返し、送り出しの処理が段とカーソルを変えずに300秒(`MORNING_KICKOFF_WAIT_SECONDS`)の`defer`で確かめ直す。運用者が0:00のジョブを手動で起こし直してマッチが開始した後に収集する(日次タイムラインの`match-engine.match-kickoff`の運用の手順)。そのマッチの終了の日時を過ぎたら待たない。待つ間は`warn`のログを出し、1時間を過ぎた待ちは4:21の保守の`notification-slot-overdue`(13.4)で検知する。23:45のペアリングの失敗で0:00に遅れて組まれたマッチに予告が出ないのは、要件3.6(開始済みなら送らない)と一致するため変えない | 推奨(制約として記し件数を報告するだけ)と異なる |
| G-26 送信者情報の表示の範囲    | email-deliveryの実装と確認済みの決定に合わせ、送信者情報は全種別のメールの末尾に載るものとして文書を直す。管理画面の区画の説明を「全てのメールの末尾に表示します。」に、文言規則の「認証系メールの本文」の構成を宛名・本文・ボタンの後に送信者情報が続く形にする。取得は毎通D1の1行を読み、isolateの中で値を持ち越さない。使われなくなる`UnsetSenderInfoProvider`とそのテストは削除する                                                                                                                                                                                                                                                                                  | 推奨どおり                                     |
| G-27 ペッパーの変更            | `tokensFor`が導出したトークンの照合用のハッシュを保存した`token_hash`と比べ、違えば読んだ値を条件に更新する。ペッパーを変えた後は、変更の前に送ったメールのリンクだけが無効になり(通知設定ページからの停止は行える)、以後のメールは手作業なしで照合できる。`security/010`に記す。これにより、設計にあった「ペッパーを変えると以後のメールのリンクも照合できなくなる」潜在の不具合を直した                                                                                                                                                                                                                                                                                | 推奨どおり                                     |
| G-28 プライバシーポリシー      | `003-privacy-policy-outline.md`の法的根拠の行で、通知メールの送信を「正当な利益」から「同意(通知設定で種類ごとに選び、いつでも撤回できる)」へ移し、収集する情報の一覧に受信設定と配信停止のトークンの種・照合用のハッシュを記す。設計との整合の観点の決定で、法的な確認を経たものではない                                                                                                                                                                                                                                                                                                                                                                                | 推奨どおり                                     |

### 変えた箇所

- design.md:
  - System Flowsの「送信枠の状態」(朝の枠の待ち)と「朝の送信枠」(図と「開始を待つ」の段落)。
  - `MORNING_KICKOFF_WAIT_SECONDS`、`NoticeEmailBuild`の`deadline`と期限の規則。
  - `SenderInfoRecord`・`SenderInfoStore`(シードの固定のID・版0の`info`)、`tokensFor`(照合用のハッシュの更新)、`SenderInfoView`の`updatedAt`、`SenderInfoService.update`の対象のID、`D1SenderInfoWriter.save`。
  - `SlotCollectStep`と`FlushSlotHandler`・`MorningCollector`、`GroupDispatcher`(期限と許容する重複)、`D1SenderInfoProvider`(全種別・毎通の読み取り・既定の実装の削除)、ワンクリックの経路の応答のヘッダー。
  - `SenderInfoForm`の保存の順序、docs・e2eの節(`backend/016`・`security/010`・サービス仕様)、Data Modelsの送信者情報、Error Strategy、Monitoring、Testing Strategy、Security Considerations、Performance & Scalability、Migration Strategy(シードのマイグレーション)、Supporting Referencesの上限・時間と区画の説明の文言。
  - Modified Files(シードのマイグレーション、`UnsetSenderInfoProvider`とそのテストの削除、`project-values.md`の送信者情報の提供元、文言規則の認証系メールの構成、`003-privacy-policy-outline.md`)。
- tasks.md: 1.1(CHECKとシードのマイグレーション)、1.2(文言規則の認証系メールの構成・プライバシーポリシーの大枠)、2.4(送信の期限)、3.1(版0とシードのID)、3.2(ペッパーの変更)、4.3(保存の文の順序と初回の保存)、5.1(既定の実装の削除と全種別への表示)、5.4(朝の枠の待ち)、5.6(期限と許容する重複)、5.7(待ちの`defer`)、5.9(`Referrer-Policy`)、7.1(ダイアログとフォームの順序)、8.1(技術ドキュメントの内容)、8.2(`project-values.md`の送信者情報の提供元)。
- requirements.md: 受け入れ基準7.12に、依頼の後の記録の失敗による重複を許容する旨の注記。
- 水平展開: 他のspecの設計で、送信者情報を通知メールに限るもの・`no-referrer`を前提にするものは無かった。ugc-moderation・content-reportingは本文の構成の末尾に送信者情報を置く前提で、今回の決定と合う。

### 反映しなかった項目

- G-1・G-5〜G-22と、上の「本specの追加で壊れる既存テスト」の表は、判断なしに設計とタスクへ反映できる事項として残した。今回の改訂の範囲(開発者の判断が要る9点)の外のため、別に反映する。
- G-17の`notification_unsubscribe_tokens`は、G-27の決定で照合用のハッシュを更新するようになったため、`timestamps()`を持つ現在の設計のままでよい。
- Research Neededの3項目は、上の「設計の改訂への申し送り」のとおり実装の中で確かめる。G-25の決定により、3項目めの「0:00の開始が失敗した日の、朝の枠の再開の条件」は、未開始の当日のマッチが残る間の待ちとして決まった。

## 判断の要らない指摘と壊れるテストの反映(2026-11-14、開発者の指示)

- **状態**: 上の「実装前のギャップ分析」で判断なしに反映できるとしたG-1・G-5〜G-22と、「本specの追加で壊れる既存テスト」の表を、開発者の指示でdesign.md・tasks.mdへ反映した。要件の受け入れ基準は変えていない。タスクの番号は変えていない。反映を終えたため、開発者の指示で`spec.json`の`ready_for_implementation`を`true`にした。

### 反映した内容

| 項目               | 反映                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-1                | 両ページの`head`をclientの`buildSitePageHead({ title, noIndex: true })`にした(design.mdのclientの節、tasks.mdの6.2・6.3)                                                                                                                           |
| G-5                | 通知の挿入の1文の行数を列数から決めた定数(16列なら6行)にし、`toSQL().params.length`が100以下であることを単体テストで確かめる(`NotificationNoticeStore.record`・Performance & Scalability、3.3)                                                     |
| G-6                | `listForDate({ date, kinds, now })`・`findMatches(ids, now)`に改め、朝の枠の段が23:40より後まで遅れたときの扱いを記した(Allowed Dependencies・System Flows・`GroupDispatcher`・`expand`、5.4・5.6)                                                 |
| G-7                | 配信停止ページのトークンをfrontend-libの`useFragmentToken`で読み、`found`の間だけ照会する(System Flowsの「配信停止」・clientの節・Allowed Dependencies・追跡表、1.1の前提・6.3)                                                                    |
| G-8                | 通知設定ページの`loader`を`queryClient.query({ ...options, staleTime: 'static' })`にした(6.2)                                                                                                                                                      |
| G-9                | clientの文言のファイルを`notification-messages.ts`に改め、取得の設定と結果の変換の`src/graphql/notification-settings.ts`、adminの`sender-info-messages.ts`・`src/graphql/admin-notification-sender-info.ts`をFile Structure Planに加えた(6.1・7.1) |
| G-10               | 抑止の照会の戻り値を`toMatchingKey`で照合し、Allowed Dependenciesに`toMatchingKey`・`ExtraHeaders`・`AnyEmailKind`・`SuppressionReason`・`linkUrlSchema`を加えた(5.6)                                                                              |
| G-11               | スイッチの送信中を`aria-disabled`・`aria-busy`にし、`disabled`にしない(clientの節・Testing Strategy、6.2)                                                                                                                                          |
| G-12               | 画面のメールアドレスの判定を前後の空白を除いた値の`z.regexes.html5Email`と`EMAIL_MAX_LENGTH`にし、文言を既存の「メールアドレスの形式が正しくありません。」にした(common-libの節・`SenderInfoForm`・Error Categories、7.1)                          |
| G-13               | 区画の取得の失敗を`throwOnError`で`RecoverableSlot`へ投げて`SectionFallback`に描かせ、ロールの判定を`hasRole(useAdminRole(), 'super_admin')`にした(adminの節・コンポーネントの表・Security Considerations、7.1)                                    |
| G-14               | 変更者のニックネームは削除済み・停止中・招待中の管理者でnullになり、画面は「なし」と示す(`SenderInfoService`・adminの節、4.9・7.1)                                                                                                                 |
| G-15               | 入力規則を`sender-info-input-rules.ts`・`SENDER_INFO_MAX_GRAPHEMES`・`'empty' \| 'too-long'`にし、サーバーの違反も`'empty' \| 'too-long' \| 'invalid-email'`にそろえた(1.1)                                                                        |
| G-16               | `config/notification-contract-copies.unit.test.ts`でDBの通知種別のCHECKと`NOTIFICATION_TOPICS`の一致を確かめる(File Structure Plan・Testing Strategy、1.3)                                                                                         |
| G-17               | 準備の完了の表を複数形の`notification_slot_ready_marks`に改め、共通カラムを`created_at`だけにした。`notification_unsubscribe_tokens`はG-27の決定で`token_hash`を更新するため`timestamps()`のまま(Data Models、1.1)                                 |
| G-18               | スキーマのテストを`apps/db/schema/notifications/notifications-migration.unit.test.ts`と`apps/db/notifications-schema.worker.test.ts`に置く(File Structure Plan、1.1)                                                                               |
| G-19               | Sentryのタグを`notifications_incident`にした(3.7)                                                                                                                                                                                                  |
| G-20               | ワンクリックの経路の`text/plain`の本文を経路から直接返し、`AppError`を投げない(eventの節、5.9)                                                                                                                                                     |
| G-21               | Modified Filesの区画の登録に`title`を加えた                                                                                                                                                                                                        |
| G-22               | E2Eの手順のファイル`e2e/client/notification-steps.ts`・`e2e/admin/notification-sender-steps.ts`と、利用者の登録の`registerVerifiedAccount`を加えた(File Structure Plan・Testing Strategy、9.1)                                                     |
| 壊れるテストと文書 | Modified Filesに一覧を完全一致で確かめる既存のテスト・生成物・`infra/004`・日次タイムラインの図・`project-values.md`の既存の行を加え、更新を1.3・4.7・4.8・4.9・5.1・5.10・6.2・7.1・8.1・8.2へ割り当てた                                          |
| その他             | Existing Architecture Analysisの上流の実装の状況と照会口の置き場所の前提、上流への影響のroadmapの記述(記載済み)を直した。テンプレートの集まり`templates/notifications/index.ts`(前例`ULTRAS_EMAIL_TEMPLATES`)を加えた(5.3)                         |

### 残る事項

- Research Neededの2項目(`notification_notices`の挿入で実際に送るバインド変数の数、`useFragmentToken`と開いた時の照会の組み合わせのハイドレーション)は、タスク3.3・6.3の実装の中で確かめる。
- タスク1.1は作業量の上限に近いまま確かめる事項が増えたため、開発者の指示(2026-11-14)で、既存のテストの更新(操作種別の一覧・監査ログの操作種別の選択肢・テーブル名の一覧)とDBの値と共有の定数の照合のテストを、新しいタスク1.3へ分けた。既存のタスクの番号は変えていない。1.1の後は操作種別の一覧を完全一致で確かめる既存の2つのテストが失敗するため、1.3は1.1の直後に行う。
