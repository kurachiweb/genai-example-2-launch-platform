# Research & Design Decisions

## Summary

- **Feature**: `identity-auth`
- **Discovery Scope**: New Feature(認証の実装は無い。backend-platform・api-gateway・email-delivery・frontend-platformの設計・タスクは承認済みで実装は未着手であり、本specはその契約の上に利用者の認証・アカウント・ライフサイクルを新設する。セキュリティに直結するため完全な調査を行った)
- **Key Findings**:
  - api-gatewayの`GraphQLContext`は要求のヘッダーを持たず、frontend-platformの中継項目(`FORWARDED_BROWSER_HEADERS`)も`user-agent`を含まない。セッションに端末情報を保存する(Q6)には、両specのコードに互換を保った追加が要る。本specのタスクとして行い、両specの再検証の対象にする。
  - D1の`db.batch()`は文を順に1つのトランザクションで実行するが、前の文の結果で後の文を変えられない。状態の遷移と後続specの同期の波及処理を1つの一括の書き込みに含める(Q5)には、「事前条件を満たさなければ制約違反になる挿入」を先頭に置き、競合した場合は全体を取り消す方式が要る。
  - DISIFYはAPIキーなしでも使えるが、匿名の利用は送信元IPごとに毎分30回・1日1,000件に制限される。Workersの送信元IPは他の利用者と共有され得るため、無料アカウントのAPIキー(アカウントごとに毎分60回・1日10,000件)を任意で使えるようにする(仮6)。
  - 退会日の業務日付から13日後の業務日付の日次バッチで物理削除を始めると、論理削除からの経過は12日4時間〜13日4時間21分となり、14日の期限まで少なくとも19時間39分の再試行の余地が残る。経過時間(13×24時間)で判定すると余地が最短1分になる。
  - OTPAuth 9.5.2の`TOTP.validate`は照合した時間窓の差(`delta`)を返す。`TOTP.counter`と合わせて使用済みの時間窓を記録すれば、同じ認証コードの再使用を拒否できる。uqr 0.1.3の`encode`はQRコードのセルの行列を返すため、ReactのSVG要素で描画でき、生のHTMLの挿入(NFR-SECUR-040)を避けられる。

## 要件フェーズ前の確認事項(2026-10-18)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                                         | 根拠                                                                                                                           | 回答(2026-10-18)                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | ログイン試行の失敗回数の戻し方               | roadmapのRequirement Ambiguities・brief・NFR-SECUR-022・FR-RLMIT-011・012                                                      | 推奨案。クールダウン終了時はロックを解くだけにし、失敗が続く限り1→2→4…→300秒と伸ばす。失敗回数はログイン成功時と、最後の失敗から24時間失敗が無いときに消す。FR-RLMIT-012は「終了時はロック解除のみ」と読み替え、要件定義書の改訂が要る旨を報告する。1つのメールアドレスへの総当たりは最終的に1時間あたり約12回に抑えられる |
| Q2  | ログイン試行のメールアドレス単位の記録のキー | roadmapのRequirement Ambiguities・brief・FR-RLMIT-020・NFR-SECUR-022・DR-001・backend-platformの`hashRateLimitKey`             | 推奨案。要件の記載漏れとして扱い、`hashRateLimitKey`でハッシュ化する。前後の空白を除いて小文字化してから数える。要件定義書の改訂が要る旨を報告する                                                                                                                                                                         |
| Q3  | HIBP・DISIFYを使えないとき                   | brief Constraints・NFR-SECUR-026・FR-USER-014・SW-020・SW-021・NFR-AVAIL-002                                                   | 推奨案。両方とも処理を続ける。HIBPが使えないときは照合を省いて受け付け、警告をログとSentryに残す。DISIFYが使えないときはメールアドレス確認を完了させ、判定結果を「未判定」として保存し、後から非同期で判定し直す。判定結果は「使い捨て・通常・未判定」の3値                                                                |
| Q4  | 規約同意の記録                               | brief Constraints・FR-USER-002・legal-pagesのbrief・利用規約の大枠の章18・準拠方針の前提                                       | 推奨案。同意した日時だけを記録する。版はlegal-pagesの改訂履歴の公開日時と突き合わせれば特定できる                                                                                                                                                                                                                          |
| Q5  | 波及処理の実行方式                           | roadmapのShared seams・FR-USER-019・FR-VOTE-008・FR-GAME-015・FR-PPLAN-005・012・FR-ADMUG-048・backend-platformのQ7            | 推奨案。同期と非同期の2段階。同期の処理はD1の更新を状態の変更と同じ`db.batch`に含める。非同期の処理はStripe・R2・キャッシュ・検索索引への処理をQueuesで行う                                                                                                                                                                |
| Q6  | 端末情報の表示                               | FR-USER-017・プライバシーポリシーの大枠(User-Agent)・CLAUDE.md(新規パッケージ)・frontend-platformの`FORWARDED_BROWSER_HEADERS` | 推奨案。`bowser` 2.14.1(MIT、依存なし)でブラウザとOSを表示する。User-Agentはセッションに保存し、表示時に解析する。中継する項目へ`user-agent`を加える変更が要る(frontend-platformの再検証の対象)                                                                                                                            |
| Q7  | 重要操作の本人確認                           | FR-USER-007・012・016・018・019・NFR-SECUR-031                                                                                 | 推奨案。退会・メールアドレス変更の要求・TOTPの無効化・リカバリコードの再発行で現在のパスワードを求め、TOTPが有効ならコードかリカバリコードも求める。全セッションを削除したうえで、ログイン中に操作した端末にだけ新しいセッションを発行する。退会と未ログインのパスワードリセットは全セッション削除のみ                     |
| Q8  | TOTP紛失時の復旧                             | FR-USER-018・NFR-SECUR-033・034・FR-USER-019・FR-USER-013                                                                      | 推奨案。復旧手段を設けない。リカバリコードを唯一の予備手段にし、保管を強く促し、設定画面に残数を表示する                                                                                                                                                                                                                   |

### 提示した選択肢(記録)

- Q1: 回数を残しロックだけ解除(採用) / 回数は戻し段階は残す(1時間あたり約72回と緩い) / 要件の文言どおり(止まる時間は常に1秒)
- Q2: 小文字化してハッシュ化(採用) / 入力どおりにハッシュ化 / 平文で保持
- Q3: 両方とも処理を続ける(採用) / HIBPは拒否(503)・DISIFYは続ける / 両方とも拒否(503)
- Q4: 同意日時だけ記録(採用) / 同意した版も記録(空を許す列と「現在の版」の差し込み口) / 何も記録しない
- Q5: 同期と非同期の2段階(採用) / すべて非同期 / すべて同期
- Q6: `bowser`でブラウザとOSを表示(採用) / `ua-parser-js` 1.x(2.xはAGPL-3.0) / 自前で簡易に判定 / User-Agentをそのまま表示
- Q7: 再確認あり・操作端末は継続(採用) / 再確認あり・全端末ログアウト / 再確認なし・操作端末は継続 / 要件の文言どおり
- Q8: 復旧手段を設けない(採用) / メールで期間をおいて解除(7日待機・待機中に通知・正規ログインで取消) / 問い合わせで運営が解除

### 確認済みのため質問しない事項

- TOTPとQRコードのパッケージ: tech-stack.mdでOTPAuthとuqrに決定済み。`otpauth` 9.5.2(2026-09-03公開、MIT、`@noble/hashes` 2.4.0に依存)、`uqr` 0.1.3(2026-04-03公開、MIT、依存なし)。どちらもworkerdで動く。版の固定とtech-stack.mdへの記載は導入する実装タスクで行う。
- パスワードのハッシュ化: NFR-SECUR-004・005がWeb CryptoのPBKDF2-HMAC-SHA512・10万回・固定ペッパー・16バイト以上のソルトを指定している。パッケージは不要。固定ペッパーを`HASH_PEPPER`と共用するかは設計で決める(後述「Design Decisions」)。
- HIBPとDISIFY: tech-stack.mdでHIBPのrange APIとDISIFY APIに決定済み。SHA-1は`crypto.subtle.digest`、APIは`fetch`で呼ぶ。SDKは不要。
- Turnstile: ウィジェットは`@marsidev/react-turnstile` 1.6.1(frontend-platformのQ6)。サーバー側はbackend-platformの`BotVerifier`・`turnstileGuard`(無効なら403、届かなければ503)。
- 認証系のメール: テンプレートは`@react-email/*`(email-deliveryのQ5)。送信元は表示名「Launch Stadium」の`noreply@`アドレス(同Q6)。トランザクションメールで抑止リストの対象外(同Q1)。件名は文言規則で決定済み。
- セッション: 保存先はD1、有効期限はアイドル14日・絶対90日(NFR-SECUR-029・030)。期限切れは日次バッチで削除(DR-019)。識別子は32バイト乱数のbase64url 43文字(api-gatewayの`SESSION_TOKEN_PATTERN`)。Cookie名は`__Host-ls_session`と`__Host-ls_admin_session`(frontend-platform)。
- 認証系トークン: 有効期限・ハッシュ化・失効・後始末はNFR-SECUR-035〜037とDR-020で決定済み。
- 再送とリセット要求の回数制限: backend-platformの厳密カウンタ(固定期間、Alarmで消去、`HashedRateLimitKey`)で表せる(FR-RLMIT-001・014)。数え方は申し送りに従い、メールの種類ごとに初回も含めて数え、メールアドレス変更の確認メール(FR-USER-007)も対象にする。
- CSRF・中継・Cookie属性: frontend-platformの契約で実装済み。CSRF検証はGET・HEAD・OPTIONS以外の全要求。
- 停止中のユーザーのセッション: ページ配置「停止中の本人には自分のプロフィールに帯を表示」、文言規則「停止中アカウント(パスワード合致時)」から、停止時に既存セッションは消さず閲覧だけを許し、新しいログインは停止中の文言で拒否する。FR-USER-026とも整合する。
- 退会の取り消しと再登録: 退会アカウントはログイン不可(FR-USER-026)のため取消機能は持たない。メールアドレスは退会直後から再登録できる(FR-USER-013)。ハンドルは物理削除まで他人に使わせない(FR-USER-003)。物理削除は論理削除から13日後の4:21バッチ(日次タイムライン)。
- 設定ページのシェルの範囲: シェル(登録された項目だけを並べるナビゲーション)と`/settings/account`・`/settings/security`を作る。`/settings/profile`などは各specが登録する。未実装ページの仮表示は不要。
- 規約ページのURL: `/terms`・`/privacy`・`/legal`はページ配置で確定している。
- ログイン画面の形: モックアップのログインダイアログは「ログインが必要です」の案内で、ログインと登録の本体は`/auth/*`のページ(ページ配置)。
- 管理者の認証: admin-foundationの担当。共通部品を再利用し、管理者のテーブルとセッションは利用者と分ける。
- Stripe Customerの削除: paymentsがハンドラを登録する(briefのOut)。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する。

