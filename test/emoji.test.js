// Automated regex and Unicode scanner checking every single file to guarantee 0 emojis
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const EMOJI_REGEX = /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}])/gu;

function walkDirectory(dir, fileList = []) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    if (item === '.git' || item === 'node_modules' || item === '.agents') continue;
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDirectory(fullPath, fileList);
    } else {
      // Include code, markup, styles, configs, and documentation
      const ext = path.extname(fullPath).toLowerCase();
      if (['.js', '.json', '.html', '.css', '.md', '.txt'].includes(ext)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

async function run() {
  console.log('--- Running test/emoji.test.js ---');

  const rootDir = path.resolve(__dirname, '..');
  const files = walkDirectory(rootDir);

  assert.ok(files.length > 0, 'Should find project files to scan');

  const violations = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, lineIdx) => {
      let match;
      // Reset regex index for global regex
      EMOJI_REGEX.lastIndex = 0;
      while ((match = EMOJI_REGEX.exec(line)) !== null) {
        const codePoint = match[0].codePointAt(0).toString(16).toUpperCase();
        violations.push({
          file: path.relative(rootDir, filePath),
          line: lineIdx + 1,
          char: match[0],
          codePoint: `U+${codePoint}`
        });
      }
    });
  }

  if (violations.length > 0) {
    console.error(`[FAIL] Found ${violations.length} emoji violation(s):`);
    violations.forEach(v => {
      console.error(`  - ${v.file}:${v.line} -> "${v.char}" (${v.codePoint})`);
    });
    assert.strictEqual(violations.length, 0, `Zero-emoji policy violation: ${violations.length} emojis found`);
  }

  console.log(`[PASS] Scanned ${files.length} project files. 0 emojis found across the repository.`);
  console.log('--- test/emoji.test.js COMPLETED SUCCESSFULLY ---\n');
}

if (require.main === module) {
  run().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { run };
