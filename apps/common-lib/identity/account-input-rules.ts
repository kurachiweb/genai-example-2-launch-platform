import { countGraphemes } from '../text/graphemes.ts';
import { trimWhiteSpace } from '../text/white-space.ts';

export const NICKNAME_MAX_GRAPHEMES = 25;

export const EMAIL_MAX_LENGTH = 254;

export const PASSWORD_MIN_CODE_POINTS = 8;

export const PASSWORD_MAX_CODE_POINTS = 128;

export type NicknameCheck = 'ok' | 'empty' | 'too-long';

export type PasswordLengthCheck = 'ok' | 'too-short' | 'too-long';

const LAST_BMP_CODE_POINT = 0xffff;

// 補助面の文字はUTF-16の2単位を1つのコードポイントと数え、対になっていないサロゲートは1単位を1つと数える
export const countCodePoints = (value: string): number => {
  let count = 0;
  for (let index = 0; index < value.length; count += 1) {
    index += (value.codePointAt(index) ?? 0) > LAST_BMP_CODE_POINT ? 2 : 1;
  }
  return count;
};

export const checkNickname = (value: string): NicknameCheck => {
  const graphemes = countGraphemes(trimWhiteSpace(value));
  if (graphemes === 0) {
    return 'empty';
  }
  return graphemes > NICKNAME_MAX_GRAPHEMES ? 'too-long' : 'ok';
};

export const checkPasswordLength = (value: string): PasswordLengthCheck => {
  const codePoints = countCodePoints(value);
  if (codePoints < PASSWORD_MIN_CODE_POINTS) {
    return 'too-short';
  }
  return codePoints > PASSWORD_MAX_CODE_POINTS ? 'too-long' : 'ok';
};
