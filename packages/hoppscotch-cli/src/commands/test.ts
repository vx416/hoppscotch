import fs from "fs";
import fsPromises from "fs/promises";
import chalk from "chalk";
import { log } from "console";
import { isSafeInteger } from "lodash-es";
import Papa from "papaparse";
import path from "path";

import { handleError } from "../handlers/error";
import { parseDelayOption } from "../options/test/delay";
import { parseEnvsData } from "../options/test/env";
import { IterationDataItem } from "../types/collections";
import { TestCmdEnvironmentOptions, TestCmdOptions } from "../types/commands";
import { error } from "../types/errors";
import { isHoppCLIError } from "../utils/checks";
import { resolveCliRuntimeConfig } from "../utils/config";
import { loadRequestEnvironments } from "../utils/environment";
import {
  collectionsRunner,
  collectionsRunnerExit,
  collectionsRunnerResult,
} from "../utils/collections";
import { findCollectionMatches, loadWorkspaceCollectionsTree } from "../utils/collection";
import { parseCollectionData } from "../utils/mutators";
import { processRequest } from "../utils/request";
import {
  applyRequestMapToCollections,
  parseRequestMap,
} from "../utils/request-map";
import { resolveRequestContext } from "../utils/request-resolver";
import { RequestReport } from "../types/request";

type RequestExecutionResult = Awaited<ReturnType<ReturnType<typeof processRequest>>>;

