import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function accountEmail(username) {
  if (typeof username !== 'string') return null;
  const name = username.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{1,39}$/.test(name) && !name.endsWith('.') && !name.includes('..')
    ? name + '@usuarios.repuestosfelix.invalid' : null;
}

export function authConfig(env) {
  let url;
  try { url = new URL(env.SUPABASE_URL); } catch { /* Report configuration below. */ }
  const local = url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!url || (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.href !== url.origin + '/' || !/^sb_publishable_[\w-]+$/.test(env.SUPABASE_PUBLISHABLE_KEY || '') ||
      (env.POS_SESSION_SECRET || '').length < 32) {
    throw new Error('Configura la URL de Supabase, su clave publicable y POS_SESSION_SECRET de al menos 32 caracteres.');
  }
  return { url: url.origin, key: env.SUPABASE_PUBLISHABLE_KEY,
    cookieKey: createHash('sha256').update(env.POS_SESSION_SECRET).digest(), fetch: fetch.bind(globalThis) };
}

function serviceError(status = 503) {
  return Object.assign(new Error(status === 429 ? 'Demasiados intentos. Espera un momento y vuelve a intentar.' :
    'No se pudo conectar con el servicio de usuarios. Inténtalo de nuevo.'), { status });
}

async function authRequest(auth, path, { method = 'POST', token, body } = {}) {
  let response;
  try {
    response = await auth.fetch(auth.url + '/auth/v1/' + path, {
      method, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(8000),
      headers: { apikey: auth.key, 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
      body: body && JSON.stringify(body),
    });
  } catch { throw serviceError(); }
  if (response.status >= 300 && response.status < 400) throw serviceError();
  if (response.status === 429) throw serviceError(429);
  if (response.status >= 500) throw serviceError();
  if (!response.ok) return null;
  if (path.startsWith('logout')) return true;
  try { return await response.json(); } catch { throw serviceError(); }
}

function permitted(user) {
  return typeof user?.id === 'string' && user.app_metadata?.acceso_pos === true && !user.is_anonymous &&
    typeof user.email === 'string' && accountEmail(user.email.split('@')[0]) === user.email &&
    !(Date.parse(user.banned_until) > Date.now());
}

// The upstream tokens are opaque. Bind them, the ID and the absolute session
// deadline to this host so the browser cannot extend or switch the session.
export function accountSession(hosting, request) {
  const { auth } = hosting;
  const scope = hosting.origin || new URL(request.url).origin;
  const name = hosting.origin ? '__Host-felix-session' : 'felix-session';
  const attrs = '; Path=/; HttpOnly; SameSite=Strict' + (hosting.origin ? '; Secure' : '');
  const now = () => Math.floor(Date.now() / 1000);
  const context = Buffer.from('felix-auth-v2\0' + auth.url + '\0' + scope);
  const raw = (request.headers.get('cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith(name + '='));
  let session, cookie;
  if (raw && raw.length < 4070) {
    try {
      const token = raw.slice(name.length + 1);
      const packed = Buffer.from(token, 'base64url');
      if (packed.length > 28 && packed.toString('base64url') === token) {
        const decipher = createDecipheriv('aes-256-gcm', auth.cookieKey, packed.subarray(0, 12));
        decipher.setAAD(context);
        decipher.setAuthTag(packed.subarray(12, 28));
        session = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString());
      }
    } catch { /* A modified ticket or a different origin cannot open this cookie. */ }
  }
  const clear = () => { cookie = name + '=' + attrs + '; Max-Age=0'; session = null; };
  function save(tokens, deadline, remember) {
    if (!tokens?.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw serviceError();
    session = { id: tokens.user.id, access: tokens.access_token, refresh: tokens.refresh_token,
      expires: now() + tokens.expires_in, deadline, remember };
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', auth.cookieKey, iv);
    cipher.setAAD(context);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
    const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    const value = name + '=' + token + attrs + (remember ? '; Max-Age=' + Math.max(0, deadline - now()) : '');
    if (Buffer.byteLength(value) > 4000) throw serviceError();
    cookie = value;
  }
  return {
    get cookie() { return cookie; },
    async signIn(username, password, remember, newPassword) {
      const email = accountEmail(username);
      if (!email || typeof password !== 'string' || !password || password.length > 2000) return false;
      const credentials = await authRequest(auth, 'token?grant_type=password', { body: { email, password } });
      if (!permitted(credentials?.user) || credentials.user.email !== email) return false;
      if (newPassword !== undefined) {
        if (typeof newPassword !== 'string' || newPassword.length < 12 || Buffer.byteLength(newPassword) > 72 || newPassword === password) {
          throw Object.assign(new Error('Elige otra contraseña de al menos 12 caracteres y hasta 72 bytes.'), { status: 400 });
        }
        const updated = await authRequest(auth, 'user', { method: 'PUT', token: credentials.access_token, body: { password: newPassword } });
        if (!updated) throw Object.assign(new Error('Supabase rechazó la nueva contraseña. Elige otra y vuelve a intentar.'), { status: 400 });
      }
      save(credentials, now() + (remember ? 30 * 86400 : 8 * 3600), remember);
      return true;
    },
    async authorized() {
      if (!session || session.deadline <= now()) return false;
      if (session.expires <= now() + 30) {
        const refreshed = await authRequest(auth, 'token?grant_type=refresh_token', { body: { refresh_token: session.refresh } });
        if (!permitted(refreshed?.user) || refreshed.user.id !== session.id) { clear(); return false; }
        save(refreshed, session.deadline, session.remember);
        return true;
      }
      const user = await authRequest(auth, 'user', { method: 'GET', token: session.access });
      if (!permitted(user) || user.id !== session.id) { clear(); return false; }
      return true;
    },
    async signOut() {
      try {
        if (!session || !await this.authorized()) return true;
        return !!await authRequest(auth, 'logout?scope=local', { token: session.access });
      } catch (error) {
        if (error.status !== 503 && error.status !== 429) throw error;
        return false;
      } finally { clear(); }
    },
  };
}
