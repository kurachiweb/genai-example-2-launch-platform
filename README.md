# ローンチディレクトリ「Launch Stadium」

Launch Stadiumのプログラム一式、及びドキュメント。
詳細は以下のソフトウェア要件定義書を参照すること。

サービス開発に参加する際は[オンボーディングガイド](docs/onboardings/README.md)を、使用する主な技術は[技術選定](docs/onboardings/tech-stack.md)を読むこと。

---

## ソフトウェア要件定義書(IEEE 29148準拠)

### 1. イントロダクション

#### 1.1 目的

本文書は、Launch Stadiumのソフトウェア要件を定義する。
本システムは、プロダクト同士の1対1対戦形式によるローンチプラットフォームを提供する。
選ばれたプロダクトのみを掲載する点にこそ価値があると考え、ローンチする人や応援する人が勝利体験と成長への期待を感じられることを目指す。

#### 1.2 スコープ

対象範囲に含む機能の一覧は2.2節に示す。

#### 1.3 定義・略語

本サービスの利用者に向けた用語定義は以下の通りである。

- **プロダクト**: ユーザーが投稿する、SaaS等WebサイトへのURL及び紹介内容を含む記事
- **ローンチ**: プロダクトを投稿し公開すること
- **マッチ**: 2つのプロダクト間の対戦
- **サポーター**: プロダクトにUpvoteしたユーザー
- **Upvote**: プロダクトへの支持を示す投票操作。1ユーザー1マッチにつき1回のみ行え、取り消しも可能
- **ディレクトリ**: 勝利したプロダクトが掲載されるカタログ
- **トーナメント**: 勝利したプロダクト同士による、Product of the Week/Yearを選出するための対戦形式
- **再ローンチ**: 一度ローンチしたプロダクトを再度ローンチすること
- **有料プラン**: 都度決済の免除及び再ローンチの間隔制限解除等の特典を付与する定期課金プラン
- **APIキー**: 公開API利用時に発行される認証用の鍵。OpenAPI仕様書配信用のエンドポイントを除く全リクエストに対する認証に用いる

#### 1.4 文書概要

本文書は、ステークホルダー要件、システム要件、機能要件、非機能要件を定義する。

---

### 2. 全体的な記述

#### 2.1 サービスの展望

Launch Stadiumは、Product HuntやUneedの競合として位置づけられる新しいローンチプラットフォームである。サッカーの試合をテーマとし、1対1対戦形式により「必ず半分は勝者になる」仕組みを提供する。

#### 2.2 サービスの機能

- プロダクト登録・投稿機能
- 対戦相手選択機能
- マッチ・対戦機能
- サポーター機能(Upvote)
- ディレクトリ機能
- トーナメント機能
- 再ローンチ機能
- 通知機能
- コメント機能
- 通報機能
- 公開API機能
- 決済・有料プラン機能(トーナメント参加時の都度決済、及び有料プランによる特典提供)
- ユーザー認証・認可機能
- 管理機能

#### 2.3 ユーザークラスと特性

- **プロダクト投稿者**: 自身のプロダクトをローンチし、対戦相手を選択する
- **サポーター**: 気に入ったプロダクトにUpvoteし、応援する
- **プロダクト探索者**: ディレクトリから優れたプロダクトを探す
- **システム管理者**: プラットフォーム全体を管理する

#### 2.4 運用環境

- **クライアント**: モダンWebブラウザ(Chrome, Firefox, Safari, Edge最新版)
- **サーバー**: Cloudflare Workers(Workers Paidプラン)
- **インフラ**: Cloudflare各種サービス

#### 2.5 設計・実装の制約

- FCP(First Contentful Paint)を最優先とした設計
- `HttpOnly`・`Secure`・`SameSite`属性付きCookieによる認証
- GraphQL APIによる通信
- マークダウン形式で保存されているプロダクト説明本文の画面表示
- Cloudflare Workers実行環境の制約(Worker起動時グローバルスコープ処理1秒以内、Paidプランの場合リクエスト毎CPU時間30秒以内が規定値)

