import fs from "fs/promises";
import { HoppCollection } from "@hoppscotch/data";
import { z } from "zod";

import { error } from "../types/errors";

export type RequestMapEntry = {
  request_name: string;
  request_body: unknown;
};

const RequestMapSchema = z.array(
  z.object({
    request_name: z.string().min(1),
    request_body: z.unknown(),
  })
);

const readStructuredJsonInput = async (input: string) => {
  let rawInput = input;

  try {
    await fs.access(input);
    rawInput = await fs.readFile(input, "utf8");
  } catch {
    // Treat the argument as inline JSON when it is not a readable file path.
  }

  try {
    return JSON.parse(rawInput);
  } catch {
    throw error({
      code: "INVALID_ARGUMENT",
      data:
        "Expected a JSON string or a path to a JSON file. The provided value is not valid JSON.",
    });
  }
};

export const parseRequestMap = async (input?: string) => {
  if (!input) return [];

  const parsedInput = await readStructuredJsonInput(input);
  const requestMapResult = RequestMapSchema.safeParse(parsedInput);

  if (!requestMapResult.success) {
    throw error({
      code: "INVALID_ARGUMENT",
      data:
        "Expected an array of objects with request_name and request_body fields.",
    });
  }

  return requestMapResult.data;
};

const serializeRequestBody = (requestBody: unknown) => {
  if (requestBody === undefined) {
    return undefined;
  }

  if (typeof requestBody === "string") {
    return requestBody;
  }

  return JSON.stringify(requestBody);
};

const applyRequestBodyOverride = <T extends HoppCollection["requests"][number]>(
  request: T,
  requestBody: unknown
): T => {
  const body = serializeRequestBody(requestBody);

  if (body === undefined) {
    return request;
  }

  return {
    ...request,
    body: {
      ...(request.body ?? { contentType: null, body: null }),
      body,
      contentType:
        typeof requestBody === "string"
          ? request.body?.contentType ?? "text/plain"
          : "application/json",
    },
  };
};

export const applyRequestMapToCollections = (
  collections: HoppCollection[],
  requestMap: RequestMapEntry[]
): HoppCollection[] => {
  if (requestMap.length === 0) {
    return collections;
  }

  const requestMapByName = new Map(
    requestMap.map((entry) => [entry.request_name, entry.request_body] as const)
  );

  const applyToCollection = (collection: HoppCollection): HoppCollection => ({
    ...collection,
    requests: collection.requests.map((request) => {
      const requestBody = requestMapByName.get(request.name);

      if (requestBody === undefined) {
        return request;
      }

      return applyRequestBodyOverride(request, requestBody);
    }),
    folders: collection.folders.map(applyToCollection),
  });

  return collections.map(applyToCollection);
};
