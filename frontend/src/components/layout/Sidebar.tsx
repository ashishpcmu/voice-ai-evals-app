import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Beaker,
  PlayCircle,
  BarChart3,
  Upload,
  GitCompare,
  Settings,
  Zap,
  ChevronRight,
  UserCircle2,
  Bot,
  Radio,
} from 'lucide-react';

const navLinks = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/scenarios', label: 'Scenarios', icon: Beaker },
  { to: '/personas', label: 'Personas', icon: UserCircle2 },
  { to: '/metrics', label: 'Metrics', icon: BarChart3 },
  { to: '/eval-runs', label: 'Eval Runs', icon: PlayCircle },
  { to: '/upload', label: 'Upload', icon: Upload },
  { to: '/compare', label: 'Compare', icon: GitCompare },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="w-60 bg-gradient-to-b from-dark-navy to-dark-navy-2 flex-shrink-0 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-primary-blue rounded-lg flex items-center justify-center">
            <Zap className="w-4.5 h-4.5 text-white" size={18} />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight">AI Eval</div>
            <div className="text-blue-300 text-xs">Suite</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <div className="text-blue-400 text-xs font-semibold uppercase tracking-wider px-3 mb-3">Navigation</div>
        {navLinks.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.exact}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'}`
            }
          >
            <link.icon size={16} />
            <span>{link.label}</span>
          </NavLink>
        ))}

        {/* Beta section */}
        <div className="text-blue-400 text-xs font-semibold uppercase tracking-wider px-3 mt-5 mb-2">Beta</div>
        <NavLink
          to="/voice"
          className={({ isActive }) =>
            `sidebar-link ${isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'}`
          }
        >
          <Radio size={16} />
          <span className="flex-1">Voice Simulation</span>
          <span className="px-1.5 py-0.5 text-xs font-bold bg-amber-500/20 text-amber-300 rounded">β</span>
        </NavLink>
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-primary-blue/30 rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-semibold">PM</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-xs font-medium truncate">Product Manager</div>
            <div className="text-blue-300 text-xs truncate">Safeguard Insurance</div>
          </div>
          <ChevronRight size={14} className="text-blue-400 flex-shrink-0" />
        </div>
      </div>
    </aside>
  );
}
