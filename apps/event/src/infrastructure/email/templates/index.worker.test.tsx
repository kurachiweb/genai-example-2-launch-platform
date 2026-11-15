import { describe, expect, test } from 'vitest';

import { EMAIL_KINDS } from '../../../../lib/core/email/kinds/index.ts';
import { createEmailTemplateRegistry } from '../rendering/email-template.ts';
import { EMAIL_TEMPLATES } from './index.ts';

describe('全テンプレートの集約点', () => {
  test('全メール種別の集約点とあわせて例外なく集約できる', () => {
    expect(() =>
      createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
    ).not.toThrow();
  });

  test('全メール種別のテンプレートを種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    for (const kind of EMAIL_KINDS) {
      expect(registry.get(kind.name)?.kind).toBe(kind);
    }
  });

  test('各テンプレートは全メール種別の集約点の種別を重複なく指す', () => {
    const kindNames = EMAIL_TEMPLATES.map((template) => template.kind.name);

    expect(new Set(kindNames).size).toBe(kindNames.length);
    for (const template of EMAIL_TEMPLATES) {
      expect(EMAIL_KINDS).toContain(template.kind);
    }
  });

  test('集約点は凍結されていて実行時にテンプレートを追加できない', () => {
    expect(Object.isFrozen(EMAIL_TEMPLATES)).toBe(true);
  });
});
