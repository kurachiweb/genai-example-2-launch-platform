# Implementation Plan

- [ ] 1. 基盤: テンプレートの依存・メールのテーブル・Wrangler設定
- [x] 1.1 イベントサーバーにReactとReact Emailを版固定で導入し、workerd上で描画できることを確かめる
  - backend-platformの全タスクが完了していることを前提とする(層構成・登録箇所・受信部・Workers統合テストの設定がある状態)
  - 先に、日本語の文を含む最小の要素を`@react-email/render`でHTMLとテキストにするWorkers統合テストを書き、失敗を確かめてから導入する(5.7で描画処理のテストに置き換える)
  - react 19.3.0・react-dom 19.3.0・@react-email/components 1.0.12・@react-email/render 2.1.0、開発用に@types/react 19.3.0・@types/react-dom 19.3.0を、イベントサーバーだけに完全に固定した版で導入する
  - イベントサーバーの型検査設定でJSXとReactの型を有効にし、TSXのファイルを対象に含める。テスト環境が`@react-email/render`のworkerd向けの出力を解決しない場合は、解決の条件をテスト設定に加える
  - 両アプリの静的解析設定に、メールの描画とテンプレート以外の位置(apiの全体、eventの他の層、共有ディレクトリ)でのReactと`@react-email/*`のimportの禁止を加え、層の規則の単体テストに違反例を足す
  - 同じ変更で、tech-stack.mdの「メール」のJSX emailをReact Email(`@react-email/components`・`@react-email/render`)へ置き換え、依存の版の一覧にReact系とReact Emailを加える
  - 完了状態: 最小の描画のWorkers統合テストがworkerd上で日本語のHTMLとテキストを返して成功し、両アプリの静的解析・型検査と層の規則の単体テストが成功し、tech-stack.mdにJSX emailが残っていない
  - _Requirements: 3.3, 11.1, 11.3, 11.9_

- [x] 1.2 抑止リスト・送信済みの記録・警告の間引きのテーブルを定義し、マイグレーションを生成する
  - 先に、3テーブルの列の型・NOT NULL・一意制約・大文字小文字を区別しない列・共通カラムを確かめる単体テストを書く
  - 抑止リストは照合キー(大文字小文字を区別しない一意の列)・最後の契機の種類と日時・期限(NULLは期限なし)だけを持ち、最後の契機の日時と期限に索引を付ける
  - 送信済みの記録は送信要求の識別子(封筒のIDを明示して入れる主キー)・種別・送信日時だけを持ち、宛先・本文・入力を持たない。送信日時に索引を付ける
  - 警告の間引きは一意の名前と最後に通知した日時を持つ
  - スキーマの集約点に3テーブルを加え、マイグレーションを生成する
  - 完了状態: 列の単体テストが成功し、生成したマイグレーションがマイグレーションの検出確認のコマンドで検出され、ローカルに適用できる
  - _Requirements: 8.2, 8.6, 10.3_

- [x] 1.3 イベントサーバーのWrangler設定にメールの項目を加え、設定の整合を単体テストで保証する
  - 先に、環境ごとの実効値で、メールの変数の有無と値、送信元のドメインが決定事項の送信ドメインと一致すること、staging・prodだけにある送信バインディングと送信元の許可リスト、stagingの宛先制限の方針と必須シークレット、prodの方針、メールイベント用Queueのconsumerの再試行上限とデッドレター、変数にシークレットにすべき項目が無いことを確かめる単体テストを書く
  - 設計の表どおりに、3環境の変数(送信プロバイダ・送信元・宛先制限の方針・メールイベント用Queueの名前、ルートだけMailpitのURL)、staging・prodの送信バインディング、stagingの必須シークレット、メールイベント用Queueのconsumerを、継承されないキーは環境ごとに書く
  - Workers統合テストの設定に、テスト用の変数(MailpitのURL・送信元・Queueの名前)を加える
  - 実行時の環境の型を生成し直してコミットする
  - 完了状態: メールの設定の単体テストとbackend-platformの設定の単体テスト、型生成の検査が成功する
  - _Requirements: 4.2, 7.10, 10.2_

- [ ] 2. 共有の純粋な部品(Bunの単体テスト)
- [x] 2.1 (P) メール種別の契約・集約点・疎通確認用の種別を作る
  - 種別は名前・分類(トランザクションか通知か)・テンプレート入力の検証規則を持ち、名前は`<ドメイン>.<名詞句>`の形式とする
  - 集約で名前の形式違反と重複を例外にし、全種別の集約点を用意する。初版は疎通確認用のトランザクションの種別(入力は受付日時)だけを持つ
  - 完了状態: 形式違反・重複が例外になり、集約点の全種別が例外なく登録できることを単体テストで確かめられる
  - _Boundary: EmailKindRegistry_
  - _Requirements: 1.3, 2.1, 2.2_

- [x] 2.2 (P) 送信要求の本文・宛先・追加ヘッダーの検証と、`email.send`の契約を作る
  - 宛先は254文字以内のWHATWG形式で1件に限り、照合キー(前後の空白を除いた小文字)を作る部品を用意する
  - 追加ヘッダーは許可リスト(配信停止系・自動送信の表示など)に限り、改行を含む値、HTTPSのURIを含まない配信停止ヘッダー、ワンクリックの定型以外の値、1値と合計の大きさの超過を拒否する
  - 種別・宛先・入力・任意の送信期限・任意の追加ヘッダーを持つ本文の契約と大きさの上限を定め、メッセージ契約の集約点に登録する
  - 完了状態: 255文字の宛先・改行入りのヘッダー・許可外のヘッダー・HTTPの配信停止URI・上限超過の本文が拒否され、照合キーが小文字になり、メッセージ契約の集約点に種別の重複が無いことを単体テストで確かめられる
  - _Boundary: EmailSendContract_
  - _Requirements: 1.2, 1.3, 1.6, 1.7, 1.8, 8.2_

