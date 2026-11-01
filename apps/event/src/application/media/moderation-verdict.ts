import type { ModerationFinding } from '../../../lib/core/media/media-file.ts';
import type { ModerationConfig } from './moderation-config.ts';
import type { ModerationLabel } from './ports.ts';

export type ModerationVerdict =
  | { readonly verdict: 'passed' }
  | {
      readonly verdict: 'flagged';
      readonly findings: readonly ModerationFinding[];
    };

// 判定サービスは下位のラベルとともに祖先も返すが、親が応答に無い場合への防御として、その親の名前を最上位とみなす(第3階層だけが返り第2階層が欠けた場合は最上位を求められない)
const topCategoryOf = (
  label: ModerationLabel,
  parents: ReadonlyMap<string, string>,
): string => {
  const visited = new Set<string>();
  let current = label.name;
  let parent = label.parentName;
  while (parent !== '' && !visited.has(current)) {
    visited.add(current);
    current = parent;
    parent = parents.get(current) ?? '';
  }
  return current;
};

export function judgeLabels(
  labels: readonly ModerationLabel[],
  config: ModerationConfig,
): ModerationVerdict {
  const parents = new Map(
    labels.map((label) => [label.name, label.parentName] as const),
  );
  const blocked = new Set(config.blockedCategories);
  const findings = labels.flatMap((label): ModerationFinding[] => {
    const category = topCategoryOf(label, parents);
    if (!blocked.has(category) || label.confidence < config.minConfidence) {
      return [];
    }
    return [
      {
        source: 'labels',
        category,
        label: label.name,
        confidence: label.confidence,
      },
    ];
  });
  return findings.length === 0
    ? { verdict: 'passed' }
    : { verdict: 'flagged', findings };
}
