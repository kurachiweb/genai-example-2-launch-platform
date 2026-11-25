import { describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import {
  DELETED_PRODUCT_ROW,
  SCHEDULED_ROW,
} from '../../../test/admin-sponsorships-fixtures.ts';
import { adminWithRole } from '../../../test/admin-viewer-fixtures.ts';
import { toAdminViewer } from '../../graphql/admin-viewer.ts';
import { AdminViewerProvider } from '../layout/admin-viewer-context.tsx';
import { AdminSponsorshipTable } from './admin-sponsorship-table.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const PAGINATION = Object.freeze({
  hasPrevious: false,
  hasNext: false,
  onPrevious: () => undefined,
  onNext: () => undefined,
});

describe('AdminSponsorshipTable', () => {
  test('「強制終了」を押すと、その行の申込を渡して強制終了の確認を求める', async () => {
    const viewer = toAdminViewer(adminWithRole('MODERATOR'));
    if (viewer === null) {
      throw new Error('ログイン中の管理者を作れませんでした。');
    }
    const onTerminate = vi.fn();
    await render(
      <DisplayPreferencesProvider
        initial={{ timeZone: 'Asia/Tokyo', locale: 'ja-JP' }}
      >
        <AdminViewerProvider viewer={viewer}>
          <AdminSponsorshipTable
            rows={[SCHEDULED_ROW, DELETED_PRODUCT_ROW]}
            pagination={PAGINATION}
            onTerminate={onTerminate}
          />
        </AdminViewerProvider>
      </DisplayPreferencesProvider>,
    );

    await userEvent.click(
      page.getByRole('button', { name: `申込${SCHEDULED_ROW.id}を強制終了` }),
    );

    expect(onTerminate).toHaveBeenCalledExactlyOnceWith(SCHEDULED_ROW);
    expect(
      page.getByRole('button', { name: /を強制終了$/u }).elements(),
    ).toHaveLength(1);
  });
});
