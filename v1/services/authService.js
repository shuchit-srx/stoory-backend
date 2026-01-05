const { supabaseAdmin } = require("../db/config");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const whatsappService = require("../utils/whatsapp");

class AuthService {
  constructor() {
    this.jwtSecret =
      process.env.JWT_SECRET || "your-secret-key-change-in-production";
    this.jwtExpiry = "1d";
    this.refreshJwtExpiry = "180d";

    // Mock phone for testing (same as legacy)
    this.mockPhone = "9876543210";
  }

  // ---------- OTP helpers (reuse otp_codes table) ----------

  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async storeOTP(phone, otp) {
    try {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      const { error } = await supabaseAdmin.from("otp_codes").upsert({
        phone,
        otp,
        expires_at: expiresAt,
        created_at: new Date(),
      });

      if (error) {
        console.error("[v1/storeOTP] error:", error);
        return { success: false, message: "Failed to store OTP" };
      }
      
      return { success: true };
    } catch (err) {
      console.error("[v1/storeOTP] error:", err);
      return { success: false, message: "Failed to store OTP" };
    }
  }

  async verifyStoredOTP(phone, otp) {
    try {
      const { data, error } = await supabaseAdmin
        .from("otp_codes")
        .select("*")
        .eq("phone", phone)
        .eq("otp", otp)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (error || !data) {
        return { success: false, message: "Invalid or expired OTP" };
      }

      // Delete the used OTP
      await supabaseAdmin.from("otp_codes").delete().eq("id", data.id);

      return { success: true };
    } catch (err) {
      console.error("[v1/verifyStoredOTP] error:", err);
      return { success: false, message: "OTP verification failed" };
    }
  }

  // ---------- v1_users helpers ----------

