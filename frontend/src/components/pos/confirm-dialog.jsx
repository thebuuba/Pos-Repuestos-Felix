// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { AlertDialog } from "../ui/alert-dialog.jsx";
import { AlertDialogContent } from "../ui/alert-dialog.jsx";
import { AlertDialogHeader } from "../ui/alert-dialog.jsx";
import { AlertDialogTitle } from "../ui/alert-dialog.jsx";
import { AlertDialogDescription } from "../ui/alert-dialog.jsx";
import { AlertDialogFooter } from "../ui/alert-dialog.jsx";
import { AlertDialogCancel } from "../ui/alert-dialog.jsx";
import { AlertDialogAction } from "../ui/alert-dialog.jsx";
import { useEffect, useRef, useState } from "react";
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Eliminar",
  onConfirm,
  fallbackFocusRef,
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
      if (cause?.definitive === true) setUncertain(false);
      else if (cause?.uncertain) setUncertain(true);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!inFlight.current) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent
        className="rounded-2xl"
        aria-busy={sending}
        onOpenAutoFocus={() => {
          opener.current = document.activeElement;
        }}
        onCloseAutoFocus={(event) => {
          const previous = opener.current;
          const target = previous?.isConnected
            ? previous
            : fallbackFocusRef?.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus({ preventScroll: target === previous });
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-primary">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-xl" disabled={sending}>
            {"Cancelar"}
          </AlertDialogCancel>
          <AlertDialogAction
            className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
            aria-disabled={sending || undefined}
            onClick={confirm}
          >
            {sending ? "Confirmando…" : uncertain ? "Reintentar" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export { ConfirmDialog };
