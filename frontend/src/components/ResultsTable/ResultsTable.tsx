import { useMemo, useState, type ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import styles from "./ResultsTable.module.css";

export type ColumnDef<T> = {
  id: string;
  header: string;
  sortValue?: (row: T) => string | number | null | undefined;
  cell: (row: T) => ReactNode;
};

type SortDir = "asc" | "desc";

type Props<T> = {
  columns: ColumnDef<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string;
};

export function ResultsTable<T>({ columns, data, getRowKey }: Props<T>) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    if (!sortCol) return data;
    const col = columns.find((c) => c.id === sortCol);
    if (!col?.sortValue) return data;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      const na =
        va === null || va === undefined
          ? Number.NaN
          : typeof va === "number"
            ? va
            : String(va).toLowerCase();
      const nb =
        vb === null || vb === undefined
          ? Number.NaN
          : typeof vb === "number"
            ? vb
            : String(vb).toLowerCase();
      if (typeof na === "number" && typeof nb === "number") {
        if (na !== nb) return (na - nb) * dir;
        return 0;
      }
      return String(na).localeCompare(String(nb)) * dir;
    });
  }, [data, sortCol, sortDir, columns]);

  function headerClick(id: string) {
    const col = columns.find((c) => c.id === id);
    if (!col?.sortValue) return;
    if (sortCol === id) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(id);
      setSortDir("asc");
    }
  }

  return (
    <div className={styles.wrap}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={styles.rowNumHead}>#</TableHead>
            {columns.map((col) => (
              <TableHead key={col.id}>
                {col.sortValue ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={styles.sortBtn}
                    onClick={() => headerClick(col.id)}
                  >
                    {col.header}
                    {sortCol === col.id ? (
                      <span className={styles.arrow}>
                        {sortDir === "asc" ? "↑" : "↓"}
                      </span>
                    ) : null}
                  </Button>
                ) : (
                  col.header
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row, i) => (
            <TableRow key={getRowKey(row, i)}>
              <TableCell className={styles.rowNumCell}>{i + 1}</TableCell>
              {columns.map((col) => (
                <TableCell key={col.id}>{col.cell(row)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
