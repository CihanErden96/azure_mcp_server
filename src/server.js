#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import sql from 'mssql';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import dotenv from 'dotenv';

// Environment variables yükle
dotenv.config();

class AzureSQLConnection {
  constructor() {
    this.pool = null;
    this.config = {
      server: process.env.AZURE_SQL_SERVER,
      database: process.env.AZURE_SQL_DATABASE,
      authentication: {
        type: 'azure-active-directory-access-token'
      },
      options: {
        encrypt: true,
        trustServerCertificate: false,
        connectTimeout: 30000,
        requestTimeout: 30000
      }
    };
    
    this.tenantId = process.env.AZURE_TENANT_ID;
    this.clientId = process.env.AZURE_CLIENT_ID;
    this.clientSecret = process.env.AZURE_CLIENT_SECRET;
  }

  async getAccessToken() {
    try {
      let credential;
      
      if (this.clientId && this.clientSecret && this.tenantId) {
        // Service Principal authentication
        credential = new ClientSecretCredential(
          this.tenantId,
          this.clientId,
          this.clientSecret
        );
      } else {
        // Default credential (managed identity, Azure CLI, etc.)
        credential = new DefaultAzureCredential();
      }
      
      const tokenResponse = await credential.getToken('https://database.windows.net/.default');
      return tokenResponse.token;
    } catch (error) {
      console.error('Token alma hatası:', error);
      throw error;
    }
  }

  async connect() {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }

    try {
      const accessToken = await this.getAccessToken();
      
      // Access token'ı config'e ekle
      this.config.authentication.options = {
        token: accessToken
      };

      this.pool = new sql.ConnectionPool(this.config);
      await this.pool.connect();
      
      console.log('Azure SQL\'e başarıyla bağlandı');
      return this.pool;
    } catch (error) {
      console.error('Bağlantı hatası:', error);
      throw error;
    }
  }

  async executeQuery(query, parameters = []) {
    try {
      const pool = await this.connect();
      const request = pool.request();
      
      // Parametreleri ekle
      parameters.forEach((param, index) => {
        request.input(`param${index}`, param);
      });
      
      const result = await request.query(query);
      return result.recordset;
    } catch (error) {
      console.error('Sorgu hatası:', error);
      throw error;
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }
}

// Global connection instance
const sqlConnection = new AzureSQLConnection();

// MCP Server oluştur
const server = new Server(
  {
    name: 'azure-sql-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Araçları listele
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'execute_sql_query',
        description: 'Azure SQL Server\'da SQL sorgusu çalıştır',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Çalıştırılacak SQL sorgusu'
            },
            parameters: {
              type: 'array',
              items: { type: 'string' },
              description: 'SQL parametreleri (opsiyonel)'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'get_table_schema',
        description: 'Tablo şemasını getir',
        inputSchema: {
          type: 'object',
          properties: {
            table_name: {
              type: 'string',
              description: 'Şeması alınacak tablo adı'
            }
          },
          required: ['table_name']
        }
      },
      {
        name: 'list_tables',
        description: 'Veritabanındaki tabloları listele',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_database_info',
        description: 'Veritabanı bilgilerini getir',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'create_view',
        description: 'Yeni bir görünüm (view) oluştur',
        inputSchema: {
          type: 'object',
          properties: {
            view_name: {
              type: 'string',
              description: 'Oluşturulacak görünümün adı'
            },
            query: {
              type: 'string',
              description: 'Görünüm için SELECT sorgusu'
            },
            replace_if_exists: {
              type: 'boolean',
              description: 'Mevcut görünümü değiştir (varsayılan: false)',
              default: false
            }
          },
          required: ['view_name', 'query']
        }
      },
      {
        name: 'create_stored_procedure',
        description: 'Yeni bir saklı yordam (stored procedure) oluştur',
        inputSchema: {
          type: 'object',
          properties: {
            procedure_name: {
              type: 'string',
              description: 'Oluşturulacak saklı yordamın adı'
            },
            parameters: {
              type: 'string',
              description: 'Saklı yordam parametreleri (örn: @param1 INT, @param2 VARCHAR(50))'
            },
            body: {
              type: 'string',
              description: 'Saklı yordamın gövdesi (SQL kodları)'
            },
            replace_if_exists: {
              type: 'boolean',
              description: 'Mevcut saklı yordamı değiştir (varsayılan: false)',
              default: false
            }
          },
          required: ['procedure_name', 'body']
        }
      },
      {
        name: 'list_views',
        description: 'Veritabanındaki görünümleri listele',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'list_stored_procedures',
        description: 'Veritabanındaki saklı yordamları listele',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ]
  };
});

