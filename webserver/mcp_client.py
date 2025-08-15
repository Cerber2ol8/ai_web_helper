from fastmcp import Client

client = Client("DevToolsServer", command=["python", "mcp_server/server.py"])

def call_tool(tool_name: str, **kwargs):
    return client.call_tool(tool_name, kwargs)
