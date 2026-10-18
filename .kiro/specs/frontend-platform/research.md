# Research & Design Decisions

## Summary

- **Feature**: `frontend-platform`
- **Discovery Scope**: New Feature(`apps/client`・`apps/admin`・`apps/frontend-lib`は空のディレクトリで、上流のdev-tooling・backend-platform・api-gatewayは設計まで承認済み・実装前である)
- **Key Findings**:
  - `@cloudflare/vite-plugin`は版ごとに`wrangler`を完全固定で依存に持ち、相手依存も同じ版以上を求める。1.53.0(2026-08-18)が、本プロジェクトの`wrangler` 4.124.0(`@cloudflare/vitest-pool-workers` 0.22.0と同じ版)を持つ最後の版である。これより新しい版はWranglerの実体を2つにする。
  - 検査担当が自分自身の共有ディレクトリ(`apps/frontend-lib`)の`tsconfig.json`が相対パスの`extends`を持つと、配置先(`apps/client/lib`)では`extends`の先が見つからず、Viteのビルドが失敗し、開発サーバーの依存の事前解析も失敗する。`extends`を持たない自己完結の`tsconfig.json`なら両方とも成功した。
  - TanStack Start 1.168.60の独自のサーバーのエントリから`handler.fetch(request, { context })`で渡した値は、`getGlobalStartContext()`でルーターの生成時に読める。ルーターの`ssr.nonce`に渡すと、インラインのスクリプト(`head`の`scripts`を含む)・モジュールのスクリプト・`modulepreload`のすべてにnonceが付いた。
  - `createCsrfMiddleware()`を`src/start.ts`に絞り込み無しで登録すると、ページの`GET`も検証され、ヘッダーの無い要求が403になる。メソッドとサーバー関数の呼び出しで絞り込む必要がある。
  - `vite dev`・`vite preview`のどちらからも、別のプロセスの`wrangler dev`で動くAPIの名前付きエントリポイント(`entrypoint: "ClientGateway"`)へService Bindingsで到達できた。Rate Limitingバインディングもローカルで動作し(101回目から429)、`request.cf.timezone`もローカルで得られた。
  - Sentry 11.4.0のサーバー側は、`@sentry/cloudflare`の`withSentry`と`@sentry/tanstackstart-react`の`captureException`の組み合わせでworkerd上で動作した。ただし既定のスパンの逐次送信では、`sendDefaultPii: false`でも`http.server`のスパンの属性に要求ヘッダー(Cookie・`CF-Connecting-IP`)・`user.ip_address`・URLのクエリが入り、`dataCollection`でも消えなかった。`beforeSendSpan`で属性を除けば消えた。`beforeSendTransaction`は逐次送信では呼ばれない。

## 要件フェーズ前の確認事項(2026-10-18)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                                                               | 根拠                                                                                                              | 回答(2026-10-18)                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | 日時・数値を、SSR時点とJavaScript読み込み後でどう表示するか        | I18N-004・NFR-PERF-001・`design/001-design-principles.md`「日時・数値の表示」・`mockups/src/lib/date-format.ts`   | 推奨案。SSRでは接続元から推定したタイムゾーン(`request.cf.timezone`)と`Accept-Language`で整形し、読み込み後にブラウザの設定と異なる場合だけ置き換える                                                                                                                                                                                |
| Q2  | ダークモードとアニメーション演出の切り替えを設けるか、どこに置くか | UI-003(WCAG 2.2の達成基準2.2.2)・`design/002-page-layouts.md`「共通レイアウト」・`mockups/src/lib/preferences.ts` | 推奨案ではなく「ダークモードだけ切り替え可能」を採用。切替はヘッダーのボタン(管理者側も同じ)、ブラウザに保存、初期値はOS設定。共通ヘッダーの項目一覧に追記する。アニメーションはOSの設定に従うだけで切替UIを作らない。2.2.2の停止手段は演出を持つspecが用意し、その義務を下流specへの契約・Revalidation Triggersとして設計に明記する |
| Q3  | 疎通確認の画面をどの環境で公開するか                               | brief・api-gatewayの`systemStatus`・NFR-AVAIL-003・backend-platformのQ6                                           | 推奨案。ローカル環境とstagingだけで公開し、prodでは404にする                                                                                                                                                                                                                                                                         |
| Q4  | Cloudflare Web Analyticsを管理者側にも入れるか                     | SW-006・NFR-OBLOG-001・NFR-PERF-001・`legal/001-compliance-policy.md`                                             | 推奨案。利用者側だけに入れる                                                                                                                                                                                                                                                                                                         |
| Q5  | UI部品と採用済み技術に付随する新規パッケージの構成                 | CLAUDE.md(新規パッケージ)・tech-stack.md・`mockups/package.json`                                                  | 推奨案。モックアップと同じ構成(`radix-ui` 1.6.7・`class-variance-authority` 0.7.1・`clsx` 2.1.1・`tailwind-merge` 3.7.0・`tw-animate-css` 1.4.0・`lucide-react` 1.51.0・`sonner` 2.0.8・`@tailwindcss/vite` 4.3.3・`@vitejs/plugin-react` 6.1.1・`@hookform/resolvers` 5.9.1・`@graphql-typed-document-node/core` 3.2.0)             |
| Q6  | Turnstileのウィジェット部品に何を使うか                            | SW-018・NFR-SECUR-009・CLAUDE.md                                                                                  | 推奨案。`@marsidev/react-turnstile` 1.6.1                                                                                                                                                                                                                                                                                            |
| Q7  | React向けの静的解析とPrettierのプラグイン                          | NFR-MAINT-002・dev-toolingの設計・CLAUDE.md                                                                       | 推奨案。`@eslint-react/eslint-plugin` 5.23.5・`eslint-plugin-react-hooks` 7.1.1・`@tanstack/eslint-plugin-query` 5.104.1・`@tanstack/eslint-plugin-router` 1.162.0・`eslint-plugin-storybook` 10.6.1・`eslint-plugin-jsx-a11y-x` 0.2.0・`prettier-plugin-tailwindcss` 0.8.1                                                          |
| Q8  | アクセシビリティの自動検査をどこで行うか                           | UI-003・`ecc:react-testing`・CLAUDE.md                                                                            | 推奨案。共通部品のブラウザテストで`axe-core` 4.13.0を実行して違反0件を確かめ、Storybookに`@storybook/addon-a11y` 10.6.1を入れる                                                                                                                                                                                                      |

