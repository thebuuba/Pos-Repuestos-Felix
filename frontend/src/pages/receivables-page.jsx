// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePosStore } from "../data/pos-context.jsx";
import { PageHeader } from "../components/pos/page-header.jsx";
import { AccountsView } from "../components/pos/accounts-view.jsx";
import { ReceiptDialog } from "../components/pos/receipt-dialog.jsx";
import { receiptFromStoredSale } from "../data/operational-sales.js";
import { balanceOf } from "../lib/accounts.js";
import { formatMoney } from "../lib/format.js";
import { Button } from "../components/ui/button.jsx";
function ReceivablesPage() {
  const { runtime, sales, receivables, customers, settings, cashSession, payReceivable, recordReceivablePayment } = usePosStore();
  const [reprintSale, setReprintSale] = useState(null);
  const [params] = useSearchParams();
  const initial = params.get("cliente") ?? undefined;
  const openingSummary = useMemo(() => {
    if (!runtime) return { count: 0, total: 0 };
    const invoiceDebtByCustomer = new Map();
    for (const r of receivables) {
      invoiceDebtByCustomer.set(
        r.partyId,
        Math.round(((invoiceDebtByCustomer.get(r.partyId) ?? 0) + balanceOf(r)) * 100) / 100,
      );
    }
    let count = 0;
    let total = 0;
    for (const c of customers) {
      if (c.isCashCustomer) continue;
      const diff = Math.round(((c.balance ?? 0) - (invoiceDebtByCustomer.get(c.id) ?? 0)) * 100) / 100;
      if (diff > 0.005) {
        count += 1;
        total = Math.round((total + diff) * 100) / 100;
      }
    }
    return { count, total };
  }, [runtime, receivables, customers]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas x cobrar"
        description={
          runtime
            ? "Facturas a crédito de tus clientes. Los cobros en efectivo entran solos a la caja abierta; haz clic en Abonado para ver el historial y recibos."
            : "Facturas a crédito de tus clientes. Los cobros en efectivo entran solos a la caja."
        }
      />
      {openingSummary.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-3.5 text-sm">
          <div>
            <p className="font-medium text-foreground">
              {"Saldos históricos de apertura: "}
              <span className="font-semibold tabular-nums">{formatMoney(openingSummary.total)}</span>
              {` (${openingSummary.count} ${openingSummary.count === 1 ? "cliente" : "clientes"})`}
            </p>
            <p className="text-xs text-muted-foreground">
              {"Deudas previas importadas sin factura en este POS; suman en el límite de crédito y se consultan en Clientes."}
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="rounded-xl">
            <Link to="/clientes">{"Ver en Clientes"}</Link>
          </Button>
        </div>
      )}
      <AccountsView
        docs={receivables}
        parties={customers.filter((c) => (runtime ? !c.isCashCustomer : c.id !== "c-000"))}
        partyLabel="Cliente"
        verb="Cobrar"
        initialPartyId={initial}
        operational={Boolean(runtime)}
        cashOpen={Boolean(cashSession?.open)}
        business={settings.business}
        printFormat={settings.printFormat}
        ticketFooter={settings.ticketFooter}
        onViewDocument={(doc) => {
          const found = sales.find((s) => s.id === doc.id);
          if (found) setReprintSale(found);
        }}
        onPay={async (doc, amount, method, note) => {
          if (runtime) {
            await recordReceivablePayment({
              databaseId: doc.databaseId,
              saleId: doc.id,
              version: doc.version,
              amount,
              method,
              cashSessionId: method === "efectivo" ? cashSession?.id : undefined,
              note: note ?? "",
            });
          } else {
            await payReceivable(doc.id, amount, method, note);
          }
        }}
        key={initial ?? "all"}
      />
      <ReceiptDialog
        sale={receiptFromStoredSale(reprintSale)}
        open={Boolean(reprintSale)}
        onOpenChange={(open) => { if (!open) setReprintSale(null); }}
        onNewSale={() => setReprintSale(null)}
        business={settings.business}
        printFormat={settings.printFormat}
        footer={settings.ticketFooter}
        isReprint
      />
    </div>
  );
}
export { ReceivablesPage };
