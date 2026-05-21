import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, test } from "vitest";

import { makeCollection, makeRESTRequest } from "@hoppscotch/data";

import {
  applyRequestMapToCollections,
  parseRequestMap,
} from "../../utils/request-map";

describe("request map", () => {
  test("parses an inline JSON request map", async () => {
    await expect(
      parseRequestMap(
        JSON.stringify([
          {
            request_name: "login",
            request_body: { a: 1 },
          },
        ])
      )
    ).resolves.toEqual([
      {
        request_name: "login",
        request_body: { a: 1 },
      },
    ]);
  });

  test("applies request bodies to matching requests from a file path", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hopp-request-map-"));
    const requestMapPath = path.join(tempDir, "request-map.json");

    await fs.writeFile(
      requestMapPath,
      JSON.stringify([
        {
          request_name: "login",
          request_body: { username: "alice", password: "secret" },
        },
      ])
    );

    const requestMap = await parseRequestMap(requestMapPath);
    const collections = [
      makeCollection({
        name: "root",
        folders: [],
        requests: [
          makeRESTRequest({
            name: "login",
            method: "POST",
            endpoint: "https://example.com/login",
            params: [],
            headers: [],
            auth: { authType: "inherit", authActive: true },
            preRequestScript: "",
            testScript: "",
            body: { contentType: null, body: null },
            requestVariables: [],
            responses: {},
            description: null,
          }),
          makeRESTRequest({
            name: "health",
            method: "GET",
            endpoint: "https://example.com/health",
            params: [],
            headers: [],
            auth: { authType: "inherit", authActive: true },
            preRequestScript: "",
            testScript: "",
            body: { contentType: null, body: null },
            requestVariables: [],
            responses: {},
            description: null,
          }),
        ],
        auth: { authType: "inherit", authActive: true },
        headers: [],
        variables: [],
        description: null,
        preRequestScript: "",
        testScript: "",
      }),
    ];

    const updatedCollections = applyRequestMapToCollections(collections, requestMap);

    expect(updatedCollections[0].requests[0]).toMatchObject({
      name: "login",
      body: {
        contentType: "application/json",
        body: JSON.stringify({
          username: "alice",
          password: "secret",
        }),
      },
    });

    expect(updatedCollections[0].requests[1]).toMatchObject({
      name: "health",
      body: {
        contentType: null,
        body: null,
      },
    });
  });
});
