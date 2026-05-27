import { Command } from "commander";
import fs from "fs/promises";

import { handleError } from "../handlers/error";
import { parseDelayOption } from "../options/test/delay";
import { RequestRunCmdOptions } from "../types/commands";
import { error } from "../types/errors";
import { isHoppCLIError } from "../utils/checks";
import { resolveCliRuntimeConfig, updateCliConfig } from "../utils/config";
import { refreshGraphQLTokens } from "../utils/graphql";
import {
  findCollectionMatches,
  loadWorkspaceCollectionsTree,
  loadWorkspaceCollectionsTreeRaw,
  pickPreferredCollectionMatch,
  WorkspaceCollectionNode,
} from "../utils/collection";
import { parseCollectionData } from "../utils/mutators";
import { loadRequestEnvironments } from "../utils/environment";
import { preRequestScriptRunner } from "../utils/pre-request";
import {
  createRequest,
  delayPromiseFunction,
  requestRunner,
} from "../utils/request";
import {
  listRequestContexts,
  resolveRequestContext,
} from "../utils/request-resolver";
import {
  createTeamRequest,
  deleteTeamRequest,
  updateTeamRequest,
} from "../utils/workspace-mutations";

const printJson = (value: unknown) => {
  console.log(JSON.stringify(value, null, 2));
};

const printStep = (message: string) => {
  console.log(`[request] ${message}`);
};

const printVerboseJson = (label: string, value: unknown) => {
  console.log(`[request] ${label}`);
  console.log(JSON.stringify(value, null, 2));
};

const describeBody = (body: unknown) => {
  if (body instanceof FormData) {
    return Array.from(body.entries()).map(([key, value]) => ({
      key,
      value: value instanceof File ? `[File ${value.name}]` : String(value),
    }));
  }

  if (body instanceof Blob) {
    return `[Blob ${body.type || "application/octet-stream"} ${body.size} bytes]`;
  }

  return body;
};

const resolveRuntime = async (options: {
  server?: string;
  token?: string;
  refreshToken?: string;
  teamId?: string;
  collectionId?: string;
  environmentId?: string;
  team?: string;
}) =>
  resolveCliRuntimeConfig({
    server: options.server,
    token: options.token,
    refreshToken: options.refreshToken,
    teamId: options.teamId ?? options.team,
    collectionId: options.collectionId,
    environmentId: options.environmentId,
  });

const isExpiredAccessTokenError = (error: unknown) =>
  isHoppCLIError(error) &&
  (error.code === "TOKEN_EXPIRED" || error.code === "TOKEN_INVALID");

const refreshRuntimeTokens = async (params: {
  serverUrl?: string;
  token?: string;
  refreshToken?: string;
}) => {
  const refreshResult = await refreshGraphQLTokens({
    serverUrl: params.serverUrl,
    token: params.token,
    refreshToken: params.refreshToken,
  });

  if (!refreshResult.ok) {
    throw error({
      code: "TOKEN_INVALID",
      data: refreshResult.error,
    });
  }

  await updateCliConfig({
    server: refreshResult.serverUrl,
    token: refreshResult.tokens.token,
    refreshToken: refreshResult.tokens.refreshToken,
  });

  return refreshResult.tokens;
};

const pathExists = async (pathOrId: string) => {
  try {
    await fs.access(pathOrId);
    return true;
  } catch {
    return false;
  }
};

const loadWorkspaceCollections = async (
  pathOrId: string,
  runtime: Awaited<ReturnType<typeof resolveRuntime>>,
  options: RequestRunCmdOptions
) => {
  if (await pathExists(pathOrId)) {
    return parseCollectionData(pathOrId, {});
  }

  const serverUrl = runtime.server ?? options.server;
  let token = runtime.token ?? options.token;
  const refreshToken = runtime.refreshToken ?? options.refreshToken;
  const teamID = options.teamId ?? runtime.teamId;

  if (!teamID) {
    throw error({
      code: "INVALID_ARGUMENT",
      data:
        "A team id is required to resolve workspace collections over GraphQL. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
    });
  }

  const fetchCollections = () =>
    loadWorkspaceCollectionsTree(
      {
        serverUrl: serverUrl ?? "",
        token,
        refreshToken,
      },
      teamID
    );

  try {
    const teamCollectionsResult = await fetchCollections();
    if (!teamCollectionsResult.ok) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: teamCollectionsResult.errors.join("; "),
      });
    }

    const matches = findCollectionMatches(
      teamCollectionsResult.collections,
      pathOrId
    );

    if (matches.length === 0) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: `Unable to find a collection matching "${pathOrId}".`,
      });
    }

    if (matches.length > 1) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: `Multiple collections match "${pathOrId}". Use a collection id or a full collection path instead.`,
      });
    }

    return [matches[0].collection];
  } catch (err) {
    if (!refreshToken || !isExpiredAccessTokenError(err)) {
      throw err;
    }

    const refreshedTokens = await refreshRuntimeTokens({
      serverUrl,
      token,
      refreshToken,
    });
    token = refreshedTokens.token;

    const teamCollectionsResult = await fetchCollections();
    if (!teamCollectionsResult.ok) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: teamCollectionsResult.errors.join("; "),
      });
    }

    const matches = findCollectionMatches(
      teamCollectionsResult.collections,
      pathOrId
    );

    if (matches.length === 0) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: `Unable to find a collection matching "${pathOrId}".`,
      });
    }

    if (matches.length > 1) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: `Multiple collections match "${pathOrId}". Use a collection id or a full collection path instead.`,
      });
    }

    return [matches[0].collection];
  }
};

