// Bunの型定義ではrejectsのマッチャーがPromiseを返さず待てないため、拒否の理由を取り出して検証する
export const rejectionOf = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('拒否されるはずのPromiseが成功しました');
};
