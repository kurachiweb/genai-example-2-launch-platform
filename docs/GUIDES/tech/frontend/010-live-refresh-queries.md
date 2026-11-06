# 表示中の画面の定期再取得

他の利用者や運営の操作で変わるデータを、表示している間だけ定期的に取り直して最新に保つ規約を定める。共通の値とアプリの既定値との関係、非表示のタブと画面へ戻った時の振る舞い、ルートの`loader`との組み合わせ、定期の取り直しを止める手段、送信の後の無効化、取り直しと表示中の操作の関係、及びテストでの時間の進め方を扱う。

## 前提と用語

取得の補助・ルートの`loader`・QueryClientの既定値は「[データ取得](006-data-fetching.md)」に、止める手段と追加の通知は「[アクセシビリティ規則](004-accessibility-rules.md)」に、テストの種別と設定は「[テスト戦略](../testing/001-test-strategy.md)」に従う。部品の置き場所は共通部品のディレクトリからのパスで示し、コードの例では`<共通部品の配置先>`までの相対パスを省いて書く。TanStack Query v5を前提とする。

| 部品                                                     | 置き場所(共通部品内)              | 役割                                           |
| -------------------------------------------------------- | --------------------------------- | ---------------------------------------------- |
| `LIVE_REFRESH_INTERVAL_MS`・`LIVE_REFRESH_QUERY_OPTIONS` | `utilities/query/live-refresh.ts` | 定期再取得の間隔と、取得の設定に重ねる共通の値 |

| 用語                 | 意味                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 定期再取得           | 表示中の取得を、一定の間隔で自動で取り直すこと(`refetchInterval`)                                                                                                 |
| 非表示のタブ         | `document.visibilityState`が`hidden`の状態。別のタブを開いている・ウィンドウを最小化しているなど                                                                  |
| 画面へ戻った時       | 非表示のタブが表示に戻った時。TanStack Queryの`focusManager`が`visibilitychange`で検出する                                                                        |
| 鮮度                 | 取得した値を新しいとみなす時間(`staleTime`)。過ぎた値は、表示した時・画面へ戻った時に取り直す対象になる。無効化した値は鮮度によらず古いとみなす(`'static'`を除く) |
| `<定期再取得の間隔>` | `LIVE_REFRESH_INTERVAL_MS`の値。プロジェクトごとに決める                                                                                                          |
| 表示中の取得         | 表示している部品が購読している取得(TanStack Queryの`active`)                                                                                                      |

## 使う場面

定期再取得は、表示している間に他の利用者や運営の操作で変わり、利用者が最新を待って画面を見続けるデータにだけ使う。

