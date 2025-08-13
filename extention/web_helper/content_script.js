/*
content_script.js
Injects a floating button into each page. When clicked, it collects visible text (and optional screenshot)
and sends a message to background.js to forward the payload to the configured endpoint.
*/

function elementIsVisible(el) {
  try {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    if (rect.bottom < 0 || rect.top > (window.innerHeight || document.documentElement.clientHeight)) return false;
    if (rect.right < 0 || rect.left > (window.innerWidth || document.documentElement.clientWidth)) return false;
    const style = window.getComputedStyle(el);
    if (style && (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) === 0)) return false;
    return true;
  } catch (e) {
    return false;
  }
}
function getVisibleText(maxLen = 20000) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
  let node;
  const parts = [];
  const seen = new Set(); // 用于去重

  while ((node = walker.nextNode())) {
    try {
      if (!elementIsVisible(node)) continue;

      const text = node.innerText?.trim();
      if (text && text.length > 0) {
        if (!seen.has(text)) {  // 去重
          seen.add(text);
          parts.push(text);
        }
      }
    } catch (e) {
      continue;
    }

    // 提前截断，避免性能问题
    if (parts.join('\n').length > maxLen) break;
  }

  const merged = parts.join('\n\n');
  return merged.length > maxLen
    ? merged.slice(0, maxLen) + '\n...[truncated]'
    : merged;
}

// function getVisibleText(maxLen = 20000) {
//   const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
//   // const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
//   let node;
//   const parts = [];
//   while ((node = walker.nextNode())) {
//     try {
//       if (elementIsVisible(node)) {
//         const text = node.innerText;
//         if (text && text.trim().length > 0) {
//           parts.push(text.trim());
//         }
//       }
//     } catch (e) {
//       continue;
//     }
//     if (parts.join('\n').length > maxLen) break;
//   }
//   const merged = parts.join('\n\n');
//   return merged.length > maxLen ? merged.slice(0, maxLen) + '\n...[truncated]' : merged;
// }

async function collectPayload({captureScreenshot = true, reason = 'button_click'} = {}) {
  const payload = {
    url: location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    selectedText: (window.getSelection && window.getSelection().toString()) || '',
    visibleText: getVisibleText(),
    reason
  };

  if (captureScreenshot) {
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({type: 'capture_screenshot'}, (r) => resolve(r));
      });
      if (resp && resp.dataUrl) payload.screenshot = resp.dataUrl;
    } catch (e) {
      console.warn('Screenshot failed', e);
    }
  }

  return payload;
}

function parseMarkdown(text) {
  if (!text) return '';
  // 粗体
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // 斜体
  text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // 换行
  text = text.replace(/\n/g, '<br>');
  // 无序列表
  text = text.replace(/^[-+*] (.*)$/gm, '<ul><li>$1</li></ul>');
  // 有序列表
  text = text.replace(/^\d+\. (.*)$/gm, '<ol><li>$1</li></ol>');
  // 链接
  text = text.replace(/\$$([^$$]+)$$$([^$$]+)$$/g, '<a href="$2">$1</a>');
  // 代码块
  text = text.replace(/^```([\s\S]*?)```$/gm, '<pre><code>$1</code></pre>');
  // 标题
  text = text.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  text = text.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  text = text.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  return text;
}

