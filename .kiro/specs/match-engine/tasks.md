# Implementation Plan

- [ ] 1. 基盤: 共有の定義・テーブル・文言
- [x] 1.1 マッチの6テーブル・予選の勝利の部品を定義し、マイグレーションを作る
  - 前提: dev-tooling〜product-launchの17specの全タスクが完了していること(`users`とライフサイクルの登録口・`AccountGuard`・`LoginRequiredDialog`、product-launchの`ScheduledLaunchDirectory`・`LaunchOutcomeRecorder`・`ProductDirectory`・`visibleProducts()`・プロダクトライフサイクルの登録口、user-profile-socialの`PUBLIC_PROFILE_TABS`と`UserSummary`、frontend-platformの仮のトップページ・`useTurnstileToken`・状態表示、inquiry-chatの`LIVE_REFRESH_QUERY_OPTIONS`、paymentsの23:40のジョブ、E2Eの`e2e/support/mailpit.ts`・`e2e/support/local-d1.ts`)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、テーブルの定義の単体テストで、CHECK(種別・段階・決着・側の番号・結果・イベントの種類と状態・開始が終了より前)、部分一意索引(有効なUpvoteはマッチと利用者で1つ、予選の側のローンチは1つ)、一意索引(マッチと側の番号・マッチとイベントの種類・実施日のペアリング)、外部キー(`ON DELETE`の指定なし、投稿者のIDに外部キーが無いこと)を確かめる。ローカルD1のWorkers統合テストで、有効なUpvoteを同じマッチと利用者で2つ作れず論理削除の後は作れること(仮3)、同じローンチの予選の側を2つ作れないこと、予選の勝利の部品が勝利・不戦勝・相手の退会等による勝利の側だけを返し紐付けを解除した側を返さないことを確かめる
  - 作業量が3時間の上限に近いため、テーブルとマイグレーションを先に終え、予選の勝利の部品を最後に足す。bot対策の`action`はこのタスクで作らない(apiの定数は6.4、clientの写しは8.5が作る)。スキーマの集約点へ加え、mainの最新を取り込んでからマイグレーションを生成する
  - 完了状態: 単体テストとWorkers統合テストが成功し、マイグレーションをローカルに適用できる
  - _Requirements: 1.1, 1.2, 1.6, 6.2, 7.4, 12.7_

- [x] 1.2 (P) 予選ルール・ページ配置・文言規則に、本specの決定と画面と文言を先に書く
  - 予選ルール: 仮1(カテゴリ内・余り・横断・最後の不戦勝を無作為に組む)・仮2(最終Upvote時間の一致は先に記録されたUpvoteの側)・仮4(マッチ直前の両方の該当は両者敗北)・仮5(同じ投稿者の組を避けない)の決定(2026-10-24に開発者が確定)を加える
  - ページ配置: トップページの区画の構成と置き場所・後続specの区画の登録(Year 10・Week 20・予選30・広告・決勝の展示・一覧の差し込み)、予選の区画の空の状態(モックアップに従い他の区画とは違って表示する)、集計中の表示、自分のプロダクトの側はUpvote数だけでボタンを出さないこと、Upvote履歴の日付の小見出しの件数を記載する
  - 文言規則: 設計のError Handlingの表の文言と、状態・トースト(「Upvoteを取り消しました。」・「結果を集計しています」・不戦勝の説明(予選の2文とトーナメントの2文(仮7))・「非公開のプロダクト」・トップページの取得エラー・回数を限った取り直しの上限の案内「結果の反映に時間がかかっています。ページを再読み込みすると最新の状態を表示します。」・自動更新の切り替えの名前「自動更新」と説明「オンの間は{秒}秒ごとにUpvote数を取り直し、残り時間と演出を動かします。」(仮8))の文言を加える。ページ配置には、自動更新の切り替えを上部の行の先頭に1つ置き、オフの間は全ての区画の定期の取り直し・カウントダウンの毎秒の更新・演出を止めること(仮8、2026-11-10に開発者が確定)も記載する
  - 完了状態: 3つの文書が整形の検査を通り、6.3・6.4・8のタスクが参照する文言がすべて文言規則にあり、予選ルールに仮1・仮2・仮4・仮5の決定と確定の日付(2026-10-24)が、ページ配置と文言規則に仮8(2026-11-10)の切り替えの配置・止める範囲・文言が載っている
  - _Boundary: `docs/GUIDES/service/overview/003-qualifier-rules.md`・`docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md`_
  - _Requirements: 13.5_

- [ ] 2. 契約と共有部品
- [x] 2.1 マッチの状態・決着・ペアリングの純粋な規則を作る
  - 先に、単体テストで、状態の導出(開始の記録の前後・終了の日時の23:39:59と23:40・確定)、予選の開始と終了の日時(UTCの8:00と翌日7:40)、終了時の決着(予選ルールの判定の例: 12対9・7対7で14:02と18:30・0対0・3対0、最終Upvote時間が一致したときの記録の順(仮2))、開始時点の決着(不戦勝・一方の該当・両方の該当(仮4)・側1つの該当)、ペアリング(予選ルールの9個の例を決まった乱数で手順どおりに組むこと、偶数・1個・0個、同じ投稿者の組を避けないこと(仮5))、乱数の値の範囲と棄却法を確かめる
  - 業務時刻の計算はbackend-platformの部品を使い、データベースと実時間に依存させない
  - 完了状態: 単体テストが成功し、規則がD1を読み込まない
  - _Requirements: 1.3, 1.5, 2.2, 2.3, 2.4, 2.5, 2.6, 3.2, 3.3, 3.4, 4.2, 4.3, 4.4, 4.5, 13.2_

- [x] 2.2 マッチイベントの契約とメッセージ種別を作る
  - 2.1の種別の型を使うため、2.1の後に行う
  - 先に、単体テストで、処理の登録の検証(名前の形式違反・重複・同じ種類での`order`の重複の例外、`order`昇順の並び、種別の絞り込み)、再試行の方針の値、メッセージ種別の本文の検証(ULIDだけ)を確かめる
  - 結果の型と名前の検証はidentity-authの部品を再利用し、メッセージの契約を契約の一覧へ加える
  - 完了状態: 単体テストとメッセージ種別の重複の検査が成功する
  - _Requirements: 11.1, 11.2, 11.6_

- [x] 2.3 マッチとサポーターの照会を作る
  - 先に、ローカルD1のWorkers統合テストで、指定したマッチ・実施日と種別・ローンチの一覧の照会が側・集計値・最終Upvote時間(開始からの経過)・該当・結果・照会の時点の状態を返し、90件を超えるIDを分けて読むこと、確定した予選の結果の照会、日ごとの集計(開始した2つの側の予選の数と確定したUpvote数の合計)、サポーターの照会がUpvoteの日時の早い順に20件ずつで論理削除と退会・停止中の利用者を除き、結果が確定していないマッチの側には空を返すことを確かめる
  - 同じく先に、識別子`MATCH_PLATFORM_TYPES`が`Symbol.for('match.<名前>')`の値を持ち凍結されていることを単体テストで確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - 照会・予定の作成・イベントの記録と送信・エクスポートの全部品の契約と型を純粋な部品(`apps/backend-lib/core/match/ports.ts`)に、DIの識別子`MATCH_PLATFORM_TYPES`を`core/match/identifiers.ts`に一括で作り、照会のD1の実装を共有のWorkers向けの部品(`apps/backend-lib/workers/match/d1-match-directory.ts`)に作る(2.4・2.5は契約と識別子を作らず、束縛は2.6が行う)。api・eventと後続specのapplication層が契約と識別子を読み込むため、契約と識別子を`workers`に置かない
  - 完了状態: 単体テストとWorkers統合テストが成功し、後続specが本specのテーブルを読まずにマッチとサポーターを得られる。`core/match`が`workers`・`apps/db`を読み込まない
  - _Depends: 1.1_
  - _Requirements: 1.3, 12.2, 12.3, 12.4, 12.6_

- [x] 2.4 マッチの予定の作成と、イベントの記録・送信を作る
  - 先に、ローカルD1のWorkers統合テストで、予定の作成がマッチ・側・予定のイベントを1つの一括の書き込みで確定し、同じマッチのIDと予選の同じローンチを2回渡しても重複しないこと、確定の後にイベントを送ること、イベントの記録のストアの全操作(同じマッチの最も古い`pending`・完了した処理の記録の重複の無視・確定済みで確定のイベントが無いマッチへの作成を2回行っても1件・滞ったイベントの一覧と送り直しの回数・完了から一定期間の削除)、送信の失敗がイベントを`pending`のまま残しIDだけをログに出すこと、送信が6件までを並行して行い一部の失敗で他の送信を止めないことを確かめる
  - 2.3の`core/match/ports.ts`の契約を満たすD1の実装(`workers/match/d1-match-scheduler.ts`・`d1-match-event-store.ts`)と、`PLATFORM_TYPES.MessagePublisher`で送る送信の実装(`workers/match/queue-match-event-dispatcher.ts`)を作る
  - 完了状態: Workers統合テストが成功し、トーナメントが同じ口で1つまたは2つの側のマッチを作れる
  - _Depends: 2.2, 2.3_
  - _Requirements: 1.4, 1.6, 5.5, 11.1, 11.3, 11.5_

- [x] 2.5 (P) データエクスポートの照会を作る
  - 先に、Workers統合テストで、ローンチごとのマッチの項目(種別・ラウンド・実施日・自分と相手の確定のUpvote数・最終Upvote時間・結果、不戦勝の相手は0)と、利用者の有効なUpvoteの項目(マッチ・種別・実施日・プロダクト(紐付けの解除はnull)・日時)を確かめる
  - 2.3の`core/match/ports.ts`の契約を満たすD1の実装を`workers/match/d1-match-export.ts`に作る
  - 完了状態: Workers統合テストが成功し、データエクスポートの文書の`launches.json`の`matches[]`と`upvotes.json`に対応する
  - _Boundary: MatchExport、UpvoteExport_
  - _Depends: 2.3_
  - _Requirements: 12.5_

- [x] 2.6 マッチの共有の束縛を作り、apiとeventに組み込む
  - 2.3〜2.5の照会・予定の作成・イベントの記録と送信・エクスポートを処理単位で束縛するモジュールを作り、apiとeventの束縛の一覧へ同時に加える
  - 完了状態: 3経路(api・eventの`fetch`・eventの`queue`)のDIの解決の検査が成功し、両アプリで照会を解決できる
  - _Requirements: 12.8_

- [ ] 3. APIサーバーのUpvote
- [x] 3.1 Upvoteの操作の決定と、予選の一覧の並びの規則を作る
  - 先に、単体テストで、追加・付け替え・変更なしの決定、閲覧者の制限の判定の順(受け付け中でない→未ログイン→停止中→未確認→自分のマッチ)、予選の一覧の並び(合計最大の1件が先頭・残りは合計の少ない順・同数はIDの昇順)、不戦勝の分類(対戦相手なし・開始時点の相手の該当・即時の終了)と両者の該当の除外、実施数(対戦カードと即時の終了)を確かめる
  - 完了状態: 単体テストが成功し、規則がデータベースに依存しない
  - _Requirements: 6.2, 6.3, 8.2, 8.11, 8.13_

