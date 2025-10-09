const { supabaseAdmin } = require("../supabase/client");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const whatsappService = require("./whatsapp");

class AuthService {
  constructor() {
    this.jwtSecret =
      process.env.JWT_SECRET || "your-secret-key-change-in-production";
    this.jwtExpiry = "7d"; // 7 days

    // Mock login configuration
    this.mockPhone = "9876543210"; // Mock phone number for testing (without country code)
    this.mockOTP = "123456"; // Mock OTP that always works

    // Additional test users for different roles
    this.testUsers = {
      admin: {
        phone: "9999999999",
        otp: "123456",
        role: "admin",
        name: "Admin User",
        email: "admin@stoory.com"
      },
      brandOwner: {
        phone: "9876543211",
        otp: "123456",
        role: "brand_owner",
        name: "Test Brand Owner",
      },
      brandOwner2: {
        phone: "9988776655",
        otp: "123456",
        role: "brand_owner",
        name: "Test Brand Owner 2",
      },
      influencer: {
        phone: "9876543212",
        otp: "123456",
        role: "influencer",
        name: "Test Influencer",
      },
    };
  }

  /**
   * Upsert an array of social platforms for a user during registration/onboarding
   */
  async upsertUserSocialPlatforms(userId, rawPlatforms) {
    try {
      if (!userId || !Array.isArray(rawPlatforms) || rawPlatforms.length === 0) {
        return { success: true };
      }

      // Normalize incoming items and filter invalid ones
      const platforms = rawPlatforms
        .map((item) => {
          const platform = item.platform || item.platform_name || item.name;
          const username = item.username || item.handle;
          const profileLink = item.profile_link || item.link || (platform && username ? `https://${platform}.com/${username}` : undefined);
          const followersCount = item.followers_count !== undefined ? parseInt(item.followers_count, 10) : (item.followers !== undefined ? parseInt(item.followers, 10) : undefined);
          const engagementRate = item.engagement_rate !== undefined ? parseFloat(item.engagement_rate) : (item.engagement !== undefined ? parseFloat(item.engagement) : undefined);
          return {
            platform,
            username,
            profile_link: profileLink,
            followers_count: Number.isFinite(followersCount) ? followersCount : null,
            engagement_rate: Number.isFinite(engagementRate) ? engagementRate : null,
          };
        })
        .filter((p) => p.platform && p.username);

      if (platforms.length === 0) {
        return { success: true };
      }

      // For each normalized platform, perform an upsert-like behavior:
      // If an entry with same user_id and platform_name exists, update it; else insert a new row.
      for (const p of platforms) {
        // Check existing by platform_name first (current controllers use platform_name)
        const { data: existingByName } = await supabaseAdmin
          .from("social_platforms")
          .select("id")
          .eq("user_id", userId)
          .eq("platform_name", p.platform)
          .limit(1)
          .maybeSingle?.() ?? await supabaseAdmin
          .from("social_platforms")
          .select("id")
          .eq("user_id", userId)
          .eq("platform_name", p.platform)
          .single();

        const row = {
          user_id: userId,
          platform_name: p.platform,
          platform: p.platform, // best-effort fill for enum column if present
          username: p.username,
          profile_link: p.profile_link,
          followers_count: p.followers_count,
          engagement_rate: p.engagement_rate,
          is_connected: true,
        };

        if (existingByName && existingByName.id) {
          await supabaseAdmin
            .from("social_platforms")
            .update({
              username: row.username,
              profile_link: row.profile_link,
              followers_count: row.followers_count,
              engagement_rate: row.engagement_rate,
              platform: row.platform,
              is_connected: row.is_connected,
            })
            .eq("id", existingByName.id)
            .eq("user_id", userId);
          continue;
        }

        // Otherwise insert
        await supabaseAdmin
          .from("social_platforms")
          .insert(row);
      }

      return { success: true };
    } catch (error) {
      console.error("Failed to upsert social platforms:", error);
      return { success: false, message: "Failed to upsert social platforms" };
    }
  }

