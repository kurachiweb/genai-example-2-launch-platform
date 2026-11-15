import { describe, expect, test } from 'bun:test';

import {
  parseSuperAdminInvitationOutput,
  readAdminIds,
  readSingleAdminId,
  superAdminInvitationArgs,
} from './admin-bootstrap-parsing.ts';

const INVITATION_TOKEN = ['invitation', 'token', 'value'].join('-');

const INVITATION_LINK = `http://localhost:48045/auth/invitation#token=${INVITATION_TOKEN}`;

const EXPIRES_AT = '2026-11-05T03:04:05.678Z';

const issuedOutput = (lines: {
  readonly link?: string;
  readonly expiry?: string;
}): string =>
  [
    '最上位管理者の招待を発行しました(環境: local)。招待のメールは送っていません。',
    ...(lines.link === undefined ? [] : [`招待のリンク: ${lines.link}`]),
    ...(lines.expiry === undefined ? [] : [`有効期限: ${lines.expiry}`]),
    'このリンクは再表示できません。招待する本人にだけ渡してください。',
    '',
  ].join('\n');

describe('superAdminInvitationArgs', () => {
  test('招待の発行コマンドをローカルの環境と指定したメールアドレスで実行する引数を返す', () => {
    expect(superAdminInvitationArgs('e2e-a@test.example')).toStrictEqual([
      'run',
      'admin:invite-super-admin',
      '--',
      '--target',
      'local',
      '--email',
      'e2e-a@test.example',
    ]);
  });
});

describe('parseSuperAdminInvitationOutput', () => {
  test('出力の招待のリンクの行と有効期限の行から、リンクとISO形式の有効期限を返す', () => {
    const stdout = issuedOutput({
      link: INVITATION_LINK,
      expiry: `2026年11月5日 3:04 [${EXPIRES_AT}]`,
    });

    expect(parseSuperAdminInvitationOutput(stdout)).toStrictEqual({
      link: INVITATION_LINK,
      expiresAt: EXPIRES_AT,
    });
  });

  test('招待のリンクの行が無ければ、出力を示して失敗する', () => {
    const stdout = issuedOutput({ expiry: `2026年11月5日 [${EXPIRES_AT}]` });

    expect(() => parseSuperAdminInvitationOutput(stdout)).toThrow(
      `招待の発行コマンドの出力に招待のリンクがありません: ${stdout}`,
    );
  });

  test.each([
    ['URLとして解釈できない', 'リンク'],
    ['招待の画面への経路でない', 'http://localhost:48045/auth/login#token=x'],
    [
      'フラグメントにトークンを持たない',
      'http://localhost:48045/auth/invitation',
    ],
  ])('招待のリンクが%s場合は失敗する', (_label, link) => {
    const stdout = issuedOutput({ link, expiry: `[${EXPIRES_AT}]` });

    expect(() => parseSuperAdminInvitationOutput(stdout)).toThrow(
      `招待の発行コマンドの出力の招待のリンクが正しくありません: ${link}`,
    );
  });

  test.each([
    ['有効期限の行が無い', undefined],
    ['ISO形式の日時を角括弧で持たない', '2026年11月5日 3:04'],
    ['角括弧の中が日時でない', '2026年11月5日 [期限]'],
  ])('%s場合は、出力を示して失敗する', (_label, expiry) => {
    const stdout = issuedOutput({
      link: INVITATION_LINK,
      ...(expiry === undefined ? {} : { expiry }),
    });

    expect(() => parseSuperAdminInvitationOutput(stdout)).toThrow(
      `招待の発行コマンドの出力に有効期限がありません: ${stdout}`,
    );
  });
});

describe('readSingleAdminId', () => {
  test('1行だけの結果から管理者のIDを返す', () => {
    expect(readSingleAdminId([{ id: '01J0ADMIN' }], 'e2e@test.example')).toBe(
      '01J0ADMIN',
    );
  });

  test.each([
    ['行が無い', []],
    ['複数の行がある', [{ id: 'A' }, { id: 'B' }]],
    ['IDが文字列でない', [{ id: 1 }]],
  ])('%s場合は、メールアドレスを示して失敗する', (_label, rows) => {
    expect(() => readSingleAdminId(rows, 'e2e@test.example')).toThrow(
      'ローカルのD1にe2e@test.exampleの管理者が1人だけ見つかりませんでした',
    );
  });
});

describe('readAdminIds', () => {
  test('各行の管理者のIDを行の順に返す', () => {
    expect(readAdminIds([{ id: 'A' }, { id: 'B' }])).toStrictEqual(['A', 'B']);
  });

  test('行が無ければ空の配列を返す', () => {
    expect(readAdminIds([])).toStrictEqual([]);
  });

  test('IDが文字列でない行があれば失敗する', () => {
    expect(() => readAdminIds([{ id: 'A' }, { id: null }])).toThrow(
      'ローカルのD1の結果の管理者のIDが文字列ではありません',
    );
  });
});
