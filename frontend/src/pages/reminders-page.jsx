import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  BellRing,
  Box,
  CalendarClock,
  Check,
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Truck,
  Users,
} from 'lucide-react';
import { toast as ue } from 'sonner';
import { usePosStore } from '../data/pos-context.jsx';
import { PageHeader } from '../components/pos/page-header.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { EmptyState, MiniStat } from '../components/pos/section-card.jsx';
import { ConfirmDialog } from '../components/pos/confirm-dialog.jsx';
import { ReminderFormSheet } from '../components/pos/reminder-form-sheet.jsx';
import { cn } from '../lib/utils.js';
import { PRIORITY_META, reminderBucket, reminderDueLabel, sortReminders } from '../lib/reminders.js';

const STATUS_FILTERS = [
  { id: 'pendientes', label: 'Pendientes' },
  { id: 'hoy', label: 'Hoy y vencidos' },
  { id: 'vencidos', label: 'Vencidos' },
  { id: 'completados', label: 'Completados' },
  { id: 'todos', label: 'Todos' },
];

const PRIORITY_FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'alta', label: 'Alta' },
  { id: 'media', label: 'Media' },
  { id: 'baja', label: 'Baja' },
];

export function RemindersPage() {
  const {
    runtime,
    reminders = [],
    customers = [],
    suppliers = [],
    products = [],
    saveReminder,
    deleteReminder,
  } = usePosStore();
  const [params, setParams] = useSearchParams();
  const urlFilter = params.get('filtro') ?? '';
  const [statusFilter, setStatusFilter] = useState(() =>
    STATUS_FILTERS.some((f) => f.id === urlFilter) ? urlFilter : 'pendientes',
  );
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [creationDatabaseId, setCreationDatabaseId] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [tick, setTick] = useState(() => Date.now());

  const isOwner = !runtime || runtime.isOwner !== false;

  useEffect(() => {
    if (urlFilter && STATUS_FILTERS.some((f) => f.id === urlFilter)) {
      setStatusFilter(urlFilter);
    }
  }, [urlFilter]);

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const now = useMemo(() => new Date(tick), [tick]);
  const customersById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const suppliersById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const counts = useMemo(() => {
    let pending = 0;
    let today = 0;
    let overdue = 0;
    let completed = 0;
    for (let i = 0; i < reminders.length; i++) {
      const b = reminderBucket(reminders[i], now);
      if (b === 'completed') completed++;
      else {
        pending++;
        if (b === 'today') today++;
        if (b === 'overdue') overdue++;
      }
    }
    return { pending, today, overdue, completed };
  }, [reminders, now]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = reminders.filter((r) => {
      const bucket = reminderBucket(r, now);
      if (statusFilter === 'pendientes' && bucket === 'completed') return false;
      if (statusFilter === 'hoy' && bucket !== 'today' && bucket !== 'overdue') return false;
      if (statusFilter === 'vencidos' && bucket !== 'overdue') return false;
      if (statusFilter === 'completados' && bucket !== 'completed') return false;
      if (priorityFilter !== 'all' && r.priority !== priorityFilter) return false;
      if (!q) return true;
      const customerName = r.customerId != null ? customersById.get(r.customerId)?.name ?? '' : '';
      const supplierName = r.supplierId != null ? suppliersById.get(r.supplierId)?.name ?? '' : '';
      const prod = r.productId != null ? productsById.get(r.productId) : null;
      return [r.title, r.note, r.createdBy, customerName, supplierName, prod?.name, prod?.code, prod?.reference]
        .some((v) => v && v.toLowerCase().includes(q));
    });
    return sortReminders(list, now);
  }, [reminders, statusFilter, priorityFilter, query, now, customersById, suppliersById, productsById]);

  const applyFilter = (next) => {
    setStatusFilter(next);
    if (params.get('filtro')) {
      const copy = new URLSearchParams(params);
      copy.delete('filtro');
      setParams(copy, { replace: true });
    }
  };

  const toggleCompleted = async (r) => {
    if (togglingId === r.id) return;
    setTogglingId(r.id);
    const nextStatus = r.status === 'completado' ? 'pendiente' : 'completado';
    try {
      await saveReminder({
        ...r,
        status: nextStatus,
      });
      ue.success(nextStatus === 'completado' ? 'Recordatorio completado' : 'Recordatorio reabierto', {
        description: r.title,
      });
    } catch (cause) {
      ue.error('No se pudo actualizar', { description: cause.message });
    } finally {
      setTogglingId(null);
    }
  };

  const openNew = () => {
    setEditing(null);
    setCreationDatabaseId(runtime?.databaseId);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recordatorios"
        description="Tareas, pedidos a suplidores, seguimiento a clientes y avisos compartidos del equipo."
        actions={
          <Button
            data-shortcut-new="true"
            className="h-10 rounded-full px-5 shadow-md shadow-primary/20"
            onClick={openNew}
          >
            <Plus />
            {'Nuevo recordatorio'}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <button type="button" onClick={() => applyFilter('pendientes')} className={cn('rounded-2xl text-left transition-shadow hover:shadow-md', statusFilter === 'pendientes' && 'ring-2 ring-primary/40')}>
          <MiniStat icon={BellRing} tone="primary" label="Pendientes" value={counts.pending} />
        </button>
        <button type="button" onClick={() => applyFilter('hoy')} className={cn('rounded-2xl text-left transition-shadow hover:shadow-md', statusFilter === 'hoy' && 'ring-2 ring-primary/40')}>
          <MiniStat icon={CalendarClock} tone="warning" label="Para hoy" value={counts.today} />
        </button>
        <button type="button" onClick={() => applyFilter('vencidos')} className={cn('rounded-2xl text-left transition-shadow hover:shadow-md', statusFilter === 'vencidos' && 'ring-2 ring-primary/40')}>
          <MiniStat icon={AlertTriangle} tone={counts.overdue > 0 ? 'primary' : 'default'} label="Vencidos" value={counts.overdue} />
        </button>
        <button type="button" onClick={() => applyFilter('completados')} className={cn('rounded-2xl text-left transition-shadow hover:shadow-md', statusFilter === 'completados' && 'ring-2 ring-primary/40')}>
          <MiniStat icon={CheckCircle2} tone="success" label="Completados" value={counts.completed} />
        </button>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-md flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-shortcut-search="true"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por título, nota, cliente, suplidor o artículo…"
              aria-label="Buscar recordatorio"
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Filtrar por estado" className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={statusFilter === f.id}
                  onClick={() => applyFilter(f.id)}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                    statusFilter === f.id
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Filtrar por prioridad" className="inline-flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
              {PRIORITY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={priorityFilter === f.id}
                  onClick={() => setPriorityFilter(f.id)}
                  className={cn(
                    'rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                    priorityFilter === f.id
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={BellRing}
            title={reminders.length === 0 ? 'Sin recordatorios todavía' : 'Sin recordatorios en esta vista'}
            description={
              reminders.length === 0
                ? 'Crea el primer recordatorio para coordinar pedidos, cobros o tareas con el equipo.'
                : 'Prueba cambiando el filtro o limpiando la búsqueda.'
            }
            action={
              reminders.length === 0 ? (
                <Button className="rounded-xl" onClick={openNew}>
                  <Plus />
                  {'Crear recordatorio'}
                </Button>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((r) => {
              const bucket = reminderBucket(r, now);
              const isDone = bucket === 'completed';
              const isOverdue = bucket === 'overdue';
              const isToday = bucket === 'today';
              const prio = PRIORITY_META[r.priority] ?? PRIORITY_META.media;
              const customer = r.customerId != null ? customersById.get(r.customerId) : null;
              const supplier = r.supplierId != null ? suppliersById.get(r.supplierId) : null;
              const product = r.productId != null ? productsById.get(r.productId) : null;
              const dueText = reminderDueLabel(r, now);

              return (
                <li
                  key={r.id}
                  className={cn(
                    'flex items-start gap-3.5 px-4 py-3.5 transition-colors hover:bg-muted/30 sm:px-5',
                    isDone && 'opacity-70',
                  )}
                >
                  <button
                    type="button"
                    disabled={togglingId === r.id}
                    onClick={() => toggleCompleted(r)}
                    aria-label={isDone ? `Marcar pendiente: ${r.title}` : `Marcar completado: ${r.title}`}
                    aria-pressed={isDone}
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-colors',
                      isDone
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : isOverdue
                          ? 'border-primary/60 bg-card hover:border-primary hover:bg-primary/10'
                          : 'border-input bg-card hover:border-primary hover:bg-accent',
                    )}
                  >
                    {isDone && <Check className="h-3.5 w-3.5" strokeWidth={2.8} />}
                  </button>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={cn('text-sm font-semibold text-foreground', isDone && 'line-through text-muted-foreground')}>
                        {r.title}
                      </p>
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', prio.badgeClass)}>
                        {prio.label}
                      </span>
                      {r.dueDate && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
                            isOverdue
                              ? 'bg-primary text-primary-foreground'
                              : isToday
                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                : 'bg-muted text-muted-foreground',
                          )}
                        >
                          <CalendarClock className="h-3 w-3" />
                          {dueText}
                        </span>
                      )}
                    </div>

                    {r.note && (
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground" style={{ overflowWrap: 'anywhere' }}>
                        {r.note}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {customer && (
                        <Link
                          to={`/clientes?buscar=${encodeURIComponent(customer.name)}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-accent hover:text-primary"
                        >
                          <Users className="h-3 w-3 text-primary" />
                          {customer.name}
                        </Link>
                      )}
                      {supplier && (isOwner ? (
                        <Link
                          to={`/suplidores?buscar=${encodeURIComponent(supplier.name)}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-accent hover:text-primary"
                        >
                          <Truck className="h-3 w-3 text-primary" />
                          {supplier.name}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-0.5 font-medium text-foreground">
                          <Truck className="h-3 w-3 text-muted-foreground" />
                          {supplier.name}
                        </span>
                      ))}
                      {product && (
                        <Link
                          to={`/inventario?buscar=${encodeURIComponent(product.code)}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-accent hover:text-primary"
                        >
                          <Box className="h-3 w-3 text-primary" />
                          {`${product.code} · ${product.name}`}
                        </Link>
                      )}
                      {r.createdBy && (
                        <span>{`Creado por ${r.createdBy}`}</span>
                      )}
                      {isDone && r.completedBy && (
                        <span>{`· Hecho por ${r.completedBy}`}</span>
                      )}
                    </div>
                  </div>

                  <div className="mobile-touch-controls flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                      aria-label={`Editar ${r.title}`}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-primary"
                      onClick={() => setToDelete(r)}
                      aria-label={`Eliminar ${r.title}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ReminderFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        creationDatabaseId={creationDatabaseId}
        customers={customers}
        suppliers={suppliers}
        products={products}
        isOwner={isOwner}
        runtime={runtime}
        onSave={async (dto) => {
          await saveReminder(dto);
          ue.success(editing ? 'Recordatorio actualizado' : 'Recordatorio creado', {
            description: dto.title,
          });
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="¿Eliminar recordatorio?"
        description={`Se eliminará «${toDelete?.title ?? ''}» de la lista del equipo.`}
        onConfirm={async () => {
          if (toDelete) await deleteReminder(runtime ? toDelete : toDelete.id);
          setToDelete(null);
          ue('Recordatorio eliminado');
        }}
      />
    </div>
  );
}