  /**
   * Normalize a platform item from client payload into DB-ready fields
   */
  normalizePlatformItem(rawItem) {
    if (!rawItem || typeof rawItem !== "object") return null;

    // Accept multiple possible keys from frontend
    const platformName =
      rawItem.platform_name || rawItem.platform || rawItem.name || null;
    const username = rawItem.username || rawItem.platform_username || null;
    const profileLink = rawItem.profile_link || rawItem.url || null;

    // Followers may arrive as string/number
    const followersRaw =
      rawItem.followers_count ?? rawItem.followers ?? rawItem.followersCount;
    const followersCount =
      followersRaw === undefined || followersRaw === null
        ? null
        : parseInt(followersRaw);

    const engagementRaw = rawItem.engagement_rate ?? rawItem.engagementRate;
    const engagementRate =
      engagementRaw === undefined || engagementRaw === null
        ? null
        : parseFloat(engagementRaw);

    if (!platformName || !username) return null;

    return {
      platform_name: String(platformName).toLowerCase(),
      username: String(username),
      profile_link: profileLink || null,
      followers_count: Number.isNaN(followersCount) ? null : followersCount,
      engagement_rate: Number.isNaN(engagementRate) ? null : engagementRate,
    };
  }

  /**
   * Upsert an array of social platforms for a user
   */
  async upsertSocialPlatforms(userId, platforms) {
    try {
      if (!Array.isArray(platforms) || platforms.length === 0) return;

      // Normalize and de-duplicate by platform_name
      const normalized = platforms
        .map((p) => this.normalizePlatformItem(p))
        .filter((p) => !!p);

      const uniqueByPlatform = new Map();
      for (const item of normalized) {
        uniqueByPlatform.set(item.platform_name, item);
      }

      for (const [, item] of uniqueByPlatform) {
        // Check if a row already exists for this user+platform
        const { data: existing, error: checkError } = await supabaseAdmin
          .from("social_platforms")
          .select("id")
          .eq("user_id", userId)
          .eq("platform_name", item.platform_name)
          .limit(1)
          .single();

        if (existing && !checkError) {
          // Update existing
          await supabaseAdmin
            .from("social_platforms")
            .update({
              username: item.username,
              profile_link: item.profile_link,
              followers_count: item.followers_count,
              engagement_rate: item.engagement_rate,
            })
            .eq("id", existing.id)
            .eq("user_id", userId);
        } else {
          // Insert new
          await supabaseAdmin.from("social_platforms").insert({
            user_id: userId,
            platform_name: item.platform_name,
            username: item.username,
            profile_link: item.profile_link,
            followers_count: item.followers_count,
            engagement_rate: item.engagement_rate,
          });
        }
      }
    } catch (error) {
      // Do not block registration flow on platform sync errors
      console.error("Failed to upsert social platforms:", error);
    }
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
      console.error("WhatsApp OTP error:", error);
      return {
        success: false,
        message: "Failed to send WhatsApp OTP",
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
        .from("otp_codes")
        .upsert({
          phone: phone,
          otp: otp,
          expires_at: expiresAt,
          created_at: new Date(),
        })
        .select();

      if (error) {
        throw new Error(`Failed to store OTP: ${error.message}`);
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  /**
   * Verify OTP from database
   */
  async verifyStoredOTP(phone, otp) {
    try {
      console.log("🔍 Debug: OTP Verification");
      console.log("   Phone:", phone);
      console.log("   OTP:", otp);
      console.log("   Current Time:", new Date());

      const { data, error } = await supabaseAdmin
        .from("otp_codes")
        .select("*")
        .eq("phone", phone)
        .eq("otp", otp)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      console.log("   Database Result:", data);
      console.log("   Database Error:", error);

      if (error || !data) {
        console.log("   ❌ OTP verification failed");
        return { success: false, message: "Invalid or expired OTP" };
      }

      console.log("   ✅ OTP verification successful");

      // Delete the used OTP
      await supabaseAdmin.from("otp_codes").delete().eq("id", data.id);

      return { success: true };
    } catch (error) {
      console.log("   💥 OTP verification error:", error);
      return { success: false, message: "OTP verification failed" };
    }
  }

  /**
   * Check if user exists
   */
  async checkUserExists(phone) {
    try {
      const { data: existingUser, error } = await supabaseAdmin
        .from("users")
        .select("id, phone, name, email, role")
        .eq("phone", phone)
        .eq("is_deleted", false)
        .single();

      if (error && error.code !== "PGRST116") {
        return {
          success: false,
          message: "Database error",
        };
      }

      return {
        success: true,
        exists: !!existingUser,
        user: existingUser || null,
      };
    } catch (error) {
      return {
        success: false,
        message: "Failed to check user existence",
      };
    }
  }

  /**
   * Send OTP to phone number via WhatsApp (for existing users only)
   */
  async sendOTP(phone) {
    try {
      // Validate phone number format
      if (!phone.startsWith("+")) {
        return {
          success: false,
          message: "Phone number must include country code (e.g., +1234567890)",
        };
      }

      // Check if it's a valid international format (7-15 digits after +)
      const phoneRegex = /^\+[1-9]\d{6,14}$/;
      if (!phoneRegex.test(phone)) {
        return {
          success: false,
          message:
            "Invalid phone number format. Use international format: +[country code][number]",
        };
      }

      // Handle mock phone numbers (with or without country code)
      const phoneWithoutCountryCode = phone.startsWith('+91') ? phone.substring(3) : phone;
      if (
        phone === this.mockPhone ||
        phone === this.testUsers.admin.phone ||
        phone === this.testUsers.brandOwner.phone ||
        phone === this.testUsers.brandOwner2.phone ||
        phone === this.testUsers.influencer.phone ||
        phoneWithoutCountryCode === this.mockPhone ||
        phoneWithoutCountryCode === this.testUsers.admin.phone ||
        phoneWithoutCountryCode === this.testUsers.brandOwner.phone ||
        phoneWithoutCountryCode === this.testUsers.brandOwner2.phone ||
        phoneWithoutCountryCode === this.testUsers.influencer.phone
      ) {
        return {
          success: true,
          message: `Mock OTP sent successfully! Use OTP: 123456 for testing.`,
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
          message: "Account not found. Please register first.",
          code: "USER_NOT_FOUND",
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
        message: error.message,
      };
    }
  }

  /**
   * Send OTP for registration (new users)
   */
  async sendRegistrationOTP(phone) {
    try {
      // Validate phone number format
      if (!phone.startsWith("+")) {
        return {
          success: false,
          message: "Phone number must include country code (e.g., +1234567890)",
        };
      }

      // Check if it's a valid international format (7-15 digits after +)
      const phoneRegex = /^\+[1-9]\d{6,14}$/;
      if (!phoneRegex.test(phone)) {
        return {
          success: false,
          message:
            "Invalid phone number format. Use international format: +[country code][number]",
        };
      }

      // Handle mock phone numbers (with or without country code)
      const phoneWithoutCountryCode = phone.startsWith('+91') ? phone.substring(3) : phone;
      if (
        phone === this.mockPhone ||
        phone === this.testUsers.admin.phone ||
        phone === this.testUsers.brandOwner.phone ||
        phone === this.testUsers.brandOwner2.phone ||
        phone === this.testUsers.influencer.phone ||
        phoneWithoutCountryCode === this.mockPhone ||
        phoneWithoutCountryCode === this.testUsers.admin.phone ||
        phoneWithoutCountryCode === this.testUsers.brandOwner.phone ||
        phoneWithoutCountryCode === this.testUsers.brandOwner2.phone ||
        phoneWithoutCountryCode === this.testUsers.influencer.phone
      ) {
        return {
          success: true,
          message: `Mock registration OTP sent successfully! Use OTP: 123456 for testing.`,
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
          message: "Account already exists. Please login instead.",
          code: "USER_ALREADY_EXISTS",
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
        message: error.message,
      };
    }
  }

  /**
   * Verify OTP and create custom JWT session
   */
  async verifyOTP(phone, token, userData) {
    try {
      // Handle mock phone numbers and OTP (with or without country code)
      const phoneWithoutCountryCode = phone.startsWith('+91') ? phone.substring(3) : phone;
      
      console.log('🔍 [DEBUG] Mock OTP Check:', {
        phone,
        phoneWithoutCountryCode,
        token,
        isMockPhone: phone === this.mockPhone,
        isAdminPhone: phone === this.testUsers.admin.phone,
        isAdminPhoneWithoutCode: phoneWithoutCountryCode === this.testUsers.admin.phone,
        isCorrectOTP: token === "123456"
      });

      if (
        ((phone === this.mockPhone ||
          phone === this.testUsers.admin.phone ||
          phone === this.testUsers.brandOwner.phone ||
          phone === this.testUsers.brandOwner2.phone ||
          phone === this.testUsers.influencer.phone) ||
         (phoneWithoutCountryCode === this.mockPhone ||
          phoneWithoutCountryCode === this.testUsers.admin.phone ||
          phoneWithoutCountryCode === this.testUsers.brandOwner.phone ||
          phoneWithoutCountryCode === this.testUsers.brandOwner2.phone ||
          phoneWithoutCountryCode === this.testUsers.influencer.phone)) &&
        token === "123456"
      ) {
        // Determine user role based on phone number
        let userRole = "influencer";
        let userName = "Mock Test User";
        let userEmail = "mock@test.com";

        if (phone === this.testUsers.admin.phone || phoneWithoutCountryCode === this.testUsers.admin.phone) {
          userRole = "admin";
          userName = "Admin User";
          userEmail = "admin@stoory.com";
          console.log('🔍 [DEBUG] Admin user detected:', { phone, phoneWithoutCountryCode, userRole });
        } else if (phone === this.testUsers.brandOwner.phone || phoneWithoutCountryCode === this.testUsers.brandOwner.phone) {
          userRole = "brand_owner";
          userName = "Test Brand Owner";
        } else if (phone === this.testUsers.brandOwner2.phone || phoneWithoutCountryCode === this.testUsers.brandOwner2.phone) {
          userRole = "brand_owner";
          userName = "Test Brand Owner 2";
        } else if (phone === this.testUsers.influencer.phone || phoneWithoutCountryCode === this.testUsers.influencer.phone) {
          userRole = "influencer";
          userName = "Test Influencer";
        }

        // Check if mock user exists, if not create one
        const { data: existingUser, error: userError } = await supabaseAdmin
          .from("users")
          .select("*")
          .eq("phone", phone)
          .eq("is_deleted", false)
          .single();

        let user = existingUser;

        // If mock user doesn't exist, create one
        if (!existingUser) {
          const userId = crypto.randomUUID();

          const userCreateData = {
            id: userId,
            phone: phone,
            name: userData?.name || userName,
            email: userData?.email || userEmail,
            role: userData?.role || userRole,
            gender: userData?.gender || "other",
            languages: userData?.languages || ["English"],
            categories: userData?.categories || ["Technology"],
            min_range: userData?.min_range || 1000,
            max_range: userData?.max_range || 50000,
          };

          console.log('🔍 [DEBUG] Creating new user:', {
            userId,
            phone,
            role: userRole,
            name: userName,
            email: userEmail
          });

          const { data: newUser, error: createError } = await supabaseAdmin
            .from("users")
            .insert(userCreateData)
            .select()
            .single();

          if (createError) {
            console.error('❌ [ERROR] Failed to create user:', createError);
            return {
              success: false,
              message: "Failed to create mock user profile",
            };
          }

          console.log('✅ [SUCCESS] User created successfully:', {
            id: newUser.id,
            phone: newUser.phone,
            role: newUser.role,
            name: newUser.name
          });

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
              max_range: userData.max_range || user.max_range,
            };

            const { data: updatedUser, error: updateError } =
              await supabaseAdmin
                .from("users")
                .update(updateData)
                .eq("id", user.id)
                .select()
                .single();

            if (!updateError) {
              user = updatedUser;
            }
          }
        }

        // If social platforms provided in registration payload, upsert them now
        if (userData?.social_platforms || userData?.socialPlatforms) {
          const upsertResult = await this.upsertUserSocialPlatforms(
            user.id,
            userData.social_platforms || userData.socialPlatforms
          );
          if (!upsertResult.success) {
            console.warn("Social platforms upsert failed for mock user");
          }
        }

        // Sync social platforms for mock user when provided
        if (userData?.social_platforms) {
          await this.upsertSocialPlatforms(user.id, userData.social_platforms);
        }

        // Generate JWT token for mock user
        const jwtToken = jwt.sign(
          {
            id: user.id,
            phone: user.phone,
            role: user.role,
          },
          this.jwtSecret,
          { expiresIn: this.jwtExpiry }
        );

        console.log('✅ [SUCCESS] Mock authentication successful:', {
          userId: user.id,
          phone: user.phone,
          role: user.role,
          name: user.name,
          email: user.email
        });

        return {
          success: true,
          user: user,
          token: jwtToken,
          message: "Mock authentication successful",
        };
      }

      // Verify OTP from database for real users
      const verifyResult = await this.verifyStoredOTP(phone, token);
      if (!verifyResult.success) {
        return verifyResult;
      }

      // Check if user exists in our database
      const { data: existingUser, error: userError } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("phone", phone)
        .eq("is_deleted", false)
        .single();

      console.log('🔍 [DEBUG] Database user lookup:', {
        phone,
        existingUser: existingUser ? { id: existingUser.id, role: existingUser.role, name: existingUser.name } : null,
        error: userError?.message || null
      });

      if (userError && userError.code !== "PGRST116") {
        return {
          success: false,
          message: "Database error",
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
          role: "influencer", // Default role
        };

        // Add userData fields if provided
        if (userData) {
          // Basic profile fields
          if (userData.name) userCreateData.name = userData.name;
          if (userData.email) userCreateData.email = userData.email;
          if (userData.role) userCreateData.role = userData.role;
          if (userData.gender) userCreateData.gender = userData.gender;
          if (userData.languages) userCreateData.languages = userData.languages;
          if (userData.categories) userCreateData.categories = userData.categories;
          if (userData.min_range) userCreateData.min_range = userData.min_range;
          if (userData.max_range) userCreateData.max_range = userData.max_range;
          
          // Verification fields
          if (userData.pan_number) userCreateData.pan_number = userData.pan_number;
          if (userData.verification_image_url) userCreateData.verification_image_url = userData.verification_image_url;
          if (userData.verification_document_type) userCreateData.verification_document_type = userData.verification_document_type;
          if (userData.address_line1) userCreateData.address_line1 = userData.address_line1;
          if (userData.address_line2) userCreateData.address_line2 = userData.address_line2;
          if (userData.address_city) userCreateData.address_city = userData.address_city;
          if (userData.address_state) userCreateData.address_state = userData.address_state;
          if (userData.address_pincode) userCreateData.address_pincode = userData.address_pincode;
          if (userData.address_country) userCreateData.address_country = userData.address_country;
          if (userData.date_of_birth) userCreateData.date_of_birth = userData.date_of_birth;
          if (userData.bio) userCreateData.bio = userData.bio;
          if (userData.experience_years) userCreateData.experience_years = userData.experience_years;
          if (userData.specializations) userCreateData.specializations = userData.specializations;
          if (userData.portfolio_links) userCreateData.portfolio_links = userData.portfolio_links;
          if (userData.emergency_contact_name) userCreateData.emergency_contact_name = userData.emergency_contact_name;
          if (userData.emergency_contact_phone) userCreateData.emergency_contact_phone = userData.emergency_contact_phone;
          if (userData.emergency_contact_relation) userCreateData.emergency_contact_relation = userData.emergency_contact_relation;
          
          // Business fields (for brand owners)
          if (userData.business_name) userCreateData.business_name = userData.business_name;
          if (userData.business_type) userCreateData.business_type = userData.business_type;
          if (userData.gst_number) userCreateData.gst_number = userData.gst_number;
          if (userData.business_registration_number) userCreateData.business_registration_number = userData.business_registration_number;
          if (userData.business_address) userCreateData.business_address = userData.business_address;
          if (userData.business_website) userCreateData.business_website = userData.business_website;
        }

        const { data: newUser, error: createError } = await supabaseAdmin
          .from("users")
          .insert(userCreateData)
          .select()
          .single();

        if (createError) {
          console.error("User creation error:", createError);
          return {
            success: false,
            message: `Failed to create user profile: ${createError.message}`,
          };
        }

        user = newUser;

        // Sync social platforms for newly created user when provided
        if (userData?.social_platforms) {
          await this.upsertSocialPlatforms(user.id, userData.social_platforms);
        }

        // Send welcome message
        try {
          await whatsappService.sendWelcome(phone, userData?.name || "User");
        } catch (error) {
          console.error("Failed to send welcome message:", error);
        }
      } else {
        // If user exists, update with userData if provided
        if (userData && user) {
          const updateData = {
            // Basic profile fields
            name: userData.name,
            email: userData.email,
            role: userData.role || user.role,
            gender: userData.gender,
            languages: userData.languages,
            categories: userData.categories,
            min_range: userData.min_range,
            max_range: userData.max_range,
            
            // Verification fields
            pan_number: userData.pan_number,
            verification_image_url: userData.verification_image_url,
            verification_document_type: userData.verification_document_type,
            address_line1: userData.address_line1,
            address_line2: userData.address_line2,
            address_city: userData.address_city,
            address_state: userData.address_state,
            address_pincode: userData.address_pincode,
            address_country: userData.address_country,
            date_of_birth: userData.date_of_birth,
            bio: userData.bio,
            experience_years: userData.experience_years,
            specializations: userData.specializations,
            portfolio_links: userData.portfolio_links,
            emergency_contact_name: userData.emergency_contact_name,
            emergency_contact_phone: userData.emergency_contact_phone,
            emergency_contact_relation: userData.emergency_contact_relation,
            
            // Business fields (for brand owners)
            business_name: userData.business_name,
            business_type: userData.business_type,
            gst_number: userData.gst_number,
            business_registration_number: userData.business_registration_number,
            business_address: userData.business_address,
            business_website: userData.business_website,
          };

          // Remove undefined values
          Object.keys(updateData).forEach(
            (key) => updateData[key] === undefined && delete updateData[key]
          );

          if (Object.keys(updateData).length > 0) {
            const { data: updatedUser, error: updateError } =
              await supabaseAdmin
                .from("users")
                .update(updateData)
                .eq("id", user.id)
                .select()
                .single();

            if (!updateError) {
              user = updatedUser;
            }
          }

          // Sync social platforms for existing user when provided
          if (userData.social_platforms) {
            await this.upsertSocialPlatforms(user.id, userData.social_platforms);
          }
        }
      }

      // If social platforms provided in registration payload, upsert them now (works for both new and existing users)
      if (userData?.social_platforms || userData?.socialPlatforms) {
        const upsertResult = await this.upsertUserSocialPlatforms(
          user.id,
          userData.social_platforms || userData.socialPlatforms
        );
        if (!upsertResult.success) {
          console.warn("Social platforms upsert failed for user", user.id);
        }
      }

      // Generate custom JWT token
      const jwtToken = jwt.sign(
        {
          id: user.id,
          phone: user.phone,
          role: user.role,
        },
        this.jwtSecret,
        { expiresIn: this.jwtExpiry }
      );

      console.log('✅ [SUCCESS] Real user authentication successful:', {
        userId: user.id,
        phone: user.phone,
        role: user.role,
        name: user.name,
        email: user.email
      });

      return {
        success: true,
        user: user,
        token: jwtToken,
        message: "Authentication successful",
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
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
      return { success: false, message: "Invalid token" };
    }
  }

  /**
   * Middleware to authenticate requests using custom JWT token
   */
  authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    // Verify custom JWT token
    const result = this.verifyToken(token);
    if (!result.success) {
      return res.status(403).json({ error: "Invalid token" });
    }

    req.user = result.user;
    next();
  };

  /**
   * Middleware to check role permissions
   */
  requireRole(roles) {
    return (req, res, next) => {

      if (!req.user) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const userRole = req.user.role;
      const allowedRoles = Array.isArray(roles) ? roles : [roles];

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({ error: "Insufficient permissions" });
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
        role: user.role,
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
        .from("users")
        .select("*")
        .eq("id", userId)
        .eq("is_deleted", false)
        .single();

      if (error || !user) {
        return {
          success: false,
          message: "User not found",
        };
      }

      const token = this.generateToken(user);
      return {
        success: true,
        token: token,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}

module.exports = new AuthService();
