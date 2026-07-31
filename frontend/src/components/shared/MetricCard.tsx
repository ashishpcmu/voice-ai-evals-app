import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: LucideIcon;
  loading?: boolean;
  unit?: string;
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple';
}

const colors = {
  blue: { bg: 'bg-blue-50', text: 'text-primary-blue', icon: 'text-primary-blue' },
  green: { bg: 'bg-green-50', text: 'text-success-green', icon: 'text-success-green' },
  amber: { bg: 'bg-amber-50', text: 'text-warning-amber', icon: 'text-warning-amber' },
  red: { bg: 'bg-red-50', text: 'text-error-red', icon: 'text-error-red' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600', icon: 'text-purple-600' },
};

export default function MetricCard({
  label,
  value,
  change,
  changeLabel,
  icon: Icon,
  loading,
  unit,
  color = 'blue',
}: MetricCardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-brand-border shadow-sm p-6">
        <Skeleton className="h-3 w-1/2 mb-3" />
        <Skeleton className="h-8 w-2/3 mb-2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    );
  }

  const c = colors[color];

  return (
    <div className="bg-white rounded-xl border border-brand-border shadow-sm p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm font-medium text-gray-text">{label}</span>
        {Icon && (
          <div className={`w-8 h-8 ${c.bg} rounded-lg flex items-center justify-center`}>
            <Icon size={16} className={c.icon} />
          </div>
        )}
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-dark-text">{value}</span>
        {unit && <span className="text-sm text-gray-text mb-0.5">{unit}</span>}
      </div>
      {change !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${
          change > 0 ? 'text-success-green' : change < 0 ? 'text-error-red' : 'text-gray-text'
        }`}>
          {change > 0 ? <TrendingUp size={12} /> : change < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
          <span>{change > 0 ? '+' : ''}{change}{changeLabel || ''}</span>
        </div>
      )}
    </div>
  );
}
