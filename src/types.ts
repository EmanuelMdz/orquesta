export type Role = 'astra' | 'opus' | 'quality' | 'system' | 'user';
export type Phase = 'plan' | 'implement' | 'decide' | 'tests' | 'review';
export type RunStatus = 'created' | 'running' | 'paused' | 'waiting_user' | 'blocked' | 'completed';
export type TaskStatus = 'queued' | 'implementing' | 'waiting_astra' | 'testing' | 'reviewing' | 'approved' | 'integrated' | 'blocked';
export interface Change { path: string; content: string; action: 'write' | 'delete' }
export interface TaskSpec { id: string; title: string; description: string; allowedPaths: string[]; dependsOn: string[]; acceptance: string[] }
export interface Plan { summary: string; tasks: TaskSpec[] }
export interface Decision { taskId: string; question: string; answer: string; source: 'astra' | 'user' }
export interface Check { name: string; command: string; args: string[] }
export interface CheckResult { name: string; command: string[]; exitCode: number; output: string; durationMs: number; sha: string }
export interface Task extends TaskSpec {
  status: TaskStatus; worktree?: string; branch?: string; commit?: string; base?: string;
  attempts: number; questions: number; workerSession?: string; qaFiles?: Change[];
  feedback?: string; checks: CheckResult[]; review?: { verdict: string; summary: string; findings: string[] };
  pendingQuestion?: string; error?: string;
}
export interface Run {
  id: string; repo: string; objective: string; mode: 'live' | 'demo'; status: RunStatus;
  createdAt: string; updatedAt: string; base: string; integration: string; integrationBranch: string;
  tasks: Task[]; decisions: Decision[]; checks: CheckResult[]; calls: number; summary: string;
  error?: string; finalSha?: string;
}
export interface Event {
  seq?: number; runId: string; time: string; role: Role; type: string; message: string;
  taskId?: string; data?: unknown;
}
export interface Config {
  version: 1; astraModel: string; opusModel: string; codexPath?: string; claudePath?: string;
  workers: number; maxCorrections: number; maxQuestions: number; maxCalls: number;
  timeoutMs: number; maxContextBytes: number; qaRoot: string; qaCommand: string[]; checks: Check[];
}
export interface AgentRequest {
  phase: Phase; role: Role; cwd: string; prompt: string; schema: object; signal: AbortSignal;
  task?: Task; run: Run; session?: string; onEvent: (type: string, message: string, data?: unknown) => void;
}
export interface AgentResult { value: any; session?: string }
export interface Provider { invoke(request: AgentRequest): Promise<AgentResult> }
