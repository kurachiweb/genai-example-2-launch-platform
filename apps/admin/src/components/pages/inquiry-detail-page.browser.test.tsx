import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  GUEST_INQUIRY_ID,
  INQUIRIES_PATH,
  inquiryCallsOf,
  type InquiryHandler,
  MEMBER_INQUIRY_ID,
  memberDetailOf,
  renderAdminInquiriesPage,
  respondAdminInquiriesGraphQL,
  userMessage,
} from '../../../test/admin-inquiries-fixtures.ts';
import type {
  InquiryDetailAction,
  InquiryDetailActionContext,
} from '../../composition/inquiry-detail-actions.ts';
import type { AdminInquiryQuery } from '../../graphql/generated/graphql.ts';

const { executeGraphQL, registeredActions } = vi.hoisted(() => ({
  executeGraphQL: vi.fn(),
  registeredActions: [] as InquiryDetailAction[],
}));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

// 後続specが操作を登録した状態を再現するため、登録箇所をテストが差し替えられる値にする
vi.mock('../../composition/inquiry-detail-actions.ts', () => ({
  INQUIRY_DETAIL_ACTIONS: registeredActions,
}));

const LIVE_REFRESH_MS = 30_000;

const main = () => page.getByRole('main');
const summary = () => main().getByRole('definition');
const summaryOf = (term: string) =>
  main().getByRole('term').filter({ hasText: term }).element()
    .nextElementSibling;
const messageLog = () => main().getByRole('log', { name: 'メッセージ' });
const messages = () => messageLog().getByRole('article');
const autoRefreshSwitch = () =>
  main().getByRole('switch', { name: '自動更新' });

const renderDetail = async (id: string, inquiry?: InquiryHandler) => {
  respondAdminInquiriesGraphQL(executeGraphQL, {
    role: 'VIEWER',
    ...(inquiry === undefined ? {} : { inquiry }),
  });
  const router = await renderAdminInquiriesPage(
    'VIEWER',
    `${INQUIRIES_PATH}/${id}`,
  );
  await expect.element(main().getByRole('heading', { level: 1 })).toBeVisible();
  return router;
};

