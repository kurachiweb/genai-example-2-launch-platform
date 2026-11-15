// 業務時刻の時差と選べる日の締め切りは、apps/backend-libのcore/time/business-time.tsのBUSINESS_UTC_OFFSET_MINUTESとcore/product/launch-status.tsのLAUNCH_SELECTION_CUTOFFの写しで、一致はルートのconfig/contract-copies.unit.test.tsが確かめる。マッチ直前の固定の始まりは同じlaunch-status.tsのPAIRING_TIMEの写しで、一致はconfig/launch-time-contract-copies.unit.test.tsが確かめる
export const BUSINESS_UTC_OFFSET_MINUTES = -480;

export const LAUNCH_SELECTION_CUTOFF = Object.freeze({ hour: 23, minute: 40 });

export const PAIRING_TIME = Object.freeze({ hour: 23, minute: 45 });

interface BusinessTimeOfDay {
  readonly hour: number;
  readonly minute: number;
}

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const MINUTES_PER_HOUR = 60;
const BUSINESS_OFFSET_MILLISECONDS =
  BUSINESS_UTC_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE;
const START_OF_DAY: BusinessTimeOfDay = Object.freeze({ hour: 0, minute: 0 });

// 業務時刻は夏時間の無い固定の時差のため、時差の分だけずらした時点のUTCの暦日が業務日付になる
export const businessDateOf = (at: Date): string =>
  new Date(at.getTime() + BUSINESS_OFFSET_MILLISECONDS)
    .toISOString()
    .slice(0, 10);

// 業務日付(YYYY-MM-DD)の業務時刻の時点を、その暦日のUTCの0:00から時差の分だけ戻して求める
const businessDateTimeOf = (
  date: string,
  { hour, minute }: BusinessTimeOfDay,
): Date =>
  new Date(
    Date.parse(`${date}T00:00:00.000Z`) +
      (hour * MINUTES_PER_HOUR + minute) * MILLISECONDS_PER_MINUTE -
      BUSINESS_OFFSET_MILLISECONDS,
  );

export const kickoffAtOf = (launchDate: string): string =>
  businessDateTimeOf(launchDate, START_OF_DAY).toISOString();

// 当日の締め切りを過ぎた後も取り直しが無いまま翌日を迎えられるよう、翌日の締め切りも返す
export const selectionCutoffsFrom = (
  businessDate: string,
): readonly string[] => {
  const cutoff = businessDateTimeOf(businessDate, LAUNCH_SELECTION_CUTOFF);
  return [
    cutoff.toISOString(),
    new Date(cutoff.getTime() + MILLISECONDS_PER_DAY).toISOString(),
  ];
};

// ローンチ日の前日の業務時刻の23:45から、ペアリングとマッチの間のローンチ日・カテゴリの変更と削除の固定が始まる
export const pairingAtOf = (launchDate: string): string =>
  new Date(
    businessDateTimeOf(launchDate, PAIRING_TIME).getTime() -
      MILLISECONDS_PER_DAY,
  ).toISOString();
