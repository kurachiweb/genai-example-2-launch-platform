# ローンチディレクトリ「Launch Stadium」

Launch Stadiumのプログラム一式、及びドキュメント。
dev版利用者側サイトURL(予定)：https://genai-example-2-client-dev.lab.kurachiweb.com
dev版開発者側サイトURL(予定)：https://genai-example-2-admin-dev.lab.kurachiweb.com
prod版利用者側サイトURL(予定)：https://genai-example-2-client.lab.kurachiweb.com
prod版開発者側サイトURL(予定)：https://genai-example-2-admin.lab.kurachiweb.com

## このサービスについて

作った製品を投稿し、他のユーザーと投票数を競い合うローンチディレクトリ。
各ユーザーは画面操作または公開APIを通じて自身のプロフィール、投稿した製品、コメントをCRUD操作できる。
公開APIには1分あたりのリクエスト回数制限(レート制限)が設けられている。
詳細は[README.md](./README.md)を参照すること。

## 本プロジェクト規則

### コーディングAI思考プロセスの規則

- 機能追加や改修のように複数行のコードを変更する場合は、必ずcc-sddフレームワークに従うこと。(必読セクション: `Agentic SDLC and Spec-Driven Development`及び参照しているファイル)
- 新規ビジネスロジックが無い軽微な変更であっても、影響範囲が広いものと考えて水平展開を行うこと。
- Wranglerコマンドのうち`--persist-to`オプションがあるものでは、`--persist-to /workspace/.wrangler/state`オプションを付け、さらにD1・KV・R2系コマンドでは`--local`オプションも付けること。
- Next.jsアプリは通常`bun run dev`で起動するが、デプロイ前は`opennextjs-cloudflare build && opennextjs-cloudflare preview`によりCloudflare Workers向けにビルドして動作確認すること。
- ビルドコマンドやデプロイ前確認コマンド、デプロイコマンドの先頭に`NODE_ENV=production`を加えること。
- 全ての環境変数は`.env`や`.dev.vars`ファイルではなくInfisical Webサービス内で管理するので、`bun run dev`など環境変数を使うコマンドの先頭には毎回`infisical --telemetry=false run --env=dev -- `を付けて注入すること。

### コード・ドキュメントの規則

- 各種ドキュメント、コードコメント、Gitコミットメッセージにおいて、全ての文章は日本語で記述すること。
- ドキュメントやコードコメントにおいて、日本語と英数字の間、そして日本語とインラインコードの間には半角スペースを入れないこと。例:「テストは Bun の `bun test` により 10% でも速くする」ではなく「テストはBunの`bun test`により10%でも速くする」
- マークダウンドキュメント内で図が必要ならmermaid形式で記述すること。
- テスト駆動開発(TDD)の実施を徹底すること。
- NestJSはクリーンアーキテクチャに基づく実装を徹底すること。
- コード内にコメントは原則書かない。ただし難易度の高いロジックには理解を早めるための「何をする処理か」コメントを添える。コードを読むだけでは分からない「なぜその処理が必要か」のコメントは書く。
- appsディレクトリ内を編集した際は、docsディレクトリ内の関連する内容も必ず更新すること。
- テストツールの棲み分けのため、テストファイル名を目的・使用ツール別に分ける。`*.unit.test.ts`はbun、`*.browser.test.tsx`はVitest、`*.worker.test.ts`は`@cloudflare/vitest-pool-workers`を使用する。そして各ツールのテストコマンド実行時にこれらのglobパターンを引数として指定すること。
- Next.jsの`"use cache"`を使う場合、キャッシュデータはCloudflare Workers KVに永続化するとともに、さらなる高速化のため`@opennextjs/cloudflare`の`withRegionalCache`(インメモリ)を併用すること。
- ORMについて
  - MikroORMがCloudflare Workers上で使用不可の`new Function`を呼び出さないように、`mikro-orm compile`コマンドを`package.json`に定義し事前コンパイルすること。
  - テーブルの特定カラムに限りアルファベットの大文字小文字を問わず文字照合させたい場合、MikroORMのテーブル定義にて`@Property({ columnType: 'text collate nocase' })`を記載すること。URLスラッグとして使われるユーザーハンドルのカラムでは特に有用。
