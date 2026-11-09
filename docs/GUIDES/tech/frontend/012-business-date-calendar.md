# 業務日付のカレンダー

夏時間の無い固定の時差で決まる業務日付を、利用者にカレンダーで選ばせる画面の規約を定める。選べる範囲をサーバーから受け取る形、カレンダーの日と業務日付の写し、選べない日の示し方、業務日付と開始の日時の表示、画面に写す業務時刻の値、表示中に業務時刻の境界を越えたときの取り直し、及びテストを扱う。業務時刻と業務日付は「[非同期処理の設計の前提と用語](../infra/003-async-processing.md#前提と用語)」に、カレンダーの部品は「[共通化する部品](005-shared-components.md)」に、取得と無効化は「[データ取得](006-data-fetching.md)」に、取り直しと表示中の操作は「[表示中の画面の定期再取得](010-live-refresh-queries.md)」に、日時の`<time>`要素は「[マークアップの規約](001-markup-conventions.md)」に従う。

## 前提と用語

部品の置き場所は、共通部品のディレクトリと、画面のアプリの`src/`からのパスで示す。

| 部品                                                        | 置き場所                                                      | 役割                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `Calendar`(`unavailableReasonOf`)                           | 共通部品の`components/ui/calendar/calendar.tsx`               | 月ごとのカレンダー。理由のある日をフォーカスできる選べない日として示す |
| `BUSINESS_UTC_OFFSET_MINUTES`・境界の時刻・`businessDateOf` | 画面のアプリの`components/<ドメイン>/business-time.ts`        | バックエンドの業務時刻の値の写しと、業務日付・境界の日時の計算         |
| `calendarDayOf`・`businessDateOfCalendarDay`                | 画面のアプリの`components/<ドメイン>/`                        | 業務日付とカレンダーの日(閲覧者のローカルの0:00の`Date`)の相互の写し   |
| `useBoundaryRefresh`・`BOUNDARY_REFRESH_DELAY_MS`           | 画面のアプリの`components/<ドメイン>/use-boundary-refresh.ts` | 表示中に業務時刻の境界を越えたときのタイマーによる取り直し             |
| 業務日付の整形と表示の部品                                  | 画面のアプリの`components/<ドメイン>/`                        | 業務日付を文字列のまま`<time>`要素で示す                               |

| 用語               | 意味                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| 予約の日           | 利用者がカレンダーで選ぶ業務日付(`YYYY-MM-DD`)。時点ではなく暦の日を表す                               |
| 選べる範囲         | サーバーが返す、選べる最も早い日・最も遅い日と、その間の選べない範囲(理由付き)                         |
| 開始の日時         | 予約の日の業務時刻の0:00の時点。利用者のタイムゾーンでは別の日付・時刻になり得る                       |
| 境界の時刻         | サーバーの答えが変わる業務時刻(選べる日の締め切り・変更の固定の始まり・開始の日時など)                 |
| カレンダーの日     | カレンダーの部品が受け渡す`Date`。閲覧者のブラウザのローカルの0:00で表す                               |
| 表示のタイムゾーン | 利用者が表示の設定で選んだタイムゾーン。日時の表示に使い、ブラウザのローカルのタイムゾーンと異なり得る |

本文中の`<選べる日の締め切りの時刻>`などのプレースホルダーの本プロジェクトの値は、技術ドキュメントに写さず、プロジェクト固有の値の文書「[本プロジェクト固有の値](../../../onboardings/project-values.md)」に置く。

## 選べる範囲をサーバーから受け取る

選べる日の規則(締め切り・間隔・期間の上限・他の機能の条件)はサーバーが決め、画面は規則を持たない。サーバーは選べる範囲を業務日付で返す。

```typescript
export interface DateWindowView {
  // 業務日付(YYYY-MM-DD)。earliestからlatestまでのうちunavailableの範囲(両端を含む)を除く日を選べる
  readonly earliest: string;
  readonly latest: string;
  readonly unavailable: readonly {
    readonly from: string;
    readonly to: string;
    readonly reason: 'deadline_passed' | 'interval' | 'out_of_range';
  }[];
}
```

- 理由はコードで返し、文言は画面のアプリの文言の定数で示す。
- `earliest`より前の日は締め切りを過ぎた日、`latest`より後の日は選べる期間の外として扱う。範囲に無い日に理由を与え、全ての選べない日に理由を示す。
- 業務日付は`YYYY-MM-DD`の固定長のため、前後の比較は文字列の比較で行う。`Date`に直して比べない。
- サーバーは保存の時に選んだ日を同じ規則で確かめ直す。表示中に締め切りを過ぎた日や、別の画面の変更で選べなくなった日の保存は、拒否の応答(選べる最も早い日を含む文言)になる。画面は拒否を受けたら選べる範囲と対象の取得を無効にし、最新の範囲を示してから選び直させる(「[送信の後の無効化](010-live-refresh-queries.md#送信の後の無効化)」)。

## カレンダーの日と業務日付の写し

カレンダーの部品は、日を閲覧者のローカルの0:00の`Date`で受け渡す。業務日付とカレンダーの日は、暦の年・月・日を同じにして写し、タイムゾーンで日をずらさない。

```typescript
export const calendarDayOf = (businessDate: string): Date => {
  const utcMidnight = new Date(`${businessDate}T00:00:00.000Z`);
  return new Date(
    utcMidnight.getUTCFullYear(),
    utcMidnight.getUTCMonth(),
    utcMidnight.getUTCDate(),
  );
};

export const businessDateOfCalendarDay = (day: Date): string =>
  `${String(day.getFullYear())}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
```

- `new Date('YYYY-MM-DD')`をそのままカレンダーへ渡さない。日付だけの文字列はUTCの0:00と解釈され、UTCより西のタイムゾーンでは前日になる。
- カレンダーから受け取った日は、`businessDateOfCalendarDay`で業務日付に戻してから比べ、送る。
- カレンダーの「今日」の印と表示を始める月は、閲覧者のローカルの今日ではなく業務日付の今日(`businessDateOf(new Date())`をカレンダーの日へ写した日)にする。業務日付とローカルの日付は、時差の分だけ食い違う時間帯がある。

## 選べない日の示し方

選べない日は、共通部品の`Calendar`の`unavailableReasonOf`に、理由の文言を返す関数で渡す。理由のある日は`aria-disabled`になり、フォーカスできるが選べず、名前の末尾と`Tooltip`で理由を示す(「[共通化する部品](005-shared-components.md)」の`Calendar`の行)。

```tsx
const reasonOf = useCallback(
  (day: Date): string | undefined => {
    const reason = unavailableReasonOn(window, businessDateOfCalendarDay(day));
    return reason === undefined ? undefined : UNAVAILABLE_REASONS[reason];
  },
  [window],
);

<Calendar
  mode="single"
  selected={value === null ? undefined : calendarDayOf(value)}
  today={calendarDayOf(businessToday)}
  startMonth={calendarDayOf(businessToday)}
  endMonth={calendarDayOf(window.latest)}
  unavailableReasonOf={reasonOf}
/>;
```

- 選べない日を`DayPicker`の`disabled`で渡さない。フォーカスできず矢印キーで飛ばされ、利用者が理由を知れない。
- 必須の欄(選んだ日を外せない欄)は、選んだ日をもう一度押しても選択を解除しない。任意の欄だけ、解除で`null`にする。
- 送信の検証の失敗で欄へフォーカスを移すときは、カレンダーのTabの停止位置の日(`tabindex="0"`の日のボタン)へ移す。

## 業務日付と開始の日時の表示

予約の日は業務日付のまま示し、開始の日時は表示のタイムゾーンで示す。

| 値         | 表示                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 予約の日   | `<time dateTime="YYYY-MM-DD">`。内容は業務日付の文字列の年・月・日から整形する。表示のタイムゾーンへ変換する日時の表示部品に渡さない |
| 開始の日時 | `<time dateTime="<ISO形式の日時文字列>">`。表示のタイムゾーンの日時と、残りの相対表現(「あと2日」など)を示す                         |

```tsx
export function BusinessDateText({ date }: { readonly date: string }) {
  const currentYear = useCurrentYear();
  return <time dateTime={date}>{formatBusinessDate(date, currentYear)}</time>;
}
```

- 業務日付を日時の表示部品へ渡すと、業務日付の0:00の時点を表示のタイムゾーンへ変換するため、UTCより東か西かで前日や翌日になる。
- 日付だけの`datetime`属性(`YYYY-MM-DD`)は、HTMLの有効な日付の文字列で、ISO 8601の暦日の形である。時刻を持たない値は時刻を付けずに示す。
- 年の省略など日付の示し方は文言の規則に従う。「今年」は表示のタイムゾーンの今年で判定する。
- 保存済みの予約の開始の日時はサーバーが返す値を使う。選んだだけで保存していない日の開始の日時は、写した時差から画面で求める(「[業務時刻の値の写し](#業務時刻の値の写し)」)。

## 業務時刻の値の写し

画面のアプリがバックエンドの共通ライブラリを読み込めないときは、業務時刻のUTCとの差(`BUSINESS_UTC_OFFSET_MINUTES`)と画面で使う境界の時刻(`<選べる日の締め切りの時刻>`・`<変更の固定の始まりの時刻>`など)を、画面のアプリの1つのファイル(`components/<ドメイン>/business-time.ts`)へ写す。値がフロントエンドとバックエンドの共用部品にあれば、写さずに読み込む。

```typescript
// 業務時刻の時差と境界の時刻は、バックエンドの共通ライブラリの<元の場所>の写しで、一致はルートの<照合のテスト>が確かめる
export const BUSINESS_UTC_OFFSET_MINUTES = <業務時刻のUTCとの差>;

export const SELECTION_CUTOFF = Object.freeze({ hour: <時>, minute: <分> });

// 業務時刻は夏時間の無い固定の時差のため、時差の分だけずらした時点のUTCの暦日が業務日付になる
export const businessDateOf = (at: Date): string =>
  new Date(at.getTime() + BUSINESS_UTC_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 10);
```

- 写しと元の一致は、ルートの照合のテストで確かめる(「[アプリ間で写した値の照合](../testing/001-test-strategy.md#アプリ間で写した値の照合)」)。照合のテストのファイルを足したら、一括検査の「写しの照合」のスクリプトにも加える。
- 業務日付と境界の時点は、写した時差だけで計算する。`Intl.DateTimeFormat`のタイムゾーン名を使わない。業務時刻は夏時間を持たず、タイムゾーン名との対応はプロジェクトごとに異なる。
- 写すのは、画面が自分で時点を求める必要のある値だけにする。選べる範囲などサーバーが返せる値は写さずに受け取る。

## 表示中の境界の取り直し

表示中の画面が業務時刻の境界を越えたら、その時刻にタイマーで、境界で変わる取得を無効にして取り直す。境界は、表示している値から求めた業務時刻の時点(ISO形式の日時文字列)の並びで渡す。

```tsx
const refresh = useCallback(() => {
  void queryClient.invalidateQueries({
    queryKey: [documentIdOf(ScheduleDocument)],
  });
}, [queryClient]);
useBoundaryRefresh(boundariesOf(schedule), refresh);
```

| 規則                                                                   | 理由                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 境界の1秒(`BOUNDARY_REFRESH_DELAY_MS`)後に取り直す                     | 閲覧者とサーバーの時計の小さなずれで、境界の直前の状態を取り直さないため       |
| 次の境界だけにタイマーを掛け、過ぎた境界は扱わない                     | 取り直しの後に境界の並びが変わらなければ、残りの境界のタイマーを掛け直す       |
| 境界の並びを並べ替えた文字列で比べる                                   | 境界の配列は描画ごとに新しくなるため、同じ境界の間はタイマーを掛け直さない     |
| 待ちが`setTimeout`の上限(2^31−1ミリ秒)を超えたら、上限で起きて待ち直す | `setTimeout`は上限を超える待ちを即時に実行し、取り直しが繰り返される           |
| 当日の締め切りに加えて翌日の締め切りも渡す                             | 当日の締め切りの後に取り直しが無いまま翌日を迎えても、翌日の締め切りで取り直す |

- 定期再取得(`refetchInterval`)は使わない。境界は決まった時刻で、その間に値は変わらない。定期再取得は自動で更新される区画として停止の手段(「自動更新」の切り替え)を求め(「[止める手段](010-live-refresh-queries.md#止める手段)」)、間隔ごとの呼び出しがIP単位の制限の回数に数えられる。
- 境界は、表示している値が変わる時刻に絞る。一覧では、項目の状態の表示が大きく変わる境界(開始の日時など)だけにし、案内の文の切り替えなどは次の取得まで遅れてよい。1ページの境界の数だけ取り直しが起き得る(「[1ページの描画あたりの呼び出し回数の目安](006-data-fetching.md#1ページの描画あたりの呼び出し回数の目安)」)。
- 業務日付の今日は、描画のたびに読み直し、購読しない(`useSyncExternalStore`の購読を何もしない関数にする)。境界の取り直しで描き直されたときに、新しい今日になる。
- 取り直しで押せなくなるボタン(固定の始まりで無効になる削除など)は、フォーカスのある間は`aria-disabled`にし、フォーカスが離れてから`disabled`にする(「[取り直しと表示中の操作](010-live-refresh-queries.md#取り直しと表示中の操作)」)。
- 取り直しで入力中のフォームの値を作り直さない。フォームは保存の成功と、利用者が最新の内容の読み込みを選んだときだけ作り直す。

## テスト

- 写しの関数(業務日付・境界の時点・カレンダーの日の写し)の単体テストは、業務日付の境界の前後(0:00の直前と直後・締め切りの直前と直後)、月末・年末をまたぐ日、選べない範囲の両端を確かめる。
- ブラウザテストは、表示のタイムゾーンを業務時刻から東西に大きく離れた値(UTC−10とUTC+14など)にして、今日の印・予約の日・選んだ日が業務日付のまま示され、開始の日時だけが表示のタイムゾーンで示されることを確かめる。
- 境界の取り直しは、偽のタイマー(`vi.useFakeTimers({ now, toFake: ['Date', 'setTimeout', 'clearTimeout'] })`)で時間を進め、境界と遅れの1ミリ秒前には取り直さず、ちょうどで1回取り直すこと、過ぎた境界と境界の無い場合に取り直さないこと、`setTimeout`の上限より先の境界をすぐに取り直さないことを確かめる(「[テストでの時間の進め方](010-live-refresh-queries.md#テストでの時間の進め方)」)。
- ブラウザテストの操作は`aria-disabled`の要素を無効とみなして押せるまで待つ。選べない日を押した結果(選ばれないこと)を確かめるときは、`click({ force: true })`で押す。
