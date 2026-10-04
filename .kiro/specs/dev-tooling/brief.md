# Brief: dev-tooling

## Problem

開発者とAIエージェントが、全アプリ共通の品質ゲート(lint・整形・型検査・コミット規約・シークレット検出)とテスト実行基盤を持たないまま実装を始めると、設定がアプリごとに分散し、TDDの徹底やカバレッジ80%(NFR-MAINT-003)を担保できない。また共有ディレクトリ(`apps/db`・`apps/backend-lib`・`apps/frontend-lib`)はcompose.yamlのbind mountでのみ各アプリへ配置されており、CI環境で同じ依存解決ができる保証が無い。

## Current State

- ルートの`package.json`・`.husky`・ESLint・Prettier・tsconfig・commitlint・lint-staged・Playwrightの設定はいずれも存在しない。
- 整備済みなのは`bunfig.toml`(`coverageThreshold=0.8`、browser/workerテストの除外)、Dockerfile(Playwright 1.63.0のOS依存パッケージ・Betterleaksを含む)、compose.yaml、`scripts/`である。
- CLAUDE.mdに「後ほどdocs/GUIDES/techディレクトリに移す規則」節があるが、`docs/GUIDES/tech`ディレクトリ自体が存在しない。

## Desired Outcome

- ルートで`bun install`を実行すると、Husky経由でpre-commit(lint-staged・Betterleaks)とcommit-msg(commitlint)が動作する。
- 全アプリが継承できるESLint・Prettier・tsconfigの基底設定があり、各アプリは継承と差分指定だけで済む。
- 4種のテスト(`*.unit.test.ts`はBun、`*.browser.test.{ts,tsx}`はVitest Browser Mode、`*.worker.test.{ts,tsx}`は`@cloudflare/vitest-pool-workers`、E2EはPlaywright)の実行規約とコマンドが確立している。
- 共有ディレクトリの依存解決方式が、ローカル(Docker)とCIで同じ結果になることを検証済みである。
- `docs/GUIDES/tech`の9サブディレクトリの構成と索引があり、CLAUDE.mdの「後ほど移す規則」が汎用的な記述で`coding`・`testing`・`db`などへ移設されている。

## Approach

ルートの`package.json`はgit管理とE2E用のツールだけを持ち、アプリ固有の依存は各アプリの`package.json`に置く(Bun Workspacesは使わない)。共通設定はルートに置いて各アプリから相対参照する。共有ディレクトリは、CIでもcompose.yamlと同じボリューム構成で実行する方式を第一候補とし、設計フェーズで実際に検証して決める。

## Scope

- **In**:
  - ルート`package.json`(commitlint・husky・lint-staged・`@playwright/test`)と`.husky`
  - ESLint・Prettier・tsconfigの基底設定(設定ファイルは`*.ts`)
  - Betterleaksのpre-commit組み込み
  - 4種テストの実行規約、Playwright設定の雛形
  - Playwright更新時に同期すべき4箇所の整合
  - 共有ディレクトリの依存解決方式と、主要パッケージのバージョン固定方針
  - `docs/GUIDES/tech`の構成・索引と、`coding`・`testing`の初版
  - CLAUDE.mdの「後ほど移す規則」の移設
- **Out**:
  - 各アプリ本体の雛形(backend-platform・frontend-platform)
  - GitHub Actionsのワークフロー(infra-delivery)
  - 各アプリ固有のテストコード

## Boundary Candidates

- gitの品質ゲート(Husky・lint-staged・commitlint・Betterleaks)
- 静的解析と整形の共通設定
- テスト実行規約(4ツールの棲み分けとglob指定)
- 共有ディレクトリの依存解決とバージョン固定
- techドキュメントの土台

## Out of Boundary

- アプリの実行時コード
- CI/CDパイプラインの定義
- Cloudflare資源の定義

## Upstream / Downstream

- **Upstream**: 既存のDockerfile・compose.yaml・bunfig.toml・`scripts/`、[tech-stack.md](../../../docs/onboardings/tech-stack.md)
- **Downstream**: 全spec(特にbackend-platform・frontend-platform・infra-delivery)

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: backend-platform・frontend-platform(アプリ雛形)、infra-delivery(CIでの実行)

## Constraints

- CLAUDE.mdの規則: 設定ファイルは`*.ts`、Bun Workspaces禁止、ルート以外での`bun test`には`--config=/workspace/bunfig.toml`を付ける、テストファイル名の命名規則、Playwright更新時の4箇所同期
- 800行を超えるファイルのWrite/Editをブロックするフックが`.claude/settings.json`にある
- CLAUDE.mdから規則を移設する際、CLAUDE.md側を移設先への参照に置き換えるか維持するかは、要件フェーズで開発者に確認する(CLAUDE.mdはセッションごとに読み込まれるが`docs`は読み込まれないため)
- 実現性チェック(2026-10-03)の指摘:
  - [high] 共有ディレクトリをシンボリックリンクで置き換えると、Vite・esbuild・tsc・Bunが実パスへ解決するため、node_modulesを持たない`apps/backend-lib`からのbare importが解決できなくなる。最寄りのtsconfigも実パス側から探すため`experimentalDecorators`が効かなくなる。CIもcompose同等のボリューム構成で実行するか、実体コピーで配置する
  - drizzle-ormが`apps/db`側と各アプリ側で二重コピーになり、型が非互換になる恐れがある(`apps/db`側に一本化して再エクスポートする案)
  - Vitest 5は`@cloudflare/vitest-pool-workers`が未対応のため、全アプリで4.1系に固定し、版を指定しない追加を禁止する
- 新規パッケージは候補を挙げて開発者に質問し、採用後にtech-stack.mdへ記載する
- `docs/GUIDES/tech`にはプロジェクト名やサービス固有の仕様を書かない
