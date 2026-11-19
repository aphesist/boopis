/* Pure mappings from what Hermes and the plugin report about a profile to a `Bot` (`data/types.ts`). A bot is a Hermes
   profile; its name is the profile's display name when Hermes has one and its profile name otherwise. What Hermes did
   not answer is `null` or empty and is shown as unknown: nothing here invents a model, a schedule or a session. */
import type { CronJobRow, ProfileRow, ProfilesDescribeResult, SessionListRow } from '../../vendor/hermes-shared/gateway-contract.generated';
import { OWN_SETTINGS } from '../../data/bot-catalog';
import { lookFor } from '../../data/looks';
import type { Bot, BotCapability, BotConfig, BotInfo, BotJob, BotSession } from '../../data/types';
import { whenLabel } from '../map';

/** what an archived teammate's profile is called: this, then its name (the plugin's rule, `bots/homes.py`) */
export const ARCHIVE_PREFIX = 'archived--';
/** Hermes's own "active now" window for a profile that wrote */
export const ACTIVE_SECONDS = 90;

/** a teammate's own record as the plugin reads it (`plugin.boopis.bots.read`) */
export interface OwnRecord {
  look?: { shape?: string; color?: string; eyes?: string };
  settings?: { gov?: string; cap?: string; workspace?: string };
  approvals?: Record<string, boolean>;
}
export interface PluginBot {
  name: string; path: string;
  record: (OwnRecord & Record<string, unknown>) | null;
  problem: string | null;
  archived: { name?: string; at?: string; paused_jobs?: string[] } | null;
}

export const isArchived = (name: string, p: PluginBot | undefined): boolean => name.startsWith(ARCHIVE_PREFIX) || !!p?.archived;
export const botName = (row: Pick<ProfileRow, 'name' | 'display_name'>): string => (row.display_name ?? '').trim() || row.name;

/** `provider/model` as Hermes has it pinned; the model alone when Hermes names no provider; null when it names neither */
export function modelLabel(provider: string | null | undefined, model: string | null | undefined): string | null {
  const m = (model ?? '').trim(), p = (provider ?? '').trim();
  return m ? (p ? p + '/' + m : m) : null;
}
/** the other way: `provider/model` back to the two Hermes takes, by the provider slugs it reports (a model id may have slashes) */
export function splitModel(label: string, providers: readonly string[]): { provider: string; model: string } | null {
  const at = [...providers].sort((a, b) => b.length - a.length).find((p) => label.startsWith(p + '/'));
  return at ? { provider: at, model: label.slice(at.length + 1) } : null;
}

/** Hermes's rule for a profile that is "active now": it wrote lately, or a worker of it did. null when it reports neither */
export function runningFrom(row: ProfileRow, nowSeconds: number): boolean | null {
  const stamps = [row.last_session?.last_active, row.worker_session?.last_active].filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  if (!stamps.length) return row.last_session === undefined && row.worker_session === undefined ? null : false;
  return nowSeconds - Math.max(...stamps) <= ACTIVE_SECONDS;
}

/** "in 7 min", "in 3 h", "tomorrow 09:00": when a job runs next, '' when Hermes gives no time */
export function untilLabel(iso: string | null | undefined, now: Date): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const mins = Math.round((at.getTime() - now.getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return 'in ' + mins + ' min';
  if (mins < 24 * 60) return 'in ' + Math.round(mins / 60) + ' h';
  const pad = (n: number): string => String(n).padStart(2, '0');
  const days = Math.round(mins / 1440);
  return days < 7 ? 'in ' + days + (days === 1 ? ' day' : ' days') : pad(at.getDate()) + '/' + pad(at.getMonth() + 1);
}

export function jobFrom(row: CronJobRow, now: Date): BotJob {
  const state = row.state ?? '';
  return {
    id: row.job_id, name: (row.name ?? '').trim(), schedule: (row.schedule ?? '').trim(), prompt: (row.prompt_preview ?? '').trim(),
    enabled: row.enabled !== false && state !== 'paused', next: untilLabel(row.next_run_at, now),
    last: row.last_status ?? null
  };
}
/** the jobs of a profile, those that run first */
export const sortJobs = (jobs: readonly BotJob[]): BotJob[] => [...jobs].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));

export function sessionFrom(row: SessionListRow, now: Date): BotSession {
  const title = (row.title ?? '').trim() || (row.preview ?? '').trim();
  return { id: row.id, title, when: whenLabel(row.started_at, now), messages: typeof row.live_message_count === 'number' ? row.live_message_count : typeof row.message_count === 'number' ? row.message_count : null, source: row.source ?? '' };
}

const caps = (rows: ReadonlyArray<{ name: string; enabled?: boolean; label?: string }> | undefined): BotCapability[] | null =>
  rows ? rows.map((r) => ({ name: r.name, label: r.label ?? r.name, enabled: r.enabled !== false })) : null;
/** the capabilities `profiles.describe` lists */
export function capabilitiesFrom(d: ProfilesDescribeResult): Pick<BotInfo, 'skills' | 'toolsets' | 'mcpServers'> {
  return { skills: caps(d.skills), toolsets: caps(d.toolsets), mcpServers: caps(d.mcp_servers) };
}

/** what the plugin's record says, over the boopis defaults of a teammate that has none yet */
export function ownConfig(record: OwnRecord | null | undefined): Pick<BotConfig, 'gov' | 'cap' | 'workspace' | 'approvals'> {
  const s = record?.settings ?? {};
  return {
    gov: s.gov === 'ungoverned' ? 'ungoverned' : OWN_SETTINGS.gov,
    cap: s.cap ?? OWN_SETTINGS.cap,
    workspace: s.workspace === 'sandbox' ? 'sandbox' : OWN_SETTINGS.workspace,
    approvals: { ...OWN_SETTINGS.approvals, ...(record?.approvals ?? {}) }
  };
}

/** what is known of one teammate and where it came from, to make its `Bot` */
export interface Known {
  row: ProfileRow;
  plugin: PluginBot | undefined;
  detail: Pick<BotInfo, 'skills' | 'toolsets' | 'mcpServers' | 'soul'> & { model: string | null; provider: string | null; role: string | null } | null;
  jobs: readonly BotJob[] | null;
  sessions: readonly BotSession[] | null;
  notes: BotInfo['notes'];
}
export function botFrom(k: Known, nowSeconds: number): Bot {
  const { row, plugin, detail } = k;
  const name = botName(row);
  const own = plugin?.record ?? null;
  const look = { ...lookFor(name), ...(own?.look ?? {}) };
  const model = detail ? modelLabel(detail.provider, detail.model) : modelLabel(row.provider, row.model);
  const running = runningFrom(row, nowSeconds);
  const jobs = k.jobs;
  const info: BotInfo = {
    profile: row.name, path: row.path, model, provider: detail?.provider ?? (row.provider || null),
    skills: detail?.skills ?? null, toolsets: detail?.toolsets ?? null, mcpServers: detail?.mcpServers ?? null,
    jobs, sessions: k.sessions, soul: detail?.soul ?? null, running, notes: k.notes
  };
  return {
    id: row.name, name, role: (detail?.role ?? row.description ?? '').trim(),
    ...look,
    state: running ? 'working' : 'idle', attention: null, paused: false, activity: running ? (row.worker_session?.title ?? '').trim() : '', spent: '', last: null, ideas: [],
    cfg: {
      instructions: detail?.soul ?? '', model: model ?? '',
      cron: (jobs?.find((j) => j.enabled) ?? null)?.schedule ?? '',
      channels: { app: true }, ...ownConfig(own)
    },
    info
  };
}
