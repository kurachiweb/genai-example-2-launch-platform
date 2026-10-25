# Research & Design Decisions

## Summary

- **Feature**: `backend-platform`
- **Discovery Scope**: New Feature(`apps/api`・`apps/event`・`apps/db`・`apps/backend-lib`は空ディレクトリ。dev-toolingの規約の上に骨格を新設する)
- **Key Findings**:
  - Inversify 8.2.3は`reflect-metadata`を必須の相手依存(peer dependency)とし、`@inversifyjs/container`が自ら`reflect-metadata/lite`をimportする。アプリが`reflect-metadata`を宣言すれば、エントリでの明示的なimportは不要である。既定で`jitless: true`(`new Function`を使わない)であり、workerdのコード生成禁止と両立する。
  - Vite 8.3.3(Vitest 4.1.11・`@cloudflare/vitest-pool-workers` 0.22.0)のOxcは、基底設定の`experimentalDecorators: true`を`extends`経由で読み、パラメータデコレータをworkerd上で解決できた。報告にあった`@oxc-project/runtime`のヘルパー未解決は再現しなかった。
  - 呼び出しログ(Workers Logsが呼び出しごとに自動記録するログ)はリクエストのメタデータとヘッダーを含み、アプリ側でマスキングできないため無効にする(開発者決定Q5)。
  - Workers Cacheを有効にするとService Bindings経由の呼び出しも課金され、キャッシュがヒットしたリクエストではWorkerが実行されない。

## 要件フェーズ前の確認事項(2026-10-06)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                                              | 根拠                                     | 回答(2026-10-06)                                                                                                                                 |
| --- | ------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | FR-RLMIT-009(Worker単位のIP制限)の除外条件        | roadmapのRequirement Ambiguities・brief  | 推奨案。Stripe Webhook・RFC 8058配信停止・画像配信ドメインをIP単位の制限の対象外とし、署名・トークン検証、エッジキャッシュ、WAFで守る            |
| Q2  | FR-RLMIT-009をclient・adminのWorkerへ適用するspec | brief「全Worker共通」とfrontend-platform | 推奨案。本specはapi・eventを担当し、client・adminのWorkerへの適用はfrontend-platformが同じ規約で実装する。規約(キー・上限・応答)を設計に明記する |
| Q3  | `reflect-metadata`の採用                          | brief・CLAUDE.md(新規パッケージ)         | 推奨案。`reflect-metadata` 0.2.2をapi・eventに版固定で宣言する。導入時にtech-stack.mdへ追記する                                                  |
| Q4  | ログの個人情報マスキングの実装手段                | DR-013・CLAUDE.md(新規パッケージ)        | 推奨案。`@logtape/redaction`を採用し、IPアドレスのパターンは独自に追加する。導入時にtech-stack.mdへ追記する                                      |
| Q5  | Workers Logsの呼び出しログの扱い                  | DR-013                                   | 推奨案。呼び出しログを無効にし、マスキング済みのアクセスログを自前で出す                                                                         |
| Q6  | ヘルスチェックの公開範囲と確認内容                | NFR-AVAIL-003・SW-007・README            | 推奨案ではなく「外部公開し、Workerが動いているかだけを確かめる」を採用。api・eventとも認証なしで外部公開し、D1への疎通は確認しない               |
| Q7  | デッドレターキューに移ったメッセージの扱い        | brief(再試行とデッドレターの方針)        | 推奨案。DLQのconsumerが種別・ID・理由をログとSentryに通知してから破棄し、本文は残さない。再実行は各ドメインの冪等な処理に任せる                  |

### 提示した選択肢(記録)

- Q1: 3つとも除外(採用) / Stripe Webhookと配信停止だけ除外 / 除外しない / 画像配信だけ上限を上げる
- Q2: api・eventは本spec、client・adminはfrontend-platform(採用) / 本specが先行して作る / WAFで代替
- Q3: `reflect-metadata` 0.2.2を版固定で宣言(採用) / 宣言せず自動導入に任せる / `@abraham/reflection`
- Q4: `@logtape/redaction`(採用) / 自前実装
- Q5: 無効化して自前のアクセスログ(採用) / 有効のまま / staging検証後に決める
- Q6: 外部公開・D1疎通まで確認 / 外部公開・Workerの生存のみ(採用) / Service Bindings経由のみ
- Q7: 通知して破棄(採用) / consumerを置かず手動再投入 / D1に保存して再投入可能にする

### 確認済みのため質問しない事項

- ulidxのメンテナンス縮小(brief): コミット`c26573c`で、tech-stack.mdのID採番は`ulid`(v3)に変更済みである。本specは`ulid` 3.0.2を使う。

## Research Log

### Inversify 8と`reflect-metadata`

- **Context**: briefの実現性チェックで「Inversify 8は`reflect-metadata`が必須」と指摘された。
- **Sources Consulted**: npmの`inversify@8.2.3`・`@inversifyjs/core@15.0.1`・`@inversifyjs/container@3.1.3`・`@inversifyjs/reflect-metadata-utils@1.5.0`のpackage.jsonと配布物(scratchpadへ導入して確認)。
- **Findings**:
  - `@inversifyjs/reflect-metadata-utils`は`peerDependencies`に`reflect-metadata: ~0.2.2`を持ち、`Reflect.getOwnMetadata`・`Reflect.defineMetadata`を直接呼ぶ。
  - `@inversifyjs/container`の入口が`import 'reflect-metadata/lite'`を持つ。`inversify`からimportすれば、利用側のエントリで読み込まなくてもポリフィルが有効になる(scratchpadで、エントリから`import 'reflect-metadata'`を外してもworkerd上で解決できた)。
  - Bun 1.4.2は相手依存を自動で導入するため、宣言しなくても`reflect-metadata`が入るが、版は固定されない。
  - 代替のポリフィル(`@abraham/reflection` 0.13.0など)は、Inversifyが`reflect-metadata/lite`を名指しでimportするため置き換えにならない。
  - `Container`のオプション`jitless`の既定値は`true`で、`false`にすると解決処理を`new Function`で生成する。workerdは実行時のコード生成を禁止するため、`jitless: false`を指定しない。
  - `Container`は同期の`load`・`get`と非同期の`loadAsync`・`getAsync`を持ち、`parent`オプションで親子のコンテナを作れる。