- 採用したパッケージのtech-stack.mdへの追記は、spec段階では行わず、導入する実装タスクの中で行う(開発者の指示)。
- Q7の`@eslint-react/eslint-plugin`は、確認時に提示した5.23.5のとおりとする(5.24.0は公開から2週間に満たない時点の確認だったため、2週間以上前の5.23.5を提示した)。

### 提示した選択肢(記録)

- Q1: 接続元からの推定で整形(採用) / UTCで出して後で置換 / 読み込み後にだけ表示 / Cookieに保存して再利用
- Q2: ヘッダーと演出の近くに置く / ヘッダーとフッターに置く / ダークモードだけ切り替え可能(採用) / 切替UIを設けない
- Q3: ローカルとstagingのみ(採用) / 全環境で公開 / ローカルのみ
- Q4: 利用者側のみ(採用) / 両方に入れる
- Q5: モックアップと同じ構成(採用) / 土台をBase UI(`@base-ui/react` 1.8.0)にする / アイコンとトーストを自作
- Q6: `@marsidev/react-turnstile` 1.6.1(採用) / `react-turnstile` 1.1.5 / 自作
- Q7: フォークも含めて導入(採用) / アクセシビリティの静的解析を除く / 最小限
- Q8: ブラウザテストとStorybookで検査(採用) / ブラウザテストのみ / E2Eでも検査(`@axe-core/playwright` 4.13.0) / 自動検査を入れない

### 確認済みのため質問しない事項

- roadmapの「Requirement Ambiguities」: 本specが担当する行は無い。FR-RLMIT-008のclient・adminへの適用はbackend-platformのQ2で決定済みで、規約(バインディング`IP_RATE_LIMITER`・10秒あたり100回・キー`ip:<CF-Connecting-IP>`・`namespace_id`はclientが`1003`・`2003`・`3003`、adminが`1004`・`2004`・`3004`)をそのまま使う。超過時の画面は文言規則の「レート制限(429)」で、ページの要求にはHTML、それ以外には共通のエラー形式で返す。
- 静的なファイルの扱い(FR-RLMIT-008・NFR-SECUR-010): Workers Static Assetsが配信するファイルはWorkerを起動しないため数えない(backend-platformで画像のエッジキャッシュを対象外にしたのと同じ扱い)。セキュリティヘッダーは`_headers`で付ける。
- briefの実現性チェックの2点: 設計で解消する。CSRFのミドルウェアは`src/start.ts`で絞り込みを付けて明示的に登録し、`CLOUDFLARE_ENV`はビルド時に指定する。別プロセスのAPIの名前付きエントリポイントへの接続は、scratchpadで`vite dev`・`vite preview`の両方で確かめた(Research Log)。
- CSRFの検証の範囲(NFR-SECUR-003): 要件は「認証を要する状態変更リクエスト」だが、中継する操作が認証を要するかをフロントエンドサーバーは判別できないため、`GET`・`HEAD`・`OPTIONS`以外の全要求と、メソッドを問わないサーバー関数の呼び出しに適用する。正規の利用でサイト外から状態変更が届く経路は無い(Stripeの戻りは`GET`、RFC 8058の配信停止はイベントサーバー)。要件の文言より範囲を広げる判断のため、完了報告の「開発者の確認が必要な判断」に含める(開発者の指示)。`Referer`による代わりの判定は行わない(要件の手順に無いため。TanStackの既定は有効)。
- `no-store`の範囲(NFR-SECUR-011): 要求ごとのnonce(NFR-SECUR-009)を含むHTMLはキャッシュできないため、Workerが返す応答はログイン状態を問わず`no-store`にする。ハッシュ付きの静的なファイルは長期キャッシュにする。
- CSPの範囲(NFR-SECUR-009): nonceはスクリプトに適用し、サードパーティのドメインを個別に列挙する(`strict-dynamic`は使わない)。スタイルはReactのSSRが出す`style`属性やトーストの部品が実行時に挿入するスタイルのため、インラインを許可する(要件の目的は「スクリプト実行元の制限」)。
- api-gatewayとの衝突: 無い。エントリポイント名・中継の項目・指示の項目・`documentId`による要求・操作の一覧の出力先・スキーマファイルを契約どおりに使う。ローカルでも許可リストが適用されるため、操作の追加後に`graphql:allowlist`を再実行する手順をオンボーディングに書く。
- セッションのCookie: localhostではCookieがポートで分かれないため、client・adminで名前を分ける(同名だと、管理者側が利用者のCookieを管理者のセッションとして検証させて無効と判定され、削除の指示で利用者のCookieを消す)。
- 送信ボタンの活性制御(UI-004): 要件の文言とモックアップのとおり、入力が有効になるまで無効にし、エラーはフォーカスが外れた時に表示する。
- 文言: 404・取得エラー・429・Turnstile失敗は`003-text-and-copy-rules.md`にある。
- Cookieの同意バナー: 準拠方針(`legal/001-compliance-policy.md`)で不要と決定済み。表示設定の保存はlocalStorageで、Cookieを増やさない。
- Sentry: 利用者側・管理者側の両方。トレースの割合はbackend-platformと同じ(prod 0.1・staging 1・ローカルは送信先なしで無効)。Session Replayは使わない(DR-001)。NFR-PERF-003の「クライアント観測」はブラウザから送ったGraphQLの要求だけを対象にする。
- フォント: モックアップはシステムフォントだけを使う。
- フッターとヘッダーの分担: URL構造の固定パスへのリンクは本specが置き、ピン留めヘルプ記事はhelp-center、ログイン中の表示はidentity-auth、トップページの中身はmatch-engineが差し込む。
- Storybook: ローカルでの閲覧に限る(roadmap・infra-deliveryに配信先が無い)。
- staging・管理者側の検索除外、devtools・MSWを入れないこと、admin-foundationの実装前は管理者側にログインが無い(業務データを持たず、prodへの公開は全spec完了後の一括リリース)こと。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する。

