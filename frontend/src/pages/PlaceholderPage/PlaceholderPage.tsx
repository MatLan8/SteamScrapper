import styles from "./PlaceholderPage.module.css";

type Props = { title: string };

export function PlaceholderPage({ title }: Props) {
  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.text}>This page is not implemented yet.</p>
    </div>
  );
}
