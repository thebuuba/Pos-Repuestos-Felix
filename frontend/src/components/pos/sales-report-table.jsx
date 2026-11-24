// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Search } from "lucide-react";
import { Input } from "../ui/input.jsx";
import { EmptyState } from "./section-card.jsx";
import { ReceiptText } from "lucide-react";
import { formatDateTime } from "../../lib/accounts.js";
import { formatMoney } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.jsx";
import { Ban, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog.jsx";
import { Field, inputClass } from "./form-field.jsx";
import { toast as ue } from "sonner";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { paymentLabel } from "../../lib/sales-analytics.js";
var STATUS_UI = {
  pagada: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  pendiente: "border-foreground/50 text-foreground",
  anulada: "border-primary/50 text-primary line-through",
};
function SalesReportTable({ sales, allSales, onVoid, onReprint, operational = false }) {
  const [params] = useSearchParams();
  const urlQuery = params.get("buscar") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [limit, setLimit] = useState(15);
  useEffect(() => {
    if (urlQuery) { setQuery(urlQuery); setLimit(15); }
  }, [urlQuery]);
  const [toVoid, setToVoid] = useState(null);
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState(null);
  const [voidRetry, setVoidRetry] = useState(null);
  const q = query.trim().toLowerCase();
  const source = q && Array.isArray(allSales) ? allSales : sales;
  const filtered = source.filter(
    (s) =>
      !q ||
      s.number.toLowerCase().includes(q) ||
      s.customerName.toLowerCase().includes(q) ||
      s.ncf?.toLowerCase().includes(q),
  );
  const rows = filtered.slice(0, limit);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{"Facturas del período"}</h2>
          <p className="text-xs text-muted-foreground">
            {onReprint && onVoid
              ? "Haz clic en una factura para verla o reimprimirla. Al anular, la mercancía vuelve al inventario."
              : onReprint
                ? "Haz clic en una factura para verla o reimprimirla. Busca por número, NCF o cliente."
                : onVoid
                  ? "Busca y anula facturas. Al anular, la mercancía vuelve al inventario."
                  : "Busca por número de registro, NCF o cliente. La anulación no está habilitada."}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            aria-label="Buscar facturas"
            onChange={(e) => { setQuery(e.target.value); setLimit(15); }}
            placeholder="Factura, NCF o cliente…"
            className="h-10 rounded-xl pl-9"
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Sin facturas" />
      ) : (
        <>
          <div className="grid gap-3 border-t border-border p-4 lg:hidden">
            {rows.map((s) => (
              <article
                key={s.id}
                onClick={onReprint ? () => onReprint(s) : undefined}
                className={cn(
                  "space-y-3 rounded-2xl border border-border bg-card p-4",
                  onReprint && "cursor-pointer transition-colors hover:bg-muted/30",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{s.number}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {s.ncf ?? s.comprobante}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize",
                      STATUS_UI[s.status],
                    )}
                    title={s.voidReason || undefined}
                  >
                    {s.status ?? "Registrada"}
                  </span>
                </div>
                <div className="space-y-0.5 text-xs">
                  <p className="truncate text-sm font-medium text-foreground">{s.customerName}</p>
                  <p className="text-muted-foreground">
                    {formatDateTime(s.date)}
                    {" · "}
                    {paymentLabel(s)}
                  </p>
                  {s.status === "anulada" && s.voidReason && (
                    <p className="text-[11px] text-muted-foreground">{`Motivo: ${s.voidReason}`}</p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs tabular-nums">
                  <span className="text-muted-foreground">
                    {"ITBIS "}
                    {formatMoney(s.itbis)}
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {formatMoney(s.total)}
                  </span>
                </div>
                {(onReprint || (onVoid && s.status !== "anulada")) && (
                  <div className="flex gap-2 pt-0.5">
                    {onReprint && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 flex-1 rounded-xl text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReprint(s);
                        }}
                        aria-label={`Reimprimir ${s.number}`}
                      >
                        <Printer className="h-3.5 w-3.5" />
                        <span>{"Imprimir"}</span>
                      </Button>
                    )}
                    {onVoid && s.status !== "anulada" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 flex-1 rounded-xl text-xs hover:bg-accent hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setToVoid(s);
                          setReason("");
                          setVoidError(null);
                        }}
                        aria-label="Anular"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        <span>{"Anular"}</span>
                      </Button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">{"Factura"}</th>
                <th className="px-3 py-2.5 font-medium">{"Fecha"}</th>
                <th className="px-3 py-2.5 font-medium">{"Cliente"}</th>
                <th className="px-3 py-2.5 font-medium">{"Pago"}</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"ITBIS"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Total"}
                </th>
                <th className="px-3 py-2.5 font-medium">{"Estado"}</th>
                <th className="w-24 px-5 py-2.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  className={cn(
                    "border-b border-border last:border-0 hover:bg-muted/30",
                    onReprint && "cursor-pointer",
                  )}
                  onClick={onReprint ? () => onReprint(s) : undefined}
                  key={s.id}
                >
                  <td className="px-5 py-3">
                    <p className="font-medium">{s.number}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {s.ncf ?? s.comprobante}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDateTime(s.date)}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-3">
                    {s.customerName}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {paymentLabel(s)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                    {formatMoney(s.itbis)}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">
                    {formatMoney(s.total)}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize",
                        STATUS_UI[s.status],
                      )}
                      title={s.voidReason || undefined}
                    >
                      {s.status ?? "Registrada"}
                    </span>
                    {s.status === "anulada" && s.voidReason && (
                      <p className="mt-1 max-w-[180px] truncate text-[11px] text-muted-foreground">
                        {s.voidReason}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1">
                      {onReprint && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            onReprint(s);
                          }}
                          title={`Reimprimir ${s.number}`}
                          aria-label={`Reimprimir ${s.number}`}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                      )}
                      {onVoid && s.status !== "anulada" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setToVoid(s);
                            setReason("");
                            setVoidError(null);
                          }}
                          title="Anular"
                          aria-label="Anular"
                        >
                          <Ban />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
      <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <span>
          {"Mostrando "}
          {rows.length}
          {" de "}
          {filtered.length}
        </span>
        {filtered.length > limit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLimit((l) => l + 15)}
          >
            {"Ver más"}
          </Button>
        )}
      </div>
      <Dialog
        open={Boolean(toVoid)}
        onOpenChange={(o) => {
          if (!o && !voiding) {
            setToVoid(null);
            setReason("");
            setVoidError(null);
            setVoidRetry(null);
          }
        }}
      >
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{`¿Anular la factura ${toVoid?.number ?? ""}?`}</DialogTitle>
            <DialogDescription>
              {"La mercancía regresará al inventario y, si era a crédito, se revierte la cuenta por cobrar."}
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Motivo de anulación"
            htmlFor="void-sale-reason"
            hint="Se guarda en el historial de la factura."
          >
            <Input
              id="void-sale-reason"
              value={reason}
              disabled={voiding || Boolean(voidRetry)}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. Error en artículo o precio"
              className={inputClass}
              autoFocus
            />
          </Field>
          {voidError && (
            <p role="alert" className="text-sm text-primary">
              {voidError}
            </p>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={voiding}
              onClick={() => {
                setToVoid(null);
                setReason("");
                setVoidError(null);
                setVoidRetry(null);
              }}
            >
              {"Cancelar"}
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={voiding || (!voidRetry && operational && !reason.trim())}
              onClick={async () => {
                if (!toVoid || voiding) return;
                if (!voidRetry && operational && !reason.trim()) {
                  setVoidError("Indica el motivo de la anulación.");
                  return;
                }
                setVoiding(true);
                setVoidError(null);
                try {
                  if (voidRetry) await voidRetry();
                  else await onVoid(toVoid, reason.trim() || "Anulada por el usuario");
                  ue.success(`Factura ${toVoid.number} anulada`);
                  setToVoid(null);
                  setReason("");
                  setVoidRetry(null);
                } catch (cause) {
                  setVoidError(cause?.message || "No se pudo anular la factura.");
                  if (cause?.uncertain && typeof cause.retry === "function") {
                    setVoidRetry(() => cause.retry);
                  } else if (cause?.definitive) {
                    setVoidRetry(null);
                  }
                } finally {
                  setVoiding(false);
                }
              }}
            >
              {voiding ? "Anulando…" : voidRetry ? "Reintentar anulación" : "Anular factura"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
export { SalesReportTable };