const loadTeamCollections = async (
  teamID: string,
  runtime: Awaited<ReturnType<typeof resolveRuntime>>,
  options: RequestRunCmdOptions
) => {
  const serverUrl = runtime.server ?? options.server;
  let token = runtime.token ?? options.token;
  const refreshToken = runtime.refreshToken ?? options.refreshToken;

  const fetchCollections = () =>
    loadWorkspaceCollectionsTree(
      {
        serverUrl: serverUrl ?? "",
        token,
        refreshToken,
      },
      teamID
    );

  try {
    return await fetchCollections();
  } catch (error) {
    if (!refreshToken || !isExpiredAccessTokenError(error)) {
      throw error;
    }

    const refreshedTokens = await refreshRuntimeTokens({
      serverUrl,
      token,
      refreshToken,
    });
    token = refreshedTokens.token;

    return fetchCollections();
  }
};

type ResolvedWorkspaceRequestSelection = {
  collections: Parameters<typeof resolveRequestContext>[0];
  resolvedCollectionLabel: string;
  requestTarget: string;
};

const resolveWorkspaceRequestSelection = async (
  requestPathOrId: string,
  collectionPathOrId: string | undefined,
  options: RequestRunCmdOptions,
  runtime: Awaited<ReturnType<typeof resolveRuntime>>
): Promise<ResolvedWorkspaceRequestSelection> => {
  const resolvedCollectionName = options.collectionName;
  const resolvedCollectionPathOrId =
    collectionPathOrId ??
    options.collectionId ??
    (resolvedCollectionName ? undefined : runtime.collectionId);
  const resolvedTeamId = options.teamId ?? runtime.teamId;
  let collections: Parameters<typeof resolveRequestContext>[0] = [];
  let resolvedCollectionLabel = "";
  let requestTarget = requestPathOrId;

  if (resolvedCollectionPathOrId) {
    collections = await loadWorkspaceCollections(
      resolvedCollectionPathOrId,
      runtime,
      options
    );
    resolvedCollectionLabel = resolvedCollectionPathOrId;
  } else if (resolvedCollectionName) {
    if (!resolvedTeamId) {
      throw error({
        code: "INVALID_ARGUMENT",
        data:
          "A team id is required when using collectionName. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
      });
    }

    const teamCollectionsResult = await loadTeamCollections(
      resolvedTeamId,
      runtime,
      options
    );

    if (!teamCollectionsResult.ok) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: teamCollectionsResult.errors.join("; "),
      });
    }

    const matchingCollections = findCollectionMatches(
      teamCollectionsResult.collections,
      resolvedCollectionName
    );

    const requestMatches = matchingCollections
      .map((match) => {
        const target = stripCollectionPrefix(match.path, requestPathOrId);

        try {
          const resolved = resolveRequestContext([match.collection], target);

          return {
            ...match,
            requestTarget: target,
            resolved,
          };
        } catch {
          return null;
        }
      })
      .filter(
        (
          match
        ): match is {
          collection: (typeof matchingCollections)[number]["collection"];
          path: string;
          requestTarget: string;
          resolved: ReturnType<typeof resolveRequestContext>;
        } => Boolean(match)
      );

    if (requestMatches.length === 1) {
      const [selected] = requestMatches;
      collections = [selected.collection];
      resolvedCollectionLabel = selected.path;
      requestTarget = selected.requestTarget;
    } else if (matchingCollections.length > 1) {
      const preferredCollection = pickPreferredCollectionMatch(
        matchingCollections,
        resolvedCollectionName
      );

      if (preferredCollection) {
        collections = [preferredCollection.collection];
        resolvedCollectionLabel = preferredCollection.path;
        requestTarget = stripCollectionPrefix(
          preferredCollection.path,
          requestPathOrId
        );
      } else if (requestMatches.length > 1) {
        throw error({
          code: "INVALID_ARGUMENT",
          data: `Multiple collections named "${resolvedCollectionName}" contain a matching request "${requestPathOrId}". Use a collection id or a full path instead.`,
        });
      } else {
        throw error({
          code: "INVALID_ARGUMENT",
          data: `Multiple collections match "${resolvedCollectionName}", but none contains a request matching "${requestPathOrId}". Use a collection id or a full collection path instead.`,
        });
      }
    } else if (matchingCollections.length === 1) {
      const [selected] = matchingCollections;
      collections = [selected.collection];
      resolvedCollectionLabel = selected.path;
      requestTarget = stripCollectionPrefix(selected.path, requestPathOrId);
    } else {
      throw error({
        code: "INVALID_ARGUMENT",
        data: `Unable to find a collection matching "${resolvedCollectionName}".`,
      });
    }
  } else {
    throw error({
      code: "INVALID_ARGUMENT",
      data:
        "A collection id/path is required. Pass one as the first argument, use --collection-id, or use --collection-name together with --team / config.teamId.",
    });
  }

  return {
    collections,
    resolvedCollectionLabel,
    requestTarget,
  };
};

