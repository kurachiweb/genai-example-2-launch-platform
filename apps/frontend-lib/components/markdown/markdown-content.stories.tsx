import type { Meta, StoryObj } from '@storybook/tanstack-react';

import {
  MarkdownContent,
  type MarkdownContentSize,
} from './markdown-content.tsx';
import { useMarkdownOptions } from './use-markdown-options.ts';
import { useRenderedMarkdown } from './use-rendered-markdown.ts';

interface MarkdownExampleProps {
  readonly markdown: string;
  readonly size?: MarkdownContentSize;
}

// 表示場所と同じく、ルーターの文脈の利用者側のオリジンで描画した結果を表示部品へ渡す
function MarkdownExample({ markdown, size }: MarkdownExampleProps) {
  const options = useMarkdownOptions({ externalLinkRel: ['noopener', 'ugc'] });
  const rendered = useRenderedMarkdown(markdown, options);
  return <MarkdownContent rendered={rendered} size={size} />;
}

const BASIC = [
  '## ローンチの概要',
  '',
  '作った製品を投稿して、**投票**で競い合います。日本語の句読点に隣接する**強調**や~~取り消し線~~も解釈します。',
  '',
  '### 使い方',
  '',
  '1. 製品のページを作る',
  '2. 説明文を書く',
  '   - 箇条書きは入れ子にできる',
  '3. 公開する',
  '',
  '> 引用の文には引用符を自動で付けない',
  '',
  '`インラインのコード`とコードブロック:',
  '',
  '```ts',
  "const greeting = 'こんにちは';",
  'console.info(greeting);',
  '```',
  '',
  '- [x] 製品名を決める',
  '- [ ] タグラインを書く',
  '',
  '---',
  '',
  '# 見出しレベル1は段落として表示する',
  '',
  '![画像は文字列として表示する](https://images.example/cover.png)',
  '',
  '<script>Raw HTMLも文字列として表示する</script>',
].join('\n');

const LONG_PARAGRAPH =
  '長い本文は画面の幅で折り返します。英数字の長い並び(https://docs.example/very/long/path/that/does/not/fit/in/the/width/of/a/narrow/screen)も枠からはみ出さずに折り返します。';

const LONG_BODY = Array.from(
  { length: 6 },
  (_, index) =>
    `## 第${String(index + 1)}節\n\n${LONG_PARAGRAPH}\n\n${LONG_PARAGRAPH}`,
).join('\n\n');

const TABLE = [
  '表が表示幅に収まらない場合は、単語の途中で折り返さず、表の枠の中だけを横にスクロールします。枠にはTabキーで移動し、矢印キーでスクロールできます。',
  '',
  '| 項目 | 説明 | 既定値 | 備考 |',
  '| :--- | :--- | ---: | :---: |',
  '| Internationalization | 表示する言語と地域の設定 | ja-JP | 変更できる |',
  '| Accessibility | 支援技術への対応と自動検査の対象 | WCAG 2.2 AA | 必須 |',
  '| Documentation | 利用者向けの説明の置き場所 | なし | 任意 |',
].join('\n');

const FOOTNOTES = [
  '本文から脚注を参照できます[^rule]。同じ脚注を複数回参照することもできます[^note]。',
  '',
  '[^rule]: 脚注の見出しは画面に表示せず、支援技術にだけ伝えます。',
  '[^note]: 脚注から本文の参照位置へ戻るリンクがあります。',
].join('\n');

const LINKS = [
  '## リンクの見出し',
  '',
  '- 別のサイトへのリンクは別のタブで開く: [ドキュメント](https://docs.example/guide)',
  '- URLの自動リンク: https://www.example/news',
  '- メールアドレス: [問い合わせ](mailto:support@mail.example)',
  '- 本文の中の見出しへの移動: [見出しへ](#リンクの見出し)',
  '- 許可しない参照先はリンクにしない: [スクリプト](javascript:alert(1)) [相対URL](/p/launch)',
].join('\n');

const meta = {
  title: 'マークダウン/MarkdownContent',
  component: MarkdownExample,
  args: {
    markdown: BASIC,
    size: 'base',
  },
  argTypes: {
    markdown: { control: 'text' },
    size: { control: 'inline-radio', options: ['sm', 'base'] },
  },
} satisfies Meta<typeof MarkdownExample>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = {
  args: { size: 'sm' },
};

export const LongBody: Story = {
  args: { markdown: LONG_BODY },
};

export const Table: Story = {
  args: { markdown: TABLE },
};

export const Footnotes: Story = {
  args: { markdown: FOOTNOTES },
};

export const Links: Story = {
  args: { markdown: LINKS },
};

export const Dark: Story = {
  globals: { theme: 'dark' },
};
