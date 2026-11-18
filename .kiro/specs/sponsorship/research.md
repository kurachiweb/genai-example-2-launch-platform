# Research & Design Decisions

## Summary

- **Feature**: `sponsorship`
- **Discovery Scope**: Complex Integration(広告の実装は無い。上流の20spec(dev-tooling〜notifications)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはpaymentsの購入種別の口・`CheckoutStarter`・`PriceCatalog`、ultras-subscriptionの`PRICING_SECTIONS`、match-engineの`TOP_PAGE_SECTIONS`・`QUALIFIER_LIST_INSERTS`、directory-discoveryの`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`・`PRODUCT_PAGE_SECTIONS`、product-launchの`ProductDirectory`・`LaunchExport`・`ProductExport`・`visibleProducts()`・ライフサイクルの登録口・`PRODUCT_DELETE_NOTICES`、identity-authのライフサイクルの登録口・`UserContactDirectory`・`SETTINGS_NAV_ITEMS`、admin-foundationの`requireAdmin`・監査ログ・`ADMIN_NAV_ITEMS`、email-deliveryの`EmailSender`の上に、申込・掲載権・広告スペース・通知・強制終了を足す)
- **Key Findings**:
  - ページ配置(`docs/GUIDES/service/design/002-page-layouts.md`)の「スポンサー広告スペース」が、roadmapの論点のうち掲載枠の上限の答えを既に書いている(「申し込まれた広告は枚数上限を設けず全て表示する」)。ただしroadmapが要件フェーズでの確認を求めているため、仮1として記録した(directory-discoveryの仮1・仮2と同じ扱い)。
  - 要件定義書は強制終了の返金を「返金目安額の表示」(FR-ADMUG-045)までとし、FR-PYMNT-006は「Stripeのダッシュボード上で管理者が手動実行した返金処理」をFR-ADMUG-044に対応付けている。自動の返金はFR-PYMNT-010・014だけである(FR-PYMNT-012)。一方、法的通知の大枠の返金ポリシーは強制終了・表示停止を「自動で返金する」と書く(仮3)。ultras-subscriptionは同じ種類の食い違い(停止に伴う返金)を要件定義書どおりに決め、返金ポリシーの行を直した。2026-10-24に開発者は仮3で自動の日割りの返金(選択肢B)を選んだ。
  - FR-SPONS-009はディレクトリに広告スペースを挙げるが、ページ配置のディレクトリの節は「スポンサー広告は表示しない」と書く。directory-discoveryは仮3で登録口だけを設け、表示するかどうかを本specに委ねた(仮4)。
  - 広告の開始・終了・強制終了の通知は、notificationsの配信停止の対象(FR-NOTIF-001・004・006・007)に当たらない取引上の通知である(準拠方針の「通知メールのオプトアウト」)。notificationsは非目標に「トランザクションメール」を挙げ、通知イベントの契約をトーナメントの通知に限っている。本specはemail-deliveryの`EmailSender`で直接送る。
  - 表示の条件(決済済み・期間内・強制終了でない・プロダクトが可視)は、product-launchが後続specに許す`visibleProducts()`の絞り込みと本specのテーブルで、表示の時点に1回の問い合わせで判定できる。非公開化・停止・復元・停止の解除のたびに状態を直す処理は要らない。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を推奨として示した。**仮1〜仮6は2026-10-24に開発者が確定した(仮3は推奨と異なる選択肢B、他は推奨どおり)。** 決定は`requirements.md`の「要件フェーズでの決定」にも記録する。roadmapの「Requirement Ambiguities」の表のうち、「スポンサー広告のティア別・日別の掲載枠上限、0:07以降の当日開始申込の開始通知」の行(sponsorshipの担当)は仮1・仮2で、「停止・非公開化・強制終了に伴う返金を自動で行うか」の行(ugc-moderation・sponsorship・tournament-week・tournament-yearの共同の担当)の広告の部分は仮3で決めた。roadmapは編集せず、解決の列の文言をコントローラーへ報告する。

| #   | 論点                                             | 根拠                                                                                                                                                                                                                                                                                                                                                                         | 選択肢                                                                                                                                                                                                                                                                                                                                                                                                  | 推奨                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | ティアごと・日ごとの掲載枠の上限                 | FR-SPONS-002・004・007〜009(上限を定めない)、ページ配置の「スポンサー広告スペース」(「枚数上限を設けず全て表示する」)、roadmapのRequirement Ambiguities                                                                                                                                                                                                                      | (A)上限を設けず、表示の条件を満たす全件をティアごとに表示する / (B)ティア・日ごとに上限N件を設け、満枠の日は申し込めないようにする                                                                                                                                                                                                                                                                      | 推奨は(A)。ページ配置に一致し、Legendのグリッド・Goldの列とモバイルの挿入・Silverの折り返しは、いずれも件数によらず全件を並べる配置として定められている。(B)は上限の値が要件・サービス仕様のどこにも無く、満枠の判定のための枠の確保(未決済の間の仮押さえと失効)が要り、決済の反映の時点の満枠を拒否として返金する経路も増える                                                                                                                                                                                                                                                                                                               |
| 仮2 | 当日の0:07以降に決済した当日開始の広告の開始通知 | FR-SPONS-016(毎日0:07に当日開始の広告へ送る)、FR-SPONS-004(今日を開始日に選べる)、paymentsの購入確認メール(役務の提供時期を含む)、roadmapのRequirement Ambiguities                                                                                                                                                                                                           | (A)決済の反映の直後に開始通知を送る / (B)送らない(paymentsの購入確認メールで代える) / (C)翌日の0:07に送る                                                                                                                                                                                                                                                                                               | 推奨は(A)。全ての広告が開始通知を1回受け取り、FR-SPONS-016の目的(掲載が始まったことを知らせる)に合う。0:07の処理と同じ依頼待ちの記録と送信の処理を使うため、仕組みが増えない。(B)は当日の申込だけ開始通知が届かず、(C)は掲載が始まって1日後に「始まりました」と届き、1日だけの広告では終了通知と同じ時刻になる                                                                                                                                                                                                                                                                                                                               |
| 仮3 | 強制終了・表示停止に伴う返金を自動で行うか       | FR-ADMUG-045(返金目安額の自動算出と表示)、FR-PYMNT-006(管理者がダッシュボードで手動実行した返金をFR-ADMUG-044に対応付ける)、FR-PYMNT-012(自動の返金はFR-PYMNT-010・014)、FR-SPONS-020(表示停止に返金の定めが無い)、法的通知の大枠の返金ポリシー(強制終了は未掲載日数分、表示停止は停止日数分を「自動で返金する」)、briefのConstraints、paymentsのQ1、ultras-subscriptionのQ3 | (A)強制終了は返金目安額の表示までとし、返金は管理者がStripeのダッシュボードで手動で行う。表示停止は返金しない。返金ポリシーの広告の2行を改める / (B)強制終了は未掲載日数分を、表示停止は停止した日数分を、paymentsの`PaymentRefunds`(金額指定)で自動で返金する。要件定義書(FR-ADMUG-045・FR-PYMNT-006・012・FR-SPONS-020)の改訂が要る / (C)強制終了だけ未掲載日数分を自動で返金し、表示停止は返金しない | 推奨は(A)。要件定義書(SSoT)の3つの要件(FR-ADMUG-045・FR-PYMNT-006・012)が手動の返金で一貫し、briefの従来の前提とも合う。ultras-subscriptionも同じ食い違い(停止に伴うUltrasの返金)を要件定義書どおりに決め、返金ポリシーの行を直した。表示停止は利用者の規約違反の結果で、FR-SPONS-020は表示を止めることだけを定める。返金が必要な場合は、管理者が強制終了して返金目安額に基づき手動で返金できる。(B)・(C)を選んだ場合は、強制終了の確定の後に`PaymentRefunds.request`(金額は返金目安額、依頼キー`sponsorship-termination:<申込ID>`、理由`sponsorship_terminated`)を呼ぶ処理と、表示停止の日数を数える記録を足す(設計のRevalidation Triggers) |
| 仮4 | ディレクトリページの広告スペース                 | FR-SPONS-009(トップ・ディレクトリ・詳細の広告スペース)、ページ配置のディレクトリ(「スポンサー広告は表示しない」)、directory-discoveryの仮3(登録口を設け、表示の有無を本specに委ねる)、brief                                                                                                                                                                                  | (A)要件定義書を正とし、ディレクトリにも3ティアを表示する。ページ配置の記述を改める / (B)ページ配置を正とし、ディレクトリには表示しない。FR-SPONS-009の改訂が要る                                                                                                                                                                                                                                        | 推奨は(A)。要件定義書がSSoTで、briefとdirectory-discoveryの仮3も表示する前提で登録口を用意した。Goldのモバイルの挿入もトップページの予選の一覧と同じ形(一覧の2件ごと)で、directory-discoveryの`DIRECTORY_LIST_INSERTS`がその形を持つ。ディレクトリは「読み物として静止させる」ページのため、広告も演出を持たない静止した表示にする                                                                                                                                                                                                                                                                                                           |
| 仮5 | 同じプロダクト・同じティアで掲載期間が重なる申込 | FR-SPONS-001・002・004・007〜010(重なりを定めない)、FR-SPONS-010(同一ティア内の並び)、ページ配置(全件を表示)                                                                                                                                                                                                                                                                 | (A)決済済みで終了・強制終了していない同じプロダクト・同じティアの広告と1日でも重なる申込を受け付けず、決済の反映の時点で重なれば権利を付与しない(paymentsが全額を自動で返金する) / (B)受け付けて、表示で同じプロダクトを1件にまとめる / (C)受け付けて、重ねて表示する                                                                                                                                   | 推奨は(A)。同じティアの中に同じプロダクトが2枚並ぶ表示((C))や、支払った2件のうち1件分しか表示されない状態((B))を作らない。延長したい場合は重ならない期間で申し込める。異なるティアの重なりは目立ち度の組み合わせとして許す。未決済の申込は重なりの判定に含めない(放置された申込で他の申込を妨げない)                                                                                                                                                                                                                                                                                                                                         |
| 仮6 | 掲載期間の長さと開始日の上限                     | FR-SPONS-004(今日以降を1日単位、上限を定めない)、paymentsの`PurchaseOffer.quantity`(1〜366の整数)、FR-PYMNT-003(日数を数量として指定)                                                                                                                                                                                                                                        | (A)掲載期間を1〜366日、開始日を今日から365日後までとする / (B)掲載期間を1〜366日、開始日の上限を設けない / (C)掲載期間を1〜90日、開始日を今日から90日後までとする                                                                                                                                                                                                                                       | 推奨は(A)。期間の上限はpaymentsの数量の上限(366)に合わせる必要がある。開始日の上限を設けないと、何年も先の広告が決済済みのまま残り、価格の改定や返金ポリシーの改訂の影響を長く受ける。1年先までなら年単位の出稿の計画に足りる。(C)は要件に無い制限を強める                                                                                                                                                                                                                                                                                                                                                                                   |

### 開発者の確定(2026-10-24)

- 仮1・仮2・仮4・仮5・仮6: 推奨どおり確定(仮4はdirectory-discoveryの仮3と同じく確定)。
- 仮3: **推奨と異なる選択肢Bで確定。** 強制終了は未掲載日数分を、表示停止(ユーザー停止・プロダクト非公開化)は表示を止めた日数分を、paymentsの`PaymentRefunds`で金額を指定して日割りで自動的に返金する。要件定義書FR-ADMUG-045・FR-PYMNT-006・FR-PYMNT-012・FR-SPONS-020の改訂が要る(「要件定義書の改訂が必要な箇所」)。法的通知の大枠の返金ポリシーの広告の行もこれに合わせる(タスク1.4)。返金の時機と表示停止日数の数え方は「Decision: 強制終了と表示停止を日割りで自動で返金する(仮3)」で決めた。ugc-moderationの仮8(推奨どおり)により、ugc-moderationは返金を依頼せず、停止・非公開化の通知で本specの扱いを伝える(「上流・後続specへの影響」の文面)。
- 本specに確認待ちの論点は無い。

