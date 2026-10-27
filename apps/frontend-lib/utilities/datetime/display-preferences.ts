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
    return locale ?? null;
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
