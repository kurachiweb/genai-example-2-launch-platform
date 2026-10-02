import type { ByeEntry } from '../-model';
import { ByeCard } from './bye-card';

type Props = { byes: ByeEntry[] };

export function ByeList({ byes }: Props) {
  if (byes.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
        不戦勝
      </h3>
      <div className="grid gap-3 xl:grid-cols-2">
        {byes.map((entry) => (
          <ByeCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
