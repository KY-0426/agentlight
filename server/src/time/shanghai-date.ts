export const SHANGHAI_TIME_ZONE = "Asia/Shanghai";

const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatShanghaiDate(from: Date = new Date()): string {
  return shanghaiDateFormatter.format(from);
}

export function resolveUsageRollupDate(serverNow: Date = new Date()): string {
  return formatShanghaiDate(serverNow);
}

export function parseLeaderboardDateParam(value: string): string {
  const parsedMs = Date.parse(value);
  if (Number.isNaN(parsedMs)) {
    throw new Error(`Invalid leaderboard date param: ${value}`);
  }

  return formatShanghaiDate(new Date(parsedMs));
}

export function toUsageDateObject(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}
