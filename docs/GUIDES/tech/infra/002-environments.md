# 環境種別

アプリを動かす環境の種類と、CloudflareとWrangler、及びシークレット管理サービス(Infisical)で使う環境種別の名前を定める。

## 前提と用語

| 用語               | 意味                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- |
| ローカル環境       | 開発者の手元(開発コンテナなど)で、`wrangler dev`などのローカルモードでアプリを動かす環境 |
| デプロイ先検証環境 | 本番環境へ出す前の確認のために、Cloudflareへデプロイしてアプリを動かす環境               |
| 本番環境           | 利用者に提供するために、Cloudflareへデプロイしてアプリを動かす環境                       |
| 環境種別           | 各ツールで環境を選ぶために指定する名前                                                   |

## デプロイ先の環境種別

CloudflareとWranglerの環境種別は、デプロイ先検証環境を`staging`、本番環境を`prod`とする。

| 環境               | Cloudflare・Wranglerの環境種別 | Wrangler設定での定義場所 |
| ------------------ | ------------------------------ | ------------------------ |
| デプロイ先検証環境 | `staging`                      | `env.staging`            |
| 本番環境           | `prod`                         | `env.prod`               |

- Wrangler設定のデプロイ先ごとの差分は`env.staging`・`env.prod`に書く。
- ローカル環境ではWrangler設定のルート(環境を指定しない設定)を使う。
- Wranglerのコマンドでは`--env staging`・`--env prod`で環境種別を指定する。`@cloudflare/vite-plugin`でビルド・起動するアプリでは、環境変数`CLOUDFLARE_ENV`に環境種別を指定する。

```sh
wrangler deploy --env staging
CLOUDFLARE_ENV=staging vite build
```

## シークレット管理の環境種別

Infisicalの環境種別は、ローカル環境を`dev`、デプロイ先検証環境を`staging`、本番環境を`prod`とする。

| 環境               | Infisicalの環境種別 |
| ------------------ | ------------------- |
| ローカル環境       | `dev`               |
| デプロイ先検証環境 | `staging`           |
| 本番環境           | `prod`              |

- シークレットを注入するコマンドでは、`--env`に環境種別を指定する。

```sh
infisical run --env <環境種別> -- <シークレットを使うコマンド>
```

### 2つの環境種別の対応

ローカル環境には、Cloudflare・Wranglerの環境種別が無く、Infisicalの環境種別`dev`だけがある。デプロイ先検証環境と本番環境では、両者の環境種別は同じ名前になる。

| 環境               | Cloudflare・Wrangler       | Infisical |
| ------------------ | -------------------------- | --------- |
| ローカル環境       | なし(Wrangler設定のルート) | `dev`     |
| デプロイ先検証環境 | `staging`                  | `staging` |
| 本番環境           | `prod`                     | `prod`    |
