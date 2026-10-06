# Brief: match-engine

## Problem

本サービスの中核は、プロダクト同士を1対1で対戦させ、Upvoteの数で勝敗を決める予選である。毎日決まった時刻に、ペアリング(23:45)、マッチ開始(0:00)、結果確定(23:40)を正確に実行する必要がある。勝敗の判定規則も厳密である。退会・停止・非公開化が起きたら、マッチを即時に終了しなければならない。マッチと投票のモデルは、Week・Yearのトーナメントでも同じものを使う。

## Current State

- マッチと投票の実装は無い。
- ペアリング(同カテゴリ優先のランダム)と勝敗判定の具体例が[予選ルール](../../../docs/GUIDES/service/overview/003-qualifier-rules.md)に、Cronの時刻と処理順が[日次タイムライン](../../../docs/GUIDES/service/overview/007-daily-timeline.md)に定義済みである。
- トップページのモックアップが`mockups/src/routes/client/top`にあり、マッチカードやピッチSVGなどの部品がある。

## Desired Outcome

- 汎用のマッチモデルがある。対戦するローンチ、開始と終了の時刻、Upvote確定値、最終Upvote時間、結果を持ち、トーナメントのspecが再利用できる。
- 予選(FR-GAME-001〜014)が動作する。
  - 毎日23:45に翌日分をペアリングする(同カテゴリ優先、余りはランダム、最後の余りは不戦勝)
  - 0:00に開始し、23:40に確定する
  - 勝敗は「票数→同数で1票以上なら最終Upvote時間が早い方→0対0は両者敗北」の順で判定する
  - 退会・停止・非公開化が起きたら即時終了し、相手を勝ちにする(ライフサイクルイベントのハンドラとして実装)
- Upvote(FR-VOTE-001〜011)が動作する。
  - 投票と取消はマッチ中のみ(取消は物理削除)
  - 1ユーザー1マッチにつき1票、自分のプロダクトとその対戦相手には投票不可
  - Turnstileによるbot対策
  - 停止されたユーザーの票は即時に論理削除する
  - 公開プロフィールへUpvote履歴を表示する
- トップページがモックアップに沿って実装され、予選の一覧を表示する。後続specが区画(トーナメント・広告)を追加できる。
- マッチの開始・確定などのイベントを発行し、notificationsが購読できる。

## Approach

マッチと投票を予選・トーナメント共通のモデルとして設計し、「誰と誰をいつ対戦させるか」(ペアリング)だけを予選固有の処理として持つ。日次ジョブはbackend-platformのCronディスパッチャに登録し、処理順は日次タイムラインに従う。

## Scope

- **In**:
  - 4.6(FR-VOTE-001〜011)、4.7(FR-GAME-001〜014)
  - 汎用マッチモデルとマッチイベントの発行
  - 予選の日次ジョブ(ペアリング・開始・確定)
  - トップページ、プロフィールのUpvote履歴の区画
  - ユーザー・プロダクトのライフサイクルイベントへのハンドラ登録
  - 上記のテスト
- **Out**:
  - トーナメントのブラケット(tournament-week・tournament-year)
  - 通知メール(notifications)
  - ディレクトリへの掲載(directory-discovery)
  - 管理者によるマッチ予定の取り消し操作(ugc-moderation)

## Boundary Candidates

- マッチと投票のモデル
- 予選のペアリング
- マッチの進行(開始・確定・即時終了)
- トップページの構成

## Out of Boundary

- ブラケットの構築
- 決済と参加資格

## Upstream / Downstream

- **Upstream**: product-launch
- **Downstream**: directory-discovery、notifications、tournament-week、tournament-year、ugc-moderation、public-api

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: product-launch(ローンチ予約)、tournament-week(マッチモデルの再利用)

## Constraints

- 日次ジョブの時刻と順序は[日次タイムライン](../../../docs/GUIDES/service/overview/007-daily-timeline.md)を正とする(23:40確定→23:45ペアリング)
- ペアリングと集計は、D1のバインド変数上限(100個)とCPU時間の制約を踏まえ、分割した書き込みを`db.batch()`でまとめる
- 要件の論点(要件フェーズで開発者に確認する): 同一カテゴリに3つ以上ある場合の組み合わせ方(ランダムか登録順か)
- モックアップのURLは`/client/`接頭辞付きで、本番のトップページは`/`である
