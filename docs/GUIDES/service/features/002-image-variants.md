# 画像配信の名前付きバリアント一覧

ユーザーがアップロードした画像(プロフィール画像・管理者プロフィール画像・プロダクトロゴ・スクリーンショット)を、イベントサーバーの画像配信専用ドメイン(SW-012)からWorkers Images Binding(SW-013)で変換して配信する際の、名前付きバリアントを定義する。
問い合わせの添付ファイルは画像形式であってもこの経路では配信せず、ファイル用非公開バケットから認可付きで配信する(FR-INQRY-016)。

## 配信URL

```
https://{画像配信ドメイン}/{variant}/{objectKey}.{ext}
```

| 要素             | 内容                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 画像配信ドメイン | staging: `genai-example-2-images-staging.lab.kurachiweb.com`、prod: `genai-example-2-images.lab.kurachiweb.com`                        |
| `variant`        | 本書で定義するバリアント名。未定義の名前は404                                                                                          |
| `objectKey`      | アップロード時にサーバーが採番した推測不能な識別子(FR-FILEU-006)。画像用非公開バケットのキー。レコードID(DR-009のULID)とは別に採番する |
| `ext`            | [出力フォーマット](#出力フォーマット)で定義する拡張子。未定義の拡張子は404                                                             |

例: `https://genai-example-2-images.lab.kurachiweb.com/square-md/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.avif`

出力フォーマットを`Accept`ヘッダーではなくURLで指定するのは、Cloudflareのエッジキャッシュがヘッダーによる分離(`Vary`)を本サービスの条件では行えないためである。Vary for ImagesはゾーンFreeプランでは利用できず、Workerが自ら生成するレスポンスをキャッシュするCache APIは`Vary`を考慮しない。URLに形式を含めることでパスのみでキャッシュキーが定まり、Purge Files by URL(SW-010)の対象もパスの列挙で確定する。元画像そのもの(バリアント指定なし)は配信しない。

## バリアント一覧

DPR 1端末とDPR 2端末の両方に対応するため、それぞれの画像バリアントを用意して`srcset`で出し分ける。

| バリアント名          | 出力サイズ                  | fit          | 解像度    | 1xの用途                                                                                             | 2xの用途                                          |
| --------------------- | --------------------------- | ------------ | --------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `square-xs`           | 32×32px                     | `cover`      | `1x`      | 各種一覧でのユーザープロフィール画像、ヘルプ記事の作成者・問い合わせチャットの管理者プロフィール画像 | —                                                 |
| `square-sm`           | 64×64px                     | `cover`      | `2x`/`1x` | 予選・トーナメント・ディレクトリ・スポンサー一覧のプロダクトロゴ                                     | `square-xs`での`1x`の用途と同じ(CSS 32px)         |
| `square-md`           | 128×128px                   | `cover`      | `2x`/`1x` | プロダクトのロゴ、公開プロフィールページのユーザープロフィール画像                                   | `square-sm`での`1x`の用途と同じ(CSS 64px)         |
| `square-lg`           | 256×256px                   | `cover`      | `2x`      | —                                                                                                    | `square-md`での`1x`の用途と同じ(CSS 128px)        |
| `screenshot-thumb`    | 480×480px以内(縦横比維持)   | `scale-down` | `1x`      | プロダクトのスクリーンショット一覧サムネイル、管理者側の確認表示サムネイル                           | —                                                 |
| `screenshot-thumb-2x` | 960×960px以内(縦横比維持)   | `scale-down` | `2x`      | —                                                                                                    | `screenshot-thumb`での`1x`の用途と同じ(CSS 480px) |
| `screenshot-full`     | 1920×1920px以内(縦横比維持) | `scale-down` | `1x`      | スクリーンショット拡大表示(ライトボックス)                                                           | —                                                 |

- `cover`は縦横比を維持して指定サイズを覆うように拡縮し、はみ出た部分を中央基準で切り取る。アップロード時のトリミング(FR-FILEU-003)で正方形に整えている前提だが、公開API等で非正方形が混入しても崩れないようにする
- スクリーンショット系バリアントの`fit`は`scale-down`で、幅・高さの両方を上限として指定するため、原本の縦横比を保ったままいずれか一方が上限に達するまで縮小する
- `scale-down`は指定サイズより小さい画像を拡大しない
- ロゴとプロフィール画像は同じ正方形バリアントを共有する。用途別に名前を分けないのは、バリアント数を抑えてキャッシュ効率とパージ対象を単純にするためである
- 隔離バケットへ移動された画像(FR-FILEU-011・012)はどのバリアントでも404を返す。管理者の手動モデレーション画面では隔離バケットの原本を管理者側フロントエンドの同一オリジンからAPIサーバー経由で表示する(FR-ADMUG-014)

## 出力フォーマット

URLの拡張子`ext`により出力フォーマットを指定する。配信サーバーはリクエストの`Accept`ヘッダーを参照しない。

| `ext`  | 出力 | 対象となる原本                   |
| ------ | ---- | -------------------------------- |
| `avif` | AVIF | SVG以外                          |
| `webp` | WebP | SVG以外                          |
| `jpg`  | JPEG | SVG以外                          |
| `png`  | PNG  | SVG以外                          |
| `svg`  | SVG  | SVGのみ([SVGの扱い](#svgの扱い)) |

- 原本の種別と`ext`の組み合わせが上表に無い場合(SVG原本に`svg`以外、非SVG原本に`svg`)は404を返す
- `jpg`と`png`は非対応ブラウザ向けのフォールバックであり、どちらを参照するかはフロントエンドがアップロード時に保存した原本のMIMEタイプで決める(原本がJPEGなら`jpg`、それ以外は`png`)。透過を持つロゴがJPEGで塗り潰されるのを防ぐためである
- GIFアニメーションは最初のフレームのみを静止画として出力する
- 全バリアントで`metadata: "none"`を指定しExif等のメタデータを除去する(FR-FILEU-015、DR-006)
- 品質はAVIF・WebP・JPEGとも`quality: 80`とする

## SVGの扱い

SVGはImages Bindingで変換せず、原本をそのまま配信する。バリアント名はURL構造を揃えるために受け付けるが、サイズ変換は行わない。拡張子は`svg`のみを受け付ける。

| ヘッダー                  | 値                                              |
| ------------------------- | ----------------------------------------------- |
| `Content-Type`            | `image/svg+xml`                                 |
| `Content-Security-Policy` | `sandbox; frame-ancestors 'none'`(FR-FILEU-016) |
| `X-Content-Type-Options`  | `nosniff`                                       |

SVGは`<img>`要素からのみ参照し、`<object>`・`<iframe>`・インライン展開はしない。

## キャッシュとパージ

| 項目               | 方針                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cache-Control`    | `public, max-age=1209600, immutable`。退会ユーザーのデータ保持期間(DR-002、14日)に合わせて14日とする                                                                                                                                                              |
| エッジキャッシュ   | Workerが自ら生成するレスポンスは自動ではエッジキャッシュ(NFR-SCALE-002)に載らないため、Cache API(`caches.default`)にリクエストURLをそのままキーとして保存する。ヒット時はR2の読み出しとImages Bindingの変換を省略する。Workerは毎回起動し、Tiered Cacheは効かない |
| `X-Image-Cache`    | Cache APIのヒット可否を`HIT`または`MISS`で返す独自ヘッダー。[パージ効果の検証](#パージ効果の検証)と障害調査に用いる                                                                                                                                               |
| `Cache-Tag`        | 全レスポンスに`Cache-Tag: {objectKey}`を付与する。パージ処理からは使わないが、Purge Files by URLがCache API保存資産に効かないと判明した場合の切替先、及び障害時にダッシュボードから手動でタグパージする手段として確保する                                         |
| 画像の差し替え     | 新しいオブジェクトキーで再アップロードし、参照先を切り替える。同一URLの内容は変えない                                                                                                                                                                             |
| 隔離時のパージ     | 隔離バケットへの移動時に、当該オブジェクトキーの全バリアント×全拡張子のURLをPurge Files by URLで指定して即時無効化する(FR-FILEU-014)                                                                                                                              |
| 物理削除時のパージ | [日次バッチ](../overview/007-daily-timeline.md#日次バッチ421の内容)による退会ユーザーの個人データ・ファイルの物理削除(FR-USER-019)時にも、隔離時と同じ方法で当該オブジェクトキーの全バリアント×全拡張子のURLをPurge Files by URLで無効化する(FR-FILEU-019)        |

Cache APIのキーにリクエストURLを加工せず用いるのは、Workerがカスタムキーを設定した資産をPurge Files by URLで無効化できないためである。またCache APIは`Vary`ヘッダーを考慮しないため、出力フォーマットの分離はURLの拡張子で行う。

`Cache-Tag`レスポンスヘッダーはCloudflareにより訪問者へ返す前に除去される。(参照:[Cloudflare Workersドキュメント](https://developers.cloudflare.com/workers/cache/configuration/#cache-tag))

パージ対象URLは7バリアント×5拡張子の35件で、Purge Files by URLの1リクエスト上限(Freeプランで100件)に収まる。例(オブジェクトキー`f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48`、`square-sm`のみ抜粋):

```
https://genai-example-2-images.lab.kurachiweb.com/square-sm/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.avif
https://genai-example-2-images.lab.kurachiweb.com/square-sm/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.webp
https://genai-example-2-images.lab.kurachiweb.com/square-sm/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.jpg
https://genai-example-2-images.lab.kurachiweb.com/square-sm/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.png
https://genai-example-2-images.lab.kurachiweb.com/square-sm/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.svg
```

スクリーンショットに`square-*`を、ロゴに`screenshot-*`を、非SVG原本に`svg`を要求することは仕様上想定しないが、配信サーバーは対象画像の種別を判定せずにパージ対象を組み立てるため、全バリアント×全拡張子をパージ対象に含める。

### パージ効果の検証

Cloudflareの公式ドキュメントは、Cache APIで保存した資産に対してPurge EverythingとCache-Tagによるパージが効くことを明記する一方、Purge Files by URLについては「カスタムキーを設定した場合は不可」としか記載していない。またPurge APIは対象がキャッシュに存在しなくても成功を返すため、効いていなくても本番では検知できない。そのため、配信サーバーの初回デプロイ時及びキャッシュ処理の変更時に、staging環境で次の手順により効果を確認する。

1. 任意のバリアントURLを2回取得し、2回目のレスポンスヘッダー`X-Image-Cache`が`HIT`であることを確認する
2. 当該URLをPurge Files by URLで無効化する
3. 同じURLを再取得し、`X-Image-Cache`が`MISS`に戻ることを確認する

Cloudflareが付与する`CF-Cache-Status`は、Workerが`fetch`サブリクエストを送らずに生成した応答では`NONE/UNKNOWN`になる(Workerはキャッシュの手前に位置し、Cache APIのヒットはCloudflareから見てキャッシュヒットではない)。そのため判定には配信サーバー独自の`X-Image-Cache`を用いる。

手順3で`HIT`のままの場合はPurge Files by URLが効いていないため、隔離時のパージを`Cache-Tag`によるタグパージ(オブジェクトキーを指定、Freeプランでは5リクエスト/分・1リクエスト100タグまで)へ切り替える。

## フロントエンドでの参照

- 出力フォーマットの選択は`<picture>`要素と`<source type>`でブラウザに委ねる。`avif`・`webp`の順に`<source>`を並べ、`<img src>`にはフォールバックの`jpg`または`png`を指定する。SVG原本は`<picture>`を使わず`<img src="….svg">`のみで参照する
- 各`<source>`・`<img>`の`srcset`にはピクセル密度記述子(`1x`/`2x`)で1x・2xバリアントの両方を指定し、DPR 1端末には1xを、DPR 2以上には2xを配信する。幅は固定のため`sizes`属性・幅記述子(`w`)は使わない

  ```html
  <picture>
    <source
      type="image/avif"
      srcset="
        https://genai-example-2-images.lab.kurachiweb.com/square-sm/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.avif 1x,
        https://genai-example-2-images.lab.kurachiweb.com/square-md/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.avif 2x
      "
    />
    <source
      type="image/webp"
      srcset="
        https://genai-example-2-images.lab.kurachiweb.com/square-sm/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.webp 1x,
        https://genai-example-2-images.lab.kurachiweb.com/square-md/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.webp 2x
      "
    />
    <img
      src="https://genai-example-2-images.lab.kurachiweb.com/square-md/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.jpg"
      srcset="
        https://genai-example-2-images.lab.kurachiweb.com/square-sm/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.jpg 1x,
        https://genai-example-2-images.lab.kurachiweb.com/square-md/f3a9c1e7b2d84a6f9c0e5b3a7d1f2c48.jpg 2x
      "
      width="64"
      height="64"
      alt="プロダクト名のロゴ"
    />
  </picture>
  ```

- `<img>`には表示サイズをCSSで指定し、`width`・`height`属性には1xバリアントの出力サイズ(CSS px相当の値)をそのまま指定してレイアウトシフトを防ぐ
- スクリーンショット系バリアント(`screenshot-thumb`/`screenshot-thumb-2x`、`screenshot-full`)は幅・高さの両方を上限とする縦横比維持のリサイズのため、実際の出力サイズが原本の縦横比によって画像ごとに異なる。画像表示時にはFR-FILEU-020で保存された原本画像の幅・高さも併せて取得し、`width`・`height`属性を設定する
- 画像種別ごとのURL組み立てと`<picture>`の生成はフロントエンド共通ファイル(`apps/frontend-lib/components`)の共通コンポーネントに集約し、各ページで直接URLを組み立てない。コンポーネントはCSS表示サイズ(または`square-sm`のような`2x`側のバリアント名)を引数に受け取り、対応する`1x`バリアント名を内部で解決する
- 未読み込み時・404時はプロダクト名の頭文字またはユーザーのニックネームの頭文字を表示するプレースホルダーに置き換える([デザインガイドライン](../design/001-design-principles.md))

## バリアントの追加・変更

- バリアントや拡張子の追加は本書の一覧へ追記し、配信サーバーの許可リストと隔離時のパージ対象URLの列挙へ同時に反映する
- 既存バリアントのサイズ変更は、長期キャッシュされた旧サイズが残るため原則として行わず、新しい名前のバリアントを追加して参照を切り替える
