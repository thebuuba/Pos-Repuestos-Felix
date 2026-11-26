import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Box, Calendar, Search, Truck, Users, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog.jsx';
import { Button } from '../ui/button.jsx';
import { Input } from '../ui/input.jsx';
import { Field, inputClass } from './form-field.jsx';
import { cn } from '../../lib/utils.js';
import { businessTodayIso } from '../../lib/dates.js';
import { addBusinessDaysIso } from '../../lib/reminders.js';
import { searchTopProducts } from '../../data/product-search.js';

const PRIORITY_OPTIONS = [
  { id: 'baja', label: 'Baja' },
  { id: 'media', label: 'Media' },
  { id: 'alta', label: 'Alta' },
];

function initialLinkType(editing, isOwner) {
  if (editing?.customerId != null) return 'customer';
  if (editing?.supplierId != null && isOwner) return 'supplier';
  if (editing?.productId != null) return 'product';
  return 'none';
}

export function ReminderFormSheet({
  open,
  onOpenChange,
  editing,
  creationDatabaseId,
  customers = [],
  suppliers = [],
  products = [],
  isOwner = true,
  runtime,
  onSave,
}) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState('media');
  const [linkType, setLinkType] = useState('none');
  const [customerId, setCustomerId] = useState(null);
  const [supplierId, setSupplierId] = useState(null);
  const [productId, setProductId] = useState(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [uncertain, setUncertain] = useState(false);
  const [retryDto, setRetryDto] = useState(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? '');
    setNote(editing?.note ?? '');
    setDueDate(editing?.dueDate ?? '');
    setDueTime(editing?.dueTime ?? '');
    setPriority(editing?.priority ?? 'media');
    setLinkType(initialLinkType(editing, isOwner));
    setCustomerId(editing?.customerId ?? null);
    setSupplierId(editing?.supplierId ?? null);
    setProductId(editing?.productId ?? null);
    setLinkQuery('');
    setError(null);
    setUncertain(false);
    setRetryDto(null);
  }, [open, editing, isOwner]);

  const customersById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const suppliersById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const productsById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const linkChoices = useMemo(() => {
    const q = linkQuery.trim().toLowerCase();
    if (linkType === 'customer') {
      return customers
        .filter((c) => !c.isCashCustomer)
        .filter((c) => !q || (c.name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q) || (c.rnc || '').toLowerCase().includes(q))
        .slice(0, 6)
        .map((c) => ({ id: c.id, label: c.name, sub: c.phone || c.rnc || 'Cliente' }));
    }
    if (linkType === 'supplier') {
      return suppliers
        .filter((s) => !q || (s.name || '').toLowerCase().includes(q) || (s.contact || '').toLowerCase().includes(q) || (s.phone || '').toLowerCase().includes(q))
        .slice(0, 6)
        .map((s) => ({ id: s.id, label: s.name, sub: s.contact || s.phone || 'Suplidor' }));
    }
    if (linkType === 'product') {
      const list = q ? searchTopProducts(products, linkQuery, 6) : products.slice(0, 6);
      return list.map((p) => ({
        id: p.id,
        label: p.name,
        sub: [p.code, p.reference && `Ref. ${p.reference}`, `Stock ${p.stock}`].filter(Boolean).join(' · '),
      }));
    }
    return [];
  }, [linkType, linkQuery, customers, suppliers, products]);

  const selectedLink = useMemo(() => {
    if (linkType === 'customer' && customerId != null) {
      const c = customersById.get(customerId);
      return c ? { icon: Users, label: c.name, sub: c.phone || c.rnc || 'Cliente' } : null;
    }
    if (linkType === 'supplier' && supplierId != null) {
      const s = suppliersById.get(supplierId);
      return s ? { icon: Truck, label: s.name, sub: s.contact || s.phone || 'Suplidor' } : null;
    }
    if (linkType === 'product' && productId != null) {
      const p = productsById.get(productId);
      return p ? { icon: Box, label: p.name, sub: p.code } : null;
    }
    return null;
  }, [linkType, customerId, supplierId, productId, customersById, suppliersById, productsById]);

  const selectLinkType = (next) => {
    setLinkType(next);
    setLinkQuery('');
    if (next !== 'customer') setCustomerId(null);
    if (next !== 'supplier') setSupplierId(null);
    if (next !== 'product') setProductId(null);
  };

  const todayIso = businessTodayIso();
  const canSave = title.trim().length > 0 && (!dueTime || Boolean(dueDate));

  const submit = async (event) => {
    event?.preventDefault();
    if (inFlight.current) return;
    if (!retryDto && !canSave) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const dto = retryDto ?? {
      ...(editing
        ? { id: editing.id, version: editing.version, status: editing.status }
        : { id: crypto.randomUUID(), status: 'pendiente' }),
      databaseId: editing?.databaseId ?? creationDatabaseId ?? runtime?.databaseId,
      title: title.trim(),
      note: note.trim(),
      dueDate: dueDate || null,
      dueTime: dueDate ? dueTime : '',
      priority,
      customerId: linkType === 'customer' ? customerId : null,
      supplierId: linkType === 'supplier' ? supplierId : (!isOwner && editing?.supplierId ? editing.supplierId : null),
      productId: linkType === 'product' ? productId : null,
    };
    try {
      await onSave(dto);
      setUncertain(false);
      setRetryDto(null);
      onOpenChange(false);
    } catch (cause) {
      setError(cause.message || 'No se pudo guardar el recordatorio.');
      if (cause.uncertain) {
        setUncertain(true);
        setRetryDto(dto);
      } else {
        setUncertain(false);
        setRetryDto(null);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const linkTypes = [
    { id: 'none', label: 'Ninguno' },
    { id: 'customer', label: 'Cliente' },
    ...(isOwner ? [{ id: 'supplier', label: 'Suplidor' }] : []),
    { id: 'product', label: 'Artículo' },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy && !uncertain) onOpenChange(next); }}>
      <DialogContent
        closeDisabled={busy}
        style={{ width: 'calc(100vw - 2rem)', maxHeight: 'calc(100dvh - 2rem)' }}
        className="flex flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg"
      >
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" />
            {editing ? 'Editar recordatorio' : 'Nuevo recordatorio'}
          </DialogTitle>
          <DialogDescription>
            {'Visible y sincronizado para todo el equipo (dueño y cajeros).'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <Field htmlFor="reminder-title" label="Título" required={true}>
              <Input
                id="reminder-title"
                maxLength={200}
                disabled={busy || uncertain}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Llamar a suplidor por pedido de gomas"
                className={inputClass}
              />
            </Field>
            <Field htmlFor="reminder-note" label="Nota o detalle">
              <textarea
                id="reminder-note"
                rows={3}
                maxLength={2000}
                disabled={busy || uncertain}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Detalles adicionales, teléfono, cantidad o referencia…"
                className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground shadow-none outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              />
            </Field>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-foreground">{'Prioridad'}</p>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Prioridad del recordatorio">
                {PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={busy || uncertain}
                    aria-pressed={priority === opt.id}
                    onClick={() => setPriority(opt.id)}
                    className={cn(
                      'h-9 rounded-xl border text-xs font-semibold transition-colors',
                      priority === opt.id
                        ? opt.id === 'alta'
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : opt.id === 'media'
                            ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : 'border-foreground/30 bg-foreground text-background'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2.5 rounded-2xl border border-border bg-muted/40 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Calendar className="h-3.5 w-3.5 text-primary" />
                  {'Fecha y hora (opcional)'}
                </span>
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: 'Hoy', date: todayIso },
                    { label: 'Mañana', date: addBusinessDaysIso(todayIso, 1) },
                    { label: 'En 7 días', date: addBusinessDaysIso(todayIso, 7) },
                    { label: 'Sin fecha', date: '' },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      disabled={busy || uncertain}
                      onClick={() => {
                        setDueDate(preset.date);
                        if (!preset.date) setDueTime('');
                      }}
                      className={cn(
                        'rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors',
                        dueDate === preset.date
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <Field htmlFor="reminder-date" label="Fecha límite">
                  <Input
                    id="reminder-date"
                    type="date"
                    disabled={busy || uncertain}
                    value={dueDate}
                    onChange={(e) => {
                      setDueDate(e.target.value);
                      if (!e.target.value) setDueTime('');
                    }}
                    className="h-9 rounded-lg bg-card text-sm tabular-nums"
                  />
                </Field>
                <Field htmlFor="reminder-time" label="Hora (opcional)">
                  <Input
                    id="reminder-time"
                    type="time"
                    disabled={busy || uncertain || !dueDate}
                    value={dueTime}
                    onChange={(e) => setDueTime(e.target.value)}
                    className="h-9 rounded-lg bg-card text-sm tabular-nums"
                  />
                </Field>
              </div>
            </div>
            <div className="space-y-2.5 rounded-2xl border border-border bg-muted/40 p-3.5">
              <p className="text-xs font-semibold text-foreground">{'Vincular con (opcional)'}</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de vínculo">
                {linkTypes.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={busy || uncertain}
                    aria-pressed={linkType === opt.id}
                    onClick={() => selectLinkType(opt.id)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      linkType === opt.id
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {linkType !== 'none' && (
                selectedLink ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <selectedLink.icon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-foreground">{selectedLink.label}</span>
                        <span className="block truncate text-muted-foreground">{selectedLink.sub}</span>
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy || uncertain}
                      aria-label="Quitar vínculo"
                      className="h-7 w-7 shrink-0 text-muted-foreground"
                      onClick={() => {
                        setCustomerId(null);
                        setSupplierId(null);
                        setProductId(null);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        disabled={busy || uncertain}
                        aria-label="Buscar vínculo"
                        value={linkQuery}
                        onChange={(e) => setLinkQuery(e.target.value)}
                        placeholder={
                          linkType === 'customer'
                            ? 'Buscar cliente por nombre o teléfono…'
                            : linkType === 'supplier'
                              ? 'Buscar suplidor por nombre o contacto…'
                              : 'Buscar artículo por código, referencia o nombre…'
                        }
                        className="h-9 rounded-lg bg-card pl-8 text-xs"
                      />
                    </div>
                    {linkChoices.length === 0 ? (
                      <p className="px-1 text-xs text-muted-foreground">{'Sin coincidencias.'}</p>
                    ) : (
                      <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-1">
                        {linkChoices.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              disabled={busy || uncertain}
                              onClick={() => {
                                if (linkType === 'customer') setCustomerId(item.id);
                                if (linkType === 'supplier') setSupplierId(item.id);
                                if (linkType === 'product') setProductId(item.id);
                                setLinkQuery('');
                              }}
                              className="flex w-full flex-col rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-muted"
                            >
                              <span className="truncate font-medium text-foreground">{item.label}</span>
                              <span className="truncate text-[11px] text-muted-foreground">{item.sub}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              )}
            </div>
            {error && (
              <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 border-t border-border px-6 py-3.5">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="rounded-xl"
              onClick={() => onOpenChange(false)}
            >
              {'Cancelar'}
            </Button>
            <Button
              type="submit"
              data-shortcut-submit="true"
              disabled={busy || (!retryDto && !canSave)}
              className="rounded-xl shadow-md shadow-primary/20"
            >
              {busy ? 'Guardando…' : uncertain ? 'Reintentar' : editing ? 'Guardar cambios' : 'Crear recordatorio'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
