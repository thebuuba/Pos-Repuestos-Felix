// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import { PageHeader } from "../components/page-header.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Link } from "react-router-dom";
import { PackagePlus } from "lucide-react";
import { Plus } from "lucide-react";
import { StatCard } from "../components/stat-card.jsx";
import { InventoryTable } from "../components/inventory-table.jsx";
import { LowStockList } from "../components/low-stock-list.jsx";
import { ProductFormSheet } from "../components/product-form-sheet.jsx";
import { toast as ue } from "sonner";
import { ConfirmDialog } from "../components/confirm-dialog.jsx";
import { Fragment } from "react";
import { useState } from "react";
function InventoryPage() {
  const { products, formulas, settings, saveProduct, deleteProduct, runtime } =
    usePosStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const totalUnits = products.reduce((s, p) => s + p.stock, 0);
  const stockValue = products.reduce((s, p) => s + p.stock * p.cost, 0);
  const retailValue = products.reduce((s, p) => s + p.stock * p.prices.p1, 0);
  const lowStock = products
    .filter((p) => p.stock <= p.minStock)
    .sort((a, b) => a.stock / (a.minStock || 1) - b.stock / (b.minStock || 1));
  const outCount = products.filter((p) => p.stock === 0).length;
  const openProduct = (product = null) => {
    setDraft({
      product,
      id: product?.id ?? crypto.randomUUID(),
      databaseId: product?.databaseId ?? runtime?.databaseId,
      version: product?.version,
      existingCodes: products.map((p) => p.code),
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
          footer={`A precio de venta: RD$ ${retailValue.toLocaleString(
            "en-US",
            {
              maximumFractionDigits: 0,
            },
          )}`}
          to="/reportes"
          highlight={true}
        />
        <StatCard
          title="Artículos activos"
          value={products.length}
          format="number"
          footer={`${totalUnits.toLocaleString("en-US")} unidades en almacén`}
          to="/inventario"
        />
        <StatCard
          title="Bajo mínimo"
          value={lowStock.length - outCount}
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
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <InventoryTable
          products={products}
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
