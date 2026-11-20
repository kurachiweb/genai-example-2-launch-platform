import { describe, expect, test } from 'vitest';

import type { AnyEmailKind } from '../../../../../lib/core/email/email-kind.ts';
import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import {
  MODERATION_COMMENT_HIDDEN_EMAIL,
  MODERATION_PRODUCT_HIDDEN_EMAIL,
  MODERATION_USER_SUSPENDED_EMAIL,
} from '../../../../../lib/core/email/kinds/ugc-moderation.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { MODERATION_COMMENT_HIDDEN_TEMPLATE } from './comment-hidden-template.ts';
import { MODERATION_EMAIL_TEMPLATES } from './index.ts';
import { MODERATION_PRODUCT_HIDDEN_TEMPLATE } from './product-hidden-template.ts';
import { MODERATION_USER_SUSPENDED_TEMPLATE } from './user-suspended-template.ts';

const NICKNAME = '山田 はなこ';

const PRODUCT_NAME = 'Pitch Notes';

const CONTACT_URL = 'https://client.example/contact';

const CONTACT_LABEL = 'お問い合わせ';

const ACTED_AT = '2026-11-20T07:40:00.000Z';

const ACTED_AT_TEXT = '2026年11月20日07:40(UTC)';

function actedAtHtml(label: string): RegExp {
  return new RegExp(
    `${label}: <time datetime="2026-11-20T07:40:00\\.000Z">2026年11月20日07:40\\(UTC\\)</time>`,
    'iu',
  );
}

const SUSPENDED_INPUT = {
  nickname: NICKNAME,
  reason: '利用規約に反する投稿を繰り返したため',
  suspendedAt: ACTED_AT,
  contactUrl: CONTACT_URL,
};

const PRODUCT_HIDDEN_INPUT = {
  nickname: NICKNAME,
  productName: PRODUCT_NAME,
  reason: '説明文に第三者の権利を侵害する内容が含まれるため',
  hiddenAt: ACTED_AT,
  contactUrl: CONTACT_URL,
};

const COMMENT_HIDDEN_INPUT = {
  ...PRODUCT_HIDDEN_INPUT,
  excerpt: 'このプロダクトは最高です',
  reason: '他の利用者を中傷する内容のため',
};

const SUSPENDED_LEAD = '運営者の判断により、あなたのアカウントを停止しました。';

const PRODUCT_HIDDEN_LEAD =
  '運営者の判断により、Pitch Notesの公開を停止しました。';

const COMMENT_HIDDEN_LEAD =
  '運営者の判断により、Pitch Notesへのあなたのコメントの公開を停止しました。';

const SUSPENDED_PARAGRAPHS = [
  '停止中は、あなたのプロフィール・プロダクト・コメントは他のユーザーに表示されません。',
  'まだ始まっていないマッチの予定は取り消され、停止が解除されても元に戻りません。',
  'Ultrasに加入している場合は、課金期間の末日で解約されます。支払い済みの料金は返金されません。',
  '停止中は、あなたのスポンサー広告は表示されません。掲載期間は延長されませんが、表示を停止した日数分(1日のうち一部でも停止した日を含みます)の広告料金を、各広告の掲載期間が終わった時点で日割りにより自動で返金します。掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。',
  'トーナメントの組み合わせ決定の時点で停止中の場合、支払ったトーナメントの参加費は自動で全額返金されます。',
  '停止中でも、お問い合わせから退会を依頼できます。停止についてのご質問も、下のボタンからお問い合わせください。',
];

const PRODUCT_HIDDEN_PARAGRAPHS = [
  '公開を停止している間、このプロダクトは他のユーザーに表示されません。',
  'このプロダクトのまだ始まっていないマッチの予定は取り消され、公開が再開されても元に戻りません。',
  'このプロダクトのスポンサー広告は、公開を停止している間は表示されません。掲載期間は延長されませんが、表示を停止した日数分(1日のうち一部でも停止した日を含みます)の広告料金を、広告の掲載期間が終わった時点で日割りにより自動で返金します。掲載期間が終わる前に退会した場合や、プロダクトを削除した場合は返金されません。',
  'トーナメントの組み合わせ決定の時点でこのプロダクトの公開を停止している場合、支払ったトーナメントの参加費は自動で全額返金されます。',
  '内容を直したら、下のボタンからお問い合わせのうえ、確認を依頼してください。',
];

const COMMENT_HIDDEN_PARAGRAPHS = [
  '公開を停止している間、このコメントは他のユーザーに表示されません。',
  'ご質問がある場合は、下のボタンからお問い合わせください。',
];

const UNSUBSCRIBE_LABEL = '配信停止';

function createRenderer(): ReactEmailRenderer {
  return new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
}

