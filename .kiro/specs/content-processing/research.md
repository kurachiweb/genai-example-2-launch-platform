# Research & Design Decisions

## Summary

- **Feature**: `content-processing`
- **Discovery Scope**: New Feature(`apps`配下は未実装で、上流のdev-toolingだけが実装済み、backend-platform・api-gateway・email-delivery・frontend-platformは設計まで承認済み・実装前である。新しい共有ディレクトリ`apps/common-lib`を加え、上流の骨格の上に描画・入力・検索の基盤を新設する)
- **Key Findings**:
  - Crepe 7.22.2のbuilderで、固定ツールバーを除き選択時のツールバー・リスト・プレースホルダー・カーソル・表だけを組み込んだ場合、`bun build --minify`で約786KB(gzip約250KB)だった。KaTeX・CodeMirrorは含まれず、`eval`・`new Function`も無い。内部のUIはVueのランタイムで描かれる。
  - Crepeの固定ツールバー(top-bar)と表の操作UIのボタンは、アクセシブルな名前を持たず、`pointerdown`だけで動く(キーボードの操作では発火しない)。選択時のツールバーのボタンは`aria-label`を持つ。CrepeBuilderの基本構成はアップロード(ファイルの貼り付け・ドロップで画像を挿入する)とインデント(Tabキーで字下げする)のプラグインを含み、リストと表もTabキーを使う。
  - remark-rehypeは既定でRaw HTMLを捨て、rehype-sanitizeの既定のスキーマは相対URL・プロトコル相対URLのリンクを残す。どちらもFR-MDOWN-005・012を満たさないため、構文木の段階で文字列への置き換えと参照先の検査が要る。20,000文字の文書の描画はBunで平均約124ms、2,000文字で約9msだった。
  - SQLite 3.53.2(bun:sqlite)で、external contentのFTS5とトリガーの同期、前方一致の`"語"*`、二重引用符のエスケープ、演算子や列の指定に当たる語の無害化、版の条件付きの`ON CONFLICT DO UPDATE ... WHERE`、`INSERT ... SELECT ... WHERE EXISTS`による元データの存在の条件付きの追加が、いずれも意図どおりに動いた。
  - Google Cloud Natural Language v2の`documents:analyzeEntities`は、応答に`languageCode`と`languageSupported`を持ち、非対応の言語の指定は`INVALID_ARGUMENT`になる。v2のEntityは`name`・`type`・`metadata`・`mentions[].probability`を持ち、v1の`salience`は無い。1要求の上限は1,000,000バイト、既定の割り当ては毎分600要求である。

## 要件フェーズ前の確認事項(2026-10-18)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                                                     | 根拠                                                                                                                                                                                 | 回答(2026-10-18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | 描画パイプラインと文字数・検索語の処理をどこに置くか     | briefのApproach・Desired Outcome(「1つのパイプライン定義」「SSRとクライアントで共用」)、`config/workspace-layout.ts`の`SHARED_DIRS`、`design/003-text-and-copy-rules.md`、FR-FTS-002 | 開発者の回答。新しい共有ディレクトリ`apps/common-lib`を作り、client・admin・api・eventの4アプリに配置する(推奨案の新規共有ディレクトリ案で、名前を`apps/common-lib`に指定)。置くものは描画パイプライン・書記素での文字数計算・検索語の正規化・強調表示用の正規化で、画面部品(Reactコンポーネント)は`apps/frontend-lib`に置く。dev-toolingの配置定義(`config/workspace-layout.ts`・`compose.yaml`)、`coding/002`・`coding/003`、CLAUDE.mdのディレクトリ構成、4アプリでの依存の版の宣言の更新を本specのタスクに含める                  |
| Q2  | マークダウンの入力欄をCrepeとtextareaのどちらで作るか    | tech-stack.mdの「マークダウンエディタ」、briefの実現性チェック、`mockups/.../comment-composer.tsx`、`design/002-page-layouts.md`の「コメント」、roadmapの「モックアップを正とする」  | 推奨案ではなく「Crepeを必要機能だけ遅延読み込み」を採用。`@milkdown/crepe/builder`と機能ごとの入口で絞り込み、`<ClientOnly>`と`React.lazy`で別チャンクにする(実測約0.8MB、gzip約250KB)。版は2週間以上経ったものに固定する(7.22.3は2026-10-10公開のため7.22.2)。「書く/プレビュー」との関係(役割の重なり・SSR時の仮表示)は設計で決め、モックアップとの差を記録する。見出しレベル1の入力ルールと貼り付けを止め、Milkdown側にもremark-cjk-friendlyを登録し、`@milkdown/*`のimportを遅延読み込みのモジュールに限る静的解析の規則を入れる |
| Q3  | キーワード抽出が失敗し続けた場合・非対応言語の場合の索引 | briefのConstraints、NFR-AVAIL-002、FR-FTS-003〜006、backend-platformの再試行(30・60・120・240秒)とデッドレターの方針(Q7)                                                             | 推奨案。再試行の上限まで待ち、それでも失敗した時(非対応言語ならすぐに)、構文の除去とNFKC正規化だけのテキストで索引する。「未抽出」の印を付け、日次の定期実行で抽出をやり直す                                                                                                                                                                                                                                                                                                                                                         |
| Q4  | 検索語の各語を完全一致と前方一致のどちらで照合するか     | FR-FTS-001・002・006、scratchpadのFTS5での確認(`"タスク管理"`は一致せず`"タスク管理"*`は一致)                                                                                        | 推奨案。各語を前方一致(`"語"*`)にする。FR-FTS-002との差は要件定義書の改訂が必要な事項として報告する                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Q5  | 見出しのアンカーIDに接頭辞を付けるか                     | FR-MDOWN-006、FR-COMNT-001、FR-HELP-010、frontend-platformのスキップリンク(`#main`)、DOM clobbering、rehype-sanitizeの`user-content-`                                                | 推奨案。既定は`user-content-`と変換文字列をつなげたものにし、1ページに複数並ぶ本文では呼び出し側が本文ごとの接頭辞を指定できる。本文中の`#`リンクも同じ接頭辞に書き換える。FR-MDOWN-006との差は要件定義書の改訂が必要な事項として報告する                                                                                                                                                                                                                                                                                            |
| Q6  | 本文の表示装飾に`@tailwindcss/typography`を採用するか    | `mockups/src/components/client/markdown.tsx`の`prose`、frontend-platformのQ5、CLAUDE.md(新規パッケージ)                                                                              | 推奨案。`@tailwindcss/typography` 0.5.20(2026-06-08公開、Tailwind公式、相手依存にTailwind 4を含む)を採用し、frontend-lib・client・adminで版をそろえて宣言する                                                                                                                                                                                                                                                                                                                                                                        |

- 採用したパッケージのtech-stack.mdへの追記は、spec段階では行わず、導入する実装タスクの中で行う(frontend-platformの慣行)。
- 要件定義書の改訂が必要な箇所: FR-FTS-002(Q4)、FR-MDOWN-006(Q5)、FR-FTS-006(Q3の縮退運転と再抽出)。roadmapにより要件定義書そのものは改訂しない。(2026-10-25に要件定義書へ適用済み)
- Google Cloud Natural LanguageのAPIキーはInfisicalで管理する。staging・prodのイベントサーバーへのシークレットの反映は、infra-deliveryのInfisicalのキーの表に`GOOGLE_NL_API_KEY`を加えて行う(横断レビューI-3)。キーの一覧の正は`docs/onboardings/project-values.md`のWorkerのシークレットのキーの一覧の節とし、本specが行を加える(横断レビューN-5)。stagingの値はキーを必須にする変更をmainへマージする前に開発者が登録し、prodの値の登録はlaunch-readinessへ引き継ぐ。

### 提示した選択肢(記録)

