// image_url is a plain TEXT column that the API used to write unchecked, so
// any string at all could end up being loaded by every customer's phone. These
// checks are the gate: shape, scheme, and host.
//
// Images are hosted on Cloudinary by convention. That convention is enforced
// here rather than merely documented, because an unrestricted image_url lets
// whoever can edit a menu point the app at a host they control - useful for
// tracking which customers opened which restaurant, or for swapping a dish
// photo for something else long after the item was approved.
//
// Set IMAGE_URL_ALLOWED_HOSTS to a comma-separated list to host elsewhere.
const DEFAULT_ALLOWED_HOSTS = ["res.cloudinary.com"];

// Generous next to a real Cloudinary URL with transformations, tight enough
// that the column cannot be used to smuggle a payload.
const MAX_LENGTH = 2048;

function getAllowedHosts() {
  const configured = String(process.env.IMAGE_URL_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return configured.length > 0 ? configured : DEFAULT_ALLOWED_HOSTS;
}

/**
 * Validates a caller-supplied image URL.
 *
 * Returns `{ value }` with the URL to store (null when the caller is clearing
 * it), or `{ error }` with a message safe to hand straight back to the caller.
 * Absent and null both mean "no image", so callers can pass req.body values
 * through without pre-checking.
 */
function parseImageUrl(raw, field = "imageUrl") {
  if (raw === undefined || raw === null) {
    return { value: null };
  }

  if (typeof raw !== "string") {
    return { error: `${field} must be a string or null` };
  }

  const trimmed = raw.trim();

  // An empty string is how a caller clears an existing image, so it is a
  // valid value rather than a malformed URL.
  if (!trimmed) {
    return { value: null };
  }

  if (trimmed.length > MAX_LENGTH) {
    return { error: `${field} must be at most ${MAX_LENGTH} characters` };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      error: `${field} must be an absolute URL, for example https://res.cloudinary.com/...`,
    };
  }

  // Blocks javascript:, data:, and file: along with plaintext http. The app
  // renders these straight into an Image, so the scheme matters.
  if (parsed.protocol !== "https:") {
    return { error: `${field} must use https` };
  }

  // A URL carrying credentials has no business being a dish photo, and some
  // clients strip them in ways that turn one URL into two.
  if (parsed.username || parsed.password) {
    return { error: `${field} must not contain credentials` };
  }

  const allowedHosts = getAllowedHosts();
  // Exact match only: allowing subdomains of an approved host would accept
  // anything an attacker can register underneath it.
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) {
    return {
      error: `${field} must be hosted on: ${allowedHosts.join(", ")}`,
    };
  }

  // The trimmed input rather than parsed.toString(), which rewrites some URLs
  // (a bare host gains a trailing slash) and would store something the caller
  // did not send.
  return { value: trimmed };
}

module.exports = {
  DEFAULT_ALLOWED_HOSTS,
  MAX_LENGTH,
  parseImageUrl,
};
