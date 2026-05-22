export const RagRooms = {
  doc: (docId: string): string => `doc:${docId}`,
  scoped: (sourceType: string, sourceId: string): string =>
    `${sourceType}:${sourceId}`,
};
