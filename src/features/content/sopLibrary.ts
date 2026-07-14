import type { SopLibraryEntry } from '../../services/v2-content.service';

export const filterAdminSops = <T extends { body: string; category: string; title: string }>(sops: T[], category: string, query: string) => {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  return sops.filter((sop) => {
    if (category !== 'all' && sop.category !== category) return false;
    return !normalizedQuery || [sop.title, sop.category, sop.body].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedQuery));
  });
};

export const filterSopLibrary = (sops: SopLibraryEntry[], input: { category: string; query: string }) => {
  const query = input.query.trim().toLocaleLowerCase('zh-CN');
  return sops.filter((sop) => {
    if (input.category !== 'all' && sop.category !== input.category) return false;
    return !query || sop.title.toLocaleLowerCase('zh-CN').includes(query);
  });
};
