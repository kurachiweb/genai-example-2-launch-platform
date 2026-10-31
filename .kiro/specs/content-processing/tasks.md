# Implementation Plan

- [ ] 1. 基盤: 共用部品の配置とプロジェクト
- [x] 1.1 共有ディレクトリの定義に共用部品を加え、開発コンテナとCI相当環境の配置を揃える
  - 前提: dev-tooling・backend-platform・api-gateway・frontend-platformの全タスクが完了していること(4アプリとfrontend-libの骨格・登録箇所・静的解析の設定がある。roadmapの依存)。無ければ止めて報告する
  - email-deliveryの実装(4:21のcron式`21 12 * * *`とジョブ`email-delivery.cleanup`)はroadmapの依存ではないため、有無を確かめ、無ければ開発者へ報告して作業を続ける(止めない)。cron式が無ければタスク10で加える
  - 下流: media-pipelineは本タスクと1.2・4.1・4.2・6.1、11.3のうち`coding/003`への`server/**`の許可の記述、11.4のうち日次タイムラインのジョブの名前と順序の表の作成の完了を、identity-authはそれに加えて2.1の完了を前提にする(設計の「本specのタスクを前提にする下流spec」)。日次タイムラインの表は、下流specが先に4:21のジョブを足す場合はそのspecが作る
  - 先に、配置定義の単体テストの期待値(アプリの一覧の先頭に共用部品、共有ディレクトリが5つ、共用部品の4つの配置先、検査担当`self`)を書き換え、失敗を確かめる
  - アプリの名前・アプリの一覧・共有ディレクトリの一覧に共用部品を加え、開発コンテナの定義に4つのbind mountと、共用部品の位置だけにマウントするnode_modulesの名前付きボリュームを加え、4つの配置先をGit管理外にする
  - 開発コンテナの再作成(ホストでの`docker compose up -d`)は開発者へ依頼する手作業として報告に残す
  - 完了状態: 配置定義の単体テスト(compose.yamlとの一致・配置先がGit管理外・配置先が利用側アプリの配下)が成功し、`bun run shared-dirs:verify`の表に共用部品の4つの配置先が現れる
  - _Requirements: 1.4_

- [x] 1.2 共用部品のプロジェクトを作り、自己完結の型検査設定と読み込みの境界を単体テストで保証する
  - 先に、型検査設定が基底設定と差分(lib・types・include)以外で一致すること、全ソースのimportとexport-fromが共用部品の外を指さず許可したパッケージ(描画の9パッケージ・zod・テストの`bun:test`)だけであること、許可外の読み込みの標本が検出されることを確かめる単体テストを書き、失敗を確かめてから設定を置く
  - 品質ツール6種・`@types/bun`と、実行時の依存(描画の9パッケージ・zod)を設計の版で完全に固定して導入し、スクリプト契約(静的解析・型検査・単体テスト)を定義する
  - 型検査設定は継承を持たない自己完結の設定とし、DOMの型を含めない
  - 静的解析の設定に、画面・Workers・データベース・エディタ・観測・Node.jsのパッケージの読み込みを禁止する規則を加える
  - 完了状態: ルートの一括検査で共用部品が静的解析・型検査・テスト命名の検査に参加して成功し、2つの単体テストが成功し、ロックファイルの版が設計の表と一致する
  - _Requirements: 1.1, 1.3_

- [ ] 2. 共用部品: 文字数・入力の検証規則・検索語
- [x] 2.1 (P) 書記素の数え方と禁止文字の判定を作る
  - 先に、絵文字の結合の並び・肌色の修飾・国旗・結合文字・CRLFをそれぞれ1文字と数えること、孤立したサロゲート・NUL・DEL・タブと改行以外の制御文字を禁止文字と判定し、タブ・改行・CRを許すことを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、各ファイルの行と関数のカバレッジが80%以上になる
  - _Boundary: Graphemes, TextSafety_
  - _Requirements: 2.8, 7.1, 7.5_

- [x] 2.2 マークダウンの入力の検証規則と文言を作る
  - 先に、上限を超えた場合の「<項目名>は<上限>文字以内で入力してください。」(3桁区切り)、必須で空白だけの場合の「<項目名>を入力してください。」、禁止文字の「<項目名>に使用できない文字が含まれています。」、見出しレベル1・画像・Raw HTMLを含んでも成功すること、値を変換しないことを確かめる単体テストを書く
  - 項目名・書記素の上限・必須か否かから検証規則を作る関数として提供し、上限の引数の不正(0以下・整数でない)を例外にする
  - 完了状態: 単体テストが成功し、同じ検証規則をZodの`safeParse`で使った結果の文言が設計の文言と一致する
  - _Boundary: MarkdownTextSchema_
  - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 2.3 (P) 検索語の正規化・検索式・索引用テキストの正規化を作る
  - 先に、NFKC正規化(全角英数字・半角カナ・全角空白)、空白での分割と空の語の除去、二重引用符の重ねによるエスケープ、各語の前方一致の指定とAND結合、語が無い場合に検索式を作らないこと、演算子・列の指定・記号だけの語が引用符の中に入ること、索引用テキストの空白の畳み込みを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、作った検索式をbun:sqliteのFTS5(unicode61・`remove_diacritics 2`)の`MATCH`に渡しても構文の誤りにならない
  - _Boundary: SearchTerms_
  - _Requirements: 9.4, 12.1, 12.2, 12.3, 12.4, 12.6_

- [x] 2.4 (P) 強調表示の範囲を求める処理を作る
  - 先に、大文字小文字・全角半角・発音区別符号を無視して語の先頭から一致する範囲を返すこと、語の途中(「タスク管理ツール」の「管理」)では一致しないこと、正規化で長さが変わる文字(半角カナの濁音・合字・丸付き数字)を含む文字列で元の位置を指すこと、範囲が書記素の境界にあること、重なりと隣接の併合、語が無い場合の空を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、返した範囲で元の文字列を切り出した部分が、検索語と折りたたみの規則で一致する
  - _Boundary: HighlightRanges_
  - _Requirements: 13.1, 13.2, 13.3, 13.5_

- [ ] 3. 共用部品: 描画パイプライン
- [x] 3.1 描画の指定の検証と、見出しのスラッグとアンカーの正規化を作る
  - 先に、英字の小文字化・数字とハイフンとアンダースコアの維持・空白のハイフン化・記号とCJK文字のUTF-8でのURLエンコード・空の見出しの既定値、`#`のフラグメントのデコードとスラッグ化(デコードできない値はそのまま変換)、接頭辞(既定と本文の識別子)、指定の誤り(オリジンでないURL・許可外や重複した`rel`・形式違反の識別子)の例外を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、「概要 Hello World!」が`%E6%A6%82%E8%A6%81-hello-world%21`になる
  - _Boundary: MarkdownOptions, HeadingSlug_
  - _Requirements: 4.4, 4.5, 4.6, 4.10_

- [x] 3.2 マークダウンの解析と、Raw HTML・見出しレベル1・画像の文字列化を作る
  - 先に、GFMの各記法(表・タスクリスト・取り消し線・脚注・URLの自動リンク)、CJKの句読点に隣接する強調と取り消し線、ブロックとインラインのRaw HTMLの文字列化(ブロックは段落で包む)、見出しレベル1の「# 」付きの段落化、画像(参照形式を含む)の「![代替テキスト](URL)」の文字列化、日本語の脚注の見出しと戻りリンクの名前を確かめる単体テストを書く
  - 変換で触る節点だけの構造的な型を共用部品に置き、hast・mdastの型パッケージを宣言しない
  - 完了状態: 単体テストが成功し、Raw HTMLの`<script>`を含む入力が文字列として表示される
  - _Requirements: 4.1, 4.2, 4.3, 4.11_

- [x] 3.3 見出しのID・許可リストのサニタイズ・接頭辞と`#`の参照の書き換えを作り、共通の処理として組み立てる
  - 先に、見出しレベル2〜6のIDと連番(脚注のIDとの衝突を含む)、本文由来の全てのID(脚注を含む)の接頭辞、本文の識別子による接頭辞、`#`の参照の正規化と接頭辞(脚注の参照・`!`を含むアンカー)、許可リスト外の要素・属性・スキームが残らないこと、同じ入力から同じ木が返ることを確かめる単体テストを書く
  - 処理の順序は設計の「描画の処理の順序」のとおりとし、サニタイズまでを1つの共通の処理にする
  - 見出しのIDは自前の処理で付け、rehype-slugを使わない。同じ変更でtech-stack.mdのマークダウン処理からrehype-slugを外す(仮決定P2)
  - 完了状態: 単体テストが成功し、出力の全てのIDが接頭辞で始まり、tech-stack.mdにrehype-slugが残っていない
  - _Requirements: 4.4, 4.5, 4.6, 4.7, 5.1, 5.3, 16.5_

