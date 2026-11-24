// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button.jsx";
import { Trash2 } from "lucide-react";
import { PackageOpen } from "lucide-react";
import { TriangleAlert } from "lucide-react";
import { Minus } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { Plus } from "lucide-react";
import { formatMoney, formatUnitMoney } from "../../lib/format.js";
import { focusFirstSelector, isTouchMobile } from "../../data/keyboard-shortcuts.js";
var LEVEL_LABEL = {
  p1: "P1",
  p2: "P2",
  p3: "P3",
};
function CartQuantityInput({ value, label, overStock, onCommit, onRemoveLine }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const cancelledRef = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);
  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      setEditing(false);
      setDraft(String(value));
      return;
    }
    setEditing(false);
    const clean = draft.trim().replace(",", ".");
    if (!clean) {
      setDraft(String(value));
      return;
    }
    const normalized = clean.startsWith(".")
      ? "0" + clean
      : clean.endsWith(".")
        ? clean.slice(0, -1)
        : clean;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(value));
      return;
    }
    if (parsed === value) {
      setDraft(String(value));
      return;
    }
    const ok = onCommit(normalized);
    if (ok === false) setDraft(String(value));
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={editing ? draft : String(value)}
      onFocus={(e) => {
        cancelledRef.current = false;
        setEditing(true);
        setDraft(String(value));
        e.target.select();
      }}
      onChange={(e) => {
        const next = e.target.value;
        if (/^[0-9]*[.,]?[0-9]{0,2}$/.test(next)) setDraft(next);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
          if (!isTouchMobile()) focusFirstSelector("[data-sale-search]");
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelledRef.current = true;
          setEditing(false);
          setDraft(String(value));
          e.currentTarget.blur();
          if (!isTouchMobile()) focusFirstSelector("[data-sale-search]");
        } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey && !e.ctrlKey && !e.metaKey) {
          const all = Array.from(document.querySelectorAll(".sale-cart-qty-input"));
          const idx = all.indexOf(e.currentTarget);
          if (idx !== -1 && all.length > 1) {
            const nextIdx = Math.max(0, Math.min(all.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)));
            if (nextIdx !== idx) {
              e.preventDefault();
              all[nextIdx].focus();
            }
          }
        } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "Backspace" || e.key === "Delete") && onRemoveLine) {
          e.preventDefault();
          cancelledRef.current = true;
          const all = Array.from(document.querySelectorAll(".sale-cart-qty-input"));
          const idx = all.indexOf(e.currentTarget);
          onRemoveLine();
          if (!isTouchMobile()) {
            window.setTimeout(() => {
              const remaining = Array.from(document.querySelectorAll(".sale-cart-qty-input"));
              if (remaining.length > 0) {
                remaining[Math.min(idx, remaining.length - 1)]?.focus();
              } else {
                focusFirstSelector("[data-sale-search]");
              }
            }, 0);
          }
        }
      }}
      className={cn(
        "sale-cart-qty-input h-full w-full min-w-0 flex-1 bg-transparent text-center text-sm font-semibold tabular-nums outline-none",
        overStock && "text-amber-600 dark:text-amber-400",
      )}
    />
  );
}
function CartTable({ operational = false, lines, onQuantityChange, onRemove, onClear }) {
  return (
    <section className="sale-cart overflow-hidden rounded-2xl border border-border bg-card">
      <div className="sale-cart-heading flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-semibold"><span className="sale-desktop-only">Detalle de la factura</span><span className="sale-mobile-only">Productos</span></h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {lines.length} {lines.length === 1 ? "artículo" : "artículos"}
          </span>
        </div>
        {lines.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="text-muted-foreground"
          >
            <Trash2 />
            {"Vaciar"}
          </Button>
        )}
      </div>
      {lines.length === 0 ? (
        <div className="sale-cart-empty flex flex-col items-center justify-center border-t border-border px-6 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <PackageOpen className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-semibold">
            {"La factura está vacía"}
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {operational
              ? "Escanea un código o busca un producto por código o nombre para agregarlo."
              : "Busca un producto por código o nombre, o tócalo en el catálogo para agregarlo."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">{"Producto"}</th>
                <th className="px-3 py-2.5 text-center font-medium">
                  {"Cant."}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Precio unit."}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"ITBIS"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Subtotal"}
                </th>
                <th className="w-12 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const overStock = line.quantity > line.product.stock;
                return (
                  <tr
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                    key={line.key}
                  >
                    <td className="sale-cart-product px-5 py-3">
                      <p className="font-medium text-foreground">
                        {line.product.name}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{line.product.code}</span>
                        <span className="rounded bg-muted px-1 text-[10px] font-semibold">
                          {LEVEL_LABEL[line.priceLevel]}
                        </span>
                        {overStock && (
                          <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                            <TriangleAlert className="h-3 w-3" />
                            {"Solo "}
                            {line.product.stock}
                            {" en stock"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="sale-cart-quantity px-3 py-3">
                      <div className="mx-auto flex h-8 w-[104px] items-center overflow-hidden rounded-lg border border-border">
                        <button
                          type="button"
                          onClick={() =>
                            line.quantity > 1
                              ? onQuantityChange(line.key, (Math.round(line.quantity * 100) - 100) / 100)
                              : onRemove(line.key)
                          }
                          className="sale-cart-qty-btn flex h-full w-8 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground"
                          aria-label="Restar"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        {operational ? (
                          <CartQuantityInput
                            value={line.quantity}
                            label={`Cantidad de ${line.product.name}`}
                            overStock={overStock}
                            onCommit={(nextQty) => onQuantityChange(line.key, nextQty)}
                            onRemoveLine={() => onRemove(line.key)}
                          />
                        ) : (
                          <span
                            className={cn(
                              "flex-1 text-center text-sm font-semibold tabular-nums",
                              overStock && "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {line.quantity}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            onQuantityChange(line.key, (Math.round(line.quantity * 100) + 100) / 100)
                          }
                          className="sale-cart-qty-btn flex h-full w-8 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground"
                          aria-label="Sumar"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="sale-cart-price px-3 py-3 text-right tabular-nums text-muted-foreground" data-label="Precio">
                      {formatUnitMoney(line.unitPrice)}
                    </td>
                    <td className="sale-cart-tax px-3 py-3 text-right tabular-nums text-muted-foreground" data-label="ITBIS">
                      {formatMoney(line.itbis)}
                    </td>
                    <td className="sale-cart-subtotal px-3 py-3 text-right font-semibold tabular-nums" data-label="Subtotal">
                      {formatMoney(line.subtotal)}
                    </td>
                    <td className="sale-cart-remove px-3 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(line.key)}
                        className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-primary"
                        aria-label="Eliminar"
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
export { CartTable };
