import tempfile, os, subprocess, shutil
from utils.docker_runner import run_in_docker, docker_available
from utils import docker_runner
from utils.venv_runner import run_in_venv

def run_code(code: str) -> str:
    """
    安全执行代码（优先Docker，回退到venv）
    """
    result = None
    if docker_available():
        result = run_in_docker(code)
    else:
        result = run_in_venv(code)
    return result