- [x] 2.3 (P) 送信プロバイダの結果の型、失敗コードの分類、送信前後の判定を作る
  - 結果を送信済み・送信レートの上限・日次上限・一時的な障害・宛先の抑止・環境の宛先制限・恒久的な失敗に分け、Email Sendingの失敗コードを設計の表どおりに分類する。未知のコードとコード無しは一時的な障害とする
  - 送信前の判定で、送信期限ちょうどとそれ以降を期限切れにする
  - 送信結果から、完了・待機(上限ごとの間隔)・再試行・断念(通知の要否付き)を決め、再試行の方針(5回、120秒から倍、上限3600秒)を定数として持つ
  - 完了状態: 表のすべてのコードの分類、試行1〜4回目の一時的な障害が再試行で5回目が通知付きの断念になること、上限が60秒・3600秒の待機になること、宛先の抑止と宛先制限が通知なしの断念になることを単体テストで確かめられる
  - _Boundary: ProviderOutcomeClassifier, DeliveryDecision_
  - _Requirements: 4.4, 5.1, 5.2, 5.3, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4_

- [x] 2.4 (P) 配信不能イベントの検証と、抑止の効果・合成・有効判定を作る
  - 先に、Cloudflareの文書の6種のイベントの例を標本として用意する
  - イベントを検証して恒久バウンス・ソフトバウンス・苦情・受信者側の拒否・その他の拒否・受付後の配送失敗・無視するものに正規化し、件名と配送サーバーの応答を落とす。版の違い・形式の不正・未知の種類は失敗として返す
  - 効果を、恒久バウンスと苦情は期限なしの抑止、受信者側の拒否は7日の抑止、その他の拒否と配送失敗は通知、ソフトバウンスはログだけ、配信成功と再試行中は無視とする
  - 抑止の合成(期限なしが勝つ・期限は遅い方・最後の契機は日時の遅い方、同時刻は強い方)と有効判定、保持の定数(7日・1年・14日)を用意する
  - 完了状態: 標本ごとの正規化と効果、合成のすべての組で順序を入れ替えても同じ結果になり同じ入力の重複で変わらないこと、期限の境界の有効判定を単体テストで確かめられる
  - _Boundary: DeliveryEventParser, SuppressionPolicy_
  - _Requirements: 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 8.3, 9.2, 9.3_

- [x] 2.5 共有ポート・DI識別子と、メール内の日時表記の部品を作る
  - 送信の受付・抑止リストの照会と記録・退会時の削除と日次の後始末・利用者のアドレスの照会口・送信者情報の取得口・送信済みの記録・警告の間引きのポートと、受付の失敗の理由の型を定義する
  - 共有ポートのDI識別子を定義する
  - UTCの日時を「9月15日07:40(UTC)」の形式(日付だけ、年付きの形式も)で表す部品を作る
  - 完了状態: 日時表記の単体テストが月日のゼロ埋め無し・時分の2桁・UTCの日付の境界・年付きの形式で成功し、ポートを参照する2.1〜2.4の部品とともにapiの型検査が成功する
  - _Requirements: 1.1, 3.6, 3.8, 8.1, 9.1, 9.2_

- [x] 3. (P) 封筒を持たないQueueの登録口を、backend-platformの受信部へ互換を保って加える
  - 先に、受信部のWorkers統合テストへ、登録した追加のQueueへの振り分け、例外での間隔付きの再試行、上限での本文を含まないデッドレター通知(種別`raw:<名前>`)、本体・デッドレターと同じ名前の登録の拒否のケースを足す
  - 追加のQueueの登録(名前・Queue名の解決・処理・任意の再試行の方針)と処理の型、名前の検証を共有コードの`core`に作る
  - 受信部に任意の追加引数を加え、一致したQueueのメッセージを1件ずつ新しいコンテナで処理する。引数を省略した場合の振る舞いは変えない
  - 完了状態: 追加したケースと、backend-platformの既存の受信部のテストが変更なしで成功する
  - _Boundary: RawQueueContract, RawQueueDispatch_
  - _Requirements: 7.10_

- [ ] 4. 共有のD1のストアと送信の受付(apiのWorkers統合テスト)
- [x] 4.1 (P) 送信要求を検証してQueueへ送る受付を作る
  - 種別の検索・入力の検証・宛先の検証・追加ヘッダーの検証・送信期限の検証・本文の大きさの確認を行い、`email.send`として送信して送信要求の識別子を返す
  - 失敗は理由ごとの受付の失敗とし、メッセージに宛先と入力の値を含めない。Queueの障害は包まずに伝える
  - 完了状態: 成功時に封筒付きのメッセージが本体のQueueへ1件送られて識別子が返り、各拒否の場合に送られないことをWorkers統合テストで確かめられる
  - _Boundary: EmailSender_
  - _Depends: 2.2, 2.5_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8_

