import React, { useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppContext } from '../App';
import { ItemStatus, ProductItem } from '../types';
import { 
  ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, 
  XCircle, Trash2, List, Grid, Flag, StepForward, LogOut
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
  const [editingItem, setEditingItem] = useState<Partial<ProductItem>>({});

  const currentItem = items[currentIndex];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

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
    if (!inputValue && currentItem.status !== ItemStatus.SKIPPED) return; 

    const numVal = parseFloat(inputValue);
    
    setItems(prev => {
      const next = [...prev];
      next[currentIndex] = {
        ...next[currentIndex],
        quantity: isNaN(numVal) ? null : numVal,
        status: (isNaN(numVal) && next[currentIndex].status === ItemStatus.PENDING) 
          ? ItemStatus.PENDING 
          : (next[currentIndex].status === ItemStatus.SKIPPED ? ItemStatus.SKIPPED : ItemStatus.COMPLETED)
      };
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

  const handleExitSystem = () => {
    if(window.confirm("确定要退出当前系统返回主菜单吗？")) {
        navigate('/dashboard');
    }
  };

  const handleMarkUnused = () => {
    if(window.confirm(`确定标记 ${currentItem.name} 为不再使用吗？`)) {
        setItems(prev => {
            const next = [...prev];
            next[currentIndex].isUnused = !next[currentIndex].isUnused;
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

  // Drawer Labels
  const leftBtnLabel = mode === 'COUNT' ? '已点' : '已订';
  const rightBtnLabel = mode === 'COUNT' ? '待点' : '待订';

  // --- SUB COMPONENT ---
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
      <div className="fixed inset-0 z-50 flex w-full h-full">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div className={`relative w-64 bg-white shadow-2xl flex flex-col h-full ${side === 'right' ? 'ml-auto' : ''}`}>
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
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      
      {/* 1. COMPACT HEADER */}
      <header className="bg-white px-4 py-2 border-b border-slate-200 flex items-center justify-between shrink-0 h-14">
        <div className="flex flex-col">
            <h1 className="text-sm font-bold text-slate-800 leading-none">{user?.storeName}</h1>
            <div className="text-xs text-brand-600 font-medium mt-1 flex items-center gap-2">
                {mode === 'COUNT' ? '盘点系统' : '订货系统'}
                <span className="text-slate-400">|</span>
                <span className="text-slate-500">进度: {items.filter(i => i.status !== ItemStatus.PENDING).length}/{items.length}</span>
            </div>
        </div>
        <button onClick={handleExitSystem} className="p-2 text-slate-400 hover:text-red-500">
            <LogOut size={20} />
        </button>
      </header>

      {/* 2. MAIN FLEX AREA (No scroll) */}
      <main className="flex-1 flex flex-col px-4 relative overflow-hidden">
        
        {/* Drawer Buttons (Top Row) */}
        <div className="flex justify-between items-center py-3 shrink-0">
             <button onClick={() => setShowLeftDrawer(true)} className="flex items-center gap-1 text-slate-500 hover:text-brand-600 px-2 py-1 bg-white border rounded-full text-xs shadow-sm">
                <List size={16} /> {leftBtnLabel}
            </button>
            <button onClick={() => setShowRightDrawer(true)} className="flex items-center gap-1 text-slate-500 hover:text-brand-600 px-2 py-1 bg-white border rounded-full text-xs shadow-sm">
                {rightBtnLabel} <Grid size={16} />
            </button>
        </div>

        {/* Product Info (Takes available space) */}
        <div className="flex-1 flex flex-col justify-center items-center text-center min-h-0">
             {/* Flags */}
             <div className="h-6 mb-2">
                {currentItem.isUnused && <span className="bg-red-100 text-red-600 text-xs px-2 py-1 rounded-full">不再使用</span>}
                {currentItem.hasError && <span className="bg-orange-100 text-orange-600 text-xs px-2 py-1 rounded-full">已修正</span>}
                {currentItem.isNew && <span className="bg-green-100 text-green-600 text-xs px-2 py-1 rounded-full">新增</span>}
             </div>

             <h2 className="text-3xl font-bold text-slate-800 mb-2 leading-tight">{currentItem.name}</h2>
             <p className="text-slate-500 text-sm mb-6 bg-slate-100 px-3 py-1 rounded-lg">{currentItem.spec}</p>

             <div className="flex items-baseline justify-center gap-2 w-full max-w-xs border-b-2 border-brand-200 focus-within:border-brand-500 transition-colors pb-1">
                 <input 
                    type="number"
                    inputMode="decimal"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="0"
                    className="text-center text-5xl font-bold text-slate-800 bg-transparent outline-none w-32 placeholder-slate-200"
                    autoFocus
                 />
                 <span className="text-xl text-slate-400 font-medium">{currentItem.unit}</span>
             </div>
        </div>

        {/* Primary Controls */}
        <div className="py-2 space-y-2 shrink-0">
            <div className="grid grid-cols-2 gap-4">
                <button 
                    onClick={handlePrev} 
                    disabled={currentIndex === 0}
                    className="py-3 rounded-xl bg-slate-200 text-slate-600 font-bold hover:bg-slate-300 disabled:opacity-30"
                >
                    <ChevronLeft className="inline mb-1" size={20} /> 上一个
                </button>
                <button 
                    onClick={handleNext} 
                    disabled={currentIndex === items.length - 1}
                    className="py-3 rounded-xl bg-brand-600 text-white font-bold hover:bg-brand-700 shadow-lg shadow-brand-200 disabled:opacity-30"
                >
                    下一个 <ChevronRight className="inline mb-1" size={20} />
                </button>
            </div>
            
            {mode === 'ORDER' && (
                <button 
                    onClick={handleSkip}
                    className="w-full py-3 bg-slate-100 text-slate-500 hover:bg-slate-200 rounded-xl font-medium flex items-center justify-center gap-2 text-sm"
                >
                    <StepForward size={18} /> 跳过此货品 (无需订货)
                </button>
            )}
        </div>

        {/* Secondary Actions (Single Row Grid) */}
        <div className="border-t border-slate-200 py-3 shrink-0 bg-slate-50">
            <div className="grid grid-cols-3 gap-2">
                 <button 
                    onClick={handleMarkUnused} 
                    className={`flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-lg transition-colors ${
                        currentItem.isUnused 
                        ? 'bg-red-100 text-red-600 border border-red-200' 
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                 >
                    <Trash2 size={20} />
                    <span className="text-[10px] leading-tight font-bold">标记不再使用</span>
                 </button>
                 
                 <button 
                    onClick={openErrorModal} 
                    className={`flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-lg transition-colors ${
                        currentItem.hasError
                        ? 'bg-orange-100 text-orange-600 border border-orange-200' 
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                 >
                    <Flag size={20} />
                    <span className="text-[10px] leading-tight font-bold">标记信息有误</span>
                 </button>

                 <button 
                    onClick={jumpToUnfinished} 
                    className="flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-lg bg-white text-brand-600 border border-brand-200 hover:bg-brand-50"
                >
                    <CheckCircle2 size={20} />
                    <span className="text-[10px] leading-tight font-bold">下一个未{mode === 'COUNT' ? '点' : '订'}货品</span>
                </button>
            </div>
        </div>

      </main>

      {/* 3. FOOTER */}
      <footer className="bg-slate-900 p-3 shrink-0">
         <button onClick={handleFinish} className="w-full text-white font-bold py-3 rounded-lg hover:bg-slate-800 active:scale-[0.98] transition-all">
            结束{mode === 'COUNT' ? '盘点' : '订货'}
         </button>
      </footer>

      {/* DRAWERS & MODALS */}
      <ItemListDrawer 
        title={mode === 'COUNT' ? "已完成货品" : "已订货品"}
        side="left"
        isOpen={showLeftDrawer} 
        onClose={() => setShowLeftDrawer(false)}
        filter={(i) => i.status !== ItemStatus.PENDING}
      />
      <ItemListDrawer 
        title={mode === 'COUNT' ? "未完成货品" : "待订货品"} 
        side="right"
        isOpen={showRightDrawer} 
        onClose={() => setShowRightDrawer(false)}
        filter={(i) => i.status === ItemStatus.PENDING}
      />
      
       {/* Error Modal */}
       {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl">
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <AlertTriangle className="text-orange-500" /> 修正货品信息
                </h3>
                <div className="space-y-4">
                    <input className="w-full border rounded p-2" value={editingItem.name} onChange={e => setEditingItem({...editingItem, name: e.target.value})} placeholder="名称" />
                    <input className="w-full border rounded p-2" value={editingItem.spec} onChange={e => setEditingItem({...editingItem, spec: e.target.value})} placeholder="规格" />
                    <input className="w-full border rounded p-2" value={editingItem.unit} onChange={e => setEditingItem({...editingItem, unit: e.target.value})} placeholder="单位" />
                </div>
                <div className="flex gap-3 mt-6">
                    <button onClick={() => setShowErrorModal(false)} className="flex-1 py-2 rounded-lg bg-slate-100">取消</button>
                    <button onClick={saveErrorEdit} className="flex-1 py-2 rounded-lg bg-brand-600 text-white">保存</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Workshop;