# 主な技術選定

版を完全に固定する主要パッケージ(TypeScript・ESLint・Prettier・Vitest系・Drizzle ORM・Playwrightなど)の版と固定の理由は、[依存パッケージの版管理](../GUIDES/tech/coding/002-dependency-versions.md#主要パッケージの一覧)の主要パッケージの一覧を正とする。

## データベース

- SQLデータベース
  - ローカル環境 ... WranglerのD1ローカルモード(`wrangler dev --persist-to` / `wrangler d1 execute --local --persist-to`)
  - デプロイ先 ... Cloudflare D1

## バックエンド

### バックエンド側フレームワーク

- Hono
- TypeScript ... typescript-eslintと組み合わせるためv6を使用

### 依存性注入(DI)

- Inversify
  - `reflect-metadata` ... Inversifyの相手依存(peer dependency)、版を固定するためアプリで明示的に宣言する

### バックエンド側スキーマ

- GraphQL
- GraphQL Yoga
- `@graphql-yoga/plugin-disable-introspection`(本番環境でのintrospectionクエリ無効化)
- DataLoader(GraphQLのN+1問題対策)
- GraphQL Armor(クエリ深度・複雑度・エイリアス数の上限設定によるDoS対策)
- `@graphql-yoga/plugin-persisted-operations`(永続化クエリによる許可リスト方式のDoS対策)
- GraphQL Code Generator(`@graphql-codegen/typescript`・`@graphql-codegen/typescript-resolvers`によりスキーマからリゾルバの型を生成)

### OpenAPI仕様

- `@hono/zod-openapi` ... 公開APIのルート定義とZodスキーマを一体化し、OpenAPI仕様を生成

### ORM

- Drizzle ORM(v1.0 RC) ... D1向け、スキーマ定義と型付きクエリビルダ
- drizzle-kit(v1.0 RC) ... マイグレーションSQLの生成

### 認証・認可

- OTPAuth(TOTP多要素認証)
- uqr ... TOTP登録用のotpauth URIをQRコードのSVGへ変換

### ID採番

- [ulid](https://github.com/ulid/javascript)

### バリデーション・変換

- Zod
- @hono/zod-validator

### パスワード漏洩照合

- Have I Been Pwnedの[Pwned Passwords API](https://haveibeenpwned.com/API/v3#PwnedPasswords)(k-Anonymity方式)

### メールアドレス検証

- [DISIFY API](https://docs.disify.com/guide/introduction.html) ... 使い捨てメールアドレスの判定

### 自然言語分析

- [Google Cloud Natural Language AI](https://cloud.google.com/natural-language/docs) ... 多言語対応のキーワード抽出、APIキーで認証

### 画像処理

- wasm-image-optimization(画像のデコード・フォーマット変換・リサイズ)
- fast-xml-parser(SVGの構文チェック・自前検索ルールによるスクリプトの検出)

### アーカイブ生成

- fflate(ZIPアーカイブのストリーミング生成)

### マークダウン処理

- unified ... remark/rehypeプラグインを連結する処理パイプライン本体
  - remark-parse + remark-gfm ... GFM準拠のマークダウンパース、AST(mdast)を生成
  - remark-cjk-friendly
  - remark-cjk-friendly-gfm-strikethrough
  - remark-rehype ... AST(mdast)からAST(hast)への変換
- rehype-sanitize ... AST(hast)上でのアローリスト方式HTMLサニタイズ、Raw HTMLの無効化に対応
- rehype-slug ... 見出しへのアンカーID付与(CJK見出しのURLエンコード仕様のみ独自実装で補う)
- rehype-stringify ... AST(hast)からHTML文字列への変換
- hast-util-to-text ... サニタイズ済みAST(hast)からのプレーンテキスト抽出、全文検索インデックスの正規化に使用

## フロントエンド

### フロントエンド側フレームワーク

- TanStack Start(ルーティングはTanStack Router)
- Vite ... 開発サーバー・ビルド・ビルド後のプレビュー(`vite dev`・`vite build`・`vite preview`)
- @cloudflare/vite-plugin
- `@vitejs/plugin-react` ... ViteでのReactのJSX変換と開発時の差し替え(Fast Refresh)
- React
  - `react-dom` ... ブラウザでの描画とハイドレーション、サーバーでのHTMLの描画
  - `@types/react`・`@types/react-dom` ... `tsc`による型検査でReactとReact DOMの型を解決
- TypeScript ... typescript-eslintと組み合わせるためv6を使用

### フロントエンド側スキーマ

- GraphQL Code Generator(`@graphql-codegen/cli`・`@graphql-codegen/client-preset`により`.graphql`ファイルの操作から型と操作の本文を持たない文書(TypedDocumentNode)と操作の一覧を生成)
  - `@graphql-typed-document-node/core` ... 生成した操作の型(`TypedDocumentNode`)の定義、共通部品が操作の結果と変数の型を受け取るために使用
  - GraphQL(`graphql`) ... `TypedDocumentNode`が継承する`DocumentNode`の型の提供元、バックエンド側と同じ版を宣言する

### 状態管理・データフェッチング

- TanStack Query(サーバー状態のキャッシュ・データフェッチング、TypedDocumentNodeを`fetch`で送信)
- `@tanstack/react-router-ssr-query`(TanStack RouterとのSSR連携)
- Jotai(クライアント状態管理)

### UI・スタイリング

- Tailwind CSS
  - `@tailwindcss/vite` ... ViteでTailwind CSSのスタイルシートを処理するプラグイン
  - `tw-animate-css` ... shadcn/uiの部品が使う出入りのアニメーションのクラス
- shadcn/ui
  - `radix-ui` ... shadcn/uiの部品が土台にするアクセシブルな部品群(全部品を1つにまとめたパッケージ)
  - `class-variance-authority` ... 部品の見た目の種類(variants)ごとのクラス名の定義
  - `clsx` ... 条件付きのクラス名の連結
  - `tailwind-merge` ... 衝突するTailwind CSSのクラス名の解消
  - `lucide-react` ... アイコン
  - `sonner` ... トースト通知
  - react-day-picker ... shadcn/uiのカレンダー部品の実体

### グラフ描画

- Recharts

### マークダウンエディタ

- `@milkdown/crepe` ... ProseMirrorベースのマークダウン向けWYSIWYGエディタ
- `@milkdown/react` ... Reactコンポーネント、SSRでは描画せずクライアント側でのみマウント

### 画像編集UI

- react-easy-crop

### フォーム・バリデーション

- React Hook Form
  - `@hookform/resolvers` ... ZodのスキーマをReact Hook Formの検証に接続
- Zod

## 決済サービス

- Stripe(決済処理基盤、[ドキュメント](https://docs.stripe.com))
  - Stripe Node.js SDK(APIサーバー及びイベントサーバーで使用、`createFetchHttpClient()`によるfetchベースの通信)
  - Stripe Checkout Sessions API(決済セッションの管理)
  - Stripe Webhooks(都度支払いや定期課金イベントの受信)
  - React Stripe.js SDK及びPayment Element(決済ページの埋め込み)
  - Stripe Refunds API(自動返金)
  - Stripe Customer Portal(Ultrasの支払い方法の更新)

## CI/CD

main/prodブランチへのプルリクエストをトリガーにして、GitHub Actionsにより検査フェーズを実行する。
main/prodブランチへのプッシュをトリガーにして、GitHub Actionsにより検査フェーズ及びデプロイフェーズを実行する。

- 検査フェーズ ... 各段階のいずれかが失敗すれば後続タスクを実行せずに中止
  - TruffleHogによるシークレット検出(検証済みと未確定の検出で失敗させ、無効と確かめた値では失敗させない)
  - Bunによるパッケージインストール及び既知の脆弱性確認
  - フォーマット検証
  - Lintチェック
  - tscによる型チェック
  - Infisical(dev環境)の環境変数を注入 ... ローカル環境と同じ値を使い、staging・prod環境の値は使わない
    - 単体テスト、ブラウザテスト、Cloudflare Workers統合テスト、及びカバレッジ閾値チェックを実行(テスト成功かつカバレッジ目標達成なら続行)
    - CIの実行環境の中で全アプリと開発用のメール受信箱(Mailpit)をローカル環境の設定で起動し、E2Eテストを実行
- デプロイフェーズ
  - OpenTofuによるインフラ構成変更(Wranglerの担当範囲を除く)
  - Infisical(pushされたブランチが`main`ならstaging環境、`prod`ならprod環境)の環境変数を注入
    - WranglerによるDBマイグレーション
    - Wranglerによる各Workerのビルド・デプロイ(`--secrets-file`で環境シークレットを同時反映)
  - staging環境へのデプロイの後、staging環境のURLに対してスモークテストを実行
- ツールの導入 ... 複合アクション`.github/actions/setup-toolchain`が、開発コンテナの`Dockerfile`と同じ版でジョブに必要なツールだけを導入する。公式のアクションは公開から2週間以上経った版のコミットSHAで固定する
  - Bun ... `oven-sh/setup-bun` v2.2.0で導入
  - Node.js 26.12.1 ... `actions/setup-node` v7.1.0で導入、ブラウザテスト・E2E・デプロイでWranglerやViteを動かす
  - OpenTofu ... `opentofu/setup-opentofu` v2.0.2でラッパー無しに導入
  - Infisical CLI ... GitHubのリリースの配布物を、同じリリースの`checksums.txt`によるSHA-256検証付きで導入
  - Wrangler 4.152.0 ... メールの購読の操作用に`bun add -g`で導入(各アプリのデプロイはアプリが固定する版を使う)
  - Mailpit 1.32.0 ... 公式のチェックサムが無いため、開発コンテナと同じく検証せずにGitHubのリリースの配布物を導入

## デプロイ先のインフラ構成

### アプリケーション実行環境

- Cloudflare Workers
  - Wrangler ... Workersのローカル実行(`wrangler dev`)・D1のマイグレーション・デプロイ。`@cloudflare/vite-plugin`でビルドするアプリも同じ版を宣言する

### 定期実行基盤

- Cloudflare Cron Triggers(APIサーバーのWrangler設定)

### ストレージ

- ファイルストレージ
  - ローカル環境 ... WranglerのR2ローカルモード(`wrangler dev --persist-to` / `wrangler r2 *** --local --persist-to`)
  - デプロイ先 ... Cloudflare R2

### イベント処理

- Cloudflare Queues(consumerはイベントサーバー)

### フロントエンド〜APIサーバー間通信

- Cloudflare Service Bindings(HTTPインターフェース)

### 画像配信

- Cloudflare WorkersのImages Binding ... R2に保存した画像をWorker内でフォーマット変換・リサイズ・Exif削除
- Cloudflare Workers Cache ... 変換済み画像をWorker前段でエッジキャッシュ

### 実行環境のセキュリティ

専用の有償セキュリティ基盤は用いず、Cloudflareのプラットフォーム標準機能と既存ツールを重ねて多層防御を構成する。
厳密なレート制限カウントにはDurable Objectsを使うが、その設定の範囲内で単一Cloudflareロケーションに高頻度リクエストがなされる場合を考慮し、Rate limiterバインディングでも防御する。

- Cloudflare Durable Objects(SQLiteストレージ)
- WorkerごとのRate limiterバインディング(Cloudflareロケーション×設定閾値のレート制限、閾値はWranglerで管理)
- Cloudflare WAF(無償マネージドルールセットによる既知の攻撃パターン検知)

### bot対策・不正防止

- Cloudflare Turnstile(ウィジェット埋め込み及びAPIサーバー側でのsiteverify検証)
  - `@marsidev/react-turnstile` ... フロントエンドでのウィジェットの埋め込みとトークンの受け取り

### メール

- メール送信
  - ローカル環境 ... MailpitのHTTP送信API
  - デプロイ先 ... Cloudflare Email ServiceのEmail Sending
- React Email(HTMLメールとテキストパートの生成、イベントサーバーだけで使用、[ドキュメント](https://react.email/docs/introduction))
  - `@react-email/components` ... メールの共通レイアウトの部品
  - `@react-email/render` ... 同じ要素からHTMLとテキストを生成、Workers向けの出力(`workerd`条件)を使用

### 画像モデレーション

ローカル環境やCIプロセスでは、テスト結果を毎回同じにするため決定論的スタブの偽判定器を使用する。

- Amazon Rekognition(SigV4署名リクエストの生成に`aws4fetch`を使用)

### ロギング

- LogTape(構造化ログ出力)
  - `@logtape/redaction` ... ログに含まれる個人情報や秘密情報の伏せ字
- Cloudflare Workers Logs(出力されたログの保持・閲覧)

### モニタリング

- Sentry(レスポンスタイム計測やエラートラッキング、`@sentry/tanstackstart-react`、`@sentry/hono`及び`@sentry/cloudflare`を使用)
  - `@sentry/cli` ... ViteとWranglerのビルド出力へのデバッグIDの埋め込みとソースマップのアップロード、デプロイの仕組みでのみ使用
- Cloudflare Web Analytics(ユーザーの傾向・利用状況分析ダッシュボード)
- FlareWarden(外部ステータスページ・死活監視)

## 開発環境・ツール

### コンテナ(ローカル環境のみ)

- Docker + Docker Compose

### パッケージマネージャー

- Bun

### 開発ツールの実行環境(開発コンテナのみ)

- Node.js v26 ... WranglerやViteなど`#!/usr/bin/env node`で始まるCLIを動かす。Bun上ではWranglerの`wrangler dev`がHTTPに応答しないため、開発コンテナに実行ファイルだけを導入している(npmは導入しない)

### AIエージェント向けトークン節約プロキシ

- RTK ... Claude Codeが発行する特定のBashコマンドを`rtk`経由に書き換えてコマンド出力のトークン量を削減する

### コード品質

- ESLint + Prettier(`eslint-config-prettier`を使い`eslint-plugin-prettier`は使わない)
  - `@eslint/js` ... ESLint公式の推奨規則、静的解析の基底設定が使用
  - typescript-eslint ... TypeScriptの構文解析と型情報付きの規則(`strictTypeChecked`、`no-deprecated`による非推奨記法の検出)
  - `@eslint-react/eslint-plugin` ... フロントエンドのReactの部品の規則(生のHTMLの挿入の禁止を含む)
  - `eslint-plugin-react-hooks` ... フロントエンドのフックの使い方とReact Compilerの前提の規則
  - `eslint-plugin-jsx-a11y-x` ... フロントエンドのJSXのアクセシビリティの規則(ESLint v10に対応した`eslint-plugin-jsx-a11y`のフォーク)
  - `@tanstack/eslint-plugin-query` ... フロントエンドのTanStack Queryの使い方の規則
  - `@tanstack/eslint-plugin-router` ... フロントエンドのTanStack Routerの使い方の規則
  - `eslint-plugin-storybook` ... Storybookのストーリーの書き方の規則
  - `prettier-plugin-tailwindcss` ... フロントエンドのTailwind CSSのクラス名の整列
- `@types/bun` ... `tsc`による型検査でBunのAPIと`bun:test`の型を解決(ルートと各アプリの`tsconfig.json`の`types`に`bun`を指定)
- Husky + lint-staged(`pre-commit`フック)
- Commitlint(コミットメッセージ規約)
  - `@commitlint/types` ... TypeScriptで書く設定ファイル`commitlint.config.ts`の型と、規則の重大度の定数

### 開発プロセスのセキュリティ

- Betterleaks(シークレット検出、`pre-commit`フック駆動でコマンドオプション`--staged`を添える)
- TruffleHog(シークレット検出、CIプロセスでのみ使用)

### シークレット管理

- Infisical(Freeプラン)

### テスト

- Bun(ロジック層の単体テスト、`bun test`コマンドを使用)
- Vitest + Vitest Browser Mode(DOM・コンポーネントテスト、フロントエンド)
  - `@vitest/browser-playwright` ... Vitest Browser ModeのブラウザプロバイダとしてPlaywrightを使い、共有Chromiumでテストを実行
  - `@vitest/coverage-v8` ... ブラウザテストのカバレッジ計測(V8)
  - `axe-core` ... ブラウザテストで描画した要素のアクセシビリティを自動検査(WCAG 2.2 AAの規則に絞って実行)
- vitest-browser-react(フロントエンド、Vitest Browser Mode上で使用)
- @cloudflare/vitest-pool-workers(Cloudflare Workers統合テスト、D1・R2・DOバインディングを含む)
  - `@vitest/coverage-istanbul` ... Workers統合テストのカバレッジ計測(workerdではV8のカバレッジ計測を使えないためIstanbulを使用)
- Playwright(複数アプリの横断E2E)
- k6 ... 負荷試験、単体の実行ファイルを開発コンテナとCIへ導入し、アプリの依存には加えない

### ブラウザ動作確認

- Playwright MCP
- Chrome DevTools MCP(Core Web Vitals計測に使用)

### インフラ運用

- Cloudflare MCP

### IaC(Infrastructure as Code)

- OpenTofu ... 1.13.2に完全固定
  - Cloudflareプロバイダ(`cloudflare/cloudflare`) ... 5.27.0に完全固定
  - `infisical`プロバイダ(`infisical/infisical`) ... 0.19.38に完全固定、Cloudflareプロバイダの資格情報を一時的なリソース(`ephemeral`)で取得

### ドキュメント

- Storybook(コンポーネントカタログ、`@storybook/tanstack-react`を使用)
  - `@storybook/addon-a11y` ... カタログの各ストーリーのアクセシビリティを`axe-core`で検査して結果をパネルに表示(ブラウザテストと同じWCAG 2.2 AAのタグに絞って実行するが、検査には自身が依存する`axe-core`を使うため、ブラウザテストの`axe-core`と版が異なることがある)
- GraphiQL(GraphQLスキーマ探索・クエリ試行、GraphQL Yogaに内蔵、デプロイ先環境では`graphiql: false`)
- Swagger UI(APIサーバーが配信するOpenAPI仕様を閲覧、`swagger-ui-dist`をclientが同一オリジンで配信)
