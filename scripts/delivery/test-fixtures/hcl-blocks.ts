export interface HclBlock {
  readonly type: string;
  readonly labels: readonly string[];
  readonly body: HclBody;
}

export interface HclAttribute {
  readonly tokens: readonly string[];
}

export interface HclBody {
  readonly attributes: ReadonlyMap<string, HclAttribute>;
  readonly blocks: readonly HclBlock[];
}

const NEWLINE = '\n';

const OPENERS: Readonly<Record<string, string>> = {
  '{': '}',
  '[': ']',
  '(': ')',
};

const CLOSERS: ReadonlySet<string> = new Set(Object.values(OPENERS));

const TWO_CHAR_OPERATORS: ReadonlySet<string> = new Set([
  '==',
  '!=',
  '<=',
  '>=',
  '=>',
  '&&',
  '||',
]);

const WORD = /[A-Za-z0-9_][A-Za-z0-9_-]*/y;

const HEREDOC_START = /<<(-?)([A-Za-z_][A-Za-z0-9_-]*)\r?\n/y;

const parseError = (message: string, position: string): Error =>
  new Error(`HCLを解析できません(${position}): ${message}`);

const atChar = (offset: number): string => `${String(offset + 1)}文字目`;

const atToken = (index: number): string => `${String(index + 1)}番目の字句`;

const endOfLine = (text: string, from: number): number => {
  const index = text.indexOf(NEWLINE, from);
  return index === -1 ? text.length : index;
};

// 文字列の補間(`${ … }`・`%{ … }`)の中は式のため、入れ子の文字列と波括弧を数えて閉じる位置を探す
const endOfTemplate = (text: string, from: number): number => {
  let depth = 1;
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      index = endOfString(text, index);
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  throw parseError('閉じていない補間', atChar(from));
};

function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '\\') {
      index += 2;
    } else if (char === '"') {
      return index + 1;
    } else if ((char === '$' || char === '%') && next === '{') {
      index = endOfTemplate(text, index + 2);
    } else if (char === NEWLINE) {
      break;
    } else {
      index += 1;
    }
  }
  throw parseError('閉じていない文字列', atChar(start));
}

const endOfHeredoc = (
  text: string,
  start: number,
  bodyStart: number,
  marker: string,
): number => {
  let lineStart = bodyStart;
  while (lineStart < text.length) {
    const lineEnd = endOfLine(text, lineStart);
    if (text.slice(lineStart, lineEnd).trim() === marker) return lineEnd;
    lineStart = lineEnd + 1;
  }
  throw parseError('閉じていないヒアドキュメント', atChar(start));
};

const endOfBlockComment = (text: string, start: number): number => {
  const index = text.indexOf('*/', start + 2);
  if (index === -1) throw parseError('閉じていないコメント', atChar(start));
  return index + 2;
};

const matchAt = (pattern: RegExp, text: string, index: number) => {
  pattern.lastIndex = index;
  return pattern.exec(text);
};

// 字句に分ける。コメントは捨て、行末は区切りとして残し、文字列とヒアドキュメントは中身ごと1つの字句にする
const tokenize = (text: string): readonly string[] => {
  const tokens: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    const pair = text.slice(index, index + 2);
    if (char === NEWLINE) {
      tokens.push(NEWLINE);
      index += 1;
    } else if (/\s/.test(char)) {
      index += 1;
    } else if (char === '#' || pair === '//') {
      index = endOfLine(text, index);
    } else if (pair === '/*') {
      const end = endOfBlockComment(text, index);
      if (text.slice(index, end).includes(NEWLINE)) tokens.push(NEWLINE);
      index = end;
    } else if (char === '"') {
      const end = endOfString(text, index);
      tokens.push(text.slice(index, end));
      index = end;
    } else {
      const heredoc = matchAt(HEREDOC_START, text, index);
      const word = matchAt(WORD, text, index);
      if (heredoc !== null) {
        const bodyStart = index + heredoc[0].length;
        const end = endOfHeredoc(text, index, bodyStart, heredoc[2] ?? '');
        tokens.push(text.slice(index, end));
        index = end;
      } else if (word !== null) {
        tokens.push(word[0]);
        index += word[0].length;
      } else {
        const token = TWO_CHAR_OPERATORS.has(pair) ? pair : char;
        tokens.push(token);
        index += token.length;
      }
    }
  }
  return tokens;
};

