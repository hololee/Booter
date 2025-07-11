#!/usr/bin/env python3
import subprocess
import sys
import os

def run_server():
    """Run the server using uv"""
    try:
        # Change to the project directory
        os.chdir('/Users/jonghyeok/Desktop/me/projects/wol_python')
        
        # Run the server using uv
        cmd = ['uv', 'run', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8005']
        print(f"Running command: {' '.join(cmd)}")
        
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        
        # Print real-time output
        for line in iter(process.stdout.readline, ''):
            print(line, end='')
        
        process.wait()
        
    except Exception as e:
        print(f"Error: {e}")
        return False
    
    return True

if __name__ == "__main__":
    run_server()