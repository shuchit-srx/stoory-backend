const getNotificationTemplate = (type, data = {}) => {
  const {
    campaignTitle = 'Campaign',
    influencerName = 'An influencer',
    brandName = 'The brand',
    senderName = 'Sender name',
    messagePreview = 'message sent',
    applicationId,
    campaignId,
    chatId,
    scriptId,
    workSubmissionId,
    payoutId,
    mouId,
    status,
    remarks,
    amount,
    requiresScript = false,
    scriptAccepted = false,
    recipient,
    count,
    firstNotification,
    applicationIds = []
  } = data;

  const templates = {
    APPLICATION_CREATED: {
      title: `${campaignTitle} Update`,
      body: `${influencerName} applied for ${campaignTitle}`,
      clickAction: `stoory://Main/MyWork?campaignId=${campaignId}`,
    },
    APPLICATION_ACCEPTED: {
      title: `${campaignTitle} Update`,
      body: `${brandName} accepted your application for ${campaignTitle}`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}`,
    },
    APPLICATION_CANCELLED: {
      title: `${campaignTitle} Update`,
      body: `${data.cancelledByName || 'The user'} cancelled the application for ${campaignTitle}`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}`,
    },
    MOU_ACCEPTED_BY_BRAND: {
      title: `${campaignTitle} Update`,
      body: `${brandName} accepted the MOU for ${campaignTitle}`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}&highlightSection=mou`,
    },
    MOU_ACCEPTED_BY_INFLUENCER: {
      title: `${campaignTitle} Update`,
      body: `${influencerName} accepted the MOU for ${campaignTitle}`,
      clickAction: `stoory://BrandOwnerOverviewScreen?applicationId=${applicationId}&highlightSection=mou`,
    },
    MOU_FULLY_ACCEPTED_BRAND: {
      title: `${campaignTitle} Update`,
      body: `Both parties accepted the MOU for ${campaignTitle}. Proceed with payment`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}&highlightSection=payment`,
    },
    MOU_FULLY_ACCEPTED_INFLUENCER: {
      title: `${campaignTitle} Update`,
      body: `Both parties accepted the MOU for ${campaignTitle}. Waiting for payment`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}`,
    },
    PAYMENT_COMPLETED: {
      title: `${campaignTitle} Update`,
      body: requiresScript && !scriptAccepted
        ? `Payment completed for ${campaignTitle}. Submit your script`
        : `Payment completed for ${campaignTitle}. Submit your work`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}&highlightSection=work`,
    },
    SCRIPT_SUBMITTED: {
      title: `${campaignTitle} Update`,
      body: `${influencerName} submitted a script for ${campaignTitle}`,
      clickAction: `stoory://BrandOwnerOverviewScreen?applicationId=${applicationId}&highlightSection=script`,
    },
    SCRIPT_REVIEW_ACCEPTED: {
      title: `${campaignTitle} Update`,
      body: `${brandName} accepted your script for ${campaignTitle}. Submit your work`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}&highlightSection=work`,
    },
    SCRIPT_REVIEW_REVISION: {
      title: `${campaignTitle} Update`,
      body: `${brandName} requested revision on your script for ${campaignTitle}`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}&highlightSection=script`,
    },
    SCRIPT_REVIEW_REJECTED: {
      title: `${campaignTitle} Update`,
      body: `${brandName} rejected your script for ${campaignTitle}`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}&highlightSection=script`,
    },
    WORK_SUBMITTED: {
      title: `${campaignTitle} Update`,
      body: `${influencerName} submitted work for ${campaignTitle}`,
      clickAction: `stoory://BrandOwnerOverviewScreen?applicationId=${applicationId}&highlightSection=work`,
    },
    WORK_REVIEW_ACCEPTED: {
      title: `${campaignTitle} Update`,
      body: `${brandName} accepted your work for ${campaignTitle}. Payout will be released soon`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}`,
    },
    WORK_REVIEW_REVISION: {
      title: `${campaignTitle} Update`,
      body: `${brandName} requested revision on your work for ${campaignTitle}`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}&highlightSection=work`,
    },
    WORK_REVIEW_REJECTED: {
      title: `${campaignTitle} Update`,
      body: `${brandName} rejected your work for ${campaignTitle}`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}&highlightSection=work`,
    },
    CAMPAIGN_COMPLETED: {
      title: `${campaignTitle} Update`,
      body: `Congratulations! ${campaignTitle} is now complete`,
      clickAction: `stoory://Main/MyWork?campaignId=${campaignId}`,
    },
    PAYOUT_RELEASED: {
      title: `${campaignTitle} Update`,
      body: `Your payout for ${campaignTitle} has been released`,
      clickAction: `stoory://InfluencerOverviewScreen?applicationId=${applicationId}`
    },
    CHAT_MESSAGE: {
      title: senderName,
      body: messagePreview,
      clickAction: `stoory://ChattingScreen?applicationId=${applicationId}&chatId=${chatId}`,
    },
    CHAT_MESSAGE_BATCHED: {
      title: count === 1 ? 'New Message' : `${count} New Messages`,
      body: count === 1
        ? firstNotification?.body || 'message sent'
        : `You have ${count} new messages`,
      clickAction: `stoory://Main/MyWork`,
    },
    APPLICATION_CREATED_BATCHED: {
      title: count === 1 ? 'New Application' : `${count} New Applications`,
      body: count === 1
        ? firstNotification?.body || 'New application received'
        : `You have ${count} new applications`,
      clickAction: `stoory://Main/MyWork`,
    },
  };

  return templates[type] || null;
};

const getScriptReviewTemplate = (status, campaignTitle, brandName, applicationId) => {
  const templateKey = `SCRIPT_REVIEW_${status}`;
  return getNotificationTemplate(templateKey, {
    campaignTitle,
    brandName,
    applicationId,
  });
};

const getWorkReviewTemplate = (status, campaignTitle, brandName, applicationId) => {
  const templateKey = `WORK_REVIEW_${status}`;
  return getNotificationTemplate(templateKey, {
    campaignTitle,
    brandName,
    applicationId,
  });
};

module.exports = {
  getNotificationTemplate,
  getScriptReviewTemplate,
  getWorkReviewTemplate,
};

