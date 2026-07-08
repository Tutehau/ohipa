// Tests d'intégration de l'API Ohipa (node:test + fetch natif).
// Base SQLite temporaire et isolée pour ne pas toucher aux données réelles.
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `ohipa-test-${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.DB_PATH = TMP_DB;
process.env.SESSION_SECRET = 'test-secret';
process.env.SETUP_KEY = 'test-setup-key';

const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../server');
const db = require('../db');

let base;
let server;

// Petit client HTTP avec gestion manuelle du cookie de session.
function makeClient() {
  let cookie = '';
  return async function req(method, url, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + url, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    const setC = res.headers.get('set-cookie');
    if (setC) cookie = setC.split(';')[0];
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
}

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  db.close();
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(TMP_DB + ext, { force: true });
});

test('setup admin, puis login', async () => {
  const c = makeClient();
  let r = await c('GET', '/api/admin-exists');
  assert.equal(r.json.exists, false);

  r = await c('POST', '/api/setup-admin', { username: 'boss', password: 'pass123', setupKey: 'wrong' });
  assert.equal(r.status, 403);

  r = await c('POST', '/api/setup-admin', { username: 'boss', password: 'pass123', setupKey: 'test-setup-key' });
  assert.equal(r.status, 200);

  r = await c('POST', '/api/login', { username: 'boss', password: 'bad' });
  assert.equal(r.status, 401);

  r = await c('POST', '/api/login', { username: 'boss', password: 'pass123' });
  assert.equal(r.status, 200);
  assert.equal(r.json.role, 'admin');
});

test('CRUD entreprise + entrée, et validation', async () => {
  const c = makeClient();
  await c('POST', '/api/login', { username: 'boss', password: 'pass123' });

  let r = await c('POST', '/api/companies', { name: 'ACME' });
  assert.equal(r.status, 200);
  const companyId = r.json.id;

  r = await c('POST', '/api/entries', { companyId, hours: '99', description: 'x' });
  assert.equal(r.status, 400, 'heures hors bornes rejetées');

  r = await c('POST', '/api/entries', { companyId, hours: '7.5', description: 'dev' });
  assert.equal(r.status, 200);
  const entryId = r.json.id;

  r = await c('PUT', '/api/entries/' + entryId, { companyId, hours: '8', description: 'dev v2' });
  assert.equal(r.status, 200);

  r = await c('GET', '/api/entries');
  assert.equal(r.json[0].hours, 8);
  assert.equal(r.json[0].description, 'dev v2');

  r = await c('DELETE', '/api/entries/' + entryId);
  assert.equal(r.status, 200);

  r = await c('GET', '/api/entries');
  assert.equal(r.json.length, 0);
});

test('inscription -> activation -> login', async () => {
  const c = makeClient();
  let r = await c('POST', '/api/register', { username: 'alice', email: 'alice@test.fr', password: 'secret1' });
  assert.equal(r.status, 200);

  r = await c('POST', '/api/login', { username: 'alice', password: 'secret1' });
  assert.equal(r.status, 403, 'login bloqué avant activation');

  const token = db.prepare('SELECT activation_token AS t FROM users WHERE email = ?').get('alice@test.fr').t;
  r = await c('GET', '/api/activate?token=' + token);
  assert.equal(r.status, 200);

  r = await c('POST', '/api/login', { username: 'alice', password: 'secret1' });
  assert.equal(r.status, 200);
});

test('isolation des rôles : un user ne peut pas administrer', async () => {
  const c = makeClient();
  await c('POST', '/api/login', { username: 'alice', password: 'secret1' });

  assert.equal((await c('GET', '/api/admin/users')).status, 403);
  assert.equal((await c('GET', '/api/admin/stats')).status, 403);
  assert.equal((await c('POST', '/api/admin/invite', { username: 'x', password: 'y' })).status, 403);
  // La création de société est en self-service : autorisée à un user normal.
  assert.equal((await c('POST', '/api/companies', { name: 'Ma société' })).status, 200);
});

test('un user ne voit que ses propres entrées', async () => {
  const boss = makeClient();
  await boss('POST', '/api/login', { username: 'boss', password: 'pass123' });
  const companyId = (await boss('POST', '/api/companies', { name: 'Client' })).json.id;
  await boss('POST', '/api/entries', { companyId, hours: '3', description: 'boss' });

  const alice = makeClient();
  await alice('POST', '/api/login', { username: 'alice', password: 'secret1' });
  await alice('POST', '/api/entries', { companyId, hours: '2', description: 'alice' });

  const aliceEntries = (await alice('GET', '/api/entries')).json;
  assert.equal(aliceEntries.length, 1);
  assert.equal(aliceEntries[0].description, 'alice');

  const bossEntries = (await boss('GET', '/api/entries')).json;
  assert.ok(bossEntries.length >= 2, 'admin voit toutes les entrées');
});

test('reset password + garde du dernier admin', async () => {
  const c = makeClient();
  // reset : réponse générique même pour un email inconnu
  let r = await c('POST', '/api/reset-password', { email: 'inconnu@x.fr' });
  assert.equal(r.status, 200);

  await c('POST', '/api/reset-password', { email: 'alice@test.fr' });
  const rt = db.prepare('SELECT reset_token AS t FROM users WHERE email = ?').get('alice@test.fr').t;
  r = await c('POST', '/api/new-password', { token: rt, password: 'newpass9' });
  assert.equal(r.status, 200);
  r = await c('POST', '/api/login', { username: 'alice', password: 'newpass9' });
  assert.equal(r.status, 200);

  // Le dernier admin ne peut pas être rétrogradé
  const boss = makeClient();
  await boss('POST', '/api/login', { username: 'boss', password: 'pass123' });
  const bossId = db.prepare("SELECT id FROM users WHERE username = 'boss'").get().id;
  const aliceId = db.prepare("SELECT id FROM users WHERE username = 'alice'").get().id;
  r = await boss('PATCH', `/api/admin/users/${bossId}/role`, { role: 'user' });
  assert.equal(r.status, 400, 'pas de changement de son propre rôle');

  // Promouvoir alice puis rétrograder boss doit alors être possible
  assert.equal((await boss('PATCH', `/api/admin/users/${aliceId}/role`, { role: 'admin' })).status, 200);
});

test('reports + export CSV', async () => {
  const boss = makeClient();
  await boss('POST', '/api/login', { username: 'boss', password: 'pass123' });
  const r = await boss('GET', '/api/reports');
  assert.ok(typeof r.json.totalHours === 'number');
  assert.ok(Array.isArray(r.json.byCompany));

  const csv = await fetch(base + '/api/reports/export.csv', {
    headers: { Cookie: (await loginCookie('boss', 'pass123')) },
  });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /csv/);
});

// Prépare un utilisateur normal (register -> activate -> login) et renvoie son client.
async function makeNormalUser(username, email, password) {
  const c = makeClient();
  await c('POST', '/api/register', { username, email, password });
  const token = db.prepare('SELECT activation_token AS t FROM users WHERE email = ?').get(email).t;
  await c('GET', '/api/activate?token=' + token);
  await c('POST', '/api/login', { username, password });
  return c;
}

test('self-service : un utilisateur normal crée sa propre société', async () => {
  const bob = await makeNormalUser('bob', 'bob@test.fr', 'secret1');
  const r = await bob('POST', '/api/companies', { name: 'Boite de Bob' });
  assert.equal(r.status, 200, 'un user peut créer une société');
  assert.ok(r.json.id);
});

test('planning : CRUD et calcul des heures', async () => {
  const c = await makeNormalUser('carol', 'carol@test.fr', 'secret1');
  const companyId = (await c('POST', '/api/companies', { name: 'ACME Carol' })).json.id;

  let r = await c('POST', '/api/plannings', { companyId, date: '2026-07-08', startTime: '08:00', endTime: '16:00' });
  assert.equal(r.status, 200);
  const id = r.json.id;

  r = await c('GET', '/api/plannings');
  assert.equal(r.json.length, 1);
  assert.equal(r.json[0].hours, 8, '08:00->16:00 = 8h');

  // Horaires invalides refusés
  assert.equal((await c('POST', '/api/plannings', { date: '2026-07-08', startTime: '18:00', endTime: '09:00' })).status, 400);

  r = await c('PUT', '/api/plannings/' + id, { companyId, date: '2026-07-08', startTime: '09:00', endTime: '17:00' });
  assert.equal(r.status, 200);
  assert.equal((await c('GET', '/api/plannings')).json[0].hours, 8);

  assert.equal((await c('DELETE', '/api/plannings/' + id)).status, 200);
  assert.equal((await c('GET', '/api/plannings')).json.length, 0);
});

test('pointage : clock-in / clock-out et statut', async () => {
  const c = await makeNormalUser('dave', 'dave@test.fr', 'secret1');

  assert.equal((await c('GET', '/api/pointages/status')).json.clockedIn, false);

  assert.equal((await c('POST', '/api/pointages/clock-in', {})).status, 200);
  assert.equal((await c('GET', '/api/pointages/status')).json.clockedIn, true);
  assert.equal((await c('POST', '/api/pointages/clock-in', {})).status, 400, 'double arrivée refusée');

  assert.equal((await c('POST', '/api/pointages/clock-out', {})).status, 200);
  assert.equal((await c('GET', '/api/pointages/status')).json.clockedIn, false);
  assert.equal((await c('POST', '/api/pointages/clock-out', {})).status, 400, 'départ sans arrivée refusé');

  assert.equal((await c('GET', '/api/pointages')).json.length, 1);
});

test('réconciliation : prévu vs réel par jour', async () => {
  const c = await makeNormalUser('erin', 'erin@test.fr', 'secret1');
  await c('POST', '/api/plannings', { date: '2026-07-08', startTime: '08:00', endTime: '16:00' }); // 8h prévues

  const r = await c('GET', '/api/reconciliation?from=2026-07-08&to=2026-07-08');
  assert.equal(r.status, 200);
  assert.equal(r.json.totals.planned, 8);
  assert.equal(r.json.days[0].ecart, r.json.days[0].real - 8);
});

test('isolation : un user ne voit pas le planning des autres', async () => {
  const f = await makeNormalUser('frank', 'frank@test.fr', 'secret1');
  await f('POST', '/api/plannings', { date: '2026-07-09', startTime: '08:00', endTime: '12:00' });
  const g = await makeNormalUser('grace', 'grace@test.fr', 'secret1');
  assert.equal((await g('GET', '/api/plannings')).json.length, 0, 'grace ne voit pas le planning de frank');
});

// Utilitaire : récupère un cookie de session pour un appel fetch direct.
async function loginCookie(username, password) {
  const res = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}
