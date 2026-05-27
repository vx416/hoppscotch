import { describe, expect, test } from "vitest";

import { getTestJsonFilePath, runCLI } from "../../utils";

describe("hopp request", { timeout: 30000 }, () => {
  test("shows the complete raw JSON for a GraphQL exported request", async () => {
    const collectionPath = getTestJsonFilePath(
      "request-show-graphql-export-coll.json",
      "collection"
    );
    const result = await runCLI(`request show "GraphQL Root/Get User" ${collectionPath}`);

    expect(result.error).toBeNull();

    const output = JSON.parse(result.stdout);

    expect(output).toMatchObject({
      ok: true,
      collection: {
        source: collectionPath,
        name: "GraphQL Root",
        path: "GraphQL Root",
      },
      request: {
        id: "gql-request-1",
        name: "Get User",
        path: "GraphQL Root/Get User",
      },
      errors: [],
    });
    expect(output.request.json).toMatchObject({
      id: "gql-request-1",
      name: "Get User",
      url: "https://api.example.com/graphql",
      query: "query GetUser($id: ID!) { user(id: $id) { id } }",
      variables: "{\"id\":\"1\"}",
    });
    expect(output.request.json.method).toBeUndefined();
    expect(output.request.json.endpoint).toBeUndefined();
  });
});
