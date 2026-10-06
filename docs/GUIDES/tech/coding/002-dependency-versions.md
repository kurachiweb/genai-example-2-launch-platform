# 依存パッケージの版管理

版を完全に固定すべき主要パッケージの一覧と、それらを追加・更新する手順を定める。

## 前提

- ワークスペース機能を使わず、ルートと各アプリがそれぞれ`package.json`と`bun.lock`を持つ。そのため、同じパッケージの版はアプリごとに別々に決まり、放置すると食い違う。
- 次のパッケージは、アプリ間で版が食い違うと基底設定・プリセットが動かなくなる、または組み合わせられる版の範囲が狭い。そこで、`^`・`~`の範囲指定を使わずに版を完全に固定し、導入するすべての場所で同じ版にそろえる。
- 品質ゲートの対象外にしたディレクトリ(独自の設定で動かす試作など)は、版をそろえる対象に含めない。

## 主要パッケージの一覧

| パッケージ                                                                                 | 版                                      | 導入先                                               | 固定の理由                                                                                                                        |
| ------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `typescript`                                                                               | 6.0.3                                   | ルート・全アプリ                                     | `typescript-eslint` 8.71.0がTypeScript 6.1未満にしか対応しない                                                                    |
| `eslint`・`@eslint/js`                                                                     | 10.12.0・10.0.1                         | ルート・全アプリ                                     | 静的解析の基底設定の規則と、ファイルごとに最も近い設定ファイルを使う探索に依存する                                                |
| `typescript-eslint`                                                                        | 8.71.0                                  | ルート・全アプリ                                     | 静的解析の基底設定が使う`strictTypeChecked`・`no-deprecated`に依存する                                                            |
| `eslint-config-prettier`                                                                   | 10.1.8                                  | ルート・全アプリ                                     | 整形と静的解析の衝突を避ける                                                                                                      |
| `prettier`                                                                                 | 3.9.9                                   | ルート・全アプリ                                     | 整形結果を一致させる(整形検査はルートの版、エディタ連携はアプリの版で整形する)                                                    |
| `vitest`・`@vitest/browser-playwright`・`@vitest/coverage-v8`・`@vitest/coverage-istanbul` | 4.1.11                                  | ブラウザテスト・Workers統合テストを持つアプリ        | `@cloudflare/vitest-pool-workers`がVitest ^4.1にしか対応しない。`@vitest/browser-playwright`は同じ版の`vitest`だけを前提とする    |
| `@cloudflare/vitest-pool-workers`                                                          | 0.22.0                                  | Workers統合テストを持つアプリ                        | Vitest 4.1系と組み合わせられる版                                                                                                  |
| `wrangler`                                                                                 | 4.124.0                                 | Workers統合テストを持つアプリ                        | `@cloudflare/vitest-pool-workers` 0.22.0が`dependencies`で完全固定する版と一致させ、実体を1つに保つ。`wrangler types`の実行に必要 |
| `drizzle-orm`・`drizzle-kit`                                                               | 1.0.0-rc.4(2つとも同一のプレリリース版) | DBスキーマ定義の共有ディレクトリと、それを使うアプリ | 正式版が無くRCのまま。ORMとマイグレーション生成ツールの版ずれを防ぐ                                                               |
| `@playwright/test`・`playwright`                                                           | 1.63.0                                  | ルート(`playwright`はブラウザテストを持つアプリも)   | 共有のChromiumのリビジョンを決める。開発コンテナのOS依存パッケージの版と一致させる                                                |

- Vitest系はテストの種別に応じて導入する。ブラウザテストを持つアプリは`vitest`・`@vitest/browser-playwright`・`@vitest/coverage-v8`・`playwright`を、Workers統合テストを持つアプリは`vitest`・`@vitest/coverage-istanbul`・`@cloudflare/vitest-pool-workers`・`wrangler`を導入する。
- ルートは`@playwright/test`だけを直接宣言する。`@playwright/test`は`playwright`を、`playwright`は`playwright-core`を、それぞれ完全固定の`dependencies`で持つため、`playwright`・`playwright-core`は推移的に同じ版に決まる。ブラウザテストを持つアプリは、`@vitest/browser-playwright`が使う`playwright`を直接宣言し、同じ版にする。
- 一覧に無いパッケージでも、共有ディレクトリのコードが実行時に使うものは、利用側アプリが共有ディレクトリ側と同じ版で宣言する。

