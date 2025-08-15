// background.js (service worker)
// Receives payloads from content script and forwards to configured endpoint.
// Also handles captureVisibleTab on request.

self.addEventListener('install', () => {
  // noop
});

// 新增: 封装流式处理响应的函数
async function handleStreamResponse(response, tabId) {
  try {
    // 添加响应状态检查
    console.log('PageToAI: response status', response.status);
    console.log('PageToAI: response ok?', response.ok);

    // 获取响应主体的ReadableStream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // 发送初始响应状态
    chrome.tabs.sendMessage(tabId, {
      type: 'stream_start',
      status: response.status,
      ok: response.ok
    });

    // 读取流数据并逐块发送给content script
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // 解码并发送数据块
        const chunk = decoder.decode(value, { stream: true });
        // 修改: 处理SSE格式的数据
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            chrome.tabs.sendMessage(tabId, {
              type: 'stream_chunk',
              chunk: data
            });
          }
        }
      }
    } catch (streamError) {
      // 添加流处理错误日志
      console.error('PageToAI: stream processing failed', streamError);
    } finally {
      reader.releaseLock();
    }

    // 发送结束信号
    chrome.tabs.sendMessage(tabId, {
      type: 'stream_end'
    });
    
    return {ok: response.ok, status: response.status};
  } catch (e) {
    console.error('PageToAI: stream handling failed', e);
    return {ok: false, error: e.message};
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'capture_screenshot') {
    // captureVisibleTab requires the 'tabs' permission; returns dataUrl
    chrome.tabs.captureVisibleTab({format: 'png'}, (dataUrl) => {
      sendResponse({dataUrl});
    });
    return true; // async
  }

  if (msg.type === 'send_payload') {
    (async () => {
      try {
        const cfg = await new Promise((resolve) => {
          chrome.storage.local.get(['endpoint','apiKey'], (items) => resolve(items || {}));
        });
        const endpoint = cfg.endpoint || '';
        const apiKey = cfg.apiKey || '';
        if (!endpoint) {
          console.warn('PageToAI: no endpoint configured (use chrome://extensions to set).');
          sendResponse({ok:false, error:'no_endpoint'});
          return;
        }

        // 添加请求日志
        console.log('PageToAI: sending request to', endpoint);
        console.log('PageToAI: payload', msg.payload);

        // 检查 payload 是否有效
        let body;
        try {
          body = JSON.stringify(msg.payload);
          console.log('PageToAI: payload serialized successfully');
        } catch (serializeError) {
          console.error('PageToAI: payload serialization failed', serializeError);
          sendResponse({ok: false, error: 'payload_serialization_failed'});
          return;
        }

        // 确定请求的端点URL（支持chat路由）
        let requestUrl = endpoint;
        if (msg.payload.question) {
          // 如果存在question字段，使用chat路由
          try {
            const endpointUrl = new URL(endpoint);
            endpointUrl.pathname = '/chat';
            requestUrl = endpointUrl.toString();
          } catch (e) {
            // 如果URL解析失败，直接替换路径
            if (endpoint.endsWith('/ingest')) {
              requestUrl = endpoint.replace('/ingest', '/chat');
            } else {
              requestUrl = endpoint + '/chat';
            }
          }
        }

        // 发送请求并等待响应
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时
        
        const response = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? {'Authorization': `Bearer ${apiKey}`} : {})
          },
          body: body,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // 先发送响应状态给content script，表明发送是否成功
        sendResponse({ok: response.ok, status: response.status});
        
        // 如果发送成功，则处理流式响应
        if (response.ok) {
          await handleStreamResponse(response, sender.tab.id);
        } else {
          console.error('PageToAI: server returned error status', response.status);
          console.error('PageToAI: response text', await response.text());
        }
      } catch (e) {
        // 添加详细的错误日志
        console.error('PageToAI: forward failed', e);
        console.error('PageToAI: endpoint was', cfg.endpoint);
        console.error('PageToAI: apiKey was', cfg.apiKey ? 'set' : 'not set');
        
        // 区分不同类型的错误
        if (e.name === 'AbortError') {
          console.error('PageToAI: request timeout');
          sendResponse({ok: false, error: 'request_timeout'});
        } else if (e instanceof TypeError) {
          console.error('PageToAI: network error or CORS issue');
          sendResponse({ok: false, error: 'network_error'});
        } else {
          sendResponse({ok: false, error: e.message});
        }
      }
    })();
    return true;
  }
});