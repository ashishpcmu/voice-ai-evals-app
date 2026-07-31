import React from 'react';

interface BadgeProps {
  variant?: 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'teal' | 'purple';
  children: React.ReactNode;
  className?: string;
}

export default function Badge({ variant = 'gray', children, className = '' }: BadgeProps) {
  const variants = {
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-blue-100 text-blue-800',
    gray: 'bg-gray-100 text-gray-700',
    teal: 'bg-teal-100 text-teal-800',
    purple: 'bg-purple-100 text-purple-700',
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
