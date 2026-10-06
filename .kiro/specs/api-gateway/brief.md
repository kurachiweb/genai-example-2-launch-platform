# Brief: api-gateway

## Problem

利用者側・管理者側のフロントエンドは、BFFとして中継するGraphQLでのみAPIサーバーと通信する。ブラウザからAPIサーバーへの直接通信は、公開REST APIだけに限られる(COM-003)。GraphQLにはネスト深さ・コスト・エイリアス数・バッチ数の上限、本番でのintrospection無効化、persisted queriesといった厳しいセキュリティ要件があり、N+1の回避(DataLoader)とコード生成も必須である。共通の通信基盤が無いと、各ドメインspecが一貫しないスキーマや中継方法を実装してしまう。

## Current State

- backend-platformでapiアプリの骨格(Hono+Inversify)ができている前提である。
- tech-stack.mdでGraphQL Yoga、DataLoader、GraphQL Armor、persisted-operations、`@hono/zod-openapi`、GraphQL Code Generator(client-preset)の採用が決まっている。

## Desired Outcome

- apiアプリ上でGraphQL Yogaが動作する。GraphQL Armorによる各種上限、本番でのintrospection無効化、persisted operationsの許可リスト、エラーマスキングが有効になっている(NFR-SECUR-016〜020)。
- ドメインごとのスキーマモジュール(型定義・リゾルバ・DataLoader)の追加規約があり、各ドメインspecはモジュールを1つ追加するだけで済む(NFR-PERF-004)。
- スキーマの出力とpersisted documentsの登録がCIとデプロイの流れに組み込まれている(NFR-MAINT-004)。
- フロントエンドとAPIの間の内部認証(Service Bindings経由の呼び出しだけを信頼する仕組み)、セッション識別子の生成・検証をAPIが担う契約(COM-004)、元のクライアントIPアドレスの引き継ぎ(COM-005)が確立している。
- `@hono/zod-openapi`によるRESTの骨格がある。ベースパス、エラー形式(`ecc:api-design`準拠)、認証不要のOpenAPI仕様配信、公開APIだけに限ったCORS `*`(NFR-SECUR-043)を含む。
- `docs/GUIDES/tech/backend`(API設計)と`coding`(GraphQL通信)に記載がある。

## Approach

GraphQLはapiアプリ内の1エンドポイントとし、セキュリティ上限とpersisted operationsをサーバー側で強制する。スキーマ定義の方式(コードファーストかスキーマファーストか)は設計フェーズで決める。内部認証はService Bindingsの経路だけを信頼し、クライアントIPのヘッダーもその経路以外では無視する。

## Scope

- **In**:
  - GraphQL Yoga・GraphQL Armor・persisted operations・DataLoaderの基盤
  - スキーマモジュールの規約
  - スキーマ出力とpersisted documents登録の仕組み(サーバー側)
  - 内部認証、セッション契約、クライアントIP引き継ぎ(API側)
  - RESTとOpenAPIの骨格、エラー形式、CORS
  - 上記のテストとtechドキュメント
- **Out**:
  - 各ドメインのスキーマとエンドポイント
  - APIキー認証と公開APIの具体的なエンドポイント(public-api)
  - Swagger UIページ(public-api)
  - フロントエンド側のGraphQLクライアント設定(frontend-platform)
  - ログイン処理そのもの(identity-auth)

## Boundary Candidates

- GraphQLサーバー基盤とセキュリティ上限
- スキーマモジュールの合成規約
- フロントエンドとAPIの間の信頼境界(内部認証・クライアントIP・セッション受け渡し)
- RESTとOpenAPIの基盤

## Out of Boundary

- ドメイン固有の型・クエリ・ミューテーション
- 公開APIの認可とレート制限ルール

## Upstream / Downstream

- **Upstream**: backend-platform
- **Downstream**: frontend-platform、public-api、およびGraphQLを使う全ドメインspec

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: frontend-platform(クライアント側codegenとBFF中継)、identity-auth(セッションの発行と失効)

## Constraints

- APIレスポンス形式とバリデーションエラー時のステータスコードは`ecc:api-design`スキルを正とする
- サーバー間通信はService Bindingsが必須(NFR-PERF-005)
- GraphQLのクライアント観測p95は300ms以内(NFR-PERF-002)
- `process.env`ではなく`env`バインディングで設定値を取得する
