import { getLogger, type Logger } from '@logtape/logtape';

export function getAppLogger(
  category: readonly [app: string, ...rest: string[]],
): Logger {
  return getLogger(category);
}
