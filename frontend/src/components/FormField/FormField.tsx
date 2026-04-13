import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FieldConfig } from "@/types";
import styles from "./FormField.module.css";

type Props = {
  field: FieldConfig;
  value: string | number | boolean;
  onChange: (name: string, value: string | number | boolean) => void;
  error?: string;
};

function HelpTooltip({ text }: { text: string }) {
  return (
    <Tooltip delayDuration={1000}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={styles.infoIcon}
          aria-label="Field help"
        >
          <Info className={styles.infoSvg} strokeWidth={2} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-left">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function FormField({ field, value, onChange, error }: Props) {
  const id = `field-${field.name}`;

  if (field.type === "checkbox") {
    return (
      <div className={styles.field}>
        <div className={styles.checkRow}>
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(field.name, e.target.checked)}
          />
          <div className={styles.labelRow}>
            <label htmlFor={id} className={styles.checkTitle}>
              {field.label}
              {field.required ? <span className={styles.req}> *</span> : null}
            </label>
            {field.helpText ? <HelpTooltip text={field.helpText} /> : null}
          </div>
        </div>
        {error ? <p className={styles.error}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <Label htmlFor={id} className={styles.label}>
          {field.label}
          {field.required ? <span className={styles.req}> *</span> : null}
        </Label>
        {field.helpText ? <HelpTooltip text={field.helpText} /> : null}
      </div>

      {field.type === "text" && (
        <Input
          id={id}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
          aria-invalid={Boolean(error)}
        />
      )}

      {field.type === "textarea" && (
        <textarea
          id={id}
          className={styles.textarea}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          rows={3}
          onChange={(e) => onChange(field.name, e.target.value)}
          aria-invalid={Boolean(error)}
        />
      )}

      {field.type === "number" && (
        <Input
          id={id}
          type="number"
          value={value === "" || value === undefined ? "" : String(value)}
          placeholder={field.placeholder}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") onChange(field.name, "");
            else onChange(field.name, Number.parseInt(v, 10));
          }}
          aria-invalid={Boolean(error)}
        />
      )}

      {field.type === "select" && field.options && (
        <Select
          value={String(value)}
          onValueChange={(v) => onChange(field.name, v)}
        >
          <SelectTrigger id={id} className={styles.selectTrigger}>
            <SelectValue placeholder={field.placeholder ?? "Select"} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
