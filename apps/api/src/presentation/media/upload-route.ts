import type { Context, Hono } from 'hono';

import type { UploaderDenialCode } from '../../../common-lib/media/media-error-codes.ts';
import {
  downloadPathOf,
  UPLOAD_FILE_NAME_HEADER,
} from '../../../common-lib/media/upload-protocol.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type { UploadReceiver } from '../../../lib/core/media/ports.ts';
import type {
  UploadPurpose,
  UploadPurposeRegistry,
} from '../../../lib/core/media/upload-purpose.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import {
  UPLOAD_ACCESS_TYPES,
  type UploaderEligibility,
} from '../../application/media/uploader-eligibility.ts';
import type { AuthenticatedPrincipal } from '../../application/session/session-verifier.ts';
import type { InternalHonoEnv } from '../gateway/internal-only.ts';
import { readInternalCaller } from '../gateway/internal-request.ts';

export const UPLOAD_ROUTE_PATH = '/media/uploads/:purpose';

const PURPOSE_NOT_FOUND_MESSAGE = 'アップロードの用途が見つかりません。';

const UPLOAD_FORBIDDEN_MESSAGE = 'この操作はできません。';

const DENIAL_MESSAGES: Readonly<Record<UploaderDenialCode, string>> =
  Object.freeze({
    account_unavailable:
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
    email_not_verified:
      'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
  });

function findPurpose(
  registry: UploadPurposeRegistry,
  name: string,
): UploadPurpose {
  const purpose = registry.find(name);
  if (purpose === undefined) {
    throw new AppError({
      kind: 'not_found',
      code: 'upload_purpose_not_found',
      message: PURPOSE_NOT_FOUND_MESSAGE,
    });
  }
  return purpose;
}

function assertUploaderKind(
  purpose: UploadPurpose,
  principal: AuthenticatedPrincipal,
): void {
  if (!purpose.uploaderKinds.includes(principal.subjectKind)) {
    throw new AppError({
      kind: 'forbidden',
      code: 'upload_forbidden',
      message: UPLOAD_FORBIDDEN_MESSAGE,
    });
  }
}

// 管理者側の要求は判定の対象外のため、利用者側の要求だけを判定する。判定までは本文を読まない
async function assertEligibleUploader<E extends PlatformEnv>(
  c: Context<InternalHonoEnv<E>>,
  purpose: UploadPurpose,
  principal: AuthenticatedPrincipal,
): Promise<void> {
  const caller = readInternalCaller(c.req.raw);
  if (caller === undefined) {
    throw new Error('内部経路の呼び出し元がありません');
  }
  if (caller !== 'client') {
    return;
  }
  const decision = await c
    .get('container')
    .get<UploaderEligibility>(UPLOAD_ACCESS_TYPES.UploaderEligibility)
    .check({ session: c.var.session, principal, purpose });
  if (!decision.allowed) {
    throw new AppError({
      kind: 'forbidden',
      code: decision.code,
      message: DENIAL_MESSAGES[decision.code],
    });
  }
}

export function registerUploadRoutes<E extends PlatformEnv>(
  app: Hono<InternalHonoEnv<E>>,
): void {
  app.post(UPLOAD_ROUTE_PATH, async (c) => {
    const container = c.get('container');
    const purpose = findPurpose(
      container.get<UploadPurposeRegistry>(MEDIA_TYPES.UploadPurposeRegistry),
      c.req.param('purpose'),
    );
    const principal = await c.var.session.requireAuthenticated();
    assertUploaderKind(purpose, principal);
    await assertEligibleUploader(c, purpose, principal);
    const outcome = await container
      .get<UploadReceiver>(MEDIA_TYPES.UploadReceiver)
      .receive({
        purpose,
        uploader: { kind: principal.subjectKind, id: principal.subjectId },
        contentLength: c.req.header('Content-Length') ?? null,
        contentType: c.req.header('Content-Type') ?? null,
        fileNameHeader: c.req.header(UPLOAD_FILE_NAME_HEADER) ?? null,
        body: c.req.raw.body,
      });
    if (!outcome.ok) {
      throw new AppError(outcome.rejection);
    }
    const location =
      purpose.storage === 'files'
        ? { Location: downloadPathOf(outcome.file.fileId) }
        : undefined;
    return c.json({ data: outcome.file }, 201, location);
  });
}
