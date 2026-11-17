# Implementation Plan

- [x] 1. 基盤: 共用の規則・上流の寄せ替え・テーブル・サービス仕様
- [x] 1.1 週の識別と表記、段階とラウンド名を、api・event・clientとbackend-libが読み込める唯一の共用の規則として作る
  - 前提: 上流のspec(match-engine・payments・ultras-subscription・notifications・product-launch・directory-discovery・identity-auth・email-delivery・frontend-platform・backend-platform・api-gateway・admin-foundation)の実装が済んでいること(2026-11-16に設計の上流の契約を現在のコードと照合済み。match-engineの`ByeCard`の`match.kind`による文言の切り替え(match-engineの仮7)とbackend-platformの改訂2の`e2e/support/scheduled-trigger.ts`も実装済み)。設計のAllowed Dependenciesの部品が無ければ該当するタスクを保留して開発者へ報告する
  - 開発者が行う作業(devとstagingが共用するStripeのsandboxでの、`lookup_key`が`week_tournament_entry`の価格(参考$5、税込)の1回の作成。prodはlaunch-readinessが行う)を、この最初のタスクで報告する(8.4のE2Eの前提。4.14・6.12はStripeの模擬応答を使う)
  - 先に、単体テストで、その日を含む週の月曜日(月曜日・日曜日・月またぎ)、ISO週のキーと年の境界(12/29〜1/4は翌年の第1週)と第53週の有無、キーの解釈の形式違反・年の範囲外・存在しない週、週の表記(「2026年第37週(9/7〜9/13)」)、残り参加数からの段階(8・4・2とそれ以外)、段階と回戦からのラウンド名(段階・「◯回戦」・どちらも無い)、残り参加数からのラウンド名(N = 3・4・8・13の各ラウンド)を確かめる
  - 他の層を読み込まない(日付は`YYYY-MM-DD`の文字列で扱う)
  - 完了状態: 単体テストが成功し、api・event・clientとbackend-libの型検査で規則を読み込める
  - _Requirements: 1.6, 6.8, 8.2_

- [x] 1.2 notificationsの通知文とmatch-engineのclientの表示の週とラウンド名を、共用の規則で作る形に寄せる
  - 実装前のギャップ分析の決定G2による、notificationsとmatch-engineのclientへの明示の横断(既存の規則の寄せ替え)である。公開の関数の名前・引数・表記・例外は変えない
  - notificationsの受賞の期間の表記(Weekの週)・ISO週の検証・ラウンド名と、clientのマッチの段階の印のラウンド名(GraphQLの大文字の段階を小文字にして渡す)を、1.1の規則で作る
  - 先に、既存の単体テスト(notificationsの通知文と通知イベントの契約、clientのマッチの表記)を期待値を変えずに実行して成功を確かめ、寄せ替えの後にも同じテストが期待値を変えずに成功することで表記の一致を確かめる
  - 完了状態: notificationsとclientの既存の単体テストが期待値を変えずに成功し、両者に週の表記とラウンド名の独自の実装が残っていないことを検索で確かめる
  - _Depends: 1.1_
  - _Requirements: 6.8, 12.4, 15.1_

- [x] 1.3 (P) match-engineの予選の名前のマッチの時間帯を、種別によらない名前へ改める
  - 実装前のギャップ分析の決定G5による、match-engineの定義と参照する既存のファイル(api・event・backend-libの本体とテストと補助、オンボーディングの本プロジェクト固有の値)への明示の横断である。時刻(0:00開始・23:40終了・23:45のペアリング)の値と振る舞いは変えない
  - 改名の前に`apps/`・`e2e/`・`docs/`のGit管理のファイルを`git grep -l`で数え直し(定義の`match-model.ts`と参照の22ファイルの計23ファイル)、設計のModified Filesの一覧(E2Eの手順`e2e/client/match-steps.ts`と補助`e2e/support/directory-fixtures.ts`を含む)と突き合わせる。Git管理外のカバレッジの出力は対象にしない
  - 型検査は、並行する1.2の作業が終わってから行う
  - 完了状態: `apps/`・`e2e/`・`docs/`のGit管理のファイルで旧い名前の参照が`git grep`で0件になり(承認済みのspecの記録である`.kiro/`は書き換えない)、ルート(E2Eを含む)と各アプリの型検査と、match-engine・notifications・directory-discoveryの既存のテストが期待値を変えずに成功する
  - _Boundary: match-engineのマッチの時間帯の定義とその参照(E2Eの手順と補助を含む)_
  - _Requirements: 6.1, 15.1_

- [x] 1.4 ブラケット・参加者・ブラケットのマッチ・週のトーナメント・参加の枠のテーブルとマイグレーションを作る
  - 先に、テーブルの定義の単体テストで、ブラケットの種類と識別子の一意索引、参加者の番号と枠の一意索引、マッチの位置の一意索引とマッチへの外部キーが無いこと、週の一意索引、枠のローンチの一意索引と週ごとのプロダクトの一意索引、状態・理由・返金(`already_refunded`・`rejected`を含む6値)と知らせの状態の値の制約、参加資格の状態なら出どころが必須・決済なら購入が必須の制約、外部キーに`ON DELETE`の指定が無いことを確かめる
  - mainの最新を取り込んでからマイグレーションを生成し、ローカルに適用する
  - 完了状態: 単体テストが成功し、マイグレーションをローカルのD1に適用できる
  - _Requirements: 4.7, 7.4, 13.3, 14.3_