## 更新時の確認事項

一覧のパッケージを更新するときは、パッケージごとに次を確かめる。新しい版の依存関係は`bun pm view <パッケージ>@<版> peerDependencies`・`bun pm view <パッケージ>@<版> dependencies`で調べられる。

### TypeScript

- `typescript-eslint`の`peerDependencies`の`typescript`の範囲に、新しい版が含まれる。含まれない場合は、対応する`typescript-eslint`が出るまで上げない。
- リリースノートで非推奨になったオプションと既定値の変更を確かめ、基底の型検査設定とアプリの差分に非推奨のオプションが残っていない。
- ルートと全アプリの型検査が成功する。

### ESLint・@eslint/js・typescript-eslint・eslint-config-prettier

- 互いの`peerDependencies`の範囲(`typescript-eslint`・`@eslint/js`が求める`eslint`の版など)を満たす。
- 静的解析の基底設定の単体テストが成功する。非推奨の記法が違反になること、書式だけの違いが違反にならないこと、`*.config.ts`で型情報付きの規則が無効になることを確かめるテストである。
- `eslint-config-prettier/flat`の入口が残っている。
- ルートから複数のアプリのファイルを1度に渡したとき、各ファイルが最も近い設定ファイルで検査される(コミット時の検査がこの振る舞いに依存する)。

### Prettier

- ルートで`bun run format:check`を実行し、整形結果が変わったファイルがあれば、機能の変更と分けて整形だけの独立したコミットにする。
- アプリ固有のプラグインを使っている場合は、ルートのPrettierから実行してもプラグインを解決できる。

### Vitest系

- `@cloudflare/vitest-pool-workers`の`peerDependencies`の`vitest`の範囲に、新しい版が含まれる。Vitest 5系ではWorkersのテストプールが起動しないという報告があるため、対応する`@cloudflare/vitest-pool-workers`が出るまで上げない。
- 4つのパッケージを同じ版で同時に更新する。
- ブラウザテストのプリセットの`resolveScreenshotPath`を確認し直す。Vitest 4.1.11は`screenshotDirectory`を指定すると画像比較の基準画像の既定の保存先も変えるため、プリセットは`resolveScreenshotPath`で基準画像の保存先を`<テストのディレクトリ>/__screenshots__/<テストファイル名>/<名前>-<ブラウザ>-<OS><拡張子>`に固定している。更新後も基準画像がこの場所に保存・参照され、失敗時のスクリーンショットと差分画像がGit管理外の出力先に出ることを確かめる。
- カバレッジの閾値がファイル単位で判定され、閾値未達で失敗し、lcovが種別ごとの出力先に書き出される。テストが0件のとき、計測を有効にしない実行が成功する。

### @cloudflare/vitest-pool-workers・wrangler

- `bun pm view @cloudflare/vitest-pool-workers@<版> dependencies`で完全固定されている`wrangler`の版を調べ、`wrangler`をその版にする。2つは同じコミットで更新する。
- `git grep -noE '\["wrangler@[^"]+"' -- '*bun.lock' ':!<対象外のディレクトリ>/'`で、各`bun.lock`に`wrangler`が1つの版だけ載っている。
- `wrangler types`で実行時の型の定義ファイル(`worker-configuration.d.ts`)を生成し直し、差分を確かめてコミットする。
- `@cloudflare/vitest-pool-workers`の`peerDependencies`の`vitest`の範囲が、一覧の`vitest`の版を含む。

### drizzle-orm・drizzle-kit

