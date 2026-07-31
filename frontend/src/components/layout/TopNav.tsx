import { Bell, Search, HelpCircle } from 'lucide-react';
import { useLocation } from 'react-router-dom';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/agents': 'Agents',
  '/scenarios': 'Scenarios',
  '/scenarios/new': 'New Scenario',
  '/personas': 'Personas',
  '/eval-runs': 'Eval Runs',
  '/metrics': 'Metrics',
  '/metrics/new': 'New Metric',
  '/upload': 'Upload Transcript',
  '/compare': 'Version Comparison',
  '/settings': 'Settings',
  '/voice': 'Voice Agent Simulation (Beta)',
};

export default function TopNav() {
  const location = useLocation();

  const title = (() => {
    if (pageTitles[location.pathname]) return pageTitles[location.pathname];
    if (location.pathname.startsWith('/eval-runs/') && location.pathname.endsWith('/human-review')) return 'Human Review';
    if (location.pathname.startsWith('/eval-runs/')) return 'Eval Run Details';
    if (location.pathname.startsWith('/agents/')) return 'Agent Details';
    if (location.pathname.startsWith('/scenarios/') && location.pathname.endsWith('/edit')) return 'Edit Scenario';
    if (location.pathname.startsWith('/metrics/') && location.pathname.endsWith('/edit')) return 'Edit Metric';
    if (location.pathname.startsWith('/trial/')) return 'Trace Inspector';
    return 'AI Eval Suite';
  })();

  return (
    <header className="h-14 bg-white border-b border-brand-border flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold text-dark-text">{title}</h1>
      </div>

      <div className="flex items-center gap-2">
        <button className="p-2 text-gray-text hover:text-dark-text hover:bg-gray-100 rounded-lg transition-colors">
          <Search size={16} />
        </button>
        <button className="p-2 text-gray-text hover:text-dark-text hover:bg-gray-100 rounded-lg transition-colors">
          <Bell size={16} />
        </button>
        <button className="p-2 text-gray-text hover:text-dark-text hover:bg-gray-100 rounded-lg transition-colors">
          <HelpCircle size={16} />
        </button>
      </div>
    </header>
  );
}
