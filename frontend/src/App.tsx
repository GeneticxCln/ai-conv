import { Chat } from './components/Chat';
import { useEffect } from 'react';
import { useChatStore } from './stores/useChatStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UpdateNotification } from './components/UpdateNotification';

function App() {
  const theme = useChatStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <div className="h-screen w-full">
      <ErrorBoundary>
        <Chat />
      </ErrorBoundary>
      <UpdateNotification />
    </div>
  );
}

export default App;
