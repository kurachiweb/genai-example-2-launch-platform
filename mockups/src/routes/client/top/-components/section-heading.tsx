import { ROUND_LABEL } from '#/components/client/match/model';
import type { Round } from '#/components/client/match/model';
import { Badge } from '#/components/ui/badge';

type Props = {
  id: string;
  icon: React.ReactNode;
  title: string;
  round?: Round;
  meta: React.ReactNode;
};

export function SectionHeading({ id, icon, title, round, meta }: Props) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b-2 border-primary/20 pb-2">
      <h2
        id={id}
        className="flex items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl"
      >
        {icon}
        {title}
        {round && (
          <Badge
            size="lg"
            className={`border-0 text-gold-foreground ${round === 'final' ? 'gold-gradient' : 'bg-silver'}`}
          >
            {ROUND_LABEL[round]}
          </Badge>
        )}
      </h2>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {meta}
      </p>
    </div>
  );
}
