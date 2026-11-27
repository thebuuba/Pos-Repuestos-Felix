import { fail, id, text } from './operation-fields.js';
import { isOwner } from './roles.js';

const PRIORITIES = new Set(['baja', 'media', 'alta']);
const STATUSES = new Set(['pendiente', 'completado']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const ALLOWED_FIELDS = new Set([
  'databaseId', 'version',
  'titulo', 'nota', 'fechaLimite', 'horaLimite', 'prioridad', 'estado',
  'clienteId', 'suplidorId', 'productoId',
]);

function checkAllowedKeys(body) {
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) fail('Campo no admitido en el recordatorio.');
  }
}

function parseTitle(value) {
  const clean = text(value, 'el título');
  if (clean.length > 200) fail('El título no puede exceder 200 caracteres.');
  return clean;
}

function parseNote(value) {
  if (value === undefined || value === null) return '';
  return text(value, 'la nota', false);
}

function parseDueDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !ISO_DATE.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    fail('La fecha límite del recordatorio no es válida.');
  }
  return value;
}

function parseDueTime(value, dueDate) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !TIME_HHMM.test(value)) {
    fail('La hora límite debe tener el formato HH:MM.');
  }
  if (!dueDate) fail('Indica una fecha límite antes de agregar una hora.');
  return value;
}

function parsePriority(value, fallback = 'media') {
  if (value === undefined || value === null || value === '') return fallback;
  if (!PRIORITIES.has(value)) fail('La prioridad debe ser baja, media o alta.');
  return value;
}

function parseStatus(value, fallback = 'pendiente') {
  if (value === undefined || value === null || value === '') return fallback;
  if (!STATUSES.has(value)) fail('El estado debe ser pendiente o completado.');
  return value;
}

async function resolveOptionalLink(client, table, rawId, label) {
  if (rawId === undefined || rawId === null || rawId === '') return null;
  const targetId = id(rawId, label);
  const found = await client.query(`SELECT activo FROM public.${table} WHERE id=$1 FOR SHARE`, [targetId]);
  if (!found.rowCount || !found.rows[0].activo) {
    fail(`Selecciona ${label} activo válido.`);
  }
  return targetId;
}

function formatPgDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function presentReminder(row) {
  return {
    id: Number(row.id),
    version: Number(row.version),
    titulo: row.titulo,
    nota: row.nota ?? '',
    fechaLimite: formatPgDate(row.fecha_limite),
    horaLimite: row.hora_limite ?? '',
    prioridad: row.prioridad,
    estado: row.estado,
    clienteId: row.cliente_id == null ? null : Number(row.cliente_id),
    suplidorId: row.suplidor_id == null ? null : Number(row.suplidor_id),
    productoId: row.producto_id == null ? null : Number(row.producto_id),
    creadoPor: row.creado_por ?? '',
    completadoPor: row.completado_por ?? null,
    completadoEn: row.completado_en ? new Date(row.completado_en).toISOString() : null,
    creadoEn: row.creado_en ? new Date(row.creado_en).toISOString() : null,
    actualizadoEn: row.actualizado_en ? new Date(row.actualizado_en).toISOString() : null,
  };
}

