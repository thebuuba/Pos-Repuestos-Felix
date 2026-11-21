// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { AlertDialog2 } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogContent2 } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogHeader } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogTitle2 } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogDescription2 } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogFooter } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogCancel2 } from "../../components/ui/alert-dialog.jsx";
import { AlertDialogAction2 } from "../../components/ui/alert-dialog.jsx";
import { useEffect, useRef, useState } from "react";
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Eliminar",
  onConfirm,
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const opener = useRef(null);
  useEffect(() => {
    if (open) {
      setError(null);
      setUncertain(false);
    }
  }, [open]);
  const confirm = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (cause) {
      setError(cause?.message || "No se pudo confirmar la operación.");
      if (cause?.uncertain) setUncertain(true);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  return (
    <AlertDialog2
      open={open}
      onOpenChange={(nextOpen) => {
        if (!inFlight.current) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent2
        className="rounded-2xl"
        aria-busy={sending}
        onOpenAutoFocus={() => {
          opener.current = document.activeElement;
        }}
        onCloseAutoFocus={(event) => {
          if (!opener.current?.isConnected) return;
          event.preventDefault();
          opener.current.focus({ preventScroll: true });
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle2>{title}</AlertDialogTitle2>
          <AlertDialogDescription2>{description}</AlertDialogDescription2>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-primary">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel2 className="rounded-xl" disabled={sending}>
            {"Cancelar"}
          </AlertDialogCancel2>
          <AlertDialogAction2
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            aria-disabled={sending || undefined}
            onClick={confirm}
          >
            {sending ? "Confirmando…" : uncertain ? "Reintentar" : confirmLabel}
          </AlertDialogAction2>
        </AlertDialogFooter>
      </AlertDialogContent2>
    </AlertDialog2>
  );
}
export { ConfirmDialog };
