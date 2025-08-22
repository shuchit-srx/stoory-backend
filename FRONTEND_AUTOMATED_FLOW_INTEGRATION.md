# Frontend Automated Flow Integration Guide

## Overview
This guide provides React components, hooks, and integration patterns for implementing the automated bid flow system in your frontend application.

## Prerequisites
- React 16.8+ (for hooks)
- Axios or fetch for API calls
- React Router for navigation
- Context API or Redux for state management

---

## 1. API Service Layer

### Automated Flow API Service
```typescript
// services/automatedFlowService.ts
import axios from 'axios';

const API_BASE = '/api/bids/automated';

export interface AutomatedFlowService {
  initializeConversation: (data: {
    bid_id: string;
    influencer_id: string;
    proposed_amount: number;
  }) => Promise<any>;

  handleBrandOwnerAction: (data: {
    conversation_id: string;
    action: 'accept_offer' | 'negotiate_price' | 'ask_questions';
    data?: any;
  }) => Promise<any>;

  handleInfluencerAction: (data: {
    conversation_id: string;
    action: 'confirm_collaboration' | 'reject_collaboration';
    data?: any;
  }) => Promise<any>;

  handleFinalConfirmation: (data: {
    conversation_id: string;
    action: 'proceed_to_payment' | 'cancel_collaboration';
  }) => Promise<any>;

  getConversationContext: (conversationId: string) => Promise<any>;
}

class AutomatedFlowServiceImpl implements AutomatedFlowService {
  private getAuthHeaders() {
    const token = localStorage.getItem('auth_token');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async initializeConversation(data: any) {
    const response = await axios.post(
      `${API_BASE}/initialize`,
      data,
      { headers: this.getAuthHeaders() }
    );
    return response.data;
  }

  async handleBrandOwnerAction(data: any) {
    const response = await axios.post(
      `${API_BASE}/brand-owner-action`,
      data,
      { headers: this.getAuthHeaders() }
    );
    return response.data;
  }

  async handleInfluencerAction(data: any) {
    const response = await axios.post(
      `${API_BASE}/influencer-action`,
      data,
      { headers: this.getAuthHeaders() }
    );
    return response.data;
  }

  async handleFinalConfirmation(data: any) {
    const response = await axios.post(
      `${API_BASE}/final-confirmation`,
      data,
      { headers: this.getAuthHeaders() }
    );
    return response.data;
  }

  async getConversationContext(conversationId: string) {
    const response = await axios.get(
      `${API_BASE}/conversation/${conversationId}/context`,
      { headers: this.getAuthHeaders() }
    );
    return response.data;
  }
}

export const automatedFlowService = new AutomatedFlowServiceImpl();
```

---

## 2. React Hooks

### Automated Flow Hook
```typescript
// hooks/useAutomatedFlow.ts
import { useState, useCallback } from 'react';
import { automatedFlowService } from '../services/automatedFlowService';

export interface FlowState {
  current_state: string;
  awaiting_role: string | null;
  automation_enabled: boolean;
  flow_data: any;
}

export interface UseAutomatedFlowReturn {
  flowState: FlowState | null;
  isLoading: boolean;
  error: string | null;
  initializeConversation: (data: any) => Promise<void>;
  handleBrandOwnerAction: (data: any) => Promise<void>;
  handleInfluencerAction: (data: any) => Promise<void>;
  handleFinalConfirmation: (data: any) => Promise<void>;
  refreshContext: (conversationId: string) => Promise<void>;
}

export const useAutomatedFlow = (): UseAutomatedFlowReturn => {
  const [flowState, setFlowState] = useState<FlowState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initializeConversation = useCallback(async (data: any) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await automatedFlowService.initializeConversation(data);
      if (result.success) {
        setFlowState({
          current_state: result.flow_state,
          awaiting_role: result.awaiting_role,
          automation_enabled: true,
          flow_data: result.conversation.flow_data,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to initialize conversation');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleBrandOwnerAction = useCallback(async (data: any) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await automatedFlowService.handleBrandOwnerAction(data);
      if (result.success) {
        setFlowState({
          current_state: result.flow_state,
          awaiting_role: result.awaiting_role,
          automation_enabled: true,
          flow_data: result.conversation.flow_data,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to handle action');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInfluencerAction = useCallback(async (data: any) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await automatedFlowService.handleInfluencerAction(data);
      if (result.success) {
        setFlowState({
          current_state: result.flow_state,
          awaiting_role: result.awaiting_role,
          automation_enabled: true,
          flow_data: result.conversation.flow_data,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to handle action');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleFinalConfirmation = useCallback(async (data: any) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await automatedFlowService.handleFinalConfirmation(data);
      if (result.success) {
        setFlowState({
          current_state: result.flow_state,
          awaiting_role: null,
          automation_enabled: true,
          flow_data: null,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to handle final confirmation');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshContext = useCallback(async (conversationId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await automatedFlowService.getConversationContext(conversationId);
      if (result.success) {
        setFlowState(result.flow_context);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to refresh context');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    flowState,
    isLoading,
    error,
    initializeConversation,
    handleBrandOwnerAction,
    handleInfluencerAction,
    handleFinalConfirmation,
    refreshContext,
  };
};
```