const detailResult = (
  adminInquiry: AdminInquiryQuery['adminInquiry'],
): Promise<unknown> => success({ adminInquiry });

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
  registeredActions.length = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('ログインの問い合わせの詳細', () => {
  test('利用者のニックネームとハンドル・カテゴリ・対応ステータス・受付日時と、全メッセージ(添付を含む)を送信日時の古い順に表示する', async () => {
    await renderDetail(MEMBER_INQUIRY_ID);

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('問い合わせの詳細');
    expect(summaryOf('種別')?.textContent).toBe('ログイン');
    expect(summaryOf('送信者')?.textContent).toBe('サンプル太郎@sample_taro');
    expect(summaryOf('カテゴリ')?.textContent).toBe('不具合の報告');
    expect(summaryOf('対応ステータス')?.textContent).toBe('対応中');
    const receivedAt = summaryOf('受付日時')?.querySelector('time');
    expect(receivedAt?.dateTime).toBe('2026-11-04T01:00:00.000Z');
    expect(receivedAt?.textContent).toBe('2026年11月4日(水) 10:00');
    expect(
      main().getByText('退会済み', { exact: true }).elements(),
    ).toHaveLength(0);
    const texts = messages()
      .elements()
      .map((element) => element.textContent);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain('サンプル太郎');
    expect(texts[0]).toContain('画面が表示されません。');
    expect(texts[1]).toContain('運営の担当');
    expect(texts[1]).toContain('確認します。');
    expect(texts[2]).toContain('削除済みの管理者');
    expect(texts[2]).toContain('修正しました。');
    await expect
      .element(
        messages()
          .nth(0)
          .getByRole('link', { name: /screen\.png/u }),
      )
      .toBeVisible();
    expect(messages().nth(0).element().querySelector('p')?.textContent).toBe(
      '画面が表示されません。\n再読み込みしても直りません。',
    );
    expect(
      messages()
        .elements()
        .map((element) => element.getAttribute('data-side')),
    ).toStrictEqual(['other', 'self', 'self']);
    expect(
      messages()
        .elements()
        .map((element) => element.querySelector('time')?.textContent),
    ).toStrictEqual([
      '2026年11月4日(水) 10:00',
      '2026年11月4日(水) 12:00',
      '2026年11月4日(水) 14:30',
    ]);
  });

  test('退会済みの問い合わせは「退会済み」と表示する', async () => {
    await renderDetail(MEMBER_INQUIRY_ID, () =>
      detailResult(memberDetailOf({ withdrawn: true })),
    );

    await expect
      .element(main().getByText('退会済み', { exact: true }))
      .toBeVisible();
  });

  test('送った利用者を読めない問い合わせは、送信者を表示できない旨を示す', async () => {
    await renderDetail(MEMBER_INQUIRY_ID, () =>
      detailResult(memberDetailOf({ member: null })),
    );

    expect(summaryOf('送信者')?.textContent).toBe('表示できない利用者');
    await expect
      .element(messages().nth(0))
      .toHaveTextContent('表示できない利用者');
  });

  test('表示中は30秒ごとに取り直し、新しいメッセージと対応ステータスを示す', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const initial = memberDetailOf();
    const updated = memberDetailOf({
      status: 'OPEN',
      messages: [
        ...initial.messages,
        userMessage(
          '01JC0MESSAGE00000000000004',
          '再発しました。',
          '2026-11-04T06:00:00.000Z',
        ),
      ],
    });
    let current = initial;
    await renderDetail(MEMBER_INQUIRY_ID, () => detailResult(current));
    await expect.poll(() => messages().elements().length).toBe(3);
    const callsBefore = inquiryCallsOf(executeGraphQL).length;
    current = updated;

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS - 1);
    expect(inquiryCallsOf(executeGraphQL)).toHaveLength(callsBefore);
    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(() => messages().elements().length).toBe(4);
    await expect.element(messages().nth(3)).toHaveTextContent('再発しました。');
    expect(summaryOf('対応ステータス')?.textContent).toBe('未対応');
    expect(inquiryCallsOf(executeGraphQL)).toHaveLength(callsBefore + 1);
  });

  test('自動更新を切ると、30秒を過ぎても取り直さない', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await renderDetail(MEMBER_INQUIRY_ID);
    await expect.element(autoRefreshSwitch()).toBeChecked();
    const callsBefore = inquiryCallsOf(executeGraphQL).length;

    await userEvent.click(autoRefreshSwitch());

    await expect.element(autoRefreshSwitch()).not.toBeChecked();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3);
    expect(inquiryCallsOf(executeGraphQL)).toHaveLength(callsBefore);
  });
});

describe('未ログインの問い合わせの詳細', () => {
  test('ニックネーム・連絡先メールアドレス・カテゴリ・対応ステータス・メッセージ・受付日時と、返信はシステム外のメールで行う旨を示す', async () => {
    await renderDetail(GUEST_INQUIRY_ID);

    expect(summaryOf('種別')?.textContent).toBe('未ログイン');
    expect(summaryOf('ニックネーム')?.textContent).toBe('訪問者');
    expect(summaryOf('連絡先メールアドレス')?.textContent).toBe(
      'visitor@mail.example',
    );
    expect(summaryOf('カテゴリ')?.textContent).toBe('その他');
    expect(summaryOf('対応ステータス')?.textContent).toBe('対応済');
    const receivedAt = summaryOf('受付日時')?.querySelector('time');
    expect(receivedAt?.dateTime).toBe('2026-11-02T03:00:00.000Z');
    expect(summaryOf('メッセージ')?.textContent).toBe(
      '退会の方法を教えてください。\nログインできません。',
    );
    await expect
      .element(
        main().getByText(
          'この問い合わせへの回答は、連絡先メールアドレスへシステム外のメールで行ってください。',
        ),
      )
      .toBeVisible();
    await expect.element(messageLog()).not.toBeInTheDocument();
    await expect.element(autoRefreshSwitch()).not.toBeInTheDocument();
    expect(summary().elements().length).toBeGreaterThan(0);
  });

  test('未ログインの問い合わせは定期的に取り直さない', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await renderDetail(GUEST_INQUIRY_ID);
    const callsBefore = inquiryCallsOf(executeGraphQL).length;

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3);

    expect(inquiryCallsOf(executeGraphQL)).toHaveLength(callsBefore);
  });
});

