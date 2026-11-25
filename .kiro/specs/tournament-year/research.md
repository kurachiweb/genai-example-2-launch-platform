# Research & Design Decisions

## Summary

- **Feature**: `tournament-year`
- **Discovery Scope**: Complex Integration(Yearトーナメントの実装は無い。上流の23spec(dev-tooling〜sponsorship)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはtournament-weekの汎用のブラケット(`core/tournament`・`workers/tournament`の`BracketDraw`・`BracketProgression`・`BracketStore`)・`WeekChampionDirectory`・`TOURNAMENT_TROPHY_SOURCES`とトロフィーの区画、match-engineの`MatchScheduler`・`MatchDirectory`・確定のマッチイベント・`MatchViewReader`・対戦カードの部品・トップページの区画、paymentsの購入種別の口・`PaymentRefunds`・`OpenCheckoutExpirer`・`CheckoutStarter`・`PriceCatalog`、ultras-subscriptionの`UltrasEntitlements`・`ULTRAS_ACTIVATION_HANDLERS`・`ADMIN_SETTINGS_SECTIONS`、admin-foundationの`requireAdmin`・`AuditLogRecorder`・`defineAuditAction`、notificationsの`NotificationEventPublisher`・`RESULT_NOTICE_SUPPLEMENTS`、product-launchの判定の供給元の3つの登録口・`ProductDirectory`・プロダクトライフサイクルの登録口・`MY_PRODUCT_SECTIONS`・`PRODUCT_DELETE_NOTICES`、directory-discoveryの`PRODUCT_OWNER_ACTIONS`、identity-authのユーザーライフサイクルの登録口と`UserContactDirectory`の上に、Yearトーナメントと決勝実施日の設定を足す)
- **Key Findings**:
  - tournament-weekのブラケットの部品は種類(`week`・`year`)と識別子で区別され、`BracketDraw.create`に比較(`order`)と実施日の方針(`RoundSchedulePolicy`)を渡せばYearでもそのまま使える。Yearの1回戦の日(FR-TOURY-014)は「決勝日 −(ラウンド数 − 1)日」と一致し、`dailyRoundPolicy(決勝日からの逆算の日, now)`をそのまま使える。本specはシード・組み合わせ・進行・不戦勝の規則を実装しない。
  - 対象期間(FR-TOURY-001)は「前年の決済期限日〜今回の決済期限日の前日」であり、前年の組み合わせ決定で前年の対象の枠はすべて終わった状態(組み合わせ・期限切れ・除外・喪失)になる。そのため、ある年の対象は「まだ終わっていない枠のうちWeek優勝の日がその年の決済期限日より前のもの」と表せ、枠に対象年を保存しなくてよい。この表し方は初年度の「起点を設けない」(前年に開催していなければ前年の対象の枠が終わらずに残る)と、決勝実施日の変更による対象期間の移動を、付け替えの処理なしにそのまま満たす。
  - 決勝実施日の間隔が64週未満でも、Week優勝の日は週ごとに最大9日ほどずれる(参加数で決勝の曜日が変わる)ため、対象期間のWeek優勝が65件になり得る。さらに翌年の決勝実施日が未設定のまま既定の日になる場合はFR-ADMCF-003の検査を通らない。Yearトーナメント規則の「参加数上限64(決勝日設定の制約により保証)」は成り立たず、上限を超えた場合の規則が要る(仮2)。参加数65以上は、組み合わせ決定(決勝日の6日前の23:45)の翌日から決勝日までの6日間に7ラウンドを収められない。
  - Week優勝の記録はtournament-weekが行い、`decided`のWeekのマッチイベントの処理(1510)・23:45のジョブ`tournament-week.evening-bracket`(1500)のどちらかで確定する。match-engineの実行器は同じイベントの処理を`order`の昇順に直列に動かすため、`decided`・`week`の処理を1700で登録すれば、Week優勝の記録の直後に参加の枠を作れる。23:45のジョブ(1700)で取りこぼしを補う。
  - 管理画面の設定ページの区画は、notificationsの送信者情報(`notifications.sender-info`、30)と同じ形(`requireAdmin(..., 'super_admin')`・版の条件付きの保存・`buildAuditLogStatements`を同じ一括の書き込みに含める・`ConfirmActionDialog`)で作れる。区画の登録口は`ADMIN_SETTINGS_SECTIONS`の`order` 10が本specに予約されている。
  - tournament-weekのブラケットのページは`WeekBracket`の照会と`components/bracket/`の部品で作られるが、当初の設計では照会の組み立てと部品の引数がWeekの型に結び付くかが定まっていなかった。本specの依頼により、tournament-weekの仮7が、種類によらない組み立ての純粋な関数`buildBracketRoundsView`と、フラグメント`BracketRoundFields`・`BracketMatchProductFields`と`BracketViewProps`で受ける共用の4部品を提供した(2026-10-24、コーディネーターの通知)。Yearのページはそれを使い、表示の規則を重複させない。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を「仮」として採用した。**仮1〜仮8はすべて2026-10-24に開発者が確定した(いずれも推奨どおり)。** 決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。roadmapの「Requirement Ambiguities」の表のうち本specが担当に含まれる2行(Year初年度と決勝日未設定の行・停止と非公開化の自動返金の行)は、仮1・仮2と仮3・仮4で決めた。roadmapは編集せず、解決の列の文言をコントローラーへ報告する。

| #   | 論点                                                         | 根拠                                                                                                                                                                                                                                                         | 選択肢                                                                                                                                                                                                                                                                                                | 推奨と採用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | 前年の決勝実施日が未設定(既定値)のときの扱いと初年度         | FR-TOURY-001(「対象年より前の決勝実施日が設定されていない場合は、期間の起点を設けずに」)、FR-ADMCF-003(「対象年より前の決勝実施日が設定されていて」)、FR-ADMCF-006(未設定なら5月の最終日曜日)、briefのConstraints、roadmapのRequirement Ambiguities          | (A)前年のYearトーナメントを開催した、または開催する予定なら、前年の実効の決勝実施日(既定の日を含む)を「設定されている」と扱い、前年に開催しなかった(運営の開始前に前年の組み合わせ決定の時刻を過ぎた)ときだけ「設定されていない」とする / (B)管理者が明示的に設定した日だけを「設定されている」とする | 2026-10-24に開発者が確定(推奨どおり)。推奨・採用は(A)。(B)では、前年が既定の日で開催された翌年に起点が無くなり、前年の対象だったWeek優勝が再び対象になって二重に参加でき(FR-RELCH-004の意図にも反する)、64週の検査も効かなくなる。FR-ADMCF-006は未設定の年も既定の日に開催する前提であり、開催した年の既定の日は事実上の決勝実施日である。「設定されていない」が生じるのは本サービスが運営されていなかった年だけで、FR-TOURY-001の但し書きの意図(初年度)と一致する。要件定義書のFR-TOURY-001・FR-ADMCF-003に、既定の日を含む旨を明記する改訂を要する                                                                                                  |
| 仮2 | 参加資格を得たプロダクトが64を超える場合                     | FR-TOURY-012(Pは最大32、すなわちN ≤ 64)、FR-TOURY-014(33〜64は5日前)、FR-ADMCF-003の目的(参加数を64以下にする)、Yearトーナメント規則(「参加数上限64(決勝日設定の制約により保証)」)、Week優勝の日のずれ(Summaryの3つ目)、初年度の起点なし、briefのConstraints | (A)組み合わせ決定の時点で、参加資格を得た表示できるプロダクトのうちWeek優勝の日時が新しい順に64件を対象とし、残りを除外して参加資格を停止する / (B)予選勝利時Upvote数の多い順に64件 / (C)参加資格を得た順に64件 / (D)上限を設けず、組み合わせ決定の当日から1回戦を行う                                | 2026-10-24に開発者が確定(推奨どおり)。推奨・採用は(A)。FR-ADMCF-003は決勝実施日の間隔(期間の長さ)で参加数を抑える規則であり、古いWeek優勝から外すのは期間の起点をわずかに遅らせたのと同じ効果になり、要件定義書の考え方に最も近い。(B)は対象期間の規則と無関係な基準で外す。(C)はUltrasの免除と決済の時刻で順位が変わり公平でない。(D)は組み合わせ決定(23:45)の後に当日のマッチを行えず、7ラウンドを決勝日までに収められない。除外した枠の返金は仮4。発生は初年度に運営開始前のWeek優勝が多い場合や、決勝実施日の間隔とWeek優勝の日の偏りが重なった場合に限られる。要件定義書のFR-TOURY-009・FR-TOURY-012に上限を超えた場合の規則を加える改訂を要する |
| 仮3 | 組み合わせ決定の時点で非公開化中・投稿者が停止中のプロダクト | FR-TOURY-009(「参加資格を得たプロダクトによる組み合わせ」)、FR-TOURY-023(決定後の停止・非公開化は相手の不戦勝)、FR-ADMUG-010、tournament-weekの仮2                                                                                                           | (A)組み合わせから除き、そのトーナメントの参加資格を停止する / (B)組み合わせに含め、開始時点までに復元されなければ相手の不戦勝                                                                                                                                                                         | 2026-10-24に開発者が確定(推奨どおり)。推奨・採用は(A)。tournament-weekの仮2と同じ扱いにし、WeekとYearで規則をそろえる。(B)はシードと組み合わせが表示できないプロダクトで歪む                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 仮4 | 停止・非公開化・上限超過による参加資格の停止の返金           | 返金ポリシー(「ユーザー停止やプロダクト非公開化に伴うトーナメント参加資格停止: 返金する」「トーナメントの不戦勝・不戦敗・両者敗北: 返金しない」)、FR-PYMNT-010・012、paymentsのQ1、tournament-weekの仮3、roadmapのRequirement Ambiguities                    | (A)仮3・仮2で除いた決済済みの参加費を自動で全額返金し、決定後の不戦敗は返金しない / (B)自動では返金せず、管理者がStripeのダッシュボードで返金する / (C)返金しない                                                                                                                                     | 2026-10-24に開発者が確定(推奨どおり)。推奨・採用は(A)。tournament-weekの仮3と同じ理由(組み合わせ決定前に事業者の都合で資格を失う場合に、利用者の都合の削除・退会より不利にしない)に加え、上限超過は利用者に責任が無い。返金ポリシーの文言とも一致し、paymentsの`PaymentRefunds`と同じ経路で実装できる                                                                                                                                                                                                                                                                                                                                                 |
| 仮5 | ブラケットの表示の場所                                       | briefのDesired Outcome(「Year固有の表示」)、ページ配置(Yearのブラケットのページの定義が無い)、tournament-weekの仮4(`/tournaments/week/{ISO週}`)                                                                                                              | (A)年ごとの公開のブラケットのページ`/tournaments/year/{年}`を設け、トップページの区画とトロフィーから導く / (B)トップページの区画の中に全ラウンドを表示する / (C)表示しない                                                                                                                           | 2026-10-24に開発者が確定(推奨どおり)。推奨・採用は(A)。Weekと同じ構成で、tournament-weekのブラケットの部品を再利用できる。ページ配置への追記を本specに含める                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 仮6 | 決済期限の後に反映された参加費と、その間の次回の予約         | 再ローンチ規則(「Weekトーナメント優勝 → 再ローンチ」: 決済期限までに参加資格を得られなかった場合はその時点で解除)、FR-PYMNT-013、tournament-weekの仮5                                                                                                        | (A)禁止は決済期限で解除し、期限の後に反映された決済は、より新しいローンチが予約されていれば参加資格を与えず自動で全額返金する / (B)参加資格を得ていない枠の禁止も組み合わせ決定まで続ける                                                                                                             | 2026-10-24に開発者が確定(推奨どおり)。推奨・採用は(A)。tournament-weekの仮5と同じ扱いにし、再ローンチ規則の解除の時点を変えない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 仮7 | 本機能が行う自動返金の知らせ                                 | paymentsの仮5(自動返金には返金の通知を送る)、briefのConstraints(参加者へのメールの宛先は`UserContactDirectory`)、tournament-weekの仮6                                                                                                                        | (A)本機能が依頼した返金の旨と理由をメールで知らせる(退会済みには送らない) / (B)メールを送らず決済履歴への反映だけにする                                                                                                                                                                               | 2026-10-24に開発者が確定(推奨どおり)。推奨・採用は(A)。仮2の上限超過のように利用者が操作していない返金の理由を伝えられる                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 仮8 | 決勝実施日を設定できる対象年と、翌年との間隔                 | FR-ADMCF-001(「年毎の」「対象年内の日曜日」)、FR-ADMCF-003(前年との間隔だけを検査)、FR-ADMCF-006(未設定の年は既定の日)、ページ配置の管理画面の設定                                                                                                           | (A)対象年は現在の年と翌年の2つとし、翌年が設定済みならその日との間隔も64週未満を求め、翌年が未設定で既定の日との間隔が64週以上になる場合は注意を表示する / (B)対象年を制限せず、前年との間隔だけを検査する                                                                                            | 2026-10-24に開発者が確定(推奨どおり)。推奨・採用は(A)。前年との検査だけでは、対象年を早い日に設定した後に翌年を既定の日のままにすると64週以上空き、FR-ADMCF-003の目的が崩れる。翌年が設定済みの場合の検査は同じ規則を逆向きに当てたもので、新しい制約を加えない。2年より先の年は決勝日の見通しが立たず、設定を許すと検査の連鎖が長くなる。既定に戻す操作は設けず、既定の日を選んで保存できる(要件定義書に既定に戻す操作の記述が無い)                                                                                                                                                                                                                  |

### 確認済みのため質問しない事項

