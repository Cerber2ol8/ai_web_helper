import subprocess, tempfile, os, shutil, sys

def run_in_venv(code: str) -> str:
    print("Running in venv")
    temp_dir = tempfile.mkdtemp()
    venv_path = os.path.join(temp_dir, "venv")
    code_path = os.path.join(temp_dir, "script.py")
    subprocess.run([sys.executable, "-m", "venv", venv_path], check=True)
    
    # 根据操作系统设置正确的路径
    if os.name == 'nt':  # Windows
        pip_path = os.path.join(venv_path, "Scripts", "pip")
        python_path = os.path.join(venv_path, "Scripts", "python")
    else:  # Unix/Linux/MacOS
        pip_path = os.path.join(venv_path, "bin", "pip")
        python_path = os.path.join(venv_path, "bin", "python")
        
    with open(code_path, "w", encoding="utf-8") as f:
        f.write(code)
    try:
        # subprocess.run([pip_path, "install", "--quiet", "numpy"], check=True)
        result = subprocess.run([python_path, code_path], capture_output=True, text=True, timeout=10)
        return result.stdout + result.stderr
    finally:
        shutil.rmtree(temp_dir)