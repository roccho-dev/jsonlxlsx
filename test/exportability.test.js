import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('exportability', () => {
  it('has no .py or pyproject.toml files', () => {
    const find = (dir, ext) => {
      try {
        const result = execSync(`find ${dir} -name "*${ext}" 2>/dev/null || true`).toString();
        return result.trim().split('\n').filter((l) => l);
      } catch {
        return [];
      }
    };

    const pyFiles = find('.', '.py');
    const pytFiles = find('.', 'pyproject.toml');

    expect(pyFiles).toHaveLength(0);
    expect(pytFiles).toHaveLength(0);
  });

  it('has only .js, .mjs, .json, .jsonl, .md in src/test', () => {
    const allowedExt = new Set(['.js', '.mjs', '.json', '.jsonl', '.md']);

    const checkDir = (dir) => {
      try {
        const files = execSync(`find ${dir} -type f 2>/dev/null || true`).toString().split('\n');
        for (const file of files) {
          if (!file) continue;
          const ext = file.substring(file.lastIndexOf('.'));
          if (!allowedExt.has(ext) && !file.includes('node_modules')) {
            throw new Error(`Unexpected file type: ${file}`);
          }
        }
      } catch (e) {
        if (!e.message.includes('No such file')) throw e;
      }
    };

    checkDir('src');
    checkDir('test');
  });

  it('has no Python pytest imports or syntax', () => {
    const checkForPython = (dir) => {
      try {
        const result = execSync(
          `grep -r "import pytest\\|from pytest\\|def test_\\|@pytest" ${dir} 2>/dev/null || true`
        ).toString();
        return result.trim().split('\n').filter((l) => l && !l.includes('exportability.test.js'));
      } catch {
        return [];
      }
    };

    const jsFiles = checkForPython('src');
    const testFiles = checkForPython('test');

    expect([...jsFiles, ...testFiles]).toHaveLength(0);
  });

  it('has no unencrypted credentials or API keys', () => {
    const patterns = [
      'api[_-]?key\\s*[:=]',
      'secret[_-]?key\\s*[:=]',
      'token\\s*[:=]',
      'password\\s*[:=]',
      'aws_access_key',
      'gcp_key',
      'azure_key',
    ];

    const checkForSecrets = (pattern) => {
      try {
        const result = execSync(
          `grep -ri "${pattern}" src test examples 2>/dev/null || true`
        ).toString();
        return result.trim().split('\n').filter((l) => l && !l.includes('example') && !l.includes('exportability.test.js'));
      } catch {
        return [];
      }
    };

    for (const pattern of patterns) {
      const found = checkForSecrets(pattern);
      expect(found).toHaveLength(0);
    }
  });

  it('verifies no hardcoded customer/project identifiers in code', () => {
    const denialPatterns = [
      'customer',
      'confidential',
      'internal',
      'secret',
      'private_id',
    ];

    let violations = [];
    for (const pattern of denialPatterns) {
      try {
        const result = execSync(
          `grep -ri "${pattern}" src 2>/dev/null | grep -v "node_modules" || true`
        ).toString();
        const lines = result.split('\n').filter((l) => l && !l.includes('example'));
        violations.push(...lines);
      } catch {
        // OK
      }
    }

    // Allow in test code and docs, only flag src/
    violations = violations.filter((l) => !l.includes('test/'));

    expect(violations).toHaveLength(0);
  });
});