- 参加費の免除の判定時点と決済済みの参加費: ultras-subscriptionのQ1・Q2で決定済み。Week優勝の日時`w`と決済期限`d`に対し`UltrasEntitlements.wasEntitledDuring(投稿者, w, d)`で判定し、Week優勝の確定・加入の有効化・組み合わせ決定の3つの時点で同じ規則を適用する。決済済みの参加費は返金しない。
- 決済期限・受付期限・組み合わせ決定・変更期限の時刻: FR-TOURY-004・009、FR-ADMCF-007、年次タイムライン(D − 7日0:00が変更期限、D − 6日23:35・23:40・23:45)で決まっている。23:40の突合のジョブ(`payments.checkout-reconciliation`、`order` 10)はpaymentsが所有し、本specは結果を`PurchaseFulfillment`で受け取る。反映の期限(`fulfillableUntil`)を23:45にすれば、組み合わせ決定までに反映されなかった決済はpaymentsが自動で全額返金する(FR-PYMNT-014)。
- 「現在時刻の8日後より前」の解釈(FR-ADMCF-002): 決勝日の0:00が現在から8日後以降である日曜日を選べるとする。この解釈では、選べる最も早い決勝日の変更期限(7日前の0:00)は現在から1日後以降になり、FR-ADMCF-007と矛盾しない。
- 「決勝開始時間の7日前以降」(FR-ADMCF-007): 決勝の開始は決勝日の0:00(FR-TOURY-015)であり、変更期限は決勝日の7日前の0:00である(年次タイムラインの「D − 7日(日)0:00」の行の「決勝日の変更期限」と一致)。未設定の年で既定の日を変える保存も同じ期限に従う。
- 「64週間後以降」(FR-ADMCF-003): 決勝日はどちらも日曜日のため、64週間後(448日後)の日曜日以降を拒否する。前年は1月の第1日曜日〜12月の最終日曜日の範囲にあるため、対象年の5月の既定の日は前年の決勝日から最大で約73週後になり得る。
- シード・非シードの並びの同順の扱い: Yearトーナメント規則が「ローンチ日は重複しないが、同日の場合はWeekトーナメントと同じタイブレーク」と定め、シードの並びはWeekと同じ(「予選」はProduct of the Week受賞に至ったローンチの予選)。2回戦の枠の配置と3回戦以降の固定のブラケットもWeekと同じ。
- 1回戦の日の規則: FR-TOURY-014の各区間(2・3〜4・5〜8・9〜16・17〜32・33〜64)は「決勝日 −(ラウンド数 − 1)日」と一致する(ラウンド数はceil(log2 N))。Yearトーナメント規則の表(N = 13は3日前)とも一致する。
- 不戦勝の連鎖・勝敗・即時の終了・開始時点の決着・ラウンド名: Weekトーナメントと同じ規則(FR-TOURY-017〜019・021〜024・026〜029)で、match-engineが種別によらず行い、ブラケットの進行はtournament-weekの部品が行う。トップページの不戦勝の一覧の文言(「次のラウンドへ進みます」)はmatch-engineの仮7で`year`にも適用済みである。
- 通知の時刻と統合: notificationsの仮1(開始予告は前日の23:45の枠。Yearの1回戦の予告は組み合わせ決定の時点で発行してよく、notificationsが前日まで保持する)と申し送り(統合を望む結果と翌日の予告はその夜の`EveningDispatchGate.markReady`を呼ぶ前に発行(notificationsの仮2、2026-10-24に開発者が確定。送り出しは前提の全機能の準備の完了の後、遅くとも23:55に始まる)、受賞は`product_of_the_year`と期間`2026`)。Week決勝の勝利の結果通知のYearの決済期限は`RESULT_NOTICE_SUPPLEMENTS`に種別`week`で登録する(文言規則「Weekトーナメント決勝勝利の結果通知にはYearトーナメントの決済期限を明記する」)。
- 購入種別と価格: 購入種別`year_tournament_entry`はpaymentsの`PURCHASE_KINDS`に定義済み。価格はStripeのダッシュボードで`lookup_key`付きで作る(本specは`year_tournament_entry`とする)。参考価格は$20(料金及びプラン体系)。
- 管理画面の設定ページの区画と認可: briefとultras-subscriptionの仮6で、区画`{ id: 'tournament-year.final-date', order: 10, component }`、ページの枠とメニュー(`/settings`、130)はultras-subscription、変更は`requireAdmin(..., 'super_admin')`、監査ログは`AuditLogRecorder`と決まっている。理由は任意(FR-ADMAG-001の500文字以内。ultras-subscription・notificationsの設定の操作と同じ`reason: 'optional'`)。
- 参加費の導線の表示: ページ配置の「Yearトーナメント」は、ボタンと決済期限の表示(Week優勝の直後から決済の完了または期限の到来まで)と免除の表示だけを定め、Weekの48時間未満の強調とUltrasの案内を定めていない。本specはページ配置のとおりとし、縮退の表示はNFR-AVAIL-002により付ける。
- 波及処理・ジョブ・イベントの処理の`order`: 本specの1700番台(roadmapの帯の割り当て)。23:45のジョブはmatch-engine(1100)・notifications(1300)・tournament-weekの`tournament-week.evening-bracket`(1500)の後に動き、上流の値より前に動く必要のある処理は無い。Ultrasの知らせの処理の`order`は100以上の規則のもとで帯と同じ1700・1710とし、tournament-week(1500・1510)と重ならない。
- 新しいパッケージ: 無い。日付の選択は`<select>`とshadcn/uiの部品、ブラケットはtournament-weekの部品、日付の計算は`BusinessTime`の関数で足りる。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(tournament-weekと同じ)。
- 実装では、日付の選択は`<select>`ではなく共通部品の`Select`(shadcn/uiの部品)で書いた。新しいパッケージは加えていない。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(マッチとブラケット・プラン判定・再ローンチ可否ポリシー・決済フルフィルメント・通知イベント契約・Cron・Queuesのディスパッチ・画面シェル・Ultrasの知らせ・監査ログ・E2Eの管理者ログイン・利用者の連絡先の照会・データエクスポートの出力)。
- **Sources Consulted**: tournament-week・match-engine・payments・ultras-subscription・notifications・product-launch・directory-discovery・admin-foundation・identity-authの`design.md`、tournament-week・match-engine・payments・ultras-subscription・notifications・product-launchの`research.md`の後続specへの申し送り、ugc-moderation・data-exportのbrief。
- **Findings**:
  - tournament-week: `BracketKind`(`'week' | 'year'`)・`BracketDraw.create({ kind, tournamentId, candidates, order, policy, now })`(既にあれば記録を再利用して進行だけ)・`BracketProgression.advance(bracketId, policy, now)`(冪等)・`AdvanceResult`・`BracketStore`の`findByTournament`・`findById`・`findByMatchIds`・`findAliveRefs`(`unlinkProduct`はtournament-weekの`purge_due`の処理が種類によらず呼ぶ)・`dailyRoundPolicy`・`tournamentMatchWindow`・`bracketShape`・`bracketLayout`・`WeekChampionDirectory.listChampions({ awardedFrom, awardedBefore })`(受賞の昇順、紐付けを解除済みは除く)・`TrophySource`・`TrophySourceRegistration`・`TOURNAMENT_TROPHY_SOURCES`(Yearは10)・`TrophyRecord`(`kind: 'year'`・`period: '2026'`・`periodLabel: '2026年'`)。申し送りに「`BracketDraw.create`(`kind: 'year'`、非シードの比較はローンチ日だけ、`RoundSchedulePolicy`は決勝日からの逆算)、Week優勝からYearの結果確定までの禁止はtournament-yearが供給(仮1)、要約の`rank`は60以上、返金ポリシーの停止・非公開化の行のYearの部分を判断する」とある。後続specはtournament-weekのテーブルへ直接書き込まない。
  - match-engine: `MatchScheduler`(tournament-weekの部品が呼ぶ)・`MatchDirectory.findQualifierResults(launchIds)`(確定した予選の`matchId`・`upvoteCount`・`lastUpvotedAt`)・`findMatches`(側の`lastUpvoteElapsedMs`)・`listForDate({ date, kinds: ['year'], now })`・`MATCH_EVENT_HANDLERS`(`decided`・`kinds`・`order`、同じイベントの処理は`order`の昇順に直列、例外はその後を止めて再試行)・`MatchViewReader`・`matchViewLoader`・`TOP_PAGE_SECTIONS`(`main`のYear 10、`showcase`の決勝)・`MatchCard`・`ByeList`(仮7で`year`もトーナメントの文言)・`useUpvote`。
  - payments: 購入種別`year_tournament_entry`は定義済み。`PurchaseOfferPolicy.describe`・`PurchaseOffer`(`deadlineAt`・`acceptUntil`・`fulfillableUntil`・`exclusivityKey`・`summary`)・`PurchaseFulfillment.prepare`(副作用なし、`CASE`式のNOT NULL制約の違反で一括の書き込みを取り消し、paymentsが呼び直して拒否にする)・`PaymentRefunds.request`(依頼キーは依頼元が一意に決める)・`OpenCheckoutExpirer.expireOpen`(eventの非同期の処理から呼ぶ)・`CheckoutStarter.start({ session, kind, targetId })`・`PriceCatalog.getPrices`。登録するServiceIdentifierは`backend-lib/workers/<ドメイン>`の共有モジュールでapi・eventの両方に束縛する。
  - ultras-subscription: `UltrasEntitlements.wasEntitledDuring`・`entitledUsersDuring`、`UltrasActivation`(`activatedAt`)・`UltrasActivationHandlerRegistration`(`order`は100以上、冪等)、`AdminSettingsSection`(`id`・`order`・`component`)・`ADMIN_SETTINGS_SECTIONS`(本specは10)。
  - admin-foundation: `requireAdmin(context, minimum)`・`AuditLogRecorder.prepare(entry)`・`buildAuditLogStatements`(操作と同じ一括の書き込みに含める)・`defineAuditAction`(`targetKind`に`setting`がある)・`AUDIT_ACTIONS`(`common-lib/admin/audit-actions/<spec名>.ts`を足して連結)・`AdminDirectory`・`RoleGate`・`ConfirmActionDialog`・E2Eの`signInAsNewAdmin`・`executeLocalD1`・`sqlStringLiteral`。
  - notifications: `NotificationEventPublisher.publish({ publisher, events, at })`(`award`は`product_of_the_year`と期間`2026`)・`ResultNoticeSupplementInput`(`kind`・`stage`・`launchId`・`result`)・`ResultNoticeSupplementRegistration`(`kinds`・`order`)。送信者情報の区画が管理画面の設定の操作の見本になる(版の条件付きの保存・監査・競合の案内)。
  - product-launch: `RelaunchConditionSource`(`RelaunchBlock`の`code`・`message`・`releaseAt`)・`ProductLockSource`・`LaunchSummarySource`(`rank`の大きい方、`awards`の`kind: 'year'`)・`DecisionSubject.latestLaunch`・`ProductDirectory.findSummaries(ids, 'visible' | 'not-deleted')`・`listLaunches`・`resolveHandle`・`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`・`MY_PRODUCT_SECTIONS`・`PRODUCT_DELETE_NOTICES`(sponsorshipは30、tournament-weekは10)。
  - directory-discovery: `PRODUCT_OWNER_ACTIONS`の20が本specに予約されている。
  - identity-auth: `USER_LIFECYCLE_ASYNC_HANDLERS`(`withdrawn`)・`UserContactDirectory.findContact`(退会済みは`undefined`)。
- **Implications**: 上流のファイルの変更は、契約で定められた登録箇所への追記だけにする。ブラケットの表示の部品は、本specの依頼によりtournament-weekの仮7が提供したため、本specは使うだけである(tournament-weekのタスク6.6・6.10・7.1・7.4の完了を本specのタスク5.8・5.11・6.1・6.4の前提にする)。

### 対象期間の表し方

- **Context**: FR-TOURY-001(前年の決済期限日〜今回の決済期限日の前日、初年度は起点なし)、FR-ADMCF-007(変更期限までは決勝日を変えられる)、仮1。
- **Findings**: 枠に対象年を保存すると、決勝日の変更のたびに境界の前後の枠を付け替える処理が要り、付け替えとWeek優勝の取り込み・組み合わせ決定が同時に起きると食い違う。一方、前年の組み合わせ決定は前年の対象の枠をすべて終わった状態にするため、「終わっていない枠」は常に開催前の年の対象である。ある年の対象は「終わっていない枠のうちWeek優勝の日がその年の決済期限日より前のもの」、枠の対象年は「組み合わせ決定を始めていない年のうち、決済期限日がWeek優勝の日より後の最も早い年」で求まる。前年に開催しなかった場合は前年の対象の枠が終わらずに残り、今回の年の対象に含まれる(起点なし)。組み合わせ決定を始めた年の決済期限日より前のWeek優勝が後から届いた場合だけ、遅れとして期限切れにする。
- **Implications**: 枠は終わったときに`classified_year`(組み合わせ決定で終えた年)だけを記録する。年の行は、組み合わせ決定の時刻が未来の年(開催する予定の年)についてだけ作る(23:45のジョブが次に開催する年の行を用意し、管理者の保存も行を作る)。組み合わせ決定の時刻を過ぎて行の無い年は「開催しなかった年」として飛ばす。遅れの判定は挿入の文の中で「凍結済みの年のうち決済期限日がWeek優勝の日より後の年」の有無を見て行い、凍結と同時の取り込みでも食い違わない。

### 決勝日からの逆算と変更

- **Context**: FR-TOURY-004・009・014、FR-ADMCF-001〜003・006・007、年次タイムライン。
- **Findings**: 期限(受付期限・決済期限・組み合わせ決定・変更期限)と決済期限日は決勝日だけから決まる純粋な関数で求まる。tournament-weekは期限を週の行の列に保存して以後の判定で列を読む(E2Eで時刻を進めるため)。Yearも同じく年の行に保存し、決勝日の保存と同じ一括の書き込みで列を書き直す。行の無い年(開催する予定で未作成)は既定の日から求める。変更期限の判定は変更前の決勝日の列で行い、版の条件と凍結していないことを同じ文の条件にする。
- **Implications**: `core/year-tournament/year-schedule.ts`に純粋な関数、`workers/year-tournament`の`YearCalendar`に行と既定の日を合わせた照会を置く。選べる日付と検証の規則も純粋な関数(`final-date-choice.ts`)にし、管理画面の候補の一覧とサーバーの検証で同じ関数を使う。

### Week優勝の取り込みと遅れ

- **Context**: FR-TOURY-001、Week優勝の確定の経路(tournament-weekの`decided`の処理1510・23:45のジョブ`tournament-week.evening-bracket`の1500)、FR-RELCH-004の空白期間。
- **Findings**: `decided`・`week`の処理を1700で登録すると、同じイベントの1510の処理(Week優勝の記録)の後に動く。参加数1のWeekは月曜日23:45のジョブ(1500)で授与され、イベントが無い。23:45の`tournament-year.evening-bracket`(1700)の最初の段が対象期間のWeek優勝を`listChampions`で読み直し、欠けた枠を作る。予選勝利時のUpvote数と最終Upvote時間は`WeekChampion`に無いため、`findQualifierResults`で予選のマッチを引き、`findMatches`の側の`lastUpvoteElapsedMs`を写す。Week優勝の記録から枠の作成までの数秒〜(失敗時は)数時間は、Weekの禁止が外れYearの禁止がまだ無い。
- **Implications**: `YearRelaunchConditionSource`は、枠の無い勝利したローンチについて、開催前の対象期間のWeek優勝を`listChampions`で1回引いて同じ禁止を返す(要件13.4)。

### 参加数の上限

- **Context**: 仮2、FR-TOURY-012・014。
- **Findings**: 組み合わせ決定の分類で、表示できて参加資格のある枠を`drawn`にした後、`drawn`が65以上ならWeek優勝の日時の古い順(同時刻はローンチの識別子の昇順)に超過分を`excluded`(`over_capacity`)にする。分類が複数の一括の書き込みに分かれても、超過の判定は全ての分類の後に1回行い、再実行しても同じ枠を選ぶ。
- **Implications**: `YearOrdering.selectWithinCapacity`(純粋な関数)と、ストアの`excludeOverCapacity`を分ける。

### 画面と文言

- **Context**: ページ配置(トップページの1番目の区画、Yearトーナメントの参加費の導線、トロフィー、プロダクト登録・編集の削除、管理画面の設定)、文言規則(「再ローンチ不可(Year・参加前/参加中)」「Product of the Year受賞！2026年の頂点です！」「Weekトーナメント決勝勝利の結果通知にはYearトーナメントの決済期限を明記する」)、tournament-weekの区画と部品。
- **Findings**: トップページのYearの区画は見出しに「ラウンド名と決勝日」(ページ配置)。決勝の全幅の演出はtournament-weekの`showcase`の区画と同じ構成で、文言だけが違う。トロフィーの棚はtournament-weekが持ち、Yearを先頭に並べる規則も持つため、本specは供給元を登録するだけでよい。ブラケットのページはtournament-weekの部品の再利用を前提にする(上流への依頼)。管理画面は年ごとのカードに、実効の決勝日・設定済みか既定か・期限・候補の`<select>`を置く。
- **Implications**: トップページの2区画・プロダクト詳細の投稿者本人向けの操作・自分のプロダクトの区画・削除の注意書き・ブラケットのページ・管理画面の区画を本specが持つ。

## Architecture Pattern Evaluation

| Option                                      | Description                                                                             | Strengths                                                                  | Risks / Limitations                                        | Notes                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| Week優勝ごとの枠+日付による対象の判定(採用) | 枠に対象年を保存せず、終わっていない枠とWeek優勝の日と年の決済期限日で対象を決める      | 決勝日の変更・初年度・遅れの判定が付け替え無しに成り立つ。同時の変更に強い | 対象年の表示のたびに年の行と既定の日を読む(行は高々数件)   | tournament-weekの「期限は行の列を正とする」と組み合わせる |
| 枠に対象年を保存                            | 取り込み時に対象年を決めて保存し、決勝日の変更で付け替える                              | 照会が単純                                                                 | 付け替えの処理と、取り込み・組み合わせ決定との競合         | 不採用                                                    |
| ブラケットの規則と記録の再利用(採用)        | `BracketDraw`・`BracketProgression`に`kind: 'year'`・Yearの比較・決勝日からの方針を渡す | 規則・進行・回復・冪等性を重複させない                                     | tournament-weekの部品の形に依存する(Revalidation Triggers) | tournament-weekの設計の意図どおり                         |
| Yearの独自のブラケット                      | Yearの規則と記録を別に持つ                                                              | 所有が明快                                                                 | 重複と規則のずれ。briefに反する                            | 不採用                                                    |
| Week優勝のイベントだけで取り込み            | `decided`の処理だけ                                                                     | 処理が1つ                                                                  | 参加数1のWeek(イベント無し)と処理の失敗を取りこぼす        | 23:45のジョブと併用                                       |

## Design Decisions

### Decision: 枠に対象年を保存せず、終わっていない枠とWeek優勝の日で対象を決める

- **Context**: FR-TOURY-001の対象期間、初年度(仮1)、決勝日の変更(FR-ADMCF-007まで可能)。
- **Alternatives Considered**:
  1. 枠に対象年を保存し、決勝日の変更で付け替える
  2. 保存せず、終わっていない枠とWeek優勝の日・年の決済期限日で判定する
