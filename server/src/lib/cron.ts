import { CronExpressionParser } from "cron-parser";

export function computeNextRun(cronExpression: string, timezone: string): Date {
  if (!cronExpression || cronExpression.trim() === "") {
    throw new Error("cron_expression is empty");
  }
  validateTimezone(timezone);
  const interval = CronExpressionParser.parse(cronExpression, { tz: timezone });
  return interval.next().toDate();
}

export function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`invalid timezone: ${timezone}`);
  }
}
