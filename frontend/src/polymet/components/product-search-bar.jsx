// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Label3 } from "../../components/ui/label.jsx";
import { ScanBarcode } from "lucide-react";
import { Input } from "../../components/ui/input.jsx";
import { Search } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { formatUnitMoney } from "../lib/format.js";
import { Minus } from "lucide-react";
import { Plus } from "lucide-react";
import { Select2 } from "../../components/ui/select.jsx";
import { SelectTrigger2 } from "../../components/ui/select.jsx";
import { SelectValue2 } from "../../components/ui/select.jsx";
import { SelectContent2 } from "../../components/ui/select.jsx";
import { PRICE_LEVELS } from "../../data/sales-options.js";
import { SelectItem2 } from "../../components/ui/select.jsx";
import { Button } from "../../components/ui/button.jsx";
import { useMemo } from "react";
import { useRef } from "react";
import { useState } from "react";
function ProductSearchBar({ products, priceLevel, onPriceLevelChange, onAdd, operational = false }) {
  const [query, setQuery] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const rank = product => {
      if (product.code === query) return 0;
      return product.code.toLowerCase() === q ? 1 : 2;
    };
    return products
      .filter(
        (p) =>
          p.code.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q),
      )
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 6);
  }, [products, query]);
  const commit = (product) => {
    const target = product ?? results[highlight] ?? results[0];
    if (!target) return;
    if (onAdd(target, operational ? quantity : Math.max(1, quantity)) === false) return;
    setQuery("");
    setQuantity(1);
    setHighlight(0);
    setOpen(false);
    inputRef.current?.focus();
  };
  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };
  return (
    <div className="grid gap-3 rounded-xl bg-muted/60 p-3 md:grid-cols-[minmax(0,1fr)_140px_190px_auto] md:items-end">
      <div className="relative space-y-1.5">
        <Label3 className="text-xs text-muted-foreground">
          {"Código o nombre del producto"}
        </Label3>
        <div className="relative">
          <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={handleKeyDown}
            placeholder="Escanea o escribe… ej. BUJ-C7HSA"
            className="h-11 rounded-xl bg-card pl-9"
          />
        </div>
        {open && query.trim() && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
            {results.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Search className="h-4 w-4" />
                {"No se encontraron productos para “"}
                {query}
                {"”"}
              </div>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {results.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => commit(p)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm",
                        i === highlight && "bg-accent",
                      )}
                    >
                      <span className="w-28 shrink-0 truncate font-mono text-xs text-muted-foreground">
                        {p.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {p.name}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          p.stock === 0
                            ? "text-primary"
                            : p.stock <= p.minStock
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground",
                        )}
                      >
                        {p.stock === 0 ? "Agotado" : `${p.stock} disp.`}
                      </span>
                      <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                        {formatUnitMoney((p.pricesExact ?? p.prices)[priceLevel])}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span>{"↑↓ navegar"}</span>
              <span>{"Enter agregar"}</span>
              <span>{"Esc cerrar"}</span>
            </div>
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label3 className="text-xs text-muted-foreground">{"Cantidad"}</Label3>
        <div className="flex h-11 items-center rounded-xl border border-input bg-card">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(operational ? 0.01 : 1, (Math.round(Number(q) * 100) - 100) / 100))}
            className="flex h-full w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label="Restar"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            aria-label="Cantidad"
            min={operational ? 0.01 : 1}
            step={operational ? 0.01 : 1}
            value={quantity}
            onChange={(e) => setQuantity(operational ? e.target.value : Number(e.target.value) || 1)}
            className="h-full w-full min-w-0 bg-transparent text-center text-sm font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => setQuantity((q) => (Math.round(Number(q) * 100) + 100) / 100)}
            className="flex h-full w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label="Sumar"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label3 className="text-xs text-muted-foreground">
          {"Nivel de precio"}
        </Label3>
        <Select2
          value={priceLevel}
          onValueChange={(v) => onPriceLevelChange(v)}
        >
          <SelectTrigger2 aria-label="Nivel de precio" className="h-11 rounded-xl bg-card">
            <SelectValue2 />
          </SelectTrigger2>
          <SelectContent2>
            {PRICE_LEVELS.map((l) => (
              <SelectItem2 value={l.value} key={l.value}>
                {l.label}
              </SelectItem2>
            ))}
          </SelectContent2>
        </Select2>
      </div>
      <Button
        onClick={() => commit()}
        disabled={results.length === 0}
        className="h-11 rounded-xl px-6 font-semibold"
      >
        <Plus />
        {"Agregar"}
      </Button>
    </div>
  );
}
export { ProductSearchBar };