- **Selected Approach**: 2。組み合わせ決定の分類は`status IN ('awaiting_payment', 'entitled') AND awarded_date < 決済期限日`の枠を対象にし、終えた枠に`classified_year`を記録する。表示と判定の対象年は`YearCalendar.resolveAward`(開催前の年のうち決済期限日がWeek優勝の日より後の最も早い年)で求める。
- **Rationale**: 前年の組み合わせ決定が前年の対象をすべて終えるため、残った枠は常に開催前の年の対象であり、初年度の起点なしと決勝日の変更がそのまま成り立つ。
- **Trade-offs**: 年の行の作成の規則(組み合わせ決定の時刻が未来の年だけ作る)を守る必要がある。行を過去の年に作ると、その年の組み合わせ決定が遅れの回復として動いてしまう。
- **Follow-up**: 決済期限日の前日と当日のWeek優勝、開催しなかった前年、変更で移る枠の判定を単体テストとWorkers統合テストで確かめる。
- 実装では、分類の対象を`status IN ('awaiting_payment', 'entitled')`かつWeek優勝の日が`[前年の行の決済期限日, その年の決済期限日)`の枠にした(下限は前年の行があるときだけ付け、`YearEntryStore.listCandidates`は範囲`YearCandidateRange`を受ける)。遅れの回復で2年が同時に到来し前の年が分類の途中で失敗しても、後の年が前の年の受付中の枠を分類しないためである。複数の枠をまとめて扱う部品(Week優勝の取り込み・再ローンチの判定)は、`resolveAward`を枠ごとに呼ばず、`YearCalendar.describe`を1回読んで純粋な`resolveTargetYear`を当てる(結果は同じ)。

### Decision: 期限は年の行の列を正とし、決勝日の保存と同じ一括の書き込みで書き直す

- **Context**: 決勝日の変更、E2Eで時刻を進める必要(tournament-weekと同じ)、変更期限の判定。
- **Selected Approach**: `year_tournaments`に`final_date`・`final_date_source`・`deadline_date`・`accept_until`・`deadline_at`・`draw_at`・`change_lock_at`を持つ。行の作成時と決勝日の保存時に`yearScheduleFor`で求めて書き、以後の判定(決済の可否・反映・Ultrasの付与・再ローンチ・組み合わせ決定の到来・追記・画面)は列を読む。保存の文は`final_date_version = ? AND draw_started_at IS NULL AND change_lock_at > ?`を`CASE`式の条件にし、満たさなければNOT NULL制約の違反で監査ログごと取り消す。
- **Rationale**: 変更期限と版と凍結の検査を1つの文で行え、監査ログと保存が一体で確定する(notificationsの送信者情報・ultras-subscriptionの機能フラグと同じ形)。
- 実装では、保存の取り消しを`CASE`式のNOT NULL制約の違反ではなく、監査ログのガード(`{ kind: 'condition' }`)の拒否で行った。条件(年・版・`draw_started_at IS NULL`・`change_lock_at > now`)を監査ログのガードとUPDATEのWHEREで共有し、`isAuditGuardRejection`で判定する(監査ログのガイドと先例の`D1SenderInfoWriter`・`D1PromotionSettingWriter`に倣う)。一括の書き込みは行の用意→監査ログ→UPDATEの順とした(ガードが行を読むため)。機能全体の検証で、隣の年を同時に保存すると64週の間隔の検証を通り抜け得ることが分かり、条件に前年と翌年の版の一致(行が無い年は0)を加えた。

### Decision: 参加数の上限はWeek優勝の日時が新しい順に64件(仮2)

- **Context**: 65件以上は日程に収まらず、FR-ADMCF-003の検査だけでは防げない。
- **Selected Approach**: 分類の後に`drawn`の件数を数え、超えた古いWeek優勝を`excluded`(`over_capacity`)にし、決済済みは`capacity_exceeded`で返金する。
- **Rationale**: 期間の起点を遅らせたのと同じ効果で、FR-ADMCF-003の考え方に合う。

### Decision: 決勝実施日の区画は年ごとのカードと候補の`<select>`

- **Context**: FR-ADMCF-001〜003・006・007、仮8、アクセシビリティ。
- **Selected Approach**: サーバーが現在の年と翌年について、実効の決勝日・出どころ・期限・変更の可否と理由・候補の日付(最大53件)・前年と翌年の日付・注意を返し、画面は候補の`<select>`と理由の入力欄を`ConfirmActionDialog`で確定する。サーバーは同じ純粋な規則で再検証する。
- **Rationale**: カレンダーの部品で選べない日を灰色にするより、候補だけを並べる方がキーボードと読み上げで扱いやすく、検証の規則を1か所に保てる。新しいパッケージが要らない。
- 実装では、候補の選択を`<select>`ではなく共通部品の`Select`(`role="combobox"`、`Label`を結ぶ)で書いた。確認のダイアログの決勝日は業務日付の`<time>`、変更後の受付期限と組み合わせ決定は`DateTime`で示し(`ConfirmActionDialog`の題名と説明が要素を受ける)。

### Decision: ブラケットのページはtournament-weekの共用の部品を再利用する(表示の組み立ての汎用化はtournament-weekの仮7で提供済み)

- **Context**: brief(ブラケットエンジンを再利用し、改修が必要ならtournament-weekの設計と整合させる)、仮5。
- **Selected Approach**: tournament-weekの仮7が提供する、apiの純粋な関数`buildBracketRoundsView({ record, matchViews, now }): BracketRoundsView`(`apps/api/src/application/tournament/bracket-view-builder.ts`、DIに束縛しない)と、GraphQLの`BracketRound`・`BracketNode`・`BracketSlot`のリゾルバ、clientのフラグメント`BracketRoundFields`(`BracketRound`)・`BracketMatchProductFields`(`MatchProduct`。match-engineに再利用できる`MatchProduct`のフラグメントが無いため新設)と、`BracketViewProps`(`rounds`・`champion`・`awarded`・`finished`)で受ける`BracketRoundColumn`・`BracketRoundTabs`・`BracketMatchCard`・`BracketChampion`を使う。Yearは`YearBracket`の型と照会・ページの組み立てだけを足す。シードの最初のマッチの予定が作られるまでは、その枠は「シード<n>」と表示されプロダクトを出さない(組み立ての規則)。
- **Rationale**: ブラケットの表示の規則(未来の枠の表記・シードの番号・非公開のプロダクト・768pxの切り替え)を重複させない。
- **Follow-up**: 本specのタスク5.8・5.11・6.1・6.4は、tournament-weekのタスク6.6(組み立て)・6.10(GraphQLのリゾルバ)・7.1(フラグメント)・7.4(共用の部品)の完了を前提にする。

### Decision: 採らなかった案

- 枠に対象年を保存して付け替える: 同時の変更に弱い(上記)。
- 64件を超えた分を予選勝利時Upvote数で外す: 対象期間の規則と無関係な基準になる(仮2の選択肢B)。
- 管理画面でカレンダーの部品を使う: 選べない日の多いカレンダーは操作の負担が大きく、新しいパッケージかカレンダーの自作が要る。
- 年の行を毎晩すべての過去の年に作る: 行の無い過去の年を「開催しなかった年」と区別できなくなる。

## Synthesis

- **Generalization**: Yearの組み合わせ・進行・不戦勝・終了はWeekと同じ規則の変種で、差は比較(非シードはローンチ日)と実施日の方針(決勝日からの逆算)と上限(64)だけである。tournament-weekが用意した引数で表し、規則を実装しない。期限の逆算は「起点の日付から期限を導き、変更の締め切りを持つ」一般の問題として技術ドキュメント(`backend/019`)に記す。
- **Build vs. Adopt**: ブラケット・マッチ・決済・返金・通知・特典の判定・監査ログ・設定ページの枠・トロフィーの区画は上流の部品を使う。決勝日の規則と対象年の判定は数十行の純粋な関数で、要件の境界を単体テストできるため自作する。日付の選択に外部の部品を使わない。
- **Simplification**: 新しいメッセージ種別・Cronの式を作らない(既存のマッチイベント・ライフサイクル・Ultrasの知らせ・23:45と4:21のジョブ)。枠に対象年を保存しない。年の行は開催する年だけに作る。Weekの並びの比較は`core/week-tournament`への依存を避けて同じ規則の関数をYearに置く(数行で、規則の文書が同じことを定める)。

## Risks & Mitigations

- tournament-weekの共用のブラケットの部品の形が変わる — tournament-weekの仮7の契約(`buildBracketRoundsView`・`BracketViewProps`・2つのフラグメント)をRevalidation Triggersに挙げ、変われば本specの照会とページを確かめ直す。
- 23:45のジョブが失敗して0:00までに次ラウンドを作れない — `decided`の処理が先に進めるため通常は影響しない。両方失敗した場合はtournament-weekの部品がラウンドを1日遅らせ、`round-late`をSentryへ通知する(要件8.9)。決勝が決勝日の翌日以降になり得る旨をYearトーナメント規則に書く。
- 年の行の作成漏れ(23:45の`tournament-year.evening-bracket`が動かないまま組み合わせ決定の時刻を過ぎる) — その年は「開催しなかった年」として扱われ、枠は翌年の対象になる。行の用意は毎晩行い、管理画面の照会と保存でも行う。失敗は`captureEvent`で検知する。
- 組み合わせ決定と同時の変更(削除・退会・Ultrasの加入・決済の反映・Week優勝の取り込み) — 凍結(`draw_started_at`)と「凍結済みの年の決済期限日がWeek優勝の日より後」の条件付きの書き込み、同じ依頼キーの返金。
- 決勝日の変更で、決済済みの枠が翌年の対象へ移る — FR-TOURY-001の帰結であり、確認の画面で対象期間が変わる旨を示す(要件2.13)。発生は変更の境界の数日に限られる。
- 返金の依頼の失敗 — 枠に`refund_status = 'pending'`を残し、4:21のジョブで依頼し直す。

## References

- `docs/requirements/README.md` — 4.14、FR-ADMCF-001〜003・006・007、FR-ADMAG-001、FR-PYMNT-010・012〜014、FR-PPLAN-006・008、FR-RELCH-004、FR-PRDCT-014、FR-NOTIF-001・004・006・007
- `docs/GUIDES/service/overview/005-year-tournament-rules.md` — 差分、N = 13の例、日程
- `docs/GUIDES/service/overview/004-week-tournament-rules.md` — シード・組み合わせ・不戦勝
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 年次タイムラインと同時刻の処理の順序
- `docs/GUIDES/service/overview/002-pricing-and-plans.md` — 参加費・免除条件
- `docs/GUIDES/service/overview/006-relaunch-rules.md` — Week優勝からの禁止と解除
- `docs/GUIDES/service/legal/004-legal-notice-outline.md` — 返金ポリシー
- `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md` — 画面と文言
- `.kiro/specs/tournament-week/design.md`・`research.md` — ブラケットの部品と申し送り

## 仮決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。要件定義書と上流specに最も整合する案を採用して要件・設計・タスクを作った。**いずれも2026-10-24に開発者が確定した(すべて推奨どおり)。** 本specに開発者の確認を待つ論点は残っていない。`requirements.md`の「要件フェーズでの決定事項」にも同じ行がある。

| #   | 論点                               | 確定した案                                                                                         | 他の選択肢                               | 影響する箇所                                                                      |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| 仮1 | 前年の決勝日の扱いと初年度         | 前年に開催した・開催予定なら既定の日を含めて「設定されている」。開催しなかった年の翌年だけ起点なし | 明示的に設定した日だけを設定済みとする   | 要件2.5・3.4〜3.6、`YearCalendar`・`resolveTargetYear`・`checkFinalDateChoice`    |
| 仮2 | 64を超える参加                     | Week優勝の日時が新しい順に64件。残りは除外                                                         | Upvote数順 / 参加資格を得た順 / 上限なし | 要件6.5、`selectWithinCapacity`・`YearDrawService`・Yearトーナメント規則          |
| 仮3 | 組み合わせ決定時点の非公開化・停止 | 組み合わせから除き参加資格を停止(tournament-weekの仮2と同じ)                                       | 含めて開始時点で相手の不戦勝             | 要件6.4、`YearDrawService`の分類                                                  |
| 仮4 | 停止・非公開化・上限超過の返金     | 決済済みを自動で全額返金。決定後の不戦敗は返金しない(tournament-weekの仮3と同じ)                   | 管理者が手動で返金 / 返金しない          | 要件6.6・6.7、`YearEntryFollowUp`・`refundReasonFor`、返金ポリシー                |
| 仮5 | ブラケットの表示の場所             | `/tournaments/year/{年}`の公開のページ                                                             | トップページに全ラウンド / 表示しない    | 要件10.2・11、`YearBracketPage`・`YearBracketReader`、ページ配置                  |
| 仮6 | 期限の後の反映と次回の予約         | 禁止は決済期限で解除し、期限後の反映は新しいローンチがあれば拒否して自動返金                       | 組み合わせ決定まで禁止を続ける           | 要件4.8・13.1、`YearEntryFulfillment`・`YearRelaunchConditionSource`              |
| 仮7 | 本機能の自動返金の知らせ           | 返金の旨と理由をメールで知らせる(退会済みには送らない)                                             | 決済履歴への反映だけ                     | 要件6.9、`YearEntryFollowUp`・`tournament-year.entry-refund`                      |
| 仮8 | 設定できる対象年と翌年との間隔     | 現在の年と翌年。翌年が設定済みなら64週未満を求め、未設定なら注意を表示。既定に戻す操作なし         | 対象年を制限しない / 翌年を検査しない    | 要件2.1・2.6・2.8・2.12、`checkFinalDateChoice`・`YearFinalDateService`・管理画面 |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID                     | 内容                                                                                                                                                             | 根拠    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| FR-TOURY-001・FR-ADMCF-003 | 「前年の決勝実施日が設定されている」に、FR-ADMCF-006の既定の日で開催した(する)年を含め、前年のYearトーナメントを開催しなかった場合だけ起点を設けない旨を明記する | 仮1     |
| FR-TOURY-009・FR-TOURY-012 | 組み合わせ決定の時点で参加資格を得たプロダクトが64を超える場合は、Week優勝の日時が新しい順に64件を対象とし、残りの参加資格を停止する旨を加える                   | 仮2     |
| FR-TOURY-009               | 組み合わせ決定の時点で非公開化中・投稿者が停止中のプロダクトは組み合わせの対象とせず、そのトーナメントの参加資格を停止する旨を加える                             | 仮3     |
| FR-PYMNT-010・FR-PYMNT-012 | FR-TOURY-009の時点の非公開化・停止・参加数の上限で参加資格を停止した場合も、決済済みの参加費を自動で全額返金し、非同期で処理する旨を加える                       | 仮4     |
| FR-TOURY-005・FR-PYMNT-013 | 決済期限の後に反映された決済は、同じプロダクトのより新しいローンチが予約されていれば参加資格を与えず、FR-PYMNT-014と同じく自動で全額返金する旨を加える           | 仮6     |
| FR-ADMCF-001・FR-ADMCF-003 | 設定できる対象年を現在の年と翌年とし、翌年の決勝実施日が設定済みならその日が64週間後以降になる日付も拒否する旨を加える                                           | 仮8     |
| FR-TOURY-024・FR-TOURY-026 | 次ラウンドの予定を実施日の0:00までに作れなかった場合(障害)は、そのラウンド以降を1日ずつ遅らせ、決勝が決勝実施日の後になり得る旨を加える                          | 要件8.9 |

## 上流・後続specへの影響