#### 2.6 前提と依存関係

- Cloudflare各種サービスの利用可能性
- GitHubリポジトリとの連携
- Stripe(優先の決済処理基盤)及びCreem(二番手の決済処理基盤)の利用可能性
- Cloudflare Email Service(本番環境のメール送信基盤)の利用可能性
- Amazon Rekognition(プロダクト画像の自動モデレーション基盤)の利用可能性
- Sentry(エラートラッキング基盤)の利用可能性
- FlareWarden(外部ステータスページ・死活監視基盤)の利用可能性

---

### 3. ステークホルダー要件

#### 3.1 既存サービスの課題

Product HuntやUneedなど既存のローンチディレクトリは、数々のプロダクトが投稿される中で日毎に1位を決める仕組み。
尊敬する素晴らしいサービスであるが、以下の課題点があると感じている。

1. ランキング上位が正義という仕組み → 1位〜3位ほどの上位にならない限り注目されにくく、成功したとは見做されにくい。
2. ランキング上位を目指すためのローンチ前準備が多すぎる → 無名の新人は作業量でも集客力でも不利。
3. 特定の日に誰がローンチするのか分からない → 不運にも有名会社と同じ日にローンチしてしまうと勝てない。
4. ランキング内に全く違うカテゴリのプロダクトが混ざっている → AIのような流行りのジャンル以外は不利。
5. 頻繁な再ローンチが規約で制限されているか、そうでなくてもコミュニティから忌み嫌われかねない → AI時代の高頻度アップデートと相性が悪い。

#### 3.2 本サービスの解決策

1. ~~ランキング上位が正義という仕組み~~ → 1対1勝負なので、必ず半分は勝ちになる。毎日勝ちプロダクトを量産する仕組み。
2. ~~ランキング上位を目指すためのローンチ前準備が多すぎる~~ → 事前に対戦相手を選ぶこともできるので、実力に見合った相手を選べる。
3. ~~特定の日に誰がローンチするのか分からない~~ → 事前に対戦相手を選ぶこともできるので、対策を練って覚悟を持てる。
4. ~~ランキング内に全く違うカテゴリのプロダクトが混ざっている~~ → 事前に対戦相手を選ぶこともできるので、似たプロダクトを選んで真っ向勝負できる。
5. ~~頻繁な再ローンチが規約で制限されているか、そうでなくてもコミュニティから忌み嫌われかねない~~ → 再ローンチ自体は可能な仕組み。無料枠では再ローンチの間隔に制限を設けるが、有料プランでは制限を受けず勝てるまで毎日投稿できる。

---

### 4. システム機能要件

#### 4.1 ユーザー管理機能

- **FR-U-001**: システムは、ユーザー登録機能を提供しなければならない
- **FR-U-002**: システムは、ロールベースアクセス制御(RBAC)を実装しなければならない
- **FR-U-003**: システムは、ユーザープロフィール管理機能を提供しなければならない
- **FR-U-004**: システムは、ユーザーが自身のアカウントを削除(退会)できる機能を提供しなければならない
- **FR-U-005**: システムは、ユーザーが自身のアクティビティ(プロフィール・投稿プロダクト・コメント・決済履歴等)のデータをエクスポートできる機能を提供しなければならない(DR-003に対応)
- **FR-U-006**: システムは、ユーザー登録時にメールアドレス確認機能を提供し、確認完了まで投稿機能を制限しなければならない
- **FR-U-007**: システムは、メールアドレスによるパスワード再設定機能を提供しなければならない
- **FR-U-008**: システムは、削除リクエスト受付後、DR-002に定める猶予期間内に個人データを完全に削除しなければならない

#### 4.2 プロダクト管理機能

- **FR-P-001**: システムは、プロダクト登録機能を提供しなければならない
- **FR-P-002**: システムは、マークダウン形式によるプロダクト説明入力を受け付けなければならない
- **FR-P-003**: システムは、プロダクト画像のアップロード機能を提供しなければならない
- **FR-P-004**: システムは、プロダクト編集・削除機能を提供しなければならない
- **FR-P-005**: システムは、プロダクトカテゴリ設定機能を提供しなければならない

