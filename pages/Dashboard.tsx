import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppContext } from '../App';
import { fetchProducts } from '../services/dataService';
import { ClipboardList, ShoppingCart, LogOut, Loader2 } from 'lucide-react';
import { SystemMode } from '../types';

const Dashboard: React.FC = () => {
  const { user, setUser, setMode, setItems } = useContext(AppContext);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Clear items when entering dashboard to ensure fresh start
    setItems([]);
    setMode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModeSelect = async (mode: SystemMode) => {
    if (!user) return;
    setLoading(true);
    
    try {
      const items = await fetchProducts(user.storeName);
      setItems(items);
      setMode(mode);
      navigate('/workshop');
    } catch (err) {
      alert("加载货品清单失败，请检查配置文件。");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    if (window.confirm("确定要退出登录吗？")) {
      setUser(null);
      navigate('/login');
    }
  };

  if (!user) return null;

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50">
      {/* Header */}
      <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center z-10">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{user.storeName}</h1>
          <p className="text-sm text-slate-500">欢迎您，{user.username}</p>
        </div>
        <button 
          onClick={handleLogout}
          className="flex items-center gap-1 py-2 px-3 rounded-lg bg-slate-100 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-colors text-sm font-medium"
        >
          <LogOut size={18} />
          退出登录
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col justify-center items-center p-6 gap-6 overflow-y-auto">
        
        {loading ? (
          <div className="flex flex-col items-center animate-pulse">
            <Loader2 className="w-12 h-12 text-brand-500 animate-spin mb-4" />
            <p className="text-slate-500">正在加载数据...</p>
          </div>
        ) : (
          <>
            <button
              onClick={() => handleModeSelect('COUNT')}
              className="w-full max-w-sm aspect-[4/3] bg-gradient-to-br from-blue-500 to-blue-600 rounded-3xl shadow-xl flex flex-col justify-center items-center text-white transform transition hover:scale-105 active:scale-95"
            >
              <ClipboardList size={64} className="mb-4 opacity-90" />
              <span className="text-3xl font-bold tracking-wide">盘点货品</span>
              <span className="text-blue-100 mt-2">Inventory Count</span>
            </button>

            <button
              onClick={() => handleModeSelect('ORDER')}
              className="w-full max-w-sm aspect-[4/3] bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-3xl shadow-xl flex flex-col justify-center items-center text-white transform transition hover:scale-105 active:scale-95"
            >
              <ShoppingCart size={64} className="mb-4 opacity-90" />
              <span className="text-3xl font-bold tracking-wide">申请订货</span>
              <span className="text-emerald-100 mt-2">Order Request</span>
            </button>
          </>
        )}
      </main>
    </div>
  );
};

export default Dashboard;