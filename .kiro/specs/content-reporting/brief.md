# Brief: content-reporting

## Problem

利用者は(未ログインでも)、不適切なプロフィール・プロダクト・コメントを運営に通報したい。権利を侵害された人は、情報流通プラットフォーム対処法に沿った削除請求を行えなければならない(LR-004)。運営は、繰り返し通報を集約して対応状況を管理し、措置・却下・事情の照会を当事者へメールで伝え、対応期間を把握する必要がある。

## Current State

- 通報の実装は無い。
- 通報ダイアログのモックアップがある。侵害コンテンツの削除請求フローは[legalディレクトリ](../../../docs/GUIDES/service/legal)に定義済みである。
- ugc-moderationで非公開化・停止の管理操作と投稿者への通知が実装済みである前提である。

## Desired Outcome

- 通報機能(FR-REPOT-001〜006)が動作する。
  - プロフィール・プロダクト・コメントを未ログインでも通報できる
  - カテゴリをマスタから選び、未ログインで「権利侵害」を選んだ場合は連絡先が必須
  - 理由は1,000文字以内、自分のコンテンツは通報できない
  - Turnstileによるbot対策
- 通報のレート制限が動作する(FR-RLMIT-004・016)。IP単位で1時間に10回、ログイン中はユーザー単位も同じ基準でDurable Objectsにより制限し、キーはハッシュ化する。
- 管理者側の通報管理(FR-ADMUG-019・020・025・027・030・035・039・040)が動作する。
  - 一覧と絞り込み、4種の対応ステータス
  - 同一コンテンツへの通報の集約と、件数・理由の内訳の表示
  - 一覧からの措置(ugc-moderationの非公開化・停止のユースケースを使う)と却下
  - 措置・却下を投稿者と申出者へメールで通知する
  - 権利侵害の通報で、投稿者へ事情を照会するメールを送れる
  - 権利侵害の通報の対応期間を表示する
- 通報カテゴリのマスタ管理(FR-ADMCF-019〜021)が動作する。標準の「権利侵害」「その他」は削除できず、削除時は「その他」へ付け替える。
- 管理画面のプロダクト詳細に、受け付けた通報件数の区画がある(FR-ADMUG-008)。
- 監査ログの対象操作が記録される。

## Approach

通報の受付・集約・ステータス管理と当事者への連絡をこのspecが持ち、コンテンツへの措置そのものはugc-moderationのユースケースを呼び出す。権利侵害のフローは法的要件の手順書に沿って状態遷移を設計する。

## Scope

- **In**:
  - 4.12(FR-REPOT-001〜006)
  - FR-ADMUG-019・020・025・027・030・035・039・040、FR-ADMCF-019〜021、FR-RLMIT-004・016、LR-004
  - 通報ダイアログ、管理画面の通報管理、通報カテゴリのマスタ
  - 上記のテスト
- **Out**:
  - 非公開化・停止の実処理(ugc-moderation)
  - 問い合わせ(inquiry-chat)

## Boundary Candidates

- 通報の受付とbot・連投対策
- 通報の集約と対応ステータス
- 当事者への連絡(措置・却下・照会)
- 通報カテゴリのマスタ

## Out of Boundary

- コンテンツの措置そのもの
- 問い合わせ対応

## Upstream / Downstream

- **Upstream**: ugc-moderation、admin-foundation、email-delivery
- **Downstream**: data-export(利用者の通報履歴の扱い)

## Existing Spec Touchpoints

- **Extends**: ugc-moderationの措置ユースケースを呼び出す(通報由来であることを措置の記録に含める)。admin-foundationの`DASHBOARD_CARDS`へ未対応の通報の件数のカードを`order` 30で加える(admin-foundation Q2)。inquiry-chatの`CATEGORY_SECTIONS`(管理画面の`/categories`)へ通報カテゴリの区画を`order` 40で加える。admin-foundationの`ADMIN_NAV_ITEMS`へ通報`/reports`(`order` 70)を加える
- **Adjacent**: inquiry-chat(4種の対応ステータスという同じ方式)

## Constraints

- 対応完了日時は監査ログに記録し、対応期間の算出に使う(FR-ADMUG-040)。対応期間の表示は、admin-foundationの`AuditLogReader.latestFor({ action, targetKind, targetId })`(最新の記録の日時を返す)で引き、監査ログのテーブルを直接読まない
- 未ログインの申出者の連絡先は個人情報として扱い、保持期間はデータ要件(DR)に従う
- ダッシュボードのカードは`DashboardCard`の`{ id: 'content-reporting.unhandled-reports', order: 30, width, component }`で、自分でデータを取得し`DashboardCardFrame`で枠と状態を表示する。カードの失敗は他のカードを止めない
- 通報カテゴリの区画は`CategorySection`の`{ id: 'content-reporting.report-categories', order: 40, title, component }`で、admin-foundationの`CategoryMasterEditor`を`withHandle: false`で使う
- 投稿者(ログイン中の利用者)へのメールの宛先は、identity-authの`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`)で引き、`users`を直接読まない。退会済みで`undefined`なら送らない
- 4:21のジョブとユーザーライフサイクルの波及処理の`order`は、roadmapの帯の割り当ての表で本specに割り当てた2000番台(2000〜2099)を使う。波及処理の各ドメインの範囲は0〜9999で、10000以上はidentity-auth専用である。帯の値は同じ時刻・同じ種類の中で上流のspecの後に動くため、上流の値より前に動く必要がある処理があれば設計時に開発者へ確認する
- 管理画面のE2Eの管理者ログインは、admin-foundationの`e2e/support/admin-bootstrap.ts`を使う
