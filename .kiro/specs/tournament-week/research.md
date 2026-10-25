# Research & Design Decisions

## Summary

- **Feature**: `tournament-week`
- **Discovery Scope**: Complex Integration(トーナメントの実装は無い。上流の20spec(dev-tooling〜notifications)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはmatch-engineの`MatchScheduler`・`MatchDirectory`・確定のマッチイベント・`MatchViewReader`・対戦カードの部品・トップページの区画、paymentsの購入種別の口・`PaymentRefunds`・`OpenCheckoutExpirer`・`CheckoutStarter`・`PriceCatalog`、ultras-subscriptionの`UltrasEntitlements`・`ULTRAS_ACTIVATION_HANDLERS`・`UltrasPromotionGate`、notificationsの`NotificationEventPublisher`・`RESULT_NOTICE_SUPPLEMENTS`、product-launchの判定の供給元の3つの登録口・`ProductDirectory`・プロダクトライフサイクルの登録口・`MY_PRODUCT_SECTIONS`・`PRODUCT_DELETE_NOTICES`、directory-discoveryの`PRODUCT_PAGE_SECTIONS`・`PRODUCT_OWNER_ACTIONS`、identity-authのユーザーライフサイクルの登録口と`UserContactDirectory`の上に、Weekトーナメントと汎用のブラケットを足す)
- **Key Findings**:
  - match-engineは、トーナメントのマッチの開始(0:00)・確定(23:40)・即時の終了・開始時点の決着(不戦勝・相手の不戦敗・両者の不戦敗)を種別によらず行う。本specは`MatchScheduler.schedule`で側が1つまたは2つのマッチを作り、確定の`decided`のイベントと23:45のジョブでラウンドを進めるだけでよい。側が1つのマッチは開始時点で`bye`になり、FR-TOURW-020・023の不戦勝の連鎖をそのまま表せる。
  - match-engineの開始のジョブは0:00に1回しか動かないため、次ラウンドのマッチは実施日の0:00より前に予定を作る必要がある。確定のイベントの処理(即時)と23:45のジョブ(確実)の2つの経路で同じ冪等な進行を呼ぶ。0:00を過ぎてから予定を作るとマッチが実施日のうちに始まらず0対0で両者敗北になるため、遅れた場合はラウンドを1日遅らせる回復の規則を持つ。
  - paymentsの`PurchaseOffer`に決済期限(23:35)・受付期限(23:00)・反映の期限(23:45=組み合わせ決定)を渡せば、受付期限の後の開始の拒否・決済セッションの有効期限・反映の期限を過ぎた決済の自動返金(FR-PYMNT-014)・23:40の突合(FR-PYMNT-013)はpaymentsが行う。本specは`PurchaseFulfillment.prepare`で参加資格の付与の文を返すだけでよい。
  - 組み合わせ決定と、削除・退会・Ultrasの加入・決済の反映が同時に起きると、組み合わせに入ったのに資格を失う・返金される事故が起きる。組み合わせ決定の先頭で週のトーナメントに「決定の開始」を記録する(凍結)と、以後の資格の変更をすべて条件付きの書き込みで拒否でき、組み合わせの対象が確定する。
  - 返金ポリシー(法的通知の大枠)は「ユーザー停止やプロダクト非公開化に伴うトーナメント参加資格停止: 返金する」とし、要件定義書(FR-PYMNT-010・012)は削除・退会の自動返金だけを定める。ultras-subscriptionはQ3で自分の行(Ultrasの日数分の返金)を「返金しない」に直したが、トーナメントの行は本specへ申し送られている(仮2・仮3)。
  - ページ配置にはブラケットのページが無いが、briefはブラケットの表示を求めている(仮4)。トップページのモックアップ(`mockups/src/routes/client/top/-components/tournament-section.tsx`・`final-showcase.tsx`)はトーナメントの区画と決勝の全幅の演出を、プロダクト詳細のモックアップ(`payment-panel.tsx`・`trophy-shelf.tsx`)は参加費の導線とトロフィーの棚を示す。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を推奨として示した。**仮1〜仮6は2026-10-24に開発者が確定した(いずれも推奨どおり)。** 決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。roadmapの「Requirement Ambiguities」の表のうち本specが担当に含まれる3行(再ローンチの禁止期間の行・Ultrasの免除の行・停止と非公開化の自動返金の行)は、仮1・ultras-subscriptionのQ1とQ2の適用・仮3で決めた。roadmapは編集せず、解決の列の文言をコントローラーへ報告する。

| #   | 論点                                                         | 根拠                                                                                                                                                                                                                                                                                                                                                                                | 選択肢                                                                                                                                                                                                           | 推奨と確定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | トーナメントの敗退後の再ローンチの禁止期間、Week優勝作の扱い | FR-RELCH-002〜004、再ローンチ規則の「間隔制限の解釈」と計算例(準々決勝敗退の後はFR-PRDCT-002だけ)、product-launchの仮1、briefのConstraints、roadmapのRequirement Ambiguities                                                                                                                                                                                                        | (A)product-launchの仮1と同じく、結果の確定後は敗退でも禁止期間を掛けず、Week優勝作はYearの結果確定まで禁止 / (B)トーナメントの敗退後も7日・2日を掛ける / (C)Week優勝作の禁止をYearの組み合わせ決定までに短くする | 推奨は(A)(2026-10-24に開発者が確定)。roadmapの同じ行を共に担当するproduct-launchの仮1と同じ解釈で、再ローンチ規則の計算例と一致する。敗北後の間隔はFR-RELCH-002・003の「予選に敗北した場合」に限られる。本specは「Weekの結果確定待ち」の条件だけを供給し、Week優勝後の禁止はtournament-yearが「Yearの参加期間」として供給する                                                                                                                                                                                                                                                                                                           |
| 仮2 | 組み合わせ決定の時点で非公開化中・投稿者が停止中のプロダクト | FR-TOURW-007(「参加資格を得たプロダクトによる組み合わせ」)、FR-TOURW-020(決定後の停止・非公開化は相手の不戦勝)、FR-ADMUG-010(未開始のマッチ予定の取り消し)、予選のペアリングの対象(match-engine・product-launchの`ScheduledLaunchDirectory`は可視のローンチだけ)                                                                                                                    | (A)組み合わせから除き、そのトーナメントの参加資格を停止する / (B)組み合わせに含め、開始時点までに復元されなければ相手の不戦勝                                                                                    | 推奨は(A)(2026-10-24に開発者が確定)。予選のペアリングが可視のローンチだけを組む扱いと一致し、FR-ADMUG-010の「未開始のマッチ予定を取り消す」の趣旨に合う。(B)はシード数と組み合わせが表示できないプロダクトで歪み、相手が戦わずに勝ち上がる組み合わせを意図的に作ることになる。決定の後の停止・非公開化はFR-TOURW-020のとおり(match-engineが開始時点で決着する)                                                                                                                                                                                                                                                                          |
| 仮3 | 停止・非公開化に伴う参加資格の停止の返金                     | 返金ポリシー(「ユーザー停止やプロダクト非公開化に伴うトーナメント参加資格停止: 返金する(停止は事業者側の都合)」「トーナメントの不戦勝・不戦敗・両者敗北: 返金しない」)、FR-PYMNT-010(組み合わせ決定前の削除・退会は自動で全額返金)、FR-PYMNT-012、paymentsのQ1(判断を後続specへ申し送り)、ultras-subscriptionのQ3(Ultrasの行は返金しないに改めた)、roadmapのRequirement Ambiguities | (A)仮2で除いた決済済みの参加費を自動で全額返金し、決定後の不戦敗は返金しない / (B)自動では返金せず、管理者がStripeのダッシュボードで返金する / (C)返金せず、返金ポリシーを「返金しない」に直す                   | 推奨は(A)(2026-10-24に開発者が確定)。要件定義書は「組み合わせ決定前に参加資格を失えば自動で全額返金」(FR-PYMNT-010)という規則を利用者の都合(削除・退会)に対して定めており、事業者の都合(停止・非公開化)で組み合わせ決定前に資格を失う場合に返金しない理由が無い。返金ポリシーの文言とも一致し、paymentsの`PaymentRefunds`と同じ経路で実装できる。組み合わせ決定の後の不戦敗は、参加資格を使い始めた後の結果であり、同じ返金ポリシーの「不戦勝・不戦敗」の行に従う。ultras-subscriptionのQ3は、要件定義書が「課金期間の末日まで特典を続ける」と明記していた(役務を失わない)ため事情が異なる。要件定義書のFR-PYMNT-010・012の改訂を要する |
| 仮4 | ブラケットの表示の場所                                       | briefのDesired Outcome(「ブラケット表示」)、ページ配置(ブラケットのページの定義が無い)、トップページのモックアップ(その日のラウンドだけを表示)                                                                                                                                                                                                                                      | (A)トーナメントごとの公開のブラケットのページ`/tournaments/week/{ISO週}`を設け、トップページの区画とトロフィーから導く / (B)トップページの区画の中に全ラウンドを表示する / (C)表示しない                         | 推奨は(A)(2026-10-24に開発者が確定)。トップページのモックアップの構成(その日のマッチと決勝の演出)を崩さずに全体を見せられ、URLを共有できる。(B)はトップページが長くなり予選の区画を押し下げる。ページ配置への追記を本specに含める                                                                                                                                                                                                                                                                                                                                                                                                       |
| 仮5 | 決済期限の後に反映された参加費と、その間の次回の予約         | 再ローンチ規則(「参加しなかった場合…その時点(23:40より前)で結果が確定し禁止を解除する」)、FR-PYMNT-013(決済期限から組み合わせ決定までの突合)、FR-RELCH-004の意図(同一プロダクトが並行して参加資格を持つことを防ぐ)                                                                                                                                                                  | (A)禁止は決済期限で解除し、期限の後に反映された決済は、より新しいローンチが予約されていれば参加資格を与えず自動で全額返金する / (B)参加資格を得ていない枠の禁止も組み合わせ決定まで続ける                        | 推奨は(A)(2026-10-24に開発者が確定)。再ローンチ規則の解除の時点を変えず、23:35〜23:45に予約されたローンチ(翌日の予選)とトーナメントの1回戦が並行する事故を、反映の側で防げる。該当は突合で反映される決済だけで、まれである。(B)は規則の文書と画面の「参加しない場合は◯日に解除」の日時を変える                                                                                                                                                                                                                                                                                                                                          |
| 仮6 | 本機能が行う自動返金の知らせ                                 | paymentsの仮5(自動返金には返金の通知を送る。対象は`reflection:`で始まる依頼だけ)、briefのConstraints(参加者へのメールの宛先は`UserContactDirectory`)、FR-PYMNT-006(返金は決済履歴へ反映)                                                                                                                                                                                            | (A)本機能が依頼した返金の旨と理由をメールで知らせる(退会済みには送らない) / (B)メールを送らず決済履歴への反映だけにする                                                                                          | 推奨は(A)(2026-10-24に開発者が確定)。paymentsが自ら行う自動返金と同じく利用者に知らせ、組み合わせ決定時点の除外(仮2)のように利用者が操作していない返金の理由を伝えられる                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### 確認済みのため質問しない事項

