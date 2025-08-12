const axios = require('axios');

class WhatsAppService {
    constructor() {
        this.service = process.env.WHATSAPP_SERVICE || 'custom';
        this.customEndpoint = process.env.WHATSAPP_API_ENDPOINT;
        this.apiKey = process.env.WHATSAPP_API_KEY;
        this.templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'otp_verification';
        this.setupService();
    }

    setupService() {
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

        console.log('✅ Custom WhatsApp API configured');
    }

    setupConsole() {
        console.log('📱 Console WhatsApp service configured (for development)');
    }

    /**
     * Send OTP via WhatsApp
     */
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

    /**
     * Send welcome message
     */
    async sendWelcome(phone, userName) {
        try {
            const message = this.formatWelcomeMessage(userName);
            
            switch (this.service) {
                case 'custom':
                    return await this.sendWelcomeViaCustomAPI(phone, message);
                case 'console':
                    return await this.sendViaConsole(phone, message);
                default:
                    return await this.sendViaConsole(phone, message);
            }
        } catch (error) {
            console.error('WhatsApp welcome message error:', error);
            return {
                success: false,
                message: 'Failed to send welcome message',
                error: error.message
            };
        }
    }

    /**
     * Send OTP via Custom WhatsApp API (Facebook Graph API)
     */
    async sendOTPViaCustomAPI(phone, otp) {
        try {
            // Format phone number for WhatsApp (remove + and add country code if needed)
            const formattedPhone = this.formatPhoneForWhatsApp(phone);
            
            // Facebook Graph API template message payload for OTP
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
                                    text: otp // OTP parameter
                                }
                            ]
                        },
                        {
                            type: "button",
                            sub_type: "url",
                            index: 0, // button index starts from 0
                            parameters: [
                                {
                                    type: "text",
                                    text: "12345" // Dynamic URL parameter value
                                }
                            ]
                        }
                    ]
                }
            };

            // Headers for Facebook Graph API
            const headers = {
                'Content-Type': 'application/json'
            };

            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            const response = await axios.post(this.customEndpoint, payload, { headers });

            return {
                success: true,
                message: 'OTP sent successfully via WhatsApp',
                provider: 'facebook-graph-api',
                response: response.data
            };
        } catch (error) {
            console.error('Facebook Graph API error:', error.response?.data || error.message);
            
            // Provide more specific error messages
            let errorMessage = 'Failed to send OTP via Facebook Graph API';
            if (error.response?.data?.error) {
                errorMessage = error.response.data.error.message || errorMessage;
            }
            
            return {
                success: false,
                message: errorMessage,
                error: error.response?.data || error.message
            };
        }
    }

    /**
     * Send welcome message via Custom WhatsApp API (Facebook Graph API)
     */
    async sendWelcomeViaCustomAPI(phone, message) {
        try {
            // Format phone number for WhatsApp (remove + and add country code if needed)
            const formattedPhone = this.formatPhoneForWhatsApp(phone);
            
            // For welcome messages, we'll use a simple text message instead of template
            // This prevents the OTP template from being used
            const payload = {
                messaging_product: "whatsapp",
                to: formattedPhone,
                type: "text",
                text: {
                    body: message
                }
            };

            // Headers for Facebook Graph API
            const headers = {
                'Content-Type': 'application/json'
            };

            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            const response = await axios.post(this.customEndpoint, payload, { headers });

            return {
                success: true,
                message: 'Welcome message sent successfully via WhatsApp',
                provider: 'facebook-graph-api',
                response: response.data
            };
        } catch (error) {
            console.error('Facebook Graph API error:', error.response?.data || error.message);
            
            // Provide more specific error messages
            let errorMessage = 'Failed to send welcome message via Facebook Graph API';
            if (error.response?.data?.error) {
                errorMessage = error.response.data.error.message || errorMessage;
            }
            
            return {
                success: false,
                message: errorMessage,
                error: error.response?.data || error.message
            };
        }
    }

    /**
     * Send via Custom WhatsApp API (Facebook Graph API) - DEPRECATED
     * @deprecated Use sendOTPViaCustomAPI or sendWelcomeViaCustomAPI instead
     */
    async sendViaCustomAPI(phone, message) {
        try {
            // Format phone number for WhatsApp (remove + and add country code if needed)
            const formattedPhone = this.formatPhoneForWhatsApp(phone);
            
            // Extract OTP from message (assuming it's the first 6-digit number)
            const otpMatch = message.match(/\*(\d{6})\*/);
            const otp = otpMatch ? otpMatch[1] : '123456'; // fallback
            
            // Facebook Graph API template message payload (working format)
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
                                    text: otp // OTP parameter
                                }
                            ]
                        },
                        {
                            type: "button",
                            sub_type: "url",
                            index: 0, // button index starts from 0
                            parameters: [
                                {
                                    type: "text",
                                    text: "12345" // Dynamic URL parameter value
                                }
                            ]
                        }
                    ]
                }
            };

            // Headers for Facebook Graph API
            const headers = {
                'Content-Type': 'application/json'
            };

            if (this.apiKey) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
            }

            const response = await axios.post(this.customEndpoint, payload, { headers });

            return {
                success: true,
                message: 'OTP sent successfully via WhatsApp',
                provider: 'facebook-graph-api',
                response: response.data
            };
        } catch (error) {
            console.error('Facebook Graph API error:', error.response?.data || error.message);
            
            // Provide more specific error messages
            let errorMessage = 'Failed to send via Facebook Graph API';
            if (error.response?.data?.error) {
                errorMessage = error.response.data.error.message || errorMessage;
            }
            
            return {
                success: false,
                message: errorMessage,
                error: error.response?.data || error.message
            };
        }
    }

    /**
     * Format phone number for WhatsApp (Facebook Graph API)
     */
    formatPhoneForWhatsApp(phone) {
        // Remove any non-digit characters except +
        let formatted = phone.replace(/[^\d+]/g, '');
        
        // If phone doesn't start with +, assume it's a local number and add country code
        if (!formatted.startsWith('+')) {
            // You can customize this based on your default country
            formatted = '+91' + formatted; // Default to India (+91)
        }
        
        // Remove the + for Facebook Graph API
        return formatted.replace('+', '');
    }

    /**
     * Send via Console (for development)
     */
    async sendViaConsole(phone, message) {
        console.log('\n📱 WhatsApp Message (Console Mode)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📞 To: ${phone}`);
        console.log(`📝 Message: ${message}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        return {
            success: true,
            message: 'OTP sent successfully (console mode)',
            provider: 'console'
        };
    }

    /**
     * Format OTP message
     */
    formatOTPMessage(otp) {
        return `🔐 Your Stoory verification code is: *${otp}*

⏰ This code expires in 10 minutes.

🔒 For security, never share this code with anyone.

📱 If you didn't request this code, please ignore this message.`;
    }

    /**
     * Format welcome message
     */
    formatWelcomeMessage(userName) {
        return `🎉 Welcome to Stoory, ${userName}!

✅ Your account has been successfully created.

🚀 You can now:
• Browse campaigns and bids
• Connect with brand owners
• Start earning through influencer marketing

📱 Stay tuned for exciting opportunities!

Best regards,
The Stoory Team`;
    }

    /**
     * Validate phone number format
     */
    validatePhoneNumber(phone) {
        // Basic phone number validation
        const phoneRegex = /^\+[1-9]\d{1,14}$/;
        return phoneRegex.test(phone);
    }

    /**
     * Get service status
     */
    getServiceStatus() {
        return {
            service: this.service,
            configured: this.service === 'custom' ? !!this.customEndpoint : true,
            provider: this.service === 'custom' ? 'facebook-graph-api' : this.service,
            endpoint: this.service === 'custom' ? this.customEndpoint : null
        };
    }
}

module.exports = new WhatsAppService(); 