const axios = require('axios');
const https = require('https');

async function testFacebookAPI() {
    console.log('🔍 Testing Facebook Graph API configuration...');
    
    // Get environment variables
    const endpoint = process.env.WHATSAPP_API_ENDPOINT;
    const apiKey = process.env.WHATSAPP_API_KEY;
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
    
    console.log('📋 Configuration:');
    console.log('  Endpoint:', endpoint);
    console.log('  API Key:', apiKey ? 'SET' : 'MISSING');
    console.log('  Template:', templateName);
    
    if (!endpoint || !apiKey) {
        console.error('❌ Missing required environment variables');
        return;
    }
    
    // Test 1: Basic API connectivity
    console.log('\n🧪 Test 1: Basic API connectivity');
    try {
        const response = await axios.get('https://graph.facebook.com/v22.0/', {
            timeout: 10000,
            validateStatus: () => true
        });
        console.log('✅ Facebook Graph API is accessible:', response.status);
    } catch (error) {
        console.error('❌ Facebook Graph API not accessible:', error.message);
        return;
    }
    
    // Test 2: Phone number ID validation
    console.log('\n🧪 Test 2: Phone number ID validation');
    try {
        const phoneNumberId = endpoint.split('/')[6]; // Extract from URL
        console.log('📱 Phone Number ID:', phoneNumberId);
        
        const phoneResponse = await axios.get(`https://graph.facebook.com/v22.0/${phoneNumberId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 10000,
            validateStatus: () => true
        });
        
        console.log('📱 Phone Number Status:', phoneResponse.status);
        if (phoneResponse.data) {
            console.log('📱 Phone Number Info:', {
                verified_name: phoneResponse.data.verified_name,
                code_verification_status: phoneResponse.data.code_verification_status,
                quality_rating: phoneResponse.data.quality_rating
            });
        }
    } catch (error) {
        console.error('❌ Phone number validation failed:', error.message);
    }
    
    // Test 3: Template validation
    console.log('\n🧪 Test 3: Template validation');
    try {
        const templatesResponse = await axios.get(`https://graph.facebook.com/v22.0/${endpoint.split('/')[6]}/message_templates`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            timeout: 10000,
            validateStatus: () => true
        });
        
        console.log('📋 Templates Status:', templatesResponse.status);
        if (templatesResponse.data && templatesResponse.data.data) {
            const templates = templatesResponse.data.data;
            console.log('📋 Available templates:', templates.map(t => ({
                name: t.name,
                status: t.status,
                category: t.category
            })));
            
            const targetTemplate = templates.find(t => t.name === templateName);
            if (targetTemplate) {
                console.log('✅ Target template found:', {
                    name: targetTemplate.name,
                    status: targetTemplate.status,
                    category: targetTemplate.category
                });
            } else {
                console.error('❌ Target template not found:', templateName);
            }
        }
    } catch (error) {
        console.error('❌ Template validation failed:', error.message);
    }
    
    // Test 4: Send test message (will fail but show detailed error)
    console.log('\n🧪 Test 4: Send test message');
    try {
        const testPayload = {
            messaging_product: "whatsapp",
            to: "919876543210", // Test number
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
        
        console.log('📦 Test payload:', JSON.stringify(testPayload, null, 2));
        
        const testResponse = await axios.post(endpoint, testPayload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            timeout: 30000,
            validateStatus: () => true
        });
        
        console.log('📤 Test response status:', testResponse.status);
        console.log('📤 Test response data:', testResponse.data);
        
    } catch (error) {
        console.error('❌ Test message failed:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
    }
}

// Run the test
testFacebookAPI().catch(console.error);