- Q1: 新しい共有ディレクトリ(採用、名前は`apps/common-lib`) / frontend-libをeventにも配置 / 描画をAPIに集約 / フロントとバックに別々に実装
- Q2: モックアップどおりtextarea / Crepeを必要機能だけ遅延読み込み(採用) / Crepe全機能を遅延読み込み
- Q3: 抽出なしで索引し後で再抽出(採用) / 回復まで待ち続ける / 抽出なしで索引して終わり
- Q4: 各語を前方一致(採用) / 要件どおり完全一致
- Q5: 接頭辞を付け本文ごとに指定可能にする(採用) / 固定の接頭辞だけ / 要件どおり接頭辞なし
- Q6: `@tailwindcss/typography` 0.5.20を採用(採用) / 自前のスタイル

### 確認済みのため質問しない事項

- roadmapのRequirement Ambiguities: 担当specがcontent-processingの行は無い。
- 日本語の分割方式: FR-FTS-001がunicode61と`remove_diacritics 2`に固定しており、日本語の分割はFR-FTS-006のキーワード抽出が担う。一致の広さだけをQ4で確認した。
- 索引を更新するタイミング: FR-FTS-003(作成・編集時にQueuesで非同期)とFR-FTS-009(削除時は即時)で決まっている。
- 後続specとの責任分担: briefのScope(Out)とOut of Boundaryで決まっている。ドメインごとのFTSテーブルと検索画面はdirectory-discovery・help-center、入力上限値は各ドメインが持つ。全文検索用のテーブルの主キーを連番にする規約はbackend-platformが文書だけで定めており(部品は提供しない)、部品とひな形は本specが作る。
- 文字数の数え方: `design/003-text-and-copy-rules.md`が「書記素で数え、フロントのフォーカスアウト時とサーバーで同じ値で検証する」と定める。モックアップは記法を含む原文を`Intl.Segmenter`で数える。workerd・ブラウザ・Bunの標準APIで足り、NFKCも`String.prototype.normalize`で足りる。
- プレビューの形: `design/002-page-layouts.md`とモックアップの「書く/プレビュー」タブで決まっている(WYSIWYGとの関係はQ2の回答により設計で決める)。
- 見出しレベル1と画像の「通常の文字列として描画」(FR-MDOWN-010)の解釈: モックアップの`markdown.tsx`が、見出しレベル1は`<p># 本文</p>`、画像は`![alt](src)`の文字列として描画しており、これを正とする。
- Raw HTML: FR-MDOWN-005とモックアップのコメントにより、文字列として表示する(削除しない)。
- リンクの`rel`: `design/002-page-layouts.md`の「外部Webサイトへのリンク」の表で表示場所ごとに決まっている。描画部品は`rel`を指定できるようにするだけでよい。`noreferrer`はfrontend-platformが`Referrer-Policy: same-origin`を付けるため不要である。
- 表示部品の生HTMLの挿入: NFR-SECUR-040と、frontend-platformの`frontend/003`(本specのサニタイズ済みHTMLの部品だけが、理由のコメント付きで1行だけ規則を無効化できる)で決まっている。`hast-util-to-jsx-runtime`は導入しない。
- 相対URL: FR-MDOWN-012が`http`・`https`・`mailto`と`#`だけを許可するため除去する。ヘルプ記事の内部リンクは絶対URLで書く。
- 入力の検証で拒否するもの: 見出しレベル1・画像・Raw HTMLは描画時に文字列にする要件のため、サーバー側で拒否するのは文字数など形式の違反だけである。
- 保存形式: `features/001-user-data-export.md`がマークダウンの原文を`.md`で出力するため、DBにはマークダウンの原文を保存し、HTMLは保存しない。
- マークダウン処理のパッケージ: tech-stack.mdで選定済み(unified 11.0.5、remark-parse 11.0.0、remark-gfm 4.0.1、remark-rehype 11.1.2、rehype-sanitize 6.0.0、rehype-stringify 10.0.1、hast-util-to-text 4.0.2、remark-cjk-friendly 2.3.2(2026-09-30公開)、remark-cjk-friendly-gfm-strikethrough 2.3.1)。いずれも公開から2週間以上経っている。rehype-slugの扱いは仮決定P2を参照。
- キーワード抽出のAPI: tech-stack.mdで、APIキー認証のGoogle Cloud Natural Languageに決まっている。gRPCのSDKは使わず`fetch`でRESTのv2の`analyzeEntities`を呼ぶ。料金は1,000文字を1単位とし、毎月5,000単位まで無料、それ以降は1,000単位あたり1ドル。送信する内容は`legal/003-privacy-policy-outline.md`の委託先の一覧(プロダクト名・タグライン・説明文、ヘルプ記事、一時送信)と一致している。
- バックアップ: NFR-AVAIL-008と`db/002`により、Time Travelで行う。
- CSP: スクリプトはnonceに加えて同一オリジン(`'self'`)の読み込みが許可され、スタイルは`'unsafe-inline'`が許可されている。Crepeの別チャンクとCSSは同一オリジンから読み込まれ、許可先の追加は要らない(Research Log「CSPへの影響」)。

### 仮決定(2026-10-18に開発者が承認)

設計の途中で見つかった、開発者の判断を要する論点である。回答と上流specに最も整合する案を選んで設計を進め、2026-10-18に開発者が全件を承認した。P1はQ&Aで個別に、P2〜P8は一括で承認した。

| #   | 論点                                                    | 仮決定(選んだ案)                                                                                                                                                                                                                                                                                                               | 他の選択肢                                                                                                                                                              | 理由                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Crepeの部品のうちアクセシビリティを満たさないものの扱い | Crepeの固定ツールバー(top-bar)・表の操作UI(table)・リンクのツールチップ(link-tooltip)は組み込まず、同じMilkdownのコマンドを呼ぶ自前の固定ツールバー・リンクのダイアログ・表の挿入ボタンを共通部品に作る。Crepeからは編集領域・リスト(list-item)・選択時のツールバー(toolbar、日本語のラベル)・プレースホルダー・カーソルを使う | (a) Crepeの部品を使い、描画されたDOMへ名前とキー操作を後付けする補正を入れる (b) Crepeの部品をそのまま使い、入力欄だけアクセシビリティの自動検査の違反0件の対象から外す | top-barと表の操作UIのボタンは名前を持たず`pointerdown`だけで動くため、axeの`button-name`の違反とキーボードで操作できない問題(WCAG 2.1.1・4.1.2)があり、UI-003とfrontend-platformの「部品ごとのテストで違反0件」(Q8)を満たせない。(a)はCrepeの内部のDOMに依存し、版の更新で黙って壊れる |
| P2  | rehype-slugの扱い                                       | rehype-slugを使わず、FR-MDOWN-006の変換と連番を自前のrehypeの処理で実装し、tech-stack.mdから外す                                                                                                                                                                                                                               | rehype-slugで付けたIDを後から書き換える                                                                                                                                 | rehype-slugはgithub-sluggerで記号を削除しCJK文字を残すため、FR-MDOWN-006の「記号とCJK文字のURLエンコード」と食い違い、削除された記号は後から復元できない。接頭辞と連番も自前の処理で決めるため、依存を減らせる                                                                         |
| P3  | `@milkdown/kit`の宣言                                   | Crepeが完全固定で依存する`@milkdown/kit` 7.22.2を、エディタを使う3つのアプリ(frontend-lib・client・admin)で明示的に宣言する                                                                                                                                                                                                    | 推移的な依存に任せてimportする                                                                                                                                          | 見出しの入力規則の除去・アップロードの除外・コマンドの呼び出し・remarkのプラグインの登録に`@milkdown/kit`を直接importする。宣言しないimportは版の固定と配置方式の規約(利用側アプリが宣言する)に反する                                                                                  |
| P4  | frontend-libからcommon-libを参照する方法                | frontend-libへは配置せず、配置先の名前を配置元と同じ`common-lib`にして、frontend-libのコードは兄弟の相対パス(`../common-lib`)で参照する。frontend-libの位置の検査では配置元を直接読み込み、client・adminに配置された後は各アプリの配置先を読み込む                                                                             | (a) frontend-libにも配置し、client・adminでは`lib/common-lib`へ入れ子に配置する (b) 描画の関数を利用側アプリから画面部品へ注入する                                      | (a)はbind mountの入れ子が要り、dev-toolingの配置確認が入れ子を検出しない(`coding/003`の制約)。(b)は全ての呼び出し箇所が注入を書く必要があり、サニタイズ済みの型の保証も弱まる。兄弟の相対パスならdev-toolingの仕組みを変えずに、回答どおり4アプリへの配置で済む                        |
| P5  | 同一オリジンの判定の基準(FR-MDOWN-009)                  | client・adminの両方に変数`CLIENT_SITE_ORIGIN`(利用者側のオリジン)を加え、frontend-platformの環境の検証とブラウザへ渡す設定に含める                                                                                                                                                                                             | 要求のURLのオリジンを使う                                                                                                                                               | 管理者側のプレビューでは要求のURLが管理者側のオリジンになり、利用者側への絶対URLのリンクを別オリジンと誤判定する。値はREADMEの配信URLから決まる                                                                                                                                        |
| P6  | 再抽出の定期実行の時刻                                  | 業務時刻4:21の日次バッチの最後(順序950)に組み込み、日次タイムラインの「日次バッチの内容」に追記する                                                                                                                                                                                                                            | 独立した時刻(例: 4:31)を新設してタイムラインに行を加える                                                                                                                | 既存のcron式(`21 12 * * *`、email-deliveryが追加)を再利用でき、Cron Triggersを増やさない。削除系の処理の後に置くため、削除済みの元データの再抽出を要求しない                                                                                                                           |
| P7  | ローカル環境のキーワード抽出                            | ローカル環境では既定で無効(変数`KEYWORD_EXTRACTOR`を`disabled`、シークレット不要)にし、正規化テキストで索引する。実際のAPIへの疎通は、Infisicalから注入したキーで手元から確かめるスクリプトで確かめる                                                                                                                          | Infisicalの`dev`にもキーを登録し、ローカルでも常に実際のAPIを呼ぶ                                                                                                       | キーを持たない開発者でもイベントサーバーが起動でき(キーが必須だと環境の検証で全要求が失敗する)、ローカルの試行で料金が発生しない。staging・prodは必ず実際のAPIを呼ぶ                                                                                                                   |
| P8  | キーワードから除くエンティティの種類                    | `PHONE_NUMBER`・`ADDRESS`・`DATE`・`NUMBER`・`PRICE`を除き、名前を正規化して重複を除く                                                                                                                                                                                                                                         | 全ての種類を使う                                                                                                                                                        | これらは検索語として使われにくく、電話番号と住所は個人に関する情報になり得る(DR-001)。v2のEntityは重要度(salience)を持たないため、種類で絞る                                                                                                                                           |

