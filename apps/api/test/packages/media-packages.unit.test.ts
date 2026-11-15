import { describe, expect, test } from 'bun:test';

import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import { imageSize } from 'image-size';

const PNG_8X4 = Uint8Array.fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAAQUlEQVR4nAXBgQAAMAwDwZCUJCQlCclIQlKh352QGGGxIuKJipOQGWOzJuaZmrNQmOCwIeGFhotQmeKyJeWVlusH7Js4QbMwMQ4AAAAASUVORK5CYII=',
);

const SINGLE_ROOT = { multipleRoots: false } as const;

function validationFailureOf(xml: string, options = SINGLE_ROOT): unknown {
  try {
    SyntaxValidator.validate(xml, options);
  } catch (error) {
    return error;
  }
  throw new Error('検証が失敗しませんでした');
}

describe('メディアの検証が使うパッケージ(Bun)', () => {
  test('image-sizeがPNGの先頭から幅・高さ・形式を読み取る', () => {
    expect(imageSize(PNG_8X4)).toEqual({ width: 8, height: 4, type: 'png' });
  });

  test('fast-xml-validatorが整形式のSVGに対してtrueを返す', () => {
    expect(
      SyntaxValidator.validate(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1"/></svg>',
        SINGLE_ROOT,
      ),
    ).toBe(true);
  });

  test('fast-xml-validatorが閉じていない要素を、コードと位置を持つErrorを投げて拒否する', () => {
    expect(validationFailureOf('<svg><rect></svg>')).toMatchObject({
      name: 'ValidationError',
      code: 'InvalidTag',
      line: 1,
    });
  });

  test('fast-xml-validatorが値の無い属性を既定で拒否する', () => {
    expect(validationFailureOf('<svg hidden></svg>')).toBeInstanceOf(Error);
  });

  test('fast-xml-validatorは既定で複数の最上位要素を許し、multipleRoots: falseで拒否する', () => {
    expect(SyntaxValidator.validate('<svg></svg><svg></svg>')).toBe(true);
    expect(validationFailureOf('<svg></svg><svg></svg>')).toMatchObject({
      code: 'InvalidXml',
    });
  });

  test('fast-xml-validatorはDOCTYPEとENTITYの宣言を構文として受け入れる', () => {
    expect(
      SyntaxValidator.validate(
        '<!DOCTYPE svg [<!ENTITY a "x">]><svg>&a;</svg>',
        SINGLE_ROOT,
      ),
    ).toBe(true);
  });

  test('fast-xml-validatorは最上位の要素の名前を問わない', () => {
    expect(SyntaxValidator.validate('<html></html>', SINGLE_ROOT)).toBe(true);
  });

  test('fast-xml-parserの解析器が実体参照を展開せずに要素と属性を読み取る', () => {
    const parser = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
    });

    expect(parser.parse('<svg width="2"><title>&amp;</title></svg>')).toEqual({
      svg: { '@_width': '2', title: '&amp;' },
    });
  });
});
