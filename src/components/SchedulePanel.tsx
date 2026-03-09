import { useStore } from "../store.js";
import type { CronJob } from "../store.js";
import { sendUserMessage } from "../ws.js";

function JobRow({ job, onDelete }: { job: CronJob; onDelete: () => void }) {
  return (
    <div className="flex items-start gap-3 px-3 py-3 hover:bg-neutral-800/30 group">
      <div className="flex-1 min-w-0">
        <div className="text-neutral-200 text-xs leading-relaxed break-words">
          {job.prompt}
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] font-mono text-neutral-500">{job.humanSchedule || job.cron}</span>
          {job.recurring ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 font-medium">
              recurring
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-700/50 text-neutral-400 font-medium">
              one-shot
            </span>
          )}
          {job.durable && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-400/10 text-blue-400 font-medium">
              durable
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onDelete}
        className="shrink-0 text-red-400/60 hover:text-red-400 text-xs px-1.5 py-0.5 rounded
          opacity-0 group-hover:opacity-100 transition-opacity"
        title="Cancel this scheduled job"
      >
        Cancel
      </button>
    </div>
  );
}

const MIN_CC_VERSION = "2.1.71";

function versionCompare(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export default function SchedulePanel() {
  const cronJobs = useStore((s) => s.cronJobs);
  const turnInProgress = useStore((s) => s.turnInProgress);
  const ccVersion = useStore((s) => s.session?.claude_code_version);
  const needsUpgrade = ccVersion ? versionCompare(ccVersion, MIN_CC_VERSION) < 0 : false;

  const handleDelete = (jobId: string) => {
    sendUserMessage(`Please cancel the scheduled job with id "${jobId}" using CronDelete.`);
  };

  const handleRefresh = () => {
    sendUserMessage("Please list all scheduled cron jobs using CronList.");
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <span className="text-xs font-medium text-neutral-400">
          Scheduled Jobs ({cronJobs.length})
        </span>
        <button
          onClick={handleRefresh}
          disabled={turnInProgress || needsUpgrade}
          className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400
            hover:text-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Refresh
        </button>
      </div>

      {/* Version warning */}
      {needsUpgrade && (
        <div className="mx-3 mt-3 px-3 py-2.5 rounded-lg bg-amber-400/5 border border-amber-400/20">
          <div className="flex items-center gap-2 text-amber-400 text-xs font-medium mb-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0">
              <path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            Claude Code upgrade required
          </div>
          <div className="text-[11px] text-neutral-400 leading-relaxed">
            Scheduled tasks require Claude Code {MIN_CC_VERSION}+. Current version: {ccVersion}.
            Run <span className="font-mono text-neutral-300">claude update</span> to upgrade.
          </div>
        </div>
      )}

      {/* Job list */}
      {cronJobs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3">
          <div className="w-10 h-10 rounded-full bg-neutral-800/60 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-neutral-500">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <div className="text-neutral-500 text-xs leading-relaxed max-w-[220px]">
            No scheduled jobs. Use <span className="font-mono text-neutral-400">/loop</span> in the chat to create recurring tasks.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-neutral-800/50">
          {cronJobs.map((job) => (
            <JobRow key={job.id} job={job} onDelete={() => handleDelete(job.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