### 仮決定(2026-10-18に開発者が承認)

設計中に生じた、開発者の判断を要する論点である。回答と上流specに最も整合する案を仮に採用して設計・タスクを作り、2026-10-18に開発者の確認を得て確定した。仮6はQ&Aで個別に承認され、仮1〜仮4は一括で承認された。仮5は回答により「退会だけは受け付ける」案へ変更し、要件・設計・タスクを直した。

| #   | 論点                                   | 確定した案                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 他の選択肢                                                                                      | 影響する箇所                                                                                                                       | 開発者の回答 |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 仮1 | TOTPの有効化に本人確認を求めるか       | 有効化の開始でも現在のパスワードを求める。Q7の列挙に無いが、セッションだけを奪った第三者がTOTPを有効にすると、本人は認証コードを持たずにロックアウトされ、Q8により復旧できないため                                                                                                                                                                                                                                                                                                                                         | Q7の文言どおり有効化では求めない(有効化には認証アプリの正しいコードだけを求める)                | 要件12.1・13.1、`TotpManagement`                                                                                                   | 承認(一括)   |
| 仮2 | セッションの「一括」失効の範囲         | 操作している端末以外をすべて失効させる。操作している端末は個別の失効またはログアウトで失効させる                                                                                                                                                                                                                                                                                                                                                                                                                           | 操作している端末を含めてすべて失効させ、ログアウトさせる                                        | 要件8.7、`SessionManagement`                                                                                                       | 承認(一括)   |
| 仮3 | 本人確認の誤りをログイン試行に数えるか | 数える。セッションを奪った第三者が、本人確認の画面からパスワードを総当たりできないようにするため。TOTPの誤りを数えることは申し送りで決定済み                                                                                                                                                                                                                                                                                                                                                                               | 数えない(本人確認には別の回数制限を設ける、または制限しない)                                    | 要件7.9、`ReAuthenticator`                                                                                                         | 承認(一括)   |
| 仮4 | メールアドレス変更後の使い捨て判定     | 新しいメールアドレスの確認が完了した時点でも判定し直す。FR-USER-014の「メールアドレス確認完了時」に、変更時の確認も含まれると読む                                                                                                                                                                                                                                                                                                                                                                                          | 登録時の確認だけで判定し、変更時は判定しない                                                    | 要件3.4、`EmailChange`                                                                                                             | 承認(一括)   |
| 仮5 | 停止中のユーザーの退会                 | 停止中のユーザーでも退会を受け付ける(消去の権利を優先する)。ログアウトとセッションの失効も受け付け、メールアドレス変更・パスワード変更・多要素認証の設定は拒否する。退会後すぐに同じメールアドレスで再登録して停止を逃れることは防げないが、これを受け入れる。FR-USER-026の「書き込み操作の拒否」に退会を含めず、要件定義書は改訂しない。セッションが切れた停止中の利用者は問い合わせで退会を依頼し、ugc-moderationの管理画面から運営者による退会の操作口(`AdministrativeWithdrawal`)で退会させる(横断レビューN-6への回答) | 受け付けず、問い合わせへ案内する(当初の仮の案。FR-USER-026の書き込みの拒否を文言どおり適用する) | 要件4.4・15.1・15.7〜15.10、`Withdrawal`・`AdministrativeWithdrawal`・`AccountGuard`・`UserLifecycleCommitter`・停止中の設定ページ | 変更         |
| 仮6 | DISIFYのAPIキー                        | 任意のシークレット`DISIFY_API_KEY`を設け、値があれば`X-Api-Key`で送る。無ければ匿名で呼ぶ。stagingの値(無料アカウントのキー)は、そのキーを読む本specの変更をmainへマージする前に開発者が登録し、prodの値はlaunch-readinessがリリース時に登録する。Workerへはinfra-deliveryの`OPTIONAL_WORKER_SECRETS`(api・event、追記済み)で渡る                                                                                                                                                                                          | 常に匿名で呼ぶ(送信元IPの共有により上限に達しやすく、「未判定」が増える) / 有料プラン           | `DisifyClient`、Wrangler設定、手作業の一覧                                                                                         | 承認(個別)   |

### 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂が必要である。

| 要件ID        | 内容                                                                                                                                                                                             | 根拠     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| FR-RLMIT-012  | 「クールダウン期間の終了時点でAlarm APIによりリセット」を「クールダウン期間の終了時点ではロックの解除だけを行い、失敗回数は最後の失敗から24時間失敗が無い時点でAlarm APIによりリセット」に改める | Q1       |
| FR-RLMIT-020  | 対象にNFR-SECUR-022(メールアドレス単位のログイン試行)を加え、キーにするメールアドレスは前後の空白を除いて小文字にしてからハッシュ化する旨を加える                                                | Q2       |
| NFR-SECUR-026 | 漏洩パスワードデータベースに照合できない場合は照合を省いて受け付け、運用者が検知できるよう記録する旨を加える                                                                                     | Q3       |
| FR-USER-014   | 判定結果を「使い捨て・通常・未判定」の3値とし、判定サービスに到達できない場合は「未判定」として確認を完了させ、後から判定し直す旨を加える。メールアドレス変更の確認時の判定も明記する(仮4)       | Q3       |
| NFR-SECUR-031 | 重要な操作では全端末のセッションを削除したうえで、ログイン中に操作した端末にだけ新しいセッションを発行する旨を明記する(明確化)                                                                   | Q7       |
| FR-RLMIT-001  | 「再送について」の回数に初回の送信を含めること、メールの種類ごとに数えることを明記する(明確化)                                                                                                   | 申し送り |
| FR-USER-002   | 同意した日時を記録する旨を加える(明確化)                                                                                                                                                         | Q4       |

FR-USER-026は改訂しない。仮5の変更で停止中の退会を受け付けるが、開発者の回答(2026-10-18)により改訂は不要とした。本specは、退会を同要件の「書き込み操作」に含めないと読む。セッションが切れた後の退会を運営者による退会の操作口で受けること(横断レビューN-6)も、ログインを認めないため同要件と食い違わず、改訂は不要である。一方、ファイルのアップロードは同要件の「書き込み操作」に含め、media-pipelineの差し込み口を本specが束縛して停止中・退会済みの利用者を拒否する(横断レビューN-7)。

### Wave 1の横断レビューの反映(2026-10-18)

kiro-spec-batchの横断レビューの指摘と開発者の回答を、次のとおり反映した。C-1〜M-11は1回目、N-1〜N-7は2回目、R3-1・R3-2・R3-8は3回目(2026-10-19)の横断レビューの指摘である(N-8・N-9はroadmapとuser-profile-socialのbriefの修正で、親エージェントが行った。R3-3〜R3-7は他specとroadmap・briefの修正である)。

