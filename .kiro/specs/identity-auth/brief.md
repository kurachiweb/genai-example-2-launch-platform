# Brief: identity-auth

## Problem

投稿者・サポーターがプロダクトを登録し、投票し、コメントするには、アカウントと安全な認証が必要である。要件には次が含まれる。

- パスワードの漏洩照合
- 使い捨てメールアドレスの判定
- ログイン試行の制限
- セッションの一覧と失効
- 任意のTOTP
- 退会時の14日以内の物理削除

退会や停止は、ほぼ全ドメインのデータに波及する。そのため連鎖処理の仕組みが無いと、後続specがそれぞれ独自に対処することになり、漏れが生じる。

## Current State

- 認証の実装は無い。
- tech-stack.mdで、OTPAuthとuqr(TOTPとQRコード)、HIBP Pwned Passwords、DISIFY、Turnstileの採用が決まっている。
- 利用者側の画面配置(`/auth/*`、設定10ページ)が[ページ配置](../../../docs/GUIDES/service/design/002-page-layouts.md)に定義済みである。モックアップはログインダイアログとメール未確認の帯のみ存在する。

## Desired Outcome

- 4.1(FR-USER-001〜023)の全機能が動作する。
  - 規約同意付きの登録、ランダム12文字のハンドル、仮名化ID
  - メールアドレス確認と再送、未確認ユーザーの機能制限
  - メールアドレス変更、ログイン・ログアウト、パスワードのリセットと変更、それぞれの通知メール
  - セッション一覧と失効、任意のTOTPとリカバリコード
  - 退会(論理削除から14日以内の物理削除)
- 認証の共通部品(PBKDF2 10万回、HMACトークン、セッション管理、Durable Objectsによるログイン試行の制限とクールダウン、TOTP)があり、admin-foundationが再利用できる(NFR-SECUR-001〜005・022〜035、COM-004)。
- メール再送とパスワードリセット要求のレート制限が動作する(FR-RLMIT-001・009〜011・017)。
- ユーザーライフサイクルイベント(退会・停止・停止解除)の契約と、ハンドラ登録の仕組みがある。また日次バッチ(4:21)で物理削除を進める削除オーケストレータがある。
- 他specが使える「可視ユーザー」の判定条件(退会・停止の除外)がある。
- 利用者側の画面がある。内容は次のとおりである。
  - `/auth/*`(登録・ログイン・リセット・TOTP)
  - 設定ページのシェル
  - アカウント・セキュリティの設定ページ
  - メール未確認の帯
- `docs/GUIDES/tech/security`(認証認可設計)と`external`(HIBP・DISIFY・Turnstile)に記載がある。

## Approach

認証の共通部品は利用者・管理者の両方で使える形にし、利用者側の機能だけをこのspecで完成させる。退会・停止の波及は、イベント契約とハンドラ登録で解決する。後続の各ドメインspecは、自分のデータに対する処理を登録するだけで済むようにする。

## Scope

- **In**:
  - 4.1(FR-USER-001〜023)全体
  - 認証関連のNFR-SECUR、FR-RLMIT-001・009〜011・017
  - SW-018〜020(Turnstile・HIBP・DISIFY)の利用
  - ユーザーライフサイクルイベントと削除オーケストレータ
  - 可視ユーザーの判定条件
  - 設定ページのシェルと関連画面
  - 上記のテストとtechドキュメント
- **Out**:
  - プロフィールの編集と表示(user-profile-social)
  - 管理者の認証(admin-foundationが共通部品を再利用する)
  - 停止の操作(ugc-moderation)
  - Stripe Customerの削除処理(paymentsがハンドラを登録する)

## Boundary Candidates

- 資格情報とセッションの管理
- 多要素認証
- アカウントのライフサイクル(登録・確認・退会・物理削除)
- 試行制限とbot対策の適用
- 設定ページのシェル

## Out of Boundary

- プロフィール情報
- 各ドメインデータの削除・匿名化の中身

## Upstream / Downstream

- **Upstream**: frontend-platform、email-delivery、backend-platform(レート制限基盤・Turnstile検証)
- **Downstream**: admin-foundation、payments、user-profile-social、およびログインを要する全spec

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: legal-pages(登録時に同意する規約の版)、ugc-moderation(停止の発火)

## Constraints

- 外部API(HIBP・DISIFY)の障害時の扱いを縮退運転の方針に沿って決める
- 要件の論点(要件フェーズで開発者に確認する):
  - FR-RLMIT-010(クールダウン終了時に失敗回数をリセット)とNFR-SECUR-022(失敗ごとに2倍、最大5分)を併せると、バックオフが1秒より先に伸びない。失敗回数とバックオフ段階を別々に数える必要がある
  - FR-RLMIT-017のハッシュ化対象にNFR-SECUR-022(メールアドレスをキーにするDurable Objects)が含まれていない。記載漏れの可能性が高い
  - 登録時の規約同意で、同意した規約の版を記録するかどうか(legal-pagesとの継ぎ目)
- 文言と入力上限は`docs/GUIDES/service/design`の規則に従う
