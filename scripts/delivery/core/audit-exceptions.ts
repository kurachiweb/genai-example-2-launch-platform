export interface AuditException {
  readonly advisory: string;
  readonly reason: string;
  readonly reviewBy: string;
}

export const AUDIT_EXCEPTIONS_FILE =
  'scripts/delivery/core/audit-exceptions.ts';

export const AUDIT_EXCEPTIONS: readonly AuditException[] = [];

export const AUDIT_LEVEL = 'critical';

const ADVISORY_PATTERN = /^(?:GHSA(?:-[0-9a-z]{4}){3}|\d+)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 2026-02-30のような存在しない日付は翌月へ繰り越されるため、戻した文字列と一致するかで確かめる
const isCalendarDate = (text: string): boolean => {
  if (!DATE_PATTERN.test(text)) return false;
  const time = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(text);
};

const problemsOf = (
  { advisory, reason, reviewBy }: AuditException,
  today: string,
): readonly string[] => {
  if (!ADVISORY_PATTERN.test(advisory)) {
    return ['識別子はGHSAの形式か数字にしてください。'];
  }
  return [
    ...(reason.trim() === '' ? ['除外の理由を書いてください。'] : []),
    ...(!isCalendarDate(reviewBy)
      ? [`見直し期限(${reviewBy})はYYYY-MM-DDの実在する日付にしてください。`]
      : reviewBy < today
        ? [`見直し期限(${reviewBy})を過ぎています。`]
        : []),
  ];
};

export function auditExceptionProblems(
  exceptions: readonly AuditException[],
  today: string,
): readonly string[] {
  const duplicated = new Set(
    exceptions
      .map(({ advisory }) => advisory)
      .filter((advisory, index, all) => all.indexOf(advisory) !== index),
  );
  return [
    ...exceptions.flatMap((exception) =>
      problemsOf(exception, today).map(
        (problem) => `${exception.advisory}: ${problem}`,
      ),
    ),
    ...[...duplicated].map((advisory) => `${advisory}: 除外が重複しています。`),
  ];
}

export function auditArgs(
  exceptions: readonly AuditException[],
): readonly string[] {
  return [
    'audit',
    `--audit-level=${AUDIT_LEVEL}`,
    ...exceptions.map(({ advisory }) => `--ignore=${advisory}`),
  ];
}
