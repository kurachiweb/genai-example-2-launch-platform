# Brief: media-pipeline

## Problem

プロフィール画像・プロダクトのロゴとスクリーンショット・管理者のプロフィール画像・問い合わせの添付ファイルなど、多くの機能がファイルのアップロードを必要とする。そこには次の要件がある。

- 不正なファイルの拒否(マジックバイト・SVG構文・スクリプト)
- 不適切な画像の自動判定と隔離
- 画像専用ドメインからの変換配信と、キャッシュのパージ
- 削除時のライフサイクル管理

これらを機能ごとに実装すると、セキュリティ上の抜けが生じる。

## Current State

- ファイル処理の実装は無い。
- 画像の名前付きバリアント・URL形式・パージ規則が[画像バリアント仕様](../../../docs/GUIDES/service/features/002-image-variants.md)に定義済みである。
- tech-stack.mdで、R2・Queues・Images Binding・Workers Cache、wasm-image-optimization、Amazon Rekognition(aws4fetch、ローカルとCIは決定論的スタブ)、fast-xml-parser、react-easy-cropの採用が決まっている。

## Desired Outcome

- クライアントからのアップロードが一貫した経路で動く。経路は次のとおりである。
  - 入力: クリックとドラッグ&ドロップ、プレビュー、非SVG画像のトリミングダイアログ(UI-006、HW-001)
  - 中継: フロントエンドサーバーがストリーミングで中継する
  - APIでの検証: ヘッダーによる事前検証、サーバー側で採番する推測不能なオブジェクトキー、上書き拒否、マジックバイト検証、SVG構文検証
  - 保存: R2の非公開バケットに保存する
- 書き込み後にQueueへ送られ、eventのconsumerが非同期にモデレーションする。PNG化と640pxへの縮小、Rekognitionによる判定、隔離バケットへの移動、SVGのスクリプト検査を行う(FR-FILEU-011〜014、SW-017、SW-022)。
- 画像専用ドメイン(eventが担当)から配信される。Images Bindingによる変換、名前付きバリアント、メタデータの除去、SVGへの`Content-Security-Policy: sandbox`付与、Workers Cacheとパージを行う(SW-010、SW-012、SW-013)。
- 非公開のファイルを、利用者側・管理者側それぞれのフロントエンドから同一オリジンで配信する汎用の仕組みがある(SW-011)。APIが認可を判定し、R2から読み出す。
- ファイルのライフサイクル(差し替え時の即時削除、論理削除から14日後の物理削除、ファイル名のサニタイズ)と、隔離理由を複数持てるデータモデル(FR-ADMUG-028の前提)がある。
- `apps/frontend-lib`に、アップロード部品とトリミングダイアログがある。
- `docs/GUIDES/tech/external`(Rekognition)、`infra`(画像配信)、`security`(アップロードのセキュリティ)に記載がある。

## Approach

アップロード・検証・保存・非同期判定・配信を、用途(プロフィール画像・ロゴなど)に依存しない汎用パイプラインとして作る。用途ごとの上限サイズや許可形式は、各ドメインspecが設定値として渡す。重い画像処理はeventのQueue consumerに閉じ込め、外部サービスの障害時も読み取り系の機能が止まらないようにする(NFR-AVAIL)。

## Scope

- **In**:
  - 4.25(FR-FILEU-001〜022)全体
  - SW-009〜013、SW-017、SW-022、UI-006、HW-001
  - 隔離理由のデータモデルと、隔離・復元の移動処理(ドメイン層の操作として提供)
  - アップロード部品とトリミングダイアログ
  - 上記のテストとtechドキュメント
- **Out**:
  - 各ドメインのファイル項目(プロフィール画像などは各specがこの基盤を使う)
  - 管理者による手動モデレーション画面(ugc-moderation)
  - エクスポートZIPの生成(data-export)

## Boundary Candidates

- アップロードの受付と検証
- 非同期モデレーション
- 画像の変換配信とキャッシュ
- 非公開ファイルの同一オリジン配信
- ファイルのライフサイクルと隔離状態

## Out of Boundary

- 管理者の判断操作とその監査ログ
- 業務データとファイルの紐付け方

## Upstream / Downstream

- **Upstream**: frontend-platform(BFF中継とUI部品)、backend-platform(Queues・R2バインディング)
- **Downstream**: admin-foundation、user-profile-social、product-launch、inquiry-chat、ugc-moderation、data-export

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: ugc-moderation(隔離・復元の管理操作)

## Constraints

- 外部サービス(Rekognition)の障害時も、読み取り系の機能を継続する縮退運転(NFR-AVAIL)
- 実現性チェック(2026-10-03)の指摘:
  - Images Bindingの`.output()`ではメタデータ除去を指定できず、JPEG出力でXMPやGPS情報が残る報告がある。処理段階でwasm-image-optimizationにより再エンコードしてから保存するか、配信形式を限定する
  - wasm-image-optimizationは本体が約7.4MBあり、Workersのサイズ上限とメモリ上限128MBに近い。画像処理はQueue consumerに隔離し、ヘッダーで画素数を事前検査して超過は拒否する。importは`/workerd`エントリから行う。専用Workerへの分離が必要になった場合はアーキテクチャの変更になるため、開発者に確認する
  - fast-xml-parserには2026年にentity関連の脆弱性が複数ある。5.11.2以上を使い`processEntities: false`を設定し、DOCTYPEとENTITYを含むSVGは拒否し、要素と属性は許可リスト方式で検査する
  - Workers Cacheは画像配信のエントリポイントだけで有効にする
