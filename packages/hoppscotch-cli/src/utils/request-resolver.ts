import { HoppCollection, HoppCollectionVariable, HoppRESTRequest } from "@hoppscotch/data";
import { filterValidScripts } from "@hoppscotch/js-sandbox/scripting";

import { preProcessRequest } from "./request";

export type ResolvedRequestContext = {
  collection: HoppCollection;
  collectionVariables: HoppCollectionVariable[];
  inheritedPreRequestScripts: string[];
  inheritedTestScripts: string[];
  path: string;
  request: HoppRESTRequest;
};

const appendMissingByKey = <T extends { key: string }>(
  source: T[],
  inherited: T[]
) => {
  const sourceKeys = new Set(source.map(({ key }) => key));
  return [...source, ...inherited.filter(({ key }) => !sourceKeys.has(key))];
};

const inheritCollectionContext = (
  parent: HoppCollection,
  child: HoppCollection
): HoppCollection => {
  const inheritedCollection: HoppCollection = {
    ...child,
    auth:
      child.auth.authType === "inherit"
        ? parent.auth
        : child.auth,
    headers: child.headers.length
      ? appendMissingByKey(child.headers, parent.headers)
      : [...parent.headers],
    variables: child.variables.length
      ? appendMissingByKey(child.variables, parent.variables)
      : [...parent.variables],
  };

  return inheritedCollection;
};

const normalizePath = (value: string) => value.split("/").filter(Boolean).join("/");

const getRequestRefId = (request: HoppRESTRequest) =>
  (request as HoppRESTRequest & { _ref_id?: string })._ref_id;

const matchesRequestTarget = (
  request: HoppRESTRequest,
  requestPath: string,
  target: string
) => {
  const trimmedTarget = target.trim();
  const refId = getRequestRefId(request);

  if (trimmedTarget === request.id) return true;
  if (refId && trimmedTarget === refId) return true;
  if (trimmedTarget === requestPath) return true;
  if (trimmedTarget.includes("/")) {
    return normalizePath(trimmedTarget) === normalizePath(requestPath);
  }

  return request.name === trimmedTarget;
};

const collectMatches = (
  collection: HoppCollection,
  collectionPath: string,
  target: string,
  ancestorPreRequestScripts: string[],
  ancestorTestScripts: string[],
  matches: ResolvedRequestContext[]
) => {
  const inheritedPreRequestScripts = filterValidScripts([
    ...ancestorPreRequestScripts,
    collection.preRequestScript,
  ]);
  const inheritedTestScripts = filterValidScripts([
    ...ancestorTestScripts,
    collection.testScript,
  ]);

  for (const request of collection.requests) {
    const requestPath = `${collectionPath}/${request.name}`;

    if (!matchesRequestTarget(request, requestPath, target)) {
      continue;
    }

    matches.push({
      collection,
      collectionVariables: collection.variables,
      inheritedPreRequestScripts,
      inheritedTestScripts,
      path: requestPath,
      request: preProcessRequest(request, collection),
    });
  }

  for (const folder of collection.folders) {
    const inheritedFolder = inheritCollectionContext(collection, folder);
    collectMatches(
      inheritedFolder,
      `${collectionPath}/${inheritedFolder.name}`,
      target,
      inheritedPreRequestScripts,
      inheritedTestScripts,
      matches
    );
  }
};

export const resolveRequestContext = (
  collections: HoppCollection[],
  target: string
): ResolvedRequestContext => {
  const matches: ResolvedRequestContext[] = [];

  for (const collection of collections) {
    collectMatches(collection, collection.name, target, [], [], matches);
  }

  if (matches.length === 0) {
    throw new Error(`Unable to find a request matching "${target}".`);
  }

  const hasPathTarget = target.includes("/");
  const exactMatches = hasPathTarget
    ? matches.filter(({ path }) => normalizePath(path) === normalizePath(target))
    : matches.filter(
        ({ request }) =>
          request.id === target ||
          getRequestRefId(request) === target ||
          request.name === target
      );

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  if (matches.length === 1 && !hasPathTarget) {
    return matches[0];
  }

  if (matches.length > 1 && !hasPathTarget) {
    const matchingNames = new Set(matches.map(({ request }) => request.name));

    if (matchingNames.size === 1) {
      throw new Error(
        `Multiple requests named "${target}" exist. Use a request id or full path instead.`
      );
    }
  }

  if (exactMatches.length > 1) {
    throw new Error(
      `Multiple requests match "${target}". Use a request id or full path instead.`
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple requests match "${target}". Use a request id or full path instead.`
    );
  }

  return matches[0];
};

export const listRequestContexts = (collections: HoppCollection[]) => {
  const matches: ResolvedRequestContext[] = [];

  const collectAll = (
    collection: HoppCollection,
    collectionPath: string,
    ancestorPreRequestScripts: string[],
    ancestorTestScripts: string[]
  ) => {
    const inheritedPreRequestScripts = filterValidScripts([
      ...ancestorPreRequestScripts,
      collection.preRequestScript,
    ]);
    const inheritedTestScripts = filterValidScripts([
      ...ancestorTestScripts,
      collection.testScript,
    ]);

    for (const request of collection.requests) {
      matches.push({
        collection,
        collectionVariables: collection.variables,
        inheritedPreRequestScripts,
        inheritedTestScripts,
        path: `${collectionPath}/${request.name}`,
        request: preProcessRequest(request, collection),
      });
    }

    for (const folder of collection.folders) {
      const inheritedFolder = inheritCollectionContext(collection, folder);
      collectAll(
        inheritedFolder,
        `${collectionPath}/${inheritedFolder.name}`,
        inheritedPreRequestScripts,
        inheritedTestScripts
      );
    }
  };

  for (const collection of collections) {
    collectAll(collection, collection.name, [], []);
  }

  return matches;
};
