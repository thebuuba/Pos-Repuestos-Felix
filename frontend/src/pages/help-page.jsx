// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Wallet } from "lucide-react";
import { ShoppingCart } from "lucide-react";
import { PackagePlus } from "lucide-react";
import { HandCoins } from "lucide-react";
import { Box } from "lucide-react";
import { PageHeader } from "../components/pos/page-header.jsx";
import { Link } from "react-router-dom";
import { SectionCard } from "../components/pos/section-card.jsx";
import { LifeBuoy } from "lucide-react";
import { Accordion } from "../components/ui/accordion.jsx";
import { AccordionItem } from "../components/ui/accordion.jsx";
import { AccordionTrigger } from "../components/ui/accordion.jsx";
import { AccordionContent } from "../components/ui/accordion.jsx";
import { Keyboard } from "lucide-react";
import { Button } from "../components/ui/button.jsx";
import { MessageCircle } from "lucide-react";
import { Phone } from "lucide-react";
import { usePosStore } from "../data/pos-context.jsx";
const GUIDES = [
  {
    icon: Wallet,
    title: "1. Abre la caja",
    text: "Registra el fondo inicial para cobrar en efectivo y llevar el cuadre del turno.",
    to: "/caja",
  },
  {
    icon: ShoppingCart,
    title: "2. Factura o cotiza",
    text: "Busca por código, código de barras o nombre; aplica descuentos, pon ventas en espera o imprime cotizaciones.",
    to: "/ventas",
  },
  {
    icon: PackagePlus,
    title: "3. Sube compras",
    text: "Registra facturas de contado o crédito; la mercancía suma al inventario con sus costos y precios.",
    to: "/compras",
  },
  {
    icon: HandCoins,
    title: "4. Cobra y paga créditos",
    text: "Registra abonos en Cuentas x cobrar y Cuentas x pagar; el efectivo se refleja en la caja abierta.",
    to: "/cuentas-por-cobrar",
  },
  {
    icon: Box,
    title: "5. Revisa inventario",
    text: "Atiende alertas de reposición y agrega códigos de barras alternativos a cada artículo.",
    to: "/inventario",
  },
  {
    icon: Wallet,
    title: "6. Cierra la caja",
    text: "Cuenta el efectivo al terminar el turno para verificar el cuadre y guardar el cierre.",
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
    q: "¿Cómo se calculan Costo, P/Mayor y Detalle en Compras?",
    a: "Cada suplidor puede tener su fórmula en cascada (P/Lista → Costo → P/Mayor → Detalle) en Configuración. En Compras, P/Lista calcula el Costo y muestra sugerencias encima de P/Mayor y Detalle sin sobrescribir tus precios.",
  },
  {
    q: "¿Qué comprobante uso y cómo activo los NCF?",
    a: "Selecciona B02 (Consumo), B01 (Crédito Fiscal con RNC) o B14 en Punto de venta. En Configuración → Comprobantes NCF el dueño puede registrar rangos reales autorizados por la DGII; los NCF solo se emiten cuando el rango está activo, vigente y conectado.",
  },
  {
    q: "¿Cómo vendo a crédito y registro abonos?",
    a: "Selecciona un cliente con crédito aprobado y la condición Crédito. La factura pasa a Cuentas x cobrar, donde puedes registrar abonos parciales o totales; los cobros en efectivo se reflejan automáticamente en la caja abierta.",
  },
  {
    q: "Me equivoqué en una factura, ¿qué hago?",
    a: "Con permiso de dueño, abre Reportes, busca la factura y pulsa el icono de anular indicando el motivo. La mercancía regresa al inventario y, si era a crédito sin abonos, se revierte la cuenta por cobrar.",
  },
  {
    q: "¿Cómo cuadra la caja al cierre del turno?",
    a: "Al abrir caja se parte del fondo inicial, sumando ventas y cobros en efectivo más entradas, y restando salidas y pagos en efectivo. Al cerrar, el sistema compara el conteo físico contra el efectivo esperado.",
  },
  {
    q: "¿Cómo uso códigos de barras alternativos, ventas en espera y cotizaciones?",
    a: "Puedes guardar varios códigos de barras por producto en Inventario y escanear cualquiera en Ventas. En Punto de venta también puedes pausar una venta con En espera para atender a otro cliente o generar una Cotización sin descontar inventario.",
  },
];
function HelpPage({ reference }) {
  const { settings, runtime } = usePosStore();
  const isOwner = !runtime || runtime.isOwner !== false;
  const phone = reference?.phone ?? settings.business.phone;
  const digits = phone?.replace(/[^0-9+]/g, "") ?? "";
  const canCall = /^\+?\d{7,15}$/.test(digits);
  const shortcuts = SHORTCUTS;
  const operationalShortcuts = !reference
    ? [
        ["F1", "Ir a Ventas / enfocar buscador"],
        ["F2", "Enfocar buscador de la pantalla"],
        ["F3", "Editar cantidad en el carrito"],
        ["F4", "Cambiar nivel de precio (Detalle ↔ Por mayor)"],
        ["F6", "Ventas en espera"],
        ["F7", "Cambiar método de pago"],
        ["F8", "Monto recibido (2.ª vez: Exacto)"],
        ["Enter / F9", isOwner ? "Registrar venta (o F9 en Compras)" : "Registrar la venta"],
        ["F10", "Generar cotización"],
        ["Alt+1…0", "Cambiar entre módulos"],
        ["Alt+N", "Nuevo artículo / cliente / venta"],
        ["Ctrl+Enter", "Guardar diálogo abierto"],
        ["Ctrl+K", "Búsqueda general y módulos"],
        ["Alt+A", "Centro de notificaciones"],
        ["Alt+H", "Ver todos los atajos"],
      ]
    : null;

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
          <Accordion type="single" collapsible={true} className="w-full">
            {FAQ.map((f, index) => (
              <AccordionItem value={f.q} key={f.q}>
                <AccordionTrigger className="text-left text-sm font-medium hover:no-underline">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  {reference?.answers[index] ?? f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Atajos de teclado" icon={Keyboard}>
            <ul className="space-y-2.5">
              {(operationalShortcuts ?? shortcuts).map(([key, label]) => (
                <li
                  className="flex items-center justify-between gap-3 text-sm"
                  key={key}
                >
                  <span className="text-muted-foreground">{label}</span>
                  <kbd className="shrink-0 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs">
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
