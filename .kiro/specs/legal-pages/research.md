# Research & Design Decisions

## Summary

- **Feature**: `legal-pages`
- **Discovery Scope**: Extension(法務文書の実装・モックアップは無い。上流の8spec(dev-tooling・backend-platform・api-gateway・frontend-platform・infra-delivery・content-processing・identity-auth・admin-foundation)の設計・タスクは承認済みで実装は未着手であり、本specはその契約の上に法務文書のデータ・管理画面・公開ページを足す。外部サービス・新しいパッケージ・新しい資源が無いため軽量の調査を行い、同時の操作の扱いだけを詳しく調べた)
- **Key Findings**:
  - 利用者側の共通フッターの`/terms`・`/privacy`・`/legal`へのリンクは、frontend-platformの要件11.2で実装済みである。本specはリンク先のページだけを作る(briefの「フッターのリンクを共通レイアウトに追加する」は既に満たされている)。
  - frontend-platformはページの応答に`Cache-Control: no-store`を付けるため、公開の直後から公開ページが新しい版を返す。キャッシュの無効化の仕組みは要らない。
  - D1の`db.batch()`は前の文の結果で後の文を変えられない。下書きの保存・破棄は`state_version`を条件にした1文の更新で、公開は先頭の版の挿入の`version_number`を条件付きの副問い合わせにし、条件を満たさなければNOT NULL制約の違反で一括の書き込み全体を取り消す方式で実現できる(admin-foundationの最後の最上位管理者の保護、identity-authの`UserLifecycleCommitter`と同じ方式)。
  - 本文の上限100,000書記素は、api-gatewayのGraphQLの要求の上限(1MiB)とD1の行の上限(2,000,000バイト)の範囲に収まる。1MiBを超える要求はapi-gatewayが413で拒否するため、行の上限に達する前に止まる。
  - admin-foundationの`AuditTargetKind`は`legal-document`を含むが、Q1により本specは監査ログに記録しない。値が残っても害は無い。

## 要件フェーズ前の確認事項(2026-10-23)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点             | 根拠                                                                                                                                                | 回答(2026-10-23)                                                                                                                                                                                                                                                                                                      |
| --- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 監査ログへの記録 | FR-ADMAG-001・FR-ADMAG-007〜008、brief Desired Outcome、admin-foundationの`AuditTargetKind`とQ6(記録範囲はFR-ADMAG-001の列挙どおり)                 | 選択肢3(改訂履歴に編集者を持つ)。監査ログには記録せず、改訂履歴の行に管理者のIDを持たせ、編集者は管理画面にだけ表示する。削除済みの管理者は「削除済み」と表示する                                                                                                                                                     |
| Q2  | 過去版の本文保存 | FR-ADMAG-008(記録の対象は変更概要と保存日時だけ)、identity-authのQ4(同意した版を日時の照合で特定する)、LR-006(同意の立証)                           | 選択肢2(公開ページでも閲覧可)。全版の本文を保存し、管理画面と公開ページの改訂履歴の各行から過去版を開ける。過去版用のURLは設計で決め、ページ配置へ追記する。差分表示と新しいパッケージは入れない                                                                                                                      |
| Q3  | 保存と公開の時機 | FR-ADMAG-008、準拠方針「法務文書の改訂」(重要な変更には周知期間を設ける運用)、利用規約の大枠の章18、identity-authのQ4                               | 選択肢3(下書きと公開を分ける)。下書きは管理画面だけに保存し、公開の操作をしたときに変更概要を記録して公開する。改訂履歴に載るのは公開した版だけ。identity-authのQ4は「公開日時」との照合になるため、用語をそろえ、identity-auth側の文言の修正を上流への影響として報告する。FR-ADMAG-008の改訂の要否も判断して記録する |
| Q4  | 重要な改訂の周知 | 利用規約の大枠の章18、プライバシーポリシーの大枠の章13、準拠方針「法務文書の改訂」、FR-HELP-006(ピン留めヘルプ記事はフッターに出る)                 | 推奨案(システムでは周知しない)                                                                                                                                                                                                                                                                                        |
| Q5  | 本文の文字数上限 | 文言規則「入力欄の文字数上限」(変更概要の200文字だけがある)、content-processing(上限は各ドメインspecが決める)、api-gateway(GraphQLの要求は1MiB以下) | 推奨案(100,000書記素)                                                                                                                                                                                                                                                                                                 |
| Q6  | 初期データの投入 | brief Desired Outcome(初期データとして3文書の枠を用意し、本番公開前に開発者が本文を投入する)、roadmapのOut(本文の起草は対象外)                      | 推奨案(空の枠と「準備中」)。初版は管理画面で下書きを保存して公開する流れになる                                                                                                                                                                                                                                        |
| Q7  | 管理者側のリンク | LR-001(利用者側の全ページ)、brief(管理者側の扱いは要件フェーズで確認する)、admin-foundation(管理者側のレイアウトにフッターの区画は無い)             | 推奨案(置かない)                                                                                                                                                                                                                                                                                                      |

