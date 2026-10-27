import React, { useState } from 'react';
import { DateTime } from 'luxon';
import { Plus, ChevronLeft, ChevronRight, CalendarDays, Link2 } from 'lucide-react';
import { api } from './api.js';
import {
  Session,
  Brand,
  Identity,
  Button,
  Field,
  Modal,
  Notice,
  Empty,
  useTask,
  useData,
  money,
  dateLabel,
  LinkModal,
} from './ui.jsx';
export default function App() {
  const path = window.location.pathname.split('/');
  if (path[1] === 'book') return <Booking token={path[2]} />;
  if (path[1] === 'appointment') return <Confirmation token={path[2]} />;
  return <Session>{(user, onUser) => <Agenda user={user} onUser={onUser} />}</Session>;
}
function Agenda({ user, onUser }) {
  const { data, error, reload } = useData('/workspace/state');
  const [tab, setTab] = useState('agenda');
  const [date, setDate] = useState(DateTime.now().toISODate());
  const [form, setForm] = useState(null);
  const [link, setLink] = useState('');
  const task = useTask();
  const day = DateTime.fromISO(date);
  const week = day.startOf('week');
  return (
    <div className="agenda">
      <aside className="date-rail">
        <Brand />
        <span className="rail-label">TU TIEMPO, EN ORDEN</span>
        <div className="date-display">
          <span>{day.setLocale('es').toFormat('LLLL')}</span>
          <strong>{day.day}</strong>
          <small>{day.setLocale('es').toFormat('cccc')}</small>
        </div>
        <Field
          label="Ir a una fecha"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <nav>
          {[
            ['agenda', 'Agenda'],
            ['services', 'Servicios'],
            ['staff', 'Equipo'],
            ['settings', 'Zona horaria'],
          ].map(([key, label]) => (
            <button className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
        <Identity user={user} onUser={onUser} />
      </aside>
      <main>
        <header className="agenda-heading">
          <div>
            <span className="eyebrow">
              {data?.timezone || 'UTC'} / {day.year}
            </span>
            <h1>
              {tab === 'agenda'
                ? 'Cada cita, su momento.'
                : tab === 'services'
                  ? 'Lo que ofreces.'
                  : tab === 'staff'
                    ? 'Quién hace que suceda.'
                    : 'Desde dónde reservas.'}
            </h1>
          </div>
          <Button
            secondary
            onClick={() =>
              task.perform(async () => {
                const result = await api('/workspace/booking-link', { method: 'POST', body: {} });
                setLink(result.url);
              })
            }
          >
            <Link2 size={15} /> Enlace de reservas
          </Button>
        </header>
        <Notice error={error || task.error} />
        {!data ? (
          <p>Cargando agenda…</p>
        ) : tab === 'agenda' ? (
          <>
            <div className="week-strip">
              <button
                className="icon"
                aria-label="Semana anterior"
                onClick={() => setDate(day.minus({ weeks: 1 }).toISODate())}
              >
                <ChevronLeft size={18} />
              </button>
              {Array.from({ length: 7 }, (_, i) => week.plus({ days: i })).map((d) => (
                <button
                  className={d.toISODate() === date ? 'selected' : ''}
                  key={d.day}
                  onClick={() => setDate(d.toISODate())}
                >
                  <span>{d.setLocale('es').toFormat('ccc')}</span>
                  <strong>{d.day}</strong>
                </button>
              ))}
              <button
                className="icon"
                aria-label="Semana siguiente"
                onClick={() => setDate(day.plus({ weeks: 1 }).toISODate())}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            {!data.staff.length ? (
              <Empty
                title="Dale un primer nombre a tu agenda."
                action={
                  <Button
                    onClick={() => {
                      setTab('staff');
                      setForm({ type: 'staff' });
                    }}
                  >
                    Añadir profesional
                  </Button>
                }
              >
                Configura tu equipo, sus horarios y los servicios que se pueden reservar.
              </Empty>
            ) : (
              <div className="calendar-scroll">
                <div
                  className="calendar"
                  style={{
                    gridTemplateColumns:
                      '65px repeat(' + data.staff.length + ', minmax(190px,1fr))',
                  }}
                >
                  <div className="calendar-corner">HORA</div>
                  {data.staff.map((person) => (
                    <header key={person.id}>
                      <span>{person.name.slice(0, 1)}</span>
                      {person.name}
                    </header>
                  ))}
                  {Array.from({ length: 13 }, (_, i) => i + 7).map((hour) => (
                    <React.Fragment key={hour}>
                      <time>{String(hour).padStart(2, '0')}:00</time>
                      {data.staff.map((person) => (
                        <div className="hour-cell" key={person.id}>
                          {data.appointments
                            .filter(
                              (a) =>
                                a.staffId === person.id &&
                                a.status !== 'cancelled' &&
                                DateTime.fromISO(a.startsAt).setZone(data.timezone).toISODate() ===
                                  date &&
                                DateTime.fromISO(a.startsAt).setZone(data.timezone).hour === hour,
                            )
                            .map((a) => (
                              <button
                                className={'appointment ' + a.status}
                                key={a.id}
                                onClick={() => setForm({ type: 'appointment', ...a })}
                              >
                                <span>
                                  {DateTime.fromISO(a.startsAt)
                                    .setZone(data.timezone)
                                    .toFormat('HH:mm')}{' '}
                                  · {a.snapshot.service}
                                </span>
                                <strong>{a.customer}</strong>
                              </button>
                            ))}
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                </div>
                <div className="outside-hours">
                  {data.appointments
                    .filter(
                      (a) =>
                        a.status !== 'cancelled' &&
                        DateTime.fromISO(a.startsAt).setZone(data.timezone).toISODate() === date &&
                        ![7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].includes(
                          DateTime.fromISO(a.startsAt).setZone(data.timezone).hour,
                        ),
                    )
                    .map((a) => (
                      <button key={a.id} onClick={() => setForm({ type: 'appointment', ...a })}>
                        {dateLabel(a.startsAt)} · {a.customer}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </>
        ) : tab === 'services' ? (
          <section className="service-sheet">
            <div className="sheet-heading">
              <h2>Catálogo de servicios</h2>
              <Button onClick={() => setForm({ type: 'service' })}>
                <Plus size={15} /> Añadir servicio
              </Button>
            </div>
            {data.services.map((service) => (
              <article key={service.id}>
                <span className="service-number">
                  {service.duration}
                  <small>MIN</small>
                </span>
                <div>
                  <h3>{service.name}</h3>
                  <p>
                    {money(service.priceCents, user.currency)} ·{' '}
                    {service.active ? 'Disponible' : 'Pausado'}
                  </p>
                </div>
                <Button secondary onClick={() => setForm({ type: 'service', ...service })}>
                  Editar
                </Button>
              </article>
            ))}
            {!data.services.length && (
              <Empty title="El tiempo también tiene especialidades.">
                Añade el primer servicio y define cuánto dura.
              </Empty>
            )}
          </section>
        ) : tab === 'staff' ? (
          <section className="team-sheet">
            <div className="sheet-heading">
              <h2>Profesionales y horarios</h2>
              <Button onClick={() => setForm({ type: 'staff' })}>
                <Plus size={15} /> Añadir profesional
              </Button>
            </div>
            {data.staff.map((person) => (
              <article key={person.id}>
                <h3>{person.name}</h3>
                <p>
                  {person.hours.length} días con disponibilidad ·{' '}
                  {person.active ? 'Activo' : 'Pausado'}
                </p>
                <div className="row">
                  <Button secondary onClick={() => setForm({ type: 'hours', ...person })}>
                    Definir horarios
                  </Button>
                  <button
                    className="text-link"
                    onClick={() =>
                      task.perform(async () => {
                        await api('/workspace/staff/' + person.id, {
                          method: 'PATCH',
                          body: { active: !person.active },
                        });
                        await reload();
                      })
                    }
                  >
                    {person.active ? 'Pausar' : 'Activar'}
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <form
            className="zone-form stack"
            onSubmit={(event) => {
              event.preventDefault();
              const timezone = new FormData(event.currentTarget).get('timezone');
              task.perform(async () => {
                await api('/workspace/timezone', { method: 'PUT', body: { timezone } });
                await reload();
              }, 'Zona horaria actualizada.');
            }}
          >
            <h2>Una agenda, una zona horaria.</h2>
            <p>
              Se usa para ofrecer los horarios al cliente. La fecha y hora de cada reserva se
              guardan en UTC.
            </p>
            <Notice success={task.success} />
            <Field label="Zona IANA" name="timezone" defaultValue={data.timezone} required />
            <Button busy={task.busy}>Guardar zona horaria</Button>
          </form>
        )}
        {form && (
          <SetupForm
            value={form}
            user={user}
            onClose={() => setForm(null)}
            onSaved={async () => {
              setForm(null);
              await reload();
            }}
          />
        )}
        {link && (
          <LinkModal url={link} title="Tu agenda para compartir" onClose={() => setLink('')} />
        )}
      </main>
    </div>
  );
}
function SetupForm({ value, user, onClose, onSaved }) {
  const task = useTask();
  const [hours, setHours] = useState(value.hours || []);
  function submit(event) {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.currentTarget));
    task.perform(async () => {
      if (value.type === 'hours')
        await api('/workspace/staff/' + value.id + '/hours', { method: 'PUT', body: { hours } });
      else if (value.type === 'staff')
        await api('/workspace/staff', { method: 'POST', body: { name: f.name } });
      else if (value.type === 'service')
        await api('/workspace/services' + (value.id ? '/' + value.id : ''), {
          method: value.id ? 'PUT' : 'POST',
          body: {
            name: f.name,
            duration: Number(f.duration),
            priceCents: Math.round(Number(f.price) * 100),
            active: f.active === 'on',
          },
        });
      await onSaved();
    });
  }
  return (
    <Modal
      title={
        value.type === 'hours'
          ? 'Horarios de ' + value.name
          : value.type === 'appointment'
            ? 'Detalle de la cita'
            : value.type === 'staff'
              ? 'Añadir profesional'
              : 'Servicio'
      }
      onClose={onClose}
    >
      <Notice error={task.error} />
      {value.type === 'appointment' ? (
        <div className="stack">
          <h3>{value.customer}</h3>
          <p>
            {value.snapshot.service} · {value.snapshot.professional}
          </p>
          <p>
            {dateLabel(value.startsAt)} · {value.email}
          </p>
          <p>{value.note}</p>
          <span className="badge">{value.status}</span>
          {value.status === 'confirmed' && (
            <div className="row">
              <Button
                secondary
                busy={task.busy}
                onClick={() =>
                  task.perform(async () => {
                    await api('/workspace/appointments/' + value.id, {
                      method: 'PATCH',
                      body: { status: 'cancelled' },
                    });
                    await onSaved();
                  })
                }
              >
                Cancelar cita
              </Button>
              <Button
                busy={task.busy}
                disabled={new Date(value.endsAt) > new Date()}
                onClick={() =>
                  task.perform(async () => {
                    await api('/workspace/appointments/' + value.id, {
                      method: 'PATCH',
                      body: { status: 'completed' },
                    });
                    await onSaved();
                  })
                }
              >
                Marcar atendida
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          {value.type === 'hours' ? (
            <>
              {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map(
                (name, i) => {
                  const h = hours.find((h) => h.weekday === i + 1);
                  return (
                    <div className="hours-row" key={name}>
                      <label>
                        <input
                          type="checkbox"
                          checked={Boolean(h)}
                          onChange={(event) =>
                            setHours(
                              event.target.checked
                                ? [...hours, { weekday: i + 1, start: '09:00', end: '17:00' }]
                                : hours.filter((item) => item.weekday !== i + 1),
                            )
                          }
                        />
                        {name}
                      </label>
                      {h && (
                        <>
                          <input
                            aria-label={'Inicio ' + name}
                            type="time"
                            value={h.start}
                            onChange={(event) =>
                              setHours(
                                hours.map((item) =>
                                  item.weekday === i + 1
                                    ? { ...item, start: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                          <input
                            aria-label={'Final ' + name}
                            type="time"
                            value={h.end}
                            onChange={(event) =>
                              setHours(
                                hours.map((item) =>
                                  item.weekday === i + 1
                                    ? { ...item, end: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </>
                      )}
                    </div>
                  );
                },
              )}
            </>
          ) : (
            <>
              <Field
                label="Nombre"
                name="name"
                defaultValue={value.name || ''}
                required
                maxLength={120}
              />
              {value.type === 'service' && (
                <>
                  <div className="grid">
                    <Field
                      label="Duración (minutos)"
                      name="duration"
                      type="number"
                      min="15"
                      max="180"
                      step="15"
                      defaultValue={value.duration || 30}
                      required
                    />
                    <Field
                      label={'Precio · ' + user.currency}
                      name="price"
                      type="number"
                      min="0"
                      step=".01"
                      defaultValue={value.id ? value.priceCents / 100 : ''}
                      required
                    />
                  </div>
                  <label className="check-label">
                    <input type="checkbox" name="active" defaultChecked={value.active ?? true} />{' '}
                    Servicio disponible
                  </label>
                </>
              )}
            </>
          )}
          <Button busy={task.busy}>Guardar</Button>
        </form>
      )}
    </Modal>
  );
}
function Booking({ token }) {
  const { data, error } = useData('/book/' + token);
  const [choice, setChoice] = useState({
    staffId: '',
    serviceId: '',
    date: DateTime.now().toISODate(),
    startsAt: '',
  });
  const [slots, setSlots] = useState([]);
  const task = useTask();
  function find() {
    task.perform(async () => {
      const result = await api(
        '/book/' +
          token +
          '/slots?' +
          new URLSearchParams({
            staffId: choice.staffId,
            serviceId: choice.serviceId,
            date: choice.date,
          }),
      );
      setSlots(result.slots);
      setChoice({ ...choice, startsAt: '' });
    });
  }
  function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    task.perform(async () => {
      const result = await api('/book/' + token, {
        method: 'POST',
        body: { ...choice, ...values },
      });
      window.location.assign(result.url);
    });
  }
  return (
    <main className="booking-page">
      <aside>
        <Brand />
        <span className="eyebrow">UN MOMENTO PARA TI</span>
        <h1>{data?.name || 'Reserva tu próxima cita.'}</h1>
        <p>Elige el servicio, encuentra tu hora y déjanos el resto.</p>
        <CalendarDays size={80} strokeWidth={0.7} />
        <small>{data?.timezone}</small>
      </aside>
      <section>
        <Notice error={error || task.error} />
        {data && (
          <>
            <span className="booking-step">01 / ELIGE TU MOMENTO</span>
            <div className="stack">
              <Field label="Servicio">
                <select
                  value={choice.serviceId}
                  onChange={(event) => {
                    setChoice({ ...choice, serviceId: event.target.value, startsAt: '' });
                    setSlots([]);
                  }}
                >
                  <option value="">Seleccionar servicio</option>
                  {data.services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.duration} min · {money(s.priceCents, data.currency)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Profesional">
                <select
                  value={choice.staffId}
                  onChange={(event) => {
                    setChoice({ ...choice, staffId: event.target.value, startsAt: '' });
                    setSlots([]);
                  }}
                >
                  <option value="">Seleccionar profesional</option>
                  {data.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Fecha"
                type="date"
                value={choice.date}
                onChange={(event) => {
                  setChoice({ ...choice, date: event.target.value, startsAt: '' });
                  setSlots([]);
                }}
              />
              <Button
                secondary
                busy={task.busy}
                disabled={!choice.staffId || !choice.serviceId}
                onClick={find}
              >
                Consultar horarios
              </Button>
              <div className="time-options">
                {slots.map((slot) => (
                  <button
                    className={choice.startsAt === slot.startsAt ? 'selected' : ''}
                    key={slot.startsAt}
                    onClick={() => setChoice({ ...choice, startsAt: slot.startsAt })}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
              {task.success && <p>{task.success}</p>}
              {!slots.length && (
                <p className="muted">
                  Consulta una fecha para ver los horarios libres. Si no aparecen, elige otro día.
                </p>
              )}
            </div>
            {choice.startsAt && (
              <form onSubmit={submit} className="booking-details stack">
                <span className="booking-step">02 / CONFIRMA TUS DATOS</span>
                <Field label="Tu nombre" name="customer" required minLength={2} maxLength={100} />
                <Field label="Correo electrónico" name="email" type="email" required />
                <Field label="Nota opcional">
                  <textarea name="note" rows={3} maxLength={1000} />
                </Field>
                <Button busy={task.busy}>Confirmar reserva</Button>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  );
}
function Confirmation({ token }) {
  const { data, error, reload } = useData('/appointment/' + token);
  const task = useTask();
  const a = data?.appointment;
  return (
    <main className="reservation">
      <Brand />
      <Notice error={error || task.error} />
      {a && (
        <section>
          <span className="eyebrow">
            TU RESERVA /{' '}
            {a.status === 'confirmed'
              ? 'CONFIRMADA'
              : a.status === 'cancelled'
                ? 'CANCELADA'
                : 'ATENDIDA'}
          </span>
          <h1>{a.snapshot.service}</h1>
          <h2>
            {DateTime.fromISO(a.startsAt)
              .setZone(a.snapshot.timezone)
              .setLocale('es')
              .toFormat('cccc, d LLLL · HH:mm')}
          </h2>
          <p>
            {a.snapshot.professional} · {a.snapshot.timezone}
          </p>
          <p>
            {a.customer} · {money(a.snapshot.priceCents, a.snapshot.currency)}
          </p>
          <p className="muted">Conserva este enlace. No se envían correos automáticos.</p>
          {a.status === 'confirmed' && (
            <Button
              secondary
              busy={task.busy}
              onClick={() =>
                task.perform(async () => {
                  await api('/appointment/' + token + '/cancel', { method: 'POST', body: {} });
                  await reload();
                })
              }
            >
              Cancelar mi reserva
            </Button>
          )}
        </section>
      )}
    </main>
  );
}
