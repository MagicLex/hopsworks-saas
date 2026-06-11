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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {isActive ? (
          <>
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-quartz-primary-shade2 text-primary">
              <CheckCircle size={12} />
              Active in Hopsworks
            </span>
            <span className="inline-flex items-center text-xs font-mono px-2 py-0.5 rounded-full bg-quartz-label-blue-shade2 text-quartz-label-blue">
              {hopsworksUsername}
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-quartz-label-yellow-shade2 text-quartz-label-orange">
            <AlertCircle size={12} />
            Syncing to Hopsworks...
          </span>
        )}
      </div>

      {syncedProjects.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {syncedProjects.map((project) => (
            <span
              key={project.project_name}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-quartz-primary/10 text-primary rounded-full text-xs font-medium"
              title={`Role: ${project.role}`}
            >
              <FolderOpen size={12} />
              {project.project_name}
              {onRemoveProject && (
                <button
                  type="button"
                  aria-label={`Remove from ${project.project_name}`}
                  className="-mr-1 rounded-full p-0.5 text-primary/60 hover:bg-quartz-primary/20 hover:text-destructive disabled:opacity-50 transition-colors"
                  disabled={removingProject === project.project_name}
                  onClick={() => onRemoveProject(project.project_name)}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
