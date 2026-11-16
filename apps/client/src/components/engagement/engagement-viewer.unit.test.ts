import { describe, expect, test } from 'bun:test';

import type { ClientViewer } from '../../graphql/viewer.ts';
import { engagementViewerKind } from './engagement-viewer.ts';

const viewerOf = (overrides: Partial<ClientViewer> = {}): ClientViewer => ({
  id: '01JC0VIEWER0000000000000000',
  handle: 'pitch_maker',
  nickname: 'ピッチの作り手',
  emailVerified: true,
  status: 'ACTIVE',
  totpEnabled: false,
  ...overrides,
});

describe('engagementViewerKind', () => {
  test.each([true, false])(
    '未ログインは投稿者本人かに関わらずguest(本人の判定=%p)',
    (isOwner) => {
      expect(engagementViewerKind(null, isOwner)).toBe('guest');
    },
  );

  test('メールアドレスが未確認の利用者はunverified', () => {
    expect(
      engagementViewerKind(viewerOf({ emailVerified: false }), false),
    ).toBe('unverified');
  });

  test('メールアドレスが未確認の投稿者本人は本人より未確認を先に判定してunverified', () => {
    expect(engagementViewerKind(viewerOf({ emailVerified: false }), true)).toBe(
      'unverified',
    );
  });

  test('確認済みの投稿者本人はowner', () => {
    expect(engagementViewerKind(viewerOf(), true)).toBe('owner');
  });

  test('確認済みで投稿者本人でない利用者はmember', () => {
    expect(engagementViewerKind(viewerOf(), false)).toBe('member');
  });
});
