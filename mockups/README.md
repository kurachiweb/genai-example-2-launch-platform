# mockups

Launch Stadiumの画面デザイン案。TanStack Start・Tailwind CSS・shadcn/uiを使用し、APIサーバーやDBには接続しない。説明文やコメントのマークダウンはreact-markdown・remark-gfmで描画する。

## 起動方法

```sh
bun install # 初回のみ
bun run dev --port 48047 --host 0.0.0.0
```

## ビルド

```sh
bun run build
bun run preview
```

## ディレクトリ構成

```
src/
├── components/
│   ├── ui/                 # shadcn/uiで生成したコンポーネント
│   └── client/             # 利用者側画面で共有する部品(ヘッダー・フッター・スポンサー広告・状態パネル・ログイン誘導・マークダウン描画・404など)
│       ├── art/            # アップロード画像の代替SVGアート(ロゴ・アバター・スクリーンショット・トロフィー・頭文字プレースホルダー)
│       ├── match/          # マッチカード(トップページとプロダクト詳細の開催中マッチで共有)
│       └── stadium-pitch/  # ピッチSVG(横向きの鳥瞰図・縦向きの真上からの図と、両者で共有する型・観客配置ロジック)
├── lib/
│   ├── mock-data.ts        # プロダクト・ユーザーの仮データ
│   ├── date-format.ts      # ブラウザのロケール・タイムゾーンでの日時整形(SSR時はUTC)
│   ├── relative-time.ts    # 「3時間前」「あと3日」などの相対表現
│   └── preferences.ts      # ダークモードとアニメーション演出のON/OFF(localStorageとOS設定)
└── routes/
    ├── index.tsx           # トップページ(client・adminへの導線)
    ├── client/             # 利用者側画面のモックアップ
    │   ├── top/            # 利用者側トップページ(`-components/`と`-model.ts`はルートにならない補助ファイル)
    │   └── p/$handle/      # プロダクト詳細(`-model/`は状態定義・自動整合・仮データ生成)
    └── admin/              # 管理者側画面のモックアップ
```

TanStack Routerのファイルベースルーティングを採用しており、`src/routes`配下にファイルを追加すると自動的にルートが生成される。`-`で始まるファイル・ディレクトリはルートとして扱われない。

## 表示状態の切り替え

各画面は、画面右下の「表示状態」パネル、またはURLクエリパラメータで表示状態を切り替えられる。既定値と同じ値はURLから省略される。

ダークモードはヘッダーのボタン、アニメーション演出は「表示状態」パネル内のスイッチで切り替える。初期値はそれぞれOSの`prefers-color-scheme`・`prefers-reduced-motion`に従い、選択はlocalStorageに保存される。

### 利用者側トップページ(`/client/top`)

| キー         | 値                                    | 既定値    | 内容                                           |
| ------------ | ------------------------------------- | --------- | ---------------------------------------------- |
| `auth`       | `guest` / `user`                      | `guest`   | ログイン状態                                   |
| `phase`      | `live` / `result`                     | `live`    | マッチ開催中 / 勝敗結果表示(23時過ぎ)          |
| `qualifiers` | `7` / `1` / `0`                       | `7`       | 予選マッチ数                                   |
| `bye`        | `off` / `on`                          | `off`     | 不戦勝プロダクトの有無                         |
| `early`      | `off` / `on`                          | `off`     | 早期勝敗決定プロダクト(不戦勝一覧に表示)の有無 |
| `week`       | `none` / `final` / `sf` / `qf` / `r1` | `none`    | Weekトーナメントの進行状況                     |
| `year`       | `none` / `final` / `sf` / `qf` / `r1` | `final`   | Yearトーナメントの進行状況                     |
| `votes`      | `410-100` / `0-30` / `30-30` / `0-0`  | `410-100` | 開催中各マッチのUpvote数(左-右)                |
| `legend`     | `4` / `1` / `0`                       | `4`       | Legendスポンサー広告の件数                     |
| `gold`       | `7` / `1` / `0`                       | `7`       | Goldスポンサー広告の件数                       |
| `silver`     | `9` / `1` / `0`                       | `9`       | Silverスポンサー広告の件数                     |

### プロダクト詳細(`/client/p/{handle}`)

