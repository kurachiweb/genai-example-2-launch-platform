# Brief: engagement

## Problem

サポーターと探索者は、プロダクトのローンチごとに作り手へ感想や質問を伝えたい。プロダクトの良し悪しは5段階の評価で示したい。コメントは3階層までの返信に対応し、削除後の匿名化や、管理者が無効化した評価の除外など、他の機能と連動する規則がある。

## Current State

- コメントと評価の実装は無い。
- プロダクト詳細ページのモックアップに、コメント欄と評価の表示がある(`mockups/src/routes/client/p/$handle`)。
- directory-discoveryでプロダクト詳細ページと区画の仕組みが、content-processingでマークダウンの基盤ができている前提である。

## Desired Outcome

- コメント機能(FR-COMNT-001〜010)が動作する。
  - ローンチ単位のマークダウンコメント(2,000文字以内)、3階層までの返信
  - トップレベルは10件ずつのカーソル方式
  - 編集と削除、削除後の「削除されたコメント」表示
  - 削除から14日後に本文を空にし、ユーザーとの紐付けを解除する(匿名化)
  - 外部リンクへの`rel="ugc"`付与、Turnstileによるbot対策
- 評価機能(FR-RATNG-001〜007)が動作する。
  - 1〜5の評価をユーザーとプロダクトごとに1件(再評価は上書き)、取消は物理削除
  - 自分のプロダクトは評価できない
  - コメント投稿時に評価も付けられる
  - 管理者が無効化した評価を平均から除外する(無効化の状態を持つデータモデルを含む)
- プロダクト詳細ページに、評価平均とローンチごとのコメントの区画がある。
- 退会・停止・非公開化に応じた表示とデータ処理が、ライフサイクルイベントのハンドラとして実装されている。

## Approach

コメントと評価は「プロダクトに対する利用者の反応」として1つのspecにまとめ、詳細ページへの区画として提供する。評価の無効化と、コメントの非公開化の管理操作はugc-moderationに任せる。このspecは、それらの状態を表示と集計に反映する規則だけを持つ。

## Scope

- **In**:
  - 4.10(FR-COMNT-001〜010)、4.11(FR-RATNG-001〜007)
  - プロダクト詳細ページの評価・コメント区画
  - 匿名化の日次処理(14日後)
  - ライフサイクルイベントへのハンドラ登録
  - 上記のテスト
- **Out**:
  - コメントの非公開化と評価の無効化の管理画面(ugc-moderation)
  - コメントの通報(content-reporting)

## Boundary Candidates

- コメントのスレッド構造と編集・削除
- コメントの匿名化
- 評価とその集計
- 詳細ページの区画

## Out of Boundary

- 管理者の判断操作
- 通報の受付

## Upstream / Downstream

- **Upstream**: directory-discovery、content-processing
- **Downstream**: public-api、ugc-moderation、content-reporting、data-export

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: directory-discovery(詳細ページの構成)

## Constraints

- 日次の匿名化処理は[日次タイムライン](../../../docs/GUIDES/service/overview/007-daily-timeline.md)の日次バッチ時刻に従う
- 入力上限は書記素単位で数える
