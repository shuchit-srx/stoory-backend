# Work Submission & Approval - Frontend Guide

This guide covers the complete work submission flow from influencer submission to brand owner approval/revision, including attachment handling and chat closed state management.

## Overview

The work submission flow includes:
1. **Influencer submits work** → Creates message with deliverables, description, and attachments
2. **Brand owner reviews** → Can approve work or request revision
3. **Work approved** → Collaboration completes, chat status becomes `closed`
4. **Revision requested** → Influencer can resubmit with updates

## API Endpoints

### 1. Submit Work

**Endpoint:** `POST /api/bids/conversations/:conversation_id/work-submission`  
**Endpoint:** `POST /api/campaigns/conversations/:conversation_id/work-submission`

**Request Body:**
```json
{
  "deliverables": "https://drive.google.com/...",  // Optional (URL)
  "description": "Work description here",            // Required (if no deliverables)
  "submission_notes": "Additional notes",           // Optional
  "attachments": ["attachment-id-1", "attachment-id-2"]  // Optional (array of attachment IDs)
}
```

**Response:**
```json
{
  "success": true,
  "message": "Work submitted successfully",
  "flow_state": "work_submitted",
  "awaiting_role": "brand_owner",
  "message_data": {
    "id": "message-id",
    "message": "📤 **Work Submitted**\n\n**Deliverables:** ...",
    "action_data": {
      "title": "🎯 **Work Review Required**",
      "buttons": [
        { "id": "approve_work", "text": "Approve Work", "action": "approve_work" },
        { "id": "request_revision", "text": "Request Revision", "action": "request_revision" }
      ],
      "work_submission": {
        "deliverables": "...",
        "description": "...",
        "attachments_count": 2,
        "attachment_ids": ["id-1", "id-2"]
      }
    }
  }
}
```

### 2. Upload Attachments (Before Submission)

**Endpoint:** `POST /api/messages/conversations/:conversation_id/attachments`

**Request Body:**
```json
{
  "fileName": "work-screenshot.jpg",
  "mimeType": "image/jpeg",
  "fileData": "base64-encoded-file-data"
}
```

**Response:**
```json
{
  "success": true,
  "attachment": {
    "id": "attachment-id",
    "url": "https://storage-url/...",
    "file_name": "work-screenshot.jpg",
    "mime_type": "image/jpeg"
  }
}
```

**Flow:**
1. Upload attachments first (get attachment IDs)
2. Include attachment IDs in work submission

### 3. Approve Work / Request Revision

**Endpoint:** `POST /api/messages/conversations/:conversation_id/button-click`

**Request Body:**
```json
{
  "action": "approve_work",  // or "request_revision"
  "data": {
    "message": "Great work!",  // Optional feedback
    "feedback": "Excellent quality"  // Optional for revisions
  }
}
```

**Response (Approve):**
```json
{
  "success": true,
  "flow_state": "work_approved",
  "chat_status": "closed",
  "is_closed": true
}
```

## Socket Events

### Real-time Updates

All work submission events emit socket events to `room:<conversationId>`:

#### 1. Work Submitted
```javascript
socket.on('conversation_state_changed', (data) => {
  // data = {
  //   conversation_id: "...",
  //   flow_state: "work_submitted",
  //   awaiting_role: "brand_owner",
  //   chat_status: "automated",
  //   current_action_data: { ... },
  //   updated_at: "..."
  // }
});

socket.on('chat:new', (data) => {
  // data = { message: { ... } }
  // Message includes action_data with work submission details
});
```

#### 2. Work Approved
```javascript
socket.on('conversation_state_changed', (data) => {
  // data = {
  //   conversation_id: "...",
  //   flow_state: "work_approved",
  //   awaiting_role: null,
  //   chat_status: "closed",  // ✅ Chat is CLOSED
  //   is_closed: true,        // ✅ Explicit closed flag
  //   current_action_data: {
  //     title: "🎉 **Collaboration Completed**",
  //     subtitle: "This conversation is closed.",
  //     is_closed: true,
  //     chat_status: "closed"
  //   }
  // }
});
```

#### 3. Revision Requested
```javascript
socket.on('conversation_state_changed', (data) => {
  // data = {
  //   conversation_id: "...",
  //   flow_state: "work_in_progress",  // or "work_final_review"
  //   awaiting_role: "influencer",
  //   chat_status: "automated"
  // }
});
```

### Conversation List Updates

Both users receive `conversations:upsert` events:

```javascript
socket.on('conversations:upsert', (data) => {
  // data = {
  //   conversation_id: "...",
  //   last_message: { ... },
  //   unread_count: 0,
  //   chat_status: "closed" | "automated",
  //   flow_state: "work_approved" | "work_submitted",
  //   updated_at: "..."
  // }
});
```

## Frontend Implementation

### Step 1: Upload Attachments (If Needed)

```typescript
// Upload file first
const uploadAttachment = async (file: File) => {
  const base64 = await fileToBase64(file);
  const response = await api.post(
    `/api/messages/conversations/${conversationId}/attachments`,
    {
      fileName: file.name,
      mimeType: file.type,
      fileData: base64
    }
  );
  return response.data.attachment.id; // Save this ID
};

// Collect attachment IDs
const attachmentIds = await Promise.all(
  files.map(file => uploadAttachment(file))
);
```

