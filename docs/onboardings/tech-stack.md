# 主な技術選定

それぞれ最新バージョンを用いる。

## データベース

- SQLデータベース
  - ローカル環境 ... WranglerのD1ローカルモード(`wrangler dev --persist-to` / `wrangler d1 execute --local --persist-to`)
  - デプロイ先 ... Cloudflare D1
- キーバリュー型データベース
  - ローカル環境 ... WranglerのKVローカルモード(`wrangler dev --persist-to`) ... namespace追加時は`wrangler kv namespace create <name> --preview`でプレビュー用IDを発行する
  - デプロイ先 ... Cloudflare Workers KV

## バックエンド(API)

### フレームワーク

- Hono
- TypeScript

### 依存性注入(DI)

- Inversify

### スキーマ

- GraphQL
- GraphQL Yoga
- DataLoader(GraphQLのN+1問題対策)

### ORM

- MikroORM(Workers向けに事前コンパイル、`createKyselyDialect()`をD1ダイアレクトへ差し替えた独自Connectionを使用)
- Kysely(クエリビルダ)

### 認証・認可

- `HttpOnly`・`Secure`・`SameSite`属性付きCookieによるユーザー認証
- ロールベースのアクセス制御
- 所有権ベースのアクセス制御(自ユーザー・全ユーザー・管理者)

### バリデーション・変換

- Zod
- @hono/zod-validator

### メールアドレス検証

