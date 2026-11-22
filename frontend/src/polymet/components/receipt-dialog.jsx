// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Dialog2 } from "../../components/ui/dialog.jsx";
import { DialogContent2 } from "../../components/ui/dialog.jsx";
import { DialogHeader } from "../../components/ui/dialog.jsx";
import { CircleCheck } from "lucide-react";
import { DialogTitle2 } from "../../components/ui/dialog.jsx";
import { DialogDescription2 } from "../../components/ui/dialog.jsx";
import { formatMoney, formatUnitMoney } from "../lib/format.js";
import { Button } from "../../components/ui/button.jsx";
import { Printer } from "lucide-react";
import { Fragment } from "react";
import "./receipt-print.css";
var dateFmt2 = new Intl.DateTimeFormat("es-DO", {
  timeZone: "America/Santo_Domingo",
  dateStyle: "short",
  timeStyle: "short",
});
function ReceiptDialog({
  sale,
  open,
  onOpenChange,
  onNewSale,
  business,
  printFormat = "Térmica 80 mm",
  footer = "¡Gracias por su compra!",
  title = "Venta registrada",
}) {
  return (
    <Dialog2 open={open} onOpenChange={onOpenChange}>
      <DialogContent2 data-print-format={printFormat} className="pos-receipt-dialog max-w-md gap-0 rounded-2xl p-0">
        <DialogHeader className="items-center space-y-2 px-6 pb-4 pt-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10">
            <CircleCheck className="h-6 w-6 text-emerald-600" />
          </div>
          <DialogTitle2 className="text-lg">{sale?.localReference ? "Venta guardada en este equipo" : title}</DialogTitle2>
          <DialogDescription2>
            {sale?.localReference ? "Registro local durable. Consulta las operaciones locales para verificar su confirmación en el servidor."
              : <>La factura {sale?.invoiceNumber} se guardó correctamente.</>}
          </DialogDescription2>
        </DialogHeader>
        {sale && (
          <div className="pos-receipt-document mx-6 max-h-[46vh] overflow-y-auto rounded-xl border border-dashed border-border bg-muted/40 p-4 font-mono text-xs">
            <div className="text-center">
              <p className="text-sm font-bold uppercase">{business.name}</p>
              {business.rnc && <p className="text-muted-foreground">
                {"RNC "}
                {business.rnc}
              </p>}
              <p className="text-muted-foreground">{business.address}</p>
              {business.phone && <p className="text-muted-foreground">
                {"Tel. "}
                {business.phone}
              </p>}
            </div>
            <div className="my-3 border-t border-dashed border-border" />
            <div className="space-y-0.5">
              <div className="flex justify-between">
                <span>{"Factura"}</span>
                <span className="font-semibold">{sale.invoiceNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>{"Fecha"}</span>
                <span>{sale.dateOnly ? sale.dateOnly.split("-").reverse().join("/") : dateFmt2.format(sale.date)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>{"Cliente"}</span>
                <span className="truncate text-right">{sale.customerName}</span>
              </div>
              {sale.customerRnc && (
                <div className="flex justify-between">
                  <span>{"RNC"}</span>
                  <span>{sale.customerRnc}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>{"Comprobante"}</span>
                <span>
                  {sale.comprobante}
                  {" · "}
                  {sale.conditionLabel}
                </span>
              </div>
              {sale.ncf && (
                <div className="flex justify-between">
                  <span>{"NCF"}</span>
                  <span className="font-semibold">{sale.ncf}</span>
                </div>
              )}
              {sale.dateOnly && !sale.ncf && <p className="text-muted-foreground">Sin emisión de NCF</p>}
              {sale.localReference && <div className="space-y-1 pt-1">
                <p className="font-semibold">Guardado en este equipo. Confirmación del servidor por verificar.</p>
                <p style={{ overflowWrap: 'anywhere' }}>Referencia local: {sale.localReference}</p>
              </div>}
            </div>
            <div className="my-3 border-t border-dashed border-border" />
            <div className="space-y-2">
              {sale.lines.map((l) => (
                <div key={l.key}>
                  <p className="truncate">{l.product.name}</p>
                  <div className="flex justify-between text-muted-foreground">
                    <span>
                      {l.quantity}
                      {" x "}
                      {sale.dateOnly ? formatUnitMoney(l.unitPrice) : formatMoney(l.unitPrice, false)}
                    </span>
                    <span className="text-foreground">
                      {formatMoney(l.subtotal, false)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="my-3 border-t border-dashed border-border" />
            <div className="space-y-0.5">
              <div className="flex justify-between">
                <span>{"Subtotal"}</span>
                <span>{formatMoney(sale.totals.subtotal)}</span>
              </div>
              {sale.totals.discount > 0 && (
                <div className="flex justify-between">
                  <span>{"Descuento"}</span>
                  <span>
                    {"− "}
                    {formatMoney(sale.totals.discount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span>
                  {"ITBIS"}{sale.itbisRate !== null && " " + (sale.itbisRate ?? 18) + "%"}
                </span>
                <span>{formatMoney(sale.totals.itbis)}</span>
              </div>
              <div className="flex justify-between pt-1 text-sm font-bold">
                <span>{"TOTAL"}</span>
                <span>{formatMoney(sale.totals.total)}</span>
              </div>
              {sale.paymentLabel && <div className="flex justify-between pt-1">
                <span>{"Pago"}</span>
                <span>{sale.paymentLabel}</span>
              </div>}
              {sale.received !== undefined && (
                <Fragment>
                  <div className="flex justify-between">
                    <span>{"Recibido"}</span>
                    <span>{formatMoney(sale.received)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{"Cambio"}</span>
                    <span>
                      {formatMoney(sale.received - sale.totals.total)}
                    </span>
                  </div>
                </Fragment>
              )}
            </div>
            <p className="mt-4 text-center text-muted-foreground">{footer}</p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 p-6">
          <Button
            variant="outline"
            className="h-11 rounded-xl bg-card"
            onClick={() => window.print()}
          >
            <Printer />
            {sale?.dateOnly ? "Imprimir" : "Reimprimir"}
          </Button>
          <Button className="h-11 rounded-xl" onClick={onNewSale}>
            {"Nueva venta"}
          </Button>
        </div>
      </DialogContent2>
    </Dialog2>
  );
}
export { ReceiptDialog };