const resolveWorkspaceCollectionSelection = async (
  collectionPathOrId: string | undefined,
  options: RequestRunCmdOptions,
  runtime: Awaited<ReturnType<typeof resolveRuntime>>
) => {
  const resolvedCollectionName = options.collectionName;
  const resolvedCollectionPathOrId =
    collectionPathOrId ??
    options.collectionId ??
    (resolvedCollectionName ? undefined : runtime.collectionId);
  const resolvedTeamId = options.teamId ?? runtime.teamId;

  if (resolvedCollectionPathOrId) {
    return {
      collections: await loadWorkspaceCollections(
        resolvedCollectionPathOrId,
        runtime,
        options
      ),
      label: resolvedCollectionPathOrId,
    };
  }

  if (resolvedCollectionName) {
    if (!resolvedTeamId) {
      throw error({
        code: "INVALID_ARGUMENT",
        data:
          "A team id is required when using collectionName. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
      });
    }

    const teamCollectionsResult = await loadTeamCollections(
      resolvedTeamId,
      runtime,
      options
    );

    if (!teamCollectionsResult.ok) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: teamCollectionsResult.errors.join("; "),
      });
    }

    const matchingCollections = findCollectionMatches(
      teamCollectionsResult.collections,
      resolvedCollectionName
    );

    const preferredCollection = pickPreferredCollectionMatch(
      matchingCollections,
      resolvedCollectionName
    );

    if (preferredCollection) {
      return {
        collections: [preferredCollection.collection],
        label: preferredCollection.path,
      };
    }

    if (matchingCollections.length === 0) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: `Unable to find a collection matching "${resolvedCollectionName}".`,
      });
    }

    return {
      collections: matchingCollections.map((match) => match.collection),
      label: resolvedCollectionName,
    };
  }

  throw error({
    code: "INVALID_ARGUMENT",
    data:
      "A collection id/path is required. Pass one as the first argument, use --collection-id, or use --collection-name together with --team / config.teamId.",
  });
};

const normalizeTargetPath = (value: string) => value.split("/").filter(Boolean).join("/");

const stripCollectionPrefix = (collectionPath: string, requestTarget: string) => {
  const normalizedCollectionPath = normalizeTargetPath(collectionPath);
  const normalizedRequestTarget = normalizeTargetPath(requestTarget);

  if (
    normalizedCollectionPath &&
    normalizedRequestTarget.startsWith(`${normalizedCollectionPath}/`)
  ) {
    return normalizedRequestTarget.slice(normalizedCollectionPath.length + 1);
  }

  return requestTarget;
};

type RawCollectionMatch = {
  collection: WorkspaceCollectionNode;
  path: string;
};

type RawRequestContext = {
  collection: WorkspaceCollectionNode;
  collectionPath: string;
  request: Record<string, unknown>;
  path: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readRawCollectionsFile = async (path: string) => {
  const parsed = JSON.parse((await fs.readFile(path)).toString()) as unknown;

  return (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (collection): collection is WorkspaceCollectionNode =>
      isRecord(collection) && typeof collection.name === "string"
  );
};

const getRawRequestId = (request: Record<string, unknown>) => {
  const id = request.id ?? request._ref_id;
  return typeof id === "string" ? id : undefined;
};

const getRawRequestName = (request: Record<string, unknown>) =>
  typeof request.name === "string" ? request.name : "Untitled Request";

const collectRawCollectionMatches = (
  collections: WorkspaceCollectionNode[],
  target: string,
  parentPath = "",
  matches: RawCollectionMatch[] = []
) => {
  const normalizedTarget = normalizeTargetPath(target);

  for (const collection of collections) {
    const path = parentPath ? `${parentPath}/${collection.name}` : collection.name;
    const normalizedPath = normalizeTargetPath(path);

    if (
      collection.id === target ||
      collection._ref_id === target ||
      normalizedTarget === normalizedPath ||
      (!target.includes("/") && collection.name === target)
    ) {
      matches.push({ collection, path });
    }

    collectRawCollectionMatches(collection.folders ?? [], target, path, matches);
  }

  return matches;
};

const pickPreferredRawCollectionMatch = (
  matches: RawCollectionMatch[],
  target: string
) => {
  const normalizedTarget = normalizeTargetPath(target);

  return matches
    .map((match, index) => ({ ...match, index }))
    .filter(({ collection, path }) => {
      const normalizedPath = normalizeTargetPath(path);

      return (
        collection.id === target ||
        collection._ref_id === target ||
        normalizedTarget === normalizedPath ||
        (!target.includes("/") && collection.name === target)
      );
    })
    .sort((a, b) => {
      const depthA = normalizeTargetPath(a.path).split("/").length;
      const depthB = normalizeTargetPath(b.path).split("/").length;
      if (depthA !== depthB) return depthA - depthB;

      const lenA = normalizeTargetPath(a.path).length;
      const lenB = normalizeTargetPath(b.path).length;
      if (lenA !== lenB) return lenA - lenB;

      return a.index - b.index;
    })[0] ?? null;
};

const collectRawRequestContexts = (
  collections: WorkspaceCollectionNode[],
  parentPath = "",
  matches: RawRequestContext[] = []
) => {
  for (const collection of collections) {
    const collectionPath = parentPath
      ? `${parentPath}/${collection.name}`
      : collection.name;

    for (const request of collection.requests ?? []) {
      if (!isRecord(request)) continue;

      matches.push({
        collection,
        collectionPath,
        request,
        path: `${collectionPath}/${getRawRequestName(request)}`,
      });
    }

    collectRawRequestContexts(collection.folders ?? [], collectionPath, matches);
  }

  return matches;
};

const resolveRawRequestContext = (
  collections: WorkspaceCollectionNode[],
  requestTarget: string
) => {
  const normalizedTarget = normalizeTargetPath(requestTarget);
  const contexts = collectRawRequestContexts(collections);
  const matches = contexts.filter((context) => {
    const requestId = getRawRequestId(context.request);
    const requestName = getRawRequestName(context.request);
    const normalizedPath = normalizeTargetPath(context.path);
    const relativePath = normalizeTargetPath(
      stripCollectionPrefix(context.collectionPath, context.path)
    );

    return (
      requestId === requestTarget ||
      normalizedTarget === normalizedPath ||
      normalizedTarget === relativePath ||
      (!requestTarget.includes("/") && requestName === requestTarget)
    );
  });

  if (matches.length === 0) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Unable to find a request matching "${requestTarget}".`,
    });
  }

  if (matches.length > 1) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Multiple requests match "${requestTarget}". Use a request id or a full request path instead.`,
    });
  }

  return matches[0];
};

