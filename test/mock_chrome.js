// In-memory mock for Chrome Extension APIs
// Zero-emoji compliant test infrastructure

function deepClone(obj) {
  if (obj === undefined || obj === null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

class MockStorageArea {
  constructor(name, eventBus) {
    this.name = name;
    this.eventBus = eventBus;
    this.store = {};
  }

  get(keys, callback) {
    let result = {};
    if (!keys) {
      result = deepClone(this.store);
    } else if (typeof keys === 'string') {
      if (this.store[keys] !== undefined) {
        result[keys] = deepClone(this.store[keys]);
      }
    } else if (Array.isArray(keys)) {
      keys.forEach(k => {
        if (this.store[k] !== undefined) {
          result[k] = deepClone(this.store[k]);
        }
      });
    } else if (typeof keys === 'object') {
      Object.keys(keys).forEach(k => {
        result[k] = this.store[k] !== undefined ? deepClone(this.store[k]) : deepClone(keys[k]);
      });
    }

    if (typeof callback === 'function') {
      process.nextTick(() => callback(result));
      return;
    }
    return Promise.resolve(result);
  }

  set(items, callback) {
    if (!items || typeof items !== 'object') {
      if (typeof callback === 'function') process.nextTick(callback);
      return Promise.resolve();
    }

    const changes = {};
    Object.keys(items).forEach(key => {
      const oldValue = deepClone(this.store[key]);
      const newValue = deepClone(items[key]);
      this.store[key] = newValue;
      changes[key] = { oldValue, newValue };
    });

    if (this.eventBus && Object.keys(changes).length > 0) {
      process.nextTick(() => {
        this.eventBus.dispatch(changes, this.name);
      });
    }

    if (typeof callback === 'function') {
      process.nextTick(callback);
      return;
    }
    return Promise.resolve();
  }

  remove(keys, callback) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    const changes = {};
    keyList.forEach(k => {
      if (this.store[k] !== undefined) {
        const oldValue = deepClone(this.store[k]);
        delete this.store[k];
        changes[k] = { oldValue, newValue: undefined };
      }
    });

    if (this.eventBus && Object.keys(changes).length > 0) {
      process.nextTick(() => {
        this.eventBus.dispatch(changes, this.name);
      });
    }

    if (typeof callback === 'function') {
      process.nextTick(callback);
      return;
    }
    return Promise.resolve();
  }

  clear(callback) {
    const changes = {};
    Object.keys(this.store).forEach(k => {
      changes[k] = { oldValue: deepClone(this.store[k]), newValue: undefined };
    });
    this.store = {};

    if (this.eventBus && Object.keys(changes).length > 0) {
      process.nextTick(() => {
        this.eventBus.dispatch(changes, this.name);
      });
    }

    if (typeof callback === 'function') {
      process.nextTick(callback);
      return;
    }
    return Promise.resolve();
  }
}

class MockStorageEventBus {
  constructor() {
    this.listeners = new Set();
  }

  addListener(cb) {
    if (typeof cb === 'function') {
      this.listeners.add(cb);
    }
  }

  removeListener(cb) {
    this.listeners.delete(cb);
  }

  hasListener(cb) {
    return this.listeners.has(cb);
  }

  dispatch(changes, areaName) {
    for (const listener of this.listeners) {
      try {
        listener(changes, areaName);
      } catch (err) {
        console.error('Error in mock storage listener:', err);
      }
    }
  }
}

class MockIdentityAPI {
  constructor() {
    this.tokenToReturn = 'mock-oauth2-token-12345';
    this.shouldFail = false;
    this.failureMessage = 'OAuth token request rejected';
    this.cachedTokens = new Set();
  }

  getAuthToken(details, callback) {
    if (this.shouldFail) {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.lastError = { message: this.failureMessage };
      }
      process.nextTick(() => {
        callback(undefined);
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.lastError = null;
        }
      });
      return;
    }

    this.cachedTokens.add(this.tokenToReturn);
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.lastError = null;
    }
    process.nextTick(() => {
      callback(this.tokenToReturn);
    });
  }

  removeCachedAuthToken(details, callback) {
    if (details && details.token) {
      this.cachedTokens.delete(details.token);
    }
    if (typeof callback === 'function') {
      process.nextTick(callback);
    }
  }
}

function createMockChrome(initialStore = {}) {
  const eventBus = new MockStorageEventBus();
  const localStorageArea = new MockStorageArea('local', eventBus);
  Object.keys(initialStore).forEach(k => {
    localStorageArea.store[k] = deepClone(initialStore[k]);
  });

  const identity = new MockIdentityAPI();

  const mock = {
    storage: {
      local: localStorageArea,
      onChanged: eventBus
    },
    identity: identity,
    runtime: {
      lastError: null,
      id: 'job-tracker-mock-extension-id',
      getURL(path) {
        return 'chrome-extension://' + this.id + '/' + (path || '').replace(/^\//, '');
      }
    }
  };

  return mock;
}

let originalChrome = undefined;

function installMockChrome(initialStore = {}) {
  originalChrome = global.chrome;
  const mock = createMockChrome(initialStore);
  global.chrome = mock;
  return mock;
}

function uninstallMockChrome() {
  global.chrome = originalChrome;
}

module.exports = {
  createMockChrome,
  installMockChrome,
  uninstallMockChrome,
  MockStorageArea,
  MockStorageEventBus,
  MockIdentityAPI
};
