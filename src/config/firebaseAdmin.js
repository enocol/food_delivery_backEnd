const admin = require("firebase-admin");

function normalizeEnvString(value) {
  if (typeof value !== "string") {
    return value;
  }

  let normalized = value.trim();

  if (normalized.endsWith(",")) {
    normalized = normalized.slice(0, -1).trim();
  }

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized;
}

function decodePrivateKey(value) {
  const normalized = normalizeEnvString(value);
  return normalized ? normalized.replace(/\\n/g, "\n") : undefined;
}

function getCredential() {
  const serviceAccountJson = normalizeEnvString(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  );
  if (serviceAccountJson) {
    const parsed = JSON.parse(serviceAccountJson);
    if (parsed.project_id) {
      parsed.project_id = normalizeEnvString(parsed.project_id);
    }
    if (parsed.client_email) {
      parsed.client_email = normalizeEnvString(parsed.client_email);
    }
    if (parsed.private_key) {
      parsed.private_key = decodePrivateKey(parsed.private_key);
    }
    return admin.credential.cert(parsed);
  }

  const projectId = normalizeEnvString(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = normalizeEnvString(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = decodePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (projectId && clientEmail && privateKey) {
    return admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    });
  }

  return admin.credential.applicationDefault();
}

function getFirebaseAuth() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: getCredential(),
    });
  }

  return admin.auth();
}

module.exports = {
  getFirebaseAuth,
};
