import { toBusinessDateTime } from '../../time/business-time.ts';

export function toIsoUtc(instant: Date): string {
  return instant.toISOString();
}

export function toIsoUtcOrNull(instant: Date | null): string | null {
  return instant === null ? null : toIsoUtc(instant);
}

export function toBusinessDate(instant: Date): string {
  return toBusinessDateTime(instant).date;
}
