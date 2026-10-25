# Brief: sponsorship

## Problem

過去にローンチしたプロダクトの投稿者は、日数単位で広告を出して露出を増やしたい。広告はLegend・Gold・Silverの3ティアで、トップ・ディレクトリ・詳細の各ページにティア別に表示する。法令上、広告であることのラベル表示と`rel="sponsored"`が必要である(LR-002)。管理者は不適切な広告を理由付きで強制終了し、未掲載日数分の返金目安を知る必要がある。

## Current State

- 広告の実装は無い。
- 料金(Silver/Gold/Legendが$3/$8/$20 per日)が[料金とプラン](../../../docs/GUIDES/service/overview/002-pricing-and-plans.md)に、開始・終了通知の時刻(0:07)が[日次タイムライン](../../../docs/GUIDES/service/overview/007-daily-timeline.md)に定義済みである。
- モックアップにスポンサー広告の部品と、トップ・ディレクトリ・詳細ページ上の広告スペースがある。

## Desired Outcome

- 広告機能(FR-SPONS-001〜016)が動作する。
  - 過去にローンチしたプロダクトで申し込み、ティアと期間を1日単位で選ぶ
  - 料金は日数×単価の都度決済
  - トップ・ディレクトリ・詳細の各ページにティア別で表示し、同じティア内はランダム順にする
  - `rel="sponsored"`と広告ラベルを付ける
  - 自分の広告一覧を表示する
  - 0:07に開始・終了のメールをQueues経由で送る
  - 非公開・停止・削除中のプロダクトの広告は表示しない
- 管理者側で、申込状況の一覧と、理由付きの強制終了とメール通知ができる。強制終了時は未掲載日数分の返金目安額を表示する(FR-ADMUG-023〜024、監査ログの対象)。
- 決済のフルフィルメントとして、広告の掲載権を確定する。

## Approach

掲載期間・ティア・表示可否の判定をこのspecに集約し、各ページへは広告区画として提供する。決済はpaymentsのフルフィルメントのポートを実装して受け取る。返金の扱い(管理者がStripe上で手動で行うか、paymentsの`PaymentRefunds`で自動で行うか)は要件フェーズで決める(Constraintsの論点)。

## Scope

- **In**:
  - 4.15(FR-SPONS-001〜016)、FR-ADMUG-023〜024、LR-002
  - 申込画面、自分の広告一覧、各ページの広告区画
  - 開始・終了通知のジョブ、管理画面の一覧と強制終了
  - ライフサイクルイベントへのハンドラ
  - 上記のテスト
- **Out**:
  - Stripeとの通信と決済画面の共通部品(payments)
  - 返金の実行(2026-10-24に開発者が仮3で強制終了と表示停止の日割りの自動返金を確定した。本specは金額を指定してpaymentsへ依頼し、実行はpaymentsが行う)

## Boundary Candidates

- 広告の申込と掲載権
- 広告の表示選択(ティア・ランダム・可視性)
- 開始・終了の通知
- 管理者の強制終了

## Out of Boundary

- ページそのものの構成
- 決済の反映処理

## Upstream / Downstream

- **Upstream**: directory-discovery、payments、match-engine(トップページ)、email-delivery、admin-foundation
- **Downstream**: ugc-moderation(統計の収益)、data-export

## Existing Spec Touchpoints

- **Extends**: ultras-subscription(料金ページ`/pricing`の区画の登録口`PRICING_SECTIONS`へ、スポンサー広告の区画を`order` 20で加える)、payments(購入種別`sponsorship`の`PurchaseKindRegistration`・`PurchaseOfferPolicy`・`PurchaseFulfillment`を実装する)、admin-foundation(`ADMIN_NAV_ITEMS`へスポンサー広告`/sponsorships`(`order` 90)を加える)
- **Adjacent**: directory-discovery・match-engine(広告区画を置くページの所有者)

## Constraints

- 要件の論点(要件フェーズで開発者に確認した。2026-10-24に全て確定。末尾の「決定事項」を参照):
  - ティアごと・日ごとの最大掲載枠数が未定義
  - 当日の0:07以降に申し込んだ当日開始の広告には、開始通知が送られない
  - 強制終了・プロダクトの非公開化・利用者の停止に伴う返金を自動で行うか。本briefは従来「返金は管理者がStripe上で手動で行う」としていたが、法的通知の大枠の返金ポリシーは広告の強制終了の未掲載日数分と表示停止の日数分を「自動で返金する」と書いており食い違う(roadmapのRequirement Ambiguities、paymentsのQ1)。自動で行う場合は、paymentsの`PaymentRefunds`(全額・一部の金額を指定した非同期の返金の依頼)を呼び、Stripeを直接呼ばない。どちらに決めても、法的通知の大枠か要件定義書のどちらかの改訂が要る
- 広告の表示はFCPを悪化させないよう、SSRで初期表示する
- 料金ページの区画は`PricingSection`の`{ id: 'sponsorship.sponsorship-pricing', order: 20, component }`。ページの枠と法的通知へのリンクはultras-subscriptionが持つ
- 価格はpaymentsの`PriceCatalog`で照会し、決済はpaymentsの`CheckoutStarter`で始める。`PurchaseKindRegistration`に登録するServiceIdentifierは、本specが`backend-lib/workers/<ドメイン>`の共有モジュールでapi・eventの両方に束縛する(反映が両アプリで動くため、paymentsのRevalidation Triggers)。決済の受付の有効期限は作成から1時間(payments仮4)
- 開始・終了・強制終了のメールの宛先は、identity-authの`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`)で引き、`users`を直接読まない
- データエクスポートに広告の情報を出す場合は、本specが出力用の部品を持ち、data-exportは本specのテーブルを直接読まない
- 4:21のジョブとユーザーライフサイクルの波及処理の`order`は、roadmapの帯の割り当ての表で本specに割り当てた1600番台(1600〜1699)を使う。波及処理の各ドメインの範囲は0〜9999で、10000以上はidentity-auth専用である。帯の値は同じ時刻・同じ種類の中で上流のspecの後に動くため、上流の値より前に動く必要がある処理があれば設計時に開発者へ確認する。プロダクトライフサイクルの波及処理の`order`は、product-launchが契約で定める規則に従う
- 管理画面のE2Eの管理者ログインは、admin-foundationの`e2e/support/admin-bootstrap.ts`を使う

## 決定事項(2026-10-24に開発者が確定)

- 掲載枠の上限は設けず全件を表示する(仮1)。当日の0:07以降に決済が反映された当日開始の広告には反映の直後に開始通知を送る(仮2)。ディレクトリにも広告を表示する(仮4)。同じプロダクト・同じティアの期間の重なりは受け付けない(仮5)。掲載期間は1〜366日、開始日は今日から365日後まで(仮6)。
- 仮3は推奨と異なる選択肢Bで確定した。強制終了は未掲載日数分を、ユーザー停止・プロダクト非公開化による表示停止は表示を止めた日数分を、paymentsの`PaymentRefunds`(金額指定)で日割りで自動的に返金する。表示停止の返金は掲載の終わりに1回だけ求めて依頼する。要件定義書FR-ADMUG-024・FR-PYMNT-005・FR-PYMNT-010・FR-SPONS-016の改訂が要る。上の「Scope」のOutの返金の行と「Constraints」の返金の論点は、この決定に置き換わる。
