# Brief: data-export

## Problem

利用者は、プライバシー法(LR-006)に基づき、自分のデータを機械可読な形で持ち出せなければならない。対象はプロフィール・プロダクト・コメント・決済履歴・問い合わせと添付ファイルなどである。全ドメインのデータを1つのZIPにまとめる処理は重く、Workersの制約内で非同期に行う必要がある。

## Current State

- エクスポートの実装は無い。
- エクスポートZIPの構造と各JSONの項目が[ユーザーデータエクスポート仕様](../../../docs/GUIDES/service/features/001-user-data-export.md)に定義済みである。
- 先行する全ドメインspecで、エクスポート対象のデータが揃っている前提である。

## Desired Outcome

- エクスポート機能(FR-UDATA-001〜008)が動作する。
  - 設定ページから要求する
  - eventのQueue consumerが、JSONと画像・添付ファイルをストリーミングでZIP化する
  - R2のマルチパートアップロードでファイル用非公開バケットへ保存する
  - 完了・失敗をメールで通知する
  - ダウンロードは本人のみで、同一オリジンの配信経路(SW-011)を使う
  - 7日後に削除する(DR-004)
- エクスポート要求のレート制限(ユーザー単位で24時間に3回、FR-RLMIT-005・015)が動作する。
- ZIPの内容が仕様書の構造と一致することを、テストで検証している。

## Approach

各ドメインが「自分のデータをエクスポート用の形で返す」ポートを実装し、このspecはそれらを順に呼び出してZIPへ書き込む組み立て役に徹する。CPU時間とメモリの制約に収めるため、ストリーミングで逐次書き出す。

## Scope

- **In**:
  - 4.4(FR-UDATA-001〜008)
  - FR-RLMIT-005・015、DR-004、LR-006
  - エクスポートの要求画面、生成処理、通知、ダウンロード、期限切れ削除
  - 各ドメインのエクスポート用ポートの実装(必要に応じて先行specのコードへ追加する)
  - 上記のテスト
- **Out**:
  - 他サービスへの直接転送
  - エクスポート対象外のデータの判断(仕様書を正とする)

## Boundary Candidates

- エクスポートの要求と流量制御
- 各ドメインからのデータ収集
- ZIPのストリーミング生成と保存
- 配信と期限切れ削除

## Out of Boundary

- 各ドメインのデータ構造の変更
- アカウントの削除(identity-auth)

## Upstream / Downstream

- **Upstream**: content-reporting、inquiry-chat、public-api、および全データドメイン(identity-auth・user-profile-social・product-launch・match-engine・engagement・payments・ultras-subscription・tournament-week・tournament-year・sponsorship・notifications)
- **Downstream**: launch-readiness

## Existing Spec Touchpoints

- **Extends**: 各データドメインspecに、エクスポート用ポートの実装を追加する
- **Adjacent**: media-pipeline(ファイルの読み出しと配信)

## Constraints

- 実現性チェック(2026-10-03)の指摘: fflateの非同期APIはWeb Workerまたは`worker_threads`が前提で、workerdでは動かない。同期ストリーミングの`Zip`と`ZipDeflate`を使い、CPU時間に注意する
- Workersのメモリ上限(128MB)とCPU時間(30秒)に収めるため、大きなファイルは逐次処理する