- [DISIFY API](https://docs.disify.com/guide/introduction.html) ... 使い捨てメールアドレスの判定

## フロントエンド

### フレームワーク

- TanStack Start(ルーティングはTanStack Router)
- @cloudflare/vite-plugin
- React
- TypeScript

### スキーマ

- GraphQL Code Generator(client-presetによりクエリからTypedDocumentNodeと型を生成)

### 状態管理・データフェッチング

- TanStack Query(サーバー状態のキャッシュ・データフェッチング、TypedDocumentNodeを`fetch`で送信)
- `@tanstack/react-router-ssr-query`(TanStack RouterとのSSR連携)
- Jotai(クライアント状態管理)

### UI・スタイリング

- Tailwind CSS
- shadcn/ui

### フォーム・バリデーション

- React Hook Form
- Zod

## 決済サービス

- Stripe(優先の決済処理基盤、[ドキュメント](https://docs.stripe.com))
  - Stripe Node.js SDK(APIサーバー側で使用)
  - Stripe Checkout Sessions API(決済セッションの管理)
  - Stripe Webhooks(都度支払いや定期課金イベントの受信)
  - React Stripe.js SDK及びPayment Element(決済ページの埋め込み)
- Creem(二番手の決済処理基盤、[ドキュメント](https://docs.creem.io)) ... Stripeがプラットフォーム障害やアカウントBAN等の理由で利用できない場合のフォールバックとして採用
  - Creem Checkout(Creemサーバー上の決済ページ)
  - Creem Webhooks(都度支払いや定期課金イベントの受信、APIサーバー側で処理)
  - Creem TypeScript SDK

## CI/CD

main/prodブランチへのプルリクエストをトリガーにして、GitHub Actionsにより検査フェーズを実行する。
main/prodブランチへのプッシュをトリガーにして、GitHub Actionsにより検査フェーズ及びデプロイフェーズを実行する。

- 検査フェーズ ... 各段階のいずれかが失敗すれば後続タスクを実行せずに中止
  - TruffleHogによるシークレット検出
  - Bunによるパッケージインストール及び既知の脆弱性確認
  - フォーマット検証
  - Lintチェック
  - tscによる型チェック
  - 単体テスト、Cloudflare Workers統合テスト、E2Eテスト、及びカバレッジ閾値チェック(テスト成功かつカバレッジ目標達成なら続行)
- デプロイフェーズ
  - OpenTofuによるインフラ構成変更(Wranglerの担当範囲を除く)
  - WranglerによるDBマイグレーション
  - Wranglerによる各Workerのビルド・デプロイ(`--secrets-file`で環境シークレットを同時反映)

## デプロイ先のインフラ構成

### アプリケーション実行環境

- Cloudflare Workers

### ストレージ

- ファイルストレージ
  - ローカル環境 ... WranglerのR2ローカルモード(`wrangler dev --persist-to` / `wrangler r2 *** --local --persist-to`)
  - デプロイ先 ... Cloudflare R2

### 画像配信

- Cloudflare Images(R2に保存した画像をリサイズ・フォーマット変換・Exif削除)

### 実行環境のセキュリティ

専用の有償セキュリティ基盤は用いず、Cloudflareのプラットフォーム標準機能と既存ツールを重ねて多層防御を構成する。
厳密なレート制限カウントにはDurable Objects及びHono向け自前レート制限ミドルウェアを使うが、その設定の範囲内で単一Cloudflareロケーションに高頻度リクエストがなされる場合を考慮し、Rate limiterバインディングでも防御する。

- Cloudflare Durable Objects(SQLiteストレージ)
- WorkerごとのRate limiterバインディング(Cloudflareロケーション×設定閾値のレート制限、閾値はWranglerで管理)
- Cloudflare WAF

### bot対策・不正防止

- Cloudflare Turnstile(ウィジェット埋め込み及びAPIサーバー側でのsiteverify検証)

### メール

- メール送信
  - ローカル環境 ... Mailpit
  - デプロイ先 ... Cloudflare Email ServiceのEmail Sending
- JSX email(HTMLメールコード生成、[ドキュメント](https://jsx.email/docs/introduction))

### 画像モデレーション

ローカル環境やCIプロセスでは、テスト結果を毎回同じにするため決定論的スタブの偽判定器を使用する。

- Amazon Rekognition(SigV4署名リクエストの生成に`aws4fetch`を使用)

### ロギング

- LogTape(構造化ログ出力)
- Cloudflare Workers Logs(出力されたログの保持・閲覧)

### モニタリング

- Sentry(レスポンスタイム計測やエラートラッキング、`@sentry/tanstackstart-react`、`@sentry/hono`及び`@sentry/cloudflare`を使用)
- Cloudflare Web Analytics(ユーザーの傾向・利用状況分析ダッシュボード)
- FlareWarden(外部ステータスページ・死活監視)

## 開発環境・ツール

### コンテナ(ローカル環境のみ)

- Docker + Docker Compose

### パッケージマネージャー

- Bun

### AIエージェント向けトークン節約プロキシ

- RTK ... Claude Codeが発行する特定のBashコマンドを`rtk`経由に書き換えてコマンド出力のトークン量を削減する

### コード品質

- ESLint + Prettier
- Husky + lint-staged(`pre-commit`フック)
- Commitlint(コミットメッセージ規約)

### 開発プロセスのセキュリティ

- Betterleaks(シークレット検出、`pre-commit`フック駆動でコマンドオプション`--staged`を添える)
- TruffleHog(シークレット検出、CIプロセスでのみ使用)

### シークレット管理

- Infisical(Freeプラン)

### テスト

- Bun(ロジック層の単体テスト、`bun test`コマンドを使用)
- Vitest + Vitest Browser Mode(DOM・コンポーネントテスト、フロントエンド)
- vitest-browser-react(フロントエンド、Vitest Browser Mode上で使用)
- @cloudflare/vitest-pool-workers(Cloudflare Workers統合テスト、D1・KV・R2・DOバインディングを含む)
- Playwright(複数アプリの横断E2E)

### ブラウザ動作確認

- Playwright MCP
- Chrome DevTools MCP(Core Web Vitals計測に使用)

### インフラ運用

- Cloudflare MCP

### IaC(Infrastructure as Code)

- OpenTofu

### ドキュメント

- Storybook(コンポーネントカタログ、`@storybook/tanstack-react`を使用)
- GraphiQL(GraphQLスキーマ探索・クエリ試行、GraphQL Yogaに内蔵、デプロイ先環境では`graphiql: false`かつintrospectionクエリも無効化)
- Swagger UI(公開APIサーバーが配信するOpenAPI仕様を閲覧)