// 创建流式数据显示窗口
function createStreamWindow() {
  // 如果窗口已存在，直接返回
  if (document.getElementById('ptaistream')) return;
  
  const container = document.createElement('div');
  container.id = 'ptaistream';
  container.className = 'ptaistream-container';
  
  // 窗口头部 - 添加拖拽功能
  const header = document.createElement('div');
  header.className = 'ptaistream-header';
  header.innerHTML = `
    <span>AI 分析结果</span>
  `;
  
  // 添加窗口控制按钮
  const controls = document.createElement('div');
  controls.className = 'ptaistream-controls';
  controls.innerHTML = `
    <button class="ptaistream-close" id="ptaistream-close">×</button>
  `;
  header.appendChild(controls);
  
  // 内容区域 - 修改为支持Markdown渲染的元素
  const content = document.createElement('div');
  content.className = 'ptaistream-content';
  content.id = 'ptaistream-content';
  
  // 通过CSS设置滚动，避免样式冲突
  
  container.appendChild(header);
  container.appendChild(content);
  document.documentElement.appendChild(container);
  
  // 绑定关闭事件
  document.getElementById('ptaistream-close').addEventListener('click', () => {
    container.remove();
  });
  
  // 添加拖拽功能
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;
  
  header.addEventListener('mousedown', dragStart);
  document.addEventListener('mouseup', dragEnd);
  document.addEventListener('mousemove', drag);
  
  function dragStart(e) {
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;
    
    if (e.target === header) {
      isDragging = true;
    }
  }
  
  function dragEnd() {
    initialX = currentX;
    initialY = currentY;
    
    isDragging = false;
  }
  
  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      
      xOffset = currentX;
      yOffset = currentY;
      
      setTranslate(currentX, currentY, container);
    }
  }
  
  function setTranslate(xPos, yPos, el) {
    el.style.transform = "translate3d(" + xPos + "px, " + yPos + "px, 0)";
  }
  
  // 添加缩放功能
  let isResizing = false;
  let startX, startY, startWidth, startHeight;
  let startLeft, startTop;
  let resizeDirection = null;
  
  // 创建各个边缘的resize控制元素
  const rightResize = document.createElement('div');
  rightResize.className = 'ptaistream-resize-edge right';
  container.appendChild(rightResize);
  
  const bottomResize = document.createElement('div');
  bottomResize.className = 'ptaistream-resize-edge bottom';
  container.appendChild(bottomResize);
  
  const leftResize = document.createElement('div');
  leftResize.className = 'ptaistream-resize-edge left';
  container.appendChild(leftResize);
  
  // 添加边缘控制元素的样式
  const resizeStyles = document.createElement('style');
  resizeStyles.textContent = `
    .ptaistream-resize-edge {
      position: absolute;
      z-index: 10001;
    }
    .ptaistream-resize-edge.right {
      right: -5px;
      top: 0;
      width: 10px;
      height: 100%;
      cursor: ew-resize;
    }
    .ptaistream-resize-edge.bottom {
      bottom: -5px;
      left: 0;
      width: 100%;
      height: 10px;
      cursor: ns-resize;
    }
    .ptaistream-resize-edge.left {
      left: -5px;
      top: 0;
      width: 10px;
      height: 100%;
      cursor: ew-resize;
    }
  `;
  document.head.appendChild(resizeStyles);
  
  // 绑定边缘拖拽事件
  [rightResize, bottomResize, leftResize].forEach(edge => {
    edge.addEventListener('mousedown', function(e) {
      isResizing = true;
      resizeDirection = this.className.match(/(right|bottom|left)/)[1];
      startX = e.clientX;
      startY = e.clientY;
      startWidth = parseInt(document.defaultView.getComputedStyle(container).width, 10);
      startHeight = parseInt(document.defaultView.getComputedStyle(container).height, 10);
      startLeft = container.offsetLeft;
      startTop = container.offsetTop;
      e.preventDefault();
      e.stopPropagation();
    });
  });
  
  document.addEventListener('mousemove', function(e) {
    if (isResizing) {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      // 根据拖动方向调整窗口尺寸和位置
      switch(resizeDirection) {
        case 'right':
          const newWidth = startWidth + deltaX;
          if (newWidth > 200) {
            container.style.width = newWidth + 'px';
          }
          break;
          
        case 'bottom':
          const newHeight = startHeight + deltaY;
          if (newHeight > 150) {
            container.style.height = newHeight + 'px';
          }
          break;
          
        case 'left':
          const newWidthLeft = startWidth - deltaX;
          if (newWidthLeft > 200) {
            container.style.width = newWidthLeft + 'px';
            // 同时调整左侧位置以保持右侧固定
            const newLeft = startLeft + deltaX;
            container.style.left = newLeft + 'px';
          }
          break;
      }
    }
  });
  
  document.addEventListener('mouseup', function() {
    isResizing = false;
    resizeDirection = null;
  });
  
  return container;
}