- [x] 3.4 リンクの方針・表の枠・見出しの一覧と、表示用の描画を作る
  - 先に、同一オリジン・別オリジン・`mailto:`・`#`のリンクのタブと`rel`(表示場所ごとの指定・空の指定)、相対URL・プロトコル相対URL・`javascript:`・`data:`のリンクの解除(文字列は残す)、表の横スクロールの枠(キーボードで移動できる名前付きの領域)、見出しの一覧(階層・最終的なID・文字列、脚注の見出しを除く)、サニタイズ済みの型で返ること、同じ入力と指定で同じHTMLになることを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、描画結果のHTMLに`target="_blank"`が付くのは別オリジンのリンクだけで、許可外の参照の`href`が1つも無い
  - _Boundary: MarkdownRenderer_
  - _Requirements: 1.2, 4.8, 4.9, 4.10, 4.13, 5.2, 5.4, 6.1, 6.2_

- [x] 3.5 (P) 索引用のプレーンテキストの抽出を作る
  - 先に、表示と同じ解釈で構文が除かれること(見出しレベル1・画像・Raw HTMLは表示と同じ文字列)、脚注の見出しと戻りリンクの記号が含まれないこと、表示用の描画の`plainText`と一致することを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、表示用のHTMLを作らずにテキストだけを返す
  - _Depends: 3.3_
  - _Boundary: MarkdownSearchText_
  - _Requirements: 6.3, 6.4_

- [x] 3.6 攻撃パターン集でサニタイズを保証し、描画の性能を計測する
  - スクリプト・イベント属性・`javascript:`とその変形(大文字小文字・空白・制御文字・文字参照・パーセントエンコード)・`data:`・`vbscript:`・プロトコル相対URL・HTMLの入れ子・属性の注入・参照形式のリンク・自動リンク・IDによる上書き(`__proto__`・`main`など)を含む攻撃パターン集をテスト専用のファイルに置く
  - 先に、全件の出力の木に許可リスト外の要素・属性・`on*`属性・`style`・`src`が無く、全ての参照先が許可した形であることを確かめる単体テストを書く
  - 読み込みの境界の単体テストに、サニタイズ済みの型への型の主張が表示用の描画の1箇所だけであることの検査を加える
  - 20,000文字の代表的な文書の描画が300ms以内であることを計測する単体テストを書く
  - 完了状態: 攻撃パターン集の全件と性能の単体テストが成功し、共用部品の全ファイルの行と関数のカバレッジが80%以上になる
  - _Requirements: 1.2, 5.4, 5.6_

- [ ] 4. 利用側アプリへの組み込み
- [x] 4.1 (P) APIサーバーとイベントサーバーに共用部品を組み込む
  - 描画の9パッケージを共用部品と同じ版で完全に固定して宣言する(zodは既存)
  - 型検査の対象に配置先の実行時のファイルを含め、テスト・設定・攻撃パターン集を除く。静的解析・単体テスト・Workers統合テストの対象から配置先を除く(検査担当でないアプリの規約)
  - 完了状態: 両アプリの型検査・静的解析・単体テスト・Workers統合テストが成功し、型検査の読み込み一覧に配置先の描画と検索語のファイルが含まれ、テストの対象に含まれない
  - _Boundary: ConsumerAppIntegration_
  - _Requirements: 1.5_

- [x] 4.2 (P) 利用者側・管理者側とfrontend-libに共用部品・エディタ・文字組みのパッケージを組み込む
  - client・adminに描画の9パッケージ、client・admin・frontend-libに`@milkdown/crepe`・`@milkdown/kit`・`@milkdown/react`の7.22.3と`@tailwindcss/typography` 0.5.20、frontend-libにremark-cjk-friendlyの2つを、設計の版で完全に固定して導入する。zodなど上流と共有するパッケージは、上流の現在の版に合わせる
  - client・adminの型検査・静的解析・単体テスト・ブラウザテストの対象をAPIサーバーと同じ規約で設定する
  - frontend-libのブラウザテストとStorybookの開発サーバーが共用部品の配置元を読み込めるようにし、client・admin・frontend-libのVite設定でVueの機能フラグを無効に定義する
  - client・admin・frontend-libのブラウザテストの事前バンドルの一覧(`PREBUNDLED_DEPENDENCIES`)に、描画の9パッケージ・`@milkdown/*`の3つ・`vue`を加える(テストの実行中の事前バンドルのやり直しによるページの再読み込みを防ぐ)
  - frontend-libの部品から兄弟の相対パスで共用部品を読み込む検査用の小さな単体テストを置き、frontend-libの位置とclientへ配置した後の両方で解決できることを確かめる
  - 新規採用の`@tailwindcss/typography`と、明示して宣言する`@milkdown/kit`(仮決定P3)を、導入と同じ変更でtech-stack.mdへ記載する
  - 完了状態: client・admin・frontend-libの型検査・静的解析・テストとclient・adminのビルドが成功し、tech-stack.mdに2つのパッケージが載っている
  - _Boundary: ConsumerAppIntegration_
  - _Requirements: 1.5, 1.6, 16.5_

- [x] 4.3 (P) 利用者側のオリジンの変数を両フロントエンドに加える
  - 先に、環境の検証が利用者側のオリジンの欠落と不正(パスを含むURL・http・https以外)をキー名で報告し、ブラウザへ渡す設定に含めること、両アプリの3環境の設定値が設計の表と一致することを確かめる単体テストを書く
  - frontend-platformの環境の検証とブラウザへ渡す設定に利用者側のオリジンを加え、client・adminの3環境の変数に同じ値を書く
  - 値は、identity-authがAPIサーバーに置く同名の変数とinfra-deliveryの一覧の値と同じにする
  - 完了状態: 単体テストとfrontend-platformの環境の検証・設定の単体テストが成功し、ローカルで起動した管理者側のページの初期データに利用者側のオリジンが含まれる
  - _Boundary: SiteOriginConfig_
  - _Requirements: 4.8, 4.9_

- [ ] 5. 共通部品: 表示
- [x] 5.1 本文の文字組みと表示部品を作り、生のHTMLの挿入を1箇所に限る
  - 先に、モックアップの文字組み(見出し・リンク・コード・コードブロック・引用・表、引用符を付けない)とライト・ダーク、大きさの指定、表の枠へのキーボードでの移動、同じ入力と指定でメモ化された描画が再計算されないこと、サイトのオリジンをルーターの文脈から補うこと、アクセシビリティの自動検査の違反0件を確かめるブラウザテストを書く
  - 先に、生のHTMLの規則の無効化とサニタイズ済みの型への型の主張の位置を走査する関数と、frontend-libでは表示部品の1箇所だけ、client・adminでは0箇所であることを確かめる単体テストを書く
  - `@tailwindcss/typography`の取り込みと本文の補助のスタイル(表の枠・脚注の見出し・タスクリスト)を基本のスタイルから読み込み、表示部品の1行だけで理由のコメント付きで規則を無効化する
  - コンポーネントカタログに、長い本文・表・脚注・リンク・ダークの各表示を加える
  - 完了状態: ブラウザテストと3つのアプリの走査の単体テストが成功し、カタログで表示とアクセシビリティの検査を確かめられる
  - _Depends: 3.4, 4.2, 4.3_
  - _Requirements: 3.6, 4.12, 4.13, 4.15, 5.5_

- [x] 5.2 折りたたみ付きの表示部品を作る
  - 先に、指定の高さを超える本文が初めから折りたたまれ、測定後にあふれる場合だけ「続きを読む」と下端のぼかしを表示し、押すと「折りたたむ」に変わって展開の状態を支援技術へ伝えること、あふれない本文にはボタンが出ないこと、違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、カタログで240pxと480pxの折りたたみを確かめられる
  - _Boundary: CollapsibleMarkdownContent_
  - _Requirements: 3.6, 4.14_

- [x] 5.3 (P) 強調表示部品を作る
  - 先に、一致した範囲だけが`<mark>`で囲まれ、それ以外がそのまま表示されること、ライト・ダークでの違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、カタログで全角・半角と発音区別符号の違う検索語の強調を確かめられる
  - _Depends: 2.4, 4.2_
  - _Boundary: HighlightedText_
  - _Requirements: 13.4_

- [ ] 6. 共通部品: マークダウンの入力欄
- [x] 6.1 エディタの読み込みを遅延読み込みのモジュールに限る静的解析の規則を加える
  - 先に、遅延読み込みのディレクトリの外での`@milkdown/*`・`vue`の読み込み、そのディレクトリの静的なimportとexport-from(バレル)、読み込み関数以外からのそのディレクトリの`import()`、frontend-libの`components/**`・`server/**`からの共用部品の検証規則の読み込みが報告され、`components/**`・`server/**`・`utilities/**`からの共用部品のその他のモジュールの読み込みは報告されず、既存の依存の方向の違反も引き続き報告されることを、ESLintのNode APIで確かめる単体テストを書く
  - frontend-platformの依存の方向の規則と同じ設定に統合し、後の設定による選択肢の置き換えで既存の規則を失わないようにする
  - 完了状態: 違反例の単体テストとfrontend-platformの規則の単体テストが成功し、client・adminにも同じ規則が適用される
  - _Depends: 4.2_
  - _Boundary: MarkdownLintRules_
  - _Requirements: 2.13, 5.5_

