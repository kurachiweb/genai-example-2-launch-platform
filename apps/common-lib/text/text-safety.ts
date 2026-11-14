const ALLOWED_CONTROL_CODES: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d]);

const LAST_C0_CONTROL_CODE = 0x1f;

const DELETE_CODE = 0x7f;

const FIRST_C1_CONTROL_CODE = 0x80;

const LAST_C1_CONTROL_CODE = 0x9f;

const isForbiddenControlCode = (code: number): boolean =>
  (code <= LAST_C0_CONTROL_CODE && !ALLOWED_CONTROL_CODES.has(code)) ||
  code === DELETE_CODE ||
  (code >= FIRST_C1_CONTROL_CODE && code <= LAST_C1_CONTROL_CODE);

const hasForbiddenControlCharacter = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    if (isForbiddenControlCode(text.charCodeAt(index))) {
      return true;
    }
  }
  return false;
};

export const hasForbiddenCharacters = (text: string): boolean =>
  !text.isWellFormed() || hasForbiddenControlCharacter(text);
