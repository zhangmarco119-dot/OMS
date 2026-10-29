import { useId, type ReactNode } from 'react';

export const PAYROLL_REFERENCE_TEXT = '薪资计算仅供参考，具体薪资构成以实际为准';

/** A repeated decorative layer stays in screenshots without blocking controls. */
export function PayrollReferenceWatermark({ children }: { children: ReactNode }) {
  const patternId = `payroll-reference-${useId().replace(/:/g, '')}`;
  return <div className="relative grid gap-3" data-testid="payroll-reference-watermark">
    {children}
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full select-none" data-testid="payroll-watermark-layer">
      <defs><pattern id={patternId} width="330" height="110" patternUnits="userSpaceOnUse"><text x="165" y="60" textAnchor="middle" transform="rotate(-18 165 55)" fill="#64748b" fillOpacity="0.25" fontSize="14" fontFamily="Microsoft YaHei,sans-serif">{PAYROLL_REFERENCE_TEXT}</text></pattern></defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  </div>;
}
