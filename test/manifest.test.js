// Manifest V3 schema, permissions, and file reference validation tests
const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function run() {
  console.log('--- Running test/manifest.test.js ---');

  const rootDir = path.resolve(__dirname, '..');
  const manifestPath = path.join(rootDir, 'manifest.json');

  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

  const raw = fs.readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    assert.fail(`manifest.json is not valid JSON: ${err.message}`);
  }

  // 1. Manifest V3 Schema Basics
  assert.strictEqual(manifest.manifest_version, 3, 'Must be Manifest V3');
  assert.ok(typeof manifest.name === 'string' && manifest.name.length > 0, 'Name must be non-empty string');
  assert.ok(typeof manifest.version === 'string' && manifest.version.length > 0, 'Version must be non-empty string');
  assert.ok(typeof manifest.description === 'string' && manifest.description.length > 0, 'Description must be non-empty string');

  // 2. Action Configuration
  assert.ok(manifest.action, 'Action must be configured');
  assert.ok(manifest.action.default_popup, 'default_popup must be configured');
  const popupHtmlPath = path.join(rootDir, manifest.action.default_popup);
  assert.ok(fs.existsSync(popupHtmlPath), `default_popup file must exist: ${manifest.action.default_popup}`);

  // 3. Permissions
  assert.ok(Array.isArray(manifest.permissions), 'Permissions must be an array');
  assert.ok(manifest.permissions.includes('storage'), 'Permissions must include "storage"');
  assert.ok(manifest.permissions.includes('identity'), 'Permissions must include "identity"');

  // 4. Content Scripts
  assert.ok(Array.isArray(manifest.content_scripts), 'content_scripts must be an array');
  assert.ok(manifest.content_scripts.length > 0, 'content_scripts must have at least one entry');

  const cs = manifest.content_scripts[0];
  assert.ok(Array.isArray(cs.matches), 'content_scripts.matches must be an array');
  assert.ok(cs.matches.some(m => m.includes('calendar.google.com')), 'content_scripts must match Google Calendar');

  assert.ok(Array.isArray(cs.js), 'content_scripts.js must be an array');
  cs.js.forEach(scriptRelPath => {
    const scriptFullPath = path.join(rootDir, scriptRelPath);
    assert.ok(fs.existsSync(scriptFullPath), `Content script file must exist: ${scriptRelPath}`);
  });

  if (Array.isArray(cs.css)) {
    cs.css.forEach(cssRelPath => {
      const cssFullPath = path.join(rootDir, cssRelPath);
      assert.ok(fs.existsSync(cssFullPath), `Content CSS file must exist: ${cssRelPath}`);
    });
  }

  // 5. Host Permissions
  assert.ok(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
  assert.ok(manifest.host_permissions.some(h => h.includes('calendar.google.com')), 'host_permissions must include Google Calendar');
  assert.ok(manifest.host_permissions.some(h => h.includes('googleapis.com')), 'host_permissions must include Google APIs');

  // 6. Icons
  if (manifest.icons) {
    Object.entries(manifest.icons).forEach(([size, iconRelPath]) => {
      const iconFullPath = path.join(rootDir, iconRelPath);
      assert.ok(fs.existsSync(iconFullPath), `Icon size ${size} file must exist: ${iconRelPath}`);
    });
  }

  console.log('[PASS] Manifest V3 schema, permissions, and file references verified.');
  console.log('--- test/manifest.test.js COMPLETED SUCCESSFULLY ---\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
