# Implementation Plan

- [ ] 1. 基盤: テーブル・共有の定義・画面の基本部品
- [x] 1.1 管理者の8テーブルを定義し、マイグレーションを生成する
  - 前提: backend-platform・api-gateway・email-delivery・frontend-platform・content-processing・media-pipeline・identity-authの全タスクが完了していること(層構成・登録箇所・GraphQL基盤・メール送信基盤・管理者側の画面の骨格・共有ディレクトリ・アップロード基盤・認証部品がある状態)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、各テーブルの列の型・NOT NULL・既定値・一意制約・CHECK制約・索引(メールアドレスの大文字小文字を区別しない一意、ロールと状態のCHECK、監査ログの日時・操作者・操作種別の索引、対象の種類と識別子の索引)を確かめる単体テストを書く
  - 管理者はメールアドレス・パスワードのハッシュ(招待の完了前は空)・ニックネーム・肩書き・プロフィール画像の参照(外部キーなし)・ロール・状態・招待の期限・有効化の日時を持つ。セッション・認証系トークン・第2要素の待ち・TOTP(再設定の保留の列を含む)・リカバリコードは管理者を外部キーで参照し、削除時の動作を指定しない
  - 監査ログは操作者のID(外部キーなし・必須)・操作種別・対象の種類・理由・詳細・日時を持ち、個人情報の列を持たない。対象の行は監査ログを参照し、対象の識別子は他のテーブルを参照しない
  - スキーマの集約点に加え、mainの最新を取り込んでからマイグレーションを生成する。衝突したら生成し直す
  - 完了状態: 列の単体テストが成功し、生成したマイグレーションをローカルに適用でき、適用後のデータベースで大文字小文字だけが異なるメールアドレスの管理者を追加できない
  - _Requirements: 1.1, 1.3, 1.4, 18.1, 18.8_

- [x] 1.2 (P) ロールの順序と入力規則を、4アプリが共有するディレクトリに作る
  - 先に、3つのロールの順序の比較、ニックネームの25・26書記素、肩書きの50・51書記素と空、理由の500・501書記素、カテゴリ名の30・31書記素、前後の空白だけの入力を確かめる単体テストを書く
  - ロールの値と昇順の一覧・比較・表示名(閲覧のみ・モデレーター・最上位管理者)と、ニックネーム・肩書き・理由・カテゴリ名の上限と判定を作る。書記素の数え方は共有の部品を使う
  - 完了状態: 単体テストが成功し、管理者側とAPIサーバーの型検査で配置先から読み込める
  - _Boundary: AdminRoles, AdminInputRules_
  - _Requirements: 1.2, 4.1, 16.1, 18.4, 21.3_

- [x] 1.3 (P) 監査ログの操作種別の型と登録箇所を作り、本specの4つの操作種別を登録する
  - 先に、名前の形式(`<対象の領域>.<動詞句>`)・重複の拒否・理由の要否・詳細の鍵・対象の上限の検証と、本specの4種別の定義を確かめる単体テストを書く
  - 操作種別の型(名前・表示名・対象の種類・理由の要否・詳細の鍵・対象の上限)・定義の補助・検証付きのカタログを作り、specごとのファイルを連結する集約点を用意する
  - 管理者の招待・削除・ロールの変更(詳細は変更前後のロール)を理由が任意の種別として、ユーザーのメールアドレス検索を理由と詳細を受け付けず対象の上限が100件の種別として登録する
  - 完了状態: 単体テストが成功し、集約点に4種別だけが載り、検索の種別に検索文字列を入れる欄が無いことをテストで確かめられる
  - _Boundary: AuditActionCatalog_
  - _Requirements: 18.3, 18.6, 18.7_

- [x] 1.4 (P) 共有の画面部品に表と選択の部品を加える
  - frontend-platformの規則(部分ごとのファイル、variantsは別ファイル)に従い、shadcn/uiの`table`と`select`の部品を既存の`radix-ui`の範囲で加える。新しいパッケージは導入しない
  - Storybookに載せ、キーボードで選択でき、`runAxe`の違反が0件であることをブラウザテストで確かめる
  - 完了状態: 部品のブラウザテストとfrontend-libの型検査が成功し、Storybookで表と選択を確認できる
  - _Boundary: AdminCommonParts_
  - _Requirements: 21.1, 22.6_

- [x] 1.5 利用者側の戻り先とフラグメントのトークンの部品を共有ディレクトリへ移す(identity-authとの統合)
  - identity-authが利用者側に置いた戻り先の検証とURLのフラグメントからのトークンの読み取りの純粋な関数を、単体テストとともにfrontend-libの`utilities/auth/`へ移し、利用者側の読み込み先を直す。関数の形と振る舞いは変えない
  - 完了状態: 移した単体テストと利用者側の認証画面のブラウザテストが変更なしで成功し、利用者側と管理者側の型検査で新しい置き場所から読み込める
  - _Requirements: 6.5, 14.8_

- [x] 1.6 (P) 利用者と共有する認証のエラーと送信回数の上限を、主体に依存しない層へ移す(identity-authとの統合)
  - 先に、移した先の単体テストで、共有のエラーコードの種類と文言、パスワードの拒否のエラーが違反ごとのコード・欄・文言を返し識別子との一致の文言だけを主体ごとに受け取ること、管理者のエラーの定義が共有の全コードを同じ定義で含み、管理者のパスワードの識別子との一致の文言が「ニックネーム・メールアドレス(@より前の部分を含む)と同じパスワードは使えません。」であることを確かめる
  - identity-authの`application/identity`の主体に依存しないエラーの定義・ログイン試行のロックのエラー・本人確認とパスワードの拒否の文言・パスワードの拒否のエラーの組み立てと、`infrastructure/identity`の送信回数の時間窓と上限を、`application/auth`の`auth-errors.ts`・`password-rejection.ts`・`mail-send-policy.ts`へ移す。利用者のエラーの定義は共有の定義を展開して利用者に固有のコードだけを足し、利用者のユースケースの呼び出し側は変えない。エラーコード・文言・上限の値は変えない
  - 管理者のエラーの定義`application/admin/admin-errors.ts`(共有の定義と管理者に固有のコード、管理者用のパスワードの拒否のエラー)を作る
  - `docs/GUIDES/tech/security/006-authentication.md`の部品の表と、identity-authのdesign.mdのファイル構成を新しい置き場所に直す
  - 完了状態: 移した単体テストと利用者側の既存の単体テスト・Workers統合テストが変更なしで成功し、APIサーバーの静的解析で`admin`から`identity`への読み込みが無いまま共有の定義を読み込める
  - _Boundary: AdminErrors_
  - _Requirements: 5.2, 5.3, 6.2, 7.3, 13.1, 14.4_

- [x] 1.7 (P) TOTPのパッケージを公開中の最新の版へ上げる(identity-authとの統合)
  - APIサーバーの`otpauth`を9.5.2から9.6.0へ、`docs/GUIDES/tech/coding/002-dependency-versions.md`の「版を明示した追加手順」で完全に固定した版のまま上げる。依存の`@noble/hashes`が2.4.0のままであることを`bun.lock`で確かめる
  - 同じ文書の`otpauth`の確認事項に従い、`otpauth://`のURIの項目の並びと照合の時間窓の差分の返し方が変わっていないことを、identity-authのTOTPの単体テスト・Workers統合テストと`e2e/client/auth/two-factor.e2e.test.ts`で確かめ直す。実際の認証アプリでのQRコードの読み取りと照合は開発者の手作業として報告する
  - 同じ文書の主要パッケージの一覧と`docs/onboardings/tech-stack.md`の版を9.6.0に直す
  - 完了状態: APIサーバーの型検査・単体テスト・Workers統合テストと、利用者の多要素認証のE2Eが成功し、文書の版が`package.json`と一致する
  - _Requirements: 4.2, 6.3, 12.1_

- [ ] 2. ドメインの規則
- [x] 2.1 (P) 管理者の状態と操作の可否、セッションの期限、トークンの用途の規則を作る
  - 先に、削除の可否(自分自身・閲覧のみ・モデレーターから最上位管理者・最上位管理者から最上位管理者・モデレーターからモデレーター)、ロールの変更とプロフィール編集と招待の可否、招待期限切れの表示、アイドル1時間・絶対12時間・更新の間引き5分の境界、トークンの用途ごとの有効期限とハッシュ化の用途を確かめる単体テストを書く
  - identity-authのセッションの方針の型で管理者の値を定義し、認証の判定はidentity-authの純粋な関数を使う
  - 完了状態: 単体テストが成功し、表示の状態が有効・招待中・招待期限切れの3つに分かれることを確かめられる
  - _Boundary: AdminAccountRules, AdminSessionPolicy, AdminAuthTokenPurpose_
  - _Requirements: 1.4, 3.5, 8.2, 8.3, 14.2, 15.4, 15.5, 15.7, 16.4_

- [x] 2.2 (P) 監査ログの記録の入力を検証する規則を作る
  - 先に、未登録の操作種別、理由が必須で空・任意で空・不要なのに値あり・501書記素、ユーザーの対象が仮名化IDの形式でない値、対象の上限超、対象を取らない種別への対象、登録外の詳細の鍵と101文字の値を確かめる単体テストを書く
  - 理由は前後の空白を除いて空なら未入力として扱い、検証済みの理由を返す
  - 完了状態: 単体テストが成功し、違反ごとに異なる理由が返る
  - _Boundary: AuditEntryRules_
  - _Requirements: 18.4, 18.5, 18.6_

- [ ] 3. 監査ログの記録と照会
- [x] 3.1 監査ログの記録の準備・単独の記録・検索・最新の照会(1件と複数の対象)のユースケースと、照会の共有の偽物を作る
  - 先に、ポートを偽物にして、違反のある入力で検証のエラー(欄ごとの詳細)になり何も保存されないこと、準備の値にIDと正規化した理由が入ること、検索の条件とカーソルの受け渡し、1つの対象と複数の対象の最新の日時の照会(複数の対象は重複を除いてストアへ渡し、空の入力では問い合わせずに空の結果を返す)を確かめる単体テストを書く
  - 先に、照会の共有の偽物の単体テストで、既定の振る舞い(検索は空・1つの対象は無し・複数の対象は空)と、渡したメソッドだけが差し替わることを確かめる
  - 準備の値はこのユースケースだけが作れる形にし、後続specのユースケースが管理操作の前に呼べるようにする。照会の共有の偽物は後続specの単体テストが読み込める位置に置く(仮7)
  - 完了状態: 単体テストが成功し、後続specが読み込める位置に記録・照会のポートと型と照会の共有の偽物がある
  - _Requirements: 18.1, 18.4, 19.2, 19.3, 19.5_

- [x] 3.2 監査ログの文の組み立てとD1の実装を作る
  - 先に、Workers統合テストで、準備の値から作った文を他の文と同じ一括の書き込みに含めると両方が確定し、他の文の失敗で監査ログも残らないこと、条件付きの記録で条件を満たさないと全体が取り消されること、対象100件がバインド変数の上限内に分かれること、検索の各条件(操作者・操作種別・対象の識別子・期間)とカーソル、1つの対象の最新の日時の照会、複数の対象の最新の日時の照会(対象ごとの最新の日時、記録の無い対象を含めないこと、操作種別と対象の種類で絞ること、90件を超える入力の分割と結果の統合、重複したID、空の入力)を確かめる
  - 後続specのストアが読み込める位置に文の組み立てを置く。検索は日時とIDの降順のカーソルで1ページ50件にする。複数の対象の照会は対象のIDを90件ずつに分け、それぞれ1回の問い合わせで対象ごとの最新の日時を求める(仮7)
  - 完了状態: Workers統合テストが成功し、監査ログの行に操作者のID以外の個人情報が入らないことを確かめられる
  - _Requirements: 18.1, 18.2, 18.8, 19.2, 19.3, 19.5_

