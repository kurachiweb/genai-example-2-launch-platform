# 本プロジェクト固有の値

[技術ドキュメント](../GUIDES/tech/README.md)は他のプロジェクトへ丸写しできるよう、本プロジェクト固有の値をプレースホルダーや一般的な呼び方で書いている。本文書は、それらに当てはまる本プロジェクトの値をまとめる。技術ドキュメントの手順やコマンドを本プロジェクトで使うときは、本文書の値に読み替える。

## 技術ドキュメントの表記と本プロジェクトの値

| 技術ドキュメントでの表記                                     | 本プロジェクトの値                                                                                            | 記載している見出し                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<ローカル状態の保存先>`                                     | `/workspace/.wrangler/state`                                                                                  | [ローカル状態の永続化と共有](../GUIDES/tech/infra/001-wrangler-conventions.md#ローカル状態の永続化と共有)・[Wranglerのローカル状態への接続](../GUIDES/tech/frontend/002-tanstack-start-on-workers.md#wranglerのローカル状態への接続)・[マイグレーションの生成と適用](../GUIDES/tech/db/001-drizzle-migrations-on-d1.md#マイグレーションの生成と適用) |
| `<互換性日付>`                                               | `2026-08-04`                                                                                                  | [互換性日付](../GUIDES/tech/infra/001-wrangler-conventions.md#互換性日付)                                                                                                                                                                                                                                                                            |
| `<マイグレーションの保存先>`                                 | `apps/db/migrations`(`apps/api`・`apps/event`のWrangler設定からは、共有ディレクトリの配置先の`db/migrations`) | [マイグレーションの検出設定](../GUIDES/tech/db/001-drizzle-migrations-on-d1.md#マイグレーションの検出設定)                                                                                                                                                                                                                                           |
| ルートの`bunfig.toml`(単体テストの共通設定)                  | `/workspace/bunfig.toml`                                                                                      | [アプリで単体テストを実行するときの共通設定の指定](../GUIDES/tech/testing/001-test-strategy.md#アプリで単体テストを実行するときの共通設定の指定)                                                                                                                                                                                                     |
| `infisical run --env <環境種別> -- <コマンド>`(ローカル環境) | `infisical --telemetry=false run --env dev -- <コマンド>`                                                     | [シークレットの注入](../GUIDES/tech/security/001-secret-management.md#シークレットの注入)・[シークレット管理の環境種別](../GUIDES/tech/infra/002-environments.md#シークレット管理の環境種別)・[環境シークレットの注入](../GUIDES/tech/testing/001-test-strategy.md#環境シークレットの注入)                                                           |
| `<共有Chromiumのパスを示す環境変数>`                         | `CHROMIUM_PATH`                                                                                               | [テスト戦略の前提と用語](../GUIDES/tech/testing/001-test-strategy.md#前提と用語)・[E2Eテストツールの版の更新手順の前提と用語](../GUIDES/tech/testing/002-browser-tool-versions.md#前提と用語)                                                                                                                                                        |
| 開発コンテナのイメージ定義                                   | `Dockerfile`                                                                                                  | [同期すべき4箇所](../GUIDES/tech/testing/002-browser-tool-versions.md#同期すべき4箇所)                                                                                                                                                                                                                                                               |
| MCPサーバーの設定                                            | `.mcp.json`                                                                                                   | [同期すべき4箇所](../GUIDES/tech/testing/002-browser-tool-versions.md#同期すべき4箇所)                                                                                                                                                                                                                                                               |

## ローカル状態の保存先と共有するアプリ

WranglerのD1・R2ローカルモードの実データは`/workspace/.wrangler/state`に置く。このディレクトリはGit管理に含めない。

- `--persist-to`を持つWranglerのコマンドには`--persist-to /workspace/.wrangler/state`を付け、D1・R2系のコマンドではさらに`--local`を付ける。

```sh
wrangler dev --persist-to /workspace/.wrangler/state
wrangler d1 migrations apply <データベース名> --local --persist-to /workspace/.wrangler/state
```

- 次のアプリが、このローカル状態を共有する。

| アプリ                      | 起動方法                                                  | 保存先の指定                                                                             |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/api`・`apps/event`    | `wrangler dev`                                            | `--persist-to /workspace/.wrangler/state`                                                |
| `apps/client`・`apps/admin` | `@cloudflare/vite-plugin`による`vite dev`・`vite preview` | `vite.config.ts`の`cloudflare({ persistState: { path: '/workspace/.wrangler/state' } })` |

- `apps/api`と`apps/event`のWrangler設定では、`database_id`・R2のバケット名(`bucket_name`)、及び`wrangler dev`が優先して使う`preview_database_id`・`preview_id`・`preview_bucket_name`を、両アプリで同一の値にする。

