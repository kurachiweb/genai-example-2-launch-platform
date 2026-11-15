# Research & Design Decisions

## Summary

- **Feature**: `legal-pages`
- **Discovery Scope**: Extension(法務文書の実装・モックアップは無い。上流の8spec(dev-tooling・backend-platform・api-gateway・frontend-platform・infra-delivery・content-processing・identity-auth・admin-foundation)の設計・タスクは承認済みで実装は未着手であり、本specはその契約の上に法務文書のデータ・管理画面・公開ページを足す。外部サービス・新しいパッケージ・新しい資源が無いため軽量の調査を行い、同時の操作の扱いだけを詳しく調べた)
- **Key Findings**:
  - 利用者側の共通フッターの`/terms`・`/privacy`・`/legal`へのリンクは、frontend-platformの要件11.2で実装済みである。本specはリンク先のページだけを作る(briefの「フッターのリンクを共通レイアウトに追加する」は既に満たされている)。
  - frontend-platformはページの応答に`Cache-Control: no-store`を付けるため、公開の直後から公開ページが新しい版を返す。キャッシュの無効化の仕組みは要らない。
  - D1の`db.batch()`は前の文の結果で後の文を変えられない。下書きの保存・破棄は`state_version`を条件にした1文の更新で、公開は先頭の版の挿入の`version_number`を条件付きの副問い合わせにし、条件を満たさなければNOT NULL制約の違反で一括の書き込み全体を取り消す方式で実現できる(admin-foundationの最後の最上位管理者の保護、identity-authの`UserLifecycleCommitter`と同じ方式)。
  - 本文の上限100,000書記素は、api-gatewayのGraphQLの要求の上限(1MiB)とD1の行の上限(2,000,000バイト)の範囲に収まる。1MiBを超える要求はapi-gatewayが413で拒否するため、行の上限に達する前に止まる。
  - admin-foundationの`AuditTargetKind`は`legal-document`を含むが、Q1により本specは監査ログに記録しない。2026-11-04の決定(G3)により、本specでこの値を取り除く。

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

| #   | 論点                    | 確定した案                                                                                                                                                                                                                                                                | 他の選択肢                                                                                    | 影響する箇所                                                    |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 仮1 | 過去版のURL             | `/terms/revisions/{版番号}`・`/privacy/revisions/{版番号}`・`/legal/revisions/{版番号}`。版番号は文書ごとに初版を1とする連番。過去版のページは`noindex`。正の整数以外(先頭の0・符号・小数)は404(2026-10-23に承認)                                                         | 公開日で表す`/terms/2026-10-23`(同じ日に2回公開すると衝突する) / 版のULIDで表す(人が読めない) | 要件7、`LEGAL_DOCUMENT_PATHS`・`parseVersionNumber`、ページ配置 |
| 仮2 | 本文が同じ版の公開      | 拒否する(`legal_document_unchanged`)。変更の無い版が改訂履歴に載るのを防ぐ(2026-10-23に承認)                                                                                                                                                                              | 許可する(変更概要だけの版ができる)                                                            | 要件4.3、`LegalDocumentRules.checkPublishable`                  |
| 仮3 | 下書きの同時編集        | 文書ごとの状態の版(`state_version`)で、読み込んだ後に他の保存・破棄・公開があれば後の操作を拒否する(`legal_document_conflict`)。画面は再読み込みを促す(2026-10-23に承認)                                                                                                  | 後勝ち(後から保存した側で上書きする)                                                          | 要件3.10・4.4、`D1LegalDocumentStore`                           |
| 仮4 | 管理画面の文書ごとのURL | 編集の画面`/legal-documents/{terms\|privacy\|legal-notice}`、版の表示`/legal-documents/{種類}/revisions/{版番号}`(2026-10-23に承認)                                                                                                                                       | 1画面のタブで3文書を切り替える(URLで文書を指せない)                                           | 要件2・5、管理画面のルート、ページ配置                          |
| 仮5 | 日時の表示形式          | 公開ページと過去版のページは曜日を含まない日付(`yearDate`、例「2026年10月23日」。2026-11-04のG1で`longDate`から改めた)、管理画面は日時(`longDateTime`。2026-11-04のG5で年を含まない`dateTime`から改めた)。どちらも`datetime`属性はミリ秒までのUTCの時刻(2026-10-23に承認) | 公開ページも日時で表示する                                                                    | 要件5.1・6.1・6.3・6.7・7.1、各表示部品                         |
| 仮6 | 準備中のページの応答    | 状態コード200で「この文書は準備中です。」を表示し、`noindex`を付ける。登録画面などからのリンクが404にならないようにする(2026-10-23に承認)                                                                                                                                 | 404を返す(Q6の選択肢3と同じになる)                                                            | 要件6.6、`LegalDocumentPage`                                    |

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
- admin-foundation(再検証は不要): `ADMIN_NAV_ITEMS`へ法務文書(`/legal-documents`、`order` 120)を追記する(契約どおり)。`AuditTargetKind`の`legal-document`はQ1により本specでは使わないため、2026-11-04の決定(G3)により本specが取り除き、admin-foundationの設計の値の一覧も直す(要件10.7)。
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