- [x] 3.2 集計値の求め直し・Upvoteの条件・UpvoteのD1の実装を作る
  - 先に、ローカルD1のWorkers統合テストで、追加・付け替え・取り消しの後の側のUpvote数と最終Upvote時間と記録の順、時計を23:39:59から23:40へ進めた要求の取り消し、開始が記録されていないマッチ・確定したマッチの拒否、自分が投稿者の側を持つマッチの拒否、未確認・停止中の利用者の拒否、同じ利用者の同時の2つの追加で1つだけが残ること、取り消しの後と論理削除の後の再Upvote、確定の後に求め直しの文が値を変えないこと、閲覧者の有効なUpvoteの一括の照会を確かめる
  - apiのマッチのポートの定義のファイル(`application/match/ports.ts`)をこのタスクで作ってUpvoteStore・MatchBoardStoreだけを定義し(他のポートは5.1・5.2・5.3・6.2が自分の分を追記する)、Upvoteのストアと、閲覧者の有効なUpvoteを引くトップページのストア(`D1MatchBoardStore`)をD1で実装する(束縛は3.3・6.1が行う)
  - 求め直しの文と受け付け中の条件は、4.1の同期の処理からも使える部品にする
  - 完了状態: Workers統合テストが成功し、拒否された書き込みでどの行も変わらない。静的解析でapplication層に`**/lib/workers/**`の読み込みが無い(マッチの共有部品の契約と識別子は`core/match`から読み込む)
  - _Depends: 1.1_
  - _Requirements: 1.7, 4.10, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 6.9_

- [x] 3.3 Upvoteのユースケースを作り、apiのマッチのモジュールを作る
  - 先に、模擬のポートの単体テストで、Upvoteの判定の順(マッチの存在→側→受け付け中→自分のマッチ→決定→書き込み)、変更なしで書き込まないこと、重複を成功として扱うこと、拒否を読み直して分類すること、取り消しで有効なUpvoteが無い場合の成功と受け付け中でない場合の拒否を確かめる
  - apiのマッチのDIの識別子の一覧とモジュールをこのタスクで作って束縛の一覧へ加え、以後のapiのタスクは識別子と束縛をここへ加える
  - 完了状態: 単体テストとDIの解決の検査が成功し、ユースケースが利用者をセッションではなく引数で受け取る
  - _Depends: 2.6, 3.1, 3.2_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

- [ ] 4. APIサーバーの即時の終了
- [x] 4.1 即時の終了の文と、ユーザーの同期の処理を作る
  - 先に、ローカルD1のWorkers統合テストで、identity-authの停止の確定と同じ一括の書き込みでマッチ中のマッチへのUpvoteだけが論理削除され集計値が求め直されること、退会で全てのUpvoteが論理削除され確定済みのマッチの値が変わらないこと、投稿者のマッチ中のマッチが即時に終了し相手が相手の退会等による勝利になること、両側が同じ投稿者なら両方敗北になること、予定のマッチの側に該当が記録されること、集計中のマッチは即時に終了しないこと、退会の確定の競合で本specの文も取り消されること、先に`decided_at`を書いたマッチ(23:40の確定の済んだもの)を文が変えないことを確かめる(逆向きの競合は5.1で確かめる)
  - 文の組み立ては利用者IDとプロダクトIDのどちらにも使える部品にし、集合の更新だけを返す。ユーザーの同期の処理の識別子と束縛をapiのマッチのモジュールへ、登録をidentity-authの同期の処理の登録箇所へ同時に加える。停止の解除には登録しない
  - 完了状態: Workers統合テストとDIの解決の検査が成功する
  - _Depends: 3.3_
  - _Requirements: 3.5, 5.1, 5.3, 5.4, 5.6, 7.1, 7.2, 7.3_

- [x] 4.2 プロダクトの同期の処理を作る
  - 先に、ローカルD1のWorkers統合テストで、product-launchの非公開化・削除の確定と同じ一括の書き込みで、そのプロダクトのマッチ中のマッチが即時に終了し相手が相手の退会等による勝利になること、予定のマッチの側に該当が記録されること、Upvoteを論理削除しないこと、非公開化の確定の競合で本specの文も取り消されることを確かめる
  - 4.1の文の組み立てを使い、プロダクトの同期の処理の識別子と束縛をapiのマッチのモジュールへ、登録をproduct-launchの同期の処理の登録箇所へ同時に加える。復元には登録しない
  - 完了状態: Workers統合テストとDIの解決の検査が成功する
  - _Requirements: 3.5, 5.2, 5.4, 5.6_

- [ ] 5. APIサーバーの日次の処理
- [x] 5.1 終了時の確定を作る
  - 先に、模擬のポートの単体テストで、終了の日時を過ぎた未確定のマッチを100件ずつ無くなるまで確定すること、各マッチの決着を2.1の規則で作ること、確定したマッチのイベントだけを50マッチごとに送ること、打ち切りの時刻を渡したときは100件の読み取りの前ごとに偽の時計と比べ、過ぎていれば残りを残して`truncated`を返しwarnのログに件数だけを出すこと、打ち切りの時刻を渡さなければ打ち切らないことを確かめる。ローカルD1のWorkers統合テストで、確定の書き込みが側の結果・マッチの確定・確定のイベントを50マッチずつ書き、既に確定していたマッチ(即時の終了)を変えずイベントも作らず、2回実行しても結果が変わらないことを確かめる
  - 確定のストアのポートをポートの定義のファイルへ追記し、ユースケースとストアの識別子と束縛をapiのマッチのモジュールへ加える
  - 完了状態: 単体テスト・Workers統合テスト・DIの解決の検査が成功する
  - _Depends: 2.4_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.6_

- [x] 5.2 予選のペアリングを作る
  - 先に、模擬のポートの単体テストで、予定のローンチを500件ずつ全件読むこと、既にその日の予選に組まれたローンチを除くこと、組んだマッチを50件ずつ作り開始と終了を対象日の0:00と23:40にしてイベントを50マッチごとに送ること、記録を完了にすること、日ごとの記録が完了済みでも組まれていないローンチだけを組み最初の完了の日時を保つこと(組む対象が無ければ何も書かないこと)を確かめる。ローカルD1のWorkers統合テストで、product-launchの予定のローンチ(取消・非公開化・停止中の投稿者を除く)から組み、途中で失敗した後の再実行で残りだけを組むこと、予測できない乱数の部品が範囲内の値を返すことを確かめる
  - ペアリングのストアのポートをポートの定義のファイルへ追記し、ユースケース・ストア・乱数の識別子と束縛をapiのマッチのモジュールへ加える
  - 完了状態: 単体テスト・Workers統合テスト・DIの解決の検査が成功する
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 5.3 開始と開始時点の決着を作る
  - 先に、模擬のポートの単体テストで、開始の日時の直前(前日の23:59:59)の実行では開始せず0:00の実行で開始すること、開始の日時を過ぎた未開始のマッチを100件ずつ処理し、該当の判定の結果で開始・不戦勝・相手の退会等による勝利・両者敗北に分けること、開始の日時から10分を過ぎた開始を報告することを確かめる。ローカルD1のWorkers統合テストで、該当の判定が記録された該当・可視でないプロダクト・取消の予選のローンチ(停止を解除・復元した後も該当のまま)を拾うこと、開始で開始のイベントを、決着で確定のイベントを作ること、2回実行しても同じマッチを重複して開始・確定しないことを確かめる
  - 開始のストアと該当の判定のポートをポートの定義のファイルへ追記し、ユースケース・判定・ストアの識別子と束縛をapiのマッチのモジュールへ加える
  - 完了状態: 単体テスト・Workers統合テスト・DIの解決の検査が成功する
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 13.2_

- [x] 5.4 23:40・23:45・0:00のジョブを登録し、回復を作る
  - 先に、模擬のポートの単体テストで、各ジョブの先頭の掃き出し(確定済みで確定のイベントが無いマッチ)、ペアリングの対象日が予定時刻23:45の実行では翌日、0:00の回復では当日になること(業務時刻23:44:59と23:45:00の予定時刻を渡して対象日を確かめる)、対象日を`ScheduledJobContext.business.date`から求め、偽の時計が予定時刻の翌日を指していても変わらないこと、開始と確定の比較には偽の時計の時刻を使うこと、23:40のジョブが予定時刻に`MATCH_SETTLEMENT_TIME_LIMIT_MS`(4分50秒)を足した打ち切りの時刻を確定へ渡すこと、23:45のジョブが先に確定を(打ち切りなしで)行い行った場合に遅れを報告すること、0:00のジョブが当日のペアリングの未完了を先に行い遅れを報告することを確かめる
  - 3つのジョブ(`order` 1100)の識別子と束縛をapiのマッチのモジュールへ、登録を定期実行の登録箇所へ加え、`SCHEDULED_RUN_BUDGETS`に23:40・23:45・0:00の予算(各300,000ms)を加え、apiの`triggers.crons`(3環境)に0:00と23:45の式を足してCronの式の一致の検査を通す。23:40ではpaymentsの突合(10)の後に動くことを登録の検査で確かめる
  - 完了状態: 単体テストと定期実行の登録の検査(同じ時刻での`order`の重複なし)と時間の予算の検査(`createRunBudgetTable`)とCronの式の一致の検査が成功する
  - _Depends: 5.1, 5.2, 5.3_
  - _Requirements: 2.8, 4.8, 4.9, 12.9, 13.2_

- [x] 5.5 4:21のイベントの送り直しと削除のジョブを作る
  - 先に、模擬のポートの単体テストで、先頭の掃き出し(直近2日)、1時間以上滞ったイベントを100件まで送り直して回数を増やすこと、終了の日時から1時間を過ぎて未確定のマッチの報告、完了から30日を過ぎたイベントと処理の記録を500件ずつ最大10回削除することを確かめる
  - 2つのジョブ(4:21、`order` 1100・1110)の識別子と束縛をapiのマッチのモジュールへ、登録を定期実行の登録箇所へ加える(5.4の後に行い、登録箇所の変更が並行しないようにする)
  - 完了状態: 単体テストと定期実行の登録の検査(4:21での`order`の重複なし)が成功する
  - _Depends: 2.4_
  - _Requirements: 11.4, 11.5, 12.9_

- [ ] 6. APIサーバーの照会とGraphQL
- [x] 6.1 マッチの表示の組み立てとトップページの予選の照会を作る
  - 先に、模擬のポートの単体テストで、表示の組み立てがプロダクトの照会と閲覧者のUpvoteの照会を1回ずつ呼ぶこと、表示できないプロダクトの側を空にすること、閲覧者自身の側の印と閲覧者の制限、配色の番号がプロダクトのIDで決まること、トップページの予選が今日の開始済みの予選を並べ不戦勝を分け、業務時刻の23:39で`live`・23:40で`result`になり終了の時刻と翌日のキックオフの時刻を返すこと、`awaitingKickoff`が当日のペアリングの未完了と開始の日時を過ぎた未開始・未確定の予選で真になり、それ以外で偽になることを確かめる
  - 2つのユースケースと、3.2で実装したトップページのストアの識別子と束縛をapiのマッチのモジュールへ加える
  - 完了状態: 単体テストとDIの解決の検査が成功し、トーナメントが同じ組み立てでマッチの表示を得られる
  - _Depends: 3.3, 5.2_
  - _Requirements: 6.10, 8.1, 8.2, 8.3, 8.4, 8.5, 8.10, 8.11, 8.12, 8.13, 8.19, 9.5_

- [x] 6.2 Upvote履歴の照会を作る
  - 先に、ローカルD1のWorkers統合テストで、有効なUpvoteを実施日とUpvoteの日時の新しい順に20件ずつ返し件数とページ内の日付ごとの件数が正しいこと、非公開化・停止中や退会済みの投稿者・論理削除・紐付けの解除のプロダクトと論理削除したUpvoteを除くことを確かめる。模擬のポートの単体テストで、退会済み・不在・本人以外から見た停止中の利用者でnull、停止中の本人には返すこと、マッチ中の印を確かめる
  - Upvote履歴のストアのポートをポートの定義のファイルへ追記し、ユースケースとストアの識別子と束縛をapiのマッチのモジュールへ加える
  - 完了状態: Workers統合テスト・単体テスト・DIの解決の検査が成功する
  - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.8_

