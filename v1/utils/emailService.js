const nodemailer = require("nodemailer");

class EmailService {
  constructor() {
    this.transporter = null;
    this.fromEmail = process.env.EMAIL_FROM || "noreply@stoory.com";
    this.fromName = process.env.EMAIL_FROM_NAME || "Stoory";
    this.baseUrl = process.env.FRONTEND_URL || process.env.APP_URL || "http://localhost:3000";
    this.initialized = false;
    this.etherealAccount = null;
    // Initialize asynchronously (don't await in constructor)
    this.initialize().catch(err => {
      console.error("Failed to initialize email service:", err);
    });
  }

  /**
   * Initialize email transporter based on environment configuration
   */
  async initialize() {
    try {
      const emailProvider = process.env.NODE_ENV ==="development" ? "ethereal" : process.env.EMAIL_PROVIDER || "ethereal";

      switch (emailProvider.toLowerCase()) {
        case "ethereal":
          // Ethereal Email - Fake SMTP service for testing
          // Perfect for development - emails are captured and can be viewed at https://ethereal.email
          try {
            this.etherealAccount = await nodemailer.createTestAccount();
            this.transporter = nodemailer.createTransport({
              host: "smtp.ethereal.email",
              port: 587,
              secure: false,
              auth: {
                // user: this.etherealAccount.user,
                // pass: this.etherealAccount.pass,
                user:"isaiah.wolf@ethereal.email",
                pass: "tYBtrbpGgCrZzXQs11",
              },
            });
            this.fromEmail = this.etherealAccount.user;
            console.log("✅ Ethereal Email test account created");
            console.log("📧 Test account:", this.etherealAccount.user);
            console.log("🔑 Password:", this.etherealAccount.pass);
            console.log("🌐 View emails at: https://ethereal.email");
            this.initialized = true;
          } catch (error) {
            console.error("❌ Failed to create Ethereal test account:", error);
            this.initialized = false;
          }
          return;

        case "gmail":
          this.transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
              user: process.env.EMAIL_USER,
              pass: process.env.EMAIL_PASSWORD || process.env.EMAIL_APP_PASSWORD,
            },
          });
          break;

        case "sendgrid":
          // SendGrid uses SMTP
          this.transporter = nodemailer.createTransport({
            host: "smtp.sendgrid.net",
            port: 587,
            secure: false,
            auth: {
              user: "apikey",
              pass: process.env.SENDGRID_API_KEY,
            },
          });
          if (process.env.SENDGRID_API_KEY) {
            this.fromEmail = process.env.EMAIL_FROM || process.env.SENDGRID_FROM_EMAIL;
          }
          break;

        case "ses":
          // AWS SES
          this.transporter = nodemailer.createTransport({
            host: process.env.SES_HOST || `email-smtp.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com`,
            port: 587,
            secure: false,
            auth: {
              user: process.env.SES_ACCESS_KEY_ID,
              pass: process.env.SES_SECRET_ACCESS_KEY,
            },
          });
          break;