### 提示した選択肢(記録)

- Q1: 監査ログに記録する(推奨。保存のたびに操作した管理者・文書の種類・改訂のIDを記録し、理由欄は変更概要で代える。FR-ADMAG-001にFR-ADMAG-007を加える改訂が要る) / 記録しない(要件どおり。誰が改訂したかを追えない) / 改訂履歴に編集者を持つ(採用。監査ログには記録せず、改訂履歴の行に管理者のIDを持たせ、編集者は管理画面にだけ表示する)
- Q2: 保存し管理画面で閲覧(推奨。全版の本文を残し、公開ページには最新版だけを出す) / 公開ページでも閲覧可(採用。過去版用のURLが増える) / 2に差分表示を追加(`diff` 9.0.0、BSD-3-Clause、依存なし、2026-04-13公開、workerdとブラウザで動く純粋なJavaScript) / 本文は保存しない(要件の文言どおり。同意した版の文面を後から特定できない)
- Q3: 保存で即時公開(推奨。周知期間は本文や変更概要に施行日を書く運用で対応し、同意した版は保存日時で照合する) / 施行日時を予約できる(施行までは現行版を表示して改訂予定を予告し、照合は施行日時。要件定義書の改訂が要る) / 下書きと公開を分ける(採用。下書きは管理画面だけに保存し、公開の操作で変更概要を記録して公開する)
- Q4: システムでは周知しない(推奨・採用。ピン留めしたヘルプ記事などの運用で周知する) / 利用者側に告知の帯(「重要な変更」と指定すると一定期間ヘッダー直下の帯に表示する) / 全利用者へメール(email-deliveryの送信量の上限と一斉送信の仕組みの拡張が要る)
- Q5: 100,000文字(推奨・採用) / 50,000文字 / 30,000文字(将来の追記で足りなくなるおそれ)
- Q6: 空の枠と「準備中」(推奨・採用。マイグレーションで本文と改訂履歴の無い3件を作り、初回の公開までは準備中を表示し、登録画面は止めない) / コマンドで本文を投入(リポジトリ内のマークダウンのファイルをデータベースへ入れる。stagingとprodの実行は開発者の手作業) / 未投入なら404
- Q7: 置かない(推奨・採用。管理画面の法務文書の画面に各公開ページへのリンクを置く) / 管理者側にもフッター(管理者側の基本レイアウトにフッターを足す。frontend-platformとadmin-foundationの再検証が要る)

### 確認済みのため質問しない事項

