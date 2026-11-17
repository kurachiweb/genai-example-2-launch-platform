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

- [ ] 1.9 (P) 決勝実施日の変更の監査ログの操作種別を加える
  - 先に、単体テストで、操作種別の名前・表示名・対象の種類(設定)・任意の理由・詳細の鍵(年・変更前後の日付・変更前の出どころ)・対象の上限1と、全操作種別の集約の重複の検査を確かめる
  - 本specの操作種別のファイルを作り、管理画面の監査ログの操作種別の集約へ加え、集約の一覧を確かめる既存の単体テストを書き換える
  - 完了状態: 単体テストが成功し、集約の検査を通る
  - _Boundary: YearAuditActions_
  - _Requirements: 2.10_

- [ ] 1.10 (P) Yearトーナメント規則・日次タイムライン・ページ配置・文言規則に本specの決定を先に書き、返金ポリシーと決済実装方針との一致を確かめる
  - Yearトーナメント規則: 仮1(前年の決勝日の扱いと初年度)・仮2(64を超える参加)・仮3と仮4(組み合わせ決定時点の除外と返金)・仮6(期限の後の反映)の確定した規則を加え、凍結の時点、ラウンドの遅れの回復(決勝が決勝日の後になり得ること)、ブラケットのページ(仮5)を加え、「参加数上限64(決勝日設定の制約により保証)」の記述を仮2に合わせて直す
  - 日次タイムライン: 23:45の`tournament-year.evening-bracket`(1700。Week優勝の取り込み→組み合わせ決定→進行→通知の発行→夜の送り出しの準備の完了の通知の順)、4:21の表に`tournament-year.entry-follow-up`(1700、`content-processing.keyword-reextraction`(2300)より前)。夜の送り出しは前提の全機能の準備の完了の後(遅くとも23:55)に始まり、23:50を前提にしない
  - ページ配置: Yearのブラケットのページの構成(仮5)、トップページのYearの区画の見出しとブラケットへの導線、Yearの参加費の導線の状態の一覧と置き場所(秒読みとUltrasの案内を添えない)、削除の注意書き、管理画面の設定の決勝実施日の区画(現在の年と翌年、仮8)
  - 文言規則: 設計のSupporting Referencesに挙げたエラー・状態・ブラケット・管理画面・返金の知らせの文言
  - 返金ポリシーと決済実装方針: 既に更新済みのWeek・Yearに共通の停止の行・Yearの上限による停止の行・購入種別の表のYearの行が、仮4・G4と一致することを確かめ、差があれば直す
  - 完了状態: 6つの文書が整形の検査を通り、6・7のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service`の該当する6文書_
  - _Requirements: 16.6_

- [ ] 2. Yearの純粋な規則
- [ ] 2.1 決勝日と期限・1回戦の日の規則を作る
  - 先に、単体テストで、既定の決勝日(5月31日が日曜日の年と月曜日の年を含む複数の年)、決勝日からの決済期限日・受付期限23:00・決済期限23:35・組み合わせ決定23:45・変更期限(7日前の0:00)、参加数2・3・4・5・8・9・13・16・17・32・33・64の1回戦の日(決勝日〜5日前、N = 13はYearトーナメント規則の例どおり3日前)と参加数1以下の無し、65での例外、日曜日でない決勝日での例外を確かめる
  - 曜日と日数の計算は1.1の業務時刻の共通の関数で行う
  - 完了状態: 単体テストが成功し、規則がD1を読み込まない
  - _Requirements: 1.1, 1.2, 1.4, 1.6, 16.2_

- [ ] 2.2 選べる決勝日と検証の規則を作る
  - 2.1の日程の型を使うため(P)にしない
  - 先に、単体テストで、設定できる対象年(現在の年と翌年)、日曜日と対象年、8日後の境界(その日の0:00がちょうど8日後は可、1ミリ秒足りなければ不可)、前年から447日と448日、翌年が設定済みのときの447日と448日、変更期限の前後と凍結による変更不可、拒否の理由の順、候補の一覧(変更できなければ空)、翌年の既定の日の注意の有無を確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 2.4, 2.5, 2.6, 2.8, 2.12, 16.2_

- [ ] 2.3 (P) 対象年の判定の規則を作る
  - 先に、単体テストで、決済期限日の前日と当日のWeek優勝、開催しなかった前年(行が無く組み合わせ決定の時刻を過ぎた年)を飛ばして今年の対象になること(初年度)、凍結済みの年への遅れ、1月初旬の決勝日(決済期限日が前年の12月)、前年の決勝日が設定されていると扱う条件を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearTargetRules_
  - _Depends: 2.1_
  - _Requirements: 3.4, 3.5, 3.6, 3.9, 16.2_

- [ ] 2.4 (P) 参加数の上限の規則を作り、共用の並びでYearトーナメント規則の例を確かめる
  - 先に、単体テストで、上限の64件と65件でWeek優勝の日時が最も古い1件が外れること、同時刻の識別子の順、Yearトーナメント規則のN = 13の例(シードP2・P7・P11、1回戦P1×P3・P4×P5・P6×P8・P9×P10・P12×P13)を1.3の共用の並びとtournament-weekの組み合わせの規則で再現すること、同日のローンチの同順、Upvote数0の末尾を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearCapacity_
  - _Depends: 1.3_
  - _Requirements: 6.5, 7.4, 7.5, 7.10, 16.2_

- [ ] 2.5 (P) 参加の枠の状態と返金の理由・返金の状態・依頼キーの規則を作る
  - 先に、単体テストで、終わっていない状態が受付中と参加資格の2つであること、喪失は返金の理由「entitlement_lost」、停止は「entitlement_suspended」、上限は「capacity_exceeded」になり依頼キーが`tournament-year:<購入ID>:<理由>`になること、返金の状態が6つ(`already_refunded`・`rejected`を含む)であること、参加資格を得た状態が特典の終了で戻らないことを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearEntryRules_
  - _Requirements: 5.6, 5.8, 6.7, 9.5_

- [ ] 3. Yearの部品
- [ ] 3.1 年のトーナメントのストアと、Yearの部品の契約と識別子を作る
  - Yearの部品の契約と型(`NewYearEntry`・`YearAwardedProduct`を含む。`YearEntryOfferPolicy`・`YearEntryFulfillment`はpaymentsの契約を実装するため除く)を純粋な部品(`apps/backend-lib/core/year-tournament/ports.ts`)に、Yearの全部品のDIの識別子`YEAR_TOURNAMENT_TYPES`を`core/year-tournament/identifiers.ts`にここで作る。api・eventとdata-exportのapplication層が契約と識別子を読み込むため、`workers`に置かない。年のストアのD1の実装は`workers/year-tournament/d1-year-tournament-store.ts`に作る(3.2〜3.4の枠のストアは`d1-year-entry-store.ts`)。束縛と登録は3.16でまとめて行い、3.2〜3.15は束縛と登録のファイルを変えない(テストは部品を直接組み立てる)
  - 先に、ローカルD1のWorkers統合テストで、年の行の用意の重複の無視(既定の日の列)、複数の年の読み取り、組み合わせ決定の時刻が到来した年の一覧、凍結の1回だけの成功、組み合わせの記録(参加0・1の終了と受賞の日時を含む)、終了の記録が1回だけ、凍結済みの最新の決済期限日、受賞の日時の範囲での受賞の読み取り(紐付けを解除した優勝の枠の除外)、プロダクトごとの受賞の読み取り(紐付けを解除した受賞の除外)を確かめる
  - 同じく先に、識別子`YEAR_TOURNAMENT_TYPES`が`Symbol.for('year-tournament.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - 完了状態: 単体テストとWorkers統合テストが成功し、`core/year-tournament`が`core/week-tournament`・`workers`・`apps/db`を読み込まない
  - _Depends: 1.8, 2.5_
  - _Requirements: 7.2, 9.4_

- [ ] 3.2 参加の枠のストアの挿入と引き当てを作る
  - 先に、ローカルD1のWorkers統合テストで、Week優勝からの挿入の重複の無視、凍結済みの年の決済期限日がWeek優勝の日より後なら期限切れ(遅れ)で挿入されること、Week優勝とローンチからの引き当て(90件を超える入力の分割)、対象の候補の一覧(決済期限日より前の終わっていない枠だけ)を確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 3.3, 3.4, 3.7_

- [ ] 3.3 参加資格を変える書き込み(Ultrasによる付与・喪失・分類・上限)と凍結の条件をストアに加える
  - 先に、Workers統合テストで、Ultrasによる付与の条件付きの更新、プロダクト・投稿者ごとの喪失と返金待ちの記録(購入の有無)、分類と終えた年の記録、上限を超えた枠の除外と返金待ち、凍結の後にその年の決済期限日より前の枠への付与・喪失が何もしないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 5.2, 6.1, 6.4, 6.5, 7.11_

- [ ] 3.4 返金と知らせの状態・物理削除をストアに加える
  - 3.1で作った枠のストアの契約を、3.2〜3.4で実装に順に加える。契約の全メソッドが揃う本タスクの完了時に、backend-libの型検査を通す
  - 先に、Workers統合テストで、返金待ち・知らせ待ちの一覧(最後の更新から一定の時間が経った枠だけ)と状態の更新、拒否による返金待ちの終わり方(`not_needed`・`already_refunded`・`rejected`、返金待ちの条件付きで知らせを待ちにしない)、物理削除での組み合わせに入った枠の紐付けの解除とそれ以外の枠の削除を確かめる
  - 完了状態: Workers統合テストが成功し、backend-libの型検査が通る
  - _Requirements: 6.8, 15.4_

- [ ] 3.5 年の照会と対象年の判定の部品を作る
  - 先に、ローカルD1のWorkers統合テストで、行のある年(列の値)と行の無い年(既定の日、組み合わせ決定の時刻の前後で開催予定と開催しなかった年)の照会、照会が行を作らないこと、次に開催する年の行の用意、Week優勝の日からの対象年(初年度の繰り越し・遅れ・組み合わせ決定の途中の年)、行の決勝日の列を書き換えた後に対象年と期限が変わること、凍結済みの最新の年の決済期限日からの期間の起点を確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 1.1, 1.3, 3.4, 3.5, 3.6, 3.8, 3.9_

- [ ] 3.6 Week優勝から参加の枠を作る部品を作る
  - 先に、Workers統合テスト(Week優勝の照会・マッチの照会・特典の判定は偽物)で、Week優勝ごとの枠の作成と既存の枠の除外(WeekトーナメントのIDで引き当てる)、週の識別子をWeek優勝の週の初日から求めること、予選勝利時のUpvote数・最終Upvote時間・ローンチ日の写し、Week優勝の時点でUltrasの期間内なら参加資格(Ultras)で作ること、予選が見つからない枠を作らず`captureEvent`されること、凍結済みの年へ遅れて届いた枠が期限切れになり`captureEvent`されること、同じ取り込みの2回で枠が1つであることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 3.1, 3.2, 3.3, 3.7, 5.1_

- [ ] 3.7 購入種別`year_tournament_entry`の可否と購入の内容を作る
  - 先に、Workers統合テスト(特典の判定・価格は偽物)で、投稿者以外・資格を得た枠・期限切れ・資格を失った枠・凍結後・表示できないプロダクト・Ultrasの期間内の拒否のコードと文言(コードごとの文言の一覧を同じファイルに置き、apiの表示層も読み込める唯一の出どころにする)、購入の内容(価格の`lookup_key`・数量1・関係のID・二重決済の鍵・受付期限23:00と決済期限23:35と反映の期限23:45・品名と分量と提供時期と追加事項)、行の無い年でも照会が行を作らないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 4.1, 4.3, 4.4_

- [ ] 3.8 参加資格の付与(フルフィルメント)の判断と文を作る
  - 先に、Workers統合テストで、受付中の枠への付与の文と購入の記録、資格を得た枠・論理削除済みのプロダクト・投稿者の不一致の拒否、決済期限23:34の反映は新しいローンチがあっても付与し23:35以後の反映は新しいローンチがあれば拒否すること(仮6)、返した文を凍結の後に一括の書き込みで実行するとNOT NULL制約の違反で失敗すること、決済済みの枠がUltrasの加入で変わらないことを確かめる(paymentsの反映の経路の確認は3.16)
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 4.5, 4.7, 4.8, 5.6, 16.3_

- [ ] 3.9 (P) 通知イベントの組み立てと発行を作る
  - 発行は1.4の違反を除いた発行の共用の部品で行う
  - 先に、Workers統合テスト(発行の口は偽物、ローカルD1にmatch-engineのテーブルを含む)で、確定したマッチの結果と側が2つの予告の発行、その夜の一括の発行(その業務日付の確定したYearのマッチの結果・翌日の側が2つで開始前のマッチの予告・当日の0:00から発行の時刻までに受賞を記録した年の受賞)、前年12月の組み合わせ決定の夜の参加1の受賞と翌年へ遅れた受賞が拾われること、紐付けを解除した優勝の枠を除くこと、Yearのマッチが無い夜は何も発行しないこと、受賞を`product_of_the_year`と対象年で発行すること、開始済みの予告が1件混ざっても残りが発行されること、同じ発行を2回行っても結果が変わらないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Boundary: YearNotificationPublisher_
  - _Depends: 1.4, 3.1_
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ] 3.10 (P) 返金の知らせのメール種別とテンプレートを作る
  - 種別はメール種別のドメインごとの置き場所(`core/email/kinds/tournament-year.ts`)に、テンプレートはeventのドメインごとのディレクトリ(`templates/tournament-year/`)に置き、それぞれの集約点へ同じタスクで加える(1対1の検査。eventのテンプレートの集約点への追記を含む明示の横断)。メール種別の集約の一覧を確かめる既存の単体テストを書き換える
  - 先に、種別の入力のスキーマの単体テストと、テンプレートのWorkers統合テスト(email-deliveryの規約の`*.worker.test.tsx`)で、件名・宛名・対象年・Week優勝の週の表記・3つの理由の文言・決済履歴への導線と、決済の詳細を含めないことを確かめる
  - 完了状態: 単体テスト・テンプレートのテストと、種別とテンプレートの1対1の検査が成功する
  - _Boundary: YearEmailKinds、YearEntryRefundTemplate_
  - _Depends: 2.5_
  - _Requirements: 6.9_

