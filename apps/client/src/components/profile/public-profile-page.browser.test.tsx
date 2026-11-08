import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  PROFILE_HANDLE,
  PROFILE_NICKNAME,
  publicProfileOf,
} from './public-profile-fixtures.ts';
import {
  renderPublicProfilePage,
  tabOf,
} from './public-profile-page-testing.tsx';
import type {
  PublicProfileBadgeSection,
  PublicProfileMenuItem,
  PublicProfileSectionContext,
  PublicProfileTab,
} from './public-profile-section-types.ts';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const OWNER_VIEWER = signedInViewerQuery({ handle: PROFILE_HANDLE });

const OWNER_PROFILE = publicProfileOf({ viewerRelation: 'OWNER' });

const TABS: readonly PublicProfileTab[] = [
  tabOf({ id: 'launches', label: 'ローンチ履歴', order: 10, count: 2 }),
  tabOf({ id: 'upvotes', label: 'Upvote履歴', order: 20, count: 5 }),
];

const card = () => page.getByRole('region', { name: PROFILE_NICKNAME });
const tabList = () => page.getByRole('tablist', { name: 'プロフィールの内容' });
const rectOf = (locator: ReturnType<typeof card>) =>
  locator.element().getBoundingClientRect();

afterEach(() => {
  applyColorScheme('light');
});