- [x] 4.2 (P) 抑止記録の照会・合成付きの記録・削除・後始末用の検索をD1上に作る
  - 照会は照合キーで正規化し、期限なし・期限内の記録だけを抑止中とする。複数件の照会はバインド変数の上限に合わせて分割する
  - 記録は1つの文の競合時更新で、合成の規則と同値の式により行う
  - 期限切れの削除、最後の契機が基準より古い照合キーの昇順のページ取得、照合キー指定の削除を用意する。削除は対象が無くても成功する
  - 完了状態: 大文字小文字違いの照会の一致、合成の規則の表と同じD1上の結果、期限切れの非抑止、101件以上の複数件照会、削除の冪等性をWorkers統合テストで確かめられる
  - _Boundary: SuppressionRepository_
  - _Depends: 1.2, 2.4, 2.5_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.6, 9.1, 9.5_

- [x] 4.3 (P) 送信済みの記録と警告の間引きをD1上に作る
  - 送信済みの記録は2回目の記録を無害にし、基準日時より古い行を削除できるようにする
  - 間引きは1つの文で、間隔内の2回目以降に偽を返す
  - 完了状態: 同じ識別子の2回目の記録で行が増えず、14日より古い行だけが消え、間隔内の2回目の間引きが偽になることをWorkers統合テストで確かめられる
  - _Boundary: SendRecordRepository, AlertThrottleRepository_
  - _Depends: 1.2, 2.5_
  - _Requirements: 5.4, 6.7, 10.3_

- [x] 4.4 退会時の削除と日次の後始末のサービス、両アプリ共通の束縛を作る
  - 退会時の削除は照合キーで物理削除し、対象が無くても成功する
  - 日次の後始末は、期限切れの抑止記録、14日より古い送信済みの記録、最後の契機から1年を過ぎ利用者に登録されていない抑止記録を削除する。1年の判定は90件ずつ最大20ページで区切り、照会口が使えなければその処理を行わず警告を出して要約に記す
  - 種別の集約・受付・抑止リスト・送信済みの記録・間引きを処理単位のコンテナへ束縛する共通のモジュールを用意する
  - 完了状態: 3種類の削除、照会口が使えない場合に1年の削除が行われず警告と要約が出ること、同じ日の2回目の実行で結果が変わらないこと、共通のモジュールから受付と抑止リストが解決できることをWorkers統合テストで確かめられる
  - _Requirements: 1.1, 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 5. イベントサーバーの送信処理・送信プロバイダ・描画
- [x] 5.1 イベントサーバーのメール処理のポートとDI識別子を定義する
  - 送信プロバイダ(失敗を結果として返す)・描画・異常の通知・送信元の設定のポートと、送信するメール・描画結果・異常の種類の型を定義する
  - イベントサーバーだけで使うDI識別子を定義する
  - ポートは`application`の層に置き、`lib/core/email`の型だけを参照する
  - 完了状態: イベントサーバーの型検査と層の規則の静的解析が成功し、5.2〜5.5がこのポートと共有ポートだけを参照して互いに独立に実装できる状態になっている
  - _Requirements: 4.5_

- [x] 5.2 (P) Email Sending・Mailpit・宛先制限の送信プロバイダと、環境による選択を作る
  - Email Sendingは構造化された送信で、表示名「Launch Stadium」とnoreplyの送信元・宛先・件名・両パート・追加ヘッダーを渡し、返信先を設定しない。30秒の時間切れを一時的な障害とし、例外のコードを分類する
  - MailpitはHTTPの送信APIへ送り、成功・400・それ以外と通信の失敗を分類する
  - 宛先制限は、許可された照合キーに無い宛先を送らずに環境の宛先制限として返す
  - 環境の値で実装を選び、宛先制限の方針なら包む。送信バインディングの偽物と注入する`fetch`で、外部へ送らずに確かめる
  - 完了状態: 送信内容(表示名・送信元・返信先なし・ヘッダー)、各失敗の分類、時間切れ、許可外の宛先を送らないこと、環境ごとの選択をWorkers統合テストで確かめられる
  - _Boundary: EmailProviders_
  - _Depends: 2.3_
  - _Requirements: 1.7, 4.1, 4.3, 4.4, 4.5, 4.6, 6.1, 6.3_

- [x] 5.3 (P) メールの異常のエラートラッキングへの通知と、未設定の送信者情報の既定実装を作る
  - 送信不能・送信側の拒否・配送失敗・不正なイベントはerror、日次上限はwarningで送り、異常の種類・種別・分類・コードのタグと、異常の種類ごと(日次上限は1つ)のfingerprintを付ける。宛先・件名・本文・入力・URLを送らない
  - 送信者情報の取得口の既定実装として、常に未設定を返すものを用意する
  - 完了状態: 差し替えたトランスポートでタグとfingerprint、個人情報を含まないことを確かめ、既定の送信者情報が未設定を返すことをWorkers統合テストで確かめられる
  - _Boundary: EmailIncidentReporter, SenderInfoDefault_
  - _Requirements: 2.4, 3.6, 3.7, 5.4, 6.2, 6.3, 6.5, 6.8, 7.4, 7.8_

