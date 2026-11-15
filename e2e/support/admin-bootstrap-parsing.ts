import type { LocalD1Row } from './local-d1-command.ts';

export interface IssuedSuperAdminInvitation {
  readonly link: string;
  // 有効期限(ISO 8601のUTCの日時)
  readonly expiresAt: string;
}

const INVITATION_SCRIPT = 'admin:invite-super-admin';

const INVITATION_PATH = '/auth/invitation';

const TOKEN_FRAGMENT_PREFIX = '#token=';

const LINK_LINE_PREFIX = '招待のリンク: ';

const EXPIRY_LINE_PATTERN = /^有効期限: .*\[([^\]]+)\]$/u;

export function superAdminInvitationArgs(email: string): readonly string[] {
  return [
    'run',
    INVITATION_SCRIPT,
    '--',
    '--target',
    'local',
    '--email',
    email,
  ];
}

const isInvitationLink = (link: string): boolean => {
  if (!URL.canParse(link)) {
    return false;
  }
  const url = new URL(link);
  return (
    url.pathname === INVITATION_PATH &&
    url.hash.startsWith(TOKEN_FRAGMENT_PREFIX) &&
    url.hash.length > TOKEN_FRAGMENT_PREFIX.length
  );
};

const readLink = (lines: readonly string[], stdout: string): string => {
  const line = lines.find((text) => text.startsWith(LINK_LINE_PREFIX));
  if (line === undefined) {
    throw new Error(
      `招待の発行コマンドの出力に招待のリンクがありません: ${stdout}`,
    );
  }
  const link = line.slice(LINK_LINE_PREFIX.length).trim();
  if (!isInvitationLink(link)) {
    throw new Error(
      `招待の発行コマンドの出力の招待のリンクが正しくありません: ${link}`,
    );
  }
  return link;
};

const readExpiry = (lines: readonly string[], stdout: string): string => {
  for (const line of lines) {
    const iso = EXPIRY_LINE_PATTERN.exec(line)?.[1];
    if (iso !== undefined && !Number.isNaN(Date.parse(iso))) {
      return iso;
    }
  }
  throw new Error(`招待の発行コマンドの出力に有効期限がありません: ${stdout}`);
};

// 出力の行「招待のリンク: <URL>」と「有効期限: <UTCの文> [<ISO>]」を読む
export function parseSuperAdminInvitationOutput(
  stdout: string,
): IssuedSuperAdminInvitation {
  const lines = stdout.split('\n').map((line) => line.trim());
  const link = readLink(lines, stdout);
  const expiresAt = readExpiry(lines, stdout);
  return { link, expiresAt };
}

const idOf = (row: LocalD1Row): string | undefined =>
  typeof row.id === 'string' ? row.id : undefined;

export function readSingleAdminId(
  rows: readonly LocalD1Row[],
  email: string,
): string {
  const [row, ...rest] = rows;
  const id = row === undefined ? undefined : idOf(row);
  if (id === undefined || rest.length > 0) {
    throw new Error(
      `ローカルのD1に${email}の管理者が1人だけ見つかりませんでした`,
    );
  }
  return id;
}

export function readAdminIds(rows: readonly LocalD1Row[]): readonly string[] {
  return rows.map((row) => {
    const id = idOf(row);
    if (id === undefined) {
      throw new Error('ローカルのD1の結果の管理者のIDが文字列ではありません');
    }
    return id;
  });
}
