import type { BusinessTimeOfDay } from '../time/business-time.ts';

// 開始通知を依頼待ちにする日次のジョブの業務時刻。決済の確定もこの時刻で、自分で開始通知を依頼待ちにするかを決める
export const SPONSORSHIP_DAILY_NOTICES_TIME: BusinessTimeOfDay = Object.freeze({
  hour: 0,
  minute: 7,
});
