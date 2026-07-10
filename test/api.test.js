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

test('pointage : réel comptabilisé dans les rapports', async () => {
  const c = await makeNormalUser('ivan', 'ivan@test.fr', 'secret1');
  await c('POST', '/api/pointages/clock-in', { date: '2026-07-08' });
  await c('POST', '/api/pointages/clock-out', {});
  const rep = (await c('GET', '/api/reports')).json;
  assert.equal(typeof rep.totalHours, 'number');
  assert.equal(rep.count, 1, 'un segment terminé compté comme réel');
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

  // Horaires invalides refusés (égaux, ou format incorrect)
  assert.equal((await c('POST', '/api/plannings', { date: '2026-07-08', startTime: '09:00', endTime: '09:00' })).status, 400);
  assert.equal((await c('POST', '/api/plannings', { date: '2026-07-08', startTime: '25:00', endTime: '09:00' })).status, 400);

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

test('pointage : pause / reprise', async () => {
  const c = await makeNormalUser('heidi', 'heidi@test.fr', 'secret1');

  assert.equal((await c('POST', '/api/pointages/pause', {})).status, 400, 'pause sans être en poste refusée');

  await c('POST', '/api/pointages/clock-in', {});
  assert.equal((await c('POST', '/api/pointages/pause', {})).status, 200);
  let st = (await c('GET', '/api/pointages/status')).json;
  assert.equal(st.state, 'on_break', 'après pause -> en pause');

  await c('POST', '/api/pointages/clock-in', {}); // reprise
  st = (await c('GET', '/api/pointages/status')).json;
  assert.equal(st.state, 'working', 'après reprise -> en poste');

  await c('POST', '/api/pointages/clock-out', {});
  st = (await c('GET', '/api/pointages/status')).json;
  assert.equal(st.state, 'off', 'après départ -> hors service');

  // Deux segments : un fini par pause, un par départ.
  const list = (await c('GET', '/api/pointages')).json;
  assert.equal(list.length, 2);
  assert.ok(list.some(p => p.endReason === 'pause'));
  assert.ok(list.some(p => p.endReason === 'depart'));
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

test('validation : companyId inexistant rejeté (400, pas 500)', async () => {
  const c = await makeNormalUser('ivy', 'ivy@test.fr', 'secret1');
  assert.equal((await c('POST', '/api/plannings', { companyId: 'nope', date: '2026-07-08', startTime: '08:00', endTime: '16:00' })).status, 400);
  assert.equal((await c('POST', '/api/pointages/clock-in', { companyId: 'nope' })).status, 400);
});

test('planning de nuit : fin < début = passage de minuit', async () => {
  const c = await makeNormalUser('jack', 'jack@test.fr', 'secret1');
  const r = await c('POST', '/api/plannings', { date: '2026-07-08', startTime: '23:00', endTime: '07:00' });
  assert.equal(r.status, 200);
  assert.equal((await c('GET', '/api/plannings')).json[0].hours, 8, '23:00 -> 07:00 = 8h');
});

test('fuseau : réconciliation alignée sur la date locale du pointage', async () => {
  const c = await makeNormalUser('kate', 'kate@test.fr', 'secret1');
  await c('POST', '/api/plannings', { date: '2026-07-08', startTime: '08:00', endTime: '16:00' });
  // Le client déclare travailler le 2026-07-08 (sa date locale), quelle que soit l'heure UTC.
  await c('POST', '/api/pointages/clock-in', { date: '2026-07-08' });
  await c('POST', '/api/pointages/clock-out', {});
  const rec = (await c('GET', '/api/reconciliation?from=2026-07-08&to=2026-07-08')).json;
  assert.equal(rec.days.length, 1, 'prévu et réel tombent sur le même jour local');
  assert.equal(rec.days[0].planned, 8);
});

test('oubli de départ : clock-in d\'un nouveau jour auto-clôture le segment ouvert', async () => {
  const c = await makeNormalUser('liam', 'liam@test.fr', 'secret1');
  await c('POST', '/api/pointages/clock-in', { date: '2026-07-08' }); // oublie le départ
  assert.equal((await c('GET', '/api/pointages/status')).json.state, 'working');

  const r = await c('POST', '/api/pointages/clock-in', { date: '2026-07-09' }); // nouveau jour
  assert.equal(r.status, 200, 'clock-in du lendemain accepté');
  const list = (await c('GET', '/api/pointages')).json;
  assert.ok(list.some(p => p.endReason === 'oubli'), 'ancien segment marqué oubli');
});

test('société : suppression bloquée si encore utilisée', async () => {
  const c = await makeNormalUser('mia', 'mia@test.fr', 'secret1');
  const id = (await c('POST', '/api/companies', { name: 'Ma Boite' })).json.id;
  await c('POST', '/api/plannings', { companyId: id, date: '2026-07-08', startTime: '08:00', endTime: '12:00' });

  assert.equal((await c('DELETE', '/api/companies/' + id)).status, 400, 'société utilisée -> refus');

  const slot = (await c('GET', '/api/plannings')).json[0].id;
  await c('DELETE', '/api/plannings/' + slot);
  assert.equal((await c('DELETE', '/api/companies/' + id)).status, 200, 'plus utilisée -> suppression OK');
});

test('kiosque : PIN + badge arrivée/départ + rejets', async () => {
  const boss = makeClient();
  await boss('POST', '/api/login', { username: 'boss', password: 'pass123' });
  await boss('POST', '/api/admin/invite', { username: 'nate', password: 'nate123' });
  const nate = (await boss('GET', '/api/admin/users')).json.find(u => u.username === 'nate');

  const pinRes = await boss('POST', `/api/admin/users/${nate.id}/pin`);
  assert.equal(pinRes.status, 200);
  assert.match(pinRes.json.pin, /^\d{8}$/);
  const pin = pinRes.json.pin;

  const kiosk = await boss('POST', '/api/admin/kiosks', { label: 'Entrée' });
  assert.ok(kiosk.json.token);
  assert.ok(kiosk.json.qr && kiosk.json.qr.includes('<svg'), 'QR SVG généré');
  // Le jeton doit être dans le fragment (#), jamais en query (?token=).
  assert.ok(kiosk.json.url.includes('#token='), 'jeton dans le fragment');
  assert.ok(!kiosk.json.url.includes('?token='), 'pas de jeton en query string');
  const token = kiosk.json.token;

  const punch = (t, body) => fetch(base + '/api/kiosk/punch', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kiosk-Token': t },
    body: JSON.stringify(body),
  });

  let r = await punch(token, { pin, date: '2026-07-09' });
  let d = await r.json();
  assert.equal(d.action, 'in'); assert.equal(d.username, 'nate');

  r = await punch(token, { pin, date: '2026-07-09' });
  assert.equal((await r.json()).action, 'out', 'second badge = départ');

  assert.equal((await punch('mauvais-jeton', { pin })).status, 401, 'jeton invalide rejeté');
  assert.equal((await punch(token, { pin: '000001' })).status, 404, 'PIN inconnu rejeté');

  // Le badge a bien créé un pointage réel côté salarié.
  const nateClient = makeClient();
  await nateClient('POST', '/api/login', { username: 'nate', password: 'nate123' });
  assert.equal((await nateClient('GET', '/api/pointages')).json.length, 1);
});

test('réconciliation : la pause compte comme présence (écart nul)', async () => {
  const crypto = require('node:crypto');
  const c = await makeNormalUser('paul', 'paul@test.fr', 'secret1');
  const uid = db.prepare("SELECT id FROM users WHERE username = 'paul'").get().id;
  const ins = db.prepare('INSERT INTO pointages (id,user_id,work_date,clock_in,clock_out,end_reason,created_at) VALUES (?,?,?,?,?,?,?)');
  // 4h travail + 1h pause + 3h travail = 7h travaillées, 8h de présence
  ins.run(crypto.randomUUID(), uid, '2026-08-01', '2026-08-01T08:00:00.000Z', '2026-08-01T12:00:00.000Z', 'pause', 'x');
  ins.run(crypto.randomUUID(), uid, '2026-08-01', '2026-08-01T13:00:00.000Z', '2026-08-01T16:00:00.000Z', 'depart', 'x');
  await c('POST', '/api/plannings', { date: '2026-08-01', startTime: '08:00', endTime: '16:00' }); // prévu 8h

  const rec = (await c('GET', '/api/reconciliation?from=2026-08-01&to=2026-08-01')).json;
  assert.equal(rec.days[0].planned, 8, 'le prévu reste 8h (pause non déduite)');
  assert.equal(rec.days[0].real, 8, 'réel = présence = travail + pause');
  assert.equal(rec.days[0].ecart, 0, "aucun écart un jour normal avec pause");
});

test('pointage : ajout manuel + correction + validation', async () => {
  const c = await makeNormalUser('quinn', 'quinn@test.fr', 'secret1');
  // Ajout manuel d'un pointage terminé (rattrapage)
  let r = await c('POST', '/api/pointages/manual', { date: '2026-09-01', clockIn: '2026-09-01T08:00:00.000Z', clockOut: '2026-09-01T12:00:00.000Z' });
  assert.equal(r.status, 200);
  const id = r.json.id;
  const hoursOf = async () => Math.round((await c('GET', '/api/pointages')).json.find((p) => p.id === id).hours * 100) / 100;
  assert.equal(await hoursOf(), 4);

  // Validation : départ avant arrivée refusé
  assert.equal((await c('POST', '/api/pointages/manual', { date: '2026-09-01', clockIn: '2026-09-01T12:00:00.000Z', clockOut: '2026-09-01T08:00:00.000Z' })).status, 400);

  // Correction : porter à 5h
  r = await c('PUT', '/api/pointages/' + id, { date: '2026-09-01', clockIn: '2026-09-01T08:00:00.000Z', clockOut: '2026-09-01T13:00:00.000Z' });
  assert.equal(r.status, 200);
  assert.equal(await hoursOf(), 5);
});

// Utilitaire : récupère un cookie de session pour un appel fetch direct.
async function loginCookie(username, password) {
  const res = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}
