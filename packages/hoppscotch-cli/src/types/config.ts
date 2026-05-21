export type HoppscotchCliConfig = {
  server?: string;
  token?: string;
  refreshToken?: string;
  teamId?: string;
  workspaceId?: string;
  collectionId?: string;
  environmentId?: string;
};

export type HoppscotchCliConfigKey = keyof HoppscotchCliConfig;