- 公開ページのURL: `/terms`・`/privacy`・`/legal`はページ配置で確定しており、identity-authの登録画面もこのURLへリンクする。
- 利用者側フッターのリンク: frontend-platformの要件11.2で、共通フッターに利用規約・プライバシーポリシー・法的通知へのリンクがある。本specはリンク先のページを作るだけである。LR-001の対象は3文書すべてである(briefの「利用規約へのリンク」より広い)。
- 管理画面のURLとメニュー: 法務文書は`/legal-documents`(`order` 120、admin-foundationの仮6。2026-10-23に承認済み。同時に管理者アカウントのURLは`/accounts`へ変更された)。
- 権限: 閲覧は全ロール、編集(下書きの保存・破棄・公開)は最上位管理者だけ(FR-ADMAG-007、admin-foundationのQ3)。
- 規約への同意の記録: 同意した日時だけを保存し、版は改訂履歴の日時との照合で特定する(identity-authのQ4)。改訂後の再同意は求めない(利用規約の大枠の章18「変更後の利用による同意」)。
- 変更概要: 200書記素以内で必須(FR-ADMAG-008・文言規則)。数え方はcontent-processingの`countGraphemes`。版は変更・削除しない。
- 改訂履歴の表示: 各ページの末尾に全件を新しい順に表示し、ページ送りはしない(FR-ADMAG-010)。日時は`<time datetime>`で、表示形式は閲覧者のロケールに従う(I18N-002・004、デザイン原則、frontend-platformの`DateTime`)。
- マークダウン: 入力欄`MarkdownEditor`と表示部品`MarkdownContent`、描画・サニタイズ・見出しのアンカー(接頭辞`user-content-`)はcontent-processingの部品(FR-MDOWN-001〜012、content-processingのQ2・Q5・Q6)。本文は原文で保存し、描画結果のHTMLは保存しない。
- 本文中の外部リンクの`rel`: ページ配置の表に法務文書の行が無い。管理者が書く本文のため`noopener`だけとし、ページ配置に行を加える(設計の既定)。
- 法的通知の事業者情報: 管理画面でマークダウンの本文に書く(法的通知の大枠)。FR-ADMCF-024の送信者情報を自動で埋め込まない。
- 監査ログ・アクセス制御・管理画面の部品: admin-foundationの`requireAdmin`・`AdminDirectory`・`ADMIN_NAV_ITEMS`・`AdminPageHeader`・`AdminDataTable`・`ConfirmActionDialog`・`RoleGate`を使う。
- 対象外: paymentsの決済画面からのリンク、identity-authの同意の記録、ヘルプ記事、全文検索(法務文書はFR-FTSの対象外)。
- 新しいパッケージ: 導入しない(Q2で差分表示を採らなかった)。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する。

### 仮決定(2026-10-23に開発者が承認)

要件と設計の作成中に生じた、開発者の判断を要する論点である。回答と上流specに最も整合する案を仮に採用して設計・タスクを作り、2026-10-23に開発者がすべて採用した案のまま承認した。仮1はQ2の回答で設計に委ねられた論点である。

| #   | 論点                    | 確定した案                                                                                                                                                                                                        | 他の選択肢                                                                                    | 影響する箇所                                                    |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 仮1 | 過去版のURL             | `/terms/revisions/{版番号}`・`/privacy/revisions/{版番号}`・`/legal/revisions/{版番号}`。版番号は文書ごとに初版を1とする連番。過去版のページは`noindex`。正の整数以外(先頭の0・符号・小数)は404(2026-10-23に承認) | 公開日で表す`/terms/2026-10-23`(同じ日に2回公開すると衝突する) / 版のULIDで表す(人が読めない) | 要件7、`LEGAL_DOCUMENT_PATHS`・`parseVersionNumber`、ページ配置 |
| 仮2 | 本文が同じ版の公開      | 拒否する(`legal_document_unchanged`)。変更の無い版が改訂履歴に載るのを防ぐ(2026-10-23に承認)                                                                                                                      | 許可する(変更概要だけの版ができる)                                                            | 要件4.3、`LegalDocumentRules.checkPublishable`                  |
| 仮3 | 下書きの同時編集        | 文書ごとの状態の版(`state_version`)で、読み込んだ後に他の保存・破棄・公開があれば後の操作を拒否する(`legal_document_conflict`)。画面は再読み込みを促す(2026-10-23に承認)                                          | 後勝ち(後から保存した側で上書きする)                                                          | 要件3.10・4.4、`D1LegalDocumentStore`                           |
| 仮4 | 管理画面の文書ごとのURL | 編集の画面`/legal-documents/{terms\|privacy\|legal-notice}`、版の表示`/legal-documents/{種類}/revisions/{版番号}`(2026-10-23に承認)                                                                               | 1画面のタブで3文書を切り替える(URLで文書を指せない)                                           | 要件2・5、管理画面のルート、ページ配置                          |
| 仮5 | 日時の表示形式          | 公開ページと過去版のページは日付(`longDate`、例「2026年10月23日」)、管理画面は日時(`dateTime`)。どちらも`datetime`属性はミリ秒までのUTCの時刻(2026-10-23に承認)                                                   | 公開ページも日時で表示する                                                                    | 要件5.1・6.1・6.3・6.7・7.1、各表示部品                         |
| 仮6 | 準備中のページの応答    | 状態コード200で「この文書は準備中です。」を表示し、`noindex`を付ける。登録画面などからのリンクが404にならないようにする(2026-10-23に承認)                                                                         | 404を返す(Q6の選択肢3と同じになる)                                                            | 要件6.6、`LegalDocumentPage`                                    |

