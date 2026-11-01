import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import {
  ATTACHMENT_MEDIA_TYPES,
  IMAGE_MEDIA_TYPES,
  MAX_UPLOAD_BYTES,
} from '../../../common-lib/media/media-types.ts';
import {
  defineUploadPurpose,
  type UploadPurpose,
} from '../../../lib/core/media/upload-purpose.ts';
import {
  UPLOAD_ACCESS_TYPES,
  type UploaderEligibility,
} from '../../application/media/uploader-eligibility.ts';
import type { AuthenticatedPrincipal } from '../../application/session/session-verifier.ts';
import type { SessionView } from '../../application/session/session-view.ts';
import { AllowAllUploaderEligibility } from './allow-all-uploader-eligibility.ts';

const IMAGE_PURPOSE: UploadPurpose = defineUploadPurpose({
  name: 'product-image',
  storage: 'images',
  uploaderKinds: ['user'],
  allowedTypes: IMAGE_MEDIA_TYPES,
  maxBytes: 5_242_880,
});

const FILE_PURPOSE: UploadPurpose = defineUploadPurpose({
  name: 'inquiry-attachment',
  storage: 'files',
  uploaderKinds: ['user'],
  allowedTypes: ATTACHMENT_MEDIA_TYPES,
  maxBytes: MAX_UPLOAD_BYTES,
});

const PRINCIPAL: AuthenticatedPrincipal = Object.freeze({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: '01JC0USER00000000000000001',
  sessionId: '01JC0SESSION0000000000001',
});

interface RecordingSession {
  readonly session: SessionView;
  readonly calls: () => number;
}

// 既定の実装がセッションを参照しない(検証を起こさない)ことを確かめるため、呼び出しを数える
function recordingSession(): RecordingSession {
  let calls = 0;
  return {
    session: {
      principal: () => {
        calls += 1;
        return Promise.resolve(PRINCIPAL);
      },
    },
    calls: () => calls,
  };
}

describe('AllowAllUploaderEligibility', () => {
  test.each([
    ['画像用', IMAGE_PURPOSE],
    ['ファイル用', FILE_PURPOSE],
  ])(
    '%sの用途で、利用者のアップロードを常に許可し、セッションを参照しない',
    async (_label, purpose) => {
      const eligibility: UploaderEligibility =
        new AllowAllUploaderEligibility();
      const { session, calls } = recordingSession();

      const decision = await eligibility.check({
        session,
        principal: PRINCIPAL,
        purpose,
      });

      expect(decision).toEqual({ allowed: true });
      expect(calls()).toBe(0);
    },
  );

  test('差し込み口の識別子に束縛すると、コンテナから解決した実装も許可する', async () => {
    const container = new Container();
    container
      .bind<UploaderEligibility>(UPLOAD_ACCESS_TYPES.UploaderEligibility)
      .to(AllowAllUploaderEligibility);

    const decision = await container
      .get<UploaderEligibility>(UPLOAD_ACCESS_TYPES.UploaderEligibility)
      .check({
        session: recordingSession().session,
        principal: PRINCIPAL,
        purpose: IMAGE_PURPOSE,
      });

    expect(decision).toEqual({ allowed: true });
  });
});
