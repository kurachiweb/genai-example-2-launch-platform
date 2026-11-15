import { describe, expect, test } from 'vitest';

import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import { NOTIFICATION_EMAIL_KINDS } from '../../../../../lib/core/email/kinds/notifications.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { EMAIL_TEMPLATES } from '../index.ts';
import { FOLLOWED_USER_AWARD_TEMPLATE } from './followed-user-award-template.ts';
import { FOLLOWED_USER_MATCHES_TEMPLATE } from './followed-user-matches-template.ts';
import { NOTIFICATION_EMAIL_TEMPLATES } from './index.ts';
import { MATCH_PREVIEW_TEMPLATE } from './match-preview-template.ts';
import { MATCH_RESULT_TEMPLATE } from './match-result-template.ts';

describe('通知メールのテンプレートの集まり', () => {
  test('開始予告・勝敗結果・開催通知・受賞結果の4つのテンプレートを凍結して並べる', () => {
    expect(NOTIFICATION_EMAIL_TEMPLATES).toEqual([
      MATCH_PREVIEW_TEMPLATE,
      MATCH_RESULT_TEMPLATE,
      FOLLOWED_USER_MATCHES_TEMPLATE,
      FOLLOWED_USER_AWARD_TEMPLATE,
    ]);
    expect(Object.isFrozen(NOTIFICATION_EMAIL_TEMPLATES)).toBe(true);
  });

  test('各テンプレートは通知メールの種別の集まりと同じ順で1対1に種別を指す', () => {
    expect(
      NOTIFICATION_EMAIL_TEMPLATES.map((template) => template.kind),
    ).toEqual([...NOTIFICATION_EMAIL_KINDS]);
    for (const template of NOTIFICATION_EMAIL_TEMPLATES) {
      expect(template.kind.category).toBe('notification');
    }
  });

  test('通知メールの種別とテンプレートがそれぞれの集約点に載り、種別の名前でテンプレートを引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    for (const template of NOTIFICATION_EMAIL_TEMPLATES) {
      expect(EMAIL_KINDS).toContain(template.kind);
      expect(EMAIL_TEMPLATES).toContain(template);
      expect(registry.get(template.kind.name)).toBe(template);
    }
  });

  test('テンプレートだけを集約点に加えると、種別の集約点に無い種別として起動時の検査が例外を投げる', () => {
    const kindsWithoutNotifications = EMAIL_KINDS.filter(
      (kind) => !NOTIFICATION_EMAIL_KINDS.includes(kind),
    );

    expect(() =>
      createEmailTemplateRegistry(EMAIL_TEMPLATES, kindsWithoutNotifications),
    ).toThrow(/種別の集約点にありません/u);
  });

  test('種別だけを集約点に加えると、テンプレートの無い種別として起動時の検査が例外を投げる', () => {
    const templatesWithoutNotifications = EMAIL_TEMPLATES.filter(
      (template) => !NOTIFICATION_EMAIL_TEMPLATES.includes(template),
    );

    expect(() =>
      createEmailTemplateRegistry(templatesWithoutNotifications, EMAIL_KINDS),
    ).toThrow(/テンプレートがありません/u);
  });
});
