import type { SopListItem } from '../../services/v2-content.service';

type SopAsset = SopListItem['assetUrls'][number];
type PreviewAsset = Pick<SopAsset, 'asset_kind' | 'created_at' | 'object_path' | 'sort_order'>;

const newestFirst = (left: PreviewAsset, right: PreviewAsset) => right.created_at.localeCompare(left.created_at);

export const selectSopPreviewAsset = <Asset extends PreviewAsset>(assets: readonly Asset[]): Asset | null => {
  const cover = assets.filter((asset) => asset.asset_kind === 'cover' && asset.object_path).sort(newestFirst)[0];
  if (cover) return cover;

  return [...assets]
    .filter((asset) => asset.asset_kind === 'step' && asset.object_path)
    .sort((left, right) => right.sort_order - left.sort_order || newestFirst(left, right))[0] ?? null;
};

export const getSopPreviewAsset = (sop: Pick<SopListItem, 'assetUrls'>): SopAsset | null => {
  return selectSopPreviewAsset(sop.assetUrls);
};