## Wave 1の横断レビューの反映(2026-10-18)

infra-delivery・content-processing・media-pipeline・identity-authとroadmapの横断レビュー(1回目のC・I・M、2回目のN)の指摘と、開発者の決定のうち、本specに関係するものである。

| ID  | 指摘                                                                                                    | 本specへの反映                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1 | `apps/common-lib`への依存がroadmapに無く、media-pipeline・identity-authが本specのタスクを前提にしている | `apps/common-lib`の新設は本specに残す(S-1の決定)。roadmapは依存と順序(infra-delivery→content-processing→media-pipeline→identity-auth)を直す。design.mdのUsersとRevalidation Triggersにmedia-pipeline・identity-authを加え、共用部品の新設のタスク(1.1・1.2・4.1・4.2、identity-authは2.1も)が下流の前提であることを設計とタスクに書いた                                                                                                                                                         |
| I-3 | Workerのシークレットの一覧がWave 1のキーを含まず、prodの登録時期が食い違う                              | `GOOGLE_NL_API_KEY`はinfra-deliveryのInfisicalの表とWorkerのシークレットの一覧に載る。stagingの値は、キーを必須にする変更(タスク9.1)をmainへマージする前に開発者が登録する。prodの値の登録はlaunch-readinessへ引き継ぐ                                                                                                                                                                                                                                                                          |
| I-4 | 技術ドキュメントの番号`security/003`がinfra-deliveryと衝突する                                          | 番号をroadmapの順で固定し、本specは`external/002`・`db/004`・`frontend/008`・`security/004-markdown-sanitization.md`を使う。CLAUDE.mdの「技術規則の参照先」とfrontend-platformの`frontend/003`からのリンクも同じ番号にする                                                                                                                                                                                                                                                                      |
| M-1 | `CLIENT_SITE_ORIGIN`の所有が2specに分かれている                                                         | client・adminの変数は本spec、apiの変数はidentity-authが所有し、名前と値を同じにする。互いの再検証の対象に加え、3環境の値はinfra-deliveryの一覧と一致させる                                                                                                                                                                                                                                                                                                                                      |
| M-2 | frontend-libの`server/**`からcommon-libを読む許可が無い                                                 | `server/**`も`../common-lib/**`を読み込めるようにし、`components/**`と同じくZodを使う`validation/**`の読み込みを禁止する。media-pipelineの`server/media`はこれを前提にする                                                                                                                                                                                                                                                                                                                      |
| M-4 | 4:21のジョブの順序を日次タイムラインへ書くspecが偏っている                                              | 4:21にジョブを足す各specが日次タイムラインへ追記する。本specは、日次バッチのジョブの順序の表が無ければ作り(上流のemail-deliveryの`email-delivery.cleanup`・900を含める)、自分のジョブの行を加える                                                                                                                                                                                                                                                                                               |
| M-9 | ジョブ・波及処理の名前の接頭辞がそろっていない                                                          | ジョブの名前は`<spec名>.<名詞句>`(email-deliveryの`email-delivery.cleanup`と同じ)、メッセージ種別は`<ドメイン>.<動詞句>`(backend-platform)にそろえる。再抽出のジョブの名前は`content-processing.keyword-reextraction`とし、メッセージ`search-index.refresh`はそのままとする                                                                                                                                                                                                                     |
| N-1 | Cloudflareの資源の国外移転の根拠を書くspecが無い                                                        | 国外移転の記載事項は委託先単位で分担し、Cloudflareの項をinfra-delivery、AWS(Rekognition)の項をmedia-pipeline、本specが使う委託先Google Cloud(Natural Language API)の項を本specが書く(開発者の決定の委託先単位の分担を当てはめた追加の決定)。受け入れ基準16.9とタスク11.4を加えた。項の形は「移転先・移転の根拠・委託先が講じる措置」、根拠はDPFを主とし、無効になった場合は委託先のDPAに含まれるSCCに拠る。共通の「移転先の国」の行はGoogle Cloudの記述だけを改め、他の委託先の項は書き換えない |
| N-2 | 「無ければ止める」前提に、roadmapに無い依存(email-deliveryの実装)が含まれる                             | タスク1.1の前提からemail-deliveryを外し、実装(4:21のcron式と`email-delivery.cleanup`)の有無を確かめ、無ければ開発者へ報告して続ける形にした。cron式が無ければタスク10で加える。roadmapの依存には加えない                                                                                                                                                                                                                                                                                        |
| N-3 | 下流が前提にするタスクの区切りに`server/**`の許可と日次タイムラインの表が入っていない                   | design.mdの「本specのタスクを前提にする下流spec」の区切りに、6.1・11.3のうち`coding/003`への`server/**`の許可の記述・11.4のうち日次タイムラインの表の作成を加え、許可の確かめ方を注記した。表は最初に4:21のジョブを足すspecが作り、後のspecは行を足す。下流specは表が無いことを理由に止めない                                                                                                                                                                                                   |
| N-4 | ジョブ名の規約の置き場所が無い                                                                          | 受け入れ基準16.8とタスク11.5を加え、backend-platformの`infra/003-async-processing.md`(backend-platform/design.mdで定期実行を説明する文書として割り当てられた番号)へ、ジョブ・波及処理`<spec名>.<名詞句>`とメッセージ種別`<ドメイン>.<動詞句>`の規約を追記する                                                                                                                                                                                                                                   |
| N-5 | 技術ドキュメントへシークレットのキーの一覧を写す設計                                                    | キーの一覧の正を`docs/onboardings/project-values.md`のWorkerのシークレットのキーの一覧の節(infra-deliveryが作る)とし、本specはキーを必須にする変更と同じ変更で`GOOGLE_NL_API_KEY`の行を加える(タスク9.1)。`external/002`はキーと変数の名前を列挙せず、プレースホルダーとリンクにする(タスク11.1)                                                                                                                                                                                                |
| N-6 | 運営者による代理の退会                                                                                  | 本specは関係しない(identity-auth・ugc-moderation)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| N-7 | 停止中の利用者のアップロードの拒否                                                                      | 本specは関係しない(media-pipeline・identity-auth)                                                                                                                                                                                                                                                                                                                                                                                                                                               |

