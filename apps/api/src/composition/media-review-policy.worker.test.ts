import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { ADMIN_ROLES } from '../../common-lib/admin/admin-roles.ts';
import { admins } from '../../db/schema/admin/admins.ts';
import { NOT_FOUND_RESPONSE } from '../../lib/core/errors/error-envelope.ts';
import { attachmentDisposition } from '../../lib/core/media/file-name.ts';
import type { MediaLocation } from '../../lib/core/media/media-file.ts';
import type { AuthenticatedPrincipal } from '../../lib/core/session/session-view.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearIdentityTables,
  insertUser,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  db,
  fileIdOf,
  insertFile,
  insertReason,
  objectKeyOf,
} from '../../lib/workers/media/testing/media-file-store-fixtures.ts';
import { clearMediaState } from '../../lib/workers/media/testing/media-operations-fixtures.ts';
import { issueAdminSession } from '../../test/support/admin-graphql-harness.ts';
import { callInternal } from '../../test/support/gateway-test-harness.ts';
import { imageFileViewOf } from '../../test/support/media-file-view.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type { SessionIssuer } from '../application/identity/session-issuer.ts';
import {
  type AdminMediaReviewPolicy,
  FILE_ACCESS_TYPES,
} from '../application/media/file-access-policies.ts';
import {
  adminIdOf,
  clearAdminTables,
  insertAdmin,
  insertInvitedAdmin,
} from '../infrastructure/admin/testing/admin-store-fixtures.ts';
import {
  type CallerKind,
  GATEWAY_HEADERS,
} from '../presentation/gateway/gateway-headers.ts';
import { MODULES } from './modules.ts';

const BASE_URL = 'https://api.launch.example';
const RELAYED_IP = '203.0.113.7';
const OWNER = 1;
const ADMIN = 1;
const IMAGE_NAME = '隔離中の画像.png';
const IMAGE_TEXT = 'png-bytes-of-quarantined-image';

const BUCKETS: Readonly<Record<MediaLocation, R2Bucket>> = {
  images: env.IMAGES_BUCKET,
  files: env.FILES_BUCKET,
  quarantine: env.QUARANTINE_BUCKET,
};

function createContainer() {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

async function issueUserSession(userIndex: number): Promise<string> {
  const issued = await createContainer()
    .get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
    .issue(userIdOf(userIndex), {
      clientIp: undefined,
      userAgent: undefined,
      now: new Date(),
    });
  return issued.token;
}

async function issueActiveAdminSession(index: number): Promise<string> {
  await insertAdmin(index);
  const issued = await issueAdminSession(adminIdOf(index));
  return issued.token;
}

function download(
  caller: CallerKind,
  token: string,
  fileId: string,
): Promise<Response> {
  return callInternal(
    caller,
    new Request(`${BASE_URL}/internal/media/files/${fileId}`, {
      headers: {
        [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
        [GATEWAY_HEADERS.sessionToken]: token,
      },
    }),
  );
}

async function seedImage(
  index: number,
  location: MediaLocation,
): Promise<void> {
  const quarantined = location === 'quarantine';
  await insertFile(index, {
    location,
    ownerId: userIdOf(OWNER),
    originalFileName: IMAGE_NAME,
    moderationStatus: quarantined ? 'flagged' : 'passed',
  });
  if (quarantined) {
    await insertReason(index, 'auto');
  }
  await BUCKETS[location].put(objectKeyOf(index), IMAGE_TEXT, {
    httpMetadata: { contentType: 'image/png' },
  });
}

function principalOf(
  subjectKind: AuthenticatedPrincipal['subjectKind'],
  subjectId: string,
): AuthenticatedPrincipal {
  return {
    kind: 'authenticated',
    subjectKind,
    subjectId,
    sessionId: '01JC0SESS0000000000000000A',
  };
}

beforeEach(async () => {
  await clearMediaState();
  await clearAdminTables();
  await clearIdentityTables();
  await insertUser(OWNER);
});

afterAll(() => {
  resetSync();
});

describe('管理者側の内部の配信経路での画像の確認', () => {
  test.each([
    ['隔離バケットの隔離画像', 'quarantine'],
    ['画像用非公開バケットの公開中の画像', 'images'],
  ] as const)(
    '有効な管理者のセッションなら、%sを添付・no-storeで返す',
    async (_label, location) => {
      await seedImage(1, location);
      const token = await issueActiveAdminSession(ADMIN);

      const response = await download('admin', token, fileIdOf(1));

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
      expect(response.headers.get('Content-Disposition')).toBe(
        attachmentDisposition(IMAGE_NAME),
      );
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(await response.text()).toBe(IMAGE_TEXT);
    },
  );

  test('利用者側からの要求は、画像の保有者の利用者のセッションでも不存在と同じ404にする', async () => {
    await seedImage(1, 'quarantine');
    const token = await issueUserSession(OWNER);

    const response = await download('client', token, fileIdOf(1));

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
  });

  test('存在しない画像は、有効な管理者にも同じ404にする', async () => {
    const token = await issueActiveAdminSession(ADMIN);

    const response = await download('admin', token, fileIdOf(99));

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
  });
});

describe('APIサーバーに束縛した管理者の画像確認の判定', () => {
  function resolvePolicy(): AdminMediaReviewPolicy {
    return createContainer().get<AdminMediaReviewPolicy>(
      FILE_ACCESS_TYPES.AdminMediaReviewPolicy,
    );
  }

  test.each(ADMIN_ROLES)(
    'ロールによらず有効な管理者(%s)に、実際の管理者の名簿で画像を許す',
    async (role) => {
      await insertAdmin(ADMIN, { role });

      const allowed = await resolvePolicy().canReview({
        principal: principalOf('admin', adminIdOf(ADMIN)),
        file: imageFileViewOf(),
      });

      expect(allowed).toBe(true);
    },
  );

  test.each([
    [
      '削除済みの管理者',
      async () => {
        await insertAdmin(ADMIN);
        await db.delete(admins).where(eq(admins.id, adminIdOf(ADMIN)));
      },
    ],
    ['招待中の管理者', () => insertInvitedAdmin(ADMIN)],
  ])('%sには、画像を許さない', async (_label, arrange) => {
    await arrange();

    const allowed = await resolvePolicy().canReview({
      principal: principalOf('admin', adminIdOf(ADMIN)),
      file: imageFileViewOf(),
    });

    expect(allowed).toBe(false);
  });

  test('管理者と同じ識別子の利用者の主体には、画像を許さない', async () => {
    await insertAdmin(ADMIN);

    const allowed = await resolvePolicy().canReview({
      principal: principalOf('user', adminIdOf(ADMIN)),
      file: imageFileViewOf(),
    });

    expect(allowed).toBe(false);
  });
});