- tournament-week(上流): 登録箇所への追記だけ。`TOURNAMENT_TROPHY_SOURCES`(apiの`composition/tournament-trophy-sources.ts`)に`tournament-year.year-trophies`(10)。**本specの依頼による改訂はtournament-weekの仮7で提供済み**: (1)apiの`apps/api/src/application/tournament/bracket-view-builder.ts`の純粋な関数`buildBracketRoundsView({ record, matchViews, now }): BracketRoundsView`(`participantCount`・`seedCount`・`rounds`・`championNo`、DIに束縛しない)と、GraphQLの`BracketRound`・`BracketNode`・`BracketSlot`をこの値だけから解決するリゾルバ。(2)clientの`src/graphql/operations/week-tournament/`の`.graphql`に置く`BracketRoundFields`(`BracketRound`)・`BracketMatchProductFields`(`MatchProduct`)と、`BracketViewProps`(`rounds: readonly BracketRoundFieldsFragment[]`・`champion: BracketMatchProductFieldsFragment | null`・`awarded: boolean`・`finished: boolean`)で受ける`components/bracket/`の4部品(Weekのページは`components/week-tournament/week-bracket-page.tsx`へ移った)。本specは使うだけで、tournament-weekのタスク6.6・6.10・7.1・7.4の完了を前提にする。`BracketStore.unlinkProduct`がブラケットの種類によらず参加者の紐付けを解除すること(tournament-weekの`tournament-week.entry-unlink`が呼ぶ)を前提にし、本specは呼ばない。
- match-engine(上流): `MATCH_EVENT_HANDLERS`に`tournament-year.week-champion-entry`(`decided`・`week`、1700)・`tournament-year.decided-round-progress`(`decided`・`year`、1710)、`TOP_PAGE_SECTIONS`に`tournament-year.matches`(`main` 10)・`tournament-year.final`(`showcase` 10)。`ByeCard`のYearの文言は仮7で対応済み。
- payments(上流): `PURCHASE_KIND_REGISTRATIONS`に`year_tournament_entry`(`YEAR_TOURNAMENT_TYPES.YearEntryOfferPolicy`・`YearEntryFulfillment`、`backend-lib/workers/year-tournament`でapi・eventの両方に束縛)。返金の依頼キーは`tournament-year:<購入ID>:<理由>`(理由`entitlement_lost`・`entitlement_suspended`・`capacity_exceeded`)。決済実装方針(`features/004`)の購入種別の表へ行を追記する。
- ultras-subscription(上流): `ULTRAS_ACTIVATION_HANDLERS`に`tournament-year.ultras-entry-exemption`(1700)・`tournament-year.open-entry-checkout-expiry`(1710)。`ADMIN_SETTINGS_SECTIONS`に`tournament-year.final-date`(10)。Q1・Q2を適用する。返金ポリシーの「停止・非公開化に伴うトーナメント参加資格の停止」の行のYearの部分は仮4で判断した。
- admin-foundation(上流): `common-lib/admin/audit-actions/tournament-year.ts`(`year-final-date.update`)と`index.ts`の連結。E2Eで`signInAsNewAdmin`を使う。
- notifications(上流): `RESULT_NOTICE_SUPPLEMENTS`に`tournament-year.entry-deadline`(`week`、1700)。`NotificationEventPublisher.publish({ publisher: 'tournament-year' })`で`match_preview`・`match_result`・`award`(`product_of_the_year`)を発行する。apiの`EVENING_DISPATCH_PARTICIPANTS`に`tournament-year.evening-bracket`を1行追記し、23:45の`tournament-year.evening-bracket`の最後に`EveningDispatchGate.markReady`を呼ぶ(notificationsの仮2)。
- product-launch(上流): `RELAUNCH_CONDITION_SOURCES`に`tournament-year.result-pending`、`PRODUCT_LOCK_SOURCES`に`tournament-year.bracket-lock`、`LAUNCH_SUMMARY_SOURCES`に`tournament-year.launch-summary`(いずれも1700)、`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`に`tournament-year.product-entry-loss`(`deleted`、1700)・`tournament-year.entry-unlink`(`purge_due`、1700)、`MY_PRODUCT_SECTIONS`・`PRODUCT_DELETE_NOTICES`に各1件(20)。要約の`rank`は60〜100。
- directory-discovery(上流): `PRODUCT_OWNER_ACTIONS`の20に`tournament-year.entry`(予約どおり)。
- identity-auth(上流): `USER_LIFECYCLE_ASYNC_HANDLERS`に`tournament-year.account-entry-loss`(`withdrawn`、1700)。`UserContactDirectory.findContact`で返金の知らせの宛先を引く。
- backend-platform・email-delivery(上流): `SCHEDULED_JOBS`に2件(23:45の1700、4:21の1700。Cronの式は追加済み)、`EMAIL_KINDS`・`EMAIL_TEMPLATES`に`tournament-year.entry-refund`。E2Eはbackend-platformの改訂2の共用の補助`triggerScheduled`(`e2e/support/scheduled-trigger.ts`)でローカルの定期実行を起動し、独自の起動の仕組みを持たない。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は1700、波及処理は1700」になる(23:45のジョブ1700、プロダクトライフサイクル1700、マッチイベント1700・1710、Ultrasの知らせ1700・1710、結果通知の追記1700)。Requirement Ambiguitiesの2行の解決の列への追記は「仮決定」の表のとおり(仮1・仮2、仮3・仮4)。本specはroadmapを編集しないため、コントローラーへ報告する。
- ugc-moderation(後続): 停止・非公開化をidentity-auth・product-launchのライフサイクルで発火すれば、組み合わせ決定の前は本specの分類で除外と返金(仮3・仮4)、決定の後はmatch-engineの開始時点の決着で不戦敗になる。本specを直接呼ぶ必要は無い。
- data-export(後続): `YearAwardExport.listForLaunches`で`launches.json`の`awards[]`の`product_of_the_year`を作る。

## 要件のレビュー(2026-10-24)

- 機械的な確認: 16の要件の見出しがすべて数字のIDを持ち、130件の受け入れ基準がすべてEARSの形式(`When`・`If`・`While`・`Where`・`The … shall`)である。技術名は要件定義書の用語(Stripe・Webhook・DR-015など)、外部リンクの`rel`の値(ページ配置の規則)、データエクスポートの値(`product_of_the_year`)、仮決定の表のURLの例だけに限った。
- 判断のレビューで、境界になりやすい振る舞い(Week優勝の確定から枠の作成までの再ローンチの禁止(要件13.4)、決勝日の変更で対象期間と解除の日時が変わること(要件3.8・13.6)、翌年の既定の日との間隔の注意(要件2.12))が受け入れ基準にあることを確かめ、問題は無かった。要件定義書・サービス仕様で決まらない論点は仮1〜仮8として記録し、要件の範囲の推測は加えていない。

## 設計のレビュー(2026-10-24)

- 機械的な確認: 要件の130件の受け入れ基準の番号がすべて追跡表にあることを、スクリプトで確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、(1)購入の内容の照会が年の行を作る副作用を持っていたため、`YearCalendar.describe`・`resolveAward`は行を作らないと明記し、日程は行の列か既定の日から求めるとした、(2)組み合わせ決定の途中(凍結の後、分類の前)の終わっていない枠を`resolveAward`が`late`として返す扱いを、参加費の導線と再ローンチの供給元が期限切れとみなさないと明記した、(3)`openPeriodStart`の定義(凍結済みの行の決済期限日の最大)を明記した、(4)文書の半角スペースの規則の違反(ツリーの注記・コードの注記・ページの題名)を直した。2回目で問題は無かった。
- 境界の確認: ブラケット・マッチ・決済・特典・通知・監査ログのテーブルへ書き込まず、上流の部品だけを使う。ブラケットの参加者の紐付けの解除はtournament-weekの処理に任せる。上流の改訂を要するのはtournament-weekのブラケットの表示の部品(`buildBracketRoundsView`と部品の引数)だけである。
- 技術ドキュメントの番号: 完了済みspecのdesign.mdの計画は`backend`001〜018、`frontend`001〜017、`db`001〜007、`security`001〜008・010、`infra`001〜008、`external`001〜008、`operations`001〜004、`coding`001〜004、`testing`001〜002である。本specは`backend`・`frontend`の最小の空き番号(`backend/019`・`frontend/018`)を取り、並行して作成するpublic-apiは1つ飛ばす取り決めに従う(public-apiは`backend/020`・`frontend/019`)。`security`の最小の空き番号は009だが、本specは`security`の文書を作らない。
- 参照したスキル: cc-sddの`kiro-spec-init`・`kiro-spec-requirements`・`kiro-spec-design`・`kiro-spec-tasks`の規則とテンプレート。新しいパッケージが無く、外部の仕様に依存する新しい判断も無いため、外部の調査は行っていない(上流specと要件定義書・サービス仕様の照合に限った)。

## タスクの計画の検証(2026-10-24)

- `/kiro-spec-tasks tournament-year -y`の手順で、要件と設計を承認し(`-y`による自動の承認)、タスクの計画の下書きを作った。要件の130件の受け入れ基準の番号がすべてタスクにあること、タスクが要件に無い番号を参照しないことを、スクリプトで確かめた。設計の全コンポーネント(テーブル・監査ログの操作種別・純粋な規則・2つのストア・年の照会・各部品・束縛・eventの処理・apiの照会と供給元とジョブ・決勝実施日の保存・GraphQL・client・adminの区画・文書・E2E)がタスクにある。
- タスクのグラフのサニティレビューを、本specの文脈の中で行った(レビューの方式は`inline`。本specの作成は開発者に質問できない一括の作成で、サブエージェントの起動を求められていないため)。
- 1回目の判定はNEEDS_FIXES(必須1件・軽微3件)だった。必須の指摘は、paymentsの反映の経路のタスク(3.16)が、決済の経路に無いUltrasの加入の判定(要件5.7)を確かめる内容になっていた点で、5.7をUltrasの知らせの処理のタスク(4.3)だけに対応づけた。軽微の指摘(2.1の参加数の例にN = 13の3日前を加える、3.14でマッチの時刻0:00・23:40を確かめる、(P)のタスクのうち同じグループの前のタスクの識別子・生成物を使うもの(3.9・3.10・4.3・4.4・5.3・5.4)に`_Depends:`を明記する)にも従って直した。設計と調査の記録のタスク番号の参照(ブラケットの表示の改訂を前提とするタスクは5.8・6.4)も合わせて直した。
- 2回目の判定はPASSだった。(P)のタスクの境界(ファイルの重なり)、登録箇所への追記が束縛のタスク(3.16・4.5・5.10)と画面の登録のタスク(6.2・6.3・6.6・7.4)に集まっていること、E2Eの過去の対象年による他のE2Eとの分離(8.4と8.5の直列化が要らないこと)、上流の仮の改訂を前提とするタスク(5.8・6.4)の保留の条件を確かめた。タスクを承認した(58のサブタスク)。

## タスクの計画の再検証(2026-10-24、tournament-weekの仮7の反映、コーディネーターの指示による再実行)

- tournament-weekの仮7(本specの依頼による)で、ブラケットの表示の契約が確定した: apiの純粋な関数`buildBracketRoundsView({ record, matchViews, now }): BracketRoundsView`(`apps/api/src/application/tournament/bracket-view-builder.ts`、DIに束縛しない。シードの最初のマッチの予定が作られるまでは「シード<n>」でプロダクトを出さない)、clientのフラグメント`BracketRoundFields`(`BracketRound`)・`BracketMatchProductFields`(`MatchProduct`、match-engineに再利用できる`MatchProduct`のフラグメントが無いため新設)と、`BracketViewProps`(`rounds`・`champion`・`awarded`・`finished`)で受ける共用の4部品(Weekのページは`components/week-tournament/week-bracket-page.tsx`へ移動)。tournament-weekのタスクは繰り下げられた(新しい6.7がブラケットのページの照会、旧6.7〜6.10は6.8〜6.11)。
- 反映した箇所: design.mdの「上流への影響」(依頼から「tournament-weekの仮7で提供済み」へ、前提はtournament-weekのタスク6.6・6.10・7.1・7.4)・Allowed Dependencies・Revalidation Triggers・`YearBracketView`(`champion`を追加)・`YearBracketReader`(優勝のプロダクトの照会、「シード<n>」の扱い)・`YearBracket`のリゾルバ・`YearBracketPage`(`BracketViewProps`の受け渡し)・ファイル構成の注記・Testing Strategy。tasks.mdの1.1(前提の一覧)・5.8(保留の前提を外し、純粋な関数の直接の呼び出しと優勝のプロダクト)・5.11(tournament-weekのリゾルバによる解決)・6.1(2つのフラグメントの展開)・6.4(保留の前提を外し、`BracketViewProps`の受け渡し)。prettierが`*`を使う要件の番号の参照を壊していた箇所を、明示の範囲(`10.1〜10.8`など)に直した。
- 要件の130件の受け入れ基準の番号がすべてタスクと設計の追跡表にあることを、スクリプトで確かめ直した。
- タスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定はPASSだった。軽微の指摘4件(5.11と設計で`YearBracket.rounds`に結果の`rounds`の配列を返すと書き分ける、6.4に開催中のラウンドの`LIVE_REFRESH_QUERY_OPTIONS`の取り直しと、キーボードで全マッチをたどれることの確認を加える、5.8の「受賞なしの表示」を照会の値(優勝のプロダクトが無く年の状態が終了)で書く)に従って直した。タスクを承認した(58のサブタスク)。

## タスクの計画の再検証(2026-10-24、tournament-weekの最終レビューによる契約の変更)

- tournament-weekの最終レビューで、共用の部品の引数`BracketViewProps`に必須の`awarded: boolean`が加わった(`{ rounds; champion; awarded; finished }`)。受賞したプロダクトが表示できなくなった(非公開化・論理削除・投稿者の停止)とき`champion`はnullになり、`awarded`が真なら部品は受賞なしではなく「非公開のプロダクト」の受賞を表示する。tournament-weekは`WeekBracket.tournament.awarded`(`outcome`が`awarded`なら真、`no_award`なら偽、終了前はnull)から渡す。フラグメント`BracketRoundFields`・`BracketMatchProductFields`は`TypedDocumentNode<…Fragment>`で書き出される。tournament-weekのタスクは再び繰り下げられ、7.4は共用の4部品と引数だけ、新しい7.5がWeekのページ、旧7.5〜7.7は7.6〜7.8になった。本specが前提にするtournament-weekのタスク(6.6・6.10・7.1・7.4)の番号は変わらない。
- 反映した箇所: design.mdのAllowed Dependencies・Revalidation Triggers・「上流への影響」(`awarded`と`TypedDocumentNode`)、GraphQLの`YearTournamentSummary.awarded`の規則(年の行の`outcome`から、tournament-weekと同じ)、`YearBracketPage`の`awarded`の受け渡し(nullは偽)、Testing Strategy。tasks.mdの5.8(受賞したプロダクトが表示できない年の値)・5.11(`awarded`の規則と要件11.3の追加)・6.1(`tournament.awarded`の取得)・6.4(`awarded`の受け渡しと、表示できない優勝のプロダクトの`awarded: true`の確認)。
- 変更した部分(5.8・5.11・6.1・6.4)のタスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定はPASSだった。軽微の指摘3件(6.4のWeekのページへの言及は参考で前提はtournament-weekのタスク7.4だけと明記する、6.1で`yearBracket`の操作が取得する項目(`tournament`の`awarded`・`status`・`year`・`finalDate`と`participantCount`・`seedCount`)を明記する、5.11の完了状態にapiのスキーマの生成を加える)に従って直した。タスクの承認を保った(58のサブタスク)。

## cross-spec reviewの指摘による修正(2026-10-24)

いずれもcross-spec reviewの指摘による整合の修正で、利用者・運営者から見える振る舞いは変えないため、仮の番号を付けない(開発者の確認を要しない)。

- GraphQLのルート型: api-gatewayのスキーマモジュールの規約(各モジュールは`extend`を使わず`type Query`・`type Mutation`をそのまま書き、同名のルート型の結合はYogaに任せる)に合わせ、design.mdの`extend type Query`・`extend type Mutation`を`type Query`・`type Mutation`に改め、tasks.mdの5.11〜5.13にその旨を加えた。
- paymentsのDIの識別子の名前を`PAYMENTS_PLATFORM_TYPES`から`PAYMENTS_TYPES`に改めた(Allowed Dependencies)。
- Ultrasの知らせの2つの処理のクラスがtournament-weekと同じ名前だったため、`YearUltrasEntryExemptionHandler`・`YearOpenEntryCheckoutExpiryHandler`に改め、ファイル名を`year-ultras-entry-exemption-handler.ts`・`year-open-entry-checkout-expiry-handler.ts`にした(tournament-weekは`Week`を前に付ける)。登録の名前(`tournament-year.ultras-entry-exemption`・`tournament-year.open-entry-checkout-expiry`)と`order`は変えない。tasks.mdの4.3の`_Boundary:_`を直した。
- E2Eのローカルの定期実行の起動: 独自の起動(apiの`--test-scheduled`への直接の要求)を使わず、backend-platformの改訂2が所有する共用の補助`triggerScheduled`(`e2e/support/scheduled-trigger.ts`)を使う形にした。理由は、業務時刻とCronの式の対応を1か所に置き、specごとの起動の仕組みのずれを防ぐため。design.mdのAllowed Dependencies・Revalidation Triggers・「上流への影響」・ファイル構成・Testing Strategy、tasks.mdの1.1の前提と8.3(前提と補助の手順)・8.4(補助による起動の明記)を直した。
- 上流の依存: 本specは`PRODUCT_OWNER_ACTIONS`(20)へ登録するため、roadmapが宣言する直接の依存(tournament-week)に加えてdirectory-discoveryも上流として扱うことを、design.mdのExisting Architecture Analysisに明記した。Allowed Dependencies・Revalidation Triggers・「上流への影響」には既にあった。
- 変更部分(1.1・4.3・5.11〜5.13・8.3・8.4)のタスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定はPASSだった(要件の全受け入れ基準の番号がタスクにあることを確認)。軽微の指摘2件(design.mdの変更した表の行の整形、Testing StrategyのE2Eの組み合わせ決定の手順で23:40と23:45の両方を動かすとタスクにそろえる)に従って直し、5.12・5.13にもルート型の規約を明記した。タスクの承認(`approvals.tasks.approved`)は維持した。

## 開発者の確定の反映(2026-10-24)