// Araç çağrılarını işle
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'execute_sql_query': {
        const { query, parameters = [] } = args;
        const results = await sqlConnection.executeQuery(query, parameters);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2)
            }
          ]
        };
      }

      case 'get_table_schema': {
        const { table_name } = args;
        const schemaQuery = `
          SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            COLUMN_DEFAULT,
            CHARACTER_MAXIMUM_LENGTH,
            NUMERIC_PRECISION,
            NUMERIC_SCALE
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_NAME = @param0
          ORDER BY ORDINAL_POSITION
        `;
        
        const results = await sqlConnection.executeQuery(schemaQuery, [table_name]);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2)
            }
          ]
        };
      }

      case 'list_tables': {
        const tablesQuery = `
          SELECT 
            TABLE_NAME,
            TABLE_TYPE,
            TABLE_SCHEMA
          FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_TYPE = 'BASE TABLE'
          ORDER BY TABLE_SCHEMA, TABLE_NAME
        `;
        
        const results = await sqlConnection.executeQuery(tablesQuery);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2)
            }
          ]
        };
      }

      case 'get_database_info': {
        const infoQuery = `
          SELECT 
            @@VERSION as sql_version,
            DB_NAME() as database_name,
            @@SERVERNAME as server_name,
            GETDATE() as current_datetime
        `;
        
        const results = await sqlConnection.executeQuery(infoQuery);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2)
            }
          ]
        };
      }

      case 'create_view': {
        const { view_name, query, replace_if_exists = false } = args;
        
        // Görünüm adını temizle (SQL injection koruması)
        const cleanViewName = view_name.replace(/[^a-zA-Z0-9_]/g, '');
        
        let createViewQuery;
        if (replace_if_exists) {
          createViewQuery = `
            IF OBJECT_ID('${cleanViewName}', 'V') IS NOT NULL
              DROP VIEW ${cleanViewName};
            CREATE VIEW ${cleanViewName} AS
            ${query}
          `;
        } else {
          createViewQuery = `CREATE VIEW ${cleanViewName} AS ${query}`;
        }
        
        await sqlConnection.executeQuery(createViewQuery);
        
        return {
          content: [
            {
              type: 'text',
              text: `Görünüm '${cleanViewName}' başarıyla oluşturuldu.`
            }
          ]
        };
      }

      case 'create_stored_procedure': {
        const { procedure_name, parameters = '', body, replace_if_exists = false } = args;
        
        // Saklı yordam adını temizle (SQL injection koruması)
        const cleanProcName = procedure_name.replace(/[^a-zA-Z0-9_]/g, '');
        
        let createProcQuery;
        if (replace_if_exists) {
          createProcQuery = `
            IF OBJECT_ID('${cleanProcName}', 'P') IS NOT NULL
              DROP PROCEDURE ${cleanProcName};
            CREATE PROCEDURE ${cleanProcName}
            ${parameters ? parameters : ''}
            AS
            BEGIN
              ${body}
            END
          `;
        } else {
          createProcQuery = `
            CREATE PROCEDURE ${cleanProcName}
            ${parameters ? parameters : ''}
            AS
            BEGIN
              ${body}
            END
          `;
        }
        
        await sqlConnection.executeQuery(createProcQuery);
        
        return {
          content: [
            {
              type: 'text',
              text: `Saklı yordam '${cleanProcName}' başarıyla oluşturuldu.`
            }
          ]
        };
      }

      case 'list_views': {
        const viewsQuery = `
          SELECT 
            TABLE_NAME as view_name,
            TABLE_SCHEMA as schema_name,
            VIEW_DEFINITION as definition
          FROM INFORMATION_SCHEMA.VIEWS
          ORDER BY TABLE_SCHEMA, TABLE_NAME
        `;
        
        const results = await sqlConnection.executeQuery(viewsQuery);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2)
            }
          ]
        };
      }

      case 'list_stored_procedures': {
        const proceduresQuery = `
          SELECT 
            ROUTINE_NAME as procedure_name,
            ROUTINE_SCHEMA as schema_name,
            CREATED as created_date,
            LAST_ALTERED as last_modified
          FROM INFORMATION_SCHEMA.ROUTINES
          WHERE ROUTINE_TYPE = 'PROCEDURE'
          ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
        `;
        
        const results = await sqlConnection.executeQuery(proceduresQuery);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(`Bilinmeyen araç: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Hata: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Server kapatılıyor...');
  await sqlConnection.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Server sonlandırılıyor...');
  await sqlConnection.close();
  process.exit(0);
});

// Server'ı başlat
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('Azure SQL MCP Server başlatıldı');
}

main().catch((error) => {
  console.error('Server başlatma hatası:', error);
  process.exit(1);
});