function render(kind: AnyEmailKind, input: Record<string, unknown>) {
  return createRenderer().render(kind, input, undefined);
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

const TEMPLATES = [
  [
    '停止',
    MODERATION_USER_SUSPENDED_TEMPLATE,
    MODERATION_USER_SUSPENDED_EMAIL,
    SUSPENDED_INPUT,
  ],
  [
    'プロダクトの非公開化',
    MODERATION_PRODUCT_HIDDEN_TEMPLATE,
    MODERATION_PRODUCT_HIDDEN_EMAIL,
    PRODUCT_HIDDEN_INPUT,
  ],
  [
    'コメントの非公開化',
    MODERATION_COMMENT_HIDDEN_TEMPLATE,
    MODERATION_COMMENT_HIDDEN_EMAIL,
    COMMENT_HIDDEN_INPUT,
  ],
] as const;

describe('措置の通知のテンプレートの集約', () => {
  test('停止・プロダクトの非公開化・コメントの非公開化のテンプレートを凍結して持ち、それぞれの種別を指す', () => {
    expect(MODERATION_EMAIL_TEMPLATES).toEqual([
      MODERATION_USER_SUSPENDED_TEMPLATE,
      MODERATION_PRODUCT_HIDDEN_TEMPLATE,
      MODERATION_COMMENT_HIDDEN_TEMPLATE,
    ]);
    expect(Object.isFrozen(MODERATION_EMAIL_TEMPLATES)).toBe(true);
    expect(MODERATION_USER_SUSPENDED_TEMPLATE.kind).toBe(
      MODERATION_USER_SUSPENDED_EMAIL,
    );
    expect(MODERATION_PRODUCT_HIDDEN_TEMPLATE.kind).toBe(
      MODERATION_PRODUCT_HIDDEN_EMAIL,
    );
    expect(MODERATION_COMMENT_HIDDEN_TEMPLATE.kind).toBe(
      MODERATION_COMMENT_HIDDEN_EMAIL,
    );
  });

  test('全テンプレートの集約点から種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    expect(registry.get('ugc-moderation.user-suspended')).toBe(
      MODERATION_USER_SUSPENDED_TEMPLATE,
    );
    expect(registry.get('ugc-moderation.product-hidden')).toBe(
      MODERATION_PRODUCT_HIDDEN_TEMPLATE,
    );
    expect(registry.get('ugc-moderation.comment-hidden')).toBe(
      MODERATION_COMMENT_HIDDEN_TEMPLATE,
    );
  });

  test('代理の退会のテンプレートを持たない', () => {
    expect(
      EMAIL_TEMPLATES.filter((template) =>
        template.kind.name.startsWith('ugc-moderation.'),
      ),
    ).toEqual([...MODERATION_EMAIL_TEMPLATES]);
  });

  test.each(TEMPLATES)(
    '%sの通知は宛名にニックネームを使い、ボタンで問い合わせへリンクし、配信停止の区画を持たない',
    (_label, template, _kind, input) => {
      expect(template.greeting(input as never)).toBe(NICKNAME);
      expect(template.action?.(input as never)).toEqual({
        label: CONTACT_LABEL,
        url: CONTACT_URL,
      });
      expect('unsubscribeLinks' in template).toBe(false);
    },
  );

  test.each(TEMPLATES)(
    '%sの通知はHTMLとテキストに問い合わせのボタンだけを置き、配信停止のリンクを置かない',
    async (_label, _template, kind, input) => {
      const rendered = await render(kind, input);

      expect(hrefsOf(rendered.html)).toEqual([CONTACT_URL]);
      expect(rendered.text).toContain(`${CONTACT_LABEL} ${CONTACT_URL}`);
      expect(rendered.html).not.toContain('<!-- -->');
      for (const part of [rendered.html, rendered.text]) {
        expect(part).not.toContain(UNSUBSCRIBE_LABEL);
        expect(part).toContain(`${NICKNAME}さん`);
      }
    },
  );

  test.each(TEMPLATES)(
    '%sの通知は理由の改行を保ったプレーンテキストで差し込む',
    async (_label, _template, kind, input) => {
      const rendered = await render(kind, {
        ...input,
        reason: '1行目の理由\n2行目の理由\r\n3行目の理由',
      });

      expect(rendered.html).toMatch(
        /理由:<br\/?>1行目の理由<br\/?>2行目の理由<br\/?>3行目の理由/u,
      );
      expect(rendered.text).toContain(
        '理由:\n1行目の理由\n2行目の理由\n3行目の理由',
      );
    },
  );

  test.each(TEMPLATES)(
    '%sの通知は利用者と管理者の値に含まれるタグをHTMLとして解釈させない',
    async (_label, _template, kind, input) => {
      const rendered = await render(kind, {
        ...input,
        nickname: '<script>alert(1)</script>',
        reason: '<b>太字</b>\n<script>alert(2)</script>',
      });

      expect(rendered.html).not.toMatch(/<script\b/iu);
      expect(rendered.html).not.toContain('<b>');
      expect(rendered.html).toContain(
        '&lt;script&gt;alert(1)&lt;/script&gt;さん',
      );
      expect(rendered.html).toMatch(
        /&lt;b&gt;太字&lt;\/b&gt;<br\/?>&lt;script&gt;alert\(2\)&lt;\/script&gt;/u,
      );
      expect(rendered.text).toContain('<b>太字</b>\n<script>alert(2)</script>');
    },
  );
});

