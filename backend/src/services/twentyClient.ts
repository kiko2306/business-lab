/**
 * Twenty GraphQL client — only what twentyAdminBootstrap.ts needs.
 *
 * Twenty v2.39.5 disables GraphQL introspection, so this is built by reading
 * the pinned tag's own source (`twentyhq/twenty` @ `twenty/v2.39.5`), not by
 * probing the live endpoint — the auth surface is small and stable enough
 * that the exact operations below are worth pinning as source-verified:
 *
 * - `checkUserExists(email)` — public query, auth.resolver.ts:169-175 — DOES
 *   exist in this version (an earlier investigation, §421, concluded it and
 *   `clientConfig` were both gone; a re-check of the actual source shows only
 *   `clientConfig` is — `checkUserExists` still answers `{ exists,
 *   availableWorkspacesCount }` with no auth required).
 * - `signUp(email, password)` — public mutation, auth.resolver.ts:440-472 —
 *   creates a **user with no workspace yet** and returns a "workspace
 *   agnostic" access token (`tokens.accessOrWorkspaceAgnosticToken`), gated
 *   by `assertSignUpEnabled()`: allowed while `IS_MULTIWORKSPACE_ENABLED` is
 *   true or `workspaceRepository.count() === 0`
 *   (sign-in-up.service.ts:472-479). `IS_MULTIWORKSPACE_ENABLED` defaults to
 *   `false` (config-variables.ts:1960) for a self-hosted single-workspace
 *   instance, so **this is the actual, self-closing safety net**: once the
 *   first workspace exists, `signUp` throws `SIGNUP_DISABLED` for everyone,
 *   including us. Nothing about Authelia is involved — Twenty is exposed
 *   directly (services.ts `skipAutheliaProtection`), so the real race is
 *   against the first anonymous visitor to the public hostname, not "an
 *   authenticated Authelia user" as §421 assumed.
 * - `signIn(email, password)` — public mutation, same shape as `signUp` —
 *   the resume path if a prior run created the user but not the workspace
 *   (bootstrap interrupted between the two steps).
 * - `signUpInNewWorkspace(input: {displayName, subdomain})` — auth.resolver.ts
 *   :596-632 — requires `UserAuthGuard` (the workspace-agnostic token as a
 *   Bearer header), creates the workspace, and grants the creating user
 *   `canAccessFullAdminPanel` when no server admin exists yet
 *   (sign-in-up.service.ts `shouldGrantServerAdmin`) — i.e. workspace owner.
 *   `subdomain` is optional; omitted here, Twenty derives one.
 *
 * A separate, real finding from the same read: `IS_SIGN_UP_ENABLED` — the
 * env var apps/twenty/docker-compose.yml sets and docs/app-credentials.md
 * tells the operator to flip off from the admin panel — is not a config
 * variable Twenty v2.39.5 reads at all (zero matches in
 * twenty-config/config-variables.ts, the exhaustive list of real ones, and
 * zero in a GitHub code search of the whole repo). It's a no-op left over
 * from stale documentation. The workspace-count gate above is what actually
 * closes the door, automatically, with no toggle needed.
 */

import logger from '../utils/logger';

const REQUEST_TIMEOUT_MS = 10_000;

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string; subCode?: string } }>;
}

async function graphqlRequest<T>(
  baseUrl: string,
  query: string,
  variables: Record<string, unknown>,
  accessToken?: string
): Promise<GraphQLResponse<T> | null> {
  try {
    const response = await fetch(`${baseUrl}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return (await response.json()) as GraphQLResponse<T>;
  } catch {
    return null;
  }
}

export type TwentyUserState = 'unreachable' | 'needs-signup' | 'needs-workspace' | 'already-owned';

/**
 * `needs-workspace` means the account exists but claimed no workspace yet —
 * either our own bootstrap got interrupted between `signUp` and
 * `signUpInNewWorkspace` on a prior run, or (unlikely, same email) someone
 * else's half-finished signup. Either way the safe move is to resume with
 * our own known password, which only succeeds if it's actually our account.
 */
export async function checkTwentyUserState(baseUrl: string, email: string): Promise<TwentyUserState> {
  const result = await graphqlRequest<{ checkUserExists: { exists: boolean; availableWorkspacesCount: number } }>(
    baseUrl,
    `query CheckUserExists($email: String!) { checkUserExists(email: $email) { exists availableWorkspacesCount } }`,
    { email }
  );
  const data = result?.data?.checkUserExists;
  if (!data) return 'unreachable';
  if (!data.exists) return 'needs-signup';
  return data.availableWorkspacesCount > 0 ? 'already-owned' : 'needs-workspace';
}

/** `signUp` for a brand-new account, `signIn` to resume one `signUp` already created. */
export async function getTwentyAccessToken(
  baseUrl: string,
  op: 'signUp' | 'signIn',
  email: string,
  password: string
): Promise<string | null> {
  const query =
    op === 'signUp'
      ? `mutation SignUp($email: String!, $password: String!) { signUp(email: $email, password: $password) { tokens { accessOrWorkspaceAgnosticToken { token } } } }`
      : `mutation SignIn($email: String!, $password: String!) { signIn(email: $email, password: $password) { tokens { accessOrWorkspaceAgnosticToken { token } } } }`;
  const result = await graphqlRequest<Record<string, { tokens: { accessOrWorkspaceAgnosticToken: { token: string } } }>>(
    baseUrl,
    query,
    { email, password }
  );
  if (result?.errors?.length) {
    logger.warn('Twenty admin bootstrap: GraphQL error', {
      op,
      messages: result.errors.map((e) => e.extensions?.subCode ?? e.message),
    });
  }
  return result?.data?.[op]?.tokens?.accessOrWorkspaceAgnosticToken?.token ?? null;
}

/** `signUpInNewWorkspace` — creates the workspace and makes `accessToken`'s user its owner. */
export async function createTwentyWorkspace(
  baseUrl: string,
  accessToken: string,
  displayName: string
): Promise<boolean> {
  const result = await graphqlRequest<{ signUpInNewWorkspace: { workspace: { id: string } } }>(
    baseUrl,
    `mutation SignUpInNewWorkspace($input: SignUpInNewWorkspaceInput) { signUpInNewWorkspace(input: $input) { workspace { id } } }`,
    { input: { displayName } },
    accessToken
  );
  if (result?.errors?.length) {
    logger.warn('Twenty admin bootstrap: workspace creation GraphQL error', {
      messages: result.errors.map((e) => e.extensions?.subCode ?? e.message),
    });
  }
  return Boolean(result?.data?.signUpInNewWorkspace?.workspace?.id);
}
