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
