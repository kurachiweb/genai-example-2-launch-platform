import { trimWhiteSpace } from '../text/white-space.ts';

const WHITESPACE_RUN = /\p{White_Space}+/gu;

export const normalizeIndexText = (text: string): string =>
  trimWhiteSpace(text.normalize('NFKC')).replace(WHITESPACE_RUN, ' ');
