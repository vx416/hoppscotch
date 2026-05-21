import fs from "fs/promises";

import { executeGraphQLWithAuth } from "./graphql";
import {
  findCollectionMatches,
  loadWorkspaceCollectionsTree,
  pickPreferredCollectionMatch,
} from "./collection";
import { GraphQLAuthTokens, GraphQLRequestOptions } from "../types/graphql";
import { error } from "../types/errors";
import {
  getDefaultRESTRequest,
  HoppCollection,
  safelyExtractRESTRequest,
} from "@hoppscotch/data";

const CREATE_TEAM_ROOT_COLLECTION = /* GraphQL */ `
  mutation CreateTeamRootCollection($teamID: ID!, $title: String!, $data: String) {
    createRootCollection(teamID: $teamID, title: $title, data: $data) {
      id
      title
      data
      parentID
    }
  }
`;

const CREATE_TEAM_CHILD_COLLECTION = /* GraphQL */ `
  mutation CreateTeamChildCollection($collectionID: ID!, $title: String!, $data: String) {
    createChildCollection(collectionID: $collectionID, childTitle: $title, data: $data) {
      id
      title
      data
      parentID
    }
  }
`;

const CREATE_TEAM_REQUEST = /* GraphQL */ `
  mutation CreateTeamRequest($collectionID: ID!, $data: CreateTeamRequestInput!) {
    createRequestInCollection(
      collectionID: $collectionID
      data: $data
    ) {
      id
      title
      collectionID
      teamID
    }
  }
`;

const UPDATE_TEAM_REQUEST = /* GraphQL */ `
  mutation UpdateTeamRequest($requestID: ID!, $data: UpdateTeamRequestInput!) {
    updateRequest(requestID: $requestID, data: $data) {
      id
      title
      collectionID
      teamID
    }
  }
`;

const DELETE_TEAM_REQUEST = /* GraphQL */ `
  mutation DeleteTeamRequest($requestID: ID!) {
    deleteRequest(requestID: $requestID)
  }
`;

const UPDATE_TEAM_COLLECTION = /* GraphQL */ `
  mutation UpdateTeamCollection($collectionID: ID!, $newTitle: String, $data: String) {
    updateTeamCollection(
      collectionID: $collectionID
      newTitle: $newTitle
      data: $data
    ) {
      id
      title
      data
      parentID
    }
  }
`;

const DELETE_TEAM_COLLECTION = /* GraphQL */ `
  mutation DeleteTeamCollection($collectionID: ID!) {
    deleteCollection(collectionID: $collectionID)
  }
`;

const normalizePath = (value: string) => value.split("/").filter(Boolean).join("/");

const DEFAULT_COLLECTION_FIELDS: Pick<
  HoppCollection,
  | "auth"
  | "headers"
  | "variables"
  | "description"
  | "preRequestScript"
  | "testScript"
  | "requests"
  | "folders"
> = {
  auth: { authType: "inherit", authActive: true },
  headers: [],
  variables: [],
  description: null,
  preRequestScript: "",
  testScript: "",
  requests: [],
  folders: [],
};

const readStructuredInput = async (input?: string) => {
  if (!input) return undefined;

  try {
    await fs.access(input);
    return await fs.readFile(input, "utf8");
  } catch {
    try {
      return JSON.stringify(JSON.parse(input));
    } catch {
      throw error({
        code: "INVALID_ARGUMENT",
        data:
          "Expected a JSON string or a path to a JSON file. The provided value is not valid JSON.",
      });
    }
  }
};

const normalizeRequestInput = async (input: string, title?: string) => {
  const parsedRequest = JSON.parse(input);
  const normalizedRequest = safelyExtractRESTRequest(
    parsedRequest,
    getDefaultRESTRequest()
  );

  if (
    title &&
    (!normalizedRequest.name ||
      normalizedRequest.name.trim() === "" ||
      normalizedRequest.name.toLowerCase().startsWith("untitled"))
  ) {
    normalizedRequest.name = title;
  }

  return JSON.stringify(normalizedRequest);
};

const resolveTeamCollections = async (
  options: GraphQLRequestOptions,
  teamID: string,
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await loadWorkspaceCollectionsTree(options, teamID, onTokensRefreshed);

  if (!result.ok) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: result.errors.join("; "),
    });
  }

  return result.collections;
};

