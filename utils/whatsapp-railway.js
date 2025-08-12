const axios = require('axios');
const https = require('https');

class WhatsAppRailwayService {
    constructor() {
        this.service = process.env.WHATSAPP_SERVICE || 'custom';
        this.customEndpoint = process.env.WHATSAPP_API_ENDPOINT;
        this.apiKey = process.env.WHATSAPP_API_KEY;
        this.templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'otp_verification';
        this.isRailway = process.env.RAILWAY_ENVIRONMENT === 'production';
        this.setupService();
    }

    setupService() {
        if (this.isRailway) {
            console.log('🚂 Railway environment detected - using optimized configuration');
        }
        
        switch (this.service) {
            case 'custom':
                this.setupCustomAPI();
                break;
            case 'console':
                this.setupConsole();
                break;
            default:
                console.warn(`Unknown WhatsApp service: ${this.service}, falling back to console mode`);
                this.setupConsole();
        }
    }

    setupCustomAPI() {
        if (!this.customEndpoint) {
            console.error('Missing WhatsApp API endpoint. Falling back to console mode.');
            this.setupConsole();
            return;
        }

        if (!this.apiKey) {
            console.error('Missing WhatsApp API key. Falling back to console mode.');
            this.setupConsole();
            return;
        }

        console.log('✅ Custom WhatsApp API configured for Railway');
        console.log('📋 Configuration:', {
            endpoint: this.customEndpoint,
            templateName: this.templateName,
            hasApiKey: !!this.apiKey,
            isRailway: this.isRailway
        });
    }

    setupConsole() {
        console.log('📱 Console WhatsApp service configured (for development/fallback)');
    }

    async sendOTP(phone, otp) {
        try {
            const message = this.formatOTPMessage(otp);
            
            switch (this.service) {
                case 'custom':
                    return await this.sendOTPViaCustomAPI(phone, otp);
                case 'console':
                    return await this.sendViaConsole(phone, message);
                default:
                    return await this.sendViaConsole(phone, message);
            }
        } catch (error) {
            console.error('WhatsApp OTP error:', error);
            return {
                success: false,
                message: 'Failed to send WhatsApp OTP',
                error: error.message
            };
        }
    }

    async sendOTPViaCustomAPI(phone, otp) {
        try {
            console.log('📤 Sending OTP via Facebook Graph API...');
            
            const formattedPhone = this.formatPhoneForWhatsApp(phone);
            
            const payload = {
                messaging_product: "whatsapp",
                to: formattedPhone,
                type: "template",
                template: {
                    name: this.templateName,
                    language: {
                        code: "en_US"
                    },
                    components: [
                        {
                            type: "body",
                            parameters: [
                                {
                                    type: "text",
                                    text: otp
                                }
                            ]
                        }
                    ]
                }
            };

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            };

            // Railway-optimized axios configuration
            const axiosConfig = {
                headers,
                timeout: 30000,
                maxRedirects: 5,
                validateStatus: (status) => status < 500,
                httpsAgent: new https.Agent({
                    keepAlive: true,
                    timeout: 30000,
                    rejectUnauthorized: true,
                    // Railway-specific settings
                    family: 4, // Force IPv4
                    lookup: (hostname, options, callback) => {
                        // Custom DNS lookup for Railway
                        require('dns').lookup(hostname, { family: 4 }, callback);
                    }
                })
            };

            console.log('🌐 Making request to Facebook Graph API...');
            const response = await axios.post(this.customEndpoint, payload, axiosConfig);

            console.log('✅ Facebook Graph API response:', {
                status: response.status,
                statusText: response.statusText,
                hasData: !!response.data
            });

            return {
                success: true,
                message: 'OTP sent successfully via WhatsApp',
                provider: 'facebook-graph-api',
                response: response.data
            };

        } catch (error) {
            console.error('❌ Facebook Graph API error:', {
                message: error.message,
                code: error.code,
                status: error.response?.status,
                statusText: error.response?.statusText,
                isNetworkError: !error.response && !error.request,
                isTimeout: error.code === 'ECONNABORTED',
                isDNS: error.code === 'ENOTFOUND'
            });

            // Provide specific error messages
            let errorMessage = 'Failed to send OTP via Facebook Graph API';
            
            if (error.code === 'ECONNABORTED') {
                errorMessage = 'Facebook Graph API request timed out - Railway network issue';
            } else if (error.code === 'ENOTFOUND') {
                errorMessage = 'Cannot resolve Facebook Graph API hostname - DNS issue';
            } else if (error.code === 'ECONNREFUSED') {
                errorMessage = 'Facebook Graph API connection refused - network blocked';
            } else if (error.response?.status === 401) {
                errorMessage = 'Facebook Graph API authentication failed';
            } else if (error.response?.status === 403) {
                errorMessage = 'Facebook Graph API permission denied';
            } else if (error.response?.status === 404) {
                errorMessage = 'Facebook Graph API endpoint not found';
            }

            return {
                success: false,
                message: errorMessage,
                error: error.response?.data || error.message,
                status: error.response?.status,
                code: error.code
            };
        }
    }

    formatPhoneForWhatsApp(phone) {
        // Remove any non-digit characters and ensure proper format
        let cleaned = phone.replace(/\D/g, '');
        
        // If it starts with 0, replace with country code (assuming India +91)
        if (cleaned.startsWith('0')) {
            cleaned = '91' + cleaned.substring(1);
        }
        
        // If it doesn't start with country code, add +91
        if (!cleaned.startsWith('91')) {
            cleaned = '91' + cleaned;
        }
        
        return cleaned;
    }

    formatOTPMessage(otp) {
        return `Your Stoory verification code is: ${otp}. This code will expire in 10 minutes.`;
    }

    async sendViaConsole(phone, message) {
        console.log('📱 [CONSOLE MODE] WhatsApp Message:');
        console.log(`   To: ${phone}`);
        console.log(`   Message: ${message}`);
        console.log('   ⚠️  This is console mode - no actual WhatsApp message sent');
        
        return {
            success: true,
            message: 'OTP logged to console (development mode)',
            provider: 'console'
        };
    }
}

module.exports = new WhatsAppRailwayService();
