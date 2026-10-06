# Brief: notifications

## Problem

投稿者は、自分のマッチの開始予告と結果を知りたい。フォロワーは、フォロー中の作り手のマッチ開始や受賞を知りたい。一方で、法令上(LR-005)次のことが求められる。

- 受信可否を種類ごとに選べること(初期値はすべて受信しない)
- 送信者情報を表示すること
- RFC 8058の1クリックとリンクの両方で、ログイン不要の配信停止ができること

## Current State

- 通知の実装は無い。
- 通知メールの件名と本文構成が[文言規則](../../../docs/GUIDES/service/design/003-text-and-copy-rules.md)に、送信時刻が[日次タイムライン](../../../docs/GUIDES/service/overview/007-daily-timeline.md)に定義済みである。
- email-deliveryで送信基盤と抑止リストが、match-engineでマッチイベントができている前提である。

## Desired Outcome

- 通知メール(FR-NOTIF-001〜007)が送信される。
  - マッチ開始予告: 前日23:45のペアリング後
  - 勝敗結果: 当日23:45。トーナメントの準決勝以前で勝った場合は開始予告と統合する
  - フォロワーへの開催通知: 同日分を1通に集約する
  - フォロワーへの受賞通知
  - いずれも送信者情報を表示する
- 通知設定ページで、種類ごとに受信可否を設定できる(初期値はすべて受信しない)。バウンス・苦情・拒否で抑止中ならその旨を表示する(FR-NOTIF-005・016)。
- 配信停止(FR-NOTIF-008〜011)が動作する。
  - `List-Unsubscribe`と`List-Unsubscribe-Post`ヘッダーを付ける
  - eventでワンクリックのPOSTを受け付ける
  - 本文中のリンクから`/unsubscribe/{token}`で確認操作だけで停止できる
  - トークンはユーザーと種別ごとに発行し、HMACでハッシュ化して保存し、退会まで有効とする
- 最上位管理者が送信者情報(事業者名・連絡先メールアドレス・物理的郵送先住所、各200文字以内)を設定できる(FR-ADMCF-019、監査ログの対象)。
- 通知イベントの契約があり、match-engine・tournament-week・tournament-yearが発行できる。

## Approach

通知の要否判定(受信設定・抑止リスト・集約)をこのspecに集約し、送信はemail-deliveryの経路に乗せる。トーナメントはこのspecより後に実装されるため、このspecが通知イベントの契約(開始予告・結果・受賞)を先に定義し、トーナメントのspecがそれを発行する。

## Scope

- **In**:
  - 4.24のうちFR-NOTIF-001〜011・016
  - FR-ADMCF-019、LR-005
  - 通知設定ページ、配信停止ページ、eventの配信停止エンドポイント
  - 通知イベントの契約
  - 上記のテスト
- **Out**:
  - 送信の流量制御・再試行・抑止リストの記録(email-delivery、FR-NOTIF-012〜015)
  - トランザクションメール(各ドメインspec)
  - トーナメントのイベント発行の実装(tournament-week・tournament-year)

## Boundary Candidates

- 通知の種類と受信設定
- 通知対象者の決定と集約
- 配信停止(ヘッダー・リンク・トークン)
- 送信者情報の設定

## Out of Boundary

- メールの送信経路
- マッチ・トーナメントの進行

## Upstream / Downstream

- **Upstream**: match-engine、email-delivery、user-profile-social(フォロー関係)、admin-foundation
- **Downstream**: tournament-week、tournament-year、data-export(通知設定)

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: email-delivery(送信基盤)

## Constraints

- 要件の論点(要件フェーズで開発者に確認する): Yearでは組み合わせが決勝の6日前に決まり、1回戦は決勝の0〜5日前に行われる。トーナメントの開始予告を組み合わせ決定時に送るか、マッチ前日に送るか
- 配信停止トークンのハッシュ化はNFR-SECUR-006の方式に従う
