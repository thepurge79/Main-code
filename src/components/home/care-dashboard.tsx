import { useState, useEffect, useRef } from 'react';
import { useRevalidator } from 'react-router';
import { HeartPulse, LayoutDashboard, Pill, ChartNoAxesCombined, Settings, Bell, Plus, ArrowUpRight, Check, ShieldCheck, LogOut, Download, ChevronRight, Leaf, CircleHelp, Volume2, Upload, Play, Music, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { pocketbaseClient as pb } from '@/lib/pocketbase-client';
import { dayKey, dueToday, type CareData } from '@/lib/care';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AuthPanel } from '@/components/home/auth-panel';
import { LoginScreen } from '@/components/home/login-screen';
import { TreatmentForm } from '@/components/home/treatment-form';
import { TodaySchedule } from '@/components/home/today-schedule';
import { ReminderModal, type Reminder } from '@/components/home/reminder-modal';
import type { RecordModel } from 'pocketbase';

function playTone(tone: string) {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const presets: Record<string, { freq: number; type: OscillatorType; dur: number }[]> = {
      suave: [{ freq: 440, type: 'sine', dur: 0.5 }],
      campana: [{ freq: 880, type: 'triangle', dur: 0.25 }, { freq: 660, type: 'triangle', dur: 0.35 }],
      notificacion: [{ freq: 587, type: 'sine', dur: 0.15 }, { freq: 784, type: 'sine', dur: 0.25 }],
      alarma: [{ freq: 988, type: 'square', dur: 0.18 }, { freq: 988, type: 'square', dur: 0.18 }, { freq: 988, type: 'square', dur: 0.18 }],
    };
    const steps = presets[tone] || presets.suave;
    let t = now;
    for (const s of steps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = s.type;
      osc.frequency.value = s.freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + s.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + s.dur);
      t += s.dur + 0.08;
    }
    setTimeout(() => ctx.close(), (t - now) * 1000 + 200);
  } catch {
    /* AudioContext no disponible */
  }
}

function playReminderSound() {
  const u = pb.authStore.record as RecordModel | null;
  if (u?.sonido) {
    try {
      const url = pb.files.getURL(u, u.sonido);
      const a = new Audio(url);
      a.play().catch(() => playTone(u?.tono || 'suave'));
      return;
    } catch {
      /* fallback to tone */
    }
  }
  playTone(u?.tono || 'suave');
}

const sections = [
  { name: 'Inicio', icon: LayoutDashboard },
  { name: 'Medicamentos', icon: Pill },
  { name: 'Historial e informes', icon: ChartNoAxesCombined },
  { name: 'Configuración', icon: Settings },
];

