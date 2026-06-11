// Hopsworks team and project management functions

import { ADMIN_API_BASE, HOPSWORKS_API_BASE } from './hopsworks-api';
import { validateProject } from './hopsworks-validation';

// Disable SSL verification for self-signed certificates
if (typeof process !== 'undefined') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

interface HopsworksCredentials {
  apiUrl: string;
  apiKey: string;
}

/**
 * Add a user to a project with a specific role
 * Uses the admin endpoint POST /admin/projects/add-to-projects
 */
export async function addUserToProject(
  credentials: HopsworksCredentials,
  projectName: string,
  hopsworksUserId: number,
  role: 'Data owner' | 'Data scientist' = 'Data scientist'
): Promise<void> {
  // VALIDATE PROJECT EXISTS FIRST
  const project = await validateProject(credentials, projectName);
  if (!project) {
    throw new Error(`Project '${projectName}' does not exist in Hopsworks`);
  }

  // Get user details by ID (correct API endpoint)
  const { getHopsworksUserById } = await import('./hopsworks-api');
  const userData = await getHopsworksUserById(credentials, hopsworksUserId);

  if (!userData) {
    throw new Error(`User ${hopsworksUserId} not found in Hopsworks`);
  }

  const userEmail = userData.email;
  const username = userData.username;

  console.log(`Adding user ${username} (ID: ${hopsworksUserId}, email: ${userEmail}) to project ${projectName} (id: ${project.id}) as ${role}`);

  // Use the admin endpoint to add user to projects
  const response = await fetch(
    `${credentials.apiUrl}${ADMIN_API_BASE}/projects/add-to-projects`,
    {
      method: 'POST',
      headers: {
        'Authorization': `ApiKey ${credentials.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: username,
        role: role,
        projectIds: [project.id]
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to add user to project:`, errorText);

    // Check if it's a project not found error
    if (errorText.includes('404') || errorText.includes('Not Found')) {
      throw new Error(`Project '${projectName}' not found or inaccessible`);
    }

    // Check if user is already a member
    if (errorText.includes('already') || errorText.includes('exist')) {
      console.log(`User ${username} is already a member of ${projectName}`);
      return; // Not an error if already member
    }

    throw new Error(`Failed to add user to project: ${response.statusText} - ${errorText}`);
  }

  console.log(`Successfully added ${username} to ${projectName} as ${role}`);
}

/**
 * Remove a member from a project.
 * Uses DELETE /project/{projectId}/projectMembers/{email} — the project-scoped
 * endpoint accepts the admin API key (verified against prod 2026-06-11).
 * Idempotent: 404 (not a member) is treated as success.
 */
export async function removeUserFromProject(
  credentials: HopsworksCredentials,
  projectId: number,
  memberEmail: string
): Promise<void> {
  const response = await fetch(
    `${credentials.apiUrl}${HOPSWORKS_API_BASE}/project/${projectId}/projectMembers/${encodeURIComponent(memberEmail)}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `ApiKey ${credentials.apiKey}`
      }
    }
  );

  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`Failed to remove ${memberEmail} from project ${projectId}: ${response.statusText} - ${errorText}`);
  }
  console.log(`Removed ${memberEmail} from project ${projectId}`);
}

// createGroupMapping removed - use addUserToProject which uses admin endpoint

/**
 * Get projects owned by a specific user
 * Filters projects by owner identifier (email or username)
 * Note: Hopsworks stores project.owner as email for OAuth users
 */
export async function getUserProjects(
  credentials: HopsworksCredentials,
  ownerIdentifier: string
): Promise<any[]> {
  try {
    // Get ALL projects via admin endpoint with expanded creator info
    const adminResponse = await fetch(
      `${credentials.apiUrl}${ADMIN_API_BASE}/projects?expand=creator`,
      {
        headers: {
          'Authorization': `ApiKey ${credentials.apiKey}`
        }
      }
    );

    if (adminResponse.ok) {
      const adminData = await adminResponse.json();
      const allProjects = adminData.items || adminData || [];

      console.log(`Total projects from Hopsworks: ${allProjects.length}`);

      // Filter to only projects owned by this identifier (email or username)
      const userProjects = allProjects.filter((project: any) => {
        // With expand=creator, project.creator contains: {email, username, firstname, lastname, href}
        // Legacy: project.owner might exist as string or object
        let projectOwnerEmail: string | undefined;
        let projectOwnerUsername: string | undefined;

        if (project.creator) {
          // New API format with expanded creator
          projectOwnerEmail = project.creator.email;
          projectOwnerUsername = project.creator.username;
        } else if (project.owner) {
          // Legacy format
          if (typeof project.owner === 'object') {
            projectOwnerEmail = project.owner.email;
            projectOwnerUsername = project.owner.username;
          } else {
            // Direct string (could be email or username)
            projectOwnerUsername = project.owner;
          }
        }

        // Debug: log first project to see structure
        if (allProjects.indexOf(project) === 0) {
          console.log('Sample project structure:', JSON.stringify({
            name: project.name,
            creator: project.creator,
            extractedEmail: projectOwnerEmail,
            extractedUsername: projectOwnerUsername
          }));
        }

        // Match by email OR username
        return projectOwnerEmail === ownerIdentifier || projectOwnerUsername === ownerIdentifier;
      });

      console.log(`Found ${userProjects.length} projects owned by ${ownerIdentifier} (out of ${allProjects.length} total)`);
      return userProjects;
    }
  } catch (error) {
    console.error('Failed to fetch from admin endpoint:', error);
  }

  try {
    // Fallback: try regular project endpoint (already filtered by user auth)
    const response = await fetch(
      `${credentials.apiUrl}${HOPSWORKS_API_BASE}/project`,
      {
        headers: {
          'Authorization': `ApiKey ${credentials.apiKey}`
        }
      }
    );

    if (response.ok) {
      const data = await response.json();
      const projects = Array.isArray(data) ? data : (data.items || []);

      // Filter by owner just in case
      return projects.filter((project: any) => {
        let projectOwnerEmail: string | undefined;
        let projectOwnerUsername: string | undefined;

        if (project.creator) {
          projectOwnerEmail = project.creator.email;
          projectOwnerUsername = project.creator.username;
        } else if (project.owner) {
          if (typeof project.owner === 'object') {
            projectOwnerEmail = project.owner.email;
            projectOwnerUsername = project.owner.username;
          } else {
            projectOwnerUsername = project.owner;
          }
        }

        return projectOwnerEmail === ownerIdentifier || projectOwnerUsername === ownerIdentifier;
      });
    }
  } catch (error) {
    console.error('Failed to fetch from project endpoint:', error);
  }

  // If all else fails, return empty array
  console.log(`No projects found for owner ${ownerIdentifier}`);
  return [];
}

// getMemberProjects removed - too complex for read-only display
// Team member project management should be done directly in Hopsworks UI
// See docs/reference/hopsworks-api.md for API findings and alternatives

// addTeamMemberToOwnerProjects removed - use addUserToProject directly

// createTeamProject removed - use addUserToProject directly for each member