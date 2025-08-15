from fastmcp import FastMCP, Client
from tools.code_executor import run_code


mcp = FastMCP("DevToolsServer", host="127.0.0.1", port=9001)

@mcp.tool
def greet(name: str) -> str:
    return f"Hello, {name}!"

# 注册工具
mcp.tool(run_code)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
