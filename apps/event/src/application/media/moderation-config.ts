export const MODERATION_CATEGORIES = Object.freeze([
  'Explicit',
  'Non-Explicit Nudity of Intimate parts and Kissing',
  'Swimwear or Underwear',
  'Violence',
  'Visually Disturbing',
  'Drugs & Tobacco',
  'Alcohol',
  'Rude Gestures',
  'Gambling',
  'Hate Symbols',
] as const);

export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export interface ModerationConfig {
  readonly minConfidence: number;
  readonly blockedCategories: readonly string[];
}

export interface ModerationConfigVars {
  readonly MODERATION_MIN_CONFIDENCE: string;
  readonly MODERATION_BLOCKED_CATEGORIES: string;
}

const MIN_CONFIDENCE_PATTERN = /^\d+(?:\.\d+)?$/;
const MAX_CONFIDENCE = 100;
const CATEGORY_SEPARATOR = ',';

const isModerationCategory = (value: string): value is ModerationCategory =>
  (MODERATION_CATEGORIES as readonly string[]).includes(value);

const parseMinConfidence = (value: string): number => {
  const confidence = Number(value);
  if (!MIN_CONFIDENCE_PATTERN.test(value) || confidence > MAX_CONFIDENCE) {
    throw new Error(
      `MODERATION_MIN_CONFIDENCEは0〜${String(MAX_CONFIDENCE)}の数値で指定してください。`,
    );
  }
  return confidence;
};

const parseBlockedCategories = (value: string): readonly string[] => {
  const categories = value.split(CATEGORY_SEPARATOR).map((item) => item.trim());
  const invalid = categories.filter((item) => !isModerationCategory(item));
  if (invalid.length > 0) {
    throw new Error(
      `MODERATION_BLOCKED_CATEGORIESに判定サービスのカテゴリではない項目があります: ${JSON.stringify(invalid)}`,
    );
  }
  if (new Set(categories).size !== categories.length) {
    throw new Error('MODERATION_BLOCKED_CATEGORIESに重複した項目があります。');
  }
  return Object.freeze(categories);
};

export function parseModerationConfig(
  vars: ModerationConfigVars,
): ModerationConfig {
  return Object.freeze({
    minConfidence: parseMinConfidence(vars.MODERATION_MIN_CONFIDENCE),
    blockedCategories: parseBlockedCategories(
      vars.MODERATION_BLOCKED_CATEGORIES,
    ),
  });
}