- [x] 5.4 (P) `email.send`の送信処理を作る
  - 先に、偽物のポートで各分岐の単体テストを書く
  - 重複(送信済み)・送信期限切れ・未登録の種別・入力の不正・通知メールの抑止中を送信前に判定する。トランザクションメールは抑止リストを照会しない
  - 送信者情報を取得して描画し、描画の失敗は送信不能として通知する。送信結果の判定に従い、完了時の記録(失敗はログにとどめる)、待機(日次上限は間引き付きの警告)、再試行の例外、断念(通知の要否に従う)を行う
  - 結果ごとに種別・分類・送信要求の識別子・試行回数・所要時間をログに出し、宛先・件名・本文・入力・URLを含めない
  - 完了状態: 各分岐の結果・ポートの呼び出し・返り値(完了・待機・例外)と、ログに個人情報が含まれないことを単体テストで確かめられる
  - _Boundary: SendEmailHandler_
  - _Depends: 2.3, 2.5_
  - _Requirements: 1.5, 2.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 6.8, 8.4, 8.5, 10.1_

- [x] 5.5 (P) 配信不能イベントの処理を作る
  - 先に、偽物のポートで効果ごとの単体テストを書く
  - 検証の失敗は警告と通知を出して正常に終える。抑止は記録、通知の効果は異常の通知、ソフトバウンスはログ、無視するものは詳細ログとする。保存の失敗は例外にして再試行に任せる
  - 完了状態: 効果ごとのポートの呼び出し、不正なイベントで記録しないこと、保存の失敗が例外になることを単体テストで確かめられる
  - _Boundary: DeliveryEventHandler_
  - _Depends: 2.4, 2.5_
  - _Requirements: 6.5, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

- [x] 5.6 (P) テンプレートの定義と集約、共通レイアウトの部品を作る
  - テンプレートは種別・件名・冒頭の文・宛名・任意の行動ボタン・任意の配信停止のURL・本文の部品を持つ。集約で種別の集約点と1対1でなければ例外にする
  - 共通レイアウトは日本語の言語指定を持ち、宛名・本文・行動ボタン・配信停止(通知メールでURLがあるときだけ)・送信者情報(未設定なら省略)の順に並べる。画像・外部スクリプト・計測用のURLを置かない
  - 宛名・行動ボタン・配信停止・送信者情報をそれぞれ1ファイル1コンポーネントで作る
  - 完了状態: 配置の順序、宛名と送信者情報の省略、通知メールだけの配信停止区画、画像とスクリプトが無いこと、種別とテンプレートの対応の欠けで例外になることをWorkers統合テストで確かめられる
  - _Boundary: EmailRendering_
  - _Depends: 1.1, 2.1, 2.5_
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.4, 3.5, 3.6, 3.7, 3.10_

- [x] 5.7 描画処理と疎通確認のテンプレートを作り、workerd上で日本語の両パートを確かめる
  - 同じ要素からHTMLとテキストを生成し、件名はテンプレートが定めたものを接頭辞なしで使う。対応するテンプレートが無ければ描画の失敗にする
  - 疎通確認のテンプレート(件名「メール送信の確認」、受付日時のUTC表記と日本語の段落、宛名なし)を作り、テンプレートの集約点に登録する
  - 1.1の最小の描画テストを描画処理のテストに置き換える
  - 完了状態: workerd上で日本語の件名・本文、`lang="ja"`、テキストパートに同じ文言とURL、`<script>`入りの入力のエスケープ、全種別のテンプレートの存在と、20件の描画の所要時間の記録をWorkers統合テストで確かめられる
  - _Boundary: EmailRendering_
  - _Requirements: 3.2, 3.3, 3.4, 3.9, 11.3_

- [ ] 6. 統合: 登録・経路・定期実行
- [x] 6.1 イベントサーバーのメールの束縛と登録を組み立て、Queueからの送信と抑止の記録を通しで確かめる
  - 先に、`email.send`のバッチから日本語の件名と両パートがMailpitの宛先への要求に含まれること、メールイベント用Queueのhard bounceが抑止リストに記録されて同じバッチの再送で変わらないことを確かめるWorkers統合テストを書く
  - 環境の検証に、送信プロバイダ・送信元・宛先制限の方針・Queueの名前と、方針に応じた条件付きの必須キー(MailpitのURL・送信バインディング・許可する宛先)を加え、欠けたキー名だけを報告する
  - 送信プロバイダ・描画・送信者情報の登録箇所(初期値は未設定の既定実装)・異常の通知・送信元の設定・2つの処理を束縛するモジュールを作り、共通のモジュールとともに登録する
  - `email.send`の処理を再試行の方針付きで、配信不能イベントの処理を追加のQueueとして登録し、エントリから受信部へ渡す
  - 完了状態: 通しのWorkers統合テストと、環境の検証が条件付きの必須キーの欠落をキー名だけで報告するテストが成功し、backend-platformのeventのテストも成功する
  - _Depends: 1.3, 3, 4.4, 5.2, 5.3, 5.4, 5.5, 5.7_
  - _Requirements: 1.1, 1.5, 3.3, 4.1, 4.2, 7.1, 7.7, 7.10_

- [x] 6.2 疎通確認の経路を作る
  - 先に、未設定の環境で404、トークンの不一致で401、成功で202と`email.send`の送信が起きることを確かめるWorkers統合テストを書く
  - トークンと宛先の両方のシークレットがある環境だけで有効にし、トークンは両者のSHA-256を時間一定で比較し、宛先はシークレットの値に固定する
  - イベントサーバーのメールのモジュールに経路を登録する
  - 完了状態: 経路のWorkers統合テストが成功し、要求の本文から宛先を受け取らないことを確かめられる
  - _Requirements: 3.3, 10.2, 11.4, 11.5_

