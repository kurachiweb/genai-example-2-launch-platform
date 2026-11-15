export const yearInTimeZone = (at: Date, timeZone: string): number =>
  Number(
    new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(at),
  );
