import { createHash, timingSafeEqual } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest();

export function hostingConfig(env = process.env) {
  const host = env.HOST || (env.PUBLIC_ORIGIN ? '0.0.0.0' : '127.0.0.1');
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!local && !env.PUBLIC_ORIGIN) throw new Error('Configura PUBLIC_ORIGIN con tu dirección HTTPS antes de habilitar acceso externo.');
  if (!env.PUBLIC_ORIGIN) return { host, origin: null, credentialsHash: null };
  const origin = new URL(env.PUBLIC_ORIGIN);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error('PUBLIC_ORIGIN debe ser una dirección HTTPS sin ruta, parámetros ni credenciales.');
  }
  const username = env.APP_USERNAME || 'admin';
  if (!username.trim() || username.includes(':') || !env.APP_PASSWORD || env.APP_PASSWORD.length < 16) {
    throw new Error('Configura APP_USERNAME y una contraseña APP_PASSWORD de al menos 16 caracteres.');
  }
  return { host, origin: origin.origin, credentialsHash: hash(`${username}:${env.APP_PASSWORD}`) };
}

export function authorized(request, hosting) {
  if (!hosting.credentialsHash) return true;
  const basic = request.headers.authorization?.match(/^Basic (.+)$/i);
  if (!basic) return false;
  const credentials = Buffer.from(basic[1], 'base64').toString('utf8');
  return timingSafeEqual(hash(credentials), hosting.credentialsHash);
}
