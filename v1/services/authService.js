const { supabaseAdmin } = require("../db/config");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const whatsappService = require("../utils/whatsapp");
const emailService = require("../utils/emailService");
const { normalizeGender } = require("../utils/enumNormalizer");

class AuthService {
  constructor() {
    this.jwtSecret =
      process.env.JWT_SECRET || "your-secret-key-change-in-production";
    this.jwtExpiry = "1d";
    this.refreshJwtExpiry = "180d";
  }

  // ---------- OTP helpers (reuse otp_codes table) ----------

  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
  // Map legacy roles → v1 roles
  mapRole(userDataRole) {
    if (!userDataRole) return "INFLUENCER";

    const role = String(userDataRole).toLowerCase().trim();
    if (role === "influencer") return "INFLUENCER";
    if (role === "brand_owner" || role === "brand" || role === "owner")
      return "BRAND_OWNER";
    if (role === "admin") return "ADMIN";
    return "INFLUENCER"; // default
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
      // Bypass OTP for mock users (only if enabled)
      const mockUsersService = require("./mockUsersService");
      if (
        mockUsersService.isMockUsersEnabled() &&
        mockUsersService.isMockUser(phone) &&
        otp === "123456"
      ) {
        return { success: true };
      }

      // Bypass OTP for legacy test number
      if (phone === "+919876543210" && otp === "123456") {
        return { success: true };
      }

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

  // ---------- Send OTP (login existing v1 user) ----------

  async sendOTP(phone, role = null) {
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

      // Bypass for mock users (only if enabled)
      const mockUsersService = require("./mockUsersService");
      if (
        mockUsersService.isMockUsersEnabled() &&
        mockUsersService.isMockUser(phone)
      ) {
        return {
          success: true,
          message: "OTP sent successfully",
        };
      }

      // Bypass for legacy test phone number
      if (phone === "+919876543210") {
        return {
          success: true,
          message: "OTP sent successfully",
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
          message: "Account not found. Please register the phone number.",
          code: "USER_NOT_FOUND",
        };
      }

      if (user.is_deleted === true) {
        return {
          success: false,
          message: "Account deleted, reactivate to continue",
          is_deleted: true,
        };
      }

      // Validate role if provided
      if (role) {
        const validRoles = ["BRAND_OWNER", "INFLUENCER", "ADMIN"];
        if (!validRoles.includes(role)) {
          return {
            success: false,
            message:
              "Invalid role. Must be one of: BRAND_OWNER, INFLUENCER, ADMIN",
            code: "INVALID_ROLE",
          };
        }

        // Check if user's role matches the provided role
        if (user.role !== role) {
          return {
            success: false,
            message: `Phone number does not belong to a ${role}.`,
            code: "ROLE_MISMATCH",
          };
        }
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

  async sendRegistrationOTP(phone, email = null) {
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

      // Validate email format if provided
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          return {
            success: false,
            message: "Invalid email format",
            code: "INVALID_EMAIL_FORMAT",
          };
        }

        // Check if email already exists
        const { data: existingEmailUser, error: emailCheckError } =
          await supabaseAdmin
            .from("v1_users")
            .select("id")
            .eq("email", email)
            .eq("is_deleted", false)
            .maybeSingle();

        if (emailCheckError) {
          console.error("[v1/sendRegistrationOTP] Email check error:", emailCheckError);
          return {
            success: false,
            message: "Database error checking email",
            code: "DATABASE_ERROR",
          };
        }

        if (existingEmailUser) {
          return {
            success: false,
            message: "This email is already registered. Please use a different email or login.",
            code: "EMAIL_ALREADY_EXISTS",
          };
        }
      }

      // Bypass for mock users (only if enabled)
      const mockUsersService = require("./mockUsersService");
      if (
        mockUsersService.isMockUsersEnabled() &&
        mockUsersService.isMockUser(phone)
      ) {
        return {
          success: true,
          message: "OTP sent successfully",
        };
      }

      // Bypass for legacy test phone number
      if (phone === "+919876543210") {
        return {
          success: true,
          message: "OTP sent successfully",
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

  async sendReactivationOTP(phone, role = null) {
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

      // Bypass for mock users (only if enabled)
      const mockUsersService = require("./mockUsersService");
      if (
        mockUsersService.isMockUsersEnabled() &&
        mockUsersService.isMockUser(phone)
      ) {
        return {
          success: true,
          message: "OTP sent successfully",
          is_deleted: true,
        };
      }

      // Bypass for legacy test phone number
      if (phone === "+919876543210") {
        return {
          success: true,
          message: "OTP sent successfully",
          is_deleted: true,
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

      // 🚫 Active account should NOT use reactivation flow
      if (user.is_deleted === false) {
        return {
          success: false,
          message: "Account is already active. Please login.",
          code: "ACCOUNT_ALREADY_ACTIVE",
          is_deleted: false,
        };
      }

      // Validate role if provided
      if (role) {
        const validRoles = ["BRAND_OWNER", "INFLUENCER", "ADMIN"];
        if (!validRoles.includes(role)) {
          return {
            success: false,
            message:
              "Invalid role. Must be one of: BRAND_OWNER, INFLUENCER, ADMIN",
            code: "INVALID_ROLE",
          };
        }

        if (user.role !== role) {
          return {
            success: false,
            message: `Phone number does not belong to a ${role}.`,
            code: "ROLE_MISMATCH",
          };
        }
      }

      // Generate and store OTP
      const otp = this.generateOTP();
      const storeResult = await this.storeOTP(phone, otp);
      if (!storeResult.success) return storeResult;

      // Send OTP
      const sendResult = await whatsappService.sendOTP(phone, otp);

      return {
        ...sendResult,
        is_deleted: true,
      };
    } catch (err) {
      console.error("[v1/sendReactivationOTP] error:", err);
      return { success: false, message: "Failed to send reactivation OTP" };
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

        // Handle dob - accept ISO8601 date strings or null, always save in ISO format
        let dobValue = null;
        if (
          userData?.dob !== undefined &&
          userData?.dob !== null &&
          userData?.dob !== ""
        ) {
          const dobDate = new Date(userData.dob);
          if (!isNaN(dobDate.getTime())) {
            dobValue = dobDate.toISOString();
          }
        }

        const insertUser = {
          id,
          name: userData?.name || null,
          email: userData?.email || null,
          phone_number: phone,
          role,
          dob: dobValue,
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
        const ProfileService = require("./profileService");
        if (role === "INFLUENCER") {
          const profileResult = await ProfileService.createInfluencerProfile(
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
          const profileResult = await ProfileService.createBrandProfile(
            user,
            userData
          );
          if (!profileResult.success) {
            console.error(
              "[v1/verifyOTP] Failed to create brand profile:",
              profileResult.error
            );
            // Continue anyway - user is created, profile can be added later
          }
        }
        // ADMIN and AGENT don't need profiles for now
      } else if (user && user.is_deleted === true) {
        // reactivate user
        await this.reactivateUser(user);
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

  async updateBasicUserFields(user, userData) {
    if (!userData) return;

    const update = {};
    if (userData.name !== undefined) update.name = userData.name;
    if (userData.email !== undefined) update.email = userData.email;
    // Handle gender - now stored in v1_users table
    if (userData.gender !== undefined) {
      const normalizedGender = normalizeGender(userData.gender);
      if (normalizedGender !== null) {
        update.gender = normalizedGender;
      }
    }
    // Handle dob - accept ISO8601 date strings or null, always save in ISO format
    if (userData.dob !== undefined) {
      const dobInput = userData.dob;
      if (dobInput !== null && dobInput !== undefined && dobInput !== "") {
        const dobDate = new Date(dobInput);
        if (!isNaN(dobDate.getTime())) {
          update.dob = dobDate.toISOString();
        } else {
          console.warn(
            "[v1/updateBasicUserFields] Invalid dob format:",
            dobInput
          );
        }
      } else {
        update.dob = null;
      }
    }

    if (Object.keys(update).length === 0) return;

    try {
      await supabaseAdmin.from("v1_users").update(update).eq("id", user.id);
    } catch (err) {
      console.error("[v1/updateBasicUserFields] error:", err);
    }
  }

  async reactivateUser(user) {
    try {
      if (!user?.id) {
        return {
          success: false,
          statusCode: 400,
          message: "User ID is required for reactivation",
        };
      }

      if (!user.is_deleted) {
        return {
          success: false,
          statusCode: 400,
          message: "User account is already active",
        };
      }

      const nowIso = new Date().toISOString();

      // -------- Role-specific reactivation --------

      if (user.role === "BRAND_OWNER") {
        const { error } = await supabaseAdmin
          .from("v1_brand_profiles")
          .update({ is_deleted: false, updated_at: nowIso })
          .eq("user_id", user.id)
          .eq("is_deleted", true);

        if (error) {
          console.error(
            "[v1/UserService/reactivateUser] Brand profile error:",
            error
          );
          return {
            success: false,
            statusCode: 500,
            message: "Failed to reactivate brand profile",
            error: error.message,
          };
        }
      }

      if (user.role === "INFLUENCER") {
        const { error: profileError } = await supabaseAdmin
          .from("v1_influencer_profiles")
          .update({ is_deleted: false, updated_at: nowIso })
          .eq("user_id", user.id)
          .eq("is_deleted", true);

        if (profileError) {
          console.error(
            "[v1/UserService/reactivateUser] Influencer profile error:",
            profileError
          );
          return {
            success: false,
            statusCode: 500,
            message: "Failed to reactivate influencer profile",
            error: profileError.message,
          };
        }

        const { error: socialError } = await supabaseAdmin
          .from("v1_influencer_social_accounts")
          .update({ is_deleted: false, updated_at: nowIso })
          .eq("user_id", user.id)
          .eq("is_deleted", true);

        if (socialError) {
          console.error(
            "[v1/UserService/reactivateUser] Social accounts error:",
            socialError
          );
          return {
            success: false,
            statusCode: 500,
            message: "Failed to reactivate influencer social accounts",
            error: socialError.message,
          };
        }

        const { error: portfolioError } = await supabaseAdmin
          .from("v1_influencer_portfolio")
          .update({ is_deleted: false })
          .eq("user_id", user.id)
          .eq("is_deleted", true);

        if (portfolioError) {
          console.error(
            "[v1/UserService/reactivateUser] Portfolio error:",
            portfolioError
          );
          return {
            success: false,
            statusCode: 500,
            message: "Failed to reactivate influencer portfolio",
            error: portfolioError.message,
          };
        }
      }

      // -------- Reactivate user record last --------

      const { error: userError } = await supabaseAdmin
        .from("v1_users")
        .update({
          is_deleted: false,
          updated_at: nowIso,
        })
        .eq("id", user.id)
        .eq("is_deleted", true);

      if (userError) {
        console.error(
          "[v1/UserService/reactivateUser] User update error:",
          userError
        );
        return {
          success: false,
          statusCode: 500,
          message: "Failed to reactivate user account",
          error: userError.message,
        };
      }

      return {
        success: true,
        statusCode: 200,
        message: "User account reactivated successfully",
      };
    } catch (err) {
      console.error("[v1/UserService/reactivateUser] Exception:", err);
      return {
        success: false,
        statusCode: 500,
        message: "Failed to reactivate user account",
        error: err.message,
      };
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
        role: user.role,
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
  async registerBrandOwner(userData) {
    let createdUserId = null; // Track created user ID for cleanup
    const { email, password, name, phone_number, dob, gender } = userData;

    try {
      // 1) Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return { success: false, message: "Invalid email format" };
      }

      // 2) Check if email already exists (across all roles)
      const { data: existingEmailUser, error: emailCheckError } =
        await supabaseAdmin
          .from("v1_users")
          .select("id")
          .eq("email", email)
          .eq("is_deleted", false)
          .maybeSingle();

      if (emailCheckError) {
        return { success: false, message: "Database error checking email" };
      }

      if (existingEmailUser) {
        return {
          success: false,
          message:
            "This email is already registered. Please use a different email or login.",
          code: "EMAIL_ALREADY_EXISTS",
        };
      }

      // 2.1) Check if phone number already exists (if provided, across all roles)
      if (phone_number) {
        const { data: existingPhoneUser, error: phoneCheckError } =
          await supabaseAdmin
            .from("v1_users")
            .select("id")
            .eq("phone_number", phone_number)
            .eq("is_deleted", false)
            .maybeSingle();

        if (phoneCheckError) {
          return {
            success: false,
            message: "Database error checking phone number",
          };
        }

        if (existingPhoneUser) {
          return {
            success: false,
            message:
              "This phone number is already registered. Please use a different phone number.",
            code: "PHONE_ALREADY_EXISTS",
          };
        }
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

      // Handle dob - accept ISO8601 date strings or null, always save in ISO format
      let dobValue = null;
      if (dob !== undefined && dob !== null && dob !== "") {
        const dobDate = new Date(dob);
        if (!isNaN(dobDate.getTime())) {
          dobValue = dobDate.toISOString();
        }
      }

      // Normalize gender if provided
      const normalizedGender = gender ? normalizeGender(gender) : null;

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
          phone_number: phone_number || null,
          dob: dobValue,
          gender: normalizedGender,
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

      // Track the created user ID for potential cleanup
      createdUserId = created.id;

      // 7) Create brand profile in v1_brand_profiles table
      const ProfileService = require("./profileService");
      const profileResult = await ProfileService.createBrandProfile(
        created,
        userData || {}
      );

      if (!profileResult.success) {
        console.error(
          "[v1/registerBrandOwner] Failed to create brand profile:",
          profileResult.error,
          profileResult.details
        );
        // If profile creation fails, rollback user creation for data consistency
        if (createdUserId) {
          const { error: deleteError, count } = await supabaseAdmin
            .from("v1_users")
            .delete()
            .eq("id", createdUserId);

          if (deleteError) {
            console.error(
              "[v1/registerBrandOwner] Failed to rollback user creation:",
              deleteError
            );
            // Log critical error - user exists without profile
            console.error(
              "[v1/registerBrandOwner] CRITICAL: User created but profile creation failed and rollback failed. User ID:",
              createdUserId
            );
          } else if (count === 0) {
            console.warn(
              "[v1/registerBrandOwner] User rollback attempted but no rows deleted. User ID:",
              createdUserId
            );
          } else {
            console.log(
              "[v1/registerBrandOwner] Successfully rolled back user creation. User ID:",
              createdUserId
            );
          }
        }

        return {
          success: false,
          message: `Failed to create brand profile: ${
            profileResult.error || "Unknown error"
          }`,
        };
      }

      console.log(
        "[v1/registerBrandOwner] Brand profile created successfully. User ID:",
        created.id,
        "Profile user_id:",
        profileResult.profile?.user_id
      );

      // Verify the profile was actually created and is queryable
      const { data: verifyProfile, error: verifyError } = await supabaseAdmin
        .from("v1_brand_profiles")
        .select("user_id, is_deleted")
        .eq("user_id", created.id)
        .eq("is_deleted", false)
        .maybeSingle();

      if (verifyError) {
        console.error(
          "[v1/registerBrandOwner] Error verifying profile creation:",
          verifyError
        );
      } else if (!verifyProfile) {
        console.error(
          "[v1/registerBrandOwner] CRITICAL: Profile was created but cannot be found! User ID:",
          created.id,
          "Profile data:",
          profileResult.profile
        );
      } else {
        console.log(
          "[v1/registerBrandOwner] Profile verification successful. User ID:",
          verifyProfile.user_id,
          "is_deleted:",
          verifyProfile.is_deleted
        );
      }

      // Send email verification email with token
      const emailResult = await emailService.sendVerificationEmail(
        created.email,
        emailVerificationToken,
        created.name
      );

      if (!emailResult.success) {
        console.warn(
          "[v1/registerBrandOwner] Failed to send verification email:",
          emailResult.message
        );
        // Still return success - user is created, they can request resend
        // In development, also return token for testing
        return {
          success: true,
          user: {
            id: created.id,
            email: created.email,
            role: created.role,
            email_verified: created.email_verified,
          },
          verification_token:
            process.env.NODE_ENV === "development"
              ? emailVerificationToken
              : undefined,
          message:
            "Brand owner registered successfully. Please verify your email.",
          email_sent: false,
          email_error: emailResult.message,
        };
      }

      console.log(
        "[v1/registerBrandOwner] Verification email sent successfully. Message ID:",
        emailResult.messageId
      );

      return {
        success: true,
        user: {
          id: created.id,
          email: created.email,
          role: created.role,
          email_verified: created.email_verified,
        },
        // Only return token in development for testing
        verification_token:
          process.env.NODE_ENV === "development"
            ? emailVerificationToken
            : undefined,
        message:
          "Brand owner registered successfully. Please check your email to verify your account.",
        email_sent: true,
      };
    } catch (err) {
      console.error("[v1/registerBrandOwner] Exception:", err);

      // If user was created but exception occurred, try to clean up
      if (createdUserId) {
        try {
          console.log(
            "[v1/registerBrandOwner] Attempting to cleanup user after exception. User ID:",
            createdUserId
          );
          const { error: deleteError, count } = await supabaseAdmin
            .from("v1_users")
            .delete()
            .eq("id", createdUserId);

          if (deleteError) {
            console.error(
              "[v1/registerBrandOwner] Failed to cleanup user after exception:",
              deleteError
            );
            console.error(
              "[v1/registerBrandOwner] CRITICAL: User exists but registration failed. User ID:",
              createdUserId
            );
          } else if (count === 0) {
            console.warn(
              "[v1/registerBrandOwner] Cleanup attempted but no rows deleted. User ID:",
              createdUserId
            );
          } else {
            console.log(
              "[v1/registerBrandOwner] Successfully cleaned up user after exception. User ID:",
              createdUserId
            );
          }
        } catch (cleanupErr) {
          console.error(
            "[v1/registerBrandOwner] Exception during cleanup:",
            cleanupErr
          );
          console.error(
            "[v1/registerBrandOwner] CRITICAL: User exists but cleanup failed. User ID:",
            createdUserId
          );
        }
      }

      return {
        success: false,
        message: `Registration failed: ${err.message || "Unknown error"}`,
      };
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

      // Send email with verification link
      const emailResult = await emailService.sendVerificationEmail(
        user.email,
        verificationToken,
        user.name
      );

      if (!emailResult.success) {
        console.error(
          "[v1/resendEmailVerification] Failed to send verification email:",
          emailResult.message
        );
        // In development, still return token for testing
        return {
          success: true,
          message: "Verification link sent to email",
          verification_token:
            process.env.NODE_ENV === "development"
              ? verificationToken
              : undefined,
          email_sent: false,
          email_error: emailResult.message,
        };
      }

      console.log(
        "[v1/resendEmailVerification] Verification email sent successfully. Message ID:",
        emailResult.messageId
      );

      return {
        success: true,
        message: "Verification link sent to email",
        // Only return token in development for testing
        verification_token:
          process.env.NODE_ENV === "development"
            ? verificationToken
            : undefined,
        email_sent: true,
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

      // Send email with reset link
      const emailResult = await emailService.sendPasswordResetEmail(
        user.email,
        resetToken,
        user.name
      );

      if (!emailResult.success) {
        console.error(
          "[v1/forgotPassword] Failed to send password reset email:",
          emailResult.message
        );
        // In development, still return token for testing
        return {
          success: true,
          message: "Password reset link sent to email",
          reset_token:
            process.env.NODE_ENV === "development" ? resetToken : undefined,
          email_sent: false,
          email_error: emailResult.message,
        };
      }

      console.log(
        "[v1/forgotPassword] Password reset email sent successfully. Message ID:",
        emailResult.messageId
      );

      return {
        success: true,
        message: "Password reset link sent to email",
        // Only return token in development for testing
        reset_token:
          process.env.NODE_ENV === "development" ? resetToken : undefined,
        email_sent: true,
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

  /**
   * Change password for a logged-in user
   */
  async changePassword(userId, currentPassword, newPassword) {
    try {
      // 1) Ensure new password length >= 8
      if (!newPassword || newPassword.length < 8) {
        return {
          success: false,
          message: "New password must be at least 8 characters",
        };
      }

      // 2) Load user from v1_users by id, role = "BRAND_OWNER", is_deleted = false
      const { data: user, error } = await supabaseAdmin
        .from("v1_users")
        .select("*")
        .eq("id", userId)
        .eq("role", "BRAND_OWNER")
        .eq("is_deleted", false)
        .single();

      if (error || !user) {
        return {
          success: false,
          message: "User not found or access denied",
          code: "USER_NOT_FOUND",
        };
      }

      // 3) If no password_hash → return { success: false, code: "PASSWORD_NOT_SET" }
      if (!user.password_hash) {
        return {
          success: false,
          message: "Password not set. Please use password reset.",
          code: "PASSWORD_NOT_SET",
        };
      }

      // 4) Compare currentPassword with user.password_hash using bcrypt
      const isMatch = await this.comparePassword(
        currentPassword,
        user.password_hash
      );
      if (!isMatch) {
        return {
          success: false,
          message: "Current password is incorrect",
          code: "INVALID_CURRENT_PASSWORD",
        };
      }

      // 5) Hash new password and update v1_users.password_hash
      const newPasswordHash = await this.hashPassword(newPassword);
      const { error: updateError } = await supabaseAdmin
        .from("v1_users")
        .update({ password_hash: newPasswordHash })
        .eq("id", userId);

      if (updateError) {
        console.error("[v1/changePassword] Update error:", updateError);
        return { success: false, message: "Failed to update password" };
      }

      // 6) Return { success: true, message: "Password changed successfully" }
      return {
        success: true,
        message: "Password changed successfully",
      };
    } catch (err) {
      console.error("[v1/changePassword] Exception:", err);
      return { success: false, message: "Failed to change password" };
    }
  }
}

module.exports = new AuthService();