describe('PublicProfilePage', () => {
  describe('配置', () => {
    test('PC(1024px以上)は左に人物情報、右にタブの2カラムで並べる', async () => {
      await page.viewport(1280, 800);
      await renderPublicProfilePage(publicProfileOf(), { tabs: TABS });
      await expect.element(tabList()).toBeVisible();

      const cardRect = rectOf(card());
      const tabsRect = tabList().element().getBoundingClientRect();

      expect(cardRect.right).toBeLessThanOrEqual(tabsRect.left);
      expect(Math.abs(cardRect.top - tabsRect.top)).toBeLessThan(2);
      expect(cardRect.width).toBeGreaterThanOrEqual(320);
      expect(cardRect.width).toBeLessThanOrEqual(352);
    });

    test('1024px未満は人物情報の下にタブを置く1カラムにする', async () => {
      await page.viewport(800, 800);
      await renderPublicProfilePage(publicProfileOf(), { tabs: TABS });
      await expect.element(tabList()).toBeVisible();

      const cardRect = rectOf(card());
      const tabsRect = tabList().element().getBoundingClientRect();

      expect(tabsRect.top).toBeGreaterThanOrEqual(cardRect.bottom);
      expect(Math.abs(cardRect.left - tabsRect.left)).toBeLessThan(2);
    });

    test('モバイルの幅でも横にはみ出さない', async () => {
      await page.viewport(375, 800);
      await renderPublicProfilePage(publicProfileOf(), { tabs: TABS });
      await expect.element(tabList()).toBeVisible();

      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
    });
  });

  describe('タブが1つも登録されていないとき', () => {
    test('右カラムを出さず、人物情報だけを表示する', async () => {
      await page.viewport(1280, 800);
      await renderPublicProfilePage(publicProfileOf(), { tabs: [] });

      await expect
        .element(page.getByRole('heading', { level: 1 }))
        .toHaveTextContent(PROFILE_NICKNAME);
      await expect.element(card()).toBeVisible();
      await expect.element(tabList()).not.toBeInTheDocument();
      await expect.element(page.getByRole('tabpanel')).not.toBeInTheDocument();
    });

    test('登録箇所の既定(初版は空)でも人物情報だけを表示する', async () => {
      await renderPublicProfilePage(publicProfileOf());

      await expect.element(card()).toBeVisible();
      await expect.element(tabList()).not.toBeInTheDocument();
    });
  });

  describe('停止中の本人の帯', () => {
    test('停止中である旨と問い合わせへの導線を示す', async () => {
      await renderPublicProfilePage(
        publicProfileOf({ viewerRelation: 'OWNER', suspended: true }),
        { cachedViewer: OWNER_VIEWER, tabs: TABS },
      );

      const banner = page.getByRole('note', { name: '停止中のアカウント' });
      await expect.element(banner).toBeVisible();
      await expect
        .element(banner)
        .toHaveTextContent(
          'このアカウントは停止されています。プロフィールとプロダクトは他のユーザーには表示されません。詳しくはお問い合わせください。',
        );
      await expect
        .element(banner.getByRole('link', { name: 'お問い合わせ' }))
        .toHaveAttribute('href', '/contact');
    });

    test('帯はタブと人物情報より前に置く', async () => {
      await page.viewport(1280, 800);
      await renderPublicProfilePage(
        publicProfileOf({ viewerRelation: 'OWNER', suspended: true }),
        { cachedViewer: OWNER_VIEWER, tabs: TABS },
      );
      const banner = page.getByRole('note', { name: '停止中のアカウント' });
      await expect.element(banner).toBeVisible();

      expect(rectOf(banner).bottom).toBeLessThanOrEqual(rectOf(card()).top);
    });

    test('停止中の本人には「プロフィールを編集」の導線を出さない', async () => {
      await renderPublicProfilePage(
        publicProfileOf({ viewerRelation: 'OWNER', suspended: true }),
        { cachedViewer: OWNER_VIEWER },
      );

      await expect
        .element(page.getByRole('note', { name: '停止中のアカウント' }))
        .toBeVisible();
      await expect
        .element(page.getByRole('link', { name: 'プロフィールを編集' }))
        .not.toBeInTheDocument();
    });

    test('停止中でなければ帯を出さない', async () => {
      await renderPublicProfilePage(OWNER_PROFILE, {
        cachedViewer: OWNER_VIEWER,
        tabs: TABS,
      });

      await expect.element(card()).toBeVisible();
      await expect
        .element(page.getByRole('note', { name: '停止中のアカウント' }))
        .not.toBeInTheDocument();
    });
  });

  describe('区画への文脈の受け渡し', () => {
    const CONTEXT_CASES: readonly {
      readonly name: string;
      readonly profile: ReturnType<typeof publicProfileOf>;
      readonly expected: PublicProfileSectionContext;
    }[] = [
      {
        name: '他の利用者のプロフィール',
        profile: publicProfileOf(),
        expected: {
          handle: PROFILE_HANDLE,
          nickname: PROFILE_NICKNAME,
          isOwner: false,
          suspended: false,
        },
      },
      {
        name: '停止中の本人のプロフィール',
        profile: publicProfileOf({ viewerRelation: 'OWNER', suspended: true }),
        expected: {
          handle: PROFILE_HANDLE,
          nickname: PROFILE_NICKNAME,
          isOwner: true,
          suspended: true,
        },
      },
    ];

    test.each(CONTEXT_CASES)(
      '$nameのとき、タブの件数・パネルとバッジに同じ文脈を渡す',
      async ({ profile, expected }) => {
        const seen: Record<string, PublicProfileSectionContext> = {};
        const record =
          (key: string) =>
          (context: PublicProfileSectionContext): void => {
            seen[key] = context;
          };
        const recordCount = record('count');
        const recordPanel = record('panel');
        const recordBadge = record('badge');
        const tab: PublicProfileTab = {
          id: 'launches',
          label: 'ローンチ履歴',
          order: 10,
          Count: (context) => {
            recordCount(context);
            return <>1</>;
          },
          Panel: (context) => {
            recordPanel(context);
            return <p>パネル</p>;
          },
        };
        const badge: PublicProfileBadgeSection = {
          id: 'test.badge',
          order: 10,
          Section: (context) => {
            recordBadge(context);
            return <span>バッジ</span>;
          },
        };

        await renderPublicProfilePage(profile, {
          cachedViewer: OWNER_VIEWER,
          tabs: [tab],
          badges: [badge],
        });

        await expect.element(page.getByText('パネル')).toBeVisible();
        await expect.element(page.getByText('バッジ')).toBeVisible();
        expect(seen.count).toStrictEqual(expected);
        expect(seen.panel).toStrictEqual(expected);
        expect(seen.badge).toStrictEqual(expected);
      },
    );

    test('「…」メニューの項目へも同じ文脈を渡す', async () => {
      const seen: PublicProfileSectionContext[] = [];
      const menuItem: PublicProfileMenuItem = {
        id: 'test.item',
        order: 10,
        Item: (context) => {
          seen.push(context);
          return <div role="menuitem">項目</div>;
        },
      };
      await renderPublicProfilePage(publicProfileOf(), {
        menuItems: [menuItem],
      });
      await page.getByRole('button', { name: 'その他の操作' }).click();
      await expect.element(page.getByRole('menuitem')).toBeVisible();

      expect(seen[0]).toStrictEqual({
        handle: PROFILE_HANDLE,
        nickname: PROFILE_NICKNAME,
        isOwner: false,
        suspended: false,
      });
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(async () => {
      applyColorScheme(scheme);
      await page.viewport(1280, 800);
    });

    test('タブがあるページのaxeの違反が0件である', async () => {
      await renderPublicProfilePage(publicProfileOf(), { tabs: TABS });
      await expect.element(tabList()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('タブが無いページのaxeの違反が0件である', async () => {
      await renderPublicProfilePage(publicProfileOf(), { tabs: [] });
      await expect.element(card()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('停止中の本人の帯があるページのaxeの違反が0件である', async () => {
      await renderPublicProfilePage(
        publicProfileOf({ viewerRelation: 'OWNER', suspended: true }),
        { cachedViewer: OWNER_VIEWER, tabs: TABS },
      );
      await expect
        .element(page.getByRole('note', { name: '停止中のアカウント' }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
