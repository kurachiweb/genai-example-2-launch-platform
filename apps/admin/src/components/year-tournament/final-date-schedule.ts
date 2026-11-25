import type { AdminYearFinalDateSetting } from '../../graphql/admin-year-final-date.ts';

export interface FinalDateChoiceSchedule {
  readonly acceptUntil: Date;
  readonly drawAt: Date;
}

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const epochOfBusinessDate = (date: string): number => {
  const epoch = BUSINESS_DATE_PATTERN.test(date)
    ? Date.parse(`${date}T00:00:00.000Z`)
    : Number.NaN;
  if (Number.isNaN(epoch)) {
    throw new RangeError(`業務日付の形でない値です: ${date}`);
  }
  return epoch;
};

// 受付期限と組み合わせ決定は決勝実施日から一定の日数前の業務時刻で決まり、業務時刻は夏時間の無い固定の時差のため、サーバーが返した現在の日時を決勝実施日の暦日の差だけずらすと選んだ日の日時になる。規則の日数・時刻・時差をサーバーと二重に持たないためにこう求める
export const scheduleOfChoice = (
  setting: AdminYearFinalDateSetting,
  finalDate: string,
): FinalDateChoiceSchedule => {
  const shift =
    epochOfBusinessDate(finalDate) - epochOfBusinessDate(setting.finalDate);
  return {
    acceptUntil: new Date(Date.parse(setting.acceptUntil) + shift),
    drawAt: new Date(Date.parse(setting.drawAt) + shift),
  };
};