---

## 3. React Components

### Automated Message Component
```typescript
// components/AutomatedMessage.tsx
import React from 'react';
import { ActionButtons } from './ActionButtons';
import { ActionInput } from './ActionInput';

interface AutomatedMessageProps {
  message: {
    id: string;
    message: string;
    message_type: string;
    action_required: boolean;
    action_data: any;
    created_at: string;
  };
  currentUserId: string;
  conversationRole: 'brand_owner' | 'influencer';
  onAction: (action: string, data?: any) => void;
}

export const AutomatedMessage: React.FC<AutomatedMessageProps> = ({
  message,
  currentUserId,
  conversationRole,
  onAction,
}) => {
  const renderActionData = () => {
    if (!message.action_data) return null;

    const { buttons, input_field, visible_to } = message.action_data;

    // Check if this action is visible to current user
    if (visible_to && visible_to !== conversationRole) return null;

    if (buttons) {
      return (
        <ActionButtons
          buttons={buttons}
          onAction={onAction}
          disabled={false}
        />
      );
    }

    if (input_field) {
      return (
        <ActionInput
          inputField={input_field}
          onSubmit={(data) => onAction('submit_input', data)}
        />
      );
    }

    return null;
  };

  return (
    <div className="automated-message">
      <div className="message-content">
        <p>{message.message}</p>
        <small className="message-time">
          {new Date(message.created_at).toLocaleString()}
        </small>
      </div>
      {message.action_required && (
        <div className="message-actions">
          {renderActionData()}
        </div>
      )}
    </div>
  );
};
```

### Action Buttons Component
```typescript
// components/ActionButtons.tsx
import React from 'react';

interface Button {
  id: string;
  text: string;
  style: 'success' | 'warning' | 'danger' | 'info' | 'primary';
  action: string;
}

interface ActionButtonsProps {
  buttons: Button[];
  onAction: (action: string) => void;
  disabled?: boolean;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  buttons,
  onAction,
  disabled = false,
}) => {
  const getButtonStyle = (style: string) => {
    const baseClasses = 'px-4 py-2 rounded-md font-medium transition-colors';
    const styleClasses = {
      success: 'bg-green-600 hover:bg-green-700 text-white',
      warning: 'bg-yellow-600 hover:bg-yellow-700 text-white',
      danger: 'bg-red-600 hover:bg-red-700 text-white',
      info: 'bg-blue-600 hover:bg-blue-700 text-white',
      primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    };
    return `${baseClasses} ${styleClasses[style as keyof typeof styleClasses]}`;
  };

  return (
    <div className="action-buttons flex gap-3">
      {buttons.map((button) => (
        <button
          key={button.id}
          className={getButtonStyle(button.style)}
          onClick={() => onAction(button.action)}
          disabled={disabled}
        >
          {button.text}
        </button>
      ))}
    </div>
  );
};
```

### Action Input Component
```typescript
// components/ActionInput.tsx
import React, { useState } from 'react';

interface InputField {
  type: string;
  placeholder: string;
  required: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
}

interface SubmitButton {
  text: string;
  style: string;
}

interface ActionInputProps {
  inputField: InputField;
  submitButton: SubmitButton;
  onSubmit: (data: any) => void;
}

export const ActionInput: React.FC<ActionInputProps> = ({
  inputField,
  submitButton,
  onSubmit,
}) => {
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputField.required && !value.trim()) return;
    onSubmit({ value: value.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="action-input">
      <div className="input-group">
        <input
          type={inputField.type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={inputField.placeholder}
          required={inputField.required}
          min={inputField.min}
          max={inputField.max}
          step={inputField.step}
          maxLength={inputField.maxLength}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          className={`px-4 py-2 ml-2 rounded-md font-medium transition-colors ${
            submitButton.style === 'primary'
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-600 hover:bg-gray-700 text-white'
          }`}
        >
          {submitButton.text}
        </button>
      </div>
    </form>
  );
};
```

