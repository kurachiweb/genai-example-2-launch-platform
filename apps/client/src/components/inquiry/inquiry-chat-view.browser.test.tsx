import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import {
  ADMIN_AVATAR_KEY,
  ADMIN_NICKNAME,
  adminReply,
  CHAT_INQUIRY_ID,
  firstMessage,
  memberInquiryResult,
  userMessage,
} from '../../../test/inquiry-chat-fixtures.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  signedInViewerQuery,
  VIEWER_NICKNAME,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientMemberInquiryDocument,
  type ClientMemberInquiryQuery,
  ClientMyInquiriesDocument,
  ClientPostInquiryMessageDocument,
} from '../../graphql/generated/graphql.ts';
import { memberInquiryQueryOptions } from '../../graphql/inquiry-chat.ts';
import { myInquiriesQueryOptions } from '../../graphql/inquiry-contact.ts';
import { type ClientViewer, toClientViewer } from '../../graphql/viewer.ts';
import { InquiryChatView } from './inquiry-chat-view.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const LIVE_REFRESH_MS = 30_000;

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const viewerOf = (status: ClientViewer['status'] = 'ACTIVE'): ClientViewer => {
  const viewer = toClientViewer(signedInViewerQuery({ status }));
  if (viewer === null) {
    throw new Error('ログイン中の利用者を作れませんでした。');
  }
  return viewer;
};

const renderChat = async (
  data: ClientMemberInquiryQuery = memberInquiryResult(),
  viewer: ClientViewer = viewerOf(),
) => {
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(
    memberInquiryQueryOptions(viewer, CHAT_INQUIRY_ID).queryKey,
    data,
  );
  const router = await renderInRouter(
    <DisplayPreferencesProvider initial={TOKYO_JA}>
      <InquiryChatView viewer={viewer} inquiryId={CHAT_INQUIRY_ID} />
    </DisplayPreferencesProvider>,
    { path: `/inquiries/${CHAT_INQUIRY_ID}`, context },
  );
  return { router, context };
};

const messageLog = () => page.getByRole('log', { name: 'メッセージ' });
const messages = () => messageLog().getByRole('article');
const summary = () => page.getByRole('definition');
const autoRefreshSwitch = () => page.getByRole('switch', { name: '自動更新' });
const composerForm = () =>
  page.getByRole('form', { name: 'メッセージの送信フォーム' });
const bodyInput = () => page.getByRole('textbox', { name: 'メッセージ(必須)' });
const submitButton = () => page.getByRole('button', { name: '送信する' });

const chatCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientMemberInquiryDocument,
  );

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  vi.useRealTimers();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('InquiryChatView', () => {
  test('カテゴリ・対応ステータス・送信日時と、メッセージを送信日時の古い順に示す', async () => {
    await renderChat();

    await expect.element(summary().nth(0)).toHaveTextContent('不具合の報告');
    await expect.element(summary().nth(1)).toHaveTextContent('対応中');
    const sentAt = summary().nth(2).element().querySelector('time');
    expect(sentAt?.dateTime).toBe('2026-11-04T01:00:00.000Z');
    expect(sentAt?.textContent).toBe('2026年11月4日(水) 10:00');
    expect(
      messages()
        .elements()
        .map((element) => element.textContent),
    ).toEqual([
      expect.stringMatching(
        new RegExp(
          `${VIEWER_NICKNAME}.*画面が表示されません。.*screenshot\\.png`,
          'u',
        ),
      ) as string,
      expect.stringMatching(/サポート担当.*状況を確認します。/u) as string,
      expect.stringMatching(/削除済みの管理者.*対応しました。/u) as string,
    ]);
  });

  test('各メッセージの送信日時を、機械が読める日時を持つ閲覧者の地域の形式で示す', async () => {
    await renderChat();

    await expect.element(messages().nth(1)).toBeInTheDocument();
    const time = messages().nth(1).element().querySelector('time');
    expect(time?.dateTime).toBe('2026-11-04T02:00:00.000Z');
    expect(time?.textContent).toBe('2026年11月4日(水) 11:00');
  });

  test('管理者の返信に、返信した管理者のプロフィール画像とニックネームを示す', async () => {
    // 前のテストで読み込めなかった画像はブラウザが失敗を覚えていて直ちに既定のアイコンへ切り替わるため、このテストだけの画像にする
    const objectKey = ADMIN_AVATAR_KEY.split('').reverse().join('');
    const reply = adminReply();
    await renderChat(
      memberInquiryResult({
        messages: [
          firstMessage(),
          {
            ...reply,
            admin: reply.admin && {
              ...reply.admin,
              avatar: reply.admin.avatar && {
                ...reply.admin.avatar,
                objectKey,
              },
            },
          },
        ],
      }),
    );

    const avatar = messages().nth(1).element().querySelector('img');
    expect(avatar?.getAttribute('src')).toContain(objectKey);
    expect(avatar?.getAttribute('alt')).toBe('');
    await expect.element(messages().nth(1)).toHaveTextContent(ADMIN_NICKNAME);
  });

  test('削除された管理者の返信は、管理者の情報に代えて削除済みの管理者である旨を示す', async () => {
    await renderChat();

    await expect
      .element(messages().nth(2))
      .toHaveTextContent('削除済みの管理者');
    expect(messages().nth(2).element().querySelector('img')).toBeNull();
  });

  test('表示中は30秒ごとに取り直し、新しいメッセージと対応ステータスを示す', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const updated = memberInquiryResult({ status: 'OPEN' });
    executeGraphQL.mockResolvedValue({
      ok: true,
      data: {
        memberInquiry: {
          ...updated.memberInquiry,
          messages: [
            ...(updated.memberInquiry?.messages ?? []),
            userMessage(
              '01JC0MESSAGE00000000000004',
              '再発しました。',
              '2026-11-04T04:00:00.000Z',
            ),
          ],
        },
      },
    });
    await renderChat();
    await expect.poll(() => messages().elements().length).toBe(3);

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS - 1);
    expect(chatCalls()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    await expect.poll(() => messages().elements().length).toBe(4);
    await expect.element(messages().nth(3)).toHaveTextContent('再発しました。');
    await expect.element(summary().nth(1)).toHaveTextContent('未対応');
    expect(chatCalls()).toEqual([
      [ClientMemberInquiryDocument, { id: CHAT_INQUIRY_ID }, expect.anything()],
    ]);
  });

  test('自動更新を切ると、30秒を過ぎても取り直さない', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    executeGraphQL.mockResolvedValue({ ok: true, data: memberInquiryResult() });
    await renderChat();
    await expect.element(autoRefreshSwitch()).toBeChecked();

    await userEvent.click(autoRefreshSwitch());

    await expect.element(autoRefreshSwitch()).not.toBeChecked();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3);
    expect(chatCalls()).toHaveLength(0);
  });

  test('追加メッセージを送ると、チャットを取り直して送ったメッセージを示し、自分の問い合わせの一覧を古いものとする', async () => {
    const sent = memberInquiryResult();
    executeGraphQL.mockImplementation((document: unknown) => {
      if (document === ClientPostInquiryMessageDocument) {
        return Promise.resolve({
          ok: true,
          data: { postInquiryMessage: { id: '01JC0MESSAGE00000000000004' } },
        });
      }
      return Promise.resolve({
        ok: true,
        data: {
          memberInquiry: {
            ...sent.memberInquiry,
            messages: [
              ...(sent.memberInquiry?.messages ?? []),
              userMessage(
                '01JC0MESSAGE00000000000004',
                '追加の情報です。',
                '2026-11-04T04:00:00.000Z',
              ),
            ],
          },
        },
      });
    });
    const viewer = viewerOf();
    const listKey = myInquiriesQueryOptions(viewer.id, undefined).queryKey;
    const { context } = await renderChat(memberInquiryResult(), viewer);
    context.queryClient.setQueryData(listKey, {
      myInquiries: { items: [], nextCursor: null },
    });

    await userEvent.fill(bodyInput(), '追加の情報です。');
    await userEvent.click(submitButton());

    await expect
      .element(messages().nth(3))
      .toHaveTextContent('追加の情報です。');
    expect(chatCalls()).toHaveLength(1);
    expect(context.queryClient.getQueryState(listKey)?.isInvalidated).toBe(
      true,
    );
    expect(
      executeGraphQL.mock.calls.filter(
        ([document]) => document === ClientMyInquiriesDocument,
      ),
    ).toHaveLength(0);
  });

  test('停止していないログイン中の利用者には、メッセージの送信欄を示す', async () => {
    await renderChat();

    await expect.element(composerForm()).toBeVisible();
    expect(
      page.getByRole('note', { name: '停止中のアカウント' }).query(),
    ).toBeNull();
  });

  test('停止中の利用者には、メッセージを示したまま、送信欄に代えて停止中の案内と問い合わせフォームへのリンクを示す', async () => {
    await renderChat(
      memberInquiryResult({ canPost: false }),
      viewerOf('SUSPENDED'),
    );

    const notice = page.getByRole('note', { name: '停止中のアカウント' });
    await expect
      .element(notice)
      .toHaveTextContent(
        'このアカウントは停止中のため、メッセージを送信できません。運営への連絡はお問い合わせフォームから行えます。',
      );
    await expect
      .element(notice.getByRole('link', { name: 'お問い合わせフォーム' }))
      .toHaveAttribute('href', '/contact');
    expect(composerForm().query()).toBeNull();
    expect(messages().elements()).toHaveLength(3);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('送信欄の表示中に、アクセシビリティの検査の違反が0件', async () => {
      await renderChat();
      await expect.element(composerForm()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('停止中の案内の表示中に、アクセシビリティの検査の違反が0件', async () => {
      await renderChat(
        memberInquiryResult({ canPost: false }),
        viewerOf('SUSPENDED'),
      );
      await expect
        .element(page.getByRole('note', { name: '停止中のアカウント' }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
