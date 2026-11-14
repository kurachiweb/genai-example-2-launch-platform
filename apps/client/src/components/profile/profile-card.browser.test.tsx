import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../../../lib/test/fake-turnstile.tsx';
import {
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  signedInViewerQuery,
  VIEWER_HANDLE,
} from '../../../test/viewer-fixtures.ts';
import type { ClientViewerQuery } from '../../graphql/generated/graphql.ts';
import { ProfileCard, type ProfileCardProps } from './profile-card.tsx';
import {
  PROFILE_HANDLE,
  PROFILE_NICKNAME,
  publicProfileOf,
} from './public-profile-fixtures.ts';
import type {
  PublicProfileBadgeSection,
  PublicProfileMenuItem,
  PublicProfileSectionContext,
} from './public-profile-section-types.ts';
import type { PublicProfileView } from './public-profile-view.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const OWNER_VIEWER = signedInViewerQuery({ handle: PROFILE_HANDLE });

const OTHER_VIEWER = signedInViewerQuery();

const SITE_ORIGIN = 'https://client.example';

const HEIGHT_LIMIT_PX = 240;

const longBio = (paragraphs: number): string =>
  Array.from(
    { length: paragraphs },
    (_, index) =>
      `段落${(index + 1).toString()}です。プロフィールの自己紹介の本文を並べます。`,
  ).join('\n\n');

const renderCard = (
  profile: PublicProfileView,
  props: Partial<ProfileCardProps> = {},
  viewer: ClientViewerQuery = OTHER_VIEWER,
) =>
  renderInRouter(
    <TooltipProvider>
      <div className="w-80">
        <ProfileCard profile={profile} {...props} />
      </div>
      <Toaster />
    </TooltipProvider>,
    { cachedViewer: viewer },
  );

const badgeOf = (
  id: string,
  order: number,
  text: string,
  seen?: PublicProfileSectionContext[],
): PublicProfileBadgeSection => ({
  id,
  order,
  Section: (context) => {
    seen?.push(context);
    return <span data-testid="badge-section">{text}</span>;
  },
});

const menuItemOf = (
  id: string,
  order: number,
  text: string,
): PublicProfileMenuItem => ({
  id,
  order,
  Item: () => <div role="menuitem">{text}</div>,
});

