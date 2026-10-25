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

### Decision: 期限は年の行の列を正とし、決勝日の保存と同じ一括の書き込みで書き直す

- **Context**: 決勝日の変更、E2Eで時刻を進める必要(tournament-weekと同じ)、変更期限の判定。
- **Selected Approach**: `year_tournaments`に`final_date`・`final_date_source`・`deadline_date`・`accept_until`・`deadline_at`・`draw_at`・`change_lock_at`を持つ。行の作成時と決勝日の保存時に`yearScheduleFor`で求めて書き、以後の判定(決済の可否・反映・Ultrasの付与・再ローンチ・組み合わせ決定の到来・追記・画面)は列を読む。保存の文は`final_date_version = ? AND draw_started_at IS NULL AND change_lock_at > ?`を`CASE`式の条件にし、満たさなければNOT NULL制約の違反で監査ログごと取り消す。
- **Rationale**: 変更期限と版と凍結の検査を1つの文で行え、監査ログと保存が一体で確定する(notificationsの送信者情報・ultras-subscriptionの機能フラグと同じ形)。

### Decision: 参加数の上限はWeek優勝の日時が新しい順に64件(仮2)

- **Context**: 65件以上は日程に収まらず、FR-ADMCF-003の検査だけでは防げない。
- **Selected Approach**: 分類の後に`drawn`の件数を数え、超えた古いWeek優勝を`excluded`(`over_capacity`)にし、決済済みは`capacity_exceeded`で返金する。
- **Rationale**: 期間の起点を遅らせたのと同じ効果で、FR-ADMCF-003の考え方に合う。

### Decision: 決勝実施日の区画は年ごとのカードと候補の`<select>`

- **Context**: FR-ADMCF-001〜003・006・007、仮8、アクセシビリティ。
- **Selected Approach**: サーバーが現在の年と翌年について、実効の決勝日・出どころ・期限・変更の可否と理由・候補の日付(最大53件)・前年と翌年の日付・注意を返し、画面は候補の`<select>`と理由の入力欄を`ConfirmActionDialog`で確定する。サーバーは同じ純粋な規則で再検証する。
- **Rationale**: カレンダーの部品で選べない日を灰色にするより、候補だけを並べる方がキーボードと読み上げで扱いやすく、検証の規則を1か所に保てる。新しいパッケージが要らない。

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
- 年の行の作成漏れ(23:45の`tournament-year.evening-bracket`が動かないまま組み合わせ決定の時刻を過ぎる) — その年は「開催しなかった年」として扱われ、枠は翌年の対象になる。行の用意は毎晩行い、管理画面の照会と保存でも行う。失敗は`captureMessage`で検知する。
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

- tournament-week(上流): 登録箇所への追記だけ。`TOURNAMENT_TROPHY_SOURCES`(apiの`composition/tournament-trophy-sources.ts`)に`tournament-year.year-trophies`(10)。**本specの依頼による改訂はtournament-weekの仮7で提供済み**: (1)apiの`apps/api/src/application/tournament/bracket-view-builder.ts`の純粋な関数`buildBracketRoundsView({ record, matchViews, now }): BracketRoundsView`(`participantCount`・`seedCount`・`rounds`・`championNo`、DIに束縛しない)と、GraphQLの`BracketRound`・`BracketNode`・`BracketSlot`をこの値だけから解決するリゾルバ。(2)clientの`graphql/operations/week-tournament/week-bracket.ts`が書き出す`BracketRoundFields`(`BracketRound`)・`BracketMatchProductFields`(`MatchProduct`)と、`BracketViewProps`(`rounds: readonly BracketRoundFieldsFragment[]`・`champion: BracketMatchProductFieldsFragment | null`・`awarded: boolean`・`finished: boolean`)で受ける`components/bracket/`の4部品(Weekのページは`components/week-tournament/week-bracket-page.tsx`へ移った)。本specは使うだけで、tournament-weekのタスク6.6・6.10・7.1・7.4の完了を前提にする。`BracketStore.unlinkProduct`がブラケットの種類によらず参加者の紐付けを解除すること(tournament-weekの`tournament-week.entry-unlink`が呼ぶ)を前提にし、本specは呼ばない。
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
  - 毎晩、(1)次に開催する年の行の用意とWeek優勝の取り込み、(2)組み合わせ決定、(3)進行(確定のマッチイベントの処理が終わっていなくても、マッチの結果から同期で追いつく)、(4)その夜の一括の発行(`YearNotificationPublisher.publishEvening`: その日の確定したYearのマッチの結果・翌日の予告・その日の受賞。`dedupe`で冪等)、(5)`markReady({ participant: 'tournament-year.evening-bracket', date: context.business.date, at: clock.now() })`の順に行う。組み合わせや進行の無い夜(大半の夜)も呼ぶ。(1)〜(4)のどれかが失敗した夜は、残りの段を続けて`captureMessage`したうえで`markReady`を呼ばずに例外を投げ、notificationsの23:55の期限の送り出しと`evening-dispatch-incomplete`の検知に任せる。戻り値で処理を分けない。
  - 送り出しは23:50ではなく、前提の全機能の準備の完了の後(遅くとも23:55)に始まる。23:50を前提にした記述(要件14.2・14.3、設計の時刻の連鎖・発行の時刻・結果通知の追記、タスク1.3・8.1)を改めた。数日前の組み合わせ決定で発行した1回戦の予告は、notificationsが前日の夜の枠まで保持する。Week決勝の勝利の結果通知へのYearの決済期限の追記(`RESULT_NOTICE_SUPPLEMENTS`の種別`week`、Week優勝の側だけ)は変えない。
  - 変えた要件: 14.2・14.3(23:50を準備の完了の通知の前に改めた)、14.7(新設。受け入れ基準は131件)。変えたタスク: 1.1(前提に`EveningDispatchGate`・`EVENING_DISPATCH_PARTICIPANTS`)・1.3(日次タイムライン)・3.9(一括の発行)・5.1(2つのジョブと5段の順序と失敗の扱い)・5.10(前提の登録と名前の検証)・8.1(送り出しの依頼までの時刻の連鎖)。
  - 要件定義書の改訂: 本specとしての新しい改訂は無い(notificationsの仮2による日次タイムラインのサービス仕様の改訂は、本specのタスク1.3とnotificationsのタスクが行う)。
  - 他specへの依頼: 無い。tournament-weekも同じ契約で自分の名前を`EVENING_DISPATCH_PARTICIPANTS`に登録し、23:45のジョブの最後に`markReady`を呼ぶ(notificationsの契約。本specは前提にしない)。
- 変更部分(要件14.2・14.3・14.7、設計の夜の処理と送り出しの準備の完了、タスク1.1・1.3・3.9・5.1・5.10・8.1)の設計のレビューのゲートとタスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定は両方ともNEEDS_FIXESで、必須3件(tournament-weekの23:45のジョブが`tournament-week.evening-bracket`(1500)にまとまったことの反映、ジョブの数の記述の残り、`publishEvening`の受賞の引き方とタスク3.9の依存)と軽微3件(シーケンス図の前提の名前、結果通知の追記の前提、エラー表の書き方)に従って直した。2回目の判定は両方ともPASSで、軽微の指摘1件(`publishEvening`が読む年の範囲に翌年を加え、1月初旬の決勝日の参加1の受賞を拾う)に従って直した。設計とタスクを承認した(受け入れ基準131件、58のサブタスク)。
