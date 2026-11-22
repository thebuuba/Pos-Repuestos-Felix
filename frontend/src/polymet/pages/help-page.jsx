// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Wallet } from "lucide-react";
import { ShoppingCart } from "lucide-react";
import { PackagePlus } from "lucide-react";
import { HandCoins } from "lucide-react";
import { Box } from "lucide-react";
import { PageHeader } from "../components/page-header.jsx";
import { Link } from "react-router-dom";
import { SectionCard } from "../components/section-card.jsx";
import { LifeBuoy } from "lucide-react";
import { Accordion2 } from "../../components/ui/accordion.jsx";
import { AccordionItem2 } from "../../components/ui/accordion.jsx";
import { AccordionTrigger2 } from "../../components/ui/accordion.jsx";
import { AccordionContent2 } from "../../components/ui/accordion.jsx";
import { Keyboard } from "lucide-react";
import { Button } from "../../components/ui/button.jsx";
import { MessageCircle } from "lucide-react";
import { Phone } from "lucide-react";
import { usePosStore } from "../../data/pos-context.jsx";
const GUIDES = [
  {
    icon: Wallet,
    title: "1. Abre la caja",
    operationalTitle: "1. Consulta la caja",
    text: "Consulta la disponibilidad del control de efectivo.",
    to: "/caja",
  },
  {
    icon: ShoppingCart,
    title: "2. Factura",
    text: "Busca un artículo y registra la factura.",
    to: "/ventas",
  },
  {
    icon: PackagePlus,
    title: "3. Sube compras",
    text: "La mercancía suma al inventario con sus precios.",
    to: "/compras",
  },
  {
    icon: HandCoins,
    title: "4. Cobra créditos",
    operationalTitle: "4. Revisa créditos",
    text: "Consulta el saldo pendiente de cada cliente.",
    to: "/cuentas-por-cobrar",
  },
  {
    icon: Box,
    title: "5. Revisa inventario",
    text: "Atiende los artículos bajo el mínimo.",
    to: "/inventario",
  },
  {
    icon: Wallet,
    title: "6. Cierra la caja",
    operationalTitle: "6. Revisa los cierres",
    text: "Consulta la disponibilidad de los cierres de turno.",
    to: "/caja",
  },
];
var SHORTCUTS = [
  ["F9", "Guardar e imprimir factura"],
  ["Enter", "Agregar el producto buscado"],
  ["↑ ↓", "Moverse entre resultados de búsqueda"],
  ["Esc", "Cerrar búsqueda o ventana"],
  ["Ctrl K", "Búsqueda general"],
];
var FAQ = [
  {
    q: "¿Cómo se calculan los precios P1, P2 y P3?",
    a: "En Compras, el factor de costo y los porcentajes de la fórmula determinan los tres precios. Revisa el costo y los precios antes de confirmar la factura. Las fórmulas se editan en Configuración.",
  },
  {
    q: "¿Qué comprobante uso?",
    a: "Selecciona el tipo de documento en Punto de venta. El registro de la venta conserva su tipo. La emisión de una secuencia fiscal autorizada requiere configuración adicional.",
  },
  {
    q: "¿Cómo vendo a crédito?",
    a: "Selecciona el cliente y la condición Crédito. Una venta confirmada suma al saldo del cliente. Consulta ese saldo en Cuentas x cobrar.",
  },
  {
    q: "Me equivoqué en una factura, ¿qué hago?",
    a: "Busca el registro en Reportes y verifica los artículos e importes. La anulación de facturas todavía no está habilitada.",
  },
  {
    q: "¿Por qué la caja no cuadra?",
    a: "La apertura, los movimientos y el cierre de efectivo están pendientes de habilitación. En Reportes puedes consultar las ventas registradas por condición.",
  },
  {
    q: "¿Puedo vender un artículo sin existencia?",
    a: "El sistema comprueba las existencias al confirmar cada venta. Revisa la cantidad disponible en Inventario.",
  },
];
function HelpPage({ reference }) {
  const { settings } = usePosStore();
  const phone = reference?.phone ?? settings.business.phone;
  const digits = phone?.replace(/[^0-9+]/g, "") ?? "";
  const canCall = /^\+?\d{7,15}$/.test(digits);
  const shortcuts = reference ? SHORTCUTS : SHORTCUTS.filter(([key]) => key !== "Ctrl K");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Centro de ayuda"
        description="Guía rápida, atajos y preguntas frecuentes."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {GUIDES.map((g, index) => {
          const Icon = g.icon;
          return (
            <Link
              to={g.to}
              className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              key={g.title}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <div>
                <p className="font-semibold group-hover:text-primary">
                  {reference ? g.title : g.operationalTitle ?? g.title}
                </p>
                <p className="text-sm text-muted-foreground">{reference?.guides[index] ?? g.text}</p>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <SectionCard
          title="Preguntas frecuentes"
          icon={LifeBuoy}
          bodyClassName="pt-2"
        >
          <Accordion2 type="single" collapsible={true} className="w-full">
            {FAQ.map((f, index) => (
              <AccordionItem2 value={f.q} key={f.q}>
                <AccordionTrigger2 className="text-left text-sm font-medium hover:no-underline">
                  {f.q}
                </AccordionTrigger2>
                <AccordionContent2 className="text-sm leading-relaxed text-muted-foreground">
                  {reference?.answers[index] ?? f.a}
                </AccordionContent2>
              </AccordionItem2>
            ))}
          </Accordion2>
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Atajos de teclado" icon={Keyboard}>
            <ul className="space-y-2.5">
              {shortcuts.map(([key, label]) => (
                <li
                  className="flex items-center justify-between gap-3 text-sm"
                  key={key}
                >
                  <span className="text-muted-foreground">{key === "F9" && !reference ? "Registrar la venta" : label}</span>
                  <kbd className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs">
                    {key}
                  </kbd>
                </li>
              ))}
            </ul>
          </SectionCard>
          <div className="relative overflow-hidden rounded-2xl bg-foreground p-5 text-background">
            <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/50 blur-2xl" />
            <p className="relative text-lg font-semibold">
              {"¿Necesitas ayuda?"}
            </p>
            <p className="relative mt-1 text-sm text-background/70">
              {reference?.hours ?? (canCall ? "Teléfono de contacto del negocio." : "Configura el teléfono del negocio en Configuración.")}
            </p>
            <div className="relative mt-4 grid gap-2">
              {reference?.whatsapp && <Button asChild={true} className="rounded-xl">
                <a
                  href={reference.whatsapp}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle />
                  {"Escribir por WhatsApp"}
                </a>
              </Button>}
              {canCall && <Button
                asChild={true}
                variant="outline"
                className="rounded-xl border-background/20 bg-transparent text-background hover:bg-background/10 hover:text-background"
              >
                <a href={`tel:${digits}`}>
                  <Phone />
                  {phone}
                </a>
              </Button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
export { HelpPage };
