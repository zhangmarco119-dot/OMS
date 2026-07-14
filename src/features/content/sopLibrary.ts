import type { SopLibraryEntry } from '../../services/v2-content.service';

export const filterSopLibrary = (sops: SopLibraryEntry[], input: { category: string; query: string }) => {
  const query = input.query.trim().toLocaleLowerCase('zh-CN');
  return sops.filter((sop) => {
    if (input.category !== 'all' && sop.category !== input.category) return false;
    return !query || sop.title.toLocaleLowerCase('zh-CN').includes(query);
  });
};
