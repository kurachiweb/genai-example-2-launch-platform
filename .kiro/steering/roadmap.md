# Roadmap

## Overview

ローンチプラットフォーム「Launch Stadium」を、[要件定義書](../../docs/requirements/README.md)の全機能(4.1〜4.29)と外部インターフェース・非機能・その他要件(5〜7章)を満たす形で完成させる。成果物は`apps`ディレクトリ内の全アプリ実装と、`docs/GUIDES/tech`ディレクトリ内の技術ドキュメントである。開始時点で`apps`配下に実装ファイルは無く、存在するのは開発コンテナ・`docs/GUIDES/service`のサービス仕様・`mockups`の利用者側4画面(トップ・ディレクトリ・プロダクト詳細・公開プロフィール)のみである。

全体の進め方として、まず多数の機能が共有する基盤を層ごとの横切りspecとして整える。その上に業務ドメインごとの縦切りspec(DBスキーマ・api・event・client/admin画面・テスト・techドキュメントまで端から端まで)を依存順に積み上げる。リリースは全spec完了後に本番環境へ一括で行い、それまではmainブランチ経由でstaging環境へ随時デプロイして検証する。

## Approach Decision

- **Chosen**: 基盤を横に切り、機能を縦に切る方式(29spec)
- **Why**:
  - cc-sddの「1spec20タスク以内」の目安に収まり、spec単位で独立して実装・レビューできる
  - 縦切りの各specが端から端まで動作する機能を届けるため、spec完了ごとにE2Eテストで検証できる
  - BFF中継・GraphQL基盤・レート制限・ファイルパイプライン・マークダウン/FTSなどの横断要素を基盤specが所有するため、所有者が曖昧にならない
  - 各specが担当領域のtechドキュメントも所有するので、CLAUDE.mdの「appsディレクトリを編集した際はdocsも更新」規則と整合する
- **Rejected alternatives**:
  - 細い縦断(walking skeleton)を先に通して肉付けする方式: 最初のspecと後続specの境界が曖昧になり、基盤要素の所有specも不明確になって手戻りが出やすい
  - アプリ(層)単位で横に切る方式: 各specが50タスクを超え、全spec完了まで端から端までの検証ができず、spec間の依存も密結合になる
  - MVP先行の段階リリース: 開発者の判断により不採用とし、全機能完成後の一括リリースとした

## Scope

- **In**:
  - 要件定義書4.1〜4.29の全機能要件と、5章(UI・HW・SW・COM)・6章(性能・セキュリティ・可用性・保守性・移植性・スケーラビリティ・監視)・7章(データ・法・国際化)の要件
  - `apps`配下の全アプリ(infra・db・backend-lib・api・event・frontend-lib・client・admin)の実装とテスト(単体・ブラウザ・Workers統合・E2E)
  - `docs/GUIDES/tech`配下9サブディレクトリ(infra・external・db・backend・frontend・coding・testing・operations・security)の新規作成
  - ルートの開発ツール(package.json・Husky・lint-staged・commitlint・ESLint・Prettier)とGitHub ActionsによるCI/CD
  - モックアップの無い画面のUIデザイン(各spec内で`docs/GUIDES/service/design`に従って行う)
  - `docs/GUIDES/service`のうち未作成の文書(決済実装方針・国際化方針)の作成と、実装で確定した仕様の反映
- **Out**:
  - 要件定義書1.2でスコープ外とされた項目(UI多言語化、ネイティブアプリ、組織アカウント、共同編集、マークダウンへの画像添付、シンタックスハイライト、チャージバックのrepresentment自動化、未ログイン問い合わせへのシステム上の返信)
  - `mockups`アプリへの画面追加(既存4画面は実装時の参照元としてのみ使う)
  - 要件定義書そのものの改訂(曖昧箇所は各specの要件フェーズで開発者に確認し、改訂が必要なら報告する)
  - AIエージェントによるprod環境へのデプロイ実行(ブランチ保護で人間の承認が必須)
  - 法務文書の本文起草(利用規約・プライバシーポリシー・法的通知の文言は開発者が用意する)

