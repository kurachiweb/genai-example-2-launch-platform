# Research & Design Decisions

## Summary

- **Feature**: `dev-tooling`
- **Discovery Scope**: New Feature(既存の開発コンテナ・compose・bunfigへの統合を含む)
- **Key Findings**:
  - 現在のcompose.yamlは`apps/db`・`apps/frontend-lib`のnode_modulesを利用側(`apps/{api,event}/db`・`apps/{client,admin}/lib`)にも見せている。この構成ではdrizzle-ormとReactが2つの実体として解決され、drizzleは`tsc`で型エラーになる。利用側のnode_modulesだけで解決する構成では、解決・型検査・Bunテスト・esbuildの全経路で単一の実体になった。
  - esbuild(Wrangler)とVite系の変換は「対象ファイルに最も近いtsconfig」を使う。共有ディレクトリにデコレータ設定の無いtsconfigを置くと、`tsc`と`bun test`は成功するのにesbuildだけが失敗する(この`bun test`の成功は、デコレータが実行されたかまでは確かめていない。「実装時の検証結果」を参照)。
  - typescript-eslint 8.71.0はTypeScript 6.1未満にしか対応しない。`@cloudflare/vitest-pool-workers` 0.22.0はVitest ^4.1にしか対応しない。いずれも最新メジャー(TypeScript 7.0.2・Vitest 5.0.3)を採用できない。

## Research Log

### 共有ディレクトリの依存解決(実験)

- **Context**: 要件8。実現性チェックの指摘3点(シンボリックリンクでは実パスで解決されて壊れる、drizzle-ormの二重コピー、tsconfigの探索)を実測で確かめる必要があった。
- **Sources Consulted**: scratchpadに最小構成(`apps/backend-lib`のパラメータデコレータ付きクラスと`hono`のbare import、`apps/db`のdrizzleスキーマ、`apps/frontend-lib`のReactコンポーネント、利用側`apps/api`・`apps/client`)を作り、3つの配置方式で比較した。コンテナ内の`/proc/self/mountinfo`でbind mountの実態を確認した。
- **Findings**:
  - bind mountされた`/workspace/apps/api/lib`の`realpath`は`/workspace/apps/api/lib`のままである。したがって、解決結果は「その場所に実体コピーがある場合」と同じになる。
  - M1(現在のcompose: 共有側node_modulesを利用側に見せる): drizzle-ormは`api/node_modules`と`api/db/node_modules`の2実体で、`tsc`がTS2769(`SQL`型の非互換)を出した。ReactはesbuildのバンドルにReact本体が2つ含まれた。
  - M2(利用側のnode_modulesだけで解決し、共有ディレクトリ内のnode_modulesは空): drizzle・Reactとも単一実体で、`tsc`・`bun test`・esbuildすべて成功した。
  - M3(シンボリックリンク): `bun test`は`Cannot find package 'hono' from apps/backend-lib/di.ts`で失敗し、esbuildは`Parameter decorators only work when experimental decorators are enabled`で失敗した。いずれも実パスで解決したことが原因である。
  - 共有ディレクトリ直下に`{ "extends": "../../tsconfig.base.json" }`を置くと、esbuildだけがデコレータで失敗した。`../tsconfig.json`(利用側)を継承させれば成功した。
- **Implications**: M2を採用し、compose.yamlから利用側への4つのnode_modulesマウントを外す。パッケージを持たない共有ディレクトリ(`apps/backend-lib`・`apps/db`)は直下にtsconfigを置かず、利用側の設定で検査する。CIでは共有ディレクトリをnode_modules抜きでコピーすれば、M2と同じ結果になる。

### Gitフック・コミット検査(実験)