- 本specの仮1〜仮8は、すべて2026-10-24に開発者が確定した(いずれも推奨どおり)。requirements.md・research.mdの表に確定の旨を記し、確認を待つ旨の文言を除いた。振る舞いの変更は無い。本specに開発者の確認を待つ論点は残っていない。
- 関連する他specの確定: tournament-weekの仮1〜仮7(本specが前提にする除外と返金・期限後の決済・自動返金の知らせ・ブラケットのページ・共用のブラケットの表示)とmatch-engineの仮7(Yearの不戦勝の文言)は推奨どおり確定し、本specの前提は変わらない。sponsorshipの仮3(広告の日割り返金、推奨と異なる)は返金ポリシーの広告の行を変えるが、本specのタスク1.3が書き換えるトーナメントの行とは別の行で、影響しない。
- notificationsの仮2は推奨と異なる案C(トーナメントの23:45のジョブの最後に夜の枠の送り出しの入口を呼ばせる)に確定し、notificationsが契約`EveningDispatchGate`(`core/notifications/evening-dispatch.ts`、apiだけの`NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate`)を定めた。本specは次のとおり採用した。
  - 23:45のジョブ3つ(`tournament-year.champion-sync` 1700・`tournament-year.bracket-draw` 1710・`tournament-year.round-progress` 1720)を、1つの`tournament-year.evening-bracket`(1700)にまとめた。理由は、送り出しの準備の完了を「全ての処理と発行を終えた最後に1回」伝える契約を、ジョブの境界をまたがずに1つの処理の中で守れるため(別々のジョブでは、前のジョブの失敗を後のジョブが知ることができない)。
  - 毎晩、(1)次に開催する年の行の用意とWeek優勝の取り込み、(2)組み合わせ決定、(3)進行(確定のマッチイベントの処理が終わっていなくても、マッチの結果から同期で追いつく)、(4)その夜の一括の発行(`YearNotificationPublisher.publishEvening`: その日の確定したYearのマッチの結果・翌日の予告・その日の受賞。`dedupe`で冪等)、(5)`markReady({ participant: 'tournament-year.evening-bracket', date: context.business.date, at: clock.now() })`の順に行う。組み合わせや進行の無い夜(大半の夜)も呼ぶ。(1)〜(4)のどれかが失敗した夜は、残りの段を続けて`captureEvent`したうえで`markReady`を呼ばずに例外を投げ、notificationsの23:55の期限の送り出しと`evening-dispatch-incomplete`の検知に任せる。戻り値で処理を分けない。
  - 送り出しは23:50ではなく、前提の全機能の準備の完了の後(遅くとも23:55)に始まる。23:50を前提にした記述(要件14.2・14.3、設計の時刻の連鎖・発行の時刻・結果通知の追記、タスク1.3・8.1)を改めた。数日前の組み合わせ決定で発行した1回戦の予告は、notificationsが前日の夜の枠まで保持する。Week決勝の勝利の結果通知へのYearの決済期限の追記(`RESULT_NOTICE_SUPPLEMENTS`の種別`week`、Week優勝の側だけ)は変えない。
  - 変えた要件: 14.2・14.3(23:50を準備の完了の通知の前に改めた)、14.7(新設。受け入れ基準は131件)。変えたタスク: 1.1(前提に`EveningDispatchGate`・`EVENING_DISPATCH_PARTICIPANTS`)・1.3(日次タイムライン)・3.9(一括の発行)・5.1(2つのジョブと5段の順序と失敗の扱い)・5.10(前提の登録と名前の検証)・8.1(送り出しの依頼までの時刻の連鎖)。
  - 要件定義書の改訂: 本specとしての新しい改訂は無い(notificationsの仮2による日次タイムラインのサービス仕様の改訂は、本specのタスク1.3とnotificationsのタスクが行う)。
  - 他specへの依頼: 無い。tournament-weekも同じ契約で自分の名前を`EVENING_DISPATCH_PARTICIPANTS`に登録し、23:45のジョブの最後に`markReady`を呼ぶ(notificationsの契約。本specは前提にしない)。
- 変更部分(要件14.2・14.3・14.7、設計の夜の処理と送り出しの準備の完了、タスク1.1・1.3・3.9・5.1・5.10・8.1)の設計のレビューのゲートとタスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定は両方ともNEEDS_FIXESで、必須3件(tournament-weekの23:45のジョブが`tournament-week.evening-bracket`(1500)にまとまったことの反映、ジョブの数の記述の残り、`publishEvening`の受賞の引き方とタスク3.9の依存)と軽微3件(シーケンス図の前提の名前、結果通知の追記の前提、エラー表の書き方)に従って直した。2回目の判定は両方ともPASSで、軽微の指摘1件(`publishEvening`が読む年の範囲に翌年を加え、1月初旬の決勝日の参加1の受賞を拾う)に従って直した。設計とタスクを承認した(受け入れ基準131件、58のサブタスク)。

## frontend-platformの確定した契約の反映(2026-10-28)

