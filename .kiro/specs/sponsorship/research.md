# Research & Design Decisions

## Summary

- **Feature**: `sponsorship`
- **Discovery Scope**: Complex Integration(広告の実装は無い。上流の20spec(dev-tooling〜notifications)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはpaymentsの購入種別の口・`CheckoutStarter`・`PriceCatalog`、ultras-subscriptionの`PRICING_SECTIONS`、match-engineの`TOP_PAGE_SECTIONS`・`QUALIFIER_LIST_INSERTS`、directory-discoveryの`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`・`PRODUCT_PAGE_SECTIONS`、product-launchの`ProductDirectory`・`LaunchExport`・`ProductExport`・`visibleProducts()`・ライフサイクルの登録口・`PRODUCT_DELETE_NOTICES`、identity-authのライフサイクルの登録口・`UserContactDirectory`・`SETTINGS_NAV_ITEMS`、admin-foundationの`requireAdmin`・監査ログ・`ADMIN_NAV_ITEMS`、email-deliveryの`EmailSender`の上に、申込・掲載権・広告スペース・通知・強制終了を足す)
- **Key Findings**:
  - ページ配置(`docs/GUIDES/service/design/002-page-layouts.md`)の「スポンサー広告スペース」が、roadmapの論点のうち掲載枠の上限の答えを既に書いている(「申し込まれた広告は枚数上限を設けず全て表示する」)。ただしroadmapが要件フェーズでの確認を求めているため、仮1として記録した(directory-discoveryの仮1・仮2と同じ扱い)。
  - 要件定義書は強制終了の返金を「返金目安額の表示」(FR-ADMUG-024)までとし、FR-PYMNT-005は「Stripeのダッシュボード上で管理者が手動実行した返金処理」をFR-ADMUG-023に対応付けている。自動の返金はFR-PYMNT-009・012だけである(FR-PYMNT-010)。一方、法的通知の大枠の返金ポリシーは強制終了・表示停止を「自動で返金する」と書く(仮3)。ultras-subscriptionは同じ種類の食い違い(停止に伴う返金)を要件定義書どおりに決め、返金ポリシーの行を直した。2026-10-24に開発者は仮3で自動の日割りの返金(選択肢B)を選んだ。
  - FR-SPONS-006はディレクトリに広告スペースを挙げるが、ページ配置のディレクトリの節は「スポンサー広告は表示しない」と書く。directory-discoveryは仮3で登録口だけを設け、表示するかどうかを本specに委ねた(仮4)。
  - 広告の開始・終了・強制終了の通知は、notificationsの配信停止の対象(FR-NOTIF-001〜004)に当たらない取引上の通知である(準拠方針の「通知メールのオプトアウト」)。notificationsは非目標に「トランザクションメール」を挙げ、通知イベントの契約をトーナメントの通知に限っている。本specはemail-deliveryの`EmailSender`で直接送る。
  - 表示の条件(決済済み・期間内・強制終了でない・プロダクトが可視)は、product-launchが後続specに許す`visibleProducts()`の絞り込みと本specのテーブルで、表示の時点に1回の問い合わせで判定できる。非公開化・停止・復元・停止の解除のたびに状態を直す処理は要らない。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を推奨として示した。**仮1〜仮6は2026-10-24に開発者が確定した(仮3は推奨と異なる選択肢B、他は推奨どおり)。** 決定は`requirements.md`の「要件フェーズでの決定」にも記録する。roadmapの「Requirement Ambiguities」の表のうち、「スポンサー広告のティア別・日別の掲載枠上限、0:07以降の当日開始申込の開始通知」の行(sponsorshipの担当)は仮1・仮2で、「停止・非公開化・強制終了に伴う返金を自動で行うか」の行(ugc-moderation・sponsorship・tournament-week・tournament-yearの共同の担当)の広告の部分は仮3で決めた。roadmapは編集せず、解決の列の文言をコントローラーへ報告する。

| #   | 論点                                             | 根拠                                                                                                                                                                                                                                                                                                                                                                         | 選択肢                                                                                                                                                                                                                                                                                                                                                                                                  | 推奨                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | ティアごと・日ごとの掲載枠の上限                 | FR-SPONS-002〜006(上限を定めない)、ページ配置の「スポンサー広告スペース」(「枚数上限を設けず全て表示する」)、roadmapのRequirement Ambiguities                                                                                                                                                                                                                                | (A)上限を設けず、表示の条件を満たす全件をティアごとに表示する / (B)ティア・日ごとに上限N件を設け、満枠の日は申し込めないようにする                                                                                                                                                                                                                                                                      | 推奨は(A)。ページ配置に一致し、Legendのグリッド・Goldの列とモバイルの挿入・Silverの折り返しは、いずれも件数によらず全件を並べる配置として定められている。(B)は上限の値が要件・サービス仕様のどこにも無く、満枠の判定のための枠の確保(未決済の間の仮押さえと失効)が要り、決済の反映の時点の満枠を拒否として返金する経路も増える                                                                                                                                                                                                                                                                                                               |
| 仮2 | 当日の0:07以降に決済した当日開始の広告の開始通知 | FR-SPONS-013(毎日0:07に当日開始の広告へ送る)、FR-SPONS-003(今日を開始日に選べる)、paymentsの購入確認メール(役務の提供時期を含む)、roadmapのRequirement Ambiguities                                                                                                                                                                                                           | (A)決済の反映の直後に開始通知を送る / (B)送らない(paymentsの購入確認メールで代える) / (C)翌日の0:07に送る                                                                                                                                                                                                                                                                                               | 推奨は(A)。全ての広告が開始通知を1回受け取り、FR-SPONS-013の目的(掲載が始まったことを知らせる)に合う。0:07の処理と同じ依頼待ちの記録と送信の処理を使うため、仕組みが増えない。(B)は当日の申込だけ開始通知が届かず、(C)は掲載が始まって1日後に「始まりました」と届き、1日だけの広告では終了通知と同じ時刻になる                                                                                                                                                                                                                                                                                                                               |
| 仮3 | 強制終了・表示停止に伴う返金を自動で行うか       | FR-ADMUG-024(返金目安額の自動算出と表示)、FR-PYMNT-005(管理者がダッシュボードで手動実行した返金をFR-ADMUG-023に対応付ける)、FR-PYMNT-010(自動の返金はFR-PYMNT-009・012)、FR-SPONS-016(表示停止に返金の定めが無い)、法的通知の大枠の返金ポリシー(強制終了は未掲載日数分、表示停止は停止日数分を「自動で返金する」)、briefのConstraints、paymentsのQ1、ultras-subscriptionのQ3 | (A)強制終了は返金目安額の表示までとし、返金は管理者がStripeのダッシュボードで手動で行う。表示停止は返金しない。返金ポリシーの広告の2行を改める / (B)強制終了は未掲載日数分を、表示停止は停止した日数分を、paymentsの`PaymentRefunds`(金額指定)で自動で返金する。要件定義書(FR-ADMUG-024・FR-PYMNT-005・010・FR-SPONS-016)の改訂が要る / (C)強制終了だけ未掲載日数分を自動で返金し、表示停止は返金しない | 推奨は(A)。要件定義書(SSoT)の3つの要件(FR-ADMUG-024・FR-PYMNT-005・010)が手動の返金で一貫し、briefの従来の前提とも合う。ultras-subscriptionも同じ食い違い(停止に伴うUltrasの返金)を要件定義書どおりに決め、返金ポリシーの行を直した。表示停止は利用者の規約違反の結果で、FR-SPONS-016は表示を止めることだけを定める。返金が必要な場合は、管理者が強制終了して返金目安額に基づき手動で返金できる。(B)・(C)を選んだ場合は、強制終了の確定の後に`PaymentRefunds.request`(金額は返金目安額、依頼キー`sponsorship-termination:<申込ID>`、理由`sponsorship_terminated`)を呼ぶ処理と、表示停止の日数を数える記録を足す(設計のRevalidation Triggers) |
| 仮4 | ディレクトリページの広告スペース                 | FR-SPONS-006(トップ・ディレクトリ・詳細の広告スペース)、ページ配置のディレクトリ(「スポンサー広告は表示しない」)、directory-discoveryの仮3(登録口を設け、表示の有無を本specに委ねる)、brief                                                                                                                                                                                  | (A)要件定義書を正とし、ディレクトリにも3ティアを表示する。ページ配置の記述を改める / (B)ページ配置を正とし、ディレクトリには表示しない。FR-SPONS-006の改訂が要る                                                                                                                                                                                                                                        | 推奨は(A)。要件定義書がSSoTで、briefとdirectory-discoveryの仮3も表示する前提で登録口を用意した。Goldのモバイルの挿入もトップページの予選の一覧と同じ形(一覧の2件ごと)で、directory-discoveryの`DIRECTORY_LIST_INSERTS`がその形を持つ。ディレクトリは「読み物として静止させる」ページのため、広告も演出を持たない静止した表示にする                                                                                                                                                                                                                                                                                                           |
| 仮5 | 同じプロダクト・同じティアで掲載期間が重なる申込 | FR-SPONS-001〜007(重なりを定めない)、FR-SPONS-007(同一ティア内の並び)、ページ配置(全件を表示)                                                                                                                                                                                                                                                                                | (A)決済済みで終了・強制終了していない同じプロダクト・同じティアの広告と1日でも重なる申込を受け付けず、決済の反映の時点で重なれば権利を付与しない(paymentsが全額を自動で返金する) / (B)受け付けて、表示で同じプロダクトを1件にまとめる / (C)受け付けて、重ねて表示する                                                                                                                                   | 推奨は(A)。同じティアの中に同じプロダクトが2枚並ぶ表示((C))や、支払った2件のうち1件分しか表示されない状態((B))を作らない。延長したい場合は重ならない期間で申し込める。異なるティアの重なりは目立ち度の組み合わせとして許す。未決済の申込は重なりの判定に含めない(放置された申込で他の申込を妨げない)                                                                                                                                                                                                                                                                                                                                         |
| 仮6 | 掲載期間の長さと開始日の上限                     | FR-SPONS-003(今日以降を1日単位、上限を定めない)、paymentsの`PurchaseOffer.quantity`(1〜366の整数)、FR-PYMNT-002(日数を数量として指定)                                                                                                                                                                                                                                        | (A)掲載期間を1〜366日、開始日を今日から365日後までとする / (B)掲載期間を1〜366日、開始日の上限を設けない / (C)掲載期間を1〜90日、開始日を今日から90日後までとする                                                                                                                                                                                                                                       | 推奨は(A)。期間の上限はpaymentsの数量の上限(366)に合わせる必要がある。開始日の上限を設けないと、何年も先の広告が決済済みのまま残り、価格の改定や返金ポリシーの改訂の影響を長く受ける。1年先までなら年単位の出稿の計画に足りる。(C)は要件に無い制限を強める                                                                                                                                                                                                                                                                                                                                                                                   |

