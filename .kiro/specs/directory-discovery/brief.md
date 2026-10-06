# Brief: directory-discovery

## Problem

探索者は、予選を勝ち抜いたプロダクトだけが載るディレクトリから、カテゴリ・期間・キーワードで良いプロダクトを見つけたい。勝者だけが掲載されること自体が、本サービスの品質保証である。プロダクト詳細ページは、説明・評価・ローンチごとのコメント・マッチごとの票数・Upvoterを集約する、最も情報量の多いページである。

## Current State

- ディレクトリの実装は無い。
- ディレクトリとプロダクト詳細ページのモックアップが`mockups/src/routes/client/p`と`mockups/src/routes/client/p/$handle`にある(決済パネル・コメントを含む)。
- content-processingでFTS基盤が、match-engineで勝敗の確定ができている前提である。

## Desired Outcome

- ディレクトリ機能(FR-DIR-001〜011)が動作する。
  - 勝者の一覧(20件ずつ、オフセット方式、URLクエリでページ指定)
  - カテゴリと期間での絞り込み、BM25による検索、ソート
  - 退会・停止・非公開のプロダクトを除外する
- プロダクト詳細ページ`/p/{handle}`がモックアップに沿って実装されている。
  - 説明文、マッチごとの票数、Upvoterの無限スクロールを表示する
  - 評価・コメント・広告・トーナメント参加などの区画を後続specが追加できる構成である
- プロダクトの検索索引がある。プロダクトの追加・編集・削除、勝利によるディレクトリ掲載、管理者による非公開化と復元のたびに、名称・タグライン・説明文から索引を更新する(FR-ADMUG-009)。
- 旧ハンドルからの302リダイレクトが動作する。

## Approach

ディレクトリの掲載条件(勝利済み・可視)をこのspecが所有し、検索索引もそれに合わせて管理する。索引の更新は、プロダクトとマッチのイベントへのハンドラとして実装する。後続のugc-moderationは、非公開化イベントを発火するだけで索引に反映される。

## Scope

- **In**:
  - 4.9(FR-DIR-001〜011)、FR-ADMUG-009
  - ディレクトリ一覧と検索、プロダクト詳細ページ
  - プロダクトのFTSテーブルと索引更新
  - 上記のテスト
- **Out**:
  - コメントと評価の区画(engagement)
  - 広告の区画(sponsorship)
  - トーナメントの区画(tournament-week・tournament-year)
  - FTSの基盤そのもの(content-processing)

## Boundary Candidates

- ディレクトリの掲載条件と一覧
- プロダクト検索
- プロダクト詳細ページの構成と区画
- 検索索引の同期

## Out of Boundary

- 区画の中身(コメント・評価・広告)
- マッチの進行

## Upstream / Downstream

- **Upstream**: match-engine、content-processing
- **Downstream**: engagement、sponsorship、public-api

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: engagement・sponsorship(詳細ページへの区画追加)

## Constraints

- 要件の論点(要件フェーズで開発者に確認する):
  - 複数回の予選で勝利したプロダクトを1項目として扱うか、勝利ごとに扱うか
  - ソートの「Upvote数」と期間絞り込みが、どのローンチを基準にするか
- FCP最優先(NFR-PERF-001)のため、一覧と詳細ページはSSRで初期表示する
- モックアップのURLは`/client/`接頭辞付きで、本番のURLは`/p`・`/p/{handle}`である
