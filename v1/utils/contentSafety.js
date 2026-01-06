/**
 * Contact Information Protection
 */

const PATTERNS = {
    // Phone numbers: Supports various formats
    // Matches: +1-555-123-4567, (555) 123-4567, 555.123.4567, 5551234567, etc.
    PHONE: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    
    // Email addresses: Fixed pattern with case-insensitive flag
    EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
    
    // Social handles: Supports @username, @user.name, @user-name
    HANDLE: /@[\w.-]+/g,
    
    // WhatsApp links: wa.me/1234567890
    WHATSAPP: /wa\.me\/\d+/gi,
    
    // Telegram links: t.me/username
    TELEGRAM: /t\.me\/[\w.-]+/gi,
    
    // Instagram links: instagram.com/username
    INSTAGRAM: /instagram\.com\/[\w.-]+/gi,
    
    // Facebook links: facebook.com/username
    FACEBOOK: /facebook\.com\/[\w.-]+/gi,
    
    // Twitter/X links: twitter.com/username or x.com/username
    TWITTER: /(twitter\.com|x\.com)\/[\w.-]+/gi
  };
  
  const MASK_STRING = '********';
  const MAX_MESSAGE_LENGTH = 10000; // Prevent extremely long messages
  
  /**
   * Masks sensitive contact information in a message
   * @param {string} message - The message to mask
   * @param {Object} options - Optional configuration
   * @param {boolean} options.logMasking - Whether to log masked items (default: true)
   * @returns {string} - The masked message
   */
  const maskContent = (message, options = {}) => {
    const { logMasking = true } = options;
    
    // Type checking
    if (typeof message !== 'string') {
      console.warn('maskContent: Expected string, got', typeof message);
      return message;
    }
    
    // Early return for empty strings
    if (!message || message.trim().length === 0) {
      return message;
    }
    
    // Check message length
    if (message.length > MAX_MESSAGE_LENGTH) {
      console.warn(`maskContent: Message exceeds max length (${MAX_MESSAGE_LENGTH})`);
      // Truncate but still process
      message = message.substring(0, MAX_MESSAGE_LENGTH);
    }
    
    let cleanMessage = message;
    let maskedCount = 0;
    const maskedItems = [];
    
    // Mask in order of specificity (more specific patterns first)
    // 1. Mask social media links
    cleanMessage = cleanMessage.replace(PATTERNS.WHATSAPP, (match) => {
      maskedItems.push({ type: 'whatsapp', value: match });
      maskedCount++;
      return MASK_STRING;
    });
    
    cleanMessage = cleanMessage.replace(PATTERNS.TELEGRAM, (match) => {
      maskedItems.push({ type: 'telegram', value: match });
      maskedCount++;
      return MASK_STRING;
    });
    
    cleanMessage = cleanMessage.replace(PATTERNS.INSTAGRAM, (match) => {
      maskedItems.push({ type: 'instagram', value: match });
      maskedCount++;
      return MASK_STRING;
    });
    
    cleanMessage = cleanMessage.replace(PATTERNS.FACEBOOK, (match) => {
      maskedItems.push({ type: 'facebook', value: match });
      maskedCount++;
      return MASK_STRING;
    });
    
    cleanMessage = cleanMessage.replace(PATTERNS.TWITTER, (match) => {
      maskedItems.push({ type: 'twitter', value: match });
      maskedCount++;
      return MASK_STRING;
    });
    
    // 2. Mask email addresses
    cleanMessage = cleanMessage.replace(PATTERNS.EMAIL, (match) => {
      maskedItems.push({ type: 'email', value: match });
      maskedCount++;
      return MASK_STRING;
    });
    
    // 3. Mask phone numbers
    cleanMessage = cleanMessage.replace(PATTERNS.PHONE, (match) => {
      maskedItems.push({ type: 'phone', value: match });
      maskedCount++;
      return MASK_STRING;
    });
    
    // 4. Mask social handles
    cleanMessage = cleanMessage.replace(PATTERNS.HANDLE, (match) => {
      maskedItems.push({ type: 'handle', value: match });
      maskedCount++;
      return MASK_STRING;
    });
    
    // Log masking activity (for audit purposes)
    if (logMasking && maskedCount > 0) {
      console.log(`[ContentSafety] Masked ${maskedCount} items:`, maskedItems);
    }
    
    return cleanMessage;
  };
  
  /**
   * Checks if message contains sensitive information without masking
   * @param {string} message - The message to check
   * @returns {boolean} - True if sensitive info is detected
   */
  const containsSensitiveInfo = (message) => {
    if (typeof message !== 'string' || !message) {
      return false;
    }
    
    return Object.values(PATTERNS).some(pattern => {
      // Create a new regex to avoid global flag issues
      const regex = new RegExp(pattern.source, pattern.flags);
      return regex.test(message);
    });
  };
  
  /**
   * Gets count of sensitive items in message
   * @param {string} message - The message to analyze
   * @returns {Object} - Count of each type of sensitive info
   */
  const getSensitiveInfoCount = (message) => {
    if (typeof message !== 'string' || !message) {
      return {};
    }
    
    const counts = {
      phone: 0,
      email: 0,
      handle: 0,
      whatsapp: 0,
      telegram: 0,
      instagram: 0,
      facebook: 0,
      twitter: 0
    };
    
    // Count each pattern
    const phoneMatches = message.match(PATTERNS.PHONE);
    if (phoneMatches) counts.phone = phoneMatches.length;
    
    const emailMatches = message.match(PATTERNS.EMAIL);
    if (emailMatches) counts.email = emailMatches.length;
    
    const handleMatches = message.match(PATTERNS.HANDLE);
    if (handleMatches) counts.handle = handleMatches.length;
    
    const whatsappMatches = message.match(PATTERNS.WHATSAPP);
    if (whatsappMatches) counts.whatsapp = whatsappMatches.length;
    
    const telegramMatches = message.match(PATTERNS.TELEGRAM);
    if (telegramMatches) counts.telegram = telegramMatches.length;
    
    const instagramMatches = message.match(PATTERNS.INSTAGRAM);
    if (instagramMatches) counts.instagram = instagramMatches.length;
    
    const facebookMatches = message.match(PATTERNS.FACEBOOK);
    if (facebookMatches) counts.facebook = facebookMatches.length;
    
    const twitterMatches = message.match(PATTERNS.TWITTER);
    if (twitterMatches) counts.twitter = twitterMatches.length;
    
    return counts;
  };
  
  module.exports = {
    maskContent,
    containsSensitiveInfo,
    getSensitiveInfoCount,
    PATTERNS, // Export for testing
    MASK_STRING,
    MAX_MESSAGE_LENGTH
  };