        case "smtp":
          // Generic SMTP
          this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || "smtp.gmail.com",
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
            auth: {
              user: process.env.SMTP_USER || process.env.EMAIL_USER,
              pass: process.env.SMTP_PASSWORD || process.env.EMAIL_PASSWORD,
            },
          });
          break;

        default:
          console.warn(`⚠️ Unknown email provider: ${emailProvider}. Using Ethereal for testing.`);
          // Fallback to Ethereal
          try {
            this.etherealAccount = await nodemailer.createTestAccount();
            this.transporter = nodemailer.createTransport({
              host: "smtp.ethereal.email",
              port: 587,
              secure: false,
              auth: {
                user: this.etherealAccount.user,
                pass: this.etherealAccount.pass,
              },
            });
            this.fromEmail = this.etherealAccount.user;
            console.log("✅ Ethereal Email test account created (fallback)");
            console.log("📧 Test account:", this.etherealAccount.user);
            console.log("🌐 View emails at: https://ethereal.email");
            this.initialized = true;
            return;
          } catch (error) {
            console.error("❌ Failed to create Ethereal test account:", error);
            this.initialized = false;
            return;
          }
      }

      // Verify connection (async, don't block) - Skip for Ethereal as it's already initialized
      if (this.transporter && emailProvider.toLowerCase() !== "ethereal") {
        this.transporter.verify((error, success) => {
          if (error) {
            console.warn("⚠️ Email service configuration issue:", error.message);
            console.warn("⚠️ Email sending will be disabled. Check your EMAIL_* environment variables.");
            this.initialized = false;
          } else {
            console.log("✅ Email service initialized successfully");
            this.initialized = true;
          }
        });
      } else if (!this.transporter && emailProvider.toLowerCase() !== "ethereal") {
        console.warn("⚠️ Email transporter not configured. Email sending will be disabled.");
        this.initialized = false;
      }
    } catch (error) {
      console.error("❌ Failed to initialize email service:", error);
      this.initialized = false;
    }
  }

  /**
   * Send email verification email
   */
  async sendVerificationEmail(email, token, name = null) {
    // Wait a bit if still initializing (for async Ethereal account creation)
    if (!this.initialized && !this.transporter) {
      // Wait up to 2 seconds for initialization
      let attempts = 0;
      while (!this.initialized && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
    }
    
    if (!this.initialized || !this.transporter) {
      console.warn("[EmailService] Email service not initialized. Skipping email send.");
      return { success: false, message: "Email service not configured" };
    }

    try {
      const verificationUrl = `${this.baseUrl}/verify-email?token=${token}`;
      const userName = name || "User";

      const mailOptions = {
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to: email,
        subject: "Verify Your Email - Stoory",
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verify Your Email</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h1 style="color: #2c3e50; margin-top: 0;">Welcome to Stoory!</h1>
              <p>Hi ${userName},</p>
              <p>Thank you for registering with Stoory. Please verify your email address to complete your registration.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" 
                   style="background-color: #3498db; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                  Verify Email Address
                </a>
              </div>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #666; font-size: 12px;">${verificationUrl}</p>
              <p style="margin-top: 30px; font-size: 12px; color: #999;">
                This verification link will expire in 24 hours.
              </p>
              <p style="margin-top: 20px; font-size: 12px; color: #999;">
                If you didn't create an account with Stoory, please ignore this email.
              </p>
            </div>
            <div style="text-align: center; font-size: 12px; color: #999; margin-top: 20px;">
              <p>© ${new Date().getFullYear()} Stoory. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `
          Welcome to Stoory!
          
          Hi ${userName},
          
          Thank you for registering with Stoory. Please verify your email address by clicking the link below:
          
          ${verificationUrl}
          
          This verification link will expire in 24 hours.
          
          If you didn't create an account with Stoory, please ignore this email.
          
          © ${new Date().getFullYear()} Stoory. All rights reserved.
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("[EmailService] Verification email sent:", info.messageId);
      
      // If using Ethereal, get preview URL
      if (this.etherealAccount) {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          console.log("📧 Preview email at:", previewUrl);
        }
      }
      
      return { success: true, messageId: info.messageId, previewUrl: this.etherealAccount ? nodemailer.getTestMessageUrl(info) : null };
    } catch (error) {
      console.error("[EmailService] Failed to send verification email:", error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email, token, name = null) {
    // Wait a bit if still initializing (for async Ethereal account creation)
    if (!this.initialized && !this.transporter) {
      // Wait up to 2 seconds for initialization
      let attempts = 0;
      while (!this.initialized && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
    }
    
    if (!this.initialized || !this.transporter) {
      console.warn("[EmailService] Email service not initialized. Skipping email send.");
      return { success: false, message: "Email service not configured" };
    }

    try {
      const resetUrl = `${this.baseUrl}/reset-password?token=${token}`;
      const userName = name || "User";

      const mailOptions = {
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to: email,
        subject: "Reset Your Password - Stoory",
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Reset Your Password</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h1 style="color: #2c3e50; margin-top: 0;">Password Reset Request</h1>
              <p>Hi ${userName},</p>
              <p>We received a request to reset your password for your Stoory account.</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" 
                   style="background-color: #e74c3c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                  Reset Password
                </a>
              </div>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #666; font-size: 12px;">${resetUrl}</p>
              <p style="margin-top: 30px; font-size: 12px; color: #999;">
                This reset link will expire in 1 hour.
              </p>
              <p style="margin-top: 20px; font-size: 12px; color: #999;">
                If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
              </p>
            </div>
            <div style="text-align: center; font-size: 12px; color: #999; margin-top: 20px;">
              <p>© ${new Date().getFullYear()} Stoory. All rights reserved.</p>
            </div>
          </body>
          </html>
        `,
        text: `
          Password Reset Request
          
          Hi ${userName},
          
          We received a request to reset your password for your Stoory account. Click the link below to reset your password:
          
          ${resetUrl}
          
          This reset link will expire in 1 hour.
          
          If you didn't request a password reset, please ignore this email. Your password will remain unchanged.
          
          © ${new Date().getFullYear()} Stoory. All rights reserved.
        `,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log("[EmailService] Password reset email sent:", info.messageId);
      
      // If using Ethereal, get preview URL
      if (this.etherealAccount) {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          console.log("📧 Preview email at:", previewUrl);
        }
      }
      
      return { success: true, messageId: info.messageId, previewUrl: this.etherealAccount ? nodemailer.getTestMessageUrl(info) : null };
    } catch (error) {
      console.error("[EmailService] Failed to send password reset email:", error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Check if email service is available
   */
  isAvailable() {
    return this.initialized && this.transporter !== null;
  }
}

module.exports = new EmailService();

