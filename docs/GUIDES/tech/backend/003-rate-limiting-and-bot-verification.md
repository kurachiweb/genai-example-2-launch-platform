# レート制限とbot判定の検証

Cloudflare Workersのサーバーで回数を制限する2つの方式(Rate Limitingバインディングによる制限と、Durable Objectsによる厳密なカウンタ)、全HTTPリクエストに掛けるWorker単位のIP制限の規約、制限の除外規則とクライアントIPの解決の差し替え、及びCloudflare Turnstileによるbot判定の検証の方法を定める。

## 前提と用語

層構成・処理単位のコンテナ・共通エラーは「[Cloudflare Workersでの層構成と依存性の組み立て](002-layered-architecture-on-workers.md)」に従う。部品の置き場所は、共通ライブラリの配置先からのパスで示す。

| 部品                                                           | 置き場所(共通ライブラリ内)                        | 役割                                                  |
| -------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `bindingRateLimit`                                             | `workers/rate-limit/binding-rate-limit.ts`        | Rate Limitingバインディングで数える汎用のミドルウェア |
| `ipRateLimit`・`IP_RATE_LIMIT_KEY_PREFIX`・`UNKNOWN_CLIENT_IP` | `workers/rate-limit/ip-rate-limit.ts`             | Worker単位のIP制限                                    |
| `excludePath`・`excludeHostname`・`RateLimitExclusion`         | `workers/rate-limit/exclusions.ts`                | 制限の除外規則                                        |
| `resolveConnectingIp`・`ClientIpResolver`                      | `workers/rate-limit/client-ip.ts`                 | クライアントIPの解決                                  |
| `RateLimitCounter`                                             | `workers/rate-limit/rate-limit-counter.ts`        | 厳密カウンタのDurable Objectのクラス                  |
| `createRateLimitCounterClient`・`RateLimitCounterClient`       | `workers/rate-limit/rate-limit-counter-client.ts` | 厳密カウンタを呼び出すクライアント                    |
| `applyHit`・`CounterRule`・`CounterDecision`                   | `core/rate-limit/fixed-window.ts`                 | 固定期間カウンタの状態遷移                            |
| `hashRateLimitKey`・`HashedRateLimitKey`                       | `core/rate-limit/rate-limit-key.ts`               | レート制限のキーのハッシュ化                          |
| `createTurnstileVerifier`・`BotVerifier`                       | `workers/bot-protection/turnstile-verifier.ts`    | bot判定の検証(コンテナから取得して呼ぶ形)             |
| `turnstileGuard`                                               | `workers/bot-protection/turnstile-guard.ts`       | bot判定の検証(経路に掛けるミドルウェアの形)           |
| `interpretSiteverify`・`BotVerificationFailure`                | `core/bot-protection/siteverify-result.ts`        | 判定サービスの応答の分類                              |