- [x] 6.3 スキーマモジュール`match`の土台とトップページの照会を加える
  - 先に、Workers統合テストで、`qualifierBoard`の未ログイン・ログイン中の各項目(状態・決着・集計値・閲覧者の側の印・閲覧者のUpvote・制限・不戦勝の分類・`awaitingKickoff`)、ロゴが隔離中で`objectKey`がnullになること、マッチの表示のローダーが件数の上限で分けて引くこと、`client`以外の呼び出し元の拒否を確かめる
  - 型の定義・エラーの定義・入力の検証規則・マッチと側とプロダクトの項目のリゾルバ・ローダーを作り、スキーマモジュールの一覧へ加える
  - 完了状態: Workers統合テストとスキーマの検査が成功し、トーナメントのモジュールが`Match`の型とローダーを参照できる
  - _Depends: 6.1_
  - _Requirements: 6.10, 8.1, 8.3, 8.4, 8.5, 8.11, 8.12, 8.13, 8.19, 9.5_

- [x] 6.4 Upvoteと取り消しのミューテーションを加える
  - 先に、Workers統合テストで、未ログイン・停止中・未確認・bot対策(`match_upvote`)の順の拒否、Upvote・付け替え・取り消しの成功で更新後のマッチを返すこと、存在しないマッチ・受け付け中でない・自分のマッチのエラーコードと文言を確かめる
  - bot対策の操作名は、既存の機能と同じく`modules/match/resolver-support.ts`に`MATCH_BOT_ACTIONS`(`{ upvote: 'match_upvote' }`)と`assertHuman(context, action)`を作り、これを正とする(clientの写しと照合は8.5が加える)
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Depends: 3.3, 6.3_
  - _Requirements: 6.1, 6.4, 6.5, 6.6, 6.7_

- [x] 6.5 Upvote履歴の照会を加える
  - 先に、Workers統合テストで、`upvoteHistory`の件数の検証とカーソル、形式違反と表示できない利用者のnull、投稿者の項目(表示できなければnull)、日付ごとの件数を確かめる
  - 完了状態: Workers統合テストとスキーマの検査が成功する
  - _Depends: 6.2, 6.3_
  - _Requirements: 10.2, 10.3, 10.6, 10.8_

- [ ] 7. イベントサーバーの処理
- [x] 7.1 マッチイベントの実行器と登録口を作る
  - 先に、模擬のポートの単体テストで、イベントが無い・完了済みで`done`、同じマッチの古い`pending`で60秒の`defer`、未完了の処理だけを登録の順に実行して完了を記録すること、種別の絞り込み、`continue`で5秒の`defer`、例外をそのまま投げることを確かめる
  - eventのマッチのDIの識別子とモジュール、登録口(初版は空、検証付き)と実行器をeventの束縛とメッセージの処理の登録箇所へ加える。以後のeventのタスクは識別子と束縛をここへ加える
  - 完了状態: 単体テストと3経路のDIの解決の検査が成功し、`match.run-match-event`を処理できる
  - _Depends: 2.6_
  - _Requirements: 11.2, 11.3, 11.4_

- [x] 7.2 予選の結果の記録の処理を作る
  - 先に、模擬のポートの単体テストで、予選以外を処理しないこと、勝利・不戦勝・相手の退会等による勝利を勝利、敗北を敗北として確定の日時とともに記録させること、記録できない・既に記録済みを成功とし、食い違いを警告のログで成功とすること、紐付けの解除された側を除くことを確かめる。ローカルD1のWorkers統合テストで、product-launchの記録の口を使い、ローンチに結果が記録され状態が終了になることを確かめる
  - 処理(`order` 1100)をeventの束縛と7.1の登録口へ加える
  - 完了状態: 単体テスト・Workers統合テスト・登録の検証が成功する
  - _Depends: 2.3_
  - _Requirements: 4.6, 4.7, 12.9_

- [x] 7.3 即時の終了の後続の処理を作る
  - 先に、模擬のポートの単体テストで、ユーザーの退会・停止とプロダクトの非公開化・削除の後続の処理が、確定済みで確定のイベントが無いマッチにイベントを作って送り`done`を返すことを確かめる。ローカルD1のWorkers統合テストで、即時に終了した状態(確定済みで`decided`のイベントが無いマッチ)をローカルD1へ直接作り、後続の処理で確定のイベントが作られ、7.2の処理でローンチに結果が記録されることを確かめる
  - 2つの処理(`order` 1100)をeventの束縛と、identity-auth・product-launchの非同期の処理の登録箇所へ加える
  - 完了状態: 単体テスト・Workers統合テストと、2つの登録口の検証が成功する
  - _Depends: 2.4_
  - _Requirements: 5.5, 12.9_

- [x] 7.4 Upvoteの物理削除とマッチ記録の紐付けの解除の処理を作る
  - 先に、模擬のポートの単体テストで、利用者のUpvoteを1,000件ずつ消して1,000件なら`continue`、未満なら投稿者の紐付けの残りを外して`done`、プロダクトの側の紐付け(プロダクト・ローンチ・投稿者)を外して`done`を確かめる。ローカルD1のWorkers統合テストで、product-launchのプロダクトの物理削除が外部キーで失敗せずマッチと確定値と相手の側が残ること、identity-authの利用者の物理削除がUpvoteの行で失敗しないことを確かめる
  - 2つの処理(`order` 1100)とストアをeventの束縛と、identity-auth・product-launchの非同期の処理の登録箇所へ加える(7.3の後に行い、eventの束縛の変更が並行しないようにする)
  - 完了状態: 単体テスト・Workers統合テストと、2つの登録口の検証が成功する
  - _Requirements: 7.5, 12.1, 12.9_

- [ ] 8. 利用者側の画面
- [x] 8.1 クライアントの操作を加え、型と許可リストを生成する
  - トップページの予選・Upvote・取り消し・Upvote履歴の操作を、clientの`src/graphql/operations/match/`に1ファイル1操作の`.graphql`(操作名は`ClientQualifierBoard`・`ClientUpvote`・`ClientCancelUpvote`・`ClientUpvoteHistory`。フラグメントも`.graphql`に置く)で書き、`graphql()`を呼ばない。clientで`bun run graphql:generate`を実行して型とpersisted operations(`src/graphql/generated/`)を生成する。部品は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む
  - 8.4〜8.11で操作やフラグメントを変えた場合は、そのタスクで型の生成と`graphql:allowlist`を実行し直す
  - 完了状態: 型の生成が成功し、`graphql:allowlist`でapiの許可リストを再生成して`graphql:check`とclientの`codegen.unit.test.ts`(操作名の接頭辞)が成功する
  - _Depends: 6.4, 6.5_
  - _Requirements: 8.1, 10.2_

- [x] 8.2 (P) トップページの区画の登録口を作る
  - 区画の置き場所と文脈の型(`board`・`viewer`に加え、自動更新の状態`autoRefresh`と申告の関数`reportAutoUpdating`、仮8)、一覧の差し込みの型と、2つの登録口(本specの登録は8.10で加えるため初版は空)を作る。文脈の型はGraphQLの生成物に依存させない
  - 先に、`order`順の並べ替えと置き場所ごとの振り分け、差し込みの位置の計算の単体テストを書く
  - 完了状態: 単体テストが成功し、後続specが登録口に1行足すだけで区画と差し込みを加えられる
  - _Boundary: TopPageSections_
  - _Requirements: 8.20, 9.2, 9.3_

- [ ] 8.3 (P) ピッチ・配色・比率のバー・文言の部品を作る
  - モックアップのピッチ(横・縦)・観客の配置・演出のkeyframesを移植し、配色の一覧と種別・ラウンド・結果の文言の組み立てを作る。引数は文字列のリテラルの型にし、GraphQLの生成物に依存させない
  - 先に、配色・文言・観客の配置の単体テストと、ブラウザテスト(axeの違反0件)で、比率のバーの比率と0対0の空のバー・代替テキスト、ピッチが装飾として読み上げられないこと、演出(常に動く旗・ボールの回転・点滅と、Upvoteの演出)が祖先の`data-auto-refresh="on"`の下でだけ動き、視差効果を減らす設定・`"off"`の祖先・属性の無い祖先(トップページの外)の下では動かないことを確かめる(仮8)
  - 完了状態: 単体テストとブラウザテストが成功する
  - _Boundary: StadiumPitch、VoteBar、TeamColors、MatchLabels_
  - _Requirements: 8.3, 8.18, 8.20_

- [ ] 8.4 対戦カードの部品を作る
  - 先に、ブラウザテスト(axeの違反0件)で、Upvoteのボタンの状態・読み上げの名前・無効の理由(ツールチップと`aria-describedby`)、プロダクトのパネルの項目・詳細ページへのリンクの有無・「サイトを開く」の`rel`(予選は`noopener ugc`、トーナメントは`noopener`)・自分の側はUpvote数だけ・非公開のプロダクト、対戦カードの集計中・結果の文言・最終Upvote時間の注記・両者敗北、画面幅640px未満の縦積みと、それ以上の画面幅でカードの幅が768px未満のときの縦積み、`MatchStage`の演出が祖先の`data-auto-refresh="on"`の下でだけ動き、`"off"`と属性の無い祖先の下では動かないことを確かめる
  - 完了状態: ブラウザテストが成功し、トーナメントの区画から同じ部品を読み込める
  - _Boundary: MatchCard、MatchStage、ProductPanel、UpvoteButton_
  - _Depends: 8.1, 8.3_
  - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.12, 8.18, 8.19, 8.20, 9.5_

- [ ] 8.5 Upvoteの操作のフックを作る
  - 先に、ブラウザテストで、未ログインでログインのダイアログを開き戻り先が現在のURLであること、bot対策のトークンを操作ごとに取り直すこと、現在のUpvoteの側で取り消し・他の側でUpvoteを送ること、成功で呼び出し元の値の更新の関数を呼んで通知すること、失敗で表示を変えずに理由を通知すること、送信中の状態を確かめる
  - bot対策の操作名は、clientの`components/match/bot-actions.ts`に6.4の`MATCH_BOT_ACTIONS`の写しを置き(apiの正のファイルを示すコメント付き)、ルートの`config/contract-copies.unit.test.ts`の`BOT_ACTION_COPIES`に照合の1行を加える
  - 完了状態: ブラウザテストとルートの写しの照合の単体テストが成功する
  - _Depends: 6.4_
  - _Requirements: 8.7, 8.8, 8.9_

- [ ] 8.6 (P) 不戦勝の一覧を作る
  - 先に、ブラウザテスト(axeの違反0件)で、見出しと項目(ロゴ・不戦勝のバッジ・カテゴリ・名称・タグライン・「サイトを開く」)、Upvoteのボタンが無いことと、`match.kind`(`QUALIFIER`・`WEEK`・`YEAR`)と`match.endedEarly`を変えた`MatchBye`を渡して説明文が切り替わること(予選の対戦相手なし・開始時点の相手の該当(`reason`が`ABSENT`・`FORFEIT`のどちらも同じ文)は「対戦相手不在のため不戦勝。ディレクトリに掲載されます。」、予選の早期の勝利は`{n}`が`entry.upvoteCount`の値で埋まった「対戦相手が不在になったためマッチ終了。{n}票のUpvoteで確定し、不戦勝でディレクトリに掲載されます。」、Week・Yearの対戦相手なし・開始時点の相手の該当は「対戦相手不在のため不戦勝。次のラウンドへ進みます。」、Week・Yearの早期の勝利は「対戦相手が不在になったためマッチ終了。{n}票のUpvoteで確定し、次のラウンドへ進みます。」)を確かめる(仮7)
  - 完了状態: ブラウザテストで、`QUALIFIER`・`WEEK`・`YEAR`と`match.endedEarly`の真偽の組み合わせの`MatchBye`を渡すと文言規則の4文が出て、トーナメントの区画が読み込める部品として公開されている
  - _Boundary: ByeList、ByeCard_
  - _Depends: 8.4_
  - _Requirements: 8.13, 9.5, 9.7_

