import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { addDays, daysBetween } from '../domain/time';

/** Closed vocabulary the planner may use. Anything else is rejected (ADR-0007). */
export const METRICS = ['checkins', 'late', 'absent', 'overtime_minutes', 'work_minutes', 'flagged', 'auto_closed'] as const;
export const GROUPS = ['day', 'site', 'shift', 'employee', 'none'] as const;
export const MAX_RANGE_DAYS = 92;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const planSchema = z
  .object({
    metric: z.enum(METRICS),
    groupBy: z.enum(GROUPS).default('none'),
    from: day,
    to: day,
    siteName: z.string().min(1).max(60).optional(),
    kind: z.enum(['attendance', 'visitor', 'event', 'asset', 'task']).optional(),
  })
  .strict()
  .refine((p) => p.from <= p.to, { message: 'from must not be after to' })
  .refine((p) => daysBetween(p.from, p.to) < MAX_RANGE_DAYS, { message: `range is limited to ${MAX_RANGE_DAYS} days` });
export type QueryPlan = z.infer<typeof planSchema>;

/** Stable pseudonym for an employee. Not reversible without the server key; admins map aliases in the CMS. */
export function aliasFor(masterSecret: string, userId: string): string {
  const d = createHmac('sha256', `${masterSecret}:alias`).update(userId).digest();
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += alphabet[d[i] % alphabet.length];
  return `E-${out}`;
}

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const COORD = /-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PHONE = /(?:\+?\d[\s().-]?){9,15}\d/g;

/** Second layer: redacts anything that looks like PII in the final text. Dates are left alone. */
export function scanOutput(text: string): { text: string; redactions: number } {
  let n = 0;
  const sub = (re: RegExp, label: string) => (seg: string) => seg.replace(re, () => { n++; return `[${label} removed]`; });
  const steps = [sub(EMAIL, 'email'), sub(UUID, 'id'), sub(COORD, 'coordinates'), sub(PHONE, 'number')];
  const out: string[] = [];
  let last = 0;
  const run = (seg: string) => steps.reduce((s, f) => f(s), seg);
  for (const m of text.matchAll(ISO_DATE)) {
    out.push(run(text.slice(last, m.index)), m[0]);
    last = m.index + m[0].length;
  }
  out.push(run(text.slice(last)));
  return { text: out.join(''), redactions: n };
}

export interface Refusal { refuse: string }
const PII = /\b(e-?mail|phone|address|password|passwd|token|secret|salary|nik|ktp|coordinate|coordinates|latitude|longitude|lat\b|lng\b|gps|where (?:does|do|is|was)|home|real name|full name|names?\b)/i;
const INJECTION = /(ignore|disregard|forget)\b.{0,30}\b(previous|prior|above|rules|instructions)|system prompt|developer mode|jailbreak|reveal.{0,20}(prompt|instructions|secret)/i;
const WRITE_SQL = /\b(drop|delete|truncate|insert|update|alter|grant|revoke|create|exec|execute|copy|select\s.+\sfrom|union)\b|;|--|\/\*/i;
const WRITE_INTENT = /\b(approve|reject|override|rotate|deactivate|reset|change|edit|set|modify|remove)\b.*\b(record|check-?in|employee|site|shift|setting|password|qr)\b/i;

/** Pre-filter on the raw question. Cosmetic safety: the whitelist and read-only transaction are the real guards. */
export function screenQuestion(q: string): Refusal | null {
  if (INJECTION.test(q)) return { refuse: 'I cannot follow instructions that change my rules. Ask a question about attendance data instead.' };
  if (WRITE_SQL.test(q) || WRITE_INTENT.test(q)) return { refuse: 'This assistant is read-only and does not accept SQL or change requests. Use the admin screens for changes.' };
  if (PII.test(q)) return { refuse: 'I do not return names, contact details or locations. Employees appear as aliases such as E-7K2Q; ask for counts, minutes or rankings instead.' };
  return null;
}

export const addDaysExport = addDays;
