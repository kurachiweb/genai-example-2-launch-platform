import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { failure } from '../../../test/admin-accounts-fixtures.ts';
import {
  changedResult,
  MODERATION_DISPLAY,
  MODERATION_ROLES,
  PRODUCT_ID,
  variablesOf,
} from '../../../test/moderation-fixtures.ts';
import {
  HIDDEN_PRODUCT_DETAIL,
  HIDE_REASON,
  type ProductDetailHandler,
  productDetailOf,
  renderProductDetailPage,
  respondProductDetailGraphQL,
  SCREENSHOT_FILE_IDS,
} from '../../../test/moderation-product-detail-fixtures.ts';
import type {
  AdminProductDetailContext,
  AdminProductDetailSection,
} from '../../composition/admin-product-detail-sections.ts';
import {
  AdminHideProductDocument,
  AdminProductDocument,
  type AdminProductQuery,
  AdminQuarantineImageDocument,
  type AdminRole,
  AdminUnhideProductDocument,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL, registeredSections } = vi.hoisted(() => ({
  executeGraphQL: vi.fn(),
  registeredSections: [] as AdminProductDetailSection[],
}));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

// 後続specが区画を登録した状態を再現するため、登録箇所をテストが差し替えられる値にする
vi.mock('../../composition/admin-product-detail-sections.ts', () => ({
  ADMIN_PRODUCT_DETAIL_SECTIONS: registeredSections,
}));

type ProductDetail = NonNullable<AdminProductQuery['adminProduct']>;

const main = () => page.getByRole('main');
const sectionOf = (name: string) =>
  main().getByRole('region', { name, exact: true });
const termValue = (scope: Element, term: string): string | undefined =>
  [...scope.querySelectorAll('dt')].find(
    (element) => element.textContent === term,
  )?.nextElementSibling?.textContent ?? undefined;
const buttonOf = (name: string) =>
  main().getByRole('button', { name, exact: true });
const dialog = () => page.getByRole('dialog');
const reasonBox = () =>
  dialog().getByRole('textbox', { name: '理由(必須)', exact: true });

