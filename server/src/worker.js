/**
 * Cloudflare Workers entry point.
 *
 * The Express app is unchanged - `cloudflare:node` exposes it through the
 * Node.js HTTP server compatibility layer. The database is D1 (`env.DB`); the
 * binding is handed to the store on the first request because Express has no
 * access to the Worker environment.
 *
 * Workers forbid network I/O in the global scope, so the database bootstrap
 * starts on the first request and every request awaits the same promise.
 */
import { httpServerHandler } from 'cloudflare:node';
import { setD1Binding } from './d1-binding.js';
import { flushStore, initStoreAsync } from './store.js';
import './index.js';

const handler = httpServerHandler({ port: Number(process.env.PORT || 4000) });

const BOOT_TIMEOUT_MS = 20_000;
/**
 * When the database refuses a boot, stop retrying for a while.
 *
 * A boot reads the whole school (thousands of rows). A failing D1 mount would
 * otherwise turn every retrying tab into another burst of rejected queries; a
 * short cooldown limits that to at most two attempts a minute per isolate and
 * lets the database recover.
 */
const BOOT_RETRY_MS = 30_000;
let bootBlockedUntil = 0;
let booting = null;

function startingUp(request) {
  return new Response(
    JSON.stringify({ error: 'The school server is starting up. Try again in a moment.' }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
        'Cache-Control': 'no-store',
        'Retry-After': String(Math.ceil(BOOT_RETRY_MS / 1000)),
      },
    }
  );
}

/**
 * Boots the store at most once per isolate.
 *
 * If the database cannot be reached the request fails with 503 instead of
 * hanging: a request that never returns is impossible to diagnose in
 * production. The promise is cleared on rejection so the next request retries.
 */
async function ensureBooted() {
  if (!booting) {
    booting = initStoreAsync().catch((error) => {
      booting = null;
      throw error;
    });
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Database boot timed out.')), BOOT_TIMEOUT_MS);
  });

  try {
    await Promise.race([booting, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request, env, context) {
    // The binding is only available per request; the store needs it at boot.
    if (env?.DB) setD1Binding(env.DB);

    // CORS preflights carry no credentials and need no database, so never let a
    // slow boot block them - otherwise the browser reports a CORS failure.
    if (request.method !== 'OPTIONS') {
      if (Date.now() < bootBlockedUntil) return startingUp(request);
      try {
        await ensureBooted();
      } catch (error) {
        // A timed-out boot is worth retrying sooner than a rejected query.
        const refused = /quota|RESOURCE_EXHAUSTED|429/i.test(error.message);
        bootBlockedUntil = Date.now() + (refused ? BOOT_RETRY_MS : BOOT_RETRY_MS / 2);
        console.error('[boot]', error.message);
        return startingUp(request);
      }
    }

    const response = await handler.fetch(request, env, context);

    // The in-memory database is flushed asynchronously; keep the isolate alive
    // until those D1 writes settle so a response never loses a mutation.
    context.waitUntil(flushStore());
    return response;
  },
};
