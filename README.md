# ローンチプラットフォーム「Launch Stadium」

Launch Stadiumのプログラム一式、及びドキュメント。

サービス開発に参加する際は[オンボーディングガイド](docs/onboardings/README.md)を、要件リファレンスは[ソフトウェア要件定義書](docs/requirements/README.md)を、使用する主な技術は[技術選定](docs/onboardings/tech-stack.md)を読むこと。

---

## 配信URL一覧

- staging版利用者側サイトURL: https://genai-example-2-client-staging.lab.kurachiweb.com
- staging版管理者側サイトURL: https://genai-example-2-admin-staging.lab.kurachiweb.com
- staging版APIサーバー: https://genai-example-2-api-staging.lab.kurachiweb.com (公開APIのエンドポイントのみ外部公開)
- staging版イベントサーバー: https://genai-example-2-event-staging.lab.kurachiweb.com
- staging版画像配信用CDN: https://genai-example-2-images-staging.lab.kurachiweb.com
- prod版利用者側サイトURL: https://genai-example-2-client.lab.kurachiweb.com
- prod版管理者側サイトURL: https://genai-example-2-admin.lab.kurachiweb.com
- prod版APIサーバー: https://genai-example-2-api.lab.kurachiweb.com (公開APIのエンドポイントのみ外部公開)
- prod版イベントサーバー: https://genai-example-2-event.lab.kurachiweb.com
- prod版画像配信用CDN: https://genai-example-2-images.lab.kurachiweb.com

---

## ドキュメント索引

### サービス仕様(ルートディレクトリ)

| ドキュメント           | 内容         |
| ---------------------- | ------------ |
| [README.md](README.md) | サービス概要 |

### ソフトウェア要件定義書(`docs/requirements/`)

| ドキュメント                             | 内容                                   |
| ---------------------------------------- | -------------------------------------- |
| [README.md](docs/requirements/README.md) | ソフトウェア要件定義書(IEEE 29148準拠) |

### サービス固有ドキュメント(`docs/GUIDES/service/`)

| ドキュメント                                        | 内容                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [README.md](docs/GUIDES/service/README.md)          | サービス固有ドキュメントの索引                                                             |
| [overview/](docs/GUIDES/service/overview/README.md) | サービス概要、料金及びプラン体系、予選・Week/Yearトーナメント・再ローンチの規則            |
| [features/](docs/GUIDES/service/features/README.md) | ユーザーデータエクスポートのJSONスキーマとファイル構造、画像配信の名前付きバリアント       |
| [design/](docs/GUIDES/service/design/README.md)     | デザイン原則、ページ構成、文言・文字数規則                                                 |
| [legal/](docs/GUIDES/service/legal/README.md)       | 法令準拠方針、利用規約・プライバシーポリシー・法的通知の大枠、侵害コンテンツ削除請求フロー |

### 技術ドキュメント(`docs/GUIDES/tech/`)

| ドキュメント                                         | 内容                                                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [README.md](docs/GUIDES/tech/README.md)              | 技術ドキュメントの索引、記述規則、文書の追加方法                                                                                                                                                  |
| [infra/](docs/GUIDES/tech/infra/README.md)           | インフラ・ネットワーク構成図、実行環境の設定規約と環境種別、ログ管理方針、非同期処理設計                                                                                                          |
| [external/](docs/GUIDES/tech/external/README.md)     | 各種外部APIの仕様、料金、リクエスト制限、認証方式、エラーハンドリング及びリトライ戦略                                                                                                             |
| [db/](docs/GUIDES/tech/db/README.md)                 | データベース設計原則、テーブル・カラムの命名規則、マイグレーションの生成と適用の手順、データベース固有の制約と対処                                                                                |
| [backend/](docs/GUIDES/tech/backend/README.md)       | アーキテクチャ設計(依存性注入を含む)、API設計                                                                                                                                                     |
| [frontend/](docs/GUIDES/tech/frontend/README.md)     | アクセシビリティ規則、マークアップ規約、コンポーネント共通化対象、開発時とデプロイ前の起動方法                                                                                                    |
| [coding/](docs/GUIDES/tech/coding/README.md)         | JavaScript・TypeScriptの記法、設定ファイルの記述規約と基底設定の継承、整形検査・静的解析・型検査のコマンド、依存パッケージの版管理、共有ディレクトリの配置方式、GraphQL通信、入力値バリデーション |
| [testing/](docs/GUIDES/tech/testing/README.md)       | テスト方針(テストの種別と命名規約、実行コマンド)、カバレッジ設定、TDDの進め方、E2Eテストツールの版の更新手順                                                                                      |
| [operations/](docs/GUIDES/tech/operations/README.md) | デプロイ手順、障害対応、ロールバック手順、決済データ操作                                                                                                                                          |
| [security/](docs/GUIDES/tech/security/README.md)     | 包括的なセキュリティガイド、認証認可設計、シークレット管理、システム監視及び対応方針                                                                                                              |

