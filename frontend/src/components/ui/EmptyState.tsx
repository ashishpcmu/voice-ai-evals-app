import React from 'react';
import { LucideIcon } from 'lucide-react';
import Button from './Button';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 bg-light-blue rounded-full flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-primary-blue" />
      </div>
      <h3 className="text-base font-semibold text-dark-text mb-2">{title}</h3>
      <p className="text-sm text-gray-text max-w-sm mb-6">{description}</p>
      {action && (
        <Button onClick={action.onClick}>{action.label}</Button>
      )}
    </div>
  );
}
