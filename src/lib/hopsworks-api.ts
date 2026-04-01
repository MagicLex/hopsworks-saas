// Hopsworks API integration
// Based on patterns from hopsworks-cloud

export const HOPSWORKS_API_BASE = '/hopsworks-api/api';
export const ADMIN_API_BASE = '/hopsworks-api/api/admin';

// For self-signed certificates in both dev and production
// This is needed because Hopsworks uses self-signed certs
if (typeof process !== 'undefined') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

// Create HTTPS agent for environments that support it
let httpsAgent: any = undefined;
if (typeof process !== 'undefined' && process.versions?.node) {
  const https = require('https');
  httpsAgent = new https.Agent({
    rejectUnauthorized: false
  });
}

// Default timeout for Hopsworks API calls (15 seconds)
const HOPSWORKS_API_TIMEOUT_MS = 15000;

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { agent?: any },
  timeoutMs: number = HOPSWORKS_API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`Hopsworks API request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

interface HopsworksCredentials {
  apiUrl: string;
  apiKey: string;
}

interface HopsworksUser {
  username: string;
  email: string;
  id: number;
  firstname?: string;
  lastname?: string;
  accountType?: string;
  status?: number;
  maxNumProjects?: number;
  numActiveProjects?: number;
  activated?: string;
  twoFactor?: boolean;
  toursState?: number;
  href?: string;
}

interface HopsworksProject {
  id: number;
  name: string;
  namespace: string;
  owner: string;
  created: string;
}

interface ProjectUsage {
  date: string;
  compute: {
    instances: Array<{
      type: string;
      hours: number;
      cpuHours: number;
      gpuHours: number;
    }>;
  };
  storage: {
    featureStore: number;
    models: number;
    datasets: number;
    total: number;
  };
  apiCalls: {
    featureStore: number;
    modelServing: number;
    jobs: number;
    total: number;
  };
}

/**
 * Create an OAuth user in Hopsworks
 * Fixed: Uses query params instead of JSON body (HWORKS-2426)
 */
export async function createHopsworksOAuthUser(
  credentials: HopsworksCredentials,
  email: string,
  firstName: string,
  lastName: string,
  auth0Id: string,
  maxNumProjects: number = 5
): Promise<HopsworksUser> {
  // Validate Auth0 ID format
  if (!auth0Id.includes('|')) {
    console.warn(`[Hopsworks API] Auth0 ID missing pipe character: ${auth0Id} (email: ${email})`);
  }

  // Build query params - must use query params, not JSON body
  const params = new URLSearchParams({
    accountType: 'REMOTE_ACCOUNT_TYPE',
    email: email,
    givenName: firstName,
    surname: lastName,
    maxNumProjects: maxNumProjects.toString(),
    subject: auth0Id,
    clientId: process.env.AUTH0_CLIENT_ID!,
    type: 'OAUTH2'
  });

  console.log(`[Hopsworks API] Creating OAuth user: ${email} (subject: ${auth0Id}, encoded: ${encodeURIComponent(auth0Id)}, cluster: ${credentials.apiUrl})`);

  const url = `${credentials.apiUrl}${HOPSWORKS_API_BASE}/admin/users?${params.toString()}`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${credentials.apiKey}`
      // No Content-Type needed for query params
    },
    // @ts-ignore - Node.js fetch doesn't have proper agent typing
    agent: httpsAgent
  });

  if (!response.ok) {
    const errorBody = await response.text();

    // 409 Conflict = user already exists (race condition from concurrent webhooks)
    if (response.status === 409) {
      console.log(`[Hopsworks API] User ${email} already exists on ${credentials.apiUrl} (409 Conflict), fetching existing user`);
      const existingUser = await getHopsworksUserByEmail(credentials, email);
      if (existingUser) {
        return existingUser;
      }
      throw new Error(`Failed to create Hopsworks user ${email} on ${credentials.apiUrl}: 409 Conflict but could not fetch existing user`);
    }

    console.error(`[Hopsworks API] OAuth user creation failed for ${email} on ${credentials.apiUrl}: ${response.status} ${response.statusText}`, errorBody);

    // Parse error message if available
    try {
      const errorJson = JSON.parse(errorBody);
      throw new Error(`Failed to create Hopsworks user ${email} on ${credentials.apiUrl}: ${errorJson.usrMsg || errorJson.errorMsg || response.statusText}`);
    } catch {
      throw new Error(`Failed to create Hopsworks user ${email} on ${credentials.apiUrl}: ${response.statusText}`);
    }
  }

  const data = await response.json();
  // Response format: {uuid, givenName, surname, email, username}
  const username = data.username;

  // Fetch the complete user object to get the actual ID
  // The creation response doesn't include the numeric user ID
  const fullUser = await getHopsworksUserByEmail(credentials, email);

  if (!fullUser) {
    throw new Error(`User ${username} (${email}) created on ${credentials.apiUrl} but could not be retrieved`);
  }

  if (!fullUser.id || fullUser.id <= 0) {
    throw new Error(`User ${username} (${email}) created on ${credentials.apiUrl} but returned invalid ID: ${fullUser.id}`);
  }

  console.log(`[Hopsworks API] Successfully created OAuth user: ${email} (username: ${username}, id: ${fullUser.id})`);

  return {
    username: fullUser.username,
    email: fullUser.email,
    firstname: fullUser.firstname,
    lastname: fullUser.lastname,
    id: fullUser.id
  };
}