- [ ] 3.11 返金の依頼と知らせの部品を作る
  - 拒否の写像は1.3の共用の規則を使う
  - 先に、Workers統合テスト(返金の部品とメールの送信は偽物)で、返金待ちの枠の依頼(全額・理由・依頼キー)、受け付けと重複で依頼済みにして知らせ待ちにすること、拒否の5つのコードで返金不要・返金済み・拒否のいずれかで終え知らせを送らないこと、返金済みと拒否と理由の形式違反で運用者へ知らせ再処理の対象から外すこと、知らせの送信と退会済み・紐付けを解除した枠の`skipped`、1件の失敗で残りの枠を止めず最後に失敗を投げること(複数なら`AggregateError`)、一時的な失敗で状態が変わらないこと、ログとエラートラッキングに購入と枠の識別だけが出ることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 1.3, 3.4, 3.10_
  - _Requirements: 6.2, 6.6, 6.8, 6.9, 6.10, 15.6_

- [ ] 3.12 Yearのラウンドの進行と、発行の後の終了の記録を作る
  - 進行の後処理は、結果と予告の発行→優勝の枠を読み直して受賞の発行→終了の記録の順にし、記録を最後に置く(G1)
  - 先に、ローカルD1(match-engineとtournament-weekのテーブルを含む)のWorkers統合テストで、進行中の年を決勝日からの方針で進めて結果と予告を発行すること、終えたときに予告を発行しないこと、隣接するマッチの両者敗北による不戦勝の連鎖と段階の記録、同じ年を2回続けて・同時に進めても次ラウンドのマッチが1組になること、0:00を過ぎた進行でラウンドが1日遅れ`captureEvent`されること、決勝の確定・残り1で受賞を発行した後に終了が1回だけ記録されること、受賞の発行が失敗したら年が進行中のまま残り再実行で発行と記録が1回ずつになること、受賞なしの記録、進行中の全ての年を進め1つの失敗が他を止めないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 3.1, 3.9_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 9.1, 9.2, 9.3, 9.4, 14.1, 14.2, 14.3_