const renderDetail = async ({
  role = 'MODERATOR',
  detail,
  handlers,
  path,
}: {
  readonly role?: AdminRole;
  readonly detail?: ProductDetail | null;
  readonly handlers?: ReadonlyMap<unknown, ProductDetailHandler>;
  readonly path?: string;
} = {}) => {
  respondProductDetailGraphQL(executeGraphQL, {
    role,
    ...(detail === undefined ? {} : { detail }),
    ...(handlers === undefined ? {} : { handlers }),
  });
  const router = await renderProductDetailPage(role, path);
  await expect.element(main().getByRole('heading', { level: 1 })).toBeVisible();
  return router;
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  registeredSections.length = 0;
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('プロダクトの情報', () => {
  test('題名を名称とし、一覧への導線と、タグライン・カテゴリ・ハンドル・外部Webサイト・投稿者・説明文を示す', async () => {
    await renderDetail();

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('Pitch Notes');
    await expect
      .element(main().getByRole('link', { name: 'プロダクトの一覧へ' }))
      .toHaveAttribute('href', '/products');
    const information = sectionOf('プロダクトの情報').element();
    expect(termValue(information, 'タグライン')).toBe(
      '試合の記録を共有するノートアプリ',
    );
    expect(termValue(information, 'カテゴリ')).toBe('開発ツール');
    expect(termValue(information, 'ハンドル')).toBe('pitch-notes');
    expect(termValue(information, '投稿者')).toBe('サンプル太郎(@maker_ai)');
    expect(
      [...main().element().querySelectorAll('section > h2')].map(
        (heading) => heading.textContent,
      ),
    ).toStrictEqual([
      '公開状態',
      'プロダクトの情報',
      '画像',
      '評価',
      'ローンチ履歴',
    ]);
  });

  test('外部WebサイトURLはnoopener noreferrerで別タブに開く', async () => {
    await renderDetail();

    const link = sectionOf('プロダクトの情報').getByRole('link', {
      name: /pitch-notes\.example/u,
    });
    await expect
      .element(link)
      .toHaveAttribute('href', 'https://pitch-notes.example');
    await expect.element(link).toHaveAttribute('target', '_blank');
    await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect.element(link).toHaveTextContent('(新しいタブで開きます)');
  });

  test('説明文をマークダウンとして描き、本文の中の外部リンクに利用者側と同じrelを付ける', async () => {
    await renderDetail();

    const information = sectionOf('プロダクトの情報');
    await expect
      .element(information.getByRole('heading', { level: 2, name: '特徴' }))
      .toBeVisible();
    expect(information.element().querySelector('strong')?.textContent).toBe(
      '記録',
    );
    await expect
      .element(information.getByRole('link', { name: '公式サイト' }))
      .toHaveAttribute('rel', 'noopener');
  });

  test('投稿者を読めないプロダクトは、投稿者を表示できない利用者と示す', async () => {
    await renderDetail({ detail: productDetailOf({}, { owner: null }) });

    expect(termValue(sectionOf('プロダクトの情報').element(), '投稿者')).toBe(
      '表示できない利用者',
    );
  });

  test('危険なスキームの外部WebサイトURLはリンクにしない', async () => {
    await renderDetail({
      detail: productDetailOf({ websiteUrl: 'javascript:alert(1)' }),
    });

    const information = sectionOf('プロダクトの情報').element();
    expect(termValue(information, '外部Webサイト')).toBe('javascript:alert(1)');
    expect(information.querySelector('a[href^="javascript"]')).toBeNull();
  });
});

describe('公開状態', () => {
  test('公開中のプロダクトは公開中と示し、非公開化の日時と理由を示さない', async () => {
    await renderDetail();

    const visibility = sectionOf('公開状態');
    await expect.element(visibility).toHaveTextContent('公開中');
    expect(visibility.element().textContent).not.toContain('非公開化した日時');
  });

  test('非公開化中のプロダクトは、非公開化した日時と最新の理由を示す', async () => {
    await renderDetail({ detail: HIDDEN_PRODUCT_DETAIL });

    const visibility = sectionOf('公開状態');
    await expect.element(visibility).toHaveTextContent('非公開化中');
    const element = visibility.element();
    const time = [...element.querySelectorAll('dt')]
      .find((term) => term.textContent === '非公開化した日時')
      ?.nextElementSibling?.querySelector('time');
    expect(time?.dateTime).toBe('2026-11-12T03:00:00.000Z');
    expect(time?.textContent).toBe('2026年11月12日(木) 12:00');
    expect(termValue(element, '理由')).toBe(HIDE_REASON);
  });

  test('非公開化の記録が無い非公開化中のプロダクトは、理由を記録なしと示す', async () => {
    await renderDetail({
      detail: { ...HIDDEN_PRODUCT_DETAIL, hiddenAt: null, latestHide: null },
    });

    expect(termValue(sectionOf('公開状態').element(), '理由')).toBe('記録なし');
  });

  test('投稿者が停止中のプロダクトは投稿者が停止中と示し、プロダクト自体の非公開化を行える', async () => {
    await renderDetail({
      detail: productDetailOf({}, { visibility: 'OWNER_SUSPENDED' }),
    });

    await expect
      .element(sectionOf('公開状態'))
      .toHaveTextContent('投稿者が停止中');
    await expect.element(buttonOf('非公開化')).toBeVisible();
  });

  test.each(MODERATION_ROLES)(
    '%sには公開中に非公開化、非公開化中に復元を示す',
    async (role) => {
      await renderDetail({ role });
      await expect.element(buttonOf('非公開化')).toBeVisible();
      expect(
        main().getByRole('button', { name: '復元' }).elements(),
      ).toHaveLength(0);
    },
  );

  test('閲覧のみの管理者には非公開化・復元・画像の隔離・評価の操作を示さない', async () => {
    await renderDetail({ role: 'VIEWER' });
    await expect.element(sectionOf('評価')).toHaveTextContent('サンプル花子');

    for (const name of [
      '非公開化',
      '復元',
      'ロゴを隔離',
      'サンプル花子さんの評価を無効化',
    ]) {
      expect(main().getByRole('button', { name }).elements()).toHaveLength(0);
    }
    expect(
      sectionOf('評価').getByRole('columnheader', { name: '操作' }).elements(),
    ).toHaveLength(0);
  });

  test('非公開化の確認に、未開始のマッチ予定が取り消され復元でも戻らないことと通知を送ることを示し、理由を必須として確定する', async () => {
    await renderDetail({
      handlers: new Map<unknown, ProductDetailHandler>([
        [AdminHideProductDocument, () => changedResult('hideProduct', true)],
      ]),
    });
    const callsBefore = variablesOf(
      executeGraphQL,
      AdminProductDocument,
    ).length;

    await buttonOf('非公開化').click();

    await expect
      .element(dialog().getByRole('heading'))
      .toHaveTextContent('プロダクト『Pitch Notes』を非公開にしますか?');
    await expect
      .element(dialog())
      .toHaveTextContent(
        '未開始のマッチ予定は取り消され、復元しても戻りません。投稿者へ通知を送ります。',
      );
    const confirm = dialog().getByRole('button', { name: '非公開にする' });
    await expect.element(confirm).toBeDisabled();
    await reasonBox().fill(HIDE_REASON);
    await confirm.click();

    await expect
      .element(page.getByText('プロダクトを非公開にしました。'))
      .toBeVisible();
    expect(variablesOf(executeGraphQL, AdminHideProductDocument)).toStrictEqual(
      [{ id: PRODUCT_ID, reason: HIDE_REASON }],
    );
    await expect
      .poll(() => variablesOf(executeGraphQL, AdminProductDocument).length)
      .toBeGreaterThan(callsBefore);
  });

  test('復元の確認に、取り消したマッチ予定と他の理由で隔離された画像が戻らないことと通知を送らないことを示し、理由を必須とする', async () => {
    await renderDetail({
      detail: HIDDEN_PRODUCT_DETAIL,
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminUnhideProductDocument,
          () => changedResult('unhideProduct', false),
        ],
      ]),
    });

    await buttonOf('復元').click();

    await expect
      .element(dialog().getByRole('heading'))
      .toHaveTextContent('プロダクト『Pitch Notes』を復元しますか?');
    await expect
      .element(dialog())
      .toHaveTextContent(
        'プロダクトの表示を再開します。非公開化の時に取り消したマッチ予定は戻らず、他の理由で隔離された画像は公開に戻りません。投稿者へ通知は送りません。',
      );
    const confirm = dialog().getByRole('button', { name: '復元する' });
    await expect.element(confirm).toBeDisabled();
    await reasonBox().fill('誤った非公開化のため');
    await confirm.click();

    await expect.element(page.getByText('既に公開中です。')).toBeVisible();
    expect(
      variablesOf(executeGraphQL, AdminUnhideProductDocument),
    ).toStrictEqual([{ id: PRODUCT_ID, reason: '誤った非公開化のため' }]);
  });
});

