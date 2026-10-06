# ローンチプラットフォーム「Launch Stadium」

## このサービスについて

作った製品を投稿し、他のユーザーと投票数を競い合うローンチプラットフォーム。要件定義は[ソフトウェア要件定義書](docs/requirements/README.md)を参照すること。

## 技術選定

主な技術選定の一覧は[tech-stack.md](docs/onboardings/tech-stack.md)を参照すること。

## 本プロジェクト規則

### コーディングAI思考プロセスの規則

- 機能追加や大規模改修で数十行以上のコードを変更する場合は、必ず[cc-sddフレームワーク](docs/ai-extensions/cc-sdd.md)に従って実装開始前に開発者が`/cc-sdd:kiro-discovery`または`/cc-sdd:kiro-spec-init`を実行し、生成されたspecに従ってClaudeが実装する。
- 新規ビジネスロジックが無い軽微な変更であっても、影響範囲が広いものと考えて水平展開を行うこと。
- 複数の選択肢があって判断に迷うタスクや、既存のドキュメントを調べても実施方法が不明なタスクを進める場合は、都度質問をすること。
- アプリケーション実装中に新しいパッケージが必要と分かった時、workerd環境で動作しメンテナンスが継続的に行われているパッケージをいくつか候補として質問すること。そして回答に基づきインストールしたツールを[tech-stack.md](docs/onboardings/tech-stack.md)に記載すること。
- コマンドでパスを指定する場合は、必ず絶対パスで表記すること。
- 必ず実行すべきコマンドやファイル編集がClaude設定のdenyにより拒否されてしまった場合は、開発者が後ほど手動で実行できるように報告すること。
- フロントエンド側でTanStack系ツールが使われる処理を作成・改修・調査・コードレビューしたい場合は[TanStack Agent Guidelines](docs/ai-extensions/tanstack-agent-guidelines.md)を参照すること。ただしそのガイドラインの「Repository Structure」セクションとは異なり、TanStack関連スキル群は`.claude/skills/tanstack-agent-skills/skills`ディレクトリ内にある。
- [要件定義書](docs/requirements/README.md)を`grep`コマンドで読み取る際は必ず`--text`オプションを付けること。96KiB超えの巨大テキストファイルがバイナリと判定されてしまうのを防ぐため。

### コード・ドキュメントの規則

