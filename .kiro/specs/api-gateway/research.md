# Research & Design Decisions

## Summary

- **Feature**: `api-gateway`
- **Discovery Scope**: New Feature(backend-platformの設計の上に、GraphQL・内部認証・REST骨格を新設する。`apps/api`・`apps/event`はbackend-platformの実装前で空である)
- **Key Findings**:
  - Service Bindingsの名前付きエントリポイント(`WorkerEntrypoint`を継承したクラス)は、カスタムドメインやルートからは呼ばれず、Service Binding経由でしか到達できない。呼び出し元ごとにエントリポイントを分ければ、秘密鍵の共有も`ctx.props`も使わずに内部認証と呼び出し元の識別ができる。Workers統合テストでは`cloudflare:workers`の`exports.<クラス名>.fetch`で呼び出せることをscratchpadで確かめた。
  - GraphQL Yoga 5.24.1・GraphQL Armor 3.2.0・persisted operations 3.24.1・`graphql` 16.14.2は、workerd上で1つの`graphql`の実体だけで動作した。Armor 3.2.0は`graphql` ^16.10を直接依存に持つため、17系にすると二重読み込みになる。
  - GraphQL Code Generatorのclient-presetは、persisted documentsの識別子を`sha256:<16進>`の形(GraphQL over HTTPのAppendix A)で出力する。Yogaの既定の抽出はAPQ形式(`extensions.persistedQuery.sha256Hash`)だけを読むため、`extraParamNames: ['documentId']`と独自の`extractPersistedOperationId`で`documentId`を読む。
  - Yogaは`extensions.http.status`を持つエラーのうち最大の状態コードを応答に使い、`extensions.http.headers`をヘッダーへ反映する。429・503と`Retry-After`はこの仕組みで返せる。
  - Armorの拒否のエラーは、`exposeLimits: false`のとき上限の種類を問わず同じ文言になる。種類ごとのエラーコードは、各保護の`onReject`で分類する。

## 要件フェーズ前の確認事項(2026-10-17)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                                                      | 根拠                                                                    | 回答(2026-10-17)                                                                                                                                                                                             |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | GraphQLのスキーマの定義方式と導入するパッケージ           | briefのApproach・CLAUDE.md(新規パッケージ)・NFR-PERF-008・NFR-MAINT-004 | 推奨案。スキーマファーストと型生成を採用し、`@graphql-codegen/cli` 7.4.3・`@graphql-codegen/typescript` 6.1.0・`@graphql-codegen/typescript-resolvers` 6.1.0を導入する。`graphql`は16.14.2に固定する         |
| Q2  | 利用者側と管理者側で実行できるGraphQL操作の範囲を分けるか | SW-001・COM-004・NFR-SECUR-008・NFR-SECUR-019・admin-foundationのbrief  | 推奨案。スキーマは1つとし、許可リストを呼び出し元別にする                                                                                                                                                    |
| Q3  | デプロイ後、現行版から消えた操作をいつまで受け付けるか    | NFR-SECUR-019・NFR-AVAIL-005・NFR-AVAIL-006・brief                      | 推奨案ではなく「直前のリリース分まで受け付ける」を採用。現行版と直前の版の操作を合わせて受け付け、それより古い操作は自動で外れる。デプロイ履歴の保持方法は設計で決め、新しいリソースが必要なら追加で確認する |
| Q4  | ローカル環境でGraphiQLを使うための例外                    | tech-stack.md・COM-003・NFR-SECUR-015・NFR-SECUR-018・NFR-SECUR-019     | 推奨案。ローカル環境だけGraphiQLの経路を外部経路に開き、その経路だけで任意の操作とintrospectionを許す。フロントエンドからの中継には、ローカルでも許可リストを適用する                                        |
| Q5  | クエリの複雑度(コスト)の算出方法と上限値                  | NFR-SECUR-017                                                           | 推奨案。GraphQL Armorの既定の算出方法と上限5000を使い、登録済みの全操作が上限以下であることを検査で確かめる                                                                                                  |
| Q6  | セキュリティヘッダーをAPI・イベントサーバーへ付けるspec   | NFR-SECUR-010・frontend-platformのbrief・backend-platformのdesign       | 推奨案。本specが共有コードに部品を作り、apiとeventの両方の全応答に付ける。画像配信のCSPはmedia-pipelineが上書きできるようにする                                                                              |

### 提示した選択肢(記録)

- Q1: スキーマファーストと型生成(採用) / コードファーストのPothos(`@pothos/core` 4.15.1・`@pothos/plugin-dataloader` 4.4.6) / graphql-jsで直接記述
- Q2: 1スキーマで許可リストを呼び出し元別にする(採用) / 呼び出し元ごとにスキーマを分ける / 1スキーマで許可リストも共通にする
- Q3: 累積して明示的に削除 / 直前のリリース分まで受け付ける(採用) / 現行の版だけを受け付ける
- Q4: ローカルだけGraphiQLを開く(採用) / GraphiQLを提供しない / フロントエンド側でGraphiQLを提供する
- Q5: Armorの既定(上限5000)(採用) / 登録済み操作の最大コストから上限を決める / 厳しい固定値(例: 1000)
- Q6: 本specがapiとeventに付ける(採用) / 本specはapiだけに付ける / Cloudflareのゾーン設定で一括して付ける

### 確認済みのため質問しない事項

- roadmapの「Requirement Ambiguities」: 本specが担当する行は無い。
- briefの「要件フェーズで開発者に確認する」論点: 該当は無い。スキーマの定義方式は設計フェーズの扱いだったが、新しいパッケージを伴うためQ1で先に確認した。
- CIへの組み込み: `.github/workflows`はinfra-deliveryが所有する(roadmap、dev-tooling・backend-platformの前例)。本specはスキーマの出力・生成物の検査・許可リストの生成を、CIから呼べるコマンドとして提供する。
- 内部認証の手段: Service Bindingsの名前付きエントリポイントへはService Binding経由でしか到達できず、`ctx.props`はデプロイ権限を持つ者しか設定できない(Cloudflare Docs「Context」)。秘密鍵を共有せずに呼び出し元を識別できるため、詳細は設計で決める。
- セッションの分担: identity-authのbriefがセッションの発行・失効・保存(NFR-SECUR-002・029〜031)を受け持つ。本specは、識別子の受け渡しの契約と検証のポートだけを持ち、identity-authの実装が入るまでは常に未ログインとして扱う。
- persisted documentsの保管場所: KVなどの新しいリソースを使わず、APIのバンドルに含める前提で設計する。新しい操作を含むフロントエンドを出すときにAPIを先にデプロイする順序を、infra-deliveryとの契約にする。
- ページングと共通スカラー: 要件定義書がカーソル型(FR-FOLOW-006・FR-COMNT-004)とオフセット型(FR-DIR-011)の両方を求めるため、両方の共通の型と日時のスカラーを規約に含める。
- サブスクリプションとGraphQLのマルチパートアップロード: リアルタイム配信の要件が無く、アップロードはSW-009のストリーミング中継(media-pipeline)で行うため、範囲外として無効にする。
- SW-009・SW-011の中継先となる内部REST: 本specは内部経路だけで受け付ける経路の追加規約を提供し、経路自体はmedia-pipelineが追加する。
- introspectionとGraphiQLを無効にする環境: NFR-SECUR-018の「デプロイ先環境」とtech-stack.mdから、stagingとprodの両方で無効にする。
- `graphql`の版: GraphQL Armor 3.2.0(最終リリース2025-12-29)が`graphql` ^16.10を直接依存に持つため、二重読み込みを避けて16.14.2に固定する。`@hono/zod-openapi` 1.6.3の相手依存(zod ^4・hono >=4.10)は、上流で固定した版と合う。
- 上流の契約とのずれ: backend-platformの`ClientIpResolver`は`Request`だけを受け取り、ミドルウェアの順序は`createWorkerApp`だけが定める。中継の判定はエントリでの印付けで、IP制限の429へのCORSヘッダーの付与はエントリでの応答の後処理で、上流の契約を変えずに実現する。
- GraphQLでのレート制限の応答: FR-RLMIT-001・003〜006の対象はGraphQLのミューテーションで提供されるため、レート制限の超過はGraphQLの応答でも429と`Retry-After`を返す。
- RESTのエラー形式とバリデーションエラーの状態コード: CLAUDE.mdに従い`ecc:api-design`(400・422の使い分け)とbackend-platformの共通のエラー形式に従う。
- Armorのその他の保護: トークン数1000・ディレクティブ数50・フィールド候補の非表示を既定のまま有効にする。
- briefの要件IDの誤記: 「GraphQLのクライアント観測p95は300ms以内(NFR-PERF-004)」はNFR-PERF-007の誤りである。計測と検証はfrontend-platform・launch-readinessが行う。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する。