describe('画像', () => {
  test('公開中のロゴとスクリーンショットを画像配信ドメインの変換配信から、隔離理由のある画像を同一オリジンの中継の経路から表示し、隔離中の印と隔離理由を添える', async () => {
    await renderDetail();

    const images = sectionOf('画像');
    await expect
      .element(images.getByRole('img', { name: 'Pitch Notesのロゴ' }))
      .toBeVisible();
    const sources = [...images.element().querySelectorAll('img')].map((image) =>
      image.getAttribute('src'),
    );
    expect(sources).toStrictEqual([
      expect.stringMatching(/^https:\/\/images\.example\//u),
      expect.stringMatching(/^https:\/\/images\.example\//u),
      `/_bff/files/${SCREENSHOT_FILE_IDS[1] ?? ''}`,
    ]);
    const items = [...images.element().querySelectorAll('li')];
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).not.toContain('隔離中');
    expect(items[1]?.textContent).toContain('隔離中');
    expect(
      items[1] === undefined ? undefined : termValue(items[1], '隔離理由'),
    ).toBe('管理者操作');
  });

  test('非公開化中のプロダクトの画像は、隔離画像として同一オリジンの中継から表示する', async () => {
    await renderDetail({ detail: HIDDEN_PRODUCT_DETAIL });

    const images = sectionOf('画像').element();
    expect(
      [...images.querySelectorAll('img, [role="img"]')].length,
    ).toBeGreaterThanOrEqual(3);
    expect(images.textContent).toContain('非公開化、管理者操作');
    const sources = [...images.querySelectorAll('img')].map((image) =>
      image.getAttribute('src'),
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source?.startsWith('/_bff/files/'))).toBe(
      true,
    );
  });

  test('隔離理由の無い画像ごとに、対象を名前に含む隔離の操作を置き、確定で画像のIDを送る', async () => {
    const quarantined: unknown[] = [];
    await renderDetail({
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminQuarantineImageDocument,
          (variables) => {
            quarantined.push(variables);
            return changedResult('quarantineImage', true);
          },
        ],
      ]),
    });

    await expect.element(buttonOf('ロゴを隔離')).toBeVisible();
    await expect.element(buttonOf('スクリーンショット1を隔離')).toBeVisible();
    expect(
      main()
        .getByRole('button', { name: 'スクリーンショット2を隔離' })
        .elements(),
    ).toHaveLength(0);

    await buttonOf('スクリーンショット1を隔離').click();
    await dialog().getByRole('button', { name: '隔離する' }).click();

    await expect.element(page.getByText('画像を隔離しました。')).toBeVisible();
    expect(quarantined).toStrictEqual([
      { fileId: SCREENSHOT_FILE_IDS[0], reason: '' },
    ]);
  });

  test('非公開化中のプロダクトの画像は全て隔離理由を持つため、隔離の操作を置かない', async () => {
    await renderDetail({ detail: HIDDEN_PRODUCT_DETAIL });

    expect(sectionOf('画像').getByRole('button').elements()).toHaveLength(0);
  });
});

