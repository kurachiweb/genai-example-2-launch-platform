# ローンチディレクトリ「Launch Stadium」

Launch Stadiumのプログラム一式、及びドキュメント。
dev版利用者側サイトURL(予定)：https://genai-example-2-client-dev.shortbook.workers.dev
dev版開発者側サイトURL(予定)：https://genai-example-2-admin-dev.shortbook.workers.dev
prod版利用者側サイトURL(予定)：https://genai-example-2-client.shortbook.workers.dev
prod版開発者側サイトURL(予定)：https://genai-example-2-admin.shortbook.workers.dev

## このサービスについて

作った製品を投稿し、他のユーザーと投票数を競い合うローンチディレクトリ。
各ユーザーは画面操作または公開APIを通じて自身のプロフィール、投稿した製品、コメントをCRUD操作できる。
公開APIには1分あたりのリクエスト数制限(Rate Limit)が設けられている。
詳細は[README.md](./README.md)を参照すること。

## 作業ルール

各種ドキュメント、Gitコミットメッセージ、コードコメントにおいて、全ての文章は日本語で記述すること。
機能追加や改修のように複数行のコードを変更する場合は、必ずcc-sddフレームワークに従うこと。（必読セクション: `Agentic SDLC and Spec-Driven Development` 及び参照しているファイル）
テスト駆動開発(TDD)の実施を徹底すること。
新規ビジネスロジックが無い軽微な変更であっても、影響範囲が広いものと考えて水平展開を行うこと。
コード内にコメントは原則書かないが、難易度の高いロジックには理解を早めるための「何をする処理か」コメントを添える。コードを読むだけでは分からない「なぜその処理が必要か」のコメントは書く。
車輪の再発明を許容し、簡易なユーティリティ関数のためにnpmパッケージをインストールしない。
appsディレクトリ内を編集した際は、docsディレクトリ内の関連する内容も必ず更新すること。

### Claude拡張設定よりも優先される本プロジェクト独自作業ルール・パターン

サブエージェントを起動する際、Claude Haikuを使うよう指示があれば必ずSonnetを使うこと。
Claude拡張設定にはnpmやpnpm関連のコマンドがあるが、このプロジェクト内では全て代わりのbunコマンドを実行すること。
テストを実行する際、Claude拡張設定内でjestやvitest関連のコマンドが記載されていても、代わりに`bun test`コマンドを実行すること。

## Git運用方針

GitワークフローはGitLab Flow(環境ブランチ)を採用する。開発のトランクは`main`ブランチとし、featureブランチは`main`から分岐して短命に保ち、PRレビューを経て`main`にマージする。
mainブランチにpushした際、dev環境に自動でデプロイする。
prod環境には、`main`ブランチから`prod`ブランチへのPRマージ(push)をトリガーとしてデプロイが実行される。
`prod`ブランチへのマージはGitHubのブランチ保護ルールにより人間のレビュー承認を必須とし、AIエージェントによるprod環境へのデプロイを技術的に禁止する。
緊急のホットフィックスは`prod`から分岐した短命ブランチで行い、`prod`へ直接マージした後、`prod → main`へバックマージして両ブランチを同期する。

## どのように作るか

TerraformでCloudflareインフラを構成する。
FCP (First Contentful Paint)を重視する。
フロントエンド側画面構成はサービス画面(client)と管理画面(admin)に大きく分かれる。
サービス画面と管理画面、双方にReact及びNext.jsを使う。
APIサーバーはNestJSを使い、クライアント側との通信はGraphQLを使う。

## ディレクトリ構成

