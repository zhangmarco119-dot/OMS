import React, { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppContext } from '../App';
import { exportToExcel } from '../services/dataService';
import { CheckCircle, ArrowLeft, PlusCircle, Download } from 'lucide-react';
import { ItemStatus, ProductItem } from '../types';

const Summary: React.FC = () => {
  const { user, mode, items, setItems } = useContext(AppContext);
  const navigate = useNavigate();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', spec: '', unit: '', quantity: '' });

  const totalItems = items.length;
  const completedItems = items.filter(i => i.status !== ItemStatus.PENDING).length;

  const handleExport = () => {
    if (user && mode) {
      try {
        exportToExcel(items, user, mode);
        alert("Excel文件已开始下载");
      } catch (e) {
        alert("导出失败，请重试");
        console.error(e);
      }
    }
  };

  const handleAddNew = () => {
    if (!newItem.name) return;
    
    const itemToAdd: ProductItem = {
      id: `new-${Date.now()}`,
      name: newItem.name,
      spec: newItem.spec || '无规格',
      unit: newItem.unit || '个',
      quantity: parseFloat(newItem.quantity) || 0,
      status: ItemStatus.COMPLETED,
      isNew: true,
      hasError: false,
      isUnused: false
    };

    setItems([...items, itemToAdd]);
    setShowAddModal(false);
    setNewItem({ name: '', spec: '', unit: '', quantity: '' });
    alert("货品已添加！");
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 h-full p-6 overflow-y-auto">
      
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="bg-green-100 p-6 rounded-full mb-6">
          <CheckCircle className="w-16 h-16 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">
            {mode === 'COUNT' ? '货品盘点完毕' : '订货单已完成'}
        </h1>
        <p className="text-slate-500 mb-8">
            {user?.storeName} - {user?.username}<br/>
            共 {totalItems} 项，已完成 {completedItems} 项<br/>
            您辛苦了！
        </p>

        <div className="w-full max-w-sm space-y-4">
            <button 
                onClick={() => navigate('/workshop')}
                className="w-full py-4 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm hover:bg-slate-50"
            >
                <ArrowLeft size={20} /> 返回修改
            </button>

            <button 
                onClick={() => setShowAddModal(true)}
                className="w-full py-4 bg-blue-50 border border-blue-100 text-blue-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-blue-100"
            >
                <PlusCircle size={20} /> 继续增加货品
            </button>

            <button 
                onClick={handleExport}
                className="w-full py-4 bg-green-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-green-200 hover:bg-green-700"
            >
                <Download size={20} /> 结束并导出Excel
            </button>
        </div>
      </div>

      {/* Add New Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4">
            <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-6 shadow-2xl">
                <h3 className="text-lg font-bold mb-4">新增货品</h3>
                <div className="space-y-4">
                    <input 
                        placeholder="货品名称" 
                        className="w-full border rounded-lg p-3 bg-slate-50" 
                        value={newItem.name} 
                        onChange={e => setNewItem({...newItem, name: e.target.value})} 
                    />
                    <div className="flex gap-2">
                        <input 
                            placeholder="规格 (如: 500g/包)" 
                            className="flex-1 border rounded-lg p-3 bg-slate-50" 
                            value={newItem.spec} 
                            onChange={e => setNewItem({...newItem, spec: e.target.value})} 
                        />
                        <input 
                            placeholder="单位" 
                            className="w-20 border rounded-lg p-3 bg-slate-50" 
                            value={newItem.unit} 
                            onChange={e => setNewItem({...newItem, unit: e.target.value})} 
                        />
                    </div>
                    <input 
                        type="number"
                        placeholder="数量" 
                        className="w-full border rounded-lg p-3 bg-slate-50" 
                        value={newItem.quantity} 
                        onChange={e => setNewItem({...newItem, quantity: e.target.value})} 
                    />
                </div>
                <div className="flex gap-3 mt-6">
                    <button onClick={() => setShowAddModal(false)} className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold">取消</button>
                    <button onClick={handleAddNew} className="flex-1 py-3 rounded-xl bg-brand-600 text-white font-bold">确认添加</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Summary;