function createButton() {
  // avoid injecting multiple times
  if (document.getElementById('ptaibtn')) return;
  const btn = document.createElement('button');
  btn.id = 'ptaibtn';
  btn.className = 'ptaibtn';
  btn.type = 'button';
  btn.title = 'Send visible page content to configured AI endpoint';
  btn.innerText = 'Send → AI';

  // 添加拖拽功能相关变量
  let isDragging = false;
  let offsetX, offsetY;
  let startPos = { x: 0, y: 0 };

  // 鼠标按下事件
  btn.addEventListener('mousedown', (e) => {
    // 只有在非点击按钮内容区域时才允许拖拽
    if (e.target === btn) {
      isDragging = false;
      startPos = { x: e.clientX, y: e.clientY };
      offsetX = e.clientX - btn.getBoundingClientRect().left;
      offsetY = e.clientY - btn.getBoundingClientRect().top;
      btn.style.cursor = 'grabbing';
      e.preventDefault();
    }
  });

  // 鼠标移动事件
  document.addEventListener('mousemove', (e) => {
    if (offsetX !== undefined && offsetY !== undefined) { // 表示鼠标按下状态
      const deltaX = e.clientX - startPos.x;
      const deltaY = e.clientY - startPos.y;
      
      // 只有移动超过一定距离才算拖拽
      if (!isDragging && (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)) {
        isDragging = true;
      }
      
      if (isDragging) {
        const x = e.clientX - offsetX;
        const y = e.clientY - offsetY;
        
        // 设置按钮位置
        btn.style.left = x + 'px';
        btn.style.top = y + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
      }
    }
  });

  // 鼠标释放事件
  document.addEventListener('mouseup', () => {
    // 重置拖拽状态
    offsetX = undefined;
    offsetY = undefined;
    if (isDragging) {
      isDragging = false;
      btn.style.cursor = 'pointer';
      // 延迟重置isDragging标志，确保click事件能正确识别
      setTimeout(() => {
        isDragging = false;
      }, 10);
    }
  });

  btn.addEventListener('click', async (e) => {
    // 防止拖拽结束后触发点击事件
    if (isDragging) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    
    e.stopPropagation();
    try {
      btn.disabled = true;
      btn.innerText = 'Sending...';
      const payload = await collectPayload({captureScreenshot: true, reason: 'floating_button'});
      
      // 创建流式窗口
      const streamWindow = createStreamWindow();
      const contentArea = document.getElementById('ptaistream-content');
      contentArea.innerText = ''; // 清空之前的内容
      streamWindow.style.display = 'block'; // 显示窗口
      
      // send to background
      chrome.runtime.sendMessage({type:'send_payload', payload}, (resp) => {
        if (resp && resp.ok) {
          btn.innerText = 'Sent ✓';
          setTimeout(() => { btn.innerText = 'Send → AI'; btn.disabled = false; }, 1800);
        } else {
          btn.innerText = 'Error';
          console.warn('PageToAI send failed', resp);
          setTimeout(() => { btn.innerText = 'Send → AI'; btn.disabled = false; }, 2200);
        }
      });
      
      // 监听来自background的消息，流式显示返回内容
      const handleMessage = function(request, sender, sendResponse) {
        if (request.type === 'stream_start') {
          if (contentArea) {
            contentArea.innerText = '[开始接收数据...]\n';
          }
          sendResponse({received: true});
        } else if (request.type === 'stream_chunk') {
          if (contentArea) {
            try {
              const chunk = JSON.parse(request.chunk);
              contentArea.innerHTML += parseMarkdown(chunk);
            } catch (e) {
              contentArea.innerHTML += parseMarkdown(request.chunk);
            }
            contentArea.scrollTop = contentArea.scrollHeight;
          }
          sendResponse({received: true});
        } else if (request.type === 'stream_end') {
          if (contentArea) {
            contentArea.innerText += '\n\n[分析完成]';
          }
          // 移除监听器
          chrome.runtime.onMessage.removeListener(handleMessage);
          sendResponse({received: true});
        }
        return true; // 保持消息通道开放
      };
      
      // 添加消息监听器
      chrome.runtime.onMessage.addListener(handleMessage);
    } catch (err) {
      console.error(err);
      btn.innerText = 'Err';
      setTimeout(() => { btn.innerText = 'Send → AI'; btn.disabled = false; }, 2200);
    }
  }, {capture: true});

  // append to body
  document.documentElement.appendChild(btn);
}

// inject button as soon as DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createButton, {once: true});
} else {
  createButton();
}

// also ensure button exists after SPA navigations (basic observer)
const obs = new MutationObserver(() => {
  if (!document.getElementById('ptaibtn')) createButton();
});
obs.observe(document.documentElement || document.body, {childList: true, subtree: true});

