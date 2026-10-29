exports.installNativeDialogs = (window, wx) => {
  let queue = Promise.resolve();
  window.__storehubConfirm = content => {
    const next = queue.then(() => new Promise(resolve => wx.showModal({
      title: '请确认操作', content: String(content), confirmText: '确认', cancelText: '取消',
      success: result => resolve(result.confirm === true), fail: () => resolve(false),
    })));
    queue = next.catch(() => false);
    return next;
  };
};