### Automated Conversation Component
```typescript
// components/AutomatedConversation.tsx
import React, { useEffect, useState } from 'react';
import { useAutomatedFlow } from '../hooks/useAutomatedFlow';
import { AutomatedMessage } from './AutomatedMessage';
import { FlowStatus } from './FlowStatus';

interface AutomatedConversationProps {
  conversationId: string;
  currentUserId: string;
  conversationRole: 'brand_owner' | 'influencer';
}

export const AutomatedConversation: React.FC<AutomatedConversationProps> = ({
  conversationId,
  currentUserId,
  conversationRole,
}) => {
  const {
    flowState,
    isLoading,
    error,
    refreshContext,
    handleBrandOwnerAction,
    handleInfluencerAction,
    handleFinalConfirmation,
  } = useAutomatedFlow();

  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    if (conversationId) {
      refreshContext(conversationId);
      // Load conversation messages here
    }
  }, [conversationId, refreshContext]);

  const handleAction = async (action: string, data?: any) => {
    try {
      if (conversationRole === 'brand_owner') {
        if (action === 'proceed_to_payment' || action === 'cancel_collaboration') {
          await handleFinalConfirmation({
            conversation_id: conversationId,
            action,
          });
        } else {
          await handleBrandOwnerAction({
            conversation_id: conversationId,
            action,
            data,
          });
        }
      } else {
        await handleInfluencerAction({
          conversation_id: conversationId,
          action,
          data,
        });
      }

      // Refresh context and messages
      await refreshContext(conversationId);
    } catch (err) {
      console.error('Action failed:', err);
    }
  };

  if (isLoading) {
    return <div className="loading">Loading conversation...</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  return (
    <div className="automated-conversation">
      <FlowStatus
        currentState={flowState?.current_state}
        awaitingRole={flowState?.awaiting_role}
        conversationRole={conversationRole}
      />
      
      <div className="messages-container">
        {messages.map((message) => (
          <AutomatedMessage
            key={message.id}
            message={message}
            currentUserId={currentUserId}
            conversationRole={conversationRole}
            onAction={handleAction}
          />
        ))}
      </div>

      {flowState?.awaiting_role === conversationRole && (
        <div className="turn-indicator">
          It's your turn to respond!
        </div>
      )}
    </div>
  );
};
```

### Flow Status Component
```typescript
// components/FlowStatus.tsx
import React from 'react';

interface FlowStatusProps {
  currentState: string | undefined;
  awaitingRole: string | null;
  conversationRole: 'brand_owner' | 'influencer';
}

export const FlowStatus: React.FC<FlowStatusProps> = ({
  currentState,
  awaitingRole,
  conversationRole,
}) => {
  const getStateDisplayName = (state: string) => {
    const stateNames: Record<string, string> = {
      initial: 'Initial Application',
      influencer_responding: 'Awaiting Influencer Response',
      negotiating: 'Price Negotiation',
      brand_owner_confirming: 'Final Confirmation',
      both_confirmed: 'Collaboration Confirmed',
      payment_pending: 'Payment Processing',
      accepted: 'Accepted',
      declined: 'Declined',
      completed: 'Completed',
    };
    return stateNames[state] || state;
  };

  const getStatusColor = (state: string) => {
    const colors: Record<string, string> = {
      initial: 'bg-blue-100 text-blue-800',
      influencer_responding: 'bg-yellow-100 text-yellow-800',
      negotiating: 'bg-orange-100 text-orange-800',
      brand_owner_confirming: 'bg-purple-100 text-purple-800',
      both_confirmed: 'bg-green-100 text-green-800',
      payment_pending: 'bg-indigo-100 text-indigo-800',
      accepted: 'bg-green-100 text-green-800',
      declined: 'bg-red-100 text-red-800',
      completed: 'bg-gray-100 text-gray-800',
    };
    return colors[state] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="flow-status mb-4">
      <div className="status-badges flex gap-2">
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(currentState || '')}`}>
          {getStateDisplayName(currentState || '')}
        </span>
        
        {awaitingRole && (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
            Awaiting: {awaitingRole === 'brand_owner' ? 'Brand Owner' : 'Influencer'}
          </span>
        )}
        
        {awaitingRole === conversationRole && (
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
            Your Turn
          </span>
        )}
      </div>
    </div>
  );
};
```

---

## 4. Integration with Existing Chat System

### Enhanced Message Controller Integration
```typescript
// hooks/useEnhancedMessages.ts
import { useState, useEffect } from 'react';
import { useAutomatedFlow } from './useAutomatedFlow';

