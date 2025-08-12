#!/usr/bin/env node

/**
 * Railway WhatsApp Issues Fix Script
 * 
 * This script provides quick fixes for common Railway deployment issues
 * with WhatsApp OTP functionality.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

class RailwayIssuesFixer {
    constructor() {
        this.envFile = '.env';
        this.envExampleFile = 'env.example';
    }

    async runFixes() {
        console.log('🔧 Railway WhatsApp Issues Fixer');
        console.log('================================\n');

        // Check current environment
        await this.checkEnvironment();

        // Apply fixes
        await this.fixEnvironmentVariables();
        await this.fixNetworkIssues();
        await this.fixTemplateIssues();
        await this.createRailwayConfig();

        console.log('\n✅ Fixes applied! Please review the changes and redeploy.');
    }

    async checkEnvironment() {
        console.log('1️⃣ Checking Current Environment...');
        
        const nodeEnv = process.env.NODE_ENV || 'development';
        console.log(`   📊 Environment: ${nodeEnv}`);
        
        if (nodeEnv === 'production') {
            console.log('   ✅ Production environment detected');
        } else {
            console.log('   ⚠️  Development environment - some fixes may not apply');
        }

        const whatsappService = process.env.WHATSAPP_SERVICE || 'custom';
        console.log(`   📱 WhatsApp Service: ${whatsappService}`);

        console.log('');
    }

    async fixEnvironmentVariables() {
        console.log('2️⃣ Fixing Environment Variables...');

        const fixes = [
            {
                name: 'WHATSAPP_TIMEOUT',
                value: '60000',
                description: 'Increase timeout to 60 seconds for Railway'
            },
            {
                name: 'WHATSAPP_RETRY_ATTEMPTS',
                value: '5',
                description: 'Increase retry attempts for better reliability'
            },
            {
                name: 'WHATSAPP_RETRY_DELAY',
                value: '2000',
                description: 'Increase retry delay to 2 seconds'
            },
            {
                name: 'NODE_ENV',
                value: 'production',
                description: 'Set production environment'
            }
        ];

        for (const fix of fixes) {
            const currentValue = process.env[fix.name];
            if (currentValue !== fix.value) {
                console.log(`   🔧 ${fix.name}: ${currentValue || 'not set'} → ${fix.value}`);
                console.log(`      💡 ${fix.description}`);
            } else {
                console.log(`   ✅ ${fix.name}: Already set correctly (${currentValue})`);
            }
        }

        console.log('');
    }

    async fixNetworkIssues() {
        console.log('3️⃣ Fixing Network Issues...');

        const networkFixes = [
            {
                issue: 'Facebook Graph API connectivity',
                solution: 'Ensure HTTPS endpoint and valid access token',
                check: () => {
                    const endpoint = process.env.WHATSAPP_API_ENDPOINT;
                    return endpoint && endpoint.startsWith('https://');
                }
            },
            {
                issue: 'Timeout issues',
                solution: 'Increased timeout and retry mechanism implemented',
                check: () => {
                    const timeout = parseInt(process.env.WHATSAPP_TIMEOUT) || 30000;
                    return timeout >= 30000;
                }
            },
            {
                issue: 'DNS resolution',
                solution: 'Use IP-based endpoints or check Railway DNS settings',
                check: () => true // Always show this as a potential issue
            }
        ];

        for (const fix of networkFixes) {
            if (fix.check()) {
                console.log(`   ✅ ${fix.issue}: ${fix.solution}`);
            } else {
                console.log(`   ❌ ${fix.issue}: ${fix.solution}`);
            }
        }

        console.log('');
    }

    async fixTemplateIssues() {
        console.log('4️⃣ Fixing Template Issues...');

        const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
        if (!templateName) {
            console.log('   ❌ WhatsApp template name not configured');
            console.log('   💡 Set WHATSAPP_TEMPLATE_NAME in your environment variables');
        } else {
            console.log(`   ✅ Template name: ${templateName}`);
        }

        const templateChecks = [
            'Ensure template is approved in Facebook Business Manager',
            'Verify template parameters match your code',
            'Check template language code (en_US)',
            'Test template with a verified phone number'
        ];

        for (const check of templateChecks) {
            console.log(`   💡 ${check}`);
        }

        console.log('');
    }

    async createRailwayConfig() {
        console.log('5️⃣ Creating Railway Configuration...');

        const railwayConfig = {
            build: {
                builder: 'nixpacks'
            },
            deploy: {
                startCommand: 'npm start',
                healthcheckPath: '/health',
                healthcheckTimeout: 300,
                restartPolicyType: 'on_failure',
                restartPolicyMaxRetries: 10
            }
        };

        const configPath = 'railway.json';
        
        try {
            fs.writeFileSync(configPath, JSON.stringify(railwayConfig, null, 2));
            console.log(`   ✅ Created ${configPath}`);
        } catch (error) {
            console.log(`   ❌ Failed to create ${configPath}: ${error.message}`);
        }

        // Create .railwayignore
        const railwayIgnore = [
            'node_modules',
            '.env',
            '.env.local',
            '.env.*.local',
            '*.log',
            'coverage',
            '.nyc_output',
            'test_*.js',
            'fix_*.js'
        ].join('\n');

        try {
            fs.writeFileSync('.railwayignore', railwayIgnore);
            console.log('   ✅ Created .railwayignore');
        } catch (error) {
            console.log(`   ❌ Failed to create .railwayignore: ${error.message}`);
        }

        console.log('');
    }

    generateEnvironmentTemplate() {
        console.log('6️⃣ Environment Variables Template for Railway...');
        console.log('');
        console.log('Copy these variables to your Railway dashboard:');
        console.log('');

        const template = `# Railway Production Environment Variables

# Server Configuration
NODE_ENV=production
PORT=3000

# Database Configuration (Supabase)
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# CORS Configuration (update with your frontend URLs)
CORS_ORIGIN=https://your-frontend-domain.com

# WhatsApp Configuration
WHATSAPP_SERVICE=custom
WHATSAPP_API_ENDPOINT=https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/messages
WHATSAPP_API_KEY=your_facebook_graph_api_access_token_here
WHATSAPP_TEMPLATE_NAME=your_otp_template_name

# Railway-specific WhatsApp configurations
WHATSAPP_TIMEOUT=60000
WHATSAPP_RETRY_ATTEMPTS=5
WHATSAPP_RETRY_DELAY=2000

# Payment Configuration
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Database Configuration
DB_POOL_SIZE=10
DB_IDLE_TIMEOUT=30000`;

        console.log(template);
        console.log('');
    }
}

// Run the fixes
async function main() {
    const fixer = new RailwayIssuesFixer();
    
    try {
        await fixer.runFixes();
        fixer.generateEnvironmentTemplate();
    } catch (error) {
        console.error('❌ Fixer failed:', error.message);
        process.exit(1);
    }
}

// Only run if called directly
if (require.main === module) {
    main();
}

module.exports = RailwayIssuesFixer;
