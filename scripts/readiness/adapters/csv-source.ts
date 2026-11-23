export class CsvFormatError extends Error {
  override readonly name = 'CsvFormatError';
}

export type CsvRecord = Readonly<Record<string, string>>;

export interface CsvTable {
  readonly columns: readonly string[];
  readonly records: readonly CsvRecord[];
  readonly lines: readonly number[];
}

interface CsvRow {
  readonly line: number;
  readonly cells: readonly string[];
}

const BOM = '﻿';

// 1文字ずつ状態を進め、引用符の中のカンマ・改行・二重の引用符を値として扱う
const splitRows = (text: string): readonly CsvRow[] => {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let afterQuote = false;
  let line = 1;
  let rowLine = 1;

  const endCell = (): void => {
    cells.push(cell);
    cell = '';
    afterQuote = false;
  };
  const endRow = (): void => {
    endCell();
    if (cells.length > 1 || cells[0] !== '') {
      rows.push({ line: rowLine, cells });
    }
    cells = [];
    rowLine = line;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (char === '\n') line += 1;
    if (inQuotes) {
      if (char !== '"') {
        cell += char;
      } else if (text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = false;
        afterQuote = true;
      }
    } else if (char === '"' && cell === '' && !afterQuote) {
      inQuotes = true;
    } else if (afterQuote && char !== ',' && char !== '\n' && char !== '\r') {
      throw new CsvFormatError(
        `${String(line)}行目: 引用符の直後に値が続いています`,
      );
    } else if (char === ',') {
      endCell();
    } else if (char === '\n') {
      endRow();
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (inQuotes) {
    throw new CsvFormatError(
      `${String(rowLine)}行目: 引用符が閉じられていません`,
    );
  }
  if (cell !== '' || cells.length > 0) endRow();
  return rows;
};

export function parseCsv(text: string): CsvTable {
  const [header, ...body] = splitRows(
    text.startsWith(BOM) ? text.slice(BOM.length) : text,
  );
  if (header === undefined) {
    throw new CsvFormatError('列名の行がありません');
  }
  const columns = header.cells;
  const records = body.map(({ line, cells }) => {
    if (cells.length !== columns.length) {
      throw new CsvFormatError(
        `${String(line)}行目: 列の数が列名の行と合いません(${String(cells.length)}列、期待は${String(columns.length)}列)`,
      );
    }
    return Object.fromEntries(
      columns.map((column, index) => [column, cells[index] as string]),
    );
  });
  return { columns, records, lines: body.map(({ line }) => line) };
}

export function requireColumns(
  columns: readonly string[],
  required: readonly string[],
): void {
  const missing = required.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    throw new CsvFormatError(`CSVに列がありません: ${missing.join(', ')}`);
  }
}

export async function readCsvFile(path: string): Promise<CsvTable> {
  return parseCsv(await Bun.file(path).text());
}
