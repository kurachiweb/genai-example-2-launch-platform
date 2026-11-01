# Implementation Plan

- [ ] 1. 基盤: 前提の確認・依存パッケージ・テーブル・Wrangler設定
- [x] 1.1 前提を確かめ、依存パッケージを版固定で導入し、workerdとBunで読めることを確かめる
  - 前提: backend-platform・api-gateway・frontend-platformの全タスクと、content-processingが下流向けに示す最小の区切りが完了していること(仮決定2、roadmapの順はcontent-processing→media-pipeline。N-3)。区切りは、content-processingのタスク1.1(共有ディレクトリの定義への共用部品の追加)・1.2(共用部品のプロジェクトと読み込みの境界)・4.1(APIサーバーとイベントサーバーへの組み込み)・4.2(利用者側・管理者側とfrontend-libへの組み込み。兄弟の相対パスの検査と開発サーバーの配信の許可を含む)・6.1(frontend-libの`server/**`からcommon-libを読み込む許可と`validation/**`の禁止の静的解析の規則)、11.3のうち`coding/003`への`server/**`の許可の記述、11.4のうち日次タイムラインのジョブの名前と順序の表の作成である
  - `server/**`の許可(M-2)は、content-processingの6.1の単体テストの成功と`coding/003`の記述で確かめる。日次タイムラインの表を除く前提が無ければ止めて報告する。日次タイムラインの表が無いことを理由には止めず、タスク9.2で作る
  - 先に、`image-size`と`fast-xml-parser`をimportして小さな画像の寸法とXMLの検証を行うBunの単体テストと、`wasm-image-optimization/workerd`で小さなPNGを縮小するイベントサーバーのWorkers統合テストを書き、失敗を確かめる
  - api・eventに`image-size` 2.0.4・`fast-xml-parser` 5.11.2・`fast-xml-validator` 1.4.2(開発者の決定(2026-11-01)。`fast-xml-parser`の`XMLValidator`が非推奨のため、構文の検証を移す)、eventに`wasm-image-optimization` 2.0.11・`aws4fetch` 1.0.20、client・admin・frontend-libに`react-easy-crop` 6.2.4を、完全に固定した版で導入する。eventのテスト設定が`.wasm`をモジュールとして読めない場合は、読み込みの規則を加える
  - client・admin・frontend-libの`vitest.browser.config.ts`の事前バンドルの一覧(`PREBUNDLED_DEPENDENCIES`)に`react-easy-crop`を加える(テストの実行中に初めて読み込まれて事前バンドルがやり直されると、ページが再読み込みされReactが2つ読み込まれるため)
  - 同じ変更で、tech-stack.mdの画像処理に`image-size`を加えて各パッケージの役割を更新し、依存パッケージの版の一覧に、api・eventでそろえる2つとclient・admin・frontend-libでそろえる`react-easy-crop`を加える
  - 完了状態: 2つのテストが成功し、ロックファイルの版が設計の表と一致し、tech-stack.mdと版の一覧に新しいパッケージが載っている
  - _Requirements: 6.2, 17.6_

- [x] 1.2 ファイルの記録と隔離理由のテーブルを定義し、マイグレーションを生成する
  - 先に、2テーブルの列の型・NOT NULL・オブジェクトキーの一意制約・ファイルと理由の組の一意制約・ファイル削除での理由の連鎖削除・共通カラム・索引を確かめる単体テストを書く
  - ファイルの記録は、設計の物理データモデルの列(保存先・保存先の現在値・保有者・元のファイル名・形式・バイト数・幅・高さ・保存完了・紐付け・判定の状態と検出内容・削除待ち・論理削除)を持ち、保有者・未紐付け・論理削除・判定の状態・削除待ち・保存先の照会の索引を付ける
  - スキーマの集約点に2テーブルを加え、マイグレーションを生成する。マイグレーションはmainの最新を取り込んでから生成し、番号の衝突があれば生成し直す(並行するspecとのスナップショットの分岐を防ぐ。M-6)
  - 完了状態: 列の単体テストが成功し、生成したマイグレーションがマイグレーションの検出確認のコマンドで検出され、ローカルに適用できる
  - _Requirements: 4.7, 9.1_

- [x] 1.3 eventのWrangler設定にメディアの項目を加え、設定の整合を単体テストで保証する
  - 先に、環境ごとの実効値で、eventの`exports`で既定のエクスポートのキャッシュが無効で`ImageDelivery`が有効なこと、eventの変数(画像配信のホスト名・専用ホストかどうか・判定の実装・リージョン・閾値・カテゴリ)の値、ルート(ローカル)の必須シークレットに動作確認のトークンが、staging・prodの必須シークレットに判定サービスの2つのキーがあり、staging・prodの必須シークレットに動作確認のトークンが無く、変数に秘密の値が無いことを確かめる単体テストを書く。eventのキャッシュの期待値は既存のテストに無いため、このテストで新しく足す
  - 設計の「環境ごとの設定値」の表どおりに、継承されないキーは環境ごとに書く。ローカルの動作確認のトークンはルートの`secrets.required`に入れる(`wrangler dev`は`secrets.required`のキーだけを`env`へ渡すため。メールの疎通確認のトークンと同じ扱いで、未登録なら警告して起動し経路は404になる)。R2バインディングの管轄はinfra-deliveryが設定済みのため、本タスクでは変えない
  - backend-platformの設定の単体テストが本specのキーで失敗しないよう、`apps/api/test/support/wrangler-config.ts`にメディアの変数とシークレットのキーの除外パターン(`MEDIA_CONFIG_KEY_PATTERN`。`IMAGE_DELIVERY_`・`MODERATION_`・`REKOGNITION_`・`MEDIA_`で始まるキー)を加え、`wrangler-config.unit.test.ts`の受け持ちの外のキーの一覧(`DELEGATED_KEY_PATTERNS`)へ加える(メールの`EMAIL_CONFIG_KEY_PATTERN`・全文検索の`SEARCH_CONFIG_KEY_PATTERN`と同じ受け持ちの分け方)。eventの必須シークレットのテスト(「eventはメール・キーワード抽出以外の必須シークレットとして…」)と変数のテスト(「eventのメール・キーワード抽出以外の変数は…」)の2つの名前も、「メール・キーワード抽出・メディア以外」に改める
  - eventのWorkers統合テストの設定に、テスト用の変数(画像配信のホスト名・専用ホストかどうか・代替の判定・閾値・カテゴリ)を加える
  - 実行時の環境の型を生成し直してコミットする
  - Workerへ渡す任意のシークレットの一覧(`OPTIONAL_WORKER_SECRETS`のevent)の動作確認のトークンは、infra-deliveryが追記済みである(2026-11-01のギャップ分析で確認)。必須の判定サービスの2つのキーは`secrets.required`からデプロイの対象になるため、`scripts/delivery`の変更は要らない。本specは`scripts/delivery`を編集しない(N-2)
  - 同じ変更で、`docs/onboardings/project-values.md`のWorkerのシークレットのキーの一覧の節(キーの一覧の正。N-5)に、判定サービスの2つのキー(staging・prod、必須)と、動作確認のトークンのdevの行(必須。未登録でも起動し、動作確認の経路が404になる)を、節の形(環境・フォルダ・キー・使うWorker・宣言したspec・必須か任意か・登録の時期)で足し、トークンの生成方法の表と注記にも動作確認のトークンを加える(メールの疎通確認のトークンの行を見本にする)。stagingの動作確認のトークンの行は記載済みのため、食い違いを確かめるだけにする
  - ローカルの値は開発者がInfisicalの`dev`へ登録する。stagingの値は、そのキーを必須にする変更をmainへマージする前に開発者が登録する(未登録のままマージするとstagingのデプロイが止まる)。このことを作業の報告とPRの説明に書き、devの動作確認のトークンと、stagingの判定サービスの2つのキーと動作確認のトークンの登録を開発者へ依頼する。prodの値はlaunch-readinessがリリース時に登録する(I-3)
  - 完了状態: メディアの設定の単体テストとbackend-platformの設定の単体テスト、型生成の検査が成功し、マージ前の登録の依頼と、キーの一覧の節の確認結果が報告に含まれている
  - _Requirements: 11.1, 16.1, 16.2, 17.7_

- [x] 1.4 共通エラーに411の種類を加える
  - 先に、`length_required`の`AppError`が411と共通のエラー形式・`no-store`で応答されること、`STATUS_BY_KIND`の411、公開RESTの状態コードの一覧と説明に411があることを確かめる単体テストとWorkers統合テストの期待値を書き、失敗を確かめる
  - backend-platformの`AppErrorKind`に`length_required`、`AppErrorStatus`と`STATUS_BY_KIND`に411を加え、apiの公開RESTの状態コードの一覧(`ERROR_STATUSES`)と説明に411を加える。api-gatewayの改訂3で413・415を加えたときと同じ範囲で変え、任意の状態コードを受ける組み立て部品は作らない
  - 同じ変更で、`docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md`の共通エラーの種類の表と、`docs/GUIDES/tech/backend/005-public-rest-api.md`の`errorResponses`に指定できる状態コードの列挙と、backend-platform・api-gatewayのdesign.mdとresearch.mdへ、本specの依頼による改訂として記録する
  - 完了状態: 共通エラーと公開RESTの単体テスト・Workers統合テストと型検査が成功し、2つの技術ドキュメントに411があり、backend-platform・api-gatewayのdesign.mdとresearch.mdに改訂の記録がある
  - _Requirements: 2.1_

- [ ] 2. 前後で共有する定義(`apps/common-lib/media`)
- [x] 2.1 (P) 形式の一覧・アップロードのプロトコル・エラーコードを作る
  - 先に、`Content-Type`の解析(引数の除去・大文字小文字・テキストのcharsetはUTF-8だけ・未知の形式)、フォールバックの形式(JPEG→jpg・SVG→svg・他→png)、ファイル名のヘッダーの符号化と不正な値の復号、ダウンロードのパスを確かめる単体テストを書く
  - 画像5形式と添付の範囲(画像5形式・PDF・テキスト)、用途の上限の最大値(20,971,520バイト。1,024を基数とする20MB)と画像用の用途の上限の最大値(20,000,000バイト。Images Bindingの入力上限)、形式の表示名、エラーコードの型を定義する。エラーコードには、アップロードできる利用者かの判定の拒否(`account_unavailable`・`email_not_verified`)を含める
  - 完了状態: 単体テストが成功し、外部パッケージと他の層をimportしていない
  - _Boundary: MediaTypes, UploadProtocol_
  - _Requirements: 1.2, 1.9, 14.4_

- [x] 2.2 (P) 画像バリアントの表と、URLの組み立て・解析・配信可否を作る
  - 先に、画像バリアント仕様の7バリアントの寸法・切り取り方・AVIFの提供可否、パスの解析(大文字の16進・長さ違い・余分な階層・二重の拡張子・未定義の名前と拡張子)、配信可否の全組み合わせ(SVG原本に`svg`以外、ラスター原本に`svg`、`screenshot-full`に`avif`)、表示サイズと1x・2xのバリアントの対応を確かめる単体テストを書く
  - `Cache-Control`の値とオブジェクトキーの形式を定数にする
  - 完了状態: 単体テストが成功し、表の値が画像バリアント仕様と一致する
  - _Boundary: ImageVariants_
  - _Requirements: 10.1, 10.4, 10.6, 10.7, 15.1, 15.2_

- [ ] 3. 受付の純粋な規則(`backend-lib/core/media`、Bunの単体テスト)
- [x] 3.1 (P) 用途の定義・登録表と、ヘッダーの事前検証を作る
  - 先に、用途の名前の形式・保存先と許可形式の範囲・主体の種類の空・上限の範囲(全用途は20,971,520バイトちょうどを受け付け1バイト超を拒否し、画像用は20,000,000バイトちょうどを受け付け1バイト超を拒否する)・名前の重複の違反と、事前検証の411→400→413→415の順序と境界(上限ちょうど・1バイト超・0・数値でない値)を確かめる単体テストを書く
  - 動作確認用の固定の用途を、登録表に入れない定数として用意する
  - 拒否は状態コードではなく`AppError`の種類(`length_required`・`bad_request`・`payload_too_large`・`unsupported_media_type`など)で表す
  - 完了状態: 単体テストが成功し、各拒否が設計のエラーの表の状態コードに当たる`AppError`の種類とエラーコードを返す
  - _Boundary: UploadPurposeRegistry, UploadPrecheck_
  - _Depends: 1.4_
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4_

