# Research & Design Decisions

## Summary

- **Feature**: `ultras-subscription`
- **Discovery Scope**: Complex Integration(有料プランの実装は無い。上流の13spec(dev-tooling〜payments)の設計・タスクは承認済みで実装は未着手であり、本specはpaymentsの購入種別・定期課金の受け取り口・Stripeの定期課金の操作の上に、加入状態・特典の判定・加入のイベント・機能フラグ・料金ページとプラン管理画面を足す。外部サービス(Stripe Billing・Customer Portal)の仕様と、各国の自動更新の規制を調べた)
- **Key Findings**:
  - paymentsの購入種別の口(`PurchaseFulfillment.prepare`)と定期課金の受け取り口(`SubscriptionEventSink.statementsFor`)はD1の文だけを返し、確定の後に呼ばれる場所が無い。加入が有効になった知らせ(FR-PPLAN-007)と支払いの失敗のメールを確定の直後に送り出すには、口に省略可能な`afterCommit`を足す必要がある。依頼待ちの行を一括の書き込みに含め、`afterCommit`と4:21の日次の確認で送り出す(仮5)。
  - API版`2025-09-30.clover`以降、新しい定期課金は柔軟な請求モードで作られ、Customer Portalでの期間末の解約は`cancel_at`の時刻で表され`cancel_at_period_end`は偽のままになる。paymentsの`SubscriptionChange`は`cancelAtPeriodEnd`しか持たないため、`cancelAt`を足さないとPortalでの解約を見落とす(仮5)。
  - 加入状態を保存せず、加入ごとの「特典の継続期間」`[開始時刻, 特典の終了時刻)`を保存して問い合わせの時刻から導くと、終了のための定期実行が要らず、過去の時点の判定(勝利時点の免除、Q1)も同じ区間で答えられる。終了の状態で決めた終了時刻を変えないことで、過去の判定が後から変わらない。
  - ドイツ民法典312k条4項は、オンラインで受け付けた解約の内容・受領の日時・終了の時点をテキスト形式(メールなど)で直ちに確認するよう求める。Q8の「解約の受付は画面の表示だけ」ではこれを満たせないため、解約の受付の確認メールを仮1として加えた。カリフォルニア州の自動更新法(Bus. & Prof. Code 17602条(a)(3))は購入後に自動更新の条件・解約の方針・解約の方法を保存できる形で知らせるよう求めるため、paymentsの購入確認メールに最終確認画面の追加事項を載せる(仮3)。

## 要件フェーズ前の確認事項(2026-10-23)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                       | 根拠                                                                                                                                                                                            | 回答(2026-10-23)                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 参加費免除の判定時点       | FR-TOURW-003・FR-TOURY-003・FR-PPLAN-005・007、roadmapのRequirement Ambiguities(ultras-subscription・tournament-week)、料金とプラン「トーナメント参加費の免除条件」                             | 推奨案(勝利時点と加入時点)。予選勝利またはWeek優勝の確定時点で特典を受けられる状態(active・past_due・canceled)なら即座に参加資格を得る。勝利の後、決済期限(23:35)までに加入すれば加入した時点で得る。本specは指定時点の判定と加入のイベントを提供し、資格の付与はtournament-week・tournament-yearが受け持つ                                                                       |
| Q2  | 決済後に加入した場合の返金 | FR-PPLAN-007(未完了の決済セッションの失効だけを定める)、roadmapのRequirement Ambiguities、法的通知の大枠の返金ポリシー(原則として決済完了後は返金しない)                                        | 推奨案(返金せず事前に案内)。決済済みの参加費は付与済みの参加資格の対価として返金しない。加入の画面(最終確認画面の追加事項)と`/pricing`に「支払い済みの参加費は返金されません」と表示する                                                                                                                                                                                          |
| Q3  | 停止時の返金               | FR-PPLAN-010、法的通知の大枠の返金ポリシー(「特典提供停止」「当該課金期間末までの日数分を自動で返金する」)、同じ表の「定期課金の解約: 日割り返金しない」、paymentsのQ1(後続specへの申し送り)    | 推奨案(期間末に解約・返金なし)。要件定義書のとおり課金期間の末日に終わるよう解約し、返金しない。返金ポリシーの該当行を「返金しない」に直す作業を本specに含める。返金ポリシーの他の行(停止・非公開化に伴うトーナメント参加資格の停止、広告の強制終了・表示停止)は書き換えず、後続specの担当として報告する                                                                          |
| Q4  | 解約後の特典の終了時刻     | FR-PPLAN-003(「UTC-08:00時間で当該課金期間の末日まで」)、日次タイムライン「Ultras解約後の特典継続」、Stripeの課金期間の終了時刻は日の区切りに合わない                                           | 推奨案(末日の23:59まで)。課金期間の終了時刻を含むUTC-08:00の日の終わりまで特典を続ける。支払いの失敗による終了(FR-PPLAN-006)は日の終わりまで延ばさず、その場で終える                                                                                                                                                                                                              |
| Q5  | 機能フラグオフの範囲       | FR-ADMCF-018(表示の切り替えだけを定める)、ページ配置「機能フラグがオフの場合、このページは404を返す」(`/pricing`には広告の申し込みも同居する)、料金とプラン(オフでも加入済みの特典に影響しない) | 推奨案(Ultras区画を隠し加入停止)。未加入者にはUltrasの区画と各画面の導線を出さず、新規加入の開始もサーバー側で拒否する。`/pricing`は広告のために表示を続け、加入中の人の状態表示・解約・Portalは変えない。ページ配置の404の記述は本specで直す                                                                                                                                     |
| Q6  | 解約と再開の操作口         | FR-PPLAN-008・009、ページ配置の`/settings/plan`、tech-stack.md(Portalは支払い方法の更新用)、paymentsの`StripeGateway`(解約の取り消しの操作が無い)                                               | 推奨案(Portalに一本化)。`/settings/plan`には状態と管理のボタンを置き、解約(期間末)・解約の取り消し・支払い方法の更新はすべてCustomer Portalで行い、結果はWebhookで反映する                                                                                                                                                                                                        |
| Q7  | 退会時の解約の時機         | FR-PPLAN-004(時機を定めない)、FR-PPLAN-010(停止は末日と明記)、返金ポリシー(解約は日割り返金なし)、FR-USER-019(物理削除でStripe Customerを削除)                                                  | 推奨案(即時に解約・返金なし)。退会の波及処理で即時に解約し、返金しない                                                                                                                                                                                                                                                                                                            |
| Q8  | 定期課金の通知メール       | FR-PPLAN-006・009、paymentsのQ3(Stripeの領収書メールを使わず自前で送る)と仮5(購入確認は加入時の1通だけ)、LR-007                                                                                 | 選択肢2(支払い失敗だけ自前)。支払いの失敗(支払い方法の更新を促す)だけをemail-deliveryのトランザクションメールで送り、解約の受付と特典の終了は`/settings/plan`の表示だけで知らせる。Stripeの顧客向けメールは切る。LR-007(解約の受付の確認を求める地域)との関係はresearch.mdで確認し、問題があれば仮として記録する(調査の結果は「Research Log」の「自動更新と解約の各国規制」と仮1) |