const resolveCollectionTarget = (
  collections: HoppCollection[],
  target: string
) => {
  const matches = findCollectionMatches(collections, target);

  if (matches.length === 0) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Unable to find a collection matching "${target}".`,
    });
  }

  if (matches.length > 1) {
    const preferred = pickPreferredCollectionMatch(matches, target);
    if (preferred) return preferred;

    throw error({
      code: "INVALID_ARGUMENT",
      data: `Multiple collections match "${target}". Use a collection id or a full collection path instead.`,
    });
  }

  return matches[0];
};

const buildCollectionNode = (collection: {
  id: string;
  title: string;
  data: string | null;
  parentID: string | null;
}): HoppCollection => ({
  v: 12,
  id: collection.id,
  name: collection.title,
  folders: [],
  requests: [],
  auth: DEFAULT_COLLECTION_FIELDS.auth,
  headers: [],
  variables: [],
  description: null,
  preRequestScript: "",
  testScript: "",
  _ref_id: collection.id,
});

const ensureCollectionPath = async (
  options: GraphQLRequestOptions,
  params: {
    teamID: string;
    path: string;
    data?: string;
  },
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const segments = normalizePath(params.path).split("/");
  if (segments.length === 0 || !segments[0]) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: "A collection path is required.",
    });
  }

  const data = await readStructuredInput(params.data);
  const collections = await resolveTeamCollections(
    options,
    params.teamID,
    onTokensRefreshed
  );

  let currentCollections = collections;
  let currentNode: HoppCollection | null = null;
  let currentPath = "";

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const matches = findCollectionMatches(currentCollections, currentPath);

    if (matches.length > 1) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: `Multiple collections match "${currentPath}". Use a collection id or a full collection path instead.`,
      });
    }

    if (matches.length === 1) {
      currentNode = matches[0].collection;
      currentCollections = currentNode.folders;
      continue;
    }

    const isRootLevel = currentNode === null;
    const createdCollection = isRootLevel
      ? await executeGraphQLWithAuth<{
          createRootCollection: {
            id: string;
            title: string;
            data: string | null;
            parentID: string | null;
          };
        }>(
          CREATE_TEAM_ROOT_COLLECTION,
          {
            teamID: params.teamID,
            title: segment,
            data: currentPath === params.path ? data : undefined,
          },
          options,
          onTokensRefreshed
        )
      : await executeGraphQLWithAuth<{
          createChildCollection: {
            id: string;
            title: string;
            data: string | null;
            parentID: string | null;
          };
        }>(
          CREATE_TEAM_CHILD_COLLECTION,
          {
            collectionID: currentNode.id,
            title: segment,
            data: currentPath === params.path ? data : undefined,
          },
          options,
          onTokensRefreshed
        );

    const created =
      createdCollection.data?.createRootCollection ??
      createdCollection.data?.createChildCollection;

    if (!created) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: `Failed to create collection "${currentPath}".`,
      });
    }

    currentNode = buildCollectionNode(created);
    currentCollections.push(currentNode);
    currentCollections = currentNode.folders;
  }

  if (!currentNode) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Failed to resolve collection path "${params.path}".`,
    });
  }

  return currentNode;
};

