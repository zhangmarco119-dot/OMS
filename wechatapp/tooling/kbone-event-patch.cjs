exports.patchSubmitBubbling = source => {
  const old = 'callSimpleEvent(e,t,a){(a=a||this.getDomNodeFromEvt(t))&&s.$$process(a,new l({touches:t.touches,changedTouches:t.changedTouches,name:e,target:a,eventPhase:l.AT_TARGET,detail:t&&t.detail,$$extra:t&&t.extra,bubbles:!1}))}';
  if (source.split(old).length !== 2) throw new Error('Kbone event adapter changed; review React submit propagation');
  return source.replace(old, () => old.replace('bubbles:!1', 'bubbles:e==="submit"||e==="reset"||e==="change"'));
};
