import { useEffect, useRef, useState } from 'react';

import {
  type MediaType,
  parseMediaType,
} from '../../../common-lib/media/media-types.ts';
import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import { reportUnexpectedErrorInBrowser } from '../../start/observability/browser-error-reporting.ts';
import { errorMessageOf } from '../../utilities/graphql/graphql-result.ts';
import type { UploadConstraints } from '../../utilities/media/upload-constraints.ts';
import {
  sendUpload,
  type UploadFetch,
} from '../../utilities/media/upload-request.ts';

export interface FileUploadOptions {
  readonly constraints: UploadConstraints;
  // 問い合わせの画面への導線を持つか。利用者側はCLIENT_PROFILE.contactAvailable、管理者側はADMIN_PROFILE.contactAvailableを渡す
  readonly contactAvailable: boolean;
  // 送信できたファイル。失敗で止まった時もそれまでに送れた分を渡し、再試行で送れた残りは改めて渡す
  readonly onUploaded: (files: readonly UploadedFile[]) => void;
}

// completedは始めたファイルのうち送信できた件数で、再試行しても数え直さない
export type FileUploadState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'uploading';
      readonly fileName: string;
      readonly completed: number;
    }
  | { readonly status: 'uploaded'; readonly files: readonly UploadedFile[] }
  | {
      readonly status: 'failed';
      readonly message: string;
      readonly retryable: boolean;
      readonly completed: number;
    };

export interface FileUpload {
  readonly state: FileUploadState;
  // 選んだファイルを1件ずつ順に送る。送信中は受け付けない
  readonly start: (files: readonly File[]) => void;
  // 再試行できる失敗の後、失敗したファイルから送り直す
  readonly retry: () => void;
  readonly reset: () => void;
}

interface SendableFile {
  readonly file: File;
  readonly contentType: MediaType;
}

interface Batch {
  readonly files: readonly SendableFile[];
  readonly uploaded: readonly UploadedFile[];
}

const IDLE: FileUploadState = { status: 'idle' };

// 大域のfetchを送る時点で読み、テストが差し替えた偽物も使えるようにする
const browserFetch: UploadFetch = async (input, init) => fetch(input, init);

const sendableOf = (file: File): SendableFile => {
  const contentType = parseMediaType(file.type);
  if (contentType === undefined) {
    throw new TypeError(
      `許可形式でないファイルは送れません。選択の検査を済ませてから渡してください: ${file.type}`,
    );
  }
  return { file, contentType };
};

export function useFileUpload({
  constraints,
  contactAvailable,
  onUploaded,
}: FileUploadOptions): FileUpload {
  const [state, setState] = useState<FileUploadState>(IDLE);
  const batchRef = useRef<Batch | undefined>(undefined);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const onUploadedRef = useRef(onUploaded);

  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const run = async (batch: Batch, signal: AbortSignal): Promise<void> => {
    const uploaded = [...batch.uploaded];
    const sentFromHere: UploadedFile[] = [];
    for (const { file, contentType } of batch.files.slice(uploaded.length)) {
      setState({
        status: 'uploading',
        fileName: file.name,
        completed: uploaded.length,
      });
      const result = await sendUpload(
        browserFetch,
        {
          purpose: constraints.purpose,
          body: file,
          contentType,
          fileName: file.name,
        },
        { constraints, contactAvailable, signal },
      );
      if (!result.ok) {
        if (result.unexpectedError !== undefined) {
          reportUnexpectedErrorInBrowser(result.unexpectedError, 'render');
        }
        batchRef.current = result.retryable
          ? { files: batch.files, uploaded }
          : undefined;
        if (sentFromHere.length > 0) {
          onUploadedRef.current(sentFromHere);
        }
        setState({
          status: 'failed',
          message: result.message,
          retryable: result.retryable,
          completed: uploaded.length,
        });
        return;
      }
      uploaded.push(result.file);
      sentFromHere.push(result.file);
    }
    batchRef.current = undefined;
    onUploadedRef.current(sentFromHere);
    setState({ status: 'uploaded', files: uploaded });
  };

  const launch = (batch: Batch): void => {
    const controller = new AbortController();
    controllerRef.current = controller;
    void run(batch, controller.signal)
      .catch((error: unknown) => {
        // 外された部品の送信を中断した時は、結果を画面へ反映しない
        if (controller.signal.aborted) {
          return;
        }
        reportUnexpectedErrorInBrowser(error, 'render');
        batchRef.current = undefined;
        setState({
          status: 'failed',
          message: errorMessageOf(error, contactAvailable),
          retryable: false,
          completed: 0,
        });
      })
      .finally(() => {
        if (controllerRef.current === controller) {
          controllerRef.current = undefined;
        }
      });
  };

  const sending = (): boolean => controllerRef.current !== undefined;

  return {
    state,
    start: (files) => {
      if (sending()) {
        return;
      }
      launch({ files: files.map(sendableOf), uploaded: [] });
    },
    retry: () => {
      const batch = batchRef.current;
      if (sending() || batch === undefined) {
        return;
      }
      launch(batch);
    },
    reset: () => {
      if (sending()) {
        return;
      }
      batchRef.current = undefined;
      setState(IDLE);
    },
  };
}
