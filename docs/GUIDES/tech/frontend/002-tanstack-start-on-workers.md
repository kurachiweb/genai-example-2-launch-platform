# Cloudflare Workers上のTanStack Startの起動

Cloudflare Workersで動かすTanStack Startアプリを、開発時とデプロイ前にどう起動して動作を確かめるか、及び開発サーバーからWranglerのローカル状態へ接続する設定を定める。

## 前提と用語

TanStack Startアプリを`@cloudflare/vite-plugin`でCloudflare Workers向けにビルドし、Wranglerでデプロイする構成を前提とする。

| 用語                     | 意味                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 開発サーバー             | `vite dev`で起動するViteの開発サーバー。`@cloudflare/vite-plugin`により、サーバー側の処理をWorkersの実行環境(workerd)で動かす                                                           |
| ビルド結果               | `vite build`が出力する、デプロイするWorkerと静的アセット                                                                                                                                |
| ローカル状態             | 開発サーバーや`wrangler dev`が読み書きする、D1データベース・R2バケットなどのローカルモードの実データ                                                                                    |
| `<ローカル状態の保存先>` | ローカル状態を置くディレクトリ。「[Wranglerの設定とコマンドの規約](../infra/001-wrangler-conventions.md#前提と用語)」に従い、全アプリで共通の1つの絶対パスを決め、Gitの管理対象外にする |

## 開発時とデプロイ前の起動

TanStack Startアプリは、通常は`bun run dev`で起動する。`package.json`の`dev`スクリプトには`vite dev`を定義する。

```sh
bun run dev
```

デプロイ前は、`vite build && vite preview`でCloudflare Workers向けにビルドし、ビルド結果をWorkersの実行環境で動かして動作を確かめる。

```sh
vite build && vite preview
```

- 開発サーバーは、モジュールを要求のたびに変換して配信する。デプロイするビルド結果そのものを動かしているわけではないため、バンドルに起因する不具合が開発サーバーでは現れないことがある。
- `vite preview`は、`@cloudflare/vite-plugin`により、ビルド結果をWorkersの実行環境で動かす(Cloudflare Docsの「[Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)」)。
- デプロイ先の環境種別のWrangler設定でビルドする場合は、「[デプロイ先の環境種別](../infra/002-environments.md#デプロイ先の環境種別)」に従い、環境変数`CLOUDFLARE_ENV`に環境種別を指定する。
- シークレットを使う場合は、どちらのコマンドも「[シークレットの注入](../security/001-secret-management.md#シークレットの注入)」に従ってシークレットを注入して実行する。

### Wranglerのローカル状態への接続

TanStack Startアプリの開発サーバーからWranglerのローカル状態へ接続するには、`@cloudflare/vite-plugin`を使用し、`vite.config.ts`で`cloudflare({ persistState: { path: '<ローカル状態の保存先>' } })`と記述する。

```typescript
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'ssr' },
      persistState: { path: '<ローカル状態の保存先>' },
    }),
    tanstackStart(),
    viteReact(),
  ],
});
```

- `persistState`を指定しないと、`@cloudflare/vite-plugin`は既定の`.wrangler/state`にローカル状態を置く。`--persist-to`で`<ローカル状態の保存先>`を指定して起動する他のアプリと、ローカル状態を共有できない。
- `<ローカル状態の保存先>`には、Wranglerのコマンドの`--persist-to`と同じ値を指定する。詳しくは「[ローカル状態の永続化と共有](../infra/001-wrangler-conventions.md#ローカル状態の永続化と共有)」に従う。
- `viteEnvironment: { name: 'ssr' }`は、TanStack Startのサーバー側の処理(Viteの`ssr`環境)をWorkerとして動かす指定であり、Cloudflare Docsの「[TanStack Start](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)」の構成に従う。
- 参照: Cloudflare Docsの「[Vite plugin API](https://developers.cloudflare.com/workers/vite-plugin/reference/api/)」・「[Adding local data](https://developers.cloudflare.com/workers/local-development/local-data/)」