### Step 2: Submit Work

```typescript
const submitWork = async () => {
  const response = await api.post(
    `/api/bids/conversations/${conversationId}/work-submission`,
    {
      deliverables: deliverablesUrl,  // Optional
      description: workDescription,      // Required (if no deliverables)
      submission_notes: notes,          // Optional
      attachments: attachmentIds         // Array of attachment IDs from Step 1
    }
  );

  // Response includes message_data with full work submission details
  const workMessage = response.data.message_data;
  
  // Display work submission message in chat
  // Show buttons for brand owner: "Approve Work" / "Request Revision"
};
```

### Step 3: Handle Real-time Updates

```typescript
// Listen for work submission
socket.on('chat:new', ({ message }) => {
  if (message.action_data?.work_submission) {
    // Display work submission with attachments
    displayWorkSubmission(message);
    
    // If brand owner, show approve/revision buttons
    if (userRole === 'brand_owner') {
      showWorkReviewButtons(message.action_data.buttons);
    }
  }
});

// Listen for work approval
socket.on('conversation_state_changed', (data) => {
  if (data.flow_state === 'work_approved') {
    // ✅ Chat is CLOSED
    setChatStatus('closed');
    setChatClosed(true);
    showClosedBanner("🎉 Collaboration Completed");
    
    // Hide input, disable sending messages
    disableChatInput();
  }
});

// Listen for revision request
socket.on('conversation_state_changed', (data) => {
  if (data.flow_state === 'work_in_progress' && data.awaiting_role === 'influencer') {
    // Show resubmit button for influencer
    showResubmitButton();
  }
});
```

### Step 4: Display Work Submission with Attachments

```typescript
const displayWorkSubmission = (message: Message) => {
  const submission = message.action_data.work_submission;
  
  return (
    <WorkSubmissionCard>
      <Text>{message.message}</Text>
      
      {/* Deliverables Link */}
      {submission.deliverables && (
        <Link href={submission.deliverables}>
          📎 View Deliverables
        </Link>
      )}
      
      {/* Description */}
      {submission.description && (
        <Text>{submission.description}</Text>
      )}
      
      {/* Attachments */}
      {submission.attachment_ids?.length > 0 && (
        <AttachmentList>
          {submission.attachment_ids.map(attachmentId => (
            <AttachmentItem
              key={attachmentId}
              attachmentId={attachmentId}
              // Fetch attachment details from GET /api/messages/attachments/:id
            />
          ))}
        </AttachmentList>
      )}
      
      {/* Action Buttons (for brand owner) */}
      {message.action_data.buttons && (
        <ButtonGroup>
          {message.action_data.buttons.map(button => (
            <Button
              key={button.id}
              onPress={() => handleButtonClick(button.action)}
            >
              {button.text}
            </Button>
          ))}
        </ButtonGroup>
      )}
    </WorkSubmissionCard>
  );
};
```

### Step 5: Handle Chat Closed State

```typescript
// Check if chat is closed
const isChatClosed = (conversation: Conversation) => {
  return conversation.chat_status === 'closed' || 
         conversation.flow_state === 'work_approved' ||
         conversation.is_closed === true;
};

// In chat screen
useEffect(() => {
  socket.on('conversation_state_changed', (data) => {
    if (data.is_closed || data.chat_status === 'closed') {
      // Show closed banner
      setShowClosedBanner(true);
      
      // Disable chat input
      setChatInputDisabled(true);
      
      // Update UI to show "Collaboration Completed"
      setStatusMessage("🎉 This collaboration has been completed");
    }
  });
}, []);

// Render closed state
{isChatClosed && (
  <ClosedBanner>
    <Text>✅ Collaboration Completed</Text>
    <Text>This conversation is closed. Work has been approved.</Text>
  </ClosedBanner>
)}
```

## Key Points

1. **Attachments**: Upload first, get IDs, include in submission
2. **Work Submission Message**: Includes full submission data in `action_data.work_submission`
3. **Attachments in Message**: Linked via `message_attachments` table, accessible via attachment IDs
4. **Closed State**: 
   - `chat_status: "closed"` ✅
   - `is_closed: true` ✅
   - `flow_state: "work_approved"` ✅
5. **Real-time**: All state changes emit socket events immediately

## Complete Flow Diagram

```
Influencer:
  1. Upload attachments → Get attachment IDs
  2. Submit work (with attachment IDs)
  3. Wait for review
  
Brand Owner:
  4. Receive work submission message
  5. View deliverables/description/attachments
  6. Click "Approve Work" or "Request Revision"

If Approved:
  - Chat status → "closed"
  - Flow state → "work_approved"
  - Escrow funds released
  - Stats updated for both users
  
If Revision Requested:
  - Flow state → "work_in_progress"
  - Influencer can resubmit
```

## Testing Checklist

- [ ] Upload attachment before submission
- [ ] Submit work with attachments
- [ ] Verify work submission message appears
- [ ] Verify attachments are linked to message
- [ ] Brand owner sees approve/revision buttons
- [ ] Approve work → Chat becomes closed
- [ ] Verify closed state is clear in UI
- [ ] Request revision → Influencer can resubmit
- [ ] All socket events emit correctly
- [ ] Conversation list updates in real-time