- **Implications**: `reflect-metadata` 0.2.2をapi・eventで版を固定して宣言し、エントリでの明示的なimportは行わない(Inversifyが読み込む)。処理単位のコンテナは毎回新しく作り、モジュールを同期の`load`で読み込む。

### Vite 8(Oxc)のデコレータ変換とworkerd上でのDI解決

- **Context**: briefの実現性チェックで、Vite 8のOxcが出力する`@oxc-project/runtime`のヘルパーを解決できない報告が挙げられた。
- **Sources Consulted**: scratchpadに最小構成を作り、`vitest` 4.1.11・`@cloudflare/vitest-pool-workers` 0.22.0・`wrangler` 4.124.0・`@vitest/coverage-istanbul` 4.1.11・`inversify` 8.2.3・`hono` 4.13.13を導入した。tsconfigはルートの`tsconfig.base.json`を`extends`で継承した。
- **Findings**:
  - Vitestが導入したViteは8.3.3で、`@oxc-project/runtime`は導入されなかった。
  - `@inject`付きのコンストラクタ引数を持つクラスを、Workers統合テスト(workerd)でコンテナから解決できた。`exports.default.fetch`経由でも成功した。
  - Istanbulのカバレッジ計測を有効にしても成功し、デコレータ付きのファイルも計測された。
  - `bun test`でも同じクラスを解決できた。
  - Wranglerのバンドル(esbuild 0.28.1)でパラメータデコレータが出力されることは、dev-toolingの検証(`docs/GUIDES/tech/backend/001-dependency-injection-on-workers.md`)で確認済みである。AIエージェントは`wrangler deploy --dry-run`を実行できない(`.claude/settings.json`で拒否)ため、本specのスモークテストは`wrangler dev`と同じバンドル処理を通すWranglerのプログラムAPIで起動したWorkerへのHTTPリクエストで確かめる。
- **Implications**: 新しいパッケージは不要である。3つの変換経路(Bun・Vitest/Oxc・Wrangler/esbuild)のスモークテストを実装に含め、版の更新で挙動が変わったときに検出する。

### Workers Cacheと課金