- [ ] 3.13 組み合わせ決定の前半(枠の補完・凍結・分類・上限)を作る
  - 先に、Workers統合テスト(特典の判定は偽物)で、Week優勝の枠の補完、23:44には対象にならず23:45で対象になること、凍結の条件付きの記録と凍結済みからの再開、分類(可視は組み合わせの対象、非公開化・停止は除外と返金待ち、論理削除済みは喪失と返金待ち、受付中でUltrasの期間内は参加資格、それ以外は期限切れ)、65件の参加で最も古いWeek優勝の1件が上限で除外され返金待ちになること、初年度に開催しなかった前年の枠が対象に含まれること、凍結と同時の削除・Ultrasの加入・反映・Week優勝の取り込みで分類の対象が変わらないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 2.4, 3.3, 3.5, 3.6_
  - _Requirements: 3.5, 5.5, 6.4, 6.5, 7.2, 7.11, 16.3_

- [ ] 3.14 組み合わせ決定の後半(組み合わせ・記録・後処理)を作る
  - 並びは1.3の共用の並びをtournament-weekの組み合わせの部品へ渡す
  - 先に、Workers統合テストで、参加資格のプロダクトでの組み合わせとtournament-weekの部品による1回戦の予定(N = 13で決勝日の3日前、参加2で決勝日、各マッチは実施日の0:00開始・23:40終了)、組み合わせ決定から1回戦までの日にマッチが無いこと、参加1で結果を記録した後に受賞が発行されること、参加0の終了、返金の依頼と知らせ・予告の発行、年ごとの失敗が他の年を止めないこと、ログとエラートラッキングの出力にプロダクトの名称・メールアドレス・ハンドルが含まれず識別と件数だけであることを確かめる
  - 完了状態: Workers統合テストが成功し、23:45の実行に相当する呼び出しで1回戦の予定がmatch-engineのテーブルに作られる
  - _Depends: 3.11, 3.12_
  - _Requirements: 1.4, 1.5, 7.1, 7.3, 7.6, 7.7, 7.8, 7.9, 7.10, 8.10, 15.1, 15.6_

- [ ] 3.15 (P) 受賞のエクスポートの部品を作る
  - 先に、Workers統合テストで、ローンチごとの受賞(`product_of_the_year`と対象年)と、紐付けを解除した受賞と受賞の無いローンチの扱いを確かめる
  - 3.1の`core/year-tournament/ports.ts`の契約を満たすD1の実装を`workers/year-tournament/d1-year-award-export.ts`に作る
  - 完了状態: Workers統合テストが成功する
  - _Boundary: YearAwardExport_
  - _Depends: 3.1_
  - _Requirements: 15.5_

- [ ] 3.16 Yearの部品をapiとeventに束縛し、購入種別の登録の定数をpaymentsの登録口に加え、paymentsの反映の経路で確かめる
  - 3.1〜3.15の部品を、ストアは`@inject`、サービスは依存とアプリの名前を渡す束縛の形(tournament-weekと同じ)で処理単位に束縛するモジュールを作り、apiとeventの束縛の一覧へ同時に加える
  - 購入種別の登録の定数を本specの共有部品のディレクトリに作り、paymentsの購入種別の登録口がそれを読み込む(ultras-subscription・tournament-weekと同じ形)。登録口の一覧と登録の解決を確かめるpaymentsのモジュールのWorkers統合テストに本specの登録を加える
  - 登録と束縛の前に、tournament-weekの購入種別の登録(`WEEK_TOURNAMENT_PURCHASE_KIND_REGISTRATION`・`week_tournament_entry`)と共有モジュールを名前で参照する上流のテスト(paymentsのモジュール、tournament-weekの共有モジュールの決済の経路、apiとeventのモジュールの束縛の一覧など)を`git grep`で洗い出し、登録の一覧の完全一致を確かめるものを本specの登録を加えた形に書き換える(明示の横断)
  - paymentsの反映の経路の確認は、依存の方向を守るためapiのWorkers統合テストの環境(`composition`の`*.worker.test.ts`)に置く
  - 先に、Workers統合テスト(paymentsの反映の経路、Stripeは模擬応答)で、反映での参加資格の付与、同じ購入の重複の反映(ランディング・Webhook・突合)で付与が1回、凍結と同時の反映が拒否と自動返金になること、資格を得た枠への2件目の決済が拒否されることを確かめる
  - 完了状態: apiとeventのWorkers統合テストの全件(書き換えた上流のテストを含む)・購入種別の集約点の全定義の検証の単体テスト・3経路のDIの解決の検査が成功する
  - _Requirements: 4.5, 4.6, 4.7, 4.9, 15.2, 16.3_

