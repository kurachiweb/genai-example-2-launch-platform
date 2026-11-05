import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import { graphqlQueryKey } from '../../../lib/utilities/graphql/persisted-document.ts';
import {
  callsOf,
  failure,
  success,
} from '../../../test/admin-accounts-fixtures.ts';
import {
  adminReply,
  type ChangeStatusHandler,
  FIRST_PAGE,
  GUEST_INQUIRY_ID,
  guestDetailOf,
  INQUIRIES_PATH,
  inquiryCallsOf,
  type InquiryHandler,
  MEMBER_INQUIRY_ID,
  memberDetailOf,
  renderAdminInquiriesPage,
  type ReplyHandler,
  respondAdminInquiriesGraphQL,
} from '../../../test/admin-inquiries-fixtures.ts';
import {
  AdminInquiriesDocument,
  type AdminInquiryQuery,
  type AdminRole,
  AdminUnhandledInquiryCountDocument,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const main = () => page.getByRole('main');
const summaryOf = (term: string) =>
  main().getByRole('term').filter({ hasText: term }).element()
    .nextElementSibling;
const messages = () =>
  main().getByRole('log', { name: 'メッセージ' }).getByRole('article');
const replySection = () => main().getByRole('region', { name: '返信' });
const replyBody = () =>
  main().getByRole('textbox', { name: '返信の本文(必須)' });
const replyReason = () =>
  replySection().getByRole('textbox', { name: '理由(任意)' });
const replyButton = () => main().getByRole('button', { name: '返信する' });
const statusSection = () =>
  main().getByRole('region', { name: '対応ステータスの変更' });
const statusSelect = () =>
  main().getByRole('combobox', { name: '変更後の対応ステータス' });
const changeStatusButton = () =>
  main().getByRole('button', { name: '対応ステータスを変更' });
const dialog = () => page.getByRole('dialog');

const detailResult = (
  adminInquiry: AdminInquiryQuery['adminInquiry'],
): Promise<unknown> => success({ adminInquiry });

interface RenderOptions {
  readonly role?: AdminRole;
  readonly id?: string;
  readonly inquiry?: InquiryHandler;
  readonly reply?: ReplyHandler;
  readonly changeStatus?: ChangeStatusHandler;
}

const renderDetail = async ({
  role = 'MODERATOR',
  id = MEMBER_INQUIRY_ID,
  inquiry,
  reply,
  changeStatus,
}: RenderOptions = {}) => {
  respondAdminInquiriesGraphQL(executeGraphQL, {
    role,
    ...(inquiry === undefined ? {} : { inquiry }),
    ...(reply === undefined ? {} : { reply }),
    ...(changeStatus === undefined ? {} : { changeStatus }),
  });
  await render(<Toaster />);
  const router = await renderAdminInquiriesPage(
    role,
    `${INQUIRIES_PATH}/${id}`,
  );
  await expect.element(main().getByRole('heading', { level: 1 })).toBeVisible();
  return router.options.context;
};

const SUMMARY_KEYS = Object.freeze({
  list: graphqlQueryKey(AdminInquiriesDocument, {}),
  count: graphqlQueryKey(AdminUnhandledInquiryCountDocument, {}),
});

// 一覧と未対応の件数を前に表示した状態にし、変更の後に古いものとされることと、表示していないため取り直さないことを確かめる
const seedSummaries = (queryClient: QueryClient): void => {
  queryClient.setQueryData(SUMMARY_KEYS.list, FIRST_PAGE);
  queryClient.setQueryData(SUMMARY_KEYS.count, {
    adminUnhandledInquiryCount: 3,
  });
};

const expectSummariesMarkedStale = async (
  queryClient: QueryClient,
): Promise<void> => {
  await expect
    .poll(() => queryClient.getQueryState(SUMMARY_KEYS.list)?.isInvalidated)
    .toBe(true);
  await expect
    .poll(() => queryClient.getQueryState(SUMMARY_KEYS.count)?.isInvalidated)
    .toBe(true);
  expect(callsOf(executeGraphQL, AdminInquiriesDocument)).toHaveLength(0);
  expect(
    callsOf(executeGraphQL, AdminUnhandledInquiryCountDocument),
  ).toHaveLength(0);
};

const chooseStatus = async (name: string) => {
  await userEvent.click(statusSelect());
  await userEvent.click(page.getByRole('option', { name, exact: true }));
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay({ timeZone: 'Asia/Tokyo', locale: 'ja-JP' });
});