## Constraints

- [CLAUDE.md](../../CLAUDE.md)の本プロジェクト規則に従う。特に次の点はspec横断で影響する。
  - TDDの徹底、カバレッジ80%(NFR-MAINT-003)、テストファイル命名による4ツールの棲み分け
  - HonoはInversifyによる依存性注入とクリーンアーキテクチャ、`@inject`の明示
  - D1の制約(`db.transaction()`禁止・`db.batch()`・`onConflictDoNothing()`・バインド変数100個・FTS5はカスタムマイグレーション)
  - 環境シークレットはInfisicalで一元管理し`.dev.vars`・`.env`を使わない、`compatibility_date`は`2026-08-04`
  - Bun Workspacesを使わず、共有ディレクトリ(`apps/db`・`apps/backend-lib`・`apps/frontend-lib`)はbind mountで配置する
  - 1ファイルにつきReactコンポーネントのエクスポートは1つ、日時は`<time datetime>`で表示する
  - サンプルデータのドメインは`.example`のみ、文書・コメント・コミットメッセージは日本語
- 採用技術は[tech-stack.md](../../docs/onboardings/tech-stack.md)に従う。新しいパッケージが必要になったら、workerdで動作し継続的にメンテナンスされている候補を挙げて開発者に質問し、採用したものをtech-stack.mdに追記する。
- `docs/GUIDES/tech`にはプロジェクト名やサービス固有の仕様を書かず、同じ技術選定の他プロジェクトへ丸写しできる内容にする。
- 業務時刻はUTC-08:00固定で、Cronの時刻と処理順は[日次タイムライン](../../docs/GUIDES/service/overview/007-daily-timeline.md)を正とする。
- Workersの制約(グローバルスコープ処理1秒以内、CPU時間30秒以内、メモリ128MB)に収め、重い処理はeventのQueue consumerへ逃がす。
- 画面デザインは`docs/GUIDES/service/design`(デザイン原則・ページ配置・文言規則)に従う。既存モックアップがある画面はそれを正とするが、モックアップのURLには`/client/`接頭辞が付いており本番のURLとは異なる。
- 800行を超えるファイルのWrite/Editはフックでブロックされるため、ファイルを分割して実装する。
- AIエージェントの実行が拒否されるコマンド(`wrangler deploy`・`tofu apply`など)は、開発者が後で手動実行できるよう報告する。
- 技術選定の実現性チェック(2026-10-03実施)で見つかった指摘は、次の各specで設計時に解消する。
  - dev-tooling: 共有ディレクトリがbind mount前提でCIで再現できない(high)、drizzle-ormの二重コピー、Vitestは4.1系に固定
  - backend-platform: Inversify 8は`reflect-metadata`が必須、Vite 8(Oxc)のdecorator変換ヘルパーの解決、Drizzle v1 RCの完全固定、ulidxのメンテナンス縮小
  - email-delivery: Email Sendingはpublic beta、jsx-emailはWorkersでの公式動作手順が無い
  - media-pipeline: Images BindingはExifを除去できない、wasm-image-optimizationはサイズ・メモリ上限に近い、fast-xml-parserの脆弱性とSVG検査の許可リスト化
  - payments: stripe-node v23の破壊的変更とAPIバージョンの固定
  - frontend-platform: Sentry導入によりTanStack StartのCSRF自動導入が外れる、`vite preview`はビルド時の設定で動く
  - infra-delivery: Cloudflare provider v5のドリフト不具合、tfstateへの秘密値の平文保存
  - content-processing: `@milkdown/crepe`の静的importでSSRバンドルが肥大化する
  - data-export: fflateの非同期APIはworkerdで動かない

## Boundary Strategy

