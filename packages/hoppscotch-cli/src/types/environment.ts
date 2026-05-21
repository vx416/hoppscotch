export type GraphQLEnvironmentRecord = {
  id: string;
  userUid: string;
  name?: string | null;
  variables: string;
  isGlobal: boolean;
};

export type GraphQLEnvironmentListResult = {
  me: {
    environments?: GraphQLEnvironmentRecord[];
    globalEnvironments?: GraphQLEnvironmentRecord[];
  };
};

export type GraphQLEnvironmentMutationResult = {
  createUserEnvironment?: GraphQLEnvironmentRecord;
  createUserGlobalEnvironment?: { id: string };
  updateUserEnvironment?: GraphQLEnvironmentRecord;
  deleteUserEnvironment?: boolean;
  deleteUserEnvironments?: number;
  clearGlobalEnvironments?: GraphQLEnvironmentRecord;
};

export type NormalizedEnvironmentRecord = GraphQLEnvironmentRecord & {
  parsedVariables: unknown;
};
