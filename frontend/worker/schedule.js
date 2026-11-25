// Pulse has one cron trigger, every hour on the hour (wrangler.jsonc). One trigger keeps the account
// within the Workers Free limit of 5 cron triggers. Each hourly run works out which jobs are due.
/**
 * The jobs due at this run, from its scheduled time. Harare is UTC+2 all year (no daylight saving).
 * @param {number} scheduledTime
 * @returns {DueJobs}
 */
export function dueJobs(scheduledTime) {
  const d = new Date(scheduledTime);
  const hour = d.getUTCHours();
  const day = d.getUTCDay(); // 0 Sunday … 6 Saturday
  return {
    hourly: true,
    dailyDigest: hour === 5 && day >= 1 && day <= 5,
    mondayBriefing: hour === 6 && day === 1,
  };
}
/**
 * @typedef {Object} DueJobs
 * @property {true} hourly
 * @property {boolean} dailyDigest
 * @property {boolean} mondayBriefing
 */
