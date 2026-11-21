import { pocketbaseClient as pb } from '@/lib/pocketbase-client';
import type { RecordModel } from 'pocketbase';
export type CareData = { meds: RecordModel[]; schedules: RecordModel[]; history: RecordModel[] };
export async function loadCare(): Promise<CareData> { if (!pb.authStore.isValid) return {meds:[],schedules:[],history:[]}; const [meds,schedules,history] = await Promise.all([pb.collection('Medicamentos').getFullList({sort:'nombre'}),pb.collection('Horarios_Programados').getFullList({sort:'hora'}),pb.collection('Historial_Tomas').getFullList({sort:'-created'})]); return {meds,schedules,history}; }
export function dayKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }

/**
 * A schedule reads "tomar `veces` veces cada `intervalo` `unidad`".
 * - horas: varias tomas al día → siempre hay dosis hoy.
 * - días: cada `intervalo` días desde el inicio del tratamiento.
 * - semanas: cada `intervalo` semanas desde el inicio.
 * Sin fecha de inicio no podemos calcular el ciclo, así que se asume que toca hoy.
 */
export function dueToday(unidad: string, intervalo: number, inicio: string, date: Date) {
  if (unidad === 'horas') return true;
  if (!inicio) return true;
  const start = new Date(String(inicio).slice(0, 10) + 'T00:00:00');
  const today = new Date(dayKey(date) + 'T00:00:00');
  const diffDays = Math.floor((today.getTime() - start.getTime()) / 86400000);
  if (diffDays < 0) return false;
  const period = unidad === 'semanas' ? intervalo * 7 : intervalo;
  return diffDays % period === 0;
}
