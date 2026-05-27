import {
  HoppCollection,
  HoppRESTRequest,
  translateToNewRequest,
  generateUniqueRefId,
} from "@hoppscotch/data";

import { executeGraphQLWithAuth } from "./graphql";
import { GraphQLAuthTokens, GraphQLRequestOptions } from "../types/graphql";
import { CollectionListItem, CollectionListResult } from "../types/collection";

export type WorkspaceCollectionNode = {
  id?: string;
  _ref_id?: string;
  name: string;
  folders?: WorkspaceCollectionNode[];
  requests?: unknown[];
  data?: string | null;
};

type ResolvedCollectionMatch = {
  collection: HoppCollection;
  path: string;
};

type CollectionData = {
  auth: HoppCollection["auth"];
  headers: HoppCollection["headers"];
  variables: HoppCollection["variables"];
  description: HoppCollection["description"];
  preRequestScript: HoppCollection["preRequestScript"];
  testScript: HoppCollection["testScript"];
  _ref_id?: string;
};

const EXPORT_COLLECTIONS = /* GraphQL */ `
  query ExportUserCollectionsToJSON(
    $collectionID: ID
    $collectionType: ReqType!
  ) {
    exportUserCollectionsToJSON(
      collectionID: $collectionID
      collectionType: $collectionType
    ) {
      collectionType
      exportedCollection
    }
  }
`;

const EXPORT_TEAM_COLLECTIONS = /* GraphQL */ `
  query ExportTeamCollectionsToJSON($teamID: ID!) {
    exportCollectionsToJSON(teamID: $teamID)
  }
`;

const DEFAULT_COLLECTION_DATA: CollectionData = {
  auth: { authType: "inherit", authActive: true },
  headers: [],
  variables: [],
  description: null,
  preRequestScript: "",
  testScript: "",
};

const normalizePath = (value: string) => value.split("/").filter(Boolean).join("/");

const normalizeCollectionData = (data: string | null | undefined) => {
  if (!data || data === "null") return DEFAULT_COLLECTION_DATA;

  try {
    const parsed = JSON.parse(data) as Partial<CollectionData>;

    return {
      ...DEFAULT_COLLECTION_DATA,
      ...parsed,
      headers: parsed.headers ?? [],
      variables: parsed.variables ?? [],
    };
  } catch {
    return DEFAULT_COLLECTION_DATA;
  }
};

const normalizeRequest = (request: unknown) => {
  const parsedRequest = HoppRESTRequest.safeParse(request);
  if (parsedRequest.success) return parsedRequest.data;

  return translateToNewRequest(request);
};

const exportedCollectionToHoppCollection = (
  collection: WorkspaceCollectionNode
): HoppCollection => {
  const data = normalizeCollectionData(collection.data);

  return {
    v: 12,
    id: collection.id,
    _ref_id: collection._ref_id ?? data._ref_id ?? generateUniqueRefId("coll"),
    name: collection.name,
    folders: (collection.folders ?? []).map(exportedCollectionToHoppCollection),
    requests: (collection.requests ?? []).map(normalizeRequest),
    auth: data.auth,
    headers: data.headers,
    variables: data.variables,
    description: data.description,
    preRequestScript: data.preRequestScript,
    testScript: data.testScript,
  };
};

const parseExportedCollections = (exportedCollection: string) => {
  const parsed = JSON.parse(exportedCollection) as WorkspaceCollectionNode | WorkspaceCollectionNode[];
  return Array.isArray(parsed) ? parsed : [parsed];
};

export const loadWorkspaceCollectionsTree = async (
  options: GraphQLRequestOptions,
  teamID: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await executeGraphQLWithAuth<{
    exportCollectionsToJSON?: string;
  }>(EXPORT_TEAM_COLLECTIONS, { teamID }, options, onTokensRefreshed);

  if (result.errors?.length) {
    return {
      ok: false as const,
      collections: [],
      errors: result.errors.map((err) => err.message),
    };
  }

  const exportedCollection = result.data?.exportCollectionsToJSON ?? "[]";
  const parsedCollections = parseExportedCollections(exportedCollection);

  return {
    ok: true as const,
    collections: parsedCollections.map(exportedCollectionToHoppCollection),
  };
};

export const loadWorkspaceCollectionsTreeRaw = async (
  options: GraphQLRequestOptions,
  teamID: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await executeGraphQLWithAuth<{
    exportCollectionsToJSON?: string;
  }>(EXPORT_TEAM_COLLECTIONS, { teamID }, options, onTokensRefreshed);

  if (result.errors?.length) {
    return {
      ok: false as const,
      collections: [],
      errors: result.errors.map((err) => err.message),
    };
  }

  const exportedCollection = result.data?.exportCollectionsToJSON ?? "[]";

  return {
    ok: true as const,
    collections: parseExportedCollections(exportedCollection),
  };
};

