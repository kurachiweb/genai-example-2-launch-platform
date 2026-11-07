import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { UltrasBenefitList } from './ultras-benefit-list.tsx';

const BENEFITS_TITLE = '特典';

const RENEWAL_TITLE = '自動更新と解約';

const BENEFITS = [
  'Week・Yearトーナメントの参加費が免除されます。',
  '予選で敗北した後、2日後から再ローンチできます。',
  '公開プロフィールにUltrasに加入中であることが表示されます。',
];

const FIXED_NOTES = [
  '解約はプラン管理画面からいつでも行え、解約した後も課金期間の末日まで特典が続きます。',
  '課金期間の途中で解約しても、日割りの返金はありません。',
  '支払い済みのトーナメント参加費は返金されません。',
];

const AUTO_RENEWAL_NOTE_OF_999 =
  'Ultrasプランは毎月自動で更新され、毎月の更新日に$9.99(税込)を自動でお支払いいただきます。';

const AUTO_RENEWAL_NOTE_WITHOUT_AMOUNT =
  'Ultrasプランは毎月自動で更新され、毎月の更新日に月額料金を自動でお支払いいただきます。';

const benefitList = () => page.getByRole('list', { name: BENEFITS_TITLE });
const renewalList = () => page.getByRole('list', { name: RENEWAL_TITLE });
const headings = () => page.getByRole('heading', { level: 3 });

const itemTextsOf = (list: ReturnType<typeof benefitList>) =>
  list
    .getByRole('listitem')
    .elements()
    .map((item) => item.textContent);

afterEach(() => {
  applyColorScheme('light');
});

describe('UltrasBenefitList', () => {
  test('見出し「特典」をh3で描き、その一覧に参加費の免除・再ローンチ・公開プロフィールの3つの特典を順に示す', async () => {
    await render(<UltrasBenefitList amount={999} />);

    await expect
      .element(headings().filter({ hasText: BENEFITS_TITLE }))
      .toHaveTextContent(BENEFITS_TITLE);
    await expect.element(benefitList()).toBeVisible();
    expect(itemTextsOf(benefitList())).toEqual(BENEFITS);
  });

  test('見出し「自動更新と解約」をh3で描き、その一覧に月額の価格を差し込んだ自動更新の文と解約・日割りの返金なし・参加費の返金なしの4つの文を順に示す', async () => {
    await render(<UltrasBenefitList amount={999} />);

    await expect
      .element(headings().filter({ hasText: RENEWAL_TITLE }))
      .toHaveTextContent(RENEWAL_TITLE);
    await expect.element(renewalList()).toBeVisible();
    expect(itemTextsOf(renewalList())).toEqual([
      AUTO_RENEWAL_NOTE_OF_999,
      ...FIXED_NOTES,
    ]);
  });

  test('価格を照会できないときは、金額を差し込まない自動更新の文に代えて、支払い済みの参加費を返金しない旨を含む4つの文を示す', async () => {
    await render(<UltrasBenefitList amount={null} />);

    await expect.element(renewalList()).toBeVisible();
    expect(itemTextsOf(renewalList())).toEqual([
      AUTO_RENEWAL_NOTE_WITHOUT_AMOUNT,
      ...FIXED_NOTES,
    ]);
    expect(itemTextsOf(benefitList())).toEqual(BENEFITS);
  });

  test('区画の見出しの1段下に置くため、見出しは2つともh3で、他の階層の見出しを描かない', async () => {
    await render(<UltrasBenefitList amount={999} />);

    await expect.element(renewalList()).toBeVisible();
    expect(headings().elements()).toHaveLength(2);
    expect(page.getByRole('heading').elements()).toHaveLength(2);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['価格があるとき', 999],
      ['価格が無いとき', null],
    ])('%s、アクセシビリティの検査の違反が0件', async (_name, amount) => {
      applyColorScheme(scheme);
      const { container } = await render(<UltrasBenefitList amount={amount} />);
      await expect.element(renewalList()).toBeVisible();

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