| 用語                                    | 意味                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `<共通ライブラリの配置先>`              | 「[Cloudflare Workersでの層構成と依存性の組み立て](002-layered-architecture-on-workers.md#前提と用語)」と同じ |
| ロケーション                            | 要求を処理したCloudflareのデータセンター                                                                      |
| `<IP制限のバインディング名>`            | Worker単位のIP制限に使うRate Limitingバインディングの名前。全Workerで同じ名前にする                           |
| `<IP制限の名前空間>`                    | Worker単位のIP制限のバインディングの`namespace_id`。Worker・環境ごとに別の値にする                            |
| `<厳密カウンタのバインディング名>`      | 厳密カウンタのDurable Objectのバインディングの名前                                                            |
| `<bot判定の秘密鍵のシークレットのキー>` | Turnstileの秘密鍵(シークレットキー)を保持するシークレットの名前                                               |
| `<期待するホスト名の変数のキー>`        | bot判定の結果のホスト名と照合するホスト名を、カンマ区切りで持つ変数の名前                                     |

## 制限の方式の選び方

| 方式                                            | 数え方                                                                                                     | 期間                | 使う場面                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| Rate Limitingバインディング(`bindingRateLimit`) | ロケーションごとの近似値。ロケーション内でも上限をわずかに超えて許可し得る。他のロケーションとは合算しない | 10秒か60秒          | 送信元IPアドレスごとの大量の要求など、多少の超過を許せる過負荷の防止 |
| 厳密カウンタ(`RateLimitCounterClient`)          | キーごとに1つのDurable Objectで正確に数える                                                                | 1秒以上の任意の秒数 | メールの再送・ログインの試行など、回数を正確に守る必要がある操作     |

- 厳密カウンタは1回数えるごとにDurable Objectへの要求が1回発生する。全HTTPリクエストのような大量の要求には、バインディングによる制限を使う。

## Worker単位のIP制限

全てのWorkerは、受け付ける全HTTPリクエストを送信元IPアドレスごとに数え、上限を超えた要求を処理せずに拒否する。HTTPリクエストを受け付ける全てのWorker(APIを返すWorker・画面を返すWorkerを問わない)が、次の規約で同じ制限を掛ける。

### 規約

| 項目             | 値                                                                                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| バインディング   | Wrangler設定の`ratelimits`の`<IP制限のバインディング名>`                                                                                                                                                                                                                   |
| 上限             | 送信元IPアドレスごとに10秒あたり100回(`simple: { limit: 100, period: 10 }`)                                                                                                                                                                                                |
| 名前空間         | Worker・環境ごとに別の`namespace_id`(`<IP制限の名前空間>`)。Workerごとに独立して数える                                                                                                                                                                                     |
| キー             | `ip:<送信元IPアドレス>`。送信元IPアドレスが分からなければ`ip:unknown`                                                                                                                                                                                                      |
| 送信元IPアドレス | ブラウザから直接要求を受けるWorkerは`CF-Connecting-IP`ヘッダーの値(前後の空白を除く)。他のWorkerから中継された要求は「[クライアントIPの解決の差し替え](#クライアントipの解決の差し替え)」に従う                                                                            |
| 対象             | Workerが受け付ける全HTTPリクエスト。除外は登録した経路・ホスト名だけ(「[除外規則](#除外規則)」)                                                                                                                                                                            |
| 超過時の応答     | 状態コード429、`Retry-After: 10`、`Cache-Control: no-store`。JSONを返すWorkerは共通のエラー形式`{ "error": { "code": "rate_limit_exceeded", "message": "<利用者に見せる文>" } }`。画面を返すWorkerは、画面の要求にはエラー画面を、それ以外の要求には共通のエラー形式を返す |

- キーの接頭辞`ip:`と不明時の`unknown`は、共通ライブラリの`IP_RATE_LIMIT_KEY_PREFIX`・`UNKNOWN_CLIENT_IP`である。共通ライブラリを使わないWorkerも、同じ文字列でキーを作る。
- `Retry-After`は期間の秒数(10)を返す。バインディングは期間の残り時間を返さないため、実際に許可されるまでの時間とは一致しない。
- 送信元IPアドレスが分からない要求は、すべて同じキー`ip:unknown`で数えられ、上限を共有する。
- 同じ`namespace_id`を持つバインディングは、Workerが違っても同じロケーション内で同じキーの回数を共有する。Workerごとに独立して数えるため、`namespace_id`をWorker・環境ごとに分ける。`namespace_id`はアカウント内で一意な正の整数を文字列で書く。
- `ratelimits`はWrangler設定の`env`へ継承されないため、ルートと`env.<環境種別>`のそれぞれに書く。

```jsonc
{
  "ratelimits": [
    {
      "name": "<IP制限のバインディング名>",
      "namespace_id": "<IP制限の名前空間>",
      "simple": { "limit": 100, "period": 10 },
    },
  ],
}
```

### 組み込み位置

共通ライブラリの`createWorkerApp`は、処理単位の文脈(相関IDとクライアントIPの解決)の直後、ヘルスチェック・環境の検証・各経路より前に`ipRateLimit`を置く(「[ミドルウェアの順序](002-layered-architecture-on-workers.md#ミドルウェアの順序)」)。アプリが自分で`ipRateLimit`を掛ける必要はない。

- `ipRateLimit`は、Honoの文脈変数`clientIp`の値からキーを作る。`clientIp`は処理単位の文脈のミドルウェアが`resolveClientIp`で求める。
- バインディングの呼び出しが例外になった場合は、例外の変換により500になる。

### 除外規則

署名やトークンで送信元の真正性を確かめる経路(外部サービスからのWebhookの受信、メールの配信停止の要求など)と、エッジキャッシュの後ろで配信するホスト名だけを、IP制限から除外する。除外規則は合成ルートの`src/composition/rate-limit-exclusions.ts`の`RATE_LIMIT_EXCLUSIONS`に登録し、追加はコードレビューで確かめる。次は、Webhookの受信の経路と、配信用のホスト名を除外する例である。

```typescript
import type { RateLimitExclusion } from '<共通ライブラリの配置先>/workers/rate-limit/exclusions.ts';
import {
  excludeHostname,
  excludePath,
} from '<共通ライブラリの配置先>/workers/rate-limit/exclusions.ts';

export const RATE_LIMIT_EXCLUSIONS: readonly RateLimitExclusion<Env>[] = [
  excludePath('/webhooks/payment', 'POST'),
  excludeHostname((env) => env.MEDIA_HOSTNAME),
];
```

| 生成関数                           | 除外する要求                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `excludePath(pathPrefix, method?)` | パスが`pathPrefix`に一致するか、`pathPrefix`の下にある要求。`method`を指定すれば、そのメソッドだけ |
| `excludeHostname(hostname)`        | 要求のURLのホスト名が、環境から求めたホスト名と一致する要求                                        |

- `excludePath`はパスの区切りで一致を判定する。`/webhooks/payment`は`/webhooks/payment`と`/webhooks/payment/...`を除外し、`/webhooks/payment-other`を除外しない。`pathPrefix`の末尾が`/`なら、その文字列で始まるパスを除外する。
- `excludePath`の`pathPrefix`は`/`で始める。そうでなければ`RangeError`になる。比べるのはURLのパスだけで、クエリ文字列は比べない。`method`は大文字にそろえて比べる。
- `excludeHostname`は、環境から求めたホスト名を小文字にそろえて比べる。値が未定義か空文字なら、どの要求も除外しない。
- `RateLimitExclusion<E>`は`(request, env) => boolean`である。上の生成関数で表せない条件は、この形の関数を書いて登録する。

### クライアントIPの解決の差し替え

`createWorkerApp`の`resolveClientIp`に`ClientIpResolver`(`(request: Request) => string | undefined`)を渡すと、クライアントIPの求め方を差し替えられる。省略時は`resolveConnectingIp`で、`CF-Connecting-IP`ヘッダーの値の前後の空白を除いたもの(空なら`undefined`)を返す。

- 求めたクライアントIPは、IP制限のキー、bot判定の検証で判定サービスへ送る送信元IP、処理単位の情報(`InvocationScope`の`info.clientIp`)に使われる。
- 他のWorker(画面を返すWorkerなど)から中継された要求では、`CF-Connecting-IP`は中継元のWorkerの値になり得る。中継元が渡す元のクライアントIPは、中継元の真正性(Service Bindingsによる内部の呼び出しや内部認証など)を要求から確かめられる場合だけ返し、それ以外は`resolveConnectingIp`へ委ねるリゾルバを渡す。
- 任意のヘッダー(`X-Forwarded-For`など)を無条件に信頼しない。利用者が書き換えられるヘッダーを信頼すると、IP制限を回避される。

## バインディングによる制限

`bindingRateLimit`は、任意のRate Limitingバインディングとキーで数える汎用のミドルウェアである。IP制限と別のルール(特定の経路だけを1分あたりで制限するなど)に使う。次は、検索の経路だけを別のバインディングで制限する例である。

```typescript
import { bindingRateLimit } from '<共通ライブラリの配置先>/workers/rate-limit/binding-rate-limit.ts';

app.use(
  '/search/*',
  bindingRateLimit<Env>({
    binding: (env) => env.SEARCH_RATE_LIMITER,
    key: (_request, clientIp) => `search:${clientIp ?? 'unknown'}`,
    periodSeconds: 60,
  }),
);
```

| オプション      | 内容                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| `binding`       | 環境からRate Limitingバインディングを返す関数                                            |
| `key`           | 要求とクライアントIPからキーを作る関数。ルールごとに接頭辞を付けて、他のルールと区別する |
| `periodSeconds` | `10`か`60`。Wrangler設定の`simple.period`と同じ値にする。超過時の`Retry-After`に使う     |
| `exclusions`    | 除外規則(任意)                                                                           |

- 超過時は、状態コード429・`Retry-After: <periodSeconds>`・`Cache-Control: no-store`と、コード`rate_limit_exceeded`の共通のエラー形式で応答する。
- 上限(`simple.limit`)と期間(`simple.period`)はWrangler設定で決まる。ルールごとに別のバインディングと`namespace_id`を用意する。
- 除外規則に当たる要求は数えずに通す。

## 厳密カウンタ

厳密カウンタは、ルールとハッシュ化したキーの組ごとに1つのDurable Objectで回数を数える固定期間のカウンタである。

### ルールとキー

```typescript
import type { CounterRule } from '<共通ライブラリの配置先>/core/rate-limit/fixed-window.ts';

const EMAIL_RESEND_RULE: CounterRule = {
  name: 'email-resend-by-address',
  limit: 3,
  windowSeconds: 3600,
};
```

- ルールは名前(`name`)・上限回数(`limit`)・期間の秒数(`windowSeconds`)を持つ。上限回数と期間の秒数は1以上の整数で、そうでなければ数えるときに`RangeError`になる。
- ルールの名前は、数える対象と単位を表す小文字とハイフンの名前にする。名前ごとに別のカウンタになる。
- キーは`hashRateLimitKey(hasher, ...parts)`でハッシュ化した`HashedRateLimitKey`だけを受け取る。IPアドレスやメールアドレスなどの元の値はカウンタに保存されない。ハッシュ化の方法・部品の連結・正規化は「[レート制限のキー](../security/002-keyed-hashing.md#レート制限のキー)」に従う。
- カウンタのDurable Objectは、`<ルールの名前>:<ハッシュ化済みのキー>`を名前として`idFromName`で選ばれる。

### 数え方

クライアント`RateLimitCounterClient`は、処理単位のコンテナから識別子`PLATFORM_TYPES.RateLimitCounterClient`で取得する。厳密カウンタを使うWorkerのモジュールが、`createRateLimitCounterClient(env.<厳密カウンタのバインディング名>)`を束縛する。クライアントの型が共通ライブラリの`workers`にあるため、厳密カウンタを使うクラスはインフラ層に置く。

```typescript
import { inject, injectable } from 'inversify';

import type { KeyedHasher } from '<共通ライブラリの配置先>/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '<共通ライブラリの配置先>/core/di/identifiers.ts';
import { hashRateLimitKey } from '<共通ライブラリの配置先>/core/rate-limit/rate-limit-key.ts';
import type { Clock } from '<共通ライブラリの配置先>/core/time/clock.ts';
import type { RateLimitCounterClient } from '<共通ライブラリの配置先>/workers/rate-limit/rate-limit-counter-client.ts';

@injectable()
export class EmailResendLimiter {
  constructor(
    @inject(PLATFORM_TYPES.KeyedHasher)
    private readonly hasher: KeyedHasher,
    @inject(PLATFORM_TYPES.RateLimitCounterClient)
    private readonly counters: RateLimitCounterClient,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async consume(normalizedEmail: string): Promise<void> {
    const key = await hashRateLimitKey(this.hasher, normalizedEmail);
    const decision = await this.counters.hit(EMAIL_RESEND_RULE, key);
    this.counters.assertWithinLimit(decision, this.clock.now().getTime());
  }

  async clear(normalizedEmail: string): Promise<void> {
    const key = await hashRateLimitKey(this.hasher, normalizedEmail);
    await this.counters.reset(EMAIL_RESEND_RULE, key);
  }
}
```

| 操作                               | 振る舞い                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hit(rule, key)`                   | 回数を1増やし、判定`CounterDecision`(許可の可否`allowed`・回数`count`・残り回数`remaining`・リセット予定時刻のミリ秒`resetAt`)を返す。上限に達していれば増やさずに拒否を返す |
| `assertWithinLimit(decision, now)` | 拒否の判定なら、状態コード429・コード`rate_limit_exceeded`・`Retry-After: <リセットまでの秒数>`の共通エラーを投げる。秒数は`resetAt`までの残りを切り上げた値(0以上)である    |
| `reset(rule, key)`                 | 期間の途中でも記録を消し、回数を0に戻す(認証の成功で試行回数を戻すなど)                                                                                                      |

- 期間は、記録が無い状態での最初の`hit`の時点から始まる固定の期間である。期間が終わった後の`hit`は、新しい期間を始めて回数を1にする。
- 上限に達した後の`hit`は、回数・期間の開始・リセット予定時刻を変えない。拒否され続けても期間は延びない。
- 同じキーへの同時の要求は、Durable Objectが1つずつ処理するため、取りこぼしや重複なく数えられる。Durable Objectの中では、記録の読み出しから保存までを同期のストレージAPI(`ctx.storage.kv`)で行い、`await`を挟まない。

### 記録の削除

- 新しい期間を始めたとき、期間の終わりの時刻にAlarmを予約する。Alarmと`reset`で、記録とAlarmをすべて消す。回数が0に戻ったキーの記録は残らない。
- Alarmは重複して実行され得るため、Alarmの処理は冪等にしている。期間が続いている間は記録を消さず(Alarmが失われていれば予約し直す)、期間が終わっているか記録が無いときだけ消す。`reset`は無条件に消す。
- 保存する記録は、回数・期間の開始時刻・期間の秒数だけである。ハッシュ化前のキーは保存しない。

### Wranglerの設定

厳密カウンタを使うWorkerのWrangler設定に、Durable Objectのバインディングと、SQLiteのストレージを使うクラスのマイグレーションを書く。クラス`RateLimitCounter`は、そのWorkerのエントリから名前付きでエクスポートする。

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "name": "<厳密カウンタのバインディング名>",
        "class_name": "RateLimitCounter",
      },
    ],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["RateLimitCounter"] }],
  "env": {
    "<環境種別>": {
      "durable_objects": {
        "bindings": [
          {
            "name": "<厳密カウンタのバインディング名>",
            "class_name": "RateLimitCounter",
          },
        ],
      },
    },
  },
}
```

- `durable_objects`は`env`へ継承されないため、ルートと`env.<環境種別>`のそれぞれに書く。`migrations`は継承されるため、ルートにだけ書く。

## bot判定の検証

保護対象の操作は、Cloudflare Turnstileのトークンを判定サービス(siteverify)で検証し、成功した場合だけ許可する。判定サービスの障害時も操作を許可しない(フェイルクローズ)。

### 2つの形態

| 形態                                          | 使い方                                                                                                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 経路に掛けるミドルウェア`turnstileGuard`      | モジュールの経路に`app.post('/sign-up', turnstileGuard({ action: 'sign-up' }), handler)`のように掛ける。既定では`CF-Turnstile-Response`ヘッダーからトークンを読む。`token`オプションに`(request) => string \| undefined`を渡すと読み方を変えられる |
| コンテナから取得して呼ぶサービス`BotVerifier` | 経路以外の処理(GraphQLのリゾルバなど)は、処理単位のコンテナから識別子`PLATFORM_TYPES.BotVerifier`で取得し、`assertHuman({ token, remoteIp, expectedAction })`を呼ぶ                                                                                |

- `turnstileGuard`は処理単位のコンテナから`BotVerifier`を取得し、送信元IPにHonoの文脈変数`clientIp`を使う。コンテナが作られた後に動く、モジュールの経路にだけ掛ける。
- `BotVerifier`の`verify`は判定の結果(`BotVerificationResult`)を返し、例外を投げない。`assertHuman`は失敗時に共通エラーを投げる。
- bot判定を使うWorkerのモジュールが、`PLATFORM_TYPES.BotVerifier`へ`createTurnstileVerifier({ secretKey, expectedHostnames, fetch })`を束縛する。`secretKey`は`env.<bot判定の秘密鍵のシークレットのキー>`、`expectedHostnames`は`env.<期待するホスト名の変数のキー>`をカンマで分割して前後の空白を除き、空の要素を除いた配列、`fetch`は`globalThis.fetch`である。
- 部品のログのカテゴリの先頭は、bot判定を使う1つのWorkerのアプリ名に固定されている。ログの設定は自分のアプリ名のカテゴリにだけ出力先を付けるため、別のWorkerでそのまま使うとログが出力されない。別のWorkerで使うときは、部品のオプションでアプリ名を受け取るよう改修する。

### 検証の手順

1. トークンが無いか空文字なら、通信せずに`missing-token`とする。
2. トークンが2048文字を超えたら、通信せずに`invalid-token`とする。
3. `https://challenges.cloudflare.com/turnstile/v0/siteverify`へ、JSONで`secret`・`response`(トークン)・`remoteip`(送信元IP)をPOSTする。5秒(`timeoutMs`で変更できる)で打ち切る。
4. 応答を`interpretSiteverify`で分類する。成功の応答でも、期待する操作名・ホスト名と一致しなければ失敗とする。

### 失敗の分類と応答

| 分類                   | 原因                                                                                                                                                  | `assertHuman`の応答                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `missing-token`        | トークンが無い・空文字                                                                                                                                | 403 `bot_verification_failed`                        |
| `invalid-token`        | トークンが2048文字を超える、エラーコード`missing-input-response`・`invalid-input-response`、未知のエラーコードだけの失敗、エラーコードの無い失敗      | 403 `bot_verification_failed`                        |
| `expired-or-duplicate` | エラーコード`timeout-or-duplicate`(期限切れ・使用済み)                                                                                                | 403 `bot_verification_failed`                        |
| `action-mismatch`      | 期待する操作名と、判定結果の`action`が一致しない                                                                                                      | 403 `bot_verification_failed`                        |
| `hostname-mismatch`    | 期待するホスト名のどれとも、判定結果の`hostname`が一致しない                                                                                          | 403 `bot_verification_failed`                        |
| `unavailable`          | エラーコード`internal-error`、通信の失敗、時間切れ、2xx以外の状態コード、JSONでない応答・形の不正な応答、成功の応答に`hostname`・`challenge_ts`が無い | 503 `bot_verification_unavailable`・`Retry-After: 5` |
| `misconfigured`        | エラーコード`missing-input-secret`・`invalid-input-secret`・`bad-request`(秘密鍵や要求の誤り)                                                         | 503 `bot_verification_unavailable`・`Retry-After: 5` |

- 複数のエラーコードがあれば、`misconfigured`・`unavailable`・`expired-or-duplicate`・`invalid-token`の順に優先する。
- 判定結果の`errorCodes`には、2xxの応答のエラーコードだけを残す。通信せずに失敗した場合と2xx以外の応答では空である。
- `misconfigured`は利用者の再試行では直らないため、エラートラッキングへレベル`error`のイベントとしても送る。文言が同じイベントが重複として捨てられないよう、`captureEvent`で`logentry`の文言と`fingerprint`を付けて送り、エラーコードを`extra`に入れる。

### 期待する操作名とホスト名

- 操作名は、`turnstileGuard`の`action`か`assertHuman`の`expectedAction`を指定したときだけ照合する。画面のウィジェットに設定した操作名(`action`)と同じ値を指定する。
- ホスト名は、期待するホスト名の配列が空でなければ、判定結果のホスト名がいずれかと完全に一致することを確かめる。期待するホスト名は小文字にそろえてから比べる。
- 期待するホスト名には、ウィジェットを表示する画面のホスト名を、環境ごとに変数で設定する。

### ログ

- 失敗した検証は、`warning`のログに分類(`failure`)とエラーコード(`errorCodes`)を記録する。
- トークンの値はログの属性に入れない。トークンのフィールド名は、ログの伏せ字の対象にも含める。

### テスト用の鍵

Turnstileは、常に同じ結果を返すテスト用のサイトキーと秘密鍵を用意している。テスト用のサイトキーのウィジェットはダミーのトークン`XXXX.DUMMY.TOKEN.XXXX`を発行し、テスト用の秘密鍵はダミーのトークンだけを受け付ける。本番の秘密鍵はダミーのトークンを拒否し、テスト用の秘密鍵は本物のトークンを拒否する。

| 種類       | 値                                    | 結果                               |
| ---------- | ------------------------------------- | ---------------------------------- |
| サイトキー | `1x00000000000000000000AA`            | 常に成功(ウィジェットを表示する)   |
| サイトキー | `1x00000000000000000000BB`            | 常に成功(ウィジェットを表示しない) |
| サイトキー | `2x00000000000000000000AB`            | 常に失敗(ウィジェットを表示する)   |
| サイトキー | `2x00000000000000000000BB`            | 常に失敗(ウィジェットを表示しない) |
| 秘密鍵     | `1x0000000000000000000000000000000AA` | 常に成功                           |
| 秘密鍵     | `2x0000000000000000000000000000000AA` | 常に失敗                           |
| 秘密鍵     | `3x0000000000000000000000000000000AA` | 常に`timeout-or-duplicate`で失敗   |

- ローカル環境では、シークレット管理サービスのローカル環境の`<bot判定の秘密鍵のシークレットのキー>`に常に成功する秘密鍵を置き、画面には常に成功するサイトキーのうち、ウィジェットの種類(表示する・表示しない)に合うものを使う。テスト用の鍵の判定結果のホスト名は画面のホスト名と一致するとは限らないため、ローカル環境では`<期待するホスト名の変数のキー>`を空にして照合しない。
- Workers統合テストでは、常に成功する秘密鍵をテスト用のバインディングとして渡し、`createTurnstileVerifier`の`fetch`を差し替えて、判定サービスへ通信しない。成功・各失敗・時間切れは、差し替えた`fetch`の応答で再現する。

## テスト

- Rate Limitingバインディングは、ローカル(Miniflare)でも時計にそろった期間で上限を効かせる。IP制限のWorkers統合テストは実物のバインディングで数え、期間の残りが短ければ次の期間の始まりを待ってから要求する。
- 厳密カウンタのAlarmは、`cloudflare:test`の`runDurableObjectAlarm`で実行して、記録が消えることを確かめる。
- 一部のWorkerにしか無いバインディング(厳密カウンタなど)を共通ライブラリのテストで使うときは、型付きの`env`から直接読まず、`Reflect.get`で取り出して型ガードで確かめる(「[層とテスト種別・カバレッジの分担](002-layered-architecture-on-workers.md#層とテスト種別カバレッジの分担)」)。
