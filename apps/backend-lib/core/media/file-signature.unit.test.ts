import { describe, expect, test } from 'bun:test';

import {
  detectSignature,
  SIGNATURE_PREFIX_BYTES,
  type SignatureMediaType,
} from './file-signature.ts';

const ascii = (text: string): number[] =>
  Array.from(text, (character) => character.charCodeAt(0));

const bytesOf = (...parts: readonly (readonly number[])[]): Uint8Array =>
  Uint8Array.from(parts.flat());

const padded = (head: readonly number[], length = 64): Uint8Array =>
  bytesOf(
    head,
    Array.from({ length: Math.max(0, length - head.length) }, () => 0),
  );

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const WEBP_HEAD = [...ascii('RIFF'), 0x24, 0x00, 0x00, 0x00, ...ascii('WEBP')];

const SIGNATURES: readonly (readonly [
  string,
  Uint8Array,
  SignatureMediaType,
])[] = [
  ['JPEG', padded(JPEG_HEAD), 'image/jpeg'],
  ['PNG', padded(PNG_HEAD), 'image/png'],
  ['GIF87a', padded(ascii('GIF87a')), 'image/gif'],
  ['GIF89a', padded(ascii('GIF89a')), 'image/gif'],
  ['WebP', padded(WEBP_HEAD), 'image/webp'],
  ['PDF', padded(ascii('%PDF-1.7\n')), 'application/pdf'],
];

describe('detectSignature', () => {
  test('先頭の12バイトだけで判定できる', () => {
    expect(SIGNATURE_PREFIX_BYTES).toBe(12);
  });

  test.each(SIGNATURES)(
    '%sのマジックバイトから形式を判定する',
    (_label, bytes, expected) => {
      expect(detectSignature(bytes)).toBe(expected);
      expect(detectSignature(bytes.subarray(0, SIGNATURE_PREFIX_BYTES))).toBe(
        expected,
      );
    },
  );

  test('PNGの申告にJPEGの本文を付けた偽装は、JPEGと判定されPNGにならない', () => {
    const disguised = padded(JPEG_HEAD);

    expect(detectSignature(disguised)).toBe('image/jpeg');
    expect(detectSignature(disguised)).not.toBe('image/png');
  });

  test.each([
    ['空のバイト列', new Uint8Array(0)],
    ['JPEGの3バイト目が欠けたもの', bytesOf([0xff, 0xd8])],
    ['JPEGの3バイト目が0xFFでないもの', padded([0xff, 0xd8, 0x00, 0xe0])],
    ['PNGの8バイト目が違うもの', padded([...PNG_HEAD.slice(0, 7), 0x00])],
    ['PNGの途中で切れたもの', bytesOf(PNG_HEAD.slice(0, 7))],
    ['GIF88a', padded(ascii('GIF88a'))],
    ['小文字のgif89a', padded(ascii('gif89a'))],
    ['RIFFだがWAVE', padded([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')])],
    ['RIFFの後の11バイトで切れたWebP', bytesOf(WEBP_HEAD.slice(0, 11))],
    ['%PDFの後に-が無いもの', padded(ascii('%PDF1.7'))],
    [
      'SVGのテキスト',
      padded(ascii('<svg xmlns="http://www.w3.org/2000/svg">')),
    ],
    ['プレーンテキスト', padded(ascii('hello, world'))],
  ])('%sは判定しない', (_label, bytes) => {
    expect(detectSignature(bytes)).toBeUndefined();
  });

  test('判定に使うのは先頭のマジックバイトだけで、2バイト目以降から始まる並びを判定しない', () => {
    expect(detectSignature(padded([0x00, ...PNG_HEAD]))).toBeUndefined();
  });
});
