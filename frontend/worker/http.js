// The small pieces of HTTP every part of the API uses: errors that become JSON responses, JSON
// responses themselves, and reading a JSON request body.
/** @extends Error */
export class HttpError extends Error {
  status;
  code;
  extra;
  /**
   * @param {number} status
   * @param {string} message
   * @param {string} [code]
   * @param {Record<string, unknown>} [extra]
   */
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const json =
  /** @param {unknown} data
   * @param {number} [status=200]
   * @param {Record<string, string>} [headers={}]
   * @returns {Response}
   */ (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
/**
 * @template T
 * @param {Request} req
 * @returns {Promise<T>}
 */
export async function body(req) {
  try {
    return /** @type {T} */ (await req.json());
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