- [x] 3.2 (P) マジックバイトの表と、寸法の読み取り・画素数の上限を作る
  - 先に、JPEG・PNG・GIF・WebP・PDFの判定と偽装(PNGの申告にJPEGの本文)、JPEGの向き1〜8での幅と高さ、SVGの幅・高さ・viewBoxと寸法なし、判定した形式と申告の不一致、先頭1MiBに寸法が無い画像、1,600万画素と各辺12,000pxの境界を確かめる単体テストを書く
  - 寸法の読み取りは判定する形式を5形式に絞り、向き5〜8で幅と高さを入れ替える
  - 完了状態: 単体テストが成功し、標本の画像(各形式・向き付きJPEG)で期待どおりの寸法と判定が返る
  - _Boundary: FileSignature, ImageDimensions_
  - _Requirements: 3.1, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 3.3 (P) SVGの構文の検査と、テキストを流しながら検査する部品を作る
  - 先に、UTF-8でない本文・BOM付き・壊れたXML・最上位が`svg`でない文書・大文字小文字を混ぜたDOCTYPEとENTITYを確かめる単体テストと、NUL文字・不完全なUTF-8・断片の境界で分かれた多バイト文字・正常なテキストを流す単体テストを書く
  - SVGは実体を展開しない設定でXMLの構文を検査する
  - 完了状態: 単体テストが成功し、DOCTYPE・ENTITYを含むSVGが書き出し直しを案内できるエラーコードになり、違反を含むテキストの流れが失敗する
  - _Boundary: SvgSyntax, TextContentCheck_
  - _Requirements: 3.2, 3.3, 3.4_

- [x] 3.4 (P) ファイル名の整形・`Content-Disposition`の組み立て・オブジェクトキーの採番を作る
  - 先に、パス区切り文字・C0とC1の制御文字・DEL・先頭のドットの除去、前後の空白、UTF-8で255バイトの書記素の境界での切り詰め(絵文字・結合文字)、空になった場合の形式ごとの既定名、日本語名の`filename*`とASCIIの代替、注入した乱数源から32文字の小文字16進のキーができることを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、どの入力でも255バイトを超える名前や改行を含むヘッダー値が作られない
  - _Boundary: FileName, ObjectKey_
  - _Requirements: 4.1, 4.5, 4.6, 12.5_

- [x] 3.5 (P) ファイルの型・目的の保存先の規則・メッセージ契約・ポートとDIの識別子を定義する
  - 先に、目的の保存先の全組み合わせ(ファイル用、画像用で理由なし・1つ・複数)と、3種のメッセージ契約の本文の検証(件数の上限25・100、ULIDとオブジェクトキーの形式)、メッセージ契約の集約点に種別の重複が無いことを確かめる単体テストを書く
  - ドメインへ提供する操作(紐付け・論理削除・即時削除・保有者単位の削除・保有者の識別子の列挙・取得・内容・隔離理由の追加と解除・保有者単位の隔離理由の追加と解除・一覧)と、保有者単位の操作の1回の上限件数・結果の型、保有者の識別子の列挙の1回の上限件数(承認後の改訂1)、リポジトリ・オブジェクトストア・受付処理・物理削除のポートを設計の型で定義する
  - 3種のメッセージ契約をメッセージ契約の集約点へ加える
  - 完了状態: 単体テストとbackend-platformのメッセージ契約の単体テストが成功し、apiとeventの型検査が成功する
  - _Boundary: MediaFile, MediaMessages_
  - _Requirements: 4.8, 9.1, 9.3, 9.4, 9.6, 9.10, 11.3, 13.9, 13.10_

- [ ] 4. D1・R2の部品と、受付処理・ドメインの操作(`backend-lib/workers/media`、Workers統合テスト)
- [x] 4.1 ファイルの記録のリポジトリを作る
  - 先に、受付中の記録の追加と保存完了、複数件の取得(隔離理由を含む・90件ごとの分割)、紐付け(未紐付けだけ設定)、論理削除と削除待ちの印、判定の記録の条件付きの更新(判定待ち・未判定のときだけ、不適切は理由の追加と1つの一括実行、2回目は変わらない)、保存先の条件付きの更新、理由の追加(重複無視)と解除、保有者・削除の候補・再依頼の候補・保存先の食い違いの照会、保有者の画像のうち指定の理由を持たないもの(削除待ちとファイル用の用途と他の保有者を除く)・持つものの照会、理由ごとの一覧とカーソル、保有者の種類ごとの識別子の重複無しの昇順の照会(`after`より後だけ・件数の上限・状態と用途によらないこと。承認後の改訂1)を確かめるWorkers統合テストを書く
  - 完了状態: リポジトリのWorkers統合テストが成功し、判定の記録を2回呼んでも理由が1件・状態が最初の結果のままになる
  - _Requirements: 4.7, 6.7, 6.8, 8.6, 8.7, 9.1, 9.2, 9.3, 9.8, 9.9, 9.10, 13.5, 13.10_

- [x] 4.2 (P) 3つのバケットへのオブジェクトストアを作る
  - 先に、同じキーへの2回目の書き込みが上書きせず`exists`になること、宣言した長さと本文の長さの不一致で書き込みが失敗しオブジェクトが残らないこと、ファイル用のメタデータの保存、読み出しと存在の確認、1,000件を超える削除、バケット間のコピー(目的に既にある・元が無い)を確かめるWorkers統合テストを書く
  - 完了状態: オブジェクトストアのWorkers統合テストが成功する
  - _Boundary: R2MediaObjectStore_
  - _Requirements: 2.5, 2.6, 4.2, 4.3, 4.4_

- [x] 4.3 受付処理を作る
  - 先に、画像用とファイル用の用途で201の結果・記録・オブジェクト・判定の依頼(画像用だけ)ができること、事前検証と実体検証の各拒否で記録もオブジェクトも残らないこと、テキストの違反と長さの不一致で記録の削除が試みられること、キーの衝突で記録を消して想定外の例外になること(開発者の決定(2026-11-01)。採り直さない)、保存先の失敗が503と再試行の秒数になること、判定の依頼の送信に失敗してもアップロードが成功することを確かめるWorkers統合テストを書く
  - 処理の順序は設計のとおりにし、SVGは全体、テキストは流しながら、他は先頭最大1MiBで検査する
  - ログに用途・形式・バイト数・識別子だけを出し、ファイル名と内容を出さない
  - 完了状態: 受付処理のWorkers統合テストが成功し、判定サービスやQueueが失敗する場合も受付が完了する
  - _Depends: 4.1, 4.2_
  - _Requirements: 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.10, 8.5_

- [x] 4.4 物理削除と、紐付け・論理削除・即時削除・保有者単位の削除・保有者の識別子の列挙・取得・内容の読み出しの操作を作る
  - 先に、紐付けの全件の検査(存在しない・保存未完了・論理削除・削除待ち・用途違い・保有者違いの理由の一覧と、1件でも違反があれば何も変わらないこと)と2回目の成功、物理削除の各段階で失敗させた後の再実行で同じ結果になること(全バケットからの削除・画像のパージの依頼を100件ずつ・記録の削除)、即時削除の失敗で削除待ちの印が残り紐付けと内容の読み出しから外れること、保有者単位の削除(上限件数ちょうど・1件超での`hasMore`、繰り返しで全件が消えること、他の保有者のファイルが残ること)、論理削除の後の紐付けの拒否、隔離中・削除待ちのファイルの内容が読めないことを確かめるWorkers統合テストを書く
  - (承認後の改訂1)同じテストで、保有者の識別子の列挙が、複数のファイルを持つ保有者を1回だけ昇順に返すこと、`after`がその値を含まない続きになり`next`をたどると全保有者が重複も欠けも無くそろうこと、続きが無いと`next`が無いこと(残りが`limit`ちょうどの場合を含む)、`limit`の1と500を受け付け0・501・整数でない値を不正な要求として拒否すること、受付中・論理削除・削除待ち・隔離中・ファイル用の用途のファイルの保有者も返すこと、指定と違う種類の保有者を返さないこと、列挙の前後でファイルが変わらないことを確かめる
  - 完了状態: 操作のWorkers統合テストが成功し、保有者の識別子の列挙が設計の`MediaFiles`の型(user-profile-socialの4:21のジョブが呼ぶ形)のとおりに型検査を通る
  - _Requirements: 5.1, 5.2, 5.3, 13.1, 13.2, 13.3, 13.4, 13.6, 13.7, 13.8, 13.9, 13.10_

- [x] 4.5 隔離理由の操作と一覧、両アプリ共通の束縛を作る
  - 先に、理由の追加・解除が記録を確定させてから移動の依頼を25件ずつ送ること、ファイル用の用途への追加が拒否されること、依頼の送信の失敗が一時的な失敗として呼び出し元へ返ること、同じ理由の重複の追加と存在しない理由の解除が状態を変えないこと、理由ごとの一覧が新しい順に検出内容とともに返ることを確かめるWorkers統合テストを書く
  - 同じテストで、保有者単位の理由の追加と解除(ユーザー停止の理由)が、その保有者の画像用の用途のファイルだけを対象にし、他の理由を持つ画像は解除後も隔離のまま残り、上限件数を超えると`hasMore`を返して繰り返しで全件がそろい、途中で失敗させた後の再実行で同じ結果になることを確かめる
  - 3つの操作・受付処理・物理削除・リポジトリ・オブジェクトストアを束縛する両アプリ共通のモジュールを作る
  - 完了状態: 操作のWorkers統合テストが成功し、共通のモジュールを読み込んだ処理単位のコンテナから全操作を解決できる
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 9.7, 9.9, 9.10, 13.9_

- [ ] 5. APIサーバー: 内部REST・認可・GraphQL・日次バッチ
- [x] 5.1 アップロードの内部RESTと、アップロードできる利用者かの判定の差し込み口を作る
  - 先に、未登録の用途の404、未ログインの401、主体の種類が対象外の403、受付処理の拒否の状態コードと共通のエラー形式、成功の201と応答の本文、ファイル用の用途の`Location`、応答の`no-store`、外部経路からの404を確かめるWorkers統合テストを書く
  - 同じテストで、差し込み口を拒否する偽物に差し替えると利用者側の要求が本文を読まずに403と判定のエラーコード(`account_unavailable`・`email_not_verified`)になり、記録もオブジェクトも残らないこと、管理者側の要求では判定が呼ばれないこと、全許可の実装を束縛すると利用者のアップロードが通ることを確かめる。既定の実装が常に許可することは単体テストで確かめる
  - このWorkers統合テストでは、差し込み口(`UPLOAD_ACCESS_TYPES.UploaderEligibility`)をテストのコンテナへ明示的に束縛し(全許可の実装、または拒否する偽物)、`composition/uploader-eligibility.ts`の束縛に頼らない。identity-authのタスク8.5が束縛を差し替えても、このテストは変わらない(R3-3)
  - 差し込み口のポート(`UploaderEligibility`)・DIの識別子(`UPLOAD_ACCESS_TYPES.UploaderEligibility`)・既定の全許可の実装(`AllowAllUploaderEligibility`)と、束縛の置き場所(`composition/uploader-eligibility.ts`)を作る。経路は主体の種類の確認の後、受付処理の前に、利用者側の要求だけで判定を呼ぶ
  - 差し込み口の`session`は、application層の読み取りの型`SessionView`(`apps/api/src/application/session/session-view.ts`)で受け取り、presentation層の`SessionAccess`を読み込まない(R3-1)。`SessionView`の追加はidentity-authのタスク2.3の担当だが、roadmapの順では本タスクが先に実装される。本タスクの時点で無ければ、2.3と同じ形・同じ場所で置く。形はメンバーが`principal(): Promise<Principal>`だけで(`Principal`は`application/session/session-verifier.ts`から読み込む。セッションのIDは`AuthenticatedPrincipal.sessionId`で読む)、`requireAuthenticated`・`issue`・`clear`を含めない。api-gatewayの`SessionAccess`は変えず(`SessionView`の拡張に改めるのは2.3)、経路は`createSessionAccess`の結果をそのまま渡す。既にあればそれを使い、形が食い違えば開発者へ報告する
  - identity-authは、本タスクと5.6の後に、identity-authのタスク8.5で、この束縛を`AccountGuard`の判定による実装へ差し替える(N-7)
  - 拒否はすべて`AppError`で投げ、共通の例外の変換に応答を作らせる(411はタスク1.4で加えた`length_required`)。経路で応答の本文を組み立てない
  - 完了状態: 経路のWorkers統合テストと既定の実装の単体テストが成功する
  - _Boundary: UploadRoute, UploaderEligibility_
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 4.9, 4.10_

