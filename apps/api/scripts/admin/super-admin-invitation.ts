import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { EMAIL_MAX_LENGTH } from '../../common-lib/identity/account-input-rules.ts';
import { trimWhiteSpace } from '../../common-lib/text/white-space.ts';
import {
  createKeyedHasher,
  type KeyedHasher,
} from '../../lib/core/crypto/keyed-hasher.ts';
import { formatUtcDateTime } from '../../lib/core/email/format-utc-date-time.ts';
import type { SecretGenerator } from '../../src/application/auth/ports.ts';
import { HashingSecretIssuer } from '../../src/application/auth/secret-issuer.ts';
import { ADMIN_STATUSES } from '../../src/domain/admin/admin-account.ts';
import {
  ADMIN_AUTH_TOKEN_TTL_SECONDS,
  ADMIN_HASH_PURPOSES,
} from '../../src/domain/admin/admin-auth-token-purpose.ts';
import { buildInvitationSql, buildLookupSql } from './invitation-sql.ts';
import {
  INVITATION_TARGETS,
  type InvitationTarget,
  invitationTarget,
} from './invitation-targets.ts';

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CommandRunner = (args: readonly string[]) => Promise<CommandResult>;

export interface TempSqlFiles {
  write(sql: string): Promise<string>;
  remove(path: string): Promise<void>;
}

interface TextSink {
  readonly write: (text: string) => unknown;
}

export interface InvitationDependencies {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly wrangler: CommandRunner;
  readonly tempFiles: TempSqlFiles;
  readonly secretGenerator: SecretGenerator;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly stdout: TextSink;
  readonly stderr: TextSink;
}

interface InvitationRequest {
  readonly target: InvitationTarget;
  readonly email: string;
}

const EXIT_SUCCESS = 0;

const EXIT_FAILURE = 1;

const PEPPER_KEY = 'HASH_PEPPER';

const D1_BINDING = 'DB';

const INVITATION_PATH = '/auth/invitation';

const TEMP_DIR_PREFIX = 'super-admin-invitation-';

const TEMP_FILE_NAME = 'invitation.sql';

const OWNER_ONLY_FILE_MODE = 0o600;

const MS_PER_SECOND = 1000;

const INFISICAL_ENVIRONMENTS: Readonly<Record<InvitationTarget, string>> =
  Object.freeze({ local: 'dev', staging: 'staging', prod: 'prod' });

const USAGE =
  '使い方: bun run admin:invite-super-admin -- --target <local|staging|prod> --email <メールアドレス>';

const lookupOutputSchema = z.tuple([
  z.object({
    results: z
      .array(z.object({ id: z.string(), status: z.enum(ADMIN_STATUSES) }))
      .max(1),
  }),
]);

class InvitationFailure extends Error {
  override readonly name: string = 'InvitationFailure';
}