- [ ] 6.3 (P) APIサーバーのメールの束縛、利用者のアドレスの照会口の既定実装、日次の後始末のジョブを登録する
  - 先に、ジョブが後始末を呼んで要約をログに出す単体テストを書く
  - 照会口の登録箇所を用意し、初期値は常に「使えない」を返す既定実装とする
  - 共通のモジュールに加えて、後始末のサービス・照会口・ジョブを束縛するモジュールを登録し、ジョブを業務時刻4:21(順序900)で登録して3環境の定期実行の定義に対応するcron式を加える
  - 完了状態: ジョブの単体テストとbackend-platformのcronの一致の検査が成功し、ローカルでその時刻の定期実行を手動で起こすと後始末の要約(照会口が使えないための省略を含む)がログに出る
  - _Boundary: EmailCleanupJob, ApiEmailComposition_
  - _Depends: 4.4_
  - _Requirements: 1.1, 9.2, 9.3, 9.4, 11.1_

- [ ] 7. 技術ドキュメントと関連文書
- [ ] 7.1 (P) メール送信サービスの技術ドキュメントを追加し、非同期処理の文書へ追記する
  - 送信の使い方(構造化された送信と両パート)、上限と料金の要点、失敗コードの分類表、待機と再試行の間隔と送信不能までの最長時間(約30分)、配信不能イベントの種類と購読、抑止の方針、ローカルの受信箱(送信APIと検索API)、送信内容のプレビューを無効にする手順、送信元の固定と宛先の制限、疎通確認の手順を、固有の値をプレースホルダーにして書き、索引に1行加える
  - 非同期処理の文書に、メール送信の経路、上限による待機と送信期限、封筒を持たないQueueの登録口を追記する
  - 完了状態: 2つの文書にプロジェクト名・固有の値が無く、記載した間隔・回数・期限が実装の定数と一致する
  - _Boundary: EmailDocs_
  - _Requirements: 6.9, 10.4, 11.6, 11.7, 11.8_

- [ ] 7.2 (P) サービス仕様の保持期間・本プロジェクト固有の値・オンボーディング・CLAUDE.mdの参照先を更新する
  - データ保持期間の一覧に、抑止記録(期限なしは登録した利用者の退会まで、利用者に紐づかないものは最後の契機から1年、拒否による期限付きは期限まで)と送信済みの記録(14日)の行を加える
  - 本プロジェクト固有の値に、送信ドメイン・送信元・表示名・Queue名・変数とシークレットのキー名・疎通確認の経路を加える
  - オンボーディングに、Mailpitでの確認、疎通確認の経路の使い方、Infisicalへのシークレットの登録を加える
  - CLAUDE.mdの「技術規則の参照先」に、メールを送る処理を書く前に読む文書へのリンクを加える
  - 完了状態: 各文書の記載が設計の値と一致し、リンク切れが無い
  - _Boundary: EmailDocs_
  - _Requirements: 11.8, 11.10, 11.11_

- [ ] 8. 検証と引き継ぎ
- [ ] 8.1 ローカル環境でイベントサーバーを起動し、疎通確認の経路からMailpitへの到着を確かめる
  - Infisical(dev)に疎通確認のシークレットが無ければ、開発者へ登録を依頼して止まる(AIエージェントはInfisicalへ書き込まない)
  - オンボーディングの手順どおりにシークレットを注入してイベントサーバーを起動し、疎通確認の経路を呼ぶ
  - Mailpitの画面またはAPIで、日本語の件名・本文、HTMLとテキストの両パート、表示名と送信元を確かめる
  - 完了状態: Mailpitに疎通確認メールが1通届き、件名・本文が文字化けせず両パートを持つことを確かめた記録が残る
  - _Requirements: 3.3, 11.4_

- [ ] 8.2 一括検査とカバレッジ80%を確かめ、開発者の手作業とstagingでの確認を引き継ぐ
  - ルートの一括検査と一括テストを実行し、api・eventの単体テストとWorkers統合テストで行と関数のカバレッジ80%以上を確かめる
  - 開発者の手作業(送信ドメインの登録と送信内容のプレビューの無効化、メールイベント用Queueと購読の作成、stagingの宛先の検証と許可する宛先・疎通確認のシークレットの登録、デプロイ後のstagingでの疎通確認)を、実行するコマンドや画面の操作とともに報告にまとめる
  - 完了状態: 一括検査と一括テストが成功してカバレッジが閾値を満たし、手作業の一覧が報告に含まれている
  - _Requirements: 11.1, 11.2, 11.5_

## Implementation Notes

