export const inquiryChatHref = (inquiryId: string): string =>
  `/inquiries/${encodeURIComponent(inquiryId)}`;
