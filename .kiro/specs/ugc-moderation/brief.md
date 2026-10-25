# Brief: ugc-moderation

## Problem

運営(モデレーター以上の管理者)は、不適切な利用者やコンテンツに対し、理由を記録したうえで停止・非公開化・評価の無効化を行い、必要に応じて取り消して復元したい。措置は、マッチ予定の取り消し、画像の隔離バケットへの移動、検索索引の更新、投稿者へのメール通知に連鎖する。隔離理由が複数ある画像は、すべての理由が解消されるまで復元してはならない(FR-ADMUG-028)。運営状況を把握するための週次の統計も必要である。

## Current State

- 管理者側のUGC管理画面は無い。
- admin-foundationで監査ログと管理画面のシェルが、media-pipelineで隔離理由のデータモデルと移動処理ができている前提である。
- ユーザー・プロダクトのライフサイクルイベントの契約(identity-auth・product-launch)と、各specのハンドラ(マッチ終了・索引更新・広告非表示など)が先行specで実装済みである前提である。

## Desired Outcome

- 統計表示(FR-ADMUG-001)がある。週ごとの合計収益・ユーザー数・プロダクト数・予選実施数・Upvote数の変化をグラフで表示する。統計は独立したページではなく、管理画面のダッシュボード(`/`)のカードとして表示する(admin-foundation Q2)。
- ユーザー管理(FR-ADMUG-002〜004)がある。
  - 一覧と、ハンドル・ニックネーム・メールアドレス・停止状態による検索と絞り込み
  - 使い捨てメールアドレスの判定結果の表示
  - 理由付きの停止と停止解除(ユーザーライフサイクルイベントを発火する)
  - 運営者による代理の退会
    - セッションが切れた停止中の利用者などから依頼を受け、最上位管理者だけがユーザー一覧から行う(2026-10-24に開発者が確定、仮4)
    - identity-authの操作口(例: `AdministrativeWithdrawal`)を呼び、監査ログに記録する
    - 依頼の受け付け・本人の意思の確かめ・完了の知らせは運営者がシステムの外のメールで行う(仮4・仮5)
- プロダクト管理(FR-ADMUG-005〜008)がある。
  - 一覧・検索・詳細(評価一覧・ローンチ履歴・マッチ結果)
  - 理由付きの非公開化と復元
  - 停止・非公開化に伴う未開始マッチ予定の取り消し
- コメント管理(FR-ADMUG-010〜011)と評価の無効化・取り消し(FR-ADMUG-012)がある。
- 画像のモデレーション(FR-ADMUG-013〜014・025〜028)がある。
  - 隔離画像を管理者側の同一オリジンから表示する
  - 公開承認(画像用バケットへ移動)と公開拒否(削除)
  - 非公開化・停止に伴う隔離と復元
  - 公開中の画像の個別隔離
  - 複数の隔離理由の判定
- 措置を投稿者へメールで通知する(FR-ADMUG-019のうち投稿者への通知)。
- FR-ADMAG-001に列挙された操作(メールアドレス検索を含む)が監査ログに記録される。

## Approach

管理操作はライフサイクルイベントの発火に集約し、波及処理は各specが登録済みのハンドラに任せる。このspecは「誰が・何に・なぜ」措置したかの記録と、管理画面のUIを持つ。統計は集計用のクエリを日次または週次で計算し、表示時の負荷を抑える。

## Scope

- **In**:
  - 4.21のうちFR-ADMUG-001〜014・019(投稿者への通知)・025〜028
  - 管理画面のユーザー・プロダクト・コメント・評価・画像の各管理画面と、ダッシュボードの統計のカード
  - 上記のテスト
- **Out**:
  - 通報の管理と申出者への通知(content-reporting、FR-ADMUG-015〜022)
  - 広告の強制終了(sponsorship、FR-ADMUG-023〜024)
  - 措置に伴う各ドメインの波及処理の中身(各specのハンドラ)

## Boundary Candidates

