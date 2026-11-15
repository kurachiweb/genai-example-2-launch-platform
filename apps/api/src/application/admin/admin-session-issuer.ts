import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { Principal } from '../../../lib/core/session/session-view.ts';
import { ADMIN_HASH_PURPOSES } from '../../domain/admin/admin-auth-token-purpose.ts';
import { ADMIN_SESSION_POLICY } from '../../domain/admin/admin-session-policy.ts';
import {
  cookieMaxAgeSeconds,
  newSessionTimes,
} from '../../domain/auth/session-policy.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AdminRequestMeta,
  AdminSessionStore,
  IssuedAdminSession,
  NewAdminSessionRecord,
} from './ports.ts';

export const ADMIN_SESSION_USER_AGENT_MAX_LENGTH = 512;

export interface AdminSessionIssuer {
  issue(adminId: string, meta: AdminRequestMeta): Promise<IssuedAdminSession>;
  // 管理者の全セッションを消した後に呼び、操作した端末が同じ管理者としてログイン中だったときだけ発行する
  reissueForOperator(
    adminId: string,
    operator: Principal,
    meta: AdminRequestMeta,
  ): Promise<IssuedAdminSession | undefined>;
}

export interface PreparedAdminSession {
  readonly record: NewAdminSessionRecord;
  readonly issued: IssuedAdminSession;
}

const storedUserAgent = (userAgent: string | undefined): string | null =>
  userAgent === undefined || userAgent === ''
    ? null
    : userAgent.slice(0, ADMIN_SESSION_USER_AGENT_MAX_LENGTH);

// 招待の完了は有効化と同じ一括の書き込みでセッションを保存するため、保存と切り離して組み立てる
export async function prepareAdminSession(
  secrets: SecretIssuer,
  ids: IdGenerator,
  adminId: string,
  meta: AdminRequestMeta,
): Promise<PreparedAdminSession> {
  const secret = await secrets.issue(ADMIN_HASH_PURPOSES.session);
  const times = newSessionTimes(meta.now, ADMIN_SESSION_POLICY);
  const sessionId = ids.generate();
  return {
    record: {
      id: sessionId,
      adminId,
      tokenHash: secret.hash,
      userAgent: storedUserAgent(meta.userAgent),
      ...times,
    },
    issued: {
      sessionId,
      token: secret.plain,
      maxAgeSeconds: cookieMaxAgeSeconds(times, meta.now, ADMIN_SESSION_POLICY),
    },
  };
}

@injectable()
export class StoreAdminSessionIssuer implements AdminSessionIssuer {
  constructor(
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(PLATFORM_TYPES.IdGenerator)
    private readonly ids: IdGenerator,
    @inject(ADMIN_TYPES.AdminSessionStore)
    private readonly sessions: AdminSessionStore,
  ) {}

  async issue(
    adminId: string,
    meta: AdminRequestMeta,
  ): Promise<IssuedAdminSession> {
    const { record, issued } = await prepareAdminSession(
      this.secrets,
      this.ids,
      adminId,
      meta,
    );
    await this.sessions.insert(record);
    return issued;
  }

  async reissueForOperator(
    adminId: string,
    operator: Principal,
    meta: AdminRequestMeta,
  ): Promise<IssuedAdminSession | undefined> {
    if (
      operator.kind !== 'authenticated' ||
      operator.subjectKind !== 'admin' ||
      operator.subjectId !== adminId
    ) {
      return undefined;
    }
    return this.issue(adminId, meta);
  }
}
