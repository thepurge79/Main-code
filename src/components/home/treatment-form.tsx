import { useState } from 'react';
import { pocketbaseClient as pb } from '@/lib/pocketbase-client';
import type { RecordModel } from 'pocketbase';

const MG_VALUES = ['25 mg', '50 mg', '100 mg', '150 mg', '200 mg', '250 mg', '300 mg', '400 mg', '500 mg', '600 mg', '750 mg', '800 mg', '1000 mg'];

export function TreatmentForm({ med, done }: { med?: RecordModel; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <span className="eyebrow">UN PASO PARA TU BIENESTAR</span>
      <h2>{med ? 'Editar medicamento' : 'Nuevo medicamento'}</h2>
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const f = new FormData(e.currentTarget);
        const owner = pb.authStore.record?.id;
        try {
          const values = {
            owner,
            nombre: f.get('nombre'),
            dosis: f.get('dosis'),
            notas: f.get('notas'),
            forma_farmaceutica: f.get('forma_farmaceutica'),
            fecha_inicio: f.get('fecha_inicio') || null,
            fecha_fin: f.get('fecha_fin') || null,
          };
          if (med) {
            await pb.collection('Medicamentos').update(med.id, values);
          } else {
            const created = await pb.collection('Medicamentos').create(values);
            try {
              await pb.collection('Horarios_Programados').create({
                owner,
                medicamento: created.id,
                hora: f.get('hora'),
                veces: Number(f.get('veces')),
                intervalo: Number(f.get('intervalo')),
                unidad: f.get('unidad'),
                alerta: true,
              });
            } catch (err) {
              await pb.collection('Medicamentos').delete(created.id);
              throw err;
            }
          }
          done();
        } catch {
          setError('No se pudo guardar. Revisa la programación de horario (formato de reloj) y la frecuencia, e inténtalo de nuevo.');
        } finally {
          setBusy(false);
        }
      }}>
        <label>Nombre del medicamento<input name="nombre" defaultValue={med?.nombre} required placeholder="Ej. Vitamina D" maxLength={100} /></label>
        <div className="form-row">
          <label>Forma farmacéutica
            <select name="forma_farmaceutica" defaultValue={med?.forma_farmaceutica || 'Tableta'}>
              <option>Tableta</option><option>Inyección</option><option>Jarabe</option><option>Cápsula</option><option>Otro</option>
            </select>
          </label>
          <label>Dosis por toma (mg)
            <select name="dosis" defaultValue={med?.dosis || '500 mg'} required>
              {MG_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>
        {!med && (
          <>
            <label>Programación de horario<input name="hora" type="time" required defaultValue="08:00" /></label>
            <small>Elige la hora de la primera toma en formato de reloj.</small>
            <div className="form-row">
              <label>Cantidad de veces<input name="veces" type="number" min="1" step="1" required defaultValue="1" /></label>
              <label>Duración del intervalo<input name="intervalo" type="number" min="1" step="1" required defaultValue="1" /></label>
              <label>Unidad
                <select name="unidad" defaultValue="días">
                  <option value="horas">horas</option><option value="días">días</option><option value="semanas">semanas</option>
                </select>
              </label>
            </div>
            <small>Por ejemplo: 3 veces cada 8 horas, o 1 vez cada 1 día. Los valores no pueden ser menores a 1.</small>
          </>
        )}
        <div className="form-row">
          <label>Inicio del tratamiento<input name="fecha_inicio" type="date" defaultValue={med?.fecha_inicio?.slice(0, 10)} /></label>
          <label>Fin del tratamiento<input name="fecha_fin" type="date" defaultValue={med?.fecha_fin?.slice(0, 10)} /></label>
        </div>
        <small>Define durante qué días o fechas tomarás el medicamento. Si lo dejas vacío, será indefinido.</small>
        <label>Indicaciones<textarea name="notas" defaultValue={med?.notas} placeholder="Ej. Tomar después del desayuno" maxLength={200} /></label>
        {error && <p role="alert" className="form-message">{error}</p>}
        <button disabled={busy} className="primary wide">{busy ? 'Guardando…' : 'Guardar medicamento'}</button>
      </form>
    </>
  );
}
