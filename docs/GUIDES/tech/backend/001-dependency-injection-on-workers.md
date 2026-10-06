# Cloudflare Workersでの依存性注入

InversifyによるDI(依存性注入)を使うコードを、WranglerやViteでバンドルしてCloudflare Workersで動かすときの、コンストラクタ引数の注入先の指定方法を定める。

## 前提と用語

DIコンテナにInversifyを使い、WranglerまたはVite(`@cloudflare/vite-plugin`)でバンドルしたコードをCloudflare Workersで動かす構成を前提とする。デコレータの設定(基底の型検査設定が`experimentalDecorators: true`を持ち、アプリの`tsconfig.json`で上書きしないこと、標準(TC39)のデコレータを使わないこと)は「[デコレータの設定](../coding/001-javascript-typescript-conventions.md#デコレータの設定)」に従う。

| 用語               | 意味                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 識別子             | Inversifyのコンテナへ依存を登録し、解決するときのキー(`Symbol`・文字列・クラス)                                                                                    |
| 型情報のメタデータ | TypeScriptの`emitDecoratorMetadata`を有効にしたとき、変換器がデコレータ付きのクラスに出力する型の情報。コンストラクタ引数の型は`design:paramtypes`として出力される |
| 型からの自動解決   | コンストラクタ引数に`@inject`を付けず、型情報のメタデータが示す引数の型(クラス)を識別子として解決すること                                                          |
| 変換器             | TypeScriptをJavaScriptへ変換するツール。Wranglerのバンドルではesbuild、Vite 8ではRolldownに組み込まれたOxc、`bun test`・`bun build`ではBun自身が変換する           |

## コンストラクタ引数の注入

Inversifyで注入するクラスのコンストラクタ引数には、必ず`@inject(<識別子>)`を明示し、型からの自動解決を避ける。

```typescript
import { inject, injectable } from 'inversify';

import type { ArticleRepository } from './article-repository';
import { TYPES } from './types';

@injectable()
export class PublishArticle {
  constructor(
    @inject(TYPES.ArticleRepository)
    private readonly articles: ArticleRepository,
  ) {}
}
```

- 理由: WranglerやViteなどのバンドル処理では、`emitDecoratorMetadata`を前提にできない。型からの自動解決は型情報のメタデータを前提とするため、メタデータを出力しない変換器でバンドルすると解決できない。
  - Wranglerのバンドルに使われるesbuildは、`tsconfig.json`で`emitDecoratorMetadata: true`を指定しても型情報のメタデータを出力せず、エラーも警告も出さない。
  - 変換器によっては型情報のメタデータを出力するため、テストやビルドの経路によって自動解決の成否が食い違う。`emitDecoratorMetadata`を有効にして自動解決に頼ると、単体テストでは解決できたコードが、Wranglerでバンドルした後の実行時に初めて失敗する。
  - `@inject`を明示すれば、型情報のメタデータの有無に関わらず、どの変換器でも同じ識別子で解決される。
- `emitDecoratorMetadata`は有効にしない(「[デコレータの設定](../coding/001-javascript-typescript-conventions.md#デコレータの設定)」)。
- インターフェースや型エイリアスはJavaScriptに残らないため、型情報のメタデータを出力する変換器でも、その引数の型は`Object`として出力され、自動解決できない。依存をインターフェースで受け取る場合も、`@inject`で識別子を指定する。

### 変換器ごとの型情報のメタデータの出力

基底の型検査設定と同じく`experimentalDecorators: true`とし、さらに`emitDecoratorMetadata: true`を加えた`tsconfig.json`で、`@injectable()`のクラスのコンストラクタ引数に`@inject`を付けたコードを変換して確かめた結果は次のとおり。

| 変換器                                               | パラメータデコレータ(`@inject`) | 型情報のメタデータ(`design:paramtypes`) |
| ---------------------------------------------------- | ------------------------------- | --------------------------------------- |
| esbuild 0.28.1(Wrangler 4.124.0がバンドルに使う版)   | 出力する                        | 出力しない(エラー・警告なし)            |
| Vite 8.3.1の`vite build`(Rolldown 1.2.12のOxcで変換) | 出力する                        | 出力する                                |
| Bun 1.4.2の`bun test`・`bun build`                   | 出力する                        | 出力する                                |

- WranglerやViteなどの版を更新して変換器が変わる場合も、`@inject`を明示していれば注入の結果は変わらない。