- **Why this split**:
  - 基盤7spec(dev-tooling・backend-platform・api-gateway・email-delivery・frontend-platform・media-pipeline・content-processing)とinfra-deliveryが、全ドメインの使う横断要素を先に固める
  - 共通ドメイン5spec(identity-auth・admin-foundation・legal-pages・payments・ultras-subscription)が、認証・管理者・法務ページ・決済・プラン判定という多数のspecが参照する土台を提供する
  - 以降のドメインspecは、要件定義書の節を1〜2個ずつ受け持つ縦切りとし、管理画面側の機能(4.21〜4.23)も該当ドメインのspecへ寄せる。例えばカテゴリマスタは利用するspecが個別に所有する
  - 消費する側が提供する側より後に来るよう依存順を決め、先行specへの後からの改修を最小にする
- **Shared seams to watch**:
  - ユーザーライフサイクルイベント(退会・停止・停止解除): identity-authが契約を定義し退会を発火、ugc-moderationが停止を発火、各ドメインspecが自分のハンドラを登録する
  - プロダクトライフサイクルイベント(非公開化・削除・復元): product-launchが契約を定義し、match-engine・directory-discovery・sponsorshipなどがハンドラを登録、ugc-moderationが非公開化を発火する
  - 可視性フィルタ(退会・停止・非公開・論理削除の除外): ユーザー側の条件はidentity-auth、プロダクト側の条件はproduct-launchが共通部品として所有する
  - ハンドル基盤(大文字小文字を区別しない一意性・旧ハンドルの302リダイレクト・予約語): user-profile-socialが所有し、product-launch・help-center・プロダクトカテゴリが再利用する
  - マッチとブラケット: match-engineが汎用マッチモデルと投票を、tournament-weekがブラケットエンジンを所有し、tournament-yearが再利用する
  - プラン判定(Ultras加入状態): ultras-subscriptionが照会サービスを所有し、user-profile-social・product-launch・tournament-week・tournament-yearが消費する
  - 再ローンチ可否ポリシー: product-launchが所有し、tournament-week・tournament-yearが「トーナメント結果確定待ち」の条件を供給する
  - 決済フルフィルメント: paymentsが購入種別とフルフィルメントのポートを所有し、ultras-subscription・tournament-week・tournament-year・sponsorshipが実装する
  - 通知イベント契約: notificationsが所有し、match-engine・tournament-week・tournament-yearが発行する
  - Cron・Queuesのディスパッチ: backend-platformが所有し、各specがジョブとメッセージ種別を登録する(時刻は日次タイムラインに従う)
  - GraphQLスキーマとpersisted operations: api-gatewayがサーバー側規約を、frontend-platformがクライアント側規約を所有し、各ドメインspecがスキーマモジュールを追加する
  - 画面シェル: 利用者側レイアウトとフッターはfrontend-platform、設定ページのシェルはidentity-auth、管理画面のシェルとメニューはadmin-foundation、トップページはmatch-engine、プロダクト詳細ページはdirectory-discovery、公開プロフィールはuser-profile-socialが所有し、他specはそこへ区画を追加する
  - 隔離バケットと隔離理由: media-pipelineがデータモデルと移動処理を、ugc-moderationが管理操作を所有する
  - 監査ログ: admin-foundationが記録APIと閲覧画面を所有し、管理操作を持つ各specが記録を呼び出す
  - インフラ資源: infra-deliveryがOpenTofu構成を所有し、後続specは必要な資源(Queue・Durable Objectsなど)を同構成へ追記する
  - techドキュメント: dev-toolingが`docs/GUIDES/tech`の構成と索引を作り、各specが担当領域を追記する

## Requirement Ambiguities

要件定義書の読解で見つかった曖昧・未決定の箇所である。担当specの要件フェーズで開発者に確認して解消する。

