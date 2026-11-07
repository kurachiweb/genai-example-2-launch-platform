import { useId } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { PricingSection } from '../../composition/pricing-sections.ts';
import { PricingPage } from './pricing-page.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const PAGE_TITLE = '料金';
const ULTRAS_TITLE = 'Ultras';
const SPONSORSHIP_TITLE = 'スポンサー広告';
const ULTRAS_BODY = 'Ultrasの区画の本文';
const SPONSORSHIP_BODY = 'スポンサー広告の区画の本文';
const LEGAL_NOTICE_TEXT =
  '返金ポリシーと特定商取引法に基づく表記は、法的通知をご確認ください。';
const LEGAL_NOTICE_LINK_LABEL = '法的通知';
const RETRY_LABEL = '再試行';
const CONTACT_LABEL = 'お問い合わせ';
const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const sectionOf = (title: string, body: string): PricingSection['component'] =>
  function FakeSection() {
    const headingId = useId();
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId}>{title}</h2>
        <p>{body}</p>
      </section>
    );
  };

const UltrasSection = sectionOf(ULTRAS_TITLE, ULTRAS_BODY);

const SponsorshipSection = sectionOf(SPONSORSHIP_TITLE, SPONSORSHIP_BODY);

let sectionFailing = false;

// Reactは失敗した描画をやり直すため、テストが失敗を止めるまで描画のたびに失敗する
function ThrowingUltrasSection() {
  if (sectionFailing) {
    throw new Error('区画の描画の失敗');
  }
  return <UltrasSection />;
}

const registered = (
  id: string,
  order: number,
  title: string,
  component: PricingSection['component'],
): PricingSection => ({ id, order, title, component });

const ULTRAS = registered(
  'ultras-subscription.ultras-pricing',
  10,
  ULTRAS_TITLE,
  UltrasSection,
);

const SPONSORSHIP = registered(
  'sponsorship.sponsorship-pricing',
  20,
  SPONSORSHIP_TITLE,
  SponsorshipSection,
);

const BROKEN_ULTRAS = registered(
  'ultras-subscription.ultras-pricing',
  10,
  ULTRAS_TITLE,
  ThrowingUltrasSection,
);

const renderPage = (sections: readonly PricingSection[]) =>
  renderInRouter(
    <main>
      <PricingPage sections={sections} />
    </main>,
  );

const pageHeading = () => page.getByRole('heading', { level: 1 });
const sectionHeadings = () =>
  page
    .getByRole('heading', { level: 2 })
    .elements()
    .map((heading) => heading.textContent);
const legalLink = () =>
  page.getByRole('link', { name: LEGAL_NOTICE_LINK_LABEL, exact: true });
const regionOf = (name: string) => page.getByRole('region', { name });

beforeEach(() => {
  sectionFailing = false;
  executeGraphQL.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('PricingPage', () => {
  test('題名「料金」を見出しにし、登録の順によらず区画をorderの順に並べ、末尾に法的通知へのリンクを置く', async () => {
    await renderPage([SPONSORSHIP, ULTRAS]);

    await expect.element(pageHeading()).toHaveTextContent(PAGE_TITLE);
    await expect.element(page.getByText(SPONSORSHIP_BODY)).toBeVisible();
    expect(sectionHeadings()).toStrictEqual([ULTRAS_TITLE, SPONSORSHIP_TITLE]);
    await expect.element(legalLink()).toHaveAttribute('href', '/legal');
    const notice = legalLink().element().closest('p');
    expect(notice?.textContent).toBe(LEGAL_NOTICE_TEXT);
    const sponsorship = regionOf(SPONSORSHIP_TITLE).element();
    expect(
      sponsorship.compareDocumentPosition(notice ?? sponsorship) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  test('区画が1つも無くても、題名と法的通知へのリンクを表示する', async () => {
    await renderPage([]);

    await expect.element(pageHeading()).toHaveTextContent(PAGE_TITLE);
    await expect.element(legalLink()).toHaveAttribute('href', '/legal');
    expect(sectionHeadings()).toStrictEqual([]);
  });

  test('1つの区画の失敗はその位置に区画の見出しと失敗の文言・再試行・問い合わせの導線を示し、他の区画と法的通知へのリンクの表示を続ける', async () => {
    sectionFailing = true;
    await renderPage([BROKEN_ULTRAS, SPONSORSHIP]);

    await expect
      .element(regionOf(ULTRAS_TITLE).getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_MESSAGE);
    expect(sectionHeadings()).toStrictEqual([ULTRAS_TITLE, SPONSORSHIP_TITLE]);
    await expect
      .element(
        regionOf(ULTRAS_TITLE).getByRole('button', { name: RETRY_LABEL }),
      )
      .toBeVisible();
    await expect
      .element(
        regionOf(ULTRAS_TITLE).getByRole('link', { name: CONTACT_LABEL }),
      )
      .toHaveAttribute('href', '/contact');
    await expect.element(page.getByText(SPONSORSHIP_BODY)).toBeVisible();
    await expect.element(legalLink()).toHaveAttribute('href', '/legal');
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ message: '区画の描画の失敗' }),
      'render',
    );
  });

  test('再試行で失敗した区画を描き直し、描き直した区画の見出しへフォーカスを移す', async () => {
    sectionFailing = true;
    await renderPage([BROKEN_ULTRAS, SPONSORSHIP]);
    await expect.element(page.getByRole('alert')).toBeVisible();
    sectionFailing = false;

    await userEvent.click(page.getByRole('button', { name: RETRY_LABEL }));

    await expect.element(page.getByText(ULTRAS_BODY)).toBeVisible();
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    await expect
      .element(
        regionOf(ULTRAS_TITLE).getByRole('heading', {
          level: 2,
          name: ULTRAS_TITLE,
        }),
      )
      .toHaveFocus();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('区画の並びと失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      sectionFailing = true;
      await renderPage([BROKEN_ULTRAS, SPONSORSHIP]);
      await expect.element(page.getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('区画が無いページで、アクセシビリティの検査の違反が0件', async () => {
      await renderPage([]);
      await expect.element(legalLink()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
