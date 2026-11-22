import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest();

export function hostingConfig(env = process.env) {
  const publicOrigin = env.PUBLIC_ORIGIN;
  const host = env.HOST || (publicOrigin ? '0.0.0.0' : '127.0.0.1');
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!local && !publicOrigin) throw new Error('Configura PUBLIC_ORIGIN con tu dirección HTTPS antes de habilitar acceso externo.');
  const origin = publicOrigin ? new URL(publicOrigin) : null;
  if (origin && (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password)) {
    throw new Error('PUBLIC_ORIGIN debe ser una dirección HTTPS sin ruta, parámetros ni credenciales.');
  }
  if (!origin && !env.APP_PASSWORD) return { host, origin: null, credentialsHash: null };
  const username = env.APP_USERNAME || 'admin';
  if (!username.trim() || username.includes(':') || !env.APP_PASSWORD || env.APP_PASSWORD.length < 16) {
    throw new Error('Configura APP_USERNAME y una contraseña APP_PASSWORD de al menos 16 caracteres.');
  }
  return { host, origin: origin?.origin ?? null, credentialsHash: hash(`${username}:${env.APP_PASSWORD}`) };
}

export function validCredentials(username, password, hosting) {
  return !!hosting.credentialsHash && typeof username === 'string' && typeof password === 'string' &&
    !username.includes(':') && timingSafeEqual(hash(`${username}:${password}`), hosting.credentialsHash);
}

const cookieName = hosting => hosting.origin ? '__Host-felix-session' : 'felix-session';
const signature = (payload, hosting) => createHmac('sha256', hosting.credentialsHash)
  .update(`felix-session-v1\0${hosting.origin || 'loopback'}\0${payload}`).digest('base64url');
const cookieAttributes = hosting => `; Path=/; HttpOnly; SameSite=Strict${hosting.origin ? '; Secure' : ''}`;

export function sessionCookie(hosting, remember = true, now = Date.now()) {
  const seconds = remember ? 30 * 86400 : 8 * 3600;
  const payload = `v1.${Math.floor(now / 1000) + seconds}.${randomBytes(16).toString('base64url')}`;
  return `${cookieName(hosting)}=${payload}.${signature(payload, hosting)}${cookieAttributes(hosting)}${remember ? `; Max-Age=${seconds}` : ''}`;
}

export function clearSessionCookie(hosting) {
  return `${cookieName(hosting)}=${cookieAttributes(hosting)}; Max-Age=0`;
}

export function authorized(request, hosting, now = Date.now()) {
  if (!hosting.credentialsHash) return true;
  const cookies = request.headers.get('cookie') || '';
  const cookie = cookies.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName(hosting) + '='));
  if (!cookie) return false;
  const token = cookie.slice(cookie.indexOf('=') + 1);
  const match = /^(v1\.(\d{1,12})\.[A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match || Number(match[2]) <= Math.floor(now / 1000)) return false;
  return timingSafeEqual(Buffer.from(signature(match[1], hosting)), Buffer.from(match[3]));
}
