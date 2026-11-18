import { describe, expect, test } from 'vitest';

import { EMAIL_KINDS } from '../../../../../lib/core/email/kinds/index.ts';
import {
  SPONSORSHIP_END_NOTICE_EMAIL,
  SPONSORSHIP_START_NOTICE_EMAIL,
  SPONSORSHIP_TERMINATION_NOTICE_EMAIL,
} from '../../../../../lib/core/email/kinds/sponsorship.ts';
import type { AnyEmailKind } from '../../../../../lib/core/email/email-kind.ts';
import { createEmailTemplateRegistry } from '../../rendering/email-template.ts';
import { ReactEmailRenderer } from '../../rendering/react-email-renderer.tsx';
import { EMAIL_TEMPLATES } from '../index.ts';
import { SPONSORSHIP_EMAIL_TEMPLATES } from './index.ts';
import { SPONSORSHIP_END_NOTICE_TEMPLATE } from './sponsorship-end-notice-template.ts';
import { SPONSORSHIP_START_NOTICE_TEMPLATE } from './sponsorship-start-notice-template.ts';
import { SPONSORSHIP_TERMINATION_NOTICE_TEMPLATE } from './sponsorship-termination-notice-template.ts';

const NICKNAME = '山田 はなこ';

const PRODUCT_NAME = 'Pitch Notes';

const LIST_URL = 'https://client.example/settings/sponsorships';

const LEGAL_URL = 'https://client.example/legal';

const ACTION_LABEL = '自分の広告一覧を見る';

const LIST_GUIDE_SENTENCE =
  '掲載状況は、下のボタンから自分の広告一覧で確認できます。';

const BASE_INPUT = {
  nickname: NICKNAME,
  productName: PRODUCT_NAME,
  tierLabel: 'Gold',
  startsOn: '2026-11-01',
  endsOn: '2026-11-07',
  days: 7,
  listUrl: LIST_URL,
};

const END_INPUT = {
  ...BASE_INPUT,
  stopRefund: { days: 3, amount: '$9.00' },
};

const TERMINATION_INPUT = {
  ...BASE_INPUT,
  terminatedOn: '2026-11-03',
  reason: '広告の内容が掲載の基準に合わないため',
  legalUrl: LEGAL_URL,
  terminationRefund: { days: 5, amount: '$15.00' },
  stopRefund: { days: 1, amount: '$3.00' },
};

const PERIOD_HTML =
  /掲載期間: <time datetime="2026-11-01">2026年11月1日<\/time>〜<time datetime="2026-11-07">11月7日<\/time>\(UTC-08:00の日付\)、7日間/iu;

const PERIOD_TEXT = '掲載期間: 2026年11月1日〜11月7日(UTC-08:00の日付)、7日間';

const START_LEAD = 'Pitch Notesのスポンサー広告(Gold)の掲載が始まりました。';

const END_LEAD = 'Pitch Notesのスポンサー広告(Gold)の掲載期間が終了しました。';

const TERMINATION_LEAD =
  'Pitch Notesのスポンサー広告(Gold)の掲載を、運営者の判断により終了しました。';

const STOP_REFUND_SENTENCE =
  'プロダクトの公開停止またはアカウントの停止により表示を止めた日数分の広告料金を、決済に使った支払い方法へ自動で返金します。お手元に反映されるまで数日かかる場合があります。';

const TERMINATION_REFUND_SENTENCE =
  '次の金額を、決済に使った支払い方法へ自動で返金します。お手元に反映されるまで数日かかる場合があります。';

const UNSUBSCRIBE_LABEL = '配信停止';

function createRenderer(): ReactEmailRenderer {
  return new ReactEmailRenderer(
    createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS),
  );
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/gu)].map(([, href]) => href ?? '');
}

function render(kind: AnyEmailKind, input: Record<string, unknown>) {
  return createRenderer().render(kind, input, undefined);
}

