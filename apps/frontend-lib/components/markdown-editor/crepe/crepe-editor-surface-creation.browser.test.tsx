import type { MilkdownPlugin } from '@milkdown/kit/ctx';
import { CatchBoundary } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import type { EditorSurfaceProps } from '../editor-controller.ts';
import CrepeEditorSurface from './crepe-editor-surface.tsx';

const { creationFailures } = vi.hoisted(() => ({
  creationFailures: [] as Error[],
}));

// 実物の編集領域の作成を拒否させるため、編集領域が組み込むプラグインの末尾に、予約した失敗を作成の途中で投げるプラグインを加える
vi.mock('./cjk-remark-plugins.ts', async (importOriginal) => {
  const actual = await importOriginal<{
    readonly cjkRemarkPlugins: readonly MilkdownPlugin[];
  }>();
  const failReservedCreation: MilkdownPlugin = () => () => {
    const failure = creationFailures.shift();
    if (failure !== undefined) {
      throw failure;
    }
  };
  return {
    ...actual,
    cjkRemarkPlugins: [...actual.cjkRemarkPlugins, failReservedCreation],
  };
});

// 拒否された編集領域も、作成の途中で始めた表示の組み立てを続け、組み立てを終えた通知を後から届けようとするため、届くまで待つ
const LATE_NOTIFICATION_WAIT_MS = 300;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const surfaceProps = () => ({
  initialValue: '本文',
  editableId: 'editor-body',
  labelledBy: 'editor-label',
  describedBy: undefined,
  invalid: false,
  disabled: false,
  placeholder: '本文を入力してください',
  onReady: vi.fn<EditorSurfaceProps['onReady']>(),
  onMarkdownChange: vi.fn<EditorSurfaceProps['onMarkdownChange']>(),
  onActiveActionsChange: vi.fn<EditorSurfaceProps['onActiveActionsChange']>(),
  onBlur: vi.fn<EditorSurfaceProps['onBlur']>(),
  onRequestLink: vi.fn<EditorSurfaceProps['onRequestLink']>(),
});

function CaughtFailure() {
  return <p role="alert">描画の失敗</p>;
}

afterEach(() => {
  creationFailures.length = 0;
});

describe('CrepeEditorSurface', () => {
  describe('作成の拒否', () => {
    test('作成が拒否されると、拒否の理由を描画の失敗として外の境界へ投げ、拒否された編集領域からの通知を伝えない', async () => {
      const failure = new Error('編集領域の作成の失敗');
      creationFailures.push(failure);
      const onCatch = vi.fn<(error: unknown) => void>();
      const props = surfaceProps();

      await render(
        <>
          <span id="editor-label">本文</span>
          <CatchBoundary
            getResetKey={() => 0}
            errorComponent={CaughtFailure}
            onCatch={onCatch}
          >
            <CrepeEditorSurface {...props} />
          </CatchBoundary>
        </>,
      );

      await expect.element(page.getByRole('alert')).toBeInTheDocument();
      expect(onCatch).toHaveBeenCalledWith(failure, expect.anything());
      await sleep(LATE_NOTIFICATION_WAIT_MS);
      expect(props.onReady).not.toHaveBeenCalled();
      expect(props.onActiveActionsChange).not.toHaveBeenCalled();
      expect(props.onMarkdownChange).not.toHaveBeenCalled();
    });
  });
});
