import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StudentDataProvider } from './context/StudentDataContext';
import RequireAuth, { ScrollToTop } from './components/RequireAuth';
import StudentLayout from './components/StudentLayout';
import Login from './pages/Login';
import Home from './pages/Home';
import Timetable from './pages/Timetable';
import Attendance from './pages/Attendance';
import Results from './pages/Results';
import Exams from './pages/Exams';
import Assignments from './pages/Assignments';
import Teachers from './pages/Teachers';
import Syllabus from './pages/Syllabus';
import Notices from './pages/Notices';
import ReportCard from './pages/ReportCard';
import Profile from './pages/Profile';
import More from './pages/More';

const basename =
  import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');

export default function App() {
  return (
    <StudentDataProvider>
      <BrowserRouter basename={basename}>
        <ScrollToTop />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth />}>
            <Route element={<StudentLayout />}>
              <Route index element={<Home />} />
              <Route path="/timetable" element={<Timetable />} />
              <Route path="/attendance" element={<Attendance />} />
              <Route path="/results" element={<Results />} />
              <Route path="/exams" element={<Exams />} />
              <Route path="/assignments" element={<Assignments />} />
              <Route path="/teachers" element={<Teachers />} />
              <Route path="/syllabus" element={<Syllabus />} />
              <Route path="/notices" element={<Notices />} />
              <Route path="/report-card" element={<ReportCard />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/more" element={<More />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </StudentDataProvider>
  );
}
