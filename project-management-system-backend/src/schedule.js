// Pulse has one cron trigger, every 5 minutes (wrangler.jsonc). One trigger keeps the account within the Workers
// Free limit of 5 cron triggers. Each run works out which jobs are due: automation (schedules, due dates, retries)
// every run; the hourly jobs in the first run of each hour; the daily and weekly ones at their hour.
/**
 * The jobs due at this run, from its scheduled time. Harare is UTC+2 all year (no daylight saving).
 * @param {number} scheduledTime
 * @returns {DueJobs}
 */
export function dueJobs(scheduledTime) {
  const d = new Date(scheduledTime);
  const hour = d.getUTCHours();
  const day = d.getUTCDay(); // 0 Sunday … 6 Saturday
  const firstOfHour = d.getUTCMinutes() < 5;
  return {
    every: true,
    hourly: firstOfHour,
    dailyDigest: firstOfHour && hour === 5 && day >= 1 && day <= 5,
    mondayBriefing: firstOfHour && hour === 6 && day === 1,
  };
}
/**
 * @typedef {Object} DueJobs
 * @property {true} every
 * @property {boolean} hourly
 * @property {boolean} dailyDigest
 * @property {boolean} mondayBriefing
 */
