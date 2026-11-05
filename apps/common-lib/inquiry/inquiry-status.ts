export type InquiryStatus = 'open' | 'in_progress' | 'resolved' | 'rejected';

export type InquiryKind = 'member' | 'guest';

export const INQUIRY_STATUSES: readonly InquiryStatus[] = Object.freeze([
  'open',
  'in_progress',
  'resolved',
  'rejected',
]);

export const INQUIRY_STATUS_LABELS: Readonly<Record<InquiryStatus, string>> =
  Object.freeze({
    open: '未対応',
    in_progress: '対応中',
    resolved: '対応済',
    rejected: '却下',
  });