- [x] 1.5 (P) Weekトーナメント規則・日次タイムライン・ページ配置・文言規則・返金ポリシー・決済実装方針に、本specの決定を先に書く
  - Weekトーナメント規則: 仮2(組み合わせ決定時点の非公開化・停止の除外、FR-TOURW-008)・仮3(その返金、FR-PYMNT-011)・仮5(期限の後の反映、FR-TOURW-006)の注記のうち未記載のものを加え、凍結の時点、ラウンドの遅れの回復(FR-TOURW-022)、ブラケットのページ(仮4)を加える
  - 日次タイムライン: 23:45の`tournament-week.evening-bracket`(1500。組み合わせ・進行・追いつき・通知の発行の後に、最後にnotificationsへ夜の送り出しの準備の完了を伝える。夜の送り出しは前提がそろった時点、遅くとも23:55)、4:21の表に`tournament-week.entry-follow-up`(1500)
  - ページ配置: ブラケットのページの構成(仮4)、トーナメントの区画の見出しとブラケットへの導線、トロフィーの区画の所有、参加費の導線の状態の一覧、削除の注意書き
  - 文言規則: 設計のSupporting Referencesに挙げたエラー・状態・ブラケット・返金の知らせの文言
  - 返金ポリシー: 既に更新済みの「組み合わせ決定の時点のユーザー停止やプロダクト非公開化に伴うトーナメント参加資格停止」(自動の全額返金、FR-PYMNT-011)と「トーナメントの不戦勝・不戦敗・両者敗北」(返金しない)の2行が仮3のWeekの部分と一致することを確かめ、行の文とYearと共用する行のYearの扱いは変えない。決済実装方針(`docs/GUIDES/service/features/004-payments.md`): 購入種別の表のWeekトーナメント参加費の行に、反映の期限と返金の依頼キーを加える
  - 完了状態: 6つの文書が整形の検査を通り、7のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service`の該当する6文書_
  - _Requirements: 15.6_

- [x] 2. ブラケットとWeekの純粋な規則
- [x] 2.1 ブラケットの形(シード数・ラウンド数・各ラウンドの残り参加数・段階)とシードの配置の列を作る
  - 先に、単体テストで、Nが0・1・2・3・5・6・7・8・13・100・128・129・200のP・S・1回戦のマッチ数・ラウンド数がWeekトーナメント規則の表と一致すること、配置の列(2・4・8・16)、段階が1.1の残り参加数からの段階の規則で残り8・4・2で準々決勝・準決勝・決勝になりmatch-engineの段階の型と値が一致すること、負・非整数の参加数で例外になることを確かめる
  - 完了状態: 単体テストが成功し、規則がD1を読み込まない
  - _Requirements: 5.3, 6.8, 13.1, 15.2_

- [x] 2.2 抽選番号を振る組み合わせの規則と、Weekの並びの比較を作る
  - 先に、単体テストで、Weekトーナメント規則のN = 13の例でシードがA・C・D、非シードの1回戦がE×F・G×H・I×B・J×K・L×Mになること、Upvote数・最終Upvote時間・ローンチの識別子の同順の決まった順、最終Upvote時間が無い(Upvote数0)の枠が同日の末尾になること、同じ入力で同じ番号になること、比較を差し替えると並びが変わること(Yearの再利用)を確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 5.4, 5.5, 5.11, 13.2, 13.4, 15.2_

- [x] 2.3 次ラウンドの枠と進行の判定(不戦勝・終了)の規則を作る
  - 先に、単体テストで、記録が無いときの参加0・1・2以上の判定、2回戦の枠の配置(N = 13の準々決勝がA×M5勝者・M1勝者×M2勝者・C×M4勝者・D×M3勝者)、3回戦以降の固定のブラケット、未確定のマッチがあれば待つこと、片側だけの枠が側1つのマッチになり両側が空の枠を作らないこと、1回戦M4が両者敗北のときCが準々決勝と準決勝で続けて不戦勝になる例、残り1で優勝、残り0と全滅で受賞なし、決勝の勝者と決勝の両者敗北、参加2の決勝だけを確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 5.6, 5.7, 5.8, 5.9, 5.10, 6.5, 6.6, 6.7, 7.1, 7.2, 7.3, 13.1, 15.2_

- [x] 2.4 未来のラウンドを含む表示の配置を作る
  - 先に、単体テストで、N = 13・129・200の各ラウンドの位置と、各枠がシードの番号か「前ラウンドの何番の位置の勝者」かを表すこと、2.3の進行の判定と同じ対戦になることを確かめる
  - 2.3の判定と照合するため(P)にしない
  - 完了状態: 単体テストが成功する
  - _Requirements: 9.2, 13.1_

- [x] 2.5 (P) ラウンドの実施日の方針と、Weekの期限と日程を作る
  - マッチの時間帯は持たず、1.3で改めたmatch-engineの種別によらない時間帯を使う
  - 先に、単体テストで、1回戦の日が予定の日と現在の業務日付の翌日の遅い方になること、23:45の実行で次ラウンドが翌日、翌日0:10の実行で翌々日になる(遅れ)こと、週の受付期限23:00・決済期限23:35・組み合わせ決定23:45(翌週月曜日)、1回戦の火曜日、日曜日の判定を確かめる
  - 完了状態: 単体テストが成功し、ブラケットの規則にマッチの開始・終了の時刻の定義が無い
  - _Boundary: RoundSchedule、WeekSchedule_
  - _Depends: 1.3_
  - _Requirements: 1.6, 6.1, 6.2, 6.10, 13.2_

- [x] 2.6 (P) 参加の枠の状態と、返金の理由・依頼キー・依頼の拒否の分類の規則を作る
  - 先に、単体テストで、参加資格を与えられる状態が受付中だけであること、資格の喪失は返金の理由「entitlement_lost」、停止は「entitlement_suspended」になり依頼キーが`tournament-week:<購入ID>:<理由>`になること、返金の依頼の5つの拒否の分類(支払いが無い・購入が無いは「不要」、返金できる残額が無いは「返金済み」で運用者へ知らせる、金額・依頼キーの形式の誤りは「拒否」で運用者へ知らせる)、参加資格を得た状態が特典の終了で戻らないことを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: WeekEntryRules_
  - _Requirements: 3.6, 3.8, 4.6, 4.7, 7.6_

- [x] 3. 汎用のブラケットの部品
- [x] 3.1 ブラケットのストアと、汎用の部品の束縛をapiとeventに組み込む
  - 先に、ローカルD1のWorkers統合テストで、種類と識別子での読み取り、マッチのIDからのブラケットの引き当て(90件を超える入力の分割)、勝ち残りの判定(進行中・未敗退・優勝でない)、参加者の紐付けの解除を確かめる
  - 同じく先に、識別子`TOURNAMENT_PLATFORM_TYPES`が`Symbol.for('tournament.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - 汎用の3部品の契約と型を純粋な部品(`apps/backend-lib/core/tournament/ports.ts`)に、DIの識別子`TOURNAMENT_PLATFORM_TYPES`を`core/tournament/identifiers.ts`にここで作る。api・eventとtournament-yearのapplication層が契約と識別子を読み込むため、`workers`に置かない
  - ストアのD1の実装(`apps/backend-lib/workers/tournament/d1-bracket-store.ts`)と束縛のモジュール(`workers/tournament/tournament-platform-module.ts`)をここで作り(3.2〜3.4は実装を束縛へ追記する。順に行うため競合しない)、apiとeventの束縛の一覧へ同時に加える。束縛の形は既存の共有の束縛(`createMatchPlatformModule(appName)`など)に合わせ、apiとeventで束縛に差が無ければ設計どおり定数のモジュールにする
  - 本タスクの時点で束縛されるのはストアだけで、`TOURNAMENT_PLATFORM_TYPES`の全識別子の解決は3.4の完了状態で確かめる
  - 完了状態: 単体テスト・Workers統合テストと、3経路(api・eventの`fetch`・eventの`queue`)でストアの識別子が解決できる検査が成功し、`core/tournament`が`core/week-tournament`・`workers`・`apps/db`を読み込まない
  - _Requirements: 13.3, 13.5, 14.3_

- [x] 3.2 ラウンドの進行の本体(結果の写し・次ラウンドの予定・冪等性)を作る
  - 結果は`MatchDirectory.findMatches(matchIds, now)`で読み、予定は`MatchScheduler.schedule(inputs, at)`に段階(`stage`)とmatch-engineの種別によらない時間帯の開始・終了の日時を渡して作る
  - 先に、ローカルD1(match-engineのテーブルを含む)のWorkers統合テストで、確定したマッチの勝者の写しと敗者の敗退の記録、未確定があれば待つこと、次ラウンドの位置とマッチの予定の作成(種類・ラウンド・段階・実施日・0:00と23:40・側1つと2つ)、同じブラケットを2回続けて・同時に進めても次ラウンドのマッチが1組になり先に挿入したマッチIDにそろうこと、参加200の分割の書き込みを確かめる
  - 完了状態: Workers統合テストが成功し、match-engineのテーブルに次ラウンドの予定が作られる
  - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.7, 6.9, 13.3, 13.5_

- [x] 3.3 ラウンドの進行の回復と終了を作る
  - 先に、Workers統合テストで、予定の作成の前に中断したマッチの再開、0:00を過ぎた再開で実施日が翌日になり`captureEvent`されること(ログにブラケットとマッチの識別だけが出ること)、終了の確定(優勝・受賞なし)が1回だけ`newlyFinished`になること、紐付けを解除した参加者を空の側とすることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 6.10, 7.1, 7.2, 7.3, 14.5_

- [x] 3.4 組み合わせの作成を作る
  - 先に、Workers統合テストで、候補から参加者の番号を記録し1回戦のマッチを予定すること、参加0・1でマッチを作らず終了すること、参加2で決勝だけを作ること、同じ候補での再実行で記録を重ねず続きから進めることを確かめる
  - 完了状態: Workers統合テストと、3経路で`TOURNAMENT_PLATFORM_TYPES`の全識別子が解決できる検査が成功する
  - _Requirements: 5.3, 5.8, 5.9, 5.10, 13.3_

- [x] 4. Weekの部品
- [x] 4.1 週のトーナメントと参加の枠のストアの基本(作成・一覧・引き当て・挿入)と、Weekの部品の識別子を作る
  - Weekの部品の契約と型(`NewWeekEntry`を含む。`WeekEntryOfferPolicy`・`WeekEntryFulfillment`はpaymentsの契約を実装するため除く)を純粋な部品(`apps/backend-lib/core/week-tournament/ports.ts`)に作る。ストアの契約は本タスクで実装するメソッド(作成・一覧・引き当て・挿入)だけを置き、4.2・4.3・4.11はそれぞれ加えるメソッドを契約と実装の両方へ同時に加える(各タスクの終わりに型検査が通るようにする)。Weekの全部品のDIの識別子`WEEK_TOURNAMENT_TYPES`を`core/week-tournament/identifiers.ts`にここで作る。api・eventとtournament-year・data-exportのapplication層が契約と識別子を読み込むため、`workers`に置かない。ストアのD1の実装は`apps/backend-lib/workers/week-tournament/d1-week-tournament-store.ts`に作る。束縛と登録は4.14でまとめて行い、4.2〜4.13は束縛と登録のファイルを変えない(テストは部品を直接組み立てる)
  - 先に、ローカルD1のWorkers統合テストで、週の行の作成の重複の無視、期限の到来した週と進行中の週の一覧、ローンチからの枠の引き当て(90件を超える入力の分割)、枠の挿入の重複(ローンチ・週ごとのプロダクト)を確かめる
  - 同じく先に、識別子`WEEK_TOURNAMENT_TYPES`が`Symbol.for('week-tournament.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - 完了状態: 単体テストとWorkers統合テストと型検査が成功し、`core/week-tournament`が`workers`・`apps/db`を読み込まない
  - _Requirements: 1.4, 7.4_

- [x] 4.2 参加資格を変える書き込み(Ultrasによる付与・喪失・分類)と凍結の条件をストアに加える
  - Ultrasによる付与・喪失・分類のメソッドを、ストアの契約と実装の両方へ加える
  - 凍結の書き込みのメソッドは4.11で加わるため、凍結済みの週が要るテストは凍結の状態をローカルD1へ直接書いて用意する(4.4〜4.6も同じ)
  - 先に、Workers統合テストで、Ultrasによる付与の期間の条件(勝利の確定〜決済期限)、プロダクト・投稿者ごとの喪失と返金待ちの記録(購入の有無)、分類の条件付きの更新、凍結の後に付与・喪失・分類が何もしないことを確かめる
  - 完了状態: Workers統合テストと型検査が成功する
  - _Requirements: 3.2, 3.7, 4.1_

- [x] 4.3 受賞の記録・返金と知らせの状態・物理削除をストアに加える
  - 組み合わせの記録・受賞の確定と一覧・返金と知らせの状態の更新(依頼済み・不要・返金済み・拒否・知らせの送信済みと省略)・物理削除のメソッドを、ストアの契約と実装の両方へ加える
  - 先に、Workers統合テストで、組み合わせの記録、受賞の確定が1回だけ、期間内に受賞を記録した週の一覧(`listAwardedBetween`、境界と紐付けを解除した受賞の除外)、返金待ち・知らせ待ちの一覧と状態の更新(返金済み・拒否は返金待ちの一覧から外れること)、物理削除での組み合わせに入った枠の紐付けの解除とそれ以外の枠の削除を確かめる
  - 完了状態: Workers統合テストと型検査が成功する
  - _Requirements: 4.7, 7.4, 12.4, 14.3_

- [x] 4.4 予選の勝利から参加の枠を作る部品を作る
  - 部品は呼び出し元(eventの処理・23:45のジョブ・4.11の補完)が`MatchDirectory`で読んだ確定のマッチの記録を受け取り、勝者・Upvote数・最終Upvote時間・ローンチ・ローンチ日(`matchDate`)・勝利の確定時刻(`decidedAt`)をそこから写す(確定のマッチイベントは識別子だけを運ぶ)
  - 先に、Workers統合テスト(特典の判定は偽物)で、勝利・不戦勝・相手の退会等による勝利の側に枠を作り、敗北・両者敗北・トーナメントのマッチには作らないこと、Upvote数と最終Upvote時間(開始からの経過)の確定値と勝利の確定時刻を写すこと、勝利の時点でUltrasの期間内なら参加資格(Ultras)で作ること、凍結済みの週への遅れた勝利は期限切れで記録し`captureEvent`されること、同じマッチの2回の処理で枠が1つであることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1_

- [x] 4.5 購入種別`week_tournament_entry`の可否と購入の内容を作る
  - 先に、Workers統合テスト(特典の判定・価格は偽物)で、投稿者以外・資格を得た枠・期限切れ・資格を失った枠・凍結後・表示できないプロダクト・Ultrasの期間内の拒否の理由(どの拒否もコードと文言規則の文言を持つ)、購入の内容(価格の`lookup_key`・数量1・関係のID・二重決済の鍵・受付期限23:00と決済期限23:35と反映の期限23:45・品名と分量と提供時期と追加事項)を確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 2.1, 2.3, 2.4_

- [x] 4.6 参加資格の付与(フルフィルメント)の判断と文を作る
  - 先に、Workers統合テストで、受付中の枠への付与の文と購入の記録、資格を得た枠・論理削除済みのプロダクト・投稿者の不一致の拒否、決済期限(23:35)までの反映は新しいローンチがあっても付与し、反映の時刻が決済期限より後なら新しいローンチがあれば拒否すること(23:34と23:35:00ちょうどは付与、23:35:01は拒否。仮5)、返した文を凍結の後に一括の書き込みで実行するとNOT NULL制約の違反で失敗すること、決済済みの枠がUltrasの加入で変わらないことを確かめる(paymentsの反映の経路の確認は4.14)
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 2.5, 2.7, 2.8, 3.6, 15.3_

- [x] 4.7 (P) 通知イベントの組み立てと発行を作る
  - 発行の口は1件でも違反があると何も記録せず違反の位置を返すため、違反の1件を除いて残りを発行し直し、違反が無くなるまで繰り返す(発行の前の照会は足さない、G1)
  - 先に、Workers統合テスト(発行の口は、実物と同じく1件の違反で全件を記録せず違反の位置を返す偽物)で、確定したマッチの結果と側が2つの予告を50件ずつ発行すること、受賞を賞の種類と週で発行すること、その夜の発行(`publishNight`: その日のWeekの確定したマッチの結果・翌日の側が2つのマッチの予告・ストアの`listAwardedBetween`によるその日に記録した受賞)を1回の呼び出しでそろえること(ストアは偽物)、50件の中の開始済みのマッチの予告1件だけが除かれ残りが発行され`info`のログに残ること、他の理由の違反が除かれ`error`のログに残ること、一時的な失敗を呼び出し元へ返すこと、同じ発行を2回行っても結果が変わらないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - ストアのファイルは変えない(受賞の一覧の読み取りは4.3で加える)
  - _Boundary: WeekNotificationPublisher_
  - _Depends: 4.3_
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 4.8 (P) 返金の知らせのメール種別とテンプレートを作る
  - email-deliveryの規約どおり、種別は本specのドメインのメール種別のファイル(`core/email/kinds/tournament-week.ts`の`TOURNAMENT_WEEK_ENTRY_REFUND_KIND`と`TOURNAMENT_WEEK_EMAIL_KINDS`)に、テンプレートはeventのドメインのテンプレートのディレクトリ(`templates/tournament-week/`の`TOURNAMENT_WEEK_EMAIL_TEMPLATES`)に置き、それぞれの集約点へ配列を加える(1対1の検査。eventのテンプレートの集約点への追記を含む明示の横断)
  - 先に、テンプレートのWorkers統合テスト(email-deliveryの規約の`*.worker.test.tsx`)で、件名・宛名・週の表記・ローンチ日・2つの理由の文言・決済履歴への導線と、決済の詳細を含めないことを確かめる
  - 完了状態: テンプレートのテストと、種別とテンプレートの1対1の検査が成功する
  - _Boundary: WeekEmailKinds、WeekEntryRefundTemplate_
  - _Depends: 1.1_
  - _Requirements: 4.8_

- [x] 4.9 返金の依頼と知らせの部品を作る
  - 先に、Workers統合テスト(返金の部品とメールの送信は偽物)で、返金待ちの枠の依頼(全額・理由・依頼キー)、受け付けと重複で依頼済みにして知らせ待ちにすること、拒否の分類(2.6)で支払いが無い・購入が無いは不要にしてログ(購入の識別だけ)を残し、返金できる残額が無いは返金済みにして`captureEvent`し、金額・依頼キーの形式の誤りと理由の形式違反の例外は拒否にして`captureEvent`すること、不要・返金済み・拒否の枠に返金の知らせを送らず再処理の対象から外れること、知らせの送信と退会済みの`skipped`、一時的な失敗が例外になり状態が変わらないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 4.3, 4.8_
  - _Requirements: 4.2, 4.5, 4.7, 4.8, 4.9, 14.5_

- [x] 4.10 Weekのラウンドの進行と賞の記録を作る
  - 先に、Workers統合テストで、進行中のトーナメントを進めて結果と予告を発行すること、決勝の確定・残り1で受賞を1回だけ記録して受賞を発行すること、受賞なしの記録、進行中の全トーナメントを進め1つの失敗が他を止めないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 3.3, 4.7_
  - _Requirements: 6.3, 7.1, 7.2, 7.3, 7.4, 12.1, 12.2, 12.3, 12.4_

- [x] 4.11 組み合わせ決定の前半(枠の補完・凍結・分類)を作る
  - 凍結の条件付きの書き込みと分類の対象の一覧(`listEntriesForClassification`・`listDrawnEntries`)のメソッドを、本タスクでストアの契約と実装の両方へ加える
  - 枠の補完は`MatchDirectory.listForDate({ date, kinds: ['qualifier'], now })`を週の7日分読む
  - 先に、Workers統合テスト(特典の判定は偽物)で、週の予選の勝利の枠の補完、23:44には対象にならず23:45で対象になること、凍結の条件付きの記録と凍結済みからの再開、分類(可視は組み合わせの対象、非公開化・停止は除外と返金待ち、論理削除済みは喪失と返金待ち、受付中でUltrasの期間内は参加資格、それ以外は期限切れ)、凍結と同時の削除・Ultrasの加入・反映で分類の対象が変わらないこと、参加200の分類の分割を確かめる
  - 完了状態: Workers統合テストと型検査が成功する
  - _Depends: 4.2, 4.4_
  - _Requirements: 1.5, 3.5, 4.4, 5.2, 13.5, 15.3_

- [x] 4.12 組み合わせ決定の後半(組み合わせ・記録・後処理)を作る
  - 先に、Workers統合テストで、参加資格のプロダクトでの組み合わせとマッチの予定、参加1の即時の受賞、参加0の終了、返金の依頼と知らせ・予告の発行、週ごとの失敗が他の週を止めないこと、ログとエラートラッキングの出力にプロダクトの名称・メールアドレス・ハンドルが含まれず識別と件数だけであることを確かめる
  - 完了状態: Workers統合テストが成功し、23:45の実行に相当する呼び出しで1回戦の予定がmatch-engineのテーブルに作られる
  - _Depends: 3.4, 4.9, 4.10_
  - _Requirements: 4.5, 5.1, 5.8, 5.9, 14.5_

- [x] 4.13 (P) Week優勝の照会と受賞のエクスポートの部品を作る
  - 先に、Workers統合テストで、受賞の期間の照会(起点なし・起点あり・紐付けを解除した受賞の除外・受賞の昇順)と、ローンチごとの受賞(`product_of_the_week`とISO週)を確かめる
  - 4.1の`core/week-tournament/ports.ts`の契約を満たすD1の実装を`workers/week-tournament/d1-week-champion-directory.ts`・`d1-week-award-export.ts`に作る
  - 完了状態: Workers統合テストが成功する
  - _Boundary: WeekChampionDirectory、WeekAwardExport_
  - _Depends: 4.1_
  - _Requirements: 7.5, 14.4_

- [x] 4.14 Weekの部品をapiとeventに束縛し、購入種別の登録に加え、paymentsの反映の経路で確かめる
  - 4.1〜4.13の部品を処理単位で束縛するモジュールを作り、apiとeventの束縛の一覧へ同時に加える
  - 購入種別の登録は、ultras-subscriptionと同じく`workers/week-tournament`が登録の定数`WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION`を書き出し、paymentsの購入種別の集約点がそれを一覧へ加える。登録の一覧の完全一致を確かめるpaymentsの束縛のWorkers統合テストの期待値を書き換え、同じテストが「登録していない購入種別」の例に`week_tournament_entry`を使っている箇所を、登録の無い別の購入種別の例へ差し替える(明示の横断)
  - paymentsの反映の経路の確認は、依存の方向を守るためapiのWorkers統合テストの環境(`composition`の`*.worker.test.ts`)に置く
  - 先に、Workers統合テスト(paymentsの反映の経路、Stripeは模擬応答)で、反映での参加資格の付与、同じ購入の重複の反映(ランディング・Webhook・突合)で付与が1回、凍結と同時の反映が拒否と自動返金になること、資格を得た枠への2件目の決済が拒否されることを確かめる
  - 完了状態: Workers統合テスト・購入種別の集約点の全定義の検証の単体テスト・paymentsの束縛のWorkers統合テスト・3経路のDIの解決の検査が成功する
  - _Requirements: 2.5, 2.6, 2.7, 2.9, 3.7, 13.3, 14.1, 15.3_

- [x] 5. イベントサーバーの処理
- [x] 5.1 eventの識別子と、確定のマッチイベントの2つの処理を作る
  - eventの8つの処理のDIの識別子をここで作る(束縛と登録は5.5)
  - 確定のマッチイベントは識別子だけを運ぶため、予選の処理は`MatchDirectory.findMatches([matchId], now)`で読んだ確定のマッチの記録を枠の作成の部品へ渡す
  - 先に、単体テスト(部品は偽物)で、予選の確定で枠の作成を呼ぶこと、Weekのマッチの確定でそのブラケットのトーナメントを進め結果の反映(賞・通知)を行うこと、種別の違うマッチと本specのブラケットに無いマッチを無視すること、例外を再試行に任せることを確かめる
  - Weekとブラケットの部品は`core/week-tournament`・`core/tournament`の契約と識別子で受け取る
  - 完了状態: 単体テストが成功し、静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 4.14_
  - _Requirements: 1.1, 6.3_

- [x] 5.2 参加資格の喪失と物理削除の3つの処理を作る
  - 5.1で識別子が確定した後に行う最初の処理のため(P)にしない(5.3・5.4は5.1の識別子の確定を待ってから並行できる)
  - 先に、単体テスト(部品は偽物)で、削除で枠の喪失・ローンチの未完了の決済の失効(残りがあれば続き)・返金待ちの処理を行うこと、退会で喪失と返金待ちの処理を行うこと、凍結の後は喪失が0件で返金待ちだけを処理すること、物理削除で紐付けの解除と削除を行うことを確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 4.1, 4.2, 4.3, 14.3_

- [x] 5.3 (P) Ultrasの加入が有効になった知らせの2つの処理を作る
  - 先に、単体テスト(部品は偽物)で、期限内の加入で受付中の枠に参加資格を与えること、期限の後の加入では与えないこと、未完了の参加費の決済を残りが無くなるまで最大5回失効させ残れば例外にすること、同じ知らせの2回の処理で結果が変わらないことを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: WeekUltrasEntryExemptionHandler、WeekOpenEntryCheckoutExpiryHandler_
  - _Requirements: 3.2, 3.3, 3.4, 3.7_

- [x] 5.4 (P) 予選の勝利の結果通知への追記を作る
  - 先に、単体テスト(部品は偽物)で、Ultrasの免除の追記、受付中の決済期限(UTCの表記の受付期限)と参加の導線の追記、日曜日のローンチの強調、プロダクトが見えないときの導線の省略、敗北・期限後・資格を失った枠で追記しないこと、追記の長さの上限を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: WeekEntrySupplementProvider_
  - _Requirements: 12.6_

- [x] 5.5 eventの処理を束縛し、5つの登録口に加える
  - 5.1〜5.4の処理を処理単位で束縛するモジュールを作り、eventの束縛の一覧へ加える
  - マッチイベントの登録口に2件(予選1500・Week 1510)、プロダクトのライフサイクルの登録口に2件(`deleted`・`purge_due`、1500)、ユーザーのライフサイクルの登録口に1件(`withdrawn`、1500)、Ultrasの知らせの登録口に2件(1500・1510)、結果通知の追記の登録口に1件(`qualifier`、1500)を加える
  - 登録の前に、5つの登録口を参照する上流のテストを検索で洗い出す。設計のModified Filesに挙げた、登録口が空であることや登録の一覧の完全一致を前提にしたeventのテスト(Ultras・notifications・payments・マッチ・マッチの物理削除・マッチの判定の後処理・プロダクト・engagement・directory-discoveryのモジュールのWorkers統合テスト)を、本specの登録を期待する形に書き換える(明示の横断)
  - 登録口の名前を参照せずに振る舞いで影響を受けるテストは検索で拾えないため、登録の後にeventのWorkers統合テストを全件実行する
  - 完了状態: 各登録口の検証(名前・同じ種類での`order`の重複)の単体テスト、eventのWorkers統合テストの全件、eventの`queue`の経路で8つの処理の識別子が解決できる検査が成功する
  - _Depends: 5.2, 5.3, 5.4_
  - _Requirements: 1.1, 3.2, 4.1, 12.6, 14.1, 14.3_

- [x] 6. APIサーバー
- [x] 6.1 apiの識別子と、ジョブの失敗の通知のポートと、2つのジョブ(23:45の夜の処理・4:21の再処理)を作る
  - apiの全部品(ジョブ・供給元・照会・決済の開始・失敗の通知)のDIの識別子と、ジョブの失敗を運用者へ知らせるポート(`WeekTournamentIncidentReporter`、match-engineの`MatchIncidentReporter`と同じ形)をここで作る(束縛と登録は6.10)。application層からSentryを直接呼ばない
  - 23:45の`tournament-week.evening-bracket`は毎晩、組み合わせ決定→その日に確定した予選の枠の追いつき(`listForDate({ date, kinds: ['qualifier'], now })`)→全トーナメントの進行(確定のマッチイベントへの同期の追いつき)→その夜の通知イベントの発行(`publishNight`)の順に行い、最後にnotificationsの`EveningDispatchGate.markReady({ participant: 'tournament-week.evening-bracket', date: context.business.date, at: clock.now() })`を1回呼ぶ。いずれかが例外を投げた、または組み合わせ決定・進行の失敗の一覧が空でなければ、全てを試した後に失敗の通知のポートへ渡して例外を投げ、`markReady`を呼ばない。戻り値はログにだけ使う(notificationsの仮2)
  - 先に、単体テスト(部品・失敗の通知のポート・`EveningDispatchGate`は偽物)で、5つの呼び出しの順(`markReady`が最後)、組み合わせも進行も無い夜も`markReady`を呼ぶこと、組み合わせ・追いつき・進行・発行のいずれかの例外と、組み合わせ決定・進行が返す失敗の一覧が空でない場合のそれぞれで失敗の通知のポートへ渡したうえで`markReady`を呼ばずに例外になり他の処理は試されること、`markReady`の3つの戻り値で処理が変わらないこと、`EveningDispatchError`が例外のまま伝わること、4:21の返金と知らせの再処理(10分以上前・100件)を呼び、その例外を失敗の通知のポートへ渡して投げ直すことを確かめる
  - Weekとブラケットの部品は`core/week-tournament`・`core/tournament`の契約と識別子で受け取る
  - 完了状態: 単体テストが成功し、静的解析でapplication層に`**/lib/workers/**`とSentryの読み込みが無い
  - _Depends: 4.14_
  - _Requirements: 4.7, 5.1, 6.3, 12.2, 12.3, 12.7, 12.8, 14.6_

- [x] 6.2 ジョブの失敗の通知のSentryの実装を作る
  - 6.1のポートを実装するため(P)にしない
  - 先に、Workers統合テストで、失敗の理由(`evening-bracket-failed`・`entry-follow-up-failed`)ごとに文言を`logentry`、まとめる単位を`fingerprint`に置いた`captureEvent`が送られ、タグがジョブとトーナメントの識別だけでプロダクトの名称・メールアドレス・ハンドルを含まないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Boundary: WeekTournamentIncidentReporter_
  - _Requirements: 12.8, 14.5, 14.6_

- [x] 6.3 再ローンチの禁止と編集の固定の2つの供給元を作る
  - 6.1で識別子が確定した後に行う最初の供給元のため(P)にしない(6.4・6.5は6.1の識別子の確定を待ってから並行できる)
  - 先に、単体テスト(ストアは偽物)で、受付中の枠の決済期限の前後(解除の日時、週の行の保存した期限)、枠の作成前の予選の勝利、参加資格を得た枠と勝ち残りの枠の禁止、期限切れ・喪失・除外・敗退・優勝で返さないこと(仮1)、勝ち残りと凍結後の固定、1回の呼び出しで読み取りが一括であることを確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 6.4 (P) ローンチの要約の供給元を作る
  - 先に、単体テスト(ストアは偽物)で、要約の6つの文言(優勝・マッチ中・進出・敗退・参加決定・参加受付中)とrank、該当しない枠で返さないこと、受賞がプロダクトの識別を持ち表記が週の期間だけであること、1回の呼び出しで読み取りが一括であることを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: WeekLaunchSummarySource_
  - _Requirements: 10.9_

- [x] 6.5 (P) トロフィーの供給元の契約・本specの登録口・照会と、Weekの供給元を作る
  - 先に、単体テスト(供給元は偽物)で、公開範囲で見えないプロダクトの`null`、Yearを先頭に同じ種類は受賞の新しい順、供給元の失敗をその供給元の欠落にしてログを残すこと、Weekの受賞の週の表記とブラケットへのパスを確かめる
  - 本specが所有する登録口(初版はWeekの1件、20)を作る。登録口が指すWeekの供給元の束縛は6.10で行い、6.10の解決の検査で確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: TrophySource、ProductTrophyReader、WeekTrophySource_
  - _Requirements: 10.8, 10.10_

- [x] 6.6 トップページの区画の照会を作る
  - 行はマッチのIDだけを返し、マッチの表示の読み込みは6.11のリゾルバが`loadMatchView`で行う(applicationはpresentationを読み込めない)
  - 先に、単体テスト(マッチの照会とブラケットのストアは偽物)で、その日のWeekのマッチのトーナメントごとの行(重なる2つのトーナメントの1回戦の日の昇順)・ラウンド名・決勝日・決勝の判定、マッチが無い日の空、マッチの日付の照会とマッチからのブラケットの引き当てがそれぞれ1回だけ呼ばれることを確かめる
  - 完了状態: 単体テストが成功する(application層のカバレッジは単体テストで数える)
  - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.7, 14.7_

- [x] 6.7 種類によらないブラケットの表示の組み立て(`buildBracketRoundsView`)を作る
  - `apps/api/src/application/tournament/bracket-view-builder.ts`に`buildBracketRoundsView`(記録・マッチの表示・現在時刻から参加数・シード数・ラウンド・優勝の番号)を純粋な関数として作る。tournament-yearも使う(仮7、tournament-yearの依頼)
  - 先に、単体テストで、N = 13の記録(1回戦だけ予定済み)で準々決勝以降の未来の枠が「シード<n>」「1回戦第<k>試合の勝者」になること、予定済みの位置のマッチと側の抽選番号の順・Upvote数・結果、表示できないプロダクトの`null`、両側が空と確定した位置を含めないこと、記録の無いラウンドの実施日が前のラウンドの翌日で遅れの後は現在の業務日付の翌日以降になること、優勝・受賞なし・参加0と1の空のラウンド、`kind`が`year`の記録でも同じ形を返すこと、同じ入力で同じ値になることを確かめる
  - 共通ライブラリの`workers`(`**/lib/workers/**`)とWeekの部品(`core/week-tournament`・`application/week-tournament`)を読み込まず、`BracketRecord`を`core/tournament`から読み込むことを、静的解析の読み込みの制限(またはそれを確かめる単体テスト)で検査する
  - 完了状態: 単体テストと読み込みの制限の検査が成功する
  - _Boundary: BracketViewBuilder_
  - _Requirements: 9.2, 9.3, 9.4, 13.3_

- [x] 6.8 ブラケットのページの照会を作る
  - 先に、単体テスト(ストア・マッチの表示の照会・プロダクトの照会は偽物)で、照会が6.7の関数の結果と優勝のプロダクト(表示できなければ`null`)を返すこと、不正な週と未決定の週の未定義、マッチの表示の照会(`MatchViewReader.findViews`)へ90件ずつ渡ることを確かめる。D1を使った確認は6.11のGraphQLのWorkers統合テストで行う
  - 完了状態: 単体テストが成功する(application層のカバレッジは単体テストで数える)
  - _Boundary: WeekBracketReader_
  - _Requirements: 9.1, 9.6, 14.7_

- [x] 6.9 参加費の導線の照会と決済の開始を作る
  - 先に、単体テスト(部品は偽物)で、本人でないプロダクトと枠の無いプロダクトの`null`、直近のローンチの枠、免除の判定(Ultrasの出どころと受付中の期間内)、価格の取得の失敗での縮退、勝ち残り・敗退・優勝の進行、決済の開始が購入種別`week_tournament_entry`とローンチのIDで決済の開始の部品を呼ぶことを確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 2.1, 2.10, 10.1, 10.3, 10.6_

- [x] 6.10 apiの部品を束縛し、ジョブと判定の供給元の登録口に加える
  - 6.1〜6.9の部品(純粋な関数の6.7を除く)と失敗の通知のSentryの実装(6.2)を処理単位で束縛するモジュールを作り、apiの束縛の一覧へ加える
  - ジョブの集約点に2件(23:45の1500、4:21の1500)、判定の供給元の登録口に3件(1500)を加え、notificationsの`EVENING_DISPATCH_PARTICIPANTS`(`apps/api/src/composition/evening-dispatch-participants.ts`)に`'tournament-week.evening-bracket'`を1行追記し、その単体テストの「初版の登録口は空である」と、前提の登録が無い夜の枠が直ちに送り出されることを確かめる`notifications-module.jobs.worker.test.ts`の23:45の起動のテスト(前提に本specが入り、送り出しは本specの準備の完了か23:55を待つ)を、本specの登録を期待する形に書き換える(notificationsのタスク4.6の申し送り。登録と23:45のジョブを同じ変更に含める)
  - 登録の前に、ジョブと判定の供給元の登録口を参照する上流のテストを検索で洗い出し、判定の供給元の登録口の単体テスト(初版の3つの登録口は空である)と、4:21のジョブの一覧を完全一致で確かめる検索のモジュールのWorkers統合テストを、本specの登録を期待する形に書き換える(明示の横断)
  - 登録口の名前を参照せずに振る舞いで影響を受けるテストは検索で拾えないため、登録の後にapiのWorkers統合テストを全件実行する
  - 完了状態: apiのWorkers統合テストの全件、Cronの式の一致と同じ時刻の`order`の重複の検査、供給元の名前の検証、前提の名前の検証(`assertEveningDispatchParticipants`)と書き換えた上流のテスト、apiの`fetch`と`scheduled`の経路で全識別子(6.5のトロフィーの登録口が指すWeekの供給元・失敗の通知のポート・`NOTIFICATIONS_PLATFORM_TYPES.EveningDispatchGate`を含む)が解決できる検査が成功する
  - _Depends: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
  - _Requirements: 10.9, 10.10, 11.1, 11.5, 12.7, 14.1, 14.2_

- [x] 6.11 GraphQLのスキーマモジュールの照会(トップページ・ブラケット・トロフィー)を作り、スキーマの集約点に加える
  - ルート型は`extend`を使わず`type Query { ... }`・`type Mutation { ... }`で書く(api-gatewayのスキーマモジュールの規約)
  - `BracketRound`・`BracketNode`・`BracketSlot`のリゾルバは`buildBracketRoundsView`の値だけを読み(`BracketNode.match`は値の`MatchView`をそのまま返す)、`WeekBracket`の値に依存させない(仮7)
  - トップページの区画の対戦カードと不戦勝の分類と不戦勝の理由は、match-engineの`placementOf`を再利用する
  - トップページの区画の行のマッチの表示は、リゾルバが`loadMatchView(context, matchId)`(`matchViewLoader`のキーは`{ matchId, session }`)でまとめて引く(14.7)
  - 先に、Workers統合テストで、トップページの区画の行のマッチの表示がまとめた読み取りで解決され問い合わせの回数がマッチの数に比例しないこと、ブラケットのページの照会がローカルD1のマッチの表示を90件ずつ読むこと、トップページの区画の対戦カードと不戦勝の分け方(側1つは対戦相手不在、開始時点の相手の不戦敗は不戦敗による勝利、即時の終了は早期の勝利の不戦勝、両者の不戦敗は表示しない)、ブラケットの非公開のプロダクトの表示と未決定の`null`、`BracketRound`以下の型が`BracketRoundsView`の値だけ(`WeekBracket`を介さない値)から解決されること、優勝したプロダクトが表示できない終了済みのトーナメントで`champion`がnull・`tournament.awarded`が真になること、トロフィーの照会、入力の形式違反が`bad_request`(`validation_error`)になることを確かめる
  - 完了状態: Workers統合テストが成功し、スキーマの集約点の検証を通り、apiのスキーマの生成(`generated/schema.graphql`の更新。7.1のclientの型の生成が読む)が成功する
  - _Requirements: 8.1, 8.4, 9.4, 9.6, 10.8, 13.3, 14.7_

- [x] 6.12 GraphQLの参加費の導線と決済の開始の操作を加える
  - ルート型は`extend`を使わず`type Query { ... }`・`type Mutation { ... }`で書く(6.11と同じapi-gatewayの規約)
  - 先に、Workers統合テストで、未ログインの拒否、本人だけの参加費の導線、決済の開始の成功と5つの`week_entry_*`のエラー、受付期限22:59の開始は受け付け23:00は`checkout_closed`になること(paymentsの`CheckoutStarter`の経路、Stripeは模擬応答)、`payments_unavailable`の伝わり方を確かめる
  - 完了状態: Workers統合テストが成功し、スキーマの集約点の検証を通り、apiのスキーマの生成(`generated/schema.graphql`の更新。7.1のclientの型の生成が読む)が成功する
  - _Requirements: 2.1, 2.2, 2.4, 10.1, 10.6, 15.3_

- [x] 7. 利用者側の画面
- [x] 7.1 本specのGraphQLの操作とフラグメントを加え、型を生成して許可リストを再生成する
  - トップページの区画・ブラケット・参加費の導線・トロフィーの照会と決済の開始の操作を、clientの`src/graphql/operations/week-tournament/`に1ファイル1操作の`.graphql`で書く。操作名は`Client`で始め(`ClientWeekTournamentBoard`・`ClientWeekBracket`・`ClientMyWeekEntry`・`ClientStartWeekTournamentCheckout`・`ClientProductTrophies`)、`graphql()`を呼ばない
  - フラグメントだけのファイルは`operations/`に置けないため(1ファイル1操作の検査)、Yearと共用する`MatchProduct`のフラグメント`BracketMatchProductFields`と`BracketRound`のフラグメント`BracketRoundFields`(ラウンド・名前・実施日・位置・マッチの必要な項目・枠。枠のプロダクトは`BracketMatchProductFields`。選択する項目はmatch-engine・product-launch・media-pipelineのスキーマの名前に合わせ、`MatchProduct`の`category`・`logo`は下位の項目を選ぶ)を`src/graphql/fragments/bracket/`に置き(G3)、`ClientWeekBracket`の照会はこれらを展開する。型は`src/graphql/generated/graphql.ts`が生成する`BracketRoundFieldsFragment`・`BracketMatchProductFieldsFragment`を使う(仮7、tournament-yearの照会も名前で展開する)
  - Week専用の`WeekTournamentRoundBoard`のフラグメント`WeekBoardRoundFields`(`tournament`・`round`・`roundName`・`final`・`matches`・`byes`・`bracketPath`。`matches`・`byes`はmatch-engineの`MatchCard`・`ByeList`の引数が求める項目)を`src/graphql/fragments/week-tournament/`に置き、`ClientWeekTournamentBoard`はこれを展開する。`splitBoardRound`は生成された`WeekBoardRoundFieldsFragment`を受ける
  - 5つの操作の取得と変更の補助(TanStack Queryの問い合わせの設定と問い合わせのキー)を、既存の`src/graphql/directory.ts`と同じ形で`src/graphql/week-tournament.ts`に本タスクで作り、単体テストで問い合わせのキーと入力を確かめる(7.2〜7.8の画面はこの補助を使い、補助のファイルを変えない)
  - frontend-platformの「操作の追加手順」どおり、clientで`bun run graphql:generate`を実行して`src/graphql/generated/`を更新し、apiで`bun run graphql:allowlist`を引数なしで実行して許可リストを再生成する。画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読み、`gql.ts`・`index.ts`を読まない
  - 完了状態: 型の生成と許可リストの再生成が成功し、clientとapiの`graphql:check`とclientの`codegen.unit.test.ts`(1ファイル1操作・操作名の接頭辞・本文を含まない文書)が通り、clientの型検査が通り、生成された2つの共用のフラグメントの型を`ClientWeekBracket`の照会の型を読み込まずに参照できる
  - _Depends: 6.11, 6.12_
  - _Requirements: 8.1, 9.1, 10.1, 10.8, 13.3_

- [x] 7.2 トップページのWeekトーナメントの区画を作り、区画の登録口に加える
  - 7.1の生成物を使うため(P)にしない
  - 不戦勝の一覧の文言はmatch-engineの`ByeCard`が提供するため、本タスクでは実装せず、文言の確認もしない(`ByeList`へマッチを渡すことだけを確かめる)
  - 対戦カードの段階の印は`MatchCard`がマッチの段階と回戦から自ら描くため、ラウンド名を渡さない(段階は3.2の予定の作成で設定済み)
  - 先に、単体テストで、行の対戦カードと不戦勝の分け方と決勝の判定(`splitBoardRound`)を確かめる
  - 登録の前に、トップページの区画の登録口を参照する上流のテストを検索で洗い出し、登録口の一覧を完全一致で確かめる区画のブラウザテストを、本specの登録を期待する形に書き換える(明示の横断)
  - 先に、ブラウザテストで、表示中の画面の定期再取得(`LIVE_REFRESH_QUERY_OPTIONS`)と、区画の登録口の自動更新の切り替えの規約(ページ全体の自動更新の停止で取り直しを止めること)、見出し(週の表記・ラウンド名・決勝日・ブラケットへの導線)、対戦カードと段階の印と`rel="noopener"`、不戦勝の一覧と早期勝利のUpvote数、重なる2つのトーナメントの並び、マッチが無い日の非表示、取得の失敗の区画だけの縮退、アクセシビリティの検査の違反が0件を確かめる
  - ブラケットへの導線は、サーバーが返す`bracketPath`の通常のリンク(`<a>`)にする(型付きのルートの定義に依存せず、7.5と独立に進められる)
  - 登録口に`main` 20を加える
  - 完了状態: 単体テストとブラウザテストと、書き換えた上流のブラウザテストが成功する
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 8.8_

- [x] 7.3 トップページの決勝の演出の区画を作り、区画の登録口に加える
  - 7.2と同じ登録箇所へ追記するため(P)にしない
  - 先に、ブラウザテストで、決勝の全幅の表示、確定の後の受賞と受賞なしの文言、視差効果を減らす設定で演出を止めること、アクセシビリティの検査の違反が0件を確かめる
  - 登録口に`showcase` 20を加え、7.2で書き換えたトップページの区画の登録口の一覧のブラウザテストに本区画を加える
  - 完了状態: ブラウザテストと、トップページの区画の登録口の一覧のブラウザテストが成功する
  - _Requirements: 8.5_

- [x] 7.4 (P) 共用のブラケットの表示の部品(ラウンドの列・タブ・マッチ・優勝)を作る
  - 共用の`components/bracket/`の`BracketRoundColumn`・`BracketRoundTabs`・`BracketMatchCard`・`BracketChampion`は`BracketViewProps`(`BracketRoundFieldsFragment`の配列の`rounds`・`BracketMatchProductFieldsFragment`の`champion`・`awarded`・`finished`)だけを受け、`WeekBracket`の型を読み込まない(仮7、tournament-yearのページも同じ4部品を使う)
  - 先に、ブラウザテストで、4部品に`BracketRoundFields`の値だけ(照会の取得なし)を渡して描けること、ラウンドの列とタブ(既定は進行中のラウンド)、マッチのシード・Upvote数・勝敗・不戦勝・未来の枠の表記、非公開のプロダクト、優勝・受賞なし・優勝したプロダクトが表示できない場合(`awarded`が真で`champion`がnullなら「非公開のプロダクト」が受賞と表示)・参加1でラウンドが空の優勝、キーボードでのたどり方、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功し、4部品と`BracketViewProps`がWeekの照会の型を読み込まずに型検査を通る
  - _Boundary: BracketRoundColumn、BracketMatchCard、BracketRoundTabs、BracketChampion、BracketViewProps_
  - _Depends: 7.1_
  - _Requirements: 9.2, 9.3, 9.4, 9.5, 13.3_

- [x] 7.5 Weekのブラケットのページ(ルートと組み立て)を作る
  - 7.4の部品を使うため(P)にしない
  - `routes/tournaments/week/$week.tsx`と`components/week-tournament/week-bracket-page.tsx`の`WeekBracketPage`が、`weekBracket`の結果から`rounds`・`champion`・`awarded`(`tournament.awarded`、nullは偽)・`finished`を4部品へ渡し、見出し(週の表記・参加数・シード数)を置く
  - 先に、ブラウザテストで、768px以上の列と767px以下のタブの切り替え、照会の結果からの受け渡し、未決定の週の404、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功し、`/tournaments/week/<ISO週>`をローカルで開ける
  - _Boundary: WeekBracketPage_
  - _Requirements: 9.1, 9.5, 9.6_

- [x] 7.6 (P) トロフィーの区画を作り、プロダクト詳細の区画の登録口に加える
  - 先に、ブラウザテストで、受賞が無いときの非表示、Yearを先頭にWeekは新しい順、週の表記と受賞日とブラケットへのリンク、トロフィーの絵が読み上げられないこと、アクセシビリティの検査の違反が0件を確かめる
  - ブラケットへのリンクは、サーバーが返す`bracketPath`の通常のリンク(`<a>`)にする
  - 登録口に`main` 10を加える。登録の前に、プロダクト詳細の区画の登録口を参照する上流のテストを検索で洗い出し、登録口の一覧を完全一致で確かめる区画のブラウザテストを、本specの登録を期待する形に書き換える(明示の横断)
  - 完了状態: ブラウザテストと、書き換えた上流のブラウザテストが成功する
  - _Boundary: TrophyShelf、TrophyArt_
  - _Depends: 7.1_
  - _Requirements: 10.8_

- [x] 7.7 (P) 参加費の導線の本体と期限の表示を作る
  - 先に、ブラウザテストで、受付中のボタン・参加費・期限(受付期限23:00の日時・相対表現)、受付期限まで48時間ちょうどと48時間未満の注意色と秒読みの境界、押下で決済画面へ進むこと、免除の表示、Ultrasの案内の有無(導線の表示の部品の真偽)、価格の取得の失敗と決済サービスの障害の無効化と案内、押下の後の`checkout_closed`・`week_entry_*`のエラーの文言(決済期限を過ぎた旨など)の表示、参加資格・組み合わせ・敗退・資格の喪失・期限切れの状態、アクセシビリティの検査の違反が0件を確かめる
  - 登録箇所のファイルは変えない(7.8で登録する)
  - 完了状態: ブラウザテストが成功する
  - _Boundary: WeekEntryPanel、EntryDeadline_
  - _Depends: 7.1_
  - _Requirements: 2.2, 2.10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 7.8 参加費の導線をプロダクト詳細と自分のプロダクトの画面へ、削除の注意書きを削除の確認へ登録する
  - 7.6と同じプロダクト詳細の登録箇所のファイルへ追記するため、7.6の後に行う
  - 先に、ブラウザテストで、2つの包みが本体を描くこと、削除の注意書きが受付中と参加資格の枠のときだけ出ることを確かめる
  - 投稿者本人向けの操作の登録口(10)・自分のプロダクトの画面の登録口(10)・削除の注意書きの登録口(10)に加える
  - 登録の前に、3つの登録口を参照する上流のテストを検索で洗い出し、投稿者本人向けの操作の登録口が空であることを確かめるプロダクト詳細の区画のブラウザテストと、自分のプロダクトの区画と削除の注意書きが空であることを確かめる単体テストを、本specの登録を期待する形に書き換える(明示の横断)
  - 完了状態: ブラウザテストと、書き換えた上流のテストが成功する
  - _Depends: 7.6, 7.7_
  - _Requirements: 10.1, 10.7_

- [ ] 8. 統合・ドキュメント・E2E
- [x] 8.1 時刻の連鎖の統合テストを作る
  - apiのWorkers統合テストの環境で行い、eventの確定のマッチイベントの処理の代わりに、それが呼ぶbackend-libの`WeekProgressionService`を直接呼ぶ(`apps/event`を読み込まない)
  - 先に、Workers統合テストで、23:35の決済期限・23:40の突合と確定・23:45の組み合わせと進行の順(paymentsの10、match-engineの1100、notificationsの1300、本specの1500)で、突合で反映された決済が組み合わせに入ること、23:45より後に支払われた決済はpaymentsが自動で返金し、23:45より前に支払われ凍結の後に反映された決済は拒否と自動返金になり、どちらも組み合わせに入らないこと、確定のイベントの処理と23:45のジョブの両方の経路で翌日の0:00の開始に間に合うこと、その夜の結果・翌日の予告・受賞が全て発行された後で本specの`markReady`が記録され(notificationsの実際の`EveningDispatchGate`)、本specの準備の完了の前にはnotificationsが送り出しを依頼しないこと、notificationsの実際の発行の口で開始済みのマッチの予告が混じっても残りの通知イベントが記録されることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 5.5, 6.10_
  - _Requirements: 2.7, 2.9, 5.2, 12.3, 12.5, 12.7, 14.2, 15.3_

- [x] 8.2 技術ドキュメントとオンボーディングを書く
  - `backend/017-single-elimination-brackets.md`・`frontend/016-tournament-bracket-view.md`を本プロジェクト固有の値を含めずに書き、各READMEの文書一覧に加える
  - `docs/onboardings/project-values.md`にジョブ・処理・登録の名前と`order`、価格の`lookup_key`、メール種別、返金の依頼キーの形と拒否の分類、共用の週とラウンド名の規則の置き場所を、`CLAUDE.md`の「技術規則の参照先」に`backend/017`の行を加える(Claude設定のdenyで編集が拒否された場合は、開発者が後で手動で加えられるよう報告する)
  - 完了状態: 文書が整形の検査を通り、技術ドキュメントに本プロジェクト名と固有の値が無いことを検索で確かめる
  - _Requirements: 15.5, 15.6_

- [ ] 8.3 E2Eの補助を作る
  - admin-foundationの`executeLocalD1`(文字列は`sqlStringLiteral`)で次の補助を作る(directory-discoveryの補助と同じ形)
  - (a)確認済みで可視の利用者2人・可視のプロダクト2つ・予選で勝利したローンチ2つと、その週の行(受付期限・決済期限・組み合わせ決定の列は現在より十分に未来)と枠2件(1件は受付中、1件はUltrasで参加資格)を作る。(b)週の行の3つの期限の列を現在より過去へ移す。(c)組み合わせで予定された決勝の実施日を今日に、開始の日時を過去・終了の日時を未来に移し、開始を記録済みにする。(d)決勝の終了の日時を過去へ移す。ジョブはbackend-platformの改訂2の共用の補助`triggerScheduled({ worker: 'api', businessDate, businessTime })`に当日の業務日付と`23:40`・`23:45`を渡して動かし(ローカルの定期実行の起動を独自に作らない)、確定のイベントは実際の経路で届ける
  - 完了状態: 補助の関数を順に呼ぶ空のE2Eが成功し、ローカルD1に枠・組み合わせ・開始済みの決勝ができる
  - _Depends: 5.5, 6.10_
  - _Requirements: 15.4_

- [ ] 8.4 参加費・組み合わせ・受賞のE2Eシナリオを作る
  - 順序: 受付中の枠の投稿者がプロダクト詳細ページから参加費をテストカードで支払う(paymentsのE2Eと同じく`stripe listen`の転送が要る)→参加資格を得た表示を待つ→補助(b)で期限を過去へ移す→23:40・23:45のジョブ(8.3のとおり`triggerScheduled`で起動)で組み合わせ(参加2で決勝だけ)→補助(c)で決勝を今日の開始済みにする→トップページの決勝の区画とブラケットのページにマッチが出ることを確かめる→補助(d)で終了を過去へ移す→23:40・23:45のジョブで確定と進行→プロダクト詳細ページのトロフィーに受賞が出ることを確かめる。Ultrasの案内は確かめない
  - 開始の前に、devとstagingが共用するsandboxに価格`week_tournament_entry`があることを確かめ、無ければ本タスクを保留して開発者へ報告する(作成の依頼は1.1で行った)
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 7.3, 7.5, 7.8, 8.1, 8.3_
  - _Requirements: 15.4_

- [ ] 8.5 全体の検査とカバレッジを確かめる
  - 整形・静的解析・型検査・4種のテストを全アプリで実行し、本specが変更したファイル(1.2・1.3で寄せ替え・改名した上流のファイルを含む)のカバレッジが80%以上であることを確かめる
  - 完了状態: 一括の検査と全テストが成功し、カバレッジの閾値を満たす
  - _Requirements: 15.1_

## Implementation Notes

- 開発者への依頼(1.1): devとstagingが共用するStripeのsandboxに、`lookup_key`が`week_tournament_entry`の価格(参考$5、税込)を1回作成する(8.4のE2Eの前提。prodはlaunch-readiness)。
- 1.1: 規則は`apps/common-lib/tournament/week-period.ts`(`weekStartOf`・`isoWeekKey`・`parseIsoWeek`・`formatWeekPeriodLabel`)と`round-name.ts`(`TOURNAMENT_STAGES`・`stageForSlotCount`・`roundLabel`・`tournamentRoundName`)。`parseIsoWeek`は形式違反・年の範囲外(4桁で1年以上)・存在しない週を`undefined`で返し、存在しない日付は`RangeError`。`roundLabel`はラウンドが正の整数でなく段階も無ければ`null`、`tournamentRoundName`はそのとき`RangeError`。`isoWeekKey`・`formatWeekPeriodLabel`は月曜日以外の日付も受け付ける。1.2への申し送り: (a)notificationsの`awardPeriodLabel`は0001〜0099年で`RangeError`(`Date.UTC`の読み替え)だが新しい規則は表記を返す(既存テストに影響なし。既存の2種類のエラーメッセージ(形式違反・存在しないISO週)の区別を保つこと)、(b)clientの`roundNameOf`は0・負・非整数で「0回戦」等を返すが`roundLabel`は`null`(表示は種別名だけになる)、(c)設計に無い公開の名前`TOURNAMENT_STAGES`・`RoundLabelInput`・`TournamentRoundNameInput`・`ParsedIsoWeek`は8.2の文書で扱う。
- 1.2: notificationsの`notice-copy.ts`(`roundName`→`roundLabel`、Weekの期間→形式の正規表現`WEEK_PERIOD_PATTERN`で形式違反を分けてから`parseIsoWeek`→`formatWeekPeriodLabel`)・`notification-event-contract.ts`(`isIsoWeekPeriod`→`parseIsoWeek`)とclientの`match-labels.ts`(`Record<MatchStageValue, TournamentStage>`で大文字を小文字へ)を寄せ替えた。差は0000〜0099年と`9999-W53/54`のエラーメッセージだけ(どちらも`RangeError`)。`core/time`の`businessWeekOf`は本体から使われなくなった(設計どおり業務時刻の部品として残す)。
- 1.3: match-engineの時間帯を`MATCH_SCHEDULE`・`MatchSchedule`・`matchWindow(date)`(`core/match/match-model.ts`)に改名した(23ファイル、設計の一覧と一致)。ブラケットの予定(3.2・2.5)はこの名前を使う。eventのメールのテンプレートのReactコンポーネント`MatchSchedule`と同名だが別モジュール。
- 1.4: テーブルは`apps/db/schema/tournament/`(`tournamentBrackets`・`bracketParticipants`・`bracketMatches`・`weekTournaments`・`weekTournamentEntries`)、マイグレーションは`20261116171705_tournament_week`。`bracket_matches`の主キーは`match_id`(matchesへの外部キー無し)。`bracket_participants.owner_user_id`・`week_tournament_entries.owner_user_id`は`users`への外部キー(ON DELETE無し)のため、物理削除の紐付けの解除(4.3の`unlinkOrDeleteByProduct`・3.1の`unlinkProduct`)は`owner_user_id`も必ずnullにし、テストで確かめること(忘れると利用者の物理削除が外部キー違反で失敗する)。既定値は`refund_status`・`refund_notice_status`の`'none'`だけ。D1での制約の確認は`apps/db/tournament-week-schema.worker.test.ts`(apiの`bun run test:worker -- db/`)。
- 1.5(差し戻し1回): サービス仕様の5文書に決定を書いた(返金ポリシーは2行が仮3と一致し不変)。画面・メール・追記の文言は`design/003-text-and-copy-rules.md`の行をそのまま使う。設計との相違: Ultrasの結果通知の追記の「組み合わせは<決済期限の日時(UTC)>に決定します。」は設計の誤記として文言規則で「<組み合わせ決定の日時(UTC)>」(月曜日23:45)にした。5.4はこちらに従う。コードとの相違: `product_locked`は汎用の文言のまま(Weekの固定の文言は画面の理由として出す)、`checkout_closed`はpaymentsの「決済の受付は終了しました。」のため参加費の導線(7.7)が「Weekトーナメントの参加受付は終了しました。」に置き換える。除外・喪失の状態文の返金の一文は、決済していない(Ultrasの)枠では省く。設計に無くモックアップ等から決めた文言(ブラケットのページの見出し・状態・タブ名、決勝の区画の「Week Final」、取得エラー4つ、返金の知らせの本文など)は文言規則に載せた。
- 2.1: `core/tournament/bracket-shape.ts`(`bracketShape`・`roundSlotCount`・`roundStage`・`seedPlacementOrder`)。N≤1はP・S・1回戦・ラウンド数すべて0、参加数は`Number.isSafeInteger`で検査、範囲外のラウンドと2の冪でない配置の長さは`RangeError`。`seedPlacementOrder(shape.secondRoundSize)`はN≤1で例外になるため、2.2〜2.4はN≤1を先に分ける。
- 2.2: `core/tournament/bracket-draw-rules.ts`の`drawBracket`(比較→`tieBreaker`→`ref`の昇順で並べ、上位Sに1〜S、残りを非シードの比較でS+1〜N。`ref`の重複は`RangeError`。公開の型`DrawOrder<T>`・`BracketDrawResult`)と`core/week-tournament/week-ordering.ts`の`weekSeedOrder`・`weekNonSeedOrder`(`WeekOrderingKey`の`lastUpvoteElapsedMs`は予選の開始からの経過ミリ秒、nullは末尾)。1回戦の組(k番の位置にS+2k−1とS+2k)は2.3の`decideNext`が作る。2.3のテストでN = 13の1回戦の組(E×F・G×H・I×B・J×K・L×M)も`decideNext`の出力で確かめること。4.xの`WeekDrawService`は`tieBreaker`にローンチのID、`ref`に枠のIDを渡す。
- 2.3: `core/tournament/bracket-progress-rules.ts`の`decideNext`・`nextRoundOccupants`(型`PlannedNode`・`RecordedNode`・`BracketState`・`ProgressDecision`)。`nextRoundOccupants(state, round)`は結果が出たラウンドを受け`round+1`の枠を返す(1回戦の後は1〜Sがシード、S+kが1回戦の位置kの勝者)。シードが無い場合も2回戦は`seedPlacementOrder`で組む(N = 8の2回戦はM1×M4・M2×M3)。2.4の`bracketLayout`も同じ配置にそろえる。`PlannedNode.participants`は枠の並び順(番号の昇順ではない)で空の側を除く。3.xは`RecordedNode`へ、作っていない位置は入れず、確定の勝者は`{kind:'winner'}`、両者敗北・両者の不戦敗は`{kind:'none'}`、未確定は`null`、側1つの不戦勝の勝者も`winner`で写すこと。`decideNext`は最大のラウンドだけを現ラウンドとして見るため、次ラウンドの一部だけを挿入した中断からの補完は3.2・3.3の`advance`が前ラウンドから再計算して行う。
- 2.4: `core/tournament/bracket-layout.ts`の`bracketLayout(shape)`(`SlotFeed`は`participant`/`winner_of`、N≤1は空)。`decideNext`と同じ規則を表示用に別に書き、テスト`decideNextの進行との一致`で一致を保証する(どちらかを変えたらこのテストを通すこと)。配置は両側が空と確定した位置や終了後のラウンドも含むため、6.7の`buildBracketRoundsView`が記録から除く。「シード<n>」は`participant`でn ≤ Sの枠、S超の`participant`は1回戦の予定済みのマッチで上書きされる。
- 2.5: `core/tournament/round-schedule.ts`の`dailyRoundPolicy(plannedFirstRoundDate, now)`(1回戦はmax(予定の日, 現在の業務日付+1)、次ラウンドはmax(前ラウンドの日+1, 現在の業務日付+1))と`core/week-tournament/week-schedule.ts`の`entryWindowFor`(翌週月曜日23:00・23:35・23:45、月曜日以外の週の初日は`RangeError`)・`weekFirstRoundDate`(翌週火曜日)・`isSundayLaunch`・`WEEK_ENTRY_PRICE_LOOKUP_KEY`。業務時刻は固定のUTC-08:00(夏時間無し)。設計のSystem Flowsの`dailyRoundPolicy(weekFirstRoundDate(weekStart))`は契約どおり`now`も渡す(4.11・4.12)。3.2・3.3の遅れの検知は`nextRoundDate(prev, now)`が前ラウンドの翌日より後かで判定する。4.5は`WeekEntryWindow.drawAt`をpaymentsの`fulfillableUntil`に対応させる。
- 2.6: `core/week-tournament/week-entry-rules.ts`(`GRANTABLE_STATUSES`=`['awaiting_payment']`、`refundReasonFor`、`weekRefundRequestKey`、`refundRejectionOutcome`(paymentsの`RefundRequestResult`の`rejected`の`code`から導出した型)、値の一覧`WEEK_ENTRY_STATUSES`・`WEEK_ENTRY_CLOSE_REASONS`・`WEEK_ENTITLEMENT_SOURCES`・`WEEK_REFUND_STATUSES`・`WEEK_REFUND_NOTICE_STATUSES`)。テーブルの値との一致は`workers/week-tournament/week-entry-columns.unit.test.ts`。4.9の`WeekEntryFollowUp`への申し送り: paymentsの理由の形式違反の`RangeError`は呼び出し側で`rejected`扱い(`captureEvent`)、`not_needed`でも購入のIDだけの`error`ログを残す(`report: false`はログ無しの意味ではない)、`already_refunded`・`rejected`・`not_needed`には返金の知らせを送らない。3.8(参加資格を得た状態は特典の終了で戻らない)は、4.2・5.3のWorkers統合テストで状態を書き換えないことを確かめる。Storeの条件は`GRANTABLE_STATUSES`を使う。
- 3.1: 契約`core/tournament/ports.ts`(名前付きの型`BracketParticipantRecord`・`BracketMatchRecord`・`BracketOfMatch`を追加、`BracketDraw.create`の`order`は`DrawOrder<T>`)、識別子`core/tournament/identifiers.ts`、`workers/tournament/d1-bracket-store.ts`(`BracketRecord.shape`は`bracketShape(participantCount)`で再計算、読み取りは1回の`db.batch()`、90件ずつ分割)、定数のモジュール`TOURNAMENT_PLATFORM_MODULE`(api・eventのmatchの束縛の直後)。3.2〜3.4は`tournament-platform-module.ts`に束縛を追記し、3つの解決の検査(`workers/tournament/tournament-platform-module.worker.test.ts`、api・eventの`src/composition/tournament-platform.worker.test.ts`)を広げる。テストの補助は`workers/tournament/testing/bracket-fixtures.ts`(`clearBracketTables`はmatch・product・identityのテーブルも消す)。
- 3.2: `workers/tournament/d1-bracket-progression.ts`(コンストラクタは`(db, IdGenerator, BracketStore, MatchDirectory, MatchScheduler)`で設計の`(db, scheduler)`と違う。束縛はmatch-platformの束縛が同じコンテナにある前提)。勝者は`isWinningResult`(`won`・`bye`・`walkover`)、勝者なしは両者に敗退を記録。位置は一意索引と`onConflictDoNothing()`で挿入し`planned`の行を読み直して50件ずつ`MatchScheduler.schedule`。`participant1_no`・`participant2_no`は番号の昇順。`core/tournament/round-schedule.ts`の`nextBusinessDate`を公開(8.2の文書)。戻り値: 最後のラウンドに確定が1件も無ければ予定の直後と同じ`scheduled`(同じ`previewMatchIds`)を何度でも返し、一部確定なら`waiting`(確定したID)を返す。4.7・4.10・5.1は同じ予告を何度受け取っても冪等であること。3.3で置き換える所: `finish`の決定と紐付けを解除した参加者の側で例外を投げている2か所、遅れの`warn`と`captureEvent`、0:00を過ぎた`planned`の再開での実施日の繰り下げ。1回戦の`late`は`first_round_date`との比較(3.4が記録する値で決まる)。
- 3.3(差し戻し1回): 束縛は定数から`createTournamentPlatformModule(appName)`に変えた(遅れのログのカテゴリ`[appName, 'tournament', 'progression']`に要る。3.1の「定数のモジュール」と設計の`TOURNAMENT_PLATFORM_MODULE`は文書の直しが要る、8.2)。`D1BracketProgression`はデコレータ無しで`(db, ids, store, directory, scheduler, appName)`を束縛で組み立てる。純粋な計画は`workers/tournament/bracket-progress-plan.ts`(`planNext`・`finishPlan`・`isFinalWinner`)。親の決定: 決勝のマッチで確定した勝者は後で紐付けを解除しても`champion`(受賞の照会が除く)、それ以外で終了の候補が紐付けを解除済みなら`no_award`にしその参加者を次のラウンドの敗退にする。遅れは`created`のマッチだけ`warn`と`captureEvent`(`level: 'warning'`、`fingerprint: ['tournament','round-late']`、タグ`tournament_incident: 'round-late'`・`bracket_id`、設計のタグ`job`は付けない)。`skipped`のマッチは`findMatches`で読み戻し日付をそろえる。終了の前に残った`planned`の行は片付ける。1回戦を飛ばしたとき2回戦は`firstRoundDate`の日。4.xの呼び出し元は`dailyRoundPolicy(..., now)`を呼び出しのたびに作り直すこと。8.2は`round-late`とログのカテゴリを`project-values.md`へ。
- 3.4: `workers/tournament/d1-bracket-draw.ts`の`D1BracketDraw(db, progression)`。ブラケットを一意索引で挿入しIDを読み直し、参加者を1行1文・50文ずつ`onConflictDoNothing()`で挿入(設計の「90件ずつ」は同じ節の「50件ずつ」に合わせた)、1回戦は`advance`に任せる。参加1以下は`first_round_date`がnull。既存のブラケットにも毎回参加者を挿入して補完する。候補が前回と違う場合の照合は無い(凍結で候補が変わらない前提)。`planNext`は参加者の行の欠落を紐付けの解除と区別できないため、4.11・4.12は凍結後の同じ候補で`create`を呼ぶこと。公開の型`BracketDrawInput<T>`(8.2)。4.12は`create`に`dailyRoundPolicy(weekFirstRoundDate(weekStart), now)`を呼び出しのたびに作って渡し、`week_tournaments.bracket_id`の記録は4.xが行う。
- 4.1: 契約`core/week-tournament/ports.ts`(ストアは`ensureTournament`・`findTournament`・`findTournamentByWeek`・`listDue`(`status IN ('open','drawing') AND draw_at ≤ now`、draw_at→週の初日の昇順)・`listInProgress`・`findEntriesByLaunch`(90件ずつ、紐付けを解除した枠は除く)・`findEntry`・`insertEntry`(`'inserted'|'exists'`))、識別子`identifiers.ts`(10種)、`workers/week-tournament/d1-week-tournament-store.ts`(`@inject(PLATFORM_TYPES.Database)`で通常の`to()`で束縛できる)、補助`workers/week-tournament/testing/week-tournament-fixtures.ts`(`weekTournamentIdOf`・`weekEntryIdOf`はブラケットの補助と同じ値)。`NewWeekEntry`は`qualifierMatchId`を加え(テーブルのNOT NULL)、状態と出どころ・理由の組の判別共用体(4.4は分岐ごとにリテラルで組み立てる)。挿入時にUltrasの枠は`entitled_at`、期限切れは`closed_at`を記録。公開の型`WeekTournamentStatus`・`WeekAward`(8.2)。`insertEntry`は凍結の条件を見ないため、4.4で「未凍結の判定→挿入」の間の凍結の競合の扱いを決めること。
- 4.2: ストアに`grantByUltras`(凍結前・受付中・`won_at ≤ activatedAt ≤ deadline_at`、期限ちょうどを含む)・`forfeitByProduct`・`forfeitByOwner`(凍結前・受付中と資格を得た枠、購入があれば`refund_status`=`pending`、無ければ`not_needed`)・`classify`(公開の型`WeekEntryClassification`、状態が`awaiting_payment`・`entitled`の枠だけ、50件ずつ)を加えた。凍結前の条件は1つのUPDATE文の`draw_started_at IS NULL`の副問い合わせ。`classify`には凍結の条件を付けない(設計の順は凍結→分類)。4.11はUltrasの期間内の受付中の枠を`{ status, entitlementSource: 'ultras' }`で分類すること(出どころ無しで`drawn`にするとCHECK違反で一括全体が失敗)、凍結の後にだけ`classify`を呼ぶことをテストで確かめること。返金は喪失・除外だけ(`drawn`・`expired`は`none`のまま)、`closed_at`は`entitled`以外で記録、既存の出どころは`coalesce`で保つ。凍結の後は喪失が空を返すため、5.2の喪失の処理は返金待ちの枠を別の読み取り(4.3)で処理する。
- 4.3: ストアに`markDrawn`(`status = 'drawing'`のときだけ、`finished`は判別共用体`WeekTournamentFinish`)・`recordFinish`(`status <> 'finished'`の条件で1回だけtrue、引数の矛盾は`RangeError`)・`listAwardedBetween`(`[from, to)`、紐付けを解除した受賞を除く、`WeekAwardedProduct`)・`listPendingFollowUps`(`updated_at < olderThan`)・`listPendingFollowUpsOf({productId}|{ownerUserId}|{tournamentId}, limit)`(設計に無い。5.2と4.9の`processTournament`用。カーソルが無いので、依頼に失敗して`pending`のまま残る枠で無限に回らないこと)・`markRefundRequested`・`markRefundClosed(entryId, 'not_needed'|'already_refunded'|'rejected', at)`(設計の`markRefundNotNeeded`を置き換え。4.9は`refundRejectionOutcome(code).refundStatus`を渡す)・`markNotice`・`unlinkOrDeleteByProduct`(1バッチ2文、`owner_user_id`もnull)を加えた。4.12への申し送り: 参加1で`markDrawn(finished)`すると`awarded_at = at`になり、後の`recordFinish`はfalse(`publishAward`が呼ばれない)、さらに同じ`at`の`publishNight`は`[0:00, at)`で受賞を含まない。参加1のときは`markDrawn`の後に`publishAward`を直接呼ぶか、`publishNight`に新しい時刻を渡すこと。
- 4.4: `workers/week-tournament/week-entry-registrar.ts`の`QualifierWeekEntryRegistrar(store, entitlements: UltrasEntitlements, ids: IdGenerator, appName)`(デコレータ無し、4.14で`toDynamicValue`で組み立てる)。勝利の側(`isWinningResult`、紐付けあり、`decidedAt`あり、予選)だけ`weekStartOf(matchDate)`の週に枠を作り、凍結前は`wasEntitledDuring(投稿者, decidedAt, 保存した決済期限)`なら`entitled`(`ultras`)。ストアの`insertEntry`は受付中・資格を得た枠を`INSERT ... SELECT ... WHERE draw_started_at IS NULL`で挿入し戻り値に`'frozen'`を加えた(設計は`'inserted'|'exists'`)。`'frozen'`なら同じIDで`expired`(`late_entry`)として挿入し直し、warn(`[appName, 'week-tournament', 'entry']`、`tournamentId`・`entryId`・`matchId`)と`captureEvent`(`fingerprint: ['tournament','late-entry']`、タグ`tournament_incident: 'late-entry'`・`tournament_id`)。同じマッチの2回目以降は`[]`で`captureEvent`もしない。8.2は`late-entry`とログのカテゴリを`project-values.md`へ。
- 4.5: `workers/week-tournament/week-entry-offer-policy.ts`の`WeekEntryOfferPolicy(store, products: ProductDirectory, entitlements: UltrasEntitlements)`(デコレータ無し、4.14で`toDynamicValue`)。判定の順は設計どおり(not_found→already_entitled→closed(凍結を含む)→product_unavailable→exempt(`wasEntitledDuring(userId, wonAt, min(now, deadlineAt))`)→available)。受付期限の後も`available`を返し、paymentsの`assertAcceptable`が`checkout_closed`にする。価格は`describe`で使わない。`exclusivityKey`は`launch:<ID>:week`、`fulfillableUntil`は保存した`drawAt`、提供時期は`drawAt`から年付きで書く。拒否の文言は`WEEK_ENTRY_OFFER_REJECTION_MESSAGES`(`WeekEntryOfferRejectionCode`)。7.7で`checkout_closed`を「Weekトーナメントの参加受付は終了しました。」に置き換えるとき、clientはbackend-libを読めないためclient側か共用部品で定義する。レビューの指摘で4.4の`QualifierWeekEntryRegistrar`を直した: 特典の判定は始まり>終わりの期間で`RangeError`を投げるため、決済期限の後に確定した勝利(遅延時)はUltrasを問い合わせず受付中で作る。
- 4.6: `workers/week-tournament/week-entry-fulfillment.ts`の`WeekEntryFulfillment(store, products)`(デコレータ無し、4.14で`toDynamicValue`)。反映の時刻は`purchase.paidAt`(paymentsの3経路すべてで反映時の`clock.now()`。設計の「`paidAt`ではなく反映の時刻」は誤記)。拒否は`{kind:'reject', reason:'ineligible'}`、非公開化・停止は拒否しない(分類で除外)。付与の文は`prepare`の`db`でCASE式(`GRANTABLE_STATUSES`と未凍結)で、凍結・Ultrasの付与の後はNOT NULL違反(paymentsの`D1GuardedBatch`で`constraint_failed`→`prepare`の呼び直しで拒否)。4.14では、paymentsの反映の経路で「23:35:01に反映すれば新しいローンチで拒否」の1件も加えて`paidAt`=反映の時刻の前提を固定すること。
- 4.7: `workers/week-tournament/week-notification-publisher.ts`の`WeekTournamentNotificationPublisher(store, matches: MatchDirectory, notifications: NotificationEventPublisher, appName)`(デコレータ無し、4.14で`toDynamicValue`。`NOTIFICATIONS_PLATFORM_TYPES.NotificationEventPublisher`とmatchの束縛が同じコンテナにある前提)。`publishRound`は空なら呼ばない。違反は位置の1件を除いて発行し直し(`match-not-previewable`は`info`、他は`error`、位置の無い拒否と範囲外は例外のまま)。`publishNight`は当日のWeekの確定(結果)→翌日のWeekの`scheduled`で側2つ(予告)→`listAwardedBetween(業務日付0:00, at)`(受賞、`period`は`isoWeekKey(weekStart)`)を1つの一覧で50件ずつ。ログのカテゴリ`[appName, 'week-tournament', 'notification']`、受賞を除いたときは`productId`を出す(設計のログの列挙に無い。8.2で扱う)。
- 4.8: メール種別`core/email/kinds/tournament-week.ts`(`TOURNAMENT_WEEK_ENTRY_REFUND_KIND`、`transactional`、入力`nickname`・`weekLabel`・`launchDate`(`z.iso.date()`)・`reason`・`billingUrl`)、テンプレート`apps/event/src/infrastructure/email/templates/tournament-week/`(ローンチ日は業務日付なので`formatUtcDate`を使わず年付きの`LaunchDateText`)。4.9は`weekLabel`を`formatWeekPeriodLabel(weekStart)`、`billingUrl`を`CLIENT_SITE_ORIGIN + '/settings/billing'`で組み立てる。8.2は種別を`project-values.md`へ。
- 4.9: `workers/week-tournament/week-entry-follow-up.ts`の`WeekEntryRefundFollowUp({appName, store, refunds: PaymentRefunds, contacts: UserContactDirectory, emails: EmailSender, clientSiteOrigin, readLimit?})`(デコレータ無し、4.14で`toDynamicValue`、`CLIENT_SITE_ORIGIN`はenvから)。`process(entryIds, now)`は各枠を`findEntry`で読み直す。1件の失敗で止めず全件試してから投げる(1件なら元の例外、複数なら`AggregateError`)。`processTournament`は試したIDの集合で終わる。理由を決められない状態は`rejected`(`invalid_reason`)、知らせの入力が作れない・紐付けの解除・退会は`skipped`、送信の失敗は例外で知らせ待ちのまま。ログ`[appName, 'week-tournament', 'follow-up']`、`captureEvent`のタグ`tournament_incident`・`tournament_id`・`entry_id`。並行して同じ枠を処理すると知らせが2通になりうる(稀、状態は壊れない)。
- 4.10(承認後に親の決定で順を変更): `workers/week-tournament/week-progression-service.ts`の`WeekTournamentProgressionService(store, progression, notifications, appName)`(デコレータ無し、4.14で`toDynamicValue`)。`advance`は`in_progress`かつブラケットありのときだけ、方針は毎回作る。`applyResult`の順は`publishRound`→(`finished`かつ`findEntry`で紐付けを確かめた優勝)`publishAward`→`recordFinish`(設計の「`recordFinish`→`publishAward`→`publishRound`」とは違う)。発行の1回性は`dedupe`(`period`・`productId`)で、記録の1回性はストアの条件で保証し、どの発行が失敗しても週は`in_progress`に残って再試行できる。`advanceAll`は`listInProgress(50)`を順に進め`{advanced, failed: トーナメントID[]}`、失敗は`error`ログと`captureException`(タグ`tournament_id`)。`safeTagOf`は`workers/week-tournament/incident-tags.ts`に共通化した。4.12: 参加1で`markDrawn(finished)`の後に`applyResult`を呼べば、新しい順では受賞が発行される(記録は変わらない)ことを確かめること。8.2はログのカテゴリ`[appName, 'week-tournament', 'progression']`を`project-values.md`へ。
- 4.11(差し戻し1回、テストのみ): `workers/week-tournament/week-draw-service.ts`の`WeekTournamentDrawService`(オブジェクト1つの引数、デコレータ無し)。`drawDue`は`listDue`で最大4件、週ごとに補完(凍結前だけ、週7日の`listForDate`の勝者のうち枠の無いものを`registerFromMatch`)→`store.freeze`(凍結のメソッドの名前は設計に無く`freeze(): Promise<boolean>`)→分類(`listEntriesForClassification`を90件ずつ)。分類の順は状態遷移図と規則の文書どおり、受付中は先にUltras(`wasEntitledDuring(wonAt, deadlineAt)`)で参加資格か期限切れ(プロダクトの状態は見ない)、資格を得た枠は論理削除→喪失・非公開化と停止→除外・可視→`drawn`。週の失敗は`error`ログ(`[appName,'week-tournament','draw']`)と`captureException`(`tournament_incident: 'draw-failed'`)で他の週を止めない。`qualifierWinnersOf`を公開。4.12: `drawTournament`の分類の後に手順4〜6を足し、`listDrawnEntries`(紐付けを解除した枠も含む)で`create`する。`week-draw-service.worker.test.ts`の2か所(週の状態が`drawing`)の期待値を更新すること。
- 4.12: `WeekTournamentDrawService`のオプションに`bracketDraw`・`progression`・`followUp`を加え、分類の後に`listDrawnEntries`→`BracketDraw.create`(`weekSeedOrder`・`weekNonSeedOrder`、`ref`は枠のID、`tieBreaker`はローンチのID(紐付けを解除した枠は枠のID)、方針は毎回`dailyRoundPolicy(weekFirstRoundDate(weekStart), now)`)→`markDrawn`→`applyResult`(予告、参加1の受賞)→`processTournament`。`core/tournament/ports.ts`の`BracketParticipantInput`の`launchId`・`productId`・`ownerUserId`をnull可にした(設計は非null)。`markDrawn`の後の後処理の失敗は`drawDue`が再試行せず`failed`に入れる(回復は同じ夜の`advanceAll`(予告)・`publishNight({at: clock.now()})`(参加1の受賞)・4:21の`listPendingFollowUps`(返金))。6.1のジョブはこの順で同じ実行内で動かし、`publishNight`の`at`は`clock.now()`にすること。成功の`info`ログ(`tournamentId`・`bracketId`・`participantCount`)。
- 4.13: `workers/week-tournament/d1-week-champion-directory.ts`(`listChampions`は`[awardedFrom, awardedBefore)`、`awardedFrom`がnullなら起点なし、受賞の日時→週の初日の昇順、紐付けの3列が非nullだけ)と`d1-week-award-export.ts`(`listForLaunches`は受賞の無いローンチをMapに入れない、90件ずつ・重複除去・空なら問い合わせ無し)。どちらも`@inject(PLATFORM_TYPES.Database)`で、4.14で通常の`to()`で`WEEK_TOURNAMENT_TYPES.WeekChampionDirectory`・`WeekAwardExport`へ束縛する。
- 4.14: 束縛は関数`createWeekTournamentPlatformModule(appName)`(`workers/week-tournament/week-tournament-platform-module.ts`、名前`week-tournament-platform`、10部品を`inSingletonScope`、api・eventの`MODULES`のUltrasの共有の束縛の直後。設計の定数`WEEK_TOURNAMENT_PLATFORM_MODULE`とは違う、8.2)。購入種別の登録`WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION`(`week-tournament-registrations.ts`)をpaymentsの`purchase-kind-registrations.ts`へ。paymentsの束縛のテストの未登録の例は`year_tournament_entry`に差し替えた(tournament-yearかsponsorshipが登録するときは残る未登録の種別へ差し替えること)。部品の名前とクラスの対応は`testing/week-tournament-platform-implementations.ts`。paymentsの反映の経路のテストは`apps/api/src/composition/week-tournament-platform.payments.worker.test.ts`(実物のガード付きの一括・自動返金・3経路、23:35:00/01の境界)。api・eventのアプリ固有のWeekの束縛は5.5・6.10で足す。
- 5.1: eventの識別子`EVENT_WEEK_TOURNAMENT_TYPES`(`apps/event/src/application/week-tournament/event-week-tournament-types.ts`、`week-tournament.event.<名前>`、8種: `QualifierEntryHandler`・`RoundProgressHandler`・`ProductEntryLossHandler`・`AccountEntryLossHandler`・`EntryUnlinkHandler`・`WeekUltrasEntryExemptionHandler`・`WeekOpenEntryCheckoutExpiryHandler`・`WeekEntrySupplementProvider`)。`QualifierEntryHandler`(`MATCH_PLATFORM_TYPES.MatchDirectory`・`WEEK_TOURNAMENT_TYPES.WeekEntryRegistrar`・`PLATFORM_TYPES.Clock`)と`RoundProgressHandler`(`TOURNAMENT_PLATFORM_TYPES.BracketStore`・`WEEK_TOURNAMENT_TYPES.WeekTournamentStore`・`WeekProgressionService`・`Clock`)はデコレータ付きで通常の`to()`で束縛できる。`RoundProgressHandler`は`findByMatchIds`→`kind==='week'`→`findTournament`(設計に無い。`applyResult`が`WeekTournamentRecord`を要る)→`advance`→`applyResult`。未確定・未発見は警告ログ(`outcome: 'match-not-decided'`・`'tournament-not-found'`)で完了。ログのカテゴリ`['event','application','week-tournament']`。
- 5.2(差し戻し1回): eventの`ProductEntryLossHandler`(毎回 喪失→ストアの`listLaunchIdsByProduct`(設計に無い、親の決定で追加。自分のデータから状態を問わずローンチを求め直す)→ローンチごとに`expireOpen({userId, kinds:['week_tournament_entry'], targetId, limit:50})`→`followUpPendingEntries({productId})`→`remaining`なら`continue`)・`AccountEntryLossHandler`(喪失→投稿者の返金待ち。未完了の決済の失効はpaymentsの`payments.open-checkout-expiry`に任せる)・`EntryUnlinkHandler`(`unlinkOrDeleteByProduct`→`BracketStore.unlinkProduct`)。返金待ちの読み切りは`follow-up-pending-entries.ts`。どれもデコレータ付きで通常の`to()`、イベントの種別を自分で確かめないので5.5の登録の`events`を正しく絞る。`unlinkOrDeleteByProduct`は`drawn`以外を返金待ちでも削除する(物理削除は保持期間の後なので返金は済んでいる前提。8.5で扱う)。
- 5.3: eventの`WeekUltrasEntryExemptionHandler`(`grantByUltras(activation.userId, activation.activatedAt, clock.now())`)と`WeekOpenEntryCheckoutExpiryHandler`(`expireOpen({userId, kinds:['week_tournament_entry'], limit:50})`を`targetId`無しで最大5回、残れば`activationId`だけのメッセージの`Error`)。どちらもデコレータ付き・ログ無し・例外は捕まえない。5.5は`ULTRAS_ACTIVATION_HANDLERS`(`apps/event/src/composition/ultras-activation-handlers.ts`)に`tournament-week.ultras-entry-exemption`(1500)・`tournament-week.open-entry-checkout-expiry`(1510)を加え、付与→失効の順を保つ。3.8(特典の終了で資格を戻さない)は5.5の結線のテストで扱う。
- 5.4: eventの`WeekEntrySupplementProvider({store, products, clock, clientSiteOrigin})`(デコレータ無し、5.5で`toDynamicValue`、`PRODUCT_PLATFORM_TYPES.ProductDirectory`・`PLATFORM_TYPES.Clock`・envの`CLIENT_SITE_ORIGIN`)。予選の勝利でローンチがあるときだけ: Ultrasの`entitled`は`drawAt`の日時の免除の追記(強調・ボタン無し)、受付中または枠が未作成で`now < acceptUntil`なら受付期限と導線`<origin>/p/<handle>`(日曜日は強調、見えないプロダクトはボタン省略)、他は`undefined`。期限は保存した列(週の行が無いときだけ`entryWindowFor`)。5.5は`RESULT_NOTICE_SUPPLEMENTS`に`{ name: 'tournament-week.entry-deadline', kinds: ['qualifier'], order: 1500 }`を加え、`notifications-module.worker.test.ts`の「初版の登録口は空…」の2件を書き換える。
- 5.5: eventの`EVENT_WEEK_TOURNAMENT_MODULE`(`apps/event/src/composition/week-tournament-module.ts`、名前`event-week-tournament`、`createWeekTournamentPlatformModule('event')`の直後)と5つの登録口に8件(設計の表どおり)。登録口ごとの単体テストは`apps/event/src/composition/*.unit.test.ts`。予選の確定で枠と週の行が作られるため、上流のテストでマッチ・プロダクトを消す前に`clearWeekTournamentRows()`(`workers/week-tournament/testing/week-tournament-fixtures.ts`)を呼ぶこと(8.x・E2Eも同じ)。8.2で5つの登録口の8件を`project-values.md`へ。
- 6.1: apiの識別子`WEEK_TOURNAMENT_API_TYPES`(`apps/api/src/application/week-tournament/week-tournament-api-types.ts`、`week-tournament.api.<名前>`、13種。設計に無い`TrophySources`(登録口の注入)、共用の`ProductTrophyReader`もここ)、ポート`ports.ts`の`WeekTournamentIncidentReporter`・`WeekTournamentIncident`(`evening-bracket-failed`: `date`・`failedSteps`・`failedTournamentIds`、`entry-follow-up-failed`: `tournamentIds`・`entryCount`)、ジョブ`week-tournament-jobs.ts`の`EveningBracketJob`・`EntryFollowUpJob`(デコレータ付き、`EVENING_BRACKET_JOB_DEFINITION`・`ENTRY_FOLLOW_UP_JOB_DEFINITION`・`EVENING_BRACKET_PARTICIPANT`)。`markReady`の例外は失敗の通知へ渡さない(定期実行のディスパッチャが拾う)。4:21は`now - 10分 + 1ms`。親の決定: application層の`@sentry/*`の禁止はESLintの規則に無い(既存の全specも同じでgrepで確認)が、全バックエンドへの横断の変更になるため本specでは規則を足さない(最終報告で開発者へ挙げる)。6.2は`kind`から`job`のタグを作る。6.10は`EveningDispatchGate`がapiのnotificationsのモジュールにだけ束縛されている点に注意。
- 6.2: `apps/api/src/infrastructure/week-tournament/sentry-week-tournament-incident-reporter.ts`の`SentryWeekTournamentIncidentReporter`(`@injectable()`、引数無し、6.10で`to()`)。`level: 'error'`、`fingerprint: ['tournament', kind]`、タグ`tournament_incident`・`job`(ジョブの定義の名前)・`tournament_id`(1件のときだけ)、コンテキスト`tournament_incident`、ログ`['api','infrastructure','week-tournament']`。設計のMonitoringのcamelCaseのタグ名とは違う(snake_caseで統一)。
- 6.3: `apps/api/src/application/week-tournament/`の`WeekRelaunchConditionSource`(`tournament-week.entry-pending`(受付中・枠の作成前、決済期限の前だけ、`releaseAt`は保存した`deadlineAt`か規則の値)・`tournament-week.result-pending`(参加資格を得た枠・勝ち残り・凍結の後で記録前の`drawn`、`releaseAt: null`。最後のは設計の条件に無い))と`WeekProductLockSource`(`tournament-week.bracket-lock`、勝ち残りと凍結の後の記録前の`drawn`)。共通の読み取り`week-launch-standings.ts`の`readWeekLaunchStandings`(6.4で再利用可、要約の対象は`launches`で形が違う)。ストアに`findTournamentsByWeeks(weekStarts)`を追加(設計に無い、013の一定回数の問い合わせのため)。どちらも`@injectable()`で6.10で`to()`。偽物の補助`testing/week-decision-fakes.ts`。
- 6.4: `apps/api/src/application/week-tournament/week-launch-summary-source.ts`の`WeekLaunchSummarySource(WeekTournamentStore, BracketStore, MatchDirectory)`(`@injectable()`、6.10で`to()`して`LAUNCH_SUMMARY_SOURCES`へ)。rankは優勝50・マッチ中40(`inMatch`)・進出30・敗退30・参加決定20・参加受付中10(受付期限`acceptUntil`より前)。ラウンド名は`roundLabel({round, stage: roundStage(shape, round)})`。`BracketStore`に`findParticipantStandings(kind, refs)`(`BracketParticipantStanding`)を追加(設計に無い、8.2の文書。tournament-yearの偽物にも要る)。テストの補助`testing/week-summary-fakes.ts`。決勝の確定から週の行の`awarded`の記録までの間は要約を返さない(短時間)。
- 6.5: 契約`apps/api/src/application/tournament/trophy-source.ts`(`TrophySource`・`TrophyRecord`・`TrophyKind`・`RegisteredTrophySource`・`assertTrophySourceRegistrations`・`resolveTrophySources`)、照会`application/tournament/product-trophy-reader.ts`の`SourcedProductTrophyReader`(`resolveProductPage`が`render`でなければ`null`、Yearが先頭・同じ種類は受賞の新しい順、失敗は`callDecisionSources`で`warning`・カテゴリ`['api','application','product']`)、`application/week-tournament/week-trophy-source.ts`の`WeekTrophySource`(`listChampions({awardedFrom: null, awardedBefore: clock.now()})`を1回読みメモリで絞る、パス`/tournaments/week/<ISO週>`)、登録口`composition/tournament-trophy-sources.ts`の`TOURNAMENT_TROPHY_SOURCES`(`tournament-week.week-trophies` 20、Yearは10で追記)。親の決定: 共用の`application/tournament/`が`WEEK_TOURNAMENT_API_TYPES`(6.1の`ProductTrophyReader`・`TrophySources`)を読み込む形は、tournament-yearが登録口へ追記するだけで済むためそのままにする。6.10は`TrophySources`を`resolveTrophySources(TOURNAMENT_TROPHY_SOURCES, resolverOf(context))`の`toDynamicValue`、`WeekTrophySource`(Clockも)・`SourcedProductTrophyReader`を`to()`。
- 6.6: `apps/api/src/application/week-tournament/week-board-reader.ts`の`DirectoryWeekBoardReader`(6.10で`to()`)。行は(トーナメント×ラウンド)ごとに`tournament`・`round`・`roundName`(`tournamentRoundName`)・`finalDate`(記録された最新ラウンドの実施日から`dailyRoundPolicy().nextRoundDate`、決勝が予定済みならその日)・`isFinal`・`firstRoundDate`・`matchIds`・`bracketPath`(設計に無い2項目を追加)、1回戦の日の昇順。読み取りは`listForDate`・`findByMatchIds`各1回と、トーナメントごと(最大2)の`BracketStore.findById`・`findTournament`(設計の性能の記述は前の2つだけ。14.7には合う)。パスの共通関数`week-bracket-path.ts`の`weekBracketPathOf`(Weekの照会が使う。種類によらない6.7は使わない)。6.11への申し送り: 照会は開始前のマッチのIDも含み`both_forfeited`も含むので、リゾルバが`placementOf`で対戦と不戦勝に分け、必要なら`startedAt`で開始前を除く。
- 6.7(差し戻し1回): `apps/api/src/application/tournament/bracket-view-builder.ts`の純粋な関数`buildBracketRoundsView({record, matchViews, now})`(入力の型`BracketRoundsViewInput`)。ESLintの規則`api/tournament/bracket-view-builder`(apiの`eslint.config.ts`、このファイル・テスト・補助だけが対象)でWeekの部品と`lib/workers`の読み込みを禁じる(検査`apps/api/test/config/tournament-layer-rules.unit.test.ts`)。枠の表し方: 未来の枠は`feedLabel`(「シード<n>」・「<ラウンド名>第<位置>試合の勝者」)、`planned`でマッチの無い位置も参加者の番号でfeedを選んで`feedLabel`を付ける、挿入前の1回戦の非シードは番号だけ(表記無し)、空の枠は全てnull、マッチがあり`product`がnullなら表示できないプロダクト。欠けた位置は確定したラウンドでだけ両側が空として除く。実施日は記録の`matchDate`の最大、記録の無いラウンドは`dailyRoundPolicy(firstRoundDate, now)`。7.4は`feedLabel`あり→未来の枠、`participantNo`と`feedLabel`がnull→空、ノードの`match`がnull→番号だけ、それ以外で`product`がnull→「非公開のプロダクト」の順で描く。
- 6.8: `apps/api/src/application/week-tournament/week-bracket-reader.ts`の`DirectoryWeekBracketReader`(6.10で`to()`、依存は`WeekTournamentStore`・`BracketStore`・`MATCH_TYPES.MatchViewReader`・`ProductDirectory`)。`read({week, viewer: CurrentUser|undefined, now})`(設計は`read(weekKey, now)`。6.11は`AccountGuard.currentUser(context.session)`で利用者に変えて渡す)→`WeekBracketView`(`tournament`・`rounds`・`champion`)。未決定は週の行が無いか`bracketId`がnull。ブラケットは`findByTournament('week', tournamentId)`(設計の`findById`と違う、結果は同じ)。マッチの表示は90件ずつ。優勝は`championNo`→参加者の`productId`→`findSummaries([id], 'visible')`→`productViewOf`(マッチの側と同じ規則)。`participantCount`・`seedCount`は`rounds`から。
- 6.9: `apps/api/src/application/week-tournament/week-entry-panel-reader.ts`の`DirectoryWeekEntryPanelReader.readForOwner(viewer, productHandle, now)`(現在のハンドルだけ、本人でない・枠が無いとnull、直近の取消でないローンチの枠)と`week-entry-checkout.ts`の`DefaultWeekEntryCheckout.start(session, launchId)`(`CheckoutStarter`へ`week_tournament_entry`・ローンチのID、bot判定のフック無し)。どちらも6.10で`to()`。パネルの値に設計に無い`ultrasGuide`(支払いが可能=受付中・免除でない・受付期限前と同じ条件)と`progress.eliminatedRoundName`を追加。参加費は支払いが可能なときだけ取得(`payments_unavailable`・価格無しはnull)。免除は4.5と同じ式、進行は6.4と同じ規則。6.11・6.12でGraphQLが`ultrasGuide`を公開するか決める。レビューの指摘で4.5の`WeekEntryOfferPolicy`にも、決済期限の後に確定した勝利(`wonAt > until`)ではUltrasを問い合わせないガードを加えた(直接のAPIの呼び出しで`RangeError`になっていた)。
- 6.10: apiの`WEEK_TOURNAMENT_API_MODULE`(`apps/api/src/composition/week-tournament-module.ts`、名前`api-week-tournament`、`createWeekTournamentPlatformModule('api')`の直後。13識別子、`TrophySources`だけ`toDynamicValue`)。ジョブ`tournament-week.evening-bracket`(23:45、1500)・`tournament-week.entry-follow-up`(4:21、1500)、判定の供給元`tournament-week.result-pending`・`tournament-week.bracket-lock`・`tournament-week.launch-summary`(1500)、夜の送り出しの前提`tournament-week.evening-bracket`。上流のテスト11件の期待値を書き換えた。`notifications-module.worker.test.ts`の登録外の名前の例は`tournament-year.evening-bracket`(tournament-yearが登録するときは別の未登録の名前へ差し替えること)。23:45の起動は空のD1でも`markReady`まで成功し、準備の完了による遅延0の送り出しは期限の送り出しとは別のメッセージ(8.1)。`project-values.md`は誤りになった「登録0件」の2か所だけ直した(一覧への追加は8.2)。
- 6.11: GraphQLのスキーマモジュール`apps/api/src/presentation/graphql/modules/week-tournament/`(`weekTournamentBoard`・`weekBracket`・`productTrophies`、`clientOnly`)。`BracketRound`・`BracketNode`・`BracketSlot`はcodegenのmappersで`BracketRoundView`等(親の値の型)に置き換え、`bracket-views.ts`のリゾルバは値だけを読む(Yearは`buildBracketRoundsView(...).rounds`をそのまま返せる。テストの補助`apps/api/test/support/week-tournament-graphql-operations.ts`の`bracketConsumerSchemaModule`)。トップページの区画は`placementOf`で分け`loadMatchView`でまとめて引く(開始前のマッチも、全マッチが両者の不戦敗の行も残す。並びはブラケットの位置の順)。業務日付の形式違反は`validation_error`(文言「日付の指定が正しくありません。」は文言規則に無い。8.2で追記)。`weekBracket`の週の形式違反と組み合わせ前は`null`。`WeekBracket.tournament.firstRoundDate`・`finalDate`は`BracketRoundsView`の最初・最後のラウンドの日(トップページは記録の`firstRoundDate`で、1回戦が遅れると両者が異なる)。ログのカテゴリ`['api','presentation','week-tournament']`。6.12は`type-defs.ts`に`WeekEntry*`と`myWeekEntry`・`type Mutation { startWeekTournamentCheckout }`を、`index.ts`に`Mutation`を足す(`errors.ts`は未作成)。7.1は`generated/schema.graphql`を読み、clientの操作を足した後に`graphql:allowlist`で許可リストを再生成する。
- 6.12: GraphQLに`myWeekEntry(productHandle)`(`clientOnly`→`requireUser`→`readForOwner`→`toWeekEntryPanel`、本人でない・形式違反はnull)と`startWeekTournamentCheckout(launchId)`(ULIDの形式違反は`week_entry_not_found`と同じ文言の`validation_error`(`errors.ts`)→`WeekEntryCheckout.start`)を加えた(`entry-resolvers.ts`)。`week_entry_*`・`checkout_closed`はHTTP 200のGraphQLのエラー、`payments_unavailable`だけ503(ultrasと同じ)。設計に無い`WeekEntryPanel.ultrasGuide: Boolean!`を公開(7.7は`ultrasGuide && UltrasPromotionGate`で案内を出す)。`progress`は`eliminatedRoundName`だけ。`bracketPath`は`drawn`かつブラケットがある枠だけ。テストの補助`apps/api/test/support/week-entry-graphql-operations.ts`。7.1は操作の追加後にapiで`graphql:allowlist`を再生成。
- 7.1: clientの操作5つ(`src/graphql/operations/week-tournament/`)とフラグメント3つ(`fragments/bracket/`・`fragments/week-tournament/`)、補助`src/graphql/week-tournament.ts`(`weekTournamentBoardQueryOptions`・`weekBracketQueryOptions`・`myWeekEntryQueryOptions`・`productTrophiesQueryOptions`・`startWeekTournamentCheckoutMutationOptions`、引数は`(viewer, 変数)`、キーの末尾に閲覧者のIDか`'guest'`、`myWeekEntry`は閲覧者が非null)。設計との相違(重要): 設計どおりにフラグメントを展開するとapiの深さの上限(`QUERY_LIMITS.maxDepth` 8)を超え`query_depth_exceeded`になる(`coding/004`の「深い経路はフラグメント内に直接書く」でも1回の展開で超える)。そのためフラグメントのファイルは置いて型(`BracketRoundFieldsFragment`・`BracketMatchProductFieldsFragment`・`WeekBoardRoundFieldsFragment`)を生成し、操作には同じ項目を直接書き(`champion`だけ`...BracketMatchProductFields`)、操作の結果とフラグメントの型の一致を`week-tournament.unit.test.ts`の`expectTypeOf().toEqualTypeOf()`で固定した(フラグメントか操作の一方だけを変えると型検査で落ちる)。7.2は`rounds[i]`をそのまま`splitBoardRound`(`WeekBoardRoundFieldsFragment`)へ、7.4・7.5は`weekBracket.rounds`を`readonly BracketRoundFieldsFragment[]`として使う。7.5の`null`→`notFound()`のloaderはルートのファイルへ。tournament-yearの照会も同じ制約(名前で展開できない)。8.2で設計の記述と`coding/004`の規約を直す。
- 7.2(差し戻し1回): トップページの区画`tournament-week.matches`(`main` 20、`apps/client/src/composition/top-page-sections.ts`)、部品は`apps/client/src/components/week-tournament/`(`week-tournament-section.tsx`・`week-board-round.tsx`・`week-section-heading.tsx`・モデル`week-board-model.ts`(`splitBoardRound`は`final`も返す、`weekSectionRoundsOf`は決勝の行と全両者不戦敗の行を除く)・文言`week-tournament-messages.ts`(7.5・7.6も使う)・テストの補助`week-board-fixtures.ts`・`apps/client/test/week-tournament-board-stub.ts`(トップページの経路のテストでWeekの取得をマッチの無い日にする))。取得の失敗はページの`RecoverableSlot`に任せる(設計1598行の`PartialErrorState`と文言規則003の「Weekトーナメントの区画の取得エラー」は使わない。8.2で設計と文言規則を直す)。予選の区画と同じく`useBoundaryRefresh`で23:40・0:00の境界に取り直し、集計中・開始前は`FOLLOW_UP_REFETCH_LIMIT`まで取り直し、上限でオフなら`FOLLOW_UP_EXHAUSTED_MESSAGE`。境界の時刻は予選の盤面の`toTopPageView(...).boundaries`から読む。`key={board.date}`で日付ごとに作り直す。7.3は同じ`weekTournamentBoardQueryOptions(viewer, date)`のキーを購読するので取り直しが重ならないよう注意し、`top-page-sections.browser.test.ts`の一覧に`showcase` 20を追記する。
- 7.3: トップページの決勝の区画`tournament-week.final`(`showcase` 20)、`apps/client/src/components/week-tournament/`の`week-final-showcase.tsx`・`week-final-round.tsx`・`week-final-model.ts`・`week-final-showcase.css`(演出は`prefers-reduced-motion: no-preference`かつ`[data-auto-refresh='on']`だけ)。7.2と共通の購読を`use-week-board.ts`の`useWeekBoard`、対戦カードを`week-match-card.tsx`に切り出した。取り直しの重複は、境界の`invalidateQueries(..., {cancelRefetch: false})`と、本文の区画が定期の取り直し中は決勝の区画が取り直さない規則(`weekFinalRefetchIntervalOf`。本文の区画が描かれている前提)で防ぐ。確定の判定は決勝のマッチの結果(勝った側を受賞、勝者なしを受賞なし)で、トーナメントの`awarded`より先に受賞を示しうる。親の決定: 決勝が不戦勝・早期勝利のときは`ByeList`(`ByeCard`は決勝でも「次のラウンドへ進みます。」を出す)を描かず、受賞の文だけで示す(8.2でページ配置・設計に書く)。紙吹雪は受賞のときだけ。ブラケットへの導線は置かない。上限の案内も出す(設計に無い)。
- 7.4: 共用の`apps/client/src/components/bracket/`(`BracketViewProps`・`BracketRoundColumn`(`section`と`h2`)・`BracketRoundTabs`(Radixのタブ、名前「ラウンド」、既定は未確定の位置を持つ最初のラウンド、無ければ最後)・`BracketMatchCard`(`article`と`h3`)・`BracketChampion`(`h2`、設計に無い`awardName`を呼び出し元から受ける。7.5は`'Product of the Week'`を渡す)、モデル`bracket-view-model.ts`(枠は6.7の順で描き分け)、文言`bracket-messages.ts`(`BRACKET_SCROLL_REGION_LABEL`は7.5の横スクロールの領域用)、補助`bracket-fixtures.ts`(tournament-yearも使える))。Weekの型・文言は読み込まない(規則は型検査と目視のみ)。設計・文言規則に無い文言: 予定前の1回戦の非シードの枠「抽選番号<n>」、空の枠「対戦相手なし」(マッチ履歴の流用)。勝敗はWALKOVER→不戦勝、LOSTでNO_VOTES・BOTH_FORFEITED→両者敗北。768px以上のグリッドと`overflow-x: auto`の領域、ページの`h1`は7.5で作る。
- 7.5(差し戻し1回): ブラケットのページ`apps/client/src/routes/tournaments/week/$week.tsx`(loaderは`parseIsoWeek`で形式違反を照会せず404、`null`も404、`staleTime: 0`。`WeekBracketRoute`が`key={week}`で`WeekBracketContent`を作り直し、`WeekBracketContent`が自動更新の状態と取得を持つ)、`components/week-tournament/week-bracket-page.tsx`の`WeekBracketPage`(`h1`は`tournament.label`、「参加n・シードm」、768px以上は名前付きの横スクロールの領域に列、767px以下はタブ、開催中だけ`AutoRefreshSwitch`)、`week-bracket-error.tsx`・`week-bracket-model.ts`・head`buildWeekBracketHead`(`head/page-heads.ts`)・リンク`weekBracketHref`(`components/layout/site-links.ts`)。親の決定: 規約004・010とUI-003を優先し、開催中は自動更新の切り替えを置く(ページ配置002の622行を直した。1.5の「置かない」は誤り)。共用の`AUTO_REFRESH_DESCRIPTION`の後半(残り時間と演出)はこのページに当てはまらない(8.2)。設計の`ensureQueryData`・`buildPageHead`は既存の`queryClient.query`・`buildSitePageHead`に合わせた。
- 7.6: トロフィーの区画`tournament-week.trophies`(`main` 10、`apps/client/src/composition/product-page-sections.ts`)、部品は`apps/client/src/components/trophy/`(`trophy-shelf.tsx`・`trophy-art.tsx`(`aria-hidden`)・`trophy-shelf-model.ts`(`orderTrophies`・`trophyAwardedDateOf`は業務日付)・`trophy-messages.ts`・`trophy-fixtures.ts`)。種類(Year・Week)によらない(tournament-yearはこの区画で描ける)。リンクは`bracketPath`の`<a>`で見える文言「ブラケットを見る」、名前は`aria-label`「<週の表記>のブラケットを見る」。取得の失敗は`RecoverableSlot`(文言規則003の「トロフィーの区画の取得エラー」は使わない。8.2)。プロダクト詳細の経路のテストの偽物`test/product-page-route-fixtures.ts`の`respondOtherSections`はトロフィーに空を返す。
- 7.7(差し戻し1回): 参加費の導線の本体`apps/client/src/components/week-tournament/week-entry-panel.tsx`の`WeekEntryPanel({productHandle, autoRefresh, onAutoUpdatingChange?})`(`useSuspenseQuery(myWeekEntryQueryOptions)`で失敗は置き場所の`RecoverableSlot`、境界の48時間前と受付期限で`useBoundaryRefresh`)、`entry-deadline.tsx`(秒読みは`role="timer"`、`autoRefresh`が偽なら秒読みも毎秒の更新も無い)、`week-entry-checkout.tsx`(`/checkout/$purchaseId`へ、`checkout_closed`は「Weekトーナメントの参加受付は終了しました。」に置き換え)、`week-entry-model.ts`(`weekEntryDisplayOf`・`hasEntryCountdown`)。親の決定: 組み合わせ決定の日時はclientで複製せず、GraphQLの`WeekEntryPanel`に`drawAt: DateTime!`を加えた(6.12・7.1のファイルへの横断)。`onAutoUpdatingChange`は秒読みがある間(受付中で受付期限まで48時間未満)、`autoRefresh`のオン・オフによらず`true`。7.8の方針(親の決定): プロダクト詳細は上流の`ProductOwnerActionContext`に`autoRefresh`・`reportAutoUpdating`を加えて渡す(`reportAutoUpdating`は安定した関数)、自分のプロダクトの画面は`autoRefresh={false}`で`onAutoUpdatingChange`を省く(秒読みなし、受付期限の日時と注意色だけ)。参加費は`MoneyText`の「$5.00」(文言規則の例は「$5」)、見出し「Product of the Weekトーナメント」は設計に無い(8.2)。
- 7.8(差し戻し1回、文書のみ): 投稿者本人向けの操作`tournament-week.entry`(10、`week-entry-owner-action.tsx`、`autoRefresh`・`onAutoUpdatingChange={context.reportAutoUpdating}`)、自分のプロダクトの区画`tournament-week.entry`(10、`week-entry-my-product-section.tsx`、`autoRefresh={false}`)、削除の注意書き`tournament-week.entry-loss`(10、`week-entry-delete-notice.tsx`、`AWAITING_PAYMENT`・`ENTITLED`だけ)。上流(directory-discovery)の`ProductOwnerActionContext`を`Omit<ProductPageContext,'page'>`に広げ(`ProductLaunchSectionContext`は従来どおり除く)、`OwnerCard`が操作ごとの申告を`OwnerActionSlot`・`withActionReport`で集約し失敗とアンマウントで消す(`top-page.tsx`・`product-page.tsx`と同じ形の3つ目)。directory-discoveryのdesign.mdの`ProductOwnerAction`の型は古いまま。経路のテストの補助(`test/product-page-route-fixtures.ts`・`test/edit-product-fixtures.tsx`等)は`myWeekEntry`に既定で`null`を返す。tournament-yearは`PRODUCT_OWNER_ACTIONS`に`order` 20で追記できる。
- 8.1: 時刻の連鎖の統合テスト`apps/api/src/composition/week-tournament-module.night.worker.test.ts`・`week-tournament-module.progression.worker.test.ts`と補助`apps/api/test/support/week-tournament-timeline.ts`(`createScheduledDispatcher`と`createCronRegistry(SCHEDULED_JOBS)`、`MODULES`にStripeGateway・EmailSenderの差し替え、Dateだけの偽の時計、送信を記録するQueue)。eventの確定の処理の代わりに`RoundProgressHandler`と同じ手順をテストで書く(`apps/event`は読まない)。凍結の後の反映は付与の判断の直後に23:45の起動を割り込ませて再現。この場面では`publishNight`は`applyResult`と重複する(順は単体テストで確かめている)。
- 8.2(差し戻し1回): 技術ドキュメント`docs/GUIDES/tech/backend/017-single-elimination-brackets.md`・`frontend/016-tournament-bracket-view.md`(汎用の語。本プロジェクトでの読み替えは`project-values.md`の「Weekトーナメント」の節の「技術ドキュメントの汎用の語」)、各README・CLAUDE.mdの参照先、`project-values.md`の「Weekトーナメント」の節。Implementation Notesの「8.2で」の項目に従い、文言規則003・ページ配置002・`coding/004`を直した。親の決定で、共用の`AutoRefreshSwitch`に任意の`description`を足し、ブラケットのページは`BRACKET_AUTO_REFRESH_DESCRIPTION`(`components/bracket/bracket-messages.ts`)を渡す。`.kiro/`(design.md)は書き換えていない(相違は最終報告)。
