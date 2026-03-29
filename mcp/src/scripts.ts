import { execSync } from 'child_process';
import { join } from 'path';

interface ExecResult {
  success: boolean;
  output: string;
  exitCode: number;
}

function run(cmd: string, cwd: string): ExecResult {
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf8', timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] });
    return { success: true, output: output.trim(), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      success: false,
      output: (e.stdout || '') + (e.stderr || ''),
      exitCode: e.status ?? 1
    };
  }
}

export function issueStart(cwd: string, issue: number): ExecResult {
  return run(join(cwd, 'scripts', 'issue-start.sh') + ` ${issue}`, cwd);
}

export function issueFinish(cwd: string, issue: number): ExecResult {
  return run(join(cwd, 'scripts', 'issue-finish.sh') + ` ${issue}`, cwd);
}

export function ghIssueList(cwd: string, label: string): Array<{ number: number; title: string }> {
  const result = run(`gh issue list --label "${label}" --json number,title -q '.'`, cwd);
  if (!result.success) return [];
  try {
    return JSON.parse(result.output);
  } catch {
    return [];
  }
}

export function ghIssueView(cwd: string, issue: number): { title: string; body: string; labels: string[] } | null {
  const result = run(`gh issue view ${issue} --json title,body,labels -q '.'`, cwd);
  if (!result.success) return null;
  try {
    const data = JSON.parse(result.output);
    return {
      title: data.title,
      body: data.body,
      labels: (data.labels || []).map((l: { name: string }) => l.name)
    };
  } catch {
    return null;
  }
}

export function readPhaseGate(cwd: string): Record<string, string> {
  try {
    const raw = require(join(cwd, 'state', 'phase-gate.json'));
    return raw;
  } catch {
    return {};
  }
}
