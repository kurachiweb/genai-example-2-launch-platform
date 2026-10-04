# Brief: legal-pages

## Problem

利用者が登録時に同意する利用規約と、プライバシーポリシー、法的通知(特定商取引法に基づく表記・返金ポリシーなど)を、全ページから参照できる形で公開する必要がある(LR-001、LR-008)。本文は最上位管理者が改訂し、改訂のたびに変更概要を履歴として利用者に示さなければならない(FR-ADMAG-006〜008)。

## Current State

- 法務文書の公開ページと編集機能は無い。
- 準拠方針・保存先・保持期間、利用規約・プライバシーポリシー・法的通知の大枠が[legalディレクトリ](../../../docs/GUIDES/service/legal)に定義済みである。
- content-processingでマークダウンの入力と描画の部品が、admin-foundationで管理画面のシェルと権限制御ができている前提である。

## Desired Outcome

- 最上位管理者が、利用規約・プライバシーポリシー・法的通知の3文書をマークダウンで編集できる。編集時は200文字以内の変更概要の入力が必須で、保存日時と併せて改訂履歴として記録される(FR-ADMAG-006〜007)。
- 利用者側に`/terms`・`/privacy`・`/legal`の公開ページがあり、各ページ末尾に改訂履歴が新しい順に表示される(FR-ADMAG-008)。
- 利用者側の全ページから利用規約へのリンクがある(LR-001)。管理者側のリンクの扱いも、要件フェーズで確認したうえで決める。
- 文書の編集操作は、監査ログの対象範囲(FR-ADMAG-001)に従って記録される。
- 初期データとして3文書の枠が用意され、本番公開前に開発者が本文を投入できる。

## Approach

3文書を同じデータモデル(文書種別・本文・改訂履歴)で扱い、公開ページも共通の表示部品で描画する。フッターのリンクはfrontend-platformの共通レイアウトに追加する。

## Scope

- **In**:
  - FR-ADMAG-006〜008、LR-001、LR-008の表示面
  - 管理画面の編集UI、公開ページ、フッターのリンク
  - 上記のテスト
- **Out**:
  - 法務文書の本文起草(開発者が用意する)
  - 決済画面に置く特定商取引法の表記へのリンク(payments)
  - ヘルプ記事(help-center)

## Boundary Candidates

- 法務文書のデータモデルと改訂履歴
- 編集UI
- 公開ページとフッターのリンク

## Out of Boundary

- 規約への同意の記録(identity-auth)
- 法務文書以外の固定ページ

## Upstream / Downstream

- **Upstream**: admin-foundation、content-processing
- **Downstream**: payments(法的通知へのリンク)、identity-auth(登録時の規約リンクと同意記録との継ぎ目)

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: identity-auth(規約同意)、help-center(同じくマークダウンによる管理者生成コンテンツ)

## Constraints

- 規約へのリンクは、identity-authの登録画面が先に参照する。公開ページのURLを要件フェーズで確定し、両specで合わせる
- 法的要件(LR-001・LR-007〜009)の詳細は[legalディレクトリ](../../../docs/GUIDES/service/legal)の準拠方針に従う
