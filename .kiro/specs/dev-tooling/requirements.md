# Requirements Document

## Project Description (Input)

### 誰が困っているか

全アプリ(`apps/api`・`apps/event`・`apps/client`・`apps/admin`など)を実装する開発者とAIエージェント。

### 現状

- ルートの`package.json`・`.husky`・ESLint・Prettier・tsconfig・commitlint・lint-staged・Playwrightの設定がいずれも存在せず、全アプリ共通の品質ゲート(lint・整形・型検査・コミット規約・シークレット検出)とテスト実行基盤が無い。このまま実装を始めると設定がアプリごとに分散し、TDDの徹底やカバレッジ80%(NFR-MAINT-003)を担保できない。
- 整備済みなのは`bunfig.toml`(`coverageThreshold=0.8`、browser/workerテストの除外)、Dockerfile(Playwright 1.63.0のOS依存パッケージ・Betterleaksを含む)、compose.yaml、`scripts/`のみである。
- 共有ディレクトリ(`apps/db`・`apps/backend-lib`・`apps/frontend-lib`)はcompose.yamlのbind mountでのみ各アプリへ配置されており、CI環境で同じ依存解決ができる保証が無い。
- CLAUDE.mdに「後ほどdocs/GUIDES/techディレクトリに移す規則」節があるが、`docs/GUIDES/tech`ディレクトリ自体が存在しない。

### 何を変えるか

- ルートで`bun install`を実行すると、Husky経由でpre-commit(lint-staged・Betterleaks)とcommit-msg(commitlint)が動作するようにする。
- 全アプリが継承できるESLint・Prettier・tsconfigの基底設定(設定ファイルは`*.ts`)を用意し、各アプリは継承と差分指定だけで済むようにする。
- 4種のテスト(`*.unit.test.ts`はBun、`*.browser.test.{ts,tsx}`はVitest Browser Mode、`*.worker.test.{ts,tsx}`は`@cloudflare/vitest-pool-workers`、E2EはPlaywright)の実行規約とコマンド、Playwright設定の雛形を確立し、Playwright更新時に同期すべき4箇所を整合させる。
- 共有ディレクトリの依存解決方式と主要パッケージのバージョン固定方針を定め、ローカル(Docker)とCIで同じ結果になることを検証する。
- `docs/GUIDES/tech`の9サブディレクトリの構成と索引、及び`coding`・`testing`の初版を作成し、CLAUDE.mdの「後ほど移す規則」を汎用的な記述で移設する。

### 範囲外

各アプリ本体の雛形(backend-platform・frontend-platform)、GitHub Actionsのワークフロー(infra-delivery)、各アプリ固有のテストコード。

詳細な前提・制約・実現性チェックの指摘は[brief.md](brief.md)を参照すること。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
