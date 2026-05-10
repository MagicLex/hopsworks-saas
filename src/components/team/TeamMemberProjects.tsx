import { CheckCircle, AlertCircle, FolderOpen } from 'lucide-react';

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
}

export default function TeamMemberProjects({
  hopsworksUsername,
  projects,
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
                className="inline-flex items-center text-xs px-2 py-0.5 rounded bg-muted text-foreground"
                title={`Role: ${project.role}`}
              >
                {project.project_name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