export const createTeamCollection = async (
  options: GraphQLRequestOptions,
  params: {
    teamID: string;
    title: string;
    data?: string;
    parentCollectionTarget?: string;
  },
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const data = await readStructuredInput(params.data);

  if (!params.parentCollectionTarget) {
    return ensureCollectionPath(
      options,
      {
        teamID: params.teamID,
        path: params.title,
        data,
      },
      onTokensRefreshed
    );
  }

  const collections = await resolveTeamCollections(
    options,
    params.teamID,
    onTokensRefreshed
  );
  const target = resolveCollectionTarget(
    collections,
    params.parentCollectionTarget
  );

  const createdCollection = await executeGraphQLWithAuth<{
    createChildCollection: {
      id: string;
      title: string;
      data: string | null;
      parentID: string | null;
    };
  }>(
    CREATE_TEAM_CHILD_COLLECTION,
    {
      collectionID: target.collection.id,
      title: params.title,
      data,
    },
    options,
    onTokensRefreshed
  );

  const created =
    createdCollection.data?.createChildCollection ?? null;

  if (!created) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Failed to create collection "${params.title}".`,
    });
  }

  return buildCollectionNode(created);
};

export const createTeamRequest = async (
  options: GraphQLRequestOptions,
  params: {
    teamID: string;
    collectionTarget: string;
    title: string;
    request: string;
  },
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const requestInput = await readStructuredInput(params.request);
  const request = requestInput
    ? await normalizeRequestInput(requestInput, params.title)
    : undefined;
  if (!request) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: "A request JSON string or file path is required.",
    });
  }

  const collections = await resolveTeamCollections(
    options,
    params.teamID,
    onTokensRefreshed
  );
  const target = resolveCollectionTarget(collections, params.collectionTarget);

  return executeGraphQLWithAuth<{
    createRequestInCollection: {
      id: string;
      title: string;
      collectionID: string;
      teamID: string;
    };
  }>(
    CREATE_TEAM_REQUEST,
    {
      collectionID: target.collection.id,
      data: {
        teamID: params.teamID,
        title: params.title,
        request,
      },
    },
    options,
    onTokensRefreshed
  );
};

export const updateTeamRequest = async (
  options: GraphQLRequestOptions,
  params: {
    requestID: string;
    title?: string;
    request?: string;
  },
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const requestInput = await readStructuredInput(params.request);
  const request = requestInput
    ? await normalizeRequestInput(requestInput)
    : undefined;

  if (!params.title && request === undefined) {
    throw error({
      code: "INVALID_ARGUMENT",
      data:
        "Provide a new request title, request JSON, or both when updating a request.",
    });
  }

  const result = await executeGraphQLWithAuth<{
    updateRequest: {
      id: string;
      title: string;
      collectionID: string;
      teamID: string;
    };
  }>(
    UPDATE_TEAM_REQUEST,
    {
      requestID: params.requestID,
      data: {
        title: params.title,
        request,
      },
    },
    options,
    onTokensRefreshed
  );

  const updated = result.data?.updateRequest ?? null;

  if (!updated) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Failed to update request "${params.requestID}".`,
    });
  }

  return updated;
};

export const updateTeamCollection = async (
  options: GraphQLRequestOptions,
  params: {
    teamID: string;
    collectionTarget: string;
    newTitle?: string;
    data?: string;
  },
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const data = await readStructuredInput(params.data);
  if (!params.newTitle && data === undefined) {
    throw error({
      code: "INVALID_ARGUMENT",
      data:
        "Provide a new title, collection metadata, or both when updating a collection.",
    });
  }

  const collections = await resolveTeamCollections(
    options,
    params.teamID,
    onTokensRefreshed
  );
  const target = resolveCollectionTarget(collections, params.collectionTarget);

  const result = await executeGraphQLWithAuth<{
    updateTeamCollection: {
      id: string;
      title: string;
      data: string | null;
      parentID: string | null;
    };
  }>(
    UPDATE_TEAM_COLLECTION,
    {
      collectionID: target.collection.id,
      newTitle: params.newTitle ?? null,
      data,
    },
    options,
    onTokensRefreshed
  );

  const updated = result.data?.updateTeamCollection ?? null;

  if (!updated) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Failed to update collection "${params.collectionTarget}".`,
    });
  }

  return buildCollectionNode(updated);
};

export const deleteTeamCollection = async (
  options: GraphQLRequestOptions,
  params: {
    teamID: string;
    collectionTarget: string;
  },
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const collections = await resolveTeamCollections(
    options,
    params.teamID,
    onTokensRefreshed
  );
  const target = resolveCollectionTarget(collections, params.collectionTarget);

  const result = await executeGraphQLWithAuth<{
    deleteCollection: boolean;
  }>(
    DELETE_TEAM_COLLECTION,
    {
      collectionID: target.collection.id,
    },
    options,
    onTokensRefreshed
  );

  if (result.data?.deleteCollection !== true) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Failed to delete collection "${params.collectionTarget}".`,
    });
  }

  return {
    deleted: true,
    id: target.collection.id,
    name: target.collection.name,
  };
};

export const deleteTeamRequest = async (
  options: GraphQLRequestOptions,
  params: {
    requestID: string;
  },
  onTokensRefreshed?: (tokens: GraphQLAuthTokens) => Promise<void> | void
) => {
  const result = await executeGraphQLWithAuth<{
    deleteRequest: boolean;
  }>(
    DELETE_TEAM_REQUEST,
    {
      requestID: params.requestID,
    },
    options,
    onTokensRefreshed
  );

  if (result.data?.deleteRequest !== true) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Failed to delete request "${params.requestID}".`,
    });
  }

  return {
    deleted: true,
    requestID: params.requestID,
  };
};

export const normalizeCollectionTarget = normalizePath;
