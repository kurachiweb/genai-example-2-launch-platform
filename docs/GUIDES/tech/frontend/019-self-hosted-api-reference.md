# 自前で配信するAPIリファレンス

公開REST APIのOpenAPIの仕様書を、Swagger UIで画面に表示するページの規約を定める。Swagger UIの配布物を外部の配信網から読まずに画面のオリジンから配信すること、ブラウザ専用の関数と動的な`import()`による遅延読み込み、仕様書の取得とサーバーのURLの補正、外部の検証サービスを使わず入力したキーを保存しない描画の設定、描画先の明るい配色の固定、CSPの許可先、導入時に外部へ統計を送る依存の停止、ビルドの出力の確認、及びテストを扱う。

仕様書の配信と相対のサーバーのURLは「[公開REST APIの骨格](../backend/005-public-rest-api.md#openapi仕様の配信)」に、APIキーの認証は「[APIキーによる認証と回数の制限](../backend/020-api-key-authentication.md)」に、ページのCSPと許可先の登録は「[フロントエンドサーバーのセキュリティ](003-frontend-server-security.md#csp)」に、ブラウザ専用の関数は「[サーバー専用のファイルと同型の関数](002-tanstack-start-on-workers.md#サーバー専用のファイルと同型の関数)」に、パッケージの追加は「[依存パッケージの版管理](../coding/002-dependency-versions.md#版を明示した追加手順)」に従う。

## 前提と用語

画面のアプリにTanStack Start、APIリファレンスの描画に`swagger-ui-dist`(Swagger UIのビルド済みの配布物)を使う構成を前提とする。部品の置き場所は、画面のアプリの`src/`からのパスで示す。`<ドメイン>`は公開APIの画面の機能のディレクトリの名前に置き換える。

| 部品                                                                | 置き場所                                      | 役割                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| `createSwaggerUiLoader`・`loadSwaggerUi`                            | `components/<ドメイン>/swagger-ui-loader.ts`  | 配布物の束とスタイルの遅延読み込みと、描画の設定を固定した描画の関数     |
| `SwaggerUiViewer`                                                   | `components/<ドメイン>/swagger-ui-viewer.tsx` | 仕様書の取得・描画・読み込み中と失敗の表示。読み込み関数を差し替えられる |
| `openApiDocumentUrl`・`withAbsoluteServers`・`fetchOpenApiDocument` | `components/<ドメイン>/openapi-document.ts`   | 仕様書のURL、サーバーのURLの絶対URL化、仕様書の取得                      |
| 配布物の型の宣言                                                    | `components/<ドメイン>/swagger-ui-dist.d.ts`  | 型定義を持たない配布物の、使う部分だけの宣言                             |
| APIリファレンスのページとルート                                     | `components/<ドメイン>/`・`routes/`           | 見出しと説明、その下のビューアー。ログインを求めない                     |

| 用語                                   | 意味                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 配布物の束                             | 配布物の`swagger-ui-bundle.js`。ブラウザ向けにSwagger UIと依存をまとめたスクリプト                                                |
| 描画先                                 | Swagger UIが中身を作る要素。Reactは子を描かない                                                                                   |
| 読み込み関数                           | 配布物の束とスタイルを動的な`import()`で読み込み、描画の関数を返す唯一の関数                                                      |
| `<APIリファレンスのページのパス>`      | APIリファレンスを表示するページのパス                                                                                             |
| `<公開APIのオリジンの変数>`            | 「[フロントエンドサーバーのセキュリティ](003-frontend-server-security.md#許可先の登録)」と同じ。公開APIのオリジンを持つ任意の変数 |
| `<公開APIのオリジン>`                  | 公開APIのオリジン。`<公開APIのオリジンの変数>`の値                                                                                |
| `<公開RESTの基準パス>`・`<仕様の経路>` | 「[公開REST APIの骨格](../backend/005-public-rest-api.md#前提と用語)」と同じ                                                      |

本文中のプレースホルダーの本プロジェクトの値は、技術ドキュメントに写さず、プロジェクト固有の値の文書「[本プロジェクト固有の値](../../../onboardings/project-values.md)」に置く。

## 同一オリジンからの配信

- Swagger UIのスクリプトとスタイルを外部の配信網から読まず、画面のアプリの依存として入れた配布物を、ビルドの出力の一部として画面のオリジンから配信する。CSPの`script-src`・`style-src`に外部のオリジンを加えずに済み、閲覧者の情報が外部の配信網へ渡らず、配信網の内容の差し替えの影響も受けない。
- 配布物の入口(パッケージの`main`)はNode.jsの組み込みモジュールを読むため、ブラウザで使えない。ブラウザ向けの束`swagger-ui-dist/swagger-ui-bundle.js`とスタイル`swagger-ui-dist/swagger-ui.css`をパスで直接読み込む。
- 配布物は型定義を持たないため、使う部分(束の既定のエクスポートの関数と`presets.apis`)だけを`declare module 'swagger-ui-dist/swagger-ui-bundle.js'`で宣言する。
- 配布物は版を完全に固定して入れる(「[版を明示した追加手順](../coding/002-dependency-versions.md#版を明示した追加手順)」)。配布物は依存に導入時の統計を外部へ送るパッケージを含むため、入れるディレクトリの`package.json`で送信を止める(「[導入時に外部へ送信するパッケージ](../coding/002-dependency-versions.md#導入時に外部へ送信するパッケージ)」)。

## 遅延読み込み

配布物の束は大きいため、APIリファレンスのページを開いた時にだけ、ブラウザ専用の関数(`createClientOnlyFn`)の中の動的な`import()`で読み込む。

```typescript
const importSwaggerUiBundle: ImportSwaggerUiBundle = createClientOnlyFn(
  async (): Promise<SwaggerUiBundle> => {
    const [bundle] = await Promise.all([
      import('swagger-ui-dist/swagger-ui-bundle.js'),
      import('swagger-ui-dist/swagger-ui.css'),
    ]);
    return bundle.default;
  },
);

export const createSwaggerUiLoader =
  (
    importBundle: ImportSwaggerUiBundle = importSwaggerUiBundle,
  ): SwaggerUiLoader =>
  async () => {
    const SwaggerUIBundle = await importBundle();
    return ({ domNode, spec }) => {
      SwaggerUIBundle({
        domNode,
        spec,
        presets: [SwaggerUIBundle.presets.apis],
        validatorUrl: null,
        persistAuthorization: false,
        deepLinking: false,
      });
    };
  };
```

- 動的な`import()`は別のチャンクになり、他のページの最初の読み込みに束が含まれない。ブラウザ専用の関数はサーバーのバンドルで呼ぶと例外を投げる関数に置き換わり、`import()`ごとサーバーのビルドから除かれる。
- 束とスタイルは同時に読み込み、どちらかが失敗したら読み込みの失敗として扱う。
- 配布物の実行時の値を他のファイルから静的にimportしない。静的なimportがあると、束が別のチャンクに分かれず主バンドルに入る(「[サーバー専用のファイルと同型の関数](002-tanstack-start-on-workers.md#サーバー専用のファイルと同型の関数)」)。型だけのimportは許す。
- ビューアーは読み込み関数を引数で受け取り、既定に`loadSwaggerUi`を使う。テストは偽の読み込み関数を渡し、束を読み込まずに読み込み中と失敗の表示を確かめる。

### ビルドの出力の確認

配布物を入れた時と版を上げた時は、`vite build`の出力を束に固有の文字列(既定のエクスポートの名前`SwaggerUIBundle`など)で検索し、次を確かめる。

- ブラウザの出力では、APIリファレンスのページの遅延読み込みのチャンクにだけ現れ、入口と他のルートのチャンクに現れない。
- サーバーの出力には現れない。

## 仕様書の取得とサーバーのURLの補正

- 仕様書は`<公開APIのオリジン><公開RESTの基準パス><仕様の経路>`から`credentials: 'omit'`で取得する。公開APIはCookieで認証しないため、別のオリジンへ資格情報を送らない。公開APIのオリジンは、`<公開APIのオリジンの変数>`から作る公開設定を、ルーターの文脈の実行時の情報から読む。
- 公開APIのオリジンを置いていない環境では、仕様書を取得せず、取得の失敗と同じ表示にする。
- 仕様書の取得・束の読み込み・描画先への描画は、表示中の要素に結び付いた1回の流れで結果を使い回せないため、取得のキャッシュ(TanStack Query)を使わず、effectの中で行う。表示の終了と再試行では`AbortController`で前の流れを止め、止めた流れの結果を描かない。
- 仕様書をURLでなく値(`spec`)で渡すため、Swagger UIは相対のサーバーのURL(`<公開RESTの基準パス>`)をページのオリジンに対して解決してしまう。渡す前に`withAbsoluteServers`で、相対のURLを仕様書のURLに対して解決した絶対URLに変える。サーバーが無ければ`<公開APIのオリジン><公開RESTの基準パス>`を入れ、絶対URLのサーバーはそのまま残す。補正した後は、APIキーを入力して試した要求が公開APIのオリジンへ送られる。

## 描画の設定

| 設定                   | 値      | 理由                                                                                  |
| ---------------------- | ------- | ------------------------------------------------------------------------------------- |
| `validatorUrl`         | `null`  | 仕様書を外部の検証サービスへ送らない。既定では検証の画像を外部のオリジンから読み込む  |
| `persistAuthorization` | `false` | 入力したAPIキーをブラウザの保存領域に残さない。ページを読み込み直すと消える           |
| `deepLinking`          | `false` | 操作を開いてもページのURLの断片(`#`)を書き換えない。ページのURLは画面のルーターが扱う |
| `presets`              | `apis`  | 仕様書の表示と試行に必要な部品だけを使う                                              |

- 描画先はReactが子を描かない空の要素にし、描画の前に`replaceChildren()`で前の描画を消す。再試行で同じ要素へ描き直すためである。
- 描画先は読み込み中と失敗の間も要素を残し、`hidden`で隠す。読み込み中は描画先の位置にスケルトンを、失敗はエラーの表示と再試行を示す(「[データ取得](006-data-fetching.md)」の表示の規則)。
- Swagger UIの部品の文言は配布物の英語のままで、翻訳しない。

## 描画先の明るい配色の固定

Swagger UIは暗い配色を持たないため、描画先の要素だけを、ページの配色によらず明るい配色に固定する。

```tsx
<div
  ref={domNodeRef}
  hidden={status !== 'ready'}
  className="rounded-lg border bg-white text-neutral-900 scheme-light"
/>
```

- 背景と文字の色を固定し、`color-scheme: light`(`scheme-light`)で、フォームの部品とスクロールバーも明るい配色にする。
- 区画の見出しや読み込み中・失敗の表示は描画先の外に置き、ページの配色に従う。

## CSP

- 束とスタイルは画面のオリジンのチャンクとして配信されるため、ページのCSPの`script-src 'self' 'nonce-…'`・`style-src 'self' 'unsafe-inline'`・`img-src 'self' data: blob:`のまま動く。許可先に加えるのは、仕様書の取得と試行の要求の宛先である公開APIのオリジンの`connect-src`だけである(「[許可先の登録](003-frontend-server-security.md#許可先の登録)」)。
- `<公開APIのオリジンの変数>`の値があるときだけ`connect-src`に加わる。APIリファレンスを持たないアプリの設定には値を置かない。
- 配布物を入れた時と版を上げた時は、束が`eval`・`new Function`・ワーカー・インラインのスクリプトを使わないことを、E2EテストでCSPの違反が0件であることで確かめる。違反が出たらCSPを緩めず、描画の設定か配布物の版で解消する(「[実行時のコード生成を試すライブラリ](003-frontend-server-security.md#実行時のコード生成を試すライブラリ)」)。

## テスト

- 単体テスト: 仕様書のURL、サーバーのURLの補正(相対・絶対・サーバー無し)と渡した仕様書を書き換えないこと、仕様書の取得(資格情報を送らないこと・成功でない状態コード・オブジェクトでない応答・通信の失敗)。
- ブラウザテスト: 偽の読み込み関数を渡したビューアーで、読み込み中・仕様書の取得の失敗・束の読み込みの失敗・公開APIのオリジンが無い環境の表示、サーバーのURLを補正した仕様書を渡すこと、再試行とフォーカス、描画先の明るい配色、axe-coreの検査を確かめる。読み込み関数のテストは本物の束で、仕様書の経路の一覧が描かれること・入力したキーがブラウザに保存されないこと・描画の設定が渡ること・束の読み込みの失敗をそのまま返すことを確かめる。
- ブラウザテストの設定(`vitest.browser.config.ts`)の事前バンドルの一覧(`optimizeDeps.include`)に`swagger-ui-dist/swagger-ui-bundle.js`を加える。実行中に依存の事前バンドルをやり直すとページが再読み込みされ、テストが失敗するためである。
- TanStack StartのViteのプラグインが無いブラウザテストでは`@tanstack/react-start`の入口がサーバーの部品まで読み込んで失敗するため、読み込み関数を読むテストは`createClientOnlyFn`を、関数をそのまま返す偽物に差し替える(ブラウザのビルドの変換と同じ振る舞い)。
- E2Eテスト: ログインせずに`<APIリファレンスのページのパス>`を開き、仕様書の経路の一覧とサーバーの選択に公開APIの絶対URLが表示されること、CSPの違反が0件であること、画面のオリジンと公開APIのオリジン以外へ要求しないこと(`data:`・`blob:`を除く)を、開発サーバーとビルドの後のプレビューの両方で確かめる。
