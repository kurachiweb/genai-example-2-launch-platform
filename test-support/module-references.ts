import ts from 'typescript';

const isTypeOnlyImport = (node: ts.ImportDeclaration): boolean =>
  node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;

const isModuleCall = ({ expression }: ts.CallExpression): boolean =>
  expression.kind === ts.SyntaxKind.ImportKeyword ||
  (ts.isIdentifier(expression) && expression.text === 'require');

const isValueModuleReference = (node: ts.Node): boolean => {
  if (ts.isImportDeclaration(node)) {
    return !isTypeOnlyImport(node);
  }
  if (ts.isExportDeclaration(node)) {
    return node.moduleSpecifier !== undefined && !node.isTypeOnly;
  }
  if (ts.isImportEqualsDeclaration(node)) {
    return !node.isTypeOnly;
  }
  return ts.isCallExpression(node) && isModuleCall(node);
};

const isTypeOnlyImportDeclaration = (node: ts.Node): boolean =>
  ts.isImportDeclaration(node) && isTypeOnlyImport(node);

const collectNodes = (
  node: ts.Node,
  predicate: (node: ts.Node) => boolean,
): readonly string[] => [
  ...(predicate(node) ? [node.getText()] : []),
  ...node.getChildren().flatMap((child) => collectNodes(child, predicate)),
];

const parse = (source: string): ts.SourceFile =>
  ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);

export const valueModuleReferencesOf = (source: string): readonly string[] =>
  collectNodes(parse(source), isValueModuleReference);

export const typeOnlyImportsOf = (source: string): readonly string[] =>
  collectNodes(parse(source), isTypeOnlyImportDeclaration);
