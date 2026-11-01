import { describe, expect, test } from 'bun:test';
import type { ServiceIdentifier } from 'inversify';

import {
  imageFileViewOf,
  mediaFileViewOf,
} from '../../../test/support/media-file-view.ts';
import type { AuthenticatedPrincipal } from '../session/session-verifier.ts';
import {
  type FileAccessAuthorizer,
  type FileAccessCaller,
  FileAccessRegistrationError,
  PolicyFileAccessAuthorizer,
} from './file-access-authorizer.ts';
import type {
  AdminMediaReviewInput,
  AdminMediaReviewPolicy,
  FileReadPolicy,
  FileReadPolicyInput,
} from './file-access-policies.ts';

const USER: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: '01JC0USER00000000000000001',
  sessionId: '01JC0SESSION0000000000001',
});

const ADMIN: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: '01JC0ADMIN0000000000000001',
  sessionId: '01JC0SESSION0000000000002',
});

const INQUIRY_POLICY: unique symbol = Symbol('InquiryAttachmentReadPolicy');

const OTHER_POLICY: unique symbol = Symbol('OtherAttachmentReadPolicy');

class RecordingReadPolicy implements FileReadPolicy {
  readonly calls: FileReadPolicyInput[] = [];

  constructor(private readonly allowed: boolean) {}

  canRead(input: FileReadPolicyInput): Promise<boolean> {
    this.calls.push(input);
    return Promise.resolve(this.allowed);
  }
}

class RecordingReviewPolicy implements AdminMediaReviewPolicy {
  readonly calls: AdminMediaReviewInput[] = [];

  constructor(private readonly allowed: boolean) {}

  canReview(input: AdminMediaReviewInput): Promise<boolean> {
    this.calls.push(input);
    return Promise.resolve(this.allowed);
  }
}

interface Harness {
  readonly authorizer: FileAccessAuthorizer;
  readonly registered: RecordingReadPolicy;
  readonly other: RecordingReadPolicy;
  readonly defaultPolicy: RecordingReadPolicy;
  readonly reviewPolicy: RecordingReviewPolicy;
  readonly resolved: () => readonly ServiceIdentifier<FileReadPolicy>[];
}

interface HarnessOptions {
  readonly registeredAllows?: boolean;
  readonly defaultAllows?: boolean;
  readonly reviewAllows?: boolean;
}

function createHarness(options: HarnessOptions = {}): Harness {
  const registered = new RecordingReadPolicy(options.registeredAllows ?? true);
  const other = new RecordingReadPolicy(true);
  const defaultPolicy = new RecordingReadPolicy(options.defaultAllows ?? true);
  const reviewPolicy = new RecordingReviewPolicy(options.reviewAllows ?? true);
  const policies = new Map<ServiceIdentifier<FileReadPolicy>, FileReadPolicy>([
    [INQUIRY_POLICY, registered],
    [OTHER_POLICY, other],
  ]);
  const resolved: ServiceIdentifier<FileReadPolicy>[] = [];
  const authorizer = new PolicyFileAccessAuthorizer({
    registrations: [
      { purpose: 'inquiry-attachment', policy: INQUIRY_POLICY },
      { purpose: 'other-attachment', policy: OTHER_POLICY },
    ],
    resolveReadPolicy: (identifier) => {
      resolved.push(identifier);
      const policy = policies.get(identifier);
      if (policy === undefined) {
        throw new Error('未登録の方針です');
      }
      return policy;
    },
    defaultReadPolicy: defaultPolicy,
    adminReviewPolicy: reviewPolicy,
  });
  return {
    authorizer,
    registered,
    other,
    defaultPolicy,
    reviewPolicy,
    resolved: () => resolved,
  };
}

const CALLERS: readonly FileAccessCaller[] = ['client', 'admin'];

