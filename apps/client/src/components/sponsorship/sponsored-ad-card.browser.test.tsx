import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  type ServedMediaImages,
  serveMediaImages,
} from '../../../lib/test/served-media-images.ts';
import { SPONSOR_LABEL_TEXT } from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import {
  createPageRouterContext,
  renderInRouter,
  SERVED_IMAGES_ORIGIN,
} from '../../../test/page-router.tsx';
import type {
  SponsoredAdFieldsFragment,
  SponsorshipTier,
} from '../../graphql/generated/graphql.ts';
import { SponsoredAdCard } from './sponsored-ad-card.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const KEY = '6543210fedcba987'.repeat(2);

const PRODUCT_NAME = 'Pitch Notes';

const TAGLINE = 'チームの戦術を1枚のノートにまとめる';

const WEBSITE_URL = 'https://pitch-notes.example/';

const LINK_NAME = `${PRODUCT_NAME}のサイトを別タブで開く(スポンサー広告)`;

const LOGO = {
  id: '01JLOGO000000000000000000A',
  objectKey: KEY,
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
} as const;

const adOf = (
  tier: SponsorshipTier,
  overrides: Partial<SponsoredAdFieldsFragment> = {},
): SponsoredAdFieldsFragment => ({
  id: `01J${tier}`.padEnd(26, '0'),
  tier,
  productName: PRODUCT_NAME,
  tagline: TAGLINE,
  logo: LOGO,
  websiteUrl: WEBSITE_URL,
  ...overrides,
});

const renderCard = (ad: SponsoredAdFieldsFragment) =>
  renderInRouter(<SponsoredAdCard ad={ad} />, {
    context: createPageRouterContext('local', {
      imagesOrigin: SERVED_IMAGES_ORIGIN,
    }),
  });

const loadedLogo = async (): Promise<HTMLImageElement> => {
  await expect.poll(() => document.querySelector('img')).not.toBeNull();
  const image = document.querySelector('img') as HTMLImageElement;
  await expect.poll(() => image.naturalWidth).toBeGreaterThan(0);
  return image;
};

let served: ServedMediaImages;

beforeAll(async () => {
  served = await serveMediaImages(KEY);
});

