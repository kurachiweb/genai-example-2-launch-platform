import { reportCountLabel } from '../shared/report-messages.ts';

export const UNHANDLED_REPORTS_TITLE = '未対応の通報';

export const NO_UNHANDLED_REPORTS_MESSAGE = '未対応の通報はありません。';

export const infringementBreakdownLabel = (count: number): string =>
  `(うち権利侵害${reportCountLabel(count)})`;
