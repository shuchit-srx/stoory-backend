const { supabaseAdmin } = require('../supabase/client');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const whatsappService = require('./whatsapp');

class AuthService {
    constructor() {
        this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
        this.jwtExpiry = '7d'; // 7 days
        
        // Mock login configuration
        this.mockPhone = '9876543210'; // Mock phone number for testing
        this.mockOTP = '123456'; // Mock OTP that always works
    }

    /**
     * Generate OTP
     */
    generateOTP() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /**
     * Send OTP via WhatsApp
     */
    async sendWhatsAppOTP(phone, otp) {
        try {
            const result = await whatsappService.sendOTP(phone, otp);
            return result;
        } catch (error) {
            console.error('WhatsApp OTP error:', error);
            return {
                success: false,
                message: 'Failed to send WhatsApp OTP'
            };
        }
    }

    /**
     * Store OTP in database
     */
    async storeOTP(phone, otp) {
        try {
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

            const { data, error } = await supabaseAdmin
                .from('otp_codes')
                .upsert({
                    phone: phone,
                    otp: otp,
                    expires_at: expiresAt,
                    created_at: new Date()
                })
                .select();

            if (error) {
                throw new Error(`Failed to store OTP: ${error.message}`);
            }

            return { success: true };
        } catch (error) {
            return { 
                success: false, 
                message: error.message
            };
        }
    }

