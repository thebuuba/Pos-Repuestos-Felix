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
var GUIDES = [
  {
    icon: Wallet,
    title: "1. Abre la caja",
    text: "Cada mañana indica el fondo inicial.",
    to: "/caja",
  },
  {
    icon: ShoppingCart,
    title: "2. Factura",
    text: "Escanea o busca el código y cobra con F9.",
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
    text: "Abona a facturas pendientes de clientes.",
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
    text: "Cuenta el efectivo y compara con lo esperado.",
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
    a: "Al subir una compra, el costo de la factura se multiplica por el ajuste de la fórmula del suplidor (por ejemplo ×1.062) y a ese costo real se le suma el % de ganancia de cada precio. Puedes cambiar cualquier precio a mano antes de subir la factura, y editar las fórmulas en Configuración › Fórmulas de precios.",
  },
  {
    q: "¿Qué comprobante uso?",
    a: "B02 (consumo final) para clientes sin RNC. B01 (crédito fiscal) cuando una empresa lo pide; el cliente debe tener RNC registrado. B15 para instituciones del gobierno y B14 para régimen especial.",
  },
  {
    q: "¿Cómo vendo a crédito?",
    a: "Elige un cliente con límite de crédito y cambia la condición a Crédito. La factura pasa sola a Cuentas x cobrar con vencimiento a 30 días. El sistema no deja pasar el límite aprobado.",
  },
  {
    q: "Me equivoqué en una factura, ¿qué hago?",
    a: "Ve a Reportes › Facturas del período y anúlala. La mercancía regresa al inventario y, si era a crédito, se elimina la cuenta por cobrar. Luego factura de nuevo.",
  },
  {
    q: "¿Por qué la caja no cuadra?",
    a: "El efectivo esperado suma el fondo inicial, las ventas en efectivo, las entradas y los cobros en efectivo, y resta salidas y pagos en efectivo. Las ventas con tarjeta o transferencia no entran a la caja. Registra toda salida de dinero en Caja › Entrada / salida.",
  },
  {
    q: "¿Puedo vender un artículo sin existencia?",
    a: "Por defecto no. Si lo necesitas, actívalo en Configuración › Facturación › Permitir vender sin existencia.",
  },
];
function HelpPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Centro de ayuda"
        description="Guía rápida, atajos y preguntas frecuentes."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {GUIDES.map((g) => {
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
                  {g.title}
                </p>
                <p className="text-sm text-muted-foreground">{g.text}</p>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <SectionCard
          title="Preguntas frecuentes"
          icon={LifeBuoy}
          bodyClassName="pt-2"
        >
          <Accordion2 type="single" collapsible={true} className="w-full">
            {FAQ.map((f) => (
              <AccordionItem2 value={f.q} key={f.q}>
                <AccordionTrigger2 className="text-left text-sm font-medium hover:no-underline">
                  {f.q}
                </AccordionTrigger2>
                <AccordionContent2 className="text-sm leading-relaxed text-muted-foreground">
                  {f.a}
                </AccordionContent2>
              </AccordionItem2>
            ))}
          </Accordion2>
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Atajos de teclado" icon={Keyboard}>
            <ul className="space-y-2.5">
              {SHORTCUTS.map(([key, label]) => (
                <li
                  className="flex items-center justify-between gap-3 text-sm"
                  key={key}
                >
                  <span className="text-muted-foreground">{label}</span>
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
              {"Soporte de lunes a sábado, 8:00 a. m. – 6:00 p. m."}
            </p>
            <div className="relative mt-4 grid gap-2">
              <Button asChild={true} className="rounded-xl">
                <a
                  href="https://wa.me/18297823872"
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle />
                  {"Escribir por WhatsApp"}
                </a>
              </Button>
              <Button
                asChild={true}
                variant="outline"
                className="rounded-xl border-background/20 bg-transparent text-background hover:bg-background/10 hover:text-background"
              >
                <a href="tel:8297823872">
                  <Phone />
                  {"829-782-3872"}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
export { HelpPage };
