import { HoppCollection } from "@hoppscotch/data";
import { describe, expect, test } from "vitest";

import {
  listRequestContexts,
  resolveRequestContext,
} from "../../utils/request-resolver";

const SAMPLE_COLLECTION: HoppCollection = {
  v: 1,
  id: "root-collection",
  name: "root",
  folders: [
    {
      v: 1,
      id: "folder-1",
      name: "folder",
      folders: [],
      requests: [
        {
          v: "1",
          id: "request-1",
          name: "target-request",
          method: "GET",
          endpoint: "https://example.com",
          params: [],
          headers: [],
          preRequestScript: "",
          testScript: "",
          auth: {
            authActive: true,
            authType: "inherit",
          },
          body: {
            contentType: null,
            body: null,
          },
          requestVariables: [],
          responses: {},
        },
      ],
      auth: {
        authActive: true,
        authType: "inherit",
      },
      headers: [
        {
          key: "folder-header",
          value: "folder",
          active: true,
          description: "",
        },
      ],
      variables: [
        {
          key: "folder-var",
          initialValue: "folder",
          currentValue: "folder",
          secret: false,
        },
      ],
      preRequestScript: "folder-pre",
      testScript: "folder-test",
    },
  ],
  requests: [],
  auth: {
    authActive: true,
    authType: "basic",
    username: "root-user",
    password: "root-pass",
  },
  headers: [
    {
      key: "root-header",
      value: "root",
      active: true,
      description: "",
    },
  ],
  variables: [
    {
      key: "root-var",
      initialValue: "root",
      currentValue: "root",
      secret: false,
    },
  ],
  preRequestScript: "root-pre",
  testScript: "root-test",
};

describe("request resolver", () => {
  test("resolves a request by full path and preserves inherited context", () => {
    const resolved = resolveRequestContext([SAMPLE_COLLECTION], "root/folder/target-request");

    expect(resolved.path).toBe("root/folder/target-request");
    expect(resolved.request.id).toBe("request-1");
    expect(resolved.collection.name).toBe("folder");
    expect(resolved.collection.headers).toEqual([
      {
        key: "folder-header",
        value: "folder",
        active: true,
        description: "",
      },
      {
        key: "root-header",
        value: "root",
        active: true,
        description: "",
      },
    ]);
    expect(resolved.collectionVariables).toEqual([
      {
        key: "folder-var",
        initialValue: "folder",
        currentValue: "folder",
        secret: false,
      },
      {
        key: "root-var",
        initialValue: "root",
        currentValue: "root",
        secret: false,
      },
    ]);
    expect(resolved.inheritedPreRequestScripts).toEqual(["root-pre", "folder-pre"]);
    expect(resolved.inheritedTestScripts).toEqual(["root-test", "folder-test"]);
  });

  test("resolves a request by id", () => {
    const resolved = resolveRequestContext([SAMPLE_COLLECTION], "request-1");

    expect(resolved.request.name).toBe("target-request");
  });

  test("rejects ambiguous request names", () => {
    const duplicateCollections: HoppCollection[] = [
      {
        ...SAMPLE_COLLECTION,
        folders: [
          SAMPLE_COLLECTION.folders[0],
          {
            ...SAMPLE_COLLECTION.folders[0],
            id: "folder-2",
          },
        ],
      },
    ];

    expect(() =>
      resolveRequestContext(duplicateCollections, "target-request")
    ).toThrow('Multiple requests named "target-request" exist. Use a request id or full path instead.');
  });

  test("lists request contexts for a collection tree", () => {
    const contexts = listRequestContexts([SAMPLE_COLLECTION]);

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      path: "root/folder/target-request",
      request: {
        id: "request-1",
        name: "target-request",
      },
    });
  });
});