- **Context**: 要件1〜4。husky・lint-staged・commitlint・BetterleaksをTS形式の設定でBunから動かせるかを確かめた。
- **Sources Consulted**: scratchpadのGitリポジトリで実際にコミットした。`betterleaks --help`も確認した。
- **Findings**:
  - `prepare: husky`はBunの`bun install`で実行され、`core.hooksPath=.husky/_`が設定された。husky 9のフックは`sh`経由で実行されるため、実行権限を付ける必要は無い。
  - lint-staged 17.6.0は`lint-staged.config.ts`を読み込み、ステージ済みファイルにだけコマンドを適用して結果を再ステージした。enginesは`node >=22.22.1`だが、`bunx --bun`で動作した。
  - commitlint 21.2.3は`commitlint.config.ts`を読み込んだ。strictな型検査では深刻度を数値ではなく`RuleConfigSeverity`列挙で書く必要があり、`@commitlint/types`の直接導入が必要になる。
  - commitlintの既定の解析器では、`update:`・空の件名・型の無いメッセージを拒否し、日本語スコープは受け入れた。Gitが生成するマージ・リバートのメッセージは既定で検査対象外だった。破壊的変更の印`feat!:`は既定の解析器では拒否される。
  - Betterleaks 1.9.0の`git --pre-commit --staged --redact`はステージ済みの差分だけを検査し、値を`REDACTED`と表示して終了コード1を返した。許可リストは`.betterleaksignore`(fingerprint)と設定ファイル`.betterleaks.toml`で指定できる。
  - lint-staged(Prettierの自動修正)を先に実行すると、シークレットを含むファイルも書き換わった。
- **Implications**: pre-commitでは、Betterleaksの存在確認と検出をlint-stagedより先に実行する。commitlintは`@commitlint/config-conventional`を使わず、型・空の件名・型の一覧だけを自前の設定で検査する。`!`は要件の書式外として扱う。

### ESLint 10のTS設定とファイル単位の設定探索(実験)

- **Context**: 要件5。基底設定を各アプリが継承する方式と、品質ツールを各アプリに導入する決定(後述)の両立を確かめた。
- **Findings**:
  - ESLint 10.12.0はファイルごとに最も近い`eslint.config.ts`を使った。ルートから2アプリのファイルを同時に渡しても、各アプリの設定(apiだけの`no-console`)が個別に適用された。
  - Bun上で実行すると、jiti無しで`eslint.config.ts`をネイティブに読み込んだ。Node上では別途jitiが必要になる。
  - アプリの`eslint.config.ts`を型情報付きlintの対象に含めると、アプリのtsconfigにBunの型が無いため`import.meta.dirname`がerror型になった。
  - 基底設定ファイルが`typescript-eslint`などを値としてimportすると、そのimportはルートの位置で解決される。その結果、アプリが導入した版ではなくルートの版が使われる。
- **Implications**: 基底設定は、アプリから`@eslint/js`・`typescript-eslint`・`eslint-config-prettier`のモジュールを引数で受け取るファクトリにする(基底設定側は型importのみ)。`*.config.ts`は型情報付きlintの対象外にする。ESLint・Prettierは`bun --bun`で起動する。

### Bunのテスト実行(実験)

- **Findings**:
  - `bun test unit.test`は対象0件で終了コード1になる。`--pass-with-no-tests`を付けると終了コード0になる。
  - `--path-ignore-patterns`をCLIで指定でき、ルートでの実行から`apps/**`を除外できた。
  - bunfigの`coverageThreshold`は`--coverage`指定時だけ判定され、未達なら終了コード1になる。`coverageReporter = ["text", "lcov"]`・`coverageDir`・`coveragePathIgnorePatterns`は機能した。
- **Implications**: 各アプリの単体テストのスクリプトに`--pass-with-no-tests`を付ける。bunfigへE2Eの除外パターン・lcov出力・自動生成コードの除外を追加する。

### Vitest 4.1とカバレッジ

