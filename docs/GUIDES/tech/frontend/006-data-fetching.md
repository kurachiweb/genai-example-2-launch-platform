# データ取得

Cloudflare Workersで動かすTanStack Startの画面が、APIサーバーのGraphQLからデータを取得・変更する規約を定める。操作の置き場所、取得の補助とルートの`loader`、TanStack Queryの既定値と再試行、エラーの型と画面の分岐、セッションのCookieの指示が反映される範囲、要求ごとのストア、サーバーのデータと画面の状態の使い分け、取得の遅い区画のストリーミング、1ページの描画あたりの呼び出し回数の目安を扱う。

## 前提と用語

操作の書き方・コード生成・要求と応答の形は「[GraphQL通信](../coding/004-graphql-communication.md#クライアント側)」、中継とセッションのCookieは「[フロントエンドサーバーのセキュリティ](003-frontend-server-security.md)」、サーバー専用のファイルと同型の関数は「[Cloudflare Workers上のTanStack Startの起動](002-tanstack-start-on-workers.md#サーバー専用のファイルと同型の関数)」、フォームと状態表示の部品は「[共通化する部品](005-shared-components.md)」に従う。部品の置き場所は共通部品のディレクトリからのパスで示し、コードの例では`<共通部品の配置先>`までの相対パスを省いて書く。

| 部品                                                                                                              | 置き場所(共通部品内)                      | 役割                                                             |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| `executeGraphQL`                                                                                                  | `start/graphql/execute-graphql.ts`        | 操作を実行して`GraphQLResult`を返す同型の関数                    |
| `graphqlQueryOptions`・`graphqlMutationOptions`                                                                   | `start/graphql/graphql-query-options.ts`  | TanStack Queryの取得・変更の設定                                 |
| `createAppQueryClient`・`shouldRetryQuery`・`QUERY_STALE_TIME_MS`・`MAX_QUERY_RETRIES`                            | `start/query-client.ts`                   | QueryClientの既定値と再試行の方針                                |
| `createRouterContext`・`dehydrateAppRuntime`・`hydrateAppRuntime`・`appRuntimeOf`                                 | `start/router-context.ts`                 | 要求ごとのルーターの文脈(QueryClient・Jotaiのストア・実行時の値) |
| `readInitialRuntime`・`readRequestNonce`                                                                          | `start/request-context.ts`                | 描画の文脈から実行時の値とnonceを読む同型の関数                  |
| `responseCommitMiddleware`                                                                                        | `start/response-commit.ts`                | ページの応答を送り始めた時点の記録                               |
| `GraphQLClientError`・`GraphQLResult`・`requireData`・`createNetworkError`・`isExpectedFailure`・`errorMessageOf` | `utilities/graphql/graphql-result.ts`     | 応答の解釈とエラーの型、画面に出す失敗の文言の選択               |
| `documentIdOf`・`graphqlQueryKey`                                                                                 | `utilities/graphql/persisted-document.ts` | 操作の識別子と取得のキー                                         |
| `UNEXPECTED_ERROR_MESSAGE`・`UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT`                                            | `utilities/messages/state-messages.ts`    | 想定外のエラーの固定の文言(問い合わせの導線がある側・無い側)     |

| 用語             | 意味                                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| サーバーのデータ | APIサーバーから取得したデータ。正はAPIサーバーにあり、画面はその写しをTanStack Queryのキャッシュに持つ         |
| 画面の状態       | サーバーのデータ以外の、画面が持つ状態(開閉・選択・入力中の値・絞り込みの条件など)                             |
| 描画中の取得     | ページの要求を処理するフロントエンドサーバーが、描画のために行う取得。ブラウザを経ずに中継の処理へ直接渡す     |
| ブラウザの取得   | ブラウザが`<中継の接頭辞>`の下の中継の経路へ送る取得・変更。画面内の遷移・先読み・再試行・利用者の操作で起きる |
| 区画             | ページの中で、取得の完了を待たずに後から表示したり、失敗をページ全体から切り離して表示したりする部分           |
| `<中継の接頭辞>` | 「[フロントエンドサーバーのセキュリティ](003-frontend-server-security.md#前提と用語)」と同じ                   |

`executeGraphQL`は同型の関数で、サーバーでは描画の文脈を読んで中継の処理(`relayToApi`)へ、ブラウザでは中継の経路へ`fetch`で送る。どちらも同じ要求(`buildGraphQLRequest`)を組み立てるため、項目の引き継ぎ・待ち時間・失敗の扱いは同じである。ルートの`loader`も同型で、ページの最初の描画ではサーバーで、画面内の遷移・先読み・`router.invalidate()`ではブラウザで実行される。

## 操作の置き場所

- 操作は、画面を持つアプリの`src/graphql/operations/`に`.graphql`ファイルで書く。共通部品には操作を置かない。書き方と生成物は「[操作の置き場所と名前](../coding/004-graphql-communication.md#操作の置き場所と名前)」に従う。
- 画面は、コード生成の`generated/graphql.ts`から本文を持たない文書(`<操作名>Document`)と結果・変数の型を読み込む。
- 生成した結果の型を画面の部品の型へ変える関数や、`loader`のデータとの変換は、操作ごとに`src/graphql/<内容>.ts`に置き、単体テストを書く。部品は生成物の型に直接依存しない。

## ルーターと要求ごとのストア

アプリの`src/router.tsx`の`getRouter`が、要求ごとのルーターと文脈を作る。

```tsx
import { createRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { Provider as JotaiProvider } from 'jotai/react';

import {
  readInitialRuntime,
  readRequestNonce,
} from '<共通部品の配置先>/start/request-context.ts';
import {
  createRouterContext,
  dehydrateAppRuntime,
  hydrateAppRuntime,
} from '<共通部品の配置先>/start/router-context.ts';
import { routeTree } from './routeTree.gen.ts';

export function getRouter() {
  const context = createRouterContext(readInitialRuntime());
  const router = createRouter({
    routeTree,
    context,
    ssr: { nonce: readRequestNonce() },
    defaultPreload: 'intent',
    Wrap: ({ children }) => (
      <JotaiProvider store={context.jotaiStore}>{children}</JotaiProvider>
    ),
    dehydrate: () => dehydrateAppRuntime(context),
    hydrate: (dehydrated) => {
      hydrateAppRuntime(context, dehydrated);
    },
  });
  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });
  return router;
}
```

- 例は、データ取得に関わる設定だけを示している。実際の`getRouter`は、ほかに`scrollRestoration`と、エラートラッキングへの送信の設定(`defaultOnCatch`・`installRouteErrorReporting`)を持つ。送信の設定は「[フロントエンドの観測](007-frontend-observability.md#送信の入口)」の「送信の入口」に従う。
- `createRouterContext`は、呼ぶたびに新しいQueryClient(`createAppQueryClient`)・Jotaiのストア・実行時の値の入れ物を作る。サーバーでは`getRouter`が要求ごとに呼ばれるため、取得したデータと画面の状態は要求ごとに分かれ、他の要求・他の利用者と共有されない。
- QueryClient・Jotaiのストア・利用者のデータを持つ`Map`などを、モジュールのスコープに置かない。Workerの1つの実行環境は複数の要求を順に・並行に処理するため、モジュールのスコープの値は利用者の間で共有される。
- `setupRouterSsrQueryIntegration`は、描画中に取得したQueryClientのキャッシュをHTMLへ書き出し、描画の後に完了した取得も同じ応答の中で後から送る。ブラウザはハイドレーションでそのキャッシュを読み込むため、同じデータを取得し直さない。`QueryClientProvider`も自動で置かれる。
- ルーターの`dehydrate`がHTMLへ書き出すのは、公開してよい設定と表示設定(`{ publicConfig, display }`)だけである。セッション識別子・接続元のIPアドレス・APIサーバーのバインディングを持つ描画の文脈(`FrontendRequestContext`)は、ルーターの文脈・`loader`のデータ・取得のキャッシュに入れない。描画の文脈は`*.server.ts`の中で`readFrontendRequestContext`から読む。
- 実行時の値は、ルートでは`context.runtime.get()`、ルーターの型を登録できない共通部品では`appRuntimeOf(router.options.context)`で読む。

## 取得の補助とloader

### 取得

ページの描画に要る取得は、ルートの`loader`で始め、部品では同じ設定で`useSuspenseQuery`から読む。取得のキーは`graphqlQueryKey`の`[<操作の識別子>, <変数>]`で、同じ文書と変数の取得は1つにまとまる。

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound } from '@tanstack/react-router';

import { graphqlQueryOptions } from '<共通部品の配置先>/start/graphql/graphql-query-options.ts';
import { ProductDetailDocument } from '../../graphql/generated/graphql.ts';

export const Route = createFileRoute('/products/$productId')({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(
      graphqlQueryOptions(ProductDetailDocument, { id: params.productId }),
    );
    if (data.product === null) {
      throw notFound();
    }
  },
  component: ProductRoute,
});

function ProductRoute() {
  const { productId } = Route.useParams();
  const { data } = useSuspenseQuery(
    graphqlQueryOptions(ProductDetailDocument, { id: productId }),
  );
  return <ProductView product={data.product} />;
}
```

- 例の文書名は、操作名の接頭辞を省いて書いている。
- `graphqlQueryOptions`の`queryFn`は、失敗の結果を`requireData`で`GraphQLClientError`の例外にする。`loader`で`ensureQueryData`を待った取得が失敗すると、ルートの`errorComponent`が描画され、ページの最初の描画では状態コード500になる。この形は、データが無ければページを表示できない取得にだけ使う。
- 対象が存在しないことは、`loader`で`throw notFound()`にして404にする。別のページへ移すときは`throw redirect()`を使う。どちらも`Error`ではない値で、静的解析は`Error`以外の値ではこの2つだけを投げることを許す。
- 1つのルートの`loader`で複数の取得を待つときは、`Promise.all`で同時に始める。1つ目の完了を待ってから2つ目を始めると、待ち時間が足し合わされる。入れ子のルートの`loader`は並行に実行されるが、`beforeLoad`は親から順に実行されるため、`beforeLoad`では取得しない(環境による`notFound()`などの判定だけにする)。
- 検索パラメータで変わる取得は、`validateSearch`で検索パラメータを検証し、`loaderDeps`で`loader`へ渡して変数に含める。Zodの規則は`utilities/validation/zod.ts`の`z`で書く。
- `defaultPreload: 'intent'`のため、リンクにポインタを重ねる・フォーカスするとブラウザで`loader`が先に実行される。先読みの取得も中継の経路を通り、IP制限の回数に数えられる(「[1ページの描画あたりの呼び出し回数の目安](#1ページの描画あたりの呼び出し回数の目安)」)。

### 失敗を画面の中で表示する取得

失敗してもページを表示し、失敗をページの中で伝える取得は、`loader`で`executeGraphQL`を直接呼び、結果を例外にせず`loader`のデータとして返す。

```tsx
import { createFileRoute } from '@tanstack/react-router';

import { executeGraphQL } from '<共通部品の配置先>/start/graphql/execute-graphql.ts';
import { GraphQLClientError } from '<共通部品の配置先>/utilities/graphql/graphql-result.ts';
import { StatusDocument } from '../../graphql/generated/graphql.ts';

export const Route = createFileRoute('/status')({
  loader: async () => {
    const result = await executeGraphQL(StatusDocument, {});
    if (result.ok) {
      return result;
    }
    const { code, message, status } = result.error;
    return { ok: false, error: { code, message, status } } as const;
  },
  component: StatusRoute,
});

function StatusRoute() {
  const data = Route.useLoaderData();
  const result = data.ok
    ? data
    : { ok: false, error: new GraphQLClientError(data.error) };
  return <StatusView result={result} />;
}
```

- `loader`のデータとHTMLへ書き出す値の`Error`は、ブラウザへ渡るときにメッセージだけを持つ別の`Error`になり、`code`などの項目と`GraphQLClientError`の型が失われる。そのため、失敗は画面の分岐に使う項目だけの素のオブジェクトで返し、部品の側で`GraphQLClientError`に戻す。
- この`loader`もブラウザ内の遷移・先読み・`router.invalidate()`ではブラウザで実行される。サーバーで取得した結果とブラウザで取得した結果を区別して表示する画面は、そのことを前提に文言を決める。

### 変更

変更(mutation)は、利用者の操作を受けた部品から`useMutation(graphqlMutationOptions(<文書>))`で行う。`loader`の中で変更しない(`loader`はページの表示と先読みでも実行されるため)。

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { graphqlMutationOptions } from '<共通部品の配置先>/start/graphql/graphql-query-options.ts';
import { documentIdOf } from '<共通部品の配置先>/utilities/graphql/persisted-document.ts';

const queryClient = useQueryClient();
const updateProduct = useMutation({
  ...graphqlMutationOptions(UpdateProductDocument),
  onSuccess: () =>
    queryClient.invalidateQueries({
      queryKey: [documentIdOf(ProductDetailDocument)],
    }),
});

await updateProduct.mutateAsync({
  variables: { input: values },
  turnstileToken: turnstile.consume(),
});
```

- `mutate`・`mutateAsync`には`{ variables, turnstileToken }`を渡す。bot判定を求める操作は、`useTurnstileToken`の`consume()`で取り出したトークンを`turnstileToken`に入れる(「[bot判定のウィジェット](005-shared-components.md#bot判定のウィジェット)」)。
- 変更の後は、影響する取得を`invalidateQueries`で無効にする。キーの先頭が操作の識別子のため、`[documentIdOf(<文書>)]`でその操作のすべての変数の取得をまとめて無効にできる。
- 変更の`mutationKey`は`[<操作の識別子>]`である。
- フォームから変更するときは、`AppForm`の`onSubmit`で`mutateAsync`を待つ。失敗の`GraphQLClientError`の`details`は欄のエラーになり、欄に対応しない詳細と詳細の無い失敗は`onSubmitError`へ渡る(「[フォーム](005-shared-components.md#フォーム)」)。入力の検証の詳細の`field`は引数からのパス(`input.title`など)のため、`serverFieldPrefix`で引数の名前を外す。
- 送信のボタンは、サーバーの詳細が付いた欄のエラーが1つでも残る間は無効のままである。詳細は利用者がその欄を入力し直すと消えるため、入力欄を描かない値をスキーマの入力に含めない(「[フォーム](005-shared-components.md#フォーム)」)。

### 日時の値

GraphQLの`DateTime`の値は、コード生成で`string`になり、APIサーバーはUTCのISO形式の文字列(末尾が`Z`)で返す。変換せずに`DateTime`・`RelativeTime`の部品へ渡す(「[日時と数値](005-shared-components.md#日時と数値)」)。時差の無い文字列は描画中に`RangeError`になるため、日時を自前で組み立てて渡すときは時差を含める。

## 既定値と再試行

`createAppQueryClient`は次の既定値でQueryClientを作る。

| 項目                         | 値                          | 理由                                                                      |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| 取得の`staleTime`            | 30秒(`QUERY_STALE_TIME_MS`) | ハイドレーションの直後に、サーバーで取得したデータを取得し直さない        |
| 取得の`refetchOnWindowFocus` | `false`                     | タブを切り替えるたびの取得で、APIサーバーの負荷とIP制限の回数を増やさない |
| 取得の`retry`(サーバー)      | `false`                     | 中継の待ち時間の切れを描画中に再試行すると、その分だけ最初の表示が遅れる  |
| 取得の`retry`(ブラウザ)      | `shouldRetryQuery`          | 時間をおけば成功し得る失敗だけを再試行する                                |
| 変更の`retry`                | `false`                     | 変更を自動で繰り返すと、APIサーバーで二重に実行され得る                   |

- `shouldRetryQuery`は、失敗が`GraphQLClientError`で、`expected`が偽で、`code`が`network_error`・`upstream_unavailable`・`upstream_timeout`のどれかで、失敗の回数が2回(`MAX_QUERY_RETRIES`)未満のときだけ真を返す。1つの取得は最大3回送られる。
- 429(`rate_limit_exceeded`)・想定内の失敗(入力の不正・未認証・権限不足など)・`internal_error`・`invalid_response`・実行前の拒否は再試行しない。429は待つべき時間を利用者に示し、他は繰り返しても結果が変わらないためである。
- サーバーで失敗した取得は、ブラウザでの再試行(エラーの画面・区画の再試行の操作、`router.invalidate()`)のときに、ブラウザの方針で取得し直す。
- ブラウザの取得は、呼び出し元の中断(`signal`)を`network_error`にせず、中断の理由のまま失敗させる。TanStack Queryが取得を取り消したときに、再試行やエラーの表示の対象にしないためである。サーバーの取得は中断の合図を使わず、中継の経路の待ち時間で打ち切る。
- 既定値を取得ごとに上書きしない。上書きが必要なら、理由をコードのコメントに書く。

## エラーの型と画面の分岐

`executeGraphQL`は`GraphQLResult`(成功なら`{ ok: true, data }`、失敗なら`{ ok: false, error }`)を返し、例外を投げない。`graphqlQueryOptions`・`graphqlMutationOptions`は、失敗を`requireData`で`GraphQLClientError`の例外にする。

| 項目                | 内容                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`              | エラーコード。画面の分岐に使う                                                                                                                  |
| `message`           | 利用者に見せてよい文言。APIサーバーの文言か、フロントエンドサーバーとクライアントが付ける固定の文言                                             |
| `status`            | HTTPの状態コード。通信の失敗は0                                                                                                                 |
| `details`           | 入力の検証の失敗の、欄ごとの詳細(`field`・`code`・`message`)の配列。無ければ`undefined`                                                         |
| `retryAfterSeconds` | 応答の`Retry-After`が整数の秒数のときの値。無ければ`undefined`                                                                                  |
| `expected`          | 想定内の失敗なら真。偽の失敗はエラートラッキングへ送られる(「[エラーコードの扱い](../coding/004-graphql-communication.md#エラーコードの扱い)」) |

画面の表示は、状態コードではなくエラーコードで分岐する。

| エラーコード                                                   | 画面の扱い                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `validation_error`(`details`あり)                              | フォームの欄のエラーにする(`AppForm`)                                                                |
| `rate_limit_exceeded`                                          | `message`を示す。自動で再試行せず、`retryAfterSeconds`があれば、その秒数が過ぎるまで再送信を促さない |
| `upstream_unavailable`・`upstream_timeout`・`network_error`    | APIサーバーへ届かなかった失敗。`ErrorState`・`PartialErrorState`で`message`と再試行の操作を示す      |
| `csrf_rejected`                                                | `message`(再読み込みを促す文言)を示す                                                                |
| 各機能の想定内のエラーコード(未認証・権限不足・対象の不在など) | 機能ごとに決める(ログインへの導線、`notFound()`など)                                                 |
| それ以外(`internal_error`・`invalid_response`・実行前の拒否)   | `message`と再試行の操作を示す                                                                        |

- 画面に出す失敗の文言は、`ErrorState`・`PartialErrorState`の`message`、`AppForm`の`onSubmitError`で出す文言、トースト(`notify.error`・`notify.warning`)のどれでも`errorMessageOf(error, <プロファイル>.contactAvailable)`で選び、例外の`message`を直接出さない。`<プロファイル>`はアプリの`src/composition/app-profile.ts`の値で、ルートと画面の部品が渡す(共通部品はアプリの値を持たない)。
  - `GraphQLClientError`には、その`message`を返す。APIサーバーの`internal_error`・中継の共通のエラー形式・`network_error`・`invalid_response`の文言は、問い合わせを促す文を含まない。
  - `GraphQLClientError`でない例外(プログラムの誤り、ブラウザへ渡る時にメッセージだけになった失敗)には、例外の文言を出さず、`contactAvailable`が真なら`UNEXPECTED_ERROR_MESSAGE`(問い合わせを案内する文言)、偽なら`UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT`(時間をおいた再試行の案内で終え、問い合わせを促さない文言)を返す。問い合わせの画面を持たないアプリは`contactAvailable`を偽にする。
- 描画中の取得の失敗がブラウザへ渡ると、取得のキャッシュの失敗もメッセージだけの`Error`になる。HTMLを送り始めた時点で完了していなかった取得の失敗は、TanStack Queryがさらに固定の文言(`redacted`)の`Error`に置き換える。エラーコードで分岐したい区画は、ブラウザで取得し直した結果で分岐する。
- GraphQLの想定外の失敗は`executeGraphQL`がエラートラッキングへ送るため、画面で送り直さない。APIサーバーへ届かなかった失敗(`upstream_*`)は中継の処理が送る。`AppForm`の`onSubmitError`では、GraphQL以外の想定外の例外を送るかを利用側で決める。

## Cookieの指示が反映される範囲

APIサーバーがセッションの発行・削除を指示したとき、それがブラウザのCookieに反映されるかは、取得の場面で決まる(指示の解釈は「[指示の解釈](003-frontend-server-security.md#指示の解釈)」)。

| 取得の場面                                                   | 指示の扱い                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| ブラウザの取得・変更                                         | 中継の応答の`Set-Cookie`で反映する                                                                    |
| 描画中の取得のうち、ページの応答を送り始める前に完了したもの | ページの応答の`Set-Cookie`に合成して反映する。他のCookieは残し、セッションの指示は最後の1件だけを残す |
| 描画中の取得のうち、ページの応答を送り始めた後に完了したもの | 反映せず、警告のログ(`reason: 'response_committed'`)を出して捨てる                                    |

- ページの応答は、ルートの`loader`がすべて終わり、TanStack Startの処理が戻った時点で送り始める(`responseCommitMiddleware`が記録する)。`loader`で待った取得は前者、待たずに始めた取得と`Suspense`の区画の取得は後者になり得る。
- 1回の描画の中で先の取得がセッションを発行・削除しても、後の取得はページの要求のCookieの古いセッション識別子を送る。発行・削除が複数あれば最後の指示が勝つ。
- そのため、セッションを発行・削除・更新する操作(ログイン・ログアウトなど)は、ブラウザの変更で行う。描画中の取得では、セッションを変える操作を呼ばない。

## サーバーのデータと画面の状態の使い分け

| 状態                                                      | 置き場所                                            | 規約                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| サーバーのデータ                                          | TanStack Queryのキャッシュ(`graphqlQueryOptions`)   | `useState`・Jotaiへ写さず、取得の結果から導く。変更の後は`invalidateQueries`で取得し直す                        |
| URLで共有・再現すべき状態(絞り込み・並び順・ページ・タブ) | URLの検索パラメータ(`validateSearch`)               | 再読み込み・共有・戻る操作で同じ画面になるようにする。取得の変数は`loaderDeps`から渡す                          |
| 複数の部品で共有する画面の状態                            | Jotaiの原子(要求ごとのストア)                       | 原子の定義はモジュールに置いてよい。値はルーターの`Wrap`が置いたストアにだけ入れ、`getDefaultStore()`を使わない |
| 1つの部品の中で閉じる状態                                 | `useState`・`useReducer`                            | 親子の間だけで共有するならpropsで渡す                                                                           |
| フォームの入力                                            | React Hook Form(`useAppForm`)                       | 送信の前の値をTanStack Query・Jotaiへ写さない                                                                   |
| 公開してよい設定・表示設定                                | ルーターの文脈の実行時の値(`context.runtime.get()`) | 要求ごとに1回だけ設定される。部品から書き換えない                                                               |

- 同じ値を2つの置き場所に持たない。サーバーのデータをJotaiに写すと、取得し直した結果と食い違う。
- Jotaiの原子の初期値に、利用者ごとの値を入れない。原子の定義は全要求で共有され、値だけが要求ごとのストアに入る。

## 取得の遅い区画のストリーミング

TanStack Startは、描画の結果をストリーミングで返す。ページの主要な内容の取得だけを`loader`で待ち、取得の遅い区画は待たずに始めて`Suspense`で後から表示する。

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';

import { LoadingSkeleton } from '<共通部品の配置先>/components/state/loading-skeleton.tsx';
import { graphqlQueryOptions } from '<共通部品の配置先>/start/graphql/graphql-query-options.ts';
import {
  ProductDetailDocument,
  ProductReviewsDocument,
} from '../../graphql/generated/graphql.ts';

export const Route = createFileRoute('/products/$productId')({
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      graphqlQueryOptions(ProductReviewsDocument, { id: params.productId }),
    );
    await context.queryClient.ensureQueryData(
      graphqlQueryOptions(ProductDetailDocument, { id: params.productId }),
    );
  },
  component: ProductRoute,
});

function ProductRoute() {
  return (
    <>
      <ProductDetail />
      <Suspense fallback={<LoadingSkeleton label="レビューを読み込み中" />}>
        <ProductReviews />
      </Suspense>
    </>
  );
}

function ProductReviews() {
  const { productId } = Route.useParams();
  const { data } = useSuspenseQuery(
    graphqlQueryOptions(ProductReviewsDocument, { id: productId }),
  );
  return <ReviewList reviews={data.reviews} />;
}
```

- 待たない取得を先に始めてから、待つ取得を始める。両方が並行に進み、HTMLは待つ取得の完了の後に送り始める。
- 区画の部品は、`loader`と同じ設定の`useSuspenseQuery`で読む。区画の取得が完了すると、その結果のHTMLと取得のキャッシュが同じ応答の中で後から送られ、ブラウザは取得し直さない。
- 区画の取得の失敗がページ全体のエラーにならないよう、区画をエラーの境界(`CatchBoundary`など)で包み、`PartialErrorState`で再試行の操作を示す。再試行は`QueryErrorResetBoundary`の`reset`とエラーの境界の解除を合わせて行う。区画の中で表示する失敗の文言は「[エラーの型と画面の分岐](#エラーの型と画面の分岐)」に従う。
- 区画の取得が受けたセッションの指示は反映されない(「[Cookieの指示が反映される範囲](#cookieの指示が反映される範囲)」)。
- 区画は、表示が後になっても配置がずれない大きさのスケルトンを`fallback`に置く。

## 1ページの描画あたりの呼び出し回数の目安

描画中の取得は、1件ごとにService BindingsでAPIサーバーを1回呼ぶ。APIサーバーは、中継が引き継いだ元のクライアントIPアドレスごとに、Worker単位のIP制限(10秒あたり100回)で数える(「[Worker単位のIP制限](../backend/003-rate-limiting-and-bot-verification.md#worker単位のip制限)」)。ブラウザの取得・先読みも同じ上限に数えられ、フロントエンドサーバーのIP制限にも数えられる。同じIPアドレスを共有する利用者(社内のネットワークや携帯電話の回線など)は、上限も共有する。

- 1ページの最初の描画で行うAPIサーバーの呼び出しは、入れ子のルートの`loader`の分も合わせて3回以内を目安にする。
  - 同じ取得は、ブラウザ内の遷移の前の先読みと、一時的な障害の再試行(ブラウザで最大3回の送信)によって、1回の表示あたりの送信が増える。3回の取得なら、再試行が重なっても1回の表示で最大9回の送信に収まり、10秒あたり100回の上限の中で、同じ接続元の1人がおよそ10回の表示を続けられる。
  - 同じ接続元を複数の利用者が共有すると、その人数だけ1人あたりの余裕が減る。1回の表示あたりの呼び出しを増やすと、共有する接続元の利用者から先に上限に達する。
- ページに要るデータは、ルートのフィールドを複数持つ1つの操作にまとめる。操作を分けるのは、取得の遅い区画をストリーミングで後から表示する場合と、ルートごとに取得が分かれる場合に限る。
- 一覧の項目ごとに`executeGraphQL`を呼ばない。項目の関連データは一覧の操作の中で取得する。
- まとめた操作は、APIサーバーの深さ・コストなどの上限(「[GraphQLサーバーの基盤](../backend/004-graphql-server.md)」)に収める。上限を超えた操作は実行前に拒否される。
