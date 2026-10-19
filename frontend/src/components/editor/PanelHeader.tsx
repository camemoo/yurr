export function PanelHeader(props: {
  title: string;
  subtitle: string;
  count?: number;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-end justify-between gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-50">
          {props.title}
          {props.count !== undefined && props.count > 0 && (
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
              {props.count}
            </span>
          )}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{props.subtitle}</p>
      </div>
      {props.actions}
    </header>
  );
}