- [x] 5.2 (P) 閲覧の可否と管理者の画像確認の方針・判定を作る
  - 先に、用途ごとの方針の採用、方針の無い用途で保有者だけが通ること、画像用の用途で管理者側かつ管理者の主体だけが管理者の画像確認の方針に回ること、既定の方針が常に拒否すること、利用者側からの画像の要求の拒否を確かめる単体テストを書く
  - 方針のポートとDIの識別子、既定の2つの実装、方針の登録の型を作る
  - 完了状態: 単体テストが成功する
  - _Boundary: FileAccessAuthorizer_
  - _Requirements: 12.2, 12.3, 12.4, 12.6, 12.7_

- [x] 5.3 非公開ファイルの内部RESTを作る
  - 先に、未ログインの401、形式の不正な識別子・存在しない・保存未完了・論理削除・削除待ち・拒否のいずれも同じ404、ファイル用の応答の`Content-Disposition: attachment`・形式・`Content-Length`・`no-store`・`nosniff`、管理者側の隔離中の画像(方針を許可に差し替えたテスト)の配信、保存先の記録とずれた画像を他方のバケットから読めることを確かめるWorkers統合テストを書く
  - 本文は読み込まずに流して返す
  - 完了状態: 経路のWorkers統合テストが成功する
  - _Depends: 5.2_
  - _Requirements: 12.1, 12.3, 12.4, 12.5, 12.6, 12.8_

- [x] 5.4 (P) GraphQLの`media`モジュールを作る
  - 先に、隔離中・削除待ち・保存未完了の画像でオブジェクトキーが空になり、形式ごとのフォールバックが正しいこと、添付のダウンロードのパス、DataLoaderが1回の一括取得にまとめることを確かめる単体テストとWorkers統合テストを書く
  - クエリを持たない型だけのスキーマモジュールを作る
  - 完了状態: テストが成功し、スキーマファイルの生成と食い違いの検査が成功する
  - _Boundary: MediaGraphqlModule_
  - _Requirements: 13.8, 15.2_

- [x] 5.5 (P) 日次バッチの3つのジョブを作る
  - 先に、予定時刻からの境界(論理削除の13日前・未紐付けの24時間前・判定待ちの1時間前)とその前後1秒、削除待ちの対象化、1,000件の上限と残数のログ、保存先の食い違いの25件ずつの依頼、1つのジョブの失敗が他のジョブに影響しないことを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、各ジョブが前回の結果に依存しない
  - _Boundary: MediaDailyJobs_
  - _Requirements: 5.4, 5.5, 8.3, 9.8, 13.2, 13.5_

- [x] 5.6 APIサーバーのメディアの束縛と登録を組み立てる
  - 先に、登録箇所の既定値(用途・閲覧の方針は空、管理者の画像確認は全拒否、アップロードできる利用者かの判定は全許可。identity-authのタスク8.5が`AccountGuard`の判定へ差し替えるまでの既定値で、差し替えるときに8.5がこの期待値を直す。R3-3)、閲覧の方針の用途名が用途の登録表に無い・画像用の場合に組み立てが失敗すること、ジョブの業務時刻と定期実行の定義の一致を確かめる単体テストを書く
  - 共通のモジュールとapiのメディアのモジュール、2つの内部REST、`media`スキーマモジュール、アップロードできる利用者かの判定の束縛(処理単位のコンテナから解決する)、3つのジョブ(4:21、順序810・820・830、名前は`media-pipeline.*`)を登録し、3環境の定期実行の定義に必要な式があることを確かめる
  - 完了状態: 単体テストとbackend-platformのcronの一致の検査、apiの全Workers統合テストが成功する
  - _Depends: 4.5, 5.1, 5.3, 5.4, 5.5_
  - _Requirements: 1.1, 1.8, 5.4, 12.2, 12.7_

- [ ] 6. イベントサーバー: 自動判定
- [x] 6.1 判定のポートと、判定の設定・規則・代替の判定の規則を作る
  - 先に、環境の値の解析(閾値0〜100・カテゴリが全10カテゴリの部分集合・不正値の失敗)、ラベルの親をたどった最上位のカテゴリでの判定(閾値ちょうど・設定外のカテゴリ・空のラベル)、代替の判定の規則(99×99・98×98・97×97・その他)を確かめる単体テストを書く
  - 判定サービス・判定用画像の描画・通知・保存先をそろえる処理・パージ・画像の読み出しと変換のポートとeventのDIの識別子を設計の型で定義する
  - 完了状態: 単体テストが成功し、初期値(全カテゴリ・60)で全カテゴリのラベルが不適切になる
  - _Requirements: 6.5, 6.6, 6.9_

- [x] 6.2 (P) 判定用画像の作り方の決定とPNGの符号化を作る
  - 先に、そのまま送る・縮小・余白の3つの境界(長辺640px・短辺80px・5,242,880バイト、JPEG・PNG以外の形式、SVGで寸法が無い場合)と、余白を足したRGBAから作ったPNGがシグネチャと寸法の読み取りで期待どおりに読めることを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、極端な縦横比の画像でも長辺640px以下・短辺80px以上の計画になる
  - _Boundary: ModerationImagePlan, PngEncoder_
  - _Requirements: 6.2, 6.3, 6.4_

- [x] 6.3 (P) SVGの許可リスト検査を作る
  - 先に、Inkscape・Illustrator・Figma・Affinityの書き出しの標本が許可され、`script`・`foreignObject`・`on`で始まる属性(編集ソフトの名前空間を含む)・断片以外の`href`・`javascript:`・`url()`の外部参照・`@import`・`xml-stylesheet`・`set`と`animate`・`feImage`・許可外のdata URI・違反の要素名と属性名だけが記録されることを確かめる単体テストを書く
  - 実体を展開しない設定と入れ子の上限でXMLを解析し、設計の許可リストの表で検査する
  - 完了状態: 単体テストが成功し、技術ドキュメントに載せる許可リストの一覧と実装の表が一致する
  - _Boundary: SvgAllowlist_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 6.4 判定の処理を作る
  - 先に、偽のポートで、記録が無い・保存未完了・削除済み・ファイル用での完了、判定済みの依頼(重複・管理者の解除後)が判定せず保存先だけをそろえること、SVGの違反の隔離、復号できない画像と判定サービスが受け付けない画像の隔離と通知、問題なしの記録、試行回数ごとの一時的な失敗(上限未満は例外、上限で未判定と警告)、設定の誤りの通知を確かめる単体テストを書く
  - 再試行の方針(最大5回・60秒起点・上限1,800秒)を定数として持つ
  - 完了状態: 単体テストが成功し、どの経路でも判定の記録と保存先をそろえる処理の呼び出しが設計の順序になる
  - _Requirements: 6.1, 6.7, 6.8, 8.1, 8.2, 8.4, 8.6, 8.7, 8.8_

- [x] 6.5 (P) 判定サービスの実装(Rekognition・代替・選択)と通知を作る
  - 先に、注入した`fetch`で、署名付きの要求の宛先・ヘッダー・本文(base64の画像と閾値だけで、ファイル名・主体を含まない)、ラベルの応答の変換、各エラー(スロットリング・内部エラー・処理量の上限・画像の大きさ・形式・引数・アクセス拒否・署名の誤り)の分類、10秒の時間切れ、代替の判定が外部へ送らないこと、環境の値による実装の選択、資格情報がログとSentryに出ないことを確かめるWorkers統合テストを書く
  - 未判定・受け付けない画像・設定の誤りをSentryへ送る通知を作る
  - 完了状態: Workers統合テストが成功する
  - _Boundary: RekognitionModerationProvider, StubModerationProvider, CreateModerationProvider, SentryMediaIncidentReporter_
  - _Requirements: 6.9, 6.10, 8.1, 8.2, 16.1, 16.2_

- [x] 6.6 (P) wasmによる判定用画像の描画を作る
  - 先に、GIFアニメーション・WebP・SVG・長辺の大きいJPEGと、極端な縦横比の画像を描画し、出力の形式・寸法(余白を含む)が計画どおりで、壊れた画像が復号できない結果になることを確かめるWorkers統合テストを書く
  - テスト環境でwasmを読めない場合は、描画を注入できる形を保ち、実物の確認を10.1の手順へ回すことをテストの説明に記す
  - 完了状態: Workers統合テストが成功する(またはwasmを読めない理由と代わりの確認手順が記録されている)
  - _Boundary: WasmModerationImageRenderer_
  - _Requirements: 6.2, 6.3, 6.4, 8.4_

- [ ] 7. イベントサーバー: 保存先・パージ・画像配信・動作確認
- [x] 7.1 保存先をそろえる処理と、移動・パージのメッセージの処理を作る
  - 先に、隔離(画像用から隔離へ・パージの依頼)と復元(パージしない)、目的に既にある・元に無い・両方に無い場合、移動の途中(コピー後・削除後・依頼の送信前)で失敗させた後の再実行で同じ結果になること、削除待ちのファイルを動かさないこと、パージの処理が偽のパージの部品の拒否で例外になり成功で完了することを確かめるWorkers統合テストを書く
  - パージの処理はパージのポートだけに依存させる(実装は7.3で作る)
  - 完了状態: Workers統合テストが成功し、パージの依頼が記録の更新より前に送られる
  - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.7, 11.2, 11.3, 11.4, 11.5_

- [x] 7.2 (P) 配信の応答の決定を作る
  - 先に、偽の読み出しと変換で、未定義のバリアントと原本の無い要求の404、SVG原本の`svg`だけの配信とCSP・形式、ラスター原本の各拡張子への変換の引数(寸法・切り取り方・品質80・最初のフレーム)、配信できない組み合わせの404、変換の失敗の404と503、正常な応答の`Cache-Control`と異常な応答の`no-store`を確かめる単体テストを書く
  - 完了状態: 単体テストが成功する
  - _Boundary: ImageDelivery_
  - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.11_

- [x] 7.3 画像配信の名前付きエントリポイントと、変換・読み出し・パージの実装を作る
  - 先に、R2とImages Binding(簡易版)で、`ImageDelivery`への要求が形式と寸法の変換された画像を返すこと、SVGの応答、原本の無い404、パージのRPCが100件以下を受け付けて`ctx.cache`が無い環境では省略として成功すること、パージの部品が処理単位の実行コンテキストからパージのRPCを呼ぶことを確かめるWorkers統合テストを書く
  - Workerのメインモジュールから`ImageDelivery`をエクスポートする。想定外の例外はログに出して投げ直す
  - 完了状態: Workers統合テストが成功し、`ImageDelivery`が`ctx.exports`の対象になっている
  - _Depends: 7.1, 7.2_
  - _Requirements: 10.2, 10.3, 10.8, 11.1, 11.2, 11.3_

- [x] 7.4 画像配信の関門とIP制限の除外を作る
  - 先に、専用ホストの画像のURL→`ImageDelivery`への委譲(クエリ文字列と要求ヘッダーを落とす)、`GET`・`HEAD`以外の405、専用ホストの形式外の404、専用でないホスト(ローカル)で画像のURL以外が通常の経路へ進むこと、画像の要求がIP制限で数えられないこと、SVGのCSPがセキュリティヘッダーの付与で置き換わらないことを確かめるWorkers統合テストを書く
  - 関門のモジュールを登録箇所の先頭に置き、除外の規則を登録する
  - 完了状態: Workers統合テストが成功し、既存のヘルスチェックと他の経路のテストも成功する
  - _Depends: 7.3_
  - _Requirements: 10.1, 10.6, 10.10, 10.12_

- [x] 7.5 (P) トークン付きの動作確認の経路を作る
  - 先に、トークンが未設定の環境の404、不一致の401、アップロード・状態の取得・隔離・解除・削除の成功、動作確認以外の用途のファイルへの操作の404を確かめるWorkers統合テストを書く
  - トークンはSHA-256の値を時間一定で比較し、ログに値を出さない
  - 完了状態: Workers統合テストが成功する
  - _Boundary: MediaSmokeModule_
  - _Requirements: 11.6, 17.2, 17.3_

- [x] 7.6 イベントサーバーのメディアの束縛と登録を組み立て、通しで確かめる
  - 先に、通しのWorkers統合テストで、動作確認の経路からのアップロード→`media.moderate-image`のバッチ→代替の判定で不適切な画像が隔離バケットへ移り、移動とパージの依頼の処理を経て配信が404になること、問題の無い画像が配信され続けることを確かめる
  - 環境の検証にメディアの変数・シークレットを加え、欠けたキー名だけを報告する
  - 共通のモジュールとeventのメディアのモジュールを登録し、3種のメッセージの処理を再試行の方針(判定は最大5回・60秒起点、パージは最大5回・60秒起点、移動は既定)付きで登録する
  - 完了状態: 通しのWorkers統合テストと、backend-platform・api-gatewayのeventのテストが成功する
  - _Depends: 6.4, 6.5, 6.6, 7.1, 7.4, 7.5_
  - _Requirements: 6.1, 6.7, 8.5, 9.5, 10.9, 11.2, 16.2_

