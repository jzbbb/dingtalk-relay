#!/bin/bash
# ECS 一键部署脚本
# 用法: scp 整个项目到 ECS 后执行 bash deploy.sh

set -e

echo "📦 安装 Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
fi
echo "Node.js 版本: $(node -v)"

echo "📦 安装依赖..."
npm install --production

echo "🔧 安装 PM2（进程管理）..."
npm install -g pm2 2>/dev/null || true

echo "🚀 启动服务..."
pm2 delete dingtalk-relay 2>/dev/null || true
pm2 start src/server.js --name dingtalk-relay --env production
pm2 save
pm2 startup 2>/dev/null || true

echo ""
echo "✅ 部署完成！"
echo "📡 服务地址: http://$(curl -s ifconfig.me):80"
echo "🔍 查看日志: pm2 logs dingtalk-relay"
echo "📊 查看状态: pm2 status"
