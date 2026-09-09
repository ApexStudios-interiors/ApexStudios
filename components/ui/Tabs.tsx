export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="inline-flex bg-muted rounded-lg p-1 gap-0.5 mb-4">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={`border-0 rounded-md px-3 py-1.5 text-[13.5px] cursor-pointer ${
            value === it.key
              ? "bg-background text-foreground font-semibold"
              : "bg-transparent text-muted-foreground font-medium"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