```
/
├── .github/                    # GitHub Actionsのワークフロー、CI/CD
├── .husky/                     # Huskyトリガー定義
├── .kiro/                      # cc-sddのプロジェクトメモリとspec状態
├── apps/                       # アプリケーション実装
│   ├── infra/                  # インフラ構成定義 ... Terraformを使用、Cloudflareを主としてインフラを設計
│   ├── db/                     # DBスキーマ定義やDBへの接続処理
│   │   ├── migrations/         # マイグレーション履歴
│   │   └── data/               # ローカル開発の永続データ(Git管理に含めない) ... SQLiteの実データやValkeyのスナップショット
│   ├── backend-lib/            # バックエンド共通ファイル
│   │   └── utilities/          # ユーティリティ
│   ├── api/                    # APIサーバー ... NestJSを利用、ローカル開発でのポート番号は48042、ORMによるDB接続処理を含む
│   │   └── lib/                # バックエンド共通ファイル(`apps/backend-lib`ディレクトリ)のエイリアス、Dockerコンテナ内で利用可能
│   ├── public-api/             # 公開APIサーバー ... NestJSを利用、ローカル開発でのポート番号は48043
│   │   └── lib/                # バックエンド共通ファイル(`apps/backend-lib`ディレクトリ)のエイリアス、Dockerコンテナ内で利用可能
│   ├── frontend-lib/           # フロントエンド共通ファイル
│   │   ├── components/         # コンポーネント定義 ... Storybookによるプレビュー付き
│   │   └── utilities/          # ユーティリティ
│   ├── client/                 # Webサーバー兼フロントエンド(利用者側) ... Next.jsを利用、ローカル開発でのポート番号は48044
│   │   └── lib/                # フロントエンド共通ファイル(`apps/frontend-lib`ディレクトリ)のエイリアス、Dockerコンテナ内で利用可能
│   ├── admin/                  # Webサーバー兼フロントエンド(管理者側) ... Next.jsを利用、ローカル開発でのポート番号は48045
│   │   └── lib/                # フロントエンド共通ファイル(`apps/frontend-lib`ディレクトリ)のエイリアス、Dockerコンテナ内で利用可能
│   └── email/                  # ローカル開発時のメールボックス(Git管理に含めない) ... Mailpitを使用しポート番号は48046
├── docs/                       # ドキュメント ... 全てマークダウン形式
│   ├── onboardings/            # オンボーディングガイド ... 環境構築手順やドキュメント索引
│   ├── adr/                    # ecc:architecture-decision-recordsスキルによる自動生成ADR
│   ├── tdd/                    # ecc:tdd-workflowスキルのステップ8によるTDDエビデンスレポート
│   ├── CODEMAPS/               # ecc:doc-updaterエージェントによる自動生成コードマップ
│   ├── GUIDES/                 # 開発者ドキュメント、ecc:doc-updaterエージェントにより都度更新
│   │   ├── infra/              # インフラ・ネットワーク構成図、デプロイ手順、ログ管理方針
│   │   ├── db/                 # データベース設計原則、マイグレーション手順
│   │   ├── api/                # APIドキュメント及び設計原則
│   │   ├── coding/             # コーディングルール、アーキテクチャ設計
│   │   ├── testing/            # テスト方針、カバレッジ設定
│   │   ├── operations/         # 運用ガイド ... デプロイや障害対応、ロールバックや問い合わせ駆動調査手順
│   │   └── security/           # 包括的なセキュリティガイド、認証認可設計、システム監視及び対応方針
│   └── service/                # このサービスに関する資料
│       ├── overview/           # サービス概要、コンセプト、どのユーザーがこのサービスを必要とするか、ユーザーストーリー
│       ├── features/           # ビジネスルール(SSoT) ... 機能仕様、受け入れ条件一覧
│       ├── design/             # デザインガイドライン ... 文字やパーツ配置に関するサービス固有の規則
│       └── glossary.md         # サービス内用語集
├── scripts/                    # ローカル開発用シェルスクリプト ... コンテナの常駐プロセス起動など
├── Dockerfile                  # AIエージェントによる自動作業を安全に進めるrootコンテナ
├── compose.yaml                # コンテナの管理
├── package.json                # プロジェクトルート ... commitlint、husky、lint-stagedによるgit管理の厳格化
└── README.md                   # 作業者向け、サービスの基本的説明
```

## Claude拡張設定間の矛盾について

