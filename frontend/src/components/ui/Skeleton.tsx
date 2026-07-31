interface SkeletonProps {
  className?: string;
  lines?: number;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`bg-gray-200 animate-pulse rounded ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-brand-border shadow-sm p-6">
      <Skeleton className="h-4 w-1/3 mb-3" />
      <Skeleton className="h-8 w-2/3 mb-2" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white rounded-xl border border-brand-border shadow-sm overflow-hidden">
      <div className="p-4 border-b border-brand-border">
        <Skeleton className="h-4 w-1/4" />
      </div>
      <div className="divide-y divide-gray-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-4">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/8" />
            <Skeleton className="h-4 w-1/6 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
