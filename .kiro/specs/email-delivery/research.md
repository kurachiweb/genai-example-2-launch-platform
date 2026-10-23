# Research & Design Decisions

## Summary

- **Feature**: `email-delivery`
- **Discovery Scope**: New Feature(メール送信のコードは存在しない。backend-platformの骨格・非同期処理の契約は設計済みで未実装)
- **Key Findings**:
  - Email Sendingは2026-04-16にpublic betaとなり、2026-10時点でもGAの告知は無い。Workersのバインディング(`send_email`)は構造化された`send()`を持ち、失敗は`code`付きの例外(`E_RATE_LIMIT_EXCEEDED`・`E_DAILY_LIMIT_EXCEEDED`・`E_RECIPIENT_SUPPRESSED`など)で返る。日次上限の値とリセット時刻は公開されていない。
  - Email Sendingは恒久バウンスと苦情の宛先を自動で抑止し、抑止中の宛先への送信はメール種別を問わず`E_RECIPIENT_SUPPRESSED`で拒否する。抑止には期限付き(ソフトバウンス24時間、一部の恒久バウンス7日)と期限なし(存在しない宛先、苦情)がある。
  - 配信不能イベントは2026-07-15からQueues Event Subscriptionsで受け取れる。形式はCloudflareが決めたもので、backend-platformの封筒を持たない。
  - jsx-email 3.2.1はworkerdで日本語を描画できたが、入口がすべての部品をまとめて公開するため1テンプレートで約11MBのバンドルになった。React Email(`@react-email/render` 2.1.0)はworkerd用の出力を公式に持ち、約1MBだった(開発者決定Q5でReact Emailへ変更)。

## 要件フェーズ前の確認事項(2026-10-17)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                                           | 根拠                                                                  | 回答(2026-10-17)                                                                                                                                                                    |
| --- | ---------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 抑止リストをトランザクションメールにも使うか   | FR-NOTIF-015・brief・notificationsのbrief                             | 推奨案。抑止リストは通知メール(FR-NOTIF-001〜004)の送信判定だけに使い、トランザクションメールは抑止中でも送信を試みる。プロバイダに拒否されたら再試行せず記録する                   |
| Q2  | 抑止の契機と期間                               | FR-NOTIF-015・SW-015・FR-NOTIF-016                                    | 推奨案。恒久バウンスと苦情は期限なし、受信者側の理由による拒否だけ7日間。送信側が原因の拒否は抑止せず送信不能として検知する                                                         |
| Q3  | 抑止記録の保持                                 | DR-001・DR-002・プライバシーポリシーの大枠・データ保持期間の一覧      | 推奨案。そのアドレスを登録した利用者の退会時に削除し、利用者に紐づかないアドレスの記録は最後の契機から1年で削除する                                                                 |
| Q4  | 送信上限で遅れた期限付きリンクのメール         | FR-NOTIF-013・brief・NFR-SECUR-033                                    | 推奨案。呼び出し側が送信期限を指定でき、期限を過ぎたメールは送らずに記録する。期限の無いメールはFR-NOTIF-013どおり上限のリセット後に送る                                            |
| Q5  | テンプレート描画のパッケージ                   | tech-stack.md・roadmapのConstraints・brief・CLAUDE.md(新規パッケージ) | 推奨案。`@react-email/components` 1.0.12・`@react-email/render` 2.1.0を採用する。tech-stack.mdのJSX emailの置き換えはspec段階では編集せず、導入する実装タスクで行う                 |
| Q6  | 送信元の表示名・アドレス・返信先・送信ドメイン | 要件定義書に定め無し・READMEの配信URL一覧・launch-readinessのbrief    | 推奨案。表示名「Launch Stadium」、`noreply@`、返信先なし。送信ドメインはprodが`genai-example-2-mail.lab.kurachiweb.com`、stagingが`genai-example-2-mail-staging.lab.kurachiweb.com` |
| Q7  | stagingから任意の宛先へ送るか                  | brief・READMEの配信URL一覧・Email Sendingの料金と上限                 | 推奨案。stagingは検証済みの宛先にだけ送れるよう制限し、それ以外への送信は送信不能として扱う                                                                                         |
| Q8  | backend-platformの受信部の拡張                 | backend-platform design・SW-015・brief                                | 推奨案。本specが互換を保って拡張する。backend-platformの文書は変えず、変更点と影響を本specの設計に記録する                                                                          |

