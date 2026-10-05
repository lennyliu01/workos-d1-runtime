export type ScheduledTaskId = "US_JAPAN_FX_POLICY" | "ROLLING_WEDGE_INVESTMENT";

const schedule = {
  US_JAPAN_FX_POLICY: { utcHour: 2, utcMinute: 0, jstClock: "11:00:00" },
  ROLLING_WEDGE_INVESTMENT: { utcHour: 4, utcMinute: 15, jstClock: "13:15:00" },
} as const;

export function canonicalScheduledOccurrence(taskId: ScheduledTaskId, originalRunCreatedAt: string): string {
  const spec = schedule[taskId];
  const created = new Date(originalRunCreatedAt);
  if (!spec || !originalRunCreatedAt || Number.isNaN(created.getTime())) throw new Error("ORIGINAL_RUN_CREATED_AT_INVALID");
  let boundary = Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate(), spec.utcHour, spec.utcMinute);
  if (created.getTime() < boundary) boundary -= 86400000;
  const age = created.getTime() - boundary;
  if (age < 0 || age >= 86400000) throw new Error("SCHEDULED_OCCURRENCE_AMBIGUOUS");
  const jstDate = new Date(boundary + 32400000).toISOString().slice(0, 10);
  return jstDate + "T" + spec.jstClock + "+09:00";
}
