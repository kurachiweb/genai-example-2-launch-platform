import { inject, injectable } from 'inversify';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import {
  evaluateSession,
  USER_SESSION_POLICY,
} from '../../domain/auth/session-policy.ts';
import type { AuthenticatedPrincipal } from '../session/session-verifier.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type {
  DeviceDescriber,
  StoredSession,
  UserSessionStore,
} from './ports.ts';

export interface UserSessionView {
  readonly id: string;
  // nullは「不明な端末」
  readonly browserName: string | null;
  readonly osName: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  readonly current: boolean;
}

export interface SessionManagement {
  // 有効なものだけを最終利用の新しい順に返す
  list(
    principal: AuthenticatedPrincipal,
    now: Date,
  ): Promise<readonly UserSessionView[]>;
  // 他人・不明のセッションはAppError(not_found)を投げる
  revoke(
    principal: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<{ readonly revokedCurrent: boolean }>;
  // 操作している端末以外の自分のセッションをすべて削除し、件数を返す
  revokeOthers(principal: AuthenticatedPrincipal): Promise<number>;
}

const NOT_FOUND_MESSAGE = '対象が見つかりません。';

const notFoundError = (): AppError =>
  new AppError({
    kind: 'not_found',
    code: 'not_found',
    message: NOT_FOUND_MESSAGE,
  });

const isUser = (principal: AuthenticatedPrincipal): boolean =>
  principal.subjectKind === 'user';

const newestFirst = (a: StoredSession, b: StoredSession): number =>
  b.lastUsedAt.getTime() - a.lastUsedAt.getTime() ||
  b.createdAt.getTime() - a.createdAt.getTime();

@injectable()
export class StoreSessionManagement implements SessionManagement {
  constructor(
    @inject(IDENTITY_TYPES.UserSessionStore)
    private readonly sessions: UserSessionStore,
    @inject(IDENTITY_TYPES.DeviceDescriber)
    private readonly devices: DeviceDescriber,
  ) {}

  async list(
    principal: AuthenticatedPrincipal,
    now: Date,
  ): Promise<readonly UserSessionView[]> {
    if (!isUser(principal)) {
      return [];
    }
    // 期限切れの行は日次のジョブが消すまで残るため、一覧では検証と同じ規則で除く
    const sessions = await this.sessions.listByUser(principal.subjectId);
    return sessions
      .filter(
        (session) =>
          evaluateSession(session, now, USER_SESSION_POLICY).status ===
          'active',
      )
      .toSorted(newestFirst)
      .map((session) => {
        const device = this.devices.describe(session.userAgent);
        return {
          id: session.id,
          browserName: device.browserName,
          osName: device.osName,
          createdAt: session.createdAt,
          lastUsedAt: session.lastUsedAt,
          current: session.id === principal.sessionId,
        };
      });
  }

  async revoke(
    principal: AuthenticatedPrincipal,
    sessionId: string,
  ): Promise<{ readonly revokedCurrent: boolean }> {
    if (
      !isUser(principal) ||
      !(await this.sessions.deleteOne(principal.subjectId, sessionId))
    ) {
      throw notFoundError();
    }
    return { revokedCurrent: sessionId === principal.sessionId };
  }

  async revokeOthers(principal: AuthenticatedPrincipal): Promise<number> {
    if (!isUser(principal)) {
      return 0;
    }
    return this.sessions.deleteOthers(principal.subjectId, principal.sessionId);
  }
}
