import { REPORT_CATEGORY_OTHER_NAME } from '../../../../common-lib/reporting/report-rules.ts';
import { CATEGORY_DELETE_DESCRIPTION } from '../../../../lib/utilities/messages/admin-console-messages.ts';

export const REPORT_CATEGORIES_TITLE = '通報カテゴリ';

const countFormat = new Intl.NumberFormat('ja-JP');

export const reportCategoryDeleteDescription = (reportCount: number): string =>
  reportCount === 0
    ? CATEGORY_DELETE_DESCRIPTION
    : `このカテゴリの通報${countFormat.format(reportCount)}件は「${REPORT_CATEGORY_OTHER_NAME}」へ付け替えます。`;