## フォームの描かない値と無効の欄の扱いの反映(2026-10-28、開発者の判断)

- **状態**: frontend-platformの最終検証の後の第2回の判断16・25〜28・30〜36(2026-10-28〜29)を、frontend-platformのタスク11.8として本specの設計とタスクへ反映した。受け入れ基準は変えていない。
- **Context**: frontend-platformの`SubmitButton`は、`root`以外の欄のエラー(サーバーの欄のエラーを含む)が1つでも残る間は無効になる。入力欄を描かない値をフォームのスキーマの入力に含めると、その値へのサーバーの詳細が利用者の直せない欄のエラーになり、送信ボタンが無効のまま残る。`applyServerFieldErrors`は、欄をまとめた値(配列でないオブジェクト)の経路と、`FormField`の`disabled`で無効にした欄の詳細を欄に付けず`onSubmitError`の`unmatched`へ渡し、`useAppForm`は検証の前に無効の欄の値を除く。無効の欄の値は`onSubmit`へ渡す値から外れ、無効になり得る欄はスキーマで任意(`.optional()`)にする。`FormField`は後から無効にした欄のエラーを消し、`useAppForm`は渡されたスキーマが変わると検証し直し、`applyServerFieldErrors`は描かれていない欄の詳細もフォーム全体の失敗にする。全欄が無効のフォームは`SubmitButton`の`disabled`で送信ボタンを無効にする。
- **決定**: frontend-platformの影響の表の水平展開として確かめた。`LegalDraftForm`と`PublishLegalDocumentDialog`のスキーマの入力は描く欄(本文・変更概要)だけで、文書の種類の`kind`と版の値の`expectedStateVersion`は`onSubmit`で足すことを明記した。最上位管理者でない管理者の読み取り専用の表示は、`MarkdownEditor`の`disabled`だけで無効にする設計だったため、本文の欄を`FormField`の`disabled`で無効にする形に改めた(送信しないため、無効にする方法だけを直した)。
- **変えた箇所**: design.mdの`LegalDraftForm`・最上位管理者でない時の表示・`PublishLegalDocumentDialog`、tasks.mdの6.2(読み取り専用の無効の方法と保存の`kind`・`expectedStateVersion`の送信)・6.4(公開の`kind`・`expectedStateVersion`の送信)のブラウザテスト。

## 層の規則に合わせた契約の置き場所の改訂(2026-11-02、開発者の指示)

- **規則**: [依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析)のとおり、api・eventの`src/application/**`・`src/domain/**`は`**/lib/workers/**`を型だけのimportでも読み込めない。別の機能のapplication層が受け取る契約とDIの識別子は`backend-lib/core/<ドメイン>`に置き、`workers`には実装と束縛だけを置く。
- **移したもの**: 本specが所有する契約の移動は無い。`LegalDocumentAdminReader`(application層)が受け取るadmin-foundationの`AdminDirectory`と識別子`ADMIN_PLATFORM_TYPES`は、admin-foundationの改訂で`backend-lib/core/admin`へ移ったため、読み込み先を`core/admin`に直した。
- **新しいポートと実装**: 無い。
- **変えた箇所**: design.mdのAllowed Dependencies(admin-foundationの行)・Revalidation Triggers・Existing Architecture Analysis・Dependency Direction。tasks.mdは置き場所を書いていないため変えていない。要件と受け入れ基準は変えていない。

---

## ギャップ分析: 上流の実装後のコードとの突き合わせ(2026-11-04)

