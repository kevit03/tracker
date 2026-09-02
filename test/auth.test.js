// Google Auth flow, email normalization, session management, token eviction tests
const assert = require('assert');
const { installMockChrome, uninstallMockChrome } = require('./mock_chrome');

function getFreshAuth(initialStore = {}) {
  const mock = installMockChrome(initialStore);
  delete require.cache[require.resolve('../shared/auth')];
  const TrackerAuth = require('../shared/auth');
  global.TrackerAuth = TrackerAuth;
  return { mock, TrackerAuth };
}

async function run() {
  console.log('--- Running test/auth.test.js ---');

  // 1. Initial State
  {
    const { TrackerAuth } = getFreshAuth();
    const user = await TrackerAuth.getCurrentUser();
    assert.strictEqual(user, null, 'Initial user should be null');

    console.log('[PASS] Initial unauthenticated state');
    delete global.TrackerAuth;
    uninstallMockChrome();
  }

  // 2. Direct Email Sign-In and Normalization
  {
    const { TrackerAuth } = getFreshAuth();

    // Uppercase email with whitespace
    const signedIn = await TrackerAuth.signInWithGoogle('  John.Doe@EXAMPLE.COM  ');
    assert.ok(signedIn);
    assert.strictEqual(signedIn.email, 'john.doe@example.com', 'Email must be trimmed and lowercased');
    assert.strictEqual(signedIn.provider, 'google');

    // Retrieve current user
    const current = await TrackerAuth.getCurrentUser();
    assert.deepStrictEqual(current, signedIn);

    // Invalid email rejection
    await assert.rejects(async () => {
      await TrackerAuth.signInWithGoogle('invalid-email-no-at');
    }, /Valid email required/);

    await assert.rejects(async () => {
      await TrackerAuth.signInWithGoogle('   ');
    }, /Valid email required/);

    console.log('[PASS] Direct email sign-in and normalization');
    delete global.TrackerAuth;
    uninstallMockChrome();
  }

  // 3. OAuth Identity Sign-In Flow with UserInfo
  {
    const { mock, TrackerAuth } = getFreshAuth();

    // Mock global fetch for Google UserInfo API
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      if (url.includes('googleapis.com/oauth2/v3/userinfo')) {
        return {
          ok: true,
          json: async () => ({
            email: 'Alice.Smith@Gmail.Com',
            name: 'Alice Smith',
            picture: 'https://example.com/alice.jpg'
          })
        };
      }
      return { ok: false, status: 404 };
    };

    try {
      mock.identity.tokenToReturn = 'valid-google-oauth-token-999';
      const user = await TrackerAuth.signInWithGoogle();
      assert.ok(user);
      assert.strictEqual(user.email, 'alice.smith@gmail.com');
      assert.strictEqual(user.name, 'Alice Smith');
      assert.strictEqual(user.picture, 'https://example.com/alice.jpg');
      assert.strictEqual(user.token, 'valid-google-oauth-token-999');

      const currentUser = await TrackerAuth.getCurrentUser();
      assert.strictEqual(currentUser.email, 'alice.smith@gmail.com');
    } finally {
      global.fetch = originalFetch;
    }

    console.log('[PASS] OAuth Identity sign-in flow');
    delete global.TrackerAuth;
    uninstallMockChrome();
  }

  // 4. Sign Out and Token Eviction
  {
    const { mock, TrackerAuth } = getFreshAuth();

    const token = 'oauth-token-to-evict-456';
    await TrackerAuth.setUser({
      email: 'bob@example.com',
      name: 'Bob',
      token
    });

    mock.identity.cachedTokens.add(token);
    assert.strictEqual(mock.identity.cachedTokens.has(token), true);

    const signoutResult = await TrackerAuth.signOut();
    assert.strictEqual(signoutResult, true);

    const userAfter = await TrackerAuth.getCurrentUser();
    assert.strictEqual(userAfter, null, 'User should be null after sign out');
    assert.strictEqual(mock.identity.cachedTokens.has(token), false, 'Cached token must be evicted on signOut');

    console.log('[PASS] Sign out and token eviction');
    delete global.TrackerAuth;
    uninstallMockChrome();
  }

  // 5. Auth State Event Broadcasting
  {
    const { TrackerAuth } = getFreshAuth();

    let eventCount = 0;
    let lastEventUser = undefined;

    TrackerAuth.onAuthChanged(newUser => {
      eventCount++;
      lastEventUser = newUser;
    });

    await TrackerAuth.setUser({ email: 'charlie@example.com', name: 'Charlie' });
    // Allow event tick
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(eventCount, 1);
    assert.strictEqual(lastEventUser.email, 'charlie@example.com');

    await TrackerAuth.signOut();
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(eventCount, 2);
    assert.strictEqual(lastEventUser, null);

    console.log('[PASS] Auth state change event broadcasting');
    delete global.TrackerAuth;
    uninstallMockChrome();
  }

  console.log('--- test/auth.test.js COMPLETED SUCCESSFULLY ---\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
