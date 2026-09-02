# オンボーディングガイド — Launch Stadium

本プロジェクトに参加した開発者が、サービス像・仕様・インフラ・データベースを最短で把握し、ローカル環境を立ち上げるための入り口(索引)。

## ローカル開発環境クイックスタート

このクイックスタートはAIエージェント向けではなく、開発者向け手順書である。

1. ホスト環境: DockerをインストールしてDocker Desktopアプリを開く

   ```zsh
   brew install --cask docker-desktop # Macのみ
   ```

2. ホスト環境: コンテナ・イメージ・ボリュームの作成

   ```zsh
   docker compose up -d
   ```

3. VSCodeでコンテナにアタッチし、`/workspace`ディレクトリを開く
4. コンテナ内: Infisicalアカウントにログインする

   ```sh
   infisical --telemetry=false login
   # EUリージョンでログイン後、画面に表示されたトークンをこのターミナルに貼り付ける
   ```

5. コンテナ内: GitHubアカウントにログインする

   ```sh
   gh auth login --web # HTTPSを選択後、表示されたワンタイムコードをブラウザ画面に貼り付ける
   ```

6. コンテナ内: WranglerをCloudflareアカウントと紐づける(初回のみ)

   ```sh
   wrangler login --device
   wrangler whoami # 認証確認
   ```

7. コンテナ内: ルートの依存パッケージをインストール(初回のみ)

   ```sh
   bun install
   /workspace/scripts/setup-chromium.sh # コンテナビルド時はこのスクリプトの実行をスキップしたので、ここでChromiumを`bun install`で解決されたバージョンに合わせて導入
   ```

8. コンテナ内: Claude向けMCPを認証する(初回のみ)

   ```sh
   claude
   /mcp # 上下キーで「△ needs authentication」と表示されるMCP項目を見つけ、Enterキーで認証していく
   ```

9. コンテナ内: ローカルDBの初期化(マイグレーション適用)

   `apps/api`と`apps/public-api`は同一の`--persist-to`を指定することで、D1・R2ローカルモードの実データを共有する。そのためマイグレーション適用は`apps/api`側の1回のみでよい。

   ```sh
   cd /workspace/apps/api
   wrangler d1 migrations apply genai-example-2-dev --local --persist-to /workspace/.wrangler/state
   ```

10. コンテナ内: MikroORMアプリの事前コンパイル

    `apps/api`と`apps/public-api`のアプリケーションをworkerdランタイム上で動作させるため、MikroORMアプリを事前コンパイルして`new Function`呼び出しを回避する。

    ```sh
    cd /workspace/apps/db
    bun install # 初回のみ
    bun run mikro-orm:generate # mikro-orm cache:generate --combined
    bun run mikro-orm:compile # mikro-orm compile
    ```

11. コンテナ内: アプリケーションの起動

    内部APIサーバー

    ```sh
    cd /workspace/apps/api
    bun install # 初回のみ
    infisical --telemetry=false run --env=dev -- wrangler dev --port 48042 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
    ```

    公開APIサーバー

    ```sh
    cd /workspace/apps/public-api
    bun install # 初回のみ
    infisical --telemetry=false run --env=dev -- wrangler dev --port 48043 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
    ```

    利用者側フロントエンド

    ```sh
    cd /workspace/apps/client
    bun install # 初回のみ
    infisical --telemetry=false run --env=dev -- bun run dev --port 48044 --host 0.0.0.0
    ```

    管理者側フロントエンド

    ```sh
    cd /workspace/apps/admin
    bun install # 初回のみ
    infisical --telemetry=false run --env=dev -- bun run dev --port 48045 --host 0.0.0.0
    ```

    Storybookコンポーネントカタログ

    ```sh
    cd /workspace/apps/frontend-lib
    bun install # 初回のみ
    bun run storybook:dev --port 48046 --host 0.0.0.0
    ```

12. コンテナ内: デプロイ前動作確認

    ```sh
    # TanStack Startアプリを`@cloudflare/vite-plugin`経由でCloudflare Workers向けにビルドして動作確認(D1・R2のローカル永続化パスはvite.config.tsのpersistStateオプションで指定する)
    cd /workspace/apps/client
    NODE_ENV=production infisical --telemetry=false run --env=dev -- bunx vite build
    NODE_ENV=production infisical --telemetry=false run --env=dev -- bunx vite preview --port 48044 --host 0.0.0.0

    cd /workspace/apps/admin
    NODE_ENV=production infisical --telemetry=false run --env=dev -- bunx vite build
    NODE_ENV=production infisical --telemetry=false run --env=dev -- bunx vite preview --port 48045 --host 0.0.0.0
    ```

### ローカルポート一覧

| アプリ              | 役割                                   | ポート |
| ------------------- | -------------------------------------- | ------ |
| Mailpit             | メール確認Web UI・HTTP送信API          | 48041  |
| `apps/api`          | 内部APIサーバー(Hono / GraphQL)        | 48042  |
| `apps/public-api`   | 公開APIサーバー(Hono / REST)           | 48043  |
| `apps/client`       | 利用者側フロントエンド(TanStack Start) | 48044  |
| `apps/admin`        | 管理者側フロントエンド(TanStack Start) | 48045  |
| `apps/frontend-lib` | Storybookコンポーネントカタログ        | 48046  |

ローカルではD1の代わりにWranglerのD1ローカルモード、Cloudflare Email Serviceの代わりにMailpit、Cloudflare R2の代わりにWranglerのR2ローカルモードを使う。

## ドキュメント索引

### サービス仕様(ルートディレクトリ)

| ドキュメント                 | 内容                                                 |
| ---------------------------- | ---------------------------------------------------- |
| [README.md](../../README.md) | サービス概要、ソフトウェア要件定義書(IEEE 29148準拠) |

### エージェント・開発支援(`docs/onboardings/`)

| ドキュメント                                   | 内容                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [claude-extensions.md](./claude-extensions.md) | `.claude/`配下のスキル・コマンド・ルール・エージェント定義の解説 |
| [tech-stack.md](./tech-stack.md)               | 技術選定(データベース・バックエンド・フロントエンド・インフラ等) |

### AIエージェント向け外部ガイドライン(`docs/ai-extensions/`)

| ドキュメント                                                                  | 内容                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [tanstack-agent-guidelines.md](../ai-extensions/tanstack-agent-guidelines.md) | TanStack系ツールを扱うAIエージェント向けガイドライン(外部リポジトリ由来) |
