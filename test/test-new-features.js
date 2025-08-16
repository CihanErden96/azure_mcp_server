#!/usr/bin/env node

import dotenv from 'dotenv';
import sql from 'mssql';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';

// Environment variables yükle
dotenv.config();

class NewFeaturesTest {
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

    async testNewFeatures() {
        console.log('🚀 Azure SQL MCP Server yeni özellikler testi başlıyor...\n');

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

            // Test tablosu oluştur
            console.log('🔄 Test tablosu oluşturuluyor...');
            await this.createTestTable(pool);
            console.log('✅ Test tablosu oluşturuldu\n');

            // Test görünümü oluştur
            console.log('🔄 Test görünümü oluşturuluyor...');
            await this.testCreateView(pool);
            console.log('✅ Test görünümü oluşturuldu\n');

            // Görünümleri listele
            console.log('🔄 Görünümler listeleniyor...');
            await this.testListViews(pool);
            console.log('✅ Görünümler listelendi\n');

            // Test saklı yordamı oluştur
            console.log('🔄 Test saklı yordamı oluşturuluyor...');
            await this.testCreateStoredProcedure(pool);
            console.log('✅ Test saklı yordamı oluşturuldu\n');

            // Saklı yordamları listele
            console.log('🔄 Saklı yordamlar listeleniyor...');
            await this.testListStoredProcedures(pool);
            console.log('✅ Saklı yordamlar listelendi\n');

            // Temizlik
            console.log('🔄 Test nesneleri temizleniyor...');
            await this.cleanup(pool);
            console.log('✅ Temizlik tamamlandı\n');

            console.log('🎉 Tüm yeni özellik testleri başarılı!');
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

    async createTestTable(pool) {
        const createTableQuery = `
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='TestEmployees' AND xtype='U')
            CREATE TABLE TestEmployees (
                ID INT IDENTITY(1,1) PRIMARY KEY,
                Name NVARCHAR(100) NOT NULL,
                Department NVARCHAR(50),
                Salary DECIMAL(10,2),
                HireDate DATE
            )
        `;
        
        await pool.request().query(createTableQuery);
        
        // Test verisi ekle
        const insertDataQuery = `
            IF NOT EXISTS (SELECT * FROM TestEmployees)
            BEGIN
                INSERT INTO TestEmployees (Name, Department, Salary, HireDate) VALUES
                ('Ahmet Yılmaz', 'IT', 75000.00, '2020-01-15'),
                ('Ayşe Kaya', 'HR', 65000.00, '2019-03-20'),
                ('Mehmet Demir', 'Finance', 80000.00, '2021-06-10'),
                ('Fatma Şahin', 'IT', 70000.00, '2020-11-05')
            END
        `;
        
        await pool.request().query(insertDataQuery);
    }

    async testCreateView(pool) {
        const createViewQuery = `
            IF OBJECT_ID('vw_ITEmployees', 'V') IS NOT NULL
                DROP VIEW vw_ITEmployees;
            CREATE VIEW vw_ITEmployees AS
            SELECT Name, Salary, HireDate
            FROM TestEmployees
            WHERE Department = 'IT'
        `;
        
        await pool.request().query(createViewQuery);
        
        // Görünümü test et
        const testViewQuery = 'SELECT * FROM vw_ITEmployees';
        const result = await pool.request().query(testViewQuery);
        console.log(`   📋 Görünümde ${result.recordset.length} kayıt bulundu`);
    }

    async testListViews(pool) {
        const listViewsQuery = `
            SELECT 
                TABLE_NAME as view_name,
                TABLE_SCHEMA as schema_name
            FROM INFORMATION_SCHEMA.VIEWS
            WHERE TABLE_NAME LIKE '%ITEmployees%'
            ORDER BY TABLE_SCHEMA, TABLE_NAME
        `;
        
        const result = await pool.request().query(listViewsQuery);
        console.log(`   📋 ${result.recordset.length} test görünümü bulundu`);
        result.recordset.forEach(view => {
            console.log(`   - ${view.schema_name}.${view.view_name}`);
        });
    }

    async testCreateStoredProcedure(pool) {
        const createProcQuery = `
            IF OBJECT_ID('sp_GetEmployeesByDepartment', 'P') IS NOT NULL
                DROP PROCEDURE sp_GetEmployeesByDepartment;
            CREATE PROCEDURE sp_GetEmployeesByDepartment
                @Department NVARCHAR(50)
            AS
            BEGIN
                SELECT Name, Salary, HireDate
                FROM TestEmployees
                WHERE Department = @Department
                ORDER BY Salary DESC
            END
        `;
        
        await pool.request().query(createProcQuery);
        
        // Saklı yordamı test et
        const testProcQuery = 'EXEC sp_GetEmployeesByDepartment @Department = \'IT\'';
        const result = await pool.request().query(testProcQuery);
        console.log(`   📋 Saklı yordam ${result.recordset.length} kayıt döndürdü`);
    }

    async testListStoredProcedures(pool) {
        const listProcsQuery = `
            SELECT 
                ROUTINE_NAME as procedure_name,
                ROUTINE_SCHEMA as schema_name,
                CREATED as created_date
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_TYPE = 'PROCEDURE'
            AND ROUTINE_NAME LIKE '%GetEmployeesByDepartment%'
            ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
        `;
        
        const result = await pool.request().query(listProcsQuery);
        console.log(`   📋 ${result.recordset.length} test saklı yordamı bulundu`);
        result.recordset.forEach(proc => {
            console.log(`   - ${proc.schema_name}.${proc.procedure_name} (${proc.created_date})`);
        });
    }

    async cleanup(pool) {
        const cleanupQueries = [
            'IF OBJECT_ID(\'vw_ITEmployees\', \'V\') IS NOT NULL DROP VIEW vw_ITEmployees',
            'IF OBJECT_ID(\'sp_GetEmployeesByDepartment\', \'P\') IS NOT NULL DROP PROCEDURE sp_GetEmployeesByDepartment',
            'IF OBJECT_ID(\'TestEmployees\', \'U\') IS NOT NULL DROP TABLE TestEmployees'
        ];
        
        for (const query of cleanupQueries) {
            try {
                await pool.request().query(query);
            } catch (error) {
                console.log(`   ⚠️  Temizlik uyarısı: ${error.message}`);
            }
        }
    }
}

// Test çalıştır
const tester = new NewFeaturesTest();
const success = await tester.testNewFeatures();
process.exit(success ? 0 : 1);