// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import { PageHeader } from "../components/page-header.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Link } from "react-router-dom";
import { PackagePlus } from "lucide-react";
import { Plus } from "lucide-react";
import { StatCard } from "../components/stat-card.jsx";
import { InventoryTable, needsRestock, stockState } from "../components/inventory-table.jsx";
import { LowStockList } from "../components/low-stock-list.jsx";
import { ProductFormSheet } from "../components/product-form-sheet.jsx";
import { toast as ue } from "sonner";
import { ConfirmDialog } from "../components/confirm-dialog.jsx";
import { Fragment, useMemo, useRef, useState } from "react";
import { formatMoney, formatNumber } from "../lib/format.js";
import { costUnits, decimalUnits, quantityUnits } from "../../../../src/pos/operation-fields.js";
const wholeMoney = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 });
const roundedValue = millionths => decimalUnits((millionths + 5000n) / 10000n, 2);
function InventoryPage() {
  const { products, categories, formulas, settings, saveProduct, deleteProduct, runtime } =
    usePosStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const newProductButtonRef = useRef(null);
  const { totalUnits, stockValue, retailValue, lowStock, lowCount, outCount } = useMemo(() => {
    let stockHundredths = 0n;
    let costMillionths = 0n, retailMillionths = 0n;
    let lowCount = 0, outCount = 0;
    const lowStock = [];
    for (const product of products) {
      const quantity = quantityUnits(product.stock, "las existencias");
      stockHundredths += quantity;
      costMillionths += quantity * costUnits(product.costExact ?? product.cost, "el costo");
      retailMillionths += quantity * costUnits(product.pricesExact?.p1 ?? product.prices.p1, "el precio");
      const state = stockState(product);
      if (state === "out") outCount++;
      if (state === "low") lowCount++;
      if (needsRestock(product)) lowStock.push(product);
    }
    lowStock.sort((a, b) => a.stock / (a.minStock || 1) - b.stock / (b.minStock || 1));
    return { totalUnits: decimalUnits(stockHundredths, 2), stockValue: roundedValue(costMillionths),
      retailValue: roundedValue(retailMillionths), lowStock, lowCount, outCount };
  }, [products]);
  const openProduct = (product = null) => {
    setDraft({
      product,
      id: product?.id ?? crypto.randomUUID(),
      databaseId: product?.databaseId ?? runtime?.databaseId,
      version: product?.version,
      existingCodes: products.map((p) => p.code),
      categories,
    });
    setSheetOpen(true);
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Catálogo de artículos e inventario"
        description="Existencias, costos, precios y alertas de reposición."
        actions={
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
              className="h-10 rounded-full px-5 shadow-md shadow-primary/20"
              onClick={() => openProduct()}
            >
              <Plus />
              {"Nuevo artículo"}
            </Button>
          </Fragment>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          to="/compras"
        />
        <StatCard
          title="Agotados"
          value={outCount}
          format="number"
          footer="Sin existencia disponible para venta"
          to="/compras"
        />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <InventoryTable
          products={products}
          categories={categories}
          connected={Boolean(runtime)}
          onEdit={openProduct}
          onDelete={setToDelete}
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
