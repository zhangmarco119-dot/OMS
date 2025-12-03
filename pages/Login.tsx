import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppContext } from '../App';
import { fetchUsers, downloadTemplates, MOCK_USERS } from '../services/dataService';
import { User } from '../types';
import { Store, LogIn, AlertCircle, FileDown, Info } from 'lucide-react';

const Login: React.FC = () => {
  const { setUser } = useContext(AppContext);
  const navigate = useNavigate();
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [userList, setUserList] = useState<User[]>([]);

  useEffect(() => {
    // Load users on mount
    fetchUsers().then(setUserList);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Simulate network delay for UX
    setTimeout(() => {
      const foundUser = userList.find(
        u => u.username === username && u.password === password
      );

      if (foundUser) {
        setUser(foundUser);
        navigate('/dashboard');
      } else {
        setError('用户名或密码错误');
        setLoading(false);
      }
    }, 500);
  };

  const handleDownloadTemplate = () => {
    if(window.confirm("是否下载配置模板(users.json 和 products.xlsx)？\n\n下载后请将它们放入项目根目录的 public/config 文件夹中即可生效。")) {
        downloadTemplates();
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center items-center p-6 bg-gradient-to-b from-brand-500 to-brand-700 text-white overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-slate-800">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-brand-100 rounded-full mb-4">
            <Store className="w-10 h-10 text-brand-600" />
          </div>
          <h1 className="text-2xl font-bold text-center">门店点货订货系统</h1>
          <p className="text-slate-500 text-sm mt-2">请登录以继续</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">用户名</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition"
              placeholder="请输入用户名"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">密码</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition"
              placeholder="请输入密码"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-3.5 rounded-xl shadow-lg transform transition active:scale-95 flex justify-center items-center gap-2 disabled:opacity-70"
          >
            {loading ? '登录中...' : (
              <>
                <LogIn size={20} />
                登录系统
              </>
            )}
          </button>
        </form>
        
        {/* Helper Actions */}
        <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col items-center gap-4">
            <button 
                onClick={handleDownloadTemplate}
                className="text-sm text-brand-600 hover:text-brand-800 font-medium flex items-center gap-2 py-2 px-4 rounded-lg hover:bg-brand-50 transition-colors"
            >
                <FileDown size={18} /> 下载配置文件模板
            </button>

            {/* Default Credentials Hint */}
            <div className="bg-slate-50 p-4 rounded-lg text-xs text-slate-500 w-full">
                <div className="flex items-center gap-2 mb-2 font-bold text-slate-700">
                    <Info size={14} /> 测试账号 (未配置时可用):
                </div>
                <div className="space-y-1 font-mono">
                    <div className="flex justify-between">
                        <span>{MOCK_USERS[0].storeName}</span>
                        <span>{MOCK_USERS[0].username} / {MOCK_USERS[0].password}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
                        <span>{MOCK_USERS[1].storeName}</span>
                        <span>{MOCK_USERS[1].username} / {MOCK_USERS[1].password}</span>
                    </div>
                </div>
            </div>

            <div className="text-center text-xs text-slate-300">
                系统版本 v1.0.2
            </div>
        </div>
      </div>
    </div>
  );
};

export default Login;