| 論点                                                                                  | 該当要件                             | 担当spec                             |
| ------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| クールダウン終了時に失敗回数をリセットすると、失敗ごとに2倍のバックオフが伸びない     | FR-RLMIT-010、NFR-SECUR-022          | identity-auth                        |
| メールアドレスをキーにするログイン試行DOがハッシュ化対象から漏れている                | FR-RLMIT-017、NFR-SECUR-022          | identity-auth                        |
| 最初の最上位管理者の作成方法が未定義                                                  | FR-ADMAC-004                         | admin-foundation                     |
| 同一カテゴリに3つ以上ある場合のペアリング方法                                         | FR-GAME-004周辺                      | match-engine                         |
| Week優勝作がYear確定まで最長約1年再ローンチできない意図、トーナメント敗退後の禁止期間 | FR-RELCH-004                         | product-launch、tournament-week      |
| 有料プランによる参加費免除の判定時点、決済済み後に加入した場合の返金                  | FR-TOURW・FR-TOURY・FR-PPLAN-007周辺 | ultras-subscription、tournament-week |
| Year初年度や決勝日未設定時の扱い、初年度に参加が64を超える可能性                      | FR-TOURY-005、FR-ADMCF-003〜004      | tournament-year                      |
| トーナメントの開始予告メールを組み合わせ決定時とマッチ前日のどちらで送るか            | FR-NOTIF-001、FR-TOURY-004           | notifications                        |
| 複数回勝利したプロダクトのディレクトリ上の単位、ソートと期間絞り込みの基準ローンチ    | FR-DIR-001〜007                      | directory-discovery                  |
| スポンサー広告のティア別・日別の掲載枠上限、0:07以降の当日開始申込の開始通知          | FR-SPONS周辺                         | sponsorship                          |
| 全Workerへの「IP単位100回/10秒」制限がStripe WebhookやNAT配下の画像閲覧に及ぶ         | FR-RLMIT-008                         | backend-platform                     |

## Specs (dependency order)

