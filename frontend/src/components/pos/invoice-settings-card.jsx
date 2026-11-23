// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { FileText } from "lucide-react";
import { Label } from "../ui/label.jsx";
import { Select } from "../ui/select.jsx";
import { SelectTrigger } from "../ui/select.jsx";
import { SelectValue } from "../ui/select.jsx";
import { SelectContent } from "../ui/select.jsx";
import { SelectItem } from "../ui/select.jsx";
import { COMPROBANTES } from "../../data/sales-options.js";
import { CONDITIONS } from "../../data/sales-options.js";
import { User } from "lucide-react";
import { formatMoney } from "../../lib/format.js";
import { CircleAlert } from "lucide-react";
import { Fragment, memo } from "react";
const InvoiceSettingsCard = memo(function InvoiceSettingsCard({
  operational = false,
  customers,
  customerId,
  onCustomerChange,
  comprobante,
  onComprobanteChange,
  condition,
  onConditionChange,
  nextNcf,
  ncfWarning = null,
}) {
  const customer = customers.find((c) => c.id === customerId);
  const needsRnc = comprobante !== "B02" && !customer?.rnc;
  const creditBlocked = condition === "credito" && !customer?.creditLimit;
  const available = customer ? customer.creditLimit - customer.balance : 0;
  return (
    <section className="sale-invoice-card rounded-2xl border border-border bg-card p-5">
      <div className="sale-invoice-header mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          <FileText className="h-4 w-4" />
        </div>
        <h2 className="text-base font-semibold">{"Datos de la factura"}</h2>
      </div>
      <div className="sale-invoice-fields grid gap-4 md:grid-cols-3">
        <div className="sale-invoice-customer min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">{"Cliente"}</Label>
          <Select value={customer ? String(customer.id) : ""} onValueChange={value => onCustomerChange(operational ? Number(value) : value)}>
            <SelectTrigger aria-label="Cliente" className="sale-invoice-trigger h-11 rounded-xl bg-card">
              <SelectValue placeholder="Selecciona un cliente" />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem value={String(c.id)} key={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sale-invoice-comprobante min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {"Tipo de comprobante"}
          </Label>
          <Select value={comprobante} onValueChange={onComprobanteChange}>
            <SelectTrigger aria-label="Tipo de comprobante" className="sale-invoice-trigger h-11 rounded-xl bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPROBANTES.filter(c => !operational || c.value !== "B15").map((c) => (
                <SelectItem value={c.value} key={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="sale-invoice-condition min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {"Condición"}
          </Label>
          <Select
            value={condition}
            onValueChange={(v) => onConditionChange(v)}
          >
            <SelectTrigger aria-label="Condición" className="sale-invoice-trigger h-11 rounded-xl bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONDITIONS.map((c) => (
                <SelectItem value={c.value} key={c.value}>
                  {operational && c.value === "credito" ? "Crédito" : c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="sale-invoice-meta mt-4 flex flex-wrap items-center gap-2 text-xs">
        {customer && !customer.isCashCustomer && customer.id !== "c-000" && (
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
        {operational && ncfWarning && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 font-medium text-amber-700 dark:text-amber-400">
            <CircleAlert className="h-3.5 w-3.5" />
            {ncfWarning}
          </span>
        )}
        {operational && !nextNcf && !ncfWarning && <span className="rounded-lg bg-muted px-2.5 py-1.5 text-muted-foreground">Sin emisión de NCF</span>}
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
});
export { InvoiceSettingsCard };
