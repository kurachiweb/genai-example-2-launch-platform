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
src/routes/
├── index.tsx     # トップページ(client・adminへの導線)
├── client/       # 利用者側画面のモックアップ
└── admin/        # 管理者側画面のモックアップ
```

TanStack Routerのファイルベースルーティングを採用しており、`src/routes`配下にファイルを追加すると自動的にルートが生成される。

## コンポーネントの追加(shadcn/ui)

```sh
bunx shadcn@latest add button
```

## Lint・フォーマット

```sh
bun run lint
bun run format
bun run check
```