### 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂が必要である。

| 要件ID       | 内容                                                                                                                                                                                                                                                             | 根拠       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| FR-ADMAG-007 | 編集した本文を管理画面だけで見える下書きとして保存し、公開の操作で公開する旨を加える                                                                                                                                                                             | Q3         |
| FR-ADMAG-008 | 「本文編集と併せて、200文字以内の変更概要の入力を必須とし、それを保存日時と併せて改訂履歴として記録」を「公開の操作で、200文字以内の変更概要の入力を必須とし、公開した本文・公開日時・公開した管理者とともに版として記録する。下書きの保存は記録しない」に改める | Q1・Q2・Q3 |
| FR-ADMAG-010 | 改訂履歴の各行から、その版の本文を表示するページへ移動できる旨と、改訂履歴に公開した管理者を表示しない旨を加える                                                                                                                                                 | Q1・Q2     |

FR-ADMAG-001は改訂しない。Q1により法務文書の操作を監査ログの対象に加えない。文言規則の入力欄の上限の表への「法務文書の本文(100,000文字)」の追加は、サービス仕様の更新として本specが行う(Q5)。

### 上流・後続specへの影響

- identity-auth(再検証・文言の修正): requirements.mdの決定事項Q4「legal-pagesの改訂履歴の保存日時と突き合わせて特定する」と、Adjacent expectationsの「legal-pagesは、本specが保存する同意日時と照合できる改訂履歴の保存日時を持つ」、research.mdのQ4の「改訂履歴の保存日時」を、それぞれ「改訂履歴の公開日時」に改めた(2026-10-23、開発者の許可を得て本specの作業で反映)。本specは公開日時をミリ秒の精度で持ち、同意日時以前で最も新しい版を返す照会口`LegalVersionLocator`を提供する(要件8)。identity-authの実装・保存する値は変わらない。
- admin-foundation(再検証は不要): `ADMIN_NAV_ITEMS`へ法務文書(`/legal-documents`、`order` 120)を追記する(契約どおり)。`AuditTargetKind`の`legal-document`はQ1により本specでは使わない。残しても害は無く、削除するかはadmin-foundationの判断に委ねる。
- frontend-platform(変更なし): 共通フッターのリンク(11.2)のリンク先を本specが作る。
- content-processing(変更なし): `MarkdownEditor`・`MarkdownContent`・`useMarkdownOptions`・`markdownTextSchema`・`countGraphemes`を契約どおり使う。
- payments(後続): 決済画面から`/legal`へリンクする。返金ポリシーの見出しへ直接リンクする場合、アンカーは本文の見出しの文字列から作られる(`#user-content-`と見出しのスラッグ)ため、見出しの文言を変える改訂でリンクが切れる。paymentsはアンカー無しの`/legal`へのリンクにするか、見出しの文言の固定を運用で決める。
- launch-readiness(後続): 本番公開の前に、開発者がprodの管理画面で3文書の初版を公開したことを確かめる(Q6)。
- inquiry-chat(並行して作成中): roadmapの順で本specの後のため、技術ドキュメントの番号は本specが割り当てた`db/005`の後を使う。
- data-export(後続、変更なし): 本specは利用者のデータを持たない(版と下書きは管理者のIDだけを持ち、同意日時はidentity-authが保存する)。データエクスポートの文書にも法務文書の項目は無いため、エクスポートの部品は持たない。

## spec横断レビューの指摘の反映(2026-10-23に開発者が決定)