| 指摘 | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 反映した箇所                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1  | roadmapの依存にcontent-processingを加え、順序をcontent-processing→media-pipeline→identity-authにした(roadmapは親エージェントが修正)。本specが依存するのは、content-processingのタスク1.1・1.2・2.1(`apps/common-lib`の新設と書記素の数え方)と4.1・4.2(各アプリへの組み込み。配置先を静的解析とテストの対象から外す)。2回目のN-3で、content-processingが示す最小の区切りに6.1、11.3のうち`coding/003`への`server/**`の許可の記述、11.4のうち日次タイムラインの表の作成が加わった                                                                                                                                                                                                                            | design.mdのAllowed Dependencies・上流への影響、tasks.mdの1.1・1.3                                                                                                                                                                                                                                                                                                   |
| I-1  | ユーザーが保有するファイルの物理削除(`eraseOwnedBy`)と、停止・停止解除に伴う隔離理由`user_suspended`の付け外しは、user-profile-socialがユーザーライフサイクルイベントの波及処理として登録する。本specは登録口だけを提供する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | requirements.mdのBoundary Context、design.mdのNon-Goals・Out of Boundary・物理削除の注記                                                                                                                                                                                                                                                                            |
| I-2  | Durable Objectsには管轄を指定しない(infra-deliveryのK7の取り下げ)。本specへの管轄の依頼は無くなった                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | design.mdの`LoginAttemptThrottle`・Revalidation Triggers、tasks.mdの12.2                                                                                                                                                                                                                                                                                            |
| I-3  | `DISIFY_API_KEY`はinfra-deliveryが`OPTIONAL_WORKER_SECRETS`(api・event)とInfisicalの表に追記済み。stagingの値は、そのキーを読む本specの変更をmainへマージする前に開発者が登録し、prodの値はlaunch-readinessがリリース時に登録する。Infisicalは1プロジェクトのまま、dev・staging・prodの環境を使う                                                                                                                                                                                                                                                                                                                                                                                                          | 仮6、design.mdのSupporting References、tasks.mdの12.2・13.1                                                                                                                                                                                                                                                                                                         |
| I-4  | 技術ドキュメントの番号を`security/006`・`external/004`〜`006`・`backend/007`に固定した                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | design.mdのDirectory Structure・IdentityDocs、tasks.mdの12.1                                                                                                                                                                                                                                                                                                        |
| M-1  | `CLIENT_SITE_ORIGIN`は、APIサーバーの変数を本specが、client・adminの同名の変数をcontent-processingが所有し、名前・値・検証の規則をそろえて相互に参照する。infra-deliveryが3環境の値を一覧に持つ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | design.mdのRevalidation Triggers・ApiIdentityComposition、tasks.mdの8.1                                                                                                                                                                                                                                                                                             |
| M-3  | ハンドルの規則はuser-profile-socialが所有する。本specは初期ハンドルの形式(`InitialHandleFormat`)と`HANDLE_AVAILABILITY`だけを持ち、初期ハンドルがその規則を満たすことを再検証の対象にする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | requirements.mdのBoundary Context、design.mdのOut of Boundary・Revalidation Triggers                                                                                                                                                                                                                                                                                |
| M-4  | 日次タイムラインの「日次バッチ(4:21)の内容」の、content-processingが作るジョブの名前と順序の表に、本specの3行(100・110・120)を加える。2回目のN-3で、表が無ければ本specが作る形に改めた                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | requirements.mdの20.6、design.mdのModified Files、tasks.mdの12.2                                                                                                                                                                                                                                                                                                    |
| M-6  | D1のマイグレーションは、mainの最新を取り込んでから生成し、衝突したら生成し直す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | design.mdのModified Files、tasks.mdの1.2                                                                                                                                                                                                                                                                                                                            |
| M-9  | 波及処理とジョブの名前は`<spec名>.<名詞句>`(`email-delivery.cleanup`・`content-processing.keyword-reextraction`と同じ形)、メッセージ種別は`<ドメイン>.<動詞句>`(backend-platformの規約)。本specのジョブ(`identity-auth.*`)・波及処理・メッセージ(`identity.*`)は既にこの規約に沿う                                                                                                                                                                                                                                                                                                                                                                                                                         | design.mdのUserLifecycleContract・定期実行のジョブ                                                                                                                                                                                                                                                                                                                  |
| M-11 | Durable Objectのマイグレーションは、infra-deliveryの導入後はmainへのマージでCIが適用する。導入前に実装する場合だけ開発者が手作業でデプロイする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | design.mdのOut of Boundary・Migration Strategy、tasks.mdの5.3・13.1                                                                                                                                                                                                                                                                                                 |
| N-1  | 国外移転の記載事項は委託先単位で分担し、Cloudflareの項(D1・R2・Queuesの米国保存、所在を限定しないDurable Objects・Workersの実行・エッジキャッシュ・ログの扱い、EU-USデータプライバシーフレームワークを主とし無効なら委託先のDPAの標準契約条項に拠る移転の根拠)をinfra-deliveryが、AWS(Rekognition)の項をmedia-pipelineが書く。本specのD1のテーブルとログイン試行の記録はCloudflareの項に含まれ、本specはその項を書き換えない。DISIFY・HIBPには個人を識別できる情報を渡さないため、既存の骨子どおり国外移転の対象外のままにし、infra-deliveryの改訂の後もその旨が残っていることを12.2で確かめる(roadmapの「国外移転の記載」により、委託先を使うspecが自分の委託先の分を受け持つ)                            | requirements.mdのAdjacent expectations、design.mdのOut of Boundary・Revalidation Triggers・上流への影響・Modified Files(準拠方針・プライバシーポリシー骨子)、tasks.mdの12.2                                                                                                                                                                                         |
| N-2  | roadmapに無い依存は「確かめて、無ければ開発者へ報告する」とする。本specの13.1は既にこの扱いである。新しい8.5のmedia-pipelineの差し込み口と、8.1のinfra-deliveryのキーの一覧の節も同じ扱いにした。その後、roadmapの依存にmedia-pipelineが加わった(R3-2)                                                                                                                                                                                                                                                                                                                                                                                                                                                     | design.mdのAllowed Dependencies・Modified Files、tasks.mdの8.1・8.5・13.1                                                                                                                                                                                                                                                                                           |
| N-3  | 日次タイムラインの表は、無ければ最初に4:21のジョブを足すspecが作り(email-deliveryの900を含める)、後のspecは行を足す。本specも表が無いことを理由に止めず、無ければ作る。タスク1.3の前提は、content-processingが示す最小の区切り(1.1・1.2・2.1・4.1・4.2・6.1、11.3のうち`coding/003`の`server/**`の許可、11.4のうち表の作成)に合わせた                                                                                                                                                                                                                                                                                                                                                                      | design.mdのAllowed Dependencies・上流への影響・Revalidation Triggers・Modified Files・定期実行のジョブ、tasks.mdの1.3・12.2                                                                                                                                                                                                                                         |
| N-4  | ジョブ・波及処理の名前は`<spec名>.<名詞句>`、メッセージ種別は`<ドメイン>.<動詞句>`。規約はroadmapのShared seams(親エージェントが追記)と、content-processingのタスク11.5がbackend-platformの`infra/003-async-processing.md`へ追記する文書を正とする。本specの`backend/007`は名前の規約を書かずにリンクする(要件20.5)                                                                                                                                                                                                                                                                                                                                                                                        | requirements.mdの20.5、design.mdのUserLifecycleContract・IdentityDocs、tasks.mdの12.1                                                                                                                                                                                                                                                                               |
| N-5  | シークレットのキーの一覧の正は`docs/onboardings/project-values.md`の節(infra-deliveryのタスク8.5が作る)とし、本specはキーを読む変更(8.1)と同じ変更で`DISIFY_API_KEY`の行を足すか、行があれば食い違いを確かめる。技術ドキュメントにはキーの名前を列挙しない                                                                                                                                                                                                                                                                                                                                                                                                                                                 | requirements.mdのAdjacent expectations、design.mdの上流への影響・Modified Files・IdentityDocs・Supporting References、tasks.mdの8.1・12.1・12.2・13.1                                                                                                                                                                                                               |
| N-6  | セッションが切れた停止中の利用者のため、運営者による退会の操作口`AdministrativeWithdrawal`を設ける。停止中の利用者にも使え、本人の退会と同じ確定の処理(`commitWithdrawal`)を通す。呼び出せるのは管理者側の呼び出し元と管理者のセッションの経路だけで、権限の確認・監査ログ(admin-foundationの記録API)・管理画面・問い合わせからの導線は呼び出し側(ugc-moderation)が持つ。停止中の設定ページの案内文に、セッションが切れた後は問い合わせで退会を依頼できる旨を加えた。roadmapのShared seamsへは親エージェントが追記した。要件定義書の改訂は不要                                                                                                                                                             | requirements.mdの決定事項(仮5)・用語・Boundary Context・要件15(Objective・15.7〜15.10)、design.mdのBoundary Commitments・Revalidation Triggers・運営者による退会の流れ・Withdrawal・AdministrativeWithdrawal・UserSuspension・設定セクション・エラーの表・Security Considerations、tasks.mdの7.9・10.6・10.7・12.1・12.2                                            |
| N-7  | 停止中の利用者のアップロードを拒否する。media-pipelineの差し込み口`UploaderEligibility`(既定は全許可、`apps/api/src/composition/uploader-eligibility.ts`)を、本specの`AccountUploaderEligibility`で束縛する。判定は`AccountGuard.currentUser`と`checkAccountWritable`(確認済みは求めない)で、停止中・退会済みを`account_unavailable`で拒否し、メールアドレスが未確認の利用者はFR-USER-006の制限にアップロードが無いため拒否しない。media-pipelineのタスク5.1・5.6の完了を前提にする                                                                                                                                                                                                                        | requirements.mdの決定事項(横断N-7)・Boundary Context・要件4.7、design.mdのBoundary Commitments・Allowed Dependencies・上流への影響・アップロードできる利用者の判定・AccountUploaderEligibility・ApiIdentityComposition、tasks.mdの8.5・13.1                                                                                                                         |
| R3-1 | application層の契約がpresentation層の`SessionAccess`を読み込むと、backend-platformの層の規則(型だけの読み込みも禁止)に違反する。application層に、セッションの読み取り専用の型`SessionView`(`apps/api/src/application/session/session-view.ts`、`principal()`だけを持つ)を置き、`SessionAccess`がそれを拡張する。型名と置き場所はWave 1の全specでそろえ、api-gatewayの契約への追記として本specのタスク2.3で行う(media-pipelineが先に置いていれば形を確かめるだけ)。`AccountGuard`の4つのメソッド・`AccountUploaderEligibility`・`EmailVerification.resend`は`SessionView`を受け取る。同じ理由で、`AdministrativeWithdrawalCommand.caller`はpresentation層の`CallerKind`を読み込まず文字列で受ける(水平展開) | requirements.mdのAdjacent expectations、design.mdのImpact・Out of Boundary・Allowed Dependencies・Revalidation Triggers・上流への影響・Dependency Direction・Modified Files・追跡表・コンポーネントの表・AccountGuard・AccountUploaderEligibility・EmailVerification・AdministrativeWithdrawal・SessionViewContract・Testing Strategy、tasks.mdの2.3・7.1・7.9・8.5 |
| R3-2 | roadmapの依存にmedia-pipelineが加わった。8.5は、順の上では先に完了しているはずのmedia-pipelineの5.1・5.6を前提にし、無ければ8.5だけを保留して報告し、他のタスクは進める                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | design.mdのAllowed Dependencies、tasks.mdの1.1・8.5、research.mdのN-2の行・アップロードの判定の決定・Risks                                                                                                                                                                                                                                                          |
| R3-8 | 「この操作はできません。」は、roadmapの順で先に実装されるmedia-pipelineのタスク9.2が文言規則へ加える。本specの`forbidden`は同じ文言を使い、12.2では既にあることを確かめるだけにする(無い場合だけ追記する)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | design.mdのModified Files・Error Categories and Responses、tasks.mdの12.2                                                                                                                                                                                                                                                                                           |

