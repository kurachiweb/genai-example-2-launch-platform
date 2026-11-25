import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { hasHorizontalScroll } from '../../../lib/test/overflow.ts';
import {
  type ServedMediaImages,
  serveMediaImages,
} from '../../../lib/test/served-media-images.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { MODERATION_DISPLAY } from '../../../test/moderation-fixtures.ts';
import {
  ADMIN_AVATAR_IMAGE,
  AUTO_AND_ADMIN_LOGO_IMAGE,
  AUTO_AVATAR_IMAGE,
  HIDDEN_SCREENSHOT_IMAGE,
  imageList,
  imagesByReason,
  itemDetails,
  itemOf,
  loadMoreButton,
  main,
  mediaPageHarness,
  quarantinedImagesOf,
  reasonTab,
  reasonTabs,
  SYSTEM_BANNER_IMAGE,
  tabPanel,
} from '../../../test/moderation-media-fixtures.tsx';
import { loadAdminQuarantinedImagesPage } from '../../graphql/admin-quarantined-images.ts';
import { Route as MediaModerationRoute } from '../../routes/_authenticated/media-moderation/index.tsx';
import {
  quarantinedImageListArgsOf,
  toQuarantinedImageSearch,
} from '../moderation/shared/moderation-search.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const { renderWith, imagesVariables } = mediaPageHarness(executeGraphQL);

// 書き出した画像の置き場所は他のテストのファイルと分ける
const SERVED_KEY = 'fedcba9876543210'.repeat(2);

let served: ServedMediaImages | undefined;

beforeAll(async () => {
  served = await serveMediaImages(SERVED_KEY);
});

afterAll(async () => {
  await served?.remove();
});

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: '処理中に問題が発生しました。',
  status: 500,
});

const ownerOf = (text: string) => itemDetails(text)[1]?.[1];

test('経路の設定は画面のテストが写したものと同じ検索パラメータの検証・loaderの依存・読み込みの関数を使う', () => {
  const search = toQuarantinedImageSearch({ reason: 'admin_action' });

  expect(MediaModerationRoute.options.validateSearch).toBe(
    toQuarantinedImageSearch,
  );
  expect(MediaModerationRoute.options.loader).toBe(
    loadAdminQuarantinedImagesPage,
  );
  expect(
    (
      MediaModerationRoute.options.loaderDeps as (input: {
        search: unknown;
      }) => unknown
    )({ search }),
  ).toStrictEqual(quarantinedImageListArgsOf(search));
});

