// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { AGING_BUCKETS, agingBucket, agingSummary, balanceOf, bucketFromDays, daysOverdue, documentaryDate, formatDate } from "../../lib/accounts.js";
import { businessTodayIso } from "../../lib/dates.js";
import { MoneyDisplay } from "./money-display.jsx";
import { formatMoney } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { CircleCheck, History, Printer, Search } from "lucide-react";
import { Input } from "../ui/input.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.jsx";
import { Switch } from "../ui/switch.jsx";
import { EmptyState } from "./section-card.jsx";
import { Button } from "../ui/button.jsx";
import { PaymentDialog } from "./payment-dialog.jsx";
import { AccountPaymentsDialog, PaymentReceiptDialog } from "./account-payments-dialog.jsx";
import { toast as ue } from "sonner";
import { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 50;
var BUCKET_STYLE = {
  corriente: {
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
  "1-30": {
    bar: "bg-amber-400",
    dot: "bg-amber-400",
  },
  "31-60": {
    bar: "bg-orange-500",
    dot: "bg-orange-500",
  },
  "61-90": {
    bar: "bg-primary/70",
    dot: "bg-primary/70",
  },
  "90+": {
    bar: "bg-primary",
    dot: "bg-primary",
  },
};
function AccountsView({
  readOnly = false,
  unavailable = false,
  operational = false,
  cashOpen = true,
  docs,
  parties,
  partyLabel,
  verb,
  initialPartyId,
  initialBucket = "all",
  onPay,
  onViewDocument,
  business,
  printFormat = "Térmica 80 mm",
  ticketFooter = "¡Gracias por su pago!",
}) {
  const [partyId, setPartyId] = useState(initialPartyId ?? "all");
  const [bucket, setBucket] = useState(initialBucket ?? "all");
  const [query, setQuery] = useState("");
  const [showPaid, setShowPaid] = useState(false);
  const [paying, setPaying] = useState(null);
  const [historyDocId, setHistoryDocId] = useState(null);
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [page, setPage] = useState(1);
  const partyNames = useMemo(() => new Map(parties.map((p) => [p.id, p.name])), [parties]);
  const partyName = (id) => partyNames.get(id) ?? "—";
  const { open, aging, totalOpen, overdue } = useMemo(() => {
    const openDocs = docs.filter((d) => balanceOf(d) > 0);
    const ag = agingSummary(openDocs.filter((d) => d.dueDate));
    const total = openDocs.reduce((s, d) => s + balanceOf(d), 0);
    const ov = Object.values(ag).reduce((s, v) => s + v, 0) - ag.corriente;
    return { open: openDocs, aging: ag, totalOpen: total, overdue: ov };
  }, [docs]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = new Date();
    const todayDate = documentaryDate(businessTodayIso(now));
    return docs
      .filter((d) => showPaid || balanceOf(d) > 0)
      .filter((d) => partyId === "all" || String(d.partyId) === partyId)
      .filter(
        (d) =>
          bucket === "all" ||
          (bucket === "overdue"
            ? d.dueDate && balanceOf(d) > 0 && daysOverdue(d, now, todayDate) > 0
            : d.dueDate && balanceOf(d) > 0 && agingBucket(d, now, todayDate) === bucket),
      )
      .filter(
        (d) =>
          !q ||
          d.document.toLowerCase().includes(q) ||
          (partyNames.get(d.partyId) ?? "—").toLowerCase().includes(q),
      )
      .sort((a, b) => (a.dueDate ?? a.date).localeCompare(b.dueDate ?? b.date));
  }, [docs, showPaid, partyId, bucket, query, partyNames]);
  useEffect(() => { setPage(1); }, [query, partyId, bucket, showPaid]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage],
  );
  const filteredBalance = useMemo(() => rows.reduce((s, d) => s + balanceOf(d), 0), [rows]);
  const activePaying = paying ? (docs.find((d) => d.id === paying.id) ?? paying) : null;
  const activeHistoryDoc = historyDocId != null ? (docs.find((d) => d.id === historyDocId) ?? null) : null;
  const renderNow = new Date();
  const renderToday = documentaryDate(businessTodayIso(renderNow));
  return (
    <div className="space-y-6">
      {(readOnly || unavailable) && <p role="status" className="rounded-xl border border-border bg-card p-4 text-sm">{unavailable ? "Los saldos de suplidores están pendientes de conciliación con los históricos importados." : "Consulta de ventas a crédito. El registro de abonos y los vencimientos están pendientes de habilitación."}</p>}
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-2xl bg-primary p-5 text-primary-foreground">
          <p className="text-sm text-primary-foreground/80">
            {readOnly ? "Ventas a crédito del sistema" : "Balance pendiente"}
          </p>
          {unavailable ? <p className="mt-1 text-3xl">Pendiente</p> : <MoneyDisplay
            value={totalOpen}
            className="mt-1 text-[34px] leading-tight"
            symbolClassName="text-primary-foreground/70"
            centsClassName="text-primary-foreground/55"
          />}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-primary-foreground/20 pt-4 text-sm">
            <div>
              <p className="text-xs text-primary-foreground/70">{"Vencido"}</p>
              <p className="font-semibold tabular-nums">
                {unavailable || readOnly ? "Sin vencimientos confirmados" : formatMoney(overdue)}
              </p>
            </div>
            <div>
              <p className="text-xs text-primary-foreground/70">
                {"Documentos"}
              </p>
              <p className="font-semibold tabular-nums">{open.length}</p>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-medium">{"Antigüedad de saldos"}</p>
            {bucket !== "all" && (
              <button
                type="button"
                onClick={() => setBucket("all")}
                className="text-xs font-medium text-primary"
              >
                {bucket === "overdue" ? "Solo vencidas · Quitar filtro" : "Quitar filtro"}
              </button>
            )}
          </div>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted">
            {AGING_BUCKETS.map((b) =>
              aging[b.key] > 0 ? (
                <div
                  className={BUCKET_STYLE[b.key].bar}
                  style={{
                    width: `${(aging[b.key] / (totalOpen || 1)) * 100}%`,
                  }}
                  key={b.key}
                />
              ) : null,
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {AGING_BUCKETS.map((b) => (
              <button
                type="button"
                onClick={() => setBucket(bucket === b.key ? "all" : b.key)}
                disabled={readOnly || unavailable}
                className={cn(
                  "rounded-xl border p-2.5 text-left transition-colors",
                  bucket === b.key
                    ? "border-foreground bg-muted"
                    : "border-border hover:bg-muted/50",
                )}
                key={b.key}
              >
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      BUCKET_STYLE[b.key].dot,
                    )}
                  />
                  {b.label}
                </span>
                <span className="mt-1 block text-sm font-semibold tabular-nums">
                  {readOnly || unavailable ? "—" : formatMoney(aging[b.key])}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 p-5 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-shortcut-search="true"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar documento o ${partyLabel.toLowerCase()}…`}
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <Select value={partyId} onValueChange={setPartyId}>
            <SelectTrigger className="h-10 rounded-xl md:w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {"Todos los "}
                {partyLabel.toLowerCase() === "suplidor" ? "suplidores" : `${partyLabel.toLowerCase()}s`}
              </SelectItem>
              {parties.map((p) => (
                <SelectItem value={String(p.id)} key={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showPaid} onCheckedChange={setShowPaid} />
            {"Ver saldadas"}
          </label>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title={unavailable ? "Conciliación pendiente" : readOnly ? "Sin ventas a crédito registradas" : "Todo al día"}
            description={unavailable ? "Los históricos se conservan. Todavía no hay un saldo conciliado para mostrar." : readOnly ? "Los saldos de apertura se consultan en Clientes. Esta tabla muestra las ventas a crédito del sistema nuevo." : "No hay documentos pendientes con estos filtros."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-y border-border bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">{"Documento"}</th>
                  <th className="px-3 py-2.5 font-medium">{partyLabel}</th>
                  <th className="px-3 py-2.5 font-medium">{"Vence"}</th>
                  <th className="px-3 py-2.5 font-medium">{"Estado"}</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {"Monto"}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {"Abonado"}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {"Balance"}
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((d) => {
                  const bal = balanceOf(d);
                  const days = d.dueDate ? daysOverdue(d, renderNow, renderToday) : 0;
                  const b = bucketFromDays(days);
                  return (
                    <tr
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                      key={d.id}
                    >
                      <td className="px-5 py-3">
                        {onViewDocument ? (
                          <button
                            type="button"
                            className="text-left hover:underline"
                            onClick={() => onViewDocument(d)}
                          >
                            <p className="font-medium">{d.document}</p>
                            <p className="text-xs text-muted-foreground">
                              {"Emitida "}
                              {formatDate(d.date)}
                            </p>
                          </button>
                        ) : (
                          <>
                            <p className="font-medium">{d.document}</p>
                            <p className="text-xs text-muted-foreground">
                              {"Emitida "}
                              {formatDate(d.date)}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-3">
                        {partyName(d.partyId)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {d.dueDate ? formatDate(d.dueDate) : "Sin vencimiento registrado"}
                      </td>
                      <td className="px-3 py-3">
                        {bal === 0 ? (
                          <span className="rounded-full border border-emerald-600/40 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                            {"Saldada"}
                          </span>
                        ) : !d.dueDate ? (
                          <span className="text-xs text-muted-foreground">{"Pendiente"}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full",
                                BUCKET_STYLE[b].dot,
                              )}
                            />
                            {days === 0
                              ? "Vence hoy"
                              : days < 0
                                ? `Vence en ${Math.abs(days)} ${Math.abs(days) === 1 ? "día" : "días"}`
                                : `${days} ${days === 1 ? "día vencida" : "días vencida"}`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {formatMoney(d.amount)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {(d.payments?.length ?? 0) > 0 ? (
                          <button
                            type="button"
                            className="inline-flex flex-col items-end text-right hover:text-foreground hover:underline"
                            onClick={() => setHistoryDocId(d.id)}
                            title={`Ver historial de abonos de ${d.document}`}
                          >
                            <span className="font-medium text-foreground">{formatMoney(d.paid)}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {d.payments.length} {d.payments.length === 1 ? "abono" : "abonos"}
                            </span>
                          </button>
                        ) : (
                          formatMoney(d.paid)
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">
                        {formatMoney(bal)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {(d.payments?.length ?? 0) > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => setHistoryDocId(d.id)}
                              title={`Ver abonos de ${d.document}`}
                              aria-label={`Ver abonos de ${d.document}`}
                            >
                              <History className="h-4 w-4" />
                            </Button>
                          )}
                          {onViewDocument && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => onViewDocument(d)}
                              title={verb === "Cobrar" ? `Reimprimir ${d.document}` : `Ver factura ${d.document}`}
                              aria-label={verb === "Cobrar" ? `Reimprimir ${d.document}` : `Ver factura ${d.document}`}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                          )}
                          {bal > 0 && (
                            <Button
                              size="sm"
                              className="rounded-lg"
                              disabled={readOnly || unavailable}
                              onClick={() => setPaying(d)}
                            >
                              {verb}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span>
            {rows.length}
            {" documentos"}
            {totalPages > 1 ? ` · Página ${safePage} de ${totalPages}` : ""}
          </span>
          <div className="flex items-center gap-3">
            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg px-2 text-xs" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  {"Anterior"}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg px-2 text-xs" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  {"Siguiente"}
                </Button>
              </div>
            )}
            <span>
              {"Balance filtrado: "}
              <span className="font-semibold text-foreground">
                {unavailable ? "Pendiente" : formatMoney(filteredBalance)}
              </span>
            </span>
          </div>
        </div>
      </section>
      <PaymentDialog
        doc={activePaying}
        partyName={activePaying ? partyName(activePaying.partyId) : ""}
        verb={verb}
        operational={operational}
        cashOpen={cashOpen}
        onOpenChange={(o) => !o && setPaying(null)}
        onConfirm={async (amount, method, note, retryAction, recordedPreviousBalance) => {
          if (!activePaying) return;
          const previousBalance = recordedPreviousBalance ?? balanceOf(activePaying);
          const remainingAfter = Math.max(0, Math.round((previousBalance - amount) * 100) / 100);
          const confirmedParty = partyName(activePaying.partyId);
          const receiptData = {
            verb,
            partyLabel,
            partyName: confirmedParty,
            document: activePaying.document,
            date: new Date().toISOString(),
            method,
            note: note || "",
            amount,
            docAmount: activePaying.amount,
            previousBalance,
            remainingAfter,
          };
          if (retryAction) await retryAction();
          else await onPay(activePaying, amount, method, note);
          ue.success(
            verb === "Cobrar" ? "Cobro registrado" : "Pago registrado",
            {
              description: `${activePaying.document} · ${formatMoney(amount)}${method === "efectivo" ? " · reflejado en caja" : ""}`,
              action: {
                label: "Ver recibo",
                onClick: () => setPaymentReceipt(receiptData),
              },
            },
          );
          setPaying(null);
        }}
      />
      <AccountPaymentsDialog
        doc={activeHistoryDoc}
        partyName={activeHistoryDoc ? partyName(activeHistoryDoc.partyId) : ""}
        partyLabel={partyLabel}
        verb={verb}
        open={Boolean(activeHistoryDoc)}
        onOpenChange={(open) => { if (!open) setHistoryDocId(null); }}
        onPrintPayment={(payment) => {
          if (!activeHistoryDoc) return;
          const doc = activeHistoryDoc;
          setHistoryDocId(null);
          setPaymentReceipt({
            verb,
            partyLabel,
            partyName: partyName(doc.partyId),
            document: doc.document,
            paymentId: payment.id ?? null,
            date: payment.date,
            method: payment.method,
            note: [payment.reference, payment.note].filter(Boolean).join(" · "),
            amount: payment.amount,
            docAmount: doc.amount,
            previousBalance: payment.previousBalance,
            remainingAfter: payment.remainingAfter,
          });
        }}
      />
      <PaymentReceiptDialog
        receipt={paymentReceipt}
        business={business}
        printFormat={printFormat}
        footer={ticketFooter}
        open={Boolean(paymentReceipt)}
        onOpenChange={(open) => { if (!open) setPaymentReceipt(null); }}
      />
    </div>
  );
}
export { AccountsView };
