import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function databaseConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('Configura DATABASE_URL en .env.local o .env.supabase. Consulta README.md.');
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL debe ser una conexión PostgreSQL.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const useSSL = env.DATABASE_SSL === 'true' || !local;
  // La configuración SSL de la URL sobreescribe el objeto ssl en pg.
  // Centralizarla aquí evita perder la validación del certificado o su CA.
  for (const option of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    if (!['ssl', 'sslmode'].includes(option) && url.searchParams.has(option)) {
      throw new Error('Usa DATABASE_CA_FILE para el certificado y retira los parámetros SSL de DATABASE_URL.');
    }
    url.searchParams.delete(option);
  }
  if (url.searchParams.size) throw new Error('Retira los parámetros de DATABASE_URL; configura el host, puerto y base en la URL principal.');
  return {
    connectionString: url.toString(), max: 5, connectionTimeoutMillis: 10000, query_timeout: 15000,
    ssl: useSSL ? {
      rejectUnauthorized: true,
      ...(env.DATABASE_CA_FILE ? { ca: readFileSync(resolve(env.DATABASE_CA_FILE), 'utf8') } : {}),
    } : false,
  };
}
