# Brief: public-api

## Problem

開発者である利用者は、本サービスの公開データを自分のツールやサイトで使いたい。また自分のプロフィールやプロダクト説明文を、プログラムから更新したい。そのため、APIキーによるBearer認証、スコープ(無効・読み取り・読み書き)、ユーザー単位とIP単位のレート制限を備えた公開REST APIと、その仕様書(OpenAPI)が必要である。

## Current State

- 公開APIの実装は無い。
- api-gatewayでRESTとOpenAPIの骨格(エラー形式・認証不要の仕様配信・CORS)ができている前提である。
- Swagger UIのページは利用者側の`/api-docs`に置く方針が決まっている。

## Desired Outcome

- APIキー管理(FR-PAPI-001・005〜007)が動作する。
  - 名前とスコープを指定して発行し、キーはハッシュで保存する
  - 権限を引き継いだ再発行と削除ができる
  - 設定ページに管理画面がある
- 公開API(FR-PAPI-002〜004・008〜009)が動作する。
  - Bearer認証
  - 公開データ(プロフィール・プロダクト・ローンチとマッチ・Upvote・コメント・評価など)の読み取り
  - 自分のプロフィールとプロダクト説明文の更新
  - 停止・退会のデータを除外する
- レート制限が動作する(FR-RLMIT-004・006・007・014・016)。
  - キー発行はユーザー単位で1時間に3回まで
  - 認証が必要なエンドポイントは、ユーザー単位で読み取り1分30回・書き込み1分15回(Durable Objects)
  - 全エンドポイントで、IP単位に1分60回(Rate Limiting binding)
- OpenAPI仕様が認証不要で配信され、`/api-docs`のSwagger UIから参照できる。
- CORSは公開APIに限り`*`である(NFR-SECUR-043)。

## Approach

公開APIは、各ドメインのアプリケーション層のユースケースを再利用し、プレゼンテーション層としてRESTエンドポイントを追加する。GraphQLとは別の入口だが、可視性の判定と業務ルールは共通の部品を使う。

## Scope

- **In**:
  - 4.19(FR-PAPI-001〜009)
  - FR-RLMIT-004・006・007・014・016、NFR-SECUR-043
  - APIキー管理画面、`/api-docs`のSwagger UI
  - 上記のテスト
  - `docs/GUIDES/tech/backend`への公開API設計の追記
- **Out**:
  - RESTの骨格とエラー形式(api-gateway)
  - 各ドメインの業務ロジック

## Boundary Candidates

- APIキーのライフサイクルとスコープ
- 公開エンドポイントの定義
- 公開APIのレート制限
- 仕様書の配信とSwagger UI

## Out of Boundary

- GraphQLの内部API
- ドメインの業務ルール

## Upstream / Downstream

- **Upstream**: engagement、match-engine、product-launch、user-profile-social、api-gateway
- **Downstream**: data-export(APIキー情報の扱い)、launch-readiness

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: api-gateway(RESTの骨格)

## Constraints

- APIの設計は`ecc:api-design`スキルのベストプラクティスに従う
- 公開APIのドメインだけが外部に公開され、他のAPIはService Bindings経由でのみ呼ばれる
