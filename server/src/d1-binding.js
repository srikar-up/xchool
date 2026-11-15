/**
 * Bridge between the Worker's environment and the storage driver.
 *
 * Cloudflare D1 is a binding (`env.DB`), not a network service, and the Express
 * app has no access to `env`. worker.js stores the binding here on the first
 * request; the D1 driver reads it. Keeping this tiny module separate avoids a
 * circular import (`worker -> store -> d1-store`).
 */
let binding = null;

export function setD1Binding(value) {
  if (value) binding = value;
}

export function getD1Binding() {
  if (!binding) {
    throw new Error(
      'The D1 binding (env.DB) is not available. Run the API through `wrangler dev` or deploy it.'
    );
  }
  return binding;
}

export function isD1Bound() {
  return Boolean(binding);
}
