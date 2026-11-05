import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import type { DashboardCard } from '../../composition/dashboard-cards.ts';
import { RecoverableSlot } from '../layout/recoverable-slot.tsx';
import { DASHBOARD_EMPTY_TITLE } from './dashboard-messages.ts';

export interface DashboardGridProps {
  readonly cards: readonly DashboardCard[];
}

const WIDTH_CLASS_NAMES: Readonly<Record<DashboardCard['width'], string>> =
  Object.freeze({
    full: 'md:col-span-2',
    half: '',
  });

// 1つのカードの描画や取得の失敗は、そのカードの位置に留めて他のカードの表示を続ける
export function DashboardGrid({ cards }: DashboardGridProps) {
  if (cards.length === 0) {
    return <EmptyState title={DASHBOARD_EMPTY_TITLE} />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {cards
        .toSorted((a, b) => a.order - b.order)
        .map(({ id, width, component: Card }) => (
          <div key={id} className={WIDTH_CLASS_NAMES[width]}>
            <RecoverableSlot className="h-full rounded-xl">
              <Card />
            </RecoverableSlot>
          </div>
        ))}
    </div>
  );
}
