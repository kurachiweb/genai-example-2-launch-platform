// 画面の配色の一覧は、紐付けを解除した側の0と、プロダクトに割り当てる1〜TEAM_COLOR_COUNTの番号を持つ
export const TEAM_COLOR_COUNT = 12;

export const UNLINKED_TEAM_COLOR_INDEX = 0;

const HASH_MULTIPLIER = 31;

const hashOf = (seed: string): number => {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * HASH_MULTIPLIER + (character.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
};

// 画像を解析せず、プロダクトのIDだけから決定論的に選ぶ
export function teamColorIndexOf(productId: string | null): number {
  if (productId === null) {
    return UNLINKED_TEAM_COLOR_INDEX;
  }
  return (hashOf(productId) % TEAM_COLOR_COUNT) + 1;
}
