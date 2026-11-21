// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Sheet } from "../../components/ui/sheet.jsx";
import { SheetContent } from "../../components/ui/sheet.jsx";
import { SheetHeader } from "../../components/ui/sheet.jsx";
import { SheetTitle } from "../../components/ui/sheet.jsx";
import { SheetDescription } from "../../components/ui/sheet.jsx";
import { Field } from "./form-field.jsx";
import { Select2 } from "../../components/ui/select.jsx";
import { SelectTrigger2 } from "../../components/ui/select.jsx";
import { inputClass } from "./form-field.jsx";
import { SelectValue2 } from "../../components/ui/select.jsx";
import { SelectContent2 } from "../../components/ui/select.jsx";
import { SelectItem2 } from "../../components/ui/select.jsx";
import { Input } from "../../components/ui/input.jsx";
import { SheetFooter } from "../../components/ui/sheet.jsx";
import { Button } from "../../components/ui/button.jsx";
import { useEffect } from "react";
import { useState } from "react";
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
  useEffect(() => {
    if (open) {
      setValues(initial);
      setTried(false);
    }
  }, [open]);
  const missing = fields.filter((f) => f.required && !values[f.key]?.trim());
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-6 py-5 text-left">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="grid flex-1 grid-cols-2 content-start gap-4 overflow-y-auto px-6 py-5">
          {fields.map((f, i) => (
            <Field
              label={f.label}
              hint={f.hint}
              className={f.span === 1 ? "col-span-1" : "col-span-2"}
              error={tried && missing.includes(f) ? "Requerido" : undefined}
              key={f.key}
            >
              {f.type === "select" ? (
                <Select2
                  value={values[f.key]}
                  onValueChange={(v) =>
                    setValues((s) => ({
                      ...s,
                      [f.key]: v,
                    }))
                  }
                >
                  <SelectTrigger2 className={inputClass}>
                    <SelectValue2 />
                  </SelectTrigger2>
                  <SelectContent2>
                    {f.options?.map((o) => (
                      <SelectItem2 value={o.value} key={o.value}>
                        {o.label}
                      </SelectItem2>
                    ))}
                  </SelectContent2>
                </Select2>
              ) : (
                <Input
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
        </div>
        <SheetFooter className="gap-2 border-t border-border px-6 py-4 sm:space-x-0">
          <Button
            variant="outline"
            className="h-11 rounded-xl bg-card"
            onClick={() => onOpenChange(false)}
          >
            {"Cancelar"}
          </Button>
          <Button
            className="h-11 flex-1 rounded-xl font-semibold"
            onClick={() => {
              setTried(true);
              if (missing.length === 0) onSave(values);
            }}
          >
            {submitLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
export { PartyFormSheet };