### 提示した選択肢(記録)

- Q1: 勝利時点と加入時点(推奨・採用。勝利の確定時点で特典を受けられる状態なら即座に、勝利の後で決済期限までに加入すれば加入時点で参加資格を得る) / 組み合わせ決定時点(23:45の1回だけで判定する。期限後に加入しても免除される10分間が生じ、勝利後に特典が終了した人は資格を失う) / 決済期限時点(23:35の状態で判定する。勝利時点で加入していても期限前に特典が終了すると資格を失う)
- Q2: 返金せず事前に案内(推奨・採用。付与済みの参加資格の対価として返金せず、加入の画面と`/pricing`に表示する) / 組み合わせ前なら全額返金(加入が有効になった時点で組み合わせ決定前の参加費をtournament-weekが自動で全額返金する。要件定義書と返金ポリシーの改訂が要る) / 返金せず案内もしない(苦情につながるおそれ)
- Q3: 期間末に解約・返金なし(推奨・採用。要件定義書(SSoT)どおり。返金ポリシーの行を直す) / 期間末に解約・日割りで自動返金(特典は停止の時点で終え、残りの日数分を一部返金する。日割りの計算と要件の追記が要る) / 即時に解約・日割りで自動返金(FR-PPLAN-010と食い違い、要件定義書の改訂が要る) / 期間末に解約・管理者が手動で返金(返金ポリシーの行を「個別に判断」に直す)
- Q4: 末日の23:59まで(推奨・採用。終了時刻を含むUTC-08:00の日の終わりまで。支払い失敗による終了はその場で) / Stripeの終了時刻まで(`current_period_end`で終える。要件定義書と日次タイムラインの改訂が要る)
- Q5: Ultras区画を隠し加入停止(推奨・採用) / 導線だけ隠し加入は受付(要件の文言どおり表示だけを切り替える) / `/pricing`全体を404(ページ配置どおり。広告の申し込みの画面をsponsorshipが別に設ける必要がある)
- Q6: Portalに一本化(推奨・採用。paymentsへの操作の追加が要らない) / 解約は自前・他はPortal(確認のダイアログ付きの解約ボタンを自前で置く) / 解約・取り消しとも自前(paymentsの`StripeGateway`に取り消しの操作を加える改修が要る)
- Q7: 即時に解約・返金なし(推奨・採用) / 期間末に解約・返金なし(末日が物理削除より後ならCustomerの削除で即時に終わる) / 即時に解約・日割りで返金(返金ポリシーと要件定義書への追記が要る)
- Q8: 自前で3種を送る(推奨。支払いの失敗・解約の受付・特典の終了) / 支払い失敗だけ自前(採用) / Stripeの自動メール(実装は要らないが文面とリンク先を制御できない) / 送らない(画面の表示だけ)

### 確認済みのため質問しない事項

