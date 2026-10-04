# Brief: content-processing

## Problem

プロフィールの自己紹介・プロダクト説明文・コメント・ヘルプ記事・利用規約などは、マークダウンで入力・表示する。XSSを防ぐサニタイズと、見出しアンカーなどの表示規則を各所で揃える必要がある。またディレクトリとヘルプのキーワード検索には、FTS5の索引と多言語のキーワード抽出による正規化が必要である。これらをドメインごとに実装すると、サニタイズの抜けや索引方式の不統一が起きる。

## Current State

- マークダウンと検索の実装は無い。
- tech-stack.mdで、`@milkdown/crepe`(クライアント側のみ描画)、unified/remark/rehype系(描画・サニタイズ・FTS用テキスト抽出)、Google Cloud Natural Languageの採用が決まっている。
- CLAUDE.mdに、FTS5は`external content`テーブルとトリガーで同期し、カスタムマイグレーションで記述する規則がある。

## Desired Outcome

- `apps/frontend-lib`にマークダウンエディタ部品がある。ツールバーはH1と画像を除外し、プレビュー付きで、クライアント側でのみ描画する(FR-MDOWN-001〜003)。
- サーバー(SSR)とクライアントで共用できる描画パイプラインがある。GFM準拠、Raw HTML無効、見出しのアンカーID生成、リンクのタブ制御、許可リスト方式のサニタイザ(http・https・mailto・`#`のみ)、UGC向けの`rel="ugc"`付与を含む(FR-MDOWN-004〜010)。
- マークダウン入力のサーバー側検証(書記素単位の文字数上限など)の共通部品がある。
- 全文検索の基盤がある。内容は次のとおりである。
  - FTS5の`external content`テーブルとトリガーのテンプレート
  - 検索クエリの正規化(NFKC化と引用符のエスケープ)とBM25検索の補助部品(FR-FTS-001〜002)
  - Queuesによる索引正規化パイプライン(マークダウン除去→NFKC→GCP NLによるキーワード抽出)
  - 元データ削除時の即時削除(FR-FTS-003〜007、SW-023)
- 各ドメインは、検索対象を登録するポートを実装するだけで索引に載せられる。
- `docs/GUIDES/tech/external`(GCP NL)、`db`(FTS5設計)、`frontend`(エディタ)、`security`(サニタイズ)に記載がある。

## Approach

マークダウンの描画・サニタイズ・テキスト抽出を1つのパイプライン定義に集約し、表示とFTS索引の両方がそれを使う。FTSはドメインに依存しない仕組みだけを提供し、どのテーブルを索引するかは各ドメインspecが決める。

## Scope

- **In**:
  - 4.27(FR-MDOWN-001〜010)全体
  - 4.28(FR-FTS-001〜007)の基盤部分、SW-023
  - エディタ部品と表示部品
  - 上記のテストとtechドキュメント
- **Out**:
  - ドメインごとのFTSテーブルと検索画面(プロダクトはdirectory-discovery、ヘルプ記事はhelp-center)
  - 各ドメインの入力上限値の決定

## Boundary Candidates

- マークダウンの入力UI
- マークダウンの描画とサニタイズ
- FTS索引の構造と同期
- 索引テキストの正規化パイプライン
- 検索クエリの正規化

## Out of Boundary

- 何を検索対象にするかという業務判断
- 検索結果の並び順以外の業務ロジック

## Upstream / Downstream

- **Upstream**: frontend-platform、backend-platform(Queues・カスタムマイグレーション規約)
- **Downstream**: legal-pages、help-center、user-profile-social、product-launch、directory-discovery、engagement

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: directory-discovery・help-center(検索対象の登録と検索画面)

## Constraints

- GCP NLの障害時も書き込み系の処理を止めない(縮退運転、NFR-AVAIL)
- FTSテーブルのみ連番のIDを使う(DR-009)
- 仮想テーブルを含むD1はエクスポートできないため、バックアップはTime Travelで行う
- 入力欄の文字数上限は[文言規則](../../../docs/GUIDES/service/design/003-text-and-copy-rules.md)に従い、書記素単位で数える
- 実現性チェック(2026-10-03)の指摘: `@milkdown/crepe`を静的にimportするとSSRバンドルに約2MiBが入る。`useEffect`内での動的importか、`<ClientOnly>`と`React.lazy`で包み、バレルファイル経由の再エクスポートも禁止する
