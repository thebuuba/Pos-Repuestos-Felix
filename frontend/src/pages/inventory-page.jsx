// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-context.jsx";
import { PageHeader } from "../components/pos/page-header.jsx";
import { Button } from "../components/ui/button.jsx";
import { Link } from "react-router-dom";
import { PackagePlus } from "lucide-react";
import { Plus } from "lucide-react";
import { StatCard } from "../components/pos/stat-card.jsx";
import { InventoryTable, needsRestock, stockState } from "../components/pos/inventory-table.jsx";
import { LowStockList } from "../components/pos/low-stock-list.jsx";
import { ProductFormSheet } from "../components/pos/product-form-sheet.jsx";
import { ProductKardexDialog } from "../components/pos/product-kardex-dialog.jsx";
import { toast as ue } from "sonner";
import { ConfirmDialog } from "../components/pos/confirm-dialog.jsx";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { formatMoney, formatNumber } from "../lib/format.js";
import { costUnits, decimalUnits, quantityUnits } from "../../../src/pos/operation-fields.js";
const wholeMoney = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 });
const roundedValue = millionths => decimalUnits((millionths + 5000n) / 10000n, 2);
function InventoryPage() {
  const { products, categories, formulas, settings, saveProduct, deleteProduct, fetchProductMovements, runtime } =
    usePosStore();
  const isOwner = !runtime || runtime.isOwner;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [kardexProduct, setKardexProduct] = useState(null);
  const newProductButtonRef = useRef(null);
  const { totalUnits, stockValue, retailValue, lowStock, lowCount, outCount } = useMemo(() => {
    let stockHundredths = 0n;
    let costMillionths = 0n, retailMillionths = 0n;
    let lowCount = 0, outCount = 0;
    const lowStock = [];
    for (const product of products) {
      const quantity = quantityUnits(product.stock, "las existencias");
      stockHundredths += quantity;
      if (isOwner) {
        costMillionths += quantity * costUnits(product.costExact ?? product.cost, "el costo");
        retailMillionths += quantity * costUnits(product.pricesExact?.p1 ?? product.prices.p1, "el precio");
      }
      const state = stockState(product);
      if (state === "out") outCount++;
      if (state === "low") lowCount++;
      if (needsRestock(product)) lowStock.push(product);
    }
    lowStock.sort((a, b) => a.stock / (a.minStock || 1) - b.stock / (b.minStock || 1));
    return { totalUnits: decimalUnits(stockHundredths, 2), stockValue: roundedValue(costMillionths),
      retailValue: roundedValue(retailMillionths), lowStock, lowCount, outCount };
  }, [products, isOwner]);
  const existingCodes = useMemo(() => new Set(products.map((p) => p.code)), [products]);
  const openProduct = useCallback((product = null) => {
    setDraft({
      product,
      id: product?.id ?? crypto.randomUUID(),
      databaseId: product?.databaseId ?? runtime?.databaseId,
      version: product?.version,
      existingCodes,
      categories,
    });
    setSheetOpen(true);
  }, [existingCodes, categories, runtime?.databaseId]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Catálogo de artículos e inventario"
        description={isOwner ? "Existencias, costos, precios y alertas de reposición." : "Existencias, ubicaciones y precios de venta."}
        actions={
          isOwner ? (
            <Fragment>
              <Button
                asChild={true}
                variant="outline"
                className="h-10 rounded-full bg-card px-5"
              >
                <Link to="/compras">
                  <PackagePlus />
                  {"Entrada de mercancía"}
                </Link>
              </Button>
              <Button
                ref={newProductButtonRef}
                data-shortcut-new="true"
                className="h-10 rounded-full px-5 shadow-md shadow-primary/20"
                onClick={() => openProduct()}
              >
                <Plus />
                {"Nuevo artículo"}
              </Button>
            </Fragment>
          ) : undefined
        }
      />
      <div className={isOwner ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-4" : "grid gap-4 sm:grid-cols-3"}>
        {isOwner && (
          <StatCard
            title="Valor del inventario"
            value={stockValue}
            scrollableValue
            footer={`A precio de venta: ${runtime
              ? formatMoney(retailValue)
              : `RD$ ${wholeMoney.format(retailValue)}`}`}
            to="/reportes"
            highlight={true}
          />
        )}
        <StatCard
          title="Artículos activos"
          value={products.length}
          format="number"
          footer={`${formatNumber(totalUnits)} unidades en almacén`}
          to="/inventario"
        />
        <StatCard
          title="Bajo mínimo"
          value={lowCount}
          format="number"
          footer="Requieren reposición pronto"
          to="/inventario?existencia=low"
        />
        <StatCard
          title="Agotados"
          value={outCount}
          format="number"
          footer="Sin existencia disponible para venta"
          to="/inventario?existencia=out"
        />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <InventoryTable
          products={products}
          categories={categories}
          connected={Boolean(runtime)}
          showCosts={isOwner}
          onHistory={runtime ? setKardexProduct : undefined}
          onEdit={isOwner ? openProduct : undefined}
          onDelete={isOwner ? setToDelete : undefined}
        />
        <LowStockList products={lowStock} />
      </div>
      <ProductFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        draft={draft}
        formulas={formulas}
        rounding={settings.rounding}
        onSave={async (p) => {
          await saveProduct(p);
          ue.success(
            draft.product ? "Artículo actualizado" : "Artículo creado",
            {
              description: `${p.code} · ${p.name}`,
            },
          );
          setSheetOpen(false);
        }}
      />
      <ProductKardexDialog
        product={kardexProduct}
        onOpenChange={(open) => !open && setKardexProduct(null)}
        fetchMovements={fetchProductMovements}
      />
      <ConfirmDialog
        open={Boolean(toDelete)}
        fallbackFocusRef={newProductButtonRef}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="¿Eliminar artículo?"
        description={`Se quitará ${toDelete?.name ?? ""} del catálogo. Las facturas anteriores no se modifican.`}
        onConfirm={async () => {
          if (toDelete) {
            await deleteProduct(toDelete);
            ue("Artículo eliminado");
          }
        }}
      />
    </div>
  );
}
export { InventoryPage };
