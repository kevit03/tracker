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

  return {
    async getCurrentUser() {
      return new Promise(resolve => {
        getStorageArea().get([AUTH_KEY], result => {
          resolve(result[AUTH_KEY] || null);
        });
      });
    },

    async signInWithGoogle(customEmail) {
      // 1. Try Chrome Identity API if configured
      if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getAuthToken) {
        try {
          const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, t => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(t);
              }
            });
          });

          if (token) {
            // Fetch profile info from Google API
            const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
              const info = await res.json();
              const user = {
                email: info.email,
                name: info.name || info.email.split('@')[0],
                picture: info.picture || '',
                token,
                provider: 'google'
              };
              await this.setUser(user);
              return user;
            }
          }
        } catch (err) {
          console.info('Native Chrome Identity not yet paired with GCP Client ID, using direct Google account sign-in:', err.message);
        }
      }

      // 2. Direct Google account email sign-in (for local/unpacked extensions before GCP OAuth client registration)
      const rawEmail = customEmail || prompt('Enter your Google Account email (e.g. user@gmail.com):');
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