describe('PolicyFileAccessAuthorizer', () => {
  describe('ファイル用の用途', () => {
    test.each(CALLERS)(
      '呼び出し元が%sでも、用途に登録された方針を採用し、既定の方針と管理者の画像確認を呼ばない',
      async (caller) => {
        const harness = createHarness();
        const file = mediaFileViewOf({ purpose: 'inquiry-attachment' });

        const allowed = await harness.authorizer.canAccess({
          caller,
          principal: USER,
          file,
        });

        expect(allowed).toBe(true);
        expect(harness.registered.calls).toEqual([{ principal: USER, file }]);
        expect(harness.resolved()).toEqual([INQUIRY_POLICY]);
        expect(harness.other.calls).toEqual([]);
        expect(harness.defaultPolicy.calls).toEqual([]);
        expect(harness.reviewPolicy.calls).toEqual([]);
      },
    );

    test('登録された方針が拒否すれば、既定の方針が許可する保有者でも拒否する', async () => {
      const harness = createHarness({ registeredAllows: false });

      const allowed = await harness.authorizer.canAccess({
        caller: 'client',
        principal: USER,
        file: mediaFileViewOf({ purpose: 'inquiry-attachment' }),
      });

      expect(allowed).toBe(false);
      expect(harness.defaultPolicy.calls).toEqual([]);
    });

    test.each([true, false])(
      '方針の登録が無い用途では既定の方針の結果(%p)に従い、登録された方針を解決しない',
      async (defaultAllows) => {
        const harness = createHarness({ defaultAllows });
        const file = mediaFileViewOf({ purpose: 'unregistered-attachment' });

        const allowed = await harness.authorizer.canAccess({
          caller: 'admin',
          principal: ADMIN,
          file,
        });

        expect(allowed).toBe(defaultAllows);
        expect(harness.defaultPolicy.calls).toEqual([
          { principal: ADMIN, file },
        ]);
        expect(harness.resolved()).toEqual([]);
        expect(harness.reviewPolicy.calls).toEqual([]);
      },
    );

    test('方針は判定のときに解決し、組み立てのときには解決しない', () => {
      const harness = createHarness();

      expect(harness.resolved()).toEqual([]);
    });

    test('同じ用途を2回登録すると、組み立てのときに例外を投げる', () => {
      const build = (): FileAccessAuthorizer =>
        new PolicyFileAccessAuthorizer({
          registrations: [
            { purpose: 'inquiry-attachment', policy: INQUIRY_POLICY },
            { purpose: 'inquiry-attachment', policy: OTHER_POLICY },
          ],
          resolveReadPolicy: () => new RecordingReadPolicy(true),
          defaultReadPolicy: new RecordingReadPolicy(true),
          adminReviewPolicy: new RecordingReviewPolicy(true),
        });

      expect(build).toThrow(FileAccessRegistrationError);
      expect(build).toThrow('inquiry-attachment');
    });
  });

  describe('画像用の用途', () => {
    test.each([true, false])(
      '管理者側かつ管理者の主体だけが管理者の画像確認の方針に回り、その結果(%p)に従う',
      async (reviewAllows) => {
        const harness = createHarness({ reviewAllows });
        const file = imageFileViewOf();

        const allowed = await harness.authorizer.canAccess({
          caller: 'admin',
          principal: ADMIN,
          file,
        });

        expect(allowed).toBe(reviewAllows);
        expect(harness.reviewPolicy.calls).toEqual([
          { principal: ADMIN, file },
        ]);
        expect(harness.defaultPolicy.calls).toEqual([]);
        expect(harness.resolved()).toEqual([]);
      },
    );

    test.each<[string, FileAccessCaller, AuthenticatedPrincipal]>([
      ['利用者側からの保有者の利用者', 'client', USER],
      ['利用者側からの管理者の主体', 'client', ADMIN],
      ['管理者側からの利用者の主体', 'admin', USER],
    ])(
      '%sの要求は、方針を呼ばずに拒否する',
      async (_label, caller, principal) => {
        const harness = createHarness();
        const file = imageFileViewOf({
          owner: { kind: principal.subjectKind, id: principal.subjectId },
        });

        const allowed = await harness.authorizer.canAccess({
          caller,
          principal,
          file,
        });

        expect(allowed).toBe(false);
        expect(harness.reviewPolicy.calls).toEqual([]);
        expect(harness.defaultPolicy.calls).toEqual([]);
        expect(harness.resolved()).toEqual([]);
      },
    );

    test('用途の名前がファイル用の登録と同じでも、保存先が画像用なら登録された方針を使わない', async () => {
      const harness = createHarness();

      const allowed = await harness.authorizer.canAccess({
        caller: 'client',
        principal: USER,
        file: imageFileViewOf({ purpose: 'inquiry-attachment' }),
      });

      expect(allowed).toBe(false);
      expect(harness.registered.calls).toEqual([]);
    });
  });
});
