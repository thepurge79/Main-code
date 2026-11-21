import { Pill, Clock3, Check, AlarmClock } from 'lucide-react';
import type { RecordModel } from 'pocketbase';

export type ReminderType = 'previa' | 'toma';

export interface Reminder {
  schedule: RecordModel;
  med?: RecordModel;
  type: ReminderType;
}

export function ReminderModal({
  reminder,
  onConfirm,
  onSnooze,
}: {
  reminder: Reminder;
  onConfirm: () => void;
  onSnooze: () => void;
}) {
  const { med, schedule, type } = reminder;
  const isPrevia = type === 'previa';
  return (
    <div className="reminder-overlay" role="alertdialog" aria-modal="true" aria-label="Recordatorio de medicamento">
      <div className="reminder-card">
        <div className="reminder-icon"><AlarmClock size={30} /></div>
        <span className="reminder-eyebrow">{isPrevia ? 'RECORDATORIO PREVIO' : 'ES LA HORA DE TU TOMA'}</span>
        <h2>{isPrevia ? 'Tu toma es en 10 minutos' : 'Es hora de tu medicamento'}</h2>
        <div className="reminder-med">
          <span className="med-icon"><Pill size={22} /></span>
          <div>
            <h3>{med?.nombre || 'Medicamento'}</h3>
            <p>{med?.dosis}</p>
            <small><Clock3 size={13} /> {schedule.hora}{med?.forma_farmaceutica ? ` · ${med.forma_farmaceutica}` : ''}{schedule.veces ? ` · ${schedule.veces} vez/veces cada ${schedule.intervalo} ${schedule.unidad}` : ''}</small>
          </div>
        </div>
        <div className="reminder-actions">
          <button className="primary" onClick={onConfirm}><Check size={17} />{isPrevia ? 'Entendido' : 'Confirmar toma'}</button>
          <button className="secondary" onClick={onSnooze}><Clock3 size={17} />Posponer 5 min</button>
        </div>
        <p className="reminder-foot">Tu salud, a tu ritmo.</p>
      </div>
    </div>
  );
}
