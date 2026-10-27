import { Html, Text } from '@react-email/components';
import { render } from '@react-email/render';
import { describe, expect, test } from 'vitest';

const MESSAGE = 'メール送信の確認です。';

const NICKNAME = '<b>テスト</b>';

const element = (
  <Html lang="ja">
    <Text>{MESSAGE}</Text>
    <Text>{NICKNAME}</Text>
  </Html>
);

describe('workerd上のReact Emailの描画', () => {
  test('日本語の文をlang="ja"付きのHTMLにし、入力の文字列をエスケープする', async () => {
    const html = await render(element);

    expect(html).toContain('lang="ja"');
    expect(html).toContain(MESSAGE);
    expect(html).toContain('&lt;b&gt;テスト&lt;/b&gt;');
    expect(html).not.toContain(NICKNAME);
  });

  test('同じ要素から日本語の文を含むテキストを生成する', async () => {
    const text = await render(element, { plainText: true });

    expect(text).toContain(MESSAGE);
    expect(text).toContain(NICKNAME);
    expect(text).not.toContain('<p');
  });
});
