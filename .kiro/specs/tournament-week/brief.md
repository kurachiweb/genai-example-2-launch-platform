# Brief: tournament-week

## Problem

予選の勝者は、参加費を払うと(Ultras加入者は免除)、その週のProduct of the Week決定トーナメントに挑める。シード数の算出、ローンチ日順の隣接配置、不戦勝の連鎖、参加が0件や1件の場合の終了処理など、ブラケットの規則は複雑である。決済期限・組み合わせ決定・各ラウンドの時刻が日次タイムラインと噛み合わないと、決済済みなのに参加できないといった事故が起きる。

## Current State

- トーナメントの実装は無い。
- シード数S=2P−Nの算出、組み合わせ手順、不戦勝の伝播が[Weekトーナメントルール](../../../docs/GUIDES/service/overview/004-week-tournament-rules.md)に、月曜の決済突合などの時刻が[日次タイムライン](../../../docs/GUIDES/service/overview/007-daily-timeline.md)に定義済みである。
- match-engineで汎用マッチモデルが、paymentsで決済・返金・突合の共通部品が、notificationsで通知イベントの契約ができている前提である。

## Desired Outcome

- Weekトーナメント(FR-TOURW-001〜021)が動作する。
  - 予選の勝者に参加資格を与え、都度決済($5)または有料プランの免除で参加を確定する
  - 決済期限は翌週月曜23:35(セッション作成は23:00まで)
  - 月曜23:45に組み合わせを決める。シードは「N未満で最大の2の冪」になるよう票数と最終Upvote時間で選び、非シードはローンチ日順に隣接させる
  - 火曜から毎日1ラウンドを行い、不戦勝の連鎖、参加0件・1件の場合の終了処理、賞の授与を行う
  - 参加が129以上なら翌週と並行表示する
  - 組み合わせ決定前に削除されたら資格を失い、自動返金する
  - 期限から組み合わせ決定までの間に決済を突合する
- 汎用のブラケットエンジン(シード・組み合わせ・ラウンド進行・不戦勝)があり、tournament-yearが再利用できる。
- トーナメントの表示(トップページやプロダクト詳細ページの区画、ブラケット表示)がある。
- 再ローンチ可否ポリシーへ「トーナメント結果確定待ち」の条件を供給する。
- Ultras加入イベントを受けて、未完了の参加費決済セッションを失効させる(FR-PPLAN-007)。
- 通知イベント(開始予告・結果・受賞)を発行する。
- ライフサイクルイベントのハンドラ(退会・停止・非公開化による棄権扱いなど)がある。

## Approach

ブラケットの構築とラウンド進行を、Week・Yearに共通のエンジンとして純粋なドメインロジックで実装し、単体テストで規則の具体例(N=13など)を網羅する。Week固有の部分は、参加資格・期限・開催曜日の設定値として分離する。

## Scope

- **In**:
  - 4.13(FR-TOURW-001〜021)
  - ブラケットエンジン、参加費決済のフルフィルメント、自動返金と突合の適用
  - トーナメントの表示区画、通知イベントの発行
  - 再ローンチ条件の供給、Ultras加入イベントとライフサイクルイベントへのハンドラ
  - 上記のテスト
- **Out**:
  - Product of the Year(tournament-year)
  - マッチと投票の仕組み(match-engine)
  - Stripeとの通信(payments)

## Boundary Candidates

- 参加資格と参加費
- ブラケットエンジン
- ラウンドの進行と賞
- 返金と決済の突合
- トーナメントの表示

## Out of Boundary

- 予選のペアリング
- 通知メールの送信判定

## Upstream / Downstream

- **Upstream**: match-engine、payments、notifications、ultras-subscription、product-launch
- **Downstream**: tournament-year、ugc-moderation、data-export

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: product-launch(再ローンチ可否ポリシー)、ultras-subscription(参加費免除)

## Constraints

- 時刻と処理順は[日次タイムライン](../../../docs/GUIDES/service/overview/007-daily-timeline.md)を正とする
- 要件の論点(要件フェーズで開発者に確認する):
  - 有料プランによる参加費免除の判定時点と、決済済み後に加入した場合の返金の有無
  - トーナメントで敗退した後に再ローンチの禁止期間が掛かるか(FR-RELCH-004周辺)
- 参加数が多い場合の組み合わせ計算は、CPU時間とD1のバインド変数上限に収まるよう分割する
