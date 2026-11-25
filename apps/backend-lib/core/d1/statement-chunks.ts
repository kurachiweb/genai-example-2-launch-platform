// D1のバインド変数の上限(100)から、IDの一覧以外に使う変数の分を残した、1文で読むIDの数
export const IDS_PER_STATEMENT = 90;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}