const loadRawWorkspaceCollections = async (
  runtime: Awaited<ReturnType<typeof resolveRuntime>>,
  options: RequestRunCmdOptions & { team?: string }
) => {
  const serverUrl = runtime.server ?? options.server;
  let token = runtime.token ?? options.token;
  const refreshToken = runtime.refreshToken ?? options.refreshToken;
  const teamID = options.team ?? options.teamId ?? runtime.teamId;

  if (!teamID) {
    throw error({
      code: "INVALID_ARGUMENT",
      data:
        "A team id is required to resolve workspace collections over GraphQL. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
    });
  }

  const fetchCollections = () =>
    loadWorkspaceCollectionsTreeRaw(
      {
        serverUrl: serverUrl ?? "",
        token,
        refreshToken,
      },
      teamID
    );

  try {
    const result = await fetchCollections();
    if (!result.ok) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: result.errors.join("; "),
      });
    }

    return { collections: result.collections, label: `team:${teamID}` };
  } catch (err) {
    if (!refreshToken || !isExpiredAccessTokenError(err)) {
      throw err;
    }

    const refreshedTokens = await refreshRuntimeTokens({
      serverUrl,
      token,
      refreshToken,
    });
    token = refreshedTokens.token;

    const result = await fetchCollections();
    if (!result.ok) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: result.errors.join("; "),
      });
    }

    return { collections: result.collections, label: `team:${teamID}` };
  }
};

const resolveRawRequestSelection = async (
  requestPathOrId: string,
  collectionPathOrId: string | undefined,
  options: RequestRunCmdOptions & { team?: string },
  runtime: Awaited<ReturnType<typeof resolveRuntime>>
) => {
  const resolvedCollectionName = options.collectionName;
  const resolvedCollectionPathOrId =
    collectionPathOrId ??
    options.collectionId ??
    (resolvedCollectionName ? undefined : runtime.collectionId);

  let collections: WorkspaceCollectionNode[] = [];
  let collectionLabel = "";

  if (resolvedCollectionPathOrId && await pathExists(resolvedCollectionPathOrId)) {
    collections = await readRawCollectionsFile(resolvedCollectionPathOrId);
    collectionLabel = resolvedCollectionPathOrId;
  } else {
    const workspace = await loadRawWorkspaceCollections(runtime, options);
    const collectionTarget = resolvedCollectionPathOrId ?? resolvedCollectionName;

    if (collectionTarget) {
      const matches = collectRawCollectionMatches(
        workspace.collections,
        collectionTarget
      );

      if (matches.length === 0) {
        throw error({
          code: "INVALID_ARGUMENT",
          data: `Unable to find a collection matching "${collectionTarget}".`,
        });
      }

      const preferredMatch = pickPreferredRawCollectionMatch(
        matches,
        collectionTarget
      );

      if (!preferredMatch && matches.length > 1) {
        throw error({
          code: "INVALID_ARGUMENT",
          data: `Multiple collections match "${collectionTarget}". Use a collection id or a full collection path instead.`,
        });
      }

      const selected = preferredMatch ?? matches[0];
      collections = [selected.collection];
      collectionLabel = selected.path;
    } else {
      collections = workspace.collections;
      collectionLabel = workspace.label;
    }
  }

  const requestTarget = collectionLabel
    ? stripCollectionPrefix(collectionLabel, requestPathOrId)
    : requestPathOrId;
  const resolvedRequest = resolveRawRequestContext(collections, requestTarget);

  return {
    collectionLabel,
    resolvedRequest,
  };
};

