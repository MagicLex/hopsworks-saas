// Validation and sanitation for Hopsworks operations

import { ADMIN_API_BASE, HOPSWORKS_API_BASE } from './hopsworks-api';

interface HopsworksCredentials {
  apiUrl: string;
  apiKey: string;
}

/**
 * Get all projects from Hopsworks and return their names and IDs
 */
async function getAllProjects(
  credentials: HopsworksCredentials
): Promise<Array<{ id: number; name: string; created?: string; owner?: string }>> {
  try {
    // Try admin endpoint first for complete list (use expand=creator to avoid N+1)
    const adminResponse = await fetch(
      `${credentials.apiUrl}${ADMIN_API_BASE}/projects?expand=creator`,
      {
        headers: {
          'Authorization': `ApiKey ${credentials.apiKey}`
        }
      }
    );

    if (adminResponse.ok) {
      const data = await adminResponse.json();
      const projects = data.items || data || [];
      // Extract owner username from expanded creator object
      for (const project of projects) {
        if (project.creator?.username) {
          project.owner = project.creator.username;
        }
      }
      return projects;
    }

    // Fallback to regular endpoint
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
      return Array.isArray(data) ? data : (data.items || []);
    }

    return [];
  } catch (error) {
    console.error('Failed to fetch all projects:', error);
    return [];
  }
}

/**
 * Validate project before operations
 * Returns project info if valid, null if not
 */
export async function validateProject(
  credentials: HopsworksCredentials,
  projectName: string
): Promise<{ id: number; name: string; exists: boolean } | null> {
  try {
    const projects = await getAllProjects(credentials);
    const project = projects.find(p => p.name === projectName);

    if (project) {
      return {
        id: project.id,
        name: project.name,
        exists: true
      };
    }

    return null;
  } catch (error) {
    console.error(`Failed to validate project ${projectName}:`, error);
    return null;
  }
}
