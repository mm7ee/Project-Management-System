// The public address of Pulse (pulse.<account>.workers.dev). It passes every request, unchanged,
// to the app Worker "omni-tracker", which keeps the database, the AI and the MFA_KEY secret: that
// secret can't be read back, so the app can't simply be moved to a Worker with a new name.
export default {
  fetch: (req, env) => env.APP.fetch(req),
};