- [ ] 8. フロントエンドの部品と中継の経路
- [x] 8.1 中継の経路を定義してclient・adminへ登録し、公開設定に画像配信のオリジンを加える
  - 先に、2つの経路のパス・メソッド・上流のパス(用途名とファイルの識別子の符号化)・受け付ける形式・引き継ぐ項目・時間切れと、経路が凍結されていることを確かめる単体テストと、ダウンロードの中継で`Content-Type`・`Content-Disposition`・`Content-Length`がブラウザへの応答に残ることを確かめる単体テストと、受け付ける形式に無い`Content-Type`のアップロードが中継の415(`unsupported_media_type`)になることを確かめる単体テストを書く
  - 2つの経路はfrontend-platformの`defineRelayRoute`で定義する(素のオブジェクトにしない)。経路の定義は`common-lib/media`だけを読み込む(M-2)。中継の415の挙動と、上流のJSONでない5xxを503`upstream_unavailable`にする挙動はfrontend-platformの定めのまま変えない(M-10)
  - 中継がこれらのヘッダーを落とす場合は、frontend-platformの応答の変換を互換を保って直す(Revalidation Triggers)
  - 公開設定(`PublicRuntimeConfig`・`toPublicRuntimeConfig`)に画像配信のオリジン(`imagesOrigin`。検証済みの`IMAGES_ORIGIN`)を加え、公開設定を直接書くテスト用データとStorybookの設定に値を加える。`IMAGES_ORIGIN`の検証とCSPの`img-src`への登録はfrontend-platformで実装済みのため変えない
  - client・adminの登録箇所(`RELAY_ROUTES`)に2経路を完全一致の経路の後に加え、client・adminの`composition.unit.test.ts`の`RELAY_ROUTES`の期待値(GraphQLの経路だけとの完全一致)を3経路に改める
  - 完了状態: 単体テストとfrontend-platformの中継・登録箇所のテスト(client・adminの`composition.unit.test.ts`の凍結の検査を含む)と、公開設定の単体テストが成功する
  - _Requirements: 1.3, 2.4, 12.1, 12.8_

- [x] 8.2 (P) 選択・切り取り・送信・表示の純粋な関数を作る
  - 先に、選択の検査(形式・サイズ・個数・既存分を含む合計)、出力の寸法と形式(JPEG原本はJPEG、他はPNG、最大寸法以下)、送信の組み立て(`Content-Type`に引数を付けない)と応答の解析(201・各拒否・中継の415`unsupported_media_type`をAPIの`unsupported_file_type`と同じ文言にすること・403の`account_unavailable`・`email_not_verified`を文言規則の既存の文言にして再試行不可とすること・429・503・通信の失敗と再試行の可否・想定外の応答と`upload_purpose_not_found`の文言が`contactAvailable`の真で`UNEXPECTED_ERROR_MESSAGE`、偽で`UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT`になること)、エラーコードと選択の違反から文言規則の文言への対応、サイズの表記、`<picture>`の候補と幅・高さ(正方形・スクリーンショットの縦横比・寸法なし・SVG)と、大文字のフォールバックの形式(`JPG`・`PNG`・`SVG`)から配信のURLの拡張子(`jpg`・`png`・`svg`)への変換、プレースホルダーの先頭1文字(書記素)と配色のコントラスト比を確かめる単体テストを書く
  - 表示部品が受け取る画像の型(`MediaImageView`)とフォールバックの形式の型(`MediaImageFallbackFormat`。GraphQLの列挙の生成型と同じ大文字の値)を`utilities/media`に定義し、`<picture>`の候補の組み立てが大文字の値を受けて拡張子へ変換する
  - 完了状態: 単体テストが成功し、文言が設計のエラーの表と一致する
  - _Boundary: UploadConstraints, UploadRequest, UploadMessages, FileSizeLabel, CropGeometry, PictureSources, PlaceholderAppearance_
  - _Requirements: 14.4, 14.6, 14.7, 14.9, 14.10, 15.1, 15.2, 15.4, 15.5_

- [x] 8.3 ファイルの選択の部品を作る
  - 先に、クリック・Enter・Spaceで選択が始まり、ドラッグ&ドロップで選べ、`accept`が許可形式になり、選んだファイルの名前・サイズ・形式とサムネイルが表示され、オブジェクトURLが破棄され、結果が通知の領域で読み上げられ、axe-coreの違反が0件であることを確かめるブラウザテストを書く
  - 部品ごとにStorybookのストーリーを置く。ストーリーを持たず親の中でだけ描く部品(サムネイルなど)は、frontend-libのStorybookのカタログの検査の内部部品の一覧(`INTERNAL_COMPONENTS`)に加える
  - 完了状態: ブラウザテストとStorybookのカタログの検査が成功する
  - _Boundary: FileDropZone, FileSelectionList, FileThumbnail_
  - _Requirements: 14.1, 14.2, 14.3, 14.12_

- [x] 8.4 (P) 編集ダイアログと、切り取った画像の作り直しを作る
  - 先に、ダイアログがフォーカスを閉じ込めて閉じると選択のボタンへ戻ること、キーボード・ポインターで移動と拡大縮小ができること、縦横比の指定、確定で最大寸法以下のJPEGまたはPNGが作られること(向き付きのJPEGが正しい向きになること)、axe-coreの違反が0件であることを確かめるブラウザテストを書く
  - 部品にStorybookのストーリーを置く。Storybookの開発サーバーでダイアログのストーリーを開き、`react-easy-crop`の事前バンドルのやり直しによる再読み込みが起きる場合は、`.storybook/main.ts`の`optimizeDeps.include`へ加える。エディタ専用の一覧(`EDITOR_PREBUNDLED_DEPENDENCIES`。検査の対象)には加えず、別の項目として並べる
  - 完了状態: ブラウザテストが成功し、Storybookでダイアログのストーリーを開いても再読み込みが起きない
  - _Boundary: ImageCropDialog, EncodeCroppedImage_
  - _Depends: 8.2_
  - _Requirements: 14.5, 14.6, 14.12_

- [x] 8.5 送信と、画像・添付の入力欄を作る
  - 先に、偽の`fetch`で、SVG以外の画像で編集ダイアログを経て作り直したファイルが送られること、作り直し後の超過の文言、SVGと添付がダイアログを経ずに選んだファイルで判定されて送られること、複数の画像を1枚ずつ編集すること、拒否の文言と選び直し、503の再試行、成功で呼び出し元へ識別子が渡ってプレビューが出ること、送信中の状態の通知、`contactAvailable`が偽(管理者側の`ADMIN_PROFILE.contactAvailable`)なら想定外の応答で問い合わせを促す文(「解決しない場合はお問い合わせください。」)が出ず、真なら出ることを確かめるブラウザテストを書く
  - 送信は1件ずつ順に行う
  - 2つの入力欄は必須の`contactAvailable`を受け、`useFileUpload`・`parseUploadResponse`へ渡す。想定外の応答の文言はfrontend-platformの`errorMessageOf(error, contactAvailable)`で選ぶ。利用者側の画面は`CLIENT_PROFILE.contactAvailable`、管理者側の画面は`ADMIN_PROFILE.contactAvailable`を渡す
  - 完了状態: ブラウザテストとStorybookのカタログの検査が成功し、axe-coreの違反が0件である
  - _Depends: 8.3, 8.4_
  - _Requirements: 14.4, 14.5, 14.7, 14.8, 14.9, 14.10, 14.11, 14.12_

- [x] 8.6 (P) 画像の表示部品・ダウンロードのリンク・画像配信のオリジンの取得を作る
  - 先に、AVIF(提供するバリアントだけ)・WebPの`<source>`とフォールバックの`<img>`、1x・2xの`srcset`、幅・高さの属性、SVGの`<img>`だけの表示、未設定・隔離中・読み込みの失敗でのプレースホルダー、遅延読み込み、ダウンロードのリンクの宛先と表示、axe-coreの違反0件を確かめるブラウザテストを書く。オリジンはルーターの文脈の公開の設定で与える
  - 画像配信のオリジンは、`useImagesOrigin`がfrontend-platformの`appRuntimeOf`でルーターの文脈の公開の設定から読む。Providerを作らず、client・adminのルートを変えない
  - 表示部品は、8.2で定義した画像の型(大文字のフォールバックの形式)をそのまま受ける。列挙値の一致を確かめる専用の検査は置かず、下流のspecがGraphQLの操作の結果を表示部品へそのまま渡す箇所の型検査に任せる(本specには`MediaImage`を返す操作が無いため)
  - 完了状態: ブラウザテストとStorybookのカタログの検査が成功し、client・adminの型検査とテストが成功する
  - _Boundary: MediaPicture, MediaPlaceholder, PrivateFileLink, useImagesOrigin_
  - _Depends: 8.1, 8.2_
  - _Requirements: 12.9, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

- [ ] 9. 技術ドキュメントと関連文書
- [x] 9.1 (P) 画像判定・画像配信・アップロードの安全対策の技術ドキュメントを追加する
  - 文書の番号は横断レビュー(I-4)で割り当てた値に固定する: `docs/GUIDES/tech/external/003-image-moderation.md`・`infra/008-image-delivery.md`・`security/005-file-upload-security.md`
  - 画像判定サービス: 要求と上限、カテゴリと閾値の設定、失敗の分類と再試行、未判定と日次の再依頼、IAMユーザーとポリシーを手作業で作る手順、AIサービスのオプトアウト、資格情報の漏えい時の手順、代替の判定の規則、費用の目安を、固有の値をプレースホルダーにして書く。シークレットのキーの名前は列挙しない(キーの一覧の正は本プロジェクト固有の値の節。N-5)
  - 画像配信: 変換とバリアント、エントリポイント単位のキャッシュと関門、キャッシュキーと版、パージの範囲と回数の上限、R2の管轄とバインディング、ローカルとテストでの差、stagingでのキャッシュとパージ・`fit`と品質・JPEG出力のメタデータの確認手順、判定のCPU時間とメモリの実測の手順を書く
  - アップロードの安全対策: 事前検証、実体検証、SVGの構文と許可リスト、ファイル名とキー、上書きの拒否、配信のヘッダー、メタデータの扱いの方針を書く
  - 各ディレクトリの索引に1行ずつ加える
  - 完了状態: 3文書にプロジェクト名・固有の値が無く、記載した値(閾値・間隔・回数・上限)が実装の定数と一致する
  - _Boundary: ImageModerationDoc, ImageDeliveryDoc, FileUploadSecurityDoc_
  - _Requirements: 11.6, 16.3, 17.4_

- [x] 9.2 (P) サービス仕様を本specの決定と整合させる
  - 画像バリアント仕様: メタデータの行を決定Q1に合わせ(WebP・AVIF・PNGは除かれ、JPEGは変換基盤の既定、通常の経路ではアップロード前に除かれる)、パージの実行経路を名前付きエントリポイントのRPCに改める
  - プライバシーポリシーの大枠: Exifの記述を決定Q1・Q2に合わせ、編集ダイアログを経ない画像にメタデータが残り得ることを記す。委託先の一覧のAWS(Rekognition)の行に所在(米国東部、us-east-1)と渡す情報(判定用画像だけ)を記す
  - プライバシーポリシーの大枠の「国外移転の記載事項」に、委託先AWS(Rekognition、us-east-1)の項を加える(N-1)。書き方はinfra-deliveryのタスク8.5が示す型(Cloudflareの項が見本)に合わせ、共通の行の後の委託先の一覧の順の位置に見出し`### AWS(Rekognition)`を置き、「移転先」「移転の根拠」「委託先が講じる措置」の3項目を書く(R3-6)。型が未作成なら、この形で書いて開発者へ報告する
    - 移転先: 米国(us-east-1)。送る情報は判定用画像だけで、元のファイル名・主体の情報を送らない
    - 移転の根拠: EU-USデータプライバシーフレームワーク(DPF)を主とし、DPFが無効になった場合はAWSのデータ処理補遺(DPA)に含まれる標準契約条項(SCC)に拠る
    - 委託先が講じる措置: 既存の共通の記述を参照し、AIサービスのオプトアウトと、判定の呼び出しだけを許す専用の資格情報を加える
    - 共通の「移転先の国」の行は、AWSの記述だけをこの項への参照に改める
  - 準拠方針: データ保持期間の一覧に、紐付けられなかったアップロードファイル(24時間〜最大48時間、日次バッチで物理削除)の行を加える。「データの保存場所」の表(Cloudflareの資源の一覧)には行を足さず、表の下の委託先ごとの箇条に`- **AWS(Rekognition)**: 米国東部(us-east-1)。判定用画像を一時送信し、判定サービス側では保存しない。移転の根拠は骨子のAWSの項を正とする。`を加える(N-1・R3-6)
  - 分担は委託先単位である。Cloudflareの項と記述(infra-deliveryが書く)、Google Cloud(Natural Language API)の項と記述(content-processingが書く。R3-5)、Stripe・Sentryなど他の委託先の記述、全委託先に共通の記載(当該国の制度・本人の求めへの対応、infra-deliveryの8.5が改める「移転の法的根拠」の行)は書き換えない。法務文書の本文は開発者が用意するため、大枠と準拠方針の記載事項に留める
  - 文言規則: 設計のエラーの表のうちアップロードの文言(主体の種類が対象外の「この操作はできません。」(`upload_forbidden`)・編集後のサイズ超過・SVGの書き出し直し・読み込めないファイル・縦横の大きさの超過・合計サイズの超過・一時的に利用できない)を加える。「この操作はできません。」はidentity-authの`forbidden`も使う文言で、roadmapの順で先に実装される本タスクが加え、identity-authの12.2は既にあれば確かめるだけにする(R3-8)。アップロードできない利用者の拒否は既存の「停止中アカウント」「メール未確認」の文言を使い、行を加えない
  - 日次タイムライン: 「日次バッチ(4:21)の内容」のジョブの名前と順序の表へ、本specの3つのジョブ(`media-pipeline.expired-file-erasure`(810)・`media-pipeline.moderation-requeue`(820)・`media-pipeline.location-reconciliation`(830))の行を順序どおりに加える(M-4)。表は最初に4:21のジョブを足すspecが作り、後のspecは行を足す(N-3)。想定の順序ではcontent-processingの11.4が作るが、表が無ければ同じ形で作り(上流のemail-deliveryの`email-delivery.cleanup`(900)を含める)、本specの行を加える。表が無いことを理由に止めない
  - 完了状態: 各文書の記載が設計と決定事項に一致し、国外移転の記載事項にAWSの項(移転先・DPFとSCCの根拠・措置)が型どおりにあり、文言規則に「この操作はできません。」があり、本specの変更がAWS以外の委託先の項と記述を変えていない。日次タイムラインの順序が実装の登録と一致し、リンク切れが無い
  - _Boundary: ServiceDocsAlignment_
  - _Requirements: 16.4, 17.5_