- M-5(4:21の1回の起動の時間の予算)とM-7(同じファイルへの追記によるマージの衝突)は、開発者とbackend-platformの判断に委ね、本specでは扱わない。

## Research Log

### Crepe 7.22.2の構成と容量

- **Context**: Q2の回答(builderで必要な機能だけを遅延読み込み、7.22.2に固定)。
- **Sources Consulted**: npmの`@milkdown/crepe`の公開日時(7.22.2は2026-09-23、7.22.3は2026-10-10)、scratchpadへ`@milkdown/crepe`・`@milkdown/kit`・`@milkdown/react`の7.22.2を導入して型定義と配布物を確認し、`bun build --minify --target=browser`(Reactは外部)で容量を計測した。
- **Findings**:
  - `@milkdown/crepe/builder`の`CrepeBuilder`は`addFeature(feature, config)`・`create()`・`destroy()`・`editor`(Milkdownの`Editor`)・`setReadonly`・`getMarkdown`・`on(listener)`を持つ。機能ごとの入口は`./feature/{toolbar,list-item,link-tooltip,placeholder,cursor,table,top-bar,block-edit,image-block,latex,code-mirror,ai}`である。
  - builderの基本構成は`commonmark`・`gfm`・`listener`・`history`・`indent`・`trailing`・`clipboard`・`upload`のプラグインを常に読み込む。
  - 容量(gzip後): 選択時のツールバー・リスト・リンクのツールチップ・プレースホルダー・カーソル・表とremark-cjk-friendlyで約786KB(約250KB)、固定ツールバーを加えると約807KB(約257KB)。描画パイプラインだけでは約220KB(約66KB)。KaTeX・CodeMirrorは含まれず、`eval(`・`new Function`の出現は0件だった。
  - 内部のUIはVue 3(`createApp`・`h`)で描かれる。描画関数を使うため、テンプレートのコンパイラ(実行時のコード生成)は要らない。Vueのesm-bundler版はビルド時の機能フラグ(`__VUE_OPTIONS_API__`など)が未定義だと開発時に警告する。
  - `@milkdown/react` 7.22.2の`useEditor(getEditor)`は、`Editor`か`CrepeBuilder`を返す関数を受け取り、`Milkdown`・`MilkdownProvider`と組み合わせてマウントと破棄を行う。
- **Implications**: 組み込む機能は仮決定P1の範囲に絞る。`<ClientOnly>`で囲んだ`React.lazy`の別チャンクに閉じ込め、サーバー側の描画では読み込まない(TanStack Startのルール`ssr-hydration-safety`)。client・admin・frontend-libのVite設定でVueの機能フラグを`false`に定義する。

### Crepeの部品のアクセシビリティ

- **Context**: UI-003(WCAG 2.2 AA)と、frontend-platformの「共通部品のブラウザテストでaxeの違反0件」(Q8)。
- **Sources Consulted**: 7.22.2の`feature/top-bar/index.js`・`feature/toolbar/index.js`・`@milkdown/components`の`table-block`・`link-tooltip`の配布物、テーマのCSS(`table.css`)。
- **Findings**:
  - 固定ツールバー: ボタンは`aria-label`・`title`を持たず、アイコン(SVG)だけを内容に持つ。押下の処理は`onPointerdown`だけで、Enter・Spaceキーで発火しない。見出しの選択肢は`headingOptions`で、画像の挿入は`ImageBlock`の機能が有効な場合だけ表示される。
  - 選択時のツールバー: ボタンは`aria-label`・`title`・`aria-keyshortcuts`を持ち、ラベルは設定(`boldLabel`など)と`buildToolbar`で変えられる。押下は`onPointerdown`である。
  - 表の操作UI: 行・列のハンドルの各ボタン(配置・削除・追加)は名前を持たず、`opacity`で隠すだけでアクセシビリティツリーに残る。
  - リンクのツールチップ: 確認・削除などのボタンに名前が無い。
  - アイコンは`DOMPurify.sanitize`を通した固定のSVG文字列を`innerHTML`で挿入している(ライブラリ内部で、利用者の入力ではない)。
- **Implications**: 仮決定P1のとおり、固定ツールバー・表の操作UI・リンクのツールチップは自前の部品で置き換え、選択時のツールバーは日本語のラベルを設定して補助として残す(キーボードの利用者は固定ツールバーとショートカットで同じ操作ができる)。

### Crepeの入力経路と見出しレベル1・画像・Tabキー

- **Context**: Q2の回答(見出しレベル1の入力ルールと貼り付けを止める)、FR-MDOWN-002、UI-003(キーボードの罠)。
- **Sources Consulted**: `@milkdown/preset-commonmark`・`@milkdown/preset-gfm`・`@milkdown/plugin-indent`・`@milkdown/core`・`@milkdown/utils`の7.22.2の型定義と配布物。
- **Findings**:
  - 見出しの入力規則`wrapInHeadingInputRule`は`#`1〜6個に一致し、`headingKeymap`は`TurnIntoH1`(`Mod-Alt-1`)を持つ。キーマップは`$UserKeymap`で、設定から割り当てを変えられる。
  - 画像の入力規則`insertImageInputRule`があり、コアのプリセットは画像のノードを持つ。`upload`のプラグインはファイルの貼り付け・ドロップで画像のノードを挿入する。
  - `Editor.remove(plugins)`で読み込み済み・読み込み予定のプラグインを外せる。
  - Tabキーは、`indent`のプラグイン(字下げ)、commonmarkのリストの`SinkListItem`(`Tab`・`Mod-]`)、gfmの表のセル移動(`Tab`・`Mod-]`)に割り当てられている。
  - `$remark(id, () => plugin)`でremarkのプラグインを登録でき、Milkdownの`@milkdown/transformer`はremark 15系(unified 11)を使う。remark-cjk-friendly 2.3.2と同じ系列である。
- **Implications**: 見出しレベル1の入力規則・画像の入力規則・アップロードのプラグイン・インデントのプラグインを外し、見出しレベル1の割り当てを外す。見出しの入力規則はレベル2〜6だけのものを加える。貼り付け・既存の値の読み込みで入る見出しレベル1と画像は、ProseMirrorのプラグインで描画時と同じ文字列に置き換える。リストの階層と表のセル移動は`Mod-]`・`Mod-[`と矢印キーに限り、Tabキーで編集領域から出られるようにする。

### Crepeのテーマとフォント

- **Sources Consulted**: `@milkdown/crepe/lib/theme`のCSS。
- **Findings**: `theme/common/style.css`は全機能のCSSを`@import`し、`latex.css`経由でKaTeXのCSSとフォントを取り込む。`frame`などのテーマはNoto Sans・Noto Serif・Space Monoを指定する。各CSSは`--crepe-color-*`・`--crepe-font-*`の変数で色とフォントを受け取る。
- **Implications**: `theme/common/*`から使う機能のCSSだけを取り込み、テーマのCSSは使わず、`--crepe-*`の変数をデザイントークン(ライト・ダーク)とOSのフォントの並びに対応付ける(frontend-platformの「Webフォントを読み込まない」)。

