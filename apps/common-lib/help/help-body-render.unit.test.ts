import { describe, expect, test } from 'bun:test';

import { renderMarkdown } from '../markdown/render-markdown.ts';
import {
  HELP_ARTICLE_EXTERNAL_LINK_REL,
  HELP_BODY_MAX,
} from './help-input-rules.ts';

const RENDER_BUDGET_MILLISECONDS = 1_500;

const TEST_TIMEOUT_MILLISECONDS = 30_000;

const SECTION = [
  '## アカウントの設定と通知',
  'この記事では**アカウントの設定**と*通知*の変え方を説明します。[設定の画面](https://client.example/settings)から変更でき、詳しくは[外部の解説](https://docs.other.example/notifications)も参考にしてください。困ったときは[問い合わせ](https://client.example/contact)へ、手順は[変更の手順](#変更の手順)を見てください。',
  '### 変更の手順',
  '1. 右上のアイコンを押す\n2. 「設定」を選ぶ\n   - 通知の欄を開く\n   - 受け取る通知を選ぶ\n     - メール\n     - サイト内\n3. 「保存」を押す',
  '- 通知はいつでも止められます\n- 止めた通知は届きません\n- 重要なお知らせは止められません',
  '| 通知 | メール | サイト内 |\n| :- | :-: | -: |\n| コメント | 既定で受け取る | **常に表示** |\n| フォロー | 受け取らない | 表示 |\n| お知らせ | `重要`のみ | 表示 |\n| 決済 | [明細](https://client.example/settings/billing) | 表示 |',
  '```text\n設定 > 通知 > メール\n  コメント: 受け取る\n  フォロー: 受け取らない\n```',
  '> 設定を変えた後は、画面を**再読み込み**しなくても反映されます。',
  '#### 注意事項\n\n退会すると設定は消えます。料金のプランを変えた場合も通知の設定は引き継がれます。日本語の文章では、**強調。**の後に句読点が続いても正しく太字になります。',
].join('\n\n');

const SECTION_SEPARATOR = '\n\n';

// 見出し・強調・リンク・リスト・表・コードブロック・引用を含む節を、本文の上限の文字数になるまで繰り返す
const HELP_BODY = `${SECTION}${SECTION_SEPARATOR}`
  .repeat(
    Math.ceil(HELP_BODY_MAX / (SECTION.length + SECTION_SEPARATOR.length)),
  )
  .slice(0, HELP_BODY_MAX);

const OPTIONS = {
  siteOrigin: 'https://client.example',
  externalLinkRel: HELP_ARTICLE_EXTERNAL_LINK_REL,
  idScope: 'article',
};

const elapsedMillisecondsOf = (render: () => unknown): number => {
  const startedAt = performance.now();
  render();
  return performance.now() - startedAt;
};

describe('ヘルプ記事の本文の描画', () => {
  test(
    `${HELP_BODY_MAX.toLocaleString('en-US')}文字の代表的な本文を${String(RENDER_BUDGET_MILLISECONDS)}ms以内に描画する`,
    () => {
      const { html, headings } = renderMarkdown(HELP_BODY, OPTIONS);

      const elapsed = elapsedMillisecondsOf(() =>
        renderMarkdown(HELP_BODY, OPTIONS),
      );

      expect(HELP_BODY).toHaveLength(HELP_BODY_MAX);
      expect(headings.length).toBeGreaterThan(200);
      expect(html).toContain('<table>');
      expect(html).toContain('<pre>');
      expect(html).toContain('<ol>');
      expect(html).toContain('rel="noopener"');
      expect(elapsed).toBeLessThan(RENDER_BUDGET_MILLISECONDS);
    },
    TEST_TIMEOUT_MILLISECONDS,
  );
});
