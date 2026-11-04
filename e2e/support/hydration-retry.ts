// ハイドレーションの前に押したボタンは何もしないため、操作の効果が現れるまで押し直す。効果が現れるまでの短い待ちは、ハイドレーションの後の操作が同じ描画の中で表示を変えることによる
export const REACTION_TIMEOUT_MS = 2_000;

export const RETRY_TIMEOUT_MS = 20_000;
