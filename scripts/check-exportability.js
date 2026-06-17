#!/usr/bin/env node

/**
 * Exportability checker: verify no forbidden patterns in code.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const denialFile = './scripts/denylist.txt';
const denyPatterns = [];

try {
  const content = readFileSync(denialFile, 'utf-8');
  denyPatterns.push(...content.split('\n').filter((l) => l.trim()));
} catch {
  console.warn(`Warning: ${denialFile} not found`);
}

let violations = 0;

for (const pattern of denyPatterns) {
  if (!pattern.trim()) continue;
  try {
    const result = execSync(
      `grep -ri "${pattern.replace(/"/g, '\\"')}" src test examples 2>/dev/null || true`
    ).toString();
    const lines = result.split('\n').filter((l) => l);
    if (lines.length > 0) {
      console.log(`\n✗ Denylist violation: "${pattern}"`);
      lines.slice(0, 5).forEach((l) => console.log(`  ${l}`));
      if (lines.length > 5) console.log(`  ... and ${lines.length - 5} more`);
      violations++;
    }
  } catch {
    // OK
  }
}

// Check for Python files
try {
  const result = execSync('find src test -name "*.py" 2>/dev/null || true').toString();
  const pyFiles = result.split('\n').filter((l) => l);
  if (pyFiles.length > 0) {
    console.log('\n✗ Found Python files (JS-only required):');
    pyFiles.forEach((f) => console.log(`  ${f}`));
    violations++;
  }
} catch {
  // OK
}

// Check for pyproject.toml
try {
  const result = execSync('find . -name "pyproject.toml" 2>/dev/null || true').toString();
  const files = result.split('\n').filter((l) => l && !l.includes('node_modules'));
  if (files.length > 0) {
    console.log('\n✗ Found pyproject.toml (JS-only required):');
    files.forEach((f) => console.log(`  ${f}`));
    violations++;
  }
} catch {
  // OK
}

if (violations === 0) {
  console.log('✓ Exportability check passed');
  process.exit(0);
} else {
  console.log(`\n✗ ${violations} violations found`);
  process.exit(1);
}
