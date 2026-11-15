import { useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { PUBLIC_PROFILE_BADGES } from '../../composition/public-profile-sections.ts';
import {
  ClientProfileAwardsDocument,
  type ClientProfileAwardsQuery,
} from '../../graphql/generated/graphql.ts';
import { profileAwardsQueryOptions } from '../../graphql/launch-history.ts';
import { useViewer } from '../auth/use-viewer.ts';
import {
  PROFILE_HANDLE,
  PROFILE_NICKNAME,
  publicProfileOf,
} from '../profile/public-profile-fixtures.ts';
import { renderPublicProfilePage } from '../profile/public-profile-page-testing.tsx';
import type {
  PublicProfileBadgeSection,
  PublicProfileSectionContext,
} from '../profile/public-profile-section-types.ts';

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const executeGraphQLMock = vi.mocked(executeGraphQL);

const WEEK_LABELS = [
  'Pitch Notes 2026年第37週(9/7〜9/13)',
  'Match Board 2026年第38週(9/14〜9/20)',
  'Pitch Notes 2026年第40週(9/28〜10/4)',
];

const YEAR_LABELS = ['Pitch Notes 2026年'];

type ProfileAwards = NonNullable<ClientProfileAwardsQuery['profileAwards']>;

const AWARDS: ProfileAwards = [
  { kind: 'WEEK', count: 3, labels: WEEK_LABELS },
  { kind: 'YEAR', count: 1, labels: YEAR_LABELS },
];

const ok = (profileAwards: ProfileAwards | null) => ({
  ok: true,
  data: { profileAwards } satisfies ClientProfileAwardsQuery,
});

const LOAD_FAILURE = {
  ok: false,
  error: new GraphQLClientError({
    code: 'internal_error',
    message: 'サーバーでエラーが発生しました。',
    status: 500,
  }),
} as const;

const respond = (result: unknown) => {
  executeGraphQLMock.mockImplementation(((document: unknown) => {
    if (document === ClientProfileAwardsDocument) {
      return result instanceof Promise ? result : Promise.resolve(result);
    }
    throw new Error('想定していない操作が実行されました。');
  }) as never);
};

const awardsCalls = () =>
  executeGraphQLMock.mock.calls.filter(
    ([document]) => document === ClientProfileAwardsDocument,
  );

// 受賞の区画は取得の決着を何も描かないことで示すため、同じ取得を読む区画を後ろに並べ、決着した描画の確定を待つ目印にする
function AwardsSettledProbe({ handle }: PublicProfileSectionContext) {
  const viewer = useViewer();
  const { status } = useQuery(profileAwardsQueryOptions(viewer, handle));
  return status === 'pending' ? null : (
    <span data-testid="awards-settled" hidden />
  );
}

const PROBE: PublicProfileBadgeSection = {
  id: 'test.awards-settled',
  order: 1000,
  Section: AwardsSettledProbe,
};

const renderProfile = ({
  owner = false,
  probe = false,
}: { readonly owner?: boolean; readonly probe?: boolean } = {}) =>
  renderPublicProfilePage(
    publicProfileOf({ viewerRelation: owner ? 'OWNER' : 'NOT_FOLLOWING' }),
    {
      tabs: [],
      badges: probe ? [...PUBLIC_PROFILE_BADGES, PROBE] : undefined,
      ...(owner
        ? { cachedViewer: signedInViewerQuery({ handle: PROFILE_HANDLE }) }
        : {}),
    },
  );

const card = () => page.getByRole('region', { name: PROFILE_NICKNAME });
const awardBadges = () => card().getByRole('button', { name: /^Product of/ });
const badgesSlot = (): HTMLElement => {
  const slot = document.querySelector<HTMLElement>(
    '[data-slot="profile-badges"]',
  );
  if (slot === null) {
    throw new Error('受賞バッジの区画の枠がありません。');
  }
  return slot;
};

const waitForSettled = async () => {
  await expect.element(page.getByTestId('awards-settled')).toBeInTheDocument();
};

const expectNothingDrawn = () => {
  expect(badgesSlot().querySelector('ul')).toBeNull();
  expect(awardBadges().elements()).toHaveLength(0);
  expect(card().getByRole('alert').elements()).toHaveLength(0);
  expect(
    card()
      .getByRole('button', { name: /再試行/ })
      .elements(),
  ).toHaveLength(0);
};

const focusProfileHeading = () => {
  page.getByRole('heading', { level: 1 }).element().focus();
};

beforeEach(() => {
  executeGraphQLMock.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('公開プロフィールの受賞バッジの区画', () => {
  test('表示中の利用者の受賞を照会し、フォロワー数の下にYearを先頭とした種類ごとのゴールドのバッジと2回以上の回数を示す', async () => {
    respond(ok(AWARDS));

    await renderProfile();

    await expect.element(awardBadges().first()).toBeVisible();
    expect(
      awardBadges()
        .elements()
        .map((badge) => badge.textContent),
    ).toEqual(['Product of the Year', 'Product of the Week ×3']);
    for (const badge of awardBadges().elements()) {
      expect(badge.classList.contains('bg-gold')).toBe(true);
    }
    expect(awardsCalls()).toHaveLength(1);
    expect(awardsCalls()[0]?.[1]).toEqual({ userHandle: PROFILE_HANDLE });

    const followers = card().getByText('フォロワー', { exact: true }).element();
    const firstBadge = awardBadges().first().element();
    expect(
      followers.compareDocumentPosition(firstBadge) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(firstBadge.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      followers.getBoundingClientRect().bottom,
    );
  });

  test('本人が閲覧しても同じ区画を示す', async () => {
    respond(ok(AWARDS));

    await renderProfile({ owner: true });

    await expect
      .element(card().getByRole('button', { name: 'Product of the Year' }))
      .toBeVisible();
  });

  test('キーボードでバッジにフォーカスするとツールチップが開き、受賞したプロダクト名と週・年を1件1行で示し、読み上げ用の文言では「、」でつなぐ', async () => {
    respond(ok(AWARDS));

    await renderProfile();
    await expect.element(awardBadges().first()).toBeVisible();
    focusProfileHeading();

    await userEvent.tab();
    const year = card().getByRole('button', { name: 'Product of the Year' });
    await expect.element(year).toHaveFocus();
    await expect
      .element(page.getByRole('tooltip'))
      .toHaveTextContent(YEAR_LABELS[0] ?? '');

    await userEvent.tab();
    const week = card().getByRole('button', {
      name: 'Product of the Week ×3',
    });
    await expect.element(week).toHaveFocus();
    const tooltip = page.getByRole('tooltip');
    for (const label of WEEK_LABELS) {
      await expect.element(tooltip).toHaveTextContent(label);
    }
    const lines = document.querySelectorAll(
      '[data-slot="tooltip-content"] [data-slot="award-label"]',
    );
    expect([...lines].map((line) => line.textContent)).toEqual(WEEK_LABELS);
    await expect
      .element(week)
      .toHaveAccessibleDescription(WEEK_LABELS.join('、'));
    await expect.element(year).toHaveAccessibleDescription(YEAR_LABELS[0]);
  });

  test.each([
    ['受賞が無い', ok([])],
    ['利用者を表示できない(null)', ok(null)],
    ['取得に失敗した', LOAD_FAILURE],
  ])('%s時は何も描かず、再試行の操作も出さない', async (_name, result) => {
    respond(result);

    await renderProfile({ probe: true });
    await waitForSettled();

    expect(awardsCalls()).toHaveLength(1);
    expectNothingDrawn();
  });

  test('読み込み中は何も描かず、区画の枠を見せない', async () => {
    respond(new Promise<never>(() => undefined));

    await renderProfile();
    await expect.element(card()).toBeVisible();
    await vi.waitFor(() => {
      expect(awardsCalls()).toHaveLength(1);
    });

    expectNothingDrawn();
    expect(badgesSlot().childElementCount).toBe(0);
    expect(getComputedStyle(badgesSlot()).display).toBe('none');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('ツールチップを開いた状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      respond(ok(AWARDS));

      await renderProfile();
      await expect.element(awardBadges().first()).toBeVisible();
      focusProfileHeading();
      await userEvent.tab();
      await expect.element(page.getByRole('tooltip')).toBeInTheDocument();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
