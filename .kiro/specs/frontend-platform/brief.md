# Brief: frontend-platform

## Problem

利用者側(`apps/client`)と管理者側(`apps/admin`)のフロントエンドサーバーが存在しない。全ドメインの画面は、次の共通基盤を必要とする。

- SSRとFCP最優先の設計(NFR-PERF-001)
- Service Bindings経由でAPIへ中継するBFF
- CSRF対策、nonce付きCSP、各種セキュリティヘッダー
- GraphQLのコード生成クライアントとTanStack QueryのSSR統合
- shadcn/uiベースのデザインシステム、共通レイアウト
- ローディング・空・エラー状態の表示
- アクセシビリティ(WCAG 2.2 AA)
- ロケールに応じた日時表示

これらが無いまま各specが画面を作ると、セキュリティ対策と見た目がばらつく。

## Current State

- `apps/client`・`apps/admin`・`apps/frontend-lib`は空ディレクトリで、compose.yamlで`frontend-lib`が`client/lib`・`admin/lib`へbind mountされる。
- `mockups`アプリに利用者側4画面(トップ・ディレクトリ・プロダクト詳細・公開プロフィール)と共通部品(ヘッダー・フッター・スポンサー広告・マッチカード・ログインダイアログ・通報ダイアログ・404・エラー表示など)がある。デザイントークンは`mockups/src/styles.css`にある。
- 管理者側のモックアップは無い。

## Desired Outcome

- `apps/client`・`apps/admin`がTanStack Startと`@cloudflare/vite-plugin`で動作し、`bun run dev`と`vite build && vite preview`の両方で起動できる。
- BFF中継により、ページからAPIのGraphQLへService Bindings経由で到達できる。内部認証・Cookieの中継・クライアントIPの付与を含む(COM-003〜005)。
- CSRF対策(Sec-Fetch-Siteの検証、server functionsのCSRFミドルウェア)、nonce付きCSP、認証が必要なページの`no-store`などのセキュリティヘッダーが有効である(NFR-SECUR-009〜011ほか)。
- GraphQL Code Generator(client-preset)とpersisted documents、TanStack Queryと`@tanstack/react-router-ssr-query`、Jotaiの利用規約が確立している。
- Tailwind CSSとshadcn/uiによるデザインシステムがある。モックアップのデザイントークン(深緑・ゴールド・琥珀・シルバー・Legend・ダークモード)を移植済みである。
- `apps/frontend-lib`に共通部品があり、Storybookでプレビューできる。対象はフォーム部品(React Hook FormとZod、フォーカスが外れた時の検証表示、UI-004)、状態表示(UI-005)、404・エラーページ、`<time>`による日時表示、Turnstileウィジェット、トーストなどである。
- 利用者側の共通レイアウト(ヘッダー・フッター)と、管理者側の基本レイアウトがある。
- 「ページ→BFF→API GraphQL→D1」の疎通を確認する画面とPlaywrightのスモークE2Eがある。
- Web AnalyticsとSentry(フロントエンド)が組み込まれている。
- `docs/GUIDES/tech/frontend`(アクセシビリティ規則・共通化するコンポーネント)と`coding`(GraphQLクライアント)に記載があり、`docs/GUIDES/service/features`に国際化方針(UTC-08:00の業務時刻、ブラウザロケールでの表示、ブラウザ翻訳への耐性)を作成済みである。

## Approach

client・adminは同じ骨格と同じBFF中継の仕組みを使い、相違は認証の種類と画面シェルだけにする。共通部品は`apps/frontend-lib`に置き、Storybookとブラウザテストで検証する。モックアップ由来の部品は、本番のURL体系と`docs/GUIDES/service/design`に合わせて移植する。

## Scope

- **In**:
  - client・adminの骨格、Wrangler設定、BFF中継、CSRF、CSP、セキュリティヘッダー
  - GraphQLクライアント、TanStack Query、Jotaiの規約
  - デザインシステム、共通部品、Storybook
  - 利用者側の共通レイアウト、管理者側の基本レイアウト、エラーと404の画面
  - 疎通確認の画面とスモークE2E
  - Web Analytics、フロントエンドのSentry
  - 上記のテストとtechドキュメント、国際化方針の文書
- **Out**:
  - 各ドメインの画面
  - ログイン・登録の画面とセッション処理(identity-auth)
  - 管理画面のメニューとRBAC(admin-foundation)
  - マークダウンエディタ(content-processing)
  - 画像のトリミングダイアログとアップロード部品(media-pipeline)

## Boundary Candidates

- フロントエンドサーバーの骨格とBFF中継
- ブラウザ向けのセキュリティ対策
- データ取得の規約(codegen・Query・SSR)
- デザインシステムと共通部品
- 画面シェル(利用者側・管理者側の基本形)

## Out of Boundary

- 業務画面と業務データ
- 認証状態に応じた画面の出し分け(identity-auth・admin-foundationが追加する)

## Upstream / Downstream

- **Upstream**: api-gateway
- **Downstream**: 画面を持つ全spec

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: api-gateway(サーバー側のpersisted operationsと内部認証)、identity-auth(設定ページシェル)、admin-foundation(管理画面シェル)

## Constraints

- CLAUDE.mdの規則: `vite.config.ts`で`cloudflare({ persistState: { path: "/workspace/.wrangler/state" } })`を指定する、1ファイルにつきReactコンポーネントのエクスポートは1つ、`motion/react`を使う、日時は`<time datetime>`で表示する
- フロントエンドのTanStack関連の作業では[TanStack Agent Guidelines](../../../docs/ai-extensions/tanstack-agent-guidelines.md)を参照する(スキルは`.claude/skills/tanstack-agent-skills/skills`にある)
- コンポーネントテストはVitest Browser Modeと`vitest-browser-react`を使う
- 実現性チェック(2026-10-03)の指摘:
  - Sentryの導入で`src/start.ts`を定義すると、server functions向けのCSRFミドルウェアが自動導入されなくなる。`createCsrfMiddleware()`を明示的に追加し、SSR中の例外は`captureException`で手動送信する
  - `vite preview`とデプロイはビルド時に出力された`wrangler.json`を使うため、`CLOUDFLARE_ENV`はビルド時に指定する。preview時に別プロセスのAPI WorkerへService Bindingで接続できるかは要検証
- 管理者側のUIデザインは、モックアップが無いためこのspecと後続specの中でshadcn/uiと`docs/GUIDES/service/design`に従って行う
