# オンボーディングガイド — Launch Stadium

本プロジェクトに参加した開発者が、サービス像・仕様・インフラ・データベースを最短で把握し、ローカル環境を立ち上げるための入り口（索引）。

## ローカル開発環境クイックスタート

1. ホスト環境: Dockerのインストール及び環境の作成

```zsh
brew install --cask docker-desktop # Macのみ
docker compose up -d
```

2. VSCodeでコンテナにアタッチする
3. コンテナ内: CloudflareにOAuthでログインする（初回のみ）

```sh
wrangler login --callback-host 0.0.0.0 --browser false
wrangler whoami # 認証確認
```

4. Claude向けMCPを認証する（初回のみ）

```sh
claude
/mcp # 上下キーで「△ needs authentication」と表示されるMCP項目を見つけ、Enterキーで認証していく
```

5. コンテナ内: APIサーバーの起動

両アプリで同一の`--persist-to`を指定することで、D1・R2ローカルモードの実データを共有する

```sh
cd apps/api && wrangler dev --port 48042 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
```

```sh
cd apps/public-api && wrangler dev --port 48043 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
```

6. コンテナ内: フロントエンドの起動

```sh
cd apps/client && bun run dev
cd apps/admin && bun run dev
```

### ローカルポート一覧

| アプリ              | 役割                                       | ポート |
| ------------------- | ------------------------------------------ | ------ |
| Mailpit             | メール確認 Web UI                          | 48041  |
| `apps/api`          | 内部 API（NestJS / GraphQL）               | 48042  |
| `apps/public-api`   | 公開 API（NestJS / REST）                  | 48043  |
| `apps/client`       | 利用者側フロントエンド（Next.js）          | 48044  |
| `apps/admin`        | 管理者側フロントエンド（Next.js）          | 48045  |
| `apps/frontend-lib` | Storybookフロントエンド（Next.js）         | 48046  |
| Wrangler            | `wrangler login` の OAuth コールバック受信 | 8976   |

ローカルでは D1 の代わりに Wrangler のD1ローカルモード、Cloudflare Workers KV の代わりに Wrangler のKVローカルモード、Amazon SES の代わりに Mailpit、Cloudflare R2 の代わりに Wrangler のR2ローカルモードを使う。
Wrangler の OAuth コールバックだけは、`redirect_uri` が `http://localhost:8976/oauth/callback` に固定されており変更できないため、他のポート番号と連続していない。
Mailpit の SMTP（1025）はコンテナ内のみで到達可能で、ローカル開発ではメール送信処理がこの1025番ポートへSMTP接続し、送信結果は48041番のWeb UIで確認する。

## ドキュメント索引

### エージェント・開発支援（`docs/onboardings/`）

| ドキュメント                                 | 内容                                                              |
| -------------------------------------------- | ----------------------------------------------------------------- |
| [agent-extensions.md](./agent-extensions.md) | `.claude/` 配下のスキル・コマンド・ルール・エージェント定義の解説 |