describe('隔離理由のタブ', () => {
  test('題名と説明の下に、自動判定・管理者操作・非公開化・ユーザー停止の順のタブを置き、URLに理由が無ければ自動判定を選んで一覧を求める', async () => {
    await renderWith();

    await expect.element(imageList()).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('画像モデレーション');
    await expect
      .element(
        main().getByText(
          '隔離された画像を、隔離理由ごとに隔離された日時の新しい順に表示します。',
        ),
      )
      .toBeVisible();
    expect(
      reasonTabs()
        .getByRole('tab')
        .elements()
        .map((tab) => tab.textContent),
    ).toStrictEqual(['自動判定', '管理者操作', '非公開化', 'ユーザー停止']);
    await expect
      .element(reasonTab('自動判定'))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(tabPanel()).toHaveAccessibleName('自動判定');
    expect(imagesVariables()).toStrictEqual([{ reason: 'AUTO' }]);
  });

  test('タブを選ぶとURLに理由を持ち、その理由の一覧を求め、自動判定に戻すとURLから理由を外す', async () => {
    const router = await renderWith();
    await expect.element(itemOf('サンプル太郎')).toBeVisible();

    await userEvent.click(reasonTab('管理者操作'));

    await expect.element(itemOf('運営サンプル')).toBeVisible();
    expect(router.state.location.search).toEqual({ reason: 'admin_action' });
    await expect
      .element(reasonTab('管理者操作'))
      .toHaveAttribute('aria-selected', 'true');
    expect(imagesVariables().at(-1)).toStrictEqual({ reason: 'ADMIN_ACTION' });
    expect(itemOf('サンプル太郎').query()).toBeNull();

    await userEvent.click(reasonTab('自動判定'));

    await expect.element(itemOf('サンプル太郎')).toBeVisible();
    expect(router.state.location.search).toEqual({});
  });

  test('キーボードの矢印キーでタブを移ると、移った先の理由の一覧を示す', async () => {
    const router = await renderWith();
    await expect.element(itemOf('サンプル太郎')).toBeVisible();
    reasonTab('自動判定').element().focus();

    await userEvent.keyboard('{ArrowRight}');

    await expect.element(reasonTab('管理者操作')).toHaveFocus();
    await expect.element(itemOf('運営サンプル')).toBeVisible();
    expect(router.state.location.search).toEqual({ reason: 'admin_action' });
  });

  test('ページをスクロールした状態でタブを切り替えても、スクロールを先頭へ戻さず、フォーカスを選んだタブに残す', async () => {
    await page.viewport(1280, 480);
    try {
      await renderWith({ role: 'MODERATOR' });
      await expect.element(itemOf('サンプル太郎')).toBeVisible();
      reasonTab('自動判定').element().focus({ preventScroll: true });
      window.scrollTo(0, 120);
      await expect.poll(() => window.scrollY).toBe(120);

      await userEvent.keyboard('{ArrowRight}');

      await expect.element(itemOf('運営サンプル')).toBeVisible();
      await expect.element(reasonTab('管理者操作')).toHaveFocus();
      expect(window.scrollY).toBe(120);

      // 一覧の長さが同じ理由へ戻し、文書が短くなってスクロールの位置が詰まる分と区別する
      await userEvent.click(reasonTab('自動判定'));

      await expect.element(itemOf('サンプル太郎')).toBeVisible();
      await expect.element(reasonTab('自動判定')).toHaveFocus();
      expect(window.scrollY).toBe(120);
    } finally {
      await page.viewport(1280, 900);
    }
  });

  test.each([
    ['product_hidden', '非公開化', 'PRODUCT_HIDDEN'],
    ['user_suspended', 'ユーザー停止', 'USER_SUSPENDED'],
  ])('URLの理由(%s)のタブを選んで開く', async (reason, tabName, variable) => {
    await renderWith({ path: `/media-moderation?reason=${reason}` });

    await expect
      .element(reasonTab(tabName))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(imageList()).toBeVisible();
    expect(imagesVariables()).toStrictEqual([{ reason: variable }]);
  });

  test('不正な理由のURLは自動判定を選ぶ', async () => {
    await renderWith({ path: '/media-moderation?reason=unknown' });

    await expect
      .element(reasonTab('自動判定'))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(itemOf('サンプル太郎')).toBeVisible();
    expect(imagesVariables()).toStrictEqual([{ reason: 'AUTO' }]);
  });

  test('タブを切り替えて取り直す間は、前の一覧を操作できないまま表示し続ける', async () => {
    let release: (() => void) | undefined;
    await renderWith({
      images: (variables) =>
        variables.reason === 'AUTO'
          ? imagesByReason(variables)
          : new Promise((resolve) => {
              release = () => {
                resolve(imagesByReason(variables));
              };
            }),
    });
    await expect.element(itemOf('サンプル太郎')).toBeVisible();

    await userEvent.click(reasonTab('管理者操作'));

    await expect
      .element(reasonTab('管理者操作'))
      .toHaveAttribute('aria-selected', 'true');
    await expect.element(itemOf('サンプル太郎')).toBeVisible();
    await expect
      .poll(() =>
        imageList().element().parentElement?.getAttribute('aria-busy'),
      )
      .toBe('true');
    expect(imageList().element().parentElement?.inert).toBe(true);
    release?.();

    await expect.element(itemOf('運営サンプル')).toBeVisible();
    expect(itemOf('サンプル太郎').query()).toBeNull();
  });
});