### 共通ドメインの横断レビューの反映(2026-10-23)

共通ドメイン5spec(admin-foundation・legal-pages・inquiry-chat・payments・ultras-subscription)の作成後の横断レビューの指摘と開発者の決定(2026-10-23)を、次のとおり反映した。

| 指摘                   | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 反映した箇所                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 利用者の連絡先の照会   | payments・ultras-subscription・inquiry-chatがそれぞれ`users`の`email`・`nickname`・`deleted_at`を直接読んでメールの宛先を引いており、所有者の異なる同じ読み取りが散っていた。本specが共通の照会`UserContactDirectory`(`findContact(userId)`。退会済み・物理削除済みは`undefined`、停止中は返す)を`apps/backend-lib/workers/identity`に置き、api・eventの両方に束縛する。各specはこれに切り替える(切り替えは各specの担当)                                                                                                                                                                                                                    | requirements.mdの4.8、design.mdのThis Spec Owns・Revalidation Triggers・Directory Structure・Modified Files・追跡表・コンポーネントの表・UserContactDirectory、tasks.mdの3.5 |
| DIの識別子の名前       | 指摘の案は`IDENTITY_TYPES.UserContactDirectory`だったが、本specの`IDENTITY_TYPES`はapiのapplication層にあるapi専用の識別子で、eventと`backend-lib/workers/<ドメイン>`(paymentsの反映など)からは読み込めない。共有の部品の識別子は`backend-lib`に置く上流の前例(email-deliveryの`EMAIL_TYPES`と`EMAIL_PLATFORM_MODULE`、media-pipelineの`MEDIA_TYPES`と`MEDIA_PLATFORM_MODULE`)に合わせ、`IDENTITY_PLATFORM_TYPES.UserContactDirectory`(`Symbol.for('identity.UserContactDirectory')`)とし、束縛は`IDENTITY_PLATFORM_MODULE`(`EMAIL_PLATFORM_MODULE`と同じ形)とする。契約の形(`UserContact`・`UserContactDirectory`)は指摘の案のまま変えない | design.mdのUserContactDirectory、tasks.mdの3.5                                                                                                                               |
| 既存の照会口との関係   | email-deliveryの`UserAddressDirectory`(メールアドレスからの逆引き、`D1UserAddressDirectory`)は用途が異なるため統合しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | design.mdのUserContactDirectory                                                                                                                                              |
| チェックボックスの部品 | shadcn/uiの`Checkbox`はpaymentsも決済の同意で使うが、roadmapの順で先に実装される本specの登録の同意で先に要る。本specのタスク10.4が`apps/frontend-lib/components/ui/checkbox.tsx`を作り、paymentsは既にあれば作らずに再利用する(paymentsの設計の調整は親エージェントへ報告した)                                                                                                                                                                                                                                                                                                                                                              | design.mdのThis Spec Owns・Directory Structure・追跡表・コンポーネントの表・AuthRoutes、tasks.mdの10.4                                                                       |
| 容量の単位             | ファイルサイズの上限は1,024を基数とする(文言規則)。本specはバイト数の上限を持たないため変更は無い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                            |

### 共通ドメインの2回目の横断レビューの反映(2026-10-23)

2回目の横断レビューの指摘と開発者の決定(2026-10-23)を、次のとおり反映した。

| 指摘                                 | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 反映した箇所                                                                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 波及処理の`order`の範囲              | 各ドメインspecが4:21のジョブと同じ百の位の帯を使う規則では、後続specの数が増えると0〜999の範囲に帯が収まらない。範囲を広げ、0〜9999を各ドメインspec、10000以上を本specの波及処理とする。本specの`identity-auth.email-suppression-cleanup`は1000から10000に変える(本specの波及処理の相対順は変えない)。帯の割り当ての表はroadmapのShared seams「Cron・Queuesのディスパッチ」が持つ。`createAsyncLifecycleRegistry`は元から範囲を検査せず、同じ種類での重複だけを拒否するため、検証の規則は変えない                                                                                                                                                                                                                                                                                            | design.mdのRevalidation Triggers・UserLifecycleContract・EmailSuppressionCleanupHandler・本プロジェクト固有の値の表・Testing Strategy、tasks.mdの3.1・9.3                                                     |
| データエクスポートのアカウントの部分 | data-exportが`account.json`を組み立てるために`users`を直接読まないよう、本specが`AccountExport`(`find(userId)`。仮名化ID・メールアドレス・確認日時・登録日時・多要素認証の有効状態。退会済み・物理削除済みは`undefined`、停止中は返す)を`apps/backend-lib/workers/identity`に置き、`IDENTITY_PLATFORM_MODULE`でapi・eventの両方に束縛する。仮名化IDはZIPに書かず、paymentsの`PaymentHistoryExport.listAll`へ渡すためだけに返す。`nickname`・`handle`は、プロフィール編集でそれらを変更するuser-profile-socialのプロフィールの出力用の部品が返す(`profile.json`・`manifest.json`の`user.handle`・ZIPのファイル名)。`plan`・`notificationSettings`・`apiKeys`はそれぞれultras-subscription・notifications・public-apiの持ち分である。識別子は2つになるため`identity-platform-types.ts`へ分ける | requirements.mdの4.9、design.mdのThis Spec Owns・Revalidation Triggers・Directory Structure・Modified Files・追跡表・コンポーネントの表・UserContactDirectory・AccountExport・Testing Strategy、tasks.mdの3.6 |
| 連絡先の照会のテストの記載           | タスク3.5のWorkers統合テスト(`D1UserContactDirectory`と、api・eventの両方のコンテナでの解決)がTesting Strategyに無かった。`AccountExport`の分と合わせて加える                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | design.mdのTesting Strategy                                                                                                                                                                                   |
| 識別子の形の前例                     | 上流のspecは下流のspecを前例として引かない。`IDENTITY_PLATFORM_TYPES`の形の前例は、上流のemail-deliveryの`EMAIL_TYPES`(`Symbol.for('email.<名前>')`)と`EMAIL_PLATFORM_MODULE`とする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | design.mdのUserContactDirectory、本書の1回目の反映の「DIの識別子の名前」                                                                                                                                      |

### 全specの横断レビューの反映(2026-10-24、承認の後の改訂、確定済み)

cross-spec reviewの指摘による、承認の後の改訂である。仮7は2026-10-24に開発者が確定した(推奨どおり、本specが所有して実装する)。これで本specの仮決定(仮1〜仮7)はすべて確定した。

| #   | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 理由                                                                                                                                                                                                                                                                                                                                                                                  | 反映した箇所                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮7 | 管理画面の利用者の照会`AdminUserDirectory`(`search`・`findByIds`・`findByEmail`・`countRegisteredAt`)と`D1AdminUserDirectory`を本specが所有して実装し、`apps/backend-lib/workers/identity/admin-user-directory.ts`に置く。DIの識別子`IDENTITY_PLATFORM_TYPES.AdminUserDirectory`を加え、`IDENTITY_PLATFORM_MODULE`でapi・eventの両方に束縛する。契約の形は、ugc-moderationの設計(上流への追加)の`AdminUserDirectory`をそのまま写した。利用者側の振る舞いは変わらない(読み取りだけ、`users`の列の意味は変えない) | ugc-moderationが本specのディレクトリへ照会を加え、本specのタスクに無いまま実装を本spec以外が持つ分担になっていた。`users`の列の意味と退会済みの扱いを知る本specが照会も所有すれば、列や状態の値を変えるときに同じspecの中で照会とテストを直せ、Revalidation Triggersで利用者(ugc-moderation)に伝えられる。置き場所と束縛は`UserContactDirectory`・`AccountExport`と同じ規則にそろえた | requirements.mdの4.10、design.mdのThis Spec Owns・Revalidation Triggers・Directory Structure・Modified Files・追跡表・コンポーネントの表・UserContactDirectory(識別子と束縛)・AdminUserDirectory・Testing Strategy、tasks.mdの3.7 |

- 仮7のタスクのサニティレビュー(2026-10-24): 変更部分(タスク3.7)を新しいサブエージェントで独立に確認し(independent)、1回目でPASSだった。軽微の指摘に従い、メールアドレスの照合が前後の空白を除くことをタスク3.7のテストとTesting Strategyに加えた。
- 変更履歴(2026-10-24、振る舞いの変更なし): ugc-moderationの仮4の確定(代理の退会は最上位管理者だけが行い、起点はユーザー一覧だけ。問い合わせの詳細からの導線は設けない)に合わせ、requirements.mdの範囲と隣接specの説明、design.mdのNon-Goals・Out of Boundary・Revalidation Triggersの「問い合わせからの導線」を「ユーザー一覧からの操作」に改めた。本specの操作口`AdministrativeWithdrawal`の形と条件(呼び出し元が管理者側で主体が管理者のセッション)は変えない。最上位管理者だけに限る権限の判定はugc-moderationが行う。
- 変更履歴(2026-10-24、spec横断レビューの3回目、振る舞いの変更なし): ugc-moderationの仮4・仮5の確定に合わせ、design.mdのOut of BoundaryとSecurity Considerationsで、停止中の利用者の依頼の受け付け・本人の確かめ・利用者への連絡を運営者がシステムの外で行う旨に改めた(ugc-moderationは最上位管理者のユーザー一覧からの操作だけを持つ)。AdminUserDirectoryの節で、契約の正は本specの設計で、ugc-moderationはそれを使う旨に改めた。