- **目的**: 設計(2026-10-23承認)の時点では上流specが未実装だった。admin-foundationまでの実装が`main`系に入った現在のコードと、本specの設計が依存する契約・規約を突き合わせ、実装の着手前に直すべき差を洗い出す。
- **方法**: design.mdのAllowed Dependencies・File Structure Plan・Modified Filesに載る識別子とファイルを、`apps/`・`e2e/`・`config/`・`docs/`で定義と使い方まで確かめた。外部サービスと新しいパッケージは無いため、外部の調査はしていない。
- **steering**: `.kiro/steering`は依然としてroadmap.mdだけである。CLAUDE.md・tech-stack.md・上流specで代替した。

### 要約

- 設計が依存する上流の契約は、TanStack Routerの`useBlocker`(パッケージの機能)を除いてすべてコードに存在し、形も設計の想定どおりである。法務文書のコード(テーブル・モジュール・ルート)はまだ無い。
- 直すべき差は「既存の規約との配置の違い」と「日時の書式の名前の選び方」に集中しており、どれも設計の小さな改訂で済む。新しい契約や上流の変更は要らない。
- 利用者側のパスの定数(`TERMS_HREF`・`PRIVACY_HREF`・`'/legal'`)が既に`apps/client/src/components/layout/site-links.ts`にあり、本specの`LEGAL_DOCUMENT_PATHS`と重複する。水平展開として一本化するかを決める必要がある。
- 初期データの`INSERT`を書くマイグレーションは、リポジトリで初めての形である。技術ドキュメント`db/001`は`--custom`の用途を仮想テーブル・トリガーとしているため、記述を足す必要がある。
- 工数はM(3〜7日)、リスクはLow〜Medium(新しい形は`useBlocker`と初期データのマイグレーションの2つだけ)。

### 要件と既存の資産の対応

凡例: ✅ 既存で足りる / **Missing** 本specで作る / **Constraint** 既存の規約による制約・設計の改訂が要る / **Unknown** 実装時に確かめる

