import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { rateLimit } from 'express-rate-limit';
import { createBase, finishApi, problem, text, date } from './core.js';
import { createToken, hashToken } from './auth.js';
import { transaction } from './db.js';
import { availableSlots } from '../shared/availability.js';
const serviceSchema = z.object({
  name: text(120).min(1),
  duration: z.number().int().min(15).max(180).multipleOf(15),
  priceCents: z.number().int().min(0).max(100000000),
  active: z.boolean(),
});
const read = (row) => ({
  id: row.id,
  staffId: row.staff_id,
  serviceId: row.service_id,
  customer: row.customer,
  email: row.email,
  note: row.note,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  status: row.status,
  snapshot: JSON.parse(row.snapshot),
});
export function createApp(db, options = { appUrl: 'http://localhost:3500' }) {
  const { app, workspace, origin } = createBase(db, options);
  const clock = options.clock || Date.now;
  function zone(userId) {
    return (
      db.prepare('SELECT timezone FROM settings WHERE user_id=?').get(userId)?.timezone || 'UTC'
    );
  }
  function staffFor(id, userId) {
    const row = db.prepare('SELECT * FROM staff WHERE id=? AND user_id=?').get(id, userId);
    if (!row) throw problem(404, 'No se encontró el profesional.');
    return row;
  }
  function page(token) {
    const row = db
      .prepare(
        'SELECT users.id,users.profile FROM booking_pages JOIN users ON users.id=booking_pages.user_id WHERE token_hash=?',
      )
      .get(hashToken(token));
    if (!row) throw problem(404, 'La agenda no está disponible.');
    return row;
  }
  function slots(userId, input) {
    const professional = staffFor(input.staffId, userId);
    const service = db
      .prepare('SELECT * FROM services WHERE id=? AND user_id=? AND active=1')
      .get(input.serviceId, userId);
    if (!service || !professional.active)
      throw problem(404, 'El servicio o profesional no está disponible.');
    const timezone = zone(userId);
    const day = DateTime.fromISO(input.date, { zone: timezone });
    const current = DateTime.fromMillis(clock(), { zone: timezone }).startOf('day');
    if (!day.isValid || day < current || day > current.plus({ days: 60 }))
      throw problem(400, 'Elige una fecha dentro de los próximos 60 días.');
    const hours = db.prepare('SELECT * FROM hours WHERE staff_id=?').all(professional.id);
    const busy = db
      .prepare(
        "SELECT starts_at AS startsAt,ends_at AS endsAt FROM appointments WHERE staff_id=? AND status!='cancelled'",
      )
      .all(professional.id);
    return {
      slots: availableSlots({
        date: input.date,
        zone: timezone,
        duration: service.duration,
        hours,
        busy,
        now: clock(),
      }),
      service,
      professional,
      timezone,
    };
  }
  workspace.get('/state', (req, res) =>
    res.json({
      timezone: zone(req.user.id),
      staff: db
        .prepare('SELECT id,name,active FROM staff WHERE user_id=?')
        .all(req.user.id)
        .map((item) => ({
          ...item,
          active: Boolean(item.active),
          hours: db
            .prepare('SELECT weekday,start,end FROM hours WHERE staff_id=? ORDER BY weekday')
            .all(item.id),
        })),
      services: db
        .prepare(
          'SELECT id,name,duration,price_cents AS priceCents,active FROM services WHERE user_id=?',
        )
        .all(req.user.id)
        .map((item) => ({ ...item, active: Boolean(item.active) })),
      appointments: db
        .prepare('SELECT * FROM appointments WHERE user_id=? ORDER BY starts_at')
        .all(req.user.id)
        .map(read),
    }),
  );
  workspace.put('/timezone', (req, res) => {
    const input = z
      .object({
        timezone: text(80).refine(
          (value) => DateTime.now().setZone(value).isValid,
          'La zona horaria no es válida.',
        ),
      })
      .parse(req.body);
    if (
      db
        .prepare(
          "SELECT id FROM appointments WHERE user_id=? AND status='confirmed' AND starts_at>?",
        )
        .get(req.user.id, new Date(clock()).toISOString())
    )
      throw problem(
        409,
        'Cancela o completa las reservas futuras antes de cambiar la zona horaria.',
      );
    db.prepare(
      'INSERT INTO settings(user_id,timezone) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET timezone=excluded.timezone',
    ).run(req.user.id, input.timezone);
    res.json({ ok: true });
  });
  workspace.post('/staff', (req, res) => {
    const input = z.object({ name: text(100).min(1) }).parse(req.body);
    const id = randomUUID();
    db.prepare('INSERT INTO staff(id,user_id,name) VALUES(?,?,?)').run(id, req.user.id, input.name);
    res.status(201).json({ id });
  });
  workspace.patch('/staff/:id', (req, res) => {
    const input = z.object({ active: z.boolean() }).parse(req.body);
    staffFor(req.params.id, req.user.id);
    db.prepare('UPDATE staff SET active=? WHERE id=?').run(Number(input.active), req.params.id);
    res.json({ ok: true });
  });
  workspace.put('/staff/:id/hours', (req, res) => {
    staffFor(req.params.id, req.user.id);
    const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
    const input = z
      .object({
        hours: z
          .array(
            z
              .object({ weekday: z.number().int().min(1).max(7), start: time, end: time })
              .refine((item) => item.start < item.end),
          )
          .max(7),
      })
      .refine(
        (input) => new Set(input.hours.map((item) => item.weekday)).size === input.hours.length,
      )
      .parse(req.body);
    transaction(db, () => {
      db.prepare('DELETE FROM hours WHERE staff_id=?').run(req.params.id);
      for (const h of input.hours)
        db.prepare('INSERT INTO hours(staff_id,weekday,start,end) VALUES(?,?,?,?)').run(
          req.params.id,
          h.weekday,
          h.start,
          h.end,
        );
    });
    res.json({ ok: true });
  });
  workspace.post('/services', (req, res) => {
    const input = serviceSchema.parse(req.body);
    const id = randomUUID();
    db.prepare(
      'INSERT INTO services(id,user_id,name,duration,price_cents,active) VALUES(?,?,?,?,?,?)',
    ).run(id, req.user.id, input.name, input.duration, input.priceCents, Number(input.active));
    res.status(201).json({ id });
  });
  workspace.put('/services/:id', (req, res) => {
    const input = serviceSchema.parse(req.body);
    const result = db
      .prepare(
        'UPDATE services SET name=?,duration=?,price_cents=?,active=? WHERE id=? AND user_id=?',
      )
      .run(
        input.name,
        input.duration,
        input.priceCents,
        Number(input.active),
        req.params.id,
        req.user.id,
      );
    if (!result.changes) throw problem(404, 'No se encontró el servicio.');
    res.json({ ok: true });
  });
  workspace.post('/booking-link', (req, res) => {
    const token = createToken();
    db.prepare(
      'INSERT INTO booking_pages(user_id,token_hash) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash',
    ).run(req.user.id, hashToken(token));
    res.json({ url: origin + '/book/' + token });
  });
  workspace.patch('/appointments/:id', (req, res) => {
    const input = z.object({ status: z.enum(['cancelled', 'completed']) }).parse(req.body);
    const row = db
      .prepare('SELECT * FROM appointments WHERE id=? AND user_id=?')
      .get(req.params.id, req.user.id);
    if (!row) throw problem(404, 'No se encontró la cita.');
    if (row.status !== 'confirmed') throw problem(409, 'La cita ya está cerrada.');
    if (input.status === 'completed' && new Date(row.ends_at).getTime() > clock())
      throw problem(409, 'La cita todavía no ha terminado.');
    db.prepare('UPDATE appointments SET status=? WHERE id=?').run(input.status, row.id);
    res.json({ ok: true });
  });
  app.get('/api/book/:token', (req, res) => {
    const owner = page(req.params.token);
    res.json({
      name: JSON.parse(owner.profile).label,
      currency: JSON.parse(owner.profile).currency,
      timezone: zone(owner.id),
      staff: db.prepare('SELECT id,name FROM staff WHERE user_id=? AND active=1').all(owner.id),
      services: db
        .prepare(
          'SELECT id,name,duration,price_cents AS priceCents FROM services WHERE user_id=? AND active=1',
        )
        .all(owner.id),
    });
  });
  app.get('/api/book/:token/slots', (req, res) => {
    const owner = page(req.params.token);
    const input = z
      .object({ staffId: z.string().uuid(), serviceId: z.string().uuid(), date })
      .parse(req.query);
    res.json({ slots: slots(owner.id, input).slots });
  });
  const limit = rateLimit({
    windowMs: 900000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Demasiadas reservas. Inténtalo más tarde.' },
  });
  app.post('/api/book/:token', limit, (req, res) => {
    const owner = page(req.params.token);
    const input = z
      .object({
        staffId: z.string().uuid(),
        serviceId: z.string().uuid(),
        date,
        startsAt: z.iso.datetime(),
        customer: text(100).min(2),
        email: z.email().max(254),
        note: text(1000),
      })
      .parse(req.body);
    const cancel = createToken();
    const appointment = transaction(db, () => {
      const available = slots(owner.id, input);
      const selected = available.slots.find((slot) => slot.startsAt === input.startsAt);
      if (!selected) throw problem(409, 'Ese horario ya no está disponible. Elige otro.');
      const id = randomUUID();
      const profile = JSON.parse(owner.profile);
      db.prepare(
        'INSERT INTO appointments(id,user_id,staff_id,service_id,customer,email,note,starts_at,ends_at,snapshot,cancel_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        owner.id,
        input.staffId,
        input.serviceId,
        input.customer,
        input.email,
        input.note,
        selected.startsAt,
        selected.endsAt,
        JSON.stringify({
          service: available.service.name,
          professional: available.professional.name,
          priceCents: available.service.price_cents,
          currency: profile.currency,
          timezone: available.timezone,
        }),
        hashToken(cancel),
        new Date(clock()).toISOString(),
      );
      return read(db.prepare('SELECT * FROM appointments WHERE id=?').get(id));
    });
    res.status(201).json({ appointment, url: origin + '/appointment/' + cancel });
  });
  app.get('/api/appointment/:token', (req, res) => {
    const row = db
      .prepare('SELECT * FROM appointments WHERE cancel_hash=?')
      .get(hashToken(req.params.token));
    if (!row) throw problem(404, 'La reserva no está disponible.');
    res.json({ appointment: read(row) });
  });
  app.post('/api/appointment/:token/cancel', (req, res) => {
    const row = db
      .prepare('SELECT * FROM appointments WHERE cancel_hash=?')
      .get(hashToken(req.params.token));
    if (!row) throw problem(404, 'No se encontró la reserva.');
    if (row.status !== 'confirmed' || new Date(row.starts_at).getTime() <= clock())
      throw problem(409, 'Ya no puedes cancelar esta cita desde el enlace.');
    db.prepare("UPDATE appointments SET status='cancelled' WHERE id=?").run(row.id);
    res.json({ ok: true });
  });
  return finishApi(app);
}
