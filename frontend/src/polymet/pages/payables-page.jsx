// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import { PageHeader } from "../components/page-header.jsx";
import { AccountsView } from "../components/accounts-view.jsx";
function PayablesPage() {
  const { runtime, payables, suppliers, payPayable } = usePosStore();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas x pagar"
        description={runtime ? "Consulta de obligaciones con suplidores y seguimiento de sus documentos." : "Facturas de compra a crédito con tus suplidores. Los pagos en efectivo salen de la caja."}
      />
      <AccountsView
        unavailable={!!runtime}
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
