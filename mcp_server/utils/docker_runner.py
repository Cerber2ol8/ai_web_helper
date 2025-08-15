import subprocess, tempfile, os, shutil

def docker_available():
    try:
        subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return True
    except:
        return False

def run_in_docker(code: str) -> str:
    temp_dir = tempfile.mkdtemp()
    code_path = os.path.join(temp_dir, "script.py")
    with open(code_path, "w", encoding="utf-8") as f:
        f.write(code)
    cmd = [
        "docker", "run", "--rm",
        "--network", "none", "--memory", "256m", "--cpus", "0.5",
        "-v", f"{temp_dir}:/app",
        "python:3.11", "python", "/app/script.py"
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return result.stdout + result.stderr
    finally:
        shutil.rmtree(temp_dir)