class UsageFailure extends InvitationFailure {
  override readonly name: string = 'UsageFailure';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readOptions(argv: readonly string[]): {
  readonly target?: string;
  readonly email?: string;
} {
  try {
    return parseArgs({
      args: [...argv],
      options: { target: { type: 'string' }, email: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch (error) {
    throw new UsageFailure(`引数が正しくありません: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

function isInvitationTarget(value: string): value is InvitationTarget {
  return (INVITATION_TARGETS as readonly string[]).includes(value);
}

function parseTarget(value: string | undefined): InvitationTarget {
  if (value === undefined) {
    throw new UsageFailure('環境(--target)を指定してください。');
  }
  if (!isInvitationTarget(value)) {
    throw new UsageFailure(
      `環境(--target)は${INVITATION_TARGETS.join('・')}のいずれかを指定してください。`,
    );
  }
  return value;
}

function parseEmail(value: string | undefined): string {
  const email = trimWhiteSpace(value ?? '');
  if (email === '') {
    throw new UsageFailure('メールアドレス(--email)を指定してください。');
  }
  if (email.length > EMAIL_MAX_LENGTH) {
    throw new UsageFailure(
      `メールアドレスは${String(EMAIL_MAX_LENGTH)}文字以内で指定してください。`,
    );
  }
  if (!z.regexes.html5Email.test(email)) {
    throw new UsageFailure('メールアドレスの形式が正しくありません。');
  }
  return email;
}

function parseRequest(argv: readonly string[]): InvitationRequest {
  const options = readOptions(argv);
  return {
    target: parseTarget(options.target),
    email: parseEmail(options.email),
  };
}

function hasherFrom(
  env: InvitationDependencies['env'],
  target: InvitationTarget,
): KeyedHasher {
  const pepper = env[PEPPER_KEY];
  if (pepper === undefined || pepper === '') {
    throw new InvitationFailure(
      [
        `${PEPPER_KEY}が注入されていません。apps/apiで、Infisicalの注入を付けて次のように実行してください。`,
        `infisical --telemetry=false run --env ${INFISICAL_ENVIRONMENTS[target]} -- bun run admin:invite-super-admin -- --target ${target} --email <メールアドレス>`,
      ].join('\n'),
    );
  }
  return createKeyedHasher(pepper);
}

function d1ExecuteArgs(target: InvitationTarget): readonly string[] {
  return [
    'd1',
    'execute',
    D1_BINDING,
    ...invitationTarget(target).wranglerArgs,
    '--json',
  ];
}

function describeCommandFailure(result: CommandResult): string {
  return `Wranglerが終了コード${String(result.exitCode)}で失敗しました。\n${result.stdout.trim()}\n${result.stderr.trim()}`.trimEnd();
}

type LookupRow = z.infer<typeof lookupOutputSchema>[0]['results'][number];

function parseLookupOutput(stdout: string): LookupRow | undefined {
  try {
    return lookupOutputSchema.parse(JSON.parse(stdout))[0].results[0];
  } catch (error) {
    throw new InvitationFailure(
      `管理者を照会できませんでした: 照会の結果の形式が正しくありません。\n${stdout.trim()}`,
      { cause: error },
    );
  }
}

async function findInvitedAdminId(
  request: InvitationRequest,
  deps: InvitationDependencies,
): Promise<string | undefined> {
  const result = await deps.wrangler([
    ...d1ExecuteArgs(request.target),
    '--command',
    buildLookupSql(request.email),
  ]);
  if (result.exitCode !== 0) {
    throw new InvitationFailure(
      `管理者を照会できませんでした: ${describeCommandFailure(result)}`,
    );
  }
  const found = parseLookupOutput(result.stdout);
  if (found?.status === 'active') {
    throw new InvitationFailure(
      '既に有効な管理者がいるメールアドレスです。何も書き込まずに終了しました。',
    );
  }
  return found?.id;
}

async function executeSqlFile(
  path: string,
  target: InvitationTarget,
  deps: InvitationDependencies,
): Promise<void> {
  const result = await deps.wrangler([
    ...d1ExecuteArgs(target),
    '--yes',
    '--file',
    path,
  ]);
  if (result.exitCode !== 0) {
    throw new InvitationFailure(
      `招待を書き込めませんでした: ${describeCommandFailure(result)}`,
    );
  }
}

// SQLのファイルにはトークンのハッシュだけを書き、平文は端末への表示にだけ使う
async function writeWithTempFile(
  sql: string,
  target: InvitationTarget,
  deps: InvitationDependencies,
): Promise<void> {
  const path = await deps.tempFiles.write(sql);
  const writeError = await executeSqlFile(path, target, deps).then(
    () => undefined,
    (error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
  );
  try {
    await deps.tempFiles.remove(path);
  } catch (error) {
    const writeFailure =
      writeError === undefined ? '' : `\n${errorMessage(writeError)}`;
    throw new InvitationFailure(
      `一時ファイルを削除できませんでした: ${path}(${errorMessage(error)})。手作業で削除してください。${writeFailure}`,
      { cause: error },
    );
  }
  if (writeError !== undefined) {
    throw writeError;
  }
}

// アプリのメールのリンクと同じく、トークンはサーバーへ送られないフラグメントに置く
function invitationLink(target: InvitationTarget, token: string): string {
  const url = new URL(INVITATION_PATH, invitationTarget(target).adminOrigin);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.href;
}

function describeIssued(
  request: InvitationRequest,
  invitedAdminId: string | undefined,
  plain: string,
  expiresAt: Date,
): string {
  return [
    `最上位管理者の招待を発行しました(環境: ${request.target})。招待のメールは送っていません。`,
    ...(invitedAdminId === undefined
      ? []
      : [
          '招待中の管理者を最上位管理者にし、未使用の招待のリンクを無効にしました。',
        ]),
    `招待のリンク: ${invitationLink(request.target, plain)}`,
    `有効期限: ${formatUtcDateTime(expiresAt, { withYear: true })} [${expiresAt.toISOString()}]`,
    'このリンクは再表示できません。招待する本人にだけ渡してください。',
    '',
  ].join('\n');
}

async function issue(
  argv: readonly string[],
  deps: InvitationDependencies,
): Promise<void> {
  const request = parseRequest(argv);
  const hasher = hasherFrom(deps.env, request.target);
  const invitedAdminId = await findInvitedAdminId(request, deps);
  const newAdminId = deps.newId();
  const tokenId = deps.newId();
  const now = deps.now();
  const secret = await new HashingSecretIssuer(
    deps.secretGenerator,
    hasher,
  ).issue(ADMIN_HASH_PURPOSES.authToken('invitation'));
  const expiresAt = new Date(
    now.getTime() + ADMIN_AUTH_TOKEN_TTL_SECONDS.invitation * MS_PER_SECOND,
  );
  await writeWithTempFile(
    buildInvitationSql({
      existingInvitedAdminId: invitedAdminId,
      newAdminId,
      email: request.email,
      tokenId,
      tokenHash: secret.hash,
      now,
      expiresAt,
    }),
    request.target,
    deps,
  );
  deps.stdout.write(
    describeIssued(request, invitedAdminId, secret.plain, expiresAt),
  );
}

export async function runSuperAdminInvitation(
  argv: readonly string[],
  deps: InvitationDependencies,
): Promise<number> {
  try {
    await issue(argv, deps);
    return EXIT_SUCCESS;
  } catch (error) {
    const usage = error instanceof UsageFailure ? `\n${USAGE}` : '';
    deps.stderr.write(
      `最上位管理者の招待を発行できませんでした: ${errorMessage(error)}${usage}\n`,
    );
    return EXIT_FAILURE;
  }
}

export function createTempSqlFiles(baseDir: string): TempSqlFiles {
  return {
    async write(sql) {
      const dir = await mkdtemp(join(baseDir, TEMP_DIR_PREFIX));
      const path = join(dir, TEMP_FILE_NAME);
      try {
        await writeFile(path, sql, {
          mode: OWNER_ONLY_FILE_MODE,
          flag: 'wx',
        });
      } catch (error) {
        await rm(dir, { recursive: true, force: true });
        throw error;
      }
      return path;
    },
    async remove(path) {
      await rm(dirname(path), { recursive: true, force: true });
    },
  };
}

// 値をシェルに解釈させないよう、シェルを介さず引数の配列で起動する
export function createCommandRunner(options: {
  readonly bin: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): CommandRunner {
  return async (args) => {
    const child = Bun.spawn([options.bin, ...args], {
      cwd: options.cwd,
      env: { ...options.env },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  };
}

// Wranglerはペッパーを使わないため、子のプロセスへ渡さない
export function withoutPepper(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key !== PEPPER_KEY),
  );
}