export function CareDashboard({ data, loading = false }: { data: CareData; loading?: boolean }) {
  const firedToday = useRef(new Set<string>());
  const snoozed = useRef(new Map<string, number>());
  const { user, isAuthed, isLoading, logout } = useAuth();
  const revalidator = useRevalidator();
  const [tab, setTab] = useState('Inicio');
  const [modal, setModal] = useState<'auth' | 'med' | null>(null);
  const [editing, setEditing] = useState<RecordModel>();
  const [now, setNow] = useState<Date | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('medialerta-theme') : null;
    if (saved === 'dark') {
      setDark(true);
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(timer);
  }, []);

  // Reminder engine: 10-min-before heads-up + dose-time alert, with snooze.
  useEffect(() => {
    if (!now || !isAuthed || reminder) return;
    const todayKey = dayKey(now);
    const nowMs = now.getTime();
    let fired = false;
    for (const s of data.schedules) {
      if (fired) break;
      const med = data.meds.find((m) => m.id === s.medicamento);
      if (med?.fecha_inicio && todayKey < String(med.fecha_inicio).slice(0, 10)) continue;
      if (med?.fecha_fin && todayKey > String(med.fecha_fin).slice(0, 10)) continue;
      if (!dueToday(s.unidad, Number(s.intervalo) || 1, String(med?.fecha_inicio || ''), now)) continue;
      const [hh, mm] = s.hora.split(':').map(Number);
      const doseTime = new Date(now);
      doseTime.setHours(hh, mm, 0, 0);
      const doseMs = doseTime.getTime();
      const previaMs = doseMs - 10 * 60000;
      const taken = data.history.some((h) => h.horario === s.id && h.fecha === todayKey && h.estado === 'Tomada');
      if (taken) continue;
      for (const type of ['previa', 'toma'] as const) {
        if (fired) break;
        const key = `${s.id}:${todayKey}:${type}`;
        if (firedToday.current.has(key)) continue;
        if (type === 'previa' && nowMs >= doseMs) {
          firedToday.current.add(key);
          continue;
        }
        const base = type === 'previa' ? previaMs : doseMs;
        const fireAt = snoozed.current.get(key) ?? base;
        if (nowMs >= fireAt) {
          fired = true;
          setReminder({ schedule: s, med, type });
          playReminderSound();
          if (user?.alertas && 'Notification' in window && Notification.permission === 'granted') {
            try {
              const n = new Notification(
                'Medialerta · ' + (type === 'previa' ? 'Toma en 10 minutos' : 'Es hora de tu medicamento'),
                { body: `${med?.nombre || 'Medicamento'} · ${s.hora}`, tag: s.id + type },
              );
              setTimeout(() => n.close(), 30000);
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  }, [now, reminder, data, user, isAuthed]);

  const today = now ? dayKey(now) : '';
  const schedule = now
    ? data.schedules.filter((s) => {
        const med = data.meds.find((m) => m.id === s.medicamento);
        if (!dueToday(s.unidad, Number(s.intervalo) || 1, String(med?.fecha_inicio || ''), now)) return false;
        if (med?.fecha_inicio && today < String(med.fecha_inicio).slice(0, 10)) return false;
        if (med?.fecha_fin && today > String(med.fecha_fin).slice(0, 10)) return false;
        return true;
      })
    : [];
  const taken = data.history.filter((h) => h.fecha === today && h.estado === 'Tomada').length;
  const percent = schedule.length ? Math.round((taken / schedule.length) * 100) : 0;

  const refresh = () => {
    setModal(null);
    void revalidator.revalidate();
  };
  const add = () => {
    setEditing(undefined);
    setModal(isAuthed ? 'med' : 'auth');
  };

  if (!isLoading && !isAuthed) {
    return <LoginScreen done={refresh} />;
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
      void revalidator.revalidate();
    } catch {
      setMessage('No se pudo completar la acción. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  function toggleDark() {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
      localStorage.setItem('medialerta-theme', next ? 'dark' : 'light');
      return next;
    });
  }

  function handleConfirmReminder() {
    if (!reminder || !now) return;
    const key = `${reminder.schedule.id}:${dayKey(now)}:${reminder.type}`;
    firedToday.current.add(key);
    snoozed.current.delete(key);
    if (reminder.type === 'toma') {
      void run(() =>
        pb.collection('Historial_Tomas').create({
          owner: user?.id,
          horario: reminder.schedule.id,
          fecha: dayKey(now),
          estado: 'Tomada',
        }),
      );
    }
    setReminder(null);
  }

  function handleSnoozeReminder() {
    if (!reminder || !now) return;
    const key = `${reminder.schedule.id}:${dayKey(now)}:${reminder.type}`;
    snoozed.current.set(key, Date.now() + 5 * 60000);
    setReminder(null);
  }

  function exportReport() {
    const rows = [
      ['Fecha', 'Medicamento', 'Hora', 'Estado'],
      ...data.history.map((h) => {
        const s = data.schedules.find((x) => x.id === h.horario);
        return [h.fecha, data.meds.find((m) => m.id === s?.medicamento)?.nombre ?? '', s?.hora ?? '', h.estado];
      }),
    ];
    const csv = rows.map((r) => r.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cuida-historial.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/"><span className="brand-icon"><HeartPulse size={25} /></span>Medialerta</a>
        <div className="workspace-label">TU ESPACIO DE BIENESTAR</div>
        <nav>
          {sections.map(({ name, icon: Icon }) => (
            <button key={name} className={tab === name ? 'nav-item active' : 'nav-item'} onClick={() => { setTab(name); setMessage(''); }}>
              <Icon size={20} />{name}{tab === name && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy"><ShieldCheck size={23} /><strong>Tu salud es personal.</strong><p>Tus datos están seguros y solo tú puedes acceder a ellos.</p></div>
          <button className="help-link" onClick={() => setMessage('Cuida organiza tu tratamiento, pero no sustituye el consejo médico. Sigue siempre la pauta de tu profesional de salud.')}><CircleHelp size={18} />Ayuda y orientación</button>
          <div className="sidebar-sign">Hecho para cuidarte <Leaf size={14} /></div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">Mi cuidado <ChevronRight size={15} /><strong>{tab}</strong></div>
          <div className="top-actions">
            <span className="safe"><span />Espacio seguro</span>
            <button className="icon-button" aria-label="Cambiar modo oscuro" onClick={toggleDark}>{dark ? <Sun size={20} /> : <Moon size={20} />}</button>
            <button className="icon-button" aria-label="Configurar notificaciones" onClick={() => setTab('Configuración')}><Bell size={20} /></button>
            <button className="user-button" onClick={() => (isAuthed ? setTab('Configuración') : setModal('auth'))}>
              <span className="avatar">{user?.name?.slice(0, 1).toUpperCase() || 'T'}</span>
              <span>{isAuthed ? user?.name || 'Mi perfil' : 'Mi cuenta'}<small>{isAuthed ? (user?.tipo === 'cuidador' ? 'Cuidador/a' : 'Paciente') : 'Iniciar sesión'}</small></span>
            </button>
          </div>
        </header>

        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">CADA PEQUEÑO PASO CUENTA</div>
              <h1>{tab === 'Inicio' ? `Hola${user?.name ? ', ' + user.name.split(' ')[0] : ''}. Cuidarte empieza hoy.` : tab}</h1>
              <p>{tab === 'Inicio' ? 'Un lugar tranquilo para llevar tu tratamiento, día a día.' : 'Tu tratamiento organizado, a tu manera.'}</p>
            </div>
          </div>

          {message && <div className="notice" role="status">{message}<button aria-label="Cerrar aviso" onClick={() => setMessage('')}>×</button></div>}
          {(loading || isLoading || revalidator.state === 'loading') && <div className="loading-line" role="status">Actualizando tu espacio…</div>}

          {tab === 'Inicio' && (
            <>
              <section className="welcome-banner">
                <div>
                  <span className="banner-label"><span />TU BIENESTAR, PASO A PASO</span>
                  <h2>Un día más, un paso<br />más hacia tu bienestar.</h2>
                  <p>Nos ocupamos de los recordatorios.<br />Tú concéntrate en sentirte bien.</p>
                  <button onClick={() => setTab('Medicamentos')}>Ver mi tratamiento <ArrowUpRight size={17} /></button>
                </div>
                <div className="wellness-art" aria-hidden="true">
                  <div className="art-ring ring-one" /><div className="art-ring ring-two" /><div className="art-plus">+</div>
                  <div className="art-pill"><div /></div>
                  <span className="art-leaf"><Leaf size={32} /></span>
                  <span className="art-small-pill" />
                </div>
              </section>

              <div className="stats-strip">
                <div><span className="stat-icon"><Pill /></span><div><small>Medicamentos activos</small><strong>{data.meds.length}<span>en tu tratamiento</span></strong></div></div>
                <div><span className="stat-icon"><Check /></span><div><small>Tomas de hoy</small><strong>{taken}<span>de {schedule.length} programadas</span></strong></div></div>
                <div><span className="stat-icon"><ChartNoAxesCombined /></span><div><small>Cumplimiento de hoy</small><strong>{percent}%<span>{taken ? 'Vas por buen camino' : 'Cada toma cuenta'}</span></strong></div></div>
              </div>

              <div className="overview-grid">
                <TodaySchedule
                  data={data}
                  schedules={schedule}
                  today={today}
                  busy={busy}
                  confirm={(s, status) => run(() => pb.collection('Historial_Tomas').create({ owner: user?.id, horario: s.id, fecha: today, estado: status }))}
                  add={add}
                />
                <aside className="daily-aside">
                  <div className="progress-panel">
                    <div className="section-top"><h3>Tu progreso diario</h3><Leaf size={19} /></div>
                    <div className="progress-circle" style={{ background: `conic-gradient(var(--turquoise) ${percent}%, var(--soft) 0)` }}>
                      <div><strong>{taken}<span>/{schedule.length}</span></strong><small>tomas completadas</small></div>
                    </div>
                    <h4>{schedule.length ? 'A tu ritmo, pero sin olvidar.' : 'Todo empieza con un paso.'}</h4>
                    <p>{schedule.length ? 'Cada dosis es una forma de cuidarte.' : 'Añade tu primer medicamento y construye tu rutina de cuidado.'}</p>
                    <div className="progress-bottom"><span className="dot" /> {taken} tomadas <span className="gray-dot" /> {Math.max(0, schedule.length - taken)} pendientes</div>
                  </div>
                  <div className="tip">
                    <span className="tip-label"><HeartPulse size={18} />UN RECORDATORIO AMABLE</span>
                    <p>Una rutina sencilla hace la diferencia. Vincula tus tomas a un hábito de cada día.</p>
                    <small>Tu salud merece un momento.</small>
                  </div>
                </aside>
              </div>
            </>
          )}

          {tab === 'Medicamentos' && (
            <section className="panel">
              <div className="section-top"><h2>Tu tratamiento</h2><div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><span>{data.meds.length} medicamentos</span><button className="primary" onClick={add}><Plus size={19} />Añadir medicamento</button></div></div>
              {!data.meds.length ? (
                <div className="empty"><Pill size={40} /><h3>Tu tratamiento comienza aquí</h3><p>Añade los medicamentos indicados por tu profesional de salud.</p><button className="primary" onClick={add}>Añadir el primero</button></div>
              ) : (
                data.meds.map((m) => (
                  <div className="med-row" key={m.id}>
                    <span className="med-icon"><Pill /></span>
                    <div className="grow">
                      <h3>{m.nombre}</h3>
                      <p>{m.dosis}</p>
                      <small>{[m.forma_farmaceutica, m.notas].filter(Boolean).join(' · ') || 'Sin indicaciones adicionales'}</small>
                      {(m.fecha_inicio || m.fecha_fin) && <small className="med-range">Tratamiento: {m.fecha_inicio ? String(m.fecha_inicio).slice(0, 10) : '—'} → {m.fecha_fin ? String(m.fecha_fin).slice(0, 10) : 'indefinido'}</small>}
                    </div>
                    <button className="secondary" onClick={() => { setEditing(m); setModal('med'); }}>Editar</button>
                    <button className="text-button" disabled={busy} onClick={() => { if (confirm('¿Eliminar este medicamento? También se eliminarán sus horarios e historial.')) void run(() => pb.collection('Medicamentos').delete(m.id)); }}>Eliminar</button>
                  </div>
                ))
              )}
            </section>
          )}

          {tab === 'Historial e informes' && (
            <section className="panel">
              <div className="section-top"><h2>Historial de cumplimiento</h2><button className="secondary" disabled={!data.history.length} onClick={exportReport}><Download size={17} />Exportar CSV</button></div>
              <p className="muted">{data.history.filter((h) => h.estado === 'Tomada').length} tomas confirmadas de {data.history.length} registradas.</p>
              {!data.history.length ? (
                <div className="empty"><ChartNoAxesCombined size={40} /><h3>Cada toma cuenta una historia</h3><p>Cuando confirmes una toma, aparecerá aquí.</p></div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Fecha</th><th>Medicamento</th><th>Hora</th><th>Estado</th></tr></thead>
                    <tbody>
                      {data.history.map((h) => {
                        const s = data.schedules.find((x) => x.id === h.horario);
                        return <tr key={h.id}><td>{h.fecha}</td><td>{data.meds.find((m) => m.id === s?.medicamento)?.nombre}</td><td>{s?.hora}</td><td><span className="status">{h.estado}</span></td></tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === 'Configuración' && (
            <section className="panel settings-panel">
              <h2>Tu perfil, a tu manera</h2>
              {!isAuthed ? (
                <div className="empty"><ShieldCheck size={40} /><h3>Un espacio solo para ti</h3><p>Inicia sesión o crea una cuenta para personalizar tu perfil.</p><button className="primary" onClick={() => setModal('auth')}>Acceder a mi cuenta</button></div>
              ) : (
                <>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(() => pb.collection('users').update(user!.id, { name: f.get('name'), tipo: f.get('tipo') }).then((r) => { pb.authStore.save(pb.authStore.token, r); setMessage('Perfil guardado.'); }));
                  }}>
                    <label>Nombre<input name="name" defaultValue={user?.name} required maxLength={255} /></label>
                    <label>Correo electrónico<input value={user?.email} disabled /></label>
                    <input type="hidden" name="tipo" value="paciente" />
                    <button className="primary" disabled={busy}>Guardar perfil</button>
                  </form>

                  <div className="alert-settings">
                    {dark ? <Sun /> : <Moon />}
                    <div>
                      <h3>Modo oscuro</h3>
                      <p>Cambia la apariencia de la app a un tema oscuro, más descansado para la vista.</p>
                      <button className="secondary" disabled={busy} onClick={toggleDark}>{dark ? 'Activar modo claro' : 'Activar modo oscuro'}</button>
                    </div>
                  </div>

                  <div className="alert-settings">
                    <Bell />
                    <div>
                      <h3>Recordatorios del navegador</h3>
                      <p>Activa las notificaciones del navegador para recibir un aviso adicional además del recordatorio en pantalla.</p>
                      <button className="secondary" disabled={busy} onClick={async () => {
                        if (!('Notification' in window)) { setMessage('Este navegador no admite notificaciones.'); return; }
                        if (user?.alertas) { void run(() => pb.collection('users').update(user!.id, { alertas: false }).then((r) => pb.authStore.save(pb.authStore.token, r))); return; }
                        const permission = await Notification.requestPermission();
                        if (permission === 'granted') void run(() => pb.collection('users').update(user!.id, { alertas: true }).then((r) => pb.authStore.save(pb.authStore.token, r)));
                        else setMessage('Permite las notificaciones en los ajustes del navegador para recibir alertas.');
                      }}>{user?.alertas ? 'Desactivar alertas' : 'Activar alertas'}</button>
                    </div>
                  </div>

                  <div className="alert-settings">
                    <Volume2 />
                    <div>
                      <h3>Sonido de notificación</h3>
                      <p>Elige un tono predeterminado o sube tu propio sonido para los recordatorios.</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
                        <label>Tono predeterminado
                          <select name="tono" defaultValue={user?.tono || 'suave'} onChange={(e) => { const v = e.target.value; void run(() => pb.collection('users').update(user!.id, { tono: v }).then((r) => pb.authStore.save(pb.authStore.token, r))); }}>
                            <option value="suave">Suave</option><option value="campana">Campana</option><option value="notificacion">Notificación</option><option value="alarma">Alarma</option>
                          </select>
                        </label>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button type="button" className="secondary" onClick={() => playTone(user?.tono || 'suave')}><Play size={16} />Escuchar tono</button>
                        </div>
                        <label>Tu propio sonido<input type="file" accept="audio/*" disabled={busy} onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.append('sonido', file); void run(() => pb.collection('users').update(user!.id, fd).then((r) => pb.authStore.save(pb.authStore.token, r))); }} /></label>
                        {user?.sonido && (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="status"><Music size={14} />Sonido personalizado</span>
                            <button type="button" className="text-button" onClick={() => { const url = pb.files.getURL(user, user.sonido); const a = new Audio(url); void a.play(); }}><Play size={14} />Reproducir</button>
                            <button type="button" className="text-button" disabled={busy} onClick={() => void run(() => pb.collection('users').update(user!.id, { sonido: null }).then((r) => pb.authStore.save(pb.authStore.token, r)))}>Quitar</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <button className="text-button logout" onClick={() => { logout(); void revalidator.revalidate(); setTab('Inicio'); }}><LogOut size={18} />Cerrar sesión</button>
                </>
              )}
            </section>
          )}

          <footer>
            <span><HeartPulse size={15} /> Cuida · Tu salud, a tu ritmo.</span>
            <span>Organiza tu cuidado. Sigue siempre tu prescripción médica.</span>
            <span>© 2026 Medialerta</span>
          </footer>
        </main>
      </div>

      {reminder && (
        <ReminderModal reminder={reminder} onConfirm={handleConfirmReminder} onSnooze={handleSnoozeReminder} />
      )}

      <Dialog open={modal !== null} onOpenChange={(open) => { if (!open) setModal(null); }}>
        <DialogContent className="care-dialog" aria-describedby="modal-description">
          <DialogTitle className="sr-only">{modal === 'auth' ? 'Acceso a Cuida' : 'Gestionar medicamento'}</DialogTitle>
          <DialogDescription id="modal-description" className="sr-only">Completa los datos para continuar.</DialogDescription>
          {modal === 'auth' ? <AuthPanel done={refresh} /> : <TreatmentForm key={editing?.id || 'new'} med={editing} done={refresh} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