describe('スポンサー広告のテンプレートの集約', () => {
  test('開始・終了・強制終了の通知のテンプレートを凍結して持ち、それぞれトランザクションメールの種別を指す', () => {
    expect(SPONSORSHIP_EMAIL_TEMPLATES).toEqual([
      SPONSORSHIP_START_NOTICE_TEMPLATE,
      SPONSORSHIP_END_NOTICE_TEMPLATE,
      SPONSORSHIP_TERMINATION_NOTICE_TEMPLATE,
    ]);
    expect(Object.isFrozen(SPONSORSHIP_EMAIL_TEMPLATES)).toBe(true);
    expect(SPONSORSHIP_START_NOTICE_TEMPLATE.kind).toBe(
      SPONSORSHIP_START_NOTICE_EMAIL,
    );
    expect(SPONSORSHIP_END_NOTICE_TEMPLATE.kind).toBe(
      SPONSORSHIP_END_NOTICE_EMAIL,
    );
    expect(SPONSORSHIP_TERMINATION_NOTICE_TEMPLATE.kind).toBe(
      SPONSORSHIP_TERMINATION_NOTICE_EMAIL,
    );
    for (const template of SPONSORSHIP_EMAIL_TEMPLATES) {
      expect(template.kind.category).toBe('transactional');
    }
  });

  test('全テンプレートの集約点から種別の名前で引ける', () => {
    const registry = createEmailTemplateRegistry(EMAIL_TEMPLATES, EMAIL_KINDS);

    expect(registry.get('sponsorship.start-notice')).toBe(
      SPONSORSHIP_START_NOTICE_TEMPLATE,
    );
    expect(registry.get('sponsorship.end-notice')).toBe(
      SPONSORSHIP_END_NOTICE_TEMPLATE,
    );
    expect(registry.get('sponsorship.termination-notice')).toBe(
      SPONSORSHIP_TERMINATION_NOTICE_TEMPLATE,
    );
  });

  test.each([
    ['開始', SPONSORSHIP_START_NOTICE_TEMPLATE, BASE_INPUT],
    ['終了', SPONSORSHIP_END_NOTICE_TEMPLATE, END_INPUT],
    ['強制終了', SPONSORSHIP_TERMINATION_NOTICE_TEMPLATE, TERMINATION_INPUT],
  ] as const)(
    '%sの通知は宛名にニックネームを使い、ボタンで自分の広告一覧へリンクし、配信停止の区画を持たない',
    (_label, template, input) => {
      expect(template.greeting(input as never)).toBe(NICKNAME);
      expect(template.action?.(input as never)).toEqual({
        label: ACTION_LABEL,
        url: LIST_URL,
      });
      expect('unsubscribeLinks' in template).toBe(false);
    },
  );
});

