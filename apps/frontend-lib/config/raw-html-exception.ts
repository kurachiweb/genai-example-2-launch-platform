import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import ts from 'typescript';

export type RawHtmlExceptionKind =
  'lint-directive' | 'sanitized-html-assertion';

export interface RawHtmlException {
  readonly path: string;
  readonly line: number;
  readonly kind: RawHtmlExceptionKind;
}

export interface RawHtmlScanResult {
  readonly scannedPaths: readonly string[];
  readonly exceptions: readonly RawHtmlException[];
}

const SOURCE_GLOB = '**/*.{ts,tsx}';

// 静的解析が対象にしない依存パッケージ・ビルドの出力・自動生成のコードは走査しない
const IGNORED_PATH_PATTERN =
  /(?:^|\/)(?:node_modules|dist|\.output|\.tanstack|\.wrangler|coverage|storybook-static|generated)\/|\.gen\.ts$/u;

// innerHTMLへの代入とcreateElementでの危険な属性はno-restricted-syntaxの規則で禁止している
const RAW_HTML_RULES: ReadonlySet<string> = new Set([
  '@eslint-react/dom-no-dangerously-set-innerhtml',
  'no-restricted-syntax',
]);

// サニタイズ済みの型と、それを持つ描画結果の型は、描画部品の外で型の主張により作れないようにする
const SANITIZED_TYPE_NAMES: ReadonlySet<string> = new Set([
  'SanitizedHtml',
  'RenderedMarkdown',
]);

const DISABLE_DIRECTIVE_PATTERN =
  /^eslint-disable(?:-next-line|-line)?(?:\s+(?<rules>[^]*))?$/u;

const INLINE_CONFIG_PATTERN = /^eslint\s+(?<config>[^]*)$/u;

const commentBodyOf = (comment: string): string =>
  (comment.startsWith('//') ? comment.slice(2) : comment.slice(2, -2)).trim();

const rulesOf = (list: string): readonly string[] =>
  (list.split('--')[0] ?? '')
    .split(',')
    .map((rule) => rule.trim())
    .filter((rule) => rule !== '');

const disablesRawHtmlRule = (comment: string): boolean => {
  const body = commentBodyOf(comment);
  const directive = DISABLE_DIRECTIVE_PATTERN.exec(body);
  if (directive !== null) {
    const rules = rulesOf(directive.groups?.rules ?? '');
    return rules.length === 0 || rules.some((rule) => RAW_HTML_RULES.has(rule));
  }
  const config = comment.startsWith('/*')
    ? INLINE_CONFIG_PATTERN.exec(body)?.groups?.config
    : undefined;
  return (
    config !== undefined &&
    [...RAW_HTML_RULES].some((rule) => config.includes(rule))
  );
};

const scriptKindOf = (path: string): ts.ScriptKind =>
  path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

const mentionsSanitizedType = (node: ts.Node): boolean =>
  (ts.isIdentifier(node) && SANITIZED_TYPE_NAMES.has(node.text)) ||
  ts.forEachChild(
    node,
    (child) => mentionsSanitizedType(child) || undefined,
  ) === true;

const rightmostNameOf = (name: ts.EntityName): string =>
  ts.isIdentifier(name) ? name.text : name.right.text;

// 別名の型は、型そのものか、そのプロパティ・配列・合併の型として同じ型を表すものだけを数え、組み立てに使う型(Recordなど)は数えない
const aliasesSanitizedType = (type: ts.TypeNode): boolean => {
  if (ts.isTypeReferenceNode(type)) {
    return SANITIZED_TYPE_NAMES.has(rightmostNameOf(type.typeName));
  }
  if (ts.isIndexedAccessTypeNode(type)) {
    return aliasesSanitizedType(type.objectType);
  }
  if (ts.isArrayTypeNode(type)) {
    return aliasesSanitizedType(type.elementType);
  }
  if (ts.isTypeOperatorNode(type) || ts.isParenthesizedTypeNode(type)) {
    return aliasesSanitizedType(type.type);
  }
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
    return type.types.some(aliasesSanitizedType);
  }
  return false;
};

// 型の主張に加え、別名を付けた型は主張の検出を逃れるため、別名の付与も数える
const isSanitizedTypeAssertion = (node: ts.Node): boolean => {
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return mentionsSanitizedType(node.type);
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return aliasesSanitizedType(node.type);
  }
  if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) {
    return (
      node.propertyName !== undefined &&
      ts.isIdentifier(node.propertyName) &&
      SANITIZED_TYPE_NAMES.has(node.propertyName.text)
    );
  }
  return false;
};

interface Position {
  readonly pos: number;
  readonly kind: RawHtmlExceptionKind;
}

// コメントは構文木の節点に含まれないため、全ての字句の前後の空白とコメントを位置で重複を除いて集める。JSXの文字列の中の`//`はコメントではないため除く
const commentRangesOf = (
  sourceFile: ts.SourceFile,
): readonly ts.CommentRange[] => {
  const text = sourceFile.text;
  const ranges = new Map<number, ts.CommentRange>();
  const jsxTexts: ts.JsxText[] = [];
  const collect = (found: readonly ts.CommentRange[] | undefined): void => {
    for (const range of found ?? []) {
      ranges.set(range.pos, range);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      jsxTexts.push(node);
      return;
    }
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(sourceFile)) {
      visit(child);
    }
  };
  visit(sourceFile);
  return [...ranges.values()].filter(
    ({ pos }) => !jsxTexts.some((node) => pos >= node.pos && pos < node.end),
  );
};

const assertionPositionsOf = (
  sourceFile: ts.SourceFile,
): readonly Position[] => {
  const positions: Position[] = [];
  const visit = (node: ts.Node): void => {
    if (isSanitizedTypeAssertion(node)) {
      positions.push({
        pos: node.getStart(sourceFile),
        kind: 'sanitized-html-assertion',
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return positions;
};

export function findRawHtmlExceptionsInSource(
  path: string,
  source: string,
): readonly RawHtmlException[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(path),
  );
  const directivePositions = commentRangesOf(sourceFile)
    .filter(({ pos, end }) => disablesRawHtmlRule(source.slice(pos, end)))
    .map(({ pos }): Position => ({ pos, kind: 'lint-directive' }));
  return [...directivePositions, ...assertionPositionsOf(sourceFile)]
    .toSorted((left, right) => left.pos - right.pos)
    .map(({ pos, kind }) => ({
      path,
      line: sourceFile.getLineAndCharacterOfPosition(pos).line + 1,
      kind,
    }));
}

export async function findRawHtmlExceptions(
  rootDir: string,
): Promise<RawHtmlScanResult> {
  const scannedPaths = (
    await Array.fromAsync(
      new Bun.Glob(SOURCE_GLOB).scan({ cwd: rootDir, dot: true }),
    )
  )
    .filter((path) => !IGNORED_PATH_PATTERN.test(path))
    .toSorted();
  const exceptions = await Promise.all(
    scannedPaths.map(async (path) =>
      findRawHtmlExceptionsInSource(
        path,
        await readFile(join(rootDir, path), 'utf8'),
      ),
    ),
  );
  return { scannedPaths, exceptions: exceptions.flat() };
}
