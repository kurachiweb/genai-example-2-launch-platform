import type { RasterImageMediaType } from '../../../common-lib/media/media-types.ts';

export type SignatureMediaType = RasterImageMediaType | 'application/pdf';

export const SIGNATURE_PREFIX_BYTES = 12;

const ANY_BYTE = null;

type SignaturePattern = readonly (number | typeof ANY_BYTE)[];

const asciiPattern = (text: string): SignaturePattern =>
  Array.from(text, (character) => character.charCodeAt(0));

const SIGNATURES: readonly (readonly [SignatureMediaType, SignaturePattern])[] =
  Object.freeze([
    ['image/jpeg', [0xff, 0xd8, 0xff]],
    ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ['image/gif', asciiPattern('GIF87a')],
    ['image/gif', asciiPattern('GIF89a')],
    [
      'image/webp',
      [
        ...asciiPattern('RIFF'),
        ANY_BYTE,
        ANY_BYTE,
        ANY_BYTE,
        ANY_BYTE,
        ...asciiPattern('WEBP'),
      ],
    ],
    ['application/pdf', asciiPattern('%PDF-')],
  ]);

const matches = (prefix: Uint8Array, pattern: SignaturePattern): boolean =>
  prefix.length >= pattern.length &&
  pattern.every(
    (expected, index) => expected === ANY_BYTE || prefix[index] === expected,
  );

export function detectSignature(
  prefix: Uint8Array,
): SignatureMediaType | undefined {
  return SIGNATURES.find(([, pattern]) => matches(prefix, pattern))?.[0];
}
