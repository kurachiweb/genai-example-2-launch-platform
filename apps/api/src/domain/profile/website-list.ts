import { trimWhiteSpace } from '../../../common-lib/text/white-space.ts';

export interface WebsiteInput {
  readonly name: string | null;
  readonly url: string;
}

export interface NormalizedWebsite {
  readonly name: string | null;
  readonly url: string;
}

const normalizeName = (name: string | null): string | null => {
  if (name === null) {
    return null;
  }
  const trimmed = trimWhiteSpace(name);
  return trimmed.length === 0 ? null : trimmed;
};

export const normalizeWebsites = (
  input: readonly WebsiteInput[],
): readonly NormalizedWebsite[] =>
  input.map((website) => ({
    name: normalizeName(website.name),
    url: trimWhiteSpace(website.url),
  }));
