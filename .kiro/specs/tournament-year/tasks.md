# Implementation Plan

- [ ] 1. 基盤: 共用の部品への移設・テーブル・監査ログの操作種別・サービス仕様
- [x] 1.1 業務日付の日数の加算と曜日を業務時刻の共通の部品から公開し、トーナメントの計算を寄せる
  - 前提: 本specが使う上流(dev-tooling・backend-platform・api-gateway・frontend-platform・identity-auth・email-delivery・admin-foundation・payments・ultras-subscription・notifications・product-launch・directory-discovery・match-engine・tournament-week)の実装が済んでいること(2026-11-17に設計の上流の契約を現在のコードと照合済み。sponsorshipなど未実装のspecの部品は使わない)。無ければ該当するタスクを保留して開発者へ報告する
  - 開発者が行う作業(devとstagingが共用するStripeのsandboxでの、`lookup_key`が`year_tournament_entry`の価格(参考$20、税込)の1回の作成。prodはlaunch-readinessが行う)を、この最初のタスクで報告する(8.4のE2Eの前提。3.16・5.13はStripeの模擬応答を使う)
  - 実装前のギャップ分析の決定G5による、tournament-weekのコードへの明示の横断である。計算結果は変えない
  - 先に、業務時刻の共通の部品の単体テストで、日数の加算(月末・年末・うるう年・負の日数)と曜日(月曜日1〜日曜日7)を確かめる
  - Weekの決済期限の計算の非公開の計算と、ブラケットの次ラウンドの日の公開の関数を新しい関数に置き換える(公開の関数は削り、呼び出し元のブラケットの進行・Weekの組み合わせ決定と通知の発行を移す)
  - 完了状態: 単体テストが成功し、置き換えたファイルのtournament-weekとブラケットの既存の単体テストとWorkers統合テストが期待値を変えずに成功し、削った公開の関数の参照が`apps/`で0件になる
  - _Requirements: 1.1, 1.2, 1.4, 15.1_

- [x] 1.2 (P) ローンチ日の規則・マッチの日次のジョブ・夜の通知の収集の業務日付の計算を、1.1の共通の関数に寄せる
  - 実装前のギャップ分析の決定G5による、product-launch・match-engine・notificationsのコードへの明示の横断である。計算結果は変えない
  - 1.1の共通の部品の公開の後に行い、1.1が変えるtournament-week・ブラケットのファイルとは重ならない
  - ローンチ日の規則の公開の加算の関数を削って、呼び出し元(物理削除の段取りのジョブと単体テスト)を共通の関数へ移し、マッチの日次のジョブと夜の通知の収集の非公開の翌日の計算を置き換える
  - 完了状態: product-launch・match-engine・notificationsの既存の単体テストとWorkers統合テストが期待値を変えずに成功し、`apps/`に業務日付の日数の加算の独自の実装が残っていないことを検索で確かめる(clientも使う共用部品の週の計算は対象外)
  - _Boundary: product-launchのローンチ日の規則、match-engineの日次のジョブ、notificationsの夜の通知の収集_
  - _Depends: 1.1_
  - _Requirements: 15.1_

- [x] 1.3 Weekのシード・非シードの並びと返金の依頼の拒否の写像を、種類によらないブラケットの共通の規則へ移す
  - 実装前のギャップ分析の決定G2・G4による、tournament-weekのコード(並びの規則と単体テスト、枠の規則の拒否の写像と単体テスト、組み合わせ決定と返金の後処理の参照)への明示の横断である。並びと写像の規則は変えない
  - 1.1と同じWeekの組み合わせ決定のファイルを変えるため、1.1の後に行う
  - 先に、移す先の単体テストとして、Weekの並びの単体テスト(Weekトーナメント規則の例を含む)と拒否の5つのコードの写像の単体テストを、種類によらない名前で移す
  - 移す元の公開の名前を削り、Weekの組み合わせ決定・返金の後処理・オンボーディングの本プロジェクト固有の値の記述を新しい名前へ改める
  - 完了状態: 移した単体テストと、tournament-weekの既存の単体テスト・Workers統合テストが期待値を変えずに成功し、旧い名前の参照が`apps/`・`docs/`で0件になる
  - _Requirements: 6.8, 7.4, 7.5, 15.1_

- [x] 1.4 (P) 違反を除いた通知の発行を通知の機能の共用の部品へ移し、Weekの通知の発行をそれで行う
  - 実装前のギャップ分析の決定G3による、notificationsとtournament-weekのコードへの明示の横断である。50件ずつの発行・違反の1件の除外と再発行・ログのレベルの分け方・例外の伝わり方は変えない
  - 1.3が変えるWeekの組み合わせ決定・返金の後処理とはファイルが重ならない(Weekの通知の発行は1.1が先に変える)
  - 先に、共用の部品の単体テストで、50件の分割、違反の除外と再発行、開始済みの予告の違反は`info`でそれ以外は`error`のログ(識別と理由だけ)、位置の無い拒否・範囲外の位置・一時的な失敗が例外のまま伝わることを確かめる(Weekの通知の発行の既存のテストの例を移す)
  - Weekの通知の発行の非公開の処理を削り、共用の部品を呼ぶ
  - 完了状態: 単体テストと、Weekの通知の発行の既存のWorkers統合テストが期待値を変えずに成功する
  - _Boundary: ViolationTolerantPublish、tournament-weekの通知の発行_
  - _Depends: 1.1_
  - _Requirements: 14.5, 15.1_

- [x] 1.5 (P) Weekのトップページの区画と決勝の演出の部品を、種類によらない共用の部品へ移す
  - 実装前のギャップ分析の決定G6による、tournament-weekのclientの部品への明示の横断である。Weekの表示・文言・取り直しの規則・登録の名前と`order`は変えない
  - clientだけを変え、1.1〜1.4(backend-lib・api・event)とファイルが重ならない
  - 種類ごとの文言の型(トップページ・決勝・ブラケット・参加費の導線の4つ)と種類によらない文言(「決勝日」「ブラケットを見る」「決済期限」「締め切りまであと」など)を、ここでまとめて作る。Weekの4つの型の値もここでWeekの文言のファイル(トップページ・決勝・ブラケットの文言と、参加費の導線の文言の2ファイル)に書き出し、種類によらない文言を読み込んでいたWeekの部品(期限の表示・決済の開始・導線のモデルと本体・ブラケットのページと失敗の表示を含む)の読み込み元を直す。1.6・1.7は文言の型とWeekの文言のファイルを変えない
  - 盤面のモデル・盤面の購読・行と見出しと対戦カード・決勝のモデルと行と演出のスタイルと、見出しと決勝の行が使うブラケットへのリンクを、設計の「clientの共用の部品」の表のとおり移し、照会・盤面の取り出し・差し替え・見出しの値・文言を引数で受ける形にする。Weekの区画と決勝の演出と盤面の購読は、Weekの値を渡す包みにする
  - 先に、移したモデルの単体テストと部品のブラウザテストを移す先へ移す。共用の部品のテストの値は`components/tournament/`の中に置き、Weekのフィクスチャを読み込まない(Yearの文言の例は6.2で加える)
  - 完了状態: 移したテストと、Weekの区画と決勝の演出の既存のブラウザテストが期待値を変えずに成功し、共用の部品(テストを含む)がWeekとYearの部品を読み込まないことを検索で確かめる
  - _Boundary: TournamentClientPartsのトップページの区画と決勝の演出、tournament-weekのトップページの区画_
  - _Requirements: 10.1, 10.4, 10.5, 10.6, 10.7, 15.1_

- [x] 1.6 (P) Weekのブラケットのページの本体を、種類によらない共用の部品へ移す
  - 実装前のギャップ分析の決定G6による、tournament-weekのclientの部品への明示の横断である。Weekのページの表示・取り直し・失敗の表示は変えない
  - ブラケットのモデル(照会の値から共用の4部品への引数、開催中の判定、取り直しの間隔)・ページの本体・失敗の表示を移し、題名・参加数とシード数の表記・失敗の文言を引数で受ける(リンクは1.5で移した)。Weekのページは包みにする。文言の型とWeekの文言のファイルは変えない
  - 先に、移したモデルの単体テストと部品のブラウザテストを移す先へ移す(テストの値は`components/tournament/`の中のブラケット用のファイルに置き、1.7の参加費の導線用のファイルと名前を分ける。Yearの例は6.4で加える)
  - 完了状態: 移したテストと、Weekのブラケットのページの既存のブラウザテストが期待値を変えずに成功し、共用の部品(テストを含む)がWeekとYearの部品を読み込まない
  - _Boundary: TournamentClientPartsのブラケットのページ、tournament-weekのブラケットのページ_
  - _Depends: 1.5_
  - _Requirements: 11.1, 11.2, 11.5, 15.1_

- [x] 1.7 (P) Weekの参加費の導線の本体を、種類によらない共用の部品へ移す
  - 実装前のギャップ分析の決定G6による、tournament-weekのclientの部品への明示の横断である。Weekの導線の表示・文言・秒読み・Ultrasの案内・決済の開始は変えない
  - 表示の種類のモデル(入力は種類によらない形で、返金の対象・除外の理由を含む)・導線の本体(秒読みの有無を引数で受ける)・決済の開始・期限の表示を移す。Weekの導線は、Weekの照会の値を種類によらない入力へ写す新しい関数(返金の対象は従来どおり免除でないこと)と包みにする。文言の型とWeekの文言のファイルは変えない
  - 先に、移したモデルの単体テストと部品のブラウザテストを移す先へ移し(テストの値は`components/tournament/`の中の参加費の導線用のファイルに置き、1.6のブラケット用のファイルと名前を分ける。Yearの例は6.5で加える)、写しの関数の単体テストを加える
  - 完了状態: 移したテストと、Weekの参加費の導線・2つの包み・削除の注意書きの既存のブラウザテストが期待値を変えずに成功し、共用の部品(テストを含む)がWeekとYearの部品を読み込まない
  - _Boundary: TournamentClientPartsの参加費の導線、tournament-weekの参加費の導線_
  - _Depends: 1.5_
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 15.1_

- [x] 1.8 年のトーナメントと参加の枠のテーブルとマイグレーションを作る
  - テーブルの定義はtournament-weekと同じトーナメントのドメインのディレクトリに置く(G8)
  - 先に、テーブルの定義の単体テストで、年の一意索引と範囲の制約、決勝日の出どころ・状態・結果の値の制約、設定済みなら版が1以上・終了なら結果が必須・受賞なら優勝の枠が必須の制約、枠のWeek優勝とローンチの一意索引、状態・理由・返金(`already_refunded`・`rejected`を含む)と知らせの状態の値の制約、参加資格の状態なら出どころが必須・決済なら購入が必須・組み合わせと除外と遅れなら終えた年が必須の制約、外部キーに`ON DELETE`の指定が無いこと、他のspecの識別子(Week優勝・購入・管理者)に外部キーが無いことを確かめる
  - mainの最新を取り込んでからマイグレーションを生成し、ローカルに適用する。生成したマイグレーションのCHECK・一意索引・ブラケットへの外部キーを確かめる単体テストを、tournament-weekの前例と同じ形で加える
  - 完了状態: 単体テストが成功し、マイグレーションをローカルのD1に適用できる
  - _Requirements: 7.11, 9.4, 15.4_

- [x] 1.9 (P) 決勝実施日の変更の監査ログの操作種別を加える
  - 先に、単体テストで、操作種別の名前・表示名・対象の種類(設定)・任意の理由・詳細の鍵(年・変更前後の日付・変更前の出どころ)・対象の上限1と、全操作種別の集約の重複の検査を確かめる
  - 本specの操作種別のファイルを作り、管理画面の監査ログの操作種別の集約へ加え、集約の一覧を確かめる既存の単体テストを書き換える
  - 完了状態: 単体テストが成功し、集約の検査を通る
  - _Boundary: YearAuditActions_
  - _Requirements: 2.10_

