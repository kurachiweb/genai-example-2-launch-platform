export type SecondFactorInput =
  | { readonly kind: 'totp'; readonly code: string }
  | { readonly kind: 'recovery'; readonly code: string };

// 空白を除く前の入力の上限。正規化の処理量を入力の長さで抑える
const INPUT_MAX_LENGTH = 32;

const TOTP_CODE_PATTERN = /^[0-9]{6}$/;

const WHITE_SPACE = /\p{White_Space}/gu;

// 日本語の入力方式で全角の数字が入っても照合できるよう、NFKCで半角へ揃える
export const normalizeTotpCode = (input: string): string | undefined => {
  if (input.length > INPUT_MAX_LENGTH) {
    return undefined;
  }
  const normalized = input.normalize('NFKC').replace(WHITE_SPACE, '');
  return TOTP_CODE_PATTERN.test(normalized) ? normalized : undefined;
};
