import { render } from '@react-email/render';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import {
  type AnyEmailKind,
  defineEmailKind,
} from '../../../../lib/core/email/email-kind.ts';
import { EMAIL_KINDS } from '../../../../lib/core/email/kinds/index.ts';
import { EMAIL_TEMPLATES } from '../templates/index.ts';
import {
  createEmailTemplateRegistry,
  defineEmailTemplate,
  type EmailTemplate,
  EmailTemplateRegistryError,
} from './email-template.ts';

const receiptKind = defineEmailKind({
  name: 'test.receipt',
  category: 'transactional',
  inputSchema: z.object({ amount: z.number() }),
});

const digestKind = defineEmailKind({
  name: 'test.digest',
  category: 'notification',
  inputSchema: z.object({ nickname: z.string() }),
});

const receiptTemplate = defineEmailTemplate({
  kind: receiptKind,
  subject: ({ amount }) => `${String(amount)}円の領収書`,
  preview: () => 'お支払いを受け付けました。',
  greeting: () => undefined,
  Body: ({ input }) => (
    <p>{`${String(input.amount)}円をお支払いいただきました。`}</p>
  ),
});

const digestTemplate = defineEmailTemplate({
  kind: digestKind,
  subject: () => '今週のまとめ',
  preview: () => '今週の動きをお知らせします。',
  greeting: ({ nickname }) => nickname,
  action: () => ({ label: 'まとめを見る', url: 'https://app.example/digest' }),
  unsubscribeUrl: () => 'https://app.example/unsubscribe/token',
  Body: () => <p>今週の動きをお知らせします。</p>,
});

const KINDS: readonly AnyEmailKind[] = [receiptKind, digestKind];

const TEMPLATES: readonly EmailTemplate<unknown>[] = [
  receiptTemplate,
  digestTemplate,
];

describe('テンプレートの定義', () => {
  test('渡した種別と各部品をそのまま持ち、後から書き換えられない', () => {
    expect(digestTemplate.kind).toBe(digestKind);
    expect(digestTemplate.subject({ nickname: '山田' })).toBe('今週のまとめ');
    expect(digestTemplate.greeting({ nickname: '山田' })).toBe('山田');
    expect(digestTemplate.action?.({ nickname: '山田' })).toEqual({
      label: 'まとめを見る',
      url: 'https://app.example/digest',
    });
    expect(Object.isFrozen(digestTemplate)).toBe(true);
  });

  test('集約点から引いたテンプレートの本文を入力付きのコンポーネントとして描画できる', async () => {
    const template: EmailTemplate<unknown> = receiptTemplate;

    const html = await render(<template.Body input={{ amount: 1200 }} />);

    expect(html).toContain('1200円をお支払いいただきました。');
  });

  test('任意の行動ボタンと配信停止のURLを持たないテンプレートも定義できる', () => {
    expect(Object.hasOwn(receiptTemplate, 'action')).toBe(false);
    expect(Object.hasOwn(receiptTemplate, 'unsubscribeUrl')).toBe(false);
  });
});

describe('テンプレートの集約', () => {
  test('種別の名前から対応するテンプレートを引ける', () => {
    const registry = createEmailTemplateRegistry(TEMPLATES, KINDS);

    expect(registry.get('test.receipt')).toBe(receiptTemplate);
    expect(registry.get('test.digest')).toBe(digestTemplate);
  });

  test('集約点に無い種別の名前ではテンプレートを返さない', () => {
    const registry = createEmailTemplateRegistry(TEMPLATES, KINDS);

    expect(registry.get('test.unknown')).toBeUndefined();
  });

  test('テンプレートの無い種別があれば例外にする', () => {
    expect(() => createEmailTemplateRegistry([receiptTemplate], KINDS)).toThrow(
      new EmailTemplateRegistryError(
        'メール種別"test.digest"のテンプレートがありません',
      ),
    );
  });

  test('集約点に無い種別のテンプレートがあれば例外にする', () => {
    expect(() => createEmailTemplateRegistry(TEMPLATES, [receiptKind])).toThrow(
      new EmailTemplateRegistryError(
        'テンプレートの種別"test.digest"が種別の集約点にありません',
      ),
    );
  });

  test('同じ種別のテンプレートが重複していれば例外にする', () => {
    expect(() =>
      createEmailTemplateRegistry(
        [receiptTemplate, digestTemplate, receiptTemplate],
        KINDS,
      ),
    ).toThrow(
      new EmailTemplateRegistryError(
        'メール種別"test.receipt"のテンプレートが重複しています',
      ),
    );
  });

  test('名前が同じでも集約点と異なる種別を指すテンプレートがあれば例外にする', () => {
    const anotherDigestKind = defineEmailKind({
      name: 'test.digest',
      category: 'transactional',
      inputSchema: z.object({ nickname: z.string() }),
    });

    expect(() =>
      createEmailTemplateRegistry(TEMPLATES, [receiptKind, anotherDigestKind]),
    ).toThrow(
      new EmailTemplateRegistryError(
        'テンプレートの種別"test.digest"が種別の集約点の定義と異なります',
      ),
    );
  });

  test('例外はEmailTemplateRegistryErrorとして見分けられる', () => {
    expect(() => createEmailTemplateRegistry([], KINDS)).toThrow(
      EmailTemplateRegistryError,
    );
  });
});

describe('全テンプレートの集約点', () => {
  test('各テンプレートは全メール種別の集約点の種別を重複なく指す', () => {
    const kindNames = EMAIL_TEMPLATES.map((template) => template.kind.name);

    expect(new Set(kindNames).size).toBe(kindNames.length);
    for (const template of EMAIL_TEMPLATES) {
      expect(EMAIL_KINDS).toContain(template.kind);
    }
  });
});