- [ ] 4. イベントサーバーの処理
- [ ] 4.1 eventの識別子と、確定のマッチイベントの2つの処理を作る
  - eventの8つの処理のDIの識別子をここで作る(束縛と登録は4.5)
  - 先に、単体テスト(部品は偽物)で、Weekのマッチの確定で直近8日のWeek優勝の取り込みを呼ぶこと、Yearのマッチの確定でその年を進め結果の反映(発行と終了の記録)を行うこと、種別の違うマッチと本specの年に無いブラケットを無視すること、例外を再試行に任せることを確かめる
  - Yearとブラケットの部品は`core/year-tournament`・`core/tournament`の契約と識別子で受け取る
  - 完了状態: 単体テストが成功し、静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 3.16_
  - _Requirements: 3.1, 8.2_

- [ ] 4.2 参加資格の喪失と物理削除の3つの処理を作る
  - 4.1の識別子を使うため(P)にしない
  - 先に、単体テスト(部品は偽物)で、削除で枠の喪失・ローンチの未完了の決済の失効(残りがあれば続き)・返金待ちの処理を行うこと、退会で喪失と返金待ちの処理を行うこと、凍結の後は喪失が0件で返金待ちだけを処理すること、物理削除で紐付けの解除と削除を行うことを確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 6.1, 6.2, 6.3, 15.4_

- [ ] 4.3 (P) Ultrasの加入が有効になった知らせの2つの処理を作る
  - 先に、単体テスト(部品は偽物)で、Week優勝の後で決済期限より前の加入で受付中の枠に参加資格を与えること、Week優勝より前・決済期限の後の加入では与えないこと、未完了の参加費の決済を残りが無くなるまで最大5回失効させ残れば例外にすること、同じ知らせの2回の処理で結果が変わらないことを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearUltrasEntryExemptionHandler、YearOpenEntryCheckoutExpiryHandler_
  - _Depends: 4.1_
  - _Requirements: 5.2, 5.3, 5.4, 5.7_

- [ ] 4.4 (P) Week決勝の勝利の結果通知への追記を作る
  - 先に、単体テスト(部品は偽物)で、Ultrasの免除の追記、受付中の決済期限(UTCの表記の受付期限)と対象年と決勝日と参加の導線の追記、プロダクトが見えないときの導線の省略、Week優勝でない勝利・敗北・期限後・資格を失った枠で追記しないこと、追記の長さの上限を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearEntrySupplementProvider_
  - _Depends: 4.1_
  - _Requirements: 14.6_

- [ ] 4.5 eventの処理を束縛し、5つの登録口に加える
  - 4.1〜4.4の処理を処理単位で束縛するモジュールを作り、eventの束縛の一覧へ加える
  - マッチイベントの登録口に2件(Week 1700・Year 1710)、プロダクトのライフサイクルの登録口に2件(`deleted`・`purge_due`、1700)、ユーザーのライフサイクルの登録口に1件(`withdrawn`、1700)、Ultrasの知らせの登録口に2件(1700・1710)、結果通知の追記の登録口に1件(`week`、1700)を加える
  - 登録の前に、5つの登録口とtournament-weekの登録を名前で参照する上流のテスト(eventのUltras・notifications・payments・マッチ・プロダクト・identity・engagement・directory-discoveryのモジュールのWorkers統合テスト、登録口の単体テスト)を`git grep`で洗い出し、登録の一覧の完全一致を確かめるものを本specの登録を加えた形に書き換える(明示の横断)
  - 完了状態: eventのWorkers統合テストの全件(名前を参照せずに振る舞いで影響を受けるテストを含む)、各登録口の検証(名前・同じ種類での`order`の重複)の単体テストと書き換えた上流のテスト、eventの`queue`の経路で8つの処理の識別子が解決できる検査が成功する
  - _Depends: 4.2, 4.3, 4.4_
  - _Requirements: 3.1, 5.2, 6.1, 14.6, 15.2, 15.4_

- [ ] 5. APIサーバー
- [ ] 5.1 apiの識別子、ジョブの失敗の通知のポート、2つのジョブ(23:45の夜の処理と夜の送り出しの準備の完了の通知、4:21の再処理)を作る
  - apiの全部品(ジョブ・失敗の通知・供給元・照会・決済の開始・決勝実施日)のDIの識別子をここで作る(束縛と登録は5.11)
  - apiのapplication層のポート(ジョブの失敗の通知と、5.6・5.7が使う決勝実施日の書き込み)をここで作る。ジョブの失敗は、そのポート(失敗した段・年・件数だけを持つ)越しに知らせ、Sentryを直接呼ばない(tournament-weekと同じ形)
  - 23:45の`tournament-year.evening-bracket`(1700)は毎晩、次に開催する年の行の用意とWeek優勝の取り込み→組み合わせ決定→進行(未処理の確定のマッチへの追いつき)→時計を読み直した時刻までのその夜の一括の発行→`EveningDispatchGate.markReady({ participant: 'tournament-year.evening-bracket', date: context.business.date, at: clock.now() })`の順に行う
  - 先に、単体テスト(部品と送り出しの入口とポートは偽物)で、5段の順序、組み合わせも進行も無い夜も`markReady`を最後に1回呼ぶこと、`date`がジョブの予定時刻の業務日付であること、一括の発行の時刻が進行の後に読み直した時刻であること、どの段が失敗しても残りの段を続けてポートへ知らせ`markReady`を呼ばずに例外になること、`markReady`の戻り値(`waiting`・`dispatch-requested`・`already-requested`)で処理が変わらないこと、`EveningDispatchError`が例外として伝わること、4:21の返金と知らせの再処理(10分以上前・100件)とその失敗の知らせを確かめる
  - Yearとブラケットの部品は`core/year-tournament`・`core/tournament`の契約と識別子で受け取る
  - 完了状態: 単体テストが成功し、静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Depends: 3.16_
  - _Requirements: 3.1, 6.8, 7.1, 8.2, 14.7, 15.3, 15.6, 15.7_

- [ ] 5.2 (P) ジョブの失敗の通知のSentryの実装を作る
  - 先に、Workers統合テストで、夜の処理と再処理の失敗の知らせがログとエラートラッキング(`logentry`と`fingerprint`の規約)に識別と件数だけで出て、個人情報を含まないことを確かめる(tournament-weekの実装と同じ形)
  - 完了状態: Workers統合テストが成功する
  - _Boundary: YearTournamentIncidentReporter_
  - _Depends: 5.1_
  - _Requirements: 15.6, 15.7_

- [ ] 5.3 (P) 再ローンチの禁止と編集の固定の2つの供給元を作る
  - 先に、単体テスト(ストアと照会は偽物)で、受付中の枠の決済期限の前後(解除の日時、年の行の保存した期限)、枠の作成前のWeek優勝の禁止、参加資格を得た枠・勝ち残りの枠・組み合わせ決定の途中の枠の禁止、期限切れ・喪失・除外・敗退・優勝で返さないこと、決勝日の変更後の解除の日時、勝ち残りと凍結後の固定、1回の呼び出しで読み取りが一括であることを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearRelaunchConditionSource、YearProductLockSource_
  - _Depends: 5.1_
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

