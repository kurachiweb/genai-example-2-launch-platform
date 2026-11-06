# Research & Design Decisions

## Summary

- **Feature**: `ultras-subscription`
- **Discovery Scope**: Complex Integration(有料プランの実装は無い。上流の13spec(dev-tooling〜payments)の設計・タスクは承認済みで実装は未着手であり、本specはpaymentsの購入種別・定期課金の受け取り口・Stripeの定期課金の操作の上に、加入状態・特典の判定・加入のイベント・機能フラグ・料金ページとプラン管理画面を足す。外部サービス(Stripe Billing・Customer Portal)の仕様と、各国の自動更新の規制を調べた)
- **Key Findings**:
  - paymentsの購入種別の口(`PurchaseFulfillment.prepare`)と定期課金の受け取り口(`SubscriptionEventSink.statementsFor`)はD1の文だけを返し、確定の後に呼ばれる場所が無い。加入が有効になった知らせ(FR-PPLAN-008)と支払いの失敗のメールを確定の直後に送り出すには、口に省略可能な`afterCommit`を足す必要がある。依頼待ちの行を一括の書き込みに含め、`afterCommit`と4:21の日次の確認で送り出す(仮5)。
  - API版`2025-09-30.clover`以降、新しい定期課金は柔軟な請求モードで作られ、Customer Portalでの期間末の解約は`cancel_at`の時刻で表され`cancel_at_period_end`は偽のままになる。paymentsの`SubscriptionChange`は`cancelAtPeriodEnd`しか持たないため、`cancelAt`を足さないとPortalでの解約を見落とす(仮5)。
  - 加入状態を保存せず、加入ごとの「特典の継続期間」`[開始時刻, 特典の終了時刻)`を保存して問い合わせの時刻から導くと、終了のための定期実行が要らず、過去の時点の判定(勝利時点の免除、Q1)も同じ区間で答えられる。終了の状態で決めた終了時刻を変えないことで、過去の判定が後から変わらない。
  - ドイツ民法典312k条4項は、オンラインで受け付けた解約の内容・受領の日時・終了の時点をテキスト形式(メールなど)で直ちに確認するよう求める。Q8の「解約の受付は画面の表示だけ」ではこれを満たせないため、解約の受付の確認メールを仮1として加えた。カリフォルニア州の自動更新法(Bus. & Prof. Code 17602条(a)(3))は購入後に自動更新の条件・解約の方針・解約の方法を保存できる形で知らせるよう求めるため、paymentsの購入確認メールに最終確認画面の追加事項を載せる(仮3)。

## 要件フェーズ前の確認事項(2026-10-23)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                       | 根拠                                                                                                                                                                                            | 回答(2026-10-23)                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 参加費免除の判定時点       | FR-TOURW-003・FR-TOURY-005・FR-PPLAN-006・008、roadmapのRequirement Ambiguities(ultras-subscription・tournament-week)、料金とプラン「トーナメント参加費の免除条件」                             | 推奨案(勝利時点と加入時点)。予選勝利またはWeek優勝の確定時点で特典を受けられる状態(active・past_due・canceled)なら即座に参加資格を得る。勝利の後、決済期限(23:35)までに加入すれば加入した時点で得る。本specは指定時点の判定と加入のイベントを提供し、資格の付与はtournament-week・tournament-yearが受け持つ                                                                       |
| Q2  | 決済後に加入した場合の返金 | FR-PPLAN-008(未完了の決済セッションの失効だけを定める)、roadmapのRequirement Ambiguities、法的通知の大枠の返金ポリシー(原則として決済完了後は返金しない)                                        | 推奨案(返金せず事前に案内)。決済済みの参加費は付与済みの参加資格の対価として返金しない。加入の画面(最終確認画面の追加事項)と`/pricing`に「支払い済みの参加費は返金されません」と表示する                                                                                                                                                                                          |
| Q3  | 停止時の返金               | FR-PPLAN-012、法的通知の大枠の返金ポリシー(「特典提供停止」「当該課金期間末までの日数分を自動で返金する」)、同じ表の「定期課金の解約: 日割り返金しない」、paymentsのQ1(後続specへの申し送り)    | 推奨案(期間末に解約・返金なし)。要件定義書のとおり課金期間の末日に終わるよう解約し、返金しない。返金ポリシーの該当行を「返金しない」に直す作業を本specに含める。返金ポリシーの他の行(停止・非公開化に伴うトーナメント参加資格の停止、広告の強制終了・表示停止)は書き換えず、後続specの担当として報告する                                                                          |
| Q4  | 解約後の特典の終了時刻     | FR-PPLAN-003(「UTC-08:00時間で当該課金期間の末日まで」)、日次タイムライン「Ultras解約後の特典継続」、Stripeの課金期間の終了時刻は日の区切りに合わない                                           | 推奨案(末日の23:59まで)。課金期間の終了時刻を含むUTC-08:00の日の終わりまで特典を続ける。支払いの失敗による終了(FR-PPLAN-007)は日の終わりまで延ばさず、その場で終える                                                                                                                                                                                                              |
| Q5  | 機能フラグオフの範囲       | FR-ADMCF-022(表示の切り替えだけを定める)、ページ配置「機能フラグがオフの場合、このページは404を返す」(`/pricing`には広告の申し込みも同居する)、料金とプラン(オフでも加入済みの特典に影響しない) | 推奨案(Ultras区画を隠し加入停止)。未加入者にはUltrasの区画と各画面の導線を出さず、新規加入の開始もサーバー側で拒否する。`/pricing`は広告のために表示を続け、加入中の人の状態表示・解約・Portalは変えない。ページ配置の404の記述は本specで直す                                                                                                                                     |
| Q6  | 解約と再開の操作口         | FR-PPLAN-010・011、ページ配置の`/settings/plan`、tech-stack.md(Portalは支払い方法の更新用)、paymentsの`StripeGateway`(解約の取り消しの操作が無い)                                               | 推奨案(Portalに一本化)。`/settings/plan`には状態と管理のボタンを置き、解約(期間末)・解約の取り消し・支払い方法の更新はすべてCustomer Portalで行い、結果はWebhookで反映する                                                                                                                                                                                                        |
| Q7  | 退会時の解約の時機         | FR-PPLAN-005(時機を定めない)、FR-PPLAN-012(停止は末日と明記)、返金ポリシー(解約は日割り返金なし)、FR-USER-022(物理削除でStripe Customerを削除)                                                  | 推奨案(即時に解約・返金なし)。退会の波及処理で即時に解約し、返金しない                                                                                                                                                                                                                                                                                                            |
| Q8  | 定期課金の通知メール       | FR-PPLAN-007・011、paymentsのQ3(Stripeの領収書メールを使わず自前で送る)と仮5(購入確認は加入時の1通だけ)、LR-007                                                                                 | 選択肢2(支払い失敗だけ自前)。支払いの失敗(支払い方法の更新を促す)だけをemail-deliveryのトランザクションメールで送り、解約の受付と特典の終了は`/settings/plan`の表示だけで知らせる。Stripeの顧客向けメールは切る。LR-007(解約の受付の確認を求める地域)との関係はresearch.mdで確認し、問題があれば仮として記録する(調査の結果は「Research Log」の「自動更新と解約の各国規制」と仮1) |

### 提示した選択肢(記録)

- Q1: 勝利時点と加入時点(推奨・採用。勝利の確定時点で特典を受けられる状態なら即座に、勝利の後で決済期限までに加入すれば加入時点で参加資格を得る) / 組み合わせ決定時点(23:45の1回だけで判定する。期限後に加入しても免除される10分間が生じ、勝利後に特典が終了した人は資格を失う) / 決済期限時点(23:35の状態で判定する。勝利時点で加入していても期限前に特典が終了すると資格を失う)
- Q2: 返金せず事前に案内(推奨・採用。付与済みの参加資格の対価として返金せず、加入の画面と`/pricing`に表示する) / 組み合わせ前なら全額返金(加入が有効になった時点で組み合わせ決定前の参加費をtournament-weekが自動で全額返金する。要件定義書と返金ポリシーの改訂が要る) / 返金せず案内もしない(苦情につながるおそれ)
- Q3: 期間末に解約・返金なし(推奨・採用。要件定義書(SSoT)どおり。返金ポリシーの行を直す) / 期間末に解約・日割りで自動返金(特典は停止の時点で終え、残りの日数分を一部返金する。日割りの計算と要件の追記が要る) / 即時に解約・日割りで自動返金(FR-PPLAN-012と食い違い、要件定義書の改訂が要る) / 期間末に解約・管理者が手動で返金(返金ポリシーの行を「個別に判断」に直す)
- Q4: 末日の23:59まで(推奨・採用。終了時刻を含むUTC-08:00の日の終わりまで。支払い失敗による終了はその場で) / Stripeの終了時刻まで(`current_period_end`で終える。要件定義書と日次タイムラインの改訂が要る)
- Q5: Ultras区画を隠し加入停止(推奨・採用) / 導線だけ隠し加入は受付(要件の文言どおり表示だけを切り替える) / `/pricing`全体を404(ページ配置どおり。広告の申し込みの画面をsponsorshipが別に設ける必要がある)
- Q6: Portalに一本化(推奨・採用。paymentsへの操作の追加が要らない) / 解約は自前・他はPortal(確認のダイアログ付きの解約ボタンを自前で置く) / 解約・取り消しとも自前(paymentsの`StripeGateway`に取り消しの操作を加える改修が要る)
- Q7: 即時に解約・返金なし(推奨・採用) / 期間末に解約・返金なし(末日が物理削除より後ならCustomerの削除で即時に終わる) / 即時に解約・日割りで返金(返金ポリシーと要件定義書への追記が要る)
- Q8: 自前で3種を送る(推奨。支払いの失敗・解約の受付・特典の終了) / 支払い失敗だけ自前(採用) / Stripeの自動メール(実装は要らないが文面とリンク先を制御できない) / 送らない(画面の表示だけ)