## Research Log

### Cloudflare Vite pluginとWranglerの版

- **Context**: tech-stack.mdの`@cloudflare/vite-plugin`。dev-toolingは`wrangler`を4.124.0に固定している(`@cloudflare/vitest-pool-workers` 0.22.0が完全固定で依存する版)。
- **Sources Consulted**: npmの`@cloudflare/vite-plugin`の全版の`dependencies.wrangler`と`peerDependencies.wrangler`(1.40.0〜1.64.0)。
- **Findings**:
  - 各版は`wrangler`を完全固定の`dependencies`に持ち、`peerDependencies`で同じ版以上を求める(例: 1.62.5は`wrangler` 4.147.0・`^4.147.0`)。
  - 1.53.0(2026-08-18)が`wrangler` 4.124.0を持つ。`vite`は`^6.1.0 || ^7.0.0 || ^8.0.0`に対応する。
  - `@cloudflare/vitest-pool-workers`の最新の0.23.0(2026-10-07)も`wrangler` 4.124.0のままである。
- **Implications**: client・adminは`@cloudflare/vite-plugin` 1.53.0と`wrangler` 4.124.0を導入する。Wranglerの実体をリポジトリ全体で1つの版にそろえ、ローカルの開発用の登録簿(別プロセス間のService Bindings)も同じ版で動かす。版の更新は、`@cloudflare/vitest-pool-workers`・`wrangler`・`@cloudflare/vite-plugin`を同じ版の組へ一括で行う規則を`coding/002`に追記する。

### TanStack Start 1.168.60のサーバーのエントリ・nonce・CSRF