const documentElement = (selector: string): Element | null =>
  document.querySelector(selector);

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('ProfileCard', () => {
  describe('人物', () => {
    test('ニックネームをページの見出し、@付きのハンドルとヘッドラインを続けて表示する', async () => {
      await renderCard(
        publicProfileOf({ headline: 'プロダクトを作っています' }),
      );

      await expect
        .element(page.getByRole('heading', { level: 1 }))
        .toHaveTextContent(PROFILE_NICKNAME);
      await expect.element(page.getByText('@maker_ai')).toBeVisible();
      await expect
        .element(page.getByText('プロダクトを作っています'))
        .toBeVisible();
    });

    test.each<[string, string, Partial<PublicProfileView>]>([
      ['ヘッドライン', 'profile-headline', { headline: null }],
      ['ヘッドライン(空文字)', 'profile-headline', { headline: '' }],
      ['自己紹介', 'profile-bio', { bio: null }],
      ['自己紹介(空白だけ)', 'profile-bio', { bio: ' \n ' }],
      ['外部Webサイト', 'profile-websites', { websites: [] }],
    ])('未入力の%sは区画ごと描かない', async (_name, slot, overrides) => {
      await renderCard(publicProfileOf(overrides));

      await expect
        .element(page.getByRole('heading', { level: 1 }))
        .toBeVisible();
      expect(documentElement(`[data-slot="${slot}"]`)).toBeNull();
    });

    test('アバターは画像が無ければニックネームの頭文字の代わりの絵に、読み上げの名前を付ける', async () => {
      await renderCard(publicProfileOf());

      await expect
        .element(
          page.getByRole('img', {
            name: `${PROFILE_NICKNAME}のプロフィール画像`,
          }),
        )
        .toBeVisible();
    });
  });

  describe('自己紹介', () => {
    test('見えない見出し「自己紹介」の下にマークダウンの描画結果を表示する', async () => {
      await renderCard(
        publicProfileOf({ bio: '## 経歴\n\n**ソフトウェア**を作ります。' }),
      );

      await expect
        .element(page.getByRole('heading', { level: 2, name: '自己紹介' }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole('heading', { name: '経歴' }))
        .toBeVisible();
      expect(
        document.querySelector('[data-slot="profile-bio"] strong')?.textContent,
      ).toBe('ソフトウェア');
    });

    test('別のオリジンへのリンクにはnoopenerとugc、同じオリジンへのリンクにはugcを付ける', async () => {
      await renderCard(
        publicProfileOf({
          bio: `[外部](https://outside.example/page) と [内部](${SITE_ORIGIN}/products)`,
        }),
      );

      const external = page.getByRole('link', { name: '外部' }).element();
      const internal = page.getByRole('link', { name: '内部' }).element();
      expect(external.getAttribute('rel')?.split(' ').toSorted()).toStrictEqual(
        ['noopener', 'ugc'],
      );
      expect(internal.getAttribute('rel')?.split(' ')).toStrictEqual(['ugc']);
    });

    test('240pxを超える高さは折りたたみ、「続きを読む」で全文を表示し「折りたたむ」で戻す', async () => {
      await renderCard(publicProfileOf({ bio: longBio(30) }));

      const toggle = page.getByRole('button', { name: '続きを読む' });
      await expect.element(toggle).toBeVisible();
      const body = document.querySelector(
        '[data-slot="collapsible-markdown-body"]',
      ) as HTMLElement;
      expect(body.getBoundingClientRect().height).toBeLessThanOrEqual(
        HEIGHT_LIMIT_PX,
      );
      expect(body.style.maxHeight).toBe(`${HEIGHT_LIMIT_PX.toString()}px`);

      await userEvent.click(toggle);

      await expect
        .element(page.getByRole('button', { name: '折りたたむ' }))
        .toHaveAttribute('aria-expanded', 'true');
      expect(body.getBoundingClientRect().height).toBeGreaterThan(
        HEIGHT_LIMIT_PX,
      );
      await userEvent.click(page.getByRole('button', { name: '折りたたむ' }));
      await expect
        .element(page.getByRole('button', { name: '続きを読む' }))
        .toBeVisible();
    });

    test('240px以内に収まる自己紹介には「続きを読む」を出さない', async () => {
      await renderCard(publicProfileOf({ bio: longBio(1) }));

      await expect
        .element(page.getByText('段落1です。', { exact: false }))
        .toBeVisible();
      await expect
        .element(page.getByRole('button', { name: '続きを読む' }))
        .not.toBeInTheDocument();
    });
  });

  describe('外部Webサイト', () => {
    test('一覧に「外部Webサイト」の名前を付ける', async () => {
      await renderCard(
        publicProfileOf({
          websites: [{ name: '個人サイト', url: 'https://maker.example/' }],
        }),
      );

      await expect
        .element(page.getByRole('list', { name: '外部Webサイト' }))
        .toBeVisible();
    });
  });

  describe('フォロワー数', () => {
    test.each([
      [0, '0人'],
      [7, '7人'],
      [12_345, '12,345人'],
      [1_234_567, '1,234,567人'],
    ])(
      '%i人は「フォロワー」のラベルに続けて%sと表示する',
      async (count, text) => {
        await renderCard(publicProfileOf({ followerCount: count }));

        const region = page.getByText('フォロワー', { exact: true });
        await expect.element(region).toBeVisible();
        const container = region.element().parentElement as HTMLElement;
        expect(container.textContent.replace(/\s+/gu, '')).toBe(
          `フォロワー${text}`,
        );
      },
    );

    test('他の閲覧者にはリンクにしない', async () => {
      await renderCard(publicProfileOf({ followerCount: 3 }));

      await expect
        .element(page.getByRole('link', { name: /フォロワー/u }))
        .not.toBeInTheDocument();
    });

    test('本人にはフォロー一覧のフォロワーのタブへのリンクにし、説明をtitleで示す', async () => {
      await renderCard(
        publicProfileOf({ followerCount: 3, viewerRelation: 'OWNER' }),
        {},
        OWNER_VIEWER,
      );

      const link = page.getByRole('link', { name: /フォロワー/u });
      await expect
        .element(link)
        .toHaveAttribute('href', '/settings/follows?tab=followers');
      await expect
        .element(link)
        .toHaveAttribute('title', 'フォロワー一覧を設定ページで見る');
    });
  });

  describe('Ultras', () => {
    test('加入中ならアバターを輪で縁取り、読み上げ用の「Ultras加入中」を添える', async () => {
      await renderCard(publicProfileOf({ ultras: true }));

      const ring = documentElement('[data-slot="profile-avatar-ultras"]');
      expect(ring).not.toBeNull();
      const ringElement = ring as Element;
      expect(getComputedStyle(ringElement).boxShadow).not.toBe('none');
      expect(ringElement.textContent).toContain('Ultras加入中');
    });

    test('ポインターを重ねるとツールチップで加入中であることを示す', async () => {
      await renderCard(publicProfileOf({ ultras: true }));

      await userEvent.hover(
        page.elementLocator(
          documentElement('[data-slot="profile-avatar-ultras"]') as Element,
        ),
      );

      await expect
        .element(page.getByRole('tooltip'))
        .toHaveTextContent('UltrasプランでLaunch Stadiumを応援しています。');
    });

    test('キーボードでフォーカスできる', async () => {
      await renderCard(publicProfileOf({ ultras: true }));

      await userEvent.tab();

      expect(document.activeElement).toBe(
        documentElement('[data-slot="profile-avatar-ultras"]'),
      );
    });

    test('加入していなければ輪も読み上げ用の文言も出さない', async () => {
      await renderCard(publicProfileOf({ ultras: false }));

      await expect
        .element(page.getByRole('heading', { level: 1 }))
        .toBeVisible();
      expect(documentElement('[data-slot="profile-avatar-ultras"]')).toBeNull();
      expect(document.body.textContent).not.toContain('Ultras加入中');
    });
  });

  describe('本人', () => {
    const owner = (overrides: Partial<PublicProfileView> = {}) =>
      publicProfileOf({
        viewerRelation: 'OWNER',
        headline: 'ヘッドライン',
        ...overrides,
      });

    test('フォローボタンと「…」メニューの代わりに「プロフィールを編集」を設定のプロフィールへのリンクで置く', async () => {
      await renderCard(
        owner(),
        { menuItems: [menuItemOf('report', 10, '通報')] },
        OWNER_VIEWER,
      );

      await expect
        .element(page.getByRole('link', { name: 'プロフィールを編集' }))
        .toHaveAttribute('href', '/settings/profile');
      await expect
        .element(page.getByRole('button', { name: 'フォロー' }))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByRole('button', { name: 'その他の操作' }))
        .not.toBeInTheDocument();
    });

    test('停止中の本人には「プロフィールを編集」を置かない', async () => {
      await renderCard(owner({ suspended: true }), {}, OWNER_VIEWER);

      await expect
        .element(page.getByRole('heading', { level: 1 }))
        .toBeVisible();
      await expect
        .element(page.getByRole('link', { name: 'プロフィールを編集' }))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByRole('button', { name: 'フォロー' }))
        .not.toBeInTheDocument();
    });

    describe('未入力の案内', () => {
      test('画像・ヘッドライン・自己紹介・外部Webサイトがすべて未入力なら、挙げた項目と「プロフィールを設定」を示す', async () => {
        await renderCard(owner({ headline: null }), {}, OWNER_VIEWER);

        const section = page.getByRole('region', {
          name: 'プロフィールを充実させましょう',
        });
        await expect.element(section).toBeVisible();
        for (const field of [
          'プロフィール画像',
          'ヘッドライン',
          '自己紹介',
          '外部Webサイト',
        ]) {
          await expect
            .element(section.getByRole('listitem').getByText(field))
            .toBeVisible();
        }
        await expect
          .element(page.getByRole('link', { name: 'プロフィールを設定' }))
          .toHaveAttribute('href', '/settings/profile');
      });

      test.each<[string, Partial<PublicProfileView>]>([
        ['ヘッドライン', { headline: '一言' }],
        ['自己紹介', { bio: '本文' }],
        [
          '外部Webサイト',
          { websites: [{ name: null, url: 'https://a.example/' }] },
        ],
        [
          'プロフィール画像',
          {
            avatar: {
              id: 'file-1',
              objectKey: null,
              fallbackFormat: 'PNG' as const,
              width: null,
              height: null,
            },
          },
        ],
      ])('%sが入力済みなら出さない', async (_name, overrides) => {
        await renderCard(
          owner({ headline: null, ...overrides }),
          {},
          OWNER_VIEWER,
        );

        await expect
          .element(page.getByRole('link', { name: 'プロフィールを編集' }))
          .toBeVisible();
        await expect
          .element(
            page.getByRole('region', {
              name: 'プロフィールを充実させましょう',
            }),
          )
          .not.toBeInTheDocument();
      });

      test('停止中の本人には出さない', async () => {
        await renderCard(
          owner({ headline: null, suspended: true }),
          {},
          OWNER_VIEWER,
        );

        await expect
          .element(page.getByRole('heading', { level: 1 }))
          .toBeVisible();
        await expect
          .element(page.getByRole('link', { name: 'プロフィールを設定' }))
          .not.toBeInTheDocument();
      });

      test('他の閲覧者には出さない', async () => {
        await renderCard(publicProfileOf());

        await expect
          .element(page.getByRole('heading', { level: 1 }))
          .toBeVisible();
        await expect
          .element(page.getByRole('link', { name: 'プロフィールを設定' }))
          .not.toBeInTheDocument();
      });
    });
  });

  describe('フォロー', () => {
    test('ログイン中の他の利用者にはフォローボタンを置き、結果をonFollowChangeで伝える', async () => {
      executeGraphQL.mockResolvedValue({
        ok: true,
        data: {
          followUser: {
            handle: PROFILE_HANDLE,
            following: true,
            followerCount: 5,
          },
        },
      });
      const onFollowChange = vi.fn();
      await renderCard(publicProfileOf({ followerCount: 4 }), {
        onFollowChange,
      });

      await userEvent.click(
        page.getByRole('button', { name: '判定を成功させる' }),
      );
      await userEvent.click(page.getByRole('button', { name: 'フォロー' }));

      await expect
        .element(page.getByRole('button', { name: 'フォロー中' }))
        .toHaveAttribute('aria-pressed', 'true');
      expect(onFollowChange).toHaveBeenCalledExactlyOnceWith({
        following: true,
        followerCount: 5,
      });
    });

    test('フォロー中の関係なら「フォロー中」から始める', async () => {
      await renderCard(publicProfileOf({ viewerRelation: 'FOLLOWING' }));

      await expect
        .element(page.getByRole('button', { name: 'フォロー中' }))
        .toHaveAttribute('aria-pressed', 'true');
    });

    test('未ログインの閲覧者にもフォローボタンを置く', async () => {
      await renderCard(
        publicProfileOf({ viewerRelation: 'GUEST' }),
        {},
        GUEST_VIEWER_QUERY,
      );

      await expect
        .element(page.getByRole('button', { name: 'フォロー' }))
        .toBeEnabled();
    });

    test('ログイン中の利用者のハンドルと同じ表示でも、本人の関係でなければフォローボタンを描かない', async () => {
      await renderCard(
        publicProfileOf({ handle: VIEWER_HANDLE }),
        {},
        OTHER_VIEWER,
      );

      await expect
        .element(page.getByRole('button', { name: 'フォロー' }))
        .not.toBeInTheDocument();
    });
  });

  describe('登録された区画', () => {
    test('受賞バッジの区画を順序の小さい順に、表示中の利用者の文脈を渡して並べる', async () => {
      const seen: PublicProfileSectionContext[] = [];
      await renderCard(publicProfileOf({ followerCount: 1 }), {
        badges: [
          badgeOf('late', 20, '後の区画'),
          badgeOf('early', 10, '先の区画', seen),
        ],
      });

      const sections = page.getByTestId('badge-section');
      await expect.element(sections.first()).toHaveTextContent('先の区画');
      await expect.element(sections.nth(1)).toHaveTextContent('後の区画');
      expect(seen.at(-1)).toStrictEqual({
        handle: PROFILE_HANDLE,
        nickname: PROFILE_NICKNAME,
        isOwner: false,
        suspended: false,
      });
    });

    test('本人で停止中の文脈では、isOwnerとsuspendedを真で渡す', async () => {
      const seen: PublicProfileSectionContext[] = [];
      await renderCard(
        publicProfileOf({ viewerRelation: 'OWNER', suspended: true }),
        { badges: [badgeOf('only', 10, '区画', seen)] },
        OWNER_VIEWER,
      );

      await expect.element(page.getByTestId('badge-section')).toBeVisible();
      expect(seen.at(-1)).toMatchObject({ isOwner: true, suspended: true });
    });

    test('受賞バッジの区画はフォロワー数の下に置く', async () => {
      await renderCard(publicProfileOf(), {
        badges: [badgeOf('only', 10, '区画')],
      });

      const count = page.getByText('フォロワー', { exact: true }).element();
      const badge = page.getByTestId('badge-section').element();
      expect(
        count.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    test('「…」メニューは項目があれば「その他の操作」のボタンで開き、項目を順序の小さい順に並べる', async () => {
      await renderCard(publicProfileOf(), {
        menuItems: [
          menuItemOf('b', 20, '後の項目'),
          menuItemOf('a', 10, '先の項目'),
        ],
      });

      await userEvent.click(page.getByRole('button', { name: 'その他の操作' }));

      const items = page.getByRole('menuitem');
      await expect.element(items.first()).toHaveTextContent('先の項目');
      await expect.element(items.nth(1)).toHaveTextContent('後の項目');
    });
  });

  describe('登録箇所の既定', () => {
    test('受賞バッジの区画と「…」メニューの項目が登録されていなければ、受賞バッジの枠も「…」ボタンも出さない', async () => {
      await renderCard(publicProfileOf(), { badges: [] });

      await expect
        .element(page.getByRole('button', { name: 'フォロー' }))
        .toBeVisible();
      expect(documentElement('[data-slot="profile-badges"]')).toBeNull();
      await expect
        .element(page.getByRole('button', { name: 'その他の操作' }))
        .not.toBeInTheDocument();
    });

    test('登録された受賞バッジの区画が何も描かない間は、受賞バッジの枠を見せない', async () => {
      executeGraphQL.mockResolvedValue({
        ok: true,
        data: { profileAwards: [] },
      });

      await renderCard(publicProfileOf());

      await expect
        .element(page.getByRole('button', { name: 'フォロー' }))
        .toBeVisible();
      await vi.waitFor(() => {
        expect(executeGraphQL).toHaveBeenCalled();
      });
      const slot = documentElement('[data-slot="profile-badges"]');
      expect(slot?.childElementCount).toBe(0);
      expect(slot === null ? null : getComputedStyle(slot).display).toBe(
        'none',
      );
    });
  });

  describe('アクセシビリティ', () => {
    const FULL = publicProfileOf({
      headline: 'プロダクトを作っています',
      bio: '## 経歴\n\n[外部](https://outside.example/) のリンクを含む本文です。',
      websites: [
        { name: '個人サイト', url: 'https://maker.example/' },
        { name: null, url: 'https://blog.example/posts' },
      ],
      followerCount: 12_345,
      ultras: true,
    });

    test.each(COLOR_SCHEMES)(
      '全項目を入れた他人の表示で、%sの配色のaxeの違反が0件である',
      async (scheme) => {
        applyColorScheme(scheme);
        await renderCard(FULL, {
          badges: [badgeOf('only', 10, '区画')],
          menuItems: [menuItemOf('a', 10, '項目')],
        });

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );

    test.each(COLOR_SCHEMES)(
      '未入力の案内を含む本人の表示で、%sの配色のaxeの違反が0件である',
      async (scheme) => {
        applyColorScheme(scheme);
        await renderCard(
          publicProfileOf({ viewerRelation: 'OWNER' }),
          {},
          OWNER_VIEWER,
        );

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );

    test('メニューを開いた状態でもaxeの違反が0件である', async () => {
      await renderCard(FULL, { menuItems: [menuItemOf('a', 10, '項目')] });
      await userEvent.click(page.getByRole('button', { name: 'その他の操作' }));
      await expect.element(page.getByRole('menuitem')).toBeVisible();

      expect(await runAxe(page.getByRole('menu').element())).toStrictEqual([]);
    });
  });
});