全specを横断したレビューの指摘と開発者の決定(2026-10-23)を、本specの要件の決定事項の表・設計・タスクに反映した。`spec.json`の承認の状態は変えていない。

| #   | 指摘                                                                                                                    | 決定と反映                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| X1  | (軽微)要件の決定事項の表の仮4の行で、承認の日付が`{terms\|privacy\|legal-notice}`の途中に入り、表の列が崩れている       | `/legal-documents/{terms\|privacy\|legal-notice}`に直し、「(2026-10-23に承認)」をセルの末尾へ移した。本書の仮決定の表の仮4の行も同じ崩れがあったため同様に直した。他の行に同じ崩れは無い                                                                                                                                                         |
| X2  | (軽微)E2Eで最上位管理者を用意する補助(`e2e/support/admin-sign-in.ts`)が、admin-foundation・inquiry-chatの補助と重複する | admin-foundationが`e2e/support/admin-bootstrap.ts`の`signInAsNewAdmin`(指定したロールの管理者を招待・完了・ログインさせる)を所有する。本specは`admin-sign-in.ts`を作らず、`signInAsNewAdmin(page, { role: 'super_admin' })`を使う。設計のAllowed Dependencies・Revalidation Triggers・File Structure Plan・Testing Strategyとタスク7.1に反映した |
| X3  | (判断)admin-foundationの`AdminDirectory`を、apiとeventの両方で使えるよう`backend-lib/workers/admin`へ移す               | 本specは`AdminDirectory.findProfiles`を形を変えずに使う。読み込み先を`backend-lib/workers/admin`に改めた(Allowed Dependencies・Existing Architecture Analysis・Dependency Direction)                                                                                                                                                             |
| X4  | (判断)「kB」「MB」はプロジェクト全体で1kB=1,024バイト・1MB=1,048,576バイトとする                                        | 本specの上限はMiB(api-gatewayの1MiB)と書記素の数で表し、単位の解釈に影響されない。research.mdの概算の「約300KB」を「約300,000バイト(約293kB)」に直した                                                                                                                                                                                           |
| X5  | (判断)データエクスポートは各ドメインが自分のエクスポート部品を所有する                                                  | 本specは利用者のデータを持たないため、エクスポートの部品は持たない(上流・後続specへの影響のdata-exportの行)                                                                                                                                                                                                                                      |

## Research Log

### 上流specの契約と再利用

- **Context**: 本specは上流の契約の上に作る。再利用する部品と、足りない契約が無いかを確かめた。
- **Sources Consulted**: `.kiro/specs/admin-foundation/design.md`(`requireAdmin`・`AdminDirectory`・`AdminProfileView`・`ADMIN_NAV_ITEMS`・`AdminPageHeader`・`AdminDataTable`・`ConfirmActionDialog`・`RoleGate`・`AuditOperator`の形・File Structure Plan)、`.kiro/specs/content-processing/design.md`(`MarkdownRenderOptions`・`MarkdownContentProps`・`MarkdownEditorProps`・`markdownTextSchema`・`useMarkdownOptions`)、`.kiro/specs/frontend-platform/design.md`(`executeGraphQL`・`graphqlQueryOptions`・`buildPageHead`・`DateTime`・`DATE_TIME_FORMATS`・`notFoundComponent`・ページの`no-store`・フッターの11.2)、`.kiro/specs/api-gateway/design.md`(`defineSchemaModule`・`withValidatedArgs`・`DateTime`のスカラー・要求の1MiBの上限・呼び出し元別の許可リスト)、`.kiro/specs/backend-platform/design.md`(`ulidPrimaryKey`・`timestamps`(ミリ秒)・`AppErrorKind`)、`docs/GUIDES/tech/db/001`・`002`。
- **Findings**:
  - 必要な部品はすべて上流にある。admin-foundationの`AuditOperator { id, nickname }`(削除済みは`nickname: null`)と同じ形で、版の公開者を表せる。
  - `useMarkdownOptions`は`siteOrigin`を`PublicRuntimeConfig.clientSiteOrigin`から補い、管理者側のプレビューでも利用者側のオリジンを使う。
  - `buildPageHead`は`noIndex`で`<meta name="robots" content="noindex, nofollow">`を出す。過去版と準備中のページに使える。
  - 共通カラムの`timestamps()`はエポックミリ秒で、identity-authの同意日時(ミリ秒)とそのまま比較できる。