/**
 * Create a project for a user
 */
export async function createHopsworksProject(
  credentials: HopsworksCredentials,
  username: string,
  projectName: string
): Promise<void> {
  const response = await fetchWithTimeout(`${credentials.apiUrl}${HOPSWORKS_API_BASE}/admin/projects/createas`, {
    method: 'POST',
    headers: {
      'Authorization': `ApiKey ${credentials.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      owner: username,
      projectName,
      services: ['JOBS', 'HIVE', 'KAFKA', 'FEATURESTORE', 'SERVING']
    }),
    // @ts-ignore
    agent: httpsAgent
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Hopsworks API] Project creation failed for ${projectName} (owner: ${username}) on ${credentials.apiUrl}: ${response.status} ${response.statusText}`, errorBody);

    if (response.status === 409) {
      throw new Error(`Project name already exists: ${projectName} (owner: ${username})`);
    }
    throw new Error(`Failed to create project ${projectName} on ${credentials.apiUrl}: ${response.statusText}`);
  }
}

/**
 * Get user's projects (both owned and member of)
 * Fetches all projects and filters by user ID or username
 */
export async function getUserProjects(
  credentials: HopsworksCredentials,
  username: string,
  userId?: number
): Promise<HopsworksProject[]> {
  // Fetch all projects and filter by owner
  const response = await fetchWithTimeout(
    `${credentials.apiUrl}${ADMIN_API_BASE}/projects?expand=creator`,
    {
      headers: {
        'Authorization': `ApiKey ${credentials.apiKey}`
      },
      // @ts-ignore
      agent: httpsAgent
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch user projects for ${username} on ${credentials.apiUrl}: ${response.statusText}`);
  }

  const data = await response.json();
  const allProjects = data.items || [];

  // Filter projects by creator - use expanded creator object
  const userProjects = allProjects.filter((project: any) => {
    if (project.creator) {
      // Match by user ID if provided
      if (userId && project.creator.id === userId) {
        return true;
      }
      // Match by username
      if (project.creator.username === username) {
        return true;
      }
    }
    // Fallback to old owner field if it exists (for backward compatibility)
    return project.owner === username;
  });

  return userProjects;
}

/**
 * Get project usage for a specific date
 */
export async function getProjectUsage(
  credentials: HopsworksCredentials,
  projectId: number,
  date: string
): Promise<ProjectUsage> {
  // This endpoint needs to be implemented by Hopsworks
  // For now, we'll return mock data structure
  const response = await fetchWithTimeout(
    `${credentials.apiUrl}${HOPSWORKS_API_BASE}/admin/projects/${projectId}/usage?date=${date}`,
    {
      headers: {
        'Authorization': `ApiKey ${credentials.apiKey}`
      },
      // @ts-ignore
      agent: httpsAgent
    }
  );

  if (!response.ok) {
    // If endpoint doesn't exist yet, return empty usage
    if (response.status === 404) {
      return {
        date,
        compute: { instances: [] },
        storage: { featureStore: 0, models: 0, datasets: 0, total: 0 },
        apiCalls: { featureStore: 0, modelServing: 0, jobs: 0, total: 0 }
      };
    }
    throw new Error(`Failed to fetch project usage: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Get user by email (works for OAuth2 users)
 */
export async function getHopsworksUserByEmail(
  credentials: HopsworksCredentials,
  email: string
): Promise<HopsworksUser | null> {
  const response = await fetchWithTimeout(
    `${credentials.apiUrl}${ADMIN_API_BASE}/users`,
    {
      headers: {
        'Authorization': `ApiKey ${credentials.apiKey}`
      },
      // @ts-ignore
      agent: httpsAgent
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch users: ${response.statusText}`);
  }

  const data = await response.json();
  const users = data.items || [];

  // Find user by email - OAuth2 or REMOTE_ACCOUNT_TYPE
  const user = users.find((u: any) =>
    u.email === email && (u.accountType === 'OAUTH2' || u.accountType === 'REMOTE_ACCOUNT_TYPE')
  );

  if (!user) {
    console.log(`[Hopsworks API] User not found by email: ${email} on ${credentials.apiUrl}`);
  }

  return user || null;
}


/**
 * Update user's max number of projects
 */
export async function updateUserProjectLimit(
  credentials: HopsworksCredentials,
  hopsworksUserId: number,
  maxNumProjects: number
): Promise<void> {
  const response = await fetchWithTimeout(
    `${credentials.apiUrl}${ADMIN_API_BASE}/users/${hopsworksUserId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `ApiKey ${credentials.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        maxNumProjects
      }),
      // @ts-ignore
      agent: httpsAgent
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Hopsworks API] Failed to update project limit for user ${hopsworksUserId} on ${credentials.apiUrl}: ${response.status} ${response.statusText}`, errorBody);
    throw new Error(`Failed to update user ${hopsworksUserId} project limit to ${maxNumProjects} on ${credentials.apiUrl}: ${response.statusText}`);
  }
}

/**
 * Update user's account status in Hopsworks
 * Status values:
 * - 2: ACTIVATED_ACCOUNT (active, can login)
 * - 3: DEACTIVATED_ACCOUNT (blocked from login)
 * - 4: BLOCKED_ACCOUNT (blocked for abuse)
 */
export async function updateHopsworksUserStatus(
  credentials: HopsworksCredentials,
  hopsworksUserId: number,
  status: 2 | 3 | 4
): Promise<void> {
  const response = await fetchWithTimeout(
    `${credentials.apiUrl}${ADMIN_API_BASE}/users/${hopsworksUserId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `ApiKey ${credentials.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status
      }),
      // @ts-ignore
      agent: httpsAgent
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Hopsworks API] Failed to update status for user ${hopsworksUserId} on ${credentials.apiUrl}: ${response.status} ${response.statusText}`, errorBody);
    throw new Error(`Failed to update Hopsworks user ${hopsworksUserId} status to ${status} on ${credentials.apiUrl}: ${response.statusText} - ${errorBody}`);
  }
}

/**
 * Get user by ID (numeric user ID from Hopsworks)
 */
export async function getHopsworksUserById(
  credentials: HopsworksCredentials,
  userId: number
): Promise<HopsworksUser | null> {
  try {
    const response = await fetchWithTimeout(
      `${credentials.apiUrl}${ADMIN_API_BASE}/users/${userId}`,
      {
        headers: {
          'Authorization': `ApiKey ${credentials.apiKey}`
        },
        // @ts-ignore
        agent: httpsAgent
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[Hopsworks API] User not found: ${userId} on ${credentials.apiUrl}`);
        return null;
      }
      throw new Error(`Failed to fetch user ${userId} on ${credentials.apiUrl}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[Hopsworks API] Failed to fetch user ${userId} on ${credentials.apiUrl}:`, error);
    return null;
  }
}


/**
 * Get all users (admin endpoint)
 */
export async function getAllUsers(
  credentials: HopsworksCredentials,
  authToken: string
): Promise<HopsworksUser[]> {
  const response = await fetchWithTimeout(
    `${credentials.apiUrl}${ADMIN_API_BASE}/users`,
    {
      headers: {
        'Authorization': authToken
      },
      // @ts-ignore
      agent: httpsAgent
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch users: ${response.statusText}`);
  }

  const data = await response.json();
  return data.items || [];
}

/**
 * Get all projects (admin endpoint)
 */
export async function getAllProjects(
  credentials: HopsworksCredentials,
  authToken: string
): Promise<HopsworksProject[]> {
  // Use expand=creator to get owner details in single query (avoid N+1)
  const response = await fetchWithTimeout(
    `${credentials.apiUrl}${ADMIN_API_BASE}/projects?expand=creator`,
    {
      headers: {
        'Authorization': authToken
      },
      // @ts-ignore
      agent: httpsAgent
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch projects: ${response.statusText}`);
  }

  const data = await response.json();
  const projects = data.items || [];

  // Extract owner username from expanded creator object
  for (const project of projects) {
    if (project.creator?.username) {
      project.owner = project.creator.username;
    }
  }

  return projects;
}


