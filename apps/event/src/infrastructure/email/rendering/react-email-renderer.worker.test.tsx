import { Text } from '@react-email/components';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import { EmailRenderError } from '../../../application/email/ports.ts';
import {
  type AnyEmailKind,
  defineEmailKind,
} from '../../../../lib/core/email/email-kind.ts';
import { EMAIL_DELIVERY_SMOKE_KIND } from '../../../../lib/core/email/kinds/email-delivery-smoke.ts';
import { EMAIL_KINDS } from '../../../../lib/core/email/kinds/index.ts';
import type { SenderInfo } from '../../../../lib/core/email/ports.ts';
import { EMAIL_TEMPLATES } from '../templates/index.ts';
import {
  createEmailTemplateRegistry,
  defineEmailTemplate,
  type EmailTemplate,
} from './email-template.ts';
import { ReactEmailRenderer } from './react-email-renderer.tsx';

const SMOKE_INPUT = { requestedAt: '2026-10-27T07:40:00.000Z' } as const;

const ACTION_URL = 'https://app.example/products/pitch-notes';

const UNSUBSCRIBE_URL = 'https://app.example/unsubscribe/token';

const SENDER_INFO: SenderInfo = {
  businessName: 'テスト事業者',
  contactEmail: 'contact@sender.example',
  postalAddress: '東京都千代田区1-1-1',
};

const digestKind = defineEmailKind({
  name: 'test.renderer-digest',
  category: 'notification',
  inputSchema: z.object({ nickname: z.string(), productName: z.string() }),
});

const receiptKind = defineEmailKind({
  name: 'test.renderer-receipt',
  category: 'transactional',
  inputSchema: z.object({ amount: z.number() }),
});

const brokenSubjectKind = defineEmailKind({
  name: 'test.renderer-broken-subject',
  category: 'transactional',
  inputSchema: z.object({}),
});

const brokenBodyKind = defineEmailKind({
  name: 'test.renderer-broken-body',
  category: 'transactional',
  inputSchema: z.object({}),
});

const digestTemplate = defineEmailTemplate({
  kind: digestKind,
  subject: ({ productName }) => `${productName}の今週のまとめ`,
  preview: () => '今週の動きをお知らせします。',
  greeting: ({ nickname }) => nickname,
  action: () => ({ label: 'プロダクトを見る', url: ACTION_URL }),
  unsubscribeUrl: () => UNSUBSCRIBE_URL,
  Body: ({ input }) => (
    <Text>{`${input.productName}の今週の動きをお知らせします。`}</Text>
  ),
});

const receiptTemplate = defineEmailTemplate({
  kind: receiptKind,
  subject: ({ amount }) => `${String(amount)}円の領収書`,
  preview: () => 'お支払いを受け付けました。',
  greeting: () => undefined,
  unsubscribeUrl: () => UNSUBSCRIBE_URL,
  Body: ({ input }) => (
    <Text>{`${String(input.amount)}円をお支払いいただきました。`}</Text>
  ),
});

const brokenSubjectTemplate = defineEmailTemplate({
  kind: brokenSubjectKind,
  subject: () => {
    throw new Error('件名を組み立てられません');
  },
  preview: () => '冒頭の文です。',
  greeting: () => undefined,
  Body: () => <Text>本文です。</Text>,
});

const brokenBodyTemplate = defineEmailTemplate({
  kind: brokenBodyKind,
  subject: () => '件名です',
  preview: () => '冒頭の文です。',
  greeting: () => undefined,
  Body: () => {
    throw new Error('本文を組み立てられません');
  },
});

const TEST_KINDS: readonly AnyEmailKind[] = [
  digestKind,
  receiptKind,
  brokenSubjectKind,
  brokenBodyKind,
];

const TEST_TEMPLATES: readonly EmailTemplate<unknown>[] = [
  digestTemplate,
  receiptTemplate,
  brokenSubjectTemplate,
  brokenBodyTemplate,
];

const RENDER_COUNT_FOR_TIMING = 20;

// QueueのconsumerのCPU時間の上限と、1回の呼び出しで処理するバッチの件数
const CONSUMER_CPU_LIMIT_MS = 30_000;

const CONSUMER_BATCH_SIZE = 10;

