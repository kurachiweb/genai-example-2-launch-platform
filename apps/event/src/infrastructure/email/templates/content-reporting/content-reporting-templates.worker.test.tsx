import { describe, expect, test } from 'vitest';

import type { AnyEmailKind } from '../../../../../lib/core/email/email-kind.ts';
import {
  REPORT_INFRINGEMENT_INQUIRY_EMAIL,
  REPORT_OUTCOME_EMAIL,
  REPORT_REJECTION_TO_POSTER_EMAIL,
} from '../../../../../lib/core/email/kinds/content-reporting.ts';
import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { REPORT_EMAIL_TEMPLATES } from './index.ts';
import { REPORT_INFRINGEMENT_INQUIRY_TEMPLATE } from './infringement-inquiry-template.ts';
import { REPORT_REJECTION_TO_POSTER_TEMPLATE } from './rejection-to-poster-template.ts';
import { REPORT_OUTCOME_TEMPLATE } from './report-outcome-template.ts';

const REPORTER_NAME = '佐藤 たろう';

const POSTER_NAME = '山田 はなこ';

const CONTACT_URL = 'https://client.example/contact';

const TARGET_URL = 'https://client.example/p/pitch-notes';

const CONTACT_LABEL = 'お問い合わせ';

const DECIDED_AT = '2026-11-20T07:40:00.000Z';

const DECIDED_AT_TEXT = '2026年11月20日07:40(UTC)';

const DEADLINE = '2026-11-27T07:40:00.000Z';

const DEADLINE_TEXT = '2026年11月27日07:40(UTC)';

const UNSUBSCRIBE_LABEL = '配信停止';

const REPORTER_CLOSING =
  'ご協力ありがとうございました。ご質問がある場合は、下のボタンからお問い合わせください。';

const POSTER_CLOSING =
  'この通報により、あなたの投稿の表示は変わりません。ご質問がある場合は、下のボタンからお問い合わせください。';

const INQUIRY_REPLY_METHOD =
  '回答の方法: 下のボタンからお問い合わせフォームを開き、メッセージに対象のページのURLを明記して回答してください。';

const INQUIRY_OVERDUE_NOTICE =
  '期限までに回答が無い場合は、運営者の判断でこの投稿の公開を停止することがあります。';

const OUTCOME_INPUT = {
  recipientName: REPORTER_NAME,
  outcome: 'resolved',
  targetKind: 'product',
  targetLabel: 'Pitch Notes',
  excerpt: null,
  reason: '説明文に第三者の権利を侵害する内容が含まれるため、非公開にしました',
  decidedAt: DECIDED_AT,
  contactUrl: CONTACT_URL,
};

const REJECTION_INPUT = {
  nickname: POSTER_NAME,
  targetKind: 'product',
  targetLabel: 'Pitch Notes',
  excerpt: null,
  reason: '利用規約に反する内容は見当たりませんでした',
  decidedAt: DECIDED_AT,
  contactUrl: CONTACT_URL,
};

const INQUIRY_INPUT = {
  nickname: POSTER_NAME,
  targetKind: 'product',
  targetLabel: 'Pitch Notes',
  excerpt: null,
  targetUrl: TARGET_URL,
  message: '掲載の画像が第三者の著作物であるとの申出がありました',
  sentAt: DECIDED_AT,
  deadline: DEADLINE,
  contactUrl: CONTACT_URL,
};

const COMMENT_TARGET = {
  targetKind: 'comment',
  targetLabel: 'Pitch Notes',
  excerpt: 'このプロダクトは\n最低です',
};

const USER_TARGET = {
  targetKind: 'user',
  targetLabel: '鈴木 じろう',
  excerpt: null,
};

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function datedHtml(label: string, iso: string, display: string): RegExp {
  return new RegExp(
    `${label}: <time datetime="${escapeRegExp(iso)}">${escapeRegExp(display)}</time>`,
    'iu',
  );
}

