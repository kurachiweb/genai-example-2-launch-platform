# オンボーディングガイド — Launch Stadium

本プロジェクトに参加した開発者が、サービス像・仕様・インフラ・データベースを最短で把握し、ローカル環境を立ち上げるための入り口(索引)。

## ローカル開発環境クイックスタート

このクイックスタートは開発者向け手順書であり、AIエージェントはこのセクションのコマンドを実行しないこと。

1. ホスト環境: DockerをインストールしてDocker Desktopアプリを開く

   ```zsh
   brew install --cask docker-desktop # Macのみ
   ```

2. ホスト環境: コンテナ・イメージ・ボリュームの作成

   ```zsh
   docker compose up -d
   ```

3. VSCodeでコンテナにアタッチし、`/workspace`ディレクトリを開く
4. コンテナ内: Infisicalアカウントにログインする(初回のみ)

   ```sh
   infisical --telemetry=false login --domain https://eu.infisical.com
   # EUリージョンでログイン後、画面に表示されたトークンをこのターミナルに貼り付ける
   ```

5. コンテナ内: GitHubアカウントにログインする(初回のみ)

   ```sh
   gh auth login --web # HTTPSを選択後、表示されたワンタイムコードをブラウザ画面に貼り付ける
   ```

6. コンテナ内: WranglerをCloudflareアカウントと紐づける(初回のみ)

   ```sh
   wrangler login --device
   wrangler whoami # 認証確認
   ```

7. コンテナ内: Stripeアカウントにログインする(初回のみ)

   ```sh
   stripe login
   stripe whoami # 認証確認
   ```

8. コンテナ内: ルートの依存パッケージをインストール(初回のみ)

   ```sh
   bun install
   /workspace/scripts/setup-chromium.sh # コンテナビルド時はこのスクリプトの実行をスキップしたので、ここでChromiumを`bun install`で解決されたバージョンに合わせて導入
   ```

9. コンテナ内: Claude向けMCPを認証する(初回のみ)

   ```sh
   claude mcp login cloudflare-api --no-browser # Cloudflareにログイン/認証後、「このサイトにアクセスできません」に遷移するのでURLをターミナルに入力する
   claude mcp login cloudflare-bindings --no-browser
   claude mcp login cloudflare-builds --no-browser
   claude mcp login cloudflare-observability --no-browser
   ```

10. コンテナ内: ローカルDBの初期化(マイグレーション適用)

    `apps/api`と`apps/event`は同一の`--persist-to`を指定することで、D1・R2ローカルモードの実データを共有する。そのためマイグレーション適用は`apps/api`側の1回のみでよい。

    ```sh
    cd /workspace/apps/api
    wrangler d1 migrations apply genai-example-2-dev --local --persist-to /workspace/.wrangler/state
    ```

11. コンテナ内: DBスキーマ定義の依存パッケージをインストール(初回のみ)

    ```sh
    cd /workspace/apps/db
    bun install
    ```

12. コンテナ内: アプリケーションの起動

    APIサーバー

    ```sh
    cd /workspace/apps/api
    bun install # 初回のみ
    infisical --telemetry=false run --env dev -- wrangler dev --port 48042 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
    ```

    イベントサーバー

    ```sh
    cd /workspace/apps/event
    bun install # 初回のみ
    infisical --telemetry=false run --env dev -- wrangler dev --port 48043 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
    ```

    利用者側フロントエンド

    ```sh
    cd /workspace/apps/client
    bun install # 初回のみ
    infisical --telemetry=false run --env dev -- bun run dev --port 48044 --host 0.0.0.0
    ```

    管理者側フロントエンド

    ```sh
    cd /workspace/apps/admin
    bun install # 初回のみ
    infisical --telemetry=false run --env dev -- bun run dev --port 48045 --host 0.0.0.0
    ```

    Storybookコンポーネントカタログ

    ```sh
    cd /workspace/apps/frontend-lib
    bun install # 初回のみ
    bun run storybook:dev --port 48046 --host 0.0.0.0
    ```

    利用者側・管理者側各画面モックアップ

    ```sh
    cd /workspace/mockups
    bun install # 初回のみ
    bun run dev --port 48047 --host 0.0.0.0
    ```

13. コンテナ内: デプロイ前動作確認

    ```sh
    # TanStack Startアプリを`@cloudflare/vite-plugin`経由でCloudflare Workers向けにビルドして動作確認(D1・R2のローカル永続化パスはvite.config.tsのpersistStateオプションで指定する)
    cd /workspace/apps/client
    infisical --telemetry=false run --env dev -- bunx vite build
    infisical --telemetry=false run --env dev -- bunx vite preview --port 48044 --host 0.0.0.0

    cd /workspace/apps/admin
    infisical --telemetry=false run --env dev -- bunx vite build
    infisical --telemetry=false run --env dev -- bunx vite preview --port 48045 --host 0.0.0.0
    ```

## ローカルポート一覧

| アプリ              | 役割                                   | ポート |
| ------------------- | -------------------------------------- | ------ |
| Mailpit             | メール確認Web UI・HTTP送信API          | 48041  |
| `apps/api`          | APIサーバー(Hono)                      | 48042  |
| `apps/event`        | イベントサーバー(Hono)                 | 48043  |
| `apps/client`       | 利用者側フロントエンド(TanStack Start) | 48044  |
| `apps/admin`        | 管理者側フロントエンド(TanStack Start) | 48045  |
| `apps/frontend-lib` | Storybookコンポーネントカタログ        | 48046  |
| `mockups`           | 利用者側・管理者側各画面モックアップ   | 48047  |

ローカルではD1の代わりにWranglerのD1ローカルモード、Cloudflare Email Serviceの代わりにMailpit、Cloudflare R2の代わりにWranglerのR2ローカルモードを使う。
