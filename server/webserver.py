from openai import OpenAI

from flask import Flask, request, jsonify, Response, render_template_string
import base64
import os
import requests
import json
# 添加time模块用于生成纯数字时间戳
import time
app = Flask(__name__, static_url_path='/static', static_folder='static')

BASE_URL = "http://localhost:8000/v1"
MODEL = "Qwen3-30B-A3B"


OLLAMA_URL = "http://10.111.11.128:11434/api/generate"
OLLAMA_MODEL = "alibayram/Qwen3-30B-A3B-Instruct-2048:latest"

# 读取 HTML 文件内容
with open('index.html', 'r', encoding='utf-8') as f:
    html_content = f.read()


def summarize_with_stream(title, text):
    # prompt = f"你是一个浏览器内容分析助手，下面的内容是用户位于浏览器当前标签页中的信息，结合标签页标题和内容分析当前用户的浏览器内容，随后根据内容使用适当简洁的**中文**进行总结。 \n 如果发现内容中存在问题，尝试给出问题的解决方法。要记住使用中文进行回复。\n如果无法进行有效分析，则回复**未找到有效信息** \ntittle:\n {title}\n content:\n{text}"
    prompt = f"你是一个浏览器内容分析助手，下面的内容是用户位于浏览器中的信息，结合标题 **{title}** 和**内容**，用简洁的**中文**总结以下内容：\n{text} \n 要记住使用中文进行回复，只输出中文总结部分。 \n 如果发现内容中存在问题，尝试给出问题的解决方法。\n如果是技术文章，请总结和分析文章内容。\n如果是论文，请总结和分析论文相关内容。/no_think"
    
    messages = [  

    {"role": "system", "content": prompt},
    ]
    chatbot = OpenAI(
        api_key="key",
        base_url=BASE_URL,
    )

    try:
        stream = chatbot.chat.completions.create(
            model=MODEL,
            messages=messages,
            max_tokens=10240,
            temperature=0.4,
            stream=True
            )

        print("\n[流式摘要开始]:\n", flush=True)
        # 逐个返回数据块
        for event in stream:
            # 只处理内容片段
            if event.choices and event.choices[0].delta.content:
                chunk = event.choices[0].delta.content
                if chunk:
                    print(chunk, end="", flush=True)
                    # 修复: 确保换行符正确传输
                    yield chunk
        
        print("\n[流式摘要结束]\n", flush=True)
    except Exception as e:
        print(f"[调用失败: {e}]")
        yield f"[调用失败: {e}]"

def summarize_with_ollama_stream(title, text):
    prompt = f"你是一个浏览器内容分析助手，下面的内容是用户位于浏览器中的信息，结合标题 {title} 内容提取核心信息，然后用简洁的**中文**总结以下内容：\n{text} \n 要记住使用中文进行回复"

    try:
        r = requests.post(
            OLLAMA_URL,
            json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": True
            },
            stream=True
        )
        r.raise_for_status()

        print("\n[流式摘要开始]:\n", flush=True)
        summary_parts = []
        for line in r.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                obj = json.loads(line)
                chunk = obj.get("response", "")
                if chunk:
                    print(chunk, end="", flush=True)
                    # 修复: 确保换行符正确传输
                    yield chunk
            except json.JSONDecodeError:
                pass
        print("\n[流式摘要结束]\n", flush=True)
        return "".join(summary_parts)
    except Exception as e:
        print(f"[调用失败: {e}]")
        return f"[调用失败: {e}]"


@app.route("/ingest", methods=["POST"])
def ingest():
    data = request.get_json(force=True)
    title = data.get('title')
    print("\n=== New Payload Received ===")
    print(f"URL: {data.get('url')}")
    print(f"Title: {title}")
    print(f"Timestamp: {data.get('timestamp')}")
    print(f"Selected Text: {data.get('selectedText')[:200]}...")
    print(f"Visible Text length: {len(data.get('visibleText', ''))}")

    # 保存截图
    if 'screenshot' in data:
        screenshot_data = data['screenshot'].split(',')[1]
        img_bytes = base64.b64decode(screenshot_data)

        screenshot_dir = "screenshots"
        os.makedirs(screenshot_dir, exist_ok=True)
        # 修改: 使用纯数字时间戳并添加客户端ID
        client_id = data.get('clientId', 'unknown')
        timestamp = int(time.time() * 1000)  # 毫秒级时间戳
        img_path = os.path.join(screenshot_dir, f"{client_id}_{timestamp}.png")
        with open(img_path, "wb") as f:
            f.write(img_bytes)
            
        print(f"Screenshot saved to: {img_path}")

    # 流式调用并返回流式响应
    def generate():
        for chunk in summarize_with_stream(title=title, text=data.get("visibleText", "")[:30000]):
            # 修复: 使用正确的SSE格式，保持换行符
            yield f"data: {json.dumps(chunk)}\n\n"
    
    # 修复: 设置正确的Content-Type
    return Response(generate(), mimetype='text/event-stream')
    
@app.route('/')
def index():
    # 直接渲染 HTML 内容（HTML 内的图片路径指向 /static/pet.png）
    return render_template_string(html_content)
    
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9000, debug=True)