- [x] 6.2 遅延読み込みの編集領域を組み立て、制御器・CJKの強調・テーマ・支援技術への属性を提供する
  - 先に、初期値の表示、制御器による書式の操作とリンクの設定・解除・マークダウンの読み取りと置き換え、変更の通知、`**太字。**の`が強調になり往復で保たれること、読み取り専用、編集領域の役割・ラベル・説明・不正な状態の属性と、その更新を確かめるブラウザテストを書く
  - Crepeのbuilderで設計の機能だけ(リスト・プレースホルダー・カーソル・日本語のラベルを付けた選択時のツールバー)を組み込み、選択時のツールバーのリンクの操作をリンクのダイアログの要求に置き換える(仮決定P1)
  - Crepeの使う機能のCSSだけを取り込み、色とフォントの変数をデザイントークンとOSのフォントに対応付ける
  - 完了状態: ブラウザテストが成功し、編集領域の違反0件を確かめられ、遅延読み込みのディレクトリだけが`@milkdown/*`を読み込んでいる
  - _Boundary: CrepeEditorSurface_
  - _Requirements: 2.5, 2.10, 2.14, 2.15, 3.2_

- [x] 6.3 編集領域で見出しレベル1・画像・ファイルを挿入させず、Tabキーで抜けられるようにする
  - 先に、行頭の`# `の入力が見出しにならず「# 」付きの段落のままであること、`## `〜`###### `は見出しになること、見出しレベル1のショートカットが効かないこと、見出しレベル1や画像を含むマークダウン・HTMLの貼り付けと既存の値の読み込みが文字列になること、画像の記法の入力が画像にならないこと、ファイルの貼り付けとドロップで何も挿入されないこと、Tabキー・Shift+Tabキーで前後の要素へ移ること(リストと表の中を含む)、リストの階層の変更が`Mod-]`・`Mod-[`で動くことを確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、どの経路でも保存されるマークダウンに見出しレベル1と画像の構文が現れない(文字列としてエスケープされる)
  - _Boundary: CrepeEditorSurface_
  - _Requirements: 2.2, 2.3, 2.4, 3.3_

- [x] 6.4 固定ツールバーとリンクのダイアログを作る
  - 先に、10個の操作(見出し・太字・斜体・リンク・箇条書き・番号付きリスト・引用・コード・コードブロック・表)に日本語の名前があり、矢印キーで項目を移りTabキーで抜け、Enter・Spaceキーで動き、選択中の書式を押下状態で示すこと、制御器が無い間とプレビューの間は操作できないこと、リンクのダイアログでの設定・解除・取り消し・形式違反の表示と、閉じた後のフォーカスの戻りを確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、ツールバーとダイアログの違反0件を確かめられる
  - _Boundary: MarkdownToolbar, MarkdownLinkDialog_
  - _Requirements: 2.1, 3.1, 3.4_

- [x] 6.5 入力欄の外枠で、遅延読み込み・仮表示・読み込み失敗・カウンター・プレビュー・値の受け渡しを結合する
  - 先に、読み込み前の仮表示(現在の値の描画・読み込み中の通知・操作できないツールバー)と読み込み後の切り替え、読み込み失敗の表示と再試行での新しい読み込み、カウンターの「1,234 / 2,000」の表示と超過時の注意色、超過と戻りの時だけの読み上げ、フォーカスアウトでの最新の値の受け渡しと間引いた変更の受け渡し、外部からの値の置き換え、無効、プレビューの表示(表示場所と同じHTML・空の文言)、「書く」「プレビュー」の両方での違反0件を確かめるブラウザテストを書く
  - 先に、frontend-platformの`FormField`のブラウザテストに`Label`の`id`と子へ渡る`labelId`の一致を、`preload-recovery.ts`の単体テストに既定の動作が止められた`vite:preloadError`では再読み込みせず印も書かないこと(止められていなければ従来どおり1回だけ再読み込みすること)を加えて失敗を確かめ、`FormField`の`labelId`と`preload-recovery.ts`の`defaultPrevented`の判定を加える。カタログの文書(`frontend/005`)の`FormField`の行に`labelId`を加える
  - 入力欄のブラウザテストに、`labelId`による編集領域の名前、`FormField`が渡す`ref`の`focus`で読み込み後は編集領域へ、読み込み前は保留して読み込み後にフォーカスが移ること、編集領域の読み込みの失敗で`vite:preloadError`の既定の動作が止められページが再読み込みされないことを含める
  - React Hook Formの`Controller`と`FormField`に結合する使い方の例(`FormField`は`AppForm`の中に置き、子の関数が受け取る`labelId`・`ref`を渡す)をカタログに置く
  - 完了状態: ブラウザテストとfrontend-platformの`FormField`・`preload-recovery.ts`のテストが成功し、カタログで読み込み中・読み込み失敗・上限超過・プレビューの各状態を確かめられる
  - _Depends: 5.1, 6.2, 6.3, 6.4_
  - _Requirements: 2.6, 2.7, 2.8, 2.9, 2.11, 2.12, 2.13, 2.14, 3.5, 3.6_

- [x] 6.6 編集領域がページの最初の読み込みとサーバー側の描画に含まれないことを検査するスクリプトを作る
  - 入力欄を静的に読み込む検査用の入口を、ViteのAPIでクライアント用とSSR用にビルドし、マニフェストの静的な読み込みをたどった範囲にMilkdown・Vue・ProseMirrorのモジュールが無く、動的な読み込みの先にあることを確かめて終了コードで示す
  - 先に、検査の判定(静的・動的の読み込みの集合の比較)を純粋な関数として切り出し、違反を含むマニフェストの標本で失敗することを確かめる単体テストを書く
  - 完了状態: frontend-libで`bun run check:editor-chunks`が成功し、入口で編集領域を静的にimportするよう書き換えると失敗する
  - _Boundary: EditorBundleCheck_
  - _Requirements: 2.13_

- [ ] 7. 全文検索: データ層の部品
- [x] 7.1 索引文書の共通の列と状態の値を定義する
  - 先に、共通の列の型・NOT NULL・既定値・一意制約・明示した列名、元テキストの列、状態と日時の索引の定義を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、検証用のテーブルの定義からdrizzle-kitが生成するSQLで、主キーが`INTEGER PRIMARY KEY`になる
  - _Boundary: SearchDocumentColumns_
  - _Requirements: 8.2_

- [x] 7.2 索引の定義の検証と、全文検索の索引・トリガー・再構築のSQLのひな形を作る
  - 先に、bun:sqliteで、生成したSQLの索引が追加・更新・削除で同期し`integrity-check`に通ること、状態の列だけの更新では全文検索の索引を書き換えないこと、前方一致と`prefix`、列ごとの重みの並び順、発音区別符号と大文字小文字の無視、トリガーの作り直しと`rebuild`、定義の検証(名前・共通の列・列の所属と重複・重み・`prefix`)の例外を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、テーブルを作り直した後にトリガーを作り直して`rebuild`すると検索結果が元に戻る
  - _Boundary: SearchIndexDefinition, SearchIndexSql_
  - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 12.6_

- [x] 7.3 検索のSQL断片と、索引の定義の集約点・SQLの出力・マイグレーションとの突き合わせを作る
  - 先に、bun:sqliteで、関連度の付いた元データの識別子の副問い合わせが検索式をバインド変数で受けて重みどおりに並ぶこと、マイグレーションの文字列から欠けた索引とトリガーの作成文を返す判定、集約点の全定義が欠けていないことを確かめる単体テストを書く
  - 集約点の定義からカスタムマイグレーションに貼るSQL(索引・トリガーの作り直し・再構築)を出力するスクリプトと、その実行の手順をデータ層のスクリプトに加える
  - 完了状態: 単体テストが成功し(初版の集約点は0件)、検証用の定義を一時的に登録するとスクリプトが設計のSQLを出力する
  - _Boundary: FtsQuery, SearchIndexAggregation_
  - _Requirements: 8.4, 8.6, 12.5_

- [ ] 8. 全文検索: 共有の部品
- [x] 8.1 検索の型・ポート・DIの識別子と、索引の更新のメッセージ契約を作る
  - 先に、検索対象の名前の形式、メッセージの本文の検証(名前の形式・識別子の長さ)、再試行の方針が5回・30秒から倍であること、メッセージ契約の集約点に種別の重複が無いことを確かめる単体テストを書く
  - メッセージ契約の集約点へ索引の更新の契約を加える
  - 完了状態: 単体テストとbackend-platformのメッセージ契約の単体テストが成功する
  - _Boundary: SearchContracts, SearchIndexRefreshContract_
  - _Requirements: 9.1, 10.1, 14.1, 14.2_

- [x] 8.2 (P) 索引文書の組み立てを作る
  - 先に、プレーンテキストとマークダウンの項目の正規化、元テキストの列の項目だけが列に入ること、抽出の対象の項目だけを宣言順に結合すること、上限を超える入力の書記素の境界での切り詰め、同じ入力と選別の規則の版で同じハッシュになることを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、抽出の入力に抽出の対象でない項目の文字列が含まれない
  - _Depends: 2.3, 3.5_
  - _Boundary: IndexDocumentBuilder_
  - _Requirements: 9.4, 9.6, 15.3_