APIレスポンス形式やバリデーションエラー時ステータスコードは `ecc:api-design` スキルの内容をベストプラクティスとして採用する。`ecc:coding-standards` や `ecc:nestjs-patterns` のAPIレスポンス形式は採用しない。
npmパッケージの `framer-motion` は `motion` にリネームされているため、`motion/react` をインポートして利用する。`ecc:motion-ui` と `ecc:frontend-patterns` スキルが `framer-motion` に言及しているが、その点においては古い情報である。
ビジネスロジックはService層ではなくEntity層に書くこと。`ecc:nestjs-patterns` ではビジネスロジックはService層に書くよう指示しているが、`developer-kit-typescript:clean-architecture` スキルではEntity層に書くよう指示しており、後者に従う。
Next.jsのキャッシュ戦略には `"use cache"` を使う。`developer-kit-typescript:nextjs-performance` スキルでは `unstable_cache` が紹介されているが、それは古い記法である。

## 技術選定

それぞれ最新バージョンを用いる。

### データベース

ローカル環境 ... WranglerのD1ローカルモード(`wrangler dev` / `wrangler d1 execute --local`)、ポート番号は48040
デプロイ先 ... Cloudflare D1

### バックエンド (API)

#### フレームワーク

HonoはNestJSのHTTPアダプター層として使い、Expressは使わない。

NestJS (クリーンアーキテクチャ)
Hono (Cloudflare Workers向け設定)
TypeScript

#### スキーマ

GraphQL
@nestjs/graphql
DataLoader (GraphQLのN+1問題対策)

#### データベース・ORM

MikroORM (D1向け連携は実験的サポート、Kysely D1ダイアレクトを`driverOptions`経由で使用)
Kysely (クエリビルダ)

#### 認証・認可

HTTPS-Only Cookieによるユーザー認証
ロールベースのアクセス制御
所有権ベースのアクセス制御（自ユーザー・全ユーザー・管理者）

#### バリデーション・変換

class-validator
class-transformer

### フロントエンド

#### フレームワーク

Next.js (App Router使用)
React
TypeScript

#### スキーマ

GraphQL Code Generator

#### 状態管理・データフェッチング

Apollo Client (GraphQL クライアント)
Jotai (グローバル状態管理)
React Query (キャッシュ・再取得制御の補完)

#### UI・スタイリング

Tailwind CSS
shadcn/ui

#### フォーム・バリデーション

React Hook Form
Zod

### 決済サービス

