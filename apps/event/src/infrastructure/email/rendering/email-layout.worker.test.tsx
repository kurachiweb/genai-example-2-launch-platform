import { render } from '@react-email/render';
import type { ComponentProps } from 'react';
import { describe, expect, test } from 'vitest';

import type { SenderInfo } from '../../../../lib/core/email/ports.ts';
import { EmailLayout } from './email-layout.tsx';

const BODY_TEXT = '本文の段落です。';

const ACTION = {
  label: 'マッチを見る',
  url: 'https://app.example/matches/1',
} as const;

const UNSUBSCRIBE_URL = 'https://app.example/unsubscribe/token';

const UNSUBSCRIBE_LABEL = 'この種類の通知メールの配信停止';

const SENDER_INFO: SenderInfo = {
  businessName: 'テスト事業者',
  contactEmail: 'contact@sender.example',
  postalAddress: '東京都千代田区1-1-1',
};

type LayoutProps = Omit<ComponentProps<typeof EmailLayout>, 'children'>;

const FULL_PROPS: LayoutProps = {
  category: 'notification',
  preview: '受信一覧に出る冒頭の文です。',
  greeting: '山田',
  action: ACTION,
  unsubscribeUrl: UNSUBSCRIBE_URL,
  senderInfo: SENDER_INFO,
};

function renderLayout(
  props: LayoutProps,
  options?: { readonly plainText: true },
): Promise<string> {
  return render(
    <EmailLayout {...props}>
      <p>{BODY_TEXT}</p>
    </EmailLayout>,
    options,
  );
}

function positionsOf(html: string, parts: readonly string[]): number[] {
  return parts.map((part) => html.indexOf(part));
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

describe('メールの共通レイアウト', () => {
  test('日本語の言語指定と受信一覧に出る冒頭の文を持つ', async () => {
    const html = await renderLayout(FULL_PROPS);

    expect(html).toMatch(/<html[^>]*\slang="ja"/u);
    expect(html).toContain('受信一覧に出る冒頭の文です。');
  });

  test('宛名・本文・行動ボタン・配信停止・送信者情報の順に並べる', async () => {
    const html = await renderLayout(FULL_PROPS);

    const positions = positionsOf(html, [
      '山田さん',
      BODY_TEXT,
      ACTION.label,
      UNSUBSCRIBE_LABEL,
      SENDER_INFO.businessName,
      SENDER_INFO.contactEmail,
      SENDER_INFO.postalAddress,
    ]);

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test('行動ボタンと配信停止のリンクは渡されたURLへそのまま向く', async () => {
    const html = await renderLayout(FULL_PROPS);

    expect(hrefsOf(html)).toEqual([ACTION.url, UNSUBSCRIBE_URL]);
  });

  test('テキストのパートにも同じ順で文言とURLを含める', async () => {
    const text = await renderLayout(FULL_PROPS, { plainText: true });

    const positions = positionsOf(text, [
      '山田さん',
      BODY_TEXT,
      ACTION.label,
      ACTION.url,
      UNSUBSCRIBE_LABEL,
      UNSUBSCRIBE_URL,
      SENDER_INFO.businessName,
      SENDER_INFO.contactEmail,
      SENDER_INFO.postalAddress,
    ]);

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test('宛名が無ければ宛名の行を置かず本文から始める', async () => {
    const text = await renderLayout(
      { ...FULL_PROPS, greeting: undefined },
      { plainText: true },
    );

    expect(text).not.toContain('さん');
    expect(text.trimStart().startsWith(BODY_TEXT)).toBe(true);
  });

  test('宛名の入力の文字列をHTMLとして解釈させない', async () => {
    const html = await renderLayout({
      ...FULL_PROPS,
      greeting: '<b>山田</b>',
    });

    expect(html).toContain('&lt;b&gt;山田&lt;/b&gt;さん');
    expect(html).not.toContain('<b>山田</b>');
  });

  test('行動ボタンが無ければボタンを置かない', async () => {
    const html = await renderLayout({ ...FULL_PROPS, action: undefined });

    expect(html).not.toContain(ACTION.label);
    expect(hrefsOf(html)).toEqual([UNSUBSCRIBE_URL]);
  });

  test('送信者情報が未設定なら区画を省略して描画する', async () => {
    const text = await renderLayout(
      { ...FULL_PROPS, senderInfo: undefined },
      { plainText: true },
    );

    expect(text).toContain(BODY_TEXT);
    expect(text.trimEnd().endsWith(UNSUBSCRIBE_URL)).toBe(true);
  });

  test('トランザクションメールではURLがあっても配信停止の区画を置かない', async () => {
    const html = await renderLayout({
      ...FULL_PROPS,
      category: 'transactional',
    });

    expect(html).not.toContain(UNSUBSCRIBE_LABEL);
    expect(hrefsOf(html)).toEqual([ACTION.url]);
  });

  test('通知メールでも配信停止のURLが無ければ区画を置かない', async () => {
    const html = await renderLayout({
      ...FULL_PROPS,
      unsubscribeUrl: undefined,
    });

    expect(html).not.toContain(UNSUBSCRIBE_LABEL);
    expect(hrefsOf(html)).toEqual([ACTION.url]);
  });

  test('画像・外部スクリプト・外部資源の読み込みを含めない', async () => {
    const html = await renderLayout(FULL_PROPS);

    expect(html).not.toMatch(/<img\b/iu);
    expect(html).not.toMatch(/<script\b/iu);
    expect(html).not.toMatch(/<link\b/iu);
    expect(html).not.toMatch(/\ssrc=/iu);
    expect(html).not.toMatch(/url\(/iu);
  });
});