- **Implications**: 新しい共通部品・パッケージは要らない。公開者の型は`LegalDocumentPublisher { id, nickname }`とし、`AdminDirectory.findProfiles`で引く。

### 同時の操作と一括の書き込み

- **Context**: 最上位管理者が複数いる場合、同じ文書の下書きを同時に編集・公開しうる(仮3)。公開では版番号の採番・版の挿入・下書きの削除を一度に確定させたい(要件1.3・4.1)。
- **Sources Consulted**: `docs/GUIDES/tech/db/002-d1-constraints.md`(`db.transaction()`の禁止・`db.batch()`)、admin-foundationの`buildAuditLogStatements`の`CASE`式、identity-authの`D1UserLifecycleCommitter`。
- **Findings**: D1は1つのデータベースへの書き込みを直列に処理し、`db.batch()`は1つのトランザクションとして途中の制約違反で全体を取り消す。前の文の結果で後の文を分岐できない。
- **Implications**: 文書の行に`state_version`を持たせる。保存・破棄は`WHERE kind = ? AND state_version = ?`の1文の更新で、変更が0行なら競合とする。公開は、先頭の版の挿入で`version_number`と`body`を`legal_documents`からの副問い合わせ(`state_version`と下書きの存在を条件にする)で埋め、条件を満たさなければNOT NULL制約の違反で全体を取り消す。続く文で文書の行を更新する。一意索引`(document_id, version_number)`を最後の防御にする。

### 本文の大きさの上限

- **Context**: 本文の上限を100,000書記素にした(Q5)。書記素は複数のコードポイントから成りうるため、バイト数の上限を確かめた。
- **Sources Consulted**: api-gatewayの`/graphql`(本文1MiB以下、超えたら413`payload_too_large`)、Cloudflare D1の上限(文字列・行の最大2,000,000バイト、束縛変数は1文100個)。
- **Findings**: 日本語の法務文書は1書記素が3バイト程度で、100,000書記素でも約300,000バイト(約293kB)である。絵文字の結合などで1書記素が大きくなっても、GraphQLの要求の1MiBで先に止まる。文書の行は下書き(最大約1MiB)だけを持ち、版の行は1つの本文だけを持つため、行の上限に達しない。
- **Implications**: バイト数の独自の検査は設けない。413の応答は管理画面で「本文が大きすぎるため保存できません。」として表示する。

### 保存していない変更の確認

- **Context**: 編集の画面から離れるときの確認(要件3.11)。
- **Sources Consulted**: `@tanstack/react-router` 1.170.41の`useBlocker`の型定義(`mockups/node_modules`)。
- **Findings**: `useBlocker({ shouldBlockFn, enableBeforeUnload, withResolver: true })`で、ルーターの遷移を止めて独自の確認のダイアログを出し、ブラウザの再読み込み・タブを閉じる操作には`beforeunload`で確認を出せる。
- **Implications**: 管理画面の編集の部品で`useBlocker`を使い、確認はadmin-foundationの`ConfirmActionDialog`(理由なし・監査ログの表示なし)で出す。

## Architecture Pattern Evaluation

| Option                                     | Description                                                                    | Strengths                                                     | Risks / Limitations                                                                 | Notes  |
| ------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| 文書の行+版の行(下書きは文書の行の列)      | `legal_documents`に状態の版と下書きを持ち、`legal_document_versions`に版を積む | 競合の判定が1行で済む。下書きが文書ごとに0〜1個に自然に収まる | 文書の行に大きな本文の列が入る                                                      | 採用   |
| 下書きを別のテーブルにする                 | `legal_document_drafts`を持つ                                                  | 文書の行が小さい                                              | 状態の版をどちらに持つかで競合の判定が2行にまたがる                                 | 不採用 |
| 文書の行を持たず、種類をコードの定数にする | 版と下書きのテーブルだけにする                                                 | 初期データが要らない                                          | 状態の版の置き場が無い。要件1.6の「枠」を表せない。DR-014のULIDの主キーとも合わない | 不採用 |

