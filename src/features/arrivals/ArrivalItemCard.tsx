import { Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { ProductRow } from '../../services/arrivals.service';
import type { ArrivalImageType, ArrivalImageWithUrl } from '../../services/arrival-images.service';
import { ArrivalImageSection } from './ArrivalImageSection';
import { isProhibitedArrivalUnit, type ArrivalDraftItem } from './arrivalForm';

interface ArrivalItemCardProps {
  canRemove: boolean;
  index: number;
  item: ArrivalDraftItem;
  images: ArrivalImageWithUrl[];
  onChange: (item: ArrivalDraftItem) => void;
  onDeleteImage: (image: ArrivalImageWithUrl) => Promise<void>;
  onRemove: () => void;
  onUploadImage: (
    file: File,
    imageType: ArrivalImageType,
    onProgress: (progress: number) => void,
  ) => Promise<unknown>;
  products: ProductRow[];
}

const useDebouncedValue = (value: string, delay: number) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
};

export function ArrivalItemCard({
  canRemove,
  index,
  item,
  images,
  onChange,
  onDeleteImage,
  onRemove,
  onUploadImage,
  products,
}: ArrivalItemCardProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const query = useDebouncedValue(item.productName.trim().toLocaleLowerCase('zh-CN'), 250);
  const matches = useMemo(() => {
    if (!query) return products.slice(0, 6);
    return products.filter((product) =>
      [product.name, product.spec, product.product_code ?? '']
        .some((value) => value.toLocaleLowerCase('zh-CN').includes(query)),
    ).slice(0, 6);
  }, [products, query]);

  const selectProduct = (product: ProductRow) => {
    onChange({
      ...item,
      isUnmatchedProduct: false,
      productId: product.id,
      productName: product.name,
      spec: product.spec,
      unit: isProhibitedArrivalUnit(product.count_unit) ? '' : product.count_unit,
    });
    setSearchOpen(false);
  };

  const updateProductName = (productName: string) => {
    onChange({
      ...item,
      isUnmatchedProduct: true,
      productId: null,
      productName,
      spec: '',
    });
    setSearchOpen(true);
  };

  return (
    <article className="ui-card p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-brand-700">产品 {index + 1}</p>
          <h3 className="mt-0.5 font-bold text-slate-900">{item.productName || '请选择或填写产品'}</h3>
        </div>
        <button
          aria-label={`删除产品 ${index + 1}`}
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-700 disabled:opacity-40"
          disabled={!canRemove}
          onClick={onRemove}
          type="button"
        >
          <Trash2 className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="relative mt-3">
        <label className="text-sm font-semibold text-slate-700" htmlFor={`arrival-product-${item.id}`}>产品名称</label>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-slate-400" aria-hidden="true" />
          <input
            autoComplete="off"
            className="ui-input pl-10"
            id={`arrival-product-${item.id}`}
            onChange={(event) => updateProductName(event.target.value)}
            onFocus={() => setSearchOpen(true)}
            placeholder="搜索本店货品或手动填写"
            value={item.productName}
          />
        </div>

        {searchOpen && item.productName.trim() ? (
          <div className="absolute inset-x-0 z-20 mt-2 max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
            {matches.length > 0 ? matches.map((product) => (
              <button
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left active:bg-slate-100"
                key={product.id}
                onClick={() => selectProduct(product)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900">{product.name}</span>
                  <span className="block truncate text-xs text-slate-500">{product.spec || '无规格'} · {product.count_unit}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-brand-700">选择</span>
              </button>
            )) : (
              <p className="p-3 text-sm leading-6 text-slate-600">本店货品中没有匹配项，将按手工产品保存。</p>
            )}
            <button className="mt-1 min-h-10 w-full rounded-md bg-slate-100 text-sm font-semibold text-slate-700" onClick={() => setSearchOpen(false)} type="button">收起搜索结果</button>
          </div>
        ) : null}
      </div>

      {item.productId ? (
        <p className="mt-2 rounded-md bg-brand-50 px-3 py-1.5 text-sm text-brand-700">已匹配本店货品 · {item.spec || '无规格'}</p>
      ) : item.productName.trim() ? (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-800">未匹配正式货品，仅用于本次到货记录。</p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-sm font-semibold text-slate-700">
          数量
          <input
            className="ui-input mt-1 text-lg font-semibold"
            inputMode="decimal"
            min="0"
            onChange={(event) => onChange({ ...item, quantity: event.target.value })}
            placeholder="0"
            step="0.001"
            type="number"
            value={item.quantity}
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          单位
          <input
            className="ui-input mt-1"
            onChange={(event) => onChange({ ...item, unit: event.target.value })}
            placeholder="瓶 / 袋 / 盒 / 个"
            value={item.unit}
          />
        </label>
      </div>

      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs font-medium leading-5 text-amber-900">
        请按货品最小单位计数，例如瓶、袋、盒、个、杯、克或毫升；禁止填写箱、整箱、件、整件。
      </p>

      <label className="mt-3 block text-sm font-semibold text-slate-700">
        产品备注（选填）
        <input
          className="ui-input mt-1"
          onChange={(event) => onChange({ ...item, note: event.target.value })}
          placeholder="例如：其中一箱外包装轻微破损"
          value={item.note}
        />
      </label>

      <ArrivalImageSection
        embedded
        imageType="goods"
        images={images}
        onDelete={onDeleteImage}
        onUpload={onUploadImage}
        prompt={`产品 ${index + 1} 至少上传一张拆包后的实际货品照片。`}
        title="拆包货品照片"
      />
    </article>
  );
}
