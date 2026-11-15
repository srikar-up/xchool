import { NavLink } from 'react-router-dom';
import { CalendarCheck2, CalendarDays, FileBarChart2, House, LayoutGrid } from 'lucide-react';

const ITEMS = [
  { to: '/', end: true, label: 'Home', icon: House },
  { to: '/timetable', label: 'Timetable', icon: CalendarDays },
  { to: '/attendance', label: 'Attendance', icon: CalendarCheck2 },
  { to: '/results', label: 'Results', icon: FileBarChart2 },
  { to: '/more', label: 'More', icon: LayoutGrid },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Student navigation">
      {ITEMS.map(({ to, end, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="bottom-nav-icon">
            <Icon size={21} strokeWidth={2.1} />
          </span>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
