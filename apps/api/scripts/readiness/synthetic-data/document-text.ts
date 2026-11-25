import { truncateGraphemes } from '../../../common-lib/text/graphemes.ts';

const BLOCK_SEPARATOR = '\n\n';

const FILLER = '。';

const PARAGRAPH =
  '性能の検証のために自動で作った本文です。実在のサービスや利用者とは関係がありません。長い本文の表示・検索の索引・詳細の取得にかかる時間を測るため、同じ形の段落を繰り返しています。';

const LIST_ITEMS = Object.freeze([
  '項目の一つ目は、手順の前提を確認することです。',
  '項目の二つ目は、必要な設定を順に行うことです。',
  '項目の三つ目は、結果を画面で確かめることです。',
]);

const PLAIN_UNIT = '性能の検証のために自動で作った合成の文章です。';

function blockOf(index: number): string {
  const heading = `## 見出し${String(index + 1)}`;
  const list = LIST_ITEMS.map((item) => `- ${item}`).join('\n');
  return [heading, PARAGRAPH, list].join(BLOCK_SEPARATOR);
}

// 末尾が空白だと検証が数える前に除かれるため、空白で終わる場合は句点に置き換えて文字数を保つ
function replaceTrailingWhitespace(text: string): string {
  const trimmed = text.trimEnd();
  return `${trimmed}${FILLER.repeat(text.length - trimmed.length)}`;
}

function assertGraphemes(graphemes: number): void {
  if (!Number.isSafeInteger(graphemes) || graphemes < 1) {
    throw new RangeError(
      `文字数は1以上の整数で指定してください: ${String(graphemes)}`,
    );
  }
}

// 日本語の見出し・段落・リストを繰り返したマークダウンを、書記素でちょうど指定の文字数にする
export function markdownBodyOf(graphemes: number): string {
  assertGraphemes(graphemes);
  const blocks: string[] = [];
  let length = 0;
  for (let index = 0; length < graphemes; index += 1) {
    const block = blockOf(index);
    blocks.push(block);
    length += block.length + BLOCK_SEPARATOR.length;
  }
  return replaceTrailingWhitespace(
    truncateGraphemes(blocks.join(BLOCK_SEPARATOR), graphemes),
  );
}

// 名前・見出し・コメントなどの1行の文章を、見分けられる語を先頭に置いて書記素でちょうど指定の文字数にする
export function plainTextOf(graphemes: number, label: string): string {
  assertGraphemes(graphemes);
  let text = label;
  while (text.length < graphemes) {
    text += PLAIN_UNIT;
  }
  return replaceTrailingWhitespace(truncateGraphemes(text, graphemes));
}
