import {
  type ContractViolation,
  formatViolationMarkdown,
  formatViolationTable,
} from '../../core/violation.ts';
import {
  type DeliveryDeps,
  EXIT_FAILURE,
  EXIT_SUCCESS,
} from './delivery-command.ts';

export function reportViolations(
  title: string,
  violations: readonly ContractViolation[],
  {
    stdout,
    stderr,
    github,
  }: Pick<DeliveryDeps, 'stdout' | 'stderr' | 'github'>,
): number {
  github.summary(formatViolationMarkdown(title, violations));
  const report = `${title}: ${formatViolationTable(violations)}`;
  if (violations.length === 0) {
    stdout.write(report);
    return EXIT_SUCCESS;
  }
  stderr.write(report);
  return EXIT_FAILURE;
}

const INPUT_ERRORS = '検査の入力を読み込めません。';

export function reportInputErrors(
  title: string,
  errors: readonly string[],
  { stderr, github }: Pick<DeliveryDeps, 'stderr' | 'github'>,
): number {
  const items = errors.map((error) => `- ${error}`);
  github.summary(
    [`### ${title}`, '', INPUT_ERRORS, '', ...items, ''].join('\n'),
  );
  stderr.write([`${title}: ${INPUT_ERRORS}`, ...items, ''].join('\n'));
  return EXIT_FAILURE;
}
