import { describe, expect, test } from 'vitest';

import { INPUT_MESSAGES as GRAPHQL_PROFILE_MESSAGES } from '../../../graphql/modules/profile/errors.ts';
import { PROFILE_FIELD_MESSAGES } from './profiles.ts';

// GraphQLの表現層は単体テストのカバレッジの分母に入れないため、写しの照合はWorkers統合テストで行う
describe('PROFILE_FIELD_MESSAGES', () => {
  test.each(
    Object.keys(
      PROFILE_FIELD_MESSAGES,
    ) as (keyof typeof PROFILE_FIELD_MESSAGES)[],
  )('%sはGraphQLのプロフィールの保存と同じ文言を使う', (key) => {
    expect(PROFILE_FIELD_MESSAGES[key]).toBe(GRAPHQL_PROFILE_MESSAGES[key]);
  });
});
