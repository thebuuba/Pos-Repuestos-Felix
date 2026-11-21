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
    cashSession,
    cashSummary: s,
    cashMovements,
    closures,
    openCash,
    closeCash,
    addCashMovement,
  } = usePosStore();
  const [opening, setOpening] = useState("5000");
  const [countOpen, setCountOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const sessionMoves = cashMovements.filter(
    (m) => m.date >= cashSession.openedAt,
  );
  const totalSales =
    s.cashSales + s.cardSales + s.transferSales + s.creditSales;
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
                onClick={() => setMoveOpen(true)}
              >
                <Plus />
                {"Entrada / salida"}
              </Button>
              <Button
                className="h-10 rounded-full px-5 shadow-md shadow-primary/20"
                onClick={() => setCountOpen(true)}
              >
                <Lock />
                {"Cerrar caja"}
              </Button>
            </Fragment>
          )
        }
      />
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
            <Input
              type="number"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              className="h-14 rounded-xl pl-14 text-center text-2xl font-semibold tabular-nums"
            />
          </div>
          <div className="mt-3 flex justify-center gap-2">
            {[2000, 3000, 5000, 1e4].map((a) => (
              <button
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
            className="mt-6 h-12 w-full rounded-xl text-[15px] font-semibold"
            onClick={() => {
              openCash(Number(opening) || 0);
              ue.success("Caja abierta", {
                description: `Fondo inicial ${formatMoney(Number(opening) || 0)}`,
              });
            }}
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
                onClick={() => setMoveOpen(true)}
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
                const diff = c.counted - c.expected;
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
                          Math.abs(diff) < 1
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : diff > 0
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              : "bg-accent text-primary",
                        )}
                      >
                        {Math.abs(diff) < 1
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
      </SectionCard>
      <CashCountDialog
        open={countOpen}
        onOpenChange={setCountOpen}
        expected={s.expected}
        onConfirm={(counted) => {
          const c = closeCash(counted);
          setCountOpen(false);
          const diff = c.counted - c.expected;
          ue.success("Caja cerrada", {
            description:
              Math.abs(diff) < 1
                ? "La caja cuadró perfectamente."
                : `${diff > 0 ? "Sobrante" : "Faltante"} de ${formatMoney(Math.abs(diff))}`,
          });
        }}
      />
      <CashMovementDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        onConfirm={(type, amount, description) => {
          addCashMovement(type, amount, description);
          setMoveOpen(false);
          ue.success(
            `${type === "entrada" ? "Entrada" : "Salida"} registrada`,
            {
              description: formatMoney(amount),
            },
          );
        }}
      />
    </div>
  );
}
export { CashRegisterPage };