### 開発者の確定(2026-10-24)

- 仮1・仮2・仮4・仮5・仮6: 推奨どおり確定(仮4はdirectory-discoveryの仮3と同じく確定)。
- 仮3: **推奨と異なる選択肢Bで確定。** 強制終了は未掲載日数分を、表示停止(ユーザー停止・プロダクト非公開化)は表示を止めた日数分を、paymentsの`PaymentRefunds`で金額を指定して日割りで自動的に返金する。要件定義書FR-ADMUG-024・FR-PYMNT-005・FR-PYMNT-010・FR-SPONS-016の改訂が要る(「要件定義書の改訂が必要な箇所」)。法的通知の大枠の返金ポリシーの広告の行もこれに合わせる(タスク1.4)。返金の時機と表示停止日数の数え方は「Decision: 強制終了と表示停止を日割りで自動で返金する(仮3)」で決めた。ugc-moderationの仮8(推奨どおり)により、ugc-moderationは返金を依頼せず、停止・非公開化の通知で本specの扱いを伝える(「上流・後続specへの影響」の文面)。
- 本specに確認待ちの論点は無い。

### 確認済みのため質問しない事項

- 「過去にローンチしたプロダクト」(FR-SPONS-001): キックオフ(ローンチ日の0:00)を迎え、取り消されていないローンチを1回以上持つプロダクトとする。product-launchの`LaunchStatus`の`in_progress`・`finished`に当たり、勝敗を問わない。予選マッチ中のプロダクトも含む(ローンチ日を迎えている)。非公開化・論理削除されたプロダクトは、FR-SPONS-016により表示できないため申込の対象から外す。
- 掲載期間の区切り: 基準時刻(UTC-08:00)の日付で、開始日の0:00から終了日の翌日0:00までを掲載期間とする(日次タイムラインの「スポンサー広告の掲載期間: 基準時刻の日単位」)。表示停止の間も掲載期間は延長しない(FR-SPONS-005は選んだ期間の表示を定める)。
- 価格: ティアごとの1日あたりの単価をStripeの価格(`lookup_key`)で持ち、paymentsの`PriceCatalog`で照会する(FR-PYMNT-002、要件定義書4.15の前書き「掲載プランの価格はStripeのダッシュボード上で設定する」)。料金とプランの$3・$8・$20は参考価格で、画面の値はStripeの設定を正とする。
- 決済の受付の有効期限: paymentsの仮4により、決済期限の無い購入の決済セッションは作成から1時間で失効する。本specは決済期限を持たず、反映の期限を掲載開始日の翌日0:00とする(それ以降に確定した決済はpaymentsが反映の期限切れとして全額を返金する)。
- bot判定(FR-SPONS-012): 申込の記録の前に本specのGraphQLの変更操作で`assertHuman('sponsorship_apply')`を呼ぶ。bot判定のトークンは1回しか使えないため、`PurchaseOffer.requiresBotVerification`は偽にする(paymentsの申し送りの「FR-SPONS-012に従う」を、本specが先に検証する形で満たす)。未決済の申込の決済の再開も申込の操作として同じ検証を行う。
- 広告ラベルの文言: ページ配置の「スポンサー」をティアの色で表示する。モックアップの`sponsor-ads.tsx`はLegendを「レジェンドスポンサー」としているが、ページ配置が広告ラベルの文言を明示しているためそれに従う。
- ロゴの画像バリアント: ページ配置はLegend・Goldを`square-md`、Silverを`square-sm`と書き、画像バリアントの文書はLegend・Goldの1xを`square-sm`、Silverの1xを`square-xs`と書く。両者は表示の大きさ(Legend・GoldはCSSの64px、Silverは32px)の2xと1xを指しており食い違わない。media-pipelineの`MediaPicture`に表示の大きさを渡して出し分ける。
- 無作為の並び(FR-SPONS-007): モックアップはマウントの後に並べ替えるが、それでは初回の表示の後に並びが変わる。本specはサーバーが照会のたびに並べ替えた結果を返し、サーバーの描画とクライアントの復元が同じ順を使う。
- 外部Webサイトへのリンクの`rel`: ページ配置の「外部Webサイトへのリンク」により`noopener`とFR-SPONS-009の`sponsored`を付ける。
- 広告の計測: 準拠方針は広告トラッキングとリターゲティングを行わないとする。本specは表示回数・クリックを記録しない。
- 開始・終了・強制終了の通知メール: 取引上の通知で、配信停止のリンクと送信者情報の区画を持たない(準拠方針の「通知メールのオプトアウト」の対象外)。件名は文言規則の通知メールの件名の表を使う。宛先はidentity-authの`UserContactDirectory`で引く(briefのConstraints)。
- 強制終了の通知メールの理由: FR-ADMUG-023の「理由付きで…メール通知」と、FR-ADMUG-019(停止・非公開化の通知に理由を含める)の形に合わせ、管理者が入力した理由を本文に含める。理由は監査ログにも記録され、個人情報を含めない旨を入力欄に示す(admin-foundationの`ReasonField`)。
- 管理画面の権限: admin-foundationのQ3により、一覧は全ロール(閲覧のみ以上)、強制終了はモデレーター以上とする。メニューのURLと`order`はadmin-foundationの仮6の`/sponsorships`・90。
- 料金ページの区画: ultras-subscriptionの`PRICING_SECTIONS`に`{ id: 'sponsorship.sponsorship-pricing', order: 20 }`で登録する(brief)。ultras-subscriptionのQ5によりページ自体は機能フラグにかかわらず表示され、Ultrasの区画だけが出し分けられる。
- 退会時の扱い(FR-USER-018): 申込を論理削除し、物理削除の時期(DR-002)に消す。決済履歴はpaymentsが仮名化IDで7年保持する(DR-013)。
- 投稿者によるプロダクトの削除・退会に伴う掲載の終了は返金しない(返金ポリシーの既存の行)。削除の確認の画面にその旨を表示する(ページ配置の「プロダクト登録・編集」)。
- 返金・チャージバックを受け取っても掲載権を変えない(FR-PYMNT-007)。
- 波及処理と定期の処理の`order`: 本specの1600番台(roadmapの帯の割り当て)。4:21のジョブと波及処理は上流の値の後に動いてよく、上流より前に動く必要のある処理は無い。0:07のジョブは他のspecが登録していない時刻で、同じ1600を使う。
- 新しいパッケージ: 無い。日付の入力はブラウザの日付入力欄(directory-discoveryと同じ)、価格の表示はpaymentsの`MoneyText`、画像は`MediaPicture`を使う。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(directory-discoveryと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(決済フルフィルメント・画面シェル・プロダクトライフサイクルイベント・ユーザーライフサイクルイベント・可視性フィルタ・利用者の連絡先の照会・データエクスポートの出力・監査ログ・Cron・Queuesのディスパッチ)。
- **Sources Consulted**: payments・ultras-subscription・match-engine・directory-discovery・product-launch・identity-auth・admin-foundation・email-delivery・notifications・backend-platform・api-gateway・frontend-platform・user-profile-social・media-pipelineの`design.md`、payments・ultras-subscription・match-engine・directory-discovery・admin-foundationの`research.md`の後続specへの申し送り、ugc-moderation・data-export・tournament-weekのbrief、サービス仕様(ページ配置・文言規則・料金とプラン・日次タイムライン・法的通知の大枠・利用規約の大枠・準拠方針・データエクスポート・画像バリアント・デザイン原則)、モックアップ`mockups/src/components/client/sponsor-ads.tsx`・`routes/client/top`。
- **Findings**:
  - payments: `PurchaseOfferPolicy.describe({ userId, targetId, now })`が`PurchaseOffer`(`priceLookupKey`・`quantity` 1〜366・`relatedId`・`exclusivityKey`・`deadlineAt`・`acceptUntil`・`fulfillableUntil`・`summary`・`requiresBotVerification`)を返し、`PurchaseFulfillment.prepare(purchase, db)`は副作用なしにD1の文か`reject`(`ineligible`)を返す。文が制約で失敗したら`prepare`を1回呼び直す。`afterCommit`は確定させた側だけが1回呼ぶ。`exclusivityKey`は`fulfilled`の購入の部分一意索引で二重決済を拒否する。`decideCompletion`は`fulfillableUntil`を過ぎた確定を`late`で拒否する。決済期限の無い購入の決済セッションは1時間で失効する(仮4)。申し送りに「sponsorshipは申込の行を作った後に`CheckoutStarter.start`を呼び、数量=掲載日数、`requiresBotVerification`はFR-SPONS-012に従う。強制終了・表示停止の返金を自動にするかは判断し、自動なら`PaymentRefunds`(金額指定)を使う」とある。決済後のランディングは広告の購入に`/settings/sponsorships`への導線を出す。
  - ultras-subscription: `PRICING_SECTIONS`(`{ id, order, component: ComponentType }`)。ページは機能フラグにかかわらず表示され、Ultrasの区画だけが出し分けられる(Q5)。申し送りに「料金ページの区画を`order` 20で登録し、返金ポリシーの広告の2行の扱いを判断する」とある。
  - match-engine: `TOP_PAGE_SECTIONS`(`banner`・`showcase`・`main`・`aside`・`bottom`、文脈は`board`と`viewer.signedIn`)・`QUALIFIER_LIST_INSERTS`(`every`と`position`)。申し送りに「sponsorshipは`banner`(Legend)・`aside`(Gold)・`bottom`(Silver)と`QUALIFIER_LIST_INSERTS`(モバイルのGold、2件ごと)に登録する」とある。`banner`は画面幅で1〜4列のグリッドの行で、カウントダウン(10)が先にある。
  - directory-discovery: `DIRECTORY_PAGE_SECTIONS`(`banner`・`aside`・`bottom`、文脈は`viewer.signedIn`と`query`)・`DIRECTORY_LIST_INSERTS`(`every`と`position`)・`PRODUCT_PAGE_SECTIONS`(予約: 広告は`banner`・`aside`の30・`bottom`の20)。仮3で「ディレクトリに広告を表示するかどうかと中身はsponsorshipが決める(初版は何も登録しない)」。
  - product-launch: `ProductDirectory.findSummaries(ids, 'visible'|'not-deleted')`(論理削除済みは返さない)・`resolveHandle`・`listLaunches`、`LaunchExport.listByUser(userId, now)`(利用者のローンチ、状態つき)・`ProductExport.listByUser(userId)`(論理削除済みを含む)、`visibleProducts()`(`users`との結合が前提)、`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`(`purge_due`は各処理が自分の行を消した後に本体が消す)、`PRODUCT_DELETE_NOTICES`(`{ id, order, component: ComponentType<{ productHandle }> }`、tournament-week・tournament-year・sponsorshipが追記)。後続specが本specのテーブルを結合してよいのは`visibleProducts()`などの絞り込みと`products.id`・`products.category_id`だけ。`PRODUCT_SAVE_HOOKS`(仮11)は本specに関係しない(広告の表示は表示の時点のプロダクトの名称を読むため、保存を知る必要が無い)。
  - identity-auth: `USER_LIFECYCLE_SYNC_HANDLERS`(`withdrawn`・`suspended`・`unsuspended`、集合の更新の文だけ)・`USER_LIFECYCLE_ASYNC_HANDLERS`(`purge_due`、`order`)・`UserContactDirectory.findContact`(退会済み・物理削除済みは`undefined`、停止中は返す)・`AccountGuard`(`requireVerifiedUser`は停止中を`account_unavailable`、未確認を`email_not_verified`で拒否)・`SETTINGS_NAV_ITEMS`(sponsorshipsは80)。
  - admin-foundation: `requireAdmin(context, role)`、`AuditLogRecorder.prepare`と`buildAuditLogStatements`(操作と同じ一括の書き込みに含める)、`AuditTargetKind`に`sponsorship`がある、`ADMIN_NAV_ITEMS`の`/sponsorships`は90、Q3(閲覧のみは参照だけ、モデレーターは最上位管理者に限られない更新)。
  - email-delivery・notifications: `EmailSender.send`は`email.send`をQueueへ送り、eventのconsumerが描画して送る。種別は`transactional`と`notification`。notificationsは非目標に「トランザクションメール」を挙げ、契約は通知の4種類とトーナメントの通知イベントに限る。
  - backend-platform: `ScheduledJobDefinition`(`at`・`order`)・`createCronRegistry`(同じ時刻の`order`の重複を拒否)・Cronの式とWranglerの`triggers.crons`の一致の検査。Cron TriggersはWorkers Paidでアカウントあたり250個。`MessageHandlingResult`は`done`と`defer`。
- **Implications**: 上流のファイルの変更は、契約で定められた登録箇所への追記だけにする。上流specの改訂は要らない。

### 表示の条件と写しの要否

- **Context**: 要件4、FR-SPONS-016、NFR-PERF-003・004、product-launchの結合の規則。
- **Findings**:
  - 表示の条件のうちプロダクト側(非公開化・論理削除・投稿者の退会と停止)は`visibleProducts()`がまとめて表し、`sponsorships`と`products`・`users`を結合した絞り込みに使ってよい。期間と強制終了は本specの列で判定できる。
  - 表示の時点に1回の問い合わせで判定すれば、非公開化・復元・停止・停止の解除のたびに状態を直すライフサイクルの処理が要らず、解除の後の再表示(4.3)も自然に満たす。
  - 自分の一覧の「表示停止中」は、`findSummaries(ids, 'not-deleted')`の`visible`で判定できる(論理削除済みは返らないため「削除したプロダクト」と区別できる)。
- **Implications**: `PlacementReader`の1回の問い合わせと`findSummaries`だけで広告を得る。表示の判定のための写しや非公開化・停止・復元の波及処理は持たない。表示停止の区間の記録だけを、同期の処理として確定と同じ書き込みで行う(仮3)。

### 無作為の並びとモバイルのGold

- **Context**: FR-SPONS-007、ページ配置(モバイルのGoldは2件ごとの挿入と余り)、モックアップ(マウントの後に並べ替え)、briefのConstraints(SSRで初期表示)。
- **Findings**:
  - モックアップのようにマウントの後に並べ替えると、サーバーの描画とクライアントの復元が一致したまま、表示の直後に並びが変わる。サーバーが照会のたびに並べ替えて返せば、サーバーの描画とクライアントの復元が同じ順になり、ページの表示ごとに順が変わる。
  - 1ページの全ての区画が同じTanStack Queryのキーで同じ照会の結果を使えば、挿入と余りの順がそろう。
  - 余りの数は描画された差し込みの数で決まるが、差し込みの数は上流の一覧の件数で決まり、区画の文脈に無い。差し込みの部品が復元の後に数を共有の小さな仕組みに登録し、余りの部分だけを復元の後に描けば、上流の契約を変えずに済む。余りは一覧の下にあるため、後から描いても上の内容の位置は動かない。
- **Implications**: `PlacementReader`のサーバーの並べ替え、`useSponsoredPlacements`の共有の照会、`GoldInsertTracker`を設ける。

### 通知の経路

- **Context**: FR-SPONS-013〜015、仮2、準拠方針の通知メールのオプトアウト、notificationsの非目標。
- **Findings**:
  - 開始・終了・強制終了の通知は取引上の通知で、配信停止の対象外である。notificationsの契約(受信設定・送信枠・配信停止)を通す理由が無い。
  - 0:07のジョブ・決済の確定(仮2)・強制終了・4:21の送り直しの4つの契機があり、依頼待ちの状態を行に持てば、同じ送信の処理で1回だけ送れる。paymentsの購入確認メールの依頼と同じ形である。
  - 0:07のジョブの更新と、0:07の直前の決済の確定が同時に確定すると、開始通知が`none`のまま残り得る。4:21のジョブで同じ条件の更新を行えば当日中に拾える。
- **Implications**: `NoticeScheduler`・`NoticeRequester`・`NoticeDispatchHandler`を設け、email-deliveryの`EmailSender`で直接送る。

### 申込の対象のプロダクトの照会

- **Context**: FR-SPONS-001、product-launchの公開の契約。
- **Findings**:
  - `ProductDirectory`には利用者のプロダクトの一覧の口が無い。`LaunchExport.listByUser(userId, now)`は`workers/product`の公開の契約で、利用者のローンチを状態つきで返す。キックオフ済み(`in_progress`・`finished`)のローンチのプロダクトのIDを集め、`findSummaries(ids, 'visible')`で可視のものに絞れば、`products`を直接読まずに申込の対象を得られる。
  - 1件の判定は`findSummaries([id], 'visible')`と`listLaunches([id], now)`で足りる。
- **Implications**: `EligibleProductReader`はproduct-launchの公開の部品だけを使う。上流の改訂は要らない。

### 強制終了と返金目安額

- **Context**: FR-ADMUG-023・024、FR-ADMAG-001、仮3、返金ポリシーの未掲載日数の定義。
- **Findings**:
  - 返金ポリシーは未掲載日数を「強制終了日と掲載開始日の遅い方から、掲載終了日までの日数」と定める(強制終了日を含む)。返金目安額はStripeの金額(税込の合計)から日割りで求め、セント未満を切り捨てる。
  - 監査ログは`buildAuditLogStatements`で操作と同じ一括の書き込みに含める規約である。詳細の値は100文字以内で個人情報を含めない(未掲載日数と返金目安額は該当しない)。
  - (開発者の確定の前の調査)管理者が手動で返金するには、Stripeのダッシュボードで決済を探す手がかりが要る。仮3の確定(自動の返金)の後も、依頼できなかった返金の運用の手がかりとして購入IDを示す。paymentsは決済セッションと支払いの`metadata`に`purchase_id`を付けるため、購入IDで探せる。
- **Implications**: `computeUnexposedDays`・`computeRefundEstimate`、`D1TerminationWriter`、強制終了の結果に購入IDを返す。

## Architecture Pattern Evaluation

| Option                                         | Description                                                     | Strengths                                                                                                     | Risks / Limitations                                                           | Notes  |
| ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| 表示の時点の問い合わせ(採用)                   | `sponsorships`と`visibleProducts()`の結合で表示の条件を毎回判定 | 表示の判定のための非公開化・停止・復元の処理が要らない(表示停止の区間の記録は仮3で行う)、写しの食い違いが無い | ページの表示ごとにD1を読む                                                    | —      |
| 表示中の広告の写しを持つ                       | ライフサイクルイベントで表示の可否の列を更新                    | 読み取りが単純                                                                                                | 非公開化・復元・停止・停止の解除・退会・削除の6つの処理と食い違いの修復が要る | 不採用 |
| 通知をnotificationsの通知イベントで送る        | 通知イベントを発行し、送信枠に乗せる                            | 送信の仕組みを共有                                                                                            | 配信停止・受信設定の対象外の取引上の通知で、notificationsの契約の外           | 不採用 |
| 申込の行を作らず決済の対象に申込の内容を埋める | `targetId`にプロダクト・ティア・期間を符号化                    | 未決済の行が残らない                                                                                          | 自分の一覧・データエクスポートの`pending_payment`・決済の再開が表せない       | 不採用 |
| 枠の在庫と仮押さえ                             | ティア・日ごとの上限と未決済の間の確保                          | 露出の上限を保証                                                                                              | 仮1で上限を設けないため不要                                                   | 不採用 |

## Design Decisions

### Decision: 申込を未決済の行として作り、決済の口で掲載権を確定する

- **Context**: 要件2・3、paymentsの申し送り、データエクスポートの`pending_payment`。
- **Alternatives Considered**:
  1. 申込の行を作ってから`CheckoutStarter.start`を呼び、`describe`と`prepare`で行を読み直す
  2. 決済の確定の時点に初めて行を作る
- **Selected Approach**: 1。`describe`は数量・反映の期限・`exclusivityKey`を行から決め、`prepare`は条件付きの前進の文(重なりと論理削除の条件をCASEに含める)を返す。
- **Rationale**: 自分の一覧の未決済と決済の再開、データエクスポートの`pending_payment`を表せる。条件付きの前進により、確定の時点の競合でもpaymentsの拒否と自動返金に落ちる。
- **Trade-offs**: 決済されない行が残るため、開始日を過ぎた未決済を4:21に消す。

### Decision: 表示の条件を表示の時点に1回の問い合わせで判定する

- **Context**: 要件4、FR-SPONS-016。
- **Selected Approach**: `PlacementReader`が`state = 'paid'`・論理削除なし・期間内・`visibleProducts()`で絞り、`findSummaries`で表示の情報を読み、ティアごとに並べ替える。
- **Rationale**: 写しを持たないため、非公開化・停止・復元・停止の解除が次の表示に即座に反映され、表示の判定のための波及処理が要らない(表示停止の返金のための区間の記録は別に行う、仮3)。
- **Trade-offs**: ページの表示ごとにD1を読む。索引の範囲の読み取りで、件数の多い日でもNFR-PERF-003の内に収まる見込み(Risks)。

### Decision: 通知を依頼待ちの列と1つの送信の処理で送る

- **Context**: 要件8、仮2、FR-SPONS-015。
- **Selected Approach**: 行に3つの通知の状態を持ち、0:07のジョブ・決済の確定・強制終了・4:21のジョブが依頼待ちにして`sponsorship.dispatch-notices`を送り、eventの処理が条件付きの更新で1件ずつ取ってから送る。
- **Rationale**: 依頼待ちの記録と確定が同時で、送信の依頼が失われても4:21に拾える。同時の処理でも重ねて送らない。
- **Trade-offs**: 取った後の送信の依頼が失敗すると依頼待ちへ戻すため、極めて稀にEmail送信の基盤の側で重複し得る(email-deliveryの再送の範囲)。

### Decision: 強制終了と表示停止を日割りで自動で返金する(仮3)

- **Context**: 要件10・14、FR-ADMUG-024・FR-SPONS-016、返金ポリシー、2026-10-24の開発者の回答(仮3は選択肢B)、paymentsの`PaymentRefunds`(全額・一部の金額を指定した非同期の依頼、依頼キーごとに1回、返金できる残りを超える金額の拒否、`reflection:`の依頼だけに送る自動返金の通知、物理削除の後の`purchase_not_found`)。
- **Alternatives Considered**(返金の時機):
  1. 掲載の終わり(掲載終了日の翌日の0:07、強制終了ではその確定)に、広告ごとに表示停止日数を1回だけ数えて依頼する
  2. 非公開化の取り消し・停止の解除のたびに、その区間の日数分を依頼し、掲載の終わりに継続中の区間を締めて依頼する
- **Selected Approach**: 1。非公開化・停止の区間は確定と同じ書き込みで`sponsorship_display_stops`に記録し、掲載の終わりに`countStoppedDays`(日の一部でも停止した日を数え、重なりは1日)と`computeRefundEstimate`で金額を求め、`PaymentRefunds.prepare`の文を申込の列の更新と同じ一括の書き込みで確定してから`dispatch`する。強制終了は、未掲載日数分(返金目安額)と強制終了日の前日までの表示停止日数分の2つを、強制終了の前進・監査ログと同じ一括の書き込みで依頼する。依頼キーは`sponsorship-termination:<申込ID>`・`sponsorship-display-stop:<申込ID>`、理由は`sponsorship_terminated`・`sponsorship_display_stopped`。0円は依頼しない。返金できる残りを超える拒否では残りの全額で依頼し直し、他の拒否は`failed`とSentryへの通知で処理を止めない。退会・プロダクトの論理削除の広告は返金しない(返金ポリシーの既存の行)。返金の金額は本specの掲載終了通知・強制終了の通知で知らせる。
- **Rationale**: 2の方式は、非公開化と停止が重なる区間・解除されないまま掲載が終わる区間・強制終了と重なる区間で、日の数え重ねと依頼の数が増え、鍵の設計も区間ごとになる。1の方式は広告ごと・種類ごとに鍵が1つで、同じ日を2回返金せず、精算と記録が同じ書き込みで確定するため再実行に強い。返金の時期は掲載の終わりまで遅れるが、掲載期間は最長366日で、返金ポリシーと通知でその旨を示す。
- **Trade-offs**: 表示停止の区間のテーブルと、精算のメッセージの処理(0:07・4:21のジョブが依頼する)が増える。長い掲載期間の途中の停止では返金が掲載の終わりまで待たれる。
- **Follow-up**: 要件定義書の4つの要件の改訂(「要件定義書の改訂が必要な箇所」)。ugc-moderationの停止・非公開化の通知の文面を本specの扱いに合わせる(「上流・後続specへの影響」)。

### Decision: ディレクトリにも広告を表示する(仮4)

- **Context**: FR-SPONS-006、directory-discoveryの仮3。
- **Selected Approach**: ディレクトリの`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`へ、トップページと同じ部品を登録する。ページ配置の「スポンサー広告は表示しない」を改める。
- **Rationale**: 要件定義書(SSoT)とbriefに一致し、部品と登録の形がトップページと同じで追加の仕組みが要らない。

### Decision: 採らなかった案

- 広告のクリックの計測・リダイレクト: 準拠方針が広告トラッキングを行わないとする。リンクは広告主のサイトへ直接向ける。
- 表示停止の返金を解除のたびに依頼する方式: 「Decision: 強制終了と表示停止を日割りで自動で返金する(仮3)」の2。
- 広告の審査の工程(申込を管理者が承認してから掲載): 要件に無く、事後の強制終了(FR-ADMUG-023)で対応する。
- 申込の変更・取り消しの操作: 要件に無い。決済の前は放置で開始日の翌日に消え、決済の後は返金ポリシーの原則(決済完了後の返金なし)に従う。

## Synthesis

- **Generalization**: 開始・終了・強制終了の通知を、「行の依頼待ちの状態を契機ごとに進め、1つの送信の処理が送る」1つの仕組みに一般化した。トップページ・ディレクトリ・プロダクト詳細ページの広告を、ページによらない4つの部品(Legend・Gold・Goldの差し込み・Silver)と1つの共有の照会に一般化し、ページごとの差はGoldの余りの有無だけにした。利用者・管理者・エクスポートの状態を、保存の3つの状態と期間とプロダクトの可否から導く1つの関数に一般化した。
- **Build vs Adopt**: 決済・価格・返金・決済画面(payments)、ページの枠と区画の登録口(match-engine・directory-discovery・ultras-subscription・identity-auth・admin-foundation・product-launch)、プロダクトの照会と可視の条件(product-launch)、メールの送信(email-delivery)、監査ログ(admin-foundation)、bot判定(frontend-platform・api-gateway)を使う。乱数は`crypto.getRandomValues`、日付入力はブラウザの入力欄。新しいパッケージは無い。
- **Simplification**: 表示中の広告の写し、表示の判定のための非公開化・停止・復元の波及処理(表示停止の区間の記録は仮3のために行う)、枠の在庫、クリックの計測、申込の変更の操作を持たない。

## Risks & Mitigations

- 表示の問い合わせをページの表示ごとに行うため、広告の件数とアクセスが増えると読み取りが増える — `sponsorships_display_idx`の範囲の読み取りと`findSummaries`の90件ずつの1回にまとめる。launch-readinessの性能の検証で、1,000件の掲載中の広告の合成データでNFR-PERF-003を確かめ、超えるならCache APIでの短時間の保持(並べ替えは保持の後に行う)を検討する。
- 1024px未満のGoldの余りを復元の後に描くため、JavaScriptが動かない環境では余りが出ない — 1024px以上の列と差し込みはサーバーで描かれ、余りはページの末尾に近い位置にある。技術ドキュメントに制約として書く。
- トップページの`banner`がグリッドの1つのセルとして区画を並べる作りの場合、Legendのグリッドが1セルに収まる — 部品の根元を行の全幅(`col-span-full`)にし、match-engineの描画が変わればRevalidation Triggersで確かめる。
- 0:07のジョブとその直前の決済の確定の競合で開始通知が漏れる — 4:21のジョブで同じ条件の更新を行い当日中に送る。
- 表示停止の返金が掲載の終わりまで依頼されない — 返金ポリシー・決済画面の追加事項・自分の一覧・通知で時機を示す。精算が漏れても4:21のジョブが補い、掲載終了通知は精算の後にだけ送る。
- 返金の依頼が拒否される(残りを超える・購入が無い) — 残りの全額で依頼し直し、それ以外は`failed`とSentryで運営者が対応する。退会・プロダクトの削除の広告は返金しないため、物理削除の後の`purchase_not_found`は通常の流れでは起きない。
- Stripeの価格が3環境に作られていないと申し込めない — Migration Strategyと`docs/onboardings/project-values.md`に価格の`lookup_key`を記録し、開発者の手作業として報告する。
- 技術ドキュメントの番号の重なり — 並行して作成中のengagement・tournament-weekと重ならないよう、空き番号を2つ飛ばした`backend/018`・`frontend/017`を使い、コントローラーへ報告する。

## References

- `docs/GUIDES/service/design/002-page-layouts.md` — スポンサー広告スペース・外部リンクの`rel`・料金ページ・設定・管理画面
- `docs/GUIDES/service/design/003-text-and-copy-rules.md` — 通知メールの件名と本文の構成
- `docs/GUIDES/service/legal/004-legal-notice-outline.md` — 返金ポリシーと未掲載日数の定義
- `docs/GUIDES/service/overview/002-pricing-and-plans.md`・`007-daily-timeline.md` — 価格と0:07の通知
- `docs/GUIDES/service/features/001-user-data-export.md` — `sponsorships.json`
- `mockups/src/components/client/sponsor-ads.tsx`・`mockups/src/routes/client/top` — 広告の部品と配置
- [MDN: rel=sponsored](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel) — 広告のリンクの`rel`
- [Fisher–Yates shuffle](https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle) — 無作為の並べ替え

## 仮決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。2026-10-24に開発者がすべて確定した。仮3は推奨と異なる選択肢Bが選ばれ、要件・設計・タスクを改めた。`requirements.md`の「要件フェーズでの決定」にも同じ行がある。

| #   | 論点                           | 確定した案                                                                                             | 他の選択肢                                                    | 影響する箇所                                                                                                                              |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | 掲載枠の上限                   | 上限なし、全件を表示                                                                                   | ティア・日ごとの上限と満枠                                    | 要件4.5、`PlacementReader`、料金とプラン                                                                                                  |
| 仮2 | 当日0:07以降の決済の開始通知   | 決済の反映の直後に送る                                                                                 | 送らない / 翌日の0:07                                         | 要件8.4、`SponsorshipFulfillment`、`NoticeScheduler`                                                                                      |
| 仮3 | 強制終了・表示停止の返金       | 選択肢Bで確定。強制終了は未掲載日数分、表示停止は停止した日数分を日割りで自動で返金(掲載の終わりに1回) | 目安額の表示までで手動の返金(推奨だった案) / 強制終了だけ自動 | 要件7.4・8.8・10.2・10.5〜10.7・10.11・11.5・要件14、`RefundSettlement`・`DisplayStopStore`・表示停止の同期の処理、返金ポリシー・利用規約 |
| 仮4 | ディレクトリの広告             | 表示する                                                                                               | 表示しない                                                    | 要件5.1・5.4、`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`、ページ配置                                                             |
| 仮5 | 同じプロダクト・ティアの重なり | 決済済みと重なる申込を受け付けず、確定の時点でも拒否                                                   | 表示で1件にまとめる / 重ねて表示                              | 要件1.8・3.2、`hasPaidOverlap`、前進の文の条件                                                                                            |
| 仮6 | 掲載期間と開始日の上限         | 1〜366日、開始日は365日後まで                                                                          | 開始日の上限なし / 90日                                       | 要件1.5〜1.7、`validatePeriod`                                                                                                            |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID            | 内容                                                                                                                                                                                                                                                                         | 根拠         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| FR-SPONS-002      | ティア・日ごとの掲載枠の上限を設けず全件を表示する旨を加える                                                                                                                                                                                                                 | 仮1          |
| FR-SPONS-013      | 当日の0:07以降に決済が確定した当日開始の広告には、確定の直後に開始通知を送る旨を加える                                                                                                                                                                                       | 仮2          |
| FR-ADMUG-024      | 「返金目安額として自動算出し画面に表示しなければならない」を、「未掲載日数分の金額を自動算出して画面に表示し、強制終了と同時に決済機能(FR-PYMNT-010)により自動で返金しなければならない」に改める                                                                             | 仮3          |
| FR-PYMNT-005      | 「Stripeのダッシュボード上で管理者が手動実行した返金処理、及びFR-PYMNT-009・FR-PYMNT-012により自動実行した返金処理」に、「FR-ADMUG-024・FR-SPONS-016により自動実行した返金処理」を加え、対応要件からFR-ADMUG-023(手動の返金)の対応付けを外す                                 | 仮3          |
| FR-PYMNT-010      | 非同期処理の対象の「FR-PYMNT-009・FR-PYMNT-012の返金処理」に「FR-ADMUG-024・FR-SPONS-016の返金処理」を加える                                                                                                                                                                 | 仮3          |
| FR-SPONS-016      | 「その広告を表示してはならない」の後に、「非公開化・停止により表示を止めた日数分(その日の一部でも止めた日を数える)の金額を、掲載期間の終わり(強制終了ではその時点)に日割りで自動で返金しなければならない。論理削除(個別削除・退会)で掲載が終わった場合は返金しない」を加える | 仮3          |
| FR-SPONS-006      | ディレクトリページの広告をページ配置と一致させる(本specはページ配置を改める)                                                                                                                                                                                                 | 仮4          |
| FR-SPONS-001・003 | 同じプロダクト・同じティアの掲載期間の重なりを受け付けない旨と、掲載期間(1〜366日)・開始日(1年以内)の上限を加える                                                                                                                                                            | 仮5・仮6     |
| FR-SPONS-001      | 「過去にローンチした」をキックオフを迎えたローンチを持つプロダクトと明記する                                                                                                                                                                                                 | 確認済み事項 |

## 上流・後続specへの影響

- payments(上流): `PURCHASE_KIND_REGISTRATIONS`に`sponsorship`を足す(契約どおり)。`CheckoutStarter`・`PriceCatalog`を契約どおりに使う。仮3(選択肢B)により`PaymentRefunds.prepare`・`dispatch`を、依頼キー`sponsorship-termination:<申込ID>`・`sponsorship-display-stop:<申込ID>`(`reflection:`で始めない)と理由`sponsorship_terminated`・`sponsorship_display_stopped`で使う。paymentsが既存の`PaymentRefunds`で足りると確認した(2026-10-24)ため、上流の変更は無い。paymentsの自動返金の通知は`reflection:`の依頼だけのため、利用者への返金の知らせは本specのメールが行う。
- ultras-subscription(上流): `PRICING_SECTIONS`に`sponsorship.sponsorship-pricing`(20)を足す(予約どおり)。返金ポリシーの広告の2行は本specが改める(ultras-subscriptionの申し送りへの回答)。
- match-engine(上流): `TOP_PAGE_SECTIONS`の`banner` 5・`aside` 10・`bottom` 10と`QUALIFIER_LIST_INSERTS` 10(2件ごと)に登録する(申し送りどおり)。Legendはカウントダウン(10)より前に置く(ページ配置の「ヘッダー直下」)。
- directory-discovery(上流): `DIRECTORY_PAGE_SECTIONS`の`banner` 10・`aside` 10・`bottom` 10、`DIRECTORY_LIST_INSERTS` 10(2件ごと)、`PRODUCT_PAGE_SECTIONS`の`banner` 10・`aside` 30・`bottom` 20に登録する(仮3の登録口と予約どおり)。仮3の論点(ディレクトリの広告)は本specの仮4で決めた。
- product-launch(上流): `PRODUCT_LIFECYCLE_SYNC_HANDLERS`に`sponsorship.product-deletion`(`deleted`)・`sponsorship.product-display-stop`(`hidden`・`unhidden`)、`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`に`sponsorship.product-purge`(`purge_due`、1600)、`PRODUCT_DELETE_NOTICES`に`sponsorship.active-ads`(30)を足す(契約どおり)。`ProductDirectory`・`LaunchExport`・`ProductExport`・`visibleProducts()`を契約どおりに使う。`PRODUCT_SAVE_HOOKS`(仮11)は使わない。
- identity-auth(上流): `USER_LIFECYCLE_SYNC_HANDLERS`に`sponsorship.account-withdrawal`(`withdrawn`)・`sponsorship.account-display-stop`(`suspended`・`unsuspended`)、`USER_LIFECYCLE_ASYNC_HANDLERS`に`sponsorship.account-purge`(`purge_due`、1600)、`SETTINGS_NAV_ITEMS`に`/settings/sponsorships`(80)を足す(契約どおり)。
- admin-foundation(上流): `audit-actions/sponsorship.ts`(`sponsorship.terminate`)と`ADMIN_NAV_ITEMS`の`/sponsorships`(90)を足す(契約どおり)。
- email-delivery・backend-platform・api-gateway(上流): 3つのメール種別とテンプレート、2つのジョブ・Cronの式`7 8 * * *`・メッセージ種別と処理、スキーマモジュールを足す(契約どおり)。
- notifications(上流): 関係しない。開始・終了の通知は取引上の通知としてemail-deliveryで直接送る。
- ugc-moderation(後続): 非公開化(product-launchの`ProductVisibilityControl`)と停止(identity-auth)を発火すれば、本specの広告は次の表示から消え、解除で戻り、本specが確定と同じ書き込みで表示停止の区間を記録する。返金の論点(roadmapの返金の行)のうち広告の部分は本specの仮3(2026-10-24に選択肢Bで確定)で決めた。ugc-moderationの仮8(推奨どおり確定)により、ugc-moderationは返金を依頼せず、通知のメールで扱いを伝える。広告の部分の文面は次のとおりにする。プロダクトの非公開化の通知: 「このプロダクトのスポンサー広告は、公開を停止している間は表示されません。掲載期間は延長されませんが、表示を停止した日数分(1日のうち一部でも停止した日を含みます)の広告料金を、広告の掲載期間が終わった時点で日割りにより自動で返金します。掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。」 利用者の停止の通知: 「停止中は、あなたのスポンサー広告は表示されません。掲載期間は延長されませんが、表示を停止した日数分(1日のうち一部でも停止した日を含みます)の広告料金を、各広告の掲載期間が終わった時点で日割りにより自動で返金します。掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。」 管理者が広告を強制終了した場合の返金の知らせは本specの強制終了の通知が行う。統計の収益はpaymentsの決済履歴から集計する。
- data-export(後続): `SponsorshipExport.listByUser(userId, now)`を呼んで`sponsorships.json`を作り、本specのテーブルを直接読まない。
- tournament-week・tournament-year(並行・後続): `PRODUCT_DELETE_NOTICES`の`order`は本specが30を使う。重なれば調整する。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は1600、波及処理は1600」(0:07のジョブも1600)。Requirement Ambiguitiesの「スポンサー広告のティア別・日別の掲載枠上限、0:07以降の当日開始申込の開始通知」の行は「sponsorship 仮1・仮2(2026-10-24に開発者が確定)」、「停止・非公開化・強制終了に伴う返金を自動で行うか」の行の広告の部分は「sponsorship 仮3(2026-10-24に開発者が選択肢Bで確定。強制終了は未掲載日数分、停止・非公開化による表示停止は停止した日数分を、paymentsのPaymentRefundsで日割りで自動で返金する)」とする文言を、コントローラーへ報告する。

## 要件のレビュー(2026-10-24)

- 機械的な確認: 13の要件の見出しがすべて数字のIDを持ち、105件の受け入れ基準がすべてEARSの形式(`When`・`If`・`While`・`Where`・`The … shall`)である。技術名は要件定義書の用語(Stripe・`sponsorships.json`の文書名)とサービス仕様の`rel`の値だけに限った。
- 1回目の判断のレビューで、(1)表示停止の定義を用語に足し、自分の一覧(7.4)と強制終了(10.1)の対象を明確にした、(2)決済の確定の時点の再判定(1.10・3.2)と反映の期限(3.3)を分けた、(3)通知の送らない条件を開始(8.6)と終了(8.7)で分けた。2回目で問題は無かった。
- 要件定義書・サービス仕様で決まらない論点は仮1〜仮6として記録し、要件の範囲の推測は加えていない。

## 設計のレビュー(2026-10-24)

- 機械的な確認: 要件の105件の受け入れ基準の番号がすべて設計にあることを、番号の字句の照合で確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある(区画の登録はModified Filesの登録箇所)。
- 1回目の判断のレビューで、(1)プロダクトの論理削除で終わった広告(見せる状態は「終了」)を強制終了できてしまう食い違いを、`isTerminable`にプロダクトの可否を加えて直した、(2)`EligibleProductReader`・`PlacementReader`が依存する`PRODUCT_PLATFORM_MODULE`・`PROFILE_PLATFORM_MODULE`がapiとeventの両方に束縛されることを確かめた。2回目で問題は無かった。
- 境界の確認: 表示の条件は`visibleProducts()`の絞り込みだけで上流のテーブルへ書き込まない。決済は口の実装と`CheckoutStarter`の呼び出しだけで決済のテーブルを読まない。区画は登録口への登録だけでページの枠を変えない。上流の改訂は要らない。
- 参照したスキル: cc-sddの`kiro-spec-requirements`・`kiro-spec-design`・`kiro-spec-tasks`の規則とテンプレート。新しいパッケージが無いため外部の調査は`rel="sponsored"`の仕様の確認に限った。

## タスクの計画の検証(2026-10-24)

- `/kiro-spec-tasks sponsorship -y`の手順で、要件と設計を承認し(`-y`による自動の承認)、タスクの計画の下書きを作った。要件の105件の受け入れ基準の番号がすべてタスクにあることを機械的に確かめた。自分のレビューで、apiのDIの識別子と束縛のモジュールを複数の(P)のタスクが同時に書き換える競合(3.1で一括して作り、3.2以降は順に追記する形にした)と、利用者側の操作の統合テストが購入種別の登録に依存すること、を直した。
- タスクのグラフのサニティレビューを2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
- 1回目の判定はNEEDS_FIXES(必須2件・軽微8件)だった。指摘は、(1)2.2〜2.5の(P)に2.1への依存の宣言が無い、(2)共有の束縛のタスクが購入種別の口を束縛せず、設計と食い違う(口を2つのタスクに分けて束縛の前へ移し、束縛と決済の登録と反映を通した統合テストを2.8の統合のタスクにした)の2件と、軽微8件(3.1と4.1の束縛の担当、2.7の大きさ(2.6・2.7に分割)、7.1・8.1の大きさ(7.1・7.2、8.1・8.2に分割)、3.5のWranglerの型の再生成、1.1の前提の列挙、1.4の完了状態の参照範囲、テストの行の補助の担当(2.1で作り、設計のファイル構成に`test-support/sponsorship-rows.ts`を加えた)、1.1の型検査のevent)である。すべて直した。
- 2回目の判定はNEEDS_FIXES(必須2件・軽微5件)だった。指摘は、(1)8.3のダイアログを一覧に組み込む作業の担当が無い、(2)7.2の完了状態がStripeの価格の有無に依存しローカルの既定の環境で満たせない、の2件と、軽微5件(3.4の大きさと境界(監査ログの操作種別と書き込みの部品の3.4と、ユースケースの3.5に分割)、6.6・7.4の完了状態の確認に後のタスクの補助が要る、6.3の完了状態のStorybookが設計に無い、2.1・4.1の大きさ(実行に支障なしのため変えていない)、5.1の不要な直列化((P)と境界を付けた))である。2.1・4.1の大きさを除き、タスクの計画の中で直した。
- kiro-spec-tasksの規則(2回目の判定がPASSでなければ、それ以上レビューを繰り返さずに止める)に従い、3回目のレビューを行っていない。`tasks.md`は2回目の指摘を直した下書きで、タスクの承認(`approvals.tasks`)は行っていない(directory-discoveryの1回目と同じ扱い)。`/kiro-spec-tasks sponsorship -y`を既存の`tasks.md`を引き継ぐ形で再実行し、サニティレビューがPASSになれば承認される。

## タスクの計画の再検証(2026-10-24、コーディネーターの指示による再実行)

- `/kiro-spec-tasks sponsorship -y`を、2回目の指摘を直した既存の`tasks.md`を引き継ぐ形で再実行した。要件と設計は`-y`で承認済みである。新しいサブエージェントによる独立した確認(independent)を、通常の2回の上限で行った。
- 並行して完了したengagementの設計を確かめた。engagementは`PRODUCT_DELETE_NOTICES`に登録せず(本specの30と重ならない)、`PRODUCT_PAGE_SECTIONS`は`aside` 20(本specのGoldは30)、技術ドキュメントは`backend/015`・`frontend/015`で、本specの`backend/018`・`frontend/017`と重ならない。作成中のtournament-weekは`PRODUCT_DELETE_NOTICES`に10を使う予定で、本specの30と重ならない。
- 1回目の判定はPASSだった。軽微の指摘7件のうち、(1)テストの行の補助が指定できる値(2.1に明記)、(2)7.4で後に回した削除の確認の注記の確認の担当(10.2に加えた)、(3)8.3の完了状態の後回しの明記、(4)強制終了の書き込みのポートの型の担当(3.4で定め3.5が加える)を直した。指摘(5)の、プロダクトの論理削除で終わった決済済みの広告が管理画面の「掲載中・掲載予定」の絞り込みに入り、見せる状態(「終了」)と食い違う点(要件9.3)は、設計の欠けとして扱い、product-launchの契約の`PRODUCT_LIFECYCLE_SYNC_HANDLERS`に`sponsorship.product-deletion`(`deleted`)を登録し、同じ書き込みで`sponsorships.product_deleted_at`を記録する形に設計を改めた(絞り込み・強制終了の条件・重なり・削除の確認の件数がこの列で判定でき、照会を介さずに一貫する)。タスクは1.2・2.1・3.7を直した。残りの2件(タスクの大きさ、1.3と1.4の順)は実行に支障が無いため変えていない。設計を改めたため、2回目のレビューでその反映を確かめた。
- 2回目の判定はPASSだった。軽微の指摘のうち、(1)3.4のテストにプロダクトの論理削除の記録での取り消しを加え、(2)1.1の前提に`PRODUCT_LIFECYCLE_SYNC_HANDLERS`を加え、(3)設計のImpact・Allowed Dependencies・構成の図の古い記述をそろえ、(4)掲載権の付与の前進の文の重なりの副問い合わせに`product_deleted_at IS NULL`を加えた。タスクの大きさ(2.1・4.1・5.1)と並行度(5.2・8.1・9.2)は実行に支障が無いため変えていない。タスクを承認した。

### Decision: 投稿者によるプロダクトの論理削除を申込に記録する

- **Context**: 要件7.7・9.3・10.8・11.5。プロダクトの論理削除で終わった広告の見せる状態は「終了」だが、ストアの絞り込みは期間と保存の状態だけで行っていた。
- **Selected Approach**: product-launchの同期の処理の登録口に`sponsorship.product-deletion`(`deleted`)を加え、削除の確定と同じ書き込みで`product_deleted_at`を記録する。退会による削除は`sponsorship.account-withdrawal`の論理削除で扱う。
- **Rationale**: `products`の列を直接読まずに(product-launchの結合の規則)、管理画面の絞り込み・強制終了・重なり・削除の確認の件数を本specの列だけで判定できる。上流の改訂は要らない(契約どおりの登録口)。

## cross-spec reviewの指摘による修正(2026-10-24)

- 振る舞いを変えない整合の修正のため、改訂の番号は付けない(cross-spec reviewの指摘による)。
  - design.mdの4:21の`order`の説明の「上流の値(〜1300)」を、engagement(1400)・tournament-week(1500)も先に動くため「〜1500」に直した。
  - `AdminSponsorshipsReader.list`の`UserProfileDirectory.findSummaries`に、user-profile-socialの契約で必須の範囲`'not-withdrawn'`(管理画面の一覧は停止中の申込者も出す)を渡すようにし、tasks.mdの3.3のテストに加えた。
  - requirements.mdの仮4の行に、directory-discoveryの仮3と一体で決め、どちらかを却下すれば両方を元に戻す旨を加えた。
  - E2Eの0:07のジョブの起動を、独自の起動(`--test-scheduled`の手動起動)からbackend-platformの改訂2の共有の補助`e2e/support/scheduled-trigger.ts`の`triggerScheduled`へ改めた。design.mdのAllowed Dependencies・Revalidation Triggers・Testing Strategy、tasks.mdの1.1の前提・10.1・10.2を直した。
  - design.mdのユーザーとプロダクトのライフサイクルの同期の登録2件に、identity-authとproduct-launchの契約で必須の`handler`(`SPONSORSHIP_TYPES.AccountWithdrawalSyncHandler`・`SPONSORSHIP_TYPES.ProductDeletionSyncHandler`)を加えた(cross-spec reviewの2回目の指摘による)。
- 変更したタスクの部分を、新しいサブエージェントによる独立した確認(kiro-spec-tasksの基準)で検証し、1回目の判定はPASSだった。タスクの承認を保つ。

## 開発者の確定の反映(2026-10-24)

- 開発者の回答により、仮1・仮2・仮4・仮5・仮6を推奨どおり、仮3を推奨と異なる選択肢B(強制終了と表示停止の日割りの自動返金)で確定した。requirements.md・design.md・tasks.md・research.md・brief.mdから確認待ちの記述を除き、本specに確認待ちの論点は無い。
- 仮3の反映: 要件10.2・10.5・10.6・10.7・10.11・2.10・7.4・8.8・11.5・13.2・13.3・13.5を改め、要件14(強制終了と表示停止の日割りの自動返金、11件)を加えた(14の要件・116件の受け入れ基準)。設計に、表示停止の区間のテーブル`sponsorship_display_stops`、申込の返金の列、`DisplayStopStore`・`RefundSettlement`、表示停止の同期の処理(`sponsorship.product-display-stop`・`sponsorship.account-display-stop`)、0:07と4:21の精算、強制終了の2つの返金の依頼を加えた。タスクは2.8(表示停止の区間のストア)・2.9(返金の精算)・3.8(表示停止の同期の処理)を加え、旧2.8を2.10にし、1.1〜1.4・2.1・2.4・3.4〜3.7・4.1・4.2・5.1・5.2・7.3・8.3・9.2・10.1・10.3・10.4を改めた(45のサブタスク)。
- paymentsの確認(2026-10-24)の反映: 自動返金の通知は`reflection:`の依頼だけのため本specの掲載終了・強制終了の通知が返金を知らせる。依頼キーは広告ごと・種類ごとに2つ。返金できる残りを超える拒否は残りの全額で依頼し直す。物理削除の後の`purchase_not_found`は、退会・プロダクトの削除の広告を返金しないため通常の流れでは起きず、起きた場合は`failed`とSentryへの通知で扱う。paymentsの変更は要らない。
- レビュー: 新しいサブエージェントによる独立した確認を、設計の変更部分(kiro-spec-designのレビューゲート)とタスク(kiro-spec-tasksのサニティレビュー)について通常の2回の上限で行った。
  - 1回目: 設計・タスクともNEEDS_FIXES(必須5件)。決済画面の追加事項の文言の残り、終了通知の条件の不一致(`ends_on < today`と精算済みにそろえた)、未精算の照会`listUnsettledEnded`と申込の返金の列の欠け、2.4のテストの条件、2.1の前提を直し、軽微の指摘(図・束縛の一覧・技術の表・Componentsの表・`duplicate`の表現・残りの全額の金額の記録・精算前の退会の扱いの明記・briefの古い記述・9.2の依存・2.8の分割)も直した。
  - 2回目: 設計・タスクともNEEDS_FIXES(必須2件)。research.mdの「波及処理を持たない」の記述が表示停止の同期の処理と食い違う点と、テストとE2Eで返金の依頼を確かめるためのpaymentsの購入の行を作る補助が無い点である。いずれも直した(research.mdの3か所、2.1・10.1の補助に購入の行(テスト専用の書き込み)を加え、10.3の確認を依頼の行までにした)。軽微の指摘(残りの全額の表記、強制終了の結果の依頼した額の欄、未精算の部分索引、Componentsの表の要件、`captureMessage`の依存、briefの決定事項の帯、10.2の`_Depends`、1.3の文言の正)も直した。
  - 規則(2回目の判定がPASSでなければ繰り返さない)に従い3回目のレビューを行っていない。設計とタスクの承認(`approvals.design.approved`・`approvals.tasks.approved`)は偽にした。2回目の指摘を直した設計とタスクを引き継いで`/kiro-spec-design sponsorship -y`(変更部分)と`/kiro-spec-tasks sponsorship -y`を再実行し、レビューがPASSになれば承認される。

## 最終のレビュー(2026-10-24、コーディネーターの指示による再実行)

- 設計のレビューゲート(変更部分、`/kiro-spec-design sponsorship -y`の手順)を新しいサブエージェントによる独立した確認で行い、先に前回の2回目の修正(未レビュー)を確かめさせた。
  - 1回目: NEEDS_FIXES(必須1件)。掲載の終わりの精算を4:21のCronの処理で最大1,000件行う設計が、backend-platformの改訂2の時間とサブリクエストの予算を超えるおそれがある。精算をeventのメッセージの処理`sponsorship.settle-period-end`(`PeriodEndSettlementHandler`、1回20件、広告ごとの例外の分離、精算の後に必ず終了通知を依頼待ちにする、`defer`で継続)へ移し、0:07・4:21のジョブはメッセージを送るだけにした。軽微(強制終了の結果の依頼した額、Componentsの表の14.11、research.mdの表の行、部分索引の`deleted_at IS NULL`、Out of Boundaryのテスト専用の購入の行、E2Eと単体テストの確認の項目)も直した。
  - 2回目: PASS。軽微(古い記述の残り、通知の契機の表と図、Testing Strategy、精算の一括の書き込みで前進の文を先に置くこと、例外になった広告で先頭が詰まらないこと)を直した。設計を承認した。
- タスクのサニティレビュー(`/kiro-spec-tasks sponsorship -y`の手順、現在の`tasks.md`を下書きとして)を新しいサブエージェントによる独立した確認で行い、先に未レビューの修正(2.1・10.1の購入の行の補助、10.2の依存、1.3の注記、1.2の索引の数、精算の5.3への移動、2.8〜2.10の分割と依存の付け替え)を確かめさせた。
  - 1回目: PASS。軽微(3.6のテストの表現、5.1の識別子と追記の担当の明記、5.3の除外の読み足しの方法、10.3の通知の日数)を直した。タスクを承認した(46のサブタスク、要件116件をすべて対応付け)。

## cross-spec review(3回目)の指摘による修正(2026-10-24)

- ugc-moderationの設計が文言規則の文として参照する広告の返金の2文(プロダクトの非公開化の通知の段落・利用者の停止の通知の段落)が、本specのresearch.mdにしか無く、タスク1.4で文言規則へ書かれない点を直した。design.mdのError Handlingの文言の一覧と、タスク1.4の文言規則の項目と完了状態に2文をそのまま加えた。非公開化の文には、要件14.9に合わせて「掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。」を加え、上流・後続specへの影響の文も同じにした。
- 変更部分を新しいサブエージェントによる独立した確認(軽量のタスクのレビュー)で確かめ、1回目の判定はPASSだった(2文はdesign.md・tasks.md・research.md・ugc-moderationのdesign.mdで一字一句同じ)。任意の指摘(退会の条件を「掲載期間が終わる前に退会した場合」に広げる余地、強制終了の返金は本specの強制終了の通知が知らせること)は、ugc-moderationの2文と同時に変える必要があるため開発者の判断に委ね、変えていない。タスクの承認を保つ。
- 追って、コーディネーターの指示で2文の末尾を要件14.9に合わせた最終の文面(「掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。」、非公開化と停止で同じ)にそろえ、design.md・tasks.mdの1.4・research.mdを同じ文面にした(ugc-moderationにも同じ文面が並行して与えられる)。新しいサブエージェントによる軽量のレビューの1回目の判定はPASSで、タスクの承認を保つ。任意の指摘(掲載終了日の翌日0:00から精算までの間の退会・削除も返金しないため、そのすき間だけ文面とずれる)は、極端な場合に限られるため文面を変えていない。