### 描画パイプラインの挙動

- **Context**: FR-MDOWN-004〜006・009〜012、Q5。
- **Sources Consulted**: scratchpadでunified 11.0.5・remark-parse 11.0.0・remark-gfm 4.0.1・remark-cjk-friendly 2.3.2・remark-cjk-friendly-gfm-strikethrough 2.3.1・remark-rehype 11.1.2・rehype-sanitize 6.0.0・rehype-stringify 10.0.1・hast-util-to-text 4.0.2で試作した。
- **Findings**:
  - remark-rehypeは既定(`allowDangerousHtml: false`)でRaw HTMLの節点を捨てる。構文木(mdast)の段階で`html`の節点を文字列の節点に置き換えると、ブロックの位置のRaw HTMLは段落に包まれずに出力されるため、ブロックの位置では段落で包む必要がある。
  - rehype-sanitizeの既定のスキーマは、`href`の許可スキームに`http`・`https`・`irc`・`ircs`・`mailto`・`xmpp`を持ち、スキームの無い参照(`/help/x`・`foo`・`//evil.example`)を残す。`javascript:`の参照は属性ごと消え、`<a>`だけが残る。
  - 既定の`clobber`は`id`・`name`・`ariaDescribedBy`・`ariaLabelledBy`で、`clobberPrefix`を値の前に付ける。`href`の`#…`は書き換えない。remark-rehypeは脚注のIDと参照に自身の`clobberPrefix`(既定`user-content-`)を付けるため、両方を既定のままにすると接頭辞が二重になる。remark-rehypeの`clobberPrefix`を空にすると、脚注のIDはサニタイズで接頭辞が付き、参照の`#fn-1`は接頭辞が付かないまま残る。
  - 脚注の見出しは`<h2 class="sr-only" id="footnote-label">`で、文言の既定は英語(「Footnotes」「Back to reference 1」)である。`footnoteLabel`・`footnoteBackLabel`で変えられる。
  - 見出しレベル1と画像は、構文木の段階で段落と文字列に置き換えれば、表示がモックアップと一致した。remark-cjk-friendlyにより`**太字。**の`が強調になった。
  - 表の配置は`align`属性で出力され、既定のスキーマで残る。
  - 性能: 20,000文字(見出し・強調・リンク・リスト・表を含む)の文書の描画はBunで平均約124ms、2,000文字で約9msだった。
- **Implications**: 処理の順序は「解析→構文木での文字列化(Raw HTML・見出しレベル1・画像)→HTMLの構文木への変換→見出しのID→サニタイズ→サニタイズ後の信頼できる変換(`#`の参照の書き換え・リンクの方針・表の枠)」とする。許可リストはremarkとremark-rehypeが出力する要素だけに絞る。描画の結果は入力と指定でメモ化し、性能はテストで計測して劣化を検出する。

### FR-MDOWN-006のスラッグとアンカーリンク

- **Context**: FR-MDOWN-006、Q5。
- **Sources Consulted**: WHATWG HTML Standardの「scroll to the fragment」(素のフラグメントで要素を探した後、パーセントデコードした値でも探す)、micromarkのURLの正規化(英数字と一部の記号を残し、非ASCIIと空白をエンコードする)、scratchpadでの試作。
- **Findings**:
  - 「概要 Hello World!」はFR-MDOWN-006の規則で`%E6%A6%82%E8%A6%81-hello-world%21`になる。利用者が`[x](#概要-hello-world!)`と書くと、参照は`#%E6%A6%82%E8%A6%81-hello-world!`に正規化され、`!`がエンコードされずにIDと一致しない。
  - IDに`%`を含めても、ブラウザは素のフラグメントでIDを探すため、アドレスバーで`#概要`と入力した場合(ブラウザがエンコードする)も一致する。
- **Implications**: 本文中の`#`の参照は、フラグメントをパーセントデコードしてから見出しと同じ変換を通し、接頭辞を付けて書き換える。デコードできない場合はそのまま変換する。

### FTS5の動作確認

- **Context**: FR-FTS-001・002・009、Q4、DR-014、`db/002`のexternal contentとトリガーの例。
- **Sources Consulted**: scratchpadのbun:sqlite(SQLite 3.53.2)。
- **Findings**:

  | 確認                                                                                        | 結果                                                       |
  | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
  | external content(`content_rowid`に`INTEGER PRIMARY KEY`)と追加・更新・削除のトリガー        | 同期し、`integrity-check`が成功した                        |
  | `"タスク管理"` / `"タスク管理"*` / `"管理"*`(索引語は「タスク管理ツール」)                  | 一致しない / 一致する / 一致しない(キーワード列でのみ一致) |
  | `"cafe"*`・`"CAFE"*`・`"resume"`(元は「Café résumé」)                                       | 一致する(大文字小文字と発音区別符号を無視)                 |
  | `"!!!"*`・`"a""b"*`・`"NOT"*`・`"name:x"*`                                                  | 構文の誤りにならず、0件                                    |
  | `bm25(fts, 10.0, 5.0, 1.0)`の列ごとの重み                                                   | 列ごとの重みで並んだ                                       |
  | `ON CONFLICT(source_id) DO UPDATE ... WHERE excluded.source_version >= docs.source_version` | 古い版の更新が無視された                                   |
  | `INSERT ... SELECT ?, ? WHERE EXISTS (SELECT 1 FROM 元のテーブル WHERE ...)`                | 元データが無い・論理削除済みの場合に追加されなかった       |
  - `prefix='2 3'`を付けた索引も作成・照合できた。

- **Implications**: 索引文書のテーブルを`INTEGER PRIMARY KEY`の連番にしてexternal contentの`content_rowid`に指定し、トリガーで同期する。索引の更新は、版と元データの存在を条件にした1文で行う。D1(Workers統合テスト)でも同じ確認を行う。

### Google Cloud Natural Language v2

