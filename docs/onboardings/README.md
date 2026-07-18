# オンボーディングガイド — Launch Stadium

本プロジェクトに参加した開発者が、サービス像・仕様・インフラ・データベースを最短で把握し、ローカル環境を立ち上げるための入り口（索引）。

## ローカル開発環境クイックスタート

```zsh
# 1) 必要なツールのインストール
brew install oven-sh/bun/bun
brew install --cask claude-code
brew install cloudflare-wrangler
brew install gh
brew install rtk
claude
/plugin marketplace add cloudflare/skills
/plugin install cloudflare@cloudflare
```

### ローカルポート一覧

| アプリ            | 役割                                         | ポート |
| ----------------- | -------------------------------------------- | ------ |
| `apps/db`         | DB（SQLite）                                 | 48040  |
| `apps/api`        | 内部 API（NestJS / GraphQL）                 | 48041  |
| `apps/client`     | 利用者・閲覧者 Web（Next.js）                | 48042  |
| `apps/admin`      | 管理者コンソール（Next.js）                  | 48043  |
| `apps/public-api` | 公開 API（NestJS / REST）                    | 48044  |
| Mailpit           | メール確認 Web UI                            | 48045  |
| Valkey            | ログインセッション（Cloudflare KV の代わり） | 48046  |

- ローカルでは D1 の代わりに wrangler のD1ローカルモード、Amazon SES の代わりに Mailpit、Cloudflare KV の代わりに Valkey を使う。Mailpit の SMTP（1025）はコンテナ間のみで、ホストには Web UI（48045）だけを公開する。Valkey はホスト側からのデバッグ用に 48046 を公開する（`redis-cli -p 48046` 等で接続可能）。

## ドキュメント索引

### エージェント・開発支援（`docs/onboardings/`）

| ドキュメント                                 | 内容                                                              |
| -------------------------------------------- | ----------------------------------------------------------------- |
| [agent-extensions.md](./agent-extensions.md) | `.claude/` 配下のスキル・コマンド・ルール・エージェント定義の解説 |