## Design Decisions

### Decision: 3文書を同じ形で扱う(Generalization)

- **Context**: 利用規約・プライバシーポリシー・法的通知は、編集・公開・改訂履歴・過去版の振る舞いが同じである(brief Approach)。
- **Selected Approach**: 種類`LegalDocumentKind`(`terms`・`privacy`・`legal-notice`)を引数にする1組のテーブル・ユースケース・スキーマ・画面部品にする。公開ページのルートは3つの薄いファイルが同じ部品を呼ぶ。種類ごとの名前・利用者側のパスは`apps/common-lib/legal/legal-documents.ts`の1か所に置く。
- **Trade-offs**: 文書ごとに違う表示(法的通知だけの補足など)が必要になれば部品に分岐が増えるが、現在の要件には無い。

### Decision: 公開日時の単調な増加

- **Context**: 同意した版の特定(要件8)は「指定の日時以前で公開日時が最も新しい版」を引く。Workerの時計がわずかに戻ると、版番号と公開日時の順序が食い違いうる。
- **Selected Approach**: 公開日時を「現在時刻」と「最新版の公開日時+1ミリ秒」の大きい方にする(`nextPublishedAt`)。最新版の公開日時は状態の版で守られた読み取りの値を使う。
- **Trade-offs**: 時計が大きく戻った場合は実際の時刻より最大でその差だけ遅い公開日時になるが、順序の一貫性を優先する。

### Decision: 新しいパッケージを導入しない(Build vs Adopt)

- **Selected Approach**: エディタ・描画・日時・表・確認のダイアログ・遷移の確認はすべて上流の部品とTanStack Routerの`useBlocker`で作る。差分表示はQ2の回答により作らない。

### Decision: 監査ログを使わず版に公開者を持つ(Simplification)

- **Context**: Q1。編集者は管理画面にだけ表示する。
- **Selected Approach**: 版の行に`published_by_admin_id`(外部キーなし)を持ち、下書きの行の列に`draft_saved_by_admin_id`を持つ。表示時に`AdminDirectory.findProfiles`で引き、見つからなければ削除済みとする。管理者の削除後もIDを残す(要件1.5)。
- **Trade-offs**: 下書きの保存・破棄の履歴は残らない(最後の保存者だけ)。要件は公開した版の記録だけを求める。

## Risks & Mitigations

- 同意の直前に公開があると、利用者が画面で読んだ版と同意日時から特定される版が食い違う — 発生は公開の操作と登録の送信が数秒以内に重なる場合に限られ、利用規約の大枠の章18(変更後の利用による同意)で扱える。identity-authが版を保存する案はidentity-authのQ4で採らなかった。
- 最上位管理者が長い本文を編集中に他の管理者が公開して、保存が競合で拒否される — 入力欄の内容は消さず、再読み込みの前に手元の内容を写せるよう案内する。拒否は`legal_document_conflict`で区別して表示する。
- E2Eテストが同じローカルのデータベースに版を積み続ける — 版番号を前提にせず、テストの開始時の最新の版番号を読んでから相対的に確かめる。変更概要に乱数を含める。
- 返金ポリシーへのアンカーが見出しの改訂で切れる — paymentsへの申し送り(上記)。

## References

- `.kiro/specs/admin-foundation/design.md` — アクセス制御・管理者の照会・管理画面の区画と共通部品
- `.kiro/specs/content-processing/design.md` — マークダウンの入力欄・描画・検証規則
- `.kiro/specs/frontend-platform/design.md` — GraphQLの呼び出し・ページのhead・日時の表示・404・フッター
- `.kiro/specs/api-gateway/design.md` — スキーマモジュール・引数の検証・要求の上限
- `.kiro/specs/identity-auth/requirements.md` — Q4(同意日時と版の照合)
- `docs/GUIDES/service/legal/` — 準拠方針・3文書の大枠
- `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md` — URL・文字数・文言
- `docs/requirements/README.md` — FR-ADMAG-001・007・008・010、LR-001・008、FR-MDOWN-001〜012、I18N-002・004、DR-014
- 参照したスキルの規則: cc-sddの`kiro-spec-requirements`(EARS・レビューの関門)、`kiro-spec-design`(設計の原則・軽量の調査・統合・レビューの関門)、`kiro-spec-tasks`

