# 主な技術選定

それぞれ最新バージョンを用いる。

## データベース

- SQLデータベース
  - ローカル環境 ... WranglerのD1ローカルモード(`wrangler dev --persist-to` / `wrangler d1 execute --local --persist-to`)
  - デプロイ先 ... Cloudflare D1

## バックエンド(API)

### フレームワーク

- Hono
- TypeScript

### 依存性注入(DI)

- Inversify

### スキーマ

- GraphQL
- GraphQL Yoga
- `@graphql-yoga/plugin-disable-introspection`(本番環境でのintrospectionクエリ無効化)
- DataLoader(GraphQLのN+1問題対策)
- GraphQL Armor(クエリ深度・複雑度・エイリアス数の上限設定によるDoS対策)
- `@graphql-yoga/plugin-persisted-operations`(永続化クエリによる許可リスト方式のDoS対策)

### ORM

- MikroORM
- Kysely(クエリビルダ)

### 認証・認可

- `HttpOnly`・`Secure`・`SameSite`属性付きCookieによるユーザー認証
- ロールベースのアクセス制御
- 所有権ベースのアクセス制御(自ユーザー・全ユーザー・管理者)
- OTPAuth(TOTP多要素認証)

### ID採番

- ulidx

### バリデーション・変換

- Zod
- @hono/zod-validator

### パスワード漏洩照合

- Have I Been Pwnedの[Pwned Passwords API](https://haveibeenpwned.com/API/v3#PwnedPasswords)(k-Anonymity方式)

### メールアドレス検証

- [DISIFY API](https://docs.disify.com/guide/introduction.html) ... 使い捨てメールアドレスの判定

### 自然言語分析

- [Google Cloud Natural Language AI](https://cloud.google.com/natural-language/docs) ... 多言語対応のキーワード抽出

### 画像処理

- @cf-wasm/photon(画像のデコード・フォーマット変換)
- fast-xml-parser(SVGのパース、`<script>`要素やイベントハンドラ属性の検出)

### アーカイブ生成

- fflate(ZIPアーカイブのストリーミング生成)

### マークダウン処理

- remark-parse + remark-gfm ... GFM準拠のマークダウンパース、AST(mdast)を生成
- remark-rehype ... AST(mdast)からAST(hast)への変換
- rehype-sanitize ... AST(hast)上でのアローリスト方式HTMLサニタイズ、Raw HTMLの無効化に対応

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

- Stripe(決済処理基盤、[ドキュメント](https://docs.stripe.com))
  - Stripe Node.js SDK(内部APIサーバー側で使用、`createFetchHttpClient()`によるfetchベースの通信)
  - Stripe Checkout Sessions API(決済セッションの管理)
  - Stripe Webhooks(都度支払いや定期課金イベントの受信)
  - React Stripe.js SDK及びPayment Element(決済ページの埋め込み)

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

### 定期実行基盤

- Cloudflare Cron Triggers(内部APIサーバーのWrangler設定)

### ストレージ

- ファイルストレージ
  - ローカル環境 ... WranglerのR2ローカルモード(`wrangler dev --persist-to` / `wrangler r2 *** --local --persist-to`)
  - デプロイ先 ... Cloudflare R2

### イベント処理

R2 Event Notificationsで配信されるオブジェクト作成イベントをQueuesで受信する。
R2 Event Notificationsをローカル環境で使う手段は無いため、当該イベント処理はデプロイ先でのみ有効化させる。

- Cloudflare R2 Event Notifications
- Cloudflare Queues

### 画像配信

- Cloudflare ImagesのTransformations ... R2に保存した画像をリサイズ・フォーマット変換・Exif削除

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
  - ローカル環境 ... MailpitのHTTP送信API
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
- @cloudflare/vitest-pool-workers(Cloudflare Workers統合テスト、D1・R2・DOバインディングを含む)
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
- GraphiQL(GraphQLスキーマ探索・クエリ試行、GraphQL Yogaに内蔵、デプロイ先環境では`graphiql: false`)
- Swagger UI(公開APIサーバーが配信するOpenAPI仕様を閲覧)
