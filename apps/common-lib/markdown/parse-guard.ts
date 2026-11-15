import { isStackOverflowError } from './stack-overflow.ts';

interface ParseLoad {
  readonly containerMarkers: number;
  readonly lazyContinuation: number;
  readonly emphasisRuns: number;
  readonly emphasisRunLength: number;
  readonly bracketNesting: number;
  readonly unmatchedClosingBrackets: number;
  readonly autolinkAttempts: number;
  readonly setextUnderlines: number;
  readonly nestedContainerItems: number;
}

type LoadKey = keyof ParseLoad;

// 解析(micromark)は入れ子の深さや記号の数の2乗の時間を要する。各負荷の上限は、上限の直前の入力の描画が開発コンテナのBunとNode(V8)の両方で1秒を十分に下回る(多くは約250ms以内に収まる)値である。
// 処理時間で打ち切ると実行環境ごとに結果が変わるため、入力から決まる見積もりの合計で判定する
const LOAD_LIMITS: ParseLoad = {
  containerMarkers: 2_000_000,
  lazyContinuation: 12_000_000,
  emphasisRuns: 40_000_000,
  emphasisRunLength: 16_000_000,
  bracketNesting: 500_000,
  unmatchedClosingBrackets: 9_000_000,
  autolinkAttempts: 5_000_000,
  setextUnderlines: 8_000_000,
  nestedContainerItems: 2_500_000,
};

const LOAD_KEYS = Object.keys(LOAD_LIMITS) as LoadKey[];

const LINE_BREAK = /\r\n?|\n/u;

const BLANK_LINE = /^[ \t]*$/u;

const CONTAINER_MARKER = /[ \t]*(>|[-+*](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$))/uy;

const BLOCK_QUOTE_MARKER = '>';

// 段落を中断して新しい行内の範囲を始める行。字下げが4以上の行や引用の中の行は段落の続きになり得るため含めない
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/u;

const LIST_ITEM_INTERRUPTING_PARAGRAPH = /^ {0,3}(?:[-+*]|1[.)])[ \t]+\S/u;

const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/u;

const PIPE_TABLE_ROW = /^ {0,3}\|/u;

const TABLE_DELIMITER_CELL = /^[ \t]*:?-+:?[ \t]*$/u;

const UNESCAPED_PIPE = /(?<!\\)\|/u;

// 自動リンクのドメインは空白と、-・.・_以外の約物・記号で終わる
const DOMAIN_SEPARATOR_RUN = /(?:\s|(?![-._])[\p{P}\p{S}])+/u;

const WWW_PREFIX = 'www.';

const ESCAPE = '\\';

const EMPHASIS_DELIMITERS: ReadonlySet<string> = new Set(['*', '_', '~']);

const OPENING_BRACKET = '[';

const CLOSING_BRACKET = ']';

const ASCII_LIMIT = 0x80;

const ASCII_ALPHANUMERIC = /[0-9A-Za-z]/u;

const square = (value: number): number => value * value;

interface ContainerMarkers {
  readonly count: number;
  readonly opensContainerInListItem: boolean;
}

// リストの項目の行で、項目の中に続けて別のコンテナ(引用・リスト)を開くかも調べる
const containerMarkersOf = (line: string): ContainerMarkers => {
  CONTAINER_MARKER.lastIndex = 0;
  let count = 0;
  let insideListItem = false;
  let opensContainerInListItem = false;
  for (
    let match = CONTAINER_MARKER.exec(line);
    match !== null;
    match = CONTAINER_MARKER.exec(line)
  ) {
    count += 1;
    opensContainerInListItem ||= insideListItem;
    insideListItem ||= match[1] !== BLOCK_QUOTE_MARKER;
  }
  return { count, opensContainerInListItem };
};

const tableCellsOf = (line: string): readonly string[] =>
  line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split(UNESCAPED_PIPE);

const isTableDelimiterRow = (line: string): boolean =>
  PIPE_TABLE_ROW.test(line) &&
  tableCellsOf(line).every((cell) => TABLE_DELIMITER_CELL.test(cell));

const startsPipeTable = (
  header: string,
  delimiter: string | undefined,
): boolean =>
  delimiter !== undefined &&
  PIPE_TABLE_ROW.test(header) &&
  isTableDelimiterRow(delimiter) &&
  tableCellsOf(header).length === tableCellsOf(delimiter).length;

// 行内の構文の解決を始め直す位置の手前にある記号の数の近似として、ASCIIの英数字以外の文字を数える
const isTokenBoundary = (character: string): boolean =>
  character.charCodeAt(0) < ASCII_LIMIT && !ASCII_ALPHANUMERIC.test(character);

type LoadAccumulator = {
  -readonly [Key in LoadKey]: number;
};

interface InlineRange {
  readonly scanLine: (line: string) => void;
  readonly close: () => void;
}

const emptyLoad = (): LoadAccumulator => ({
  containerMarkers: 0,
  lazyContinuation: 0,
  emphasisRuns: 0,
  emphasisRunLength: 0,
  bracketNesting: 0,
  unmatchedClosingBrackets: 0,
  autolinkAttempts: 0,
  setextUnderlines: 0,
  nestedContainerItems: 0,
});

