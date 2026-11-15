import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const __dirname = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return '/';
  }
})();
const DEFAULT_KEY_FILE = path.resolve(__dirname, '../serviceAccountKey.json');

/**
 * Firebase Admin bootstrap (Authentication only).
 *
 * The database lives in Cloudflare D1; Firebase is kept for sign-in. Only this
 * server verifies ID tokens, and the Admin SDK is used for the school-issued
 * student accounts.
 *
 * Credentials are resolved in this order:
 *   1. FIREBASE_SERVICE_ACCOUNT_JSON  - the whole service-account JSON as one line
 *   2. GOOGLE_APPLICATION_CREDENTIALS - path to the JSON key file
 *   3. server/serviceAccountKey.json  - default local location (git-ignored)
 *   4. Application Default Credentials
 */
function resolveCredential() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    try {
      return cert(JSON.parse(inline));
    } catch (error) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`);
    }
  }

  const configured = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const file = configured || (fs.existsSync(DEFAULT_KEY_FILE) ? DEFAULT_KEY_FILE : null);

  if (file) {
    if (!fs.existsSync(file)) {
      throw new Error(`Service account file not found: ${file}`);
    }
    try {
      return cert(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      throw new Error(`Could not read service account file ${file}: ${error.message}`);
    }
  }

  return applicationDefault();
}

let app = null;

export function getFirebaseApp() {
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp({ credential: resolveCredential() });
  }
  return app;
}

/** Firebase Auth (Admin) - used to verify ID tokens from the PWAs. */
export function adminAuth() {
  getFirebaseApp();
  return getAuth();
}

/** True when the server has credentials it can actually use. */
export function hasAdminCredentials() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return true;
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_KEY_FILE;
  return fs.existsSync(file);
}
