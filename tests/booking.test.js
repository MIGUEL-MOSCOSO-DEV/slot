import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { availableSlots } from '../shared/availability.js';
let f, owner, other, staffId, serviceId, token, selected, cancelToken;
const now = Date.parse('2026-01-05T00:00:00.000Z');
const booking = () => ({
  staffId,
  serviceId,
  date: '2026-01-06',
  startsAt: selected,
  customer: 'Cliente',
  email: 'client@tests.invalid',
  note: '',
});
before(async () => {
  f = await fixture({ clock: () => now });
  owner = await f.register('Owner');
  other = await f.register('Other');
});
after(async () => f.close());
test('requiere horarios explícitos y aísla profesionales', async () => {
  let result = await f.request('/workspace/staff', {
    cookie: owner.cookie,
    method: 'POST',
    body: { name: 'Profesional' },
  });
  staffId = result.data.id;
  assert.equal(
    (
      await f.request('/workspace/staff/' + staffId + '/hours', {
        cookie: other.cookie,
        method: 'PUT',
        body: { hours: [] },
      })
    ).status,
    404,
  );
  await f.request('/workspace/staff/' + staffId + '/hours', {
    cookie: owner.cookie,
    method: 'PUT',
    body: { hours: [{ weekday: 2, start: '09:00', end: '10:00' }] },
  });
  result = await f.request('/workspace/services', {
    cookie: owner.cookie,
    method: 'POST',
    body: { name: 'Servicio', duration: 30, priceCents: 5000, active: true },
  });
  serviceId = result.data.id;
  result = await f.request('/workspace/booking-link', {
    cookie: owner.cookie,
    method: 'POST',
    body: {},
  });
  token = new URL(result.data.url).pathname.split('/')[2];
});
test('ofrece huecos que caben completos en la jornada', async () => {
  const result = await f.request(
    '/book/' + token + '/slots?' + new URLSearchParams({ staffId, serviceId, date: '2026-01-06' }),
  );
  assert.equal(result.status, 200);
  assert.equal(result.data.slots.length, 3);
  selected = result.data.slots[0].startsAt;
  assert.equal(selected, '2026-01-06T09:00:00.000Z');
});
test('dos solicitudes simultáneas no reservan el mismo horario', async () => {
  const results = await Promise.all([
    f.request('/book/' + token, { method: 'POST', body: booking() }),
    f.request('/book/' + token, {
      method: 'POST',
      body: { ...booking(), email: 'second@tests.invalid' },
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  cancelToken = new URL(results.find((r) => r.status === 201).data.url).pathname.split('/')[2];
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM appointments').get().n, 1);
});
test('conserva precio y duración, protege la zona y permite cancelar', async () => {
  await f.request('/workspace/services/' + serviceId, {
    cookie: owner.cookie,
    method: 'PUT',
    body: { name: 'Servicio actualizado', duration: 60, priceCents: 9000, active: true },
  });
  assert.equal(
    (await f.request('/appointment/' + cancelToken)).data.appointment.snapshot.priceCents,
    5000,
  );
  assert.equal(
    (
      await f.request('/workspace/timezone', {
        cookie: owner.cookie,
        method: 'PUT',
        body: { timezone: 'America/Lima' },
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.request('/appointment/' + cancelToken + '/cancel', { method: 'POST', body: {} }))
      .status,
    200,
  );
  assert.equal(
    (await f.request('/appointment/' + cancelToken + '/cancel', { method: 'POST', body: {} }))
      .status,
    409,
  );
});
test('omite horas inexistentes o ambiguas por cambio de horario', () => {
  const input = {
    zone: 'America/New_York',
    duration: 30,
    hours: [{ weekday: 7, start: '01:00', end: '04:00' }],
    busy: [],
    now: 0,
  };
  assert.ok(
    availableSlots({ ...input, date: '2026-03-08' }).every((s) => !s.label.startsWith('02:')),
  );
  assert.ok(
    availableSlots({ ...input, date: '2026-11-01' }).every((s) => !s.label.startsWith('01:')),
  );
});
test('rechaza horarios inventados y fechas fuera de la ventana', async () => {
  assert.equal(
    (
      await f.request('/book/' + token, {
        method: 'POST',
        body: { ...booking(), startsAt: '2026-01-06T04:00:00.000Z' },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(
        '/book/' +
          token +
          '/slots?' +
          new URLSearchParams({ staffId, serviceId, date: '2027-01-06' }),
      )
    ).status,
    400,
  );
});
