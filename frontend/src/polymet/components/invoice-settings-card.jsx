// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { FileText } from "lucide-react";
import { Label3 } from "../../components/ui/label.jsx";
import { Select2 } from "../../components/ui/select.jsx";
import { SelectTrigger2 } from "../../components/ui/select.jsx";
import { SelectValue2 } from "../../components/ui/select.jsx";
import { SelectContent2 } from "../../components/ui/select.jsx";
import { SelectItem2 } from "../../components/ui/select.jsx";
import { COMPROBANTES } from "../data/pos-data.js";
import { CONDITIONS } from "../data/pos-data.js";
import { User } from "lucide-react";
import { formatMoney } from "../lib/format.js";
import { CircleAlert } from "lucide-react";
import { Fragment } from "react";
function InvoiceSettingsCard({
  customers,
  customerId,
  onCustomerChange,
  comprobante,
  onComprobanteChange,
  condition,
  onConditionChange,
  nextNcf,
}) {
  const customer = customers.find((c) => c.id === customerId);
  const needsRnc = comprobante !== "B02" && !customer?.rnc;
  const creditBlocked = condition === "credito" && !customer?.creditLimit;
  const available = customer ? customer.creditLimit - customer.balance : 0;
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-primary">
          <FileText className="h-4 w-4" />
        </div>
        <h2 className="text-base font-semibold">{"Datos de la factura"}</h2>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label3 className="text-xs text-muted-foreground">{"Cliente"}</Label3>
          <Select2 value={customerId} onValueChange={onCustomerChange}>
            <SelectTrigger2 className="h-11 rounded-xl bg-card">
              <SelectValue2 />
            </SelectTrigger2>
            <SelectContent2>
              {customers.map((c) => (
                <SelectItem2 value={c.id} key={c.id}>
                  {c.name}
                </SelectItem2>
              ))}
            </SelectContent2>
          </Select2>
        </div>
        <div className="space-y-1.5">
          <Label3 className="text-xs text-muted-foreground">
            {"Tipo de comprobante"}
          </Label3>
          <Select2 value={comprobante} onValueChange={onComprobanteChange}>
            <SelectTrigger2 className="h-11 rounded-xl bg-card">
              <SelectValue2 />
            </SelectTrigger2>
            <SelectContent2>
              {COMPROBANTES.map((c) => (
                <SelectItem2 value={c.value} key={c.value}>
                  {c.label}
                </SelectItem2>
              ))}
            </SelectContent2>
          </Select2>
        </div>
        <div className="space-y-1.5">
          <Label3 className="text-xs text-muted-foreground">
            {"Condición"}
          </Label3>
          <Select2
            value={condition}
            onValueChange={(v) => onConditionChange(v)}
          >
            <SelectTrigger2 className="h-11 rounded-xl bg-card">
              <SelectValue2 />
            </SelectTrigger2>
            <SelectContent2>
              {CONDITIONS.map((c) => (
                <SelectItem2 value={c.value} key={c.value}>
                  {c.label}
                </SelectItem2>
              ))}
            </SelectContent2>
          </Select2>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        {customer && customer.id !== "c-000" && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-muted-foreground">
            <User className="h-3.5 w-3.5" />
            {"RNC/Cédula:"}{" "}
            <span className="font-medium text-foreground">{customer.rnc}</span>
            {customer.creditLimit > 0 && (
              <Fragment>
                <span className="mx-1 text-border">{"|"}</span>
                {"Crédito disponible:"}{" "}
                <span className="font-medium text-foreground">
                  {formatMoney(available)}
                </span>
              </Fragment>
            )}
          </span>
        )}
        {needsRnc && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 font-medium text-amber-700 dark:text-amber-400">
            <CircleAlert className="h-3.5 w-3.5" />
            {"Este comprobante requiere un cliente con RNC"}
          </span>
        )}
        {creditBlocked && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 font-medium text-accent-foreground">
            <CircleAlert className="h-3.5 w-3.5" />
            {"Selecciona un cliente con crédito aprobado"}
          </span>
        )}
        {nextNcf && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-muted-foreground">
            {"NCF a asignar:"}
            <span className="font-mono font-semibold text-foreground">
              {nextNcf}
            </span>
          </span>
        )}
      </div>
    </section>
  );
}
export { InvoiceSettingsCard };
