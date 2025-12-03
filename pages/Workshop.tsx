import React, { useContext, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppContext } from '../App';
import { ItemStatus, ProductItem } from '../types';
import { 
  ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, 
  XCircle, RotateCcw, Plus, Trash2, List, Grid, Flag
} from 'lucide-react';

const Workshop: React.FC = () => {
  const { user, mode, items, setItems } = useContext(AppContext);
  const navigate = useNavigate();

  // Navigation State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputValue, setInputValue] = useState<string>('');
  
  // Layout State
  const [showLeftDrawer, setShowLeftDrawer] = useState(false);
  const [showRightDrawer, setShowRightDrawer] = useState(false);

  // Edit/Modal State
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [showNewItemModal, setShowNewItemModal] = useState(false);
  
  // Temporary state for edits
  const [editingItem, setEditingItem] = useState<Partial<ProductItem>>({});

  const currentItem = items[currentIndex];

  // Sync input value when current item changes
  useEffect(() => {
    if (currentItem) {
      if (currentItem.quantity !== null) {
        setInputValue(currentItem.quantity.toString());
      } else {
        setInputValue('');
      }
    }
  }, [currentIndex, currentItem]);

  const saveCurrent = () => {
    if (!inputValue && currentItem.status !== ItemStatus.SKIPPED) return; // Allow empty if skipped, else logic handled elsewhere

    const numVal = parseFloat(inputValue);
    
    setItems(prev => {
      const next = [...prev];
      next[currentIndex] = {
        ...next[currentIndex],
        quantity: isNaN(numVal) ? null : numVal,
        status: (isNaN(numVal) && next[currentIndex].status === ItemStatus.PENDING) ? ItemStatus.PENDING : (next[currentIndex].status === ItemStatus.SKIPPED ? ItemStatus.SKIPPED : ItemStatus.COMPLETED)
      };
      // If we typed a number, ensure it's completed not skipped
      if (!isNaN(numVal)) {
        next[currentIndex].status = ItemStatus.COMPLETED;
      }
      return next;
    });
  };

  const handleNext = () => {
    saveCurrent();
    if (currentIndex < items.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    saveCurrent();
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const jumpToUnfinished = () => {
    const index = items.findIndex(i => i.status === ItemStatus.PENDING);
    if (index !== -1) {
      setCurrentIndex(index);
    } else {
      alert("所有货品已处理完毕！");
    }
  };

  const handleFinish = () => {
    saveCurrent();
    const pendingCount = items.filter(i => i.status === ItemStatus.PENDING).length;
    if (pendingCount > 0) {
      if (!window.confirm(`还有 ${pendingCount} 个货品未处理，确定要结束吗？`)) {
        return;
      }
    }
    navigate('/summary');
  };

  const handleSkip = () => {
    setItems(prev => {
      const next = [...prev];
      next[currentIndex].status = ItemStatus.SKIPPED;
      next[currentIndex].quantity = 0;
      return next;
    });
    setInputValue('');
    if (currentIndex < items.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  // --- FLAGS ---

  const handleMarkUnused = () => {
    if(window.confirm(`确定标记 ${currentItem.name} 为不再使用吗？`)) {
        setItems(prev => {
            const next = [...prev];
            next[currentIndex].isUnused = !next[currentIndex].isUnused;
            // Also mark as done with 0 qty if unused
            if (next[currentIndex].isUnused) {
                next[currentIndex].quantity = 0;
                next[currentIndex].status = ItemStatus.COMPLETED;
            }
            return next;
        });
        if (currentIndex < items.length - 1) {
            handleNext();
        }
    }
  };

  const openErrorModal = () => {
    setEditingItem({ ...currentItem });
    setShowErrorModal(true);
  };

  const saveErrorEdit = () => {
    setItems(prev => {
      const next = [...prev];
      next[currentIndex] = {
        ...next[currentIndex],
        name: editingItem.name!,
        spec: editingItem.spec!,
        unit: editingItem.unit!,
        hasError: true,
        originalName: currentItem.originalName || currentItem.name,
        originalSpec: currentItem.originalSpec || currentItem.spec,
        originalUnit: currentItem.originalUnit || currentItem.unit,
      };
      return next;
    });
    setShowErrorModal(false);
  };

  // --- DRAWER COMPONENTS ---

  const ItemListDrawer: React.FC<{
    title: string;
    filter: (i: ProductItem) => boolean;
    isOpen: boolean;
    onClose: () => void;
    side: 'left' | 'right';
  }> = ({ title, filter, isOpen, onClose, side }) => {
    if (!isOpen) return null;
    const filteredItems = items.map((item, idx) => ({ item, idx })).filter(x => filter(x.item));

    return (
      <div className="fixed inset-0 z-50 flex">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div className={`relative w-64 bg-white shadow-2xl flex flex-col ${side === 'right' ? 'ml-auto' : ''}`}>
          <div className="p-4 bg-slate-100 border-b font-bold flex justify-between items-center">
            {title} ({filteredItems.length})
            <button onClick={onClose}><XCircle size={20} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {filteredItems.map(({ item, idx }) => (
              <div 
                key={item.id}
                onClick={() => { setCurrentIndex(idx); onClose(); }}
                className={`p-3 mb-2 rounded border cursor-pointer ${idx === currentIndex ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}
              >
                <div className="font-bold text-sm truncate">{item.name}</div>
                <div className="text-xs text-slate-500 flex justify-between">
                   <span>{item.spec}</span>
                   {item.quantity !== null && <span className="font-mono font-bold text-brand-600">{item.quantity} {item.unit}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-100 relative">
      {/* Header */}
      <header className="bg-white shadow-sm px-4 py-3 flex flex-col items-center z-10">
        <h1 className="text-lg font-bold text-slate-800 text-center leading-tight">
          {user?.storeName}
          <span className="block text-sm font-normal text-brand-600 mt-1">
            {mode === 'COUNT' ? '盘点系统' : '订货系统'}
          </span>
        </h1>
        {/* Progress Bar */}
        <div className="w-full mt-3 h-2 bg-slate-200 rounded-full overflow-hidden">
          <div 
            className="h-full bg-brand-500 transition-all duration-300"
            style={{ width: `${((items.filter(i => i.status !== ItemStatus.PENDING).length) / items.length) * 100}%` }}
          />
        </div>
        <div className="text-xs text-slate-400 mt-1 w-full text-center">
            进度: {items.filter(i => i.status !== ItemStatus.PENDING).length} / {items.length}
        </div>
      </header>

      {/* Main Work Area */}
      <main className="flex-1 p-4 flex flex-col overflow-hidden relative">
        
        {/* Left/Right Drawer Toggles (Mobile friendly lists) */}
        <div className="absolute top-4 left-2 z-20">
            <button 
                onClick={() => setShowLeftDrawer(true)}
                className="bg-white p-2 rounded-full shadow-md text-slate-600 hover:text-brand-600 border border-slate-200"
            >
                <List size={24} />
            </button>
        </div>
        <div className="absolute top-4 right-2 z-20">
            <button 
                onClick={() => setShowRightDrawer(true)}
                className="bg-white p-2 rounded-full shadow-md text-slate-600 hover:text-brand-600 border border-slate-200"
            >
                <Grid size={24} />
            </button>
        </div>

        {/* Card */}
        <div className="flex-1 flex flex-col justify-center items-center max-w-lg mx-auto w-full">
            <div className="bg-white w-full rounded-2xl shadow-xl p-6 flex flex-col items-center border border-slate-100 relative">
                
                {/* Status Badges */}
                <div className="absolute top-4 right-4 flex gap-2">
                    {currentItem.isUnused && <span className="bg-red-100 text-red-600 text-xs px-2 py-1 rounded">不再使用</span>}
                    {currentItem.hasError && <span className="bg-orange-100 text-orange-600 text-xs px-2 py-1 rounded">已修正</span>}
                    {currentItem.isNew && <span className="bg-green-100 text-green-600 text-xs px-2 py-1 rounded">新增</span>}
                </div>

                <h2 className="text-2xl font-bold text-slate-800 text-center mb-1">{currentItem.name}</h2>
                <p className="text-slate-500 mb-6">{currentItem.spec}</p>

                <div className="flex items-center w-full mb-8 gap-3">
                    <input 
                        type="number"
                        inputMode="decimal"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="0"
                        className="flex-1 text-center text-4xl font-bold py-4 border-b-2 border-brand-200 focus:border-brand-500 outline-none bg-transparent transition-colors placeholder-slate-200"
                        autoFocus
                    />
                    <span className="text-xl font-medium text-slate-400 whitespace-nowrap min-w-[3rem]">
                        {currentItem.unit}
                    </span>
                </div>

                <div className="flex gap-4 w-full">
                    <button 
                        onClick={handlePrev}
                        disabled={currentIndex === 0}
                        className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-medium hover:bg-slate-200 disabled:opacity-50"
                    >
                        <div className="flex items-center justify-center gap-1">
                            <ChevronLeft size={18} /> 上一个
                        </div>
                    </button>
                    <button 
                        onClick={handleNext}
                        disabled={currentIndex === items.length - 1}
                        className="flex-1 py-3 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 shadow-lg shadow-brand-200 disabled:opacity-50"
                    >
                        <div className="flex items-center justify-center gap-1">
                            下一个 <ChevronRight size={18} />
                        </div>
                    </button>
                </div>
            </div>

            {/* Ordering Mode: Skip Button */}
            {mode === 'ORDER' && (
                 <button 
                    onClick={handleSkip}
                    className="mt-4 text-slate-400 hover:text-slate-600 text-sm flex items-center gap-1"
                >
                    <RotateCcw size={14} /> 无需订货 (跳过)
                </button>
            )}
        </div>

        {/* Bottom Actions */}
        <div className="mt-6 grid grid-cols-2 gap-3 max-w-lg mx-auto w-full">
            <button 
                onClick={handleMarkUnused}
                className={`py-2 px-3 rounded-lg border text-sm flex items-center justify-center gap-2 ${currentItem.isUnused ? 'bg-red-50 border-red-200 text-red-600' : 'border-slate-200 text-slate-600'}`}
            >
                <Trash2 size={16} /> 标记不再使用
            </button>
            <button 
                onClick={openErrorModal}
                className="py-2 px-3 rounded-lg border border-slate-200 text-slate-600 text-sm flex items-center justify-center gap-2"
            >
                <Flag size={16} /> 标记信息有误
            </button>
            <button 
                onClick={jumpToUnfinished}
                className="col-span-2 py-3 bg-white border border-brand-200 text-brand-600 rounded-lg font-medium flex items-center justify-center gap-2 shadow-sm"
            >
                <CheckCircle2 size={18} /> 跳转到下一个未点货品
            </button>
        </div>

      </main>

      {/* Footer */}
      <footer className="bg-white border-t p-4 z-10">
        <button 
            onClick={handleFinish}
            className="w-full bg-slate-800 text-white font-bold py-4 rounded-xl shadow-lg hover:bg-slate-900 active:scale-[0.98] transition-transform"
        >
            结束{mode === 'COUNT' ? '盘点' : '订货'}
        </button>
      </footer>

      {/* Drawers */}
      <ItemListDrawer 
        title="已完成货品" 
        side="left"
        isOpen={showLeftDrawer} 
        onClose={() => setShowLeftDrawer(false)}
        filter={(i) => i.status !== ItemStatus.PENDING}
      />
      <ItemListDrawer 
        title="未完成货品" 
        side="right"
        isOpen={showRightDrawer} 
        onClose={() => setShowRightDrawer(false)}
        filter={(i) => i.status === ItemStatus.PENDING}
      />

      {/* Error Edit Modal */}
      {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <AlertTriangle className="text-orange-500" /> 修正货品信息
                </h3>
                <div className="space-y-4">
                    <div>
                        <label className="text-xs text-slate-500">货品名称</label>
                        <input className="w-full border rounded p-2" value={editingItem.name} onChange={e => setEditingItem({...editingItem, name: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500">规格</label>
                        <input className="w-full border rounded p-2" value={editingItem.spec} onChange={e => setEditingItem({...editingItem, spec: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-xs text-slate-500">单位</label>
                        <input className="w-full border rounded p-2" value={editingItem.unit} onChange={e => setEditingItem({...editingItem, unit: e.target.value})} />
                    </div>
                </div>
                <div className="flex gap-3 mt-6">
                    <button onClick={() => setShowErrorModal(false)} className="flex-1 py-2 rounded-lg bg-slate-100">取消</button>
                    <button onClick={saveErrorEdit} className="flex-1 py-2 rounded-lg bg-brand-600 text-white">保存并标记</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Workshop;