afterEach(async () => {
  vi.useRealTimers();
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('操作の出し分け', () => {
  test.each<AdminRole>(['MODERATOR', 'SUPER_ADMIN'])(
    '%sには、ログインの問い合わせの返信のフォームとステータスの変更を表示する',
    async (role) => {
      await renderDetail({ role });

      await expect.element(replyBody()).toBeVisible();
      await expect.element(replyButton()).toBeVisible();
      await expect.element(statusSelect()).toBeVisible();
      await expect.element(changeStatusButton()).toBeVisible();
    },
  );

  test('閲覧のみの管理者には、返信のフォームとステータスの変更を表示しない', async () => {
    await renderDetail({ role: 'VIEWER' });

    await expect.element(messages().first()).toBeVisible();
    expect(replySection().query()).toBeNull();
    expect(statusSection().query()).toBeNull();
  });

  test('退会済みの問い合わせには、返信のフォームとステータスの変更を表示しない', async () => {
    await renderDetail({
      inquiry: () => detailResult(memberDetailOf({ withdrawn: true })),
    });

    await expect
      .element(main().getByText('退会済み', { exact: true }))
      .toBeVisible();
    expect(replySection().query()).toBeNull();
    expect(statusSection().query()).toBeNull();
  });

  test('未ログインの問い合わせには、返信のフォームを表示せずステータスの変更だけを表示する', async () => {
    await renderDetail({ id: GUEST_INQUIRY_ID });

    await expect.element(statusSelect()).toBeVisible();
    expect(replySection().query()).toBeNull();
    expect(replyBody().query()).toBeNull();
  });
});

describe('返信', () => {
  test('1,000文字を超える返信は欄に理由を示して送信しない', async () => {
    const reply = vi.fn<ReplyHandler>();
    await renderDetail({ reply });

    await userEvent.fill(replyBody(), 'あ'.repeat(1001));
    await userEvent.click(replyReason());

    await expect
      .element(
        main().getByText('メッセージは1,000文字以内で入力してください。'),
      )
      .toBeVisible();
    await expect.element(replyBody()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(replyButton()).toBeDisabled();
    expect(reply).not.toHaveBeenCalled();
  });

  test('1,000書記素ちょうどの返信は、絵文字の書記素を1文字と数えて送信できる', async () => {
    const reply = vi.fn<ReplyHandler>(() =>
      success({
        replyToInquiry: {
          message: { id: '01JC0MESSAGE00000000000009' },
          notificationQueued: true,
        },
      }),
    );
    await renderDetail({ reply });
    const body = '👨‍👩‍👧'.repeat(1000);

    await userEvent.fill(replyBody(), body);
    await userEvent.click(replyButton());

    await expect.poll(() => reply.mock.calls.length).toBe(1);
    expect(reply.mock.calls[0]?.[0].body).toBe(body);
  });

  test('空白だけの返信は入力を求める', async () => {
    await renderDetail();

    await userEvent.fill(replyBody(), ' \n ');
    await userEvent.click(replyReason());

    await expect
      .element(main().getByText('メッセージを入力してください。'))
      .toBeVisible();
  });

  test('返信を問い合わせのIDと任意の理由とともに送り、トーストを出して取り直したメッセージを示し、空にした本文の欄へフォーカスを戻す', async () => {
    const initial = memberDetailOf();
    let current = initial;
    const reply = vi.fn<ReplyHandler>(() => {
      current = memberDetailOf({
        messages: [
          ...initial.messages,
          adminReply(
            '01JC0MESSAGE00000000000009',
            '対応しました。',
            '2026-11-04T07:00:00.000Z',
          ),
        ],
      });
      return success({
        replyToInquiry: {
          message: { id: '01JC0MESSAGE00000000000009' },
          notificationQueued: true,
        },
      });
    });
    await renderDetail({ reply, inquiry: () => detailResult(current) });
    await expect.poll(() => messages().elements().length).toBe(3);
    await expect
      .element(replySection().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();

    await userEvent.fill(replyBody(), '対応しました。');
    await userEvent.fill(replyReason(), '定型の回答');
    await userEvent.click(replyButton());

    await expect.element(page.getByText('返信を送信しました。')).toBeVisible();
    expect(reply).toHaveBeenCalledWith({
      inquiryId: MEMBER_INQUIRY_ID,
      body: '対応しました。',
      reason: '定型の回答',
    });
    await expect.poll(() => messages().elements().length).toBe(4);
    await expect.element(messages().nth(3)).toHaveTextContent('対応しました。');
    await expect.element(replyBody()).toHaveValue('');
    await expect.element(replyReason()).toHaveValue('');
    await expect.element(replyBody()).toHaveFocus();
  });

  test('理由が空なら理由を送らない', async () => {
    const reply = vi.fn<ReplyHandler>(() =>
      success({
        replyToInquiry: {
          message: { id: '01JC0MESSAGE00000000000009' },
          notificationQueued: true,
        },
      }),
    );
    await renderDetail({ reply });

    await userEvent.fill(replyBody(), '確認します。');
    await userEvent.click(replyButton());

    await expect.poll(() => reply.mock.calls.length).toBe(1);
    expect(reply.mock.calls[0]?.[0].reason ?? undefined).toBeUndefined();
  });

  test('返信の成功で、一覧と未対応の件数を取り直さずに古いものとする', async () => {
    const context = await renderDetail({
      reply: () =>
        success({
          replyToInquiry: {
            message: { id: '01JC0MESSAGE00000000000009' },
            notificationQueued: true,
          },
        }),
    });
    seedSummaries(context.queryClient);

    await userEvent.fill(replyBody(), '確認します。');
    await userEvent.click(replyButton());

    await expect.element(page.getByText('返信を送信しました。')).toBeVisible();
    await expectSummariesMarkedStale(context.queryClient);
  });

  test('通知メールを送れなかった時は、返信を保存した上で送れなかった旨をトーストで示す', async () => {
    const reply = vi.fn<ReplyHandler>(() =>
      success({
        replyToInquiry: {
          message: { id: '01JC0MESSAGE00000000000009' },
          notificationQueued: false,
        },
      }),
    );
    await renderDetail({ reply });

    await userEvent.fill(replyBody(), '確認します。');
    await userEvent.click(replyButton());

    await expect
      .element(
        page.getByText(
          '返信は保存されましたが、通知メールを送れませんでした。',
        ),
      )
      .toBeVisible();
    expect(page.getByText('返信を送信しました。').query()).toBeNull();
    await expect.element(replyBody()).toHaveValue('');
  });

  test('サーバーが本文の欄の違反を返したら、欄に理由を示す', async () => {
    await renderDetail({
      reply: () =>
        failure({
          code: 'validation_error',
          message: '入力内容を確認してください。',
          status: 400,
          details: [
            {
              field: 'body',
              code: 'forbidden-character',
              message: 'メッセージに使用できない文字が含まれています。',
            },
          ],
        }),
    });

    await userEvent.fill(replyBody(), '確認します。');
    await userEvent.click(replyButton());

    await expect
      .element(
        main().getByText('メッセージに使用できない文字が含まれています。'),
      )
      .toBeVisible();
    await expect.element(replyBody()).toHaveAttribute('aria-invalid', 'true');
    await expect.element(replyBody()).toHaveFocus();
  });

  test('返信できない失敗はフォームの中に文言を示し、入力を保つ', async () => {
    await renderDetail({
      reply: () =>
        failure({
          code: 'inquiry_read_only',
          message: '退会したユーザーの問い合わせのため、操作できません。',
          status: 409,
        }),
    });

    await userEvent.fill(replyBody(), '確認します。');
    await userEvent.click(replyButton());

    await expect
      .element(replySection().getByRole('alert'))
      .toHaveTextContent(
        '退会したユーザーの問い合わせのため、操作できません。',
      );
    await expect.element(replyBody()).toHaveValue('確認します。');
  });

  test('想定外の失敗は、問い合わせを促さない文言を示す', async () => {
    await renderDetail({
      reply: () => Promise.reject(new Error('通信の途中の失敗')),
    });

    await userEvent.fill(replyBody(), '確認します。');
    await userEvent.click(replyButton());

    await expect
      .element(replySection().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    expect(main().element().textContent).not.toContain('お問い合わせ');
  });
});

describe('対応ステータスの変更', () => {
  test('現在と同じステータスの間は変更のボタンを押せない', async () => {
    await renderDetail();

    await expect.element(statusSelect()).toHaveTextContent('対応中');
    await expect.element(changeStatusButton()).toBeDisabled();

    await chooseStatus('対応済');

    await expect.element(changeStatusButton()).toBeEnabled();
  });

  test('変更の前に確認のダイアログで、変更後のステータス・任意の理由の欄・監査ログに記録される旨を示し、確定で変更する', async () => {
    let current = memberDetailOf();
    const changeStatus = vi.fn<ChangeStatusHandler>(() => {
      current = memberDetailOf({
        status: 'RESOLVED',
        statusChangedAt: '2026-11-04T08:00:00.000Z',
      });
      return success({
        changeInquiryStatus: {
          id: MEMBER_INQUIRY_ID,
          status: 'RESOLVED',
          statusChangedAt: '2026-11-04T08:00:00.000Z',
        },
      });
    });
    await renderDetail({ changeStatus, inquiry: () => detailResult(current) });

    await chooseStatus('対応済');
    await userEvent.click(changeStatusButton());

    await expect
      .element(dialog().getByRole('heading'))
      .toHaveTextContent('対応ステータスを「対応済」に変更しますか?');
    await expect
      .element(dialog())
      .toHaveTextContent('現在の対応ステータスは「対応中」です。');
    await expect
      .element(dialog().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();
    expect(changeStatus).not.toHaveBeenCalled();
    await userEvent.fill(
      dialog().getByRole('textbox', { name: '理由(任意)' }),
      '解決を確認',
    );
    await userEvent.click(dialog().getByRole('button', { name: '変更する' }));

    await expect
      .element(page.getByText('対応ステータスを変更しました。'))
      .toBeVisible();
    expect(changeStatus).toHaveBeenCalledWith({
      inquiryId: MEMBER_INQUIRY_ID,
      status: 'RESOLVED',
      reason: '解決を確認',
    });
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .poll(() => summaryOf('対応ステータス')?.textContent)
      .toBe('対応済');
    await expect.element(statusSelect()).toHaveTextContent('対応済');
    await expect.element(changeStatusButton()).toBeDisabled();
    await expect.element(statusSelect()).toHaveFocus();
  });

  test('未ログインの問い合わせのステータスも変更できる', async () => {
    const changeStatus = vi.fn<ChangeStatusHandler>(() =>
      success({
        changeInquiryStatus: {
          id: GUEST_INQUIRY_ID,
          status: 'REJECTED',
          statusChangedAt: '2026-11-04T08:00:00.000Z',
        },
      }),
    );
    await renderDetail({ id: GUEST_INQUIRY_ID, changeStatus });

    await chooseStatus('却下');
    await userEvent.click(changeStatusButton());
    await userEvent.click(dialog().getByRole('button', { name: '変更する' }));

    await expect.poll(() => changeStatus.mock.calls.length).toBe(1);
    expect(changeStatus.mock.calls[0]?.[0]).toMatchObject({
      inquiryId: GUEST_INQUIRY_ID,
      status: 'REJECTED',
    });
    await expect
      .poll(() => summaryOf('対応ステータス')?.textContent)
      .toBe('却下');
  });

  test('キャンセルすると変更しない', async () => {
    const changeStatus = vi.fn<ChangeStatusHandler>();
    await renderDetail({ changeStatus });

    await chooseStatus('未対応');
    await userEvent.click(changeStatusButton());
    await userEvent.click(dialog().getByRole('button', { name: 'キャンセル' }));

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(changeStatus).not.toHaveBeenCalled();
    expect(summaryOf('対応ステータス')?.textContent).toBe('対応中');
  });

  test('変更の失敗はダイアログの中に文言を示し、ダイアログを開いたままにする', async () => {
    await renderDetail({
      changeStatus: () =>
        failure({
          code: 'inquiry_state_conflict',
          message: '処理が重なりました。画面を更新して再度お試しください。',
          status: 409,
        }),
    });

    await chooseStatus('対応済');
    await userEvent.click(changeStatusButton());
    await userEvent.click(dialog().getByRole('button', { name: '変更する' }));

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(
        '処理が重なりました。画面を更新して再度お試しください。',
      );
    await expect.element(dialog()).toBeVisible();
  });

  test('同じステータスへの変更の拒否は、欄の詳細の文言を示す', async () => {
    await renderDetail({
      changeStatus: () =>
        failure({
          code: 'validation_error',
          message: '入力内容を確認してください。',
          status: 400,
          details: [
            {
              field: 'status',
              code: 'unchanged',
              message: '現在と異なるステータスを選択してください。',
            },
          ],
        }),
    });

    await chooseStatus('対応済');
    await userEvent.click(changeStatusButton());
    await userEvent.click(dialog().getByRole('button', { name: '変更する' }));

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('現在と異なるステータスを選択してください。');
  });

  test('想定外の失敗は、問い合わせを促さない文言を示す', async () => {
    await renderDetail({
      changeStatus: () => Promise.reject(new Error('通信の途中の失敗')),
    });

    await chooseStatus('対応済');
    await userEvent.click(changeStatusButton());
    await userEvent.click(dialog().getByRole('button', { name: '変更する' }));

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    expect(dialog().element().textContent).not.toContain('お問い合わせ');
  });

  test('取り直しで現在のステータスが変わると、まだ選んでいない選択欄は新しい値を示す', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let current = memberDetailOf();
    await renderDetail({ inquiry: () => detailResult(current) });
    await expect.element(statusSelect()).toHaveTextContent('対応中');
    const callsBefore = inquiryCallsOf(executeGraphQL).length;
    current = memberDetailOf({ status: 'OPEN' });

    await vi.advanceTimersByTimeAsync(30_000);

    await expect
      .poll(() => inquiryCallsOf(executeGraphQL).length)
      .toBe(callsBefore + 1);
    await expect.element(statusSelect()).toHaveTextContent('未対応');
    await expect.element(changeStatusButton()).toBeDisabled();
  });

  test('変更のボタンにフォーカスがある間に取り直しで現在の値が選んだ値と同じになっても、フォーカスを保ち押しても確認を開かない', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let current = memberDetailOf();
    await renderDetail({ inquiry: () => detailResult(current) });
    await chooseStatus('対応済');
    await expect.element(changeStatusButton()).toBeEnabled();
    // 選択肢の一覧は閉じる動きの後に選択欄へフォーカスを戻すため、戻り終えてからボタンへ移す
    await expect.poll(() => page.getByRole('listbox').query()).toBeNull();
    await expect.element(statusSelect()).toHaveFocus();
    await userEvent.tab();
    await expect.element(changeStatusButton()).toHaveFocus();
    current = memberDetailOf({ status: 'RESOLVED' });

    await vi.advanceTimersByTimeAsync(30_000);

    await expect
      .poll(() => summaryOf('対応ステータス')?.textContent)
      .toBe('対応済');
    await expect
      .element(changeStatusButton())
      .toHaveAttribute('aria-disabled', 'true');
    await expect.element(changeStatusButton()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(dialog().query()).toBeNull();

    await userEvent.tab({ shift: true });

    await expect.element(statusSelect()).toHaveFocus();
    await expect.element(changeStatusButton()).toBeDisabled();
  });

  test('競合の拒否では、ダイアログに文言を示したまま詳細を取り直して最新のステータスを示す', async () => {
    let current = guestDetailOf();
    await renderDetail({
      id: GUEST_INQUIRY_ID,
      inquiry: () => detailResult(current),
      changeStatus: () => {
        current = guestDetailOf({ status: 'REJECTED' });
        return failure({
          code: 'inquiry_state_conflict',
          message: '処理が重なりました。画面を更新して再度お試しください。',
          status: 409,
        });
      },
    });
    const callsBefore = inquiryCallsOf(executeGraphQL).length;

    await chooseStatus('対応中');
    await userEvent.click(changeStatusButton());
    await userEvent.click(dialog().getByRole('button', { name: '変更する' }));

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(
        '処理が重なりました。画面を更新して再度お試しください。',
      );
    await expect
      .poll(() => inquiryCallsOf(executeGraphQL).length)
      .toBe(callsBefore + 1);
    await expect
      .element(dialog())
      .toHaveTextContent('現在の対応ステータスは「却下」です。');
    await expect.element(dialog().getByRole('alert')).toBeVisible();

    await userEvent.click(dialog().getByRole('button', { name: 'キャンセル' }));

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(summaryOf('対応ステータス')?.textContent).toBe('却下');
  });

  test('競合でない拒否では、詳細を取り直さない', async () => {
    await renderDetail({
      id: GUEST_INQUIRY_ID,
      changeStatus: () =>
        failure({
          code: 'inquiry_read_only',
          message: '退会したユーザーの問い合わせのため、操作できません。',
          status: 409,
        }),
    });
    const callsBefore = inquiryCallsOf(executeGraphQL).length;

    await chooseStatus('対応中');
    await userEvent.click(changeStatusButton());
    await userEvent.click(dialog().getByRole('button', { name: '変更する' }));

    await expect.element(dialog().getByRole('alert')).toBeVisible();
    expect(inquiryCallsOf(executeGraphQL)).toHaveLength(callsBefore);
  });

  test('変更の成功で、一覧と未対応の件数を取り直さずに古いものとする', async () => {
    const context = await renderDetail({
      changeStatus: () =>
        success({
          changeInquiryStatus: {
            id: MEMBER_INQUIRY_ID,
            status: 'RESOLVED',
            statusChangedAt: '2026-11-04T08:00:00.000Z',
          },
        }),
    });
    seedSummaries(context.queryClient);

    await chooseStatus('対応済');
    await userEvent.click(changeStatusButton());
    await userEvent.click(dialog().getByRole('button', { name: '変更する' }));

    await expect
      .element(page.getByText('対応ステータスを変更しました。'))
      .toBeVisible();
    await expectSummariesMarkedStale(context.queryClient);
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、返信のフォームとステータスの変更を持つ詳細がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDetail();
      await userEvent.fill(replyBody(), 'あ'.repeat(1001));
      await userEvent.click(replyReason());
      await expect
        .element(
          main().getByText('メッセージは1,000文字以内で入力してください。'),
        )
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、ステータスの変更の確認のダイアログがWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDetail({ id: GUEST_INQUIRY_ID });
      await chooseStatus('未対応');
      await userEvent.click(changeStatusButton());
      await expect.element(dialog()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
