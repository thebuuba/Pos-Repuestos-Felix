// Fuente única de atajos de teclado para escritorio (web, PWA y Windows).
// Protege AltGr en teclados en español (ctrlKey && altKey) y evita colisiones con
// el lector USB de códigos de barras y atajos reservados del navegador/Windows.

export const MODULE_SHORTCUTS = [
  {
    digit: "Digit1",
    shortcut: "Alt+1",
    label: "Panel",
    path: "/",
    keywords: "inicio dashboard resumen panel principal",
  },
  {
    digit: "Digit2",
    shortcut: "Alt+2",
    altShortcut: "F1",
    label: "Punto de venta",
    path: "/ventas",
    keywords: "pos facturar vender caja mostrador ventas",
  },
  {
    digit: "Digit3",
    shortcut: "Alt+3",
    label: "Inventario",
    path: "/inventario",
    keywords: "productos catalogo stock existencias articulos inventario",
  },
  {
    digit: "Digit4",
    shortcut: "Alt+4",
    label: "Compras",
    path: "/compras",
    ownerOnly: true,
    keywords: "entrada mercancia factura suplidor proveedor compras",
  },
  {
    digit: "Digit5",
    shortcut: "Alt+5",
    label: "Caja",
    path: "/caja",
    keywords: "turno cuadre efectivo abrir cerrar movimientos caja",
  },
  {
    digit: "Digit6",
    shortcut: "Alt+6",
    label: "Clientes",
    path: "/clientes",
    keywords: "rnc credito compradores clientes",
  },
  {
    digit: "Digit7",
    shortcut: "Alt+7",
    label: "Suplidores",
    path: "/suplidores",
    ownerOnly: true,
    keywords: "proveedores formulas suplidores",
  },
  {
    digit: "Digit8",
    shortcut: "Alt+8",
    label: "Reportes",
    path: "/reportes",
    ownerOnly: true,
    keywords: "facturas historial estadisticas informes reportes",
  },
  {
    digit: "Digit9",
    shortcut: "Alt+9",
    label: "Cuentas x cobrar",
    path: "/cuentas-por-cobrar",
    keywords: "cxc abonos fiado pendientes cobrar cuentas",
  },
  {
    digit: "Digit0",
    shortcut: "Alt+0",
    label: "Cuentas x pagar",
    path: "/cuentas-por-pagar",
    ownerOnly: true,
    keywords: "cxp suplidores deudas pagar cuentas",
  },
];

export const EXTRA_MODULES = [
  {
    label: "Configuración",
    path: "/configuracion",
    keywords: "ajustes empresa ncf usuarios formulas impresora cuenta configuracion",
  },
  {
    label: "Centro de ayuda",
    path: "/ayuda",
    keywords: "atajos teclado soporte manual guia preguntas ayuda",
  },
];