const loadWorkspaceEnvironments = async (
  environmentId: string | undefined,
  runtime: Awaited<ReturnType<typeof resolveRuntime>>,
  options: RequestRunCmdOptions
) => {
  const serverUrl = runtime.server ?? options.server;
  const token = runtime.token ?? options.token;
  const refreshToken = runtime.refreshToken ?? options.refreshToken;

  return loadRequestEnvironments(
    {
      serverUrl: serverUrl ?? "",
      token,
      refreshToken,
    },
    environmentId,
    options.teamId ?? runtime.teamId,
    async (tokens) => {
      await updateCliConfig({
        server: serverUrl,
        token: tokens.token,
        refreshToken: tokens.refreshToken,
      });
    }
  );
};

export const runRequest = (
  collectionPathOrId: string | undefined,
  requestPathOrId: string,
  options: RequestRunCmdOptions
) => async () => {
  try {
    const resolvedDelay = options.delay ? parseDelayOption(options.delay) : 0;
    const runtime = await resolveRuntime(options);
    const resolvedCollectionName = options.collectionName;
    const resolvedCollectionPathOrId =
      collectionPathOrId ??
      options.collectionId ??
      (resolvedCollectionName ? undefined : runtime.collectionId);
    const resolvedTeamId = options.teamId ?? runtime.teamId;
    const resolvedEnvironmentId = options.env ?? runtime.environmentId;

    const envs = await loadWorkspaceEnvironments(
      resolvedEnvironmentId,
      runtime,
      options
    );

    let collections: Parameters<typeof resolveRequestContext>[0] = [];
    let resolvedCollectionLabel = "";
    let requestTarget = requestPathOrId;

    if (resolvedCollectionPathOrId) {
      collections = await loadWorkspaceCollections(
        resolvedCollectionPathOrId,
        runtime,
        options
      );
      resolvedCollectionLabel = resolvedCollectionPathOrId;
    } else if (resolvedCollectionName) {
      if (!resolvedTeamId) {
        throw error({
          code: "INVALID_ARGUMENT",
          data:
            "A team id is required when using collectionName. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
        });
      }

      const teamCollectionsResult = await loadTeamCollections(
        resolvedTeamId,
        runtime,
        options
      );

      if (!teamCollectionsResult.ok) {
        throw error({
          code: "INVALID_ARGUMENT",
          data: teamCollectionsResult.errors.join("; "),
        });
      }

      const matchingCollections = findCollectionMatches(
        teamCollectionsResult.collections,
        resolvedCollectionName
      );

      const requestMatches = matchingCollections
        .map((match) => {
          const target = stripCollectionPrefix(match.path, requestPathOrId);

          try {
            const resolved = resolveRequestContext([match.collection], target);

            return {
              ...match,
              requestTarget: target,
              resolved,
            };
          } catch {
            return null;
          }
        })
        .filter(
          (
            match
          ): match is {
            collection: (typeof matchingCollections)[number]["collection"];
            path: string;
            requestTarget: string;
            resolved: ReturnType<typeof resolveRequestContext>;
          } => Boolean(match)
        );

      if (requestMatches.length === 1) {
        const [selected] = requestMatches;
        collections = [selected.collection];
        resolvedCollectionLabel = selected.path;
        requestTarget = selected.requestTarget;
      } else if (requestMatches.length > 1) {
        throw error({
          code: "INVALID_ARGUMENT",
          data: `Multiple collections named "${resolvedCollectionName}" contain a matching request "${requestPathOrId}". Use a collection id or a full path instead.`,
        });
      } else if (matchingCollections.length > 1) {
        throw error({
          code: "INVALID_ARGUMENT",
          data: `Multiple collections match "${resolvedCollectionName}", but none contains a request matching "${requestPathOrId}". Use a collection id or a full collection path instead.`,
        });
      } else if (matchingCollections.length === 1) {
        const [selected] = matchingCollections;
        collections = [selected.collection];
        resolvedCollectionLabel = selected.path;
        requestTarget = stripCollectionPrefix(selected.path, requestPathOrId);
      } else {
        throw error({
          code: "INVALID_ARGUMENT",
          data: `Unable to find a collection matching "${resolvedCollectionName}".`,
        });
      }
    } else {
      throw error({
        code: "INVALID_ARGUMENT",
        data:
          "A collection id/path is required. Pass one as the first argument, use --collection-id, or use --collection-name together with --team / config.teamId.",
      });
    }

    if (options.verbose) {
      printStep(`resolved collection: ${resolvedCollectionLabel}`);
      printStep(`resolved request target: ${requestTarget}`);
      printVerboseJson("selected envs", envs);
    }

    const resolvedRequest = resolveRequestContext(collections, requestTarget);

    if (options.verbose) {
      printStep("pre-request script executing...");
    }

    const preRequestRes = await preRequestScriptRunner(
      resolvedRequest.request,
      envs,
      Boolean(options.legacySandbox),
      resolvedRequest.collectionVariables,
      resolvedRequest.inheritedPreRequestScripts
    )();

    if (preRequestRes._tag === "Left") {
      handleError(preRequestRes.left);
      process.exit(1);
      return;
    }

    if (options.verbose) {
      printStep("pre-request script finished");
      printVerboseJson("effective request", {
        id: resolvedRequest.request.id,
        name: resolvedRequest.request.name,
        method: preRequestRes.right.effectiveRequest.method,
        endpoint: preRequestRes.right.effectiveRequest.effectiveFinalURL,
        headers: preRequestRes.right.effectiveRequest.effectiveFinalHeaders,
        params: preRequestRes.right.effectiveRequest.effectiveFinalParams,
        body: describeBody(preRequestRes.right.effectiveRequest.effectiveFinalBody),
      });
      printStep("request executing...");
    }

    const requestConfig = createRequest(preRequestRes.right.effectiveRequest);
    const requestRunnerRes = await delayPromiseFunction(
      requestRunner(requestConfig),
      resolvedDelay
    );

    if (requestRunnerRes._tag === "Left") {
      handleError(requestRunnerRes.left);
      process.exit(1);
      return;
    }

    if (options.verbose) {
      printStep("request finished");
      printVerboseJson("response", requestRunnerRes.right);
    }

    printJson({
      ok: true,
      collection: {
        source: resolvedCollectionLabel,
        name: resolvedRequest.collection.name,
      },
      request: {
        id: resolvedRequest.request.id,
        name: resolvedRequest.request.name,
        path: resolvedRequest.path,
        method: resolvedRequest.request.method,
        endpoint: resolvedRequest.request.endpoint,
      },
      response: requestRunnerRes.right,
    });
  } catch (e) {
    if (isHoppCLIError(e)) {
      handleError(e);
      process.exit(1);
    } else {
      throw e;
    }
  }
};