function expectInOrder(text: string, parts: readonly string[]): void {
  const positions = parts.map((part) => text.indexOf(part));
  for (const [index, position] of positions.entries()) {
    expect(position, parts[index]).toBeGreaterThanOrEqual(0);
  }
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

const TEMPLATES = [
  [
    '申出者への対応結果',
    REPORT_OUTCOME_EMAIL,
    OUTCOME_INPUT,
    REPORTER_NAME,
    'reason',
    '理由',
  ],
  [
    '投稿者への却下',
    REPORT_REJECTION_TO_POSTER_EMAIL,
    REJECTION_INPUT,
    POSTER_NAME,
    'reason',
    '理由',
  ],
  [
    '権利侵害の照会',
    REPORT_INFRINGEMENT_INQUIRY_EMAIL,
    INQUIRY_INPUT,
    POSTER_NAME,
    'message',
    '照会の内容',
  ],
] as const;

describe('通報のテンプレートの集約', () => {
  test('3つのテンプレートを凍結して持ち、それぞれの種別を指す', () => {
    expect(REPORT_EMAIL_TEMPLATES).toEqual([
      REPORT_OUTCOME_TEMPLATE,
      REPORT_REJECTION_TO_POSTER_TEMPLATE,
      REPORT_INFRINGEMENT_INQUIRY_TEMPLATE,
    ]);
    expect(Object.isFrozen(REPORT_EMAIL_TEMPLATES)).toBe(true);
    expect(REPORT_OUTCOME_TEMPLATE.kind).toBe(REPORT_OUTCOME_EMAIL);
    expect(REPORT_REJECTION_TO_POSTER_TEMPLATE.kind).toBe(
      REPORT_REJECTION_TO_POSTER_EMAIL,
    );
    expect(REPORT_INFRINGEMENT_INQUIRY_TEMPLATE.kind).toBe(
      REPORT_INFRINGEMENT_INQUIRY_EMAIL,
    );
  });

  test('全テンプレートの集約点から種別の名前で引け、本specのテンプレートは3つだけである', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    expect(registry.get('content-reporting.report-outcome')).toBe(
      REPORT_OUTCOME_TEMPLATE,
    );
    expect(registry.get('content-reporting.rejection-to-poster')).toBe(
      REPORT_REJECTION_TO_POSTER_TEMPLATE,
    );
    expect(registry.get('content-reporting.infringement-inquiry')).toBe(
      REPORT_INFRINGEMENT_INQUIRY_TEMPLATE,
    );
    expect(
      EMAIL_TEMPLATES.filter((template) =>
        template.kind.name.startsWith('content-reporting.'),
      ),
    ).toEqual([...REPORT_EMAIL_TEMPLATES]);
  });

  test.each(TEMPLATES)(
    '%sはHTMLとテキストに宛名と問い合わせのボタンだけを置き、配信停止のリンクを置かない',
    async (_label, kind, input, name) => {
      const rendered = await render(kind, input);

      expect(hrefsOf(rendered.html)).toEqual([CONTACT_URL]);
      expect(rendered.text).toContain(`${CONTACT_LABEL} ${CONTACT_URL}`);
      expect(rendered.html).not.toContain('<!-- -->');
      for (const part of [rendered.html, rendered.text]) {
        expect(part).not.toContain(UNSUBSCRIBE_LABEL);
        expect(part).toContain(`${name}さん`);
        expect(part).not.toContain('対象:');
      }
    },
  );

  test.each(TEMPLATES)(
    '%sは管理者の文の改行を保ったプレーンテキストで差し込む',
    async (_label, kind, input, _name, key, heading) => {
      const rendered = await render(kind, {
        ...input,
        [key]: '1行目\n2行目\r\n3行目',
      });

      expect(rendered.html).toMatch(
        new RegExp(`${heading}:<br/?>1行目<br/?>2行目<br/?>3行目`, 'u'),
      );
      expect(rendered.text).toContain(`${heading}:\n1行目\n2行目\n3行目`);
    },
  );

  test.each(TEMPLATES)(
    '%sは値に含まれるタグをHTMLとして解釈させない',
    async (_label, kind, input, _name, key, heading) => {
      const rendered = await render(kind, {
        ...input,
        targetKind: 'comment',
        targetLabel: '<script>alert(1)</script>',
        excerpt: '<img src=x onerror=alert(1)>',
        [key]: '<b>太字</b>\n<script>alert(2)</script>',
      });

      expect(rendered.html).not.toMatch(/<script\b/iu);
      expect(rendered.html).not.toMatch(/<img\b/iu);
      expect(rendered.html).not.toContain('<b>');
      expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(rendered.html).toMatch(
        new RegExp(
          `${heading}:<br/?>&lt;b&gt;太字&lt;/b&gt;<br/?>&lt;script&gt;alert\\(2\\)&lt;/script&gt;`,
          'u',
        ),
      );
      expect(rendered.text).toContain('<b>太字</b>\n<script>alert(2)</script>');
    },
  );

  test.each(TEMPLATES)(
    '%sはコメントの抜粋を改行を保って差し込む',
    async (_label, kind, input) => {
      const rendered = await render(kind, { ...input, ...COMMENT_TARGET });

      expect(rendered.html).toMatch(
        /コメント:<br\/?>このプロダクトは<br\/?>最低です/u,
      );
      expect(rendered.text).toContain('コメント:\nこのプロダクトは\n最低です');
    },
  );

  test.each(TEMPLATES)(
    '%sは抜粋が無ければコメントの行を置かない',
    async (_label, kind, input) => {
      const rendered = await render(kind, input);

      for (const part of [rendered.html, rendered.text]) {
        expect(part).not.toContain('コメント:');
      }
    },
  );

  test.each(TEMPLATES)(
    '%sは対象を表示できない時は抜粋を省く',
    async (_label, kind, input) => {
      const rendered = await render(kind, {
        ...input,
        ...COMMENT_TARGET,
        targetLabel: null,
      });

      for (const part of [rendered.html, rendered.text]) {
        expect(part).not.toContain('コメント:');
        expect(part).not.toContain('最低です');
      }
    },
  );
});

