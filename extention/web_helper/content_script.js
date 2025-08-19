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

// function parseMarkdown(text) {
//   if (!text) return '';
  
//   // 初始化markdown-it实例
//   const md = window.markdownit({
//     html: false,        // 禁用HTML标签
//     xhtmlOut: false,    // 不使用XHTML输出
//     breaks: false,      // 不转换\n为<br>
//     langPrefix: 'language-',  // 代码块语言前缀
//     linkify: true,      // 自动链接URL
//     typographer: true,  // 启用替换符号
//     quotes: '“”‘’',     // 引号样式
//     highlight: function (str, lang) {
//       // 代码高亮处理
//       if (lang && hljs.getLanguage(lang)) {
//         try {
//           return hljs.highlight(str, { language: lang }).value;
//         } catch (__) {}
//       }
//       return ''; // 使用外部默认的转义
//     }
//   });
  
//   // 添加任务列表支持
//   md.use(window.markdownItTaskLists);
  
//   // 渲染Markdown
//   return md.render(text);
// }

function parseMarkdown(text) {
  // 用 markdown-it 解析
  if (typeof window.markdownit !== 'undefined') {
    return window.markdownit().render(text);
  } else {
    // 如果markdown-it不可用，回退到基本的文本处理
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/!\[(.*?)\]\((.*?)\)/g, '<img alt="$1" src="$2">')
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
  }
}

// 添加一个变量来存储累积的内容
let accumulatedContent = '[正在生成中...]';

