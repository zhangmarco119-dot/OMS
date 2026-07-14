import type { SopListItem } from '../../services/v2-content.service';

type SopAsset = SopListItem['assetUrls'][number];

const newestFirst = (left: SopAsset, right: SopAsset) => right.created_at.localeCompare(left.created_at);

export const getSopPreviewAsset = (sop: Pick<SopListItem, 'assetUrls'>): SopAsset | null => {
  const cover = sop.assetUrls.filter((asset) => asset.asset_kind === 'cover').sort(newestFirst)[0];
  if (cover) return cover;

  return [...sop.assetUrls]
    .filter((asset) => asset.asset_kind === 'step')
    .sort((left, right) => right.sort_order - left.sort_order || newestFirst(left, right))[0] ?? null;
};
