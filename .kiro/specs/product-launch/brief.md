# Brief: product-launch

## Problem

投稿者は、作ったプロダクトを登録し、ローンチ日を予約して1対1のマッチに臨みたい。敗北しても間隔を空ければ再ローンチできる仕組みが、本サービスの核心的な価値である(要件定義書1.1・3.2)。ローンチ日の選択可能範囲(23:40を境とする)、マッチ直前・マッチ中の変更禁止、再ローンチの禁止期間、論理削除後の物理削除とマッチ記録の扱いを、正確に制御する必要がある。

## Current State

- プロダクトの実装は無い。
- 再ローンチ間隔の制限(敗北後7日、Ultrasは2日)と予約禁止の条件が[再ローンチルール](../../../docs/GUIDES/service/overview/006-relaunch-rules.md)に定義済みである。
- `/my/products`・新規・編集の画面配置が[ページ配置](../../../docs/GUIDES/service/design/002-page-layouts.md)に定義済みで、モックアップは無い。
- user-profile-socialでハンドル基盤が、ultras-subscriptionでプラン判定ができている前提である。

## Desired Outcome

- プロダクト機能(FR-PRDCT-001〜021)が動作する。
  - ロゴ・名称・タグライン・カテゴリ・ハンドル・外部URL・マークダウンの説明文(20,000文字)・スクリーンショットの登録と編集
  - 23:40を境にしたローンチ日の選択(カレンダーUI)
  - マッチ直前・マッチ中の変更と削除の禁止
  - 論理削除から14日以内の物理削除(マッチ記録は紐付けだけを解除する)
  - 公開プロフィールへのローンチ履歴の表示
- 再ローンチ制限(FR-RELCH-001〜005)が動作する。
  - 敗北後の禁止期間(無料7日・Ultras 2日)
  - 予選が進行中なら予約不可
  - 勝者はトーナメント結果の確定まで予約不可
- 再ローンチ可否ポリシーに拡張点があり、tournament-week・tournament-yearが「トーナメント結果確定待ち」の条件を供給できる。
- プロダクトカテゴリのマスタ管理(FR-ADMCF-006〜008)が動作する。
  - モデレーター以上による追加・編集・削除
  - カテゴリ名は30文字以内、ディレクトリ絞り込み用のハンドルは一意
  - 標準カテゴリ「その他」は削除不可、プロダクトが紐付くカテゴリの削除は拒否
- プロダクトライフサイクルイベント(非公開化・削除・復元)の契約と、可視プロダクトの判定条件がある。
- 利用者側の`/my/products`・新規・編集の画面がある(UIデザインはこのspec内で行う)。

## Approach

ローンチ(1回のマッチ参加予約)をプロダクトとは別のエンティティとして扱い、再ローンチ履歴とマッチ記録の紐付けを明確にする。トーナメントに関する再ローンチ条件は、後続specがポリシーへ条件を追加する形で実現し、このspecは条件を差し込める拡張点だけを持つ。

## Scope

- **In**:
  - 4.5(FR-PRDCT-001〜021)、4.8(FR-RELCH-001〜005)
  - FR-ADMCF-006〜008
  - プロダクトライフサイクルイベントと可視プロダクトの判定条件
  - 利用者側の自分のプロダクト管理画面、管理画面のカテゴリマスタ
  - ユーザーライフサイクルイベントへのハンドラ登録
  - 上記のテスト
- **Out**:
  - ペアリングとマッチ(match-engine)
  - ディレクトリとプロダクト詳細ページ(directory-discovery)
  - プロダクトの検索索引(directory-discovery)
  - 管理者による非公開化(ugc-moderation)

## Boundary Candidates

- プロダクト情報とその編集
- ローンチ予約と再ローンチの可否判定
- プロダクトカテゴリのマスタ
- プロダクトのライフサイクル

## Out of Boundary

- マッチの進行と勝敗
- 公開ページでの表示構成

## Upstream / Downstream

- **Upstream**: user-profile-social(ハンドル基盤)、admin-foundation、ultras-subscription、media-pipeline、content-processing
- **Downstream**: match-engine、directory-discovery、sponsorship、tournament-week、tournament-year、ugc-moderation、public-api

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: match-engine(マッチ状態による変更禁止)、tournament-week(再ローンチ条件)

## Constraints

- 業務時刻はUTC-08:00固定で、23:40・23:45などの境界は[日次タイムライン](../../../docs/GUIDES/service/overview/007-daily-timeline.md)を正とする
- 要件の論点(要件フェーズで開発者に確認する): FR-RELCH-004により、Week優勝作はYearの結果が確定するまで最長でほぼ1年再ローンチできないが、これが意図どおりか。トーナメントで敗退した後に禁止期間(7日・2日)が掛かるかも未定義