- [ ] 8.7 (P) カウントダウンを作る
  - 先に、ブラウザテスト(axeの違反0件)で、偽の時計とサーバーの時刻の差で正しい残り時間を出すこと、終了の時刻の`<time datetime>`と閲覧者のタイムゾーンの表示、`result`では出さないこと、自動更新がオフ(区画の文脈の`autoRefresh`が偽)の間は毎秒の更新を止めて時:分:秒を出さず終了の時刻だけを残し、オンに戻すと再び動くことを確かめる。0になった時の取り直しは持たない(8.10の境界の取り直しが行う)
  - 区画の文脈の型への適合と登録は8.10で行う
  - 完了状態: ブラウザテストが成功する
  - _Boundary: FullTimeCountdown、UseServerCountdown_
  - _Depends: 8.1_
  - _Requirements: 8.11, 8.14, 8.20_

- [ ] 8.8 (P) 予選の区画を作る
  - 8.6の完了の後に始める。区画の登録口へは登録しない(登録は8.10だけが行う)
  - 先に、ブラウザテスト(axeの違反0件)で、見出しの試合数と`live`・`result`の時刻、対戦カードの並び、テスト用の差し込みが指定の件数ごとに出ること、末尾の不戦勝、対戦カードも不戦勝も無いときの空の状態と未ログイン・ログイン中の導線の文言を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: QualifierSection、SectionHeading、EmptyLineup_
  - _Depends: 8.2, 8.6_
  - _Requirements: 8.1, 8.2, 8.11, 8.12, 8.13, 8.15, 9.3_

- [ ] 8.9 (P) トップページの枠・自動更新の切り替え・未ログインの案内を作る
  - 先に、ブラウザテスト(axeの違反0件)で、テスト用の登録で置き場所ごとの区画の並びと順、1つの区画の失敗が他の区画を止めないこと、該当の無い区画を出さないこと、未ログインの案内の文言と登録・ログインの導線を確かめる。自動更新の切り替え(仮8)は、上部の行の先頭に登録した区画とは別に1つだけ描かれ、名前「自動更新」・`role="switch"`・`aria-checked`・`aria-describedby`の秒数の説明(`LIVE_REFRESH_INTERVAL_MS`から作る)を持ち、オンから始まり、キーボードで切り替えられ、オフでテスト用の区画が受け取る`autoRefresh`が偽になりページの根の`data-auto-refresh`が`"on"`から`"off"`に変わること、切り替えが`phase`が`live`の間・予選の対戦カードがある間・テスト用の区画が`reportAutoUpdating(true)`を申告している間に描かれ、申告した区画が例外でエラー境界に捕まった時とアンマウントされた時にその申告が消え、どれにも当たらないとき(`result`で対戦カードが無く申告も無い)は描かれないことを確かめる
  - 完了状態: ブラウザテストが成功する
  - _Boundary: TopPage、AutoRefreshSwitch、GuestHero_
  - _Depends: 8.2_
  - _Requirements: 8.17, 8.20, 9.1, 9.2, 9.4, 9.6_

- [ ] 8.12 (P) 表示中の境界の取り直しの部品をclientの中立の場所へ移す
  - product-launchのclientの`components/product/use-boundary-refresh.ts`と隣の`use-boundary-refresh.browser.test.tsx`を`components/time/`へ移し、読み込む6ファイル(`components/product/`の`my-product-list.tsx`・`launch-date-field.tsx`・`product-edit-content.tsx`・`launch-date-field.browser.test.tsx`と、`apps/client/test/`の`my-products-route.browser.test.tsx`・`edit-product-route.browser.test.tsx`)の読み込みを直す。振る舞いと公開する名前(`useBoundaryRefresh`・`BOUNDARY_REFRESH_DELAY_MS`)は変えない。番号は後から加えたため8.12だが、8.10より前に行う
  - `docs/GUIDES/tech/frontend/012-business-date-calendar.md`の部品の表の`useBoundaryRefresh`の置き場所を、複数のドメインが使う場合は画面のアプリの中立の場所に置く旨に直す(本プロジェクト固有の名前を書かない)
  - 完了状態: 移した部品のテストとproductのブラウザテスト・型検査・静的解析が成功し、`components/product/use-boundary-refresh.ts`への読み込みが残っていない
  - _Boundary: `apps/client/src/components/time/`、上の6ファイルの読み込みの行、`docs/GUIDES/tech/frontend/012-business-date-calendar.md`_
  - _Requirements: 8.10, 8.12_

- [ ] 8.10 トップページを組み立て、仮のトップページを置き換える
  - 統合のタスクとして、仮のトップページを本specのトップページに置き換え(`components/pages/placeholder-home.tsx`と隣のテストを消す)、カウントダウン(`banner` 10)と予選の区画(`main` 30)を区画の文脈に合わせて登録口へ登録し、bot対策のウィジェット(`TurnstileWidget`は非表示で描くため、判定の枠と場所を設けない)を1つ置き、対戦カードに8.5のフックをつないで成功時の値で予選の取得結果のキャッシュを並び順を保って更新する
  - 予選の取得の`refetchInterval`を取得した値で判定する関数にする。自動更新がオンで`live`の対戦カード・集計中のマッチ・`awaitingKickoff`のいずれかがあれば`LIVE_REFRESH_QUERY_OPTIONS`の間隔、オフでも集計中のマッチか`awaitingKickoff`がある間はページを表示した時点と最後の境界の取り直しのうち後の時点から取得の更新が10回に達するまで間隔(達しても状態が変わらなければ予選の区画の`role="status"`の文を開き直しの案内に切り替える)、それ以外は止める。8.12の`useBoundaryRefresh`で終了の時刻(23:40)と翌日の開始の時刻(0:00)の1秒後に予選の取得を無効にして取り直す。bot対策のウィジェットの`action`は8.5の写しの`MATCH_BOT_ACTIONS.upvote`を使う
  - 先に、ブラウザテストで、Upvoteの成功で取得結果が並び順を保って更新されること、30秒ごとの取り直しで値が変わり並び順が変わらないこと、自動更新をオフにすると定期の取り直しが止まり、オフのままでも偽の時計で終了の時刻と翌日の開始の時刻を越えた1秒後に取り直すこと、境界の直後の取得が開始の前・確定の前の状態(`awaitingKickoff`が真・集計中)を返したら、オフでもその後に取り直し、状態が変われば止まり、変わらなければ10回で止まり`role="status"`の開き直しの案内が出ること、ページを境界の後に開いてからオフにした場合も表示した時点から数えること、結果がすべて確定した後は定期の取り直しが止まること、取得エラーの再試行と問い合わせへの導線、予選の区画で予選の一覧が失敗しても他の区画が出ることを確かめる
  - 完了状態: ブラウザテストが成功し、ローカルで`/`を開くとサーバーで描画された予選の区画(マッチが無ければ空の状態)が出て、`components/pages/placeholder-home.tsx`が残っていない
  - _Depends: 6.3, 8.5, 8.7, 8.8, 8.9, 8.12_
  - _Requirements: 8.10, 8.12, 8.16, 8.20, 9.4_

- [ ] 8.11 公開プロフィールのUpvote履歴のタブを作る
  - 先に、ブラウザテスト(axeの違反0件)で、タブの件数、日付の小見出しと件数、項目のロゴ・名称のリンクと未掲載のバッジ・投稿者のリンク・種別とラウンド・時刻を出さないこと、マッチ中の印と「トップページで見る」、除外の注記、0件(本人と他人)・タブの取得エラー・続きの取得エラーを確かめる
  - 公開プロフィールのタブの登録箇所に`upvotes`(20)を加える
  - 完了状態: ブラウザテストが成功し、ローカルで`/@<ハンドル>?tab=upvotes`を開くとUpvote履歴が出る
  - _Depends: 8.1, 8.3_
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [ ] 9. 文書
- [ ] 9.1 (P) 技術ドキュメントを書き、CLAUDE.mdから参照する
  - `backend/014-time-boxed-voting.md`・`frontend/013-live-scoreboard.md`を設計のMatchTechDocsの内容で、本プロジェクト固有の値を含めずに書き、`backend`・`frontend`のREADMEの文書一覧に行を加える
  - CLAUDE.mdの「技術規則の参照先」に「期間を限った投票を作る前に: `backend/014`」を、作った見出しへのリンクで加える
  - `frontend/004-accessibility-rules.md`の「演出の停止手段の義務」と`frontend/010-live-refresh-queries.md`の「止める手段」に、定期的に取り直す区画が複数あるページではページの上部に1つの切り替えを置き、状態を各区画へ渡して各区画の見出しの近くには置かなくてよいこと、その切り替えが止める範囲(定期の取り直し・数値の毎秒の更新・演出)と止めないもの(境界の取り直し・操作の後の無効化)、切り替えを登録した区画とは別に描き区画の失敗で消えないようにすること、切り替えはページに定期の取り直し・数値の毎秒の更新・演出のいずれかがある間は描き(結果が確定して定期の取り直しが止まっても演出が残るなら描く)、どれも無ければ描かないこと(`010`の「定期の取り直しが無い表示には描かない」との関係)、境界の時刻の直後に状態の変化を待つ取り直しは切り替えによらず回数を限って行うことを加える(仮8)。既存の区画ごとの`Switch`の規則は変えない
  - 完了状態: 文書とREADMEが整形の検査を通り、本プロジェクト名とサービス固有の仕様を含まず、CLAUDE.mdのリンクの見出しが実在し、`frontend/004`・`010`の追記が`frontend/013`の自動更新の切り替えの節と食い違わない
  - _Boundary: `docs/GUIDES/tech/backend/014-time-boxed-voting.md`・`frontend/013-live-scoreboard.md`・`frontend/004-accessibility-rules.md`・`frontend/010-live-refresh-queries.md`・`backend/README.md`・`frontend/README.md`・`CLAUDE.md`_
  - _Requirements: 13.4_

- [ ] 9.2 (P) 日次タイムラインとオンボーディングを更新する
  - 日次タイムラインの23:40・23:45・0:00の行に本specのジョブと`order`(23:40は突合の後)を、4:21のジョブの表に`match-engine.event-redispatch`(1100)・`match-engine.event-cleanup`(1110)を加え、`docs/onboardings/project-values.md`に波及処理・処理・ジョブの名前と`order`・bot対策の`action`・メッセージ種別・23:40の確定の打ち切りの時間(予定時刻から4分50秒)・23:40・23:45・0:00の起動の時間の予算を加える
  - 完了状態: 文書が整形の検査を通り、5.4・5.5の登録の値と一致する
  - _Depends: 5.4, 5.5_
  - _Boundary: `docs/GUIDES/service/overview/007-daily-timeline.md`・`docs/onboardings/project-values.md`_
  - _Requirements: 13.5_

