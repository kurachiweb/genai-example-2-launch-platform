# オンボーディングガイド — Launch Stadium

本プロジェクトに参加した開発者が、サービス像・仕様・インフラ・データベースを最短で把握し、ローカル環境を立ち上げるための入り口(索引)。

## ローカル開発環境クイックスタート

1. ホスト環境: Dockerのインストール及び環境の作成

```zsh
brew install --cask docker-desktop # Macのみ
docker compose up -d
```

2. VSCodeでコンテナにアタッチする
3. コンテナ内: Infisicalアカウントにログインする

```sh
infisical --telemetry=false login
# EUリージョンでログイン後、画面に表示されたトークンをこのターミナルに貼り付ける
```

4. コンテナ内: WranglerをCloudflareアカウントと紐づける(初回のみ)

```sh
wrangler login --device
wrangler whoami # 認証確認
```

5. コンテナ内: ルートの依存パッケージをインストール(初回のみ)

```sh
bun install
scripts/setup-chromium.sh # Chromiumを`bun install`で解決されたバージョンに合わせて導入
```

6. コンテナ内: Claude向けMCPを認証する(初回のみ)

```sh
claude
/mcp # 上下キーで「△ needs authentication」と表示されるMCP項目を見つけ、Enterキーで認証していく
```

7. コンテナ内: ローカルDBの初期化(マイグレーション適用)

`apps/api`と`apps/public-api`は同一の`--persist-to`を指定することで、D1・KV・R2ローカルモードの実データを共有する。そのためマイグレーション適用は`apps/api`側の1回のみでよい。

```sh
cd apps/api
wrangler d1 migrations apply genai-example-2-dev --local --persist-to /workspace/.wrangler/state
```

8. コンテナ内: アプリケーションの起動

内部APIサーバー

```sh
cd apps/api
bun install # 初回のみ
infisical --telemetry=false run --env=dev -- wrangler dev --port 48042 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
```

公開APIサーバー

```sh
cd apps/public-api
bun install # 初回のみ
infisical --telemetry=false run --env=dev -- wrangler dev --port 48043 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
```

利用者側フロントエンド

```sh
cd apps/client
bun install # 初回のみ
infisical --telemetry=false run --env=dev -- bun run dev --port 48044 --host 0.0.0.0
```

管理者側フロントエンド

```sh
cd apps/admin
bun install # 初回のみ
infisical --telemetry=false run --env=dev -- bun run dev --port 48045 --host 0.0.0.0
```

Storybookコンポーネントカタログ

```sh
cd apps/frontend-lib
bun install # 初回のみ
bun run storybook:dev --port 48046 --host 0.0.0.0
```

9. コンテナ内: デプロイ前動作確認

```sh
cd apps/db
bun install # 初回のみ
# Cloudflare Workers上でも動作する形式でMikroORMアプリをビルド
bun run mikro-orm:generate # mikro-orm cache:generate --combined
bun run mikro-orm:compile # mikro-orm compile

# TanStack Startアプリを`@cloudflare/vite-plugin`経由でCloudflare Workers向けにビルドして動作確認(D1・KV・R2のローカル永続化パスはvite.config.tsのpersistStateオプションで指定済み)
cd ../client
NODE_ENV=production infisical --telemetry=false run --env=dev -- bunx vite build
NODE_ENV=production infisical --telemetry=false run --env=dev -- bunx vite preview --port 48044 --host 0.0.0.0

cd ../admin
NODE_ENV=production infisical --telemetry=false run --env=dev -- bunx vite build
NODE_ENV=production infisical --telemetry=false run --env=dev -- bunx vite preview --port 48045 --host 0.0.0.0
```

### ローカルポート一覧

| アプリ              | 役割                                    | ポート |
| ------------------- | --------------------------------------- | ------ |
| Mailpit             | メール確認Web UI                        | 48041  |
| `apps/api`          | 内部APIサーバー(Hono / GraphQL)         | 48042  |
| `apps/public-api`   | 公開APIサーバー(Hono / REST)            | 48043  |
| `apps/client`       | 利用者側フロントエンド(TanStack Start)  | 48044  |
| `apps/admin`        | 管理者側フロントエンド(TanStack Start)  | 48045  |
| `apps/frontend-lib` | Storybookコンポーネントカタログ         | 48046  |

ローカルではD1の代わりにWranglerのD1ローカルモード、Cloudflare Workers KVの代わりにWranglerのKVローカルモード、Cloudflare Email Serviceの代わりにMailpit、Cloudflare R2の代わりにWranglerのR2ローカルモードを使う。
MailpitのSMTP(1025)はコンテナ内のみで到達可能で、ローカル開発ではメール送信処理がこの1025番ポートへSMTP接続し、送信結果は48041番のWeb UIで確認する。

## ドキュメント索引

### エージェント・開発支援(`docs/onboardings/`)

| ドキュメント                                   | 内容                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [claude-extensions.md](./claude-extensions.md) | `.claude/`配下のスキル・コマンド・ルール・エージェント定義の解説 |
| [tech-stack.md](./tech-stack.md)               | 技術選定(データベース・バックエンド・フロントエンド・インフラ等) |

### AIエージェント向け外部ガイドライン(`docs/ai-extensions/`)

| ドキュメント                                                                  | 内容                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [tanstack-agent-guidelines.md](../ai-extensions/tanstack-agent-guidelines.md) | TanStack系ツールを扱うAIエージェント向けガイドライン(外部リポジトリ由来) |