- [ ] 5.4 (P) ローンチの要約の供給元を作る
  - 先に、単体テスト(ストアと照会は偽物)で、要約の6つの文言(優勝・マッチ中・進出・敗退・参加決定・参加受付中)とrank(60〜100)、勝ち残りと敗退のラウンドをブラケットの参加者の状態とローンチの直近のYearのマッチから求めること、該当しない枠で返さないこと、受賞がプロダクトのIDと対象年の表記を持つこと、1回の呼び出しで読み取りが一括であることを確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearLaunchSummarySource_
  - _Depends: 5.1_
  - _Requirements: 12.8_

- [ ] 5.5 (P) トロフィーの供給元を作る
  - 先に、単体テスト(ストアは偽物)で、受賞ごとの対象年の表記・受賞日・ブラケットへのパスと、受賞の無いプロダクトの空を確かめる
  - 登録口(tournament-weekの所有)への追加と束縛は5.11で行う
  - 完了状態: 単体テストが成功する
  - _Boundary: YearTrophySource_
  - _Depends: 5.1_
  - _Requirements: 12.7_

- [ ] 5.6 (P) 決勝実施日の照会と保存のユースケースを作る
  - 先に、単体テスト(年の照会・書き込み・監査は偽物)で、現在の年と翌年の表示(実効の日・出どころ・期限・変更の可否・候補・前年と翌年・注意)、照会の前の次に開催する年の行の用意、拒否の理由の返し方、監査ログの準備(操作種別・対象・詳細・任意の理由)、書き込みの`locked`と`version_conflict`の変換を確かめる
  - 完了状態: 単体テストが成功する
  - _Boundary: YearFinalDateService_
  - _Depends: 5.1_
  - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7, 2.8, 2.12_

- [ ] 5.7 決勝実施日の保存の書き込みを作る
  - 先に、ローカルD1のWorkers統合テストで、保存と期限の列の書き直しと監査ログの一体の確定、行の無い年の保存(行の用意を含む)、版の不一致・変更期限の決勝日の8日前の23:59は保存でき7日前の0:00は`locked`・凍結済みの`locked`で監査ログも残らないこと、保存の後に対象年の判定と期限が新しい列から求まることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 1.3, 2.7, 2.10, 2.11, 3.8, 16.3_

- [ ] 5.8 トップページの区画の照会を作る
  - 先に、単体テスト(マッチの照会とブラケットのストアは偽物)で、その日のYearのマッチの年ごとの行・ラウンド名・実際の決勝日・決勝の判定、年の行の無いブラケットの除外、マッチが無い日の空、読み取りがマッチの数に比例しない回数であることを確かめる(マッチの表示のまとめた読み取りとD1での確認は5.12のリゾルバとそのWorkers統合テストで行う)
  - 完了状態: 単体テストが成功する
  - _Requirements: 10.1, 10.2, 10.5, 10.7, 15.8_

- [ ] 5.9 ブラケットのページの照会を作る
  - tournament-weekの純粋な関数`buildBracketRoundsView`(DIに束縛しない)を直接呼び、優勝のプロダクトは優勝の参加者のプロダクトを表示できるプロダクトの照会から作る(tournament-weekの`WeekBracketReader`と同じ)
  - 先に、ローカルD1のWorkers統合テストで、記録済みのマッチと未来の枠・シードの番号・最初のマッチの予定が作られる前のシードの「シード<n>」(プロダクトを出さない)・優勝のプロダクト(表示できなければ無し)、受賞した年で優勝のプロダクトが非公開化・論理削除・投稿者の停止で表示できないときに優勝のプロダクトが無く受賞の結果(`outcome`の`awarded`)が残ること、終了した年で優勝の番号が無いときに優勝のプロダクトが無く年の状態が終了で受賞なしであること、4桁でない年・行の無い年・未決定の年の未定義、マッチの表示の読み取りが90件ずつまとめて行われることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6, 15.8_

- [ ] 5.10 参加費の導線の照会と決済の開始を作る
  - 先に、単体テスト(部品は偽物)で、本人でないプロダクトと枠の無いプロダクトの`null`、直近のローンチの枠、終わっていない枠の対象年と終えた枠の年、免除の判定(Ultrasの出どころと受付中の期間内)、価格の取得の失敗での縮退、勝ち残り・敗退・優勝の進行(ブラケットの参加者の状態と、勝ち残りの記録でもローンチの直近のYearのマッチが終了し負けていれば敗退)、返金の対象(購入があり返金待ちか依頼済み)、決済の開始が購入種別`year_tournament_entry`とローンチのIDで決済の開始の部品を呼ぶことを確かめる
  - 完了状態: 単体テストが成功する
  - _Requirements: 4.1, 4.10, 12.1, 12.2, 12.3, 12.5_

- [ ] 5.11 apiの部品を束縛し、ジョブ・判定の供給元・トロフィーの供給元・夜の送り出しの前提の登録口に加える
  - 5.1〜5.10の部品を処理単位で束縛するモジュールを作り、apiの束縛の一覧へ加える
  - ジョブの集約点に2件(23:45の1700、4:21の1700)、判定の供給元の登録口に3件(1700)、トロフィーの供給元の登録口に1件(10)、夜の送り出しの前提の登録口(`EVENING_DISPATCH_PARTICIPANTS`)に`tournament-year.evening-bracket`の1行を加える
  - 登録の前に、4つの登録口とtournament-weekの登録を名前で参照する上流のテスト(夜の送り出しの前提の一覧の完全一致、判定の供給元・トロフィーの供給元の登録口の単体テスト、ジョブの一覧を確かめる`apps/api/test/config`の単体テスト、notifications・プロダクト・検索のモジュールのWorkers統合テストなど)を`git grep`で洗い出し、本specの登録を加えた形に書き換える(明示の横断)
  - 完了状態: apiのWorkers統合テストの全件(夜の送り出しの前提の数で振る舞いが変わる通知のジョブのテストを含む)、Cronの式の一致と同じ時刻の`order`の重複の検査、供給元の名前の検証、夜の送り出しの前提の名前の検証(`assertEveningDispatchParticipants`)と書き換えた上流のテスト、apiの`fetch`と`scheduled`の経路で全識別子が解決できる検査が成功する
  - _Depends: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_
  - _Requirements: 12.7, 12.8, 13.1, 13.5, 14.7, 15.2, 15.3_

