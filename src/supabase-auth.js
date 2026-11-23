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
  if (env.SUPABASE_SECRET_KEY && !/^sb_secret_[\w-]+$/.test(env.SUPABASE_SECRET_KEY)) {
    throw new Error('SUPABASE_SECRET_KEY debe ser una clave secreta de Supabase, disponible solo en el servidor.');
  }
  return { url: url.origin, key: env.SUPABASE_PUBLISHABLE_KEY,
    adminKey: env.SUPABASE_SECRET_KEY || null,
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

function validatePassword(next, current) {
  if (typeof next !== 'string' || [...next].length < 6 || Buffer.byteLength(next) > 72 || (current !== undefined && next === current)) {
    throw Object.assign(new Error(current !== undefined
      ? 'Elige otra contraseña de al menos 6 caracteres y hasta 72 bytes. No se exige combinar letras, números ni símbolos.'
      : 'La contraseña debe tener al menos 6 caracteres y hasta 72 bytes. No se exige combinar letras, números ni símbolos.'), { status: 400 });
  }
}

function isPosAccount(user) {
  return typeof user?.id === 'string' && user.app_metadata?.acceso_pos === true && !user.is_anonymous &&
    typeof user.email === 'string' && accountEmail(user.email.split('@')[0]) === user.email;
}

function presentPosUser(user, currentUserId) {
  const username = user.email.split('@')[0].toLowerCase();
  const rawName = typeof user.user_metadata?.nombre_visible === 'string'
    ? user.user_metadata.nombre_visible.trim()
    : '';
  return {
    id: user.id,
    username,
    displayName: rawName,
    role: user.app_metadata?.rol === 'cajero' ? 'cajero' : 'dueno',
    active: !(Date.parse(user.banned_until) > Date.now()),
    createdAt: typeof user.created_at === 'string' ? user.created_at : null,
    lastSignInAt: typeof user.last_sign_in_at === 'string' ? user.last_sign_in_at : null,
    isSelf: user.id === currentUserId,
  };
}

function sortPosUsers(users) {
  return [...users].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.role !== b.role) return a.role === 'dueno' ? -1 : 1;
    return a.username.localeCompare(b.username, 'es');
  });
}

async function fetchAllPosUsers(auth) {
  if (!auth.adminKey) {
    throw Object.assign(new Error('La administración de usuarios requiere configurar SUPABASE_SECRET_KEY en el servidor.'), { status: 503 });
  }
  const adminAuth = { ...auth, key: auth.adminKey };
  const collected = [];
  for (let page = 1; page <= 5; page += 1) {
    const response = await authRequest(adminAuth, `admin/users?page=${page}&per_page=200`, { method: 'GET' });
    if (!response) throw serviceError();
    const batch = Array.isArray(response) ? response : Array.isArray(response.users) ? response.users : null;
    if (!batch) throw serviceError();
    collected.push(...batch.filter(isPosAccount));
    if (batch.length < 200) break;
  }
  return collected;
}