- 状態と特典の対応: active・past_due・canceledは「適用する」、endedは「適用しない」とし、公開プロフィールの加入表示も同じ条件にする(料金とプラン、briefのConstraints)。支払い失敗の再試行の回数と期間はStripeの設定に従い、再試行の後は「サブスクリプションをキャンセルする」(ended)とする。
- 状態の名前: データエクスポートの`plan.status`の4値(`active`・`past_due`・`canceled`・`ended`)と、`plan`の項目(`startedAt`・`currentPeriodEndsAt`・`canceledAt`)に合わせる。
- 特典の判定の口: 消費する側はStripeの状態を見ず、本specの判定サービス(指定時点で特典を受けられるか)だけに依存する(brief、roadmapのShared seams)。再ローンチの間隔はローンチ日を登録・編集する時点の状態で判定し、適用はproduct-launchが行う(再ローンチ規則)。
- 加入が有効になった時点: paymentsで決済セッションの支払いの確定を反映した時点(`PurchaseFulfillment`)を「加入の確定」とする。FR-PPLAN-007の失効と免除の付与はtournament-week・tournament-yearがハンドラとして持ち、`OpenCheckoutExpirer`はeventの非同期の処理から呼ぶ(brief、paymentsのdesign)。
- paymentsとの継ぎ目: `ultras`の購入種別の`PurchaseOfferPolicy`・`PurchaseFulfillment`と`SubscriptionEventSink`を`backend-lib/workers/<ドメイン>`に実装し、apiとeventの両方に束縛する(D1の文だけ)。既に加入中の購入は`prepare`で拒否し、paymentsが定期課金を解約して初回の請求を返金する。古い通知の破棄(DR-011)と冪等性(DR-010)はpaymentsが受け持つ。
- 決済画面・最終確認画面・購入確認メール・決済履歴: paymentsが受け持つ。Ultrasの追加の表示事項(自動更新・毎月の請求額・解約の方法)は`CheckoutSummaryText.additionalNotes`で渡す。購入確認メールは加入時の1通だけ(payments仮5)。
- 決済手段: Customer Portalでもカード・Apple Pay・Google Pay・Linkに揃える(FR-PPLAN-008、payments Q2・仮1)。Portalの設定と制限付きキーの権限(Subscriptions・Customer Portal)は、paymentsの`operations/004`の手順に本specが追記する。
- 価格の表示: Stripeのダッシュボードで設定した税込のUSDを、paymentsの`PriceCatalog`・`MoneyText`で表示する(LR-009・I18N-003)。
- 未確認・停止中の利用者: メールアドレスが未確認の利用者は加入できない(FR-USER-006)。停止中・退会済みの利用者も決済を開始できない(paymentsの要件3.5)。
- チャージバック: 特典を自動では変えない(FR-PYMNT-007)。
- 機能フラグの権限と監査: 切り替えは最上位管理者だけ(admin-foundation Q3)。監査ログは`AuditLogRecorder`で記録し、画面は管理画面のメニュー「設定」(`/settings`、order 130)に置く。フラグをオフにしても加入済みの特典に影響しない(料金とプラン)。
- 画面の置き場所: 料金ページは`/pricing`、プラン管理は`/settings/plan`(ページ配置)。設定ページへの登録はidentity-authの`SETTINGS_NAV_ITEMS`(order 60は予約済み)。Portalから戻った直後の反映待ちの表示と、past_dueの間の支払い方法の更新を促す表示もページ配置で決まっている。
- 停止を解除しても自動で再開しない: FR-PPLAN-010・LR-007で決まっている。
- ジョブ・メッセージの名前: `<spec名>.<名詞句>`・`<ドメイン>.<動詞句>`、時刻は日次タイムラインに従う(backend-platform、roadmap)。
- 新しいパッケージ: 要らない。Stripe関連の3パッケージはtech-stack.mdとpaymentsのQ6で決まっている。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(payments・identity-authと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(paymentsが購入種別とフルフィルメントのポートを所有し、ultras-subscriptionが実装する。プラン判定はultras-subscriptionが所有する)。
- **Sources Consulted**: payments・identity-auth・admin-foundation・email-delivery・backend-platformの`design.md`、paymentsの`research.md`の「上流・後続specへの影響」。
- **Findings**:
  - paymentsの`PurchaseFulfillment.prepare`は副作用を持たずD1の文を返し、反映の一括の書き込みで購入の前進と同時に確定する。`SubscriptionEventSink.statementsFor`も同じで、古い通知はpaymentsが`payment_stripe_objects`の発生時刻で捨てる。どちらにも確定の後に呼ばれる場所が無い。
  - paymentsの`CheckoutSessionReflection`は確定の後(手順5)に購入確認メールと返金の送り出しを行う。同じ位置に口の`afterCommit`を呼ぶ処理を足せば、既存の流れを変えずに後続specの副作用を送り出せる。
  - `OpenCheckoutExpirer.expireOpen`はStripeを呼ぶため、FR-PPLAN-007の失効は後続specがeventの非同期の処理から呼ぶ(payments要件2.10)。
  - 権利を付与できない購入(既に加入中)は、paymentsの返金の処理が定期課金を即時に解約してから全額返金する。
  - identity-authの非同期の波及処理の`order`は0〜9999が各ドメイン(10000以上はidentity-auth自身)。既存の登録は`purge_due`にinquiry-chatの300とpaymentsの400、`withdrawn`・`suspended`にpaymentsの410(spec横断レビューで、各specが4:21のジョブと同じ百の位の帯を使う形に整理した。後述)。4:21のジョブの`order`は100〜120・200・210・300・400・410・810〜830・900・950が使われている。
  - email-deliveryは種別(`EMAIL_KINDS`)とテンプレート(`EMAIL_TEMPLATES`)の1対1を検査するため、種別とテンプレートは同じタスクで足す必要がある(paymentsで問題になった点)。
  - admin-foundationの監査ログの文は操作の文と同じ一括の書き込みに入れる。版の照合で操作が0行でも監査ログの文は挿入されるため、照合の失敗で一括の書き込み全体を取り消す工夫が要る。
  - identity-authの共有の部品`UserContactDirectory.findContact`が`email`・`nickname`を返す(メールの宛先と宛名に使える。spec横断レビューで決定、後述)。
- **Implications**: 口の実装を`backend-lib/workers/ultras`に置き、apiとeventの両方に束縛する。知らせとメールは依頼待ちの行として一括の書き込みに含め、`afterCommit`(仮5)と4:21の日次の確認で送り出す。波及処理の`order`と4:21のジョブの`order`は、どちらも本specの500番台(500)にする。

### Stripeの定期課金と柔軟な請求モード

- **Context**: Customer Portalでの解約(FR-PPLAN-009)と課金期間の末日の判定(Q4)。
- **Sources Consulted**: [Integrate the customer portal](https://docs.stripe.com/customer-management/integrate-customer-portal)、[Cancel subscriptions](https://docs.stripe.com/billing/subscriptions/cancel)、[Billing mode changelog](https://docs.stripe.com/changelog/basil/2025-06-30/billing-mode)、[cancel_at enums](https://docs.stripe.com/changelog/basil/2025-07-30/cancel-at-enums)。
- **Findings**:
  - API版`2025-09-30.clover`以降、新しい定期課金は柔軟な請求モード(`billing_mode: flexible`)が既定になる。paymentsが固定するAPI版`2026-09-30.endive`もこれに当たる。
  - 柔軟な請求モードでは、期間末の解約の予約は`cancel_at`の時刻で表され、`cancel_at_period_end`は偽のままになる(Portalの文書は「柔軟な請求モードでは`cancel_at`がnullでなければ期間末に解約される。従来のモードでは`cancel_at_period_end`を確認する」と書く)。`cancel_at_period_end`は非推奨だが同じ動作をする。
  - 課金期間の終了時刻は`items.data[].current_period_end`にある(paymentsの`SubscriptionChange.currentPeriodEnd`が抽象化する)。
  - 期間末に予約された解約は、期間の終了までPortalまたはAPIで取り消せる(`customer.subscription.updated`が届く)。終了すると`customer.subscription.deleted`が届き、再開はできない(新しい定期課金が要る)。
- **Implications**: paymentsの`SubscriptionChange`に`cancelAt`を足し(仮5)、本specは「`cancelAtPeriodEnd`または`cancelAt`があれば予約あり」、予定時刻は`cancelAt ?? currentPeriodEnd`とする。退会・停止の解約はpaymentsの既存の`cancelSubscription(atPeriodEnd)`のままでよい。

### Customer Portalの機能

- **Context**: Q6(解約・解約の取り消し・支払い方法の更新をPortalに一本化)。
- **Sources Consulted**: [Configure the customer portal](https://docs.stripe.com/customer-management/configure-portal)、[Integrate the customer portal](https://docs.stripe.com/customer-management/integrate-customer-portal)。
- **Findings**:
  - Portalの「サブスクリプションのキャンセル」は既定で有効で、即時または期間末を選べる。期間末に解約した後も、期間の終了までは顧客がPortalで更新(取り消し)できる。
  - 支払い方法の更新・請求書の履歴・プランの変更は個別に有効・無効にできる。設定はsandboxとライブモードで別で、ダッシュボードの既定の設定が`billing_portal.sessions.create`(顧客と`return_url`)で使われる。
  - 特定の操作の画面へ直接移るディープリンク(`flow_data`)もあるが、paymentsの`createPortalSession`は顧客と戻り先だけを受け取る。
- **Implications**: Portalは既定の設定(支払い方法の更新・期間末の解約・取り消しを有効、プランの変更と請求書の履歴を無効)で使い、ディープリンクは使わない。設定と検証の手順を`operations/004`に書く。

### 自動更新と解約の各国規制

- **Context**: Q8の回答(解約の受付と特典の終了は画面の表示だけ)とLR-007(解約の受付の確認を求める地域)の関係の確認。
- **Sources Consulted**: [§ 312k BGB(gesetze-im-internet.de)](https://www.gesetze-im-internet.de/bgb/__312k.html)、[dejure.org](https://dejure.org/gesetze/BGB/312k.html)、[Händlerbund](https://www.haendlerbund.de/de/ratgeber/recht/kuendigungsbutton-nach-312k-bgb)、カリフォルニア州Business and Professions Code 17602条。
- **Findings**:
  - ドイツ民法典312k条(2022年7月施行、既存の契約にも適用)は、ウェブサイトで締結できる継続的な契約について、(1)「Verträge hier kündigen」などの明確な文言の解約ボタン、(2)解約の内容を入力する確認ページと「jetzt kündigen」の確定ボタン、(3)解約の内容・受領の日時・終了の時点をテキスト形式(メールなど)で直ちに(sofort)確認することを求める。満たさない場合、利用者は予告期間なしにいつでも解約できる(同条6項)。
  - 画面の表示は「テキスト形式」(読み返せる形で保存できる表示)に当たらず、(3)を満たさない。Stripeの顧客向けメールはQ8の回答で使わない。
  - カリフォルニア州の自動更新法(17602条(a)(3))は、購入の後に自動更新の条件・解約の方針・解約の方法を、利用者が保存できる形で知らせるよう求める。paymentsの購入確認メールは購入の内容・金額・同意の旨を載せるが、自動更新の条件と解約の方法は載せない。
  - 米国連邦取引委員会のネガティブオプション規則の改正(いわゆるclick-to-cancel)は、2025年7月に第8巡回区控訴裁判所が取り消した。
  - 日本の特定商取引法の最終確認画面(12条の6)はpaymentsの決済画面で満たす。
- **Implications**: 解約の受付の確認メール(受け付けた日時・特典の終了日時・取り消しの方法)を仮1として加え、停止・退会による解約では送らない。購入確認メールに最終確認画面の追加事項を載せる上流の変更を仮3とする。312k条の(1)(2)のボタンの文言と確認ページは、Portalの画面(Stripeの文言)とプラン管理画面のボタン「解約・支払い方法の管理」で満たせるかを開発者と法務の確認事項として残す(「Risks & Mitigations」)。

### Stripeの再試行・顧客向けメール・検証の設定

- **Context**: FR-PPLAN-006(再試行の後の扱い)、Q8(Stripeの顧客向けメールを切る)、要件12.2(検証の手順)。
- **Sources Consulted**: `stripe:stripe-best-practices`スキル(定期課金とCustomer Portal・test clock)、料金とプラン「状態ごとの特典の適用」。
- **Findings**:
  - 支払いの再試行(Smart Retries)の後の扱いは、ダッシュボードの「Manage failed payments」で「サブスクリプションをキャンセル」を選べる。料金とプランはこの設定を前提にする。
  - 支払いの失敗・カードの期限切れなどの顧客向けメールは、ダッシュボードのBillingの設定で個別に送らないようにできる。
  - sandboxのtest clockで時刻を進めると、更新・再試行・期間末の終了をWebhookまで含めて再現できる。支払いの失敗はテストカード`4000 0000 0000 0341`(Customerへの紐付けは成功し、請求で失敗する)で再現できる。
- **Implications**: 設定と検証の手順を`operations/004`の「定期課金とCustomer Portal」の節と`external/008`に書く。`unpaid`・`paused`は設定上起きないため、受け取ったら終了として扱い`captureMessage`で知らせる。

## Architecture Pattern Evaluation

| Option                     | Description                                                                    | Strengths                                                        | Risks / Limitations                                                            | Notes                         |
| -------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| 加入状態を保存             | Stripeの変化ごとに4状態の値を保存し、`canceled`→`ended`は日次のジョブで進める  | 照会が単純                                                       | 末日の終わりに状態を進めるジョブが要り、過去の時点の判定には履歴の表が別に要る | 不採用                        |
| 特典の継続期間を保存(採用) | 加入ごとに`[開始時刻, 特典の終了時刻)`を保存し、状態は問い合わせの時刻から導く | 定期実行が要らない。時点・期間の判定が同じ区間の問い合わせになる | 終了時刻を決める規則を1か所(純粋な関数)に集める必要がある                      | `backend/010`に規約として書く |
| 状態の変化を履歴の表に追記 | 変化ごとに行を足し、判定は履歴を辿る                                           | 監査に強い                                                       | 判定の問い合わせが複雑。到着順の入れ替わりの扱いが難しい                       | 不採用                        |

## Design Decisions

### Decision: 特典の判定を区間の問い合わせにする

- **Context**: brief(「指定時点でUltrasの特典を受けられるか」を返す判定サービス)、Q1(勝利時点と加入時点)、Q4(末日の終わりまで)。
- **Alternatives Considered**:
  1. 現在の状態だけを返す
  2. 指定時点・指定期間の判定を、特典の継続期間に対する問い合わせで返す
- **Selected Approach**: 2。`isEntitledAt`・`wasEntitledDuring`とその一括版、`currentPlan`を提供する。Q1の免除は、勝利の確定時刻から決済期限までの期間に特典の継続期間が重なるかで判定できる(勝利時点で加入中、または期限までに加入)。
- **Rationale**: 組み合わせ決定(23:45)で一括して判定しても、勝利時点の判定と同じ答えになる。tournament-weekが勝利時点と加入時点の2か所に処理を置かずに済む。
- **Trade-offs**: 終了の状態で決めた終了時刻を変えない規則が要る(過去の判定を安定させるため)。`unpaid`・`paused`からの復帰は扱わない(設定上起きない)。

### Decision: 加入が有効になった知らせとメールの送り出し

- **Context**: FR-PPLAN-007、Q8、paymentsの口は副作用を持てない。
- **Alternatives Considered**:
  1. 口の`prepare`の中でメッセージを送る(paymentsの契約に反し、一括の書き込みが取り消されても送られる)
  2. 依頼待ちの行だけを書き、4:21の日次の確認で送る(最大1日遅れる)
  3. 依頼待ちの行を書き、paymentsに足す`afterCommit`で確定の直後に送り、漏れは4:21に拾う
- **Selected Approach**: 3(仮5)。`afterCommit`は確定させた側(Webhookまたは`return_url`)だけが呼び、例外は反映の結果を変えない。
- **Rationale**: 確定と依頼の記録が同時で、送り出しは少なくとも1回になる。paymentsの返金とメールの依頼と同じ形。
- **Trade-offs**: paymentsのコードと設計の更新が要る(上流への申し送り)。

### Decision: 二重の加入の防止

- **Context**: 要件1.8・1.9、paymentsの研究(定期課金は`exclusivityKey`を持たず、加入済みかの判断はultras-subscriptionの`prepare`が行う)。
- **Selected Approach**: `prepare`で支払いの確定の時刻に特典の継続期間が重なる別の加入があれば拒否し、同時の確定は`ultras_subscriptions`の部分一意索引(`user_id`、開始済みかつ終了時刻が空)で1つに限る。違反するとpaymentsが`prepare`を呼び直し、拒否になる。
- **Rationale**: paymentsの`constraint_failed`の扱い(呼び直し)をそのまま使える。

### Decision: 機能フラグの保存と変更

- **Context**: FR-ADMCF-018、仮2、admin-foundationの監査ログの規約。
- **Selected Approach**: `ultras_settings`に鍵ごとの行を持ち、マイグレーションで`ultras_promotion`(オフ)を挿入する。変更は版の照合付きの一括の書き込みで、照合に失敗したら主キーにNULLを挿入する文でNOT NULL制約の違反を起こし、設定と監査ログのどちらも確定させない(`db/005`のNOT NULLによる取り消しの方式)。
- **Rationale**: 照合と監査ログの記録を1回の一括の書き込みにまとめられ、別の表(paymentsの`payment_batch_guards`に当たるもの)を足さずに済む。

### Decision: 料金ページと管理画面の設定ページの枠(仮6)

- **Context**: 料金ページはsponsorshipと、管理画面の設定ページはtournament-year・notificationsと同居する。roadmapの画面シェルの所有者の一覧に両ページは無い。
- **Selected Approach**: roadmapの順で最初に実装される本specが、ページの枠と区画の登録箇所(`PRICING_SECTIONS`・`ADMIN_SETTINGS_SECTIONS`)を作る。後続specは登録箇所に1行足す。
- **Rationale**: `SETTINGS_NAV_ITEMS`・`ADMIN_NAV_ITEMS`・`DASHBOARD_CARDS`と同じ形で、後続specが本specのファイルを書き換えずに済む。

### Decision: 採らなかった案

- 特典の終了を日次のジョブで進める: 区間から導けるため不要。
- 解約の取り消しの自前のボタン: Q6によりPortalに一本化。paymentsの`StripeGateway`に操作を足さない。
- Portalのディープリンク(`flow_data`): paymentsの`createPortalSession`の形を変える必要があり、Q6の範囲では不要。
- 特典の終了のメール・更新の予告のメール: Q8により送らない(月額の更新の予告は主要な規制の対象外)。

## Synthesis

- **Generalization**: 特典を消費する3つの機能(加入表示・再ローンチの間隔・参加費の免除)の問いを、「特典の継続期間に時点または期間が含まれるか」の1つにまとめた。料金ページと管理画面の設定ページは、登録箇所への追記で区画を足す既存の形に一般化した。
- **Build vs Adopt**: Stripeの解約・取り消し・支払い方法の更新はCustomer Portalを使い、画面を作らない。Stripeとの通信・冪等性・古い通知の破棄はpaymentsを使う。メール・回数制限・定期実行・非同期処理・監査ログは上流の部品を使う。新しいパッケージは無い。
- **Simplification**: 加入状態の列と終了のジョブ、状態の履歴の表、解約の自前の画面を持たない。送り出しの漏れは新しい仕組みを足さず4:21の日次の確認1つで拾う。

## Risks & Mitigations

- ドイツ民法典312k条の解約ボタンの文言と確認ページの要件を、プラン管理画面のボタン「解約・支払い方法の管理」とStripeのPortalの画面で満たせるか不確か — 解約の受付の確認メール(仮1)でテキスト形式の確認は満たす。ボタンの文言と確認ページは、開発者が法務の確認を経て判断する事項として報告する。
- paymentsへの`afterCommit`・`cancelAt`の追加(仮5)は承認され、paymentsのタスクが実装する。`afterCommit`の呼び出しが失敗しても、4:21の日次の確認で送り出せる(最大1日遅れる)。
- Webhookが長く届かず、加入の行が古いまま残る(例: 再試行の後の終了を受け取れない) — Stripeの再送(最大3日)とpaymentsの冪等な反映に頼る。運用手順書に、Stripeのダッシュボードの定期課金と本サービスのプラン管理画面の状態を突き合わせる手順を書く。
- `unpaid`・`paused`の受信(設定の誤り) — 終了として扱い、`captureMessage`で運営者に知らせる。
- 機能フラグの初期値がオフのため、prodでフラグをオンにし忘れる — launch-readinessへの申し送りとして報告する。

## References

- [Integrate the customer portal](https://docs.stripe.com/customer-management/integrate-customer-portal) — Webhookでの解約の検知(柔軟な請求モードの`cancel_at`)と取り消し
- [Configure the customer portal](https://docs.stripe.com/customer-management/configure-portal) — Portalの機能の設定
- [Cancel subscriptions](https://docs.stripe.com/billing/subscriptions/cancel) — 期間末の解約と取り消し、終了後の再開不可
- [Billing mode](https://docs.stripe.com/changelog/basil/2025-06-30/billing-mode)・[cancel_at enums](https://docs.stripe.com/changelog/basil/2025-07-30/cancel-at-enums) — 柔軟な請求モードと`cancel_at`
- [§ 312k BGB](https://www.gesetze-im-internet.de/bgb/__312k.html) — 解約ボタンとテキスト形式の確認
- `stripe:stripe-best-practices`スキル — 定期課金・Customer Portal・test clock・制限付きキー

## 仮決定(2026-10-23に開発者が承認)

要件と設計の作成中に生じた、開発者の判断を要する論点である。回答と上流specに最も整合する案を仮に採用して要件・設計・タスクを作り、2026-10-23に開発者が仮1〜仮6をすべて採用した案のまま承認した。仮1はQ8の回答を一部変える(解約の予約を受け付けたときに確認メールを送る)。仮3・仮5はpaymentsの要件・設計・タスクに反映した(paymentsのU1・U2)。`requirements.md`の「要件フェーズでの決定事項」にも同じ行がある。

| #   | 論点                       | 採用した案                                                                                                                                                                                            | 他の選択肢                                                   | 影響する箇所                                                                         |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 仮1 | 解約の受付の確認           | Portalで解約を予約したときに、受け付けた日時と特典の終了日時を載せた確認メールを1通送る(ドイツ民法典312k条4項)。停止・退会による解約では送らない(2026-10-23に承認)                                    | Q8のとおり画面の表示だけ                                     | 要件8.3・8.4、`SubscriptionTransition`・`UltrasNotifier`・メールの種別とテンプレート |
| 仮2 | 機能フラグの初期値         | オフ。マイグレーションで初期行を挿入し、各環境で最上位管理者がオンにする(2026-10-23に承認)                                                                                                            | 初期値をオン                                                 | 要件10.5、`ultras_settings`のマイグレーション、launch-readiness                      |
| 仮3 | 加入時の確認メールの記載   | paymentsの購入確認メールに、最終確認画面の追加事項(自動更新・毎月の請求額・解約の方法など)を載せる(カリフォルニア州の自動更新法)(2026-10-23に承認)                                                    | 載せない                                                     | 要件1.3、paymentsの`PurchaseNotifier`と購入確認のテンプレート                        |
| 仮4 | Portalを開く回数の上限     | 利用者ごとに1時間あたり20回(2026-10-23に承認)                                                                                                                                                         | 上限なし / 1時間あたり10回                                   | 要件6.6、`PortalSessionLimits`                                                       |
| 仮5 | paymentsの口への追加       | `PurchaseFulfillment`・`SubscriptionEventSink`に省略可能な`afterCommit`、`SubscriptionChange`に`cancelAt`を加える(paymentsの要件・設計・タスクに反映し、paymentsのタスクが実装する)(2026-10-23に承認) | `afterCommit`を加えず日次の確認だけで送る(`cancelAt`は必須)  | 要件2.4・4.1・8.1・8.3、paymentsのU1(要件2.11・7.8・7.9、タスク2.1・3.2・5.3・5.4)   |
| 仮6 | 管理画面の設定ページの所有 | 本specが`/settings`(管理画面)と`/pricing`のページの枠と区画の登録箇所を作り、後続specが区画を加える(2026-10-23に承認)                                                                                 | 設定ページの枠をadmin-foundationへの追加の変更として依頼する | 要件9.1・10.9、`ADMIN_SETTINGS_SECTIONS`・`PRICING_SECTIONS`                         |

## 要件定義書の改訂が必要な箇所

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂が必要である。

| 要件ID                     | 内容                                                                                                                                                          | 根拠     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-TOURW-003・FR-TOURY-003 | 有料プランによる免除の判定時点を「予選勝利(Week優勝)の確定時点で特典を受けられる状態、または勝利の後で決済期限までに加入した時点」と明記する                  | Q1       |
| FR-PPLAN-007               | 加入の前に決済が完了した参加費は返金しない旨を注記する                                                                                                        | Q2       |
| FR-PPLAN-010               | 停止に伴う解約で返金しない旨を明記する(返金ポリシーの大枠は本specで修正する)                                                                                  | Q3       |
| FR-PPLAN-003               | 「当該課金期間の末日」を「課金期間の最後の瞬間を含むUTC-08:00の日付」と定義し、支払いの失敗(FR-PPLAN-006)と退会による終了は日の終わりまで延ばさない旨を加える | Q4       |
| FR-ADMCF-018               | 機能フラグがオフの間は新規加入の受付も停止し、加入済みの利用者の特典・状態表示・Customer Portalには影響しない旨を加える                                       | Q5       |
| FR-PPLAN-008               | Customer Portalで支払い方法の更新に加え、課金期間の末日に終わる解約と解約の取り消しを行えるようにする旨に改める                                               | Q6       |
| FR-PPLAN-004               | 退会時は即時に解約し、返金しない旨を加える                                                                                                                    | Q7       |
| FR-PPLAN-006の下に新設     | 支払いの失敗(再試行中への移行)を利用者にトランザクションメールで通知する旨を加える                                                                            | Q8       |
| LR-007の下に新設           | 解約の受付の確認メール(受付の日時・終了の時点)を送る旨と、購入確認に自動更新の条件・解約の方法を載せる旨を加える                                              | 仮1・仮3 |
| FR-RLMIT節に新設           | Customer Portalのセッションの作成に、利用者単位で1時間に20回の上限を設ける旨を加える                                                                          | 仮4      |

## 上流・後続specへの影響

- payments(上流): `PurchaseFulfillment.afterCommit?`・`SubscriptionEventSink.afterCommit?`・`SubscriptionChange.cancelAt`・`StripeSubscriptionSnapshot.cancelAt`の追加と呼び出し(仮5)、購入確認メールへの追加事項の掲載(仮3)を、2026-10-23の開発者の承認と許可を受けてpaymentsの要件(2.11・7.8・7.9・11.6)・設計・タスク(2.1・2.4・3.2・5.2〜5.4)・research.md(決定事項のU1・U2)に直接反映した。本specのタスクはpaymentsのコードを変更せず、1.1の前提でpaymentsの実装の完了を確かめる。`operations/004`の権限の表の更新は本specのタスク1.4で行う。`operations/004`には本specが「定期課金とCustomer Portal」の節を足す。
- payments・inquiry-chat: 両specが`purge_due`の非同期の波及処理に`order` 300を登録していた重複は、spec横断レビュー(2026-10-23)で各specが4:21のジョブと同じ百の位の帯を使う形に解消した(inquiry-chatは300、paymentsは400・410、本specは500)。
- identity-auth(上流): ファイルの変更は無い。メールの宛先と宛名は共有の部品`UserContactDirectory.findContact`(`apps/backend-lib/workers/identity`)で引き、`users`の列を直接読まない。`SETTINGS_NAV_ITEMS`の`order` 60、非同期の波及処理の`order` 500を使う。
- admin-foundation(上流): ファイルの変更は無い。`ADMIN_NAV_ITEMS`に「設定」(130)を本specが足し、`/settings`のページの枠を本specが作る(仮6)。
- tournament-week・tournament-year(後続): `ULTRAS_ACTIVATION_HANDLERS`にハンドラ(`order` 100以上)を登録し、`OpenCheckoutExpirer.expireOpen`で未完了の参加費の決済セッションを失効させる(FR-PPLAN-007)。免除は`UltrasEntitlements.wasEntitledDuring(投稿者, 勝利の確定時刻, 決済期限)`で判定する(Q1)。決済済みの参加費は返金しない(Q2)。参加費の画面のUltrasの案内は`UltrasPromotionGate`で包む(Q5)。返金ポリシーの「停止・非公開化に伴うトーナメント参加資格の停止: 返金する」の行の扱い(自動か手動か)を判断する。tournament-yearは管理画面の設定ページに決勝日の区画(`order` 10)を登録する。
- product-launch(後続): 再ローンチの間隔は、ローンチ日の登録・編集の時点で`UltrasEntitlements.isEntitledAt`を使う。
- user-profile-social(後続): 公開プロフィールの加入表示は`UltrasEntitlements.isEntitledAt(利用者, 現在)`で決める。
- sponsorship(後続): 料金ページの区画を`PRICING_SECTIONS`に登録する(`order` 20)。返金ポリシーの「管理者によるスポンサー広告の強制終了」「停止・非公開化に伴う広告の表示停止」の行の扱いを判断する。
- ugc-moderation(後続): 停止の操作で本specの解約(期間末・返金なし)が動く。停止の通知の文面で、Ultrasは課金期間の末日に解約され返金しない旨を伝える。返金ポリシーの停止・非公開化の他の行の扱いを判断する。
- notifications(後続): 管理画面の設定ページに送信者情報の区画(`order` 30)を登録する。
- data-export(後続): 本specが所有するエクスポート部品`UltrasPlanExport.find`を呼んで`plan`を作り、本specのテーブルを直接読まない。
- launch-readiness(後続): prodのStripeの価格・Portal・再試行・顧客向けメールの設定を確かめてから、機能フラグをオンにする(仮2)。

## 設計のレビュー(2026-10-23)

- 機械的な確認: 要件の97件の受け入れ基準がすべて追跡表にあることをスクリプトで確かめた。境界の4節は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、`users`の読み取り列(`nickname`の追加)と、課金期間の終了がちょうど業務日付の0:00のときの末日(課金期間は終了時刻を含まないため前日)を直した(`benefitEndForScheduledEnd`)。2回目で問題は無かった。

## タスクの計画の検証(2026-10-23)

- タスクのグラフのサニティレビューを2回行った。1回目は新しいサブエージェントによる独立した確認(independent)で、NEEDS_FIXES(10件)だった。指摘は、clientとadminの操作の追加がapiの許可リスト(`graphql:allowlist`)を同時に再生成する競合、料金ページの完了状態がフラグの初期値(オフ)と開発者の準備(価格)の前では満たせないこと、E2Eの価格の前提と2つのファイルが同じフラグの行を書き換える競合、paymentsへの追加(仮5と仮3)が1つのタスクにまとまっていること、機能フラグの初期行にNOT NULLの`state_token`・日時の値が無いこと、test clockはtest clock付きのCustomerにしか使えないこと、知らせのメッセージの受け取りが登録される前に送り出しが始まること、画面のタスクが大きすぎること、`_Boundary_`の名前の重なり、文言の前倒しの参照先の不足である。すべて直した(1.3・1.4の分割、運用手順書と開発者の準備を1.6へ前倒し、7.2〜7.4・8.1〜8.2の分割と許可リストの再生成の明記、初期行の固定値、test clockのCustomerの結び付けの手順、4.5の確認を模擬の送信に限る、E2Eの直列実行と値の復元、`_Boundary_`をファイル単位に記載)。設計の初期行とtest clockの記述も同時に直した。
- 2回目の確認は、コーディネーターの指示により本エージェントがinlineで行い、PASSと判断した。ただし、その前に依頼していた独立したサブエージェントによる2回目の確認(independent)の結果が後から届き、判定はNEEDS_FIXES(3件)だった。指摘は次の3件である。(1)test clockで進めた時刻とアプリの実時刻が異なるため、末日を過ぎてもプラン管理画面が`ended`にならず、正しい動作を不具合として報告するおそれがある。(2)1.4(購入確認メールの追加事項)が1.3と同じ反映のファイルの呼び出し箇所を変える可能性があり、`(P)`と矛盾する。(3)E2Eの直列化の方法(プロジェクトの依存かワーカー1か)と、共有の設定の変更の範囲が決まっていない。kiro-spec-tasksの規則(2回目の判定がPASSでなければ承認しない、3回目の確認はしない)に従い、より厳しい独立した判定を採った。
- 3件は`tasks.md`と`design.md`に反映した。1.6・10.2では、末日を過ぎた後の終了をD1の`benefit_ends_at`・`stripe_status`・`benefit_end_fixed`で確かめるよう明記した。1.4では、保存済みの`summary_json`から追加事項を読み、反映の側の呼び出し箇所を変えないことを明記した。10.1では、Ultrasの2ファイルをPlaywrightのプロジェクトの依存で直列にし、共有の設定の変更と`testing/001`への追記をタスクの範囲に含めた。3回目の確認は行っていないため、タスクは承認していない。`tasks.md`は未承認の草案である(paymentsと同じ扱い)。

- 2026-10-23の開発者の承認(仮1〜仮6)とpaymentsへの反映の許可を受け、paymentsのコードを変更していた旧タスク1.3(確定後の呼び出しと解約の予定時刻)・1.4(購入確認メールの追加事項)を削除し、paymentsのタスク(2.1・2.4・3.2・5.2〜5.4)へ移した。旧1.5・1.6は1.3・1.4に番号を改め、参照(2.4・7.3・10.1・10.2の依存と本文)を直した。上の記録の1.3〜1.6の番号は、この変更の前の番号である。タスクの承認はこの後の独立したレビューの後に行う。
- 3回目の独立したサニティレビュー(開発者の指示、2026-10-23)の判定はNEEDS_FIXESだった。paymentsとの契約・番号の付け直し・要件の割り当て・`(P)`・集約点には問題が無かった。指摘と対応は次のとおりである。
  - (必須)test clockでは`ended_at`も実時刻より未来で届くため、支払いの再試行が尽きた後の終了も画面では`canceled`に見えるのが正しい: 1.4の手順書の記述・10.2・設計のTesting Strategyに明記し、D1の値(`benefit_ends_at`が`ended_at`の値・`stripe_status`が`canceled`・`benefit_end_fixed`が1)で確かめるようにした。
  - (必須)同じ検証用の利用者で2つ目の加入を始めると`ultras_resume_in_portal`や`prepare`の重なりの検査で拒否される: 1.4・10.2・設計で、2つ目のシナリオを別の検証用の利用者で行い、その利用者用にtest clock付きのCustomerを作って`payment_customers`で結び付けるようにした。
  - (必須)10.1のsandboxでの加入の経路はローカルD1に`active`な加入を残す: 実行ごとにidentity-authのE2EのMailpitの補助で新しい確認済みの利用者を登録して使うこと、sandbox上に定期課金が残ることを明記した。
  - (軽微)`UltrasNoticeKind`の定義場所: 設計で`ports.ts`(2.1)に置き、2.1のタスクに型を加えた。
  - (軽微)`PromotionSettingService.update`の`AuditLogRecorder.prepare`の入力: admin-foundationの`AuditEntryInput`(`operatorAdminId`・`action`・`targetIds`・`reason?`・`detail?`・`occurredAt`、対象の種類は操作種別の定義で決まる)に合わせた。
  - (軽微)3.2のテストに、定期課金ごとの依頼待ちの検索と10分以上の依頼待ちの検索を加えた。
  - 上流の`purge_due`の波及処理の`order`の重複と、サービス仕様の文書番号の重複は、spec横断レビューで扱うため本specでは触らなかった(後述の「spec横断レビューの指摘の反映」で解消した)。タスクの承認は行っていない。
- 4回目の独立したサニティレビュー(開発者の指示、2026-10-23)の指摘は1件で、3回目の対応はすべて正しく反映されていた。指摘と対応は次のとおりである。
  - (必須)1.4が`operations/004`を「本プロジェクト固有の値を含めずに」書くと指示しながら、同じタスクのtest clockの手順にテーブル名・列名・画面の名前・期待値を含めていた(`docs/GUIDES/tech`ではサービス固有の仕様に触れない)。1.4の手順を一般的な形(test clock付きのCustomerをローカルDBの利用者とCustomerの対応表に結び付けてから決済する、シナリオごとに利用者を分ける、終了は画面ではなくDBの特典の終了時刻・外部の状態・確定済みの印で確かめる)に直し、具体的なテーブル名・列名・期待値は10.2と`features/005`(9.2)に置いた。プレースホルダーは使わないため、`project-values.md`は変えない。設計のTesting Strategyの手動検証も、具体値は10.2と`features/005`が持つ書き方に直した。
  - (参考・反映)`4000 0000 0000 0341`は請求に失敗するカードのため、成功するカードで加入し、Portalで支払い方法をこのカードに差し替えてからtest clockを次の更新日の後へ進める手順を1.4・10.2・設計に明記した。
  - (参考・反映)10.1のadminのE2Eで、最上位管理者をadmin-foundationの`e2e/support/admin-bootstrap.ts`で用意すること、利用者のメールアドレスのドメインを`.example`にすることを明記した。
  - (参考・反映)1.1と設計に、監査ログの操作種別の表示名(`label`)「Ultras導線の機能フラグの変更」を指定した。
  - タスクの承認は行っていない。
- 4回目の指摘の反映後、修正箇所の確認を経て、2026-10-23に開発者がtasksを承認した(`spec.json`の`approvals.tasks.approved`を`true`にした。`ready_for_implementation`は`false`のまま)。

## spec横断レビューの指摘の反映(2026-10-23に開発者が決定)

全specを横断したレビューの指摘に対する開発者の決定(2026-10-23)を、本specの要件の決定事項の表(C1〜C3)・設計・タスクに反映した。

| #   | 指摘                                                                                                                                                                                         | 決定と反映                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | (重大)paymentsの`payments.customer-erasure`(`purge_due`、300)とinquiry-chatの`inquiry-chat.member-inquiry-purge`(`purge_due`、300)が重なっていた。本specの320はpaymentsの310を前提にしていた | 波及処理の`order`は、各specが4:21のジョブの`order`と同じ百の位の帯を使う。inquiry-chatは300、paymentsは400・410、本specは`ultras-subscription.subscription-cancellation`と`ultras-subscription.subscription-erasure`を500にした。`withdrawn`・`suspended`ではpaymentsの`payments.open-checkout-expiry`(410)の後に動き、未完了のUltrasの決済セッションの失効を先に済ませる関係を保つ。identity-auth(100番台と10000以上)・admin-foundation(200番台)・media-pipeline(800番台)・email-delivery(900)・content-processing(950)とも重ならないことを確かめた。設計の「This Spec Owns」・Revalidation Triggers・波及処理の表と順序の説明、タスク6.2を直した                                                                                                                                                                                                                                    |
| C2  | (重要)サービス仕様の`features/003`はfrontend-platform(国際化方針)が使う番号で、paymentsが`features/004`へ移る                                                                                | 本specのUltrasの実装方針を`features/005-ultras-subscription.md`に改めた。設計のModified Files・`UltrasEntitlements`の後続specの使い方・Testing Strategy、タスク1.4・9.2・10.2を直した                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| C3  | (判断)メールの宛先の読み取りが、本specの`UltrasContactReader`とpaymentsの`UserContactReader`に重複している                                                                                   | identity-authが`apps/backend-lib/workers/identity`に共有の部品`UserContactDirectory`(`findContact(userId)`が`userId`・`email`・`nickname`・`emailVerified`を返し、退会済み・物理削除済みは`undefined`、停止中は返す。DIの識別子`IDENTITY_PLATFORM_TYPES.UserContactDirectory`、api・eventの両方にidentity-authが束縛する)を用意する。本specの`UltrasContactReader`のポート・`D1UltrasContactReader`・そのテストを削除し、`UltrasNotifier`が`findContact`の`email`・`nickname`を使う形にした。従来の`UltrasContactReader`も退会済み・存在しない利用者だけを除き、停止中の利用者を除いていなかったため、呼び出し側の判定は変わらない(`undefined`なら対象外、8.8)。停止・退会による解約は解約の受付の確認メールの依頼を作らない(8.4)ため、宛先の側で停止中を除く判定は要らない。設計の依存先・ファイル構成・追跡表・コンポーネント表・`UltrasNotifier`、タスク1.1・2.1・3.2・4.1を直した |

- (判断)データエクスポートは各ドメインが自分のエクスポート部品を所有する。本specの`UltrasPlanExport`はその部品で、data-exportはこれを呼び、本specのテーブルを直接読まない旨を設計と上流・後続specへの影響に明記した。
- (判断)E2Eの管理者のログイン: admin-foundationが`e2e/support/admin-bootstrap.ts`に、招待の発行・招待の完了・指定したロールの管理者としてのログインをまとめた補助を加える。タスク10.1の管理画面のE2Eは、この補助で最上位管理者としてログインし、独自のログインの手順を作らない旨を明記した(設計のAllowed Dependencies・Testing Strategy、タスク1.1の前提にも加えた)。
- 設計のAllowed Dependenciesで、paymentsの`CheckoutStarter`をapiのアプリケーション層の部品として書き分けた(paymentsの設計の同じ指摘の水平展開)。
- `spec.json`の承認の状態は変えていない。

## spec横断レビュー(2回目)の指摘の反映(2026-10-23)

2回目のspec横断レビューの指摘を、設計・タスクに反映した。`spec.json`の承認の状態は変えていない。

| #   | 指摘                                                                                                                                                                                                                                               | 反映                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | (軽微)タスク10.1と設計のTesting StrategyのE2Eが、機能フラグをローカルD1へ独自に書き込んで(絶対パスの`--persist-to`)設定していた                                                                                                                    | admin-foundationが所有する`e2e/support/local-d1.ts`の`executeLocalD1`(文字列の値は`sqlStringLiteral`でリテラルにする)で`ultras_settings`の行を更新する形に改めた。設計のAllowed Dependencies・Revalidation Triggers・Testing Strategyとタスク10.1を直した。タスク7.3の完了状態の確かめ方は、実装者がローカルで手作業で行う確認でE2Eではないため変えていない                            |
| D2  | (重要)タスク10.1がdev-toolingの所有するファイル(ルートの`playwright.config.ts`・`e2e/support/playwright-config.ts`と単体テスト、`docs/GUIDES/tech/testing/001-test-strategy.md`)を変えるのに、設計のModified Filesと上流への影響に載っていなかった | dev-toolingの設計で名前を確かめ、Modified Filesに2行、Allowed Dependenciesにdev-tooling、Revalidation Triggersに`createPlaywrightConfig`と`executeLocalD1`の形、Boundary Commitmentsに「上流への影響」の節とdev-toolingの行を加えた。組み立ての変更は先に`playwright-config.unit.test.ts`へテストを足す。タスク10.1に`_Boundary:_`(2つのE2Eのファイルとdev-toolingの4ファイル)を加えた |

- identity-authのユーザーライフサイクルの波及処理の`order`の契約が、各ドメインは0〜9999、identity-auth自身は10000以上に広がった(identity-authの改訂)。設計のRevalidation Triggersと本文書の上流specの契約・spec横断レビュー(1回目)のC1の行にあったidentity-authの帯(1000以上、0〜999)を新しい値に改めた。本specの`order`(4:21のジョブと波及処理の500)は変えない。

## spec横断レビュー(3回目)の指摘の反映(2026-10-23)

3回目のspec横断レビューの指摘を、設計・タスクに反映した。`spec.json`の承認の状態は変えていない。

- (軽微)dev-toolingは実装済みで、タスク10.1が`createPlaywrightConfig`(プロジェクトの分割と`dependencies`)を変えるのに、dev-toolingの設計のE2EConfigの契約を直す担当が決まっていなかった。タスク10.1に、引数の形を変えたらdev-toolingの`design.md`のE2EConfigの契約(`createPlaywrightConfig`の宣言と組み立ての説明)を新しい形に合わせて直す旨と、その一致を完了状態に加え、`_Boundary:_`に`.kiro/specs/dev-tooling/design.md`を加えた。dev-toolingの設計のRevalidation Triggersにも、本specのタスク10.1が組み立てを拡張する旨が加わった。
- (軽微)UltrasのE2Eが機能フラグの行を書き換えるため、フラグの値で表示が変わる画面を確かめる後続specのE2Eと並行に動くと結果が揺れる。設計の「上流への影響」の表の後に、後続specへの申し送り(フラグの値で表示が変わる画面を確かめる後続specのE2Eは、Ultrasのプロジェクトの依存に加えるか、フラグの値で結果が変わる部分を確かめない)を加えた。roadmapのShared seams「プラン判定」とproduct-launch・tournament-week・tournament-yearのbriefのConstraintsにも同じ規則が加わった。
