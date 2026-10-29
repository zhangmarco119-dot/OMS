exports.installIntlCache = (intl, datePrototype = Date.prototype, numberPrototype = Number.prototype) => {
  if(!intl.DateTimeFormat.polyfilled || intl.__storehubCached)return;
  Object.defineProperty(intl,'__storehubCached',{value:true});
  const cache=new Map();
  const formatter=(kind,locales,options)=>{
    const key=JSON.stringify([kind,locales,options]);
    if(!cache.has(key)){
      if(cache.size>=64)cache.delete(cache.keys().next().value);
      cache.set(key,new intl[kind](locales,options));
    }
    return cache.get(key);
  };
  for(const [method,mode] of [['toLocaleString','all'],['toLocaleDateString','date'],['toLocaleTimeString','time']]){
    Object.defineProperty(datePrototype,method,{configurable:true,writable:true,value:function(locales,options){
      const time=Date.prototype.getTime.call(this);
      if(Number.isNaN(time))return 'Invalid Date';
      const normalized={...options};
      const dateFields=['year','month','day','weekday'],timeFields=['hour','minute','second','fractionalSecondDigits'];
      if(!normalized.dateStyle&&!normalized.timeStyle && ![...dateFields,...timeFields].some(key=>normalized[key]!==undefined)){
        if(mode!=='time')Object.assign(normalized,{year:'numeric',month:'numeric',day:'numeric'});
        if(mode!=='date')Object.assign(normalized,{hour:'numeric',minute:'numeric',second:'numeric'});
      }
      return formatter('DateTimeFormat',locales,normalized).format(time);
    }});
  }
  Object.defineProperty(numberPrototype,'toLocaleString',{configurable:true,writable:true,value:function(locales,options){return formatter('NumberFormat',locales,options).format(Number.prototype.valueOf.call(this));}});
};
