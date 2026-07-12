#!/usr/bin/env python3
"""快速重启阿里云后端服务 - v2"""
import os
import paramiko
import time

HOST = "8.138.201.60"
USER = "root"
PASS = os.environ.get("ECS_PASS", "")

def main():
    if not PASS:
        print("❌ ERROR: 请设置环境变量 ECS_PASS")
        return
    
    print("=" * 60)
    print("🔧 重启阿里云后端服务")
    print("=" * 60)
    
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        print(f"\n[连接] {USER}@{HOST}")
        client.connect(HOST, port=22, username=USER, password=PASS, timeout=15)
        
        # 1. 停止旧进程
        print("\n1️⃣ 停止旧进程...")
        stdin, stdout, stderr = client.exec_command("pkill -f 'uvicorn aliyun_api' 2>/dev/null; sleep 1; echo 'DONE'")
        stdout.channel.recv_exit_status()
        print("   完成")
        
        # 2. 启动服务
        print("\n2️⃣ 启动服务...")
        cmd = "cd /root/app/deploy && source ../venv/bin/activate && python -m uvicorn aliyun_api:app --host 0.0.0.0 --port 80 &"
        client.exec_command(cmd, get_pty=False)
        time.sleep(3)
        print("   完成")
        
        # 3. 验证进程
        print("\n3️⃣ 验证进程...")
        stdin, stdout, stderr = client.exec_command("ps aux | grep 'uvicorn aliyun_api' | grep -v grep")
        out = stdout.read().decode("utf-8")
        if out.strip():
            print("   ✅ 进程已启动")
        else:
            print("   ️  进程未找到")
        
        # 4. 验证端口
        print("\n4️⃣ 验证端口...")
        stdin, stdout, stderr = client.exec_command("ss -ltnp | grep ':80 '")
        out = stdout.read().decode("utf-8")
        if out.strip():
            print("   ✅ 端口已监听")
        else:
            print("   ⚠️  端口未监听")
        
        # 5. 健康检查
        print("\n5️⃣ 健康检查...")
        stdin, stdout, stderr = client.exec_command("curl -s http://127.0.0.1:80/healthz")
        out = stdout.read().decode("utf-8")
        if "ok" in out.lower():
            print(f"   ✅ 成功：{out.strip()}")
        else:
            print(f"   ⚠️  响应：{out.strip() or '无响应'}")
        
        print("\n" + "=" * 60)
        print("✅ 重启完成！")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ 错误：{e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
