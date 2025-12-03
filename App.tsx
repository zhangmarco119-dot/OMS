import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { User, ProductItem, SystemMode } from './types';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Workshop from './pages/Workshop';
import Summary from './pages/Summary';

// Global Context for simple state management in this scope
export const AppContext = React.createContext<{
  user: User | null;
  setUser: (u: User | null) => void;
  mode: SystemMode | null;
  setMode: (m: SystemMode | null) => void;
  items: ProductItem[];
  setItems: React.Dispatch<React.SetStateAction<ProductItem[]>>;
  resetSession: () => void;
}>({
  user: null,
  setUser: () => {},
  mode: null,
  setMode: () => {},
  items: [],
  setItems: () => {},
  resetSession: () => {},
});

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<SystemMode | null>(null);
  const [items, setItems] = useState<ProductItem[]>([]);

  const resetSession = () => {
    // Keep user logged in, but reset items and mode
    setMode(null);
    setItems([]);
  };

  return (
    <AppContext.Provider value={{ user, setUser, mode, setMode, items, setItems, resetSession }}>
      <HashRouter>
        <div className="h-screen w-screen bg-slate-50 flex flex-col font-sans">
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<Login />} />
            
            <Route 
              path="/dashboard" 
              element={user ? <Dashboard /> : <Navigate to="/login" />} 
            />
            
            <Route 
              path="/workshop" 
              element={(user && mode && items.length > 0) ? <Workshop /> : <Navigate to="/dashboard" />} 
            />
            
            <Route 
              path="/summary" 
              element={(user && mode) ? <Summary /> : <Navigate to="/dashboard" />} 
            />
          </Routes>
        </div>
      </HashRouter>
    </AppContext.Provider>
  );
};

export default App;