| 要件                     | 既存の資産                                                                                                                                                                                                                                                             | 判定                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1〜1.5                 | `apps/db/schema/_shared/columns.ts`の`ulidPrimaryKey`・`timestamps`。条件付きの一括の書き込みの先例は`apps/api/src/infrastructure/admin/audit-log-statements.ts`(`guard`で一括全体を取り消す)と`d1-admin-account-store.ts`の`db.batch`                                 | **Missing**(2テーブル・ストア)。先例に沿って作れる                                                                                                                                                                                                    |
| 1.6                      | `apps/db/migrations`に`INSERT`でデータを入れるマイグレーションは無い。`config/vitest/read-nested-d1-migrations.ts`がWorkers統合テストへ全マイグレーションを適用する                                                                                                    | **Missing**・**Constraint**: `docs/GUIDES/tech/db/001`・`003`は`--custom`の用途を仮想テーブル・トリガーとしている。初期データの書き方(固定のULID・作成日時の値)を`db/005`または`db/001`に書く。Workers統合テストのDBには3文書の枠が常にある前提になる |
| 2.1〜2.3                 | `ADMIN_NAV_ITEMS`(`apps/admin/src/composition/admin-navigation.ts`。コメントで法務文書の`order` 120を予約済み)、`AdminDataTable`・`AdminPageHeader`                                                                                                                    | **Missing**(ルート・一覧)。メニューは1行の追記で足りる                                                                                                                                                                                                |
| 2.4・3.7・4.5            | `requireAdmin(context, minimum)`(`apps/api/src/presentation/graphql/admin-guard.ts`)。呼び出し元が管理者側でなければ拒否し、ロールの不足はログに残す                                                                                                                   | ✅ 設計どおり                                                                                                                                                                                                                                         |
| 3.1・3.2                 | `MarkdownEditor`(props: `value`・`onValueChange`・`onBlur`・`labelId`・`maxGraphemes`・`placeholder`・`preview`・`disabled`ほか)。ツールバーの操作に画像は無く、見出しの入力規則は`##`〜`######`だけ(`crepe/heading-input-rule.ts`)                                    | ✅ 見出しレベル1と画像の除外は既定の振る舞いで満たされる。ツールバーを指定するpropは無く、要らない                                                                                                                                                    |
| 3.4・4.2・9.1            | `markdownTextSchema({ label, maxGraphemes, required })`・`countGraphemes`・`hasForbiddenCharacters`(`apps/common-lib`)                                                                                                                                                 | ✅ 本文はそのまま使える。変更概要(改行を含まない1〜200書記素)は本specの`legal-input-rules.ts`で作る(**Missing**)                                                                                                                                      |
| 3.5・5.1・5.2            | `AdminDirectory.findProfiles(ids)`(`apps/backend-lib/core/admin/ports.ts`)は削除済み・招待中・存在しないIDを結果に含めない                                                                                                                                             | ✅ 見つからないIDを「削除済みの管理者」とする設計どおり                                                                                                                                                                                               |
| 3.5・5.1(日時)           | `DATE_TIME_FORMATS`の`dateTime`は年を含まない(`month`・`day`・`weekday`・`hour`・`minute`)                                                                                                                                                                             | **Constraint**: 改訂履歴は年をまたぐため、管理画面の日時は`longDateTime`(年を含む)が適する。設計の`dateTime`の指定を改める                                                                                                                            |
| 3.6・4.7                 | `ConfirmActionDialog`は`reason: 'required' \| 'optional' \| 'none'`と`audited: boolean`を必須のpropとして受ける                                                                                                                                                        | ✅ 下書きの破棄は`reason: 'none'`・`audited: false`で使える。公開の確認は変更概要の入力を持つため、設計どおり専用の`PublishLegalDocumentDialog`を作る                                                                                                 |
| 3.8                      | `RoleGate({ minimum, fallback })`・`useAdminRole`(`apps/admin/src/components/layout/`)                                                                                                                                                                                 | ✅                                                                                                                                                                                                                                                    |
| 3.11                     | `useBlocker`をリポジトリのどこも使っていない。`@tanstack/react-router`は`1.170.46`(調査時の型定義は`1.170.41`)                                                                                                                                                         | **Unknown**: 版が上がったため、`shouldBlockFn`・`enableBeforeUnload`・`withResolver`の形が変わっていないかを実装時に型定義で確かめる。リポジトリで最初の使い方になる                                                                                  |
| 6.1〜6.4・7.1〜7.3(日付) | `DateTime({ value, format })`は`<time dateTime={toISOString()}>`(ミリ秒までのUTC)を出す。`longDate`は曜日を含み、`yearDate`が「2026年10月23日」の形                                                                                                                    | **Constraint**: 仮5の例(「2026年10月23日」)と設計の`longDate`(曜日付き)が食い違う。曜日を出さないなら`yearDate`に改め、`longDate`のままなら仮5の例を直す                                                                                              |
| 6.2                      | `useMarkdownOptions({ externalLinkRel, sameOriginLinkRel?, idScope? })`は`publicConfig.clientSiteOrigin`を補う。`useRenderedMarkdown`・`MarkdownContent({ rendered, size? })`                                                                                          | ✅                                                                                                                                                                                                                                                    |
| 6.6・7.4・7.5            | `buildSitePageHead({ title, canonicalUrl?, noIndex? })`(`apps/client/src/head/page-heads.ts`)、ルートの`notFoundComponent: NotFoundPage`                                                                                                                               | **Constraint**: 設計は`buildPageHead`を直接使う書き方だが、既存のルートはアプリごとの`head/page-heads.ts`のラッパーを使う。`noIndex`はラッパーで渡せる                                                                                                |
| 6.8・LR-001              | 共通フッターの`FOOTER_POLICY_LINKS`(`site-links.ts`)が`/terms`・`/privacy`・`/legal`を指し、`site-layout.browser.test.tsx`が確かめている。登録画面(`register-form.tsx`)は`TERMS_HREF`・`PRIVACY_HREF`を使う                                                            | ✅ リンクは既存。**Constraint**: パスの定数が`site-links.ts`と本specの`LEGAL_DOCUMENT_PATHS`の2か所になる(下の「水平展開の候補」)                                                                                                                     |
| 8.1〜8.3                 | `users.termsAgreedAt`は`integer({ mode: 'timestamp_ms' })`(`apps/db/schema/identity/users.ts`)                                                                                                                                                                         | ✅ 公開日時をミリ秒で持てばそのまま比較できる                                                                                                                                                                                                         |
| 9.3                      | `runAxe`(`apps/frontend-lib/test/a11y.ts`)                                                                                                                                                                                                                             | ✅                                                                                                                                                                                                                                                    |
| 10.2                     | `signInAsNewAdmin`(`e2e/support/admin-bootstrap.ts`)                                                                                                                                                                                                                   | ✅                                                                                                                                                                                                                                                    |
| 10.4                     | `docs/GUIDES/tech/db/`は001〜004。005は空いている                                                                                                                                                                                                                      | **Missing**(`db/005`)                                                                                                                                                                                                                                 |
| 10.5                     | ページ配置に`/legal-documents`の行と権限の行はadmin-foundationが記載済み。過去版のURL・`rel`の行は無い。文言規則は変更概要(200文字)だけ。準拠方針の「法務文書の改訂」は旧来の文言。プライバシーポリシーの大枠のCloudflareの項はTurnstileを挙げるがAddendumの参照は無い | **Missing**(各文書の追記)。要件定義書のFR-ADMAG-007・008・010の改訂は適用済み                                                                                                                                                                         |

