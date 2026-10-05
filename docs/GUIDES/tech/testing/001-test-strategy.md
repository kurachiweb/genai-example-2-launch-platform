# テスト戦略

4種のテスト(単体・ブラウザ・Workers統合・E2E)の棲み分けと命名規約、実行コマンド、テストの設定、カバレッジの規約、TDDの進め方、環境シークレットの注入方法を定める。

## 前提と用語

ルート・アプリ・共有ディレクトリ・検査担当の意味は「[JavaScript・TypeScriptの記法と設定ファイルの規約](../coding/001-javascript-typescript-conventions.md#前提と用語)」に従う。

| 用語         | 意味                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 共有Chromium | 開発コンテナに1つだけ導入し、ブラウザテスト・E2Eテスト・ブラウザ操作MCPサーバーが共用するChromium。実行ファイルのパスを環境変数`<共有Chromiumのパスを示す環境変数>`で示す。実際の変数名は、`config/vitest/browser.ts`の`resolveBrowserLaunchOptions`が読む環境変数である。版の合わせ方は「[E2Eテストツールの版の更新手順](002-browser-tool-versions.md)」に従う |
| 一括実行     | ルートから、ルートと全アプリの同名のテストスクリプトを順に実行するコマンド(`bun run test:all:<種別>`)                                                                                                                                                                                                                                                           |
| E2Eの対象    | E2Eテストで操作する、起動済みのアプリ。`e2e/support/targets.ts`で名前(以下`<対象名>`)・既定のURL・URLを上書きする環境変数を定義する                                                                                                                                                                                                                             |

## テストの種別と命名

テストファイルの名前で、使うテストツールと実行環境が決まる。4種の命名は互いに重ならない。

| 種別              | 命名・配置                                  | テストツール                                      | 実行環境                   | 対象                                                              |
| ----------------- | ------------------------------------------- | ------------------------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| 単体テスト        | `**/*.unit.test.ts`                         | Bun(`bun test`)                                   | Bun                        | 関数・クラスなど、ブラウザやWorkersの実行環境を必要としないコード |
| ブラウザテスト    | `**/*.browser.test.{ts,tsx}`                | Vitest Browser Mode(`@vitest/browser-playwright`) | 共有Chromium               | DOMを描画・操作するコード(コンポーネントなど)                     |
| Workers統合テスト | `**/*.worker.test.{ts,tsx}`                 | Vitest(`@cloudflare/vitest-pool-workers`)         | workerd(Workersの実行環境) | リクエストを処理するコード、バインディングを使うコード            |
| E2Eテスト         | `e2e/<対象名>/**/*.e2e.test.ts`(ルートのみ) | Playwright Test(`@playwright/test`)               | 共有Chromium               | 起動済みのアプリに対する、利用者の操作の流れ                      |

- 4種の命名は`config/test-patterns.ts`の`TEST_FILE_PATTERNS`で1箇所に定義する。各テストツールの設定と命名検査はこの定義を参照する。定義を参照できない`bunfig.toml`(TOML形式)と、`package.json`の`test:unit`(コマンドラインの`unit.test`・`--path-ignore-patterns`)には値を書き写す。`bunfig.toml`の除外と、`test:unit`の`--path-ignore-patterns`は、ルートの単体テストで一致を確かめる。
- 単体テストの拡張子は`.ts`だけとする。JSXを描画するテストはブラウザテストにする。
- 単体テスト・ブラウザテスト・Workers統合テストの置き場所は問わない(例: テストするソースの隣)。
- E2Eテストはルートの`e2e/<対象名>/`の下にだけ置く。`e2e/`の外に置いた`*.e2e.test.ts`はどのテストツールにも実行されないため、命名規約外として検出される。

### 他の種別を実行しない仕組み

各テストツールは、自分の種別の命名に一致するファイルだけを実行する。

| テストツール    | 指定                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Bun             | コマンドライン引数`unit.test`(パスの部分一致)で単体テストに絞り、`bunfig.toml`の`pathIgnorePatterns`で他の3種を除外する |
| Vitest          | プリセットの`include`で、実行する種別の命名だけを対象にする                                                             |
| Playwright Test | `playwright.config.ts`が作る各プロジェクトの`testMatch`で、E2Eテストの命名だけを対象にする                              |

- テストは定義済みのスクリプト(`test:unit`など)で実行する。テストツールを直接起動する場合も、スクリプトと同じ設定ファイルの指定と引数を付ける。

### 命名規約外のテストファイルの検出

一括検査(`bun run check`)の段階「テスト命名の検査」(`check:test-names`)は、テストツールがテストとみなす名前のうち、4種のどの命名にも一致しないファイルを検出して失敗する。テストとみなす名前は、`.test.`・`_test.`・`.spec.`・`_spec.`の後にJavaScript・TypeScriptの拡張子(`js`・`ts`・`jsx`・`tsx`・`mjs`・`cts`など)が続く名前である(`config/test-patterns.ts`の`TEST_LIKE_FILE_PATTERN`)。

- 対象は、Gitで管理するファイルと、`.gitignore`で除外していない未追跡のファイルである。品質ゲートの対象外のディレクトリと外部由来のディレクトリ(`config/workspace-layout.ts`で定義)は除く。
- 単独でも`bun run check:test-names`で実行できる。

```text
命名規約に一致しないテストファイルが1件あります。
  <ディレクトリ>/foo.test.ts
テストの種別に合わせて、次のいずれかの命名規約に従う名前へ変更してください。
  単体テスト: **/*.unit.test.ts
  ブラウザテスト: **/*.browser.test.{ts,tsx}
  Workers統合テスト: **/*.worker.test.{ts,tsx}
  E2Eテスト: e2e/**/*.e2e.test.ts
```

### アプリで単体テストを実行するときの共通設定の指定

単体テストの共通設定(他の種別の除外、カバレッジの閾値・除外・出力先)はルートの`bunfig.toml`にある。アプリのディレクトリで`bun test`を実行するときは、`--config`でルートの`bunfig.toml`を明示する。

```sh
bun test --config=../../bunfig.toml --pass-with-no-tests unit.test
```

- Bunは実行したディレクトリの`bunfig.toml`だけを読み、ルートの`bunfig.toml`をさかのぼって読まない。`--config`を省くと、他の種別の除外・カバレッジの閾値・lcovの出力のいずれも適用されない。相対パスは、アプリのディレクトリがルートの2階層下にある場合の例である。
- ルートで実行する場合は、ルートの`bunfig.toml`が自動で読まれるため`--config`は要らない。
- Bun 1.4.2では、コマンドラインの`--path-ignore-patterns`は`bunfig.toml`の`pathIgnorePatterns`に追加されず、置き換わる。除外を加えるアプリは、`bunfig.toml`の`pathIgnorePatterns`もすべて書き写す。例は「[検査担当でないアプリでの共有ディレクトリの除外](../coding/001-javascript-typescript-conventions.md#検査担当でないアプリでの共有ディレクトリの除外)」にある。ルートの単体テストは、各アプリの`test:unit`がこの書き写しを含むことを確かめる。

## 実行コマンド

### アプリとルートでの実行

各アプリは「[スクリプト契約](../coding/001-javascript-typescript-conventions.md#スクリプト契約)」に従い、持っている種別のスクリプトを定義する。アプリのディレクトリで次を実行する。

| 種別              | コマンド               | スクリプトの内容                                                     |
| ----------------- | ---------------------- | -------------------------------------------------------------------- |
| 単体テスト        | `bun run test:unit`    | `bun test --config=../../bunfig.toml --pass-with-no-tests unit.test` |
| ブラウザテスト    | `bun run test:browser` | `vitest run --config vitest.browser.config.ts`                       |
| Workers統合テスト | `bun run test:worker`  | `vitest run --config vitest.worker.config.ts`                        |

- スクリプトに続けた引数は、テストツールへそのまま渡る(例: `bun run test:unit --coverage`)。
- ルートの`bun run test:unit`は、ルートが所有するファイル(設定・ツールのスクリプトなど)の単体テストを実行する。アプリのディレクトリと品質ゲートの対象外のディレクトリを`--path-ignore-patterns`で除外し、`bunfig.toml`の除外も書き写している。
- E2Eテストはルートでだけ実行する(「[E2Eテストの実行](#e2eテストの実行)」)。

### 一括実行

ルートで次を実行すると、ルートと各アプリの同名のスクリプトを順に実行する。

| コマンド                   | 実行するスクリプト |
| -------------------------- | ------------------ |
| `bun run test:all:unit`    | `test:unit`        |
| `bun run test:all:browser` | `test:browser`     |
| `bun run test:all:worker`  | `test:worker`      |

- 追加の引数(`--coverage`など)は、各スクリプトへそのまま渡る。
- ルートの次に、`config/workspace-layout.ts`の`APPS`の順に1つずつ実行する。途中で失敗しても止めずに最後まで実行し、1つでも失敗があれば終了コード1で終える。
- 最後に段階・対象・結果の表と件数を表示する。`package.json`の無いアプリは「飛ばした(プロジェクト未作成)」、スクリプトの無いアプリ(ルートの`test:browser`など)は「飛ばした(スクリプト未定義)」となり、失敗にはならない。

```text
段階                            対象        結果
Workers統合テスト(test:worker)  ルート      飛ばした(スクリプト未定義)
Workers統合テスト(test:worker)  <アプリ名>  失敗(終了コード1)
Workers統合テスト(test:worker)  <アプリ名>  飛ばした(スクリプト未定義)
Workers統合テスト(test:worker)  <アプリ名>  飛ばした(プロジェクト未作成)
成功0件・失敗1件・飛ばした3件
```

### E2Eテストの実行

1. E2Eの対象のアプリを起動しておく。E2Eテストの設定はアプリを起動しない。
2. ルートで`bun run test:e2e`(`playwright test --pass-with-no-tests`)を実行する。

- 対象ごとに、テストの前に到達確認のプロジェクト(`<対象名>-reachability`)を実行する。対象のURLへHTTPのGETリクエストを送り、状態コードに関係なく応答があれば成功とし、リダイレクトは辿らない。接続できない・10秒以内に応答が無い・URLとして解釈できない場合は、その対象のテストを実行せずに`E2E対象に到達できません: <対象のURL>`で失敗する。
- 対象のURLは、`e2e/support/targets.ts`で対象ごとに定義した環境変数で上書きできる(デプロイ先の検証環境に対して実行する場合など)。空文字は未設定と同じ扱いになり、既定のURLが使われる。

```sh
<対象のURLを示す環境変数>=<対象のURL> bun run test:e2e
```

- `e2e/<対象名>/`に`*.e2e.test.ts`が1つも無い対象は、プロジェクトが作られず実行されない。
- 成果物は`test-results`(失敗時のエラーの文脈を記した`error-context.md`など)とHTMLレポートの`playwright-report`に出力する。トレース・スクリーンショット・動画は、Playwright Testの既定では記録されず、`--trace`の指定や設定の`use`(`trace`・`screenshot`・`video`)で有効にしたときに`test-results`へ出る。どちらもルートの`.gitignore`でGit管理外にする。HTMLレポートは自動で開かない(`open: 'never'`)。失敗時にレポートの配信サーバーが待ち続け、コマンドが終わらなくなるのを避けるためである。
- `playwright test`は、実行ファイルのshebangにより`PATH`上の`node`で起動する。Nodeで実行する環境では、Node 22.5.0以上(20系では20.17.0以上)が要る。`playwright.config.ts`が`node:path`の`matchesGlob`と`import.meta.dirname`を使うためである。

### 対象が0件のとき

ある種別のテストがまだ1つも無くても、カバレッジ計測を有効にしない実行は失敗せず、0件であったことを表示して正常終了する。

| 種別                        | 指定                                                                                    | 表示                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 単体テスト                  | `--pass-with-no-tests`                                                                  | `The following filters did not match any test files` |
| ブラウザ・Workers統合テスト | プリセットの`passWithNoTests: true`                                                     | `No test files found, exiting with code 0`           |
| E2Eテスト                   | `--pass-with-no-tests`と、0件を表示するレポーター(`e2e/support/zero-tests-reporter.ts`) | `実行対象のE2Eテストは0件です`                       |

- Playwright Testの標準のレポーターは0件のとき何も表示しないため、専用のレポーターで0件であったことを表示する。
- カバレッジ計測を有効にした実行の扱いは「[対象0件と計測の関係](#対象0件と計測の関係)」に従う。

### 絞り込んだ実行

TDDの各段階では、書いているテストだけを実行する。

| 種別              | コマンド                                            | 実行場所       |
| ----------------- | --------------------------------------------------- | -------------- |
| 単体テスト        | `bun run test:unit ./<テストファイルのパス>`        | アプリ・ルート |
| ブラウザテスト    | `bun run test:browser <テストファイルのパスの一部>` | アプリ         |
| Workers統合テスト | `bun run test:worker <テストファイルのパスの一部>`  | アプリ         |
| E2Eテスト         | `bun run test:e2e <テストファイルのパスの一部>`     | ルート         |

- 単体テストでは、`./`で始まるパスを渡すと、そのファイルだけを実行する。`./`で始まらない文字列はフィルタとして扱われ、スクリプトの`unit.test`とどちらかに一致する全ファイルが実行されるため、絞り込めない。
- テスト名で絞り込むには、BunとVitestでは`-t <テスト名の一部>`、Playwright Testでは`-g <テスト名の一部>`を付ける。
- E2Eテストを対象で絞り込むには`bun run test:e2e --project <対象名>`を実行する。到達確認のプロジェクトも依存として実行される。

## テストの設定

### 共通設定の置き場所

| ファイル                               | 内容                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config/test-patterns.ts`              | 4種の命名(`TEST_FILE_PATTERNS`)、テストとみなす名前(`TEST_LIKE_FILE_PATTERN`)、自動生成コードの命名(`GENERATED_CODE_PATTERNS`)、カバレッジの閾値(`COVERAGE_THRESHOLD_PERCENT`) |
| `bunfig.toml`                          | 単体テストの共通設定(他の種別の除外、カバレッジの閾値・除外・出力先)                                                                                                           |
| `config/vitest/browser.ts`             | ブラウザテストのプリセット(`browserTestPreset`・`browserOptionsPreset`)と、共有Chromiumの起動オプションを返す`resolveBrowserLaunchOptions`                                     |
| `config/vitest/worker.ts`              | Workers統合テストのプリセット(`workerTestPreset`)                                                                                                                              |
| `playwright.config.ts`・`e2e/support/` | E2Eテストの設定、E2Eの対象の定義、到達確認、0件を表示するレポーター                                                                                                            |

- プリセットはnpmパッケージの値をimportせず、定数と関数だけを提供する。テストツールのプロバイダとプラグイン(`playwright()`・`cloudflareTest()`)は、アプリが自分のnode_modulesからimportして組み立てる。基底設定と同じく、値をimportするとルートに導入した版が使われるためである。
- 設定ファイル(`vitest.<種別>.config.ts`・`playwright.config.ts`)はWorkersの実行環境ではなくBun・Node上で評価されるため、`process.env`を読んでよい。

### ブラウザテストの設定

ブラウザテストを持つアプリは`vitest.browser.config.ts`を置き、プリセットを取り込む。

```typescript
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import {
  browserOptionsPreset,
  browserTestPreset,
  resolveBrowserLaunchOptions,
} from '../../config/vitest/browser.ts';

export default defineConfig({
  test: {
    ...browserTestPreset,
    coverage: {
      ...browserTestPreset.coverage,
      include: ['<ブラウザテストが担当するソースのディレクトリ>/**/*.{ts,tsx}'],
    },
    browser: {
      ...browserOptionsPreset,
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: resolveBrowserLaunchOptions(process.env),
      }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
```

- `resolveBrowserLaunchOptions`は、`<共有Chromiumのパスを示す環境変数>`が設定されていれば、その実行ファイルを起動する`executablePath`を返す。未設定か空文字なら何も指定せず、Playwrightが導入済みのブラウザを使う。どちらのブラウザも無い環境では、実行時にダウンロードせず`Executable doesn't exist`で失敗する。
- 失敗時のスクリーンショット・添付ファイル・画像比較の差分画像は、Git管理外の`.vitest-attachments`の下に出る。画像比較(`toMatchScreenshot`)の基準画像は、テストファイルの隣の`__screenshots__/<テストファイル名>/`に保存してコミットする。
  - 基準画像が無い初回は、基準画像を作成したうえで失敗する。作られた画像を確かめてから再実行する。
  - 意図した見た目の変更は、`bun run test:browser --update`で基準画像を更新する。
- 導入するパッケージと版は「[依存パッケージの版管理](../coding/002-dependency-versions.md#主要パッケージの一覧)」に従う。

### Workers統合テストの設定

Workers統合テストを持つアプリは`vitest.worker.config.ts`を置き、プリセットを取り込む。

```typescript
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

import { workerTestPreset } from '../../config/vitest/worker.ts';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    ...workerTestPreset,
    coverage: {
      ...workerTestPreset.coverage,
      include: ['<Workers統合テストが担当するソースのディレクトリ>/**/*.ts'],
    },
  },
});
```

- workerdではV8のカバレッジ計測を使えないため、プリセットはIstanbul(`@vitest/coverage-istanbul`)で計測する。
- テストからWorkerを呼び出すには`cloudflare:workers`の`exports`を使う。`cloudflare:test`の`SELF`・`env`は非推奨のため使わない。

```typescript
import { exports } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

describe('fetchハンドラー', () => {
  test('クエリで指定した名前への挨拶を返す', async () => {
    const response = await exports.default.fetch(
      'https://app.example/?name=Bun',
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello, Bun!');
  });
});
```

- 型検査設定の差分は「[Workers統合テストを持つアプリの差分](../coding/001-javascript-typescript-conventions.md#workers統合テストを持つアプリの差分)」に従う。
- `wrangler types`が出力する`worker-configuration.d.ts`(実行時の型と環境の型)を生成してコミットする。`wrangler types --check`で、生成し直しが要るかを確かめられる。

### プリセットの取り込みの注意

- 設定のスプレッドは浅いため、`coverage`や`browser`を書くときは、プリセットの`coverage`(`...browserTestPreset.coverage`・`...workerTestPreset.coverage`)と`browserOptionsPreset`も展開する。
- 展開を漏らすと、閾値・lcovの出力・出力先・成果物の置き場所がVitestの既定に戻る。型検査・静的解析では検出できない。
  - ブラウザテストの`coverage`: `--coverage`付きでも閾値で失敗せず、`coverage/`の直下にVitestの既定の形式で出力する。Vitestは実行前に出力先を消すため、他の種別のlcov(`coverage/unit`など)も消える。
  - ブラウザテストの`browser`: 失敗時のスクリーンショットが、Git管理外の`.vitest-attachments`ではなくテストファイルの隣に出る。
  - Workers統合テスト: プリセットの`provider: 'istanbul'`が失われ、`--coverage`付きの実行がVitestの既定の`@vitest/coverage-v8`を探す。端末以外からの実行では`MISSING DEPENDENCY`で失敗し、端末からの実行では導入するかを対話で尋ねて止まる。承諾すると使わないパッケージが版の指定なしで導入されるため、断って展開漏れを直す。
- 共有ディレクトリの配置先を外す方法は「[検査担当でないアプリでの共有ディレクトリの除外](../coding/001-javascript-typescript-conventions.md#検査担当でないアプリでの共有ディレクトリの除外)」に従う。

### E2Eテストの設定

- E2Eテストの設定はルートの`playwright.config.ts`だけが持ち、`e2e/support/`の関数で組み立てる。テストファイルを`e2e/<対象名>/`に追加するだけで実行対象になる。
- E2Eの対象を加えるときは、`e2e/support/targets.ts`の対象の定義(`E2E_TARGET_DEFINITIONS`)に名前・既定のURL・URLを上書きする環境変数を加え、型`E2ETargetName`にも名前を加える。
- テストでは、対象のURL(`use.baseURL`)からの相対パスでページを開く。

```typescript
import { expect, test } from '@playwright/test';

test('トップページの見出しを表示する', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
```

- ブラウザは、ブラウザテストと同じく`resolveBrowserLaunchOptions`の起動オプションで共有Chromiumを起動する。
- E2Eテストのカバレッジは計測しない。

## カバレッジ

単体テスト・ブラウザテスト・Workers統合テストは、カバレッジ計測を有効にした実行で、ファイルごとの行と関数のカバレッジが80%以上であることを求める。E2Eテストのカバレッジは計測しない。

### 閾値

| 種別              | 計測方式                              | 閾値の指定                                                                     |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| 単体テスト        | Bun                                   | `bunfig.toml`の`coverageThreshold = 0.8`                                       |
| ブラウザテスト    | V8(`@vitest/coverage-v8`)             | プリセットの`coverage.thresholds`(`lines`・`functions`が`80`、`perFile: true`) |
| Workers統合テスト | Istanbul(`@vitest/coverage-istanbul`) | 同上                                                                           |

- 判定はファイル単位で、80%を下回るファイルが1つでもあれば失敗する。全体の集計値では判定しない。Vitestの閾値は既定では全体の集計値で判定されるため、プリセットは`perFile: true`でBunと判定の単位をそろえる。
- 閾値の値は`config/test-patterns.ts`の`COVERAGE_THRESHOLD_PERCENT`に定義する。`bunfig.toml`はTOML形式で参照できないため、同じ値を書き写す。

### 計測の有効化

- カバレッジは`--coverage`を付けた実行でだけ計測し、閾値で判定する。付けない実行では計測も判定も行わない(プリセットは`coverage.enabled`を指定しない)。
- TDDの途中は`--coverage`を付けずに実行し、仕上げにアプリで`--coverage`を付けて実行する。
- CIでは、一括実行に`--coverage`を付けて実行し、閾値の未達をCIの失敗にする。一括実行は`--coverage`を各アプリのスクリプトへ渡し、いずれかのアプリの閾値の未達を一括実行の失敗(終了コード1)にする。

```sh
bun run test:all:unit --coverage
bun run test:all:browser --coverage
bun run test:all:worker --coverage
```

### 分母からの除外

- テストファイル自身
  - Bunは`bunfig.toml`の`coverageSkipTestFiles = true`で除外する。
  - Vitestは実行中の種別のテストファイルだけを自動で除外し、他の種別のテストファイルは除外しない(`coverage.exclude`の既定は空)。そのため、プリセットの`coverage.exclude`に4種すべての命名を入れている。
- 自動生成コード
  - `**/*.gen.ts`・`**/generated/**`(`GENERATED_CODE_PATTERNS`)を、Bunは`bunfig.toml`の`coveragePathIgnorePatterns`で、Vitestはプリセットの`coverage.exclude`で除外する。
  - 自動生成コードは、必ず`*.gen.ts`という名前か`generated/`ディレクトリの下に出力する。この形でない自動生成コードは分母に入る。

### 計測対象の指定

- 単体テスト(Bun)は、テストから読み込まれたファイルだけを分母に数える。
- ブラウザテスト・Workers統合テスト(Vitest)は、`coverage.include`に一致するすべてのファイルを、テストから読み込まれなくても0%として分母に数える。そのため各アプリは`coverage.include`を必ず指定し、その種別のテストが担当するソースだけに絞る。
  - 他の種別のテストで検査するソースを含めると、そのソースは0%として数えられ、閾値で失敗する(例: 単体テストで検査するユーティリティを、ブラウザテストの`coverage.include`に含める)。
  - 検査担当でないアプリは、共有ディレクトリの配置先を`coverage.include`に含めない。

### 対象0件と計測の関係

| 実行                                        | テストが0件のときの結果                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 計測無効                                    | どの種別も成功する(「[対象が0件のとき](#対象が0件のとき)」)                                                            |
| 計測有効・単体テスト                        | 成功する(読み込まれたファイルが無いため)                                                                               |
| 計測有効・ブラウザテスト・Workers統合テスト | `coverage.include`に一致するソースがあれば、0%として閾値で失敗する。一致するソースが無ければ成功し、空のlcovを書き出す |

- テストの無いソースを、CIの計測付きの実行で未達として検出するためである。テストをまだ書いていないソースを`coverage.include`に含めると、CIが失敗する。
- この場合は`No test files found, exiting with code 0`と表示された後に、閾値の判定によって終了コード1で終わる。

### 出力先

| 種別              | 出力先             | 形式                                                          |
| ----------------- | ------------------ | ------------------------------------------------------------- |
| 単体テスト        | `coverage/unit`    | 端末への表(`text`)と`lcov.info`(`lcov`)                       |
| ブラウザテスト    | `coverage/browser` | 端末への表(`text`)と`lcov.info`・HTMLの`lcov-report/`(`lcov`) |
| Workers統合テスト | `coverage/worker`  | 同上                                                          |

- 出力先は、テストを実行したディレクトリからの相対パスである。
- 閾値で失敗した場合もlcovは書き出される。
- Vitestは実行前に自分の出力先だけを消す。種別ごとに出力先が分かれているため、他の種別の出力は残る。
- 出力先はGit管理外にする。ルートの`.gitignore`に`coverage`(先頭に`/`を付けない)と書けば全階層に効くため、アプリに`.gitignore`は要らない。
- lcovの`SF:`のパスは、実行したディレクトリからの相対パスになる。CIで複数のアプリのlcovを合算するときは、各パスの前にアプリのディレクトリを付ける。

### 未達時の表示

単体テスト(Bun)は、未達を示す専用のメッセージを表示しない。表の`% Funcs`・`% Lines`の実測値と、終了コード1で判断する(端末では未達の値が赤で表示される)。テスト自体がすべて成功していても、閾値の判定で失敗する。

```text
---------------------|---------|---------|-------------------
File                 | % Funcs | % Lines | Uncovered Line #s
---------------------|---------|---------|-------------------
All files            |   66.67 |   71.43 |
 src/clamp.ts        |  100.00 |  100.00 |
 src/partial.ts      |   33.33 |   42.86 | 2-3,6-7
---------------------|---------|---------|-------------------

 4 pass
 0 fail
```

ブラウザテスト・Workers統合テスト(Vitest)は、未達のファイルごとに指標・実測値・閾値を1行で表示する。ファイル単位の判定でも、文言は`global threshold`になる。

```text
ERROR: Coverage for functions (20%) does not meet global threshold (80%) for src/functions-gap.ts
ERROR: Coverage for lines (33.33%) does not meet global threshold (80%) for src/lines-gap.ts
```

- AIエージェントから実行すると、Vitestは出力の形式を変える(テストファイルごとの行と色を省き、カバレッジの表から100%のファイルを省く)。終了コードと`ERROR`の行は変わらない。

## TDDの進め方

新しい振る舞いは、失敗するテストを先に書いてから実装する。

1. テストの種別を選ぶ。

   | 確かめたいこと                                                                     | 種別              |
   | ---------------------------------------------------------------------------------- | ----------------- |
   | ブラウザやWorkersの実行環境を使わない計算・変換・判定                              | 単体テスト        |
   | DOMへの描画と、利用者の操作への反応                                                | ブラウザテスト    |
   | リクエストの処理と、バインディング(データベース・ストレージ・キューなど)を使う処理 | Workers統合テスト |
   | 起動したアプリに対する、画面をまたぐ利用者の操作の流れ                             | E2Eテスト         |

2. RED: 種別の命名でテストファイルを作り、「[絞り込んだ実行](#絞り込んだ実行)」のコマンドでそのテストだけを実行し、失敗することを確かめる。失敗の理由が、まだ実装していない振る舞いであること(読み込みのエラーや命名の誤りではないこと)も確かめる。
3. GREEN: テストを通す最小の実装を書き、同じコマンドで成功を確かめる。
4. REFACTOR: テストを成功させたまま、重複の除去や名前の改善を行う。
5. アプリで、書いた種別のスクリプトを`--coverage`付きで実行し、変更したファイルが閾値を満たすことを確かめる(例: `bun run test:unit --coverage`)。
6. ルートで一括検査(`bun run check`)と、変更した種別の一括実行(`bun run test:all:<種別>`)が成功することを確かめる。

テストは次のように書く。

- 準備・実行・検証(Arrange・Act・Assert)の順に書く。
- テスト名には、確かめる振る舞いを書く(例: 「クエリで指定した名前への挨拶を返す」)。
- 一時ファイル・一時ディレクトリなどのフィクスチャはリポジトリ内に作らず、OSの一時ディレクトリ(`mkdtemp(join(tmpdir(), '<接頭辞>-'))`)に作り、テストの後で消す。リポジトリ内に残ると、整形検査・静的解析・命名検査の対象に紛れ込む。
- テストが失敗したときは、テストが誤っている場合を除き、テストではなく実装を直す。

## 環境シークレットの注入

環境シークレットを必要とするテストは、シークレット管理サービス(Infisical)のCLIで、実行時にシークレットを注入して実行する。

```sh
infisical run --env <環境種別> -- bun run test:worker
infisical run --env <環境種別> -- bun run test:all:worker --coverage
```

- `infisical run`は、指定した環境種別のシークレットを環境変数として`--`の後のコマンドへ渡す。プロジェクトで決めた共通のオプションがあれば、`infisical`の直後に付ける。
- シークレットをファイルに書き出さない。シークレットを置く`.env`・`.dev.vars`などのファイルを作らず、テストのコード・フィクスチャ・スナップショットにも値を書かない。
- シークレットの値を標準出力やログに表示しない。テストの失敗メッセージにも値を含めない。
- 設定ファイル(`vitest.<種別>.config.ts`など)はBun・Node上で評価されるため、注入された値を`process.env`で読める。Workersの実行環境で動くコードからシークレットを参照するための設定は、[securityの索引](../security/README.md)から辿る文書に従う。