### 確認済みのため質問しない事項

- 状態と特典の対応: active・past_due・canceledは「適用する」、endedは「適用しない」とし、公開プロフィールの加入表示も同じ条件にする(料金とプラン、briefのConstraints)。支払い失敗の再試行の回数と期間はStripeの設定に従い、再試行の後は「サブスクリプションをキャンセルする」(ended)とする。
- 状態の名前: データエクスポートの`plan.status`の4値(`active`・`past_due`・`canceled`・`ended`)と、`plan`の項目(`startedAt`・`currentPeriodEndsAt`・`canceledAt`)に合わせる。
- 特典の判定の口: 消費する側はStripeの状態を見ず、本specの判定サービス(指定時点で特典を受けられるか)だけに依存する(brief、roadmapのShared seams)。再ローンチの間隔はローンチ日を登録・編集する時点の状態で判定し、適用はproduct-launchが行う(再ローンチ規則)。
- 加入が有効になった時点: paymentsで決済セッションの支払いの確定を反映した時点(`PurchaseFulfillment`)を「加入の確定」とする。FR-PPLAN-008の失効と免除の付与はtournament-week・tournament-yearがハンドラとして持ち、`OpenCheckoutExpirer`はeventの非同期の処理から呼ぶ(brief、paymentsのdesign)。
- paymentsとの継ぎ目: `ultras`の購入種別の`PurchaseOfferPolicy`・`PurchaseFulfillment`と`SubscriptionEventSink`を`backend-lib/workers/<ドメイン>`に実装し、apiとeventの両方に束縛する(D1の文だけ)。既に加入中の購入は`prepare`で拒否し、paymentsが定期課金を解約して初回の請求を返金する。古い通知の破棄(DR-016)と冪等性(DR-015)はpaymentsが受け持つ。
- 決済画面・最終確認画面・購入確認メール・決済履歴: paymentsが受け持つ。Ultrasの追加の表示事項(自動更新・毎月の請求額・解約の方法)は`CheckoutSummaryText.additionalNotes`で渡す。購入確認メールは加入時の1通だけ(payments仮5)。
- 決済手段: Customer Portalでもカード・Apple Pay・Google Pay・Linkに揃える(FR-PPLAN-010、payments Q2・仮1)。Portalの設定と制限付きキーの権限(Subscriptions・Customer Portal)は、paymentsの`operations/004`の手順に本specが追記する。
- 価格の表示: Stripeのダッシュボードで設定した税込のUSDを、paymentsの`PriceCatalog`・`MoneyText`で表示する(LR-009・I18N-003)。
- 未確認・停止中の利用者: メールアドレスが未確認の利用者は加入できない(FR-USER-006)。停止中・退会済みの利用者も決済を開始できない(paymentsの要件3.5)。
- チャージバック: 特典を自動では変えない(FR-PYMNT-008)。
- 機能フラグの権限と監査: 切り替えは最上位管理者だけ(admin-foundation Q3)。監査ログは`AuditLogRecorder`で記録し、画面は管理画面のメニュー「設定」(`/settings`、order 130)に置く。フラグをオフにしても加入済みの特典に影響しない(料金とプラン)。
- 画面の置き場所: 料金ページは`/pricing`、プラン管理は`/settings/plan`(ページ配置)。設定ページへの登録はidentity-authの`SETTINGS_NAV_ITEMS`(order 60は予約済み)。Portalから戻った直後の反映待ちの表示と、past_dueの間の支払い方法の更新を促す表示もページ配置で決まっている。
- 停止を解除しても自動で再開しない: FR-PPLAN-012・LR-007で決まっている。
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
  - `OpenCheckoutExpirer.expireOpen`はStripeを呼ぶため、FR-PPLAN-008の失効は後続specがeventの非同期の処理から呼ぶ(payments要件2.10)。
  - 権利を付与できない購入(既に加入中)は、paymentsの返金の処理が定期課金を即時に解約してから全額返金する。
  - identity-authの非同期の波及処理の`order`は0〜9999が各ドメイン(10000以上はidentity-auth自身)。既存の登録は`purge_due`にinquiry-chatの300とpaymentsの400、`withdrawn`・`suspended`にpaymentsの410(spec横断レビューで、各specが4:21のジョブと同じ百の位の帯を使う形に整理した。後述)。4:21のジョブの`order`は100〜120・200・210・300・400・410・810〜830・900・950が使われている。
  - email-deliveryは種別(`EMAIL_KINDS`)とテンプレート(`EMAIL_TEMPLATES`)の1対1を検査するため、種別とテンプレートは同じタスクで足す必要がある(paymentsで問題になった点)。
  - admin-foundationの監査ログの文は操作の文と同じ一括の書き込みに入れる。版の照合で操作が0行でも監査ログの文は挿入されるため、照合の失敗で一括の書き込み全体を取り消す工夫が要る。
  - identity-authの共有の部品`UserContactDirectory.findContact`が`email`・`nickname`を返す(メールの宛先と宛名に使える。spec横断レビューで決定、後述)。
- **Implications**: 口の実装を`backend-lib/workers/ultras`に置き、apiとeventの両方に束縛する。知らせとメールは依頼待ちの行として一括の書き込みに含め、`afterCommit`(仮5)と4:21の日次の確認で送り出す。波及処理の`order`と4:21のジョブの`order`は、どちらも本specの500番台(500)にする。

### Stripeの定期課金と柔軟な請求モード

