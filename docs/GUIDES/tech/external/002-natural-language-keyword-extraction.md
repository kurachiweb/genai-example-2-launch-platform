# 外部の自然言語APIによるキーワード抽出(Google Cloud Natural Language)

全文検索の索引文書のキーワードを、Google Cloud Natural Language API(v2)のエンティティ分析で抽出する仕組みを定める。要求と応答、キーワードの選別、送る情報の範囲、APIキーの渡し方とAPIの制限、上限と料金、失敗の分類と再試行・縮退、対応言語、抽出を無効にした環境、手元の疎通確認の手順を扱う。索引文書のテーブルと全文検索の索引、索引の更新の流れは「[全文検索の索引](../db/004-full-text-search.md)」に、非同期メッセージの仕組みは「[非同期処理の設計](../infra/003-async-processing.md)」に従う。

## 前提と用語

キーワードの抽出は、全文検索の索引の更新処理(メッセージ`search-index.refresh`の処理)の中だけで行う。ドメインの処理(作成・編集の要求)は外部APIを呼ばず、外部APIの失敗はドメインの書き込みに影響しない。抽出できなかった場合も、正規化した元のテキストで索引を作り(縮退索引)、検索は外部APIに依存せずに動く。

| 部品                                                                                           | 置き場所                                                              | 役割                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `KeywordExtractor`・`KeywordExtractionOutcome`                                                 | 共通ライブラリの`core/search/ports.ts`                                | 抽出の差し替え口と、抽出の結果の種類                            |
| `ANALYZE_ENTITIES_ENDPOINT`・`buildAnalyzeEntitiesRequest`・`interpretAnalyzeEntitiesResponse` | 共通ライブラリの`core/search/natural-language-protocol.ts`            | 要求の組み立てと、応答の検証と分類                              |
| `EXCLUDED_ENTITY_TYPES`・`MAX_KEYWORDS`・`selectKeywords`                                      | 共通ライブラリの`core/search/keyword-selection.ts`                    | キーワードの選別                                                |
| `buildIndexDocument`・`KEYWORD_SELECTION_VERSION`・`MAX_EXTRACTION_INPUT_BYTES`                | 共通ライブラリの`core/search/index-document.ts`                       | 抽出の入力(外部APIへ送るテキスト)とハッシュ                     |
| `decideAfterExtraction`                                                                        | 共通ライブラリの`core/search/refresh-decision.ts`                     | 抽出の結果から、書き込む内容・再試行・通知を決める              |
| `SEARCH_INDEX_REFRESH_RETRY`                                                                   | 共通ライブラリの`core/messaging/contracts/search-index-refresh.ts`    | 索引の更新の再試行の規則                                        |
| `GoogleNaturalLanguageExtractor`                                                               | `<メッセージを受信するアプリ>`の`src/infrastructure/search/`          | 外部APIの呼び出し(打ち切りと通信の失敗の分類を含む)             |
| `DisabledKeywordExtractor`                                                                     | `<メッセージを受信するアプリ>`の`src/infrastructure/search/`          | 抽出を無効にした環境の実装(常に`disabled`)                      |
| `createKeywordExtractor`                                                                       | `<メッセージを受信するアプリ>`の`src/infrastructure/search/`          | 環境の変数で実装を選ぶ                                          |
| `SentrySearchIncidentReporter`                                                                 | `<メッセージを受信するアプリ>`の`src/infrastructure/search/`          | 外部APIの設定の誤りと未登録の検索対象をエラートラッキングへ送る |
| 疎通確認のスクリプト(`smoke:keyword-extraction`)                                               | `<メッセージを受信するアプリ>`の`scripts/smoke-keyword-extraction.ts` | 実際のキーで外部APIへの疎通を手元から確かめる                   |

