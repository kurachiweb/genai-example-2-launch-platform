import type {
  InquiryKind,
  InquiryStatus,
} from '../../../common-lib/inquiry/inquiry-status.ts';

export type AdminOperationDenial =
  'withdrawn' | 'guest-not-repliable' | 'unchanged';

export const statusAfterUserMessage = (
  current: InquiryStatus,
): InquiryStatus =>
  current === 'resolved' || current === 'rejected' ? 'open' : current;

export const checkReplyable = (inquiry: {
  readonly kind: InquiryKind;
  readonly withdrawn: boolean;
}):
  | Extract<AdminOperationDenial, 'withdrawn' | 'guest-not-repliable'>
  | undefined => {
  if (inquiry.kind === 'guest') {
    return 'guest-not-repliable';
  }
  return inquiry.withdrawn ? 'withdrawn' : undefined;
};

export const checkStatusChangeable = (
  inquiry: { readonly withdrawn: boolean; readonly status: InquiryStatus },
  next: InquiryStatus,
): Extract<AdminOperationDenial, 'withdrawn' | 'unchanged'> | undefined => {
  if (inquiry.withdrawn) {
    return 'withdrawn';
  }
  return inquiry.status === next ? 'unchanged' : undefined;
};
