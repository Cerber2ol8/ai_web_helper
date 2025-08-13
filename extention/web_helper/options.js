document.addEventListener('DOMContentLoaded', () => {
  // 加载已保存配置
  chrome.storage.local.get(['endpoint', 'apiKey'], (data) => {
    if (data.endpoint) document.getElementById('endpoint').value = data.endpoint;
    if (data.apiKey) document.getElementById('apiKey').value = data.apiKey;
  });

  // 保存配置
  document.getElementById('save').addEventListener('click', () => {
    const endpoint = document.getElementById('endpoint').value.trim();
    const apiKey = document.getElementById('apiKey').value.trim();
    chrome.storage.local.set({ endpoint, apiKey }, () => {
      alert('Settings saved.');
    });
  });
});