describe('申出者への対応結果のテンプレート', () => {
  const RESOLVED_LEAD =
    '通報いただいたプロダクト『Pitch Notes』について、運営者が確認し、対応しました。';

  const REJECTED_LEAD =
    '通報いただいたプロダクト『Pitch Notes』について、運営者が確認し、通報を却下しました。';

  test('件名を文言規則の件名にし、受信一覧の冒頭の文を結果ごとに対象を差し込んで持つ', () => {
    expect(REPORT_OUTCOME_TEMPLATE.subject(OUTCOME_INPUT as never)).toBe(
      '通報の対応結果についてのお知らせ',
    );
    expect(REPORT_OUTCOME_TEMPLATE.preview(OUTCOME_INPUT as never)).toBe(
      RESOLVED_LEAD,
    );
    expect(
      REPORT_OUTCOME_TEMPLATE.preview({
        ...OUTCOME_INPUT,
        outcome: 'rejected',
      } as never),
    ).toBe(REJECTED_LEAD);
  });

  test('宛名にログイン中の申出者のニックネームを使い、ボタンで問い合わせへリンクする', () => {
    expect(REPORT_OUTCOME_TEMPLATE.greeting(OUTCOME_INPUT as never)).toBe(
      REPORTER_NAME,
    );
    expect(REPORT_OUTCOME_TEMPLATE.action?.(OUTCOME_INPUT as never)).toEqual({
      label: CONTACT_LABEL,
      url: CONTACT_URL,
    });
  });

  test('未ログインの申出者(宛名がnull)には宛名の行を置かない', async () => {
    const input = { ...OUTCOME_INPUT, recipientName: null };

    expect(REPORT_OUTCOME_TEMPLATE.greeting(input as never)).toBeUndefined();
    const rendered = await render(REPORT_OUTCOME_EMAIL, input);
    for (const part of [rendered.html, rendered.text]) {
      expect(part).not.toContain('さん');
      expect(part).toContain(RESOLVED_LEAD);
    }
  });

  test('対応済は冒頭の文・対応日時(UTC)・理由・結びをこの順に置く', async () => {
    const rendered = await render(REPORT_OUTCOME_EMAIL, OUTCOME_INPUT);

    expect(rendered.subject).toBe('通報の対応結果についてのお知らせ');
    expect(rendered.html).toMatch(
      datedHtml('対応日時', DECIDED_AT, DECIDED_AT_TEXT),
    );
    expectInOrder(rendered.text, [
      RESOLVED_LEAD,
      `対応日時: ${DECIDED_AT_TEXT}`,
      `理由:\n${OUTCOME_INPUT.reason}`,
      REPORTER_CLOSING,
    ]);
    expect(rendered.html).toContain(RESOLVED_LEAD);
    expect(rendered.html).toContain(REPORTER_CLOSING);
    for (const part of [rendered.html, rendered.text]) {
      expect(part).not.toContain('却下');
    }
  });

  test('却下は冒頭の文・却下の日時(UTC)・理由・結びをこの順に置く', async () => {
    const reason = '利用規約に反する内容は見当たりませんでした';
    const rendered = await render(REPORT_OUTCOME_EMAIL, {
      ...OUTCOME_INPUT,
      outcome: 'rejected',
      reason,
    });

    expect(rendered.html).toMatch(
      datedHtml('却下の日時', DECIDED_AT, DECIDED_AT_TEXT),
    );
    expectInOrder(rendered.text, [
      REJECTED_LEAD,
      `却下の日時: ${DECIDED_AT_TEXT}`,
      `理由:\n${reason}`,
      REPORTER_CLOSING,
    ]);
    expect(rendered.text).not.toContain('対応日時');
  });

  test('コメントは冒頭の文・抜粋・日時・理由・結びをこの順に置く', async () => {
    const rendered = await render(REPORT_OUTCOME_EMAIL, {
      ...OUTCOME_INPUT,
      ...COMMENT_TARGET,
    });

    expectInOrder(rendered.text, [
      '通報いただいたPitch Notesへのコメントについて、運営者が確認し、対応しました。',
      'コメント:\nこのプロダクトは\n最低です',
      `対応日時: ${DECIDED_AT_TEXT}`,
      '理由:',
      REPORTER_CLOSING,
    ]);
  });

  test.each([
    [
      'ユーザー',
      USER_TARGET,
      '通報いただいたユーザー「鈴木 じろう」について、運営者が確認し、対応しました。',
    ],
    [
      'プロダクト',
      { targetKind: 'product', targetLabel: 'Pitch Notes', excerpt: null },
      RESOLVED_LEAD,
    ],
    [
      'コメント',
      COMMENT_TARGET,
      '通報いただいたPitch Notesへのコメントについて、運営者が確認し、対応しました。',
    ],
    [
      '表示できない対象',
      { targetKind: 'product', targetLabel: null, excerpt: null },
      '通報いただいた内容について、運営者が確認し、対応しました。',
    ],
  ])('%sの対象を冒頭の文に差し込む', async (_label, target, lead) => {
    const input = { ...OUTCOME_INPUT, ...target };
    const rendered = await render(REPORT_OUTCOME_EMAIL, input);

    expect(REPORT_OUTCOME_TEMPLATE.preview(input as never)).toBe(lead);
    expect(rendered.html).toContain(lead);
    expect(rendered.text).toContain(lead);
  });

  test('表示できない対象の却下も「通報いただいた内容」を重ねずに書く', () => {
    expect(
      REPORT_OUTCOME_TEMPLATE.preview({
        ...OUTCOME_INPUT,
        outcome: 'rejected',
        targetLabel: null,
      } as never),
    ).toBe('通報いただいた内容について、運営者が確認し、通報を却下しました。');
  });
});

