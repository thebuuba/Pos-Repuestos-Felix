// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { ArrowDownLeft } from "lucide-react";
import { HandCoins } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { Receipt } from "lucide-react";
import { usePosStore } from "../../data/pos-context.jsx";
import { PageHeader } from "../components/page-header.jsx";
import { formatTime } from "../lib/accounts.js";
import { Button } from "../../components/ui/button.jsx";
import { Plus } from "lucide-react";
import { Lock } from "lucide-react";
import { LockOpen } from "lucide-react";
import { Input } from "../../components/ui/input.jsx";
import { toast as ue } from "sonner";
import { formatMoney } from "../lib/format.js";
import { MoneyDisplay } from "../components/money-display.jsx";
import { MiniStat } from "../components/section-card.jsx";
import { Banknote } from "lucide-react";
import { CreditCard } from "lucide-react";
import { ArrowLeftRight } from "lucide-react";
import { SectionCard } from "../components/section-card.jsx";
import { Wallet } from "lucide-react";
import { EmptyState } from "../components/section-card.jsx";
import { cn } from "../../lib/utils.js";
import { History } from "lucide-react";
import { formatDateTime } from "../lib/accounts.js";
import { CashCountDialog } from "../components/cash-count-dialog.jsx";
import { CashMovementDialog } from "../components/cash-movement-dialog.jsx";
import { Fragment } from "react";
import { useState } from "react";
import { useRef } from "react";
var MOVE_UI = {
  entrada: {
    label: "Entrada",
    icon: ArrowDownLeft,
    sign: "+",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  cobro: {
    label: "Cobro",
    icon: HandCoins,
    sign: "+",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  salida: {
    label: "Salida",
    icon: ArrowUpRight,
    sign: "−",
    className: "bg-accent text-primary",
  },
  pago: {
    label: "Pago",
    icon: Receipt,
    sign: "−",
    className: "bg-accent text-primary",
  },
};
function CashRegisterPage() {
  const {
    runtime,
    cashSession = {open:false,openedAt:"",cashier:""},
    cashSummary: s = {},
    cashMovements = [],
    closures = [],
    openCash,
    closeCash,
    addCashMovement,
  } = usePosStore();
  const [opening, setOpening] = useState(runtime ? "" : "5000");
  const [countOpen, setCountOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [sending, setSending] = useState(null);
  const [failure, setFailure] = useState(null);
  const inFlight = useRef(false);
  const locked = !!sending || !!failure?.retry;
  const hasPending = Boolean(runtime?.pending && runtime.inFlightOperationId !== runtime.pending.id);
  const unavailable = !!runtime && (runtime.connection !== "connected" || hasPending || (runtime.busy && !sending));
  const disabled = locked || unavailable;
  const validOpening = /^\d+(?:\.\d{1,2})?$/.test(opening) && Number.isFinite(Number(opening));
  const sessionMoves = cashMovements.filter(
    (m) => runtime ? m.sessionId === cashSession.id : m.date >= cashSession.openedAt,
  );
  const totalSales =
    s.cashSales + s.cardSales + s.transferSales + s.creditSales;
  async function submit(kind, args, retry = false) {
    if (inFlight.current || (runtime && !retry && disabled)) return;
    inFlight.current = true;
    setSending(kind);
    setFailure(null);
    try {
      let result;
      if (retry) result = await failure.retry();
      else if (kind === "open") result = await openCash(runtime ? { databaseId: runtime.databaseId, monto: args.amount } : Number(args.amount));
      else if (kind === "close") result = await closeCash(runtime ? {
        databaseId: runtime.databaseId, cajaId: cashSession.id, version: cashSession.version, conteo: args.counted,
      } : args.counted);
      else result = await (runtime ? addCashMovement({ databaseId: runtime.databaseId, cajaId: cashSession.id,
        version: cashSession.version, tipo: args.type, monto: args.amount, concepto: args.description })
        : addCashMovement(args.type, Number(args.amount), args.description));
      if (kind === "open") ue.success("Caja abierta", { description: `Fondo inicial ${formatMoney(Number(args.amount))}` });
      else if (kind === "close") {
        const closure = runtime ? result.result : result;
        const diff = (Math.round(closure.counted * 100) - Math.round(closure.expected * 100)) / 100;
        setCountOpen(false);
        ue.success("Caja cerrada", { description: diff === 0 ? "La caja cuadró perfectamente."
          : `${diff > 0 ? "Sobrante" : "Faltante"} de ${formatMoney(Math.abs(diff))}` });
      } else {
        setMoveOpen(false);
        ue.success(`${args.type === "entrada" ? "Entrada" : "Salida"} registrada`, { description: formatMoney(Number(args.amount)) });
      }
    } catch (error) {
      setFailure({ kind, args, message: error.message,
        retry: error.retry ?? (retry && !error.definitive ? failure.retry : null) });
    } finally {
      inFlight.current = false;
      setSending(null);
    }
  }
  const retry = () => submit(failure.kind, failure.args, true);
  const changeDialog = (setOpen) => (open) => {
    if (locked) return;
    setFailure(null);
    setOpen(open);
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Caja"
        description={
          cashSession.open
            ? `Caja 01 abierta por ${cashSession.cashier} a las ${formatTime(cashSession.openedAt)}.`
            : "La caja está cerrada. Ábrela con el fondo inicial para empezar a vender."
        }
        actions={
          cashSession.open && (
            <Fragment>
              <Button
                variant="outline"
                className="h-10 rounded-full bg-card px-5"
                disabled={disabled}
                onClick={() => changeDialog(setMoveOpen)(true)}
              >
                <Plus />
                {"Entrada / salida"}
              </Button>
              <Button
                className="h-10 rounded-full px-5 shadow-md shadow-primary/20"
                disabled={disabled}
                onClick={() => changeDialog(setCountOpen)(true)}
              >
                <Lock />
                {"Cerrar caja"}
              </Button>
            </Fragment>
          )
        }
      />
      {runtime && unavailable && !locked && <p role="status" className="rounded-xl border border-border bg-card p-4 text-sm">
        {hasPending ? "Hay una operación pendiente de confirmación. Resuélvela antes de continuar."
          : runtime.busy ? "Espera a que termine la operación en curso." : "Conecta con el servicio para registrar operaciones de caja."}
      </p>}
      {!countOpen && !moveOpen && (sending || failure) && <div role={failure ? "alert" : "status"} className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
        <p>{sending ? "Confirmando la apertura…" : failure.message}</p>
        {failure?.retry && <Button variant="outline" disabled={!!sending || runtime?.busy} onClick={retry}>Reintentar apertura</Button>}
      </div>}
      {!cashSession.open ? (
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-primary">
            <LockOpen className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">{"Abrir caja"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {"¿Con cuánto efectivo empiezas el turno?"}
          </p>
          <div className="relative mt-5">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {"RD$"}
            </span>
            <Input disabled={disabled}
              aria-label="Fondo inicial"
              type="number"
              min={0}
              step="0.01"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              className="h-14 rounded-xl pl-14 text-center text-2xl font-semibold tabular-nums"
            />
          </div>
          <div className="mobile-touch-controls mt-3 flex flex-wrap justify-center gap-2">
            {[2000, 3000, 5000, 1e4].map((a) => (
              <button disabled={disabled}
                type="button"
                onClick={() => setOpening(String(a))}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium tabular-nums text-muted-foreground hover:text-foreground"
                key={a}
              >
                {a.toLocaleString("en-US")}
              </button>
            ))}
          </div>
          <Button
            disabled={disabled || !validOpening}
            className="mt-6 h-12 w-full rounded-xl text-[15px] font-semibold"
            onClick={() => submit("open", { amount: opening })}
          >
            {"Abrir caja"}
          </Button>
        </div>
      ) : (
        <Fragment>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="relative overflow-hidden rounded-2xl bg-primary p-6 text-primary-foreground lg:col-span-1">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary-foreground/10" />
              <p className="text-sm text-primary-foreground/80">
                {"Efectivo esperado en caja"}
              </p>
              <MoneyDisplay
                value={s.expected}
                className="mt-1 text-[40px] leading-tight"
                symbolClassName="text-primary-foreground/70"
                centsClassName="text-primary-foreground/55"
              />
              <div className="mt-6 space-y-2 border-t border-primary-foreground/20 pt-4 text-sm">
                {[
                  ["Fondo inicial", s.opening, "+"],
                  ["Ventas en efectivo", s.cashSales, "+"],
                  ["Entradas", s.entradas, "+"],
                  ["Cobros en efectivo", s.cobros, "+"],
                  ["Salidas", s.salidas, "−"],
                  ["Pagos en efectivo", s.pagos, "−"],
                ].map(([label, value, sign]) => (
                  <div className="flex justify-between" key={label}>
                    <span className="text-primary-foreground/75">{label}</span>
                    <span className="font-medium tabular-nums">
                      {sign} {formatMoney(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              <MiniStat
                icon={Banknote}
                tone="success"
                label="Ventas en efectivo"
                value={formatMoney(s.cashSales)}
              />
              <MiniStat
                icon={CreditCard}
                label="Ventas con tarjeta"
                value={formatMoney(s.cardSales)}
                hint="Va al banco, no a la caja"
              />
              <MiniStat
                icon={ArrowLeftRight}
                label="Transferencias"
                value={formatMoney(s.transferSales)}
                hint="Va al banco, no a la caja"
              />
              <MiniStat
                icon={HandCoins}
                tone="warning"
                label="Ventas a crédito"
                value={formatMoney(s.creditSales)}
                hint="Pasan a Cuentas x cobrar"
              />
              <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 sm:col-span-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {"Total vendido en el turno"}
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {formatMoney(totalSales)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{"Facturas"}</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {s.invoices}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <SectionCard
            title="Movimientos del turno"
            icon={Wallet}
            actions={
              <Button
                variant="outline"
                size="sm"
                className="rounded-lg bg-card"
                disabled={disabled}
                onClick={() => changeDialog(setMoveOpen)(true)}
              >
                <Plus />
                {"Nuevo"}
              </Button>
            }
            bodyClassName="pt-3"
          >
            {sessionMoves.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="Sin movimientos"
                description="Entradas, salidas, cobros y pagos en efectivo aparecerán aquí."
              />
            ) : (
              <ul className="divide-y divide-border">
                {sessionMoves.map((m) => {
                  const ui = MOVE_UI[m.type];
                  const Icon = ui.icon;
                  return (
                    <li className="flex items-center gap-3 py-3" key={m.id}>
                      <div
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-xl",
                          ui.className,
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {m.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {ui.label}
                          {" · "}
                          {formatTime(m.date)}
                        </p>
                      </div>
                      <span className="font-semibold tabular-nums">
                        {ui.sign} {formatMoney(m.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </Fragment>
      )}
      <SectionCard
        title="Cierres anteriores"
        icon={History}
        bodyClassName="p-0 pt-4"
      >
        {closures.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">
            {"Sin cierres registrados."}
          </p>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">{"Cierre"}</th>
                <th className="px-3 py-2.5 font-medium">{"Cajero"}</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Ventas"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Esperado"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Contado"}
                </th>
                <th className="px-5 py-2.5 text-right font-medium">
                  {"Diferencia"}
                </th>
              </tr>
            </thead>
            <tbody>
              {closures.map((c) => {
                const diff = (Math.round(c.counted * 100) - Math.round(c.expected * 100)) / 100;
                return (
                  <tr
                    className="border-b border-border last:border-0"
                    key={c.id}
                  >
                    <td className="px-5 py-3 font-medium">
                      {formatDateTime(c.closedAt)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {c.cashier}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMoney(c.sales)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {formatMoney(c.expected)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMoney(c.counted)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                          diff === 0
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : diff > 0
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              : "bg-accent text-primary",
                        )}
                      >
                        {diff === 0
                          ? "Cuadrada"
                          : `${diff > 0 ? "+" : "−"} ${formatMoney(Math.abs(diff))}`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </SectionCard>
      <CashCountDialog
        open={countOpen}
        onOpenChange={changeDialog(setCountOpen)}
        expected={s.expected}
        disabled={disabled}
        sending={sending === "close"}
        failure={failure?.kind === "close" ? failure : null}
        onRetry={retry}
        retryDisabled={!!sending || runtime?.busy}
        onConfirm={(counted) => submit("close", { counted })}
      />
      <CashMovementDialog
        open={moveOpen}
        onOpenChange={changeDialog(setMoveOpen)}
        disabled={disabled}
        sending={sending === "movement"}
        failure={failure?.kind === "movement" ? failure : null}
        onRetry={retry}
        retryDisabled={!!sending || runtime?.busy}
        onConfirm={(type, amount, description) => submit("movement", { type, amount, description })}
      />
    </div>
  );
}
export { CashRegisterPage };
