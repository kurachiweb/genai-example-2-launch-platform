export interface RecordingOutput {
  readonly write: (text: string) => boolean;
  readonly text: () => string;
}

export const createRecordingOutput = (): RecordingOutput => {
  const chunks: string[] = [];
  return {
    write: (text) => {
      chunks.push(text);
      return true;
    },
    text: () => chunks.join(''),
  };
};
