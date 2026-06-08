#!/bin/bash
# ECS 一键部署脚本
# 用法:
#   1. git pull（或首次 git clone）
#   2. 配置 .env 文件（cp .env.example .env && vim .env）
#   3. bash deploy.sh

set -e

echo "📦 安装 Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
fi
echo "Node.js 版本: $(node -v)"

# 检查 .env 是否存在
if [ ! -f .env ]; then
    echo "⚠️  未找到 .env 文件，从模板创建..."
    cp .env.example .env
    echo "请编辑 .env 填写 MySQL 等配置后重新运行: vim .env"
    exit 1
fi

echo "📦 安装依赖..."
npm config set registry https://registry.npmmirror.com
npm install --omit=dev

echo "🔧 安装 PM2..."
npm install -g pm2 2>/dev/null || true

echo "🚀 启动服务..."
pm2 delete dingtalk-relay 2>/dev/null || true
pm2 start src/server.js --name dingtalk-relay
pm2 save
pm2 startup 2>/dev/null || true

echo ""
echo "✅ 部署完成！"
echo "📡 服务地址: http://$(curl -s ifconfig.me 2>/dev/null || echo '?'):80"
echo "🔍 查看日志: pm2 logs dingtalk-relay"
echo "📊 查看状态: pm2 status"
