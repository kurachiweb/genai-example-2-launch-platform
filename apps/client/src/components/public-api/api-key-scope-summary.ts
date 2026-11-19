import {
  API_KEY_FEATURE_LABELS,
  API_KEY_FEATURES,
  API_KEY_LEVEL_LABELS,
  type ApiKeyScopes,
  type ApiKeyWriteLevel,
} from '../../../common-lib/public-api/api-key-rules.ts';
import { API_KEY_LIST_MESSAGES } from './api-key-list-messages.ts';

const SUMMARY_LEVELS: readonly Exclude<ApiKeyWriteLevel, 'none'>[] =
  Object.freeze(['read', 'read_write']);

// 値ごとに1行で、その値の機能の表示名を表示の順に並べる。全て無効なら「権限なし」の1行にする
export const apiKeyScopeSummaryOf = (
  scopes: ApiKeyScopes,
): readonly string[] => {
  const lines = SUMMARY_LEVELS.flatMap((level) => {
    const features = API_KEY_FEATURES.filter(
      (feature) => scopes[feature] === level,
    );
    return features.length === 0
      ? []
      : [
          `${API_KEY_LEVEL_LABELS[level]}: ${features
            .map((feature) => API_KEY_FEATURE_LABELS[feature])
            .join('、')}`,
        ];
  });
  return lines.length === 0 ? [API_KEY_LIST_MESSAGES.noScopes] : lines;
};
