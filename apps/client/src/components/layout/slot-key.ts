import type { ComponentType } from 'react';

const slotKeys = new WeakMap<ComponentType, string>();

let issuedKeyCount = 0;

// 区画の配列の位置をkeyにすると静的解析が並べ替えでの状態の取り違えとして警告するため、部品ごとに固定の値を割り当てる。同じ配列に同じ部品を2回登録しない前提
export function slotKeyOf(component: ComponentType): string {
  const existing = slotKeys.get(component);
  if (existing !== undefined) {
    return existing;
  }
  issuedKeyCount += 1;
  const key = `slot-${String(issuedKeyCount)}`;
  slotKeys.set(component, key);
  return key;
}
