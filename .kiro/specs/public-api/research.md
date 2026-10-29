# Research & Design Decisions

## Summary

- **Feature**: `public-api`
- **Discovery Scope**: Complex Integration(公開APIとAPIキーの実装は無い。上流の23spec(dev-tooling〜sponsorship)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specはapi-gatewayの公開RESTの骨格(`createRestModule`・`PublicRestRoutes`・`dataEnvelope`・`offsetListEnvelope`・`cursorListEnvelope`・`errorResponses`・`API_KEY_SECURITY`)、backend-platformの`RateLimitCounterClient`・`bindingRateLimit`・`KeyedHasher`、identity-authの`AccountGuard`・`USER_LIFECYCLE_SYNC_HANDLERS`・`SETTINGS_NAV_ITEMS`、directory-discoveryの`DirectoryReader`・`DirectoryCategoryReader`・`ProductPageReader`、match-engineの`MatchDirectory`・`SupporterDirectory`・`UpvoteHistoryReader`、engagementの`CommentReader`・`RatingService`、user-profile-socialの`MyProfileReader`・`ProfileEditor`・`PublicProfileReader`・`UserProfileDirectory`、product-launchの`ProductDirectory`・`MyProductsReader`・`ProductDescriptionEditor`、media-pipelineの`MediaFiles`・`buildImagePath`の上に、APIキーの管理・公開RESTの経路・Swagger UIのページを足す)
- **Key Findings**:
  - 上流の各ドメインspecは、公開APIから同じユースケースを呼べるよう、利用者をセッションではなく引数(`CurrentUser`・`viewer`)で受け取り、bot対策をリゾルバ側に置いている(user-profile-socialの12.7、product-launchの7.8、directory-discoveryの`ProductPageReader`、engagementの`CommentReader`)。公開データの読み取りは閲覧者を未ログイン(`viewer: undefined`)として呼べば、画面と同じ公開範囲(FR-PAPI-009の除外)になる。
  - api-gatewayの`createRestModule`は、`PublicRestRoutes`(`(api) => void`)を登録の順に呼んでから仕様の経路(`/openapi.json`)と`OPTIONS /*`を加える。最初の登録で`api.use('*', ...)`を呼べば、FR-RLMIT-008のIP単位の制限を仕様の配信を含む基準パスの全経路へ掛けられる。経路の認証・権限・回数の制限は`@hono/zod-openapi`の`createRoute`の`middleware`で経路ごとに掛ける。
  - api-gatewayの設計は仕様書の`servers`を定めていない。経路は`/v1`にマウントした子のアプリに登録されるため、仕様書のパスは基準パスを含まず、`servers`が無いとSwagger UIの試行や外部のコード生成がオリジンの直下を呼んでしまう。相対の`servers: [{ url: '/v1' }]`と`info`の説明の追加をapi-gatewayへ依頼し、api-gatewayの改訂1として反映された(上流・後続specへの影響)。
  - `swagger-ui-react`の最新版(5.32.15〜5.33.2)はReact 19の`react-dom`の既定のエクスポートに`createRoot`が無いため実行時に空の画面になる(Gravitee PR #21289)。frontend-platformはReact 19.3.0で固定しているため使えない。`swagger-ui-dist`の5.33系を同一オリジンで配信し、外部ファイルから初期化すれば`script-src 'self'`の厳格なCSPで動いた報告が複数ある(todoless PR #134・Project-mAIstro PR #2041)。`img-src`の`data:`はfrontend-platformのCSPで許可済みである。
  - APIサーバーは画像配信のオリジンを知らない(`IMAGES_ORIGIN`はclient・adminの変数)。公開APIの応答に画像の絶対URLを入れるため、apiに`IMAGES_ORIGIN`を加える。clientは公開APIのオリジンを知らないため、Swagger UIの仕様書の取得と試行のために`PUBLIC_API_ORIGIN`を加え、CSPの`connect-src`へ実行時の許可先として入れる。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を「仮」として採用した。**仮1〜仮4はすべて2026-10-24に開発者が確定した(仮1・仮2は推奨と異なる案B、仮3・仮4は推奨どおり)。** 決定は`requirements.md`の「要件フェーズでの仮決定」にも記録する。roadmapの「Requirement Ambiguities」に本specの担当の行は無い。roadmapは編集しない。

| #   | 論点                                               | 根拠                                                                                                                                                                                                                                                | 選択肢                                                                                                                                                                                                                                                                                       | 推奨と仮の採用                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | 停止中の利用者のAPIキーによる要求                  | FR-PAPI-009(停止されたデータを読み取りから除外し書き込みを拒否)、identity-authの6.4(停止中の利用者はログインできない)・`requireWritableUser`(停止中は`account_unavailable`)、FR-PAPI-008(削除は退会だけ)                                            | (A)全ての要求を403`account_unavailable`で拒否し、キーは残す / (B)公開データの読み取りは許し、書き込みと自分のデータの読み取りだけを拒否する                                                                                                                                                  | 推奨・仮の採用は(A)。停止中の利用者はログインできないため、APIキーによる認証も同じく拒否するのが一貫する。キーを消さないため、解除後にキーを作り直す必要が無い。(B)は停止中の利用者が自動化を続けられ、停止の効果が薄れる **2026-10-24に開発者が確定: 推奨と異なる(B)を採用**(公開データの読み取りは許し、書き込みと自分のデータの読み取りだけを403で拒否する)                                                                                                        |
| 仮2 | 「権限スコープを引き継いだ新規キーの発行」(再発行) | FR-PAPI-006(引き継いだ新規キーを発行)、ページ配置の`/settings/api-keys`(「引き継ぎ再発行」)、briefの「権限を引き継いだ再発行」、FR-RLMIT-005(新規発行操作を1時間に3回)                                                                              | (A)同じ名前・権限スコープの新しいキーを発行し、同じ操作で元のキーを削除する(ローテーション)。発行の回数に数える / (B)元のキーを残し、新しいキーを追加で発行する                                                                                                                              | 推奨・仮の採用は(A)。「再発行」の語と合い、漏洩が疑われるキーを1つの操作で差し替えられる。(B)は「発行」と同じ結果に名前と権限の複写が付くだけで、元のキーの削除を忘れやすい。どちらも新しいキーの発行であるため、FR-RLMIT-005の回数に数える **2026-10-24に開発者が確定: 推奨と異なる(B)を採用**(元のキーを残し、同じ名前・権限スコープの新しいキーを追加で発行する。発行と同じ処理に名前と権限スコープの複写を加えたもので、キーの数に上限は無く、発行の回数に数える) |
| 仮3 | 他の利用者の公開プロフィールの読み取り             | FR-PAPI-003(プロダクト・ローンチ履歴・Upvote・コメント・評価)、briefのDesired Outcome(「公開データ(プロフィール・…)の読み取り」)、プライバシーポリシー骨子の11行目と70行目(公開APIで第三者が公開情報を取得できる。公開情報に公開プロフィールを含む) | (A)「プロフィール」の権限スコープが読み取り以上なら、他の利用者の公開プロフィールも読める / (B)自分のプロフィールだけを読める                                                                                                                                                                | 推奨・仮の採用は(A)。briefとプライバシーポリシー骨子が公開プロフィールを公開APIの対象に含めている。公開プロフィールのページと同じ公開範囲(停止中・退会済みは404)を使うため、新しい公開の範囲は生じない。(B)はFR-PAPI-003の列挙には合うが、briefと食い違う **2026-10-24に開発者が確定(推奨どおり)**                                                                                                                                                                    |
| 仮4 | Swagger UIを組み込むnpmパッケージ                  | NFR-MAINT-007(Swagger UI)、tech-stack.mdの「ドキュメント」(Swagger UIとだけ記載)、ページ配置(`/api-docs`は利用者側)、frontend-platformのCSP(外部のスクリプト・`'unsafe-eval'`を許さない)・React 19.3.0                                              | (A)`swagger-ui-dist`(5.33系。React 18を内蔵した単一の束を、clientのViteで遅延読み込みのチャンクとして同一オリジンから配信する) / (B)`swagger-ui-react`(React 19で実行時に動かない) / (C)`@hono/swagger-ui`(APIサーバーにページを置き、CDNから読み込む。`/api-docs`の配置とCSPの方針に反する) | 推奨・仮の採用は(A)。workerdでは動かさず、ブラウザだけで動く。継続的に保守されている公式の配布物で、厳格なCSPで動いた報告がある。新しいパッケージのため、CLAUDE.mdの規則に従い2026-10-24に開発者が承認して確定し、tech-stack.mdの「ドキュメント」はコントローラーが更新済みである                                                                                                                                                                                     |

### 確認済みのため質問しない事項

- 権限スコープの機能と値: ユーザーデータエクスポート仕様の`account.json`の`apiKeys[].scopes`が、`products`・`launches`・`upvotes`・`comments`・`ratings`・`profile`・`productDescriptions`の7つと、値`none`・`read`・`read_write`(`read_write`は`profile`・`productDescriptions`だけ)を定めている。FR-PAPI-005の「各種投稿機能ごと」と一致する。
- 公開するプロダクトの範囲: 掲載中のプロダクトだけ(ページ配置の「プロダクト詳細の公開範囲」・directory-discoveryの`ProductPageReader`で未ログインの閲覧者に見えるもの)。自分の未掲載のプロダクトは「プロダクトの説明文」の自分のプロダクトの一覧でだけ扱う。
- プロフィール画像の更新: COM-003によりファイルのアップロードはフロントエンドサーバーの中継に限られ、公開APIには画像を受け付ける経路が無い。プロフィールの更新は画像以外の項目に限り、画像は現在の値を保つ。
- 未確認の利用者のキーの発行: FR-USER-006の制限(投稿・評価・コメント・Upvote・フォロー・決済・加入・データエクスポート)にAPIキーの発行は無い。プロフィールの更新(user-profile-socialの4.12)とプロダクトの編集(product-launchの確認済み事項)も未確認を拒否しない。
- 発行の回数の制限と編集: FR-RLMIT-005は「新規発行操作」を数える。名前と権限スコープの編集は新規発行ではない。FR-PAPI-005の「編集時」により、既存のキーの権限スコープの編集を設ける(名前も同じフォームで編集できる)。
- 回数の制限の期間とリセット: backend-platformの`RateLimitCounter`(最初の要求で期間を始め、Alarmで記録を消す)がFR-RLMIT-017・019の「期間の開始から1時間・1分でAlarmによりリセット」をそのまま満たす。
- IP単位の制限の部品: backend-platformのresearch.md(Generalization)が「public-apiのFR-RLMIT-008も`bindingRateLimit`で実装できる」としている。プリフライトは公開APIの操作ではないため数えない(Worker単位の10秒100回の制限は掛かる)。
- 波及処理と`order`: 退会のAPIキーの削除は同期の波及処理(`order`を持たない)で行う。4:21のジョブと非同期の波及処理は無い(物理削除の時点では退会の同期の処理でキーが消えており、発行の書き込みの`CASE`式で退会済み・停止中の利用者のキーを作らない)。roadmapの帯(1800番台)の使用中の値は「—」のままである。
- 新しいパッケージ: `swagger-ui-dist`(仮4)だけである。APIキーの乱数・ハッシュはWeb Crypto API(backend-platformの`KeyedHasher`)、REST・OpenAPIは`@hono/zod-openapi`(api-gateway)、画面はfrontend-platformのshadcn/uiの部品を使う。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する(directory-discoveryと同じ)。

## Research Log

### 上流specの契約

- **Context**: roadmapのShared seams(可視性フィルタ・画面シェル・データエクスポートの出力・ユーザーライフサイクルイベント・Workerのシークレット)とbriefのUpstream。
- **Sources Consulted**: api-gateway・backend-platform・identity-auth・user-profile-social・product-launch・match-engine・directory-discovery・engagement・media-pipeline・frontend-platform・infra-deliveryの`design.md`、各`research.md`の後続specへの申し送り、data-export・launch-readinessのbrief、`docs/GUIDES/service/features/001-user-data-export.md`・`design/002-page-layouts.md`・`design/003-text-and-copy-rules.md`・`legal/003-privacy-policy-outline.md`。
- **Findings**:
  - api-gateway: `PUBLIC_API_BASE_PATH`(`/v1`)・`OPENAPI_DOCUMENT_PATH`・`API_KEY_SECURITY_SCHEME`(`ApiKeyAuth`、Bearer)・`API_KEY_SECURITY`・`PublicApiApp`・`PublicRestRoutes`・`createRestModule`(登録→セキュリティ方式→`doc31`→`OPTIONS /*`→`/v1`へマウント)・`defaultHook`(400`validation_error`)・`ErrorEnvelopeSchema`・`dataEnvelope`・`offsetListEnvelope`(`total`・`page`・`per_page`・`total_pages`)・`cursorListEnvelope`(`has_next`・`next_cursor`)・`errorResponses`・CORS(`*`、メソッドは経路表、`POST`・`PUT`・`PATCH`があれば`Content-Type`)。公開RESTの応答はsnake_case。経路は`composition/rest-routes.ts`への追記だけで加える。
  - backend-platform: `RateLimitCounterClient`(`hit`・`assertWithinLimit`で`AppError(rate_limited, retryAfterSeconds)`)・`CounterRule`・`CounterDecision`(`count`・`remaining`・`resetAt`)・`hashRateLimitKey`・`bindingRateLimit`(`binding`・`key`・`periodSeconds` 10|60・`exclusions`)・`KeyedHasher`(`hashPurpose`、HMAC-SHA512、base64url 86文字)・`AppError`・`toErrorResponse`・`IP_RATE_LIMITER`の`namespace_id`(api 1001/2001/3001、event 1002/2002/3002、client 1003系、admin 1004系)。
  - identity-auth: `AccountGuard`(`requireUser`・`requireWritableUser`)・`CurrentUser`・`SessionView`(`principal()`)・`USER_LIFECYCLE_SYNC_HANDLERS`(集合の更新の文)・`visibleUsers()`・`SETTINGS_NAV_ITEMS`(api-keysは`order` 90)・`AuthenticatedLayout`。`AccountExport`の説明に「`apiKeys`はpublic-apiの出力用の部品が返す」とある。
  - user-profile-social: `ProfileEditor.update(user, ProfileUpdateInput)`(`expectedHandle`・画像のIDを含む全項目)・`MyProfileReader.read`・`PublicProfileReader.find(session, handle)`(`profile`・`redirect`・`not-found`)・`UserProfileDirectory.findSummaries`・`common-lib/profile/profile-input-rules.ts`・`common-lib/url/external-url.ts`。申し送りに「public-apiは`ProfileEditor`・`MyProfileReader`を呼ぶ。bot対策はユースケースに含めない」とある。
  - product-launch: `ProductDirectory`(`resolveHandle`・`findSummaries`)・`MyProductsReader`(`list`・`find`、`MyProductView.hidden`・`listed`)・`ProductDescriptionEditor.update(user, { productHandle, descriptionMarkdown })`(保存の登録口`PRODUCT_SAVE_HOOKS`を呼ぶ)・`markdownTextSchema`の規則。申し送りに「public-apiは説明文の更新は`ProductDescriptionEditor`を、読み取りは`ProductDirectory`を呼ぶ」とある。`updateDescription`の書き込みの条件に非公開化の判定(`notHidden`)は明記されていない。
  - directory-discovery: `DirectoryReader.read({ raw, viewer, now })`(`DirectoryPageView`、`applied`・`totalCount`・`pageCount`・`items`)・`DirectoryCategoryReader.list`・`ProductPageReader.read({ handle, viewer, now })`(`page`・`redirect`・`not-found`、`launches[].rows`)・`decideProductPageAccess`・`DIRECTORY_PAGE_SIZE`(20)・`DIRECTORY_SORTS`・`DIRECTORY_SEARCH_MAX_GRAPHEMES`(50)。申し送りに「public-apiは`DirectoryListingQuery`と`ProductDirectory`で読む」とあり、`DirectoryReader`はこれらの部品で組み立てたユースケースである。
  - match-engine: `MatchDirectory.findMatches`・`SupporterDirectory.listSupporters({ entryId, after, limit 1〜20 })`(確定したマッチの側、`visibleUsers()`)・`UpvoteHistoryReader.read({ userHandle, viewer, first, after, now })`。申し送りに「public-apiは`MatchDirectory`・`SupporterDirectory`・`UpvoteExport`で読む」とある。
  - engagement: `CommentReader.page({ productId, launchId, viewer, after, now })`(閲覧できなければnull)・`RatingService.read({ productId, viewer, now })`・`displayableComment()`・`validRating()`。`ENGAGEMENT_PLATFORM_MODULE`はapiに束縛済み。申し送りに「bot対策と書き込みは公開APIに含めない」とある。
  - media-pipeline: `MediaFiles.findMany`(`MediaFileView.objectKey`は隔離中・削除待ちでnull)・`common-lib/media`の`buildImagePath`・`fallbackFormatOf`・`IMAGE_VARIANTS`。`toMediaImage`はGraphQLの表現層にあり、RESTは同じ規則の写像を自分で持つ。
  - frontend-platform: `ValidatedFrontendEnv`・`PublicRuntimeConfig`・`runtimeSecurityPolicySources`(画像配信・SentryのDSNのオリジン)・`mergeSecurityPolicySources`(`'unsafe-eval'`などを例外にする)・`buildPageHead`・`ErrorState`・`LoadingSkeleton`・`notify`・shadcn/uiの部品(dialog・radio-group・button・input・label)。content-processing(`CLIENT_SITE_ORIGIN`)とpayments(`STRIPE_PUBLISHABLE_KEY`)が、clientの環境の検証と公開設定を同じ手順で拡張している。
- **Implications**: 上流のファイルの変更は、契約で定められた登録箇所への追記(`rest-routes.ts`・`graphql-modules.ts`・`modules.ts`・`user-lifecycle-sync-handlers.ts`・`settings-navigation.ts`・環境の検証・Wrangler設定)と、先例のある環境の拡張に限る。上流の契約の変更(api-gatewayの仕様書の`servers`・`info`・公開するヘッダー、product-launchの説明文の非公開化の判定、backend-platformのキーの伏せ字)は、各specの改訂として反映された。

### APIキーの形式・保存・照合

- **Context**: NFR-SECUR-006・038、FR-PAPI-002、identity-authのトークンの扱い。
- **Findings**:
  - identity-authはセッションと認証系トークンを32バイトのbase64url(43文字)で発行し、`KeyedHasher`のハッシュを一意索引の列に保存して、ハッシュの一致で引いている。HMACの出力は攻撃者が制御できないため、索引による等価比較の時間差から平文を推測できない。
  - 秘密の文字列に固定の接頭辞を付けると、利用者・リポジトリの秘密情報の検査がAPIキーを識別しやすい。
- **Implications**: 平文を`lsk_`と32バイトのbase64url(43文字)の連結(47文字)とし、`hashPurpose('public-api-key')`のハッシュを`api_keys.key_hash`(一意)に保存して、要求ごとにハッシュで引く。平文は発行と再発行の応答でだけ返す。

### 認証と回数の制限の順序

- **Context**: FR-PAPI-002・FR-RLMIT-007・008・NFR-SECUR-039・045、api-gatewayの外部経路の後処理。
- **Findings**:
  - IP単位の制限(Rate Limitingバインディング)は認証より前に掛けないと、無効なキーの総当たりを抑えられない。利用者単位の制限は利用者が決まった後でしか掛けられない。
  - 権限の不足を利用者単位の回数に数えると、誤った設定のクライアントが正常な経路の枠を使い果たす。
  - api-gatewayの後処理(CORS・セキュリティヘッダー)は、Honoの中の429・401にも付く。
- **Implications**: 順序は「IP単位の制限 → Bearerの解析 → キーの照合 → 利用者の状態(`requireWritableUser`) → 権限スコープ → 利用者単位の制限 → 処理」とする。利用者単位の制限の応答に`X-RateLimit-Limit`・`X-RateLimit-Remaining`・`X-RateLimit-Reset`を付ける(`ecc:api-design`)。

### Swagger UIの組み込み

- **Context**: NFR-MAINT-007、ページ配置の`/api-docs`、frontend-platformのCSP。
- **Sources Consulted**: swagger-api/swagger-ui issue #10510・#5817・#7540、Gravitee PR #21289、todoless PR #134、Project-mAIstro PR #2041、agri-saas PR #816。
- **Findings**:
  - `swagger-ui-react`はReact 19で動かない(上記)。
  - `swagger-ui-dist`の`swagger-ui-bundle.js`は依存を内蔵した単一のUMDで、`SwaggerUIBundle`を返す。パッケージの入口(`index.js`)はNodeの`path`を読む`absolute-path.js`も読み込むため、ブラウザ向けには`swagger-ui-dist/swagger-ui-bundle.js`と`swagger-ui-dist/swagger-ui.css`を直接読み込む。
  - 初期化をインラインのスクリプトに書くとnonceかハッシュが要る。frontend-platformのCSPは`'strict-dynamic'`を使わないため、Viteが出力する同一オリジンのチャンクは`script-src 'self'`で読み込める。
  - 仕様書のオブジェクトを`spec`で渡すと、相対の`servers`はページのオリジンに対して解決される。`url`で渡すと仕様書の場所に対して解決されるが、読み込みの失敗を画面の文言で扱いにくい。
- **Implications**: ページは仕様書を自分で取得し(失敗は`ErrorState`)、相対の`servers`を公開APIのオリジンの絶対URLへ置き換えてから`spec`で渡す。`validatorUrl: null`(外部の検証サービスを呼ばない)・`persistAuthorization: false`(キーを保存しない)とする。CSPへの追加は`connect-src`の公開APIのオリジンだけである。

## Architecture Pattern Evaluation

| Option                                              | Description                                                                                           | Strengths                                                              | Risks / Limitations                                                                                     | Notes  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| 上流のユースケースを経路から呼ぶ(採用)              | RESTの経路は上流のapplication層のユースケースを未ログインの閲覧者・キーの持ち主で呼び、表現だけを持つ | 公開範囲・業務ルール・N+1の回避が画面と一致する。briefのApproachどおり | 上流のビューの形が変わると写像を直す必要がある(Revalidation Triggers)                                   | 採用   |
| 上流の照会の部品だけで公開APIの読み取りを組み立てる | `DirectoryListingQuery`・`ProductDirectory`・`MatchDirectory`などから自分で組み立てる                 | 上流のビューの変更に影響されない                                       | 掲載の判定・対戦相手の公開範囲・要約の縮退などを重複して持ち、画面と食い違う                            | 不採用 |
| 公開API専用のWorker                                 | 公開APIを別のWorkerに分ける                                                                           | 障害の分離                                                             | api-gatewayが既に`/v1`の骨格をapiに置いており、上流のユースケースをService Bindings越しに呼ぶ必要がある | 不採用 |

## Design Decisions

### Decision: 公開データの読み取りは未ログインの閲覧者として上流のユースケースを呼ぶ

- **Context**: FR-PAPI-003・009、要件8.8。
- **Alternatives Considered**:
  1. キーの持ち主を閲覧者として渡す — 自分の未掲載のプロダクトが見え、キーごとに応答が変わる
  2. 未ログインとして渡す
- **Selected Approach**: 公開データの経路は`viewer: undefined`(`SessionView`を受け取るユースケースには常に未ログインを返す`ANONYMOUS_SESSION_VIEW`)で呼ぶ。自分のデータは`/v1/me/...`の経路に分ける。
- **Rationale**: 同じURLの応答がキーによらず同じになり、公開範囲を画面の未ログインの閲覧者と一致させられる。
- **Trade-offs**: 自分の未掲載のプロダクトの詳細(スクリーンショットなど)は読めない。必要になれば`/v1/me/products`の項目を増やす。

### Decision: APIキーの認証で`CurrentUser`をidentity-authの`AccountGuard`から得る

- **Context**: `ProfileEditor`・`ProductDescriptionEditor`は`CurrentUser`を受け取る。停止中の判定はidentity-authの部品に集めたい。
- **Selected Approach**: キーの照合で得た利用者IDとキーのIDから、`principal()`が`{ kind: 'authenticated', subjectKind: 'user', subjectId, sessionId: 'api-key:<キーのID>' }`を返す`SessionView`を作り、経路の対象が自分のデータ(`own`)なら`AccountGuard.requireWritableUser`、公開データ(`public`)なら`AccountGuard.requireUser`へ渡す(仮1の確定)。停止中は`own`でだけ`account_unavailable`(403)、利用者が無ければ`unauthenticated`をAPIキーの無効(401)へ変換する。
- **Rationale**: `users`を直接読まず、停止中・退会済みの判定をidentity-authと一致させられる。
- **Trade-offs**: `AccountGuard`がセッションのレコードを`sessionId`で照合する実装に変わると動かない(Revalidation Triggers)。

### Decision: IP単位の制限を最初の経路の登録で掛ける

- **Context**: FR-RLMIT-008は仕様の配信を含む全経路が対象。api-gatewayに中間処理の登録口は無い。
- **Selected Approach**: `PUBLIC_REST_ROUTES`の先頭に`publicApiIpRateLimitRoutes`(`api.use('*', bindingRateLimit(...))`、`OPTIONS`を除外)を置く。新しいバインディング`PUBLIC_API_RATE_LIMITER`(`limit: 60`・`period: 60`)を使い、キーは`public-api:<IP>`とする。
- **Rationale**: api-gatewayの契約(`(api) => void`)の中で実現でき、上流を変えない。
- **Trade-offs**: 登録の順序に依存する。順序をWorkers統合テストで確かめ、`rest-routes.ts`にその旨の注記を置く。

### Decision: 再発行は発行に名前と権限スコープの複写を加えたものとする(仮2)

- **Context**: 開発者が仮2で「元のキーを残し、同じ名前・権限スコープの新しいキーを追加で発行する」(案B)を確定した(2026-10-24)。
- **Selected Approach**: `ApiKeyManagement.reissue`は`ApiKeyStore.findForOwner`で元のキーの名前と権限スコープを読み、発行と同じ処理(`API_KEY_ISSUE_RULE`の回数の制限→乱数とハッシュ→`ApiKeyStore.insert`)で新しいキーを加える。元のキーは変えない。`ApiKeyStore.replace`は作らない。
- **Rationale**: FR-RLMIT-005は同時に有効なキーの数に上限を設けないため、キーが増えることは許される。新しいキーの発行であるため、発行の回数(1時間に3回)に数える。発行と同じ処理を通すため、停止中・退会済みの利用者の`CASE`式もそのまま効く。
- **Trade-offs**: 同じ名前のキーが複数並ぶ。一覧は発行日時で区別し、確認のダイアログで元のキーが残ることと、不要になったら削除することを示す。

### Decision: 説明文の更新の前に非公開化を判定する

- **Context**: 要件12.5(FR-PAPI-009)。product-launchの`updateDescription`の条件に非公開化の判定は明記されていない。画面の編集は非公開化中も許される(product-launchの5.8は予約だけを拒否)。
- **Selected Approach**: `OwnProductDescriptionService`が`MyProductsReader.find`の`hidden`で判定して`AppError(conflict, 'product_hidden')`を返し、そうでなければ`ProductDescriptionEditor`を呼ぶ。判定と書き込みの間に非公開化された場合の取りこぼしを無くすため、`updateDescription`の条件に非公開化の判定を加える改訂をproduct-launchへ依頼し、仮12として反映された。エディターが投げる`product_hidden`・`product_not_found`・`account_unavailable`は変えずに返し、事前の判定も同じ文言を使う。
- **Rationale**: 事前の判定で要件12.5の応答を決め、窓の狭い競合を上流の書き込みの条件で塞ぐ。文言を共有するため、どちらで拒否しても応答が同じになる。

### Decision: 採らなかった案

- APIキーに最終利用日時を記録する: 要求ごとにD1へ書き込みが生じ、FR・画面の要件に無い(YAGNI)。
- 公開APIの書き込みにbot判定を掛ける: APIキーの利用はプログラムからであり、上流のユースケースもbot判定を含めない。
- キーの一覧を全件返す: 発行に上限が無いため件数が増え得る。最大50件のカーソルにした。

## Synthesis

- **Generalization**: 全ての経路は「機能と操作の宣言 → 認証・権限・回数の制限 → 上流のユースケース → 写像」の同じ形である。`definePublicApiRoute`(`createRoute`に機能・操作・`security`・共通のエラー応答・中間処理を加える補助)に集め、経路ごとの差を検証規則と写像だけにした。読み取りと書き込みの2つの回数の規則も、操作の種類で選ぶ1つの部品にした。
- **Build vs Adopt**: REST・OpenAPIは`@hono/zod-openapi`(api-gateway)、回数の制限は`RateLimitCounter`と`bindingRateLimit`(backend-platform)、ハッシュは`KeyedHasher`、読み取りと更新は上流のユースケースを採用した。Swagger UIは公式の`swagger-ui-dist`を採用し、独自の仕様書の表示は作らない。作るのはAPIキーの保存・照合・管理と、経路の写像だけである。
- **Simplification**: 公開APIのための新しい照会の部品・テーブル(キー以外)・非同期の処理を作らない。退会の削除は同期の波及処理1つで済ませ、物理削除の波及処理を持たない。ローンチ履歴はページ分けせず`ProductPageReader`の結果を全件返す(1プロダクトのローンチの数は少ない)。

## Risks & Mitigations

- `swagger-ui-dist`がCSP(`'unsafe-eval'`の要求)やReact 19の環境で動かない — 7.3のE2Eで`e2e/support/security-assertions.ts`のCSP違反の検査を行う。違反が出たら実装を止めて開発者へ報告する(CSPを緩めない、要件15.7)。
- Swagger UIの束(約1.5MB)がclientの初回の読み込みを重くする — `/api-docs`で動的に読み込むチャンクに分け、他のページのバンドルに含めない。
- 上流のビューの形の変更で写像が壊れる — 写像の単体テストと経路のWorkers統合テストで、上流の実装を使って応答の形を確かめる。
- Rate Limitingバインディングの数え方が拠点ごとで近似的である — 要件どおりバインディングを使う。厳密さが要る利用者単位の制限はDurable Objectで行う。
- 平文のAPIキーがログ・Sentryへ漏れる — backend-platformの伏せ字(`authorization`・`token`)とSentryの除外(`authorization`)に加え、GraphQLの応答とRESTの要求本文を記録しない。キーの形の伏せ字はbackend-platformの改訂1が加え、改訂3でSentryの例外・イベント・パンくずのメッセージとトレースのデータにも掛かる。それに頼らず、平文のキーをメッセージに入れない。
- api-gatewayの改訂1の`info`は既定を丸ごと置き換える — `PUBLIC_API_DOCUMENT_INFO`に`title`・`version`・`description`の全てを持たせ、7.2のWorkers統合テストで配信される`info`と`servers`を確かめる。

## References

- [swagger-api/swagger-ui #10510](https://github.com/swagger-api/swagger-ui/issues/10510) — `swagger-ui-react`のReactの版の範囲
- [Gravitee PR #21289](https://github.com/gravitee-io/gravitee-api-management/pull/21289) — `swagger-ui-react`がReact 19で空の画面になる原因
- [swagger-api/swagger-ui #5817](https://github.com/swagger-api/swagger-ui/issues/5817)・[#7540](https://github.com/swagger-api/swagger-ui/issues/7540) — CSPとの相性(古い版の`'unsafe-eval'`、`data:`の画像)
- [todoless PR #134](https://github.com/ChalidNL/todoless/pull/134)・[Project-mAIstro PR #2041](https://github.com/Agent-StrongHold/Project-mAIstro/pull/2041) — `swagger-ui-dist` 5.33系の同一オリジンの配信と厳格なCSP
- [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750) — Bearerトークンと`WWW-Authenticate`
- `.claude/skills/ecc/skills/api-design/SKILL.md` — 応答の形式・状態コード・ページ分け・回数の制限のヘッダー
- `docs/GUIDES/service/features/001-user-data-export.md` — `apiKeys`の項目
- `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md` — 画面の配置と文言

## 仮決定(2026-10-24にすべて確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。要件定義書と上流specに最も整合する案を仮に採用して要件・設計・タスクを作った。**仮1〜仮4はすべて2026-10-24に開発者が確定した。仮1・仮2は推奨と異なる案Bを採用した。** `requirements.md`の「要件フェーズでの仮決定」にも同じ行がある。

| #   | 論点                           | 採用した案                                                                                                                                            | 他の選択肢                                | 影響する箇所                                                              |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| 仮1 | 停止中の利用者のキーによる要求 | 2026-10-24に開発者が確定(推奨と異なる案B): 公開データの読み取りは許し、自分のデータの読み取りと書き込みを403`account_unavailable`で拒否し、キーは残す | 全ての要求を拒否する(推奨していた案A)     | 要件5.2・5.3、`ApiKeyAuthorizer`・`ApiTarget`・`definePublicApiRoute`     |
| 仮2 | 再発行                         | 2026-10-24に開発者が確定(推奨と異なる案B): 元のキーを残し、同じ名前・権限の新しいキーを追加で発行、発行の回数に数え、キーの数に上限なし               | 元のキーを同時に削除する(推奨していた案A) | 要件3.4・4.1・6.5・6.6、`ApiKeyManagement.reissue`・`ApiKeyConfirmDialog` |
| 仮3 | 他の利用者の公開プロフィール   | 2026-10-24に開発者が確定(推奨どおり): 「プロフィール」の読み取り以上で読める                                                                          | 自分のプロフィールだけ                    | 要件11.5・11.6、`GET /v1/users/{handle}`                                  |
| 仮4 | Swagger UIのnpmパッケージ      | `swagger-ui-dist`(2026-10-24に開発者が確定(推奨どおり))                                                                                               | `swagger-ui-react`・`@hono/swagger-ui`    | 要件15、`SwaggerUiViewer`、tasks.mdの7.3                                  |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID      | 内容                                                                                                                                                                         | 根拠     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| FR-PAPI-009 | 「停止された利用者のAPIキーでも公開データの読み取りは許し、その利用者自身のデータの読み取りと書き込みは拒否する」旨を加える                                                  | 仮1(案B) |
| FR-PAPI-006 | 「引き継いで発行した新規キーは元のキーと別に有効で、元のキーは削除されない。新規発行としてFR-RLMIT-005の回数に数える」旨を加える(現在の文言とは矛盾しないが、明記を推奨する) | 仮2(案B) |
| FR-PAPI-003 | 取得できる公開データに公開プロフィールを加える                                                                                                                               | 仮3      |

## 上流・後続specへの影響

- api-gateway(上流、改訂1として反映済み・タスク承認済み): `createRestModule<E extends PlatformEnv>(routes, options?: { readonly info?: { readonly title: string; readonly version: string; readonly description?: string } })`、`doc31`の`servers: [{ url: PUBLIC_API_BASE_PATH }]`、既定の`info`(`Launch Stadium Public API`・`1.0.0`)を渡した`info`が丸ごと置き換えること(改訂1は`servers`と`info`だけで確定した)。本specは`PUBLIC_API_DOCUMENT_INFO`を`composition/api-worker.ts`の呼び出しで渡す(tasks.mdの7.2、保留を解除)。
- product-launch(上流、仮12として反映済み・タスク承認済み): `ProductStore.updateDescription`の結果に`'account-unavailable'`・`'hidden'`が加わり、`ProductDescriptionEditor.update`が`product_hidden`(文言「このプロダクトは公開が停止されているため、説明文を更新できません。」)・`product_not_found`・`account_unavailable`を投げる。本specの`OwnProductDescriptionService`はこれらを変えずに返し、事前の判定の`product_hidden`に同じ文言を使う。
- backend-platform(上流、改訂1・改訂3として確定): 改訂1で`REDACTION_PATTERNS`の先頭に`lsk_[A-Za-z0-9_-]{43}`(`g`フラグ、`[REDACTED]`)が入る。改訂3(開発者が決定)で、Sentryの除去は伏せ字のパターンを例外のメッセージ・イベントのメッセージ・パンくずのメッセージとデータ・トレースのデータに適用し、全て`[REDACTED]`に置き換える。本specはそれに頼らず、平文のキーをメッセージに入れない。
- backend-platform・api-gateway・identity-auth・user-profile-social・product-launch・match-engine・directory-discovery・engagement・media-pipeline(上流): 契約どおりに使い、登録箇所へ追記する。apiの`composition/rest-routes.ts`(`PUBLIC_API_REST_ROUTES`を展開)・`graphql-modules.ts`(`publicApiSchemaModule`)・`modules.ts`(`PUBLIC_API_PLATFORM_MODULE`・`PUBLIC_API_MODULE`)・`user-lifecycle-sync-handlers.ts`(`public-api.api-key-erasure`、`withdrawn`)・`env-schema.ts`と`wrangler.jsonc`(`PUBLIC_API_RATE_LIMITER`・`IMAGES_ORIGIN`)、eventの`composition/modules.ts`(`PUBLIC_API_PLATFORM_MODULE`)、clientの`composition/settings-navigation.ts`(`api-keys` 90)。
- frontend-platform(上流): content-processing・paymentsと同じ手順で、clientの環境の検証に`PUBLIC_API_ORIGIN`(CSPの許可先の形まで検証する)を加え、`PublicRuntimeConfig.publicApiOrigin`(client専用、adminは`undefined`)へ渡し、`runtimeSecurityPolicySources`の`connectSrc`に値があれば加える。エントリの許可先の欄と環境のキーの対応(`imgSrc`→`IMAGES_ORIGIN`・`connectSrc`→`SENTRY_DSN`)は変えない。
- infra-delivery(上流、改訂1として提供): design.mdのSupporting Referencesの「ホスト名から導かれる変数の値」の表に、apiの`IMAGES_ORIGIN`とclientの`PUBLIC_API_ORIGIN`の行(3環境の値)が入る(cross-spec reviewの指摘による依頼)。本specはその値をWrangler設定に書く。2つの変数の値と、`PUBLIC_API_RATE_LIMITER`の`namespace_id`(api 1005・2005・3005)を`docs/onboardings/project-values.md`の表へ加える。新しいシークレットは無い。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「—」のままである(4:21のジョブ・非同期の波及処理が無い)。Requirement Ambiguitiesに本specの担当の行は無い。本specはroadmapを編集しない。
- data-export(後続): `PUBLIC_API_PLATFORM_TYPES.ApiKeyExport`の`listByUser(userId)`で`account.json`の`apiKeys`を組み立てる。eventに束縛済みである。
- launch-readiness(後続): 公開APIの負荷・回数の制限の確認、prodの`PUBLIC_API_ORIGIN`の値の確認、`/api-docs`のアクセシビリティの確認を行う。

## 要件のレビュー(2026-10-24)

- 機械的な確認: 17の要件の見出しがすべて数字のIDを持ち、111件の受け入れ基準がすべてEARSの形式(`When`・`If`・`While`・`Where`・`The … shall`)である。技術名は要件定義書の用語(APIキー・Bearer・`Authorization`・`WWW-Authenticate`・CORSのヘッダー名・OpenAPI・Swagger UI)と、プロジェクトの規約(`<time datetime>`・snake_case・ISO 8601)に限った。
- 1回目の判断のレビューで、(1)仕様書の`servers`の扱いという実装の詳細を要件14から外し、(2)停止中の管理画面の操作の範囲(要件3.7・3.8・6.10)を食い違わないようにそろえた。2回目で問題は無かった。
- 要件定義書・サービス仕様で決まらない論点は仮1〜仮4として記録し、要件の範囲の推測は加えていない。

## 参照したスキル

- cc-sddの`kiro-spec-init`・`kiro-spec-requirements`・`kiro-spec-design`・`kiro-spec-tasks`の規則とテンプレート。
- `ecc:api-design`(応答の形式・状態コード・ページ分け・`X-RateLimit-*`・`Retry-After`)。CLAUDE.mdの指示により、RESTの応答形式と検証失敗の状態コード(api-gatewayの400`validation_error`)の正とした。

## 設計のレビュー(2026-10-24)

- 機械的な確認: 要件の111件の受け入れ基準の番号がすべて追跡表にあることを、番号の境界を区切った検索で確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある。
- 1回目の判断のレビューで、(1)サポーターの照会の上限(20件)を超える読み取りを書いた記述を、20件で続きの有無を判定する形に直し、(2)再発行の一括の書き込みの記述の入れ子のコードの表記を直した。2回目で問題は無かった。
- タスクのサニティレビューの指摘で、経路ごとのスキーマ・写像のファイルを分け(並行のタスクが同じファイルを書かない)、プロダクトのハンドルの解決と旧ハンドルの302の共用の補助`product-resolution.ts`を加え、追跡表の写像の名前(`UpvoteMappers`)と経路の数(13)を直した。
- 境界の確認: 公開範囲と業務ルールは上流のユースケースに任せ、本specは表現と写像だけを持つ。上流のテーブルへは書き込まず、`users`は外部キーと`visibleUsers()`の条件だけに使う。上流の契約の変更が要るのはapi-gatewayの仕様書の`servers`・`info`だけで、改訂までタスクを保留する。

## タスクの計画の検証(2026-10-24)

- `/kiro-spec-tasks public-api -y`の手順で、要件と設計を承認し(`-y`による自動の承認)、タスクの計画の下書きを作った。要件の111件の受け入れ基準の番号がすべてタスクにあることを機械的に確かめた。
- タスクのグラフのサニティレビューを2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
- 1回目の判定はNEEDS_FIXES(必須5件・軽微7件)だった。指摘は、(1)apiの束縛のモジュールの作成と各部品の束縛の担当が決まっておらず、並行のタスクが同じファイルを書き、束縛の無い波及処理の登録で退会の経路が壊れ得る(2.3で空のモジュールを作り、各タスクが自分の束縛を追記し、5.3・5.5・5.6の束縛は5.7でまとめ、3.3の(P)を外した)、(2)エラーコードの表の担当(4.2が全て作る)、(3)(P)のタスクの`_Depends:_`の欠け(2.1・2.2・6.2・6.3・8.2)、(4)キーの管理の操作のログの担当(3.2)、(5)画面の`api_key_not_found`・`account_unavailable`の扱いの担当(6.5)である。軽微の指摘のうち、プロダクトのハンドルの解決と302の共用の補助(5.1、design.mdに`product-resolution.ts`)、境界の追記(1.5・2.2・7.1)、ルートの木の生成し直しの注記(7.1)、1.4の並行化、6.4の分割(6.4の一覧と1件・6.5の画面とルート)とStorybook、design.mdの`UpvoteMappers`と経路の数を直した。5.2の分割と3.2の並行化は、作業量が上限の内に収まり束縛のモジュールを共有するため変えていない。
- 2回目の判定はPASSだった。軽微の指摘3件のうち、5.3が302の補助を使うことと6.4の1.1への依存を直した。タスクを承認した。

## 上流の改訂の反映(2026-10-24、コーディネーターの指示による)

- api-gatewayの改訂1(`createRestModule`の`options.info`・`servers`。当時の案にあった`PUBLIC_API_EXPOSED_HEADERS`は後に開発者の確定で外れた)、backend-platformの改訂1(`REDACTION_PATTERNS`の`lsk_`)、product-launchの仮12(`updateDescription`の`'hidden'`と`ProductDescriptionEditor`のエラー)が反映された。
- design.mdの「上流への影響」を依頼から提供済みへ改め、`OwnProductDescriptionService.update`がエディターのエラーを変えずに返すことと、事前の判定の`product_hidden`の文言をproduct-launchと同じにすることを書いた。`PUBLIC_API_DOCUMENT_INFO`が既定の`info`を丸ごと置き換える前提で全項目を持つことを書いた。
- tasks.mdの7.2の保留を外して契約に合わせ、7.3はswagger-ui-distの承認(仮4)まで保留のままとした(後に仮4の確定で解除)。
- タスクの計画を、既存の`tasks.md`を引き継ぐ形で`/kiro-spec-tasks public-api -y`の手順で検証し直した。新しいサブエージェントによる独立した確認(independent)を2回まで行った。1回目はNEEDS_FIXES(必須1件: 7.2の説明に載せる回数の上限のうちIP単位の60回が定数として無い。2.3にIP単位の制限の定数を加え、4.3でWrangler設定と照合し、7.2が3つの上限を明示する形にした)。軽微の指摘(5.6の`product_not_found`のそのままの返却、4.2の`product_hidden`の文言の一致の確認、1.1の前提への上流の改訂の項目、7.2と5.7の確認の重複の解消、8.1の`Access-Control-Expose-Headers`)も直した。2回目はPASSで、軽微の文言の指摘3件(design.mdのファイル構成の注記、apiのWrangler設定の検査のテストのパス、2.3の`Retry-After`の記述)を直してタスクを承認し直した。変更したタスクは1.1・1.4・2.3・4.2・4.3・5.6・5.7・7.2・8.1・9.2である。

## cross-spec reviewの指摘による修正(2026-10-24)

- 振る舞いを変えない整合の修正のため、改訂の番号は付けない(cross-spec reviewの指摘による)。
  - GraphQLのスキーマモジュールのルート型を、api-gatewayの規則(`extend`を使わない)に合わせて`type Query`・`type Mutation`に直し、tasks.mdの3.4に明記した。
  - media-pipelineのDIの識別子を`MEDIA_TYPES`に直した。
  - design.mdの「上流への影響」に、infra-deliveryの改訂1が提供する「ホスト名から導かれる変数の値」の表のapiの`IMAGES_ORIGIN`・clientの`PUBLIC_API_ORIGIN`の行を加え、Revalidation Triggers・tasks.mdの1.1の前提・1.4・1.5に値の出典を加えた。
- 変更したタスクの部分を、新しいサブエージェントによる独立した確認(kiro-spec-tasksの基準)で検証し、1回目の判定はPASSだった。タスクの承認を保つ。

## 仮4の確定(2026-10-24、開発者の承認)

- 開発者が仮4(`swagger-ui-dist`の5.33系を利用者側のフロントエンドサーバーから同一オリジンで配信する)を承認し、確定した。tech-stack.mdの「ドキュメント」のSwagger UIの行はコントローラーが`swagger-ui-dist`へ更新済みで、本specは変えない。仮1〜仮3はこの時点では確認待ちで、同日に開発者がすべて確定した(「開発者の確定の反映」)。
- requirements.mdの仮4の行を確定とし、design.mdから保留の文言を外した。tasks.mdの7.3の保留を外し、clientに`swagger-ui-dist`の5.33.xを`--exact`で完全に固定して入れる形にした。導入先がclientだけで、`coding/002-dependency-versions.md`の主要パッケージの一覧の基準(アプリ間で版が食い違うと動かない・組み合わせの範囲が狭い)に当たらないため、一覧には加えない。9.2の報告から保留中のタスクを外した。
- 変更した部分のタスクの計画を、新しいサブエージェントによる独立した確認(independent)で2回まで検証した。1回目はNEEDS_FIXES(必須2件: 1.3とresearch.mdの「仮決定」の節に仮4を確認待ちとする文言が残っていた)。軽微の指摘(requirements.mdの見出しと列名、7.3のバンドルの確認の方法、design.mdのE2Eの外部オリジンの確認、8.1の7.3への依存)とあわせて直した。2回目はPASSで、軽微の2件(本節の前の記録への解除の注記、design.mdのファイル構成の注記)を直してタスクを承認し直した。変更したタスクは1.3・7.3・8.1・9.2である。

## 開発者の確定の反映(2026-10-24)

- 仮1(推奨と異なる案B): 経路に対象(`public`・`own`)を設け、停止中の持ち主のキーは公開データの経路で処理し、`/v1/me`の下の自分のデータの4経路で403`account_unavailable`にした。`ApiKeyAuthorizer`は対象で`requireUser`・`requireWritableUser`を選ぶ。要件5.2・5.3、design.mdの`ApiTarget`・`definePublicApiRoute`・`apiKeyAuth`・経路の表の注記・テスト・セキュリティ、tasks.mdの2.1・4.1・4.2・5.2〜5.7・9.1を直した。
- 仮2(推奨と異なる案B): 再発行は元のキーを残し、発行と同じ処理に名前と権限スコープの複写を加えたものにした。FR-RLMIT-005によりキーの数の上限は無く、発行の回数(1時間に3回)に数える。`ApiKeyStore.replace`を削った。要件3.4、design.mdの発行と再発行の流れ・`ApiKeyManagement.reissue`・ストア・確認のダイアログの文言・データモデル・テスト、tasks.mdの1.3・3.1・3.2・6.3を直した。
- 仮3・仮4: 推奨どおり確定した。
- api-gatewayの改訂1は`servers`と`info`だけで確定し、`Access-Control-Expose-Headers`は入らない。design.mdとtasks.mdの5.7・8.1から外した。
- backend-platformの改訂3で、Sentryの伏せ字が例外・イベント・パンくずのメッセージとトレースのデータに広がった。design.mdの「上流への影響」と9.2の報告の文言を直した。
- user-profile-socialの仮3(外部Webサイトは10件まで)は、本specが`common-lib/profile`の上限の定数を使うため、仕様の文言の変更は要らない。
- 本specに開発者の確認を待つ論点は残っていない。
- 確定の反映の後、変更した部分を新しいサブエージェントによる独立した確認(independent)で、設計のレビューの関門とタスクのグラフのサニティレビューの両方について2回まで検証した。1回目は設計がNEEDS_FIXES(必須5件: スキーマの注記の「再発行」の物理削除、発行と再発行の流れの順序、design.mdに残った`Access-Control-Expose-Headers`の記述、research.mdのSentryの伏せ字の範囲と改訂1の内容)、タスクはPASSだった。軽微の指摘(追跡表の5.2・5.3、`ApiTarget`の注記、他人のキーの照会のテスト、E2Eの再発行の確認、3.2の回数の消費、requirements.mdの見出し)とあわせて直した。2回目は設計・タスクともPASSで、設計とタスクを承認し直した。変更した要件は3.4・5.2・5.3(と5の目的・仮の表)、変更したタスクは1.1・1.3・2.1・3.1・3.2・4.1・4.2・5.2・5.3・5.4・5.5・5.6・5.7・6.3・8.1・9.1・9.2である。

## api-gatewayの実装の反映(2026-10-27、開発者の決定)

- api-gatewayの実装では、公開RESTの経路の登録箇所`REST_ROUTES`の型が`readonly PublicRestRoutes<Env>[]`(生成された`Env`)になった。Honoの環境の型引数は不変のため、`PublicRestRoutes<ApiEnv>`の経路は登録箇所へ加えた時点で型検査に失敗する。開発者の決定で、本specの設計をapi-gatewayの実装に合わせた。
- design.mdの`PublicApiIpRateLimit`の`publicApiIpRateLimitRoutes`を`PublicRestRoutes<Env>`に改め、型引数の理由を説明に加えた。`bindingRateLimit`の`binding: (env) => env.PUBLIC_API_RATE_LIMITER`は、Wrangler設定へ`PUBLIC_API_RATE_LIMITER`を加えて型を再生成した`Env`で解決される。要件・タスクは変えていない。

## frontend-platformの実装で確定した契約の反映(2026-10-28、開発者の決定)

- frontend-platformの実装と最終検証の後、開発者の決定(frontend-platformのタスク10.4)で、下流specの設計をfrontend-platformの設計の「実装で確定した契約による発火と影響を受ける下流spec」の表に合わせた。振る舞いを変えない整合の修正のため、改訂の番号は付けない。要件は変えていない。
- 操作の置き場所と生成物: clientの操作を`src/graphql/operations/public-api/`の1ファイル1操作の`.graphql`(操作名は`Client`で始める)にし、`graphql()`を呼ばず、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読むとした(design.mdのDependency DirectionとFile Structure Plan、tasks.mdの6.1)。
- Zodの値の読み込み元とフォーム部品の形: `api-key-form-schema.ts`はZodの値を`lib/utilities/validation/zod.ts`の`z`から読み、フォームを`useAppForm<TInput, TOutput>(schema, { defaultValues })`と`AppForm`(`serverFieldPrefix="input"`・必須の`onSubmitError`)で作り、想定外の失敗の文言を`errorMessageOf`で選ぶとした(design.mdのAllowed Dependencies・ApiKey画面の部品、tasks.mdの6.2)。
- `SecurityPolicySources`と環境のキー: frontend-platformのエントリは、`runtimeSecurityPolicySources`の欄を1つの欄に1つの環境のキーの対応(`imgSrc`→`IMAGES_ORIGIN`・`connectSrc`→`SENTRY_DSN`)で確かめ、不正な値のキー名をログへ出す。`PUBLIC_API_ORIGIN`を`connectSrc`へ加えると、`connectSrc`の不正が`SENTRY_DSN`と`PUBLIC_API_ORIGIN`のどちらに由来するかを対応から決められない。
  - 案A(採用): `PUBLIC_API_ORIGIN`を環境の検証でCSPの許可先の形まで確かめ、形に合わない値を環境の検証の失敗(キー名`PUBLIC_API_ORIGIN`)にする。`connectSrc`の検査で不正になる値は`SENTRY_DSN`に由来するものに限られ、エントリの対応を変えずに済む。
  - 案B: エントリの対応を環境のキーごとの検査(1つのキーに1つの欄)に改める。frontend-platformの確定した契約の形を変えるため採らない。
  - design.mdのModified Files・ClientEnvExtension、tasks.mdの1.5、本書の「上流への影響」を直した。

## フォームの描かない値と無効の欄の扱いの反映(2026-10-28、開発者の判断)

- **状態**: frontend-platformの最終検証の後の第2回の判断16・25〜28・30〜36(2026-10-28〜29)を、frontend-platformのタスク11.8として本specの設計とタスクへ反映した。受け入れ基準は変えていない。
- **Context**: frontend-platformの`SubmitButton`は、`root`以外の欄のエラー(サーバーの欄のエラーを含む)が1つでも残る間は無効になる。入力欄を描かない値をフォームのスキーマの入力に含めると、その値へのサーバーの詳細が利用者の直せない欄のエラーになり、送信ボタンが無効のまま残る。`applyServerFieldErrors`は、欄をまとめた値(配列でないオブジェクト)の経路と、`FormField`の`disabled`で無効にした欄の詳細を欄に付けず`onSubmitError`の`unmatched`へ渡し、`useAppForm`は検証の前に無効の欄の値を除く。無効の欄の値は`onSubmit`へ渡す値から外れ、無効になり得る欄はスキーマで任意(`.optional()`)にする。`FormField`は後から無効にした欄のエラーを消し、`useAppForm`は渡されたスキーマが変わると検証し直し、`applyServerFieldErrors`は描かれていない欄の詳細もフォーム全体の失敗にする。全欄が無効のフォームは`SubmitButton`の`disabled`で送信ボタンを無効にする。
- **決定**: frontend-platformの影響の表の水平展開として確かめた。`ApiKeyFormDialog`のフォームの値は`ApiKeyInput`と同じ形で、編集するキーの`id`はスキーマの入力に含めず`onSubmit`で`updateApiKey`の引数に足すことを明記した。停止中の発行・編集・再発行の無効は操作のボタンの無効で、フォームの欄を無効にする設計は無い。
- **変えた箇所**: design.mdの`ApiKeyFormDialog`、tasks.mdの6.2。