## frontend-platformの実装で確定した契約の反映(2026-10-28、開発者の判断)

- frontend-platformが実装で確定した契約(同specのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に、開発者の判断(下流specの設計を今回改訂する)で本specの設計を合わせた。
- GraphQLの操作: 操作を各アプリの`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名を利用者側は`Client`、管理者側は`Admin`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む。`graphql()`を呼んで`.ts`のファイルに操作を書くと、操作の本文がブラウザのバンドルに残るため(frontend-platformの要件6.3)。tasks.mdの操作のタスクに、各アプリの`graphql:generate`とapiの`graphql:allowlist`の手順を書いた。
- フォーム: `useAppForm<TInput, TOutput>(schema, { defaultValues })`(`defaultValues`は全欄)と、必須の`onSubmitError`・任意の`serverFieldPrefix`(`input`を取るmutationは`"input"`)を受ける`AppForm`の形にした。画面側のスキーマの`zod`の値は`utilities/validation/zod.ts`から読む(CSPの下で`new Function`の試行を止める`jitless`の設定を済ませた`z`)。
- 失敗の文言: `GraphQLClientError`でない例外に代えて画面に出す文言を`errorMessageOf(error, <プロファイル>.contactAvailable)`で選ぶ。管理者側には問い合わせの画面が無いため、`ErrorState`・`UnexpectedErrorView`に`contactHref`を渡さず、問い合わせの導線と問い合わせを促す文を出さない(frontend-platformの要件8.6・8.13)。
- `toLegalEditorErrorState`は`AppForm`の`onSubmitError`から呼ぶため、引数を`unknown`にし、`GraphQLClientError`でない例外を`unexpected`(文言は`errorMessageOf`)にした。
- 変えた箇所: design.mdのAllowed Dependencies、Dependency directionの操作の置き場所、Technology Stackの画面の行、File Structure Planの両アプリの`graphql/operations/legal/`、`ClientLegalPages`の取得の失敗、`AdminLegalPages`(`toLegalEditorErrorState`・`LegalDraftForm`と下書きの破棄の`ConfirmActionDialog`の`failureMessageOf`・`PublishLegalDocumentDialog`・失敗の分岐)。tasks.mdの5.3・6.1・6.3。要件は変えていない。

## Turnstile Privacy Addendumの参照の持ち主の移管(2026-10-28、開発者の判断)

- frontend-platformの最終検証の後の第2回の判断14・15(2026-10-28)を、frontend-platformのタスク11.6として本specへ反映した。
- 判断14: bot判定のウィジェットを非表示(Invisible)で使う条件として、CloudflareはプライバシーポリシーでTurnstile Privacy Addendumを参照することを求める。プライバシーポリシーでこの参照を残す(確定)。
- 判断15: 公開前にプライバシーポリシーの本文がAddendumを参照していることを確かめる(または骨子に加える)作業の持ち主を、infra-deliveryから本specへ移した。本specは法務文書の公開と、プライバシーポリシーの大枠の改訂を持つためである。infra-deliveryはウィジェットの種類(`invisible`)と`HASH_PEPPER`の登録先だけを持ち、プライバシーポリシーの大枠のCloudflareの項の移転先・移転の根拠・委託先が講じる措置は従来どおりinfra-deliveryが書く。
- 確かめ方: 本specの実装の時点ではプライバシーポリシーの本文(開発者が管理画面で公開する版)が無いため、大枠のCloudflareの項に参照があるかを確かめて無ければ加え、「記載上の注意」に公開する本文がこの参照を含むことを記す。prodの初版の公開の前の確認は、launch-readinessでの初版の公開の確認とあわせて開発者への報告に載せる。
- 変えた箇所: requirements.mdの要件10.5。design.mdのThis Spec Owns・Out of Boundary・Revalidation Triggers・Modified Files(`003-privacy-policy-outline.md`)・Migration Strategyの初版の公開。tasks.mdの7.4・7.5。要件番号の振り直しは無い。
