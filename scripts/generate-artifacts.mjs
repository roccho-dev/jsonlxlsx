#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
function readJsonl(path) {
  return readFileSync(path, 'utf8').trim().split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}
const publication = readJsonl('records/publication.v1.jsonl')[0];
const license = readJsonl('records/license.v1.jsonl')[0];
const security = readJsonl('records/security.v1.jsonl')[0];
const provenance = readJsonl('records/provenance.v1.jsonl')[0];
const pkg = readJsonl('records/package.v1.jsonl')[0];
const proposal = readJsonl('records/implementation-proposal.v1.jsonl')[0];
writeFileSync('README.md', `# ${pkg.name}\n\n${pkg.description}.\n\nThis repository is generated from \`records/*.jsonl\`. The records are the authority; root Markdown and package metadata files are generated artifacts for GitHub display and review.\n\n## Status\n\n- Visibility: ${publication.visibility}\n- Publication scope: ${publication.publication_scope}\n- Implementation included: ${publication.implementation_included}\n- npm publish ready: ${publication.npm_publish_ready}\n- Proposal status: ${proposal.status}\n\n## Use\n\nInstall dependencies, then run tests or invoke the CLI against JSONL configuration and source files. This proposal is not a release package and is not ready for npm publication.\n`);
writeFileSync('LICENSE', `MIT License\n\nCopyright (c) ${license.year} ${license.copyright_holder}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`);
writeFileSync('SECURITY.md', `# Security\n\n${security.policy}\n\n## Scope\n\n${security.scope}\n`);
writeFileSync('PROVENANCE.md', `# Provenance\n\n- Authority: \`${provenance.authority}\`\n- Generation: ${provenance.generation}\n- Source scope: ${provenance.source_scope}\n- Implementation source commit: ${provenance.implementation_source_commit}\n- Public base commit: ${provenance.public_base_commit}\n- Included: ${provenance.included.join(', ')}\n- Excluded: ${provenance.excluded.join(', ')}\n`);
const packageJson = {
  name: pkg.name,
  version: '0.0.0',
  private: pkg.private,
  description: pkg.description,
  type: 'module',
  main: pkg.main,
  exports: pkg.exports,
  bin: { jsonlxlsx: './src/cli.js' },
  license: pkg.license,
  repository: { type: 'git', url: `git+${pkg.repository}.git` },
  scripts: {
    generate: 'node scripts/generate-artifacts.mjs',
    check: 'node scripts/check-artifacts.mjs',
    test: 'vitest run',
    'check:exportability': 'node scripts/check-exportability.js',
    example: 'node scripts/generate-example.js'
  },
  keywords: ['jsonl', 'xlsx', 'append-only', 'schema-driven'],
  dependencies: pkg.dependencies,
  devDependencies: pkg.devDependencies,
  engines: { node: pkg.runtime }
};
writeFileSync('package.json', `${JSON.stringify(packageJson, null, 2)}\n`);
