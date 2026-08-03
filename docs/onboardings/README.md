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
wrangler login --callback-host 0.0.0.0 --browser false
wrangler whoami # 認証確認
```

5. コンテナ内: Claude向けMCPを認証する(初回のみ)

```sh
claude
/mcp # 上下キーで「△ needs authentication」と表示されるMCP項目を見つけ、Enterキーで認証していく
```

6. コンテナ内: プロジェクトルートアプリのインストール

Playwrightやchrome-devtools MCP等を利用できるようにする。

```sh
bun install # 初回のみ
```

7. コンテナ内: APIサーバーの起動

両アプリで同一の`--persist-to`を指定することで、D1・KV・R2ローカルモードの実データを共有する。

```sh
cd apps/api
bun install # 初回のみ
infisical --telemetry=false run --env=dev -- wrangler dev --port 48042 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
```

```sh
cd apps/public-api
bun install # 初回のみ
infisical --telemetry=false run --env=dev -- wrangler dev --port 48043 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
```

8. コンテナ内: フロントエンドの起動

```sh
cd apps/client
bun install # 初回のみ
infisical --telemetry=false run --env=dev -- bun run dev --port 48044 --hostname 0.0.0.0
```

```sh
cd apps/admin
bun install # 初回のみ
infisical --telemetry=false run --env=dev -- bun run dev --port 48045 --hostname 0.0.0.0
```

9. コンテナ内: Storybookの起動

```sh
cd apps/frontend-lib
bun install # 初回のみ
bun run storybook:dev --port 48046 --host 0.0.0.0
```

### ローカルポート一覧

| アプリ              | 役割                                    | ポート |
| ------------------- | --------------------------------------- | ------ |
| Mailpit             | メール確認Web UI                        | 48041  |
| `apps/api`          | 内部API(NestJS / GraphQL)               | 48042  |
| `apps/public-api`   | 公開API(NestJS / REST)                  | 48043  |
| `apps/client`       | 利用者側フロントエンド(Next.js)         | 48044  |
| `apps/admin`        | 管理者側フロントエンド(Next.js)         | 48045  |
| `apps/frontend-lib` | Storybookフロントエンド(Next.js)        | 48046  |
| Wrangler            | `wrangler login`のOAuthコールバック受信 | 8976   |

ローカルではD1の代わりにWranglerのD1ローカルモード、Cloudflare Workers KVの代わりにWranglerのKVローカルモード、Cloudflare Email Serviceの代わりにMailpit、Cloudflare R2の代わりにWranglerのR2ローカルモードを使う。
WranglerのOAuthコールバックだけは、Cloudflareログイン後のリダイレクト先が`http://localhost:8976/oauth/callback`に固定されており、それは`--callback-port`でも変更できないため、他のポート番号と連続していない。
MailpitのSMTP(1025)はコンテナ内のみで到達可能で、ローカル開発ではメール送信処理がこの1025番ポートへSMTP接続し、送信結果は48041番のWeb UIで確認する。

## ドキュメント索引

### エージェント・開発支援(`docs/onboardings/`)

| ドキュメント                                   | 内容                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [claude-extensions.md](./claude-extensions.md) | `.claude/`配下のスキル・コマンド・ルール・エージェント定義の解説 |
| [tech-stack.md](./tech-stack.md)               | 技術選定(データベース・バックエンド・フロントエンド・インフラ等) |