describe('停止の通知のテンプレート', () => {
  test('件名を文言規則の件名にし、受信一覧の冒頭の文を持つ', () => {
    expect(MODERATION_USER_SUSPENDED_TEMPLATE.subject(SUSPENDED_INPUT)).toBe(
      'アカウントが停止されました',
    );
    expect(MODERATION_USER_SUSPENDED_TEMPLATE.preview(SUSPENDED_INPUT)).toBe(
      SUSPENDED_LEAD,
    );
  });

  test('停止の日時をtime要素で包んだUTCで示し、理由と固定の段落を置く', async () => {
    const rendered = await render(
      MODERATION_USER_SUSPENDED_EMAIL,
      SUSPENDED_INPUT,
    );

    expect(rendered.subject).toBe('アカウントが停止されました');
    expect(rendered.html).toMatch(actedAtHtml('停止日時'));
    expect(rendered.text).toContain(`停止日時: ${ACTED_AT_TEXT}`);
    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain(SUSPENDED_LEAD);
      expect(part).toContain('利用規約に反する投稿を繰り返したため');
      for (const paragraph of SUSPENDED_PARAGRAPHS) {
        expect(part).toContain(paragraph);
      }
    }
  });
});

describe('プロダクトの非公開化の通知のテンプレート', () => {
  test('件名を文言規則の件名にし、受信一覧の冒頭の文を持つ', () => {
    expect(
      MODERATION_PRODUCT_HIDDEN_TEMPLATE.subject(PRODUCT_HIDDEN_INPUT),
    ).toBe('プロダクトの公開が停止されました');
    expect(
      MODERATION_PRODUCT_HIDDEN_TEMPLATE.preview(PRODUCT_HIDDEN_INPUT),
    ).toBe(PRODUCT_HIDDEN_LEAD);
  });

  test('プロダクトの名称と非公開化の日時をUTCで示し、理由と固定の段落を置き、停止だけの段落を置かない', async () => {
    const rendered = await render(
      MODERATION_PRODUCT_HIDDEN_EMAIL,
      PRODUCT_HIDDEN_INPUT,
    );

    expect(rendered.subject).toBe('プロダクトの公開が停止されました');
    expect(rendered.html).toMatch(actedAtHtml('公開の停止日時'));
    expect(rendered.text).toContain(`公開の停止日時: ${ACTED_AT_TEXT}`);
    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain(PRODUCT_HIDDEN_LEAD);
      expect(part).toContain(
        '説明文に第三者の権利を侵害する内容が含まれるため',
      );
      for (const paragraph of PRODUCT_HIDDEN_PARAGRAPHS) {
        expect(part).toContain(paragraph);
      }
      expect(part).not.toContain('Ultras');
      expect(part).not.toContain('退会を依頼');
    }
  });
});

describe('コメントの非公開化の通知のテンプレート', () => {
  test('件名を文言規則の件名にし、受信一覧の冒頭の文を持つ', () => {
    expect(
      MODERATION_COMMENT_HIDDEN_TEMPLATE.subject(COMMENT_HIDDEN_INPUT),
    ).toBe('コメントの公開が停止されました');
    expect(
      MODERATION_COMMENT_HIDDEN_TEMPLATE.preview(COMMENT_HIDDEN_INPUT),
    ).toBe(COMMENT_HIDDEN_LEAD);
  });

  test('対象のプロダクトの名称・本文の抜粋・理由・非公開化の日時をUTCで示し、停止と非公開化の固定の段落を置かない', async () => {
    const rendered = await render(
      MODERATION_COMMENT_HIDDEN_EMAIL,
      COMMENT_HIDDEN_INPUT,
    );

    expect(rendered.subject).toBe('コメントの公開が停止されました');
    expect(rendered.html).toMatch(actedAtHtml('公開の停止日時'));
    expect(rendered.text).toContain(`公開の停止日時: ${ACTED_AT_TEXT}`);
    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain(COMMENT_HIDDEN_LEAD);
      expect(part).toContain('このプロダクトは最高です');
      expect(part).toContain('他の利用者を中傷する内容のため');
      for (const paragraph of COMMENT_HIDDEN_PARAGRAPHS) {
        expect(part).toContain(paragraph);
      }
      expect(part).not.toContain('スポンサー広告');
      expect(part).not.toContain('マッチの予定');
      expect(part).not.toContain('参加費');
    }
  });

  test('本文の抜粋も改行を保ったプレーンテキストで差し込み、HTMLとして解釈させない', async () => {
    const rendered = await render(MODERATION_COMMENT_HIDDEN_EMAIL, {
      ...COMMENT_HIDDEN_INPUT,
      excerpt: '<img src=x onerror=alert(1)>\n2行目',
    });

    expect(rendered.html).not.toMatch(/<img\b/iu);
    expect(rendered.html).toMatch(
      /コメント:<br\/?>&lt;img src=x onerror=alert\(1\)&gt;<br\/?>2行目/u,
    );
    expect(rendered.text).toContain(
      'コメント:\n<img src=x onerror=alert(1)>\n2行目',
    );
  });
});
