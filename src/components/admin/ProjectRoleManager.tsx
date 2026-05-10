import { useState, useEffect } from 'react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Project {
  name: string;
  id: number;
  namespace: string;
  role?: string;
}

interface UserProjectsViewerProps {
  userId: string;
  userEmail: string;
  isTeamMember: boolean;
  accountOwnerId?: string;
}

export default function UserProjectsViewer({
  userId,
  userEmail,
}: UserProjectsViewerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/admin/project-roles?userId=${userId}`,
        );
        if (!response.ok) {
          const errBody = await response.json();
          throw new Error(errBody.error || 'Failed to fetch projects');
        }
        const data = await response.json();
        setProjects(data.projects || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects');
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, [userId]);

  if (loading) {
    return (
      <Card className="p-4">
        <span className="text-muted-foreground">Loading projects...</span>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-4">
        <p className="font-semibold">User&apos;s Hopsworks Projects</p>
        <p className="text-xs text-muted-foreground">{userEmail}</p>
      </div>

      {error && (
        <div className="mb-4 p-2 bg-destructive/10 border border-destructive rounded">
          <span className="text-sm text-destructive">{error}</span>
        </div>
      )}

      {projects.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          No projects found for this user
        </span>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground mb-2">
            Total: {projects.length} project
            {projects.length !== 1 ? 's' : ''}
          </p>
          {projects.map((project) => (
            <div
              key={project.id}
              className="p-3 border border-border rounded"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{project.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Project ID: {project.id} | Namespace: {project.namespace}
                  </p>
                </div>
                {project.role && <Badge>{project.role}</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
