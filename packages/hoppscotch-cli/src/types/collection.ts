export type CollectionListItem = {
  id: string;
  name: string;
  path: string;
  requestCount: number;
  folderCount: number;
};

export type CollectionListResult = {
  ok: boolean;
  collectionType: "REST" | "GQL";
  collections: CollectionListItem[];
  errors?: string[];
};
