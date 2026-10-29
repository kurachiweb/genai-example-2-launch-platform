# Cloudflare Workers上のTanStack Startの起動

Cloudflare Workersで動かすTanStack Startアプリを、開発時とデプロイ前にどう起動して動作を確かめるか、及び開発サーバーからWranglerのローカル状態へ接続する設定を定める。あわせて、独自のサーバーのエントリとブラウザのエントリ、サーバー専用のファイルと同型の関数、別プロセスで動くWorkerへのService Bindings、デプロイ先の環境のビルド時の指定を記す。

## 前提と用語

TanStack Startアプリを`@cloudflare/vite-plugin`でCloudflare Workers向けにビルドし、Wranglerでデプロイする構成を前提とする。

| 用語                       | 意味                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 開発サーバー               | `vite dev`で起動するViteの開発サーバー。`@cloudflare/vite-plugin`により、サーバー側の処理をWorkersの実行環境(workerd)で動かす                                                           |
| ビルド結果                 | `vite build`が出力する、デプロイするWorkerと静的アセット                                                                                                                                |
| ローカル状態               | 開発サーバーや`wrangler dev`が読み書きする、D1データベース・R2バケットなどのローカルモードの実データ                                                                                    |
| `<ローカル状態の保存先>`   | ローカル状態を置くディレクトリ。「[Wranglerの設定とコマンドの規約](../infra/001-wrangler-conventions.md#前提と用語)」に従い、全アプリで共通の1つの絶対パスを決め、Gitの管理対象外にする |
| `<インスペクターのポート>` | `@cloudflare/vite-plugin`が起動するWorkerのデバッガー(インスペクター)の待ち受けポート。同時に起動するWorkerごとに異なる値にする                                                         |

## 開発時とデプロイ前の起動

TanStack Startアプリは、通常は`bun run dev`で起動する。`package.json`の`dev`スクリプトには`vite dev`を定義する。

```sh
bun run dev
```

デプロイ前は、`vite build && vite preview`でCloudflare Workers向けにビルドし、ビルド結果をWorkersの実行環境で動かして動作を確かめる。

```sh
vite build && vite preview
```

- 開発サーバーは、モジュールを要求のたびに変換して配信する。デプロイするビルド結果そのものを動かしているわけではないため、バンドルに起因する不具合が開発サーバーでは現れないことがある。
- `vite preview`は、`@cloudflare/vite-plugin`により、ビルド結果をWorkersの実行環境で動かす(Cloudflare Docsの「[Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)」)。
- デプロイ先の環境種別のWrangler設定でビルドする場合は、「[デプロイ先の環境種別](../infra/002-environments.md#デプロイ先の環境種別)」に従い、環境変数`CLOUDFLARE_ENV`に環境種別を指定する。
- シークレットを使う場合は、どちらのコマンドも「[シークレットの注入](../security/001-secret-management.md#シークレットの注入)」に従ってシークレットを注入して実行する。
- 開発サーバーとビルド後のプレビューは同じHTTPポートを使うため、同じアプリで同時に動かさない。
- `vite preview`は、ビルドが出力したWrangler設定(`dist/server/wrangler.json`)で動く。Wrangler設定を変えたらビルドし直す。デプロイ先の環境を指定したビルドの扱いは「[デプロイ先の環境のビルド時の指定](#デプロイ先の環境のビルド時の指定)」に従う。
- Wrangler設定がデプロイ先の環境でシークレットを必須とする(`secrets.required`)場合、注入せずにビルド・プレビューするとWranglerが不足を警告し、ローカル用のシークレットのファイルの作成を案内する。シークレットのファイルは作らず、シークレットの注入を経由して起動する。ローカル環境の設定がシークレットを使わなければ、警告は動作に影響しない。

### Wranglerのローカル状態への接続

TanStack Startアプリの開発サーバーからWranglerのローカル状態へ接続するには、`@cloudflare/vite-plugin`を使用し、`vite.config.ts`で`cloudflare({ persistState: { path: '<ローカル状態の保存先>' } })`と記述する。

```typescript
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      persistState: { path: '<ローカル状態の保存先>' },
      inspectorPort: <インスペクターのポート>,
    }),
    tanstackStart(),
    viteReact(),
  ],
});
```

- `persistState`を指定しないと、`@cloudflare/vite-plugin`は既定の`.wrangler/state`にローカル状態を置く。`--persist-to`で`<ローカル状態の保存先>`を指定して起動する他のアプリと、ローカル状態を共有できない。
- `<ローカル状態の保存先>`には、Wranglerのコマンドの`--persist-to`と同じ値を指定する。詳しくは「[ローカル状態の永続化と共有](../infra/001-wrangler-conventions.md#ローカル状態の永続化と共有)」に従う。
- `inspectorPort`を省くと、`@cloudflare/vite-plugin`は既定の9229から空いているポートを探す。`wrangler dev`の既定も9229のため、起動の順序によっては後から起動したWorkerがポートの衝突で失敗する。同時に起動するWorker(`wrangler dev`で動かすものを含む)のインスペクターのポートが互いに異なるよう、固定の値を指定する。
- `viteEnvironment: { name: 'ssr' }`は、TanStack Startのサーバー側の処理(Viteの`ssr`環境)をWorkerとして動かす指定であり、Cloudflare Docsの「[TanStack Start](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)」の構成に従う。
- 参照: Cloudflare Docsの「[Vite plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/)」・「[Adding local data](https://developers.cloudflare.com/workers/local-development/local-data/)」

## 独自のサーバーのエントリ

Workerの入口に処理(セキュリティヘッダーの付与・IP制限・CSRFの検証・中継など)を加える場合は、TanStack Startの既定のサーバーのエントリを使わず、独自のサーバーのエントリ`src/server.ts`を置く。TanStack Startは`src/server.ts`があれば既定の代わりにそれをサーバーのエントリにし、Wrangler設定の`main`にも同じファイルを指定する。実行時のコード生成を止める設定を先に済ませる部品がある場合は、その読み込みを`src/server.ts`の最初のimportにする(「[実行時のコード生成を試すライブラリ](003-frontend-server-security.md#実行時のコード生成を試すライブラリ)」)。

```jsonc
{
  "main": "src/server.ts",
}
```

```typescript
import handler from '@tanstack/react-start/server-entry';

import type { RequestContext } from './request-context.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const context: RequestContext = { nonce: createNonce() };
    const response = await handler.fetch(request, { context });
    return withHeaders(response, context);
  },
};

declare module '@tanstack/react-start' {
  interface Register {
    server: { requestContext: RequestContext };
  }
}
```

- `@tanstack/react-start/server-entry`の`handler.fetch`の第2引数の`context`に渡した値は、描画とサーバー関数の処理の中で`getGlobalStartContext()`から読める。ルーターを作る関数(`src/router.tsx`の`getRouter`)でも読めるため、要求ごとの値(nonceなど)をルーターの設定に渡せる。
- `Register`の`server.requestContext`に文脈の型を登録すると、`getGlobalStartContext()`の戻り値に型が付く。登録はアプリの`src/server.ts`で1回だけ行う。共有ディレクトリのコードは、利用側アプリによって登録の有無が変わるため、型の無い値として読んで実行時に形を確かめる。
- `src/start.ts`(`createStart`のグローバルのミドルウェア)と`src/router.tsx`(`getRouter`)も、TanStack Startが既定の場所から読み込む。
- Workerの起動時のグローバルスコープでは、ネットワーク通信と重い初期化を行わない。要求ごとの値は`fetch`の中で作る。
- QueryClientやストアなど要求をまたいで共有してはならない値は、`getRouter`の中でルーターを作るたびに作る。

### 環境の型

画面のコードが使う環境の型は、変数・シークレット・バインディングを検証する共通部品のZodのスキーマから作る。画面を持つアプリも`wrangler types`で型を生成するが、生成するのは環境の型(`Env`)だけで、生成した型はWrangler設定とスキーマの型の照合にだけ使い、画面のコードからは読み込まない。

- サーバーのエントリは最初の要求の中で環境をスキーマで検証し、検証済みの値だけを使う。バインディングは共通部品の構造的な型(Service Bindingsの`fetch`を持つ型、Rate Limitingバインディングの`limit`を持つ型)で扱う。生成した`Env`を画面のコードから読まないのは、検証の前の環境の値を使えないようにするためである。
- 生成は`wrangler types --include-runtime=false`で行い、Workersの実行時の型を含めない。実行時の型は`Request`・`Response`などを大域に宣言するため、画面のコードが使うDOMの型と同じ型検査の対象に入れると衝突する。`Env`の型だけなら衝突しない。
- スクリプトは`cf-typegen`(`wrangler types --include-runtime=false`)と`cf-typegen:check`(`wrangler types --include-runtime=false --check && tsc -p tsconfig.worker-env.json`)を置き、生成物`worker-configuration.d.ts`をコミットする。`--check`が失敗した時は、案内に出る`wrangler types`ではなく`bun run cf-typegen`で生成し直す(引数を付けずに実行すると実行時の型を含めてしまう)。
- アプリの`tsconfig.json`の`exclude`に生成物と照合のファイルを加え、画面のコードの型検査から外す。アプリ直下の`*.ts`を`include`に含めると、生成物の`.d.ts`も含まれるためである。

#### スキーマとの型の照合

照合のファイル(例: `test/config/worker-env-contract.ts`)は、生成した`Env`とスキーマの入力の型(`z.input<typeof <環境のスキーマ>>`)を型だけで比べ、次の項目に当てはまるキーの和集合が`never`でなければ型エラーにする。照合のファイルは実行しない。

| 照合                                | 検出する食い違い                                                           |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `Env`のキーがスキーマにある         | Wrangler設定にあり、スキーマが検証しない変数・シークレット・バインディング |
| スキーマの必須のキーが`Env`にある   | スキーマが必須とし、Wrangler設定に無いキー                                 |
| `Env`の型がスキーマの型へ代入できる | 変数の値(リテラルの型)がスキーマの受け付けない値である                     |
| `Env`の型が型の無い値でない         | 宣言の無い実行時の型の名前を参照するバインディング                         |

- 実行時の型を含めない生成物も、バインディングの型として実行時の型の名前(Service Bindingsの`Service`、Rate Limitingバインディングの`RateLimit`など)を宣言なしに参照する。照合のファイルの中で`declare global`により、それらの名前をスキーマが使う構造的な型の別名として宣言する。宣言はこのファイルにだけ置き、画面のコードには及ばない。
- 宣言の無い型の名前は、基底設定の`skipLibCheck: true`により型の定義ファイルの中ではエラーにならず、どの型へも代入できる型になって代入の照合を素通りする。この型は`0 extends 1 & T`では見分けられないため、どの値も満たさない型(`declare const <記号>: unique symbol;`をキーに持つオブジェクトの型)へ`[T] extends [...]`で代入できるかで見分ける。新しい種類のバインディングを加えた時は、照合が失敗するので別名の宣言を足す。
- 生成物は`Cloudflare.GlobalProps`の`mainModule`の型としてサーバーのエントリを`typeof import()`で読み込むため、照合の型検査にはサーバーのエントリとそこから読み込むファイルも含まれる。エントリがモジュールの型を拡張する(`declare module '<パッケージ>'`)場合、そのモジュールを読み込むファイルがプログラムに無いと拡張の対象として解決されず失敗するため、照合のファイルで`import type {} from '<パッケージ>';`として読み込んでおく。
- 照合の型検査の設定`tsconfig.worker-env.json`は、アプリの`tsconfig.json`を継承し、`include`を生成物と照合のファイルに絞り、`exclude`を空にする(`exclude`は継承されるため、空にしないと両方が除かれる)。

```json
{
  "extends": "./tsconfig.json",
  "include": [
    "worker-configuration.d.ts",
    "test/config/worker-env-contract.ts"
  ],
  "exclude": []
}
```

- 静的解析の型情報は、アプリの`tsconfig.json`から外した照合のファイルだけ、`parserOptions`の`projectService: false`と`project: './tsconfig.worker-env.json'`で照合の設定から解決する。
- 型の照合はキーと型の食い違いだけを見る。`wrangler types`はすべての環境の値を1つの`Env`にまとめ(値はリテラルの型の和、一部の環境にだけあるキーは省略可能)、スキーマが省略可能とするキーの環境ごとの欠落は型の上では見えない(スキーマで必須のキーが一部の環境に無いと省略可能になり、代入の照合で失敗する)。値の形式(URLの形・数値の範囲など)と環境ごとの実効の値は、各アプリの`wrangler-config.unit.test.ts`が、すべての環境の実効の値をスキーマの検証に通して検出する。

## 独自のブラウザのエントリ

ブラウザのエントリの先頭に処理(他のどのモジュールより先に評価させる設定の読み込みなど)を加える場合は、独自のブラウザのエントリ`src/client.tsx`を置く。TanStack Startは`src/client.tsx`があれば既定の代わりにそれをブラウザのエントリにし、無ければ自身の既定のエントリを使う。既定のエントリには処理を足せないため、加える処理の後に、既定のエントリと同じ描画の処理を書く。

```tsx
import '<先に評価させるモジュール>';

import { StartClient } from '@tanstack/react-start/client';
import { StrictMode, startTransition } from 'react';
import { hydrateRoot } from 'react-dom/client';

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
```

- TanStack Startは、`vite.config.ts`の`tanstackStart()`に`client.entry`・`server.entry`・`srcDirectory`を指定しなければ、`src`の下の`client`・`server`を拡張子`.ts`・`.js`・`.mts`・`.mjs`・`.tsx`・`.jsx`の順に探し、最初に見つかったファイルをエントリにする。`src/client.ts`など先に探される名前のファイルを同時に置かない。
- 既定の名前のまま使い、`tanstackStart()`にエントリの場所を指定しない。アプリの単体テストで、エントリの場所を変える指定が無いことと、既定の名前で解決されるファイルが`src/client.tsx`・`src/server.ts`であることを確かめる。
- `src/start.ts`・`src/router.tsx`はエントリではなく、ブラウザでは`@tanstack/react-start/client`、サーバーでは`@tanstack/react-start/server-entry`の先で読み込まれる。エントリの最初のimportより後に評価される。
- ブラウザのエントリとして使われたことは、ソースマップ付きのビルド(`vite build --sourcemap`)の出力で、ブラウザ向けの主チャンク(`dist/client/assets/index-*.js`)のソースマップの`sources`に`src/client.tsx`が含まれることで確かめる。確かめた後は、ソースマップを付けずにビルドし直す。
- TanStack Startの版を上げる時は、`src/client.tsx`の描画の処理を、新しい版の既定のブラウザのエントリ(`@tanstack/react-start`の`dist/plugin/default-entry/client.tsx`)と見比べ、違いがあれば合わせる。

## サーバー専用のファイルと同型の関数

TanStack Startのルート・部品・ルーターのファイルは、サーバーとブラウザの両方のバンドルに入る。サーバーだけで動かす処理(要求の文脈の読み取り・Workerの実行環境に依存する処理・サーバー向けのSDKなど)は、次の規約で分ける。

| 種類                   | 書き方                                                                            | ブラウザのバンドル                                                                   |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| サーバー専用のファイル | 名前を`*.server.ts`にする                                                         | 入らない。ブラウザ側から読み込むと`vite build`がエラーにする(開発サーバーは警告だけ) |
| 同型の関数             | `createIsomorphicFn().server(() => …).client(() => …)`で両方の実装を1つにまとめる | `.client`の実装だけが残り、`.server`の実装と、それだけが読み込むファイルは除かれる   |
| ブラウザ専用の関数     | `createClientOnlyFn(() => …)`                                                     | 残る。サーバーのバンドルでは呼ぶと例外を投げる関数に置き換わる                       |

- TanStack StartのViteプラグインは、既定で`**/*.server.*`のファイルをブラウザ向けの環境から読み込むことを禁止する(import protection)。違反の扱いは既定で、`vite build`ではエラーにしてビルドを失敗させ、開発サーバー(`vite dev`)では警告を出すだけで読み込みを続ける。開発サーバーで動いてもビルドで失敗し得るため、違反の警告を見逃さず、ビルド後のプレビューでも確かめる。
- 部品やルートからサーバー専用の処理を使う時は、サーバー専用のファイルを直接読み込まず、同じディレクトリに置いた同型の関数の`.server`の実装から読み込む。部品は同型の関数だけを読み込む。
- ブラウザ専用のSDKなどを遅延で読み込む時は、`createClientOnlyFn`の中で動的`import()`する。サーバーのバンドルからそのSDKが除かれる。
- ブラウザのバンドルに入るファイルが、遅延で読み込むパッケージの実行時の値を静的にimportすると、動的`import()`が別のチャンクに分かれず、パッケージ全体が主バンドルに入る。サーバーだけで使う値は`*.server.ts`から再エクスポートし、同型の関数の`.server`の実装から読み込む。
- 静的解析は、部品から`*.server.ts`(同じディレクトリと親をたどる相対パス)とサーバーの部品の実行時の値を読み込むことを禁止する。動的`import()`と、部品以外のファイルが別のディレクトリの`*.server.ts`を読み込むことは検出しない。
- TanStack StartのViteプラグインの無い環境(Vitestのブラウザテストなど)では、同型の関数は変換されず`.server`の実装が動く。部品のテストでは、同型の関数を含むファイルを読み込まないか、差し替える。
- ルートの設定(`beforeLoad`・`loader`・`component`)をブラウザテストで動かす時は、同型の関数を含むファイルを`vi.mock`で差し替える。差し替えても、Viteはルートが静的に読み込むファイルから依存をたどり、`.server`の実装が読み込むサーバー専用のパッケージ(`@tanstack/react-start/server`など)もブラウザ向けに事前バンドルしようとして解決できず、事前バンドルのキャッシュが無い初回(CIなど)はテストの実行全体が失敗する。そのパッケージを`vitest.browser.config.ts`の`optimizeDeps.exclude`に加える。除いたパッケージは変換の時に解決できない読み込みの警告(`Pre-transform error`)を出すが、ブラウザでは読み込まれないためテストに影響しない。
- 変換の結果は`vite build`の出力で確かめる。ブラウザ向けの出力(`dist/client`)に、サーバー専用のファイルの内容や`node:`のモジュールが含まれないことを確かめる。

## 別プロセスのWorkerへのService Bindings

ローカル環境で、TanStack StartアプリからAPIサーバーなど別のWorkerへService Bindingsで接続する場合は、相手のWorkerを別のプロセス(`wrangler dev`)で先に起動しておく。`@cloudflare/vite-plugin`の`auxiliaryWorkers`で同じプロセスに相手のWorkerを含めない。

```jsonc
{
  "services": [
    {
      "binding": "<バインディング名>",
      "service": "<APIサーバーのWorker名>",
      "entrypoint": "<利用者側のエントリポイント名>",
    },
  ],
}
```

- 開発サーバー(`vite dev`)とビルド後のプレビュー(`vite preview`)のどちらからも、同じマシンで動く`wrangler dev`のWorkerへ、名前付きエントリポイント(`entrypoint`)を含めて到達できる。Wranglerのローカルの登録簿(dev registry)を通して接続する(Cloudflare Docsの「[Multi Workers](https://developers.cloudflare.com/workers/local-development/multi-workers/)」)。
- 相手のWorkerが起動していない間の要求は、相手に届かずに失敗する。起動は相手のWorker→TanStack Startアプリの順に、前のWorkerが応答するのを待ってから次を起動する。
- 相手のWorkerとTanStack Startアプリで`<ローカル状態の保存先>`を同じにし(「[Wranglerのローカル状態への接続](#wranglerのローカル状態への接続)」)、インスペクターのポートを互いに異なる値にする。
- `services`・`ratelimits`などのバインディングはWrangler設定の`env`へ継承されないため、ルートと`env.<環境種別>`のそれぞれに書く。Rate LimitingバインディングはローカルでもRate Limitingの判定を模擬し、`request.cf`(`timezone`など)もローカルで得られる。

## デプロイ先の環境のビルド時の指定

`@cloudflare/vite-plugin`でビルドするアプリは、デプロイ先の環境をビルドの時に環境変数`CLOUDFLARE_ENV`で指定する(「[デプロイ先の環境種別](../infra/002-environments.md#デプロイ先の環境種別)」)。

```sh
CLOUDFLARE_ENV=staging vite build
```

- ビルドは、指定した環境のWrangler設定の実効値(Worker名・バインディング・`ratelimits`・`vars`・`observability`)を`dist/server/wrangler.json`に書き出す。`vite preview`と`wrangler deploy`は、Wrangler設定ではなくこのファイルを使う。環境はビルドの時に決まり、`vite preview`・`wrangler deploy`で環境を指定し直しても効かない(Cloudflare Docsの「[Cloudflare Environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/)」)。
- 環境を指定したビルドは、ローカル環境向けの`dist`を上書きする。ローカル環境でプレビューする前に、環境を指定せずにビルドし直す。
- ビルドは、アプリの`.wrangler/deploy/config.json`(出力したWrangler設定への参照)も作る。`dist`と`.wrangler`はGitの管理対象外にする。
- 指定した環境の`vars`・バインディングの値は、`dist/server/wrangler.json`を読んで確かめられる。