### 既存の規約との配置の違い(設計の改訂の候補)

| 設計の記述                                                                                  | 既存のコードの規約                                                                                                                                                     | 影響                                                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ページの部品を`components/legal/legal-document-page.tsx`などに置く                          | ページの部品は`src/components/pages/*-page.tsx`に置き、ドメインの部品は`src/components/<ドメイン>/`に置く(例: `pages/audit-logs-page.tsx`と`audit/audit-log-list.tsx`) | File Structure Planの配置。ページの部品だけ`components/pages/`へ移す                     |
| loader・head・`params.parse`の組み立てを`components/legal/legal-route-options.ts`にまとめる | loaderは`components/<ドメイン>/load-*-page.ts`(例: `audit/load-audit-logs-page.ts`)、headは`src/head/page-heads.ts`の`buildSitePageHead`・`buildAdminPageHead`         | `legal-route-options.ts`を`load-legal-*-page.ts`とheadのラッパーの呼び出しに分けるか判断 |
| 生成した型と画面の型の変換の置き場所の記載が無い                                            | 取得の補助の規約は、生成した結果の型の変換を操作ごとに`src/graphql/<内容>.ts`に置き単体テストを書く(`docs/GUIDES/tech/frontend/006-data-fetching.md`)                  | 変換を書く場合は`src/graphql/legal-*.ts`に置く                                           |
| 管理画面の日時を`dateTime`、公開ページを`longDate`                                          | 上の表のとおり、`dateTime`は年を含まず、`longDate`は曜日を含む                                                                                                         | 書式の名前の選び直し(`longDateTime`・`yearDate`)                                         |

### 水平展開の候補

- **利用者側のパスの定数**: `site-links.ts`の`TERMS_HREF`・`PRIVACY_HREF`と`FOOTER_POLICY_LINKS`の`'/legal'`・`'利用規約'`などの名前、`components/auth/account-messages.ts`の`TERMS_LINK_LABEL`・`PRIVACY_LINK_LABEL`が、本specの`LEGAL_DOCUMENT_PATHS`・文書の名前と重複する。選択肢は (a) `site-links.ts`・`account-messages.ts`が`apps/common-lib/legal/legal-documents.ts`を参照するように改める(パスの単一の情報源。Revalidation Triggersの「利用者側のパス」が1か所になる) / (b) 重複を残し、パスの一致を単体テストで確かめる。
- **監査ログの対象の種類**: Q1により法務文書の操作は監査ログに記録しないが、`AuditTargetKind`の`'legal-document'`(`apps/common-lib/admin/audit-action.ts`)・管理画面の表示名(`apps/admin/src/components/audit/audit-logs-messages.ts`)・文言規則の「監査ログの対象の種類」(`docs/GUIDES/service/design/003-text-and-copy-rules.md`の428行目)に「法務文書」が残る。監査ログの絞り込みに選べるが常に0件の選択肢になる。research.mdの既存の判断(「残しても害は無く、削除はadmin-foundationの判断」)を維持するか、本specで外すかを決める。

### 実装の方針の選択肢

#### 選択肢A: 既存の部品を広げる

- 法務文書の照会・変更をadmin-foundationの`admin`モジュール(`application/admin`・`presentation/graphql/modules/admin`)に足し、公開ページは`site-links.ts`の定数をそのまま使う。
- ✅ ファイル数が最も少ない。❌ `admin`モジュールは既に大きく(管理者アカウント・認証・監査ログ)、利用者側の公開の照会まで持つと責務が混ざる。設計の境界(`legal`モジュール)と食い違い、承認済みの設計を大きく変える。