export const useEnhancedMessages = (conversationId: string) => {
  const [messages, setMessages] = useState<any[]>([]);
  const { flowState, refreshContext } = useAutomatedFlow();

  // Load messages and integrate with automated flow
  useEffect(() => {
    if (conversationId) {
      loadMessages();
      refreshContext(conversationId);
    }
  }, [conversationId]);

  const loadMessages = async () => {
    // Load messages from your existing message system
    // Filter out automated messages that should be handled by AutomatedMessage component
  };

  const isAutomatedMessage = (message: any) => {
    return message.message_type === 'automated' && message.action_required;
  };

  return {
    messages,
    flowState,
    isAutomatedMessage,
    refreshMessages: loadMessages,
  };
};
```

---

## 5. Styling and CSS

### Base Styles
```css
/* styles/automated-flow.css */
.automated-conversation {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.automated-message {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.message-content {
  margin-bottom: 12px;
}

.message-content p {
  margin: 0 0 8px 0;
  line-height: 1.5;
}

.message-time {
  color: #6c757d;
  font-size: 0.875rem;
}

.message-actions {
  border-top: 1px solid #e9ecef;
  padding-top: 12px;
}

.action-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.action-input {
  margin-top: 12px;
}

.input-group {
  display: flex;
  gap: 8px;
}

.turn-indicator {
  background: #d4edda;
  color: #155724;
  padding: 12px;
  border-radius: 8px;
  text-align: center;
  font-weight: 500;
  margin-top: 16px;
}

.flow-status {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 16px;
}

.status-badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #6c757d;
}

.error {
  background: #f8d7da;
  color: #721c24;
  padding: 16px;
  border-radius: 8px;
  text-align: center;
}
```

---

## 6. Usage Examples

### Brand Owner Dashboard
```typescript
// pages/BrandOwnerDashboard.tsx
import React from 'react';
import { AutomatedConversation } from '../components/AutomatedConversation';

export const BrandOwnerDashboard: React.FC = () => {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);

  return (
    <div className="dashboard">
      <h1>Brand Owner Dashboard</h1>
      
      {selectedConversation ? (
        <AutomatedConversation
          conversationId={selectedConversation}
          currentUserId="brand-owner-id"
          conversationRole="brand_owner"
        />
      ) : (
        <div className="conversation-list">
          {/* List of conversations */}
        </div>
      )}
    </div>
  );
};
```

### Influencer Dashboard
```typescript
// pages/InfluencerDashboard.tsx
import React from 'react';
import { AutomatedConversation } from '../components/AutomatedConversation';

export const InfluencerDashboard: React.FC = () => {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);

  return (
    <div className="dashboard">
      <h1>Influencer Dashboard</h1>
      
      {selectedConversation ? (
        <AutomatedConversation
          conversationId={selectedConversation}
          currentUserId="influencer-id"
          conversationRole="influencer"
        />
      ) : (
        <div className="conversation-list">
          {/* List of conversations */}
        </div>
      )}
    </div>
  );
};
```

---

## 7. Testing

### Component Testing
```typescript
// __tests__/AutomatedMessage.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutomatedMessage } from '../components/AutomatedMessage';

const mockMessage = {
  id: '1',
  message: 'Test message',
  message_type: 'automated',
  action_required: true,
  action_data: {
    buttons: [
      { id: 'test', text: 'Test Button', style: 'primary', action: 'test_action' }
    ]
  },
  created_at: '2024-01-01T00:00:00Z'
};

describe('AutomatedMessage', () => {
  it('renders message content', () => {
    render(
      <AutomatedMessage
        message={mockMessage}
        currentUserId="user1"
        conversationRole="brand_owner"
        onAction={jest.fn()}
      />
    );
    
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('renders action buttons when action_required is true', () => {
    render(
      <AutomatedMessage
        message={mockMessage}
        currentUserId="user1"
        conversationRole="brand_owner"
        onAction={jest.fn()}
      />
    );
    
    expect(screen.getByText('Test Button')).toBeInTheDocument();
  });
});
```

---

## 8. Performance Considerations

1. **Memoization**: Use React.memo for components that don't need frequent re-renders
2. **Lazy Loading**: Load conversation data only when needed
3. **Debouncing**: Debounce user input actions to prevent excessive API calls
4. **Optimistic Updates**: Update UI immediately for better user experience

---

## 9. Accessibility

1. **ARIA Labels**: Add proper ARIA labels for action buttons and inputs
2. **Keyboard Navigation**: Ensure all interactive elements are keyboard accessible
3. **Screen Reader Support**: Provide meaningful text alternatives for automated messages
4. **Focus Management**: Manage focus when new actions appear

---

## 10. Error Boundaries

```typescript
// components/AutomatedFlowErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class AutomatedFlowErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Automated flow error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong with the automated flow.</h2>
          <button onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

This comprehensive integration guide provides everything needed to implement the automated bid flow system in your React frontend, with proper separation of concerns, reusable components, and best practices.