- [x] 8.3 (P) 自然言語APIの要求の組み立て・応答の分類・キーワードの選別を作る
  - 先に、要求の本文、200の応答(対応言語・`languageSupported: false`・形の合わない応答)、言語を理由とする400・その他の400・401・403・404・429・500の分類、除外する種類のエンティティの除去、名前の正規化と重複の除去、出現順と500件の上限、半角スペースでの結合を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、全ての状態コードの分類が設計の表と一致する
  - _Boundary: NaturalLanguageProtocol, KeywordSelection_
  - _Requirements: 9.5, 10.1, 10.4, 10.5_

- [x] 8.4 (P) 更新の計画と、抽出結果からの書き込みと再試行の判定を作る
  - 先に、計画の全分岐(古い版・空の入力・同じハッシュの抽出済みと非対応言語・抽出)と、判定の表の全行(抽出済み・非対応言語・無効・一時的な失敗の上限未満と上限・設定の誤り)で、キーワードの列・状態・ハッシュ・再試行・通知が設計どおりになり、元テキストの列が常に最新になることを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、各ファイルの行と関数のカバレッジが80%以上になる
  - _Boundary: RefreshDecision_
  - _Requirements: 9.6, 9.7, 10.2, 10.3, 10.4, 10.5, 10.8_

- [x] 8.5 検索対象の定義と登録の検証、集約点を作る
  - 先に、名前の形式と重複、元テキストの列の項目と索引の定義の列の不一致、抽出の対象の項目が無いこと、テーブル名の不一致を例外にすること、集約点の全定義が例外にならないこと、データ層と共有の部品の状態の値が同じであることの型の保証を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、初版の集約点(0件)で登録が成功する
  - _Depends: 7.2, 8.1_
  - _Boundary: SearchTargetRegistry_
  - _Requirements: 14.1, 14.4, 14.5_

- [x] 8.6 索引の保存を作り、D1上で条件付きの書き込みと検索のSQL断片を確かめる
  - Workers統合テスト専用の検索対象(元データのテーブル・索引文書のテーブル・全文検索の索引を生成したSQLで作る)を用意する
  - 先に、D1上で、新規の書き込み、新しい版の更新、古い版・削除済み・対象外の元データの書き込みが無視されること、前回のキーワードを保つ更新、削除と全文検索の索引の連動、再抽出の候補(縮退と1時間以上の更新待ち、上限件数)、検索のSQL断片の結果と並び順を確かめるWorkers統合テストを書く
  - 完了状態: Workers統合テストが成功し、D1のFTS5で`prefix`と列の重みが使えることを確かめた記録が残る(使えなければ設計どおり`prefix`を外す)
  - _Depends: 7.3, 8.5_
  - _Boundary: SearchIndexRepository_
  - _Requirements: 9.2, 9.3, 9.7, 9.8, 10.6, 11.3, 12.5, 16.2_

- [x] 8.7 ドメイン向けの文・更新の要求・元データの読み取り・共通の束縛を作る
  - 先に、更新待ちの印が新規の行と既存の行で設計どおりになること、91件以上の削除が分割されて同じ一括の書き込みで成功すること、更新の要求がQueueへ送られること、未登録の検索対象が呼び出し側の誤りになること、送信の失敗が例外にならずログとSentryへ送られること、元データの読み取りが定義へ委ねられること、共通の束縛から各部品を解決できることを確かめるWorkers統合テストを書く
  - 完了状態: Workers統合テストが成功し、ドメインが自身の書き込みと同じ一括の書き込みに印と削除の文を含められる
  - _Boundary: SearchIndexStatements, SearchIndexRefreshRequester, SearchSourceProvider, SearchPlatformModule_
  - _Requirements: 9.1, 9.10, 10.7, 11.1, 11.2, 14.2_

- [ ] 9. イベントサーバー: 索引の更新
- [x] 9.1 キーワード抽出の実装と、環境の変数・シークレットを加える
  - 先に、`fetch`の代わりを`vi.fn`で注入して(`cloudflare:test`の`fetchMock`は使わない)、外部APIへの要求の形(キーのヘッダー・本文)、200・言語の400・その他の400・401・429・500・時間切れ(10秒)・通信の失敗の分類、キーがログと例外に含まれないこと、無効の実装、環境の値による実装の選択、抽出を有効にした環境でのキーの欠落を環境の検証が報告することを確かめるWorkers統合テストと単体テストを書く
  - 3環境の変数、staging・prodの必須のシークレット、テスト用の値を設計の表どおりに加え、実行時の環境の型を生成し直す
  - 同じ変更で、本プロジェクト固有の値のWorkerのシークレットのキーの一覧の節(キーの一覧の正。infra-deliveryのタスク8.5が作る)へ`GOOGLE_NL_API_KEY`の行(フォルダは`/`。eventだけが使う他のキーと同じく`WORKER_SCOPED_SECRETS`へは加えず、必須のため`OPTIONAL_WORKER_SECRETS`へも加えない。環境・フォルダ・使うWorker・宣言したspec・必須・登録の時期)を加える。既に行があれば食い違いを確かめるだけにする。節が無ければ作らず、infra-deliveryが節を作る時にmainのWrangler設定から載せる
  - stagingのシークレットの値は、この変更をmainへマージする前に開発者がInfisicalの`staging`へ登録する(未登録のままマージすると以後のstagingのデプロイが止まる)。この順序を開発者への依頼として報告に残す。prodの値の登録はlaunch-readinessへ引き継ぐ
  - 完了状態: テストとbackend-platformの設定の単体テスト・型生成の検査が成功し、ローカルではシークレット無しでイベントサーバーが起動する
  - _Depends: 8.3_
  - _Boundary: KeywordExtractors, EventSearchComposition_
  - _Requirements: 9.5, 10.1, 10.4, 10.5, 10.8, 15.2, 15.4_

- [x] 9.2 索引の更新の処理を作る
  - 先に、偽のポートで、未登録の検索対象(記録して完了)、元データの削除・対象外(削除して完了)、古い版(書かずに完了)、空の入力、前回のキーワードの再利用、抽出の成功、一時的な失敗の上限未満(書いてから再試行の例外)と上限(縮退して完了)、非対応言語、設定の誤り(通知)、条件で書かれなかった場合、同じ本文の重複の処理で同じ書き込みになること、ログの項目に本文とキーワードが無いこと、未登録の検索対象と設定の誤りが通知のポートへ種類と検索対象(と状態コード)だけで渡ることを確かめる単体テストを書く
  - 通知のポートのSentryの実装を作る。先に、`captureMessage`ではなく`captureEvent`で、`logentry`の定型の文言・種類ごとの`fingerprint`・タグを送り、本文とキーワードを含まないことを確かめるWorkers統合テストを書く(email-deliveryの`SentryEmailIncidentReporter`と同じ置き方)
  - 完了状態: 単体テストと通知の実装のWorkers統合テストが成功し、全ての結果でログの結果の値が設計の一覧のいずれかになる
  - _Depends: 8.2, 8.4_
  - _Boundary: SearchIndexRefreshHandler, SearchIncidentReporter_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.1, 10.2, 10.3, 10.4, 10.5, 11.3, 14.3, 15.1_

- [x] 9.3 イベントサーバーに索引の更新を登録し、Queueからの結合を確かめる
  - 共通の束縛とイベントサーバーの検索のモジュール(抽出の実装へは束縛の時に大域の`fetch`を渡す、通知のポートのSentryの実装)、メッセージの処理と再試行の方針を登録箇所へ加える
  - 先に、テスト専用の検索対象と、`vi.spyOn(globalThis, 'fetch')`で差し替えた外部APIの偽の応答で、Queueへ送った索引の更新が索引文書と全文検索の索引を作ること、一時的な失敗が再試行されて上限で縮退索引になること、非対応言語が再試行されないことを確かめるWorkers統合テストを書く
  - 完了状態: Workers統合テストが成功し、検索のSQL断片で作られた索引文書が見つかる
  - _Depends: 9.1, 9.2_
  - _Requirements: 9.1, 9.9, 10.1, 10.3, 10.4_

- [x] 9.4 (P) 実際の外部APIへの疎通を確かめるスクリプトを作る
  - キーが注入されていなければ登録の手順を案内して終了コード2で終え、あれば日本語と英語の短文で抽出の結果・言語・キーワードの数を表示する
  - 先に、キーの有無による分岐と表示の内容を、外部APIの呼び出しを差し替えて確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、キーを注入しない実行で案内が表示される
  - _Depends: 9.1_
  - _Boundary: KeywordExtractionSmoke_
  - _Requirements: 15.5_