| 用語                                | 意味                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 検索対象                            | 全文検索の対象となる元データの種類(「[全文検索の索引](../db/004-full-text-search.md#前提と用語)」)                 |
| 抽出の対象の項目                    | 検索対象の項目のうち、キーワード抽出に使う項目(項目の指定`extract: true`)                                          |
| 抽出の入力                          | 抽出の対象の項目を正規化して結合したテキスト。外部APIへ送るのはこのテキストだけである                              |
| キーワード                          | 外部APIが返したエンティティの名前を選別し、半角スペースで結合した文字列。索引文書のキーワードの列に入る            |
| 縮退索引                            | キーワードの代わりに抽出の入力をキーワードの列に入れた索引文書。抽出できない場合も検索で見つかるようにする         |
| `<抽出の方式の変数>`                | `<メッセージを受信するアプリ>`の変数で、`google-natural-language`(外部APIを呼ぶ)か`disabled`(抽出しない)を指定する |
| `<自然言語APIのキーのシークレット>` | `<メッセージを受信するアプリ>`のシークレットで、外部APIのAPIキーを持つ                                             |

- `<抽出の方式の変数>`と`<自然言語APIのキーのシークレット>`の本プロジェクトでのキーの名前と各環境の値は、技術ドキュメントに写さず、プロジェクト固有の値の文書の「[バインディング・変数・シークレット](../../../onboardings/project-values.md#バインディング変数シークレット)」と「[Workerのシークレットのキーの一覧](../../../onboardings/project-values.md#workerのシークレットのキーの一覧)」に置く。

## エンティティ分析の要求と応答

### 要求

`GoogleNaturalLanguageExtractor`は、`POST https://language.googleapis.com/v2/documents:analyzeEntities`(`ANALYZE_ENTITIES_ENDPOINT`)へ次の本文を送る。

```json
{
  "document": { "type": "PLAIN_TEXT", "content": "<抽出の入力>" },
  "encodingType": "UTF8"
}
```

- ヘッダーは`content-type: application/json`と`x-goog-api-key: <APIキー>`である。APIキーをURLのクエリに載せない。
- `document.languageCode`は指定せず、外部APIに言語を自動判定させる。
- `AbortSignal.timeout`で10秒(`GoogleNaturalLanguageExtractor`の既定の`timeoutMs`、10,000ミリ秒)で打ち切る。打ち切りは応答の本文の読み取り中にも働き、打ち切りの信号が立っていれば`timeout`、それ以外の例外は`network`の一時的な失敗にする。
- `fetch`は`createKeywordExtractor(env, fetcher)`の引数で受け取り、合成ルートが大域の`fetch`を渡す。workerdの`fetch`は別のオブジェクトのメソッドとして呼ぶと不正な呼び出しになるため、受け取った関数をフィールドのメソッドとして呼ばず(`this.fetcher(...)`としない)、変数に取り出して呼ぶ。
- 処理する場所のリージョンを指定しない、既定のグローバルのエンドポイントを使う。複数リージョンのエンドポイント(`us-language.googleapis.com`・`eu-language.googleapis.com`)は機械学習の処理をその地域の中に限るが、v2の`documents:analyzeEntities`が使えるかは文書に明記されていない。

### 応答の読み方

応答はZodで検証し、次の項目だけを読む。他の項目(`metadata`・`mentions`など)は無視する。

| 項目                | 使い方                                                    |
| ------------------- | --------------------------------------------------------- |
| `entities[].name`   | キーワードの候補                                          |
| `entities[].type`   | 除外する種類の判定                                        |
| `languageCode`      | 自動判定した言語。非対応言語のログに出す                  |
| `languageSupported` | `true`ならキーワードを選別し、`false`なら非対応言語とする |

- 応答はproto3のJSONで、既定値の項目(空の配列・空文字列・種類の`UNKNOWN`・`languageSupported`の`false`)は省かれる。そのため`entities`が無ければ空の配列、`name`が無ければ空文字列、`type`が無ければ`UNKNOWN`とし、`languageSupported`が無ければ`false`(非対応言語)とする。`languageSupported`の`true`は省かれないため、対応言語の応答には必ず付く。
- 200の応答の形が検証に合わない場合は、状態コード200の設定の誤りとする(「[失敗の分類](#失敗の分類)」)。

### キーワードの選別

`selectKeywords`は、`entities`を出現順に次の規則で選別し、半角スペースで結合する。

1. 種類が`EXCLUDED_ENTITY_TYPES`(`PHONE_NUMBER`・`ADDRESS`・`DATE`・`NUMBER`・`PRICE`)のエンティティを除く。検索語として使われにくく、電話番号と住所は個人に関する情報になり得るためである。
2. 名前をNFKCで正規化し、空白の連続を半角スペース1つにして前後の空白を除く(共用部品の`normalizeIndexText`)。空になった名前は除く。
3. 小文字にした値が既に選んだキーワードと同じなら除く(最初に現れた表記を残す)。
4. 最大500件(`MAX_KEYWORDS`)で打ち切る。

- 選別の規則を変えたら、`KEYWORD_SELECTION_VERSION`の値を上げる。抽出の入力のハッシュにこの値を含めるため、上げた後の更新では前回のキーワードを再利用せずに抽出し直す(「[更新の計画](../db/004-full-text-search.md#更新の計画)」)。上げても既存の索引文書はすぐには作り直されず、元データの次の編集で抽出し直される。

## 送る情報の範囲

外部APIへ送るのは、索引の更新処理が作る抽出の入力(`IndexDocument.extractionInput`)だけである。元データの識別子・利用者の情報・抽出の対象でない項目は送らない。

- 抽出の入力は、検索対象の定義で`extract: true`を指定した項目だけから、定義の項目の順に作る。マークダウンの項目(`format: 'markdown'`)は共用部品の`extractSearchText`でプレーンテキストにし(脚注の見出しと戻りリンクを除く)、各項目を`normalizeIndexText`で正規化して、空になった項目を除いて空行(`\n\n`)で結合する。全ての項目が空なら外部APIを呼ばない。
- 抽出の入力がUTF-8で900,000バイト(`MAX_EXTRACTION_INPUT_BYTES`)を超える場合は、書記素の境界で切り詰める。外部APIの1要求の上限(1,000,000バイト)に収めるためである。
- 抽出の入力のハッシュ(`KEYWORD_SELECTION_VERSION`とNUL文字と抽出の入力を連結した文字列のSHA-256の16進)が前回の抽出と同じなら、外部APIを呼ばずに前回のキーワードを使う(料金の抑制)。
- どの項目を抽出の対象にするかは、送る情報の範囲として、プライバシーポリシーなどに記載した委託先への提供の範囲と一致させる。抽出の対象の項目を加えるときは、その記載も同じ変更で確かめる。
- Googleは、送られたテキストをメモリ上で処理して保存せず、サービスの提供以外に使わない(現在は学習にも使わない)と説明している。要求の時刻や大きさなどのメタデータは、サービスの改善と不正利用の対策のため一時的に記録される(「[Data Usage FAQ](https://cloud.google.com/natural-language/docs/data_usage)」)。
- ログとエラートラッキングには、抽出の入力・キーワード・APIキーを含めない。ログに出すのは、検索対象の名前・元データの識別子・結果・送った文字数(`sentCharacters`、コードポイントの数)・判定した言語・失敗の種類・状態コードだけである。

## APIキーの渡し方とAPIの制限

- APIキーは`<自然言語APIのキーのシークレット>`として`<メッセージを受信するアプリ>`だけに置き、シークレット管理で管理する(「[シークレットの注入](../security/001-secret-management.md#シークレットの注入)」)。外部APIを呼ぶstaging・prodでは、Wrangler設定の`env.<環境種別>.secrets.required`にキーを挙げる。抽出を無効にするローカル環境では、ルートの`secrets.required`に挙げず、シークレット管理のローカル用の環境にも登録しない。
- `secrets.required`に挙げたキーは、デプロイ先のWorkerに設定済みでないとデプロイが失敗する。キーを`secrets.required`に加える変更は、シークレット管理のその環境へキーを登録してからマージする(「[シークレットの登録の規則](../operations/001-deployment.md#シークレットの登録の規則)」)。
- `<抽出の方式の変数>`が`google-natural-language`の環境では、環境の検証が`<自然言語APIのキーのシークレット>`(空でない文字列)を必須にする(「[環境の検証](../backend/002-layered-architecture-on-workers.md#環境の検証)」)。`secrets.required`の確かめをすり抜けてキーが無いまま動いた場合も、外部APIを呼ばずにメッセージの処理を失敗させる。
- Google Cloudのコンソールで、APIキーに「APIの制限」を掛け、Cloud Natural Language APIだけを呼べるようにする。キーが漏れても他のAPIの料金を発生させないためである。Workersの送信元のIPアドレスは固定されないため、IPアドレスの制限は掛けない。
- APIキーはログ・例外・エラートラッキングに含めない。通信の例外の内容は要求の情報を含み得るため、抽出の結果には失敗の種類(`timeout`・`network`)だけを残す。

## 上限と料金

| 項目            | 値                                                                      |
| --------------- | ----------------------------------------------------------------------- |
| 1要求の大きさ   | 1,000,000バイトまで                                                     |
| 1要求のトークン | 100,000トークンまで(超えた分は無視される)                               |
| 要求の数        | プロジェクト単位で毎分600要求・毎日800,000要求まで(既定の割り当て)      |
| 料金            | 1,000文字を1単位とし、毎月5,000単位まで無料、以降は1,000単位あたり1ドル |

- 1件の索引の更新は外部APIの1要求である。Queueのconsumerは1回の起動で最大10件の束を受け、1件ずつ処理する。
- 日次の再抽出は、毎分の要求の上限に対して通常の索引の更新を押し出さないよう、検索対象ごとに200件までに抑える(「[日次の再抽出](../db/004-full-text-search.md#日次の再抽出)」)。
- 料金の目安は、索引の更新のログの`sentCharacters`の合計で見積もる。
- 値は変わり得る。確かめるときはGoogle Cloudの文書「[Quotas and limits](https://docs.cloud.google.com/natural-language/quotas)」「[Pricing](https://cloud.google.com/natural-language/pricing)」を見る。

## 失敗の分類

`interpretAnalyzeEntitiesResponse(<状態コード>, <本文>)`と`GoogleNaturalLanguageExtractor`は、外部APIの結果を`KeywordExtractionOutcome`の次の種類に分類する。

| 状態コード・事象                                                                                          | 結果の種類                            |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 200で応答の形が合い、`languageSupported`が`true`                                                          | `extracted`(選別したキーワード)       |
| 200で応答の形が合い、`languageSupported`が`false`または無い                                               | `unsupported-language`(判定した言語)  |
| 400で、本文の`error.status`が`INVALID_ARGUMENT`かつ`error.message`が言語(`language`・`languages`)に触れる | `unsupported-language`(言語は不明)    |
| 429                                                                                                       | `temporary-failure`(`rate-limited`)   |
| 500以上                                                                                                   | `temporary-failure`(`server-error`)   |
| 打ち切り(10秒)                                                                                            | `temporary-failure`(`timeout`)        |
| 通信の例外                                                                                                | `temporary-failure`(`network`)        |
| 200で応答の形が合わない                                                                                   | `configuration-error`(状態コード200)  |
| 上の表に無い状態コード(言語に触れない400・401・403・404、200以外の2xx・3xx・405・408・409・413・499など)  | `configuration-error`(その状態コード) |

- 言語を指定せずに送るため、言語を理由とする`INVALID_ARGUMENT`は、自動判定した言語が非対応であることを表す。
- 応答の本文がJSONでなくても状態コードで分類できるよう、本文の解析の失敗は本文なしとして扱う。
- 抽出を無効にした環境の実装は、外部APIを呼ばずに常に`disabled`を返す。

## 再試行と縮退

索引の更新処理は、抽出の結果から`decideAfterExtraction`で書き込む内容・再試行・通知を決める。元テキストの列は、どの場合も最新の値を書く。

| 抽出の結果                              | キーワードの列       | 状態          | 抽出の入力のハッシュ | 再試行 | 運用者への通知 |
| --------------------------------------- | -------------------- | ------------- | -------------------- | ------ | -------------- |
| `extracted`                             | 選別したキーワード   | `extracted`   | 保存する             | しない | しない         |
| `unsupported-language`                  | 抽出の入力(縮退索引) | `unsupported` | 保存する             | しない | しない         |
| `disabled`                              | 抽出の入力(縮退索引) | `disabled`    | 保存しない           | しない | しない         |
| `temporary-failure`(試行回数が上限未満) | 前回のまま           | `pending`     | 保存しない           | する   | しない         |
| `temporary-failure`(上限の試行)         | 抽出の入力(縮退索引) | `fallback`    | 保存しない           | しない | しない         |
| `configuration-error`                   | 抽出の入力(縮退索引) | `fallback`    | 保存しない           | しない | する           |

- 再試行は、書き込んだ後に例外(`SearchKeywordExtractionRetryError`、本文とキーワードを含まない)を投げ、非同期メッセージの再試行の規則に委ねる(「[再試行](../infra/003-async-processing.md#再試行)」)。メッセージの処理の登録には`retry: SEARCH_INDEX_REFRESH_RETRY`を渡す。

| 項目               | 値                        |
| ------------------ | ------------------------- |
| `maxAttempts`      | 5回                       |
| `baseDelaySeconds` | 30秒                      |
| `maxDelaySeconds`  | 3,600秒                   |
| 再試行の間隔       | 30秒・60秒・120秒・240秒  |
| 縮退索引を書く試行 | 5回目の試行の一時的な失敗 |

- `SEARCH_INDEX_REFRESH_RETRY`は既定の規則(`DEFAULT_RETRY_POLICY`)と同じ値だが、既定の規則が変わっても外部APIへの再試行の間隔が変わらないよう明示する。
- 5回目の試行では例外にせず、縮退索引を書いて完了する。デッドレターへは移さない。D1の失敗など外部API以外の想定外の例外は、同じ規則で再試行され、上限でデッドレターへ移る。
- 縮退索引(`fallback`)と、1時間以上`pending`のままの索引文書は、日次の再抽出で更新し直す(「[日次の再抽出](../db/004-full-text-search.md#日次の再抽出)」)。非対応言語(`unsupported`)と抽出の無効(`disabled`)は日次の再抽出の対象にせず、元データの次の編集で更新する。
- 非対応言語の文書も抽出の入力のハッシュを保存し、抽出の入力が前回と同じなら外部APIを呼ばずにキーワードの列(縮退索引)を保つ。非対応言語の文書を編集のたびに外部APIへ送らないためである。

### 運用者への通知

| 事象                       | ログのレベル | エラートラッキング                                                                                                                                           |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 一時的な失敗(再試行・縮退) | `warning`    | 送らない(障害時の通知の洪水を避ける)                                                                                                                         |
| 外部APIの設定の誤り        | `error`      | `captureEvent`。文言「キーワード抽出の外部APIの設定に誤りがあります」、指紋`['search-extractor-misconfigured', <状態コード>]`、タグ`search_target`・`status` |
| 未登録の検索対象           | `error`      | `captureEvent`。文言「検索対象が登録されていません」、指紋`['search-unregistered-target', <検索対象>]`、タグ`search_target`                                  |

- エラートラッキングへは`captureMessage`ではなく`captureEvent`で送る(「[同じ文言を繰り返し送る通知](../infra/004-logging-and-error-tracking.md#同じ文言を繰り返し送る通知)」)。
- 設定の誤りは全ての検索対象に共通するため、指紋を検索対象で分けず、状態コードで1つの問題にまとめる。索引文書を書かなかった場合(元データの削除など)も通知する。
- タグと指紋は除去処理の対象外のため、検索対象の名前は名前の形(英小文字で始まる英小文字・数字・`-`の40文字以内)の値だけを送り、それ以外は`unknown`にする。
- 設定の誤りの多くは、要求の誤りかAPIキーの誤り・失効(言語に触れない400)、APIキーの誤り・APIの制限(401・403)、プロジェクトでのAPIの無効化(403)である。キーとGoogle Cloudのプロジェクトの設定を直した後、縮退した索引文書は日次の再抽出で抽出し直される。

## 対応言語

エンティティ分析の対応言語は、中国語(簡体字`zh`・繁体字`zh-Hant`)・英語(`en`)・フランス語(`fr`)・ドイツ語(`de`)・イタリア語(`it`)・日本語(`ja`)・韓国語(`ko`)・ポルトガル語(`pt`)・ロシア語(`ru`)・スペイン語(`es`)である(「[Language support](https://docs.cloud.google.com/natural-language/docs/languages)」)。

- 非対応の言語は、200の応答の`languageSupported: false`か、言語を理由とする400の`INVALID_ARGUMENT`になり、どちらも非対応言語(`unsupported`)の縮退索引にする。再試行しない。
- 公式に対応していない言語でも、外部APIが最善努力で応答することがある。`languageSupported`が`true`の応答だけをキーワードとして使う。
- 対応言語の文書が全て縮退する場合は、実際の応答に`languageSupported: true`が付いていない可能性がある。疎通確認のスクリプトで確かめる(「[疎通確認](#疎通確認)」)。

## 抽出を無効にした環境

- `<抽出の方式の変数>`を`disabled`にした環境(ローカル環境と、ローカル環境に対して動くE2Eテスト)では、外部APIを呼ばず、抽出の入力が空でない索引文書を状態`disabled`の縮退索引にする。抽出の入力が空の索引文書は、抽出を有効にした環境と同じく空のキーワードで状態`extracted`になる。前回抽出済みで抽出の入力が変わらない索引文書は、前回のキーワードを再利用する。APIキーを持たない開発者でもアプリを起動でき、ローカルの試行で料金が発生しない。
- `secrets`を定義したWrangler設定では、`wrangler dev`が`secrets.required`のキーだけを`env`へ渡す。ローカル環境で`<抽出の方式の変数>`を`google-natural-language`に変えても、ルートの`secrets.required`にキーが無いためキーは届かず、環境の検証で失敗する。ローカルで実際のAPIを確かめるときは、次の疎通確認のスクリプトを使う。
- Workers統合テストでは`<抽出の方式の変数>`を`google-natural-language`にし、APIキーをテスト用の固定値にして、`fetch`の代わりの注入か`vi.spyOn(globalThis, 'fetch')`で外部への通信を止める。

## 疎通確認

`<メッセージを受信するアプリ>`のスクリプト`smoke:keyword-extraction`は、環境変数の`<自然言語APIのキーのシークレット>`のキーで`GoogleNaturalLanguageExtractor`を呼び、固定の日本語と英語の短文から抽出できることを確かめる。Workersのコードではないため、キーは`process.env`から読む。

```sh
cd <メッセージを受信するアプリ>
infisical run --env staging -- bun run smoke:keyword-extraction
```

1. シークレット管理のstagingの環境に`<自然言語APIのキーのシークレット>`を登録する(登録済みなら不要)。ローカル用の環境には登録しない。
2. シークレットを注入してスクリプトを実行する(「[シークレットの注入](../security/001-secret-management.md#シークレットの注入)」)。プロジェクトで決めた共通のオプションがあれば、`infisical`の直後に付ける。
3. 各短文の結果の種類・判定した言語・キーワードの数の表示と、終了コードを確かめる。

| 終了コード | 条件                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| 0          | 全ての短文で`extracted`になった                                                                                   |
| 1          | 抽出できなかった短文がある。非対応言語に分類された場合は、`languageSupported: true`が付いていない可能性を表示する |
| 2          | キーが注入されていない。登録と実行の手順を表示する                                                                |

- 日本語と英語の短文が`extracted`になれば、APIキー・APIの制限・プロジェクトでのAPIの有効化が正しく、実際の応答に`languageSupported: true`が付いている。
- 抽出できなかった短文は、結果の種類と表示された値で原因を切り分ける。

| 結果の種類            | 表示                                     | 主な原因                                                  |
| --------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `configuration-error` | 状態コード400                            | 要求の誤りか、APIキーの誤り・失効(言語に触れない400)      |
| `configuration-error` | 状態コード401・403                       | APIキーの誤り・APIの制限・プロジェクトでのAPIの無効化     |
| `configuration-error` | 状態コード200                            | 応答の形が検証に合わない(APIの仕様の変更)                 |
| `temporary-failure`   | 種類`rate-limited`                       | 割り当ての不足(429)                                       |
| `temporary-failure`   | 種類`server-error`・`timeout`・`network` | 外部APIの障害や通信の一時的な失敗。時間を置いて再実行する |

## 参考資料

- Google Cloudの「[documents.analyzeEntities(v2)](https://docs.cloud.google.com/natural-language/docs/reference/rest/v2/documents/analyzeEntities)」「[Document(v2)](https://docs.cloud.google.com/natural-language/docs/reference/rest/v2/documents)」「[Entity(v2)](https://docs.cloud.google.com/natural-language/docs/reference/rest/v2/Entity)」
- Google Cloudの「[Language support](https://docs.cloud.google.com/natural-language/docs/languages)」「[Quotas and limits](https://docs.cloud.google.com/natural-language/quotas)」「[Pricing](https://cloud.google.com/natural-language/pricing)」
- Google Cloudの「[Locations](https://docs.cloud.google.com/natural-language/docs/locations)」「[Data Usage FAQ](https://cloud.google.com/natural-language/docs/data_usage)」