### 確認済みのため質問しない事項

- 「過去にローンチしたプロダクト」(FR-SPONS-001): キックオフ(ローンチ日の0:00)を迎え、取り消されていないローンチを1回以上持つプロダクトとする。product-launchの`LaunchStatus`の`in_progress`・`finished`に当たり、勝敗を問わない。予選マッチ中のプロダクトも含む(ローンチ日を迎えている)。非公開化・論理削除されたプロダクトは、FR-SPONS-020により表示できないため申込の対象から外す。
- 掲載期間の区切り: 基準時刻(UTC-08:00)の日付で、開始日の0:00から終了日の翌日0:00までを掲載期間とする(日次タイムラインの「スポンサー広告の掲載期間: 基準時刻の日単位」)。表示停止の間も掲載期間は延長しない(FR-SPONS-008は選んだ期間の表示を定める)。
- 価格: ティアごとの1日あたりの単価をStripeの価格(`lookup_key`)で持ち、paymentsの`PriceCatalog`で照会する(FR-PYMNT-003、要件定義書4.15の前書き「掲載プランの価格はStripeのダッシュボード上で設定する」)。料金とプランの$3・$8・$20は参考価格で、画面の値はStripeの設定を正とする。
- 決済の受付の有効期限: paymentsの仮4により、決済期限の無い購入の決済セッションは作成から1時間で失効する。本specは決済期限を持たず、反映の期限を掲載開始日の翌日0:00とする(それ以降に確定した決済はpaymentsが反映の期限切れとして全額を返金する)。
- bot判定(FR-SPONS-015): 申込の記録の前に本specのGraphQLの変更操作で`assertHuman('sponsorship_apply')`を呼ぶ。bot判定のトークンは1回しか使えないため、`PurchaseOffer.requiresBotVerification`は偽にする(paymentsの申し送りの「FR-SPONS-015に従う」を、本specが先に検証する形で満たす)。未決済の申込の決済の再開も申込の操作として同じ検証を行う。
- 広告ラベルの文言: ページ配置の「スポンサー」をティアの色で表示する。モックアップの`sponsor-ads.tsx`はLegendを「レジェンドスポンサー」としているが、ページ配置が広告ラベルの文言を明示しているためそれに従う。
- ロゴの画像バリアント: ページ配置はLegend・Goldを`square-md`、Silverを`square-sm`と書き、画像バリアントの文書はLegend・Goldの1xを`square-sm`、Silverの1xを`square-xs`と書く。両者は表示の大きさ(Legend・GoldはCSSの64px、Silverは32px)の2xと1xを指しており食い違わない。media-pipelineの`MediaPicture`に表示の大きさを渡して出し分ける。
- 無作為の並び(FR-SPONS-010): モックアップはマウントの後に並べ替えるが、それでは初回の表示の後に並びが変わる。本specはサーバーが照会のたびに並べ替えた結果を返し、サーバーの描画とクライアントの復元が同じ順を使う。
- 外部Webサイトへのリンクの`rel`: ページ配置の「外部Webサイトへのリンク」により`noopener`とFR-SPONS-012の`sponsored`を付ける。
- 広告の計測: 準拠方針は広告トラッキングとリターゲティングを行わないとする。本specは表示回数・クリックを記録しない。
- 開始・終了・強制終了の通知メール: 取引上の通知で、配信停止のリンクと送信者情報の区画を持たない(準拠方針の「通知メールのオプトアウト」の対象外)。件名は文言規則の通知メールの件名の表を使う。宛先はidentity-authの`UserContactDirectory`で引く(briefのConstraints)。
- 強制終了の通知メールの理由: FR-ADMUG-044の「理由付きで…メール通知」と、FR-ADMUG-030(停止・非公開化の通知に理由を含める)の形に合わせ、管理者が入力した理由を本文に含める。理由は監査ログにも記録され、個人情報を含めない旨を入力欄に示す(admin-foundationの`ReasonField`)。
- 管理画面の権限: admin-foundationのQ3により、一覧は全ロール(閲覧のみ以上)、強制終了はモデレーター以上とする。メニューのURLと`order`はadmin-foundationの仮6の`/sponsorships`・90。
- 料金ページの区画: ultras-subscriptionの`PRICING_SECTIONS`に`{ id: 'sponsorship.sponsorship-pricing', order: 20 }`で登録する(brief)。ultras-subscriptionのQ5によりページ自体は機能フラグにかかわらず表示され、Ultrasの区画だけが出し分けられる。
- 退会時の扱い(FR-USER-019): 申込を論理削除し、物理削除の時期(DR-002)に消す。決済履歴はpaymentsが仮名化IDで7年保持する(DR-018)。
- 投稿者によるプロダクトの削除・退会に伴う掲載の終了は返金しない(返金ポリシーの既存の行)。削除の確認の画面にその旨を表示する(ページ配置の「プロダクト登録・編集」)。
- 返金・チャージバックを受け取っても掲載権を変えない(FR-PYMNT-008)。
- 波及処理と定期の処理の`order`: 本specの1600番台(roadmapの帯の割り当て)。4:21のジョブと波及処理は上流の値の後に動いてよく、上流より前に動く必要のある処理は無い。0:07のジョブは他のspecが登録していない時刻で、同じ1600を使う。
- 新しいパッケージ: 無い。日付の入力はブラウザの日付入力欄(directory-discoveryと同じ)、価格の表示はpaymentsの`MoneyText`、画像は`MediaPicture`を使う。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(directory-discoveryと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(決済フルフィルメント・画面シェル・プロダクトライフサイクルイベント・ユーザーライフサイクルイベント・可視性フィルタ・利用者の連絡先の照会・データエクスポートの出力・監査ログ・Cron・Queuesのディスパッチ)。
- **Sources Consulted**: payments・ultras-subscription・match-engine・directory-discovery・product-launch・identity-auth・admin-foundation・email-delivery・notifications・backend-platform・api-gateway・frontend-platform・user-profile-social・media-pipelineの`design.md`、payments・ultras-subscription・match-engine・directory-discovery・admin-foundationの`research.md`の後続specへの申し送り、ugc-moderation・data-export・tournament-weekのbrief、サービス仕様(ページ配置・文言規則・料金とプラン・日次タイムライン・法的通知の大枠・利用規約の大枠・準拠方針・データエクスポート・画像バリアント・デザイン原則)、モックアップ`mockups/src/components/client/sponsor-ads.tsx`・`routes/client/top`。
- **Findings**:
  - payments: `PurchaseOfferPolicy.describe({ userId, targetId, now })`が`PurchaseOffer`(`priceLookupKey`・`quantity` 1〜366・`relatedId`・`exclusivityKey`・`deadlineAt`・`acceptUntil`・`fulfillableUntil`・`summary`・`requiresBotVerification`)を返し、`PurchaseFulfillment.prepare(purchase, db)`は副作用なしにD1の文か`reject`(`ineligible`)を返す。文が制約で失敗したら`prepare`を1回呼び直す。`afterCommit`は確定させた側だけが1回呼ぶ。`exclusivityKey`は`fulfilled`の購入の部分一意索引で二重決済を拒否する。`decideCompletion`は`fulfillableUntil`を過ぎた確定を`late`で拒否する。決済期限の無い購入の決済セッションは1時間で失効する(仮4)。申し送りに「sponsorshipは申込の行を作った後に`CheckoutStarter.start`を呼び、数量=掲載日数、`requiresBotVerification`はFR-SPONS-015に従う。強制終了・表示停止の返金を自動にするかは判断し、自動なら`PaymentRefunds`(金額指定)を使う」とある。決済後のランディングは広告の購入に`/settings/sponsorships`への導線を出す。
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

- **Context**: 要件4、FR-SPONS-020、NFR-PERF-007・008、product-launchの結合の規則。
- **Findings**:
  - 表示の条件のうちプロダクト側(非公開化・論理削除・投稿者の退会と停止)は`visibleProducts()`がまとめて表し、`sponsorships`と`products`・`users`を結合した絞り込みに使ってよい。期間と強制終了は本specの列で判定できる。
  - 表示の時点に1回の問い合わせで判定すれば、非公開化・復元・停止・停止の解除のたびに状態を直すライフサイクルの処理が要らず、解除の後の再表示(4.3)も自然に満たす。
  - 自分の一覧の「表示停止中」は、`findSummaries(ids, 'not-deleted')`の`visible`で判定できる(論理削除済みは返らないため「削除したプロダクト」と区別できる)。
- **Implications**: `PlacementReader`の1回の問い合わせと`findSummaries`だけで広告を得る。表示の判定のための写しや非公開化・停止・復元の波及処理は持たない。表示停止の区間の記録だけを、同期の処理として確定と同じ書き込みで行う(仮3)。

### 無作為の並びとモバイルのGold

- **Context**: FR-SPONS-010、ページ配置(モバイルのGoldは2件ごとの挿入と余り)、モックアップ(マウントの後に並べ替え)、briefのConstraints(SSRで初期表示)。
- **Findings**:
  - モックアップのようにマウントの後に並べ替えると、サーバーの描画とクライアントの復元が一致したまま、表示の直後に並びが変わる。サーバーが照会のたびに並べ替えて返せば、サーバーの描画とクライアントの復元が同じ順になり、ページの表示ごとに順が変わる。
  - 1ページの全ての区画が同じTanStack Queryのキーで同じ照会の結果を使えば、挿入と余りの順がそろう。
  - 余りの数は描画された差し込みの数で決まるが、差し込みの数は上流の一覧の件数で決まり、区画の文脈に無い。差し込みの部品が復元の後に数を共有の小さな仕組みに登録し、余りの部分だけを復元の後に描けば、上流の契約を変えずに済む。余りは一覧の下にあるため、後から描いても上の内容の位置は動かない。
- **Implications**: `PlacementReader`のサーバーの並べ替え、`useSponsoredPlacements`の共有の照会、`GoldInsertTracker`を設ける。

### 通知の経路

- **Context**: FR-SPONS-016・018・019、仮2、準拠方針の通知メールのオプトアウト、notificationsの非目標。
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

- **Context**: FR-ADMUG-044・045、FR-ADMAG-001、仮3、返金ポリシーの未掲載日数の定義。
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

- **Context**: 要件4、FR-SPONS-020。
- **Selected Approach**: `PlacementReader`が`state = 'paid'`・論理削除なし・期間内・`visibleProducts()`で絞り、`findSummaries`で表示の情報を読み、ティアごとに並べ替える。
- **Rationale**: 写しを持たないため、非公開化・停止・復元・停止の解除が次の表示に即座に反映され、表示の判定のための波及処理が要らない(表示停止の返金のための区間の記録は別に行う、仮3)。
- **Trade-offs**: ページの表示ごとにD1を読む。索引の範囲の読み取りで、件数の多い日でもNFR-PERF-007の内に収まる見込み(Risks)。

### Decision: 通知を依頼待ちの列と1つの送信の処理で送る

- **Context**: 要件8、仮2、FR-SPONS-019。
- **Selected Approach**: 行に3つの通知の状態を持ち、0:07のジョブ・決済の確定・強制終了・4:21のジョブが依頼待ちにして`sponsorship.dispatch-notices`を送り、eventの処理が条件付きの更新で1件ずつ取ってから送る。
- **Rationale**: 依頼待ちの記録と確定が同時で、送信の依頼が失われても4:21に拾える。同時の処理でも重ねて送らない。
- **Trade-offs**: 取った後の送信の依頼が失敗すると依頼待ちへ戻すため、極めて稀にEmail送信の基盤の側で重複し得る(email-deliveryの再送の範囲)。

### Decision: 強制終了と表示停止を日割りで自動で返金する(仮3)

- **Context**: 要件10・14、FR-ADMUG-045・FR-SPONS-020、返金ポリシー、2026-10-24の開発者の回答(仮3は選択肢B)、paymentsの`PaymentRefunds`(全額・一部の金額を指定した非同期の依頼、依頼キーごとに1回、返金できる残りを超える金額の拒否、`reflection:`の依頼だけに送る自動返金の通知、物理削除の後の`purchase_not_found`)。
- **Alternatives Considered**(返金の時機):
  1. 掲載の終わり(掲載終了日の翌日の0:07、強制終了ではその確定)に、広告ごとに表示停止日数を1回だけ数えて依頼する
  2. 非公開化の取り消し・停止の解除のたびに、その区間の日数分を依頼し、掲載の終わりに継続中の区間を締めて依頼する
- **Selected Approach**: 1。非公開化・停止の区間は確定と同じ書き込みで`sponsorship_display_stops`に記録し、掲載の終わりに`countStoppedDays`(日の一部でも停止した日を数え、重なりは1日)と`computeRefundEstimate`で金額を求め、`PaymentRefunds.prepare`の文を申込の列の更新と同じ一括の書き込みで確定してから`dispatch`する。強制終了は、未掲載日数分(返金目安額)と強制終了日の前日までの表示停止日数分の2つを、強制終了の前進・監査ログと同じ一括の書き込みで依頼する。依頼キーは`sponsorship-termination:<申込ID>`・`sponsorship-display-stop:<申込ID>`、理由は`sponsorship_terminated`・`sponsorship_display_stopped`。0円は依頼しない。返金できる残りを超える拒否では残りの全額で依頼し直し、他の拒否は`failed`とSentryへの通知で処理を止めない。退会・プロダクトの論理削除の広告は返金しない(返金ポリシーの既存の行)。返金の金額は本specの掲載終了通知・強制終了の通知で知らせる。
- **Rationale**: 2の方式は、非公開化と停止が重なる区間・解除されないまま掲載が終わる区間・強制終了と重なる区間で、日の数え重ねと依頼の数が増え、鍵の設計も区間ごとになる。1の方式は広告ごと・種類ごとに鍵が1つで、同じ日を2回返金せず、精算と記録が同じ書き込みで確定するため再実行に強い。返金の時期は掲載の終わりまで遅れるが、掲載期間は最長366日で、返金ポリシーと通知でその旨を示す。
- **Trade-offs**: 表示停止の区間のテーブルと、精算のメッセージの処理(0:07・4:21のジョブが依頼する)が増える。長い掲載期間の途中の停止では返金が掲載の終わりまで待たれる。
- **Follow-up**: 要件定義書の4つの要件の改訂(「要件定義書の改訂が必要な箇所」)。ugc-moderationの停止・非公開化の通知の文面を本specの扱いに合わせる(「上流・後続specへの影響」)。

### Decision: ディレクトリにも広告を表示する(仮4)

- **Context**: FR-SPONS-009、directory-discoveryの仮3。
- **Selected Approach**: ディレクトリの`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`へ、トップページと同じ部品を登録する。ページ配置の「スポンサー広告は表示しない」を改める。
- **Rationale**: 要件定義書(SSoT)とbriefに一致し、部品と登録の形がトップページと同じで追加の仕組みが要らない。

### Decision: 採らなかった案

- 広告のクリックの計測・リダイレクト: 準拠方針が広告トラッキングを行わないとする。リンクは広告主のサイトへ直接向ける。
- 表示停止の返金を解除のたびに依頼する方式: 「Decision: 強制終了と表示停止を日割りで自動で返金する(仮3)」の2。
- 広告の審査の工程(申込を管理者が承認してから掲載): 要件に無く、事後の強制終了(FR-ADMUG-044)で対応する。
- 申込の変更・取り消しの操作: 要件に無い。決済の前は放置で開始日の翌日に消え、決済の後は返金ポリシーの原則(決済完了後の返金なし)に従う。

## Synthesis

- **Generalization**: 開始・終了・強制終了の通知を、「行の依頼待ちの状態を契機ごとに進め、1つの送信の処理が送る」1つの仕組みに一般化した。トップページ・ディレクトリ・プロダクト詳細ページの広告を、ページによらない4つの部品(Legend・Gold・Goldの差し込み・Silver)と1つの共有の照会に一般化し、ページごとの差はGoldの余りの有無だけにした。利用者・管理者・エクスポートの状態を、保存の3つの状態と期間とプロダクトの可否から導く1つの関数に一般化した。
- **Build vs Adopt**: 決済・価格・返金・決済画面(payments)、ページの枠と区画の登録口(match-engine・directory-discovery・ultras-subscription・identity-auth・admin-foundation・product-launch)、プロダクトの照会と可視の条件(product-launch)、メールの送信(email-delivery)、監査ログ(admin-foundation)、bot判定(frontend-platform・api-gateway)を使う。乱数は`crypto.getRandomValues`、日付入力はブラウザの入力欄。新しいパッケージは無い。
- **Simplification**: 表示中の広告の写し、表示の判定のための非公開化・停止・復元の波及処理(表示停止の区間の記録は仮3のために行う)、枠の在庫、クリックの計測、申込の変更の操作を持たない。

## Risks & Mitigations

- 表示の問い合わせをページの表示ごとに行うため、広告の件数とアクセスが増えると読み取りが増える — `sponsorships_display_idx`の範囲の読み取りと`findSummaries`の90件ずつの1回にまとめる。launch-readinessの性能の検証で、1,000件の掲載中の広告の合成データでNFR-PERF-007を確かめ、超えるならCache APIでの短時間の保持(並べ替えは保持の後に行う)を検討する。
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
| FR-SPONS-016      | 当日の0:07以降に決済が確定した当日開始の広告には、確定の直後に開始通知を送る旨を加える                                                                                                                                                                                       | 仮2          |
| FR-ADMUG-045      | 「返金目安額として自動算出し画面に表示しなければならない」を、「未掲載日数分の金額を自動算出して画面に表示し、強制終了と同時に決済機能(FR-PYMNT-012)により自動で返金しなければならない」に改める                                                                             | 仮3          |
| FR-PYMNT-006      | 「Stripeのダッシュボード上で管理者が手動実行した返金処理、及びFR-PYMNT-010・FR-PYMNT-014により自動実行した返金処理」に、「FR-ADMUG-045・FR-SPONS-020により自動実行した返金処理」を加え、対応要件からFR-ADMUG-044(手動の返金)の対応付けを外す                                 | 仮3          |
| FR-PYMNT-012      | 非同期処理の対象の「FR-PYMNT-010・FR-PYMNT-014の返金処理」に「FR-ADMUG-045・FR-SPONS-020の返金処理」を加える                                                                                                                                                                 | 仮3          |
| FR-SPONS-020      | 「その広告を表示してはならない」の後に、「非公開化・停止により表示を止めた日数分(その日の一部でも止めた日を数える)の金額を、掲載期間の終わり(強制終了ではその時点)に日割りで自動で返金しなければならない。論理削除(個別削除・退会)で掲載が終わった場合は返金しない」を加える | 仮3          |
| FR-SPONS-009      | ディレクトリページの広告をページ配置と一致させる(本specはページ配置を改める)                                                                                                                                                                                                 | 仮4          |
| FR-SPONS-001・004 | 同じプロダクト・同じティアの掲載期間の重なりを受け付けない旨と、掲載期間(1〜366日)・開始日(1年以内)の上限を加える                                                                                                                                                            | 仮5・仮6     |
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
  - 2回目: 設計・タスクともNEEDS_FIXES(必須2件)。research.mdの「波及処理を持たない」の記述が表示停止の同期の処理と食い違う点と、テストとE2Eで返金の依頼を確かめるためのpaymentsの購入の行を作る補助が無い点である。いずれも直した(research.mdの3か所、2.1・10.1の補助に購入の行(テスト専用の書き込み)を加え、10.3の確認を依頼の行までにした)。軽微の指摘(残りの全額の表記、強制終了の結果の依頼した額の欄、未精算の部分索引、Componentsの表の要件、`captureEvent`の依存、briefの決定事項の帯、10.2の`_Depends`、1.3の文言の正)も直した。
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

## frontend-platformの実装で確定した契約の反映(2026-10-28、開発者の判断)

- frontend-platformが実装で確定した契約(同specのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に、開発者の判断(下流specの設計を今回改訂する)で本specの設計を合わせた。
- GraphQLの操作: 操作を各アプリの`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名を利用者側は`Client`、管理者側は`Admin`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む。`graphql()`を呼んで`.ts`のファイルに操作を書くと、操作の本文がブラウザのバンドルに残るため(frontend-platformの要件6.3)。tasks.mdの操作のタスクに、各アプリの`graphql:generate`とapiの`graphql:allowlist`の手順を書いた。
- 失敗の文言: `GraphQLClientError`でない例外に代えて画面に出す文言を`errorMessageOf(error, <プロファイル>.contactAvailable)`で選ぶ。管理者側には問い合わせの画面が無いため、`ErrorState`・`UnexpectedErrorView`に`contactHref`を渡さず、問い合わせの導線と問い合わせを促す文を出さない(frontend-platformの要件8.6・8.13)。
- bot判定: `TurnstileWidget`は非表示のウィジェットで場所を取らないため、判定の枠の表示と場所の記述を除いた。
- 変えた箇所: design.mdのAllowed Dependencies、File Structure Planの両アプリの`graphql/operations/sponsorship/`、Modified Filesの生成物と許可リストの行、`SponsorshipApplicationForm`・`MySponsorshipList`・`ResumeCheckoutButton`・`AdminSponsorshipTable`・`TerminateSponsorshipDialog`(`ConfirmActionDialog`の`failureMessageOf`と確定の失敗の表示)、Error Strategy。tasks.mdの6.1・7.2・8.1・8.2・8.3。要件は変えていない。

## 実装済みの上流との食い違いの水平展開(2026-10-30、開発者の指示)

- **Sentryの定型の通知**: content-processingの差分の分析(G-4)で、backend-platformの改訂7と技術ドキュメント`infra/004`の「同じ文言を繰り返し送る通知」が、定型の文言で繰り返し起こり得る出来事を`captureMessage`ではなく`captureEvent`で送り、文言を`logentry`、まとめる単位を`fingerprint`に置くと定めていることを確かめた。`captureMessage`は既定の`dedupeIntegration`により、同じ文言の2件目以降が捨てられる。本specの`captureMessage`をすべて`captureEvent`に改め、規約の参照と通知のタグの記述に`logentry`と`fingerprint`の置き方を加えた。通知の種類・タグ・レベルは変えていない。
- 要件と受け入れ基準は変えていない。

## 層の規則に合わせた契約の置き場所の改訂(2026-11-02、開発者の指示)

- **規則**: backend-platformの層の規則([層構成と合成ルート・依存方向](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md))により、api・eventの`src/application/**`・`src/domain/**`は`**/lib/workers/**`を型だけの読み込みでも読み込めず、application層はデータベースの接続・SQLの文・一括の書き込みを扱わない。application層が受け取る契約と識別子は`core/<ドメイン>`に置き、文を返す契約は`workers`に置いてinfrastructure層と`workers`だけが使う。`workers`の部品(メッセージの送信など)は自前のポートの形で受け取る。identity-authの`core/identity`・`UserLifecycleCommitter`の分け方に合わせた。
- **`core/sponsorship`へ移した契約**: `SponsorshipRecord`・`SponsorshipRefundRecord`・`AdminSponsorshipFilter`・`SponsorshipStore`、`EligibleProduct`・`EligibleProductReader`、`PlacedAd`・`PlacementReader`、`SponsorshipExportRecord`・`SponsorshipExport`、`NoticeRequester`(`ports.ts`)。純粋な`shuffleByTier`は`shuffle-by-tier.ts`、識別子`SPONSORSHIP_PLATFORM_TYPES`は`identifiers.ts`(凍結の`Symbol.for('sponsorship.<名前>')`、同名の単体テスト)。`workers/sponsorship`にはD1の実装(`d1-*.ts`)・購入種別の口・文を返す契約・`SPONSORSHIP_PLATFORM_MODULE`だけを置く。
- **分けた契約**: `NoticeScheduler`は文を返す`markDueStatements(today, db)`をやめ、2文を実装の中で1回の一括の書き込みで実行する`markDue(today)`と`hasPending()`の契約として`core`に置いた(文を同じ一括の書き込みに入れる呼び出し元が無いため)。`DisplayStopStore`は照会と削除を`core`、区間の記録の文を`workers`の`DisplayStopStatements`に分けた。`RefundSettlement`は照会用の見積もりを`core`の`RefundEstimator`、計画の文・申込の列の更新の文・依頼の送信を`workers`の`RefundSettlement`に分け、文を除いた結果の型`RefundOutcome`(`RefundStatus`・`RefundKind`を含む)を`core`に置いた。
- **新しいポートとinfrastructure層の実装**: apiの`SponsorshipTerminationWriter`は返金の計画を受け取らず申込の記録を受け取り、実装`D1TerminationWriter`が計画・一括の書き込み・確定の後の依頼の送信を行って`RefundOutcome`を返す形にした。eventのapplication層に`PeriodEndSettlementCommitter`(実装`D1PeriodEndSettlementCommitter`)・`SponsorshipPurgeStore`(実装`D1SponsorshipPurgeStore`)・`NoticeClaimStore`(実装`D1NoticeClaimStore`。送信の処理の依頼待ちの取得と状態の更新の書き込みの担い手が設計に無かったため加えた)を置いた。メッセージの送信は`NoticeRequester`の実装が`workers`の中で受け取るため、application層の自前の送信のポートは要らない。厳密カウンタは使わない。
- **上流の参照先**: product-launchの`ProductDirectory`・`ProductSummaryRecord`・`LaunchExport`・`ProductExport`・`PRODUCT_PLATFORM_TYPES`は`core/product`、identity-authの`UserContactDirectory`・`IDENTITY_PLATFORM_TYPES`は`core/identity`、user-profile-socialの`UserProfileDirectory`・`PROFILE_PLATFORM_TYPES`は`core/profile`。paymentsは、`PurchaseOfferPolicy`などの購入の可否の側と`PriceCatalog`が`core/payments`、`FulfillablePurchase`・`PaymentRefunds`(`dispatch`)・`RefundRequestInput`も`core/payments`、文を扱う`PurchaseFulfillment`・`FulfillmentPlan`・`PurchaseKindRegistration`・`PaymentRefundStatements`(`prepare`)が`workers/payments`(paymentsの分割に合わせた。`SponsorshipOfferPolicy`・`SponsorshipFulfillment`・`SPONSORSHIP_PURCHASE_REGISTRATION`の実装は`workers/sponsorship`のまま)。
- **変えた箇所**: design.mdのImpact・This Spec Owns・Allowed Dependencies・Revalidation Triggers・Existing Architecture Analysis・Architecture Integration・Dependency direction・File Structure Plan・「開始・終了・強制終了の通知」の説明・「表示停止の日割りの返金」と「強制終了」のシーケンス図・追跡表・コンポーネントの表・`backend-lib/core・backend-lib/workers`の各契約(識別子のコードを追加)・`SponsorshipTermination`・ジョブの依存・api/infrastructureの`D1TerminationWriter`・eventの処理の表とポートの型・Testing Strategy。tasks.mdの2.1〜2.10、3.1・3.4〜3.6・3.8、5.1〜5.3。
- 要件と受け入れ基準は変えていない。

## 上流のultras-subscriptionの区画の登録口の改訂の反映(2026-11-06)

- ultras-subscriptionの実装前のギャップ分析への開発者の決定で、料金ページの区画の登録口`PRICING_SECTIONS`の形が、adminの前例に合わせて`id`(`'<spec名>.<名詞句>'`。`CATEGORY_SECTIONS`・`DASHBOARD_CARDS`の前例)・`order`・`title`(区画の見出し。`CATEGORY_SECTIONS`の前例)・`component`になった。ページは区画ごとにfrontend-libへ移した`RecoverableSlot`で包み、1つの区画の描画や取得の失敗をその区画の位置に留め、読み込み中と失敗の間は`title`の見出しを補う。
- 本specの登録に、部品が描く見出しと同じ文言の`title`を加えた(design.mdの登録の行、tasks.mdの登録のタスク)。要件と受け入れ基準は変えていない。タスクの番号は変えていない。

---

## 実装前のギャップ分析(2026-11-18、`/kiro-validate-gap`)

### 分析の前提

- 本specの要件・設計・タスクは承認済み(受け入れ基準116件・46のサブタスク)だが、設計の最後の改訂(2026-11-02)の時点で実装済みの上流は一部だった。その後、上流のpayments・ultras-subscription・product-launch・directory-discovery・match-engine・identity-auth・user-profile-social・email-delivery・admin-foundation・frontend-platform・backend-platformと、並行のengagement・notifications・tournament-week・tournament-yearが実装された。本分析は、設計が前提にした上流の契約と現在のコードの食い違い、2026-11-02の後に加わった技術ドキュメント(`backend/009`・`010`・`012`・`013`・`016`・`017`・`019`、`frontend/010`・`012`〜`016`)との差、要件定義書の番号との差を洗い出す。
- スポンサー広告の実装(テーブル・`core/sponsorship`・`workers/sponsorship`・画面)はまだ無い。上流が先に用意したものは次のとおり。購入種別`sponsorship`(`common-lib/payments/purchase-kinds.ts`・`payment_purchases`と`payment_records`のCHECK・GraphQLの`PurchaseKind`の`SPONSORSHIP`)、監査ログの対象の種類`sponsorship`(`common-lib/admin/audit-action.ts`)、各登録口のコメントの予約(料金ページ20・設定のナビゲーション80・管理画面のメニュー90)。
- `.kiro/steering`はroadmap.mdだけで、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specと実装で代替した。
- 外部の依存の調査は不要(新しいパッケージ・外部APIなし)。
- 判断は行わず、選択肢と影響を示す。

### 照合の結果の要約

上流の契約の名前・置き場所・形は概ね設計どおりに実装されている。本specが使う登録口の`order`はすべて空いている。

- トップページ: `banner` 5(カウントダウンは10)・`aside` 10・`bottom` 10、`QUALIFIER_LIST_INSERTS`(空)
- ディレクトリ: `DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`(空)
- プロダクト詳細ページ: `banner` 10・`aside` 30(所有者10・評価20)・`bottom` 20
- `PRODUCT_DELETE_NOTICES`の30(Week 10・Year 20)
- 両方の非同期のライフサイクルの1600と、4:21の1600

`PaymentRefundStatements.prepare`、`FulfillmentPlan`の`reject`(`ineligible`だけ)、`PurchaseOffer`の`quantity`(1〜366)、`PricingSection`の`title`、`ProductDeleteNotice`の`productHandle`、GraphQLの`CheckoutStart`も設計どおりにある。技術ドキュメントの番号`backend/018`・`frontend/017`も空いている。

食い違いの多くは、2026-11-02の後に技術ドキュメントとtournament-week・tournament-yearの実装前のギャップ分析で確定した規約(返金の拒否の扱い・業務日付の計算・業務日付のカレンダー・登録口のテスト)が、本specの設計に残っているものである。実装を壊すもの2件・形の違い6件・規約の違い6件・既存の部品との重複4件・古い記述2件を挙げる。

### 要件と既存の資産の対応

| 要件                           | 使う既存の資産                                                                                                                                                                                                                                                | ギャップ                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1 申込の対象・ティア・期間     | `ProductDirectory.findSummaries('visible' \| 'not-deleted')`・`listLaunches`、`LaunchStatus`、`addBusinessDays`(`core/time`)、`Calendar`(`unavailableReasonOf`)・`LaunchDateField`(前例)                                                                      | Missing: 規則とテーブル。Constraint: C-1・D-2                                 |
| 2 価格と決済の開始             | `PriceCatalog.getPrices`、`CheckoutStarter.start`、`PRICING_SECTIONS`(20は予約済み)・`RecoverableSlot`、`TournamentEntryCheckout`(前例)、`UnavailableNotice`、`useTurnstileToken`、`ClientViewer.status`・`emailVerified`                                     | Missing: 区画・申込・再開。Constraint: S-2・D-4                               |
| 3 掲載権の確定                 | `PurchaseOfferPolicy`・`PurchaseFulfillment`・`FulfillablePurchase`、`PURCHASE_KIND_REGISTRATIONS`(未登録)、`week-entry-fulfillment.ts`のNOT NULLの違反の前進の文(前例)                                                                                       | Missing: 購入種別の口の実装と登録。Constraint: B-2・C-4                       |
| 4〜6 表示の条件・配置・並び    | `visibleProducts()`、`TOP_PAGE_SECTIONS`・`QUALIFIER_LIST_INSERTS`・`DIRECTORY_PAGE_SECTIONS`・`DIRECTORY_LIST_INSERTS`・`PRODUCT_PAGE_SECTIONS`、`MediaPicture`(`square`の32・64)、`checkExternalUrl`、`frontend/013`の区画の空の扱い                        | Missing: 部品と照会。Constraint: S-1                                          |
| 7 自分の広告一覧               | `SETTINGS_NAV_ITEMS`(80は予約済み)・`SettingsShell`、続きの読み込みの一覧の前例(`my-product-list.tsx`・`follow-list.tsx`)、`formatBusinessDateLabel`・`LaunchDateText`                                                                                        | Missing: 一覧。Constraint: D-4                                                |
| 8 開始・終了の通知             | `ScheduledJobDefinition`(`at`・`order`)、`defineMessageContract`・`MessageHandlingResult`(`defer`)、`defineEmailKind`(`transactional`)・`EmailSender`・`UserContactDirectory.findContact`                                                                     | Missing: 0:07のジョブ・処理・種別。Constraint: C-2                            |
| 9・10 管理画面の一覧と強制終了 | `ADMIN_NAV_ITEMS`(90は予約済み)、`AdminFilterBar`・`AdminDataTable`(前後のカーソル)・`cursor-trail.ts`、`ConfirmActionDialog`(`title`・`description`は`ReactNode`)・`ReasonField`・`RoleGate`、`requireAdmin`、`defineAuditAction`・`buildAuditLogStatements` | Missing: 画面・ユースケース・操作種別。Constraint: S-5・C-5                   |
| 11 退会・削除・物理削除        | ユーザーとプロダクトのライフサイクルの同期の登録口(`{ name, events, handler }`、`statementsFor(event, db)`)と非同期の登録口(1600は空き)、`PRODUCT_DELETE_NOTICES`(30は空き)                                                                                   | Missing: 4つの処理と注記。Constraint: B-2                                     |
| 12 連携と運用                  | `SponsorshipExport`の後続(data-export)、`captureEvent`(`logentry`・`fingerprint`)の前例(`refund-failure-reporting.ts`)                                                                                                                                        | Missing: 部品                                                                 |
| 13 ドキュメントとテスト        | `triggerScheduled`(`businessTime`は必須の`"HH:mm"`)、`executeLocalD1`・`sqlStringLiteral`、`admin-bootstrap.ts`、`mailpit.ts`(`waitForEmailWithSubject`など)                                                                                                  | Missing: 2つの技術ドキュメント・サービス仕様の残り。Constraint: C-6・D-3・O-1 |
| 14 日割りの自動返金            | `PaymentRefundStatements.prepare`・`PaymentRefunds.dispatch`、`refundRejectionOutcome`(`core/tournament`)、`ProductVisibilityControl`・`D1UserLifecycleCommitter`(非公開化と停止の確定)                                                                       | Missing: 区間と精算。Constraint: B-1・C-3・D-1                                |

### 上流の契約との食い違い

#### 実装を壊すもの(設計の改訂を要する)

- **B-1 返金の依頼の拒否の扱い**(tournament-weekのG4・tournament-yearのG4と同じ論点): 設計の`RefundSettlement`は、`amount_exceeds_refundable`なら金額`null`(残りの全額)で1回だけ依頼し直し、それ以外の拒否(`purchase_not_found`・`not_paid`・`invalid_amount`)を`failed`とSentryへの通知にする。現在の契約と規約とは次の点で合わない。
  - `validateRefundAmount`(`core/payments/refund-rules.ts`)は、金額`null`でも残りが0なら`amount_exceeds_refundable`を返す。管理者がStripeで全額を返金済みの購入では依頼し直しも拒否され、2回目の結果の扱いが設計に無い。
  - 技術ドキュメント[返金の後処理](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md#返金の後処理)は、拒否のコードごとの扱いを決めている。`not_paid`・`purchase_not_found`は返金不要で知らせない。`amount_exceeds_refundable`は返金済みとして運用者へ知らせる。`invalid_amount`・`invalid_request_key`は拒否として知らせ、再処理から外す。この写像は「種類ごとに写さない」とし、共用の`refundRejectionOutcome`(`core/tournament/refund-rejection.ts`)にある。
  - 設計の返金の状態(`none`・`requested`・`not_needed`・`failed`)には、返金済みと拒否に当たる値が無い。
  - `prepare`は、理由が`^[a-z0-9_]{1,64}$`に合わなければ拒否を返さず`RangeError`を投げる。設計の理由`sponsorship_terminated`・`sponsorship_display_stopped`はこの形式に合う。
  - 一部の返金(未掲載日数分)の後に残りを超える拒否が来たときに、残りの全額で依頼し直す設計の意図(要件14.7)は、`backend/017`の分類(返金済み)と両立させる必要がある。
- **B-2 未登録の購入種別の例と、登録の一覧の完全一致を前提にした上流のテスト**(tournament-yearのB-5と同じ): `sponsorship`を登録すると、次のテストが落ちる。設計の「上流への影響」は全行「契約どおり」とだけ書き、テストの書き換えを挙げていない。
  - paymentsのテストは`sponsorship`を「まだ登録されていない購入種別」の例に使う。例は`checkout-session-reflection.rejection.worker.test.ts`と、project-values.mdの「後続のspecへの申し送り」の`payments-platform-module.worker.test.ts`。申し送りは「登録する後続のspecは、まだ登録されていない別の値へ差し替える」とする。
  - 登録口を名前で参照するテストが約60ファイルある。例は`admin-nav-order.unit.test.ts`・`settings-nav-order.unit.test.ts`・`top-page-sections.browser.test.ts`・`directory-sections.browser.test.ts`・`product-page-sections.browser.test.ts`・`product-section-registries.browser.test.ts`・`core/email/kinds/index.unit.test.ts`・`core/messaging/contracts/index.unit.test.ts`・`audit-entry.unit.test.ts`・`cron-sync.unit.test.ts`・`product-lifecycle-async-handlers.unit.test.ts`と、apiとeventの各モジュールのWorkers統合テスト。多くは一覧を完全一致で確かめる。
  - 名前を参照せず振る舞いで影響を受けるテストは検索で拾えないため、apiとeventのWorkers統合テストの全件の実行が要る。

#### 形の違い(実装時に合わせる)

- **S-1 広告スペースの置き場所の描画**: 設計の`GoldListPlacement`は「1024px以上は幅280pxの列」とする。現在の描画は次のとおりで、280pxの幅を部品が自分で決められるのはトップページだけである。
  - トップページの`aside`は幅を持たず(`lg:shrink-0`だけ)、1024px未満では本文の下に積まれる。
  - ディレクトリの`aside`は`lg:w-80`(320px)の固定である。
  - プロダクト詳細ページのサイドバーは`20rem`(1280px以上は`22rem`)である。
  - その他の描画: トップページの`bottom`は幅の器を持たないため、Silverの部品が`max-w-7xl`と左右の余白を持つ必要がある。ディレクトリの差し込みは`<li data-directory-insert>`の中に描かれるため、部品は`li`を描かない。広告が0件で何も描かない区画は、`frontend/013`の`data-<ページ>-section-rendered`の印と`display: contents`の仕組みで空の列を畳む。
  - 要件5.3・ページ配置の「幅280pxのサイドバー」を、置き場所の列の幅に合わせる表現にするかの確認が要る。
- **S-2 閲覧者の状態**: `ClientViewer`は停止を`status: 'SUSPENDED'`で持ち、真偽値の`suspended`を持たない(`emailVerified`は真偽値)。
- **S-3 ライフサイクルの同期の処理**: ユーザーとプロダクトの同期の処理の契約は、apiの`infrastructure`(`user-lifecycle-sync-handler.ts`・`product-lifecycle-sync-handler.ts`)の`statementsFor(event, db)`である。登録は`{ name, events, handler }`で`order`を持たず、一覧の並びの順に動く。設計の置き場所(apiの`infrastructure/sponsorship`)と合う。
- **S-4 画像の部品**: `MediaPicture`はGraphQLの型ではなく、frontend-libの画面の部品(`display: { kind: 'square', size: 32 | 64 | 128 }`)である。Allowed Dependenciesの「GraphQLの`MediaImage`・`MediaPicture`」は、「GraphQLの`MediaImage`とfrontend-libの`MediaPicture`」に読み替える。
- **S-5 管理画面の一覧の状態**: 管理画面の一覧の規約([管理画面のシェル](../../../docs/GUIDES/tech/frontend/009-admin-console-shell.md))は、絞り込みとページのカーソルをURLの検索パラメータに持ち、不正な値を未指定として捨てる。前例は監査ログと問い合わせの一覧で、`validateSearch`・`loaderDeps`・`after`と`cursor-trail.ts`を使う。設計は`status`・`tier`をURLに持つが、前後のページを「カーソルの積み重ね」とだけ書き、カーソルをURLに持つかを定めていない。
- **S-6 決済の開始の画面**: tournament-week・yearの決済の開始(`TournamentEntryCheckout`)は、bot判定を使わず、未決済の状態に同じボタンを再び出して開始の操作をやり直す。成功で`/checkout/$purchaseId`へ遷移し、`payments_unavailable`でボタンを無効にして`UnavailableNotice`を示す。本specは要件(FR-SPONS-015)によりbot判定と「決済へ進む」の再開の操作を持つため、前例と形が異なる。失敗の文言と無効化の示し方は前例に合わせられる。

#### 規約の違い

- **C-1 業務日付の入力**: [業務日付のカレンダー](../../../docs/GUIDES/tech/frontend/012-business-date-calendar.md)(2026-11-09)は次のことを定めている。設計は開始日・終了日を`<input type="date">`(`min`・`max`は`businessToday`と上限から)と画面の`validatePeriod`で選ばせるため、規約と異なる。
  - 選べる日が多く一部の日だけが選べない日付は、共通部品の`Calendar`(`unavailableReasonOf`)で選ばせる。
  - 選べる範囲と選べない日はサーバーが`DateWindowView`(`earliest`・`latest`・`unavailable[]`)で返し、画面は規則を持たない。
  - 今日は業務日付で求め、`calendarDayOf`・`businessDateOfCalendarDay`で変換する。業務日付は`<time dateTime>`と`formatBusinessDateLabel`で示し、`DateTime`を使わない。境界の時刻(0:00)で`useBoundaryRefresh`により取り直す。
  - 仮5の重なり(同じプロダクト・同じティアの掲載中・掲載予定の期間)は、選べない日と理由として示せる。要件1.6・1.7のフォーカスアウト時の文言は、カレンダーの選べない日と理由の表示に置き換わる可能性がある。
- **C-2 0:07の定期実行**: 設計の「apiの`wrangler.jsonc`(3環境)の`triggers.crons`に`7 8 * * *`」とWranglerの型の再生成は、project-values.mdの規則と異なる。規則は「cron式はルートの`triggers.crons`だけに書き、環境へ継承する」で、`cron-sync.unit.test.ts`が`SCHEDULED_JOBS`の時刻とcron式の一致を確かめる。現在、`env.staging`・`env.prod`は`triggers`を持たない。0:07は新しい時刻になる。`SCHEDULED_RUN_BUDGETS`(4:21・23:40・23:45・0:00の300秒)への予算の追加は、`infra/003`では必須でない。
- **C-3 返金の依頼キーの形**: `backend/017`の規約と両トーナメントの実装は`<接頭辞>:<購入のID>:<理由>`(`tournament-week:<購入ID>:<理由>`)である。設計の`sponsorship-termination:<申込ID>`・`sponsorship-display-stop:<申込ID>`は、`backend/009`の条件(1〜128文字・`reflection:`で始めない)は満たすが、形が異なる。
- **C-4 購入種別の登録の名前**: 前例は`workers/<ドメイン>/<ドメイン>-registrations.ts`が`<ドメイン>_PURCHASE_KIND_REGISTRATION`を書き出し、paymentsの`purchase-kind-registrations.ts`が読み込む(`ULTRAS_`・`WEEK_TOURNAMENT_`・`YEAR_TOURNAMENT_`)。設計の`SPONSORSHIP_PURCHASE_REGISTRATION`と置き場所は前例の命名と異なる(軽微)。
- **C-5 監査ログの書き込みの条件**: [監査ログ](../../../docs/GUIDES/tech/backend/008-audit-logging.md)は、操作の確定と監査ログを同じ一括の書き込みに入れ、確定の条件を`buildAuditLogStatements`の条件(`{ kind: 'condition' }`)で表すとする。設計の`D1TerminationWriter`は条件付きの前進の文で強制終了を確定するが、監査ログの文の条件の付け方を明記していない。並行した2回の強制終了で監査ログが2件残らないことの確認が要る。
- **C-6 E2Eの置き場所**: CLAUDE.mdとtournament-week・yearの前例は、次の形を取る。設計のFile Structure Planは手順のファイルを持たず、行を作る補助をSQLの組み立てと単体テストに分けていない。
  - テストは`e2e/<アプリ>/<機能>/`に置き、画面の操作の手順`<手順の名前>-steps.ts`を並べる。
  - ローカルD1へ入れるSQLの組み立ては、単体テスト付きの`e2e/support/<名前>-fixture-sql.ts`に分ける。

#### 既存の部品との重複

- **D-1 返金の拒否の写像**: B-1のとおり、`backend/017`の写像は`core/tournament/refund-rejection.ts`にトーナメントの置き場所で共用化されている。本specが使うには、そのまま読み込むか、種類によらない置き場所(例: `core/payments`)へ移すかを決める必要がある。
- **D-2 業務日付の日数の計算**: [基準日から逆算する日程](../../../docs/GUIDES/tech/backend/019-anchor-date-schedules.md)(2026-11-18)は、業務日付の加算を共通ライブラリの`addBusinessDays`の1つで行い、機能ごとに写さず、ミリ秒の差を日数に割らないとする。設計は次の部品を持つ。
  - `common-lib/sponsorship/sponsorship-period.ts`の独自の`addBusinessDays`と`countDays`(両端を含む日数)。
  - `refund-estimate.ts`の日数の計算。
  - 共用の`addBusinessDays`・`businessWeekdayOf`は`backend-lib/core/time/business-time.ts`にあり、画面と共用する`common-lib`からは読み込めない(`common-lib/time`には表記の関数だけがある)。日数の差の共用の関数は無い(`workers/match/d1-match-directory.ts`の非公開の`datesBetween`だけ)。C-1でサーバーが選べる範囲を返す形にすれば、画面が期間の規則を持つ必要は減る。
- **D-3 技術ドキュメント`backend/018`の主題の重なり**: 設計の`backend/018-date-range-entitlements.md`の計画の内容は、既存の文書と重なる。
  - 条件付きの前進と反映の期限は`backend/009`・`017`と重なる。
  - 依頼キーと掲載の終わりの1回の依頼は`backend/009`の返金の依頼の口・`017`と重なる。
  - 権利の期間と時点の判定は`backend/010`と重なる。
  - `backend/012`が`007`へリンクする形にならい、重なる部分はリンクに留め、本specに固有の内容に絞れる。固有の内容は、両端を含む業務日付の範囲、前進の文の中の重なりの判定、表示停止の区間の日数、整数の日割り、通知の依頼待ちの列である。
- **D-4 画面の前例**: 次の前例を設計は参照していない。
  - 決済の開始の部品`TournamentEntryCheckout`と`UnavailableNotice`(S-6)。
  - 続きの読み込みの一覧(`my-product-list.tsx`・`follow-list.tsx`・`upvote-history-list.tsx`。共通部品は無い)。
  - 業務日付の表示`LaunchDateText`と`formatBusinessDateLabel`・`formatBusinessDateWithWeekdayLabel`(`common-lib/time/business-date-label.ts`)。

#### 古い記述

- **O-1** 設計とタスクに、実装が進む前の記述が残る。
  - 設計のExisting Architecture Analysisの「上流の20specは…実装済みはdev-toolingだけ」と、「上流への影響」のapiの`wrangler.jsonc`(3環境)。
  - サービス仕様のうち、次の文書は本specの決定に更新済みで、Modified Filesの該当の作業は一致の確認になる。ページ配置(ディレクトリの広告・枠の上限なし・削除の確認の注記・料金ページの区画)、法的通知の大枠の返金ポリシー(強制終了と表示停止の日割りの自動返金、削除と退会の返金なし)、料金とプラン、決済実装方針、データエクスポート。
  - 未反映の文書もある。日次タイムラインの4:21の表の`sponsorship.maintenance`(1600)と、文言規則の広告の返金の2文(ugc-moderationの停止・非公開化の通知が参照する文)。
  - 要件定義書はFR-SPONS-004に「1〜366日」を持つが、サービス仕様は要件定義書を参照するだけで366日を書いていない。
- **O-2 要件の追跡のID**: 要件定義書の改訂(2026-10-25)で、仮決定と本specの受け入れ基準に当たる要件が加わった。requirements.mdはこれらのIDを参照していない。

| 要件定義書のID    | 内容                                              | 対応する本specの受け入れ基準 | 現在の参照        |
| ----------------- | ------------------------------------------------- | ---------------------------- | ----------------- |
| FR-SPONS-003      | 掲載枠の上限なし(仮1)                             | 4.5                          | 仮1               |
| FR-SPONS-005・006 | 重なりの申込の拒否と、決済確定の時点の不付与(仮5) | 1.8・3.2                     | 仮5               |
| FR-SPONS-017      | 0:07以降の決済の当日の開始通知(仮2)               | 8.4                          | 仮2               |
| FR-SPONS-021      | 表示停止の日数分の日割りの自動返金(仮3)           | 10.11・14.1・14.3            | FR-SPONS-020      |
| FR-SPONS-022      | 表示停止日数の数え方(重なりは1日)                 | 14.2                         | 仮3               |
| FR-SPONS-023      | 個別削除・退会での返金なし                        | 11.5・14.9                   | 無し              |
| FR-ADMUG-046      | 強制終了と同時の自動返金                          | 10.7・14.4                   | FR-ADMUG-045・仮3 |

受け入れ基準の振る舞いは変わらない。

#### 情報(設計の変更は不要)

- 購入種別`sponsorship`の値は、`PURCHASE_KINDS`・購入と決済履歴のCHECK・GraphQLの`PurchaseKind`に追加済みで、本specのマイグレーションで購入種別の値を足す必要は無い。必要なのは`PURCHASE_KIND_REGISTRATIONS`への登録だけである。監査ログの対象の種類`sponsorship`も追加済みである。
- `PaymentRefundStatements.prepare`は実装済みで、同じ依頼キーの2回目は金額の検証より先に`duplicate: true`と空の文を返す(要件14.6の前提どおり)。ただし、他のspecはまだこの口を使っていない(Week・Yearは`PaymentRefunds.request`を使う)。本specが最初の利用者になるため、確定の一括の書き込みに入れる使い方の統合テストの比重が上がる。
- 表示停止の契機は発火できる。プロダクトの非公開化と復元はproduct-launchの`ProductVisibilityControl`、利用者の停止と解除は`D1UserLifecycleCommitter`が確定する。操作の画面(ugc-moderation)は未実装のため、表示停止の経路は登録口の処理を直接呼ぶテストで確かめることになる。
- [まとめて送る通知メール](../../../docs/GUIDES/tech/backend/016-batched-notification-delivery.md)は、受信設定に従う通知メールが対象である。設計の開始・終了・強制終了のメール(`category: 'transactional'`、配信停止のリンクなし)は対象外で、設計の変更は要らない。
- [集約のライフサイクルイベント](../../../docs/GUIDES/tech/backend/012-aggregate-lifecycle-events.md)は、投稿者の退会・停止をユーザーのライフサイクル、プロダクトの`deleted`を投稿者の個別削除だけに使い分ける。プロダクトを指す行はプロダクトの`purge_due`で消すとする。設計の4つの同期の処理と2つの物理削除(1600)の分け方はこれに合う。
- [判定の供給元](../../../docs/GUIDES/tech/backend/013-pluggable-decision-sources.md)の登録口は使わない(設計は削除の確認の注記だけを登録する)。
- [URLのクエリで条件を持つ一覧](../../../docs/GUIDES/tech/frontend/014-url-state-listing.md)は、ページ番号で移動する共有可能な一覧の規約で、本specの管理画面の一覧(前後のカーソル)は対象外である。
- [表示中の画面の定期再取得](../../../docs/GUIDES/tech/frontend/010-live-refresh-queries.md)の、外部サービスから戻った後の上限付きの取り直しは、paymentsの決済後のランディングが受け持つ。本specの画面は定期の取り直しを持たない(0:00の状態の切り替わりはC-1の`useBoundaryRefresh`の対象)。
- `triggerScheduled`は`{ worker, businessDate, businessTime: 'HH:mm' }`を受け取り、`businessTime`は必須である。設計の引数の並びどおりである。

### 実装の進め方の選択肢

#### 選択肢A: 設計とタスクを先に改訂してから実装する

- B・S・C・D・Oのすべてをdesign.md・tasks.mdへ反映し、変更部分のレビューを経て承認し直してから`/kiro-impl`を始める(tournament-week・yearが取った進め方)。
- ✅ `backend/017`・`019`、`frontend/012`で確定した規約を最初から書け、tournament-yearと同じ指摘の繰り返しを避けられる
- ✅ 共用化の判断(D-1・D-2)と日付の入力の形(C-1)を、実装の前に開発者が決められる
- ❌ 設計の改訂・タスクの再生成・レビューの手間が先に掛かる

#### 選択肢B: 実装の中で吸収し、Implementation Notesへ記録する

- 設計を変えずに実装を始め、各タスクで既存のコードと前例に合わせ、相違をtasks.mdのImplementation Notesと最終の報告に残す。
- ✅ すぐに着手でき、S・C-2〜C-6・Oの多くは名前と置き場所の小さな違いである
- ❌ B-1は返金の正しさ(二重の依頼・依頼の漏れ・運用者への知らせ)に関わり、実装者が設計と規約の食い違いを都度判断することになる
- ❌ C-1は画面とGraphQLの照会(選べる範囲の返却)の形を変え、タスクの境界(共有の規則・apiの照会・clientの部品)をまたぐ

#### 選択肢C: 壊すものと画面の形の判断だけ先に直す(折衷)

- B-1・B-2・C-1・D-1・D-2を先に設計とタスクへ反映し、S・C-2〜C-6・D-3・D-4・Oは実装時に既存のコードへ合わせてImplementation Notesに残す。
- ✅ 改訂の範囲を手戻りの大きい箇所に絞れる
- ❌ C-2・C-6は前例で既に確定しており、後回しにしても判断の余地が無い(先に直しても手間は小さい)

### 工数とリスク

- **工数: L(1〜2週間)** — 46のサブタスクで、2テーブル・共有モジュール・apiとeventの十数の登録・0:07の新しい定期実行・clientの広告の部品と申込・自分の一覧・adminの一覧と強制終了・E2Eにわたる。購入種別の口・返金・管理画面・ライフサイクルの規約はtournament-week・yearと上流に前例があり、作成時の見積りより統合の不確実さは小さい。C-1でカレンダーとサーバーの選べる範囲に改める場合と、B-2の上流のテストの書き換えの分だけ増える。
- **リスク: Medium** — 技術の未知は無いが、正しさの要が3つある。
  - 日割りの自動返金(強制終了と表示停止の2種類、残りの全額、返金済みの購入)の正しさ。最初の利用者になる`PaymentRefundStatements.prepare`との組み合わせも含む。
  - 掲載権の前進の文の中の重なりの判定。
  - サーバーの無作為の並びとハイドレーションの一致(5.9・6.1)。

### 設計フェーズ(改訂)への推奨

- 推奨は選択肢A。tournament-yearの実装前のギャップ分析と同じ型の指摘が並び、B-1・C-2〜C-6は前例で方針が確定しているため、設計へ写す作業が中心になる。開発者の判断が要るのは主に返金の拒否・日付の入力・共用化の論点である。
- 先に決める論点:
  - B-1・D-1: 返金の拒否を`backend/017`の分類(返金不要・返金済み・拒否)にそろえ、`refundRejectionOutcome`を共用するか。共用する場合は、`core/tournament`のまま読み込むか、種類によらない置き場所(`core/payments`など)へ移してWeek・Yearの参照を書き換えるか(水平展開)。残りを超える拒否で残りの全額で依頼し直す設計(要件14.7)を残すかと、その2回目の拒否を返金済みとして扱うかも決める。返金の状態に`already_refunded`・`rejected`を足すかも同時に決める。
  - C-1: 開始日・終了日を、`frontend/012`どおり`Calendar`とサーバーが返す選べる範囲(重なりの日を理由付きで選べない日にする)で選ばせるか、設計どおりブラウザの日付の入力欄にするか(規約の例外として文書に残す)。カレンダーにする場合、要件1.6・1.7のフォーカスアウト時の文言の扱いを決める。
  - D-2: 期間の規則の日数の計算を、`addBusinessDays`を`common-lib/time`へ移して`backend-lib/core/time`が再び書き出す形で共用するか、本specの`common-lib/sponsorship`に持つか(`backend/019`の「機能ごとに写さない」の例外になる)、C-1でサーバーだけが規則を持つ形にするか。
  - S-1: Goldの幅を、トップページだけ280pxにして他は置き場所の列の幅に合わせるか(要件5.3とページ配置の表現の改訂を伴う)。
  - C-3: 返金の依頼キーを`backend/017`の`<接頭辞>:<購入のID>:<理由>`に合わせるか、申込IDの鍵のまま残すか(購入に1つの申込が対応するため、どちらでも一意である)。
  - D-3: `backend/018`を、`009`・`010`・`017`へのリンクと本specに固有の内容に絞るか。
- 開発者に質問せず、既存のコードと規約に合わせられる事項: B-2(上流のテストの書き換えを「上流への影響」とタスクに加え、各登録のタスクの完了状態にapiとeventのWorkers統合テストの全件の実行を含める)、S-2〜S-6、C-2・C-4〜C-6、D-4、O-1、O-2(requirements.mdの参照のIDを現在の番号に合わせる)。
- Research Needed:
  - B-1: `PaymentRefundStatements.prepare`を強制終了の一括の書き込みに入れたとき、並行した2回の強制終了と、精算の再実行で依頼が1件になることを統合テストで確かめる方法(本specが最初の利用者)。
  - B-2: 本specの登録で書き換えが要る上流のテストの一覧(検索と全件の実行で洗い出す)。
  - 4:21の精算のメッセージの送信が、同じ時刻の他のspec(100〜1500・1700・2300)と共有する300秒の予算に収まるかの見積り(設計は送信だけで重い処理をeventへ渡すため、影響は小さい見込み)。

## 実装前のギャップ分析の決定事項(2026-11-18に開発者が確定)

### 開発者が確定した論点

前節の「先に決める論点」の6件を開発者へ1件ずつ質問し、次のとおり確定した。G4は推奨と異なる選択肢で確定した。

| #   | 論点(前節の番号)                         | 確定した案                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 他の選択肢                                                                                          | 影響する箇所                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 返金の拒否の扱い(B-1・D-1)               | 拒否を`backend/017`の3分類にそろえる。`not_paid`・`purchase_not_found`は返金不要で知らせない。`amount_exceeds_refundable`は返金済みとして運用者へ知らせる。`invalid_amount`・`invalid_request_key`と理由の形式違反の`RangeError`は、拒否として知らせて再処理から外す。残りを超える拒否で残りの全額(金額`null`)で1回だけ依頼し直す設計(要件14.7)は残し、その2回目の拒否を返金済みとする。写像`refundRejectionOutcome`を`core/tournament/refund-rejection.ts`から`core/payments`へ移して共用し、tournament-week・yearの参照と単体テストを書き換える(水平展開)。返金の状態(`termination_refund_status`・`stop_refund_status`と`RefundStatus`)に`already_refunded`・`rejected`を足す | `core/tournament`のまま読み込む / 依頼し直しをやめてすぐ返金済みにする(要件14.7の改訂) / 設計どおり | 要件14.7・14.8、設計の`RefundSettlement`・`RefundOutcome`・テーブルのCHECK・自分の一覧と管理画面と通知の返金の表示・Sentryの通知の種類、tournament-week・yearの`week-entry-follow-up.ts`・`year-entry-follow-up.ts`の読み込み先、`backend/017`の写像の置き場所の記述 |
| G2  | 掲載開始日・終了日の入力(C-1)            | `frontend/012`どおり共通部品の`Calendar`(`unavailableReasonOf`)で選ばせる。サーバーが、選んだプロダクトとティアごとに、選べる範囲(今日〜365日後)と、仮5で重なる掲載中・掲載予定の日を理由付きの選べない日として返し、画面は期間の規則を持たない。要件1.6・1.7のフォーカスアウト時の文言は、選べない日の理由とサーバーの検証の文言に置き換える                                                                                                                                                                                                                                                                                                                                    | 画面が範囲の規則を持ちサーバーは重なりだけ返す / 設計どおり日付の入力欄                             | 要件1.4〜1.8(改訂)、設計の`SponsorshipApplicationForm`・`sponsorshipOffer`の照会(選べる範囲の返却)・`validatePeriod`の使い方、`frontend/017`の記述、ページ配置と文言規則の申込の区画                                                                                 |
| G3  | 業務日付の日数の計算の置き場所(D-2)      | `addBusinessDays`と、新しい両端を含む日数の関数を`common-lib/time`に置き、`backend-lib/core/time/business-time.ts`はそれを書き出し直す(既存の利用者の読み込み先は変えない)。本specの規則と画面は`common-lib/time`を使い、`sponsorship-period.ts`に独自の関数を持たない                                                                                                                                                                                                                                                                                                                                                                                                           | 本specに持つ(`backend/019`の例外) / サーバーだけが計算する                                          | 設計の`sponsorship-period.ts`・`refund-estimate.ts`、`common-lib/time`の新しい関数と単体テスト、`backend/019`の共通ライブラリの記述                                                                                                                                  |
| G4  | Goldの広告の列の幅(S-1)                  | **推奨と異なる案で確定。** 全ページでGoldの縦の並びの部品を280pxにする。ディレクトリ(320px)とプロダクト詳細ページ(20rem・22rem)の広い列では余白が残る。要件5.3とページ配置は変えず、上流のページの列の幅も変えない                                                                                                                                                                                                                                                                                                                                                                                                                                                               | トップページだけ280pxにし他は列の幅に合わせる(推奨だった案) / 上流の列を280pxにそろえる             | 設計の`GoldAdStack`・`GoldListPlacement`・`GoldSidebarPlacement`の幅と置き方(広い列の中での位置)、ブラウザテストの幅の確認                                                                                                                                           |
| G5  | 返金の依頼キーの形(C-3)                  | `backend/017`の`<接頭辞>:<購入のID>:<理由>`にそろえ、`sponsorship:<購入ID>:sponsorship_terminated`・`sponsorship:<購入ID>:sponsorship_display_stopped`にする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 設計どおり申込IDのキー                                                                              | 要件14.6(広告ごと・種類ごとに一意は保たれる)、設計の`RefundSettlement`の依頼キー・Testing Strategy、上流・後続specへの影響の依頼キーの記述                                                                                                                           |
| G6  | 技術ドキュメント`backend/018`の範囲(D-3) | `backend/018`を新設し、条件付きの前進・反映の期限・返金の依頼の口・権利の期間の判定は`backend/009`・`010`・`017`の節へリンクする。本文は、両端を含む業務日付の範囲、前進の文の中の重なりの判定、表示停止の区間の日数、整数の日割り、日次の開始・終了の通知の依頼待ちの列に絞る                                                                                                                                                                                                                                                                                                                                                                                                   | 設計どおり自己完結で書く / 新設せず`backend/010`へ足す                                              | 要件13.4、設計のTechDocsの記述、`docs/GUIDES/tech/backend/README.md`の行                                                                                                                                                                                             |

### 既存のコードと規約に合わせて決めた事項

開発者に質問せず、既存のコード・規約・tournament-week・yearの決定に合わせて次のとおり扱う(設計の改訂で反映する)。

- B-2: 本specの登録で落ちる上流のテストの書き換えを、設計の「上流への影響」とタスクに加える。paymentsのテストの未登録の購入種別の例`sponsorship`は、まだ登録されていない別の値へ差し替える(project-values.mdの申し送り)。各登録のタスクは、登録の前に上流のテストを検索で洗い出し、完了状態にapiとeventのWorkers統合テストの全件の実行を含める。
- S-1(G4以外): トップページの`bottom`ではSilverの部品が`max-w-7xl`と左右の余白を持つ。ディレクトリの差し込みの部品は`li`を描かない。0件の区画は`frontend/013`の`data-<ページ>-section-rendered`の印で空の列を畳む。
- S-2〜S-6: 現在の契約の形に合わせる。対象は`ClientViewer.status === 'SUSPENDED'`、同期の処理の`statementsFor(event, db)`と`order`の無い登録、frontend-libの`MediaPicture`(`square`の32・64)。管理画面の一覧の絞り込みとカーソルはURLの検索パラメータ(`status`・`tier`・`after`)と`cursor-trail.ts`で持ち、不正な値は未指定として捨てる。決済の開始の失敗の文言と`payments_unavailable`の`UnavailableNotice`は`TournamentEntryCheckout`の前例に合わせる。
- C-2: cron式`7 8 * * *`はapiの`wrangler.jsonc`のルートの`triggers.crons`だけに足し、`cron-sync.unit.test.ts`の期待値を合わせる。0:07の予算は`SCHEDULED_RUN_BUDGETS`に足さない(`infra/003`で必須でない)。
- C-4: 購入種別の登録は`workers/sponsorship/sponsorship-registrations.ts`が`SPONSORSHIP_PURCHASE_KIND_REGISTRATION`を書き出し、paymentsの`purchase-kind-registrations.ts`が読み込む。
- C-5: 強制終了の監査ログの文には条件(`guard`)を付けない。前進の文が条件を満たさなければNOT NULLの違反で一括の書き込み全体(監査ログを含む)が取り消されるため、並行した2回の強制終了でも監査ログは1件になる。前進の文と同じ条件を監査ログの文に付けると、前進の文の後では状態が既に`terminated`のため、監査ログの文が必ず取り消される。統合テストで監査ログが1件であることを確かめる(設計の改訂のレビューの指摘により、当初の「条件を付ける」を改めた)。
- C-6: E2Eはtournament-week・yearの前例どおり`e2e/client/`・`e2e/admin/`の直下に置き(`sponsorship.e2e.test.ts`・`sponsorship-termination.e2e.test.ts`)、画面の操作の手順`sponsorship-steps.ts`・`sponsorship-termination-steps.ts`を並べる。ローカルD1へ入れるSQLの組み立ては、単体テスト付きの`e2e/support/sponsorship-fixture-sql.ts`に分ける。CLAUDE.mdのディレクトリ構成は機能ごとのサブディレクトリを書くが、サブディレクトリはauth・inquiryだけで、近い前例の平置きに合わせた(設計の改訂のレビューの指摘により、当初のサブディレクトリを改めた)。
- D-4: 続きの読み込みの一覧は`my-product-list.tsx`などの前例に、業務日付の表示は`LaunchDateText`と`formatBusinessDateLabel`に合わせる。
- O-1: 設計の古い記述(実装済みの上流、`wrangler.jsonc`の3環境、GraphQLの`MediaPicture`)を直す。サービス仕様のうち更新済みのもの(ページ配置・法的通知の大枠・料金とプラン・決済実装方針・データエクスポート)は、Modified Filesの作業を一致の確認に改める。
- O-2: requirements.mdの受け入れ基準が参照する要件IDを、要件定義書の現在の番号に合わせる(FR-SPONS-003・005・006・017・021〜023、FR-ADMUG-046)。G2の要件の改訂と同時に行う。

### 上流・他specへの影響

- tournament-week・tournament-year: G1で`refundRejectionOutcome`の読み込み先を`core/payments`へ書き換える。振る舞いとテストの期待値は変えない。`backend/017`の写像の置き場所の記述を合わせる。承認済みのspecの記録(両specのdesign.md・tasks.md)は書き換えず、移した後の置き場所は本specの設計を正とする(tournament-yearの前例)。
- product-launch・match-engine・notificationsなど`addBusinessDays`の利用者: G3で`core/time`が`common-lib/time`の関数を書き出し直すため、読み込み先は変わらない。`backend/019`の共通ライブラリの記述を合わせる。
- payments: B-2でテストの未登録の購入種別の例を差し替える。`refundRejectionOutcome`の受け入れ先になる(G1)。
- directory-discovery: G4で上流のページの列の幅は変えない。

## 設計の改訂(2026-11-18、`/kiro-spec-design sponsorship`)

- **発見の種別**: Extension(light discovery)。上流は実装済みで、契約の照合は「実装前のギャップ分析」で済んでいるため、決定G1〜G6と規約に合わせた事項の反映に要る既存のコードだけを読み直した。読み直したのは、`core/time/business-time.ts`(`addBusinessDays`と非公開の解析・整形)、`core/tournament/refund-rejection.ts`とWeek・Yearの`*-entry-follow-up.ts`の拒否の扱い(`RangeError`を`invalid_reason`として`rejected`にする形)、`workers/week-tournament/incident-tags.ts`の`safeTagOf`、`core/payments/refund-rules.ts`の`validateRefundAmount`(残りが0なら金額`null`でも`amount_exceeds_refundable`)、`workers/payments/payment-refunds.ts`の`prepare`の判定の順、`frontend/012`の`DateWindowView`と暦日の写しと境界の取り直しの規約、clientの`components/product/launch-date-calendar.ts`・`launch-date-field.tsx`(画面に直接置く`Calendar`)・`components/time/use-boundary-refresh.ts`、product-launchのGraphQLの`LaunchDateWindow`、各ページの区画の描画済みの目印(`data-<ページ>-section-rendered`)、apiの`infrastructure/admin/audit-log-statements.ts`の`guard`、`e2e/client`・`e2e/admin`・`e2e/support`の配置、adminの監査ログの一覧の経路と`client/src/graphql/week-tournament.ts`・`head/page-heads.ts`である。外部の依存の調査は不要(新しいパッケージ・APIなし)。
- **参照したスキルと規則**: cc-sddの`kiro-spec-design`の規則(design-discovery-light・design-synthesis・design-review-gate)、CLAUDE.mdの技術規則の参照先([業務日付のカレンダー](../../../docs/GUIDES/tech/frontend/012-business-date-calendar.md)、[集計値と残り時間を表示し続ける画面](../../../docs/GUIDES/tech/frontend/013-live-scoreboard.md)の区画の規約、[単一敗退のブラケット](../../../docs/GUIDES/tech/backend/017-single-elimination-brackets.md)の返金の後処理、[基準日から逆算する日程](../../../docs/GUIDES/tech/backend/019-anchor-date-schedules.md)の業務日付の加算、[監査ログ](../../../docs/GUIDES/tech/backend/008-audit-logging.md)、[非同期処理](../../../docs/GUIDES/tech/infra/003-async-processing.md)の定期実行、[依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析))。
- **要件の改訂**: G2で1.6・1.7・1.8を、カレンダーの選べない日と理由で示す形に改めた。0:00を越えたときの取り直し(1.11)を加えた。G1で10.6・14.7・14.8・14.11を改め、依頼の形式の誤りの拒否(14.12)を分けて加えた。O-2で要件定義書の現在の番号(FR-SPONS-003・005・006・017・021〜023、FR-ADMUG-046)を参照に加えた。受け入れ基準は118件になった。`requirements.md`の「実装前のギャップ分析での決定」にG1〜G6の行を加えた。
- **統合(synthesis)**:
  - 一般化: 業務日付の加算と両端を含む日数を`common-lib/time/business-date-arithmetic.ts`へ置いた。暦日の解析・UTCの0:00・整形の補助も同じ場所へ移し、`core/time/business-time.ts`はそれを読み込む(G3)。返金の拒否の写像を`core/payments/refund-rejection.ts`へ移した(G1)。clientの暦日の写しを中立の`components/time/business-date-calendar.ts`へ移した(G2)。いずれも振る舞いを変えない移設で、利用者のテストの期待値を変えない。
  - 既存に合わせる: 選べる範囲は`frontend/012`の`DateWindowView`の形(`earliest`・`latest`・理由付きの`unavailable`)とし、product-launchの`LaunchDateWindow`にならってGraphQLの型を置いた。次の部品と規約は前例に合わせた。購入種別の登録の定数(`SPONSORSHIP_PURCHASE_KIND_REGISTRATION`)、拒否の文言の唯一の出どころ(`SPONSORSHIP_OFFER_REJECTION_MESSAGES`)、Sentryの指紋とタグの形(`['sponsorship', <異常の種類>]`)、E2Eの手順とSQLの組み立て、clientの取得の補助と`page-heads.ts`、adminの一覧のURLの検索パラメータとカーソルの積み重ねは、tournament-week・yearと監査ログの一覧に合わせた。
  - 一般化しなかったもの: `safeTagOf`(`workers/week-tournament/incident-tags.ts`)は共用の場所へ移さず、本specは`core/ids`の`isUppercaseUlid`を直接使う(2行の規則で、week-tournamentを読み込まないため)。
  - 簡素化: 選べる範囲の照会は、選べない開始日でもエラーにせず終了日の範囲を`null`で返す形にした。画面は開始日の範囲から理由を求めるため、照会の失敗の分岐が通信の失敗だけになる。範囲の外の日の理由(過去・遠すぎる・開始日より前・366日超え)はサーバーが返さず、画面が範囲の種類から決める(`frontend/012`の`earliest`・`latest`の外の扱いと同じ)。監査ログの文には条件を付けない(前進の文の取り消しで一括の書き込み全体が取り消されるため)。
- **設計への反映**: 次の節を改めた。
  - 概要と境界: Overview(Impact・Goals)、Boundary Commitments(共用化の移設・登録の定数・技術ドキュメントの範囲)、Allowed Dependencies(実装された契約の形)、Revalidation Triggers(返金の拒否の写像・共用の日付の計算・カレンダーの規約)、上流への影響(共用化の3行、cronのルートだけの登録、上流のテストの書き換えの一覧)。
  - 構成: Existing Architecture Analysis、Dependency direction、Technology Stack、File Structure Plan(`common-lib/time`・`core/payments/refund-rejection.ts`・`sponsorship-registrations.ts`・`sponsorship-incident-reporting.ts`・clientの`components/time/`・`graphql/sponsorship.ts`・`sponsorship-messages.ts`・`sponsorship-period-field.tsx`・`sponsorship-date-reasons.ts`・`sponsorship-period-text.tsx`・`sponsorship-period-window.graphql`・adminの`admin-sponsorship-search.ts`・apiの`sponsorship-scheduled-jobs.unit.test.ts`・E2Eの手順とSQLの組み立て)、Modified Files。
  - 流れと対応: System Flows(選べる範囲の節を新設、返金の拒否の3分類、依頼キー、監査ログの条件、強制終了の返金が残りの全額のときの表示停止の扱い)、追跡表、コンポーネントの表。
  - 契約と画面: `computePeriodWindows`・共用化の部品・`listPaidPeriods`・`readPeriodWindow`・返金の状態・`reportSponsorshipIncident`・GraphQLの型と操作の表、clientの申込の画面とカレンダー・自分の一覧・Goldの幅280px(G4)・区画の空の畳み方、adminの一覧と結果の文言。
  - その他: 技術ドキュメント(G6)、データモデル、エラーの表と文言、Monitoring、Testing Strategy、Migration Strategy、Supporting References。
- **レビューゲート**: 機械的な検査で次の3点を確かめた。要件の118件の受け入れ基準のIDがすべて設計にあること(範囲の表記と`N.\*`を含む字句の照合)。古い記述が残っていないこと(返金の状態の`failed`、申込IDの依頼キー、`type="date"`、独自の`countDays`、3環境のcron、`SPONSORSHIP_PURCHASE_REGISTRATION`)。新しい部品のファイルがファイル構成にあること。新しいサブエージェントによる独立した判断のレビューを2回行った。
  - 1回目: NEEDS_FIXES(必須3件・軽微8件)。必須は3件だった。research.mdの決定事項C-5(監査ログの条件)・C-6(E2Eのサブディレクトリ)と設計の食い違いは、根拠のある設計の側に決定事項の記述をそろえた。選べない開始日での照会の失敗の扱いが未定義だった点は、エラーにせず`end: null`を返す形にした。軽微の8件もすべて直した。共用化する補助の範囲、範囲の切り詰めと空の範囲、強制終了の返金が残りの全額のときの表示停止の二重の依頼、タグの値の検査とログ、部品の名前の衝突、新しいテストのファイルの分類、取り直しの後の申込のボタンの無効、tasks.mdの作り直し(設計の承認の後)である。
  - 2回目: PASS。軽微の3件(表示停止の返金額0円の優先、そのテスト、エラーの表の`startsOn`の形式違反の場面と文言)も直した。
- **残る作業**: 設計の承認の後に`/kiro-spec-tasks sponsorship`でタスクを作り直す。要件・設計の変更でtasks.mdは古いため、spec.jsonのタスクの承認を外した。作り直しでは、共用化の移設(G1〜G3)を最初のタスクに置き、移した部品の利用者の既存のテストが期待値を変えずに通ることを完了状態にする。上流のテストの書き換え(B-2)は、各登録のタスクに検索と全件の実行として含める。

## タスクの計画の再生成(2026-11-18、`/kiro-spec-tasks sponsorship`、承認待ち)

- 承認済みの要件(118件)と改訂した設計から、既存の`tasks.md`(46のサブタスク)を引き継いでタスクを作り直した(11の大きなタスク・52のサブタスク)。
- **主な変更**:
  - 共用化の移設(G1〜G3)を最初のグループ1に置き、以降のグループの番号を1つずつずらした。移設の完了状態は、移した部品の利用者の既存のテストが期待値を変えずに通ることである。業務時刻の部品(1.1)は、apiとeventのWorkers統合テストの全件も完了状態に含める。
  - 申込のフォームのタスクを、掲載期間のカレンダーの欄(8.2)と申込のフォーム(8.3)に分けた。
  - 返金の精算のタスクから、運営者への知らせ(3.9)を分けた。
  - 選べる範囲の照会(2.1の純粋な関数・3.1の掲載期間の一覧・4.2のユースケース・5.1のGraphQL)を各タスクに加えた。
  - 返金の状態(返金済み・拒否)と依頼キー(`sponsorship:<購入ID>:<理由>`)、cron式のルートだけの登録、E2Eの手順とSQLの組み立ての構成、管理画面の一覧のURLの検索パラメータと`head`、Goldの幅280px(G4)、技術ドキュメントの範囲(G6)と共用化に合わせた既存の3文書の修正も、各タスクに反映した。
  - 登録口に追記する各タスクに、上流のテストの書き換え(B-2)を含めた。apiとeventのWorkers統合テストの全件の実行は、3.11・4.8・5.2・6.3・7.1・9.1の完了状態にまとめ、他の登録のタスクはまとめ先を明記した。
- **レビュー**: 要件の118件の受け入れ基準のIDがすべてタスクにあることを機械的に確かめた。新しいサブエージェントによる独立したタスクグラフの健全性レビュー(independent)を2回行った。
  - 1回目: NEEDS_FIXES(必須2件・軽微6件)。必須は2件だった。掲載期間の表示の部品の担当が並行のタスクで衝突していた点は、7.3へ移して直した。登録の後のWorkers統合テストの全件の実行が一部に無かった点は、完了状態に加えるか、まとめ先を明記して直した。軽微の6件もすべて直した。1.1の全件の実行、3.9の分割、全体の検査を最後へ移すこと、design.mdの古いタスク番号(11.1・11.2・11.4)、取得の補助の担当、管理画面の`head`である。管理画面の`head`はdesign.mdの管理画面の節にも`buildAdminPageHead`を加えた。
  - 2回目: PASS。任意の指摘(3.10の担当範囲の明記)も反映した。
- タスクの承認(`approvals.tasks.approved`)は開発者の確認を待つ。