  async findV1UserByPhone(phone) {
    try {
      const { data, error } = await supabaseAdmin
        .from("v1_users")
        .select("*")
        .eq("phone_number", phone)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("[v1/findV1UserByPhone] error:", error);
        return { success: false, message: "Database error" };
      }

      return { success: true, user: data || null };
    } catch (err) {
      console.error("[v1/findV1UserByPhone] error:", err);
      return { success: false, message: "Failed to check user existence" };
    }
  }

  // Map legacy roles → v1 roles
  mapRole(userDataRole) {
    if (!userDataRole) return "INFLUENCER";

    const role = String(userDataRole).toLowerCase().trim();
    if (role === "influencer") return "INFLUENCER";
    if (role === "brand_owner" || role === "brand" || role === "owner") return "BRAND_OWNER";
    if (role === "admin") return "ADMIN";
    return "INFLUENCER"; // default
  }

  // ---------- Send OTP (login existing v1 user) ----------

  async sendOTP(phone) {
    try {
      // Validate phone format
      if (!phone.startsWith("+")) {
        return {
          success: false,
          message: "Phone number must include country code (e.g., +1234567890)",
        };
      }

      const phoneRegex = /^\+[1-9]\d{6,14}$/;
      if (!phoneRegex.test(phone)) {
        return {
          success: false,
          message:
            "Invalid phone number format. Use international format: +[country code][number]",
        };
      }

      // Check if user exists
      const { success, user } = await this.findV1UserByPhone(phone);
      if (!success) {
        return { success: false, message: "Database error" };
      }

      if (!user) {
        return {
          success: false,
          message: "Account not found. Please register first.",
          code: "USER_NOT_FOUND",
        };
      }

      // Generate and store OTP
      const otp = this.generateOTP();
      const storeResult = await this.storeOTP(phone, otp);
      if (!storeResult.success) return storeResult;

      // Send via WhatsApp
      return await whatsappService.sendOTP(phone, otp);
    } catch (err) {
      console.error("[v1/sendOTP] error:", err);
      return { success: false, message: "Failed to send OTP" };
    }
  }

  // ---------- Send OTP for registration (new v1 user) ----------

  async sendRegistrationOTP(phone) {
    try {
      // Validate phone format
      if (!phone.startsWith("+")) {
        return {
          success: false,
          message: "Phone number must include country code (e.g., +1234567890)",
        };
      }

      const phoneRegex = /^\+[1-9]\d{6,14}$/;
      if (!phoneRegex.test(phone)) {
        return {
          success: false,
          message:
            "Invalid phone number format. Use international format: +[country code][number]",
        };
      }

      // Check if user already exists
      const { success, user } = await this.findV1UserByPhone(phone);
      if (!success) {
        return { success: false, message: "Database error" };
      }

      if (user) {
        return {
          success: false,
          message: "Account already exists. Please login instead.",
          code: "USER_ALREADY_EXISTS",
        };
      }

      // Generate and store OTP
      const otp = this.generateOTP();
      const storeResult = await this.storeOTP(phone, otp);
      if (!storeResult.success) return storeResult;

      // Send via WhatsApp
      return await whatsappService.sendOTP(phone, otp);
    } catch (err) {
      console.error("[v1/sendRegistrationOTP] error:", err);
      return { success: false, message: "Failed to send registration OTP" };
    }
  }

  // ---------- Verify OTP & create/update v1 users + profiles ----------

  async verifyOTP(phone, token, userData) {
    try {
      // 1) Verify OTP from otp_codes table
      const otpResult = await this.verifyStoredOTP(phone, token);
      if (!otpResult.success) {
        return otpResult;
      }

      // 2) Find existing v1 user
      const lookup = await this.findV1UserByPhone(phone);
      if (!lookup.success) {
        return lookup;
      }

      let user = lookup.user;

      if (!user) {
        // 3) Create new v1 user
        const id = crypto.randomUUID();
        const role = this.mapRole(userData?.role);

        const insertUser = {
          id,
          name: userData?.name || null,
          email: userData?.email || null,
          phone_number: phone,
          role,
          is_deleted: false,
        };

        const { data: created, error } = await supabaseAdmin
          .from("v1_users")
          .insert(insertUser)
          .select("*")
          .single();

        if (error) {
          console.error("[v1/verifyOTP] create v1_user error:", error);
          return {
            success: false,
            message: `Failed to create user: ${error.message}`,
          };
        }

        user = created;

        // 4) Create role-specific profile with bio and placeholder image
        if (role === "INFLUENCER") {
          const profileResult = await this.createInfluencerProfile(
            user,
            userData
          );
          if (!profileResult.success) {
            console.error(
              "[v1/verifyOTP] Failed to create influencer profile:",
              profileResult.error
            );
            // Continue anyway - user is created, profile can be added later
          }
        } else if (role === "BRAND_OWNER") {
          const profileResult = await this.createBrandProfile(user, userData);
          if (!profileResult.success) {
            console.error(
              "[v1/verifyOTP] Failed to create brand profile:",
              profileResult.error
            );
            // Continue anyway - user is created, profile can be added later
          }
        }
        // ADMIN and AGENT don't need profiles for now
      } else {
        // Existing user: optionally update basic fields
        await this.updateBasicUserFields(user, userData);
      }

      // 5) Issue JWT + refresh token
      const tokenOut = this.generateToken(user);
      const refreshToken = this.generateRefreshToken(user);

      return {
        success: true,
        user,
        token: tokenOut,
        refreshToken,
        message: "Authentication successful",
      };
    } catch (err) {
      console.error("[v1/verifyOTP] error:", err);
      return { success: false, message: "Authentication failed" };
    }
  }

  /**
   * Normalize gender value to match database constraint (uppercase)
   */
  normalizeGender(gender) {
    if (!gender) return null;

    const normalized = String(gender).toUpperCase().trim();
    const validGenders = ["MALE", "FEMALE", "OTHER"];

    if (validGenders.includes(normalized)) {
      return normalized;
    }

    // If lowercase provided, convert to uppercase
    const lower = normalized.toLowerCase();
    if (lower === "male") return "MALE";
    if (lower === "female") return "FEMALE";
    if (lower === "other") return "OTHER";

    return null; // Invalid gender, return null
  }

  normalizeTier(tier) {
    if (!tier) return null;
  
    const normalized = String(tier).toUpperCase().trim();
    const validTiers = ["NANO", "MICRO", "MID", "MACRO"];
  
    if (validTiers.includes(normalized)) {
      return normalized;
    }
  
    // Handle lowercase variations
    const lower = normalized.toLowerCase();
    if (lower === "nano") return "NANO";
    if (lower === "micro") return "MICRO";
    if (lower === "mid") return "MID";
    if (lower === "macro") return "MACRO";
  
    return null; // Invalid tier, return null
  }
  

  async createInfluencerProfile(user, userData) {
    try {
      // Extract primary language from userData
      const primaryLanguage =
        userData?.primary_language ||
        (Array.isArray(userData?.languages) && userData.languages[0]) ||
        null;
  
      // Extract languages array
      const languagesArray = Array.isArray(userData?.languages) 
        ? userData.languages.filter(lang => lang && String(lang).trim().length > 0)
        : null;
  
      // Extract categories array
      const categoriesArray = Array.isArray(userData?.categories)
        ? userData.categories.filter(cat => cat && String(cat).trim().length > 0)
        : null;
  
      // Use placeholder image URL if no image provided
      const placeholderImageUrl =
        "https://via.placeholder.com/400x400?text=Profile+Image";
  
      const profile = {
        user_id: user.id,
        profile_photo_url: userData?.profile_image_url || placeholderImageUrl,
        is_profile_verified: false,
        bio: userData?.bio || "",
        city: userData?.address_city || userData?.city || null,
        country: userData?.address_country || userData?.country || null,
        primary_language: primaryLanguage,
        languages: languagesArray, // Store as array
        gender: this.normalizeGender(userData?.gender),
        tier: this.normalizeTier(userData?.tier),
        pan_number: userData?.pan_number || null,
        pan_verified: false,
        profile_completion_pct: 0,
        is_deleted: false,
        categories: categoriesArray, // Store as array
        min_value: userData?.min_value !== undefined ? parseFloat(userData.min_value) : null,
        max_value: userData?.max_value !== undefined ? parseFloat(userData.max_value) : null,
      };
  
      console.log("[v1/createInfluencerProfile] Inserting profile:", {
        user_id: profile.user_id,
        has_photo: !!profile.profile_photo_url,
        has_bio: !!profile.bio,
        has_gender: !!profile.gender,
        languages_count: languagesArray?.length || 0,
        categories_count: categoriesArray?.length || 0,
      });
  
      const { data, error } = await supabaseAdmin
        .from("v1_influencer_profiles")
        .insert(profile)
        .select();
  
      if (error) {
        console.error("[v1/createInfluencerProfile] Database error:", error);
        console.error(
          "[v1/createInfluencerProfile] Error details:",
          JSON.stringify(error, null, 2)
        );
        return { success: false, error: error.message, details: error };
      }
  
      console.log(
        "[v1/createInfluencerProfile] Profile created successfully:",
        data?.[0]?.user_id
      );
      return { success: true, profile: data?.[0] };
    } catch (err) {
      console.error("[v1/createInfluencerProfile] Exception:", err);
      return { success: false, error: err.message };
    }
  }

  async createBrandProfile(user, userData) {
    try {
      // Use placeholder logo URL if no image provided
      const placeholderLogoUrl =
        "https://via.placeholder.com/400x400?text=Brand+Logo";
  
      // Ensure brand_name is always a string (required field)
      // Empty string is allowed - will be updated in complete profile endpoint
      const brandName = userData?.brand_name || userData?.business_name || "";
  
      const profile = {
        user_id: user.id,
        brand_name: brandName, // Required field - empty string allowed initially
        brand_logo_url:
          userData?.brand_logo_url ||
          userData?.profile_image_url ||
          placeholderLogoUrl, // Required field - use placeholder if not provided
        bio: userData?.bio || null,
        brand_description: userData?.brand_description || null, // Add brand_description
        gender: this.normalizeGender(userData?.gender),
        pan_number: userData?.pan_number || null,
        pan_verified: false,
        profile_completion_pct: 0,
        is_deleted: false,
      };
  
      console.log(
        "[v1/createBrandProfile] Inserting profile into v1_brand_profiles:",
        {
          user_id: profile.user_id,
          brand_name: profile.brand_name,
          brand_logo_url: profile.brand_logo_url,
          bio: profile.bio,
          brand_description: profile.brand_description,
          gender: profile.gender,
          pan_number: profile.pan_number,
        }
      );
  
      const { data, error } = await supabaseAdmin
        .from("v1_brand_profiles")
        .insert(profile)
        .select("*")
        .single();
  
      if (error) {
        console.error("[v1/createBrandProfile] Database error:", error);
        console.error(
          "[v1/createBrandProfile] Error details:",
          JSON.stringify(error, null, 2)
        );
        console.error(
          "[v1/createBrandProfile] Profile data attempted:",
          JSON.stringify(profile, null, 2)
        );
        return { success: false, error: error.message, details: error };
      }
  
      if (!data) {
        console.error("[v1/createBrandProfile] No data returned from insert");
        return { success: false, error: "Profile creation returned no data" };
      }
  
      console.log(
        "[v1/createBrandProfile] Profile created successfully in v1_brand_profiles:",
        {
          id: data.id,
          user_id: data.user_id,
          brand_name: data.brand_name,
        }
      );
      return { success: true, profile: data };
    } catch (err) {
      console.error("[v1/createBrandProfile] Exception:", err);
      console.error("[v1/createBrandProfile] Stack:", err.stack);
      return { success: false, error: err.message };
    }
  }

  async updateBasicUserFields(user, userData) {
    if (!userData) return;

    const update = {};
    if (userData.name !== undefined) update.name = userData.name;
    if (userData.email !== undefined) update.email = userData.email;

    if (Object.keys(update).length === 0) return;

    try {
      await supabaseAdmin.from("v1_users").update(update).eq("id", user.id);
    } catch (err) {
      console.error("[v1/updateBasicUserFields] error:", err);
    }
  }

  // ---------- JWT helpers ----------

  generateToken(user) {
    return jwt.sign(
      {
        id: user.id,
        phone: user.phone_number,
        role: user.role,
      },
      this.jwtSecret,
      { expiresIn: this.jwtExpiry }
    );
  }

  generateRefreshToken(user) {
    return jwt.sign(
      {
        id: user.id,
        phone: user.phone_number,
        role: user.role,
        type: "refresh",
      },
      this.jwtSecret,
      { expiresIn: this.refreshJwtExpiry }
    );
  }

  async refreshToken(refreshToken) {
    try {
      if (!refreshToken) {
        return {
          success: false,
          message: "Refresh token required",
          code: "REFRESH_TOKEN_REQUIRED",
        };
      }

      // Verify refresh token
      let decoded;
      try {
        decoded = jwt.verify(refreshToken, this.jwtSecret);
      } catch (err) {
        return {
          success: false,
          message: "Invalid or expired refresh token",
          code: "REFRESH_TOKEN_EXPIRED",
        };
      }

      // Ensure it is a refresh token
      if (decoded.type !== "refresh") {
        return {
          success: false,
          message: "Invalid token type",
          code: "INVALID_TOKEN_TYPE",
        };
      }

      // Find user in v1_users
      const { data: user, error } = await supabaseAdmin
        .from("v1_users")
        .select("*")
        .eq("id", decoded.id)
        .eq("is_deleted", false)
        .single();

      if (error || !user) {
        return {
          success: false,
          message: "User not found",
          code: "USER_NOT_FOUND",
        };
      }

      // Generate new tokens (rolling refresh)
      const newToken = this.generateToken(user);
      const newRefreshToken = this.generateRefreshToken(user);

      return {
        success: true,
        token: newToken,
        refreshToken: newRefreshToken,
      };
    } catch (err) {
      console.error("[v1/refreshToken] error:", err);
      return {
        success: false,
        message: err.message,
        code: "INTERNAL_ERROR",
      };
    }
  }

  // ---------- WhatsApp status passthrough ----------

  getWhatsAppStatus() {
    return whatsappService.getServiceStatus();
  }

  // ============================================
  // PASSWORD AUTHENTICATION (Brand Owners)
  // ============================================

  // ---------- Password helpers ----------

  /**
   * Hash password using bcrypt
   */
  async hashPassword(password) {
    try {
      const saltRounds = 10;
      return await bcrypt.hash(password, saltRounds);
    } catch (err) {
      console.error("[v1/hashPassword] error:", err);
      throw err;
    }
  }

  /**
   * Compare password with hash
   */
  async comparePassword(password, hash) {
    try {
      return await bcrypt.compare(password, hash);
    } catch (err) {
      console.error("[v1/comparePassword] error:", err);
      return false;
    }
  }

  /**
   * Find brand owner by email
   */
  async findBrandOwnerByEmail(email) {
    try {
      const { data, error } = await supabaseAdmin
        .from("v1_users")
        .select("*")
        .eq("email", email)
        .eq("role", "BRAND_OWNER")
        .eq("is_deleted", false)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("[v1/findBrandOwnerByEmail] error:", error);
        return { success: false, message: "Database error" };
      }

      return { success: true, user: data || null };
    } catch (err) {
      console.error("[v1/findBrandOwnerByEmail] error:", err);
      return { success: false, message: "Failed to check user existence" };
    }
  }

  /**
   * Generate password reset token
   */
  generatePasswordResetToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Generate email verification token
   */
  generateEmailVerificationToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  // ---------- Brand Owner Registration ----------

  /**
   * Register brand owner with email and password
   */
  async registerBrandOwner(email, password, name) {
    try {
      // 1) Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return { success: false, message: "Invalid email format" };
      }

      // 2) Check if email already exists
      const { success, user: existing } = await this.findBrandOwnerByEmail(
        email
      );
      if (!success) {
        return { success: false, message: "Database error" };
      }

      if (existing) {
        return {
          success: false,
          message: "Email already registered",
          code: "EMAIL_ALREADY_EXISTS",
        };
      }

      // 3) Validate password strength
      if (!password || password.length < 8) {
        return {
          success: false,
          message: "Password must be at least 8 characters",
        };
      }

      // 4) Hash password
      const passwordHash = await this.hashPassword(password);

      // 5) Generate email verification token
      // Note: For MVP, we'll store it in password_reset_token temporarily
      // TODO: Add email_verification_token column to v1_users table
      const emailVerificationToken = this.generateEmailVerificationToken();
      const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // 6) Create user with verification token stored temporarily
      const id = crypto.randomUUID();
      const { data: created, error } = await supabaseAdmin
        .from("v1_users")
        .insert({
          id,
          email,
          password_hash: passwordHash,
          role: "BRAND_OWNER",
          name: name || null,
          email_verified: false,
          password_reset_token: emailVerificationToken, // Temporarily store here
          password_reset_token_expires_at: verificationExpiresAt.toISOString(),
          is_deleted: false,
        })
        .select("*")
        .single();

      if (error) {
        console.error("[v1/registerBrandOwner] create user error:", error);
        return {
          success: false,
          message: `Failed to create user: ${error.message}`,
        };
      }

      // 7) Create brand profile in v1_brand_profiles table
      // brand_name will be empty string (required field) - will be updated in complete profile
      const profileResult = await this.createBrandProfile(created, {
        brand_name: "", // Empty string - required field, will be set in complete profile
      });

      if (!profileResult.success) {
        console.error(
          "[v1/registerBrandOwner] Failed to create brand profile:",
          profileResult.error,
          profileResult.details
        );
        // If profile creation fails, rollback user creation for data consistency
        await supabaseAdmin.from("v1_users").delete().eq("id", created.id);
        return {
          success: false,
          message: `Failed to create brand profile: ${
            profileResult.error || "Unknown error"
          }`,
        };
      }

      console.log(
        "[v1/registerBrandOwner] Brand profile created successfully:",
        profileResult.profile?.id
      );

      // TODO: Send email verification email with token
      // For now, return token (in production, send via email)
      console.log(
        "[v1/registerBrandOwner] Email verification token:",
        emailVerificationToken
      );

      return {
        success: true,
        user: {
          id: created.id,
          email: created.email,
          role: created.role,
          email_verified: created.email_verified,
        },
        // Remove this in production - token should be sent via email only
        verification_token:
          process.env.NODE_ENV === "development"
            ? emailVerificationToken
            : undefined,
        message:
          "Brand owner registered successfully. Please verify your email.",
      };
    } catch (err) {
      console.error("[v1/registerBrandOwner] Exception:", err);
      return { success: false, message: "Registration failed" };
    }
  }

  // ---------- Brand Owner Login ----------

  /**
   * Login brand owner with email and password
   */
  async loginBrandOwner(email, password) {
    try {
      // 1) Find user by email
      const { success, user } = await this.findBrandOwnerByEmail(email);
      if (!success) {
        return { success: false, message: "Database error" };
      }

      if (!user) {
        return {
          success: false,
          message: "Invalid email or password",
          code: "INVALID_CREDENTIALS",
        };
      }

      // 2) Check if password hash exists
      if (!user.password_hash) {
        return {
          success: false,
          message: "Password not set. Please use password reset.",
          code: "PASSWORD_NOT_SET",
        };
      }

      // 3) Verify password
      const passwordMatch = await this.comparePassword(
        password,
        user.password_hash
      );
      if (!passwordMatch) {
        return {
          success: false,
          message: "Invalid email or password",
          code: "INVALID_CREDENTIALS",
        };
      }

      // 4) Generate tokens
      const token = this.generateToken(user);
      const refreshToken = this.generateRefreshToken(user);

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          name: user.name,
          email_verified: user.email_verified,
        },
        token,
        refreshToken,
        message: "Login successful",
      };
    } catch (err) {
      console.error("[v1/loginBrandOwner] Exception:", err);
      return { success: false, message: "Login failed" };
    }
  }

  // ---------- Email Verification ----------

  /**
   * Verify email using verification token
   * Note: For MVP, token is stored in password_reset_token temporarily
   * TODO: Add email_verification_token column to v1_users table
   */
  async verifyEmail(token) {
    try {
      // Find user by verification token (stored in password_reset_token temporarily)
      const { data: user, error } = await supabaseAdmin
        .from("v1_users")
        .select("*")
        .eq("password_reset_token", token)
        .eq("role", "BRAND_OWNER")
        .eq("is_deleted", false)
        .gt("password_reset_token_expires_at", new Date().toISOString())
        .maybeSingle();

      if (error || !user) {
        return {
          success: false,
          message: "Invalid or expired verification token",
          code: "INVALID_TOKEN",
        };
      }

      // Check if already verified
      if (user.email_verified) {
        return {
          success: false,
          message: "Email already verified",
          code: "ALREADY_VERIFIED",
        };
      }

      // Update email_verified status and clear token
      const { error: updateError } = await supabaseAdmin
        .from("v1_users")
        .update({
          email_verified: true,
          password_reset_token: null,
          password_reset_token_expires_at: null,
        })
        .eq("id", user.id);

      if (updateError) {
        console.error("[v1/verifyEmail] Update error:", updateError);
        return { success: false, message: "Failed to verify email" };
      }

      return {
        success: true,
        message: "Email verified successfully",
      };
    } catch (err) {
      console.error("[v1/verifyEmail] Exception:", err);
      return { success: false, message: "Failed to verify email" };
    }
  }

  /**
   * Resend email verification
   */
  async resendEmailVerification(email) {
    try {
      // 1) Find brand owner by email
      const { success, user } = await this.findBrandOwnerByEmail(email);
      if (!success) {
        return { success: false, message: "Database error" };
      }

      if (!user) {
        // Don't reveal if email exists (security best practice)
        return {
          success: true,
          message: "If email exists, verification link will be sent",
        };
      }

      if (user.email_verified) {
        return {
          success: false,
          message: "Email already verified",
          code: "ALREADY_VERIFIED",
        };
      }

      // 2) Generate new verification token
      const verificationToken = this.generateEmailVerificationToken();
      const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // 3) Store verification token (temporarily in password_reset_token)
      const { error: updateError } = await supabaseAdmin
        .from("v1_users")
        .update({
          password_reset_token: verificationToken,
          password_reset_token_expires_at: verificationExpiresAt.toISOString(),
        })
        .eq("id", user.id);

      if (updateError) {
        console.error(
          "[v1/resendEmailVerification] Update error:",
          updateError
        );
        return {
          success: false,
          message: "Failed to generate verification token",
        };
      }

      // TODO: Send email with verification link
      // For now, return token (in production, send via email)
      console.log(
        "[v1/resendEmailVerification] Verification token:",
        verificationToken
      );

      return {
        success: true,
        message: "Verification link sent to email",
        // Remove this in production - token should be sent via email only
        verification_token:
          process.env.NODE_ENV === "development"
            ? verificationToken
            : undefined,
      };
    } catch (err) {
      console.error("[v1/resendEmailVerification] Exception:", err);
      return { success: false, message: "Failed to send verification email" };
    }
  }

  // ---------- Forgot Password ----------

  /**
   * Generate and store password reset token
   */
  async forgotPassword(email) {
    try {
      // 1) Find brand owner by email
      const { success, user } = await this.findBrandOwnerByEmail(email);
      if (!success) {
        return { success: false, message: "Database error" };
      }

      if (!user) {
        // Don't reveal if email exists (security best practice)
        return {
          success: true,
          message: "If email exists, password reset link will be sent",
        };
      }

      // 2) Generate reset token
      const resetToken = this.generatePasswordResetToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // 3) Store reset token
      const { error } = await supabaseAdmin
        .from("v1_users")
        .update({
          password_reset_token: resetToken,
          password_reset_token_expires_at: expiresAt.toISOString(),
        })
        .eq("id", user.id);

      if (error) {
        console.error("[v1/forgotPassword] Update error:", error);
        return { success: false, message: "Failed to generate reset token" };
      }

      // TODO: Send email with reset link
      // For now, return token (in production, send via email)
      console.log("[v1/forgotPassword] Reset token:", resetToken);

      return {
        success: true,
        message: "Password reset link sent to email",
        // Remove this in production - token should be sent via email only
        reset_token:
          process.env.NODE_ENV === "development" ? resetToken : undefined,
      };
    } catch (err) {
      console.error("[v1/forgotPassword] Exception:", err);
      return { success: false, message: "Failed to process request" };
    }
  }

  // ---------- Reset Password ----------

  /**
   * Reset password using reset token
   */
  async resetPassword(token, newPassword) {
    try {
      // 1) Validate password strength
      if (!newPassword || newPassword.length < 8) {
        return {
          success: false,
          message: "Password must be at least 8 characters",
        };
      }

      // 2) Find user by reset token
      const { data: user, error } = await supabaseAdmin
        .from("v1_users")
        .select("*")
        .eq("password_reset_token", token)
        .eq("role", "BRAND_OWNER")
        .eq("is_deleted", false)
        .gt("password_reset_token_expires_at", new Date().toISOString())
        .maybeSingle();

      if (error || !user) {
        return {
          success: false,
          message: "Invalid or expired reset token",
          code: "INVALID_TOKEN",
        };
      }

      // 3) Hash new password
      const passwordHash = await this.hashPassword(newPassword);

      // 4) Update password and clear reset token
      const { error: updateError } = await supabaseAdmin
        .from("v1_users")
        .update({
          password_hash: passwordHash,
          password_reset_token: null,
          password_reset_token_expires_at: null,
        })
        .eq("id", user.id);

      if (updateError) {
        console.error("[v1/resetPassword] Update error:", updateError);
        return { success: false, message: "Failed to reset password" };
      }

      return {
        success: true,
        message: "Password reset successfully",
      };
    } catch (err) {
      console.error("[v1/resetPassword] Exception:", err);
      return { success: false, message: "Failed to reset password" };
    }
  }

  // ---------- Profile Image Upload (moved to ProfileService) ----------
  // All profile-related methods have been moved to ProfileService
  // See v1/services/profileService.js for completeProfile, uploadProfileImage, etc.

  // ---------- Complete Profile (moved to ProfileService) ----------
  // All profile completion methods have been moved to ProfileService
  // The methods below are kept for backward compatibility but delegate to ProfileService

  /**
   * Normalize platform name to match database enum (INSTAGRAM | FACEBOOK | YOUTUBE)
   * NOTE: This method is kept for backward compatibility but profile-related methods
   * have been moved to ProfileService
   */
  normalizePlatform(platformName) {
        .from("v1_users")
        .select("id, role")
        .eq("id", userId)
        .eq("is_deleted", false)
        .single();

      if (userError || !user) {
        console.error("[v1/uploadProfileImage] User not found:", userError);
        return { success: false, message: "User not found" };
      }

      // 2) Upload new profile image first
      const { url, error: uploadError } = await uploadImageToStorage(
        fileBuffer,
        fileName,
        "profiles"
      );

      if (uploadError || !url) {
        console.error("[v1/uploadProfileImage] Upload error:", uploadError);
        return {
          success: false,
          message: uploadError || "Failed to upload image",
        };
      }

      // 3) Check if profile exists
      const { data: currentProfile, error: fetchError } = await supabaseAdmin
        .from("v1_influencer_profiles")
        .select("profile_photo_url")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .maybeSingle();

      if (fetchError && fetchError.code !== "PGRST116") {
        console.error(
          "[v1/uploadProfileImage] Error fetching profile:",
          fetchError
        );
        return { success: false, message: "Failed to fetch profile" };
      }

      // 4) Delete old profile image if it exists
      if (currentProfile?.profile_photo_url) {
        await deleteImageFromStorage(currentProfile.profile_photo_url);
      }

      // 5) Create or update profile
      let updatedProfile;

      if (!currentProfile) {
        // Profile doesn't exist - create it with the image URL
        // This should rarely happen now since profile is created during verify-otp
        console.log(
          "[v1/uploadProfileImage] Profile not found, creating new profile"
        );

        if (user.role === "INFLUENCER") {
          const profileData = {
            user_id: userId,
            profile_photo_url: url,
            is_profile_verified: false,
            bio: "",
            city: null,
            country: null,
            primary_language: null,
            languages: null,
            gender: null,
            tier: null,
            pan_number: null,
            pan_verified: false,
            profile_completion_pct: 0,
            is_deleted: false,
            categories: null,
            min_value: null,
            max_value: null,
          };
      
          const { data: createdProfile, error: createError } =
            await supabaseAdmin
              .from("v1_influencer_profiles")
              .insert(profileData)
              .select()
              .single();
      
          if (createError) {
            console.error(
              "[v1/uploadProfileImage] Profile creation error:",
              createError
            );
            await deleteImageFromStorage(url);
            return {
              success: false,
              message: "Failed to create profile",
              error: createError.message,
            };
          }
      

          updatedProfile = createdProfile;
        } else {
          // For BRAND_OWNER or other roles, handle differently if needed
          return {
            success: false,
            message: "Profile image upload only supported for influencers",
          };
        }
      } else {
        // Profile exists - update it with new image URL
        // Delete old image if it's not the placeholder
        const placeholderUrl =
          "https://via.placeholder.com/400x400?text=Profile+Image";
        if (
          currentProfile.profile_photo_url &&
          currentProfile.profile_photo_url !== placeholderUrl
        ) {
          await deleteImageFromStorage(currentProfile.profile_photo_url);
        }

        const { data: updated, error: updateError } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .update({ profile_photo_url: url })
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .select()
          .single();

        if (updateError) {
          console.error("[v1/uploadProfileImage] Update error:", updateError);
          // Try to delete uploaded image if update fails
          await deleteImageFromStorage(url);
          return {
            success: false,
            message: "Failed to update profile image",
            error: updateError.message,
          };
        }

        updatedProfile = updated;
      }

      return {
        success: true,
        profile: updatedProfile,
        profile_image_url: url,
        message: "Profile image uploaded successfully",
      };
    } catch (err) {
      console.error("[v1/uploadProfileImage] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }

  // ---------- Complete Profile (PAN, Social Platforms, Languages, Categories) ----------

  /**
   * Normalize platform name to match database enum (INSTAGRAM | FACEBOOK | YOUTUBE)
   */
  normalizePlatform(platformName) {
    if (!platformName) return null;

    const normalized = String(platformName).toUpperCase().trim();
    const validPlatforms = ["INSTAGRAM", "FACEBOOK", "YOUTUBE"];

    if (validPlatforms.includes(normalized)) {
      return normalized;
    }

    // Handle common variations
    const lower = normalized.toLowerCase();
    if (lower === "instagram" || lower === "ig") return "INSTAGRAM";
    if (lower === "facebook" || lower === "fb") return "FACEBOOK";
    if (lower === "youtube" || lower === "yt") return "YOUTUBE";

    return null; // Invalid platform
  }

  /**
   * Upsert social platforms for v1 influencer
   */
  async upsertSocialPlatforms(userId, platforms) {
    try {
      if (!Array.isArray(platforms) || platforms.length === 0) {
        return { success: true, count: 0 };
      }

      let successCount = 0;
      const errors = [];

      for (const platform of platforms) {
        try {
          const platformName = this.normalizePlatform(
            platform.platform_name || platform.platform
          );
          const username = platform.username || null;
          const profileUrl =
            platform.profile_url || platform.profile_link || null;
          const followerCount =
            platform.follower_count !== undefined
              ? parseInt(platform.follower_count)
              : null;
          const engagementRate =
            platform.engagement_rate !== undefined
              ? parseFloat(platform.engagement_rate)
              : null;

          if (!platformName || !username) {
            console.warn(
              "[v1/upsertSocialPlatforms] Skipping invalid platform:",
              platform
            );
            continue;
          }

          // Check if platform already exists for this user
          const { data: existing, error: checkError } = await supabaseAdmin
            .from("v1_influencer_social_accounts")
            .select("id")
            .eq("user_id", userId)
            .eq("platform", platformName)
            .eq("is_deleted", false)
            .maybeSingle();

          // Determine data_source: use from payload if provided, otherwise default to MANUAL
          // GRAPH_API should be used when connected via Facebook/Instagram Graph API
          const dataSource = platform.data_source || "MANUAL";
          const normalizedDataSource =
            dataSource.toUpperCase() === "GRAPH_API" ? "GRAPH_API" : "MANUAL";

          const platformData = {
            user_id: userId,
            platform: platformName,
            username: username,
            profile_url: profileUrl,
            follower_count: Number.isNaN(followerCount) ? null : followerCount,
            engagement_rate: Number.isNaN(engagementRate)
              ? null
              : engagementRate,
            data_source: normalizedDataSource,
            is_deleted: false,
          };

          if (existing && !checkError) {
            // Update existing
            const { error: updateError } = await supabaseAdmin
              .from("v1_influencer_social_accounts")
              .update(platformData)
              .eq("id", existing.id);

            if (updateError) {
              console.error(
                `[v1/upsertSocialPlatforms] Update error for ${platformName}:`,
                updateError
              );
              errors.push({
                platform: platformName,
                error: updateError.message,
              });
            } else {
              successCount++;
            }
          } else {
            // Insert new
            const { error: insertError } = await supabaseAdmin
              .from("v1_influencer_social_accounts")
              .insert(platformData);

            if (insertError) {
              console.error(
                `[v1/upsertSocialPlatforms] Insert error for ${platformName}:`,
                insertError
              );
              errors.push({
                platform: platformName,
                error: insertError.message,
              });
            } else {
              successCount++;
            }
          }
        } catch (err) {
          console.error(
            "[v1/upsertSocialPlatforms] Exception for platform:",
            err
          );
          errors.push({
            platform: platform?.platform_name || "unknown",
            error: err.message,
          });
        }
      }

      return {
        success: errors.length === 0,
        count: successCount,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (err) {
      console.error("[v1/upsertSocialPlatforms] Exception:", err);
      return { success: false, count: 0, error: err.message };
    }
  }

  /**
   * NOTE: Categories are now stored as text[] array in v1_influencer_profiles table.
   * The separate v1_influencer_categories table approach is deprecated.
   * This method is kept for reference but should not be used.
   * 
   * @deprecated Use profile.categories array field instead
   */
  // async upsertCategories(userId, categories) {
  //   try {
  //     if (!Array.isArray(categories) || categories.length === 0) {
  //       return { success: true, count: 0 };
  //     }

  //     // Delete existing categories for this user
  //     const { error: deleteError } = await supabaseAdmin
  //       .from("v1_influencer_categories")
  //       .delete()
  //       .eq("user_id", userId);

  //     if (deleteError) {
  //       console.error("[v1/upsertCategories] Delete error:", deleteError);
  //       // Continue anyway - might be first time
  //     }

  //     // Insert new categories
  //     const categoryData = categories
  //       .filter((cat) => cat && String(cat).trim().length > 0)
  //       .map((cat) => ({
  //         user_id: userId,
  //         category: String(cat).trim(),
  //       }));

  //     if (categoryData.length === 0) {
  //       return { success: true, count: 0 };
  //     }

  //     const { data, error: insertError } = await supabaseAdmin
  //       .from("v1_influencer_categories")
  //       .insert(categoryData)
  //       .select();

  //     if (insertError) {
  //       console.error("[v1/upsertCategories] Insert error:", insertError);
  //       return { success: false, count: 0, error: insertError.message };
  //     }

  //     return { success: true, count: data?.length || 0, categories: data };
  //   } catch (err) {
  //     console.error("[v1/upsertCategories] Exception:", err);
  //     return { success: false, count: 0, error: err.message };
  //   }
  // }

  /**
   * Complete profile - handles both INFLUENCER and BRAND_OWNER roles
   * NOTE: This method has been moved to ProfileService
   * @deprecated Use ProfileService.completeProfile instead
   */
  async completeProfile(userId, userRole, profileData) {
    // Redirect to ProfileService for backward compatibility
    const { ProfileService } = require("./profileService");
    return await ProfileService.completeProfile(userId, userRole, profileData);
  }

  /**
   * Complete influencer profile with PAN, social platforms, languages, categories
   * NOTE: This method has been moved to ProfileService
   * @deprecated Use ProfileService.completeInfluencerProfile instead
   */
  async completeInfluencerProfile(userId, profileData) {
    try {
      const {
        uploadImageToStorage,
        deleteImageFromStorage,
      } = require("../../utils/imageUpload");

      // 1) Handle profile image - file upload takes priority over direct URL
      let profileImageUrl = null;
      if (profileData.profile_image_file) {
        // File upload - upload to storage
        const { url, error: uploadError } = await uploadImageToStorage(
          profileData.profile_image_file.buffer,
          profileData.profile_image_file.originalname,
          "profiles" // Upload to profiles folder
        );

        if (uploadError || !url) {
          console.error(
            "[v1/completeInfluencerProfile] Profile image upload error:",
            uploadError
          );
          return {
            success: false,
            message: uploadError || "Failed to upload profile image",
          };
        }

        profileImageUrl = url;

        // Delete old image if exists (only if it's from our storage)
        const { data: currentProfile } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .select("profile_photo_url")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        if (currentProfile?.profile_photo_url) {
          // Only delete if it's from our storage (contains storage URL pattern)
          const placeholderUrl = "https://via.placeholder.com/400x400?text=Profile+Image";
          if (
            currentProfile.profile_photo_url !== placeholderUrl &&
            (currentProfile.profile_photo_url.includes('storage') ||
             currentProfile.profile_photo_url.includes('supabase') ||
             currentProfile.profile_photo_url.includes('supabase.co'))
          ) {
            await deleteImageFromStorage(currentProfile.profile_photo_url);
          }
        }
      } else if (profileData.profile_image_url !== undefined) {
        // Direct URL provided (no file upload)
        if (profileData.profile_image_url === null || profileData.profile_image_url === "") {
          profileImageUrl = null;
        } else {
          profileImageUrl = String(profileData.profile_image_url).trim();
        }

        // Optionally delete old image if it was from our storage and URL is changing
        if (profileImageUrl) {
          const { data: currentProfile } = await supabaseAdmin
            .from("v1_influencer_profiles")
            .select("profile_photo_url")
            .eq("user_id", userId)
            .eq("is_deleted", false)
            .maybeSingle();

          if (
            currentProfile?.profile_photo_url &&
            currentProfile.profile_photo_url !== profileImageUrl
          ) {
            // Only delete if it's from our storage
            const placeholderUrl = "https://via.placeholder.com/400x400?text=Profile+Image";
            if (
              currentProfile.profile_photo_url !== placeholderUrl &&
              (currentProfile.profile_photo_url.includes('storage') ||
               currentProfile.profile_photo_url.includes('supabase') ||
               currentProfile.profile_photo_url.includes('supabase.co'))
            ) {
              await deleteImageFromStorage(currentProfile.profile_photo_url);
            }
          }
        }
      }

      // 2) Update v1_influencer_profiles with all fields
      const profileUpdate = {};

      // Update profile_photo_url if provided (from file upload or direct URL)
      if (profileImageUrl !== null && profileImageUrl !== undefined) {
        profileUpdate.profile_photo_url = profileImageUrl;
      } else if (profileData.profile_image_url !== undefined && profileData.profile_image_url === null) {
        // Explicitly set to null if provided as null
        profileUpdate.profile_photo_url = null;
      }
      
      if (profileData.pan_number !== undefined) {
        profileUpdate.pan_number = profileData.pan_number || null;
      }
      
      if (profileData.primary_language !== undefined) {
        profileUpdate.primary_language = profileData.primary_language || null;
      }
      
      // Handle languages array
      if (profileData.languages !== undefined) {
        if (Array.isArray(profileData.languages)) {
          const filteredLanguages = profileData.languages
            .filter(lang => lang && String(lang).trim().length > 0)
            .map(lang => String(lang).trim());
          profileUpdate.languages = filteredLanguages.length > 0 ? filteredLanguages : null;
          // Also update primary_language if not explicitly set
          if (!profileData.primary_language && filteredLanguages.length > 0) {
            profileUpdate.primary_language = filteredLanguages[0];
          }
        } else {
          profileUpdate.languages = null;
        }
      }
      
      // Handle categories array
      if (profileData.categories !== undefined) {
        if (Array.isArray(profileData.categories)) {
          const filteredCategories = profileData.categories
            .filter(cat => cat && String(cat).trim().length > 0)
            .map(cat => String(cat).trim());
          profileUpdate.categories = filteredCategories.length > 0 ? filteredCategories : null;
        } else {
          profileUpdate.categories = null;
        }
      }
      
      // Handle bio
      if (profileData.bio !== undefined) {
        profileUpdate.bio = profileData.bio !== null && profileData.bio !== undefined
          ? String(profileData.bio).trim()
          : "";
      }
      
      // Handle city
      if (profileData.city !== undefined) {
        profileUpdate.city = profileData.city !== null && profileData.city !== undefined
          ? String(profileData.city).trim() || null
          : null;
      }
      
      // Handle country
      if (profileData.country !== undefined) {
        profileUpdate.country = profileData.country !== null && profileData.country !== undefined
          ? String(profileData.country).trim() || null
          : null;
      }
      
      // Handle gender
      if (profileData.gender !== undefined) {
        profileUpdate.gender = this.normalizeGender(profileData.gender);
      }
      
      // Handle tier
      if (profileData.tier !== undefined) {
        profileUpdate.tier = this.normalizeTier(profileData.tier);
      }
      
      // Handle min_value with proper null/NaN checking
      if (profileData.min_value !== undefined) {
        if (profileData.min_value === null || profileData.min_value === undefined || profileData.min_value === "") {
          profileUpdate.min_value = null;
        } else {
          const parsed = parseFloat(profileData.min_value);
          profileUpdate.min_value = !isNaN(parsed) ? parsed : null;
        }
      }
      
      // Handle max_value with proper null/NaN checking
      if (profileData.max_value !== undefined) {
        if (profileData.max_value === null || profileData.max_value === undefined || profileData.max_value === "") {
          profileUpdate.max_value = null;
        } else {
          const parsed = parseFloat(profileData.max_value);
          profileUpdate.max_value = !isNaN(parsed) ? parsed : null;
        }
      }

      // Validate min_value < max_value if both are provided and non-null
      if (profileUpdate.min_value !== null && profileUpdate.max_value !== null) {
        if (profileUpdate.min_value >= profileUpdate.max_value) {
          return {
            success: false,
            message: "min_value must be less than max_value",
          };
        }
      }
  
      let updatedProfile = null;
      if (Object.keys(profileUpdate).length > 0) {
        const { data, error: updateError } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .update(profileUpdate)
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .select()
          .single();
  
        if (updateError) {
          console.error(
            "[v1/completeInfluencerProfile] Profile update error:",
            updateError
          );
          return { success: false, message: "Failed to update profile" };
        }
  
        updatedProfile = data;
      } else {
        // Fetch existing profile if no updates
        const { data, error: fetchError } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .select("*")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .single();
  
        if (fetchError) {
          console.error(
            "[v1/completeInfluencerProfile] Profile fetch error:",
            fetchError
          );
          return { success: false, message: "Profile not found" };
        }
  
        updatedProfile = data;
      }
  
      // 2) Upsert social platforms (still in separate table)
      let socialPlatformsResult = { success: true, count: 0 };
      if (
        profileData.social_platforms &&
        Array.isArray(profileData.social_platforms)
      ) {
        socialPlatformsResult = await this.upsertSocialPlatforms(
          userId,
          profileData.social_platforms
        );
        if (!socialPlatformsResult.success) {
          console.warn(
            "[v1/completeInfluencerProfile] Some social platforms failed:",
            socialPlatformsResult.errors
          );
          // Continue - don't fail entire request
        }
      }
  
      // 3) Calculate profile completion percentage
      // Now using categories and languages from main table
      const completionPct = this.calculateProfileCompletion(updatedProfile, {
        hasSocialPlatforms: socialPlatformsResult.count > 0,
      });
  
      // Update completion percentage
      if (completionPct !== updatedProfile.profile_completion_pct) {
        await supabaseAdmin
          .from("v1_influencer_profiles")
          .update({ profile_completion_pct: completionPct })
          .eq("user_id", userId);
        updatedProfile.profile_completion_pct = completionPct;
      }
  
      return {
        success: true,
        profile: updatedProfile,
        social_platforms_count: socialPlatformsResult.count,
        categories_count: updatedProfile.categories?.length || 0,
        languages_count: updatedProfile.languages?.length || 0,
        profile_completion_pct: completionPct,
        profile_image_url: profileImageUrl || updatedProfile?.profile_photo_url,
        message: "Profile completed successfully",
      };
    } catch (err) {
      console.error("[v1/completeInfluencerProfile] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }
  

  /**
   * Complete brand profile with PAN, brand_name, bio, brand_logo
   * NOTE: This method has been moved to ProfileService
   * @deprecated Use ProfileService.completeBrandProfile instead
   */
  async completeBrandProfile(userId, profileData) {
    try {
      const {
        uploadImageToStorage,
        deleteImageFromStorage,
      } = require("../../utils/imageUpload");

      // 1) Handle brand logo - file upload takes priority over direct URL
      let brandLogoUrl = null;
      if (profileData.brand_logo_file) {
        // File upload - upload to storage
        const { url, error: uploadError } = await uploadImageToStorage(
          profileData.brand_logo_file.buffer,
          profileData.brand_logo_file.originalname,
          "brands" // Upload to brands folder
        );

        if (uploadError || !url) {
          console.error(
            "[v1/completeBrandProfile] Logo upload error:",
            uploadError
          );
          return {
            success: false,
            message: uploadError || "Failed to upload brand logo",
          };
        }

        brandLogoUrl = url;

        // Delete old logo if exists (only if it's from our storage)
        const { data: currentProfile } = await supabaseAdmin
          .from("v1_brand_profiles")
          .select("brand_logo_url")
          .eq("user_id", userId)
          .eq("is_deleted", false)
          .maybeSingle();

        if (currentProfile?.brand_logo_url) {
          // Only delete if it's from our storage (contains storage URL pattern)
          const placeholderUrl = "https://via.placeholder.com/400x400?text=Brand+Logo";
          if (
            currentProfile.brand_logo_url !== placeholderUrl &&
            (currentProfile.brand_logo_url.includes('storage') ||
             currentProfile.brand_logo_url.includes('supabase') ||
             currentProfile.brand_logo_url.includes('supabase.co'))
          ) {
            await deleteImageFromStorage(currentProfile.brand_logo_url);
          }
        }
      } else if (profileData.brand_logo_url !== undefined) {
        // Direct URL provided (no file upload)
        if (profileData.brand_logo_url === null || profileData.brand_logo_url === "") {
          brandLogoUrl = null;
        } else {
          brandLogoUrl = String(profileData.brand_logo_url).trim();
        }

        // Optionally delete old logo if it was from our storage and URL is changing
        if (brandLogoUrl) {
          const { data: currentProfile } = await supabaseAdmin
            .from("v1_brand_profiles")
            .select("brand_logo_url")
            .eq("user_id", userId)
            .eq("is_deleted", false)
            .maybeSingle();

          if (
            currentProfile?.brand_logo_url &&
            currentProfile.brand_logo_url !== brandLogoUrl
          ) {
            // Only delete if it's from our storage
            const placeholderUrl = "https://via.placeholder.com/400x400?text=Brand+Logo";
            if (
              currentProfile.brand_logo_url !== placeholderUrl &&
              (currentProfile.brand_logo_url.includes('storage') ||
               currentProfile.brand_logo_url.includes('supabase') ||
               currentProfile.brand_logo_url.includes('supabase.co'))
            ) {
              await deleteImageFromStorage(currentProfile.brand_logo_url);
            }
          }
        }
      }

      // 2) Update v1_brand_profiles
      const profileUpdate = {};

      // Debug logging (exclude file buffer to avoid terminal spam)
      const loggableProfileData = { ...profileData };
      if (loggableProfileData.brand_logo_file) {
        loggableProfileData.brand_logo_file = {
          originalname: profileData.brand_logo_file.originalname,
          size: profileData.brand_logo_file.size,
          mimetype: profileData.brand_logo_file.mimetype,
          // Don't log buffer data
        };
      }

      console.log(
        "[v1/completeBrandProfile] Received profileData:",
        JSON.stringify(loggableProfileData, null, 2)
      );

      // Update pan_number if provided
      if (profileData.pan_number !== undefined) {
        // Explicitly check for null/undefined, preserve empty strings
        if (
          profileData.pan_number === null ||
          profileData.pan_number === undefined
        ) {
          profileUpdate.pan_number = null;
        } else {
          const trimmed = String(profileData.pan_number).trim();
          profileUpdate.pan_number = trimmed || null;
        }
        console.log(
          "[v1/completeBrandProfile] Setting pan_number:",
          profileUpdate.pan_number
        );
      }

      // Update brand_name if provided
      if (profileData.brand_name !== undefined) {
        // Explicitly check for null/undefined, preserve empty strings
        if (
          profileData.brand_name === null ||
          profileData.brand_name === undefined
        ) {
          profileUpdate.brand_name = null;
        } else {
          const trimmed = String(profileData.brand_name).trim();
          profileUpdate.brand_name = trimmed || null;
        }
        console.log(
          "[v1/completeBrandProfile] Setting brand_name:",
          profileUpdate.brand_name
        );
      }

       // Update bio if provided
       if (profileData.bio !== undefined) {
        // Explicitly check for null/undefined, preserve empty strings
        if (profileData.bio === null || profileData.bio === undefined) {
          profileUpdate.bio = null;
        } else {
          const trimmed = String(profileData.bio).trim();
          profileUpdate.bio = trimmed || null;
        }
        console.log(
          "[v1/completeBrandProfile] Setting bio:",
          profileUpdate.bio
        );
      }

      // Update brand_description if provided
      if (profileData.brand_description !== undefined) {
        if (profileData.brand_description === null || profileData.brand_description === undefined) {
          profileUpdate.brand_description = null;
        } else {
          const trimmed = String(profileData.brand_description).trim();
          profileUpdate.brand_description = trimmed || null;
        }
        console.log(
          "[v1/completeBrandProfile] Setting brand_description:",
          profileUpdate.brand_description
        );
      }

      // Update gender if provided
      if (profileData.gender !== undefined) {
        profileUpdate.gender = this.normalizeGender(profileData.gender);
        console.log(
          "[v1/completeBrandProfile] Setting gender:",
          profileUpdate.gender
        );
      }

      // Update brand_logo_url if provided (from file upload or direct URL)
      if (brandLogoUrl !== null) {
        profileUpdate.brand_logo_url = brandLogoUrl;
      } else if (profileData.brand_logo_url !== undefined && profileData.brand_logo_url === null) {
        // Explicitly set to null if provided as null
        profileUpdate.brand_logo_url = null;
      }

      console.log(
        "[v1/completeBrandProfile] Final profileUpdate:",
        JSON.stringify(profileUpdate, null, 2)
      );

      // Check if profile exists
      const { data: existingProfile, error: fetchError } = await supabaseAdmin
        .from("v1_brand_profiles")
        .select("*")
        .eq("user_id", userId)
        .eq("is_deleted", false)
        .maybeSingle();

      let updatedProfile = null;

      if (!existingProfile) {
        // Profile doesn't exist - create it
        console.log(
          "[v1/completeBrandProfile] Profile not found, creating new profile"
        );

        const placeholderLogoUrl =
          "https://via.placeholder.com/400x400?text=Brand+Logo";

        const newProfile = {
          user_id: userId,
          brand_name: profileData.brand_name || "", // Required field
          brand_logo_url: brandLogoUrl || placeholderLogoUrl, // Required field
          bio: profileData.bio || null,
          brand_description: profileData.brand_description || null, // Add brand_description
          gender: this.normalizeGender(profileData.gender) || null, // Add gender
          pan_number: profileData.pan_number || null,
          pan_verified: false,
          profile_completion_pct: 0,
          is_deleted: false,
        };

        const { data: createdProfile, error: createError } = await supabaseAdmin
          .from("v1_brand_profiles")
          .insert(newProfile)
          .select()
          .single();

        if (createError) {
          console.error(
            "[v1/completeBrandProfile] Profile creation error:",
            createError
          );
          // If logo was uploaded but profile creation failed, try to delete uploaded logo
          if (brandLogoUrl) {
            await deleteImageFromStorage(brandLogoUrl);
          }
          return {
            success: false,
            message: "Failed to create profile",
            error: createError.message,
          };
        }

        updatedProfile = createdProfile;
      } else {
        // Profile exists - update it
        if (Object.keys(profileUpdate).length > 0) {
          const { data, error: updateError } = await supabaseAdmin
            .from("v1_brand_profiles")
            .update(profileUpdate)
            .eq("user_id", userId)
            .eq("is_deleted", false)
            .select()
            .single();

          if (updateError) {
            console.error(
              "[v1/completeBrandProfile] Profile update error:",
              updateError
            );
            // If logo was uploaded but update failed, try to delete uploaded logo
            if (brandLogoUrl) {
              await deleteImageFromStorage(brandLogoUrl);
            }
            return { success: false, message: "Failed to update profile" };
          }

          updatedProfile = data;
        } else {
          // No updates to make, use existing profile
          updatedProfile = existingProfile;
        }
      }

      // 3) Calculate profile completion percentage for brand
      const completionPct =
        this.calculateBrandProfileCompletion(updatedProfile);

      // Update completion percentage
      if (completionPct !== updatedProfile.profile_completion_pct) {
        await supabaseAdmin
          .from("v1_brand_profiles")
          .update({ profile_completion_pct: completionPct })
          .eq("user_id", userId);
        updatedProfile.profile_completion_pct = completionPct;
      }

      return {
        success: true,
        profile: updatedProfile,
        profile_completion_pct: completionPct,
        brand_logo_url: brandLogoUrl || updatedProfile.brand_logo_url,
        message: "Profile completed successfully",
      };
    } catch (err) {
      console.error("[v1/completeBrandProfile] Exception:", err);
      return {
        success: false,
        message: err.message || "Internal server error",
      };
    }
  }

  /**
   * Calculate brand profile completion percentage
   * NOTE: This method has been moved to ProfileService
   * @deprecated Use ProfileService.calculateBrandProfileCompletion instead
   */
  calculateBrandProfileCompletion(profile) {
    let completed = 0;
    let total = 0;
  
    // Required/important fields
    total++;
    if (profile.brand_logo_url) completed++;
  
    total++;
    if (profile.brand_name) completed++;
  
    total++;
    if (profile.bio) completed++;
  
    total++;
    if (profile.brand_description) completed++; // Add brand_description
  
    total++;
    if (profile.pan_number) completed++;
  
    return Math.round((completed / total) * 100);
  }

  /**
   * Calculate influencer profile completion percentage
   * NOTE: This method has been moved to ProfileService
   * @deprecated Use ProfileService.calculateProfileCompletion instead
   */
  calculateProfileCompletion(profile, extras = {}) {
    let completed = 0;
    let total = 0;
  
    // Required fields
    total++;
    if (profile.profile_photo_url) completed++;
  
    total++;
    if (profile.bio && profile.bio.trim().length > 0) completed++;
  
    // Optional but important
    total++;
    if (profile.pan_number) completed++;
  
    total++;
    if (profile.primary_language || (profile.languages && profile.languages.length > 0)) completed++;
  
    total++;
    if (extras.hasSocialPlatforms) completed++;
  
    // Check categories from main table array
    total++;
    if (profile.categories && Array.isArray(profile.categories) && profile.categories.length > 0) completed++;
  
    return Math.round((completed / total) * 100);
  }

}

module.exports = new AuthService();
