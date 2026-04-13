import { useMemo } from "react";
import type { FieldConfig } from "@/types";
import { FormField } from "@/components/FormField/FormField";
import styles from "./ArgumentsForm.module.css";

type Props = {
  fields: FieldConfig[];
  values: Record<string, string | number | boolean>;
  errors: Record<string, string>;
  onChange: (name: string, value: string | number | boolean) => void;
};

export function ArgumentsForm({ fields, values, errors, onChange }: Props) {
  const { requiredFields, optionalFields } = useMemo(() => {
    const required = fields.filter((f) => f.required === true);
    const optional = fields.filter((f) => f.required !== true);
    return { requiredFields: required, optionalFields: optional };
  }, [fields]);

  function renderField(field: FieldConfig) {
    return (
      <div
        key={field.name}
        className={styles.fieldCell}
        data-field-type={field.type}
      >
        <FormField
          field={field}
          value={values[field.name] ?? ""}
          onChange={onChange}
          error={errors[field.name]}
        />
      </div>
    );
  }

  return (
    <div className={styles.form}>
      {requiredFields.length > 0 ? (
        <>
          <h3 className={styles.sectionHeading}>Required</h3>
          {requiredFields.map(renderField)}
        </>
      ) : null}
      {optionalFields.length > 0 ? (
        <>
          <h3 className={styles.sectionHeading}>Optional</h3>
          {optionalFields.map(renderField)}
        </>
      ) : null}
    </div>
  );
}
