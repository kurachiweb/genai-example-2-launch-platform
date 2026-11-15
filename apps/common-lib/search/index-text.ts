import { trimWhiteSpace } from '../text/white-space.ts';
import { separateEmoji } from './emoji-separator.ts';

const WHITESPACE_RUN = /\p{White_Space}+/gu;

// 互換分解で文字になる絵文字(™・ℹ・㊗など)を文字として残すため、絵文字の置き換えはNFKCの後に行う
export const normalizeIndexText = (text: string): string =>
  trimWhiteSpace(separateEmoji(text.normalize('NFKC'))).replace(
    WHITESPACE_RUN,
    ' ',
  );
