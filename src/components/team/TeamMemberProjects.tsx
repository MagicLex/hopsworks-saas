import { CheckCircle, AlertCircle, FolderOpen, X } from 'lucide-react';

interface ProjectRole {
  project_name: string;
  role: string;
  synced_to_hopsworks: boolean;
}

interface TeamMemberProjectsProps {
  memberId: string;
  memberEmail: string;
  memberName: string;
  hopsworksUsername?: string;
  clusterUrl?: string;
  projects?: ProjectRole[];
  /** Owner-only: remove the member from one project. Renders an X on each chip. */
  onRemoveProject?: (projectName: string) => void;
  removingProject?: string | null;
}

export default function TeamMemberProjects({
  hopsworksUsername,
  projects,
  onRemoveProject,
  removingProject,
}: TeamMemberProjectsProps) {
  const isActive = !!hopsworksUsername;
  const syncedProjects = projects?.filter((p) => p.synced_to_hopsworks) || [];

  return (
    <div>
      <div className="flex items-center gap-2">
        {isActive ? (
          <>
            <span className="inline-flex items-center text-xs px-2 py-1 rounded bg-quartz-primary-shade2 text-primary border border-primary">
              <CheckCircle size={12} className="mr-1" />
              Active in Hopsworks
            </span>
            <span className="text-xs text-muted-foreground">
              {hopsworksUsername}
            </span>
          </>
        ) : (
          <span className="inline-flex items-center text-xs px-2 py-1 rounded bg-quartz-label-yellow-shade2 text-quartz-label-orange border border-quartz-label-orange">
            <AlertCircle size={12} className="mr-1" />
            Syncing to Hopsworks...
          </span>
        )}
      </div>

      {syncedProjects.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2">
          <FolderOpen size={14} className="text-muted-foreground" />
          <div className="flex gap-1.5 flex-wrap">
            {syncedProjects.map((project) => (
              <span
                key={project.project_name}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-muted text-foreground"
                title={`Role: ${project.role}`}
              >
                {project.project_name}
                {onRemoveProject && (
                  <button
                    type="button"
                    aria-label={`Remove from ${project.project_name}`}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    disabled={removingProject === project.project_name}
                    onClick={() => onRemoveProject(project.project_name)}
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
