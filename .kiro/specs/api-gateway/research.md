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
| Q1  | GraphQLのスキーマの定義方式と導入するパッケージ           | briefのApproach・CLAUDE.md(新規パッケージ)・NFR-PERF-004・NFR-MAINT-004 | 推奨案。スキーマファーストと型生成を採用し、`@graphql-codegen/cli` 7.4.3・`@graphql-codegen/typescript` 6.1.0・`@graphql-codegen/typescript-resolvers` 6.1.0を導入する。`graphql`は16.14.2に固定する         |
| Q2  | 利用者側と管理者側で実行できるGraphQL操作の範囲を分けるか | SW-001・COM-004・NFR-SECUR-008・NFR-SECUR-019・admin-foundationのbrief  | 推奨案。スキーマは1つとし、許可リストを呼び出し元別にする                                                                                                                                                    |
| Q3  | デプロイ後、現行版から消えた操作をいつまで受け付けるか    | NFR-SECUR-019・NFR-AVAIL-004・NFR-AVAIL-005・brief                      | 推奨案ではなく「直前のリリース分まで受け付ける」を採用。現行版と直前の版の操作を合わせて受け付け、それより古い操作は自動で外れる。デプロイ履歴の保持方法は設計で決め、新しいリソースが必要なら追加で確認する |
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
- セッションの分担: identity-authのbriefがセッションの発行・失効・保存(NFR-SECUR-002・028〜030)を受け持つ。本specは、識別子の受け渡しの契約と検証のポートだけを持ち、identity-authの実装が入るまでは常に未ログインとして扱う。
- persisted documentsの保管場所: KVなどの新しいリソースを使わず、APIのバンドルに含める前提で設計する。新しい操作を含むフロントエンドを出すときにAPIを先にデプロイする順序を、infra-deliveryとの契約にする。
- ページングと共通スカラー: 要件定義書がカーソル型(FR-FOLOW-006・FR-COMNT-004)とオフセット型(FR-DIR-008)の両方を求めるため、両方の共通の型と日時のスカラーを規約に含める。
- サブスクリプションとGraphQLのマルチパートアップロード: リアルタイム配信の要件が無く、アップロードはSW-009のストリーミング中継(media-pipeline)で行うため、範囲外として無効にする。
- SW-009・SW-011の中継先となる内部REST: 本specは内部経路だけで受け付ける経路の追加規約を提供し、経路自体はmedia-pipelineが追加する。
- introspectionとGraphiQLを無効にする環境: NFR-SECUR-018の「デプロイ先環境」とtech-stack.mdから、stagingとprodの両方で無効にする。
- `graphql`の版: GraphQL Armor 3.2.0(最終リリース2025-12-29)が`graphql` ^16.10を直接依存に持つため、二重読み込みを避けて16.14.2に固定する。`@hono/zod-openapi` 1.6.3の相手依存(zod ^4・hono >=4.10)は、上流で固定した版と合う。
- 上流の契約とのずれ: backend-platformの`ClientIpResolver`は`Request`だけを受け取り、ミドルウェアの順序は`createWorkerApp`だけが定める。中継の判定はエントリでの印付けで、IP制限の429へのCORSヘッダーの付与はエントリでの応答の後処理で、上流の契約を変えずに実現する。
- GraphQLでのレート制限の応答: FR-RLMIT-001〜005の対象はGraphQLのミューテーションで提供されるため、レート制限の超過はGraphQLの応答でも429と`Retry-After`を返す。
- RESTのエラー形式とバリデーションエラーの状態コード: CLAUDE.mdに従い`ecc:api-design`(400・422の使い分け)とbackend-platformの共通のエラー形式に従う。
- Armorのその他の保護: トークン数1000・ディレクティブ数50・フィールド候補の非表示を既定のまま有効にする。
- briefの要件IDの誤記: 「GraphQLのクライアント観測p95は300ms以内(NFR-PERF-002)」はNFR-PERF-003の誤りである。計測と検証はfrontend-platform・launch-readinessが行う。
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

- **Context**: 要件3・NFR-PERF-003。
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