afterAll(async () => {
  await served.remove();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('SponsoredAdCard', () => {
  test.each<[SponsorshipTier, string]>([
    ['LEGEND', '64'],
    ['GOLD', '64'],
  ])(
    '%sはロゴ(%spx)・ラベル・名称・タグラインを示す',
    async (tier, logoWidth) => {
      await renderCard(adOf(tier));

      await expect
        .element(page.getByText(SPONSOR_LABEL_TEXT, { exact: true }))
        .toBeVisible();
      await expect
        .element(page.getByText(PRODUCT_NAME, { exact: true }))
        .toBeVisible();
      await expect.element(page.getByText(TAGLINE)).toBeVisible();
      const logo = await loadedLogo();
      expect(logo.getAttribute('width')).toBe(logoWidth);
      expect(logo.getBoundingClientRect().width).toBe(Number(logoWidth));
    },
  );

  test('Silverはロゴ(32px)・ラベル・名称だけを示し、タグラインを示さない', async () => {
    await renderCard(adOf('SILVER'));

    await expect
      .element(page.getByText(SPONSOR_LABEL_TEXT, { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText(PRODUCT_NAME, { exact: true }))
      .toBeVisible();
    expect(page.getByText(TAGLINE).elements()).toHaveLength(0);
    const logo = await loadedLogo();
    expect(logo.getAttribute('width')).toBe('32');
    expect(logo.getBoundingClientRect().width).toBe(32);
  });

  test('タグラインが無いLegendは、タグラインの行を描かない', async () => {
    await renderCard(adOf('LEGEND', { tagline: null }));

    await expect
      .element(page.getByText(PRODUCT_NAME, { exact: true }))
      .toBeVisible();
    expect(page.getByText(TAGLINE).elements()).toHaveLength(0);
  });

  test('ロゴは名称の隣の飾りとして読み上げず、ロゴが無ければ同じ大きさの頭文字を描く', async () => {
    await renderCard(adOf('GOLD', { logo: null }));

    await expect
      .element(page.getByText(PRODUCT_NAME, { exact: true }))
      .toBeVisible();
    expect(page.getByRole('img').elements()).toHaveLength(0);
    const placeholder = document.querySelector(
      '[data-slot="media-placeholder"]',
    );
    expect(placeholder?.getAttribute('aria-hidden')).toBe('true');
    expect(placeholder?.getBoundingClientRect().width).toBe(64);
  });

  test.each<SponsorshipTier>(['LEGEND', 'GOLD', 'SILVER'])(
    '%sは外部WebサイトURLへのリンクを別タブで開き、relにsponsoredとnoopenerを付け、読み上げの名前に名称と広告と別タブの旨を含める',
    async (tier) => {
      await renderCard(adOf(tier));

      const link = page.getByRole('link', { name: LINK_NAME });
      await expect.element(link).toBeVisible();
      await expect.element(link).toHaveAttribute('href', WEBSITE_URL);
      await expect.element(link).toHaveAttribute('target', '_blank');
      await expect.element(link).toHaveAttribute('rel', 'sponsored noopener');
      expect(page.getByRole('link').elements()).toHaveLength(1);
    },
  );

  test('リンクはカード全体を押せる範囲にする', async () => {
    await renderCard(adOf('GOLD'));

    const link = page.getByRole('link', { name: LINK_NAME }).element();
    const card = link.closest('[data-slot="sponsored-ad-card"]');
    expect(card).not.toBeNull();
    const after = getComputedStyle(link, '::after');
    expect(after.position).toBe('absolute');
    expect(after.inset).toBe('0px');
  });

  test.each<[string, string | null]>([
    ['外部WebサイトURLが無い', null],
    ['外部WebサイトURLが検証を通らない', 'javascript:alert(1)'],
  ])('%s広告はリンクにせずに示す', async (_label, websiteUrl) => {
    await renderCard(adOf('GOLD', { websiteUrl }));

    await expect
      .element(page.getByText(PRODUCT_NAME, { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByText(SPONSOR_LABEL_TEXT, { exact: true }))
      .toBeVisible();
    expect(page.getByRole('link').elements()).toHaveLength(0);
  });

  test('演出のアニメーションと遷移を持たない', async () => {
    await renderInRouter(
      <div>
        <SponsoredAdCard ad={adOf('LEGEND')} />
        <SponsoredAdCard ad={adOf('GOLD')} />
        <SponsoredAdCard ad={adOf('SILVER')} />
      </div>,
      {
        context: createPageRouterContext('local', {
          imagesOrigin: SERVED_IMAGES_ORIGIN,
        }),
      },
    );

    await expect
      .poll(() => page.getByRole('link', { name: LINK_NAME }).elements())
      .toHaveLength(3);
    for (const element of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      expect(style.animationName).toBe('none');
    }
    expect(document.getAnimations()).toHaveLength(0);
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で3つのティアのカードと、リンクの無いカードのaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderInRouter(
        <ul>
          <li>
            <SponsoredAdCard ad={adOf('LEGEND')} />
          </li>
          <li>
            <SponsoredAdCard ad={adOf('GOLD', { logo: null })} />
          </li>
          <li>
            <SponsoredAdCard ad={adOf('SILVER')} />
          </li>
          <li>
            <SponsoredAdCard
              ad={adOf('GOLD', {
                id: '01JGOLDNOLINK0000000000000',
                websiteUrl: null,
              })}
            />
          </li>
        </ul>,
        {
          context: createPageRouterContext('local', {
            imagesOrigin: SERVED_IMAGES_ORIGIN,
          }),
        },
      );

      await expect.poll(() => document.querySelectorAll('img').length).toBe(3);
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