- [ ] 4. 管理者のストアとセッション
- [x] 4.1 管理者のアカウントのストアを、招待・有効化・削除・ロール変更の一括の書き込みとともに作る
  - 先に、Workers統合テストで、招待の作成とメールアドレスの重複、再送でのトークンの置き換えと招待期限の更新、仮の保存、有効化(TOTPの確定・リカバリコード・セッション・残りの招待トークンの削除)の一括の書き込み、削除で子の行がすべて消えること、最後の有効な最上位管理者の削除と降格が取り消され監査ログも残らないこと、2人の最上位管理者が互いを同時に降格しても1人が残ること、パスワードのリセット・変更とメールアドレスの変更で全セッションと対象のトークンが消えることを確かめる
  - 管理者の業務処理が使うストア・メール・設定値のポートと、管理者用の要求の情報・発行したセッション・TOTPの設定の表示の型を、このタスクでまとめて定義する(4.2以降はこの定義を実装・利用する)
  - 削除とロールの変更は、先頭に条件付きの監査ログの挿入を置いた一括の書き込みにする(設計の「削除・ロール変更の保護」)
  - 完了状態: Workers統合テストが成功し、取り消された場合に結果が「拒否」として返る
  - _Requirements: 1.3, 3.1, 3.3, 3.4, 4.3, 4.4, 9.4, 10.4, 10.6, 11.2, 15.2, 15.3, 15.8, 15.9, 18.2_

- [x] 4.2 セッション・認証系トークン・第2要素の待ち・TOTP・リカバリコードのストアを作る
  - 先に、Workers統合テストで、トークンの2回目の消費の失敗、期限切れの削除の境界、使用済みの時間窓より前の認証コードの拒否、TOTPの保留の保存と現在の設定との入れ替え、リカバリコードの消費と入れ替えを確かめる
  - identity-authの利用者のストアと同じ操作を、管理者のテーブルとIDで持つ。平文を保存しない。ポートは4.1で定義したものを実装する(4.1のポートの定義に依存するため並行にしない)
  - 完了状態: Workers統合テストが成功し、保留の入れ替えまでは現在のTOTPの設定が変わらない
  - _Requirements: 8.1, 12.1, 12.8, 14.1, 14.2_

- [x] 4.3 管理者のセッションの発行と検証を作り、identity-authの差し込み口へ束縛する(identity-authとの統合)
  - 先に、単体テストで発行と操作端末への再発行の条件を、Workers統合テストで期限切れ・招待中・削除済みのセッションが無効になり行が消えること、5分以上の間隔で利用すると期限が延びて更新の指示が返ることを確かめる
  - APIサーバーのセッションの合成で、管理者のセッションの検証の束縛を本specの実装への転送に差し替える。他の束縛は変えない
  - 完了状態: 管理者側の呼び出し元のGraphQLで、発行したセッションから管理者の主体が得られ、利用者側の呼び出し元では管理者のセッションが無効になることをWorkers統合テストで確かめられる
  - _Depends: 4.2_
  - _Requirements: 6.1, 8.1, 8.2, 8.3, 8.4, 10.6, 11.2, 12.5_