// 添加样式
const style = document.createElement('style');
style.textContent = `
  /* GitHub Markdown Style */
  .ptaistream-content {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    color: #24292e;
    background-color: #ffffff;
    overflow-y: auto;
    padding: 16px;
  }

  /* Headings */
  .ptaistream-content h1, .ptaistream-content h2, .ptaistream-content h3,
  .ptaistream-content h4, .ptaistream-content h5, .ptaistream-content h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
    color: #1f2328;
  }

  /* Code blocks */
  .ptaistream-content pre {
    background-color: #f6f8fa;
    border-radius: 6px;
    font-size: 85%;
    overflow: auto;
    padding: 16px;
    margin-top: 16px;
    margin-bottom: 16px;
  }

  .ptaistream-content code {
    background-color: rgba(27,31,35,0.05);
    border-radius: 3px;
    font-size: 85%;
    margin: 0;
    padding: 0.2em 0.4em;
  }

  /* Lists */
  .ptaistream-content ul, .ptaistream-content ol {
    padding-left: 20px;
    margin-top: 0;
    margin-bottom: 16px;
  }

  .ptaistream-content li {
    margin-bottom: 4px;
  }

  /* Blockquotes */
  .ptaistream-content blockquote {
    margin-left: 0;
    padding: 0 1em;
    color: #6a737d;
    border-left: 0.25em solid #dfe2e5;
  }

  /* Tables */
  .ptaistream-content table {
    border-spacing: 0;
    border-collapse: collapse;
    display: block;
    width: 100%;
    overflow: auto;
  }

  .ptaistream-content th, .ptaistream-content td {
    padding: 6px 13px;
    border: 1px solid #dfe2e5;
  }

  /* Horizontal rules */
  .ptaistream-content hr {
    height: 0.25em;
    margin: 24px 0;
    background-color: #e1e4e8;
    border: 0;
  }

  .ptaistream-container {
    position: fixed;
    top: 50%;
    right: 0;  /* 改为右侧停靠 */
    transform: translateY(-50%);
    width: 40%;  /* 调整宽度 */
    height: 70%;
    background: #222;  /* 深色背景 */
    color: white;  /* 白色文字 */
    border: 2px solid #444;
    border-radius: 8px 0 0 8px;  /* 右侧直角 */
    box-shadow: -4px 0 12px rgba(0,0,0,0.5);  /* 左侧阴影 */
    z-index: 10000;
    display: none;
    flex-direction: column;
    resize: both; /* 允许用户调整大小 */
    overflow: hidden; /* 防止内容溢出 */
  }
  
  .ptaistream-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 15px;
    background: #333;
    border-bottom: 1px solid #555;
    border-radius: 8px 0 0 0;
    cursor: move; /* 显示可以拖拽 */
  }
  
  .ptaistream-header span {
    font-weight: bold;
    font-size: 16px;
    color: #fff;
  }
  
  .ptaistream-controls {
    display: flex;
    gap: 5px;
  }
  
  .ptaistream-close, .ptaistream-resize {
    background: none;
    border: none;
    font-size: 18px;
    color: #ccc;
    cursor: pointer;
    padding: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .ptaistream-close:hover, .ptaistream-resize:hover {
    background: #555;
    border-radius: 50%;
    color: #fff;
  }
  
  .ptaistream-content {
    flex: 1;
    padding: 15px;
    overflow-y: auto; /* 启用垂直滚动 */
    overflow-x: auto; /* 启用水平滚动 */
    font-family: monospace;
    font-size: 14px;
    line-height: 1.5;
    background: #1a1a1a;
    color: #e6e6e6;
    white-space: pre-wrap; /* 支持换行显示 */
    max-height: 85%; /* 限制最大高度 */
  }
  
  /* 添加Markdown渲染相关样式 */
  .ptaistream-content h1,
  .ptaistream-content h2,
  .ptaistream-content h3 {
    color: #fff;
    margin-top: 1em;
    margin-bottom: 0.5em;
  }
  
  .ptaistream-content p {
    margin: 0.5em 0;
    line-height: 1.5;
  }
  
  .ptaistream-content ul,
  .ptaistream-content ol {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }
  
  .ptaistream-content li {
    margin: 0.3em 0;
  }
  
  .ptaistream-content code {
    background-color: #333;
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-family: monospace;
  }
  
  .ptaistream-content pre {
    background-color: #333;
    padding: 1em;
    border-radius: 5px;
    overflow-x: auto;
    overflow-y: auto;
  }
  
  .ptaistream-content pre code {
    background: none;
    padding: 0;
  }
  
  .ptaistream-content blockquote {
    border-left: 3px solid #555;
    padding-left: 1em;
    margin: 0.5em 0;
    color: #ccc;
  }
`;
document.head.appendChild(style);