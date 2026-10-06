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

掲載期間・ティア・表示可否の判定をこのspecに集約し、各ページへは広告区画として提供する。決済はpaymentsのフルフィルメントのポートを実装して受け取る。返金そのものは管理者がStripe上で手動で行う前提とし、このspecは目安額の算出までを持つ。

## Scope

- **In**:
  - 4.15(FR-SPONS-001〜016)、FR-ADMUG-023〜024、LR-002
  - 申込画面、自分の広告一覧、各ページの広告区画
  - 開始・終了通知のジョブ、管理画面の一覧と強制終了
  - ライフサイクルイベントへのハンドラ
  - 上記のテスト
- **Out**:
  - Stripeとの通信と決済画面の共通部品(payments)
  - 返金の自動実行(要件上は目安額の表示まで)

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

- **Extends**: なし
- **Adjacent**: directory-discovery・match-engine(広告区画を置くページの所有者)

## Constraints

- 要件の論点(要件フェーズで開発者に確認する):
  - ティアごと・日ごとの最大掲載枠数が未定義
  - 当日の0:07以降に申し込んだ当日開始の広告には、開始通知が送られない
- 広告の表示はFCPを悪化させないよう、SSRで初期表示する