- 各種ドキュメント、コードコメント、Gitコミットメッセージにおいて、外部リポジトリ由来を除く全ての文章は日本語で記述すること。
- ドキュメントやコードコメントにおいて、日本語と英数字の間、そして日本語とインラインコードの間には半角スペースを入れないこと。例:「テストは Bun の `bun test` により 10% でも速くする」ではなく「テストはBunの`bun test`により10%でも速くする」
- マークダウンドキュメント内で図が必要ならmermaid形式で記述すること。
- テスト駆動開発(TDD)の実施を徹底すること。
- HonoはInversifyによる依存性注入を活用し、クリーンアーキテクチャに基づく実装を徹底すること。
- コード内にコメントは原則書かないこと。ただし難易度の高いロジックには理解を早めるための「何をする処理か」コメントを添える。コードを読むだけでは分からない「なぜその処理が必要か」のコメントは書く。
- コードコメントは新規追加・既存修正を問わず常にゼロベースで、現在のコードが成立するために必要な情報のみを記載すること。「以前は〜だったが」「〜をやめて」「〜を削除し」のように変更前の実装や修正の経緯を残してはならない。
- appsディレクトリ内を編集した際は、docsディレクトリ内の関連する内容も必ず更新すること。
- `docs/GUIDES/tech`ディレクトリ内では本プロジェクト名を記載したり、サービス特有の仕様に言及してはならず、同じ技術選定による他のプロジェクトにも丸写しできる内容にすること。
- BunのWorkspaces機能は使用しないこと。
- シードデータやドキュメント内のサンプルデータにおいて、URLのgTLD部やメールアドレスのドメイン部は`.example`のみを使用すること。ただし[本プロジェクトのドメイン](README.md#配信url一覧)は例外とする。
- 1つのコンポーネントファイル内でエクスポートするReactコンポーネントは必ず1つだけにすること。

### 技術規則の参照先

- 設定ファイル(ESLint・Viteなど)を作る前に: [設定ファイルの記述形式](docs/GUIDES/tech/coding/001-javascript-typescript-conventions.md#設定ファイルの記述形式)
- JavaScript・TypeScriptのコードを書く前に: [新しい記法の選択](docs/GUIDES/tech/coding/001-javascript-typescript-conventions.md#新しい記法の選択)
- HTML要素で日時を表示する前に: [日時の表示](docs/GUIDES/tech/frontend/001-markup-conventions.md#日時の表示)
- Wranglerのコマンドの実行やD1・R2のバインディングの定義の前に: [ローカル状態の永続化と共有](docs/GUIDES/tech/infra/001-wrangler-conventions.md#ローカル状態の永続化と共有)
- TanStack Startアプリを起動・ビルドする前に: [開発時とデプロイ前の起動](docs/GUIDES/tech/frontend/002-tanstack-start-on-workers.md#開発時とデプロイ前の起動)
- シークレット・環境変数を使うコマンドの実行や設定の前に: [シークレットの注入](docs/GUIDES/tech/security/001-secret-management.md#シークレットの注入)
- Wrangler設定やコマンドでデプロイ先を指定する前に: [デプロイ先の環境種別](docs/GUIDES/tech/infra/002-environments.md#デプロイ先の環境種別)
- Infisicalの環境を指定する前に: [シークレット管理の環境種別](docs/GUIDES/tech/infra/002-environments.md#シークレット管理の環境種別)
- Inversifyで注入するクラスを書く前に: [コンストラクタ引数の注入](docs/GUIDES/tech/backend/001-dependency-injection-on-workers.md#コンストラクタ引数の注入)
- Wrangler設定を作成・変更する前に: [互換性日付](docs/GUIDES/tech/infra/001-wrangler-conventions.md#互換性日付)
- テストファイルの作成やテストの実行の前に: [テストの種別と命名](docs/GUIDES/tech/testing/001-test-strategy.md#テストの種別と命名)
- カバレッジの計測やCIのテストの設定の前に: [カバレッジ](docs/GUIDES/tech/testing/001-test-strategy.md#カバレッジ)
- DBスキーマの変更やマイグレーションの作成・適用の前に: [マイグレーション・大文字小文字を区別しないカラム](docs/GUIDES/tech/db/001-drizzle-migrations-on-d1.md#マイグレーション大文字小文字を区別しないカラム)
- テーブルを新しく定義する前に: [命名規則](docs/GUIDES/tech/db/001-drizzle-migrations-on-d1.md#命名規則)
- D1へのクエリ・全文検索・バックアップを設計する前に: [D1の制約と対処](docs/GUIDES/tech/db/002-d1-constraints.md#d1の制約と対処)
- Playwright・ブラウザ操作MCPサーバーの版を更新する前に: [同期すべき4箇所](docs/GUIDES/tech/testing/002-browser-tool-versions.md#同期すべき4箇所)
- 上記の文書のプレースホルダーを本プロジェクトの値に読み替える前に: [本プロジェクト固有の値](docs/onboardings/project-values.md)

### Claude拡張ファイル間の矛盾、あるいは本プロジェクト規則との不一致について

Claude拡張ファイル(エージェント・スキル・ルール・コマンド)と本プロジェクト規則に矛盾がある場合、後者を優先する。

- Claude拡張ファイルが参照する別の拡張ファイルが存在しない場合は無視する。
- Claude拡張ファイル内でNext.jsやNestJS特有の記述が含まれている場合があり、無視するかTanStack StartやHonoでの記述に変換して判断する。
- Claude拡張ファイル内ではnpmやpnpm関連のコマンドが記載されているが、本プロジェクトでは全て代わりのbunコマンドを実行すること。
- npmパッケージの`framer-motion`は`motion`にリネームされているため、`motion/react`をインポートして利用する。`ecc:frontend-patterns`スキルが`framer-motion`を使ったサンプルコードを掲載しているが、それは古い情報である。
- APIレスポンス形式やバリデーションエラー時ステータスコードは`ecc:api-design`スキルの内容をベストプラクティスとして採用する。`ecc:coding-standards`のAPIレスポンス形式や、`rules/common/patterns.md`のAPIレスポンスフォーマット説明、`rules/typescript/patterns.md`の`ApiResponse<T>`型は採用しない。
- workerd環境では環境シークレット及び環境変数をWrangler設定に記載`env`バインディング経由で取得するため、多数のエージェント・スキル・ルールに記載されている`process.env`指定は採用しない。ただしViteやWranglerがビルド時に静的置換する`process.env.NODE_ENV`参照はこの方針の対象外である。
- `.claude/rules/typescript/hooks.md`がPostToolUseフックを`~/.claude/settings.json`に設定すべきと記載しているが、本プロジェクトでは`.claude/settings.json`に設定する。
- Stripe Payment Elementを使うためにはCheckout Sessions APIにて`ui_mode: 'elements'`オプションを使うこと。`stripe:stripe-best-practices`スキル内では`ui_mode: 'custom'`を使うよう案内しているが、それはリネーム前の古い情報である。
- `cloudflare:wrangler`スキルはローカル開発シークレットの管理に`.dev.vars`ファイルを作成するよう案内しているが、本プロジェクトでは`.dev.vars`や`.env`を使わず、Infisicalで一元管理する。
- `.claude/rules/common/development-workflow.md`が「Library docs second: Use Context7」と必須手順に定めているが、今回Context7 MCPは利用しない。
- テストについて
  - E2Eテストツールとして`ecc:e2e-runner`エージェントではVercel Agent Browserが先に挙げられているが、フォールバック扱いされているPlaywrightを本プロジェクトでは採用する。
  - Claude拡張ファイル内でJest関連のコマンドが記載されていても、Jestは使用しないこと。
  - `ecc:react-testing`スキルはコンポーネントレンダリングにReact Testing Libraryを使う前提で書かれているが、本プロジェクトでは代わりに採用する`vitest-browser-react`のAPIへ読み替える。

## Git運用方針

GitワークフローはGitLab Flow(環境ブランチ)を採用する。開発のトランクは`main`ブランチとし、featureブランチは`main`から分岐して短命に保ち、PRレビューを経て`main`にマージする。
mainブランチにpushした際、staging環境に自動でデプロイする。
prod環境には、`main`ブランチから`prod`ブランチへのPRマージ(push)をトリガーとしてデプロイが実行される。
`main`及び`prod`ブランチへのプルリクエストでは、GitHubのブランチ保護ルールにより各種チェック・テストが失敗した場合にマージをブロックする。
`prod`ブランチへのマージは、ブランチ保護ルールにより人間のレビュー承認を必須とし、AIエージェントによるprod環境へのデプロイを禁止する。
緊急のホットフィックスは`prod`から分岐した短命ブランチで行い、`prod`へ直接マージした後、`prod → main`へバックマージして両ブランチを同期する。
`main`及び`prod`ブランチはブランチ保護ルールにより削除を技術的に禁止する一方、featureやhotfixブランチはタスクを終えてマージした後に削除する。

## ディレクトリ構成

```
/
├── .claude/                    # Claude拡張設定 ... 詳細はClaude拡張ファイル解説(docs/onboardings/claude-extensions.md)を参照
├── .github/                    # GitHub Actionsのワークフロー、CI/CD全般(ビルド・デプロイ・OpenTofu適用を含む)を担当
├── .husky/                     # Huskyトリガー定義
├── .kiro/                      # cc-sddのプロジェクトメモリとspec状態
├── .wrangler/                  # WranglerのD1・R2ローカルモードの実データ(Git管理に含めない) ... `apps/api`や`apps/event`の`wrangler dev --persist-to /workspace/.wrangler/state`が生成
├── apps/                       # アプリケーション実装
│   ├── infra/                  # インフラ構成定義 ... OpenTofuを使用、Cloudflareを主としてインフラを設計
│   ├── db/                     # DBへの接続処理を含む
│   │   ├── migrations/         # DBマイグレーション履歴
│   │   └── schema/             # DBスキーマ定義
│   ├── email/                  # ローカル開発時のメールボックス(Git管理に含めない) ... Mailpitを使用
│   ├── backend-lib/            # バックエンド共通ファイル(node_modulesディレクトリは無し)
│   │   └── utilities/          # ユーティリティ
│   ├── api/                    # APIサーバー ... Honoを利用、フロントエンド向け内部API(GraphQL)と公開API(REST・OpenAPI仕様書)を提供
│   │   ├── db/                 # DBスキーマ定義(`apps/db`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   │   └── lib/                # バックエンド共通ファイル(`apps/backend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   ├── event/                  # イベントサーバー ... Honoを利用、Stripe Webhook・RFC 8058メール配信停止・Queuesのconsumer・画像配信ドメイン(SW-012)を担当
│   │   ├── db/                 # DBスキーマ定義(`apps/db`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   │   └── lib/                # バックエンド共通ファイル(`apps/backend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   ├── frontend-lib/           # フロントエンド共通ファイル
│   │   ├── components/         # コンポーネント定義 ... Storybookによるプレビュー付き
│   │   └── utilities/          # ユーティリティ
│   ├── client/                 # Webサーバー兼フロントエンド(利用者側) ... TanStack Startを利用、公開API向けSwagger UIページも含む
│   │   └── lib/                # フロントエンド共通ファイル(`apps/frontend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   └── admin/                  # Webサーバー兼フロントエンド(管理者側) ... TanStack Startを利用
│       └── lib/                # フロントエンド共通ファイル(`apps/frontend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
├── mockups/src/routes/         # 画面デザイン案 ... TanStack Start・Tailwind CSS・shadcn/uiを利用、フロントエンド共通ファイルは不使用
│   ├── client/                 # 利用者側画面のモックアップ
│   └── admin/                  # 管理者側画面のモックアップ
├── docs/                       # ドキュメント ... 全てマークダウン形式
│   ├── requirements/           # ソフトウェア要件定義書(IEEE 29148準拠、SSoT)
│   ├── onboardings/            # オンボーディングガイド ... ローカル環境の構築手順及びポート番号、技術選定、技術ドキュメントから除いた本プロジェクト固有の値
│   ├── ai-extensions/          # 外部由来のAIエージェント向けガイドライン(原文のまま配置)
│   ├── ai-prompts/             # 開発中に使用した主なプロンプトの記録
│   ├── adr/                    # ecc:architecture-decision-recordsスキルによる自動生成ADR
│   ├── tdd/                    # ecc:tdd-workflowスキルのステップ8によるTDDエビデンスレポート
│   ├── CODEMAPS/               # ecc:doc-updaterエージェントによる自動生成コードマップ
│   └── GUIDES/                 # 要件定義書を元にした開発者ドキュメント、ecc:doc-updaterエージェントにより都度更新
│       ├── tech/               # 本プロジェクトに限らず同じ技術選定のプロジェクトにコピーできる、技術的な資料
│       │   ├── infra/          # インフラ・ネットワーク構成図、実行環境の設定規約と環境種別、ログ管理方針、非同期処理設計
│       │   ├── external/       # 各種外部APIの仕様、料金、リクエスト制限、認証方式、エラーハンドリング及びリトライ戦略
│       │   ├── db/             # データベース設計原則、テーブル・カラムの命名規則、マイグレーションの生成と適用の手順、データベース固有の制約と対処
│       │   ├── backend/        # バックエンドのコーディングルール ... アーキテクチャ設計(依存性注入を含む)、API設計
│       │   ├── frontend/       # フロントエンドのコーディングルール ... アクセシビリティ規則、マークアップ規約、コンポーネント共通化対象、開発時とデプロイ前の起動方法
│       │   ├── coding/         # バックエンド/フロントエンド共通のコーディングルール ... JavaScript・TypeScriptの記法、設定ファイルの記述規約と基底設定の継承、整形検査・静的解析・型検査のコマンド、依存パッケージの版管理、共有ディレクトリの配置方式、GraphQL通信、入力値バリデーション
│       │   ├── testing/        # テスト方針(テストの種別と命名規約、実行コマンド)、カバレッジ設定、TDDの進め方、E2Eテストツールの版の更新手順
│       │   ├── operations/     # 運用ガイド ... デプロイ手順、障害対応、ロールバック手順、決済データ操作
│       │   └── security/       # 包括的なセキュリティガイド、認証認可設計、シークレット管理、システム監視及び対応方針
│       └── service/            # 本プロジェクト特有の資料
│           ├── overview/       # サービス概要、コンセプト、料金及びプラン体系
│           ├── features/       # 国際化方針や決済実装方針など特筆すべき機能仕様
│           ├── design/         # デザインガイドライン ... 文字やパーツ配置に関するサービス固有の規則
│           └── legal/          # 法律及びコンプライアンス準拠方針、利用規約・プライバシーポリシーの大枠
├── config/                     # ルートと全アプリが参照する設定データ ... アプリ一覧と共有ディレクトリの配置先、テストの命名パターンとカバレッジ閾値
│   └── vitest/                 # ブラウザテスト・Workers統合テストのVitestプリセット
├── e2e/                        # PlaywrightによるE2Eテスト(設定はルートの`playwright.config.ts`) ... 対象アプリ(`client`・`admin`)ごとのディレクトリにテストを置く
│   └── support/                # 対象アプリのURL解決、Playwrightの設定値の組み立て、到達確認、対象0件の表示
├── scripts/                    # 開発コンテナとツールのスクリプト ... コンテナ起動時の処理(Claude Codeの更新、ワークスペース信頼設定のマージ、Chromiumの導入、常駐プロセスの起動)
│   └── tooling/                # 品質ゲートのツールスクリプト ... Gitフックの導入、コミット時の検査対象の振り分け、一括検査・一括実行、共有ディレクトリの配置、テスト命名の検査
├── test-support/               # ルートの単体テストの補助 ... 共通フィクスチャ、型だけの読み込みの判定、Git管理外の判定
├── Dockerfile                  # AIエージェントによる自動作業を安全に進める開発コンテナ
├── compose.yaml                # コンテナの管理
├── package.json                # プロジェクトルート ... Gitフック(husky・lint-staged・commitlint)によるgit管理の厳格化、ルート所有ファイルの整形・静的解析・型検査・単体テスト、全アプリの一括検査とテストの一括実行、共有ディレクトリの配置確認とCIでのコピー配置、PlaywrightによるE2Eテスト
├── bunfig.toml                 # 単体テスト(Bun)の共通設定 ... 他の種別の除外、カバレッジの閾値・除外・出力先
├── tsconfig.base.json          # ルートと全アプリが継承する型検査の基底設定
├── eslint.config.base.ts       # ルートと全アプリが使う静的解析の基底設定
├── prettier.config.ts          # リポジトリ全体の整形設定
└── README.md                   # サービス説明、各種ドキュメントへの索引
```