const collectCollectionMatches = (
  collections: HoppCollection[],
  target: string,
  parentPath = "",
  matches: ResolvedCollectionMatch[] = []
) => {
  const normalizedTarget = normalizePath(target);

  for (const collection of collections) {
    const path = parentPath ? `${parentPath}/${collection.name}` : collection.name;
    const normalizedPath = normalizePath(path);
    const refId = (collection as HoppCollection & { _ref_id?: string })._ref_id;

    if (
      collection.id === target ||
      refId === target ||
      normalizedTarget === normalizedPath ||
      (!target.includes("/") && collection.name === target)
    ) {
      matches.push({ collection, path });
    }

    if (collection.folders.length > 0) {
      collectCollectionMatches(collection.folders, target, path, matches);
    }
  }

  return matches;
};

const resolveExactCollectionMatch = (
  matches: ResolvedCollectionMatch[],
  target: string
) => {
  const normalizedTarget = normalizePath(target);
  const exactMatches = matches
    .map((match, index) => ({
      ...match,
      index,
    }))
    .filter(({ collection, path }) => {
      const normalizedPath = normalizePath(path);
      const refId = (collection as HoppCollection & { _ref_id?: string })._ref_id;

      return (
        collection.id === target ||
        refId === target ||
        normalizedTarget === normalizedPath ||
        (!target.includes("/") && collection.name === target)
      );
    })
    .sort((a, b) => {
      const depthA = normalizePath(a.path).split("/").length;
      const depthB = normalizePath(b.path).split("/").length;

      if (depthA !== depthB) return depthA - depthB;

      const lenA = normalizePath(a.path).length;
      const lenB = normalizePath(b.path).length;
      if (lenA !== lenB) return lenA - lenB;

      return a.index - b.index;
    });

  return exactMatches[0] ?? null;
};

export const pickPreferredCollectionMatch = (
  matches: ResolvedCollectionMatch[],
  target: string
) => resolveExactCollectionMatch(matches, target);

export const findCollectionMatches = (
  collections: HoppCollection[],
  target: string
) => collectCollectionMatches(collections, target);

export const resolveCollectionByName = (
  collections: HoppCollection[],
  target: string
) => {
  const matches = findCollectionMatches(collections, target);

  if (matches.length === 0) {
    throw new Error(`Unable to find a collection matching "${target}".`);
  }

  if (matches.length > 1) {
    const exactMatch = resolveExactCollectionMatch(matches, target);

    if (exactMatch) {
      return exactMatch;
    }

    throw new Error(
      `Multiple collections match "${target}". Use a collection id or a full collection path instead.`
    );
  }

  return matches[0];
};

const flattenCollections = (
  collections: WorkspaceCollectionNode[],
  parentPath = ""
): CollectionListItem[] => {
  const items: CollectionListItem[] = [];

  for (const collection of collections) {
    const path = parentPath ? `${parentPath}/${collection.name}` : collection.name;
    const folders = collection.folders ?? [];
    const requests = collection.requests ?? [];

    items.push({
      id: collection.id,
      name: collection.name,
      path,
      requestCount: requests.length,
      folderCount: folders.length,
    });

    items.push(...flattenCollections(folders, path));
  }

  return items;
};

export const listCollections = async (
  options: GraphQLRequestOptions,
  collectionType: "REST" | "GQL" = "REST",
  teamID?: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
): Promise<CollectionListResult> => {
  const result = await executeGraphQLWithAuth<{
    exportUserCollectionsToJSON?: {
      collectionType: string;
      exportedCollection: string;
    };
    exportCollectionsToJSON?: string;
  }>(
    teamID ? EXPORT_TEAM_COLLECTIONS : EXPORT_COLLECTIONS,
    teamID ? { teamID } : { collectionID: null, collectionType },
    options,
    onTokensRefreshed
  );

  if (result.errors?.length) {
    return {
      ok: false,
      collectionType,
      collections: [],
      errors: result.errors.map((err) => err.message),
    };
  }

  const exportedCollection = teamID
    ? result.data?.exportCollectionsToJSON ?? "[]"
    : result.data?.exportUserCollectionsToJSON?.exportedCollection ?? "[]";

  const parsedCollections = parseExportedCollections(exportedCollection);

  return {
    ok: true,
    collectionType,
    collections: flattenCollections(parsedCollections),
  };
};