#### 4.3 マッチング・対戦機能

- **FR-M-001**: システムは、対戦相手選択機能を提供しなければならない
- **FR-M-002**: システムは、マッチリクエスト送信機能を提供しなければならない
- **FR-M-003**: システムは、マッチリクエスト承認/拒否機能を提供しなければならない
- **FR-M-004**: システムは、対戦日時設定機能を提供しなければならない
- **FR-M-005**: システムは、対戦開始・終了の自動制御機能を提供しなければならない
- **FR-M-006**: システムは、勝敗判定機能(Upvote数に基づく)を提供しなければならない

#### 4.4 サポーター機能

- **FR-S-001**: システムは、プロダクトへのUpvote機能を提供しなければならない
- **FR-S-002**: システムは、1ユーザー1マッチにつき1Upvoteのみを許可しなければならない
- **FR-S-003**: システムは、Upvote取り消し機能を提供しなければならない
- **FR-S-004**: システムは、サポート履歴表示機能を提供しなければならない

#### 4.5 ディレクトリ機能

- **FR-D-001**: システムは、勝利したプロダクトのみをディレクトリに掲載しなければならない
- **FR-D-002**: システムは、カテゴリ別フィルタリング機能を提供しなければならない
- **FR-D-003**: システムは、検索機能を提供しなければならない
- **FR-D-004**: システムは、ソート機能(勝利日時、Upvote数等)を提供しなければならない

#### 4.6 トーナメント機能

- **FR-T-001**: システムは、Product of the Week/Year選出のためのトーナメント機能を提供しなければならない
- **FR-T-002**: システムは、トーナメント進出資格判定機能を提供しなければならない
- **FR-T-003**: システムは、トーナメント対戦表示機能を提供しなければならない

#### 4.7 再ローンチ機能

- **FR-R-001**: システムは、勝利まで再ローンチ可能な機能を提供しなければならない。有料プランユーザーは毎日再ローンチ可とするが、他ユーザーは再ローンチを3日間制限されなければならない
- **FR-R-002**: システムは、勝利後14日間の同一プロダクト再ローンチ制限機能を提供しなければならない
- **FR-R-003**: システムは、トーナメント対戦中プロダクトの再ローンチ制限機能を提供しなければならない

#### 4.8 通知機能

- **FR-N-001**: システムは、マッチリクエスト通知機能を提供しなければならない
- **FR-N-002**: システムは、対戦開始・終了通知機能を提供しなければならない
- **FR-N-003**: システムは、勝敗結果通知機能を提供しなければならない

#### 4.9 管理機能

- **FR-A-001**: システムは、管理者用ダッシュボードを提供しなければならない
- **FR-A-002**: システムは、ユーザー管理機能(停止・停止解除等)を提供しなければならない
- **FR-A-003**: システムは、統計情報表示機能を提供しなければならない
- **FR-A-004**: システムは、管理者による不適切なコンテンツの手動モデレーション機能を提供しなければならない
- **FR-A-005**: システムは、プロダクト画像のアップロード時にAmazon Rekognitionによる自動判定を実施し、不適切と判定された画像は公開を保留した上で管理者による手動モデレーション(FR-A-004)の対象にしなければならない
- **FR-A-006**: システムは、管理者がNFR-S-012に基づき記録された監査ログを閲覧・検索できる機能を提供しなければならない

#### 4.10 コメント機能

- **FR-C-001**: システムは、プロダクトへのコメント投稿機能を提供しなければならない
- **FR-C-002**: システムは、プロダクトに紐づくコメントの一覧表示機能を提供しなければならない
- **FR-C-003**: システムは、自身が投稿したコメントの編集機能を提供しなければならない
- **FR-C-004**: システムは、自身が投稿したコメントの削除機能を提供しなければならない
- **FR-C-005**: システムは、管理者による不適切なコメントのモデレーション機能(FR-A-004)を、コメントに対しても適用しなければならない

#### 4.11 公開API機能

