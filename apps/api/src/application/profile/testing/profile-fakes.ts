import { toHandleKey } from '../../../../common-lib/handles/handle-rules.ts';
import type {
  CurrentUser,
  UserAccountView,
} from '../../../../lib/core/identity/account-guard.ts';
import type {
  ClaimRequest,
  ClaimResult,
  MediaFiles,
} from '../../../../lib/core/media/ports.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import type {
  ProfileHandleOccupiedOptions,
  ProfileSaveInput,
  ProfileSaveResult,
  ProfileSnapshot,
  ProfileStore,
} from '../ports.ts';

export const USER_ID = '01JC0USER00000000000000001';
export const OTHER_USER_ID = '01JC0USER00000000000000002';
export const CURRENT_AVATAR_ID = '01JC0FILE00000000000000001';
export const NEW_AVATAR_ID = '01JC0FILE00000000000000002';
export const PROFILE_NOW = new Date('2027-04-01T09:00:00.000Z');

export const fixedClock: Clock = { now: () => PROFILE_NOW };

export const currentUserOf = (
  overrides: Partial<UserAccountView> = {},
): CurrentUser => ({
  principal: {
    kind: 'authenticated',
    subjectKind: 'user',
    subjectId: USER_ID,
    sessionId: '01JC0SESSION000000000000001',
  },
  user: {
    id: USER_ID,
    pseudonymousId: '01JC0PSEUDO000000000000001',
    status: 'active',
    emailVerifiedAt: new Date('2027-03-01T00:00:00.000Z'),
    deletedAt: null,
    email: 'alice@mail.example',
    nickname: 'アリス',
    handle: 'alice',
    ...overrides,
  },
});

export const snapshotOf = (
  overrides: Partial<ProfileSnapshot> = {},
): ProfileSnapshot => ({
  userId: USER_ID,
  nickname: 'アリス',
  handle: 'alice',
  previousHandle: null,
  headline: null,
  bioMarkdown: null,
  avatarFileId: null,
  websites: [],
  suspended: false,
  ...overrides,
});

export interface OccupiedQuery {
  readonly handle: string;
  readonly options: ProfileHandleOccupiedOptions | undefined;
}

export interface FakeProfileStoreOptions {
  readonly snapshot?: ProfileSnapshot | undefined;
  readonly occupiedHandles?: readonly string[];
  readonly saveResult?: ProfileSaveResult;
}

export interface FakeProfileStore extends ProfileStore {
  readonly saves: ProfileSaveInput[];
  readonly occupiedQueries: OccupiedQuery[];
}

// 呼び出しの順序を他の偽物と同じ記録に残し、保存が成功したら次の読み取りに反映する
export function createFakeProfileStore(
  calls: string[],
  options: FakeProfileStoreOptions = {},
): FakeProfileStore {
  let snapshot: ProfileSnapshot | undefined =
    'snapshot' in options ? options.snapshot : snapshotOf();
  const occupied = new Set((options.occupiedHandles ?? []).map(toHandleKey));
  const saves: ProfileSaveInput[] = [];
  const occupiedQueries: OccupiedQuery[] = [];
  return {
    saves,
    occupiedQueries,
    findSnapshot() {
      calls.push('store.findSnapshot');
      return Promise.resolve(snapshot);
    },
    isHandleOccupied(handle, queryOptions) {
      calls.push('store.isHandleOccupied');
      occupiedQueries.push({ handle, options: queryOptions });
      return Promise.resolve(occupied.has(toHandleKey(handle)));
    },
    findExistingUserIds() {
      throw new Error('この偽物では使わない: findExistingUserIds');
    },
    save(input) {
      calls.push('store.save');
      saves.push(input);
      const result = options.saveResult ?? 'saved';
      if (result === 'saved' && snapshot !== undefined) {
        snapshot = {
          ...snapshot,
          nickname: input.nickname,
          handle: input.handle,
          previousHandle:
            input.plan.handle.kind === 'changed'
              ? input.plan.handle.previous
              : snapshot.previousHandle,
          headline: input.headline,
          bioMarkdown: input.bioMarkdown,
          avatarFileId: input.avatarFileId,
          websites: input.websites,
        };
      }
      return Promise.resolve(result);
    },
  };
}

export interface FakeMediaFilesOptions {
  readonly claimResult?: ClaimResult;
  readonly eraseNowError?: Error;
  readonly markDeletedError?: Error;
}

export interface FakeMediaFiles {
  readonly media: MediaFiles;
  readonly claims: ClaimRequest[];
  readonly erased: (readonly string[])[];
  readonly markedDeleted: (readonly string[])[];
}

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
export function createFakeMediaFiles(
  calls: string[],
  options: FakeMediaFilesOptions = {},
): FakeMediaFiles {
  const claims: ClaimRequest[] = [];
  const erased: (readonly string[])[] = [];
  const markedDeleted: (readonly string[])[] = [];
  const implemented: Partial<MediaFiles> = {
    claim(request) {
      calls.push('media.claim');
      claims.push(request);
      return Promise.resolve(options.claimResult ?? { ok: true });
    },
    eraseNow(fileIds) {
      calls.push('media.eraseNow');
      erased.push(fileIds);
      if (options.eraseNowError !== undefined) {
        return Promise.reject(options.eraseNowError);
      }
      return Promise.resolve({ erased: fileIds.length });
    },
    markDeleted(fileIds) {
      calls.push('media.markDeleted');
      markedDeleted.push(fileIds);
      if (options.markDeletedError !== undefined) {
        return Promise.reject(options.markDeletedError);
      }
      return Promise.resolve();
    },
  };
  const media = new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as MediaFiles;
  return { media, claims, erased, markedDeleted };
}
