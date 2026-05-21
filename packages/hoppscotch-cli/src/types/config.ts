export type HoppscotchCliConfig = {
  server?: string;
  token?: string;
  workspaceId?: string;
  collectionId?: string;
  environmentId?: string;
};

export type HoppscotchCliConfigKey = keyof HoppscotchCliConfig;