#### 選択肢B: 設計どおり新しい`legal`モジュールを作る

- design.mdのFile Structure Planをそのまま実装する。
- ✅ 承認済みの設計と一致し、境界が明確。❌ 上の「配置の違い」のとおり、ページの部品・loader・headの置き場所が既存の規約とずれ、レビューで指摘されやすい。

#### 選択肢C: 新しい`legal`モジュール+既存の規約への合わせ込み(ハイブリッド)

- バックエンド(テーブル・domain・application・infrastructure・スキーマモジュール)は設計どおり新しく作る。
- 画面は既存の規約に合わせ、ページの部品を`components/pages/`、loaderを`components/legal/load-*-page.ts`、headを`head/page-heads.ts`のラッパー経由にする。日時の書式を`yearDate`(または`longDate`のまま仮5の例を直す)と`longDateTime`に改める。
- 利用者側のパスの定数を`apps/common-lib/legal`へ一本化するかは、水平展開の候補(a)(b)から選ぶ。
- ✅ 設計の境界を保ったまま、既存のコードと見た目の一貫性が取れる。❌ 設計とタスクの小さな改訂が先に要る。

### 工数とリスク

- **工数: M(3〜7日)** — テーブル2つ・ユースケース5つ・スキーマモジュール1つ・ルート9つ・画面部品十数個とE2Eだが、すべて既存の先例(admin-foundationの条件付きの一括の書き込み、監査ログの画面)に沿って作れる。
- **リスク: Low〜Medium** — 新しい形は`useBlocker`(版が上がった後の型の確認)と初期データのマイグレーション(先例が無く文書の追記が要る)の2つだけで、外部サービス・新しいパッケージ・新しい資源は無い。

### 設計フェーズへの申し送り

- **推奨の方向**: 選択肢C。設計の境界と契約は変えず、File Structure Planの画面の配置と日時の書式の指定だけを既存の規約に合わせて改訂する。
- **開発者の判断が要る事項**(2026-11-04に決定。下の「ギャップ分析の後の決定」):
  1. 公開ページと過去版のページの日付の書式(`yearDate`で曜日なし / `longDate`で曜日付き。仮5の例はどちらかに合わせて直す)
  2. 利用者側のパスの定数の一本化(水平展開の候補(a)・(b))
  3. `AuditTargetKind`の`'legal-document'`と文言規則の「法務文書」を残すか
- **Research Needed**:
  - `@tanstack/react-router` 1.170.46の`useBlocker`の型(`shouldBlockFn`・`enableBeforeUnload`・`withResolver`)と、TanStack Startのサーバー側の描画で`beforeunload`の登録が問題にならないこと
  - 初期データのマイグレーションで固定のULIDと作成日時を使う書き方と、`drizzle-kit generate`のスナップショットとの関係(`--custom`のマイグレーションはスナップショットを変えないこと)
- **トレーサビリティの補足**: 要件定義書にFR-ADMAG-011(改訂履歴に公開した管理者を表示しない)が新設された。本specの要件6.5は内容が同じため、根拠の表記にFR-ADMAG-011を加える。

### ギャップ分析の後の決定(2026-11-04、開発者の回答)

ギャップ分析の「開発者の判断が要る事項」を1件ずつ確認し、3件とも推奨案が採用された。

| #   | 論点                           | 決定                                                                                                                                                                                                                                | 他の選択肢                                   | 変えた箇所                                                                                                                                                                                               |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 公開ページと過去版の日付の書式 | `yearDate`(曜日を含まない「2026年10月23日」)。仮5の例のままにする                                                                                                                                                                   | `longDate`(曜日付き)にして仮5の例を直す      | requirements.mdの仮5、design.mdのRequirements Traceabilityの6.7・`LegalDocumentPage`・`LegalRevisionHistory`・`LegalVersionPage`、tasks.mdの5.1・5.2、本書の仮5                                          |
| G2  | 利用者側のパスと名前の定数     | `apps/common-lib/legal/legal-documents.ts`へ一本化し、clientの`site-links.ts`・`account-messages.ts`はそこから作る(値は変えない)                                                                                                    | 重複を残し、パスの一致を単体テストで確かめる | design.mdのRevalidation Triggers・`LegalDocuments`の注記・Modified Files、tasks.mdの5.3(1.2への依存を追加)                                                                                               |
| G3  | 監査ログの対象の種類の法務文書 | 本specで`AuditTargetKind`の`'legal-document'`・管理画面の表示名・文言規則の「監査ログの対象の種類」の「法務文書」を除き、admin-foundationの設計の値の一覧も直す。列に制約が無く、この値の記録も無いため、マイグレーションは要らない | 残す / admin-foundationの修正として別に扱う  | requirements.mdのQ1・要件10.7(追加)、design.mdのThis Spec Owns・Allowed Dependencies・Modified Files・Requirements Traceabilityの10.1〜10.7、tasks.mdの6.7(追加)、本書のKey Findings・上流と後続への影響 |

