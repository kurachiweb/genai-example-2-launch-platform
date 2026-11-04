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
import {
  errorReply,
  stubUploadFetch,
  uploadedReply,
} from '../../../lib/test/fake-upload-fetch.ts';
import { createSvgFile } from '../../../lib/test/media-files.ts';
import {
  renderAccountPage,
  respondAccountGraphQL,
} from '../../../test/account-fixtures.ts';
import {
  AVATAR,
  AVATAR_OBJECT_KEY,
  callsOf,
  failure,
  type GraphQLHandler,
  selfAccountOf,
  success,
} from '../../../test/admin-accounts-fixtures.ts';
import {
  ADMIN_NICKNAME,
  signedInAdminQuery,
} from '../../../test/admin-viewer-fixtures.ts';
import {
  AdminUpdateProfileDocument,
  type AdminViewerQuery,
  AdminViewerDocument,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

const SELF_ID = '01JC0ADMIN000000000000000000';
const UPLOADED_FILE_ID = '01JC0UPLOAD00000000000000000';
const UNEXPECTED_WITHOUT_CONTACT =
  'ページを表示できませんでした。時間をおいて再度お試しください。';
const CONTACT_PROMPT = 'お問い合わせ';

const main = () => page.getByRole('main');
const region = (name: string) => main().getByRole('region', { name });
const profile = () => region('プロフィール');
const nicknameInput = () =>
  profile().getByRole('textbox', { name: 'ニックネーム(必須)' });
const titleInput = () =>
  profile().getByRole('textbox', { name: '肩書き(任意)' });
const saveButton = () => profile().getByRole('button', { name: '保存する' });

const WITH_AVATAR = signedInAdminQuery({ avatar: AVATAR });

const fileInputOf = (element: Element): HTMLInputElement => {
  const input = element.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) {
    throw new Error('ファイルの入力欄が描画されていません。');
  }
  return input;
};

async function renderWith(
  handlers: ReadonlyMap<unknown, GraphQLHandler> = new Map(),
  viewer: AdminViewerQuery = signedInAdminQuery(),
) {
  respondAccountGraphQL(executeGraphQL, { viewer: () => viewer, handlers });
  await render(<Toaster />);
  const rendered = await renderAccountPage(viewer);
  await expect.element(profile()).toBeVisible();
  return rendered;
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  vi.unstubAllGlobals();
  applyColorScheme('light');
});

describe('自分のアカウントのページ', () => {
  test('見出しの下に、プロフィール・メールアドレスの変更・パスワードの変更・多要素認証・リカバリコードの区画を順に並べる', async () => {
    await renderWith();

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('自分のアカウント');
    expect(
      main()
        .getByRole('heading', { level: 2 })
        .elements()
        .map((heading) => heading.textContent),
    ).toStrictEqual([
      'プロフィール',
      'メールアドレスの変更',
      'パスワードの変更',
      '多要素認証',
      'リカバリコード',
    ]);
  });
});