- **Sources Consulted**: Cloudflare Docs「[Workers Cache](https://developers.cloudflare.com/workers/cache/)」「[Configuration](https://developers.cloudflare.com/workers/cache/configuration/)」。
- **Findings**:
  - `cache.enabled`はWorker単位(Wrangler 4.69.0以上)で、エントリポイントごとの上書き(`exports.<名前>.cache`、Wrangler 4.107.0以上)もできる。
  - 有効にすると、キャッシュのヒットを含むすべてのリクエストと、Service Bindings経由の呼び出しが標準の料金で課金される。
  - キャッシュはWorkerの前段にあり、ヒットしたリクエストではWorkerが実行されない。
- **Implications**: api・eventとも`cache.enabled: false`を明示する。eventの画像配信でのキャッシュ有効化はmedia-pipelineが行う。ヒットした画像のリクエストはWorker内のIP制限に数えられない。

### Cron Triggersの上限

- **Sources Consulted**: Cloudflare Docs「[Limits](https://developers.cloudflare.com/workers/platform/limits/)」「[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)」。
- **Findings**:
  - Cron TriggersはWorkers Paidでアカウントあたり250個。CPU時間はCron Triggerあたり30秒(実行間隔1時間未満)・15分(1時間以上)。
  - `triggers.crons`を空配列にしてデプロイすると、既存のCron Triggersはすべて削除される。変更の反映には最大15分かかる。
  - ローカルでは`wrangler dev --test-scheduled`で起動し、`/cdn-cgi/local/scheduled?cron=<式>&time=<ミリ秒>`へのリクエストで任意の式と予定時刻(`scheduledTime`)のハンドラーを起こせる(経路と引数はWranglerの版で異なり得るため、実装時に固定した版で確かめる。承認後の改訂2で直した)。
  - Cron Triggersの1回の起動の実時間の上限は15分である(launch-readinessの調査)。
- **Implications**: 日次タイムラインの時刻をcron式として定義できる。登録されたジョブの業務時刻とWrangler設定の`triggers.crons`を単体テストで突き合わせる。

### Workers Logsの呼び出しログ

- **Sources Consulted**: Cloudflare Docs「[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)」「[Capture up to 256 KB of log events](https://developers.cloudflare.com/changelog/post/2025-04-07-increase-trace-events-limit/)」。
- **Findings**:
  - 呼び出しログは呼び出しごとに1件記録され、リクエスト・レスポンス・関連するメタデータを含む。`console.log`・例外・リクエストのメタデータ・ヘッダーが自動で取り込まれる。
  - `observability.logs.invocation_logs: false`で無効にできる。
  - Workers Logsは`console.log`に渡したオブジェクトのフィールドを抽出して索引化する。有料プランの保持期間は7日である。
- **Implications**: 呼び出しログを無効にし、アクセスログはアプリがマスキングを通して出力する(Q5)。ログはオブジェクトとして`console`へ渡す。

### LogTapeの個人情報マスキング

- **Sources Consulted**: npmの`@logtape/logtape@2.3.11`・`@logtape/redaction@2.3.11`の型定義。
- **Findings**:
  - `@logtape/redaction`はLogTape公式の別パッケージで、`@logtape/logtape`と同じ版で配布される。
  - フィールド名による伏せ字(`redactByField`、既定の対象`DEFAULT_REDACT_FIELDS`)、パターンによる伏せ字(`redactByPattern`、メールアドレス・JWT・カード番号などの既定パターン)を提供する。`redactByPattern`はテキスト用とコンソール用の両方の整形関数を包める。IPアドレスの既定パターンは無く、独自パターンで追加する(Q4)。
  - `@logtape/logtape`は`configureSync`・`getConsoleSink`・`withContext`(`contextLocalStorage`に`AsyncLocalStorage`を渡すと処理単位の文脈を自動で付ける)を持つ。
- **Implications**: シンクはフィールド名で、コンソール用の整形関数は値のパターンで伏せ字にする二段構えとする。`AsyncLocalStorage`は`node:async_hooks`から使う(互換性日付によりNode.js互換が既定で有効)。

### Sentry

- **Sources Consulted**: npmの`@sentry/hono@11.4.0`・`@sentry/cloudflare@11.4.0`の型定義と配布物。
- **Findings**:
  - `@sentry/hono`の`./cloudflare`入口の`sentry(app, options)`は、内部で`@sentry/cloudflare`の`withSentry`をアプリに適用し、Honoのエラーを捕捉するミドルウェアを返す。`shouldHandleError`で送信するエラーを絞れる。接続元の情報を`hono/cloudflare-workers`の`getConnInfo`で読む。
  - 相手依存はすべて任意で、`@sentry/cloudflare`は`withSentry`でscheduled・queueなどのハンドラーも計装できる。
- **Implications**: Honoの経路は`sentry(app, ...)`、scheduled・queueは`withSentry`で計装する。`sendDefaultPii: false`に加えて`beforeSend`・`beforeSendTransaction`でIPアドレス・Cookie・認証ヘッダー・本文を除く。二重計装が起きないことをWorkers統合テストで確かめる。

### Rate Limitingバインディング

- **Sources Consulted**: Cloudflare Docs「Config Explorer」(`ratelimits`の`namespace_id`・`simple.limit`・`simple.period`)。
- **Findings**: `simple.period`は10または60(秒)。`namespace_id`はアカウント内で名前空間を区別する正の整数の文字列で、同じ値を使うWorker・環境は回数を共有する。カウントはCloudflareのロケーション単位である。
- **Implications**: FR-RLMIT-009は`limit: 100`・`period: 10`。Worker・環境ごとに別の`namespace_id`を割り当て、値の一覧を`docs/onboardings/project-values.md`に記載する。

### Wranglerの自動プロビジョニング

- **Sources Consulted**: Cloudflare Docs「[Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)」「Automatic resource provisioning」。
- **Findings**: D1・R2・Queuesなどのバインディングにリソース識別子が無いと、`wrangler deploy`が自動でリソースを作る。
- **Implications**: リソースはinfra-deliveryがOpenTofuで作るため、自動作成を避ける。staging・prodのD1の`database_id`には仮の値`00000000-0000-0000-0000-000000000000`を置き、infra-deliveryが実際の値へ置き換える。R2のバケット名とQueueの名前は本specが命名し、infra-deliveryが同じ名前で作る。

### ローカル開発でのQueuesの受け渡し

- **Sources Consulted**: Cloudflare Docs「[Multi Workers](https://developers.cloudflare.com/workers/local-development/multi-workers/)」。
- **Findings**: 別々の`wrangler dev`のWorker間で、Service Bindings・Tail Workersの通信ができると明記されている。Queuesのproducerとconsumerが別の`wrangler dev`にある場合の受け渡しは明記されていない。
- **Implications**: 実装時にapiの`wrangler dev`から送ったメッセージがeventの`wrangler dev`のconsumerへ届くかを確かめる。届かない場合は、eventの処理を確かめる手順を「eventの`wrangler dev`で送信と受信を完結させる」とし、オンボーディングに記載する(Risks参照)。

### 参照したスキル

- `cloudflare:workers-best-practices`・`cloudflare:wrangler`: Wrangler設定のバインディングと環境、`wrangler types`の運用。プロジェクト規則により`.dev.vars`は作らない。
- `cloudflare:durable-objects`: SQLiteを使うDurable Objectの`new_sqlite_classes`、Alarmによる後始末。
- `ecc:api-design`: 共通のエラー形式(`error.code`・`error.message`・`error.details`)、状態コードの対応(400・422・429・503の使い分けと`Retry-After`)。
- `ecc:error-handling`: 想定内の失敗の型付け(判別可能なユニオンの`kind`)と、想定外の例外を詳細を伏せて500にする方針。

## Architecture Pattern Evaluation

| Option                                 | Description                                                                | Strengths                                                    | Risks / Limitations                                  | Notes  |
| -------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- | ------ |
| 4層のクリーンアーキテクチャ+合成ルート | ドメイン・アプリケーション・インフラ・プレゼンテーションと、DIの合成ルート | CLAUDE.mdの規則に一致。内側の層はBunの単体テストで検査できる | 層の境界を静的解析で強制しないと崩れる               | 採用   |
| ドメインごとの縦割りのみ               | ドメインのディレクトリ内に自由に配置                                       | 単純                                                         | spec間で構成がばらつく(briefの問題そのもの)          | 不採用 |
| 基盤を独立したWorkerに分離             | レート制限やログ収集を専用Workerにする                                     | 責務が明確                                                   | Service Bindingsの往復が増え、Worker数と設定が増える | 不採用 |

- 共有コード(`apps/backend-lib`)は、Workersの実行環境に依存しない`core`と、バインディング・`cloudflare:*`・Honoに依存する`workers`に分ける。`core`はBunの単体テスト、`workers`はWorkers統合テストで検査し、カバレッジの`include`をディレクトリで切り分ける(dev-toolingの「`coverage.include`はその種別のテストが担当するソースに絞る」契約)。
- アプリの`src`も同じ理由で、`domain`・`application`(純粋、単体テスト)と、`infrastructure`・`presentation`・`composition`(実行環境に依存、Workers統合テスト)に分ける。

## Design Decisions

### Decision: 処理単位ごとに新しいDIコンテナを作る

- **Context**: 要件5.2(処理単位の状態を共有しない)。Workersの1つのisolateは複数のリクエストを並行して処理する。
- **Alternatives Considered**:
  1. isolateごとの親コンテナと処理単位の子コンテナ — 親で単一インスタンスに束縛した依存が処理単位をまたいで共有される危険がある。子のコンテナに束縛した依存を親の依存から解決できるかがInversifyの版に依存する。
  2. 処理単位ごとに新しいコンテナを作り、モジュールを同期の`load`で読み込む — 束縛の登録は軽い処理で、単一インスタンスの範囲が処理単位に閉じる。
- **Selected Approach**: 2。プラットフォームの束縛(環境・データベース・時計・ID採番・ハッシュ化・メッセージ送信)と各モジュールの`ContainerModule`を、処理単位ごとの`Container`へ読み込む。`inSingletonScope`は処理単位内の単一インスタンスを意味する。
- **Trade-offs**: 処理単位ごとに束縛の登録が走る。束縛が数百件になっても1ミリ秒未満と見込み、性能を問題にしない。
- **Follow-up**: Workers統合テストで、2つの処理単位が別のインスタンスを受け取ることを確かめる。

### Decision: 登録制のディスパッチャ(定期実行・非同期メッセージ・IP制限の除外)

- **Context**: 要件5.5・10・11・13.4。
- **Selected Approach**: 各アプリの`src/composition`に、`modules.ts`(依存とルート)・`scheduled-jobs.ts`(api)・`message-handlers.ts`(event)・`rate-limit-exclusions.ts`の登録箇所を置く。メッセージの契約(種別と本文の検証規則)は送信側と受信側の両方が使うため、共有コードの`core/messaging/contracts/`に置く。
- **Rationale**: 登録をデータとして分けると、cron式とWrangler設定の突き合わせなどをBunの単体テストで行える。

### Decision: デッドレターへは本文を除いた通知を送る

- **Context**: 要件11.6〜11.8・Q7。Queuesの自動のデッドレター移送は失敗理由を運ばず、本文をそのまま移す。
- **Selected Approach**: consumerは、未登録の種別・本文の検証失敗・試行回数の上限到達のとき、本文を含まない通知(種別・ID・試行回数・理由)をデッドレターのQueueへ明示的に送り、元のメッセージを完了扱いにする。Queuesの`max_retries`はディスパッチャの上限より大きくし、自動の移送はconsumer自体がCPU時間超過などで落ちた場合だけにする。デッドレターのconsumerは、通知と元のメッセージのどちらでも本文を読まずに種別・ID・試行回数・理由をログとSentryへ送り、完了扱いにする。
- **Trade-offs**: 失敗したメッセージの本文は失われる。再実行は各ドメインの冪等な処理(定期実行での再走査など)に任せる(Q7)。

### Decision: 厳密カウンタは固定期間とAlarmによる後始末

- **Context**: 要件12・FR-RLMIT-014〜019の「カウント対象期間の開始から所定時間経過した時点でAlarm APIによりリセット」。
- **Selected Approach**: キー(ルール名とハッシュ化済みの値)ごとに1つのDurable Object(SQLite)を割り当てる。最初の要求で期間を開始してAlarmを予約し、Alarmで全データを削除する。期間の判定は純粋関数(`core/rate-limit/fixed-window.ts`)に置き、Alarmが遅れても要求時に期限切れを判定する。
- **Rationale**: Durable Objectは単一スレッドで、同じキーへの同時要求を直列化する(要件12.2)。

### Decision: Turnstileの検証はSDKを使わずsiteverifyを直接呼ぶ

- **Context**: 要件14。
- **Alternatives Considered**: サーバー側の公式SDKは無い。フロントエンド向けのウィジェット部品(frontend-platformの範囲)は対象外。
- **Selected Approach**: `fetch`でsiteverifyへPOSTし、応答の解釈(エラーコードの分類・操作名とホスト名の照合)は純粋関数にする。`fetch`は注入可能にし、単体テストとWorkers統合テストで外部へ通信しない。
- **Follow-up**: 判定サービスへの到達不能は5秒で打ち切る。

### Decision: Worker単位のIP制限のキーとクライアントIP

- **Context**: 要件13・Q1・Q2。
- **Selected Approach**: キーは`ip:<送信元IPアドレス>`。送信元IPアドレスは`ClientIpResolver`で求め、既定は`CF-Connecting-IP`ヘッダー。特定できない場合は`ip:unknown`として1つのキーで数える(制限を外さない安全側)。api-gatewayは、内部認証を伴う中継リクエストでだけ引き継がれた元のIPを返すリゾルバを`createWorkerApp`へ渡す。キーはRate Limitingバインディングの内部カウンタにだけ使われ、本specの保存先には残らないため、FR-RLMIT-020(Durable Objectsのキーのハッシュ化)の対象外とする。
- **Rationale**: frontend-platformが同じ規約を、共有コード無しで再現できる単純さを優先する。

### Generalization・Build vs Adopt・Simplification

- **Generalization**: FR-RLMIT-009はRate Limitingバインディングの汎用ミドルウェア(`bindingRateLimit`)にキーの関数と除外規則を与えた特殊形として実装し、public-apiのFR-RLMIT-008も同じ部品で実装できる。FR-RLMIT-001・003〜007・011・012・014〜019は、汎用の厳密カウンタ(ルール名・上限・期間・リセット)で表現できる。
- **Build vs Adopt**:
  - 採用: LogTape・`@logtape/redaction`(マスキング)、`@sentry/hono`・`@sentry/cloudflare`、Inversify、Drizzle、`ulid`、Zod。
  - 自作: 定期実行と非同期メッセージのディスパッチャ(ルーティング表と再試行判定だけで、既製品はWorkersのハンドラー形式に合わない)、固定期間カウンタ(Durable Objectの数十行)、siteverifyの呼び出し(公式SDKが無い)。
  - 不採用: Honoのレート制限ミドルウェアのライブラリ(バインディングの呼び出しは1行で、依存を増やすほどの利点が無い)。
- **Simplification**:
  - ジョブの実行記録のテーブル、デッドレターの保存先、ログのDIラッパーは作らない。
  - Service Bindingsは呼び出し側(client・admin)のWrangler設定で定義するものであり、本specでは定義しない。apiのWorker名を契約として示す。
  - eventの画像配信のキャッシュ有効化、画像変換の利用はmedia-pipelineに任せ、本specはバインディングの定義だけを行う。

## Risks & Mitigations

- 変換経路(Bun・Oxc・esbuild)の更新でデコレータの扱いが変わる — 3経路のスモークテストを置き、版の更新時に必ず実行する。
- Drizzle v1がRCのまま — `drizzle-orm`・`drizzle-kit`を1.0.0-rc.5で完全固定し、`db:migrations:check`でマイグレーションの検出を確かめる。
- 別々の`wrangler dev`の間でQueuesのメッセージが届かない可能性 — 実装時に確かめ、届かなければ単一プロセスでの確認手順をオンボーディングに記載する。
- `@sentry/hono`の`sentry(app)`と`withSentry`の併用による二重計装 — fetchは`sentry(app)`だけ、scheduled・queueは`withSentry`だけで計装し、Workers統合テストで1件の例外が1回だけ送られることを確かめる。
- WranglerのプログラムAPI(`unstable_startWorker`・`unstable_readConfig`)は不安定版 — スモークテストと設定の検査だけに使い、使えなくなった場合はJSONCの解析と`wrangler dev`のプロセス起動に置き換える。
- Rate Limitingバインディングはロケーション単位のため、厳密な10秒100回にはならない — 要件定義書がRate Limitingバインディングを指定しており、許容する。厳密さが必要なルールはDurable Objectsのカウンタを使う。

## References

- [Workers Cache](https://developers.cloudflare.com/workers/cache/) — Workerの前段のキャッシュと課金
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) — 呼び出しログと保持期間
- [Limits](https://developers.cloudflare.com/workers/platform/limits/) — Cron Triggersの上限とCPU時間
- [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) — `simple.period`は10秒または60秒
- [Queues: Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/) — 自動の移送と`max_retries`
- [Turnstile: Server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) — siteverifyの要求・応答とエラーコード、テスト用の鍵
- [ADR-0001](../../../docs/adr/0001-drizzle-orm-over-mikroorm.md) — Drizzle ORM単体の採用

## public-apiの依頼による承認後の改訂(改訂1、2026-10-24)

- **状態**: 要件・設計・タスクの承認の後の改訂で、public-apiの依頼による。2026-10-24に開発者が確定した(推奨どおり)。開発者に確認したQ1〜Q7とは別の項目として記録する。`spec.json`のタスクの承認はタスクのグラフのサニティレビューの結果を表し、改訂1の開発者の確認を意味しない。
- **Context**: public-apiのresearch.mdの「上流・後続specへの影響」とRisks(コーディネーター経由。requested by public-api)。公開APIのキーの平文(`lsk_`と32バイトのbase64urlの43文字)は、`Authorization`のヘッダーとしてはフィールド名(`authorization`)と`Bearer <値>`のパターンで伏せられるが、ログのメッセージ・属性の値・Sentryのパンくずに紛れた場合は既存のパターンに当たらず、そのまま残り得た。
- **改訂の内容**: `REDACTION_PATTERNS`の先頭に`lsk_[A-Za-z0-9_-]{43}`(`g`フラグ付き、置き換えは定数`REDACTED`の`[REDACTED]`)を加える。`redactByPattern`は配列の順に置き換えるため、キーの一部がカード番号などのパターンに先に当たらないよう先頭に置く。Sentryでは`SentryScrubber`が同じ`REDACTION_PATTERNS`をパンくずの`data`の値に適用するため、そこに紛れたキーも伏せられる(`SentryScrubber`の処理は変えない)。
- **範囲の外**: Sentryの例外のメッセージ(`exception.values[].value`)・`message`・パンくずの`message`には、改訂の前から`REDACTION_PATTERNS`を適用しておらず、本改訂でも対象外のままである。これらにも適用するかは、要件9.2と`SentryScrubber`の範囲を広げる判断になるため、開発者の確認事項として残した(2026-10-24に開発者が適用すると決定し、改訂3で範囲を広げた。下の改訂3の節を参照)。
- **要件**: 要件8.3(トークン・秘密情報を値の形式で検出して伏せる)の範囲の中のパターンの追加で、利用者・運用者から見える振る舞いの変更ではないため、`requirements.md`は変えていない。
- **変えた箇所**: 設計の`LogRecordFormat・LogRedaction`の`REDACTION_PATTERNS`の説明・Revalidation Triggers・Testing Strategyの`redaction.unit.test.ts`と`scrub-event.unit.test.ts`、タスク2.5の詳細と完了状態、2.6の完了状態と`_Depends: 2.5_`(`REDACTION_PATTERNS`を使う既存の依存の明記。同じ大項目の2.5に依存するため`(P)`を外した)、8.3の技術ドキュメントに固有のキーの形式とそのプレースホルダーを書かず一般的な規則として書く旨、コンポーネントの表の`SentryScrubber`の依存(LogRedaction)。番号の変更は無い。
- **Follow-up**(2026-10-24の確定により前半は不要): 開発者の確認が得られない場合は、タスク2.5・2.6・8.3と設計のうち改訂1で加えた部分を外す。本specの実装の時点でpublic-apiのキーの形式が変わっていれば、パターンを合わせる。
- **変更部分のタスクの検証**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
  - 1回目はNEEDS_FIXES(必須1件・軽微5件)だった。必須の指摘は、Sentryでキーが伏せられる範囲の記述が誇張だったこと(パンくずの`data`の値だけで、例外のメッセージは対象外である旨に直した)。軽微の指摘(置き換えの文字列の表記、2.6の2.5への依存の明記、Sentry側のテスト、パターンの順序、技術ドキュメントへの`lsk_`の混入の防止)もすべて直した。
  - 2回目はNEEDS_FIXES(必須1件・軽微3件)だった。必須の指摘は、1回目の修正で2.6に`_Depends: 2.5_`を足したのに`(P)`が残り、同じ大項目の直前のタスクへの依存と`(P)`が食い違ったこと。軽微の指摘は、コンポーネントの表の`SentryScrubber`の依存が「なし」のままであること、8.3が参照する固有の値(接頭辞)の記載の担当、パターンを先頭に置く根拠を確かめるテストが無いこと。
  - kiro-spec-tasksの規則(2回目の判定がPASSでなければ、それ以上レビューを繰り返さずに止める)に従い、3回目のレビューを行っていない。`tasks.md`は2回目の必須の指摘(2.6の`(P)`を外す)と軽微の2件(`SentryScrubber`の依存、接頭辞の記載はpublic-apiの担当である旨)を直した下書きで、タスクの承認(`approvals.tasks.approved`)は`false`に戻した。
- **タスクの計画の再検証(2026-10-24、コーディネーターの指示による再実行)**: `/kiro-spec-tasks backend-platform -y`を、修正済みの`tasks.md`を既存の下書きとして引き継ぐ形で再実行した。あわせて、パターンを先頭に置く理由を確かめるテスト(前後を数字以外の文字で挟んだLuhnの検査を通る16桁を含むキーが1つの`[REDACTED]`になり、パターンの順序を入れ替えると失敗する)を2.5とTesting Strategyに加えた。タスクの計画のレビューゲートでは、要件の105件の受け入れ基準の番号がすべてタスクにあることを機械的に確かめた。新しいサブエージェントによる独立した確認(independent)を、通常の2回の上限で行った。
  - 1回目の判定はNEEDS_FIXES(必須1件・軽微4件)だった。必須の指摘は、8.3が技術ドキュメントからキーの接頭辞をproject-valuesの記載へ参照させていたが、その記載は後続のpublic-apiの担当で、8.3・8.5の実装の時点では参照先が無いこと(8.3を、固有の値もプレースホルダーも書かず一般的な規則として書く形に直した)。軽微の指摘(タスクの承認と改訂1の開発者の確認の関係の明記、順序のテストのデータの条件と順序を入れ替えたときの失敗の確認、Revalidation Triggersの向きの書き分け)も直した。
  - 2回目の判定はPASSだった。軽微の指摘3件(8.3の完了状態の伏せ字の対象の判断基準、設計のLoggingDocへの一般的な規則の記載、Follow-upで外す範囲の明確化)に従って直した。タスクを承認した(改訂1はその後の2026-10-24に開発者が確定した)。
- **開発者の判断の論点(解決済み)**: Sentryの例外のメッセージ・`message`・パンくずの`message`へ`REDACTION_PATTERNS`を適用するか(要件9.2と`SentryScrubber`の範囲の拡大)。2026-10-24に開発者が適用すると決定し、改訂3で範囲を広げた。

## spec横断レビューの指摘による承認後の改訂(改訂2、2026-10-24)

- **状態**: 要件・設計・タスクの承認の後の改訂で、cross-spec reviewの指摘による(launch-readinessの申し送りの受け入れ)。2026-10-24に開発者が確定した(推奨どおり)。`spec.json`のタスクの承認は変更部分のタスクのレビューの結果を表し、改訂2の開発者の確認を意味しない。
- **Context**: launch-readinessの仮1(4:21の日次バッチの時間の予算と上限)とresearch.mdの「上流・後続specへの影響」が、予算の値の記載と超過の警告を本specへ申し送っていた。また、本specの文書はローカルの定期実行の経路を現行のWranglerの文書と異なる旧い経路で書いていたが、現行の経路は`/cdn-cgi/local/scheduled`(`time`の引数で予定時刻を指定できる)である。さらに、launch-readinessが自前の`e2e/support/scheduled-trigger.ts`を計画しており、定期実行をローカルで起こす他のspecも同等の補助を作るおそれがあった。
- **決定**:
  - 予算: 1日1回の起動の全ジョブの合計の実時間の予算5分・上限10分(Cron Triggersの実時間の上限15分の3分の2)・各ジョブの目安30秒(launch-readinessの仮1の値)を`infra/003`に一般的な規則として記し、予算を適用する起動時刻(4:21)と値は`project-values.md`と`SCHEDULED_RUN_BUDGETS`に置く。`infra/003`では値を実行基盤の上限から導く規則(上限は実時間の上限の3分の2、予算は上限の半分、各ジョブの実時間の目安はHTTPの処理のCPU時間の上限と同じ値の30秒)として書き、同じ技術選定の他のプロジェクトにも当てはまる形にする。技術ドキュメントに固有の値を書かない規則(15.6)のため、4:21の時刻と本プロジェクトが採用した旨は`infra/003`に書かず、`project-values.md`への参照とする。
  - 警告: `ScheduledDispatcher`が、予算の表(`RunBudgetTable`、core)に起動時刻がある場合に、最初のジョブの開始から最後のジョブの終了までの合計を予算と比べ、超えたら要約の前に`warning`ログとSentryの`captureMessage`(レベル`warning`・タグ`cron`(式)・コンテキスト`scheduled_run`に所要時間と予算)を送る。予算ちょうどは送らない。要約の`info`に合計の所要時間(`totalDurationMs`)を加える。上限10分と各ジョブの目安30秒は警告の対象にせず、launch-readinessの検証(`CronBudgetJudge`)が判定する。
  - 経路: ローカルの定期実行の経路を`/cdn-cgi/local/scheduled?cron=<式>&time=<ミリ秒>`に直した(design.mdの追跡表・パッケージのスクリプトの注記・Testing Strategy、本書のCron Triggersの上限の節)。
  - 共有の補助: `e2e/support/scheduled-trigger.ts`の`triggerScheduled(input: { readonly worker: 'api' | 'event'; readonly businessDate: string; readonly businessTime: string }): Promise<void>`を本specが持つ。launch-readinessの設計の`ScheduledTrigger`の業務日付の処理(`businessDateOf`・`addBusinessDays`・`isNearBusinessDayBoundary`)も取り込んだ。業務時刻の計算は`apps/backend-lib/core/time/business-time.ts`を読み込み、規則を複製しない(launch-readinessの設計は補助の中で計算を閉じる案だったが、規則の二重管理を避けた)。
- **理由**: 予算の超過を運用者が実測を待たずに知れるようにするため(launch-readinessの仮1)。経路の誤りはオンボーディングの手順とE2Eの補助をそのまま失敗させるため。補助を上流に1つ置くと、定期実行を起こすE2Eを持つドメインspecがそれぞれ補助を作らずに済む。
- **要件**: 予算の超過の警告は運用者から見える振る舞いのため、要件10.9を加え、`requirements.md`の「承認後の改訂」の表に改訂2の行を置いた。経路の修正と共有の補助は要件10.7の範囲の中の修正である。
- **変えた箇所**(変更部分のタスクのレビューの1回目の指摘による修正を含む): 設計のThis Spec Owns・契約・Revalidation Triggers・File Structure Plan(`run-budget.ts`・`scheduled-jobs.ts`の注記・`e2e/support/scheduled-trigger.ts`)・Modified Files・定期実行の流れ・追跡表(10.7・10.9)・コンポーネントの表(`RunBudgetTable`・`ScheduledTriggerHelper`・`ScheduledDispatcher`・`AppComposition`・技術ドキュメント群)・`RunBudgetTable`と`ScheduledTriggerHelper`の節・`ScheduledDispatcher`の契約(任意の`options`)と処理・`AppComposition`・パッケージのスクリプトの注記・AsyncProcessingDoc・ProjectValuesDoc・Monitoring・Testing Strategy・Performance & Scalability。タスク2.10・6.2・7.1・8.3・8.5・9.1の詳細と完了状態と要件、新しいタスク2.11(予算の表)・7.4(共有の補助)。既存の番号の変更は無い。
- **Follow-up**(2026-10-24の確定により前半は不要): 開発者の確認が得られない場合は、要件10.9と、タスク2.11と、6.2・7.1・8.3・8.5のうち改訂2で加えた部分を外す(経路の修正と共有の補助は残す)。launch-readinessの仮1の値が変われば`SCHEDULED_RUN_BUDGETS`・`infra/003`・`project-values.md`を合わせる。eventは定期実行を持たないため、`triggerScheduled`の`worker: 'event'`は、eventが定期実行のハンドラーと`--test-scheduled`の起動を持つまで例外になる。
- **開発者の確認の論点(2026-10-24に確定)**: 予算の値(launch-readinessの仮1。同日に確定)と、超過を`warning`として送る形(タグ`cron`)。いずれも推奨どおりに確定した。
- **変更部分のタスクの検証**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
  - 1回目はNEEDS_FIXES(必須1件・軽微6件)だった。必須の指摘は、改訂2の経緯の記述に旧い経路の文字列が残っていたこと(文字列を書かない形に直した)。軽微の指摘(業務時刻のファイルがルートのカバレッジの分母に入ること、2.10が独立に確かめられる2つの成果を持つこと(予算の表を2.11に分けた)、8.3の完了状態の照合先、`infra/003`の値を実行基盤の上限から導く規則として書くこと、`SCHEDULED_RUN_BUDGETS`のテストの受け持ち(CronSyncTest)、8.5の10.7)もすべて直した。
  - 2回目はPASSだった。軽微の指摘のうち、ルートのファイルごとのカバレッジの閾値を満たさない場合の扱い(dev-toolingの設定の変更を開発者へ報告し7.4の完了を保留する)、各ジョブの目安30秒が実時間であることの明記、8.3の完了状態を並行の8.5ではなく設計の値と照合することを直した。6.2の大きさの指摘は、同じ境界の中の作業のため分けなかった。タスクの承認(`approvals.tasks.approved: true`)を保った(改訂2はその後の2026-10-24に開発者が確定した)。

### 変更履歴

- 2026-10-24(改訂2): 上記の改訂。cross-spec reviewの指摘による。2026-10-24に開発者が確定。
- 2026-10-24(改訂3): Sentryの伏せ字の範囲の拡大。開発者が決定(下の改訂3の節)。
- 2026-10-24(確定): 改訂1・改訂2を開発者が推奨どおり確定。振る舞いの変更は無い(末尾の「開発者の確定(2026-10-24)」)。
- 2026-10-24(文言の整合、改訂の番号なし): パッケージのスクリプトの注記と追跡表7.8に、infra-deliveryの改訂1の実装の後のapi・eventのローカルの起動の形(`run-with-secrets --scope local --worker <api|event>`。`WORKER_SCOPED_SECRETS`の`STRIPE_API_KEY`はWorkerごとのフォルダからだけ渡る)を書き加えた。本specの実装の時点の起動の形(`infisical run`)は変えていない。振る舞いの変更は無く、タスクも変えていない。cross-spec reviewの指摘による。

## 開発者の決定による承認後の改訂(改訂3、2026-10-24)

- **状態**: 2026-10-24に開発者が決定した改訂で、確定している(仮の決定ではない)。改訂1の「範囲の外」と「開発者の判断の論点」として残していた論点を解決する。roadmapの「Requirement Ambiguities」の該当の行はコントローラーが閉じる。
- **決定**: APIキーなどの秘密の値は、例外のメッセージに現れた場合も伏せる。`SentryScrubber`の`REDACTION_PATTERNS`の適用先を、パンくずの`data`の値(既存)に加えて、例外の値(`exception.values[].value`)・イベントの`message`(`logentry`の`message`・`formatted`・文字列の`params`を含む)・パンくずの`message`へ広げる。
- **追加で対象にした項目と理由**:
  - 例外の種類(`exception.values[].type`): 通常はクラス名だが、`Error.name`はコードから任意の文字列を設定できるため対象に含めた。クラス名はパターンに当たらないため、通常の値は変わらない。
  - トランザクションの名前(`transaction`。エラーイベントにも付く)、スパンの説明(`spans[].description`)と`data`の文字列の値、`contexts.trace.data`の文字列の値: Honoの経路や外部へのHTTPの呼び出しの計装が、トークン・キーを含むURLや経路を名前・説明・`data`に入れ得るため、`scrubTransaction`でも適用する。
  - 対象にしない項目: スタックトレースのフレーム(アプリのソースの情報で利用者の値を含まない)、アプリが付けるタグ・コンテキスト(秘密情報と個人情報を入れない規則を`infra/004`に書き、コードレビューで守る)。
- **要件**: 要件9.2を、例外のメッセージと種類・イベントのメッセージ・パンくずのメッセージと値・リクエストのURL・パフォーマンストレースの名前と説明と付随する値に含まれる秘密情報と個人情報を値の形式で検出して伏せる形に広げ、`requirements.md`の「承認後の改訂」の表に改訂3の行(2026-10-24に開発者が決定)を置いた。表の見出しと注記を、改訂ごとに状態(開発者が確定・開発者が決定)を示す形に改めた。
- **変えた箇所**: 設計の`LogRecordFormat・LogRedaction`の`REDACTION_PATTERNS`の説明、`SentryScrubber`の処理、追跡表の9.2、Revalidation Triggers、LoggingDoc、Testing Strategyの`scrub-event.unit.test.ts`、Security Considerations、技術ドキュメント群の要件。タスク2.6の詳細・先に書くテスト・完了状態、8.3の詳細と要件(9.2を追加)。番号の変更は無い。
- **後続への影響**: launch-readinessの要件16.12・チェックリストA-09は、開発者の判断を求める形から、stagingでダミーの`lsk_`のキーを含む例外がSentryで伏せられて届くことを確かめる形に変わる(launch-readinessの担当)。
- **変更部分のタスクのレビューの1回目による追加**:
  - 置き換えの文字列の統一: `@logtape/redaction`の既製のカード番号のパターンは`XXXX-XXXX-XXXX-XXXX`、メールアドレスは`REDACTED@EMAIL.ADDRESS`、JWTは`[JWT REDACTED]`に置き換えるため、カード番号の形が`[REDACTED]`にならなかった。正規表現(カード番号はLuhnの検査も)を保ったまま置き換えを`REDACTED`へ包み直し、全パターンの出力を`[REDACTED]`に統一した(タスク2.5の詳細と完了状態、設計の`REDACTION_PATTERNS`の説明・Testing Strategy・Revalidation Triggers)。ログの出力の文字列も変わるが、伏せる範囲は変わらない。
  - リクエストのURL(`request.url`)も、トークンを含む経路やクエリ文字列が残り得るため対象に加えた。
  - 計装への結線の確認: タスク4.2の完了状態と`sentry.worker.test.ts`に、メッセージに公開APIのキーを含む例外が`[REDACTED]`になって届くことと、`beforeSend`・`beforeSendTransaction`のつながりを加え、4.2と追跡表の9.2に要件9.2を加えた。8.3の完了状態に、伏せ字を適用する項目の一覧と除去処理の実装の一致を加えた。
  - 改訂1との関係: テストの公開APIのキーのパターン(`lsk_`)は改訂1が加えたもので、改訂1は2026-10-24に開発者が確定したため、`lsk_`のキーのテストをそのまま使う。
- **変えたタスク(改訂3の全体)**: 2.5、2.6、4.2、8.3。番号の変更は無い。
- **変更部分のタスクの検証(改訂3)**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。1回目はNEEDS_FIXES(必須1件・軽微8件)で、必須の指摘は既製のカード番号のパターンが`[REDACTED]`ではなく`XXXX-XXXX-XXXX-XXXX`に置き換えること(置き換えの統一で直した)。軽微の指摘(要件9.2と改訂3の行の範囲、2.6のスパンの`data`とトレースのコンテキストの確かめ、`logentry`の`formatted`、4.2での結線の確認、改訂1との関係、表の注記、8.3の完了状態、リクエストのURL)もすべて直した。2回目はPASSで、軽微の指摘(SentryInstrumentationの要件への9.2、`REDACTION_PATTERNS`の説明の項目の一覧、本節の要件の要約、カード番号の置き換えの範囲)も直した。タスクの承認(`approvals.tasks.approved: true`)を保った。

## 開発者の確定(2026-10-24)

- 2026-10-24に開発者が改訂1(公開APIのキー`lsk_`のパターン)と改訂2(4:21の予算の超過の警告・ローカルの定期実行の経路・共有の補助`triggerScheduled`)を推奨どおりに確定した。改訂3は同日に開発者が決定済みである。本specの承認後の改訂は全て確定し、開発者の判断を待つ論点は残っていない。
- 確定に伴う振る舞いの変更は無い(採用していた案どおり)。要件・設計・タスクから確認を待つ旨の記述を除き、`requirements.md`の「承認後の改訂」の表の状態を確定に改めた。改訂1の取り下げに備えた代替の記述(`lsk_`のテストの置き換え)と、改訂2の開発者の確認が得られない場合のFollow-upは、確定により不要になった。
