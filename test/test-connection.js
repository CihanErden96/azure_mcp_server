#!/usr/bin/env node

import dotenv from 'dotenv';
import sql from 'mssql';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';

// Environment variables yükle
dotenv.config();

class TestConnection {
    constructor() {
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
    }

    async getAccessToken() {
        try {
            let credential;

            if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) {
                console.log('🔑 Service Principal authentication kullanılıyor...');
                credential = new ClientSecretCredential(
                    process.env.AZURE_TENANT_ID,
                    process.env.AZURE_CLIENT_ID,
                    process.env.AZURE_CLIENT_SECRET
                );
            } else {
                console.log('🔑 Default Azure Credential kullanılıyor...');
                credential = new DefaultAzureCredential();
            }

            const tokenResponse = await credential.getToken('https://database.windows.net/.default');
            return tokenResponse.token;
        } catch (error) {
            console.error('❌ Token alma hatası:', error.message);
            throw error;
        }
    }

    async testConnection() {
        console.log('🚀 Azure SQL MCP Server bağlantı testi başlıyor...\n');

        // Environment variables kontrolü
        const requiredVars = ['AZURE_SQL_SERVER', 'AZURE_SQL_DATABASE'];
        const missingVars = requiredVars.filter(varName => !process.env[varName]);

        if (missingVars.length > 0) {
            console.error(`❌ Eksik environment variables: ${missingVars.join(', ')}`);
            return false;
        }

        console.log(`📊 Server: ${process.env.AZURE_SQL_SERVER}`);
        console.log(`📊 Database: ${process.env.AZURE_SQL_DATABASE}\n`);

        let pool = null;

        try {
            // Access token al
            console.log('🔄 Access token alınıyor...');
            const accessToken = await this.getAccessToken();
            console.log('✅ Access token başarıyla alındı\n');

            // Connection config'i güncelle
            this.config.authentication.options = {
                token: accessToken
            };

            // Bağlantıyı test et
            console.log('🔄 Azure SQL\'e bağlanıyor...');
            pool = new sql.ConnectionPool(this.config);
            await pool.connect();
            console.log('✅ Bağlantı başarılı!\n');

            // SQL Server version test
            console.log('🔄 SQL Server version sorgulanıyor...');
            const versionResult = await pool.request().query('SELECT @@VERSION as version');
            const version = versionResult.recordset[0].version;
            console.log(`✅ SQL Server Version: ${version.substring(0, 80)}...\n`);

            // Database info test
            console.log('🔄 Database bilgileri alınıyor...');
            const dbInfoResult = await pool.request().query(`
        SELECT 
          DB_NAME() as database_name,
          @@SERVERNAME as server_name,
          GETDATE() as current_datetime
      `);
            const dbInfo = dbInfoResult.recordset[0];
            console.log(`✅ Database: ${dbInfo.database_name}`);
            console.log(`✅ Server: ${dbInfo.server_name}`);
            console.log(`✅ Current Time: ${dbInfo.current_datetime}\n`);

            // Tablo sayısı test
            console.log('🔄 Tablo sayısı sorgulanıyor...');
            const tableCountResult = await pool.request().query(`
        SELECT COUNT(*) as table_count 
        FROM INFORMATION_SCHEMA.TABLES 
        WHERE TABLE_TYPE = 'BASE TABLE'
      `);
            const tableCount = tableCountResult.recordset[0].table_count;
            console.log(`✅ Toplam tablo sayısı: ${tableCount}\n`);

            // Basit performans testi
            console.log('🔄 Performans testi yapılıyor...');
            const startTime = Date.now();
            await pool.request().query('SELECT 1 as test');
            const endTime = Date.now();
            console.log(`✅ Sorgu süresi: ${endTime - startTime}ms\n`);

            console.log('🎉 Tüm testler başarılı!');
            return true;

        } catch (error) {
            console.error(`❌ Test hatası: ${error.message}`);
            if (error.code) {
                console.error(`❌ Error Code: ${error.code}`);
            }
            return false;
        } finally {
            if (pool) {
                try {
                    await pool.close();
                    console.log('🔌 Bağlantı kapatıldı');
                } catch (closeError) {
                    console.error('⚠️  Bağlantı kapatma hatası:', closeError.message);
                }
            }
        }
    }
}

// Test çalıştır
const tester = new TestConnection();
const success = await tester.testConnection();
process.exit(success ? 0 : 1);