- [x] 10. APIサーバーに日次の再抽出のジョブを登録する
  - 先に、偽のポートで、全ての検索対象について縮退と1時間以上の更新待ちの識別子を上限200件で取得して更新を要求すること、1件の要求の失敗で残りを止めないこと、検索対象ごとの件数をログに出すことを確かめる単体テストを書く
  - 共通の束縛とAPIサーバーの検索のモジュールを登録し、ジョブを名前`content-processing.keyword-reextraction`・業務時刻4:21・順序950で登録する。cron式`21 12 * * *`は、APIサーバーの3環境の`triggers.crons`に既にあれば変更せず、無ければ加える(email-deliveryの実装の有無によらない)
  - 完了状態: 単体テストとbackend-platformのcron式の一致の検査が成功し、ローカルで4:21の定期実行を手動で起こすと検索対象ごとの件数がログに出る
  - _Depends: 8.6, 8.7_
  - _Requirements: 9.10, 10.6, 15.6_

- [ ] 11. 技術ドキュメントと関連文書
- [x] 11.1 (P) 外部の自然言語APIと全文検索の技術ドキュメントを書く
  - 文書は`external/002-natural-language-keyword-extraction.md`と`db/004-full-text-search.md`とする(roadmapの順で割り当てた固定の番号)
  - 外部APIの文書に、エンティティ分析の要求と応答、キーの渡し方とAPIの制限、料金と上限、失敗の分類と再試行・縮退、対応言語、送る情報の範囲、手元の疎通確認の手順を書く
  - 全文検索の文書に、索引文書のテーブルと全文検索の索引の構成、ひな形と集約点とSQLの出力の使い方、検索式と関連度の組み込み、条件付きの書き込み、更新待ちの印と削除の一括の書き込み、列を変えた後のトリガーの作り直しと再構築、Time Travelでのバックアップ、マークダウンの原文を保存してHTMLを保存しない規約を書く
  - 各索引に1行ずつ加える
  - シークレットのキーと変数の名前は列挙せず、プレースホルダーと本プロジェクト固有の値へのリンクにする(キーの一覧の正は本プロジェクト固有の値)
  - 完了状態: 2つの文書にプロジェクト名・固有の値(キーと変数の名前を含む)が無く、記載した値(再試行・打ち切り・件数・状態の値)が実装の定数と一致する
  - _Boundary: TechDocs_
  - _Requirements: 7.7, 8.7, 16.3, 16.4_

- [x] 11.2 (P) 入力欄・表示部品とサニタイズの技術ドキュメントを書く
  - 文書は`frontend/008-markdown-editor-and-content.md`と`security/004-markdown-sanitization.md`とし、各索引に1行ずつ加える(roadmapの順で割り当てた固定の番号)
  - 入力欄と表示部品の文書に、フォームとの結合と検証規則、遅延読み込みと読み込みの制限、表示部品と折りたたみ、目次の作り方、カウンターと保存される原文の関係、アクセシビリティの規約、強調表示部品を書く
  - サニタイズの文書に、許可リスト、参照先の制限、処理の順序とサニタイズの後の変換の限定、接頭辞とDOM clobbering、生のHTMLの例外の1箇所と検査、攻撃パターン集の追加の手順を書き、frontend-platformのフロントエンドサーバーのセキュリティの文書(`frontend/003`)の例外の記述から`security/004`へリンクする
  - 完了状態: 2つの文書にプロジェクト名・固有の値が無く、記載した許可リストと例外の箇所が実装と一致する
  - _Boundary: TechDocs_
  - _Requirements: 16.3, 16.4_

- [x] 11.3 (P) 共有ディレクトリ・依存の版・CLAUDE.md・オンボーディング・本プロジェクト固有の値を更新する
  - 共有ディレクトリの文書に、共用部品と、別の共有ディレクトリを兄弟の相対パスで参照する規則(配置先の名前・検査担当`self`の位置での解決・開発サーバーの配信の許可・2つの実体になり得るモジュールを読み込まない・frontend-libの`components/**`・`server/**`・`utilities/**`から読み込めること)を書く。`server/**`の許可の記述は下流specの前提に含まれる(設計の「本specのタスクを前提にする下流spec」)
  - 依存の版の一覧に、共用部品と4アプリでそろえるパッケージと、frontend-lib・client・adminでそろえるパッケージを加える
  - CLAUDE.mdのディレクトリ構成に共用部品と各アプリの配置先を、「技術規則の参照先」に4つの技術ドキュメント(`external/002`・`db/004`・`frontend/008`・`security/004`)へのリンクを作業の種類とともに加える
  - オンボーディングに、共用部品の依存の導入、開発コンテナの再作成、ローカルでキーワード抽出が無効であること、疎通確認のスクリプト、Infisicalの`staging`へのキーの登録(開発者の作業。キーを必須にする変更のマージ前)とprodの登録をlaunch-readinessが行うことを書き、本プロジェクト固有の値に変数・接頭辞・定期実行のジョブの名前と時刻と件数を書く(シークレットのキーの行は9.1で加える)
  - 完了状態: 各文書の記載が設計の値と一致し、リンク切れが無い
  - _Boundary: DeveloperDocs_
  - _Requirements: 1.4, 16.5, 16.6_

- [ ] 11.4 (P) サービス仕様を更新する
  - 日次タイムラインの「日次バッチ(4:21)の内容」に、ジョブの名前と順序の表が無ければ作り(上流のemail-deliveryの`email-delivery.cleanup`・900を含める)、既に下流specが作っていれば行だけを加える。検索のキーワードの再抽出(`content-processing.keyword-reextraction`・950)の行を順序どおりに加える(仮決定P6)。表の作成は下流specの前提に含まれる(設計の「本specのタスクを前提にする下流spec」)
  - 文言規則に、マークダウンの入力の検証の文言(必須・禁止文字)、リンクのURLの形式違反、エディタの読み込み失敗、プレビューの空、文字数の超過と戻りの読み上げの文言を加える
  - ページ構成のコメントの投稿欄に、書く側が書式を適用した見た目で編集すること、ツールバーに表を含めることを加え、準拠方針のデータ保持期間の一覧に検索索引の行を加える
  - プライバシーポリシーの大枠の「国外移転の記載事項」に、委託先Google Cloud(Natural Language API)の項を、Cloudflare・AWSの項と同じ「移転先・移転の根拠・委託先が講じる措置」の形で加える。移転先には送る情報(抽出の対象の項目の公開用のテキストだけ)と処理する場所(処理のリージョンを指定しないため保証されない)を、根拠にはDPFを主としDPFが無効になった場合はGoogle CloudのDPAに含まれるSCCに拠ることを、措置には共通の記述への参照・Google側で保存も学習への利用もされないこと・APIの制限を掛けた専用のキーを書く。共通の「移転先の国」の行は、Google Cloudの記述だけをこの項への参照に改める
  - 準拠方針の「データの保存場所」に、委託先Google Cloudの項(一時送信で保存されないこと、処理する場所は保証されないこと、根拠はプライバシーポリシーの大枠を正とすること)を加える
  - 他の委託先の項と全委託先に共通の記載は書き換えない。法務文書の本文は開発者が用意するため、骨子の記載事項に留める
  - 完了状態: 各文書の文言が実装の定数と一致し、リンク切れが無い。国外移転の記載事項にGoogle Cloudの項があり、送る情報と処理する場所が実装(抽出の対象の項目・外部APIの接続先)と一致し、本specの変更がGoogle Cloud以外の委託先の項を変えていない
  - _Boundary: ServiceDocs_
  - _Requirements: 16.7, 16.9_

- [ ] 11.5 (P) 定期実行の技術ドキュメントにジョブとメッセージ種別の名前の規約を追記する
  - 対象は、backend-platformが作る`infra/003-async-processing.md`(定期実行の業務時刻での登録とcron式との一致を説明する文書)とする
  - 定期実行の説明に、ジョブとイベントの波及処理の名前を`<spec名>.<名詞句>`、メッセージ種別を`<ドメイン>.<動詞句>`とする規約を追記する。メッセージ種別の規約が既に書かれていれば重複して書かず、ジョブの規約をその隣に置く
  - 規約はプレースホルダーだけで書き、本プロジェクトのジョブの名前・時刻・順序を列挙しない(正は日次タイムラインと本プロジェクト固有の値)
  - 完了状態: `infra/003`に名前の規約があってプロジェクト名・固有の値が無く、本specの再抽出のジョブ`content-processing.keyword-reextraction`とメッセージ`search-index.refresh`が規約に合っている
  - _Boundary: TechDocs_
  - _Requirements: 16.8_

- [ ] 12. 一括検査・カバレッジ・遅延読み込みの分離を確かめ、開発者の手作業を引き継ぐ
  - ルートの一括検査と単体・ブラウザ・Workers統合テストの一括実行を行い、共用部品・frontend-lib・api・event・client・adminで追加したファイルの行と関数のカバレッジ80%以上と、`check:editor-chunks`の成功を確かめる
  - 開発者の手作業(開発コンテナの再作成、Google CloudのNatural Language APIの有効化とAPIの制限を掛けたキーの発行、Infisicalの`staging`へのキーの登録(9.1の変更をmainへマージする前)、実際のキーでの疎通確認のスクリプトの実行、infra-deliveryのInfisicalの表に`GOOGLE_NL_API_KEY`が載っていることの確認)を、実行するコマンドや画面の操作とともに報告にまとめる
  - タスク1.1でemail-deliveryの実装が無かった場合は、その旨とタスク10で加えたcron式を報告に含める
  - Infisicalの`prod`へのキーの登録を、launch-readinessへの引き継ぎ事項として報告にまとめる
  - 完了状態: 一括検査と一括テストが成功してカバレッジが閾値を満たし、手作業の一覧とlaunch-readinessへの引き継ぎ事項が報告に含まれている
  - _Requirements: 1.2, 2.13, 16.1, 16.2_

