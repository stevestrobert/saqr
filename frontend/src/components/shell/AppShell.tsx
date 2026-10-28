import { useCallback, useState, type ReactNode } from 'react';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';
import { PresenterDrawer } from './PresenterDrawer';
import { useHotkey } from '../../hooks/useHotkey';

export function AppShell({ children }: { children: ReactNode }) {
  const [presenter, setPresenter] = useState(false);
  const toggle = useCallback(() => setPresenter((v) => !v), []);
  useHotkey('p', toggle);

  return (
    <div className="h-full grid grid-cols-[236px_minmax(0,1fr)]">
      <SideNav />
      <div className="min-w-0 flex flex-col h-full">
        <TopBar onPresenter={toggle} presenterOpen={presenter} />
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className="px-5 py-4 max-w-[1800px] mx-auto animate-fade-in">{children}</div>
        </main>
      </div>
      <PresenterDrawer open={presenter} onClose={() => setPresenter(false)} />
    </div>
  );
}
