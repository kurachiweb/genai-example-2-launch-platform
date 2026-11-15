import { describe, expect, mock, test } from 'bun:test';

import { PATHOLOGICAL_MARKDOWN } from './fixtures/pathological-markdown.ts';
import { REPRESENTATIVE_MARKDOWN } from './fixtures/representative-markdown.ts';
import { isPathologicalMarkdown, parseWithGuard } from './parse-guard.ts';

const MAX_SCAN_MILLISECONDS = 50;

const MAX_LENGTH = 20_000;

// 先頭の後に行を繰り返し、20,000文字に切りそろえる
const fillLines = (head: string, line: string): string =>
  `${head}${line.repeat(Math.ceil(MAX_LENGTH / line.length))}`.slice(
    0,
    MAX_LENGTH,
  );

const BACKTICK = '`';

const FENCE = BACKTICK.repeat(3);

const literal = (markdown: string): string => `literal:${markdown}`;

const REALISTIC_MARKDOWN: readonly (readonly [string, string])[] = [
  ['空の文書', ''],
  ['20,000文字の代表的な文書', REPRESENTATIVE_MARKDOWN],
  ['30段の引用', `${'>'.repeat(30)} 本文`],
  ['空白で区切った30段の引用', `${'> '.repeat(30)}本文`],
  ['記号を続けた20段の箇条書き', `${'- '.repeat(20)}本文`],
  [
    '字下げで入れ子にした20段の箇条書き',
    Array.from(
      { length: 20 },
      (_, depth) => `${'  '.repeat(depth)}- 項目${String(depth)}`,
    ).join('\n'),
  ],
  ['10段の角括弧', `${'['.repeat(10)}本文${']'.repeat(10)}`],
  [
    '全ての行に太字とリンクを含む300行の表',
    `| 項目 | 内容 |\n| - | - |\n${'| **名前** | [**説明**](https://client.example/a) _補足_ |\n'.repeat(300)}`,
  ],
  [
    'アスタリスクを多く含む800行のコードブロック',
    `\`\`\`c\n${'int **p = *q * 2; /* comment */\n'.repeat(800)}\`\`\``,
  ],
  [
    '下線の記入欄が50行続く書式',
    '氏名:______________________________\n'.repeat(50),
  ],
  [
    '多数のURLを含む文書',
    'https://www.other.example/path?a=1 www.other.example/b\n'.repeat(400),
  ],
  [
    '30個のURLを空白無しで並べた日本語の行',
    '公式サイトはwww.other.example/products、'.repeat(30),
  ],
  [
    '記入欄の下線が空行無しで続く20,000文字の書式',
    fillLines('', `記入欄:${'_'.repeat(45)}\n`),
  ],
  [
    '全てのセルに強調と取り消し線を持つ20,000文字の表',
    fillLines(
      '| a | b | c |\n| - | - | - |\n',
      '| **x** _y_ | **x** _y_ | ~~z~~ *w* |\n',
    ),
  ],
  [
    '下線の空欄を表の形で並べた20,000文字の行',
    fillLines('', `| ${'_'.repeat(30)} | ${'_'.repeat(30)} |\n`),
  ],
  [
    '星の区切り行が空行無しで続く20,000文字の文書',
    fillLines('', `${'='.repeat(10)}${'*'.repeat(70)}\n`),
  ],
  [
    'URLを空白無しで並べた20,000文字の日本語',
    fillLines('', '詳細はwww.other.example/x_y、'),
  ],
  [
    '掛け算の記号を多く含む20,000文字の段落',
    fillLines('', '2*3*4*5 = 120, a*b*c\n'),
  ],
  [
    '項目ごとに太字を持つ20,000文字の箇条書き',
    fillLines('', '- **項目**: 説明 _補足_ と `snake_case_name`\n'),
  ],
  [
    '項目が2行に折り返された箇条書き',
    '- 項目の説明が長いため\n  次の行に続きます\n'.repeat(300),
  ],
  [
    'setext見出しを30個含む文書',
    '見出し\n------\n\n本文です。\n\n'.repeat(30) +
      '本文の段落です。\n'.repeat(500),
  ],
  [
    '脚注の参照の閉じ角括弧を多く含む段落',
    '本文[^1]と[注]と(補足]を書く。'.repeat(500),
  ],
  [
    '字下げした4段の箇条書きが数百項目続く文書',
    fillLines('', '- 項目\n  - 子の項目\n    - 孫の項目\n      - ひ孫の項目\n'),
  ],
  [
    '引用を含む箇条書きの項目が数百件続く文書',
    fillLines('', '- 項目の説明\n  > 引用の本文です。\n'),
  ],
  [
    '引用で始まる箇条書きの項目が300件続く文書',
    '- > 引用の本文です。\n'.repeat(300),
  ],
  [
    '番号付きの手順に箇条書きを入れ子にした文書',
    fillLines('', '1. 手順\n   - 補足\n   - 注意\n\n'),
  ],
  [
    '強調の多い長い段落',
    '**重要**な点は*二つ*あり、~~古い~~情報に注意します。'.repeat(500),
  ],
];

