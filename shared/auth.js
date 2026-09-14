// Google Authentication module for Chrome Extension
const TrackerAuth = (() => {
  const AUTH_KEY = 'pt_auth_user';

  function getStorageArea() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return {
      get: (keys, cb) => {
        const res = {};
        keys.forEach(k => {
          const val = localStorage.getItem(k);
          if (val) {
            try { res[k] = JSON.parse(val); } catch (e) { res[k] = val; }
          }
        });
        cb(res);
      },
      set: (items, cb) => {
        Object.entries(items).forEach(([k, v]) => {
          localStorage.setItem(k, JSON.stringify(v));
        });
        if (cb) cb();
      }
    };
  }

  // Google's userinfo endpoint doubles as the token validity check: a 401
  // means the cached token has expired or been revoked.
  const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

  function hasIdentityApi() {
    return typeof chrome !== 'undefined' && !!chrome.identity && typeof chrome.identity.getAuthToken === 'function';
  }

  function getAuthToken(interactive) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: !!interactive }, t => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(t || null);
        }
      });
    });
  }

  function removeCachedToken(token) {
    return new Promise(resolve => {
      if (!token || !hasIdentityApi() || typeof chrome.identity.removeCachedAuthToken !== 'function') {
        resolve();
        return;
      }
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
  }

  // Resolves the Google profile, or null when the token is rejected (401).
  // Any other failure throws, so a network blip is never mistaken for expiry.
  async function fetchProfile(token) {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error('Google userinfo request failed with HTTP ' + res.status);
    return res.json();
  }

  function profileToUser(info, token) {
    return {
      email: info.email,
      name: info.name || info.email.split('@')[0],
      picture: info.picture || '',
      token,
      provider: 'google'
    };
  }

  function emailRequiredError() {
    const err = new Error('A Google Account email is required to sign in on this unpacked build.');
    err.code = 'EMAIL_REQUIRED';
    return err;
  }

  return {
    async getCurrentUser() {
      return new Promise(resolve => {
        getStorageArea().get([AUTH_KEY], result => {
          resolve(result[AUTH_KEY] || null);
        });
      });
    },

    // Direct Google-account email sign-in. This is the path for local and
    // unpacked builds that have no GCP OAuth client ID paired yet; data
    // isolation keys off the normalized email, so it works identically.
    async signInWithEmail(rawEmail) {
      const email = (rawEmail || '').trim();
      if (!email || !email.includes('@')) {
        throw new Error('Valid email required for sign-in');
      }
      const user = {
        email: email.toLowerCase(),
        name: email.split('@')[0],
        provider: 'google'
      };
      await this.setUser(user);
      return user;
    },

    // options.allowPrompt === false makes an unpaired build throw an
    // EMAIL_REQUIRED error instead of calling window.prompt, so a caller can
    // collect the email with its own dialog and retry with signInWithEmail.
    async signInWithGoogle(customEmail, options) {
      const opts = options || {};

      // An explicit email is a request for the direct path: the caller has
      // already collected it, so do not raise the Identity prompt again.
      if (customEmail) return this.signInWithEmail(customEmail);

      // 1. Chrome Identity API, when a GCP client ID is paired in the manifest
      if (hasIdentityApi()) {
        try {
          let token = await getAuthToken(true);
          let info = token ? await fetchProfile(token) : null;
          if (token && !info) {
            // Chrome handed back a stale cached token. Evict it and ask again
            // so the user is not left signed in against a dead session.
            await removeCachedToken(token);
            token = await getAuthToken(true);
            info = token ? await fetchProfile(token) : null;
          }
          if (info && info.email) {
            const user = profileToUser(info, token);
            await this.setUser(user);
            return user;
          }
        } catch (err) {
          console.info('Chrome Identity is not paired with a GCP client ID yet; using direct email sign-in:', err.message);
        }
      }

      // 2. Direct email fallback
      if (opts.allowPrompt === false) throw emailRequiredError();
      const rawEmail = typeof prompt === 'function'
        ? prompt('Enter your Google Account email (e.g. user@gmail.com):')
        : '';
      return this.signInWithEmail(rawEmail);
    },

    // Quick validity check for a stored OAuth session, meant for popup open.
    // A user signed in through the email fallback has no token and is returned
    // as-is. On a 401 the cached token is evicted and Chrome is asked for a
    // fresh one interactively; if that is declined, the account is kept (its
    // entries are still scoped to the email) but the dead token is dropped and
    // sessionExpired is set so the UI can say so.
    async ensureValidSession() {
      const user = await this.getCurrentUser();
      if (!user || !user.token || !hasIdentityApi()) return user;

      let info;
      try {
        info = await fetchProfile(user.token);
      } catch (err) {
        // Offline or Google unreachable is not evidence of expiry; leave it.
        return user;
      }
      if (info) return user;

      // Confirmed expired. A rejected re-prompt here means the user declined,
      // which must not be confused with the network guard above.
      await removeCachedToken(user.token);
      let token = null;
      try {
        token = await getAuthToken(true);
        info = token ? await fetchProfile(token) : null;
      } catch (err) {
        info = null;
      }
      if (info && info.email) {
        const refreshed = profileToUser(info, token);
        await this.setUser(refreshed);
        return refreshed;
      }

      const kept = Object.assign({}, user, { sessionExpired: true });
      delete kept.token;
      await this.setUser(kept);
      return kept;
    },

    async setUser(user) {
      if (user && user.email) {
        user.email = user.email.toLowerCase().trim();
      }
      return new Promise(resolve => {
        getStorageArea().set({ [AUTH_KEY]: user }, () => {
          resolve(user);
        });
      });
    },

    async signOut() {
      const user = await this.getCurrentUser();
      if (user && user.token && typeof chrome !== 'undefined' && chrome.identity && chrome.identity.removeCachedAuthToken) {
        chrome.identity.removeCachedAuthToken({ token: user.token }, () => {});
      }
      return new Promise(resolve => {
        getStorageArea().set({ [AUTH_KEY]: null }, () => {
          resolve(true);
        });
      });
    },

    onAuthChanged(cb) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          if (area === 'local' && changes[AUTH_KEY]) {
            cb(changes[AUTH_KEY].newValue || null);
          }
        });
      }
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TrackerAuth;
}
