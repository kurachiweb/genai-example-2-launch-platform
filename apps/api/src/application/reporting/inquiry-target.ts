import type { ReportTargetKind } from '../../../common-lib/reporting/report-rules.ts';
import type { ReportTargetView } from './ports.ts';

const PROFILE_PATH_PREFIX = '/@';

const PRODUCT_PATH_PREFIX = '/p/';

// 照会は利用者側のページを見て回答してもらうため、このパスを示せない対象には送らず、画面にも照会の操作を出さない
export const inquiryTargetPathOf = (
  kind: ReportTargetKind,
  view: ReportTargetView | undefined,
): string | undefined => {
  if (view?.available !== true) {
    return undefined;
  }
  const handle = kind === 'comment' ? view.productHandle : view.handle;
  if (handle === null) {
    return undefined;
  }
  const prefix = kind === 'user' ? PROFILE_PATH_PREFIX : PRODUCT_PATH_PREFIX;
  return `${prefix}${encodeURIComponent(handle)}`;
};
