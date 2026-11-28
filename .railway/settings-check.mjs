// Checks that .railway/railway.ts holds exactly the settings railway.json gave
// Railway, so moving off railway.json (which Railway stops reading on
// 1 Dec 2026) changes nothing about how ArkLaw is built or run.
//
// Run from the repo root (needs the SDK in .railway, not the app's packages):
//   npm ci --prefix .railway --ignore-scripts
//   node --test .railway/settings-check.mjs
//
// Named settings-check.mjs (not *.test.*) so the app's own test runner never
// picks it up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SERVICE = 'ms-word-addin';

// railway.json as it was on main (332d510, 28 Nov 2026). Kept here because
// railway.json itself is deleted once Railway holds these settings.
const RAILWAY_JSON = {
  build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile.community' },
  deploy: {
    healthcheckPath: '/health',
    healthcheckTimeout: 60,
    restartPolicyType: 'ON_FAILURE',
    restartPolicyMaxRetries: 5,
  },
};

// Railway does not store these, so railway.ts leaves them out (writing them
// would show as a change in every plan and redeploy on every apply):
// ON_FAILURE is its default restart policy. (Builder DOCKERFILE IS stored here,
// because a Dockerfile path is set: seen on the 28/11/2026 apply.)
const NOT_STORED = { restartPolicyType: 'ON_FAILURE' };

async function loadService() {
  const sdk = path.join(HERE, 'node_modules', 'railway', 'dist', 'iac', 'index.js');
  assert.ok(fs.existsSync(sdk), 'Railway SDK missing: run npm ci --prefix .railway --ignore-scripts');
  const { createRailwayContext, project } = await import(pathToFileURL(sdk).href);
  const mod = await import(pathToFileURL(path.join(HERE, 'railway.ts')).href);
  const def = await mod.default(createRailwayContext({ environment: 'production' }), project);
  return { mod, def, svc: def.resources.find((r) => r.type === 'service' && r.name === SERVICE) };
}

test('manages only this one service and never variables', async () => {
  const { mod, def, svc } = await loadService();
  assert.equal(mod.partial, SERVICE, 'named partial, so an apply cannot delete anything else');
  assert.deepEqual(def.variables, { managed: false }, 'variables stay in the Railway dashboard');
  assert.equal(def.resources.length, 1, 'only the app service is declared');
  assert.ok(svc, `service ${SERVICE} declared`);
  assert.equal(svc.source.repo, 'arkaloncrm/ms-word-addin');
  assert.equal(svc.source.branch, 'main');
});

test('every railway.json setting is in railway.ts with the same value', async () => {
  const { svc } = await loadService();
  for (const section of ['build', 'deploy']) {
    for (const [key, value] of Object.entries(RAILWAY_JSON[section])) {
      if (NOT_STORED[key] === value) {
        assert.equal(svc[section]?.[key], undefined, `${section}.${key} is Railway's default; leave it out`);
        continue;
      }
      assert.deepEqual(svc[section]?.[key], value, `${section}.${key}`);
    }
  }
});

test('builds the ArkLaw community Dockerfile, never the root (upstream) one', async () => {
  const { svc } = await loadService();
  assert.equal(svc.build.dockerfilePath, 'Dockerfile.community');
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile.community'), 'utf8');
  assert.match(df, /npm run build:community/, 'Dockerfile.community builds the community edition');
});

test('while railway.json still exists, it matches what railway.ts now holds', () => {
  const file = path.join(ROOT, 'railway.json');
  if (!fs.existsSync(file)) return; // deleted after the settings were applied
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(json.build, RAILWAY_JSON.build);
  assert.deepEqual(json.deploy, RAILWAY_JSON.deploy);
});
