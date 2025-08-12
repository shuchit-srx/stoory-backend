const axios = require('axios');
const https = require('https');

async function testNetworkConnectivity() {
    console.log('🔍 Testing network connectivity from Railway...');
    
    const tests = [
        {
            name: 'Facebook Graph API DNS',
            url: 'https://graph.facebook.com',
            method: 'GET'
        },
        {
            name: 'Facebook Graph API Health',
            url: 'https://graph.facebook.com/v22.0/',
            method: 'GET'
        },
        {
            name: 'Google DNS',
            url: 'https://8.8.8.8',
            method: 'GET'
        }
    ];

    for (const test of tests) {
        try {
            console.log(`\n📡 Testing: ${test.name}`);
            console.log(`🌐 URL: ${test.url}`);
            
            const response = await axios({
                method: test.method,
                url: test.url,
                timeout: 10000,
                validateStatus: () => true,
                httpsAgent: new https.Agent({
                    keepAlive: true,
                    timeout: 10000,
                    rejectUnauthorized: true
                })
            });
            
            console.log(`✅ Success: ${response.status} ${response.statusText}`);
            
        } catch (error) {
            console.error(`❌ Failed: ${error.message}`);
            console.error(`   Code: ${error.code}`);
            console.error(`   Type: ${error.name}`);
        }
    }
}

// Run the test
testNetworkConnectivity().catch(console.error);