- **FR-PA-001**: システムは、公開API利用のためのAPIキー発行機能を提供しなければならない
- **FR-PA-002**: システムは、公開APIが提供するエンドポイントへの全リクエストに対し、`Authorization: Bearer <APIキー>`ヘッダーによる認証を要求しなければならない。ただしOpenAPI仕様書(エンドポイント一覧)配信用のエンドポイントは、APIドキュメント提供ツールが参照するため認証の対象外とする
- **FR-PA-003**: システムは、公開APIについてAPIキー単位で1分あたり60回のリクエスト数制限(レート制限)を実施し、超過時は429 Too Many Requestsを返却しなければならない
- **FR-PA-004**: システムは、公開APIを通じて、自身のプロフィール・投稿プロダクト・コメントのCRUD操作を提供しなければならない
- **FR-PA-005**: システムは、ユーザーが自身のAPIキーを失効・再発行できる機能を提供しなければならない

#### 4.12 決済・有料プラン機能

プロダクトが勝利しトーナメント(Product of the Week/Year)への参加資格を得た場合、都度決済によりトーナメントに参加する方式を基本とする。あわせて有料プランを提供し、有料プラン加入者への都度決済免除(FR-PM-006)、及び再ローンチの間隔・回数制限の解除(FR-R-001)を行う。有料プランの名称・価格体系・請求サイクル等の詳細は本文書作成時点で未確定であり、別途ビジネス側で確定した上で本節を改訂する。

- **FR-PM-001**: システムは、Stripe Checkout Sessions APIで発行したセッションに紐づくStripe Payment Elementによる決済情報入力機能(フォールバック時はCreem Checkoutの決済ページ)を提供しなければならない
- **FR-PM-002**: システムは、Stripe Webhook(フォールバック時はCreem Webhook)により都度支払い・定期課金イベントを受信し、ユーザーのプラン状態へ反映しなければならない
- **FR-PM-003**: システムは、ユーザーが自身の決済履歴及び現在のプラン状態を確認できる機能を提供しなければならない
- **FR-PM-004**: システムは、有料プランを提供する場合、ユーザーが自身の定期課金を解約できる機能を提供しなければならない
- **FR-PM-005**: システムは、プロダクトが勝利しトーナメント参加資格を得た際、有料プラン未加入のユーザーに対し都度決済を要求し、決済完了後にトーナメントへの参加を許可しなければならない
- **FR-PM-006**: システムは、有料プラン加入中のユーザーについて、トーナメント参加資格を得た際の都度決済を免除し、直接トーナメントへの参加を許可しなければならない

#### 4.13 通報機能

- **FR-RP-001**: システムは、ユーザーがプロダクト・コメントを通報できる機能を提供しなければならない
- **FR-RP-002**: システムは、通報理由に著作権侵害を含む選択肢を用意しなければならない(LR-004に対応)
- **FR-RP-003**: システムは、管理者が受け付けた通報を一覧表示し、対象コンテンツの削除または通報の却下を行える機能を提供しなければならない(FR-A-004に対応)

---

### 5. 外部インターフェース要件

#### 5.1 ユーザーインターフェース

- **UI-001**: システムは、レスポンシブデザインを採用しなければならない
- **UI-002**: システムは、shadcn/uiベースの一貫したデザインシステムを使用しなければならない
- **UI-003**: システムは、アクセシビリティ標準(WCAG 2.2 AA)に準拠しなければならない
- **UI-004**: システムは、フォーム入力後にバリデーションフィードバック(エラー表示、送信ボタンの活性制御等)を提供しなければならない
- **UI-005**: システムは、ローディング状態・空状態(データなし)・エラー状態それぞれに対応した表示を提供しなければならない
- **UI-006**: システムは、画像のアップロード時にプレビュー表示、ドラッグ&ドロップ、ファイル形式・サイズ・枚数制限の事前フィードバックを提供しなければならない

#### 5.2 ハードウェアインターフェース

- **HW-001**: システムは、画像アップロード時に、クライアント端末のカメラ・ファイルシステムからのファイル選択インターフェースをサポートしなければならない