describe('見つからない・取得の失敗', () => {
  test('存在しない問い合わせは存在しないページを示す', async () => {
    await renderDetail('01JC0NOTFOUND0000000000000');

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('ページが見つかりません');
  });

  test('IDの形式の違反は、存在を区別させないよう存在しないページを示す', async () => {
    await renderDetail('x'.repeat(65), () =>
      failure({
        code: 'validation_error',
        message: '入力内容に誤りがあります。',
        status: 400,
        details: [
          {
            field: 'id',
            code: 'too_big',
            message: '問い合わせが見つかりません。',
          },
        ],
      }),
    );
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('ページが見つかりません');
  });
});

describe('詳細の操作の登録口', () => {
  const contexts: InquiryDetailActionContext[] = [];

  function RecordingAction({
    inquiry,
  }: {
    readonly inquiry: InquiryDetailActionContext;
  }) {
    contexts.push(inquiry);
    return <section aria-label="記録する操作">{inquiry.kind}</section>;
  }

  function SecondAction() {
    return <section aria-label="2番目の操作">2番目</section>;
  }

  function ThrowingAction(): never {
    throw new Error('操作の描画の失敗');
  }

  beforeEach(() => {
    contexts.length = 0;
  });

  test.each([
    {
      label: 'ログイン',
      id: MEMBER_INQUIRY_ID,
      expected: {
        inquiryId: MEMBER_INQUIRY_ID,
        kind: 'member',
        userId: '01JC0VSER000000000000000AA',
        withdrawn: false,
        contactEmail: null,
      },
    },
    {
      label: '未ログイン',
      id: GUEST_INQUIRY_ID,
      expected: {
        inquiryId: GUEST_INQUIRY_ID,
        kind: 'guest',
        userId: null,
        withdrawn: false,
        contactEmail: 'visitor@mail.example',
      },
    },
  ])(
    '$labelの詳細に、登録した操作を順序どおりに並べて文脈の値を渡し、1つの操作の失敗で詳細を止めない',
    async ({ id, expected }) => {
      registeredActions.push(
        { id: 'z.second', order: 30, component: SecondAction },
        { id: 'a.throwing', order: 20, component: ThrowingAction },
        { id: 'm.recording', order: 10, component: RecordingAction },
      );
      await renderDetail(id);

      await expect.element(main().getByText('2番目')).toBeVisible();
      expect(
        main()
          .getByRole('region')
          .elements()
          .map((region) => region.getAttribute('aria-label'))
          .filter((label) => label !== null),
      ).toStrictEqual(['記録する操作', '2番目の操作']);
      expect(contexts.at(-1)).toStrictEqual(expected);
      await expect
        .element(main().getByRole('alert'))
        .toHaveTextContent(
          'ページを表示できませんでした。時間をおいて再度お試しください。',
        );
      expect(main().element().textContent).not.toContain('お問い合わせ');
      await expect.element(summary().first()).toBeVisible();
    },
  );
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、退会済みのログインの問い合わせの詳細がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDetail(MEMBER_INQUIRY_ID, () =>
        detailResult(memberDetailOf({ withdrawn: true })),
      );
      await expect.element(messageLog()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、未ログインの問い合わせの詳細がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDetail(GUEST_INQUIRY_ID);
      await expect
        .element(main().getByText('visitor@mail.example'))
        .toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
