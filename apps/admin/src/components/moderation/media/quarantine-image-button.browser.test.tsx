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
  LOGO_FILE_ID,
  MODERATION_DISPLAY,
  MODERATION_ROLES,
  PUBLIC_LOGO_FILE,
  QUARANTINED_AVATAR_FILE,
  respondModerationGraphQL,
  variablesOf,
} from '../../../../test/moderation-fixtures.ts';
import { renderModerationPart } from '../../../../test/moderation-render.tsx';
import type { AdminMediaFileView } from '../../../graphql/admin-moderation-shared.ts';
import {
  AdminQuarantineImageDocument,
  type AdminRole,
} from '../../../graphql/generated/graphql.ts';
import { QuarantineImageButton } from './quarantine-image-button.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const BUTTON_NAME = 'ロゴを隔離';

const DIALOG_TITLE = 'この画像を隔離しますか?';

const renderButton = async (
  role: AdminRole,
  file: AdminMediaFileView = PUBLIC_LOGO_FILE,
) => {
  respondModerationGraphQL(executeGraphQL, {
    role,
    handlers: new Map([
      [
        AdminQuarantineImageDocument,
        () => changedResult('quarantineImage', true),
      ],
    ]),
  });
  return renderModerationPart(
    <QuarantineImageButton file={file} accessibleName={BUTTON_NAME} />,
    { role },
  );
};

const button = () =>
  page.getByRole('button', { name: BUTTON_NAME, exact: true });
const dialog = () => page.getByRole('dialog', { name: DIALOG_TITLE });

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
    '%sには、公開中の画像に見える名前「隔離」と対象を含む名前のボタンを置く',
    async (role) => {
      await renderButton(role);

      await expect.element(button()).toBeVisible();
      await expect.element(button()).toHaveTextContent('隔離');
    },
  );

  test('閲覧のみの管理者にはボタンを置かない', async () => {
    await renderButton('VIEWER');

    expect(button().query()).toBeNull();
  });

  test('隔離中の画像にはボタンを置かない', async () => {
    await renderButton('MODERATOR', QUARANTINED_AVATAR_FILE);

    expect(button().query()).toBeNull();
  });
});

describe('個別の隔離', () => {
  test('押すと画像の隔離の確認を開き、理由(任意)を空のまま確定すると画像を隔離して知らせる', async () => {
    await renderButton('MODERATOR');

    await button().click();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        '画像を利用者側に表示しないようにします。隔離を解除するまで公開に戻りません。',
      );
    await expect
      .element(dialog().getByRole('textbox', { name: '理由(任意)' }))
      .toBeVisible();
    await dialog().getByRole('button', { name: '隔離する' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminQuarantineImageDocument),
    ).toStrictEqual([{ fileId: LOGO_FILE_ID, reason: '' }]);
    await expect.element(page.getByText('画像を隔離しました。')).toBeVisible();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('ボタンと開いた確認のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderButton('MODERATOR');
    await expect.element(button()).toBeVisible();

    expect(await runAxe(button().element())).toStrictEqual([]);

    await button().click();
    await expect.element(dialog()).toBeVisible();

    expect(await runAxe(dialog().element())).toStrictEqual([]);
  });
});
