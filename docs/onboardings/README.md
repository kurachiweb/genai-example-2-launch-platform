# オンボーディングガイド — Launch Stadium

本プロジェクトに参加した開発者が、サービス像・仕様・インフラ・データベースを最短で把握し、ローカル環境を立ち上げるための入り口（索引）。

## ローカル開発環境クイックスタート

```zsh
# 1. ホスト環境で実行
brew install --cask docker-desktop # Macのみ
brew install docker # Linuxのみ
docker compose up -d --build

# 2. コンテナ内: CloudflareにOAuthでログインする
wrangler login --callback-host 0.0.0.0
wrangler whoami # 認証確認

# 3. コンテナ内: APIサーバーの起動
# ローカルでは、`wrangler dev`コマンドでapiアプリと共に起動されたDBやストレージに、public-apiアプリもアクセスする
cd apps/api && wrangler dev --port 48042 --ip 0.0.0.0
cd apps/public-api && bun run dev

# 4. コンテナ内: フロントエンドの起動
cd apps/client && bun run dev
cd apps/admin && bun run dev
```

### ローカルポート一覧

| アプリ              | 役割                                               | ポート |
| ------------------- | -------------------------------------------------- | ------ |
| Valkey              | インメモリストレージ（Cloudflare KV のローカル版） | 48040  |
| Mailpit             | メール確認 Web UI                                  | 48041  |
| `apps/api`          | 内部 API（NestJS / GraphQL）                       | 48042  |
| `apps/public-api`   | 公開 API（NestJS / REST）                          | 48043  |
| `apps/client`       | 利用者側フロントエンド（Next.js）                  | 48044  |
| `apps/admin`        | 管理者側フロントエンド（Next.js）                  | 48045  |
| `apps/frontend-lib` | Storybookフロントエンド（Next.js）                 | 48046  |
| Wrangler            | `wrangler login` の OAuth コールバック受信         | 8976   |

ローカルでは D1 の代わりに Wrangler のD1ローカルモード、Amazon SES の代わりに Mailpit、Cloudflare KV の代わりに Valkey、Cloudflare R2 の代わりに Wrangler のR2ローカルモードを使う。
Wrangler の OAuth コールバックだけは、`redirect_uri` が `http://localhost:8976/oauth/callback` に固定されており変更できないため、他のポート番号と連続していない。
Valkey はホスト側からのデバッグ用に 48040 を公開することで、`redis-cli -p 48040` 等で接続できる。
Mailpit の SMTP（1025）はコンテナ内のみで到達可能で、ローカル開発ではメール送信処理がこの1025番ポートへSMTP接続し、送信結果は48041番のWeb UIで確認する。

## ドキュメント索引

### エージェント・開発支援（`docs/onboardings/`）

| ドキュメント                                 | 内容                                                              |
| -------------------------------------------- | ----------------------------------------------------------------- |
| [agent-extensions.md](./agent-extensions.md) | `.claude/` 配下のスキル・コマンド・ルール・エージェント定義の解説 |