- [ ] 5. 認可と照会の部品
- [x] 5.1 アクセス制御の部品と管理者の照会口を作る
  - 先に、単体テストで、管理者側でない呼び出し元・未ログイン・利用者の主体・ロール不足の拒否、本人なら許可しそれ以外はロールを求める判定、要求ごとに保存済みのロールを1回だけ読むことを、Workers統合テストで、照会口が削除済み・招待中・存在しないIDを含めず101件のIDを2回の照会に分けることを確かめる
  - 同じく先に、識別子`ADMIN_PLATFORM_TYPES`が`Symbol.for('admin.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - 照会口は後続specのapiとeventのapplication層が使えるよう、設計の契約(`AdminProfileView`・`AdminDirectory`)を`apps/backend-lib/core/admin/ports.ts`に、識別子`ADMIN_PLATFORM_TYPES`を`core/admin/identifiers.ts`に作る。D1の実装`D1AdminDirectory`(`workers/admin/d1-admin-directory.ts`)と両アプリ共通の束縛`ADMIN_PLATFORM_MODULE`はバックエンド共通の`workers/admin`に作る(eventでの利用はinquiry-chatのデータエクスポートの部品)。application層は`**/lib/workers/**`を型も含めて読み込めないため、契約と識別子を`workers`に置かない。apiの`ADMIN_TYPES`とメンバーの名前を重ねない
  - リゾルバ向けに、GraphQLの文脈から呼び出し元とセッションを渡す補助を、後続specのリゾルバが読み込める位置に置く
  - 完了状態: 単体テストとWorkers統合テストが成功し、ロールを変更した直後の要求から新しいロールで判定されることを確かめられる。APIサーバーの静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 4.1_
  - _Requirements: 1.5, 17.1, 17.2, 17.3, 17.4_

- [ ] 6. 管理者の業務処理
- [x] 6.1 パスワードと第2要素のログインとログアウトを作る
  - 先に、ポートを偽物にして、有効な管理者は必ず第2要素を求められること、未登録・招待中・パスワードの誤りが同じ失敗と同じ計算量になり試行の失敗として数えられること、ロック中は照合しないこと、認証コードの再使用とリカバリコードの消費、成功時の記録の消去、ログアウトでその端末のセッションだけが消えることを確かめる単体テストを書く
  - ログイン試行の記録はidentity-authの部品を管理者のスコープで使い、IPアドレス単位は利用者と共有する
  - 完了状態: 単体テストが成功し、ログインの各結果のエラーコードが設計の表と一致する
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.7_

- [x] 6.2 (P) 本人確認と認証系メールの送信回数の制限を作る
  - 先に、単体テストで、パスワードと第2要素の両方を必須とすること、誤りのある欄の詳細、誤りを試行の失敗として数えること、ロック中は照合しないこと、リカバリコードの消費を確かめる
  - 同じく先に、送信回数の制限の実装`CounterAdminMailSendLimits`が偽の厳密カウンタにメールの種類ごとの宛先3回・IP5回の2つの規則で数え、どちらかの超過で拒否し、キーをハッシュ化することを確かめるWorkers統合テストを書く。有無の判定より前に数えることは、偽のポートを使うリセットと変更のユースケースの単体テスト(6.4)で確かめる
  - 送信回数の制限のポート`AdminMailSendLimits`はapplication層(4.1のポートの定義の`application/admin/ports.ts`に加える)、実装は厳密カウンタのクライアントの型が共通ライブラリの`workers`にあるためinfrastructure層(`infrastructure/admin/counter-admin-mail-send-limits.ts`)に作る(`backend/003`、identity-authの`CounterMailSendLimits`と同じ形)。回数と時間窓は1.6で移した送信回数の上限の定義から読み、カウンタの規則の名前だけを管理者用にする
  - 完了状態: 単体テストとWorkers統合テストが成功し、本人確認の成功では試行の記録を消さないことを確かめられる。APIサーバーの静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Boundary: AdminReAuthenticator, AdminMailSendLimits, CounterAdminMailSendLimits_
  - _Requirements: 7.6, 13.1, 13.2, 13.3, 13.4, 14.4_

- [x] 6.3 管理者の招待・再送・招待の完了の2段階を作る
  - 先に、単体テストで、モデレーター以上だけが招待・再送できること、メールアドレスの重複の拒否、招待と監査ログが同じ一括の書き込みで確定すること、1段目でトークンを消費せずに仮の保存とTOTPの保留を行うこと、ニックネームとパスワードの規則(ニックネーム・メールアドレス全体・@より前の部分との一致を管理者用の文言で拒否する)と漏洩照合(照合不能でも受け付ける)、2段目の期限切れ・誤りの拒否、完了で有効化・リカバリコード10個・セッションが発行されること、無効なトークンでのリンクの無効の応答を確かめる
  - 招待は常に閲覧のみのロールで作り、プロフィール画像と肩書きを求めない
  - 完了状態: 単体テストが成功し、完了までは管理者の状態が招待中のままである
  - _Depends: 3.1, 4.3_
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 6.4 パスワードリセット・メールアドレス変更・パスワード変更を作る
  - 先に、単体テストで、パスワードリセットの要求の同一の結果と未登録・招待中への不送信、リセットの完了で全セッションが消え多要素認証が変わらないこと、メールアドレス変更の要求の同一の結果と重複時の不送信、確定時の重複でのリンクの無効、確定で旧アドレスへの完了メールと操作端末への再発行、パスワード変更が即時に反映され完了メールと操作端末への再発行が行われること、本人確認の失敗で変更されないこと、リセットと変更の要求が送信回数の制限(偽のポート)を有無の判定より前に呼び、超過で拒否されることを確かめる
  - 完了状態: 単体テストが成功し、各手続きの完了の通知メールの送信要求が出る
  - _Depends: 6.2_
  - _Requirements: 5.3, 5.4, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.1, 11.2, 11.3_

- [x] 6.5 (P) TOTPの再設定とリカバリコードの再発行を作る
  - 先に、単体テストで、本人確認のうえで新しい秘密鍵を保留にし現在の設定が有効なままであること、10分以内の正しい認証コードで入れ替えとリカバリコードの全件の置き換えが行われること、期限切れ・誤りで現在の設定が変わらないこと、再発行で未使用のリカバリコードが無効になること、完了で全セッションの削除と操作端末への再発行が行われることを確かめる
  - 無効化の操作は作らない
  - 完了状態: 単体テストが成功し、ユースケースに多要素認証を無効にする経路が無い
  - _Depends: 6.2_
  - _Boundary: AdminTotpManagement_
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.8_

- [x] 6.6 管理者の一覧・削除・ロールの変更・プロフィールの更新を作る
  - 先に、単体テストで、一覧の表示の状態、削除とロール変更の権限の拒否(自分自身・モデレーターから最上位管理者・閲覧のみ)、拒否された一括の書き込みの後の理由の判別(存在しない・最後の最上位管理者・競合)、削除とロール変更の監査ログ(ロール変更は変更前後)、プロフィールの規則と権限、画像の紐付けの失敗の拒否、差し替え・取り除きで以前の画像が削除され、削除の失敗は記録だけになることを確かめる
  - 画像は管理者の行が参照するIDで削除し、保有者単位の削除を使わない
  - 完了状態: 単体テストが成功し、削除した管理者のプロフィール画像の削除要求が出る
  - _Depends: 3.1, 4.1_
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 16.1, 16.3, 16.4, 16.5, 16.7, 18.7_

- [ ] 7. メール
- [x] 7.1 (P) 6つのメール種別・メール送信の部品・テンプレートを作り、種別とテンプレートを同時に登録する
  - 先に、単体テストで種別の入力の検証を、Workers統合テストでリンクが管理者側のオリジンとフラグメントのトークンになること、期限付きの3種に送信期限が付くこと、ログにトークンが出ないことを確かめる
  - 同じく先に、テンプレートの登録の検証が通ること、件名・行動ボタンのURL・有効期限・心当たりが無い場合の案内を含むことを確かめるテストを書く
  - テンプレートは文言規則の件名と本文の構成に従い、日時はUTC表記にする。招待のメールは宛名を省く
  - 種別をメール種別の集約点に、テンプレートをテンプレートの集約点に、同じ作業の中で登録する。イベントサーバーのテンプレートのテストは全種別のテンプレートを求め、起動時のテンプレートの登録も種別とテンプレートの対応を確かめるため、種別だけを先に登録した状態を作らない(identity-authのタスク3.3と9.1の統合と同じ理由)
  - 完了状態: 単体テスト・APIサーバーとイベントサーバーのWorkers統合テストが成功し、email-deliveryの種別の集約の検証が通り、Mailpitへの送信でHTMLとテキストの両方が表示される
  - _Boundary: AdminEmailKinds, EmailAdminMailer, AdminEmailTemplates_
  - _Requirements: 14.1, 14.5, 14.7, 14.8_

- [ ] 8. APIの組み立て
- [x] 8.1 APIサーバーへ管理者のモジュール・用途・変数・静的解析の規則を、イベントサーバーへ照会口を組み込む(上流の登録箇所との統合)
  - 先に、Workers統合テストで、処理単位のコンテナから管理者のユースケース・アクセス制御の部品・照会口・監査ログの部品が解決できること、イベントサーバーのコンテナから照会口が解決できること、管理者側のオリジンの変数が無い・不正な値で起動の検証が失敗することを確かめる
  - 同じく先に、APIサーバーのWrangler設定の単体テスト(`test/config/wrangler-config.unit.test.ts`)が3環境の変数を完全一致で照合しているため、期待に3環境の管理者側のオリジンを加え、Wrangler設定へ加える前に失敗することを確かめる
  - 管理者のモジュール(ストア・メール送信・設定値・ユースケース・アクセス制御・監査ログ)と照会口の両アプリ共通のモジュールをAPIサーバーのモジュールの登録箇所へ、照会口の両アプリ共通のモジュールをイベントサーバーのモジュールの登録箇所へ加え、プロフィール画像の用途(画像・管理者・画像5形式・512,000バイト)をアップロードの用途の登録箇所へ、管理者側のオリジンの変数の検証を環境の検証へ、3環境のWrangler設定へ変数を加え、型を生成し直す。認証部品の束縛はidentity-authのものをそのまま使う
  - 管理者の各層から利用者の各層への読み込みを禁止する静的解析の規則と、違反例の単体テストを加える
  - 完了状態: APIサーバーの起動・型検査・静的解析・Workers統合テストが成功し、プロフィール画像の用途で512,001バイトのアップロードが413になり、管理者の層から利用者の層を読み込む例が違反として報告され、Wrangler設定の単体テストが3環境の管理者側のオリジンを含む期待で成功する
  - _Depends: 5.1, 6.6, 7.1_
  - _Requirements: 1.5, 16.2, 22.3_

- [x] 8.2 GraphQLのスキーマモジュールの認証の操作を作り、スキーマモジュールの登録箇所へ加える
  - 先に、Workers統合テスト(管理者側の呼び出し元のテスト補助)で、ログインの2段階とセッションの発行の指示、bot判定の失敗の403と到達不能の503、利用者側の呼び出し元の拒否、ログイン試行のロックの429と再試行の待ち時間、パスワードリセットの要求の同一の応答、招待の完了の2段階、メールアドレス変更の確定の操作端末への再発行、ログアウトの削除の指示を確かめる
  - 入力の検証は共有の入力規則とメールアドレスの形式で行い、違反は欄ごとの詳細にする
  - 完了状態: Workers統合テストが成功し、スキーマファイルとリゾルバの型の生成と検査のコマンドが成功する
  - _Requirements: 4.5, 6.7, 6.8, 7.3, 9.1, 14.3_

- [x] 8.3 GraphQLのスキーマモジュールの管理と本人の操作と監査ログの検索を作る
  - 先に、Workers統合テストで、閲覧のみの招待の403、モデレーターの最上位管理者の削除の403、最上位管理者以外のロール変更の403、他人のプロフィールの更新の権限、本人の操作の操作端末への再発行、本人確認の失敗(`reauthentication_failed`)の詳細が引数の形のとおりの経路(`reAuthentication.currentPassword`・`reAuthentication.secondFactor.totpCode`・`reAuthentication.secondFactor.recoveryCode`)になること、監査ログの検索の条件・ページ・削除済みの操作者(ニックネームが空)と操作種別の表示名を確かめる
  - 監査ログを変更・削除する操作を設けない
  - 完了状態: Workers統合テストが成功し、スキーマに監査ログの変更の操作が無い
  - _Requirements: 3.5, 12.7, 15.4, 15.7, 16.4, 17.1, 19.1, 19.4, 19.7_

- [x] 8.4 日次の2つのジョブを作り、定期実行へ登録する
  - 先に、Workers統合テストで、期限切れのセッション・トークン・待ち・TOTPの保留が上限件数ずつ消えること、記録から3年以上経過した監査ログが対象の行から順に消え3年未満は残ること、残りが翌日に続くことを確かめる
  - 業務時刻4:21の順序200・210で登録する
  - 完了状態: テストが成功し、`--test-scheduled`での起動で2つのジョブが順に実行されることをログで確かめられる
  - _Requirements: 8.6, 14.6, 19.6_

- [ ] 9. 最初の最上位管理者の招待の発行コマンド
- [x] 9.1 (P) 招待の発行コマンドのSQLと環境の設定を、純粋な部品として作る
  - 先に、単体テストで、SQLの文字列のリテラルの`'`の二重化と制御文字の拒否、招待中の管理者の有無で生成されるSQL(ロールの更新と未使用の招待トークンの削除、または挿入)、環境ごとのWranglerの引数と管理者側のオリジンを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: SuperAdminInvitationScript_
  - _Requirements: 2.3, 2.4, 2.5_

- [x] 9.2 招待の発行コマンドの入口を作り、ローカルで動作を確かめる
  - 引数の検証→照会→有効な管理者なら失敗→トークン・ハッシュ・IDの生成→一時ファイルでの書き込み→一時ファイルの削除→リンクと有効期限の表示の順で処理する。メールは送らない
  - APIサーバーのパッケージのスクリプトに加え、ペッパーはInfisicalの注入で受け取る。staging・prodの指定は開発者だけが実行する(AIエージェントは実行しない)
  - 完了状態: `--target local`の実行でリンクと有効期限が表示され、ローカルのD1に最上位管理者ロールの招待中の管理者と招待のトークン(ハッシュだけ)が書き込まれ、一時ファイルが残らない。既に最上位管理者がいるローカル環境でも新しい招待を発行でき、有効な管理者のアドレスでは何も書き込まれずに失敗する。画面からの完了は11.4と12.1で確かめる
  - _Depends: 8.1, 9.1_
  - _Requirements: 2.1, 2.2, 2.6, 2.7_

- [ ] 10. 管理画面の共通部品
- [x] 10.1 (P) ページの見出し・一覧の表・絞り込みの部品を作る
  - 先に、ブラウザテストで、表の読み込み中・空・エラー(再試行、問い合わせのボタンが無いこと)・前後のページの状態、表の名前が支援技術へ伝わること、絞り込みの適用と解除、`runAxe`の違反0件を確かめる
  - GraphQLとアプリの型に依存せず、Storybookに載せる
  - 完了状態: ブラウザテストが成功し、Storybookで各状態を確認できる
  - _Depends: 1.4_
  - _Boundary: AdminCommonParts(AdminPageHeader・AdminDataTable・AdminFilterBar)_
  - _Requirements: 21.1, 21.4_

- [x] 10.2 (P) 確認のダイアログ・理由の入力欄・管理者のアバターの部品を作る
  - 先に、ブラウザテストで、理由が必須なら空で確定できないこと、500書記素を超えるとフォーカスを外した時点でエラーが出ること、個人情報を含めない旨と監査ログに記録される旨の表示、確定の失敗でダイアログを開いたまま理由の入力を保ち`failureMessageOf`の文言をダイアログの中に示すこと、アバターの画像が無い・表示できない場合の既定のアイコンを確かめる
  - 完了状態: ブラウザテストが成功し、Storybookで各状態を確認できる
  - _Boundary: AdminCommonParts(ConfirmActionDialog・ReasonField・AdminAvatar)_
  - _Requirements: 16.6, 18.9, 21.2, 21.4_

- [x] 10.3 (P) カテゴリマスタの編集部品を作る
  - 先に、ブラウザテストで、一覧・追加・名前の編集(1〜30書記素)・削除の確認、ハンドルの入力欄の有無の切り替え、システム標準のカテゴリの削除ができない表示、権限が無いときの操作の無効化、呼び出す側の拒否の文言の表示を確かめる
  - 保存の可否と業務規則の判定は呼び出す側に委ねる。拒否・失敗の文言は呼び出す側が渡す関数(管理者側の画面は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`)で選ぶ
  - 完了状態: ブラウザテストが成功し、Storybookで各状態を確認できる
  - _Boundary: AdminCommonParts(CategoryMasterEditor・CategoryFormDialog)_
  - _Requirements: 21.3, 21.4_

- [ ] 11. 管理画面
- [x] 11.1 ログイン中の管理者の取得とログイン必須の領域とロールの出し分けを作る
  - 先に、ブラウザテストでロールによる表示の出し分けを確かめる
  - 管理者側の画面が使うGraphQLの操作の文書(ログイン中の管理者・認証・管理・本人の操作・監査ログ)を`src/graphql/operations/admin/`の1ファイル1操作の`*.graphql`(操作名は`Admin`で始める)でまとめて作り、管理者側で`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行してコード生成と管理者側の許可リストの生成を行う(11.3〜11.7はこの操作の生成物`src/graphql/generated/graphql.ts`の`<操作名>Document`を使い、操作の文書を編集しない)
  - ルートの読み込み前にログイン中の管理者を取得して文脈に入れ(失敗は未ログイン)、ログイン必須の領域で未ログインならログイン画面へ戻り先付きで遷移させ、ロールを画面部品へ配る。ログイン中にログイン画面を開いたらダッシュボードへ遷移させる
  - 完了状態: ローカルで、未ログインで`/accounts`を開くと`/auth/login?redirect=/accounts`へ遷移し、ブラウザテストが成功し、管理者側の操作が管理者側の許可リストにだけ載る
  - _Depends: 8.3_
  - _Requirements: 8.5, 17.5, 20.1, 20.8_

- [x] 11.2 メニューとダッシュボードの登録箇所とシェルの区画を作り、仮のトップページを置き換える
  - 先に、ブラウザテストで、登録された項目だけが順に並び現在の項目が示されること、メニューが名前付きの`nav`のランドマークを描くこと、ヘッダーのニックネーム・ロール・導線、ダッシュボードのカードが順に並ぶこと、カードが無いときの空状態、1つのカードの失敗が他のカードに及ばず、その失敗の表示に問い合わせのボタンと問い合わせを促す文が出ないこと、未ログイン(取得の前・取得の失敗を含む)ではメニューが`nav`を含めて何も描かずヘッダーのアカウントの表示も何も描かないことを確かめる
  - メニューの登録箇所に本specの4項目(URLと順序は設計の一覧)を登録し、ダッシュボードのカードの登録箇所は空で用意する。管理者側のレイアウトの区画を差し替え、仮のトップページを削除する。画面シェルはフッターを持たず、ナビゲーションのランドマークはメニューの部品の`nav`で満たす
  - 区画の部品は認証の画面・404・エラーのページにも描かれルートの文脈を読めないため、ルートの読み込み前の取得のキャッシュからログイン中の管理者を読み、ログアウトなどの後は取得を無効にして取り直させる(利用者側のヘッダーと同じ形)
  - 完了状態: ブラウザテストが成功し、ローカルでログイン後のダッシュボードに空状態と4つのメニューが表示され、ログイン画面と未ログインの404のページにメニューとアカウントの表示が出ない
  - _Requirements: 20.2, 20.3, 20.4, 20.5, 20.6, 20.7_

- [x] 11.3 (P) ログインとパスワードリセットの画面を作る
  - 先に、ブラウザテストで、メールとパスワードとbot判定から同じ画面で第2要素の入力へ切り替わること(認証コードとリカバリコードの描いている一方だけをスキーマに含めて送り、`challenge`を`onSubmit`で足すこと)、戻り先が同じサイト内のパスのときだけそこへ移動すること、リセットの要求の送信後に常に同じ案内が出ること、新しいパスワードの検証の表示とトークンを`onSubmit`で足して送ることを確かめる
  - 完了状態: ブラウザテストが成功し、ローカルでログインとパスワードリセットを画面から行える
  - _Boundary: AdminAuthPages_
  - _Requirements: 6.5, 9.1, 9.4, 20.1, 20.9_

- [x] 11.4 (P) 招待の完了とメールアドレス変更の確定の画面を作る
  - 先に、ブラウザテストで、リンクを開いただけでは送信しないこと、トークンをスキーマの入力に含めず`onSubmit`で足して送ること、ニックネームとパスワード→QRコードと手入力用の文字列→認証コード→リカバリコードの表示(両方を失うと復旧できない旨)→ダッシュボードの流れ、無効なリンクで再送の依頼を案内することを確かめる
  - 完了状態: ブラウザテストが成功し、ローカルで招待の発行コマンドのリンクから招待を完了できる
  - _Boundary: InvitationPages_
  - _Requirements: 4.1, 4.3, 4.5, 12.7, 14.3, 20.1_

- [x] 11.5 (P) 管理者アカウントのページを作る
  - 先に、ブラウザテストで、一覧の各項目(アバター・ニックネーム・肩書き・メール・ロール・状態・登録日時)、ロールによる招待・再送・削除・ロール変更・プロフィール編集の出し分け、確認のダイアログの理由(任意)と監査ログの旨、最後の最上位管理者の拒否の文言を確かめる
  - 完了状態: ブラウザテストが成功し、ローカルで招待・ロール変更・削除を画面から行える
  - _Boundary: AdminsPage_
  - _Requirements: 3.1, 3.3, 15.1, 15.10, 16.3, 20.9_

- [x] 11.6 (P) 監査ログのページを作る
  - 先に、単体テストで期間の入力から開始と終了の時刻への変換(閲覧者の地域の暦の日付、終了日は翌日0時の手前まで)を、ブラウザテストで絞り込みの入力(操作者・操作種別・対象の識別子・期間)・一覧の項目・削除済みの操作者の表示・ページ送りを確かめる
  - 完了状態: テストが成功し、ローカルで監査ログを条件で絞り込める
  - _Boundary: AuditLogsPage_
  - _Requirements: 19.1, 19.2, 19.3, 19.4, 20.9_

- [ ] 11.7 (P) 自分のアカウントのページを作る
  - 先に、ブラウザテストで、プロフィール(ニックネーム・肩書き・画像の登録と取り除き・既定のアイコン、画像の入力の`ImageUploadField`に`ADMIN_PROFILE.contactAvailable`を渡しアップロードの失敗に問い合わせを促す文が出ないこと)、メールアドレス変更の送信後の案内、パスワード変更、TOTPの再設定(本人確認→QRコード→認証コード→リカバリコード)、リカバリコードの再発行と残数の表示、本人確認の入力欄の誤りの表示(現在のパスワードと描いている第2要素の欄に詳細が示され、第2要素を送らなかった時の詳細はフォーム全体の失敗として示され、送信ボタンが無効のまま残らないこと)を確かめる
  - 完了状態: ブラウザテストが成功し、ローカルで各操作を画面から行える
  - _Boundary: AccountPage_
  - _Requirements: 10.1, 11.1, 12.1, 12.4, 12.7, 13.2, 16.1, 16.6, 20.9_

- [ ] 12. 検証と文書
- [ ] 12.1 管理者の主要な流れをE2Eテストで確かめる
  - 後続specの管理画面のE2Eも使う補助を用意する: ローカルのD1へSQLを実行する補助(`e2e/support/local-d1.ts`。値は招待の発行コマンドのリテラルの部品でエスケープする)と、招待の発行コマンドを`--target local`で呼んで招待を発行し、画面で招待を完了(ニックネーム・パスワード・手入力用の文字列から計算した認証コード・リカバリコードの確認)させ、指定したロール(閲覧のみ・モデレーター・最上位管理者)をローカルのD1で設定し、そのロールでログインしたページと資格情報を返す補助、既存の管理者で再ログインする補助(`e2e/support/admin-bootstrap.ts`)。メールはMailpitの補助で読む
  - 最初の最上位管理者の招待と完了→ログアウトと認証コード・リカバリコードでのログイン→モデレーターの招待と完了→ロール変更と最後の最上位管理者の自己降格の拒否→削除→プロフィール編集→パスワードリセット→メールアドレス変更→パスワード変更→TOTPの再設定→監査ログの絞り込みを確かめる
  - 補助で3つのロールの管理者を用意し、ロールの表示と操作の出し分けが変わること、再ログインできることも確かめる
  - 完了状態: E2Eテストがローカルで起動したapi・event・admin・Mailpitに対して成功し、補助がテストではないファイルとして`e2e/support/`にあり、管理画面のE2Eを持つ全後続spec(legal-pages・inquiry-chat・ultras-subscriptionなど)のE2Eが読み込める
  - _Requirements: 22.2_

- [ ] 12.2 技術ドキュメントを書く
  - `security/007`に管理者の認可の設計、`backend/008`に監査ログの記録の規約と最新の日時の照会(複数の対象の分割と照会の共有の偽物の使い方を含む)、`frontend/009`に管理画面のシェルと区画と共通部品、`operations/003`に最初の最上位管理者の招待の発行手順(最後の最上位管理者が締め出された場合を含む)を、プロジェクト名と固有の値を含めずに書き、各README.mdへ1行ずつ追記する
  - 完了状態: 4つの文書と索引の行があり、プロジェクト名・ホスト名・シークレットのキー名を含まないことを検索で確かめられる
  - _Requirements: 17.6, 22.4_

- [ ] 12.3 サービス仕様とオンボーディングの文書を更新する
  - ページ配置に管理者側のURL・メニューごとの必要なロール(Q3)・ダッシュボードのカードの分担(統計グラフはugc-moderation、未対応の問い合わせはinquiry-chat、未対応の通報はcontent-reporting)・`/auth/*`の画面・自分のアカウントの構成を書き、「週毎の統計グラフ」の行を改める。文言規則に本specの文言とメールの要点を、データ保持期間の一覧に管理者のセッション・認証系トークン・監査ログの削除方法を、日次タイムラインの表に本specの2行を(表が無ければ作って)加える
  - project-values.mdに変数の3環境の値・ジョブ・メール種別・HMACの用途・TOTPの発行者名・コマンドの引数を、onboardingsのREADME.mdにローカルで最初の最上位管理者を用意する手順を、CLAUDE.mdの技術規則の参照先に`security/007`・`backend/008`へのリンクを加える
  - 完了状態: 各文書に追記があり、ページ配置のメニューごとのロールの一覧がQ3の方針と一致する
  - _Requirements: 17.6, 22.5, 22.6_

- [ ] 12.4 全体の検査とカバレッジを確かめ、手作業の事項を報告する
  - ルートの一括の検査(整形・静的解析・型検査)と、本specが変更したアプリの単体テスト・Workers統合テスト・ブラウザテストを実行し、行と関数のカバレッジ80%以上を確かめる。外部サービス(bot判定・漏洩照合)へ通信していないことを確かめる
  - infra-deliveryの「ホスト名から導かれる変数の値」の表の`ADMIN_SITE_ORIGIN`の行と、Wrangler設定・`project-values.md`の名前と値の一致を確かめる
  - staging・prodでの招待の発行コマンドの実行、frontend-platformの管理者側のCSPの再検証の結果を、開発者への報告にまとめる
  - 完了状態: 検査とテストがすべて成功し、カバレッジが閾値を満たし、報告に手作業の事項が載っている
  - _Requirements: 22.1, 22.3, 22.6_

## Implementation Notes

- 1.1: テーブルは`apps/db/schema/admin/`、マイグレーションは`20261103162753_admin_foundation`。`admins.email`は全行で一意の`textNoCase`、`status`の既定は`invited`、`role`は既定無し。`admin_totp_credentials`の`sealed_secret`はNULL可で保留の列`pending_sealed_secret`・`pending_expires_at`を持つ。監査ログの`detail`はJSONのtextで既定`{}`、`target_kind`にCHECKは無い。ロール・状態・トークンの用途の値はテーブルのファイルの非公開の定数のため、1.2・2.1でこれらの値を定義するときは列の`enumValues`との一致を単体テストで確かめる
- 1.2: ロールと入力規則は`apps/common-lib/admin/`(`admin-roles.ts`・`admin-input-rules.ts`)。判定関数は妥当なら`undefined`を返す(設計の契約。identityの`checkNickname`の`'ok'`とは異なる)ため、呼び出し側は`undefined`を確かめてから文言を引く。理由の判定は空を受け付け、必須かどうかは操作種別で決める。`hasRole`は型の外の最低ロールで許可側に倒れるため、実行時の値を扱う5.1では値を検証してから渡す。ロールの値と`admins.role`の`enumValues`の一致は`apps/api/src/application/admin/admin-columns.unit.test.ts`
- 1.3: 操作種別は`apps/common-lib/admin/audit-action.ts`(`defineAuditAction`・`createAuditActionCatalog`・`AuditActionDefinitionError`)と`audit-actions/`(`admin-foundation.ts`の`ADMIN_ACCOUNT_INVITE_ACTION`・`ADMIN_ACCOUNT_DELETE_ACTION`・`ADMIN_ACCOUNT_ROLE_CHANGE_ACTION`・`USER_EMAIL_SEARCH_ACTION`、`index.ts`の`AUDIT_ACTIONS`)。`find`は未登録の名前で`undefined`を返す。種別を足すspecは`audit-actions/<spec名>.ts`を足して`index.ts`へ連結し、`index.unit.test.ts`の完全一致の期待値も更新する。招待の再送は`admin-account.invite`で記録する(6.3で設計の`resend`の手順との整合を確かめる)
- 1.4: `apps/frontend-lib/components/ui/table/`・`select/`(部分ごとに1ファイル)。表は親より広い間だけ包む要素が`role="region"`・`tabIndex=0`になり、名前を`TableCaption`の文言から取る(`use-scroll-region.ts`)ため、表には必ず`TableCaption`を付け、`TableHead`に`scope`を付ける(10.1で名前を`aria-labelledby`へ切り替えるかを判断する)。テストでは選択の一覧を開くと開く元の要素が支援技術から隠れるため開く前に取得し、選択肢の名前は部分一致になるため`exact: true`を使う。開いた一覧は`runAxe`を各listboxに当て、Storybookでは検査を`[data-slot="select-content"]`に絞る
- 1.5: 戻り先の検証(`toSafeReturnPath`・`toLoginSearch`・`HOME_PATH`・`LoginSearch`)とフラグメントの読み取り`readFragmentToken`は`apps/frontend-lib/utilities/auth/`(`return-path.ts`・`fragment-token.ts`)にあり、管理者側は`../lib/utilities/auth/`から読む。フラグメントを消すフック`useFragmentToken`はTanStack Routerに依存するため利用者側の`components/auth/use-fragment-token.ts`に残した。管理者側で同じフックが要る11.3・11.4では、管理者側に作るか共通部品の`components/`へ移すかを判断する
- 1.6: 共有のエラーの定義・文言・`createPasswordRejectedError`・`MAIL_SEND_POLICY`は`apps/api/src/application/auth/`(`auth-errors.ts`・`password-rejection.ts`・`mail-send-policy.ts`)。管理者側は`application/admin/admin-errors.ts`(`ADMIN_ERRORS`・`adminError`・`adminPasswordRejectedError`・`ADMIN_PASSWORD_MATCHES_IDENTITY_MESSAGE`)。`reauthentication_failed`のコード・`CURRENT_PASSWORD_INCORRECT_MESSAGE`・`loginThrottledError`は`auth/auth-errors.ts`から読む。利用者側の`application/identity/password-rejection.ts`は利用者の文言で組み立てた`passwordRejectedError`だけを持つ。6.2の`CounterAdminMailSendLimits`は`MAIL_SEND_POLICY`を読み、規則の名前の接頭辞だけを管理者用にする。`admin`から`identity`への読み込みを禁じる静的解析の規則は8.1で加える
- 1.7: `otpauth`9.6.0は`validate`の`afterCounter`・文字列の秘密鍵・数字以外の認証コードの拒否・`URI.parse`の厳格化を加えるだけで、`toString`と`validate`の時間窓の差の返し方は変わらない。`bun.lock`の行数は変わらず`.betterleaksignore`の`apps/api/bun.lock:392`の登録はそのまま有効。開発コンテナのInfisicalが未ログインでサーバーを起動できないため、利用者の多要素認証のE2E(`e2e/client/auth/two-factor.e2e.test.ts`)と実際の認証アプリでのQRコードの読み取りと照合は未実施で、開発者の手作業として12.4の報告に載せる
- 2.1: 規則は`apps/api/src/domain/admin/`(`admin-account.ts`・`admin-session-policy.ts`・`admin-auth-token-purpose.ts`)。可否の判定は許可なら`undefined`を返し、削除は自分自身→ロール不足→最上位管理者が対象の順に判定する。最後の最上位管理者の保護はユースケースが持つ。セッションはidentity-authの`evaluateSession`・`newSessionTimes`・`cookieMaxAgeSeconds`に`ADMIN_SESSION_POLICY`を渡す。トークンのハッシュの用途は`ADMIN_HASH_PURPOSES.authToken(purpose)`で、名前は技術ガイドの「小文字とハイフン」とidentity-authの`user-auth-token-email-change`の形に合わせて`admin-auth-token-invitation`・`admin-auth-token-email-change`・`admin-auth-token-password-reset`にした(design.mdの`admin-auth-token:<用途>`も改めた。9.1の招待の発行コマンドはこの名前を使う)。状態とトークンの用途の値と列の`enumValues`の一致は`application/admin/admin-columns.unit.test.ts`
- 2.2: `apps/api/src/domain/admin/audit-entry.ts`の`validateAuditEntry`は未登録の種別→理由→対象→詳細の順に判定して最初の違反だけを返し、対象は「対象を取らない種別」→件数の上限→形式の順。ユーザーの対象は`z.uuid()`(仮名化IDは`crypto.randomUUID()`の小文字のUUID。`z.uuid()`は大文字も通すため、照会の値は保存したIDから取る)、詳細の値は100書記素まで、文字列以外は拒否。成功時は整えた理由か`null`を返す。対象のIDの重複は除かない(3.1の`prepare`で判断する)。`apps/backend-lib/workers/identity/testing/identity-store-fixtures.ts`の偽物の仮名化ID(`pseudonymous-<番号>`)はUUIDの形でないため、ユーザーを対象に監査ログを記録するWorkers統合テストではUUIDの仮名化IDを使う
- 3.1: 記録・照会のユースケースとストアのポートと識別子は`apps/api/src/application/admin/`(`audit-log-recorder.ts`・`audit-log-reader.ts`・`ports.ts`・`admin-types.ts`の`ADMIN_TYPES`)。`prepare`は検証の前に対象のIDの重複を初出順で除き、違反は`validation_error`(詳細の欄`action`・`reason`・`targets`・`detail`)で警告ログには操作種別と違反の種類だけを出す。対象0件のときの対象の種類は`null`。準備の値はファイル非公開のsymbolで印を付けるため、3.2・4.1のテストは本物の記録の部品に偽のID生成を渡して`prepare`で作る。共有の偽物は既存の慣習の`testing/`(`testing/fake-audit-log-reader.ts`)に置き、design.md・research.mdの`test-support/`を改めた。不正なカーソルの拒否は3.2のストアが行う。操作種別のカタログは注入で受け取り、8.1で`ADMIN_TYPES.AuditActionCatalog`に`createAuditActionCatalog(AUDIT_ACTIONS)`を束縛する。古い監査ログの削除のメソッドは8.4でポートに加える
- 3.2: 文の組み立ては`apps/api/src/infrastructure/admin/audit-log-statements.ts`(`buildAuditLogStatements(db, entry, guard?)`は空でないタプルを返す、`isAuditGuardRejection`)。条件付きの記録は条件を満たさないと監査ログの`operator_admin_id`をNULLにしてNOT NULL制約で一括全体を取り消す方式で、操作者のID・ロール・有効の状態が要求時と一致することも確かめる。4.1の`deleteGuarded`・`changeRoleGuarded`は`db.batch([...buildAuditLogStatements(db, entry, guard), ...操作の文])`の順(監査ログの挿入を先頭)にし、`isAuditGuardRejection`なら`'rejected'`を返す。ロール変更の条件は対象の現在のロールが読んだ値と一致することを見ないため、4.1で条件に加えるかを判断する。対象の行の挿入はD1のバインド変数の上限から1文16行(design.mdの25行を改めた)。ストアは`d1-audit-log-store.ts`の`D1AuditLogStore`で、8.1で`ADMIN_TYPES.AuditLogStore`へ束縛する。Workers統合テストの補助は`testing/admin-store-fixtures.ts`(`insertAdmin`・`clearAdminTables`・`createAuditLogRecorder({ ids })`・`adminIdOf`・`auditLogIdOf`・UUIDの`pseudonymousIdOf`)で4.1・4.2も使う
- 4.1: 管理者の全ポートと型は`apps/api/src/application/admin/ports.ts`、識別子は`ADMIN_TYPES`(束縛は8.1)。ストアは`infrastructure/admin/d1-admin-account-store.ts`の`D1AdminAccountStore`。`changeRoleGuarded(operator, { targetId, fromRole, toRole }, audit)`で、条件は対象の現在のロールが`fromRole`と一致することも求める(`AuditGuard`のロール変更は`{ fromRole, toRole }`)。`activate`は招待中・パスワードとニックネームの仮の保存済み・照合した保留の秘密鍵(`pendingSealedSecret`)が期限内で残っていることを条件にし、満たさなければ`'not-invited'`(再送も同じ方式)。招待・再送は`NewAdminInvitationToken { tokenHash, expiresAt }`を受け取り、トークンの期限を招待期限にも使う。4.2はセッション・トークン・第2要素の待ち・TOTP(`commitPendingRevokingSessions`)・リカバリコード(`count`・`replaceAllRevokingSessions`)のポートを定義どおり実装し、期限切れの削除は`limit`を受け取る。テストの補助は`testing/admin-store-fixtures.ts`。design.mdの`delete`は他の取り消しの原因を`forbidden`、保護の節は`admin_state_conflict`としているため6.6で揃える。資格情報の変更で第2要素の待ちは消さない(要件とidentity-authどおり)
- 4.2: ストアは`infrastructure/admin/`の`D1AdminSessionStore`・`D1AdminAuthTokenStore`・`D1AdminLoginChallengeStore`・`D1AdminTotpCredentialStore`・`D1AdminRecoveryCodeStore`(束縛は8.1)、TOTPの状態を条件にした文は`admin-totp-conditional-writes.ts`(identity-authの写し)。期限切れの削除は`id IN (SELECT … LIMIT ?)`の1文で`limit`を検証しないため、8.4のジョブは正の定数を渡す。`clearExpiredPending`は行を消さず保留の列をNULLにし、`commitPendingRevokingSessions`は`enabledAt`を変えない。`savePending`は条件無しのupsert。テストの補助に`insertAdminSessions`・`adminSessionIdsOf`・`readAdminSessionIdsOf`・`insertAdminTotpCredential`・`readAdminTotpCredential`・`insertAdminRecoveryHashes`・`readAdminRecoveryHashes`・`placeholderCountOf`を加えた。`savePending`→`activate`のストアをまたぐ流れは4.3以降の統合テストで突く
- 4.3: 発行と`prepareAdminSession`(保存せずに行を組み立てる。6.3の招待の完了で`activate`へ渡す)は`application/admin/admin-session-issuer.ts`(`ADMIN_SESSION_USER_AGENT_MAX_LENGTH`)、検証は`admin-session-verifier.ts`の`AdminSessionVerifier`。束縛は最小の`ADMIN_MODULE`(`composition/admin-module.ts`、`MODULES`の`IDENTITY_MODULE`の後、`bindStores`・`bindUseCases`に分割)で、8.1はこのモジュールを拡張する。`composition/session.ts`は`AUTH_TYPES.AdminSessionVerifier`を`ADMIN_TYPES.AdminSessionVerifier`へ`toService`で転送する(identity-authのImplementation Notes 8.1の「管理者側を常に無効で検証する」は古い記述になった)。テストの補助は`apps/api/test/support/graphql-gateway.ts`(`createGraphQLGateway`、identityの補助から汎用部分を移した)と`admin-graphql-harness.ts`(`createAdminGateway({ documents, schemaModules, overrides })`・`createAdminTestContainer`・`issueAdminSession(adminId, { now })`)。8.2のbot判定と外部サービスの偽物はidentityの補助の`stubExternalServices`を使うか`graphql-gateway.ts`へ移す
- 5.1: アクセス制御は`application/admin/admin-authorizer.ts`(`StoreAdminAuthorizer`・`CurrentAdmin`)。呼び出し元が管理者側でない→`forbidden`、管理者として認証されていない(匿名・利用者・存在しない・招待中)→`unauthenticated`、ロール不足→`forbidden`、型の外の最低ロールは読み取りの前に`Error`。GraphQLの拒否はHTTP 200でエラーコードだけを返す(`backend/004`の方針。要件17.1の403はコードの対応で満たす)。リゾルバは`presentation/graphql/admin-guard.ts`の`requireAdmin(context, minimum)`・`requireSelfOrRole(context, ownerAdminId, minimum)`を使う。`AdminAuthorizer`と`AdminAccountStore`(`D1AdminAccountStore`)は`ADMIN_MODULE`に要求ごとに単一で束縛済みのため、8.1で二重に束縛しない。照会口は`backend-lib/core/admin/{ports,identifiers}.ts`と`workers/admin/{d1-admin-directory,admin-platform-module}.ts`(`Omit<AppModule, 'routes'>`、design.mdも改めた)で、8.1でapi・eventの`modules.ts`へ加える。`status = 'active'`は`.inlineParams()`のリテラルにしてIDを100件ずつ照会する。権限の拒否のログ(design.mdのMonitoring)は未実装で、8.2・8.3のリゾルバかGraphQLの操作のログで扱うかを判断する
- 6.1: `StoreAdminLogin`(`application/admin/admin-login.ts`、`ADMIN_LOGIN_CHALLENGE_TTL_SECONDS`)は、第2要素の待ち・TOTP・リカバリコードのストアとともに`ADMIN_MODULE`へ束縛済み(8.1で二重に束縛しない)。主体に依存しないロックの確認と第2要素の照合を`application/auth/`(`login-throttle-check.ts`の`checkLoginThrottle`、`second-factor-check.ts`の`checkSubjectSecondFactor`・`isTotpEnabled`・`SecondFactorScheme`)に作り、identityの同名の関数は委譲だけにした。管理者側は`admin-login-throttle-check.ts`(`checkAdminLoginThrottle`・スコープ`admin`)と`admin-second-factor-check.ts`(`checkAdminSecondFactor`・`adminTotpSecretContext(adminId)`=`admin:<ID>`)で、6.2・6.5も使う。6.3は秘密鍵を`adminTotpSecretContext`で封をする。テストの偽物は`application/admin/testing/admin-login-fakes.ts`(`RESETTING_ADMIN_TOTP`は「現在の秘密鍵が一致せず保留が一致する」状態で、定数名が逆向きに読めるため注意)。ログイン成否のログ・bot判定・ログアウト後のCookieの消去・呼び出し元の制限は8.2のリゾルバで行う
- 6.2: `StoreAdminReAuthenticator`(`application/admin/admin-re-authenticator.ts`、`AdminReAuthenticationInput`、`ADMIN_TYPES.AdminReAuthenticator`)と`CounterAdminMailSendLimits`(`infrastructure/admin/counter-admin-mail-send-limits.ts`)は`ADMIN_MODULE`に束縛済み(8.1で二重に束縛しない)。本人確認の入力の型とエラーの組み立ては`application/auth/re-authentication.ts`、送信回数の数え方は`infrastructure/auth/mail-send-counters.ts`の`consumeMailSendCounters`(規則の名前の接頭辞を主体ごとに渡す。利用者は`auth-mail`、管理者は`admin-auth-mail`)に共有化した。本人確認の詳細の欄は相対の経路(`currentPassword`・`secondFactor`・`secondFactor.totpCode`・`secondFactor.recoveryCode`)で、8.3のリゾルバが`reAuthentication.`を付ける。`admin-login-fakes.ts`の`setupAdminReAuthenticator`は本物の組み立てのため、6.4・6.5は`AdminReAuthenticator`の偽物を自分で作る
- 6.3: `StoreAdminInvitation`(`application/admin/admin-invitation.ts`、`ADMIN_TOTP_SETUP_TTL_SECONDS`=600は6.5も使う、`ADMIN_TYPES.AdminInvitation`)は`ADMIN_MODULE`に束縛済みだが、依存の`AdminAuthTokenStore`・`AuditLogRecorder`・`AuditActionCatalog`・`AuditLogStore`・`AdminMailer`・`AdminSettings`が未束縛で今は解決できない。8.1でこれらを束縛し、`admin-module.worker.test.ts`の解決の表に`AdminInvitation`を加える。招待のリンクの無効は`adminInvitationLinkError`(再送の依頼を添える)、ニックネームの違反は`adminNicknameRejectedError`(欄`nickname`、文言`ADMIN_NICKNAME_MESSAGES`を8.2の招待の完了と8.3のプロフィールの更新のリゾルバの検証でも使う)。ニックネームが`@`を含むとTOTPのラベルは`管理者`だけ(`OtpauthTotpAuthenticator.buildUri`の検査のため)。メールの送信の失敗は招待の書き込みの後に投げ、再試行は`admin_email_in_use`になるので再送を使う。2段目でトークンを消費した後に`activate`が`not-invited`なら`invalid_link`。テストの偽物は`testing/admin-invitation-fakes.ts`。`VALIDATION_ERROR_MESSAGE`の写しが4か所にある(共通化は後続の判断)
- 6.4: `StoreAdminPasswordReset`・`StoreAdminEmailChange`・`StoreAdminPasswordChange`(`application/admin/admin-password-reset.ts`・`admin-email-change.ts`・`admin-password-change.ts`、`ADMIN_TYPES`の同名)は`ADMIN_MODULE`に束縛済みだが、`AdminAuthTokenStore`・`AdminMailer`が未束縛で今は解決できない(8.1で`admin-module.worker.test.ts`の解決の表に加える)。トークンの組み立ては`admin-auth-token-issuance.ts`の`prepareAdminAuthToken`、操作者の行の読み直しは`admin-operator-record.ts`の`requireOperatorRecord`(6.5も使う)。リンクのメールと完了のメールの送信の失敗はログ(属性は`adminId`だけ)に留めて成功を返す(6.3の招待は例外を投げる)。パスワード変更は即時で`issue`、メールアドレス変更の確定は`reissueForOperator`。`password_rejected`の詳細の欄は`newPassword`で、8.2・8.3のリゾルバが入力の形に合わせて経路を足す。bot判定と認可はリゾルバで行う。テストの偽物は`testing/admin-credential-change-fakes.ts`(`AdminReAuthenticator`の偽物を含む)
- 6.5: `StoreAdminTotpManagement`(`application/admin/admin-totp-management.ts`、`startReset`・`completeReset`・`regenerateRecoveryCodes`、`IssuedAdminRecoveryCodes`、`ADMIN_TYPES.AdminTotpManagement`)は`ADMIN_MODULE`に束縛済みだが、`AdminSettings`が未束縛のため8.1で解決の表に加える。完了と再発行は全セッションを消した後に`AdminSessionIssuer.issue`で操作した端末へ発行し、8.3のリゾルバがセッションの入れ替えを指示する。完了は本人確認を求めず(要件12.1・GraphQLの引数どおり)、`not-pending`は`totp_setup_expired`、再発行の`not-enabled`は`unauthenticated`。認証アプリのラベルは`admin-invitation.ts`の`adminTotpAccountLabelOf`。偽物は`testing/admin-totp-management-fakes.ts`。`completeReset`は認証コードの誤りの回数を制限しないため(利用者側の`enable`と同じ)、8.3で呼び出し元ごとの制限を掛けるかを判断する
- 6.6: `StoreAdminAccountManagement`(`application/admin/admin-account-management.ts`、`AdminAccountView`・`toAdminAccountView`・`eraseAvatarQuietly`)と`StoreAdminProfile`(`admin-profile.ts`、`ADMIN_AVATAR_UPLOAD_PURPOSE`は8.1の`upload-purposes.ts`でも使う)は`ADMIN_MODULE`に束縛済みだが、`AuditLogRecorder`・`AuditLogStore`・`AuditActionCatalog`が未束縛のため8.1で解決の表に加える。条件付きの書き込みの取り消しの後は削除・ロール変更とも読み直して`not_found`・`last_super_admin`・`admin_state_conflict`に揃えた(design.mdの`delete`も改めた)。操作者の状態は`admin-authorizer.ts`の`operatorSnapshotOf`(6.3と共有)。プロフィールの違反は`adminProfileRejectedError`(欄`nickname`・`title`、`ADMIN_TITLE_MESSAGES`)、画像の紐付けの失敗は`invalid_upload`(422)。画像の紐付けの所有者はアップロードした操作者で、削除は行が参照するIDで行う。画像の即時の削除の失敗は`warning`のログ(`['api','admin','account'|'profile']`、例外と`adminId`)に留める(design.mdのMonitoringと`infra/004`の表を改めた)。署名に`meta`を加え、`changeRole`・`update`は`AdminAccountView`を返す。2人の管理者の操作が重なると紐付け済みで参照されない画像が残る競合や、削除中の対象の更新が0行で成功する競合は、4.1のポートの変更が要るため未対応。偽物は`testing/admin-account-management-fakes.ts`
- 7.1: 種別は`backend-lib/core/email/kinds/admin.ts`(`admin.invitation`・`admin.email-change-confirmation`・`admin.email-changed`・`admin.password-reset`・`admin.password-reset-completed`・`admin.password-changed`、リンクの検査はidentityと共有の`kinds/link-url.ts`)、メール送信の部品は`infrastructure/admin/email-admin-mailer.ts`の`EmailAdminMailer`(有効な管理者のニックネームがnullなら宛先を含まない`Error`)、テンプレートは`event/src/infrastructure/email/templates/admin/`。完了の3種のメールはボタンを持たず、他の管理者への連絡を促す。8.1で`ADMIN_TYPES.AdminMailer`→`EmailAdminMailer`と`AdminSettings`(`ADMIN_SITE_ORIGIN`・TOTPの発行者名)を束縛し、解決の表に加える。文言規則(`docs/GUIDES/service/design/003-text-and-copy-rules.md`)に件名と「管理者の認証系メールの本文」の節を加えた(12.3で経路を`002-page-layouts.md`へのリンクに改め、`project-values.md`のメール種別に6種を加える)。Mailpitへの表示はスクラッチパッドのスクリプトで本物のレンダラーとプロバイダから確かめたが、APIサーバー→Queue→イベントサーバーを経る経路はInfisicalが未ログインのため未確認で、開発者の手作業として12.4の報告に載せる
- 8.1: `ADMIN_MODULE`の束縛は`bindStores`(`AdminAuthTokenStore`・`AuditLogStore`を追加)・`bindServices`(`AuditActionCatalog`はモジュールの読み込み時に組み立てる定数、`AdminSettings`は要求ごとに単一、`AdminMailer`)・`bindAuditLog`(`AuditLogRecorder`・`AuditLogReader`)・`bindUseCases`で、`ADMIN_TYPES`の25の識別子と1対1。TOTPの発行者名は`admin-module.ts`の`ADMIN_TOTP_ISSUERS`(`APP_ENVIRONMENT`で選ぶ。12.3で`project-values.md`へ)。`ADMIN_PLATFORM_MODULE`はapiでは`IDENTITY_MODULE`の後、eventでは`EVENT_IDENTITY_MODULE`の後。管理者→利用者の読み込みの禁止は`apps/api/eslint.config.ts`の`ADMIN_LAYER_RULES`で、`IDENTITY_LAYER_GROUP`は`identity`という名前のフォルダへの読み込みを全て禁じて`lib`・`common-lib`・`db`の下を許し直す(認証部品の規則も共有。`src`の下に`lib`という名前のディレクトリを作るとすり抜ける)。`composition/admin-module.ts`は`./identity-*`の合成のファイルも読めない。違反例は`test/config/admin-layer-rules.unit.test.ts`、補助は`test/support/layer-lint.ts`(800行の上限のため分けた。design.mdも改めた)。8.2・8.3の`modules/admin/`はBunで読み込む規則と利用者の禁止の両方を受ける。`createAdminTestContainer(envOverrides)`は環境の上書きを受け取る。シークレットを注入したAPIサーバーの起動は未確認(開発者の手作業)
- 8.2: モジュールは`presentation/graphql/modules/admin/`(`type-defs.ts`は8.2の操作の分だけで、8.3がAdminAccount・監査ログの型・`AdminReAuthenticationInput`・`AuditLogFilterInput`と残りの操作を同じファイルに足して`index.ts`で表をまとめる。`inputs.ts`・`resolver-support.ts`(`adminOnly`・`ADMIN_BOT_ACTIONS`・`adminRequestMetaOf`・`issueSession`・`loadAdminViewer`・`currentAdminViewer`・`adminConfirmationResult`・`ADMIN_ROLE_VALUES`)・`login-resolvers.ts`・`credential-resolvers.ts`)。`codegen.config.ts`に`AdminViewer`のmappers(`AdminViewerSource`)を加えた。認証の入力の規則と文言は`presentation/graphql/auth-inputs.ts`で利用者側と共有(identity-authのdesign.mdも改めた)。bot判定の失敗はGraphQLでは200と`bot_verification_failed`、到達不能は503(`backend/004`の方針。タスク本文の「403」は種類の意味)。bot判定の偽物は`test/support/graphql-gateway.ts`へ移し、管理者のテストの補助は`admin-graphql-harness.ts`(`RECORDING_ADMIN_MAILER_MODULE`・`sentAdminMails`・`prepareActiveAdmin`・`insertInvitation`・`insertEmailChangeToken`)と`admin-graphql-operations.ts`(`installAdminGraphQLTest`・`adminLogin`・`currentTotpCode`)。パスワードの引数には説明を付けて印字されたスキーマで1行ずつにする(Betterleaks、`security/001`に記載)。権限の拒否のログ(design.mdのMonitoring、呼び出し元の拒否を含めるか)は8.3で判断する
- 8.3: リゾルバは`modules/admin/`の`account-resolvers.ts`・`self-resolvers.ts`・`audit-log-resolvers.ts`、`resolver-support.ts`に`AdminAccountSource`・`toAdminAccountSource`・`avatarOf`・`withReAuthenticationPath`(`reauthentication_failed`だけに`reAuthentication.`を付ける)、`codegen.config.ts`の`AdminAccount`のmappers。汎用の`withInputPath`は`presentation/graphql/field-paths.ts`へ移した(identity-authのImplementation Notes 8.2の`errors.ts`の記述は古い)。権限の拒否のログは`admin-guard.ts`(`['api','admin','authorization']`、管理者側の呼び出し元のロール不足だけ、属性は`requiredRole`)、対象で判定する拒否は操作のログの`forbidden`で追う(`infra/004`に記載)。`completeAdminTotpReset`の誤りの回数の制限は掛けない(本人確認を経た10分の保留とIPごとの上限で足りると判断)。監査ログの検索の文字列の条件は空文字を未指定とし64文字まで、256文字を超えるカーソルは`validation_error`(欄`after`)・それ以外の不正は`invalid_cursor`。11.1の画面の操作の文書は、テストの文書(`admin-graphql-operations.ts`の`ADMIN_OPERATIONS`、操作名`AdminInvite`など)の引数に合わせる。テストでTOTPでログインした直後に同じ時間窓のTOTPで本人確認すると使用済みで失敗するため、`issueAdminSession`でセッションを作る
- 8.4: ジョブは`application/admin/jobs/admin-credential-cleanup-job.ts`(`ADMIN_CREDENTIAL_CLEANUP_LIMIT`=500、`AdminDailyJobError`)と`audit-log-retention-job.ts`(`auditLogRetentionCutoff`は3年前のUTCの暦の同じ時刻以前で2/29は2/28に繰り下げる、`AUDIT_LOG_DELETE_BATCH_SIZE`=500、`AUDIT_LOG_DELETE_MAX_BATCHES`=20)、識別子は`ADMIN_TYPES.AdminCredentialCleanupJob`・`AuditLogRetentionJob`(計27)で`admin-module.ts`の`bindJobs`が束縛し、`composition/scheduled-jobs.ts`に4:21の順序200・210で登録した。ポートは`AuditLogStore.deleteOccurredUntil(cutoff, limit)`(対象の行→監査ログを同じ並びの部分問い合わせで1つのbatch)。ログのカテゴリは`['api','admin','credential-cleanup']`・`['api','admin','audit-log-retention']`。search-moduleのWorkers統合テストが4:21の全ジョブを完全一致で列挙するため、ジョブを足すspecはそれも更新する。上限を超える行を入れるテストは再帰CTEの1文で入れる(`admin-module.scheduled.worker.test.ts`)。`--test-scheduled`での起動の確認は未実施で開発者の手作業(`infisical run --env dev -- bun run dev`の後に`curl "http://localhost:48042/cdn-cgi/local/scheduled?cron=21+12+*+*+*"`)。12.3で日次タイムラインの表と`project-values.md`へ加える
- 9.1: 部品は`apps/api/scripts/admin/invitation-sql.ts`(`sqlStringLiteral`は`'`を二重にし`\p{Cc}`を拒否、12.1の`e2e/support/local-d1.ts`が読む。`buildLookupSql`・`buildInvitationSql`)と`invitation-targets.ts`(`invitationTarget`・`INVITATION_TARGETS`、オリジンは`wrangler.jsonc`の値と一致することをテストで確かめる)。トークンの挿入は招待中の管理者のIDを部分問い合わせで読み、照会の後に有効になっていればNOT NULLで失敗する(ローカルの`--file`は全体が取り消されることを確認、`--remote`の原子性は未確認)。招待中の管理者を昇格する場合、保存済みのメールアドレスの大文字小文字は元のまま。9.2はハッシュの用途`ADMIN_HASH_PURPOSES.authToken('invitation')`と期限`ADMIN_AUTH_TOKEN_TTL_SECONDS.invitation`を使う。SQLのテストは全マイグレーションをメモリ上のbun:sqliteに適用する(`Database.exec`は非推奨で`run`を使う)
- 9.2: 入口は`apps/api/scripts/admin/issue-super-admin-invitation.ts`(環境変数と実物の部品を組み立てるだけ)、処理は`super-admin-invitation.ts`の`runSuperAdminInvitation`(Wrangler・一時ファイル・トークンの生成・時刻・ID・出力を注入。カバレッジの都合で分けた。design.mdも改めた)、パッケージのスクリプトは`admin:invite-super-admin`。出力の行`招待のリンク: <URL>`と`有効期限: <UTCの文> [<ISO>]`を12.1の補助が読む。一時ファイルは`/tmp/super-admin-invitation-*/invitation.sql`(0600、ハッシュだけ)。ペッパーは`infisical --telemetry=false run --env <dev|staging|prod>`で注入し、子のWranglerには渡さない。`--target local`の動作はテスト用のペッパーで確かめた(本物のペッパーでの実行と画面からの完了は開発者の手作業)。design.mdの「AIエージェントはClaude設定のdenyで実行できない」は現状では成り立たない(`.claude/settings.json`の`wrangler d1 * --remote`のdenyはBunの中の子のWranglerに効かない)ため、開発者がdenyに`admin:invite-super-admin`の`--target staging|prod`を拒否する規則を加えるか、記述を改める(12.4の報告に載せる)
- 10.1: 部品は`apps/frontend-lib/components/admin/`の`AdminPageHeader`・`AdminDataTable`・`AdminFilterBar`、文言は`utilities/messages/admin-console-messages.ts`(ページ送り・前へ・次へ・絞り込み・適用・解除。12.3で文言規則へ加える)、ストーリーの分類は「管理画面/<部品名>」、使い方は`005-shared-components.md`の「管理画面の部品」の節(10.2・10.3も同じ節とファイルへ加える)。表の名前は視覚的に隠した`TableCaption`。ページ送りのボタンは`disabled`にせず`aria-disabled`で、読み込み中・エラーの間も`<nav>`を描いてフォーカスを保つ(`004`の「操作できない状態」。10.2・10.3でもフォーカス中に使えなくなるボタンは同じ形にする)。`pagination`を渡すと前後とも無くても`<nav>`を描くため、複数ページになり得る一覧にだけ渡す。読み込み中は表の領域に`aria-busy`を付けるが、その中に`LoadingSkeleton`の`role="status"`があり読み込み中の読み上げが遅れ得る(`EditorPlaceholder`は`role="status"`を`aria-busy`の外に置く)ため、12.4で揃えるかを判断する。既存の`button.browser.test.tsx`は遷移中の背景色を読んで不安定に失敗することがある
- 10.2: `components/admin/`の`ConfirmActionDialog`(設計に加えて省略可の`returnFocusRef`)・`ReasonField`・`AdminAvatar`(省略可の`alt`、既定は空。配色の種はニックネーム)と、理由の検証の`reason-schema.ts`の`REASON_SCHEMAS`(APIと同じ`trimWhiteSpace`・`checkAuditReason`・`AUDIT_REASON_MAX`と文言)。理由の欄に結び付くサーバーのエラーは`AppForm`が欄に示し、`failureMessageOf`は欄に結び付かない失敗だけに使う。処理中は確定を`aria-disabled`・`aria-busy`、キャンセルを`aria-disabled`、右上の「閉じる」を`closeButtonDisabled`にし、外の押下で`<body>`へ落ちたフォーカスを`onBlur`でダイアログへ戻す(`ImageCropDialog`と同じ形。処理中に閉じる要求を無視するダイアログは同じ扱いにする)。vitestのブラウザテストの`toBeDisabled()`は`aria-disabled`も無効とみなすため、本当に`disabled`かは`toHaveAttribute('disabled')`で確かめる
- 10.3: `components/admin/`の`CategoryMasterEditor`(設計に加えた省略可の`validateHandle`は妥当なら`undefined`・違反なら文言を返し、描画のたびに作り直さない関数で渡す。design.mdも改めた)・`CategoryFormDialog`、文言は`admin-console-messages.ts`の`CATEGORY_*`ほか。行のボタンは見える文言を`aria-hidden`にし名前を`sr-only`の1要素に持たせる(`sr-only`と見える文言を並べるとChromiumが名前に空白を入れる)。権限が無いときは本当の`disabled`。削除の確認の戻り先は成功したときだけ見出しを入れる専用のref(取り消しは開いた元の行のボタンへ戻す)。状態で開くダイアログは開くたびに増やす数を`key`にし、閉じる動きの最中の開き直しで前の入力や失敗の文言を残さない。処理中のダイアログの扱いは`ConfirmActionDialog`からの複製(共通化は後続の判断)。後続spec(inquiry-chat・help-center・content-reporting・product-launch)はシステム標準のカテゴリの名前の変更を全て拒否するが部品は編集を押せる点、削除の確認に付け替えの件数や監査ログの旨を求める点(help-centerは理由を持たないとする)は、設計のpropsで表せず未対応で、開発者の判断を要する(12.4の報告に載せる)
- 11.1: 操作の文書は`apps/admin/src/graphql/operations/admin/`の21個(`viewer.graphql`・`auth/`・`account/`・`self/`・`audit/`、アバターは`{ id objectKey fallbackFormat width height }`で`id`はプロフィールの編集で画像を保つためにも使う)。ログイン中の管理者は`src/graphql/admin-viewer.ts`(`loadRootAuthContext`・`adminViewerQueryOptions`・`toAdminViewer`、ロールは共有の小文字の`AdminRole`へ変換)、ロールの変換は`admin-role.ts`(`fromGraphQLAdminRole`・`toGraphQLAdminRole`)。ログイン必須の判定は`components/auth/require-admin-viewer.ts`(`redirect({ href })`)、ログイン中のログイン画面の移動は`redirect-signed-in-admin.ts`、文脈を配る部品は`authenticated-layout.tsx`、文脈とフックは`components/layout/use-current-admin.ts`(`useCurrentAdmin`・`useAdminRole`)、Providerは`admin-viewer-context.tsx`、`RoleGate`は`role-gate.tsx`。経路のファイルは子の経路が無いとルートの生成が失敗するため作っていない: 11.2で`routes/_authenticated/route.tsx`(`beforeLoad: requireAdminViewer`・`component: AuthenticatedLayout`)をダッシュボードの`_authenticated/index.tsx`と同じ変更で作り、仮の`routes/index.tsx`を消す。11.3の`/auth/login`は`validateSearch: toLoginSearch`・`beforeLoad: redirectSignedInAdmin`・`toSafeReturnPath`を使い、経路ができたら`requireAdminViewer`の`href`を`to`・`search`へ戻すかを判断する。11.5以降は11.2の後。`test/page-router.tsx`を使うテストは`execute-graphql.ts`を差し替える(`cachedViewer`・`test/admin-viewer-fixtures.ts`)。`AdminViewer`のクエリはリカバリコードの残数とメールアドレスも選ぶため全ページのSSRで数えるが、管理者側の通信量では軽く設計とも矛盾しないため残した。既存の`/system/status`はログイン必須の領域の外に残る(要件20.1との関係を12.xで判断)。ローカルで`/accounts`から`/auth/login?redirect=...`へ移る確認は11.5と12.1のE2Eへ持ち越す
- 11.1(コミット時): 管理者側の操作はパスワードを引数で直接受け取る(SDLの形)ため、操作の文書と許可リスト・持続化した文書の生成物の`$password: String!`をBetterleaksの`generic-password`が誤検知した。ルートの`.betterleaks.toml`に、規則・パス(`.graphql`・`graphql/generated/allowlist.json`・`persisted-documents.json`)・一致(パスワードの変数と型名`String!`だけ)を絞った`[[allowlists]]`を加え、`security/001`に記した(同じファイルの本物の秘密の文字列は検出されることを確かめた)
- 11.2: メニューの登録箇所は`apps/admin/src/composition/admin-navigation.ts`(`ADMIN_NAV_ITEMS`、`/` 10・`/accounts` 140・`/audit-logs` 150・`/account` 160、並びは`components/layout/admin-nav-order.ts`)、カードの登録箇所は`composition/dashboard-cards.ts`(空)、区画は`composition/layout-slots.ts`・`components/layout/admin-navigation.tsx`・`admin-account-menu.tsx`、ダッシュボードは`components/dashboard/dashboard-grid.tsx`・`dashboard-card-frame.tsx`(`DashboardCardState`)・`components/pages/dashboard-page.tsx`、経路は`routes/_authenticated/route.tsx`・`index.tsx`(仮のトップページは削除)。区画の部品はキャッシュから`useAdminViewer`で読み、セッションの確定・入れ替え・ログアウトの後は`useAdminViewerRefresh`(取得の無効化→`router.invalidate()`)を呼ぶ(11.3・11.4・11.7も使う)。`PathLink`は共有の`apps/frontend-lib/components/navigation/path-link.tsx`へ移した(省略可の`activeOptions`、identity-authのImplementation Notes 10.3・10.5・10.6の旧パスは古い)。メニューの項目を足すspecは`admin-nav-order.unit.test.ts`と`test/admin-shell.browser.test.tsx`の期待を更新する。`ADMIN_LAYOUT_SLOTS`や`page-router`を読み込むブラウザテストは`execute-graphql.ts`を差し替える。`test/page-router.tsx`の`renderInRouter(element, { path, cachedViewer })`。`test/admin-shell.browser.test.tsx`のログアウトのテストはテストのルーターの仮のログインの経路を使うため、11.3で本物の経路の設定に替える。新しい文言(管理メニュー・メニュー・ログアウトしました。・表示できる項目はまだありません。)は12.3で文言規則へ。ローカルの画面での確認は開発者の手作業
- 11.3: 画面は`apps/admin/src/components/auth/`(`login-form.tsx`・`second-factor-form.tsx`・`password-reset-request-form.tsx`・`new-password-form.tsx`・`auth-form-schemas.ts`・`admin-auth-messages.ts`・`bot-actions.ts`・`use-signed-in-navigation.ts`)、経路は`routes/auth/login.tsx`・`password-reset/{index,confirm}.tsx`。`useFragmentToken`・`AuthPageLayout`・`ResultNotice`・`INLINE_LINK_CLASS_NAME`・`isInvalidLinkError`を利用者側から共有の`frontend-lib`(`components/auth/`・`components/feedback/`・`components/navigation/`・`utilities/auth/invalid-link.ts`)へ移した(1.5の「`useFragmentToken`は利用者側に残した」は古い。使い方は`005`の「認証の画面部品」「結果の文言」「パスへの遷移」)。ログインの後は`useAdminViewerRefresh`ではなく`use-signed-in-navigation.ts`(`router.invalidate()`だとログイン画面の`redirectSignedInAdmin`がダッシュボードへ移し戻り先が壊れる)、リセットの完了の後は`useAdminViewerRefresh`。`requireAdminViewer`は`to`・`search`に戻した。管理者側の操作は最上位の引数のため`serverFieldPrefix`を付けない。本物のログインの経路を含むブラウザテストは`@marsidev/react-turnstile`を`lib/test/fake-turnstile.tsx`で差し替える。テストの文字列の全角空白は`　`で書く(`no-irregular-whitespace`)。新しい文言は`admin-auth-messages.ts`で12.3で文言規則へ加える。ログイン画面の必須の欄のラベルに必須の旨が無く`aria-required`だけ(`004`と食い違うが利用者側と同じ形。両アプリを揃えて直すには利用者側のE2Eの変更と実行が要るため12.4の申し送り)。画面からのログインとリセットの確認は開発者の手作業
- 11.4: 画面は`apps/admin/src/components/auth/invitation-completion.tsx`(状態は入力・TOTP・完了・無効)・`invitation-profile-step.tsx`・`invitation-totp-step.tsx`・`email-change-confirmation.tsx`、経路は`routes/auth/invitation.tsx`・`email-change/confirm.tsx`(どちらも`redirectSignedInAdmin`を付けない。付けると完了の後にダッシュボードへ移りリカバリコードが消える。別の管理者がログイン中のブラウザで完了するとセッションが置き換わり、元のセッションの記録は期限まで残る)、スキーマは`INVITATION_PROFILE_FORM_SCHEMA`・`INVITATION_TOTP_FORM_SCHEMA`。利用者側の`LinkConfirmation`を共有の`frontend-lib/components/auth/link-confirmation.tsx`(`invalidLinkMessage`・`failureMessageOf`)へ移した(identity-authのImplementation Notes 10.5の場所は古い)。`email-change-confirmation.tsx`の`/account`へのリンクは`PathLink`で、11.7で経路ができたら型付きの`Link`へ置き換える。`DateTime`を使う部品のブラウザテストは`DisplayPreferencesProvider`で包む。`aria-disabled`のボタンを押すテストは`click({ force: true })`。新しい文言は`admin-auth-messages.ts`で12.3で文言規則へ。招待の発行コマンドのリンクから画面で完了する確認は開発者の手作業(12.1のE2Eでも確かめる)
- 11.5: ページは`apps/admin/src/components/pages/admins-page.tsx`、経路は`routes/_authenticated/accounts/index.tsx`(loader `loadAdminAccounts`、`src/graphql/admin-accounts.ts`)、部品は`components/admins/`。操作の可否は`admin-account-permissions.ts`の`accountActionsOf`(ドメインの規則2.1と同じ判定)で、許可されない操作は描かない。自分の行は削除とプロフィールの編集を描かず(本人のプロフィールは11.7の`/account`)、招待中・期限切れの行もプロフィールの編集を描かない。削除と再送は`ConfirmActionDialog`、招待とロール変更は入力のダイアログの枠`AdminFormDialog`(`useAdminFormDialogControls`・`AdminFormDialogFooter`、処理中の扱いは`ConfirmActionDialog`の複製)。開いた元の操作が成功の後に消える(削除・自分のロールを下げる)ときは、成功したときだけ見出しを入れる`returnFocusRef`で一覧の`<h2>`へフォーカスを移す。11.7はこの枠と`AdminAvatarField`(`admin-avatar`の`ImageUploadField`)・`ADMIN_PROFILE_FORM_SCHEMA`を再利用できる。メールアドレスとニックネームの規則は`auth-form-schemas.ts`の`EMAIL_INPUT_SCHEMA`・`NICKNAME_INPUT_SCHEMA`。並ぶダイアログには別々の`key`を付ける。ブラウザテストの補助は`test/admin-accounts-fixtures.ts`(`respondAdminGraphQL`・`renderAccountsPage`)。`ImageUploadField`は送信中の状態を外へ知らせないため、送信中に保存すると以前の画像のまま保存され「保存しました」が出る(共通部品の変更が要り、12.4の申し送り)。新しい文言は`admin-accounts-messages.ts`で12.3で文言規則へ
- 11.6: ページは`components/pages/audit-logs-page.tsx`(`getRouteApi('/_authenticated/audit-logs/')`)、経路は`routes/_authenticated/audit-logs/index.tsx`(`validateSearch: toAuditLogSearch`・`loaderDeps`・`loader: loadAuditLogsPage`)、部品は`components/audit/`。絞り込みとカーソルはURLの検索パラメータに持ち、不正な値は未指定として捨てる。前のページは訪れたページの記録(`cursor-trail.ts`)で、URLから途中のページを開くと1ページ目に戻る。期間は閲覧者の地域の暦で、0001〜9998年だけを受け付ける(`checkAuditPeriodInput`、範囲外はフォームでは欄の誤り)。監査ログの取得はloaderで`queryClient.query(...).catch(() => undefined)`にして失敗を一覧の中に再試行付きで示す(この形を`006`に記した)。対象の識別子は画面で正規化(UUIDは小文字、ULIDは大文字)。64文字と256文字の上限は共有の`admin-input-rules.ts`の`AUDIT_FILTER_TEXT_MAX`・`AUDIT_LOG_CURSOR_MAX`でAPIの`inputs.ts`も読む。`AdminFilterBar`の`<form>`はブラウザの検証が働くため中の入力に`min`・`max`・`required`を付けない。ブラウザテストの補助は`test/audit-logs-fixtures.ts`(経路は`audit-logs`→`/`の入れ子で経路のIDを合わせる)、ブラウザテストのロケールはen-US。対象の種類を足すspecは`AUDIT_TARGET_KIND_LABELS`に加える。新しい文言は`audit-logs-messages.ts`で12.3で文言規則へ
