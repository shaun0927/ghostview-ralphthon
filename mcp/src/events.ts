import { readFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface GvEvent {
  type: string;
  issue?: number;
  phase?: number;
  detail?: Record<string, unknown>;
  at: string;
}

function eventsPath(cwd: string): string {
  return join(cwd, 'state', 'events.jsonl');
}

export function appendEvent(cwd: string, event: Omit<GvEvent, 'at'>): GvEvent {
  const full: GvEvent = { ...event, at: new Date().toISOString() };
  appendFileSync(eventsPath(cwd), JSON.stringify(full) + '\n');
  return full;
}

export function readEvents(cwd: string): GvEvent[] {
  const p = eventsPath(cwd);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

export function lastEvent(cwd: string): GvEvent | null {
  const events = readEvents(cwd);
  return events.length > 0 ? events[events.length - 1] : null;
}