## 互換性日付

全アプリのWrangler設定(`@cloudflare/vite-plugin`でビルドする`apps/client`・`apps/admin`を含む)で、`compatibility_date`を`2026-08-04`と定義する。この日付では、互換性フラグ`nodejs_compat`・`nodejs_compat_v2`が自動で有効になる。

## 単体テストの設定ファイル

単体テスト(Bun)の共通設定ファイルは`/workspace/bunfig.toml`である。ルート(`/workspace`)以外のディレクトリで`bun test`を実行する場合は、`--config=/workspace/bunfig.toml`を明示する。

```sh
cd /workspace/apps/api
bun test --config=/workspace/bunfig.toml unit.test
```

- 各アプリの`package.json`の`test:unit`スクリプトでは、アプリのディレクトリからの相対パス`--config=../../bunfig.toml`で指定する([スクリプト契約](../GUIDES/tech/coding/001-javascript-typescript-conventions.md#スクリプト契約))。

## シークレット注入の実行接頭辞

ローカル環境でシークレットを使うコマンド(`bun run dev`・`wrangler dev`・`vite build`など)は、先頭に`infisical --telemetry=false run --env dev -- `を付けて実行する。

```sh
infisical --telemetry=false run --env dev -- bun run dev
```

- `--telemetry=false`は、本プロジェクトで`infisical`のすべてのコマンドに付ける共通のオプションである。
- `dev`は、ローカル環境のInfisicalの環境種別である。デプロイ先検証環境は`staging`、本番環境は`prod`を指定する。

## 共有Chromium

| 項目                                                     | 値                              | 定義場所            |
| -------------------------------------------------------- | ------------------------------- | ------------------- |
| 共有Chromiumのパスを示す環境変数                         | `CHROMIUM_PATH`                 | `Dockerfile`の`ENV` |
| `CHROMIUM_PATH`の値(実行ファイルへのシンボリックリンク)  | `/opt/ms-playwright-bin/chrome` | `Dockerfile`の`ENV` |
| Playwrightのブラウザの導入先(`PLAYWRIGHT_BROWSERS_PATH`) | `/opt/ms-playwright`            | `Dockerfile`の`ENV` |

- コンテナの起動時に、`scripts/entrypoint.sh`が`/workspace/scripts/setup-chromium.sh`を実行する。このスクリプトが、ルートの`@playwright/test`の版に合わせて共有Chromiumを導入し、`CHROMIUM_PATH`のシンボリックリンクを張り直す。技術ドキュメントの「コンテナの起動時にこの処理を行う仕組み」は、このスクリプトを指す。
- `CHROMIUM_PATH`は、`config/vitest/browser.ts`の`resolveBrowserLaunchOptions`(ブラウザテストと、`playwright.config.ts`によるE2Eテスト)と、`.mcp.json`の`chrome-devtools`・`playwright`の両MCPサーバーの引数`${CHROMIUM_PATH}`が読む。

## E2Eテストツール関連の4箇所

Playwrightを更新するときに同期すべき4箇所(「[同期すべき4箇所](../GUIDES/tech/testing/002-browser-tool-versions.md#同期すべき4箇所)」)は、本プロジェクトでは次のファイルと項目である。

| 技術ドキュメントでの箇所                                                      | ファイルと項目                                                                 | 役割                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 開発コンテナのイメージ定義にある、OS依存パッケージを導入するPlaywrightの版 | `Dockerfile`の`PLAYWRIGHT_VERSION`(`ARG`)                                      | 共有Chromiumの導入用OS依存パッケージを導入する                                                                                                            |
| 2. ルートの`package.json`の`@playwright/test`の版                             | `/workspace/package.json`の`devDependencies`の`@playwright/test`               | 実際に使う共有Chromium本体のバージョンを決定する。`.mcp.json`の両MCPサーバーは`CHROMIUM_PATH`経由でこれを共有利用する                                     |
| 3. MCPサーバーの設定にある`chrome-devtools-mcp`の版                           | `.mcp.json`の`mcpServers.chrome-devtools.args`にある`chrome-devtools-mcp@<版>` | 同梱する`puppeteer-core`のChrome DevTools Protocol対応バージョンを共有Chromiumに合わせる。実起動で動作確認する                                            |
| 4. MCPサーバーの設定にある`@playwright/mcp`の版                               | `.mcp.json`の`mcpServers.playwright.args`にある`@playwright/mcp@<版>`          | 同梱する`playwright-core`のChromiumリビジョンを共有Chromiumに合わせる。リビジョン番号が一致しない場合は最も近いリビジョンを選択する。実起動で動作確認する |