- [ ] 10. 検証
- [ ] 10.1 E2Eテストでトップページの投票とUpvote履歴の流れを確かめる
  - `e2e/client/match-steps.ts`(本specの機能の手順。`e2e/support/`には置かない): (0)テスト専用のカテゴリを、管理画面の手順(`e2e/support/admin-bootstrap.ts`の`signInAsNewAdmin`と`e2e/admin/category-steps.ts`の`createCategory`)で、テストの管理画面のページから、ロール`moderator`で乱数の名前とハンドルで作る(他のテストの残りのローンチが日付の経過で当日になり「その他」のカテゴリで組まれ得るため、専用のカテゴリで自分の2つのローンチだけを同じカテゴリに置き、必ず互いに組ませる。カテゴリはハンドルの名前空間に関わるためローカルD1へ直接入れない)。(1)指定したローンチのローンチ日だけを、2件を1つの文でadmin-foundationの`executeLocalD1`(文字列は`sqlStringLiteral`)で当日の業務日付に書き換える(画面では当日を選べないため)。(2)backend-platformの`triggerScheduled`で、前日の業務日付の23:45(`worker: 'api'`、当日のペアリング)と当日の0:00(開始)を起こす(業務日付は`businessDateOf`・`addBusinessDays`で求める)。(3)トップページで2つのプロダクトの対戦カードを探し、Upvote・付け替え・取り消しを行い、Upvote数と通知を読む。(4)Upvote履歴の項目を読む。マッチは本specのジョブが作り、手順は本specのテーブルへ書き込まない。ペアリングの後に2つのプロダクトが同じ対戦カードにあることを確かめ、無ければ理由を示して失敗させる
  - `e2e/admin/match-upvotes.e2e.test.ts`(管理画面の対象に置く。`signInAsNewAdmin`は一時的に有効な最上位管理者を作るため、利用者側の対象に置くと、最上位管理者が1人の状態を前提にする管理画面のテストと並行して衝突する。管理画面の対象は1つずつ動く。利用者の3人の文脈は`e2e/admin/client-page-test.ts`の`clientPage`と同じ作り方(利用者側のURL・文脈ごとの接続元)で開く): 業務時刻の23:20〜24:00(23:40の締め切りと業務日付の境界の近く)では`test.skip`で理由を付けて飛ばす。identity-authの`e2e/support/mailpit.ts`で確認済みの利用者を3人登録し(メールアドレスのドメインは`.example`)、専用のカテゴリを作り、2人がproduct-launchの`e2e/client/product-steps.ts`(`createProductInput`のカテゴリを専用のカテゴリに替える)でプロダクトを登録し、`match-steps.ts`の手順でマッチ中にする。3人目がトップページで一方にUpvote→反対側へ付け替え→取り消し(Upvote数と通知の変化)、投稿者の1人の画面で自分の側にボタンが無く相手の側が無効で理由が出ること、3人目が再びUpvoteした後に`/@<3人目のハンドル>?tab=upvotes`に「未掲載」と「マッチ中」の項目が出ることを確かめる。Turnstileはローカルの常に成功するキーを使い、Ultrasの機能フラグで結果が変わる表示は確かめない。3人目のトップページで「自動更新」の切り替えが出ていることも確かめる
  - 完了状態: ローカルでE2Eテストが同じ日に2回続けて成功する(ペアリングの再実行で新しいローンチだけが組まれる)
  - _Depends: 5.4, 8.10, 8.11_
  - _Requirements: 13.3_

- [ ] 10.2 全体の検査とカバレッジを確かめ、運用の事項を報告する
  - 整形の検査・静的解析・型検査と、単体テスト・Workers統合テスト・ブラウザテストを一括で実行し、本specが追加・変更したファイルのカバレッジが80%以上であることを確かめる。ログとSentryへの送信にプロダクトの名称・利用者のハンドル・bot対策のトークンが含まれないことを検索で確かめる
  - apiの`triggers.crons`の変更が`wrangler deploy`で反映される旨、本specの実装より前にstagingでマッチ中のまま固定されたローンチがあればproduct-launchの手順で結果を記録する旨、roadmapの帯の割り当ての表の本specの「使用中の値」(4:21は1100・1110、波及処理は1100)を作業の報告に記録する
  - 完了状態: すべての検査とテストが成功し、カバレッジの結果が閾値を満たし、報告に運用の事項が載っている
  - _Requirements: 12.10, 13.1, 13.2_

## Implementation Notes

