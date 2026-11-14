import { injectable } from 'inversify';

import {
  createUniformRandomSource,
  type RandomSource,
} from '../../../lib/core/match/qualifier-pairing.ts';

// 1要素の配列から必ず値が取れる。取れなければNaNを渡し、棄却法の部品の検証で例外にする
function nextUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1)).at(0) ?? Number.NaN;
}

// 組み合わせを利用者や投稿者が予測・操作できないよう、暗号論的な乱数を使う
@injectable()
export class CryptoRandomSource implements RandomSource {
  private readonly source = createUniformRandomSource(nextUint32);

  nextInt(exclusiveMax: number): number {
    return this.source.nextInt(exclusiveMax);
  }
}
