import {jsx as originalJsx, jsxs as originalJsxs, Fragment} from 'storehub-original-jsx-runtime';
import {NativeDateInput, NativeDetails, NativePagedChildren} from './native-controls';
export {Fragment};
function nativeType(type: any, props: any) {
  if(type === 'input' && ['date','month','time','datetime-local'].includes(props?.type)) return NativeDateInput;
  if(type === 'details') return NativeDetails;
  return type;
}
function nativeProps(type:any,props:any){
  if(!props || type==='select' || type==='optgroup' || type==='option' || typeof type!=='string')return props;
  const paginate=(items:any)=>items.length>20 && items.every((item:any)=>item && typeof item==='object' && item.key!=null)
    ? originalJsx(NativePagedChildren,{items},`native-list:${items[0].key}`) : items;
  const children=props.children;
  if(!Array.isArray(children))return props;
  return {...props,children:children.some(Array.isArray)?children.map(child=>Array.isArray(child)?paginate(child):child):paginate(children)};
}
export const jsx = (type: any, props: any, key: any) => originalJsx(nativeType(type,props), nativeProps(type,props), key);
export const jsxs = (type: any, props: any, key: any) => {
  const adapted=nativeProps(type,props);
  return (Array.isArray(adapted?.children)?originalJsxs:originalJsx)(nativeType(type,props),adapted,key);
};
