# 画像配信の名前付きバリアント一覧

ユーザーがアップロードした画像(プロフィール画像・管理者プロフィール画像・プロダクトロゴ・スクリーンショット)を、イベントサーバーの画像配信専用ドメイン(SW-012)からWorkers Images Binding(SW-013)で変換して配信する際の、名前付きバリアントを定義する。
問い合わせの添付ファイルは画像形式であってもこの経路では配信せず、ファイル用非公開バケットから認可付きで配信する(FR-INQRY-016)。

## 配信URL

```
https://{画像配信ドメイン}/{variant}/{objectKey}.{ext}
```

| 要素             | 内容                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| 画像配信ドメイン | staging: `genai-example-2-images-staging.lab.kurachiweb.com`、prod: `genai-example-2-images.lab.kurachiweb.com` |
| `variant`        | 本書で定義するバリアント名。未定義の名前は404                                                                   |
| `objectKey`      | アップロード時にサーバーが採番した推測不能な識別子(FR-FILEU-006)。画像用非公開バケットのキー                    |
| `ext`            | [出力フォーマット](#出力フォーマット)で定義する拡張子。未定義の拡張子は404                                      |

例: `https://genai-example-2-images.lab.kurachiweb.com/square-md/01J9B2Y4D6F8H0K2M4P6R8T0V2.avif`

出力フォーマットを`Accept`ヘッダーではなくURLで指定するのは、Cloudflareのエッジキャッシュがヘッダーによる分離(`Vary`)を本サービスの条件では行えないためである。Vary for ImagesはゾーンFreeプランでは利用できず、Workerが自ら生成するレスポンスをキャッシュするCache APIは`Vary`を考慮しない。URLに形式を含めることでパスのみでキャッシュキーが定まり、Purge Files by URL(SW-010)の対象もパスの列挙で確定する。元画像そのもの(バリアント指定なし)は配信しない。

## バリアント一覧

バリアントのサイズはDPR 2の表示を前提とし、CSS上の表示サイズの2倍で定義する。

| バリアント名       | 出力サイズ                 | fit          | 用途                                                                                                   | 対象画像               |
| ------------------ | -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| `square-sm`        | 96×96px                    | `cover`      | コメント一覧・Upvoteユーザー一覧・フォロー一覧のアバター、問い合わせチャットの管理者アバター(CSS 48px) | プロフィール画像、ロゴ |
| `square-md`        | 192×192px                  | `cover`      | 予選・トーナメントのマッチカード、ディレクトリ一覧、スポンサー広告のロゴ(CSS 96px)                     | プロフィール画像、ロゴ |
| `square-lg`        | 384×384px                  | `cover`      | プロダクト詳細ページのロゴ、公開プロフィールページのアバター(CSS 192px)                                | プロフィール画像、ロゴ |
| `screenshot-thumb` | 幅640px(高さは縦横比維持)  | `scale-down` | プロダクト詳細ページのスクリーンショット一覧サムネイル(CSS 320px幅)                                    | スクリーンショット     |
| `screenshot-full`  | 幅1920px(高さは縦横比維持) | `scale-down` | スクリーンショット拡大表示(ライトボックス)                                                             | スクリーンショット     |
| `review`           | 長辺1280px(縦横比維持)     | `scale-down` | 管理者側の手動モデレーション画面・プロダクト管理画面での確認表示                                       | 全画像                 |

- `cover`は縦横比を維持して指定サイズを覆うように拡縮し、はみ出た部分を中央基準で切り取る。アップロード時のトリミング(FR-FILEU-003)で正方形に整えている前提だが、公開API等で非正方形が混入しても崩れないようにする
- `scale-down`は指定サイズより小さい画像を拡大しない
- ロゴとプロフィール画像は同じ正方形バリアントを共有する。用途別に名前を分けないのは、バリアント数を抑えてキャッシュ効率とパージ対象を単純にするためである
- 隔離バケットへ移動された画像(FR-FILEU-011・012)はどのバリアントでも404を返す。`review`バリアントも例外ではなく、管理者の手動モデレーション画面は隔離バケットの原本を管理者側フロントエンドの同一オリジンからAPIサーバー経由で表示する(FR-ADMUG-021)

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
- `jpg`と`png`は非対応ブラウザ向けのフォールバックであり、どちらを参照するかはフロントエンドがアップロード時に保存した原本のMIMEタイプで決める(原本がPNG・GIFなら`png`、それ以外は`jpg`)。透過を持つロゴがJPEGで塗り潰されるのを防ぐためである
- GIFアニメーションは最初のフレームのみを静止画として出力する
- 全バリアントで`metadata: "none"`を指定しExif等のメタデータを除去する(FR-FILEU-015、DR-006)
- 品質はAVIF・WebP・JPEGとも`quality: 80`を基準とし、`review`のみ`quality: 90`とする

## SVGの扱い

SVGはImages Bindingで変換せず、原本をそのまま配信する。バリアント名はURL構造を揃えるために受け付けるが、サイズ変換は行わない。拡張子は`svg`のみを受け付ける。

| ヘッダー                  | 値                                              |
| ------------------------- | ----------------------------------------------- |
| `Content-Type`            | `image/svg+xml`                                 |
| `Content-Security-Policy` | `sandbox; frame-ancestors 'none'`(FR-FILEU-016) |
| `X-Content-Type-Options`  | `nosniff`                                       |

SVGは`<img>`要素からのみ参照し、`<object>`・`<iframe>`・インライン展開はしない。

## キャッシュとパージ

| 項目               | 方針                                                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cache-Control`    | `public, max-age=1209600, immutable`。退会ユーザーのデータ保持期間(DR-002、14日)に合わせて14日とする                                                                                                                                                                          |
| エッジキャッシュ   | Workerが自ら生成するレスポンスは自動ではエッジキャッシュ(NFR-SCALE-002)に載らないため、Cache API(`caches.default`)にリクエストURLをそのままキーとして保存する。ヒット時はR2の読み出しとImages Bindingの変換を省略する。Workerは毎回起動し、Tiered Cacheは効かない             |
| `X-Image-Cache`    | Cache APIのヒット可否を`HIT`または`MISS`で返す独自ヘッダー。[パージ効果の検証](#パージ効果の検証)と障害調査に用いる                                                                                                                                                           |
| `Cache-Tag`        | 全レスポンスに`Cache-Tag: {objectKey}`を付与する。パージ処理からは使わないが、Purge Files by URLがCache API保存資産に効かないと判明した場合の切替先、及び障害時にダッシュボードから手動でタグパージする手段として確保する。このヘッダーはCloudflareが訪問者へ返す前に除去する |
| 画像の差し替え     | 新しいオブジェクトキーで再アップロードし、参照先を切り替える。同一URLの内容は変えない                                                                                                                                                                                         |
| 隔離時のパージ     | 隔離バケットへの移動時に、当該オブジェクトキーの全バリアント×全拡張子のURLをPurge Files by URLで指定して即時無効化する(FR-FILEU-014)                                                                                                                                          |
| 物理削除時のパージ | [日次バッチ](../overview/007-daily-timeline.md#日次バッチ421の内容)による退会ユーザーの個人データ・ファイルの物理削除(FR-USER-018)時にも、隔離時と同じ方法で当該オブジェクトキーの全バリアント×全拡張子のURLをPurge Files by URLで無効化する(FR-FILEU-019)                    |

Cache APIのキーにリクエストURLを加工せず用いるのは、Workerがカスタムキーを設定した資産をPurge Files by URLで無効化できないためである。またCache APIは`Vary`ヘッダーを考慮しないため、出力フォーマットの分離はURLの拡張子で行う。

パージ対象URLは6バリアント×5拡張子の30件で、Purge Files by URLの1リクエスト上限(Freeプランで100件)に収まる。例(オブジェクトキー`01J9B2Y4D6F8H0K2M4P6R8T0V2`、`square-sm`のみ抜粋):

```
https://genai-example-2-images.lab.kurachiweb.com/square-sm/01J9B2Y4D6F8H0K2M4P6R8T0V2.avif
https://genai-example-2-images.lab.kurachiweb.com/square-sm/01J9B2Y4D6F8H0K2M4P6R8T0V2.webp
https://genai-example-2-images.lab.kurachiweb.com/square-sm/01J9B2Y4D6F8H0K2M4P6R8T0V2.jpg
https://genai-example-2-images.lab.kurachiweb.com/square-sm/01J9B2Y4D6F8H0K2M4P6R8T0V2.png
https://genai-example-2-images.lab.kurachiweb.com/square-sm/01J9B2Y4D6F8H0K2M4P6R8T0V2.svg
```

スクリーンショットに`square-*`を、ロゴに`screenshot-*`を、非SVG原本に`svg`を要求することは仕様上想定しないが、配信サーバーは対象画像の種別を判定せずにパージ対象を組み立てるため、全バリアント×全拡張子をパージ対象に含める。

### パージ効果の検証

Cloudflareの公式ドキュメントは、Cache APIで保存した資産に対してPurge EverythingとCache-Tagによるパージが効くことを明記する一方、Purge Files by URLについては「カスタムキーを設定した場合は不可」としか記載していない。またPurge APIは対象がキャッシュに存在しなくても成功を返すため、効いていなくても本番では検知できない。そのため、配信サーバーの初回デプロイ時及びキャッシュ処理の変更時に、staging環境で次の手順により効果を確認する。

1. 任意のバリアントURLを2回取得し、2回目のレスポンスヘッダー`X-Image-Cache`が`HIT`であることを確認する
2. 当該URLをPurge Files by URLで無効化する
3. 同じURLを再取得し、`X-Image-Cache`が`MISS`に戻ることを確認する

Cloudflareが付与する`CF-Cache-Status`は、Workerが`fetch`サブリクエストを送らずに生成した応答では`NONE/UNKNOWN`になる(Workerはキャッシュの手前に位置し、Cache APIのヒットはCloudflareから見てキャッシュヒットではない)。そのため判定には配信サーバー独自の`X-Image-Cache`を用いる。

手順3で`HIT`のままの場合はPurge Files by URLが効いていないため、隔離時のパージを`Cache-Tag`によるタグパージ(オブジェクトキーを指定、Freeプランでは5リクエスト/分・1リクエスト100タグまで)へ切り替える。

## 画像種別ごとの利用バリアント

| 画像種別               | アップロード上限         | 利用するバリアント                                                |
| ---------------------- | ------------------------ | ----------------------------------------------------------------- |
| プロフィール画像       | 500KB                    | `square-sm`、`square-md`、`square-lg`、`review`                   |
| 管理者プロフィール画像 | 500KB                    | `square-sm`(問い合わせチャット・ヘルプ記事の作成者表示)、`review` |
| プロダクトロゴ         | 500KB                    | `square-sm`、`square-md`、`square-lg`、`review`                   |
| スクリーンショット     | 1枚5MB、プロダクト計10MB | `screenshot-thumb`、`screenshot-full`、`review`                   |

## フロントエンドでの参照

- 出力フォーマットの選択は`<picture>`要素と`<source type>`でブラウザに委ねる。`avif`・`webp`の順に`<source>`を並べ、`<img src>`にはフォールバックの`jpg`または`png`を指定する。SVG原本は`<picture>`を使わず`<img src="….svg">`のみで参照する

  ```html
  <picture>
    <source
      type="image/avif"
      srcset="
        https://genai-example-2-images.lab.kurachiweb.com/square-md/01J9B2Y4D6F8H0K2M4P6R8T0V2.avif
      "
    />
    <source
      type="image/webp"
      srcset="
        https://genai-example-2-images.lab.kurachiweb.com/square-md/01J9B2Y4D6F8H0K2M4P6R8T0V2.webp
      "
    />
    <img
      src="https://genai-example-2-images.lab.kurachiweb.com/square-md/01J9B2Y4D6F8H0K2M4P6R8T0V2.jpg"
      width="96"
      height="96"
      alt="プロダクト名のロゴ"
    />
  </picture>
  ```

- `<img>`には表示サイズをCSSで指定し、`width`・`height`属性にはバリアントの出力サイズの半分(CSS px)を指定してレイアウトシフトを防ぐ
- 解像度切り替え(`srcset`の複数候補と`sizes`)は使わず、2xサイズ固定で十分とする。`<source>`の`srcset`には候補を1つだけ指定する
- 画像種別ごとのURL組み立てと`<picture>`の生成はフロントエンド共通ファイル(`apps/frontend-lib/components`)の共通コンポーネントに集約し、各ページで直接URLを組み立てない
- 未読み込み時・404時はプロダクト名の頭文字またはユーザーのニックネームの頭文字を表示するプレースホルダーに置き換える([デザインガイドライン](../design/001-design-principles.md))

## バリアントの追加・変更

- バリアントや拡張子の追加は本書の一覧へ追記し、配信サーバーの許可リストと隔離時のパージ対象URLの列挙へ同時に反映する
- 既存バリアントのサイズ変更は、長期キャッシュされた旧サイズが残るため原則として行わず、新しい名前のバリアントを追加して参照を切り替える
