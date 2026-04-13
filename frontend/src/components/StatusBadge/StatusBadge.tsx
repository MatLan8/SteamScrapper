import { Badge } from "@/components/ui/badge";
import styles from "./StatusBadge.module.css";

type Props = {
  status: "idle" | "running" | "completed" | "failed";
};

export function StatusBadge({ status }: Props) {
  if (status === "idle") return null;
  const label =
    status === "running"
      ? "Running"
      : status === "completed"
        ? "Completed"
        : "Failed";
  return (
    <Badge
      variant={status === "failed" ? "destructive" : "secondary"}
      className={status === "running" ? styles.pulse : undefined}
    >
      {label}
    </Badge>
  );
}
