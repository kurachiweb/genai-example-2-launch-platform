import {
  type DisplayPreferences,
  supportedLocaleOf,
  toDisplayPreferences,
} from '../../utilities/datetime/display-preferences.ts';

export const MAX_ACCEPT_LANGUAGE_LENGTH = 1024;

export const MAX_ACCEPT_LANGUAGE_ENTRIES = 32;

const LIST_SEPARATOR = ',';

const WILDCARD_RANGE = '*';

const LANGUAGE_RANGE_ENTRY_PATTERN =
  /^([A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*|\*)(?:[ \t]*;[ \t]*[Qq]=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?$/;

interface WeightedLanguageRange {
  readonly range: string;
  readonly weight: number;
}

// 上限を超えた値は、上限の直後の文字まで読んで最後の区切りより後ろ(途中で切れた要素)を捨てる
const readableEntriesOf = (header: string): readonly string[] => {
  if (header.length <= MAX_ACCEPT_LANGUAGE_LENGTH) {
    return header.split(LIST_SEPARATOR, MAX_ACCEPT_LANGUAGE_ENTRIES);
  }
  const head = header.slice(0, MAX_ACCEPT_LANGUAGE_LENGTH + 1);
  return head
    .slice(0, Math.max(head.lastIndexOf(LIST_SEPARATOR), 0))
    .split(LIST_SEPARATOR, MAX_ACCEPT_LANGUAGE_ENTRIES);
};

const weightedRangeOf = (entry: string): WeightedLanguageRange | null => {
  const matched = LANGUAGE_RANGE_ENTRY_PATTERN.exec(entry.trim());
  if (matched?.[1] === undefined) {
    return null;
  }
  return {
    range: matched[1],
    weight: matched[2] === undefined ? 1 : Number(matched[2]),
  };
};

const preferredLocaleOf = (acceptLanguage: string | null): string | null => {
  if (acceptLanguage === null) {
    return null;
  }
  const candidates = readableEntriesOf(acceptLanguage)
    .map(weightedRangeOf)
    .filter(
      (candidate): candidate is WeightedLanguageRange =>
        candidate !== null &&
        candidate.weight > 0 &&
        candidate.range !== WILDCARD_RANGE,
    )
    .toSorted((left, right) => right.weight - left.weight);
  const triedRanges = new Set<string>();
  for (const { range } of candidates) {
    const key = range.toLowerCase();
    if (triedRanges.has(key)) {
      continue;
    }
    triedRanges.add(key);
    const locale = supportedLocaleOf(range);
    if (locale !== null) {
      return locale;
    }
  }
  return null;
};

export const resolveRequestDisplayPreferences = (input: {
  readonly cfTimeZone: unknown;
  readonly acceptLanguage: string | null;
}): DisplayPreferences =>
  toDisplayPreferences({
    timeZone: input.cfTimeZone,
    locale: preferredLocaleOf(input.acceptLanguage),
  });
