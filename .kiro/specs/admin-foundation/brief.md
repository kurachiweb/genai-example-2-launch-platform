# Brief: admin-foundation

## Problem

システム管理者がサービスを運用するには、利用者とは別の管理者アカウントと、TOTP必須のログイン、権限ロールによるアクセス制御(閲覧のみ・モデレーター・最上位管理者)が要る。さらに、管理操作を個人情報抜きで記録する監査ログが必要である。後続の管理機能(UGC管理・ヘルプ・問い合わせ・カテゴリマスタなど)はすべてこの土台の上に載る。

## Current State

- 管理者側の実装もモックアップも無い(`mockups/src/routes/admin`はプレースホルダーのみ)。
- 管理者側の16メニューが[ページ配置](../../../docs/GUIDES/service/design/002-page-layouts.md)に定義済みである。
- identity-authで、認証の共通部品(パスワード・セッション・TOTP・試行制限)ができている前提である。

## Desired Outcome

- 4.20(FR-ADMAC-001〜015)の全機能が動作する。
  - ダッシュボード
  - メールアドレス・パスワード・TOTP必須のログインとログアウト
  - 管理者アカウントの一覧、招待(閲覧のみ権限)、物理削除(全セッションも削除)
  - ロールの割り当てと、最上位管理者だけがロールを変更できる制限
  - 最後の最上位管理者の保護
  - プロフィール編集(画像500kB・ニックネーム25文字・肩書き50文字)
  - メールアドレス変更、パスワード変更とリセット、TOTPの再設定とリカバリコードの再発行
- ロールに応じたアクセス制御の共通部品があり、後続specの管理機能が権限を宣言するだけで使える(NFR-SECUR-008)。
- 監査ログがある(FR-ADMAG-001〜004)。記録APIは、操作者・対象(ユーザーは仮名化IDのみ)・500文字以内の理由・日時を受け取る。メールアドレス検索は検索文字列を記録しない。閲覧・検索の画面も含む。
- 管理画面のシェル(16メニューのナビゲーション枠)があり、後続specがメニュー項目と画面を追加できる。
- 最初の最上位管理者を作成する手段がある。
- 管理画面向けのカテゴリマスタ編集UIなど、後続specが共通で使う管理画面部品がある。

## Approach

認証はidentity-authの共通部品を再利用し、管理者用のテーブルとセッションは利用者と分ける。監査ログは記録APIとして提供し、どの操作を記録するかは各管理機能のspecが要件(FR-ADMAG-001の列挙)に従って呼び出す。管理画面のUIデザインは、モックアップが無いため、このspec内でshadcn/uiと`docs/GUIDES/service/design`に従って行う。

## Scope

- **In**:
  - 4.20(FR-ADMAC-001〜015)全体
  - RBACの共通部品
  - 監査ログ(FR-ADMAG-001〜004)
  - 管理画面のシェルと共通部品
  - 最初の最上位管理者の作成手段
  - 上記のテスト
  - `docs/GUIDES/tech/security`への管理者の認可設計の追記
- **Out**:
  - 統計グラフ(FR-ADMUG-001、ugc-moderation)
  - 各管理機能の画面と操作(後続の各spec)
  - 利用者の認証(identity-auth)

## Boundary Candidates

- 管理者アカウントと認証
- ロールによるアクセス制御
- 監査ログ
- 管理画面のシェル

## Out of Boundary

- UGCの管理操作
- サービス設定値の中身

## Upstream / Downstream

- **Upstream**: identity-auth(認証の共通部品)、media-pipeline(管理者のプロフィール画像)、email-delivery(招待・変更通知のメール)
- **Downstream**: legal-pages、help-center、inquiry-chat、ultras-subscription、product-launch、notifications、tournament-year、sponsorship、ugc-moderation、content-reporting

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: identity-auth(認証部品の共有)

## Constraints

- 管理者側は利用者側と別ドメインで配信される([README.md](../../../README.md)の配信URL一覧)
- 要件の論点(要件フェーズで開発者に確認する):
  - 招待で追加できるのは閲覧のみのアカウントだけなので、最初の最上位管理者の作成方法(シードデータ・CLIなど)が未定義
  - ダッシュボード(FR-ADMAC-001)に何を表示するか(統計グラフはugc-moderationが所有する)