- [ ] dev-tooling -- ルートの品質ゲート(Husky・lint-staged・commitlint・Betterleaks)、ESLint/Prettier/tsconfig基底設定、4種テストの実行規約、共有ディレクトリの依存解決(CI含む)、`docs/GUIDES/tech`の土台と規則移設. Dependencies: none
- [ ] backend-platform -- apps/db・apps/backend-lib・apps/api・apps/eventの骨格(Hono+Inversifyクリーンアーキテクチャ、Drizzle/D1、Wrangler全バインディング、ログ・Sentry、Cron/Queuesディスパッチ、レート制限基盤、Turnstile検証). Dependencies: dev-tooling
- [ ] api-gateway -- GraphQL Yoga基盤(Armor・persisted operations・DataLoader)とスキーマモジュール規約、REST(OpenAPI)骨格、BFF中継の内部認証・セッション・クライアントIP引き継ぎ. Dependencies: backend-platform
- [ ] email-delivery -- メール送信基盤(送信インターフェース・Email Service/Mailpit実装・JSX emailテンプレート基盤・Queues経由の送信と再試行・上限超過時の遅延送信・バウンス等の検知と抑止リスト). Dependencies: backend-platform
- [ ] frontend-platform -- apps/client・apps/admin・apps/frontend-libの骨格(TanStack Start・BFF中継・CSRF・CSP・codegen・TanStack Query・デザインシステム・Storybook・共通レイアウト)と端から端までの疎通確認. Dependencies: api-gateway
- [ ] infra-delivery -- apps/infraのOpenTofu定義(Cloudflare資源・Infisical連携)とGitHub ActionsのCI/CD(検査・staging/prodデプロイ・D1マイグレーション). Dependencies: backend-platform, frontend-platform
- [ ] media-pipeline -- ファイルアップロード・検証・非同期モデレーション(Rekognition)・画像配信ドメイン・同一オリジンのファイル配信・ファイルのライフサイクル(4.25). Dependencies: frontend-platform
- [ ] content-processing -- マークダウン入力・描画・サニタイズ(4.27)と全文検索基盤(FTS5・索引正規化パイプライン、4.28). Dependencies: frontend-platform
- [ ] identity-auth -- ユーザー登録・認証・セッション・TOTP・退会(4.1)、認証プリミティブ、ユーザーライフサイクルイベント、設定ページシェル. Dependencies: frontend-platform, email-delivery
- [ ] admin-foundation -- 管理者アカウント・ログイン・RBAC(4.20)、監査ログ、管理画面シェル、最初の最上位管理者の作成. Dependencies: identity-auth, media-pipeline
- [ ] legal-pages -- 利用規約・プライバシーポリシー・法的通知の編集と改訂履歴、公開ページ、全ページからの規約リンク. Dependencies: admin-foundation, content-processing
- [ ] inquiry-chat -- 問い合わせフォームとチャット(4.17)、管理者の返信・ステータス管理、問い合わせカテゴリマスタ. Dependencies: admin-foundation, media-pipeline
- [ ] payments -- Stripe決済基盤(4.26)、購入とフルフィルメントのポート、Webhook反映、返金、決済履歴. Dependencies: identity-auth, legal-pages
- [ ] ultras-subscription -- 有料プランUltras(4.18)、プラン判定サービス、有料プラン導線の機能フラグ、料金ページ. Dependencies: payments, admin-foundation
- [ ] user-profile-social -- ユーザープロフィールと公開プロフィールページ(4.2)、フォロー(4.3)、ハンドル基盤. Dependencies: identity-auth, media-pipeline, content-processing, ultras-subscription
- [ ] help-center -- ヘルプページ(4.16)、ヘルプ記事管理、ヘルプカテゴリマスタ. Dependencies: admin-foundation, content-processing, user-profile-social
- [ ] product-launch -- プロダクト登録・編集・削除とローンチ日予約(4.5)、再ローンチ制限(4.8)、プロダクトカテゴリマスタ、プロダクトライフサイクルイベント. Dependencies: user-profile-social, admin-foundation
- [ ] match-engine -- 汎用マッチモデル、Upvote(4.6)、予選のペアリング・開始・確定(4.7)、トップページ. Dependencies: product-launch
- [ ] directory-discovery -- ディレクトリ一覧・絞り込み・検索(4.9)、プロダクト詳細ページ、プロダクトの検索索引. Dependencies: match-engine
- [ ] notifications -- マッチ・フォロワー・受賞の通知メール(4.24)、通知設定、RFC 8058配信停止、送信者情報設定. Dependencies: match-engine, email-delivery
- [ ] engagement -- ローンチへのコメント(4.10)とプロダクト評価(4.11). Dependencies: directory-discovery
- [ ] tournament-week -- Product of the Week決定トーナメント(4.13)とブラケットエンジン、参加費決済、自動返金、突合. Dependencies: match-engine, payments, notifications
- [ ] sponsorship -- スポンサー広告の申込・決済・掲載・開始終了通知(4.15)、管理者による強制終了と返金目安額. Dependencies: directory-discovery, payments
- [ ] tournament-year -- Product of the Year決定トーナメント(4.14)と決勝実施日の設定. Dependencies: tournament-week
- [ ] public-api -- 公開REST API(4.19)、APIキー管理、Swagger UIページ. Dependencies: engagement
- [ ] ugc-moderation -- ユーザー生成コンテンツ管理(4.21のうち通報・広告以外)、統計、停止・非公開化・評価無効化、画像の手動モデレーション. Dependencies: engagement, tournament-year, sponsorship
- [ ] content-reporting -- 通報(4.12)、通報管理と権利侵害対応フロー、通報カテゴリマスタ. Dependencies: ugc-moderation
- [ ] data-export -- ユーザーデータのエクスポート(4.4). Dependencies: content-reporting, inquiry-chat, public-api
- [ ] launch-readiness -- 非機能要件の検証(性能・可用性・アクセシビリティ・セキュリティ)、監視設定、全体E2E回帰、運用ドキュメント、本番リリース準備. Dependencies: infra-delivery, help-center, data-export
