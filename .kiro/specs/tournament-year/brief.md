# Brief: tournament-year

## Problem

Product of the Weekの優勝作は、年に1度のProduct of the Year決定トーナメントに挑める。決勝日は、欧州サッカーのリーグ最終節に合わせて管理者が設定する。決勝日から逆算した決済期限・組み合わせ決定・各ラウンドの日程と、参加数を64以下に保つ制約を、正確に扱う必要がある。

## Current State

- Yearトーナメントの実装は無い。
- Weekとの差分(参加数P≤32、決勝日は管理者が設定)が[Yearトーナメントルール](../../../docs/GUIDES/service/overview/005-year-tournament-rules.md)に定義済みである。
- tournament-weekで汎用のブラケットエンジンができている前提である。

## Desired Outcome

- Yearトーナメント(FR-TOURY-001〜030)が動作する。
  - Weekの優勝作に参加資格を与える
  - 決済期限は決勝6日前の23:35、組み合わせは同日23:45に決める
  - 参加は最大64(シード最大32)
  - 1回戦は参加数に応じて決勝の0〜5日前に行う
  - その他の規則はWeekと同じ型で、賞を授与する
- 最上位管理者が決勝実施日を設定できる(FR-ADMCF-001〜003・006・007、監査ログの対象)。
  - 対象年内の日曜日のみ選べる
  - 現在から8日後より前は選べない
  - 前年の決勝実施日から64週以上空く日付は拒否する
  - 未設定なら5月の最終日曜日を決勝実施日とする
  - 決勝7日前以降は変更できない
- 再ローンチ可否ポリシーへ、Yearの結果確定待ちの条件を供給する。
- 通知イベント(開始予告・結果・受賞)を発行する。

## Approach

tournament-weekのブラケットエンジンを再利用し、Year固有の部分(参加資格・日程の算出・決勝日の設定)だけを実装する。日程の算出は決勝日を起点とする純粋関数にして、単体テストで境界を網羅する。

## Scope

- **In**:
  - 4.14(FR-TOURY-001〜030)
  - FR-ADMCF-001〜003・006・007と管理画面の決勝日設定
  - Year固有の参加資格・日程・表示
  - 上記のテスト
- **Out**:
  - ブラケットエンジンそのもの(tournament-week)
  - Weekトーナメント

## Boundary Candidates

- Yearの参加資格
- 決勝日の設定と日程の算出
- Yearの表示と賞

## Out of Boundary

- ブラケットの汎用ロジック
- 決済の共通処理

## Upstream / Downstream

- **Upstream**: tournament-week、admin-foundation
- **Downstream**: ugc-moderation、data-export

## Existing Spec Touchpoints

- **Extends**:
  - tournament-weekのブラケットエンジンを再利用する(改修が必要になった場合はtournament-weekの設計と整合させる)
  - ultras-subscription: 管理画面の設定ページ`/settings`の区画の登録口`ADMIN_SETTINGS_SECTIONS`へ、決勝実施日の区画を`order` 10で加える。`ULTRAS_ACTIVATION_HANDLERS`へ加入が有効になった知らせのハンドラを登録する
  - payments: 購入種別`year_tournament_entry`の`PurchaseKindRegistration`・`PurchaseOfferPolicy`・`PurchaseFulfillment`を実装する
- **Adjacent**: notifications(トーナメント開始予告の送信時刻)

## Constraints

- 要件の論点(要件フェーズで開発者に確認する):
  - 前年の決勝日が未設定(既定値)のとき、それを「設定されている」と扱うか
  - 初年度は期間の起点が無いため、参加が64を超え得る(FR-TOURY-012の「シード最大32」と矛盾し得る)
  - 停止・非公開化に伴う参加資格の停止で返金を自動で行うか(法的通知の大枠の返金ポリシーとFR-ADMUG-045・sponsorshipのbriefの食い違い。roadmapのRequirement Ambiguities)。行う場合はpaymentsの`PaymentRefunds`を呼ぶ
- 決勝実施日の区画は`AdminSettingsSection`の`{ id: 'tournament-year.final-date', order: 10, component }`。ページの枠と`/settings`のメニュー項目(admin-foundationの`ADMIN_NAV_ITEMS`の`order` 130)はultras-subscriptionが持つ。変更は最上位管理者だけが行える(admin-foundationのQ3の`requireAdmin(..., 'super_admin')`)、監査ログは`AuditLogRecorder`で記録する
- 参加費の免除は、ultras-subscriptionのQ1・Q2(勝利時点と加入時点の2時点で判定、決済済みの参加費は返金しない)に従い、Weekの優勝の確定時刻`w`と決済期限`d`に対する`UltrasEntitlements.wasEntitledDuring(userId, w, d)`で判定する。Ultrasのテーブルを直接読まない
- 加入が有効になった知らせのハンドラは`UltrasActivationHandlerRegistration`の`{ name: 'tournament-year.<名詞句>', order, handler }`で、`order`は100以上(ultras-subscriptionの規則)をtournament-weekと重ならないように割り当て、冪等にする。資格の付与と、未完了の参加費の決済セッションのpaymentsの`OpenCheckoutExpirer.expireOpen({ userId, kinds: ['year_tournament_entry'], ... })`での失効を行う(FR-PPLAN-008・FR-TOURY-030)。`OpenCheckoutExpirer`はStripeを呼ぶため、eventの非同期の処理から呼ぶ
- 未加入者へのUltrasの導線など、機能フラグの値で表示が変わる画面をE2Eで確かめる場合は、フラグの行を書き換えるultras-subscriptionのE2Eのプロジェクトの依存に加えるか、フラグの値で結果が変わる部分を確かめない(roadmapのShared seams「プラン判定」)
- 参加資格を失った場合の自動返金は、paymentsの`PaymentRefunds`で依頼し、Stripeを直接呼ばない。決済の突合のジョブはpaymentsが所有し、本specは結果をフルフィルメントで受け取る
- 参加者へのメールの宛先は、identity-authの`UserContactDirectory`(`IDENTITY_PLATFORM_TYPES.UserContactDirectory`)で引く
- `PurchaseKindRegistration`に登録するServiceIdentifierは、本specが`backend-lib/workers/<ドメイン>`の共有モジュールでapi・eventの両方に束縛する(paymentsのRevalidation Triggers)
- 管理画面のE2Eの管理者ログインは、admin-foundationの`e2e/support/admin-bootstrap.ts`を使う
- 4:21のジョブとユーザーライフサイクルの波及処理の`order`は、roadmapの帯の割り当ての表で本specに割り当てた1700番台(1700〜1799)を使う。波及処理の各ドメインの範囲は0〜9999で、10000以上はidentity-auth専用である。帯の値は同じ時刻・同じ種類の中で上流のspecの後に動くため、上流の値より前に動く必要がある処理があれば設計時に開発者へ確認する