- **Context**: SW-024、FR-FTS-006、Q3。
- **Sources Consulted**: [documents.analyzeEntities(v2)](https://docs.cloud.google.com/natural-language/docs/reference/rest/v2/documents/analyzeEntities)、[Document(v2)](https://docs.cloud.google.com/natural-language/docs/reference/rest/v2/documents)、[Entity(v2)](https://docs.cloud.google.com/natural-language/docs/reference/rest/v2/Entity)、[Language support](https://docs.cloud.google.com/natural-language/docs/languages)、[Quotas and limits](https://docs.cloud.google.com/natural-language/quotas)、[Pricing](https://cloud.google.com/natural-language/pricing)(料金は調査担当の確認値)。
- **Findings**:
  - 要求: `POST https://language.googleapis.com/v2/documents:analyzeEntities`、本文は`{ document: { type: 'PLAIN_TEXT', content, languageCode? }, encodingType: 'UTF8' }`。`languageCode`を省くと自動判定する。APIキーは`x-goog-api-key`ヘッダーで渡せる。
  - 応答: `entities[]`(`name`・`type`・`metadata`・`mentions[]`(`text`・`type`・`probability`))、`languageCode`、`languageSupported`(公式に対応していない言語でも最善努力で応答し得る)。
  - Entityの`type`は`UNKNOWN`・`PERSON`・`LOCATION`・`ORGANIZATION`・`EVENT`・`WORK_OF_ART`・`CONSUMER_GOOD`・`OTHER`・`PHONE_NUMBER`・`ADDRESS`・`DATE`・`NUMBER`・`PRICE`。
  - 非対応の言語は`INVALID_ARGUMENT`(HTTP 400)になる。エンティティ分析の対応言語はzh・zh-Hant・en・fr・de・it・ja・ko・pt・ru・es。
  - 上限: 1要求1,000,000バイト、トークン100,000(超過分は無視)、毎分600要求・毎日800,000要求(プロジェクト単位)。
  - 料金: 1,000文字を1単位、毎月5,000単位まで無料、以降1,000単位あたり1ドル。
- **処理する場所とデータの扱い(N-1の追加の決定で確認)**:
  - [Locations](https://docs.cloud.google.com/natural-language/docs/locations): 既定のグローバルのエンドポイント(`language.googleapis.com`)では、Googleは処理する場所を特定のリージョンに限ることを保証しない。複数リージョンのエンドポイント`us-language.googleapis.com`・`eu-language.googleapis.com`を使うと、機械学習の処理をそれぞれ米国・EUの中だけで行う。同じ文書はv2(`documents:analyzeEntities`)が複数リージョンのエンドポイントで使えるかを明記していない。
  - [Data Usage FAQ](https://cloud.google.com/natural-language/docs/data_usage): 送ったテキストはメモリ上で処理されて保存されず、サービスの提供以外に使われず、現在は学習に使われない。要求の時刻や大きさなどのメタデータは、サービスの改善と不正利用の対策のため一時的に記録される。
  - 本specはグローバルのエンドポイントを使う(`ANALYZE_ENTITIES_ENDPOINT`)ため、国外移転の記載事項のGoogle Cloudの項には「処理する場所は保証されない」と書く。
- **Implications**: 応答の`languageSupported: false`と、言語を理由とする400を「非対応言語」とする。それ以外の400と401・403は設定の誤り、429・5xx・通信の失敗・時間切れは一時的な失敗とする。キーワードは種類で絞り(仮決定P8)、名前を正規化して重複を除く。抽出の入力が前回と同じなら呼ばない(料金の抑制)。

### CSPへの影響

- **Context**: frontend-platformのnonce付きCSP(スクリプトはnonceと`'self'`、スタイルは`'unsafe-inline'`、接続・画像・フォントは個別の許可)。
- **Findings**:
  - Crepeの別チャンクとCSSは、ビルド結果として同一オリジンの`/assets/*`から読み込まれ、`'self'`で許可される。Viteの`modulepreload`にもnonceが付く(frontend-platformのResearch Log)。
  - `eval`・`new Function`を使わないため`'unsafe-eval'`は不要である。
  - インラインのスタイル(Vue・ProseMirrorが要素の`style`を操作)はCSSOM経由で、`style-src`の対象外である。
  - KaTeXとテーマのWebフォントを取り込まないため、`font-src`の追加は要らない。外部への接続も無い。
- **Implications**: CSPと`SecurityPolicySources`の変更は無い。frontend-platformへの影響は、静的解析の規則と生のHTMLの例外の1箇所、Vite設定の機能フラグ、変数`CLIENT_SITE_ORIGIN`に限られる。

### 共有ディレクトリの参照

- **Context**: Q1(4アプリへの配置)と、frontend-libの画面部品がcommon-libを使うこと。
- **Sources Consulted**: `config/workspace-layout.ts`・`scripts/tooling/shared-dirs.ts`・`compose.yaml`・`coding/003-shared-directories.md`・frontend-platformのresearch.md(「共有ディレクトリ(検査担当が自分自身)の型検査設定」)。
- **Findings**:
  - frontend-libのファイル(`apps/frontend-lib/components/x/y.tsx`)から`../../../common-lib/…`は配置元の`apps/common-lib/…`を、clientに配置された同じファイル(`apps/client/lib/components/x/y.tsx`)からは配置先の`apps/client/common-lib/…`を指す。backend-libからも同じ書き方で、api・eventの配置先を指す。
  - 入れ子の配置(`apps/client/lib/common-lib`)は、bind mountの入れ子と、配置確認が入れ子のマウントを検出しない制約(`coding/003`)に当たる。
  - frontend-libの位置の検査(型検査・ブラウザテスト・Storybook)では、common-libのbare importはcommon-libのnode_modulesから解決される。Viteの開発サーバーは既定でプロジェクトの外のファイルを配信しないため、`server.fs.allow`に配置元を加える必要がある。
  - 検査担当が`self`の共有ディレクトリの`tsconfig.json`は、配置先で相対パスの`extends`を解決できずViteのビルドが失敗するため、自己完結にする必要がある(frontend-platformの確認)。WranglerのesbuildもファイルごとにWranglerが最も近い`tsconfig.json`を探す。
- **Implications**: 仮決定P4のとおり兄弟の相対パスで参照する。common-libの`tsconfig.json`は自己完結にし、基底設定との一致を単体テストで確かめる。frontend-libの位置では同じパッケージが2つの実体になり得るため(frontend-libとcommon-libのzodなど)、frontend-libの部品はcommon-libのZodを使うモジュールを読み込まない規約を`coding/003`に書く。

### 参照したスキル

- `tanstack-start`の`ssr-hydration-safety`: ブラウザだけで動く部品は`React.lazy`と`Suspense`で分け、サーバー側の描画では仮の表示にする。TanStack Routerの`ClientOnly`で、サーバー側の描画と初期化の間は代わりの表示を出す。
- `ecc:security-review`: 利用者が入力したHTMLは必ずサニタイズしてから挿入する。サニタイズは許可リスト方式とし、攻撃パターンでテストする。
- `ecc:frontend-a11y`・`ecc:accessibility`: アイコンだけのボタンの名前、ラベル・説明・エラーの`aria-*`による関連付け、ダイアログのフォーカスの移動と戻り、キーボードの罠を作らないこと。
- `ecc:content-hash-cache-pattern`: 内容のハッシュを再計算の要否の鍵にし、内容が変わった時だけ高い処理(外部API)を行う。
- `ecc:error-handling`: 想定内の失敗を判別可能なユニオンの`kind`で表し、例外を再試行の合図にだけ使う。
- `ecc:react-testing`: 部品のテストは`vitest-browser-react`で描画し、役割とラベルで要素を探す。
- `cloudflare:workers-best-practices`: 外部APIの呼び出しは時間切れを設け、グローバルスコープで通信しない。

## Architecture Pattern Evaluation

| Option                                       | Description                                                                                                  | Strengths                                                                            | Risks / Limitations                                                                | Notes  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------ |
| 共用部品+画面部品+ポートとアダプタの検索基盤 | 純粋な描画・文字数・検索語の処理を共用部品に、画面部品を共通部品に、索引の判断をcoreの純粋関数とポートに置く | 1つの定義を全アプリで使える。判断を単体テストで、D1と外部APIを統合テストで検査できる | 共有ディレクトリが5つになり、配置と依存の版の管理が増える                          | 採用   |
| 描画をAPIサーバーに集約                      | GraphQLでサニタイズ済みHTMLを返し、プレビューもAPIへ問い合わせる                                             | フロントの依存が減る                                                                 | プレビューのたびに通信とレート制限が掛かり、Q1で不採用                             | 不採用 |
| 検索対象ごとのDIの読み取りポート             | 元データの読み取りをドメインの`ContainerModule`で束縛する                                                    | Inversifyの慣行に沿う                                                                | api(再抽出の対象の列挙)とevent(読み取り)で登録が二重になり、食い違いを検出しにくい | 不採用 |
| 登録データとしての検索対象(`SEARCH_TARGETS`) | 索引の定義・項目・読み取りの関数・対象の条件を1つの定義にまとめ、集約点に並べる                              | 両アプリが同じ定義を読み、単体テストで登録の誤りを検出できる                         | 読み取りの関数がDrizzleに依存するため、workersの層に置く必要がある                 | 採用   |

## Design Decisions

### Decision: 描画はサニタイズの後に信頼できる変換だけを行う

- **Context**: FR-MDOWN-005・006・009〜012、Q5。
- **Alternatives Considered**:
  1. rehype-sanitizeを最後に置き、リンクの`target`・`rel`や表の枠もスキーマで許可する — 利用者の入力に由来しない属性まで許可リストに入り、許可の範囲が広がる。
  2. サニタイズを先に行い、その後に本specのコードだけが属性を加える — 許可リストは入力に由来する要素だけに絞れる。
- **Selected Approach**: 2。サニタイズの後に、`#`の参照の書き換え(接頭辞)・許可外の参照のリンクの解除・`target`と`rel`・表の横スクロールの枠を加える。見出しのIDはサニタイズの前に付け、サニタイズの`clobberPrefix`で接頭辞を付ける(脚注のIDも同じ経路で付く)。
- **Trade-offs**: サニタイズ後の変換に誤りがあると安全性を損ねるため、変換は既に許可された要素への属性の追加と、要素の除去・包みに限り、攻撃パターン集の全件の出力を許可リストで検査する。

### Decision: 「書く/プレビュー」を残し、書く側をWYSIWYGにする

- **Context**: Q2の回答(役割の重なりとSSR時の仮表示を設計で決める)、FR-MDOWN-003、`design/002-page-layouts.md`の「書く/プレビュー」。
- **Alternatives Considered**:
  1. タブを残し、「書く」をWYSIWYGの編集領域、「プレビュー」を表示部品と同じ描画にする
  2. タブを無くし、WYSIWYGをリアルタイムのプレビューとみなす
  3. 編集領域とプレビューを横に並べる
- **Selected Approach**: 1。WYSIWYGの見た目は公開時の表示と一致しない(許可外のリンクの解除、見出しのIDと接頭辞、`target`と`rel`、表の横スクロール、本文の文字組み、見出しレベル1と画像の文字列化)。プレビューは公開時と同じ描画部品と表示部品で、表示場所と同じ指定で描く。ページ構成の記述と画面の構成を変えずに済む。
- **Trade-offs**: 書く側も書式を表示するため、プレビューは確認のための補助になる。モックアップとの差は「モックアップとの差」の表に記録する。

### Decision: 入力欄の外枠は常に描き、編集領域だけを遅延読み込みにする

- **Context**: briefの実現性チェック(静的importでSSRバンドルが肥大化)、NFR-PERF-001、Q2。
- **Selected Approach**: 外枠(タブ・固定ツールバー・カウンター・ラベルとの関連付け)は通常のコンポーネントとしてサーバー側でも描く。編集領域は`<ClientOnly>`の中の`React.lazy`で読み込み、それまでは同じ大きさの仮の表示(現在の値の描画結果と「エディタを読み込んでいます」、`aria-busy`)と、操作できない状態のツールバーを出す。`@milkdown/*`をimportできるのは`components/markdown-editor/crepe/`だけとし、外からは1つの読み込み関数の`import()`でだけ参照する。
- **Rationale**: 読み込みの前後で配置が変わらず、ツールバーの操作は編集領域の読み込み後に有効になる。Milkdownの型は外枠へ漏らさず、外枠と編集領域は`EditorController`の契約で結ぶ。

### Decision: 文字数のカウンターは保存されるマークダウンの原文を数える

- **Context**: 文言・文字数規則(フロントとサーバーで同じ値)、モックアップのカウンター。
- **Selected Approach**: 編集領域が出力するマークダウンの原文(記法を含む)を書記素で数える。サーバー側の検証と同じ値になる。WYSIWYGでは記法が見えないため、表示される文字数より大きくなる場合がある点を技術ドキュメントに記載する。
- **Trade-offs**: 利用者の見た目の文字数とずれる。見た目の文字数で数えると、サーバーが拒否する入力をフロントが通してしまう。

### Decision: 索引の書き込みは版と元データの存在を条件にした1文で行う

- **Context**: Queuesは少なくとも1回の配送で順序を保証しない(backend-platform)。FR-FTS-009、要件9.7・9.8・11.3。
- **Alternatives Considered**:
  1. 読み直した元データで無条件に上書きする — 古い版の後着や、削除との競合で索引が復活する。
  2. 版(元データが返す単調増加の値)と、元データの存在と対象の条件を、1文の`INSERT ... SELECT ... WHERE EXISTS ... ON CONFLICT DO UPDATE ... WHERE`で同時に判定する。
- **Selected Approach**: 2。D1は文を直列に実行するため、ドメインの削除の一括の書き込みと索引の書き込みが入り交じらない。
- **Follow-up**: D1上のWorkers統合テストで、古い版・削除済み・対象外の元データの書き込みが無視されることを確かめる。

### Decision: ドメインの書き込みに「更新待ち」の印を含め、要求の送信は失敗させない

- **Context**: 要件9.1・9.10、briefの「GCP NLの障害時も書き込み系の処理を止めない」、backend-platformのデッドレターの破棄(Q7)。
- **Selected Approach**: ドメインは作成・編集の一括の書き込みに索引の「更新待ち」の印(索引文書が無ければ空の行、あれば状態だけを変える)を含め、書き込みの後に更新の要求を送る。要求の送信の失敗はログとSentryに送り、ドメインへは失敗を返さない。日次の再抽出が、1時間以上「更新待ち」のままの索引文書の更新を要求し直す。
- **Trade-offs**: 索引文書が空の行で先に作られるが、空の列は検索に一致しない。デッドレターに移ったメッセージも日次で回復する。

### Decision: キーワード抽出の状態を5つに分ける

- **Context**: Q3、要件10。
- **Selected Approach**: `pending`(更新待ち・抽出の試行中)、`extracted`(抽出済み)、`fallback`(失敗が続いたか設定の誤りで正規化テキストを使用、日次で再抽出)、`unsupported`(非対応言語で正規化テキストを使用、再抽出しない)、`disabled`(抽出を無効にした環境で正規化テキストを使用、再抽出しない)。
- **Rationale**: 再抽出の対象(`fallback`と古い`pending`)を1つの条件で選べる。非対応言語を毎日再試行して料金を使うことを避ける。

### Decision: 表示はページの描画とブラウザの両方で同じ描画部品を使う

- **Context**: Q1(SSRとクライアントで共用)、要件4.15。
- **Alternatives Considered**:
  1. ページのサーバー側の描画とブラウザの初期化の両方で描画部品を呼び、入力と指定でメモ化する
  2. サーバー側だけで描画し、HTMLをローダーのデータでブラウザへ渡す — HTMLがページ内に2回入り、転送量が増える。
- **Selected Approach**: 1。描画は純粋な関数で、同じ入力と指定から同じHTMLを返す。表示部品は`RenderedMarkdown`を受け取り、目次(help-center)も同じ結果の見出しの一覧を使う。
- **Trade-offs**: 長い本文(20,000文字)ではブラウザの初期化に描画の時間(Bunで約124ms)が加わる。計測を単体テストに置き、劣化を検出する。

### Decision: 強調表示は全文検索の語の区切りに合わせた前方一致にする

- **Context**: `design/002-page-layouts.md`の「説明文やキーワード抽出結果のみで一致したプロダクトには強調が付かない」、Q4。
- **Selected Approach**: 文字列を書記素ごとに折りたたみ(NFKC→NFD→結合文字の除去→小文字化)、文字・数字の連続を語とみなして、各検索語が語の先頭から一致する範囲だけを返す。unicode61も文字・数字以外で区切るため、全文検索で名称が一致しない語の途中(例: 「タスク管理ツール」の「管理」)を強調しない。

### Decision: common-libの`tsconfig.json`を自己完結にする

- **Context**: frontend-platformの確認(検査担当が`self`の共有ディレクトリは配置先で`extends`を解決できない)。
- **Selected Approach**: `extends`を持たず、基底設定の値を書き写す。差分は`lib: ["ES2024"]`(DOMの型を持たない)と`types: ["bun"]`と`include`だけとし、基底設定との一致を単体テストで確かめる。

### Generalization・Build vs Adopt・Simplification

- **Generalization**:
  - 描画の処理(解析からサニタイズまで)を1つにし、表示用(HTML・見出し)と索引用(プレーンテキスト)はその後段だけを変える。
  - 検索対象の登録は、プロダクトとヘルプ記事に共通する「項目の形式と用途・読み取り・版・対象の条件」の組として表し、後続の検索対象も同じ形で加えられる。
  - 抽出のアダプタは`KeywordExtractor`の1つの契約に揃え、無効化した環境の実装も同じ契約で差し替える。
- **Build vs Adopt**:
  - 採用: unified系(解析・変換・サニタイズ・文字列化・テキスト抽出)、CrepeとMilkdownのコマンド(編集領域)、`@tailwindcss/typography`(本文の文字組み)、FTS5(索引と照合とBM25)、Zod(検証規則)、`Intl.Segmenter`・`String.prototype.normalize`・Web Crypto(書記素・NFKC・ハッシュ)。
  - 自作: FR-MDOWN-006のスラッグ(既製品は記号を削除する)、リンクの方針と`#`の参照の書き換え、見出しレベル1・画像・Raw HTMLの文字列化、Crepeの代わりの固定ツールバーとリンクのダイアログ(仮決定P1)、FTS5のSQLのひな形と検索式、強調表示の照合、自然言語APIの`fetch`のアダプタ(公式SDKはgRPCでWorkersに向かない)。
  - 不採用: rehype-slug(仮決定P2)、`hast-util-to-jsx-runtime`(確認済み事項)、hast・mdastの型パッケージの直接の宣言(変換で触る節点だけの構造的な型を共用部品に置く)。
- **Simplification**:
  - 索引の状態の記録は索引文書のテーブルの列に持ち、別の管理テーブルを作らない。
  - 全件の再索引の仕組みは作らない(初回のデータはリリース前に無く、全文検索の索引の作り直しはSQLの`rebuild`で足りる)。
  - 抽出結果の別のキャッシュは作らず、索引文書のハッシュとキーワードを再利用する。
  - E2Eテストは、入力欄と検索を使う画面を持つ後続spec(engagement・directory-discovery・help-center)が書く。本specは部品のブラウザテストとWorkers統合テストで確かめる。

### モックアップとの差

| 項目               | モックアップ(`comment-composer.tsx`・`markdown.tsx`・`collapsible-markdown.tsx`)        | 本設計                                                                                        | 理由                                  |
| ------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- |
| 「書く」の入力欄   | textareaに記法を挿入する                                                                | 書式を適用した見た目のまま編集する編集領域(Crepe)                                             | Q2                                    |
| 書式のツールバー   | 9つ(見出し・太字・斜体・リンク・箇条書き・番号付きリスト・引用・コード・コードブロック) | 9つに「表」を加えた10個。選択時のツールバー(太字・斜体・取り消し線・コード・リンク)も表示する | Q2(表を機能に含める)、仮決定P1        |
| リンクの挿入       | `[リンク](https://)`の文字列を挿入する                                                  | URLを入力するダイアログ                                                                       | WYSIWYGでは記法を直接入力しないため   |
| SSR時の表示        | textareaを描く                                                                          | 同じ大きさの仮の表示(現在の値の描画結果)と操作できない状態のツールバー                        | 編集領域はブラウザでだけ動く(Q2)      |
| 文字数の読み上げ   | カウンター全体を`aria-live="polite"`にする                                              | 上限の超過と戻りの時だけ読み上げる                                                            | 入力のたびの読み上げを避ける(要件3.5) |
| 同一オリジンの判定 | `https?://`で始まれば外部とする                                                         | サイトのオリジンと比べる                                                                      | FR-MDOWN-009                          |
| 表の横スクロール   | `overflow-x-auto`の枠                                                                   | 同じ枠に`tabindex="0"`・`role="region"`・名前を付ける                                         | キーボードでのスクロール(要件4.13)    |
| 折りたたみ         | マウント後に高さを測って折りたたむ                                                      | 初めから指定の高さで折りたたみ、測定後にあふれる場合だけ「続きを読む」を出す                  | 初期化後のレイアウトのずれを減らす    |

## Risks & Mitigations

- Milkdownの文字列化が利用者の記法を書き換える(強調の記号の統一、`1.`などの先頭の記号のエスケープ)ため、保存される原文と文字数が見た目と異なり得る — カウンターは保存される原文を数え、技術ドキュメントに注意を書く。代表的な記法の往復をブラウザテストで確かめる。
- 20,000文字の本文の描画(Bunで約124ms)が、遅い端末のブラウザの初期化を遅らせる — 入力と指定でメモ化し、単体テストで処理時間の上限を確かめる。劣化した場合は、表示場所の側でサーバーだけの描画に切り替えられるよう、表示部品は描画結果を受け取る形にする。
- 索引文書のテーブルの列を変えると、drizzle-kitがテーブルを作り直してトリガーが消える — 列を変えた後にトリガーを作り直すSQL(`renderSearchIndexTriggersSql`)と`rebuild`を手順に含め、マイグレーションとの突き合わせの単体テストでトリガーの欠落を検出する。
- D1のFTS5が`prefix`の指定・`bm25`の重み・トリガーをbun:sqliteと同じに扱うかは未確認 — D1上のWorkers統合テストで確かめ、違えば`prefix`を外す。
- 自然言語APIをグローバルのエンドポイントで呼ぶため、処理する場所が保証されない — プライバシーポリシーの大枠のGoogle Cloudの項にその旨と移転の根拠(DPFを主、DPAのSCCを予備)を書く。米国だけでの処理を保証したい場合は、`us-language.googleapis.com`がv2の`analyzeEntities`に対応するかを疎通確認のスクリプトで確かめてから接続先を変え、同じ変更で項を改める(開発者の判断)。
- 自然言語APIの応答の形は文書から決めた(実際のキーでの確認はしていない) — 応答をZodで検証し、合わなければ設定の誤りとしてSentryへ送る。開発者が疎通確認のスクリプトで実際の応答を確かめる。
- 同じ時期に作るspec(infra-delivery・media-pipeline・identity-auth)も`docs/GUIDES/tech`へ文書を加えるため、文書の番号が衝突し得る — 番号をroadmapの順で先に割り当てて固定した(横断レビューI-4)。本specは`external/002`・`db/004`・`frontend/008`・`security/004`を使う。
- frontend-libの位置の検査では、frontend-libとcommon-libで同じパッケージ(zodなど)が2つの実体になり得る — frontend-libの部品はcommon-libのZodを使うモジュールを読み込まない規約を置き、利用側アプリでは1つの実体になることをclient・adminの型検査とビルドで確かめる。
- `Intl.Segmenter`の書記素の境界は、ブラウザとWorkersのICUの版の差で、新しい絵文字の並びだけ異なり得る — 代表的な絵文字・結合文字・国旗で両方の結果が一致することをテストし、差は技術ドキュメントに記す。
- Crepeの版の更新で、組み込んだ機能のDOMや入力規則の名前が変わる — 版を完全に固定し、更新時はブラウザテスト(見出しレベル1・画像・Tabキー・アクセシビリティ)とバンドルの分離の検査を必ず実行する。

## References

- [FTS5 External Content Tables](https://sqlite.org/fts5.html#external_content_tables) — 外部コンテンツとトリガーの同期、`rebuild`
- [FTS5 Prefix Queries・The bm25() function](https://sqlite.org/fts5.html) — 前方一致と列ごとの重み
- [Cloud Natural Language API v2 reference](https://docs.cloud.google.com/natural-language/docs/reference/rest/v2/documents) — 要求と応答
- [Cloud Natural Language quotas](https://docs.cloud.google.com/natural-language/quotas) — 上限と割り当て
- [Cloud Natural Language locations](https://docs.cloud.google.com/natural-language/docs/locations) — グローバルと複数リージョンのエンドポイント、処理する場所の保証
- [Cloud Natural Language Data Usage FAQ](https://cloud.google.com/natural-language/docs/data_usage) — 送ったテキストの保存・利用・メタデータの記録
- [rehype-sanitize](https://github.com/rehypejs/rehype-sanitize) — 許可リストと`clobberPrefix`
- [remark-rehype](https://github.com/remarkjs/remark-rehype) — Raw HTMLの扱いと脚注の文言
- [Milkdown Crepe](https://milkdown.dev/docs/guide/using-crepe) — builderと機能
- [WCAG 2.2 2.1.2 No Keyboard Trap](https://www.w3.org/TR/WCAG22/#no-keyboard-trap) — Tabキーの扱い
