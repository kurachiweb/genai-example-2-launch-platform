export type SearchFieldFormat = 'plain' | 'markdown';

export interface SearchFieldSpec {
  readonly format: SearchFieldFormat;
  readonly textColumn: boolean;
  readonly extract: boolean;
}

export interface SearchTargetInfo<TField extends string = string> {
  readonly name: string;
  readonly fields: Readonly<Record<TField, SearchFieldSpec>>;
}

export interface SearchSource<TField extends string = string> {
  // 元データごとに単調増加する整数(更新日時のミリ秒など)。古い版の書き込みを無視する条件に使う
  readonly version: number;
  readonly fields: Readonly<Record<TField, string>>;
}

export const MAX_SEARCH_TARGET_NAME_LENGTH = 40;

const SEARCH_TARGET_NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/u;

export function isValidSearchTargetName(name: string): boolean {
  return SEARCH_TARGET_NAME_PATTERN.test(name);
}
