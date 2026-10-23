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
  - ユーザーライフサイクルイベントへのハンドラ登録
    - 退会・物理削除に伴う、退会者の全保有ファイル(プロフィール画像に限らず、プロダクトの画像・問い合わせの添付を含む)の物理削除(media-pipelineの`eraseOwnedBy`)
    - 停止・停止解除に伴う、隔離理由`user_suspended`の付け外し(media-pipelineの`MediaQuarantine.addReasonForOwner`・`removeReasonForOwner`)
    - いずれも1回に最大1,000件を処理して残りの有無(`hasMore`)を返すので、identity-authの非同期の波及処理の`continue`へ対応付ける
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

- **Extends**: inquiry-chat(利用者の表示用の照会口`InquirerProfiles`の既定の実装(プロフィール画像は常に`null`)の束縛を、本specのプロフィール画像付きの実装へ差し替える。差し替えの手順と形はinquiry-chatの設計の`InquirerProfiles`を正とし、形は変えない)
- **Adjacent**: product-launch・help-center(ハンドル基盤の利用者)、ultras-subscription(`UltrasEntitlements`)

## Constraints

- ハンドル列には`textNoCase`をテーブル新規作成時に指定する(後から指定するとテーブル再作成のマイグレーションになる)。`nocase`が同一視するのはASCIIの大文字小文字のみ
- 入力上限と表示規則は[文言規則](../../../docs/GUIDES/service/design/003-text-and-copy-rules.md)に従う
- モックアップのURLは`/client/`接頭辞付きで、本番のURLとは異なる
- ファイルの波及処理の担当は、roadmapのShared seams「ユーザーのファイルの波及処理」で決まっている。外部キーの無い`media_files`はidentity-authの取り残しの検出に掛からない
  - identity-authから本specの実装までの間にstagingで物理削除された利用者のファイルは、取り残される
  - 取り残されたファイルを一度だけ消す手順を設けるか、stagingのデータなので受け入れるかは、要件フェーズで決める
- プロフィール画像の上限500kBは、文言規則の「容量の単位」により1,024を基数とする512,000バイトとする(admin-foundationの`admin-avatar`と同じ解釈)。画像用の用途の上限はmedia-pipelineの`IMAGE_STORAGE_MAX_BYTES`以下にする
- Ultras加入中の表示は、ultras-subscriptionの`UltrasEntitlements.isEntitledAt(userId, 現在時刻)`で判定し、Ultrasのテーブルを直接読まない
- `InquirerProfiles`の差し替えは、inquiry-chatの問い合わせのチャットと管理画面の詳細にプロフィール画像を出すためで、差し替えた実装も退会済みの利用者を返さない既定の実装の規則に従う
- 本specがinquiry-chatで置き換えるのは`InquirerProfiles`の束縛だけである。inquiry-chatの管理画面の一覧の`D1InquiryAdminReader`は、絞り込み・並べ替え・ページ分けと同じ1回の読み取りで送信者のニックネームを得るため`users`を結合しており、`InquirerProfiles`に依存しない。この結合は表示の読み取りの例外として残し、本specは置き換えない(roadmapのShared seams「利用者の連絡先の照会」)
- ファイルの波及処理(退会・物理削除の`eraseOwnedBy`、停止・停止解除の`addReasonForOwner`・`removeReasonForOwner`)は、roadmapのShared seams「ユーザーのファイルの波及処理」のとおり本specが担当する。波及処理と4:21のジョブの`order`は、roadmapの帯の割り当ての表で本specに割り当てた600番台(600〜699)を使う(波及処理の各ドメインの範囲は0〜9999で、10000以上はidentity-auth専用)。`purge_due`では、本specの600番台がinquiry-chat(300)の添付の紐付けの削除などの上流のドメインの行の削除の後に動くことを確かめる。後続specのドメインの行(product-launchの1000番台など)はファイルの削除の後に消えるため、後続specの行がファイルを参照していても物理削除が止まらないかを設計時に確かめる
- メールを送る場合の宛先は、identity-authの`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`)で引く
- ハンドルの規則(文字種・長さ・予約語・大文字小文字・旧ハンドル)は本specが所有する。identity-authが持つのは、登録時に生成する初期ハンドルの形式(`InitialHandleFormat`)と、重複判定の差し込み口(`HANDLE_AVAILABILITY`)だけである。初期ハンドルの形式は本specの規則を満たす必要がある
- データエクスポートの`profile.json`(`nickname`・`handle`を含む)と、`manifest.json`の`user.handle`・ZIPのファイル名に使うハンドルは、本specの出力用の部品が返す(roadmapのShared seams「データエクスポートの出力」)。identity-authの`AccountExport`は`account.json`の持ち分(メールアドレス・確認日時・登録日時・多要素認証の有効状態)と仮名化IDだけを返し、ニックネーム・ハンドルを返さない