- **Context**: 要件1・3・4。briefの実現性チェック(`src/start.ts`を定義するとCSRFのミドルウェアが自動で入らない)。
- **Sources Consulted**: `@tanstack/start-server-core` 1.169.39の`createStartHandler.js`、`@tanstack/start-client-core`の`createCsrfMiddleware.js`・`getGlobalStartContext.js`、`@tanstack/router-core`の`ssr/hydrationScripts.js`・`load-client.js`。scratchpadの最小構成(TanStack Start 1.168.60・React 19.3.0・Vite 8.3.2・`@vitejs/plugin-react` 6.1.1・`@cloudflare/vite-plugin` 1.53.0・`wrangler` 4.124.0)。
- **Findings**:
  - `src/start.ts`が無いと、サーバー関数の要求にだけ既定のCSRFミドルウェア(`filter: handlerType === 'serverFn'`)が入る。`createStart`を定義すると、`requestMiddleware`に挙げたものだけが動く。
  - `createCsrfMiddleware`は、`Sec-Fetch-Site`があればその値(既定`same-origin`)、無ければ`Origin`と要求のオリジン、どちらも無ければ`Referer`(既定で有効、`referer: false`で無効)で判定し、すべて無ければ拒否する。`filter`を付けないとページの`GET`も検証し、ヘッダーの無い要求を403にした。`filter`で「サーバー関数の呼び出し、またはGET・HEAD・OPTIONS以外」に絞ると、ページは200、`Sec-Fetch-Site: cross-site`・異なる`Origin`・ヘッダー無しのPOSTは403、同一オリジンのPOSTは通過した。
  - `@tanstack/react-start/server-entry`の`createServerEntry`で独自のエントリを作り、`handler.fetch(request, { context: { nonce } })`と渡すと、`getRouter`の中の`getGlobalStartContext()`で値を読めた。`createRouter({ ssr: { nonce } })`により、`head`の`scripts`のインラインのスクリプト・ハイドレーションのスクリプト・モジュールのスクリプト・`modulepreload`の7箇所すべてに同じnonceが付き、`<meta property="csp-nonce">`が出力された。ブラウザ側は`load-client.js`がこの`meta`からnonceを読む。
  - `script-src 'self' 'nonce-…'`のCSPの下で、`vite preview`・`vite dev`の両方でハイドレーションと画面の操作が動き、CSPの違反は出なかった(開発サーバーのHMRの接続も`connect-src 'self'`で通った)。
  - サーバー専用のimport(`cloudflare:workers`・`@tanstack/react-start/server`)をクライアントからも読み込まれるファイルに置くと、TanStackのimport保護がビルドを失敗させる。`*.server.ts`に置き、`createIsomorphicFn().server()`または`createServerFn`から呼ぶと成功した。
  - ルートの`loader`の例外は`route.options.onError`だけが受け取り、描画中の例外はルーターの`defaultOnCatch`が受け取る。`withSentry`はどちらも自動では送らない。
  - `<html>`を初回描画前のスクリプトで書き換えると、Reactが属性の不一致を警告する(`suppressHydrationWarning`が要る)。日時を異なるタイムゾーンで整形すると、テキストの不一致(Reactのエラー#418)になった。
- **Implications**: サーバーのエントリを共通部品(`createFrontendServerEntry`)にし、nonce・表示設定・公開してよい設定値を`context`で渡す。CSRFは共通の判定関数をエントリで全要求に適用し、TanStackの`createCsrfMiddleware`も同じ条件で登録して二重に守る。サーバー専用の処理は`*.server.ts`に置く規約にする。

### 共有ディレクトリ(検査担当が自分自身)の型検査設定

- **Context**: `coding/003-shared-directories.md`は、検査担当が`self`の共有ディレクトリの`tsconfig.json`について「配置先の位置から解決できることを採用前に確かめる」と注意している。
- **Sources Consulted**: scratchpadで、`apps/frontend-lib/tsconfig.json`(`extends: "../../tsconfig.base.json"`)を`apps/client/lib`に配置してビルド・開発サーバーを起動した。Vite 8.3.2の型定義(`UserConfig.tsconfig`)。
- **Findings**:
  - 配置先では`extends`が`apps/tsconfig.base.json`を指し、Viteの変換(rolldownの`builtin:vite-transform`)が「Tsconfig not found」でビルドを失敗させた。
  - Viteの`tsconfig: './tsconfig.json'`を指定するとビルドは成功したが、開発サーバーの依存の事前解析は同じ理由で失敗した(事前解析を飛ばして起動はする)。
  - `extends`を持たず、基底設定の値を書き写した自己完結の`tsconfig.json`にすると、ビルド・開発サーバーの両方で警告もエラーも出なかった。
- **Implications**: `apps/frontend-lib/tsconfig.json`は`extends`を持たず、基底設定と同じ値と差分(`jsx`・`lib`)を直接書く。食い違いは`apps/frontend-lib`の単体テストで基底設定と突き合わせて検出する。結果を`coding/003`の注意に追記する。

### 別プロセスのAPIへのService Bindings

- **Context**: api-gatewayのリスク(フロントエンドの`vite dev`から別プロセスのAPIの名前付きエントリポイントへ接続できない可能性)とbriefの実現性チェック(`vite preview`はビルド時の設定で動く)。
- **Sources Consulted**: Cloudflare Docs「[Multi Workers](https://developers.cloudflare.com/workers/local-development/multi-workers/)」「[Run and connect Workers in separate dev commands with the Cloudflare Vite plugin](https://developers.cloudflare.com/changelog/post/2025-06-26-vite-plugin-cross-commands-binding/)」。scratchpadで、`ClientGateway`・`AdminGateway`を持つAPIの代役を`wrangler dev`で、フロントエンドを`vite dev`・`vite build && vite preview`で別々に起動した。
- **Findings**:
  - Wrangler設定の`services: [{ binding: "API", service: "<APIのWorker名>", entrypoint: "ClientGateway" }]`で、`vite dev`・`vite preview`のどちらからも名前付きエントリポイントへ到達し、APIは呼び出し元を`client`と判定した。
  - `vite build`は`dist/server/wrangler.json`に環境ごとの実効値(バインディング・`ratelimits`・`vars`・`observability`)を出力し、`vite preview`とデプロイはこれを使う。
  - `ratelimits`のバインディングはローカルで模擬され、同じキーで101回目から`success: false`になった。
  - `request.cf.timezone`(例: `Asia/Tokyo`)と`Accept-Language`をローカルでも得られた。
- **Implications**: `auxiliaryWorkers`は使わず、APIを先に`wrangler dev`で起動してからフロントエンドを起動する手順にする。デプロイ先の環境のビルドでは`CLOUDFLARE_ENV`を指定する。

### 静的なファイルとヘッダー

- **Context**: 要件4.4・4.6・5.5。
- **Sources Consulted**: scratchpadの`public/_headers`、`vite preview`の応答。
- **Findings**:
  - `public/_headers`は`dist/client/_headers`へ複製され、静的なファイルの応答に付いた(「Parsed 1 valid header rule」)。静的なファイルの既定の`Cache-Control`は`public, max-age=0, must-revalidate`だった。
  - 静的なファイルの要求はWorkerを起動せず、Workerのヘッダーの付与とIP制限を通らない。
- **Implications**: `_headers`に、全経路のセキュリティヘッダーと、`/assets/*`の`Cache-Control: public, max-age=31536000, immutable`を書く。`_headers`の値が共通部品の定数と一致することを各アプリの単体テストで確かめる。

### Sentry 11.4.0のフロントエンドとworkerd

- **Context**: 要件13、NFR-OBLOG-004、tech-stack.md(`@sentry/tanstackstart-react`・`@sentry/cloudflare`)、briefの実現性チェック(SSRの例外は`captureException`で手動送信)。
- **Sources Consulted**: Sentry Docs「[TanStack Start on Cloudflare](https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/tanstack-start/)」、GitHubのgetsentry/sentry-javascript#20038、`@sentry/tanstackstart-react` 11.4.0の`exports`(`workerd`・`worker`・`node`の条件はいずれも`@sentry/node`を再エクスポートするサーバー版、`browser`はクライアント版)、`@sentry/core` 11.4.0の`captureSpan.js`・`beforeSendSpan.js`・`types/datacollection.d.ts`。scratchpadで受信用の代役(ローカルのHTTPサーバー)をDSNに指定して送信内容を確かめた。
- **Findings**:
  - `Sentry.withSentry(() => options, wrapFetchWithSentry(entry))`と`sentryGlobalRequestMiddleware`の組み合わせで、ビルド・`vite preview`ともに動作した。サーバーのバンドルは約700KB→約1MB(gzip後約145KB→約218KB)になった。
  - ルートの`onError`から`@sentry/tanstackstart-react`の`captureException`を呼ぶと、workerd上で例外のイベントが送られた(`withSentry`が設定したクライアントを共有する)。
  - 既定のスパンの逐次送信(`traceLifecycle: 'stream'`)で、`http.server`のスパンの属性に`http.request.header.cookie`・`http.request.header.cf-connecting-ip`・`http.request.header.x-forwarded-for`・`user.ip_address`・`url.full`のクエリ・`url.query`が入った。`sendDefaultPii: false`と`dataCollection`(`userInfo: false`・`cookies: false`・ヘッダーの許可リスト・`urlQueryParams: false`)ではスパンから消えなかった。例外のイベントの`request`はCookie・IPを含まず、URLのクエリも除かれていた。
  - `beforeSendSpan`はスパンごとに、共通の属性とスコープの値を付けた後に呼ばれ、返した値が送られる。属性を除く関数を渡すと、上記の値がすべて消えた。`beforeSendTransaction`は逐次送信では無視される(非推奨)。
  - `src/start.ts`に`sentryGlobalRequestMiddleware`を置いても、クライアントの主バンドルは約50バイトしか増えなかった(サーバー側の処理が除かれる)。一方、ルートのファイルから`captureException`を静的にimportすると、Sentryのコードがクライアントの主バンドルへ入った(主バンドルはSentry無しでgzip後約108KB)。
- **Implications**: サーバー・ブラウザとも`beforeSend`(イベント)と`beforeSendSpan`(スパン)の両方で個人情報を除く。サーバー側は`withSentry`で初期化し、描画とデータ取得の想定外の例外はルートの`onError`・ルーターの`defaultOnCatch`・GraphQLの実行部品から明示的に送る。ブラウザ側は`@sentry/tanstackstart-react`を初期化の後に動的に読み込む。backend-platform・api-gatewayの設計(`beforeSendTransaction`による除去)にも同じ漏れがあり得るため、Risksに記録する。

### GraphQLのクライアント側のコード生成

- **Context**: 要件6、api-gatewayの契約(操作の一覧の場所・形式・識別子`sha256:<16進>`、`documentId`による要求)。
- **Sources Consulted**: api-gatewayのresearch.md(`@graphql-codegen/client-preset` 6.2.0の`persistedDocuments`の出力)、npmの`@graphql-codegen/client-preset@6.2.0`(相手依存`graphql` ^16)。
- **Findings**:
  - `persistedDocuments`を有効にすると、出力先に`persisted-documents.json`を出し、生成した文書に`__meta__.hash`(`sha256:<16進>`)を付ける。`mode: 'replaceDocumentWithHash'`では、生成物から操作の本文が消え、識別子だけが残る。
  - `@graphql-codegen/cli`の`--check`は、生成物が最新でなければ終了コード1を返す。
- **Implications**: 出力先を`src/graphql/generated/`(api-gatewayの契約)にし、`mode: 'replaceDocumentWithHash'`でバンドルから本文を除く。`graphql`は16.14.2、`@graphql-codegen/cli`は7.4.3でapiとそろえる。操作は各アプリの`src`にだけ置き、共通部品には置かない(利用者側と管理者側の一覧を分けるため)。

### ESLint 10と画面向けの静的解析

- **Context**: Q7。
- **Sources Consulted**: npmの相手依存。`eslint-plugin-react` 7.37.5は`eslint` `^3〜^9.7`、`eslint-plugin-jsx-a11y` 6.10.2(最終リリース2024-10)は`^3〜^9`。`@eslint-react/eslint-plugin` 5.23.5は`eslint` `*`、`eslint-plugin-react-hooks` 7.1.1・`@tanstack/eslint-plugin-query` 5.104.1・`@tanstack/eslint-plugin-router` 1.162.0は`^10`を含む。`eslint-plugin-jsx-a11y-x` 0.2.0は`^9 || ^10`。
- **Implications**: 採用した7つで、React・フック・アクセシビリティ・TanStack・Storybookの規則と、クラス名の整列をそろえる。生のHTMLの挿入の禁止(NFR-SECUR-038)は`@eslint-react`の`dom/no-dangerously-set-innerhtml`と`no-restricted-syntax`(`innerHTML`・`outerHTML`への代入)で強制する。

### Storybookとアクセシビリティの自動検査

- **Context**: NFR-MAINT-005、Q8。
- **Sources Consulted**: npmの`@storybook/tanstack-react@10.6.1`(`@storybook/react-vite`を同梱し、相手依存は`storybook` ^10.6.1・`vite` ^5〜^8・`@tanstack/react-router` ^1.168.10、`@tanstack/react-start`は任意)、`@storybook/addon-a11y@10.6.1`(相手依存`storybook` ^10.6.1)、`vitest-browser-react@2.3.0`(相手依存`vitest` ^4)。
- **Implications**: `apps/frontend-lib`に`storybook` 10.6.1・`@storybook/tanstack-react` 10.6.1・`@storybook/addon-a11y` 10.6.1を置く。ブラウザテストは`vitest-browser-react`で描画し、`axe-core` 4.13.0を描画した要素に実行する。

### 日時の表示とハイドレーション

- **Context**: Q1・要件9。
- **Findings**:
  - scratchpadで、ブラウザのタイムゾーンを`America/New_York`・ロケールを`fr-FR`にして`Intl.DateTimeFormat`で整形した値をSSRと食い違わせると、Reactのエラー#418(テキストの不一致)が出た。
  - SSRで使ったタイムゾーンとロケールをルートの`loader`のデータとしてブラウザへ渡し、初期化中はその値で整形し、初期化の後にブラウザの値へ切り替えれば食い違わない(`useSyncExternalStore`のサーバー側の値として渡す)。
- **Implications**: 表示設定(タイムゾーン・ロケール)をサーバーのエントリで求めて`context`で渡し、ルートの`loader`のデータとして画面へ渡す。

### Turnstile・Web Analytics・ビルド後の読み込み失敗

- **Sources Consulted**: `@marsidev/react-turnstile` 1.6.1の型定義(`scriptOptions.nonce`)、Cloudflare Docs「[Observatory](https://developers.cloudflare.com/speed/observatory/)」「Web Analytics FAQ」、Viteの`vite:preloadError`イベント。
- **Findings**:
  - `@marsidev/react-turnstile`はスクリプトの読み込みにnonceを指定でき、依存パッケージを持たない。
  - Web Analyticsの計測スクリプトは`static.cloudflareinsights.com`から読み込み、`cloudflareinsights.com`へ送る。Observatoryは実ユーザーの計測値(RUM)を表示する。
  - Viteは、動的importの失敗をwindowの`vite:preloadError`イベントで通知する。
- **Implications**: Turnstileのスクリプトにルーターのnonceを渡す。Web Analyticsは手動の計測スクリプトとして利用者側のページに置き(Cloudflareの自動挿入は使わない)、CSPに2つのドメインを加える。`vite:preloadError`で1回だけ再読み込みする(要件1.7)。

### 参照したスキル

- `tanstack-start`: `sec-csrf-protection`(状態を変えるサーバー関数は`POST`)、`ssr-hydration-safety`(サーバーとブラウザで同じ値を使う)、`file-separation`(`*.server.ts`)。
- `tanstack-integration`: `setup-query-client-context`(要求ごとのQueryClientをルーターのcontextで渡し、`setupRouterSsrQueryIntegration`を使う)。
- `tanstack-query`・`tanstack-router`: キャッシュの既定値、ルートの`loader`での`ensureQueryData`。
- `ecc:frontend-a11y`・`ecc:accessibility`: フォーカスの管理、ランドマーク、エラーと入力欄の関連付け。
- `ecc:security-review`: CSRF・CSP・Cookieの属性。
- `cloudflare:workers-best-practices`: グローバルスコープで初期化しない、`request.cf`の利用。
- `ecc:react-testing`: アクセシビリティの検査を含む部品のテスト(`vitest-browser-react`へ読み替え)。
- `ecc:api-design`: 共通のエラー形式。

## Architecture Pattern Evaluation

| Option                                         | Description                                                                         | Strengths                                                               | Risks / Limitations                                                          | Notes  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| 独自のサーバーのエントリで前処理と後処理を行う | IP制限・CSRF・中継・CSP・ヘッダー・アクセスログを、TanStackのハンドラーの外側で行う | TanStackのルーター・サーバー関数・静的でない全応答に一律に適用できる    | TanStackのミドルウェアと処理が2段になる                                      | 採用   |
| TanStackのrequestMiddlewareだけで行う          | `createStart`の`requestMiddleware`にすべてを置く                                    | 仕組みが1つで済む                                                       | 中継の経路をサーバーのルートとして持つ必要があり、IP制限が後になる           | 不採用 |
| 中継をサーバー関数で行う                       | ブラウザからのGraphQLを`createServerFn`経由にする                                   | 型付きの呼び出し                                                        | 操作ごとに関数が要り、`documentId`の素通しより重い。シリアライズの形式が独自 | 不採用 |
| 中継を独立した経路`/_bff/graphql`で行う        | `documentId`の要求をそのままAPIへ送る                                               | api-gatewayの要求形式と同じ。サーバー側の描画と同じ組み立てを共有できる | 経路の追加規約が要る                                                         | 採用   |

## Design Decisions

### Decision: サーバーのエントリを共通部品にし、処理の順序を1箇所で定める

- **Context**: 要件1〜5・13。利用者側・管理者側で同じ順序で守る必要がある。
- **Alternatives Considered**:
  1. アプリごとに`src/server.ts`へ処理を書く — 2つのアプリで食い違う。
  2. 共通部品`createFrontendServerEntry`が順序を定め、アプリは呼び出し元の種類・登録箇所・TanStackのハンドラーを渡す — 順序が1箇所に決まる。
- **Selected Approach**: 2。順序は「相関IDとログの文脈 → 環境の検証 → IP制限 → CSRF → 中継の経路 → TanStackのハンドラー → セキュリティヘッダーと`no-store` → アクセスログ」。共通部品は`cloudflare:*`とTanStackのサーバー専用モジュールを読み込まず、Bunの単体テストで順序を確かめる。
- **Trade-offs**: TanStackのミドルウェア(Sentry・CSRF)と2段になる。順序の唯一の定義はエントリ側とし、TanStackのCSRFは二重の防御として同じ条件で登録する。

### Decision: 日時の表示設定をエントリで求めてルートの`loader`で渡す

- **Context**: Q1・要件9。
- **Selected Approach**: エントリが`request.cf.timezone`と`Accept-Language`からタイムゾーンとロケールを求め(解釈できなければUTC・`ja-JP`)、`context`で渡す。ルートの`loader`はサーバー側でそれを返し、`DisplayPreferencesProvider`がサーバー側の値で初期化してから、マウント後にブラウザの値へ切り替える。
- **Trade-offs**: VPNなどで推定が外れた場合だけ、初期化の後に表示が変わる。

### Decision: frontend-libの`tsconfig.json`を自己完結にする

- **Context**: Research Log「共有ディレクトリの型検査設定」。
- **Selected Approach**: `extends`を持たない`tsconfig.json`に基底設定の値を書き写し、単体テストで基底設定との一致を確かめる。Viteの`tsconfig`オプションは使わない(開発サーバーの事前解析が直らないため)。
- **Trade-offs**: 基底設定の変更時に書き写しが要る。単体テストが食い違いを検出する。

### Decision: Sentryの個人情報の除去はイベントとスパンの両方で行う

- **Context**: Research Log「Sentry 11.4.0」、NFR-OBLOG-004、DR-001。
- **Selected Approach**: `sendDefaultPii: false`・`dataCollection`(収集を最小にする)に加え、`beforeSend`でイベントの`user`・`request`のCookieとヘッダーとクエリを、`beforeSendSpan`でスパンの`http.request.header.*`(許可した3つを除く)・`http.response.header.*`・`user.*`・`client.address`・`url.query`・`url.full`のクエリを除く。Session Replayの統合は入れない。
- **Follow-up**: 除去の関数をBunの単体テストで、送信内容をスモークテストで確かめる。

### Decision: ブラウザ側のSentryを初期化の後に読み込む

- **Context**: 要件14.2(最初の描画を妨げない)、NFR-PERF-003。
- **Selected Approach**: ルートの部品のマウント後に`@sentry/tanstackstart-react`を動的に読み込み、ルーターのトレースと中継の経路への伝搬を設定する。中継はサーバー側の現在のスパンから`sentry-trace`・`baggage`を求めてAPIへ付ける。
- **Trade-offs**: 初期化より前の例外とページの読み込み自体のトレースは記録しない。計測の対象(GraphQLの要求)は初期化の後に発生するため影響しない。

### Decision: 区画・CSP・中継の経路を登録箇所で追加する

- **Context**: 要件2.14・4.3・11.3・11.4。
- **Selected Approach**: 各アプリの`src/composition/`に、レイアウトの区画(`layout-slots.tsx`)、CSPとPermissions-Policyの追加の許可先(`security-policy.ts`)、中継の経路(`relay-routes.ts`)の登録箇所を置く。後続のspecはここへ追記するだけで、共通部品と共通レイアウトを変えない。
- **Rationale**: backend-platform・api-gatewayの登録箇所(`composition/*.ts`)と同じ形にそろえる。

### Generalization・Build vs Adopt・Simplification

- **Generalization**: 中継は「経路・上流のパス・メソッド・本文の扱い・待ち時間」を持つ1つの定義(`RelayRoute`)にまとめ、GraphQLはその1つとして登録する。サーバー側の描画のGraphQLの実行も、同じ中継の項目の組み立て(`buildRelayHeaders`)とCookieの指示の処理を使う。CSPは許可先の集合(`SecurityPolicySources`)の合成として作り、後続specは集合を登録する。
- **Build vs Adopt**:
  - 採用: TanStack Start(ルーター・SSR・サーバー関数・`createCsrfMiddleware`)、TanStack Query・`@tanstack/react-router-ssr-query`、GraphQL Code Generatorのclient-preset、shadcn/ui(radix-ui)、sonner、React Hook Form・`@hookform/resolvers`、`@marsidev/react-turnstile`、`@sentry/cloudflare`・`@sentry/tanstackstart-react`、LogTape・`@logtape/redaction`(backend-platformと同じ形式)。
  - 自作: サーバーのエントリの合成(順序の唯一の定義)、CSRFの判定関数(エントリで全要求に適用するため)、CSPの組み立て、中継とCookieの指示、表示設定の推定、Sentryの除去関数、静的なエラー画面(IP制限・環境の不備はTanStackより前に返すため)。
  - 不採用: Honoをフロントエンドのエントリに使うこと(処理は少なく、TanStackとの二重のルーティングになる)、Sentryのトンネル(経路と負荷が増える。CSPにSentryの送信先を許可すれば足りる)、MSW(GraphQLの実行部品が`fetch`を差し替えられる)、devtools。
- **Simplification**:
  - アニメーション演出の切替、通貨の表示、Storybookのデプロイ、E2Eでのアクセシビリティ検査は作らない。
  - 共通部品にGraphQLの操作を置かない。Jotaiは要求ごとのストアの用意と規約だけにし、本specの段階では原子(atom)を定義しない。

## Risks & Mitigations

- backend-platform・api-gatewayのSentryの設定(`beforeSendTransaction`による除去)は、Sentry 11の既定のスパンの逐次送信では呼ばれず、`http.server`のスパンにCookie・IPアドレス・URLのクエリが残る可能性がある — 本specの除去関数と同じ`beforeSendSpan`の対策を、上流specの実装時に開発者へ確認する(完了報告に記載する)。
- TanStack Startの更新でnonceの付与範囲やCSRFのミドルウェアの挙動が変わる — スモークテストで、すべての`<script>`のnonce・CSPの違反が無いこと・クロスサイトのPOSTの403を確かめる。
- 中継とページの描画の両方でAPIを呼ぶため、APIのIP制限(100回/10秒)にフロントエンドのIP制限と同じ利用者が重ねて数えられる — 同じ上限で、ページの描画は1回の要求あたり数回の呼び出しに留める規約を`frontend/`の文書に記載する。
- ストリーミングで送り始めた後に、遅れて完了した取得がセッションの更新を指示しても、Cookieを発行できない — セッションの指示はページの描画より前(ルートの`loader`)の取得でだけ反映し、後から届いた指示は警告ログに出して捨てる規約にする。
- `eslint-plugin-jsx-a11y-x`はフォークで歴史が浅い — 版を固定し、本家がESLint 10へ対応したら移行を検討する。
- `@cloudflare/vite-plugin`を1.53.0に留めるため、新しい機能の取り込みが遅れる — `@cloudflare/vitest-pool-workers`の更新と同時に3つを一括で更新する規則を文書化する。
- 開発サーバーで自分が起動したサーバーのログが入れ子に増える(既知のVite 8の挙動) — オンボーディングに注記する。

## References

- [TanStack Start: Middleware](https://tanstack.com/start/latest/docs/framework/react/guide/middleware) — `createStart`・`requestMiddleware`
- [TanStack Router issue #5511](https://github.com/TanStack/router/issues/5511) — `ssr.nonce`のインラインのスクリプトへの付与(1.168.60では解消済みを確認)
- [Sentry: TanStack Start on Cloudflare](https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/tanstack-start/) — `withSentry`・`wrapFetchWithSentry`・グローバルのミドルウェア
- [getsentry/sentry-javascript#20038](https://github.com/getsentry/sentry-javascript/issues/20038) — `workerd`の条件が`@sentry/node`を解決する件(本構成では動作を確認)
- [Cloudflare: Multi Workers](https://developers.cloudflare.com/workers/local-development/multi-workers/) — 別プロセス間のService Bindings
- [Cloudflare: Request(cf.timezone)](https://developers.cloudflare.com/workers/runtime-apis/request/) — 接続元のタイムゾーン
- [Cloudflare: Observatory](https://developers.cloudflare.com/speed/observatory/) — RUM
- [WCAG 2.2: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) — 2.2.2の停止手段