- [ ] 5.12 GraphQLのスキーマモジュールの照会(トップページ・ブラケット)を作り、スキーマの集約点に加える
  - ルート型は`extend`を使わず`type Query { ... }`・`type Mutation { ... }`で書く(api-gatewayのスキーマモジュールの規約)
  - 先に、Workers統合テストで、トップページの区画のマッチの表示のまとめた読み取り、対戦カードと不戦勝の分け方(match-engineの不戦勝の分類を使い、開始時点の相手の不戦敗を不戦勝に含め両者の不戦敗を描かない)とブラケットへのパス、ブラケットの非公開のプロダクトの表示と優勝のプロダクトと未決定の`null`、`YearTournamentSummary.awarded`(受賞は真・受賞なしは偽・終了前はnull、優勝のプロダクトが表示できない年は`champion`がnullで`awarded`が真。tournament-weekの`WeekTournamentSummary.awarded`と同じ規則)、tournament-weekの`BracketRound`の型を参照して再定義せず、`rounds`には`buildBracketRoundsView`の結果の`rounds`を、`participantCount`・`seedCount`には同じ結果の値をそのまま返してtournament-weekのリゾルバで解決されること、入力の形式違反が`validation_error`になることを確かめる
  - 完了状態: Workers統合テストが成功し、スキーマの集約点の検証を通り、apiのスキーマの生成(6.1のclientの型の生成が読む)が成功する
  - _Depends: 5.11_
  - _Requirements: 10.1, 10.2, 10.4, 11.3, 11.4, 11.6, 15.8_

- [ ] 5.13 GraphQLの参加費の導線と決済の開始の操作を加える
  - ルート型は`extend`を使わず`type Query { ... }`・`type Mutation { ... }`で書く(5.12と同じapi-gatewayの規約)
  - 決済の開始の拒否の文言は3.7の購入の可否の口の文言の一覧から読み込む(唯一の出どころ)
  - 先に、Workers統合テストで、未ログインの拒否、本人だけの参加費の導線と返金の対象の表示、決済の開始の成功と5つの`year_entry_*`のエラー(文言が購入の可否の口と一致)、受付期限22:59の開始は受け付け23:00は`checkout_closed`になること(paymentsの`CheckoutStarter`の経路、Stripeは模擬応答)、`payments_unavailable`の伝わり方を確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 4.1, 4.2, 4.4, 12.1, 12.5, 16.3_

- [ ] 5.14 GraphQLの決勝実施日の照会と保存の操作を加える
  - ルート型は`extend`を使わず`type Query { ... }`・`type Mutation { ... }`で書く(5.12と同じapi-gatewayの規約)
  - 先に、Workers統合テストで、未ログインと管理者でない呼び出し元の拒否、`viewer`の照会と`moderator`の保存の拒否、最上位管理者の保存と監査ログ、拒否の理由ごとの`validation_error`、理由の500書記素の超過、`final_date_locked`と`version_conflict`、変更者のニックネーム(削除済みは無し)を確かめる
  - 完了状態: Workers統合テストが成功し、apiのスキーマの生成(7.1のadminの型の生成が読む)が成功する
  - _Requirements: 2.1, 2.7, 2.8, 2.9, 2.10, 2.11_

- [ ] 6. 利用者側の画面
- [ ] 6.1 本specの利用者側のGraphQLの操作・フラグメント・取得の補助を加え、型を生成して許可リストを再生成する
  - トップページの区画・ブラケット・参加費の導線の照会と決済の開始の操作を、clientの`src/graphql/operations/year-tournament/`に1ファイル1操作の`.graphql`で書く。操作名は`Client`で始め(`ClientYearTournamentBoard`・`ClientYearBracket`・`ClientMyYearEntry`・`ClientStartYearTournamentCheckout`)、`graphql()`を呼ばない
  - トップページの行のフラグメント`YearBoardRoundFields`を`src/graphql/fragments/year-tournament/`に置く(共用の部品が依存する決勝の印・対戦カード・不戦勝はWeekと同じ選択)。`ClientYearBracket`はtournament-weekのフラグメント`BracketRoundFields`(`rounds`)と`BracketMatchProductFields`(`champion`)を名前で展開し、`tournament`の`awarded`・`status`・`year`・`finalDate`と`participantCount`・`seedCount`を取得し、フラグメントを再定義しない
  - 取得と変更の補助(4つの照会と変更の`queryOptions`・`mutationOptions`)を、tournament-weekの補助と同じ形で作る
  - frontend-platformの「操作の追加手順」どおり、clientで`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行する。画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`と生成された型を読み、`gql.ts`・`index.ts`を読まない
  - 先に、取得の補助の単体テストで、照会のキーと変数・閲覧者の受け渡しを確かめる
  - 完了状態: 単体テスト、型の生成と許可リストの再生成が成功し、clientとapiの`graphql:check`とclientの`codegen.unit.test.ts`(操作名の接頭辞・1ファイル1操作)が通り、clientの型検査が通る
  - _Depends: 5.12, 5.13_
  - _Requirements: 10.1, 11.1, 12.1_

- [ ] 6.2 トップページのYearトーナメントの区画を作り、区画の登録口に加える
  - 6.1の生成物を使うため(P)にしない
  - 1.5の共用の部品へ、Yearの照会・行・差し替え・見出しの値・文言(「Product of the Yearトーナメント」)を渡す包みとして作る。不戦勝の一覧の文言はmatch-engineの`ByeCard`が提供するため実装しない
  - Yearのトップページ・決勝・ブラケットの文言(1.5の3つの型の値)と、6.2〜6.4のブラウザテストが使うYearのフィクスチャ(盤面・決勝・ブラケット)を、ここでまとめて作る。6.3・6.4はこれらのファイルを変えない
  - 共用のトップページの区画と決勝の部品のテストに、Yearの文言の例を加える
  - 先に、ブラウザテストで、見出し(「Product of the Yearトーナメント」・対象年・ラウンド名・決勝日・ブラケットへの通常のリンク)、対戦カードと`rel="noopener"`、不戦勝の一覧と早期勝利のUpvote数、マッチが無い日の非表示、取得の失敗の区画だけの縮退、自動更新の切り替えに従う取り直し、アクセシビリティの検査の違反が0件を確かめる
  - 登録口に`main` 10を加え、Week(20)・予選(30)より上に描かれることを、実際の登録を確かめる登録箇所のブラウザテスト(`top-page-sections.browser.test.ts`)で確かめる。登録の前に、トップページの区画の登録口を参照する上流のテストを検索で洗い出し、登録の一覧を完全一致で確かめるものを本specの登録を期待する形に書き換える(明示の横断)
  - 完了状態: ブラウザテスト(Yearの例を加えた共用の部品のテストを含む)と並びの単体テストと書き換えた上流のテストが成功する
  - _Depends: 1.5_
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8_

- [ ] 6.3 トップページのYearの決勝の演出の区画を作り、区画の登録口に加える
  - 6.2と同じ登録箇所へ追記するため(P)にしない
  - 本文の区画と同じ盤面を購読し、1.5の共用の決勝の部品へ6.2で作ったYearの文言を渡す。Yearの文言とフィクスチャのファイルは変えない
  - 先に、ブラウザテストで、決勝の全幅の表示、確定の後の受賞と受賞なしのYearの文言、視差効果を減らす設定で演出を止めること、アクセシビリティの検査の違反が0件を確かめる
  - 登録口に`showcase` 10を加える(並びの単体テスト`top-page-section-order.unit.test.ts`の`showcase`の期待は上流が先に用意している)。登録箇所のテスト(`top-page-sections.browser.test.ts`)の完全一致と位置の検査を、`tournament-year.final`を加えた形に書き換える(明示の横断)
  - 完了状態: ブラウザテストと並びの単体テストと書き換えた上流のテストが成功する
  - _Requirements: 10.5_

