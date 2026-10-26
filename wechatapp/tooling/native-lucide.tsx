import {createElement,forwardRef,useEffect,useImperativeHandle,useMemo,useRef,useState} from 'react';
import {iconSvg} from './native-icon.cjs';
const Icon=forwardRef(({color='currentColor',size=24,strokeWidth=2,absoluteStrokeWidth,className='',iconNode=[],...rest},ref)=>{
  const inner=useRef(null),[inheritedColor,setInheritedColor]=useState('#334155');
  useImperativeHandle(ref,()=>inner.current);
  useEffect(()=>{
    let current=true;
    if(color==='currentColor'&&inner.current&&window.$$getComputedStyle)window.$$getComputedStyle(inner.current,['color']).then(style=>{if(current&&style.color)setInheritedColor(style.color);}).catch(()=>{});
    return()=>{current=false;};
  },[color,className]);
  const src=useMemo(()=>{
    const svg=iconSvg(iconNode,{color:color==='currentColor'?inheritedColor:color,size,strokeWidth,absoluteStrokeWidth});
    return 'data:image/svg+xml;base64,'+wx.arrayBufferToBase64(new window.TextEncoder().encode(svg).buffer);
  },[iconNode,color,inheritedColor,size,strokeWidth,absoluteStrokeWidth]);
  const dimension=axis=>{const match=className.match(new RegExp('(?:^|\\s)'+axis+'-(\\d+(?:\\.\\d+)?)(?:\\s|$)'));return match?Number(match[1])*4:Number(size);};
  return createElement('img',{...rest,ref:inner,src,alt:rest['aria-label']||'',className:'lucide '+className,width:dimension('w'),height:dimension('h'),style:{display:'inline-block',verticalAlign:'middle',flexShrink:0,width:dimension('w'),height:dimension('h'),...rest.style}});
});
export default Icon;
