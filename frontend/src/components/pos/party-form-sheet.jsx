// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Sheet } from "../ui/sheet.jsx";
import { SheetContent } from "../ui/sheet.jsx";
import { SheetHeader } from "../ui/sheet.jsx";
import { SheetTitle } from "../ui/sheet.jsx";
import { SheetDescription } from "../ui/sheet.jsx";
import { Field } from "./form-field.jsx";
import { Select } from "../ui/select.jsx";
import { SelectTrigger } from "../ui/select.jsx";
import { inputClass } from "./form-field.jsx";
import { SelectValue } from "../ui/select.jsx";
import { SelectContent } from "../ui/select.jsx";
import { SelectItem } from "../ui/select.jsx";
import { Input } from "../ui/input.jsx";
import { SheetFooter } from "../ui/sheet.jsx";
import { Button } from "../ui/button.jsx";
import { useEffect } from "react";
import { useState, useRef } from "react";
function PartyFormSheet({
  open,
  onOpenChange,
  title,
  description,
  fields,
  initial,
  submitLabel,
  onSave,
}) {
  const [values, setValues] = useState(initial);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const retry = useRef(null);
  const busy = useRef(false);
  useEffect(() => {
    if (open) {
      setValues(initial);
      setTried(false);
      setError(null);
      retry.current = null;
    }
  }, [open]);
  const missing = fields.filter((f) => f.required && !values[f.key]?.trim());
  return (
    <Sheet open={open} onOpenChange={value => { if (!busy.current) onOpenChange(value); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-6 py-5 text-left">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <fieldset disabled={sending || !!retry.current} className="grid flex-1 grid-cols-2 content-start gap-4 overflow-y-auto px-6 py-5">
          {fields.map((f, i) => (
            <Field
              htmlFor={"party-" + f.key}
              label={f.label}
              hint={f.hint}
              className={f.span === 1 ? "col-span-1" : "col-span-2"}
              error={tried && missing.includes(f) ? "Requerido" : undefined}
              key={f.key}
            >
              {f.type === "select" ? (
                <Select
                  disabled={sending || !!retry.current}
                  value={values[f.key]}
                  onValueChange={(v) =>
                    setValues((s) => ({
                      ...s,
                      [f.key]: v,
                    }))
                  }
                >
                  <SelectTrigger id={"party-" + f.key} className={inputClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options?.map((o) => (
                      <SelectItem value={o.value} key={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={"party-" + f.key}
                  type={f.type === "number" ? "number" : "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) =>
                    setValues((s) => ({
                      ...s,
                      [f.key]: e.target.value,
                    }))
                  }
                  placeholder={f.placeholder}
                  className={inputClass}
                  autoFocus={i === 0}
                />
              )}
            </Field>
          ))}
        </fieldset>
        {error && <p role="alert" className="px-6 pb-3 text-sm text-primary">{error}</p>}
        <SheetFooter className="gap-2 border-t border-border px-6 py-4 sm:space-x-0">
          <Button
            variant="outline"
            className="h-11 rounded-xl bg-card"
            disabled={sending}
            onClick={() => onOpenChange(false)}
          >
            {"Cancelar"}
          </Button>
          <Button
            data-shortcut-submit="true"
            className="h-11 flex-1 rounded-xl font-semibold"
            disabled={sending}
            onClick={async () => {
              if (busy.current) return;
              setTried(true);
              if (missing.length && !retry.current) return;
              busy.current = true;
              setSending(true);
              setError(null);
              try { await (retry.current ? retry.current() : onSave(values)); retry.current = null; onOpenChange(false); }
              catch (cause) { setError(cause.message); retry.current = cause.definitive ? null : cause.retry ?? retry.current; }
              finally { busy.current = false; setSending(false); }
            }}
          >
            {sending ? "Guardando…" : retry.current ? "Reintentar" : submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
export { PartyFormSheet };