`{handle}`は`mock-data.ts`のプロダクトのハンドル(例: `pitch-notes`)で、大文字小文字を区別せずに解決する。存在しないハンドルは404を表示する。「表示状態」パネルは閲覧者・プロダクト・投稿者本人・マッチ履歴・コメント・ページ動作の分類ごとに並べる。

| キー         | 値                                                                                                                                               | 既定値         | 内容                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------- |
| `auth`       | `guest` / `user` / `unverified` / `owner`                                                                                                        | `guest`        | ログイン状態(メールアドレス未確認・投稿者本人を含む)                 |
| `visibility` | `listed` / `unlisted` / `unavailable`                                                                                                            | `listed`       | 掲載済み / 未掲載(本人以外は404) / 閲覧不可(本人も404)               |
| `progress`   | `relaunchable` / `scheduled` / `qualifier-live` / `cooldown` / `week-pending` / `week-urgent` / `week-playing` / `year-pending` / `year-playing` | `relaunchable` | 進行状況。本人には操作欄に反映し、マッチ中は全員に開催中マッチを表示 |
| `awards`     | `none` / `week1` / `weekN` / `year`                                                                                                              | `week1`        | 受賞バッジ                                                           |
| `rating`     | `many` / `mine` / `one` / `zero`                                                                                                                 | `many`         | 5段階評価(128件・128件で自分も評価済み・1件・0件)                    |
| `shots`      | `10` / `1` / `0`                                                                                                                                 | `10`           | スクリーンショットの枚数                                             |
| `images`     | `ok` / `broken`                                                                                                                                  | `ok`           | 画像の読み込み状態                                                   |
| `text`       | `normal` / `long`                                                                                                                                | `normal`       | ユーザー入力テキストの長さ                                           |
| `ultras`     | `off` / `on`                                                                                                                                     | `off`          | Ultras加入状態(本人のみ影響)                                         |
| `flag`       | `on` / `off`                                                                                                                                     | `on`           | Ultras導線の機能フラグ                                               |
| `history`    | `none` / `qualifier` / `week` / `all`                                                                                                            | `week`         | マッチ履歴の件数と種別                                               |
| `votes`      | `130-100` / `4-30` / `30-30` / `0-0`                                                                                                             | `130-100`      | 最新マッチ・開催中マッチのUpvote数(自分-相手)                        |
| `bye`        | `off` / `on`                                                                                                                                     | `off`          | 不戦勝の履歴                                                         |
| `early`      | `off` / `on`                                                                                                                                     | `off`          | 早期勝敗決定の履歴                                                   |
| `opponents`  | `public` / `unlisted` / `private` / `mixed`                                                                                                      | `public`       | 対戦相手の公開状態                                                   |
| `comments`   | `many` / `few` / `none`                                                                                                                          | `many`         | 最新ローンチのトップレベルのコメント件数(23件・3件・0件)             |
| `replies`    | `none` / `nested` / `deleted`                                                                                                                    | `nested`       | 返信と削除表示                                                       |
| `page`       | `normal` / `loading` / `error` / `degraded`                                                                                                      | `normal`       | ページの動作状態(縮退運転は決済サービス障害を想定)                   |
| `partial`    | `none` / `comments` / `supporters`                                                                                                               | `none`         | 部分的な読み込みエラー                                               |

実際には起こりえない組み合わせ(例: 未掲載なのにProduct of the Week受賞、予選敗北後の間隔制限中なのに最新マッチが勝利)は自動で整合させる。パネルで操作した項目はそのままにし、矛盾する他の項目を変更コストが最小になるよう切り替え、変更内容をパネル上部に表示する。URLを直接開いた場合も同じ規則で整合させる。

マッチ日・決済期限・コメントの相対時刻は、進行状況ごとに曜日と期限の関係が正しくなる固定の現在時刻(例: 日曜日ローンチの決済期限が迫った状態は月曜日の朝)を基準にし、秒読みだけは実時間の経過に合わせて進める。

## コンポーネントの追加(shadcn/ui)

```sh
bunx shadcn@latest add button
```

生成されたファイルの`cn`のimport元が`cn`パッケージになっている場合は`#/lib/utils`へ修正する。

## Lint・フォーマット

```sh
bun run lint
bun run format
bun run check
```
