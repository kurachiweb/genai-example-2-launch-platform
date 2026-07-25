# オンボーディングガイド — Launch Stadium

本プロジェクトに参加した開発者が、サービス像・仕様・インフラ・データベースを最短で把握し、ローカル環境を立ち上げるための入り口（索引）。

## ローカル開発環境クイックスタート

```zsh
# 1. ホスト環境で実行
brew install --cask docker # Docker 未インストールの場合のみ（Macのみ）
docker compose up -d --build

# 2. コンテナ内: APIサーバーの起動
cd apps/api && wrangler dev
cd apps/public-api && wrangler dev

# 3. コンテナ内: フロントエンドの起動
cd apps/client && bun run dev
cd apps/admin && bun run dev
```

### ローカルポート一覧

| アプリ            | 役割                                          | ポート |
| ----------------- | -------------------------------------------- | ------ |
| WranglerのD1ローカルモード | データベース(Cloudflare D1 のローカル版) | 48040  |
| Valkey            | インメモリストレージ（Cloudflare KV のローカル版） | 48041  |
| `apps/api`        | 内部 API（NestJS / GraphQL）                  | 48042  |
| `apps/public-api` | 公開 API（NestJS / REST）                     | 48043  |
| `apps/client`     | 利用者側フロントエンド（Next.js）                | 48044  |
| `apps/admin`      | 管理者側フロントエンド（Next.js）                | 48045  |
| Mailpit           | メール確認 Web UI                             | 48046  |

ローカルでは D1 の代わりに Wrangler のD1ローカルモード、Cloudflare Email Send の代わりに Mailpit、Cloudflare KV の代わりに Valkey、Cloudflare R2 の代わりに Wrangler のR2ローカルモードを使う。
Mailpit の SMTP（1025）はコンテナ間のみで、ホストには Web UI（48046）だけを公開する。
Valkey はホスト側からのデバッグ用に 48041 を公開することで、`redis-cli -p 48041` 等で接続できる。

## ドキュメント索引

### エージェント・開発支援（`docs/onboardings/`）

| ドキュメント                                 | 内容                                                              |
| -------------------------------------------- | ----------------------------------------------------------------- |
| [agent-extensions.md](./agent-extensions.md) | `.claude/` 配下のスキル・コマンド・ルール・エージェント定義の解説 |
