// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-store.jsx";
import { PageHeader } from "../components/page-header.jsx";
import { AccountsView } from "../components/accounts-view.jsx";
function PayablesPage() {
  const { payables, suppliers, payPayable } = usePosStore();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas x pagar"
        description="Facturas de compra a crédito con tus suplidores. Los pagos en efectivo salen de la caja."
      />
      <AccountsView
        docs={payables}
        parties={suppliers}
        partyLabel="Suplidor"
        verb="Pagar"
        onPay={payPayable}
      />
    </div>
  );
}
export { PayablesPage };