- [x] 9.3 (P) 固有の値・オンボーディング・CLAUDE.mdの参照先を更新する
  - 本プロジェクト固有の値に、画像配信のホスト名、eventの変数、用途の命名規約、メッセージ種別、ジョブ名と順序を加える。シークレットのキーの行はタスク1.3でキーの一覧の節へ足したものを正とし、他の節へ写さない(N-5)
  - オンボーディングに、ローカルでの画像配信のURL、動作確認の経路の使い方、Infisicalへのシークレット(判定サービスの2つのキー・動作確認のトークン)の登録を加える。「stagingの値は、そのキーを必須にする変更をmainへマージする前に開発者が登録する」「prodの値はlaunch-readinessがリリース時に登録する」旨を書く(I-3)
  - CLAUDE.mdの「技術規則の参照先」に、アップロードを扱う前(`security/005`)・画像を配信または表示する前(`infra/008`)・画像判定を呼ぶ前(`external/003`)に読む3文書へのリンクを加える
  - 完了状態: 各文書の値が設計の値と一致し、リンク切れが無い
  - _Boundary: ProjectDocsUpdate_
  - _Requirements: 17.6, 17.7_

- [ ] 10. 検証と引き継ぎ
- [x] 10.1 ローカル環境で動作確認の経路から判定・配信・隔離・削除を確かめる
  - Infisical(dev)に動作確認のトークンが無ければ、開発者へ登録を依頼して止まる(AIエージェントはInfisicalへ書き込まない)
  - オンボーディングの手順どおりにAPIサーバーとイベントサーバーを起動し、動作確認の経路で通常の画像と99×99のPNGをアップロードする
  - 通常の画像が`http://localhost:48043/<key>/square-sm.webp`などで返り、99×99の画像が隔離されて404になり、解除で再び返り、削除で404になることを確かめる。wasmの描画を統合テストで確かめられなかった場合は、ここでGIF・SVGの判定を確かめる
  - 完了状態: 各手順の応答の状態コードと判定の状態を記録した結果が残る
  - _Requirements: 6.9, 8.5, 9.3, 10.1, 10.9, 13.1, 17.2_

- [x] 10.2 一括検査とカバレッジ80%を確かめ、開発者の手作業とstagingでの確認を引き継ぐ
  - ルートの一括検査と一括テストを実行し、本specのコードの単体テスト・ブラウザテスト・Workers統合テストで行と関数のカバレッジ80%以上を確かめる
  - 開発者の手作業を、実行するコマンドや画面の操作とともに報告にまとめる:
    - 本specの変更をmainへマージする前: us-east-1のIAMユーザーとポリシーの作成、AIサービスのオプトアウトの有効化、Infisical(dev)への動作確認のトークンの登録、Infisical(staging)へのアクセスキーと動作確認のトークンの登録(stagingの値は、そのキーを必須にする変更をmainへマージする前に開発者が登録する。I-3)
    - マージの後: stagingでのキャッシュとパージ・`fit`と品質・JPEG出力のメタデータ・判定サービスとの疎通・判定のCPU時間とメモリの確認(技術ドキュメントの手順。Workerへ渡す任意のシークレットの一覧の動作確認のトークンは、infra-deliveryが載せ済み)
    - launch-readinessへの引き継ぎ: prodのアクセスキーの登録(prodの値はlaunch-readinessがリリース時に登録する。prodには動作確認のトークンを登録しない)、画像変換の無料枠と費用の判断
  - 完了状態: 一括検査と一括テストが成功してカバレッジが閾値を満たし、手作業の一覧(マージ前・マージ後・引き継ぎの区分)が報告に含まれている
  - _Requirements: 11.6, 16.3, 17.1_

## Implementation Notes