- **状態**: frontend-platformのタスク10.4として、frontend-platformが実装で確定した契約(frontend-platformのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に本specの設計とタスクを合わせた。2026-10-28に開発者が下流specの設計の改訂を決めた(frontend-platformの判断11)。受け入れ基準は変えていない。
- **GraphQLの操作の置き場所**: 操作は`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名はclientが`Client`、adminが`Admin`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`だけを読む契約になった。clientの4つの操作(`ClientYearTournamentBoard`・`ClientYearBracket`・`ClientMyYearEntry`・`ClientStartYearTournamentCheckout`)とadminの2つの操作(`AdminYearFinalDateSettings`・`AdminUpdateYearFinalDate`)を`.graphql`に分けた。tournament-weekのフラグメントも`.graphql`に置かれ(tournament-weekの同日の反映)、`ClientYearBracket`はそれを名前で展開する。
- **管理者側のエラーの案内文**: 管理者側には問い合わせの画面が無いため、`ErrorState`に`contactHref`を渡さず、`GraphQLClientError`でない例外に代えて出す文言は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`で選ぶ契約になった。決勝実施日の区画の取得の失敗と、フォームの想定外の失敗をこの契約で書いた。
- **変えた箇所**: design.mdのAllowed Dependencies(tournament-weekのフラグメントの場所、frontend-platformの部品と操作の追加手順)・上流への影響の表・File Structure Plan・clientの節(操作の規約)・adminの節(`FinalDateSection`・`FinalDateForm`の失敗)、tasks.mdの6.1・7.1(`.graphql`・操作名・生成と許可リストの再生成)・7.3・7.4(管理者側の失敗の表示)、本ファイルの「上流・後続specへの影響」のtournament-weekの行。
- **確認のダイアログの失敗の文言**: admin-foundationの`ConfirmActionDialogProps`が必須の`failureMessageOf: (error: unknown) => string`を受け、`onConfirm`の失敗時にダイアログを開いたまま理由の入力を保ち、`failureMessageOf(error)`の文言を`role="alert"`でダイアログの中に示す契約になった(同日のadmin-foundationの改訂)。共通部品はアプリのプロファイルを読まないため、呼び出す側が文言を決める。 `FinalDateForm`は`failureMessageOf`で`validation_error`・`final_date_locked`・`version_conflict`の案内(`FinalDateLabels`)を返し、それ以外は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`を返す形に書き改めた(design.mdの`FinalDateForm`、tasks.mdの7.3)。

## 実装済みの上流との食い違いの水平展開(2026-10-30、開発者の指示)

- **Sentryの定型の通知**: content-processingの差分の分析(G-4)で、backend-platformの改訂7と技術ドキュメント`infra/004`の「同じ文言を繰り返し送る通知」が、定型の文言で繰り返し起こり得る出来事を`captureMessage`ではなく`captureEvent`で送り、文言を`logentry`、まとめる単位を`fingerprint`に置くと定めていることを確かめた。`captureMessage`は既定の`dedupeIntegration`により、同じ文言の2件目以降が捨てられる。本specの`captureMessage`をすべて`captureEvent`に改め、規約の参照と通知のタグの記述に`logentry`と`fingerprint`の置き方を加えた。通知の種類・タグ・レベルは変えていない。
- 要件と受け入れ基準は変えていない。

## 層の規則に合わせた契約の置き場所の改訂(2026-11-02、開発者の指示)

- 規則: api・eventの`src/application/**`・`src/domain/**`は`**/lib/workers/**`を型も含めて読み込めない。別の機能や後続specのapplication層が受け取る契約とDIの識別子は`apps/backend-lib/core/<ドメイン>`に置き、`workers/<ドメイン>`には実装と束縛だけを置く。application層はデータベースの接続・SQLの文・一括の書き込みを扱わない([依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析))。identity-authの`core/identity`の配置にそろえた。
- 移した契約: `YearTournamentRecord`・`YearTournamentStore`・`YearEntryRecord`・`NewYearEntry`・`YearEntryStore`・`YearCalendar`・`YearEntryRegistrar`・`YearDrawService`・`YearProgressionService`・`YearNotificationPublisher`・`YearEntryFollowUp`・`YearAwardExport`を`core/year-tournament/ports.ts`へ、`YEAR_TOURNAMENT_TYPES`を`core/year-tournament/identifiers.ts`(単体テストを加えた)へ移した。`core/year-tournament`は引き続き`core/week-tournament`を読み込まない(契約がWeekの型を使わないため)。
- `workers/year-tournament`に残す実装: `d1-year-tournament-store.ts`・`d1-year-entry-store.ts`・`year-calendar.ts`・`year-entry-registrar.ts`・`year-entry-offer-policy.ts`・`year-entry-fulfillment.ts`・`year-draw-service.ts`・`year-progression-service.ts`・`year-entry-follow-up.ts`・`year-notification-publisher.ts`・`d1-year-award-export.ts`・`year-tournament-platform-module.ts`。`YearEntryOfferPolicy`はpaymentsの`core/payments`の`PurchaseOfferPolicy`、`YearEntryFulfillment`は`workers/payments`の`PurchaseFulfillment`(文を返す)の実装で、後者はapplication層から使わない。
- 識別子の値: `YEAR_TOURNAMENT_TYPES`の値を、置き場所のドメインの名前に合わせて`Symbol.for('year-tournament.<名前>')`にした。
- 新しいポート・infrastructure層のクラス: なし。決勝実施日の保存は既にapplication層のポート`YearFinalDateWriter`とinfrastructure層の`D1YearFinalDateWriter`(監査ログの文を同じ一括の書き込みに含める)に分かれており、application層は接続・文を扱わない。
- 他specの契約の参照: tournament-weekの`BracketDraw`・`BracketProgression`・`BracketStore`・`AdvanceResult`・`BracketRecord`・`TOURNAMENT_PLATFORM_TYPES`を`core/tournament`、`WeekChampionDirectory`・`WEEK_TOURNAMENT_TYPES`を`core/week-tournament`、`MatchDirectory`を`core/match`、`ProductDirectory`を`core/product`、`UserContactDirectory`を`core/identity`、`AdminDirectory`を`core/admin`、`UltrasEntitlements`を`core/ultras`、`NotificationEventPublisher`を`core/notifications`、`PurchaseOfferPolicy`・`PaymentRefunds`・`OpenCheckoutExpirer`を`core/payments`、`PurchaseFulfillment`・`FulfillmentPlan`を`workers/payments`の契約として書いた。
- 変えた箇所: design.mdのOverviewのImpact、This Spec Owns、Allowed Dependencies(identity-auth・admin-foundation・tournament-week・match-engine・payments・ultras-subscription・notifications・product-launch、後続specの依存の範囲)、Revalidation Triggers、Architecture IntegrationのSelected patternとExisting patterns preserved、Dependency direction、File Structure Plan、コンポーネントの表(Layer)、「backend-lib/core/year-tournament・workers/year-tournament」の節(コードのファイルの注記・実装のクラス・識別子・置き場所)、Testing Strategy(`identifiers`の単体テスト)。tasks.mdの3.1(契約・識別子とその単体テスト、実装の置き場所)・3.15(実装の置き場所)・4.1・5.1(完了状態の静的解析)。

## 上流のultras-subscriptionの区画の登録口の改訂の反映(2026-11-06)

- ultras-subscriptionの実装前のギャップ分析への開発者の決定で、管理画面の設定ページの区画の登録口`ADMIN_SETTINGS_SECTIONS`の形が、adminの前例に合わせて`id`(`'<spec名>.<名詞句>'`。`CATEGORY_SECTIONS`・`DASHBOARD_CARDS`の前例)・`order`・`title`(区画の見出し。`CATEGORY_SECTIONS`の前例)・`component`になった。ページは区画ごとにfrontend-libへ移した`RecoverableSlot`で包み、1つの区画の描画や取得の失敗をその区画の位置に留め、読み込み中と失敗の間は`title`の見出しを補う。
- 本specの登録に、部品が描く見出しと同じ文言の`title`を加えた(design.mdの登録の行、tasks.mdの登録のタスク)。要件と受け入れ基準は変えていない。タスクの番号は変えていない。

## 上流のtournament-weekのフラグメントの置き場所の改訂の反映(2026-11-16)

- tournament-weekの実装前のギャップ分析への開発者の決定(tournament-weekのG3)で、clientの`codegen.unit.test.ts`が`src/graphql/operations/`の各ファイルに操作を1つだけ求めるため、フラグメントだけのファイルを`src/graphql/fragments/`へ置くことになった。Yearと共用する`BracketRoundFields`・`BracketMatchProductFields`はclientの`src/graphql/fragments/bracket/`に置く。フラグメントの名前・選択・生成される型の名前は変わらない。
- 本specのdesign.mdのAllowed Dependenciesと「上流への影響」の表、tasks.mdの`ClientYearBracket`のタスクの、フラグメントの置き場所の記述を改めた。要件と受け入れ基準は変えていない。
- 申し送り: tournament-weekのG2(週の表記とラウンド名を共用部品へ一本化する)で、`weekLabel`が参照する`formatWeekPeriodLabel`などの関数の名前が変わり得る。tournament-weekの設計の改訂で名前が確定した後に、本specの文書を合わせる。
- (解決済み、2026-11-16)tournament-weekの設計の改訂で、週の表記とラウンド名を共用部品へ一本化しても公開の名前(`formatWeekPeriodLabel`・`tournamentRoundName`など)と置き場所(`common-lib/tournament`)は変えないことになった。上の申し送りによる本specの文書の変更は不要である。

---

## 実装前のギャップ分析(2026-11-17、`/kiro-validate-gap`)

### 分析の前提

- 本specの要件・設計・タスクは承認済み(受け入れ基準131件・58のサブタスク)だが、作成の時点で実装済みの上流はdev-toolingだけだった。その後、上流のtournament-week(2026-11-17に最終検証GO)・match-engine・payments・ultras-subscription・notifications・product-launch・directory-discovery・identity-auth・email-delivery・admin-foundation・frontend-platform・backend-platformが実装された。本分析は、設計が前提にした上流の契約と現在のコードの食い違い、tournament-weekの実装と技術ドキュメント(`backend/017`・`frontend/016`)が定めた規約との差、要件定義書の番号との差を洗い出す。
- Yearトーナメントの実装(テーブル・`core/year-tournament`・`workers/year-tournament`・画面)はまだ無い。`PURCHASE_KINDS`の`year_tournament_entry`と、トップページの区画の並びのテストの`tournament-year.final`(`showcase`)は上流が先に用意している。
- `.kiro/steering`はroadmap.mdだけで、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specと実装で代替した。
- 外部の依存の調査は不要(新しいパッケージ・外部APIなし)。
- 判断は行わず、選択肢と影響を示す。

### 照合の結果の要約

上流の契約の名前・置き場所・形は概ね設計どおりに実装されている。本specが使う登録口の`order`(マッチイベント1700・1710、ライフサイクル1700、Ultrasの知らせ1700・1710、結果通知の追記1700、判定の供給元1700、トロフィーの供給元10、23:45と4:21のジョブ1700)と区画の`order`(トップページの`main` 10・`showcase` 10、`PRODUCT_OWNER_ACTIONS`・`MY_PRODUCT_SECTIONS`・`PRODUCT_DELETE_NOTICES`の20、`ADMIN_SETTINGS_SECTIONS`の10)はすべて空いている。tournament-weekの仮7(`buildBracketRoundsView`・`components/bracket/`の4部品と`BracketViewProps`・`fragments/bracket/`の2つのフラグメント)も設計どおりにある。

食い違いの多くは、tournament-weekの実装前のギャップ分析(本specと同じ型の設計をWeekで見直したもの)で見つかって直された点が、本specの設計に残っているものである。実装を壊すもの6件・形の違い6件・規約の違い7件・既存の部品との重複5件・古い記述3件を挙げる。

### 要件と既存の資産の対応

| 要件                      | 使う既存の資産                                                                                                                                                                                   | ギャップ                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1 決勝日と期限            | `BusinessTime`(`fromBusinessDateTime`・`toBusinessDateTime`・`parseBusinessDate`)、`bracketShape`、`dailyRoundPolicy`、`matchWindow`                                                             | Missing: 年の規則とテーブル。Constraint: S-2・D-3                             |
| 2 決勝実施日の設定        | `ADMIN_SETTINGS_SECTIONS`(`id`・`order`・`title`・`component`、10は予約済み)、`requireAdmin`、`AuditLogRecorder.prepare`・`buildAuditLogStatements`、`defineAuditAction`、送信者情報の区画(前例) | Missing: 区画・保存・操作種別。Constraint: D-5                                |
| 3 参加の枠                | `WeekChampionDirectory.listChampions`(`tournamentId`・`weekStart`・`productId`・`launchId`・`ownerUserId`・`awardedAt`)、`MatchDirectory.findQualifierResults`・`findMatches`                    | Missing: 枠の全部。Constraint: S-3                                            |
| 4 参加費の決済            | `PurchaseOfferPolicy`・`PurchaseFulfillment`・`CheckoutStarter.start`・`PriceCatalog`・`PURCHASE_KINDS`(`year_tournament_entry`は追加済み)                                                       | Missing: 購入種別の口の実装と登録。Constraint: S-5・C-2                       |
| 5 Ultrasの免除            | `UltrasEntitlements.wasEntitledDuring`・`entitledUsersDuring`、`UltrasActivation`(`userId`・`activatedAt`)、`OpenCheckoutExpirer.expireOpen`                                                     | Missing: 2つのハンドラ。Constraint: B-5                                       |
| 6 喪失・停止と自動返金    | `PaymentRefunds.request`(拒否は5種類)、ライフサイクルの登録口(`deleted`・`withdrawn`・`purge_due`)、`ProductDirectory.findSummaries('not-deleted')`                                              | Missing: 返金の依頼と知らせ。Constraint: B-3・C-1                             |
| 7〜9 組み合わせ・進行・賞 | `BracketDraw.create`・`BracketProgression.advance`・`AdvanceResult`・`BracketStore`、`backend/017`の凍結・分類・発行の順序の規約                                                                 | Missing: Yearの分類・上限・記録。Constraint: B-1・B-2・D-1                    |
| 10 トップページの区画     | `TOP_PAGE_SECTIONS`、`MatchCard`・`useUpvote`・`ByeList`(Yearの文言・`matchStageLabel`の`YEAR`は実装済み)、tournament-weekのトップページの区画の部品群                                           | Missing: 区画。Constraint: D-4・B-6                                           |
| 11 ブラケットのページ     | `buildBracketRoundsView`、`components/bracket/`、`fragments/bracket/`、Weekの経路`/tournaments/week/$week`(前例)                                                                                 | Missing: 経路と照会。Constraint: S-6                                          |
| 12 プロダクトの画面の区画 | `PRODUCT_OWNER_ACTIONS`・`MY_PRODUCT_SECTIONS`・`PRODUCT_DELETE_NOTICES`・`TOURNAMENT_TROPHY_SOURCES`・`TrophyShelf`(`year`を先頭に並べる処理は実装済み)                                         | Missing: 区画と供給元。Constraint: B-4                                        |
| 13 再ローンチと編集の制限 | `RELAUNCH_CONDITION_SOURCES`・`PRODUCT_LOCK_SOURCES`・`LAUNCH_SUMMARY_SOURCES`(`DecisionSourceRegistration`)、`BracketStore.findAliveRefs`・`findParticipantStandings`                           | Missing: 3つの供給元。Constraint: B-4・S-4                                    |
| 14 通知                   | `NotificationEventPublisher`(`product_of_the_year`と4桁の年の期間を受け付ける)・`RESULT_NOTICE_SUPPLEMENTS`・`EveningDispatchGate.markReady`・`EVENING_DISPATCH_PARTICIPANTS`                    | Missing: 発行と追記。Constraint: B-1・B-2・B-5                                |
| 15 連携と運用             | `ScheduledJobDefinition`、Weekの`WeekTournamentIncidentReporter`(前例)、`SCHEDULED_RUN_BUDGETS`                                                                                                  | Constraint: C-3・C-5                                                          |
| 16 ドキュメントとテスト   | `triggerScheduled`・`executeLocalD1`・`signInAsNewAdmin`・`runAxe`、Weekの`e2e/support/week-tournament-fixture-sql.ts`(前例)                                                                     | Missing: 2つの技術ドキュメント・サービス仕様の残り。Constraint: C-6・D-5・O-1 |

### 上流の契約との食い違い

#### 実装を壊すもの(設計の改訂を要する)

- **B-1 通知イベントの発行は1件の違反で全件を拒否する**(tournament-weekのB-2・G1と同じ): 設計の`publishRound`は「`match-not-previewable`は`info`のログで捨てる」としているが、`NotificationEventPublisher.publish`は1件でも違反があれば何も記録せずに`NotificationPublishError(reason, eventIndex)`を投げる。そのままでは同じ50件の残りの通知が失われる。技術ドキュメント[違反を除いた発行](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md#違反を除いた発行)は「違反の1件を除いて発行し直す」と定める。Weekの実装(`violationOf`)は`workers/week-tournament/week-notification-publisher.ts`の非公開の関数で、本設計の依存の規則(`workers/year-tournament`は`workers/week-tournament`を読み込まない)では再利用できない。
- **B-2 進行の後処理の順序**: 設計の`applyResult`は「`finished`なら`recordFinish`し、確定させた場合だけ`publishAward`」で、記録を先に置く。技術ドキュメント[発行を記録より先にする](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md#発行を記録より先にする)とWeekの実装(`WeekProgressionService.applyResult`)は、結果と予告→受賞→終了の記録の順で、記録を最後に置く(記録の後の発行の失敗を取り返せないため)。Weekは終えたときに予告を発行しない。設計の順のままでは、`recordFinish`の後に受賞の発行が失敗すると、再試行では`recordFinish`が偽を返して受賞を発行し直さず、同じ夜の`publishEvening`の補いも失敗すると受賞の通知が失われる。夜の発行の受賞の範囲も、ドキュメントは「当日の0:00から発行の時刻(組み合わせ決定と進行の後に時計を読み直した時刻)までに受賞を記録したトーナメント」とし、設計の「受賞の日時の業務日付が`date`」と表し方が異なる。
- **B-3 返金の依頼の拒否**(tournament-weekのS-7・G4と同じ): `PaymentRefunds.request`の拒否は`purchase_not_found`・`not_paid`・`invalid_amount`・`amount_exceeds_refundable`・`invalid_request_key`の5種類で、理由の形式違反は`RangeError`になる。設計の`YearEntryFollowUp.process`は前の2つしか扱わない。技術ドキュメント[返金の後処理](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md#返金の後処理)は拒否のコードごとの返金の状態(返金不要・返金済み・拒否)、1件の失敗で止めず全件を試して最後に投げる(`AggregateError`)こと、試した枠のIDを覚えることを定める。設計の枠の`refund_status`(`none`・`pending`・`requested`・`not_needed`)には返金済み・拒否の値が無い。Weekの写像`refundRejectionOutcome`は`core/week-tournament/week-entry-rules.ts`にWeekの名前で置かれ、本設計の依存の規則(`core/year-tournament`は`core/week-tournament`を読み込まない)では再利用できない。
- **B-4 受賞の供給値に`productId`が要る**(tournament-weekのB-4と同じ): `LaunchSummarySource.summarize`の`awards`の要素は`ProductAwardContribution { productId, kind, label }`である。設計の`summarize`は`{ kind: 'year', label: '<対象年>年' }`で`productId`を持たない。
- **B-5 空の登録口・登録の一覧の完全一致を前提にした上流のテスト**(tournament-weekのB-5と同じ): tournament-weekの登録を名前で参照する上流のテストが約60ファイルあり、その多くが登録口の一覧を`toStrictEqual`で確かめている(例: `apps/api/src/composition/evening-dispatch-participants.unit.test.ts`の`['tournament-week.evening-bracket']`、`apps/backend-lib/workers/payments/payments-platform-module.worker.test.ts`の登録の解決、`apps/client/src/components/top/top-page-section-order.unit.test.ts`の`main`の並び、eventの各モジュールのWorkers統合テスト)。設計の「上流への影響」は全行「契約どおり」とだけ書き、これらの書き換えを挙げていない。Weekの2回目のタスクのサニティレビューと同じく、登録口の名前を参照せずに振る舞いで影響を受けるテスト(夜の送り出しの前提の追加で変わる`notifications-module.jobs.worker.test.ts`など)は検索で拾えないため、apiとeventのWorkers統合テストの全件の実行が要る。
- **B-6 引数の検証の失敗のエラーコード**(tournament-weekのB-3と同じ): 設計のエラーの表の`yearTournamentBoard`の`bad_user_input`はコードに無い。`withValidatedArgs`は`AppError{ kind: 'bad_request', code: 'validation_error' }`を投げる。

#### 形の違い(実装時に合わせる)

- **S-1** `MatchDirectory.listForDate({ date, kinds, now })`は`now`を必須にする。設計の`publishEvening`の2つの呼び出しは`now`を省いている(`YearBoardReader.read`の呼び出しは`now`を渡している)。
- **S-2** マッチの時間帯は、tournament-weekのG5でmatch-engineの`MATCH_SCHEDULE`・`matchWindow`(`core/match/match-model.ts`)へ改名され、`core/tournament`に時間帯は無い。設計の追跡表(1.4・1.5)と`drawDue`の記述の`tournamentMatchWindow`は存在しない。
- **S-3** `WeekChampion`は`tournamentId`(Weekトーナメントの行のID)と`weekStart`(業務日付)を持ち、`'2026-W37'`の週の識別子を持たない。枠の`weekPeriod`は`common-lib/tournament`の`isoWeekKey(weekStart)`で求める。設計の`NewYearEntry`の`weekTournamentId`・`weekPeriod`の出どころを明記するとよい。
- **S-4** `BracketStore`に、参加者ごとのブラケットの形・敗退のラウンド・優勝を1回で返す`findParticipantStandings(kind, refs)`が加わった。設計の`YearEntryPanelReader`の`progress`(`findAliveRefs`・年の行の`champion_entry_id`・参加者の`eliminatedRound`の組み合わせ)と`summarize`のラウンド名は、これ1つで求められる(Weekの`week-launch-standings.ts`が前例)。
- **S-5** `PurchaseOfferDecision`の`unavailable`は`code`と`message`の両方を必須にする。Weekは拒否の文言`WEEK_ENTRY_OFFER_REJECTION_MESSAGES`を`workers/week-tournament/week-entry-offer-policy.ts`に置き、apiのpresentation層の`errors.ts`・`mappers.ts`がそこから読み込む(文言の唯一の出どころ)。設計の`describe`はコードだけを挙げる。
- **S-6** clientの画面の組み立て: Weekのブラケットのページは、loaderで`queryClient.query({ ...weekBracketQueryOptions(viewer, week), staleTime: 0 })`(取得の補助`src/graphql/week-tournament.ts`)を使い、`head`は`head/page-heads.ts`の`buildWeekBracketHead`、`errorComponent`・`notFoundComponent`を持ち、経路の引数ごとに部品を作り直す。設計の`YearBracketPage`は`ensureQueryData`と`buildPageHead`の直接の呼び出しで、取得の補助のファイル(`src/graphql/year-tournament.ts`)と`page-heads.ts`への追記がFile Structure Planに無い。

#### 規約の違い

- **C-1** メール種別とテンプレートの置き場所(tournament-weekのC-1と同じ): 種別は`core/email/kinds/<ドメイン>.ts`に`*_KIND`の名前と`<ドメイン>_EMAIL_KINDS`の一覧で置き、テンプレートは`apps/event/src/infrastructure/email/templates/<ドメイン>/`(`index.ts`で一覧を書き出す)に置く。設計は`core/year-tournament/year-entry-refund-email.ts`の`TOURNAMENT_YEAR_ENTRY_REFUND_EMAIL`と`templates/`直下のファイルである。
- **C-2** 購入種別の登録(tournament-weekのC-2と同じ): Weekは`workers/week-tournament/week-tournament-registrations.ts`が定数`WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION`を書き出し、paymentsの`purchase-kind-registrations.ts`がそれを読み込む。設計はpaymentsの側で`YEAR_TOURNAMENT_TYPES`から組み立てる。
- **C-3** apiの`application`のジョブの失敗の通知(tournament-weekのC-3と同じ): Weekは通知のポート`WeekTournamentIncidentReporter`(`apps/api/src/application/week-tournament/ports.ts`。`evening-bracket-failed`・`entry-follow-up-failed`)越しにし、Sentryの`captureEvent`はinfrastructureの実装だけが呼ぶ。設計の`YearTournamentJobs`は`captureEvent`を直接呼ぶ。
- **C-4** テーブル定義の置き場所: tournament-weekは汎用のブラケットとWeekの4テーブルを`apps/db/schema/tournament/`の1つのドメインのディレクトリに置き、マイグレーションの内容の単体テスト(`tournament-week-migration.unit.test.ts`)を持つ。設計は`apps/db/schema/year-tournament/`である([テーブル定義の配置](../../../docs/GUIDES/tech/db/003-schema-conventions.md#テーブル定義の配置)はドメインごとのディレクトリを求めるだけで、どちらも規約に反しない)。
- **C-5** 23:45の起動のジョブの合計の所要時間の予算(`SCHEDULED_RUN_BUDGETS`の300秒。超過は警告だけ)は、match-engine(1100)・notifications(1300)・tournament-week(1500)と共有する。Yearの組み合わせ決定(最大64件と上限を超えた分の分類)の見積りが設計に無い。
- **C-6** E2Eの置き場所: CLAUDE.mdとWeekの前例は、`e2e/client/<名前>.e2e.test.ts`と画面の操作の手順`<名前>-steps.ts`を並べ、ローカルD1へ入れるSQLの組み立てを単体テスト付きの`e2e/support/<名前>-fixture-sql.ts`に分ける。設計のFile Structure Planは手順のファイルとSQLの組み立てを持たない。
- **C-7** adminのディレクトリ名: adminの既存の部品と操作はドメインの名前(`components/notifications`・`components/ultras`・`operations/ultras`)で置かれる。設計はadminを`tournament-year`(spec名)、clientを`year-tournament`(ドメイン名)とし、同じ機能で名前が分かれる(軽微)。

#### 既存の部品との重複

- **D-1 並びの比較**: `core/week-tournament/week-ordering.ts`の`weekSeedOrder`・`weekNonSeedOrder`(`WeekOrderingKey`)は、設計の`yearSeedOrder`・`yearNonSeedOrder`(`YearOrderingKey`)と同じ規則・同じ型である。設計は「`core/week-tournament`に依存しないため同じ規則の関数を持つ」と意図して重複させている。
- **D-2 違反を除いた発行と返金の拒否の写像**: B-1・B-3のとおり、`backend/017`の規約の実装がWeek専用の場所(`workers/week-tournament`の非公開の関数、`core/week-tournament`の`refundRejectionOutcome`)にある。
- **D-3 業務日付の日数の計算**: 業務日付にN日を足す関数が、`core/week-tournament/week-schedule.ts`(非公開の`addBusinessDays`)、`core/tournament/round-schedule.ts`(`nextBusinessDate`)、`apps/api/src/domain/product/launch-date-rules.ts`(`addBusinessDays`)、`apps/api/src/application/match/match-jobs.ts`・`apps/event/src/infrastructure/notifications/evening-collector.ts`(非公開の`nextBusinessDate`)に散在し、`core/time/business-time.ts`の`isoWeekdayOf`・`addDays`は非公開である。本specの規則(決勝日の6・7日前、1回戦の0〜5日前、日曜日の判定、5月の最終日曜日、448日の間隔)はこれらを必要とする。
- **D-4 トップページの区画とブラケットのページの画面部品**: tournament-weekはclientに、盤面の取得と定期の取り直し(`use-week-board.ts`・`week-board-model.ts`)、決勝の行の結果待ちの取り直しと追いかけの打ち切り(`week-final-model.ts`・`week-final-round.tsx`・`week-final-showcase.tsx`と演出のCSS)、見出し(`week-section-heading.tsx`)、Upvoteを持つ対戦カード(`week-match-card.tsx`)、ブラケットのページの取り直しと失敗の表示(`week-bracket-model.ts`・`week-bracket-error.tsx`)を作った。多くは[集計値と残り時間を表示し続ける画面](../../../docs/GUIDES/tech/frontend/013-live-scoreboard.md)と[トーナメントのブラケットの表示](../../../docs/GUIDES/tech/frontend/016-tournament-bracket-view.md#開催中だけの定期再取得)の規約の実装で、Week固有の部分は文言と照会の名前に限られる。設計の`YearTournamentSection`・`YearFinalShowcase`・`YearSectionHeading`・`YearBracketPage`は「tournament-weekと同じ構成」とするが、これらの部品の再利用・共用化に触れていない。
- **D-5 業務日付を選ばせる画面の技術ドキュメント**: [業務日付のカレンダー](../../../docs/GUIDES/tech/frontend/012-business-date-calendar.md)(CLAUDE.mdの参照先「業務日付をカレンダーで選ばせる画面…を作る前に」)が、選べる範囲と規則をサーバーが決めて画面は規則を持たない形、選べない日の示し方、業務日付の`<time>`での表示、境界の時刻での取り直しを既に定めている。設計が新設する`frontend/018-server-provided-date-choices.md`(サーバーが返す候補の`<select>`、候補が無いときと変更できないときの表示、業務日付の`<time datetime>`)と主題が重なる。

#### 古い記述

- **O-1** 設計のExisting Architecture Analysisの「実装済みはdev-toolingだけ」、上流への影響のtournament-weekの行の「仮7で提供(予定)」、4:21の「上流(100〜1600)の後」(実際は2300の`content-processing.keyword-reextraction`もあり、1700はその前に動く)、tasks.mdの前提の「dev-tooling〜sponsorshipの23specの全タスクが完了」(sponsorshipは未実装だが、本specはsponsorshipの部品を使わない)。サービス仕様のうち、法的通知の大枠の返金ポリシー(Yearの上限による停止の行)と決済実装方針の購入種別の表(Yearの行)は更新済みで、Modified Filesの該当の作業は一致の確認だけになる。Yearトーナメント規則の「参加数上限 64(決勝日設定の制約により保証)」は未修正のまま残る。
- **O-2** 要件の追跡のID: 要件定義書の改訂(2026-10-25の番号の振り直しを含む)で、仮決定や本specの受け入れ基準に当たる要件が追加された。requirements.mdは次のIDを参照しておらず、2か所は振り直しの前の番号のままである。

| 要件定義書のID    | 内容                                                   | 対応する本specの受け入れ基準 | 現在の参照                          |
| ----------------- | ------------------------------------------------------ | ---------------------------- | ----------------------------------- |
| FR-TOURY-002      | 前年の決勝実施日が未設定なら既定の日(仮1)              | 3.6                          | FR-TOURY-001・FR-ADMCF-003          |
| FR-TOURY-003      | 初年度は期間の起点を設けない(仮1)                      | 3.5                          | FR-TOURY-001                        |
| FR-TOURY-006      | 優勝の確定時点のUltrasの免除                           | 5.1                          | FR-TOURY-005・FR-PPLAN-006          |
| FR-TOURY-007      | 優勝の後の加入による免除                               | 5.2                          | 無し                                |
| FR-TOURY-008      | 決済期限の後の反映と新しいローンチ(仮6)                | 4.8                          | 仮6                                 |
| FR-TOURY-010      | 組み合わせ決定の時点の非公開化・停止の除外             | 6.4                          | 無し                                |
| FR-TOURY-011      | 参加数の上限64を超えた分の停止(仮2)                    | 6.5                          | FR-TOURY-012(誤り)                  |
| FR-TOURY-017〜023 | Upvoteの確定値・勝敗の判定・即時の終了・開始時点の決着 | 8.3                          | FR-TOURY-017〜019・021〜023(旧番号) |
| FR-TOURY-025      | 次ラウンドの遅れの回復                                 | 8.9                          | 無し                                |
| FR-PYMNT-011      | 停止・上限による参加資格の停止の自動返金               | 6.6                          | 無し                                |
| FR-PYMNT-012      | 返金の非同期の処理                                     | 6.8                          | 無し                                |
| FR-PYMNT-017      | 付与できない購入の自動返金                             | 4.7・4.8                     | 無し                                |

受け入れ基準の振る舞いは変わらない。

#### 情報(設計の変更は不要)

- `tournament-week.entry-unlink`(`purge_due`、1500)は`BracketStore.unlinkProduct`を種類によらず呼び、Yearのブラケットの参加者の紐付けも解除する。設計の前提どおりである。
- `TrophyShelf`の並び(`ProductTrophyReader`)は`year`を先頭にする順を実装済みで、トロフィーの供給元の登録の形は`{ name, order, source }`である。
- 通知イベントの契約は`award: 'product_of_the_year'`と4桁の年の`period`を受け付け、重複のキーは`award:<種類>:<期間>:<プロダクトID>`である。
- `ResultNoticeSupplement`の制限(見出し50書記素・1〜5行・1行200書記素・ボタン30書記素)に設計の追記の文言は収まる。
- `ADMIN_SETTINGS_SECTIONS`のコメントは本specの10を予約済みで、送信者情報の区画(`SenderInfoSection`・`D1SenderInfoWriter`・`failureMessageOf`)が保存と監査ログと確認のダイアログの前例になる。
- 技術ドキュメントの番号`backend/019`・`frontend/018`は空いており、sponsorship(`backend/018`・`frontend/017`)・public-api(`backend/020`・`frontend/019`)の計画とも重ならない。

### 実装の進め方の選択肢

#### 選択肢A: 設計とタスクを先に改訂してから実装する

- B・S・C・D・Oのすべてをdesign.md・tasks.mdへ反映し、変更部分のレビューを経て承認し直してから`/kiro-impl`を始める(tournament-weekが取った進め方)。
- ✅ tournament-weekで確かめた規約(`backend/017`)と同じ形を最初から書け、同じ指摘の繰り返しを避けられる
- ✅ 共用化の判断(D-1〜D-4)を、Weekのコードを書き換える前に開発者が決められる
- ❌ 設計の改訂・タスクの再生成・レビューの手間が先に掛かる

#### 選択肢B: 実装の中で吸収し、Implementation Notesへ記録する

- 設計を変えずに実装を始め、各タスクで既存のコードとWeekの前例に合わせ、相違をtasks.mdのImplementation Notesと最終の報告に残す。
- ✅ すぐに着手でき、S・C・Oの多くは名前と引数の小さな違いである
- ❌ B-1〜B-3は進行・通知・返金の正しさに関わり、実装者が設計と規約の食い違いを都度判断することになる
- ❌ D-1〜D-4の共用化はtournament-weekのコードの変更を伴い、本specのタスクの範囲(上流のファイルは登録箇所への追記だけ)を超える

#### 選択肢C: 壊すものと共用化の判断だけ先に直す(折衷)

- B-1〜B-6と、共用化の方針(D-1〜D-5)を先に設計とタスクへ反映し、S・C・Oの残りは実装時に既存のコードへ合わせてImplementation Notesに残す。
- ✅ 改訂の範囲を手戻りの大きい箇所に絞れる
- ❌ C-1〜C-3はWeekで既に規約として確定しており、後回しにしても判断の余地が無い(先に直しても手間は小さい)

### 工数とリスク

- **工数: L〜XL(1.5〜2週間)** — 58のサブタスク、2テーブル・共有モジュール・apiとeventの十数の登録・clientとadminの部品・E2Eにわたる。ブラケットの規則・記録・進行と多くの画面の規約はtournament-weekにあり、作成時の見積りより統合の不確実さは小さい。D-4で画面部品を共用化する場合は、Weekの部品の書き換えとテストの分だけ増える。
- **リスク: Medium** — 技術の未知は無いが、決勝日の変更と凍結・対象年の判定(枠に対象年を保存しない設計)・同じ23:45のWeekとの順序・`backend/017`の発行と記録の順序の正しさが要で、B-1・B-2のように規約から外れると通知の欠落につながる箇所がある。

### 設計フェーズ(改訂)への推奨

- 推奨は選択肢A。tournament-weekの実装前のギャップ分析とほぼ同じ指摘が並び、B-1〜B-6・C-1〜C-3はWeekで既に方針が確定しているため、設計へ写す作業が中心になる。開発者の判断が要るのは主に共用化の論点である。
- 先に決める論点:
  - D-1・D-2(B-1・B-3): 並びの比較・違反を除いた発行・返金の拒否の写像を、`core/tournament`(または`core/payments`・`workers/notifications`)へ種類によらない名前で移してWeekとYearが共用するか、本specに同じ規則の複製を持つか。共用する場合は「`core/year-tournament`は`core/week-tournament`を読み込まない」規則を保ったまま、Weekのコードの書き換え(水平展開)を本specのタスクに含める
  - B-2: `applyResult`を`backend/017`とWeekの順(結果と予告→受賞→終了の記録)に改め、夜の発行の受賞の範囲をドキュメントの表し方にそろえるか
  - B-3: 枠の返金の状態にWeekと同じ`already_refunded`・`rejected`を足し、拒否のコードの扱いをWeekのG4にそろえるか
  - D-3: 業務日付の日数の加算と曜日の関数を`core/time/business-time.ts`から公開して既存の重複を寄せるか、本specも非公開の関数を持つか
  - D-4: トップページの区画・決勝の演出・ブラケットのページの取り直しの部品を、tournament-weekの部品から種類によらない共用の部品(例: `components/tournament/`)へ移して両方で使うか、Weekの部品を写してYear用に持つか
  - D-5: `frontend/018`を新設するか、`frontend/012`(業務日付のカレンダー)に「候補が少ない日付は`<select>`で選ばせる」節を加えるか、決勝実施日の区画を`Calendar`で作るか
  - C-4・C-7: テーブルを`apps/db/schema/tournament/`へ置くか、adminのディレクトリ名をclientと同じ`year-tournament`にそろえるか
- Research Needed:
  - C-5: 23:45の起動の300秒の予算のうち、Weekの組み合わせ決定と同じ夜(月曜日に重なる年)にYearの組み合わせ決定(最大64件の分類と上限超過の除外・返金の依頼)が収まるかの見積り
  - B-5: Yearの登録で書き換えが要る上流のテストの一覧(Weekのタスクのサニティレビューと同じく、検索と全件の実行で洗い出す)

## 実装前のギャップ分析の決定事項(2026-11-17に開発者が確定)

### 開発者が確定した論点

前節の論点のうち、判断が分かれる9件を開発者へ1件ずつ質問し、次のとおり確定した(いずれも推奨どおり)。`requirements.md`の「実装前のギャップ分析での決定事項」にも同じ行がある。

| #   | 論点(前節の番号)                        | 確定した案                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 他の選択肢                                                                        | 影響する箇所                                                                                                                                                                                                                        |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 進行の後処理の順序(B-2)                 | `applyResult`を`backend/017`とWeekの実装の順(その回の結果と予告の発行→終えた場合は優勝の枠を読み直して受賞の発行→`recordFinish`)に改め、記録を最後に置く。終えたときは予告を発行しない。`publishEvening`の受賞の範囲を「当日の0:00から発行の時刻(組み合わせ決定と進行の後に時計を読み直した時刻)までに受賞を記録した年」にそろえる                                                                                                                                                             | 順序だけ改め夜の範囲は設計どおり / 設計どおり記録を先にする                       | 設計の`YearProgressionService.applyResult`・`publishEvening`・`YearTournamentStore`(受賞の記録の時刻で読む照会)、単体テストとWorkers統合テスト                                                                                      |
| G2  | 並びの比較の重複(D-1)                   | `core/week-tournament/week-ordering.ts`の規則を、種類によらない名前(例: `launchSeedOrder`・`launchNonSeedOrder`・`LaunchOrderingKey`。名前は設計の改訂で確定)で`core/tournament`へ移し、Weekの参照と単体テストを書き換える(水平展開)。`core/year-tournament`は引き続き`core/week-tournament`を読み込まない                                                                                                                                                                                     | Yearに複製を持つ / 依存の規則を緩めWeekのものを直接読む                           | 設計の`year-ordering.ts`(`selectWithinCapacity`だけを残す)、tournament-weekの`week-ordering.ts`・`week-draw-service.ts`などの参照、`backend/017`の記述                                                                              |
| G3  | 違反を除いた発行の重複(D-2・B-1)        | `core/notifications`に、発行の口・発行元の名前・ロガーを受け取り、50件ずつに分けて違反の1件を除いて発行し直す共用の関数(例: `publishExcludingViolations`。名前は設計の改訂で確定)を置き、WeekとYearの両方が使う。Weekの`WeekTournamentNotificationPublisher`の非公開の処理を書き換える(水平展開)                                                                                                                                                                                               | `core/tournament`の共用の関数にする / Yearに複製を持つ                            | 設計の`YearNotificationPublisher`、tournament-weekの`week-notification-publisher.ts`とその単体テスト、notificationsの技術ドキュメント`backend/016`と`backend/017`の記述                                                             |
| G4  | 返金の依頼の拒否(B-3・D-2)              | 拒否の扱いをWeekのG4にそろえる(`not_paid`・`purchase_not_found`は返金不要、`amount_exceeds_refundable`は返金済みとして運用者へ知らせる、`invalid_amount`・`invalid_request_key`と理由の形式違反の`RangeError`は拒否として運用者へ知らせ再処理から外す、知らせのメールは返金不要・返金済み・拒否のいずれも送らない)。写像`refundRejectionOutcome`を種類によらない名前で`core/tournament`へ移して共用し、Weekの参照を書き換える。Yearの枠の`refund_status`に`already_refunded`・`rejected`を足す | `core/payments`へ移して共用 / Yearに複製を持つ                                    | 要件6.8(本決定を加えた)、設計の`YearEntryFollowUp.process`・`year-entry-rules.ts`・テーブルのCHECK・`YearEntryRecord.refundStatus`・運用者への知らせの種類、tournament-weekの`week-entry-rules.ts`・`week-entry-follow-up.ts`の参照 |
| G5  | 業務日付の日数の計算の重複(D-3)         | `core/time/business-time.ts`から日数の加算と曜日の関数(例: `addBusinessDays`・`businessWeekdayOf`。名前は設計の改訂で確定)を公開し、Yearが使うと同時に既存の5か所(`core/week-tournament/week-schedule.ts`・`core/tournament/round-schedule.ts`の`nextBusinessDate`・`apps/api/src/domain/product/launch-date-rules.ts`・`apps/api/src/application/match/match-jobs.ts`・`apps/event/src/infrastructure/notifications/evening-collector.ts`)をそれを使う形に寄せる(水平展開)                    | `core/time`から公開するだけ / Yearに非公開の関数を持つ                            | 設計の`year-schedule.ts`・`final-date-choice.ts`、Modified Files(tournament-week・match-engine・notifications・product-launchのファイルとテスト)                                                                                    |
| G6  | 画面部品の重複(D-4)                     | tournament-weekのclientの部品のうち、トップページの区画(盤面の取得と定期の取り直し・見出し・対戦カード)・決勝の演出と結果待ちの取り直し・ブラケットのページの取り直しと失敗の表示・参加費の導線(状態の文言の選び方・決済の開始)を、種類によらない共用の部品(clientの`components/tournament/`)へ移し、照会・文言・経路を引数で受ける。Weekの画面を書き換えてYearも使う(水平展開)。Weekの振る舞いと文言は変えない                                                                                | モデルとフックだけ移し見た目の部品はYear用に持つ / Weekの部品を写してYear用に持つ | 設計のclientの節とFile Structure Plan、tournament-weekの`components/week-tournament/`の部品とブラウザテスト、`frontend/013`・`frontend/016`の記述                                                                                   |
| G7  | 日付の候補の選択の技術ドキュメント(D-5) | `frontend/018-server-provided-date-choices.md`を新設せず、`frontend/012-business-date-calendar.md`に「候補が少なく曜日などで限られる日付は、サーバーが返す候補の`<select>`で選ばせる」節(候補が無いとき・変更できないときの表示、確認のダイアログでの影響の明示、版の競合の案内を含む)を加える                                                                                                                                                                                                 | `frontend/018`を新設する / 決勝実施日も共通部品の`Calendar`で選ばせる             | 要件16.5(本決定を加えた)、設計のYearTechDocs・File Structure Plan・Modified Files(`frontend/README.md`の行は不要になる)、`CLAUDE.md`の参照先の文言                                                                                  |
| G8  | テーブル定義の置き場所(C-4)             | `apps/db/schema/tournament/`に`year-tournaments.ts`・`year-tournament-entries.ts`を置き、Weekと同じくマイグレーションの内容の単体テスト(`tournament-year-migration.unit.test.ts`)を持つ                                                                                                                                                                                                                                                                                                        | 設計どおり`apps/db/schema/year-tournament/`                                       | 設計のThis Spec Owns・File Structure Plan・Modified Files・Dependency direction                                                                                                                                                     |
| G9  | adminのディレクトリ名(C-7)              | adminも`components/year-tournament/`・`src/graphql/operations/year-tournament/`にし、clientとbackend-libのドメイン名にそろえる                                                                                                                                                                                                                                                                                                                                                                 | 設計どおり`tournament-year`                                                       | 設計のFile Structure Plan・adminの節                                                                                                                                                                                                |

実装では次の点が変わった(確定した案の記録は変えない)。G7の`frontend/012`の節は、候補を`<select>`ではなく共通部品の`Select`で選ばせる形で書いた。G6の共用の部品の契約は、`useTournamentBoard`が盤面ではなく閲覧者を受ける、文言の型に`title`・`awardName`を足し`TournamentBracketCopy.pageTitle`を除く、返金の文を喪失と除外に分ける、共用のページと導線に任意の受け口(決勝日・決済の導線の案内)を足す形になった(design.mdの「TournamentClientParts」が実装の形)。曜日つきの業務日付の表記は、backend-lib・client・adminで共用のcommon-libの`formatBusinessDateWithWeekdayLabel`に寄せ、ブラケットのページの年の形式はcommon-libの`parseTournamentYear`でclientとapiが共用する。

### 既存のコードと規約に合わせて決めた事項

開発者に質問せず、既存のコード・規約・tournament-weekの決定に合わせて次のとおり扱う(設計の改訂で反映する)。

- B-1: G3の共用の関数を使う。予告できないマッチの違反はレベル`info`、それ以外の位置のある違反は`error`のログにし、位置の無い拒否は例外のまま投げる(`backend/017`の[違反を除いた発行](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md#違反を除いた発行))。
- B-3: G4に加え、`YearEntryFollowUp.process`は1件の失敗で止めずに全件を試して最後に投げ(1件なら元の例外、複数なら`AggregateError`)、続きの位置を持たない読み取りで繰り返すときは試した枠のIDを覚える(`backend/017`の[返金の後処理](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md#返金の後処理))。
- B-4: `summarize`の受賞は`{ productId, kind: 'year', label: '<対象年>年' }`を返す。
- B-5: 空の登録口や登録の一覧の完全一致を確かめる上流のテストを、本specの登録に合わせて書き換える作業を設計の「上流への影響」とタスクに加える。各登録のタスクは、登録の前に上流のテストを検索で洗い出し、完了状態にapiとeventのWorkers統合テストの全件の実行を含める(tournament-weekのタスクのサニティレビューの指摘と同じ)。
- B-6: 引数の検証の失敗は`withValidatedArgs`の`bad_request`・`validation_error`とする。
- S-1〜S-6: 現在の契約の形に合わせる(`listForDate`の`now`、`matchWindow`・`MATCH_SCHEDULE`、`WeekChampion`の`tournamentId`・`weekStart`と`isoWeekKey`による週の識別子、`findParticipantStandings`による進行と敗退のラウンド、`unavailable`の`message`と拒否の文言の唯一の出どころ(`YEAR_ENTRY_OFFER_REJECTION_MESSAGES`を`workers/year-tournament/year-entry-offer-policy.ts`に置き、apiのpresentation層が読み込む)、clientの取得の補助`src/graphql/year-tournament.ts`と`head/page-heads.ts`への追記とWeekのページと同じloaderの形)。S-6のブラケットのページの組み立てはG6の共用の部品で行う。
- C-1: メール種別は`core/email/kinds/tournament-year.ts`に`TOURNAMENT_YEAR_ENTRY_REFUND_KIND`と`TOURNAMENT_YEAR_EMAIL_KINDS`で置き、テンプレートは`apps/event/src/infrastructure/email/templates/tournament-year/`に置く(Weekの`tournament-week`と同じ形)。
- C-2: 購入種別の登録は`workers/year-tournament/year-tournament-registrations.ts`が定数`YEAR_TOURNAMENT_PURCHASE_KIND_REGISTRATION`を書き出し、paymentsの`purchase-kind-registrations.ts`がそれを読み込む。
- C-3: apiの`application`のジョブの失敗の通知は、通知のポート(`YearTournamentIncidentReporter`。Weekの`WeekTournamentIncidentReporter`と同じ形)越しにし、Sentryはinfrastructureの実装だけが呼ぶ。
- C-5: Weekの組み合わせ決定と同じ夜(Yearの組み合わせ決定の日が月曜日の年)に、23:45の300秒の予算に収まるかを設計で見積もる(予算の超過は警告だけで処理は止まらない)。
- C-6: E2Eは`e2e/client/year-tournament.e2e.test.ts`と`year-tournament-steps.ts`、`e2e/admin/`の同じ組、ローカルD1へ入れるSQLの組み立てを単体テスト付きの`e2e/support/year-tournament-fixture-sql.ts`に分ける。
- O-1: 設計の古い記述(実装済みの上流、tournament-weekの仮7の行、4:21の上流の順序)を直す。tasks.mdの前提を、本specが実際に使う上流(sponsorshipを含めない)に絞る。サービス仕様のうち法的通知の大枠と決済実装方針は更新済みのため、Modified Filesの作業を一致の確認に改める。
- O-2: requirements.mdの受け入れ基準が参照する要件IDを、要件定義書の現在の番号に合わせた(本決定の時点で反映済み。3.5・3.6・4.7・4.8・5.1・5.2・6.4・6.5・6.6・6.8・8.3・8.9)。
- 進め方: 前節の選択肢A(全ての食い違いと決定を設計とタスクへ先に反映してから実装する)とする。spec.jsonの設計とタスクの承認を外した。`/kiro-spec-design tournament-year`で設計を改訂し、承認の後に`/kiro-spec-tasks tournament-year`でタスクを作り直す。

### 上流・他specへの影響

- tournament-week: G2〜G6でWeekのコード(`core/week-tournament`の並びと返金の拒否の写像、`workers/week-tournament`の通知の発行、`week-schedule.ts`の日数の計算、clientの`components/week-tournament/`の部品)を共用の部品へ移す。Weekの振る舞いとテストの期待値は変えない。技術ドキュメント(`backend/016`・`backend/017`・`frontend/013`・`frontend/016`)の部品の名前と置き場所の記述は、本specのタスク8.2で合わせる。承認済みのspecの記録であるtournament-weekのdesign.md・tasks.md(`.kiro/`)は書き換えず、移した後の名前と置き場所は本specの設計を正とする(タスクのサニティレビューの指摘による、2026-11-17)。
- match-engine・notifications・product-launch: G5の寄せ替えで、各1ファイルの非公開の日数の計算を共用の関数に置き換える(振る舞いは変えない)。
- data-export: `YearAwardExport.listForLaunches`の契約は変えない。G8でテーブル定義の置き場所が変わるが、data-exportは本specのテーブルを直接読まない。

## 設計の改訂(2026-11-17、`/kiro-spec-design tournament-year`)

- **発見の種別**: Extension(light discovery)。上流は実装済みで、契約の照合は「実装前のギャップ分析」で済んでいるため、決定G1〜G9と食い違いの反映に要る既存のコードだけを読み直した。tournament-weekの`week-ordering.ts`・`week-entry-rules.ts`(拒否の写像)・`week-notification-publisher.ts`(違反を除いた発行と`publishNight`)・`week-progression-service.ts`(`applyResult`の順)・`week-schedule.ts`・`round-schedule.ts`と各参照、`listAwardedBetween`、`week-tournament-platform-module.ts`の束縛の形(ストアは`@inject`、サービスは`toDynamicValue`)、apiの`week-tournament-jobs.ts`・`ports.ts`(`WeekTournamentIncidentReporter`)・`board-resolvers.ts`(`placementOf`)・`week-entry-panel-reader.ts`(`findParticipantStandings`・`listByLaunches`)・GraphQLの型、clientの`components/week-tournament/`の全モデルと部品の引数・`/tournaments/week/$week`の経路・`fragments/week-tournament/week-board-round-fields.graphql`、`core/email/kinds/tournament-week.ts`とテンプレートの置き場所、日数の計算の5か所(`launch-date-rules.ts`・`match-jobs.ts`・`evening-collector.ts`を含む)、`e2e/client`・`e2e/admin`・`e2e/support`の配置、サービス仕様のページ配置のトーナメント参加費の導線(YearにUltrasの案内と秒読みが無いこと)。外部の依存の調査は不要(新しいパッケージ・APIなし)。
- **参照したスキルと規則**: cc-sddの`kiro-spec-design`の規則(design-discovery-light・design-synthesis・design-review-gate)、CLAUDE.mdの技術規則の参照先([単一敗退のブラケット](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md)の発行と記録の順序・違反を除いた発行・夜の発行・返金の後処理、[トーナメントのブラケットの表示](../../../docs/GUIDES/tech/frontend/016-tournament-bracket-view.md)、[集計値と残り時間を表示し続ける画面](../../../docs/GUIDES/tech/frontend/013-live-scoreboard.md)、[業務日付のカレンダー](../../../docs/GUIDES/tech/frontend/012-business-date-calendar.md)、[共通化の対象](../../../docs/GUIDES/tech/frontend/005-shared-components.md#共通化の対象)、[テーブル定義の配置](../../../docs/GUIDES/tech/db/003-schema-conventions.md#テーブル定義の配置)、[依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析))。
- **統合(synthesis)**:
  - 一般化: WeekとYearで同じ規則を、種類によらない名前で`core/tournament`(並び`launchSeedOrder`・`launchNonSeedOrder`、拒否の写像`refundRejectionOutcome`)・`core/notifications`(`publishExcludingViolations`)・`core/time`(`addBusinessDays`・`businessWeekdayOf`)へ置いた(G2〜G5)。clientはWeekの部品を`components/tournament/`へ移し、種類の値(照会・文言・経路・Ultrasの案内・秒読みの有無)を引数で受ける形にした(G6)。参加費の導線は、包みがGraphQLの値を共用の入力`TournamentEntryInput`へ写し、Weekの`refundable = !exempt`とYearのサーバーの`refundable`の違いを包みに閉じ込めた。
  - 一般化しなかったもの: Weekの`week-launch-standings.ts`(Weekの週の行と期限に依存)と、board-resolversの`placementOf`の呼び出し(数行)は共用にせず、Yearは同じ規則を自分の照会で行う。
  - 既存に合わせる: `applyResult`と夜の発行の受賞の範囲を`backend/017`とWeekの実装の順と表し方にそろえ(G1)、ストアに`listAwardedBetween`を足して年の範囲の計算を除いた。返金の状態に`already_refunded`・`rejected`を足し`markRefundClosed`にまとめた(G4)。メール種別とテンプレート・購入種別の登録の定数・ジョブの失敗の通知のポート・E2Eの手順とSQLの組み立て・clientの取得の補助と`page-heads.ts`をWeekと同じ置き場所にした(C-1〜C-3・C-6・S-6)。
  - 簡素化: `YearEntryStatusCopy`をやめ、表示の種類の判定は共用の`tournamentEntryDisplayOf`、文言は`TournamentEntryCopy`のYearの値にした。`year-ordering.ts`は上限の選択だけの`year-capacity.ts`にした。`frontend/018`は新設せず`frontend/012`への追記にした(G7)。
  - 見積り(C-5): 23:45の300秒の予算は、Yearの組み合わせ決定が1年あたり数秒の見込みで、Weekと同じ夜でも収まる。超過は警告だけで処理は止まらないため、所要時間のテストは置かない(時間の検査は不安定になるため)。
- **設計への反映**: Overview(Impact・Goals)、Boundary Commitments(テーブルの置き場所、メール種別、共用へ移す部品、登録の定数、ジョブの失敗の通知、admin・clientの部品の置き場所、技術ドキュメント)、Out of Boundary、Allowed Dependencies(実装された契約の形)、Revalidation Triggers、上流への影響(G2〜G6の書き換えとB-5の上流のテスト)、Existing Architecture Analysis・Architecture Integration・Dependency direction、File Structure Plan(全面的に改め、clientの共用の部品の対応表を加えた)、System Flows(週の識別子、共用の並び、参加0・1の後処理、返金の拒否)、追跡表、コンポーネントの表、`core/year-tournament`の契約(上限・返金の状態・メール種別)と共用の部品の契約、ストアの契約(`listAwardedBetween`・`markRefundClosed`)、購入の可否の口の文言と登録の定数、`applyResult`・発行・`publishEvening`・`process`、apiの照会(`placementOf`・`findParticipantStandings`)・`summarize`(`productId`)・ジョブ(失敗の通知のポート・時計の読み直し・4:21の順序・予算)、GraphQLのエラーの表、`byes`の分け方、eventのテンプレート、clientの節(共用の部品の契約とYearの包み)、adminの置き場所と区画の題名の定数、docs(`frontend/012`への追記)、データモデル、エラーの分類、Monitoring、Testing Strategy。
- **レビューゲート**: 機械的な検査で、要件の131件の受け入れ基準がすべて追跡表にあること、境界の4節とファイル構成が空でないこと、新しい部品(`LaunchOrdering`・`RefundRejection`・`ViolationTolerantPublish`・`BusinessDateArithmetic`・`TournamentClientParts`・`YearCapacity`・`YearEmailKinds`・`YearTournamentRegistrations`・`YearTournamentIncidentReporter`・`UseYearBoard`・`YearEntryView`)のファイルがファイル構成にあること、古い名前(`tournamentMatchWindow`・`yearSeedOrder`・`YearOrderingKey`・`TOURNAMENT_YEAR_ENTRY_REFUND_EMAIL`・`bad_user_input`・`YearEntryStatusCopy`・`year-ordering.ts`・`schema/year-tournament`・adminの`tournament-year`のディレクトリ・`markRefundNotNeeded`・`frontend/018`の新設)が残っていないこと、api・eventの`application`がSentryを直接呼ばないことを確かめた。判断のレビューで、Yearのトップページのフラグメントの選択をWeekと同じとした記述の誤り(Yearは行の`finalDate`を持つ)と、組み合わせ決定の所要時間をテストで確かめる記述(不安定な検査)を直した。2回目の機械的な検査で問題は無かった。
- **残る作業**: 設計の承認の後に`/kiro-spec-tasks tournament-year`でタスクを作り直す(G2〜G6の移設と書き換えのタスクを先に置き、Weekの既存のテストが期待値を変えずに通ることを完了状態にする。B-5の上流のテストの洗い出しを各登録のタスクに含める)。

## タスクの計画の再生成(2026-11-17、`/kiro-spec-tasks tournament-year`、未承認)

- 承認された改訂後の設計から、既存の`tasks.md`(58のサブタスク)を引き継ぐ形でタスクを作り直した。下書きは66のサブタスクで、共用の部品への移設(1.1 業務日付の計算とトーナメントの寄せ替え、1.2 他specの寄せ替え、1.3 並びと拒否の写像、1.4 違反を除いた発行、1.5〜1.7 clientの部品)を基盤の先頭に置き、Weekの既存のテストが期待値を変えずに成功することを完了状態にした。要件の131件の受け入れ基準がすべてタスクにあり、全てのサブタスクに完了状態があることを機械的に確かめた。
- タスクのグラフのサニティレビュー(新しいサブエージェントによる独立した確認、上限2回):
  - 1回目はNEEDS_FIXES(必須3件)。(1)見出しと決勝の行が読み込むブラケットへのリンクの移設がブラケットのページのタスクにあった(1.5へ移した)。(2)並行の6.3〜6.5がYearの文言とフィクスチャのファイルを同時に変える(6.2がトップページ・決勝・ブラケットの文言とフィクスチャをまとめて作り、6.5は参加費の導線の文言とフィクスチャを別のファイルに置く形にした)。(3)3.16に上流のテストの洗い出しとapi・eventのWorkers統合テストの全件の実行が無かった。軽微の指摘(1.1の分割、5.3・5.6の(P)、決勝実施日の書き込みのポートを作るタスク、8.2の`backend/017`の削った関数の名前の検査、8.1・8.4の不要な依存、Weekの文言のファイルの書き出しの担当、共用の部品のテストの値の置き場所)にも従った。research.mdの「上流・他specへの影響」の、tournament-weekのdesign.mdを書き換えるとした記述を、承認済みのspecの記録は書き換えない形に直した。
  - 2回目もNEEDS_FIXES(必須1件)。1回目の3件の修正と番号の振り直しは確認された。必須の指摘は、6.3が`showcase` 10を加えると、登録の一覧を完全一致と位置で確かめる`top-page-sections.browser.test.ts`が失敗するのに、その書き換えの担当が無いことだった。
- kiro-spec-tasksの規則(2回目の判定がPASSでなければ、`tasks.md`を書かず承認もせずに止める)に従い、`tasks.md`は書き換えていない(旧い58のサブタスクのまま)。2回目の必須の指摘(6.3に登録箇所のテストの書き換えを加える)と軽微の指摘(1.5のYearの例の担当、1.5でのWeekの部品の文言の読み込み元の修正、1.6・1.7のテストの値のファイル名の分離、8.5の補助の参照先)は下書きに反映し、参加費の導線用のフィクスチャ`year-entry-fixtures.ts`を設計のFile Structure Planに加えた。`/kiro-spec-tasks tournament-year`を再実行し、修正済みの下書きのサニティレビューがPASSになれば`tasks.md`を書いて承認できる。
- **再実行(2026-11-17)**: `/kiro-spec-tasks tournament-year`を、前回の指摘を直した下書きを引き継ぐ形で再実行した。要件の131件の網羅と全サブタスクの完了状態を機械的に確かめ直し、新しいサブエージェントによる独立した確認(independent)を行った。判定はPASS(必須の修正なし)。軽微の指摘のうち、6.6の包みの部品の作成の明記、3.4の完了状態にbackend-libの型検査を加えること(3.1の契約に3.2〜3.4が実装を順に加えるため)、6.2の並びの確認を実際の登録を確かめる登録箇所のブラウザテストで行うことを反映した。1.5の分割(番号の振り直しが要る)、1.2・1.6・1.8の(P)の付け方、共用の部品のテストの値のファイルの設計への追記は、実行を妨げないため反映していない(テストの値のファイルは実装の報告で相違点として扱う)。`tasks.md`を書いた(8の大タスク・66のサブタスク、うち22が(P))。タスクの承認は開発者の確認を待つ。