const isName = (token: string | undefined): token is string =>
  token !== undefined && /^[A-Za-z_]/.test(token);

const isLabel = (token: string | undefined): token is string =>
  token !== undefined && /^[A-Za-z_"]/.test(token);

const unquote = (token: string): string =>
  token.startsWith('"') ? token.slice(1, -1) : token;

interface Parsed<T> {
  readonly value: T;
  readonly next: number;
}

// 括弧の深さが0の行末・カンマ・親の閉じ括弧までを1つの式とする
const parseExpression = (
  tokens: readonly string[],
  start: number,
): Parsed<readonly string[]> => {
  const stack: string[] = [];
  const expression: string[] = [];
  let index = start;
  for (; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (stack.length === 0 && [NEWLINE, ',', '}'].includes(token)) break;
    const closer = OPENERS[token];
    if (closer !== undefined) stack.push(closer);
    if (CLOSERS.has(token) && stack.pop() !== token) {
      throw parseError(`対応しない括弧 ${token}`, atToken(index));
    }
    expression.push(token);
  }
  if (stack.length > 0) throw parseError('閉じていない括弧', atToken(start));
  return { value: expression, next: index };
};

const emptyBody = (): {
  attributes: Map<string, HclAttribute>;
  blocks: HclBlock[];
} => ({ attributes: new Map(), blocks: [] });

function parseBody(
  tokens: readonly string[],
  start: number,
  closed: boolean,
): Parsed<HclBody> {
  const body = emptyBody();
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === NEWLINE || token === ',') {
      index += 1;
      continue;
    }
    if (token === '}') {
      if (!closed) throw parseError('余分な閉じ括弧', atToken(index));
      return { value: body, next: index + 1 };
    }
    if (!isLabel(token))
      throw parseError(`想定外の字句 ${String(token)}`, atToken(index));
    if (tokens[index + 1] === '=') {
      const expression = parseExpression(tokens, index + 2);
      body.attributes.set(unquote(token), { tokens: expression.value });
      index = expression.next;
      continue;
    }
    const block = parseBlock(tokens, index);
    body.blocks.push(block.value);
    index = block.next;
  }
  if (closed) throw parseError('閉じていないブロック', atToken(start));
  return { value: body, next: index };
}

function parseBlock(
  tokens: readonly string[],
  start: number,
): Parsed<HclBlock> {
  const type = tokens[start] ?? '';
  const labels: string[] = [];
  let index = start + 1;
  for (; isLabel(tokens[index]); index += 1) {
    labels.push(unquote(tokens[index] ?? ''));
  }
  if (!isName(type) || tokens[index] !== '{') {
    throw parseError(`属性でもブロックでもない文 ${type}`, atToken(start));
  }
  const body = parseBody(tokens, index + 1, true);
  return { value: { type, labels, body: body.value }, next: body.next };
}

export function parseHcl(text: string): HclBody {
  return parseBody(tokenize(text), 0, false).value;
}

export function blocksOf(
  body: HclBody,
  type: string,
  ...labels: readonly string[]
): readonly HclBlock[] {
  return body.blocks.filter(
    (block) =>
      block.type === type &&
      labels.every((label, index) => block.labels[index] === label),
  );
}

export function attributeTokensOf(
  body: HclBody | undefined,
  name: string,
): readonly string[] | undefined {
  return body?.attributes.get(name)?.tokens;
}

// 値が`{ 名前 = 式, … }`のオブジェクトなら、その中の属性を本体と同じ形で返す。for式などは読まない
export function attributeObjectOf(
  body: HclBody | undefined,
  name: string,
): HclBody | undefined {
  const tokens = attributeTokensOf(body, name);
  if (tokens?.[0] !== '{' || tokens.at(-1) !== '}') return undefined;
  try {
    const inner = parseBody(tokens.slice(1, -1), 0, false);
    return inner.value.blocks.length === 0 ? inner.value : undefined;
  } catch {
    return undefined;
  }
}
