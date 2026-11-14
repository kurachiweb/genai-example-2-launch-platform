// 安全でない文脈や権限の拒否ではクリップボードのAPIが無いか書き込みが拒まれるため、どちらも失敗として扱う
export const writeToClipboard = async (text: string): Promise<boolean> => {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (clipboard === undefined) {
    return false;
  }
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};