- 1.1: `@react-email/components`1.0.12は`@react-email/render`2.0.6を入れ子の依存に持つ。描画は直接宣言した`@react-email/render`2.1.0から`render`をimportし、`@react-email/components`の再エクスポートを使わない。
- 1.1(5.xへの申し送り): eventのWorkers統合テストのカバレッジの`include`は1.3で`{ts,tsx}`にした。`jsx: "react-jsx"`が暗黙に読み込む`react/jsx-runtime`は静的解析の禁止で検出しないため、`.tsx`は`infrastructure/email/rendering`・`templates`だけに置く。
- 1.1: eventの静的解析は`lib/`・`db/`を無視するため、共有ディレクトリでのReactの禁止はapiの静的解析(`**/*.{ts,tsx}`)で担保している(設計のModified Filesの「eventの`lib/**`で禁止」との相違)。
- 1.2(4.3への申し送り): `email_send_records.id`は`ulidPrimaryKey()`のためid省略時にULIDが採番される。送信済みの記録のリポジトリは必ず封筒のIDを明示して入れ、Workers統合テストでそれを確かめる。
- 1.2(4.2への申し送り): `email_suppressions.last_reason`の値の組(`hard_bounce`・`complaint`・`rejected`)はDBスキーマと`core/email`の`SuppressionReason`の2か所にある。リポジトリで`emailSuppressions.$inferSelect['lastReason']`と`SuppressionReason`が相互に代入できることを型で保証する。
- 1.2: テーブル定義は`schema/<ドメイン>/<テーブル>.ts`に置く(技術ドキュメントのdb/001・003を全下流specの設計に合わせて改めた)。
- 1.3(2.3への申し送り): `apps/api/test/config/email-wrangler-config.unit.test.ts`は、メールイベント用Queueのconsumerの`max_retries`を`QUEUE_MAX_RETRIES`との一致と`DEFAULT_RETRY_POLICY.maxAttempts`超過だけで検査している。2.3で`EMAIL_SEND_RETRY_POLICY.maxAttempts < max_retries`の検査を加える。
- 1.3(6.2・8.1への申し送り): `secrets`を定義した設定では`wrangler dev`が`secrets.required`のキーだけを`env`へ渡すため、設計の表どおりでは`EMAIL_SMOKE_TOKEN`・`EMAIL_SMOKE_RECIPIENT`がローカルの`env`に入らず、疎通確認の経路が常に404になる。6.2でルートの`secrets.required`へ2つのキーを加え(staging・prodには加えない)、設計の表と`email-wrangler-config.unit.test.ts`の期待値を改める。
- 1.3: テスト用の`EMAIL_EVENTS_QUEUE_NAME`は`genai-example-2-email-events-test`でローカルのconsumerの名前と異なる。振り分けのWorkers統合テストでは`batch.queue`に`env.EMAIL_EVENTS_QUEUE_NAME`を使う。backend-platformの`wrangler-config.unit.test.ts`は`EMAIL_`・`MAILPIT_`で始まるキーを除いて比べ、それらはメールの設定のテストが厳密に検査する。
- 2.1: 種別の検索は`createEmailKindRegistry(EMAIL_KINDS).get(name)`(未登録は`undefined`)。疎通確認の種別は`EMAIL_DELIVERY_SMOKE_KIND`で、入力`requestedAt`は`z.iso.datetime()`(末尾`Z`のUTCだけ)。集約は名前の形式・重複に加えて分類の不正と入力スキーマの欠落も`EmailKindRegistryError`にする(要件2.2)。
- 2.2(4.1への申し送り): 本文の大きさの判定は`isWithinEmailSendBodyLimit(body)`(JSONにしたUTF-8が`MAX_EMAIL_SEND_BODY_BYTES`以下か)を使う。追加ヘッダーは名前の大文字小文字を区別せずに照合し、大文字小文字だけ違う重複は`too-many`、空の値と`List-Unsubscribe`の無い`List-Unsubscribe-Post`は拒否する。`List-Unsubscribe`はカンマで単純に分割するため、URIにカンマを含む値は拒否される。
- 2.3(5.4・6.1への申し送り): 再試行の間隔は受信部が登録の`retry`の方針で決め、`decideAfterOutcome`は`EMAIL_SEND_RETRY_POLICY`で回数を判定する。`MESSAGE_HANDLERS`の`email.send`の登録に`retry: EMAIL_SEND_RETRY_POLICY`を渡し、Workers統合テストで確かめる(既定の方針のままだと再試行が30秒から始まる)。
- 2.3: `decideAfterOutcome`は試行回数の検証のため結果によらず先に`decideOnFailure`を呼び、不正な回数ではどの結果でも`RangeError`になる。コード無しの一時的な障害は`UNKNOWN_SEND_ERROR_CODE`(`'unknown'`)。`E_ACCOUNT_SUSPENDED`は設計の表に無いため未知のコードとして一時的な障害に分類している(開発者の判断待ち)。設定の検査は`EMAIL_SEND_RETRY_POLICY.maxAttempts`を本体とメールイベント用の両方のQueueのconsumerの`max_retries`と比べる(設計のEmailConfigChecksとDeliveryDecisionで比べる対象が食い違うため)。
- 2.4(4.2・5.5への申し送り): `SUPPRESSION_REASONS`とDBスキーマの`last_reason`の一致は`core`の単体テストでは定数の比較だけなので、4.2のリポジトリで型の相互代入を保証する。配信不能イベントの理由は`^[A-Za-z0-9_.:-]{1,64}$`に合わなければ`'unknown'`に置き換わり、`rejection`・`failure.reason`の欠けも`'unknown'`で受け付ける。検証の失敗時の`type`は生の文字列で長さの上限が無いため、5.5でログの属性に入れるときは切り詰める。
- 2.5(4.1への申し送り): `EmailSendError`は下流のapplication層が`instanceof`で見分けるため`core/email/ports.ts`に定義した(コンストラクタは`(reason)`だけで、メッセージは理由ごとの固定文)。4.1はこれを`core/email/ports.ts`からimportして投げる。
- 2.5(5.6・5.7への申し送り): `formatUtcDateTime`・`formatUtcDate`は任意の第2引数`{ withYear?: boolean }`を取り、無効な`Date`では`RangeError`を投げる。テンプレートで日時を表示するときはマークアップ規約の日時の表示(`<time dateTime>`)に従って包む。
- 3(6.1への申し送り): 追加のQueueの登録は`createQueueDispatcher(..., { rawQueues })`で渡し、最初の`dispatch`で`assertRawQueueRegistrations`が検証する。登録が誤っていると本体のQueueを含む全バッチが例外になる(Sentryで検知)。名前は`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`、Queue名の解決結果が空・`undefined`でも拒否する。新しいケースは既存の`queue-consumer.worker.test.ts`(800行の上限に近い)ではなく`queue-consumer.raw-queues.worker.test.ts`に置いた(設計のTesting Strategyとの相違)。
- 4.1(4.4への申し送り): 受付はファクトリ`createEmailSender(publisher, registry)`で、`workers`の他の部品と同じく`toDynamicValue`で束縛する。宛先は照合キーにせず元の値のまま送る(正規化は抑止リスト側)。年0000〜9999外の期限は`invalid-deadline`、過去の期限は受け付ける(送信処理が期限切れとして扱う)。
- 4.2(4.4への申し送り): 抑止リストはファクトリ`createSuppressionRepository(db, clock)`で、`SuppressionList`・`SuppressionRecorder`・`SuppressionStore`の交差を`SuppressionRepository`型として公開した(設計に無い名前)。合成のSQLは`core`の理由の強さ(complaint > hard_bounce > rejected)を`CASE`に写しており、27状態の全729組を`mergeSuppression`と比べるWorkers統合テストでずれを検出する。
- 4.3(4.4への申し送り): `createSendRecordRepository(db)`・`createAlertThrottleRepository(db)`はClockを持たない(時刻は引数で受け取る)。送信済みの記録の型は`SendRecordRepository`(設計の`SendRecordStore & { deleteSentBefore }`と同じ形の名前付きインターフェース)。`deleteSentBefore`は`sent_at < cutoff`で、ちょうど基準日時の行は残す。
- 4.4(6.1・6.3への申し送り): `EMAIL_PLATFORM_MODULE`の型は`Omit<AppModule, 'routes'>`(既定の`AppModule`はHonoの型引数の不変性で両アプリの`MODULES`に代入できないため)。束縛は種別の集約・受付・抑止の照会と記録・送信済みの記録・間引きだけで、`SuppressionMaintenance`は6.3で`createSuppressionMaintenance(suppressions, sendRecords, directory)`から作ってapiのモジュールに束縛する。後始末の警告ログのカテゴリは`['api', 'application', 'email-cleanup']`に固定した(eventから使う場合は引数化が要る)。
- 4.4(運用の見直しの対象): 1年の判定は実行をまたいで`afterKey`を持ち越さず毎日先頭から数え直すため、1年を過ぎた登録済みの記録が照合キーの昇順で先頭の1800件を占めると、それより後ろの未登録の記録が削除されなくなる(設計どおりの限界)。
- 5.1(5.2〜5.5への申し送り): eventのポートは`apps/event/src/application/email/ports.ts`、識別子は`email-types.ts`の`EVENT_EMAIL_TYPES`(処理の識別子`SendEmailHandler`・`DeliveryEventHandler`を含む)。`EmailRenderError`はクラスとして`ports.ts`にあり、5.7が投げて5.4が`instanceof`で見分ける。`EmailTransientFailure`は5.4が定義する。`EmailIncident`の`undeliverable`の`category`は未登録の種別のため`EmailCategory | undefined`(設計の型との相違)で、5.3は`undefined`のとき`email_category`のタグを付けない。`createEmailProvider`の環境の型`EventEmailEnv`は設計に置き場が無いため、5.2が`Pick<Env, ...>`等で定義する。
- 5.2(6.1への申し送り): `createEmailProvider(env, fetcher)`の環境の型`EventEmailEnv`は`create-email-provider.ts`に独立したインターフェースとして定義した(生成された`Env`の`MAILPIT_API_URL`がリテラル型のため)。`EMAIL_PROVIDER`が想定外の値だと`undefined`を返すため、6.1の環境の検証で値を保証する。設定の欠落はキー名だけの`Error`。`createCloudflareEmailProvider`はテストのため任意の第2引数で時間切れの値を受け取る(設計は1引数)。
- 5.2: Email Sendingの30秒の時間切れの後に`send()`が遅れて成功すると、一時的な障害として再試行されて二重送信になり得る(要件6.1と設計の想定どおり。少なくとも1回の配信の範囲)。Mailpitの失敗コードは設計の`mailpit-rejected`に加えて`mailpit-unreachable`・`mailpit-status-<状態コード>`・`mailpit-invalid-response`(すべて一時的な障害)。
- 5.3(6.1への申し送り): `SentryEmailIncidentReporter`・`UnsetSenderInfoProvider`はコンストラクタ引数の無い`@injectable()`のクラスで、`.to(クラス)`で束縛する。通知は設計の`captureMessage`ではなく技術ドキュメント004の定型の文言の規則に従い`captureEvent`+`logentry`で送る(重複除外で捨てられないため)。送信不能には設計に無い`correlation_id`(送信要求の識別子)のタグも付ける。タグと指紋の値は`[A-Za-z0-9_.:-]`だけのとき64文字に切り詰め、それ以外は`unknown`、不正なイベントで種類が無ければ`missing`。
- 5.4(6.1への申し送り): `SendEmailHandler`と`EmailTransientFailure`は`application/email/send-email-handler.ts`にある。ログのカテゴリは`['event', 'application', 'email-send']`、属性名は伏せ字の規則(`/email/i`)と予約の`category`を避けて`kind`・`kindCategory`・`deferCause`・`delaySeconds`等。前判定の送信不能のコードは`unknown-kind`・`invalid-input`・`render-failed`。日次上限の警告は`tryAcquire('email-daily-limit', now, 3600)`が真のときだけ送り、`tryAcquire`自体の失敗はerrorログにとどめて警告を送らない(開発者の判断待ち)。待機で再配信されると試行回数が1に戻るため、待機をまたぐと一時的な障害の再試行の合計が5回を超え得る(backend-platformの方式による)。
- 5.5(6.1への申し送り): `DeliveryEventHandler`(`application/email/delivery-event-handler.ts`)は`RawMessageHandler`でClockを持たず、イベントの時刻が無ければ`meta.timestamp`(Queueに入った時刻。再試行で変わらない)を使う。ログのカテゴリは`['event', 'application', 'email-delivery-event']`。ログの捕まえ方のテスト補助は`application/email/email-log-capture.fixtures.ts`に共有した。要件7.8は不正なイベントを「警告」とするが、設計のEmailIncidentReporterの表に従いSentryへは`error`で送る(ログは`warning`)。
- 5.6(5.7への申し送り): `EmailTemplate.Body`は設計の`ComponentType<{ input }>`ではなくメソッドの記法`Body(props: { readonly input: TInput }): ReactNode`(引数の反変で`EmailTemplate<unknown>[]`へ代入できないため)。`<template.Body input={…} />`で描画できる。`EMAIL_TEMPLATES`は空なので、5.7で疎通確認のテンプレートを登録し、`createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS)`が例外を投げないことのテストを加える(5.7より前に6.1を結線すると壊れる)。集約は名前に加えて種別の定義が同じオブジェクトであることも検査する。JSXで`{変数}文字列`と分けて書くとHTMLに`<!-- -->`が入るため、文言はテンプレートリテラルで1つのテキストにする。
- 5.6(文言の仮置き): 配信停止の区画の文言「この種類の通知メールの配信停止」と、見出し・ラベル無しで3つの値を1行ずつ並べる送信者情報は、設計・文言規則に定めが無いため仮置き(開発者の確認待ち)。配信停止の区画はリンク1つだけで、notificationsのFR-NOTIF-013(集約したメールで2種類の配信停止リンク)には対応できない(notificationsの実装時の見直しの対象)。
- 5.7(6.1への申し送り): `ReactEmailRenderer`はコンストラクタで`EmailTemplateRegistry`を受け取るクラスで`@injectable`を持たず、テンプレートの集約のDI識別子も無い。`.to(ReactEmailRenderer)`では解決できないため、`toDynamicValue(() => new ReactEmailRenderer(createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS)))`で束縛する。描画の失敗の`EmailRenderError`はメッセージが種別の名前だけで元の例外を`cause`に残すが、`SendEmailHandler`は`cause`をログ・Sentryへ出さない。疎通確認の本文の文言(「メール送信の確認のために送信したメールです。」「受付日時は…です。」「このメールへの返信は不要です。」)は仮置き(開発者の確認待ち)。20件の描画の所要時間はVitestの`annotate`で記録する(`--reporter=verbose`で表示)。
- 6.1(6.2への申し送り): eventのメールのモジュールは`composition/email-module.ts`の`EVENT_EMAIL_MODULE`で、経路はまだ持たない(6.2で疎通確認の経路を足す)。`ReactEmailRenderer`は起動時に作る定数を`toConstantValue`で束縛した(種別とテンプレートの対応の誤りを起動時に検出するため。5.7の申し送りとの相違)。送信プロバイダには処理単位ごとにグローバルの`fetch`を渡し、テストは`vi.spyOn(globalThis, 'fetch')`で受ける。eventのコンテナで`EMAIL_TYPES.EmailSender`が解決できることは6.2の経路のテストで確かめる。
- 6.1: eventのWorkers統合テストでD1を使うため、apiの`readNestedD1Migrations`を`config/vitest/read-nested-d1-migrations.ts`へ移して両アプリで共有した(`config/vitest`の規則は`node:`の組み込みを許す形に緩めた)。マイグレーションは`setupFiles`で適用すると既存の`index.worker.test.ts`の`vi.mock`が効かなくなるため、D1を使うテストファイルの`beforeAll`で適用する。backend-platformのdesign.md(241〜242行・1866行)は移す前のパスを指したまま。eventの`wrangler deploy --dry-run`によるバンドルの確認は権限で拒否されたため、開発者の手動実行待ち。
- 6.2(7.2・8.1への申し送り): 疎通確認の経路は`POST /internal/email/smoke`で、`Authorization: Bearer <EMAIL_SMOKE_TOKEN>`を渡すと202 `{ requestId }`を返す。2つのシークレットが揃わなければ未登録の経路と同じ404。1.3の申し送りに従い、ルートの`secrets.required`だけに`EMAIL_SMOKE_TOKEN`・`EMAIL_SMOKE_RECIPIENT`を加え、設計の表を改めた。ローカルで未登録だと`wrangler dev`は警告して起動し、経路は404になるため、開発者がInfisical(dev)へ2つのキーを登録する必要がある。stagingは`wrangler secret put`で登録する(`secrets.required`には入れていないのでデプロイは失敗しない)。404のエラーの組み立ては`apps/api/src/presentation/gateway/internal-only.ts`の`createNotFoundError`と同じ内容をeventに写している。