- [x] 1.10 (P) Yearトーナメント規則・日次タイムライン・ページ配置・文言規則に本specの決定を先に書き、返金ポリシーと決済実装方針との一致を確かめる
  - Yearトーナメント規則: 仮1(前年の決勝日の扱いと初年度)・仮2(64を超える参加)・仮3と仮4(組み合わせ決定時点の除外と返金)・仮6(期限の後の反映)の確定した規則を加え、凍結の時点、ラウンドの遅れの回復(決勝が決勝日の後になり得ること)、ブラケットのページ(仮5)を加え、「参加数上限64(決勝日設定の制約により保証)」の記述を仮2に合わせて直す
  - 日次タイムライン: 23:45の`tournament-year.evening-bracket`(1700。Week優勝の取り込み→組み合わせ決定→進行→通知の発行→夜の送り出しの準備の完了の通知の順)、4:21の表に`tournament-year.entry-follow-up`(1700、`content-processing.keyword-reextraction`(2300)より前)。夜の送り出しは前提の全機能の準備の完了の後(遅くとも23:55)に始まり、23:50を前提にしない
  - ページ配置: Yearのブラケットのページの構成(仮5)、トップページのYearの区画の見出しとブラケットへの導線、Yearの参加費の導線の状態の一覧と置き場所(秒読みとUltrasの案内を添えない)、削除の注意書き、管理画面の設定の決勝実施日の区画(現在の年と翌年、仮8)
  - 文言規則: 設計のSupporting Referencesに挙げたエラー・状態・ブラケット・管理画面・返金の知らせの文言
  - 返金ポリシーと決済実装方針: 既に更新済みのWeek・Yearに共通の停止の行・Yearの上限による停止の行・購入種別の表のYearの行が、仮4・G4と一致することを確かめ、差があれば直す
  - 完了状態: 6つの文書が整形の検査を通り、6・7のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service`の該当する6文書_
  - _Requirements: 16.6_

- [ ] 2. Yearの純粋な規則
- [x] 2.1 決勝日と期限・1回戦の日の規則を作る
  - 先に、単体テストで、既定の決勝日(5月31日が日曜日の年と月曜日の年を含む複数の年)、決勝日からの決済期限日・受付期限23:00・決済期限23:35・組み合わせ決定23:45・変更期限(7日前の0:00)、参加数2・3・4・5・8・9・13・16・17・32・33・64の1回戦の日(決勝日〜5日前、N = 13はYearトーナメント規則の例どおり3日前)と参加数1以下の無し、65での例外、日曜日でない決勝日での例外を確かめる
  - 曜日と日数の計算は1.1の業務時刻の共通の関数で行う
  - 完了状態: 単体テストが成功し、規則がD1を読み込まない
  - _Requirements: 1.1, 1.2, 1.4, 1.6, 16.2_

- [x] 2.2 選べる決勝日と検証の規則を作る
  - 2.1の日程の型を使うため(P)にしない
  - 先に、単体テストで、設定できる対象年(現在の年と翌年)、日曜日と対象年、8日後の境界(その日の0:00がちょうど8日後は可、1ミリ秒足りなければ不可)、前年から447日と448日、翌年が設定済みのときの447日と448日、変更期限の前後と凍結による変更不可、拒否の理由の順、候補の一覧(変更できなければ空)、翌年の既定の日の注意の有無を確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 2.4, 2.5, 2.6, 2.8, 2.12, 16.2_

- [x] 2.3 (P) 対象年の判定の規則を作る
  - 先に、単体テストで、決済期限日の前日と当日のWeek優勝、開催しなかった前年(行が無く組み合わせ決定の時刻を過ぎた年)を飛ばして今年の対象になること(初年度)、凍結済みの年への遅れ、1月初旬の決勝日(決済期限日が前年の12月)、前年の決勝日が設定されていると扱う条件を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearTargetRules_
  - _Depends: 2.1_
  - _Requirements: 3.4, 3.5, 3.6, 3.9, 16.2_

- [x] 2.4 (P) 参加数の上限の規則を作り、共用の並びでYearトーナメント規則の例を確かめる
  - 先に、単体テストで、上限の64件と65件でWeek優勝の日時が最も古い1件が外れること、同時刻の識別子の順、Yearトーナメント規則のN = 13の例(シードP2・P7・P11、1回戦P1×P3・P4×P5・P6×P8・P9×P10・P12×P13)を1.3の共用の並びとtournament-weekの組み合わせの規則で再現すること、同日のローンチの同順、Upvote数0の末尾を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearCapacity_
  - _Depends: 1.3_
  - _Requirements: 6.5, 7.4, 7.5, 7.10, 16.2_

- [x] 2.5 (P) 参加の枠の状態と返金の理由・返金の状態・依頼キーの規則を作る
  - 先に、単体テストで、終わっていない状態が受付中と参加資格の2つであること、喪失は返金の理由「entitlement_lost」、停止は「entitlement_suspended」、上限は「capacity_exceeded」になり依頼キーが`tournament-year:<購入ID>:<理由>`になること、返金の状態が6つ(`already_refunded`・`rejected`を含む)であること、参加資格を得た状態が特典の終了で戻らないことを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearEntryRules_
  - _Requirements: 5.6, 5.8, 6.7, 9.5_

- [ ] 3. Yearの部品
- [x] 3.1 年のトーナメントのストアと、Yearの部品の契約と識別子を作る
  - Yearの部品の契約と型(`NewYearEntry`・`YearAwardedProduct`を含む。`YearEntryOfferPolicy`・`YearEntryFulfillment`はpaymentsの契約を実装するため除く)を純粋な部品(`apps/backend-lib/core/year-tournament/ports.ts`)に、Yearの全部品のDIの識別子`YEAR_TOURNAMENT_TYPES`を`core/year-tournament/identifiers.ts`にここで作る。api・eventとdata-exportのapplication層が契約と識別子を読み込むため、`workers`に置かない。年のストアのD1の実装は`workers/year-tournament/d1-year-tournament-store.ts`に作る(3.2〜3.4の枠のストアは`d1-year-entry-store.ts`)。束縛と登録は3.16でまとめて行い、3.2〜3.15は束縛と登録のファイルを変えない(テストは部品を直接組み立てる)
  - 先に、ローカルD1のWorkers統合テストで、年の行の用意の重複の無視(既定の日の列)、複数の年の読み取り、組み合わせ決定の時刻が到来した年の一覧、凍結の1回だけの成功、組み合わせの記録(参加0・1の終了と受賞の日時を含む)、終了の記録が1回だけ、凍結済みの最新の決済期限日、受賞の日時の範囲での受賞の読み取り(紐付けを解除した優勝の枠の除外)、プロダクトごとの受賞の読み取り(紐付けを解除した受賞の除外)を確かめる
  - 同じく先に、識別子`YEAR_TOURNAMENT_TYPES`が`Symbol.for('year-tournament.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - 完了状態: 単体テストとWorkers統合テストが成功し、`core/year-tournament`が`core/week-tournament`・`workers`・`apps/db`を読み込まない
  - _Depends: 1.8, 2.5_
  - _Requirements: 7.2, 9.4_

- [x] 3.2 参加の枠のストアの挿入と引き当てを作る
  - 先に、ローカルD1のWorkers統合テストで、Week優勝からの挿入の重複の無視、凍結済みの年の決済期限日がWeek優勝の日より後なら期限切れ(遅れ)で挿入されること、Week優勝とローンチからの引き当て(90件を超える入力の分割)、対象の候補の一覧(決済期限日より前の終わっていない枠だけ)を確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 3.3, 3.4, 3.7_

- [x] 3.3 参加資格を変える書き込み(Ultrasによる付与・喪失・分類・上限)と凍結の条件をストアに加える
  - 先に、Workers統合テストで、Ultrasによる付与の条件付きの更新、プロダクト・投稿者ごとの喪失と返金待ちの記録(購入の有無)、分類と終えた年の記録、上限を超えた枠の除外と返金待ち、凍結の後にその年の決済期限日より前の枠への付与・喪失が何もしないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 5.2, 6.1, 6.4, 6.5, 7.11_

- [x] 3.4 返金と知らせの状態・物理削除をストアに加える
  - 3.1で作った枠のストアの契約を、3.2〜3.4で実装に順に加える。契約の全メソッドが揃う本タスクの完了時に、backend-libの型検査を通す
  - 先に、Workers統合テストで、返金待ち・知らせ待ちの一覧(最後の更新から一定の時間が経った枠だけ)と状態の更新、拒否による返金待ちの終わり方(`not_needed`・`already_refunded`・`rejected`、返金待ちの条件付きで知らせを待ちにしない)、物理削除での組み合わせに入った枠の紐付けの解除とそれ以外の枠の削除を確かめる
  - 完了状態: Workers統合テストが成功し、backend-libの型検査が通る
  - _Requirements: 6.8, 15.4_

- [x] 3.5 年の照会と対象年の判定の部品を作る
  - 先に、ローカルD1のWorkers統合テストで、行のある年(列の値)と行の無い年(既定の日、組み合わせ決定の時刻の前後で開催予定と開催しなかった年)の照会、照会が行を作らないこと、次に開催する年の行の用意、Week優勝の日からの対象年(初年度の繰り越し・遅れ・組み合わせ決定の途中の年)、行の決勝日の列を書き換えた後に対象年と期限が変わること、凍結済みの最新の年の決済期限日からの期間の起点を確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 1.1, 1.3, 3.4, 3.5, 3.6, 3.8, 3.9_

- [x] 3.6 Week優勝から参加の枠を作る部品を作る
  - 先に、Workers統合テスト(Week優勝の照会・マッチの照会・特典の判定は偽物)で、Week優勝ごとの枠の作成と既存の枠の除外(WeekトーナメントのIDで引き当てる)、週の識別子をWeek優勝の週の初日から求めること、予選勝利時のUpvote数・最終Upvote時間・ローンチ日の写し、Week優勝の時点でUltrasの期間内なら参加資格(Ultras)で作ること、予選が見つからない枠を作らず`captureEvent`されること、凍結済みの年へ遅れて届いた枠が期限切れになり`captureEvent`されること、同じ取り込みの2回で枠が1つであることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 3.1, 3.2, 3.3, 3.7, 5.1_

- [x] 3.7 購入種別`year_tournament_entry`の可否と購入の内容を作る
  - 先に、Workers統合テスト(特典の判定・価格は偽物)で、投稿者以外・資格を得た枠・期限切れ・資格を失った枠・凍結後・表示できないプロダクト・Ultrasの期間内の拒否のコードと文言(コードごとの文言の一覧を同じファイルに置き、apiの表示層も読み込める唯一の出どころにする)、購入の内容(価格の`lookup_key`・数量1・関係のID・二重決済の鍵・受付期限23:00と決済期限23:35と反映の期限23:45・品名と分量と提供時期と追加事項)、行の無い年でも照会が行を作らないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 4.1, 4.3, 4.4_

- [x] 3.8 参加資格の付与(フルフィルメント)の判断と文を作る
  - 先に、Workers統合テストで、受付中の枠への付与の文と購入の記録、資格を得た枠・論理削除済みのプロダクト・投稿者の不一致の拒否、決済期限23:34の反映は新しいローンチがあっても付与し23:35以後の反映は新しいローンチがあれば拒否すること(仮6)、返した文を凍結の後に一括の書き込みで実行するとNOT NULL制約の違反で失敗すること、決済済みの枠がUltrasの加入で変わらないことを確かめる(paymentsの反映の経路の確認は3.16)
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 4.5, 4.7, 4.8, 5.6, 16.3_

- [x] 3.9 (P) 通知イベントの組み立てと発行を作る
  - 発行は1.4の違反を除いた発行の共用の部品で行う
  - 先に、Workers統合テスト(発行の口は偽物、ローカルD1にmatch-engineのテーブルを含む)で、確定したマッチの結果と側が2つの予告の発行、その夜の一括の発行(その業務日付の確定したYearのマッチの結果・翌日の側が2つで開始前のマッチの予告・当日の0:00から発行の時刻までに受賞を記録した年の受賞)、前年12月の組み合わせ決定の夜の参加1の受賞と翌年へ遅れた受賞が拾われること、紐付けを解除した優勝の枠を除くこと、Yearのマッチが無い夜は何も発行しないこと、受賞を`product_of_the_year`と対象年で発行すること、開始済みの予告が1件混ざっても残りが発行されること、同じ発行を2回行っても結果が変わらないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Boundary: YearNotificationPublisher_
  - _Depends: 1.4, 3.1_
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [x] 3.10 (P) 返金の知らせのメール種別とテンプレートを作る
  - 種別はメール種別のドメインごとの置き場所(`core/email/kinds/tournament-year.ts`)に、テンプレートはeventのドメインごとのディレクトリ(`templates/tournament-year/`)に置き、それぞれの集約点へ同じタスクで加える(1対1の検査。eventのテンプレートの集約点への追記を含む明示の横断)。メール種別の集約の一覧を確かめる既存の単体テストを書き換える
  - 先に、種別の入力のスキーマの単体テストと、テンプレートのWorkers統合テスト(email-deliveryの規約の`*.worker.test.tsx`)で、件名・宛名・対象年・Week優勝の週の表記・3つの理由の文言・決済履歴への導線と、決済の詳細を含めないことを確かめる
  - 完了状態: 単体テスト・テンプレートのテストと、種別とテンプレートの1対1の検査が成功する
  - _Boundary: YearEmailKinds、YearEntryRefundTemplate_
  - _Depends: 2.5_
  - _Requirements: 6.9_

- [x] 3.11 返金の依頼と知らせの部品を作る
  - 拒否の写像は1.3の共用の規則を使う
  - 先に、Workers統合テスト(返金の部品とメールの送信は偽物)で、返金待ちの枠の依頼(全額・理由・依頼キー)、受け付けと重複で依頼済みにして知らせ待ちにすること、拒否の5つのコードで返金不要・返金済み・拒否のいずれかで終え知らせを送らないこと、返金済みと拒否と理由の形式違反で運用者へ知らせ再処理の対象から外すこと、知らせの送信と退会済み・紐付けを解除した枠の`skipped`、1件の失敗で残りの枠を止めず最後に失敗を投げること(複数なら`AggregateError`)、一時的な失敗で状態が変わらないこと、ログとエラートラッキングに購入と枠の識別だけが出ることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 1.3, 3.4, 3.10_
  - _Requirements: 6.2, 6.6, 6.8, 6.9, 6.10, 15.6_

- [x] 3.12 Yearのラウンドの進行と、発行の後の終了の記録を作る
  - 進行の後処理は、結果と予告の発行→優勝の枠を読み直して受賞の発行→終了の記録の順にし、記録を最後に置く(G1)
  - 先に、ローカルD1(match-engineとtournament-weekのテーブルを含む)のWorkers統合テストで、進行中の年を決勝日からの方針で進めて結果と予告を発行すること、終えたときに予告を発行しないこと、隣接するマッチの両者敗北による不戦勝の連鎖と段階の記録、同じ年を2回続けて・同時に進めても次ラウンドのマッチが1組になること、0:00を過ぎた進行でラウンドが1日遅れ`captureEvent`されること、決勝の確定・残り1で受賞を発行した後に終了が1回だけ記録されること、受賞の発行が失敗したら年が進行中のまま残り再実行で発行と記録が1回ずつになること、受賞なしの記録、進行中の全ての年を進め1つの失敗が他を止めないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 3.1, 3.9_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 9.1, 9.2, 9.3, 9.4, 14.1, 14.2, 14.3_

- [x] 3.13 組み合わせ決定の前半(枠の補完・凍結・分類・上限)を作る
  - 先に、Workers統合テスト(特典の判定は偽物)で、Week優勝の枠の補完、23:44には対象にならず23:45で対象になること、凍結の条件付きの記録と凍結済みからの再開、分類(可視は組み合わせの対象、非公開化・停止は除外と返金待ち、論理削除済みは喪失と返金待ち、受付中でUltrasの期間内は参加資格、それ以外は期限切れ)、65件の参加で最も古いWeek優勝の1件が上限で除外され返金待ちになること、初年度に開催しなかった前年の枠が対象に含まれること、凍結と同時の削除・Ultrasの加入・反映・Week優勝の取り込みで分類の対象が変わらないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 2.4, 3.3, 3.5, 3.6_
  - _Requirements: 3.5, 5.5, 6.4, 6.5, 7.2, 7.11, 16.3_

- [x] 3.14 組み合わせ決定の後半(組み合わせ・記録・後処理)を作る
  - 並びは1.3の共用の並びをtournament-weekの組み合わせの部品へ渡す
  - 先に、Workers統合テストで、参加資格のプロダクトでの組み合わせとtournament-weekの部品による1回戦の予定(N = 13で決勝日の3日前、参加2で決勝日、各マッチは実施日の0:00開始・23:40終了)、組み合わせ決定から1回戦までの日にマッチが無いこと、参加1で結果を記録した後に受賞が発行されること、参加0の終了、返金の依頼と知らせ・予告の発行、年ごとの失敗が他の年を止めないこと、ログとエラートラッキングの出力にプロダクトの名称・メールアドレス・ハンドルが含まれず識別と件数だけであることを確かめる
  - 完了状態: Workers統合テストが成功し、23:45の実行に相当する呼び出しで1回戦の予定がmatch-engineのテーブルに作られる
  - _Depends: 3.11, 3.12_
  - _Requirements: 1.4, 1.5, 7.1, 7.3, 7.6, 7.7, 7.8, 7.9, 7.10, 8.10, 15.1, 15.6_

- [x] 3.15 (P) 受賞のエクスポートの部品を作る
  - 先に、Workers統合テストで、ローンチごとの受賞(`product_of_the_year`と対象年)と、紐付けを解除した受賞と受賞の無いローンチの扱いを確かめる
  - 3.1の`core/year-tournament/ports.ts`の契約を満たすD1の実装を`workers/year-tournament/d1-year-award-export.ts`に作る
  - 完了状態: Workers統合テストが成功する
  - _Boundary: YearAwardExport_
  - _Depends: 3.1_
  - _Requirements: 15.5_

- [x] 3.16 Yearの部品をapiとeventに束縛し、購入種別の登録の定数をpaymentsの登録口に加え、paymentsの反映の経路で確かめる
  - 3.1〜3.15の部品を、ストアは`@inject`、サービスは依存とアプリの名前を渡す束縛の形(tournament-weekと同じ)で処理単位に束縛するモジュールを作り、apiとeventの束縛の一覧へ同時に加える
  - 購入種別の登録の定数を本specの共有部品のディレクトリに作り、paymentsの購入種別の登録口がそれを読み込む(ultras-subscription・tournament-weekと同じ形)。登録口の一覧と登録の解決を確かめるpaymentsのモジュールのWorkers統合テストに本specの登録を加える
  - 登録と束縛の前に、tournament-weekの購入種別の登録(`WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION`・`week_tournament_entry`)と共有モジュールを名前で参照する上流のテスト(paymentsのモジュール、tournament-weekの共有モジュールの決済の経路、apiとeventのモジュールの束縛の一覧など)を`git grep`で洗い出し、登録の一覧の完全一致を確かめるものを本specの登録を加えた形に書き換える(明示の横断)
  - paymentsの反映の経路の確認は、依存の方向を守るためapiのWorkers統合テストの環境(`composition`の`*.worker.test.ts`)に置く
  - 先に、Workers統合テスト(paymentsの反映の経路、Stripeは模擬応答)で、反映での参加資格の付与、同じ購入の重複の反映(ランディング・Webhook・突合)で付与が1回、凍結と同時の反映が拒否と自動返金になること、資格を得た枠への2件目の決済が拒否されることを確かめる
  - 完了状態: apiとeventのWorkers統合テストの全件(書き換えた上流のテストを含む)・購入種別の集約点の全定義の検証の単体テスト・3経路のDIの解決の検査が成功する
  - _Requirements: 4.5, 4.6, 4.7, 4.9, 15.2, 16.3_

- [ ] 4. イベントサーバーの処理
- [x] 4.1 eventの識別子と、確定のマッチイベントの2つの処理を作る
  - eventの8つの処理のDIの識別子をここで作る(束縛と登録は4.5)
  - 先に、単体テスト(部品は偽物)で、Weekのマッチの確定で直近8日のWeek優勝の取り込みを呼ぶこと、Yearのマッチの確定でその年を進め結果の反映(発行と終了の記録)を行うこと、種別の違うマッチと本specの年に無いブラケットを無視すること、例外を再試行に任せることを確かめる
  - Yearとブラケットの部品は`core/year-tournament`・`core/tournament`の契約と識別子で受け取る
  - 完了状態: 単体テストが成功し、静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 3.16_
  - _Requirements: 3.1, 8.2_

- [x] 4.2 参加資格の喪失と物理削除の3つの処理を作る
  - 4.1の識別子を使うため(P)にしない
  - 先に、単体テスト(部品は偽物)で、削除で枠の喪失・ローンチの未完了の決済の失効(残りがあれば続き)・返金待ちの処理を行うこと、退会で喪失と返金待ちの処理を行うこと、凍結の後は喪失が0件で返金待ちだけを処理すること、物理削除で紐付けの解除と削除を行うことを確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 6.1, 6.2, 6.3, 15.4_

- [x] 4.3 (P) Ultrasの加入が有効になった知らせの2つの処理を作る
  - 先に、単体テスト(部品は偽物)で、Week優勝の後で決済期限より前の加入で受付中の枠に参加資格を与えること、Week優勝より前・決済期限の後の加入では与えないこと、未完了の参加費の決済を残りが無くなるまで最大5回失効させ残れば例外にすること、同じ知らせの2回の処理で結果が変わらないことを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearUltrasEntryExemptionHandler、YearOpenEntryCheckoutExpiryHandler_
  - _Depends: 4.1_
  - _Requirements: 5.2, 5.3, 5.4, 5.7_

- [x] 4.4 (P) Week決勝の勝利の結果通知への追記を作る
  - 先に、単体テスト(部品は偽物)で、Ultrasの免除の追記、受付中の決済期限(UTCの表記の受付期限)と対象年と決勝日と参加の導線の追記、プロダクトが見えないときの導線の省略、Week優勝でない勝利・敗北・期限後・資格を失った枠で追記しないこと、追記の長さの上限を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearEntrySupplementProvider_
  - _Depends: 4.1_
  - _Requirements: 14.6_

- [x] 4.5 eventの処理を束縛し、5つの登録口に加える
  - 4.1〜4.4の処理を処理単位で束縛するモジュールを作り、eventの束縛の一覧へ加える
  - マッチイベントの登録口に2件(Week 1700・Year 1710)、プロダクトのライフサイクルの登録口に2件(`deleted`・`purge_due`、1700)、ユーザーのライフサイクルの登録口に1件(`withdrawn`、1700)、Ultrasの知らせの登録口に2件(1700・1710)、結果通知の追記の登録口に1件(`week`、1700)を加える
  - 登録の前に、5つの登録口とtournament-weekの登録を名前で参照する上流のテスト(eventのUltras・notifications・payments・マッチ・プロダクト・identity・engagement・directory-discoveryのモジュールのWorkers統合テスト、登録口の単体テスト)を`git grep`で洗い出し、登録の一覧の完全一致を確かめるものを本specの登録を加えた形に書き換える(明示の横断)
  - 完了状態: eventのWorkers統合テストの全件(名前を参照せずに振る舞いで影響を受けるテストを含む)、各登録口の検証(名前・同じ種類での`order`の重複)の単体テストと書き換えた上流のテスト、eventの`queue`の経路で8つの処理の識別子が解決できる検査が成功する
  - _Depends: 4.2, 4.3, 4.4_
  - _Requirements: 3.1, 5.2, 6.1, 14.6, 15.2, 15.4_

- [ ] 5. APIサーバー
- [x] 5.1 apiの識別子、ジョブの失敗の通知のポート、2つのジョブ(23:45の夜の処理と夜の送り出しの準備の完了の通知、4:21の再処理)を作る
  - apiの全部品(ジョブ・失敗の通知・供給元・照会・決済の開始・決勝実施日)のDIの識別子をここで作る(束縛と登録は5.11)
  - apiのapplication層のポート(ジョブの失敗の通知と、5.6・5.7が使う決勝実施日の書き込み)をここで作る。ジョブの失敗は、そのポート(失敗した段・年・件数だけを持つ)越しに知らせ、Sentryを直接呼ばない(tournament-weekと同じ形)
  - 23:45の`tournament-year.evening-bracket`(1700)は毎晩、次に開催する年の行の用意とWeek優勝の取り込み→組み合わせ決定→進行(未処理の確定のマッチへの追いつき)→時計を読み直した時刻までのその夜の一括の発行→`EveningDispatchGate.markReady({ participant: 'tournament-year.evening-bracket', date: context.business.date, at: clock.now() })`の順に行う
  - 先に、単体テスト(部品と送り出しの入口とポートは偽物)で、5段の順序、組み合わせも進行も無い夜も`markReady`を最後に1回呼ぶこと、`date`がジョブの予定時刻の業務日付であること、一括の発行の時刻が進行の後に読み直した時刻であること、どの段が失敗しても残りの段を続けてポートへ知らせ`markReady`を呼ばずに例外になること、`markReady`の戻り値(`waiting`・`dispatch-requested`・`already-requested`)で処理が変わらないこと、`EveningDispatchError`が例外として伝わること、4:21の返金と知らせの再処理(10分以上前・100件)とその失敗の知らせを確かめる
  - Yearとブラケットの部品は`core/year-tournament`・`core/tournament`の契約と識別子で受け取る
  - 完了状態: 単体テストが成功し、静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 3.16_
  - _Requirements: 3.1, 6.8, 7.1, 8.2, 14.7, 15.3, 15.6, 15.7_

- [x] 5.2 (P) ジョブの失敗の通知のSentryの実装を作る
  - 先に、Workers統合テストで、夜の処理と再処理の失敗の知らせがログとエラートラッキング(`logentry`と`fingerprint`の規約)に識別と件数だけで出て、個人情報を含まないことを確かめる(tournament-weekの実装と同じ形)
  - 完了状態: Workers統合テストが成功する
  - _Boundary: YearTournamentIncidentReporter_
  - _Depends: 5.1_
  - _Requirements: 15.6, 15.7_

- [x] 5.3 (P) 再ローンチの禁止と編集の固定の2つの供給元を作る
  - 先に、単体テスト(ストアと照会は偽物)で、受付中の枠の決済期限の前後(解除の日時、年の行の保存した期限)、枠の作成前のWeek優勝の禁止、参加資格を得た枠・勝ち残りの枠・組み合わせ決定の途中の枠の禁止、期限切れ・喪失・除外・敗退・優勝で返さないこと、決勝日の変更後の解除の日時、勝ち残りと凍結後の固定、1回の呼び出しで読み取りが一括であることを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearRelaunchConditionSource、YearProductLockSource_
  - _Depends: 5.1_
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [x] 5.4 (P) ローンチの要約の供給元を作る
  - 先に、単体テスト(ストアと照会は偽物)で、要約の6つの文言(優勝・マッチ中・進出・敗退・参加決定・参加受付中)とrank(60〜100)、勝ち残りと敗退のラウンドをブラケットの参加者の状態とローンチの直近のYearのマッチから求めること、該当しない枠で返さないこと、受賞がプロダクトのIDと対象年の表記を持つこと、1回の呼び出しで読み取りが一括であることを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearLaunchSummarySource_
  - _Depends: 5.1_
  - _Requirements: 12.8_

- [x] 5.5 (P) トロフィーの供給元を作る
  - 先に、単体テスト(ストアは偽物)で、受賞ごとの対象年の表記・受賞日・ブラケットへのパスと、受賞の無いプロダクトの空を確かめる
  - 登録口(tournament-weekの所有)への追加と束縛は5.11で行う
  - 完了状態: 単体テストが成功する
  - _Boundary: YearTrophySource_
  - _Depends: 5.1_
  - _Requirements: 12.7_

- [x] 5.6 (P) 決勝実施日の照会と保存のユースケースを作る
  - 先に、単体テスト(年の照会・書き込み・監査は偽物)で、現在の年と翌年の表示(実効の日・出どころ・期限・変更の可否・候補・前年と翌年・注意)、照会の前の次に開催する年の行の用意、拒否の理由の返し方、監査ログの準備(操作種別・対象・詳細・任意の理由)、書き込みの`locked`と`version_conflict`の変換を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearFinalDateService_
  - _Depends: 5.1_
  - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7, 2.8, 2.12_

- [x] 5.7 決勝実施日の保存の書き込みを作る
  - 先に、ローカルD1のWorkers統合テストで、保存と期限の列の書き直しと監査ログの一体の確定、行の無い年の保存(行の用意を含む)、版の不一致・変更期限の決勝日の8日前の23:59は保存でき7日前の0:00は`locked`・凍結済みの`locked`で監査ログも残らないこと、保存の後に対象年の判定と期限が新しい列から求まることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 1.3, 2.7, 2.10, 2.11, 3.8, 16.3_

- [x] 5.8 トップページの区画の照会を作る
  - 先に、単体テスト(マッチの照会とブラケットのストアは偽物)で、その日のYearのマッチの年ごとの行・ラウンド名・実際の決勝日・決勝の判定、年の行の無いブラケットの除外、マッチが無い日の空、読み取りがマッチの数に比例しない回数であることを確かめる(マッチの表示のまとめた読み取りとD1での確認は5.12のリゾルバとそのWorkers統合テストで行う)
  - 完了状態: 単体テストが成功する
  - _Requirements: 10.1, 10.2, 10.5, 10.7, 15.8_

- [x] 5.9 ブラケットのページの照会を作る
  - tournament-weekの純粋な関数`buildBracketRoundsView`(DIに束縛しない)を直接呼び、優勝のプロダクトは優勝の参加者のプロダクトを表示できるプロダクトの照会から作る(tournament-weekの`WeekBracketReader`と同じ)
  - 先に、ローカルD1のWorkers統合テストで、記録済みのマッチと未来の枠・シードの番号・最初のマッチの予定が作られる前のシードの「シード<n>」(プロダクトを出さない)・優勝のプロダクト(表示できなければ無し)、受賞した年で優勝のプロダクトが非公開化・論理削除・投稿者の停止で表示できないときに優勝のプロダクトが無く受賞の結果(`outcome`の`awarded`)が残ること、終了した年で優勝の番号が無いときに優勝のプロダクトが無く年の状態が終了で受賞なしであること、4桁でない年・行の無い年・未決定の年の未定義、マッチの表示の読み取りが90件ずつまとめて行われることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6, 15.8_

- [x] 5.10 参加費の導線の照会と決済の開始を作る
  - 先に、単体テスト(部品は偽物)で、本人でないプロダクトと枠の無いプロダクトの`null`、直近のローンチの枠、終わっていない枠の対象年と終えた枠の年、免除の判定(Ultrasの出どころと受付中の期間内)、価格の取得の失敗での縮退、勝ち残り・敗退・優勝の進行(ブラケットの参加者の状態と、勝ち残りの記録でもローンチの直近のYearのマッチが終了し負けていれば敗退)、返金の対象(購入があり返金待ちか依頼済み)、決済の開始が購入種別`year_tournament_entry`とローンチのIDで決済の開始の部品を呼ぶことを確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 4.1, 4.10, 12.1, 12.2, 12.3, 12.5_

- [x] 5.11 apiの部品を束縛し、ジョブ・判定の供給元・トロフィーの供給元・夜の送り出しの前提の登録口に加える
  - 5.1〜5.10の部品を処理単位で束縛するモジュールを作り、apiの束縛の一覧へ加える
  - ジョブの集約点に2件(23:45の1700、4:21の1700)、判定の供給元の登録口に3件(1700)、トロフィーの供給元の登録口に1件(10)、夜の送り出しの前提の登録口(`EVENING_DISPATCH_PARTICIPANTS`)に`tournament-year.evening-bracket`の1行を加える
  - 登録の前に、4つの登録口とtournament-weekの登録を名前で参照する上流のテスト(夜の送り出しの前提の一覧の完全一致、判定の供給元・トロフィーの供給元の登録口の単体テスト、ジョブの一覧を確かめる`apps/api/test/config`の単体テスト、notifications・プロダクト・検索のモジュールのWorkers統合テストなど)を`git grep`で洗い出し、本specの登録を加えた形に書き換える(明示の横断)
  - 完了状態: apiのWorkers統合テストの全件(夜の送り出しの前提の数で振る舞いが変わる通知のジョブのテストを含む)、Cronの式の一致と同じ時刻の`order`の重複の検査、供給元の名前の検証、夜の送り出しの前提の名前の検証(`assertEveningDispatchParticipants`)と書き換えた上流のテスト、apiの`fetch`と`scheduled`の経路で全識別子が解決できる検査が成功する
  - _Depends: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_
  - _Requirements: 12.7, 12.8, 13.1, 13.5, 14.7, 15.2, 15.3_

- [x] 5.12 GraphQLのスキーマモジュールの照会(トップページ・ブラケット)を作り、スキーマの集約点に加える
  - ルート型は`extend`を使わず`type Query { ... }`・`type Mutation { ... }`で書く(api-gatewayのスキーマモジュールの規約)
  - 先に、Workers統合テストで、トップページの区画のマッチの表示のまとめた読み取り、対戦カードと不戦勝の分け方(match-engineの不戦勝の分類を使い、開始時点の相手の不戦敗を不戦勝に含め両者の不戦敗を描かない)とブラケットへのパス、ブラケットの非公開のプロダクトの表示と優勝のプロダクトと未決定の`null`、`YearTournamentSummary.awarded`(受賞は真・受賞なしは偽・終了前はnull、優勝のプロダクトが表示できない年は`champion`がnullで`awarded`が真。tournament-weekの`WeekTournamentSummary.awarded`と同じ規則)、tournament-weekの`BracketRound`の型を参照して再定義せず、`rounds`には`buildBracketRoundsView`の結果の`rounds`を、`participantCount`・`seedCount`には同じ結果の値をそのまま返してtournament-weekのリゾルバで解決されること、入力の形式違反が`validation_error`になることを確かめる
  - 完了状態: Workers統合テストが成功し、スキーマの集約点の検証を通り、apiのスキーマの生成(6.1のclientの型の生成が読む)が成功する
  - _Depends: 5.11_
  - _Requirements: 10.1, 10.2, 10.4, 11.3, 11.4, 11.6, 15.8_

- [x] 5.13 GraphQLの参加費の導線と決済の開始の操作を加える
  - ルート型は`extend`を使わず`type Query { ... }`・`type Mutation { ... }`で書く(5.12と同じapi-gatewayの規約)
  - 決済の開始の拒否の文言は3.7の購入の可否の口の文言の一覧から読み込む(唯一の出どころ)
  - 先に、Workers統合テストで、未ログインの拒否、本人だけの参加費の導線と返金の対象の表示、決済の開始の成功と5つの`year_entry_*`のエラー(文言が購入の可否の口と一致)、受付期限22:59の開始は受け付け23:00は`checkout_closed`になること(paymentsの`CheckoutStarter`の経路、Stripeは模擬応答)、`payments_unavailable`の伝わり方を確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 4.1, 4.2, 4.4, 12.1, 12.5, 16.3_

- [x] 5.14 GraphQLの決勝実施日の照会と保存の操作を加える
  - ルート型は`extend`を使わず`type Query { ... }`・`type Mutation { ... }`で書く(5.12と同じapi-gatewayの規約)
  - 先に、Workers統合テストで、未ログインと管理者でない呼び出し元の拒否、`viewer`の照会と`moderator`の保存の拒否、最上位管理者の保存と監査ログ、拒否の理由ごとの`validation_error`、理由の500書記素の超過、`final_date_locked`と`version_conflict`、変更者のニックネーム(削除済みは無し)を確かめる
  - 完了状態: Workers統合テストが成功し、apiのスキーマの生成(7.1のadminの型の生成が読む)が成功する
  - _Requirements: 2.1, 2.7, 2.8, 2.9, 2.10, 2.11_

- [ ] 6. 利用者側の画面
- [x] 6.1 本specの利用者側のGraphQLの操作・フラグメント・取得の補助を加え、型を生成して許可リストを再生成する
  - トップページの区画・ブラケット・参加費の導線の照会と決済の開始の操作を、clientの`src/graphql/operations/year-tournament/`に1ファイル1操作の`.graphql`で書く。操作名は`Client`で始め(`ClientYearTournamentBoard`・`ClientYearBracket`・`ClientMyYearEntry`・`ClientStartYearTournamentCheckout`)、`graphql()`を呼ばない
  - トップページの行のフラグメント`YearBoardRoundFields`を`src/graphql/fragments/year-tournament/`に置く(共用の部品が依存する決勝の印・対戦カード・不戦勝はWeekと同じ選択)。`ClientYearBracket`はtournament-weekのフラグメント`BracketRoundFields`(`rounds`)と`BracketMatchProductFields`(`champion`)を名前で展開し、`tournament`の`awarded`・`status`・`year`・`finalDate`と`participantCount`・`seedCount`を取得し、フラグメントを再定義しない
  - 取得と変更の補助(4つの照会と変更の`queryOptions`・`mutationOptions`)を、tournament-weekの補助と同じ形で作る
  - frontend-platformの「操作の追加手順」どおり、clientで`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行する。画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`と生成された型を読み、`gql.ts`・`index.ts`を読まない
  - 先に、取得の補助の単体テストで、照会のキーと変数・閲覧者の受け渡しを確かめる
  - 完了状態: 単体テスト、型の生成と許可リストの再生成が成功し、clientとapiの`graphql:check`とclientの`codegen.unit.test.ts`(操作名の接頭辞・1ファイル1操作)が通り、clientの型検査が通る
  - _Depends: 5.12, 5.13_
  - _Requirements: 10.1, 11.1, 12.1_

- [x] 6.2 トップページのYearトーナメントの区画を作り、区画の登録口に加える
  - 6.1の生成物を使うため(P)にしない
  - 1.5の共用の部品へ、Yearの照会・行・差し替え・見出しの値・文言(「Product of the Yearトーナメント」)を渡す包みとして作る。不戦勝の一覧の文言はmatch-engineの`ByeCard`が提供するため実装しない
  - Yearのトップページ・決勝・ブラケットの文言(1.5の3つの型の値)と、6.2〜6.4のブラウザテストが使うYearのフィクスチャ(盤面・決勝・ブラケット)を、ここでまとめて作る。6.3・6.4はこれらのファイルを変えない
  - 共用のトップページの区画と決勝の部品のテストに、Yearの文言の例を加える
  - 先に、ブラウザテストで、見出し(「Product of the Yearトーナメント」・対象年・ラウンド名・決勝日・ブラケットへの通常のリンク)、対戦カードと`rel="noopener"`、不戦勝の一覧と早期勝利のUpvote数、マッチが無い日の非表示、取得の失敗の区画だけの縮退、自動更新の切り替えに従う取り直し、アクセシビリティの検査の違反が0件を確かめる
  - 登録口に`main` 10を加え、Week(20)・予選(30)より上に描かれることを、実際の登録を確かめる登録箇所のブラウザテスト(`top-page-sections.browser.test.ts`)で確かめる。登録の前に、トップページの区画の登録口を参照する上流のテストを検索で洗い出し、登録の一覧を完全一致で確かめるものを本specの登録を期待する形に書き換える(明示の横断)
  - 完了状態: ブラウザテスト(Yearの例を加えた共用の部品のテストを含む)と並びの単体テストと書き換えた上流のテストが成功する
  - _Depends: 1.5_
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8_

- [x] 6.3 トップページのYearの決勝の演出の区画を作り、区画の登録口に加える
  - 6.2と同じ登録箇所へ追記するため(P)にしない
  - 本文の区画と同じ盤面を購読し、1.5の共用の決勝の部品へ6.2で作ったYearの文言を渡す。Yearの文言とフィクスチャのファイルは変えない
  - 先に、ブラウザテストで、決勝の全幅の表示、確定の後の受賞と受賞なしのYearの文言、視差効果を減らす設定で演出を止めること、アクセシビリティの検査の違反が0件を確かめる
  - 登録口に`showcase` 10を加える(並びの単体テスト`top-page-section-order.unit.test.ts`の`showcase`の期待は上流が先に用意している)。登録箇所のテスト(`top-page-sections.browser.test.ts`)の完全一致と位置の検査を、`tournament-year.final`を加えた形に書き換える(明示の横断)
  - 完了状態: ブラウザテストと並びの単体テストと書き換えた上流のテストが成功する
  - _Requirements: 10.5_

- [x] 6.4 (P) Yearのブラケットのページを作る
  - 経路の`loader`・`head`(ページのheadの組み立てへの追記)・失敗と404の部品・経路の年ごとの作り直しを、tournament-weekの`/tournaments/week/$week`と同じ形で作り、本体は1.6の共用のページへYearの題名・参加数とシード数の表記・`BracketViewProps`(`awarded`は`yearBracket.tournament.awarded`(nullは偽)、`finished`は年の状態が終了か)を渡す
  - 共用のブラケットのページの部品のテストに、Yearの文言の例を加える
  - 先に、ブラウザテストで、見出し(対象年・決勝日・参加数とシード数)、共用の4部品への`BracketViewProps`の受け渡し(進行中・受賞・受賞なし、受賞したプロダクトが表示できない年で`champion`がnullかつ`awarded`が真になり「非公開のプロダクト」の受賞として描かれること、終了前の`awarded`のnullを偽として渡すこと)、開催中だけ自動更新がオンの間に取り直すこと、キーボードで全マッチをたどれること(列とタブの両方)、画面幅767pxと768pxでの表示の切り替え、4桁でない年と未決定の年の404、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功し、`/tournaments/year/<年>`をローカルで開ける
  - _Boundary: YearBracketPage_
  - _Depends: 1.6, 6.2_
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 6.5 (P) 参加費の導線を作る
  - Yearの照会の値を共用の入力へ写す関数(Ultrasの案内は偽・決済の開始を阻む理由は無し・返金の対象はサーバーの値・除外の理由は閉じた理由から)と、Yearの文言・秒読みを添えない指定・決済の開始の変更を1.7の共用の導線へ渡す部品を作る。Yearの参加費の導線の文言は本タスクで作り、6.2で作ったYearの文言(トップページ・決勝・ブラケット)とフィクスチャのファイルは変えない(導線の値は本タスクの別のフィクスチャのファイルに置く)
  - 共用の参加費の導線のモデルと部品のテストに、返金の対象がサーバーの値の例・上限による除外・秒読みを添えない例を加える
  - 先に、写しの関数の単体テストで全ての状態・理由・返金の対象・進行の組み合わせを確かめ、ブラウザテストで、受付中のボタン・参加費・期限(受付期限23:00の日時・相対表現、秒読みが無いこと)・対象年と決勝日とWeek優勝の週、押下で決済画面へ進むこと、免除の表示、価格の取得の失敗と決済サービスの障害の無効化と案内、押下の後の`checkout_closed`・`year_entry_*`のエラーの文言の表示、参加資格・組み合わせ・敗退・優勝・資格の喪失・期限切れ・除外(停止と上限の2つの理由)の状態と返金の旨、区画の取得の失敗の縮退、アクセシビリティの検査の違反が0件を確かめる
  - 登録箇所のファイルは変えない(6.6で登録する)
  - 完了状態: 単体テストとブラウザテストが成功する
  - _Boundary: YearEntryPanel、YearEntryView_
  - _Depends: 1.7, 6.2_
  - _Requirements: 4.2, 4.10, 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 6.6 参加費の導線をプロダクト詳細と自分のプロダクトの画面へ、削除の注意書きを削除の確認へ登録する
  - 投稿者本人向けの操作と自分のプロダクトの画面の2つの包みと、削除の注意書きの部品を作る
  - 先に、ブラウザテストで、2つの包みが本体を描くこと、削除の注意書きが受付中と参加資格の枠のときだけ出ることを確かめる
  - 投稿者本人向けの操作の登録口(20)・自分のプロダクトの画面の登録口(20)・削除の注意書きの登録口(20)に加える。登録の前に、3つの登録口を参照する上流のテスト(プロダクト詳細と自分のプロダクトの区画の並び・登録口のブラウザテスト)を検索で洗い出し、登録の一覧を完全一致で確かめるものを本specの登録を期待する形に書き換える(明示の横断)
  - 完了状態: ブラウザテストと書き換えた上流のテストが成功する
  - _Depends: 6.5_
  - _Requirements: 12.1, 12.6_

- [ ] 7. 管理画面
- [x] 7.1 本specの管理画面のGraphQLの操作を加え、型を生成して許可リストを再生成する
  - 決勝実施日の照会と保存の操作を、adminの`src/graphql/operations/year-tournament/`(G9)に1ファイル1操作の`.graphql`で書く。操作名は`Admin`で始め(`AdminYearFinalDateSettings`・`AdminUpdateYearFinalDate`)、`graphql()`を呼ばない
  - frontend-platformの「操作の追加手順」どおり、adminで`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行する。画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`と生成された型を読み、`gql.ts`・`index.ts`を読まない
  - 完了状態: 型の生成と許可リストの再生成が成功し、adminとapiの`graphql:check`とadminの`codegen.unit.test.ts`(操作名の接頭辞)が通り、adminの型検査が通る
  - _Depends: 5.14_
  - _Requirements: 2.1_

- [x] 7.2 業務日付と拒否の理由の表記、年ごとのカードを作る
  - 7.1の生成物を使うため(P)にしない。部品はadminの`components/year-tournament/`に置く(G9)
  - 先に、表記の単体テストで、業務日付の曜日つきの表記(年またぎ)と拒否の理由ごとの文言と区画の題名を確かめる
  - 先に、ブラウザテストで、実効の決勝日の`<time datetime>`と出どころのバッジ・期限の表示・最後に変更した日時と管理者、最上位管理者でない場合と変更期限を過ぎた場合の参照だけの表示と理由、翌年の注意、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: 単体テストとブラウザテストが成功する
  - _Requirements: 2.1, 2.3, 2.12_

- [x] 7.3 決勝実施日の選択と保存のフォームを作る
  - 先に、ブラウザテストで、候補の`<select>`(ラベル・既定の選択・候補が無いときの案内)、任意の理由の上限と注記、確認のダイアログの文(変更後の受付期限・組み合わせ決定・対象期間の変化)、保存の成功の通知、保存の失敗でダイアログが理由の入力を保ったまま`failureMessageOf`の文言を`role="alert"`で示すこと(拒否の理由・`final_date_locked`・`version_conflict`の案内と、それ以外の失敗で`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`の文言が出て問い合わせを促す文が出ないこと)、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Requirements: 2.2, 2.11, 2.13_

- [x] 7.4 決勝実施日の区画を作り、設定ページの区画の登録口に見出しと同じ`title`で加える
  - 先に、ブラウザテストで、見出しと説明と2年分のカードの表示、取得の失敗の縮退(`ErrorState`に`contactHref`を渡さず、問い合わせのボタンと問い合わせを促す文が出ず、文言は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`)、設定ページの区画の並び(本specの10が機能フラグの20より上)を確かめる
  - 登録口に`tournament-year.final-date`(10)を、7.2の表記のファイルの題名の定数で加える。登録の前に、設定ページの区画の登録口を参照する上流のテストを検索で洗い出し、登録の一覧を完全一致で確かめるものを書き換える
  - 完了状態: ブラウザテストと書き換えた上流のテストが成功し、ローカルで最上位管理者が決勝実施日を保存すると監査ログの画面に記録が出る
  - _Requirements: 2.1_

- [ ] 8. 統合・ドキュメント・E2E
- [x] 8.1 組み合わせ決定の日の時刻の連鎖の統合テストを作る
  - apiのWorkers統合テストの環境で行い、eventの確定のマッチイベントの処理の代わりに、それが呼ぶbackend-libの`YearProgressionService`・`YearEntryRegistrar`を直接呼ぶ(`apps/event`を読み込まない)
  - 先に、Workers統合テストで、23:35の決済期限・23:40の突合と確定・23:45のWeekの組み合わせと進行・Yearの夜の処理の順(paymentsの10、match-engineの1100、notificationsの1300、tournament-weekの`tournament-week.evening-bracket`の1500、本specの1700)で、突合で反映された決済が組み合わせに入り、反映の期限(23:45)の後の完了が組み合わせに入らないこと、同じ夜のWeek優勝が翌年の対象になること、1回戦の予告と準決勝以前の結果と翌日の予告が本specの`markReady`より前に発行されていること、Yearのジョブの`markReady`の後に夜の枠の送り出しが依頼され(tournament-weekも呼んだ場合)、Yearのジョブを失敗させた夜は`markReady`が無く23:55の期限まで依頼されないことを、notificationsの`EveningDispatchGate`の実装で確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 5.11_
  - _Requirements: 4.9, 7.2, 14.3, 14.7, 15.3, 16.3_

- [x] 8.2 技術ドキュメントとオンボーディングを書く
  - `backend/019-anchor-date-schedules.md`を本プロジェクト固有の値を含めずに新しく書き、`backend/README.md`の文書一覧に加える
  - `frontend/012-business-date-calendar.md`に「サーバーが返す候補から選ばせる日付」の節を加え(G7)、`frontend/README.md`の`012`の行の説明を改める
  - 共用へ移した部品の名前と置き場所の記述を、`backend/016`・`backend/017`・`frontend/013`・`frontend/016`で改める(プレースホルダーの値は変えない)
  - `docs/onboardings/project-values.md`にジョブ・処理・登録の名前と`order`、価格の`lookup_key`、メール種別、返金の依頼キーの形、監査ログの操作種別を加える。`CLAUDE.md`の「技術規則の参照先」に`backend/019`の行を加え、`frontend/012`の行の見出しに候補から選ばせる日付を含める(編集が拒否された場合は、開発者が手で行えるよう報告する)
  - 完了状態: 文書が整形の検査を通り、技術ドキュメントに本プロジェクト名と固有の値が無いことと、共用へ移した部品と1.1で削った関数(`backend/017`のラウンドの実施日の節の翌日の関数を含む)の旧い名前が`docs/`に残っていないことを検索で確かめる
  - _Depends: 1.3, 1.4, 1.7_
  - _Requirements: 16.5, 16.6_

- [x] 8.3 E2Eの補助を作る
  - admin-foundationの`executeLocalD1`(文字列は`sqlStringLiteral`)で次の補助を作り、流すSQLの組み立てを単体テスト付きの別のファイルに分ける(tournament-weekの補助と同じ形)
  - (a)確認済みで可視の利用者2人・可視のプロダクト2つ・予選で勝利したローンチ2つと、他のE2Eと重ならない過去の対象年(既存の`year < 2026`の最大+1、無ければ1001)の年の行(受付期限・決済期限・組み合わせ決定の列は現在より十分に未来、決済期限日は対象年の12月31日)と、その年のWeek優勝の枠2件(1件は受付中、1件はUltrasで参加資格)を作る。(b)年の行の3つの期限の列を現在より過去へ移す。(c)組み合わせで予定された決勝の実施日を今日に、開始の日時を過去・終了の日時を未来に移し、開始を記録済みにする。(d)決勝の終了の日時を過去へ移す。ジョブはbackend-platformの共用の補助`triggerScheduled({ worker: 'api', businessDate, businessTime })`に当日の業務日付と`23:40`・`23:45`を渡して動かし(ローカルの定期実行の起動を独自に作らない)、確定のイベントは実際の経路で届ける
  - 先に、SQLの組み立ての単体テストで、生成されるSQLと値のエスケープを確かめる
  - 完了状態: 単体テストが成功し、補助の関数を順に呼ぶ空のE2Eが成功し、ローカルD1に枠・組み合わせ・開始済みの決勝ができる
  - _Depends: 5.11_
  - _Requirements: 16.4_

- [x] 8.4 参加費・組み合わせ・受賞のE2Eシナリオを作る
  - 画面の操作は手順のファイル(`year-tournament-steps.ts`)に置く
  - 順序: 受付中の枠の投稿者がプロダクト詳細ページから参加費をテストカードで支払う(paymentsのE2Eと同じく`stripe listen`の転送が要る)→参加資格を得た表示を待つ→補助(b)で期限を過去へ移す→23:40・23:45のジョブ(8.3のとおり`triggerScheduled`で起動)で組み合わせ(参加2で決勝だけ)→ブラケットのページに組み合わせが出ることを確かめる→補助(c)で決勝を今日の開始済みにする→トップページのYearの決勝の区画にマッチが出ることを確かめる→補助(d)で終了を過去へ移す→23:40・23:45のジョブで確定と進行→プロダクト詳細ページのトロフィーにProduct of the Yearが出ることを確かめる
  - 1.1で報告した価格の作成が済んでいなければ、本タスクを保留して開発者へ報告する
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 6.3, 6.4, 6.6, 8.3_
  - _Requirements: 16.4_

- [x] 8.5 管理画面の決勝実施日のE2Eシナリオを作る
  - 画面の操作は手順のファイル(`year-final-date-steps.ts`)に置く
  - admin-foundationの`signInAsNewAdmin`で最上位管理者としてログインし、設定ページの翌年のカードで現在と違う候補を選び、確認して保存し、保存の通知と監査ログの画面の「Yearトーナメント決勝実施日の変更」を確かめる。`viewer`のロールの管理者では参照だけであることを確かめる
  - 翌年の行だけを変え、8.3の補助が作る過去の対象年と重ならないため、プロジェクトの依存による直列化は要らない
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 7.4_
  - _Requirements: 2.10, 16.4_

- [x] 8.6 全体の検査とカバレッジを確かめる
  - 整形・静的解析・型検査・4種のテストを全アプリで実行し、本specが変更したファイル(共用へ移した部品と書き換えた上流のファイルを含む)のカバレッジが80%以上であることを確かめる
  - 完了状態: 一括の検査と全テストが成功し、カバレッジの閾値を満たす
  - _Requirements: 16.1_

## Implementation Notes

- 開発者への依頼(1.1): Stripeの価格`year_tournament_entry`は開発者が2026-11-17に作成・税込化済みのため、新たな依頼は無い。
- 1.1: `core/time/business-time.ts`に`addBusinessDays(date, days)`(負は過去)と`businessWeekdayOf(date): IsoWeekday`(月1〜日7)を公開した。`round-schedule.ts`の公開の`nextBusinessDate`は削除した(テストの3例は`business-time.unit.test.ts`へ移した)。docsの旧い名前(`backend/017`の178行目・`project-values.md`の1244行目)は8.2で直す。`week-schedule.ts`の`assertWeekStart`・`isSundayLaunch`は`businessWeekOf`のまま(計算を変えないため)。`days`が`NaN`のときは`RangeError`でなく`"NaN-NaN-NaN"`を返す(呼び出し元は整数の定数だけ)。
- 1.2: 名指しの5ファイルに加え、完了状態(`apps/`に独自の業務日付の加算が無い)とCLAUDE.mdの水平展開により、notificationsの`previousBusinessDate`(`notification-jobs.ts`・`core/notifications/notification-slots.ts`)・engagementの`comment-anonymization-job.ts`・identityの`purge-orchestrator-job.ts`・`core/product/launch-status.ts`・`workers/match/d1-match-directory.ts`も`addBusinessDays`へ寄せた(計算結果は同じ)。`launch-date-rules.unit.test.ts`の`addBusinessDays`の12例は共通の部品のテストと重複するため削除した。対象外として残したもの: 時点を返す`core/ultras/entitlement-rules.ts`の`endOfBusinessDayContaining`(ultras-subscriptionの境界)、時点の加算の`qualifier-board-reader.ts`・`suppression-maintenance.ts`、clientとcommon-libの共用部品。
- 1.3: 並びは`core/tournament/launch-ordering.ts`(`LaunchOrderingKey`・`launchSeedOrder`・`launchNonSeedOrder`)、拒否の写像は`core/tournament/refund-rejection.ts`(`RefundRejectionCode`・`RefundRejectionOutcome`・`refundRejectionOutcome`)。Weekの`week-entry-follow-up.ts`の`RefundRejectionCause`(`RefundRejectionCode | 'invalid_reason'`)と`INVALID_REASON_OUTCOME`はWeekの非公開のままのため、Yearの返金の後処理(3.11)は理由の形式違反(`RangeError`)の扱いを同じ形で自前に持つ。
- 1.4: 共用の部品は`core/notifications/violation-tolerant-publish.ts`の`publishExcludingViolations({ publisher, name, events, at, logger })`(入力の型`ViolationTolerantPublishInput`も公開)。50件の分割は関数の中で行うので、Yearの通知の発行(3.9)は全件を1回で渡し、`name: 'tournament-year'`と自分のロガーを渡す。Weekの`publishAll`は共用の関数を呼ぶ薄い非公開の包みとして残した。
- 1.5: 共用の部品は`apps/client/src/components/tournament/`(`tournament-copy.ts`に4つの文言の型と種類によらない文言、`tournament-board-model.ts`・`tournament-final-model.ts`・`use-tournament-board.ts`・`tournament-board-round.tsx`・`tournament-section-heading.tsx`・`tournament-match-card.tsx`・`tournament-final-round.tsx`・`tournament-final-showcase.css`・`tournament-bracket-link.tsx`、テストの値`tournament-board-fixtures.ts`(設計のFile Structure Planに無い))。Weekの文言の値は`WEEK_BOARD_COPY`・`WEEK_FINAL_COPY`・`WEEK_BRACKET_COPY`(`week-tournament-messages.ts`)と`WEEK_ENTRY_COPY`(`week-entry-messages.ts`)。設計の契約との差: `useTournamentBoard`は`board`でなく`clientViewer`を受け、`queryOptions`はメモ化・`roundsOf`と`withUpdatedMatch`は部品の外の定数か`useCallback`で渡す(6.2で守る)。見出しはrender prop`(headingId) => ReactNode`。文言の型に`TournamentBracketCopy.title`・`awardName`、`TournamentEntryCopy.title`を足し、返金の文を`forfeitedRefundSuffix`・`excludedRefundSuffix`に分け、`checkoutRejectionMessageOf`は採らない(拒否は`checkout_closed`なら`closedMessage`、他は`errorMessageOf`。Yearの`year_entry_*`はサーバーの文言を出す。1.7で共用の決済の開始に置く)。決済期限のラベルは種類によらない「決済期限」(設計のYearの文の「参加費の決済期限」とは違う。6.5で確かめる)。CSSの名前を`data-tournament-final-*`・keyframes`tournament-final-*`へ改めたため、`week-final-showcase.browser.test.tsx`の識別子の5行を書き換えた(確かめる振る舞いは不変だが「期待値を変えずに」とは文字どおりには食い違う)。
- 1.6: 共用は`components/tournament/`の`tournament-bracket-model.ts`(`TournamentBracketView`・`TournamentBracketPageView`、`bracketViewPropsOf`・`isTournamentBracketLive(bracket)`・`tournamentBracketRefetchIntervalOf(bracket, autoRefresh)`。後の2つは照会の結果でなくブラケットの値(Yearは`query.state.data?.yearBracket`)を受ける)、`tournament-bracket-page.tsx`(`TournamentBracketPage({ copy, periodLabel, bracket, autoRefresh, onAutoRefreshChange })`)、`tournament-bracket-error.tsx`(`TournamentBracketError({ copy })`)、テストの値`tournament-bracket-fixtures.ts`。Weekの失敗の包みは経路のファイルの中の非公開の関数(`week-bracket-error.tsx`は削除)。`week-bracket-model.ts`は既存のWeekのテストのため型`WeekBracketView`だけを残した。6.4への申し送り: 共用のページの見出しは`periodLabel`の文字列1つしか受けないため、Yearの見出しで決勝日を`<time datetime>`で示すなら共用のページに任意の受け口を足す(Weekの表示を変えないこと)。`TournamentBracketCopy.pageTitle`は共用の部品から未使用(headは経路で組み立てる)。
- 1.7: 共用は`components/tournament/`の`tournament-entry-model.ts`(`TournamentEntryInput`・`tournamentEntryDisplayOf`・`tournamentEntryBoundariesOf(entry, countdown)`・`hasEntryCountdown`)、`tournament-entry-panel-body.tsx`(`TournamentEntryPanelBody({ entry, copy, countdown, autoRefresh, checkout, onBoundaryReached, onAutoUpdatingChange? })`)、`tournament-entry-checkout.tsx`(`checkout`は`{ mutationOptions, purchaseIdOf }`でジェネリック)、`entry-deadline.tsx`(`countdown`)、テストの値`tournament-entry-fixtures.ts`。Weekは`week-entry-view.ts`の`weekEntryInputOf`(返金の対象は`!exempt`)と包み。`countdown: false`は秒読み・警告の強調・48時間前の取り直し・自動更新中の報告を止め、日時と相対表現と受付期限での取り直しを残す。6.5への申し送り: (a)`EXCLUDED`で`excludedReason`がnullなら`'hidden_or_suspended'`に倒れるため、Yearの写しの関数で上限による除外(`capacity_exceeded`)を必ず写し単体テストで確かめる、(b)共用の本体にYearの対象年・決勝日・Week優勝の週を示す受け口が無いため、Weekの表示を変えない任意の受け口を足す、(c)導線の中のブラケットへのリンクは共用の`TournamentBracketLink`でなく本体の中の小さいリンク。
- 1.8: テーブルは`apps/db/schema/tournament/`の`yearTournaments`(`year_tournaments`)・`yearTournamentEntries`(`year_tournament_entries`)、マイグレーションは`20261117155516_tournament_year`(ローカルに適用済み)。D1での確認は`apps/db/tournament-year-schema.worker.test.ts`(apiの`bun run test:worker -- db/`)。枠の挿入の重複の無視は一意索引`year_tournament_entries_week_tournament_id_unique`。`year_tournament_entries`は`launch_id`・`product_id`・`owner_user_id`が`product_launches`・`products`・`users`への外部キー(ON DELETE無し)のため、物理削除の紐付けの解除(3.4)は`owner_user_id`も必ずnullにする。退会では枠を消さない(喪失)ため、利用者の物理削除の前に`owner_user_id`がnullになる経路(プロダクトが物理削除されない枠を含む)を3.4・4.2で確かめる。`champion_entry_id`・`week_tournament_id`・`purchase_id`・`final_date_updated_by_admin_id`には外部キーが無い。既定値は`final_date_version`(0)・`refund_status`・`refund_notice_status`('none')だけ。`project-values.md`へのテーブルの追記は8.2。
- 1.9: 操作種別は`apps/common-lib/admin/audit-actions/tournament-year.ts`の`YEAR_FINAL_DATE_UPDATE_ACTION`(`year-final-date.update`)と`TOURNAMENT_YEAR_AUDIT_ACTIONS`。対象のIDは`year-final-date:<年>`、`fromSource`は`explicit`・`default`だけ(記録の検証は100書記素以内の文字列しか見ないため、5.6・5.7の側で値を守る)。common-libのテストはapiの`test:unit`の対象外のため、apiから`bun test common-lib/...`で実行する。
- 1.10: 6・7・3.7・3.10・5.xの文言は`docs/GUIDES/service/design/003-text-and-copy-rules.md`を正とする(エラー・状態・Week決勝の結果通知への追記・トップページとブラケット・管理画面・最終確認画面の表示事項・返金の知らせのメール)。決めた点: 決勝の区画の印は「Year Final」、喪失と返金の文は設計のSupporting Referencesどおり(Weekと文が違う)、導線の受付中の項目名は共用の「決済期限」、決勝日の表記は「2027年5月30日(日)」、Yearの導線はプロダクトを表示できない間もボタンを無効にしない(押下の後に拒否の文)。決済実装方針(`features/004-payments.md`)の購入種別の表のYearの行に受付期限・反映の期限・返金の依頼キー等を補った。法的通知の大枠の返金ポリシーは一致しており変更なし。3.13への申し送り: 組み合わせ決定の分類の順序は、Yearトーナメント規則(設計の状態遷移図に合わせ、受付中の枠をまず参加資格か期限切れに分け、参加資格の枠だけを喪失・除外にする)に合わせる。範囲外で気づいた相違(変えていない): `legal/001-compliance-policy.md`の注3とページ配置のYearの導線の「最長63週」は仮8と初年度で厳密でない、ページ配置の管理者側ページ一覧の「8項目は実装済み」に実装済みの「設定」が無い。
- 2.1: `core/year-tournament/year-schedule.ts`に`YEAR_ENTRY_PRICE_LOOKUP_KEY`・`YEAR_MAX_PARTICIPANTS`(64)・`FINAL_DATE_MIN_LEAD_DAYS`(8)・`FINAL_DATE_MAX_GAP_DAYS`(448)・`YearSchedule`(`year`・`finalDate`・`deadlineDate`・`acceptUntil`・`deadlineAt`・`drawAt`・`changeLockAt`、凍結)・`defaultFinalDate(year)`・`yearScheduleFor(year, finalDate)`・`yearFirstRoundDate(finalDate, participantCount)`(1以下は`null`、`bracketShape`のラウンド数−1日前)。例外はすべて`RangeError`(`yearScheduleFor`は日曜日でない・対象年の外の決勝日で投げるため、選択の検証は先に`FinalDateChoice`で行う)。組み合わせ決定が遅れたときの1回戦の日の繰り下げは呼び出し元が`dailyRoundPolicy`で行う(Weekと同じ)。
- 2.2: `core/year-tournament/final-date-choice.ts`に`FinalDateViolation`(6つの理由と`locked`)・`FinalDateContext`(`year`・`now`・`current: YearSchedule`(変更前の実効の日程)・`drawStarted`・`previousFinalDate`(前年を設定済みと扱う場合だけ、それ以外は`null`)・`nextExplicitFinalDate`(翌年を明示的に設定した場合だけ))・`NextYearGapWarningInput`・`editableYears(now)`・`isFinalDateChangeable(context)`・`checkFinalDateChoice(date, context)`・`finalDateChoices(context)`・`nextYearGapWarning({ finalDate, nextYearDefault })`(翌年が未設定のときだけ既定の日を渡す)。`locked`はAPIでは`final_date_locked`(5.6で変換、他の6つは`validation_error`の理由)。
- 2.3: `core/year-tournament/year-target-rules.ts`に`YearState`(`planned`・`open`・`frozen`・`not_held`)・`YearCalendarYear`(`year`・`schedule`・`source`・`state`)・`TargetYearResolution`(`{kind:'open', year}`か`{kind:'late', year:number}`)・`resolveTargetYear(awardedDate, lookup)`(`lookup`は同期の関数。Week優勝の日の年〜3年後を3.5で先に読んでおく)・`isPreviousYearSet(previous)`(not_held以外で真)。`not_held`の判定(行が無く組み合わせ決定の時刻を過ぎた年)は`lookup`を作る側(3.5の`YearCalendar.describe`)の責務。2.2の`previousFinalDate`は`isPreviousYearSet(prev) ? prev.schedule.finalDate : null`。設計に無い決定: 4年のどれも対象にならなければ`RangeError`(通常のデータでは起きない。2.1・2.2の例外の形に合わせた)。
- 2.4: `core/year-tournament/year-capacity.ts`に`CapacityCandidate`(`ref`・`awardedAt`・`tieBreaker`)・`CapacitySelection<T>`(`kept`・`overflow`、新しい順)・`selectWithinCapacity(entries, max)`(同時刻は`tieBreaker`の昇順、次に`ref`の昇順、`max`が0以上の整数でなければ`RangeError`)。組み合わせの規則は`core/tournament`(`drawBracket`・`bracketLayout`・`dailyRoundPolicy`)にあり`core/week-tournament`ではない。3.13への申し送り: `drawn`の枠を`{ ref: 枠のID, awardedAt: Week優勝の日時, tieBreaker }`に写して`selectWithinCapacity(entries, YEAR_MAX_PARTICIPANTS)`を呼び、`overflow`を`excluded`(`over_capacity`)にする。`tieBreaker`(設計に無い)は3.13で決める。業務時刻はJSTではないため、テストの日時の期待値は`fromBusinessDateTime`で作る。レビューで、同時刻のテストが`tieBreaker`と`ref`の順を逆向きにしないと比較の取り違えを検出できないと指摘され、直した(1回差し戻し)。
- 2.5: `core/year-tournament/year-entry-rules.ts`に値の一覧`YEAR_ENTRY_STATUSES`・`YEAR_ENTRY_CLOSE_REASONS`・`YEAR_ENTITLEMENT_SOURCES`・`YEAR_REFUND_STATUSES`・`YEAR_REFUND_NOTICE_STATUSES`・`OPEN_ENTRY_STATUSES`(`awaiting_payment`・`entitled`)・`GRANTABLE_STATUSES`(`awaiting_payment`、設計に無い追加でWeekと同名。付与の書き込みの条件)・`YEAR_REFUND_REASONS`と型(`YearRefundNoticeStatus`を含む)、`refundReasonFor(status, closeReason)`・`yearRefundRequestKey(purchaseId, reason)`。DBの列の値との一致は`workers/year-tournament/year-entry-columns.unit.test.ts`(設計のFile Structure Planに無い)。`refundReasonFor`は不正な状態と理由の組み合わせを検査せず(`excluded`は`over_capacity`以外を停止、`forfeited`は常に喪失)、テーブルにも状態と理由を結ぶCHECKが無いため、3.3・3.11・3.13のテストで喪失は`deleted`・`withdrawn`、除外は`hidden_or_suspended`・`over_capacity`の組み合わせだけを書くことを確かめる。Weekの`ultrasExemptionPeriodOf`相当は作っていない(設計は`wasEntitledDuring(投稿者, awardedAt, min(now, deadlineAt))`を直接呼ぶ)。
- 3.1: 契約は`core/year-tournament/ports.ts`(設計のインラインの型に`YearDrawRecord`(`markDrawn`の入力、`finished`は受賞なら優勝が必須の`YearTournamentFinish`)・`YearProductAward`・`YearCalendarEntry`(`YearCalendarYear & {record}`)・`YearEntryClassification`・`YearRefundClosedStatus`・`YearAward`の名前を付けた)、識別子は`identifiers.ts`の`YEAR_TOURNAMENT_TYPES`(11件、OfferPolicy・Fulfillmentを含む)。年のストアは`workers/year-tournament/d1-year-tournament-store.ts`の`D1YearTournamentStore`(`freeze`・`markDrawn`・`recordFinish`は条件付きの更新)。設計に無い決定: `ensureYear`は常に既定の日の列(`default`・版0)で挿入し、行があれば保存済みの列を返す(3.5の`ensureUpcoming`は`defaultFinalDate`の日程を渡すこと)、`schedule.year !== year`で`RangeError`/行の無い年の`freeze`は`'already'`/`updatedAt`・`updatedByAdminId`は`final_date_updated_*`を読む。テストの値は`workers/year-tournament/testing/year-tournament-fixtures.ts`(`yearTournamentIdOf`・`yearEntryIdOf`・`insertYearTournaments`・`insertYearEntries`・`defaultScheduleOf`・`YEAR`(2027)・`clearYearTournamentTables`等、File Structure Planに無い)。
- 3.2: 枠のストアは`workers/year-tournament/d1-year-entry-store.ts`の`D1YearEntryStore`。3.4まで`implements Pick<YearEntryStore, ...>`で実装済みのメソッドだけを宣言する(3.3・3.4で名前を足し、3.4で`implements YearEntryStore`へ)。`insertFromChampion`は1文の`INSERT ... SELECT`(凍結済みで決済期限日がWeek優勝の日より後の最小の年を集約の副問い合わせで取り、`CASE`で列を決める)と衝突先を指定しない`ON CONFLICT DO NOTHING`、`RETURNING status`で`exists`・`late`・`inserted`を返す(設計の「挿入の後に読み直す」と同じ判定を1文で行う)。遅れの枠は`initialStatus`が`entitled`でも出どころと`entitled_at`を空にし、`closed_at`を挿入の時刻にする。別のWeek優勝で同じローンチの枠があれば`exists`(通常のデータでは起きない)。親の決定: 契約のうちtasks.mdの3.2〜3.4に名指しされていない`findEntry`・`listOpenByOwner`・`listDrawn`は3.3で実装する。
- 3.3: `D1YearEntryStore`に`grantByUltras`・`forfeitByProduct`・`forfeitByOwner`・`classify`(50件ずつ)・`excludeOverCapacity`・`findEntry`(紐付けを解除した枠も読む)・`listOpenByOwner`(凍結済みの年の枠も返す。呼び出し元が`resolveAward`で分ける)・`listDrawn`を加えた。凍結の条件は非公開の`notFrozen()`(相関の`NOT EXISTS`)で付与と喪失だけに付け、`classify`・`excludeOverCapacity`は状態の条件だけ。`grantByUltras`は時間の条件を持たないため、呼び出し元(4.3)が`awardedAt ≤ activatedAt ≤ deadlineAt`を確かめる。設計のSystem Flowsの組み合わせ決定の手順3の「購入があれば`pending`」は喪失・除外にだけ掛けると解釈した(design.mdの状態遷移とWeekの設計・要件6.7に合わせ、`drawn`・`expired`は`none`のまま)。遅れの`expired`は`not_needed`、分類の`expired`は`none`で、どちらも返金の処理に入らない。テストは`.entitlement.worker.test.ts`・`.draw.worker.test.ts`に分けた(3.4は`.follow-up.worker.test.ts`等へ)。同じプロダクトの未完了のローンチは1つだけのため、1プロダクトに2つの枠を作るテストは古いローンチを`won`にする。
- 3.4: `D1YearEntryStore`に`listPendingFollowUps`・`markRefundRequested`・`markRefundClosed`(`not_needed`・`already_refunded`・`rejected`で知らせを待ちにしない)・`markNotice`・`unlinkOrDeleteByProduct`(`drawn`の枠は3つの紐付けの列をnullにして残し、他は削除)を加え、`implements YearEntryStore`にした(契約の全メソッドが揃った)。利用者の物理削除の前に`owner_user_id`がnullになる経路は、利用者の`purge_due`で`product-launch.product-erasure`(1000)が全プロダクトの`purge_due`を作りプロダクトの行が無くなるまで待つことで満たされる。4.2への申し送り: `tournament-year.entry-unlink`は必ずプロダクトのライフサイクルの`purge_due`に登録する(抜けると利用者の物理削除が外部キー違反で失敗する)。Weekの`listPendingFollowUpsOf`に当たるメソッドはYearの契約に無い。
- 3.5: `workers/year-tournament/year-calendar.ts`の`YearTournamentCalendar`(`new YearTournamentCalendar(store)`、デコレーター無し。3.16で`toDynamicValue`と`context.get(YEAR_TOURNAMENT_TYPES.YearTournamentStore)`で束縛)。設計に無い決定: `resolveAward`の`open`の`year`は`YearCalendarYear`の4項目(記録を除く。行が要るなら`describe`)/`upcoming`・`ensureUpcoming`は現在の業務年〜2年後を調べ最初の`planned`か`open`(1月の決勝日で翌年が12月に凍結済みになり得るため)、無ければ`RangeError`/組み合わせ決定の時刻を過ぎて凍結前の行は`open`(遅れた年の回復)/`openPeriodStart`は引数を使わない。決勝日の列を`explicit`へ書き換えるテスト・E2Eの補助は`final_date_version ≥ 1`にしないとCHECKに違反する。レビューで「初年度の繰り越し」のテストが決済期限日の後のWeek優勝の日で`not_held`の飛ばしを確かめていないと指摘され、直した(1回差し戻し)。
- 3.6: `workers/year-tournament/year-entry-registrar.ts`の`ChampionYearEntryRegistrar`(`ChampionYearEntryRegistrarOptions { appName, champions, matches, entitlements, calendar, store, ids }`、デコレーター無し。3.16で`WEEK_TOURNAMENT_TYPES.WeekChampionDirectory`・`MATCH_PLATFORM_TYPES.MatchDirectory`・`ULTRAS_TYPES.UltrasEntitlements`・`YEAR_TOURNAMENT_TYPES.YearCalendar`/`YearEntryStore`・`PLATFORM_TYPES.IdGenerator`で`toDynamicValue`)。設計の内部の食い違いの解決: System Flowsの手順3の「Week優勝ごとに`resolveAward`」ではなく契約の注記の「`describe` 1回」に従い、年の和集合を1回読んで純粋な`resolveTargetYear`を当てる(結果は同じ)。要件5.1の「Week優勝の決定時点で」に対し、設計の手順3どおり`wasEntitledDuring(投稿者, awardedAt, その年のdeadlineAt)`で判定する(広い分は5.2・5.5で同じ結果になる)。設計のMonitoringの`job`タグは呼び出し元が分からないため付けない。`skipped`は予選が見つからず作らなかった件数(次の取り込みで再試行)。`captureEvent`はwarning・fingerprint`['tournament-year', 'late-entry' | 'qualifier-missing']`・タグ`tournament_year_incident`・`week_tournament_id`(`project-values.md`への追記は8.2)。Weekの`incident-tags.ts`を読めないため`safeTagOf`相当を自前に持つ(3.11で同じものが要るなら`workers/year-tournament/incident-tags.ts`へ寄せる)。テストの補助は`testing/year-entry-registrar-fixtures.ts`。
- 3.7: `workers/year-tournament/year-entry-offer-policy.ts`の`YearEntryOfferPolicy`(`new YearEntryOfferPolicy(store, calendar, products: ProductDirectory, entitlements: UltrasEntitlements)`、デコレーター無し、`implements PurchaseOfferPolicy`)と文言の唯一の出どころ`YEAR_ENTRY_OFFER_REJECTION_MESSAGES`・型`YearEntryOfferRejectionCode`。拒否の順はnot_found→already_entitled→closed(状態か`resolveAward`の`late`)→product_unavailable→exempt。Ultrasの免除の期間(Week優勝の日時〜`min(now, deadlineAt)`)はクラスの非公開の`wasExempt`(Weekの`ultrasExemptionPeriodOf`相当。3.8等で再利用するなら`year-entry-rules.ts`へ寄せる)。受付期限の後の拒否はpaymentsの`assertAcceptable`が行い、可否の口は`available`を返す。5.13への申し送り: `errors.ts`・`mappers.ts`は`YEAR_ENTRY_OFFER_REJECTION_MESSAGES`を読み込み、導線の`checkout_closed`の文も`year_entry_closed`の文を使う。
- 3.8: `workers/year-tournament/year-entry-fulfillment.ts`の`YearEntryFulfillment`(`new YearEntryFulfillment(store, calendar, products: ProductDirectory)`、デコレーター無し)。反映の時刻は`purchase.paidAt`、凍結は`calendar.resolveAward(awardedDate, paidAt)`の`late`で判定。付与の文は`CASE WHEN <GRANTABLE_STATUSES> AND <yearEntryNotFrozen> THEN 'entitled' ELSE NULL END`で、準備の後の凍結・喪失・Ultrasの付与でNOT NULL違反になる。凍結の条件は`d1-year-entry-store.ts`の公開の関数`yearEntryNotFrozen(db)`へ出した(ストアと付与の文で共用)。仮6の境界の解釈: tasks.mdの3.8の「23:35以後は拒否」はrequirements.mdの4.8(「決済期限の後に反映された」)・design.md(「`deadlineAt`より後」)・Weekの先例に合わせ、23:35:00ちょうどは付与、23:35:01以後は拒否とした(文書間の相違)。3.16への申し送り: paymentsの反映の経路でも23:35:00と23:35:01の境界を確かめる。
- 3.9: `workers/year-tournament/year-notification-publisher.ts`の`YearTournamentNotificationPublisher(store, matches: MatchDirectory, notifications: NotificationEventPublisher, appName)`(デコレーター無し、ログのカテゴリ`[appName, 'year-tournament', 'notification']`)。`publishRound`・`publishAward`(`period: String(year)`)・`publishEvening`(その日の0:00〜`at`の受賞)。3.12・3.13は`publishRound`・`publishAward`、23:45のジョブは`publishEvening`を呼ぶ。テストの落とし穴: `clearMatchTables`はプロダクトのテーブルも消すため`clearYearTournamentTables`の後に呼ぶ(逆は外部キー違反)。`drawn`の枠はCHECKにより`classifiedYear`が要る。
- 3.10: 種別は`core/email/kinds/tournament-year.ts`の`TOURNAMENT_YEAR_ENTRY_REFUND_KIND`(`tournament-year.entry-refund`、`transactional`、入力の型`YearEntryRefundEmailInput`)、テンプレートはeventの`infrastructure/email/templates/tournament-year/`。3.11への申し送り: 入力は`{ nickname, yearLabel: \`${year}年\`(必ずこの形), weekLabel: formatWeekPeriodLabel(weekStart), reason: refundReasonFor(status, closeReason), billingUrl: <利用者側のオリジン> + '/settings/billing' }`。`project-values.md`への種別の追記は8.2。
- 3.11: `workers/year-tournament/year-entry-follow-up.ts`の`YearEntryRefundFollowUp`(`{ appName, store, calendar, refunds, contacts, emails, clientSiteOrigin, readLimit? }`、デコレーター無し、ログのカテゴリ`[appName, 'year-tournament', 'follow-up']`)。タグの安全化は`workers/year-tournament/incident-tags.ts`の`safeTagOf`(3.6も読み込む)。設計との相違: 設計の`processYear`に対応する年で絞るストアのメソッドが無いため、`listPendingFollowUps(now + 1ms, 50)`を読んで`classifiedYear === year`だけを処理し、読んだ枠を除いて繰り返す(他の年の待ちが50件以上先にあると一部が4:21の再処理に回る)。凍結の前の喪失の枠(`classifiedYear`がnull)の`yearLabel`のため、設計に無い依存`YearCalendar`を加え`resolveAward(awardedDate, now)`で年を求める。`not_needed`の拒否は設計の表どおり`info`(Weekは`error`)。`captureEvent`はfingerprint`['tournament-year', 'refund-already-refunded' | 'refund-rejected']`、タグ`tournament_year_incident`・`entry_id`・`purchase_id`(Monitoringの`job`・`year`・`bracketId`は付けない)。3.14への申し送り: `processYear(year, now)`の`now`は`classify`・`excludeOverCapacity`に渡した`at`以上にする。
- 3.12: `workers/year-tournament/year-progression-service.ts`の`YearTournamentProgressionService(tournaments, entries, progression: BracketProgression, notifications, appName)`(デコレーター無し、ログのカテゴリ`[appName, 'year-tournament', 'progression']`)。`advance`は進めるだけで、呼び出し元(4.1の確定のマッチイベントの処理)が`applyResult`を呼ぶ(Weekと同じ)。`advanceAll`は内部で両方を行う。設計との相違: `advance`の日程は保存した`first_round_date`ではなく`dailyRoundPolicy(yearFirstRoundDate(finalDate, participantCount) ?? finalDate, now)`(Weekも予定の日を使う)。1回戦は組み合わせ決定が予定し、2回戦以後は前のラウンドの実際の日から決まるため、全てのケースで同じ日になることをレビューで確かめた。`advanceAll`の失敗の`captureException`のタグは`year`・`year_tournament_id`(Monitoringの`job`・`bracketId`は付けない)。テストの補助は`testing/year-progression-fixtures.ts`(`seedYear`・`createService`・`RecordingYearNotificationPublisher`・`CountingYearTournamentStore`・`advanceAndApply`)。8人のブラケットの準決勝1は準々決勝1と4の勝者(`seedPlacementOrder`)。
- 3.13: `workers/year-tournament/year-draw-service.ts`の`YearTournamentDrawService`(`{ appName, tournaments, entries, registrar, products, entitlements }`、デコレーター無し、ログのカテゴリ`api.year-tournament.draw`)。`drawDue`→非公開の`drawYear`→`selectParticipants`(手順1〜4、上限の後に残した枠を返す)。凍結済み(`drawing`)の年は補完も凍結もせず続きから。分類の順序はYearトーナメント規則(受付中をまず参加資格か期限切れに分け、参加資格の枠だけを喪失・除外・組み合わせの対象に分ける)に合わせ、design.mdの手順3の書き方(先に喪失・除外)とは違う(1.10の決定)。上限の`tieBreaker`は`weekTournamentId`(一意で紐付けの解除でもnullにならない)。テストの補助は`testing/year-draw-fixtures.ts`(Weekの`draw-service-fixtures.ts`の`createEntitlements`・`seedProducts`を再利用)。親の決定(3.14で実装): 遅れの回復で2年が同時に到来し前の年が分類の途中で失敗したとき、後の年が前の年の受付中の枠を分類しないよう、`listCandidates`に任意の下限(`awarded_date >= 前年の行の決済期限日`、前年の行があるときだけ)を加える(3.3のストアの契約への追加。年ごとの失敗が他の年を止めない性質は保つ)。
- 3.14: `YearTournamentDrawService`の`drawYear`は分類→上限→`bracketDraw.create({ kind: 'year', … })`→`markDrawn`→`applyResult`→`followUp.processYear`(Weekと同じ)。参加0・1は`markDrawn`で結果を記録した後に受賞を発行し、その発行の失敗は同じ夜の23:45のジョブの`publishEvening`(`listAwardedBetween`)が拾う。ブラケットの同順の決め手は`launchId ?? entryId`、保存する`first_round_date`は`policy.firstRoundDate`(参加0・1はnull)。失敗の`captureException`のタグは`tournament_year_incident: 'draw-failed'`・`year`・`year_tournament_id`。親の決定の実装: `YearEntryStore.listCandidates`は`range: YearCandidateRange`(`{ awardedFrom: BusinessDate | null; awardedBefore }`、半開区間)を受け、`drawYear`は前年の行があるときだけその決済期限日を下限にする(design.mdの契約とSystem Flowsの手順3の条件は旧い形のまま=文書との相違)。3.16への申し送り: オプションに`bracketDraw`(`TOURNAMENT_PLATFORM_TYPES.BracketDraw`)・`progression`(`YearProgressionService`)・`followUp`(`YearEntryFollowUp`)を足した。テストの補助`year-draw-fixtures.ts`は実際の`D1BracketDraw`・進行・発行・返金の部品を組み立てる(マッチのIDは801から)。
- 3.15: `workers/year-tournament/d1-year-award-export.ts`の`D1YearAwardExport`(`@inject(PLATFORM_TYPES.Database)`だけ。3.16で`YEAR_TOURNAMENT_TYPES.YearAwardExport`へ束縛)。Weekの`D1WeekAwardExport`と同じ形で、`period`は`String(year)`。data-exportの利用側はまだ無い。
- 3.16: 束縛は`workers/year-tournament/year-tournament-platform-module.ts`の関数`createYearTournamentPlatformModule(appName)`(モジュール名`year-tournament-platform`。design.mdの定数`YEAR_TOURNAMENT_PLATFORM_MODULE`とは違うが、部品がログのカテゴリにアプリの名前を要するためWeekの先例どおり関数にした)。ストア3つは`.to()`、他の8つは`toDynamicValue`、全て`inSingletonScope`。api・eventの`MODULES`でWeekの共有モジュールの直後に置く(登録の部品が`WEEK_TOURNAMENT_TYPES.WeekChampionDirectory`を使う)。購入種別の登録は`year-tournament-registrations.ts`の`YEAR_TOURNAMENT_PURCHASE_KIND_REGISTRATION`をpaymentsの`PURCHASE_KIND_REGISTRATIONS`の末尾へ。paymentsのモジュールのテストの「未登録の購入種別」の例は`sponsorship`へ替えた(sponsorshipが登録されたら未登録の種別へ移す)。DIの解決の検査の名前とクラスの表は`testing/year-tournament-platform-implementations.ts`。paymentsの反映の経路のテストは`apps/api/src/composition/year-tournament-platform.payments.worker.test.ts`。design.mdの`BracketStore`の受け取りは、Yearのどの部品も使わないため束縛に現れない。apiの全件の`test:worker`は型検査と同時に走らせるとタイムアウトが出る(単独では通る)。
- 4.1: eventの識別子は`apps/event/src/application/year-tournament/event-year-tournament-types.ts`の`EVENT_YEAR_TOURNAMENT_TYPES`(8件、`Symbol.for('year-tournament.event.<名前>')`、`WeekChampionEntryHandler`・`RoundProgressHandler`・`ProductEntryLossHandler`・`AccountEntryLossHandler`・`EntryUnlinkHandler`・`YearUltrasEntryExemptionHandler`・`YearOpenEntryCheckoutExpiryHandler`・`YearEntrySupplementProvider`)。`WeekChampionEntryHandler`は`awardedFrom: occurredAt − 8日`。`RoundProgressHandler`はWeekのクラスと同名のため、4.5の束縛のモジュールではimportに別名を付ける。本specの年に無いブラケットは警告のログ(`outcome: 'tournament-not-found'`)で`done`。4.5の登録: マッチイベントの登録口に`tournament-year.week-champion-entry`(1700)・`tournament-year.decided-round-progress`(1710)。
- 4.2: eventの`ProductEntryLossHandler`(喪失→`listLaunchIdsByProduct`のローンチごとに`expireOpen({ kinds: ['year_tournament_entry'], targetId: launchId, limit: 50 })`、残れば`continue`→`findByLaunches`の返金待ち・知らせ待ちを`process`)・`AccountEntryLossHandler`(喪失の結果を先に`process`し、`listPendingFollowUps(now + 1ms, 50)`を繰り返して本人の枠だけを処理。他の利用者の待ちが50件以上先にあると一部が4:21に回る)・`EntryUnlinkHandler`(`unlinkOrDeleteByProduct`。ブラケットの参加者の紐付けの解除はWeekの`tournament-week.entry-unlink`が種類によらず行う)。いずれもWeekのクラスと同名のため4.5でimportに別名を付ける。範囲外の変更: `YearEntryStore`に`listLaunchIdsByProduct(productId)`を加えた(design.mdの契約に無い。`forfeitByProduct`は変えた枠しか返さず、再試行や`continue`で失効の対象を失うため。Weekと同名)。4.5の登録: プロダクトのライフサイクルに`tournament-year.product-entry-loss`(`deleted`、1700)・`tournament-year.entry-unlink`(`purge_due`、1700)、ユーザーのライフサイクルに`tournament-year.account-entry-loss`(`withdrawn`、1700)。
- 4.3: eventの`YearUltrasEntryExemptionHandler`(`listOpenByOwner`を`GRANTABLE_STATUSES`で絞り、`resolveAward(awardedDate, now)`が`open`で`awardedAt ≤ activatedAt ≤ deadlineAt`の枠を`grantByUltras`へ1回で渡す。0件なら呼ばない。Weekはストアで比べるがYearの枠は対象年を持たないため処理で比べる)・`YearOpenEntryCheckoutExpiryHandler`(Weekを写し`kinds: ['year_tournament_entry']`・`limit: 50`・最大5回・`targetId`無し)。クラス名はWeekと重ならない。4.5の登録: `ULTRAS_ACTIVATION_HANDLERS`に`tournament-year.ultras-entry-exemption`(1700)・`tournament-year.open-entry-checkout-expiry`(1710)。
- 4.4: eventの`YearEntrySupplementProvider`(`YearEntrySupplementProviderDependencies { store, calendar, products, clock, clientSiteOrigin }`、デコレーター無し)。Weekの勝利(`kind === 'week'`・`isWinningResult`・`launchId`あり・枠あり)だけに追記する(段階で絞らない。残り1で準決勝の勝利が優勝になる場合があるため。レビューで決勝に限る条件を差し戻し1回)。免除の判定は枠の状態(`entitled`・`ultras`)だけ、年と期限は`resolveAward`(`late`なら追記しない)。日時は`formatUtcDateTime`(年無し)、決勝日の表記「2027年5月16日(日)」は3.7の`year-entry-offer-policy.ts`の`formatFinalDate`と同じ写し(後で`core/year-tournament`へ寄せる候補)。4.5の登録: `RESULT_NOTICE_SUPPLEMENTS`に`{ name: 'tournament-year.entry-deadline', kinds: ['week'], order: 1700 }`。
- 4.5: eventの束縛は`apps/event/src/composition/year-tournament-module.ts`の`EVENT_YEAR_TOURNAMENT_MODULE`(名前`event-year-tournament`、`MODULES`でWeekの直後、7つは`.to()`・追記の部品は`toDynamicValue`)。Weekと同名の4クラスは`YearRoundProgressHandler`・`YearProductEntryLossHandler`・`YearAccountEntryLossHandler`・`YearEntryUnlinkHandler`の別名。5つの登録口に8件を加え、上流のテスト11件の完全一致の一覧と、`result-notice-supplements.unit.test.ts`(Weekの結果にYearの期限の追記が並ぶ)・`directory-module.worker.test.ts`(`slice(-4)`)を書き換えた。eventの`test:worker`の全件(106ファイル1292件)が通る。
- 5.1: apiの識別子は`apps/api/src/application/year-tournament/year-tournament-api-types.ts`の`YEAR_TOURNAMENT_API_TYPES`(13件)、ポートは同じディレクトリの`ports.ts`(`YearTournamentIncidentReporter`・`YearTournamentIncident`、`YearFinalDateWriter`(入力`YearFinalDateSave`))。ジョブは`year-tournament-jobs.ts`の`YearEveningBracketJob`・`YearEntryFollowUpJob`と定義`YEAR_EVENING_BRACKET_JOB_DEFINITION`・`YEAR_ENTRY_FOLLOW_UP_JOB_DEFINITION`・前提の名前`YEAR_EVENING_BRACKET_PARTICIPANT`(5.11で`scheduled-jobs.ts`・`evening-dispatch-participants.ts`へ)。設計の段(1)を`'calendar'`(`ensureUpcoming`)と`'entry-sync'`(`openPeriodStart`+`syncChampions`)に分けた(年の行の用意の失敗で取り込みを止めない。`openPeriodStart`が失敗したら`syncChampions`を呼ばない)。成功のログの`drawn`は年の一覧(Weekは件数)。テストの偽物は`testing/year-tournament-job-fakes.ts`。
- 5.2: `apps/api/src/infrastructure/year-tournament/sentry-year-tournament-incident-reporter.ts`の`SentryYearTournamentIncidentReporter`(`@injectable()`・引数無し。5.11で`bind(YEAR_TOURNAMENT_API_TYPES.YearTournamentIncidentReporter).to(...)`)。fingerprint`['tournament-year', kind]`、タグ`tournament_year_incident`・`job`・`year`(年が1つのときだけ)、年は`safeYearOf`(安全な整数でなければ`unknown`)。Monitoringの`bracketId`はポートに無いため付けない。
- 5.3: apiの`year-relaunch-condition-source.ts`の`YearRelaunchConditionSource(YearEntryStore, BracketStore, YearCalendar, WeekChampionDirectory)`(文言`YEAR_RELAUNCH_BLOCK_MESSAGES`)と`year-product-lock-source.ts`の`YearProductLockSource(YearEntryStore, BracketStore, YearCalendar)`(文言`YEAR_PRODUCT_LOCK_MESSAGE`)、どちらも`@inject`。共用の読み取りは`year-launch-standings.ts`(`readYearLaunchStandings`・`isContending`・`wonLaunchesOf`・`YearLaunchPhase`、Weekの`week-launch-standings.ts`に倣う。5.4・5.10も使える)で、各ストアを1回まで読む。設計の「`resolveAward`の`late`を使う」は年の和集合を`describe`1回で読み`resolveTargetYear`を当てる形にした(結果は同じ、3.6と同じ判断)。「組み合わせを書き終える前の年」は年の行の`status === 'drawing'`。テストの偽物は`testing/year-decision-fakes.ts`(5.4は別の名前にする)。年数の定数4は`year-target-rules.ts`・`year-calendar.ts`・本タスクの3か所に重複(`core/year-tournament`から1つ公開する候補)。
- 5.4: apiの`year-launch-summary-source.ts`の`YearLaunchSummarySource(YearEntryStore, BracketStore, YearCalendar, MatchDirectory)`(`@inject`)。共用の`readYearLaunchStandings`は`findAliveRefs`を読むため使わず、`findByLaunches`→(`describe`・`findParticipantStandings`・`listByLaunches`の並行)の2段で読む。`year-launch-standings.ts`から`targetYearCandidates`・`resolveTargetIn`を公開し5.3の内部も使う。受付中は`acceptUntil`(23:00)より前だけ(Weekと文言規則に合わせた。23:00〜23:35は要約が消えるが再ローンチの禁止は続く)。組み合わせに入りまだ試合を終えていない枠はシードによらず「参加決定」(文言規則と設計どおり。Weekの「1回戦進出」とは違う)。優勝は年の行の`outcome === 'awarded'`と`championEntryId`。テストの偽物は`testing/year-summary-fakes.ts`(`createYearSummaryFakes`・`standingOf`・`yearMatchOf`・`YEAR_BRACKET_ID`、5.10でも使える)。
- 5.5: apiの`year-trophy-source.ts`の`YearTrophySource`(`@inject(YEAR_TOURNAMENT_TYPES.YearTournamentStore)`、型は`Pick<YearTournamentStore, 'listAwardsByProducts'>`)。Weekと違い時刻の上限を持たない(ポートに引数が無く、受賞は終了の記録と同時に入る)。`/tournaments/year/`のパスはファイルの中の非公開の定数。5.11への申し送り: `YEAR_TOURNAMENT_API_TYPES`にトロフィーの供給元の識別子が無いため5.11で足し(Weekの`WEEK_TOURNAMENT_API_TYPES.WeekTrophySource`と同じ形)、`TOURNAMENT_TROPHY_SOURCES`に`tournament-year.year-trophies`(10)で登録する。
- 5.6: apiの`year-final-date-service.ts`の`DefaultYearFinalDateService`(`@inject`: `YEAR_TOURNAMENT_TYPES.YearCalendar`・`YEAR_TOURNAMENT_API_TYPES.YearFinalDateWriter`・`ADMIN_PLATFORM_TYPES.AuditLogRecorder`・`PLATFORM_TYPES.IdGenerator`)。ロールの判定はしない(5.14のリゾルバで保存は`super_admin`、照会は`viewer`)。エラーは`year-final-date-errors.ts`(File Structure Planに無い)で、選択の違反は`validation_error`(400、`details[0]`の`{ field: 'year' | 'finalDate', code: <理由>, message: <文言規則> }`。5.14・7.3は`details[0].code`で分ける)、変更不可・凍結は`final_date_locked`(422)、版の競合は`version_conflict`(409)。範囲外の年は`describe`の前に`year_not_editable`、`update`も先に`ensureUpcoming`。決勝日の表記は共用の`core/year-tournament/final-date-label.ts`の`formatFinalDateLabel`(常に年と曜日つき)に寄せ、3.7・4.4の写しも置き換えた(レビューで日付の曜日の欠けを差し戻し1回)。テストの偽物は`testing/year-final-date-fakes.ts`。
- 5.7: apiの`infrastructure/year-tournament/d1-year-final-date-writer.ts`の`D1YearFinalDateWriter`(`@inject(PLATFORM_TYPES.Database)`だけ。5.11で`bind(YEAR_TOURNAMENT_API_TYPES.YearFinalDateWriter).to(...)`)。設計との相違: design.mdのUPDATEの`CASE`によるNOT NULL違反ではなく、監査ログのガイドと先例(`D1SenderInfoWriter`・`D1PromotionSettingWriter`)に倣い、条件(年・版・`draw_started_at IS NULL`・`change_lock_at > now`)を監査ログのガード`{ kind: 'condition' }`とUPDATEのWHEREで共有し`isAuditGuardRejection`で判定する。一括の順は行の用意(`ON CONFLICT(year) DO NOTHING`)→監査ログ→UPDATE(ガードのEXISTSが行を読むため。ガイドの「監査の文を先頭に」の例外)。拒否の後は行を読み直し、凍結か変更期限以後なら`locked`を`version_conflict`より優先する。業務時刻はUTC−8なのでテストの時刻は`fromBusinessDateTime`で作る。
- 5.8: apiの`year-board-reader.ts`の`DirectoryYearBoardReader`(インターフェース`YearBoardReader`、`@inject`: `MATCH_PLATFORM_TYPES.MatchDirectory`・`TOURNAMENT_PLATFORM_TYPES.BracketStore`・`YEAR_TOURNAMENT_TYPES.YearTournamentStore`。5.11で`bind(YEAR_TOURNAMENT_API_TYPES.YearBoardReader).to(...)`)。`YearBoardRound`に設計に無い`bracketPath`を加えた(GraphQLの`YearTournamentRoundBoard.bracketPath`のため、Weekと同じ)。年の行は年ごとに`findById`(遅れの回復で2回になり得る。設計のPerformanceの「1回」との相違)。行は年→ラウンドの昇順。ブラケットのパスは共用の`year-bracket-path.ts`の`yearBracketPathOf(year)`(5.5も使うよう改めた)。5.12への申し送り: リゾルバは`matchViewLoader`でマッチの表示をまとめて読み、`placementOf`で対戦カードと不戦勝に分け、`isFinal`の行は決勝の演出の区画へ。
- 5.9: apiの`year-bracket-reader.ts`の`DirectoryYearBracketReader.read({ year, viewer, now })`(design.mdは`read(yearKey, now)`だが、マッチの表示に閲覧者が要るためWeekの6.8と同じ形=文書との相違。`@inject`: `YEAR_TOURNAMENT_TYPES.YearTournamentStore`・`TOURNAMENT_PLATFORM_TYPES.BracketStore`・`MATCH_TYPES.MatchViewReader`・`PRODUCT_PLATFORM_TYPES.ProductDirectory`。5.11で`bind(YEAR_TOURNAMENT_API_TYPES.YearBracketReader).to(...)`)。ブラケットは`findById(bracketId)`(設計どおり、Weekは`findByTournament`)。application層は`lib/workers`を読めないため、ローカルD1のWorkers統合テストは`src/composition/year-bracket-reader.worker.test.ts`に置いた。5.12への申し送り: `AccountGuard.currentUser(context.session)`を`viewer`へ渡す。`chunk`と90の定数はWeekの写し。
- 5.10: apiの`year-entry-panel-reader.ts`の`DirectoryYearEntryPanelReader.readForOwner(viewer, productHandle, now)`(`@inject`: `PRODUCT_PLATFORM_TYPES.ProductDirectory`・`YEAR_TOURNAMENT_TYPES.YearEntryStore`・`YEAR_TOURNAMENT_TYPES.YearCalendar`・`TOURNAMENT_PLATFORM_TYPES.BracketStore`・`MATCH_PLATFORM_TYPES.MatchDirectory`・`ULTRAS_TYPES.UltrasEntitlements`・`PAYMENTS_TYPES.PriceCatalog`)と`year-entry-checkout.ts`の`DefaultYearEntryCheckout`(`API_PAYMENTS_TYPES.CheckoutStarter`)。設計との相違: 照会の値の`year`は`YearCalendarEntry`、`launchId`・`refundable`・`progress.eliminatedRoundName`を加え(GraphQLの型には既にある)、Weekの`ultrasGuide`・`checkoutBlock`は持たない。対象年は`classifiedYear`があればそれ、無ければ4年の`describe`と`resolveTargetIn`。テストの偽物は`testing/year-entry-panel-fakes.ts`(`createPanelFakes`・`VIEWER`・`NOW`・`rejectionOf`、5.13でも使える)。5.13への申し送り: `bracketPath`(`yearBracketPathOf(panel.year.year)`)と`serverTime`はリゾルバで足す。
- 5.11: apiの束縛は`apps/api/src/composition/year-tournament-module.ts`の`YEAR_TOURNAMENT_API_MODULE`(名前`api-year-tournament`、`MODULES`でWeekの直後、13部品すべて`.to()`)。登録: ジョブ2件(1700)、判定の供給元`tournament-year.result-pending`・`tournament-year.bracket-lock`・`tournament-year.launch-summary`(1700)、トロフィー`tournament-year.year-trophies`(10、Weekの`TrophySources`は[Year, Week]になる)、夜の送り出しの前提`tournament-year.evening-bracket`。CronはWranglerに既にある。`YEAR_TOURNAMENT_API_TYPES.YearTrophySource`は5.1で既にあった(5.5の申し送りは誤り)。上流のテスト(`test/config`・登録口の単体テスト・product・search・notifications・Weekのnight/progression)を書き換え、夜の送り出しは前提2つ(Week・Year)が揃って依頼される。`test/support/week-tournament-timeline.ts`の`clearTimelineTables`は先に`clearYearTournamentRows()`を呼ぶ。5.12〜5.14・8.xへの申し送り: 23:45の実行の後にマッチやプロダクトを消すテストは先にYearの行を消す(`clearYearTournamentRows`・`clearYearTournamentTables`)。apiの`test:worker`の全件は単独の実行で461ファイル6746件が通る。
- 5.12: GraphQLのスキーマモジュールは`apps/api/src/presentation/graphql/modules/year-tournament/`(`yearTournamentBoard(date)`・`yearBracket(year)`、`clientOnly`)。`YearBracket.rounds`はWeekの`BracketRound`(再定義せずWeekのリゾルバで解決)。`YearTournamentSummary`の`finalDate`は設定した決勝日(`schedule.finalDate`)、`firstRoundDate`は年の行の`record.firstRoundDate`(Weekのブラケットはラウンドの日から取る=相違)、`label`は「<年>年」。トップページの行の`finalDate`は遅れを見込んだ日。6.4への申し送り: 遅れがあると見出しの`tournament.finalDate`が最終ラウンドの`date`とずれ得る。Weekの`board-resolvers.ts`の不戦勝・配置の処理と`resolver-support.ts`・`inputs.ts`は写した(File Structure Planに`inputs.ts`・`resolver-support.ts`は無い)。テストの補助は`apps/api/test/support/year-tournament-graphql-operations.ts`(`installYearTournamentGraphQLTest`・`setYearTestNow`・`YEAR_BOARD_DATE`・`YEAR_FINAL_DATE`)、Weekの補助の`BRACKET_ROUND_SELECTION`・`BYE_ENTRY_SELECTION`を公開した。5.13・5.14は`type-defs.ts`に型と照会を、`type Mutation { ... }`と`index.ts`の`Mutation`を足す(`errors.ts`は未作成)。
- 5.13: `myYearEntry(productHandle)`・`startYearTournamentCheckout(launchId)`を5.12のスキーマモジュールに足した(`entry-resolvers.ts`・`errors.ts`、Weekの写し)。`checkout_closed`はpaymentsの文言「決済の受付は終了しました。」のまま返し、導線の文言の差し替えはclientの共用の`tournament-entry-checkout.tsx`が行う(Weekと同じ。3.7の申し送りの「`mappers.ts`も読み込む」はYearに`checkoutBlock`が無いため不要)。テストの補助は`apps/api/test/support/year-entry-graphql-operations.ts`(Weekの`week-entry-graphql-operations.ts`に倣う)。「<年>年」の表記は`mappers.ts`の`yearLabelOf`に一つ。6.1への申し送り: clientの操作を足した後にapiで`graphql:allowlist`を再実行する。
- 5.14: `yearFinalDateSettings`(`adminOnly`→`requireAdmin(context, 'viewer')`)・`updateYearFinalDate`(`adminOnly`→`withValidatedArgs`→`requireAdmin(context, 'super_admin')`)を`final-date-resolvers.ts`に足した。変更者が無い年は`updatedBy`がnull、削除済み・招待中は`{ nickname: null }`(2年分を1回の`findProfiles`)。詳細の欄は`withInputPath('input')`で`input.year`・`input.finalDate`。テストの補助は`apps/api/test/support/year-final-date-graphql-operations.ts`(管理者のセッションと監査ログのIDは固定した時計で振られるため、時計を動かしたらセッションを発行し直し、続けて保存するテストは時計を1分進める)。7.1への申し送り: adminの操作名は`AdminYearFinalDateSettings`・`AdminUpdateYearFinalDate`、選ぶ項目はテストの補助の`SETTING_SELECTION`と同じ。adminの操作を足した後にapiで`graphql:allowlist`を再実行する。
- 6.1: clientの操作は`apps/client/src/graphql/operations/year-tournament/`(`ClientYearTournamentBoard`・`ClientYearBracket`・`ClientMyYearEntry`・`ClientStartYearTournamentCheckout`)、フラグメントは`fragments/year-tournament/year-board-round-fields.graphql`、補助は`src/graphql/year-tournament.ts`(`yearTournamentBoardQueryOptions(viewer | null, date)`・`yearBracketQueryOptions(viewer | null, year)`・`myYearEntryQueryOptions(viewer, productHandle)`・`startYearTournamentCheckoutMutationOptions()`)。タスク文・design.mdとの相違: `BracketRoundFields`・`YearBoardRoundFields`を名前で展開するとapiの深さの上限(8)を超えるため、Weekと同じく照会に同じ項目を直接書き(名前で展開は`champion`の`...BracketMatchProductFields`だけ)、フラグメントは型だけを生成して型の一致を`expectTypeOf`で固定した(004・016の文書とWeekの7.1の申し送りどおり。design.mdの記述は8.2で直す候補)。6.2は`rounds[i]`を`YearBoardRoundFieldsFragment`、6.4は`yearBracket.rounds`を`readonly BracketRoundFieldsFragment[]`として扱える。
- 6.2: clientの`components/year-tournament/`に`YearTournamentSection`(`main` 10、`tournament-year.matches`)・`use-year-board.ts`(`useYearBoard({ board, clientViewer, autoRefresh, refetchIntervalOf, canChange })`→`{ yearBoard, updatesSinceBaseline, onUpdated }`)・文言`year-tournament-messages.ts`(`YEAR_BOARD_COPY`・`YEAR_FINAL_COPY`・`YEAR_BRACKET_COPY`)・フィクスチャ`year-tournament-fixtures.ts`(6.3用: `yearFinalRoundOf`・`yearFinalBoardOf`・`YEAR_FINAL_DATE`・`yearBoardResult`・`EMPTY_YEAR_BOARD`、6.4用: `yearBracketOf`・`AWARDED_YEAR_BRACKET`・`NO_AWARD_YEAR_BRACKET`・`HIDDEN_CHAMPION_YEAR_BRACKET`・`YEAR_*_ROUNDS`・`YEAR_CHAMPION`・`YEAR_TOURNAMENT_LABEL`・型`YearBracketView`)。見出しの決勝日は行の`finalDate`(遅れの後は遅らせた後の日)。登録口のテスト`top-page-sections.browser.test.ts`は一覧の完全一致を保ち、部品の検査をIDでの検索にした(6.3は`tournament-year.final`(`showcase` 10)を完全一致の一覧に足す)。トップページの経路のテストにYearの照会の空の偽物`test/year-tournament-board-stub.ts`の`withoutYearTournamentMatches`を足した。盤面のフィクスチャの1回戦の日(5/27)はブラケットのフィクスチャ(5/28)と食い違うが表示とテストには影響しない。
- 6.3: clientの`year-final-showcase.tsx`の`YearFinalShowcase`(`showcase` 10、`tournament-year.final`)はWeekの`week-final-showcase.tsx`と同じ形の薄い包み(行の`key`は`round.tournament.year`)。登録口のテストの完全一致に加え、showcaseの並び(Year 10→Week 20)のテストを足した。`project-values.md`の登録の一覧(1137行目の「4件」)には`tournament-year.matches`・`tournament-year.final`がまだ無い(8.2)。
- 6.4: 経路は`apps/client/src/routes/tournaments/year/$year.tsx`(Weekの`$week.tsx`と同じ形、年の形式は経路の中の局所の正規表現`/^\d{4}$/u`。016の文書の「共用部品の解析」と相違、common-libに年の解析が無い)、本体は`components/year-tournament/year-bracket-page.tsx`、決勝日は`year-bracket-model.ts`の`yearBracketFinalDateOf`(開催中は最後のラウンドの日、終了した年は最後のラウンドが決勝のときだけその日、それ以外は設定した決勝日)。共用の`TournamentBracketPage`に任意の`finalDate?: string`(h1と参加数の間に`<time datetime>`、省けばWeekの表示は不変)を足した。`site-links.ts`に`yearBracketHref(year)`、`page-heads.ts`に`buildYearBracketHead`。`routeTree.gen.ts`は生成器で作り末尾の`declare module '@tanstack/react-start'`の塊を手で戻した。型`YearBracketView`は`year-bracket-model.ts`と6.2のフィクスチャに重複。design.mdの「`bracketViewPropsOf(yearBracket)`を渡す」は1.6の構造(共用のページが自分で作る)と相違。
- 6.5: clientの`year-entry-view.ts`の`yearEntryInputOf`(返金の対象はサーバーの値、`excludedReason`は`HIDDEN_OR_SUSPENDED`・`OVER_CAPACITY`を写す)・型`YearEntryPanelView`(6.6で使う)、`year-entry-messages.ts`(`YEAR_ENTRY_COPY`・`yearEntryIntroMessage`・`formatYearFinalDateLabel`)、`year-entry-panel.tsx`の`YearEntryPanel({ productHandle })`(`countdown: false`、`autoRefresh`は`false`固定)、フィクスチャ`year-entry-fixtures.ts`。共用の`TournamentEntryPanelBody`に任意の`payableIntro?: ReactNode`(決済の導線の間だけ決済期限の前に描く、Weekは渡さない)を足した。決勝日の表記はbackend-libの`formatFinalDateLabel`とclientの`formatYearFinalDateLabel`に重複(clientはbackend-libを読めない。common-libへ寄せる候補)。文書間の相違: design.mdの導線の項目名「参加費の決済期限」とrequirements.mdの4.2の「決済期限を過ぎた旨」は、文言規則(「決済期限」・「参加受付は終了しました。」)と違う。
- 6.6: clientの`year-entry-owner-action.tsx`・`year-entry-my-product-section.tsx`(`YearEntryPanel`を現在のハンドルで描く)・`year-entry-delete-notice.tsx`(`myYearEntry`が`AWAITING_PAYMENT`・`ENTITLED`のときだけ、判定は`year-entry-view.ts`の`hasYearEntryDeleteNotice`、文言は`YEAR_ENTRY_DELETE_NOTICE`)。登録は`PRODUCT_OWNER_ACTIONS`・`MY_PRODUCT_SECTIONS`の`tournament-year.entry`(20)と`PRODUCT_DELETE_NOTICES`の`tournament-year.entry-loss`(20)。実際の登録口を使うページのテストのフィクスチャ(`test/edit-product-fixtures.tsx`・`test/my-products-route.browser.test.tsx`・`test/product-page-route-fixtures.ts`)に`ClientMyYearEntryDocument`へ`{ myYearEntry: null }`を返す分岐を足した(レビューで詳細ページのフィクスチャの漏れを差し戻され、親が直してページのテストに`YearEntryPanelContent`の失敗が出ないことを確かめた)。`project-values.md`の3つの登録口の一覧は8.2で足す。
- 7.1: adminの操作は`apps/admin/src/graphql/operations/year-tournament/`の`AdminYearFinalDateSettings`・`AdminUpdateYearFinalDate`(apiの`SETTING_SELECTION`と同じ項目)。照会の補助は`apps/admin/src/graphql/admin-year-final-date.ts`(`adminYearFinalDateSettingsQueryOptions()`、型`AdminYearFinalDateSettings`・`AdminYearFinalDateSetting`。File Structure Planに無い、ultras・notificationsの先例と同じ形)。変更は部品で`useMutation(graphqlMutationOptions(AdminUpdateYearFinalDateDocument))`を直接使い、保存の後は`invalidateQueries({ queryKey: [documentIdOf(AdminYearFinalDateSettingsDocument)] })`。apiは未設定の年で`updatedAt`・`updatedBy`をnullで返すので、先例の`toXxxLastChange`の写しは要らない。
- 7.2: adminの`components/year-tournament/final-date-labels.ts`(`formatFinalDateLabel`・区画の題名と説明・カードの項目・印・参照だけの理由・翌年の注意・拒否の理由6つの文・`isFinalDateViolationReason`・`finalDateViolationMessageOf(reason, setting)`・`FINAL_DATE_LOCKED_MESSAGE`・`FINAL_DATE_VERSION_CONFLICT_MESSAGE`)、`final-date-year-card.tsx`の`FinalDateYearCard({ setting, children })`、フィクスチャ`final-date-fixtures.ts`(`CURRENT_YEAR_SETTING`(2026・既定・変更不可)・`NEXT_YEAR_SETTING`(2027・明示・変更可)・`settingOf`)。設計との相違: カードは`FinalDateForm`を直接描かず、編集の欄を`children`の受け口として`RoleGate(super_admin)`かつ`changeable`のときだけ描く(7.4で`<FinalDateYearCard setting={s}><FinalDateForm setting={s} /></FinalDateYearCard>`)。変更期限を過ぎた年は全てのロールに期限の理由を示す。生成された型の項目名は`nextYearGapWarningDate`(design.md・タスク文の`nextYearGapWarning`と相違)。7.3への申し送り: 「選べる日付がありません。」・確認のダイアログの文・「決勝実施日を保存しました。」・「保存する」は`final-date-labels.ts`へ足す。決勝日の曜日つきの表記はbackend-lib・client・adminの3か所(common-libの`business-date-label.ts`へ寄せる候補)。
- 7.3: adminの`final-date-form.tsx`の`FinalDateForm({ setting })`(共用のRadixの`Select`で候補を選び、`ConfirmActionDialog`(`reason: 'optional'`・`audited`)で確認)。確認のダイアログの変更後の受付期限・組み合わせ決定は`final-date-schedule.ts`の`scheduleOfChoice`(サーバーの現在の`acceptUntil`・`drawAt`を選んだ日との暦日の差だけずらす。業務時刻が夏時間の無い固定のUTC−8であることに依る)。拒否の理由の文言はサーバーの`details[0].message`を優先し、空のときだけ`finalDateViolationMessageOf`(レビューで表示中の古い隣の年の日付を差し込む点を差し戻し1回)。`validation_error`・`final_date_locked`・`version_conflict`の照会の読み直しはダイアログを閉じたとき(開いたまま読み直すとフォームとダイアログが消えるため。ultrasの先例は直ちに読み直す)。文書との相違: 設計・タスク文の`<select>`でなく共用の`Select`(`role="combobox"`)、確認のダイアログの題名と説明は`ConfirmActionDialog`の`title`・`description`が`string`型のため日時を`<time>`でなく文字列で示す(日時の表示の規約と相違。frontend-libの型を広げれば直せる)、ページ配置は理由の欄をカードに置くとするが設計と文言規則どおりダイアログに置いた。
- 7.4: adminの`final-date-section.tsx`の`FinalDateSection`(題名・説明・2年分の`<FinalDateYearCard setting={s}><FinalDateForm setting={s} /></FinalDateYearCard>`)。最初の取得の失敗は`throwOnError`で設定ページの`RecoverableSlot`へ投げる(先例と009のガイドどおり。design.mdの「区画の中の`ErrorState`」とは書き方の相違で見た目は同じ)。登録は`ADMIN_SETTINGS_SECTIONS`の`tournament-year.final-date`(10、`FINAL_DATE_SECTION_TITLE`)。1.9の水平展開の漏れ: adminの`audit-logs-page.browser.test.tsx`の操作種別の完全一致の一覧に「Yearトーナメント決勝実施日の変更」が無く失敗していたため、親が足した。`project-values.md`の965行目(設定の区画「2件」)は8.2で直す。
- 8.1: apiの`src/composition/year-tournament-module.night.worker.test.ts`・`year-tournament-module.progression.worker.test.ts`と補助`apps/api/test/support/year-tournament-timeline.ts`(`createYearTimeline`は呼ぶたびに1ミリ秒進む時計)。Weekの補助`week-tournament-timeline.ts`に`purchaseKind`・`scheduledRunsOf(logs, prefixes)`・`TIMELINE_JOB_PREFIXES`・`ModuleOverride`の公開を足した(既定は不変)。固定の時計ではWeek(1500)の`awardedAt`とYear(1700)の`awardedBefore: now`が同じになり同じ夜のWeek優勝を取り込まないが、本番は`systemClock`がI/Oの後に実時間で進み、確定のイベントの経路(1510→1700)でも同じ夜に取り込むため不具合ではない(レビューで確認)。タスク文の「23:35(paymentsの10)」「23:40(notificationsの1300)」は実際の`SCHEDULED_JOBS`(突合は23:40の10、通知は23:45の1300)と違い、実際に従った(tasks.mdの文言の相違)。補助の`seedSameNightWeekFinal`はWeekの週2・枠とプロダクト11・12・マッチ900・予選911を使う。
- 8.2: 新規`docs/GUIDES/tech/backend/019-anchor-date-schedules.md`(固有の関数名・理由のコードは`project-values.md`のプレースホルダーの行へ)、`frontend/012`に「サーバーが返す候補から選ばせる日付」の節(共用の`Select`で書いた。G7・design.mdの`<select>`とは相違)、`backend/016`・`017`・`frontend/013`・`016`・`infra/003`に共用の部品を反映、`project-values.md`末尾に「## Yearトーナメント」の節と全ての申し送り、`CLAUDE.md`の参照先に`backend/019`の行(denyされず反映)。既知の限界として`backend/019`に書いた: 決勝実施日の保存の条件は自分の年の行だけを見るため、隣の年を同時に保存すると間隔(64週)の検証を通り抜け得る(設計に無い競合。開発者の判断待ち)。design.mdの6.1のフラグメントの展開の記述と`<select>`の記述はspec文書のため直していない。
- 8.3: E2Eの補助は`e2e/support/year-tournament-fixtures.ts`(`createYearTournamentEntrants({ openOwnerHandle? })`(a)・`closeYearTournamentEntry`(b)・`startYearFinalToday`(c、年の行の`first_round_date`もそろえる)・`endYearFinal`(d、Weekの`endWeekFinal`を呼ぶ)・`runYearEveningJobs`(Weekの`runWeekEveningJobs`、`triggerScheduled`で23:40・23:45)・`readYearFinal`・`readYearTournamentState`・確認専用の`entitleOpenYearEntryWithoutPayment`(8.4では使わない))とSQL`year-tournament-fixture-sql.ts`(+単体テスト)、E2E`e2e/client/year-tournament.e2e.test.ts`。対象年は`year < 2026`の最大+1か1001。Weekの行は作らず、枠の`week_tournament_id`は乱数のULID(外部キー無し。Yearの照会・組み合わせ・トロフィーは枠の写しだけを読む。プロダクト詳細にPotWのトロフィーは出ない)。年の行の決勝日は既定の5月末で決済期限日(12月31日)と矛盾するが、2人の1回戦は`dailyRoundPolicy`で翌日になり表示と進行に影響しない。業務時刻の23:40〜24:00は`test.skip`。ローカルでWeekの補助のE2Eと同時に走らせるとD1の`SQLITE_BUSY`で落ちることがある(既知)。組み合わせ決定は1回に2年まで(`listDue`は昇順)のため、途中で止まった過去の年が残るとE2Eの年が後回しになり得る(ローカルD1を作り直せば解消)。
- 8.4(2026-11-18): `e2e/client/year-tournament.e2e.test.ts`の「Yearトーナメントの参加費・組み合わせ・受賞」と手順`e2e/client/year-tournament-steps.ts`。8.3の補助のテストは残した。ブラケットのページは組み合わせの直後(「予定」)に`yearBracketHref`で開き、トップページの区画はリンクのhrefだけを確かめる(Weekと順が違う)。ファイル全体を3回続けて成功。`docs/onboardings/README.md`にYearのE2Eの節を足した。開発者への依頼: Infisicalの`dev`の`STRIPE_WEBHOOK_SECRET`が現在の`stripe listen --print-secret`と一致しない(ハッシュで比較)。README「ローカルのWebhookの転送」の手順で再登録すること(今回はeventの起動時だけ環境変数で差し替えて実行した)。`stripe listen`はInfisicalの制限付きのキー(`rk_test_`)では`stripecli_session_write`の権限が無く拒否されるため、CLIのログイン(同じsandbox)で実行した。転送の1件はローカルD1の`SQLITE_BUSY`で500になったがStripeの再送とランディングの反映で通った。実行のたびにsandboxに決済が1つ残る。
- 8.5: `e2e/admin/year-final-date.e2e.test.ts`(最上位管理者の保存と監査ログ、`viewer`の参照だけ)と手順`e2e/admin/year-final-date-steps.ts`、候補の選び方`e2e/support/year-final-date-choice.ts`の`pickFinalDateChoice`(+単体テスト、既定の日に最も近い現在以外の候補で、実行のたびに既定の日とその前の日曜日を交互に選ぶ)。実行は`infisical --telemetry=false run --env dev --silent -- bunx playwright test e2e/admin/year-final-date.e2e.test.ts --project=admin`(api・event・admin(48045)を起動)。3回続けて成功。翌年の行は明示の設定のまま残る(後片付けしない。他のE2Eと組み合わせ決定に影響しないことをレビューで確認、READMEに記載)。
- 8.6(2026-11-18): `bun run check`・全アプリの単体・Workers統合(api 467ファイル6835件・event 106/1292)・ブラウザ(clientは単独の再実行で208ファイル2986件)のテストがカバレッジ付きで成功。本specの変更ファイル(`c2b198d5..HEAD`、名前を変えた10件を含め200件)のうち計測の対象171件がすべて80%以上(最低は`tournament-board-fixtures.ts`の関数83.3%、テストの値以外では`board-resolvers.ts`のWorkers 86.7%)。対象外は型だけの`ports.ts`・`codegen.config.ts`・合成の登録・経路・テストとE2Eの補助。足したテスト: `year-bracket-reader.unit.test.ts`、`scheduled-trigger.unit.test.ts`(e2eの`addBusinessDays`とbackend-libの一致)、フィクスチャのファイルの単体テスト、`TournamentBracketPage`・`site-links`・`week-entry-messages`のテストの拡張、`BOARD_FIXTURE_ACCESS`等をフィクスチャからテストへ移した。本spec外の不安定なテスト(client `member-inquiry-form`(Browser connection was closed)・`comment-thread.mutations`(タイムアウト)、admin `legal-draft-form`)は単独の再実行で成功(スワップが満杯でメモリの逼迫が原因と推測)。