// 強調・リンクの解決は段落・見出し・表のセル・リストの項目ごとに行われるため、その範囲(行内の範囲)ごとに数える
const createInlineRange = (load: LoadAccumulator): InlineRange => {
  let runs = 0;
  let delimiters = 0;
  let runLength = 0;
  let runCharacter = '';
  let depth = 0;
  let deepest = 0;
  let boundaries = 0;

  // 強調の記号の連続(run)ごとに、連続の数と長さを数える
  const countEmphasis = (character: string): void => {
    if (runLength > 0 && character === runCharacter) {
      runLength += 1;
      delimiters += 1;
      return;
    }
    load.emphasisRunLength += square(runLength);
    const isDelimiter = EMPHASIS_DELIMITERS.has(character);
    runCharacter = isDelimiter ? character : '';
    runLength = isDelimiter ? 1 : 0;
    runs += runLength;
    delimiters += runLength;
  };

  const closeBracketGroup = (): void => {
    load.bracketNesting += square(deepest);
    depth = 0;
    deepest = 0;
  };

  // 対応の無い]は、行内の範囲の先頭までの記号を辿り直す
  const countBracket = (character: string): void => {
    if (character === OPENING_BRACKET) {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (character === CLOSING_BRACKET && depth === 0) {
      load.unmatchedClosingBrackets += boundaries;
    } else if (character === CLOSING_BRACKET) {
      depth -= 1;
      if (depth === 0) {
        closeBracketGroup();
      }
    }
  };

  const scanLine = (line: string): void => {
    for (let index = 0; index < line.length; index += 1) {
      const character = line.charAt(index);
      countEmphasis(character);
      if (character === ESCAPE) {
        index += 1;
        countEmphasis('');
      } else {
        countBracket(character);
      }
      if (isTokenBoundary(character)) {
        boundaries += 1;
      }
    }
    countEmphasis('');
    boundaries += 1;
  };

  const close = (): void => {
    countEmphasis('');
    closeBracketGroup();
    load.emphasisRuns += runs * delimiters;
    runs = 0;
    delimiters = 0;
    boundaries = 0;
  };

  return { scanLine, close };
};

interface LazyContinuation {
  readonly countLine: (containerMarkers: number) => void;
  readonly close: () => void;
}

// 引用・リストの段落の遅延継続行(コンテナの記号の無い行)は、それぞれ段落の先頭の行まで辿り直す
const createLazyContinuation = (load: LoadAccumulator): LazyContinuation => {
  let paragraphLines = 0;
  let lazyLines = 0;
  return {
    countLine: (containerMarkers) => {
      if (containerMarkers === 0 && paragraphLines === 0) {
        return;
      }
      paragraphLines += 1;
      lazyLines += containerMarkers === 0 ? 1 : 0;
    },
    close: () => {
      load.lazyContinuation += lazyLines * paragraphLines;
      paragraphLines = 0;
      lazyLines = 0;
    },
  };
};

const scanBlocks = (lines: readonly string[], load: LoadAccumulator): void => {
  const range = createInlineRange(load);
  const lazy = createLazyContinuation(load);
  let insideTable = false;
  lines.forEach((line, index) => {
    // コードブロックかどうかはHTMLブロックや字下げしたフェンスなど解析全体の状態で決まり、見誤ると負荷を見逃すため、コードブロックの中も段落と同じく数える
    if (BLANK_LINE.test(line)) {
      range.close();
      lazy.close();
      insideTable = false;
      return;
    }
    // 見出しの下線は文書の先頭までの解析結果を辿り直すため、手前の行の数を数える
    if (
      SETEXT_UNDERLINE.test(line) &&
      !BLANK_LINE.test(lines[index - 1] ?? '')
    ) {
      load.setextUnderlines += index;
    }
    const containerMarkers = containerMarkersOf(line);
    load.containerMarkers += square(containerMarkers.count);
    // 項目の中で別のコンテナを開く行も、文書の先頭までの解析結果を辿り直す
    if (containerMarkers.opensContainerInListItem) {
      load.nestedContainerItems += index;
    }
    lazy.countLine(containerMarkers.count);
    insideTable =
      (insideTable && line.includes('|')) ||
      startsPipeTable(line, lines[index + 1]);
    const isHeading = ATX_HEADING.test(line);
    if (
      insideTable ||
      isHeading ||
      LIST_ITEM_INTERRUPTING_PARAGRAPH.test(line)
    ) {
      range.close();
    }
    range.scanLine(line);
    if (insideTable || isHeading) {
      range.close();
    }
  });
  range.close();
  lazy.close();
};

// 自動リンクの判定はwww.の位置ごとにドメインの終わりまで走査するため、ドメインになり得る連続ごとにwww.の数と長さの積を合計する
const autolinkAttemptLoad = (markdown: string): number =>
  markdown
    .split(DOMAIN_SEPARATOR_RUN)
    .reduce(
      (load, domain) =>
        load +
        (domain.toLowerCase().split(WWW_PREFIX).length - 1) * domain.length,
      0,
    );

const estimateParseLoad = (markdown: string): ParseLoad => {
  const load = emptyLoad();
  scanBlocks(markdown.split(LINE_BREAK), load);
  load.autolinkAttempts = autolinkAttemptLoad(markdown);
  return load;
};

export const isPathologicalMarkdown = (markdown: string): boolean => {
  const load = estimateParseLoad(markdown);
  return (
    LOAD_KEYS.reduce((sum, key) => sum + load[key] / LOAD_LIMITS[key], 0) > 1
  );
};

// 解析の負荷が過大な入力と、解析がスタックあふれした入力は、どの実行環境でも同じ結果になるよう解析せずに代わりの結果を返す
export const parseWithGuard = <Tree>(
  markdown: string,
  parse: (markdown: string) => Tree,
  fallback: (markdown: string) => Tree,
): Tree => {
  if (isPathologicalMarkdown(markdown)) {
    return fallback(markdown);
  }
  try {
    return parse(markdown);
  } catch (error: unknown) {
    if (isStackOverflowError(error)) {
      return fallback(markdown);
    }
    throw error;
  }
};