describe('プロフィール', () => {
  test('現在の値から始め、画像を保ったまま編集したニックネームと肩書きを自分の識別子で保存し、ログイン中の管理者を取り直す', async () => {
    const update = vi.fn(() =>
      success({ updateAdminProfile: selfAccountOf('VIEWER') }),
    );
    await renderWith(
      new Map<unknown, GraphQLHandler>([[AdminUpdateProfileDocument, update]]),
      WITH_AVATAR,
    );
    const viewerCalls = callsOf(executeGraphQL, AdminViewerDocument).length;

    await expect.element(nicknameInput()).toHaveValue(ADMIN_NICKNAME);
    await expect.element(titleInput()).toHaveValue('サポート担当');
    await userEvent.fill(nicknameInput(), ' 運営の責任者 ');
    await userEvent.fill(titleInput(), '');
    await saveButton().click();

    await expect
      .element(page.getByText('プロフィールを保存しました。'))
      .toBeVisible();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      id: SELF_ID,
      nickname: '運営の責任者',
      title: null,
      avatarFileId: AVATAR.id,
    });
    await expect
      .poll(() => callsOf(executeGraphQL, AdminViewerDocument).length)
      .toBeGreaterThan(viewerCalls);
    await expect.element(saveButton()).toHaveFocus();
  });

  test('登録済みの画像を表示する', async () => {
    // 前のテストで読み込めなかった画像はブラウザが失敗を覚えていて直ちに既定のアイコンへ切り替わるため、このテストだけの画像にする
    const objectKey = AVATAR_OBJECT_KEY.split('').reverse().join('');
    await renderWith(
      new Map(),
      signedInAdminQuery({ avatar: { ...AVATAR, objectKey } }),
    );

    expect(
      profile().element().querySelector('img')?.getAttribute('src'),
    ).toContain(objectKey);
  });

  test('画像が未登録なら既定のアイコンを表示し、取り除く操作を描かない', async () => {
    await renderWith();

    expect(profile().element().querySelector('img')).toBeNull();
    expect(
      profile().element().querySelector('[data-slot="media-placeholder"]')
        ?.textContent,
    ).toBe('運');
    expect(
      profile().getByRole('button', { name: '画像を取り除く' }).elements(),
    ).toHaveLength(0);
  });

  test('画像を取り除くと既定のアイコンに戻す旨を示し、画像なしで保存する', async () => {
    const update = vi.fn(() =>
      success({ updateAdminProfile: selfAccountOf('VIEWER') }),
    );
    await renderWith(
      new Map<unknown, GraphQLHandler>([[AdminUpdateProfileDocument, update]]),
      WITH_AVATAR,
    );

    await profile().getByRole('button', { name: '画像を取り除く' }).click();
    await expect
      .element(profile())
      .toHaveTextContent('ニックネームから作るアイコンを表示します。');
    await expect
      .element(profile().getByRole('button', { name: '画像を選択' }))
      .toHaveFocus();
    await saveButton().click();

    await expect
      .element(page.getByText('プロフィールを保存しました。'))
      .toBeVisible();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      id: SELF_ID,
      nickname: ADMIN_NICKNAME,
      title: 'サポート担当',
      avatarFileId: null,
    });
  });

  test('管理者の画像の用途でアップロードした画像を保存し、保存の後はアップロードの一覧を空に戻す', async () => {
    const uploads = stubUploadFetch();
    const update = vi.fn(() =>
      success({ updateAdminProfile: selfAccountOf('VIEWER') }),
    );
    await renderWith(
      new Map<unknown, GraphQLHandler>([[AdminUpdateProfileDocument, update]]),
    );
    const svg = createSvgFile('avatar.svg');

    await userEvent.upload(fileInputOf(profile().element()), [svg]);
    await uploads.reply(uploadedReply(svg, UPLOADED_FILE_ID));
    await expect
      .element(profile().getByText('アップロード済み').first())
      .toBeVisible();
    await saveButton().click();

    await expect
      .element(page.getByText('プロフィールを保存しました。'))
      .toBeVisible();
    expect(uploads.calls[0]?.path).toContain('/_bff/uploads/admin-avatar');
    expect(update).toHaveBeenCalledExactlyOnceWith({
      id: SELF_ID,
      nickname: ADMIN_NICKNAME,
      title: 'サポート担当',
      avatarFileId: UPLOADED_FILE_ID,
    });
    await expect
      .element(profile().getByText('アップロード済み'))
      .not.toBeInTheDocument();
  });

  test('アップロードの想定外の失敗は、問い合わせを促す文を含めずに示す', async () => {
    const uploads = stubUploadFetch();
    await renderWith();

    await userEvent.upload(fileInputOf(profile().element()), [
      createSvgFile('avatar.svg'),
    ]);
    await uploads.reply(errorReply(404, 'upload_purpose_not_found'));

    await expect
      .element(profile().getByText(UNEXPECTED_WITHOUT_CONTACT, { exact: true }))
      .toBeInTheDocument();
    expect(profile().element().textContent).not.toContain(CONTACT_PROMPT);
  });

  test('入力の違反は欄ごとに示し、サーバーの欄の詳細も欄に示す', async () => {
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [
          AdminUpdateProfileDocument,
          () =>
            failure({
              code: 'validation_error',
              message: '入力内容を確認してください。',
              status: 200,
              details: [
                {
                  field: 'title',
                  code: 'too-long',
                  message: '肩書きは50文字以内で入力してください。',
                },
              ],
            }),
        ],
      ]),
    );

    await userEvent.fill(nicknameInput(), '');
    await titleInput().click();
    await expect
      .element(nicknameInput())
      .toHaveAccessibleDescription(/ニックネームを入力してください。/);
    await userEvent.fill(nicknameInput(), ADMIN_NICKNAME);
    await saveButton().click();

    await expect
      .element(titleInput())
      .toHaveAccessibleDescription(/肩書きは50文字以内で入力してください。/);
    await expect.element(titleInput()).toHaveAttribute('aria-invalid', 'true');
  });

  test('欄に対応しない失敗は、区画の中に問い合わせを促さない文言で示す', async () => {
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [
          AdminUpdateProfileDocument,
          () =>
            failure({
              code: 'invalid_upload',
              message:
                '画像を確認できませんでした。もう一度アップロードしてください。',
              status: 200,
            }),
        ],
      ]),
    );

    await saveButton().click();

    await expect
      .element(profile().getByRole('alert'))
      .toHaveTextContent(
        '画像を確認できませんでした。もう一度アップロードしてください。',
      );
    await expect.element(saveButton()).toBeEnabled();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('ページのアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderWith(new Map(), WITH_AVATAR);

    expect(await runAxe(main().element())).toStrictEqual([]);
  });
});