## Research Log

### 内部認証の方式(Service Bindingsの名前付きエントリポイント)

- **Context**: 要件1(NFR-SECUR-015)。外部から届く要求とService Bindingsで届く要求を、要求の内容に頼らずに区別する必要がある。
- **Sources Consulted**: Cloudflare Docs「[Service bindings - RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)」(Named entrypoints)、「[Context](https://developers.cloudflare.com/workers/runtime-apis/context/)」(`ctx.props`・`ctx.exports`)、「[Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)」(`services[].entrypoint`)、「[Multi Workers](https://developers.cloudflare.com/workers/local-development/multi-workers/)」。scratchpadでのWorkers統合テスト。
- **Findings**:
  - Workerは既定のエクスポートに加えて、`WorkerEntrypoint`を継承した名前付きのクラスを任意の数だけエクスポートできる。呼び出し側はWrangler設定の`services[].entrypoint`で接続先のクラスを指定する。カスタムドメイン・ルートからの要求は既定のエクスポートだけが受ける。
  - `ctx.props`は呼び出し側の設定で付けられ、デプロイ権限を持つ者しか設定できないため、秘密鍵や署名なしで信頼できる。
  - 別々の`wrangler dev`・`vite dev`の間でもService Bindingsで通信できる。名前付きエントリポイントへの接続をフロントエンドの`vite dev`から行う手順はfrontend-platformで確かめる。
  - scratchpadで、`ClientGateway`・`AdminGateway`の2つのクラスがそれぞれ固定の呼び出し元のヘッダーを付けてHonoアプリへ渡す構成を作った。Workers統合テストから`exports.ClientGateway.fetch`・`exports.default.fetch`で呼び分けられた。外部経路で呼び出し元のヘッダーを付けた要求は、既定のエクスポートがヘッダーを取り除いた後に404となった。
- **Implications**: 呼び出し元ごとに名前付きエントリポイントを分け、`ctx.props`は使わない(ローカル開発での`props`の扱いに依存しない)。呼び出し元の情報は、エントリポイントが要求へ付けるヘッダーで内側のHonoアプリへ渡す。外部経路の既定のエクスポートは、同名のヘッダーを必ず取り除く。

### GraphQL Yoga・GraphQL Armor・persisted operationsのworkerdでの動作

- **Context**: 要件4〜7。tech-stack.mdの採用技術をworkerd上で組み合わせられるか、版の組み合わせと挙動を確かめる。
- **Sources Consulted**: npmの`graphql-yoga@5.24.1`・`@graphql-yoga/plugin-persisted-operations@3.24.1`・`@graphql-yoga/plugin-disable-introspection@2.25.1`・`@escape.tech/graphql-armor@3.2.0`(同梱の`graphql-armor-*`)・`dataloader@2.2.3`・`graphql@16.14.2`の配布物。scratchpadに`wrangler` 4.124.0・`vitest` 4.1.11・`@cloudflare/vitest-pool-workers` 0.22.0・`hono` 4.13.13で最小構成を作り、Workers統合テストで確かめた。
- **Findings**:
  - `graphql`は1つの実体(16.14.2)だけが導入され、Armorの依存(^16.10)と一致した。17系はArmorの依存と食い違う。
  - persisted operationsは`getPersistedOperation(key, request, context)`で要求ごとに照会でき、呼び出し元別の許可リストを実現できた。利用者側から管理者側の操作を指定すると未登録として拒否された。
  - `allowArbitraryOperations`に関数を渡すと要求ごとに任意の操作を許すかを決められる。ローカル環境の外部経路(GraphiQL)だけ許し、内部経路では拒否できた。GraphiQLの画面(HTML)とintrospectionもローカル環境の外部経路で動作した。GraphiQLの画面はunpkgのスクリプトを読み込む。
  - `batching: false`では配列の本文が状態コード400で拒否された。`multipart: false`でマルチパートの要求を受け付けない。
  - Armorの深さ・エイリアス・コストの上限は、拒否時に`Syntax Error: Query validation error.`(`exposeLimits: false`)を返し、エラーコードを持たない。各保護の`onReject`に渡したコールバックが拒否のエラーを受け取る。コストの上限を一時的に2000へ下げると、算出値約2332の操作が拒否された。
  - Armorのコストは、子の選択を持つ項目を`objectCost`(2)、持たない項目を`scalarCost`(1)とし、子の合計に`depthCostFactor`(1.5)を掛けて加える。操作の直下の項目は係数を掛けずに合計する。
  - `maskedErrors.maskError`で、想定外の例外を定型の文言に置き換えられる。`GraphQLError`の`extensions.http`に`status`と`headers`を付けると、応答の状態コード(複数あれば最大値)と`Retry-After`に反映された。
  - 同じ型の同じ項目を複数のスキーマ定義が同じ型で定義しても、`createSchema`(内部の型定義の結合)はエラーにしない。異なる型で定義した場合と、スキーマに無い型・項目のリゾルバを渡した場合はエラーになる。
  - persisted operationsの未登録・識別子なし・本文だけの各エラーは状態コード200で返る。`customErrors`で文言・`extensions.code`・`extensions.http`を差し替えられる。
  - esbuildでの縮小済みバンドルは約981KB(gzip後約248KB)で、Workerのサイズ上限に対して十分小さい。
- **Implications**: 実行前の拒否(上限・許可リスト・構文・検証)は独自のエラーコードと状態コード400に揃える。モジュール間の項目の重複は、合成の前に独自に検査する。スキーマと許可リストはisolateごとに最初の要求で構築する(グローバルスコープの1秒以内の規則)。

### persisted documentsの形式とクライアントからの送り方

- **Context**: 要件5。frontend-platformのclient-presetが出力する一覧を、そのまま許可リストの元にしたい。
- **Sources Consulted**: npmの`@graphql-codegen/client-preset@6.2.0`の配布物、[GraphQL over HTTP Appendix A(Persisted Documents)](https://github.com/graphql/graphql-over-http/blob/main/spec/Appendix%20A%20--%20Persisted%20Documents.md)。
- **Findings**:
  - `persistedDocuments: true`で、出力先に`persisted-documents.json`(識別子から本文への対応)を出力する。既定のハッシュは`sha256`で、識別子は`sha256:`を前置した16進の文字列になる。本文は正規化して印字した文字列である。
  - Yogaの要求の本文に`documentId`を含めるには`extraParamNames: ['documentId']`が要る。`documentId: "sha256:<16進>"`の要求を、独自の抽出関数で照会できることをscratchpadで確かめた。
- **Implications**: フロントエンドは`{ documentId, operationName, variables }`を送る。許可リストの生成は、識別子が本文のSHA-256と一致することを確かめる。

### GraphQL Code Generatorによるリゾルバの型生成

- **Context**: 要件9・Q1。
- **Sources Consulted**: npmの`@graphql-codegen/cli@7.4.3`・`@graphql-codegen/typescript@6.1.0`・`@graphql-codegen/typescript-resolvers@6.1.0`。scratchpadでの生成と型検査。
- **Findings**:
  - スキーマファイルを入力にして`Resolvers`型を生成でき、生成した`Resolvers`型の配列を`createSchema`の`resolvers`に渡して型検査が通った。
  - `graphql-codegen --check`は、生成物が最新なら終了コード0、古ければ1で、古いファイル名を表示する。
  - 印字には`graphql`の`lexicographicSortSchema`と`printSchema`を使い、型と項目の順序を正規化できる。
  - Workers統合テスト(Vitest)では、Viteの`?raw`のimportでスキーマファイルを文字列として読み込めた。
- **Implications**: 生成コマンドは、スキーマファイルの印字の後にコード生成を実行する。検査コマンドは、印字結果の比較と`--check`を行う。Workers統合テストは、登録箇所から合成した印字結果と`?raw`で読んだスキーマファイルを比べる。生成物は`generated/`に置き、整形・静的解析・カバレッジの対象外とする(dev-toolingの生成コードの命名契約)。

### `@hono/zod-openapi`による公開RESTの骨格

- **Context**: 要件10・11。
- **Sources Consulted**: npmの`@hono/zod-openapi@1.6.3`(相手依存`zod` ^4・`hono` >=4.10)。scratchpadでのWorkers統合テスト。
- **Findings**:
  - `OpenAPIHono`の`defaultHook`で検証失敗を共通のエラー形式(状態コード400・項目ごとの詳細)に変換できた。`doc31`でOpenAPI 3.1の仕様を配信でき、`openAPIRegistry.registerComponent('securitySchemes', ...)`でBearer認証を宣言できた。
  - `openAPIRegistry.definitions`に登録済みの経路(メソッド・パス)が残るため、CORSの`Access-Control-Allow-Methods`を経路ごとに算出できる。
- **Implications**: 公開RESTは`/v1`の下に`OpenAPIHono`をマウントする。CORSは経路表からメソッドを求め、Workerの応答全体を後処理する形で付ける(IP制限の429や環境の検証失敗の500にも付けるため)。

### backend-platformの契約との接続

- **Context**: 上流は設計・タスクまで承認済みで、実装は未着手である。
- **Findings**:
  - `createWorkerApp`はミドルウェアの順序(Sentry→相関ID・クライアントIP→IP制限→`/health`→環境の検証→コンテナ→各モジュールの経路)を唯一定義し、アプリは変えない。IP制限の429はモジュールの経路より前で返るため、CORSとセキュリティヘッダーはHonoの中ではなく、Workerのエクスポートの後処理で付ける。
  - `ClientIpResolver`は`(request: Request) => string | undefined`で、`env`・`ctx`を受け取らない。内部経路の判定は、名前付きエントリポイントが付けるヘッダー(外部経路では取り除かれる)で行う。
  - `scrubEvent`はSentryのイベントから`cookie`・`authorization`・`cf-connecting-ip`などのヘッダーを除く。本specが追加する`x-original-client-ip`・`x-session-token`・`cf-turnstile-response`は除外の一覧に無いため、一覧へ追記する。
  - D1は1つのクエリのバインド変数を100個までに制限する(`db/002`)。DataLoaderの一括読み込みの件数の上限を既定で50にする。
- **Implications**: 上流の型と順序は変えない。共有コードへの変更は、`scrubEvent`の除外ヘッダーの追記と、`workers/http/security-headers.ts`の新設に限る。

### 参照したスキル

- `ecc:api-design`: 成功応答(`data`・`meta`)、オフセット型(`total`・`page`・`per_page`・`total_pages`)とカーソル型(`has_next`・`next_cursor`)のページング、400と422の使い分け、URLでの版の表現。
- `ecc:security-review`: CORSの`*`をCookie認証の無い経路に限ること、内部経路のヘッダーの偽装対策、セキュリティヘッダー。
- `cloudflare:workers-best-practices`・`cloudflare:wrangler`: 名前付きエントリポイント、グローバルスコープでの初期化の回避、`wrangler types`。
- `ecc:error-handling`: 想定内の失敗と想定外の例外の分離、利用者に見せる文言の定型化。

## Architecture Pattern Evaluation

| Option                                         | Description                                                               | Strengths                                                      | Risks / Limitations                                                       | Notes  |
| ---------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| 呼び出し元ごとの名前付きエントリポイント       | `ClientGateway`・`AdminGateway`を公開し、既定のエクスポートは外部経路だけ | 実行基盤が到達経路を保証する。秘密鍵の管理と照合が不要         | エントリポイント名がfrontend-platformとの契約になる                       | 採用   |
| 共有シークレットのヘッダー                     | フロントエンドが秘密値をヘッダーで送り、APIが照合する                     | 仕組みが単純                                                   | 秘密値の配布・ローテーション・漏えい時の影響。外部経路からも試行できる    | 不採用 |
| 1つの名前付きエントリポイントと`ctx.props`     | `props`で呼び出し元を渡す                                                 | エントリポイントが1つで済む                                    | ローカル開発・テストでの`props`の扱いに依存する                           | 不採用 |
| Hono内の1経路にGraphQLと内部RESTを置く(採用案) | backend-platformの`AppModule`として経路を登録し、経路ごとに内部経路を確認 | 上流のミドルウェア(IP制限・環境の検証・コンテナ)をそのまま使う | 経路ごとの確認漏れ — 内部経路限定のミドルウェアと登録箇所で一律に適用する | 採用   |

## Design Decisions

### Decision: 外部経路の後処理(ヘッダーの除去・CORS・セキュリティヘッダー)をWorkerのエクスポートで行う

- **Context**: 要件1.4・11.1・12.1。IP制限の429・環境の検証失敗の500は、Honoのモジュールの経路より前で返る。
- **Alternatives Considered**:
  1. backend-platformの`createWorkerApp`に先頭のミドルウェアの差し込み口を加える — 上流の契約(順序は`createWorkerApp`だけが定義)を変える。
  2. Workerのエクスポートで要求の前処理と応答の後処理を行う — 上流の契約を変えずに全応答へ適用できる。
- **Selected Approach**: 2。既定のエクスポートは、内部経路用のヘッダーを取り除いてからbackend-platformのハンドラーへ渡し、応答に公開APIの経路ならCORSを、すべてにセキュリティヘッダーを付ける。名前付きエントリポイントもセキュリティヘッダーを付ける。eventの既定のエクスポートも同じ部品で包む。
- **Trade-offs**: Honoのミドルウェアと別の場所に処理が増える。順序の唯一の定義(Hono内)と、エクスポートの包み(Hono外)の2段になることを`backend/006`に記載する。

### Decision: 直前のリリースの操作の一覧をGitの履歴から読む

- **Context**: Q3(現行と直前のリリースを受け付ける、新しいリソースは使わない)。
- **Alternatives Considered**:
  1. KVやD1に履歴を保存する — 新しいリソースか業務データベースへの書き込みが要る。
  2. 許可リストの履歴をリポジトリにコミットする — 環境ごと(stagingとprod)にデプロイの間隔が異なり、「直前のリリース」と一致しない。
  3. デプロイ時に、その環境へ直前にデプロイしたコミットを指定し、そのコミットのフロントエンドの操作の一覧を`git show`で読む — 新しいリソースが要らず、環境ごとの直前のリリースと一致する。
- **Selected Approach**: 3。`graphql:allowlist --previous-ref <コミット>`が、現行の一覧と指定コミットの一覧の和集合から許可リストを生成する。直前のコミットの特定(デプロイ記録の参照など)とCIでの呼び出しはinfra-deliveryが行う。指定しない場合は現行の一覧だけで生成する(ローカル・初回デプロイ・コミットする内容)。
- **Trade-offs**: CIのチェックアウトに直前のコミットまでの履歴が要る。直前のリリースの操作のうち現行のスキーマで検証に通らないもの(破壊的変更で使えなくなった操作)は除外し、警告として一覧を表示する(実行しても失敗するため)。
- **Follow-up**: infra-deliveryが、デプロイの記録から直前のコミットを求める方法を決める。

### Decision: スキーマモジュールの合成は独自の重複検査の後に`createSchema`へ渡す

- **Context**: 要件8.1・8.2。
- **Selected Approach**: 各モジュールの`typeDefs`を解析し、ルート型(`Query`・`Mutation`)以外の型の重複定義と、型と項目の組の重複を検出したら`SchemaCompositionError`を投げる。重複が無ければ、基盤の型定義(スカラー・ページング)を先頭にして`createSchema`へ渡す。リゾルバの過不足は`createSchema`の既定の検査に任せる。
- **Rationale**: `createSchema`は同じ型の同じ項目の重複を黙って結合するため、spec間の衝突に気付けない。

### Decision: 実行前の拒否は状態コード400、実行中の失敗は200(429・503を除く)

- **Context**: 要件7.3・7.4、GraphQL over HTTPの慣例。
- **Selected Approach**: 許可リスト・上限・構文・検証・要求の形式による拒否は、独自のエラーコードと`extensions.http.status: 400`を付ける。リゾルバの`AppError`は200のまま`extensions.code`で返し、`rate_limited`・`unavailable`だけ429・503と`Retry-After`を付ける。想定外の例外は`internal_error`(データが無ければYogaの規則で500)。
- **Rationale**: フロントエンドはエラーコードで分岐し、状態コードは再試行の要否とレート制限の要件(FR-RLMIT)にだけ使う。

### Decision: セッションの検証は最初の参照時に1回だけ行う

- **Context**: 要件3・NFR-PERF-007。
- **Selected Approach**: `SessionAccess.principal()`を最初に呼んだときに`SessionVerifier.verify`を1回だけ呼び、結果を処理単位の中で使い回す。認証を要さない操作ではデータベースへ問い合わせない。Cookieの発行・削除の指示は、処理の終わりに応答ヘッダーへ反映する。

### Generalization・Build vs Adopt・Simplification

- **Generalization**: 内部経路の判定(`internalOnly`)は、GraphQLとファイルの中継先(media-pipeline)の両方が使う1つの部品にする。CORSは経路表を入力にした方針として作り、public-apiの経路の追加で再計算される。ページングはカーソル型とオフセット型の2つの共通の型と補助関数にまとめる。
- **Build vs Adopt**:
  - 採用: GraphQL Yoga(サーバー・GraphiQL・マスキング)、GraphQL Armor(上限)、persisted operations・disable-introspectionプラグイン、DataLoader、`@hono/zod-openapi`、GraphQL Code Generator(リゾルバの型)。
  - 自作: モジュールの重複検査(既製品は重複を黙って結合する)、許可リストの生成(client-presetの出力と直前のリリースの結合、Armorと同じ上限での検証)、エラーコードの分類(Armorはコードを持たない)、CORSの後処理(Honoの`cors`ミドルウェアはIP制限の429に付けられない)、セキュリティヘッダー(数行)。
  - 不採用: `@graphql-tools/merge`の直接利用(Yogaの`createSchema`で足りる)、`graphql-scalars`(日時のスカラー1つだけ)、Honoの`secureHeaders`ミドルウェア(Hono外の後処理が必要)。
- **Simplification**:
  - 呼び出し元ごとのスキーマの分割、GraphQLの購読・マルチパート、APQの自動登録は作らない。
  - 許可リストの保存先にリソースを使わず、バンドルに含める。
  - セッションの保存・発行・有効期限は持たず、ポートと既定の「常に未ログイン」の実装だけを持つ。

## Risks & Mitigations

- フロントエンドの`vite dev`から別プロセスのAPIの名前付きエントリポイントへ接続できない可能性 — frontend-platformで確かめ、できなければ`auxiliaryWorkers`でAPIを同じプロセスに載せる手順をオンボーディングに記載する。
- GraphQL Armorの更新が停滞し、`graphql` 17系へ移れない — `graphql`を16.14.2に固定し、Armorが17系に対応したら一括で更新する。Armorの代替が必要になった場合は開発者に確認する。
- 直前のリリースの指定漏れで、デプロイ直後に旧版の画面の操作が拒否される — 指定が無いデプロイでは警告を表示し、infra-deliveryのCIで必ず指定する。
- 元のクライアントIPの付与漏れで、内部経路の全要求が不明の送信元として1つのキーで数えられ、IP制限に達する — 付与漏れを警告ログに出し、frontend-platformのWorkers統合テストで付与を確かめる。
- Yogaのモジュールの読み込みがグローバルスコープの時間を押し上げる — スキーマ・プラグインの構築は最初の要求まで遅らせ、デプロイ時の起動時間をinfra-deliveryのデプロイ出力で確かめる。
- GraphiQLの画面はunpkgのスクリプトを読み込む — ローカル環境だけで提供し、その応答に限りCSPを緩める。

## References

- [Service bindings - RPC(Named entrypoints)](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/) — 名前付きエントリポイント
- [Context(props・exports)](https://developers.cloudflare.com/workers/runtime-apis/context/) — `ctx.props`の信頼性、`ctx.exports`
- [GraphQL Yoga: Persisted Operations](https://the-guild.dev/graphql/yoga-server/docs/features/persisted-operations) — 許可リストと抽出関数
- [GraphQL Armor](https://escape.tech/graphql-armor/docs/getting-started) — 上限の既定値とコールバック
- [GraphQL over HTTP Appendix A](https://github.com/graphql/graphql-over-http/blob/main/spec/Appendix%20A%20--%20Persisted%20Documents.md) — `sha256:`付きの識別子
- [GraphQL Code Generator: typescript-resolvers](https://the-guild.dev/graphql/codegen/plugins/typescript/typescript-resolvers) — リゾルバの型
- [Hono: Zod OpenAPI](https://hono.dev/examples/zod-openapi) — 経路と仕様の一体化

## public-apiの依頼による承認後の改訂(改訂1、2026-10-24)

- **状態**: 要件・設計・タスクの承認の後の改訂で、public-apiの依頼による。2026-10-24に開発者が確定(Expose-Headersを除く)。開発者に確認したQ1〜Q6とは別に、`requirements.md`の「承認後の改訂」の表に改訂1として記録した。本specの改訂はすべて確定している。
- **Context**: public-apiのresearch.mdの「上流・後続specへの影響」(コーディネーター経由。requested by public-api)。本specの経路は`/v1`にマウントした子のアプリに登録されるため仕様書の`paths`は基準パスを含まず、`servers`が無いとSwagger UIの試行や外部のコード生成がオリジンの直下を呼んでしまう。また仕様書の`info`(認証・権限・回数の制限の説明)を登録箇所から渡す口が無く、public-apiのタスク7.2が保留になっていた。あわせて、公開APIのCORSに回数の制限のヘッダーを公開する`Access-Control-Expose-Headers`を加える依頼(推奨の改訂)もあった。
- **改訂の内容**(確定):
  - `createRestModule(routes, options?: { readonly info?: { readonly title: string; readonly version: string; readonly description?: string } })`とし、`doc31`へ`info: options?.info ?? 既定の情報`と`servers: [{ url: PUBLIC_API_BASE_PATH }]`(`/v1`)を渡す。未指定なら既定の`title`(`Launch Stadium Public API`)と`version`(`1.0.0`)を使う(要件10.9・10.10)。
- **採用しなかった依頼**: `createPublicApiCorsPolicy`が基準パスの下の全応答に`Access-Control-Expose-Headers: Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset`を付ける案(`PUBLIC_API_EXPOSED_HEADERS`)。開発者の回答(第20回)は「serversとinfoだけ。Access-Control-Expose-Headersは入れない」で、推奨と異なる。一度加えた要件11.6と、設計・タスク(7.2・8.2・9.2・9.5)・テストの該当部分を取り除き、CORSは改訂の前の値(`Access-Control-Expose-Headers`を付けない)に戻した。ブラウザのクライアントは回数の制限のヘッダーを読めないが、サーバー間の利用には影響しない。
- **Alternatives Considered**:
  1. 相対の`servers`と登録箇所からの`info`(採用)
  2. 仕様書のパスに基準パスを含める(子のアプリを`/v1`にマウントする構成と`@hono/zod-openapi`の経路の登録を変える必要がある)
  3. 絶対URLの`servers`(環境ごとのオリジンを本specが知る必要があり、Wrangler設定の変数が増える)
- **Rationale**: 相対の`servers`は仕様書の場所に対して解決されるため、ローカル・staging・prodのいずれでも同じ値で正しい基準パスを指す。`info`は既定値を持つ省略可能な引数とし、本specの段階の呼び出し(`createRestModule(REST_ROUTES)`)を変えない。
- **変えた箇所**(確定後): 要件10.9・10.10と「承認後の改訂」の表、設計のRevalidation Triggers・追跡表・コンポーネントの表・`PublicApiApp・Responses・RouteTable・CorsPolicy・RestModule`の契約と説明・`api-worker.ts`の説明・`backend/005`の内容・Testing Strategy・本specが定める固有の値、タスク7.3・9.2・9.5(仕様書の`servers`と`info`)。改訂1によるタスク7.2の変更として残るのは、`_Boundary: RouteTable, CorsPolicy_`の追加だけである(テスト・実装・完了状態・要件の対応は改訂の前に戻した)。番号の変更は無い。
- **変更部分のタスクの検証(改訂1の追加時、Expose-Headersを含む範囲)**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って新しいサブエージェントによる独立した確認(independent)で行った。判定はPASSだった。軽微の指摘のうち、9.5の固有の値の記載対象に相対のサーバーを加え、7.3の関数名と引数の名前を能力の表現に改めた(Expose-Headersに関する修正は確定の際に取り除いた)。
- **変更部分のタスクの検証(2026-10-24の確定後の範囲)**: Expose-Headersを取り除いた後の要件・設計・タスク・research.mdを、新しいサブエージェントによる独立した確認(independent)でレビューした。要件の90件の受け入れ基準の番号がすべてタスクと設計の追跡表にあることを機械的に確かめた。1回目の判定はPASSだった。軽微の指摘のうち、本節の7.2の記述と、検証の範囲の区別を直した。`Access-Control-Expose-Headers`が付かないことを確かめるテストの追加は、取り除く指示の範囲を超えるため加えていない。タスクの承認を保った。

---

## 実装前のギャップ分析(2026-10-26)

- **状態**: `/cc-sdd:kiro-validate-gap api-gateway`による分析で、要件・設計・タスクは変えていない。設計の作成時(2026-10-17〜24)は`apps/api`・`apps/event`・`apps/backend-lib`がbackend-platformの実装前だったため、実装済みのコード(コミット`e87aea4`)と、設計が前提にした上流の契約を照合した。
- **前提の変化**: backend-platformは全タスクを完了し、`ready_for_implementation: true`になった。本specの設計の承認後に、backend-platformへ承認後の改訂4〜8(Sentryの収集設定、逐次送信のスパンの除去、一括検査の`cf-typegen:check`、層の規則の共通化など)が加わった。実装の対象として次に着手できるspecは本specである。
- **steering**: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specのコードで代替した。

### 上流の契約と実装の照合

| 設計が前提にした契約                                                                        | 実装(`apps/backend-lib`・`apps/api`)                                                                                                  | 判定                                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `createWorkerApp`の`resolveClientIp?: ClientIpResolver`(既定は`resolveConnectingIp`)        | `workers/http/create-worker-app.ts`にある                                                                                             | 一致                                                                                               |
| ミドルウェアの順序(Sentry→相関ID・クライアントIP→IP制限→`/health`→環境の検証→コンテナ→経路) | 同じ順序で、`notFound`は`handleNotFound`、`onError`は`createErrorHandler`                                                             | 一致                                                                                               |
| `createWorkerHandler`が`ExportedHandler<E>`を返す                                           | `fetch`はログの設定(`ensureLogging`)の後に`app.fetch`を呼ぶ。`scheduled`・`queue`だけを`withSentryForScheduledAndQueue`で包む         | 一致。エントリポイントは`app.fetch`ではなく`handler.fetch`を呼ぶ必要があり、設計はそのとおりである |
| `AppModule`・`PlatformHonoEnv`(`correlationId`・`clientIp`・`container`)                    | 改訂8で`AppModule`の型制約が`Hono<any, any, any>`に緩んだ                                                                             | 一致(設計の`AppModule<Hono<PlatformHonoEnv<E>>>`はそのまま使える)                                  |
| `AppError`・`toErrorResponse`・`NOT_FOUND_RESPONSE`、再試行の秒数は429・503だけ             | `core/errors/app-error.ts`・`error-envelope.ts`                                                                                       | 一致                                                                                               |
| `BotVerifier.assertHuman({ token, remoteIp, expectedAction })`                              | `workers/bot-protection/turnstile-verifier.ts`                                                                                        | 一致                                                                                               |
| IP制限のキー`ip:<IP>`・送信元が不明なら`ip:unknown`                                         | `workers/rate-limit/ip-rate-limit.ts`                                                                                                 | 一致                                                                                               |
| `scrubEvent`の除くヘッダーの一覧                                                            | 改訂4・6で、`scrubSpan`も同じ一覧で`http.request.header.<名前>`の属性を除く。SDKの`dataCollection.httpHeaders: false`で元から集めない | 一致。本specの追記はイベントとスパンの両方に効く多層の防御になる                                   |
| GraphQLの本文・変数をSentryへ送らない(3.7・13.1)                                            | `buildSentryOptions`の`dataCollection.graphQL: { document: false, variables: false }`                                                 | 一致                                                                                               |
| 4層の依存方向のimport制限                                                                   | 改訂8で`config/eslint/backend-layers.ts`の`createBackendLayerRules`へ共通化                                                           | 一致。ただし後述のG2                                                                               |
| `cloudflare:workers`の`exports`によるWorkers統合テスト                                      | `src/index.worker.test.ts`が`exports.default.fetch`を使う。`worker-configuration.d.ts`の`mainModule`が`src/index.ts`を指す            | 一致。`exports.ClientGateway`も型が付く                                                            |

### 既存の資産

- `apps/api/src`は`index.ts`(Workerの組み立て)と`composition`(環境の検証スキーマ・`MODULES`・IP制限の除外・定期実行の定義)だけで、`domain`・`application`・`infrastructure`・`presentation`は空である。GraphQL関連の依存と`@hono/zod-openapi`は未導入である。
- テストは`src/index.worker.test.ts`、`test/config`(Wrangler設定・層の規則・cronの一致)、`test/smoke`(DIのバンドルの確認)がある。
- ルートの一括検査(`CHECK_STEPS`)は、共有ディレクトリの配置確認→テスト命名→整形→静的解析→型生成の検査(`cf-typegen:check`)→型検査の順である。
- `docs/GUIDES/tech`の`backend`は001〜003、`coding`は001〜003で、本specの`backend/004`〜`006`・`coding/004`は空いている。後続spec(admin-foundationなど)は`backend/007`以降を使う設計で、番号は衝突しない。
- tech-stack.mdには、GraphQL Yoga・GraphQL Armor・DataLoader・persisted operations・introspectionの無効化・`@hono/zod-openapi`・GraphQL Code Generator(client-preset)・GraphiQLが載っている。`@graphql-codegen/typescript`・`@graphql-codegen/typescript-resolvers`は未記載で、設計どおり追記が要る。
- 生成コードの命名(`**/generated/**`)は、Bunのカバレッジ・Vitestのカバレッジの除外(`GENERATED_CODE_PATTERNS`)に既に入っている。
- 後続spec(frontend-platform)の設計は、`ClientGateway`・`AdminGateway`、中継のヘッダー、`apps/{client,admin}/src/graphql/generated/persisted-documents.json`、スキーマファイルの場所を本specと同じ値で参照している。

### 要件と資産の対応

| 要件                    | 必要な技術要素                                               | 使える既存の資産                                                               | ギャップ                   |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------- |
| 1 受付経路と内部認証    | 名前付きエントリポイント、ヘッダーの除去、内部経路だけの経路 | `createWorkerHandler`・`AppModule`・`handleNotFound`                           | Missing、Constraint(G7)    |
| 2 クライアントIP        | 内部経路のIPの解決、欠落・不正の警告                         | `resolveClientIp`の差し込み口、`ip:unknown`                                    | Missing                    |
| 3 セッション            | 検証のポート、`SessionAccess`、Cookieの指示のヘッダー        | 処理単位のコンテナ                                                             | Missing                    |
| 4 上限                  | GraphQL Armor、拒否の種類の分類                              | —                                                                              | Missing、Constraint(G5)    |
| 5 許可リスト            | persisted operations、生成コマンド、Gitの履歴の読み出し      | —                                                                              | Missing、Constraint(G4)    |
| 6 introspection         | 無効化、GraphiQLの経路                                       | `SENTRY_ENVIRONMENT`(値は同じだが用途が違う、G10)                              | Missing                    |
| 7 エラー応答            | エラーコードの付与とマスキング、429・503                     | `AppError`・`STATUS_BY_KIND`・Sentryの`shouldHandleError`                      | Missing                    |
| 8 スキーマモジュール    | 合成と重複検査、DataLoader、引数の検証、ページング、bot判定  | `PLATFORM_TYPES.Database`・`Clock`・`BotVerifier`                              | Missing、Unknown(G6)       |
| 9 スキーマの出力        | 印字、リゾルバの型の生成、検査                               | 生成コードの命名の契約                                                         | Missing、Constraint(G4)    |
| 10・11 公開REST・CORS   | `OpenAPIHono`、経路表、CORSの後処理                          | `notFound`・`onError`、IP制限の429                                             | Missing                    |
| 12 セキュリティヘッダー | 共有コードの部品、apiとeventへの適用                         | —                                                                              | Missing                    |
| 13 観測                 | 操作ログ、トレースへの操作名、初回の要求での組み立て         | アクセスログ(`invocationContext`)、Sentryのhonoの計装                          | Missing、Constraint(G1)    |
| 14 テストと文書         | Workers統合テスト、カバレッジ、技術ドキュメント              | `workerTestPreset`、`coverage.include`、層の規則のテスト、Wrangler設定のテスト | Constraint(G2・G3・G8・G9) |

### 新たに見つかったギャップと制約

- **G1 トレースのスパン名が上書きされる(Constraint、13.2、設計の記述に影響)**: `@sentry/hono`の中間処理(`@sentry/server-utils`の`responseHandler`)は、応答の時点でルートのスパンの名前を`<メソッド> <経路>`(`POST /graphql`)へ更新し、`http.route`属性とトランザクション名も設定する。Sentryの中間処理は`createWorkerApp`の最初の`app.use`で最も外側にあるため、OperationObservabilityがGraphQLの処理中に「現在のスパンの名前を`graphql <種類> <操作名>`に更新」しても、応答の時点で戻される。13.2の受け入れ基準は「パフォーマンストレースに操作名と呼び出し元を付ける」で、名前の更新に限らない。代替は次のとおりである。
  1. ルートのスパンに属性(`graphql.operation.name`・`graphql.operation.type`・`graphql.caller`)を付ける。名前は`POST /graphql`のまま
  2. GraphQLの実行を子のスパン(`startSpan`)で包み、子のスパンの名前に操作名を入れる
  3. 1と2を併用する
- **G2 ESLintの規則が重なると前の規則が消える(Constraint、設計の「Dependency Direction」)**: flat configでは、同じファイルに当たる複数の設定が同じ規則(`no-restricted-imports`)を指定すると、後の設定のオプションが前の設定を置き換える(結合しない)。apiの`eslint.config.ts`へ`presentation/graphql`の一部のファイル向けに`cloudflare:*`・`@sentry/*`・`infrastructure`の禁止を加えると、そのファイルでは`createBackendLayerRules`の「プレゼンテーション層は合成ルートに依存できない」が無効になる。追加の規則に合成ルートの禁止を含め直すか、`createBackendLayerRules`に追加のパターンを渡す口を作る(後者は共有の`config/eslint`の変更)。`test/config/layer-rules.unit.test.ts`に違反例を加えて確かめられる。
- **G3 既存のテストの期待値の更新(Constraint、設計の「Modified Files」に無い)**: `test/config/wrangler-config.unit.test.ts`の「apiの変数はシークレットを含まず、環境ごとの値を持つ」は`api.vars`を`toStrictEqual`で比べるため、`APP_ENVIRONMENT`を加えると期待値の更新が要る。`worker-configuration.d.ts`の再生成を忘れると、一括検査の`cf-typegen:check`(backend-platformの改訂8)が失敗する(再生成は設計に記載済み)。G2の規則を加える場合は`layer-rules.unit.test.ts`も更新対象になる。
- **G4 生成物の検査を一括検査に含めるか(Constraint、要件9.3・9.4)**: 設計は`graphql:check`をCI(infra-delivery)から呼ぶ前提で、ルートの一括検査には加えていない。backend-platformの改訂8は、設定と生成済みの型の食い違いを一括検査の`cf-typegen:check`で検出する前例を作った。`graphql:check`も一括検査の段階に加える(dev-toolingの`scripts/tooling/run-all.ts`の変更、`graphql:check`を持たないアプリは「スクリプト未定義」で飛ばされる)か、CIだけに任せるかを決める必要がある。
- **G5 依存の版(Constraint)**: 2026-10-26時点のnpmレジストリで確かめた。
  - `graphql-yoga` 6.0.1(2026-10-23)が出て、`@envelop/core` ^6に依存する。GraphQL Armor 3.2.0(2025-12-29から更新なし)は相手依存が`@envelop/core` ^5のため、Yoga 6とは組み合わせられない見込みである。設計のYoga 5系の固定は引き続き必要だが、Yoga 5系の保守が先に終わるリスクが増した。
  - Yoga 5系は`graphql-yoga` 5.24.6・`@graphql-yoga/plugin-persisted-operations` 3.24.6・`@graphql-yoga/plugin-disable-introspection` 2.25.6(いずれも2026-10-15)が最新である。プラグインの3.24.6・2.25.6は相手依存が`graphql-yoga` ^5.24.6のため、パッチを上げるなら3つを同時に上げる。設計の版(5.24.1・3.24.1・2.25.1)は一組として整合している。
  - `@graphql-codegen/cli` 7.4.6・`@graphql-codegen/typescript` 6.1.2・`@graphql-codegen/typescript-resolvers` 6.1.1が出ている(設計は7.4.3・6.1.0・6.1.0)。cliはclient・adminと版をそろえる契約で、client・adminは未実装である。
  - `graphql`の16系は16.14.2が最新のまま(17.0.2は2026-07に公開)。`dataloader` 2.2.3・`@hono/zod-openapi` 1.6.3も最新のままである。
- **G6 Node.js互換なしでの動作(Unknown、8.3)**: Wrangler設定のテストは「互換性フラグ(Node.js互換を含む)を指定しない」を強制する。DataLoader 2.2.3は一括読み込みの起動を`process.nextTick`→`setImmediate`→`setTimeout`の順で予約するため、Node.js互換の無いworkerdでは`setTimeout`で起動する可能性がある。設計時の事前検証は、互換性フラグの有無と、DataLoaderが1回にまとまることを記録していない。8.3のWorkers統合テスト(3件の読み込みが1回の一括読み込みになる)で確かめ、Yoga・Armor・`@hono/zod-openapi`も互換性フラグなしで動くことをタスク1.1の段階で確かめる。
- **G7 外部経路の404の本文(Constraint、1.2)**: 「経路の存在を明かさない」ためには、GraphqlModule・InternalOnlyが返す404の本文を、backend-platformの`handleNotFound`(`NOT_FOUND_RESPONSE`の`not_found`と定型の文言)と完全に同じにする必要がある。`AppError(not_found)`の文言が異なると、未登録の経路との違いから存在を推測できる。Workers統合テストで本文の一致を確かめる。
- **G8 スモークテストの範囲(Info、設計のTesting Strategy)**: `bun run test:smoke`は`test/smoke/wrangler-bundle-entry.ts`(DIの確認用の専用の入口)だけをバンドルし、`src/index.ts`を対象にしない。設計の「名前付きエントリポイントを加えた後も成功すること」は本specの変更と無関係に成功し、Yogaを含む実際のバンドルの大きさとグローバルスコープの処理時間は確かめられない。実際の入口は、タスク10.1の`wrangler dev`の起動と、デプロイしない`wrangler deploy --dry-run`の出力で確かめる必要がある。
- **G9 テストでの環境の差し替え(Info、14.2)**: `exports.ClientGateway`はWrangler設定のルートの`vars`(ローカル環境)で動くため、内部経路でstaging・prodの振る舞い(4.8・6.1・6.2)を確かめるには、テスト補助が差し替えた`env`で`handler.fetch`を呼ぶ(エントリポイントと同じ付与の関数を通す)か、エントリポイントのクラスをテストで直接生成する必要がある。設計は「環境・呼び出し元を指定してエントリを呼ぶ」とだけ定める。
- **G10 環境の種別の変数の重複(Info)**: `SENTRY_ENVIRONMENT`が既に`local`・`staging`・`prod`を持つ。`APP_ENVIRONMENT`は値が重なるが、frontend-platform・admin-foundation・launch-readiness(C-08で両方を確認)の設計が`APP_ENVIRONMENT`を前提にするため、設計どおり別の変数として加える方が後続への影響が小さい。
- **G11 bot判定のトークンのヘッダー名の重複(Info)**: backend-platformの`TURNSTILE_RESPONSE_HEADER`(`CF-Turnstile-Response`)と、設計の`GATEWAY_HEADERS.botToken`(`cf-turnstile-response`)は同じヘッダーである。`gateway-headers.ts`は生成コマンドがBunで読み込むため共有コードの`workers`を読み込まない方針で、値は重複して持つことになる。単体テストで大文字小文字を除いた一致を確かめる。

### 実装の進め方の選択肢

- **案A: 設計どおりに実装し、ギャップはタスクの中で吸収する**
  - G1は13.2の受け入れ基準を属性で満たし、設計の1行の記述との差をtasks.mdの実装メモに残す。G2・G3・G6〜G11は各タスクのテストと実装で対応する。版は設計の値のまま固定する。
  - ✅ 承認済みの設計・タスクを変えずにすぐ着手できる
  - ❌ 設計の記述(トレースの方式・変更ファイル・版)と実装が食い違ったまま残り、後続specが設計を読み違えるおそれがある
- **案B: 実装の前に、全ギャップを承認後の改訂(改訂2)として設計・タスクへ反映する**
  - G1のトレースの方式、G2のlint規則の結合、G3の変更ファイル、G4の一括検査、G5の版、G7の404の本文、G8のバンドルの確認方法を、設計とタスクに反映してから着手する。
  - ✅ 設計と実装が一致し、後続specの参照先が正しく保たれる
  - ❌ 改訂の範囲が広く、タスクのレビューをやり直す手間がかかる
- **案C: 後続specとの契約に関わるものだけ改訂し、残りは実装で吸収する(折衷)**
  - 改訂の対象: G1(トレースの付け方。launch-readinessなどが観測の方法として参照する)、G5(版。tech-stack.mdと`coding/002`の版の一覧に載る)、G4(一括検査に加える場合はdev-toolingの契約に影響する)。
  - 実装で吸収: G2・G3・G6〜G11。完了時にtasks.mdの実装メモへ記録する。
  - ✅ 契約の食い違いを防ぎつつ、改訂を最小にできる
  - ❌ どれを改訂の対象にするかの線引きを、開発者が判断する必要がある

### 工数とリスク

- **工数: L(1〜2週間)**。タスクは10群・38件で、GraphQLの実行基盤・生成コマンド・公開RESTの骨格・技術ドキュメント4本を含む。主要な組み合わせは設計時のscratchpadで動作を確かめ済みである。
- **リスク: Medium**。上流の契約は設計どおりに実装されていて、主要なライブラリの組み合わせも事前に検証済みである。一方で、G1(Sentryの計装との干渉)とG5(Yoga 6の公開とArmorの更新停滞)が新たに見つかり、G6(Node.js互換なしでの動作)は未確認である。

### 実装に向けた推奨

- **推奨: 案C**。G1とG5は後続specとtech-stack.mdが参照する内容に関わるため、着手前に改訂として確定する。G4は開発者の判断で一括検査に加えるかを決める。
- **着手前に開発者が決める事項**:
  - G1: トレースへの操作名の付け方(属性・子のスパン・両方)
  - G5: Yoga 5系・codegenの版を設計の値のままにするか、最新のパッチ(5.24.6・3.24.6・2.25.6、cli 7.4.6・typescript 6.1.2・typescript-resolvers 6.1.1)へ上げるか
  - G4: `graphql:check`をルートの一括検査に加えるか、CIだけに任せるか
- **Research Needed**(実装の中で確かめる):
  - G1: Sentry 11.4.0の逐次送信のスパンで、ルートのスパンの属性と子のスパンの名前が`scrubSpan`を通った後もそのまま届くこと
  - G5: Yoga 5系の保守の方針(セキュリティ修正の提供期間)と、GraphQL Armorの`@envelop/core` 6への対応の予定
  - G6: Node.js互換なしのworkerdで、DataLoaderの一括読み込み、Yoga・Armor・`@hono/zod-openapi`が動くこと
  - G8: `wrangler deploy --dry-run`の出力で、Yogaを含むバンドルの大きさを確かめられること

## 実装前のギャップ分析による承認後の改訂(改訂2、2026-10-26)

- **状態**: 上の「実装前のギャップ分析」を受けた改訂で、2026-10-26に開発者が確定した。要件(受け入れ基準)は変えず、設計・タスク・本書だけを変えた。そのため`requirements.md`の「承認後の改訂」の表には加えていない(backend-platformの承認後の改訂4〜8と同じ扱い)。要件・設計・タスクの承認を保った。
- **開発者の決定**:
  - G5(依存の版): 「全て最新のパッチに上げる」。
  - G1(トレース): 推奨案の「両方」。ルートのスパンに属性を付け、GraphQLの実行を子のスパンで覆う。
  - G4(一括検査): 推奨案の「一括検査に加える」。
  - 相違点1(設計の「Modified Files」の漏れ): 推奨案の「設計とタスクに追記」。
  - 相違点2(スモークテストの検証項目): 推奨案の「dry-runの確認に置き換え」。
  - 相違点3(OperationObservabilityのスパンの名前の記述): G1の決定に合わせて直す。
- **改訂の内容**:
  - G5: `graphql-yoga` 5.24.6・`@graphql-yoga/plugin-persisted-operations` 3.24.6・`@graphql-yoga/plugin-disable-introspection` 2.25.6・`@graphql-codegen/cli` 7.4.6・`@graphql-codegen/typescript` 6.1.2・`@graphql-codegen/typescript-resolvers` 6.1.1。`graphql` 16.14.2・GraphQL Armor 3.2.0・`dataloader` 2.2.3・`@hono/zod-openapi` 1.6.3は最新のままで変えない。Yoga 6系はGraphQL Armorの依存(`@envelop/core` ^5)と合わないため、5系の最新のパッチに留める。要件フェーズのQ1の表の版(7.4.3・6.1.0・6.1.0)は決定時点の記録として残す。
  - G1: OperationObservabilityは、ルートのスパンの名前を変えず、属性`graphql.operation.name`・`graphql.operation.type`・`graphql.caller`を付ける。GraphQLの実行の段階を子のスパン`graphql <種類> <操作名>`(`op`は`graphql.execute`)で覆い、実行前に拒否した操作では子のスパンを作らない。テストは、差し替えたトランスポートで`scrubSpan`の後の値を確かめる。
  - G4: dev-toolingの一括検査の`CHECK_STEPS`で、`cf-typegen:check`と`typecheck`の間に、アプリだけを対象とする段階「GraphQLの生成物の検査」(`graphql:check`)を加える。生成し直し忘れたリゾルバの型が型検査のエラーとして現れる前に、原因を表示するためである。
  - 相違点1とG2: 設計の「Modified Files」に、`test/config/wrangler-config.unit.test.ts`(`APP_ENVIRONMENT`の期待値)、`test/config/layer-rules.unit.test.ts`(違反例)、一括検査の`run-all.ts`とその単体テスト・補助、`coding/001`を加えた。「Dependency Direction」に、追加のimport制限へ合成ルートの禁止を含め直す規則を加えた。
  - 相違点2: 設計のTesting Strategyの`test:smoke`の項目を、`wrangler deploy --dry-run`による実際の入口のバンドルの確認に置き換えた。スモークテストは回帰の確認としてだけ残す。
- **変えた箇所**:
  - design.md: Overview(Impact)、Boundary Commitments(This Spec Owns・Allowed Dependencies・Revalidation Triggers)、Dependency Direction、Technology Stack、Modified Files、Requirements Traceabilityの9.3・13.2、OperationObservability、GraphQLScriptsの`graphql:check`、Monitoring、Testing Strategy。
  - tasks.md: 1.2(G2)、5.4(G1)、6.4(G4)、8.1(スモークテストの完了状態)、9.1(トレースと一括検査の記載)、10.1(dry-run)、10.2(一括検査の段階・スモークテストの位置付け)。タスクの番号・依存・要件の対応は変えていない。1.1の`wrangler-config.unit.test.ts`の更新は、改訂の前からタスクに含まれていた。
  - 水平展開: frontend-platformのdesign.mdの`@graphql-codegen/cli`を7.4.6に(api・client・adminで版をそろえる契約)、identity-authのdesign.mdの`graphql-yoga`を5.24.6に(上流の版)合わせた。それぞれのresearch.mdに経緯を記録した。
- **未解決のまま実装で確かめる事項**: ギャップ分析のResearch NeededのうちG5のYoga 5系の保守の方針、G6のNode.js互換なしでの動作は、改訂の対象ではなく、タスク1.1・4.2・5.4・10.1の中で確かめる。