- 統計の集計と表示
- ユーザーの停止
- プロダクト・コメントの非公開化と評価の無効化
- 画像の手動モデレーション
- 措置の通知と監査記録

## Out of Boundary

- 通報のワークフロー
- 波及先のデータ処理

## Upstream / Downstream

- **Upstream**: engagement、tournament-year、sponsorship、admin-foundation、media-pipeline、payments(収益の集計)、identity-auth(停止・停止解除と運営者による退会の操作口)
- **Downstream**: content-reporting

## Existing Spec Touchpoints

- **Extends**:
  - admin-foundation: `DASHBOARD_CARDS`へ統計のカードを`order` 10で加え(admin-foundation Q2)、`ADMIN_NAV_ITEMS`へユーザー`/users`(20)・プロダクト`/products`(30)・コメント`/comments`(40)・評価`/ratings`(50)・画像モデレーション`/media-moderation`(60)を加える(URLと`order`はadmin-foundationの仮6)
  - payments: 統計の週ごとの合計収益は、paymentsが決済のテーブルの直接の読み取りを禁じているため、paymentsが仮7で提供する期間ごとの純収益の照会`PaymentRevenueReport`(paymentsのタスク5.5・5.7)を使う(2026-10-24に開発者が上流の所有・実装と確定)
  - engagement: 管理画面のコメントと評価の一覧の照会は、engagementが仮6で提供する(engagementのタスク2.7。2026-10-24に開発者が上流の所有・実装と確定)
- **Adjacent**: content-reporting(通報からの措置)、media-pipeline(隔離の移動処理)

## Constraints

- 統計グラフの描画にはグラフ用のライブラリが必要になる見込みで、新規パッケージとして候補を挙げて開発者に質問する(仮2でRechartsに確定)
- プロダクト詳細に表示する「受け付けた通報件数」(FR-ADMUG-006)は、content-reportingが区画として追加する
- 隔離画像の表示はSW-012の画像配信経路を使わず、SW-011と同じ方式(APIが管理者認証を判定してR2から読み出し、管理者側フロントエンドが中継)で行う
- 統計のカードは`DashboardCard`の`{ id: 'ugc-moderation.weekly-statistics', order: 10, width: 'full', component }`とし、自分でデータを取得して`DashboardCardFrame`で枠と状態を表示する。別の統計のページは作らない
- 要件の論点(要件フェーズで開発者に確認する。仮8で確定し、本specは返金を依頼しない。広告はsponsorshipの仮3で停止した日数分を自動で日割り返金する): 停止・非公開化に伴う返金を自動で行うか。法的通知の大枠の返金ポリシーは自動の返金を書くが、FR-ADMUG-024は返金目安額の表示までで、sponsorshipのbriefは手動の返金としていた(roadmapのRequirement Ambiguities。sponsorshipの仮3の確定で自動の日割り返金に改めた)。本specは返金を依頼しない(仮8で確定)。
- 停止・停止解除・運営者による代理の退会の画面は、identity-authの`UserSuspension`・`AdministrativeWithdrawal`を呼び、権限はadmin-foundationの`requireAdmin`、記録は`AuditLogRecorder`で行う。メールアドレス検索の記録はadmin-foundationの操作種別`user.email-search`を使う
- 投稿者への通知メールの宛先は、identity-authの`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`)で引く。停止中の利用者も宛先を返すため、停止の通知を送れる
- 管理画面のE2Eの管理者ログインは、admin-foundationの`e2e/support/admin-bootstrap.ts`を使う
- 4:21のジョブとユーザーライフサイクルの波及処理の`order`は、roadmapの帯の割り当ての表で本specに割り当てた1900番台(1900〜1999)を使う。波及処理の各ドメインの範囲は0〜9999で、10000以上はidentity-auth専用である。帯の値は同じ時刻・同じ種類の中で上流のspecの後に動くため、上流の値より前に動く必要がある処理があれば設計時に開発者へ確認する
