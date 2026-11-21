// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { useLocation } from "react-router-dom";
import { findNavItem } from "../data/navigation.js";
import { Construction } from "lucide-react";
import { PageHeader } from "../components/page-header.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
function ModulePlaceholderPage() {
  const { pathname } = useLocation();
  const item = findNavItem(pathname);
  const Icon = item?.icon ?? Construction;
  const title = item?.label ?? "Página no encontrada";
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-primary">
          <Icon className="h-7 w-7" />
        </div>
        <h2 className="mt-5 text-lg font-semibold">
          {item
            ? `El módulo de ${title.toLowerCase()} está en preparación`
            : "No encontramos esta página"}
        </h2>
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
          {
            "Mientras tanto, puedes seguir facturando desde el punto de venta o revisar el panel general."
          }
        </p>
        <div className="mt-6 flex gap-2">
          <Button
            asChild={true}
            variant="outline"
            className="h-10 rounded-full bg-card px-5"
          >
            <Link to="/">{"Ir al panel"}</Link>
          </Button>
          <Button asChild={true} className="h-10 rounded-full px-5">
            <Link to="/ventas">
              <ShoppingCart />
              {"Punto de venta"}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
export { ModulePlaceholderPage };