- 要件10.7は受け入れ基準の追記で、既存の要件番号は振り直していない。`spec.json`の承認の状態は変えていない。
- ギャップ分析の推奨のうち、上の3件に含まれない4点は、続けて1件ずつ確認した(下の表)。

### ギャップ分析の後の決定(続き、2026-11-04、開発者の回答)

4件とも推奨案が採用された。

| #   | 論点                                 | 決定                                                                                                                                                                                                                                                                                                                                                                                                                                         | 他の選択肢                                                                | 変えた箇所                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G4  | 画面のファイルの置き場所             | 既存の規約に全面的に合わせる。ページ全体の部品は`components/pages/`、ページを組み立てる部品は`components/legal/`、取得の設定・`loader`・生成した型からの変換はclientの`src/graphql/legal-documents.ts`とadminの`src/graphql/admin-legal-documents.ts`、headは`src/head/page-heads.ts`(clientは`buildLegalDocumentHead`・`buildLegalVersionHead`を追記)。`legal-route-options.ts`は廃止し、版番号の解析は`loader`で`parseVersionNumber`を使う | ページの部品とheadだけ合わせ、`legal-route-options.ts`を残す / 設計のまま | design.mdのFile Structure Plan(と置き場所の規約の段落)・Allowed Dependenciesの`buildPageHead`・Requirements Traceabilityの6.6・7.1〜7.5・ClientLegalPagesの契約とルートの説明・AdminLegalPagesの経路の表と`loader`の説明・Testing Strategyの単体テスト、tasks.mdの5.1・5.2・5.3・6.1・6.5・6.6 |
| G5  | 管理画面の日時の書式                 | 改訂履歴・一覧・版の表示の公開日時と下書きの最終保存日時をすべて`longDateTime`(年・曜日・時刻)にする。履歴を示す監査ログの一覧と揃える                                                                                                                                                                                                                                                                                                       | 改訂履歴だけ`longDateTime` / `dateTime`のまま                             | design.mdの経路の表・`LegalDraftStatus`・`LegalRevisionTable`、tasks.mdの6.1・6.3・6.5、本書の仮5                                                                                                                                                                                              |
| G6  | FR-ADMAG-011の参照                   | 要件6.5の根拠を「(Q1、FR-ADMAG-011)」にし、Project DescriptionとIntroductionの対象の列挙、設計のGoalsにFR-ADMAG-011を加える。振る舞いは変わらない                                                                                                                                                                                                                                                                                            | 6.5の根拠だけ追記 / 追記しない                                            | requirements.mdのProject Description・Introduction・要件6.5、design.mdのGoals                                                                                                                                                                                                                  |
| G7  | 初期データのマイグレーションの記載先 | `db/003`の「マイグレーション」の節に「初期データ」の項を加え、`db/001`の`--custom`の用途の1文を揃え、CLAUDE.mdの技術規則の参照先に1行加える。`--custom`のマイグレーションとスナップショットの関係はタスク1.1で確かめてから書く                                                                                                                                                                                                               | 本specの`db/005`に書く / 書かない                                         | requirements.mdの要件10.4、design.mdのModified Files(`db/003`・`db/001`・CLAUDE.md)、tasks.mdの1.1(スナップショットの確認)・7.3(記載と1.1への依存)                                                                                                                                             |

- 要件10.4は受け入れ基準の文言の追記で、要件番号は振り直していない。`spec.json`の承認の状態は変えていない。
- 技術ドキュメント(`db/001`・`db/003`)とCLAUDE.mdの本体はタスク7.3で書く。今回はspecだけを改めた。
