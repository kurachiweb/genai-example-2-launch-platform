// graphql-yogaが読み込む@whatwg-node/fetchの型宣言は`/// <reference lib="dom" />`でDOMの型を加え、Workersの型の`Request`・`BufferSource`などと食い違うため、tsconfigの`paths`で同じ公開の型をWorkersのグローバルから示すこの宣言へ差し替える
// esbuild・Bun・Viteは実行時に宣言ファイルへ解決せず、本物のパッケージを読み込む
// 公開する名前で宣言するとモジュール内でグローバルの同名の型を隠すため、別名で宣言してから公開する名前へ付け替える

export interface FormDataLimits {
  fieldNameSize?: number;
  fieldSize?: number;
  fields?: number;
  fileSize?: number;
  files?: number;
  parts?: number;
  headerSize?: number;
}

interface WorkersFetchApi {
  fetch: typeof fetch;
  Request: typeof Request;
  Response: typeof Response;
  Headers: typeof Headers;
  FormData: typeof FormData;
  ReadableStream: typeof ReadableStream;
  WritableStream: typeof WritableStream;
  TransformStream: typeof TransformStream;
  CompressionStream: typeof CompressionStream;
  DecompressionStream: typeof DecompressionStream;
  TextDecoderStream: typeof TextDecoderStream;
  TextEncoderStream: typeof TextEncoderStream;
  Blob: typeof Blob;
  File: typeof File;
  crypto: typeof crypto;
  btoa: typeof btoa;
  TextEncoder: typeof TextEncoder;
  TextDecoder: typeof TextDecoder;
  URLPattern: typeof URLPattern;
  URL: typeof URL;
  URLSearchParams: typeof URLSearchParams;
}

declare const workersFetch: WorkersFetchApi['fetch'];
declare const workersRequest: WorkersFetchApi['Request'];
declare const workersResponse: WorkersFetchApi['Response'] & {
  json(data: unknown, init?: ResponseInit): Response;
};
declare const workersHeaders: WorkersFetchApi['Headers'];
declare const workersFormData: WorkersFetchApi['FormData'];
declare const workersReadableStream: WorkersFetchApi['ReadableStream'];
declare const workersWritableStream: WorkersFetchApi['WritableStream'];
declare const workersTransformStream: WorkersFetchApi['TransformStream'];
declare const workersCompressionStream: WorkersFetchApi['CompressionStream'];
declare const workersDecompressionStream: WorkersFetchApi['DecompressionStream'];
declare const workersTextDecoderStream: WorkersFetchApi['TextDecoderStream'];
declare const workersTextEncoderStream: WorkersFetchApi['TextEncoderStream'];
declare const workersBlob: WorkersFetchApi['Blob'];
declare const workersFile: WorkersFetchApi['File'];
declare const workersCrypto: WorkersFetchApi['crypto'];
declare const workersBtoa: WorkersFetchApi['btoa'];
declare const workersTextDecoder: WorkersFetchApi['TextDecoder'];
declare const workersTextEncoder: WorkersFetchApi['TextEncoder'];
declare const workersUrl: WorkersFetchApi['URL'];
declare const workersUrlSearchParams: WorkersFetchApi['URLSearchParams'];
declare const workersUrlPattern: WorkersFetchApi['URLPattern'];
declare const createFetch: (opts?: {
  useNodeFetch?: boolean;
  formDataLimits?: FormDataLimits;
  skipPonyfill?: boolean;
}) => WorkersFetchApi;

export {
  createFetch,
  workersBlob as Blob,
  workersBtoa as btoa,
  workersCompressionStream as CompressionStream,
  workersCrypto as crypto,
  workersDecompressionStream as DecompressionStream,
  workersFetch as fetch,
  workersFile as File,
  workersFormData as FormData,
  workersHeaders as Headers,
  workersReadableStream as ReadableStream,
  workersRequest as Request,
  workersResponse as Response,
  workersTextDecoder as TextDecoder,
  workersTextDecoderStream as TextDecoderStream,
  workersTextEncoder as TextEncoder,
  workersTextEncoderStream as TextEncoderStream,
  workersTransformStream as TransformStream,
  workersUrl as URL,
  workersUrlPattern as URLPattern,
  workersUrlSearchParams as URLSearchParams,
  workersWritableStream as WritableStream,
};