describe('見つからないプロダクト', () => {
  test('存在しない・論理削除されたプロダクトは、見つからない旨と一覧への導線を示し、最初の表示ではフォーカスを移さない', async () => {
    respondProductDetailGraphQL(executeGraphQL, {
      role: 'VIEWER',
      detail: null,
    });
    await renderProductDetailPage('VIEWER');

    await expect
      .element(main().getByText('プロダクトが見つかりません。'))
      .toBeVisible();
    await expect
      .element(main().getByRole('link', { name: 'プロダクトの一覧へ' }))
      .toHaveAttribute('href', '/products');
    expect(document.activeElement).toBe(document.body);
  });

  test('IDの形式の違反は、不在と同じ見つからない表示にする', async () => {
    respondProductDetailGraphQL(executeGraphQL, {
      role: 'VIEWER',
      handlers: new Map<unknown, ProductDetailHandler>([
        [
          AdminProductDocument,
          () =>
            failure({
              code: 'validation_error',
              message: '入力内容に誤りがあります。',
              status: 400,
              details: [
                {
                  field: 'id',
                  code: 'invalid_string',
                  message: 'プロダクトが見つかりません。',
                },
              ],
            }),
        ],
      ]),
    });
    await renderProductDetailPage('VIEWER', '/products/not-a-ulid');

    await expect
      .element(main().getByText('プロダクトが見つかりません。'))
      .toBeVisible();
  });
});

describe('後続の機能が登録する区画', () => {
  const contexts: AdminProductDetailContext[] = [];

  function RecordingSection({
    product,
  }: {
    readonly product: AdminProductDetailContext;
  }) {
    contexts.push(product);
    return (
      <section aria-label="記録する区画">
        <h2>記録する区画</h2>
        {product.productId}
      </section>
    );
  }

  function SecondSection() {
    return (
      <section aria-label="2番目の区画">
        <h2>2番目の区画</h2>
      </section>
    );
  }

  function ThrowingSection(): never {
    throw new Error('区画の取得の失敗');
  }

  beforeEach(() => {
    contexts.length = 0;
  });

  test('登録が無ければ、ローンチ履歴の後に何も描かない', async () => {
    await renderDetail();

    const launches = sectionOf('ローンチ履歴').element();
    expect(launches.nextElementSibling).toBeNull();
    expect(launches.parentElement?.nextElementSibling).toBeNull();
  });

  test('登録した区画を順序どおりに並べて文脈を渡し、1つの区画の失敗はその位置に題名と再試行とともに示して他の表示を止めない', async () => {
    registeredSections.push(
      {
        id: 'z.second',
        order: 30,
        title: '2番目の区画',
        component: SecondSection,
      },
      {
        id: 'a.throwing',
        order: 20,
        title: '受け付けた通報',
        component: ThrowingSection,
      },
      {
        id: 'm.recording',
        order: 10,
        title: '記録する区画',
        component: RecordingSection,
      },
    );
    await renderDetail();

    await expect.element(main().getByText('2番目の区画')).toBeVisible();
    const headings = [...main().element().querySelectorAll('h2')].map(
      (heading) => heading.textContent,
    );
    expect(headings.slice(-3)).toStrictEqual([
      '記録する区画',
      '受け付けた通報',
      '2番目の区画',
    ]);
    expect(contexts.at(-1)).toStrictEqual({
      productId: PRODUCT_ID,
      ownerUserId: '01KA0VSER00000000000000001',
    });
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(
        'ページを表示できませんでした。時間をおいて再度お試しください。',
      );
    expect(main().element().textContent).not.toContain('お問い合わせ');
    await expect
      .element(main().getByRole('button', { name: '再試行' }))
      .toBeVisible();
    await expect.element(sectionOf('プロダクトの情報')).toBeVisible();
  });

  test('退会済みの投稿者のプロダクトは、文脈の投稿者をnullで渡す', async () => {
    registeredSections.push({
      id: 'm.recording',
      order: 10,
      title: '記録する区画',
      component: RecordingSection,
    });
    await renderDetail({ detail: productDetailOf({}, { owner: null }) });

    await expect.element(main().getByText('記録する区画')).toBeVisible();
    expect(contexts.at(-1)).toStrictEqual({
      productId: PRODUCT_ID,
      ownerUserId: null,
    });
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、モデレーターの見る非公開化中のプロダクトの詳細がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDetail({ detail: HIDDEN_PRODUCT_DETAIL });
      await expect.element(sectionOf('評価')).toHaveTextContent('サンプル花子');

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、見つからないプロダクトの表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      respondProductDetailGraphQL(executeGraphQL, {
        role: 'VIEWER',
        detail: null,
      });
      await renderProductDetailPage('VIEWER');
      await expect
        .element(main().getByText('プロダクトが見つかりません。'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