describe('投稿者への却下のテンプレート', () => {
  const LEAD =
    'プロダクト『Pitch Notes』への通報について運営者が確認し、通報を却下しました。';

  test('件名を文言規則の件名にし、宛名に投稿者のニックネームを使い、問い合わせへのボタンを持つ', () => {
    expect(
      REPORT_REJECTION_TO_POSTER_TEMPLATE.subject(REJECTION_INPUT as never),
    ).toBe('通報の対応結果についてのお知らせ');
    expect(
      REPORT_REJECTION_TO_POSTER_TEMPLATE.preview(REJECTION_INPUT as never),
    ).toBe(LEAD);
    expect(
      REPORT_REJECTION_TO_POSTER_TEMPLATE.greeting(REJECTION_INPUT as never),
    ).toBe(POSTER_NAME);
    expect(
      REPORT_REJECTION_TO_POSTER_TEMPLATE.action?.(REJECTION_INPUT as never),
    ).toEqual({ label: CONTACT_LABEL, url: CONTACT_URL });
  });

  test('冒頭の文・却下の日時(UTC)・理由・結びをこの順に置き、申出者の情報を載せない', async () => {
    const rendered = await render(REPORT_REJECTION_TO_POSTER_EMAIL, {
      ...REJECTION_INPUT,
      reporterNickname: REPORTER_NAME,
      reporterReason: '私の写真が無断で使われています',
      contactEmail: 'guest@mail.example',
    });

    expect(rendered.subject).toBe('通報の対応結果についてのお知らせ');
    expect(rendered.html).toMatch(
      datedHtml('却下の日時', DECIDED_AT, DECIDED_AT_TEXT),
    );
    expectInOrder(rendered.text, [
      LEAD,
      `却下の日時: ${DECIDED_AT_TEXT}`,
      `理由:\n${REJECTION_INPUT.reason}`,
      POSTER_CLOSING,
    ]);
    expect(rendered.html).toContain(POSTER_CLOSING);
    for (const part of [rendered.html, rendered.text]) {
      expect(part).not.toContain(REPORTER_NAME);
      expect(part).not.toContain('私の写真が無断で使われています');
      expect(part).not.toContain('guest@mail.example');
    }
  });

  test('コメントは冒頭の文・抜粋・日時・理由・結びをこの順に置く', async () => {
    const rendered = await render(REPORT_REJECTION_TO_POSTER_EMAIL, {
      ...REJECTION_INPUT,
      ...COMMENT_TARGET,
    });

    expectInOrder(rendered.text, [
      'Pitch Notesへのコメントへの通報について運営者が確認し、通報を却下しました。',
      'コメント:\nこのプロダクトは\n最低です',
      `却下の日時: ${DECIDED_AT_TEXT}`,
      '理由:',
      POSTER_CLOSING,
    ]);
  });

  test.each([
    [
      'ユーザー',
      USER_TARGET,
      'あなたのプロフィールへの通報について運営者が確認し、通報を却下しました。',
    ],
    [
      '表示できない対象',
      { targetKind: 'product', targetLabel: null, excerpt: null },
      'あなたの投稿への通報について運営者が確認し、通報を却下しました。',
    ],
  ])('%sの対象を冒頭の文に差し込む', async (_label, target, lead) => {
    const input = { ...REJECTION_INPUT, ...target };
    const rendered = await render(REPORT_REJECTION_TO_POSTER_EMAIL, input);

    expect(REPORT_REJECTION_TO_POSTER_TEMPLATE.preview(input as never)).toBe(
      lead,
    );
    expect(rendered.text).toContain(lead);
    expect(rendered.text).not.toContain('鈴木 じろう');
  });
});