## Research Log

### 上流specの契約と不足

- **Context**: 本specは4つの上流spec(実装は未着手)の契約の上に作る。差し替える登録箇所と、足りない契約を洗い出した。
- **Sources Consulted**: `.kiro/specs/backend-platform/design.md`(`KeyedHasher`・`hashRateLimitKey`・`RateLimitCounterClient`・`BotVerifier`・`CronRegistry`・`MessageContract`・`RetryPolicy`・`PlatformEnv`・`WranglerConfigs`)、`.kiro/specs/api-gateway/design.md`(`SessionVerifier`・`SessionAccess`・`GraphQLContext`・`GraphQLSchemaModule`・`composition/session.ts`)、`.kiro/specs/email-delivery/design.md`(`EmailKind`・`EmailTemplate`・`EmailSender`・`UserAddressDirectory`・`SuppressionMaintenance`・`USER_ADDRESS_DIRECTORY`)、`.kiro/specs/frontend-platform/design.md`(`FORWARDED_BROWSER_HEADERS`・`SiteLayoutSlots`・`executeGraphQL`・`useTurnstileToken`・`FormParts`)。
- **Findings**:
  - api-gatewayの`SessionVerifier.verify({ subjectKind, token })`は利用者と管理者の両方を1つのポートで受ける。`composition/session.ts`の束縛を差し替える契約である。
  - `SessionAccess.issue({ token, maxAgeSeconds })`・`clear()`で、リゾルバからCookieの発行と削除を指示できる。frontend-platformは`maxAgeSeconds`を1〜34560000の整数だけ受け付ける。
  - `GraphQLContext`は`caller`・`correlationId`・`clientIp`・`session`・`loaders`・`resolve`・`assertHuman`を持ち、要求のヘッダーを持たない。ブラウザからの中継(`/_bff/graphql`)は`FORWARDED_BROWSER_HEADERS`(`content-type`・`accept`・`cf-turnstile-response`)だけを引き継ぎ、サーバー側の描画のGraphQLはブラウザのヘッダーを引き継がない。
  - email-deliveryの`SuppressionMaintenance`はapiのメールモジュールだけが束縛する。`UserAddressDirectory.findRegistered`は1回90件までで、照合キー(`toMatchingKey`、前後の空白を除いて小文字化)の集合を返す。
  - backend-platformのQueuesのconsumerは`max_retries: 6`で、メッセージの種別ごとの`RetryPolicy`の`maxAttempts`はこれより小さくする必要がある(設定の検査が`DEFAULT_RETRY_POLICY.maxAttempts`との大小を確かめる)。
  - backend-platformの`RateLimitCounter`はapiの`durable_objects`の`migrations`で`v1`として作られる。
- **Implications**:
  - `user-agent`の受け渡しのため、frontend-platformの`FORWARDED_BROWSER_HEADERS`に`user-agent`を、api-gatewayの`GatewayRequestScope`と`GraphQLContext`に`userAgent`を、既存の振る舞いを変えずに加える。ログインはブラウザからの中継で行うため、サーバー側の描画での引き継ぎは要らない。
  - `SuppressionMaintenance`を、eventの本specのモジュールでも束縛して、退会の非同期の波及処理から呼ぶ。email-deliveryのファイルは変えない。
  - 新しいDurable Objectのクラスは、apiの`migrations`の既存の最後のタグの次(現時点の設計では`v2`)に追加する。Wave 1の他specが同時にタグを追加する場合は、実装時に番号を詰める。Wrangler設定の`migrations`は`wrangler deploy`が適用するため、infra-deliveryの導入後はmainへのマージでCIがstagingへ適用する(infra-deliveryのWorkerDeployerと`infra/007`)。

### PBKDF2・HMAC・AES-GCMとWeb Crypto