- 1.1: 開発者の決定(2026-11-01)で、SVGの構文の検証は`fast-xml-parser`の非推奨の`XMLValidator`ではなく`fast-xml-validator` 1.4.2の`SyntaxValidator.validate(xml, options)`を使う。整形式なら`true`、不正なら`name: 'ValidationError'`・`code`・`line`・`col`を持つ例外を投げる(型定義の`{ err }`の戻り値とは違い、派生クラスは非公開のため`try/catch`で判定)。型定義の注記と違い`multipleRoots`の既定は`true`のため`multipleRoots: false`を明示する。DOCTYPE・ENTITYは受け入れ、最上位の要素の名前も検査しないため、3.3は事前の宣言の拒否と`XMLParser`での最上位の確認が要る。`wasm-image-optimization/workerd`はeventのWorkers統合テストから読み込みの規則無しで読める。パッケージの確認のテストは`apps/api/test/packages/`と`apps/event/src/infrastructure/media/media-packages.worker.test.ts`
- 1.2: テーブル定義は`apps/db/schema/media/`。`content_type`は値を限らないテキスト(テキストは`text/plain; charset=utf-8`)。保存先・保有者の種類・判定の状態・隔離理由の値の一覧はテーブル定義に直書きで、2.x・3.5の型との照合のテストは無い(3.5で型を作る時に一覧をそろえる)。`moderation_detail`は要素の型の無いJSON列で、型付けは4.1のストアで行う。索引名は`<テーブル>_<列>_idx`・一意は`_unique`
- 1.3: eventの`exports`(`ImageDelivery`)はトップレベルに書き、staging・prodへ継承される。`ImageDelivery`は7.3までエクスポートされない(Wranglerは名前付きのworkerのエクスポートの存在を検査しない。デプロイで受け付けられるかはstagingで確かめる)。`wrangler types`は7.3の後に生成し直す。メディアの設定の単体テストは`apps/api/test/config/media-wrangler-config.unit.test.ts`。Workers統合テストの変数は画像配信のホスト名`images.test.example`・専用ホスト`true`・`stub`・閾値60・全10カテゴリで、`MODERATION_REGION`はWrangler設定の値を使う
- 2.1: `UploadedFile.contentType`・`MediaFileView.contentType`は`MediaType`(引数無し)で、引数付きの文字列(`text/plain; charset=utf-8`)は記録の`NewMediaFileRecord`とD1の列だけ。記録から画面向けの型へ変換する4.x・5.xで引数を除く。`parseMediaType`は`text/plain`のcharset以外の引数を無視する(SVGのUTF-8の検査は3.3)。`downloadPathOf`は識別子を百分率符号化する。`media/`は外部パッケージと共用部品の他のディレクトリを読み込まない(`config/import-boundary.unit.test.ts`)。配置先の`common-lib`が古い時は`bun run shared-dirs:place`で配置し直す
- 2.2: `image-variants.unit.test.ts`はサービス仕様`002-image-variants.md`の「バリアント一覧」「出力フォーマット」の表を読んで照合する(9.2で表の形を変えない)。設計に無い型の別名`ImageFit`・`ImageOriginal`・`ScreenshotDisplayKind`を公開した。`IMAGE_PATH_PATTERN`はキーの`[0-9a-f]{32}`を`OBJECT_KEY_PATTERN`と別に書いている。`buildImagePath`はキーの形式を検証しない
- 3.1: `backend-lib/core/media`からcommon-libは兄弟の相対パス`../../../common-lib/media/...`で読む(`core/search`と同じ)。`precheckUpload`は拒否(`AppError`の引数)を返し、413・415の文言は用途の表示名が無いため用途を省いて上限・形式の一覧から作る。`Content-Length`は数字だけを受け、安全な整数を超える桁は413。登録表`createUploadPurposeRegistry`は名前の重複だけを検査する(各定義は`defineUploadPurpose`を通す前提)。`MEDIA_SMOKE_PURPOSE`は主体の種類が空で、`defineUploadPurpose`を通さない定数
- 3.2: `image-size` 2.0.4はJPEGの走査で毎バイト`slice()`を複製し、壊れた本文で時間が長さの2乗になる(1MiBで約40秒)ため、`readImageDimensions`は先頭1MiBを1度だけ複製し`slice()`が`subarray()`を返す派生クラスで渡す(`image-size`は`.buffer`からDataViewで長さ無しに読むため、呼び出し元のバッファを共有しない)。`disableTypes`で5形式に絞る設定はisolate全体に効く(他の`image-size`の利用はPNGだけ)。SVGの寸法なしとラスターの読めないはどちらも`undefined`で、3.9と3.7の振り分けと`detectSignature`と申告の比較は4.3で行う。`image-size`のSVGの寸法の読み取りは正規表現で先頭1000文字の`<svg`しか判定しないため、3.3の構文の検査の後に呼ぶ
- 3.3: `fast-xml-parser`の`maxNestedTags`の既定は100で、超えると例外になるため、受付の最上位の確認は`SVG_MAX_NESTED_TAGS`(256、`core/media/svg-syntax.ts`)を明示する。6.3の`inspectSvg`も同じ定数を解析器の`maxNestedTags`に使い、受付で通るSVGを許可リストの検査で解析できるようにする。処理命令(`<?xml-stylesheet?>`など)は受付では拒否されず、6.3で違反として扱う。DOCTYPEの拒否は本文の部分一致で、コメント・CDATAの中も拒否する。Affinity Designerや旧IllustratorのSVG 1.1の書き出しはDOCTYPEを含み受付で`svg_declaration_not_allowed`になるため、6.3の「Affinityの書き出しの標本」は開発者の判断が要る。`TextContentError`は`reason`(`invalid_utf8`・`nul_character`)を持つ。workerdでの流しながらの検査は4.3のWorkers統合テストで確かめる
- 3.4: `sanitizeFileName`は先頭のドットと空白の並びをまとめて除き、切り詰めの後にも前後の空白を除く(設計の「先頭の`.`→前後の空白」の順だと`" .profile"`が`.profile`になり要件4.5を満たさないため。9.1の`security/005`はこの順で書く)。書式文字(U+202Eなど)は要件どおり除かず、拡張子の偽装への対策と`filename`の代替に残る`%`(RFC 6266の4.3)は9.1で検討する。書記素の切り詰めは`Intl.Segmenter`を直接使い、空白の除去は共用部品の`trimWhiteSpace`。`generateObjectKey`は乱数源が16バイト以外を返すと例外
- 3.5: ポートは`core/media/ports.ts`、DIの識別子は`core/media/identifiers.ts`の`MEDIA_TYPES`(7種、`Symbol.for('media.<名前>')`)、契約は`core/media/media-messages.ts`(`MODERATE_IMAGE_MESSAGE`・`RELOCATE_FILES_MESSAGE`・`PURGE_IMAGE_CACHE_MESSAGE`・`MEDIA_MESSAGE_LIMITS`)。設計のインラインの型に`ClaimFailure`・`OwnerIdListInput`・`OwnerIdList`・`QuarantinedImageListInput`・`QuarantinedImageList`・`OwnedImageQuery`・`EraseCandidateQuery`・`ModerationRequeueQuery`、本文の型に`ModerateImageBody`・`RelocateFilesBody`・`PurgeImageCacheBody`の名前を付けた。テーブル定義の値の一覧と型の照合は`workers/media/media-file-columns.unit.test.ts`(coreはDBスキーマを読めない)。project-values.mdのメッセージの表は9.3で加える
- 4.1: `D1MediaFileStore`(`workers/media/d1-media-file-store.ts`)のWorkers統合テストはapiの`test:worker`だけで走る(eventは`lib/**`を除外)。テストの補助は`workers/media/testing/media-file-store-fixtures.ts`(800行のフックでテストを書き込み用・照会用に分けた)。設計で決まっていない振る舞い: `addReasons`は存在しない識別子を無視する(拒否は4.5が`findViews`で決める)、`listQuarantined`は削除待ちを除き、カーソルはストアの内部の形式`<ms>-<ULID>`(不正なら`AppError(bad_request, invalid_cursor)`。公開する層で包み直すかは4.5・5.4で決める)、`findOwnedImageIdsByReason`の理由なしは論理削除済み・保存未完了を含む(13.4)、期限は`<`、`findModerationRequeueCandidates`は保存未完了の判定待ちも返す(処理側で保存未完了は何もせず完了し、記録は810で消える)。日次の照会(`findLocationMismatches`・`findEraseCandidates`)は5.5で`EXPLAIN QUERY PLAN`を確かめる
- 4.2: `R2MediaObjectStore.putIfAbsent`は本文を`FixedLengthStream`に通し`put`と`pipeTo`を待つ。長さの不一致はworkerdの`TypeError`(長い本文は`pipeTo`、短い本文は`put`だけが拒否)でR2の障害と区別できないため、4.3の受付処理は本文の前段にバイト数を数える変換を挟み、自前の例外で`content_length_mismatch`を見分ける(ストアは上流の例外をそのまま通す)。`Promise.all`は先に決着した拒否を返し順序の保証が無いため、4.3で`Promise.allSettled`にして`pipeTo`の理由を優先する変更を検討する。`copy`は目的に既にある場合も元の本文を読む(先に`head`で確かめれば省ける)
- 4.3: `MediaUploadReceiver`(`workers/media/upload-receiver.ts`)は`@injectable`でなく、依存と`appName`をまとめて受け取るクラス(4.5で`toDynamicValue`で束縛。検索の`QueueSearchIndexRefreshRequester`と同じ)。ログのカテゴリは`[appName, 'media', 'upload']`。本文の前段で宣言した長さとバイト数を数え(`ContentLengthMismatchError`)、R2の書き込みは`Promise.allSettled`で`pipeTo`の理由を優先する。記録の作成後の失敗はオブジェクトを先に消し、消せたときだけ記録を消す(残った記録は810が拾う)。開発者の決定(2026-11-01): キーの衝突は採り直さず、記録を消して`ObjectKeyCollisionError`(500)。判定の依頼の送信の失敗はwarning、`MessagePublishError`はerror(アップロードはどちらも成功)。保存先の障害はwarningのログだけ。422・503の文言は受付処理の定数(503の文言は文言規則の「時間をおいて再度お試しください。」と異なり、9.2でそろえる)。ファイル用の用途の画像にも寸法の検査をかける。テストのworkerdの`Network connection lost`のログはminiflareのR2の内部のもの
- 4.4: `MediaFileEraser`(依存`{ files, objects, publisher }`)と`MediaFilesService`(依存`{ files, objects, eraser, appName }`)は4.3と同じく`toDynamicValue`で束縛するクラス。`eraseNow`の失敗は`AppError(unavailable, storage_unavailable)`(503。`MessagePublishError`も包まれエラートラッキングに届かない)、`listOwnerIds`の`limit`の不正は`invalid_limit`(400)。503の文言・秒数の定数が`upload-receiver.ts`と`media-files-service.ts`に重複している(9.2で文言をそろえる時に1か所へまとめる)。`openContent`は記録の保存先に無い画像を他方のバケットからも読む(FileContentRouteの設計と同じ)。未解決の競合(開発者の判断): `claim`は`findViews`と`attach`の間の論理削除・削除待ちを検出しない(直すには4.1の`attach`が更新件数を返すポートの変更が要る)。810の日次の削除は照会と`erase`の間に紐付けられたファイルも消すため、5.5で削除の直前に条件を確かめ直すかを決める
- 4.5: 共通の束縛は定数ではなく`createMediaPlatformModule(appName)`(`workers/media/media-platform-module.ts`)で、5.6は`'api'`、7.6は`'event'`を渡す。`MEDIA_TYPES`のうち`UploadPurposeRegistry`以外の6種を処理単位で束縛し、用途の登録表は各アプリが束縛する。開発者の決定(2026-11-01): 保有者単位の理由の追加・解除で移動の依頼の送信に失敗した後の再実行は移動を依頼し直さず、日次の保存先の照合(830。1回1,000件)が回収する既知の制限(ファイル指定の操作は食い違いも対象にして依頼し直す)。削除待ちの画像は理由を記録しても移動を依頼しない(7.1の移動の処理も削除待ちを飛ばす)。`removeReasonForOwner`は削除待ちの画像の理由も外して`processed`に数える。一覧のカーソルはストアの形式のまま不透明な文字列で渡す(5.4で包み直すか決める)。エラーコードは`quarantine_not_applicable`(400)・`invalid_limit`(400)・`storage_unavailable`(503)。503の文言と秒数は`workers/media/media-operation-errors.ts`に集約(9.2で文言規則にそろえる)。ログのカテゴリ`[appName, 'media', 'quarantine']`
- 5.1: 経路は`apps/api/src/presentation/media/upload-route.ts`の`registerUploadRoutes`、差し込み口は`application/media/uploader-eligibility.ts`(`UPLOAD_ACCESS_TYPES.UploaderEligibility` = `Symbol.for('media.UploaderEligibility')`)、既定の実装は`infrastructure/media/allow-all-uploader-eligibility.ts`、束縛は`composition/uploader-eligibility.ts`の`UPLOADER_ELIGIBILITY_BINDINGS`(5.6で登録するまで未使用)。`SessionView`は`application/session/session-view.ts`に新設(identity-authの2.3は形の一致を確かめるだけ)。成功応答は設計どおり`{ data: UploadedFile }`(camelCase)で、`backend/006`のsnake_caseの規則と食い違う(開発者の判断待ち)。`upload_purpose_not_found`の文言は「アップロードの用途が見つかりません。」。判定が例外を投げた場合のテストは無い
- 5.2: 判定は`apps/api/src/application/media/file-access-authorizer.ts`の`PolicyFileAccessAuthorizer`(依存`{ registrations, resolveReadPolicy, defaultReadPolicy, adminReviewPolicy }`、5.6で`toDynamicValue`と`resolveReadPolicy: (id) => context.get(id)`)、ポートと`FILE_ACCESS_TYPES`は`file-access-policies.ts`(設計の2つに`FileAccessAuthorizer`を加えた)。application層はpresentation層の`CallerKind`を読めないため同値の`FileAccessCaller`を置いた(5.3で`CALLER_KINDS`との対応を`satisfies`などで明示する)。判定は`file.storage`で分け、`canAccess`は同期で方針を解決する。CIの`test:all:worker --coverage`は`src/infrastructure/media/`の既定の方針2つと`src/composition/uploader-eligibility.ts`(5.1)をWorkersの分母で0%として失敗させる(`vitest.worker.config.ts`の`listUnitTestedSources`は`lib/workers`だけ)。5.3か5.6で`listUnitTestedSources(import.meta.dirname, 'src/infrastructure')`を加えるかWorkers統合テストから通す
- 5.3: 経路は`apps/api/src/presentation/media/file-content-route.ts`の`registerFileContentRoutes`。`MediaFiles.openContent`は隔離中を除き`size`・`contentType`も返さないため、経路は`findMany`と`MediaObjectStore.get`で読む。保存先の読み出しの順序の関数`readLocationsOf`が`media-files-service.ts`と重複している(7.1で移動の順序を変える時は両方を直すか`core/media/media-file.ts`へまとめる)。応答の`Content-Disposition`は記録の名前から`attachmentDisposition`で作る(ポートの`StoredObject`は`contentDisposition`を返さない)。ログのカテゴリ`['api', 'media', 'download']`。`apps/api/vitest.worker.config.ts`に`listUnitTestedSources(import.meta.dirname, 'src/infrastructure')`を加え5.2の分母の問題を解消した。`apps/api/src/composition/uploader-eligibility.worker.test.ts`は束縛が全許可の実装であることを確かめるため、identity-authの8.5で束縛を差し替える時はこのテストも直す(5.6で登録箇所のテストへまとめてもよい)
- 5.4: `mediaSchemaModule`(`apps/api/src/presentation/graphql/modules/media/`)は未登録。5.6で`GRAPHQL_SCHEMA_MODULES`へ登録した後に`bun run graphql:generate`を実行し、`generated/schema.graphql`と`generated/resolvers-types.ts`の差分を同じ変更に含める(`src/composition/graphql-modules.worker.test.ts`がスキーマファイルの一致を確かめる)。手書きの`MediaImageModel`・`MediaAttachmentModel`と生成型の一致を確かめる手段(`satisfies`など)を5.6で決める。`toMediaImage`は画像用以外、`toMediaAttachment`はファイル用以外で`TypeError`。隔離中(理由1つ以上)・削除待ち・保存未完了は`objectKey`が空、論理削除済みは返す(13.4)。`mediaFileLoader`は見つからないキーに`null`(設計どおり。`backend/004`の`Error`と異なる)
- 5.5: 3つのジョブと`MEDIA_JOB_TYPES`は`apps/api/src/application/media/media-daily-jobs.ts`。application層はworkersの`MessagePublisher`を読めないため同形の`MediaJobMessagePublisher`を置き、5.6で`PLATFORM_TYPES.MessagePublisher`から注入する。基準は`scheduledTime`。13.5の「13日以上」に合わせ論理削除の境界は13日前+1ms(ストアは`<`)、24時間・1時間はちょうどを含めない。1回の起動で最大1,000件、超えた分は翌日(Batch Contract)。ログは件数と`hasMore`(残数の件数は出さない)。820・830は1件の送信の失敗で残りを続け、最後に`MediaDailyJobError`を投げる。810の削除の直前に候補の条件を確かめ直さない(`erase`自身が`findViews`で読み、競合を閉じるには条件付きの削除が要る。既知の制限)。ログのカテゴリ`['api', 'media', 'expired-file-erasure' | 'moderation-requeue' | 'location-reconciliation']`。偽物のストア`apps/api/test/support/media-daily-job-fakes.ts`の820の並びは`id`だけで、D1は`createdAt, id`
- 5.6: apiの束縛は`apps/api/src/composition/media-module.ts`(`API_MEDIA_PLATFORM_MODULE`・`createApiMediaModule`・`API_MEDIA_MODULE`)、登録箇所は`upload-purposes.ts`・`file-read-policies.ts`(空)・`media-review-policy.ts`(`MEDIA_REVIEW_POLICY_BINDINGS`、全拒否)・`uploader-eligibility.ts`(全許可)。差し替えられる既定値の期待値は`apps/api/test/config/media-registrations.unit.test.ts`の1か所だけ(identity-authの8.5・ugc-moderationが直すのはこのファイル)。閲覧の方針の登録先の検査`assertFileReadPolicyRegistrations`はモジュールの読み込み時に実行する。手書きのGraphQLのモデルと生成型の一致は`mappers.unit.test.ts`の`expectTypeOf`。検索の2つのworkerテストは4:21のジョブ名を完全一致で列挙しており、4:21のジョブを足すspecが直す必要がある
- 6.1: eventのポートと`EVENT_MEDIA_TYPES`(5種)は`apps/event/src/application/media/ports.ts`。ImageSource・ImageTransformerも`ports.ts`にあり(設計のService Interfaceのコメントの`image-delivery.ts`ではない)、7.2はここから読む。設定の解析`parseModerationConfig`はカテゴリの空の値・空の項目・重複・大文字小文字の違いを失敗にする(空の集合で判定が黙って無効になるのを防ぐ。開発者の確認待ち)。`judgeLabels`は`parentName`をたどり、応答に無い親の名前を最上位とみなす(第3階層だけが返った場合は最上位を求められない。6.5で`taxonomyLevel`の扱いを検討)。代替の判定の規則は`decideStubModeration`(寸法だけを受け取る。判定用画像の寸法の読み取りは6.5)
- 6.2: `planModerationImage`・`MODERATION_IMAGE_LIMITS`は`application/media/moderation-image-plan.ts`、`padRgba`・`encodePng`は`png-encoder.ts`(`CompressionStream('deflate')`はWHATWGの仕様でzlib形式。workerdでの実物の確認は6.6で余白の経路を通して行う)。寸法の無いSVGの640×640は6.4が渡す。6.6への申し送り: 計画の寸法はEXIFの向き5〜8で入れ替えた後の表示上の寸法なので、`optimizeImage`が向きを適用しない場合は描画の結果と食い違う。小さいSVGは拡大せず80×80の余白の中央に置く
- 6.3: `inspectSvg`は`application/media/svg-allowlist.ts`、表は`svg-allowlist-table.ts`の`SVG_ALLOWLIST`(`svg-allowlist-document.unit.test.ts`がdesign.mdの表と照合。9.1で`security/005`へ切り替える)。名前空間は接頭辞から宣言先をたどって判定する。CSSはコメントを除かずに検索し(コメントの中の`url(`も保守側に検出)、CDATAの中は文字参照を戻さない。違反の記録は先頭50件(`SVG_MAX_RECORDED_VIOLATIONS`、切り詰めの印は無い)。設計の表に無い調整: `data-*`属性の許可、Sodipodi・Creative Commonsの旧URI、`image-set(`・`src(`の検出(9.1で`security/005`の一覧に載せる)。標本のAffinity・Illustratorの「別名で保存」はDOCTYPE・実体の参照を除いた形(受付を通らないため)。Objectのプロトタイプと同じ名前は`__toString`などで記録される
- 6.4: `ModerateImageHandler`・`MODERATION_RETRY_POLICY`(5回・60秒・1,800秒)は`application/media/moderate-image-handler.ts`。`@injectable`でなく依存をまとめて受け取るクラスで、7.6は`toDynamicValue`で`MEDIA_TYPES.MediaFileStore`・`MediaObjectStore`・`EVENT_MEDIA_TYPES`のポート・`parseModerationConfig(env)`・`PLATFORM_TYPES.Clock`を渡し、`retry: MODERATION_RETRY_POLICY`で登録する(envの検証に`MODERATION_*`はまだ無い)。復号できない画像はwarningのログだけでSentryへ送らない(設計のポートとMonitoringのとおり。tasks.mdの「隔離と通知」とは異なる)。`misconfigured`は一時的な失敗として扱い最終試行でだけ通知する(通知は最大900秒遅れる)。`undetermined`・`rejectedByService`は`recordModeration`が真の時だけ通知する。`readLocationsOf`の重複は`media-files-service.ts`・`file-content-route.ts`と本ファイルの3か所(7.1でまとめる時は3か所を直す)。`isModeratable`の「画像でない形式」の分岐にテストが無い
- 6.5: 部品は`apps/event/src/infrastructure/media/`の`rekognition-moderation-provider.ts`(`AwsClient.sign`だけを使い注入した`fetch`で1回送る。aws4fetchの自前の再試行を使わない。署名の対象は`host;x-amz-date;x-amz-target`)・`stub-moderation-provider.ts`(寸法を読めない画像は`invalid-image`)・`create-moderation-provider.ts`(`createModerationProvider(env, fetcher)`、資格情報の欠落と不正なリージョンを拒否)・`sentry-media-incident-reporter.ts`(指紋`media-moderation-<種類>`と理由、タグ`media_file_id`・`moderation_reason`)。分類表に無い4xx・3xxは設定の誤り、429・`LimitExceededException`は`throttled`、200で形の合わない応答と`ModerationLabels`の無い応答は`service-error`、`TaxonomyLevel`の無いラベルは応答全体を不正。7.6で環境の検証に`MODERATION_*`・`REKOGNITION_*`を加えるか決める。9.1の`external/003`に分類表・指紋とタグ・代替の判定の扱い・署名の対象を載せる
- 6.6: 開発者の決定(2026-11-01)で、SVGの判定用画像の描画器を`@cf-wasm/resvg` 0.4.0へ替えた(ラスター画像は`wasm-image-optimization`のまま。`WasmModerationImageRenderer`は`apps/event/src/infrastructure/media/wasm-moderation-image-renderer.ts`)。`<text>`は同梱のLiberation Sans 2.1.5(`infrastructure/media/fonts/`、OFL 1.1、eventの`wrangler.jsonc`の`rules`で`.ttf`をDataとして読む)で描き、書体に無い文字(日本語など)は代替の四角形で文字の形は判定されない。描画の前に`prepareSvgForRendering`(`application/media/svg-render-size.ts`)がルートの幅・高さ・`viewBox`をブラウザの解釈に合わせて書き直す。SVGのルートの解析は共有の`apps/backend-lib/core/media/svg-root.ts`(`readSvgRoot`・`parseSvgViewBox`・`intrinsicSizeOfSvg`)で、アップロードの`readImageDimensions`もSVGは`image-size`を使わずこれで読む(3.2の注記の「image-sizeのSVGの寸法の読み取りは正規表現で…」は古い。単位はCSSの正しい換算、`em`・`rem`は16px、`ex`・`ch`・相対単位は未設定)。resvgとブラウザで描画が分かれる既知の書き方は6.3の許可リストの違反(`svg-unsupported-css.ts`の`unsupported-css`、WebPのdata URI、入れ子の要素の`viewBox`、`systemLanguage`)。要件7.5の改訂2(WebPの除外)。既知の制限(開発者の決定): 独立のレビューの標本73件中28件(resvg未対応のCSSセレクタ・値の大文字小文字・`<style media>`・`href`と`xlink:href`の併用・data URIの形式と中身の不一致(改訂2が実質無効)・存在しない参照・未対応のプロパティ)は判定をすり抜ける(9.1の`security/005`と`external/003`に載せる)。読み込み以外の描画の例外は再試行の後にデッドレター。wasmと書体のgzip後の合計は約3.4MBでWorkers Paidが前提(7.6の後に`wrangler deploy --dry-run`で確かめる)。テストは`wasm-moderation-image-renderer.worker.test.ts`(ラスター)・`.svg.worker.test.ts`(SVG)・`.fixtures.ts`。7.6では`toConstantValue`か`toDynamicValue`で束縛する
- 7.1: `MediaFileRelocator`(`apps/event/src/infrastructure/media/file-relocator.ts`、依存`{ files, objects, publisher }`を`toDynamicValue`で束縛)は削除待ちと保存未完了のファイルを動かさない(設計を更新)。保存未完了のまま理由が付いた画像は、保存の完了後に判定の処理の`reconcile`が移すが、判定が未判定・原本が無い・判定の依頼の送信に失敗した場合は830まで最大約1日遅れる(4.5と同程度の既知の制限)。パージの依頼は1回の呼び出し分を100件ずつまとめ、各ファイルの削除の後・記録の更新の前に送る。`RelocateFilesHandler`・`PurgeImageCacheHandler`(`application/media/`、`@injectable`で`EVENT_MEDIA_TYPES.FileRelocator`・`ImageCachePurger`を注入、パージは`retry: PURGE_IMAGE_CACHE_RETRY_POLICY`)はBunの単体テスト。ログのカテゴリ`['event','media','relocation']`・`['event','media','purge']`。`readLocationsOf`は`core/media/media-file.ts`に集約済み。途中の失敗のテストの「コピーの後」は実際には元の削除の後で失敗させている(コピー後の状態の再実行は復元の向きで未確認)。830は保存未完了・削除待ちの食い違いも選び続け1日1,000件の枠を使う
- 7.2: `deliverImage`・`SVG_CONTENT_SECURITY_POLICY`は`apps/event/src/application/media/image-delivery.ts`。`ImageTransformer`の入力に`quality`・`anim`を加えた(Images Bindingの`output({ format, quality, anim })`とそのまま対応。7.3はこれを渡す)。変換の`unavailable`は503で、エラーコード`image_unavailable`(設計のエラーの表に無い)と、`media-operation-errors.ts`の`STORAGE_UNAVAILABLE_MESSAGE`の写しの文言を持つ(application層は`lib/workers`を読めないため。9.2で文言をそろえる時は3か所目として直す)。`not-image-path`も404。HEADはラスターでも変換を最後まで行ってから捨てる。原本の読み出しの例外は投げ直す(7.3がログに出して500)
- 7.3: `ImageDelivery`のクラスは、presentation層が合成ルートと実装の部品を読めないため、`presentation/media/image-delivery-entrypoint.ts`の`createImageDeliveryEntrypointClass`で作り、部品の組み立ては`composition/image-delivery-deps.ts`、宣言とエクスポートは`src/index.ts`(設計のService Interfaceの「presentationに`class ImageDelivery`」と異なる。APIの`createGatewayEntrypointClass`と同じ形)。`ImagesBindingTransformer`はコード9412・9413・9520・9522・9523を`invalid-image`(404)、他のコード付きを`unavailable`(503)、コード無しを投げ直す(9522は一時的な場合もあり503が合う場面がある。9.1で分類表に判断を残す)。`R2ImageSource`は`IMAGES_BUCKET`だけを読む。`WorkersCachePurger`は`@injectable`。`purgeObjectKeys`の拒否でテストにworkerdの「Uncaught (in promise)」「hung」が出るのはvitest-pool-workersのRPCの中継の副作用。本番の名前付きエントリポイントで`ctx.cache`が使えパージが効くか、`exports`の設定がデプロイで受け付けられるか(U-3)は10.1・stagingで確かめる。ローカルの簡易版のImages Bindingはsharpが無いと9523。`infra/004`のカテゴリの表に7.1の`relocation`・`purge`の行がまだ無い
- 7.4: 関門は`apps/event/src/presentation/media/image-gateway-module.ts`の`createImageGatewayModule`(`MODULES`の先頭)、判定は`image-request-match.ts`の`matchImageRequest`で、IP制限の除外`isImageDeliveryRequest`(`composition/rate-limit-exclusions.ts`)も同じ判定を使う。委譲は`new Request(origin + path, { method })`で`ctx.exports.ImageDelivery.fetch`へ(クエリ文字列とヘッダーを落とす)。405は`method_not_allowed`(文言規則の文言の短い形。9.2でそろえる)。専用ホストの`/health`は`createWorkerApp`がモジュールより前に登録するため200になる(要件10.12の既知の例外として記録するかは開発者の判断待ち。9.1の`infra/008`に書く)。画像のURLへのPOSTも数えずに405になる。末尾にドットの付いたホスト名は`not-image-host`扱い(stagingで確かめる)
- 7.5: 経路は`apps/event/src/presentation/media/media-smoke-routes.ts`、AppModuleと束縛は`composition/media-smoke-module.ts`の`MEDIA_SMOKE_MODULE`(設計の`presentation/media/media-smoke-module.ts`1つではない。presentationがinfrastructureの部品を読めないため)。7.6で`createMediaPlatformModule('event')`と一緒に`MODULES`へ登録する。トークンの照合と404・401は`presentation/smoke/smoke-access.ts`の`matchesSmokeToken`(SHA-256の値を`crypto.subtle.timingSafeEqual`で比較)へ共通化し、メールの疎通確認の`email-smoke-route.ts`もこれを使う(Boundary外の変更、振る舞いは不変)。状態の取得の`findings`のため`ModerationFindingsReader`のポート(`EVENT_MEDIA_TYPES`の6つ目)と`infrastructure/media/d1-moderation-findings-reader.ts`を足し、backend-libの`d1-media-file-store.ts`の`toModerationFindings`を公開して使う(`media_files`の2つ目の読み手で、`moderation_detail`の形を変える時は両方を直す既知の結合)。202は本文無しで`no-store`。経路は自前のログを出さない
- 7.6: eventの束縛は`apps/event/src/composition/media-module.ts`(`EVENT_MEDIA_PLATFORM_MODULE`・`EVENT_MEDIA_MODULE`)、環境の検証は`composition/media-env.ts`(`rekognition`の時だけ`REKOGNITION_*`必須、`MEDIA_SMOKE_TOKEN`任意、判定の値は判定の処理と同じ解析関数)。3つのメッセージの処理の識別子は`application/media/media-handler-types.ts`の`EVENT_MEDIA_HANDLER_TYPES`(設計のFile Structure Planに無い)。`MODULES`は関門→共通のメディア→eventのメディア→`MEDIA_SMOKE_MODULE`の順。`ModerationFindingsReader`は`MEDIA_SMOKE_MODULE`だけが束縛する。通しのテスト`media-module.worker.test.ts`はQueueの送信を記録用の偽物に差し替え`createMessageBatch`でエントリの`queue`へ流す(パージは`ctx.cache`が無く`skipped`、404は原本が画像用バケットに無いことによる)。eventの全体の`test:worker --coverage`は既定の並列数でコンテナのメモリ不足になり得る(`--maxWorkers=4`で成功)。`wrangler deploy --dry-run`は権限で拒否され、Workerの大きさは開発者が確かめる
- 8.1: 中継の経路は`apps/frontend-lib/server/media/media-relay-routes.ts`の`UPLOAD_RELAY_ROUTE`・`FILE_DOWNLOAD_RELAY_ROUTE`(接頭辞より後ろを1度復号し`encodeURIComponent`で1区画に符号化し直す。不正な符号化は文字のまま符号化しAPIが404)。client・adminの`RELAY_ROUTES`はGraphQL→アップロード→ダウンロード。公開設定に`imagesOrigin`。frontend-libの単体テストが経路の定義を読むと`common-lib/media/media-types.ts`・`upload-protocol.ts`がカバレッジの分母に入るため、`config/common-lib-reference.unit.test.ts`が両ファイルの全関数を呼ぶ(8.2などで関数を加える時はこのテストも直す)。流しながらの中継で`Content-Length`が残るか(research.mdのU-1)はBunの単体テストだけで確かめ、workerdでの確認は10.1かstaging。`frontend/003`の`/*`の経路の例は接尾辞をそのまま渡しており、9.xで符号化し直す注記を検討する
- 8.2: 純粋な関数は`apps/frontend-lib/utilities/media/`。`checkSelection(files, constraints, { editedTypes })`の第3引数は設計に無い追加で、挙げた形式は選択の時点でサイズを判定せず合計にも数えない(14.4・14.7・14.8の両立)。8.5は、選択の時点で`editedTypes`に画像4形式(SVG以外)を渡して呼び、編集ダイアログで作り直した後に作り直したファイルと編集しなかったSVG等で`editedTypes`無しにもう一度呼び、作り直した画像のサイズ違反は`croppedFileTooLargeMessage(constraints)`、合計の違反は`selectionViolationMessage`で文言にする。想定外の応答には`UnexpectedUploadResponseError`(エラートラッキングへ送るかは8.5で決める)。プレースホルダーの配色は`styles/tokens.css`の`--placeholder-1`〜`-12`と`--placeholder-N-foreground`(ライト・ダーク)で、`placeholderAppearanceOf`は`var(--…)`を返す。8.6の`MediaPlaceholder`はこの値を`style`で当てる(`@theme inline`には無い。`toaster.tsx`の`TOKEN_STYLE`と同じ)。design.mdの`MediaPlaceholder`の「ハッシュから決めた背景色、白か黒の文字色」は今のトークンの組の方式と表現がずれている。503は設計の表の文言、429と通信の失敗は文言規則の既存の文言(`RATE_LIMIT_MESSAGE`・`NETWORK_ERROR_MESSAGE`と重複)。411・400は再試行可、想定外は再試行不可
- 8.3: 部品は`apps/frontend-lib/components/media/`の`FileDropZone`・`FileSelectionList`・`FileThumbnail`(`INTERNAL_COMPONENTS`)。`FileDropZone`は実の`<button>`で隠したinputを開き(設計の「ボタン風のラベル」と異なる)、`id`を受けず`aria-labelledby`(`FormField`の`control.labelId`)を受けてボタンの文言と並べて名前にする(WCAG 2.5.3)。そのため`FormField`の`<Label htmlFor>`は使われないidを指しラベルの押下でフォーカスが移らない。`ref`を受けない(8.5でエラー時にフォーカスを移すなら加える)。`multiple`が偽でもドロップした複数のファイルを全部渡す(8.5で個数を検査する)。`FileThumbnail`はcanvasに静止画を描く(設計の`<img>`と異なる。動く効果の禁止)。`FileSelectionList`は初回表示を読み上げないので、0件でも描いたままにする。同じファイルの選び直しで識別キーが変わらなければ読み上げない。文言は`utilities/messages/media-selection-messages.ts`(文言規則`003`に追記済み)。サイズの表記は`formatFileSize`
- 8.4: `ImageCropDialog`(`components/media/image-crop-dialog.tsx`、props`file?`・`edit`・`onConfirm`・`onCancel`・`returnFocusRef?`。`file`を渡す間だけ開く)と`encodeCroppedImage`・`readOrientedImageSize`(`encode-cropped-image.ts`、JPEGは品質0.9、他はPNG、Exifは残らない)。`ImageEditOptions`・`CropArea`は`utilities/media/crop-geometry.ts`。`'free'`は原本の縦横比のまま切り取る解釈(開発者の確認待ち)。拡大は1〜3倍。切り取る範囲の輪郭は`focus-visible:-outline-offset-4`で内側へずらす(`004`に汎用の例外を追加)。8.5は`FileDropZone`にrefを加えて`returnFocusRef`へ渡す(ドラッグ&ドロップで選ぶとフォーカスが選択のボタンに無い)。`react-easy-crop`はStorybookの起動時の走査で事前バンドルに入り、`.storybook/main.ts`は不変
- 8.5: `useFileUpload`・`ImageUploadField`・`AttachmentUploadField`・`UploadFieldFrame`(`INTERNAL_COMPONENTS`)は`apps/frontend-lib/components/media/`。設計の`UploadState`と違い、編集中の状態は入力欄が持ち、`FileUploadState`は複数のファイルと送れた件数(`completed`)を持つ。`FileDropZone`に`ref`・`pending`を加えた。`multiple`が偽の欄は`selectionConstraintsOf`が`maxCount: 1`・`existingCount: 0`で呼び出し元の値を上書きする(置き換えの意味。`existingTotalBytes`は0に戻さない)。複数の画像の編集の途中で取り消すと選択全体を捨てる(開発者の確認待ち)。`UnexpectedUploadResponseError`は`reportUnexpectedErrorInBrowser(error, 'render')`で送る(ブラウザでは送信元を使わない)。フォームはReact Hook Form(`useAppForm`)。文言規則`003`には「編集後の画像のサイズ超過」と状態・読み上げの文言を加えた(9.2で残りのアップロードの文言を加える時は二重に加えない)
- 8.6: `MediaPicture`・`MediaPlaceholder`(`INTERNAL_COMPONENTS`)・`PrivateFileLink`・`useImagesOrigin`は`apps/frontend-lib/components/media/`。ハイドレーション前に読み込みに失敗した画像は、refの時点の`complete && naturalWidth === 0`で検出する(設計に無い。`decode()`はWebKitで読めた画像でも拒否するため使わない。寸法の無いSVGの`naturalWidth`が0にならないことはChromiumでだけ確認)。`MediaPlaceholder`のpropsは`kind`・`placeholder`・`alt`・`size`・`className`で、`alt`が空なら`aria-hidden`。`picture-sources.ts`の`pictureSizeOf`・`PictureSize`を公開。テストは`test/served-media-images.ts`(Git管理外の`.vitest-attachments/`に画像を書いてテストのサーバーで配信)で読み込みの成功を確かめる。Storybookの画像のストーリーはローカルのイベントサーバー(48043)が配信していなければ失敗のプレースホルダーになる
- 9.1: 技術文書は`docs/GUIDES/tech/external/003-image-moderation.md`・`infra/008-image-delivery.md`・`security/005-file-upload-security.md`。SVGの許可リストの正は`security/005`の3つの表で、`svg-allowlist-document.unit.test.ts`はそこと照合する(design.mdの「SVGの許可リスト(初版)」は実装の調整を含まない古い表)。9.3で`project-values.md`に対応付ける新しいプレースホルダー: `<判定の実装の変数>`・`<判定のリージョンの変数>`・`<判定のリージョン>`・`<判定の閾値の変数>`・`<判定のカテゴリの変数>`・`<判定サービスの資格情報のシークレット>`・`<判定のIAMポリシー名>`・`<判定のIAMユーザー名>`・`<AWSのアカウントID>`・`<画像配信のホスト名の変数>`・`<専用ホストの変数>`・`<画像配信のホスト名>`・`<画像配信のオリジン>`・`<画像用非公開バケットのバインディング>`・`<ファイル用非公開バケットのバインディング>`・`<隔離バケットのバインディング>`・`<画像変換のバインディング>`・`<画像の動作確認の経路>`・`<動作確認のトークンのシークレット>`。`infra/README.md`の「範囲」と`docs/GUIDES/tech/README.md`のサブディレクトリの表、CLAUDE.mdのディレクトリ構成の説明に画像配信・画像判定がまだ無い(9.3でそろえる)。`/health`の既知の例外・`filename`の`%`・カテゴリの厳格な検証は、開発者の確認待ちの事項を文書では既知の挙動として書いている
- 9.2: 文言規則にはコードと設計の503の文言(「しばらく待ってから再度お試しください。」)を載せた(既存の中継先の障害は「時間をおいて再度お試しください。」で食い違う)。503の定数の1か所への集約(4.4・4.5・7.2の申し送り)はコードの変更のため行っていない。画像配信の405の短い文言は画面に出ないため文言規則に載せていない。国外移転の`### AWS(Rekognition)`(アンカー`#awsrekognition`)と委託先の一覧の「Amazon Web Services(Rekognition)」の表記がそろっていない。`docs/onboardings/tech-stack.md`の226行目の「Exif削除」は決定Q1と食い違う(9.3で直す)
- 9.3: 固有の値は`docs/onboardings/project-values.md`の節「画像のアップロード・判定・配信」とプレースホルダーの表(9.1の19個。IAMのポリシー名・ユーザー名・AWSのアカウントIDは未定で開発者が記入)、動作確認の経路の手順はオンボーディング`docs/onboardings/README.md`の「画像のアップロード・判定・配信」の節(10.1はこの手順で行う。確認用の画像はWranglerが間接に入れる`sharp`で作る)。`infra/004`のカテゴリの表に`['api','media','download']`と日次ジョブ3件(`expired-file-erasure`・`moderation-requeue`・`location-reconciliation`)の行が無い(未対応)
- 10.1(2026-11-01、ローカルの`wrangler dev`): 通常の画像(640×640のPNG)はアップロード201・`passed`・`images`、`square-sm.webp`は200(`image/webp`・64×64)、`screenshot-full.avif`・ラスターの`.svg`・未定義のバリアントは404、HEADは200・POSTは405、隔離202で404(`["admin_action"]`)、解除202で200。99×99のPNGは201・`flagged`・`quarantine`・`["auto"]`・Explicit 99で404、解除を送っても自動判定の理由のため404のまま。320×240のGIF・`<text>`のSVG・`<use href>`のSVGは`passed`で配信(SVGはCSPと`nosniff`付き)、99×99のGIF・SVGは`flagged`。8件の削除は202で、以後の状態の取得と画像は404、D1の`media_files`0件・R2の3バケットは空。`exports`は`wrangler dev`で受け付けられ`ctx.exports.ImageDelivery`の委譲とパージのRPCは動く(ローカルはキャッシュ無し)。見つけて直した点: パージのログの件数の属性`objectKeys`が伏せ字の規則`/key/i`で`[REDACTED]`になるため`purgedCount`に改めた。eventの`.ttf`の規則に`fallthrough: true`(既定の規則が無視される警告)。オンボーディングの手順に`cd`と`relocation`のログの補足。stagingに残る確認: 本番の`ctx.cache`とパージの効果、デプロイでの`exports`の受け付け(U-3)、中継で`Content-Length`が残るか(U-1)。他のメディアのハンドラーの単体テストのログの検査は伏せ字の前のプロパティを見ている
- 10.2(2026-11-01): `bun run check`(25成功)・`check:test-names`・`shared-dirs:verify`・ルート`test:unit`・CIの`quality`の残り・`test:all:unit --coverage`・`test:all:browser --coverage`成功。`test:all:worker --coverage`はCIと同じくdevのシークレットを注入するとeventの動作確認の経路の「未設定」のテストが注入したトークンで失敗したため、本specの`media-smoke-module.worker.test.ts`とemail-deliveryの`email-smoke-route.worker.test.ts`の`env`でキーを`undefined`で上書きした(注入あり・なしで成功。`testing/001`に注意を追記)。eventの全体のWorkers統合テストは既定の並列数(14 CPUで13)ではメモリ不足でSIGKILL、`--maxWorkers=4`で492件成功(CIのランナーでは並列数が少なく起きにくい見込み、最初のCIで確かめる)。全アプリのlcovで行・関数80%未満は0件(本specの最低は行`file-thumbnail.tsx` 92.68%・関数`upload-receiver.ts` 89.29%)。`infra/004`のカテゴリの表にapiの`download`と日次ジョブ3件を追加。コンテナの共有ディレクトリがbind mountでなくコピーのため、カバレッジの出力の後に`shared-dirs:verify`が失敗する(`shared-dirs:place`で解消)
