# Brief: user-profile-social

## Problem

投稿者は、自分が何者でどんなプロダクトを作ってきたかをプロフィールで示したい。サポーターと探索者は、気になる作り手をフォローしたい。プロフィールのURLにはユーザーハンドル(`@handle`)を使う。ハンドルの変更時には旧URLからリダイレクトし、大文字小文字を区別せずに一意にし、予約語を拒否する必要がある。この「ハンドル基盤」は、プロダクト・ヘルプ記事・プロダクトカテゴリでも同じ方式で使われる。

## Current State

- プロフィールとフォローの実装は無い。
- 公開プロフィールページのモックアップが`mockups/src/routes/client/@{$handle}`にある(本番のURLは`/@{handle}`)。
- identity-authでランダム12文字の初期ハンドルが発行され、media-pipelineで画像の、content-processingでマークダウンの基盤ができている前提である。

## Desired Outcome

- プロフィール機能(FR-UPROF-001〜013)が動作する。
  - ハンドル・ニックネーム・プロフィール画像(500kB)・ヘッドライン・マークダウンの自己紹介(5,000文字)・外部URLの編集
  - 外部リンクへの`rel="ugc"`付与
  - Ultras加入中の表示(ultras-subscriptionのプラン判定を使う)
- ハンドル基盤が再利用できる部品としてある。内容は次の3つである。
  - `textNoCase`による大文字小文字を区別しない一意性
  - 旧ハンドルを1件保持して302でリダイレクトする仕組み
  - 予約語一覧による拒否
- 公開プロフィールページ`/@{handle}`がモックアップに沿って実装されている。後続specが区画(ローンチ履歴・Upvote履歴)を追加できる。
- フォロー機能(FR-FOLOW-001〜010)が動作する。
  - フォローと解除(解除は物理削除)
  - 自分自身・停止中ユーザーへのフォロー拒否
  - フォロワー数、フォロー・フォロワーの一覧(20件ずつのカーソル方式)
  - Turnstileによるbot対策
- 退会・停止したユーザーは、プロフィールとフォロー一覧から除外される。
- 設定ページにプロフィール編集画面がある。

## Approach

ハンドル基盤は、ユーザーに閉じない汎用部品としてこのspecで作る。対象テーブル・旧ハンドル保持テーブル・予約語一覧を引数で受け取る形にし、product-launch・help-center・プロダクトカテゴリが再利用する。公開プロフィールページはこのspecが所有し、他specは区画を追加するだけにする。

## Scope

- **In**:
  - 4.2(FR-UPROF-001〜013)、4.3(FR-FOLOW-001〜010)
  - ハンドル基盤と予約語一覧
  - 公開プロフィールページとプロフィール編集画面、フォロー関連の画面
  - ユーザーライフサイクルイベントへのハンドラ登録(プロフィール画像の削除など)
  - 上記のテスト
- **Out**:
  - ローンチ履歴の区画(product-launch)
  - Upvote履歴の区画(match-engine)
  - フォロワーへの通知メール(notifications)
  - 停止の操作(ugc-moderation)

## Boundary Candidates

- プロフィール情報とその編集
- ハンドル基盤
- 公開プロフィールページの構成
- フォロー関係

## Out of Boundary

- プロダクトとマッチの情報
- 通知の送信

## Upstream / Downstream

- **Upstream**: identity-auth、media-pipeline、content-processing、ultras-subscription
- **Downstream**: product-launch、help-center、notifications(フォロワー)、public-api、data-export

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: product-launch・help-center(ハンドル基盤の利用者)

## Constraints

- ハンドル列には`textNoCase`をテーブル新規作成時に指定する(後から指定するとテーブル再作成のマイグレーションになる)。`nocase`が同一視するのはASCIIの大文字小文字のみ
- 入力上限と表示規則は[文言規則](../../../docs/GUIDES/service/design/003-text-and-copy-rules.md)に従う
- モックアップのURLは`/client/`接頭辞付きで、本番のURLとは異なる
