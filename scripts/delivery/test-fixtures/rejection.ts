// Bunの型定義ではrejectsのマッチャーがPromiseを返さず待てないため、拒否の理由を取り出して検証する
export const rejectionMessageOf = async (
  promise: Promise<unknown>,
): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('拒否されるはずのPromiseが成功しました');
};
