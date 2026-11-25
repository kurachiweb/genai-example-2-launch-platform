import { afterEach, describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  tokenColorOf,
} from '../../../lib/test/computed-style.ts';
import {
  SPONSOR_LABEL_TEXT,
  SPONSORSHIP_TIERS,
} from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import { SponsorLabel } from './sponsor-label.tsx';

const labelElement = (): HTMLElement =>
  page.getByText(SPONSOR_LABEL_TEXT, { exact: true }).element() as HTMLElement;

const backgroundImageOf = (element: Element): string =>
  getComputedStyle(element).backgroundImage;

afterEach(() => {
  applyColorScheme('light');
});

describe('SponsorLabel', () => {
  test.each(SPONSORSHIP_TIERS)(
    '%sのラベルは「スポンサー」と示す',
    async (tier) => {
      await render(<SponsorLabel tier={tier} />);

      await expect
        .element(page.getByText(SPONSOR_LABEL_TEXT, { exact: true }))
        .toBeVisible();
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('Legendは光沢感のある黒のグラデーションのトークンで塗り、文字をLegendの文字色のトークンで描く', async () => {
      applyColorScheme(scheme);
      await render(<SponsorLabel tier="legend" />);

      const element = labelElement();
      const image = backgroundImageOf(element);
      expect(image).toContain('linear-gradient');
      expect(image).toContain(tokenColorOf('legend-a'));
      expect(image).toContain(tokenColorOf('legend-b'));
      expect(getComputedStyle(element).color).toBe(
        tokenColorOf('legend-foreground'),
      );
    });

    test('Goldは金のトークンのグラデーションで塗る', async () => {
      applyColorScheme(scheme);
      await render(<SponsorLabel tier="gold" />);

      const element = labelElement();
      const image = backgroundImageOf(element);
      expect(image).toContain('linear-gradient');
      expect(image).toContain(tokenColorOf('gold'));
      expect(image).toContain(tokenColorOf('gold-strong'));
      expect(getComputedStyle(element).color).toBe(
        tokenColorOf('gold-foreground'),
      );
    });

    test('Silverは銀のトークンで塗る', async () => {
      applyColorScheme(scheme);
      await render(<SponsorLabel tier="silver" />);

      const element = labelElement();
      expect(getComputedStyle(element).backgroundColor).toBe(
        tokenColorOf('silver'),
      );
      expect(backgroundImageOf(element)).toBe('none');
    });

    test('3つのティアのラベルのaxeの違反が0件である', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <p>
          {SPONSORSHIP_TIERS.map((tier) => (
            <SponsorLabel key={tier} tier={tier} />
          ))}
        </p>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });

  test('演出のアニメーションと遷移を持たない', async () => {
    await render(
      <p>
        {SPONSORSHIP_TIERS.map((tier) => (
          <SponsorLabel key={tier} tier={tier} />
        ))}
      </p>,
    );

    const labels = page
      .getByText(SPONSOR_LABEL_TEXT, { exact: true })
      .elements();
    expect(labels).toHaveLength(SPONSORSHIP_TIERS.length);
    for (const label of labels) {
      expect(getComputedStyle(label).animationName).toBe('none');
    }
    expect(document.getAnimations()).toHaveLength(0);
  });
});
