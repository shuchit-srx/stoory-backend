#!/usr/bin/env node

/**
 * WhatsApp Railway Test Script
 * 
 * This script helps debug WhatsApp connectivity issues when deploying to Railway.
 * Run this script to test your WhatsApp configuration before deploying.
 */

require('dotenv').config();
const axios = require('axios');

class WhatsAppRailwayTester {
    constructor() {
        this.endpoint = process.env.WHATSAPP_API_ENDPOINT;
        this.apiKey = process.env.WHATSAPP_API_KEY;
        this.timeout = parseInt(process.env.WHATSAPP_TIMEOUT) || 30000;
    }

    async runTests() {
        console.log('🚀 WhatsApp Railway Connectivity Test');
        console.log('=====================================\n');

        // Test 1: Environment Variables
        await this.testEnvironmentVariables();

        // Test 2: Network Connectivity
        await this.testNetworkConnectivity();

        // Test 3: Facebook Graph API Access
        await this.testFacebookGraphAPI();

        // Test 4: WhatsApp Template
        await this.testWhatsAppTemplate();

        console.log('\n✅ Testing completed!');
    }

    async testEnvironmentVariables() {
        console.log('1️⃣ Testing Environment Variables...');
        
        const requiredVars = [
            'WHATSAPP_API_ENDPOINT',
            'WHATSAPP_API_KEY',
            'WHATSAPP_TEMPLATE_NAME'
        ];

        let allGood = true;
        
        for (const varName of requiredVars) {
            const value = process.env[varName];
            if (!value) {
                console.log(`   ❌ ${varName}: Missing`);
                allGood = false;
            } else {
                console.log(`   ✅ ${varName}: ${varName.includes('KEY') ? '***' + value.slice(-4) : value}`);
            }
        }

        if (allGood) {
            console.log('   ✅ All environment variables are set\n');
        } else {
            console.log('   ❌ Some environment variables are missing\n');
        }
    }

    async testNetworkConnectivity() {
        console.log('2️⃣ Testing Network Connectivity...');
        
        try {
            // Test basic internet connectivity
            const response = await axios.get('https://httpbin.org/get', {
                timeout: 10000
            });
            console.log('   ✅ Basic internet connectivity: OK');

            // Test Facebook Graph API connectivity
            if (this.endpoint && this.endpoint.includes('graph.facebook.com')) {
                try {
                    const fbResponse = await axios.get('https://graph.facebook.com/v18.0/me', {
                        params: { access_token: this.apiKey },
                        timeout: this.timeout
                    });
                    console.log('   ✅ Facebook Graph API connectivity: OK');
                    console.log(`   📱 Connected as: ${fbResponse.data.name || 'Unknown'}`);
                } catch (error) {
                    console.log('   ❌ Facebook Graph API connectivity: Failed');
                    console.log(`   🔍 Error: ${error.response?.data?.error?.message || error.message}`);
                }
            } else {
                console.log('   ⚠️  Skipping Facebook Graph API test (endpoint not configured)');
            }

        } catch (error) {
            console.log('   ❌ Basic internet connectivity: Failed');
            console.log(`   🔍 Error: ${error.message}`);
        }

        console.log('');
    }

    async testFacebookGraphAPI() {
        console.log('3️⃣ Testing Facebook Graph API Access...');
        
        if (!this.endpoint || !this.apiKey) {
            console.log('   ⚠️  Skipping (missing endpoint or API key)\n');
            return;
        }

        try {
            // Test the specific endpoint
            const testPayload = {
                messaging_product: "whatsapp",
                to: "1234567890", // Test phone number
                type: "template",
                template: {
                    name: process.env.WHATSAPP_TEMPLATE_NAME || "otp_verification",
                    language: {
                        code: "en_US"
                    },
                    components: [
                        {
                            type: "body",
                            parameters: [
                                {
                                    type: "text",
                                    text: "123456"
                                }
                            ]
                        }
                    ]
                }
            };

            const response = await axios.post(this.endpoint, testPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                timeout: this.timeout
            });

            if (response.status === 200) {
                console.log('   ✅ Facebook Graph API endpoint: Accessible');
                console.log(`   📊 Response status: ${response.status}`);
            } else {
                console.log(`   ⚠️  Facebook Graph API endpoint: Unexpected status ${response.status}`);
            }

        } catch (error) {
            console.log('   ❌ Facebook Graph API endpoint: Failed');
            
            if (error.response) {
                console.log(`   📊 Status: ${error.response.status}`);
                console.log(`   🔍 Error: ${JSON.stringify(error.response.data, null, 2)}`);
            } else if (error.code === 'ECONNABORTED') {
                console.log(`   ⏰ Timeout: Request took longer than ${this.timeout}ms`);
            } else if (error.code === 'ENOTFOUND') {
                console.log('   🌐 Network: Cannot resolve hostname');
            } else if (error.code === 'ECONNREFUSED') {
                console.log('   🔌 Connection: Connection refused');
            } else {
                console.log(`   🔍 Error: ${error.message}`);
            }
        }

        console.log('');
    }

    async testWhatsAppTemplate() {
        console.log('4️⃣ Testing WhatsApp Template...');
        
        if (!this.endpoint || !this.apiKey) {
            console.log('   ⚠️  Skipping (missing endpoint or API key)\n');
            return;
        }

        const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
        if (!templateName) {
            console.log('   ❌ WhatsApp template name not configured');
            console.log('');
            return;
        }

        try {
            // Test template existence by trying to send a message
            const testPayload = {
                messaging_product: "whatsapp",
                to: "1234567890", // This will fail but we can check the error
                type: "template",
                template: {
                    name: templateName,
                    language: {
                        code: "en_US"
                    },
                    components: [
                        {
                            type: "body",
                            parameters: [
                                {
                                    type: "text",
                                    text: "123456"
                                }
                            ]
                        }
                    ]
                }
            };

            const response = await axios.post(this.endpoint, testPayload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                timeout: this.timeout
            });

            console.log('   ✅ Template test completed');
            console.log(`   📊 Response: ${JSON.stringify(response.data, null, 2)}`);

        } catch (error) {
            if (error.response?.data?.error?.code === 100) {
                console.log('   ✅ Template exists (invalid phone number error expected)');
                console.log(`   📱 Template: ${templateName}`);
            } else if (error.response?.data?.error?.code === 1320001) {
                console.log('   ❌ Template not found or not approved');
                console.log(`   📱 Template: ${templateName}`);
                console.log('   💡 Make sure the template is approved in Facebook Business Manager');
            } else {
                console.log('   ⚠️  Template test inconclusive');
                console.log(`   🔍 Error: ${error.response?.data?.error?.message || error.message}`);
            }
        }

        console.log('');
    }
}

// Run the tests
async function main() {
    const tester = new WhatsAppRailwayTester();
    
    try {
        await tester.runTests();
    } catch (error) {
        console.error('❌ Test runner failed:', error.message);
        process.exit(1);
    }
}

// Only run if called directly
if (require.main === module) {
    main();
}

module.exports = WhatsAppRailwayTester;