type JsonRequestExecution = {
  path: string;
  request: {
    id: string;
    name: string;
    method: string;
    endpoint: string;
  };
  response: RequestExecutionResult["response"];
  tests: RequestExecutionResult["report"]["tests"];
  errors: RequestExecutionResult["report"]["errors"];
  result: RequestExecutionResult["report"]["result"];
  duration: RequestExecutionResult["report"]["duration"];
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

const resolveGraphQLCollectionSelection = async (params: {
  pathOrId: string;
  teamId: string;
  serverUrl?: string;
  token?: string;
  refreshToken?: string;
  requestTargets?: string[];
}) => {
  const workspaceCollections = await loadWorkspaceCollectionsTree(
    {
      serverUrl: params.serverUrl ?? "",
      token: params.token,
      refreshToken: params.refreshToken,
    },
    params.teamId
  );

  if (!workspaceCollections.ok) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: workspaceCollections.errors.join("; "),
    });
  }

  const matchingCollections = findCollectionMatches(
    workspaceCollections.collections,
    params.pathOrId
  );

  if (matchingCollections.length === 0) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Unable to find a collection matching "${params.pathOrId}".`,
    });
  }

  const requestTargets = params.requestTargets ?? [];

  if (requestTargets.length > 0) {
    const requestMatches = matchingCollections
      .map((match) => {
        const resolvedTargets = requestTargets.map((requestTarget) => {
          const target = stripCollectionPrefix(match.path, requestTarget);

          try {
            resolveRequestContext([match.collection], target);
            return target;
          } catch {
            return null;
          }
        });

        if (resolvedTargets.some((entry) => !entry)) return null;

        return {
          collection: match.collection,
          path: match.path,
          requestTargets: resolvedTargets as string[],
        };
      })
      .filter(
        (
          match
        ): match is {
          collection: (typeof matchingCollections)[number]["collection"];
          path: string;
          requestTargets: string[];
        } => Boolean(match)
      );

    if (requestMatches.length === 1) {
      return requestMatches[0];
    }

    if (requestMatches.length > 1) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: `Multiple collections named "${params.pathOrId}" contain the requested requests. Use a collection id or a full collection path instead.`,
      });
    }

    if (matchingCollections.length > 1) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: `Multiple collections match "${params.pathOrId}", but none contains all requested requests. Use a collection id or a full collection path instead.`,
      });
    }

    throw error({
      code: "INVALID_ARGUMENT",
      data: `Unable to find the requested requests inside "${params.pathOrId}".`,
    });
  }

  if (matchingCollections.length > 1) {
    throw error({
      code: "INVALID_ARGUMENT",
      data: `Multiple collections match "${params.pathOrId}". Use a collection id or a full collection path instead.`,
    });
  }

  return {
    collection: matchingCollections[0].collection,
    path: matchingCollections[0].path,
  };
};

const pathExists = async (pathOrId: string) => {
  try {
    await fsPromises.access(pathOrId);
    return true;
  } catch {
    return false;
  }
};

const withMutedConsole = async <T>(fn: () => Promise<T>) => {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  const noop = () => undefined;

  try {
    console.log = noop as typeof console.log;
    console.info = noop as typeof console.info;
    console.warn = noop as typeof console.warn;
    console.error = noop as typeof console.error;
    return await fn();
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
};

const buildJsonSummary = (requests: JsonRequestExecution[]) => {
  const totalTestCases = requests.reduce(
    (total, request) =>
      total + request.tests.reduce((count, testSuite) => count + testSuite.expectResults.length, 0),
    0
  );
  const totalPassedTestCases = requests.reduce(
    (total, request) =>
      total +
      request.tests.reduce(
        (count, testSuite) =>
          count +
          testSuite.expectResults.filter((result) => result.status === "pass").length,
        0
      ),
    0
  );
  const totalFailedTestCases = requests.reduce(
    (total, request) =>
      total +
      request.tests.reduce(
        (count, testSuite) =>
          count +
          testSuite.expectResults.filter((result) => result.status === "fail").length,
        0
      ),
    0
  );
  const totalErroredTestCases = requests.reduce(
    (total, request) =>
      total +
      request.tests.reduce(
        (count, testSuite) =>
          count +
          testSuite.expectResults.filter((result) => result.status === "error").length,
        0
      ),
    0
  );

  return {
    requests: {
      passed: requests.filter((request) => request.result).length,
      failed: requests.filter((request) => !request.result).length,
    },
    testCases: {
      total: totalTestCases,
      passed: totalPassedTestCases,
      failed: totalFailedTestCases,
      errored: totalErroredTestCases,
    },
    duration: {
      request: requests.reduce((total, request) => total + request.duration.request, 0),
      preRequest: requests.reduce(
        (total, request) => total + request.duration.preRequest,
        0
      ),
      test: requests.reduce((total, request) => total + request.duration.test, 0),
    },
  };
};

export const test = (pathOrId: string, options: TestCmdOptions) => async () => {
  try {
    const {
      delay,
      env,
      request,
      requestMap,
      json,
      iterationCount,
      iterationData,
      reporterJunit,
      legacySandbox,
    } = options;
    const jsonOutputMode = Boolean(json);

    if (
      iterationCount !== undefined &&
      (iterationCount < 1 || !isSafeInteger(iterationCount))
    ) {
      throw error({
        code: "INVALID_ARGUMENT",
        data: "The value must be a positive integer",
      });
    }

    const resolvedDelay = delay ? parseDelayOption(delay) : 0;

    const resolvedRuntimeOptions = await resolveCliRuntimeConfig({
      token: options.token,
      server: options.server,
    });

    const envs = env
      ? (await fsPromises.access(env)
          .then(async () =>
            parseEnvsData({
              ...(options as TestCmdEnvironmentOptions),
              token: resolvedRuntimeOptions.token,
              server: resolvedRuntimeOptions.server,
            })
          )
          .catch(async () =>
            loadRequestEnvironments(
              {
                serverUrl: resolvedRuntimeOptions.server ?? options.server ?? "",
                token: resolvedRuntimeOptions.token ?? options.token,
                refreshToken: resolvedRuntimeOptions.refreshToken,
              },
              env ?? resolvedRuntimeOptions.environmentId,
              resolvedRuntimeOptions.teamId
            )))
      : await loadRequestEnvironments(
          {
            serverUrl: resolvedRuntimeOptions.server ?? options.server ?? "",
            token: resolvedRuntimeOptions.token ?? options.token,
            refreshToken: resolvedRuntimeOptions.refreshToken,
          },
          resolvedRuntimeOptions.environmentId,
          resolvedRuntimeOptions.teamId
        );

    let parsedIterationData: unknown[] | null = null;
    let transformedIterationData: IterationDataItem[][] | undefined;
    const parsedRequestMap = await parseRequestMap(requestMap);
    const requestTargets = [
      ...(request ?? []),
      ...parsedRequestMap.map((entry) => entry.request_name),
    ].filter((value, index, array) => array.indexOf(value) === index);

    let collections: Awaited<ReturnType<typeof parseCollectionData>>;
    let resolvedCollectionPath = "";

    if (await pathExists(pathOrId)) {
      collections = await parseCollectionData(pathOrId, {});
    } else {
      if (!resolvedRuntimeOptions.teamId) {
        throw error({
          code: "INVALID_ARGUMENT",
          data:
            "A team id is required to resolve workspace collections over GraphQL. Pass --team <team_id> or save a default teamId with `hopp config set teamId <id>`.",
        });
      }

      const resolvedCollection = await resolveGraphQLCollectionSelection({
        pathOrId,
        teamId: resolvedRuntimeOptions.teamId,
        serverUrl: resolvedRuntimeOptions.server ?? options.server ?? "",
        token: resolvedRuntimeOptions.token ?? options.token,
        refreshToken: resolvedRuntimeOptions.refreshToken,
        requestTargets,
      });

      collections = [resolvedCollection.collection];
      resolvedCollectionPath = resolvedCollection.path;
    }

    if (iterationData) {
      // Check file existence
      if (!fs.existsSync(iterationData)) {
        throw error({ code: "FILE_NOT_FOUND", path: iterationData });
      }

      // Check the file extension
      if (path.extname(iterationData) !== ".csv") {
        throw error({
          code: "INVALID_DATA_FILE_TYPE",
          data: iterationData,
        });
      }

      const csvData = fs.readFileSync(iterationData, "utf8");
      parsedIterationData = Papa.parse(csvData, { header: true }).data;

      // Transform data into the desired format
      transformedIterationData = parsedIterationData
        .map((item) => {
          const iterationDataItem = item as Record<string, unknown>;
          const keys = Object.keys(iterationDataItem);

          return (
            keys
              // Ignore keys with empty string values
              .filter((key) => iterationDataItem[key] !== "")
              .map(
                (key) =>
                  <IterationDataItem>{
                    key: key,
                    initialValue: iterationDataItem[key],
                    currentValue: iterationDataItem[key],
                    secret: false,
                  }
              )
          );
        })
        // Ignore items that result in an empty array
        .filter((item) => item.length > 0);
    }

    collections = applyRequestMapToCollections(collections, parsedRequestMap);

    const resolvedLegacySandbox = Boolean(legacySandbox);

    let report: RequestReport[];
    if (requestTargets.length > 0) {
      const selectedReports: RequestReport[] = [];
      const jsonRequests: JsonRequestExecution[] = [];
      const originalSelectedEnvs = [...envs.selected];
      const resolvedIterationCount = iterationCount ?? transformedIterationData?.length ?? 1;

      for (let count = 0; count < resolvedIterationCount; count++) {
        envs.selected = [...originalSelectedEnvs];

        if (transformedIterationData) {
          const iterationDataItem = transformedIterationData[
            Math.min(count, transformedIterationData.length - 1)
          ];

          envs.selected = envs.selected
            .filter(
              (envPair) =>
                !iterationDataItem.some((dataPair) => dataPair.key === envPair.key)
            )
            .concat(iterationDataItem);
        }

        for (const requestTarget of requestTargets) {
          const resolved = resolveRequestContext(
            collections,
            stripCollectionPrefix(resolvedCollectionPath, requestTarget)
          );

          if (!jsonOutputMode) {
            log(chalk.yellowBright(`\nRunning: ${chalk.bold(resolved.path)}`));
          }

          const result = await withMutedConsole(() =>
            processRequest({
              path: resolved.path,
              request: resolved.request,
              envs,
              delay: resolvedDelay,
              silent: jsonOutputMode,
              legacySandbox: resolvedLegacySandbox,
              collectionVariables: resolved.collectionVariables,
              inheritedPreRequestScripts: resolved.inheritedPreRequestScripts,
              inheritedTestScripts: resolved.inheritedTestScripts,
            })()
          );

          envs.global = result.envs.global;
          envs.selected = result.envs.selected;
          selectedReports.push(result.report);
          jsonRequests.push({
            path: result.report.path,
            request: {
              id: resolved.request.id,
              name: resolved.request.name,
              method: resolved.request.method,
              endpoint: resolved.request.endpoint,
            },
            response: result.response,
            tests: result.report.tests,
            errors: result.report.errors,
            result: result.report.result,
            duration: result.report.duration,
          });
        }
      }
      report = selectedReports;

      if (json) {
        const jsonOutput = {
          ok: selectedReports.every((requestReport) => requestReport.result),
          collection: {
            source: resolvedCollectionPath || pathOrId,
            name: collections[0]?.name ?? "",
          },
          requests: jsonRequests,
          summary: buildJsonSummary(jsonRequests),
        };

        console.log(JSON.stringify(jsonOutput, null, 2));
        process.exitCode = jsonOutput.ok ? 0 : 1;
        return;
      }
    } else {
      report = await collectionsRunner({
        collections,
        envs,
        delay: resolvedDelay,
        iterationData: transformedIterationData,
        iterationCount,
        legacySandbox: resolvedLegacySandbox,
      });
    }
    const hasSucceeded = collectionsRunnerResult(report, reporterJunit);

    collectionsRunnerExit(hasSucceeded);
  } catch (e) {
    if (isHoppCLIError(e)) {
      handleError(e);
      process.exit(1);
    } else throw e;
  }
};