export const registerRequestCommand = (program: Command) => {
  const requestCommand = program
    .command("request")
    .description("Inspect, run, and manage saved Hoppscotch requests");

  requestCommand
    .command("create")
    .argument("<title>", "title of the new request")
    .argument(
      "[collection_id_or_name]",
      "optional collection id, name, or full path; falls back to config.collectionId when omitted"
    )
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the GraphQL backend"
    )
    .option("--team <team_id>", "team ID to create the request in")
    .option(
      "--collection-id <collection_id>",
      "collection id to create the request in"
    )
    .option(
      "--collection-name <collection_name>",
      "collection name or full path to create the request in"
    )
    .option(
      "--request <json_or_path>",
      "JSON string or path to a JSON file representing the Hoppscotch request"
    )
    .description("Create a new team request")
    .action(async (title: string, collectionTarget: string | undefined, options) => {
      try {
        const runtime = await resolveRuntime(options);
        const teamID = options.team ?? runtime.teamId;
        const resolvedCollectionTarget =
          collectionTarget ??
          options.collectionId ??
          options.collectionName ??
          runtime.collectionId;

        if (!teamID) {
          throw error({
            code: "INVALID_ARGUMENT",
            data:
              "A team id is required to create a request. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
          });
        }

        if (!resolvedCollectionTarget) {
          throw error({
            code: "INVALID_ARGUMENT",
            data:
              "A collection id/name/path is required to create a request. Pass it as an argument, use --collection-id, --collection-name, or save a default collectionId with `hopp config set collectionId <id>`.",
          });
        }

        if (!options.request) {
          throw error({
            code: "INVALID_ARGUMENT",
            data: "A request JSON string or file path is required. Pass it with --request <json_or_path>.",
          });
        }

        const result = await createTeamRequest(
          {
            serverUrl: runtime.server ?? options.server ?? "",
            token: runtime.token ?? options.token,
            refreshToken: runtime.refreshToken ?? options.refreshToken,
          },
          {
            teamID,
            collectionTarget: resolvedCollectionTarget,
            title,
            request: options.request,
          }
        );

        await updateCliConfig({
          teamId: teamID,
          server: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        });

        const createdRequest = result.data?.createRequestInCollection;

        console.log(
          JSON.stringify(
            {
              ok: Boolean(createdRequest),
              request: createdRequest ?? null,
              errors: result.errors ?? [],
            },
            null,
            2
          )
        );

        if (!createdRequest || result.errors?.length) {
          process.exitCode = 1;
        }
      } catch (e) {
        if (isHoppCLIError(e)) {
          handleError(e);
          process.exit(1);
          return;
        }

        throw e;
      }
    });

  requestCommand
    .command("list")
    .argument(
      "[collection_file_path_or_id]",
      "optional path to a hoppscotch collection.json file or collection ID from a workspace; falls back to config.collectionId when omitted, or use --collection-name with --team for workspace trees"
    )
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the GraphQL backend"
    )
    .option("--team <team_id>", "team id for resolving collectionName")
    .option(
      "--collection-id <collection_id>, --collectionId <collection_id>",
      "collection id/path to use"
    )
    .option(
      "--collection-name <collection_name>, --collectionName <collection_name>",
      "collection name to use when resolving workspace collections"
    )
    .description("List requests in a collection subtree")
    .action(async (collectionPathOrId: string | undefined, options) => {
      try {
        const runtime = await resolveRuntime(options);
        const requestedCollectionTarget =
          collectionPathOrId ?? options.collectionId ?? runtime.collectionId;
        const teamID = options.teamId ?? runtime.teamId;

        let collections: Parameters<typeof resolveRequestContext>[0];
        let label: string;

        if (requestedCollectionTarget) {
          const selection = await resolveWorkspaceCollectionSelection(
            requestedCollectionTarget,
            options,
            runtime
          );

          collections = selection.collections;
          label = selection.label;
        } else {
          if (!teamID) {
            throw error({
              code: "INVALID_ARGUMENT",
              data:
                "A team id is required to list requests when no collection is provided. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
            });
          }

          const teamCollectionsResult = await loadTeamCollections(
            teamID,
            runtime,
            options
          );

          if (!teamCollectionsResult.ok) {
            throw error({
              code: "INVALID_ARGUMENT",
              data: teamCollectionsResult.errors.join("; "),
            });
          }

          collections = teamCollectionsResult.collections;
          label = `team:${teamID}`;
        }

        const requestContexts = listRequestContexts(collections);

        console.log(
          JSON.stringify(
            {
              ok: true,
              collection: label,
              requests: requestContexts.map((context) => ({
                id: context.request.id,
                name: context.request.name,
                path: context.path,
                method: context.request.method,
                endpoint: context.request.endpoint,
              })),
              errors: [],
            },
            null,
            2
          )
        );
      } catch (e) {
        if (isHoppCLIError(e)) {
          handleError(e);
          process.exit(1);
          return;
        }

        throw e;
      }
    });

  requestCommand
    .command("show")
    .alias("get")
    .argument(
      "<request_path_or_id>",
      "request path, request id, or request name when unique"
    )
    .argument(
      "[collection_file_path_or_id]",
      "optional path to a hoppscotch collection.json file or collection ID from a workspace; falls back to config.collectionId when omitted, or use --collection-name with --team for workspace trees"
    )
    .option("--server <server_url>", "server URL for the GraphQL backend")
    .option("--token <access_token>", "access token for the backend")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the GraphQL backend"
    )
    .option("--team <team_id>", "team id for resolving workspace collections")
    .option(
      "--collection-id <collection_id>, --collectionId <collection_id>",
      "collection id/path to use"
    )
    .option(
      "--collection-name <collection_name>, --collectionName <collection_name>",
      "collection name to use when resolving workspace collections"
    )
    .description("Show the complete saved Hoppscotch request JSON")
    .action(
      async (
        requestPathOrId: string,
        collectionPathOrId: string | undefined,
        options
      ) => {
        try {
          const runtime = await resolveRuntime(options);
          const selection = await resolveRawRequestSelection(
            requestPathOrId,
            collectionPathOrId ?? options.collectionId,
            options,
            runtime
          );
          const request = selection.resolvedRequest.request;

          printJson({
            ok: true,
            collection: {
              source: selection.collectionLabel,
              name: selection.resolvedRequest.collection.name,
              path: selection.resolvedRequest.collectionPath,
            },
            request: {
              id: getRawRequestId(request),
              name: getRawRequestName(request),
              path: selection.resolvedRequest.path,
              json: request,
            },
            errors: [],
          });
        } catch (e) {
          if (isHoppCLIError(e)) {
            handleError(e);
            process.exit(1);
            return;
          }

          throw e;
        }
      }
    );

  requestCommand
    .command("update")
    .argument("<request_path_or_id>", "request id, name, or full path to update")
    .argument("[new_title]", "new title for the request")
    .argument(
      "[collection_file_path_or_id]",
      "optional path to a hoppscotch collection.json file or collection ID from a workspace; falls back to config.collectionId when omitted, or use --collection-name with --team for workspace trees"
    )
    .option(
      "--server <server_url>",
      "server URL for the GraphQL backend"
    )
    .option("--token <access_token>", "access token for the backend")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the GraphQL backend"
    )
    .option("--team <team_id>", "team id for resolving collectionName")
    .option(
      "--collection-id <collection_id>, --collectionId <collection_id>",
      "collection id/path to use"
    )
    .option(
      "--collection-name <collection_name>, --collectionName <collection_name>",
      "collection name to use when resolving a request within a team"
    )
    .option(
      "--request <json_or_path>",
      "optional JSON string or path to a JSON file representing the updated Hoppscotch request"
    )
    .description("Update a saved request title or body")
    .action(
      async (
        requestPathOrId: string,
        newTitle: string | undefined,
        collectionPathOrId: string | undefined,
        options
      ) => {
        if (!newTitle && !options.request) {
          throw error({
            code: "INVALID_ARGUMENT",
            data:
              "Provide a new request title as an argument, or pass --request <json_or_path> to update the request body.",
          });
        }

        const runtime = await resolveRuntime(options);
        const selection = await resolveWorkspaceRequestSelection(
          requestPathOrId,
          collectionPathOrId ?? options.collectionId,
          options,
          runtime
        );
        const resolvedRequest = resolveRequestContext(
          selection.collections,
          selection.requestTarget
        );

        const result = await updateTeamRequest(
          {
            serverUrl: runtime.server ?? options.server ?? "",
            token: runtime.token ?? options.token,
            refreshToken: runtime.refreshToken ?? options.refreshToken,
          },
          {
            requestID: resolvedRequest.request.id,
            title: newTitle,
            request: options.request,
          },
          async (tokens) => {
            await updateCliConfig({
              token: tokens.token,
              refreshToken: tokens.refreshToken,
              server: runtime.server ?? options.server,
              teamId: options.teamId ?? runtime.teamId,
            });
          }
        );

        await updateCliConfig({
          teamId: options.teamId ?? runtime.teamId,
          server: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        });

        console.log(
          JSON.stringify(
            {
              ok: true,
              request: result,
              errors: [],
            },
            null,
            2
          )
        );
      }
    );

  requestCommand
    .command("delete")
    .argument("<request_path_or_id>", "request id, name, or full path to delete")
    .argument(
      "[collection_file_path_or_id]",
      "optional path to a hoppscotch collection.json file or collection ID from a workspace; falls back to config.collectionId when omitted, or use --collection-name with --team for workspace trees"
    )
    .option(
      "--server <server_url>",
      "server URL for the GraphQL backend"
    )
    .option("--token <access_token>", "access token for the backend")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the GraphQL backend"
    )
    .option("--team <team_id>", "team id for resolving collectionName")
    .option(
      "--collection-id <collection_id>, --collectionId <collection_id>",
      "collection id/path to use"
    )
    .option(
      "--collection-name <collection_name>, --collectionName <collection_name>",
      "collection name to use when resolving a request within a team"
    )
    .description("Delete a saved request")
    .action(
      async (
        requestPathOrId: string,
        collectionPathOrId: string | undefined,
        options
      ) => {
        const runtime = await resolveRuntime(options);
        const selection = await resolveWorkspaceRequestSelection(
          requestPathOrId,
          collectionPathOrId ?? options.collectionId,
          options,
          runtime
        );
        const resolvedRequest = resolveRequestContext(
          selection.collections,
          selection.requestTarget
        );

        const result = await deleteTeamRequest(
          {
            serverUrl: runtime.server ?? options.server ?? "",
            token: runtime.token ?? options.token,
            refreshToken: runtime.refreshToken ?? options.refreshToken,
          },
          {
            requestID: resolvedRequest.request.id,
          },
          async (tokens) => {
            await updateCliConfig({
              token: tokens.token,
              refreshToken: tokens.refreshToken,
              server: runtime.server ?? options.server,
              teamId: options.teamId ?? runtime.teamId,
            });
          }
        );

        await updateCliConfig({
          teamId: options.teamId ?? runtime.teamId,
          server: runtime.server ?? options.server,
          token: runtime.token ?? options.token,
          refreshToken: runtime.refreshToken ?? options.refreshToken,
        });

        console.log(
          JSON.stringify(
            {
              ok: true,
              deleted: {
                ...result,
                name: resolvedRequest.request.name,
                path: resolvedRequest.path,
              },
              errors: [],
            },
            null,
            2
          )
        );
      }
    );

  requestCommand
    .command("run")
    .argument(
      "<request_path_or_id>",
      "request path, request id, or request name when unique"
    )
    .argument(
      "[collection_file_path_or_id]",
      "optional path to a hoppscotch collection.json file or collection ID from a workspace; falls back to config.collectionId when omitted, or use --collection-name with --team for workspace trees"
    )
    .option(
      "-e, --env <file_path_or_id>",
      "path to an environment variables json file or environment ID from a workspace"
    )
    .option(
      "-d, --delay <delay_in_ms>",
      "delay in milliseconds(ms) before executing the request"
    )
    .option(
      "--token <access_token>",
      "personal access token to access collections/environments from a workspace"
    )
    .option("--server <server_url>", "server URL for SH instance")
    .option(
      "--refresh-token <refresh_token>",
      "refresh token for the backend"
    )
    .option("--team <team_id>", "team id for resolving collectionName")
    .option(
      "--collection-id <collection_id>, --collectionId <collection_id>",
      "collection id/path to use"
    )
    .option(
      "--collection-name <collection_name>, --collectionName <collection_name>",
      "collection name to use when resolving a request within a team"
    )
    .option("--verbose", "print execution steps, request details, and response")
    .option("--legacy-sandbox", "Opt out from the experimental scripting sandbox")
    .description("run a single saved request and print the HTTP response as JSON")
    .action(async (requestPathOrId: string, collectionPathOrId: string | undefined, options) => {
      await runRequest(collectionPathOrId ?? options.collectionId, requestPathOrId, options)();
    });
};
