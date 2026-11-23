import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserRound,
  Users,
  UserX,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard } from './section-card.jsx';
import { Field, inputClass } from './form-field.jsx';
import { Input } from '../ui/input.jsx';
import { Button } from '../ui/button.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.jsx';
import { formatDateTime } from '../../lib/accounts.js';
import { cn } from '../../lib/utils.js';

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;

async function usersRequest(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: signal || AbortSignal.timeout(40000),
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(
      method === 'GET'
        ? 'No se pudieron cargar los usuarios. Revisa tu conexión e inténtalo de nuevo.'
        : 'No se pudo confirmar el cambio de usuario. Revisa tu conexión y actualiza la lista antes de reintentar.',
    );
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new Error(result?.error || 'No se pudo completar la solicitud de usuarios.');
  }
  return result;
}

function validateUsernameClient(value) {
  const clean = value.trim().toLowerCase();
  if (!USERNAME_RE.test(clean) || clean.endsWith('.') || clean.includes('..')) {
    return 'Usa entre 2 y 40 letras sin tildes, números, puntos, guiones o guiones bajos.';
  }
  return null;
}

function validatePasswordClient(value) {
  if (typeof value !== 'string' || [...value].length < 6 || new TextEncoder().encode(value).length > 72) {
    return 'La contraseña debe tener al menos 6 caracteres y hasta 72 bytes. No se exige combinar letras, números ni símbolos.';
  }
  return null;
}

function sortUsers(list) {
  return [...list].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.role !== b.role) return a.role === 'dueno' ? -1 : 1;
    return a.username.localeCompare(b.username, 'es');
  });
}

function RoleBadge({ role }) {
  const owner = role === 'dueno';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        owner
          ? 'bg-accent text-accent-foreground'
          : 'bg-secondary text-secondary-foreground',
      )}
    >
      {owner ? <ShieldCheck className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
      {owner ? 'Dueño' : 'Cajero'}
    </span>
  );
}

function StatusBadge({ active }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        active
          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          active ? 'bg-emerald-500' : 'bg-muted-foreground/60',
        )}
        aria-hidden="true"
      />
      {active ? 'Activo' : 'Desactivado'}
    </span>
  );
}

