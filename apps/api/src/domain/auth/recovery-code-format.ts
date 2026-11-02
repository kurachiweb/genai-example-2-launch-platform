export const RECOVERY_CODE_COUNT = 10;

export const RECOVERY_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export const RECOVERY_CODE_LENGTH = 16;

const DISPLAY_GROUP_SIZE = 4;

const DISPLAY_SEPARATOR = '-';

// 区切りと空白を除く前の入力の上限。正規化の処理量を入力の長さで抑える
const INPUT_MAX_LENGTH = 64;

const RAW_CODE_PATTERN = new RegExp(
  `^[${RECOVERY_CODE_ALPHABET}]{${String(RECOVERY_CODE_LENGTH)}}$`,
);

const IGNORED_INPUT_CHARACTERS = /[\p{White_Space}\p{Dash_Punctuation}]/gu;

export const formatRecoveryCode = (raw: string): string => {
  if (!RAW_CODE_PATTERN.test(raw)) {
    throw new RangeError('リカバリコードが発行の形ではありません。');
  }
  const groups: string[] = [];
  for (let index = 0; index < raw.length; index += DISPLAY_GROUP_SIZE) {
    groups.push(raw.slice(index, index + DISPLAY_GROUP_SIZE));
  }
  return groups.join(DISPLAY_SEPARATOR);
};

// 日本語の入力方式で全角の英数字・ハイフンが入っても照合できるよう、NFKCで半角へ揃えてから区切りを除く
export const normalizeRecoveryCodeInput = (
  input: string,
): string | undefined => {
  if (input.length > INPUT_MAX_LENGTH) {
    return undefined;
  }
  const normalized = input
    .normalize('NFKC')
    .replace(IGNORED_INPUT_CHARACTERS, '')
    .toLowerCase();
  return RAW_CODE_PATTERN.test(normalized) ? normalized : undefined;
};