describe('権利侵害の照会のテンプレート', () => {
  const LEAD =
    'プロダクト『Pitch Notes』について、権利を侵害しているとの申出がありました。次の内容について、ご確認をお願いします。';

  test('件名を文言規則の件名にし、宛名に投稿者のニックネームを使い、問い合わせへのボタンを持つ', () => {
    expect(
      REPORT_INFRINGEMENT_INQUIRY_TEMPLATE.subject(INQUIRY_INPUT as never),
    ).toBe('投稿内容の権利侵害についてご確認をお願いします');
    expect(
      REPORT_INFRINGEMENT_INQUIRY_TEMPLATE.preview(INQUIRY_INPUT as never),
    ).toBe(LEAD);
    expect(
      REPORT_INFRINGEMENT_INQUIRY_TEMPLATE.greeting(INQUIRY_INPUT as never),
    ).toBe(POSTER_NAME);
    expect(
      REPORT_INFRINGEMENT_INQUIRY_TEMPLATE.action?.(INQUIRY_INPUT as never),
    ).toEqual({ label: CONTACT_LABEL, url: CONTACT_URL });
  });

  test('冒頭の文・照会の内容・抜粋・対象のページ・回答の方法・回答の期限(UTC)・期限の注意をこの順に置き、照会日時を置かない', async () => {
    const rendered = await render(REPORT_INFRINGEMENT_INQUIRY_EMAIL, {
      ...INQUIRY_INPUT,
      ...COMMENT_TARGET,
    });

    expect(rendered.subject).toBe(
      '投稿内容の権利侵害についてご確認をお願いします',
    );
    expect(rendered.html).toMatch(
      datedHtml('回答の期限', DEADLINE, DEADLINE_TEXT),
    );
    expectInOrder(rendered.text, [
      'Pitch Notesへのコメントについて、権利を侵害しているとの申出がありました。次の内容について、ご確認をお願いします。',
      `照会の内容:\n${INQUIRY_INPUT.message}`,
      'コメント:\nこのプロダクトは\n最低です',
      `対象のページ: ${TARGET_URL}`,
      INQUIRY_REPLY_METHOD,
      `回答の期限: ${DEADLINE_TEXT}`,
      INQUIRY_OVERDUE_NOTICE,
    ]);
    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain(INQUIRY_REPLY_METHOD);
      expect(part).toContain(INQUIRY_OVERDUE_NOTICE);
      expect(part).not.toContain('照会日時');
      expect(part).not.toContain(DECIDED_AT_TEXT);
    }
  });

  test.each([
    [
      'ユーザー',
      USER_TARGET,
      'あなたのプロフィールについて、権利を侵害しているとの申出がありました。次の内容について、ご確認をお願いします。',
    ],
    [
      'プロダクト',
      { targetKind: 'product', targetLabel: 'Pitch Notes', excerpt: null },
      LEAD,
    ],
    [
      '表示できない対象',
      { targetKind: 'product', targetLabel: null, excerpt: null },
      'あなたの投稿について、権利を侵害しているとの申出がありました。次の内容について、ご確認をお願いします。',
    ],
  ])('%sの対象を冒頭の文に差し込む', async (_label, target, lead) => {
    const input = { ...INQUIRY_INPUT, ...target };
    const rendered = await render(REPORT_INFRINGEMENT_INQUIRY_EMAIL, input);

    expect(REPORT_INFRINGEMENT_INQUIRY_TEMPLATE.preview(input as never)).toBe(
      lead,
    );
    expect(rendered.text).toContain(lead);
  });

  test('申出者の情報と申出者の理由を載せない', async () => {
    const rendered = await render(REPORT_INFRINGEMENT_INQUIRY_EMAIL, {
      ...INQUIRY_INPUT,
      reporterNickname: REPORTER_NAME,
      reporterReason: '私の写真が無断で使われています',
      contactEmail: 'guest@mail.example',
    });

    for (const part of [rendered.html, rendered.text]) {
      expect(part).not.toContain(REPORTER_NAME);
      expect(part).not.toContain('私の写真が無断で使われています');
      expect(part).not.toContain('guest@mail.example');
    }
  });
});
