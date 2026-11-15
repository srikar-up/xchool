/** `firebase-admin/auth` replacement for the Workers build. */
import {
  createAuthUser,
  findAuthUserByEmail,
  lookupIdToken,
  updateAuthUser,
} from './google.js';

export function getAuth() {
  return {
    async verifyIdToken(idToken) {
      return lookupIdToken(idToken);
    },

    /** Creates a school-issued student account (uid is Firebase's localId). */
    async createUser(input) {
      return createAuthUser(input);
    },

    async getUserByEmail(email) {
      return findAuthUserByEmail(email);
    },

    /** Used to reset the password when an existing account is linked. */
    async updateUser(uid, updates) {
      return updateAuthUser(uid, updates);
    },
  };
}
