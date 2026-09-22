import { Search, X } from 'lucide-react';
import { useId } from 'react';

interface ArrivalProductSearchProps {
  ariaLabel: string;
  className?: string;
  clearAriaLabel: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}

export function ArrivalProductSearch({ ariaLabel, className = '', clearAriaLabel, onChange, placeholder, value }: ArrivalProductSearchProps) {
  const inputId = useId();
  return <div className={`min-w-0 ${className}`}>
    <label className="sr-only" htmlFor={inputId}>{ariaLabel}</label>
    <div className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 transition focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-100">
      <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      <input
        aria-label={ariaLabel}
        className="ui-search-input min-w-0 flex-1 appearance-none bg-transparent py-2 text-base leading-6 text-slate-900 outline-none placeholder:text-slate-400"
        enterKeyHint="search"
        inputMode="search"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
      {value ? <button aria-label={clearAriaLabel} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 active:bg-slate-200" onClick={() => onChange('')} type="button"><X className="h-4 w-4" aria-hidden="true" /></button> : null}
    </div>
  </div>;
}