- **Context**: Customer Portalでの解約(FR-PPLAN-011)と課金期間の末日の判定(Q4)。
- **Sources Consulted**: [Integrate the customer portal](https://docs.stripe.com/customer-management/integrate-customer-portal)、[Cancel subscriptions](https://docs.stripe.com/billing/subscriptions/cancel)、[Billing mode changelog](https://docs.stripe.com/changelog/basil/2025-06-30/billing-mode)、[cancel_at enums](https://docs.stripe.com/changelog/basil/2025-07-30/cancel-at-enums)。
- **Findings**:
  - API版`2025-09-30.clover`以降、新しい定期課金は柔軟な請求モード(`billing_mode: flexible`)が既定になる。paymentsが固定するAPI版`2026-10-28.endive`もこれに当たる。
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

- **Context**: FR-PPLAN-007(再試行の後の扱い)、Q8(Stripeの顧客向けメールを切る)、要件12.2(検証の手順)。
- **Sources Consulted**: `stripe:stripe-best-practices`スキル(定期課金とCustomer Portal・test clock)、料金とプラン「状態ごとの特典の適用」。
- **Findings**:
  - 支払いの再試行(Smart Retries)の後の扱いは、ダッシュボードの「Manage failed payments」で「サブスクリプションをキャンセル」を選べる。料金とプランはこの設定を前提にする。
  - 支払いの失敗・カードの期限切れなどの顧客向けメールは、ダッシュボードのBillingの設定で個別に送らないようにできる。
  - sandboxのtest clockで時刻を進めると、更新・再試行・期間末の終了をWebhookまで含めて再現できる。支払いの失敗はテストカード`4000 0000 0000 0341`(Customerへの紐付けは成功し、請求で失敗する)で再現できる。
- **Implications**: 設定と検証の手順を`operations/004`の「定期課金とCustomer Portal」の節と`external/008`に書く。`unpaid`・`paused`は設定上起きないため、受け取ったら終了として扱い`captureEvent`で知らせる。

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

- **Context**: FR-PPLAN-008、Q8、paymentsの口は副作用を持てない。
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

- **Context**: FR-ADMCF-022、仮2、admin-foundationの監査ログの規約。
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
- `unpaid`・`paused`の受信(設定の誤り) — 終了として扱い、`captureEvent`で運営者に知らせる。
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

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂が必要である。

| 要件ID                     | 内容                                                                                                                                                          | 根拠     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-TOURW-003・FR-TOURY-005 | 有料プランによる免除の判定時点を「予選勝利(Week優勝)の確定時点で特典を受けられる状態、または勝利の後で決済期限までに加入した時点」と明記する                  | Q1       |
| FR-PPLAN-008               | 加入の前に決済が完了した参加費は返金しない旨を注記する                                                                                                        | Q2       |
| FR-PPLAN-012               | 停止に伴う解約で返金しない旨を明記する(返金ポリシーの大枠は本specで修正する)                                                                                  | Q3       |
| FR-PPLAN-003               | 「当該課金期間の末日」を「課金期間の最後の瞬間を含むUTC-08:00の日付」と定義し、支払いの失敗(FR-PPLAN-007)と退会による終了は日の終わりまで延ばさない旨を加える | Q4       |
| FR-ADMCF-022               | 機能フラグがオフの間は新規加入の受付も停止し、加入済みの利用者の特典・状態表示・Customer Portalには影響しない旨を加える                                       | Q5       |
| FR-PPLAN-010               | Customer Portalで支払い方法の更新に加え、課金期間の末日に終わる解約と解約の取り消しを行えるようにする旨に改める                                               | Q6       |
| FR-PPLAN-005               | 退会時は即時に解約し、返金しない旨を加える                                                                                                                    | Q7       |
| FR-PPLAN-007の下に新設     | 支払いの失敗(再試行中への移行)を利用者にトランザクションメールで通知する旨を加える                                                                            | Q8       |
| LR-007の下に新設           | 解約の受付の確認メール(受付の日時・終了の時点)を送る旨と、購入確認に自動更新の条件・解約の方法を載せる旨を加える                                              | 仮1・仮3 |
| FR-RLMIT節に新設           | Customer Portalのセッションの作成に、利用者単位で1時間に20回の上限を設ける旨を加える                                                                          | 仮4      |

## 上流・後続specへの影響

- payments(上流): `PurchaseFulfillment.afterCommit?`・`SubscriptionEventSink.afterCommit?`・`SubscriptionChange.cancelAt`・`StripeSubscriptionSnapshot.cancelAt`の追加と呼び出し(仮5)、購入確認メールへの追加事項の掲載(仮3)を、2026-10-23の開発者の承認と許可を受けてpaymentsの要件(2.11・7.8・7.9・11.6)・設計・タスク(2.1・2.4・3.2・5.2〜5.4)・research.md(決定事項のU1・U2)に直接反映した。本specのタスクはpaymentsのコードを変更せず、1.1の前提でpaymentsの実装の完了を確かめる。`operations/004`の権限の表の更新は本specのタスク1.4で行う。`operations/004`には本specが「定期課金とCustomer Portal」の節を足す。
- payments・inquiry-chat: 両specが`purge_due`の非同期の波及処理に`order` 300を登録していた重複は、spec横断レビュー(2026-10-23)で各specが4:21のジョブと同じ百の位の帯を使う形に解消した(inquiry-chatは300、paymentsは400・410、本specは500)。
- identity-auth(上流): ファイルの変更は無い。メールの宛先と宛名は共有の部品`UserContactDirectory.findContact`(`apps/backend-lib/workers/identity`)で引き、`users`の列を直接読まない。`SETTINGS_NAV_ITEMS`の`order` 60、非同期の波及処理の`order` 500を使う。
- admin-foundation(上流): ファイルの変更は無い。`ADMIN_NAV_ITEMS`に「設定」(130)を本specが足し、`/settings`のページの枠を本specが作る(仮6)。
- tournament-week・tournament-year(後続): `ULTRAS_ACTIVATION_HANDLERS`にハンドラ(`order` 100以上)を登録し、`OpenCheckoutExpirer.expireOpen`で未完了の参加費の決済セッションを失効させる(FR-PPLAN-008)。免除は`UltrasEntitlements.wasEntitledDuring(投稿者, 勝利の確定時刻, 決済期限)`で判定する(Q1)。決済済みの参加費は返金しない(Q2)。参加費の画面のUltrasの案内は`UltrasPromotionGate`で包む(Q5)。返金ポリシーの「停止・非公開化に伴うトーナメント参加資格の停止: 返金する」の行の扱い(自動か手動か)を判断する。tournament-yearは管理画面の設定ページに決勝日の区画(`order` 10)を登録する。
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

## frontend-platformの確定した契約の反映(2026-10-28)

- **状態**: frontend-platformのタスク10.4として、frontend-platformが実装で確定した契約(frontend-platformのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に本specの設計とタスクを合わせた。2026-10-28に開発者が下流specの設計の改訂を決めた(frontend-platformの判断11)。受け入れ基準は変えていない。
- **GraphQLの操作の置き場所**: 操作は`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名はclientが`Client`、adminが`Admin`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`だけを読む契約になった。clientの4つの操作とadminの2つの操作を`.graphql`に分けた。
- **管理者側のエラーの案内文**: `ErrorState`に`contactHref`を渡さず、`GraphQLClientError`でない例外に代えて出す文言は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`で選ぶ契約になった。`PromotionSettingSection`の取得と切り替えの失敗をこの契約で書いた。
- **変えた箇所**: design.mdのAllowed Dependencies・File Structure Plan・clientの節の冒頭(操作の規約)・adminの節(失敗の表示)、tasks.mdの7.1・8.1(`.graphql`・操作名・生成・`codegen.unit.test.ts`、8.1は管理者側の失敗の表示)。
- **確認のダイアログの失敗の文言**: admin-foundationの`ConfirmActionDialogProps`が必須の`failureMessageOf: (error: unknown) => string`を受け、`onConfirm`の失敗時にダイアログを開いたまま理由の入力を保ち、`failureMessageOf(error)`の文言を`role="alert"`でダイアログの中に示す契約になった(同日のadmin-foundationの改訂)。共通部品はアプリのプロファイルを読まないため、呼び出す側が文言を決める。 `PromotionSettingSection`は`failureMessageOf`で`version_conflict`の読み直しの案内を返し、それ以外は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`を返す形に書き改めた(design.mdの`PromotionSettingSection`と失敗の表示、tasks.mdの8.1)。

## 実装済みの上流との食い違いの水平展開(2026-10-30、開発者の指示)

- **Sentryの定型の通知**: content-processingの差分の分析(G-4)で、backend-platformの改訂7と技術ドキュメント`infra/004`の「同じ文言を繰り返し送る通知」が、定型の文言で繰り返し起こり得る出来事を`captureMessage`ではなく`captureEvent`で送り、文言を`logentry`、まとめる単位を`fingerprint`に置くと定めていることを確かめた。`captureMessage`は既定の`dedupeIntegration`により、同じ文言の2件目以降が捨てられる。本specの`captureMessage`をすべて`captureEvent`に改め、規約の参照と通知のタグの記述に`logentry`と`fingerprint`の置き方を加えた。通知の種類・タグ・レベルは変えていない。
- 要件と受け入れ基準は変えていない。

## 層の規則に合わせた契約の置き場所の改訂(2026-11-02、開発者の指示)

- **規則**: [層構成の依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析)により、api・eventの`src/application/**`・`src/domain/**`は`**/lib/workers/**`を型も含めて読み込めない。application層が受け取る契約と識別子は`apps/backend-lib/core/<ドメイン>`に置き、`workers`には実装と束縛だけを置く。`core`はDBディレクトリを読み込まず、D1の文(`BatchItem<'sqlite'>`)を返す契約は`workers`に置き、`workers`と`infrastructure`だけが使う。application層はDBの一括の書き込みを扱わず、書き込みの単位をポートにしてinfrastructure層で実装する。厳密カウンタを使うクラスはinfrastructure層に置く。
- **coreへ移した・加えた契約**: `workers`の節にあった`ActivationDispatcher`・`UltrasNotifier`の契約を定め、`core/ultras/ports.ts`に置いた(apiの`PendingDispatchSweepJob`が受け取る)。`ULTRAS_TYPES`は`identifiers.unit.test.ts`で値と凍結を確かめる。
- **ストアの分割**: `core/ultras/ports.ts`の`SubscriptionStore`・`ActivationStore`・`NoticeStore`が文を返す操作を含んでいたため、文を返す操作(`upsertStripeState`・`activate`・`insertIfAbsent`・`deleteByUser`)を`workers/ultras/statement-contracts.ts`の`SubscriptionStatements`・`ActivationStatements`・`NoticeStatements`へ移した。D1の実装は1つのクラスで両方を実装する。
- **新しいポートとinfrastructure層の実装**: apiのapplication層に`PortalSessionLimits`(実装`CounterPortalSessionLimits`)、eventのapplication層に`UltrasAccountDataEraser`(実装`D1UltrasAccountDataEraser`。3テーブルの利用者の行の削除を1回の一括の書き込みで確定)を置いた。`MessagePublisher`は`workers/ultras`の`ActivationDispatcher`の実装だけが使う。
- **paymentsの分割に合わせた参照**: paymentsの同日の改訂で、`PurchaseFulfillment`・`FulfillmentPlan`・`PurchaseKindRegistration`・`SubscriptionEventSink`・`SubscriptionEventSinkRegistration`が`workers/payments/fulfillment-contract.ts`(`Database`・`BatchItem`を読み込む)へ移り、`PurchaseOfferPolicy`・`SubscriptionChange`・`StripeGateway`・`CustomerDirectory`・`PriceCatalog`・`StripeUnavailableError`は`core/payments`に置かれた。本specの`UltrasFulfillment`・`PlanStateSink`(`workers/ultras`)は前者を、application層は後者だけを読み込む。
- **変えた箇所**: design.mdのOverviewのImpact、This Spec Owns、Allowed Dependencies(backend-platform・payments・後続spec)、Revalidation Triggers、Existing Architecture Analysis、Existing patterns preserved、Dependency direction、File Structure Planの木、Requirements Traceability(6.\*・11.1)、Componentsの表、`backend-lib/core・workers`の節(置き場所・ストアと文の契約・`UltrasEntitlements`・`UltrasFulfillment`・`PlanStateSink`・`ActivationDispatcher`・`UltrasNotifier`・paymentsへの追加の前提)、apiの`PortalSessionStarter`とジョブの依存、eventの波及処理、Testing Strategy。tasks.mdの2.1・3.1・4.1・4.3・4.4・5.2・5.4・6.2。
- 要件と受け入れ基準は変えていない。タスクの番号は変えていない。

## 実装前のギャップ分析(2026-11-06、`/cc-sdd:kiro-validate-gap`)

### 分析の前提と方法

- **状態**: 要件・設計・タスクは承認済みで、タスクは43件すべて未着手である(`ready_for_implementation`は`false`)。タスク1.1の前提の上流は、paymentsのsandboxでの手動の検証(1.4・11.2)とinfra-deliveryのstagingの識別子の反映(9.2)を除いて実装を終えている。本specの設計は、上流の大半の実装より前に書かれた。
- **方法**: 設計が「既にある」と前提にする上流の型・関数・ファイル・設定値・文書を、paymentsとの接点、api・eventのバックエンド基盤、clientとadminとE2E、DBとcommon-libと文書の4つの領域に分けて、実際のコードと突き合わせた。影響の大きい指摘(主キーのNULL、`buildPageHead`の入力、2つの壊れるテスト、application層の引数)は、コードを直接読んで確かめ直した。本specが新しく作るものが無いことは前提どおりのため、ギャップとして数えない。
- **結論の要約**: 上流の契約の名前・置き場所・形は、ほぼ設計どおりに存在する。paymentsは仮3・仮5(`afterCommit`・`cancelAt`・購入確認メールの追加事項)を実装済みで、購入種別`ultras`・`/pricing`と`/settings/plan`へのリンク・メニューの`order`も予約済みである。食い違いは次の3種に分かれる。(1)プロジェクトの規則・前例と衝突する設計、または設計が挙動を定めていない箇所が10点。(2)既存の「一覧を完全一致で確かめるテスト」と登録の一覧の文書が本specの追加で壊れるのに、Modified Filesに無いものが多数。(3)上流が先に済ませたため確かめるだけになった作業。

### 要件と資産の対応

| 要件                       | 使う上流の資産(実在を確認)                                                                                                                                                                                                                                                                                                                                                                                                                         | ギャップ                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 加入                     | `CheckoutStarter`(`API_PAYMENTS_TYPES.CheckoutStarter`、入力`{ session, kind, targetId, humanCheck? }`、戻り値`{ purchaseId }`)、`core/payments/purchase-kind-contract.ts`の`PurchaseOfferPolicy`ほか、購入種別`ultras`(`common-lib/payments/purchase-kinds.ts:5`、GraphQLの`PurchaseKind.ULTRAS`)。二重の加入は`prepare`の2回目も制約の違反なら`ineligible`になり、返金の依頼が同じ一括の書き込みに入る(`checkout-session-reflection.ts:371-407`) | Constraint: `UltrasCheckout.start(context)`がapplication層で`GraphQLContext`を受ける(下の3)。小: `CheckoutStarter`は回数制限の`consume`を`describe`より前に行うため、`ultras_already_subscribed`などの拒否でも1回分を消費する。`unavailable`の判定は`message`が必須で、設計はコードだけを挙げる                                                                                |
| 2 加入状態                 | `SubscriptionEventSink`(`statementsFor(change, db)`・`afterCommit?(change)`)、`SubscriptionChange.cancelAt`(`purchase-kind-contract.ts:105`)、Webhookの`customer.subscription.created`・`updated`・`deleted`                                                                                                                                                                                                                                       | 小: `invoice.payment_failed`は決済履歴へ回りsinkには届かないが、設計は`past_due`への変化で判定するため問題ない。小: 決済セッションの作成で`billing_mode`を指定せず、API版の既定(柔軟な請求モード)に頼っている(`stripe-gateway.ts:238-256`)。Stripe側の`canceled`と加入状態の`canceled`は意味が異なり、文書に対応表が要る                                                       |
| 3 特典の判定               | `toBusinessDateTime`・`fromBusinessDateTime`(`core/time/business-time.ts:105・125`)                                                                                                                                                                                                                                                                                                                                                                | Missing: 業務日付の日の終わりを求める関数は無い。置き場所を`core/ultras`にするか`core/time`にするか(後続specも使う見込み)                                                                                                                                                                                                                                                      |
| 4 加入が有効になった知らせ | `defineMessageContract`・`MESSAGE_CONTRACTS`(重複と包含の検査だけで壊れない)、ドメインの下に契約を置く前例`core/payments/refund-message.ts`、確定後の`afterCommit`(`checkout-session-reflection.ts:513-525`、失敗は`warn`)                                                                                                                                                                                                                         | なし                                                                                                                                                                                                                                                                                                                                                                           |
| 5 プラン管理画面           | `settings/route.tsx`のレイアウトが`SettingsShell`で包む、`SETTINGS_NAV_ITEMS`の`order` 60は「plan」として予約済み、`PURCHASED_DESTINATIONS.ULTRAS = '/settings/plan'`                                                                                                                                                                                                                                                                              | Constraint: Portalから戻った直後の確かめ直し(5秒ごと最大12回)が`010`・`006`のどちらの規約にも当てはまらない(下の5)。小: `/settings/plan`の`noIndex`(前例のbillingは`true`)が設計に無い                                                                                                                                                                                         |
| 6 Customer Portal          | `StripeGateway.createPortalSession({ customerId, returnUrl })`→`{ url }`(configuration IDは受けず既定の設定)、`CustomerDirectory.findCustomerId`、回数制限の前例`CounterCheckoutStartLimits`とポート`checkout-ports.ts`。`window.location.assign`の遷移はCSPの許可先の登録が要らない                                                                                                                                                               | 小: ポート`PortalSessionLimits`をユースケースと同じファイルに置く設計で、前例は独立したファイル                                                                                                                                                                                                                                                                                |
| 7 退会・停止の解約         | `UserLifecycleAsyncRegistration`(`{ name, events, order, handler }`)、`order` 500は空き(現在300・400・410・10000)、`cancelSubscription(id, { atPeriodEnd })`→`'canceled' \| 'already_canceled'`                                                                                                                                                                                                                                                    | Unknown: `cancelSubscription`は`StripeUnavailableError`のほかに恒久的な拒否の`StripeRejectedError`と`StripeNotFoundError`も投げる。設計は解約済みと一時的な障害しか扱わない(下の9)                                                                                                                                                                                             |
| 8 メール                   | `defineEmailKind`(`category`は必須)・`EMAIL_KINDS`・`defineEmailTemplate`・`EMAIL_TEMPLATES`・1対1の検査(`templates/index.worker.test.tsx`)、`UserContactDirectory.findContact`(退会済みで`undefined`、停止中は返す。api・eventの両方に束縛)、`CLIENT_SITE_ORIGIN`(api・eventの環境の検証にある)                                                                                                                                                   | 小: 種別は前例ではドメインごとに1ファイル(`kinds/payments.ts`に2種)で、設計は種別ごとの2ファイル。本文の部品の名前は前例が`*-email-body.tsx`                                                                                                                                                                                                                                   |
| 9 料金ページ               | `/pricing`へのリンク(`client/src/components/layout/site-links.ts:83`、`CHECKOUT_RESTART_HREFS.ULTRAS`)、`MoneyText`(`frontend-lib/components/payments/money-text.tsx`、propsは`amount`だけでUSD固定)、`buildSitePageHead`                                                                                                                                                                                                                          | Missing: `buildPageHead`の入力は`title`・`siteName`・`canonicalUrl`・`noIndex`だけで、9.8の「説明」を出せない(下の7)。Constraint: `PriceCatalog.getPrices`は値が無くStripeにも届かないと`AppError(unavailable, payments_unavailable)`を投げ、設計の「取得できなければnull」と食い違う(下の10)。Constraint: `PRICING_SECTIONS`の形と区画ごとのエラーの境界(下の6)               |
| 10 機能フラグ              | `requireAdmin(context, minimum)`(presentation層)、`AuditLogRecorder.prepare`・`AdminDirectory.findProfiles`(`core/admin`)、`buildAuditLogStatements(db, entry, guard?)`(apiのinfrastructure層)と`guard: { kind: 'condition' }`・`isAuditGuardRejection`、対象の種類`setting`と表示名「設定」、`ADMIN_NAV_ITEMS`の`order` 130は「設定」として予約済み、`ConfirmActionDialog`の`failureMessageOf`                                                    | Constraint: 版の照合の文が動かない(下の1)。Constraint: `PromotionSettingService.read(context)`・`update(context)`がapplication層で`requireAdmin`と`GraphQLContext`を使う(下の3)。Constraint: 初期行の入れ方(下の2)。Constraint: `ADMIN_SETTINGS_SECTIONS`の形(下の6)。小: `RoleGate`は表示の出し分けで、スイッチの有効・無効は`hasRole(useAdminRole(), 'super_admin')`で決める |
| 11 物理削除・エクスポート  | `purge_due`の順(inquiry-chat 300→payments 400→本spec 500)、購入IDに外部キーを張らない設計はpaymentsの400の削除と整合、`plan.status`の4値(`features/001-user-data-export.md:177`)は設計と一致                                                                                                                                                                                                                                                       | なし                                                                                                                                                                                                                                                                                                                                                                           |
| 12 環境の設定と運用        | `operations/004`の「Customer Portal」の節(114-135行)と権限の表のSubscriptions・Customer Portalの行はpaymentsが記載済み。新しいシークレットは要らない                                                                                                                                                                                                                                                                                               | 小: 足すのは再試行の後の解約の設定・顧客向けメールの停止・test clockの3つで、Modified Filesの「節を加える」は追記に読み替える                                                                                                                                                                                                                                                  |
| 13 文書とテスト            | 文書の番号`backend/010`・`external/008`・`features/005`は空き。E2Eの補助`signInAsNewAdmin(page, { role })`・`executeLocalD1`・`sqlStringLiteral`、確認済みの利用者の作成`e2e/client/auth/account-steps.ts`(`createTestAccount`ほか)                                                                                                                                                                                                                | Constraint: `createPlaywrightConfig`に`testIgnore`の引数が無く、プロジェクトの並びを完全一致で確かめるテストがある(下の8)。Missing: `docs/onboardings/project-values.md`(ジョブ・波及処理・操作種別・メニュー・回数制限の規則・`lookup_key`のプレースホルダーを列挙)がModified Filesに無い                                                                                     |

### 規則・前例と衝突する設計

1. **機能フラグの版の照合**: 設計(880行)は照合に失敗すると主キーにNULLを入れ、NOT NULLの違反で一括の書き込みを取り消すとする。しかし`ulidPrimaryKey()`は`text PRIMARY KEY`を生成し、NOT NULLを付けない(`apps/db/schema/_shared/columns.ts:9-13`、各マイグレーションの`` `id` text PRIMARY KEY ``)。SQLiteは整数でない主キーにNULLを許すため、NOT NULLの違反は起きない。実際には同じ`setting_key`の一意の違反で取り消されるが、`db/002:159`の「検査に使った`<テーブル>.<列>`の違反だけを競合に変換する」に当たらず、`version_conflict`ではなく想定外のエラーになる見込みである。根拠に挙げた`db/005`は`meta.changes`の方式だけを扱い、この手順の本体は`db/002:139-160`にある。前例は、監査ログの文を先頭に置く`buildAuditLogStatements(db, entry, { kind: 'condition', condition })`と`isAuditGuardRejection`(inquiry-chatの`d1-inquiry-category-store.ts:102`ほか)で、これを使えば照合の文も`state_token`の列も要らない。
2. **機能フラグの初期行**: 設計(275行)とタスク1.2は、生成したマイグレーションの末尾に初期行を挿入する。`db/003:314-322`は、別の`<名前>_seed`のカスタムマイグレーションに分け、ULIDの時刻部を`created_at`と一致させ、`ON CONFLICT (...) DO NOTHING`を付けると定める(前例`legal_pages_seed`・`inquiry_chat_seed`)。マイグレーションのディレクトリ名も、前例の`_<spec名>`(`_payments`・`_inquiry_chat`)に合わせると`_ultras_subscription`になる。
3. **application層が`GraphQLContext`を受け取る**: `PromotionSettingService.read(context)`・`update(context)`は`requireAdmin(context, …)`を呼び、`UltrasCheckout.start(context)`も`context`を受ける。`requireAdmin`と`GraphQLContext`はpresentation層にあり、application層からの読み込みは`config/eslint/backend-layers.ts`が禁止する。前例は、解決関数が`requireAdmin`を呼んで管理者のIDをユースケースへ渡す形(`modules/legal/admin-resolvers.ts:76`)と、`session`・`humanCheck`を渡す`CheckoutStartInput`の形である。
4. **共有の束縛の形**: 設計は`ULTRAS_PLATFORM_MODULE`を定数にするが、両アプリが使う部品はログのカテゴリのアプリ名を引数で受ける(`infra/004`の77-79行)。前例は`createPaymentsPlatformModule(appName)`(`workers/payments/payments-platform-module.ts:348`)で、`CLIENT_SITE_ORIGIN`も`PLATFORM_TYPES.Env`から読む。
5. **Portalから戻った直後の確かめ直し**: 設計(5.\*、タスク7.4)は5秒ごと最大12回の照会の呼び直しとする。`010-live-refresh-queries.md`は他人の操作で変わるデータを30秒の共通の間隔と「自動更新」の`Switch`で取り直す規約で、この場面に合わない。paymentsの`/checkout/return`は`006`の「マウントの後に呼ぶ確定」の例外に従い、変更を3秒×20回呼び直し、上限で決済履歴を案内し、状態を`role="status"`で伝える(`checkout-return-status.tsx:229-288`)。設計は「反映が済んだ」と判断する条件と、12回で終えた後の案内も定めていない。
6. **区画の登録口の形**: 前例の登録口は、`DASHBOARD_CARDS`・`CATEGORY_SECTIONS`のどちらも`id`が`'<spec名>.<名詞句>'`の形で、区画ごとのエラーの境界に`RecoverableSlot`を使う。`CATEGORY_SECTIONS`は`title`を持ち、読み込み中と失敗の間は区画の位置に`title`の見出しを補う(`admin/src/components/categories/category-sections-view.tsx`)。`DASHBOARD_CARDS`は`title`を持たず、カードの部品が`DashboardCardFrame`で自分の見出しと状態を描く。設計の`PRICING_SECTIONS`・`ADMIN_SETTINGS_SECTIONS`は`id`が`'ultras'`・`'ultras-promotion'`で`title`が無い。clientには区画ごとのエラーの境界の部品が無く、`RecoverableSlot`を使うなら`005`の「2つ目のアプリで要るものは共通部品へ移す」によりfrontend-libへ移す上流の変更になる。adminのページの部品の置き場所の前例は`components/pages/*-page.tsx`で、設計の`components/settings/`と異なる。
7. **料金ページの説明**: 要件9.8は「検索エンジン向けのページの情報(タイトル・説明)」を求めるが、`PageHeadInput`(`frontend-lib/start/page-head.ts:8-13`)に説明の欄が無く、clientの包み`buildSitePageHead`も説明を出さない。満たすにはfrontend-lib(frontend-platformの所有)の変更が要り、設計とModified Filesに無い。
8. **E2Eの直列化と対象外の判定**: `createPlaywrightConfig`は対象ごとに到達確認と本体の2つのプロジェクトを作るだけで、`testIgnore`の引数が無く、直列化の前例は`PROJECT_WORKER_LIMITS`だけである(`e2e/support/playwright-config.ts:37`)。`playwright-config.unit.test.ts:41`はプロジェクトの並びを完全一致で確かめるため、設計の「既存のテストが通ること」と両立しない。共有の補助にUltrasのファイルのパスを置くと`testing/001`の「固有の値を含めない」と衝突するため、ルートの設定から渡す形になる。テスト方針の文書の`--project <対象名>`の記述も、Ultrasの2ファイルが外れることと食い違う。また`stripe listen`の転送の有無を検出する前例は無い。paymentsのE2Eは`payments_unavailable`を検出して`test.skip`で飛ばすが、CIでdevのStripeのキーが注入され転送が無い場合、加入の経路は飛ばされずに失敗するか、sandboxに定期課金を作り続ける恐れがある(推測)。
9. **退会・停止の解約の恒久的な失敗**: `cancelSubscription`の`StripeRejectedError`・`StripeNotFoundError`を、設計(6.2)は扱わない。一時的な障害と同じく例外を返すと、波及処理の再試行の上限まで繰り返して失敗する。paymentsの返金の処理は恒久的な失敗を打ち切って記録し、Sentryへ送る(`refund-failure-reporting.ts`)。
10. **価格を取得できない時**: `UltrasPlanReader.offer()`は価格を`null`にするとするが、`PriceCatalog.getPrices`は保存した値が無くStripeにも届かないと例外を投げる。捕まえて`null`にするか、`payments_unavailable`として画面へ返すかを定める必要がある(要件9.7の「価格を表示できない旨の案内」はどちらでも満たせる)。

### Modified Filesに無い既存の完全一致のテストと設定

| ファイル                                                                                                                                          | 壊れる理由                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/backend-lib/workers/payments/payments-platform-module.worker.test.ts:245-250・262-269`                                                      | 2つの登録の一覧の完全一致と、`resolve('ultras')`が`undefined`であること(4.5)                                                                                                                |
| `apps/api/test/config/payments-scheduled-jobs.unit.test.ts:42-47`                                                                                 | 4:21の`order` 410の次を`media-pipeline.expired-file-erasure`(810)と確かめる(5.4の500が割り込む)                                                                                             |
| `apps/api/src/composition/search-module.worker.test.ts:132-144・166-200`・`search-module.reextraction.worker.test.ts:201-235`(日次の要約の`jobs`) | 4:21のジョブの名前の一覧と、配列への`toMatchObject`(要素数も一致を要する)(5.4)                                                                                                              |
| `apps/event/src/composition/payments-module.worker.test.ts:294-312`                                                                               | `withdrawn`・`suspended`・`purge_due`ごとの波及処理の名前の完全一致(6.2)                                                                                                                    |
| `apps/event/src/composition/payments-lifecycle-handlers.worker.test.ts:549`・`identity-module.worker.test.ts:338`                                 | 退会・停止で完了した波及処理の名前の一覧(配列への`toMatchObject`)(6.2)                                                                                                                      |
| `apps/common-lib/admin/audit-actions/index.unit.test.ts:13`                                                                                       | 操作種別の名前の一覧の完全一致(1.1)                                                                                                                                                         |
| `apps/client/src/components/settings/settings-nav-order.unit.test.ts:38`                                                                          | `SETTINGS_NAV_ITEMS`の完全一致(7.4)                                                                                                                                                         |
| `apps/admin/src/components/layout/admin-nav-order.unit.test.ts:28`・`apps/admin/test/admin-shell.browser.test.tsx:38・114`                        | `ADMIN_NAV_ITEMS`とメニューの一覧の完全一致。`frontend/009-admin-console-shell.md`はこのテストの更新を求める(8.2)                                                                           |
| `e2e/support/playwright-config.unit.test.ts:41`                                                                                                   | プロジェクトの並びの完全一致(上の8)                                                                                                                                                         |
| `apps/api/src/presentation/graphql/generated/`の`schema.graphql`・`resolvers-types.ts`・`allowlist.json`                                          | apiの`bun run graphql:generate`による再生成(`graphql-modules.worker.test.ts:14`が一致を確かめる)。タスク5.\*に再生成の手順が無い                                                            |
| `docs/onboardings/project-values.md`                                                                                                              | ジョブ(660行付近)・非同期の波及処理(789行付近)・操作種別(818行)・メニュー(819行)などの一覧と、`operations/004`・`backend/010`・`external/008`に書けない価格の`lookup_key`のプレースホルダー |
| `apps/db/schema/index.unit.test.ts`・clientの`codegen.unit.test.ts`                                                                               | 壊れないが、前例に合わせて4つのテーブル名と`ULTRAS_OPERATION_NAMES`を足す                                                                                                                   |

壊れないことを確かめたもの: `core/messaging/contracts/index.unit.test.ts`(重複と包含)、`cron-sync.unit.test.ts`、`apps/api/src/composition/inquiry-module.worker.test.ts:467`(直後のジョブ名だけを確かめる)、apiの`payments-module.worker.test.ts:178`(`payments.`で絞る)、`apps/client/test/config/composition.unit.test.ts`(`CLIENT_SECURITY_POLICY`は変えない)、`config/workspace-layout.ts`(`common-lib`全体を配置するため`ultras/`の追加で設定は変わらない)、`templates/index.worker.test.tsx`(種別とテンプレートを同時に足せば通る)。

### 上流が済ませたため確かめるだけになった作業

- paymentsの仮5は実装済みである。購入の`afterCommit`は`checkout-session-reflection.ts:513-525`、定期課金のsinkの`afterCommit`は`payment-reflector.ts:526-540`(一括の書き込みが確定した時だけ)、`cancelAt`は`stripe-snapshots.ts:168`から`payment-reflector.ts:514`で写す。仮3の購入確認メールの追加事項も`purchase-notifier.ts:175`にあり、最終確認画面の受け口は`CheckoutSummary.additionalNotes: [String!]!`である(`checkout-summary.tsx:61-73`は`key={note}`のため、4行の文言は互いに異なる必要がある)。
- 購入種別`ultras`(モード`subscription`、表示名「Ultrasプラン」)はcommon-libとGraphQLに予約済みである。Ultrasの`lookup_key`の定義はどこにも無く、`ULTRAS_PRICE_LOOKUP_KEY`と重複しない。
- `payment_customers`は主キーが`id`のULIDで、`user_id`・`stripe_customer_id`が一意、`timestamps()`を持ち、タスク10.2の記述と一致する。API版は`2026-10-28.endive`(`core/payments/stripe-api-version.ts`)で設計と一致する。
- `SETTINGS_NAV_ITEMS`の`order` 60と`ADMIN_NAV_ITEMS`の`order` 130は予約済み、4:21と波及処理の`order` 500は空き、監査ログの対象の種類`setting`は登録済みである。
- `docs/GUIDES/service/legal/004-legal-notice-outline.md`の停止の行は、コミットfccb79cbで「返金しない」に直っている。退会の行・決済後の加入の行・章8の追記は未反映である。`002-pricing-and-plans.md`は免除の判定時点(Q1)の記述だけが既にある。`tech-stack.md:162`・`002-page-layouts.md:422`・`007-daily-timeline.md`・`003-text-and-copy-rules.md`・`001-compliance-policy.md:25-26`は未改訂で、Modified Filesどおりに直す。
- 要件定義書の改訂(2026-10-25に適用済み)は入っている。振り直しの後の番号は、退会の即時の解約がFR-PPLAN-005、加入前に決済した参加費を返金しない旨がFR-PPLAN-009、支払いの失敗のメールがFR-PPLAN-013、フラグがオフの範囲がFR-ADMCF-023である。

### 設計の記述と実装の小さな食い違い

| 箇所                              | 設計の記述                                                                                                    | 実装                                                                                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allowed Dependenciesの`MoneyText` | GraphQLの`Money`・`CheckoutStart`と並べる                                                                     | frontend-libの部品(`components/payments/money-text.tsx`)。propsは`amount`だけで通貨はUSD固定                                                                                                                                                              |
| paymentsへの追加の前提            | paymentsのタスクが先に実装する                                                                                | 実装済み                                                                                                                                                                                                                                                  |
| apiの識別子のファイル             | `application/ultras/api-ultras-types.ts`                                                                      | 前例は接頭辞の無い`payments-types.ts`。eventの`event-ultras-types.ts`は前例どおり                                                                                                                                                                         |
| ポートの置き場所                  | `PortalSessionLimits`をユースケースの、`UltrasAccountDataEraser`を波及処理のファイルに置く                    | 前例は独立したファイル(`checkout-ports.ts`・`payment-account-data-eraser.ts`)                                                                                                                                                                             |
| メールの種別と本文                | `kinds/ultras-payment-failed.ts`・`ultras-cancellation-accepted.ts`、`*-body.tsx`、`category`の記載なし       | 前例は`kinds/<ドメイン>.ts`の1ファイル、`*-email-body.tsx`。`category`は必須                                                                                                                                                                              |
| ページのhead                      | `buildPageHead`                                                                                               | clientは`buildSitePageHead`、adminは`buildAdminPageHead`を使う                                                                                                                                                                                            |
| `buildAuditLogStatements`         | admin-foundationの共有の部品                                                                                  | apiのinfrastructure層(`api/src/infrastructure/admin/audit-log-statements.ts:169`)。本specの`D1PromotionSettingWriter`もapiのinfrastructure層のため使える                                                                                                  |
| 版の照合の根拠                    | `db/005`の方式                                                                                                | `db/002:139-160`。主キーへのNULLは違反にならない(上の1)                                                                                                                                                                                                   |
| マイグレーションの名前            | `<日時>_ultras`                                                                                               | 前例は`<日時>_<spec名>`と`<日時>_<spec名>_seed`                                                                                                                                                                                                           |
| 管理画面のページの部品            | `components/settings/admin-settings-page.tsx`                                                                 | 前例は`components/pages/*-page.tsx`                                                                                                                                                                                                                       |
| `UnavailableNotice`               | 価格を表示できない旨の案内に使う                                                                              | `reason`が必須(paymentsは`PAYMENTS_UNAVAILABLE_REASON`を渡す)                                                                                                                                                                                             |
| E2Eの確認済みの利用者の作成       | identity-authのE2EのMailpitの補助                                                                             | `e2e/client/auth/account-steps.ts`の`createTestAccount`・`registerAccount`・`verifyEmailFromMail`(paymentsのE2Eも使う)                                                                                                                                    |
| `findUndispatched`の索引          | 索引`(completed_at, dispatched_at)`                                                                           | 条件に使う`created_at`を含まない(件数が少ないため実害は小さい)                                                                                                                                                                                            |
| requirements.mdの参照             | Introductionの範囲がFR-PPLAN-001〜013とFR-ADMCF-022で、Q2は「FR-PPLAN-008に返金しない旨を注記する改訂が要る」 | 改訂の後はFR-ADMCF-023(フラグがオフの間の範囲)が独立した要件で、本specの範囲に入るのにIntroductionに無い。FR-PPLAN-009・013はIntroductionの001〜013に含まれる。Q2は要件フェーズの記録として残す(改訂の後はFR-PPLAN-009)。受け入れ基準は内容を満たしている |

### 対応の選択肢

#### Option A: 設計を変えず、各タスクの中で食い違いを吸収する

- 規則と衝突する10点と、完全一致のテストの更新を、実装者がタスクの実行中に判断して直す。
- ✅ 文書の改訂の手間が無く、すぐ着手できる。
- ❌ 版の照合(上の1)はそのまま実装すると、競合が想定外のエラーになる不具合を作る。区画の登録口(上の6)は後続spec(sponsorship・tournament-year・notifications)が追記する形で、後から変えると波及する。frontend-lib(上の6・7)とdev-tooling(上の8)は上流の所有物で、実装者の判断で変えられない。`/cc-sdd:kiro-review`のたびに同じ指摘が出る。

#### Option B: 実装の前に設計とタスクをすべて改訂する

- 本分析の全項目(小さな食い違いを含む)をdesign.md・tasks.mdへ反映し、必要なら`/cc-sdd:kiro-validate-design`で確かめ直してから実装する。
- ✅ 設計が実装の正となり、後続specへの影響も先に洗い出せる。
- ❌ 設計は1,160行あり、小さな項目まで直すと改訂の量が大きい。

#### Option C: 規則と衝突する項目と下流・上流へ波及する項目だけを先に改訂し、他はタスクの注記にする(混成)

- 先に改訂する項目:
  1. 機能フラグの版の照合(監査ログの`condition`の検査に替えて`state_token`をやめるか、主キー以外のNOT NULLの列で照合するか)
  2. 初期行(`_seed`のカスタムマイグレーションへ分けるか)とマイグレーションの名前
  3. application層の引数(解決関数で`requireAdmin`を呼び、ユースケースへ管理者のIDと`session`を渡す形)
  4. 共有の束縛を`createUltrasPlatformModule(appName)`の形にするか
  5. Portalから戻った直後の確かめ直しの方式・反映済みの判断条件・上限の後の案内
  6. 区画の登録口の形(`id`の形・`title`・`RecoverableSlot`のfrontend-libへの移動)
  7. 料金ページの説明(`PageHeadInput`に説明を足すfrontend-platformの所有物の変更か、要件9.8の解釈を変えるか)
  8. E2Eの直列化の組み立て(引数の形・既存のテストの更新・文書の`--project`の記述)と、Stripeの環境が揃っているかの判定
  9. 退会・停止の解約の恒久的な失敗の扱い
  10. 価格を取得できない時の`ultrasOffer`の返し方
- タスクの注記にする項目: 上の「Modified Filesに無い既存の完全一致のテストと設定」の表の各行、apiの`graphql:generate`、`project-values.md`の追記、業務日付の日の終わりの関数の置き場所、`CheckoutStarter`の回数制限の消費、小さな食い違いの表の各行。
- ✅ 不具合・規則の違反・上流の所有物の変更・後続specへの波及を実装の前に防ぎ、改訂の量を抑えられる。
- ❌ 注記と設計の本文の両方を見る必要がある。

### 規模とリスク

- **規模: XL(2週間以上)** — タスク43件で、DB(4テーブル)・common-lib・backend-lib・api・event・client・admin・E2E・文書のすべての層にまたがる。上の6〜8の上流(frontend-lib・dev-tooling)の変更が加わり、sandboxのtest clockによる手動の検証もある。上流の契約は揃っており、新しいパッケージも無いため、規模を押し上げているのは本spec自身の範囲である。
- **リスク: Medium** — Stripeとの通信・Webhookの反映・確定後の呼び出しはpaymentsが実装を終えており、本specはその口を実装するだけである。残るリスクは、柔軟な請求モードの`cancel_at`と再試行の後の終了がtest clockで設計どおりに届くか、CIのE2Eでの決済の経路の扱い、版の照合の不具合(上の1は実装の前に直せば手戻りにならない)である。

### 設計フェーズへの申し送り

- **推奨**: Option C。上の10点は、開発者の判断を得てから設計を改訂する。
- **Research Needed**:
  - `billing_mode`を指定しない決済セッションが、API版`2026-10-28.endive`で柔軟な請求モードの定期課金を作り、Customer Portalでの期間末の解約が`cancel_at`だけで届くか(`cancel_at_period_end`は偽のままか)。タスク10.2のtest clockで確かめる。
  - 再試行の後に解約する設定で届く通知の順序(`invoice.payment_failed`・`customer.subscription.updated`の`past_due`・`customer.subscription.deleted`)と、paymentsの古い通知を捨てる判定の組み合わせで、特典の終了時刻が`ended_at`の値になるか。
  - CIのE2E(`stripe listen`が無い)で、加入の経路を飛ばす条件をどう判定するか。
  - `UltrasPromotionGate`が`ultrasOffer`を使うと、導線を出す画面ごとに価格の照会が走る。`PriceCatalog`が保存した値(`payment_price_snapshots`)を返す時にStripeを呼ばないかと、ゲートが別の軽い照会を使うべきか。
  - 4:21の本specのジョブ(送り出し100件・メールの依頼100件・500件ずつの削除)が、共有の予算300秒とジョブ1件の目安30秒(`infra/003`)に収まるか。

## 実装前のギャップ分析への開発者の回答の反映(2026-11-06)

- **状態**: 上の「実装前のギャップ分析」の「規則・前例と衝突する設計」10点(8はE2Eの直列化と加入の経路を動かす条件の2問に分けた)について、開発者へ1件ずつ選択肢と推奨を示して決定を得た。決定に従ってdesign.md・tasks.mdを改訂し、区画の登録口の形はsponsorship・tournament-year・notificationsへ、E2Eの直列化の形はroadmapへ水平展開した。要件の受け入れ基準は変えていない。タスクの番号は変えていない。`spec.json`の承認の状態と`ready_for_implementation`は変えていない。

### 決定

| 項目                                | 決定                                                                                                                                                                                                                                                                                                                                                                                                                    | 推奨との違い                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1 機能フラグの版の照合              | 照合の文(主キーへのNULL)と`state_token`の列をやめ、`buildAuditLogStatements(db, entry, { kind: 'condition', condition })`で「鍵と読み取った版が一致する設定の行がある」ことを条件にした監査ログの文を先頭に置き、設定の更新(`version = version + 1`)を続ける。失敗は`isAuditGuardRejection`で判定して`version_conflict`に変える(前例inquiry-chatの`d1-inquiry-category-store.ts`)                                       | 推奨どおり                                                                       |
| 2 機能フラグの初期行                | `db/003`の「初期データ」どおり、`<日時>_ultras_subscription`(生成)と`<日時>_ultras_subscription_seed`(カスタム)の2つに分け、IDの時刻部と`created_at`を一致させ、`ON CONFLICT (setting_key) DO NOTHING`を付ける                                                                                                                                                                                                          | 推奨どおり                                                                       |
| 3 application層の引数               | 解決関数がpresentation層の`requireAdmin`を呼んで管理者のIDを、`GraphQLContext`から取り出した`SessionView`を、それぞれユースケースへ渡す。`PromotionSettingService`は`read()`・`update({ adminId, … })`、`UltrasCheckout`は`start(session)`にした(前例`modules/legal/admin-resolvers.ts`、paymentsの`CheckoutStartInput`)                                                                                                | 推奨どおり                                                                       |
| 4 共有の束縛の形                    | `createUltrasPlatformModule(appName)`にし、apiとeventがそれぞれのアプリ名で入れる。アプリ名をログのカテゴリの先頭に使い、`CLIENT_SITE_ORIGIN`は`PLATFORM_TYPES.Env`から読む(前例`createPaymentsPlatformModule(appName)`)                                                                                                                                                                                                | 推奨どおり                                                                       |
| 5 Portalから戻った直後の確かめ直し  | `viewerUltras`の照会を5秒ごとに最大12回だけ取り直し(`refetchInterval`を関数にして回数で止める)、完了の判定は持たない。12回を終えたら`role="status"`の表示を開き直しの案内に切り替える。「自動更新」の`Switch`は置かない。`010-live-refresh-queries.md`の「使う場面」に「外部サービスでの操作から戻った直後に、遅れて反映される閲覧者自身のデータ」の行を加える(タスク7.4)                                               | 推奨どおり                                                                       |
| 6 区画の登録口の形                  | `PRICING_SECTIONS`・`ADMIN_SETTINGS_SECTIONS`を前例に合わせ、`id`(`'<spec名>.<名詞句>'`。`CATEGORY_SECTIONS`・`DASHBOARD_CARDS`の両方の前例)・`order`・`title`(`CATEGORY_SECTIONS`の前例)・`component`にする。inquiry-chatの`RecoverableSlot`を問い合わせの扱いをpropsで受け取る形にしてfrontend-libへ移し、両アプリの設定ページ・料金ページで区画ごとに包む(タスク7.3)。adminのページの部品は`components/pages/`に置く | 推奨どおり                                                                       |
| 7 料金ページの説明                  | frontend-libの`PageHeadInput`に省略可能な`description`を加え、`buildSitePageHead`から渡す。frontend-platformの`design.md`のページのheadの契約も直す(タスク7.3)                                                                                                                                                                                                                                                          | 推奨どおり                                                                       |
| 8 E2Eの直列化                       | `createPlaywrightConfig`に省略可能な4つ目の引数`serialGroups`(既定は空)を加え、Ultrasの組はルートの`playwright.config.ts`から渡す。引数を省けば今のプロジェクトの並びのままで、既存のテストを変えない。テスト方針の文書の`--project`の記述とdev-toolingの`design.md`のE2EConfigの契約を直す(タスク10.1)                                                                                                                 | 推奨どおり                                                                       |
| 8の続き E2Eの加入の経路を動かす条件 | `stripe listen`の転送を前提にせず、paymentsのE2Eと同じく、加入の開始が`payments_unavailable`のときだけ`test.skip`で飛ばす。`return_url`の反映で`active`とPortalのURLへの移動まで確かめ、sandboxに定期課金が実行の数だけ残る旨を書き添える                                                                                                                                                                               | 推奨どおり                                                                       |
| 9 退会・停止の解約の恒久的な失敗    | `cancelSubscription`の`StripeUnavailableError`・`StripeRejectedError`・`StripeNotFoundError`をいずれも捕まえずに投げ、identity-authの波及処理の再試行に任せる。上限の後はSentryの通知を受けた運用者がダッシュボードで解約する手順を`operations/004`の「定期課金」の節に加える(タスク1.4・6.2)                                                                                                                           | 推奨(`StripeNotFoundError`は成功、`StripeRejectedError`は打ち切って通知)と異なる |
| 10 価格を取得できない時             | `UltrasPlanReader.offer()`が`PriceCatalog`の`payments_unavailable`だけを捕まえて`price: null`・`priceStale: false`を返し、他の例外は投げ直す(タスク5.1)                                                                                                                                                                                                                                                                 | 推奨どおり                                                                       |

### 決定に合わせて加えた漏れ

上の「実装前のギャップ分析」でタスクの注記にするとした項目を、タスクと設計へ反映した。

- 完全一致のテストと設定の更新先: `payments-platform-module.worker.test.ts`(4.5)、`payments-scheduled-jobs.unit.test.ts`・`search-module.worker.test.ts`・`search-module.reextraction.worker.test.ts`(5.4)、eventの`payments-module.worker.test.ts`・`payments-lifecycle-handlers.worker.test.ts`・`identity-module.worker.test.ts`(6.2)、`audit-actions/index.unit.test.ts`(1.1)、`settings-nav-order.unit.test.ts`(7.4)、`admin-nav-order.unit.test.ts`・`admin-shell.browser.test.tsx`(8.2)、apiの`bun run graphql:generate`による`schema.graphql`・`resolvers-types.ts`の再生成(5.1)、`apps/db/schema/index.unit.test.ts`(1.2)と`codegen.unit.test.ts`(7.1)への追記。
- apiとeventの`composition/ultras-module.worker.test.ts`で`ULTRAS_TYPES`の各識別子を解決する検査(4.5。汎用のDIの解決の検査はUltrasのクラスを解決しないため)。
- `docs/onboardings/project-values.md`の`lookup_key`の値と登録の一覧(Modified Files、タスク9.1)。
- 4:21の全ジョブが合計300秒の予算を共有すること(5.4)、`CheckoutStarter`の回数制限が`describe`の前に消費されること(Allowed Dependencies、5.1)、最終確認画面の追加事項の4行を互いに異なる文言にすること(4.2)、業務日付の日の終わりを`core/time`の関数の組み合わせで作ること(2.1)。
- `operations/004`は、paymentsが書いた「価格」「Customer Portal」「制限付きキーの権限」の節へ追記し、「定期課金」の節を加える形に改めた(Modified Files、タスク1.4)。`legal/004`の停止の行は直っているため確かめるだけにした(Modified Files、タスク9.2)。`features/005`にStripe側の`canceled`と加入状態の対応表を載せる(9.2)。
- 小さな食い違いの表のうち、`MoneyText`の置き場所と形、paymentsの追加の前提が実装済みであること、Existing Architecture Analysisの上流の実装の状況、apiの識別子のファイル名(`ultras-types.ts`)とエラーコードの置き場所(`ultras-errors.ts`)、ポートのファイル(`portal-ports.ts`・`ultras-account-data-eraser.ts`)、メールの種別の1ファイル(`kinds/ultras.ts`、`category: 'transactional'`)と本文の名前(`*-email-body.tsx`)、`buildSitePageHead`・`buildAdminPageHead`と`/settings/plan`の`noIndex`、`buildAuditLogStatements`の置き場所、`UnavailableNotice`の`reason`、スイッチの有効・無効の`hasRole`、`ultras_activations`の索引への`created_at`の追加、E2Eの確認済みの利用者の作成(`account-steps.ts`)。
- requirements.mdのIntroductionの範囲にFR-ADMCF-023を加えた。決定の表のQ2の「FR-PPLAN-008に返金しない旨を注記する改訂が要る」は、要件フェーズの記録として残す(改訂の後はFR-PPLAN-009)。
- 上の「実装前のギャップ分析」の誤りを、分析の本文で直した(2026-11-06): 小さな食い違いの表のrequirements.mdの行(Introductionは既にFR-PPLAN-001〜013を参照しており、欠けていたのはFR-ADMCF-023だけ)、規則と衝突する設計の6(`DASHBOARD_CARDS`は`title`を持たず、`title`による見出しの補いは`CATEGORY_SECTIONS`だけの前例)、完全一致のテストの表の`search-module.reextraction.worker.test.ts`の行の範囲(壊れるのは201行以降の日次の要約の`jobs`)。決定と設計の中身は変わらない。

### 反映しなかった項目

- Research Neededの5項目(柔軟な請求モードの`cancel_at`、再試行の後の通知の順序、CIのE2Eでの加入の経路、`UltrasPromotionGate`による価格の照会の回数、4:21の所要時間)は、タスク10.1・10.2の検証と実装の中で確かめる。CIのE2Eでの加入の経路は、8の続きの決定によりpaymentsと同じ条件で動かすため、Stripeのキーが注入されるCIでは加入の経路が走る。
