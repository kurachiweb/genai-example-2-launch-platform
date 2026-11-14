export interface PathologicalMarkdown {
  readonly name: string;
  readonly markdown: string;
}

export const PATHOLOGICAL_MARKDOWN_MAX_LENGTH = 20_000;

const fill = (unit: string, suffix = ''): string =>
  unit.repeat(
    Math.floor(
      (PATHOLOGICAL_MARKDOWN_MAX_LENGTH - suffix.length) / unit.length,
    ),
  ) + suffix;

const following = (head: string, unit: string): string =>
  head +
  unit.repeat(
    Math.floor((PATHOLOGICAL_MARKDOWN_MAX_LENGTH - head.length) / unit.length),
  );

const indentedList = (depth: number): string =>
  Array.from(
    { length: depth },
    (_, level) => `${'  '.repeat(level)}- a\n`,
  ).join('');

const around = (marker: string): string => {
  const count = Math.floor((PATHOLOGICAL_MARKDOWN_MAX_LENGTH - 1) / 2);
  return `${marker.repeat(count)}a${marker.repeat(count)}`;
};

const nested = (open: string, close: string): string => {
  const count = Math.floor(
    PATHOLOGICAL_MARKDOWN_MAX_LENGTH / (open.length + close.length),
  );
  return `${open.repeat(count)}${close.repeat(count)}`;
};

// 解析(micromark)の処理時間が入れ子の深さや記号の数の2乗で伸びる、20,000文字以内の入力
export const PATHOLOGICAL_MARKDOWN: readonly PathologicalMarkdown[] = [
  { name: '引用の入れ子', markdown: fill('>') },
  { name: '空白で区切った引用の入れ子', markdown: fill('> ') },
  { name: '番号付きリストの入れ子', markdown: fill('1. ', 'a') },
  { name: '括弧の番号付きリストの入れ子', markdown: fill('1) ', 'a') },
  { name: 'ハイフンの箇条書きの入れ子', markdown: fill('- ', 'a') },
  { name: 'プラスの箇条書きの入れ子', markdown: fill('+ ', 'a') },
  { name: 'アスタリスクの箇条書きの入れ子', markdown: fill('* ', 'a') },
  { name: '引用と箇条書きの交互の入れ子', markdown: fill('> - ', 'a') },
  { name: 'アスタリスクの長い連続の組', markdown: around('*') },
  { name: 'アンダースコアの長い連続の組', markdown: around('_') },
  { name: 'アスタリスクとアンダースコアの交互', markdown: fill('*_') },
  { name: '強調の記号と文字の交互', markdown: fill('*a') },
  { name: '強調の開始と終了の交互', markdown: fill('*a**') },
  { name: '取り消し線とアンダースコアの交互', markdown: fill('~~_') },
  { name: '改行で区切った強調の記号', markdown: fill('*_\n') },
  { name: '画像の入れ子', markdown: nested('![', '](a)') },
  { name: 'リンクの入れ子', markdown: nested('[', '](a)') },
  { name: '閉じない角括弧', markdown: fill('[') },
  { name: '角括弧の入れ子', markdown: nested('[', ']') },
  { name: '強調とリンクの開始の交互', markdown: fill('*[a') },
  { name: 'アンダースコアで連ねたwww.', markdown: fill('www._') },
  { name: 'アンダースコアで連ねた日本語のwww.', markdown: fill('_www.あ') },
  { name: '対応の無い閉じ角括弧', markdown: fill(']') },
  { name: '改行で区切った対応の無い閉じ角括弧', markdown: fill(']\n') },
  { name: '文字と対応の無い閉じ角括弧の交互', markdown: fill('a]') },
  { name: '強調の記号と対応の無い閉じ角括弧の交互', markdown: fill('*]') },
  {
    name: '深さ90の引用の後の遅延継続行',
    markdown: following(`${'>'.repeat(90)} a\n`, 'b\n'),
  },
  { name: '引用の後の遅延継続行', markdown: following('> a\n', 'b\n') },
  { name: '箇条書きの後の遅延継続行', markdown: following('- a\n', 'b\n') },
  {
    name: '字下げで入れ子にした箇条書きの後の遅延継続行',
    markdown: following(indentedList(60), 'b\n'),
  },
  { name: 'setext見出しの連続', markdown: fill('a\n=\n') },
  { name: 'ハイフンのsetext見出しの連続', markdown: fill('a\n-\n') },
  { name: '箇条書きを開く箇条書きの項目の連続', markdown: fill('- -\n') },
  { name: '引用を開く箇条書きの項目の連続', markdown: fill('- >\n') },
  { name: '引用を開くアスタリスクの項目の連続', markdown: fill('* >\n') },
  { name: '2段の引用を開く箇条書きの項目の連続', markdown: fill('- >>\n') },
  {
    name: '番号付きリストを開く箇条書きの項目の連続',
    markdown: fill('- 1.\n'),
  },
  { name: '引用を開く番号付きリストの項目の連続', markdown: fill('1. >\n') },
  { name: '空行で区切った箇条書きを開く項目の連続', markdown: fill('- -\n\n') },
  { name: '引用を開く項目と通常の項目の交互', markdown: fill('- >\n- a\n') },
  {
    name: 'HTMLブロックの中のフェンスの後の強調の記号',
    markdown: following('<div>\n```\n\n', '*_\n'),
  },
  {
    name: 'HTMLのコメントの中のフェンスの後の強調の記号',
    markdown: following('<!--\n```\n-->\n', '*_\n'),
  },
  {
    name: '字下げしたフェンスのコードブロックの後の対応の無い閉じ角括弧',
    markdown: following(' ```\nx\n```\n', ']'),
  },
];
