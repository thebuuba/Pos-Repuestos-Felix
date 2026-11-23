import { useEffect, useRef, useState } from 'react';
import { Save, UserRound } from 'lucide-react';
import { SectionCard } from './section-card.jsx';
import { Field, inputClass } from './form-field.jsx';
import { Input } from '../../components/ui/input.jsx';
import { Button } from '../../components/ui/button.jsx';

// Account credentials go directly to Auth; never through the operation journal.
async function accountRequest(body, signal) {
  let response;
  try {
    response = await fetch('/api/account', { method: body ? 'PUT' : 'GET', credentials: 'same-origin', cache: 'no-store',
      signal: signal || AbortSignal.timeout(40000), headers: { 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(body ? 'No se pudo confirmar el cambio. Inicia sesión para comprobar tus datos antes de reintentar.' :
      'No se pudo cargar tu cuenta. Revisa la conexión e inténtalo de nuevo.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'No se pudo confirmar la solicitud de tu cuenta.');
  return result;
}

export function AccountSettings() {
  const [account, setAccount] = useState(null);
  const [username, setUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const sending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    accountRequest(undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setAccount(result);
      setUsername(result.username);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [retry]);

  const submit = async event => {
    event.preventDefault();
    if (sending.current || !account?.canChangePassword) return;
    setError(null);
    if (newPassword !== confirmation) { setError('Las contraseñas nuevas no coinciden.'); return; }
    if (newPassword && ([...newPassword].length < 6 || new TextEncoder().encode(newPassword).length > 72 || newPassword === currentPassword)) {
      setError('Elige otra contraseña de al menos 6 caracteres y hasta 72 bytes. No se exige combinar letras, números ni símbolos.'); return;
    }
    const nextUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,39}$/.test(nextUsername) || nextUsername.endsWith('.') || nextUsername.includes('..')) {
      setError('Usa entre 2 y 40 letras sin tildes, números, puntos, guiones o guiones bajos para el usuario.'); return;
    }
    const body = { currentPassword,
      ...(account.canChangeUsername && nextUsername !== account.username && { newUsername: nextUsername }),
      ...(newPassword && { newPassword }) };
    sending.current = true;
    setBusy(true);
    try {
      const result = await accountRequest(body);
      if (result.redirect !== '/login') throw new Error('No se pudo confirmar el cambio. Inicia sesión para comprobar tus datos.');
      window.location.assign('/login');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      sending.current = false;
      setBusy(false);
    }
  };

  return <SectionCard
    title="Mi cuenta"
    description="Cambia tus datos de acceso. Necesitas conexión y tu contraseña actual."
    icon={UserRound}
    actions={account?.role ? (
      <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium">
        {account.role === 'cajero' ? 'Rol: Cajero' : 'Rol: Dueño'}
      </span>
    ) : undefined}
  >
    {error && <p role="alert" className="mb-4 text-sm text-primary">{error}</p>}
    {!account ? <div className="text-sm text-muted-foreground">
      {error ? <Button type="button" variant="outline" className="rounded-xl" onClick={() => setRetry(value => value + 1)}>Volver a cargar</Button> : 'Cargando cuenta…'}
    </div> : !account.canChangePassword ? <p className="text-sm text-muted-foreground">
      {account.offline
        ? 'Sin conexión al servidor. Conéctate a internet para cambiar tu usuario o contraseña.'
        : 'Esta instalación utiliza acceso local. Los cambios de cuenta estarán disponibles al configurar cuentas individuales.'}
    </p> :
      <form onSubmit={submit} className="max-w-3xl">
        <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label="Usuario" htmlFor="account-username" hint={account.canChangeUsername ? 'Entre 2 y 40 caracteres: letras sin tildes, números, puntos o guiones.' : 'El cambio de usuario aún no está habilitado en este servidor. Puedes cambiar tu contraseña.'}>
            <Input id="account-username" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username"
              autoCapitalize="none" spellCheck={false} disabled={!account.canChangeUsername} required minLength={2} maxLength={40} className={inputClass} />
          </Field>
          <Field label="Contraseña actual" htmlFor="account-current-password">
            <Input id="account-current-password" type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}
              autoComplete="current-password" required maxLength={2000} className={inputClass} />
          </Field>
          <Field label="Nueva contraseña" htmlFor="account-new-password" hint="Mínimo 6 caracteres, sin combinaciones obligatorias. Déjala vacía para conservarla.">
            <Input id="account-new-password" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)}
              autoComplete="new-password" minLength={6} maxLength={72} className={inputClass} />
          </Field>
          <Field label="Confirmar nueva contraseña" htmlFor="account-confirm-password">
            <Input id="account-confirm-password" type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)}
              autoComplete="new-password" maxLength={72} className={inputClass} />
          </Field>
        </fieldset>
        <p className="mt-4 text-xs text-muted-foreground">Al guardar volverás a iniciar sesión con tus nuevos datos.</p>
        <Button type="submit" className="mt-6 rounded-xl" disabled={busy || (!newPassword && username.trim().toLowerCase() === account.username)}>
          <Save />{busy ? 'Confirmando…' : 'Guardar mi cuenta'}
        </Button>
      </form>}
  </SectionCard>;
}