describe('isPathologicalMarkdown', () => {
  test.each(
    PATHOLOGICAL_MARKDOWN.map(({ name, markdown }) => [name, markdown]),
  )('%sを解析の負荷が過大な入力として判定する', (_, markdown) => {
    expect(isPathologicalMarkdown(markdown)).toBe(true);
  });

  test.each(REALISTIC_MARKDOWN)(
    '%sを解析の負荷が過大な入力として判定しない',
    (_, markdown) => {
      expect(isPathologicalMarkdown(markdown)).toBe(false);
    },
  );

  test('バックスラッシュでエスケープした記号を数えない', () => {
    expect(isPathologicalMarkdown('\\*\\_'.repeat(5_000))).toBe(false);
    expect(isPathologicalMarkdown('\\['.repeat(10_000))).toBe(false);
  });

  test('空行で区切った段落ごとに強調の記号と角括弧を数える', () => {
    const paragraph = `${'*_'.repeat(150)}${'['.repeat(50)}`;

    expect(isPathologicalMarkdown(`${paragraph}\n\n`.repeat(50))).toBe(false);
    expect(isPathologicalMarkdown(`${paragraph}\n`.repeat(50))).toBe(true);
  });

  test('空白と約物で区切ったドメインごとにwww.の数を数える', () => {
    expect(isPathologicalMarkdown('www._ '.repeat(3_000))).toBe(false);
    expect(isPathologicalMarkdown('www._、'.repeat(3_000))).toBe(false);
    expect(isPathologicalMarkdown('www._'.repeat(3_000))).toBe(true);
  });

  test.each([
    [
      '表の行',
      `| a |\n| - |\n${`| ${'*_'.repeat(40)} |\n`.repeat(240)}`,
      false,
    ],
    [
      '区切りの行の無い表の形の行',
      `a\n${`| ${'*_'.repeat(40)} |\n`.repeat(240)}`,
      true,
    ],
    [
      '列の数が異なる表の形の行',
      `| a | b |\n| - |\n${`| ${'*_'.repeat(40)} |\n`.repeat(240)}`,
      true,
    ],
    ['箇条書きの項目', `- ${'*_'.repeat(40)}\n`.repeat(240), false],
    [
      '段落を中断しない番号の項目',
      `a\n${`2. ${'*_'.repeat(40)}\n`.repeat(240)}`,
      true,
    ],
    [
      '字下げが4以上の項目',
      `a\n${`    - ${'*_'.repeat(40)}\n`.repeat(240)}`,
      true,
    ],
    ['見出し', `## ${'*_'.repeat(40)}\n`.repeat(240), false],
  ])('%sごとに強調の記号を数える', (_, markdown, expected) => {
    expect(isPathologicalMarkdown(markdown)).toBe(expected);
  });

  test('対応の無い閉じ角括弧を空行で区切った段落ごとに数える', () => {
    expect(isPathologicalMarkdown('a]\n\n'.repeat(5_000))).toBe(false);
    expect(isPathologicalMarkdown('a]\n'.repeat(6_000))).toBe(true);
  });

  test('遅延継続行を空行で区切った段落ごとに数える', () => {
    expect(isPathologicalMarkdown('> a\nb\n\n'.repeat(2_500))).toBe(false);
    expect(isPathologicalMarkdown(`> a\n${'b\n'.repeat(9_000)}`)).toBe(true);
    expect(isPathologicalMarkdown(`a\n${'b\n'.repeat(9_000)}`)).toBe(false);
  });

  test.each([
    ['フェンス', `${FENCE}\n`],
    ['チルダのフェンス', '~~~~\n'],
    ['空行で閉じるHTMLブロックの中のフェンス', `<div>\n${FENCE}\n\n`],
    ['HTMLのコメントの中のフェンス', `<!--\n${FENCE}\n-->\n`],
    ['空行をまたぐHTMLのコメントの中のフェンス', `<!--\n\n${FENCE}\n-->\n`],
    ['字下げしたフェンスを閉じる行頭のフェンス', ` ${FENCE}\nx\n${FENCE}\n`],
    ['字下げしたチルダのフェンスを閉じる行頭のフェンス', '   ~~~\nx\n~~~\n'],
  ])('フェンスのコードブロックの中も数える(%s)', (_, head) => {
    const attack = `${'*_'.repeat(40)}\n`.repeat(240);

    expect(isPathologicalMarkdown(`${head}${attack}`)).toBe(true);
  });

  test('対応の無い閉じ角括弧を空行無しで多く含む20,000文字のコードブロックも解析の負荷が過大な入力として判定する', () => {
    expect(
      isPathologicalMarkdown(fillLines(`${FENCE}\n`, 'arr[0]] = x; // ]\n')),
    ).toBe(true);
  });

  test('別のコンテナを開くリストの項目を文書の位置とともに数える', () => {
    expect(isPathologicalMarkdown('- >\n'.repeat(300))).toBe(false);
    expect(isPathologicalMarkdown('- a\n'.repeat(5_000))).toBe(false);
    expect(isPathologicalMarkdown('> >\n'.repeat(5_000))).toBe(false);
    expect(isPathologicalMarkdown('- >\n\na\n\n'.repeat(2_000))).toBe(true);
  });

  test('空行の後の下線の行をsetext見出しとして数えない', () => {
    expect(isPathologicalMarkdown('a\n\n---\n'.repeat(3_000))).toBe(false);
    expect(isPathologicalMarkdown('a\n---\n'.repeat(3_000))).toBe(true);
  });

  test('20,000文字の入力を線形の時間で判定する', () => {
    const startedAt = performance.now();
    for (const { markdown } of PATHOLOGICAL_MARKDOWN) {
      isPathologicalMarkdown(markdown);
    }
    const elapsed = performance.now() - startedAt;

    expect(elapsed / PATHOLOGICAL_MARKDOWN.length).toBeLessThan(
      MAX_SCAN_MILLISECONDS,
    );
  });
});

