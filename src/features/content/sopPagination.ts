export const appendSopPage = <T extends { id: string }>(
  current: T[],
  incoming: T[],
  requestedOffset: number,
  total: number,
) => {
  const knownIds = new Set(current.map((entry) => entry.id));
  const uniqueIncoming = incoming.filter((entry) => {
    if (knownIds.has(entry.id)) return false;
    knownIds.add(entry.id);
    return true;
  });
  const nextOffset = requestedOffset + incoming.length;
  return {
    hasMore: incoming.length > 0 && nextOffset < total,
    items: [...current, ...uniqueIncoming],
    nextOffset,
  };
};
