import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../../lib/test/display-emulation.ts';
import {
  changedResult,
  INVALIDATED_RATING,
  MODERATION_DISPLAY,
  MODERATION_REASON,
  MODERATION_ROLES,
  type ModerationGraphQLHandler,
  RATING_ID,
  respondModerationGraphQL,
  VALID_RATING,
  variablesOf,
} from '../../../../test/moderation-fixtures.ts';
import { renderModerationPart } from '../../../../test/moderation-render.tsx';
import type { AdminModerationRatingView } from '../../../graphql/admin-moderation-engagement.ts';
import {
  AdminInvalidateRatingDocument,
  AdminRevalidateRatingDocument,
  type AdminRole,
} from '../../../graphql/generated/graphql.ts';
import { RatingModerationActions } from './rating-moderation-actions.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const INVALIDATE_NAME = 'サンプル花子さんの評価を無効化';

const REVALIDATE_NAME = 'サンプル花子さんの評価の無効化の取り消し';

const renderActions = async (
  role: AdminRole,
  rating: AdminModerationRatingView = VALID_RATING,
) => {
  respondModerationGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, ModerationGraphQLHandler>([
      [
        AdminInvalidateRatingDocument,
        () => changedResult('invalidateRating', true),
      ],
      [
        AdminRevalidateRatingDocument,
        () => changedResult('revalidateRating', false),
      ],
    ]),
  });
  return renderModerationPart(<RatingModerationActions rating={rating} />, {
    role,
  });
};

const buttonOf = (name: string) =>
  page.getByRole('button', { name, exact: true });
const dialog = () => page.getByRole('dialog');
const reasonBox = () =>
  dialog().getByRole('textbox', { name: '理由(必須)', exact: true });

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('表示の出し分け', () => {
  test.each(MODERATION_ROLES)(
    '%sには、有効な評価に「無効化」、無効化された評価に「無効化の取り消し」を置く',
    async (role) => {
      await renderActions(role);
      await expect
        .element(buttonOf(INVALIDATE_NAME))
        .toHaveTextContent('無効化');
      expect(buttonOf(REVALIDATE_NAME).query()).toBeNull();
    },
  );

  test('無効化された評価には取り消しだけを置く', async () => {
    await renderActions('MODERATOR', INVALIDATED_RATING);

    await expect
      .element(buttonOf(REVALIDATE_NAME))
      .toHaveTextContent('無効化の取り消し');
    expect(buttonOf(INVALIDATE_NAME).query()).toBeNull();
  });

  test('閲覧のみの管理者には操作を置かない', async () => {
    await renderActions('VIEWER');

    expect(page.getByRole('button').query()).toBeNull();
  });

  test('評価者を読めなければ、名前の評価者を「表示できない利用者」にし、確認の題名から評価者を省く', async () => {
    await renderActions('MODERATOR', { ...VALID_RATING, rater: null });

    await buttonOf('表示できない利用者さんの評価を無効化').click();

    await expect
      .element(page.getByRole('dialog', { name: '評価を無効化しますか?' }))
      .toBeVisible();
  });
});

describe('無効化と取り消し', () => {
  test('無効化は理由が必須で、確定すると評価を無効化して知らせる', async () => {
    await renderActions('MODERATOR');

    await buttonOf(INVALIDATE_NAME).click();
    await expect
      .element(
        page.getByRole('dialog', {
          name: 'サンプル花子さんの評価を無効化しますか?',
        }),
      )
      .toHaveAccessibleDescription(
        '無効化した評価は平均値と件数の算出から除かれます。評価者には自分の評価として表示されたままです。評価者へ通知は送りません。',
      );
    const confirm = dialog().getByRole('button', { name: '無効化する' });
    await expect.element(confirm).toBeDisabled();
    await reasonBox().fill(MODERATION_REASON);
    await confirm.click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminInvalidateRatingDocument),
    ).toStrictEqual([{ id: RATING_ID, reason: MODERATION_REASON }]);
    await expect
      .element(page.getByText('評価を無効化しました。'))
      .toBeVisible();
  });

  test('取り消しも理由が必須で、空の間は確定できず、既に有効なら変わらなかった旨を知らせる', async () => {
    await renderActions('MODERATOR', INVALIDATED_RATING);

    await buttonOf(REVALIDATE_NAME).click();
    await expect
      .element(
        page.getByRole('dialog', {
          name: 'サンプル花子さんの評価の無効化を取り消しますか?',
        }),
      )
      .toHaveAccessibleDescription(
        '評価を平均値と件数の算出に戻します。評価者へ通知は送りません。',
      );
    await expect.element(reasonBox()).toHaveAttribute('aria-required', 'true');
    const confirm = dialog().getByRole('button', { name: '無効化を取り消す' });
    await expect.element(confirm).toBeDisabled();
    await reasonBox().fill(' ');
    await expect.element(confirm).toBeDisabled();
    await reasonBox().fill(MODERATION_REASON);
    await confirm.click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminRevalidateRatingDocument),
    ).toStrictEqual([{ id: RATING_ID, reason: MODERATION_REASON }]);
    await expect.element(page.getByText('既に有効です。')).toBeVisible();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('操作と開いた確認のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderActions('MODERATOR');
    await expect.element(buttonOf(INVALIDATE_NAME)).toBeVisible();

    expect(await runAxe(buttonOf(INVALIDATE_NAME).element())).toStrictEqual([]);

    await buttonOf(INVALIDATE_NAME).click();
    await expect.element(dialog()).toBeVisible();

    expect(await runAxe(dialog().element())).toStrictEqual([]);
  });
});