#### 5.3 ソフトウェアインターフェース

- **SW-001**: システムは、GraphQL APIを提供しなければならない
- **SW-002**: システムは、公開APIとしてRESTful APIを提供しなければならない
- **SW-003**: システムは、Cloudflare D1(SQLiteベース)をサポートしなければならない
- **SW-004**: システムは、Cloudflare Workers KVによるログインセッション・キャッシュ等のキー・バリューストレージをサポートしなければならない
- **SW-005**: システムは、Cloudflare Durable Objectsによる状態管理(厳密なレート制限カウント等)をサポートしなければならない
- **SW-006**: システムは、Cloudflare Imagesにより、R2に保存済みの画像をリクエストに応じたサイズ・フォーマットに変換し、Exif情報を除去して配信しなければならない
- **SW-007**: システムは、Cloudflare R2を画像・ファイルのオブジェクトストレージとしてサポートしなければならない(NFR-A-008に対応)
- **SW-008**: システムは、Cloudflare Email ServiceのEmail Sendingにより、各種通知メールの配信経路を提供しなければならない(FR-N-001〜003に対応)
- **SW-009**: システムは、Stripe Checkout Sessions API及びStripe Webhook(フォールバック時はCreem API及びCreem Webhook)による決済処理連携を提供しなければならない
- **SW-010**: システムは、Amazon Rekognition APIを用いた画像自動判定処理を提供しなければならない(FR-A-005に対応)

#### 5.4 通信インターフェース

- **COM-001**: システムは、標準的なHTTP/HTTPSプロトコルをサポートしなければならない
- **COM-002**: システムは、TLS 1.2以上による暗号化通信を使用しなければならない

---

### 6. 非機能要件

#### 6.1 パフォーマンス要件

- **NFR-P-001**: システムは、FCP 1.8秒以内を達成しなければならない(Cloudflare Web Analyticsダッシュボードで確認)
- **NFR-P-002**: システムは、同時接続ユーザー数100人をサポートしなければならない
- **NFR-P-003**: GraphQL APIは、クライアント観測で95パーセンタイル300ms以内のレスポンスタイムを達成しなければならない(`@sentry/tanstackstart-react`のBrowser Tracingを利用しリクエスト50回あたり1回計測)
- **NFR-P-004**: システムは、GraphQLにおけるN+1問題を回避するためDataLoaderを使用しなければならない

#### 6.2 セキュリティ要件