| データ                                                     | 最新に保つ方法                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 相手の操作で項目が加わる・状態が変わる(やり取りの一覧など) | 定期再取得                                                                        |
| 閲覧者の操作だけで変わる                                   | 変更の後の無効化(「[送信の後の無効化](#送信の後の無効化)」)。定期再取得は使わない |
| 変わることがまれ、または遅れて反映されてよい               | アプリの既定値(既定の鮮度・画面へ戻った時に取り直さない)のまま                    |

- 定期の取り直しは中継の経路を通り、Worker単位のIP制限の回数に数えられる(「[1ページの描画あたりの呼び出し回数の目安](006-data-fetching.md#1ページの描画あたりの呼び出し回数の目安)」)。1つのタブが`<定期再取得の間隔>`ごとに1回取得するため、同じページの他の取得に定期再取得を広げない。最新に保つ区画の取得だけに重ねる。
- 同じ取得の中でも、取得した値によって変わり得ないものがあれば、その間は止める(「[条件付きの定期再取得](#条件付きの定期再取得)」)。

## 共通の値

定期再取得する取得は、`LIVE_REFRESH_QUERY_OPTIONS`を取得の設定に重ねる。値は凍結したオブジェクトで、個々の項目を変える時は展開した後に上書きする。

| 項目                          | 値                                               | 理由                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refetchInterval`             | `LIVE_REFRESH_INTERVAL_MS`(`<定期再取得の間隔>`) | 新しい項目を待つ利用者に遅れを感じさせず、APIサーバーの負荷とIP制限の回数を抑える間隔にする                                                                                                          |
| `refetchIntervalInBackground` | `false`                                          | 見ていないタブの取得で、負荷とIP制限の回数を増やさない                                                                                                                                               |
| `refetchOnWindowFocus`        | `true`                                           | 非表示の間に止めた分を、画面へ戻った時にすぐ取り直す                                                                                                                                                 |
| `staleTime`                   | `0`                                              | 画面へ戻った時の取り直しは鮮度が切れた取得にだけ働くため、アプリの既定の鮮度を外す。`useSuspenseQuery`では最小1秒に切り上がる(「[サスペンドする取得の鮮度の下限](#サスペンドする取得の鮮度の下限)」) |

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';

import { LIVE_REFRESH_QUERY_OPTIONS } from '<共通部品の配置先>/utilities/query/live-refresh.ts';

const { data } = useSuspenseQuery({
  ...threadQueryOptions(threadId),
  ...LIVE_REFRESH_QUERY_OPTIONS,
  refetchOnMount: false,
  select: toThreadView,
});
```

- 例の取得の設定・変換の関数は、置き換えて読む。`refetchOnMount: false`は「[loaderとの組み合わせ](#loaderとの組み合わせ)」で説明する。

### 既定値との関係

アプリのQueryClientは、既定の鮮度(`QUERY_STALE_TIME_MS`)と、画面へ戻った時に取り直さない既定値を持つ(「[既定値と再試行](006-data-fetching.md#既定値と再試行)」)。`LIVE_REFRESH_QUERY_OPTIONS`は、この既定値を定期再取得する取得だけで上書きする。「既定値を取得ごとに上書きしない」の規則の、決まった例外である。

- 既定の鮮度のままでは、画面へ戻った時に前の取得から既定の鮮度の時間が経っていなければ取り直さない。非表示の間に止めた定期の取得の分だけ、表示が遅れる。
- `refetchOnWindowFocus`を既定値の`false`のままにすると、画面へ戻ってから次の間隔まで最大で`<定期再取得の間隔>`、古い表示が残る。
- 定期の間隔の計時は非表示の間も続き、時刻が来ても取得だけを省く。画面へ戻った時の取り直しで最新になるため、戻った後に間隔を待たない。
- 「画面へ戻った時」は`visibilitychange`で決まる。タブを表示したままウィンドウの間でフォーカスを移しても、取り直さない。
- サーバーでの描画では、定期の取り直しは動かない。

### サスペンドする取得の鮮度の下限

`useSuspenseQuery`(と`suspense`を指定した取得)は、サスペンドから戻って描き直した部品がすぐに取り直さないよう、数値の`staleTime`を最小1秒(1,000ミリ秒)に切り上げる(TanStack Queryの`ensureSuspenseTimers`)。`LIVE_REFRESH_QUERY_OPTIONS`の`staleTime: 0`を重ねた部品の実際の鮮度は1秒である。

| 振る舞い                 | 鮮度1秒の影響                                                          |
| ------------------------ | ---------------------------------------------------------------------- |
| 表示した時の取り直し     | 前の取得から1秒以内に表示すれば取り直さない。1秒を超えていれば取り直す |
| 画面へ戻った時の取り直し | 前の取得から1秒以内に戻った時は取り直さない                            |
| 定期の取り直し           | 影響しない。間隔ごとに鮮度によらず取得する                             |
| 無効化による取り直し     | 影響しない。無効化した値は鮮度によらず古いとみなす                     |

- 切り上げは部品の購読の設定だけに働く。ルートの`loader`の`queryClient.query({ staleTime: 0 })`は切り上げられず、キャッシュに値があっても取得する。
- 1秒の下限は利用者の操作では気づかない長さのため、画面へ戻った時の取り直しの目的(非表示の間に止めた分をすぐ取り直す)は損なわれない。画面へ戻った時の取り直しは、切り上げの無い`QueryObserver`の単体テストで確かめる(「[単体テスト](#単体テスト)」)。

## loaderとの組み合わせ

鮮度を0にした取得を`useSuspenseQuery`でそのまま読むと、表示した時点で前の取得から1秒を超えていれば取り直す(「[サスペンドする取得の鮮度の下限](#サスペンドする取得の鮮度の下限)」)。重複が主に起きるのは、ページの最初の描画でサーバーが取得してから1秒を超えた値をブラウザがハイドレーションした時で、サーバーの描画とHTMLの転送・読み込みの時間だけで1秒を超え得る。ブラウザ内の遷移でも、同じルートの他の`loader`を待つ間に1秒を超えれば重なる。そこで、`loader`が毎回新しく取得し、部品は表示した時点では取り直さない。

```tsx
export const Route = createFileRoute('/threads/$threadId')({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.query({
      ...threadQueryOptions(params.threadId),
      staleTime: 0,
    });
    if (data.thread === null) {
      throw notFound();
    }
  },
  component: ThreadRoute,
});
```

| 場面                                 | 取得の回数                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| ページの最初の描画                   | サーバーの`loader`で1回。ブラウザはハイドレーションで読み込み、`refetchOnMount: false`で取り直さない |
| 別のページから戻った時(画面内の遷移) | ブラウザの`loader`で1回。`staleTime: 0`のため、キャッシュに値があっても取得する                      |
| 表示している間                       | `<定期再取得の間隔>`ごとに1回と、画面へ戻った時に1回(前の取得から1秒以内に戻った時を除く)            |

- `loader`の`staleTime: 0`と部品の`refetchOnMount: false`は組で使う。`loader`だけではハイドレーションや遅い遷移の後の表示で重なり、部品だけでは別のページから戻った時にキャッシュの古い値を示す。
- 定期再取得しない一覧などの`loader`は、`staleTime: 'static'`でキャッシュの値を使う(「[取得](006-data-fetching.md#取得)」)。`'static'`の取得は無効化しても古いとみなされないため、無効化を反映させたい取得の`loader`に`'static'`を使う場合は、部品の`useQuery`が表示した時に取り直すことを確かめる。
- 取得のキーに閲覧者の識別子などを足す場合も、先頭の要素は操作の識別子のままにする。`[documentIdOf(<文書>)]`による無効化がそのまま効く。
- 定期の取り直しの失敗は、表示中の値を残してエラーの画面にしない。`useSuspenseQuery`は、値がある取得の失敗を境界へ投げない。
- 取り直しで対象が無くなった(`null`が返った)時は、`loader`と同じく見つからない表示(`notFound()`)にする。

## 条件付きの定期再取得

### 止める手段

自動で更新される区画には、定期の取り直しを止める手段を置く(「[演出の停止手段の義務](004-accessibility-rules.md#演出の停止手段の義務)」)。手段は区画の見出しの近くに置く「自動更新」の`Switch`で、状態は区画を描く部品が持つ。

```tsx
const [autoRefresh, setAutoRefresh] = useState(true);
const { data } = useSuspenseQuery({
  ...threadQueryOptions(threadId),
  ...LIVE_REFRESH_QUERY_OPTIONS,
  refetchInterval: autoRefresh
    ? LIVE_REFRESH_QUERY_OPTIONS.refetchInterval
    : false,
  refetchOnMount: false,
});
```

- 切った間は`refetchInterval`だけを`false`にする。画面へ戻った時の取り直しと、送信の後の無効化による取り直しは止めない。利用者の操作の結果として起きる取り直しで、自動で更新され続ける情報ではないためである。
- 状態はページを開くたびにオンから始める。
- `Switch`には、間隔の秒数を`LIVE_REFRESH_INTERVAL_MS`から作った説明を`aria-describedby`で関連付ける。秒数を文言に直接書かない。

### 取得した値による判定

`refetchInterval`と`refetchOnWindowFocus`には、取得(`query`)を受け取る関数を渡せる。取得した値の種類によって他の操作で変わり得ないものは、関数で判定して定期の取り直しを止める。

```tsx
const canChange = (query: {
  readonly state: { readonly data?: ThreadQuery | undefined };
}): boolean => query.state.data?.thread?.kind === 'CONVERSATION';

useSuspenseQuery({
  ...threadQueryOptions(threadId),
  ...LIVE_REFRESH_QUERY_OPTIONS,
  refetchInterval: (query) =>
    autoRefresh && canChange(query)
      ? LIVE_REFRESH_QUERY_OPTIONS.refetchInterval
      : false,
  refetchOnWindowFocus: canChange,
  refetchOnMount: false,
});
```

- 判定は、変換する前の取得の値(`query.state.data`)で行う。`select`の結果は渡らない。
- 定期の取り直しが無い表示には、止める手段の`Switch`を描かない。
- 定期の取り直しが無い表示は、他の操作が先に確定した競合を自分で検出できない。変更の失敗が競合を示した時に、その取得を無効にして最新を示してから選び直させる。

## 送信の後の無効化

閲覧者の変更(メッセージの送信・状態の変更など)の後は、影響する取得を次のように無効にする(「[変更](006-data-fetching.md#変更)」)。

| 取得                                           | 無効化                                                 | 理由                                                                       |
| ---------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| 表示中の区画の取得                             | `await queryClient.invalidateQueries({ queryKey })`    | 送った内容を示すまで送信中のままにし、二重の送信と表示の遅れを防ぐ         |
| 表示していない一覧・件数(最後の日時・状態など) | `invalidateQueries({ queryKey, refetchType: 'none' })` | 古いとだけ印を付け、次に表示した時に取り直す。表示していない取得を送らない |

```tsx
const postMessage = useMutation({
  ...graphqlMutationOptions(PostMessageDocument),
  onSuccess: () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: [documentIdOf(ThreadDocument)],
      }),
      queryClient.invalidateQueries({
        queryKey: [documentIdOf(ThreadListDocument)],
        refetchType: 'none',
      }),
    ]),
});
```

- 表示中の区画の取り直しを待ってから、フォームを作り直して続けて入力する欄へフォーカスを移す(「[演出の停止手段の義務](004-accessibility-rules.md#演出の停止手段の義務)」)。
- 変更の応答が変わった項目(状態と変更日時など)を返す場合は、`setQueryData`で表示中の値へ写し、他の項目は次の定期の取り直しに任せてよい。表示中の取得を待たずに結果を示せる。
- 定期の取り直しで最新になるからといって、変更の後の無効化を省かない。最大で間隔の分だけ、送った内容が表示されない。

## 取り直しと表示中の操作

取り直しは、利用者が操作している最中にも値を変える。表示中の入力欄・ボタン・一覧は、次の規約で取り直しに耐えるようにする。

- 取得した値を入力欄の状態へ写さない。利用者が選んだ値だけを状態に持ち、選ぶまでは取得した値から求める(`const next = selected ?? current`)。写すと、取り直しで変わった値が入力欄に反映されない。
- 入力中のフォームの値は取得の値から作らない。取り直しで入力中の本文などが消えないようにする。
- フォーカスのあるボタンが、取り直しで押せない条件(選んだ値が現在の値と同じになったなど)になった時は、`disabled`ではなく`aria-disabled`にし、フォーカスが離れたら`disabled`にする(「[操作できない状態](004-accessibility-rules.md#操作できない状態)」)。フォーカスの有無は`onFocus`・`onBlur`で状態に持ち、押された時は条件を確かめ直して何もしない。

```tsx
const [buttonFocused, setButtonFocused] = useState(false);
const unchanged = (selected ?? current) === current;

<Button
  disabled={unchanged && !buttonFocused}
  aria-disabled={unchanged && buttonFocused ? true : undefined}
  onFocus={() => {
    setButtonFocused(true);
  }}
  onBlur={() => {
    setButtonFocused(false);
  }}
  onClick={() => {
    if (!unchanged) {
      open();
    }
  }}
/>;
```

- 取り直しで項目が加わる一覧は`role="log"`の領域に置き、項目の`key`を識別子にして既存の項目を描き直さない。加わった項目だけが支援技術に読まれる(「[演出の停止手段の義務](004-accessibility-rules.md#演出の停止手段の義務)」)。
- 取り直しの間に読み込み中の表示を出さない。表示中の値を残したまま差し替える。

## テストでの時間の進め方

定期の取り直しは、実際の時間を待たずに、偽のタイマーで時間を進めて確かめる。

### 単体テスト

`bun:test`の単体テストでは、共通の値を重ねた`QueryObserver`を、アプリの既定値を写したQueryClientで購読して確かめる。

```typescript
import { afterEach, beforeEach, expect, jest, test } from 'bun:test';
import {
  environmentManager,
  focusManager,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query';

import {
  LIVE_REFRESH_INTERVAL_MS,
  LIVE_REFRESH_QUERY_OPTIONS,
} from '<共通部品の配置先>/utilities/query/live-refresh.ts';

const detectedIsServer = environmentManager.isServer();

beforeEach(() => {
  environmentManager.setIsServer(() => false);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  focusManager.setFocused(undefined);
  environmentManager.setIsServer(() => detectedIsServer);
});

test('タブが非表示の間は取り直さない', async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: APP_QUERY_STALE_TIME_MS,
        refetchOnWindowFocus: false,
      },
    },
  });
  queryClient.mount();
  const queryFn = jest.fn(() => Promise.resolve('値'));
  const observer = new QueryObserver(queryClient, {
    queryKey: ['live'],
    queryFn,
    ...LIVE_REFRESH_QUERY_OPTIONS,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await settle();

  focusManager.setFocused(false);
  jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 3);
  await settle();

  expect(queryFn).toHaveBeenCalledTimes(1);
  unsubscribe();
  queryClient.clear();
  queryClient.unmount();
});
```

- Bunの実行環境は`window`を持たず、TanStack Queryはサーバーとみなして定期の取り直しを始めない。`environmentManager.setIsServer(() => false)`でブラウザとみなさせ、テストの後に元へ戻す。
- 画面へ戻った時の通知は、`queryClient.mount()`で`focusManager`を購読したクライアントにだけ届く。非表示と表示は`focusManager.setFocused(false)`・`setFocused(true)`で再現し、テストの後に`setFocused(undefined)`で既定の判定へ戻す。
- 共通の値を置く層からアプリのQueryClientの生成を読めない場合は、既定値を写したクライアントを使う(例の`APP_QUERY_STALE_TIME_MS`は`QUERY_STALE_TIME_MS`の写し)。写しは既定値を変える時に合わせて直す。
- `QueryObserver`は`suspense`を指定しないため鮮度が切り上がらず、画面へ戻った時の取り直しを前の取得の直後でも確かめられる。
- `settle`は、取得の完了と通知を進めるため、マイクロタスクを数回待つ補助である。

### ブラウザテスト

画面の部品のブラウザテストでは、`setInterval`と`clearInterval`だけを偽にする。

```tsx
afterEach(() => {
  vi.useRealTimers();
});

test('表示中は定期再取得の間隔ごとに取り直す', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  await renderThread();

  await vi.advanceTimersByTimeAsync(LIVE_REFRESH_INTERVAL_MS - 1);
  expect(threadCalls()).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);

  await expect.poll(() => threadCalls().length).toBe(1);
});
```

- `setTimeout`は偽にしない。TanStack Queryは取得の結果の通知を`setTimeout(…, 0)`でまとめて部品へ届けるため、偽にすると時間を進めるまで画面が更新されない。部品が`setTimeout`で呼び直す処理を確かめる時の偽のタイマーの掛け方は「[マウントの後に呼ぶ確定](006-data-fetching.md#マウントの後に呼ぶ確定)」に従う。
- 偽のタイマーは描画の前に有効にする。定期の取り直しの計時は購読の開始時に始まり、その後に偽にしても進められない。
- `advanceTimersByTimeAsync`で間隔の1ミリ秒前まで進めて取得が無いこと、間隔ちょうどで1回取得することを確かめる。取得の回数は、取得の関数の偽物の呼び出しを文書で絞って数える。
- 止める手段は、`Switch`を切った後に間隔の数倍進めて取得が無いことで確かめる。取得した値による判定は、変わり得ない値を返した後に進めて取得が無いことで確かめる。
- 非表示のタブの判定はTanStack Queryの振る舞いで、単体テストで確かめる。部品のテストで繰り返さない。

### E2Eテスト

E2Eテストでは定期の取り直しを待たない。間隔の分だけテストが延び、時刻によって結果が揺れる。相手の操作の結果は、ページの再読み込みか遷移で最新を読んで確かめる。