describe('掲載開始通知のテンプレート', () => {
  test('件名を文言規則の件名にし、受信一覧の冒頭の文を持つ', () => {
    expect(SPONSORSHIP_START_NOTICE_TEMPLATE.subject(BASE_INPUT)).toBe(
      'Pitch Notesのスポンサー広告掲載が始まりました',
    );
    expect(SPONSORSHIP_START_NOTICE_TEMPLATE.preview(BASE_INPUT)).toBe(
      START_LEAD,
    );
  });

  test('HTMLのパートに宛名・プロダクトの名称とティア・time要素で包んだ基準時刻の日付の掲載期間・一覧への導線とボタンを置く', async () => {
    const rendered = await render(SPONSORSHIP_START_NOTICE_EMAIL, BASE_INPUT);

    expect(rendered.subject).toBe(
      'Pitch Notesのスポンサー広告掲載が始まりました',
    );
    expect(rendered.html).toContain(`${NICKNAME}さん`);
    expect(rendered.html).toContain(START_LEAD);
    expect(rendered.html).toMatch(PERIOD_HTML);
    expect(rendered.html).toContain(LIST_GUIDE_SENTENCE);
    expect(rendered.html).toContain(ACTION_LABEL);
    expect(hrefsOf(rendered.html)).toEqual([LIST_URL]);
    expect(rendered.html).not.toContain(UNSUBSCRIBE_LABEL);
    expect(rendered.html).not.toContain('返金');
    expect(rendered.html).not.toContain('<!-- -->');
  });

  test('テキストのパートにも同じ文とURLを置き、配信停止のリンクを置かない', async () => {
    const rendered = await render(SPONSORSHIP_START_NOTICE_EMAIL, BASE_INPUT);

    for (const part of [
      `${NICKNAME}さん`,
      START_LEAD,
      PERIOD_TEXT,
      LIST_GUIDE_SENTENCE,
      ACTION_LABEL,
      LIST_URL,
    ]) {
      expect(rendered.text).toContain(part);
    }
    expect(rendered.text).not.toContain(UNSUBSCRIBE_LABEL);
    expect(rendered.text).not.toMatch(/<[a-z]/iu);
  });

  test('年をまたぐ掲載期間は終了日にも年を付け、1日だけの期間も同じ形で表す', async () => {
    const crossing = await render(SPONSORSHIP_START_NOTICE_EMAIL, {
      ...BASE_INPUT,
      startsOn: '2026-12-25',
      endsOn: '2027-01-03',
      days: 10,
    });
    const single = await render(SPONSORSHIP_START_NOTICE_EMAIL, {
      ...BASE_INPUT,
      startsOn: '2026-11-01',
      endsOn: '2026-11-01',
      days: 1,
    });

    expect(crossing.text).toContain(
      '掲載期間: 2026年12月25日〜2027年1月3日(UTC-08:00の日付)、10日間',
    );
    expect(single.text).toContain(
      '掲載期間: 2026年11月1日〜11月1日(UTC-08:00の日付)、1日間',
    );
  });

  test('利用者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await render(SPONSORSHIP_START_NOTICE_EMAIL, {
      ...BASE_INPUT,
      productName: '<script>alert(1)</script>',
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('掲載終了通知のテンプレート', () => {
  test('件名を文言規則の件名にし、受信一覧の冒頭の文を持つ', () => {
    expect(SPONSORSHIP_END_NOTICE_TEMPLATE.subject(END_INPUT)).toBe(
      'Pitch Notesのスポンサー広告掲載期間が終了しました',
    );
    expect(SPONSORSHIP_END_NOTICE_TEMPLATE.preview(END_INPUT)).toBe(END_LEAD);
  });

  test('表示停止の返金があればHTMLとテキストに返金の旨と日数と金額を置く', async () => {
    const rendered = await render(SPONSORSHIP_END_NOTICE_EMAIL, END_INPUT);

    expect(rendered.html).toMatch(PERIOD_HTML);
    expect(hrefsOf(rendered.html)).toEqual([LIST_URL]);
    expect(rendered.html).not.toContain('<!-- -->');
    for (const part of [
      `${NICKNAME}さん`,
      END_LEAD,
      PERIOD_TEXT,
      STOP_REFUND_SENTENCE,
      '表示を止めた3日分: $9.00',
      LIST_GUIDE_SENTENCE,
      ACTION_LABEL,
      LIST_URL,
    ]) {
      expect(rendered.text).toContain(part);
    }
    expect(rendered.html).toContain(STOP_REFUND_SENTENCE);
    expect(rendered.html).toContain('表示を止めた3日分: $9.00');
    for (const part of [rendered.html, rendered.text]) {
      expect(part).not.toContain(UNSUBSCRIBE_LABEL);
    }
  });

  test('残りの全額で依頼した返金は金額の代わりにその旨を置く', async () => {
    const rendered = await render(SPONSORSHIP_END_NOTICE_EMAIL, {
      ...END_INPUT,
      stopRefund: { days: 3, amount: '残りの全額' },
    });

    expect(rendered.text).toContain('表示を止めた3日分: 残りの全額');
  });

  test('表示停止の返金が無ければ返金の文を置かない', async () => {
    const rendered = await render(SPONSORSHIP_END_NOTICE_EMAIL, {
      ...END_INPUT,
      stopRefund: null,
    });

    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain(END_LEAD);
      expect(part).toContain(LIST_GUIDE_SENTENCE);
      expect(part).not.toContain('返金');
    }
  });
});

describe('強制終了の通知のテンプレート', () => {
  test('件名を文言規則の件名にし、受信一覧の冒頭の文を持つ', () => {
    expect(
      SPONSORSHIP_TERMINATION_NOTICE_TEMPLATE.subject(TERMINATION_INPUT),
    ).toBe('Pitch Notesのスポンサー広告掲載を終了しました');
    expect(
      SPONSORSHIP_TERMINATION_NOTICE_TEMPLATE.preview(TERMINATION_INPUT),
    ).toBe(TERMINATION_LEAD);
  });

  test('理由・強制終了日・2つの返金の日数と金額・返金ポリシーの案内と法的通知へのリンクを置く', async () => {
    const rendered = await render(
      SPONSORSHIP_TERMINATION_NOTICE_EMAIL,
      TERMINATION_INPUT,
    );

    expect(rendered.html).toMatch(PERIOD_HTML);
    expect(rendered.html).toMatch(
      /強制終了日: <time datetime="2026-11-03">2026年11月3日<\/time>\(UTC-08:00の日付\)/iu,
    );
    expect(hrefsOf(rendered.html)).toEqual([LEGAL_URL, LIST_URL]);
    expect(rendered.html).not.toContain('<!-- -->');
    const sentences = [
      `${NICKNAME}さん`,
      TERMINATION_LEAD,
      PERIOD_TEXT,
      '強制終了日: 2026年11月3日(UTC-08:00の日付)',
      '理由: 広告の内容が掲載の基準に合わないため',
      TERMINATION_REFUND_SENTENCE,
      '未掲載の5日分: $15.00',
      '表示を止めた1日分: $3.00',
      '返金の扱いは、法的通知の返金ポリシーをご覧ください。',
      LIST_GUIDE_SENTENCE,
      ACTION_LABEL,
    ];
    for (const sentence of sentences) {
      expect(rendered.text).toContain(sentence);
    }
    for (const sentence of sentences.filter(
      (part) => !part.startsWith('強制終了日') && !part.startsWith('掲載期間'),
    )) {
      expect(rendered.html).toContain(sentence);
    }
    expect(rendered.html).toMatch(
      /<a href="https:\/\/client\.example\/legal"[^>]*>法的通知を見る<\/a>/u,
    );
    expect(rendered.text).toContain(`法的通知を見る ${LEGAL_URL}`);
    expect(rendered.text).toContain(LIST_URL);
    for (const part of [rendered.html, rendered.text]) {
      expect(part).not.toContain(UNSUBSCRIBE_LABEL);
    }
  });

  test.each([
    [
      '強制終了の返金だけ',
      { stopRefund: null },
      ['未掲載の5日分: $15.00'],
      ['表示を止めた'],
    ],
    [
      '表示停止の返金だけ',
      { terminationRefund: null },
      ['表示を止めた1日分: $3.00'],
      ['未掲載の'],
    ],
    [
      '残りの全額で依頼した強制終了の返金',
      {
        terminationRefund: { days: 5, amount: '残りの全額' },
        stopRefund: null,
      },
      ['未掲載の5日分: 残りの全額'],
      ['表示を止めた'],
    ],
  ])(
    '%sなら依頼した返金の行だけを置く',
    async (_label, override, included, excluded) => {
      const rendered = await render(SPONSORSHIP_TERMINATION_NOTICE_EMAIL, {
        ...TERMINATION_INPUT,
        ...override,
      });

      for (const part of [rendered.html, rendered.text]) {
        expect(part).toContain(TERMINATION_REFUND_SENTENCE);
        for (const sentence of included) {
          expect(part).toContain(sentence);
        }
        for (const sentence of excluded) {
          expect(part).not.toContain(sentence);
        }
      }
    },
  );

  test('返金が無ければ自動の返金の文と返金の行を置かず、返金ポリシーの案内は置く', async () => {
    const rendered = await render(SPONSORSHIP_TERMINATION_NOTICE_EMAIL, {
      ...TERMINATION_INPUT,
      terminationRefund: null,
      stopRefund: null,
    });

    for (const part of [rendered.html, rendered.text]) {
      expect(part).not.toContain(TERMINATION_REFUND_SENTENCE);
      expect(part).not.toContain('未掲載の');
      expect(part).not.toContain('表示を止めた');
      expect(part).toContain(
        '返金の扱いは、法的通知の返金ポリシーをご覧ください。',
      );
    }
  });

  test('利用者と管理者の値に含まれる<script>をHTMLとして解釈させない', async () => {
    const rendered = await render(SPONSORSHIP_TERMINATION_NOTICE_EMAIL, {
      ...TERMINATION_INPUT,
      nickname: '<script>alert(1)</script>',
      reason: '<script>alert(2)</script>',
    });

    expect(rendered.html).not.toMatch(/<script\b/iu);
    expect(rendered.html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;さん',
    );
    expect(rendered.html).toContain(
      '理由: &lt;script&gt;alert(2)&lt;/script&gt;',
    );
  });
});
