// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { AlertDialog2 } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogContent2 } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogHeader } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogTitle2 } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogDescription2 } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogFooter } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogCancel2 } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogAction2 } from "../../components/ui/alert-dialog.jsx";
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Eliminar",
  onConfirm,
}) {
  return (
    <AlertDialog2 open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent2 className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle2>{title}</AlertDialogTitle2>
          <AlertDialogDescription2>{description}</AlertDialogDescription2>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel2 className="rounded-xl">
            {"Cancelar"}
          </AlertDialogCancel2>
          <AlertDialogAction2
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction2>
        </AlertDialogFooter>
      </AlertDialogContent2>
    </AlertDialog2>
  );
}
export { ConfirmDialog };
