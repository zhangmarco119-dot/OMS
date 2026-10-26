const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
exports.iconSvg=(nodes,{color='#334155',strokeWidth=2,size=24,absoluteStrokeWidth=false}={})=>{
  const allowed=new Set(['path','circle','ellipse','line','polyline','polygon','rect','g']);
  const content=nodes.map(([tag,attributes])=>{
    if(!allowed.has(tag))throw new Error('Unsupported icon primitive');
    const attrs=Object.entries(attributes).filter(([name])=>name!=='key'&&!/^on/i.test(name)&&!/(?:href|src)/i.test(name)).map(([name,value])=>' '+name.replace(/[A-Z]/g,char=>'-'+char.toLowerCase())+'="'+escape(value)+'"').join('');
    return '<'+tag+attrs+'/>';
  }).join('');
  const width=absoluteStrokeWidth?Number(strokeWidth)*24/Number(size):Number(strokeWidth);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+escape(size)+'" height="'+escape(size)+'" viewBox="0 0 24 24" fill="none" stroke="'+escape(color)+'" stroke-width="'+width+'" stroke-linecap="round" stroke-linejoin="round">'+content+'</svg>';
};
