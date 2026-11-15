# Brief: data-export

## Problem

利用者は、プライバシー法(LR-006)に基づき、自分のデータを機械可読な形で持ち出せなければならない。対象はプロフィール・プロダクト・コメント・決済履歴・問い合わせと添付ファイルなどである。全ドメインのデータを1つのZIPにまとめる処理は重く、Workersの制約内で非同期に行う必要がある。

## Current State

- エクスポートの実装は無い。
- エクスポートZIPの構造と各JSONの項目が[ユーザーデータエクスポート仕様](../../../docs/GUIDES/service/features/001-user-data-export.md)に定義済みである。
- 先行する全ドメインspecで、エクスポート対象のデータが揃っている前提である。

## Desired Outcome

- エクスポート機能(FR-UDATA-001〜009)が動作する。
  - 設定ページから要求する
  - eventのQueue consumerが、JSONと画像・添付ファイルをストリーミングでZIP化する
  - R2のマルチパートアップロードでファイル用非公開バケットへ保存する
  - 完了・失敗をメールで通知する
  - ダウンロードは本人のみで、同一オリジンの配信経路(SW-011)を使う
  - 7日後に削除する(DR-005)
- エクスポート要求のレート制限(ユーザー単位で24時間に3回、FR-RLMIT-006・018)が動作する。
- ZIPの内容が仕様書の構造と一致することを、テストで検証している。

## Approach

各ドメインが「自分のデータをエクスポート用の形で返す」ポートを実装し、このspecはそれらを順に呼び出してZIPへ書き込む組み立て役に徹する。CPU時間とメモリの制約に収めるため、ストリーミングで逐次書き出す。

## Scope

- **In**:
  - 4.4(FR-UDATA-001〜009)
  - FR-RLMIT-006・018、DR-005、LR-006
  - エクスポートの要求画面、生成処理、通知、ダウンロード、期限切れ削除
  - 各ドメインの出力用の部品の呼び出しとZIPへの書き込み(出力用の部品そのものは各ドメインspecが持つ)
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

- **Extends**: なし(各データドメインspecが持つ出力用の部品を呼ぶだけ。先行specに部品が無い場合は、そのspecの部品として追加し、そのspecの再検証として扱う)
- **Adjacent**: media-pipeline(ファイルの読み出しと配信)

## Constraints

- 実現性チェック(2026-10-03)の指摘: fflateの非同期APIはWeb Workerまたは`worker_threads`が前提で、workerdでは動かない。同期ストリーミングの`Zip`と`ZipDeflate`を使い、CPU時間に注意する
- Workersのメモリ上限(128MB)とCPU時間(30秒)に収めるため、大きなファイルは逐次処理する
- 各ドメインspecが出力用の部品を持ち、本specはそれを呼ぶだけで、他のドメインのテーブルを直接読まない(roadmapのShared seams「データエクスポートの出力」)。現在の部品は次のとおりで、名前と形は各specのdesign.mdを正とする
  - identity-auth: `AccountExport`(`find(userId)`、識別子`IDENTITY_PLATFORM_TYPES.AccountExport`、`IDENTITY_PLATFORM_MODULE`でapi・eventの両方に束縛)。`account.json`の`email`・`emailVerifiedAt`・`registeredAt`・`mfaEnabled`と、ZIPに書かない仮名化ID`pseudonymousId`を返し、退会済み・物理削除済みの利用者では`undefined`を返す。`plan`・`notificationSettings`・`apiKeys`はそれぞれultras-subscription・notifications・public-apiの部品が、`profile.json`の`nickname`・`handle`と`manifest.json`の`user.handle`・ZIPのファイル名のハンドルはuser-profile-socialの部品が返す
  - payments: `PaymentHistoryExport`(`listAll(pseudonymousId)`。仮名化IDはidentity-authの`AccountExport.find`で得る。`payments.json`の形はデータエクスポートの文書と一致させる)
  - ultras-subscription: `UltrasPlanExport`(`find`。`plan.status`の値)
  - inquiry-chat: `InquiryExport`(`listPage`、1回20件・IDの昇順、識別子`INQUIRY_EXPORT_TYPES.InquiryExport`をeventで束縛)。添付の実体は`attachments[].fileId`でmedia-pipelineの`MediaFiles.openContent`から読み、ZIP内のパスは本specが組み立てる
  - 後続のspec(user-profile-social・product-launch・match-engine・engagement・tournament-week・tournament-year・sponsorship・notifications・content-reporting・public-api)も、それぞれ出力用の部品を持つ前提で設計する
- 生成はeventの非同期の処理で行うため、各部品がeventで束縛されていることを確かめる
- 完了の通知メールの宛先は、identity-authの`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`)で引く
- 4:21のジョブとユーザーライフサイクルの波及処理の`order`は、roadmapの帯の割り当ての表で本specに割り当てた2100番台(2100〜2199)を使う。波及処理の各ドメインの範囲は0〜9999で、10000以上はidentity-auth専用である。帯の値は同じ時刻・同じ種類の中で上流のspecの後に動くため、上流の値より前に動く必要がある処理があれば設計時に開発者へ確認する