- **Sources Consulted**: [Vitest Coverage](https://vitest.dev/guide/coverage)、[Configuring Playwright](https://vitest.dev/config/browser/playwright)、[Workers Vitest integration Known issues](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/)、[workers-sdk#12589](https://github.com/cloudflare/workers-sdk/issues/12589)・[#12951](https://github.com/cloudflare/workers-sdk/issues/12951)(いずれもCLOSED)
- **Findings**:
  - Workers実行環境ではV8カバレッジ(`node:inspector`依存)が使えず、Istanbulが必要である。#12589(0%表示)は「V8を使っていた誤認」として閉じられ、#12951(Istanbul 4.1.0との不整合)も解決済みである。
  - Vitest 4ではブラウザのプロバイダが`@vitest/browser-playwright`に分離され、`playwright({ launchOptions })`で`executablePath`を渡せる。V8カバレッジはChromiumでのみ動作する。
  - `@cloudflare/vitest-pool-workers` 0.22.0のpeerDependenciesは`vitest ^4.1.0`である。Vitest 5へ上げるとプールが起動しない報告がある。
- **Implications**: ブラウザテストはV8(`@vitest/coverage-v8`)、Workers統合テストはIstanbul(`@vitest/coverage-istanbul`)とし、Vitest系は4.1.11に完全固定する。プリセットにはカバレッジのプロバイダ名と閾値だけを持たせ、プロバイダのパッケージは各アプリが導入する。

### TypeScript 6.0の既定値

- **Sources Consulted**: [TypeScript 6.0 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
- **Findings**: `strict`は既定で`true`、`types`は既定で`[]`、`module`は既定で`esnext`、`noUncheckedSideEffectImports`は既定で`true`になった。`moduleResolution: node`・`baseUrl`・`esModuleInterop: false`などは非推奨である。
- **Implications**: 基底設定でも`strict`と`types: []`を明示し、各アプリは必要な型(`bun`・Workersの型・`vite/client`など)を差分として指定する。非推奨オプションは使わない。

### Playwright関連の4箇所

- **Findings**: Dockerfileの`PLAYWRIGHT_VERSION`は1.63.0、`.mcp.json`の`chrome-devtools-mcp`は1.10.1(puppeteer-core同梱)、`@playwright/mcp` 0.0.83は`playwright-core 1.64.0-alpha`を同梱している。`/opt/ms-playwright`には`chromium-1243`が導入済みである。一方、`CHROMIUM_PATH`のリンクは、ルート未インストールのため未作成である。
- **Implications**: ルートの`@playwright/test`を1.63.0で導入して`setup-chromium.sh`を実行し、両MCPサーバーを実際に起動して確認する。リビジョンが合わなければ、CLAUDE.mdの規則どおり最も近いリビジョンの版を選ぶ。
- 実装時の結果は「[E2Eテストツール関連の4箇所の整合(タスク6.1)](#e2eテストツール関連の4箇所の整合タスク61)」を参照。

## Architecture Pattern Evaluation

| Option                | Description                                                                      | Strengths                                | Risks / Limitations                                                                | Notes  |
| --------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| M1 共有node_modules   | 共有ディレクトリのnode_modulesを利用側にも見せる(現状)                           | 利用側の依存宣言が少ない                 | drizzle・Reactが二重化し、型エラーや実行時の不整合が起きる。経路ごとに回避策が必要 | 不採用 |
| M2 利用側で解決       | 利用側のnode_modulesだけで解決し、共有側のnode_modulesはその場で動かすツール専用 | 全経路で単一実体。CIはコピーで再現できる | 利用側が共有ディレクトリの依存も宣言する必要がある。コンテナの再作成が必要         | 採用   |
| M3 シンボリックリンク | 共有ディレクトリをリンクで配置する                                               | 設定が単純                               | 実パス解決によりbare import・デコレータ設定が壊れる                                | 不採用 |
| CI: コピー            | CIで共有ディレクトリをnode_modules抜きで複製する                                 | Docker不要で速い。M2と同結果             | ツールの版はCI側で別途そろえる                                                     | 採用   |
| CI: 開発コンテナ      | CIでもDockerfileとcomposeで実行する                                              | ツール版まで一致                         | 毎回のイメージビルドが重い                                                         | 不採用 |
| CI: bind mount        | ランナーで`sudo mount --bind`                                                    | 速い                                     | 管理者権限に依存し、ローカルで試せない                                             | 不採用 |

## Design Decisions

### Decision: 共有ディレクトリは利用側で解決する(開発者決定 2026-10-04)

- **Context**: 要件8.1〜8.4。
- **Alternatives Considered**: M1・M2・M3(上表)
- **Selected Approach**: compose.yamlから`node_modules_db`の`apps/{api,event}/db/node_modules`マウントと、`node_modules_frontend_lib`の`apps/{client,admin}/lib/node_modules`マウントを外す。利用側アプリは、共有ディレクトリのコードが実行時に使うパッケージを自分で宣言する。`apps/db`のnode_modulesはdrizzle-kit専用、`apps/frontend-lib`のnode_modulesはStorybookとブラウザテスト専用になる。
- **Rationale**: 実験で唯一、全経路の解決結果が一致した。
- **Trade-offs**: 利用側の依存宣言が増え、共有側と利用側の版をそろえる規約が必要になる。開発者によるコンテナの再作成が必要になる。
- **Follow-up**: backend-platformでapi・eventが実際にビルドできた時点で、CI相当環境での一致を再確認する。

### Decision: CIでの配置はコピー用スクリプトで再現する(開発者決定 2026-10-04)

- **Selected Approach**: `scripts/tooling/shared-dirs.ts place`が、bind mountされていない配置先へ共有ディレクトリをnode_modules抜きで複製する。`verify`は、bind mount(配置先と配置元のinodeが一致)またはコピー(ファイル一覧とサイズが一致)のどちらかで、配置先のnode_modulesが空であることを確かめる。
- **Rationale**: 解決結果がbind mountと同じで、Dockerや管理者権限を必要としない。

### Decision: 品質ツールはアプリごとに導入する(開発者決定 2026-10-04)

- **Context**: 要件5。開発者は、ESLint・Prettier・TypeScriptをルートに集約する案ではなく、アプリごとの導入を選んだ。
- **Selected Approach**:
  - ルートは、Git運用・E2Eに加えて、ルート所有ファイルの検査とコミット時の整形のためにESLint・Prettier・TypeScriptを導入する。
  - 各アプリも同じ版を導入する。
  - ESLintの基底設定は、モジュールを引数で受け取るファクトリにして、各アプリの導入した版で動くようにする。
  - 静的解析と型検査はアプリごとの道具で実行する。整形はリポジトリ全体をルートのPrettierで1回だけ実行する。整形結果は最も近いPrettier設定に従うため、アプリ固有のPrettierプラグインもアプリの設定ファイルから解決される。
- **Trade-offs**: 同じパッケージが最大で(ルート+5アプリ)に重複する。版の一致は、自動検査ではなく文書の規約で担保する(要件フェーズの決定)。

### Decision: カバレッジはブラウザがV8、WorkersがIstanbul(開発者決定 2026-10-04)

- **Selected Approach**: ブラウザテストのプリセットは`provider: 'v8'`、Workers統合テストのプリセットは`provider: 'istanbul'`にする。閾値はいずれも行・関数80%とする。

### Decision: テストの命名・生成コードのパターンを単一の定義に集約する(一般化)

- **Context**: 命名検査(6.6)・Vitestプリセット(6.2・6.3)・E2E設定(6.4)・カバレッジ除外(7.3)が、同じパターンを別々に持つと食い違う。
- **Selected Approach**: `config/test-patterns.ts`を単一の定義元にする。TOMLから参照できないbunfigは、命名検査の単体テストで定義との一致を確かめる。

### Decision: E2Eテストの命名は`e2e/**/*.e2e.test.ts`

- **Context**: 要件6.4。他3種と重ならず、`bun test unit.test`の絞り込みにも一致しない命名が必要だった。
- **Selected Approach**: `*.e2e.test.ts`をルートの`e2e/`配下に置く。Bunが拾わないよう、bunfigの`pathIgnorePatterns`にも追加する。

### Decision: 自前で作るものと採用するもの(Build vs Adopt)

- **Adopt**: husky(フック導入)・lint-staged(ステージ済みファイルへの適用と部分ステージの保護)・commitlint(メッセージ解析)・Betterleaks(検出・伏せ字・許可リスト)・ESLint/Prettier/TypeScript・Bunのテストランナー・Playwright。
- **Build**: 以下の4つの薄いスクリプトは、本リポジトリの配置規則(アプリ一覧・共有ディレクトリの配置先・mockups除外)に依存するため、既製品が無い。
  - `install-git-hooks.ts`(CI・非Git環境での省略)
  - `staged-tasks.ts`(所有アプリごとの振り分けと、共有ディレクトリの配置先パスへの読み替え)
  - `run-all.ts`(一括実行と集計)
  - `shared-dirs.ts`(配置と確認)・`check-test-names.ts`(命名検査)

### Decision: 簡素化

- E2Eの到達確認は、対象アプリのプロジェクト単位のセットアップに限る。アプリの起動はE2E設定では行わず、開発者またはCIが事前に起動する。
- Vitestプリセットは値のimportを持たない定数にし、プロバイダの組み立てはアプリ側に任せる。
- 整形はアプリ単位に分けず、ルートで1回だけ実行する。

## Risks & Mitigations

- コンテナを再作成するまでは、M1のマウントが残る。`shared-dirs verify`が配置先の空でないnode_modulesを検出し、「compose.yamlの変更後にコンテナを再作成する」よう案内して失敗する。
- 品質ツールの版がアプリ間で食い違う恐れがある。主要パッケージの一覧と、追加・更新の手順書で防ぐ(自動検査は設けない決定)。
- Playwrightのテストランナーは、コンテナ内ではnodeシムによりBun上で動く。実装時に、対象0件の実行と到達確認の失敗を実測する。
- 既存文書へPrettierを初めて適用すると差分が大きくなる。初回整形を独立したコミットに分ける。
- `@playwright/mcp` 0.0.83がPlaywright 1.64系のChromiumリビジョンを要求する可能性がある。実起動で確かめ、合わなければ最も近い版を選ぶ。

## 実装時の検証結果

### E2Eテストツール関連の4箇所の整合(タスク6.1)

- **目的**: 要件9.5。E2Eテストツール関連の4箇所の版を突き合わせ、両ブラウザ操作MCPサーバーが共有Chromiumで起動することを確かめた(2026-10-05、Bun 1.4.2)。版の調べ方と起動確認の手順は「[E2Eテストツールの版の更新手順](../../../docs/GUIDES/tech/testing/002-browser-tool-versions.md)」の「期待するChromiumの調べ方」「両MCPサーバーの起動確認」に従う。
- **4箇所の版**

| 箇所                                       | タスク6.1の前 | タスク6.1の後 | 期待するChromium                                          |
| ------------------------------------------ | ------------- | ------------- | --------------------------------------------------------- |
| `Dockerfile`の`PLAYWRIGHT_VERSION`         | 1.63.0        | 1.63.0        | —(OS依存パッケージの導入だけに使う)                       |
| ルートの`package.json`の`@playwright/test` | 1.63.0        | 1.63.0        | chromium-1243(153.0.8010.12)。共有Chromiumと同じ          |
| `.mcp.json`の`chrome-devtools-mcp`         | 1.10.1        | 1.10.1        | Chrome 153.0.8010.36(同梱の`puppeteer-core` 25.11.0)      |
| `.mcp.json`の`@playwright/mcp`             | 0.0.83        | 0.0.80        | chromium-1247からchromium-1243へ(依存の`playwright-core`) |

- **`@playwright/mcp`を0.0.80へ変更した理由**: 0.0.83の依存`playwright-core`(1.64.0-alpha)はchromium-1247を期待し、共有Chromium(chromium-1243)と一致しなかった。正式版のうち1243に一致するのは0.0.80(`playwright-core` 1.63.0-alpha-2026-08-31)だけだった(0.0.79は1237、0.0.81〜0.0.83は1244・1246・1247)。0.0.80には`browser_emulate_media`ツールが無い。0.0.83以降を使うには、ルートの`@playwright/test`と`Dockerfile`の`PLAYWRIGHT_VERSION`を先に上げる。
- **`chrome-devtools-mcp`を1.10.1のままにした理由**: 同梱の`puppeteer-core`が期待するChromeは共有Chromiumとビルド番号が異なるが、メジャー版(CDPの世代)の153が一致する。ビルド番号まで一致する版は存在しないため、メジャー版の一致と実起動で整合を判断した。
- **起動確認**: 両MCPサーバーを`.mcp.json`と同じ引数でstdio起動し、MCPのJSON-RPC(`initialize`→`notifications/initialized`→`tools/list`→ページを開くツールの`tools/call`)でローカルHTTPサーバーのページを開けた。どちらもブラウザ本体が`CHROMIUM_PATH`から起動され、ページ内で取得したブラウザの版が共有Chromiumの153.0.8010.12と一致し、終了後に残ったブラウザのプロセスは無かった。
- **結論**: 4箇所の版は整合し、両MCPサーバーが共有Chromiumで起動してページを開けた(9.5)。`Dockerfile`の変更とイメージの再ビルドは不要だった。実行中のAIエージェントのセッションは、MCPサーバーを再接続するまで変更前の版を使い続ける(タスク8.1の時点で、実行中のMCPサーバーは`@playwright/mcp@0.0.80`だった)。

### 共有ディレクトリの依存解決(タスク6.2)

- **目的**: 要件8.1・8.2・8.4〜8.7。共有ディレクトリのコードが利用側アプリの依存パッケージを読み込む最小構成で、開発コンテナとCI相当環境の解決結果が一致することを確かめた(2026-10-05、`7bb71bc`時点、Bun 1.4.2)。
- **最小構成**(どちらの環境でも同じファイル。開発コンテナでは確認後に削除した)
  - 利用側`apps/api`
    - `package.json`: AppScriptContractの`lint`・`typecheck`・`test:unit`を持つ。主要パッケージ一覧の版の品質ツール6種と`@types/bun` 1.4.2を導入する。共有ディレクトリのコードが使う`hono` 4.13.13・`drizzle-orm` 1.0.0-rc.4を宣言する。バンドル用に`esbuild` 0.28.1(`wrangler` 4.124.0が固定する版)を導入する。
    - `tsconfig.json`: 基底設定を継承し、差分は`types: ["bun"]`・`experimentalDecorators: true`、`include`への`db/**`・`lib/**`の追加。
    - `eslint.config.ts`: タスク5.4の検証用アプリと同一。
    - `src/app.ts`: 利用側の`eq`に共有側のテーブルの列を渡し、利用側の`Hono`に共有側の`Hono`を`route`で結合する。
  - 共有ディレクトリ
    - `apps/db/schema/products.ts`: `drizzle-orm/sqlite-core`の`sqliteTable`を使う。
    - `apps/backend-lib/di/inject.ts`: パラメータデコレータを定義する。
    - `apps/backend-lib/http/greeting-route.ts`: `hono`をbare importし、コンストラクタ引数にパラメータデコレータを持つ。
    - `apps/backend-lib/probe/resolve-from-shared-dir.ts`: 共有ディレクトリの位置から`import.meta.resolve`を呼ぶ。
  - 単体テスト: 共有側と利用側で`Hono`・`SQLiteTable`の`instanceof`が成り立つことを確かめる。共有ディレクトリの位置からの`import.meta.resolve`が利用側の位置からと一致することも確かめ、解決先の版と実体パスを出力する。
  - バンドル: wrangler 4.124.0の`bundleWorker`がesbuildへ渡す既定値を再現し、esbuildのAPIで`src/index.ts`を組み立ててmetafileを集計した。既定値は`format: esm`・`target: es2024`・`conditions: workerd,worker,browser`・`keepNames`で、`tsconfig`は指定しない。Wranglerでのバンドル(`wrangler deploy --dry-run`)はClaude設定で拒否されるため使っていない。
- **手順**
  - CI相当環境
    1. `git clone`した一時ディレクトリで`CI=true bun install --frozen-lockfile`を実行した(フックは導入されない)。
    2. 最小構成を置き、`apps/api`で`bun install`を実行した。ここで生成した`bun.lock`を両環境で使う。
    3. 配置前に`shared-dirs:verify`・`check`を実行した。
    4. `shared-dirs:place`→`shared-dirs:verify`の後、`apps/api`で型検査・静的解析・単体テスト・バンドル、ルートで`check`・`test:all:unit`を実行した。
    5. 配置先`apps/api/lib`を削除して`check`を実行した。
  - 開発コンテナ
    1. `/proc/self/mountinfo`で、共有側のnode_modulesを利用側へ見せるマウントが0件であることを確かめた(compose.yamlの変更は反映済み)。
    2. 最小構成と上記の`bun.lock`を置き、`apps/api`で`bun install --frozen-lockfile`を実行して同じコマンドを実行した。
    3. 置いたファイルを削除し、`apps/api/node_modules`(名前付きボリューム)の中身を空に戻した。`git status`は検証前と同じく空になった。
- **各コマンドの成否**

| コマンド                         | CI相当環境                                    | 開発コンテナ                                        |
| -------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| `shared-dirs:verify`(配置後)     | 成功(`apps/api/db`・`apps/api/lib`が`copied`) | 成功(`apps/api/db`・`apps/api/lib`が`bind-mounted`) |
| `apps/api`の`typecheck`・`lint`  | 成功                                          | 成功                                                |
| `apps/api`の`test:unit`          | 成功(3件)                                     | 成功(3件)                                           |
| バンドル(esbuild 0.28.1)         | 成功(エラー・警告0件)                         | 成功(エラー・警告0件)                               |
| ルートの`check`・`test:all:unit` | 成功                                          | 成功                                                |

- **解決されたパッケージの版と実体パス**(リポジトリのルートからの相対パス。両環境で同一)

| パッケージ  | 版         | 実行時(共有ディレクトリから)                 | 型検査の読み込み元                      | バンドルの入力                          |
| ----------- | ---------- | -------------------------------------------- | --------------------------------------- | --------------------------------------- |
| hono        | 4.13.13    | `apps/api/node_modules/hono/dist/index.js`   | `apps/api/node_modules/hono`のみ        | `apps/api/node_modules/hono`のみ(1実体) |
| drizzle-orm | 1.0.0-rc.4 | `apps/api/node_modules/drizzle-orm/index.js` | `apps/api/node_modules/drizzle-orm`のみ | `apps/api/node_modules/drizzle-orm`のみ |

- **一致の確かめ方**
  - 実行時の解決先と`realpath`、型検査の読み込み元、バンドルの入力104ファイルとmetafileの集計を両環境で比べ、いずれもdiffが無かった。`bun pm ls --all`と`bun.lock`のハッシュも一致した。
  - 共有ディレクトリ側の`node_modules`へ解決されたファイルは無かった。開発コンテナの`apps/api/db/node_modules`は、ボリュームのマウント先としてホスト側に作られた空のディレクトリで、解決に影響しない。
- **配置の不備の表示**(8.5)
  - 配置前と、`apps/api/lib`を削除した状態の`check`は終了コード1になった。最初の段階が`欠落(missing)`と案内文(CIでは`bun run shared-dirs:place`、ローカルではcompose.yamlのbind mountの確認)を表示した。その後に、`apps/api`の静的解析(`no-unsafe-*`)と型検査(TS2307)の解決エラーが続いた。
  - 配置確認を先に行うのは一括検査だけである。アプリの`test:unit`や`test:all:unit`を単独で実行すると、`Cannot find module '../lib/...'`だけが表示される(設計どおり。CIでは`check`をテストより先に実行する)。
- **対照**(8.4): `apps/api/lib/node_modules`に`hono`を複製すると、`shared-dirs:verify`は`non-empty-node-modules`で失敗した。このとき`bun test`では共有側の`hono`が配置先の`node_modules`へ解決されて`instanceof`が失敗し、バンドルには`hono`が2実体含まれた。型検査は成功したため、二重実体は型検査だけでは検出できない場合がある。
- **デコレータ**(8.3に関わる発見)
  - `tsc`とesbuildは、共有ディレクトリのパラメータデコレータを利用側の`tsconfig.json`の設定で検査・変換した。利用側から`experimentalDecorators`を外すと、`tsc`はTS1206、esbuildは`Parameter decorators only work when experimental decorators are enabled`で失敗した。
  - Bun 1.4.2は、`extends`を持つtsconfigでは`experimentalDecorators`を継承元の値だけで決め、継承する側の指定を無視した。基底設定に指定が無いため、TC39標準のデコレータとして変換され、パラメータデコレータはエラーも出さずに消えた(`bun test`で登録されない)。
  - この挙動は共有ディレクトリに限らず利用側の`src`でも同じで、配置方式とは無関係に両環境で一致した。基底設定に`experimentalDecorators: true`を置くとBunも従来のデコレータとして変換した。関連する報告は[oven-sh/bun#6326](https://github.com/oven-sh/bun/issues/6326)(OPEN)だが、継承元の設定が読まれないという逆向きの報告である。
  - 開発者の判断により、基底設定に`experimentalDecorators: true`を置いた(2026-10-05)。`tsconfig.base.unit.test.ts`が、基底設定を継承したアプリでBunがパラメータデコレータを実行することを確かめる。
  - 「共有ディレクトリの依存解決(実験)」のM2で`bun test`が成功したとした記録は、デコレータが実行されたかまでは確かめていない。
- **結論**
  - 利用側で解決する方式(M2)では、開発コンテナ(bind mount)とCI相当環境(`shared-dirs:place`のコピー)で、各コマンドの成否と、解決されるパッケージの版・実体パスが一致した(8.1・8.2・8.4・8.6)。
  - 配置の不備は一括検査の最初の段階で先に示された(8.5)。
  - Bunのデコレータの扱いは配置方式とは別の課題であり、基底設定で対処した。

## References

- [TypeScript 6.0 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) — 既定値の変更と非推奨オプション
- [Vitest Coverage](https://vitest.dev/guide/coverage) — V8とIstanbulの対応環境
- [Vitest: Configuring Playwright](https://vitest.dev/config/browser/playwright) — `playwright({ launchOptions })`
- [Cloudflare Workers Vitest integration: Known issues](https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/) — Workersでのカバレッジ
- [workers-sdk#12589](https://github.com/cloudflare/workers-sdk/issues/12589)・[#12951](https://github.com/cloudflare/workers-sdk/issues/12951) — Istanbul関連の報告(解決済み)
- 参照したスキル: `cc-sdd:kiro-spec-design`のルール群(design-principles・discovery-full・synthesis・review-gate)
