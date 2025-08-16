#!/bin/bash

echo "🚀 Azure SQL MCP Server (Node.js) kurulumu başlıyor..."

# Node.js kontrolü
if ! command -v node &> /dev/null; then
    echo "❌ Node.js bulunamadı. Lütfen Node.js 18+ yükleyin."
    echo "   Kurulum: https://nodejs.org/ veya 'brew install node'"
    exit 1
fi

# Node.js version kontrolü
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ gerekli. Mevcut version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) bulundu"

# npm kontrolü
if ! command -v npm &> /dev/null; then
    echo "❌ npm bulunamadı. Node.js ile birlikte yüklenmiş olmalı."
    exit 1
fi

echo "✅ npm $(npm -v) bulundu"

# Package.json kontrolü
if [ ! -f "package.json" ]; then
    echo "❌ package.json bulunamadı. Doğru dizinde olduğunuzdan emin olun."
    exit 1
fi

# Bağımlılıkları yükle
echo "📦 Bağımlılıklar yükleniyor..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Bağımlılık yükleme hatası"
    exit 1
fi

echo "✅ Bağımlılıklar başarıyla yüklendi"

# .env dosyası kontrolü ve oluşturma
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "📝 .env dosyası oluşturuluyor..."
        cp .env.example .env
        echo "✏️  Lütfen .env dosyasını düzenleyin ve Azure bilgilerinizi girin."
    else
        echo "📝 .env dosyası oluşturuluyor..."
        cat > .env << 'EOF'
# Azure SQL Server Configuration
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=your-database

# Azure Entra ID Configuration (Service Principal - Opsiyonel)
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
EOF
        echo "✏️  .env dosyası oluşturuldu. Lütfen Azure bilgilerinizi girin."
    fi
else
    echo "✅ .env dosyası mevcut"
fi

# Executable yapma
chmod +x src/server.js
chmod +x test/test-connection.js

echo ""
echo "✅ Kurulum tamamlandı!"
echo ""
echo "📋 Sonraki adımlar:"
echo "1. .env dosyasını düzenleyin ve Azure bilgilerinizi girin"
echo "2. Bağlantıyı test edin: npm test"
echo "3. MCP konfigürasyonunu ekleyin"
echo ""
echo "🔧 MCP Konfigürasyon örneği (.kiro/settings/mcp.json):"
echo '{'
echo '  "mcpServers": {'
echo '    "azure-sql": {'
echo '      "command": "node",'
echo '      "args": ["src/server.js"],'
echo '      "cwd": "'$(pwd)'",'
echo '      "env": {'
echo '        "AZURE_SQL_SERVER": "your-server.database.windows.net",'
echo '        "AZURE_SQL_DATABASE": "your-database"'
echo '      },'
echo '      "disabled": false,'
echo '      "autoApprove": ["list_tables", "get_table_schema"]'
echo '    }'
echo '  }'
echo '}'
echo ""
echo "🚀 Server başlatmak için: npm start"
echo "🧪 Test çalıştırmak için: npm test"