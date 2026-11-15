import { describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import {
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import type { ClientViewerQuery } from '../../graphql/generated/graphql.ts';
import { useEngagementViewer } from './use-engagement-viewer.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const VIEWER_ID = '01JC0VIEWER0000000000000000';

function ViewerProbe({ isOwner }: { readonly isOwner: boolean }) {
  const { kind, viewerId } = useEngagementViewer({ viewer: { isOwner } });
  return (
    <dl>
      <dt>状態</dt>
      <dd data-testid="kind">{kind}</dd>
      <dt>利用者</dt>
      <dd data-testid="viewer-id">{viewerId ?? 'なし'}</dd>
    </dl>
  );
}

describe('useEngagementViewer', () => {
  test.each<[string, ClientViewerQuery, boolean, string, string]>([
    ['未ログイン', GUEST_VIEWER_QUERY, false, 'guest', 'なし'],
    [
      '未確認の投稿者本人',
      signedInViewerQuery({ emailVerified: false }),
      true,
      'unverified',
      VIEWER_ID,
    ],
    ['確認済みの投稿者本人', signedInViewerQuery(), true, 'owner', VIEWER_ID],
    ['確認済みの他の利用者', signedInViewerQuery(), false, 'member', VIEWER_ID],
  ])(
    '%sは、ルートが取得した閲覧者と区画の文脈の本人の判定から状態と利用者のIDを返す',
    async (_label, cachedViewer, isOwner, kind, viewerId) => {
      await renderInRouter(<ViewerProbe isOwner={isOwner} />, {
        cachedViewer,
      });

      await expect.element(page.getByTestId('kind')).toHaveTextContent(kind);
      await expect
        .element(page.getByTestId('viewer-id'))
        .toHaveTextContent(viewerId);
    },
  );
});