### エージェント・開発支援(`docs/onboardings/`)

| ドキュメント                                                  | 内容                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| [claude-extensions.md](docs/onboardings/claude-extensions.md) | `.claude/`配下のスキル・コマンド・ルール・エージェント定義の解説 |
| [tech-stack.md](docs/onboardings/tech-stack.md)               | 技術選定(データベース・バックエンド・フロントエンド・インフラ等) |

### AIエージェント向け外部ガイドライン(`docs/ai-extensions/`)

| ドキュメント                                                                    | 内容                                                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [tanstack-agent-guidelines.md](docs/ai-extensions/tanstack-agent-guidelines.md) | TanStack系ツールを扱うAIエージェント向けガイドライン(外部リポジトリ由来)             |
| [cc-sdd.md](docs/ai-extensions/cc-sdd.md)                                       | cc-sddフレームワークによるAgentic SDLC・Spec駆動開発ガイドライン(外部リポジトリ由来) |

### 開発中の使用プロンプト記録(`docs/ai-prompts/`)

| ドキュメント                           | 内容                                             |
| -------------------------------------- | ------------------------------------------------ |
| [README.md](docs/ai-prompts/README.md) | AIコーディングで使用した主なプロンプトの記録索引 |

---

## Special Thanks

### MCP

- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) by Google ([Apache License 2.0](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/LICENSE)) ... It acts as a MCP server, giving your AI coding assistant access to the full power of Chrome DevTools.
- [Cloudflare MCP Server](https://github.com/cloudflare/mcp-server-cloudflare) by Cloudflare ([Apache License 2.0](https://github.com/cloudflare/mcp-server-cloudflare/blob/main/LICENSE)) ... MCP servers allowing you to connect to Cloudflare's service from an MCP client and use natural language to accomplish tasks through your Cloudflare account.
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) by Microsoft ([Apache License 2.0](https://github.com/microsoft/playwright-mcp/blob/main/LICENSE)) ... A MCP server that provides browser automation capabilities using Playwright.

### Claude拡張機能

- [Awesome GitHub Copilot](https://github.com/github/awesome-copilot) by GitHub ([MIT License](https://github.com/github/awesome-copilot/blob/main/LICENSE)) ... A community-created collection of custom agents, instructions, skills, hooks, workflows, and plugins to supercharge your GitHub Copilot experience.
- [cc-sdd](https://github.com/gotalab/cc-sdd) by Gota ([MIT License](https://github.com/gotalab/cc-sdd/blob/main/LICENSE)) ... Kiro-style Spec-Driven Development on an agentic SDLC for Claude Code etc.
- [Cloudflare Skills](https://github.com/cloudflare/skills) by Cloudflare ([Apache License 2.0](https://github.com/cloudflare/skills/blob/main/LICENSE)) ... Skills for teaching agents how to build on Cloudflare.
- [Developer Kit](https://github.com/giuseppe-trisciuoglio/developer-kit) by Giuseppe Trisciuoglio ([MIT License](https://github.com/giuseppe-trisciuoglio/developer-kit/blob/main/LICENSE)) ... A modular AI plugin system that supercharges your development workflow across languages and frameworks.
- [Everything Claude Code](https://github.com/affaan-m/ECC) by Affaan Mustafa ([MIT License](https://github.com/affaan-m/ECC/blob/main/LICENSE)) ... The agent harness performance optimization system.
- [Hono Skills](https://github.com/honojs/skills) by Yusuke Wada ([MIT License](https://github.com/honojs/skills/blob/main/LICENSE)) ... Agent Skills for developing applications with Hono.
- [Privacy & Data Protection Skills for AI Agents](https://github.com/mukul975/Privacy-Data-Protection-Skills) by Mahipal ([Apache License 2.0](https://github.com/mukul975/Privacy-Data-Protection-Skills/blob/main/LICENSE)) ... 282+ structured privacy & data protection skills for AI agents.
- [Skills](https://github.com/anthropics/skills) by Anthropic ([Apache License 2.0](https://github.com/anthropics/skills/blob/main/skills/frontend-design/LICENSE.txt)) ... Skills that demonstrate what's possible with Claude's skills system.
- [Stripe Claude Plugins Official](https://github.com/stripe/ai) by Stripe ([MIT License](https://github.com/stripe/ai/blob/main/LICENSE)) ... The one-stop shop for building AI-powered products and businesses on top of Stripe.
- [TanStack Agent Skills](https://github.com/DeckardGer/tanstack-agent-skills) by Deckard Gerritsen ([MIT License](https://github.com/DeckardGer/tanstack-agent-skills/blob/main/README.md#license)) ... Comprehensive best practices for building applications with the TanStack ecosystem.