## Implementation Notes

- 1.1: このコンテナにはcommon-libの4つの配置先のbind mountが無いため、利用側アプリで確かめる前に`bun run shared-dirs:place`でコピー配置する(開発コンテナの再作成は開発者の手作業。Dockerfileも変えたため`docker compose up -d --build`)
- 1.1: common-libを配置先に加えたことで、ルートの`check-test-names.unit.test.ts`の2件が4.1・4.2まで失敗する。4.1ではapiに`bunfig.unit.toml`を新設して`test:unit`をそちらへ切り替え、4アプリの`test:unit`と`bunfig.unit.toml`のカバレッジの除外に`common-lib/**`を加える(設計のModified Filesに無い)
- 1.2: 配置先(コピーまたはbind mount)がある状態では、利用側4アプリの静的解析が配置先の`common-lib/eslint.config.ts`を読んで失敗する。4.1・4.2で4アプリの`eslint.config.ts`の`ignores`に`common-lib/`を加えるまでルートの`bun run check`は赤い
- 1.2: common-libの読み込みの境界の単体テストは`Bun.Transpiler.scanImports`で走査し、型だけの読み込みは修飾子を外してから走査する。静的解析は`consistent-type-imports`で型の位置の`import()`を禁止する
- 2.3: FTS5の検索式を確かめるため、common-libの単体テストだけ`bun:sqlite`も読み込めるようにした(設計の190・623・624行は`bun:test`だけと書いており相違)。空白の判定は`\p{White_Space}`で行い(`\s`・`trim`はU+FEFFを含み、NELを含まない)、強調表示(2.4)の語の区切りもこれにそろえる
- 2.4: 強調表示はFTS5(unicode61・`remove_diacritics 2`)の実際の照合に合わせた。設計のHighlightRangesと異なり、折りたたみはNFKC→小文字化→NFD→ラテン文字の後のU+0300〜U+036Fの除去→NFC→残りのU+0300〜U+036Fの除去(濁点・半濁点・ギリシャ文字とキリル文字の符号・異体字セレクタは区別する)、語の区切りは折りたたんだ後の文字の単位で`\p{L}`・`\p{N}`・`\p{Co}`を語の文字とし、記号を含む検索語は語の並びとして最後の語だけ前方一致にする。unicode61はUnicode 6.1の表を使うため6.1より後の絵文字(🦄・🤣など)を語の文字とし、「🦄Unicorn」が`unicorn`で見つからない既知の制限がある(索引と検索語の正規化で絵文字を区切りにするかは開発者の判断)
- 3.1: 前後の空白の除去は`text/white-space.ts`の`trimWhiteSpace`を使う(`/^\p{White_Space}+|\p{White_Space}+$/`は途中の長い空白で処理時間が2乗になる。設計のFile Structure Planに無いファイル)。後読みや末尾に固定した量指定子の正規表現、`reduce`での配列の作り直しは利用者の入力の長さで2乗になるため避け、20,000文字の回帰テストを置く。`normalizeAnchorFragment`は`#`を除いたフラグメントを受け取り、空なら`heading`を返す(`[x](#)`を書き換えるかは3.3で決める)
- 3.2: `markdown-processor.ts`は未サニタイズの木を返す`markdownToHast`を暫定でexportしている。3.3でサニタイズまでを`processMarkdown(markdown, idPrefix)`にまとめ、`markdownToHast`をモジュールの外へ出さない(テストも`processMarkdown`経由にする)。参照画像は設計の`![alt][識別子]`ではなく入力の形(`![alt][label]`・`![alt][]`・`![alt]`)で文字列化する。CJKのプラグインは`/parseOnly`の入口を使う(エディタでマークダウンへ書き戻す側は`/bidi`)。引用の20,000段の入れ子はremark-rehypeがスタックあふれで失敗するため、3.4・3.5で例外の扱いを確かめる。`[`を20,000個入れ子にしたリンクは解析に約6.6秒かかるため、3.6の性能の計測で攻撃的な入力の扱いも確かめる
- 3.3: `processMarkdown(markdown, idPrefix)`はサニタイズまでを行い、`idPrefix`は必ず`idPrefixFor`の戻り値を渡す(空文字列だと接頭辞が付かない。3.4の`renderMarkdown`で確かめる)。空の`[x](#)`はページ先頭の意味として書き換えない。脚注のIDも`normalizeAnchorFragment`で正規化してから予約する。`ol`の`start`を許可する。正規化後に同じになる脚注のラベル(`[^a!b]`と`[^a%21b]`)はIDが重複する既知の制限がある
- 3.4: `processMarkdown`は入れ子の深さ100(`MAX_NESTING_DEPTH`)を超える文書と、解析でスタックあふれ(`RangeError`)した文書を、原文を1つの段落の文字列として返す(環境で結果をそろえるため。設計に無い挙動)。プレーンテキストは`markdown/plain-text.ts`の`plainTextOf`にあり、3.5の`extractSearchText`はこれを使う(設計の`extract-search-text.ts`の中身を分けた)。`markdown/stack-overflow.ts`も設計に無いファイル。表の枠は`div`に`tabindex`・`role`・`aria-label`を付けるため、3.6の攻撃パターン集の許可リストの検査はこれを許す
- 3.4: 攻撃的な入力の解析はremark-parse(micromark)で2乗になる。実測は引用20,000段でBun 2.2秒・Node 0.36秒、強調の記号10,000組で約3.2秒、`[`の20,000段の入れ子で6.6秒。Workersでの描画のたびにCPU時間を使うため、3.6で入力の上限や解析前の打ち切りを確かめる。`markdown-processor.ts`の解析のスタックあふれの`catch`はBunで実行されないため、3.6で解析の関数を差し替えて試せるようにする
- 3.6: `markdown/parse-guard.ts`(設計に無い)が解析の前に線形の走査で9種の負荷(行頭のコンテナの記号・行内の範囲ごとの強調の記号・角括弧の入れ子と対応の無い`]`・遅延継続行・setextの下線・項目の中でコンテナを開くリストの項目・`www.`など)を見積もり、上限を超える入力を原文の1段落に縮退させる。コードブロックの中も数える(フェンスの判定はHTMLブロックや字下げしたフェンスでmicromarkとずれ、ガードを無効にできるため撤回した)。既知の制限: 対応の無い`]`を1行に2個持つコードが空行無しで約830行以上続くと縮退する。残存リスク(Bun/Node、1秒未満): 空の箇条書き`+\n`×10,000で約330/750ms(hast-util-to-textの2乗)、上限直前の`*_\n`で約340/640ms。リンクの方針はhttp・httpsのスキームの後に`//`が無い参照(`https:evil.example`)を相対URLとして解除する。攻撃パターン集は`markdown/fixtures/`に置き、読み込めるのは単体テストとテスト専用のファイルだけ(4.1で利用側アプリの型検査から`common-lib/markdown/fixtures/**`を除く)
- 4.1: apiに`bunfig.unit.toml`(ルートの`bunfig.toml`にカバレッジの除外`common-lib/**`を加えた写し)を新設した。api・eventの型検査は`common-lib/**/*.ts`を含め、`common-lib/*.config.ts`・`**/*.test.ts`・`config/**`・`markdown/fixtures/**`を除く(`coding/001`の既存の規則は`<配置先>/*.ts`で、設計とずれる)。`docs/onboardings/README.md`のコマンドの表は`test:unit`の行だけ更新したため、11.3で`lint`・`typecheck`・`test:worker`の行にも配置先の除外を書く
- 4.2: ルートの`bun run check`と`check-test-names`の赤は解消した。Vueの機能フラグは`apps/frontend-lib/config/vue-feature-flags.ts`(設計に無い)を6つのVite・Storybookの設定で共有する。frontend-libは描画の9パッケージを宣言しないため、`PREBUNDLED_DEPENDENCIES`の4つ(remark-rehype・rehype-sanitize・rehype-stringify・hast-util-to-text)はfrontend-libの位置で"Failed to resolve dependency"の警告が出るが、Viteが共用部品の`node_modules`からたどって事前バンドルするため再読み込みは起きない。frontend-libの位置ではunified・remark-parse・remark-gfmがMilkdownの推移的な依存の写しに解決されるため、11.3で`coding/002`の版をそろえる一覧に推移的な版の照合も検討する。frontend-libの単体テストはカバレッジの都合で共用部品のうち`text/graphemes.ts`だけを読み込む
- 5.1: タスクリストのチェックボックスにはaxeの`label`違反を避けるため、common-libの`plugins/task-list-label.ts`(サニタイズの後の信頼できる変換)で項目の文字列から`aria-label`を付ける(設計のMarkdownRendererの事後条件に無い。11.2の`security/004`のサニタイズの後の変換に含める)。コードブロックの色はデザイントークン`--code-block`・`--code-block-foreground`を`tokens.css`へ加えた(frontend-platformの境界)。GFMの列揃えは`markdown.css`の`[align]`の規則でtypographyの`text-align`を上書きする。2つ以上の表を持つ本文は、同名のregionになりaxeのベストプラクティス`landmark-unique`に当たる(WCAGの規則では違反0)。生のHTMLの例外の走査は`interface`・型のリテラル・汎用の変換関数を経由した偽造を検出しない(11.2の文書に限界として書く)
- 5.2: 折りたたみの表示部品は、折りたたんだ部分へフォーカスが移った時と、ページ内の移動(脚注・見出しのアンカー・ハッシュ付きのURL)で本文の中がスクロールした時に展開し、移動先を見える位置へ戻す(WCAG 2.4.11。設計に無い振る舞い)。「続きを読む」「折りたたむ」は`utilities/messages/markdown-messages.ts`(設計に無い)に置き、文言規則`003`へ追記済み
- 5.3: 強調表示の`<mark>`の文字色はモックアップの`text-inherit`ではなく`text-foreground`にした(控えめな文字色の上ではAAに届かないため。理由はサービス仕様`001-design-principles.md`)。強調は塗りと文字色だけで示す(WCAG 1.4.1の対象外と判断。太字や下線を加えるかは開発者の判断)
- 6.1: 遅延読み込みのモジュールの判定は、設計の`**/markdown-editor/crepe/**`ではなく`crepe`のディレクトリを含む相対パス全般(`./crepe/…`を拾うため)。`@vue/*`も禁止に加えた。静的解析の設定`frontend/no-raw-html`を`frontend/restricted-syntax`へ改名し、読み込み関数(`components/markdown-editor/load-crepe-editor.ts`)には`editor-loader`、モジュールの中には`editor-module`の設定を掛ける。読み込み関数自身も`@milkdown/*`・`vue`を動的importできない。frontend-platformのdesign.mdは旧名のまま
- 6.2: Crepeのリスト機能(list-item)は`ul>div>li`になりaxeの`list`・`listitem`違反になるため組み込まず(P1と相違)、素の`ul`・`ol`・`li`を`crepe-theme.css`で整形する。タスク項目の状態は`crepe/task-item-state.ts`(設計に無い)の装飾で視覚的に隠した「完了」「未完了」を置いて伝える。リンクの設定・解除はリンク全体に掛ける独自のトランザクション(設計の`updateLinkCommand`ではない)。CJKの強調は`/parseOnly`(Milkdownが強調の書き戻しを上書きするため)、取り消し線は`/bidi`。エディタの事前バンドルの一覧は`config/editor-prebundled-dependencies.ts`(設計に無い)に集約し、3つのブラウザテストの設定と`.storybook/main.ts`が読む。`Mod-k`でリンクのダイアログを要求する。Milkdownの変更通知は入力が止まってから約200ms後のため、6.5ではフォーカスアウトの時に`readMarkdown()`で最新の値を渡す
- 6.3: 見出しレベル1・画像は全経路で`crepe/forbidden-node-normalizer.ts`が文字列にし、保存は`\# …`・`!\[alt]\(…)`(再保存で1回だけ`(<URL>)`へ変わり、以後は安定)。`insertImageInputRule`は7.22.3で登録されていないため外していない(設計と相違)。ファイルの貼り付け・ドロップは`crepe/file-transfer-guard.ts`(設計に無い)がエディタのviewのハンドラーで止める(Crepeのdrop-indicatorがプラグインより先に挿入するため)。`prosemirror-drop-indicator`は破棄の時に30msのタイマーを消さず、ドラッグの直後30ms以内に入力欄を破棄するとエラートラッキングに1件の誤報が届く(ライブラリの更新時に再確認)。Tabは編集領域から抜け、リストの階層と表のセルの移動は`Mod-]`・`Mod-[`だけになった。6.4・6.5で、この操作方法を入力欄の説明文(`aria-describedby`)か`aria-keyshortcuts`で支援技術へ伝え、macOSのブラウザで`⌘[`・`⌘]`が戻る・進むにならないよう、編集領域の中では常に処理済みとして既定の動作を止める
- 6.4: ツールバーの項目は`editor-actions.ts`の`kind`(toggle・insert・dialog)で区別し、`aria-pressed`は切り替えの8項目だけ、表は無し、リンクは`aria-haspopup="dialog"`。押下中の箇条書き・番号付きリスト・引用・コードブロックを押すと解除する(`crepe/editor-commands.ts`を変更)。制御器が無い間は`aria-controls`を出さない。リンクのhttp(s)は`URL.canParse`とホストの非空を要求する。6.5への申し送り: (1) macOSの`⌘[`・`⌘]`の既定の動作を編集領域の中で止める(`crepe/editor-features.ts`。ヒントがCommandのキーを案内しているため最優先)、(2) キー操作の説明`EDITOR_KEYBOARD_HINT`を編集領域の`aria-describedby`へ移し、ツールバーとの重複を見直す、(3) 選択時のツールバーの文言(太字・斜体・取り消し線・コード・リンク)を`markdown-messages.ts`の定数にして文言規則003へ載せる
- 6.5: Chromiumではwindowへの通知で捕捉の段階の聞き手も加えた順に呼ばれるため、設計の`capture: true`は効かない。`preload-recovery.ts`は全ての聞き手の後にマイクロタスクで`defaultPrevented`を確かめ、読み込み関数は通常の聞き手を使う(design.mdのLoadCrepeEditor・System Flows・Modified Filesは古い)。`FormControlProps.labelId`は列挙不可のプロパティで、`{...control}`では渡らない。編集領域の描画の失敗は`EditorLoadBoundary`(TanStack Routerの`CatchBoundary`)の`onFailure`で古い制御器を捨て、`reportUnexpectedError(error, 'render')`で送る。フォームへ渡す値はMilkdownが付ける末尾の改行1つを除く。入力欄を描画するブラウザテストは、Vitestのブラウザテストの設定がTanStack Startのコンパイルを通さず`report-error.ts`がサーバー専用の依存を読み込むため、`start/observability/report-error.ts`を`vi.mock`で差し替える必要がある(下流specが入力欄を使う前に、サーバー専用の依存を持たない送信の入口を切り出すか、共有のブラウザテストの設定で`.server`の分岐を消すかを開発者が判断する)。チャンクの評価時の例外も`EditorLoadError`として送られず、`editor.create()`の拒否では空の枠が残る(観測の改善の余地)
- 6.6: `check:editor-chunks`は`manifest.json`ではなくRolldownの出力のチャンク情報(`moduleIds`・`imports`・`dynamicImports`)で判定する(manifestにはチャンク内のモジュールの一覧が無く、SSR用にも無いため。設計と相違)。検査用のビルドはTanStack Startのコンパイラを通らないため、ブラウザ向けだけ`*.server.ts`とNodeの組み込みモジュールを外部化する。手動の実行で、ルートの一括検査とCIには組み込んでいない(設計どおり)。`scripts/check-editor-chunks.ts`の実行部分には単体テストが無い。CLAUDE.mdのディレクトリ構成に`apps/frontend-lib/scripts/`が無い(11.3で扱う)
- 7.2: 全文検索のSQLのひな形は文の間に`--> statement-breakpoint`を入れる(Workers統合テストのマイグレーションの読み込みがこの区切りで1文ずつ実行するため。`renderSearchIndexRebuildSql`は区切りの無い1文なので、貼る時に区切りを挟む)。更新のトリガーは`AFTER UPDATE OF <索引する列>`。`REPLACE`と`id`の更新はexternal contentの索引を壊すため使わない(`docs/GUIDES/tech/db/002`)。列名はSQLiteの予約語(`apps/db/search/sqlite-keywords.ts`、設計に無い)を拒否する
- 7.3: `findMissingSearchIndexSql`はマイグレーションを名前順に読み、後の`DROP TRIGGER`・仮想テーブルの`DROP TABLE`・索引文書の`DROP TABLE`で消えた作成文も欠けとして扱う(設計より広い)。SQLの出力スクリプト`db:search-index-sql`に`--drop`・`--recreate`を加え(設計に無い)、変更の種類ごとの手順は`docs/GUIDES/tech/db/003`にある(索引する列の削除は、定義を変える前に`--drop`のカスタムマイグレーションを置く)。`SearchIndexDefinition`は`defineSearchIndex`だけが作れるブランド型。`docs/GUIDES/tech/db/003`に足した全文検索の節は11.1の`db/004`と重なるため、11.1で移すか要約とリンクにする。CLAUDE.mdのディレクトリ構成に`apps/db/search/`・`apps/db/scripts/`が無い(11.3)
- 8.2: 抽出の入力は、正規化して空になった抽出の対象の項目を結合から外す(全項目が空なら`store-empty`)。ハッシュは`KEYWORD_SELECTION_VERSION`とNUL文字と入力の連結のSHA-256(設計は「連結」とだけ記述)。宣言した項目の文字列が元データに無ければ`TypeError`(再試行の上限の後にdead-letterへ)。8.3の選別の規則を変えたら`KEYWORD_SELECTION_VERSION`を上げる(11.1の`external/002`に書く)
- 8.3: 200の応答の`languageSupported`はproto3で`false`が省かれ`true`は必ず出るため、項目が無ければ非対応言語にする(設計1445行の「`false`でなければ`extracted`」と相違)。9.4の疎通確認で、対応言語の実際の応答に`languageSupported: true`が付くことを確かめる(付かなければ全件が縮退する)。設計の表に無い状態コード(200以外の2xx・3xx・405・408・409・413・499など)はその状態コードの`configuration-error`。どちらも11.1の`external/002`に書く
- 8.4: `markPending`はハッシュを残すため、編集前の状態(extracted・unsupported)が失われる。`planRefresh`は「pendingで同じハッシュ」を`reuse-keywords`(状態`extracted`)にし、非対応言語の文書は状態がextractedへ付け替わる(キーワードの列と再抽出しないことは変わらない。状態を正確に保つには`StoredIndexState`に前回の状態を足すか、`markPending`で`unsupported`の時だけハッシュを消す設計の変更が要る。開発者の判断)。9.2への申し送り: `store-empty`・`reuse-keywords`の書き込み(状態・ハッシュ・キーワードの列・`statusChangedAt`)は設計に無く9.2で決める(推奨: store-emptyは空のキーワード・`extracted`・ハッシュ、reuse-keywordsは`keep`・文書のハッシュ・`plan.status`・`now`)。上限未満の一時的な失敗は`statusChangedAt`を現在時刻に更新する
- 8.5: 登録は設計に加えて、2つの検索対象が同じ索引文書のテーブルを使うことを拒否し、集約点のテストで各対象の`index`が`SEARCH_INDEXES`にあること(参照の一致)を確かめる。元テキストの列の項目名はDBの列名(`short_description`)と一致させる(11.1の`db/004`に明記)。状態の値の一致は`workers/search/search-target-definition.ts`の`SEARCH_KEYWORD_STATUSES`の型で保証する
- 8.6: D1のFTS5で`prefix='2 3'`・bm25の列の重み・external contentのトリガーの同期・`integrity-check`が使えることを確かめた(`docs/GUIDES/tech/db/002`に記録。research.md 348行の「未確認」は古い)。`D1SearchIndexRepository`は設計どおり`@injectable`のクラス(既存の`workers/email`のリポジトリはファクトリ関数)。テキスト列の値の欠落は`TypeError`、同時刻の再抽出の候補は`id`で並べる。Workers統合テスト専用の検索対象`workers/search/testing/fixture-search-target.ts`の`CREATE TABLE`は手書き(全文検索の索引だけ生成したSQL)。8.5以降、`lib/workers`の単体テストだけで覆うファイルがapiのWorkers統合テストのカバレッジで閾値を割っていたため、`config/vitest/unit-tested-sources.ts`の`listUnitTestedSources`で隣に`*.unit.test.ts`を持つソースをWorkersのカバレッジから除く(testing/001に追記)
- 8.7: ロガーのカテゴリーの先頭はアプリ名でないと出力されないため(`infra/004`)、`createSearchPlatformModule(targets, appName)`でカテゴリーを`[appName, 'search', 'refresh']`にする(設計は`(targets)`と`['search','refresh']`)。9.3・10は`'event'`・`'api'`を渡し、9.2の処理のカテゴリーは`['event','search','index']`にする。文は`SEARCH_TYPES.IndexStatements`(8つ目の識別子、設計に無い)で処理単位ごとに束縛し、`createSearchIndexStatements`も公開する。`requestRefresh`は未登録の検索対象(`SearchTargetRegistryError`)と契約に合わない本文(`MessagePublishError`)を投げ、それ以外の送信の失敗だけをログとSentryで握る。10の再抽出のジョブは1件ごとに例外を捕まえて残りを止めない。`markPending`・`deleteSources`は空・64文字超の識別子を`RangeError`にする。`markPending`は元データの存在を確かめない(対象外の行は9.2で削除)
- 9.1: 開発者の手作業: この変更をmainへマージする前にInfisicalの`staging`のフォルダ`/`へ`GOOGLE_NL_API_KEY`を登録する(未登録だと以後のstagingのデプロイが止まる)。prodはlaunch-readinessが登録、devには登録しない。`wrangler dev`は`secrets.required`のキーだけを`env`へ渡すため、ローカルで`KEYWORD_EXTRACTOR`を`google-natural-language`に変えてもキーは届かない(9.4の疎通確認は`infisical run`でstagingのキーを注入する手順にする)。backend-platformの設定の単体テストは`SEARCH_CONFIG_KEY_PATTERN`で2つのキーを基底の検査から外し、`apps/api/test/config/search-wrangler-config.unit.test.ts`で確かめる。時間切れは打ち切りの信号の状態で判定する(本文の読み取り中も`timeout`)。`composition/search-module.ts`は9.3で作る。project-values.mdの変数の表の`KEYWORD_EXTRACTOR`は11.3で加える
- 9.2: 空の入力はキーワード`''`・`extracted`・文書のハッシュ・現在時刻で書き、ログは`extracted`(抽出を無効にした環境でも)。前回のキーワードの再利用は`keep`・文書のハッシュ・計画の状態・現在時刻で、ログは`reused`。未登録の検索対象は`skipped`・`reason: 'unregistered-target'`・`error`。縮退と再試行は`warning`、設定の誤りは`error`(設計の「1件ごとに`info`」と相違、Monitoringの節に合わせた)。再試行の例外は書いた後に投げる。通知の状態コードは`number`(8.3が形の不一致を200で返すため。設計は`number | undefined`)。9.3で束縛する識別子は`SEARCH_TYPES.KeywordExtractor`・`EVENT_SEARCH_TYPES.SearchIncidentReporter`(`application/search/search-types.ts`、設計に無い)・`SEARCH_TYPES.RefreshHandler`
- 9.3: Queueからの結合のWorkers統合テストは、テストファイルの中だけ`vi.mock('../../lib/workers/search/targets/index.ts')`で集約点をテスト専用の検索対象へ差し替え、本物のエントリを通す(本番の`SEARCH_TARGETS`は空のまま。11.1の`db/004`か`testing/001`に書く)。`search-module.ts`は共通の束縛`EVENT_SEARCH_PLATFORM_MODULE`とeventの検索のモジュール`EVENT_SEARCH_MODULE`の2つをexportする。`FetcherQueueResult`のglobal宣言が`email-module.worker.test.ts`と重複している
- 9.4: 疎通確認の`smoke:keyword-extraction`は、キーが無ければ終了コード2、全件抽出で0、抽出できない短文があれば1(0・1は設計に無い。11.1の`external/002`に書く)。実行は`cd /workspace/apps/event && infisical --telemetry=false run --env staging -- bun run smoke:keyword-extraction`。日本語と英語が`extracted`になれば、実際の応答に`languageSupported: true`が付いている(8.3)。実際のキーでの実行は開発者の手作業
- 10: 再抽出のジョブは要求と候補の取得の失敗を1件ごとに捕まえて続け、全件の処理と要約のログの後に`SearchKeywordReextractionError`を1件投げる(設計に無い)。候補の取得の失敗は`lookup-failed`。要約の`failed`はジョブまで届いた例外だけを数え、要求の部品が握るQueueの送信の失敗は`api.search.refresh`のログに出る(11.1か11.3に書く)。1時間前の基準は`Clock`の現在時刻。カテゴリーは`['api','search','reextraction']`。apiのエントリはDurable Objectを公開するためテストより先に読み込まれ`vi.mock`で集約点を差し替えられず、テスト専用の検索対象の結合テストは本物の`SCHEDULED_JOBS`と検索の共通の束縛だけ差し替えた`MODULES`から`createWorkerHandler`を組み立てる(11.1の`db/004`か`testing/001`に書く)。メールの定期実行のテストは、4:21の要約の`jobs`に`email-delivery.cleanup`の成功が含まれることだけを確かめる
- 11.1: `external/002`・`db/004`で新しいプレースホルダー`<抽出の方式の変数>`・`<自然言語APIのキーのシークレット>`を使う。11.3でproject-values.mdに対応付けの行(`KEYWORD_EXTRACTOR`・`GOOGLE_NL_API_KEY`)、`KEYWORD_EXTRACTOR`の変数の行、使う文書の欄への`external/002`・`db/004`、定期実行の節への再抽出のジョブの名前・時刻・順序・件数を加え、`coding/003`で「共用部品」を定義する。`db/003`の全文検索の節は`db/004`へ移し、要約とリンクにした
- 11.2: `frontend/008`・`security/004`で新しいプレースホルダー`<共用部品の配置先>`(値は`common-lib`)を使う。既存の`coding/001`264行は`<共用部品>`と書いており表記が2通りある。11.3でproject-values.mdへ対応付け、表記をそろえる。`frontend/005`のマークダウンの節は008を正にして要約とリンクにした
