# 依存パッケージの版管理

版を完全に固定すべき主要パッケージの一覧と、それらを追加・更新する手順を定める。

## 前提

- ワークスペース機能を使わず、ルートと各アプリがそれぞれ`package.json`と`bun.lock`を持つ。そのため、同じパッケージの版はアプリごとに別々に決まり、放置すると食い違う。
- 次のパッケージは、アプリ間で版が食い違うと基底設定・プリセットが動かなくなる、または組み合わせられる版の範囲が狭い。そこで、`^`・`~`の範囲指定を使わずに版を完全に固定し、導入するすべての場所で同じ版にそろえる。
- 品質ゲートの対象外にしたディレクトリ(独自の設定で動かす試作など)は、版をそろえる対象に含めない。

## 主要パッケージの一覧

| パッケージ                                                                                                | 版                                      | 導入先                                               | 固定の理由                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript`                                                                                              | 6.0.3                                   | ルート・全アプリ                                     | `typescript-eslint` 8.71.0がTypeScript 6.1未満にしか対応しない                                                                                                              |
| `eslint`・`@eslint/js`                                                                                    | 10.12.0・10.0.1                         | ルート・全アプリ                                     | 静的解析の基底設定の規則と、ファイルごとに最も近い設定ファイルを使う探索に依存する                                                                                          |
| `typescript-eslint`                                                                                       | 8.71.0                                  | ルート・全アプリ                                     | 静的解析の基底設定が使う`strictTypeChecked`・`no-deprecated`に依存する                                                                                                      |
| `eslint-config-prettier`                                                                                  | 10.1.8                                  | ルート・全アプリ                                     | 整形と静的解析の衝突を避ける                                                                                                                                                |
| `prettier`                                                                                                | 3.9.9                                   | ルート・全アプリ                                     | 整形結果を一致させる(整形検査はルートの版、エディタ連携はアプリの版で整形する)                                                                                              |
| `vitest`・`@vitest/browser-playwright`・`@vitest/coverage-v8`・`@vitest/coverage-istanbul`                | 4.1.11                                  | ブラウザテスト・Workers統合テストを持つアプリ        | `@cloudflare/vitest-pool-workers`がVitest ^4.1にしか対応しない。`@vitest/browser-playwright`は同じ版の`vitest`だけを前提とする                                              |
| `@cloudflare/vitest-pool-workers`                                                                         | 0.22.0                                  | Workers統合テストを持つアプリ                        | Vitest 4.1系と組み合わせられる版                                                                                                                                            |
| `wrangler`                                                                                                | 4.124.0                                 | Workers統合テストを持つアプリ・画面を持つアプリ      | `@cloudflare/vitest-pool-workers` 0.22.0と`@cloudflare/vite-plugin` 1.53.0が`dependencies`で完全固定する版と一致させ、実体を1つに保つ。`wrangler types`の実行に必要         |
| `@cloudflare/vite-plugin`                                                                                 | 1.53.0                                  | 画面を持つアプリ                                     | `wrangler` 4.124.0を`dependencies`で完全固定し、同じ版以上の`wrangler`を相手依存に持つ。開発サーバーとビルドがWorkerの実行環境を同じ版で再現する                            |
| `drizzle-orm`・`drizzle-kit`                                                                              | 1.0.0-rc.5(2つとも同一のプレリリース版) | DBスキーマ定義の共有ディレクトリと、それを使うアプリ | 正式版が無くRCのまま。ORMとマイグレーション生成ツールの版ずれを防ぐ                                                                                                         |
| `@playwright/test`・`playwright`                                                                          | 1.64.1                                  | ルート(`playwright`はブラウザテストを持つアプリも)   | 共有のChromiumのリビジョンを決める。開発コンテナのOS依存パッケージの版と一致させる                                                                                          |
| `hono`                                                                                                    | 4.13.13                                 | バックエンドの共通ライブラリを使うアプリ             | 共通ライブラリは配置先のアプリの依存パッケージで動き、検査担当のアプリの版でだけテストされる。版が食い違うと、テストしていない組み合わせで動く                              |
| `inversify`・`reflect-metadata`                                                                           | 8.2.3・0.2.2                            | バックエンドの共通ライブラリを使うアプリ             | `hono`と同じ理由。`reflect-metadata`はInversifyの内部パッケージの相手依存(`~0.2.2`)で、アプリで明示的に宣言して版を固定する                                                 |
| `zod`                                                                                                     | 4.6.5                                   | バックエンドの共通ライブラリを使うアプリ             | `hono`と同じ理由。環境とメッセージの本文の検証規則を、共通ライブラリとアプリのスキーマで組み合わせる                                                                        |
| `@logtape/logtape`・`@logtape/redaction`                                                                  | 2.3.11(2つとも同一)                     | バックエンドの共通ライブラリを使うアプリ             | `hono`と同じ理由。`@logtape/redaction`は同じ版以上の`@logtape/logtape`を相手依存に持ち、2つは同じ版で公開される                                                             |
| `@sentry/cloudflare`・`@sentry/hono`                                                                      | 11.4.0(2つとも同一)                     | バックエンドの共通ライブラリを使うアプリ             | `hono`と同じ理由。2つとも`@sentry/core`を同じ版に完全固定し、`@sentry/hono`は同じ版の`@sentry/cloudflare`を相手依存に持つ。2つの版をそろえて`@sentry/core`の実体を1つに保つ |
| `ulid`                                                                                                    | 3.0.2                                   | DBスキーマ定義の共有ディレクトリと、それを使うアプリ | 共通カラムの主キーの既定値と、共通ライブラリのIDの採番が使う。マイグレーションの生成とアプリの実行で同じ版にする                                                            |
| `graphql`・`@graphql-codegen/cli`                                                                         | 16.14.2・7.4.6                          | GraphQLのサーバーとクライアントを持つアプリ          | サーバーのスキーマとクライアントの操作を同じ版で検証・型生成する。`graphql`はGraphQL Armorの依存(`^16.10.0`)に合わせて16系にし、アプリ内の実体を1つに保つ                   |
| `@graphql-codegen/client-preset`                                                                          | 6.2.3                                   | GraphQLのクライアントを持つアプリ                    | 生成する文書・型と操作の一覧の形が版によって変わる。`@graphql-codegen/cli`と同時に更新し、生成し直す                                                                        |
| `@tanstack/react-start`・`@tanstack/react-router`                                                         | 1.168.60・1.170.41                      | 画面の共通部品と、それを使うアプリ                   | `@tanstack/react-start`が`@tanstack/react-router`を`dependencies`で完全固定する。直接宣言する`@tanstack/react-router`をその版に合わせ、実体を1つに保つ                      |
| `@tanstack/react-query`・`@tanstack/react-router-ssr-query`                                               | 5.104.1・1.167.3                        | 画面の共通部品と、それを使うアプリ                   | `@tanstack/react-router-ssr-query`は`@tanstack/react-router`・`@tanstack/react-query`の下限の版を相手依存に持ち、描画中の取得のキャッシュの受け渡しが版の組に依存する       |
| `@sentry/tanstackstart-react`                                                                             | 11.4.0                                  | 画面の共通部品と、それを使うアプリ                   | `@sentry/core`を同じ版に完全固定する。`@sentry/cloudflare`と同じ版にそろえて`@sentry/core`の実体を1つに保つ                                                                 |
| `graphql-yoga`・`@graphql-yoga/plugin-persisted-operations`・`@graphql-yoga/plugin-disable-introspection` | 5.24.6・3.24.6・2.25.6                  | GraphQLのサーバーを持つアプリ                        | GraphQL Armorの相手依存の`@envelop/core`(`^5.0.0`)と組み合わせられるGraphQL Yogaの系列に限る。2つのプラグインは同じ系列の`graphql-yoga`を相手依存に持つ                     |
| `@escape.tech/graphql-armor`                                                                              | 3.2.0                                   | GraphQLのサーバーを持つアプリ                        | `graphql`の系列と、組み合わせられるGraphQL Yogaの系列を決める                                                                                                               |
| `@graphql-codegen/typescript`・`@graphql-codegen/typescript-resolvers`                                    | 6.1.2・6.1.1                            | GraphQLのサーバーを持つアプリ                        | 生成するリゾルバの型が版によって変わる。`@graphql-codegen/cli`と同時に更新し、生成し直す                                                                                    |
| `react`・`react-dom`・`@types/react`・`@types/react-dom`                                                  | 19.3.0(4つとも同一)                     | Reactを使うアプリ                                    | `react-dom`は同じ版の`react`を相手依存に持つ。フロントエンドとメールの描画で同じ版にそろえ、型定義も実行時の版に合わせる                                                    |
| `@react-email/components`・`@react-email/render`                                                          | 1.0.12・2.1.0                           | メールを描画するアプリ                               | Workers向けの出力(`workerd`条件)の有無が版で変わる。部品側が別の版の`@react-email/render`を内部に持つため、直接宣言した版で描画する                                         |

- Vitest系はテストの種別に応じて導入する。ブラウザテストを持つアプリは`vitest`・`@vitest/browser-playwright`・`@vitest/coverage-v8`・`playwright`を、Workers統合テストを持つアプリは`vitest`・`@vitest/coverage-istanbul`・`@cloudflare/vitest-pool-workers`・`wrangler`を導入する。
- ルートは`@playwright/test`だけを直接宣言する。`@playwright/test`は`playwright`を、`playwright`は`playwright-core`を、それぞれ完全固定の`dependencies`で持つため、`playwright`・`playwright-core`は推移的に同じ版に決まる。ブラウザテストを持つアプリは、`@vitest/browser-playwright`が使う`playwright`を直接宣言し、同じ版にする。
- 一覧に無いパッケージでも、共有ディレクトリのコードが実行時に使うものは、利用側アプリが共有ディレクトリ側と同じ版で宣言する。
- バックエンドの共通ライブラリは`package.json`を持たず、使うパッケージ(`hono`・`inversify`・`reflect-metadata`・`zod`・`@logtape/logtape`・`@logtape/redaction`・`@sentry/cloudflare`・`@sentry/hono`・`ulid`・`drizzle-orm`)を、配置先の全アプリが同じ版で`dependencies`に宣言する。`@sentry/core`の型だけを使う場合も、`@sentry/core`は宣言せず`@sentry/cloudflare`・`@sentry/hono`が固定する版に任せる。
- GraphQLのクライアントを持つアプリ(画面を持つアプリ)は、`graphql`・`@graphql-codegen/cli`を、GraphQLのサーバーを持つアプリと同じ版で`devDependencies`に宣言する。クライアントの操作を、サーバーのスキーマの検証と同じ版の`graphql`で検証するためである。
- 画面の共通部品は、型の出どころとして`graphql`を`devDependencies`に宣言する。宣言しないと、Bunが他のパッケージの相手依存として別の系列の`graphql`を入れる。

## 画面の共通部品と利用側アプリでそろえるパッケージ

画面の共通部品は検査担当として自身の`package.json`を持ち、利用者側・管理者側の画面を持つアプリへ配置される(「[共有ディレクトリの配置方式](003-shared-directories.md)」)。配置先では利用側アプリの`node_modules`で動き、型検査と静的解析も利用側アプリの版で行われるため、次のパッケージを共通部品と画面を持つすべてのアプリで同じ版にそろえる。版の一致は自動では検査しないため、「[全アプリの版をそろえる手順](#全アプリの版をそろえる手順)」で確かめる。

| 分類               | パッケージと版                                                                                                                                                                                                                                                      | 宣言する場所                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 描画とルーティング | `react`・`react-dom` 19.3.0、`@tanstack/react-start` 1.168.60、`@tanstack/react-router` 1.170.41、`@tanstack/react-query` 5.104.1、`jotai` 3.0.1                                                                                                                    | 共通部品とアプリの`dependencies`             |
| GraphQL            | `@graphql-typed-document-node/core` 3.2.0                                                                                                                                                                                                                           | 共通部品とアプリの`dependencies`             |
| フォーム           | `react-hook-form` 7.89.0、`@hookform/resolvers` 5.9.1、`zod` 4.6.5                                                                                                                                                                                                  | 共通部品とアプリの`dependencies`             |
| 部品               | `radix-ui` 1.6.7、`class-variance-authority` 0.7.1、`clsx` 2.1.1、`tailwind-merge` 3.7.0、`lucide-react` 1.51.0、`sonner` 2.0.8、`@marsidev/react-turnstile` 1.6.1                                                                                                  | 共通部品とアプリの`dependencies`             |
| 観測               | `@sentry/cloudflare`・`@sentry/tanstackstart-react` 11.4.0、`@logtape/logtape`・`@logtape/redaction` 2.3.11                                                                                                                                                         | 共通部品とアプリの`dependencies`             |
| スタイルとビルド   | `tailwindcss`・`@tailwindcss/vite` 4.3.3、`tw-animate-css` 1.4.0、`vite` 8.3.2、`@vitejs/plugin-react` 6.1.1                                                                                                                                                        | 共通部品とアプリの`devDependencies`          |
| 型とテスト         | `@types/react`・`@types/react-dom` 19.3.0、`graphql` 16.14.2、`vitest`・`@vitest/browser-playwright`・`@vitest/coverage-v8` 4.1.11、`playwright` 1.64.1、`vitest-browser-react` 2.3.0、`axe-core` 4.13.0                                                            | 共通部品とアプリの`devDependencies`          |
| 静的解析と整形     | `@eslint-react/eslint-plugin` 5.23.5、`eslint-plugin-react-hooks` 7.1.1、`@tanstack/eslint-plugin-query` 5.104.1、`@tanstack/eslint-plugin-router` 1.162.0、`eslint-plugin-jsx-a11y-x` 0.2.0、`eslint-plugin-storybook` 10.6.1、`prettier-plugin-tailwindcss` 0.8.1 | 共通部品とアプリの`devDependencies`          |
| アプリだけ         | `@tanstack/react-router-ssr-query` 1.167.3(`dependencies`)、`@cloudflare/vite-plugin` 1.53.0・`wrangler` 4.124.0・`@graphql-codegen/cli` 7.4.6・`@graphql-codegen/client-preset` 6.2.3(`devDependencies`)                                                           | アプリだけ。利用者側と管理者側で同じ版にする |
| 共通部品だけ       | `storybook`・`@storybook/tanstack-react`・`@storybook/addon-a11y` 10.6.1                                                                                                                                                                                            | 共通部品の`devDependencies`だけ              |

- 静的解析のプラグインは、共通部品の静的解析の設定(`createFrontendLintConfig`)へアプリの設定ファイルから渡す。版が食い違うと、共通部品とアプリで別の規則が適用される。`eslint-plugin-storybook`は、アプリにカタログが無くても共通部品の設定の必須の引数のため宣言する。
- `graphql`・`axe-core`・`vitest-browser-react`は、アプリが共通部品のファイルを型検査に含めるために宣言する。
- カタログのアクセシビリティの検査(`@storybook/addon-a11y`)は自身の依存の`axe-core`を使うため、ブラウザテストの`axe-core`と版が異なり得る。
- `@storybook/tanstack-react`が相手依存に持つ`@tanstack/router-core`・`@tanstack/start-client-core`は直接宣言せず、`@tanstack/react-start`・`@tanstack/react-router`が固定する版に任せる。

## 更新時の確認事項

一覧のパッケージを更新するときは、パッケージごとに次を確かめる。新しい版の依存関係は`bun pm view <パッケージ>@<版> peerDependencies`・`bun pm view <パッケージ>@<版> dependencies`で調べられる。

### TypeScript

- `typescript-eslint`の`peerDependencies`の`typescript`の範囲に、新しい版が含まれる。含まれない場合は、対応する`typescript-eslint`が出るまで上げない。
- リリースノートで非推奨になったオプションと既定値の変更を確かめ、基底の型検査設定とアプリの差分に非推奨のオプションが残っていない。
- ルートと全アプリの型検査が成功する。

### ESLint・@eslint/js・typescript-eslint・eslint-config-prettier

- 互いの`peerDependencies`の範囲(`typescript-eslint`・`@eslint/js`が求める`eslint`の版など)を満たす。
- 静的解析の基底設定の単体テストが成功する。非推奨の記法が違反になること、書式だけの違いが違反にならないこと、`*.config.ts`で型情報付きの規則が無効になることを確かめるテストである。
- `eslint-config-prettier/flat`の入口が残っている。
- ルートから複数のアプリのファイルを1度に渡したとき、各ファイルが最も近い設定ファイルで検査される(コミット時の検査がこの振る舞いに依存する)。

### Prettier

- ルートで`bun run format:check`を実行し、整形結果が変わったファイルがあれば、機能の変更と分けて整形だけの独立したコミットにする。
- アプリ固有のプラグインを使っている場合は、ルートのPrettierから実行してもプラグインを解決できる。

### Vitest系

- `@cloudflare/vitest-pool-workers`の`peerDependencies`の`vitest`の範囲に、新しい版が含まれる。Vitest 5系ではWorkersのテストプールが起動しないという報告があるため、対応する`@cloudflare/vitest-pool-workers`が出るまで上げない。
- 4つのパッケージを同じ版で同時に更新する。
- ブラウザテストのプリセットの`resolveScreenshotPath`を確認し直す。Vitest 4.1.11は`screenshotDirectory`を指定すると画像比較の基準画像の既定の保存先も変えるため、プリセットは`resolveScreenshotPath`で基準画像の保存先を`<テストのディレクトリ>/__screenshots__/<テストファイル名>/<名前>-<ブラウザ>-<OS><拡張子>`に固定している。更新後も基準画像がこの場所に保存・参照され、失敗時のスクリーンショットと差分画像がGit管理外の出力先に出ることを確かめる。
- カバレッジの閾値がファイル単位で判定され、閾値未達で失敗し、lcovが種別ごとの出力先に書き出される。テストが0件のとき、計測を有効にしない実行が成功する。

### @cloudflare/vite-plugin・wrangler・@cloudflare/vitest-pool-workers

3つは同じ`wrangler`の版の組として、すべてのアプリで同じコミットで一括して更新する。どれか1つだけを上げると、アプリごと・パッケージごとに別の版の`wrangler`が入り、開発サーバー・ビルド・Workers統合テストが別々の実行環境で動く。

- `bun pm view @cloudflare/vitest-pool-workers@<版> dependencies`と`bun pm view @cloudflare/vite-plugin@<版> dependencies`で完全固定されている`wrangler`の版を調べ、2つが同じ`wrangler`の版を固定する組を選ぶ。`wrangler`をその版にする。片方の新しい版が無ければ、組がそろうまで3つとも上げない。
- `bun pm view @cloudflare/vite-plugin@<版> peerDependencies`の`vite`の範囲が、画面を持つアプリの`vite`の版を含む。
- `git grep -noE '\["wrangler@[^"]+"' -- '*bun.lock' ':!<対象外のディレクトリ>/'`で、各`bun.lock`に`wrangler`が1つの版だけ載っている。
- Wranglerで型を生成するすべてのアプリで、`bun run cf-typegen`で型の定義ファイル(`worker-configuration.d.ts`)を生成し直し、差分を確かめてコミットする。Workers統合テストを持つアプリは実行時の型を含めて、画面を持つアプリは環境の型だけを生成し(「[環境の型](../frontend/002-tanstack-start-on-workers.md#環境の型)」)、どちらも`bun run cf-typegen:check`が成功する。
- `@cloudflare/vitest-pool-workers`の`peerDependencies`の`vitest`の範囲が、一覧の`vitest`の版を含む。
- 画面を持つアプリで、開発サーバーとビルドの後のプレビューが起動し、ビルドの出力の設定(`dist/server/wrangler.json`)がデプロイ先の環境の値になる(「[デプロイ先の環境のビルド時の指定](../frontend/002-tanstack-start-on-workers.md#デプロイ先の環境のビルド時の指定)」)。

### drizzle-orm・drizzle-kit

- 2つを同じ版で同時に更新する。
- プレリリース版は通常`latest`タグの対象にならない。`bun pm view drizzle-orm dist-tags`でプレリリース版のタグ(例: `rc`)と版を確かめ、版を明示して導入する。
- スキーマを変えずにマイグレーションの生成を実行し、新しいマイグレーションが生成されない。スナップショットの形式が変わった場合は、リリースノートの手順に従って移行する。
- ORMを使う全アプリの型検査が成功する。共有ディレクトリのスキーマ定義は、マイグレーションの生成では共有ディレクトリ側のORMで、アプリの型検査と実行では利用側アプリのORMで読み込まれる。版が食い違うと、生成したマイグレーションとアプリの実行とでスキーマ定義の解釈が異なり得る。

### @sentry/cloudflare・@sentry/hono・@sentry/tanstackstart-react

- バックエンドの`@sentry/cloudflare`・`@sentry/hono`と、画面の`@sentry/cloudflare`・`@sentry/tanstackstart-react`を、すべて同じ版で同時に更新する。
- `git grep -noE '\["@sentry/core@[^"]+"' -- '*bun.lock' ':!<対象外のディレクトリ>/'`で、各`bun.lock`に`@sentry/core`が1つの版だけ載っている。
- 「[SDKの版を更新するとき](../infra/004-logging-and-error-tracking.md#sdkの版を更新するとき)」の項目を確かめる。

### graphql・GraphQL Yoga・GraphQL Armor・GraphQL Code Generator

- `bun pm view @escape.tech/graphql-armor@<版> dependencies`の`graphql`の範囲に、一覧の`graphql`の版が含まれる。
- `bun pm view graphql-yoga@<版> dependencies`の`@envelop/core`の範囲が、`bun pm view @escape.tech/graphql-armor@<版> peerDependencies`の`@envelop/core`の範囲と重なる。重ならない場合は、対応するGraphQL Armorが出るまでGraphQL Yogaの系列を上げない。
- 2つのGraphQL Yogaのプラグインは、`peerDependencies`の`graphql-yoga`の範囲が新しい版を含む版へ同時に更新する。
- `git grep -noE '\["graphql@[^"]+"' -- '*bun.lock' ':!<対象外のディレクトリ>/'`で、各`bun.lock`に`graphql`が1つの版だけ載っている。
- GraphQL Code Generatorを更新したら、サーバーとクライアントの型を生成し直し、差分を確かめてコミットする。クライアントの`@graphql-codegen/client-preset`は`@graphql-codegen/cli`と同時に更新する。
- `graphql`・`@graphql-codegen/cli`は、GraphQLのサーバーを持つアプリと、クライアントを持つアプリ・画面の共通部品で同じ版にする。
- クライアントの生成し直しで、操作の一覧の識別子が変わらない。識別子は操作の本文から計算されるため、操作を変えずに識別子が変わったら、本文の出力の形が変わっている。その場合は、APIサーバーの許可リストを生成し直してコミットし、デプロイの間に直前のリリースの画面の操作が拒否されないことを確かめる(「[許可リストの生成とデプロイの順序](004-graphql-communication.md#許可リストの生成とデプロイの順序)」)。
- 生成した文書が操作の本文を含まず、識別子だけを持つ(各アプリの`test/config/codegen.unit.test.ts`)。

### react・react-dom・@types/react・@types/react-dom・React Email

- 4つのReact系パッケージを同じ版で同時に更新し、Reactを使うすべてのアプリで同じ版にする。
- `bun pm view @react-email/components@<版> peerDependencies`・`bun pm view @react-email/render@<版> peerDependencies`の`react`の範囲に、一覧の`react`の版が含まれる。
- `bun pm view @react-email/render@<版> exports`で`workerd`条件の出力が残っている。
- メールの描画のWorkers統合テストが、日本語のHTMLとテキストの生成とエスケープを確かめて成功する。

### TanStack Start・TanStack Router・TanStack Query

- `bun pm view @tanstack/react-start@<版> dependencies`で完全固定されている`@tanstack/react-router`の版を調べ、直接宣言する`@tanstack/react-router`をその版にする。2つは同じコミットで更新する。
- `bun pm view @tanstack/react-router-ssr-query@<版> peerDependencies`の`@tanstack/react-router`・`@tanstack/react-query`の範囲が、新しい版を含む。
- `bun pm view @storybook/tanstack-react@<版> peerDependencies`の`@tanstack/react-start`・`@tanstack/react-router`の範囲が、新しい版を含む。
- `git grep -noE '\["@tanstack/(react-router|router-core|react-query)@[^"]+"' -- '*bun.lock' ':!<対象外のディレクトリ>/'`で、各`bun.lock`にそれぞれが1つの版だけ載っている。
- サーバー関数の呼び出しの判定(`isServerFunctionCall`)が、TanStack Startの経路の正規化と一致する(「[CSRFの検証](../frontend/003-frontend-server-security.md#csrfの検証)」)。
- 描画中の取得のセッションの指示が、応答を送り始める前ならページの応答に反映され、送り始めた後なら警告を出して捨てられる(「[Cookieの指示が反映される範囲](../frontend/006-data-fetching.md#cookieの指示が反映される範囲)」)。共通部品の単体テストは、宣言していない`seroval`・`@tanstack/router-core/ssr/client`・`@tanstack/start-storage-context`を直接読み込むため、それらの公開の形が変わっていないことも確かめる。
- 画面を持つアプリの`vite build`の出力で、ブラウザ向けの出力にサーバー専用のファイルの内容と`node:`のモジュールが含まれない(「[サーバー専用のファイルと同型の関数](../frontend/002-tanstack-start-on-workers.md#サーバー専用のファイルと同型の関数)」)。
- スモークテスト(E2E)が、両アプリの開発サーバーとビルドの後のプレビューで成功する。

### react-hook-form・@hookform/resolvers

- 画面の共通部品のフォームの部品は、公開のAPIで置き換えられない内部の値と公開されていない振る舞いに頼る。版を変えると版の番人テストが失敗するため、「[内部の値に頼るパッケージの版を上げる手順](#内部の値に頼るパッケージの版を上げる手順)」に従って見直す。

### @playwright/test・playwright

- 開発コンテナのOS依存パッケージの版、ルートの`@playwright/test`の版、2つのブラウザ操作MCPサーバーの版の4箇所を整合させる。手順は「[E2Eテストツールの版の更新手順](../testing/002-browser-tool-versions.md)」に従う。
- ブラウザテストを持つアプリの`playwright`も同じ版にする。

## 版を明示した追加手順

一覧のパッケージを追加するときは、次の手順に従う。

1. 一覧で版を確かめる。
2. 追加するディレクトリ(ルートまたはアプリ)で、版を明示し`--exact`を付けて追加する。開発時だけ使うパッケージには`--dev`を付け、実行時に使うパッケージには付けない。

   ```sh
   bun add --dev --exact <パッケージ>@<版>
   bun add --exact <パッケージ>@<版>
   ```

3. `package.json`に`^`・`~`の付かない版が書かれ、`bun.lock`が更新されたことを確かめる。
4. `package.json`と`bun.lock`を同じコミットに含める。

## 全アプリの版をそろえる手順

一覧のパッケージの版を変えるときは、それを使うすべての場所を同じ版にそろえる。

1. 一覧の版を先に更新する。
2. そのパッケージを宣言している`package.json`を探す。`git grep`はGitで管理するファイルだけを検索するため、node_modulesの中は対象にならない。品質ゲートの対象外にしたディレクトリは、除外のパス指定(`':!<対象外のディレクトリ>/'`)で検索から外す。

   ```sh
   git grep -n '"<パッケージ>":' -- '*package.json' ':!<対象外のディレクトリ>/'
   ```

3. 見つかった各ディレクトリで、「[版を明示した追加手順](#版を明示した追加手順)」のコマンドを新しい版で実行する。一緒に動かすパッケージ(Vitest系の4つ、`@cloudflare/vite-plugin`と`wrangler`と`@cloudflare/vitest-pool-workers`、`drizzle-orm`と`drizzle-kit`、`@playwright/test`と`playwright`、`inversify`と`reflect-metadata`、`@logtape/logtape`と`@logtape/redaction`、`@sentry/cloudflare`と`@sentry/hono`と`@sentry/tanstackstart-react`、`graphql-yoga`と2つのプラグイン、`@graphql-codegen/cli`と`@graphql-codegen/typescript`・`@graphql-codegen/typescript-resolvers`・`@graphql-codegen/client-preset`、`@tanstack/react-start`と`@tanstack/react-router`、`react`・`react-dom`・`@types/react`・`@types/react-dom`)は同時に更新する。画面の共通部品のパッケージは、共通部品と画面を持つすべてのアプリで同時に更新する(「[画面の共通部品と利用側アプリでそろえるパッケージ](#画面の共通部品と利用側アプリでそろえるパッケージ)」)。
4. すべての`package.json`と`bun.lock`が同じ版になったことを確かめる。

   ```sh
   git grep -n '"<パッケージ>":' -- '*package.json' ':!<対象外のディレクトリ>/'
   git grep -noE '\["<パッケージ>@[^"]+"' -- '*bun.lock' ':!<対象外のディレクトリ>/'
   ```

5. 「[更新時の確認事項](#更新時の確認事項)」を確かめ、ルートで一括検査(`bun run check`)とテストの一括実行が成功することを確かめる。
6. 変更したすべての`package.json`と`bun.lock`を1つのコミットに含める。

## 内部の値に頼るパッケージの版を上げる手順

公開のAPIが無いために内部の値(先頭に`_`の付いた名前など)や、文書に書かれていない振る舞いに頼る部品は、版を上げると黙って壊れ得る。そうした部品は頼る項目を版の番人テストに一覧として持ち、版を上げる時に次の手順で見直す。

| パッケージ                               | 版の番人テスト                                                        | 一覧の項目を確かめるテスト                                                                |
| ---------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `react-hook-form`・`@hookform/resolvers` | 画面の共通部品の`components/form/form-library-internals.unit.test.ts` | 番人テスト自身(Bunで動かせる項目)と、一覧が示すフォームの部品の単体テスト・ブラウザテスト |

1. 「[全アプリの版をそろえる手順](#全アプリの版をそろえる手順)」で版を上げると、番人テストが、確かめた版と導入済みの版、見直す項目、各項目を使う箇所と確かめるテストのファイル(ブラウザテストはテストの名前も)を示して失敗する。
2. 一覧の各項目について、番人テストの振る舞いの検査と、項目が示す単体テスト・ブラウザテストを新しい版で実行して成功することを確かめる。変更履歴で項目に関わる変更が無いかも確かめる。
3. 失敗した項目は、公開のAPIで置き換えられるようになっていれば置き換えて一覧から外し、置き換えられなければ部品を新しい版の振る舞いに合わせて直し、一覧の項目と検査を新しい振る舞いに合わせる。
4. すべての項目を確かめた後に、番人テストの確かめた版を導入済みの版に書き換え、番人テストが成功することを確かめる。

- 部品が新しく内部の値に頼る時は、まず公開のAPIで置き換えられないかを調べ、置き換えられない時だけ一覧に項目を足し、振る舞いを番人テストか既存のテストで確かめる。番人テストは、内部の値を読むファイルが一覧の使う箇所にすべて載っていることも確かめる。
- 番人テストは版の変化を知らせるだけで、同じ版の中身の変化は検出しない。版は完全に固定するため、版を変えずに中身が変わることは無いとみなす。

## 版を指定しない追加の禁止

一覧のパッケージを、版を指定せずに追加・更新してはならない。開発者もAIエージェントも同じである。

- 禁止する操作
  - `bun add <パッケージ>`(その時点の`latest`タグの版が`^`付きの範囲で入る)
  - `bun add <パッケージ>@latest`
  - `bun update --latest`(範囲を無視して最新の版へ上げる)
  - `package.json`への`^`・`~`の範囲指定の記述
- 理由
  - 範囲指定のままでは、アプリごとの`bun.lock`が別々の時点で別々の版を解決し、版が食い違う。
  - `latest`タグは通常プレリリース版を指さないため、プレリリース版に固定するパッケージを版の指定なしで追加すると、意図しない古い系列の版が入る。
  - 組み合わせられる版の範囲が狭いパッケージ(Vitest系とWorkersのテストプールなど)は、最新の版にすると動かなくなる。
