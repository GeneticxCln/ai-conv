import { Chat } from './components/Chat';
import { useEffect } from 'react';
import { useChatStore } from './stores/useChatStore';

function App() {
  const theme = useChatStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <div className="h-screen w-full">
      <Chat />
    </div>
  );
}

export default App;
