import { encode } from 'uqr';

import { cn } from '../../utilities/class-names.ts';

export interface TotpQrCodeProps {
  readonly uri: string;
  readonly label: string;
  readonly className?: string;
}

// QRコードの規格が四辺に求める明るい余白のセルの数
const QUIET_ZONE_CELLS = 4;

// 暗いセルを行ごとに横へ続く区間にまとめ、1セルの高さの長方形を並べた経路にする
const darkCellPath = (matrix: readonly (readonly boolean[])[]): string =>
  matrix
    .flatMap((row, y) => {
      const runs: string[] = [];
      let start = -1;
      for (let x = 0; x <= row.length; x += 1) {
        const dark = row[x] === true;
        if (dark && start < 0) {
          start = x;
        } else if (!dark && start >= 0) {
          const length = x - start;
          runs.push(
            `M${String(start)} ${String(y)}h${String(length)}v1h-${String(length)}z`,
          );
          start = -1;
        }
      }
      return runs;
    })
    .join('');

export function TotpQrCode({ uri, label, className }: TotpQrCodeProps) {
  const { size, data } = encode(uri, { ecc: 'M', border: QUIET_ZONE_CELLS });

  return (
    <svg
      data-slot="totp-qr-code"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      className={cn('size-48 shrink-0 rounded-md', className)}
    >
      <rect width={size} height={size} className="fill-qr-code-background" />
      <path d={darkCellPath(data)} className="fill-qr-code" />
    </svg>
  );
}
