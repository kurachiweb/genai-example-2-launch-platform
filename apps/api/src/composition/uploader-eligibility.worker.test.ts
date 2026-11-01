import { Container } from 'inversify';
import { describe, expect, test } from 'vitest';

import {
  UPLOAD_ACCESS_TYPES,
  type UploaderEligibility,
} from '../application/media/uploader-eligibility.ts';
import { AllowAllUploaderEligibility } from '../infrastructure/media/allow-all-uploader-eligibility.ts';
import { UPLOADER_ELIGIBILITY_BINDINGS } from './uploader-eligibility.ts';

describe('UPLOADER_ELIGIBILITY_BINDINGS', () => {
  test('アップロードできる利用者かの判定に、全許可の既定の実装を束縛する', () => {
    const container = new Container();
    container.load(UPLOADER_ELIGIBILITY_BINDINGS);

    const eligibility = container.get<UploaderEligibility>(
      UPLOAD_ACCESS_TYPES.UploaderEligibility,
    );

    expect(eligibility).toBeInstanceOf(AllowAllUploaderEligibility);
  });
});
