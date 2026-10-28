import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LiveProvider } from './hooks/useLiveEvents';
import { ToastProvider } from './components/ui/Toast';
import { AppShell } from './components/shell/AppShell';
import { LiveWall } from './pages/LiveWall';
import { Cases } from './pages/Cases';
import { CaseDetail } from './pages/CaseDetail';
import { Reports } from './pages/Reports';
import { Audit } from './pages/Audit';
import { Registry } from './pages/Registry';

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LiveProvider>
        <ToastProvider>
          <AppShell>
            <Routes>
              <Route path="/" element={<LiveWall />} />
              <Route path="/cases" element={<Cases />} />
              <Route path="/cases/:id" element={<CaseDetail />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/campaigns/:id" element={<Reports />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/registry" element={<Registry />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </ToastProvider>
      </LiveProvider>
    </BrowserRouter>
  );
}
