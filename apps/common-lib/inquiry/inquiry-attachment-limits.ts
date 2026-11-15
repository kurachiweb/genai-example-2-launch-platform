export const INQUIRY_ATTACHMENT_PURPOSE = 'inquiry-attachment';

export const INQUIRY_ATTACHMENT_LIMITS = Object.freeze({
  maxCount: 20,
  maxTotalBytes: 20_971_520,
  maxFileBytes: 20_971_520,
} as const);

export type AttachmentTotalsIssue = 'too-many' | 'too-large';

export const checkAttachmentTotals = (
  sizes: readonly number[],
): AttachmentTotalsIssue | undefined => {
  if (sizes.length > INQUIRY_ATTACHMENT_LIMITS.maxCount) {
    return 'too-many';
  }
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  return totalBytes > INQUIRY_ATTACHMENT_LIMITS.maxTotalBytes
    ? 'too-large'
    : undefined;
};
