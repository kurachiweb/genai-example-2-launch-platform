import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';

export type SvgSyntaxResult =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly code: 'invalid_svg' | 'svg_declaration_not_allowed';
    };

const INVALID_SVG: SvgSyntaxResult = Object.freeze({
  ok: false,
  code: 'invalid_svg',
});

const DECLARATION_NOT_ALLOWED: SvgSyntaxResult = Object.freeze({
  ok: false,
  code: 'svg_declaration_not_allowed',
});

// 構文の検査器は宣言を受け入れ、実体の件数と大きさにも上限が無いため、検査の前に宣言そのものを拒否する
const DECLARATION_PATTERN = /<!(?:DOCTYPE|ENTITY)/iu;

// 解析器の既定(100段)で整形式の文書を壊れたものとして拒否しないよう、SVGの安全性の検査の解析器と同じ上限を明示する
export const SVG_MAX_NESTED_TAGS = 256;

const VALIDATOR_OPTIONS = Object.freeze({
  allowBooleanAttributes: false,
  multipleRoots: false,
});

const ROOT_PARSER = new XMLParser({
  preserveOrder: true,
  processEntities: false,
  htmlEntities: false,
  ignoreAttributes: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  maxNestedTags: SVG_MAX_NESTED_TAGS,
});

const NON_ELEMENT_KEY_PATTERN = /^(?:#|\?|:@)/u;

const decodeUtf8 = (bytes: Uint8Array): string | undefined => {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    return undefined;
  }
};

const isWellFormed = (text: string): boolean => {
  try {
    return SyntaxValidator.validate(text, VALIDATOR_OPTIONS);
  } catch {
    return false;
  }
};

const rootElementNamesOf = (text: string): readonly string[] => {
  const nodes: unknown = ROOT_PARSER.parse(text);
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes.flatMap((node: unknown) =>
    typeof node === 'object' && node !== null
      ? Object.keys(node).filter((key) => !NON_ELEMENT_KEY_PATTERN.test(key))
      : [],
  );
};

const hasSvgRoot = (text: string): boolean => {
  try {
    const names = rootElementNamesOf(text);
    return names.length === 1 && names[0] === 'svg';
  } catch {
    return false;
  }
};

export function checkSvgSyntax(bytes: Uint8Array): SvgSyntaxResult {
  const text = decodeUtf8(bytes);
  if (text === undefined) {
    return INVALID_SVG;
  }
  if (DECLARATION_PATTERN.test(text)) {
    return DECLARATION_NOT_ALLOWED;
  }
  if (!isWellFormed(text) || !hasSvgRoot(text)) {
    return INVALID_SVG;
  }
  return Object.freeze({ ok: true, text });
}