### 提示した選択肢(記録)

- Q1: 通知メールだけ止める(採用) / 全メールを止める / 利用者操作が起点のメール以外を止める
- Q2: 拒否だけ7日の期限(採用) / 3種とも理由を問わず恒久 / 3種とも恒久・拒否は受信者側だけ / 拒否はきっかけにしない
- Q3: 退会時に削除(採用) / 退会後も残す / 一律1年で削除
- Q4: 期限切れは送らない(採用) / 期限に関係なく送る / トランザクションメールを優先
- Q5: React Emailに変更(採用) / jsx-emailを続ける / React単体で自作
- Q6: 環境別のドメイン・返信先なし(採用) / 返信先に連絡先を設定 / 送信ドメインを共有
- Q7: 検証済みの宛先に限定(採用) / 制限しない / 実際には送らない
- Q8: 本specが互換を保って拡張(採用) / 先にbackend-platformを改訂 / 本体Queueで受ける

### 確認済みのため質問しない事項

- roadmapの「Requirement Ambiguities」: 本specが担当する論点は無い。
- briefで要件フェーズに確認するとされた論点: 無い。Mailpitへの送信方式はbriefの指示どおり設計フェーズで決める(tech-stack.mdはHTTPの送信API)。
- ソフトバウンス: FR-NOTIF-015の「恒久的にバウンス」に従い、再試行を使い切ったソフトバウンスは抑止の契機にしない。
- 送信者情報の表示範囲: 文言規則の本文構成は送信者情報を通知種別で限定していないため、全メールに表示する。設定はnotifications(FR-ADMCF-019)が持ち、本specは差し込む区画と取得口を持つ。未設定の通知メールを送るかはnotificationsが判断する。
- 配信停止ヘッダー: Email Sendingは`List-Unsubscribe`・`List-Unsubscribe-Post`を許可しており、FR-NOTIF-008を実現できる。本specは任意のヘッダーを渡す口だけを持つ。
- 送信内容のプレビュー(送信したメールの内容を約7日ダッシュボードに保存する機能): 平文のトークンが残るため、NFR-SECUR-034の趣旨により無効にする。設定は開発者の手作業またはinfra-deliveryが行う。
- Queue上の平文トークン: コンプライアンス方針のデータ保存場所の表で「ジョブメッセージ(一時的)」として扱い済みである。ログとデッドレターの通知に本文を含めない(backend-platformのQ7)。
- 重複配信: Queuesは少なくとも1回の配送のため、送信要求の識別子で重複送信を抑える(backend-platformの冪等の規約)。
- 日次上限到達の検知: 運用者がエラートラッキングで気付けるようにする(FR-NOTIF-014の一般化)。
- 添付ファイル: 要件に添付を送る機能が無いため扱わない。
- 抑止リストの照合: 大文字小文字を区別しない(FR-USER-013と同じ扱い)。
- テンプレート以外のパッケージ: Email Sending・Mailpitの呼び出しはバインディングと`fetch`で足り、追加しない。
- staging実機での日本語送信の確認: デプロイは人の作業のため、確認手順をtasksに含めて開発者が実施する。
- 月3,000通を超える従量課金: 要件2.4のWorkers Paidが前提であり、振る舞いは変わらない。

## Research Log

### Email Sendingの送信APIと上限