describe('parseWithGuard', () => {
  test('通常の入力を解析した結果を返す', () => {
    expect(
      parseWithGuard('本文', (markdown) => `parsed:${markdown}`, literal),
    ).toBe('parsed:本文');
  });

  test('解析の負荷が過大な入力は解析せずに原文の扱いにする', () => {
    const parse = mock((markdown: string) => `parsed:${markdown}`);
    const markdown = '>'.repeat(20_000);

    expect(parseWithGuard(markdown, parse, literal)).toBe(literal(markdown));
    expect(parse).not.toHaveBeenCalled();
  });

  test.each([
    ['RangeError', new RangeError('Maximum call stack size exceeded')],
    [
      'FirefoxのInternalError',
      Object.assign(new Error('too much recursion'), { name: 'InternalError' }),
    ],
  ])('解析が%sでスタックあふれした入力を原文の扱いにする', (_, error) => {
    expect(
      parseWithGuard(
        '本文',
        () => {
          throw error;
        },
        literal,
      ),
    ).toBe(literal('本文'));
  });

  test('スタックあふれ以外の例外はそのまま投げる', () => {
    const error = new TypeError('unexpected');

    expect(() =>
      parseWithGuard(
        '本文',
        () => {
          throw error;
        },
        literal,
      ),
    ).toThrow(error);
  });
});
