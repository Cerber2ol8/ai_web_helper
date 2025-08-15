import asyncio
from fastmcp import Client



async def example():
    async with Client("http://127.0.0.1:9001/mcp") as client:
        # await client.ping()
        # await client.call_tool("greet", arguments={"name": "World"})
        code_to_run = "print(sum(range(5)))"
        result = await client.call_tool("run_code", arguments={"code": code_to_run})
        print(result.data)



if __name__ == "__main__":
    asyncio.run(example())