import { useState } from 'react';
import Log from '@/ui/screens/Log';
import MyFoods from '@/ui/screens/MyFoods';

export default function App() {
  const [tab, setTab] = useState<'log' | 'foods'>('log');
  const tabBtn = (id: 'log' | 'foods', label: string) => (
    <button
      type="button"
      aria-current={tab === id ? 'page' : undefined}
      onClick={() => setTab(id)}
      className={`min-h-12 flex-1 text-base ${tab === id ? 'font-semibold underline' : ''}`}
    >
      {label}
    </button>
  );
  return (
    <>
      {tab === 'log' ? <Log /> : <MyFoods />}
      <nav aria-label="Main" className="sticky bottom-0 flex border-t border-slate-300 bg-white">
        {tabBtn('log', 'Log')}
        {tabBtn('foods', 'My foods')}
      </nav>
    </>
  );
}
