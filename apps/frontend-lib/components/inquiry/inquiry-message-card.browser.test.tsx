import type { ReactElement } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { elementsOverflowingContainer } from '../../test/overflow.ts';
import { formatDateTime } from '../../utilities/datetime/date-time-formats.ts';
import type { DisplayPreferences } from '../../utilities/datetime/display-preferences.ts';
import { DisplayPreferencesContext } from '../datetime/use-display-preferences.ts';
import {
  InquiryMessageCard,
  type InquiryMessageCardProps,
} from './inquiry-message-card.tsx';

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const LOS_ANGELES_EN: DisplayPreferences = {
  timeZone: 'America/Los_Angeles',
  locale: 'en-US',
};

const CREATED_AT = '2026-01-15T07:40:00.000Z';

const AVATAR_TEST_ID = 'avatar';

const BASE_PROPS: InquiryMessageCardProps = {
  side: 'other',
  senderLabel: 'サポート担当',
  avatar: (
    <span
      data-testid={AVATAR_TEST_ID}
      aria-hidden="true"
      className="block size-8 rounded-full bg-muted"
    />
  ),
  body: 'お問い合わせありがとうございます。',
  attachments: [],
  createdAt: CREATED_AT,
};

function cardOf(
  props: Partial<InquiryMessageCardProps> = {},
  preferences: DisplayPreferences = TOKYO_JA,
): ReactElement {
  return (
    <DisplayPreferencesContext value={preferences}>
      <InquiryMessageCard {...BASE_PROPS} {...props} />
    </DisplayPreferencesContext>
  );
}

afterEach(() => {
  applyColorScheme('light');
});

describe('InquiryMessageCard', () => {
  test('送信者の表示名とアバターを示す', async () => {
    await render(cardOf());

    await expect
      .element(page.getByText('サポート担当', { exact: true }))
      .toBeVisible();
    await expect.element(page.getByTestId(AVATAR_TEST_ID)).toBeInTheDocument();
  });

  test('本文の改行を保って表示する', async () => {
    await render(cardOf({ body: '1行目\n2行目\n\n4行目' }));
    const body = page.getByText(/1行目/u).element();

    expect(body.textContent).toBe('1行目\n2行目\n\n4行目');
    expect(getComputedStyle(body).whiteSpace).toBe('pre-wrap');
  });

  test('本文をHTMLとして解釈せず、書かれた文字のまま表示する', async () => {
    const body =
      '<b>太字</b><img src="x" onerror="alert(1)"><script>1</script>';
    const { container } = await render(cardOf({ body }));

    expect(container.querySelector('b, img, script')).toBeNull();
    await expect
      .element(page.getByText(body, { exact: true }))
      .toBeInTheDocument();
  });

  test.each<[string, DisplayPreferences]>([
    ['東京・日本語', TOKYO_JA],
    ['ロサンゼルス・英語', LOS_ANGELES_EN],
  ])(
    '送信日時を閲覧者の地域(%s)の長い日時の書式で示し、機械が読める日時を持たせる',
    async (_name, preferences) => {
      const { container } = await render(cardOf({}, preferences));
      const time = container.querySelector('time');

      expect(time?.getAttribute('datetime')).toBe(CREATED_AT);
      expect(time?.textContent).toBe(
        formatDateTime(new Date(CREATED_AT), 'longDateTime', preferences),
      );
    },
  );

  test('添付があれば、ダウンロードのリンクの一覧を本文の後に示す', async () => {
    await render(
      cardOf({
        attachments: [
          {
            id: 'file-1',
            originalFileName: 'screenshot.png',
            contentType: 'image/png',
            byteSize: 2048,
          },
        ],
      }),
    );

    await expect
      .element(page.getByRole('list', { name: '添付ファイル', exact: true }))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByRole('link', { name: 'screenshot.png(2kB)', exact: true }),
      )
      .toHaveAttribute('href', '/_bff/files/file-1');
  });

  test('添付が無ければ添付の一覧を置かない', async () => {
    await render(cardOf());

    await expect.element(page.getByRole('list')).not.toBeInTheDocument();
  });

  test.each<[InquiryMessageCardProps['side'], 'left' | 'right']>([
    ['self', 'right'],
    ['other', 'left'],
  ])(
    '閲覧者から見た配置が%sなら、アバターを本文の%s側に置く',
    async (side, avatarSide) => {
      await render(<div className="w-[480px]">{cardOf({ side })}</div>);
      const avatar = page.getByTestId(AVATAR_TEST_ID).element();
      const body = page.getByText(BASE_PROPS.body).element();
      const avatarBox = avatar.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();

      if (avatarSide === 'right') {
        expect(avatarBox.left).toBeGreaterThanOrEqual(bodyBox.right);
      } else {
        expect(avatarBox.right).toBeLessThanOrEqual(bodyBox.left);
      }
    },
  );

  test('改行の無い長い本文と送信者の名前も枠の中で折り返す', async () => {
    const { container } = await render(
      <div className="w-64">
        {cardOf({
          senderLabel: 'とても長い送信者の名前'.repeat(4),
          body: 'a'.repeat(300),
        })}
      </div>,
    );

    expect(elementsOverflowingContainer(container)).toStrictEqual([]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('自分と相手のメッセージで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex flex-col gap-4 bg-background p-4 text-foreground">
          {cardOf({ side: 'self', senderLabel: 'あなた' })}
          {cardOf({
            attachments: [
              {
                id: 'file-1',
                originalFileName: 'specification.pdf',
                contentType: 'application/pdf',
                byteSize: 2048,
              },
            ],
          })}
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
