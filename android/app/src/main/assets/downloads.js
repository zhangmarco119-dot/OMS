(() => {
  if (window.__storehubAndroidDownloads || !window.StoreHubDownloads) return;
  window.__storehubAndroidDownloads = true;
  const send = value => window.StoreHubDownloads.postMessage(JSON.stringify(value));
  let busy = false;
  const exportBlob = async (url, filename) => {
    if (busy) { send({ action: 'error', message: '请先完成当前文件保存' }); return; }
    busy = true;
    try {
      // Start fetching synchronously: existing exports revoke the URL immediately after click().
      const response = await fetch(url);
      const blob = await response.blob();
      if (blob.size > 50 * 1024 * 1024) throw new Error('文件超过 50MB，请使用网页版下载');
      send({ action: 'start', name: filename || 'StoreHub导出文件', mime: blob.type || 'application/octet-stream', size: blob.size });
      for (let offset = 0; offset < blob.size; offset += 49152) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 49152).arrayBuffer());
        send({ action: 'chunk', data: btoa(String.fromCharCode(...bytes)) });
      }
      send({ action: 'finish' });
    } catch (error) {
      send({ action: 'error', message: error.message || '文件导出失败，请重试' });
    } finally { busy = false; }
  };
  const intercept = link => {
    if (link.href.startsWith('blob:') && link.hasAttribute('download')) {
      void exportBlob(link.href, link.download);
      return true;
    }
    return false;
  };
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!intercept(this)) originalClick.call(this);
  };
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a');
    if (link && intercept(link)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
})();