// 创建流式数据显示窗口
function createStreamWindow() {
  // 如果窗口已存在，直接返回
  if (document.getElementById('ptaistream')) return;
  
  // 重置累积内容
  accumulatedContent = '';
  
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
  
  // 添加输入区域
  const inputContainer = document.createElement('div');
  inputContainer.className = 'ptaistream-input-container';
  
  const input = document.createElement('textarea');
  input.placeholder = '输入问题以继续对话...';
  input.className = 'ptaistream-input';
  input.id = 'ptaistream-input';
  
  const sendButton = document.createElement('button');
  sendButton.innerText = '发送';
  sendButton.className = 'ptaistream-send-button';
  sendButton.id = 'ptaistream-send-button';
  
  inputContainer.appendChild(input);
  inputContainer.appendChild(sendButton);
  
  container.appendChild(header);
  container.appendChild(content);
  container.appendChild(inputContainer);
  document.documentElement.appendChild(container);
  
  // 绑定关闭事件
  document.getElementById('ptaistream-close').addEventListener('click', () => {
    // 发送停止流式传输的消息到background
    chrome.runtime.sendMessage({type: 'stop_stream'});
    container.remove();
  });
  
  // 绑定发送事件
  sendButton.addEventListener('click', sendQuestion);
  input.addEventListener('keypress', (e) => {
    // 修改为Enter发送，Ctrl+Enter换行
    if (e.key === 'Enter' && !e.ctrlKey) {
      sendQuestion();
      e.preventDefault(); // 防止换行
    } else if (e.key === 'Enter' && e.ctrlKey) {
      // Ctrl+Enter换行 - 这是默认行为，不需要额外处理
      // 但我们需要阻止发送
      e.stopPropagation();
    }
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

// 发送问题的函数
async function sendQuestion() {
  const input = document.getElementById('ptaistream-input');
  const contentArea = document.getElementById('ptaistream-content');
  const question = input.value.trim();
  
  if (!question) return;
  
  // 显示用户问题
  accumulatedContent += `\n\n**你:**\n\n${question}\n\n`;
  contentArea.innerHTML = parseMarkdown(accumulatedContent);

  input.value = '';
  input.disabled = true;
  document.getElementById('ptaistream-send-button').disabled = true;
  
  try {
    // 收集当前页面内容作为上下文
    const payload = await collectPayload({captureScreenshot: false, reason: 'follow_up_question'});
    payload.question = question; // 添加用户问题
    
    // 发送到后台处理
    chrome.runtime.sendMessage({type:'send_payload', payload}, (resp) => {
      if (!resp || !resp.ok) {
        contentArea.innerHTML += '\n[发送问题时出错]\n';
        input.disabled = false;
        document.getElementById('ptaistream-send-button').disabled = false;
      }
    });
    
    // 监听来自background的消息，流式显示返回内容
    const handleMessage = function(request, sender, sendResponse) {
      if (request.type === 'stream_start') {
        if (contentArea) {
          accumulatedContent += '**AI:**\n\n';
          contentArea.innerHTML = parseMarkdown(accumulatedContent);
        }
        sendResponse({received: true});
      } else if (request.type === 'stream_chunk') {
        if (contentArea) {
          try {
            const chunk = JSON.parse(request.chunk);
            accumulatedContent += chunk;
          } catch (e) {
            accumulatedContent += request.chunk;
          }
          // 更新整个内容区域而不是追加
          contentArea.innerHTML = parseMarkdown(accumulatedContent);
          contentArea.scrollTop = contentArea.scrollHeight;
        }
        sendResponse({received: true});
      } else if (request.type === 'stream_end') {
        // 启用输入框
        input.disabled = false;
        document.getElementById('ptaistream-send-button').disabled = false;
        
        // 移除监听器
        chrome.runtime.onMessage.removeListener(handleMessage);
        sendResponse({received: true});
      }
      return true;
    };
    
    // 添加消息监听器
    chrome.runtime.onMessage.addListener(handleMessage);
  } catch (err) {
    console.error(err);
    contentArea.innerHTML += '\n[发送问题时出错]\n';
    input.disabled = false;
    document.getElementById('ptaistream-send-button').disabled = false;
  }
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
            accumulatedContent = '[开始接收数据...]\n\n';
            contentArea.innerHTML = parseMarkdown(accumulatedContent);
          }
          sendResponse({received: true});
        } else if (request.type === 'stream_chunk') {
          if (contentArea) {
            try {
              const chunk = JSON.parse(request.chunk);
              accumulatedContent += chunk;
            } catch (e) {
              accumulatedContent += request.chunk;
            }
            // 更新整个内容区域而不是追加
            contentArea.innerHTML = parseMarkdown(accumulatedContent);
            contentArea.scrollTop = contentArea.scrollHeight;
          }
          sendResponse({received: true});
        } else if (request.type === 'stream_end') {
          if (contentArea) {
            accumulatedContent += '\n\n[分析完成]';
            contentArea.innerHTML = parseMarkdown(accumulatedContent);
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

// // 添加highlight.js库
// const highlightScript = document.createElement('script');
// highlightScript.src = 'https://cdn.jsdelivr.net/npm/highlight.js@11.8.0/dist/highlight.min.js';
// document.head.appendChild(highlightScript);

// // 添加highlight.js样式
// const highlightStyles = document.createElement('link');
// highlightStyles.rel = 'stylesheet';
// highlightStyles.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11.8.0/styles/github-dark.min.css';
// document.head.appendChild(highlightStyles);

// 添加样式
const style = document.createElement('style');
style.textContent = `
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
    display: flex;
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
  
  /* GitHub Markdown Style */
  .ptaistream-content {
    flex: 1;
    overflow-y: auto; /* 启用垂直滚动 */
    overflow-x: auto; /* 启用水平滚动 */
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    color: #e6e6e6ff;
    background-color: rgba(39, 40, 46, 1);
    white-space: normal; /* 让 HTML 标签正常渲染 */
    padding: 10px;
    height: calc(100% - 140px); /* 调整高度以适应输入框 */
    padding-bottom: 20px; /* 添加下边缘填充避免内容被截断 */
    margin-bottom: 10px;
    margin-left: 5px;
    // 添加明显的边框
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  
  /* 修复列表序号显示问题 */
  .ptaistream-content ol, .ptaistream-content ul {
    padding-left: 20px;
    margin-left: 0;
  }
  
  .ptaistream-content li {
    padding-left: 5px;
  }
  
  // .ptaistream-content code, .ptaistream-content pre {
  //     font-family: monospace;
  // }
  
  /* 添加输入区域样式 */
  .ptaistream-input-container {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    padding: 10px;
    background: #333;
    border-top: 1px solid #555;
    flex-shrink: 0; /* 防止输入框被压缩 */
  }
  
  .ptaistream-input {
    flex: 1;
    padding: 8px;
    border: 1px solid #555;
    border-radius: 4px;
    background: #222;
    color: #fff;
  }
  
  .ptaistream-send-button {
    margin-left: 10px;
    padding: 8px 16px;
    background: #1a73e8;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  
  .ptaistream-send-button:hover {
    background: #0d62c9;
  }
  
  .ptaistream-send-button:disabled {
    background: #555;
    cursor: not-allowed;
  }
  
  /* 加载GitHub Markdown CSS */
  .ptaistream-content {
    @import url(chrome.runtime.getURL('css/github-markdown.css'));
  }
`;
document.head.appendChild(style);

// 添加本地markdown-it库的引用
const markdownItScript = document.createElement('script');
markdownItScript.src = chrome.runtime.getURL('vendor/markdown-it.min.js');
document.head.appendChild(markdownItScript);