    /**
     * Verify OTP from database
     */
    async verifyStoredOTP(phone, otp) {
        try {
            console.log('🔍 Debug: OTP Verification');
            console.log('   Phone:', phone);
            console.log('   OTP:', otp);
            console.log('   Current Time:', new Date());
            
            const { data, error } = await supabaseAdmin
                .from('otp_codes')
                .select('*')
                .eq('phone', phone)
                .eq('otp', otp)
                .gt('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            console.log('   Database Result:', data);
            console.log('   Database Error:', error);

            if (error || !data) {
                console.log('   ❌ OTP verification failed');
                return { success: false, message: 'Invalid or expired OTP' };
            }

            console.log('   ✅ OTP verification successful');

            // Delete the used OTP
            await supabaseAdmin
                .from('otp_codes')
                .delete()
                .eq('id', data.id);

            return { success: true };
        } catch (error) {
            console.log('   💥 OTP verification error:', error);
            return { success: false, message: 'OTP verification failed' };
        }
    }

    /**
     * Check if user exists
     */
    async checkUserExists(phone) {
        try {
            const { data: existingUser, error } = await supabaseAdmin
                .from('users')
                .select('id, phone, name, email, role')
                .eq('phone', phone)
                .eq('is_deleted', false)
                .single();

            if (error && error.code !== 'PGRST116') {
                return {
                    success: false,
                    message: 'Database error'
                };
            }

            return {
                success: true,
                exists: !!existingUser,
                user: existingUser || null
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to check user existence'
            };
        }
    }

    /**
     * Send OTP to phone number via WhatsApp (for existing users only)
     */
    async sendOTP(phone) {
        try {
            // Handle mock phone number
            if (phone === this.mockPhone) {
                return {
                    success: true,
                    message: `Mock OTP sent successfully! Use OTP: ${this.mockOTP} for testing.`
                };
            }

            // First check if user exists
            const userCheck = await this.checkUserExists(phone);
            if (!userCheck.success) {
                return userCheck;
            }

            if (!userCheck.exists) {
                return {
                    success: false,
                    message: 'Account not found. Please register first.',
                    code: 'USER_NOT_FOUND'
                };
            }

            const otp = this.generateOTP();
            
            // Store OTP in database
            const storeResult = await this.storeOTP(phone, otp);
            if (!storeResult.success) {
                return storeResult;
            }

            // Send via WhatsApp
            const whatsappResult = await this.sendWhatsAppOTP(phone, otp);
            return whatsappResult;
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * Send OTP for registration (new users)
     */
    async sendRegistrationOTP(phone) {
        try {
            // Handle mock phone number
            if (phone === this.mockPhone) {
                return {
                    success: true,
                    message: `Mock registration OTP sent successfully! Use OTP: ${this.mockOTP} for testing.`
                };
            }

            // Check if user already exists
            const userCheck = await this.checkUserExists(phone);
            if (!userCheck.success) {
                return userCheck;
            }

            if (userCheck.exists) {
                return {
                    success: false,
                    message: 'Account already exists. Please login instead.',
                    code: 'USER_ALREADY_EXISTS'
                };
            }

            const otp = this.generateOTP();
            
            // Store OTP in database
            const storeResult = await this.storeOTP(phone, otp);
            if (!storeResult.success) {
                return storeResult;
            }

            // Send via WhatsApp
            const whatsappResult = await this.sendWhatsAppOTP(phone, otp);
            return whatsappResult;
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * Verify OTP and create custom JWT session
     */
    async verifyOTP(phone, token, userData) {
        try {
            // Handle mock phone number and OTP
            if (phone === this.mockPhone && token === this.mockOTP) {
                // Check if mock user exists, if not create one
                const { data: existingUser, error: userError } = await supabaseAdmin
                    .from('users')
                    .select('*')
                    .eq('phone', phone)
                    .eq('is_deleted', false)
                    .single();

                let user = existingUser;

                // If mock user doesn't exist, create one
                if (!existingUser) {
                    const userId = crypto.randomUUID();
                    
                    const userCreateData = {
                        id: userId,
                        phone: phone,
                        name: userData?.name || 'Mock Test User',
                        email: userData?.email || 'mock@test.com',
                        role: userData?.role || 'influencer',
                        gender: userData?.gender || 'other',
                        languages: userData?.languages || ['English'],
                        categories: userData?.categories || ['Technology'],
                        min_range: userData?.min_range || 1000,
                        max_range: userData?.max_range || 50000
                    };
                    
                    const { data: newUser, error: createError } = await supabaseAdmin
                        .from('users')
                        .insert(userCreateData)
                        .select()
                        .single();

                    if (createError) {
                        return {
                            success: false,
                            message: 'Failed to create mock user profile'
                        };
                    }

                    user = newUser;
                } else {
                    // Update existing mock user with provided data
                    if (userData && user) {
                        const updateData = {
                            name: userData.name || user.name,
                            email: userData.email || user.email,
                            role: userData.role || user.role,
                            gender: userData.gender || user.gender,
                            languages: userData.languages || user.languages,
                            categories: userData.categories || user.categories,
                            min_range: userData.min_range || user.min_range,
                            max_range: userData.max_range || user.max_range
                        };

                        const { data: updatedUser, error: updateError } = await supabaseAdmin
                            .from('users')
                            .update(updateData)
                            .eq('id', user.id)
                            .select()
                            .single();

                        if (!updateError) {
                            user = updatedUser;
                        }
                    }
                }

                // Generate JWT token for mock user
                const jwtToken = jwt.sign(
                    {
                        id: user.id,
                        phone: user.phone,
                        role: user.role
                    },
                    this.jwtSecret,
                    { expiresIn: this.jwtExpiry }
                );

                return {
                    success: true,
                    user: user,
                    token: jwtToken,
                    message: 'Mock authentication successful'
                };
            }

            // Verify OTP from database for real users
            const verifyResult = await this.verifyStoredOTP(phone, token);
            if (!verifyResult.success) {
                return verifyResult;
            }

            // Check if user exists in our database
            const { data: existingUser, error: userError } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('phone', phone)
                .eq('is_deleted', false)
                .single();

            if (userError && userError.code !== 'PGRST116') {
                return {
                    success: false,
                    message: 'Database error'
                };
            }

            let user = existingUser;

            // If user doesn't exist, create new user with custom UUID
            if (!existingUser) {
                const userId = crypto.randomUUID();
                
                // Prepare user data for creation
                const userCreateData = {
                    id: userId,
                    phone: phone,
                    role: 'influencer' // Default role
                };
                
                // Add userData fields if provided
                if (userData) {
                    if (userData.name) userCreateData.name = userData.name;
                    if (userData.email) userCreateData.email = userData.email;
                    if (userData.role) userCreateData.role = userData.role;
                    if (userData.gender) userCreateData.gender = userData.gender;
                    if (userData.languages) userCreateData.languages = userData.languages;
                    if (userData.categories) userCreateData.categories = userData.categories;
                    if (userData.min_range) userCreateData.min_range = userData.min_range;
                    if (userData.max_range) userCreateData.max_range = userData.max_range;
                }
                
                const { data: newUser, error: createError } = await supabaseAdmin
                    .from('users')
                    .insert(userCreateData)
                    .select()
                    .single();

                if (createError) {
                    return {
                        success: false,
                        message: 'Failed to create user profile'
                    };
                }

                user = newUser;

                // Send welcome message
                try {
                    await whatsappService.sendWelcome(phone, userData?.name || 'User');
                } catch (error) {
                    console.error('Failed to send welcome message:', error);
                }
            } else {
                // If user exists, update with userData if provided
                if (userData && user) {
                    const updateData = {
                        name: userData.name,
                        email: userData.email,
                        role: userData.role || user.role,
                        gender: userData.gender,
                        languages: userData.languages,
                        categories: userData.categories,
                        min_range: userData.min_range,
                        max_range: userData.max_range
                    };

                    // Remove undefined values
                    Object.keys(updateData).forEach(key => 
                        updateData[key] === undefined && delete updateData[key]
                    );

                    if (Object.keys(updateData).length > 0) {
                        const { data: updatedUser, error: updateError } = await supabaseAdmin
                            .from('users')
                            .update(updateData)
                            .eq('id', user.id)
                            .select()
                            .single();

                        if (!updateError) {
                            user = updatedUser;
                        }
                    }
                }
            }

            // Generate custom JWT token
            const jwtToken = jwt.sign(
                {
                    id: user.id,
                    phone: user.phone,
                    role: user.role
                },
                this.jwtSecret,
                { expiresIn: this.jwtExpiry }
            );

            return {
                success: true,
                user: user,
                token: jwtToken,
                message: 'Authentication successful'
            };
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }

    /**
     * Verify custom JWT token
     */
    verifyToken(token) {
        try {
            const decoded = jwt.verify(token, this.jwtSecret);
            return { success: true, user: decoded };
        } catch (error) {
            return { success: false, message: 'Invalid token' };
        }
    }

    /**
     * Middleware to authenticate requests using custom JWT token
     */
    authenticateToken = (req, res, next) => {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }

        // Verify custom JWT token
        const result = this.verifyToken(token);
        if (!result.success) {
            return res.status(403).json({ error: 'Invalid token' });
        }

        req.user = result.user;
        next();
    }

    /**
     * Middleware to check role permissions
     */
    requireRole(roles) {
        return (req, res, next) => {
            if (!req.user) {
                return res.status(401).json({ error: 'Authentication required' });
            }

            const userRole = req.user.role;
            const allowedRoles = Array.isArray(roles) ? roles : [roles];

            if (!allowedRoles.includes(userRole)) {
                return res.status(403).json({ error: 'Insufficient permissions' });
            }

            next();
        };
    }

    /**
     * Generate new JWT token (for refresh)
     */
    generateToken(user) {
        return jwt.sign(
            {
                id: user.id,
                phone: user.phone,
                role: user.role
            },
            this.jwtSecret,
            { expiresIn: this.jwtExpiry }
        );
    }

    /**
     * Refresh access token
     */
    async refreshToken(userId) {
        try {
            const { data: user, error } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('id', userId)
                .eq('is_deleted', false)
                .single();

            if (error || !user) {
                return {
                    success: false,
                    message: 'User not found'
                };
            }

            const token = this.generateToken(user);
            return {
                success: true,
                token: token
            };
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        }
    }
}

module.exports = new AuthService(); 