- 参加費の免除の判定時点と決済済みの参加費: ultras-subscriptionのQ1・Q2で決定済み。勝利の確定時刻`w`と決済期限`d`に対し`UltrasEntitlements.wasEntitledDuring(投稿者, w, d)`で判定し、勝利の確定・加入の有効化・組み合わせ決定の3つの時点で同じ規則を適用する(組み合わせ決定の時点で判定しても同じ答えになるため、知らせの取りこぼしを組み合わせ決定で補える)。決済済みの参加費は返金しない。roadmapのRequirement Ambiguitiesの「有料プランによる参加費免除の判定時点…」の行は、本specは決定を加えずQ1・Q2を適用したことだけを解決の列に足す。
- 決済期限・受付期限・組み合わせ決定・突合の時刻と順序: FR-TOURW-002・007、FR-PYMNT-013、料金及びプラン体系、日次タイムラインで決まっている。23:40の突合のジョブ(`payments.checkout-reconciliation`、`order` 10)はpaymentsが所有し、本specは結果を`PurchaseFulfillment`で受け取る。反映の期限(`fulfillableUntil`)を23:45にすれば、組み合わせ決定までに反映されなかった決済はpaymentsが自動で全額返金する(FR-PYMNT-014)。
- シード・非シードの並びの同順の扱い: Weekトーナメント規則が「なお同順ならローンチのID(ULID)昇順」と定める。2回戦の枠の並べ替えの列と3回戦以降の固定のブラケットも同文書で決まっている。
- 不戦勝の連鎖の日程: Weekトーナメント規則の例(Cは09-16の0:00に不戦勝、M9も両者敗北ならCは09-17の0:00に再び不戦勝)のとおり1日1ラウンドとする。参加数2は火曜日に決勝だけ。
- ラウンド名: 文言規則の表記規則(残り参加数8で準々決勝、4で準決勝、2で決勝)。1回戦の残り参加数はN、2回戦以降はP/2^(r−2)。
- トーナメントマッチの勝敗・即時の終了・開始時点の決着: match-engineが種別によらず行う(match-engineの申し送り)。両者の不戦敗はmatch-engineの仮4で両者敗北。
- 通知の時刻と統合: notificationsの仮1(開始予告は前日の23:45の枠)と仮2(2026-10-24に開発者がCを選択: トーナメントの23:45のジョブが処理と発行の最後に`EveningDispatchGate.markReady`を呼び、前提がそろった時点、遅くとも23:55に夜の送り出しを始める。統合を望む結果と翌日の予告は`markReady`の前に発行する)。予選の勝利の結果通知の決済期限は`RESULT_NOTICE_SUPPLEMENTS`に種別`qualifier`で登録する。メール内の時刻はUTCで表記する(文言規則)。UIとメールに出す決済期限は受付期限の23:00(料金及びプラン体系)。
- 購入種別と価格: 購入種別`week_tournament_entry`はpaymentsの`PURCHASE_KINDS`に定義済み。価格はStripeのダッシュボードで`lookup_key`付きで作る(`ultras_monthly`と同じ形。本specは`week_tournament_entry`とする)。参考価格は$5(料金及びプラン体系)。
- 波及処理・ジョブ・イベントの処理の`order`: 本specの1500番台(roadmapの帯の割り当て)。23:45のジョブはmatch-engine(1100)・notifications(1300)の後に動き、23:40の突合(10)・確定(1100)より後になる。上流の値より前に動く必要のある処理は無い。Ultrasの知らせの処理の`order`は100以上の規則のもとで帯と同じ1500・1510とし、tournament-year(1700番台)と重ならない。
- 新しいパッケージ: 無い。ブラケットの描画はCSSのグリッドとshadcn/uiのタブ、決済画面はpaymentsの画面、カウントダウンはmatch-engineの`useServerCountdown`の作りに合わせる。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(directory-discoveryと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(マッチとブラケット・プラン判定・再ローンチ可否ポリシー・決済フルフィルメント・通知イベント契約・Cron・Queuesのディスパッチ・画面シェル・Ultrasの知らせ・利用者の連絡先の照会・データエクスポートの出力)。
- **Sources Consulted**: match-engine・payments・ultras-subscription・notifications・product-launch・directory-discovery・identity-auth・backend-platform・email-deliveryの`design.md`、match-engine・payments・ultras-subscription・notifications・product-launch・directory-discoveryの`research.md`の後続specへの申し送り、tournament-year・ugc-moderation・data-exportのbrief。
- **Findings**:
  - match-engine: `MatchScheduler.schedule(inputs, at)`(1〜50件、呼び出し元が`matchId`を採番し再実行で同じ値なら重複しない、種別`week`、`round`・`stage`、開始と終了の日時、側1つまたは2つ、確定の後に`scheduled`のイベントを送る)・`MatchDirectory.findMatches`(90件ずつ、`entries`の`result`・`upvoteCount`・`lastUpvoteElapsedMs`・`forfeited`)・`listForDate({ date, kinds, now })`・`MATCH_EVENT_HANDLERS`(`decided`、`kinds`、同じ種類での`order`の重複は拒否)・`MatchViewReader.findViews`・`matchViewLoader`・GraphQLの`Match`・`MatchBye`・clientの`MatchCard`・`ByeList`・`useUpvote`・`TOP_PAGE_SECTIONS`(`main`のYear 10・Week 20、`showcase`の決勝)。申し送りに「`decided`のイベントの処理(1500番台)でラウンドを進める。シードの並びは予選の結果を使う。即時の終了・開始時点の決着は種別によらずmatch-engineが行う」とある。
  - payments: `PurchaseKindRegistration`・`PurchaseOfferPolicy.describe`(`deadlineAt`・`acceptUntil`・`fulfillableUntil`・`exclusivityKey`・`summary`)・`PurchaseFulfillment.prepare`(副作用なし、文を返す、制約の違反は`prepare`の呼び直しで拒否に扱い直す)・`afterCommit?`・`PaymentRefunds.request`(依頼キーは依頼元が一意に決める、`reflection:`は不可、`purchase_not_found`・`not_paid`)・`OpenCheckoutExpirer.expireOpen`(eventの非同期の処理から呼ぶ)・`CheckoutStarter.start`(apiだけ)・`PriceCatalog.getPrices`・GraphQLの`CheckoutStart`。登録するServiceIdentifierは`backend-lib/workers/<ドメイン>`の共有モジュールでapi・eventの両方に束縛する。申し送りに「反映の期限=組み合わせ決定、`exclusivityKey`はローンチとトーナメントの組、FR-PYMNT-010の依頼キーは購入IDと理由の組」とある。
  - ultras-subscription: `UltrasEntitlements.wasEntitledDuring`・`entitledUsersDuring`・`isEntitledAt`、`UltrasActivationHandlerRegistration`(`order`は100以上、冪等、Stripeを呼んでよい)、clientの`UltrasPromotionGate`。
  - notifications: `NotificationEventPublisher.publish({ publisher, events(1〜50件), at })`(`match_preview`は側が2つで`scheduled`、`match_result`は確定済み、`award`は`product_of_the_week`と期間`2026-W37`、`dedupe`で冪等)・`ResultNoticeSupplementRegistration`(`kinds`・`order`・`provider`、追記は1〜5行・各200文字以内・日時は`formatUtcDateTime`)。
  - product-launch: `RELAUNCH_CONDITION_SOURCES`(`RelaunchBlock`の`code`・`message`・`releaseAt`)・`PRODUCT_LOCK_SOURCES`・`LAUNCH_SUMMARY_SOURCES`(`rank`の大きい方)・`DecisionSubject.latestLaunch`、`ProductDirectory.findSummaries(ids, 'visible' | 'not-deleted')`・`listLaunches`・`resolveHandle`、`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`(`deleted`は投稿者の個別削除だけ、退会はユーザーの`withdrawn`)、`MY_PRODUCT_SECTIONS`・`PRODUCT_DELETE_NOTICES`。申し送りに「`RelaunchConditionSource`は参加資格を得る前は決済期限を解除の日時として返す、`ProductLockSource`は組み合わせ決定後・前ラウンド勝利後〜マッチ終了」とある。
  - directory-discovery: `PRODUCT_PAGE_SECTIONS`の`main`の10(トロフィー)・`PRODUCT_OWNER_ACTIONS`(Week 10・Year 20)の予約と`ProductPageContext`の形。
  - identity-auth: `USER_LIFECYCLE_ASYNC_HANDLERS`(`withdrawn`・`purge_due`、`order`)・`UserContactDirectory.findContact`(退会済みは`undefined`)。
  - backend-platform: `ScheduledJobDefinition`(`at`・`order`)、apiだけのCron Triggers、同じ時刻の`order`の昇順・失敗は次を止めない。email-delivery: `defineEmailKind`・`EMAIL_KINDS`・`defineEmailTemplate`・`EMAIL_TEMPLATES`。
- **Implications**: 上流のファイルの変更は、契約で定められた登録箇所への追記だけにする。上流の改訂を要するのはmatch-engineの`ByeCard`の文言の1点で、本specが依頼した改訂としてmatch-engineのspecが反映した(match-engineの仮7、2026-10-24に確定。本specのタスクには含めない)。

### 時刻の連鎖と進行の経路

- **Context**: FR-TOURW-007・011・021、日次タイムラインの「同時刻に走る処理の順序」、match-engineの開始のジョブが0:00に1回だけ動くこと。
- **Findings**: 23:40にmatch-engineが当日のマッチを確定し`decided`を送る。23:45にmatch-engine(1100)のペアリング、notifications(1300)の夜の枠の準備の後に、本specのジョブ(1500)が動く。夜の送り出しは本specとtournament-yearの準備の完了がそろった時点、遅くとも23:55に始まる(notificationsの仮2)。0:00にmatch-engine(1100)が予定のマッチを開始し、側が1つのマッチは`bye`、該当した側があれば開始時点で決着する。
- **Implications**: 組み合わせ決定は23:45のジョブ(1500)で行う。ラウンドの進行は`decided`の処理(数秒後)と23:45のジョブ(1500、確実な経路)の両方から同じ冪等な処理を呼ぶ。23:45のジョブは処理とその夜の発行を全て終えた後に`markReady`を呼ぶため、結果と翌日の予告は夜の送り出しの前にそろう。0:00を過ぎて予定を作る場合(障害の回復)は、そのラウンドの実施日を翌日にする。

### 組み合わせ決定の凍結と同時の変更

- **Context**: 削除・退会・Ultrasの加入・決済の反映・組み合わせ決定が同時に起きる場合(D1は一括の書き込みを直列に確定する)。
- **Findings**: 組み合わせ決定は複数の一括の書き込みに分かれる(参加数が多い場合の分割)。先頭で`week_tournaments.draw_started_at`を条件付きで記録し、資格を変える全ての書き込み(反映の文・失効と免除・喪失)を`draw_started_at IS NULL`の条件付きにすれば、凍結の後は対象が変わらない。反映の文は条件を満たさなければ`CASE`式のNOT NULL制約の違反で失敗させ、paymentsが`prepare`を呼び直して拒否にする(paymentsの規約)。
- **Implications**: 凍結の後に届いた削除は、組み合わせ決定の分類(可視でないプロダクトは除外)で扱われ、同じ依頼キーの返金になる。凍結の後の退会は、組み合わせに入っていればmatch-engineが開始時点で相手の不戦勝にする。

### ブラケットの表現

- **Context**: Yearの再利用(FR-TOURY-012〜014・024・026〜029)、参加数200でも収まる記録、表示の組み立て。
- **Findings**: 参加者に抽選番号(シードは1〜S、非シードは並びの順にS+1〜N)を振れば、1回戦(k番のマッチはS+2k−1とS+2k)・2回戦の枠(1〜Sはシード、S+kは1回戦kの勝者)・3回戦以降(2k−1と2kの勝者)がすべて番号から導ける。記録は参加者と、予定を作ったマッチ(ラウンド・位置・マッチID・両側の番号・結果)だけで足りる。Yearとの差は、並びの比較(Yearの非シードはローンチ日だけ)と1回戦の実施日(決勝日からの逆算)と最大の参加数だけである。
- **Implications**: 純粋な規則を`core/tournament`に、種類と識別子で区別する記録と進行を`workers/tournament`に置き、Week固有の参加の枠・期限・賞を別のテーブルと部品にする。

### 画面と文言

- **Context**: ページ配置(トップページ・プロダクト詳細・トーナメント参加費の導線・プロダクト登録・編集)、文言規則、モックアップ。
- **Findings**: トーナメントの区画の見出しは「Product of the Weekトーナメント」・週・ラウンド・決勝日(モックアップ)。決勝は全幅の演出(`showcase`)。トロフィーはYear先頭・Weekは新しい順で週と受賞日。参加費の導線は決済期限(23:00)・相対表現・48時間未満の強調と秒読み・免除の表示・Ultrasの案内(機能フラグ)・縮退の表示。match-engineの`ByeCard`の文言は予選向け(「ディレクトリに掲載されます」)で、トーナメントの不戦勝に合わない。
- **Implications**: トップページの2区画・プロダクト詳細の2区画・自分のプロダクトの区画・削除の注意書き・ブラケットのページを本specが持つ。`ByeCard`の文言の切り替えはmatch-engineへの改訂の依頼とする。

## Architecture Pattern Evaluation

| Option                                    | Description                                                                                                                   | Strengths                                                               | Risks / Limitations                                                                    | Notes                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 純粋な規則+種類で区別する共有の記録(採用) | 規則は`core/tournament`、記録と進行は`workers/tournament`(`kind`と`tournament_id`で区別)、Week固有は`workers/week-tournament` | Yearが規則も記録も進行もそのまま使える。進行の冪等性を1か所で保証できる | Yearが本specのテーブルに書くため、所有の規則(公開の部品だけを通す)を明記する必要がある | match-engineの`MatchScheduler`と同じ「部品越しに書く」形 |
| 純粋な規則だけを共有                      | 記録と進行はWeek・Yearがそれぞれ持つ                                                                                          | テーブルの所有が明快                                                    | 進行・回復・冪等性の実装が2つになり、ずれる                                            | —                                                        |
| 確定のイベントだけで進行                  | 23:45のジョブを持たない                                                                                                       | 処理が1つ                                                               | イベントの遅延・失敗で0:00に間に合わない                                               | 不採用                                                   |
| 23:45のジョブだけで進行                   | イベントの処理を持たない                                                                                                      | 時刻が決定的                                                            | 即時の終了で早く決まった場合も夜まで待つ(実害は小さい)。確実性は同じ                   | イベントの処理と併用                                     |

## Design Decisions

### Decision: 抽選番号で参加者を表し、予定を作ったマッチだけを記録する

- **Context**: 参加数200(ラウンド8)でも1回の処理とバインド変数の上限に収め、表示と進行で同じ構造を使う。
- **Alternatives Considered**:
  1. 全ラウンドの全ノードを組み合わせ決定の時点で作る
  2. 抽選番号から導けるノードは作らず、予定を作ったマッチだけを記録する
- **Selected Approach**: 2。`bracket_participants`に抽選番号、`bracket_matches`にラウンド・位置・マッチID・両側の番号・結果。未来のラウンドの表示はブラケットの規則(`bracketLayout`)で「M3の勝者」の形に導く。
- **Rationale**: 記録が少なく、進行の各段は「前のラウンドの結果→次のラウンドの予定」だけを書けばよい。
- **Trade-offs**: 表示が規則の関数に依存する(単体テストで固定する)。
- **Follow-up**: N = 13・129・200の表示の配置をテストで確かめる。

### Decision: 進行は確定のイベントと23:45のジョブの両方から冪等に呼ぶ

- **Context**: 0:00の開始に間に合わせる必要と、イベントの配送の不確実さ。
- **Selected Approach**: `BracketProgression.advance(bracketId, now)`は、(1)現ラウンドの結果を`MatchDirectory.findMatches`から写す(条件付き)、(2)次ラウンドの位置を`onConflictDoNothing()`で挿入して読み直す(同時の実行は先に挿入したマッチIDにそろう)、(3)`MatchScheduler.schedule`(重複は無視)、(4)終了は`status = 'active'`の条件付きで1回だけ確定、の順で、何度呼んでも同じ結果になる。
- **Trade-offs**: 2つの経路が同時に動く可能性を前提に、すべての書き込みを条件付きにする必要がある。

### Decision: 組み合わせ決定の先頭で週のトーナメントを凍結する

- **Context**: 同時の変更(「組み合わせ決定の凍結と同時の変更」)。
- **Selected Approach**: `draw_started_at`の条件付きの記録→枠の分類(可視性・免除・期限)の分割の書き込み→ブラケットの作成→マッチの予定→返金と通知。再実行は凍結済みの続きから行う。
- **Rationale**: 組み合わせの対象を1つの時点で確定でき、返金の判断(仮3)も同じ分類で行える。

### Decision: 参加資格の喪失は非同期の処理と組み合わせ決定の分類の両方で扱い、同じ依頼キーで返金する

- **Context**: FR-TOURW-027の退会はユーザーの`withdrawn`(プロダクトの`deleted`は作られない)、削除はプロダクトの`deleted`。どちらも非同期で、凍結と前後し得る。
- **Selected Approach**: 非同期の処理は凍結の前なら`forfeited`にして返金を依頼する。凍結の後なら、組み合わせ決定の分類が可視でないプロダクトを`forfeited`(論理削除済み)・`excluded`(非公開化・停止)にして返金を依頼する。依頼キーは`tournament-week:<購入ID>:<理由>`で、どちらの経路でも1回になる。
- **Trade-offs**: 理由の値が経路で変わらないよう、論理削除済みは常に`entitlement_lost`、非公開化・停止は`entitlement_suspended`とする。

### Decision: トロフィーの区画を本specが持ち、Yearの受賞を供給元の登録口で加える

- **Context**: `PRODUCT_PAGE_SECTIONS`の`main`の10はトーナメントに予約された1つの区画で、モックアップのトロフィーの棚はYearとWeekを1つに並べる。
- **Selected Approach**: apiに`TOURNAMENT_TROPHY_SOURCES`(初版はWeekの1件)を置き、`productTrophies`がまとめて返す。tournament-yearはYearの供給元を追記する。
- **Rationale**: 1つの区画で並び順(Year先頭・Weekは新しい順)を守れる。供給元の登録口はproduct-launchの`LAUNCH_SUMMARY_SOURCES`と同じ形。

### Decision: 採らなかった案

- 組み合わせ決定の時点の可視でないプロダクトを組み合わせに含める(仮2の選択肢B): シード数と組み合わせが歪む。
- 参加の枠を組み合わせ決定の時点にまとめて作る: 予選の勝利の直後に参加費の導線を出せない。枠は`decided`の処理で作り、組み合わせ決定で欠けを補う。
- 自前の決済の突合のジョブ: paymentsが所有し、重ねて作らない(brief・roadmap)。
- 次ラウンドのマッチを側の確定を待たずに先に作る: match-engineの`MatchScheduler`は側の確定済みの入力を求め、未確定の側を表せない。

## Synthesis

- **Generalization**: シード・組み合わせ・不戦勝・終了・ラウンド名は、WeekとYearの両方の要件(FR-TOURW-009〜010・021・023〜026とFR-TOURY-012〜014・024・026〜029)が同じ規則の変種である。差は並びの比較と実施日の方針だけなので、それを引数にした規則と進行の部品にした。
- **Build vs. Adopt**: トーナメントのブラケットのライブラリ(brackets-managerなど)は、独自の記録の形とストレージを前提にし、シードの配置の列・D1の制約・match-engineとの連携に合わない。規則は数十行の純粋な関数で、要件の具体例で単体テストできるため自作する。マッチ・決済・通知・特典の判定は上流の部品を使う。
- **Simplification**: 新しいメッセージ種別を作らない(進行は既存のマッチイベントとジョブ、返金はpaymentsのキュー、メールはemail-deliveryのキュー)。未来のラウンドのノードを記録しない。Week固有のテーブルは週と枠の2つに限り、受賞は週のトーナメントの行に持つ。

## Risks & Mitigations

- 23:45のジョブが失敗して0:00までに次ラウンドを作れない — `decided`の処理が先に進めるため通常は影響しない。両方失敗した場合は`round-late`をSentryへ通知し、次の実行でラウンドを1日遅らせて作る(要件6.10)。
- 参加数が多い週(129以上)で組み合わせ決定の処理が長くなる — 分類・参加者・マッチの書き込みを90件・50件ずつに分け、凍結の後の続きから再開できるようにする。paymentsの23:40の突合は200件を上限とするため、決済の開始が多い週は突合されない決済が残り得る(paymentsのRisks。超えた分は4:21の確認でpaymentsが反映し、反映の期限切れとして自動で返金される)。
- 組み合わせ決定と同時の変更 — 凍結と条件付きの書き込み、同じ依頼キーの返金。
- 返金の依頼の失敗 — 枠に`refund_status = 'pending'`を残し、4:21のジョブで依頼し直す。
- match-engineの`ByeCard`の文言が予選向け(「ディレクトリに掲載されます」)のまま — 本specが依頼した改訂として、match-engineのspecが`match.kind`による切り替えを反映した(match-engineの仮7、2026-10-24に開発者が確定)。本specは文言を実装せず、match-engineの改訂の完了を前提にする。

## References

- `docs/requirements/README.md` — 4.13、FR-PYMNT-010・012〜014、FR-PPLAN-006・008、FR-RELCH-004、FR-PRDCT-014、FR-NOTIF-001・004・006・007
- `docs/GUIDES/service/overview/004-week-tournament-rules.md` — シード・組み合わせ・N = 13の例・不戦勝の連鎖
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 週次タイムラインと同時刻の処理の順序
- `docs/GUIDES/service/overview/002-pricing-and-plans.md` — 参加費・免除条件・期限を35分早める理由
- `docs/GUIDES/service/overview/006-relaunch-rules.md` — FR-RELCH-004の解除の時点
- `docs/GUIDES/service/legal/004-legal-notice-outline.md` — 返金ポリシー
- `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md` — 画面と文言
- `mockups/src/routes/client/top/-components/tournament-section.tsx`・`final-showcase.tsx`、`mockups/src/routes/client/p/$handle/-components/payment-panel.tsx`・`trophy-shelf.tsx`
- [Single-elimination tournament(シードの配置)](https://en.wikipedia.org/wiki/Single-elimination_tournament) — 上位シードが早いラウンドで当たらない配置の列

## 決定事項(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要した論点である。要件定義書と上流specに最も整合する案で要件・設計・タスクを作り、**2026-10-24に開発者がすべて推奨どおりに確定した。** `requirements.md`の「要件フェーズでの決定事項」にも同じ行がある。本specに開発者の確認を待つ論点は残っていない。

| #   | 論点                                                    | 採用した案                                                                                                                                                    | 他の選択肢                                    | 影響する箇所                                                                |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| 仮1 | 敗退後の禁止期間・Week優勝作                            | 結果の確定後は禁止期間を掛けない。Week優勝作はYearの条件に任せる(product-launchの仮1と同じ)                                                                   | 敗退後も7日・2日 / Yearの組み合わせまでに短縮 | 要件11.3・11.4、`WeekRelaunchConditionSource`、再ローンチ規則               |
| 仮2 | 組み合わせ決定時点の非公開化・停止                      | 組み合わせから除き参加資格を停止する                                                                                                                          | 含めて開始時点で相手の不戦勝                  | 要件4.4、`WeekDrawService`の分類、Weekトーナメント規則                      |
| 仮3 | 停止・非公開化による参加資格の停止の返金                | 仮2で除いた決済済みの参加費を自動で全額返金。決定後の不戦敗は返金しない                                                                                       | 管理者が手動で返金 / 返金しない               | 要件4.5・4.6、`WeekEntryFollowUp`・`refundReasonFor`、返金ポリシー          |
| 仮4 | ブラケットの表示の場所                                  | `/tournaments/week/{ISO週}`の公開のページ                                                                                                                     | トップページに全ラウンド / 表示しない         | 要件8.2・9、`BracketPage`・`WeekBracketReader`、ページ配置                  |
| 仮5 | 期限の後の反映と次回の予約                              | 禁止は決済期限で解除し、期限後の反映は新しいローンチがあれば拒否して自動返金                                                                                  | 組み合わせ決定まで禁止を続ける                | 要件2.8・11.1、`WeekEntryFulfillment`・`WeekRelaunchConditionSource`        |
| 仮6 | 本機能の自動返金の知らせ                                | 返金の旨と理由をメールで知らせる(退会済みには送らない)                                                                                                        | 決済履歴への反映だけ                          | 要件4.8、`WeekEntryFollowUp`・`tournament-week.entry-refund`                |
| 仮7 | ブラケットの表示のYearでの再利用(tournament-yearの依頼) | apiに`buildBracketRoundsView`を置きGraphQLの`BracketRound`以下をその値だけから解決、clientの4部品を`BracketRoundFields`のフラグメントと`MatchProduct`で受ける | Yearが自分の表示を作る                        | 設計の`BracketViewBuilder`・GraphQL・client、タスク6.6・6.7・6.10・7.1・7.4 |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID                     | 内容                                                                                                                                                                      | 根拠     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-TOURW-007               | 組み合わせ決定の時点で非公開化中・投稿者が停止中のプロダクトは組み合わせの対象とせず、そのトーナメントの参加資格を停止する旨を加える                                      | 仮2      |
| FR-PYMNT-010・FR-PYMNT-012 | FR-TOURW-007の時点の非公開化・停止で参加資格を停止した場合も、決済済みの参加費を自動で全額返金し、非同期で処理する旨を加える(FR-TOURY側はtournament-yearの判断に合わせる) | 仮3      |
| FR-RELCH-004               | トーナメントの結果の確定後は、敗退であってもFR-RELCH-002・003の禁止期間を掛けない旨を明記する                                                                             | 仮1      |
| FR-TOURW-003・FR-PYMNT-013 | 決済期限の後に反映された決済は、同じプロダクトのより新しいローンチが予約されていれば参加資格を与えず、FR-PYMNT-014と同じく自動で全額返金する旨を加える                    | 仮5      |
| FR-TOURW-020・FR-TOURW-023 | 次ラウンドの予定を実施日の0:00までに作れなかった場合(障害)は、そのラウンド以降を1日ずつ遅らせる旨を加える                                                                 | 要件6.10 |

## 上流・後続specへの影響

- match-engine(上流): 登録箇所への追記だけ。`MATCH_EVENT_HANDLERS`に`tournament-week.qualifier-entry`(`decided`・`qualifier`、1500)・`tournament-week.decided-round-progress`(`decided`・`week`、1510)、`TOP_PAGE_SECTIONS`に`tournament-week.matches`(`main` 20)・`tournament-week.final`(`showcase` 20)。**改訂の依頼(match-engineの仮7として確定、2026-10-24)**: `ByeCard`の文言を`match.kind`で切り替え、`week`・`year`の不戦勝は「対戦相手不在のため不戦勝。次のラウンドへ進みます。」、早期の勝利は「対戦相手が不在になったためマッチ終了。{n}票のUpvoteで確定し、次のラウンドへ進みます。」とする(現行は予選向けの「ディレクトリに掲載されます」)。match-engineのspecが反映し、本specのタスクには含めない。
- payments(上流): `PURCHASE_KIND_REGISTRATIONS`に`week_tournament_entry`(`WEEK_TOURNAMENT_TYPES.WeekEntryOfferPolicy`・`WeekEntryFulfillment`、`backend-lib/workers/week-tournament`でapi・eventの両方に束縛)。`PaymentRefunds.request`の依頼キーは`tournament-week:<購入ID>:<理由>`(理由`entitlement_lost`・`entitlement_suspended`)。決済実装方針(`features/004`)の購入種別の表へ行を追記する。23:40の突合の上限200件(paymentsのRisks)は参加数の多い週で影響し得る。
- ultras-subscription(上流): `ULTRAS_ACTIVATION_HANDLERS`に`tournament-week.ultras-entry-exemption`(1500)・`tournament-week.open-entry-checkout-expiry`(1510)。Q1・Q2を適用し、`UltrasPromotionGate`でUltrasの案内を包む。返金ポリシーの「停止・非公開化に伴うトーナメント参加資格の停止」の行のWeekの部分は仮3で判断した。
- notifications(上流): `RESULT_NOTICE_SUPPLEMENTS`に`tournament-week.entry-deadline`(`qualifier`、1500)。`NotificationEventPublisher.publish({ publisher: 'tournament-week' })`で`match_preview`・`match_result`・`award`を発行する。 notificationsの仮2(2026-10-24に開発者がCを選択)により、apiの`EVENING_DISPATCH_PARTICIPANTS`に`'tournament-week.evening-bracket'`を登録し、23:45のジョブ`tournament-week.evening-bracket`(1500)の最後に`EveningDispatchGate.markReady({ participant, date: context.business.date, at })`を呼ぶ。notifications側の追加の変更は不要(契約どおり)。
- product-launch(上流): `RELAUNCH_CONDITION_SOURCES`に`tournament-week.result-pending`、`PRODUCT_LOCK_SOURCES`に`tournament-week.bracket-lock`、`LAUNCH_SUMMARY_SOURCES`に`tournament-week.launch-summary`(いずれも1500)、`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`に`tournament-week.product-entry-loss`(`deleted`、1500)・`tournament-week.entry-unlink`(`purge_due`、1500)、`MY_PRODUCT_SECTIONS`・`PRODUCT_DELETE_NOTICES`に各1件(10)。要約の`rank`はWeekが10〜50を使う。
- directory-discovery(上流): `PRODUCT_PAGE_SECTIONS`の`main` 10に`tournament-week.trophies`(Yearの受賞も本specの`TOURNAMENT_TROPHY_SOURCES`で同じ棚に並べる)、`PRODUCT_OWNER_ACTIONS`の10に`tournament-week.entry`(予約どおり)。
- identity-auth(上流): `USER_LIFECYCLE_ASYNC_HANDLERS`に`tournament-week.account-entry-loss`(`withdrawn`、1500)。`UserContactDirectory.findContact`で返金の知らせの宛先を引く。
- backend-platform・email-delivery(上流): `SCHEDULED_JOBS`に2件(23:45の`tournament-week.evening-bracket`の1500、4:21の1500。Cronの式は追加済み)、`EMAIL_KINDS`・`EMAIL_TEMPLATES`に`tournament-week.entry-refund`。E2Eはbackend-platformの改訂2の共用の補助`triggerScheduled`(`e2e/support/scheduled-trigger.ts`)でローカルの定期実行を起動し、独自の起動の仕組みを持たない。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は1500、波及処理は1500」になる(23:45のジョブ1500、プロダクトライフサイクル1500、マッチイベント1500・1510、Ultrasの知らせ1500・1510、結果通知の追記1500)。Requirement Ambiguitiesの3行の解決の列への追記は「仮決定」の表のとおり(仮1・Q1とQ2の適用・仮3)。本specはroadmapを編集しないため、コントローラーへ報告する。
- tournament-year(後続): 仮7(tournament-yearの依頼)により、apiの`buildBracketRoundsView`(`apps/api/src/application/tournament/bracket-view-builder.ts`)・GraphQLの`BracketRound`・`BracketNode`・`BracketSlot`、clientの`BracketRoundColumn`・`BracketRoundTabs`・`BracketMatchCard`・`BracketChampion`と`graphql/operations/week-tournament/week-bracket.ts`の`BracketRoundFields`を使う。`core/tournament`の規則、`BracketDraw.create`(`kind: 'year'`、非シードの比較はローンチ日だけ、`RoundSchedulePolicy`は決勝日からの逆算)・`BracketProgression.advance`・`BracketStore`の読み取り、`WeekChampionDirectory.listChampions`(FR-TOURY-001の対象)、`TOURNAMENT_TROPHY_SOURCES`(Yearの供給元、10)を使う。本specのテーブルへ直接書き込まない。要約の`rank`は60以上を推奨する。`tournament-week.entry-pending`・`result-pending`の解除の後の禁止(Week優勝からYearの結果確定まで)はtournament-yearが供給する(仮1)。返金ポリシーの停止・非公開化の行のYearの部分を判断する。
- ugc-moderation(後続): 停止・非公開化をidentity-auth・product-launchのライフサイクルで発火すれば、組み合わせ決定の前は本specの分類で除外と返金(仮2・仮3)、決定の後はmatch-engineの開始時点の決着で不戦敗になる。本specを直接呼ぶ必要は無い。停止・非公開化の通知の文面で、組み合わせ決定の時点で公開されていなければ参加費が返金される旨を伝えられる。
- data-export(後続): `WeekAwardExport.listForLaunches`で`launches.json`の`awards[]`の`product_of_the_week`を作る。マッチは`MatchExport`。

## 要件のレビュー(2026-10-24)

- 機械的な確認: 15の要件の見出しがすべて数字のIDを持ち、114件の受け入れ基準がすべてEARSの形式(`When`・`If`・`While`・`Where`・`The … shall`)である。技術名は要件定義書の用語(Stripe・Webhook・DR-015など)と外部リンクの`rel`の値(ページ配置の規則)だけに限った。
- 判断のレビューで問題は無かった。要件定義書・サービス仕様で決まらない論点は仮1〜仮6として記録し、要件の範囲の推測は加えていない。タスクの検証で見つかった曖昧さ(48時間の起点)により、要件10.2を「画面に表示する期限(受付期限の23:00)」に明確化した(料金及びプラン体系の「UIには23:00を決済期限として表示する」に合わせた)。

## 設計のレビュー(2026-10-24)

- 機械的な確認: 要件の114件の受け入れ基準の番号がすべて追跡表にあることを、スクリプトで確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、(1)GraphQLの結果の列挙の名前をmatch-engineの`MatchEntryResult`に合わせた、(2)`BracketDraw.create`の比較の型を`unknown`から型引数に直し、参加者の入力を候補に含めて重複を除いた、(3)research.mdのリスクの記述の曖昧さを直した。2回目で問題は無かった。タスクの検証の後に、期限を週の行の列から読む規則を明記した(E2Eで時刻を進めるため)。
- 境界の確認: マッチ・決済・特典・通知のテーブルへ書き込まず、上流の部品だけを使う。汎用のブラケットのテーブルは本specが所有し、tournament-yearは部品越しに使う。上流の改訂を要するのはmatch-engineの`ByeCard`の文言だけである。
- 技術ドキュメントの番号: 本specは`backend/017-single-elimination-brackets`・`frontend/016-tournament-bracket-view`を使う。notificationsの設計は`backend/015`・`security/009`をdirectory-discoveryが取ると想定して自らを`backend/016`・`security/010`にしたが、directory-discoveryはbackend・securityの技術ドキュメントを計画していない(計画は`db/007`・`frontend/014`)。`backend/015`・`frontend/015`はengagement、`backend/016`はnotifications、`security/009`はlaunch-readiness(`security/009-monitoring-and-alerting`)が使う。本specはengagementの次を1つ飛ばした番号を取り、sponsorshipは2つ飛ばした`backend/018`・`frontend/017`を取る取り決めに従った。
- 参照したスキル: cc-sddの`kiro-spec-init`・`kiro-spec-requirements`・`kiro-spec-design`・`kiro-spec-tasks`の規則とテンプレート。新しいパッケージが無いため外部の調査はシングルエリミネーションのシードの配置の確認に限った。

## タスクの計画の検証(2026-10-24)

- `/kiro-spec-tasks tournament-week -y`の手順で、要件と設計を承認し(`-y`による自動の承認)、タスクの計画の下書きを作った。要件の114件の受け入れ基準の番号がすべてタスクにあることを機械的に確かめた。
- タスクのグラフのサニティレビューを2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
- 1回目の判定はNEEDS_FIXES(必須4件・軽微7件)だった(以下のタスクの番号は当時のもの)。指摘は、(1)登録口への追加がDIの束縛より前のタスクにあり、paymentsの反映の経路のテストが束縛の前に置かれていた(登録を束縛のタスク4.14・5.5・6.7にまとめた)、(2)直前のタスクの識別子・生成物を使うタスクの(P)(5.2・6.2・7.2の(P)を外した)、(3)Weekのストアのタスクが大きすぎる(4.1〜4.3に分けた)、(4)E2Eの決勝を確定させる前提が無い(補助を8.3に分け、参加2のブラケットと決勝の日時の移動を加えた)。軽微の指摘(時刻の境界のテストの明記、8.1のテストの環境、6.4の分割、48時間の起点、ログの検査の追加)にも従って直した。
- 2回目の判定はNEEDS_FIXES(必須1件・軽微5件)だった。1回目の4件の修正は確認された。必須の指摘は、E2Eの時刻の前提(先週の固定の期限では決済と組み合わせ決定を同じ日に行えない、組み合わせの1回戦は翌日になるためトップページの当日の区画に出ない、開始を記録しないと23:40の確定の対象にならない)で、補助を4段(未来の期限での作成・期限の過去への移動・決勝を今日の開始済みにする・終了を過去へ移す)に改め、8.4に順序を明記し、設計に「期限は週の行の列を正とする」を加えた。軽微の指摘(22:59と23:00の境界をapiの6.10へ移す、6.2の分割(6.3を新設)、トロフィーの登録口と束縛の順の注記、補助が作る利用者・プロダクト・ローンチの明記、冗長な`_Depends:_`の削除)にも従って直した。
- kiro-spec-tasksの規則(2回目の判定がPASSでなければ、それ以上レビューを繰り返さずに止める)に従い、3回目のレビューを行っていない。`tasks.md`は2回目の指摘を直した下書き(54のサブタスク)で、タスクの承認(`approvals.tasks`)は行っていない(match-engine・directory-discoveryと同じ扱い)。`/kiro-spec-tasks tournament-week -y`を既存の`tasks.md`を引き継ぐ形で再実行し、サニティレビューがPASSになれば承認される。

## タスクの計画の再検証(2026-10-24、コーディネーターの指示による再実行)

- 完了済みの兄弟specとの照合: sponsorshipの`PRODUCT_DELETE_NOTICES`は`sponsorship.active-ads`(30)で、本specの`tournament-week.entry-loss`(10)と重ならない(変更なし)。`TOP_PAGE_SECTIONS`(sponsorshipはbanner 5・aside 10・bottom 10)・`PRODUCT_PAGE_SECTIONS`(sponsorshipはbanner 10・aside 30・bottom 20、engagementはaside 20)とも、本specの`main` 20・`showcase` 20・`main` 10と重ならない。
- match-engineの`ByeCard`の文言の切り替えは、本specが依頼した改訂としてmatch-engineのspecが仮7として反映した(2026-10-24に開発者が確定)。design.mdの「上流への影響」とresearch.mdの記述をその扱いに改め、tasks.mdには1.1の前提に加えるだけにし、7.2で文言を実装・確認しないと明記した。
- `/kiro-spec-tasks tournament-week -y`を、2回目の指摘を直した`tasks.md`を既存の下書きとして引き継ぐ形で再実行した。要件の114件の受け入れ基準の番号がすべてタスクにあることを機械的に確かめた。新しいサブエージェントによる独立した確認(independent)を、通常の2回の上限で行った。
- 1回目の判定はPASSだった。軽微の指摘7件のうち、(1)メールのテンプレートの置き場所をemail-deliveryの`apps/event/src/infrastructure/email/templates/`にそろえ、テストを`*.worker.test.tsx`にした、(2)7.2・7.5のブラケットへのリンクを、サーバーが返す`bracketPath`の通常のリンクにすると明記した(7.4と独立に進められる)、(3)4.11が凍結の書き込みと分類の対象の一覧をストアに加えてよいと明記した、(4)4.14のpaymentsの経路の確認をapiのテストの環境に置き、8.1はbackend-libの`WeekProgressionService`を直接呼ぶと明記した、(5)7.6に押下の後の`checkout_closed`・`week_entry_*`の文言の表示を加え要件2.2を対応づけた、(7)価格の作成をdevとstagingのsandboxで行う旨にした、に従って直した。残りの1件(4.11・4.12・3.2・6.9・8.4の作業量)は、1つのまとまった作業の単位で分割を求めない指摘のため変えていない。タスクを承認した(54のサブタスク)。

## tournament-yearの依頼の反映(仮7、2026-10-24、コーディネーターの指示による)

- (解決済み)tournament-yearのタスク5.8・6.4は、Yearのブラケットのページで本specの表示を再利用するための改訂を待っていたが、本節の仮7の反映で解決した(tournament-yearのdesign.mdの「上流への影響」は「tournament-weekの仮7で提供済み」になっている)。依頼の内容は、(1)apiの`apps/api/src/application/tournament/bracket-view-builder.ts`に`buildBracketRoundsView(input: { readonly record: BracketRecord; readonly matchViews: ReadonlyMap<string, MatchView>; readonly now: Date }): BracketRoundsView`(`participantCount`・`seedCount`・`rounds`・`championNo`)を置き、GraphQLの`BracketRound`・`BracketNode`・`BracketSlot`をこの値だけから解決し、`WeekBracketReader`が使う、(2)clientの`BracketRoundColumn`・`BracketRoundTabs`・`BracketMatchCard`・`BracketChampion`を、`graphql/operations/week-tournament/week-bracket.ts`が書き出す`BracketRound`のフラグメント`BracketRoundFields`と`MatchProduct`の型(`rounds`・`champion`・`finished`)で受け、`WeekBracket`の型に依存させない、の2点である。
- 仮7として記録した(2026-10-24に開発者が推奨どおりに確定)。受け入れ基準は変えず、要件9.2〜9.4・13.3の実現の形を決める設計上の決定である。他の選択肢「Yearが自分の表示を作る」は、同じ規則の表示が2つになりずれる。
- 反映した内容: design.mdに`BracketViewBuilder`の節(`BracketSlotView`・`BracketNodeView`・`BracketRoundView`・`BracketRoundsView`)、`WeekBracketView`の`rounds: BracketRoundsView`への変更、GraphQLの解決の規則、clientの`BracketRoundFields`と`BracketViewProps`、ファイル構成(`bracket-view-builder.ts`・`bracket-view-props.ts`)、Allowed Dependencies・Revalidation Triggers・追跡表・部品の表を加えた。未来のラウンドのシードは、予定のマッチが無い間はプロダクトを持たず「シード<n>」と表記する(関数の入力が記録とマッチの表示だけのため)。タスクは、6.6を関数の作成と単体テスト(読み込みの制限の検査を含む)に改め、ブラケットのページの照会を6.7として分け(旧6.7〜6.10は6.8〜6.11へ繰り下げ、参照する`_Depends:_`と本文の番号も直した)、6.10(旧6.9、`BracketRound`以下を値だけから解決するテスト)・7.1(`graphql()`の文書としてのフラグメント`BracketRoundFields`・`BracketMatchProductFields`の書き出し)・7.4(共用の4部品をフラグメントだけで描くブラウザテスト、Weekのページの組み立てを`components/week-tournament/week-bracket-page.tsx`の`WeekBracketPage`へ移した)を改めた。タスクの数は55になった。
- 変更部分のタスクのグラフのサニティレビュー(新しいサブエージェントによる独立した確認、上限2回): 1回目はNEEDS_FIXES(必須3件)。(1)フラグメントの宣言がmatch-engineに無いフラグメント名とgql.tadaの型の書き方を使っていた(client presetの`graphql()`の文書と生成される型に改め、`MatchProduct`のフラグメント`BracketMatchProductFields`を本specが書き出す形にした)、(2)共用のディレクトリにWeekのページが置かれていた(`WeekBracketPage`として`components/week-tournament/`へ移し、部品の表の行を分けた)、(3)6.6が大きすぎ2つの部品にまたがっていた(関数と照会に分けた)。
- 2回目もNEEDS_FIXES(必須1件)。上の3件の修正は確認された。必須の指摘は、フラグメントの選択がGraphQLの項目名と合っていない(`MatchProduct`に`productId`・`categoryId`は無く`category`と`logo`は下位の選択が要る、`Match`の実施日は`date`)ことで、design.mdの選択をスキーマに合わせて直し、7.1に項目名をスキーマに合わせる旨を加えた。軽微の指摘(フラグメント`BracketMatchProductFields`を書き出しの契約の記述へ加える、6.9の束縛の対象から純粋な関数を除く)にも従った。上限の2回に達したため3回目のレビューは行わず、タスクの承認(`approvals.tasks.approved`)は外したままにした。変更部分のレビューを再実行してPASSになれば承認される。

## タスクの計画の再検証(2026-10-24、コーディネーターの指示による再実行、仮7の反映の後)

- `/kiro-spec-tasks tournament-week -y`を、現在の`tasks.md`を既存の下書きとして引き継ぐ形で再実行した。新しいサブエージェントによる独立した確認(independent)を通常の2回の上限で行い、フラグメントの選択をmatch-engine・product-launch・media-pipelineのスキーマと照合させた。
- 1回目の判定はNEEDS_FIXES(必須2件)。フラグメントの選択とclient presetの規約の照合は問題なし。必須の指摘は、(1)優勝したプロダクトが表示できない場合(非公開化・停止など)に`champion`がnullになり、`BracketChampion`が「受賞なし」と誤って表示する(参加1ではラウンドも空で判別できない)、(2)E2Eの前提の価格の作成の依頼が最後の8.4にある、の2件。(1)は`BracketViewProps`に`awarded: boolean`を加え(**仮7の契約の変更。公開の名前`buildBracketRoundsView`・`BracketRoundFields`・`BracketMatchProductFields`・`BracketViewProps`は変えていない**)、Weekのページは`WeekBracket.tournament.awarded`から渡す形にした。tournament-yearも同じ部品に`awarded`を渡す必要がある(Revalidation Triggersの対象)。(2)は価格の作成の依頼を1.1へ移し、8.4は有無の確認だけにした。軽微の指摘(7.4を共用の4部品(7.4)とWeekのページとルート(7.5)に分けて契約の部品を独立させ、旧7.5〜7.7を7.6〜7.8へ繰り下げ参照を直した。6.10の完了状態にapiのスキーマの生成を加えた。決済実装方針のファイル名を`features/004-payments.md`と明記した。フラグメントの型を`TypedDocumentNode`にした)にも従った。タスクの数は56になった。
- 2回目の判定はPASSだった。1回目の修正とフラグメントの選択(match-engineの`MatchProduct`・`Match`、product-launchの`ProductCategory`、media-pipelineの`MediaImage`、本specの`BracketRound`以下)の照合が確認された。軽微の指摘3件(Revalidation Triggersの引数に`awarded`を加える、`WeekTournamentSummary.awarded`の導き方とnullの扱いを明記し6.10にテストを加える、価格の前提を8.4だけに絞る)に従って直した。タスクを承認した(56のサブタスク)。

## cross-spec reviewの指摘による修正(2026-10-24)

いずれもcross-spec reviewの指摘による整合の修正で、利用者・運営者から見える振る舞いは変えないため、仮の番号を付けない(開発者の判断を要しない)。

- GraphQLのルート型: api-gatewayのスキーマモジュールの規約(各モジュールは`extend`を使わず`type Query`・`type Mutation`をそのまま書き、同名のルート型の結合はYogaに任せる)に合わせ、design.mdの`extend type Query`・`extend type Mutation`を`type Query`・`type Mutation`に改め、tasks.mdの6.10・6.11にその旨を加えた。
- paymentsのDIの識別子の名前を`PAYMENTS_PLATFORM_TYPES`から`PAYMENTS_TYPES`に改めた(Allowed Dependencies)。
- Ultrasの知らせの2つの処理のクラスがtournament-yearと同じ名前だったため、`WeekUltrasEntryExemptionHandler`・`WeekOpenEntryCheckoutExpiryHandler`に改め、ファイル名を`week-ultras-entry-exemption-handler.ts`・`week-open-entry-checkout-expiry-handler.ts`にした(tournament-yearは`Year`を前に付ける)。登録の名前(`tournament-week.ultras-entry-exemption`・`tournament-week.open-entry-checkout-expiry`)と`order`は変えない。tasks.mdの5.3の`_Boundary:_`を直した。
- E2Eのローカルの定期実行の起動: 独自の起動(apiの`--test-scheduled`への直接の要求)を使わず、backend-platformの改訂2が所有する共用の補助`triggerScheduled`(`e2e/support/scheduled-trigger.ts`)を使う形にした。理由は、業務時刻とCronの式の対応を1か所に置き、specごとの起動の仕組みのずれを防ぐため。design.mdのAllowed Dependencies・Revalidation Triggers・「上流への影響」・ファイル構成・Testing Strategy、tasks.mdの1.1の前提と8.3(前提と補助の手順)・8.4(補助による起動の明記)を直した。
- 上流の依存: roadmapが本specの依存にdirectory-discoveryを宣言したことに合わせ、design.mdのExisting Architecture Analysisに依存の宣言と理由(`PRODUCT_PAGE_SECTIONS`・`PRODUCT_OWNER_ACTIONS`への登録)を明記した。Allowed Dependencies・Revalidation Triggers・「上流への影響」には既にあった。
- 本ファイルの古い記述の訂正: tournament-yearのタスク5.8・6.4の改訂待ちを、仮7の反映で解決済みと改めた。技術ドキュメントの番号の理由を、実際の使用(`backend/015`・`frontend/015`はengagement、`security/009`はlaunch-readiness、directory-discoveryはbackend・securityの技術ドキュメントを計画していない(計画は`db/007`・`frontend/014`))に合わせて直した。番号(`backend/017`・`frontend/016`)は変えない。
- 変更部分(1.1・5.3・6.10・6.11・8.3・8.4)のタスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定はPASSだった(要件の114件の受け入れ基準の番号がすべてタスクにあること、56のサブタスクを確認)。軽微の指摘3件(Testing StrategyのE2Eの組み合わせ決定の手順で23:40と23:45の両方を動かすとタスクにそろえる、8.4に補助による起動を明記する、6.11にルート型の規約を明記する)に従って直した。タスクの承認(`approvals.tasks.approved`)は維持した。

## 決定事項の確定とnotificationsの仮2の反映(2026-10-24、コーディネーターの指示)

- 本specの仮1〜仮7は、2026-10-24に開発者がすべて推奨どおりに確定した。requirements.md・design.md・tasks.md・本ファイルから確認待ちの記述を除き、確定の旨を記した。本specに開発者の確認を待つ論点は残っていない。match-engineの`ByeCard`の文言の切り替えも、match-engineの仮7として確定した。
- notificationsの仮2は、開発者が推奨と異なるC(トーナメントのジョブの最後に夜の送り出しの入口を呼ばせる)を選び、notificationsが契約を定めた(`core/notifications/evening-dispatch.ts`の`EveningDispatchGate.markReady(input: { participant: string; date: BusinessDate; at: Date }): Promise<EveningDispatchReadiness>`、戻り値`waiting`・`dispatch-requested`・`already-requested`、例外`EveningDispatchError`(`unknown-participant`・`invalid-date`)、冪等。apiだけが`NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate`で束縛。前提の登録口`EVENING_DISPATCH_PARTICIPANTS`)。本specは次のとおり反映した。
  - 23:45の2つのジョブ(`tournament-week.bracket-draw`の1500・`tournament-week.round-progress`の1510)を1つの`tournament-week.evening-bracket`(1500)にまとめた。毎晩、組み合わせ決定→その日に確定した予選の枠の追いつき→全トーナメントの進行(処理の済んでいない確定のマッチイベントへの同期の追いつき)→その夜の通知イベントの発行(新設の`WeekNotificationPublisher.publishNight`)→最後に`markReady`の順に行い、組み合わせや進行が無い夜も呼ぶ。いずれかが失敗したら全てを試した後に例外を投げ、`markReady`を呼ばない(送り出しはnotificationsの23:55の期限)。戻り値で処理を変えない。
  - 23:50を前提にした記述(要件12.2・12.3、設計の流れ・発行の時刻、タスク8.1)を除いた。要件12.7(毎晩の準備の完了)・12.8(失敗時に伝えない)を加えた。受け入れ基準は114件から116件になった。
  - `EVENING_DISPATCH_PARTICIPANTS`への`'tournament-week.evening-bracket'`の登録をタスク6.9に加えた。予選の`RESULT_NOTICE_SUPPLEMENTS`(`qualifier`、1500)は変えない。
  - roadmapの帯の割り当ての表の本specの「使用中の値」は「4:21は1500、波及処理は1500」のまま(23:45のジョブは1500だけになった)。
- 変更したタスク: 1.1(前提)・1.3(日次タイムラインの記述)・4.3(受賞の一覧の読み取り)・4.7(`publishNight`)・6.1(夜の処理の順序と`markReady`)・6.9(ジョブ2件と前提の登録)・8.1(`markReady`の順序の統合テスト)。タスクの数(56)は変えていない。
- 要件定義書の改訂: 本specの持ち分では不要(23:45の送り出しの時刻に関するFR-NOTIF-001・004の改訂の要否はnotificationsが判断する)。
- 変更部分の設計とタスクのレビュー(新しいサブエージェントによる独立した確認、上限2回): 1回目は設計・タスクともNEEDS_FIXES(必須2件)。`publishNight`がその夜の受賞を読む口が無かったため、`WeekTournamentStore.listAwardedBetween(from, to)`を加え(タスク4.3)、4.7はストアを変えずに読む形にして`_Depends: 4.3_`を明記した。軽微の指摘(Testing Strategyの夜の処理の記述をタスクの分担(6.1の単体テスト・8.1の統合テスト)に合わせる、失敗の分類の行に予選の枠の追いつきを加える、6.1で`captureMessage`を確かめる、構成図の名前)にも従った。
- 2回目は設計・タスクともPASSだった(116件の受け入れ基準がすべて設計の追跡表とタスクにあること、notificationsの呼ぶ側の契約との一致、23:50と廃止したジョブの名前が残っていないことを確認)。軽微の指摘4件(`publishNight`の`at`の明記、`drawDue`・`advanceAll`の失敗の一覧が空でない場合も失敗として扱う旨、部品の表の12.7、変更タスクの一覧の4.3)に従って直した。承認を維持した。
