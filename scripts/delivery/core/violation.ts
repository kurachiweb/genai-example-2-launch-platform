export interface ContractViolation {
  readonly rule: string;
  readonly file: string;
  readonly path: string;
  readonly actual: string;
  readonly expected: string;
}

export type TableRow = readonly string[];

const HEADER: TableRow = ['規則', 'ファイル', '項目', '実際', '期待'];

const NO_VIOLATIONS = '違反はありません。';

const EMPTY_VALUE = '(なし)';

const countLineOf = (violations: readonly ContractViolation[]): string =>
  `違反が${String(violations.length)}件あります。`;

const rowOf = ({
  rule,
  file,
  path,
  actual,
  expected,
}: ContractViolation): TableRow => [rule, file, path, actual, expected];

const textValueOf = (value: string): string =>
  value === '' ? EMPTY_VALUE : value.replaceAll(/\r?\n/g, String.raw`\n`);

const padToWidth = (text: string, width: number): string =>
  `${text}${' '.repeat(width - Bun.stringWidth(text))}`;

export function formatTextTable(
  header: TableRow,
  rows: readonly TableRow[],
): readonly string[] {
  const cells = [header, ...rows.map((row) => row.map(textValueOf))];
  const widths = header.map((_, column) =>
    Math.max(...cells.map((row) => Bun.stringWidth(row[column] ?? ''))),
  );
  return cells.map((row) =>
    row
      .map((cell, column) =>
        column === row.length - 1
          ? cell
          : padToWidth(cell, widths[column] ?? 0),
      )
      .join('  '),
  );
}

export function formatViolationTable(
  violations: readonly ContractViolation[],
): string {
  if (violations.length === 0) return `${NO_VIOLATIONS}\n`;
  return [
    countLineOf(violations),
    ...formatTextTable(HEADER, violations.map(rowOf)),
    '',
  ].join('\n');
}

const markdownValueOf = (value: string): string =>
  value === ''
    ? EMPTY_VALUE
    : value.replaceAll('|', String.raw`\|`).replaceAll(/\r?\n/g, '<br>');

const markdownRowOf = (row: TableRow): string => `| ${row.join(' | ')} |`;

export function formatMarkdownTable(
  header: TableRow,
  rows: readonly TableRow[],
): readonly string[] {
  return [
    markdownRowOf(header),
    markdownRowOf(header.map(() => '---')),
    ...rows.map((row) => markdownRowOf(row.map(markdownValueOf))),
  ];
}

export function formatViolationMarkdown(
  title: string,
  violations: readonly ContractViolation[],
): string {
  const heading = [`### ${title}`, ''];
  if (violations.length === 0)
    return [...heading, NO_VIOLATIONS, ''].join('\n');
  return [
    ...heading,
    countLineOf(violations),
    '',
    ...formatMarkdownTable(HEADER, violations.map(rowOf)),
    '',
  ].join('\n');
}