- [ ] 6.4 (P) Yearのブラケットのページを作る
  - 経路の`loader`・`head`(ページのheadの組み立てへの追記)・失敗と404の部品・経路の年ごとの作り直しを、tournament-weekの`/tournaments/week/$week`と同じ形で作り、本体は1.6の共用のページへYearの題名・参加数とシード数の表記・`BracketViewProps`(`awarded`は`yearBracket.tournament.awarded`(nullは偽)、`finished`は年の状態が終了か)を渡す
  - 共用のブラケットのページの部品のテストに、Yearの文言の例を加える
  - 先に、ブラウザテストで、見出し(対象年・決勝日・参加数とシード数)、共用の4部品への`BracketViewProps`の受け渡し(進行中・受賞・受賞なし、受賞したプロダクトが表示できない年で`champion`がnullかつ`awarded`が真になり「非公開のプロダクト」の受賞として描かれること、終了前の`awarded`のnullを偽として渡すこと)、開催中だけ自動更新がオンの間に取り直すこと、キーボードで全マッチをたどれること(列とタブの両方)、画面幅767pxと768pxでの表示の切り替え、4桁でない年と未決定の年の404、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功し、`/tournaments/year/<年>`をローカルで開ける
  - _Boundary: YearBracketPage_
  - _Depends: 1.6, 6.2_
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [ ] 6.5 (P) 参加費の導線を作る
  - Yearの照会の値を共用の入力へ写す関数(Ultrasの案内は偽・決済の開始を阻む理由は無し・返金の対象はサーバーの値・除外の理由は閉じた理由から)と、Yearの文言・秒読みを添えない指定・決済の開始の変更を1.7の共用の導線へ渡す部品を作る。Yearの参加費の導線の文言は本タスクで作り、6.2で作ったYearの文言(トップページ・決勝・ブラケット)とフィクスチャのファイルは変えない(導線の値は本タスクの別のフィクスチャのファイルに置く)
  - 共用の参加費の導線のモデルと部品のテストに、返金の対象がサーバーの値の例・上限による除外・秒読みを添えない例を加える
  - 先に、写しの関数の単体テストで全ての状態・理由・返金の対象・進行の組み合わせを確かめ、ブラウザテストで、受付中のボタン・参加費・期限(受付期限23:00の日時・相対表現、秒読みが無いこと)・対象年と決勝日とWeek優勝の週、押下で決済画面へ進むこと、免除の表示、価格の取得の失敗と決済サービスの障害の無効化と案内、押下の後の`checkout_closed`・`year_entry_*`のエラーの文言の表示、参加資格・組み合わせ・敗退・優勝・資格の喪失・期限切れ・除外(停止と上限の2つの理由)の状態と返金の旨、区画の取得の失敗の縮退、アクセシビリティの検査の違反が0件を確かめる
  - 登録箇所のファイルは変えない(6.6で登録する)
  - 完了状態: 単体テストとブラウザテストが成功する
  - _Boundary: YearEntryPanel、YearEntryView_
  - _Depends: 1.7, 6.2_
  - _Requirements: 4.2, 4.10, 12.1, 12.2, 12.3, 12.4, 12.5_

- [ ] 6.6 参加費の導線をプロダクト詳細と自分のプロダクトの画面へ、削除の注意書きを削除の確認へ登録する
  - 投稿者本人向けの操作と自分のプロダクトの画面の2つの包みと、削除の注意書きの部品を作る
  - 先に、ブラウザテストで、2つの包みが本体を描くこと、削除の注意書きが受付中と参加資格の枠のときだけ出ることを確かめる
  - 投稿者本人向けの操作の登録口(20)・自分のプロダクトの画面の登録口(20)・削除の注意書きの登録口(20)に加える。登録の前に、3つの登録口を参照する上流のテスト(プロダクト詳細と自分のプロダクトの区画の並び・登録口のブラウザテスト)を検索で洗い出し、登録の一覧を完全一致で確かめるものを本specの登録を期待する形に書き換える(明示の横断)
  - 完了状態: ブラウザテストと書き換えた上流のテストが成功する
  - _Depends: 6.5_
  - _Requirements: 12.1, 12.6_