- **Context**: NFR-SECUR-004〜006・034・036、TOTPの秘密鍵の保存(要件13.10)。
- **Sources Consulted**: workerdのWeb Crypto(`crypto.subtle.deriveBits`のPBKDF2・HKDF、`importKey`、`timingSafeEqual`)、[workerd#1346](https://github.com/cloudflare/workerd/issues/1346)(PBKDF2の反復回数の上限10万回)、OWASP Password Storage Cheat Sheet・Multifactor Authentication Cheat Sheet。
- **Findings**:
  - workerdはPBKDF2の反復回数が10万回を超えると例外にする。10万回ちょうどは受け付ける。
  - `crypto.subtle.timingSafeEqual`はWorkersの拡張でBunには無い。照合はWorkers統合テストで確かめるか、HMACの`verify`による比較(backend-platformの`KeyedHasher`と同じ方式)を使う。
  - TOTPの秘密鍵は照合のたびに平文が要るため、ハッシュ化できない。OWASPは保存時の暗号化を推奨している。
- **Implications**: パスワードは「`KeyedHasher`の用途`password-prehash`によるHMAC-SHA512(ペッパー)→PBKDF2-HMAC-SHA512(16バイトのソルト・10万回・64バイト)」とし、ペッパーは`HASH_PEPPER`を用途の区別付きで共用する。TOTPの秘密鍵はAES-256-GCMで暗号化し、鍵は`HASH_PEPPER`からHKDF-SHA-256(用途の文字列付き)で導出し、利用者のIDを追加認証データにする。

### HIBP Pwned Passwordsのrange API

- **Context**: NFR-SECUR-026・SW-020・Q3。
- **Sources Consulted**: [HIBP API v3](https://haveibeenpwned.com/API/v3#PwnedPasswords)、`GET https://api.pwnedpasswords.com/range/5BAA6`の実際の応答(2026-10-18)。
- **Findings**:
  - SHA-1の16進(大文字)の先頭5文字を送り、残り35文字と出現回数の`SUFFIX:COUNT`の行の一覧を受け取る。APIキーは不要。
  - `Add-Padding: true`を付けると、出現回数0の偽の行が加わり、応答の大きさから照合結果を推測されにくくなる(実測約2,000行・約80KB)。
  - 応答には`Cache-Control: no-store`が付く。
- **Implications**: `Add-Padding: true`と識別用の`User-Agent`を付けて呼び、出現回数0の行は無視する。3秒で打ち切り、2xx以外・通信の失敗・時間切れ・解析できない応答は「使えない」として照合を省く(Q3)。

### DISIFYの単一メールアドレスの判定

- **Context**: FR-USER-014・SW-021・Q3。
- **Sources Consulted**: [DISIFY Docs](https://docs.disify.com/)の`api/email.md`・`api/errors.md`・`guide/rate-limits.md`・`guide/authentication.md`、既知の使い捨てドメインに対する実際の応答(2026-10-18)。
- **Findings**:
  - `POST https://disify.com/api/email`にフォーム形式で`email`を送ると、`format`・`disposable`・`dns`などを返す。判定が完了すれば、使い捨てでも状態コードは200である。
  - 状態コード401・403・422・429・503と、HTML・異なるJSONの応答があり得る。本文の形に頼らず、状態コードを先に確かめるよう案内されている。
  - 匿名は送信元IPごとに毎分30回・1日1,000件、無料アカウントはアカウントごとに毎分60回・1日10,000件・月30,000件。APIキーは`X-Api-Key`ヘッダーで渡す。
- **Implications**: ローカル部をダミー(`dummy`)に置き換えたアドレスをPOSTの本文で送り、URLにメールアドレスを含めない。200かつ`format: true`で`disposable`が真偽値なら判定結果、それ以外はすべて「未判定」とする。APIキーは任意のシークレットにする(仮6)。

### OTPAuth・uqr・bowser

- **Context**: FR-USER-017・018、NFR-SECUR-033・034、Q6。
- **Sources Consulted**: npmの`otpauth@9.5.2`・`uqr@0.1.3`・`bowser@2.14.1`の型定義と公開日(2026-10-18に確認)。
- **Findings**:
  - `otpauth`: `new Secret({ size: 20 })`で160ビットの秘密鍵、`new TOTP({ issuer, label, algorithm: 'SHA1', digits: 6, period: 30, secret })`、`validate({ token, timestamp, window: 1 })`は一致した時間窓の差か`null`を返す。`TOTP.counter({ period, timestamp })`で時間窓の番号を得る。`toString()`で`otpauth://`のURIを作る。依存の`@noble/hashes`は純粋なJavaScriptで、workerdで動く。
  - `uqr`: `encode(data)`はセルの行列(`data: boolean[][]`)を返し、`renderSVG`はSVGの文字列を返す。
  - `bowser`: `Bowser.parse(ua)`が`browser.name`・`os.name`・`platform.type`を返す。2.14.1は2026-02-08公開、MIT、依存なし。
- **Implications**: TOTPの生成と照合はAPIサーバーだけで行い、`otpauth`はapiに導入する。QRコードはクライアントで`encode`の行列からSVG要素を組み立てる部品を`apps/frontend-lib`に置き、admin-foundationが再利用できるようにする(`uqr`はfrontend-lib・client・adminに同じ版で宣言する)。`bowser`はapiだけに導入し、User-Agentの生の値をブラウザへ返さない。

### Durable Objectsのアラームとログイン試行の記録

- **Context**: NFR-SECUR-022・023、FR-RLMIT-011・012、Q1・Q2。
- **Sources Consulted**: Cloudflare Docs「Durable Objects Alarms」「Storage API(SQLite)」、backend-platformの`RateLimitCounter`の設計。
- **Findings**:
  - 1つのDurable Objectが予約できるアラームは1つで、`setAlarm`は既存の予約を置き換える。アラームは少なくとも1回実行され、失敗時は再試行される。
  - 同じDurable Objectへの要求は1つずつ処理されるため、失敗回数の加算は正確になる。ただし「ロックの確認→パスワードの照合→失敗の記録」を別々の呼び出しで行うと、確認と記録の間に並行した試行が入り得る。
- **Implications**: クールダウン中かどうかは保存した`lockedUntil`と現在時刻の比較で判定し、アラームはロックの解除(FR-RLMIT-012の読み替え)と、最後の失敗から24時間後の記録の削除に使う。並行した試行の超過は最大でも同時に送られた件数にとどまるため許容し、bot判定(ログインごと)で補う。Durable Objectsには管轄(`jurisdiction`)を指定しない。記録はハッシュ化したキーと回数・時刻だけで24時間で消えるためで、infra-deliveryの仮決定K7(米国の管轄)はWave 1の決定(2026-10-18)で取り下げられた。準拠方針には、infra-deliveryがDurable Objectsについて「保存場所は保証しない(レート制限のカウントなど、ハッシュ化した一時的な値)」と書き、本specのログイン試行の記録の行は表現をそれにそろえる。

### D1の一括の書き込みと状態の遷移

- **Context**: Q5(同期の波及処理を状態の変更と同じ一括の書き込みに含める)、要件16.2・16.8。
- **Sources Consulted**: `docs/GUIDES/tech/db/002-d1-constraints.md`、backend-platformの`DatabaseClient`の設計。
- **Findings**:
  - `db.batch()`は途中の失敗で全体を取り消すが、前の文の結果で後の文を変えられない。条件付きの`UPDATE`が0件でも後続の文は実行される。
  - NOT NULL制約に違反する挿入は、一括の書き込み全体を失敗させる。
- **Implications**: 利用者の行に版の番号(`lifecycle_version`)を持たせ、一括の書き込みの先頭で「版が読み取った値と一致すれば値を、一致しなければNULLを入れる」イベントの挿入を行う。競合した場合はNOT NULL制約の違反で全体が取り消され、状態の重複した遷移と波及処理の二重の適用を防ぐ。後続specの同期の波及処理は、集合に対する1文の更新(行ごとの文にしない)で書く規約にする。

### 物理削除の時期と再試行の余地

- **Context**: DR-002・FR-USER-022・日次タイムライン・申し送り(13日後のバッチで始め、14日以内に再試行できる余地を残す)。
- **Findings**:
  - 日次バッチはUTC 12:21(業務時刻4:21)に1回だけ走る。条件を「論理削除の時刻が13×24時間以上前」にすると、退会がバッチの直後なら次のバッチまで待って13日23時間59分後に始まり、残りの余地が1分になる。
  - 条件を「退会の業務日付が、バッチの業務日付の13日前以前」にすると、開始は論理削除から12日4時間22分〜13日4時間21分後で、残りは19時間39分以上になる。
- **Implications**: 業務日付で判定する。物理削除のイベントの非同期の再試行は約75分(5回、300秒から倍、上限3600秒)で終わり、失敗が残れば14日を過ぎる前に運用者へ通知できる。

## Architecture Pattern Evaluation

| Option                                        | Description                                                                                     | Strengths                                                                       | Risks / Limitations                                                                 | Notes         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------- |
| 4層+汎用`auth`と利用者`identity`の2モジュール | 利用者・管理者に依存しない認証部品を`auth`、利用者のアカウントを`identity`としてapiの各層に置く | admin-foundationが同じapp内でそのまま再利用できる。共有ディレクトリを太らせない | eventから使う部品(使い捨て判定・照会口・イベントの記録)だけは共有ディレクトリに要る | 採用          |
| 認証部品をすべて共有ディレクトリに置く        | `backend-lib`に認証部品をまとめる                                                               | 配置の規則が単純                                                                | eventが使わない部品(Durable Object・PBKDF2・TOTP)までeventに配置される              | 不採用        |
| 波及処理をドメインイベントの汎用バスで行う    | 任意の集約のイベントを登録できる汎用の仕組み                                                    | プロダクトのライフサイクルイベントにも使える                                    | 現時点の要件は利用者だけで、汎用化は推測に基づく抽象になる                          | 不採用(YAGNI) |

## Design Decisions

### Decision: 認証部品の配置(Generalization)

- **Context**: brief「認証の共通部品は利用者・管理者の両方で使える形にする」、要件19。
- **Alternatives Considered**:
  1. apiの`domain/auth`・`application/auth`・`infrastructure/auth`に、主体(利用者・管理者)に依存しない部品として置く
  2. `apps/backend-lib`に置く
- **Selected Approach**: 1。管理者の認証もapiで動くため、同じapp内の汎用モジュールとして置く。eventからも使う部品(ライフサイクルイベントの型と記録、使い捨て判定、利用者のメールアドレスの照会口)だけを`apps/backend-lib`の`core/identity`・`workers/identity`に置く。
- **Rationale**: 共有ディレクトリはapi・eventの両方に配置されるため、片方だけが使う部品を置くと配置先の依存が増える。
- **Trade-offs**: admin-foundationは`auth`モジュールのポートと部品を読み込むが、`identity`モジュールには依存しない。
- **Follow-up**: admin-foundationの設計で、セッション・トークン・リカバリコードのテーブルを管理者用に別に作る。

### Decision: ペッパーの共用(Build vs Adopt)

- **Context**: 申し送り「固定ペッパーを`HASH_PEPPER`と共用するかは設計で決める」。
- **Alternatives Considered**:
  1. `HASH_PEPPER`を用途の区別付きで共用する
  2. パスワード専用の新しいシークレット(例: `PASSWORD_PEPPER`)を設ける
- **Selected Approach**: 1。PBKDF2の入力を`KeyedHasher.hash('password-prehash', password)`(HMAC-SHA512)にし、TOTPの暗号鍵も`HASH_PEPPER`からHKDFで用途を区別して導出する。
- **Rationale**: 両方のシークレットは同じWorkerのシークレットとして保存され、片方だけが漏れる経路は乏しい。用途の区別付きのHMACとHKDFにより、ハッシュ値と鍵が用途をまたいで一致しない。シークレットが増えないため、開発者の手作業(Infisicalへの登録)も増えない。HMACの前処理によりPBKDF2の入力は常に86文字になり、128文字のパスワードでも計算量が一定になる。
- **Trade-offs**: `HASH_PEPPER`を入れ替えると、全パスワード・TOTPの秘密鍵・保存済みのハッシュが使えなくなる(個別のシークレットでも同様)。入れ替えは想定せず、技術ドキュメントに記載する。

### Decision: 同期と非同期の波及処理の契約(Generalization・Simplification)

- **Context**: Q5、roadmapのShared seams、要件16。
- **Selected Approach**:
  - イベントの種類は`withdrawn`・`suspended`・`unsuspended`・`purge_due`の4つ。同期の波及処理は`withdrawn`・`suspended`・`unsuspended`だけ、非同期の波及処理は4つすべてに登録できる。
  - 同期の波及処理はapiに登録し、状態の遷移・イベントの記録と同じ`db.batch()`に文を加える。非同期の波及処理はeventに登録し、Queueのメッセージ`identity.run-user-lifecycle`(本文はイベントのIDだけ)で、登録された順に1つずつ実行する。完了した波及処理はD1に記録し、再実行しない。
  - 同じ利用者のイベントは発生順に処理する(前のイベントが完了するまで後のイベントを遅らせる)。停止と停止解除が短時間に続いても、画像の隔離と復元が逆順にならない。
  - 物理削除の開始(`purge_due`)は、登録された全波及処理の完了後に、本specが利用者自身の行を物理削除して終える。この最後の処理は登録口に載せず、実行器の組み込みの段階にする(登録口に載せると、自分の完了記録を自分で消すことになる)。
- **Rationale**: 1つのメッセージで順に実行すれば、波及処理ごとのメッセージの分配が要らず、物理削除の最後の段階を「全波及処理の完了後」に置ける。1回で終わらない処理は「続きがある」を返して遅延の再送(backend-platformの`defer`)で続ける。
- **Trade-offs**: 1つの波及処理の失敗が後続の波及処理を待たせる。完了済みの波及処理は飛ばすため、再試行のたびに重複して実行されることはない。

### Decision: 未完了の波及処理の記録と日次の再実行

- **Context**: backend-platformのQ7(デッドレターは通知して破棄)、申し送り。
- **Selected Approach**: イベントを`pending`で記録し、全波及処理の完了で`completed`にする。業務時刻4:21のジョブが、最後の送信から1時間以上経っても`pending`のイベントのメッセージを送り直し、送り直しの回数を数える。3回目以降はSentryへ`error`で通知する。
- **Rationale**: デッドレターに移ったメッセージは破棄されるが、D1の記録から復元できる。

### Decision: ログイン試行の記録の状態遷移

- **Context**: Q1・Q2、要件7。
- **Selected Approach**: 状態は`failures`・`lockedUntil`・`lastFailureAt`。失敗の記録で`failures`を1増やし、6回以上なら`lockedUntil = now + min(1000 × 2^(failures − 6), 300000)`ミリ秒。ロック中の試行は照合せずに拒否し、数えない。成功で記録を削除する。アラームは`lockedUntil`(ロックの解除)と`lastFailureAt + 24時間`(記録の削除)の早い方に置き直す。メールアドレス単位のDurable Objectの名前は`login-email:<user|admin>:<ハッシュ>`、IPアドレス単位は`login-ip:<ハッシュ>`とし、IPアドレス単位だけを利用者と管理者で共有する。
- **Rationale**: 失敗が続く限り待ち時間が伸び、最終的に5分に1回(1時間あたり約12回)に抑えられる。
- **Follow-up**: 送信元IPアドレスが不明な要求(内部経路の設定の誤り)では、IPアドレス単位の記録を使わずに警告を記録する。全員が1つの記録を共有して互いを締め出すことを避けるためである。

### Decision: メールのリンクの形とトークンの受け渡し

- **Context**: 申し送り「メールのリンクを開いたGETでは状態を変えず、ページからのPOSTで確定する(リンクの先読み対策)」、要件14.7。
- **Selected Approach**: リンクは`/auth/<手続き>#token=<トークン>`とし、トークンをURLのフラグメントに置く。画面はブラウザでフラグメントを読み、確定のボタンでGraphQLのミューテーションに渡す。
- **Rationale**: フラグメントはサーバーへ送られないため、フロントエンドサーバーのアクセスログ・Sentryの要求URL・中間の機器のログにトークンが残らない。リンクの先読みはページを取得するだけで状態を変えない。
- **Trade-offs**: サーバー側の描画ではトークンを検証できないため、無効なリンクかどうかは確定の操作の結果で示す。

### Decision: セッションの最終利用日時の更新の間引き

- **Context**: 申し送り「最終利用日時の更新は間引く」、要件8.3。
- **Selected Approach**: 最後の更新から15分以上経っている場合だけ`last_used_at`を更新し、そのときだけCookieの有効期間を延ばす指示(`renewal`)を返す。
- **Rationale**: 画面の表示ごとにD1へ書き込むことを避ける。アイドル14日に対して15分の誤差は無視できる。

### Decision: 運営者による退会の操作口(横断レビューN-6)

- **Context**: 停止中の利用者はログインできない(6.4)。停止では既存のセッションを消さないが、セッションが切れた後やログアウトの後は設定ページから退会できず、仮5の意図(消去の権利の優先)が一部しか満たされない。準拠方針は消去の手段を退会としている。
- **Alternatives Considered**:
  1. 運営者が利用者に代わって退会させる操作口を設け、ugc-moderationが管理画面から使う(採用。開発者の回答)
  2. 停止中の利用者に、退会だけを行える制限付きのログインを認める(FR-USER-026の「ログインの拒否」と食い違い、要件定義書の改訂が要る)
  3. 現状を受け入れ、問い合わせを受けてシステムの外で対応する
- **Selected Approach**: 1。`AdministrativeWithdrawal.withdraw({ userId, caller, operator, at })`を設け、呼び出し元が`admin`で主体が管理者のセッションのときだけ受け付ける。退会の確定は本人の退会と共通の`commitWithdrawal`を通す。本人確認・bot判定・Cookieの指示は行わない。
- **Rationale**: 退会の確定を1か所にまとめることで、同期・非同期の波及処理・抑止記録の削除・物理削除の時期が本人の退会と変わらない。操作口を利用者側のGraphQLに公開しないことと、呼び出し元と主体の確認で、利用者側からは呼べない。
- **Trade-offs**: 管理者の権限(RBAC)の確認と監査ログは呼び出し側に委ねるため、本specの操作口だけでは権限の不足を検出しない。admin-foundationの管理者のセッションの検証が入るまでは、管理者のセッションが常に無効のため呼べない。
- **Follow-up**: ugc-moderationの設計で、問い合わせでの依頼者の本人の確かめ方、権限、監査ログの記録、利用者への連絡を決める。

### Decision: アップロードできる利用者の判定の束縛(横断レビューN-7)

- **Context**: 停止中の利用者は既存のセッションでアップロードでき、FR-USER-026の書き込みの拒否がアップロードの経路で満たされない。media-pipelineはアップロードの受け付けに差し込み口`UploaderEligibility`(既定は全許可、処理単位のコンテナから解決、セッションの読み取りの型`SessionView`と主体と用途を受け取る。横断レビューR3-1)を設けた。
- **Selected Approach**: `AccountUploaderEligibility`を`AccountGuard.currentUser`と`checkAccountWritable(user, { requireVerifiedEmail: false })`で実装し、`apps/api/src/composition/uploader-eligibility.ts`の束縛を差し替える。停止中・退会済みは`account_unavailable`、未確認は許可する。
- **Rationale**: `AccountGuard.requireWritableUser`と同じ規則で判定し、同じ要求の中で利用者を1回だけ読む。未確認の利用者の制限(FR-USER-006)の対象にアップロードは無く、制限のある操作への紐付けは各ドメインspecの保存で拒否される。
- **Trade-offs**: media-pipelineはroadmapの依存で先に完了しているはずだが、差し込み口が無い間は束縛を保留し、停止中の利用者のアップロードが残る(紐付けられないファイルは24〜48時間で消える)。

### Decision: application層が受け取るセッションの型(横断レビューR3-1)

- **Context**: `AccountGuard`などapplication層のユースケースが、api-gatewayの`presentation/gateway/session-access.ts`の`SessionAccess`を受け取る設計だった。backend-platformの層の規則は`src/application/**`から`**/presentation/**`の読み込みを型だけの読み込みも含めて禁止するため、実装するとルートの一括検査が失敗する。
- **Alternatives Considered**:
  1. api-gatewayのapplication層に狭い読み取りの型を置き、`SessionAccess`がそれを拡張する
  2. 層の規則で、application層から`session-access.ts`の型だけの読み込みを許す
  3. Wave 1の各specが、application層に同じ形の局所的な型を定義する
- **Selected Approach**: 1(開発者の決定、2026-10-19)。型名は`SessionView`、置き場所は`apps/api/src/application/session/session-view.ts`で、`principal()`だけを持つ。セッションのIDは`AuthenticatedPrincipal.sessionId`で読む。api-gatewayの契約への追記として、本specのタスク2.3で行う。
- **Rationale**: 層の規則を弱めず、同じ型を重複させない。構造的部分型のため、リゾルバ・内部RESTは`SessionAccess`をそのまま渡せ、既存の呼び出し側は変わらない。Cookieの指示(`issue`・`clear`)をpresentation層に閉じ込められる。
- **Trade-offs**: roadmapの順ではmedia-pipelineが先に実装されるため、型を最初に置くspecが本specの2.3より先になり得る。その場合、2.3は形を確かめるだけにする。

### Decision: パッケージの配置

- **Selected Approach**: `otpauth` 9.5.2・`bowser` 2.14.1はapiだけ、`uqr` 0.1.3はfrontend-lib・client・admin(共有ディレクトリの規約により3つで同じ版)に導入する。
- **Rationale**: 秘密鍵の生成・照合とUser-Agentの解析はサーバーだけで行い、QRコードの描画だけをブラウザで行う。

## Risks & Mitigations

- 後続specの同期の波及処理が重い(行ごとの文を大量に加える) — 集合に対する1文の更新だけを加える規約にし、登録口の型で「文の配列」を返す形にして、レビューで確かめる。
- 後続specの非同期の波及処理が冪等でない — 規約で冪等を求め、同じイベントで2回呼ぶテストを各specに求める(`backend/007`に記載)。
- 物理削除の波及処理が14日以内に終わらない — 業務日付による開始で19時間以上の余地を残し、期限を過ぎた対象を個人情報なしで通知する。利用者の行への外部キーが残っていれば最後の物理削除が失敗し、取り残しを検出できる。
- 外部サービス(HIBP・DISIFY)の長期の障害 — 照合・判定を省いて処理を続け(Q3)、ログとSentryで検知する。DISIFYは「未判定」を日次で判定し直す。
- `HASH_PEPPER`の漏洩 — ペッパーだけではパスワードを復元できない(PBKDF2)。TOTPの秘密鍵はD1と鍵の両方が漏れた場合だけ復元される。
- 並行したログイン試行による制限の超過 — ログインごとのbot判定で補う。
- Wave 1の他specとの番号の衝突 — Durable Objectsの`migrations`のタグは実装時に既存の最大値の次へ詰める。`docs/GUIDES/tech`の文書番号はWave 1の割り当て(`security/006`・`external/004`〜`006`・`backend/007`)で固定した。D1のマイグレーションはmainの最新を取り込んでから生成し、衝突したら生成し直す。
- `apps/common-lib`(content-processing)の実装が本specより遅れる — roadmapの依存にcontent-processingを加え、実装の順をcontent-processing→media-pipeline→identity-authにした(2026-10-18)。本specのタスク1.3の前提に、content-processingが示す最小の区切り(1.1・1.2・2.1・4.1・4.2・6.1、11.3のうち`coding/003`の`server/**`の許可、11.4のうち日次タイムラインの表の作成)を明記した。日次タイムラインの表が無いことでは止めず、12.2で作る。
- 停止中の利用者が退会して同じメールアドレスで再登録し、停止を逃れる — 仮5の変更で防がないことを受け入れた。再登録したアカウントは新しいハンドル・仮名化IDを持ち、運営者は通報や使い捨て判定の結果をもとに再度停止できる。
- 運営者による退会の取り違え・濫用(本人確認が無く、取り消せない) — 操作口は管理者側の呼び出し元と管理者のセッションだけを受け付け、利用者側のGraphQLに公開しない。依頼者の本人の確かめ・権限の確認・監査ログはugc-moderation・admin-foundationが持つ(横断レビューN-6)。
- media-pipelineの差し込み口が本specの実装より遅れる(roadmapの依存で、順の上では先に完了しているはず。R3-2) — タスク8.5を保留して開発者へ報告し、他のタスクは進める。その間、停止中の利用者は既存のセッションでアップロードできるが、紐付けは各ドメインspecの保存で拒否され、ファイルは24〜48時間で消える(横断レビューN-7)。
- 外部キーを持たないデータ(media-pipelineの`media_files`)の取り残しは、利用者の行の物理削除の失敗では検出されない — ファイルの物理削除はuser-profile-socialの`purge_due`の波及処理が行い、その完了までイベントが`pending`に残るため、失敗は期限超過の通知で検知される。完了を返した後の取り残しの検出は、その波及処理とmedia-pipelineの責任とし、`backend/007`に規約として書く。

## References

- [HIBP API v3 Pwned Passwords](https://haveibeenpwned.com/API/v3#PwnedPasswords) — range APIとパディング
- [DISIFY Docs](https://docs.disify.com/) — 単一メールアドレスの判定、エラー、レート制限、認証
- [RFC 6238 TOTP](https://www.rfc-editor.org/rfc/rfc6238) — 時間窓と再使用の防止
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) — 応答の同一化、再認証
- [OWASP Multifactor Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html) — TOTPの秘密鍵の保護、リカバリコード
- [workerd#1346](https://github.com/cloudflare/workerd/issues/1346) — PBKDF2の反復回数の上限
- [Cloudflare Durable Objects Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) — アラームの予約と再試行
- 上流spec: `.kiro/specs/backend-platform/design.md`・`.kiro/specs/api-gateway/design.md`・`.kiro/specs/email-delivery/design.md`・`.kiro/specs/frontend-platform/design.md`
- 参照したスキル: `cc-sdd`の`kiro-spec-*`、TanStackの`tanstack-start/rules/auth-route-protection.md`(`beforeLoad`による保護と文脈の拡張)・`tanstack-router/rules/org-pathless-layouts.md`(ログイン必須の領域を経路の無いレイアウトにする)

## 上流(api-gateway)の版の更新への追従(2026-10-26)

- api-gatewayの承認後の改訂2(実装前のギャップ分析のG5)で、開発者の指示により`graphql-yoga`を5.24.1から最新のパッチ5.24.6へ上げた。本specは上流の版を使うため、design.mdのTechnology Stackの表の`graphql-yoga`の版を5.24.6に合わせた。他の記述と契約は変えていない。

## email-deliveryの実装の反映(2026-10-27、開発者の指示)

- email-deliveryの実装(同specのresearch.mdの改訂3)で、本specが使う契約の形が次のとおり決まった。開発者の指示で、design.mdを実装に合わせた。要件・タスクは変えていない。
  - 照会口の登録箇所: `USER_ADDRESS_DIRECTORY`(`apps/api/src/composition/email-registrations.ts`)は`Newable<UserAddressDirectory>`で、`API_EMAIL_MODULE`が`.to()`で束縛する。設計のファクトリ`createD1UserAddressDirectory(db)`は登録できないため、`D1UserAddressDirectory`を`@injectable()`と`@inject(PLATFORM_TYPES.Database)`のコンストラクタ引数を持つクラスにした(notificationsの`EMAIL_SENDER_INFO_PROVIDER`と同じ扱い)。
  - eventでの`SuppressionMaintenance`の束縛: `createSuppressionMaintenance`は、抑止記録(`createSuppressionRepository(db, clock)`)・送信済みの記録(`createSendRecordRepository(db)`)・照会口・1年の判定の続きの位置のストア(`createCleanupCursorRepository(db)`)の4引数を取る。本specがeventで使うのは退会時の`deleteByAddress`だけだが、`deleteByAddress`は続きの位置が同じ照合キーなら位置の行も消すため、4つとも渡す。後始末の警告ログのカテゴリは`['api', 'application', 'email-cleanup']`に固定されており、eventで`runDailyCleanup`を呼ぶとログが捨てられるが、本specは呼ばないため影響しない。
  - 日次の後始末との時刻の重なり(email-deliveryのtasks.mdの4.4の申し送り「退会の物理削除のバッチを`email-delivery.cleanup`と同じ時刻に動かさない」): 本specの4:21のジョブは`email-delivery.cleanup`(`order` 900)と同じ`21 12 * * *`の起動で先に動く。物理削除(`purge_due`、FR-USER-022)は`deleteByAddress`を呼ばないため当たらないが、`identity-auth.purge-orchestrator`の送り直しで`withdrawn`のイベントの`EmailSuppressionCleanupHandler`が後始末と並行して動くと、退会したアドレスが続きの位置の行に次に確認できた日まで残り得る。重なりの扱いは下の「開発者の決定による送り直しの時刻の分離」で決めた。
- 変えた箇所: design.mdのExisting Architecture Analysis(上流の実装の状況)、上流への影響の表のemail-deliveryの行、「D1UserAddressDirectory」(クラスの形と束縛)、「IdentityPurgeStore・EventIdentityComposition」(`SuppressionMaintenance`の4引数とログのカテゴリ)。本書のResearch Logの「上流specの契約と不足」は当時の調査の記録として残した。

## 開発者の決定による送り直しの時刻の分離(2026-10-27)

- **状態**: 2026-10-27に開発者が決定した改訂で、確定している。email-deliveryの実装の反映で、未完了のライフサイクルイベントの送り直しが4:21の`email-delivery.cleanup`と同じ起動で動くことを注記し、開発者の判断を求めていた。
- **決定**: 送り直しを`identity-auth.purge-orchestrator`から新しいジョブ`identity-auth.lifecycle-redispatch`(業務時刻16:21=UTC 0:21、cron式`21 0 * * *`、`order` 100)へ分ける。物理削除の開始(17.1)と期限超過の通知(17.4)は`identity-auth.purge-orchestrator`(4:21・100)に残す。
- **理由**: 送り直した`withdrawn`のイベントが4:21の後始末と並行して動くと、退会したアドレスが後始末の続きの位置の行に残り得る。送り直しを別の時刻にすれば、日次の起動による重なりは無くなる。物理削除の開始はDR-002・FR-USER-022で4:21の日次バッチと決まっており、`deleteByAddress`を呼ばないため動かさない。利用者の操作による退会の直後のイベントは任意の時刻に動くため、サービス仕様の準拠方針の注7の例外の文(退会の処理と確認の処理が同時に動いた場合)は残す。
- **時刻の選び方**:
  - 4:21の後始末から前後12時間離れ、送り直したイベントの非同期の波及処理が再試行(5回、300秒から倍、上限3600秒で約75分)を使い切っても後始末と重ならない。
  - 同じ業務日付の4:21に作った`purge_due`の送信が失敗しても、「最後の送信から1時間以上」を満たして同じ日のうちに送り直せる。物理削除の開始から14日の期限までの余地は最短19時間39分(業務日付の0:00に退会した場合、期限は物理削除の開始の日の翌日0:00)で、16:21の送り直しの後にも7時間39分残る。4:21のままでは送り直しが翌日の4:21になり、最短の場合は期限を過ぎていた。
  - 既存の業務時刻の枠(日次タイムラインの0:00・0:07・4:21・23:40・23:45)は使えない。0:00・0:07は最短の期限(0:00)に間に合わない。23:40・23:45はマッチの確定とペアリングの連鎖(日次タイムラインの「同時刻に走る処理の順序」)に重なり、期限までの余地も15〜20分で再試行に足りない。
  - 分は日次バッチと同じ21分にし、毎時0分の混み合いを避ける。新しいcron式になるため、apiのルートの`triggers.crons`への`21 0 * * *`の追加は本specの実装時に行う(backend-platformのcronの一致の検査が3環境の実効値で確かめる)。Cron TriggersはWorkers Paidでアカウントあたり250個で、数の上限には当たらない。16:21には予算(`SCHEDULED_RUN_BUDGETS`)を置かない(4:21だけに置く規約。送り直しは件数の上限100の軽いジョブである)。
- **要件**: 要件16.6の「業務時刻4:21の日次バッチで」を「業務時刻16:21の日次の定期実行で」に改めた。要件の意図(一定時間を過ぎた未完了のイベントを日次で再実行し、続くものを通知する)は変わらない。要件定義書(`docs/requirements/README.md`)には送り直しの時刻の記載が無いため変えていない。
- **変えた箇所**: requirements.mdの16.6。design.mdのOverview(ジョブ4つ)・Revalidation Triggers・File Structure Plan(`lifecycle-redispatch-job.ts`)・Modified Files(`scheduled-jobs.ts`・`wrangler.jsonc`の`triggers.crons`・日次タイムライン)・System Flowsの「ユーザーライフサイクルイベント」・追跡表とコンポーネントの表・`IDENTITY_TYPES.LifecycleRedispatchJob`・「PurgeOrchestratorJob・CredentialCleanupJob・DisposableRecheckSweepJob・LifecycleRedispatchJob」(ジョブの表・Trigger・分ける理由・時刻の理由)・ApiIdentityCompositionの`scheduled-jobs.ts`・Supporting References。サービス仕様の日次タイムライン(`docs/GUIDES/service/overview/007-daily-timeline.md`)に16:21の行を加えた。tasks.mdの8.4に、送り直しのジョブ(16:21・順序100)の登録の検査、apiの`triggers.crons`への`21 0 * * *`の追加、16:21の手動起動の完了状態を加え、7.10を4つのジョブに改めた。
