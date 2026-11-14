export interface DisplayPreferences {
  readonly timeZone: string;
  readonly locale: string;
}

export const FALLBACK_DISPLAY_PREFERENCES = {
  timeZone: 'UTC',
  locale: 'ja-JP',
} as const satisfies DisplayPreferences;

export const supportedTimeZoneOf = (value: unknown): string | null => {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
};

export const supportedLocaleOf = (value: unknown): string | null => {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  try {
    const [locale] = Intl.DateTimeFormat.supportedLocalesOf(
      Intl.getCanonicalLocales(value),
    );
    // ブラウザが解決するロケールは拡張を持たず、要求の言語の設定の暦や数字の拡張をサーバー側の整形にだけ効かせると初期化の後に表示が切り替わるため、拡張と私用の部分を落とす
    return locale === undefined ? null : new Intl.Locale(locale).baseName;
  } catch {
    return null;
  }
};

export const toDisplayPreferences = (candidate: {
  readonly timeZone: unknown;
  readonly locale: unknown;
}): DisplayPreferences => ({
  timeZone:
    supportedTimeZoneOf(candidate.timeZone) ??
    FALLBACK_DISPLAY_PREFERENCES.timeZone,
  locale:
    supportedLocaleOf(candidate.locale) ?? FALLBACK_DISPLAY_PREFERENCES.locale,
});

export const resolveBrowserDisplayPreferences = (): DisplayPreferences => {
  const resolved = new Intl.DateTimeFormat().resolvedOptions();
  return toDisplayPreferences({
    timeZone: resolved.timeZone,
    locale: resolved.locale,
  });
};
