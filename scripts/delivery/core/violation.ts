export interface ContractViolation {
  readonly rule: string;
  readonly file: string;
  readonly path: string;
  readonly actual: string;
  readonly expected: string;
}

type Row = readonly [string, string, string, string, string];

const HEADER: Row = ['規則', 'ファイル', '項目', '実際', '期待'];

const NO_VIOLATIONS = '違反はありません。';

const EMPTY_VALUE = '(なし)';

const countLineOf = (violations: readonly ContractViolation[]): string =>
  `違反が${String(violations.length)}件あります。`;

const rowOf = (
  { rule, file, path, actual, expected }: ContractViolation,
  formatValue: (value: string) => string,
): Row => [
  formatValue(rule),
  formatValue(file),
  formatValue(path),
  formatValue(actual),
  formatValue(expected),
];

const textValueOf = (value: string): string =>
  value === '' ? EMPTY_VALUE : value.replaceAll(/\r?\n/g, String.raw`\n`);

const padToWidth = (text: string, width: number): string =>
  `${text}${' '.repeat(width - Bun.stringWidth(text))}`;

const alignColumns = (rows: readonly Row[]): readonly string[] => {
  const widths = HEADER.map((_, column) =>
    Math.max(...rows.map((row) => Bun.stringWidth(row[column] ?? ''))),
  );
  return rows.map((row) =>
    row
      .map((cell, column) =>
        column === row.length - 1
          ? cell
          : padToWidth(cell, widths[column] ?? 0),
      )
      .join('  '),
  );
};

export function formatViolationTable(
  violations: readonly ContractViolation[],
): string {
  if (violations.length === 0) return `${NO_VIOLATIONS}\n`;
  const rows = [
    HEADER,
    ...violations.map((violation) => rowOf(violation, textValueOf)),
  ];
  return [countLineOf(violations), ...alignColumns(rows), ''].join('\n');
}

const markdownValueOf = (value: string): string =>
  value === ''
    ? EMPTY_VALUE
    : value.replaceAll('|', String.raw`\|`).replaceAll(/\r?\n/g, '<br>');

const markdownRowOf = (row: Row): string => `| ${row.join(' | ')} |`;

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
    markdownRowOf(HEADER),
    markdownRowOf(['---', '---', '---', '---', '---']),
    ...violations.map((violation) =>
      markdownRowOf(rowOf(violation, markdownValueOf)),
    ),
    '',
  ].join('\n');
}
