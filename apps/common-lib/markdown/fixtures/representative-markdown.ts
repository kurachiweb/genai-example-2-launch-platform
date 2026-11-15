export const REPRESENTATIVE_MARKDOWN_LENGTH = 20_000;

const SECTION = [
  '## 製品の概要とリリースの背景',
  'このプロダクトは**チームの振り返り**を*短く*まとめるためのツールです。~~旧版~~から`retro-cli`を作り直し、[公式サイト](https://client.example/products/retro)と[外部の解説](https://blog.other.example/retro)で紹介しています[^1]。問い合わせは[メール](mailto:support@mail.example)へ、詳しくは[使い方](#使い方)を見てください。参考: www.other.example/docs',
  '### 使い方',
  '1. アカウントを作る\n2. チームを招待する\n   - 招待のリンクを送る\n   - 権限を選ぶ\n     - 閲覧だけ\n     - 編集できる\n3. 振り返りを始める',
  '- [x] 初期設定\n- [ ] 通知の設定\n- [ ] 連携の設定',
  '| 項目 | 無料 | 有料 |\n| :- | :-: | -: |\n| メンバー | 5人 | **無制限** |\n| 保存期間 | 30日 | 1年 |\n| 書き出し | — | `CSV`・`JSON` |\n| 問い合わせ | [フォーム](https://client.example/contact) | 優先 |',
  '```ts\nconst summary = items\n  .filter((item) => item.done)\n  .map((item) => `* ${item.title}`)\n  .join("\\n");\n```',
  '> 振り返りは**事実**と*感想*を分けて書くと、次の行動が決めやすくなります。\n>\n> > 引用の中の引用も書けます。',
  '---',
  '#### 注意事項\n\n利用規約の第3条(禁止事項)と、プライバシーポリシーの「取得する情報」を確認してください。料金は税込みで、年払いなら2か月分お得です。日本語の文章では、**強調。**の後に句読点が続いても正しく太字になります。',
  '[^1]: 2026年の調査による。',
].join('\n\n');

const SECTION_SEPARATOR = '\n\n';

// 見出し・強調・リンク・リスト・表・コード・引用・脚注を含む節を、20,000文字になるまで繰り返す
export const REPRESENTATIVE_MARKDOWN = `${SECTION}${SECTION_SEPARATOR}`
  .repeat(
    Math.ceil(
      REPRESENTATIVE_MARKDOWN_LENGTH /
        (SECTION.length + SECTION_SEPARATOR.length),
    ),
  )
  .slice(0, REPRESENTATIVE_MARKDOWN_LENGTH);