function PasswordInput({ id, value, onChange, disabled, autoComplete, placeholder, required }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        disabled={disabled}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        minLength={6}
        maxLength={72}
        className={cn(inputClass, 'pr-11')}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function UsersSettings() {
  const [state, setState] = useState({ loading: true, available: true, offline: false, reason: '', users: [] });
  const [loadError, setLoadError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', displayName: '', role: 'cajero', password: '', confirm: '' });
  const [createError, setCreateError] = useState(null);

  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ displayName: '', role: 'cajero' });
  const [editError, setEditError] = useState(null);

  const [resetting, setResetting] = useState(null);
  const [resetForm, setResetForm] = useState({ password: '', confirm: '' });
  const [resetError, setResetError] = useState(null);

  const [toggling, setToggling] = useState(null);
  const [toggleError, setToggleError] = useState(null);

  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const reload = useCallback(() => setRefreshTick(tick => tick + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    setState(prev => ({ ...prev, loading: true }));
    usersRequest('/api/usuarios', { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setState({
          loading: false,
          available: result.available !== false,
          offline: Boolean(result.offline),
          reason: result.reason || '',
          users: Array.isArray(result.users) ? sortUsers(result.users) : [],
        });
      })
      .catch(cause => {
        if (controller.signal.aborted) return;
        setLoadError(cause.message);
        setState(prev => ({ ...prev, loading: false }));
      });
    return () => controller.abort();
  }, [refreshTick]);

  const activeOwnersCount = useMemo(
    () => state.users.filter(u => u.role === 'dueno' && u.active).length,
    [state.users],
  );

  const upsertUser = (nextUser) => {
    setState(prev => ({
      ...prev,
      users: sortUsers([
        ...prev.users.filter(u => u.id !== nextUser.id),
        nextUser,
      ]),
    }));
  };

  const openCreate = () => {
    setCreateForm({ username: '', displayName: '', role: 'cajero', password: '', confirm: '' });
    setCreateError(null);
    setCreateOpen(true);
  };

  const openEdit = (user) => {
    setEditing(user);
    setEditForm({ displayName: user.displayName || '', role: user.role });
    setEditError(null);
  };

  const openReset = (user) => {
    setResetting(user);
    setResetForm({ password: '', confirm: '' });
    setResetError(null);
  };

  const openToggle = (user) => {
    setToggling(user);
    setToggleError(null);
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    if (sending.current) return;
    setCreateError(null);
    const userErr = validateUsernameClient(createForm.username);
    if (userErr) { setCreateError(userErr); return; }
    if ([...createForm.displayName.trim()].length > 80) {
      setCreateError('El nombre visible debe tener hasta 80 caracteres.');
      return;
    }
    const passErr = validatePasswordClient(createForm.password);
    if (passErr) { setCreateError(passErr); return; }
    if (createForm.password !== createForm.confirm) {
      setCreateError('Las contraseñas no coinciden.');
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const result = await usersRequest('/api/usuarios', {
        method: 'POST',
        body: {
          username: createForm.username.trim().toLowerCase(),
          displayName: createForm.displayName.trim(),
          role: createForm.role,
          password: createForm.password,
        },
      });
      upsertUser(result.user);
      setCreateOpen(false);
      toast.success(`Usuario ${result.user.username} creado`);
    } catch (cause) {
      setCreateError(cause.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (!editing || sending.current) return;
    setEditError(null);
    const cleanName = editForm.displayName.trim();
    if ([...cleanName].length > 80) {
      setEditError('El nombre visible debe tener hasta 80 caracteres.');
      return;
    }
    const body = {};
    if (cleanName !== (editing.displayName || '')) body.displayName = cleanName;
    if (editForm.role !== editing.role) body.role = editForm.role;
    if (Object.keys(body).length === 0) {
      setEditing(null);
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const result = await usersRequest('/api/usuarios/' + encodeURIComponent(editing.id), {
        method: 'PUT',
        body,
      });
      upsertUser(result.user);
      setEditing(null);
      toast.success(`Usuario ${result.user.username} actualizado`);
    } catch (cause) {
      setEditError(cause.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    if (!resetting || sending.current) return;
    setResetError(null);
    const passErr = validatePasswordClient(resetForm.password);
    if (passErr) { setResetError(passErr); return; }
    if (resetForm.password !== resetForm.confirm) {
      setResetError('Las contraseñas no coinciden.');
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      const result = await usersRequest('/api/usuarios/' + encodeURIComponent(resetting.id), {
        method: 'PUT',
        body: { newPassword: resetForm.password },
      });
      upsertUser(result.user);
      setResetting(null);
      toast.success(`Contraseña de ${result.user.username} actualizada`);
    } catch (cause) {
      setResetError(cause.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const handleToggleActive = async () => {
    if (!toggling || sending.current) return;
    setToggleError(null);
    const nextActive = !toggling.active;
    sending.current = true;
    setBusy(true);
    try {
      const result = await usersRequest('/api/usuarios/' + encodeURIComponent(toggling.id), {
        method: 'PUT',
        body: { active: nextActive },
      });
      upsertUser(result.user);
      setToggling(null);
      toast.success(
        nextActive
          ? `Usuario ${result.user.username} reactivado`
          : `Usuario ${result.user.username} desactivado`,
      );
    } catch (cause) {
      setToggleError(cause.message);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  const isLastActiveOwner = (user) =>
    user.role === 'dueno' && user.active && activeOwnersCount <= 1;

  const canDeactivate = (user) => !user.isSelf && !isLastActiveOwner(user);
  const canChangeRole = (user) => !user.isSelf && !isLastActiveOwner(user);

  return (
    <>
      <SectionCard
        title="Usuarios del sistema"
        description="Crea cuentas de cajeros o dueños, cambia roles, restablece contraseñas o desactiva accesos."
        icon={Users}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl"
              disabled={state.loading || busy}
              onClick={reload}
              aria-label="Actualizar lista de usuarios"
            >
              <RefreshCw className={cn('h-4 w-4', state.loading && 'animate-spin')} />
              <span>Actualizar</span>
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-xl"
              disabled={!state.available || state.loading || busy}
              onClick={openCreate}
            >
              <UserPlus className="h-4 w-4" />
              <span>Nuevo usuario</span>
            </Button>
          </div>
        }
      >
        {loadError && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-accent p-4">
            <p role="alert" className="text-sm text-primary">{loadError}</p>
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={reload}>
              Reintentar
            </Button>
          </div>
        )}

        {state.loading && state.users.length === 0 ? (
          <p role="status" className="py-6 text-sm text-muted-foreground">
            Cargando usuarios…
          </p>
        ) : !state.available ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-muted/50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                {state.offline ? <WifiOff className="h-4 w-4" /> : <Users className="h-4 w-4" />}
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {state.offline ? 'Sin conexión al servidor' : 'Administración de usuarios no disponible'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {state.reason || 'Conéctate a internet para crear o editar usuarios.'}
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={reload}>
              Volver a comprobar
            </Button>
          </div>
        ) : state.users.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No se encontraron usuarios registrados para el POS.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                    <th className="pb-3 pr-4">Usuario</th>
                    <th className="pb-3 pr-4">Rol</th>
                    <th className="pb-3 pr-4">Estado</th>
                    <th className="pb-3 pr-4">Último acceso</th>
                    <th className="pb-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {state.users.map(user => {
                    const toggleDisabled = user.active && !canDeactivate(user);
                    return (
                      <tr key={user.id} className="align-middle">
                        <td className="py-3.5 pr-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">{user.username}</span>
                            {user.isSelf && (
                              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                Tú
                              </span>
                            )}
                          </div>
                          {user.displayName && (
                            <p className="text-xs text-muted-foreground">{user.displayName}</p>
                          )}
                        </td>
                        <td className="py-3.5 pr-4">
                          <RoleBadge role={user.role} />
                        </td>
                        <td className="py-3.5 pr-4">
                          <StatusBadge active={user.active} />
                        </td>
                        <td className="py-3.5 pr-4 text-xs text-muted-foreground tabular-nums">
                          {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : 'Sin accesos'}
                        </td>
                        <td className="py-3.5 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg px-2.5 text-xs"
                              onClick={() => openEdit(user)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              <span>Editar</span>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg px-2.5 text-xs"
                              onClick={() => openReset(user)}
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                              <span>Clave</span>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={toggleDisabled}
                              title={
                                user.isSelf
                                  ? 'No puedes desactivar tu propia cuenta'
                                  : isLastActiveOwner(user)
                                    ? 'Debe quedar al menos un dueño activo'
                                    : undefined
                              }
                              className={cn(
                                'h-8 rounded-lg px-2.5 text-xs',
                                user.active
                                  ? 'hover:border-primary/40 hover:text-primary'
                                  : 'text-emerald-700 hover:border-emerald-500/40 dark:text-emerald-300',
                              )}
                              onClick={() => openToggle(user)}
                            >
                              {user.active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                              <span>{user.active ? 'Desactivar' : 'Reactivar'}</span>
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 lg:hidden">
              {state.users.map(user => {
                const toggleDisabled = user.active && !canDeactivate(user);
                return (
                  <div
                    key={user.id}
                    className="space-y-3 rounded-2xl border border-border bg-card p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-foreground">{user.username}</span>
                          {user.isSelf && (
                            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              Tú
                            </span>
                          )}
                        </div>
                        {user.displayName && (
                          <p className="truncate text-xs text-muted-foreground">{user.displayName}</p>
                        )}
                      </div>
                      <StatusBadge active={user.active} />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <RoleBadge role={user.role} />
                      <span className="tabular-nums">
                        {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : 'Sin accesos'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 flex-1 rounded-xl text-xs"
                        onClick={() => openEdit(user)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Editar</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 flex-1 rounded-xl text-xs"
                        onClick={() => openReset(user)}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        <span>Clave</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={toggleDisabled}
                        className={cn(
                          'h-11 flex-1 rounded-xl text-xs',
                          user.active
                            ? 'hover:border-primary/40 hover:text-primary'
                            : 'text-emerald-700 hover:border-emerald-500/40 dark:text-emerald-300',
                        )}
                        onClick={() => openToggle(user)}
                      >
                        {user.active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                        <span>{user.active ? 'Desactivar' : 'Reactivar'}</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-border bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
              <p>
                <strong className="font-medium text-foreground">Dueño:</strong> acceso completo (costos, compras, suplidores, reportes, anulaciones, configuración y usuarios).{' '}
                <strong className="font-medium text-foreground">Cajero:</strong> ventas, caja, inventario sin costos, clientes y cobros.
              </p>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Dialog: Nuevo usuario */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!busy) setCreateOpen(open); }}>
        <DialogContent closeDisabled={busy} className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Nuevo usuario</DialogTitle>
            <DialogDescription>
              Crea una cuenta individual para acceder desde Web, PWA o Windows.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <fieldset disabled={busy} className="space-y-4">
              <Field
                label="Usuario"
                htmlFor="new-user-username"
                hint="Entre 2 y 40 caracteres: letras sin tildes, números, puntos o guiones."
              >
                <Input
                  id="new-user-username"
                  value={createForm.username}
                  onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="ej. caja1"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  minLength={2}
                  maxLength={40}
                  className={inputClass}
                />
              </Field>
              <Field label="Nombre visible (opcional)" htmlFor="new-user-display-name">
                <Input
                  id="new-user-display-name"
                  value={createForm.displayName}
                  onChange={e => setCreateForm(f => ({ ...f, displayName: e.target.value }))}
                  placeholder="ej. María López"
                  maxLength={80}
                  className={inputClass}
                />
              </Field>
              <Field label="Rol" htmlFor="new-user-role">
                <Select
                  value={createForm.role}
                  onValueChange={role => setCreateForm(f => ({ ...f, role }))}
                  disabled={busy}
                >
                  <SelectTrigger id="new-user-role" aria-label="Rol" className={inputClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cajero">Cajero (mostrador)</SelectItem>
                    <SelectItem value="dueno">Dueño (acceso completo)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Contraseña inicial"
                htmlFor="new-user-password"
                hint="Mínimo 6 caracteres, sin combinaciones obligatorias."
              >
                <PasswordInput
                  id="new-user-password"
                  value={createForm.password}
                  onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  required
                  disabled={busy}
                />
              </Field>
              <Field label="Confirmar contraseña" htmlFor="new-user-confirm">
                <PasswordInput
                  id="new-user-confirm"
                  value={createForm.confirm}
                  onChange={e => setCreateForm(f => ({ ...f, confirm: e.target.value }))}
                  autoComplete="new-password"
                  required
                  disabled={busy}
                />
              </Field>
            </fieldset>
            {createError && <p role="alert" className="text-sm text-primary">{createError}</p>}
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" className="rounded-xl" disabled={busy} onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="rounded-xl" disabled={busy}>
                {busy ? 'Creando…' : 'Crear usuario'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: Editar usuario */}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}>
        <DialogContent closeDisabled={busy} className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
            <DialogDescription>
              {editing ? `Cuenta: ${editing.username}` : ''}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={handleEdit} className="space-y-4">
              <fieldset disabled={busy} className="space-y-4">
                <Field label="Nombre visible (opcional)" htmlFor="edit-user-display-name">
                  <Input
                    id="edit-user-display-name"
                    value={editForm.displayName}
                    onChange={e => setEditForm(f => ({ ...f, displayName: e.target.value }))}
                    placeholder="ej. María López"
                    maxLength={80}
                    className={inputClass}
                  />
                </Field>
                <Field
                  label="Rol"
                  htmlFor="edit-user-role"
                  hint={
                    editing.isSelf
                      ? 'No puedes cambiar tu propio rol.'
                      : isLastActiveOwner(editing)
                        ? 'Debe quedar al menos un dueño activo en el sistema.'
                        : undefined
                  }
                >
                  <Select
                    value={editForm.role}
                    onValueChange={role => setEditForm(f => ({ ...f, role }))}
                    disabled={busy || !canChangeRole(editing)}
                  >
                    <SelectTrigger id="edit-user-role" aria-label="Rol del usuario" className={inputClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cajero">Cajero (mostrador)</SelectItem>
                      <SelectItem value="dueno">Dueño (acceso completo)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </fieldset>
              {editError && <p role="alert" className="text-sm text-primary">{editError}</p>}
              <DialogFooter className="gap-2 pt-2">
                <Button type="button" variant="outline" className="rounded-xl" disabled={busy} onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
                <Button type="submit" className="rounded-xl" disabled={busy}>
                  {busy ? 'Guardando…' : 'Guardar cambios'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Restablecer contraseña */}
      <Dialog open={Boolean(resetting)} onOpenChange={(open) => { if (!open && !busy) setResetting(null); }}>
        <DialogContent closeDisabled={busy} className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Restablecer contraseña</DialogTitle>
            <DialogDescription>
              {resetting ? `Asigna una nueva contraseña para ${resetting.username}. Deberá usarla en su próximo inicio de sesión.` : ''}
            </DialogDescription>
          </DialogHeader>
          {resetting && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <fieldset disabled={busy} className="space-y-4">
                <Field
                  label="Nueva contraseña"
                  htmlFor="reset-user-password"
                  hint="Mínimo 6 caracteres, sin combinaciones obligatorias."
                >
                  <PasswordInput
                    id="reset-user-password"
                    value={resetForm.password}
                    onChange={e => setResetForm(f => ({ ...f, password: e.target.value }))}
                    autoComplete="new-password"
                    required
                    disabled={busy}
                  />
                </Field>
                <Field label="Confirmar nueva contraseña" htmlFor="reset-user-confirm">
                  <PasswordInput
                    id="reset-user-confirm"
                    value={resetForm.confirm}
                    onChange={e => setResetForm(f => ({ ...f, confirm: e.target.value }))}
                    autoComplete="new-password"
                    required
                    disabled={busy}
                  />
                </Field>
              </fieldset>
              {resetError && <p role="alert" className="text-sm text-primary">{resetError}</p>}
              <DialogFooter className="gap-2 pt-2">
                <Button type="button" variant="outline" className="rounded-xl" disabled={busy} onClick={() => setResetting(null)}>
                  Cancelar
                </Button>
                <Button type="submit" className="rounded-xl" disabled={busy}>
                  {busy ? 'Actualizando…' : 'Actualizar contraseña'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: Desactivar / Reactivar */}
      <Dialog open={Boolean(toggling)} onOpenChange={(open) => { if (!open && !busy) setToggling(null); }}>
        <DialogContent closeDisabled={busy} className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {toggling?.active ? '¿Desactivar usuario?' : '¿Reactivar usuario?'}
            </DialogTitle>
            <DialogDescription>
              {toggling?.active
                ? `Se bloqueará el acceso de ${toggling.username} en Web, PWA y Windows. Todo su historial de ventas y turnos de caja se conservará intacto.`
                : `Se habilitará nuevamente el acceso de ${toggling?.username} con su rol actual (${toggling?.role === 'dueno' ? 'Dueño' : 'Cajero'}).`}
            </DialogDescription>
          </DialogHeader>
          {toggleError && <p role="alert" className="text-sm text-primary">{toggleError}</p>}
          <DialogFooter className="gap-2 pt-2">
            <Button type="button" variant="outline" className="rounded-xl" disabled={busy} onClick={() => setToggling(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={toggling?.active ? 'destructive' : 'default'}
              className="rounded-xl"
              disabled={busy}
              onClick={handleToggleActive}
            >
              {busy
                ? 'Confirmando…'
                : toggling?.active
                  ? 'Desactivar acceso'
                  : 'Reactivar acceso'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
