export type TextContentViolation = 'invalid_utf8' | 'nul_character';

const TEXT_CONTENT_ERROR_MESSAGES: Readonly<
  Record<TextContentViolation, string>
> = Object.freeze({
  invalid_utf8: 'テキストがUTF-8として読み取れません',
  nul_character: 'テキストがNUL文字を含みます',
});

// ログやエラートラッキングへ本文が漏れないよう、メッセージは違反の種類だけから決める
export class TextContentError extends Error {
  override readonly name = 'TextContentError';
  readonly reason: TextContentViolation;

  constructor(reason: TextContentViolation) {
    super(TEXT_CONTENT_ERROR_MESSAGES[reason]);
    this.reason = reason;
  }
}

const NUL_CHARACTER = '\u0000';

export function createTextContentCheck(): TransformStream<
  Uint8Array,
  Uint8Array
> {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  const decode = (chunk?: Uint8Array): string => {
    try {
      return chunk === undefined
        ? decoder.decode()
        : decoder.decode(chunk, { stream: true });
    } catch {
      throw new TextContentError('invalid_utf8');
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (decode(chunk).includes(NUL_CHARACTER)) {
        throw new TextContentError('nul_character');
      }
      controller.enqueue(chunk);
    },
    flush() {
      decode();
    },
  });
}