- 1.1: テーブルは`apps/db/schema/match/`、マイグレーションは`20261110032731_match_engine`。値の一覧(種別・段階・決着・結果・イベントの種類と状態・ペアリングの状態)は`apps/db`内だけの定数のため、2.1で`core/match`の値の一覧とテーブル定義の`enumValues`の一致を確かめる単体テストを加える(product-launchの`product-lifecycle-columns.unit.test.ts`と同じ形)。`qualifierWins()`は別名付きの副問い合わせを返す関数で、`const wins = qualifierWins()`と受けて`wins.productId`で結合する(design.mdの利用例`qualifierWins.productId`は動かない)。戻り値の`matchDate`は`string`、`lastUpvotedAt`・`decidedAt`はエポックミリ秒の`number`。`match_kind`は側とイベントにも同じCHECKを持つ。予選の側の部分一意索引は`match_entries_qualifier_launch_id_unique`(トーナメントの側のローンチには一意の制約が無い)
- 1.2: 画面の文言は`docs/GUIDES/service/design/003-text-and-copy-rules.md`を正とし、6.3・6.4・8.xの実装はここから一字一句写す。設計が決めていなかった文言は003で決めた(カウントダウンの読み上げ「フルタイムまであと12時間34分」・1時間未満「…あと34分」・1分未満「…あと1分未満」、Upvote履歴の日付の小見出しの件数「3件」、投稿者のリンクの読み上げの接頭辞「投稿者:」、Upvote履歴の空の状態の導線「トップページで開催中のマッチを見る」、ログインのダイアログの説明と未ログインの案内はモックアップから)。Upvote・取り消しの`validation_error`(IDの形式違反・マッチに無い側)は「マッチが見つからない」と同じ文言、`upvoteHistory`の`invalid_cursor`・`first`の範囲外は`launchHistory`の既存の文言を使う。予選の見出しの試合数は対戦カードと即時に終了したマッチの数(対戦相手なし・開始時点の相手の該当の不戦勝と両者敗北は数えない)。種別の印は「Week 準決勝」のように半角スペースで区切る(表記規則の例外として明記)。比率のバーの代替テキストは「<名称>12票、<名称>9票」。8.10で仮のトップページを消すとき、003の「トップページの仮の表示」(「トップページは準備中です。」)の行も消す。product detailの節の「トップページと同じ演出」の記述はdirectory-discoveryの範囲として残した
- 2.1: 規則は`apps/backend-lib/core/match/`の`match-model.ts`(値の一覧・`deriveMatchPhase`・`QUALIFIER_SCHEDULE`・`qualifierWindow`・`isWinningResult`)・`match-decision.ts`(`decideAtKickoff`・`decideAtFullTime`)・`qualifier-pairing.ts`(`pairQualifiers`・棄却法の`createUniformRandomSource(nextUint32)`)。5.2の`CryptoRandomSource`は`createUniformRandomSource(() => crypto.getRandomValues(new Uint32Array(1))[0])`で包むだけにする。2.2の`core/match/match-events.ts`は値の一覧(`MATCH_EVENT_TYPES`・`MATCH_EVENT_STATUSES`)だけを先に作ったので、2.2は同じファイルへ追記する。`QUALIFIER_SCHEDULE.pairing`はproduct-launchの`core/product/launch-status.ts`の`PAIRING_TIME`を再利用する(設計の許可された依存に無い結合。値を二重に持たないため)。不整合な集計値(同数で1以上なのに最終Upvote時間が無い等)と側が0個・3個以上の`decideAtKickoff`は`RangeError`。開始時点に側1つだけが該当すると決着`both_forfeited`・結果`lost`。テーブル定義との値の照合は`workers/match/match-columns.unit.test.ts`(`qualifier_pairings.status`はcoreに一覧が無いため対象外)。CLAUDE.mdのディレクトリ構成への`core/match`・`workers/match`の追記は9.1で行う
- 2.2: 登録口は`core/match/match-events.ts`の`createMatchEventRegistry`(identity-authの`createLifecycleRegistry`に名前・重複・`order`の検証を委ね、イベントの種類×種別の凍結した表を作る)。同じイベントの種類での`order`の重複は対象の種別が重ならなくても拒否し、`kinds`の重複と空の配列も拒否する。ラベル`MATCH_EVENT_HANDLER_LABEL`は「マッチイベントの処理」、再試行は`MATCH_EVENT_RETRY_POLICY`(5回・300秒・上限3600秒)。メッセージの契約は`core/messaging/contracts/match.ts`の`RUN_MATCH_EVENT_MESSAGE`(本文の型`RunMatchEventBody`)で`MESSAGE_CONTRACTS`へ追加済み。7.1でeventの`message-handlers.ts`へ実行器を`retry: MATCH_EVENT_RETRY_POLICY`で登録する
- 2.3: 全部品の契約は`core/match/ports.ts`、識別子は`core/match/identifiers.ts`の`MATCH_PLATFORM_TYPES`、照会のD1の実装は`workers/match/d1-match-directory.ts`(`D1MatchDirectory`・`D1SupporterDirectory`)。`workers/match`のWorkers統合テストはapiの`test:worker`で動く。テストの補助は`workers/match/testing/match-fixtures.ts`(`insertMatch(es)`・`insertUpvotes`・`clearMatchTables`・`matchIdOf`・`entryIdOf`・`upvoteIdOf`・`MATCH_DATE`・`MATCH_WINDOW`)と`testing/directory-fixtures.ts`。最終Upvote時間の経過`lastUpvoteElapsedMs`は予定の`startsAt`から測る。`summarizeDaily`の「開始した予選」は`started_at`があり、即時の終了・未確定・`votes`/`last_upvote`/`no_votes`で確定したもの(不戦勝と開始時点の決着を除く)、Upvote数は全種別の確定したマッチの側の合計、範囲の全日を0埋めで返す。範囲・件数の誤用は`RangeError`。サポーターは`upvoted_at ASC, id ASC`。`findQualifierResults`は設計の契約どおり`lost`も返す(要件12.4は勝者と書くが、呼び出し側が`isWinningResult`で絞る)。`listByLaunches`は相手の側も返し、要求の90件ずつのページをまたぐ行は`entryId`で重複を除く。テストのファイルは800行の上限のフックがあるため、`<元>.<観点>.worker.test.ts`に分ける
- 2.4: `workers/match/d1-match-scheduler.ts`・`d1-match-event-store.ts`・`queue-match-event-dispatcher.ts`。設計と違い、D1の2クラスは最後の引数に`@inject(PLATFORM_TYPES.IdGenerator)`を取り(生のSQLで挿入するため主キーの`defaultFn`が効かない)、`QueueMatchEventDispatcher`は`(publisher, appName)`で装飾子を持たない(`QueueSearchIndexRefreshRequester`と同じ)。2.6はdispatcherを`toDynamicValue`で`new QueueMatchEventDispatcher(context.get(PLATFORM_TYPES.MessagePublisher), appName)`と束縛するため、モジュールはアプリ名を受け取る形にする。`schedule`は設計の`onConflictDoNothing`ではなく、条件付きの`INSERT … SELECT … WHERE NOT EXISTS`(予選の同じローンチ)と`ON CONFLICT (match_id, slot)`・`(match_id, type)`で、側の欠けたマッチを作らない。1つの予選の両方の側に同じローンチを渡すと例外で全体が取り消される。1回の上限は50マッチ(超えると`RangeError`)、使用済みのローンチのマッチは`skipped`で返る。30日の削除の後に同じマッチIDで`schedule`を呼び直すと`scheduled`のイベントを作り直す(当日のペアリングでは起きない。トーナメントのspecへの申し送り)。送信の失敗のログはwarn「マッチイベントを送れず、送り直しに委ねました」、分類`[appName, 'match', 'events']`、属性`eventId`・`error`(9.2で`project-values.md`へ)。並行数`MATCH_EVENT_PUBLISH_CONCURRENCY = 6`はworkers側。`createMissingDecidedEvents`の発生日時は`decided_at`。テストの補助は`testing/event-fixtures.ts`(`createSequentialIds`・`insertMatchEvents`・`createRecordingDispatcher`・`createControlledPublisher`など)
- 2.5: `workers/match/d1-match-export.ts`(`D1MatchExport`・`D1UpvoteExport`、どちらも`PLATFORM_TYPES.Database`の1引数)。相手の側は`match_entries`の別名の左結合で不戦勝は0、未確定のマッチは照会の時点のUpvote数と`result: null`、マッチの無いローンチは結果のMapに含めない。Upvoteは有効なものだけを`upvoted_at ASC, id ASC`で上限なしに返す。`docs/GUIDES/service/features/001-user-data-export.md`との相違(論理削除済みを`deletedAt`付きで含める全体方針・`matches[].result`にnullが無い・`upvotes.json`の`product`は名称とハンドル・`matches[].id`は契約の`matchId`)はdata-exportのspecで揃える。`IDS_PER_STATEMENT = 90`と`chunk()`は`workers/match`の3ファイルに重複している
- 2.6: 共有の束縛は設計の定数`MATCH_PLATFORM_MODULE`ではなく関数`createMatchPlatformModule(appName)`(`workers/match/match-platform-module.ts`、モジュール名`match-platform`、7識別子とも`inSingletonScope()`、送信の部品だけ`toDynamicValue`)。アプリごとの値は`apps/api/src/composition/match-module.ts`の`API_MATCH_PLATFORM_MODULE`と`apps/event/src/composition/match-module.ts`の`EVENT_MATCH_PLATFORM_MODULE`で、両アプリの`MODULES`の`PRODUCT_PLATFORM_MODULE`の直後に置く。apiのマッチのモジュール(設計の`MATCH_MODULE`)は検索の先例に揃えて`API_MATCH_MODULE`と名付け、同じ`match-module.ts`に置く(eventは`EVENT_MATCH_MODULE`)。モジュール単体のテストは識別子が7つであることを固定で確かめるため、`MATCH_PLATFORM_TYPES`を足したらテストも直す。テストの補助は`testing/match-platform-fixtures.ts`(`seedMatchPlatformSample`・`sampleQualifierInput`)
- 3.1: 規則は`apps/api/src/domain/match/upvote-plan.ts`(`decideUpvote`・`viewerRestriction`、受け付け中は`live`だけ、`UpvoteViewer.writable`は停止中・退会済みでないこと)と`board-order.ts`(`orderBoard`・`placementOf`・`orderCards`)。合計最大が同数ならIDの小さい方が先頭、IDは文字コードで比べる、不戦勝はIDの昇順。側1つで未決着(開始の記録の前)は`absent`の不戦勝、側1つで2つの側が要る決着は`RangeError`。マッチ中に同じ投稿者の両方の側が該当した`both_forfeited`も対戦カード・不戦勝・試合数のいずれにも出さない(設計どおり。002のページ配置に明記した。2.3の`summarizeDaily`の「開始した予選」とは数え方が違う)。6.1の`QualifierBoardReader`は、`placementOf`の`RangeError`を1件ごとに受け止めてwarnのログ(マッチIDだけ)を出しその1件を除き、不整合な1行でトップページ全体をエラーにしない。`BoardMatch.entryCount`は側の数、`endedEarly`は`MatchRecord.endedEarly`から作る
- 3.2: ポートは`apps/api/src/application/match/ports.ts`(`UpvoteStore`・`MatchBoardStore`、入力の型`UpvoteApplyInput`・`UpvoteCancelInput`)、実装は`apps/api/src/infrastructure/match/`の`tally-statements.ts`(`tallyRecomputeStatement(db, target, now)`、受け付け中のマッチだけを対象にする集合の更新)・`upvote-guards.ts`(`acceptingCondition`は`matches`を別名`accepting_match`で読む。外側の文が`matches`でも自己相関しない・`upvoteAllowedCondition`)・`d1-upvote-store.ts`・`d1-match-board-store.ts`。書き込みは1つの`db.batch`で[付け替えの削除→条件付きの挿入→求め直し]。payments の`D1GuardedBatch`は使わず、条件が成り立たないと`entry_id`をNULLにしてNOT NULLの違反で全体を取り消し、部分一意索引の違反は`duplicate`(`d1-product-store.ts`と同じ違反の判定)。設計と違い、付け替えの削除は`entry_id = fromEntryId`で絞る(同じ付け替えが2回届いても2回目は`duplicate`になり、Upvoteの日時が後ろへずれない)。取り消しは受け付け中の条件付きの物理削除だけで利用者の状態は見ない。`seq`は`MAX(seq)+1`(論理削除の行も数えるため、有効な行の順は記録の順と一致する)。`duplicate`は同時の追加(同じ側・別の側)と2回目の同じ付け替えの3通りで、3.3は成功として扱う。4.1の利用者の求め直しは`match_entries.id IN (SELECT entry_id FROM match_upvotes WHERE user_id = ?)`のような対象を渡す。`identity-store-fixtures.ts`の`insertUser`は既定で`emailVerifiedAt`が無いため、テストの補助`testing/upvote-store-fixtures.ts`の`seedUpvoteParticipants`は確認済みの利用者を明示して作る
- 3.3: `apps/api/src/application/match/`の`match-types.ts`(`MATCH_TYPES`、テストが識別子の一覧を固定で確かめるため、足すタスクは`EXPECTED_NAMES`も直す)・`match-errors.ts`(`MATCH_ERRORS`。identityの`account_unavailable`・`email_not_verified`・`unauthenticated`も含む)・`upvote-viewer.ts`(`upvoteViewerOf`、6.1で再利用)・`upvote-service.ts`(`StoreUpvoteService`、戻り値はvoid)。モジュールは`API_MATCH_MODULE`(名前`api-match`、`MODULES`の末尾)。設計の依存表と違い`AccountGuard`は注入せず、引数の利用者の状態を`viewerRestriction`で確かめる。取り消しはストアでもサービスでも利用者の状態を見ないため、6.4のリゾルバは必ず先に`requireVerifiedUser`を呼ぶ。読み直しでどの条件にも当たらない`rejected`は`account_unavailable`。側がマッチに無い`validation_error`は上位が汎用の文言で詳細`{field:'entryId'}`に「マッチが見つからない」の文言(6.4は`withInputPath('input', …)`で包み、IDの形式違反のzodの文言も`MATCH_ERRORS.match_not_found.message`にする)。取り消しでマッチが無ければ`match_not_found`、自分のマッチは確かめない(003の記述を「取り消しは何も変えずに成功」に直した)。テストの偽物は`testing/upvote-fakes.ts`
- 4.1: 文の組み立ては`apps/api/src/infrastructure/match/match-closure-statements.ts`の`matchClosureStatements(db, input)`(入力は判別共用体で、プロダクトの主体は`upvotes: 'none'`だけを型で許す。手順1・2がUpvoteの論理削除と求め直し、3〜5が即時の終了・確定・予定のマッチの該当の記録)。求め直しの対象は`match_upvotes.user_id = ? AND deleted_at = <事象の時刻>`で特定する(求め直しは冪等で受け付け中のマッチに限るため、余分に拾っても無害)。手順4の決着は手順3の後に`walkover`の側が残れば`walkover`、無ければ`both_forfeited`(側1つのマッチも`both_forfeited`)。即時に終了したマッチの他の利用者のUpvoteは消さない。同期の処理は`account-match-closure-sync-handler.ts`、登録は`match-engine.account-match-closure`(events `['withdrawn','suspended']`)を`composition/user-lifecycle-sync-handlers.ts`へ。早期の終了では`decided`のイベントを作らない(7.3の後続の処理が作る)。退会は集計中のマッチのUpvoteも論理削除するが求め直さないため、5.1の確定は有効なUpvoteから数え直さず、保存済みの`upvote_count`・`last_upvoted_at`・`last_upvote_seq`を確定値に使う(要件4.1・7.3)。テストの補助は`testing/closure-fixtures.ts`(`seedClosureScenario`・`expectedScenario`・`ownerAClosure`・`readScenario`)。`project-values.md`の同期の波及処理の件数(「4件」)は9.2で直す
- 4.2: `apps/api/src/infrastructure/match/product-match-closure-sync-handler.ts`(`hidden`・`deleted`で`matchClosureStatements`の3文、`unhidden`は空)、登録は`match-engine.product-match-closure`を`composition/product-lifecycle-sync-handlers.ts`の`PRODUCT_LIFECYCLE_SYNC_HANDLERS`へ。両側が同じ投稿者でもプロダクトが主体なら他方のプロダクトの側は`walkover`(利用者が主体なら`both_forfeited`)。予選が未確定のローンチを持つプロダクトは削除できない(product-launchの`qualifierUnlocked`)ため、削除の即時の終了はトーナメントのマッチで起きる。`project-values.md`の「同期の処理の登録は`PRODUCT_LIFECYCLE_SYNC_HANDLERS`(現在は登録0件)」も9.2で直す。テストの補助`closure-fixtures.ts`に`OWNER_A_FIRST_PRODUCT`・`productOneClosure(at)`を追加
- 5.1: ユースケースは`apps/api/src/application/match/match-settlement.ts`(`StoreMatchSettlement.settleDue(now, deadline?)`、定数`MATCH_SETTLEMENT_TIME_LIMIT_MS = 290_000`・`MATCH_SETTLEMENT_READ_LIMIT = 100`・`MATCH_SETTLEMENT_WRITE_LIMIT = 50`)、ストアは`infrastructure/match/d1-settlement-store.ts`(ポートの型`DueSettlement`・`SettlementWrite`、51件以上は`RangeError`)、識別子は`MATCH_TYPES.SettlementStore`・`MatchSettlement`。設計と違い、一括の書き込みは1マッチごとに[側の結果→`decided`のイベント→マッチの確定]の順で、3文とも同じ未確定の条件(`started_at IS NOT NULL AND decided_at IS NULL AND ends_at <= at`)を持つ(設計の順だとイベントの文が確定の後になり条件で見分けられない)。確定値は保存済みの集計値、確定の日時とイベントの発生日時は`now`。決着できないマッチ(側が2つ未満・不整合な集計値)はwarn(`matchId`と`entryCount`か`error`)で飛ばし、処理済みを覚えて新しいものが無い読み取りで止める(先頭に100件以上並ぶと後ろが確定されない理論上の取りこぼしがあり、4:21の`match-settlement-overdue`の報告で拾う)。打ち切りのwarnは`{ settled }`のみ。`settleDue`はinfoのログを出さないため、5.4のジョブが`{settled, truncated}`を出し、23:45で`settled > 0`なら遅れを報告する。ログの分類は`['api','application','match']`(9.2で`project-values.md`へ)。テストの偽物は`testing/settlement-fakes.ts`(`createFakeSettlementStore`・`createRecordingMatchEventDispatcher`・`createSteppingClock`・`unusedClock`)。`columnsOf`が`d1-match-scheduler.ts`と`d1-settlement-store.ts`に重複している
- 5.2: ユースケースは`apps/api/src/application/match/qualifier-pairing-service.ts`(`StoreQualifierPairingService.pair(date)`が`PairingCounts`を返す、定数`QUALIFIER_PAIRING_READ_LIMIT = 500`・`QUALIFIER_PAIRING_WRITE_LIMIT = 50`)、ストアは`infrastructure/match/d1-pairing-store.ts`(`beginDay`・`pairedLaunchIds`・`completeDay`・`isDayCompleted`)、乱数は`crypto-random-source.ts`、識別子は`MATCH_TYPES.PairingStore`・`RandomSource`・`QualifierPairingService`。未完了の日は対象が0件でも完了を記録する(23:45に記録しないと0:00の回復が`qualifier-pairing-late`を誤って報告するため。「組む対象が無ければ何も書かない」は完了済みの日だけに当てはめた)。`completeDay`はupsertで件数を足し`COALESCE`で最初の完了の日時を保つ。件数はスケジューラーが実際に作ったマッチだけを数え、途中で失敗した後の再実行では再実行の分だけになる(件数を読む箇所は無い。運用の文書で「その日の総数」と説明しない)。5.4の0:00の回復と6.1は`PairingStore.isDayCompleted`を使う。`chunk()`が`qualifier-pairing-service.ts`にも重複している
- 5.3: ユースケースは`apps/api/src/application/match/match-kickoff.ts`(`StoreMatchKickoff.kickoffDue(now)`が`{ started, decided }`を返し、infoのログは出さない)、判定は`entry-eligibility.ts`(`DirectoryEntryEligibilityChecker`。記録された該当・紐付けなし・`ProductDirectory`で可視でない(投稿者の停止・退会を含む)・予選だけはローンチが無いか取消)、ストアは`infrastructure/match/d1-kickoff-store.ts`(5.1と同じ[側→イベント→マッチ]の順、条件は未開始・未確定・`starts_at <= at`に加え、判定で該当とした側以外に`forfeited_at`が無いこと。拒否されたマッチは読み直して1回だけ試し直す)。開始時点の決着でも`started_at`を書く。報告は`MatchIncidentReporter`のポートと`sentry-match-incident-reporter.ts`(`captureEvent`・level `error`・指紋`['match', 種類]`・タグ`match_incident`・コンテキスト`match_incident.count`、ログの分類`['api','infrastructure','match']`)で、現在の種類は`match-kickoff-late`(10分ちょうどは報告しない、実際に書いたマッチだけを数える)。5.4・5.5は`MatchIncident`の判別共用体へ`match-settlement-late`・`qualifier-pairing-late`・`match-settlement-overdue`を足し`MESSAGES`に文言を足す。5.4は`docs/GUIDES/tech/infra/004-logging-and-error-tracking.md`の「送信する例外と送信しない例外」の表に、本specの報告の行を固有の値を含めずに加える。識別子は`MATCH_TYPES.KickoffStore`・`EntryEligibilityChecker`・`MatchKickoff`・`MatchIncidentReporter`
- 5.4: ジョブは`apps/api/src/application/match/match-jobs.ts`(`MatchSettlementJob`・`QualifierPairingJob`・`MatchKickoffJob`と`*_JOB_DEFINITION`、5.5が再利用する`sweepMissingDecidedEvents(events, dispatcher, now)`(時計から2日前以降を50件ずつ)・`nextBusinessDate`)。登録は`composition/scheduled-jobs.ts`(order 1100、23:40は突合(10)の後)、予算は`QUALIFIER_SCHEDULE.fullTime`・`.pairing`・`.kickoff`に各300,000ms、`wrangler.jsonc`のルートの`triggers.crons`に`45 7 * * *`・`0 8 * * *`(staging・prodは`triggers`を持たず継承する)。23:40と23:45は時計を最初に1回読み、0:00は遅れたペアリングの後に読み直して開始に渡す。`match-settlement-late`は確定の直後(ペアリングの前)に報告、`qualifier-pairing-late`はペアリングの成功の後に作ったマッチ数(0もあり得る。デプロイが23:45〜0:00に入った日の0:00にも出得る)で報告。0:00でペアリングが失敗すると開始しない(0:00の後に開始を担うジョブは無いため、運用者が0:00のジョブを手動で起こし直す。2回実行しても結果は変わらない。10.2の運用の報告に載せる)。infoのログは23:40「終了の日時を過ぎたマッチを確定しました」`{swept, settled, truncated}`、23:45「翌日の予選を組みました」`{swept, settled, matchDate, launches, matches}`、0:00「当日のマッチを開始しました」`{swept, matchDate, latePairedMatches, started, decided}`。9.2は`project-values.md`の「定期実行の時間の予算」節の「23:40の起動は決済の突合のジョブだけのため、予算を置かない」「予算は4:21の1件」の2文も書き換える。004の「送信する例外と送信しない例外」の表に定期実行の遅れの報告の行を加えた。`chunk()`がapplication層の3ファイルに重複している
- 5.5: 4:21のジョブは`match-jobs.ts`の`MatchEventRedispatchJob`(`match-engine.event-redispatch`、1100。掃き出し→`now − 1時間 + 1ms`より前に送った`pending`を100件まで送って`markRedispatched`→`SettlementStore.countOverdue`で終了の日時から1時間を過ぎた未確定のマッチ(開始の記録の有無を問わない)を数え、1件以上なら`match-settlement-overdue`を報告)と`MatchEventCleanupJob`(`match-engine.event-cleanup`、1110。30日より前に完了したイベントと処理の記録を500件ずつ最大10回)。どちらも`Clock.now()`基準で`run()`は引数なし。`publish`は成否を返さないため、送れなかったイベントも回数が進む(product-launchの`stuck`の報告に当たるものは設計に無いため入れていない。送れないイベントの検知は送信の部品のwarnのログと4:21のinfoのログ`{swept, redispatched, overdue}`で、`redispatched`は送れなかった件数も含む。10.2・9.xの運用の文書に明記する)。送れなかったイベントを拾うのは4:21の送り直しだけで、各ジョブの先頭の掃き出しは確定のイベントが無いマッチにイベントを作るだけ(design.mdの`MatchEventDispatcher.publish`の説明と違うため、コードのコメントを直した)。4:21のジョブを列挙していた既存の3テスト(`product-scheduled-jobs.unit.test.ts`・`search-module.worker.test.ts`・`search-module.reextraction.worker.test.ts`)に2ジョブを足した。004の表に「終えているはずの時刻を一定の時間過ぎても処理されていない対象が残っている」を足した
- 6.1: `apps/api/src/application/match/match-view-reader.ts`(`DirectoryMatchViewReader`。設計の`findViews`に加え、照会済みの記録から組み立てる`assemble({records, viewer})`を公開する。トーナメントはどちらでも使える)と`qualifier-board-reader.ts`(`DirectoryQualifierBoardReader.read`、不戦勝は`{ view, entryId, reason }`の`QualifierBoardBye`、`nextKickoffAt`は当日0:00+24時間)。不整合な1件は`RangeError`だけを受け止めwarn「予選の一覧に置けないマッチを除きました」`{ matchId }`。配色の番号は設計に置き場所が無かったため`apps/common-lib/match/team-colors.ts`(`TEAM_COLOR_COUNT = 12`・`UNLINKED_TEAM_COLOR_INDEX = 0`・`teamColorIndexOf(productId)`、frontend-libのプレースホルダーの色と同じ31倍のハッシュ)を新設した。8.3のclientの`components/match/team-colors.ts`はこれを正として、0(中立)と1〜12の13通りの2色を持つ。同じマッチの両側が同じ番号になり得る(約1/12。spec・モックアップに禁止は無い)。`placementOf`と`Placement`の型を`board-order.ts`からエクスポートした。9.1でCLAUDE.mdのディレクトリ構成の`common-lib`の説明に`match/`(配色の番号)も加える。テストの偽物は`testing/view-fakes.ts`(`matchRecordOf`・`createFakeMatchDirectory`・`createFakeMatchBoardStore`・`createFakePairingDays`)
- 6.2: `apps/api/src/application/match/upvote-history-reader.ts`(`StoreUpvoteHistoryReader.read`。入力は設計どおり`viewer: CurrentUser | undefined`と`now`で`AccountGuard`は注入しない。検証の順は`first`(`RangeError`)→カーソル(`invalid_cursor`)→ハンドルの形式(null)→解決)・`upvote-history-cursor.ts`、ストアは`infrastructure/match/d1-upvote-history-store.ts`(`count`・`list`・`countByDates`、除外は`visibleProducts()`と`deleted_at IS NULL`、内部結合で紐付けの解除を落とす)。ストアはID・実施日・日時だけを返し、リーダーが`MatchDirectory.findMatches`と`ProductDirectory.findSummaries(…, 'visible')`で1回ずつ補い、その間に見えなくなった項目は落とす(続きの位置はストアの最後の行で決める)。要件10の目的(生活時間帯を推測させない)のため、レビューを受けて親が決めた方針: 続きの位置は`<実施日>:<マッチID>`だけで時刻もUpvoteのID(ULIDで時刻を含む)も含めない。ストアはその利用者の有効なUpvoteの`(upvoted_at, id)`を副問い合わせで引いて比べ、引けなければ(読み込みの間の取り消し等)その実施日より前の日から続ける。6.5のGraphQLの`UpvoteHistoryItem.id`はマッチIDにし、`UpvoteHistoryEntry.upvoteId`を公開しない。本人が読み込みの間に位置のマッチを付け替えると続きのページに既出の項目が含まれ得るため、8.11の画面は続きのページを足すときにマッチIDで重複を除く。design.mdの`read`の説明(`(match_date DESC, upvoted_at DESC, id DESC)`のカーソル)とは違う。`productViewOf`を`match-view-reader.ts`からエクスポートした。テストの偽物は`testing/upvote-history-fakes.ts`
- 6.3: スキーマモジュールは`apps/api/src/presentation/graphql/modules/match/`(`type-defs.ts`・`errors.ts`・`resolver-support.ts`(`clientOnly`・`accountGuardOf`)・`mappers.ts`・`match-views.ts`・`board-resolvers.ts`・`index.ts`)で、`GRAPHQL_SCHEMA_MODULES`の末尾に登録。`codegen.config.ts`で`Match`・`MatchEntry`・`MatchProduct`をapplicationの`MatchView`・`MatchEntryView`・`MatchProductView`にマッピングし、ローダーの結果をそのまま`Match`として返せる。ロゴ・カテゴリはproductの`productImageOf`・`productCategoryOf`を再利用。設計の`defineLoader<string, …>`と違い、`matchViewLoader`のキーは`{ matchId, session }`でキャッシュは`matchId`(一括読み込みにセッションが無いため。1リクエストに1つのセッション)。トーナメント・ディレクトリは`loadMatchView(context, matchId)`だけを使い、ローダーを直接`load`しない。6.3は盤面の型と`qualifierBoard`だけを置いた(引数もエラーも無いため)。6.4は`inputs.ts`(IDの形式の検証と`withInputPath`)・Upvoteのエラーの写像・SDLの`UpvoteInput`・`Mutation`・`MATCH_BOT_ACTIONS`・`assertHuman`(`resolver-support.ts`へ)を、6.5は`first`・`userHandle`の検証と履歴の型を作る。クエリの深さの上限は8でフラグメントの展開も1段に数える。最も深い経路`qualifierBoard › byes › match › entries › product › category|logo › 項目`はフラグメントなしで7段のため、8.1のクライアントの操作は最も深い経路にフラグメントを1つまでしか挟めない(`graphql:allowlist`の後に深さの拒否が出ないことを確かめる)。テストの補助は`apps/api/test/support/match-graphql-operations.ts`(Yogaはisolateごとにキャッシュされるため、モジュールの組を変えるテストは別のファイルにする)。9.2で`project-values.md`にmatchのGraphQLの操作の行(`qualifierBoard`・`upvoteHistory`・`upvote`・`cancelUpvote`、呼び出し元`client`以外の拒否)を加える
- 6.4: `modules/match/upvote-resolvers.ts`(`upvote(input: UpvoteInput!): Match!`・`cancelUpvote(matchId: ID!): Match!`)と`inputs.ts`(IDは`z.ulid(MATCH_ERRORS.match_not_found.message)`)。順は004の規約どおり`clientOnly`→`withValidatedArgs`→`requireVerifiedUser`→`assertHuman(context, MATCH_BOT_ACTIONS.upvote)`→ユースケース→`loadMatchView`(書き込みの後に読めなければ`match_not_found`)。`MATCH_BOT_ACTIONS`(`{ upvote: 'match_upvote' }`)・`assertHuman`・`clockOf`は`resolver-support.ts`(8.5のclientの写しの正)。`validation_error`の欄は`upvote`が`input.matchId`・`input.entryId`、`cancelUpvote`が`matchId`。経路ごとのレート制限は掛けない(設計に指定が無く、同種の書き込みと同じくWorker単位のIP制限とbot判定で守る)。テストの補助`match-graphql-operations.ts`に`UPVOTE`・`CANCEL_UPVOTE`・`upvote()`・`cancelUpvote()`・`detailsOf()`を追加
- 6.5: `modules/match/upvote-history-resolvers.ts`(`upvoteHistory(userHandle, first, after)`、client だけ・ログイン不要)。`first`・`after`の規則はproductの`productPageArgsOf(UPVOTE_HISTORY_PAGE_MAX)`を再利用し`launchHistory`と同じ文言・カーソル256文字の上限にした(presentation層のモジュール間の読み込みは既存の先例と同じ)。`UpvoteHistoryItem`は`codegen.config.ts`で手書きの`UpvoteHistoryItemModel`(`ownerUserId`を持ちUpvoteのIDを持たない)にマッピングし、`id`はマッチID。`owner`の項目のリゾルバは`match-views.ts`で`userSummaryLoader`を使う。最も深い経路は`upvoteHistory › nodes › product › category|logo › 項目`の5段。テストの補助に`UPVOTE_HISTORY`・`fetchUpvoteHistory`・`UpvoteHistoryFields`を追加
- 7.1: 実行器は`apps/event/src/application/match/match-event-runner.ts`(`MatchEventRunner.handle(body)`。設計の`(body, meta)`ではなく先例`ProductLifecycleRunner`に合わせた。待ちは`MATCH_EVENT_ORDER_WAIT_SECONDS = 60`、`continue`は`LIFECYCLE_CONTINUE_DELAY_SECONDS`(5秒)、ログの分類は`['event','match','events']`で属性は`eventId`・`type`・`handler`・`outcome`だけ)、ポートは`application/match/ports.ts`(`MatchEventHandlerResolver`。7.4が`MatchPurgeStore`を足す)、識別子は`application/match/event-match-types.ts`の`EVENT_MATCH_TYPES`(`Symbol.for('match.event.<名前>')`、足すタスクは単体テストも直す)。登録口は`composition/match-event-handlers.ts`の`MATCH_EVENT_HANDLERS`(初版は空。設計の「初版は1件」は7.2で一致する)。モジュールは`composition/match-module.ts`の`createEventMatchModule({ eventHandlers })`で作る`EVENT_MATCH_MODULE`(名前`event-match`、`EVENT_MATCH_PLATFORM_MODULE`の直後、組み立て時に登録を検証)で、7.2〜7.4の束縛はその`ContainerModule`へ加える。7.2は`match-module.worker.test.ts`の「初版は処理を持たない凍結済みの配列」のテストを登録の内容の検査に直す。`MESSAGE_HANDLERS`へ`retry: MATCH_EVENT_RETRY_POLICY`で登録した。9.2は`project-values.md`に`match.run-match-event`の挙動(60秒の待ち・5秒の再開・再試行の方針)、`EVENT_MATCH_TYPES`の接頭辞、`EVENT_MATCH_MODULE`を載せる
- 7.2: `apps/event/src/application/match/qualifier-outcome-handler.ts`(`QualifierOutcomeHandler`、登録`match-engine.qualifier-outcome`・decided・qualifier・1100)。`isWinningResult`で`won`・`lost`に写し、`match.decidedAt`(即時の終了も同じ値)で`LaunchOutcomeRecorder.record`へ渡す。紐付けの解除と`result`がnullの側を除き、残らなければ記録の口を呼ばない。マッチが無い・未確定はwarn(`outcome: 'match-not-decided'`)で`done`(確定とイベントは同じ一括の書き込みのため再試行で直らない)。ログの分類は設計のMonitoringの`['event','application','match']`ではなく実行器と同じ`['event','match','events']`(eventの先例も処理群が実行器の分類を共有する)。キューの補助は`apps/event/src/composition/testing/match-event-queue.ts`(`dispatchMatchEvent`・`matchEventEnvelope`・`defaultQueueHandler`)へ移した。ローンチの状態の確認はproduct-launchの`ProductDirectory.listLaunches`で読む
- 7.3: `apps/event/src/application/match/decision-follow-up-handlers.ts`(`AccountDecisionFollowUpHandler`・`ProductDecisionFollowUpHandler`、`DECISION_FOLLOW_UP_LOOKBACK_MS = 86_400_000`・`DECISION_FOLLOW_UP_LIMIT = 100`)。登録は`match-engine.account-decision-follow-up`(`withdrawn`・`suspended`)を`USER_LIFECYCLE_ASYNC_HANDLERS`へ、`match-engine.product-decision-follow-up`(`hidden`・`deleted`)を`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`へ(order 1100)。種類では絞らない(全体の掃き出しで冪等)。設計(design.mdの1528・1530行)とタスクの本文の「`done`」と違い、作った件数が上限の100件なら`continue`を返す(1つの事象で100件を超えるマッチが即時に終了したとき、日次のジョブまで最大で約19時間待つと要件5.5を満たせないため。007の規約にも合う)。登録の一覧を完全一致で確かめる他の機能の既存テスト6ファイル(event の`payments-module`・`ultras-module`・`profile-module`・`identity-module`・`payments-lifecycle-handlers`・`product-module`の`worker.test.ts`)に本specの処理名を足した(`product-module`は一覧の検査を`product-launch.`の接頭辞に絞った)。7.4も同じ箇所を直す。9.2は`project-values.md`の846行目(非同期の波及処理の列挙)・1045行目(`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`の説明)に2つの処理名・種類・order・挙動を加える
- 7.4: `apps/event/src/application/match/upvote-erasure-handler.ts`(`match-engine.upvote-erasure`、利用者の`purge_due`・1100。論理削除済みを含めて1,000件ずつ物理削除し、1,000件なら`continue`、未満なら`clearOwner`(`match_entries.owner_user_id`をNULL)して`done`)と`entry-unlink-handler.ts`(`match-engine.entry-unlink`、プロダクトの`purge_due`・1100。`product_id`・`launch_id`・`owner_user_id`をNULLにし`unlinked_at`に処理の時刻を記録して`done`)、ストアは`infrastructure/match/d1-match-purge-store.ts`(`MatchPurgeStore`、削除は`id IN (SELECT … LIMIT ?)`)。種類では絞らず登録で`purge_due`に限る。プロダクトを持つ利用者の物理削除は、product-launchの`product-erasure`(1000)がプロダクトの物理削除のイベントを作って`continue`→`entry-unlink`が紐付けを外してプロダクトを消す→再送で`upvote-erasure`が動き利用者が消える、の順で外部キーに当たらない。登録の一覧を完全一致で確かめる既存テストは`payments-module`・`ultras-module`・`profile-module`・`product-module`・`user-product-erasure`の`worker.test.ts`を直した。9.2は`project-values.md`の非同期の波及処理の列挙と`PRODUCT_LIFECYCLE_ASYNC_HANDLERS`の説明に2件を、`EVENT_MATCH_TYPES`に`MatchPurgeStore`・`UpvoteErasureHandler`・`EntryUnlinkHandler`を加える
- 8.1: 操作は`apps/client/src/graphql/operations/match/`の`qualifier-board.graphql`・`upvote.graphql`・`cancel-upvote.graphql`・`upvote-history.graphql`、フラグメントは`apps/client/src/graphql/fragments/match/`の`match.graphql`(`Match`→`MatchFragment`)・`match-bye.graphql`(`MatchBye`→`MatchByeFragment`)。設計はフラグメントも`operations/match/`に置く書き方だが、`codegen.unit.test.ts`の「1ファイル1操作」の検査に通らないため`fragments/`に置き、004の「操作の置き場所と名前」に置き場所と深さの注意を加えた。`ClientQualifierBoard`は深さの上限ちょうどで、フラグメントの中に別のフラグメントを入れない(`MatchBye.match`は`entries`を取らない)。6.3のNotesの「フラグメントなしで7段」とは数え方が1段違い、`qualifierBoard › matches › ...Match › entries › product › category › 項目`で上限ちょうど。トーナメントなどで`...Match`をより深い経路で展開すると上限を超えるため、項目を直接書くか浅い経路にする。`Match`の`date`・`startsAt`・`endsAt`は取らない(カウントダウンは盤面の`fullTimeAt`を使う)。部品の引数の型は`MatchFragment`(`useUpvote`・`MatchCard`)・`MatchByeFragment`(`ByeList`・`ByeCard`)・`ClientQualifierBoardQuery`・`ClientUpvoteHistoryQuery`。項目を足したらclientの`graphql:generate`とapiの`graphql:allowlist`をやり直す。9.2で`docs/onboardings/README.md`・`project-values.md`の操作の置き場所の説明に`fragments/`を1行加える
- 8.2: 型は`apps/client/src/components/top/top-page-section-types.ts`(置き場所5つ・文脈`board{date,phase:'LIVE'|'RESULT',serverTime}`・`viewer.signedIn`・`autoRefresh`・`reportAutoUpdating`・`TopPageSection`・`QualifierListInsert{id,order,every,component:{position}}`、生成物に依存しない)、規則は`top-page-section-order.ts`(`orderTopPageSections`・`groupTopPageSections`・`qualifierInsertCount`・`layoutQualifierList`・`TOP_PAGE_PLACEMENTS`)、登録口は`apps/client/src/composition/top-page-sections.ts`の`TOP_PAGE_SECTIONS`・`QUALIFIER_LIST_INSERTS`(初版は空。設計の「初版は2件」は8.10で一致する)。差し込みは要件9.3が指すページ配置のモバイルのGold(「一覧の2件毎に1枚挿入」)とモックアップに合わせ、`every`件ごとに置き、割り切れるときは最後の対戦カードの後にも置く(回数は`qualifierInsertCount = floor(件数/every)`、sponsorshipは余りを一覧の下に並べるときにこれを使う)。`position`は1から。8.8は`layoutQualifierList(cards, QUALIFIER_LIST_INSERTS)`で描き(keyは`${insert.id}:${position}`)差し込みにもエラー境界を付ける。8.9は`groupTopPageSections(TOP_PAGE_SECTIONS)`を使う。8.10で登録口に部品を加えて単体テストがサーバー専用の処理を読み込み失敗するなら、`public-profile-sections.browser.test.tsの`vi.mock`の先例に倣い登録の検査をブラウザテストへ移す。9.2で`project-values.md`の「画面の登録箇所」に`TOP_PAGE_SECTIONS`・`QUALIFIER_LIST_INSERTS`を加える