- テーブル名は小文字で複数形にすること。
- データベースについて、Cloudflare D1及びベースとなるSQLite特有の制限に留意すること。
  - D1ではトランザクションが使えないため、MikroORMの`defineConfig`メソッドで`implicitTransactions: false`を設定し、`EntityManager.transactional()`も使用しない。
    - 絞り込みと絞り込んだレコードの更新は1回のSQLで完結させる。
    - 複数テーブルに書き込む場合、整合性を保つためにMikroORMを介さずKyselyクエリで`D1Database.batch()`を使用する。
    - ユニーク制約付きテーブルにレコードを追加する場合、同一データの同時作成によるエラーを防ぐため、`INSERT ... ON CONFLICT DO NOTHING`(既存行を更新する場合は`DO UPDATE`)を付ける。
  - SQLiteはカラム追加時や既存カラム変更時に`UNIQUE`・`FOREIGN KEY`・`CHECK`等の制約を追加することができないため、テーブルの再作成が必要。
  - SQLiteは既存カラムの型を変更できないため、この場合もテーブルの再作成が必要。
  - SQLiteはFTS5という仮想テーブルモジュールによる全文検索をサポートするが、D1では仮想テーブルを含むデータベースをエクスポートできない。([参照:Cloudflare Docs](https://developers.cloudflare.com/d1/best-practices/import-export-data/#known-limitations-1))

### Claude拡張ファイル間の矛盾、あるいは本プロジェクト規則との不一致について

Claude拡張ファイル(エージェント・スキル・ルール・コマンド)と本プロジェクト規則に矛盾がある場合、後者を優先する。

- Claude拡張ファイルが参照する別の拡張ファイルが存在しない場合は無視する。
- Claude拡張ファイル内ではnpmやpnpm関連のコマンドが記載されているが、このプロジェクト内では全て代わりのbunコマンドを実行すること。
- npmパッケージの`framer-motion`は`motion`にリネームされているため、`motion/react`をインポートして利用する。`ecc:motion-ui`と`ecc:frontend-patterns`スキルが`framer-motion`に言及しているが、それは古い情報である。
- APIレスポンス形式やバリデーションエラー時ステータスコードは`ecc:api-design`スキルの内容をベストプラクティスとして採用する。`ecc:coding-standards`や`ecc:nestjs-patterns`のAPIレスポンス形式や、`rules/common/patterns.md`のAPIレスポンスフォーマット説明、`rules/typescript/patterns.md`の`ApiResponse<T>`型は採用しない。
- ビジネスロジックはService層ではなくEntity層に書くこと。`ecc:nestjs-patterns`ではビジネスロジックはService層に書くよう指示しているが、`developer-kit-typescript:clean-architecture`スキルではEntity層に書くよう指示しており、後者に従う。
- Next.jsのキャッシュ戦略には`"use cache"`を使う。`developer-kit-typescript:nextjs-performance`スキルでは`unstable_cache`が紹介されているが、それは古い記法である。
- `.claude/rules/common/git-workflow.md`はClaude設定ファイルに`includeCoAuthoredBy: false`を設定するよう推奨しているが、そのプロパティは非推奨であり、代わりに`attribution`プロパティを指定する。
- テストについて
  - E2Eテストツールとして`ecc:e2e-runner`エージェントではVercel Agent Browserが先に挙げられているが、フォールバック扱いされているPlaywrightを本プロジェクトでは採用する。
  - Claude拡張ファイル内でJest関連のコマンドが記載されていても、Jestは使用しないこと。
  - `developer-kit-typescript:nestjs-code-review-expert`と`typescript-software-architect-review`はNestJSのE2E・統合テストにSupertestを挙げているが、Supertestはworkerdランタイム前提のD1・KV・R2・DOバインディングにアクセスできずWorkers環境の統合テストとして成立しないため採用しない。

## Git運用方針

GitワークフローはGitLab Flow(環境ブランチ)を採用する。開発のトランクは`main`ブランチとし、featureブランチは`main`から分岐して短命に保ち、PRレビューを経て`main`にマージする。
mainブランチにpushした際、dev環境に自動でデプロイする。
prod環境には、`main`ブランチから`prod`ブランチへのPRマージ(push)をトリガーとしてデプロイが実行される。
`prod`ブランチへのマージはGitHubのブランチ保護ルールにより人間のレビュー承認を必須とし、AIエージェントによるprod環境へのデプロイを技術的に禁止する。
緊急のホットフィックスは`prod`から分岐した短命ブランチで行い、`prod`へ直接マージした後、`prod → main`へバックマージして両ブランチを同期する。

## ディレクトリ構成

```
/
├── .claude/                    # Claude拡張設定 ... 詳細はClaude拡張ファイル解説(./docs/onboardings/claude-extensions.md)を参照
├── .github/                    # GitHub Actionsのワークフロー、CI/CD全般(ビルド・デプロイ・Terraform適用を含む)を担当
├── .husky/                     # Huskyトリガー定義
├── .kiro/                      # cc-sddのプロジェクトメモリとspec状態
├── .wrangler/                  # WranglerのD1・KV・R2ローカルモードの実データ(Git管理に含めない) ... `apps/api`や`apps/public-api`の`wrangler dev --persist-to /workspace/.wrangler/state`が生成
├── apps/                       # アプリケーション実装
│   ├── infra/                  # インフラ構成定義 ... Terraformを使用、Cloudflareを主としてインフラを設計
│   ├── db/                     # DBスキーマ定義やDBへの接続処理
│   │   └── migrations/         # DBマイグレーション履歴
│   ├── email/                  # ローカル開発時のメールボックス(Git管理に含めない) ... Mailpitを使用しポート番号は48041
│   ├── backend-lib/            # バックエンド共通ファイル
│   │   └── utilities/          # ユーティリティ
│   ├── api/                    # APIサーバー ... NestJSを利用、ローカル開発でのポート番号は48042
│   │   ├── db/                 # DBスキーマ定義(`apps/db`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   │   └── lib/                # バックエンド共通ファイル(`apps/backend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   ├── public-api/             # 公開APIサーバー ... NestJSを利用、ローカル開発でのポート番号は48043
│   │   ├── db/                 # DBスキーマ定義(`apps/db`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   │   └── lib/                # バックエンド共通ファイル(`apps/backend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   ├── frontend-lib/           # フロントエンド共通ファイル、ローカル開発におけるStorybookプレビューのためのポート番号は48046
│   │   ├── components/         # コンポーネント定義 ... Storybookによるプレビュー付き
│   │   └── utilities/          # ユーティリティ
│   ├── client/                 # Webサーバー兼フロントエンド(利用者側) ... Next.jsを利用、公開API向けSwagger UIページも含む、ローカル開発でのポート番号は48044
│   │   └── lib/                # フロントエンド共通ファイル(`apps/frontend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   └── admin/                  # Webサーバー兼フロントエンド(管理者側) ... Next.jsを利用、ローカル開発でのポート番号は48045
│       └── lib/                # フロントエンド共通ファイル(`apps/frontend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
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
│       └── design/             # デザインガイドライン ... 文字やパーツ配置に関するサービス固有の規則
├── scripts/                    # ローカル開発用シェルスクリプト ... コンテナの常駐プロセス起動など
├── Dockerfile                  # AIエージェントによる自動作業を安全に進めるrootコンテナ
├── compose.yaml                # コンテナの管理
├── package.json                # プロジェクトルート ... commitlint、husky、lint-stagedによるgit管理の厳格化、及びPlaywrightによるE2Eテスト
└── README.md                   # 作業者向け、サービスの基本的説明
```

## 技術選定

主な技術選定の一覧は[tech-stack.md](./docs/onboardings/tech-stack.md)を参照すること。

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
- Use `/cc-sdd:kiro-spec-status [feature-name]` to check progress

## Development Guidelines

- Think in English, generate responses in Japanese. All Markdown content written to project files (e.g., requirements.md, design.md, tasks.md, research.md, validation reports) MUST be written in the target language configured for this specification (see spec.json.language).

## Minimal Workflow

- Phase 0 (optional): `/cc-sdd:kiro-steering`, `/cc-sdd:kiro-steering-custom`
- Discovery: `/cc-sdd:kiro-discovery "idea"` — determines action path, writes brief.md + roadmap.md for multi-spec projects
- Phase 1 (Specification):
  - Single spec: `/cc-sdd:kiro-spec-quick {feature} [--auto]` or step by step:
    - `/cc-sdd:kiro-spec-init "description"`
    - `/cc-sdd:kiro-spec-requirements {feature}`
    - `/cc-sdd:kiro-validate-gap {feature}` (optional: for existing codebase)
    - `/cc-sdd:kiro-spec-design {feature} [-y]`
    - `/cc-sdd:kiro-validate-design {feature}` (optional: design review)
    - `/cc-sdd:kiro-spec-tasks {feature} [-y]`
  - Multi-spec: `/cc-sdd:kiro-spec-batch` — creates all specs from roadmap.md in parallel by dependency wave
- Phase 2 (Implementation): `/cc-sdd:kiro-impl {feature} [tasks]`
  - Without task numbers: autonomous mode (subagent per task + independent review + final validation)
  - With task numbers: manual mode (selected tasks in main context, still reviewer-gated before completion)
  - `/cc-sdd:kiro-validate-impl {feature}` (standalone re-validation)
- Progress check: `/cc-sdd:kiro-spec-status {feature}` (use anytime)

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
- Keep steering current and verify alignment with `/cc-sdd:kiro-spec-status`
- Follow the user's instructions precisely, and within that scope act autonomously: gather the necessary context and complete the requested work end-to-end in this run, asking questions only when essential information is missing or the instructions are critically ambiguous.

## Steering Configuration

- Load entire `.kiro/steering/` as project memory
- Default files: `product.md`, `tech.md`, `structure.md`
- Custom files are supported (managed via `/cc-sdd:kiro-steering-custom`)