Creem (決済処理基盤、https://docs.creem.io)
Creem Checkout (決済ページへの誘導)
Creem Webhooks (都度支払いや定期課金イベントの受信、APIサーバー側で処理)
Creem TypeScript SDK 及び Next.js アダプター

### デプロイ先のインフラ構成

#### アプリケーション実行環境

Cloudflare Workers

#### ストレージ

Cloudflare R2 (画像・ファイルストレージ)

#### セキュリティ

専用の有償セキュリティ基盤は用いず、Cloudflareのプラットフォーム標準機能と既存ツールを重ねて多層防御を構成する。

Cloudflare WAF Rate Limiting Rules (エッジでのレート制限 ... 制限閾値はTerraformで管理)
Cloudflare Durable Objects (厳密なレート制限カウントに使用)
@nestjs/throttler (アプリ層でのレート制限)

#### 構造化ロギング

LogTape

#### メール送信

Cloudflare Email Send
MJML (HTMLメールコード生成、faire/mjml-reactを使用)

#### モニタリング

Sentry (`@sentry/bun`を使用、エラートラッキング)
Cloudflare Analytics / Health Checks (可用性・死活監視)
FlareWarden (外部ステータスページ・死活監視)

### 画像配信

Cloudflare Images

#### 画像モデレーション

Amazon Rekognition (ローカル環境やCIプロセスでは、テスト結果を毎回同じにするため決定論的スタブの偽判定器を使用)

#### CI/CD

GitHubリポジトリでのmain/prodブランチへのpushをトリガーにして、Workers Buildsにより以下のパイプラインを実行しデプロイ。
TruffleHog (機密情報のpush防止)
Bunによるパッケージインストール及び既知の脆弱性確認
Wrangler Secretsによる環境変数変更
Terraformによるインフラ構成変更
WranglerによるDBマイグレーション

### 開発環境・ツール

#### コンテナ

Docker (ローカル環境のみ)

#### パッケージマネージャー

Bun

#### コード品質

ESLint + Prettier
Husky + lint-staged (pre-commit)
Commitlint (コミットメッセージ規約)

#### セキュリティ

Gitleaks (pre-commit、コマンドオプション `--staged` を使用)
GitHub Dependabot (依存パッケージの脆弱性アラート及びバージョン更新PRの自動作成)

#### テスト

Bun (単体テスト、`bun test` コマンドを使用)
@happy-dom/global-registrator (フロントエンド)
React Testing Library (フロントエンド)
Supertest (API統合テスト)
Playwright (E2E)

#### ブラウザ動作確認

Playwright MCP

#### ドキュメント

Storybook (コンポーネントカタログ)
GraphQL Playground (API探索)
Swagger UI (公開API向け、OpenAPI形式)

---

# Agentic SDLC and Spec-Driven Development

Kiro-style Spec-Driven Development on an agentic SDLC

## Project Context

### Paths

- Steering: `.kiro/steering/`
- Specs: `.kiro/specs/`

### Steering vs Specification

**Steering** (`.kiro/steering/`) - Guide AI with project-wide rules and context
**Specs** (`.kiro/specs/`) - Formalize development process for individual features

### Active Specifications

- Check `.kiro/specs/` for active specifications
- Use `/kiro-spec-status [feature-name]` to check progress

## Development Guidelines

- Think in English, generate responses in Japanese. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Minimal Workflow

- Phase 0 (optional): `/kiro-steering`, `/kiro-steering-custom`
- Discovery: `/kiro-discovery "idea"` — determines action path, writes brief.md + roadmap.md for multi-spec projects
- Phase 1 (Specification):
  - Single spec: `/kiro-spec-quick {feature} [--auto]` or step by step:
    - `/kiro-spec-init "description"`
    - `/kiro-spec-requirements {feature}`
    - `/kiro-validate-gap {feature}` (optional: for existing codebase)
    - `/kiro-spec-design {feature} [-y]`
    - `/kiro-validate-design {feature}` (optional: design review)
    - `/kiro-spec-tasks {feature} [-y]`
  - Multi-spec: `/kiro-spec-batch` — creates all specs from roadmap.md in parallel by dependency wave
- Phase 2 (Implementation): `/kiro-impl {feature} [tasks]`
  - Without task numbers: autonomous mode (subagent per task + independent review + final validation)
  - With task numbers: manual mode (selected tasks in main context, still reviewer-gated before completion)
  - `/kiro-validate-impl {feature}` (standalone re-validation)
- Progress check: `/kiro-spec-status {feature}` (use anytime)

## Skills Structure

Skills are located in `.claude/skills/cc-sdd/skills/kiro-*/SKILL.md`

- Each skill is a directory with a `SKILL.md` file
- Skills run inline with access to conversation context
- Skills may delegate parallel research to subagents for efficiency
- Additional files (templates, examples) can be added to skill directories
- `cc-sdd:kiro-review` — task-local adversarial review protocol used by reviewer subagents
- `cc-sdd:kiro-debug` — root-cause-first debug protocol used by debugger subagents
- `cc-sdd:kiro-verify-completion` — fresh-evidence gate before success or completion claims
- **If there is even a 1% chance a skill applies to the current task, invoke it.** Do not skip skills because the task seems simple.

## Development Rules

- 3-phase approval workflow: Requirements → Design → Tasks → Implementation
- Human review required each phase; use `-y` only for intentional fast-track
- Keep steering current and verify alignment with `/kiro-spec-status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration

- Load entire `.kiro/steering/` as project memory
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/kiro-steering-custom`)