const rememberedSeconds = 365 * 86400;
// The upstream tokens are opaque. Bind them and the deadline to this host.
// Only a successful server-side validation can renew a remembered session.
export function accountSession(hosting, request) {
  const { auth } = hosting;
  const scope = hosting.origin || new URL(request.url).origin;
  const name = hosting.origin ? '__Host-felix-session' : 'felix-session';
  const attrs = '; Path=/; HttpOnly; SameSite=Lax' + (hosting.origin ? '; Secure' : '');
  const now = () => Math.floor(Date.now() / 1000);
  const context = Buffer.from('felix-auth-v2\0' + auth.url + '\0' + scope);
  const raw = (request.headers.get('cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith(name + '='));
  let session, cookie, user;
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
  // Only explicit logout/account changes expire the browser cookie. An automatic
  // rejection may arrive after another Worker has already issued a newer ticket.
  // It must still deny this request, without deleting that unrelated credential.
  const clear = (expire = true) => { if (expire) cookie = name + '=' + attrs + '; Max-Age=0'; session = null; user = null; };
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
  async function refresh() {
    const refreshed = await authRequest(auth, 'token?grant_type=refresh_token', { body: { refresh_token: session.refresh } });
    if (!permitted(refreshed?.user) || refreshed.user.id !== session.id) { clear(false); return false; }
    save(refreshed, session.remember ? now() + rememberedSeconds : session.deadline, session.remember);
    user = refreshed.user;
    return true;
  }
  return {
    get cookie() { return cookie; },
    get user() { return user; },
    async signIn(username, password, remember, newPassword) {
      const email = accountEmail(username);
      if (!email || typeof password !== 'string' || !password || password.length > 2000) return false;
      const credentials = await authRequest(auth, 'token?grant_type=password', { body: { email, password } });
      if (!permitted(credentials?.user) || credentials.user.email !== email) return false;
      if (newPassword !== undefined) {
        validatePassword(newPassword, password);
        const updated = await authRequest(auth, 'user', { method: 'PUT', token: credentials.access_token, body: { password: newPassword } });
        if (!updated) throw Object.assign(new Error('Supabase rechazó la nueva contraseña. Elige otra y vuelve a intentar.'), { status: 400 });
      }
      save(credentials, now() + (remember ? rememberedSeconds : 8 * 3600), remember);
      return true;
    },
    async authorized() {
      if (!session || session.deadline <= now()) return false;
      if (session.expires <= now() + 30) return refresh();
      user = await authRequest(auth, 'user', { method: 'GET', token: session.access });
      if (!user) return refresh();
      if (!permitted(user) || user.id !== session.id) { clear(false); return false; }
      if (session.remember && session.deadline - now() < 30 * 86400) {
        save({ user, access_token: session.access, refresh_token: session.refresh, expires_in: session.expires - now() },
          now() + rememberedSeconds, true);
      }
      return true;
    },
    async update(body) {
      if (!session || !permitted(user) || user.id !== session.id) {
        throw Object.assign(new Error('Inicia sesión para cambiar tu cuenta.'), { status: 401 });
      }
      const invalid = message => Object.assign(new Error(message), { status: 400 });
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => !['currentPassword', 'newUsername', 'newPassword'].includes(key))) {
        throw invalid('La solicitud de cambio de cuenta no es válida.');
      }
      const { currentPassword, newPassword, newUsername } = body;
      if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 2000) throw invalid('Indica tu contraseña actual.');
      const email = newUsername === undefined ? user.email : accountEmail(newUsername);
      if (!email) throw invalid('Usa entre 2 y 40 letras sin tildes, números, puntos, guiones o guiones bajos para el usuario.');
      if (newPassword !== undefined) validatePassword(newPassword, currentPassword);
      const rename = email !== user.email;
      if (!rename && newPassword === undefined) throw invalid('Indica un usuario o una contraseña diferente.');
      if (rename && !auth.adminKey) throw Object.assign(new Error('El cambio de usuario no está habilitado en este servidor. Puedes cambiar tu contraseña.'), { status: 503 });
      const credentials = await authRequest(auth, 'token?grant_type=password', { body: { email: user.email, password: currentPassword } });
      if (!permitted(credentials?.user) || credentials.user.id !== session.id || credentials.user.email !== user.email) {
        throw Object.assign(new Error('La contraseña actual no es correcta o tu cuenta cambió. Vuelve a iniciar sesión si el problema continúa.'), { status: 403 });
      }
      try {
        // Synthetic addresses cannot receive confirmation email. This server-only
        // call is scoped to the reauthenticated UUID, never to a client-supplied ID.
        const updated = rename
          ? await authRequest({ ...auth, key: auth.adminKey }, 'admin/users/' + encodeURIComponent(user.id), {
            method: 'PUT', body: { email, email_confirm: true, ...(newPassword !== undefined && { password: newPassword }) },
          })
          : await authRequest(auth, 'user', { method: 'PUT', token: credentials.access_token, body: { password: newPassword } });
        if (!updated) throw invalid(rename ? 'No se pudo usar ese nombre de usuario. Puede estar ocupado; revisa los datos e inténtalo de nuevo.' :
          'Supabase rechazó la nueva contraseña. Elige otra y vuelve a intentar.');
        if (!permitted(updated) || updated.id !== session.id || updated.email !== email) throw serviceError();
        const previousAccess = session.access;
        clear();
        try { await authRequest(auth, 'logout?scope=local', { token: previousAccess }); } catch { /* Cookie is already cleared. */ }
      } catch (error) {
        if (error.status === 503) throw Object.assign(new Error('No se confirmó el cambio de cuenta. Inicia sesión y comprueba tus datos antes de reintentar.'), { status: 503 });
        throw error;
      } finally {
        try { await authRequest(auth, 'logout?scope=local', { token: credentials.access_token }); } catch { /* Never retain the reauthentication session. */ }
      }
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
    async listUsers() {
      if (!session || !permitted(user) || user.id !== session.id) {
        throw Object.assign(new Error('Inicia sesión para administrar usuarios.'), { status: 401 });
      }
      const rawUsers = await fetchAllPosUsers(auth);
      return sortPosUsers(rawUsers.map(item => presentPosUser(item, user.id)));
    },
    async createUser(body) {
      if (!session || !permitted(user) || user.id !== session.id) {
        throw Object.assign(new Error('Inicia sesión para administrar usuarios.'), { status: 401 });
      }
      if (!auth.adminKey) {
        throw Object.assign(new Error('La administración de usuarios requiere configurar SUPABASE_SECRET_KEY en el servidor.'), { status: 503 });
      }
      const invalid = message => Object.assign(new Error(message), { status: 400 });
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => !['username', 'displayName', 'password', 'role'].includes(key))) {
        throw invalid('Los datos del nuevo usuario no son válidos.');
      }
      const email = accountEmail(body.username);
      if (!email) throw invalid('Usa entre 2 y 40 letras sin tildes, números, puntos, guiones o guiones bajos para el usuario.');
      const cleanUsername = email.split('@')[0];
      const displayName = body.displayName === undefined ? '' : typeof body.displayName === 'string' ? body.displayName.trim() : null;
      if (displayName === null || [...displayName].length > 80) throw invalid('El nombre visible debe tener hasta 80 caracteres.');
      validatePassword(body.password);
      if (body.role !== 'dueno' && body.role !== 'cajero') throw invalid('Elige un rol válido: Dueño o Cajero.');
      const created = await authRequest({ ...auth, key: auth.adminKey }, 'admin/users', {
        method: 'POST',
        body: {
          email,
          password: body.password,
          email_confirm: true,
          user_metadata: { nombre_usuario: cleanUsername, ...(displayName ? { nombre_visible: displayName } : {}) },
          app_metadata: { acceso_pos: true, rol: body.role },
        },
      });
      if (!created) throw invalid('No se pudo crear el usuario. Ese nombre puede estar ocupado.');
      if (!isPosAccount(created)) throw serviceError();
      return presentPosUser(created, user.id);
    },
    async updateUser(targetId, body) {
      if (!session || !permitted(user) || user.id !== session.id) {
        throw Object.assign(new Error('Inicia sesión para administrar usuarios.'), { status: 401 });
      }
      if (!auth.adminKey) {
        throw Object.assign(new Error('La administración de usuarios requiere configurar SUPABASE_SECRET_KEY en el servidor.'), { status: 503 });
      }
      const invalid = message => Object.assign(new Error(message), { status: 400 });
      if (typeof targetId !== 'string' || !targetId || targetId.length > 128 || /[/?#\\]/.test(targetId)) {
        throw invalid('Identificador de usuario inválido.');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => !['displayName', 'role', 'active', 'newPassword'].includes(key))) {
        throw invalid('La solicitud de actualización de usuario no es válida.');
      }
      const { displayName, role, active, newPassword } = body;
      if (displayName === undefined && role === undefined && active === undefined && newPassword === undefined) {
        throw invalid('Indica al menos un cambio para guardar.');
      }
      let cleanDisplayName;
      if (displayName !== undefined) {
        if (typeof displayName !== 'string' || [...displayName.trim()].length > 80) {
          throw invalid('El nombre visible debe tener hasta 80 caracteres.');
        }
        cleanDisplayName = displayName.trim();
      }
      if (role !== undefined && role !== 'dueno' && role !== 'cajero') {
        throw invalid('Elige un rol válido: Dueño o Cajero.');
      }
      if (active !== undefined && typeof active !== 'boolean') {
        throw invalid('El estado del usuario no es válido.');
      }
      if (newPassword !== undefined) validatePassword(newPassword);

      const rawUsers = await fetchAllPosUsers(auth);
      const rawTarget = rawUsers.find(item => item.id === targetId);
      if (!rawTarget) throw Object.assign(new Error('Usuario no encontrado.'), { status: 404 });
      const currentTarget = presentPosUser(rawTarget, user.id);

      if (currentTarget.isSelf && active === false) {
        throw invalid('No puedes desactivar tu propia cuenta.');
      }
      if (currentTarget.isSelf && role === 'cajero') {
        throw invalid('No puedes cambiar tu propio rol a cajero.');
      }
      const nextRole = role ?? currentTarget.role;
      const nextActive = active ?? currentTarget.active;
      if (currentTarget.role === 'dueno' && currentTarget.active && (nextRole !== 'dueno' || !nextActive)) {
        const otherActiveOwners = rawUsers.filter(item => {
          const mapped = presentPosUser(item, user.id);
          return mapped.id !== currentTarget.id && mapped.role === 'dueno' && mapped.active;
        });
        if (otherActiveOwners.length === 0) {
          throw invalid('Debe quedar al menos un dueño activo en el sistema.');
        }
      }

      const payload = {};
      if (cleanDisplayName !== undefined) {
        payload.user_metadata = {
          ...(rawTarget.user_metadata && typeof rawTarget.user_metadata === 'object' ? rawTarget.user_metadata : {}),
          nombre_usuario: currentTarget.username,
          nombre_visible: cleanDisplayName,
        };
      }
      if (role !== undefined) {
        payload.app_metadata = {
          ...(rawTarget.app_metadata && typeof rawTarget.app_metadata === 'object' ? rawTarget.app_metadata : {}),
          acceso_pos: true,
          rol: role,
        };
      }
      if (active !== undefined) {
        payload.ban_duration = active ? 'none' : '876000h';
      }
      if (newPassword !== undefined) {
        payload.password = newPassword;
      }

      const updated = await authRequest({ ...auth, key: auth.adminKey }, 'admin/users/' + encodeURIComponent(targetId), {
        method: 'PUT',
        body: payload,
      });
      if (!updated) throw invalid('No se pudo actualizar el usuario. Revisa los datos e inténtalo de nuevo.');
      if (!isPosAccount(updated)) throw serviceError();
      return presentPosUser(updated, user.id);
    },
  };
}
