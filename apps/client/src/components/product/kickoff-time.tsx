import { KICKOFF_PREFIX } from './launch-messages.ts';
import { RemainingDateTime } from './remaining-date-time.tsx';

export interface KickoffTimeProps {
  readonly kickoffAt: string;
}

export function KickoffTime({ kickoffAt }: KickoffTimeProps) {
  return (
    <>
      {KICKOFF_PREFIX}
      <RemainingDateTime at={kickoffAt} />
    </>
  );
}
