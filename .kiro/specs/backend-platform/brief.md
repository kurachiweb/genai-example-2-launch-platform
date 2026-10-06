# Brief: backend-platform

## Problem

APIサーバー(`apps/api`)とイベントサーバー(`apps/event`)には、全ドメインが共通で必要とする骨格が無い。必要なのはDIとクリーンアーキテクチャの層構成、D1アクセス、Cron・Queuesの入口、ログ、エラートラッキング、レート制限、Turnstile検証である。共通骨格が無いまま各ドメインspecが実装を始めると、層構成やエラー処理がspecごとに異なり、保守できなくなる。

## Current State

- `apps/api`・`apps/event`・`apps/db`・`apps/backend-lib`は空ディレクトリで、compose.yamlのbind mount先(`apps/{api,event}/{db,lib}`)だけが用意されている。
- ORMはDrizzle v1 RC単体の採用が決まっている([ADR-0001](../../../docs/adr/0001-drizzle-orm-over-mikroorm.md))。
- ローカル開発手順として、`apps/api`で`wrangler d1 migrations apply`を実行し、eventは同じ`/workspace/.wrangler/state`を共有する方針が決まっている。

## Desired Outcome

- `apps/db`: Drizzleのスキーマ配置規約、D1接続、`textNoCase`ヘルパー、ID規約(ULID、FTSテーブルのみ連番、DR-009)、作成・更新日時と論理削除の共通カラム規約がある。`drizzle-kit generate`と`migrations_pattern`によるWranglerでの適用がローカルで動く。
- `apps/backend-lib`: UTC-08:00業務時刻のユーティリティ、HMACによるハッシュ化(NFR-SECUR-006)、共通エラー型などがある。
- `apps/api`・`apps/event`: Hono+Inversifyによるクリーンアーキテクチャの骨格(ドメイン・アプリケーション・インフラ・プレゼンテーション層)、リクエスト単位のDIコンテナ、ヘルスチェックがある。
- 両アプリのWrangler設定に全バインディング(D1・R2の3バケット・Queues・Durable Objects・Rate Limiting・Images・Service Bindings・Cron Triggers)とstaging/prod環境が定義され、`secrets.required`と`vars`の規約が確立している。
- LogTapeによるJSONログ(PIIマスキング、DR-008)とSentry(IPアドレス除去、NFR-OBLOG-003)が組み込まれている。
- Cronディスパッチャ(UTCのcron式から業務時刻のジョブへ振り分け)とQueue consumerディスパッチャ(メッセージ種別ごとの振り分け、再試行とデッドレターの方針)があり、各specはジョブとメッセージ種別を登録するだけで済む。
- レート制限基盤として、Durable ObjectsによるAlarmリセット付きの厳密カウンタ(汎用)、Rate Limiting bindingのミドルウェア、全Worker共通のIP単位制限(FR-RLMIT-008)がある。
- Turnstileのsiteverify検証ミドルウェア(SW-018)がある。
- `docs/GUIDES/tech/backend`(アーキテクチャ)・`db`(設計原則・マイグレーション手順)・`infra`(非同期処理設計)の初版がある。

## Approach

`apps/api`と`apps/event`は同じ層構成と同じDIの組み立て方を採り、`apps/backend-lib`の共通部品を使う。CronとQueuesは「登録制のディスパッチャ」として基盤が入口だけを持ち、ジョブの中身は各ドメインspecが追加する。Inversifyのデコレータ変換とメタデータの扱いは、Wrangler(esbuild)・Vitest(Vite 8/Oxc)・Bunの3つの変換経路すべてで同じ結果になることをスモークテストで保証する。

## Scope

- **In**:
  - `apps/db`の土台(接続・共通カラム・`textNoCase`・ID規約・マイグレーション設定)
  - `apps/backend-lib`の共通ユーティリティ
  - api・eventの骨格とDI、Wrangler設定
  - ログとSentry
  - Cron・Queuesのディスパッチャ
  - レート制限基盤(FR-RLMIT-008を含む)
  - Turnstile検証
  - 上記のテスト(`*.unit.test.ts`・`*.worker.test.ts`)とtechドキュメント
- **Out**:
  - GraphQL・RESTの層(api-gateway)
  - メール送信(email-delivery)
  - ファイル・画像処理(media-pipeline)
  - 各ドメインのテーブルと業務ロジック
  - 個別機能のレート制限ルール(FR-RLMIT-001〜007などは各ドメインspec)

## Boundary Candidates

- DB接続とスキーマ規約
- DIとクリーンアーキテクチャの骨格
- Wrangler設定とバインディング規約
- 観測性(ログ・エラートラッキング)
- 非同期実行の入口(Cron・Queuesディスパッチャ)
- レート制限とbot対策の汎用部品

## Out of Boundary

- APIスキーマ(GraphQL・OpenAPI)の定義
- フロントエンドからの中継処理
- 業務ルールと業務テーブル

## Upstream / Downstream

- **Upstream**: dev-tooling
- **Downstream**: api-gateway、email-delivery、および全ドメインspec

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: api-gateway(同じapiアプリ上の通信層)、infra-delivery(Wrangler設定とCloudflare資源の対応)

## Constraints

- D1の制約: `db.transaction()`禁止、`db.batch()`の使用、`onConflictDoNothing()`、バインド変数100個まで、FTS5と仮想テーブル・トリガーはカスタムマイグレーション、バックアップはTime Travel
- api・eventのWrangler設定で、`database_id`・R2バケット名・`preview_*`を同一にする。`--persist-to /workspace/.wrangler/state`を使う
- `compatibility_date`は`2026-08-04`。`compatibility_flags`に`nodejs_compat`を明示しない
- Workersのグローバルスコープ処理は1秒以内、CPU時間は30秒以内
- 実現性チェック(2026-10-03)の指摘:
  - Inversify 8は`reflect-metadata`が必須。Workerのエントリ・Vitestの`setupFiles`・bun testのpreloadで読み込む。`emitDecoratorMetadata`は無効のまま`@inject`を明示する
  - Vite 8(Oxc)はlegacy decoratorを変換できるが、出力する`@oxc-project/runtime`のヘルパーを解決できない報告がある。Vitest設定でlegacy decoratorを明示し、workerd上でDIを解決するスモークテストを置く
  - Drizzle v1は正式版が出ておらずRCのまま。drizzle-ormとdrizzle-kitを同じRC版で完全固定し、CIで`wrangler d1 migrations list --local`による検出確認を行う
  - ulidxはメンテナンス縮小の計画がある(`ulid@3`への移行を候補として開発者に確認する)
  - Workers Cacheを有効にするとService Bindings経由の呼び出しも課金対象になるため、APIのWorkerでは無効にする
- 要件の論点: FR-RLMIT-008の「Worker毎にIP単位で10秒100回」はStripe Webhookのバースト送信やNAT配下からの画像閲覧にも及ぶため、除外条件を要件フェーズで開発者に確認する
- 新規パッケージ(`reflect-metadata`など)は候補を挙げて開発者に質問し、tech-stack.mdへ記載する