- [ ] 7. 管理画面
- [ ] 7.1 本specの管理画面のGraphQLの操作を加え、型を生成して許可リストを再生成する
  - 決勝実施日の照会と保存の操作を、adminの`src/graphql/operations/year-tournament/`(G9)に1ファイル1操作の`.graphql`で書く。操作名は`Admin`で始め(`AdminYearFinalDateSettings`・`AdminUpdateYearFinalDate`)、`graphql()`を呼ばない
  - frontend-platformの「操作の追加手順」どおり、adminで`bun run graphql:generate`、apiで`bun run graphql:allowlist`を実行する。画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`と生成された型を読み、`gql.ts`・`index.ts`を読まない
  - 完了状態: 型の生成と許可リストの再生成が成功し、adminとapiの`graphql:check`とadminの`codegen.unit.test.ts`(操作名の接頭辞)が通り、adminの型検査が通る
  - _Depends: 5.14_
  - _Requirements: 2.1_

- [ ] 7.2 業務日付と拒否の理由の表記、年ごとのカードを作る
  - 7.1の生成物を使うため(P)にしない。部品はadminの`components/year-tournament/`に置く(G9)
  - 先に、表記の単体テストで、業務日付の曜日つきの表記(年またぎ)と拒否の理由ごとの文言と区画の題名を確かめる
  - 先に、ブラウザテストで、実効の決勝日の`<time datetime>`と出どころのバッジ・期限の表示・最後に変更した日時と管理者、最上位管理者でない場合と変更期限を過ぎた場合の参照だけの表示と理由、翌年の注意、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: 単体テストとブラウザテストが成功する
  - _Requirements: 2.1, 2.3, 2.12_

- [ ] 7.3 決勝実施日の選択と保存のフォームを作る
  - 先に、ブラウザテストで、候補の`<select>`(ラベル・既定の選択・候補が無いときの案内)、任意の理由の上限と注記、確認のダイアログの文(変更後の受付期限・組み合わせ決定・対象期間の変化)、保存の成功の通知、保存の失敗でダイアログが理由の入力を保ったまま`failureMessageOf`の文言を`role="alert"`で示すこと(拒否の理由・`final_date_locked`・`version_conflict`の案内と、それ以外の失敗で`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`の文言が出て問い合わせを促す文が出ないこと)、アクセシビリティの検査の違反が0件を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Requirements: 2.2, 2.11, 2.13_

- [ ] 7.4 決勝実施日の区画を作り、設定ページの区画の登録口に見出しと同じ`title`で加える
  - 先に、ブラウザテストで、見出しと説明と2年分のカードの表示、取得の失敗の縮退(`ErrorState`に`contactHref`を渡さず、問い合わせのボタンと問い合わせを促す文が出ず、文言は`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`)、設定ページの区画の並び(本specの10が機能フラグの20より上)を確かめる
  - 登録口に`tournament-year.final-date`(10)を、7.2の表記のファイルの題名の定数で加える。登録の前に、設定ページの区画の登録口を参照する上流のテストを検索で洗い出し、登録の一覧を完全一致で確かめるものを書き換える
  - 完了状態: ブラウザテストと書き換えた上流のテストが成功し、ローカルで最上位管理者が決勝実施日を保存すると監査ログの画面に記録が出る
  - _Requirements: 2.1_

- [ ] 8. 統合・ドキュメント・E2E
- [ ] 8.1 組み合わせ決定の日の時刻の連鎖の統合テストを作る
  - apiのWorkers統合テストの環境で行い、eventの確定のマッチイベントの処理の代わりに、それが呼ぶbackend-libの`YearProgressionService`・`YearEntryRegistrar`を直接呼ぶ(`apps/event`を読み込まない)
  - 先に、Workers統合テストで、23:35の決済期限・23:40の突合と確定・23:45のWeekの組み合わせと進行・Yearの夜の処理の順(paymentsの10、match-engineの1100、notificationsの1300、tournament-weekの`tournament-week.evening-bracket`の1500、本specの1700)で、突合で反映された決済が組み合わせに入り、反映の期限(23:45)の後の完了が組み合わせに入らないこと、同じ夜のWeek優勝が翌年の対象になること、1回戦の予告と準決勝以前の結果と翌日の予告が本specの`markReady`より前に発行されていること、Yearのジョブの`markReady`の後に夜の枠の送り出しが依頼され(tournament-weekも呼んだ場合)、Yearのジョブを失敗させた夜は`markReady`が無く23:55の期限まで依頼されないことを、notificationsの`EveningDispatchGate`の実装で確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 5.11_
  - _Requirements: 4.9, 7.2, 14.3, 14.7, 15.3, 16.3_

- [ ] 8.2 技術ドキュメントとオンボーディングを書く
  - `backend/019-anchor-date-schedules.md`を本プロジェクト固有の値を含めずに新しく書き、`backend/README.md`の文書一覧に加える
  - `frontend/012-business-date-calendar.md`に「サーバーが返す候補から選ばせる日付」の節を加え(G7)、`frontend/README.md`の`012`の行の説明を改める
  - 共用へ移した部品の名前と置き場所の記述を、`backend/016`・`backend/017`・`frontend/013`・`frontend/016`で改める(プレースホルダーの値は変えない)
  - `docs/onboardings/project-values.md`にジョブ・処理・登録の名前と`order`、価格の`lookup_key`、メール種別、返金の依頼キーの形、監査ログの操作種別を加える。`CLAUDE.md`の「技術規則の参照先」に`backend/019`の行を加え、`frontend/012`の行の見出しに候補から選ばせる日付を含める(編集が拒否された場合は、開発者が手で行えるよう報告する)
  - 完了状態: 文書が整形の検査を通り、技術ドキュメントに本プロジェクト名と固有の値が無いことと、共用へ移した部品と1.1で削った関数(`backend/017`のラウンドの実施日の節の翌日の関数を含む)の旧い名前が`docs/`に残っていないことを検索で確かめる
  - _Depends: 1.3, 1.4, 1.7_
  - _Requirements: 16.5, 16.6_

- [ ] 8.3 E2Eの補助を作る
  - admin-foundationの`executeLocalD1`(文字列は`sqlStringLiteral`)で次の補助を作り、流すSQLの組み立てを単体テスト付きの別のファイルに分ける(tournament-weekの補助と同じ形)
  - (a)確認済みで可視の利用者2人・可視のプロダクト2つ・予選で勝利したローンチ2つと、他のE2Eと重ならない過去の対象年(既存の`year < 2026`の最大+1、無ければ1001)の年の行(受付期限・決済期限・組み合わせ決定の列は現在より十分に未来、決済期限日は対象年の12月31日)と、その年のWeek優勝の枠2件(1件は受付中、1件はUltrasで参加資格)を作る。(b)年の行の3つの期限の列を現在より過去へ移す。(c)組み合わせで予定された決勝の実施日を今日に、開始の日時を過去・終了の日時を未来に移し、開始を記録済みにする。(d)決勝の終了の日時を過去へ移す。ジョブはbackend-platformの共用の補助`triggerScheduled({ worker: 'api', businessDate, businessTime })`に当日の業務日付と`23:40`・`23:45`を渡して動かし(ローカルの定期実行の起動を独自に作らない)、確定のイベントは実際の経路で届ける
  - 先に、SQLの組み立ての単体テストで、生成されるSQLと値のエスケープを確かめる
  - 完了状態: 単体テストが成功し、補助の関数を順に呼ぶ空のE2Eが成功し、ローカルD1に枠・組み合わせ・開始済みの決勝ができる
  - _Depends: 5.11_
  - _Requirements: 16.4_

- [ ] 8.4 参加費・組み合わせ・受賞のE2Eシナリオを作る
  - 画面の操作は手順のファイル(`year-tournament-steps.ts`)に置く
  - 順序: 受付中の枠の投稿者がプロダクト詳細ページから参加費をテストカードで支払う(paymentsのE2Eと同じく`stripe listen`の転送が要る)→参加資格を得た表示を待つ→補助(b)で期限を過去へ移す→23:40・23:45のジョブ(8.3のとおり`triggerScheduled`で起動)で組み合わせ(参加2で決勝だけ)→ブラケットのページに組み合わせが出ることを確かめる→補助(c)で決勝を今日の開始済みにする→トップページのYearの決勝の区画にマッチが出ることを確かめる→補助(d)で終了を過去へ移す→23:40・23:45のジョブで確定と進行→プロダクト詳細ページのトロフィーにProduct of the Yearが出ることを確かめる
  - 1.1で報告した価格の作成が済んでいなければ、本タスクを保留して開発者へ報告する
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 6.3, 6.4, 6.6, 8.3_
  - _Requirements: 16.4_

- [ ] 8.5 管理画面の決勝実施日のE2Eシナリオを作る
  - 画面の操作は手順のファイル(`year-final-date-steps.ts`)に置く
  - admin-foundationの`signInAsNewAdmin`で最上位管理者としてログインし、設定ページの翌年のカードで現在と違う候補を選び、確認して保存し、保存の通知と監査ログの画面の「Yearトーナメント決勝実施日の変更」を確かめる。`viewer`のロールの管理者では参照だけであることを確かめる
  - 翌年の行だけを変え、8.3の補助が作る過去の対象年と重ならないため、プロジェクトの依存による直列化は要らない
  - 完了状態: ローカルでE2Eが成功する
  - _Depends: 7.4_
  - _Requirements: 2.10, 16.4_

- [ ] 8.6 全体の検査とカバレッジを確かめる
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