- **Context**: briefの実現性チェックで、Email Sendingはpublic betaでありAPI変更に備えて抽象化する必要があると指摘された。FR-NOTIF-013・014を全種別に一般化するために、失敗の分類を確かめる。
- **Sources Consulted**: Cloudflare Docs「[Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)」「[Limits](https://developers.cloudflare.com/email-service/platform/limits/)」「[Pricing](https://developers.cloudflare.com/email-service/platform/pricing/)」「[Email headers](https://developers.cloudflare.com/email-service/reference/headers/)」「[Changelog](https://developers.cloudflare.com/email-service/platform/changelog/)」。
- **Findings**:
  - バインディング`send_email`の`send()`は`to`・`from`・`subject`・`html`・`text`・`replyTo`・`cc`・`bcc`・`attachments`・`headers`を受け取り、成功時は`{ messageId }`を返す。失敗は`code`と`message`を持つ`Error`で投げられる。
  - 失敗コードは、検証系(`E_VALIDATION_ERROR`・`E_FIELD_MISSING`・`E_TOO_MANY_RECIPIENTS`・`E_CONTENT_TOO_LARGE`・ヘッダー系7種)、設定系(`E_SENDER_NOT_VERIFIED`・`E_SENDER_DOMAIN_NOT_AVAILABLE`・`E_RECIPIENT_NOT_ALLOWED`)、宛先の抑止(`E_RECIPIENT_SUPPRESSED`)、上限(`E_RATE_LIMIT_EXCEEDED`・`E_DAILY_LIMIT_EXCEEDED`)、一時的な障害(`E_INTERNAL_SERVER_ERROR`)、配送失敗(`E_DELIVERY_FAILED`)に分かれる。再試行可否は文書に明記されていない。
  - 宛先は`to`・`cc`・`bcc`の合計50件まで、メッセージは添付込み5MiBまで、件名は998文字まで、独自ヘッダーは合計16KB・許可リストの非`X-`ヘッダーは20個まで。
  - 日次上限は新しいアカウントほど低く、送信実績に応じて自動で上がる。値とリセット時刻は公開されていない。検証済みの宛先への送信は日次上限と月間の枠に数えない。
  - Workers Paidで月3,000通を含み、超過は1,000通あたり0.35ドル。APIで拒否された送信(抑止による拒否を含む)は数えない。
  - `List-Unsubscribe`(HTTPSまたはmailtoのURI)と`List-Unsubscribe-Post`(`List-Unsubscribe=One-Click`のみ)は許可リストにある。`Reply-To`はヘッダーではなく専用の項目で指定する。
  - 送信したメールの内容をダッシュボードで約7日プレビューできる設定があり、2026-07-02以降に登録した送信ドメインでは既定で有効になる。
- **Implications**: 失敗コードを「上限による待機」「一時的(再試行)」「宛先の抑止」「恒久(再試行しない)」に分類する純粋関数を置き、プロバイダの実装はその分類だけを返す。日次上限のリセット時刻が分からないため、待機は一定の間隔で再試行する。送信内容のプレビューは無効にする手順を文書化する。

### 配信不能イベントと抑止

- **Context**: FR-NOTIF-015・SW-015。Q1・Q2の判断材料。
- **Sources Consulted**: Cloudflare Docs「[Event subscriptions](https://developers.cloudflare.com/email-service/reference/event-subscriptions/)」「[Suppressions](https://developers.cloudflare.com/email-service/concepts/suppressions/)」「[Sync recipient records](https://developers.cloudflare.com/email-service/examples/email-sending/sync-recipient-records/)」「[Subscribe to Email Sending events with Queues](https://developers.cloudflare.com/changelog/post/2026-07-15-event-subscriptions/)」。
- **Findings**:
  - 購読は送信ドメインごとで、種類は`message.delivered`・`message.deferred`・`message.bounced`・`message.failed`・`message.rejected`・`message.complained`の6つ。`type`は`cf.email.sending.message.<種類>`。
  - 共通の`payload`は`eventId`・`messageId`・`sender`・`recipient`・`subject`・`terminal`・`delivery.status`を持つ。`bounced`は`bounce.type`(`hard`・`soft`)と`classification`、`rejected`は`rejection.reason`・`party`・`detail`、`complained`は`complaint.type`を持つ。`metadata.eventSchemaVersion`は1。
  - `message.bounced`は恒久バウンスのほか、一時的な失敗の再試行を使い切った場合(`bounce.type: soft`)にも発行される。
  - `message.rejected`は抑止・検証・スパム判定による送信前の拒否で発行される。文書に載っている値は`reason: "suppressed"`・`party: "recipient"`だけである。
  - 自動の抑止はソフトバウンス24時間、一部の恒久バウンス7日、存在しない宛先と苦情は期限なし。抑止は送信ドメイン単位(苦情で送信ドメインが分からなければアカウント単位)で、メール種別の例外は無い。
  - イベントの重複・順序・遅延の保証は文書に無い。
- **Implications**: `party: "recipient"`の拒否だけを7日間の抑止とし、それ以外の`party`の拒否は送信不能として検知する(Q2)。`bounce.type: soft`は記録しない。`eventId`で冪等にし、`delivered`・`deferred`は購読しない。未知の`reason`・`party`は安全側(送信側の原因として検知)に倒す。

### テンプレートの描画パッケージ

- **Context**: roadmapの実現性チェックで、jsx-emailにはWorkersでの公式な動作手順が無いと指摘された。Q5の判断材料。
- **Sources Consulted**: npmの`jsx-email@3.2.1`・`@react-email/components@1.0.12`・`@react-email/render@2.1.0`・`react@19.3.1`・`react-dom@19.3.1`のpackage.jsonと配布物。scratchpadで同じパスワード再設定の日本語テンプレートをesbuildでバンドルし、workerd 2026-08-15(互換性日付2026-08-04)で描画した。GitHubの`shellscape/jsx-email`・`resend/react-email`のリポジトリ情報。
- **Findings**:
  - jsx-email 3.2.1: 入口`.`がすべての部品を再エクスポートし、深い参照の`exports`が無い。未使用の`Code`(shiki)・バーコード(bwip-js)が取り込まれ、minify後で約11MBになった。導入は419パッケージ・253MB。相手依存に`@types/react` 19.2.14・`@types/react-dom` 19.2.3の完全固定と3つのプラグインがある。`render()`は毎回lilconfigで設定ファイルを探索する。esbuild単体ではCommonJSの`require("node:path")`が解決できずshimが必要だった。2023年のEdge runtime対応のissueは未解決。
  - React Email: `@react-email/render`は`exports`に`workerd`条件(`dist/edge`)を持つ。バンドルは約1MB(react-dom 544KiB・prettier 245KiB)、導入は43パッケージ・32MB。相手依存はReact `^18.0 || ^19.0`だけ。`render(element, { plainText: true })`で`html-to-text`によるテキストパートを生成する。2.1.1は2026-10-16公開で、2週間の待機の規則により2.1.0を使う。
  - 両者ともHTML・テキストの両パートで日本語の件名・本文が正しく出力され、ニックネームの`<`・`>`はエスケープされた。手元のworkerdでの起動から最初の応答までは、jsx-emailが約195ms、React Emailが約73msだった(本番の起動時間の代わりにはならない)。
- **Implications**: React Emailを採用する(Q5)。`@react-email/render`の`pretty`オプションは使わず(prettierの動的読み込みを避ける)、テキストパートは`plainText`で同じ要素から生成する。workerd上の描画と日本語・エスケープはWorkers統合テストで確かめる。

### ローカル開発の送信先

- **Context**: briefの「ローカルのMailpitへの送信方式は設計フェーズで決める」。tech-stack.mdはMailpitのHTTP送信APIを指定している。
- **Sources Consulted**: Cloudflare Docs「[Local email sending](https://developers.cloudflare.com/email-service/local-development/sending/)」、Mailpit 1.32.0(`/workspace/Dockerfile`・`/workspace/scripts/entrypoint.sh`)、Mailpitの`/api/v1/info`への疎通。
- **Findings**:
  - `wrangler dev`は既定で`send_email`をローカルで模擬し、内容をローカルのファイルとログへ出すだけで、受信箱としては確認しにくい。`remote: true`にすると実際に送信される。
  - Mailpitは開発コンテナでポート48041(UIとHTTP API)に常駐する。SMTPの既定ポートは公開されていない。workerdから任意ポートへのSMTP(`connect()`)はTCPソケットで可能だが、SMTPの会話を自作する必要がある。
- **Implications**: ローカルの送信実装はMailpitのHTTP送信API(`POST /api/v1/send`)を`fetch`で呼ぶ。SMTPは使わない。

### 参照したスキル

- `cloudflare:cloudflare-email-service`: バインディング・失敗コード・ヘッダー・抑止・イベントの参照先、テキストパートを必ず付ける規則、トランザクション用途に限る規則。
- `cloudflare:workers-best-practices`・`cloudflare:wrangler`: バインディングの環境ごとの定義、`wrangler types`の再生成。プロジェクト規則により`.dev.vars`は作らない。
- `ecc:error-handling`: 失敗の分類を判別可能なユニオンで表し、想定内の失敗をエラートラッキングへ送らない方針。

## Architecture Pattern Evaluation

| Option                               | Description                                                                         | Strengths                                                                                          | Risks / Limitations                                                               | Notes  |
| ------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| ポートとアダプタ+共有コードの最小化  | 判断を`core/email`の純粋関数に置き、送信・描画・保存をポートの実装にする            | betaのAPI変更や代替サービスへの切り替えを実装の追加で吸収できる。判断をBunの単体テストで網羅できる | ポートが増える                                                                    | 採用   |
| 送信を呼び出し側の処理単位で直接行う | APIサーバーの処理内で送信プロバイダを呼ぶ                                           | 単純                                                                                               | 応答時間と結果が送信プロバイダの障害に左右される(要件1.4・1.5に反する)            | 不採用 |
| 受付時に描画してQueueへHTMLを載せる  | apiで描画し、consumerは送るだけにする                                               | consumerが軽い                                                                                     | apiにもReactが要り、Queueのメッセージが大きくなり、送信者情報の変更が反映されない | 不採用 |
| メールイベントを本体Queueで受ける    | Event Subscriptionsの配信先を`JOBS_QUEUE`にし、封筒の解析でCloudflareの形式も受ける | Queueが増えない                                                                                    | 封筒の不正の検出が弱まり、受信部の変更はどのみち要る(Q8の選択肢3)                 | 不採用 |

- 描画はeventのconsumerで行い、Reactをeventだけに閉じ込める。受付(api・event)は種別の契約(zodの検証規則)だけを使い、Reactに依存しない。
- 共有コード(`apps/backend-lib`)には、両アプリが使う部品(種別の契約・受付・抑止リスト・送信済みの記録)だけを置く。

## Design Decisions

### Decision: 送信プロバイダは失敗を例外ではなく結果として返す

- **Context**: 要件5・6。Email Sendingは失敗を`code`付きの例外で返し、Mailpitは状態コードで返す。
- **Alternatives Considered**:
  1. 例外のまま投げ、送信処理で`code`を見る — プロバイダごとに例外の形が違い、判断が送信処理に漏れる。
  2. 実装が`EmailProviderOutcome`(判別可能なユニオン)を返す — 判断は`decideAfterOutcome`の純粋関数に集まる。
- **Selected Approach**: 2。分類はEmail Sendingのコード表(`classifyCloudflareSendError`)とMailpitの状態コードで行う。未知のコードは`temporary`として再試行し、上限で検知する。
- **Trade-offs**: 新しいコードが増えたときに表の更新が要る。再試行の上限で必ず検知されるため、取りこぼしはしない。

### Decision: 送信上限はbackend-platformの`defer`で待ち、日次上限は1時間ごとに試す

- **Context**: 要件5(FR-NOTIF-013の一般化)。日次上限のリセット時刻は公開されていない。
- **Selected Approach**: 送信レートの上限は60秒、日次上限は3600秒の`defer`。`defer`は同じIDの封筒を再送し試行回数に数えない(backend-platformの契約)。上限到達の警告は`email_alert_throttles`で1時間に1回に間引き、Sentryのfingerprintで1つの問題にまとめる。
- **Rationale**: 待機中の件数が多いと、毎回の通知でSentryの枠を使い切るため。
- **Trade-offs**: リセット直後の送信開始が最大1時間遅れる。

### Decision: 一時的な障害の再試行は5回・約30分

- **Context**: 要件6。backend-platformのQueuesの`max_retries`は6で、ディスパッチャの`maxAttempts`より大きい必要がある。
- **Alternatives Considered**:
  1. 回数を8回に増やす — `max_retries`の変更(backend-platformの設定と検査の変更)が要る。
  2. 回数5回のまま間隔を120秒から始める(120・240・480・960秒) — 上流の設定を変えずに約30分待てる。
- **Selected Approach**: 2。5回目の試行で失敗したら、`SendEmailHandler`自身が送信不能を種別付きで通知して完了する。デッドレターへの自動の移送は、consumer自体の異常終了の場合だけに残す。
- **Follow-up**: 運用で30分を超える障害が多ければ、`max_retries`の変更をbackend-platformの再検証として扱う。

### Decision: 重複送信を送信要求の識別子で防ぐ

- **Context**: 要件6.7。Queuesは少なくとも1回の配送で、`ack`の前に処理が落ちると再配信される。
- **Selected Approach**: 送信の成功後に`email_send_records`へ封筒のIDを記録し、送信前に確かめる。記録の失敗はログにとどめて完了し、再送を避ける。行は14日(Queuesの保持期間の上限)で削除する。
- **Trade-offs**: 送信の成功と記録の間で落ちた場合は重複し得る(残る窓は小さい)。

### Decision: 抑止記録はメールアドレスを平文で持つ

- **Context**: Q3(利用者に紐づかない記録は1年で削除)。ハッシュだけを持つと、1年経過の判定で利用者に登録済みかを照会できない。
- **Alternatives Considered**:
  1. 鍵付きハッシュだけを持ち、identity-authに利用者のアドレスのハッシュを持たせる — identity-authの負担が増え、用途の異なるハッシュの管理が要る。
  2. 鍵付きハッシュだけを持ち、identity-authがアドレスの紐付けと解除を都度通知する — 呼び出しの漏れで記録の状態が狂う。
  3. 平文を`textNoCase`で持ち、照会口に照合キーを渡す — 単純で、利用者のテーブルと同じ保護水準。
- **Selected Approach**: 3。保存項目を照合と保持の判定に要るものに限り、件名・応答を持たない。保持期間をサービス仕様に明記する。
- **Trade-offs**: 抑止記録に平文のメールアドレスが残る。ログ・Sentryには出さない。
- **Approval**: 設計時の判断として開発者に確認し、2026-10-17に承認された(requirements.mdの決定事項Q9)。選択肢は「平文で保存(採用)」と「鍵付きハッシュで保存し、identity-authの利用者テーブルにも同じ鍵のハッシュ列を置く」。

### Decision: 封筒を持たないQueueの登録口をbackend-libへ追加する(Q8)

- **Context**: 要件7.10・SW-015。backend-platformの受信部は本体とデッドレター以外のQueueを例外にする。
- **Selected Approach**: `createQueueDispatcher`に任意の第3引数`{ rawQueues }`を加え、登録された名前のQueueは`RawMessageHandler`へ1件ずつ渡す。失敗は同じ`decideOnFailure`で再試行し、上限で本文を含まない`DeadLetterNotice`(`raw:<name>`)を送る。
- **Rationale**: 既存の再試行・デッドレター・ログの規約を再利用でき、第3引数を省略した既存の呼び出しは変わらない。
- **Follow-up**: backend-platformの既存のテストを変更せずに通すこと。変更点はdesign.mdの「RawQueueDispatch」に記録し、backend-platformの文書は変えない。

### Decision: 疎通確認の経路を設ける

- **Context**: 要件11.4・11.5(briefの「日本語の件名と本文の送信を検証済み」)。下流specの実装前には、メールを送る業務の経路が無い。AIエージェントは`wrangler deploy`と`wrangler dev --remote`を実行できない。
- **Alternatives Considered**:
  1. `wrangler email sending send`で描画結果を送る — バインディングの経路(構造化された`send()`)を確かめられない。
  2. eventに、シークレットで保護し宛先を固定した`POST /internal/email/smoke`を置く — 本番と同じ経路(Queue→consumer→描画→送信)を通る。
- **Selected Approach**: 2。トークンと宛先の両方のシークレットが設定された環境だけで有効にし、prodでは設定しない。
- **Trade-offs**: 外部から到達できる経路が1つ増える。トークンの比較は時間一定、IP単位の制限の対象、宛先は固定で濫用の余地が小さい。

### Generalization・Build vs Adopt・Simplification

- **Generalization**: 配信不能イベントの受け取りを、メール専用ではなく「封筒を持たないQueueの登録口」として作り、Cloudflareの他のEvent Subscriptions(R2のイベントなど)も同じ形で受けられるようにする。実装はメールイベントの1件だけ。抑止の照会は1件(`getStatus`)と複数件(`findSuppressed`)の2つで、notificationsの一括の絞り込みに使える。
- **Build vs Adopt**:
  - 採用: React Email(描画とテキストパート)、Email Sendingのバインディング、MailpitのHTTP API、Email Sending自身の抑止(トランザクションメールの拒否はこれに任せる)、backend-platformの再試行・`defer`・デッドレター。
  - 自作: 失敗コードの分類表、抑止の方針と合成(要件固有の規則)、送信済みの記録、警告の間引き。
  - 不採用: jsx-email(Q5)、SMTPでのMailpitへの送信(SMTPの会話の自作が要る)、Email SendingのREST APIの抑止リストとの同期(APIトークンが要り、要件はイベントからの記録で満たせる)。
- **Simplification**:
  - 送信履歴・送信内容の保存、開封の計測、添付・複数宛先は作らない。
  - テンプレートのプレビュー用サーバー(React EmailのCLI)は導入せず、ローカルのMailpitで確かめる。
  - 送信者情報の保存と設定画面は作らず、取得口と未設定の既定実装だけを持つ。

## Risks & Mitigations

- Email Sendingがpublic betaのままAPIや失敗コードが変わる — 失敗の分類を1つの表に集め、未知のコードは再試行して上限で検知する。`EmailProvider`の実装の差し替えで代替サービスにも移れる。
- 日次上限が低いままローンチ時に通知が集中し、送信が大きく遅れる — 上限到達をSentryで検知し、Cloudflareへ上限の引き上げを申請する手順を技術ドキュメントとlaunch-readinessの準備項目に入れる。期限付きのメールは期限切れで送らない(Q4)。
- vitest-pool-workersが`@react-email/render`の`workerd`条件の出力を解決できない — 最初のタスクで描画のWorkers統合テストを書いて確かめる。解決できなければ`resolve.conditions`の設定を加える。
- react 19.3.1(2026-10-14公開)の修正が19.3.0に無い — 公開から2週間後に19.3.1へ上げる。frontend-platformの版と合わせる。
- Event Subscriptionsの配信の重複・順序・遅延の保証が文書に無い — 抑止の合成を冪等かつ可換にし、順序に依存しない。
- 抑止記録に平文のメールアドレスが残る — 保存項目を最小にし、退会時・1年・期限切れで削除し、保持期間をサービス仕様に明記する。
- 疎通確認の経路の濫用 — シークレットで保護し、宛先を固定し、prodでは無効にする。
- CIのE2Eで下流specがメールを読む必要が出たとき、CIにMailpitが無い — 技術ドキュメントにMailpitの検索APIを記載し、CIへの導入はinfra-deliveryで扱う。

## References

- [Email Service: Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) — `send()`の項目と失敗コード
- [Email Service: Limits](https://developers.cloudflare.com/email-service/platform/limits/) — 宛先数・大きさ・ヘッダーの上限、日次上限の考え方
- [Email Service: Pricing](https://developers.cloudflare.com/email-service/platform/pricing/) — Workers Paidの枠と従量課金
- [Email Service: Email headers](https://developers.cloudflare.com/email-service/reference/headers/) — 許可リストと`List-Unsubscribe`の規則
- [Email Service: Event subscriptions](https://developers.cloudflare.com/email-service/reference/event-subscriptions/) — イベントの種類と本文の形
- [Email Service: Suppressions](https://developers.cloudflare.com/email-service/concepts/suppressions/) — 自動の抑止と期限
- [Email Service: Configure send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/) — `allowed_sender_addresses`・`allowed_destination_addresses`
- [Email Service: Local email sending](https://developers.cloudflare.com/email-service/local-development/sending/) — `wrangler dev`での模擬と`remote`
- [Mailpit API v1](https://mailpit.axllent.org/docs/api-v1/) — `POST /api/v1/send`と検索API
- [React Email: render](https://react.email/docs/utilities/render) — HTMLとテキストパートの生成