export const SHORTCUT_SECTIONS = [
  {
    id: "ventas",
    title: "Punto de venta",
    paths: ["/ventas"],
    items: [
      { keys: "F1", label: "Ir a Ventas o enfocar el buscador de productos" },
      { keys: "F2", label: "Enfocar búsqueda de producto" },
      { keys: "↑ ↓ · Enter", label: "Elegir resultado y agregarlo al carrito" },
      { keys: "F3", label: "Editar cantidad del último artículo (↑ ↓ cambia de fila, Enter vuelve al buscador)" },
      { keys: "Ctrl+Retroceso", label: "Quitar la fila activa desde la cantidad del carrito" },
      { keys: "F4", label: "Cambiar nivel de precio (P1 → P2 → P3)" },
      { keys: "F6", label: "Ventas en espera (pausar o retomar)" },
      { keys: "F7", label: "Cambiar método de pago (Efectivo / Tarjeta / Transfer.)" },
      { keys: "F8", label: "Enfocar Monto recibido (otra vez F8 o Alt+E llena Exacto; Enter cobra)" },
      { keys: "Enter / F9", label: "Registrar la venta (con buscador vacío, en Monto recibido o clic afuera)" },
      { keys: "F10", label: "Generar cotización" },
      { keys: "Alt+C", label: "Seleccionar cliente" },
      { keys: "Alt+B", label: "Cambiar tipo de comprobante (B02 / B01 / B14)" },
      { keys: "Alt+K", label: "Alternar condición (Contado / Crédito)" },
      { keys: "Alt+D", label: "Enfocar descuento" },
      { keys: "Alt+N", label: "Nueva venta (limpiar borrador)" },
    ],
  },
  {
    id: "global",
    title: "Navegación global",
    paths: ["*"],
    items: [
      { keys: "Ctrl+K", label: "Buscador rápido (productos, clientes, facturas y módulos)" },
      { keys: "F1", label: "Abrir Punto de venta desde cualquier módulo" },
      { keys: "Alt+1 … Alt+0", label: "Cambiar entre módulos del menú principal y cuentas" },
      { keys: "Alt+H", label: "Mostrar u ocultar esta guía de atajos" },
    ],
  },
  {
    id: "modulos",
    title: "Compras, inventario y otros módulos",
    paths: ["/compras", "/inventario", "/caja", "/clientes", "/suplidores", "/reportes", "/cuentas-por-cobrar", "/cuentas-por-pagar"],
    items: [
      { keys: "F2", label: "Enfocar el buscador de la pantalla actual" },
      { keys: "Alt+N", label: "Acción principal: nuevo artículo, cliente, suplidor o movimiento de caja" },
      { keys: "Alt+S", label: "Enfocar selector de suplidor en Compras", ownerOnly: true },
      { keys: "F9", label: "Confirmar factura de compra (en Compras)", ownerOnly: true },
      { keys: "Alt+← / Alt+→", label: "Página anterior o siguiente en tablas paginadas" },
    ],
  },
  {
    id: "dialogos",
    title: "Recibos y formularios",
    paths: ["*"],
    items: [
      { keys: "Enter / P", label: "Imprimir factura al terminar la venta" },
      { keys: "N / Esc", label: "Iniciar nueva venta y volver al buscador" },
      { keys: "Ctrl+Enter", label: "Guardar o confirmar el formulario o diálogo abierto" },
      { keys: "Esc", label: "Cerrar diálogo, menú o búsqueda" },
    ],
  },
];

export function isTouchMobile() {
  return typeof window !== "undefined" &&
    window.matchMedia("(max-width: 1023px) and (pointer: coarse)").matches;
}

export function isPlainAlt(event) {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

export function isPrimaryMod(event) {
  return (event.ctrlKey || event.metaKey) && !event.altKey;
}

export function isEditableElement(target) {
  return target instanceof Element &&
    Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

export function hasOpenModal() {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'),
  );
}

export function hasOpenMenuOrListbox() {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector('[role="listbox"][data-state="open"], [role="menu"][data-state="open"]'),
  );
}

export function dispatchShortcut(action, detail = {}) {
  const event = new CustomEvent("felix:shortcut", {
    detail: { action, ...detail },
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export function isElementVisible(el) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false;
  if (el.closest("[inert], [hidden]")) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function focusFirstSelector(selector, { select = false } = {}) {
  if (typeof document === "undefined") return false;
  const nodes = document.querySelectorAll(selector);
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (!isElementVisible(el)) continue;
    el.focus();
    if (select && typeof el.select === "function") el.select();
    return true;
  }
  return false;
}

export function clickFirstSelector(selector) {
  if (typeof document === "undefined") return false;
  const nodes = document.querySelectorAll(selector);
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (!isElementVisible(el)) continue;
    el.click();
    return true;
  }
  return false;
}

export function submitActiveDialog() {
  if (typeof document === "undefined") return false;
  const dialogs = document.querySelectorAll(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  );
  if (!dialogs.length) return false;
  const topmost = dialogs[dialogs.length - 1];
  const button = topmost.querySelector("[data-shortcut-submit]");
  if (!isElementVisible(button)) return false;
  button.click();
  return true;
}

export function filteredShortcutSections(isOwner, pathname = "") {
  const sections = SHORTCUT_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => isOwner || !item.ownerOnly),
  })).filter((section) => section.items.length > 0);
  if (!pathname) return sections;
  return [...sections].sort((a, b) => {
    const aMatch = a.paths.some((p) => p !== "*" && (pathname === p || pathname.startsWith(p + "/")));
    const bMatch = b.paths.some((p) => p !== "*" && (pathname === p || pathname.startsWith(p + "/")));
    if (aMatch === bMatch) return 0;
    return aMatch ? -1 : 1;
  });
}
