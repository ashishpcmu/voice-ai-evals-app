import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}

export default function Card({ children, className = '', padding = true }: CardProps) {
  return (
    <div className={`bg-white rounded-xl border border-brand-border shadow-sm ${padding ? 'p-6' : ''} ${className}`}>
      {children}
    </div>
  );
}
