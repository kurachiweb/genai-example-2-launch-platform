# Brief: tournament-year

## Problem

Product of the Weekの優勝作は、年に1度のProduct of the Year決定トーナメントに挑める。決勝日は、欧州サッカーのリーグ最終節に合わせて管理者が設定する。決勝日から逆算した決済期限・組み合わせ決定・各ラウンドの日程と、参加数を64以下に保つ制約を、正確に扱う必要がある。

## Current State

- Yearトーナメントの実装は無い。
- Weekとの差分(参加数P≤32、決勝日は管理者が設定)が[Yearトーナメントルール](../../../docs/GUIDES/service/overview/005-year-tournament-rules.md)に定義済みである。
- tournament-weekで汎用のブラケットエンジンができている前提である。

## Desired Outcome

- Yearトーナメント(FR-TOURY-001〜021)が動作する。
  - Weekの優勝作に参加資格を与える
  - 決済期限は決勝6日前の23:35、組み合わせは同日23:45に決める
  - 参加は最大64(シード最大32)
  - 1回戦は参加数に応じて決勝の0〜5日前に行う
  - その他の規則はWeekと同じ型で、賞を授与する
- 最上位管理者が決勝実施日を設定できる(FR-ADMCF-001〜005、監査ログの対象)。
  - 対象年内の日曜日のみ選べる
  - 現在から8日後より前は選べない
  - 前年の決勝実施日から64週以上空く日付は拒否する
  - 未設定なら5月の最終日曜日を決勝実施日とする
  - 決勝7日前以降は変更できない
- 再ローンチ可否ポリシーへ、Yearの結果確定待ちの条件を供給する。
- 通知イベント(開始予告・結果・受賞)を発行する。

## Approach

tournament-weekのブラケットエンジンを再利用し、Year固有の部分(参加資格・日程の算出・決勝日の設定)だけを実装する。日程の算出は決勝日を起点とする純粋関数にして、単体テストで境界を網羅する。

## Scope

- **In**:
  - 4.14(FR-TOURY-001〜021)
  - FR-ADMCF-001〜005と管理画面の決勝日設定
  - Year固有の参加資格・日程・表示
  - 上記のテスト
- **Out**:
  - ブラケットエンジンそのもの(tournament-week)
  - Weekトーナメント

## Boundary Candidates

- Yearの参加資格
- 決勝日の設定と日程の算出
- Yearの表示と賞

## Out of Boundary

- ブラケットの汎用ロジック
- 決済の共通処理

## Upstream / Downstream

- **Upstream**: tournament-week、admin-foundation
- **Downstream**: ugc-moderation、data-export

## Existing Spec Touchpoints

- **Extends**: tournament-weekのブラケットエンジンを再利用する(改修が必要になった場合はtournament-weekの設計と整合させる)
- **Adjacent**: notifications(トーナメント開始予告の送信時刻)

## Constraints

- 要件の論点(要件フェーズで開発者に確認する):
  - 前年の決勝日が未設定(既定値)のとき、それを「設定されている」と扱うか
  - 初年度は期間の起点が無いため、参加が64を超え得る(FR-TOURY-005の「シード最大32」と矛盾し得る)
