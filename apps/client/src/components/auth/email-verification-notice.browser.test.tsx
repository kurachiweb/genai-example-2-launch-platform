import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { ClientResendVerificationEmailDocument } from '../../graphql/generated/graphql.ts';
import { EmailVerificationNotice } from './email-verification-notice.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const MESSAGE = 'この機能はメールアドレスの確認後に利用できます。';

const renderNotice = () =>
  renderInRouter(
    <>
      <EmailVerificationNotice message={MESSAGE} />
      <Toaster />
    </>,
    { cachedViewer: signedInViewerQuery({ emailVerified: false }) },
  );

const note = () => page.getByRole('note', { name: 'メールアドレスの確認' });

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('EmailVerificationNotice', () => {
  test('引数で渡した文言を、メールアドレスの確認の注記として示す', async () => {
    await renderNotice();

    await expect.element(note()).toHaveTextContent(MESSAGE);
  });

  test('「確認メールを再送」で確認メールを送り直し、成功をトーストで示す', async () => {
    executeGraphQL.mockResolvedValue({
      ok: true,
      data: { resendVerificationEmail: 'SENT' },
    });
    await renderNotice();

    await userEvent.click(
      note().getByRole('button', { name: '確認メールを再送' }),
    );

    await expect
      .element(page.getByText('確認メールを再送しました。'))
      .toBeVisible();
    expect(executeGraphQL).toHaveBeenCalledWith(
      ClientResendVerificationEmailDocument,
      {},
      {},
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('アクセシビリティの検査の違反が0件', async () => {
      await renderNotice();
      await expect.element(note()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
