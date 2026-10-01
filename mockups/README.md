# mockups

Launch Stadiumの画面デザイン案。TanStack Start・Tailwind CSS・shadcn/uiを使用し、APIサーバーやDBには接続しない。

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
│   └── client/             # 利用者側画面で共有する部品(ヘッダー・フッター・スポンサー広告・画像代替のSVGアート)
│       └── stadium-pitch/  # ピッチSVG(横向きの鳥瞰図・縦向きの真上からの図と、両者で共有する型・観客配置ロジック)
├── lib/
│   ├── mock-data.ts        # プロダクト・ユーザーの仮データ
│   └── preferences.ts      # ダークモードとアニメーション演出のON/OFF(localStorageとOS設定)
└── routes/
    ├── index.tsx           # トップページ(client・adminへの導線)
    ├── client/             # 利用者側画面のモックアップ
    │   └── top/            # 利用者側トップページ(`-components/`と`-model.ts`はルートにならない補助ファイル)
    └── admin/              # 管理者側画面のモックアップ
```

TanStack Routerのファイルベースルーティングを採用しており、`src/routes`配下にファイルを追加すると自動的にルートが生成される。`-`で始まるファイル・ディレクトリはルートとして扱われない。

## 表示状態の切り替え

各画面は、画面右下の「表示状態」パネル、またはURLクエリパラメータで表示状態を切り替えられる。既定値と同じ値はURLから省略される。

利用者側トップページ(`/client/top`)のクエリパラメータ:

| キー         | 値                                    | 既定値    | 内容                                           |
| ------------ | ------------------------------------- | --------- | ---------------------------------------------- |
| `auth`       | `guest` / `user`                      | `guest`   | ログイン状態                                   |
| `phase`      | `live` / `result`                     | `live`    | マッチ開催中 / 勝敗結果表示(23時過ぎ)          |
| `qualifiers` | `7` / `1` / `0`                       | `7`       | 予選マッチ数                                   |
| `bye`        | `off` / `on`                          | `off`     | 不戦勝プロダクトの有無                         |
| `early`      | `off` / `on`                          | `off`     | 早期勝敗決定プロダクト(不戦勝一覧に表示)の有無 |
| `week`       | `none` / `final` / `sf` / `qf` / `r1` | `final`   | Weekトーナメントの進行状況                     |
| `year`       | `none` / `final` / `sf` / `qf` / `r1` | `none`    | Yearトーナメントの進行状況                     |
| `votes`      | `410-100` / `0-30` / `30-30` / `0-0`  | `410-100` | 開催中各マッチのUpvote数(左-右)                |
| `legend`     | `4` / `1` / `0`                       | `4`       | Legendスポンサー広告の件数                     |
| `gold`       | `7` / `1` / `0`                       | `7`       | Goldスポンサー広告の件数                       |
| `silver`     | `9` / `1` / `0`                       | `9`       | Silverスポンサー広告の件数                     |

ダークモードはヘッダーのボタン、アニメーション演出は「表示状態」パネル内のスイッチで切り替える。初期値はそれぞれOSの`prefers-color-scheme`・`prefers-reduced-motion`に従い、選択はlocalStorageに保存される。

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
