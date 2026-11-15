/**
 * Creates Firebase Auth accounts for the demo staff.
 *
 * The Firebase UID is set to the staff id (900001, ...) so the server can map
 * a verified ID token straight onto a staff record - no lookup table, no way for
 * a client to claim someone else's identity.
 *
 * Accounts created before the numeric id migration keep their old uid
 * (STF-001, ...); the API resolves those through `staff.legacyIds`, so this
 * script leaves them alone. New accounts are created with the numeric uid.
 *
 * Idempotent: existing users are left untouched.
 *
 * Usage: npm --workspace server run create:users
 */
import { adminAuth } from '../src/firebase.js';
import { getDb, initStoreAsync } from '../src/store.js';

const ACCOUNTS = [
  { email: 'admin@nawazschool.edu', password: 'admin123' },
  { email: 'subadmin@nawazschool.edu', password: 'subadmin123' },
  { email: 'teacher@nawazschool.edu', password: 'teacher123' },
  { email: 'imran@nawazschool.edu', password: 'teacher123' },
  { email: 'ayesha@nawazschool.edu', password: 'teacher123' },
  { email: 'bilal@nawazschool.edu', password: 'teacher123' },
];

await initStoreAsync();
const db = getDb();
const auth = adminAuth();

let created = 0;
let skipped = 0;
let failed = 0;

for (const account of ACCOUNTS) {
  const staff = db.staff.find(
    (member) => String(member.email || '').trim().toLowerCase() === account.email
  );
  if (!staff) {
    console.warn(`- ${account.email}: no staff record, skipped`);
    skipped += 1;
    continue;
  }

  try {
    const existing = await auth.getUserByEmail(account.email);
    console.log(`= ${staff.id} <${account.email}> already exists (uid ${existing.uid})`);
    if (existing.uid !== staff.id) {
      console.log('  old uid still signs in through staff.legacyIds');
    }
    skipped += 1;
  } catch {
    try {
      await auth.createUser({
        uid: staff.id,
        email: account.email,
        password: account.password,
        displayName: staff.name,
        emailVerified: true,
      });
      console.log(`+ ${staff.id} <${account.email}> created`);
      created += 1;
    } catch (error) {
      console.error(`! ${staff.id} <${account.email}>: ${error.message}`);
      failed += 1;
    }
  }
}

console.log(`\ncreated ${created}, skipped ${skipped}, failed ${failed}`);
process.exit(failed > 0 ? 1 : 0);