- 2つを同じ版で同時に更新する。
- プレリリース版は通常`latest`タグの対象にならない。`bun pm view drizzle-orm dist-tags`でプレリリース版のタグ(例: `rc`)と版を確かめ、版を明示して導入する。
- スキーマを変えずにマイグレーションの生成を実行し、新しいマイグレーションが生成されない。スナップショットの形式が変わった場合は、リリースノートの手順に従って移行する。
- ORMを使う全アプリの型検査が成功する。共有ディレクトリのスキーマ定義は、マイグレーションの生成では共有ディレクトリ側のORMで、アプリの型検査と実行では利用側アプリのORMで読み込まれる。版が食い違うと、生成したマイグレーションとアプリの実行とでスキーマ定義の解釈が異なり得る。

### @playwright/test・playwright

- 開発コンテナのOS依存パッケージの版、ルートの`@playwright/test`の版、2つのブラウザ操作MCPサーバーの版の4箇所を整合させる。手順は「[E2Eテストツールの版の更新手順](../testing/002-browser-tool-versions.md)」に従う。
- ブラウザテストを持つアプリの`playwright`も同じ版にする。

## 版を明示した追加手順

一覧のパッケージを追加するときは、次の手順に従う。

1. 一覧で版を確かめる。
2. 追加するディレクトリ(ルートまたはアプリ)で、版を明示し`--exact`を付けて追加する。開発時だけ使うパッケージには`--dev`を付け、実行時に使うパッケージには付けない。

   ```sh
   bun add --dev --exact <パッケージ>@<版>
   bun add --exact <パッケージ>@<版>
   ```

3. `package.json`に`^`・`~`の付かない版が書かれ、`bun.lock`が更新されたことを確かめる。
4. `package.json`と`bun.lock`を同じコミットに含める。

## 全アプリの版をそろえる手順

一覧のパッケージの版を変えるときは、それを使うすべての場所を同じ版にそろえる。

1. 一覧の版を先に更新する。
2. そのパッケージを宣言している`package.json`を探す。`git grep`はGitで管理するファイルだけを検索するため、node_modulesの中は対象にならない。品質ゲートの対象外にしたディレクトリは、除外のパス指定(`':!<対象外のディレクトリ>/'`)で検索から外す。

   ```sh
   git grep -n '"<パッケージ>":' -- '*package.json' ':!<対象外のディレクトリ>/'
   ```

3. 見つかった各ディレクトリで、「[版を明示した追加手順](#版を明示した追加手順)」のコマンドを新しい版で実行する。一緒に動かすパッケージ(Vitest系の4つ、`@cloudflare/vitest-pool-workers`と`wrangler`、`drizzle-orm`と`drizzle-kit`、`@playwright/test`と`playwright`)は同時に更新する。
4. すべての`package.json`と`bun.lock`が同じ版になったことを確かめる。

   ```sh
   git grep -n '"<パッケージ>":' -- '*package.json' ':!<対象外のディレクトリ>/'
   git grep -noE '\["<パッケージ>@[^"]+"' -- '*bun.lock' ':!<対象外のディレクトリ>/'
   ```

5. 「[更新時の確認事項](#更新時の確認事項)」を確かめ、ルートで一括検査(`bun run check`)とテストの一括実行が成功することを確かめる。
6. 変更したすべての`package.json`と`bun.lock`を1つのコミットに含める。

## 版を指定しない追加の禁止

一覧のパッケージを、版を指定せずに追加・更新してはならない。開発者もAIエージェントも同じである。

- 禁止する操作
  - `bun add <パッケージ>`(その時点の`latest`タグの版が`^`付きの範囲で入る)
  - `bun add <パッケージ>@latest`
  - `bun update --latest`(範囲を無視して最新の版へ上げる)
  - `package.json`への`^`・`~`の範囲指定の記述
- 理由
  - 範囲指定のままでは、アプリごとの`bun.lock`が別々の時点で別々の版を解決し、版が食い違う。
  - `latest`タグは通常プレリリース版を指さないため、プレリリース版に固定するパッケージを版の指定なしで追加すると、意図しない古い系列の版が入る。
  - 組み合わせられる版の範囲が狭いパッケージ(Vitest系とWorkersのテストプールなど)は、最新の版にすると動かなくなる。
