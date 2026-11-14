import { countGraphemes } from '../text/graphemes.ts';
import { hasForbiddenCharacters } from '../text/text-safety.ts';
import { trimWhiteSpace } from '../text/white-space.ts';

export const GUEST_NICKNAME_MAX = 25;

export const INQUIRY_BODY_MAX = 5_000;

export const CHAT_MESSAGE_MAX = 1_000;

export const INQUIRY_CURSOR_MAX = 256;

export type InquiryTextIssue = 'forbidden-character' | 'empty' | 'too-long';

const checkRequiredText = (
  value: string,
  max: number,
): InquiryTextIssue | undefined => {
  // VT・FF・NELは空白でもあるため、前後の空白を除く前に調べて、端にあっても黙って除かずに拒む
  if (hasForbiddenCharacters(value)) {
    return 'forbidden-character';
  }
  const graphemes = countGraphemes(trimWhiteSpace(value));
  if (graphemes === 0) {
    return 'empty';
  }
  return graphemes > max ? 'too-long' : undefined;
};

export const checkGuestNickname = (
  value: string,
): InquiryTextIssue | undefined => checkRequiredText(value, GUEST_NICKNAME_MAX);

export const checkInquiryBody = (value: string): InquiryTextIssue | undefined =>
  checkRequiredText(value, INQUIRY_BODY_MAX);

export const checkChatMessage = (value: string): InquiryTextIssue | undefined =>
  checkRequiredText(value, CHAT_MESSAGE_MAX);

const limitFormat = new Intl.NumberFormat('ja-JP');

const messagesOf = (
  subject: string,
  max: number,
): Readonly<Record<InquiryTextIssue, string>> =>
  Object.freeze({
    'forbidden-character': `${subject}に使用できない文字が含まれています。`,
    empty: `${subject}を入力してください。`,
    'too-long': `${subject}は${limitFormat.format(max)}文字以内で入力してください。`,
  });

export const GUEST_NICKNAME_MESSAGES = messagesOf(
  'ニックネーム',
  GUEST_NICKNAME_MAX,
);

export const INQUIRY_BODY_MESSAGES = messagesOf('メッセージ', INQUIRY_BODY_MAX);

export const CHAT_MESSAGE_MESSAGES = messagesOf('メッセージ', CHAT_MESSAGE_MAX);