export async function reminderOperation(client, method, target, body, actor, occurredAt) {
  checkAllowedKeys(body);
  const actorName = typeof actor?.name === 'string' && actor.name.trim() ? actor.name.trim().slice(0, 2000) : 'Usuario local';
  const at = occurredAt ?? null;

  if (method === 'DELETE') {
    const allowedDelete = new Set(['databaseId', 'version']);
    for (const key of Object.keys(body)) {
      if (!allowedDelete.has(key)) fail('Campo no admitido al eliminar el recordatorio.');
    }
    const ver = id(body.version, 'la versión');
    const updated = await client.query(
      `UPDATE public.recordatorios
       SET activo=false, version=version+1, actualizado_en=COALESCE($3::timestamptz, now())
       WHERE id=$1 AND version=$2 AND activo
       RETURNING id`,
      [target, ver, at],
    );
    if (!updated.rowCount) {
      const exists = (await client.query('SELECT activo FROM public.recordatorios WHERE id=$1', [target])).rows[0];
      if (!exists || !exists.activo) fail('El recordatorio ya no existe.', 404);
      fail('El recordatorio cambió en otro equipo. Actualiza antes de eliminar.', 409);
    }
    return { id: Number(updated.rows[0].id) };
  }

  if (method === 'POST') {
    if (body.version !== undefined) fail('No envíes versión al crear un recordatorio.');
    const titulo = parseTitle(body.titulo);
    const nota = parseNote(body.nota);
    const fechaLimite = parseDueDate(body.fechaLimite);
    const horaLimite = parseDueTime(body.horaLimite, fechaLimite);
    const prioridad = parsePriority(body.prioridad, 'media');
    const estado = parseStatus(body.estado, 'pendiente');
    const clienteId = await resolveOptionalLink(client, 'clientes', body.clienteId, 'un cliente');
    if (!isOwner(actor?.role) && body.suplidorId !== undefined && body.suplidorId !== null && body.suplidorId !== '') {
      fail('Tu cuenta de cajero no puede vincular recordatorios a suplidores.', 403);
    }
    const suplidorId = await resolveOptionalLink(client, 'suplidores', body.suplidorId, 'un suplidor');
    const productoId = await resolveOptionalLink(client, 'productos', body.productoId, 'un artículo');
    const completadoPor = estado === 'completado' ? actorName : null;
    const inserted = await client.query(
      `INSERT INTO public.recordatorios(
         titulo, nota, fecha_limite, hora_limite, prioridad, estado,
         cliente_id, suplidor_id, producto_id,
         creado_por, completado_por, completado_en, creado_en, actualizado_en
       )
       VALUES(
         $1, $2, $3::date, $4, $5, $6,
         $7, $8, $9,
         $10, $11,
         CASE WHEN $6 = 'completado' THEN COALESCE($12::timestamptz, now()) ELSE NULL END,
         COALESCE($12::timestamptz, now()),
         COALESCE($12::timestamptz, now())
       )
       RETURNING id`,
      [titulo, nota, fechaLimite, horaLimite, prioridad, estado, clienteId, suplidorId, productoId, actorName, completadoPor, at],
    );
    return { id: Number(inserted.rows[0].id) };
  }

  // PUT
  const ver = id(body.version, 'la versión');
  const existing = (await client.query(
    `SELECT id, version, titulo, nota, fecha_limite::text AS fecha_limite, hora_limite, prioridad, estado,
            cliente_id, suplidor_id, producto_id, creado_por, completado_por, completado_en, activo
     FROM public.recordatorios WHERE id=$1 FOR UPDATE`,
    [target],
  )).rows[0];
  if (!existing || !existing.activo) fail('El recordatorio ya no existe.', 404);
  if (Number(existing.version) !== ver) fail('El recordatorio cambió en otro equipo. Actualiza antes de guardar.', 409);

  const titulo = Object.hasOwn(body, 'titulo') ? parseTitle(body.titulo) : existing.titulo;
  const nota = Object.hasOwn(body, 'nota') ? parseNote(body.nota) : existing.nota;
  const fechaLimite = Object.hasOwn(body, 'fechaLimite')
    ? parseDueDate(body.fechaLimite)
    : formatPgDate(existing.fecha_limite);
  const horaLimite = Object.hasOwn(body, 'horaLimite')
    ? parseDueTime(body.horaLimite, fechaLimite)
    : (fechaLimite ? (existing.hora_limite ?? '') : '');
  const prioridad = Object.hasOwn(body, 'prioridad') ? parsePriority(body.prioridad, existing.prioridad) : existing.prioridad;
  const estado = Object.hasOwn(body, 'estado') ? parseStatus(body.estado, existing.estado) : existing.estado;
  const clienteId = Object.hasOwn(body, 'clienteId')
    ? await resolveOptionalLink(client, 'clientes', body.clienteId, 'un cliente')
    : (existing.cliente_id == null ? null : Number(existing.cliente_id));
  if (!isOwner(actor?.role) && Object.hasOwn(body, 'suplidorId')) {
    const nextSup = body.suplidorId === null || body.suplidorId === '' ? null : id(body.suplidorId, 'un suplidor');
    const prevSup = existing.suplidor_id == null ? null : Number(existing.suplidor_id);
    if (nextSup !== prevSup) fail('Tu cuenta de cajero no puede vincular recordatorios a suplidores.', 403);
  }
  const suplidorId = Object.hasOwn(body, 'suplidorId')
    ? await resolveOptionalLink(client, 'suplidores', body.suplidorId, 'un suplidor')
    : (existing.suplidor_id == null ? null : Number(existing.suplidor_id));
  const productoId = Object.hasOwn(body, 'productoId')
    ? await resolveOptionalLink(client, 'productos', body.productoId, 'un artículo')
    : (existing.producto_id == null ? null : Number(existing.producto_id));

  let completadoPor = existing.completado_por ?? null;
  let keepCompletedAt = false;
  if (estado === 'pendiente') {
    completadoPor = null;
  } else if (existing.estado !== 'completado') {
    completadoPor = actorName;
  } else {
    keepCompletedAt = true;
  }

  const updated = await client.query(
    `UPDATE public.recordatorios
     SET titulo=$3, nota=$4, fecha_limite=$5::date, hora_limite=$6, prioridad=$7, estado=$8,
         cliente_id=$9, suplidor_id=$10, producto_id=$11,
         completado_por=$12,
         completado_en=CASE
           WHEN $8 = 'pendiente' THEN NULL
           WHEN $13::boolean THEN completado_en
           ELSE COALESCE($14::timestamptz, now())
         END,
         version=version+1,
         actualizado_en=COALESCE($14::timestamptz, now())
     WHERE id=$1 AND version=$2 AND activo
     RETURNING id`,
    [target, ver, titulo, nota, fechaLimite, horaLimite, prioridad, estado, clienteId, suplidorId, productoId, completadoPor, keepCompletedAt, at],
  );
  if (!updated.rowCount) fail('El recordatorio cambió en otro equipo. Actualiza antes de guardar.', 409);
  return { id: Number(updated.rows[0].id) };
}
