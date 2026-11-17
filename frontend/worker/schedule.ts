// Pulse has one cron trigger, every hour on the hour (wrangler.jsonc). One trigger keeps the account
// within the Workers Free limit of 5 cron triggers. Each hourly run works out which jobs are due.

export interface DueJobs {
  hourly: true; // filter subscriptions and scheduled automation rules
  dailyDigest: boolean; // weekdays at 07:00 Harare time (05:00 UTC), with the retention clean-up
  mondayBriefing: boolean; // Mondays at 08:00 Harare time (06:00 UTC)
}

/** The jobs due at this run, from its scheduled time. Harare is UTC+2 all year (no daylight saving). */
export function dueJobs(scheduledTime: number): DueJobs {
  const d = new Date(scheduledTime);
  const hour = d.getUTCHours();
  const day = d.getUTCDay(); // 0 Sunday … 6 Saturday
  return {
    hourly: true,
    dailyDigest: hour === 5 && day >= 1 && day <= 5,
    mondayBriefing: hour === 6 && day === 1,
  };
}
