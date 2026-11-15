import { INQUIRY_ATTACHMENT_PURPOSE } from '../../common-lib/inquiry/inquiry-attachment-limits.ts';
import { INQUIRY_TYPES } from '../application/inquiry/inquiry-types.ts';
import type { FileReadPolicyRegistration } from '../application/media/file-access-policies.ts';

export const FILE_READ_POLICIES: readonly FileReadPolicyRegistration[] = [
  {
    purpose: INQUIRY_ATTACHMENT_PURPOSE,
    policy: INQUIRY_TYPES.InquiryAttachmentReadPolicy,
  },
];
