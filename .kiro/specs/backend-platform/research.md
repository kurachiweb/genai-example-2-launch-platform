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
| Q1  | FR-RLMIT-008(Worker単位のIP制限)の除外条件        | roadmapのRequirement Ambiguities・brief  | 推奨案。Stripe Webhook・RFC 8058配信停止・画像配信ドメインをIP単位の制限の対象外とし、署名・トークン検証、エッジキャッシュ、WAFで守る            |
| Q2  | FR-RLMIT-008をclient・adminのWorkerへ適用するspec | brief「全Worker共通」とfrontend-platform | 推奨案。本specはapi・eventを担当し、client・adminのWorkerへの適用はfrontend-platformが同じ規約で実装する。規約(キー・上限・応答)を設計に明記する |
| Q3  | `reflect-metadata`の採用                          | brief・CLAUDE.md(新規パッケージ)         | 推奨案。`reflect-metadata` 0.2.2をapi・eventに版固定で宣言する。導入時にtech-stack.mdへ追記する                                                  |
| Q4  | ログの個人情報マスキングの実装手段                | DR-008・CLAUDE.md(新規パッケージ)        | 推奨案。`@logtape/redaction`を採用し、IPアドレスのパターンは独自に追加する。導入時にtech-stack.mdへ追記する                                      |
| Q5  | Workers Logsの呼び出しログの扱い                  | DR-008                                   | 推奨案。呼び出しログを無効にし、マスキング済みのアクセスログを自前で出す                                                                         |
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
  - ローカルでは`wrangler dev --test-scheduled`で起動し、`/cdn-cgi/handler/scheduled?cron=<式>`へのリクエストで任意の式のハンドラーを起こせる。
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
- **Implications**: FR-RLMIT-008は`limit: 100`・`period: 10`。Worker・環境ごとに別の`namespace_id`を割り当て、値の一覧を`docs/onboardings/project-values.md`に記載する。

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

- **Context**: 要件12・FR-RLMIT-011〜016の「カウント対象期間の開始から所定時間経過した時点でAlarm APIによりリセット」。
- **Selected Approach**: キー(ルール名とハッシュ化済みの値)ごとに1つのDurable Object(SQLite)を割り当てる。最初の要求で期間を開始してAlarmを予約し、Alarmで全データを削除する。期間の判定は純粋関数(`core/rate-limit/fixed-window.ts`)に置き、Alarmが遅れても要求時に期限切れを判定する。
- **Rationale**: Durable Objectは単一スレッドで、同じキーへの同時要求を直列化する(要件12.2)。

### Decision: Turnstileの検証はSDKを使わずsiteverifyを直接呼ぶ

- **Context**: 要件14。
- **Alternatives Considered**: サーバー側の公式SDKは無い。フロントエンド向けのウィジェット部品(frontend-platformの範囲)は対象外。
- **Selected Approach**: `fetch`でsiteverifyへPOSTし、応答の解釈(エラーコードの分類・操作名とホスト名の照合)は純粋関数にする。`fetch`は注入可能にし、単体テストとWorkers統合テストで外部へ通信しない。
- **Follow-up**: 判定サービスへの到達不能は5秒で打ち切る。

### Decision: Worker単位のIP制限のキーとクライアントIP

- **Context**: 要件13・Q1・Q2。
- **Selected Approach**: キーは`ip:<送信元IPアドレス>`。送信元IPアドレスは`ClientIpResolver`で求め、既定は`CF-Connecting-IP`ヘッダー。特定できない場合は`ip:unknown`として1つのキーで数える(制限を外さない安全側)。api-gatewayは、内部認証を伴う中継リクエストでだけ引き継がれた元のIPを返すリゾルバを`createWorkerApp`へ渡す。キーはRate Limitingバインディングの内部カウンタにだけ使われ、本specの保存先には残らないため、FR-RLMIT-017(Durable Objectsのキーのハッシュ化)の対象外とする。
- **Rationale**: frontend-platformが同じ規約を、共有コード無しで再現できる単純さを優先する。

### Generalization・Build vs Adopt・Simplification

- **Generalization**: FR-RLMIT-008はRate Limitingバインディングの汎用ミドルウェア(`bindingRateLimit`)にキーの関数と除外規則を与えた特殊形として実装し、public-apiのFR-RLMIT-007も同じ部品で実装できる。FR-RLMIT-001〜006・009〜016は、汎用の厳密カウンタ(ルール名・上限・期間・リセット)で表現できる。
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
- Drizzle v1がRCのまま — `drizzle-orm`・`drizzle-kit`を1.0.0-rc.4で完全固定し、`db:migrations:check`でマイグレーションの検出を確かめる。
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
