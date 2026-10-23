# Brief: help-center

## Problem

利用者は、トーナメントのルールや決済、再ローンチの条件など、独自性の高い仕組みを自分で調べて理解する必要がある。運営側(モデレーター以上の管理者)はヘルプ記事を下書きから公開まで管理し、カテゴリ分けとピン留めで重要な記事を目立たせたい。

## Current State

- ヘルプ機能の実装とモックアップは無い。
- `/help`と`/help/{handle}`の画面配置が[ページ配置](../../../docs/GUIDES/service/design/002-page-layouts.md)に定義済みである。
- content-processingでマークダウンとFTSの基盤が、admin-foundationで管理画面の土台ができている前提である。

## Desired Outcome

- 利用者側のヘルプ機能(FR-HELP-001〜011)が動作する。
  - カテゴリ別の全件一覧(ピン留め記事を先頭に表示)、キーワード検索
  - 下書きの非公開、フッターへのピン留め記事の表示
  - ハンドルによるURL、旧ハンドルからの302リダイレクト
  - 詳細ページの目次と同カテゴリの記事一覧
- 管理者側のヘルプ記事管理が動作する(FR-ADMAG-005・009〜018・021〜023)。
  - モデレーター以上による作成・編集・削除
  - タイトルとサブタイトル(各100文字以内)、カテゴリ、ピン留め、下書きと公開の状態
  - ハンドルの規則・一意性・予約語
  - 全件一覧と絞り込み(下書きを含み、ページネーションなし)
  - FTS索引の更新、削除時の旧ハンドルの物理削除
- ヘルプカテゴリのマスタ管理が動作する(FR-ADMCF-009〜011)。標準カテゴリ「その他」は削除できず、削除時に紐付く記事を「その他」へ付け替える。
- 監査ログの対象操作(FR-ADMAG-001に列挙されたもの)が記録される。

## Approach

ハンドルの規則(大文字小文字を区別しない一意性・旧ハンドル保持・予約語)は、user-profile-socialが所有するハンドル基盤を再利用する。検索はcontent-processingのFTS基盤に、ヘルプ記事のテーブルを登録して実現する。

## Scope

- **In**:
  - 4.16(FR-HELP-001〜011)
  - FR-ADMAG-005・009〜018・021〜023
  - FR-ADMCF-009〜011
  - 利用者側・管理者側の画面、ヘルプ記事のFTS索引
  - 上記のテスト
- **Out**:
  - 法務文書(legal-pages)
  - 問い合わせ(inquiry-chat)
  - ヘルプ記事の本文作成(運用で投入する)

## Boundary Candidates

- ヘルプ記事の公開面(一覧・検索・詳細)
- ヘルプ記事の管理面
- ヘルプカテゴリのマスタ

## Out of Boundary

- 他ドメインの検索索引
- フッターの共通レイアウトそのもの(frontend-platform)

## Upstream / Downstream

- **Upstream**: admin-foundation、content-processing、user-profile-social(ハンドル基盤)
- **Downstream**: launch-readiness

## Existing Spec Touchpoints

- **Extends**: inquiry-chat(管理画面のカテゴリのページ`/categories`の区画の登録口`CATEGORY_SECTIONS`へ、ヘルプカテゴリの区画を`order` 20で加える)、admin-foundation(`ADMIN_NAV_ITEMS`へヘルプ記事`/help-articles`(`order` 100)を加える)
- **Adjacent**: user-profile-social(ハンドル基盤の方式)、legal-pages(管理者生成コンテンツ)、admin-foundation(`AdminDirectory`による作成者の表示)

## Constraints

- テーブル新規作成時に`textNoCase`をハンドルのカラムへ指定する
- 予約語一覧はハンドル基盤が持つ共通の一覧を使う
- ヘルプカテゴリの管理画面は、inquiry-chatが作る`/categories`のページに区画として載せる(`CategorySection`の`{ id: 'help-center.help-categories', order: 20, title, component }`)。区画の中身はadmin-foundationの`CategoryMasterEditor`を`withHandle: false`、`canEdit`はモデレーター以上で使う。区画ごとにエラー境界で包まれるため、区画の失敗は他の区画を止めない
- ヘルプ記事の管理画面はadmin-foundationの仮6のURL`/help-articles`(メニューの`order` 100)に置く
- 記事を作成した管理者の表示(FR-HELP-008・009)は、admin-foundationの`AdminDirectory.findProfiles`(`ADMIN_PLATFORM_TYPES.AdminDirectory`、`apps/backend-lib/workers/admin`)で引く。削除済み・招待中の管理者は結果に含まれないため、含まれないIDは「削除済み」と表示する。`admins`テーブルを直接読まない
- 管理操作はadmin-foundationの`AuditLogRecorder`で、操作と同じ一括の書き込みに含めて記録する
- 管理画面のE2Eの管理者ログインは、admin-foundationの`e2e/support/admin-bootstrap.ts`を使う
- 4:21のジョブとユーザーライフサイクルの波及処理の`order`は、roadmapの帯の割り当ての表で本specに割り当てた700番台(700〜799)を使う。波及処理の各ドメインの範囲は0〜9999で、10000以上はidentity-auth専用である。帯の値は同じ時刻・同じ種類の中で上流のspecの後に動くため、上流の値より前に動く必要がある処理があれば設計時に開発者へ確認する
