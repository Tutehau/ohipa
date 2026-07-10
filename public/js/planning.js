let companies = [];
let weekOffset = 0;
let modal = null;

const roundH = (n) => Math.round((n || 0) * 100) / 100;
const isoOf = (d) => d.toLocaleDateString('sv-SE');

function weekDays(offset = 0) {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(now.getDate() - dow + offset * 7);
  const today = isoOf(new Date());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const iso = isoOf(d);
    days.push({
      iso,
      name: d.toLocaleDateString('fr-FR', { weekday: 'short' }),
      num: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
      isToday: iso === today,
      isPast: iso < today,
    });
  }
  return days;
}

async function loadCompanies(selectedId) {
  companies = await api('/api/companies');
  const sel = document.getElementById('slot-company');
  sel.innerHTML = ['<option value="">— Aucune —</option>']
    .concat(companies.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`))
    .join('');
}

let weekSlots = [];
async function loadWeek() {
  const days = weekDays(weekOffset);
  document.getElementById('week-label').textContent =
    weekOffset === 0 ? 'Cette semaine' : `${days[0].num} – ${days[6].num}`;
  document.getElementById('week-today').classList.toggle('active', weekOffset === 0);

  weekSlots = await api(`/api/plannings?from=${days[0].iso}&to=${days[6].iso}`);
  const byDay = {};
  for (const s of weekSlots) (byDay[s.date] ||= []).push(s);

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = days.map((d) => {
    const slots = (byDay[d.iso] || []).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const items = slots.map((s) => `
      <div class="cal-slot" data-id="${escapeHtml(s.id)}">
        <div class="t">${escapeHtml(s.startTime)}–${escapeHtml(s.endTime)}</div>
        <div class="c">${escapeHtml(s.companyName || 'Sans société')}${s.note ? ' · ' + escapeHtml(s.note) : ''}</div>
      </div>`).join('');
    return `<div class="cal-day ${d.isToday ? 'is-today' : ''} ${d.isPast ? 'is-past' : ''}">
      <div class="cal-day-head"><span class="cal-day-name">${escapeHtml(d.name)}</span><span class="cal-day-num">${escapeHtml(d.num)}</span></div>
      <div class="cal-slots">${items}</div>
      <button class="cal-add" data-add="${escapeHtml(d.iso)}"><i class="bi bi-plus-lg"></i></button>
    </div>`;
  }).join('');

  document.getElementById('week-total').textContent = roundH(weekSlots.reduce((s, x) => s + x.hours, 0)) + 'h';
}

function openNew(date) {
  document.getElementById('modal-title').innerHTML = '<i class="bi bi-plus-circle me-2"></i>Nouveau créneau';
  document.getElementById('slot-form').reset();
  document.getElementById('slot-id').value = '';
  document.getElementById('slot-date').value = date || isoOf(new Date());
  document.getElementById('slot-start').value = '08:00';
  document.getElementById('slot-end').value = '17:00';
  loadCompanies();
  document.getElementById('btn-delete').classList.add('d-none');
  modal.show();
}

function openEdit(slot) {
  document.getElementById('modal-title').innerHTML = '<i class="bi bi-pencil me-2"></i>Modifier le créneau';
  document.getElementById('slot-id').value = slot.id;
  document.getElementById('slot-date').value = slot.date;
  document.getElementById('slot-start').value = slot.startTime;
  document.getElementById('slot-end').value = slot.endTime;
  document.getElementById('slot-note').value = slot.note || '';
  loadCompanies(slot.companyId);
  document.getElementById('btn-delete').classList.remove('d-none');
  modal.show();
}

(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'planning');
  modal = new bootstrap.Modal(document.getElementById('slot-modal'));
  await loadCompanies();
  await loadWeek();

  document.getElementById('week-prev').onclick = () => { weekOffset--; loadWeek(); };
  document.getElementById('week-next').onclick = () => { weekOffset++; loadWeek(); };
  document.getElementById('week-today').onclick = () => { weekOffset = 0; loadWeek(); };
  document.getElementById('btn-new').onclick = () => openNew(weekOffset === 0 ? isoOf(new Date()) : weekDays(weekOffset)[0].iso);

  document.getElementById('cal-grid').addEventListener('click', (ev) => {
    const add = ev.target.closest('button[data-add]');
    const slotEl = ev.target.closest('.cal-slot');
    if (add) openNew(add.dataset.add);
    else if (slotEl) { const s = weekSlots.find((x) => x.id === slotEl.dataset.id); if (s) openEdit(s); }
  });

  document.getElementById('slot-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('slot-id').value;
    const payload = {
      companyId: document.getElementById('slot-company').value || null,
      date: document.getElementById('slot-date').value,
      startTime: document.getElementById('slot-start').value,
      endTime: document.getElementById('slot-end').value,
      note: document.getElementById('slot-note').value,
    };
    try {
      if (id) await api('/api/plannings/' + id, 'PUT', payload);
      else await api('/api/plannings', 'POST', payload);
      modal.hide(); showAlert(id ? 'Créneau mis à jour.' : 'Créneau ajouté.', 'success');
      await loadWeek();
    } catch (err) { showAlert(err.message); }
  };

  document.getElementById('btn-delete').onclick = async () => {
    const id = document.getElementById('slot-id').value;
    if (!id || !confirm('Supprimer ce créneau ?')) return;
    try { await api('/api/plannings/' + id, 'DELETE'); modal.hide(); await loadWeek(); }
    catch (err) { showAlert(err.message); }
  };

  document.getElementById('btn-add-company').onclick = async () => {
    const name = prompt('Nom de la nouvelle société :');
    if (!name || !name.trim()) return;
    try { const c = await api('/api/companies', 'POST', { name: name.trim() }); await loadCompanies(c.id); }
    catch (e) { showAlert(e.message); }
  };
})();
