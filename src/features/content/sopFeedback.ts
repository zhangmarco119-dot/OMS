export type SopSaveStage = 'saving' | 'uploading' | 'publishing';

export const formatSopActionError = (stage: SopSaveStage, error: unknown) => {
  const detail = error instanceof Error ? error.message : '未知错误';
  if (stage === 'uploading') return `SOP 草稿已保存，但图片上传失败：${detail}`;
  if (stage === 'publishing') return `SOP 草稿已保存，但发布失败：${detail}`;
  return `SOP 保存失败：${detail}`;
};