- **NFR-S-001**: システムは、`HttpOnly`・`Secure`・`SameSite`属性付きCookieによる認証を実装しなければならない
- **NFR-S-002**: システムは、XSS、CSRF、SQLインジェクション等の主要な攻撃から保護されなければならない
- **NFR-S-003**: システムは、Cloudflare WAFによる保護を実装しなければならない
- **NFR-S-004**: システムは、Web Crypto APIの`crypto.subtle`によりパスワードをPBKDF2-HMAC-SHA512形式で、反復回数10万回かつペッパー付きでハッシュ化しなければならない — OWASPの推奨は21万回以上だが、Cloudflare Workersは[DoS対策として10万回以内に制限してしまう](https://github.com/cloudflare/workerd/issues/1346)ため
- **NFR-S-005**: システムは、機密情報をCloudflare Workersのシークレットで管理しなければならない
- **NFR-S-006**: システムは、ロールベースアクセス制御(RBAC)に加え、所有権ベースのアクセス制御(自ユーザー・全ユーザー・管理者)を全ての操作境界で適用しなければならない
- **NFR-S-007**: システムは、スクリプト実行元を制限するため、リクエスト毎に生成するnonceを用いたコンテンツセキュリティポリシー(CSP)を設定しなければならない。その上で必要なサードパーティスクリプトのドメイン一つ一つをCSPの各種ディレクティブで許可すること
- **NFR-S-008**: システムは、HSTS、X-Content-Type-Options、Referrer-Policy、Permissions-Policy、nonceベースCSPの`frame-ancestors`ディレクティブを含むセキュリティヘッダを全レスポンスに付与しなければならない
- **NFR-S-009**: システムは、全てのユーザー入力に対しZod及び`@hono/zod-validator`による境界検証を実施しなければならない
- **NFR-S-010**: システムは、決済プラットフォームからのWebhook受信時に署名検証を行い、不正な決済イベントを拒否しなければならない
- **NFR-S-011**: システムは、シークレットの誤コミット・push防止を実施しなければならない
- **NFR-S-012**: システムは、管理者によるユーザー・投稿プロダクト・管理者に影響を与える操作(停止・停止解除・モデレーション等)を監査ログとして記録しなければならない
- **NFR-S-013**: システムは、フロントエンド〜APIサーバー間で許可オリジンを明示的に限定したCORSポリシーを適用しなければならない

#### 6.3 可用性要件

- **NFR-A-001**: システムは、99.9%以上の稼働率を達成しなければならない(FlareWardenのステータスページで確認)
- **NFR-A-002**: システムは、依存する外部サービスの障害時でも、プロダクト閲覧やプロフィール表示等の主要な読み取り機能を継続提供できるよう縮退運転を設計しなければならない
- **NFR-A-003**: システムは、主要APIエンドポイントの死活監視を行い、異常検知時に運用担当者へ通知しなければならない
- **NFR-A-004**: システムは、デプロイ作業に起因するサービス停止時間が発生しないようにしなければならない
- **NFR-A-005**: システムは、デプロイ失敗時に直前の正常稼働バージョンへロールバックできなければならない
- **NFR-A-006**: システムは、Cloudflare D1データについて、RPO(目標復旧時点)24時間以内・RTO(目標復旧時間)4時間以内を満たすバックアップ・復旧体制を整備しなければならない
- **NFR-A-007**: システムは、Cloudflare D1データをD1 Time Travelにより過去30日以内の任意の時点へ復旧できなければならない
- **NFR-A-008**: システムは、Cloudflare R2に保存する画像・ファイルについても、NFR-A-006と同等のRPO/RTO目標を満たすバックアップ体制を整備しなければならない
- **NFR-A-009**: システムは、Stripeがプラットフォーム障害やアカウントBAN等の理由で利用できない場合、フォールバックであるCreem API及びCreem Webhookを通じて決済処理を継続できなければならない(FR-PM-001〜006、NFR-S-010に対応)
- **NFR-A-010**: DBマイグレーションを伴うデプロイではExpand/Contractパターンを適用し、スキーマ変更とコードデプロイを分離しなければならない(NFR-A-004、NFR-A-005に対応)

#### 6.4 保守性要件

- **NFR-M-001**: システムは、TypeScriptによる型安全な実装を採用しなければならない
- **NFR-M-002**: システムは、ESLint及びPrettierによるコード品質管理を実装しなければならない
- **NFR-M-003**: システムは、単体テスト、統合テスト共にカバレッジ80%以上を達成しなければならない
- **NFR-M-004**: システムは、GraphQL Code Generatorによる型自動生成を実装しなければならない
- **NFR-M-005**: システムは、Storybookによるコンポーネントカタログを整備し、UIコンポーネントの再利用性と一覧性を確保しなければならない
- **NFR-M-006**: システムは、appsディレクトリ内の実装を変更した際、docsディレクトリ内の関連ドキュメントを同期して更新しなければならない
- **NFR-M-007**: システムは、公開APIについてSwagger UI(OpenAPI形式)によるAPIドキュメントを提供しなければならない

#### 6.5 移植性要件

- **NFR-PO-001**: システムは、ローカル開発環境をDockerコンテナ化し、開発者間の環境差異を最小化しなければならない
- **NFR-PO-002**: システムは、Terraformによるインフラストラクチャ・アズ・コードを実装しなければならない

#### 6.6 スケーラビリティ要件

- **NFR-SC-001**: システムは、水平スケーリング可能なアーキテクチャを採用しなければならない
- **NFR-SC-002**: システムは、静的・動的コンテンツを問わずCloudflareのエッジキャッシュ(CDN)を活用したキャッシング戦略を実装しなければならない

#### 6.7 監視・ログ要件

- **NFR-L-001**: システムは、Cloudflare Analytics / FlareWardenによるメトリクス監視及び死活監視を実装しなければならない
- **NFR-L-002**: システムは、LogTapeによる構造化ログ(JSON形式)を出力しなければならない
- **NFR-L-003**: システムは、Sentryによるエラートラッキング及びパフォーマンストレーシングを実装しなければならない

---

### 7. その他の要件

#### 7.1 データ要件

- **DR-001**: システムは、サービス提供に必要最小限の個人情報のみを収集する「データ最小化原則」に従わなければならない
- **DR-002**: システムは、退会・削除リクエスト後、14日以内に個人データを完全に削除しなければならない
- **DR-003**: システムは、ユーザーが自身の投稿・プロフィール等のデータをエクスポートできる「データポータビリティ」機能を提供しなければならない
- **DR-004**: システムは、決済情報(カード番号等)を自社サーバーに一切保持せずStripe(フォールバック時はCreem)に委任し、PCI DSS準拠範囲を最小化しなければならない
- **DR-005**: システムは、プロダクト画像の配信時にEXIF情報(撮影位置・GPS情報等)を除去しなければならない
- **DR-006**: システムは、データの保存場所(データセンター所在地・リージョン)を明示し、GDPR等が定める国外移転規制に対応しなければならない
- **DR-007**: システムは、ログデータの保持期間を30日と定め、ログ中に含まれる個人情報(IPアドレス・メールアドレス等)をマスキングしなければならない

#### 7.2 法的要件

- **LR-001**: システムは、利用規約及びプライバシーポリシーを明示しなければならない
- **LR-002**: システムは、Stripe(フォールバック時はCreem)により有料プラン・決済機能を提供する際、特定商取引法に基づく事業者情報(事業者名・連絡先・価格・支払方法・返金ポリシー等)を表示しなければならない
- **LR-003**: システムは、ランキング・投票(Upvote)等の表示について、景品表示法及びステルスマーケティング規制の観点から、やらせ投票や不正な実績操作を防止する対策を講じなければならない
- **LR-004**: システムは、ユーザー投稿コンテンツについて、著作権の帰属を明確化し、プロバイダ責任制限法相当の侵害コンテンツ削除請求フローを提供しなければならない
- **LR-005**: システムは、通知メールについて、特定電子メール法(日本)及びCAN-SPAM法(米国)に基づく送信者情報の表示及び配信停止(オプトアウト)機能を提供しなければならない
- **LR-006**: システムは、ユーザーデータを扱うにあたり個人情報保護法、GDPR、CCPA/CPRA(米国カリフォルニア州)、PIPL(中国)、LGPD(ブラジル)等、事業展開する主要地域のプライバシー関連法に準拠しなければならない
- **LR-007**: システムは、表示価格、返金対応、定期購入の自動更新及び解約について、事業展開する各国の消費者保護法に準拠しなければならない
- **LR-008**: システムは、サービス終了時にユーザーデータを返却または削除する方針を利用規約に明記し、これを実施しなければならない
- **LR-009**: システムは、Global Privacy Control(GPC)信号である`Sec-GPC`ヘッダーを検知した場合、CPRA第1798.135条(e)に基づきユーザーによる個別操作なしに「個人情報の販売・共有のオプトアウト」の意思表示として扱わなければならない

#### 7.3 国際化要件

- **I18N-001**: システムは、将来的な多言語対応を考慮した設計を採用すべきである
- **I18N-002**: システムは、UTC基準で日時データを保持しなければならない
- **I18N-003**: システムは、ユーザーのタイムゾーン設定に合わせた日時データを表示しなければならない
- **I18N-004**: システムは、価格表示や決済の通貨はUSDに統一しなければならない
- **I18N-005**: システムは、日付・数値・単位の表示形式をロケール(地域設定)に応じて切り替えなければならない
- **I18N-006**: システムは、将来的にアラビア語・ヘブライ語等を対象言語に含める場合に備え、右から左書き(RTL)レイアウトにも対応しなければならない
- **I18N-007**: システムは、将来の多言語化に備え、i18nライブラリの選定方針及び翻訳文字列の外部リソースファイル化による管理方針を定めなければならない

---

## Special Thanks

### 開発ツール

- Claude Code
- VSCode

### ソースコード管理

- Git
- GitHub

### MCP

- [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) by Google ([Apache License 2.0](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/LICENSE)) ... It acts as a MCP server, giving your AI coding assistant access to the full power of Chrome DevTools.
- [Cloudflare MCP Server](https://github.com/cloudflare/mcp-server-cloudflare) by Cloudflare ([Apache License 2.0](https://github.com/cloudflare/mcp-server-cloudflare/blob/main/LICENSE)) ... MCP servers allowing you to connect to Cloudflare's service from an MCP client and use natural language to accomplish tasks through your Cloudflare account.
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) by Microsoft ([Apache License 2.0](https://github.com/microsoft/playwright-mcp/blob/main/LICENSE)) ... A MCP server that provides browser automation capabilities using Playwright.

### Claude拡張機能

- [Awesome GitHub Copilot](https://github.com/github/awesome-copilot) by GitHub ([MIT License](https://github.com/github/awesome-copilot/blob/main/LICENSE)) ... A community-created collection of custom agents, instructions, skills, hooks, workflows, and plugins to supercharge your GitHub Copilot experience.
- [cc-sdd](https://github.com/gotalab/cc-sdd) by Gota ([MIT License](https://github.com/gotalab/cc-sdd/blob/main/LICENSE)) ... Kiro-style Spec-Driven Development on an agentic SDLC for Claude Code etc.
- [Cloudflare Skills](https://github.com/cloudflare/skills) by Cloudflare ([Apache License 2.0](https://github.com/cloudflare/skills/blob/main/LICENSE)) ... Skills for teaching agents how to build on Cloudflare.
- [Creem Skills](https://github.com/armitage-labs/creem-skills) by Armitage Labs ([MIT License](https://github.com/armitage-labs/creem-skills/blob/main/creem-api/.claude-plugin/plugin.json)) ... Official Creem payment integration skills for AI coding assistants like Claude Code, Cursor, and Windsurf.
- [Developer Kit](https://github.com/giuseppe-trisciuoglio/developer-kit) by Giuseppe Trisciuoglio ([MIT License](https://github.com/giuseppe-trisciuoglio/developer-kit/blob/main/LICENSE)) ... A modular AI plugin system that supercharges your development workflow across languages and frameworks.
- [Everything Claude Code](https://github.com/affaan-m/ECC) by Affaan Mustafa ([MIT License](https://github.com/affaan-m/ECC/blob/main/LICENSE)) ... The agent harness performance optimization system.
- [Hono Skill](https://github.com/yusukebe/hono-skill) by Yusuke Wada ([MIT License](https://github.com/yusukebe/hono-skill/blob/main/README.md#license)) ... Agent Skill for developing Hono applications.
- [Privacy & Data Protection Skills for AI Agents](https://github.com/mukul975/Privacy-Data-Protection-Skills) by Mahipal ([Apache License 2.0](https://github.com/mukul975/Privacy-Data-Protection-Skills/blob/main/LICENSE)) ... 282+ structured privacy & data protection skills for AI agents.
- [Skills](https://github.com/anthropics/skills) by Anthropic ([Apache License 2.0](https://github.com/anthropics/skills/blob/main/skills/frontend-design/LICENSE.txt)) ... Skills that demonstrate what's possible with Claude's skills system.
- [Stripe Claude Plugins Official](https://github.com/stripe/ai) by Stripe ([MIT License](https://github.com/stripe/ai/blob/main/LICENSE)) ... The one-stop shop for building AI-powered products and businesses on top of Stripe.
- [TanStack Agent Skills](https://github.com/DeckardGer/tanstack-agent-skills) by Deckard Gerritsen ([MIT License](https://github.com/DeckardGer/tanstack-agent-skills/blob/main/README.md#license)) ... Comprehensive best practices for building applications with the TanStack ecosystem.