function createRenderer(): ReactEmailRenderer {
  return new ReactEmailRenderer(
    createEmailTemplateRegistry(
      [...EMAIL_TEMPLATES, ...TEST_TEMPLATES],
      [...EMAIL_KINDS, ...TEST_KINDS],
    ),
  );
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

describe('React Emailによる描画', () => {
  test('疎通確認の種別をテンプレートの件名そのままの日本語の件名と、lang="ja"のHTMLで描画する', async () => {
    const rendered = await createRenderer().render(
      EMAIL_DELIVERY_SMOKE_KIND,
      SMOKE_INPUT,
      undefined,
    );

    expect(rendered.subject).toBe('メール送信の確認');
    expect(rendered.html).toMatch(/<html[^>]*\slang="ja"/u);
    expect(rendered.html).toContain(
      'メール送信の確認のために送信したメールです。',
    );
    expect(rendered.html).toContain('10月27日07:40(UTC)');
  });

  test('同じ要素からテキストのパートを生成し、HTMLと同じ日本語の文言を含める', async () => {
    const rendered = await createRenderer().render(
      EMAIL_DELIVERY_SMOKE_KIND,
      SMOKE_INPUT,
      undefined,
    );

    expect(rendered.text).toContain(
      'メール送信の確認のために送信したメールです。',
    );
    expect(rendered.text).toContain('10月27日07:40(UTC)');
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('テキストのパートにHTMLのリンクと同じURLを含める', async () => {
    const rendered = await createRenderer().render(
      digestKind,
      { nickname: '山田', productName: 'Pitch Notes' },
      SENDER_INFO,
    );

    expect(hrefsOf(rendered.html)).toEqual([ACTION_URL, UNSUBSCRIBE_URL]);
    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain('山田さん');
      expect(part).toContain('Pitch Notesの今週の動きをお知らせします。');
      expect(part).toContain('プロダクトを見る');
      expect(part).toContain(SENDER_INFO.businessName);
    }
    expect(rendered.text).toContain(ACTION_URL);
    expect(rendered.text).toContain(UNSUBSCRIBE_URL);
  });

  test('<script>入りの入力の文字列をHTMLとして解釈させず、文字として表示する', async () => {
    const nickname = '<script>alert(1)</script>';
    const productName = '<script>alert("x")</script>';

    const rendered = await createRenderer().render(
      digestKind,
      { nickname, productName },
      undefined,
    );

    expect(rendered.subject).toBe(`${productName}の今週のまとめ`);
    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;の今週の動きをお知らせします。',
    );
    expect(rendered.text).toContain(`${nickname}さん`);
    expect(rendered.text).toContain(
      `${productName}の今週の動きをお知らせします。`,
    );
  });

  test('種別の分類に従い、トランザクションメールでは配信停止の区画を置かない', async () => {
    const rendered = await createRenderer().render(
      receiptKind,
      { amount: 1200 },
      SENDER_INFO,
    );

    expect(rendered.subject).toBe('1200円の領収書');
    expect(rendered.html).toContain('1200円をお支払いいただきました。');
    expect(rendered.html).not.toContain(UNSUBSCRIBE_URL);
    expect(rendered.text).not.toContain(UNSUBSCRIBE_URL);
  });

  test('送信者情報が未設定なら区画を省略する', async () => {
    const rendered = await createRenderer().render(
      receiptKind,
      { amount: 1200 },
      undefined,
    );

    expect(rendered.text).toContain('1200円をお支払いいただきました。');
    expect(rendered.text).not.toContain(SENDER_INFO.businessName);
  });

  test('種別に対応するテンプレートが無ければEmailRenderErrorにする', async () => {
    const unregisteredKind = defineEmailKind({
      name: 'test.renderer-unregistered',
      category: 'transactional',
      inputSchema: z.object({}),
    });

    await expect(
      createRenderer().render(unregisteredKind, {}, undefined),
    ).rejects.toThrow(
      new EmailRenderError(
        'メール種別"test.renderer-unregistered"のテンプレートがありません',
      ),
    );
  });

  test('件名などの組み立ての例外をEmailRenderErrorにする', async () => {
    await expect(
      createRenderer().render(brokenSubjectKind, {}, undefined),
    ).rejects.toThrow(
      new EmailRenderError(
        'メール種別"test.renderer-broken-subject"の描画に失敗しました',
      ),
    );
  });

  test('本文の描画中の例外をEmailRenderErrorにする', async () => {
    await expect(
      createRenderer().render(brokenBodyKind, {}, undefined),
    ).rejects.toThrow(
      new EmailRenderError(
        'メール種別"test.renderer-broken-body"の描画に失敗しました',
      ),
    );
  });

  test(`疎通確認のメールを${String(RENDER_COUNT_FOR_TIMING)}件描画し、所要時間を記録する`, async ({
    annotate,
  }) => {
    const renderer = createRenderer();

    const startedAt = performance.now();
    const results = [];
    for (let index = 0; index < RENDER_COUNT_FOR_TIMING; index += 1) {
      results.push(
        await renderer.render(
          EMAIL_DELIVERY_SMOKE_KIND,
          SMOKE_INPUT,
          undefined,
        ),
      );
    }
    const elapsedMs = performance.now() - startedAt;
    await annotate(
      `${String(RENDER_COUNT_FOR_TIMING)}件の描画の所要時間: ${elapsedMs.toFixed(1)}ms`,
    );

    expect(results).toHaveLength(RENDER_COUNT_FOR_TIMING);
    for (const rendered of results) {
      expect(rendered.subject).toBe('メール送信の確認');
    }
    expect(elapsedMs).toBeGreaterThan(0);
    expect(
      (elapsedMs / RENDER_COUNT_FOR_TIMING) * CONSUMER_BATCH_SIZE,
    ).toBeLessThan(CONSUMER_CPU_LIMIT_MS);
  });
});
