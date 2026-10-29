import React, {createElement, forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react';

// Native picker events are attached directly because React does not delegate
// change events from custom elements. Business handlers receive HTML values.
export const NativeDateInput = forwardRef((props: any, ref) => {
  const {type, value, defaultValue, onChange, className='', min, max, disabled, readOnly, ...rest} = props;
  const [localValue, setLocalValue] = useState(defaultValue || '');
  const current = String(value ?? localValue);
  const dateNode = useRef<any>(null), timeNode = useRef<any>(null);
  const latest = useRef<any>(); latest.current = {props:{...props,onChange}, current};
  useImperativeHandle(ref, () => ({get value() {return latest.current.current;}, focus() {dateNode.current?.focus?.();}}));
  useEffect(() => {
    const date = dateNode.current, time = timeNode.current;
    const handler = (event: any) => {
      const raw = String(event.detail?.value ?? event.target?.value ?? '');
      const previous = latest.current.current;
      const next = type === 'datetime-local' ? `${raw}T${previous.split('T')[1] || '09:00'}` : raw;
      setLocalValue(next);
      const target={value:next,name:latest.current.props.name,type};
      latest.current.props.onChange?.({target,currentTarget:target,nativeEvent:event});
    };
    const timeHandler = (event: any) => {
      const next=`${latest.current.current.split('T')[0] || new Date().toLocaleDateString('sv-SE')}T${event.detail.value}`;
      setLocalValue(next);
      const target={value:next,name:latest.current.props.name,type};
      latest.current.props.onChange?.({target,currentTarget:target,nativeEvent:event});
    };
    date?.addEventListener('change', handler);
    time?.addEventListener('change', timeHandler);
    return () => {date?.removeEventListener('change', handler);time?.removeEventListener('change', timeHandler);};
  }, [type]);
  const picker = (isTime: boolean) => createElement('wx-picker', {
    ref: isTime ? timeNode : dateNode, mode: isTime || type === 'time' ? 'time' : 'date',
    fields: type === 'month' ? 'month' : 'day', value: type === 'datetime-local' ? current.split('T')[isTime?1:0] || '' : current,
    start: min ? (type === 'datetime-local' ? isTime ? current.split('T')[0]===min.split('T')[0] ? min.split('T')[1] : undefined : min.split('T')[0] : min) : undefined,
    end: max ? (type === 'datetime-local' ? isTime ? current.split('T')[0]===max.split('T')[0] ? max.split('T')[1] : undefined : max.split('T')[0] : max) : undefined,
    disabled: disabled || readOnly ? 'true' : undefined,
    className: 'storehub-native-picker',
  }, createElement('span', {className:'storehub-picker-value'}, (type === 'datetime-local' ? current.split('T')[isTime?1:0] : current) || (isTime || type==='time'?'选择时间':type==='month'?'选择月份':'选择日期')));
  return createElement('div', {...rest, className:`${className} storehub-date-input`, 'aria-disabled':disabled || readOnly || undefined}, picker(false), type==='datetime-local'?picker(true):null);
});

export function NativeDetails({children, open=false, onToggle, ...props}: any) {
  const [expanded, setExpanded] = useState(open);
  const content = React.Children.toArray(children);
  const summary: any = content.find((child: any) => child?.type === 'summary');
  return createElement('div', props,
    createElement('button', {...summary?.props, type:'button', 'aria-expanded':expanded, style:{textAlign:'left',width:'100%',...summary?.props.style}, onClick:() => {setExpanded(!expanded);onToggle?.({target:{open:!expanded}});}}, summary?.props.children || '展开详情'),
    expanded ? content.filter(child=>child!==summary) : null);
}

export function NativePagedChildren({items}: any) {
  const [page,setPage]=useState(0);
  const identity=`${items[0]?.key}:${items[items.length-1]?.key}:${items.length}`;
  useEffect(()=>setPage(0),[identity]);
  const pages=Math.ceil(items.length/20),current=Math.min(page,pages-1);
  return createElement(React.Fragment,null,
    items.slice(current*20,(current+1)*20),
    createElement('div',{className:'storehub-list-pagination'},
      createElement('button',{type:'button',className:'ui-button-secondary',disabled:current===0,onClick:()=>setPage(current-1)},'上一页'),
      createElement('span',null,`${current+1}/${pages} 页 · 共 ${items.length} 项`),
      createElement('button',{type:'button',className:'ui-button-secondary',disabled:current>=pages-1,onClick:()=>setPage(current+1)},'下一页')));
}