describe('隔離画像の一覧', () => {
  test('各項目に用途・保有者・隔離された日時・全ての隔離理由・検出内容をAPIの順に示す', async () => {
    await renderWith();
    await expect.element(imageList()).toBeVisible();

    expect(
      imageList()
        .getByRole('listitem')
        .elements()
        .filter((item) => item.parentElement === imageList().element()),
    ).toHaveLength(2);
    expect(itemDetails('サンプル太郎')).toStrictEqual([
      ['用途', 'プロフィール画像'],
      ['保有者', 'サンプル太郎(@maker_ai)'],
      ['隔離された日時', '2026年11月19日(木) 10:00'],
      ['隔離理由', '自動判定'],
      [
        '検出内容',
        '暴力: 武器(信頼度91%)画像を読み込めないため判定できませんでした',
      ],
    ]);
    expect(
      itemOf('サンプル太郎')
        .getByRole('list')
        .getByRole('listitem')
        .elements()
        .map((item) => item.textContent),
    ).toStrictEqual(AUTO_AVATAR_IMAGE.findings);
    await expect
      .element(itemOf('サンプル太郎').getByText('2026年11月19日(木) 10:00'))
      .toHaveAttribute('datetime', AUTO_AVATAR_IMAGE.quarantinedAt);
    expect(itemDetails('サンプル花子')).toStrictEqual([
      ['用途', 'ロゴ'],
      ['保有者', 'サンプル花子(@pixel_hanako)'],
      ['隔離された日時', '2026年11月18日(水) 12:30'],
      ['隔離理由', '管理者操作、自動判定'],
      ['検出内容', AUTO_AND_ADMIN_LOGO_IMAGE.findings[0]],
    ]);
  });

  test('管理者の画像は管理者の印、表示名を引けない保有者は表示できない利用者、保有者を持たない画像はシステム、検出内容が無ければ「なし」、表示名の無い用途は用途の名前を示す', async () => {
    const router = await renderWith({
      path: '/media-moderation?reason=admin_action',
    });
    await expect.element(itemOf('運営サンプル')).toBeVisible();

    expect(itemDetails('運営サンプル')).toStrictEqual([
      ['用途', '管理者のプロフィール画像'],
      ['保有者', '運営サンプル(管理者)'],
      ['隔離された日時', '2026年11月17日(火) 09:00'],
      ['隔離理由', '管理者操作'],
      ['検出内容', 'なし'],
    ]);

    await router.navigate({
      to: '/media-moderation',
      search: { reason: 'user_suspended' },
    });

    await expect.element(itemOf('sponsor-banner')).toBeVisible();
    expect(ownerOf('スクリーンショット')).toBe('表示できない利用者');
    expect(itemDetails('スクリーンショット')[3]).toStrictEqual([
      '隔離理由',
      '非公開化、ユーザー停止',
    ]);
    expect(itemDetails('sponsor-banner').slice(0, 2)).toStrictEqual([
      ['用途', 'sponsor-banner'],
      ['保有者', 'システム'],
    ]);
    expect(HIDDEN_SCREENSHOT_IMAGE.owner?.nickname).toBeNull();
    expect(SYSTEM_BANNER_IMAGE.owner).toBeNull();
  });

  test('画像は画像配信ドメインを使わず同一オリジンの中継から表示し、読み込めた画像はそのまま、読み込めない画像は代わりの表示を出して一覧と他の操作を続けられる', async () => {
    const loadablePath = `/.vitest-attachments/served-media-images/${SERVED_KEY}/square-sm.png`;
    await renderWith({
      role: 'MODERATOR',
      images: () =>
        success(
          quarantinedImagesOf([
            {
              ...AUTO_AVATAR_IMAGE,
              file: { ...AUTO_AVATAR_IMAGE.file, path: loadablePath },
            },
            AUTO_AND_ADMIN_LOGO_IMAGE,
          ]),
        ),
    });
    await expect.element(imageList()).toBeVisible();

    const loaded = itemOf('サンプル太郎').element().querySelector('img');
    expect(loaded?.getAttribute('src')).toBe(loadablePath);
    await expect
      .poll(() => loaded?.complete === true && loaded.naturalWidth > 0)
      .toBe(true);
    await expect
      .element(itemOf('サンプル花子').getByText('画像を表示できません'))
      .toBeVisible();
    expect(itemOf('サンプル花子').element().querySelector('img')).toBeNull();
    await expect
      .element(
        itemOf('サンプル花子').getByRole('button', {
          name: 'サンプル花子(@pixel_hanako)のロゴの公開承認',
        }),
      )
      .toBeEnabled();
    expect(
      [...imageList().element().querySelectorAll('img')].every(
        (image) => !image.src.startsWith('https://images.example'),
      ),
    ).toBe(true);
  });

  test('この隔離理由の画像が無ければ一覧の位置にその旨を示す', async () => {
    await renderWith({ images: () => success(quarantinedImagesOf([])) });

    await expect
      .element(tabPanel().getByText('この隔離理由の画像はありません。'))
      .toBeVisible();
    expect(imageList().query()).toBeNull();
  });

  test('取得の失敗は一覧の位置に文言と再試行の操作で示し、問い合わせの導線を出さず、再試行でタブの区画へフォーカスを移して一覧を表示する', async () => {
    let available = false;
    await renderWith({
      images: (variables) =>
        available ? imagesByReason(variables) : failure(INTERNAL_ERROR),
    });

    await expect
      .element(tabPanel().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
    expect(
      main()
        .getByRole('link', { name: /問い合わせ/u })
        .query(),
    ).toBeNull();
    available = true;
    await userEvent.click(tabPanel().getByRole('button', { name: '再試行' }));

    await expect.element(itemOf('サンプル太郎')).toBeVisible();
    await expect.element(tabPanel()).toHaveFocus();
  });

  test('再試行がもう一度失敗した時は、新しい再試行のボタンへフォーカスを移す', async () => {
    await renderWith({ images: () => failure(INTERNAL_ERROR) });
    await expect.element(tabPanel().getByRole('alert')).toBeVisible();

    await userEvent.click(tabPanel().getByRole('button', { name: '再試行' }));

    await expect
      .element(tabPanel().getByRole('button', { name: '再試行' }))
      .toHaveFocus();
    await expect
      .element(tabPanel().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
  });
});

describe('続きの読み込み', () => {
  const pagedImages = ({
    failNext = false,
  }: { readonly failNext?: boolean } = {}) => {
    const state = { failNext };
    return {
      state,
      images: ({ after }: { readonly after?: string | null }) => {
        if (after === undefined || after === null) {
          return success(quarantinedImagesOf([AUTO_AVATAR_IMAGE], 'cursor-2'));
        }
        return state.failNext
          ? failure(INTERNAL_ERROR)
          : success(quarantinedImagesOf([AUTO_AND_ADMIN_LOGO_IMAGE]));
      },
    };
  };

  test('「さらに読み込む」で続きのカーソルから読み、後ろに加えた最初の項目へフォーカスを移し、最後のページでボタンを消す', async () => {
    const { images } = pagedImages();
    await renderWith({ images });
    await expect.element(itemOf('サンプル太郎')).toBeVisible();

    await userEvent.click(loadMoreButton());

    await expect.element(itemOf('サンプル花子')).toBeVisible();
    expect(imagesVariables()).toStrictEqual([
      { reason: 'AUTO' },
      { reason: 'AUTO', after: 'cursor-2' },
    ]);
    await expect.element(itemOf('サンプル花子')).toHaveFocus();
    expect(loadMoreButton().query()).toBeNull();
  });

  test('読み込む間はボタンを押せないことを文言と状態で示し、フォーカスを保つ', async () => {
    let release: (() => void) | undefined;
    await renderWith({
      images: ({ after }) =>
        after === undefined || after === null
          ? success(quarantinedImagesOf([AUTO_AVATAR_IMAGE], 'cursor-2'))
          : new Promise((resolve) => {
              release = () => {
                resolve(
                  success(quarantinedImagesOf([AUTO_AND_ADMIN_LOGO_IMAGE])),
                );
              };
            }),
    });
    await userEvent.click(loadMoreButton());

    const pending = main().getByRole('button', { name: '読み込み中' });
    await expect.element(pending).toHaveAttribute('aria-disabled', 'true');
    await expect.element(pending).toHaveAttribute('aria-busy', 'true');
    expect(pending.element()).toHaveProperty('disabled', false);
    await expect.element(pending).toHaveFocus();
    release?.();

    await expect.element(itemOf('サンプル花子')).toHaveFocus();
  });

  test('続きの読み込みの失敗は、読み込んだ項目とボタンを残してボタンの近くに示し、同じボタンで読み込み直せる', async () => {
    const { images, state } = pagedImages({ failNext: true });
    await renderWith({ images });
    await expect.element(itemOf('サンプル太郎')).toBeVisible();

    await userEvent.click(loadMoreButton());

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent('処理中に問題が発生しました。');
    await expect.element(itemOf('サンプル太郎')).toBeVisible();
    await expect.element(loadMoreButton()).toHaveFocus();
    state.failNext = false;

    await userEvent.click(loadMoreButton());

    await expect.element(itemOf('サンプル花子')).toHaveFocus();
    expect(main().getByRole('alert').query()).toBeNull();
  });
});

describe('アクセシビリティと表示の幅', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、タブ・一覧・操作・代わりの表示の画像がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderWith({
        role: 'MODERATOR',
        images: () =>
          success(
            quarantinedImagesOf(
              [
                AUTO_AVATAR_IMAGE,
                AUTO_AND_ADMIN_LOGO_IMAGE,
                ADMIN_AVATAR_IMAGE,
              ],
              'cursor-2',
            ),
          ),
      });
      await expect.element(loadMoreButton()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test('狭い画面でも、タブと一覧が横にはみ出さない', async () => {
    await page.viewport(360, 800);
    try {
      await renderWith({ role: 'SUPER_ADMIN' });
      await expect.element(imageList()).toBeVisible();

      expect(hasHorizontalScroll()).toBe(false);
    } finally {
      await page.viewport(1280, 900);
    }
  });
});
