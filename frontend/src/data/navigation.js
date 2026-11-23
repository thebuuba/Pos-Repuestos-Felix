// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { LayoutDashboard } from "lucide-react";
import { ShoppingCart } from "lucide-react";
import { Box } from "lucide-react";
import { ShoppingBag } from "lucide-react";
import { Wallet } from "lucide-react";
import { Users } from "lucide-react";
import { Truck } from "lucide-react";
import { ChartColumn } from "lucide-react";
import { HandCoins } from "lucide-react";
import { ReceiptText } from "lucide-react";
import { Settings } from "lucide-react";
import { CircleHelp } from "lucide-react";
var NAV_GROUPS = [
  {
    label: "Menú principal",
    items: [
      {
        label: "Panel",
        path: "/",
        icon: LayoutDashboard,
      },
      {
        label: "Punto de venta",
        path: "/ventas",
        icon: ShoppingCart,
        shortcut: "F1",
      },
      {
        label: "Inventario",
        path: "/inventario",
        icon: Box,
      },
      {
        label: "Compras",
        path: "/compras",
        icon: ShoppingBag,
      },
      {
        label: "Caja",
        path: "/caja",
        icon: Wallet,
      },
      {
        label: "Clientes",
        path: "/clientes",
        icon: Users,
      },
      {
        label: "Suplidores",
        path: "/suplidores",
        icon: Truck,
      },
      {
        label: "Reportes",
        path: "/reportes",
        icon: ChartColumn,
      },
    ],
  },
  {
    label: "Cuentas",
    items: [
      {
        label: "Cuentas x cobrar",
        path: "/cuentas-por-cobrar",
        icon: HandCoins,
        badge: "12",
      },
      {
        label: "Cuentas x pagar",
        path: "/cuentas-por-pagar",
        icon: ReceiptText,
        badge: "4",
      },
    ],
  },
  {
    label: "Otros",
    items: [
      {
        label: "Configuración",
        path: "/configuracion",
        icon: Settings,
      },
      {
        label: "Centro de ayuda",
        path: "/ayuda",
        icon: CircleHelp,
      },
    ],
  },
];
var ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
function findNavItem(pathname) {
  return ALL_NAV_ITEMS.find((item) =>
    item.path === "/" ? pathname === "/" : pathname.startsWith(item.path),
  );
}
export { NAV_GROUPS, findNavItem };
