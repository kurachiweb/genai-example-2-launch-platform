export const MOVE_UP_LABEL = '上へ移動';

export const MOVE_DOWN_LABEL = '下へ移動';

export const moveUpName = (name: string): string => `${name}を${MOVE_UP_LABEL}`;

export const moveDownName = (name: string): string =>
  `${name}を${MOVE_DOWN_LABEL}`;

export const helpItemMovedAnnouncement = (
  name: string,
  position: number,
): string => `${name}を${String(position)}番目に移動しました。`;
