# Brief: email-delivery

## Problem

本サービスには、メールを送る機能が多数ある。メールアドレス確認・パスワードリセット・各種変更通知・管理者招待・モデレーション措置通知・エクスポート完了通知・問い合わせ返信通知・広告の開始終了通知・マッチ通知などである。送信経路(Cloudflare Email ServiceのEmail Sending)はpublic betaで、ローカルではMailpitを使う。送信レート上限・一時的エラー・バウンスへの対処をspecごとに実装すると、品質がばらつき、送信不能時の検知も漏れる。

## Current State

- Dockerfileでローカル用のMailpitが導入され、ポート48041で常駐する。
- tech-stack.mdで、本番はCloudflare Email Service、テンプレートはJSX emailの採用が決まっている。
- メール送信のコードは存在しない。

## Desired Outcome

- DIで差し替えられる送信インターフェースがあり、本番・staging用のEmail Service実装とローカル用のMailpit実装を持つ。
- 送信はQueuesを経由してeventのconsumerが非同期に行う。送信レート・日次上限に達した分は破棄せず、上限リセット後に送信する。一時的エラーは再試行し、それでも失敗したらSentryで検知する(FR-NOTIF-012〜014を全メール種別に一般化)。
- Queues Event Subscriptionsでバウンス・苦情・拒否イベントを受け取り、抑止リストとして記録する(FR-NOTIF-015、SW-015)。他specが参照できる照会手段がある。
- JSX emailによるテンプレート基盤(共通レイアウト、テキストパート、送信者情報を差し込む区画)があり、日本語の件名と本文の送信を検証済みである。
- トランザクションメールと通知メールの区別がある(配信停止ヘッダーの付与はnotificationsが担う)。
- `docs/GUIDES/tech/external`(メール送信サービスの仕様・制限・リトライ戦略)と`infra`(非同期処理)に記載がある。

## Approach

送信はすべて「キュー投入→consumerで送信」の一本の経路に統一し、呼び出し側は種別とテンプレート入力を渡すだけにする。プロバイダはインターフェースで抽象化し、betaのAPI変更や代替プロバイダへの切り替えに備える。

## Scope

- **In**:
  - 送信インターフェースと2つの実装(Email Service・Mailpit)
  - 送信キューとconsumer、上限超過時の遅延送信、再試行、失敗検知
  - バウンス・苦情・拒否の検知と抑止リスト
  - テンプレート基盤と共通レイアウト
  - 上記のテストとtechドキュメント
- **Out**:
  - 個々のメールの文面とテンプレート(各ドメインspec)
  - 通知設定・配信停止・送信者情報の設定(notifications)
  - 抑止状態の画面表示(notifications、FR-NOTIF-016)

## Boundary Candidates

- 送信プロバイダの抽象化
- 非同期送信と流量制御
- 配信不能イベントの取り込み
- テンプレートの描画基盤

## Out of Boundary

- 通知の受信可否の判定
- 配信停止トークンとRFC 8058の受付

## Upstream / Downstream

- **Upstream**: backend-platform(Queuesディスパッチャ・ログ・Sentry)
- **Downstream**: identity-auth、admin-foundation、notifications、inquiry-chat、sponsorship、ugc-moderation、content-reporting、data-export

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: notifications(通知メール固有の要件)

## Constraints

- 文面と件名の規則は[文言規則](../../../docs/GUIDES/service/design/003-text-and-copy-rules.md)に従う
- 実現性チェック(2026-10-03)の指摘:
  - Email Sendingは2026-04にpublic betaとなりGA前のため、API変更に備えてインターフェースで抽象化する。Workers Paidが前提で、月3,000通を超えると従量課金になる
  - 生MIMEで非ASCII本文を7bitのまま送ると拒否される報告があるため、構造化された`send()`を使い、日本語の件名・本文で送信テストを行う
  - jsx-emailはWorkersでの公式な動作手順が無い。minify・prettyプラグインと`Code`コンポーネントを使わず、早い段階で`*.worker.test.ts`によりworkerd上での描画とバンドルサイズを検証する。peerの`@types/react`がReact 19.3と合わない点にも注意する
- ローカルのMailpitへの送信方式(HTTP APIかSMTPか)は、workerdの制約を踏まえて設計フェーズで決める
